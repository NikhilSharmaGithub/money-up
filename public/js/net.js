// Resolves where the realtime server lives, in priority order:
//
//   1. ?server=https://…     — set it from a link, saved for next time
//   2. localStorage          — whatever was entered on the landing page
//   3. window.MONEYMOVE_SERVER from config.js
//   4. same origin           — local runs and single-host deploys
//
// Same origin is the normal case: the game server serves this page too.

const KEY = 'moneymove:server';

const clean = (url) => String(url || '').trim().replace(/\/+$/, '');

// A ?server= param wins and is remembered; ?server= (empty) clears the override.
const fromQuery = new URLSearchParams(location.search).get('server');
if (fromQuery !== null) {
  const value = clean(fromQuery);
  if (value) localStorage.setItem(KEY, value);
  else localStorage.removeItem(KEY);
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
