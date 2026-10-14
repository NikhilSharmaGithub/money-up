// The tables half of 1.0.6: bot skill, watching live games, and timed games.
//
// Three features, each with a rule that matters more than the feature itself.
// A bot skill the host did not pick must never leak onto anyone else's seat —
// not a person's chair the house is minding, not a Play-now table's house
// players, who are passing as people. A watcher must never become a player by
// accident, never be able to act, and never see a token. And a game that ends
// on the clock must end exactly once, through the same door every other game
// ends by, so the purse, the XP and the record are paid once and only once.
//
// Two halves. The first drives GameRoom directly, with the clock and the dice
// in its own hand: the settings and what they refuse, who the skill binds,
// the decisions each skill makes on the same board, a seeded table played out
// at easy and at hard (and replayed, to show it is the same game twice), and
// the game clock — on the spot, at the end of a turn in progress, with no
// encore on a double, the hard stop, teams, a debt, a rematch, the watchdog.
//
// The second starts the real server with a "minute" a few hundred
// milliseconds long and plays on real sockets: the lobby settings and their
// toasts, timed games solo and in teams to their end (the results, the
// progress event, the leaderboard and the record, once each), watchers on a
// live table (no seat, no toast, a count, no hands, no tokens — even one
// watching under a seated player's own token), and GET /api/live: what it
// lists, what it leaves out, what it says about each seat, the order, and the
// cap.
//
//   node test/tables-1-0-6.mjs
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
  GameRoom, DEFAULT_SETTINGS, BOT_LEVELS, TIME_LIMITS,
} from '../server/game.js';

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
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-tables-'));

// A seedable Math.random, so a table of house players plays the same game
// every time it is dealt the same seed.
const realRandom = Math.random;
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================ in process ==

let serial = 0;
const made = [];

/** A room with its timers stubbed out, so every move is a direct call. */
function bare({ humans = ['a', 'b'], bots = 0, settings = {}, quiet = true } = {}) {
  const transitions = [];
  let last = null;
  const room = new GameRoom(`t${++serial}`, (r) => {
    if (r.status !== last) transitions.push(r.status);
    last = r.status;
  });
  made.push(room);
  if (quiet) {
    room.scheduleBot = () => {};
    room.maybeBot = () => {};
    room.maybeBotAuction = () => {};
    room.armAuctionTimer = () => {};
  }
  for (const id of humans) room.addPlayer({ id, name: id.toUpperCase() });
  for (let i = 0; i < bots; i++) room.addBot();
  room.settings = {
    ...room.settings, randomizeOrder: false, turnSeconds: 0, auction: false, ...settings,
  };
  room.transitions = transitions;
  return room;
}
const logText = (room) => room.log.map((l) => l.text);
const endings = (room) => room.transitions.filter((s) => s === 'ended').length;

