// Tournaments: a join window, a knockout bracket, and three prizes.
//
// The shape the owner asked for. People join for five minutes; when the door
// closes everyone is paired off — a hundred entrants make fifty tables, two
// hundred make a hundred — and the winners of those play each other, and so
// on until one is left. First takes the big prize, second the next, third the
// last.
//
// Two things this file deliberately does NOT do.
//
// It does not move money. It records who finished where, and the owner pays
// them. An automated payout is a different kind of system with a different
// kind of blast radius, and nobody should build one as a side effect of a
// bracket. The admin desk shows the list and remembers which ones have been
// settled.
//
// And it does not decide whether a cash prize is legal where the players are.
// It is switched off by default and the switch is the owner's.
//
// Third place is played for, not inferred. Both semi-final losers get one
// more table, at the same time as the final, so nobody is ranked by a
// tiebreak they never agreed to.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { profilesByToken } from './social.js';
import { localiseFor } from './fx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'tournaments.json');

/** Ninety minutes after the last match ends, a finished cup stops being live. */
const KEEP_FINISHED_MS = 90 * 60 * 1000;

const state = {
  enabled: false,          // the owner's switch; hidden on every client until on
  cups: [],                // every cup not yet finished, oldest first
  history: [],             // finished cups, newest first, capped
};

/** As many cups as one person can sensibly run and pay out at once. */
const MAX_LIVE_CUPS = 6;

// ─────────────────────────────────────────────────────────────── storage ──

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    state.enabled = !!raw.enabled;
    // `current` is how a single-cup world wrote itself down; a file from one
    // still opens, as the first of many.
    state.cups = Array.isArray(raw.cups) ? raw.cups : (raw.current ? [raw.current] : []);
    state.history = Array.isArray(raw.history) ? raw.history.slice(0, 50) : [];
    for (const t of state.cups) console.log(`  tournament: restored "${t.name}" (${t.state})`);
  } catch { /* first run */ }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify({
        enabled: state.enabled, cups: state.cups, history: state.history.slice(0, 50),
      }, null, 1));
    } catch (e) { console.warn('tournament: could not save —', e.message); }
  }, 400);
  saveTimer.unref?.();
}
load();

// ───────────────────────────────────────────────────────────────── shape ──

const now = () => Date.now();
const id = () => Math.random().toString(36).slice(2, 8);

/** Every cup still going: announced, taking entries, or being played. */
export const liveCups = () => state.cups;

/** One cup by id, live or finished. */
const cupById = (cupId) => state.cups.find((t) => t.id === cupId)
  || state.history.find((t) => t.id === cupId)
  || null;

/** The cup a match belongs to — matches carry ids of their own. */
function cupOfMatch(matchId) {
  for (const t of state.cups) {
    for (const r of t.rounds) if (r.matches.some((m) => m.id === matchId)) return t;
  }
  return null;
}

/** The cup whose table this room was made for. */
function cupOfRoom(roomId) {
  for (const t of state.cups) {
    for (const r of t.rounds) if (r.matches.some((m) => m.roomId === roomId)) return t;
  }
  return null;
}

/** Every cup this player has a stake in, live or just finished. */
const cupsOf = (token) => (token
  ? [...state.cups, ...state.history].filter((t) => t.entrants.some((e) => e.token === token))
  : []);

/** A cup as a client should see it — never a token, only public codes. */
/** How long a finished cup stays on the players' screens. */
const SHOW_RESULT_MS = 10 * 60 * 1000;

/**
 * What one player should see.
 *
 * With several cups running there is still only room for one card, so this
 * picks the one that matters most to the reader — the one they are playing
 * in, then the one they have joined, then the soonest they could join — and
 * hands back the rest as a short list they can flick through.
 */
