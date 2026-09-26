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

/**
 * A cup with a schedule plays its rounds at set times of day rather than the
 * moment the last one finishes.
 *
 * Two hundred people cannot be asked to sit at their phones for two straight
 * hours while seven rounds grind through. They can be asked to turn up at
 * eight and again at ten. So a round opens at its appointed minute, stays
 * open for a short window, and anybody who does not turn up inside it is out
 * — which is the only rule that makes a scheduled bracket finish at all.
 */
const DEFAULT_SCHEDULE = {
  // Minutes past local midnight. Two a day, at eight and at ten.
  times: [20 * 60, 22 * 60],
  // How long a round's door stays open. Miss it and you are out.
  windowMinutes: 10,
  // How long a cup game may run. A property game has no natural length —
  // two careful players can trade and mortgage for hours — and a tournament
  // needs one, so at the whistle the richer player goes through.
  matchMinutes: 90,
  // The owner's own clock, so "20:00" means eight in the evening where they
  // are rather than eight at Greenwich. Sent from the desk's browser.
  offsetMinutes: 0,
};

/** The next scheduled slot strictly after `from`, as an instant. */
function nextSlot(schedule, from) {
  const sch = { ...DEFAULT_SCHEDULE, ...(schedule || {}) };
  const times = (sch.times || []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!times.length) return null;
  const offset = Number(sch.offsetMinutes) || 0;
  // Work in the owner's local minutes, then come back to an instant.
  const local = from + offset * 60000;
  const dayStart = Math.floor(local / 86400000) * 86400000;
  const minutesIn = (local - dayStart) / 60000;
  for (const t of times) {
    if (t > minutesIn) return dayStart + t * 60000 - offset * 60000;
  }
  // Nothing left today: the first slot tomorrow.
  return dayStart + 86400000 + times[0] * 60000 - offset * 60000;
}

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

// ─────────────────────────────────────────────────────────────── the clock ──
// A cup is measured in hours — a door at eight, a whistle ninety minutes into
// a game — and a test that proves a whole one end to end cannot sit through
// that. So a process started with MONEYMOVE_TEST_HOOKS=1 may wind this clock
// forward, and only such a process: never one on Render, never one running in
// production, whatever else is set. Everything a cup decides by reads the time
// from here — doors, windows, whistles, and the sweeper in index.js — so
// winding it walks the real code through the real sequence rather than a
// stand-in for it. Anywhere real the skew is nought and nothing can move it.

/** Whether this process may wind the cup clock. Decided once, at boot. */
export const testHooks = process.env.MONEYMOVE_TEST_HOOKS === '1'
  && !process.env.RENDER && process.env.NODE_ENV !== 'production';

let skew = 0;
const now = () => Date.now() + skew;

/** The time every cup decision is made against. The wall clock, in production. */
export const clock = () => now();

/** Test runs only: move the cup clock forward. Refused everywhere else. */
export function windClock(ms) {
  if (!testHooks) return { error: 'Unknown action' };
  skew += Math.max(0, Math.min(7 * 86400000, Math.floor(Number(ms) || 0)));
  return { ok: true, now: now() };
}

