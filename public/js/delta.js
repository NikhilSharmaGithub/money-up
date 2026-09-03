/**
 * The client half of server/delta.js: the applier, and nothing else.
 *
 * A transcription rather than an import — the static root is public/, so
 * nothing under server/ has a URL a browser could ask for. Only the two
 * functions this end actually runs are copied, verbatim; cutting the diff is
 * the server's business and none of ours. If the shape below ever changes,
 * it changes there first and here second.
 *
 * ---------------------------------------------------------------- the shape
 *
 * A patch for an object is an object with up to three members, all optional:
 *
 *   { s: { key: value, ... },   set: this key is now exactly this value
 *     p: { key: patch, ... },   patch: recurse, both sides are objects
 *     d: [ key, ... ] }         drop: this key is gone
 *
 * A missing patch means nothing moved. At the very top `{ $: value }` is a
 * wholesale replacement, which is what arrives if the root ever changes type.
 * Real keys always live inside `s`, `p` or `d`, so a state key called "s" can
 * never be mistaken for the envelope.
 */

/**
 * JSON never carries an `undefined`, so a key holding one is a key the wire
 * would not have sent. Both ends have to agree with the wire on what exists.
 */
const present = (obj, k) => obj[k] !== undefined;

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
 * The log and the chat only ever grow, so they ride as tails instead of
 * through the diff: keep the last `keep` entries you already hold, then
 * append these. `keep` is the server's number, not ours — the window slides,
 * and a viewer with the team channel filtered out of their chat holds a
 * slightly different slice again, so trimming to sixty here by ourselves
 * would let the two drift. Told how many of our own entries survive, we land
 * on precisely the array a full state would have given us.
 */
export function applyFeed(prev, tail) {
  if (!tail) return prev;
  return prev.slice(prev.length - tail.keep).concat(tail.add);
}