export function publicView(token, wantId) {
  if (!state.enabled) return { enabled: false, cup: null, others: [] };
  const mine = new Set(cupsOf(token).map((t) => t.id));
  const shown = [
    ...state.cups,
    // A cup that has just been won is still the most interesting thing on the
    // page. Clearing it the instant the final ends means the winner never
    // sees that they won — the card simply vanishes at the moment it matters.
    ...state.history.filter((h) => h.endedAt && !h.cancelled && now() - h.endedAt < SHOW_RESULT_MS
      && mine.has(h.id)),
  ];
  if (!shown.length) return { enabled: true, cup: null, others: [] };

  // Lower sorts first: your live game, then yours, then whatever opens next.
  const rank = (t) => {
    const yours = mine.has(t.id);
    if (yours && t.state === 'running') return 0;
    if (yours && t.state === 'joining') return 1;
    if (yours) return 2;
    if (t.state === 'joining') return 3;
    if (t.state === 'scheduled') return 4;
    return 5;
  };
  const ordered = [...shown].sort((a, b) => rank(a) - rank(b) || a.openedAt - b.openedAt);
  const t = (wantId && ordered.find((x) => x.id === wantId)) || ordered[0];

  return {
    enabled: true,
    cup: cupView(t, token),
    // Enough for a row each: name, what it is doing, and when.
    others: ordered.filter((x) => x.id !== t.id).map((x) => ({
      id: x.id,
      name: x.name,
      state: x.state,
      openedAt: x.openedAt,
      closesAt: x.closesAt,
      entrants: x.entrants.length,
      maxPlayers: x.maxPlayers || 0,
      joined: mine.has(x.id),
      needsCode: !!x.joinCode,
    })),
  };
}

function cupView(t, token) {
  const mine = token ? t.entrants.find((e) => e.token === token) : null;
  const match = mine ? liveMatchFor(t, token) : null;
  return {
    id: t.id,
    name: t.name,
    state: t.state,
    prize: t.prize,
    // The same prize in the reader's own money, when we know a rate for
    // the country they fly. Null for everybody else, and the card falls
    // back to the owner's figure — see fx.js on why nothing is invented.
    local: localPrize(t, token),
    // Both ends of the join window: the card draws a bar that drains, and a
    // bar needs to know how long the whole thing was.
    openedAt: t.openedAt,
    closesAt: t.closesAt,
    entrants: t.entrants.length,
    maxPlayers: t.maxPlayers || 0,
    // Whether a code is wanted, never the code itself: an invite-only cup
    // whose code any client could read is not invite-only.
    needsCode: !!t.joinCode,
    rounds: t.rounds.length,
    // The bracket, with names rather than identities.
    round: t.rounds.length ? roundView(t, t.rounds.length - 1) : null,
    standings: t.standings || null,
    you: mine ? {
      joined: true,
      code: mine.code,
      name: mine.name,
      out: !!mine.out,
      placed: mine.placed || null,
      // Where to go, the moment there is somewhere to go.
      roomId: match?.roomId || null,
      opponent: match ? nameOf(t, match.a === token ? match.b : match.a) : null,
      // How far they have come and how many are left with them. This is
      // the whole story of a knockout from one player's seat, and it is
      // four numbers rather than the entire bracket.
      ...standing(t, token),
    } : { joined: false },
  };
}

/**
 * Where one player stands: rounds survived, how many are left in the cup
 * beside them, and what the round they are in is called. The card draws a
 * ladder from this without ever asking for the whole bracket.
 */
function standing(t, token) {
  let survived = 0;
  let currentRound = null;
  for (let i = 0; i < t.rounds.length; i++) {
    const m = t.rounds[i].matches.find((x) => x.a === token || x.b === token);
    if (!m) continue;
    currentRound = i;
    if (m.state === 'done' && m.winner === token) survived++;
  }
  return {
    survived,
    round: currentRound == null ? null : currentRound + 1,
    roundLabel: currentRound == null ? null : roundLabel(t.rounds[currentRound]),
    // Everyone still capable of winning it, this player included.
    left: t.entrants.filter((e) => !e.out).length,
  };
}

/** "Final", "Semi-finals", "Round of 64" — what this depth is called. */
function roundLabel(r) {
  if (!r) return '';
  if (r.kind === 'thirdPlace') return 'Third place';
  const players = playersIn(r);
  if (r.kind === 'final' || players === 2) return 'Final';
  if (players <= 4) return 'Semi-finals';
  if (players <= 8) return 'Quarter-finals';
  return `Round of ${players}`;
}