// ───────────────────────────────────────────────────────────────── shape ──

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
export function publicView(token, wantId, { seated = () => false } = {}) {
  if (!state.enabled) return { enabled: false, cup: null, others: [], table: null };
  const mine = new Set(cupsOf(token).map((t) => t.id));
  const shown = [
    ...state.cups,
    // A cup that has just been won is still the most interesting thing on the
    // page. Clearing it the instant the final ends means the winner never
    // sees that they won — the card simply vanishes at the moment it matters.
    ...state.history.filter((h) => h.endedAt && !h.cancelled && now() - h.endedAt < SHOW_RESULT_MS
      && mine.has(h.id)),
  ];
  // The table this reader should be sitting at, in whichever cup it is.
  const live = tableFor(token);
  const sat = !!live && !!seated(live.m.roomId);
  const table = live ? {
    cupId: live.t.id,
    cup: live.t.name,
    roomId: live.m.roomId,
    round: stageOf(live.t, live.i),
    label: roundLabel(live.r),
    opponent: live.other ? nameOf(live.t, live.other) : null,
    opponentCode: live.other ? codeOf(live.t, live.other) : null,
    closesAt: live.r.closesAt || null,
    endsAt: whistleFor(live.t, live.r, live.m),
    // Whether they have sat down at it yet, on any device.
    seated: sat,
  } : null;
  if (!shown.length) return { enabled: true, cup: null, others: [], table };

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
  // A table that is open and empty outranks whichever cup the client asked to
  // look at. Every app seats its player from the cup on the card and asks for
  // the card by the cup it showed last — so somebody who had flicked over to
  // another cup in "also on" when their own door opened was never taken to
  // their table, and could sit out the whole window reading about a cup they
  // are not in. Until they sit down, the card is their table's cup; once they
  // have, they may look at whatever they like.
  const t = (live && !sat && live.t)
    || (wantId && ordered.find((x) => x.id === wantId))
    || ordered[0];

  return {
    enabled: true,
    // Where this reader should be sitting, in any cup — not only the one on
    // the card. Null when there is no open table for them anywhere.
    table,
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
  const plan = planOf(t, token);
  const where = mine ? standing(t, token) : null;
  // "Round X of Y", worked out once for every client. X is the reader's own
  // round — the one they are playing, or the last one they played — and the
  // round being played for anybody who never entered; Y is the whole plan.
  // Neither end can slip: X is never nought (before the draw a player is in
  // round one) and never past Y (the play-off beside the final is the final's
  // round, not one after it).
  const x = Math.max(1, where?.round ?? stagesDrawn(t));
  const shown = shownRound(t, token);
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
    // When the rounds are played, if this cup runs to a clock — with `at`, the
    // next moment each slot strikes, so a client can print them on the
    // reader's own clock. See scheduleView.
    schedule: scheduleView(t.schedule),
    // Every round this cup will take, with the nights they fall on. A player
    // should never have to work out how many evenings they are signing up to.
    plan,
    // The round being played, counted as a player counts: at least one, and
    // never the play-off's place on the list, which is one past the final.
    // The apps already on phones print "Round {you.round ?? rounds} of
    // {depth}", so this is the number a spectator is shown there.
    rounds: Math.max(1, stagesDrawn(t)),
    // "Round X of Y", ready to print. New clients read this and nothing else.
    progress: { round: x, of: Math.max(x, plan.length) },
    // The round the card shows and the room builds a run from — the one that
    // matters to this reader. See shownRound.
    round: shown >= 0 ? roundView(t, shown) : null,
    standings: t.standings || null,
    you: mine ? {
      joined: true,
      code: mine.code,
      name: mine.name,
      out: isOut(t, mine),
      placed: mine.placed || null,
      // A place already won that `placed` has not caught up with — see
      // settledPlace. "first" | "second" | "third", or null.
      settled: mine.placed ? null : settledPlace(t, token),
      // Where to go, the moment there is somewhere to go.
      roomId: match?.roomId || null,
      opponent: match ? nameOf(t, match.a === token ? match.b : match.a) : null,
      // How far they have come and how many are left with them. This is
      // the whole story of a knockout from one player's seat, and it is
      // four numbers rather than the entire bracket.
      ...where,
      // The match in front of them: who, when its door opens, when it shuts.
      next: nextMatchFor(t, token),
      // Every round they have played, one rung each, in order — see runOf.
      run: runOf(t, token),
    } : { joined: false },
  };
}

/**
 * Out of the cup, and nothing to show for it.
 *
 * Losing a semi-final sets `out`, and then the third-place play-off is drawn
 * from exactly those losers — so both cards read "You are out of this one"
 * with a live table and a prize sitting behind them. You are not out while
 * you still have a match to play. Nor once the podium is written with your
 * name on it: a runner-up lost the final, but "out" beside "you finished
 * second" is two stories about one evening. Nor in the gap between the two
 * semi-finals ending — see semiPending — because the one who lost first is
 * about to be drawn into the play-off, and "out" followed by "one more game"
 * a few minutes later is the same two stories the other way round.
 *
 * A place already won but not yet written (see settledPlace) leaves `out`
 * standing: the apps on phones print "Waiting for your next table" to anybody
 * joined and not out, and there is no table coming. Newer apps read
 * `settled` first and say the place instead.
 */
const isOut = (t, e) => !!e.out && !stillIn(t, e.token) && !e.placed && !semiPending(t, e.token);

/**
 * Lost a semi-final while the other one is still being played.
 *
 * The semi-final is the round of two tables — a bye counts as one — that the
 * final is drawn from, and the play-off for third is drawn from its losers the
 * moment its last table ends. Whoever lost first has no game for a while,
 * but they are not out: they are waiting for an opponent.
 */
const semiPending = (t, token) => t.state === 'running' && t.rounds.some((r) => r.kind === 'round'
  && r.matches.length === 2
  && r.matches.some((m) => m.state !== 'done')
  && r.matches.some((m) => m.state === 'done' && m.winner && m.winner !== token
    && (m.a === token || m.b === token)));

/**
 * A podium place already won while the podium waits on the other game of the
 * last evening, or null.
 *
 * `placed` is written only when both the final and the play-off are in, so
 * for as long as the slower of the two runs, the faster one's players know
 * where they finished and the cup does not say so: the two finalists once the
 * final is decided, the play-off's winner once it is, and — for the whole
 * final — a semi-final loser left third by default when a bye meant there was
 * nobody to play off against. That last one is common rather than rare: any
 * field that reaches the semi-finals three strong has it.
 */