async function inProcess() {
  section('the two new settings');
  {
    PASS(DEFAULT_SETTINGS.botLevel === 'normal' && DEFAULT_SETTINGS.timeLimit === 0,
      'a new table plays normal bots with no clock', short({ botLevel: DEFAULT_SETTINGS.botLevel, timeLimit: DEFAULT_SETTINGS.timeLimit }));
    PASS(isDeepStrictEqual(BOT_LEVELS, ['easy', 'normal', 'hard']) && isDeepStrictEqual(TIME_LIMITS, [0, 20, 30, 45, 60]),
      'the pickers: easy / normal / hard, and no limit / 20 / 30 / 45 / 60 minutes');

    const r = bare();
    const okLevels = BOT_LEVELS.every((lvl) => !r.updateSettings('a', { botLevel: lvl })?.error && r.settings.botLevel === lvl);
    PASS(okLevels, 'the host may pick each bot skill');
    r.updateSettings('a', { botLevel: 'hard' });
    const badLevels = ['brutal', 'EASY', 'Normal', 3, null, {}, ['easy'], ''];
    const refusedLevels = badLevels.every((v) => r.updateSettings('a', { botLevel: v })?.error === 'Bot skill is easy, normal or hard');
    PASS(refusedLevels && r.settings.botLevel === 'hard', 'anything else is refused, and the skill stays put',
      `still ${r.settings.botLevel}`);

    const okLengths = TIME_LIMITS.every((m) => !r.updateSettings('a', { timeLimit: m })?.error && r.settings.timeLimit === m);
    PASS(okLengths, 'the host may pick each game length, and no limit');
    r.updateSettings('a', { timeLimit: '45' });
    PASS(r.settings.timeLimit === 45 && typeof r.settings.timeLimit === 'number', 'a length sent as text is stored as the number',
      short(r.settings.timeLimit));
    r.updateSettings('a', { timeLimit: null });
    PASS(r.settings.timeLimit === 0, 'null is no limit');
    r.updateSettings('a', { timeLimit: 30 });
    const badLengths = [25, -20, 61, 15, 20.5, 'thirty', true, false, NaN, {}, [30], 3600];
    const refusedLengths = badLengths.every((v) => r.updateSettings('a', { timeLimit: v })?.error === 'Game length is 20, 30, 45 or 60 minutes, or no limit');
    PASS(refusedLengths && r.settings.timeLimit === 30, 'any other length is refused, and the length stays put', `still ${r.settings.timeLimit}`);

    const cash = r.settings.startingCash;
    const half = r.updateSettings('a', { botLevel: 'brutal', startingCash: cash + 1000 });
    const half2 = r.updateSettings('a', { timeLimit: 25, auction: true });
    PASS(half?.error && half2?.error && r.settings.startingCash === cash && r.settings.auction === false,
      'a patch with one bad value is refused whole — nothing in it is applied');
    r.updateSettings('b', { botLevel: 'easy', timeLimit: 60 });
    PASS(r.settings.botLevel === 'hard' && r.settings.timeLimit === 30, 'a guest cannot change either');
    r.start('a');
    r.updateSettings('a', { botLevel: 'easy', timeLimit: 60 });
    PASS(r.settings.botLevel === 'hard' && r.settings.timeLimit === 30, 'and nobody can once the dice are rolling');

    const q = new GameRoom(`q${++serial}`, () => {});
    made.push(q);
    q.makeQuickMatch(86400);
    q.addPlayer({ id: 'qa', name: 'Qa' });
    const qa = q.updateSettings(q.hostId, { botLevel: 'hard' });
    const qb = q.updateSettings(q.hostId, { timeLimit: 20 });
    const qc = q.updateSettings(q.hostId, { startingCash: 2000, botLevel: 'normal' });
    PASS(qa?.error && qb?.error && qc?.error && q.settings.botLevel === 'normal' && q.settings.timeLimit === 0,
      'a Play-now table refuses both — even "normal" — and stays normal with no clock', qa?.error);

    const c = bare();
    c.cupMatch = 'm-test';
    const ca = c.updateSettings('a', { botLevel: 'easy' });
    const cb = c.updateSettings('a', { timeLimit: 45 });
    PASS(ca?.error === 'A cup table is set by the cup' && cb?.error === 'A cup table is set by the cup'
      && c.settings.botLevel === 'normal' && c.settings.timeLimit === 0, 'a cup table refuses both too', ca?.error);
  }

  section('who the bot skill binds');
  {
    const r = bare({ humans: ['h'], bots: 2, settings: { botLevel: 'easy' } });
    const bot = r.players.find((p) => p.isBot);
    const me = r.player('h');
    PASS(r.botSkill(bot) === 'easy', 'a house player the host invited plays at the table\'s skill');
    me.botControlled = true;
    PASS(r.botSkill(me) === 'normal', 'a person\'s chair the house is minding plays the ordinary game');
    r.settings.botLevel = 'hard';
    PASS(r.botSkill(bot) === 'hard' && r.botSkill(me) === 'normal', '…at hard as at easy');
    r.settings.botLevel = 'nonsense';
    PASS(r.botSkill(bot) === 'normal', 'and anything that is not a skill is normal');

    const q = new GameRoom(`q${++serial}`, () => {});
    made.push(q);
    q.makeQuickMatch(86400);
    q.addPlayer({ id: 'qh', name: 'Qh' });
    q.addBot();
    q.settings.botLevel = 'easy';      // forced past the door, which refuses it
    const qbot = q.players.find((p) => p.isBot);
    PASS(qbot && q.botSkill(qbot) === 'normal', 'a Play-now table\'s house players are always normal, whatever the setting says');
  }

  section('easy, normal and hard decide differently on the same board');
  {
    Math.random = mulberry32(606);
    const r = bare({ humans: ['h'], bots: 3 });
    Math.random = realRandom;
    r.start('h');
    const [b, c] = r.players.filter((p) => p.isBot);
    const at = (lvl, fn) => { r.settings.botLevel = lvl; r.auctionCaps = {}; return fn(); };
    const prop = r.map.tiles.find((t) => t.type === 'property' && t.price >= 150 && t.price <= 260);

    b.money = prop.price + 100;
    const buys = Object.fromEntries(BOT_LEVELS.map((lvl) => [lvl, at(lvl, () => r.botBuys(b, prop.index))]));
    PASS(buys.hard === true && buys.normal === false && buys.easy === false,
      `$100 to spare on ${prop.name}: hard buys it, normal and easy keep their cash`, short(buys));

    // The last piece of somebody's colour: normal spends almost everything to
    // deny it; easy never sees the race and keeps its cushion.
    const group = Object.values(r.map.groups).find((g) => g.length === 3);
    r.ownership[group[0]] = { owner: c.id, houses: 0, mortgaged: false };
    r.ownership[group[1]] = { owner: c.id, houses: 0, mortgaged: false };
    const last = r.tile(group[2]);
    b.money = last.price + 80;
    const deny = Object.fromEntries(BOT_LEVELS.map((lvl) => [lvl, at(lvl, () => r.botBuys(b, last.index))]));
    PASS(deny.normal && deny.hard && !deny.easy, 'the street that would finish a rival\'s colour: normal and hard deny it, easy does not',
      short(deny));
    delete r.ownership[group[0]];
    delete r.ownership[group[1]];

    // Plenty of money: easy still lets about one street in three go by, and
    // the same question asked twice gets the same answer.
    b.money = 50_000;
    const streets = r.map.tiles.filter((t) => t.type === 'property');
    r.settings.botLevel = 'easy';
    const first = streets.map((t) => r.botBuys(b, t.index));
    const again = streets.map((t) => r.botBuys(b, t.index));
    const yes = first.filter(Boolean).length;
    PASS(yes > 0 && yes < streets.length && isDeepStrictEqual(first, again),
      'rich, an easy bot still passes on some streets — the same ones every time it is asked',
      `${yes}/${streets.length} bought`);
    r.settings.botLevel = 'hard';
    PASS(streets.every((t) => r.botBuys(b, t.index)), 'rich, a hard bot buys every one');

    // Building: a full colour, and enough cash for most of three houses each.
    const cheap = Object.values(r.map.groups)
      .filter((g) => g.length === 3)
      .sort((x, y) => r.tile(x[0]).houseCost - r.tile(y[0]).houseCost)[0];
    const cost = r.tile(cheap[0]).houseCost;
    const built = {};
    // Building happens on the builder's own turn.
    r.turn = { ...r.turn, playerId: b.id, phase: 'end', rolledThisTurn: true };
    for (const lvl of BOT_LEVELS) {
      for (const i of cheap) r.ownership[i] = { owner: b.id, houses: 0, mortgaged: false };
      b.money = cost * 9 + 25;
      at(lvl, () => r.botBuild(b));
      built[lvl] = cheap.map((i) => r.own(i).houses);
    }
    const sum = (a) => a.reduce((n, x) => n + x, 0);
    PASS(sum(built.easy) === 1, 'easy builds one house a turn at most', short(built.easy));
    PASS(built.hard.every((h) => h >= 3) && sum(built.hard) >= sum(built.normal) && sum(built.normal) > sum(built.easy),
      'hard takes the whole colour to three houses on cash a normal bot would not spend', short(built));
    for (const i of cheap) delete r.ownership[i];
    r.turn = { ...r.turn, playerId: 'h', phase: 'roll', rolledThisTurn: false };

    // Trading: a swap that finishes a colour for each side, on the table.
    const [ga, gb] = Object.values(r.map.groups).filter((g) => g.length === 3);
    const own = (i, who) => { r.ownership[i] = { owner: who.id, houses: 0, mortgaged: false }; };
    own(ga[0], b); own(ga[1], b); own(ga[2], c);
    own(gb[0], c); own(gb[1], c); own(gb[2], b);
    b.money = 1500; c.money = 1500;
    const offers = {};
    for (const lvl of BOT_LEVELS) {
      r.trades = [];
      b.askedAt = {}; b.lastAskedAt = undefined;
      at(lvl, () => r.botMaybeTrade(b));
      offers[lvl] = r.trades.filter((t) => t.from === b.id).length;
    }
    PASS(offers.easy === 0 && offers.normal === 1 && offers.hard === 1,
      'a colour-for-a-colour swap: normal and hard send it, an easy bot never starts a trade', short(offers));
    const gap = {};
    for (const lvl of ['normal', 'hard']) {
      r.trades = [];
      b.askedAt = {}; b.lastAskedAt = r.turnCount - 3;
      at(lvl, () => r.botMaybeTrade(b));
      gap[lvl] = r.trades.filter((t) => t.from === b.id).length;
    }
    PASS(gap.normal === 0 && gap.hard === 1, 'three turns after its last offer, only a hard bot is back at the door', short(gap));
    r.trades = [];
    for (const i of [...ga, ...gb]) delete r.ownership[i];

    // Auctions: the most each will bid for an ordinary street.
    b.money = 5000;
    const caps = Object.fromEntries(BOT_LEVELS.map((lvl) => [lvl, at(lvl, () => r.botAuctionCap(b, { tile: prop.index }))]));
    PASS(caps.easy < caps.normal && caps.normal <= caps.hard && caps.easy <= Math.floor(prop.price / 2) && caps.hard >= prop.price - 5,
      `the ceiling at auction for a $${prop.price} street: easy low, hard close to the sticker`, short(caps));
    // And never past it, whatever the bot's temper: the dial runs from 0.85
    // to 1.15, and the hottest hard bot once bid 15% over the sticker for a
    // street in nobody's colour race, where the API doc says it stops.
    const ordinary = r.map.tiles.filter((t) => t.type === 'property' && !r.botSetRelevant(b, t.index));
    const strays = [];
    for (let k = 0; k <= 30; k++) {
      const temper = 0.85 + k / 100;
      r.botTemper = () => temper;
      for (const t of ordinary) {
        const cap = at('hard', () => r.botAuctionCap(b, { tile: t.index }));
        if (cap > t.price || cap < t.price - 5) strays.push(`${t.name} $${t.price} at ${temper.toFixed(2)}: ${cap}`);
      }
    }
    delete r.botTemper;
    r.auctionCaps = {};
    PASS(ordinary.length > 10 && !strays.length,
      `at any temper a hard bot stops between $5 under the sticker and the sticker, on all ${ordinary.length} ordinary streets`, strays.slice(0, 3).join('; '));
  }

  section('a seeded table, played at easy and at hard');
  {
    const play = (seed, botLevel, turns = 150) => {
      Math.random = mulberry32(seed);
      try {
        const room = bare({ humans: ['watcher'], bots: 3, settings: { botLevel } });
        const pending = [];
        room.scheduleBotTrade = (id) => pending.push(id);
        let offers = 0;
        const propose = room.proposeTrade.bind(room);
        room.proposeTrade = (id, o) => {
          const res = propose(id, o);
          if (res?.ok && room.player(id)?.isBot) offers++;
          return res;
        };
        room.start('watcher');
        // The one person at the table is on autopilot — and plays normal.
        room.player('watcher').botControlled = true;
        let steps = 0;
        let crash = null;
        while (room.status === 'playing' && room.turnCount < turns && steps++ < 20000) {
          try {
            room.runBot();
            if (room.auction) room.runBotAuction();
            while (pending.length) room.botTradeReply(pending.shift());
          } catch (err) { crash = err.message; break; }
        }
        const bots = room.players.filter((p) => p.isBot);
        const total = (k) => bots.reduce((n, p) => n + (room.stats[p.id]?.[k] || 0), 0);
        return {
          streets: total('streetsBought'),
          houses: total('housesBuilt'),
          offers,
          steps,
          crash,
          settled: room.status === 'ended' || room.turnCount >= turns,
          sig: JSON.stringify([room.turnCount, room.ownership, room.players.map((p) => [p.id, p.money, p.pos]), room.stats]),
        };
      } finally {
        Math.random = realRandom;
      }
    };
    const seeds = [11, 33, 55];
    const runs = seeds.map((s) => ({ seed: s, easy: play(s, 'easy'), hard: play(s, 'hard') }));
    const tot = (lvl, k) => runs.reduce((n, r) => n + r[lvl][k], 0);
    PASS(runs.every((r) => !r.easy.crash && !r.hard.crash && r.easy.settled && r.hard.settled),
      'every table runs to its end or its turn cap without a crash, inside the step budget',
      runs.map((r) => `${r.seed}: ${r.easy.steps}/${r.hard.steps} steps`).join(', '));
    PASS(tot('hard', 'streets') > tot('easy', 'streets'), 'the hard bots buy more streets than the easy ones, dealt the same dice',
      `${tot('hard', 'streets')} against ${tot('easy', 'streets')}`);
    PASS(tot('hard', 'houses') > tot('easy', 'houses'), 'and build more houses', `${tot('hard', 'houses')} against ${tot('easy', 'houses')}`);
    PASS(tot('easy', 'offers') === 0 && tot('hard', 'offers') > 0, 'the easy bots never once offered a trade; the hard ones did',
      `${tot('hard', 'offers')} offers from the hard bots`);
    const replay = { easy: play(11, 'easy').sig, hard: play(11, 'hard').sig };
    PASS(replay.easy === runs[0].easy.sig && replay.hard === runs[0].hard.sig && runs[0].easy.sig !== runs[0].hard.sig,
      'dealt the same seed again, each table plays exactly the same game — and the two skills two different ones');
  }

  section('the game clock: arming it');
  {
    const r = bare({ settings: { timeLimit: 30 } });
    const before = Date.now();
    r.start('a');
    const s = r.serialize();
    const want = 30 * GameRoom.CLOCK.minuteMs;
    PASS(s.endsAt >= before + want && s.endsAt <= Date.now() + want && s.timeUp === false && s.endReason === null,
      'a 30-minute table starts with the clock set thirty minutes out', short({ in: s.endsAt - before, timeUp: s.timeUp }));
    PASS(logText(r).some((t) => t === 'A 30-minute game — when the clock runs out, the richest player wins'),
      'and the log says what kind of game it is');
    PASS(typeof s.startedAt === 'number' && s.startedAt >= before && s.spectators === 0,
      'the state carries when the dice started, and a watcher count of 0', short({ startedAt: s.startedAt, spectators: s.spectators }));
    const u = bare();
    u.start('a');
    PASS(u.serialize().endsAt === null && !u.timers.gameClock, 'an untimed table has no clock at all');

    const q = bare();
    q.quick = true;
    q.settings.timeLimit = 30;
    q.status = 'playing';
    q.armGameClock();
    const c = bare();
    c.cupMatch = 'm-test';
    c.settings.timeLimit = 30;
    c.status = 'playing';
    c.armGameClock();
    PASS(q.endsAt === null && !q.timers.gameClock && c.endsAt === null && !c.timers.gameClock,
      'a Play-now table and a cup table never get one, even with the setting forced past the door');
    PASS(r.serialize().turn?.endsAt === null, 'the game clock is not the shot clock: turn.endsAt is its own (off here)');
    const lobby = bare({ settings: { timeLimit: 20 } });
    PASS(lobby.serialize().endsAt === null && lobby.serialize().startedAt === null && lobby.serialize().endReason === null,
      'in the lobby there is no clock yet, no start time and no ending');
  }

  section('time\'s up between turns: decided on the spot');
  {
    const r = bare({ humans: ['a', 'b', 'c'], settings: { timeLimit: 20 } });
    r.start('a');
    r.player('a').money = 1500;
    r.player('b').money = 4000;
    // C has less cash than B, but a street and a house on it: net worth wins.
    const street = r.map.tiles.find((t) => t.type === 'property' && t.houseCost === 50 && t.price === 60);
    r.player('c').money = 3800;
    r.ownership[street.index] = { owner: 'c', houses: 3, mortgaged: false };
    PASS(r.netWorth(r.player('c')) === 3800 + 60 + 150 && r.turn.phase === 'roll' && !r.turn.rolledThisTurn,
      'A is about to roll; B holds $4,000 in cash, C is worth $4,010 in cash, a deed and houses');
    r.clockRanOut();
    const s = r.serialize();
    PASS(s.status === 'ended' && s.winner?.id === 'c' && s.endReason === 'time' && s.timeUp === true,
      'the clock runs out and the game is over at once: C, the richest, wins', short({ status: s.status, winner: s.winner?.name, endReason: s.endReason }));
    const lines = logText(r);
    PASS(lines.includes("Time's up — richest player wins") && lines.includes('🏆 C wins the game!'),
      'the log says time is up and who won', short(lines.slice(-3)));
    PASS(!r.players.some((p) => p.bankrupt || p.timedOut || p.removedFor) && r.player('b').money === 4000,
      'nobody was knocked out to end it: every seat keeps what it had');
    PASS(r.titles && Object.keys(r.titles).length > 0 && r.history.at(-1)?.w?.c === r.netWorth(r.player('c')),
      'titles are handed out and the final net-worth snapshot is taken, like any other ending');
    r.clockRanOut();
    r.clockStop();
    r.nextTurn();
    PASS(r.finishOnTime() === false && endings(r) === 1 && lines.filter((t) => t === "Time's up — richest player wins").length === 1
      && logText(r).filter((t) => t === "Time's up — richest player wins").length === 1,
    'the end is reached once: every door to it afterwards is a no-op', `transitions: ${r.transitions.join(' → ')}`);
  }

  section('time\'s up mid-turn: the turn in progress is the last one');
  {
    const r = bare({ humans: ['a', 'b', 'c'], settings: { timeLimit: 20 } });
    r.start('a');
    r.roll('a', [1, 2]);                    // Rio, a street: a decision is waiting
    PASS(r.turn.phase === 'action' && r.midTurn(), 'A has rolled and is deciding on a street');
    r.clockRanOut();
    PASS(r.status === 'playing' && r.timeUp && r.serialize().timeUp === true
      && logText(r).includes("Time's up — this is the last turn"),
    'the clock runs out: the game waits for A, and says this is the last turn');
    PASS(!!r.timers.gameClockStop, 'with a hard stop armed behind it');
    r.skipBuy('a');
    r.endTurn('a');
    const after = logText(r).slice(logText(r).indexOf("Time's up — this is the last turn"));
    PASS(r.status === 'ended' && r.endReason === 'time' && r.turn.playerId === 'a' && !after.some((t) => /'s turn$/.test(t)),
      'A ends the turn and the game ends with it — nobody else is handed the dice', short(after));
    PASS(!r.timers.gameClockStop && endings(r) === 1, 'the hard stop is cleared and the end came once');

    const d = bare({ humans: ['a', 'b'], settings: { timeLimit: 20 } });
    d.start('a');
    d.roll('a', [2, 2]);                    // the tax square, and a double: roll again
    PASS(d.turn.phase === 'roll' && d.turn.rolledThisTurn, 'A rolls a double and is owed another throw');
    d.clockRanOut();
    PASS(d.status === 'playing', 'the clock runs out between the two throws: the turn is still A\'s');
    d.roll('a', [1, 1]);                    // another double, onto a street
    d.skipBuy('a');
    PASS(d.turn.phase === 'end', 'a second double after time is up buys no third throw', d.turn.phase);
    d.endTurn('a');
    PASS(d.status === 'ended' && endings(d) === 1, 'and the end of that turn is the end of the game');
  }

  section('the hard stop, the clock firing by itself, and a debt');
  {
    GameRoom.CLOCK.graceMs = 40;
    GameRoom.CLOCK.minuteMs = 3;
    const r = bare({ settings: { timeLimit: 20 } });
    r.start('a');
    r.roll('a', [1, 2]);
    r.clockRanOut();
    PASS(r.status === 'playing', 'A walks away mid-turn on a table with no shot clock');
    const stopped = await until(() => r.status === 'ended', 1000, 10);
    PASS(stopped && r.endReason === 'time' && endings(r) === 1, 'the hard stop ends the game anyway');

    const t = bare({ settings: { timeLimit: 20 } });
    t.start('a');
    PASS(t.endsAt - Date.now() <= 60 && t.endsAt - Date.now() > 0, 'a 20-"minute" game at three milliseconds a minute');
    const ended = await until(() => t.status === 'ended', 1500, 10);
    PASS(ended && t.endReason === 'time' && endings(t) === 1, 'the clock fires by itself and ends the game');

    const debt = bare({ humans: ['a', 'b', 'c'], settings: { timeLimit: 20 } });
    debt.start('a');
    debt.player('a').money = -200;
    debt.player('b').money = 0;
    debt.player('c').money = 0;
    debt.turn.phase = 'debt';
    debt.turn.rolledThisTurn = true;
    debt.turn.debt = { debtor: 'a', creditor: null, amount: 200, owedTo: [], owedLeft: [] };
    debt.clockRanOut();
    PASS(debt.status === 'playing', 'the clock runs out on a player who owes the bank: the bill is part of the turn');
    await until(() => debt.status === 'ended', 1000, 10);
    PASS(debt.status === 'ended' && debt.winner?.id === 'b' && debt.player('a').money === 0 && !debt.turn.debt,
      'ranked with the debt, not without it: B wins the tie at $0, then the bill is written off',
      short({ winner: debt.winner?.name, a: debt.player('a').money }));
  }
}

async function inProcessAsync() {
  const was = { ...GameRoom.CLOCK };
  try {
    await inProcess();
  } finally {
    Object.assign(GameRoom.CLOCK, was);
  }

  section('teams on the clock');
  {
    const r = bare({ humans: ['a', 'b', 'c', 'd'], settings: { timeLimit: 20, teams: 2 } });
    r.setTeam('a', 0); r.setTeam('b', 0); r.setTeam('c', 1); r.setTeam('d', 1);
    r.start('a');
    // A is the richest single player, but Team Azure is worth more together.
    r.player('a').money = 6000; r.player('b').money = 100;
    r.player('c').money = 3200; r.player('d').money = 3000;
    r.clockRanOut();
    const s = r.serialize();
    PASS(s.status === 'ended' && s.winningTeam === 1 && s.winner?.id === 'c' && s.endReason === 'time',
      'the team worth the most together wins ($6,200 to $6,100), and its richest member is named', short({ team: s.winningTeam, winner: s.winner?.name }));
    PASS(logText(r).includes("Time's up — richest player wins") && logText(r).includes('🏆 Team Azure wins the game! (C & D)'),
      'and the log names the team and both of its players', short(logText(r).slice(-2)));

    const tie = bare({ humans: ['a', 'b', 'c', 'd'], settings: { timeLimit: 20, teams: 2 } });
    tie.setTeam('a', 0); tie.setTeam('b', 0); tie.setTeam('c', 1); tie.setTeam('d', 1);
    tie.start('a');
    tie.player('a').money = 3000; tie.player('b').money = 1000;
    tie.player('c').money = 2500; tie.player('d').money = 1500;
    tie.clockRanOut();
    PASS(tie.winningTeam === 0 && tie.winner?.id === 'a', 'level on $4,000 each: the team of the single richest player wins it');

    const out = bare({ humans: ['a', 'b', 'c', 'd'], settings: { timeLimit: 20, teams: 2 } });
    out.setTeam('a', 0); out.setTeam('b', 0); out.setTeam('c', 1); out.setTeam('d', 1);
    out.start('a');
    out.player('a').money = 3000; out.player('b').money = 2000;
    out.player('c').money = 4000; out.player('d').money = 900;
    out.bankrupt(out.player('b'), null);
    out.clockRanOut();
    PASS(out.winningTeam === 1 && out.winner?.id === 'c' && endings(out) === 1,
      'a teammate who went out counts for nothing: $3,000 standing against $4,900');
  }

  section('rematch, the watchdog, and the cup\'s whistle');
  {
    const r = bare({ settings: { timeLimit: 45 } });
    r.start('a');
    r.clockRanOut();
    r.rematch('a');
    const s = r.serialize();
    PASS(s.status === 'lobby' && s.endsAt === null && s.timeUp === false && s.endReason === null && !r.timers.gameClock,
      'Play again: last game\'s clock and ending are gone');
    r.start('a');
    PASS(r.endsAt > Date.now() && r.timeUp === false && r.status === 'playing', 'and the next game gets a fresh clock');

    // A person holds the turn but has gone; nothing else is due. The game
    // clock is pending for the whole game — and is not a reason to think the
    // table is moving.
    r.player(r.turn.playerId).connected = false;
    PASS(!!r.timers.gameClock && r.workPending() === false, 'the watchdog does not count the game clock as work');

    const cupRoom = bare();
    cupRoom.cupMatch = 'm-test';
    cupRoom.start('a');
    cupRoom.quit('b', { whistle: true });
    const plain = bare();
    plain.start('a');
    plain.quit('b');
    PASS(cupRoom.serialize().endReason === 'time' && plain.serialize().endReason === 'last',
      'a cup game decided at the whistle ended on the clock; a walkout ended the long way',
      `${cupRoom.serialize().endReason} / ${plain.serialize().endReason}`);
    const order = bare({ humans: ['a', 'b', 'c'] });
    order.start('a');
    order.player('a').money = 1000; order.player('b').money = 3000; order.player('c').money = 3000;
    PASS(isDeepStrictEqual(order.rankByWorth().map((p) => p.id), ['b', 'c', 'a']),
      'the shared ranking: richest first, equal fortunes in seat order');
  }
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

const ADMIN = `admin-${hex(4)}`;
const MINUTE_MS = 200;
const QUICK = {
  gatherMs: 600, botWindowMs: 300, startWindowMs: 6000, settleMs: 300,
  hardStopMs: 10000, backfillMs: 200, botReadyMs: [10, 40], joinCutoffMs: 100,
};

async function startServer(name, dir, attempt = 1) {
  const port = await freePort();
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(APPLE_|GOOGLE_|APNS_|STRIPE_|FCM_|PLAY_)/.test(k)) delete env[k];
  }
  delete env.RENDER;
  delete env.NODE_ENV;
  delete env.MONEYMOVE_TEST_HOOKS;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...env,
      PORT: String(port),
      DATA_DIR: dir,
      ADMIN_KEY: ADMIN,
      MM_CLOCK_MS: JSON.stringify({ minuteMs: MINUTE_MS, graceMs: 4000 }),
      MM_QUICK_MS: JSON.stringify(QUICK),
    },
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

