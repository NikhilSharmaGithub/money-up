/**
 * Every action re-sends the whole board to every viewer: about 13.5 KB each,
 * thirty-odd times a minute, and almost none of it has moved since the lobby.
 * The map is the same map. The group table is the same table. The settings
 * were agreed before anyone rolled. This is the diff that stops paying for
 * them twice.
 *
 * Deliberately small and dependency-free — plain JSON in, plain JSON out, and
 * `applyPatch(prev, diff(prev, next))` reproduces `next` exactly, including
 * the keys that vanish when a turn ends or an auction closes.
 *
 * Arrays are replaced wholesale. Order carries meaning nearly everywhere in
 * this state — turn order, the log, the properties on one side of a trade —
 * so an element-wise array diff would cost more to compute than it saves on
 * the wire, and would be far easier to get subtly wrong. The two arrays that
 * genuinely only ever grow, the log and the chat, get their own treatment
 * further down.
 *
 * ---------------------------------------------------------------- the shape
 *
 * A patch for an object is an object with up to three members, all optional:
 *
 *   { s: { key: value, ... },   set: this key is now exactly this value
 *     p: { key: patch, ... },   patch: recurse, both sides are objects
 *     d: [ key, ... ] }         drop: this key is gone
 *
 * `undefined` means no change at all — nothing to send. At the very top a
 * value that isn't an object on both sides comes back as `{ $: value }`,
 * a wholesale replacement, which is also what a client should expect if the
 * root ever changes type. Real keys always live inside `s`, `p` or `d`, so a
 * state key called "s" can never be mistaken for the envelope.
 */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * JSON never carries an `undefined`, so a key holding one is a key the client
 * will simply not have. Both sides of the diff have to agree with the wire on
 * what exists, or a field that quietly goes undefined would be diffed as a
 * change and then vanish out of the patch on its way over.
 */
const present = (obj, k) => obj[k] !== undefined;

/** Deep value equality over plain JSON — same rules the wire plays by. */
export function equal(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const arr = Array.isArray(a);
  if (arr !== Array.isArray(b)) return false;
  if (arr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
    return true;
  }
  let count = 0;
  for (const k of Object.keys(a)) {
    if (!present(a, k)) continue;
    count++;
    if (!present(b, k) || !equal(a[k], b[k])) return false;
  }
  for (const k of Object.keys(b)) if (present(b, k)) count--;
  return count === 0;
}

function objDiff(prev, next) {
  let set; let sub; let del;
  for (const k of Object.keys(next)) {
    if (!present(next, k)) continue;
    const a = prev[k];
    const b = next[k];
    // Same reference, nothing to say. The static half of this state — the
    // board, the group table, the feeds — lands here and costs nothing.
    if (a === b) continue;
    if (a === undefined) { (set ??= {})[k] = b; continue; }
    if (isObj(a) && isObj(b)) {
      const inner = objDiff(a, b);
      if (inner) (sub ??= {})[k] = inner;
      continue;
    }
    if (!equal(a, b)) (set ??= {})[k] = b;
  }
  for (const k of Object.keys(prev)) {
    if (present(prev, k) && !present(next, k)) (del ??= []).push(k);
  }
  if (!set && !sub && !del) return undefined;
  const patch = {};
  if (set) patch.s = set;
  if (sub) patch.p = sub;
  if (del) patch.d = del;
  return patch;
}

/** The change from `prev` to `next`, or `undefined` if there wasn't one. */
export function diff(prev, next) {
  if (isObj(prev) && isObj(next)) return objDiff(prev, next);
  return equal(prev, next) ? undefined : { $: next };
}

/**
 * `next` again, from `prev` and the patch. Untouched branches are shared with
 * `prev` rather than copied — the result is meant to be read, then handed
 * back in as the next `prev`, not edited in place.
 */
export function applyPatch(prev, patch) {
  if (patch == null) return prev;
  if (Object.hasOwn(patch, '$')) return patch.$;
  const out = {};
  // Copying by hand rather than spreading, so a key that was undefined on the
  // way in doesn't reappear as one on the way out. The wire wouldn't have
  // carried it, and the round trip has to match the wire.
  for (const k of Object.keys(prev)) if (present(prev, k)) out[k] = prev[k];
  if (patch.d) for (const k of patch.d) delete out[k];
  if (patch.s) for (const k of Object.keys(patch.s)) out[k] = patch.s[k];
  if (patch.p) for (const k of Object.keys(patch.p)) out[k] = applyPatch(out[k], patch.p[k]);
  return out;
}

/**
 * A viewer's last state is only worth keeping if it stays still. The room
 * hands out live references — `settings` is the room's own settings object,
 * the turn's pending action is the room's own — and it edits them in place
 * before the next push. A remembered state that quietly caught up with the
 * present would make the diff skip exactly the fields that moved, so the base
 * each delta viewer is cut from gets frozen first.
 *
 * `shared` names the top-level keys that truly never change underneath us:
 * the board and the group table are module constants, and log and chat
 * entries are written once and never touched again. They are most of the
 * bytes, and copying them every push would cost more than the diff saves.
 */
export function snapshot(value, shared) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = snapshot(value[i]);
    return out;
  }
  const out = {};
  for (const k of Object.keys(value)) {
    out[k] = shared && shared.has(k) ? value[k] : snapshot(value[k]);
  }
  return out;
}

/** feedTail's answer when the viewer has fallen out of the window entirely. */
export const RESYNC = Symbol('resync');

/**
 * The log and the chat only ever grow, and they are the two worst offenders
 * in a full push: sixty log lines and fifty chat lines re-sent for the sake
 * of the one that is new. A tail says instead — keep the last `keep` entries
 * you already hold, then append these.
 *
 * `keep` is what makes it exact rather than approximate. The server's window
 * slides, and a viewer with the team channel filtered out of their chat holds
 * a slightly different slice again; trusting the client to trim to the right
 * length by itself would let the two drift. Told how many of its own entries
 * survive, the client lands on precisely the array a full state would have
 * given it.
 *
 * `after` is the anchor — the `id` of the last chat line, the `at` of the
 * last log line, whichever the viewer is meant to be holding. A client whose
 * own last entry disagrees has gapped, and should ask for a fresh state
 * rather than stitch a hole into its scrollback.
 *
 * Returns `null` when there is nothing to send, RESYNC when no tail can
 * honestly bridge the two.
 */
export function feedTail(prev, next, key = 'at') {
  if (!Array.isArray(prev) || !Array.isArray(next)) return RESYNC;
  if (prev.length === 0) return next.length ? { after: null, keep: 0, add: next } : null;
  const anchor = prev[prev.length - 1];
  const at = next.lastIndexOf(anchor);
  // The anchor has aged out of the window, or the feed was replaced wholesale.
  // Either way there is no honest tail; the caller owes them a full state.
  if (at < 0 || at + 1 > prev.length) return RESYNC;
  const add = next.slice(at + 1);
  const keep = at + 1;
  if (!add.length && keep === prev.length) return null;
  return { after: (anchor && anchor[key]) ?? null, keep, add };
}

/** The client half of feedTail, kept here so both ends read the same code. */
export function applyFeed(prev, tail) {
  if (!tail) return prev;
  return prev.slice(prev.length - tail.keep).concat(tail.add);
}
