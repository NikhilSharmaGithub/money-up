// "Did you know?" — the place facts under a street's deed (GET /api/facts).
//
// One fetch per page load at most: the last set is kept in localStorage with
// its version and drawn from straight away, then asked for once more. The
// request carries no header of its own — the site and the API are different
// origins, and an If-None-Match would cost a CORS preflight the server does
// not allow — so the browser's HTTP cache does the revalidating, with the
// ETag the server sends, and an unchanged set comes back as a 304 we never
// see. A missing route (an older server), no network or blocked storage all
// mean the same thing — the deed shows no fact — and never an error.

import { api } from './net.js';

const KEY = 'moneymove:facts';

let facts = null;
try {
  const kept = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (kept?.version && kept.places && kept.groups) facts = kept;
} catch { /* blocked or broken storage: fetch it fresh */ }

let loading = null;

/** Fetches (or revalidates) the set once; resolves true when it changed. */
export function loadFacts() {
  if (loading) return loading;
  loading = fetch(api('/api/facts'))
    .then(async (r) => {
      if (!r.ok) return false;
      const body = await r.json();
      if (!body?.version || !body.places || !body.groups) return false;
      const changed = body.version !== facts?.version;
      facts = body;
      if (changed) try { localStorage.setItem(KEY, JSON.stringify(body)); } catch { /* full or blocked */ }
      return changed;
    })
    // Offline: the next deed opened asks again.
    .catch(() => { loading = null; return false; });
  return loading;
}

/**
 * The street's own fact and its country's, for a property tile: looked up by
 * "<name>|<group>" exactly as the board sends them. Either may be missing.
 */
export function factsFor(tile) {
  if (!facts || tile?.type !== 'property' || !tile.group) return null;
  const place = facts.places[`${tile.name}|${tile.group}`] || '';
  const group = facts.groups[tile.group] || '';
  return place || group ? { place, group } : null;
}