async function get(srv, p) {
  const res = await fetch(srv.url + p);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const enc = encodeURIComponent;

function seat(srv, name) {
  const token = `t106-${name.toLowerCase()}-${hex(6)}`;
  const sock = io(srv.url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(sock);
  const chair = {
    sock, name, token, state: null, seq: 0, toasts: [], progress: [], failed: [], you: null,
  };
  sock.on('state', (s) => { chair.state = s; chair.seq++; });
  sock.on('toast', (t) => chair.toasts.push(t?.message));
  sock.on('progress', (p) => chair.progress.push(p));
  sock.on('joinFailed', (f) => chair.failed.push(f));
  sock.on('you', (y) => { chair.you = y; });
  chair.emit = (...a) => sock.emit(...a);
  chair.create = () => new Promise((r) => sock.emit('createRoom', { token }, (d) => r(d?.roomId || '')));
  chair.join = (roomId, extra = {}) => sock.emit('join', { roomId, token: extra.token || token, name, flag: '', ...extra });
  chair.mine = () => chair.state?.status === 'playing' && chair.state.turn?.playerId === token;
  chair.close = () => sock.close();
  return chair;
}

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
    else if (phase === 'debt') chair.emit(tries > 2 ? 'bankrupt' : 'payDebt');
    else chair.emit('endTurn');
    await until(() => chair.seq !== seq, 1500, 10);
  }
  return !chair.mine();
}

