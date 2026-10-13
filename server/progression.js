// Levels, daily missions, the week and the career card — the arithmetic.
//
// Everything here is a pure function of its arguments: no profile is read and
// nothing is written. The wallets live in social.js, which calls in here for
// the numbers and keeps the books itself; the room calls in for a house
// player's level. Keeping the sums apart is what lets the clients, the tests
// and the server all agree on what "level 7" means without one of them
// having to ask another.

import { createHash } from 'node:crypto';
import { MAPS } from './maps.js';

// ------------------------------------------------------------------ levels --

/**
 * What a finished game is worth, per human seat. Only games that pass the
 * anti-farm rule (see recordTransitions in index.js) pay any of it.
 *
 * Turns are the seat's own, not the table's: a player knocked out on their
 * fifth turn did not sit through the other forty, and a table of six should
 * not pay more for the same evening than a table of two.
 */
export const GAME_XP = { played: 20, win: 30, runnerUp: 15, turnsPerPoint: 2, turnsMax: 20 };
/**
 * The most XP finished games may pay one person in a calendar day (the daily
 * reward's day). Level-up coins come out of XP, so without this they would be
 * bounded by nothing but time: a 2-seat table against a house player passes
 * the anti-farm rule after four turns, and conceding it pays the runner-up
 * part too, because a house player is never second. A real evening of a
 * dozen games fits under it; a script that plays all day does not get past
 * it. Mission XP is bounded by the three missions a day and is not counted.
 */
export const GAME_XP_PER_DAY = 600;
/** A mission claimed is worth this much on top of its coins. */
export const MISSION_XP = 10;
/** Coins for every level gained — a small present, paid once per level. */
export const LEVEL_UP_COINS = 5;

/** The total XP level `L` starts at: 0, 100, 300, 600, 1000… */
export const levelFloorOf = (level) => 50 * level * (level - 1);

/**
 * The level a total belongs to: the largest L with 50·L·(L−1) ≤ xp.
 *
 * The square root gets close and the two loops make it exact. Floating point
 * is perfectly capable of landing a hair under a whole number, and a player
 * whose bar is full while the chip says the level before would be right to
 * think the game had cheated them.
 */
export function levelFor(xp) {
  const x = Math.max(0, Math.floor(Number(xp) || 0));
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * x) / 50)) / 2));
  while (level > 1 && levelFloorOf(level) > x) level--;
  while (levelFloorOf(level + 1) <= x) level++;
  return level;
}

/** Everything a client needs to draw the chip and the bar. */
export function levelInfo(xp) {
  const x = Math.max(0, Math.floor(Number(xp) || 0));
  const level = levelFor(x);
  return { xp: x, level, levelFloor: levelFloorOf(level), levelNext: levelFloorOf(level + 1) };
}

/** One seat's XP for one finished game, and how it was made up. */
export function gameXp({ won = false, runnerUp = false, turns = 0 } = {}) {
  const forTurns = Math.min(GAME_XP.turnsMax,
    Math.floor(Math.max(0, Number(turns) || 0) / GAME_XP.turnsPerPoint));
  const parts = {
    played: GAME_XP.played,
    win: won ? GAME_XP.win : 0,
    // A winner is never also the runner-up, whatever the caller says.
    runnerUp: runnerUp && !won ? GAME_XP.runnerUp : 0,
    turns: forTurns,
  };
  return { total: parts.played + parts.win + parts.runnerUp + parts.turns, parts };
}

/**
 * What a profile that predates levels starts with: credit for the games it
 * already played and the wins it already took, at the same rates a game pays
 * now. Paid as XP only — the level it lands on is marked as already paid for,
 * so a veteran is not handed a pile of level-up coins on the day this ships.
 */
export const seedXp = ({ games = 0, wins = 0 } = {}) =>
  GAME_XP.played * Math.max(0, Math.floor(Number(games) || 0))
  + GAME_XP.win * Math.max(0, Math.floor(Number(wins) || 0));

