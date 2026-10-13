// Levels and XP, daily missions, the weekly and friends boards, careers, the
// player's own switches and the daily reminder — the server half of 1.0.6.
//
// Two halves, the way the features are built. The first imports the books
// themselves (social.js over a throwaway data dir, progression.js, a bare
// GameRoom) and walks every rule with the clock in its own hand: the level
// curve, what a game pays and the once-only rule behind it, the coins a level
// pays and the watermark that stops a level paying twice, which missions a
// day deals and what a game moves, claiming (signed in only, once only, the
// bonus only after all three), the week rolling over, the friends board, the
// career card and what is never on it, the switches, and the reminder's
// whole rulebook with a stand-in for the push sender.
//
// The second starts the real server and plays a real game on real sockets,
// then reads back what the clients will read: the 'progress' event, /api/me,
// the wallet and the ledger, the missions card and its claims, all three
// boards, a profile card, the level on every seat in the state (a person's,
// a house player's, a pass & play guest's), the invite push a switch turns
// off, the reminder the scheduler sends — once — and everything still there
// after a restart. Profiles written before any of this existed are in the
// seed, and load.
//
//   node test/progression.mjs
//
// Temporary data dirs go under os.tmpdir() and are removed afterwards; every
// process started is stopped, pass or fail.

import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { io } from 'socket.io-client';
import {
  levelFor, levelInfo, levelFloorOf, gameXp, seedXp, houseLevel, houseCareer, missionKinds, missionOf,
  missionProgress, MISSION_POOL, weekKey, weekStart, weekResetsAt, favoriteBoard, boardName, GAME_XP_PER_DAY,
} from '../server/progression.js';
import { MAPS } from '../server/maps.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const started = Date.now();