function settledPlace(t, token) {
  if (t.state !== 'running' || !token) return null;
  if (t.thirdByDefault === token) return 'third';
  for (const r of t.rounds) {
    if (r.kind !== 'final' && r.kind !== 'thirdPlace') continue;
    const m = r.matches.find((x) => x.state === 'done' && x.winner && (x.a === token || x.b === token));
    if (!m) continue;
    if (r.kind === 'final') return m.winner === token ? 'first' : 'second';
    if (m.winner === token) return 'third';
  }
  return null;
}

/**
 * Which round of the cup this is, counted the way a player counts them.
 *
 * The third-place play-off is pushed onto the list right after the final and
 * played beside it, so its place on the list is one past the last round of
 * the cup — and "Round 4 of 3" is what a play-off player was shown. It is
 * played at the final's depth, so it takes the final's number.
 */
const stageOf = (t, i) => Math.max(1,
  t.rounds.slice(0, i + 1).filter((r) => r.kind !== 'thirdPlace').length);

/** How many rounds deep the cup has been drawn, the play-off not counted. */
const stagesDrawn = (t) => t.rounds.filter((r) => r.kind !== 'thirdPlace').length;

/** The last evening of a cup: the final, and the play-off beside it. */
const lastStage = (r) => r?.kind === 'final' || r?.kind === 'thirdPlace';

/**
 * Which round the card's `round` shows this reader, as an index, or -1.
 *
 * It used to be simply the newest one — and the newest round on the last
 * evening of a cup is the third-place play-off, pushed onto the list after the
 * final. So the card over the final read "Third place" for everybody, the two
 * finalists included, and the room built each player's run from a round the
 * finalists were not in: the two people playing for the cup saw no run at
 * all. The apps already on phones build both from this one field, so it now
 * names the round that matters to whoever is reading — the one they are
 * playing in; their own last game once the cup is over, or once it is over
 * for them on its last evening; and otherwise the deepest round being played,
 * which is the final and not the play-off beside it.
 */
function shownRound(t, token) {
  const last = t.rounds.length - 1;
  if (last < 0) return -1;
  let mineAt = -1;
  let open = -1;
  t.rounds.forEach((r, i) => {
    const m = token ? r.matches.find((x) => x.a === token || x.b === token) : null;
    if (!m) return;
    mineAt = i;
    if (m.state !== 'done') open = i;
  });
  if (open >= 0) return open;
  if (mineAt >= 0 && (t.state === 'done' || lastStage(t.rounds[mineAt]))) return mineAt;
  return t.rounds[last].kind === 'thirdPlace' && last > 0 ? last - 1 : last;
}

/**
 * One player's cup, a rung per round they were drawn in.
 *
 * The apps built this from the single round the card carries, so a player
 * three rounds deep saw one rung — and on the last evening, when that round
 * was the play-off, the finalists saw none and the play-off players saw
 * "Round 4". The server knows every round, so it says every round, each one
 * named as the chart names it and each one with how it went:
 *
 *   waiting  drawn, its table not made yet     playing  the table is open
 *   won      went through (walkover: the other side never came)
 *   lost     went out     (walkover: this player never came)
 *   bye      nobody to play; straight through  void     neither of them came
 */
function runOf(t, token) {
  const out = [];
  t.rounds.forEach((r, i) => {
    const m = r.matches.find((x) => x.a === token || x.b === token);
    if (!m) return;
    const bye = !!m.walkover && !m.b;
    const other = m.a === token ? m.b : m.a;
    const result = bye ? 'bye'
      : m.state === 'pending' ? 'waiting'
        : m.state === 'playing' ? 'playing'
          : !m.winner ? 'void'
            : m.winner === token ? 'won' : 'lost';
    const yours = m.a === token ? m.aScore : m.bScore;
    const theirs = m.a === token ? m.bScore : m.aScore;
    out.push({
      round: stageOf(t, i),
      label: roundLabel(r),
      kind: r.kind,
      result,
      walkover: !bye && !!m.walkover && !!m.winner,
      opponent: other ? nameOf(t, other) : null,
      opponentCode: other ? codeOf(t, other) : null,
      // Net worth when it was decided — the cup's scoreline — once known.
      worth: yours != null || theirs != null ? { you: yours ?? null, them: theirs ?? null } : null,
      opensAt: r.opensAt || null,
    });
  });
  return out;
}

/**
 * The table a player should be sitting at right now, in whichever cup.
 *
 * A player is in one cup at a time with one exception — a semi-final loser
 * waiting on the play-off may enter the next cup — so this is almost always
 * the only answer; when it is not, the older cup's table comes first.
 */
function tableFor(token) {
  if (!token) return null;
  for (const t of state.cups) {
    if (t.state !== 'running') continue;
    for (let i = 0; i < t.rounds.length; i++) {
      const r = t.rounds[i];
      const m = r.matches.find((x) => x.state === 'playing' && x.roomId && (x.a === token || x.b === token));
      if (m) return { t, r, i, m, other: m.a === token ? m.b : m.a };
    }
  }
  return null;
}

