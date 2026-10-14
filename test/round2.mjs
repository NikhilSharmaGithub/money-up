// 1.0.6, round two — the server half of the owner's second list.
//
//   G1  prison: the third failed roll walks out free, and moves
//   G2  the daily reward climbs 1 → 7 and starts again at 1
//   G5  a bankrupt player's properties: back to the bank, or auctioned one by one
//   G6  auction-only tables: every unowned street goes straight under the hammer
//   G7  the shuffled board: colour sets trade places, everything follows them
//   G8  every open trade is on the table for everyone, ids still aliased
//   G10 missions pay XP; the coins are for doing all three
//
// Each rule here has a sharper edge than the feature. A shuffle that moved a
// single airport, or split a set, or touched the board every other table on
// the box is sharing, is a broken game rather than a different one. An estate
// sale is a run of auctions dropped into somebody's turn — possibly before
// they rolled, possibly while a deed of their own was on offer — and the turn
// has to come back exactly as it was. A trade on the table for everyone must
// still never carry anybody's token. And a coin path must pay once.
//
// Two halves, the way tables-1-0-6.mjs does it. The first drives GameRoom,
// maps.js and social.js directly with the dice in its own hand, and plays
// seeded house-player games to the end. The second starts the real server
// and checks what actually reaches a phone: the shuffled map in the state,
// trades seen from a third seat and from the rail, the refusals a socket gets,
// and the daily and missions cards over HTTP.
//
//   node test/round2.mjs
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
  GameRoom, DEFAULT_SETTINGS, BANKRUPT_RULES,
} from '../server/game.js';
import { MAPS, shuffleMap, generateRandomMap } from '../server/maps.js';
import { buildDecks } from '../server/cards.js';

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
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-round2-'));
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The server's calendar day — server-local, as social.js keys it. */
const dayKey = (when = Date.now()) => {
  const d = new Date(when);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// A seedable Math.random, so a table of house players plays the same game
// every time it is dealt the same seed — the shuffle's seed included.
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
const seeded = (seed, fn) => {
  Math.random = mulberry32(seed);
  try { return fn(); } finally { Math.random = realRandom; }
};

// ============================================================ in process ==

let serial = 0;
const made = [];

/**
 * A room with every timer stubbed out, so each move is a direct call and the
 * test decides when a house player thinks, bids or answers an offer.
 */
function bare({ humans = ['a', 'b'], bots = 0, settings = {} } = {}) {
  const room = new GameRoom(`r2-${++serial}`, () => {});
  made.push(room);
  room.scheduleBot = () => {};
  room.maybeBot = () => {};
  room.maybeBotAuction = () => {};
  room.armAuctionTimer = () => {};
  room.scheduleBotTrade = () => {};
  for (const id of humans) room.addPlayer({ id, name: id.toUpperCase() });
  for (let i = 0; i < bots; i++) room.addBot();
  room.settings = {
    ...room.settings, randomizeOrder: false, turnSeconds: 0, auction: true, ...settings,
  };
  return room;
}
const logText = (room) => room.log.map((l) => l.text);
const freshTurn = (room, id, extra = {}) => {
  room.turn = {
    playerId: id, phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false, ...extra,
  };
};
const give = (room, id, tiles, extra = {}) => {
  for (const i of tiles) room.ownership[i] = { owner: id, houses: 0, mortgaged: false, ...extra };
};

/**
 * Play a table of house players (and one person the house is covering, so
 * the table counts as watched) until the game is over or the steps run out,
 * answering offers and bidding on the test's own clock. Returns what happened.
 */
function playOut(room, { maxSteps = 400000, check = null } = {}) {
  let stall = 0;
  let steps = 0;
  for (; steps < maxSteps && room.status === 'playing'; steps++) {
    const v = room.version;
    for (const t of [...room.trades]) {
      if (room.autoPlayed(room.player(t.to))) room.botTradeReply(t.id);
    }
    if (room.auction) {
      room.runBotAuction();
      if (room.version === v && room.auction) room.finishAuction();
    } else {
      room.runBot();
    }
    if (check && steps % 25 === 0) check(room);
    stall = room.version === v ? stall + 1 : 0;
    if (stall > 6) break;
  }
  return { steps, stalled: stall > 6, ended: room.status === 'ended' };
}

/** Every way a shuffled board could be wrong, as a list (empty is right). */
function shuffleErrors(base, sh) {
  const errs = [];
  if (sh.tiles.length !== base.tiles.length) errs.push('tile count');
  base.tiles.forEach((t, i) => {
    const s = sh.tiles[i];
    if (s?.index !== i) errs.push(`index at ${i}`);
    if (t.type !== 'property') {
      if (!isDeepStrictEqual(s, t)) errs.push(`fixed tile ${i} (${t.name}) moved or changed`);
    } else if (s?.type !== 'property') errs.push(`slot ${i} lost its street`);
  });
  const runs = new Set(Object.values(base.groups).map((r) => r.join(',')));
  const used = new Set();
  for (const [g, idxs] of Object.entries(base.groups)) {
    const run = sh.groups[g];
    if (!run || run.length !== idxs.length) { errs.push(`set ${g} changed size`); continue; }
    const key = run.join(',');
    if (!runs.has(key)) errs.push(`set ${g} sits on ${key}, which is not one of the board's runs`);
    if (used.has(key)) errs.push(`run ${key} used twice`);
    used.add(key);
    idxs.forEach((from, k) => {
      const a = base.tiles[from];
      const b = sh.tiles[run[k]];
      if (a.name !== b.name || a.price !== b.price || b.group !== g || !isDeepStrictEqual(a.rent, b.rent)
        || a.houseCost !== b.houseCost || a.groupSize !== b.groupSize) {
        errs.push(`street ${a.name} did not travel whole`);
      }
    });
  }
  if (Object.keys(sh.groups).length !== Object.keys(base.groups).length) errs.push('set count');
  sh.tiles.forEach((t, i) => {
    if (t.type === 'property' && !sh.groups[t.group]?.includes(i)) errs.push(`tile ${i} missing from its set`);
  });
  const firsts = Object.values(sh.groups).map((r) => r[0]);
  if (!firsts.every((x, i) => i === 0 || x > firsts[i - 1])) errs.push('the set table is not in board order');
  if (sh.id !== base.id || sh.uid === base.uid || !sh.shuffled) errs.push('id / uid / shuffled flag');
  if (!isDeepStrictEqual(sh.layout, base.layout) || sh.size !== base.size || sh.name !== base.name) errs.push('shape');
  return errs;
}
const sameLayout = (a, b) => a.tiles.every((t, i) => t.name === b.tiles[i].name);

async function inProcess() {
  // ------------------------------------------------------------ settings --
  section('the three new table settings');
  {
    // 1.0.7 added the third rule, 'choose' (test/round3.mjs).
    PASS(DEFAULT_SETTINGS.bankruptProperties === 'release' && DEFAULT_SETTINGS.auctionOnly === false
      && DEFAULT_SETTINGS.shuffleBoard === false && isDeepStrictEqual(BANKRUPT_RULES, ['release', 'auction', 'choose']),
    'a new table releases bankrupt estates, sells at the sticker and plays the board as printed');

    const room = bare({ humans: ['h', 'g'] });
    let res = room.updateSettings('h', { bankruptProperties: 'auction', auctionOnly: true, shuffleBoard: true });
    PASS(!res?.error && room.settings.bankruptProperties === 'auction' && room.settings.auctionOnly === true
      && room.settings.shuffleBoard === true, 'the host sets all three', short(res));
    res = room.updateSettings('h', { bankruptProperties: 'raffle', shuffleBoard: false });
    PASS(res?.error === 'Bankrupt properties go back to the bank, to auction, or the player decides' && room.settings.shuffleBoard === true
      && room.settings.bankruptProperties === 'auction', 'a value off the list is refused, and the whole patch with it', short(res));
    for (const bad of [null, 1, true, ['auction'], { a: 1 }]) {
      if (room.updateSettings('h', { bankruptProperties: bad })?.error !== 'Bankrupt properties go back to the bank, to auction, or the player decides') {
        PASS(false, `bankruptProperties ${JSON.stringify(bad)} should be refused`);
      }
    }
    room.updateSettings('h', { shuffleBoard: 'yes', auctionOnly: 0 });
    PASS(room.settings.shuffleBoard === true && room.settings.auctionOnly === false,
      'the two switches are stored as switches, like every other', short([room.settings.shuffleBoard, room.settings.auctionOnly]));
    room.updateSettings('g', { shuffleBoard: false });
    PASS(room.settings.shuffleBoard === true, 'a guest changes nothing');

    room.updateSettings('h', { auction: false });
    room.updateSettings('h', { auctionOnly: true });
    PASS(room.settings.auctionOnly === true && room.settings.auction === true, 'turning auction-only on turns auctions on');
    room.updateSettings('h', { auction: false });
    PASS(room.settings.auctionOnly === false && room.settings.auction === false,
      'turning auctions off turns auction-only off — the two never contradict each other');
    room.updateSettings('h', { auctionOnly: true, auction: false });
    PASS(room.settings.auctionOnly === true && room.settings.auction === true,
      'both in one patch: auction-only wins, and auctions are on');

    // A Play-now table rolls bankruptProperties from 1.0.7 and its host may
    // change it like the other rolled rules (test/round3.mjs); the other two
    // stay private-table only.
    const quick = bare({ humans: ['q1'] });
    quick.makeQuickMatch(86400);
    const before = { ...quick.settings };
    for (const patch of [{ auctionOnly: true }, { shuffleBoard: true }]) {
      const r = quick.updateSettings('q1', patch);
      PASS(r?.error === 'A Play-now table keeps its seats, privacy, house players, teams and clock'
        && isDeepStrictEqual(quick.settings, before), `a Play-now host cannot set ${Object.keys(patch)[0]}`, short(r));
    }
    quick.clearQuickTimers();

    const cup = bare({ humans: ['c1', 'c2'] });
    cup.cupMatch = { cupId: 'test', round: 1 };
    for (const patch of [{ bankruptProperties: 'auction' }, { auctionOnly: true }, { shuffleBoard: true }]) {
      const r = cup.updateSettings('c1', patch);
      PASS(r?.error === 'A cup table is set by the cup' && cup.settings[Object.keys(patch)[0]] === DEFAULT_SETTINGS[Object.keys(patch)[0]],
        `a cup table refuses ${Object.keys(patch)[0]}`, short(r));
    }
    // And if a field were forced anyway, the room plays the default there.
    cup.settings.shuffleBoard = true; cup.settings.auctionOnly = true; cup.settings.bankruptProperties = 'auction';
    quick.settings.shuffleBoard = true;
    quick.settings.auctionOnly = true;
    PASS(cup.ruleOn('shuffleBoard') === false && cup.ruleOn('auctionOnly') === false
      && cup.ruleOn('bankruptProperties') === 'release' && quick.ruleOn('shuffleBoard') === false
      && quick.ruleOn('auctionOnly') === false,
    'a cup table plays the defaults even with the fields forced, and so does a Play-now table for the two it never rolls');
  }

  // --------------------------------------------------------------- G1 ----
  section('G1 — prison: the third failed roll walks out free');
  {
    const room = bare();
    room.hostId = 'a';
    room.start('a');
    const a = room.player('a');
    const prison = room.cornerIndex('prison');
    room.sendToJail(a);
    const cash = a.money;
    freshTurn(room, 'a');
    room.roll('a', [1, 2]);
    PASS(a.jail && a.jailTurns === 1 && a.pos === prison && room.turn.phase === 'end' && a.money === cash
      && logText(room).at(-1) === 'A rolled 1+2 — still in prison (1/3)', 'first miss: still inside, turn over', logText(room).at(-1));
    freshTurn(room, 'a');
    room.roll('a', [1, 3]);
    PASS(a.jail && a.jailTurns === 2 && room.turn.phase === 'end', 'second miss: still inside (2/3)');
    freshTurn(room, 'a');
    a.money = 0;
    room.roll('a', [2, 3]);
    PASS(!a.jail && a.jailTurns === 0 && a.pos === prison + 5 && a.money === 0 && !room.turn.debt,
      'third miss: the door opens, nothing is charged — even with $0 — and the piece walks the roll',
      `pos ${a.pos}, money ${a.money}`);
    PASS(logText(room).includes('A rolled 2+3 — third try, so they walk out of prison free')
      && !logText(room).some((t) => /fine/.test(t)), 'the log says so, and mentions no fine');
    // Every shipped client plays the dice sound, and shows the line as the
    // dice land, on a fresh 'dice' line; 'jail' is the prison-door sound.
    const third = room.log.find((l) => l.text === 'A rolled 2+3 — third try, so they walk out of prison free');
    PASS(third?.kind === 'dice', 'and that line is the throw: kind "dice", like the double-escape line', third?.kind);
    PASS(room.turn.phase === 'action' && room.turn.pending?.tile === prison + 5,
      'the walk lands like any roll: an unowned airport is on offer', short(room.turn.pending));
    room.skipBuy('a');
    room.passBid('a'); room.passBid('b');
    PASS(room.turn.phase === 'end', 'and the turn ends there — a missed double buys no encore', room.turn.phase);

    // The third roll onto rent nobody can pay: the rent debt stands, no fine debt.
    const r2 = bare();
    r2.hostId = 'a'; r2.start('a');
    const a2 = r2.player('a');
    r2.sendToJail(a2);
    a2.jailTurns = 2; a2.money = 5;
    give(r2, 'b', r2.map.groups[r2.tile(prison + 6).group], {});
    r2.ownership[prison + 6].houses = 0;
    freshTurn(r2, 'a');
    r2.roll('a', [2, 4]);
    PASS(!a2.jail && a2.pos === prison + 6 && r2.turn.phase === 'debt' && r2.turn.debt?.creditor === 'b'
      && !('jailRelease' in r2.turn.debt), 'onto unpayable rent: a rent debt to the landlord, and that is all', short(r2.turn.debt));

    // Unchanged: a double, the fine before rolling, and the card.
    const r3 = bare();
    r3.hostId = 'a'; r3.start('a');
    const a3 = r3.player('a');
    r3.sendToJail(a3);
    freshTurn(r3, 'a');
    r3.roll('a', [3, 3]);
    PASS(!a3.jail && a3.pos === prison + 6 && r3.turn.noReroll === true && r3.turn.phase !== 'roll',
      'a double still walks out at once, without the encore');
    r3.sendToJail(a3);
    freshTurn(r3, 'a');
    const m3 = a3.money;
    r3.jailPay('a');
    PASS(!a3.jail && a3.money === m3 - 50 && a3.pos === prison && r3.turn.playerId === 'b',
      'paying $50 before rolling still opens the door and ends the turn');
    freshTurn(r3, 'a');
    r3.sendToJail(a3);
    a3.getOutCards = 1;
    r3.jailCard('a');
    PASS(!a3.jail && a3.getOutCards === 0 && r3.turn.phase === 'roll', 'and the card still frees and rolls');

    // A house player in prison rolls rather than paying, and is out on the third.
    const r4 = bare({ humans: ['h'], bots: 1 });
    r4.hostId = 'h'; r4.start('h');
    const bot = r4.players.find((p) => p.isBot);
    r4.sendToJail(bot);
    bot.jailTurns = 2;
    freshTurn(r4, bot.id);
    const mb = bot.money;
    const realRoll = r4.roll.bind(r4);
    r4.roll = (id) => realRoll(id, [1, 2]);
    r4.runBot();
    PASS(!bot.jail && bot.money === mb && bot.pos === prison + 3, 'a house player is out free on its third miss too',
      `pos ${bot.pos}, money ${bot.money}`);
  }

  // --------------------------------------------------------------- G6 ----
  section('G6 — auction-only: no Buy, straight to the hammer');
  {
    const room = bare({ humans: ['a', 'b', 'c'], settings: { auctionOnly: true } });
    room.hostId = 'a'; room.start('a');
    const a = room.player('a');
    room.roll('a', [1, 2]);                     // START + 3 = Rio, unowned
    PASS(room.auction?.tile === 3 && room.turn.pending === null && room.turn.phase === 'auction' && room.auction.estate === null,
      'landing on an unowned street opens the auction at once — no offer to buy', short({ auction: room.auction, phase: room.turn.phase }));
    PASS(logText(room).at(-1) === 'Rio goes to auction! Starting bid $10' && room.tile(3).price === 60,
      'the log says so; the sticker is still on the deed as the reference', logText(room).at(-1));
    PASS(room.buy('a')?.error === 'Auction in progress' && room.skipBuy('a')?.error === 'Auction in progress'
      && room.endTurn('a')?.error === 'Auction in progress', 'Buy, Don\'t buy and End turn are all refused while it runs');
    room.bid('a', 80);                         // past the sticker is allowed
    room.passBid('b'); room.passBid('c');
    PASS(room.own(3)?.owner === 'a' && a.money === 2500 - 80 && room.turn.phase === 'end' && !room.auction,
      'the roller wins it at $80 and the turn ends as after any landing', short({ owner: room.own(3), money: a.money }));
    PASS(!room.log.some((l) => l.kind === 'buy'), 'nobody bought anything at the sticker');
    // …but the hammer is how a street is bought here, so it counts as one —
    // or "Buy 6 streets", Land Grabber and the career total could never move.
    PASS(room.stats.a.streetsBought === 1 && room.stats.a.auctionsWon === 1,
      'winning a landing\'s lot counts as buying the street, and as an auction won', short(room.stats.a));

    freshTurn(room, 'b');
    room.player('b').pos = 0;
    room.roll('b', [3, 3]);                    // a double onto Tel Aviv
    room.passBid('a'); room.passBid('b'); room.passBid('c');
    PASS(room.own(6) === null && room.turn.phase === 'roll', 'nobody bids: it stays with the bank, and the double still rolls again',
      room.turn.phase);

    // A card that moves you onto an unowned street, and the third roll out of prison.
    freshTurn(room, 'c', { rolledThisTurn: true, dice: [1, 2] });
    room.applyCard(room.player('c'), { kind: 'moveTo', tile: 39 });
    PASS(room.auction?.tile === 39 && room.turn.phase === 'auction', 'a card onto an unowned street: auction');
    room.passBid('a'); room.passBid('b'); room.passBid('c');
    room.sendToJail(a);
    a.jailTurns = 2;
    freshTurn(room, 'a');
    room.roll('a', [2, 3]);                    // out free onto the MUC airport
    PASS(!a.jail && room.auction?.tile === room.cornerIndex('prison') + 5 && room.turn.phase === 'auction',
      'walking out of prison onto one: the turn is parked on the auction, not ended under it', room.turn.phase);
    room.passBid('a'); room.passBid('b'); room.passBid('c');
    PASS(room.turn.phase === 'end', 'and ends when the hammer falls');

    // House players bid as usual.
    const t = bare({ humans: ['h'], bots: 2, settings: { auctionOnly: true } });
    t.hostId = 'h'; t.start('h');
    t.roll('h', [2, 3]);                       // TLV airport
    t.passBid('h');
    for (let i = 0; i < 200 && t.auction; i++) t.runBotAuction();
    const owner = t.player(t.own(5)?.owner);
    PASS(!t.auction && owner?.isBot && owner.money < 2500 && owner.money >= 2500 - 250,
      'with the person out, the two house players bid it between them and one wins', short({ owner: owner?.name, paid: 2500 - (owner?.money || 0) }));
    PASS(t.stats[owner?.id]?.auctionsWon === 1 && t.stats[owner?.id]?.streetsBought === 0,
      'an airport won is an auction won, not a street bought (buy() never counted one either)', short(t.stats[owner?.id]));

    // An estate lot at an auction-only table is a sale of somebody's
    // leftovers, as at any table: an auction won, not a street bought.
    const e = bare({ humans: ['a', 'b', 'c'], settings: { auctionOnly: true, bankruptProperties: 'auction' } });
    e.hostId = 'a'; e.start('a');
    give(e, 'c', [11]);
    e.declareBankrupt('c');
    e.bid('b', 40); e.passBid('a');
    PASS(e.own(11)?.owner === 'b' && e.stats.b.auctionsWon === 1 && e.stats.b.streetsBought === 0,
      'an estate lot won at an auction-only table is not counted as a street bought', short(e.stats.b));
    // And at an ordinary table the auction after a declined deed never was.
    const o = bare({ humans: ['a', 'b'] });
    o.hostId = 'a'; o.start('a');
    o.roll('a', [1, 2]);
    o.skipBuy('a');
    o.bid('b', 70); o.passBid('a');
    PASS(o.own(3)?.owner === 'b' && o.stats.b.auctionsWon === 1 && o.stats.b.streetsBought === 0,
      'an ordinary table is unchanged: a declined deed won at auction is an auction won only', short(o.stats.b));

    // A Play-now table never plays it, whatever the field says.
    const q = bare({ humans: ['q'], bots: 1 });
    q.quick = true;
    q.settings.auctionOnly = true;
    q.hostId = 'q'; q.start('q');
    q.roll(q.turn.playerId, [1, 2]);
    PASS(!q.auction && q.turn.pending?.type === 'buy', 'a Play-now table offers the deed as always');
    q.quick = false;
  }

  // --------------------------------------------------------------- G5 ----
  section('G5 — a bankrupt estate, auctioned lot by lot');
  {
    const room = bare({ humans: ['a', 'b', 'c'], settings: { bankruptProperties: 'auction' } });
    room.hostId = 'a'; room.start('a');
    const [, b, c] = ['a', 'b', 'c'].map((id) => room.player(id));
    give(room, 'a', [1, 3], { houses: 2 });
    give(room, 'a', [5], { mortgaged: true });
    give(room, 'a', [6]);
    room.declareBankrupt('a');
    PASS(room.auction?.tile === 1 && isDeepStrictEqual(room.auction.estate, { from: 'A', left: 3 })
      && room.turn.playerId === 'a' && room.turn.phase === 'auction',
    'A concedes on their own turn: the first lot (board order) is under the hammer, the turn parked on it', short(room.auction));
    PASS([1, 3, 5, 6].every((i) => !room.own(i)) && logText(room).includes("A's 4 properties go to auction, one at a time"),
      'the houses went back and the mortgage was lifted — each lot is an ordinary unowned street', logText(room).slice(-3).join(' / '));
    room.bid('b', 100); room.passBid('c');
    PASS(isDeepStrictEqual(room.own(1), { owner: 'b', houses: 0, mortgaged: false }) && b.money === 2400
      && room.auction?.tile === 3 && room.auction.estate.left === 2, 'B takes lot one at $100; lot two follows at once');
    room.bid('c', 50); room.passBid('b');
    room.passBid('b'); room.passBid('c');
    PASS(room.own(3)?.owner === 'c' && room.own(5) === null && room.auction?.tile === 6 && room.auction.estate.left === 0,
      'C takes lot two; nobody wants the airport and it stays with the bank; the last lot is up');
    room.bid('b', 10); room.passBid('c');
    PASS(!room.auction && !room.estate && room.own(6)?.owner === 'b' && room.turn.playerId === 'b' && room.turn.phase === 'roll',
      'after the last lot the game carries on: the turn moves to B', short(room.turn));
    PASS(room.stats.b.auctionsWon === 2 && room.stats.c.auctionsWon === 1, 'the lots count as auctions won');
    PASS(room.roll('b', [1, 2]).ok === true, 'and B can roll');

    // Somebody else's bankruptcy, before the roller has thrown the dice.
    const r2 = bare({ humans: ['a', 'b', 'c'], settings: { bankruptProperties: 'auction' } });
    r2.hostId = 'a'; r2.start('a');
    give(r2, 'c', [11, 13]);
    r2.declareBankrupt('c');
    PASS(r2.auction?.tile === 11 && r2.turn.playerId === 'a' && r2.turn.phase === 'auction' && r2.roll('a')?.error === 'Cannot roll now',
      'C concedes during A\'s turn: the estate goes first, and A cannot roll under it');
    r2.passBid('a'); r2.passBid('b');
    r2.passBid('a'); r2.passBid('b');
    PASS(!r2.auction && r2.turn.playerId === 'a' && r2.turn.phase === 'roll' && r2.turn.rolledThisTurn === false,
      'when it is over A gets the throw back — still their turn, still unrolled', short(r2.turn));

    // …and while the roller is deciding on a deed of their own.
    const r3 = bare({ humans: ['a', 'b', 'c'], settings: { bankruptProperties: 'auction' } });
    r3.hostId = 'a'; r3.start('a');
    give(r3, 'c', [21]);
    r3.roll('a', [1, 2]);
    PASS(r3.turn.phase === 'action' && r3.turn.pending?.tile === 3, 'setup: A is being offered Rio');
    r3.declareBankrupt('c');
    PASS(r3.buy('a')?.error === 'Auction in progress', 'C concedes: the offer waits under the estate\'s hammer');
    r3.passBid('a'); r3.passBid('b');
    PASS(r3.turn.phase === 'action' && r3.turn.pending?.tile === 3 && r3.buy('a').ok === true && r3.own(3)?.owner === 'a',
      'and is still there afterwards — A buys Rio', r3.turn.phase);

    // 'release' is exactly the old rule.
    const r4 = bare({ humans: ['a', 'b', 'c'] });
    r4.hostId = 'a'; r4.start('a');
    give(r4, 'a', [1, 3]);
    r4.declareBankrupt('a');
    PASS(!r4.auction && !r4.own(1) && !r4.own(3) && r4.turn.playerId === 'b' && r4.turn.phase === 'roll'
      && logText(r4).includes('A went bankrupt — the streets return to the bank'),
    'release (the default): back to the bank, no auction, B\'s turn');

    // To a player: the creditor keeps the cash, as today — the streets are
    // the bank's to sell, and at this table it sells them.
    const r5 = bare({ humans: ['a', 'b', 'c'], settings: { bankruptProperties: 'auction' } });
    r5.hostId = 'a'; r5.start('a');
    give(r5, 'a', [16, 18]);
    r5.player('a').money = 30;
    r5.bankrupt(r5.player('a'), r5.player('b'));
    PASS(r5.player('b').money === 2530 && r5.auction?.tile === 16 && !r5.own(16) && !r5.own(18),
      'bankrupt to a player: B keeps the $30, and the streets go under the hammer, not to B', short({ b: r5.player('b').money }));

    // A walkout and a timeout give the streets up the same way.
    const r6 = bare({ humans: ['a', 'b', 'c'], settings: { bankruptProperties: 'auction' } });
    r6.hostId = 'a'; r6.start('a');
    give(r6, 'b', [26]);
    give(r6, 'c', [31]);
    r6.quit('b');
    PASS(r6.auction?.tile === 26 && r6.auction.estate?.from === 'B', 'a player who walks out: their street is auctioned');
    r6.removeFromPlay(r6.player('c'), 'timeout');
    PASS(r6.status === 'ended' && !r6.estate, 'and when that leaves one player the game is simply over — nothing left to sell');

    // Two estates in a row queue behind each other, in order.
    const r7 = bare({ humans: ['a', 'b', 'c', 'd'], settings: { bankruptProperties: 'auction' } });
    r7.settings.maxPlayers = 4;
    r7.hostId = 'a'; r7.start('a');
    give(r7, 'b', [1, 3]);
    give(r7, 'c', [6, 7, 8]);              // 8 is a Surprise square: never a lot
    const lots = [];
    const realStart = r7.startAuction.bind(r7);
    r7.startAuction = (i, e) => { lots.push([i, e?.from, e?.left]); return realStart(i, e); };
    r7.declareBankrupt('b');
    r7.declareBankrupt('c');
    for (let i = 0; i < 4; i++) { r7.passBid('a'); r7.passBid('d'); }
    PASS(isDeepStrictEqual(lots, [[1, 'B', 1], [3, 'B', 0], [6, 'C', 1], [7, 'C', 0]]) && !r7.auction && r7.turn.playerId === 'a'
      && r7.turn.phase === 'roll', 'two estates: B\'s lots, then C\'s, one at a time — each counting only its own — then A\'s turn resumes',
    short(lots));

    // Not once the clock has run out.
    const r8 = bare({ humans: ['a', 'b', 'c'], settings: { bankruptProperties: 'auction' } });
    r8.hostId = 'a'; r8.start('a');
    give(r8, 'c', [11]);
    r8.timeUp = true;
    r8.declareBankrupt('c');
    PASS(!r8.auction && !r8.own(11), 'after the game clock has run out the estate is released, not sold');

    // House players bid on an estate as on any lot, and the game goes on.
    const r9 = bare({ humans: ['h'], bots: 2, settings: { bankruptProperties: 'auction' } });
    r9.hostId = 'h'; r9.start('h');
    give(r9, 'h', [37, 39, 5, 15]);
    r9.declareBankrupt('h');
    const sold = [];
    for (let i = 0; i < 400 && r9.auction; i++) {
      const tile = r9.auction.tile;
      r9.runBotAuction();
      if (!r9.auction || r9.auction.tile !== tile) sold.push([tile, r9.own(tile)?.owner || null]);
    }
    const bots = r9.players.filter((p) => p.isBot).map((p) => p.id);
    PASS(sold.length === 4 && sold.some(([, o]) => bots.includes(o)) && r9.turn.playerId !== 'h' && r9.turn.phase === 'roll'
      && r9.status === 'playing', 'two house players bid the person\'s estate between them, and play on', short(sold));

    // A timed game's clock runs out while an estate sale holds a turn that
    // has not rolled. Had no hammer been up, clockRanOut would have ended the
    // game on the spot; so it ends when the hammer falls — the throw is not
    // handed back after time, where it could still move the standings.
    const r10 = bare({ humans: ['a', 'b', 'c'], settings: { bankruptProperties: 'auction' } });
    r10.hostId = 'a'; r10.start('a');
    give(r10, 'c', [11, 13, 14]);
    r10.declareBankrupt('c');
    PASS(r10.auction?.tile === 11 && r10.turn.playerId === 'a' && r10.turn.rolledThisTurn === false, 'setup: C\'s estate is up during A\'s unrolled turn');
    r10.clockRanOut();
    PASS(r10.status === 'playing' && r10.timeUp === true && logText(r10).at(-1) === "Time's up — this is the last turn",
      'the clock runs out mid-lot: the hammer is allowed to fall first', logText(r10).at(-1));
    r10.bid('b', 60); r10.passBid('a');
    PASS(r10.status === 'ended' && r10.endReason === 'time' && !r10.auction && !r10.estate && r10.own(11)?.owner === 'b'
      && !r10.own(13) && !r10.own(14),
    'when it falls the rest of the estate stays with the bank and the game ends on the clock', short({ status: r10.status, phase: r10.turn.phase }));
    PASS(r10.roll('a', [1, 2])?.error && r10.player('a').pos === 0,
      'A is not handed the throw back after time', short(r10.player('a').pos));
    const tail10 = logText(r10).slice(-4);
    PASS(isDeepStrictEqual(tail10.slice(0, 3), ['B won Venice at auction for 60', 'The rest of the estate stays with the bank', "Time's up — richest player wins"]),
      'log: the lot, the rest released, then the time\'s-up result', short(tail10));

    // …but a turn the sale dropped into AFTER the throw (a deed on offer)
    // still plays out, as any turn in progress does when time runs out.
    const r11 = bare({ humans: ['a', 'b', 'c'], settings: { bankruptProperties: 'auction' } });
    r11.hostId = 'a'; r11.start('a');
    give(r11, 'c', [21]);
    r11.roll('a', [1, 2]);
    r11.declareBankrupt('c');
    r11.clockRanOut();
    r11.passBid('a'); r11.passBid('b');
    PASS(r11.status === 'playing' && r11.turn.phase === 'action' && r11.turn.pending?.tile === 3,
      'time out mid-sale after A had rolled: the deed on offer is still A\'s to decide', short(r11.turn));
    r11.buy('a');
    PASS(r11.status === 'playing' && r11.turn.phase === 'end' && r11.own(3)?.owner === 'a', 'A buys it; the turn is the last one');
    r11.endTurn('a');
    PASS(r11.status === 'ended' && r11.endReason === 'time', 'and the game ends when A ends it');

    // One "your turn" per estate sale, not one per lot — and no clock running
    // down (or firing) under the lots. The hook is what sends the push to a
    // player who is away from the table.
    const r12 = bare({ humans: ['a', 'b', 'c', 'd'], settings: { bankruptProperties: 'auction', turnSeconds: 90 } });
    r12.settings.maxPlayers = 4;
    r12.hostId = 'a'; r12.start('a');
    const told = [];
    r12.hooks.turn = (id) => told.push(id);
    give(r12, 'b', [1, 3, 6, 7, 9]);
    r12.quit('b');
    PASS(r12.auction?.estate?.left === 4 && r12.turn.endsAt === null && !r12.timers.turn,
      'an estate lot stops the clock of the turn it dropped into', short({ endsAt: r12.turn.endsAt }));
    let clockMidSale = false;
    let lots12 = 0;
    for (let i = 0; i < 20 && r12.auction; i++) {
      lots12++;
      if (r12.turn.endsAt !== null || r12.timers.turn) clockMidSale = true;
      r12.passBid('a'); r12.passBid('c'); r12.passBid('d');
    }
    PASS(!r12.auction && !clockMidSale && lots12 === 5 && told.length === 1, 'no clock between any of the 5 lots, and no "your turn" for each',
      short({ lots12, told }));
    PASS(isDeepStrictEqual(told, ['a']) && r12.turn.playerId === 'a' && r12.turn.phase === 'roll'
      && r12.turn.endsAt > Date.now() && !!r12.timers.turn,
    'the turn goes back to A once, with one fresh clock and one "your turn"', short(told));
    // The socket re-arms the clock of the player on turn after every move of
    // theirs, a bid included (touchTurnClock). Under an estate lot that must
    // not start it again, nor tell anybody it is their turn.
    told.length = 0;
    give(r12, 'c', [11, 13]);
    r12.declareBankrupt('c');
    r12.bid('a', 20);
    r12.touchTurnClock('a');
    PASS(r12.auction?.tile === 11 && r12.turn.endsAt === null && !r12.timers.turn && told.length === 0,
      'a bid by the player on turn does not restart their clock mid-sale', short({ endsAt: r12.turn.endsAt, told }));
    r12.passBid('d');
    r12.passBid('a'); r12.passBid('d');
    PASS(!r12.auction && r12.own(11)?.owner === 'a' && isDeepStrictEqual(told, ['a']) && r12.turn.endsAt > Date.now(),
      'and the second sale hands the turn back the same way: once', short(told));
  }

  // --------------------------------------------------------------- G7 ----
  section('G7 — the shuffled board: what moves and what never does');
  {
    const snapshot = JSON.stringify(MAPS);
    const boards = { ...MAPS, random: generateRandomMap() };
    let bad = [];
    for (const [id, map] of Object.entries(boards)) {
      for (const seed of [1, 2, 3, 42, 0xdeadbeef]) {
        const sh = shuffleMap(map, seed);
        const errs = shuffleErrors(map, sh);
        if (errs.length) bad.push(`${id}@${seed}: ${errs.slice(0, 3).join('; ')}`);
      }
    }
    PASS(bad.length === 0, `on all ${Object.keys(boards).length} boards: START, the corners, cards, taxes, airports and utilities stay put; every set moves whole onto a run of its own size`,
      bad.slice(0, 3).join(' | '));
    PASS(JSON.stringify(MAPS) === snapshot, 'and the stock boards every other table is sharing are untouched');

    const classic = MAPS.classic;
    const fixed = classic.tiles.filter((t) => t.type !== 'property').map((t) => `${t.index}:${t.name}`);
    const sh42 = shuffleMap(classic, 42);
    PASS(isDeepStrictEqual(sh42.tiles.filter((t) => t.type !== 'property').map((t) => `${t.index}:${t.name}`), fixed)
      && ['TLV Airport', 'MUC Airport', 'CDG Airport', 'JFK Airport', 'Power Company', 'Water Company']
        .every((n) => sh42.tiles.findIndex((t) => t.name === n) === classic.tiles.findIndex((t) => t.name === n)),
    'Classic, spelled out: the four airports and both utilities on their own squares');
    PASS(isDeepStrictEqual(shuffleMap(classic, 42), sh42) && sh42.shuffleSeed === 42 && sh42.uid === `classic~${(42).toString(36)}`,
      'one seed is one board', sh42.uid);
    const layouts = new Set();
    let identity = 0;
    for (let s = 1; s <= 200; s++) {
      const sh = shuffleMap(classic, s);
      layouts.add(sh.tiles.map((t) => t.name).join('|'));
      if (sameLayout(sh, classic)) identity++;
    }
    PASS(layouts.size > 150 && identity === 0, 'two hundred seeds, well over a hundred and fifty layouts, never the printed board',
      `${layouts.size} layouts, ${identity} unshuffled`);
    const dearFirst = [...Array(500).keys()].some((s) => shuffleMap(classic, s + 1).tiles[1].name === 'San Francisco');
    PASS(dearFirst, 'expensive streets can sit right after START (San Francisco on square 1)');
    PASS(shuffleMap({ ...classic, groups: { BR: [1, 3] } }, 9).shuffled === false,
      'a board with no two sets of a size has nothing to trade, and says so');

    // In a room.
    const room = bare({ settings: { shuffleBoard: true } });
    room.hostId = 'a';
    seeded(7, () => room.start('a'));
    const map = room.map;
    const state = room.serialize();
    PASS(map.shuffled && shuffleErrors(classic, map).length === 0 && room.shuffleSeed != null,
      'the game deals a shuffle at start, seeded', `seed ${room.shuffleSeed}`);
    PASS(state.map.shuffled === true && state.map.uid === map.uid && state.map.uid !== 'classic' && state.mapId === 'classic'
      && state.settings.mapId === 'classic' && isDeepStrictEqual(state.map.tiles, map.tiles) && isDeepStrictEqual(state.map.groups, map.groups),
    'the state carries the shuffled tiles and sets, a new uid, and the board is still Classic by id');
    PASS(logText(room).includes('The board was shuffled') && logText(room).indexOf('The board was shuffled') === logText(room).indexOf('Game started! Good luck.') + 1,
      'the log says "The board was shuffled", right after the start');
    const twin = bare({ settings: { shuffleBoard: true } });
    twin.hostId = 'a';
    seeded(7, () => twin.start('a'));
    PASS(sameLayout(twin.map, map) && twin.shuffleSeed === room.shuffleSeed, 'the same seed deals the same board again', twin.map.uid);

    // Everything follows the shuffled positions.
    const moved = (k) => map.groups[k].join() !== classic.groups[k].join();
    const g = Object.keys(map.groups).find((k) => moved(k) && map.groups[k].length === 3)
      || Object.keys(map.groups).find(moved);
    const idxs = map.groups[g];
    const a = room.player('a');
    a.money = 10000;
    give(room, 'a', idxs);
    const t0 = map.tiles[idxs[0]];
    PASS(room.ownsFullGroup('a', g) && room.rentFor(idxs[0]) === t0.rent[0] * 2,
      `${g} on its new squares (${idxs.join(', ')}) is a full set: double rent off its own deed`, `${room.rentFor(idxs[0])}`);
    const oldSlot = classic.groups[g].find((i) => !idxs.includes(i));
    PASS(oldSlot === undefined || (map.tiles[oldSlot].group !== g && !room.canBuild('a', oldSlot)),
      'the squares the set used to sit on are somebody else\'s set now');
    PASS(room.build('a', idxs[0]).ok === true && room.own(idxs[0]).houses === 1 && a.money === 10000 - t0.houseCost,
      'building on it costs its own house price', `${t0.houseCost}`);
    PASS(room.build('a', idxs[0])?.error === 'Cannot build there', 'and even building is judged on the shuffled set');
    const all = room.buildAll('a', g);
    PASS(all.ok === true && idxs.every((i) => room.own(i).houses >= 1), 'Build all finds the whole set', short(all));
    PASS(room.proposeTrade('a', { to: 'b', give: { tiles: [idxs[1]] }, get: {} })?.error === 'Sell the buildings first',
      'a deed in a built set cannot be traded — the set is the shuffled one');

    const h = Object.keys(map.groups).find((k) => k !== g && moved(k)) || Object.keys(map.groups).find((k) => k !== g);
    const hIdx = map.groups[h];
    const last = hIdx.at(-1);
    give(room, 'b', hIdx.slice(0, -1));
    PASS(room.botUrgent(room.player('a'), last) && room.botGroupRace(room.player('a'), last).topRival === hIdx.length - 1,
      'a house player reads the colour race off the shuffled sets', `${h} ${hIdx.join(',')}`);
    const trade = room.proposeTrade('b', { to: 'a', give: { tiles: [hIdx[0]] }, get: { money: 100 } });
    room.respondTrade('a', trade.trade.id, true);
    PASS(room.own(hIdx[0])?.owner === 'a', 'trades move deeds by their shuffled squares');

    // The game's own decks, and twenty more dealt from the same board, so
    // the cards that name a square are certain to turn up.
    const dealt = [room.decks, ...Array.from({ length: 20 }, () => buildDecks(map))];
    const moves = dealt.flatMap((d) => [...d.treasure, ...d.surprise])
      .filter((cd) => cd.act.kind === 'moveTo' && typeof cd.act.tile === 'number');
    PASS(moves.length > 0 && moves.every((cd) => cd.text.includes(map.tiles[cd.act.tile].name)),
      'every card that sends you to a named square sends you to where that name is now', `${moves.length} cards`);
    freshTurn(room, 'b', { rolledThisTurn: true, dice: [1, 2] });
    room.applyCard(room.player('b'), { kind: 'moveTo', tile: 'priciest' });
    PASS(map.tiles[room.player('b').pos]?.name === 'New York', '"Advance to the priciest street" finds New York wherever it is',
      `square ${room.player('b').pos}`);

    // The career's favourite board is still Classic.
    PASS(room.map.id === 'classic' && state.mapId === 'classic', 'the board id — what careers, the shop and Watch live read — is Classic');

    // Rematch: the lobby shows the printed board; the next game deals afresh.
    room.status = 'ended';
    room.rematch('a');
    PASS(room.status === 'lobby' && !room.map.shuffled && room.map === MAPS.classic && room.serialize().map.shuffled === false
      && room.serialize().map.uid === 'classic', 'Play again: the lobby is back on the printed board');
    seeded(99, () => room.start('a'));
    PASS(room.map.shuffled && room.shuffleSeed !== null && !sameLayout(room.map, map) && shuffleErrors(classic, room.map).length === 0,
      'and the next game is dealt a fresh shuffle', room.map.uid);
    room.status = 'ended';
    room.rematch('a');
    room.updateSettings('a', { shuffleBoard: false });
    room.start('a');
    PASS(!room.map.shuffled && room.map === MAPS.classic && !logText(room).includes('The board was shuffled'),
      'switched off in the lobby, it is off');

    // A random board shuffles too, and a Play-now table never does.
    const rnd = bare({ settings: { shuffleBoard: true, mapId: 'random' } });
    rnd.hostId = 'a';
    seeded(3, () => rnd.start('a'));
    PASS(rnd.map.id === 'random' && rnd.map.shuffled && rnd.map.uid.startsWith('random-') && rnd.map.uid.includes('~'),
      'Random: a fresh board, then shuffled', rnd.map.uid);
    const q = bare({ humans: ['q'], bots: 1 });
    q.quick = true;
    q.settings.shuffleBoard = true;
    q.hostId = 'q';
    q.start('q');
    PASS(!q.map.shuffled && !logText(q).includes('The board was shuffled'), 'a Play-now table plays the printed board');
    q.quick = false;
  }

  // --------------------------------------------------------------- G8 ----
  section('G8 — trades on the table');
  {
    const room = bare({ humans: ['a', 'b', 'c'] });
    room.hostId = 'a'; room.start('a');
    const offer = room.proposeTrade('a', { to: 'b', give: { money: 100 }, get: {} });
    PASS(offer.ok && logText(room).at(-1) === 'A sent a trade offer to B', 'an offer is said out loud', logText(room).at(-1));
    const id = offer.trade.id;
    const third = room.serializeFor(['c']).trades;
    const rail = room.serializeFor(new Set()).trades;
    PASS(third.length === 1 && third[0].from === room.aliasFor('a') && third[0].to === room.aliasFor('b')
      && rail.length === 1 && rail[0].from === room.aliasFor('a') && rail[0].give.money === 100,
    'a third seat and a watcher both see it, with both parties aliased', short(third[0]));
    PASS(room.respondTrade('c', id, true)?.error === 'Not your trade' && room.cancelTrade('c', id)?.error === 'Not your trade'
      && room.trades.length === 1, 'the third seat can neither answer it nor take it back');
    PASS(room.cancelTrade('b', id)?.error === 'Decline it instead' && room.trades.length === 1,
      'the receiver cannot withdraw it — they decline it');
    room.setTradeViewing('c', id, true);
    PASS(!(room.trades[0].viewers || []).includes('c'), 'a third seat opening it does not show up as "reading this"');
    room.setTradeViewing('b', id, true);
    PASS(room.trades[0].viewers?.includes('b'), 'the receiver does');
    PASS(room.cancelTrade('a', id).ok === true && room.trades.length === 0 && logText(room).at(-1) === 'A withdrew the trade offer to B',
      'the sender withdraws it, and the table is told', logText(room).at(-1));
    const o2 = room.proposeTrade('a', { to: 'b', give: { money: 50 }, get: {} });
    room.respondTrade('b', o2.trade.id, false);
    PASS(logText(room).at(-1) === 'B declined the trade from A', 'a decline is said out loud');
    const o3 = room.proposeTrade('a', { to: 'b', give: { money: 50 }, get: {} });
    room.respondTrade('b', o3.trade.id, true);
    PASS(logText(room).at(-1) === 'A and B completed a trade' && room.player('b').money === 2550, 'and so is an acceptance');
  }

  // ------------------------------------------------------- seeded games --
  section('seeded house-player games, every new rule on');
  {
    const results = [];
    for (const seed of [11, 23, 37]) {
      const out = seeded(seed, () => {
        const room = bare({ humans: ['h'], bots: 3, settings: { auctionOnly: true, bankruptProperties: 'auction', shuffleBoard: true } });
        room.settings.maxPlayers = 4;
        room.hostId = 'h';
        room.start('h');
        room.player('h').botControlled = true;
        const said = { buy: 0, estates: 0, wonAtAuction: 0 };
        const realSay = room.say.bind(room);
        room.say = (text, kind) => {
          if (kind === 'buy') said.buy++;
          if (/go(es)? to auction, one at a time$/.test(text)) said.estates++;
          if (/ won .* at auction for /.test(text)) said.wonAtAuction++;
          return realSay(text, kind);
        };
        const broken = [];
        const check = (r) => {
          for (const [i, o] of Object.entries(r.ownership)) {
            const t = r.tile(Number(i));
            if (!['property', 'airport', 'utility'].includes(t?.type)) broken.push(`owned ${t?.type} at ${i}`);
            if ((o.houses || 0) > 0 && !r.ownsFullGroup(o.owner, t.group)) broken.push(`houses off-set at ${i}`);
            if (r.player(o.owner)?.bankrupt) broken.push(`a bankrupt owner at ${i}`);
          }
          if (r.auction && r.turn.phase !== 'auction') broken.push(`auction under phase ${r.turn.phase}`);
        };
        const run = playOut(room, { check });
        return { seed, ...run, said, broken: [...new Set(broken)].slice(0, 3), shuffled: room.map.shuffled, turns: room.turnCount };
      });
      results.push(out);
    }
    PASS(results.every((r) => r.ended && !r.stalled), 'three seeded games of four house players play to the end on a shuffled board',
      short(results.map((r) => `${r.seed}: ${r.ended ? 'ended' : 'NOT ended'} in ${r.turns} turns`)));
    PASS(results.every((r) => r.broken.length === 0), 'the board never holds anything it should not, and no hammer runs outside the auction phase',
      short(results.map((r) => r.broken)));
    PASS(results.every((r) => r.said.buy === 0 && r.said.wonAtAuction > 0),
      'not one street sold at the sticker: every deed went through the hammer', short(results.map((r) => r.said)));
    PASS(results.some((r) => r.said.estates > 0), 'and bankrupt estates were sold off lot by lot along the way',
      short(results.map((r) => r.said.estates)));
  }
}

// ------------------------------------------------------- social.js (G2, G10)
async function inProcessSocial() {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'social-'));
  const now = Date.now();
  const google = (code) => ({ provider: 'google', subject: `sub-${code}`, at: now - 30 * DAY });
  const prof = (token, code, extra = {}) => ({
    token, code, name: code, flag: '', friends: [], seen: now - HOUR, created: now - 90 * DAY,
    coins: 50, owned: [], equipped: {}, karma: 100, econ: 2, xp: 0, levelPaid: 1, login: google(code), ...extra,
  });
  const T = (tag) => `r2-${tag}-${hex(6)}`;
  const DAILY = { token: T('daily'), code: 'RDAYAA' };
  const LAPSE = { token: T('lapse'), code: 'RLAPSE' };
  const VET7 = { token: T('vet7'), code: 'RVETSV' };
  const VET3 = { token: T('vet3'), code: 'RVETTH' };
  const MISS = { token: T('miss'), code: 'RMSSNS' };
  // Yesterday by calendar arithmetic, the way social.js works it out, so a
  // daylight-saving day cannot make "24 hours ago" the same day.
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = dayKey(y);
  fs.writeFileSync(path.join(dir, 'social.json'), JSON.stringify({
    profiles: [
      prof(DAILY.token, DAILY.code),
      prof(LAPSE.token, LAPSE.code, { daily: { last: dayKey(now - 2 * DAY), streak: 5, at: now - 2 * DAY } }),
      // Written by the old ladder, which held at seven: twelve days in, the last
      // five of them at seven coins. No `cycle` on file.
      prof(VET7.token, VET7.code, { daily: { last: yesterday, streak: 12, at: now - DAY } }),
      prof(VET3.token, VET3.code, { daily: { last: yesterday, streak: 3, at: now - DAY } }),
      prof(MISS.token, MISS.code),
    ],
  }));
  process.env.DATA_DIR = dir;
  const S = await import('../server/social.js');
  const P = await import('../server/progression.js');
  const live = (who) => S.profileFor(who.token);

  section('G2 — the daily reward: 1 → 7, then 1 again');
  {
    const fresh = S.dailyView(DAILY.token);
    PASS(fresh.claimable === true && fresh.amount === 1 && fresh.cycleDay === 1 && fresh.cycleLength === 7
      && fresh.claimedToday === false && fresh.streak === 0, 'day one: 1 coin, step 1 of 7', short(fresh));
    const paid = [];
    const steps = [];
    const views = [];
    let wallet = S.walletOf(DAILY.token).coins;
    let walletOk = true;
    for (let day = 1; day <= 16; day++) {
      const before = S.dailyView(DAILY.token);
      const r = S.claimDaily(DAILY.token);
      paid.push(r.amount);
      steps.push(r.cycleDay);
      if (r.coins !== wallet + r.amount) walletOk = false;
      wallet = r.coins;
      const after = S.dailyView(DAILY.token);
      views.push([before.cycleDay, before.amount, after.cycleDay, after.amount, after.claimedToday]);
      // Tomorrow comes: yesterday's claim, the streak alive.
      live(DAILY).daily.last = yesterday;
    }
    PASS(isDeepStrictEqual(paid, [1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 1, 2]),
      'sixteen days in a row pay 1…7, 1…7, 1, 2 — the day after a seven pays one', paid.join(' '));
    PASS(isDeepStrictEqual(steps, paid) && walletOk, 'each claim says its step, and the wallet moves by exactly the amount');
    PASS(views.every(([b, ba, a, aa, claimed]) => b === ba && a === b && aa === (b % 7) + 1 && claimed === true),
      'the card: before a claim it shows the step it pays; after, the step claimed and tomorrow\'s amount',
      short(views.slice(5, 9)));
    PASS(live(DAILY).daily.streak === 16 && live(DAILY).daily.cycle === 2, 'the streak keeps counting; the cycle wraps',
      short(live(DAILY).daily));
    // Back to today: a second claim the same day.
    live(DAILY).daily.last = dayKey(now);
    const w0 = S.walletOf(DAILY.token).coins;
    const again = S.claimDaily(DAILY.token);
    PASS(again.error === 'Already claimed today' && again.cycleDay === 2 && S.walletOf(DAILY.token).coins === w0,
      'a second claim the same day pays nothing', short(again));
    const seven = live(DAILY).daily;
    seven.cycle = 7; seven.last = dayKey(now);
    const v7 = S.dailyView(DAILY.token);
    PASS(v7.claimedToday && v7.cycleDay === 7 && v7.amount === 1, 'having claimed a seven today, the card says tomorrow pays 1', short(v7));

    const lapse = S.dailyView(LAPSE.token);
    PASS(lapse.streak === 0 && lapse.amount === 1 && lapse.cycleDay === 1, 'a missed day: the streak reads 0 and the card is back on step 1',
      short(lapse));
    const lr = S.claimDaily(LAPSE.token);
    PASS(lr.amount === 1 && lr.cycleDay === 1 && lr.streak === 1, 'and the claim pays 1');

    const v7view = S.dailyView(VET7.token);
    const v7claim = S.claimDaily(VET7.token);
    PASS(v7view.cycleDay === 1 && v7claim.amount === 1 && v7claim.streak === 13 && live(VET7).daily.cycle === 1,
      'a streak from the old ladder, sitting on sevens: the next day starts a new cycle at 1', short(v7claim));
    const v3claim = S.claimDaily(VET3.token);
    PASS(v3claim.amount === 4 && v3claim.cycleDay === 4, 'one three days in carries on at 4', short(v3claim));
    const rows = S.ledgerView().filter((e) => e.code === DAILY.code && e.provider === 'daily');
    PASS(rows.length >= 1 && /, \d of 7$/.test(rows.at(-1).note || ''), 'the ledger note names the step', rows.at(-1)?.note);
    const ghost = S.dailyView(`ghost-${hex(4)}`);
    PASS(ghost.cycleDay === 1 && ghost.cycleLength === 7 && ghost.claimable === false, 'a stranger sees step 1 of 7, nothing to claim');
  }

  section('G10 — missions: XP each, coins only for all three');
  {
    PASS(P.MISSION_COINS === 0 && P.MISSION_BONUS_COINS === 3 && P.MISSION_XP === 10, 'the book: 0 coins + 10 XP a mission, 3 coins for the set');
    const v0 = S.missionsView(MISS.token, now);
    PASS(v0.missions.length === 3 && v0.missions.every((m) => m.coins === 0 && m.xp === 10)
      && isDeepStrictEqual(v0.bonus, { coins: 3, ready: false, claimed: false }),
    'the card: every mission worth 0 coins and 10 XP, the bonus 3 coins', short(v0.bonus));
    const ALL = {
      streetsBought: 6, housesBuilt: 4, rentCollected: 1500, setsCompleted: 1, auctionsWon: 1,
      tradesCompleted: 1, doubles: 3, laps: 3,
    };
    S.recordGameProgress(MISS.token, { game: 'r2:1', won: true, turns: 2, stats: ALL, now });
    S.recordGameProgress(MISS.token, { game: 'r2:2', won: true, turns: 2, stats: ALL, now });
    const coins0 = S.walletOf(MISS.token).coins;
    const xp0 = S.meView(MISS.token).xp;
    const ledger0 = S.ledgerView().filter((e) => e.code === MISS.code && e.provider === 'mission').length;
    const kinds = S.missionsView(MISS.token, now).missions.map((m) => m.id);
    const early = S.claimMission(MISS.token, 'bonus', now);
    PASS(early.ok === true && isDeepStrictEqual(early.awarded, { coins: 3, xp: 0 }) && early.coins === coins0 + 3,
      'all three done: the bonus pays 3 coins (claiming them one by one is not required first)', short({ ...early, missions: undefined }));
    const claims = kinds.map((k) => S.claimMission(MISS.token, k, now));
    PASS(claims.every((c) => c.ok && isDeepStrictEqual(c.awarded, { coins: 0, xp: 10 })) && S.walletOf(MISS.token).coins === coins0 + 3
      && S.meView(MISS.token).xp === xp0 + 30, 'each mission then pays its 10 XP and no coin', short(claims.map((c) => c.awarded)));
    const dupes = [...kinds, 'bonus'].map((k) => S.claimMission(MISS.token, k, now));
    PASS(dupes.every((d) => d.ok && d.duplicate && isDeepStrictEqual(d.awarded, { coins: 0, xp: 0 }))
      && S.walletOf(MISS.token).coins === coins0 + 3 && S.meView(MISS.token).xp === xp0 + 30,
    'claiming any of them again pays nothing — the bonus once, ever, for the day');
    const rows = S.ledgerView().filter((e) => e.code === MISS.code && e.provider === 'mission');
    PASS(rows.length - ledger0 === 1 && rows.at(-1).packId === 'bonus' && rows.at(-1).coins === 3,
      'one coin-ledger row: the bonus. A mission that mints nothing writes nothing', short(rows.map((e) => e.packId)));
    const card = S.missionsView(MISS.token, now);
    PASS(card.missions.every((m) => m.claimed) && card.bonus.claimed === true && card.bonus.ready === false, 'and the card shows it all claimed');

    // The career's favourite board follows the room's board id, shuffled or not.
    const room = bare({ settings: { shuffleBoard: true } });
    room.hostId = 'a';
    seeded(5, () => room.start('a'));
    S.recordGameProgress(MISS.token, { game: 'r2:shuffled', won: false, turns: 2, stats: {}, mapId: room.map.id, now });
    PASS(room.map.shuffled && S.meView(MISS.token).career?.favoriteBoard?.id === 'classic',
      'a game on a shuffled Classic counts as Classic on the career card', short(S.meView(MISS.token).career?.favoriteBoard));
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
    env: { ...env, PORT: String(port), DATA_DIR: dir, ADMIN_KEY: `admin-${hex(4)}` },
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
  const token = `r2-${name.toLowerCase()}-${hex(6)}`;
  const sock = io(srv.url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(sock);
  const chair = { sock, name, token, state: null, seq: 0, toasts: [], you: null };
  sock.on('state', (s) => { chair.state = s; chair.seq++; });
  sock.on('toast', (t) => chair.toasts.push(t?.message));
  sock.on('you', (y) => { chair.you = y; });
  chair.emit = (...a) => sock.emit(...a);
  chair.create = () => new Promise((r) => sock.emit('createRoom', { token }, (d) => r(d?.roomId || '')));
  chair.join = (roomId, extra = {}) => sock.emit('join', { roomId, token, name, flag: '', ...extra });
  chair.idOf = (who) => chair.state?.players?.find((p) => p.name === who)?.id;
  chair.close = () => sock.close();
  return chair;
}

async function table(chairs, settings = {}) {
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
  const S = await startServer('round2', dir);

  section('over the wire: the lobby settings');
  {
    const host = seat(S, 'Hana');
    const guest = seat(S, 'Gita');
    await table([host, guest]);
    host.emit('settings', { bankruptProperties: 'lottery' });
    await until(() => host.toasts.length >= 1);
    PASS(host.toasts.includes('Bankrupt properties go back to the bank, to auction, or the player decides'), 'a bad value is refused with a toast', short(host.toasts));
    const seq = host.seq;
    host.emit('settings', { bankruptProperties: 'auction', auctionOnly: true, shuffleBoard: true, auction: false });
    await until(() => host.seq !== seq && guest.state?.settings?.shuffleBoard === true);
    const st = guest.state.settings;
    PASS(st.bankruptProperties === 'auction' && st.auctionOnly === true && st.shuffleBoard === true && st.auction === true,
      'good values land in everybody\'s settings — auctions forced on by auction-only', short(st));
    host.close(); guest.close();
  }

  section('over the wire: the shuffled board is in the state, for everyone');
  let ann; let ben; let cat; let wes; let roomId;
  {
    ann = seat(S, 'Ann');
    ben = seat(S, 'Ben');
    cat = seat(S, 'Cat');
    roomId = await table([ann, ben, cat], { shuffleBoard: true, turnSeconds: 0, isPrivate: false });
    const lobby = ann.state.map;
    PASS(lobby.shuffled === false && lobby.uid === 'classic', 'in the lobby the board is the printed one');
    ann.emit('start');
    await until(() => [ann, ben, cat].every((c) => c.state?.status === 'playing'));
    wes = seat(S, 'Wes');
    wes.join(roomId, { spectate: true });
    await until(() => wes.state?.id === roomId && wes.state.status === 'playing');
    const m = ann.state.map;
    PASS(m.shuffled === true && m.uid.startsWith('classic~') && ann.state.mapId === 'classic' && ann.state.settings.mapId === 'classic'
      && shuffleErrors(MAPS.classic, { ...m, id: 'classic', name: MAPS.classic.name }).length === 0,
    'state.map is the shuffled board — sets moved whole, everything else fixed, new uid, still Classic', m.uid);
    PASS(!isDeepStrictEqual(m.tiles, MAPS.classic.tiles) && [ben, cat, wes].every((c) => isDeepStrictEqual(c.state.map, m)),
      'and it is not the printed board /api/maps describes; every seat and the watcher get the same one');
    PASS(ann.state.log.some((l) => l.text === 'The board was shuffled'), 'the log says "The board was shuffled"');
  }

  section('over the wire: trades are on the table, tokens are not');
  {
    const benAsAnnSees = ann.idOf('Ben');
    ann.emit('trade:propose', { to: benAsAnnSees, give: { money: 100, tiles: [], cards: 0 }, get: { money: 0, tiles: [], cards: 0 } });
    await until(() => [ann, ben, cat, wes].every((c) => c.state?.trades?.length === 1));
    const t = cat.state.trades[0];
    const w = wes.state.trades[0];
    PASS(t && t.from === cat.idOf('Ann') && t.to === cat.idOf('Ben') && t.give.money === 100
      && w && w.from === wes.idOf('Ann') && w.to === wes.idOf('Ben'),
    'a third player and a watcher both see Ann → Ben, by the ids they already know her and him by', short(t));
    PASS(ann.state.trades[0].from === ann.token && ben.state.trades[0].to === ben.token,
      'the two parties see their own real ids, as before');
    const leaks = (c) => [ann.token, ben.token, cat.token, wes.token].filter((tok) => tok !== c.token
      && JSON.stringify(c.state).includes(tok));
    PASS(leaks(cat).length === 0 && JSON.stringify(wes.state).match(/r2-(ann|ben|cat|wes)-/) === null,
      'and no token is anywhere in the third seat\'s or the watcher\'s state');
    PASS([cat, wes].every((c) => c.state.log.some((l) => l.text === 'Ann sent a trade offer to Ben')), 'everyone reads the offer in the log');
    const id = t.id;
    cat.toasts.length = 0; ben.toasts.length = 0; wes.toasts.length = 0;
    cat.emit('trade:respond', { id, accept: true });
    cat.emit('trade:cancel', { id });
    ben.emit('trade:cancel', { id });
    wes.emit('trade:respond', { id, accept: true });
    await until(() => cat.toasts.length >= 2 && ben.toasts.length >= 1 && wes.toasts.length >= 1, 2000);
    await sleep(150);
    PASS(isDeepStrictEqual(cat.toasts, ['Not your trade', 'Not your trade']) && isDeepStrictEqual(ben.toasts, ['Decline it instead'])
      && isDeepStrictEqual(wes.toasts, ['You are watching this game']) && ann.state.trades.length === 1,
    'only the receiver answers and only the sender withdraws; the offer is untouched', short({ cat: cat.toasts, ben: ben.toasts, wes: wes.toasts }));
    ben.emit('trade:respond', { id, accept: true });
    await until(() => cat.state.trades.length === 0 && cat.state.log.some((l) => l.text === 'Ann and Ben completed a trade'));
    PASS(cat.state.trades.length === 0 && wes.state.log.some((l) => l.text === 'Ann and Ben completed a trade')
      && ben.state.players.find((p) => p.id === ben.token)?.money === 2600, 'Ben accepts: everyone is told, and the money moved');
    ann.emit('trade:propose', { to: benAsAnnSees, give: { money: 10 }, get: {} });
    await until(() => cat.state.trades.length === 1);
    ben.emit('trade:respond', { id: cat.state.trades[0].id, accept: false });
    await until(() => wes.state.log.some((l) => l.text === 'Ben declined the trade from Ann'));
    PASS(wes.state.trades.length === 0 && wes.state.log.some((l) => l.text === 'Ben declined the trade from Ann'), 'a decline is told to the rail too');
    ann.emit('trade:propose', { to: benAsAnnSees, give: { money: 10 }, get: {} });
    await until(() => cat.state.trades.length === 1);
    ann.emit('trade:cancel', { id: cat.state.trades[0].id });
    await until(() => cat.state.log.some((l) => l.text === 'Ann withdrew the trade offer to Ben'));
    PASS(cat.state.trades.length === 0, 'and so is a withdrawal');
    for (const c of [ann, ben, cat, wes]) c.close();
  }

  section('over the wire: the daily and missions cards');
  {
    const tok = `r2-cards-${hex(6)}`;
    const daily = (await get(S, `/api/daily?token=${enc(tok)}`)).json;
    PASS(daily?.cycleDay === 1 && daily.cycleLength === 7 && daily.claimedToday === false && daily.amount === 1,
      'GET /api/daily: cycleDay, cycleLength, claimedToday', short(daily));
    const mis = (await get(S, `/api/missions?token=${enc(tok)}`)).json;
    PASS(mis?.missions?.length === 3 && mis.missions.every((m) => m.coins === 0 && m.xp === 10) && mis.bonus?.coins === 3,
      'GET /api/missions: 0 coins and 10 XP a mission, 3 coins for all three', short(mis?.bonus));
  }
}

let crashed = null;
try {
  await inProcess();
  await inProcessSocial();
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