let failed = 0;
let passed = 0;
const PASS = (ok, label, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  return ok;
};
const section = (t) => console.log(`\n── ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000, step = 25) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(step);
  }
}
const short = (v) => JSON.stringify(v)?.slice(0, 400);
const hex = (n) => crypto.randomBytes(n).toString('hex');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The server's calendar day — server-local, as social.js keys it. */
const dayKey = (when = Date.now()) => {
  const d = new Date(when);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A friend code nobody else has, whose missions today include every kind asked for. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const usedCodes = new Set();
function codeWith(kinds = [], day = dayKey()) {
  for (;;) {
    const code = [...crypto.randomBytes(6)].map((b) => ALPHABET[b % 32]).join('');
    if (usedCodes.has(code)) continue;
    if (kinds.every((k) => missionKinds(code, day).includes(k))) { usedCodes.add(code); return code; }
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-progression-'));
const CAREER_KEYS = ['streetsBought', 'housesBuilt', 'rentCollected', 'biggestRent', 'auctionsWon',
  'tradesCompleted', 'doubles', 'favoriteBoard'].sort();
const ALL_DONE = {
  streetsBought: 6, housesBuilt: 4, rentCollected: 1500, setsCompleted: 1, auctionsWon: 1,
  tradesCompleted: 1, doubles: 3, laps: 3,
};

// ============================================================ in process ==

async function inProcess() {
  section('the level curve');
  {
    const want = [[0, 1], [99, 1], [100, 2], [299, 2], [300, 3], [599, 3], [600, 4], [999, 4], [1000, 5],
      [4500, 10], [4499, 9], [-5, 1], [NaN, 1]];
    const bad = want.filter(([xp, l]) => levelFor(xp) !== l);
    PASS(!bad.length, 'level L starts at 50·L·(L−1): 0, 100, 300, 600, 1000 … 4500 for 10', short(bad));
    // Every boundary up to level 200, both sides of it, so floating point
    // never lands a player one level short of a full bar.
    let edges = true;
    for (let L = 1; L <= 200; L++) {
      if (levelFor(levelFloorOf(L)) !== L) edges = false;
      if (L > 1 && levelFor(levelFloorOf(L) - 1) !== L - 1) edges = false;
    }
    PASS(edges, 'exact at every boundary to level 200, one XP either side');
    PASS(isDeepStrictEqual(levelInfo(450), { xp: 450, level: 3, levelFloor: 300, levelNext: 600 }),
      'levelInfo: xp, level, where the level started and where the next one does', short(levelInfo(450)));
    PASS(isDeepStrictEqual(levelInfo(0), { xp: 0, level: 1, levelFloor: 0, levelNext: 100 }), 'and a newcomer is 0/100 on level 1');
  }

  section('what a game is worth');
  {
    const a = gameXp({ won: true, turns: 13 });
    PASS(a.total === 56 && isDeepStrictEqual(a.parts, { played: 20, win: 30, runnerUp: 0, turns: 6 }),
      'a win over 13 turns: 20 played + 30 won + 6 for the turns', short(a));
    const b = gameXp({ runnerUp: true, turns: 100 });
    PASS(b.total === 55 && b.parts.turns === 20, 'runner-up over 100 turns: 20 + 15 + the turns capped at 20', short(b));
    PASS(gameXp({ turns: 1 }).total === 20, 'a loss on one turn: just the 20 for playing');
    PASS(gameXp({ won: true, runnerUp: true }).parts.runnerUp === 0, 'a winner is never also paid as runner-up');
    PASS(seedXp({ games: 12, wins: 7 }) === 450 && seedXp({}) === 0, 'an old profile is credited 20 a game and 30 a win');
  }

  section('house players');
  {
    const levels = Array.from({ length: 400 }, (_, i) => houseLevel(`H0${i.toString(16).toUpperCase().padStart(4, '0')}`));
    PASS(levels.every((l) => Number.isInteger(l) && l >= 3 && l <= 40), 'always a whole level from 3 to 40',
      `${Math.min(...levels)}–${Math.max(...levels)}`);
    const median = [...levels].sort((x, y) => x - y)[200];
    PASS(median >= 8 && median <= 20, 'most of them in the low teens, not spread evenly to 40', `median ${median}`);
    PASS(houseLevel('H0ABCD') === houseLevel('H0ABCD'), 'and the same code is the same level every time');
    const c1 = houseCareer('H0ABCD', 60);
    PASS(isDeepStrictEqual(c1, houseCareer('H0ABCD', 60)), 'a house career is fixed for its code and games');
    PASS(CAREER_KEYS.every((k) => k in c1) && c1.favoriteBoard.games <= 60 && c1.favoriteBoard.games >= 1
      && boardName(c1.favoriteBoard.id) === c1.favoriteBoard.name && c1.streetsBought >= 60 * 2.5 - 1,
    'every career field, a real board as favourite, numbers scaled to the games', short(c1));
  }

  section('missions are dealt the same three for a code and a day');
  {
    const pool = new Set(MISSION_POOL.map((m) => m.kind));
    PASS(pool.size === 10 && isDeepStrictEqual(Object.fromEntries(MISSION_POOL.map((m) => [m.kind, m.target])), {
      playGames: 2, winGame: 1, buyStreets: 6, buildHouses: 4, collectRent: 1500, completeSet: 1,
      winAuction: 1, completeTrade: 1, rollDoubles: 3, lapsBoard: 3,
    }), 'the pool: ten kinds with the agreed targets');
    let ok = true;
    let differs = 0;
    for (let i = 0; i < 300; i++) {
      const code = [...crypto.randomBytes(6)].map((b) => ALPHABET[b % 32]).join('');
      const k = missionKinds(code, '2026-10-13');
      if (k.length !== 3 || new Set(k).size !== 3 || !k.every((x) => pool.has(x))) ok = false;
      if (!isDeepStrictEqual(k, missionKinds(code, '2026-10-13'))) ok = false;
      if (!isDeepStrictEqual(k, missionKinds(code, '2026-10-14'))) differs++;
    }
    PASS(ok, 'three a day, never two of a kind, always from the pool, the same on every ask');
    PASS(differs > 200, 'and a new day usually deals a different three', `${differs}/300 changed overnight`);
    PASS(missionProgress('collectRent', { rentCollected: 900 }) === 900 && missionProgress('winGame', {}, true) === 1
      && missionProgress('winGame', {}, false) === 0 && missionProgress('playGames', {}) === 1
      && missionProgress('completeSet', { setsCompleted: 2 }) === 2 && missionProgress('lapsBoard', { laps: 4 }) === 4,
    'each kind reads its own counter from the room');
  }

  section('the week');
  {
    // Sunday 2026-10-18 23:59 UTC is still week 42; a minute later is week 43.
    const sun = Date.UTC(2026, 9, 18, 23, 59);
    PASS(weekKey(sun) === '2026-W42' && weekKey(sun + 60000) === '2026-W43', 'the week turns at Monday 00:00 UTC',
      `${weekKey(sun)} → ${weekKey(sun + 60000)}`);
    PASS(weekResetsAt(sun) === Date.UTC(2026, 9, 19) && weekStart(sun) === Date.UTC(2026, 9, 12),
      'resetsAt is the coming Monday, and the week began the Monday before');
    PASS(weekKey(Date.UTC(2026, 0, 1)) === '2026-W01' && weekKey(Date.UTC(2024, 11, 30)) === '2025-W01'
      && weekKey(Date.UTC(2027, 0, 1)) === '2026-W53', 'ISO weeks across the turn of the year');
  }

  section('the career sums');
  {
    PASS(favoriteBoard({ classic: 3, 'continent-europe': 5, 'continent-asia': 5 })?.id === 'continent-asia' && favoriteBoard({}) === null,
      'the favourite is the board played most, ties alphabetical, none for nobody');
    PASS(boardName('classic') === MAPS.classic.name && boardName('random') === 'Random', 'board names come from the book');
  }

  // ---------------------------------------------------------- social.js --
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'inproc-'));
  const now = Date.now();
  const today = dayKey(now);
  const base = (token, code, extra = {}) => ({
    token, code, name: extra.name || code, flag: '', friends: [], seen: now - HOUR, created: now - 90 * DAY,
    coins: 50, owned: [], equipped: {}, karma: 100, econ: 2, ...extra,
  });
  const T = (tag) => `inproc-${tag}-${hex(6)}`;
  const VET = { token: T('vet'), code: codeWith() };
  const NEW = { token: T('new'), code: codeWith() };
  const MIA = { token: T('mia'), code: codeWith(['playGames', 'buildHouses']) };
  const ANON = { token: T('anon'), code: codeWith(['playGames']) };
  const PAID = { token: T('paid'), code: codeWith() };
  const F1 = { token: T('f1'), code: codeWith() };
  const F2 = { token: T('f2'), code: codeWith() };
  const F3 = { token: T('f3'), code: codeWith() };
  const STALE = { token: T('stale'), code: codeWith() };
  const FARM = { token: T('farm'), code: codeWith(['playGames']) };
  const google = (who) => ({ provider: 'google', subject: `sub-${who.code}`, at: now - 30 * DAY });
  const seed = [
    // Written before levels existed: no xp, no levelPaid, no career, no prefs.
    base(VET.token, VET.code, { games: 40, wins: 10, winnings: 25, turnsPlayed: 900, login: google(VET) }),
    // Born before levels too, with nothing played.
    { token: NEW.token, code: NEW.code, name: 'Newbie', friends: [], seen: now },
    base(MIA.token, MIA.code, { xp: 0, levelPaid: 1, login: google(MIA) }),
    base(ANON.token, ANON.code, { xp: 0, levelPaid: 1 }),
    // A profile whose level 3 was already paid for: crossing into it must pay nothing.
    base(PAID.token, PAID.code, { xp: 290, levelPaid: 3 }),
    base(F1.token, F1.code, { xp: 0, wins: 5, winnings: 11, friends: [F2.code, F3.code] }),
    base(F2.token, F2.code, { xp: 0, wins: 0, friends: [F1.code] }),
    base(F3.token, F3.code, { xp: 0, wins: 9, winnings: 20, friends: [F1.code] }),
    base(STALE.token, STALE.code, { xp: 0, wins: 30, weekly: { week: '2020-W01', wins: 30, winnings: 60 } }),
    base(FARM.token, FARM.code, { xp: 0, levelPaid: 1, login: google(FARM) }),
  ];
  fs.writeFileSync(path.join(dir, 'social.json'), JSON.stringify({ profiles: seed }));
  process.env.DATA_DIR = dir;
  const S = await import('../server/social.js');
  const { GameRoom } = await import('../server/game.js');
  const ledgerOf = (who, provider) => S.ledgerView().filter((e) => e.code === who.code && (!provider || e.provider === provider));

  section('profiles from before levels load, and are credited once');
  {
    const vet = S.meView(VET.token);
    PASS(vet.xp === 20 * 40 + 30 * 10 && vet.level === levelFor(1100) && vet.level === 5,
      'a veteran with 40 games and 10 wins starts on 1100 XP, level 5', `${vet.xp} XP, level ${vet.level}`);
    PASS(vet.levelFloor === 1000 && vet.levelNext === 1500, 'with the bar from 1000 to 1500');
    PASS(ledgerOf(VET, 'level').length === 0 && S.walletOf(VET.token).coins === 50,
      'and not a coin for the levels the credit landed on');
    const fresh = S.meView(NEW.token);
    PASS(fresh.xp === 0 && fresh.level === 1 && isDeepStrictEqual(fresh.prefs, { dailyReminder: true, inviteAlerts: true })
      && fresh.lastLevelUp === null, 'a bare old profile: level 1, both switches on', short(fresh));
    PASS(isDeepStrictEqual(Object.keys(fresh.career).sort(), CAREER_KEYS) && fresh.career.favoriteBoard === null
      && CAREER_KEYS.filter((k) => k !== 'favoriteBoard').every((k) => fresh.career[k] === 0),
    'an empty career reads as noughts and no favourite board', short(fresh.career));
    const nobody = S.meView(`never-${hex(4)}`);
    PASS(nobody.code === '' && nobody.level === 1 && nobody.xp === 0 && nobody.levelNext === 100,
      'a token nobody has: level 1, and still not a profile', short(nobody));
    PASS(S.levelOfToken(VET.token) === 5 && S.levelOfToken(`${VET.token}_p2`) === 0 && S.levelOfToken('') === 0
      && S.levelOfToken(`ghost-${hex(3)}`) === 1, 'the seat level: theirs, 0 for a guest chair, 1 for a stranger');
  }

  section('a game pays XP once, and a level pays coins once');
  {
    const r1 = S.recordGameProgress(MIA.token, { game: 'tbl:1', won: true, turns: 30, stats: { streetsBought: 2 }, mapId: 'classic' });
    PASS(r1?.xpGained === 65 && r1.xp === 65 && r1.level === 1 && r1.levelUp === null,
      'a win over 30 turns: 65 XP, still level 1', short(r1));
    PASS(S.recordGameProgress(MIA.token, { game: 'tbl:1', won: true, turns: 30 }) === null && S.meView(MIA.token).xp === 65,
      'the same game reported again pays nothing');
    const coins = S.walletOf(MIA.token).coins;
    const r2 = S.recordGameProgress(MIA.token, { game: 'tbl:2', runnerUp: true, turns: 8, stats: {}, mapId: 'classic' });
    PASS(r2?.xpGained === 39 && r2.xp === 104 && r2.level === 2
      && isDeepStrictEqual(r2.levelUp, { from: 1, to: 2, coins: 5 }), 'runner-up next: 39 more, into level 2', short(r2));
    PASS(S.walletOf(MIA.token).coins === coins + 5, 'level 2 pays five coins', `${coins} → ${S.walletOf(MIA.token).coins}`);
    const rows = ledgerOf(MIA, 'level');
    PASS(rows.length === 1 && rows[0].txn === `level:${MIA.code}:2` && rows[0].coins === 5 && rows[0].usd === 0,
      'written down as provider level, one row named for the level', short(rows));
    const me = S.meView(MIA.token);
    PASS(me.lastLevelUp?.from === 1 && me.lastLevelUp.to === 2 && me.lastLevelUp.coins === 5 && typeof me.lastLevelUp.at === 'number',
      '/api/me remembers the level-up for a client that missed it', short(me.lastLevelUp));

    const before = S.walletOf(PAID.token).coins;
    const r3 = S.recordGameProgress(PAID.token, { game: 'tbl:3', won: true, turns: 40 });
    PASS(r3?.level === 3 && r3.levelUp?.to === 3 && r3.levelUp.coins === 0 && S.walletOf(PAID.token).coins === before
      && ledgerOf(PAID, 'level').length === 0, 'a level already paid for pays nothing when it is reached', short(r3));

    PASS(S.recordGameProgress(`${MIA.token}_p2`, { game: 'tbl:4', won: true }) === null, 'a pass & play guest earns nothing');
    const ghost = `ghost-${hex(4)}`;
    PASS(S.recordGameProgress(ghost, { game: 'tbl:5', won: true }) === null && S.meView(ghost).code === '',
      'nor does a token with no profile — and it is not made one');
  }

  section('game XP stops at the day\'s ceiling; the career and the missions do not');
  {
    // The loop from the 1.0.6 review: a two-seat table against a house
    // player, conceded on its third turn. That passes the anti-farm rule and
    // pays 20 played, 15 as runner-up (a house player is never second) and a
    // point for the turns, every few seconds, for as long as a script runs —
    // and every level it reaches pays coins outside the table-coin cap.
    const coins0 = S.walletOf(FARM.token).coins;
    const worth = gameXp({ runnerUp: true, turns: 2 });
    const runs = Array.from({ length: 40 }, (_, i) => S.recordGameProgress(FARM.token, {
      game: `farm:${i}`, runnerUp: true, turns: 2, stats: { streetsBought: 1 }, mapId: 'classic', now,
    }));
    const full = Math.floor(GAME_XP_PER_DAY / worth.total);
    PASS(runs.slice(0, full).every((r) => r?.xpGained === worth.total && r.xpCapped === false),
      `the first ${full} pay their ${worth.total} XP in full`, short(runs.slice(0, full).map((r) => r?.xpGained)));
    const cut = runs[full];
    PASS(cut?.xpGained === GAME_XP_PER_DAY - full * worth.total && cut.xpCapped === true && cut.xp === GAME_XP_PER_DAY
      && isDeepStrictEqual(cut.xpParts, worth.parts),
    `the one that crosses ${GAME_XP_PER_DAY} pays the part that fits, and still says what the game was worth`, short(cut));
    PASS(runs.slice(full + 1).every((r) => r?.xpGained === 0 && r.xpCapped === true && r.levelUp === null && r.xp === GAME_XP_PER_DAY),
      'every game after it pays no XP at all', short(runs.at(-1)));
    const me = S.meView(FARM.token);
    const levels = levelFor(GAME_XP_PER_DAY) - 1;
    PASS(me.xp === GAME_XP_PER_DAY && me.level === levelFor(GAME_XP_PER_DAY) && S.walletOf(FARM.token).coins === coins0 + 5 * levels
      && ledgerOf(FARM, 'level').length === levels,
    `forty games in one day: ${GAME_XP_PER_DAY} XP, level ${me.level}, and coins for those ${levels} levels only`,
    `${me.xp} XP, ${S.walletOf(FARM.token).coins - coins0} coins`);
    PASS(me.career.streetsBought === 40 && me.career.favoriteBoard?.games === 40, 'the career still counts all forty games',
      short(me.career));
    PASS(S.missionsView(FARM.token, now).missions.find((m) => m.kind === 'playGames')?.done === true, 'and so do the missions');
    const claim = S.claimMission(FARM.token, 'playGames', now);
    PASS(claim?.ok === true && isDeepStrictEqual(claim.awarded, { coins: 3, xp: 10 }) && claim.xp === GAME_XP_PER_DAY + 10,
      'a mission claimed past the ceiling still pays its 10 XP: missions have a daily bound of their own', short(claim?.awarded));
    const tomorrow = new Date(now);
    tomorrow.setHours(24, 5, 0, 0);
    const next = S.recordGameProgress(FARM.token, { game: 'farm:next', runnerUp: true, turns: 2, now: tomorrow.getTime() });
    PASS(next?.xpGained === worth.total && next.xpCapped === false, 'the next day the ceiling starts over', short(next));
  }

  section('the career card adds up');
  {
    S.recordGameProgress(ANON.token, { game: 'c:1', turns: 10, mapId: 'classic', stats: {
      streetsBought: 4, housesBuilt: 2, rentCollected: 700, biggestRent: 300, auctionsWon: 1, tradesCompleted: 2, doubles: 3,
    } });
    S.recordGameProgress(ANON.token, { game: 'c:2', turns: 10, mapId: 'continent-europe', stats: {
      streetsBought: 1, housesBuilt: 0, rentCollected: 50, biggestRent: 900, auctionsWon: 0, tradesCompleted: 1, doubles: 1,
    } });
    S.recordGameProgress(ANON.token, { game: 'c:3', turns: 10, mapId: 'continent-europe', stats: { biggestRent: 100 } });
    const c = S.meView(ANON.token).career;
    PASS(c.streetsBought === 5 && c.housesBuilt === 2 && c.rentCollected === 750 && c.auctionsWon === 1
      && c.tradesCompleted === 3 && c.doubles === 4, 'the counters add up over three games', short(c));
    PASS(c.biggestRent === 900, 'the biggest rent is a record: it only moves up', String(c.biggestRent));
    PASS(isDeepStrictEqual(c.favoriteBoard, { id: 'continent-europe', name: MAPS['continent-europe'].name, games: 2 }),
      'the favourite board is the one played most, with its name', short(c.favoriteBoard));

    const card = S.playerView(ANON.code, F1.token);
    PASS(card.level === S.meView(ANON.token).level && isDeepStrictEqual(card.career, c),
      'their public card carries the same level and career', short({ level: card.level }));
    PASS(isDeepStrictEqual(Object.keys(card.career).sort(), CAREER_KEYS) && !('boards' in card.career),
      'the career on the card is the counters and the favourite — not the raw per-board book');
    const raw = JSON.stringify(card);
    PASS(!raw.includes(ANON.token) && !/"xp"|"prefs"|"missions"|"weekly"|"push"|"levelPaid"|"coins":/.test(raw),
      'and no token, XP book, switches, missions, devices or wallet on it');

    S.noteBotCard('H0BEEF', { name: 'Zara', flag: '' });
    const bot = S.playerView('H0BEEF', F1.token);
    PASS(bot.level === houseLevel('H0BEEF') && isDeepStrictEqual(bot.career, houseCareer('H0BEEF', bot.games)),
      'a house player\'s card: the level it wore at the table, and a career scaled to its games', short(bot.career));
    PASS(isDeepStrictEqual(S.playerView('H0BEEF', F2.token).career, bot.career), 'the same to everyone who looks');
  }

  section('missions: progress for everyone, claims for accounts');
  {
    const v0 = S.missionsView(MIA.token, now);
    const kinds = missionKinds(MIA.code, today);
    PASS(v0.day === today && v0.signedIn === true && isDeepStrictEqual(v0.missions.map((m) => m.id), kinds)
      && v0.missions.every((m) => m.kind === m.id && m.coins === 3 && m.xp === 10 && m.title === missionOf(m.kind).title),
    'today\'s three, by kind, each worth 3 coins and 10 XP', short(v0.missions.map((m) => m.id)));
    const pg = v0.missions.find((m) => m.kind === 'playGames');
    PASS(pg?.progress === 2 && pg.done === true && pg.target === 2, 'the two games Mia already played count toward "Play 2 games"',
      short(pg));
    const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
    PASS(v0.resetsAt === midnight.getTime() && isDeepStrictEqual(v0.bonus, { coins: 5, ready: false, claimed: false }),
      'resets at the server\'s midnight; the bonus waits for all three', short(v0.bonus));

    const ghost = `ghost-${hex(5)}`;
    const peek = S.missionsView(ghost, now);
    PASS(peek.signedIn === false && peek.missions.every((m) => m.progress === 0 && !m.claimed)
      && S.meView(ghost).code === '', 'a stranger can look at what they would be dealt, without becoming a profile');
    const minted = S.profileFor(ghost);
    PASS(isDeepStrictEqual(S.missionsView(ghost, now).missions.map((m) => m.id), peek.missions.map((m) => m.id)),
      'and once they are one, it is the very same three', `${minted.code}`);

    // Anonymous Anon has progress but cannot claim it.
    const anonView = S.missionsView(ANON.token, now);
    PASS(anonView.signedIn === false && anonView.missions.find((m) => m.kind === 'playGames')?.progress === 2,
      'progress is tracked for a player who is not signed in — three games, held at the target of two');
    const anonClaim = S.claimMission(ANON.token, anonView.missions[0].id, now);
    PASS(anonClaim.needsLogin === true && /Sign in/.test(anonClaim.error), 'but claiming asks them to sign in', short(anonClaim));

    const wallet = S.walletOf(MIA.token).coins;
    const xp = S.meView(MIA.token).xp;
    const c1 = S.claimMission(MIA.token, 'playGames', now);
    PASS(c1.ok === true && isDeepStrictEqual(c1.awarded, { coins: 3, xp: 10 }) && c1.coins === wallet + 3 && c1.xp === xp + 10
      && c1.level === levelFor(xp + 10) && c1.missions.missions.find((m) => m.kind === 'playGames')?.claimed === true,
    'Mia claims "Play 2 games": 3 coins and 10 XP, and the card comes back with it claimed', short({ ...c1, missions: undefined }));
    const again = S.claimMission(MIA.token, 'playGames', now);
    PASS(again.ok === true && again.duplicate === true && isDeepStrictEqual(again.awarded, { coins: 0, xp: 0 })
      && again.coins === wallet + 3 && S.meView(MIA.token).xp === xp + 10,
    'claiming it again (a retry, a second tab) is ok and pays nothing', short({ ...again, missions: undefined }));
    PASS(ledgerOf(MIA, 'mission').filter((e) => e.txn === `mission:${today}:${MIA.code}:playGames`).length === 1,
      'one ledger row, provider mission, named for the day and the mission');

    const early = S.claimMission(MIA.token, 'buildHouses', now);
    PASS(!early.ok && /not finished/.test(early.error || ''), 'a mission not yet done cannot be claimed', short(early));
    const notToday = MISSION_POOL.map((m) => m.kind).find((k) => !kinds.includes(k));
    const stale = S.claimMission(MIA.token, notToday, now);
    PASS(!stale.ok && /today/.test(stale.error || '') && Array.isArray(stale.missions?.missions),
      'a mission that is not one of today\'s is refused, with today\'s card attached', stale.error);
    const bonusEarly = S.claimMission(MIA.token, 'bonus', now);
    PASS(!bonusEarly.ok && /all three/.test(bonusEarly.error || ''), 'the bonus waits for all three', bonusEarly.error);

    // Two big games finish the rest.
    S.recordGameProgress(MIA.token, { game: 'm:1', won: true, turns: 20, stats: ALL_DONE, now });
    const r = S.recordGameProgress(MIA.token, { game: 'm:2', won: true, turns: 20, stats: ALL_DONE, now });
    const full = S.missionsView(MIA.token, now);
    PASS(full.missions.every((m) => m.done && m.progress === m.target) && full.bonus.ready === true,
      'two good games finish all three, progress held at each target', short(full.missions.map((m) => `${m.kind} ${m.progress}/${m.target}`)));
    PASS(Array.isArray(r?.missionsCompleted), 'and the game says which missions it finished', short(r?.missionsCompleted));
    for (const k of kinds.filter((x) => x !== 'playGames')) S.claimMission(MIA.token, k, now);
    const w = S.walletOf(MIA.token).coins;
    const bonus = S.claimMission(MIA.token, 'bonus', now);
    PASS(bonus.ok && isDeepStrictEqual(bonus.awarded, { coins: 5, xp: 0 }) && bonus.coins === w + 5
      && bonus.missions.bonus.claimed === true && bonus.missions.bonus.ready === false,
    'all three claimed: the bonus pays 5 coins', short({ ...bonus, missions: undefined }));
    const bonus2 = S.claimMission(MIA.token, 'bonus', now);
    PASS(bonus2.ok && bonus2.duplicate === true && S.walletOf(MIA.token).coins === w + 5, 'and only once');
    const rows = ledgerOf(MIA, 'mission');
    PASS(rows.length === 4 && new Set(rows.map((e) => e.txn)).size === 4 && rows.reduce((n, e) => n + e.coins, 0) === 14,
      'four ledger rows for the day: three missions and the bonus, 14 coins', rows.map((e) => e.txn.split(':').pop()).join(','));

    const tomorrow = now + DAY;
    const next = S.missionsView(MIA.token, tomorrow);
    PASS(next.day === dayKey(tomorrow) && next.missions.every((m) => m.progress === 0 && !m.claimed)
      && next.bonus.claimed === false && isDeepStrictEqual(next.missions.map((m) => m.id), missionKinds(MIA.code, dayKey(tomorrow))),
    'tomorrow: a new three, all at nought, the bonus up for grabs again');
  }

  section('the boards: all time, this week, friends');
  {
    const all = S.leaderboardFor({});
    PASS(all.scope === 'all' && Array.isArray(all.top) && all.you === null && !('resetsAt' in all),
      'the default is the lifetime board, with nobody marked as you', short({ ...all, top: all.top.length }));
    PASS(all.top.every((r, i) => i === 0 || r.wins <= all.top[i - 1].wins)
      && all.top.every((r) => isDeepStrictEqual(Object.keys(r).sort(), ['code', 'flag', 'level', 'name', 'wins', 'winnings'].sort())),
    'most wins first, rows of code, name, flag, level, wins and coins won');
    PASS(all.top.find((r) => r.code === VET.code)?.level === 5 && S.leaderboardView().length === all.top.length,
      'each row wears its level; the old leaderboardView is the same rows');

    const before = S.leaderboardFor({ scope: 'week', token: STALE.token });
    PASS(!before.top.some((r) => r.code === STALE.code) && before.you?.rank === null && before.you.wins === 0,
      'thirty wins from a week long gone are not on this week\'s board', short(before.you));
    S.awardWin(STALE.token, 2, 'test win');
    S.awardWin(F1.token, 2, 'test win');
    S.awardWin(F1.token, 2, 'test win');
    S.awardWin(MIA.token, 1, 'runner-up', { placing: true });
    const week = S.leaderboardFor({ scope: 'week', token: STALE.token });
    PASS(week.scope === 'week' && week.week === weekKey() && week.resetsAt === weekResetsAt(),
      'the weekly board says which week and when it resets', `${week.week}, ${new Date(week.resetsAt).toISOString()}`);
    const f1Row = week.top.find((r) => r.code === F1.code);
    const staleRow = week.top.find((r) => r.code === STALE.code);
    PASS(f1Row?.wins === 2 && f1Row.winnings === 4 && staleRow?.wins === 1 && staleRow.winnings === 2 && staleRow.you === true,
      'a win starts the week over: old tallies gone, this week\'s counted', short(week.top));
    PASS(week.you?.rank === week.top.findIndex((r) => r.code === STALE.code) + 1 && week.you.wins === 1,
      'and `you` is the caller\'s place on it', short(week.you));
    PASS(!week.top.some((r) => r.code === MIA.code), 'a runner-up coin is not a weekly win');
    const lifetime = S.leaderboardFor({ token: STALE.token }).top.find((r) => r.code === STALE.code);
    PASS(lifetime?.wins === 31, 'the lifetime tally went on counting underneath', String(lifetime?.wins));

    const fr = S.leaderboardFor({ scope: 'friends', token: F1.token });
    PASS(isDeepStrictEqual(fr.top.map((r) => r.code), [F3.code, F1.code, F2.code]),
      'friends: the caller and their friends, by lifetime wins, a friend on nought included', short(fr.top));
    PASS(fr.top.find((r) => r.code === F2.code)?.wins === 0 && fr.you?.rank === 2 && fr.you.wins === 7
      && fr.top.find((r) => r.you)?.code === F1.code, 'with the caller marked and ranked', short(fr.you));
    PASS(!fr.top.some((r) => [VET.code, STALE.code].includes(r.code)), 'and nobody who is not a friend');
    S.blockPlayer(F1.token, F3.code);
    PASS(!S.leaderboardFor({ scope: 'friends', token: F1.token }).top.some((r) => r.code === F3.code),
      'a blocked friend is off it (blocking ends the friendship)');
    const nobody = S.leaderboardFor({ scope: 'friends' });
    PASS(isDeepStrictEqual(nobody, { scope: 'friends', top: [], you: null }), 'no token, no friends board', short(nobody));
    PASS(S.leaderboardFor({ scope: 'nonsense' }).scope === 'all', 'an unknown scope is the lifetime board');
  }

  section('the switches');
  {
    const ghost = `ghost-${hex(4)}`;
    PASS(isDeepStrictEqual(S.prefsOf(ghost), { dailyReminder: true, inviteAlerts: true }) && S.meView(ghost).code === '',
      'both on by default, and reading them makes nobody a profile');
    const a = S.setPrefs(NEW.token, { inviteAlerts: false });
    PASS(isDeepStrictEqual(a, { ok: true, dailyReminder: true, inviteAlerts: false }), 'one switched off, the other left alone', short(a));
    const b = S.setPrefs(NEW.token, { dailyReminder: 'false' });
    PASS(isDeepStrictEqual(b, { ok: true, dailyReminder: false, inviteAlerts: false }), 'the string "false" reads as off', short(b));
    const bad = S.setPrefs(NEW.token, { dailyReminder: 'maybe', inviteAlerts: true });
    PASS(/must be true or false/.test(bad.error || '') && S.prefsOf(NEW.token).inviteAlerts === false,
      'anything else is refused, and nothing in that request is applied', short(bad));
    PASS(S.setPrefs('', { dailyReminder: true }).error === 'Missing identity', 'no token, no switches');
    PASS(isDeepStrictEqual(S.meView(NEW.token).prefs, { dailyReminder: false, inviteAlerts: false }), '/api/me reads them back');
  }

  section('the daily reminder\'s rules');
  {
    const at = new Date(now); at.setHours(10, 0, 0, 0);
    const T0 = at.getTime();
    const device = (n = 1) => Array.from({ length: n }, (_, i) => ({ device: hex(32), platform: i % 2 ? 'android' : 'ios', at: T0 }));
    const make = (tag, extra) => {
      const who = { token: T(`r-${tag}`) };
      const p = S.profileFor(who.token, { name: tag });
      Object.assign(p, { login: { provider: 'google', subject: `s-${tag}` }, push: device(), seen: T0 - HOUR }, extra);
      who.code = p.code;
      who.p = p;
      return who;
    };
    const claimed = (ms) => ({ daily: { last: dayKey(T0 - ms), streak: 4, at: T0 - ms } });
    const due = make('due', claimed(21 * HOUR));
    const late = make('late', claimed(45 * HOUR));       // missed a day; same hour, a day later
    const soon = make('soon', claimed(18 * HOUR));       // claimed at four yesterday afternoon — not yet
    const offHour = make('offhour', claimed(33 * HOUR)); // one in the morning: not their hour
    const today2 = make('today', { daily: { last: dayKey(T0), streak: 2, at: T0 - HOUR } });
    const off = make('off', { ...claimed(21 * HOUR), prefs: { dailyReminder: false, inviteAlerts: true } });
    const noPhone = make('nophone', { ...claimed(21 * HOUR), push: [] });
    const anon = make('anon', { ...claimed(21 * HOUR), login: undefined });
    const gone = make('gone', { ...claimed(21 * HOUR), seen: T0 - 8 * DAY });
    const banned = make('banned', claimed(21 * HOUR));
    S.banByCode(banned.code, 'test');
    const legacy = make('legacy', { daily: { last: dayKey(T0 - DAY), streak: 1 } }); // no claim time on file
    const never = make('never', { reminded: { at: T0 - 21 * HOUR, day: dayKey(T0 - 21 * HOUR) } });

    const calls = [];
    const send = (token, text, opts) => calls.push({ token, text, opts });
    const n = S.runDailyReminders(send, T0);
    const who = new Set(calls.map((c) => c.token));
    const expect = [due, late, legacy, never];
    PASS(n === calls.length && expect.every((x) => who.has(x.token)) && calls.length === expect.length,
      'reminded: claimed ~21h ago, missed a day at the same hour, an old claim with only a day, never claimed but reminded yesterday',
      `${calls.length} sent`);
    const skipped = { soon, offHour, today: today2, off, noPhone, anon, gone, banned };
    const wrong = Object.entries(skipped).filter(([, x]) => who.has(x.token)).map(([k]) => k);
    PASS(!wrong.length, 'not: claimed 18h ago, not their hour, already claimed today, switched off, no phone, not signed in, away a week, banned',
      wrong.join(', '));
    PASS(calls.every((c) => c.text === 'Your daily coins are ready — keep your streak going'
      && isDeepStrictEqual(c.opts, { collapseId: 'daily', kind: 'daily' })),
    'the words, collapse id daily and kind daily', short(calls[0]));
    PASS(due.p.reminded?.at === T0 && due.p.reminded.day === dayKey(T0), 'and each one is written down');

    PASS(S.runDailyReminders(send, T0 + 10 * 60 * 1000) === 0, 'ten minutes later: nobody twice');
    calls.length = 0;
    S.runDailyReminders(send, T0 + 3 * HOUR);
    PASS(!calls.some((c) => expect.some((x) => x.token === c.token)),
      'three hours later, still the same day: nobody reminded at ten is reminded again');
    PASS(calls.length === 1 && calls[0].token === soon.token, 'but Soon, whose twenty hours are now up, is',
      `${calls.length} sent`);
    const at2 = T0 + DAY;
    calls.length = 0;
    S.runDailyReminders(send, at2);
    PASS(calls.some((c) => c.token === due.token), 'a day on with the coin still waiting: reminded again',
      `${calls.length} sent`);
    // Claiming at noon that day stops it, and moves the hour the next one comes at.
    due.p.daily = { last: dayKey(at2 + 2 * HOUR), streak: 5, at: at2 + 2 * HOUR };
    PASS(!S.reminderDue(due.p, at2 + 3 * HOUR), 'claimed today: no reminder');
    PASS(!S.reminderDue(due.p, at2 + 2 * HOUR + 19 * HOUR) && S.reminderDue(due.p, at2 + 2 * HOUR + 21 * HOUR),
      'and the next one comes about a day after that claim, not before');
    const sendThrows = () => { throw new Error('boom'); };
    const late2 = make('throws', claimed(21 * HOUR));
    PASS(S.runDailyReminders(sendThrows, T0) >= 1 && late2.p.reminded?.at === T0
      && S.runDailyReminders(sendThrows, T0 + 600000) === 0, 'a sender that throws is not retried every ten minutes');
  }

  section('the room counts turns and sets, and every seat wears a level');
  {
    const room = new GameRoom('lvl01', () => {});
    room.hooks.levelOf = (t) => ({ ann: 7, ben: 2 })[t] ?? 0;
    room.addPlayer({ id: 'ann', name: 'Ann' });
    room.addPlayer({ id: 'ben', name: 'Ben' });
    room.addPlayer({ id: 'ann_p2', name: 'Guest' });
    room.addBot();
    const rows = room.serialize().players;
    const bot = rows.find((r) => r.isBot);
    PASS(rows.find((r) => r.name === 'Ann')?.level === 7 && rows.find((r) => r.name === 'Ben')?.level === 2,
      'a person\'s seat carries their level');
    PASS(rows.find((r) => r.name === 'Guest')?.level === 0, 'a pass & play guest\'s carries 0');
    PASS(bot?.level === houseLevel(bot?.code) && bot.level >= 3 && bot.level <= 40,
      'a house player\'s is drawn from its stand-in code — the same level its card shows', `${bot?.code} → ${bot?.level}`);
    room.settings.randomizeOrder = false;
    room.start('ann');
    const first = room.players[0].id;
    PASS(room.stats[first]?.turns === 1, 'the opening turn counts for the first seat', short(room.stats[first]));
    room.nextTurn();
    const second = room.turn.playerId;
    PASS(second !== first && room.stats[second]?.turns === 1 && room.stats[first].turns === 1,
      'and each turn after it for whoever it goes to');
    const [group, idxs] = Object.entries(room.map.groups)[0];
    for (const i of idxs) room.ownership[i] = { owner: 'ann', houses: 0, mortgaged: false };
    room.recordWorth();
    room.recordWorth();
    PASS(room.stats.ann.setsCompleted === 1, 'a colour set counts once when it is completed, not once a turn', group);
    for (const i of idxs) room.ownership[i].owner = 'ben';
    room.recordWorth();
    for (const i of idxs) room.ownership[i].owner = 'ann';
    room.recordWorth();
    PASS(room.stats.ann.setsCompleted === 1 && room.stats.ben.setsCompleted === 1,
      'won back, it is not counted again; completed by somebody else, it counts for them');
    room.dispose();
  }

  S.flushSocial();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'social.json'), 'utf8'));
  const mia = saved.profiles.find((p) => p.token === MIA.token);
  PASS(mia?.xp > 0 && mia.levelPaid >= 2 && mia.career?.boards?.classic === 2 && mia.missions?.claimed?.length === 3
    && mia.missions.bonus === true && saved.profiles.find((p) => p.token === NEW.token)?.prefs?.dailyReminder === false,
  'everything new is written with the profile, in the same save as the coins');
}

// ============================================================ over the wire ==

const children = [];
const sockets = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startServer(name, dir, attempt = 1) {
  const port = await freePort();
  const env = { ...process.env };
  // Both push senders dark: what they would have sent is written to the log,
  // which is what this reads — the same stand-in player-profile.mjs and
  // cup-flow.mjs use for push.
  for (const k of Object.keys(env)) {
    if (/^(APPLE_|GOOGLE_|APNS_|STRIPE_|FCM_|PLAY_)/.test(k)) delete env[k];
  }
  delete env.RENDER;
  delete env.NODE_ENV;
  delete env.MONEYMOVE_TEST_HOOKS;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...env, PORT: String(port), DATA_DIR: dir, ADMIN_KEY: `admin-${hex(4)}`, MM_REMINDER_MS: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const srv = { name, url: `http://127.0.0.1:${port}`, dir, child, log: '' };
  child.stdout.on('data', (d) => { srv.log += d; });
  child.stderr.on('data', (d) => { srv.log += d; });
  children.push(child);
  const up = await until(async () => {
    if (child.exitCode != null) return true;
    try { return (await fetch(`${srv.url}/healthz`)).ok; } catch { return false; }
  }, 20000, 100);
  if (!up || child.exitCode != null) {
    if (/EADDRINUSE/.test(srv.log) && attempt < 4) return startServer(name, dir, attempt + 1);
    throw new Error(`${name} did not start:\n${srv.log}`);
  }
  return srv;
}