/**
 * The schedule as a client should read it.
 *
 * `times` are minutes past midnight on the ORGANISER's clock, and every app
 * printed them as they stand — while the plan beneath printed each round's
 * instant on the reader's clock. A player in London looking at a cup run from
 * Delhi read "Rounds at 20:00 and 22:00" over a plan that said 14:30 and
 * 16:30, both on one screen. `at` is the same slots as instants — the next
 * time each one strikes, in the order of `times` — which any client can print
 * on the reader's own clock, exactly as it prints the plan.
 */
function scheduleView(sch) {
  if (!sch) return null;
  const offset = (Number(sch.offsetMinutes) || 0) * 60000;
  const dayStart = Math.floor((now() + offset) / 86400000) * 86400000;
  return {
    ...sch,
    at: (sch.times || []).map((m) => {
      const at = dayStart + m * 60000 - offset;
      return at > now() ? at : at + 86400000;
    }),
  };
}

/**
 * Where one player stands: rounds survived, how many are left in the cup
 * beside them, and what the round they are in is called. The card draws a
 * ladder from this without ever asking for the whole bracket.
 */
/** Is there a match this player still has to play, or is playing right now? */
const stillIn = (t, token) => t.rounds.some((r) => r.matches.some(
  (m) => m.state !== 'done' && (m.a === token || m.b === token)));

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
    // Counted as the plan counts, so the play-off beside the final is the
    // final's round rather than one past the end of the cup. Before the draw
    // an entrant is in round one — nought is not a round anybody plays, and
    // "Round 0 of 7" is what every app printed for the whole join window.
    round: currentRound == null ? 1 : stageOf(t, currentRound),
    roundLabel: currentRound == null ? null : roundLabel(t.rounds[currentRound]),
    // Everyone still capable of winning it, this player included. Somebody
    // playing off for third is out of the running for the cup, so they are
    // not counted here even though they still have a game to play.
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
      you: mine ? {
        code: mine.code, name: mine.name,
        out: isOut(t, mine),
        placed: mine.placed || null,
      } : null,
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
    // The round's number as a player counts it — the play-off shares the
    // final's, rather than printing one past the end of the cup.
    n: stageOf(t, n),
    kind: r.kind,
    matches: r.matches.map((m) => ({
      a: nameOf(t, m.a), b: nameOf(t, m.b),
      state: m.state, winner: m.winner ? nameOf(t, m.winner) : null,
    })),
  };
}

const nameOf = (t, token) => (token ? t.entrants.find((e) => e.token === token)?.name || '—' : 'bye');

/**
 * The whole shape of the cup, before it has happened.
 *
 * A knockout is completely predictable — every round halves the field and
 * takes the next slot on the clock — so there is no reason to make a player
 * guess how many nights this will take or when they need to be free. Rounds
 * already drawn report their real times and counts; the rest are projected
 * from the schedule, which is exact unless a round slips.
 */
function planOf(t, token) {
  const out = [];
  let players = t.entrants.length;
  // What has actually been drawn.
  for (let i = 0; i < t.rounds.length; i++) {
    const r = t.rounds[i];
    if (r.kind === 'thirdPlace') continue;   // played beside the final, not after it
    const inIt = !!token && r.matches.some((m) => m.a === token || m.b === token);
    out.push({
      n: stageOf(t, i),
      label: roundLabel(r),
      players: playersIn(r),
      opensAt: r.opensAt || null,
      closesAt: r.closesAt || null,
      done: r.matches.every((m) => m.state === 'done'),
      yours: inIt,
      projected: false,
    });
    players = Math.ceil(playersIn(r) / 2);
  }
  // And what is still to come, if this cup runs to a clock.
  //
  // Where the projection STARTS is the whole difficulty. A round is drawn the
  // instant the one before it ends, and doorFor then asks for the first slot
  // from a second ago — so a slot that has only just struck still counts.
  // Asking from a minute in the FUTURE instead, as this did, put every
  // unplayed round exactly one slot late: a sixteen-player cup with rounds at
  // 15:54, 15:57, 16:00 and 16:03 promised its first round at 15:57 and then
  // wrapped its final round round to the following day, so the last line of
  // the timetable showed an earlier time than the first. This is the screen a
  // player plans their evening around.
  const windowMs = Math.max(1, Number(t.schedule?.windowMinutes) || 10) * 60000;
  let at = t.rounds.length
    ? (t.rounds[t.rounds.length - 1].opensAt || now())
    : ((t.state === 'joining' || t.state === 'scheduled' ? t.closesAt : now()) - 1000);
  let n = out.length;
  while (players > 1 && n < 12) {
    at = t.schedule ? nextSlot(t.schedule, at) : at;
    n++;
    out.push({
      n,
      label: players === 2 ? 'Final' : players <= 4 ? 'Semi-finals'
        : players <= 8 ? 'Quarter-finals' : `Round of ${players}`,
      players,
      opensAt: t.schedule ? at : null,
      // A projected round has a door as long as a real one. Leaving it null
      // meant the plan could say when a round opened but never when it shut —
      // and the window is the half of it somebody gets eliminated by.
      closesAt: t.schedule ? at + windowMs : null,
      done: false,
      yours: false,
      projected: true,
    });
    players = Math.ceil(players / 2);
  }
  return out;
}