const playersIn = (r) => r.matches.reduce((n, m) => n + (m.a ? 1 : 0) + (m.b ? 1 : 0), 0);

/**
 * The whole bracket, on request.
 *
 * Not part of the card's poll: two hundred entrants make two hundred matches,
 * and re-sending all of them every four seconds to draw a card that shows a
 * countdown would be silly. A player opens the chart, this answers once, and
 * it answers again when they pull to refresh.
 */
export function bracketView(token, cupId) {
  if (!state.enabled) return { enabled: false, bracket: null };
  const t = (cupId && cupById(cupId))
    || state.cups[0]
    || state.history.find((h) => h.endedAt && now() - h.endedAt < SHOW_RESULT_MS)
    || null;
  if (!t) return { enabled: true, bracket: null };
  const mine = token ? t.entrants.find((e) => e.token === token) : null;
  return {
    enabled: true,
    bracket: {
      id: t.id,
      name: t.name,
      state: t.state,
      prize: t.prize,
      local: localPrize(t, token),
      entrants: t.entrants.length,
      you: mine ? { code: mine.code, name: mine.name, out: !!mine.out, placed: mine.placed || null }
        : null,
      standings: t.standings || null,
      rounds: t.rounds.map((r, i) => ({
        n: i + 1,
        kind: r.kind,
        label: roundLabel(r),
        players: playersIn(r),
        matches: r.matches.map((m) => ({
          a: m.a ? nameOf(t, m.a) : null,
          b: m.b ? nameOf(t, m.b) : null,
          aScore: m.aScore ?? null,
          bScore: m.bScore ?? null,
          state: m.state,
          winner: m.winner ? nameOf(t, m.winner) : null,
          walkover: !!m.walkover,
          void: !!m.void,
          // The one match on this row that belongs to the person reading it.
          mine: !!token && (m.a === token || m.b === token),
        })),
      })),
    },
  };
}

/** The three prizes, converted for whoever is reading, or null. */
function localPrize(t, token) {
  const flag = token ? profilesByToken(token)?.flag : '';
  if (!flag) return null;
  return localiseFor(flag, {
    first: t.prize.first, second: t.prize.second, third: t.prize.third,
  }, t.prize.currency || 'USD');
}

function roundView(t, n) {
  const r = t.rounds[n];
  if (!r) return null;
  return {
    n: n + 1,
    kind: r.kind,
    matches: r.matches.map((m) => ({
      a: nameOf(t, m.a), b: nameOf(t, m.b),
      state: m.state, winner: m.winner ? nameOf(t, m.winner) : null,
    })),
  };
}

const nameOf = (t, token) => (token ? t.entrants.find((e) => e.token === token)?.name || '—' : 'bye');