/** Everyone takes their turns until the game is over (or the patience runs out). */
async function playUntilOver(chairs, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end && chairs[0].state?.status === 'playing') {
    const chair = chairs.find((c) => c.mine());
    if (!chair) { await sleep(20); continue; }
    await playTurn(chair);
  }
  return chairs.every((c) => c.state?.status === 'ended')
    || until(() => chairs.every((c) => c.state?.status === 'ended'), 3000);
}

/** The richest standing seat in a final state, equal fortunes in seat order. */
function richestOf(rows) {
  return [...rows].filter((p) => !p.bankrupt).sort((a, b) => b.netWorth - a.netWorth)[0];
}

/** A table: the host creates it and sits, the others sit, the settings go in. */
async function table(srv, chairs, settings = {}) {
  const [host] = chairs;
  const roomId = await host.create();
  for (const c of chairs) {
    c.join(roomId);
    await until(() => c.state?.id === roomId && c.state.players.some((p) => p.id === c.token));
  }
  await until(() => host.state?.players?.length === chairs.length);
  if (Object.keys(settings).length) {
    const seq = host.seq;
    host.emit('settings', settings);
    await until(() => host.seq !== seq);
  }
  return roomId;
}

async function overTheWire() {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'wire-'));
  const S = await startServer('tables', dir);
  const admin = async () => (await get(S, `/api/admin/data?key=${enc(ADMIN)}`)).json;

  section('the lobby, over the socket');
  {
    const host = seat(S, 'Hana');
    const guest = seat(S, 'Gita');
    await table(S, [host, guest]);
    host.emit('settings', { botLevel: 'brutal' });
    host.emit('settings', { timeLimit: 25 });
    await until(() => host.toasts.length >= 2);
    PASS(host.toasts.includes('Bot skill is easy, normal or hard') && host.toasts.includes('Game length is 20, 30, 45 or 60 minutes, or no limit'),
      'the host is told plainly what is wrong with a bad skill or length', short(host.toasts));
    let seq = host.seq;
    host.emit('settings', { botLevel: 'hard', timeLimit: 20 });
    await until(() => host.seq !== seq && host.state.settings.botLevel === 'hard');
    PASS(host.state.settings.botLevel === 'hard' && host.state.settings.timeLimit === 20
      && guest.state.settings.botLevel === 'hard' && guest.state.settings.timeLimit === 20,
    'good values land in everybody\'s settings', short({ botLevel: guest.state.settings.botLevel, timeLimit: guest.state.settings.timeLimit }));
    seq = host.seq;
    guest.emit('settings', { botLevel: 'easy', timeLimit: 60 });
    await sleep(250);
    PASS(host.state.settings.botLevel === 'hard' && host.state.settings.timeLimit === 20, 'a guest changes nothing');
    host.close(); guest.close();
  }

  section('a timed game, two players, to the end');
  {
    const p = seat(S, 'Pia');
    const q = seat(S, 'Quin');
    // As much cash as a table may start with: the point is the clock, and a
    // run of bad dice that bankrupts somebody inside the (shortened) twenty
    // minutes would end the game the other way and fail this for nothing.
    const roomId = await table(S, [p, q], { timeLimit: 20, auction: false, startingCash: 10000 });
    const before = Date.now();
    p.emit('start');
    await until(() => p.state?.status === 'playing' && q.state?.status === 'playing');
    const endsIn = (p.state?.endsAt || 0) - before;
    const opening = p.state?.log?.map((l) => l.text) || [];
    PASS(p.state?.status === 'playing' && endsIn > 20 * MINUTE_MS - 500 && endsIn <= 20 * MINUTE_MS + 50 && p.state.timeUp === false,
      `the game starts with the clock on it (a "minute" is ${MINUTE_MS}ms here)`, `${endsIn}ms`);
    const over = await playUntilOver([p, q]);
    const fin = p.state;
    const best = richestOf(fin?.players || []);
    PASS(!!over && fin.endReason === 'time' && fin.winner?.id === best?.id && q.state?.endReason === 'time',
      'the clock runs out and the richest player wins', short({ winner: fin?.winner?.name, best: best?.name, worth: fin?.players?.map((x) => [x.name, x.netWorth]) }));
    const said = fin.log.map((l) => l.text);
    PASS(said.filter((t) => t === "Time's up — richest player wins").length === 1
      && opening.includes('A 20-minute game — when the clock runs out, the richest player wins'),
    'the log says what kind of game it is at the start, and that time is up — once — at the end', short(said.slice(-4)));
    PASS(fin.turnCount >= 4 && fin.stats && fin.titles, 'enough turns were played to count, and the results are on the table',
      `${fin.turnCount} turns`);
    await until(() => p.progress.length && q.progress.length, 3000);
    await sleep(300);
    PASS(p.progress.length === 1 && q.progress.length === 1 && p.progress[0].roomId === roomId,
      'each player is sent their XP once', `${p.progress.length} / ${q.progress.length}`);
    const winner = fin.winner.id === p.token ? p : q;
    const code = (await get(S, `/api/me?token=${enc(winner.token)}`)).json?.code;
    const board = (await get(S, '/api/leaderboard')).json;
    PASS(board?.top?.find((r) => r.code === code)?.wins === 1, 'the winner has exactly one win on the board', short(board?.top));
    const recent = (await admin())?.recentGames || [];
    PASS(recent.filter((g) => g.roomId === roomId).length === 1, 'and the game is in the record once');
    p.close(); q.close();
  }

  section('a timed game in teams, to the end');
  {
    const crew = ['Tara', 'Uma', 'Vik', 'Wes'].map((n) => seat(S, n));
    const roomId = await table(S, crew, { timeLimit: 20, auction: false, teams: 2 });
    for (const [i, c] of crew.entries()) {
      const seq = crew[0].seq;
      c.emit('team', i < 2 ? 0 : 1);
      await until(() => crew[0].seq !== seq);
    }
    await until(() => crew[0].state.players.every((x) => x.team != null));
    crew[0].emit('start');
    await until(() => crew.every((c) => c.state?.status === 'playing'));
    PASS(crew[0].state.status === 'playing' && crew[0].state.endsAt > Date.now(), 'four people, two teams, on the clock');
    const over = await playUntilOver(crew);
    const fin = crew[0].state;
    const totals = [0, 1].map((team) => fin.players.filter((x) => x.team === team && !x.bankrupt).reduce((n, x) => n + x.netWorth, 0));
    const richest = richestOf(fin.players);
    const wantTeam = totals[0] === totals[1] ? richest.team : (totals[0] > totals[1] ? 0 : 1);
    const wantWinner = richestOf(fin.players.filter((x) => x.team === wantTeam));
    PASS(!!over && fin.endReason === 'time' && fin.winningTeam === wantTeam && fin.winner?.id === wantWinner?.id,
      'the team worth the most together wins, its richest member named', short({ totals, team: fin.winningTeam, winner: fin.winner?.name }));
    await sleep(500);
    const counted = fin.turnCount >= 2 * crew.length;
    PASS(crew.every((c) => c.progress.length === (counted ? 1 : 0)),
      counted ? 'all four are sent their XP once' : 'too few turns to count, so nobody is sent XP',
      `${fin.turnCount} turns; ${crew.map((c) => c.progress.length).join('/')}`);
    const recent = (await admin())?.recentGames || [];
    PASS(recent.filter((g) => g.roomId === roomId).length === 1 && recent.find((g) => g.roomId === roomId)?.winningTeam === wantTeam,
      'the game is in the record once, with the winning team');
    crew.forEach((c) => c.close());
  }

  section('watching a live table');
  let watched = '';
  let w = null;
  let ann = null;
  let ben = null;
  {
    ann = seat(S, 'Ann');
    ben = seat(S, 'Ben');
    watched = await table(S, [ann, ben], { isPrivate: false, auction: false, turnSeconds: 0 });
    ann.emit('start');
    await until(() => ann.state?.status === 'playing' && ben.state?.status === 'playing');
    const turnBefore = ann.state.turn.playerId;

    w = seat(S, 'Wendy');
    w.join(watched, { spectate: true });
    await until(() => w.state?.id === watched && ann.state?.spectators === 1);
    await sleep(300);
    PASS(w.state?.status === 'playing' && w.state.players.length === 2 && !w.state.players.some((x) => x.name === 'Wendy'),
      'a watcher is sent the table and sits nowhere', short(w.state?.players?.map((x) => x.name)));
    PASS(w.failed.length === 0 && w.toasts.length === 0 && w.you?.spectator === true && w.you.roomId === watched,
      'no "joinFailed", no toast — and told they are watching', short({ failed: w.failed, toasts: w.toasts, you: w.you && { ...w.you, playerId: '…' } }));
    PASS(w.state.spectators === 1 && ann.state.spectators === 1 && ben.state.spectators === 1,
      'everyone at the table sees one watcher');
    PASS(!ann.state.log.some((l) => /Wendy/.test(l.text)), 'and nobody was told Wendy joined the game');
    const wire = JSON.stringify(w.state);
    PASS(!wire.includes(ann.token) && !wire.includes(ben.token) && !wire.includes(w.token),
      'the watcher\'s state carries no token — theirs or anybody\'s');

    for (const ev of ['roll', 'endTurn', 'buy', 'bankrupt', 'quit', 'rematch', 'start']) w.emit(ev);
    w.emit('chat', 'let me play', 'all');
    w.emit('settings', { botLevel: 'easy' });
    w.emit('trade:propose', { to: ann.state.players[0].id, give: { money: 1 }, get: { money: 0 } });
    await until(() => w.toasts.length >= 10, 2000);
    await sleep(200);
    PASS(w.toasts.length >= 10 && w.toasts.every((m) => m === 'You are watching this game'),
      'every action from the rail is refused, and says why', `${w.toasts.length} × "${w.toasts[0]}"`);
    PASS(ann.state.turn.playerId === turnBefore && !ann.state.players.some((x) => x.bankrupt)
      && !ann.state.chat.some((m) => m.text === 'let me play') && ann.state.trades.length === 0
      && ann.state.settings.botLevel === 'normal',
    'and the game did not move: same turn, nobody out, no chat line, no offer, same settings');

    // The same identity as a seated player, watching from another device.
    const annTab = seat(S, 'Ann');
    annTab.token = ann.token;
    annTab.join(watched, { spectate: true, token: ann.token });
    await until(() => annTab.state?.id === watched);
    await sleep(200);
    const annRow = () => ann.state.players.find((x) => x.id === ann.token);
    PASS(annRow()?.connected === true && ann.state.spectators === 1 && !JSON.stringify(annTab.state).includes(ann.token),
      'Ann watching on a second device: still one watcher, her seat untouched, her token not in that state');
    const seq = ann.seq;
    annTab.emit('roll');
    annTab.emit('bankrupt');
    await until(() => annTab.toasts.length >= 2, 1500);
    await sleep(200);
    PASS(annTab.toasts.every((m) => m === 'You are watching this game') && !annRow()?.bankrupt && ann.state.turn.playerId === turnBefore,
      'and nothing sent from that rail is played in her name', `${ann.seq - seq} pushes`);
    annTab.close();
    await sleep(400);
    PASS(annRow()?.connected === true && !ann.state.log.some((l) => /Ann lost connection/.test(l.text)),
      'when it closes, her seat is still connected — the rail held no seat to give up');

    // A second watcher on a build that takes patches (proto 2) starts from a
    // whole state, like any other socket, and is then sent only what moves.
    const x = seat(S, 'Xena');
    const patches = [];
    x.sock.on('statePatch', (m) => patches.push(m));
    x.join(watched, { spectate: true, proto: 2 });
    await until(() => ann.state.spectators === 2 && x.state?.id === watched);
    PASS(ann.state.spectators === 2 && x.state?.spectators === 2 && !JSON.stringify(x.state).includes(ann.token),
      'a second watcher makes two — on a patching build too, which starts from a whole state');
    const yuri = seat(S, 'Yuri');
    yuri.join(watched, { spectate: true });
    await until(() => patches.some((m) => m.patch?.s?.spectators === 3), 2000);
    PASS(patches.some((m) => m.patch?.s?.spectators === 3) && patches.every((m) => !JSON.stringify(m).includes(ann.token)),
      'a third arrives, and the patching watcher is sent the new count as a patch', short(patches.at(-1)));
    x.close();
    yuri.close();
    await until(() => ann.state.spectators === 1);
    PASS(ann.state.spectators === 1, 'and leaving makes one again');

    const lost = seat(S, 'Lost');
    lost.join('zz9zz', { spectate: true });
    await until(() => lost.failed.length, 2000);
    const rooms = ((await admin())?.rooms || []).map((r) => r.id);
    PASS(lost.failed[0]?.message === 'That game has finished' && lost.failed[0]?.spectate === false && !rooms.includes('zz9zz'),
      'watching a table that is not there says so — and does not open one', short(lost.failed[0]));
    lost.close();

    // From the rail to a chair, only by asking for one.
    const lobbyHost = seat(S, 'Lou');
    const lobbyId = await table(S, [lobbyHost]);
    const y = seat(S, 'Yan');
    y.join(lobbyId, { spectate: true });
    await until(() => lobbyHost.state?.spectators === 1);
    PASS(lobbyHost.state.players.length === 1 && y.state?.status === 'lobby', 'a watcher in a lobby is not seated in it either');
    y.join(lobbyId);
    await until(() => lobbyHost.state?.players?.length === 2);
    PASS(lobbyHost.state.players.length === 2 && lobbyHost.state.spectators === 0 && y.state.players.some((p) => p.id === y.token),
      'joining without spectate is what seats them — and the watcher count drops');
    lobbyHost.close(); y.close();
  }

  section('GET /api/live');
  {
    const live = async () => (await get(S, '/api/live')).json?.games || [];
    let games = await live();
    const card = games.find((g) => g.roomId === watched);
    PASS(!!card, 'the public table being played is listed', short(games.map((g) => g.roomId)));
    PASS(isDeepStrictEqual(Object.keys(card || {}).sort(), ['endsAt', 'mapId', 'mapName', 'players', 'roomId', 'startedAt', 'turnCount', 'watching'])
      && card.players.every((p) => isDeepStrictEqual(Object.keys(p).sort(), ['avatar', 'bot', 'color', 'flag', 'level', 'name', 'out'])),
    'each game: room, board, seats, turn count, start, clock, watchers — and each seat only what the board shows', short(card));
    PASS(card?.mapName === ann.state.map.name && card.turnCount === ann.state.turnCount && Number.isInteger(card.turnCount) && card.watching === 1
      && card.endsAt === null && typeof card.startedAt === 'number'
      && card.players.map((p) => p.name).sort().join() === 'Ann,Ben'
      && card.players.every((p) => p.level >= 1 && p.bot === false && p.out === false && /^#/.test(p.color)),
    'and says what the table says: the board, the turn, one watcher, Ann and Ben at level 1 or more', short(card));
    const text = JSON.stringify(games);
    PASS(![ann.token, ben.token, w.token].some((t) => text.includes(t)) && !/"(id|code|token|hostId)"/.test(text),
      'no tokens, ids or friend codes anywhere in it');

    // What is never listed.
    const priv = seat(S, 'Pri');
    const privId = await table(S, [priv]);
    priv.emit('addBot');
    await until(() => priv.state?.players?.length === 2);
    priv.emit('start');
    await until(() => priv.state?.status === 'playing');
    const lob = seat(S, 'Lob');
    const lobId = await table(S, [lob], { isPrivate: false });
    const gone = seat(S, 'Gon');
    const goneId = await table(S, [gone], { isPrivate: false });
    gone.emit('addBot');
    await until(() => gone.state?.players?.length === 2);
    gone.emit('start');
    await until(() => gone.state?.status === 'playing');
    games = await live();
    PASS(games.some((g) => g.roomId === goneId), 'a public table with a person at it is listed');
    gone.close();
    await sleep(400);
    games = await live();
    const ids = games.map((g) => g.roomId);
    PASS(!ids.includes(privId) && !ids.includes(lobId) && !ids.includes(goneId),
      'never a private table, a lobby, or a table whose only person has gone', short(ids));

    // A Play-now table: its house players are people here too.
    const quick = seat(S, 'Quinn');
    const qid = await new Promise((r) => quick.sock.emit('quickplay', { token: quick.token }, (d) => r(d?.roomId || '')));
    quick.join(qid, { canReady: true });
    await until(() => quick.state?.players?.length === 4, 8000);
    await until(async () => {
      if (quick.state?.status === 'playing') return true;
      quick.emit('start');
      await sleep(250);
      return quick.state?.status === 'playing';
    }, 12000);
    games = await live();
    const qcard = games.find((g) => g.roomId === qid);
    PASS(quick.state?.status === 'playing' && qcard?.players?.length === 4 && qcard.players.every((p) => p.bot === false),
      'a Play-now table is listed, and none of its seats is called a bot — three of them are', short(qcard?.players?.map((p) => [p.name, p.bot])));

    // The most people first.
    const trio = ['Ola', 'Pam', 'Ray'].map((n) => seat(S, n));
    const trioId = await table(S, trio, { isPrivate: false, auction: false, turnSeconds: 0 });
    trio[0].emit('start');
    await until(() => trio.every((c) => c.state?.status === 'playing'));
    games = await live();
    PASS(games[0]?.roomId === trioId && games[1]?.roomId === watched,
      'three people at a table come before two, two before one', short(games.slice(0, 3).map((g) => [g.roomId, g.players.length])));

    // At most twenty.
    const many = Array.from({ length: 18 }, (_, i) => seat(S, `Solo${i}`));
    await Promise.all(many.map(async (c) => {
      await table(S, [c], { isPrivate: false });
      c.emit('addBot');
      await until(() => c.state?.players?.length === 2);
      c.emit('start');
      await until(() => c.state?.status === 'playing');
    }));
    games = await live();
    PASS(games.length === 20 && games[0].roomId === trioId, 'twenty-one public tables being played, twenty listed — the busiest first',
      `${games.length} listed`);
    for (const c of [...many, ...trio, quick, priv, lob, ann, ben, w]) c.close();
  }
}

let crashed = null;
try {
  await inProcessAsync();
  await overTheWire();
} catch (err) {
  crashed = err;
  failed++;
  console.log(`\n  FAIL  the test itself crashed — ${err?.stack || err}`);
} finally {
  Math.random = realRandom;
  for (const r of made) { try { r.dispose(); } catch { /* gone */ } }
  for (const s of sockets) { try { s.close(); } catch { /* closed */ } }
  await Promise.all(children.map(stop));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`\n${failed ? 'FAILED' : 'OK'} — ${passed} passed, ${failed} failed (${((Date.now() - started) / 1000).toFixed(1)}s)`);
process.exit(failed || crashed ? 1 : 0);