/**
 * The next thing that happens to this player: the match they are due to
 * play, whether its door is open yet, and when it opens and shuts.
 *
 * This is the whole reason the screen exists. "You are in round three" is
 * not what somebody wants to know at nine in the evening; "you play Ravi at
 * ten, and the door shuts at ten past" is.
 */
/**
 * When a cup game must be over.
 *
 * Two things can call it: the clock every cup game runs to, and the moment the
 * next round is due — because round two cannot start while round one is still
 * being played, so the later of those was never really on offer. Whichever
 * comes first wins, and BOTH the sweeper that blows the whistle and the number
 * the player is shown come through here.
 *
 * They used not to. The sweeper took the earlier of the two and the player was
 * shown the game's own length, so a match that started forty-five minutes into
 * a two-hour gap promised ninety minutes and got seventy-five — and with rounds
 * an hour apart, every game in the cup was short by up to an hour. Being cut
 * off is survivable; being cut off at a time nobody told you is not.
 */
function whistleFor(t, r, m) {
  if (!m?.startedAt || !t?.schedule) return null;
  const byNext = r?.opensAt ? nextSlot(t.schedule, r.opensAt + 60000) : 0;
  const byLength = m.startedAt + (t.schedule.matchMinutes || 90) * 60000;
  const both = [byNext, byLength].filter(Boolean);
  return both.length ? Math.min(...both) : null;
}

function nextMatchFor(t, token) {
  if (!token) return null;
  for (const [i, r] of t.rounds.entries()) {
    for (const m of r.matches) {
      if (m.state === 'done') continue;
      if (m.a !== token && m.b !== token) continue;
      const other = m.a === token ? m.b : m.a;
      return {
        round: stageOf(t, i),
        label: roundLabel(r),
        opponent: other ? nameOf(t, other) : null,
        opponentCode: other ? codeOf(t, other) : null,
        opensAt: r.opensAt || null,
        closesAt: r.closesAt || null,
        open: !r.opensAt || now() >= r.opensAt,
        roomId: m.state === 'playing' ? m.roomId : null,
        // The whistle on this game, if it has started and the cup runs to a
        // clock. A player mid-game should be able to see it coming — and see
        // the real one, which is why this is the sweeper's own function.
        endsAt: m.state === 'playing' ? whistleFor(t, r, m) : null,
      };
    }
  }
  return null;
}

const codeOf = (t, token) => t.entrants.find((e) => e.token === token)?.code || null;

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
    schedule: t.schedule || null,
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
      // The owner needs the door as much as the players do — it is the one
      // number somebody asks the desk about, and the desk could not answer.
      opensAt: r.opensAt || null,
      closesAt: r.closesAt || null,
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
export function openCup({ name, joinSeconds, prize, opensAt, maxPlayers, joinCode, schedule } = {}) {
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
    // Null means the old behaviour: every round opens the moment the last
    // one finishes and stays open until somebody turns up.
    schedule: null,
    announcedAt: now(),
    openedAt: now(),
    closesAt: now() + 300 * 1000,
    entrants: [],
    rounds: [],
    standings: null,
    paid: {},
  };
  state.cups.push(t);
  applySettings(t, { name, joinSeconds, prize, opensAt, maxPlayers, joinCode, schedule });
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
function applySettings(t, { name, joinSeconds, prize, opensAt, maxPlayers, joinCode, schedule } = {}) {
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
  if (schedule !== undefined) {
    // An empty times list means "no schedule" — back to rounds that run
    // straight on from each other.
    const times = Array.isArray(schedule?.times)
      ? schedule.times.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n < 1440)
        // Twelve, not six. Six was arbitrary and it blocked the very size the
        // desk offers as its default: 256 players is eight rounds, so with a
        // six-slot ceiling that cup could not be run inside one day however
        // the owner scheduled it. Two a day is still the default — this only
        // stops the server refusing a timetable somebody deliberately wrote.
        .sort((a, b) => a - b).slice(0, 12)
      : [];
    t.schedule = times.length ? {
      times,
      windowMinutes: Math.max(2, Math.min(240, Math.floor(Number(schedule.windowMinutes) || 10))),
      matchMinutes: Math.max(5, Math.min(600, Math.floor(Number(schedule.matchMinutes) || 90))),
      offsetMinutes: Math.max(-840, Math.min(840, Math.floor(Number(schedule.offsetMinutes) || 0))),
    } : null;
  }
  // Only move the door when the caller actually asked to.
  //
  // This used to reset all three every time, and the desk sends a blank date
  // for a cup that is already taking entries — so editing a prize eighteen
  // hours in slid everybody's join countdown eighteen hours forward, and
  // renaming a cup could flip it from announced back to open.
  if (opensAt !== undefined || joinSeconds !== undefined || t.openedAt == null) {
    t.openedAt = opens;
    t.closesAt = opens + secs * 1000;
    t.state = scheduled ? 'scheduled' : 'joining';
  }
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
function pairUp(tokens, byeCount) {
  const draw = shuffled(tokens);
  let bye = null;
  if (draw.length % 2 === 1) {
    // Fewest byes so far goes first, and the shuffle above breaks the ties —
    // so nobody gets a second free pass while somebody else is still waiting
    // for their first.
    draw.sort((x, y) => (byeCount.get(x) || 0) - (byeCount.get(y) || 0));
    bye = draw.shift();
  }
  const matches = [];
  for (let i = 0; i < draw.length; i += 2) {
    matches.push({ id: id(), a: draw[i], b: draw[i + 1], roomId: null, state: 'pending', winner: null });
  }
  return { matches, bye };
}

