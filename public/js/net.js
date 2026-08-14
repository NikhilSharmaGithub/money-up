// Resolves where the realtime server lives. Empty config means "same origin",
// which is what a local `npm start` and any single-host deploy use.

export const SERVER = String(window.MONEYMOVE_SERVER || '').replace(/\/+$/, '');

/** Absolute URL for an API path, e.g. api('/api/maps'). */
export const api = (path) => `${SERVER}${path}`;

/** Opens a socket against the configured server. */
export const connect = (opts = {}) => (SERVER ? io(SERVER, opts) : io(opts));

export const isSplitDeploy = () => SERVER !== '';
