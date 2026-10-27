// 1.0.7, round three — the server half of the owner's third list.
//
//   H2  a bankrupt player chooses: back to the bank, or auction — and the
//       house chooses for anybody who cannot, by a rule that keeps the game
//       a game; house players bid smarter on every lot, and hard is really
//       harder than normal
//   H3  the same setting is rolled at a Play-now table, and its host may
//       change it; a cup table still plays the default
//
// The sharp edges. A question put to one player stops the whole table, so
// it has to be put to exactly that player, refuse every other voice, and
// always end — answered, timed out, or answered for a player who has gone —
// with the turn handed back exactly as it was. Nothing may be minted or lost
// on the way: a lot sold is paid for by its winner, a lot unsold is the
// bank's, and the bankrupt player keeps nothing. And a house player that
// "bids smarter" must still never bid itself out of the game.
//
// Two halves, as in round2.mjs: GameRoom driven directly with the dice in the
// test's own hand (plus seeded games played out), then the real server, to
// see what actually reaches a phone.
//
//   node test/round3.mjs
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
  QUICK_ROLL_KEYS, QUICK_HOST_KEYS, quickRollValues, rollQuickSettings, quickRollParts,
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
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-round3-'));

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
const seeded = (seed, fn) => {
  Math.random = mulberry32(seed);
  try { return fn(); } finally { Math.random = realRandom; }
};

// ============================================================ in process ==

// Seat ids long enough that a leak of one into somebody else's state would
// be found by a plain substring search.
const A = `tok-ann-${hex(6)}`;
const B = `tok-ben-${hex(6)}`;
const C = `tok-cat-${hex(6)}`;
const D = `tok-dev-${hex(6)}`;
const NAMES = { [A]: 'Ann', [B]: 'Ben', [C]: 'Cat', [D]: 'Dev' };

let serial = 0;
const made = [];

/**
 * A room with the bot and auction timers stubbed out, so each move is a
 * direct call. The question's own timer is left real: the tests either call
 * bankruptChoiceDue themselves or wait for it on a shortened clock.
 */
function bare({ humans = [A, B, C], bots = 0, settings = {} } = {}) {
  const room = new GameRoom(`r3-${++serial}`, () => {});
  made.push(room);
  room.scheduleBot = () => {};
  room.maybeBot = () => {};
  room.maybeBotAuction = () => {};
  room.armAuctionTimer = () => {};
  room.scheduleBotTrade = () => {};
  for (const id of humans) room.addPlayer({ id, name: NAMES[id] || id });
  for (let i = 0; i < bots; i++) room.addBot();
  room.settings = {
    ...room.settings, randomizeOrder: false, turnSeconds: 0, auction: true, maxPlayers: 6, ...settings,
  };
  return room;
}
const logText = (room) => room.log.map((l) => l.text);
const lastLines = (room, n) => logText(room).slice(-n);
const give = (room, id, tiles, extra = {}) => {
  for (const i of tiles) room.ownership[i] = { owner: id, houses: 0, mortgaged: false, ...extra };
};
const freshTurn = (room, id, extra = {}) => {
  room.turn = {
    playerId: id, phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false, ...extra,
  };
};
const cash = (room) => room.players.reduce((n, p) => n + p.money, 0);
const owned = (room, tiles) => tiles.map((i) => room.own(i)?.owner || null);
const WAIT = (name) => `Waiting for ${name} to decide about their properties`;

/** A choose table, started, with the given seats. */
function chooseTable(opts = {}) {
  const room = bare({ ...opts, settings: { bankruptProperties: 'choose', ...(opts.settings || {}) } });
  room.hostId = room.players[0].id;
  room.start(room.hostId);
  return room;
}

/**
 * Play a table of house players (and one person the house is covering, so
 * the table counts as watched) until the game is over or the steps run out.
 * A question about an estate is answered the moment it is put — the test's
 * own clock standing in for the house player's pause. Returns what happened.
 */
function playOut(room, { maxSteps = 200000, check = null } = {}) {
  let stall = 0;
  let steps = 0;
  for (; steps < maxSteps && room.status === 'playing'; steps++) {
    const v = room.version;
    if (room.bankruptChoice) room.bankruptChoiceDue();
    for (const t of [...room.trades]) {
      if (room.autoPlayed(room.player(t.to))) room.botTradeReply(t.id);
    }
    if (room.auction) {
      room.runBotAuction();
      if (room.version === v && room.auction) room.finishAuction();
    } else {
      room.runBot();
    }
    if (check && steps % 10 === 0) check(room);
    stall = room.version === v ? stall + 1 : 0;
    if (stall > 6) break;
  }
  return { steps, stalled: stall > 6, ended: room.status === 'ended' };
}