// ----------------------------------------------------------- house players --

const digest = (text) => createHash('sha1').update(text).digest();

/**
 * A house player's record, from nothing but its code: a few dozen wins out of
 * rather more games. social.js builds the rest of its card (winnings, titles,
 * "playing since") on top of these two numbers, and its level is read off
 * them, so the card can never claim a hundred and sixty games at level four.
 */
export function houseRecord(code) {
  const h = createHash('sha1').update(String(code || '')).digest();
  const wins = 3 + (h.readUInt16BE(0) % 88);                // 3–90
  const games = wins + 6 + (h.readUInt16BE(2) % 135);       // and 6–140 more played
  return { wins, games };
}

/**
 * A house player's level: what its record would have earned at the rates a
 * real game pays — a game played, a win, and the turns in between — held to
 * 3–40. Fixed for the code, so the chip in the lobby and the one on its
 * profile after the game are the same number.
 */
export function houseLevel(code) {
  const { wins, games } = houseRecord(code);
  const turns = Math.round(games * 8);                      // about sixteen turns a game, a point per two
  return Math.max(3, Math.min(40, levelFor(seedXp({ games, wins }) + turns)));
}

/** The boards a house player might call its favourite: every one there is, Classic most often. */
const BOARD_IDS = Object.keys(MAPS);

/** The name a board goes by, for a career card. Random is not in the book but is a board. */
export const boardName = (id) => (Object.hasOwn(MAPS, id) ? MAPS[id].name : id === 'random' ? 'Random' : String(id || ''));

/**
 * A house player's career, scaled from the games its card already claims, so
 * the numbers agree with each other: a player with forty games has not built
 * nine hundred houses. Drawn from the code and fixed, for the same reason the
 * wins are.
 */
export function houseCareer(code, games) {
  const h = digest(`career:${String(code || '')}`);
  const g = Math.max(1, Math.floor(Number(games) || 0));
  const span = (i, lo, hi) => lo + (h[i] / 255) * (hi - lo);
  const favourite = h[10] % 5 < 2 ? 'classic' : BOARD_IDS[h.readUInt16BE(11) % BOARD_IDS.length];
  return {
    streetsBought: Math.round(g * span(0, 2.5, 6)),
    housesBuilt: Math.round(g * span(1, 0.8, 4)),
    rentCollected: Math.round((g * span(2, 500, 1900)) / 10) * 10,
    biggestRent: Math.round(span(3, 250, 2600) / 10) * 10,
    auctionsWon: Math.round(g * span(4, 0.1, 0.9)),
    tradesCompleted: Math.round(g * span(5, 0.2, 1.1)),
    doubles: Math.round(g * span(6, 1.5, 4)),
    favoriteBoard: { id: favourite, name: boardName(favourite), games: Math.max(1, Math.round(g * span(7, 0.25, 0.7))) },
  };
}

// ----------------------------------------------------------------- careers --

/** The lifetime counters a career keeps, beside the per-board tally. */
export const CAREER_KEYS = ['streetsBought', 'housesBuilt', 'rentCollected', 'biggestRent',
  'auctionsWon', 'tradesCompleted', 'doubles'];