/** The match this player is meant to be playing right now, if any. */
function liveMatchFor(t, token) {
  for (const r of t.rounds) {
    for (const m of r.matches) {
      if (m.state !== 'playing') continue;
      if (m.a === token || m.b === token) return m;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────── owner ──

/**
 * The owner's desk. Deliberately NOT the raw cup: an entrant record carries
 * the player's identity token, and that token is the whole account. The desk
 * is behind a key, but a desk gets screenshotted, so nothing leaves here that
 * would let a reader play as somebody else. Friend codes and names are what
 * the owner actually needs to pay a winner.
 */
export function ownerView() {
  return {
    enabled: state.enabled,
    cups: state.cups.map(scrub),
    history: state.history.slice(0, 20).map(scrub),
  };
}

function scrub(t) {
  return {
    id: t.id,
    name: t.name,
    state: t.state,
    prize: t.prize,
    maxPlayers: t.maxPlayers || 0,
    joinCode: t.joinCode || '',
    openedAt: t.openedAt,
    closesAt: t.closesAt,
    endedAt: t.endedAt || null,
    abandoned: !!t.abandoned,
    paid: t.paid || {},
    standings: t.standings || null,
    entrants: t.entrants.map((e) => ({
      code: e.code, name: e.name, out: !!e.out, placed: e.placed || null,
    })),
    rounds: t.rounds.map((r) => ({
      kind: r.kind,
      matches: r.matches.map((m) => ({
        a: nameOf(t, m.a), b: nameOf(t, m.b),
        state: m.state, roomId: m.roomId || null,
        winner: m.winner ? nameOf(t, m.winner) : null,
        walkover: !!m.walkover, void: !!m.void,
      })),
    })),
  };
}

export function setEnabled(on) {
  state.enabled = !!on;
  save();
  return { ok: true, enabled: state.enabled };
}

/**
 * Open a cup. Only one at a time — two open join windows is a way to split a
 * hundred players into two halves of fifty and pay out twice.
 */
// A prize that was left blank is the house default, not NaN — Number('') is 0
// and Number(undefined) is NaN, and neither of those is what ?? catches.
function money(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

/**
 * Open a cup, or announce one for later.
 *
 * `opensAt` is when the doors open. Left out, or already past, they open on
 * the spot — the way this worked before. Set to a time in the future, the cup
 * is announced instead: everybody can see it and count down to it, nobody can
 * enter yet, and the doors open themselves when the moment arrives.
 *
 * Announcing matters more than it looks. A cup that opens the second the
 * owner presses a button is only ever played by whoever happens to be online
 * at that second; one announced for Sunday at eight can be turned up for.
 */
export function openCup({ name, joinSeconds, prize, opensAt, maxPlayers, joinCode } = {}) {
  if (state.cups.length >= MAX_LIVE_CUPS) {
    return { error: `That is ${MAX_LIVE_CUPS} cups at once — finish or delete one first` };
  }
  const t = {
    id: id(),
    name: String(name || 'MoneyMove Cup').slice(0, 40),
    state: 'joining',
    prize: { currency: 'USD', first: 200, second: 100, third: 50 },
    maxPlayers: 0,
    joinCode: '',
    announcedAt: now(),
    openedAt: now(),
    closesAt: now() + 300 * 1000,
    entrants: [],
    rounds: [],
    standings: null,
    paid: {},
  };
  state.cups.push(t);
  applySettings(t, { name, joinSeconds, prize, opensAt, maxPlayers, joinCode });
  save();
  return { ok: true, cup: t };
}

/**
 * Change a cup that has not started playing: its name, when joining opens,
 * how long it stays open, the limit, the code, the prizes. Everybody who has
 * already joined stays joined — moving an hour should not cost you your field.
 */
export function updateCup(cupId, settings = {}) {
  const t = state.cups.find((x) => x.id === cupId);
  if (!t) return { error: 'No such cup' };
  if (t.state !== 'scheduled' && t.state !== 'joining') {
    return { error: 'This one has already started playing' };
  }
  applySettings(t, settings);
  save();
  return { ok: true, updated: true, cup: t };
}

/** The settings a cup takes, in one place, so create and edit cannot drift. */
function applySettings(t, { name, joinSeconds, prize, opensAt, maxPlayers, joinCode } = {}) {
  const secs = Math.max(30, Math.min(30 * 86400, Math.floor(Number(joinSeconds) || 300)));
  const wanted = Number(opensAt) || 0;
  // A minute's grace, so "in a moment" is not an announcement nobody sees.
  const scheduled = wanted > now() + 60 * 1000;
  const opens = scheduled ? wanted : now();

  if (name != null) t.name = String(name).slice(0, 40);
  if (prize) {
    t.prize = {
      currency: String(prize.currency || t.prize.currency).slice(0, 4),
      first: money(prize.first, t.prize.first),
      second: money(prize.second, t.prize.second),
      third: money(prize.third, t.prize.third),
    };
  }
  // Nought means no limit. A cup with a limit stops taking entries when it is
  // full, which is the only way to promise a field of a given size.
  if (maxPlayers != null) t.maxPlayers = Math.max(0, Math.min(5000, Math.floor(Number(maxPlayers) || 0)));
  // A code makes a cup invite-only. Empty means anyone signed in may join.
  if (joinCode != null) t.joinCode = String(joinCode).trim().slice(0, 16);
  t.openedAt = opens;
  t.closesAt = opens + secs * 1000;
  t.state = scheduled ? 'scheduled' : 'joining';
}

/** Second thoughts: let people start joining before the announced minute. */
export function openDoorsNow(cupId) {
  const t = state.cups.find((x) => x.id === cupId) || null;
  if (!t || t.state !== 'scheduled') return { error: 'No announced cup to open' };
  const kept = t.closesAt - t.openedAt;   // the window keeps its length
  t.openedAt = now();
  t.closesAt = now() + kept;
  t.state = 'joining';
  save();
  return { ok: true, cup: t };
}

/** Delete a cup. Everyone in it is dropped and nothing is paid. */
export function cancelCup(cupId) {
  const i = cupId
    ? state.cups.findIndex((t) => t.id === cupId)
    : (state.cups.length ? 0 : -1);
  if (i < 0) return { error: 'No such cup' };
  const [t] = state.cups.splice(i, 1);
  t.state = 'done';
  t.cancelled = true;
  t.endedAt = now();
  state.history.unshift(t);
  save();
  return { ok: true, cup: scrub(t) };
}

/** Mark a placing as settled, so the desk stops asking to pay it twice. */
export function markPaid(cupId, place) {
  const cup = cupById(cupId);
  if (!cup) return { error: 'No such cup' };
  if (!['first', 'second', 'third'].includes(place)) return { error: 'Unknown place' };
  cup.paid ??= {};
  cup.paid[place] = now();
  save();
  return { ok: true, paid: cup.paid };
}

// ────────────────────────────────────────────────────────────── entrants ──

/**
 * Take a seat in the cup.
 *
 * A real prize needs a real person to hand it to, so entry needs an account —
 * the same reason the daily coin does, only more so. A device identity costs
 * a private window, and a bracket paid in dollars is exactly the thing
 * somebody would open forty windows for.
 */
/** Codes are compared the way people type them: trimmed, any case. */
const sameCode = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

export function join(token, code, cupId) {
  if (!state.enabled) return { error: 'No cup is open' };
  const t = cupId ? state.cups.find((x) => x.id === cupId) : state.cups[0];
  if (!t) return { error: 'No cup is open' };
  if (t.state === 'scheduled') {
    return { error: 'Not open yet — joining opens at the announced time', notYet: true };
  }
  if (t.state !== 'joining') return { error: 'Joining has closed on this one' };
  // No account at all and an account with no sign-in are the same answer to
  // the person reading it: a prize needs somebody it can actually be paid to.
  const p = profilesByToken(token);
  if (!p || !p.login) return { error: 'Sign in to enter — a prize needs somebody to pay', needsLogin: true };
  if (t.entrants.some((e) => e.token === token)) return { ok: true, already: true, entrants: t.entrants.length };
  // One cup at a time. Two live cups can draw a table for the same person in
  // the same minute, and being pulled between two games is nobody's idea of a
  // tournament. Finish the one you are in, or leave it.
  const busy = state.cups.find((x) => x.id !== t.id && x.entrants.some((e) => e.token === token && !e.out));
  if (busy) {
    return { error: `You are already in "${busy.name}" — leave that one first`, alreadyIn: busy.id };
  }
  if (t.maxPlayers && t.entrants.length >= t.maxPlayers) {
    return { error: 'This one is full', full: true };
  }
  if (t.joinCode && !sameCode(t.joinCode, code)) {
    return {
      error: code ? 'That code does not match' : 'This one needs a join code',
      needsCode: true,
    };
  }
  t.entrants.push({ token, code: p.code, name: p.name || 'Player', joinedAt: now() });
  save();
  return { ok: true, entrants: t.entrants.length, cupId: t.id };
}

export function leave(token, cupId) {
  const t = cupId
    ? state.cups.find((x) => x.id === cupId)
    : state.cups.find((x) => x.entrants.some((e) => e.token === token));
  if (!t || t.state !== 'joining') return { error: 'Too late to withdraw' };
  const before = t.entrants.length;
  t.entrants = t.entrants.filter((e) => e.token !== token);
  save();
  return { ok: true, left: before !== t.entrants.length };
}

// ─────────────────────────────────────────────────────────────── bracket ──

/** Fisher-Yates, so the draw is a draw and not the order people arrived in. */
function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pair whoever is left into tables. An odd one out gets a bye — not a random
 * gift: the bye goes to whoever has played the most so far, so the person who
 * has already earned their place is the one who gets to rest.
 */
function pairUp(tokens, playedCount) {
  const draw = shuffled(tokens);
  let bye = null;
  if (draw.length % 2 === 1) {
    draw.sort((x, y) => (playedCount.get(y) || 0) - (playedCount.get(x) || 0));
    bye = draw.shift();
  }
  const matches = [];
  for (let i = 0; i < draw.length; i += 2) {
    matches.push({ id: id(), a: draw[i], b: draw[i + 1], roomId: null, state: 'pending', winner: null });
  }
  return { matches, bye };
}

const playedCounts = (t) => {
  const c = new Map();
  for (const r of t.rounds) for (const m of r.matches) {
    if (m.a) c.set(m.a, (c.get(m.a) || 0) + 1);
    if (m.b) c.set(m.b, (c.get(m.b) || 0) + 1);
  }
  return c;
};

/**
 * The join window ran out. Draw the first round.
 *
 * Fewer than two entrants is not a cup; it is one person and a prize, so it
 * is cancelled rather than awarded.
 */
export function closeDoor(cupId) {
  const t = cupId
    ? state.cups.find((x) => x.id === cupId)
    : state.cups.find((x) => x.state === 'joining');
  if (!t || t.state !== 'joining') return { error: 'Nothing is taking entries' };
  if (t.entrants.length < 2) {
    retire(t, { cancelled: true, reason: 'not enough entrants' });
    save();
    return { ok: true, cancelled: true };
  }
  t.state = 'running';
  drawRound(t, t.entrants.map((e) => e.token), 'round');
  save();
  return { ok: true, matches: t.rounds[0].matches.length };
}

function drawRound(t, tokens, kindHint) {
  // Two left is the final, whatever the caller thought it was drawing. With
  // exactly two entrants that is the very first round — a cup of two is one
  // match — and calling it anything else left the bracket with no final to
  // finish on, which is how a two-player cup used to hang forever.
  const kind = tokens.length === 2 ? 'final' : (kindHint || 'round');
  const { matches, bye } = pairUp(tokens, playedCounts(t));
  t.rounds.push({ kind, matches, bye, at: now() });
  // A bye is a walkover: it is recorded as a match nobody had to play, so the
  // bracket reads honestly rather than quietly promoting somebody.
  if (bye) t.rounds[t.rounds.length - 1].matches.push({
    id: id(), a: bye, b: null, roomId: null, state: 'done', winner: bye, walkover: true,
  });
}

/** Every match in the newest round that still needs a table. */
export function matchesNeedingRooms() {
  const out = [];
  for (const t of state.cups) {
    if (t.state !== 'running') continue;
    for (const r of t.rounds) {
      for (const m of r.matches) {
        if (m.state === 'pending' && m.a && m.b) out.push(m);
      }
    }
  }
  return out;
}

/** The match a room was made for, if the room is a cup table at all. */
export function matchByRoom(roomId) {
  if (!roomId) return null;
  for (const t of state.cups) {
    for (const r of t.rounds) for (const m of r.matches) {
      if (m.roomId === roomId && m.state === 'playing') return m.id;
    }
  }
  return null;
}

/**
 * Is this player one of the two drawn for that match? The seat check at the
 * door — a forwarded link must not put a third person in a cup game.
 */
export function mayPlay(matchId, token) {
  const t = cupOfMatch(matchId);
  if (!t) return false;
  for (const r of t.rounds) for (const m of r.matches) {
    if (m.id === matchId) return m.a === token || m.b === token;
  }
  return false;
}

/** The server made a table for this match; remember where it is. */
export function matchStarted(matchId, roomId) {
  const t = cupOfMatch(matchId);
  if (!t) return;
  for (const r of t.rounds) for (const m of r.matches) {
    if (m.id === matchId) {
      m.roomId = roomId;
      m.state = 'playing';
      m.startedAt = now();   // the clock a no-show is measured against
      save();
      return;
    }
  }
}

/**
 * A cup table finished. Advance whoever won, and when a round is complete,
 * draw the next one — or, when only the final and its play-off are left,
 * write the standings.
 */
export function matchFinished(roomId, winnerToken, worth = null) {
  const t = cupOfRoom(roomId);
  if (!t || t.state !== 'running') return null;
  const found = liveMatchInRoom(t, roomId);
  if (!found) return null;
  const { m } = found;
  // What each side was worth at the end. The bracket reads better with a
  // scoreline than with two bare names, and this game's score is net worth.
  if (worth) {
    if (m.a && worth[m.a] != null) m.aScore = Math.round(worth[m.a]);
    if (m.b && worth[m.b] != null) m.bScore = Math.round(worth[m.b]);
  }
  // A winner the server does not recognise (a bot, a spectator) is treated as
  // nobody winning, and the match is decided the only honest way left: not at
  // all. It stays open for the owner to void.
  const winner = [m.a, m.b].includes(winnerToken) ? winnerToken : null;
  if (!winner) return null;
  return decide(t, found, winner);
}

/**
 * Nobody came, or only one did.
 *
 * A table whose players never turned up would otherwise hold up everybody
 * else's cup for ever, so the server sweeps for them: whoever showed wins by
 * walkover, and a table neither of them opened is void — the entrants are
 * out and the bracket carries on a place short. Pass null for that.
 */
export function forfeit(roomId, winnerToken = null) {
  const t = cupOfRoom(roomId);
  if (!t || t.state !== 'running') return null;
  const found = liveMatchInRoom(t, roomId);
  if (!found) return null;
  const { m } = found;
  const winner = [m.a, m.b].includes(winnerToken) ? winnerToken : null;
  m.walkover = true;
  return decide(t, found, winner, { void: !winner });
}

/** Every playing match, with the time its table opened. For the sweeper. */
export function playingMatches() {
  const out = [];
  for (const t of state.cups) {
    if (t.state !== 'running') continue;
    for (const r of t.rounds) for (const m of r.matches) {
      if (m.state === 'playing' && m.roomId) {
        out.push({ id: m.id, roomId: m.roomId, a: m.a, b: m.b, startedAt: m.startedAt || 0 });
      }
    }
  }
  return out;
}

function liveMatchInRoom(t, roomId) {
  for (const r of t.rounds) for (const m of r.matches) {
    if (m.roomId === roomId && m.state === 'playing') return { r, m };
  }
  return null;
}

/** Write a result down and, if that completes the round, draw the next one. */
function decide(t, { r, m }, winner, { void: voided = false } = {}) {
  m.winner = winner;
  m.state = 'done';
  m.void = voided || undefined;
  // Everyone at that table who is not the winner is out of the cup — which,
  // for a void match, is both of them.
  for (const token of [m.a, m.b]) {
    if (!token || token === winner) continue;
    const entrant = t.entrants.find((e) => e.token === token);
    if (entrant) entrant.out = true;
  }
  save();

  if (r.matches.some((x) => x.state !== 'done')) return { advanced: winner };
  advanceFrom(t, r);
  save();
  return { advanced: winner, roundComplete: true };
}

function advanceFrom(t, round) {
  const winners = round.matches.map((m) => m.winner).filter(Boolean);
  // Only a match somebody won has a loser: a void table has two people who
  // are out and nobody who was beaten.
  const losers = round.matches
    .filter((m) => m.winner)
    .map((m) => (m.winner === m.a ? m.b : m.a))
    .filter(Boolean);

  // The two rounds that end a cup. Either can land first — the play-off runs
  // beside the final — so both ask whether everything needed is in.
  if (round.kind === 'final' || round.kind === 'thirdPlace') return finish(t);

  // Two winners means the round just played was the semi-final: the final is
  // drawn from them, and its losers get the third-place table alongside it,
  // so nobody is ranked third by a tiebreak they never agreed to.
  if (winners.length === 2) {
    const { matches } = pairUp(winners, playedCounts(t));
    t.rounds.push({ kind: 'final', matches, at: now() });
    if (losers.length === 2) {
      const playoff = pairUp(losers, playedCounts(t));
      t.rounds.push({ kind: 'thirdPlace', matches: playoff.matches, at: now() });
    } else if (losers.length === 1) {
      // A bye carried somebody into the final, so only one person actually
      // lost at this depth. There is nobody to play off against and no
      // tiebreak to invent: they are third.
      t.thirdByDefault = losers[0];
    }
    return;
  }
  // Nobody came to any table in the round. There is no winner to invent, so
  // the cup ends unwon and the owner sees it that way.
  if (!winners.length) return abandon(t);
  // One winner and no final drawn: a bye carried somebody all the way, which
  // only happens in very small cups. They have won it.
  if (winners.length === 1) return finish(t, winners[0]);
  drawRound(t, winners, 'round');
}

function finish(t, soleWinner = null) {
  const final = [...t.rounds].reverse().find((r) => r.kind === 'final');
  const playoff = [...t.rounds].reverse().find((r) => r.kind === 'thirdPlace');
  const fm = final?.matches?.[0];
  // Nobody played a final — a bye carried the last one home.
  if (!fm && soleWinner) {
    t.standings = { first: entrantCard(t, soleWinner), second: null, third: null };
    const e = t.entrants.find((x) => x.token === soleWinner);
    if (e) e.placed = 'first';
    retire(t);
    save();
    return;
  }
  if (!fm || fm.state !== 'done') return;
  // The final itself was void — neither finalist turned up. Nobody is first,
  // and second is not a thing you can be behind nobody.
  if (!fm.winner) return abandon(t);
  // The play-off is allowed to still be running: the final decides the cup,
  // and third place lands when it lands.
  const pm = playoff?.matches?.[0];
  if (pm && pm.state !== 'done') return;

  const first = fm.winner;
  const second = fm.winner === fm.a ? fm.b : fm.a;
  const third = pm?.winner || t.thirdByDefault || null;
  t.standings = {
    first: entrantCard(t, first),
    second: entrantCard(t, second),
    third: third ? entrantCard(t, third) : null,
  };
  for (const [place, who] of Object.entries({ first, second, third })) {
    const e = t.entrants.find((x) => x.token === who);
    if (e) e.placed = place;
  }
  retire(t);
  save();
}

/** A cup's last act: off the live list, on to the history, with a reason. */
function retire(t, extra = {}) {
  Object.assign(t, extra, { state: 'done', endedAt: now() });
  const i = state.cups.indexOf(t);
  if (i >= 0) state.cups.splice(i, 1);
  state.history.unshift(t);
}

/** A cup nobody finished. Recorded honestly rather than awarded to anyone. */
function abandon(t) {
  t.standings = { first: null, second: null, third: null };
  retire(t, { abandoned: true });
  save();
}

const entrantCard = (t, token) => {
  const e = t.entrants.find((x) => x.token === token);
  return e ? { code: e.code, name: e.name } : null;
};

/** Housekeeping the server calls on a timer: shut the door when time is up. */
export function tick() {
  if (!state.enabled) return { closed: false };
  let closed = false;
  // Each cup keeps its own clock: one opens itself at the appointed minute,
  // another shuts its list and draws, and they do not wait for each other.
  for (const t of [...state.cups]) {
    if (t.state === 'scheduled' && now() >= t.openedAt) {
      t.state = 'joining';
      save();
      console.log(`cup: "${t.name}" opened for joining on schedule`);
    }
    if (t.state === 'joining' && now() >= t.closesAt) {
      closeDoor(t.id);
      closed = true;
    }
  }
  return { closed };
}

/** Old finished cups stop being interesting; the list is not a ledger. */
export function prune() {
  const cut = now() - KEEP_FINISHED_MS;
  const before = state.history.length;
  state.history = state.history.filter((h) => !h.endedAt || h.endedAt > cut).slice(0, 50);
  if (state.history.length !== before) save();
}

export const isEnabled = () => state.enabled;
/** The first cup still going. Handy when there is only one, which is usual. */
export const currentCup = () => state.cups[0] || null;
