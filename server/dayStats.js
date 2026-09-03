// Who actually played, day by day.
//
// The profile count answers "how many browsers have ever touched us", which
// is not the question the owner is asking. This module keeps the other book:
// for each calendar day, the distinct human players who finished a game on
// it, and how many games those were. It is a plain object living inside
// stats.json — { 'YYYY-MM-DD': { players: ['9XE9KN', ...], games: 3 } } —
// so it persists through DATA_DIR with everything else and needs no schema.
//
// Everything here is a pure function over that object so the recording rule
// can be tested without booting a server or finishing a real game.

/** Days kept on disk. Three months is plenty of history for one operator. */
export const DAYS_KEPT = 90;
/** Codes remembered per day. A day busier than this is a happy problem. */
const CODES_PER_DAY = 400;

const pad = (n) => String(n).padStart(2, '0');

/** Server-local calendar date as a key: same day, same string. */
export function dayKey(when = Date.now()) {
  const d = new Date(when);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of a key, in ms — what a chart needs to label an axis. */
export function dayKeyStart(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

/** The n calendar days ending today, oldest first. */
export function lastDayKeys(n, now = Date.now()) {
  const keys = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(dayKey(d));
  }
  return keys;
}

/**
 * Record one finished game: bump the day's game count and add every human
 * who was still seated, deduped. Codes only — the identity token never
 * leaves the process, and a bot has no code to add.
 */
export function noteGameDay(stats, codes, when = Date.now(), keep = DAYS_KEPT) {
  if (!stats) return null;
  const days = (stats.days ||= {});
  const key = dayKey(when);
  const day = (days[key] ||= { players: [], games: 0 });
  if (!Array.isArray(day.players)) day.players = [];
  // Both fields are guarded the same way: a hand-edited or half-written
  // stats.json must not turn the tally into string concatenation, which is
  // what `'x' + 1` quietly does for the rest of the day.
  day.games = (Number(day.games) || 0) + 1;
  const seen = new Set(day.players);
  for (const raw of codes || []) {
    const code = String(raw || '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    day.players.push(code);
  }
  if (day.players.length > CODES_PER_DAY) {
    day.players.splice(0, day.players.length - CODES_PER_DAY);
  }
  // Keep the file bounded: the oldest days fall off the back. Sorting keys
  // as strings is a real date sort — that is what YYYY-MM-DD is for.
  const keys = Object.keys(days).sort();
  if (keys.length > keep) {
    for (const k of keys.slice(0, keys.length - keep)) delete days[k];
  }
  return day;
}

/**
 * The last n days as a chart-ready series, oldest first. Missing days are
 * zeroes, not gaps — a quiet Tuesday is data.
 */
export function daySeries(stats, n = 30, now = Date.now()) {
  const days = (stats && stats.days) || {};
  return lastDayKeys(n, now).map((key) => {
    const d = days[key] || null;
    return {
      key,
      at: dayKeyStart(key),
      players: d && Array.isArray(d.players) ? d.players.length : 0,
      games: d ? (d.games || 0) : 0,
      // Whether this day was ever written to. A day the book never saw is
      // not the same claim as a day with nothing in it, and the dashboard
      // needs to tell them apart while this book is still filling up.
      recorded: !!d,
    };
  });
}

/** Distinct codes seen across the last n days — the "played this week" set. */
export function playersSince(stats, n, now = Date.now()) {
  const days = (stats && stats.days) || {};
  const seen = new Set();
  for (const key of lastDayKeys(n, now)) {
    for (const code of (days[key] && days[key].players) || []) seen.add(code);
  }
  return seen;
}

/** Bucket a list of timestamps into the given day keys — one count per day. */
export function bucketByDay(keys, timestamps) {
  const idx = new Map(keys.map((k, i) => [k, i]));
  const counts = keys.map(() => 0);
  for (const t of timestamps || []) {
    if (!t) continue;
    const i = idx.get(dayKey(t));
    if (i != null) counts[i]++;
  }
  return counts;
}