/** The board played most, or null for a career that has not played one yet. */
export function favoriteBoard(boards) {
  const top = Object.entries(boards || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top ? { id: top[0], name: boardName(top[0]), games: top[1] } : null;
}

/**
 * Fold one game's stats into a career, in place. Everything adds except the
 * biggest rent, which is a record and only ever moves up. Stats are the
 * room's own counters (GameRoom.statFor); anything missing counts as nought.
 */
export function foldCareer(career, stats = {}, mapId = '') {
  const c = career || {};
  for (const key of CAREER_KEYS) {
    const v = Math.max(0, Math.floor(Number(stats?.[key]) || 0));
    c[key] = key === 'biggestRent' ? Math.max(c[key] || 0, v) : (c[key] || 0) + v;
  }
  c.boards ??= {};
  const id = String(mapId || '').slice(0, 40);
  if (id) c.boards[id] = (c.boards[id] || 0) + 1;
  return c;
}

// ---------------------------------------------------------------- missions --

/**
 * The pool three missions a day are drawn from. Each reads one of the room's
 * own counters at the end of a game, so a mission can only ever ask for
 * something the table already keeps score of.
 */
export const MISSION_POOL = [
  { kind: 'playGames', target: 2, title: 'Play 2 games' },
  { kind: 'winGame', target: 1, title: 'Win a game' },
  { kind: 'buyStreets', target: 6, title: 'Buy 6 streets' },
  { kind: 'buildHouses', target: 4, title: 'Build 4 houses' },
  { kind: 'collectRent', target: 1500, title: 'Collect $1,500 in rent' },
  { kind: 'completeSet', target: 1, title: 'Complete a colour set' },
  { kind: 'winAuction', target: 1, title: 'Win an auction' },
  { kind: 'completeTrade', target: 1, title: 'Complete a trade' },
  { kind: 'rollDoubles', target: 3, title: 'Roll 3 doubles' },
  { kind: 'lapsBoard', target: 3, title: 'Lap the board 3 times' },
];
/**
 * What the missions pay. A mission on its own pays its XP and no coins; the
 * coins are for doing all three — one small bonus, once a day. Three coins a
 * mission plus five for the set was fourteen coins a day on top of the daily
 * reward; a mission is now a reason to play, and the day's set is the one
 * thing worth a coin.
 */
export const MISSION_COINS = 0;
export const MISSION_BONUS_COINS = 3;
export const MISSIONS_PER_DAY = 3;

const missionByKind = new Map(MISSION_POOL.map((m) => [m.kind, m]));
export const missionOf = (kind) => missionByKind.get(kind) || null;

/**
 * Today's three, for one player: a shuffle of the pool seeded by their code
 * and the day, so every device, every restart and every look at the card
 * agrees, and two players sitting side by side are usually asked for
 * different things. A shuffle cannot deal the same kind twice.
 */
export function missionKinds(code, day) {
  const h = digest(`missions:${String(code || '')}:${String(day || '')}`);
  const kinds = MISSION_POOL.map((m) => m.kind);
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = h[i] % (i + 1);
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  return kinds.slice(0, MISSIONS_PER_DAY);
}

/**
 * How far one finished game moves one mission. `stats` is the seat's
 * counters from the room; `won` is whether the seat was on the winning side.
 */
export function missionProgress(kind, stats = {}, won = false) {
  const n = (k) => Math.max(0, Math.floor(Number(stats?.[k]) || 0));
  switch (kind) {
    case 'playGames': return 1;
    case 'winGame': return won ? 1 : 0;
    case 'buyStreets': return n('streetsBought');
    case 'buildHouses': return n('housesBuilt');
    case 'collectRent': return n('rentCollected');
    case 'completeSet': return n('setsCompleted');
    case 'winAuction': return n('auctionsWon');
    case 'completeTrade': return n('tradesCompleted');
    case 'rollDoubles': return n('doubles');
    case 'lapsBoard': return n('laps');
    default: return 0;
  }
}

// -------------------------------------------------------------------- week --

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The Monday 00:00 UTC that starts the week `when` falls in, as ms. */
export function weekStart(when = Date.now()) {
  const d = new Date(when);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return midnight - sinceMonday * 24 * 60 * 60 * 1000;
}

/** When the weekly board empties: the coming Monday 00:00 UTC. */
export const weekResetsAt = (when = Date.now()) => weekStart(when) + WEEK_MS;

/**
 * The ISO week `when` falls in, as "2026-W42". ISO's year is the year of the
 * week's Thursday, which is why the last days of December can belong to
 * week 1 of the year after — the key has to say so, or the turn of the year
 * would split one week into two boards.
 */
export function weekKey(when = Date.now()) {
  const thursday = new Date(weekStart(when) + 3 * 24 * 60 * 60 * 1000);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / WEEK_MS);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
