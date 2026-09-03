// Resolves where the realtime server lives, in priority order:
//
//   1. ?server=https://…     — set it from a link, saved for next time
//   2. localStorage          — whatever was entered on the landing page
//   3. window.MONEYMOVE_SERVER from config.js
//   4. same origin           — local runs and single-host deploys
//
// Same origin is the normal case: the game server serves this page too.
//
// Then, at the bottom, what this end says once it gets there: the state
// protocol, which turns a whole board re-sent per action into the little that
// actually moved.

import { applyPatch, applyFeed } from './delta.js';

const KEY = 'moneymove:server';

const clean = (url) => String(url || '').trim().replace(/\/+$/, '');

// A ?server= param wins and is remembered; ?server= (empty) clears the override.
// Storage may be blocked entirely — the override just won't stick then.
const fromQuery = new URLSearchParams(location.search).get('server');
if (fromQuery !== null) {
  const value = clean(fromQuery);
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
}

let stored = '';
try { stored = clean(localStorage.getItem(KEY)); } catch { /* private mode */ }

const isLocalHost = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(location.hostname);

// A checked-in config.js points at the deployed server, which would send a
// local `npm start` off to production. Anything served from localhost talks to
// itself unless someone deliberately overrode the server for that origin.
export const SERVER = stored || (isLocalHost ? '' : clean(window.MONEYMOVE_SERVER));

/**
 * Saves a server override and reloads onto it. A pasted host with no scheme
 * inherits the page's — otherwise a local http server would be dialled over
 * https and fail for no visible reason.
 */
export function useServer(url) {
  const value = clean(url);
  if (!value) return false;
  const scheme = location.protocol === 'http:' ? 'http://' : 'https://';
  const full = /^https?:\/\//i.test(value) ? value : scheme + value;
  try { localStorage.setItem(KEY, clean(full)); } catch { /* ignore */ }
  location.reload();
  return true;
}

export function forgetServer() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  location.reload();
}

/** Absolute URL for an API path, e.g. api('/api/maps'). */
export const api = (path) => `${SERVER}${path}`;

/** Opens a socket against the configured server. */
export const connect = (opts = {}) => (SERVER ? io(SERVER, opts) : io(opts));

export const isSplitDeploy = () => SERVER !== '';

// ─────────────────────────────────────────────────────────── state deltas ──
/**
 * A full state is around 13.5 KB and most of it never moves: the same board,
 * the same group table, the same settings agreed on in the lobby, re-sent
 * thirty-odd times a minute. A socket that says `proto: 2` when it joins gets
 * one whole state at the door and then only what changed.
 *
 * Saying nothing is still allowed, and still means the old thing — a phone
 * holding a build from the App Store, a tab holding last week's bundle, an
 * older server that has never heard of a patch. Every path below falls back
 * to the full 'state' event it was built on, so silence in either direction
 * costs correctness nothing.
 */
export const PROTO = 2;

/** Ask no faster than the server will answer — it drops one per 250 ms. */
const RESYNC_GAP = 300;
/** A dropped ask must not leave the table frozen at the last good patch. */
const RESYNC_RETRY = 1500;

/** feedTail's gap answer, on this side: no honest way to bridge the two. */
const GAP = Symbol('gap');

/**
 * A tail, checked before it is trusted. The anchor is the `at` of our last
 * log line or the `id` of our last chat line; if ours disagrees with the one
 * the server cut against, we would be stitching a hole into our own
 * scrollback, and a fresh state is the only honest way out.
 */
function mendFeed(arr, tail, key) {
  if (!tail) return arr;
  if (!Array.isArray(arr) || tail.keep > arr.length) return GAP;
  const last = arr.length ? arr[arr.length - 1] : null;
  if (((last && last[key]) ?? null) !== (tail.after ?? null)) return GAP;
  return applyFeed(arr, tail);
}

/**
 * Wires both halves of the protocol and hands `onState` the same complete
 * state object the full event carries — rebuilt from the last one if that is
 * all that came over the wire. Nothing downstream can tell the difference.
 *
 * The rebuilt state shares its untouched branches with the previous one, so
 * it must be read and never written to. Everything on this side already
 * treats the state as the server's word, which is what makes that free.
 */
export function onState(socket, onStateFn) {
  let held = null;      // { v, lean, log, chat } — the last state, as cut for us
  let asked = 0;        // when we last put a hand up
  let retry = null;     // the "it never came" nudge

  const settled = () => { clearTimeout(retry); retry = null; };

  // One ask in flight at a time, paced past the server's throttle, and
  // repeated until a whole state actually lands: a patch we had to drop may
  // be the last push this table ever makes, and a silently dropped resync
  // would leave that view stale forever.
  const askResync = () => {
    if (retry) return;
    retry = setTimeout(function send() {
      asked = Date.now();
      socket.emit('resync');
      retry = setTimeout(send, RESYNC_RETRY);
    }, Math.max(0, asked + RESYNC_GAP - Date.now()));
  };

  socket.on('state', (s) => {
    settled();
    const { log, chat, ...lean } = s;
    held = { v: s.version, lean, log, chat };
    onStateFn(s);
  });

  socket.on('statePatch', (msg = {}) => {
    // A patch is only ever right against the exact version it was cut from.
    // Nothing partial, nothing hopeful — ask for the whole thing instead.
    if (!held || msg.from !== held.v) return askResync();

    // Both feeds first, and into locals: if either has gapped we want to be
    // exactly where we were, not half-way through someone else's scrollback.
    const log = mendFeed(held.log, msg.log, 'at');
    const chat = mendFeed(held.chat, msg.chat, 'id');
    if (log === GAP || chat === GAP) return askResync();

    settled();
    const lean = applyPatch(held.lean, msg.patch);
    held = { v: msg.v, lean, log, chat };
    return onStateFn({ ...lean, log, chat });
  });

  // The server keys a viewer's last state by socket id, and reconnecting
  // makes a new one. Drop ours with it, so the reconnect is answered by the
  // full state that always follows a join rather than by a stale base.
  socket.on('disconnect', () => { settled(); held = null; });
}