function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 3000).unref();
  });
}

async function call(srv, method, p, body) {
  const res = await fetch(srv.url + p, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const get = (srv, p) => call(srv, 'GET', p);
const post = (srv, p, body) => call(srv, 'POST', p, body);
const enc = encodeURIComponent;
/** The pushes the server would have sent an iPhone, read off its log. */
const pushed = (srv, text) => srv.log.split('\n').filter((l) => l.includes('push (dark): would send "') && l.includes(text));

function seat(srv, who) {
  const sock = io(srv.url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(sock);
  const chair = { sock, who, state: null, seq: 0, toasts: [], progress: [] };
  sock.on('state', (s) => { chair.state = s; chair.seq++; });
  sock.on('toast', (t) => chair.toasts.push(t?.message));
  sock.on('progress', (p) => chair.progress.push(p));
  chair.emit = (...a) => sock.emit(...a);
  chair.join = (roomId, token = who.token, name = who.name) => sock.emit('join', { roomId, token, name, flag: '' });
  chair.mine = () => chair.state?.status === 'playing' && chair.state.turn?.playerId === who.token;
  return chair;
}
const rowNamed = (state, name) => state?.players?.find((p) => p.name === name);

/** Play this chair's turn to its end: roll, buy what is landed on, hand the dice on. */
async function playTurn(chair) {
  let last = '';
  let tries = 0;
  for (let step = 0; step < 80; step++) {
    if (!chair.mine()) return true;
    const phase = chair.state.turn.phase;
    tries = phase === last ? tries + 1 : 0;
    last = phase;
    const seq = chair.seq;
    if (phase === 'roll') chair.emit('roll');
    else if (phase === 'action') chair.emit(tries % 2 ? 'skipBuy' : 'buy');
    else if (phase === 'auction') chair.emit('passBid');
    else if (phase === 'debt') chair.emit('payDebt');
    else chair.emit('endTurn');
    await until(() => chair.seq !== seq, 1500, 10);
  }
  return !chair.mine();
}

async function overTheWire() {
  const now = Date.now();
  const W = (tag, name, kinds = []) => ({ token: `wire-${tag}-${hex(6)}`, code: codeWith(kinds), name });
  const ASHA = W('asha', 'Asha', ['playGames', 'winGame']);
  const BILAL = W('bilal', 'Bilal');
  const CHEN = W('chen', 'Chen');
  const DEV = W('dev', 'Dev');
  const REMI = W('remi', 'Remi');
  const QUIET = W('quiet', 'Quiet');
  const NOLOG = W('nolog', 'Nolog');
  const FARMER = W('farmer', 'Farmer');
  const devices = (n) => Array.from({ length: n }, () => ({ device: hex(32), platform: 'ios', at: now }));
  const base = (who, extra = {}) => ({
    token: who.token, code: who.code, name: who.name, flag: '', friends: [], wants: [], asked: [],
    seen: now - HOUR, created: now - 60 * DAY, coins: 100, owned: [], equipped: {}, karma: 100, econ: 2, ...extra,
  });
  const waiting = { daily: { last: dayKey(now - 45 * HOUR), streak: 3, at: now - 45 * HOUR } };
  const seed = [
    base(ASHA, {
      xp: 90, levelPaid: 1, friends: [BILAL.code, CHEN.code],
      login: { provider: 'google', subject: 'g-asha', at: now }, email: 'asha.secret@example.com',
    }),
    // Bilal predates levels and has his invite alerts off.
    base(BILAL, { friends: [ASHA.code], push: devices(1), prefs: { dailyReminder: true, inviteAlerts: false } }),
    base(CHEN, { friends: [ASHA.code], push: devices(1) }),
    // Dev predates levels: 10 games and 4 wins on file, nothing else new.
    base(DEV, { games: 10, wins: 4, winnings: 9 }),
    // Three whose daily coin has waited 45 hours: same hour of day, one day missed.
    base(REMI, { ...waiting, login: { provider: 'google', subject: 'g-remi', at: now }, push: devices(1) }),
    base(QUIET, { ...waiting, login: { provider: 'google', subject: 'g-quiet', at: now }, push: devices(2),
      prefs: { dailyReminder: false, inviteAlerts: true } }),
    base(NOLOG, { ...waiting, push: devices(3) }),
    // Ten XP short of today's ceiling on game XP, and of level 4.
    base(FARMER, { xp: GAME_XP_PER_DAY - 10, levelPaid: 3, xpDay: { day: dayKey(now), xp: GAME_XP_PER_DAY - 10 } }),
  ];
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'wire-'));
  fs.writeFileSync(path.join(dir, 'social.json'), JSON.stringify({ profiles: seed }));
  let S = await startServer('first', dir);
  const REMIND = 'Your daily coins are ready — keep your streak going';

  section('the reminder scheduler, on the real server');
  {
    const first = await until(() => pushed(S, REMIND).length >= 1, 8000);
    PASS(!!first, 'the scheduler reminds Remi, whose coin has waited since this hour two days ago', pushed(S, REMIND)[0]?.trim());
    await sleep(2500);   // two more beats of the scheduler (its floor is a second)
    const lines = pushed(S, REMIND);
    PASS(lines.length === 1 && /to 1 device\(s\)/.test(lines[0]),
      'once, and to Remi\'s one phone — not Quiet\'s two (switched off) nor Nolog\'s three (not signed in)',
      lines.map((l) => l.replace(/.*to /, 'to ')).join(' | '));
  }

  section('profiles from before levels, at the table');
  let botCode = '';
  let botLevel = 0;
  {
    const d = seat(S, DEV);
    const g = seat(S, { ...DEV, name: 'Guest' });
    const { roomId } = await new Promise((r) => d.sock.emit('createRoom', { token: DEV.token }, r));
    d.join(roomId);
    await until(() => d.state?.players?.length === 1);
    d.emit('addBot');
    await until(() => d.state?.players?.length === 2);
    g.join(roomId, `${DEV.token}_p2`, 'Guest');
    await until(() => d.state?.players?.length === 3);
    const rows = d.state?.players || [];
    const dev = rowNamed(d.state, 'Dev');
    const bot = rows.find((p) => p.isBot);
    PASS(dev?.level === levelFor(20 * 10 + 30 * 4) && dev.level === 3,
      'Dev, with 10 games and 4 wins from before levels, sits down at level 3', String(dev?.level));
    PASS(rowNamed(d.state, 'Guest')?.level === 0, 'his pass & play guest wears level 0');
    PASS(/^H0[0-9A-F]{4}$/.test(bot?.code || '') && bot.level === houseLevel(bot.code), 'the house player wears its drawn level',
      `${bot?.code} → ${bot?.level}`);
    botCode = bot?.code || '';
    botLevel = bot?.level || 0;
    const card = await get(S, `/api/player?code=${enc(botCode)}&token=${enc(DEV.token)}`);
    PASS(card.status === 200 && card.json?.level === botLevel
      && isDeepStrictEqual(Object.keys(card.json?.career || {}).sort(), CAREER_KEYS)
      && card.json.career.favoriteBoard?.games <= card.json.games,
    'and its card after a look says the same level, with a career to match its games', short(card.json?.career));
    d.sock.close();
    g.sock.close();
  }

  section('an invite respects the friend\'s switch');
  {
    const r1 = await post(S, '/api/invite', { token: ASHA.token, code: BILAL.code, roomId: 'tbl77' });
    const r2 = await post(S, '/api/invite', { token: ASHA.token, code: CHEN.code, roomId: 'tbl77' });
    const text = 'Asha invited you to a game — tap to join';
    await until(() => pushed(S, text).length >= 1);
    await sleep(300);
    PASS(r1.json?.ok === true && r2.json?.ok === true && !('inviteAlerts' in (r1.json || {})),
      'both invites go through, and the reply does not tell Asha who silenced their phone', r1.text);
    PASS(pushed(S, text).length === 1, 'only Chen\'s phone rings: Bilal switched invite alerts off',
      `${pushed(S, text).length} push(es)`);
    const banner = (await get(S, `/api/invite?token=${enc(BILAL.token)}`)).json?.invite;
    PASS(banner?.from === ASHA.code && banner.roomId === 'tbl77', 'Bilal still has the invite waiting in the app', short(banner));
  }

  section('a real game, played to the end');
  let finalA = null;
  let roomId = '';
  {
    const a = seat(S, ASHA);
    const b = seat(S, BILAL);
    ({ roomId } = await new Promise((r) => a.sock.emit('createRoom', { token: ASHA.token }, r)));
    a.join(roomId);
    await until(() => a.state?.players?.length === 1);
    b.join(roomId);
    await until(() => a.state?.players?.length === 2 && b.state?.players?.length === 2);
    PASS(rowNamed(b.state, 'Asha')?.level === 1 && rowNamed(b.state, 'Bilal')?.level === 1,
      'in the lobby both wear level 1 — Asha is 90 XP in', short(b.state?.players?.map((p) => [p.name, p.level])));
    a.emit('settings', { auction: false });
    await sleep(100);
    a.emit('start');
    await until(() => a.state?.status === 'playing' && b.state?.status === 'playing');
    PASS(a.state?.status === 'playing', 'the game starts', a.toasts.join('; '));
    for (let handoffs = 0; handoffs < 10 && a.state?.status === 'playing'; handoffs++) {
      const chair = a.mine() ? a : b.mine() ? b : null;
      if (!chair) { await until(() => a.mine() || b.mine(), 2000); continue; }
      await playTurn(chair);
    }
    b.emit('bankrupt');
    const ended = await until(() => a.state?.status === 'ended' && b.state?.status === 'ended', 8000);
    PASS(!!ended && a.state?.winner?.name === 'Asha', 'Bilal concedes after ten turns or so, Asha wins',
      `${a.state?.status} — ${a.state?.winner?.name}`);
    finalA = a.state;
    const sA = finalA?.stats?.[ASHA.token] || {};
    const sB = b.state?.stats?.[BILAL.token] || {};
    PASS(sA.turns >= 2 && sB.turns >= 2 && Number.isInteger(sA.setsCompleted),
      'the final state\'s stats carry each seat\'s own turns and sets', `Asha ${sA.turns}, Bilal ${sB.turns} turns`);

    await until(() => a.progress.length && b.progress.length, 4000);
    const pa = a.progress[0];
    const wantA = 50 + Math.min(20, Math.floor(sA.turns / 2));
    PASS(a.progress.length === 1 && pa?.roomId === roomId && pa.xpGained === wantA && pa.xp === 90 + wantA
      && pa.level === 2 && pa.levelFloor === 100 && pa.levelNext === 300 && pa.xpCapped === false,
    'Asha\'s socket is told: 20 played + 30 won + a point per two turns, into level 2', short(pa));
    PASS(isDeepStrictEqual(pa?.levelUp, { from: 1, to: 2, coins: 5 }), 'with the level-up and its five coins', short(pa?.levelUp));
    PASS(isDeepStrictEqual(pa?.xpParts, { played: 20, win: 30, runnerUp: 0, turns: Math.min(20, Math.floor(sA.turns / 2)) }),
      'and how the XP was made up');
    PASS(pa?.missionsCompleted?.includes('winGame') && !pa.missionsCompleted.includes('playGames'),
      '"Win a game" is done; "Play 2 games" is one short', short(pa?.missionsCompleted));
    const pb = b.progress[0];
    const wantB = 35 + Math.min(20, Math.floor(sB.turns / 2));
    PASS(b.progress.length === 1 && pb?.xpGained === wantB && pb.levelUp === null && pb.level === 1 && pb.xpCapped === false,
      'Bilal, runner-up: 20 + 15 + his turns, still level 1', short(pb));
    PASS(!a.progress.some((p) => p.xp === pb?.xp && p.xpGained === pb?.xpGained) && !JSON.stringify(a.progress).includes(BILAL.token),
      'each socket hears only its own player\'s progress');
    PASS(rowNamed(finalA, 'Asha')?.level === 2, 'the results screen already shows Asha on level 2');
    for (const s of [a, b]) s.sock.close();
  }

  section('what the clients read back');
  {
    const me = (await get(S, `/api/me?token=${enc(ASHA.token)}`)).json;
    const sA = finalA?.stats?.[ASHA.token] || {};
    PASS(me?.level === 2 && me.xp > 100 && me.levelFloor === 100 && me.levelNext === 300, '/api/me: the level and the bar', short(me));
    PASS(me?.lastLevelUp?.to === 2 && me.lastLevelUp.coins === 5, '/api/me: the level-up, for a client that missed the event');
    const careerMatches = ['streetsBought', 'housesBuilt', 'rentCollected', 'biggestRent', 'auctionsWon', 'tradesCompleted', 'doubles']
      .every((k) => me?.career?.[k] === (sA[k] || 0));
    PASS(careerMatches && isDeepStrictEqual(me?.career?.favoriteBoard, { id: 'classic', name: MAPS.classic.name, games: 1 }),
      '/api/me: the career is exactly the game\'s numbers, Classic once', short(me?.career));
    PASS(isDeepStrictEqual(me?.prefs, { dailyReminder: true, inviteAlerts: true }), '/api/me: the switches');

    const wallet = (await get(S, `/api/wallet?token=${enc(ASHA.token)}`)).json;
    PASS(wallet?.coins === 100 + 2 + 5, 'her wallet: 100, the two-coin purse, five for level 2', String(wallet?.coins));
    const ledger = await until(() => {
      try {
        const rows = JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'));
        return rows.some((e) => e.provider === 'level') ? rows : null;
      } catch { return null; }
    }, 5000, 100);
    const lvl = (ledger || []).filter((e) => e.provider === 'level' && e.token === ASHA.token);
    PASS(lvl.length === 1 && lvl[0].txn === `level:${ASHA.code}:2` && lvl[0].coins === 5, 'the ledger has one level row', short(lvl));

    const m = await get(S, `/api/missions?token=${enc(ASHA.token)}`);
    const card = m.json || {};
    PASS(m.status === 200 && card.day === dayKey() && typeof card.resetsAt === 'number' && card.signedIn === true
      && card.missions?.length === 3 && isDeepStrictEqual(Object.keys(card.bonus || {}).sort(), ['claimed', 'coins', 'ready']),
    'GET /api/missions: day, resetsAt, signedIn, three missions and the bonus', short({ ...card, missions: card.missions?.length }));
    const keys = ['claimed', 'coins', 'done', 'id', 'kind', 'progress', 'target', 'title', 'xp'];
    PASS(card.missions?.every((x) => isDeepStrictEqual(Object.keys(x).sort(), keys)), 'each mission row has exactly its nine fields');
    const win = card.missions?.find((x) => x.kind === 'winGame');
    const play = card.missions?.find((x) => x.kind === 'playGames');
    PASS(win?.done === true && win.progress === 1 && play?.progress === 1 && play.done === false,
      'Win a game 1/1, Play 2 games 1/2', `${win?.progress}/${win?.target} ${play?.progress}/${play?.target}`);
    PASS((await get(S, '/api/missions')).status === 400, 'no token: 400');

    const c1 = await post(S, '/api/missions/claim', { token: ASHA.token, id: 'winGame' });
    PASS(c1.status === 200 && c1.json?.ok === true && c1.json.coins === 110 && isDeepStrictEqual(c1.json.awarded, { coins: 3, xp: 10 })
      && c1.json.xp === me.xp + 10 && c1.json.missions?.missions?.find((x) => x.kind === 'winGame')?.claimed === true,
    'claiming it: 3 coins, 10 XP, the wallet balance and the redrawn card', short({ ...c1.json, missions: undefined }));
    const c2 = await post(S, '/api/missions/claim', { token: ASHA.token, id: 'winGame' });
    PASS(c2.status === 200 && c2.json?.duplicate === true && c2.json.coins === 110, 'claiming twice: 200, duplicate, not paid again',
      short({ ...c2.json, missions: undefined }));
    const c3 = await post(S, '/api/missions/claim', { token: ASHA.token, id: 'playGames' });
    PASS(c3.status === 400 && /not finished/.test(c3.json?.error || ''), 'an unfinished one: 400', c3.text.slice(0, 120));
    const c4 = await post(S, '/api/missions/claim', { token: BILAL.token, id: 'playGames' });
    PASS(c4.status === 401 && c4.json?.needsLogin === true, 'Bilal, not signed in: 401 with needsLogin', c4.text);
    const bm = (await get(S, `/api/missions?token=${enc(BILAL.token)}`)).json;
    PASS(bm?.signedIn === false && (missionKinds(BILAL.code, dayKey()).includes('playGames')
      ? bm.missions.find((x) => x.kind === 'playGames')?.progress === 1 : true),
    'but his progress is on his card all the same', short(bm?.missions?.map((x) => `${x.kind} ${x.progress}`)));

    const all = (await get(S, '/api/leaderboard')).json;
    const aRow = all?.top?.find((r) => r.code === ASHA.code);
    PASS(all?.scope === 'all' && aRow?.wins === 1 && aRow.level === 2 && all.you === null && !('you' in aRow),
      'GET /api/leaderboard, as an old client asks: top is where it was, rows wear levels', short(aRow));
    const week = (await get(S, `/api/leaderboard?scope=week&token=${enc(ASHA.token)}`)).json;
    PASS(week?.scope === 'week' && week.resetsAt === weekResetsAt() && week.top?.[0]?.code === ASHA.code
      && week.top[0].you === true && isDeepStrictEqual(week.you, { rank: 1, wins: 1 }),
    'scope=week: Asha on top with her row marked, resets Monday', short(week));
    const fr = (await get(S, `/api/leaderboard?scope=friends&token=${enc(BILAL.token)}`)).json;
    PASS(isDeepStrictEqual(fr?.top?.map((r) => [r.code, r.wins, !!r.you]), [[ASHA.code, 1, false], [BILAL.code, 0, true]])
      && isDeepStrictEqual(fr.you, { rank: 2, wins: 0 }), 'scope=friends for Bilal: Asha, then him on nought', short(fr));
    const anon = (await get(S, '/api/leaderboard?scope=friends')).json;
    PASS(isDeepStrictEqual(anon, { scope: 'friends', top: [], you: null }), 'scope=friends with no token: empty');
    const leaked = JSON.stringify([all, week, fr]);
    PASS(![ASHA.token, BILAL.token, 'asha.secret@example.com'].some((s) => leaked.includes(s)), 'no token or email on any board');

    const pc = await get(S, `/api/player?code=${enc(ASHA.code)}&token=${enc(BILAL.token)}`);
    PASS(pc.status === 200 && pc.json?.level === 2 && isDeepStrictEqual(pc.json.career, me.career),
      '/api/player: her level, and the career she sees on her own /api/me', short(pc.json?.career));
    PASS(![ASHA.token, 'asha.secret', '"xp"', '"prefs"', '"lastLevelUp"'].some((s) => pc.text.includes(s)),
      'and nothing private: no token, email, XP book, switches or level-up');

    const p0 = (await get(S, `/api/prefs?token=${enc(BILAL.token)}`)).json;
    PASS(isDeepStrictEqual(p0, { dailyReminder: true, inviteAlerts: false }), 'GET /api/prefs: Bilal\'s switches', short(p0));
    const p1 = await post(S, '/api/prefs', { token: BILAL.token, inviteAlerts: true });
    PASS(p1.status === 200 && isDeepStrictEqual(p1.json, { ok: true, dailyReminder: true, inviteAlerts: true }),
      'POST /api/prefs: one field changed, both returned', p1.text);
    const p2 = await post(S, '/api/prefs', { token: BILAL.token, dailyReminder: 'soon' });
    PASS(p2.status === 400 && /true or false/.test(p2.json?.error || ''), 'POST a non-answer: 400', p2.text);
    const ghost = `wire-ghost-${hex(4)}`;
    const gp = (await get(S, `/api/prefs?token=${enc(ghost)}`)).json;
    const gm = (await get(S, `/api/missions?token=${enc(ghost)}`)).json;
    const gme = (await get(S, `/api/me?token=${enc(ghost)}`)).json;
    PASS(isDeepStrictEqual(gp, { dailyReminder: true, inviteAlerts: true }) && gm?.missions?.length === 3 && gme?.code === ''
      && gme.level === 1, 'a stranger can read switches and missions and is still nobody afterwards', short(gme));
  }

  section('game XP stops at the day\'s ceiling, on the real server');
  {
    // The farm itself: a two-seat table filled with a house player, two
    // turns played, then walk out on the third. The table has had its four
    // turns, so the game counts — and Farmer, ten short of the day's
    // ceiling, is paid ten of the 36 it is worth.
    const f = seat(S, FARMER);
    const { roomId: farm } = await new Promise((r) => f.sock.emit('createRoom', { token: FARMER.token }, r));
    f.join(farm);
    await until(() => f.state?.players?.length === 1);
    f.emit('settings', { allowBots: true, maxPlayers: 2, randomizeOrder: false });
    await until(() => f.state?.settings?.allowBots === true && f.state.settings.maxPlayers === 2);
    f.emit('start');
    await until(() => f.state?.status === 'playing', 8000);
    PASS(f.state?.status === 'playing' && f.state.players.length === 2, 'setup: Farmer and one house player', f.toasts.join('; '));
    for (let guard = 0; guard < 400 && f.state?.status === 'playing'; guard++) {
      if (f.mine() && f.state.turnCount >= 3 && f.state.turn.phase === 'roll') { f.emit('quit'); break; }
      if (f.mine()) await playTurn(f); else await sleep(25);
    }
    await until(() => f.state?.status === 'ended' && f.progress.length, 15000);
    const pf = f.progress[0];
    const worth = Object.values(pf?.xpParts || {}).reduce((n, x) => n + x, 0);
    PASS(f.state?.status === 'ended' && f.state.turnCount >= 4 && pf?.xpParts?.runnerUp === 15,
      'setup: Farmer walks out after the table\'s fourth turn, and is still the runner-up', short(pf?.xpParts));
    PASS(pf?.xpGained === 10 && pf.xpCapped === true && worth > 10 && pf.xp === GAME_XP_PER_DAY && pf.level === 4,
      `the game was worth ${worth} XP and pays the 10 left under the ceiling`, short(pf));
    PASS(isDeepStrictEqual(pf?.levelUp, { from: 3, to: 4, coins: 5 }), 'which still reaches level 4, and pays for it once',
      short(pf?.levelUp));
    const me = (await get(S, `/api/me?token=${enc(FARMER.token)}`)).json;
    PASS(me?.xp === GAME_XP_PER_DAY && me.level === 4, '/api/me agrees', short({ xp: me?.xp, level: me?.level }));
    f.sock.close();
  }

  section('after a restart');
  {
    for (const s of sockets) { try { s.close(); } catch { /* closed */ } }
    await stop(S.child);
    S = await startServer('second', dir);
    const me = (await get(S, `/api/me?token=${enc(ASHA.token)}`)).json;
    PASS(me?.level === 2 && me.career?.favoriteBoard?.games === 1 && me.lastLevelUp?.to === 2,
      'Asha is still level 2, with her career and her level-up', short({ level: me?.level, xp: me?.xp }));
    const m = (await get(S, `/api/missions?token=${enc(ASHA.token)}`)).json;
    PASS(m?.missions?.find((x) => x.kind === 'winGame')?.claimed === true, 'the claimed mission is still claimed');
    const again = await post(S, '/api/missions/claim', { token: ASHA.token, id: 'winGame' });
    PASS(again.json?.duplicate === true && again.json.coins === 110, 'and a retry after the restart still pays nothing', short(again.json?.coins));
    const week = (await get(S, '/api/leaderboard?scope=week')).json;
    PASS(week?.top?.some((r) => r.code === ASHA.code && r.wins === 1), 'the week\'s board survived');
    PASS(isDeepStrictEqual((await get(S, `/api/prefs?token=${enc(BILAL.token)}`)).json, { dailyReminder: true, inviteAlerts: true }),
      'and so did Bilal\'s switches');
    await sleep(2200);
    PASS(pushed(S, REMIND).length === 0, 'Remi, reminded before the restart, is not reminded again after it');
  }
}

let crashed = null;
try {
  await inProcess();
  await overTheWire();
} catch (err) {
  crashed = err;
  failed++;
  console.log(`\n  FAIL  the test itself crashed — ${err?.stack || err}`);
} finally {
  for (const s of sockets) { try { s.close(); } catch { /* closed */ } }
  await Promise.all(children.map(stop));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`\n${failed ? 'FAILED' : 'OK'} — ${passed} passed, ${failed} failed (${((Date.now() - started) / 1000).toFixed(1)}s)`);
process.exit(failed || crashed ? 1 : 0);