async function inProcess() {
  // ------------------------------------------------------------ settings --
  section('the setting has a third value');
  {
    PASS(isDeepStrictEqual(BANKRUPT_RULES, ['release', 'auction', 'choose']) && DEFAULT_SETTINGS.bankruptProperties === 'release',
      'release, auction and choose — and a new table still releases', short(BANKRUPT_RULES));
    const room = bare();
    room.hostId = A;
    const ok = room.updateSettings(A, { bankruptProperties: 'choose' });
    PASS(!ok?.error && room.settings.bankruptProperties === 'choose', 'the host picks "the player decides"');
    const msg = 'Bankrupt properties go back to the bank, to auction, or the player decides';
    const bad = [null, 1, true, 'decide', ['choose'], {}].filter((v) => room.updateSettings(A, { bankruptProperties: v })?.error !== msg);
    PASS(bad.length === 0 && room.settings.bankruptProperties === 'choose', 'anything else is refused with a plain message', short(bad));
    const cashBefore = room.settings.startingCash;
    room.updateSettings(A, { bankruptProperties: 'raffle', startingCash: 4000 });
    PASS(room.settings.startingCash === cashBefore, 'and a patch carrying a bad value is refused whole');

    const cup = bare({ humans: [A, B] });
    cup.cupMatch = { cupId: 't', round: 1 };
    cup.hostId = A;
    PASS(cup.updateSettings(A, { bankruptProperties: 'choose' })?.error === 'A cup table is set by the cup'
      && cup.settings.bankruptProperties === 'release', 'a cup table refuses it');
    cup.settings.bankruptProperties = 'choose';
    PASS(cup.ruleOn('bankruptProperties') === 'release', 'and plays the default even with the field forced');
    cup.start(A);
    give(cup, B, [6, 7]);
    cup.declareBankrupt(B);
    PASS(cup.status === 'ended' && !cup.bankruptChoice, 'a cup game never asks anybody anything');
    const forced = bare();
    forced.settings.bankruptProperties = 'lottery';
    PASS(forced.ruleOn('bankruptProperties') === 'release', 'a value forced past the door plays as the default');
  }

  // ------------------------------------------------------- the question --
  section('choose: the bankrupt player is asked, and only they are');
  {
    const room = chooseTable({ settings: { turnSeconds: 90 } });
    const [a, b, c] = [A, B, C].map((id) => room.player(id));
    give(room, C, [11, 13, 14], { houses: 1 });
    give(room, C, [21], { mortgaged: true });
    PASS(room.turn.playerId === A && room.turn.endsAt > Date.now() && !!room.timers.turn, 'setup: Ann\'s turn, clock running');
    room.declareBankrupt(C);
    const q = room.bankruptChoice;
    PASS(q && q.playerId === C && q.name === 'Cat' && isDeepStrictEqual(q.properties, [11, 13, 14, 21])
      && q.endsAt >= Date.now() + 19000 && q.endsAt <= Date.now() + 20500,
    'Cat concedes: the question is open — hers, her four deeds in board order, twenty seconds', short(q));
    PASS(c.bankrupt && [11, 13, 14, 21].every((i) => !room.own(i)) && !room.auction && !room.estate,
      'she is out, and the deeds are already the bank\'s (houses back, mortgage lifted) — nothing sold yet');
    const tail = lastLines(room, 3);
    PASS(isDeepStrictEqual(tail, ['Cat concedes the game', 'Cat went bankrupt', 'Cat is deciding what happens to their 4 properties']),
      'the log: she conceded, went bankrupt, and is deciding — it does not say where the streets went yet', short(tail));
    PASS(room.turn.playerId === A && room.turn.phase === 'roll' && room.turn.endsAt === null && !room.timers.turn,
      'Ann\'s turn is held: no clock runs down while Cat thinks', short({ endsAt: room.turn.endsAt }));
    const held = ['roll', 'endTurn', 'buy', 'skipBuy', 'jailPay', 'jailCard'].map((m) => room[m](A)?.error);
    PASS(held.every((e) => e === WAIT('Cat')), 'rolling, buying, ending the turn and prison all wait on her', short(held));
    PASS(room.workPending() === true, 'and the stall watchdog sees work still due');
    a.botControlled = true;
    const v = room.version;
    room.runBot();
    PASS(room.version === v && room.turn.rolledThisTurn === false, 'the house does not play Ann\'s turn under the question either');
    a.botControlled = false;

    const seenByAnn = room.serializeFor([A]);
    const seenByCat = room.serializeFor([C]);
    const rail = room.serializeFor(new Set());
    PASS(seenByAnn.bankruptChoice?.playerId === room.aliasFor(C) && seenByCat.bankruptChoice?.playerId === C
      && rail.bankruptChoice?.playerId === room.aliasFor(C) && seenByAnn.bankruptChoice.name === 'Cat'
      && isDeepStrictEqual(seenByAnn.bankruptChoice.properties, [11, 13, 14, 21]),
    'everyone sees the question; only Cat sees her own id in it — everybody else her alias');
    PASS(!JSON.stringify(seenByAnn).includes(C) && !JSON.stringify(rail).includes(C), 'and her token is nowhere in anybody else\'s state');

    PASS(room.answerBankruptChoice(B, { auction: true })?.error === 'That decision is not yours' && room.bankruptChoice,
      'Ben cannot answer it for her');
    const shapes = [{ auction: 'yes' }, null, {}, 'auction', { auction: 1 }, [true], undefined];
    const refused = shapes.filter((x) => room.answerBankruptChoice(C, x)?.error !== 'Choose the bank or an auction');
    PASS(refused.length === 0 && room.bankruptChoice?.playerId === C, 'an answer that is not true or false is refused, and the question stays open', short(refused));

    const before = a.money + b.money;
    PASS(room.answerBankruptChoice(C, { auction: true })?.ok === true && !room.bankruptChoice, 'Cat answers: auction');
    PASS(isDeepStrictEqual(lastLines(room, 3), ['Cat chose to auction their properties', "Cat's 4 properties go to auction, one at a time",
      'Venice goes to auction! Starting bid $10']) && isDeepStrictEqual(room.auction?.estate, { from: 'Cat', left: 3 }),
    'the log says what she chose, and the first lot is up', short(lastLines(room, 3)));
    PASS(room.answerBankruptChoice(C, { auction: false })?.error === 'There is nothing to decide right now', 'answering twice changes nothing');
    room.bid(B, 100); room.passBid(A);            // Venice to Ben
    room.passBid(A); room.passBid(B);             // Milan stays with the bank
    room.bid(A, 50); room.passBid(B);             // Rome to Ann
    room.passBid(A); room.passBid(B);             // Shenzhen stays with the bank
    PASS(isDeepStrictEqual(owned(room, [11, 13, 14, 21]), [B, null, A, null])
      && [11, 14].every((i) => room.own(i).houses === 0 && !room.own(i).mortgaged), 'lots sold go to their winners, bare; the rest stay with the bank');
    PASS(a.money + b.money === before - 150 && c.money === 0, 'and the only money that moved is the $150 the winners paid the bank',
      short({ before, after: a.money + b.money }));
    PASS(!room.auction && room.turn.playerId === A && room.turn.phase === 'roll' && room.turn.endsAt > Date.now() && !!room.timers.turn,
      'then Ann\'s turn comes back exactly as it was, with a fresh clock', short(room.turn));
    PASS(room.roll(A, [1, 2]).ok === true, 'and she rolls');
  }

  section('choose: back to the bank');
  {
    const room = chooseTable();
    give(room, C, [6, 7]);
    room.declareBankrupt(C);
    const before = cash(room);
    room.answerBankruptChoice(C, { auction: false });
    PASS(!room.bankruptChoice && !room.auction && !room.own(6) && !room.own(7) && cash(room) === before
      && logText(room).at(-1) === 'Cat gave their properties back to the bank', 'she gives them back: nothing sold, nothing paid', logText(room).at(-1));
    PASS(room.roll(A, [2, 4]).ok === true && room.player(A).pos === 6, 'and the game goes on — Ann lands on Tel Aviv…');
    PASS(room.turn.pending?.tile === 6, '…which is the bank\'s to sell her now');
  }

  section('Give up with the answer already given');
  {
    const r1 = chooseTable();
    give(r1, C, [16, 18]);
    r1.declareBankrupt(C, { auction: true });
    PASS(!r1.bankruptChoice && r1.auction?.tile === 16 && isDeepStrictEqual(lastLines(r1, 5), ['Cat concedes the game', 'Cat went bankrupt',
      'Cat chose to auction their properties', "Cat's 2 properties go to auction, one at a time", 'Frankfurt goes to auction! Starting bid $10']),
    'conceding with { auction: true }: nobody is asked twice — the sale starts', short(lastLines(r1, 5)));
    const r2 = chooseTable();
    give(r2, C, [16, 18]);
    r2.declareBankrupt(C, { auction: false });
    PASS(!r2.bankruptChoice && !r2.auction && logText(r2).at(-1) === 'Cat gave their properties back to the bank' && r2.roll(A).ok,
      'with { auction: false }: back to the bank, and play on');
    const r3 = chooseTable();
    give(r3, C, [16]);
    r3.declareBankrupt(C, { auction: 'maybe' });
    PASS(r3.bankruptChoice?.playerId === C, 'an answer that is not true or false at the door: she concedes, and is asked');
    const r4 = bare();
    r4.hostId = A; r4.start(A);
    give(r4, C, [16]);
    r4.declareBankrupt(C, { auction: true });
    PASS(!r4.auction && !r4.bankruptChoice && logText(r4).at(-1) === 'Cat went bankrupt — the streets return to the bank',
      'at a release table the answer is ignored: the table\'s rule decides');
    const r5 = bare({ settings: { bankruptProperties: 'auction' } });
    r5.hostId = A; r5.start(A);
    give(r5, C, [16]);
    r5.declareBankrupt(C, { auction: false });
    PASS(r5.auction?.tile === 16 && !r5.bankruptChoice, 'and at an auction table, too');
  }

  section('the bankrupt player held the turn');
  {
    const room = chooseTable({ settings: { turnSeconds: 90 } });
    give(room, C, [26]);
    freshTurn(room, C);
    room.declareBankrupt(C);
    PASS(room.turn.playerId === A && room.bankruptChoice?.playerId === C && room.turn.endsAt === null,
      'Cat goes out on her own turn: it passes to Ann, who waits on Cat\'s answer — with no clock');
    PASS(room.roll(A)?.error === WAIT('Cat'), 'Ann cannot roll yet');
    room.answerBankruptChoice(C, { auction: false });
    PASS(room.turn.endsAt > Date.now() && room.roll(A, [1, 2]).ok === true, 'answered: Ann gets her clock and rolls');
  }

  section('nobody answers in time');
  {
    // Nothing at stake for anybody: the house sells.
    const r1 = chooseTable();
    give(r1, C, [6]);
    r1.declareBankrupt(C);
    r1.bankruptChoiceDue();
    PASS(!r1.bankruptChoice && r1.auction?.tile === 6
      && logText(r1).includes("Cat didn't choose in time — the house put their properties up for auction"),
    'the twenty seconds run out: the house decides — an auction, with nothing at stake', short(lastLines(r1, 3)));
    // Tel Aviv would finish Ann's colour: the house gives it back.
    const r2 = chooseTable();
    give(r2, A, [7, 9]);
    give(r2, C, [6]);
    r2.declareBankrupt(C);
    r2.bankruptChoiceDue();
    PASS(!r2.bankruptChoice && !r2.auction && !r2.own(6)
      && logText(r2).at(-1) === "Cat didn't choose in time — the house gave their properties back to the bank",
    'and back to the bank when the lot would hand the leader a colour', logText(r2).at(-1));
    PASS(r2.roll(A).ok === true, 'either way the game moves on');

    // The real timer, on a shortened clock.
    const saved = { ...GameRoom.BANKRUPT_CHOICE };
    GameRoom.BANKRUPT_CHOICE.ms = 60;
    try {
      const r3 = chooseTable();
      give(r3, C, [6]);
      r3.declareBankrupt(C);
      PASS(!!r3.timers.bankruptChoice && r3.bankruptChoice, 'the question carries its own timer');
      await until(() => !r3.bankruptChoice, 2000);
      PASS(!r3.bankruptChoice && !r3.timers.bankruptChoice && r3.auction?.tile === 6, 'which answers it when it fires');
    } finally {
      Object.assign(GameRoom.BANKRUPT_CHOICE, saved);
    }
  }

  section('a player who is not there to ask');
  {
    const r1 = chooseTable();
    give(r1, C, [6]);
    r1.player(C).connected = false;
    r1.bankrupt(r1.player(C), null);
    PASS(!r1.bankruptChoice && r1.auction?.tile === 6 && logText(r1).includes("Cat isn't here to choose — the house put their properties up for auction"),
      'disconnected: not asked — the house decides on the spot (an auction, here)', short(lastLines(r1, 3)));
    const r2 = chooseTable();
    give(r2, A, [7, 9]);
    give(r2, C, [6]);
    r2.player(C).botControlled = true;
    r2.bankrupt(r2.player(C), null);
    PASS(!r2.bankruptChoice && !r2.auction && logText(r2).at(-1) === "Cat isn't here to choose — the house gave their properties back to the bank",
      'a seat the house is covering: the same, and back to the bank where an auction would hand Ann a colour');
    const r3 = chooseTable();
    give(r3, C, [16]);
    r3.quit(C);
    PASS(!r3.bankruptChoice && r3.auction?.tile === 16 && logText(r3).includes('Cat left the game')
      && logText(r3).includes("Cat isn't here to choose — the house put their properties up for auction"), 'a walkout');
    const r4 = chooseTable();
    give(r4, C, [16]);
    r4.removeFromPlay(r4.player(C), 'timeout');
    PASS(!r4.bankruptChoice && r4.auction?.tile === 16, 'removed for running out of time');
    const r5 = chooseTable();
    give(r5, C, [16]);
    r5.declareBankrupt(C);
    r5.removePlayer(C);
    PASS(!r5.bankruptChoice && r5.auction?.tile === 16 && logText(r5).includes('Cat stopped watching')
      && logText(r5).includes("Cat isn't here to choose — the house put their properties up for auction"),
    'she closes the app with the question open: the house answers at once rather than holding the table', short(lastLines(r5, 4)));
  }

  section('a house player is asked, and answers like a person');
  {
    const room = chooseTable({ humans: [A, B], bots: 1 });
    const bot = room.players.find((p) => p.isBot);
    give(room, bot.id, [6]);
    room.bankrupt(bot, null);
    const q = room.bankruptChoice;
    const wait = room.timers.bankruptChoice?._idleTimeout;
    PASS(q?.playerId === bot.id && wait >= GameRoom.BANKRUPT_CHOICE.botMs[0] && wait <= GameRoom.BANKRUPT_CHOICE.botMs[1],
      `the house player gets the same question, and takes a person's pause over it (${wait} ms)`);
    room.bankruptChoiceDue();
    PASS(!room.bankruptChoice && room.auction?.tile === 6 && logText(room).includes(`${bot.name} chose to auction their properties`)
      && !logText(room).some((t) => t.includes('the house')),
    'its answer reads like anybody\'s — the rule\'s answer, in its own name', short(lastLines(room, 3)));
    const twin = chooseTable({ humans: [A, B], bots: 1 });
    const bot2 = twin.players.find((p) => p.isBot);
    bot2.id = bot.id;
    give(twin, bot.id, [6]);
    twin.bankrupt(bot2, null);
    PASS(twin.timers.bankruptChoice?._idleTimeout === wait, 'and the same pause every time the same game is replayed');
  }

  section('two players out at once are asked one after the other');
  {
    const room = chooseTable({ humans: [A, B, C, D] });
    freshTurn(room, A, { rolledThisTurn: true, dice: [1, 2], phase: 'end' });
    for (const [id, tiles] of [[B, [6]], [C, [16]]]) {
      give(room, id, tiles, { mortgaged: true });
      room.player(id).money = 10;
    }
    room.applyCard(room.player(A), { kind: 'collectEach', amount: 50 });
    PASS(room.player(B).bankrupt && room.player(C).bankrupt && room.bankruptChoice?.playerId === B
      && room.choiceQueue.length === 1 && room.choiceQueue[0].playerId === C,
    'a card knocks out Ben and Cat: Ben is asked first, Cat waits her turn', short(room.choiceQueue));
    PASS(logText(room).filter((t) => / is deciding what happens to /.test(t)).length === 1, 'only one question on the table at a time');
    const t0 = Date.now();
    room.answerBankruptChoice(B, { auction: false });
    PASS(room.bankruptChoice?.playerId === C && room.bankruptChoice.endsAt >= t0 + 19000 && room.endTurn(A)?.error === WAIT('Cat'),
      'Ben answers: Cat is asked, with her own twenty seconds — and the turn still waits');
    room.answerBankruptChoice(C, { auction: true });
    room.passBid(A); room.passBid(D);
    PASS(!room.bankruptChoice && !room.auction && room.turn.playerId === A && room.endTurn(A).ok === true && room.turn.playerId === D,
      'Cat answers, her lot falls, and Ann ends her turn');
  }

  section('the clock runs out, or the game ends, while somebody is deciding');
  {
    const r1 = chooseTable({ settings: { timeLimit: 30 } });
    give(r1, C, [11]);
    r1.declareBankrupt(C);
    r1.clockRanOut();
    PASS(r1.status === 'ended' && r1.endReason === 'time' && !r1.bankruptChoice && !r1.timers.bankruptChoice && !r1.own(11)
      && logText(r1).includes("Time's up — Cat's properties go back to the bank"),
    'time runs out on an unrolled turn: nothing is sold after time, the streets stay with the bank, the game ends', short(lastLines(r1, 4)));
    const r2 = chooseTable({ settings: { timeLimit: 30 } });
    r2.roll(A, [1, 2]);
    r2.skipBuy(A); r2.passBid(A); r2.passBid(B); r2.passBid(C);
    give(r2, C, [11]);
    r2.declareBankrupt(C);
    r2.clockRanOut();
    PASS(r2.status === 'playing' && !r2.bankruptChoice && r2.timeUp
      && isDeepStrictEqual(lastLines(r2, 2), ["Time's up — Cat's properties go back to the bank", "Time's up — this is the last turn"]),
    'after Ann has rolled: the question is dropped and her turn is the last', short(lastLines(r2, 2)));
    r2.endTurn(A);
    PASS(r2.status === 'ended' && r2.endReason === 'time', 'and the game ends when she ends it');

    const r3 = chooseTable();
    give(r3, C, [11]);
    r3.declareBankrupt(C);
    r3.declareBankrupt(B);
    PASS(r3.status === 'ended' && r3.winner?.id === A && !r3.bankruptChoice && !r3.timers.bankruptChoice && !r3.own(11),
      'Ben concedes too: Ann has won, and there is nobody left to sell to — the question goes with the game');
  }

  // ------------------------------------------------------ the house rule --
  section('the house\'s rule: back to the bank when an auction would feed the leader');
  {
    const room = chooseTable({ humans: [A, B, C, D] });
    const [a, b, , d] = [A, B, C, D].map((id) => room.player(id));
    const cat = room.player(C);
    cat.bankrupt = true;
    const reset = () => {
      room.ownership = {};
      for (const p of [a, b, d]) p.money = 2000;
    };
    const verdict = (lots) => (room.botEstateChoice(cat, lots) ? 'auction' : 'release');
    reset();
    PASS(verdict([16]) === 'auction', 'nothing at stake for anybody: auction');
    reset(); give(room, A, [7, 9]);
    PASS(room.leaderOf()?.id === A && verdict([6]) === 'release', 'the lot would finish the leader\'s colour: release');
    reset(); give(room, A, [11]);
    PASS(verdict([13]) === 'release', 'it would leave the leader one street short of a three-street colour: release');
    reset(); give(room, A, [37]);
    PASS(verdict([39]) === 'release', 'a two-street colour the leader holds half of: release');
    reset();
    PASS(verdict([1, 3]) === 'release', 'the lots are a whole colour on their own: release — whoever wins them has a set');
    reset(); give(room, B, [7, 9]); a.money = 5000;
    PASS(room.leaderOf()?.id === A && verdict([6]) === 'release',
      'Ann leads, Ben is about to finish a colour — but Ann holds more cash than Ben and Dev together: release');
    reset(); give(room, B, [7, 9]); a.money = 3000;
    PASS(verdict([6]) === 'auction', 'without that much cash, a colour for somebody who is NOT ahead is fine: auction');
    reset(); give(room, D, [7, 9]); d.money = 2500; give(room, A, [37, 39, 31, 32], {});
    PASS(room.leaderOf()?.id === A && verdict([6]) === 'release',
      'Dev is the richest in cash (not the leader by worth) and the lot finishes his colour: release');
    reset(); give(room, A, [31]);
    PASS(verdict([16, 5, 12]) === 'auction', 'airports and utilities never trip the colour test');
    const twice = [verdict([6]), verdict([6]), verdict([16, 18])];
    PASS(new Set(twice.slice(0, 2)).size === 1, 'the same board always gets the same answer', short(twice));
  }
  {
    // At a team table a team's players still in are one purse. Ann and Ben
    // (team 0) against Cat (team 1), whose teammate Dev has just gone out
    // holding a street nobody is racing for.
    const room = bare({ humans: [A, B, C, D], settings: { bankruptProperties: 'choose', teams: 2 } });
    room.hostId = A;
    [A, B, C, D].forEach((id, k) => { room.player(id).team = k < 2 ? 0 : 1; });
    room.start(A);
    const [a, b, c, d] = [A, B, C, D].map((id) => room.player(id));
    const verdict = () => (room.botEstateChoice(d, [16]) ? 'auction' : 'release');
    room.ownership = {};
    d.bankrupt = true;
    const teamsHeld = [a, b, c, d].map((p) => p.team).join('');
    a.money = 1000; b.money = 900; c.money = 1100;
    PASS(teamsHeld === '0011' && verdict() === 'release',
      'teams: Ann and Ben hold $1,900 between them, more than Cat\'s $1,100 — though Cat is the richest player: release', teamsHeld);
    a.money = 600; b.money = 500; c.money = 1100;
    PASS(verdict() === 'auction', 'teams: $1,100 a side — neither out-funds the other: auction');
    a.money = 400; b.money = 300; c.money = 1000;
    PASS(verdict() === 'release', 'teams: Cat alone ($1,000) out-funds Ann and Ben together ($700): release');
    room.settings.teams = 0;
    a.money = 1000; b.money = 900; c.money = 1100;
    PASS(verdict() === 'auction', 'the same purses with teams off: nobody holds more than everyone else together: auction');
  }

  // ----------------------------------------------- nothing made or lost --
  section('money and deeds: nothing created, nothing lost');
  {
    const room = chooseTable({ humans: [A], bots: 3 });
    room.player(A).botControlled = true;
    const bots = room.players.filter((p) => p.isBot);
    const out = bots[0];
    give(room, out.id, [11, 13, 26, 5]);
    room.ownership[26].mortgaged = true;
    const before = cash(room) - out.money;
    const paid = [];
    const realFinish = room.finishAuction.bind(room);
    room.finishAuction = () => {
      const a = room.auction;
      if (a?.leader) paid.push([a.tile, a.leader, a.bid]);
      return realFinish();
    };
    room.bankrupt(out, null);
    room.bankruptChoiceDue();
    PASS(room.auction?.estate?.from === out.name, 'setup: the house player chose to sell (nothing in the lots feeds anybody)');
    for (let i = 0; i < 400 && room.auction; i++) {
      const v = room.version;
      room.runBotAuction();
      if (room.version === v && room.auction) room.finishAuction();
    }
    const lots = [5, 11, 13, 26];
    const sold = paid.reduce((n, [, , bid]) => n + bid, 0);
    PASS(out.money === 0 && !lots.some((i) => room.own(i)?.owner === out.id), 'the bankrupt player keeps nothing');
    PASS(cash(room) + sold === before, 'every dollar is where it was, or paid to the bank for a lot', short({ before, after: cash(room), sold }));
    PASS(paid.every(([i, who]) => room.own(i)?.owner === who && room.own(i).houses === 0)
      && lots.filter((i) => !paid.some(([t]) => t === i)).every((i) => !room.own(i)),
    'every lot is the winner\'s, bare, or still the bank\'s', short(paid));
    PASS(room.status === 'playing' && !room.bankruptChoice && room.turn.phase === 'roll', 'and the table plays on');
  }

  // ------------------------------------------------- seeded, played out --
  section('seeded games at a "player decides" table, played to the end');
  {
    const runs = [];
    for (const seed of [3, 17, 29, 41]) {
      runs.push(seeded(seed, () => {
        const room = bare({ humans: [A], bots: 3, settings: { bankruptProperties: 'choose', maxPlayers: 4, randomizeOrder: true } });
        room.hostId = A;
        room.start(A);
        room.player(A).botControlled = true;
        const said = { asked: 0, answered: 0, house: 0 };
        const realSay = room.say.bind(room);
        room.say = (text, kind) => {
          if (/ is deciding what happens to /.test(text)) said.asked++;
          else if (/ — the house (put|gave) their properties /.test(text)) said.house++;
          else if (/ (chose to auction their properties|gave their properties back to the bank)$/.test(text)) said.answered++;
          return realSay(text, kind);
        };
        const broken = [];
        const check = (r) => {
          for (const [i, o] of Object.entries(r.ownership)) {
            if (r.player(o.owner)?.bankrupt) broken.push(`a bankrupt owner at ${i}`);
          }
          if (r.bankruptChoice && r.player(r.bankruptChoice.playerId)?.bankrupt !== true) broken.push('a question to a player still in');
          if (r.auction && r.turn.phase !== 'auction') broken.push(`auction under phase ${r.turn.phase}`);
        };
        const run = playOut(room, { check });
        return { seed, ...run, said, broken: [...new Set(broken)], turns: room.turnCount, open: !!room.bankruptChoice };
      }));
    }
    PASS(runs.every((r) => r.ended && !r.stalled && !r.open), 'four seeded games end with a winner — no stall, no question left open',
      short(runs.map((r) => `${r.seed}: ${r.ended ? 'ended' : 'NOT ended'} in ${r.turns}`)));
    PASS(runs.every((r) => !r.broken.length), 'no deed held by a player who is out, and no hammer outside the auction phase',
      short(runs.map((r) => r.broken)));
    const total = runs.reduce((n, r) => n + r.said.asked, 0);
    // A question can only go unanswered when the game ends in the same move
    // that put it — the last two players out to one card.
    PASS(total > 0 && runs.every((r) => r.said.answered <= r.said.asked && r.said.asked - r.said.answered <= 1),
      'every question asked along the way got its answer', short(runs.map((r) => r.said)));
  }

  // ------------------------------------------------------------ Play-now --
  section('Play-now tables roll it, and their host may change it');
  {
    PASS(QUICK_ROLL_KEYS.includes('bankruptProperties') && QUICK_HOST_KEYS.includes('bankruptProperties')
      && isDeepStrictEqual(quickRollValues('bankruptProperties'), ['release', 'auction', 'choose']),
    'it is one of the rolled rules, on all three values');
    const rnd = mulberry32(77);
    const tally = { release: 0, auction: 0, choose: 0 };
    const N = 6000;
    for (let i = 0; i < N; i++) tally[rollQuickSettings(['classic'], rnd).bankruptProperties]++;
    const share = (k) => tally[k] / N;
    PASS(Math.abs(share('release') - 0.5) < 0.04 && Math.abs(share('auction') - 0.25) < 0.04 && Math.abs(share('choose') - 0.25) < 0.04,
      'weighted: back to the bank half the time, auction and player-decides a quarter each', short(tally));
    // Eighth of the nine phrases: 1.0.8 put the shuffled board after it,
    // last, where the 1.0.7 apps' eight-entry maps cannot trip on it.
    PASS(quickRollParts({ startingCash: 1500, bankruptProperties: 'choose' }, 'Classic')[7] === 'bankrupt player decides'
      && quickRollParts({ bankruptProperties: 'auction' })[7] === 'bankrupt streets auctioned'
      && quickRollParts({ bankruptProperties: 'release' })[7] === 'bankrupt streets back to the bank',
    'and it is said in plain words with the rest of the roll');

    const q = new GameRoom(`r3q-${++serial}`, () => {});
    made.push(q);
    q.makeQuickMatch(86400, { ...rollQuickSettings(['classic'], mulberry32(5)), bankruptProperties: 'choose' });
    q.addPlayer({ id: A, name: 'Ann' });
    q.addPlayer({ id: B, name: 'Ben' });
    PASS(q.settings.bankruptProperties === 'choose' && q.ruleOn('bankruptProperties') === 'choose',
      'a Play-now table plays the value it rolled');
    PASS(/ · bankrupt player decides · shuffled board o(n|ff)$/.test(logText(q).find((t) => t.startsWith('This table rolled:')) || '')
      && q.serialize().quickRoll.parts[7] === 'bankrupt player decides', 'the lobby and the log say so');
    PASS(q.quickLobbyView()?.editable?.includes('bankruptProperties'), 'and the host may change it in the lobby');
    q.player(B).ready = true;
    const res = q.updateSettings(q.hostId, { bankruptProperties: 'auction' });
    PASS(!res?.error && q.settings.bankruptProperties === 'auction' && q.ruleOn('bankruptProperties') === 'auction'
      && logText(q).at(-1) === 'Ann changed the rules: bankrupt streets auctioned', 'the host changes it, and the table is told', logText(q).at(-1));
    PASS(q.quickEdited().includes('bankruptProperties') && q.player(B).ready === false, 'the lobby marks it changed, and Ben says ready again');
    PASS(q.updateSettings(q.hostId, { bankruptProperties: 'lottery' })?.error === 'Bankrupt properties go back to the bank, to auction, or the player decides',
      'a value off the list is refused there too');
    const locked = 'A Play-now table keeps its seats, privacy, house players, teams and clock';
    PASS(q.updateSettings(q.hostId, { auctionOnly: true })?.error === locked
      && q.updateSettings(q.hostId, { bankruptProperties: 'choose', auctionOnly: true })?.error === locked
      && q.settings.bankruptProperties === 'auction',
    'auction-only stays private-table only — a patch reaching for it is refused whole');
    // The shuffled board is the other half of that old line, and from 1.0.8
    // it is a rolled rule like this one (test/quick-shuffle.mjs has the rest).
    const shuffleWas = q.settings.shuffleBoard;
    PASS(!q.updateSettings(q.hostId, { shuffleBoard: !shuffleWas })?.error && q.settings.shuffleBoard === !shuffleWas
      && q.settings.bankruptProperties === 'auction',
    'the shuffled board is the host\'s to change from 1.0.8', `shuffled board ${q.settings.shuffleBoard ? 'on' : 'off'}`);
    PASS(q.updateSettings(B, { bankruptProperties: 'release' }) === undefined && q.settings.bankruptProperties === 'auction',
      'a guest changes nothing');
    q.clearQuickTimers();

    // At the table: a person is asked, and a house player passes for one.
    const t = bare({ humans: [A], bots: 2 });
    t.quick = true;
    t.settings.bankruptProperties = 'choose';
    t.hostId = A;
    t.start(A);
    const bot = t.players.find((p) => p.isBot);
    give(t, bot.id, [16]);
    t.bankrupt(bot, null);
    PASS(t.bankruptChoice?.playerId === bot.id && t.serializeFor([A]).players.every((p) => p.isBot === false),
      'at a Play-now table a house player is asked like a person, and nothing gives it away');
    t.bankruptChoiceDue();
    PASS(!logText(t).some((x) => x.includes('the house')) && !t.bankruptChoice, 'and answers in its own name');
    t.quick = false;
  }

  // ------------------------------------------------------------ bidding --
  section('house players bid smarter: their own colour, and the leader\'s');
  {
    /**
     * The most a bot will pay for Berlin ($200, the last of Germany) in each
     * situation, at each skill. Same bot, same purse, only the board moves.
     */
    const caps = {};
    for (const lvl of ['easy', 'normal', 'hard']) {
      const r = bare({ humans: ['h'], bots: 3, settings: { botLevel: lvl } });
      r.hostId = 'h';
      r.start('h');
      // Every bot at the same pitch, so the skills are compared and not the
      // tempers their random ids happened to give them.
      r.botTemper = () => 1;
      const [x, y, z] = r.players.filter((p) => p.isBot);
      const ask = () => { r.auctionCaps = {}; return r.botAuctionCap(x, { tile: 19 }); };
      const reset = () => {
        r.ownership = {};
        for (const p of r.players) p.money = 3000;
      };
      reset();
      const plain = ask();
      reset(); give(r, x.id, [16, 18]);
      const mine = ask();
      reset(); give(r, y.id, [16, 18]); y.money = 4000;
      const leaderSet = r.leaderOf()?.id === y.id ? ask() : NaN;
      reset(); give(r, y.id, [16, 18]); z.money = 6000;
      const rivalSet = r.leaderOf()?.id === z.id ? ask() : NaN;
      reset(); give(r, y.id, [16]); y.money = 4000;
      const leaderNear = ask();
      caps[lvl] = { plain, mine, leaderSet, rivalSet, leaderNear };
    }
    const { easy, normal, hard } = caps;
    PASS([easy.plain, easy.mine, easy.leaderSet, easy.rivalSet].every((v) => v === 100), 'easy still bids half the sticker, whatever is at stake', short(easy));
    for (const [name, c] of [['normal', normal], ['hard', hard]]) {
      PASS(c.mine > c.plain && c.mine > 200, `${name}: pays more to finish its own colour than for a street that finishes nothing`, short(c));
      PASS(c.leaderSet > c.plain && c.leaderSet > c.rivalSet, `${name}: pays more again to keep the LEADER from finishing one — more than for any other rival`, short(c));
      PASS(c.leaderNear >= c.plain, `${name}: and does not let the leader take a colour's second street cheaply`, short(c));
    }
    PASS(hard.mine > normal.mine && hard.leaderSet > normal.leaderSet, 'hard leans on both harder than normal', short({ normal, hard }));
  }

  section('…and never bid themselves bankrupt');
  {
    for (const lvl of ['normal', 'hard']) {
      const r = bare({ humans: ['h'], bots: 2, settings: { botLevel: lvl } });
      r.hostId = 'h';
      r.start('h');
      const [x, y] = r.players.filter((p) => p.isBot);
      const auctionFor = (setup) => {
        r.ownership = {};
        for (const p of r.players) { p.money = 2500; p.pos = 25; }
        give(r, x.id, [16, 18]);
        x.money = 400;
        setup();
        freshTurn(r, 'h', { rolledThisTurn: true, dice: [1, 2], phase: 'end' });
        r.startAuction(19);
        r.passBid('h');
        let best = 0;
        for (let i = 0; i < 200 && r.auction; i++) {
          const a = r.auction;
          if (a.leader === x.id) best = a.bid;
          // The rival keeps raising, so the bot shows how far it would go.
          if (a.leader === x.id || !a.inRace.includes(x.id)) {
            if (r.bid(y.id, a.bid + 10)?.error) r.passBid(y.id);
          } else r.runBotAuction();
          if (r.auction && !r.auction.inRace.includes(x.id)) { r.passBid(y.id); break; }
        }
        if (r.auction) r.finishAuction();
        return best;
      };
      const safe = auctionFor(() => {});
      const exposed = auctionFor(() => {
        // Britain, built to hotels, six to nine squares ahead of it.
        give(r, y.id, [31, 32, 34], { houses: 5 });
      });
      PASS(safe >= 250 && exposed === 0,
        `${lvl}: with $400 and Germany one street short it bids $${safe} for Berlin — but nothing at all with three hotels a throw away that it could not pay`,
        short({ safe, exposed }));
    }

    // Over whole games: whenever a house player bids, what its next throw can
    // cost stays payable — from the cash left, or what it could raise.
    const breaches = [];
    let bids = 0;
    for (const [seed, lvl, rule] of [[5, 'normal', 'auction'], [6, 'hard', 'auction'], [7, 'hard', 'choose'], [8, 'normal', 'release']]) {
      seeded(seed, () => {
        const room = bare({ humans: [A], bots: 3, settings: { botLevel: lvl, bankruptProperties: rule, maxPlayers: 4 } });
        room.hostId = A;
        room.start(A);
        room.player(A).botControlled = true;
        const realBid = room.bid.bind(room);
        room.bid = (id, amount) => {
          const tile = room.auction?.tile;
          const res = realBid(id, amount);
          const p = room.player(id);
          if (res?.ok && p?.isBot && tile != null) {
            bids++;
            const lot = Math.floor(room.tile(tile).price / 2);
            if (p.money + room.botLiquidity(p) + lot < room.botReach(p, 0)) breaches.push(`${lvl} seed ${seed}: ${p.name} at $${p.money}`);
          }
          return res;
        };
        playOut(room);
      });
    }
    PASS(bids > 50 && breaches.length === 0, `over four seeded games, not one of ${bids} house-player bids left a rent within one throw it could not cover`,
      breaches.slice(0, 3).join('; '));
  }

  section('hard: strays mortgaged to build stay in hock until nothing is short');
  {
    // Britain held whole and bare, both airports in hock, Tel Aviv a stray.
    // Lifting the airports and then mortgaging them again to pay for houses
    // hands the bank $11 a deed for nothing — and every player reads it.
    const endPhase = (money) => {
      const r = bare({ humans: ['h'], bots: 2, settings: { botLevel: 'hard' } });
      r.hostId = 'h';
      r.start('h');
      const x = r.players.find((p) => p.isBot);
      r.ownership = {};
      give(r, x.id, [31, 32, 34, 6]);
      give(r, x.id, [5, 15], { mortgaged: true });
      x.money = money;
      freshTurn(r, x.id, { rolledThisTurn: true, dice: [1, 2], phase: 'end' });
      const lifted = [];
      const mortgaged = [];
      const un = r.unmortgage.bind(r);
      const mo = r.mortgage.bind(r);
      r.unmortgage = (id, i, ...rest) => { const res = un(id, i, ...rest); if (!res?.error) lifted.push(i); return res; };
      r.mortgage = (id, i, ...rest) => { const res = mo(id, i, ...rest); if (res && !res.error) mortgaged.push(i); return res; };
      r.botUnmortgage(x);
      r.botBuild(x);
      const houses = [31, 32, 34].reduce((n, i) => n + (r.own(i).houses || 0), 0);
      return { lifted, mortgaged, houses, money: x.money };
    };
    const tight = endPhase(1400);
    PASS(tight.lifted.length === 0 && tight.mortgaged.includes(6) && tight.houses > 0,
      'with $1,400 and Britain short of houses: the airports stay in hock, Tel Aviv is mortgaged, and the houses go up', short(tight));
    const flush = endPhase(5000);
    PASS(flush.lifted.includes(5) && flush.lifted.includes(15) && flush.mortgaged.length === 0 && flush.houses >= 9,
      'with $5,000 nothing is short: both airports are lifted, nothing is mortgaged, Britain gets at least three houses a street', short(flush));
  }

  section('hard is stronger than normal: a seeded series');
  {
    // One seat the house plays for a person (always normal) against three
    // house players, at normal and then at hard, on the same seeds. The
    // fewer games that one seat wins, the stronger the three. (The full
    // 720-game measurement is in docs/API-1.0.6.md, Round 3.) Along the
    // way: no deed a house player lifts out of hock is mortgaged again in the
    // same turn — its building fund and its lifts must not undo each other.
    const GAMES = 120;
    const flips = [];
    let lifts = 0;
    const series = (botLevel) => {
      let wins = 0;
      for (let s = 1; s <= GAMES; s++) {
        seeded(7000 + s, () => {
          const room = bare({ humans: ['watcher'], bots: 3, settings: { botLevel, maxPlayers: 4, randomizeOrder: true } });
          room.hostId = 'watcher';
          room.start('watcher');
          room.player('watcher').botControlled = true;
          const turnOf = () => `${room.turnCount}:${room.turn?.playerId}`;
          let liftedIn = null;
          let lifted = new Set();
          const un = room.unmortgage.bind(room);
          const mo = room.mortgage.bind(room);
          room.unmortgage = (id, i, ...rest) => {
            const res = un(id, i, ...rest);
            if (!res?.error) {
              lifts++;
              if (liftedIn !== turnOf()) { liftedIn = turnOf(); lifted = new Set(); }
              lifted.add(i);
            }
            return res;
          };
          room.mortgage = (id, i, ...rest) => {
            const res = mo(id, i, ...rest);
            if (res && !res.error && liftedIn === turnOf() && lifted.has(i)) {
              flips.push(`${botLevel} seed ${7000 + s}: ${room.player(id)?.name} ${room.tile(i).name}`);
            }
            return res;
          };
          for (let steps = 0; room.status === 'playing' && room.turnCount < 500 && steps < 80000; steps++) {
            room.runBot();
            if (room.auction) {
              const v = room.version;
              room.runBotAuction();
              if (room.version === v && room.auction) room.finishAuction();
            }
            for (const t of [...room.trades]) if (room.autoPlayed(room.player(t.to))) room.botTradeReply(t.id);
          }
          const winner = room.status === 'ended' ? room.winner?.id : room.rankByWorth()[0]?.id;
          if (winner === 'watcher') wins++;
          room.dispose();
        });
      }
      return wins;
    };
    const normal = series('normal');
    const hard = series('hard');
    PASS(hard < normal, `the seat the house plays for a person won ${normal}/${GAMES} against normal bots and ${hard}/${GAMES} against hard ones`,
      `${((normal / GAMES) * 100).toFixed(0)}% → ${((hard / GAMES) * 100).toFixed(0)}%`);
    PASS(lifts > 50 && flips.length === 0,
      `over the same ${GAMES * 2} games, not one of ${lifts} mortgages lifted was taken out again in the same turn`, flips.slice(0, 3).join('; '));
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

function seat(srv, name) {
  const token = `r3-${name.toLowerCase()}-${hex(6)}`;
  const sock = io(srv.url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(sock);
  const chair = { sock, name, token, state: null, seq: 0, toasts: [] };
  sock.on('state', (s) => { chair.state = s; chair.seq++; });
  sock.on('toast', (t) => chair.toasts.push(t?.message));
  chair.emit = (...a) => sock.emit(...a);
  chair.create = () => new Promise((r) => sock.emit('createRoom', { token }, (d) => r(d?.roomId || '')));
  chair.quickplay = () => new Promise((r) => sock.emit('quickplay', { token }, (d) => r(d?.roomId || '')));
  chair.join = (roomId, extra = {}) => sock.emit('join', { roomId, token, name, flag: '', canReady: true, ...extra });
  chair.idOf = (who) => chair.state?.players?.find((p) => p.name === who)?.id;
  chair.heard = (msg, ms = 3000) => until(() => chair.toasts.includes(msg), ms);
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

/**
 * Play the table by hand until `who` owns a deed: everybody rolls and ends
 * their turn, only `who` ever buys, and every auction is passed by all.
 */
async function playUntilOwner(chairs, who, maxMoves = 400) {
  const owns = () => Object.values(who.state?.ownership || {}).some((o) => o.owner === who.token);
  for (let n = 0; n < maxMoves && !owns(); n++) {
    const st = who.state;
    if (st?.status !== 'playing') return false;
    if (st.auction) {
      for (const c of chairs) c.emit('passBid');
      await until(() => !who.state.auction || who.state.auction.tile !== st.auction.tile, 2000);
      continue;
    }
    const turn = chairs.find((c) => c.state?.turn?.playerId === c.token);
    if (!turn) { await sleep(20); continue; }
    const t = turn.state.turn;
    const seq = turn.seq;
    if (t.phase === 'roll') turn.emit('roll');
    else if (t.phase === 'action' && t.pending?.type === 'buy') turn.emit(turn === who ? 'buy' : 'skipBuy');
    else if (t.phase === 'debt') turn.emit('payDebt');
    else turn.emit('endTurn');
    await until(() => turn.seq !== seq, 2000);
  }
  return owns();
}

/**
 * Play on until a turn is waiting on its roll with nothing else going on:
 * whoever is on turn and has rolled ends it, auctions are passed, deeds on
 * offer declined.
 */
async function settle(chairs) {
  for (let n = 0; n < 40; n++) {
    const any = chairs.find((c) => c.state?.status === 'playing')?.state;
    if (!any) return;
    if (any.auction) {
      for (const c of chairs) c.emit('passBid');
      await until(() => !chairs[0].state.auction, 2000);
      continue;
    }
    const turn = chairs.find((c) => c.state?.turn?.playerId === c.token);
    if (!turn) { await sleep(20); continue; }
    const t = turn.state.turn;
    if (t.phase === 'roll') return;
    const seq = turn.seq;
    if (t.phase === 'action' && t.pending?.type === 'buy') turn.emit('skipBuy');
    else if (t.phase === 'debt') turn.emit('payDebt');
    else turn.emit('endTurn');
    await until(() => turn.seq !== seq, 2000);
  }
}

/** The chair whose turn it is, once it is waiting on a roll. */
async function atRoll(chairs) {
  let found = null;
  await until(() => {
    found = chairs.find((c) => c.state?.turn?.playerId === c.token && c.state.turn.phase === 'roll' && !c.state.auction);
    return !!found;
  }, 3000);
  return found;
}

async function overTheWire() {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'wire-'));
  const S = await startServer('round3', dir);

  section('over the wire: the question, as phones see it');
  {
    const ann = seat(S, 'Ann');
    const ben = seat(S, 'Ben');
    const cat = seat(S, 'Cat');
    const chairs = [ann, ben, cat];
    const roomId = await table(chairs, { bankruptProperties: 'choose', turnSeconds: 0, isPrivate: false });
    PASS(ann.state.settings.bankruptProperties === 'choose', 'the host sets "the player decides" over the socket');
    ann.emit('start');
    await until(() => chairs.every((c) => c.state?.status === 'playing'));
    const wes = seat(S, 'Wes');
    wes.join(roomId, { spectate: true });
    await until(() => wes.state?.status === 'playing');
    PASS(await playUntilOwner(chairs, cat), 'setup: Cat buys a street');
    // A quiet moment: somebody on turn, before the roll. If that is Cat
    // herself, the turn passes on when she goes out — before its roll too.
    await settle(chairs);
    PASS(!!(await atRoll(chairs)), 'setup: a turn waiting on its roll');
    const deeds = Object.entries(cat.state.ownership).filter(([, o]) => o.owner === cat.token).map(([i]) => Number(i)).sort((x, y) => x - y);
    cat.emit('bankrupt');
    await until(() => chairs.every((c) => c.state?.bankruptChoice) && wes.state?.bankruptChoice);
    const mine = cat.state.bankruptChoice;
    const theirs = ann.state.bankruptChoice;
    PASS(mine?.playerId === cat.token && theirs?.playerId === ann.idOf('Cat') && theirs.playerId !== cat.token
      && wes.state.bankruptChoice.playerId === wes.idOf('Cat'),
    'Cat concedes with no answer (an older dialog): everybody gets state.bankruptChoice — her own id for her, her alias for the rest');
    PASS(isDeepStrictEqual(mine.properties, deeds) && mine.name === 'Cat' && mine.endsAt > Date.now() + 15000,
      'it lists her deeds and when the house will answer for her', short(mine));
    PASS(!JSON.stringify(ann.state).includes(cat.token) && !JSON.stringify(wes.state).includes(cat.token), 'her token reaches nobody else');
    const turn = chairs.find((c) => c !== cat && c.state.turn?.playerId === c.token);
    PASS(!!turn && turn.state.turn.phase === 'roll' && turn.state.turn.endsAt === null, `${turn?.name}'s turn waits, at the roll`);
    turn.emit('roll');
    PASS(await turn.heard(WAIT('Cat')), `${turn.name} tries to roll: "${WAIT('Cat')}"`);
    ben.emit('bankruptChoice', { auction: true });
    PASS(await ben.heard('That decision is not yours'), 'Ben cannot answer for her');
    wes.emit('bankruptChoice', { auction: true });
    PASS(await wes.heard('You are watching this game'), 'nor can somebody watching');
    cat.emit('bankruptChoice', { auction: 'please' });
    PASS(await cat.heard('Choose the bank or an auction') && !!ann.state.bankruptChoice, 'a garbled answer is refused; the question stays');
    cat.emit('bankruptChoice', { auction: true });
    await until(() => ann.state?.auction?.estate?.from === 'Cat');
    PASS(ann.state.bankruptChoice === null && ann.state.auction?.estate?.from === 'Cat'
      && ann.state.log.some((l) => l.text === 'Cat chose to auction their properties'),
    'she answers "auction": the question closes and her first lot is up for everybody', short(ann.state.auction));
    for (let i = 0; i < deeds.length + 2 && ann.state.auction; i++) {
      const tile = ann.state.auction.tile;
      ann.emit('passBid'); ben.emit('passBid');
      await until(() => !ann.state.auction || ann.state.auction.tile !== tile, 3000);
    }
    PASS(!ann.state.auction && ann.state.turn.phase === 'roll', 'every lot falls, and the turn comes back to the roll');
    const before = turn.state.turn.rolledThisTurn;
    turn.emit('roll');
    PASS(await until(() => turn.state.turn.rolledThisTurn === true) && before === false, `${turn.name} rolls — the game goes on`);
    for (const c of [...chairs, wes]) c.close();
  }

  section('over the wire: Give up with the answer in the dialog');
  {
    const ann = seat(S, 'Ann');
    const ben = seat(S, 'Ben');
    const cat = seat(S, 'Cat');
    const chairs = [ann, ben, cat];
    await table(chairs, { bankruptProperties: 'choose', turnSeconds: 0 });
    ann.emit('start');
    await until(() => chairs.every((c) => c.state?.status === 'playing'));
    PASS(await playUntilOwner(chairs, cat), 'setup: Cat buys a street');
    await until(() => !ann.state.auction);
    cat.emit('bankrupt', { auction: false });
    await until(() => ann.state.log.some((l) => l.text === 'Cat gave their properties back to the bank'));
    PASS(ann.state.bankruptChoice === null && !ann.state.auction
      && ann.state.log.some((l) => l.text === 'Cat gave their properties back to the bank')
      && !Object.values(ann.state.ownership).some((o) => o.owner === ann.idOf('Cat')),
    'bankrupt { auction: false }: nobody is asked again — her streets are the bank\'s');
    for (const c of chairs) c.close();
  }

  section('over the wire: a Play-now lobby');
  {
    const host = seat(S, 'Hana');
    const roomId = await host.quickplay();
    host.join(roomId);
    await until(() => host.state?.quickLobby && host.state.quickRoll);
    const st = host.state;
    PASS(['release', 'auction', 'choose'].includes(st.settings.bankruptProperties)
      && /^bankrupt (streets|player)/.test(st.quickRoll.parts[7]),
    'the table rolled what happens to bankrupt streets, and says it with the rest of the roll', short(st.quickRoll.parts));
    PASS(st.quickLobby.editable.includes('bankruptProperties'), 'the host may change it');
    const other = st.settings.bankruptProperties === 'choose' ? 'auction' : 'choose';
    const seq = host.seq;
    host.emit('settings', { bankruptProperties: other });
    await until(() => host.seq !== seq && host.state.settings.bankruptProperties === other);
    PASS(host.state.settings.bankruptProperties === other && host.state.quickRoll.edited.includes('bankruptProperties')
      && host.state.log.some((l) => l.text.startsWith('Hana changed the rules: bankrupt')),
    `…and does (${other}): the lobby marks it, and the log says so`);
    host.emit('settings', { auctionOnly: true });
    PASS(await host.heard('A Play-now table keeps its seats, privacy, house players, teams and clock'),
      'auction-only is still refused there');
    host.close();
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
  Math.random = realRandom;
  for (const r of made) { try { r.dispose(); } catch { /* gone */ } }
  for (const s of sockets) { try { s.close(); } catch { /* closed */ } }
  await Promise.all(children.map(stop));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`\n${failed ? 'FAILED' : 'OK'} — ${passed} passed, ${failed} failed (${((Date.now() - started) / 1000).toFixed(1)}s)`);
process.exit(failed || crashed ? 1 : 0);