/**
 * How many byes each player has already been handed.
 *
 * The bye used to be given to "whoever has played the most", counted over all
 * matches — but in a knockout every survivor at a given depth has played
 * exactly the same number, so the sort was a no-op and the bye was simply
 * random. Over three hundred simulated 17-player cups somebody took two or
 * more byes in seven out of ten, and one player reached the final having
 * played a single real game. Counting the byes themselves is the number that
 * actually varies.
 */
const byeCounts = (t) => {
  const c = new Map();
  for (const r of t.rounds) for (const m of r.matches) {
    if (m.walkover && m.b === null && m.a) c.set(m.a, (c.get(m.a) || 0) + 1);
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

/**
 * The door a round opens and shuts behind.
 *
 * A scheduled cup gives every round an appointed minute and a window. An
 * unscheduled one opens immediately and never shuts, which is how every cup
 * behaved before schedules existed.
 *
 * It is a function of its own because the final and the third-place play-off
 * are pushed straight onto the list rather than drawn like the rest — and for
 * a while that meant the two matches that decide the whole cup were the only
 * two with no door at all. They opened the instant the semi-finals ended,
 * minutes before the time every entrant had been shown, and their no-show
 * sweep fell back to a flat eight minutes instead of the cup's own window.
 */
function doorFor(t) {
  // Asked from a minute in the FUTURE, this threw away any slot inside the
  // next sixty seconds — so a round finishing at 21:59:30 skipped the 22:00
  // door and sent everybody home until tomorrow. It is worse than it sounds:
  // when the whistle binds on the next round's own slot, the round always
  // ends exactly on a slot, and so always burned the one it had just cut a
  // game short for. Ask from a moment BEFORE now instead.
  const opensAt = t.schedule ? nextSlot(t.schedule, now() - 1000) : now();
  const windowMs = Math.max(1, Number(t.schedule?.windowMinutes) || 10) * 60000;
  return { opensAt, closesAt: t.schedule ? opensAt + windowMs : null };
}

function drawRound(t, tokens, kindHint) {
  // Two left is the final, whatever the caller thought it was drawing. With
  // exactly two entrants that is the very first round — a cup of two is one
  // match — and calling it anything else left the bracket with no final to
  // finish on, which is how a two-player cup used to hang forever.
  const kind = tokens.length === 2 ? 'final' : (kindHint || 'round');
  const { matches, bye } = pairUp(tokens, byeCounts(t));
  t.rounds.push({ kind, matches, bye, at: now(), ...doorFor(t) });
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
      // A round with a door does not open early. Its tables are made at the
      // appointed minute, so a player who opens the app an hour before is
      // told when to come back rather than dropped into an empty room.
      if (r.opensAt && now() < r.opensAt) continue;
      // Nor does it open once it has already shut with nothing played.
      //
      // That is not a round of no-shows, it is a round nobody was ever given:
      // the process was down across the whole window. Seating it now would
      // hand the sweeper four tables whose deadline passed while they were
      // being built, and it voided all four — which abandoned the entire cup
      // after a seventeen-minute deploy. Slide it to the next appointed
      // minute instead and let the round actually happen.
      if (r.closesAt && now() > r.closesAt && r.matches.every((m) => m.state === 'pending')) {
        const door = doorFor(t);
        r.opensAt = door.opensAt;
        r.closesAt = door.closesAt;
        console.log(`cup: "${t.name}" slept through a window — round moved on`);
        save();
        continue;
      }
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
/**
 * Remember that the last call went out for a table, so it goes out once.
 *
 * Written on the match rather than held in memory: a redeploy in the last
 * minutes of a window must not shout at everybody a second time.
 */
export function noteLastCall(matchId) {
  for (const t of state.cups) for (const r of t.rounds) for (const m of r.matches) {
    if (m.id === matchId) { m.toldLast = true; save(); return; }
  }
}

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

// ─────────────────────────────────────────────────────────── reminders ──
// A round's door is open for ten minutes and missing it puts you out of the
// tournament. One message at the moment the table appears is not enough for
// that — somebody whose phone is in a pocket has ten minutes to notice, and
// the whole design rests on them noticing.
//
// So a cup speaks four times per round: when the draw is made and you learn
// who and roughly when, a quarter of an hour before it opens, the moment your
// table exists, and once more if the door is about to shut with you not in it.
// Then once at the end, either way, because being knocked out is news too.
//
// Every line is RELATIVE — "in about 3 hours", "tomorrow". The cup's times are
// set in the owner's clock and a player in London reading "20:00" for a cup run
// from Delhi would be wrong by four and a half hours. The app has their own
// local time on the card; a push only has to get them to it.

/** How far off something is, in words anybody's timezone agrees with. */
function awayText(ms) {
  if (ms <= 60_000) return 'now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 20) return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(ms / 86_400_000);
  return days <= 1 ? 'tomorrow' : `in ${days} days`;
}

/** Fifteen minutes' warning before a door opens. */
const REMIND_LEAD_MS = 15 * 60 * 1000;

/**
 * Everything the cup wants to say to somebody right now.
 *
 * Pure of the room map on purpose — this is the half that only needs the
 * calendar. The one reminder that depends on who is actually sitting down (the
 * last call before a door shuts) is sent from the sweeper, which is the only
 * place that knows.
 *
 * What has been said is written on the cup itself rather than kept in memory,
 * so a redeploy in the middle of a tournament does not tell three hundred
 * people the same thing twice.
 */
export function remindersDue(when = now()) {
  const out = [];
  const say = (token, text, collapseId) => { if (token) out.push({ token, text, collapseId }); };

  for (const t of state.cups) {
    if (t.state !== 'running') continue;

    for (let i = 0; i < t.rounds.length; i++) {
      const r = t.rounds[i];
      if (!r.opensAt) continue;
      r.told ||= {};
      const label = roundLabel(r) || 'match';

      // A round already finished with is not news. Mark it said and move on,
      // so shipping this into a cup mid-flight cannot shout about the past.
      if ((r.closesAt && when > r.closesAt) || r.matches.every((m) => m.state === 'done')) {
        r.told.drawn = true;
        r.told.soon = true;
        continue;
      }

      // 1. The draw is out: who, and roughly when.
      if (!r.told.drawn) {
        r.told.drawn = true;
        for (const m of r.matches) {
          if (m.walkover && !m.b) {
            // A bye skips THIS round, so it is the next one they go through
            // to. Named after this one, a bye in the quarter-finals read
            // "straight through to the quarter-finals" — the round they miss.
            const onTo = Math.ceil(playersIn(r) / 2);
            const into = onTo <= 2 ? 'final' : onTo <= 4 ? 'semi-finals'
              : onTo <= 8 ? 'quarter-finals' : `round of ${onTo}`;
            say(m.a, `A bye — you go straight through to the ${into}.`,
              `cup:${t.id}:r${i}:draw`);
            continue;
          }
          for (const token of [m.a, m.b]) {
            const other = nameOf(t, m.a === token ? m.b : m.a) || 'your opponent';
            // The play-off is drawn from the two who just LOST a semi-final,
            // and "You are through!" is not what somebody wants to read a
            // minute after going out of the running for the cup.
            say(token, i === 0
              ? `The draw is out — your ${label} is ${awayText(r.opensAt - when)}, against ${other}. Miss the window and you are out.`
              : r.kind === 'thirdPlace'
                ? `One more game — the play-off for third is ${awayText(r.opensAt - when)}, against ${other}. Win it and you are on the podium.`
                : `You are through! ${label} ${awayText(r.opensAt - when)}, against ${other}.`,
              `cup:${t.id}:r${i}:draw`);
          }
        }
      }

      // 2. A quarter of an hour's warning.
      if (!r.told.soon && when >= r.opensAt - REMIND_LEAD_MS && when < r.opensAt) {
        r.told.soon = true;
        const mins = Math.max(1, Math.round((r.opensAt - when) / 60000));
        const shut = r.closesAt ? Math.round((r.closesAt - r.opensAt) / 60000) : 0;
        for (const m of r.matches) {
          if (m.state === 'done') continue;
          for (const token of [m.a, m.b]) {
            say(token, `Your ${label} starts in ${mins} minutes.`
              + (shut ? ` The door is open ${shut} minutes — be in the app.` : ''),
              `cup:${t.id}:r${i}:soon`);
          }
        }
      }
    }

  }

  // 3. It is over for you, one way or the other.
  //
  // Over the finished cups as well as the live ones, because a cup retires
  // into history the instant its final is decided — so scanning only what is
  // live meant the one person who most deserved a message, the winner, was
  // the one person who never got one. Two hours' worth of history: enough to
  // catch a cup that ended while the process was being redeployed, not enough
  // to shout at somebody about a tournament from last week.
  const recent = state.history.filter((h) => h.endedAt && when - h.endedAt < 2 * 60 * 60 * 1000);
  for (const t of [...state.cups, ...recent]) {
    for (const e of (t.entrants || [])) {
      // A placing is checked first and swallows the elimination: losing the
      // final and finishing second are the same event, and being told both
      // reads as a machine talking rather than a tournament.
      if (e.placed && !e.toldWon) {
        e.toldWon = true;
        e.toldOut = true;
        say(e.token, e.placed === 'first'
          ? `You won ${t.name}. The prize is paid by hand — keep your friend code.`
          : `You finished ${e.placed} in ${t.name}. The prize is paid by hand — keep your friend code.`,
          `cup:${t.id}:done`);
      } else if (e.out && !e.toldOut && !stillIn(t, e.token) && !placingDue(t, e.token)) {
        // Not while there is a game left to play, and not while a place on
        // the podium is still to be written. `out` is set the moment a match
        // is lost — so both semi-final losers were told they were out as their
        // play-off was being drawn, and a finalist beaten while the play-off
        // was still running heard "you are out" before "you finished second".
        e.toldOut = true;
        say(e.token, `You are out of ${t.name}. Thanks for playing — there will be another.`,
          `cup:${t.id}:done`);
      }
    }
  }

  if (out.length) save();
  return out;
}

/**
 * Is a podium place still to be written for this player? True for anybody who
 * played on the cup's last evening, or took third by default, while the cup
 * is still running: their placing lands when the last game does. And true for
 * a semi-final loser while the other semi-final is still going, whose
 * play-off is drawn the moment it ends — told "you are out" at the first
 * whistle, they were told "one more game" at the second.
 */
const placingDue = (t, token) => t.state === 'running'
  && (t.thirdByDefault === token
    || semiPending(t, token)
    || t.rounds.some((r) => lastStage(r) && r.matches.some((m) => m.a === token || m.b === token)));

/** Every playing match, with the time its table opened. For the sweeper. */
export function playingMatches() {
  const out = [];
  for (const t of state.cups) {
    if (t.state !== 'running') continue;
    for (const r of t.rounds) for (const m of r.matches) {
      if (m.state === 'playing' && m.roomId) {
        out.push({
          id: m.id, roomId: m.roomId, a: m.a, b: m.b, startedAt: m.startedAt || 0,
          // A scheduled round's door is the deadline, not a fixed wait from
          // when the table was made: everybody in that round gets the same
          // ten minutes, whichever minute their table happened to open.
          deadline: r.closesAt || 0,
          // When this game must be over — the same number the player was
          // shown, from the same function.
          decideAt: whistleFor(t, r, m) || 0,
          // Whether the "door is about to shut" nudge has already gone out.
          toldLast: !!m.toldLast,
        });
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
    const { matches } = pairUp(winners, byeCounts(t));
    // One door for both: the play-off runs BESIDE the final, so they share a
    // slot rather than eating two of them — and a finalist gets the same
    // announced minute and the same window as every round before it.
    const door = doorFor(t);
    t.rounds.push({ kind: 'final', matches, at: now(), ...door });
    if (losers.length === 2) {
      const playoff = pairUp(losers, byeCounts(t));
      t.rounds.push({ kind: 'thirdPlace', matches: playoff.matches, at: now(), ...door });
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

/**
 * A player deleted their account. Their name and code come off every cup they
 * were in — the live ones and the finished ones — while the token itself stays
 * on the match, so a round they were drawn into still resolves as a no-show
 * rather than breaking halfway through.
 */
export function forgetPlayer(token) {
  if (!token) return;
  let touched = false;
  for (const t of [...state.cups, ...state.history]) {
    const e = (t.entrants || []).find((x) => x.token === token);
    if (!e) continue;
    const oldCode = e.code;
    e.name = 'Deleted player';
    e.code = null;
    for (const k of ['first', 'second', 'third']) {
      const card = t.standings?.[k];
      if (card && oldCode && card.code === oldCode) t.standings[k] = { ...card, code: null, name: 'Deleted player' };
    }
    touched = true;
  }
  if (touched) save();
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
  // A cup that produced a result is a debt until it is paid, and this used to
  // delete the only record of who is owed ninety minutes after the final. One
  // timer was doing two jobs: how long a finished cup stays on a player's
  // card, and how long the owner has to write down three names. Anything with
  // standings now keeps its place in the fifty until the fifty run out.
  state.history = state.history
    .filter((h) => h.standings || !h.endedAt || h.endedAt > cut)
    .slice(0, 50);
  if (state.history.length !== before) save();
}

export const isEnabled = () => state.enabled;
/** The first cup still going. Handy when there is only one, which is usual. */
export const currentCup = () => state.cups[0] || null;
