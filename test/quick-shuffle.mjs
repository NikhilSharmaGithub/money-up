// 1.0.8 — the shuffled board at Play-now tables.
//
// Until now a Play-now table always played the printed board: the shuffle
// was a private-table switch, and a table of strangers never met it. From
// 1.0.8 the table rolls it like any other house rule (about one table in
// three), the lobby says so in a ninth phrase at the end of the roll, the
// quick host may switch it either way, and the moment the dice start the log
// says what moved — "The board was shuffled — United States, the priciest
// set, now sits right after START".
//
// The sharp edges. The chip is a promise to four people who never chose it,
// so a table that says "shuffled board on" must deal a shuffled board, and a
// board with nothing to trade must never be dealt the switch at all. The
// ninth phrase must be LAST: the 1.0.7 apps in the stores pair phrases with
// rules by position, and anywhere else would shift every chip after it onto
// the wrong rule. Auction-only stays a private-table rule, and a cup table
// still never shuffles, whatever its fields say.
//
// Two halves, as in round3.mjs: GameRoom driven directly (with Math.random in
// the test's own hand where a deal has to be repeatable), then the real
// server, to see what actually reaches a phone.
//
//   node test/quick-shuffle.mjs
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
import { io } from 'socket.io-client';
import {
  GameRoom, DEFAULT_SETTINGS,
  QUICK_ROLL_KEYS, QUICK_HOST_KEYS, quickRollValues, rollQuickSettings, quickRollParts,
} from '../server/game.js';
import { MAPS, GROUPS, getMap, shuffleMap, canShuffle, boardCanShuffle } from '../server/maps.js';

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
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-quick-shuffle-'));

// A seedable Math.random, so a table deals the same board every time it is
// dealt the same seed.
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
const NAMES = { [A]: 'Ann', [B]: 'Ben', [C]: 'Cat' };

let serial = 0;
const made = [];

/** The house's timers stubbed out, so every move is a direct call. */
function stubbed(room) {
  made.push(room);
  room.scheduleBot = () => {};
  room.maybeBot = () => {};
  room.maybeBotAuction = () => {};
  room.armAuctionTimer = () => {};
  room.scheduleBotTrade = () => {};
  return room;
}

/** A Play-now table dealt `rolled`, with Ann (the host), Ben and Cat sat down. */
function quickTable(rolled) {
  const room = stubbed(new GameRoom(`qs-${++serial}`, () => {}));
  room.makeQuickMatch(86400, rolled);
  for (const id of [A, B, C]) room.addPlayer({ id, name: NAMES[id] });
  return room;
}

/** An ordinary table, host Ann, with whatever settings it is handed. */
function privateTable(settings = {}) {
  const room = stubbed(new GameRoom(`qs-${++serial}`, () => {}));
  for (const id of [A, B]) room.addPlayer({ id, name: NAMES[id] });
  room.updateSettings(A, { turnSeconds: 0, ...settings });
  return room;
}

const logText = (room) => room.log.map((l) => l.text);
const shuffleLine = (room) => logText(room).find((t) => t.startsWith('The board was shuffled'));
const roll = (over = {}) => ({ ...rollQuickSettings(['classic'], mulberry32(5)), ...over });

/**
 * Whether the line that announces a shuffle tells the truth about the board
 * it announces — the whole point of the second half is that a stranger can
 * look at the board and find what it said there.
 */
function lineIsTrue(line, printed, dealt) {
  const name = (g) => GROUPS[g]?.name || g;
  const first = Object.keys(dealt.groups)[0];
  const was = Object.keys(printed.groups)[0];
  const top = dealt.tiles.filter((t) => t.type === 'property').reduce((a, t) => (!a || t.price > a.price ? t : a), null);
  const moved = Object.keys(dealt.groups).filter((g) => dealt.groups[g][0] !== printed.groups[g][0]).length;
  const sets = Object.keys(dealt.groups).length;
  if (line === `The board was shuffled — ${name(first)}, the priciest set, now sits right after START`) {
    return first !== was && first === top.group;
  }
  if (line === `The board was shuffled — ${name(first)} now sits right after START`) {
    return first !== was && first !== top.group;
  }
  if (line === `The board was shuffled — ${moved} of ${sets} sets moved, and ${name(first)} still opens the board`) {
    return first === was && moved > 0;
  }
  return false;
}

/**
 * A board shaped like Classic but with no two sets the same size — 2, 3, 4,
 * 5 and 8 streets — so there is nothing for a shuffle to trade. None of the
 * stock boards is like this today; the test makes one so the rule that keeps
 * the chip honest on such a board is exercised rather than assumed.
 */
function pairlessBoard() {
  const base = MAPS.classic;
  const streets = base.tiles.filter((t) => t.type === 'property').map((t) => t.index);
  const sizes = [2, 3, 4, 5, streets.length - 14];
  const keys = Object.keys(base.groups).slice(0, sizes.length);
  const tiles = base.tiles.map((t) => ({ ...t }));
  const groups = {};
  let at = 0;
  sizes.forEach((n, k) => {
    groups[keys[k]] = streets.slice(at, at + n);
    for (const i of groups[keys[k]]) { tiles[i].group = keys[k]; tiles[i].groupSize = n; }
    at += n;
  });
  return { ...base, id: 'test-pairless', uid: 'test-pairless', name: 'Pairless', tiles, groups };
}

async function inProcess() {
  // ---------------------------------------------------------------- roll --
  section('the roll deals it, about one table in three');
  {
    PASS(QUICK_ROLL_KEYS.at(-1) === 'shuffleBoard' && QUICK_ROLL_KEYS.at(-2) === 'bankruptProperties'
      && quickRollValues('shuffleBoard').join() === 'false,true',
    'it is the last rolled rule, after bankrupt properties, on both values', QUICK_ROLL_KEYS.join(', '));
    PASS(QUICK_HOST_KEYS.includes('shuffleBoard') && !QUICK_HOST_KEYS.includes('auctionOnly'),
      'the quick host may change it; auction-only is still not theirs', QUICK_HOST_KEYS.join(', '));

    const rnd = mulberry32(2026);
    const boardLists = [['classic'], ['random'], ['classic', 'worldwide', 'blitz'], []];
    let notBool = 0;
    for (let i = 0; i < 2000; i++) {
      const v = rollQuickSettings(boardLists[i % boardLists.length], rnd).shuffleBoard;
      if (typeof v !== 'boolean') notBool++;
    }
    PASS(notBool === 0, 'every roll deals a true or a false — on any board list, the empty one included', `${notBool} not a boolean`);

    const N = 6000;
    const seeded77 = mulberry32(77);
    let on = 0;
    for (let i = 0; i < N; i++) if (rollQuickSettings(['classic'], seeded77).shuffleBoard) on++;
    const share = on / N;
    PASS(Math.abs(share - 1 / 3) < 0.03, 'weighted 2 : 1 — a shuffled board about one table in three',
      `${on} / ${N} = ${(share * 100).toFixed(1)}%`);

    // Every other rolled rule still comes out the way it did: one more draw
    // at the end of the roll must not lean on the ones before it.
    const tally = { release: 0, auction: 0, choose: 0 };
    const r2 = mulberry32(78);
    for (let i = 0; i < N; i++) tally[rollQuickSettings(['classic'], r2).bankruptProperties]++;
    PASS(Math.abs(tally.release / N - 0.5) < 0.04 && Math.abs(tally.auction / N - 0.25) < 0.04,
      'and bankrupt properties still land half, a quarter, a quarter', short(tally));
  }

  // ---------------------------------------------------- every stock board --
  section('every board on the shelf can be shuffled, and the roll knows the one that cannot');
  {
    const ids = [...Object.keys(MAPS), 'random'];
    const disagree = [];
    const cannot = [];
    for (const id of ids) {
      const board = seeded(9, () => getMap(id));
      const dealt = shuffleMap(board, 12345);
      // The question the roll asks must have the answer the deal gives.
      if (boardCanShuffle(id) !== dealt.shuffled || canShuffle(board) !== dealt.shuffled) disagree.push(id);
      if (!dealt.shuffled) cannot.push(id);
    }
    PASS(disagree.length === 0, 'asking a board whether it shuffles gets the answer the shuffle itself gives',
      disagree.join(', ') || `${ids.length} boards`);
    PASS(cannot.length === 0, 'every stock board, Random included, has two sets of a size to trade',
      cannot.length ? `cannot: ${cannot.join(', ')}` : `${ids.length - cannot.length} of ${ids.length} can`);
    let random = false;
    const r = mulberry32(31);
    for (let i = 0; i < 300 && !random; i++) random = rollQuickSettings(['random'], r).shuffleBoard;
    PASS(random, 'Random is dealt the shuffle too — without generating a board to ask');

    // A board with nothing to trade, put on the shelf for this test only.
    const pairless = pairlessBoard();
    MAPS[pairless.id] = pairless;
    try {
      const sizes = Object.values(pairless.groups).map((g) => g.length);
      PASS(new Set(sizes).size === sizes.length && sizes.reduce((n, x) => n + x, 0) === 22 && !boardCanShuffle(pairless.id)
        && shuffleMap(pairless, 1).shuffled === false,
      'setup: a board with no two sets of one size, which a shuffle leaves as printed', sizes.join(' '));
      const rp = mulberry32(41);
      let dealtOn = 0;
      let mixedOn = 0;
      for (let i = 0; i < 600; i++) {
        if (rollQuickSettings([pairless.id], rp).shuffleBoard) dealtOn++;
        const mixed = rollQuickSettings([pairless.id, 'classic'], rp);
        if (mixed.shuffleBoard && mixed.mapId === pairless.id) mixedOn++;
      }
      PASS(dealtOn === 0 && mixedOn === 0, 'the roll never deals "shuffled board on" onto it', `${dealtOn} + ${mixedOn} times`);

      // Nor can a host talk one onto it: the chip would promise a shuffle
      // start() cannot make.
      const q = quickTable(roll({ shuffleBoard: true }));
      PASS(q.settings.shuffleBoard === true, 'setup: a Play-now table that rolled the shuffle on Classic');
      q.updateSettings(A, { mapId: pairless.id });
      PASS(q.map.id === pairless.id && q.settings.shuffleBoard === false
        && q.serialize().quickRoll.parts.at(-1) === 'shuffled board off'
        && logText(q).at(-1) === 'Ann changed the rules: Pairless board · shuffled board off',
      'the host moves it onto that board: the switch goes off with it, and the table is told', logText(q).at(-1));
      const before = logText(q).length;
      q.updateSettings(A, { shuffleBoard: true });
      PASS(q.settings.shuffleBoard === false && logText(q).length === before,
        'switching it back on there changes nothing, so nothing is announced');
      q.settings.shuffleBoard = true; // forced past the door
      q.start(A);
      PASS(!q.map.shuffled && !shuffleLine(q), 'and forced on anyway, the deal plays the printed board and says nothing of a shuffle');
      q.clearQuickTimers();

      // A private table keeps what its host set, as it has since 1.0.6.
      const p = privateTable({ mapId: pairless.id, shuffleBoard: true });
      PASS(p.settings.shuffleBoard === true, 'a private table keeps its host\'s switch on that board, as before');
    } finally {
      delete MAPS[pairless.id];
    }
  }

  // ------------------------------------------------------------- phrases --
  section('the lobby says it in a ninth phrase, last');
  {
    const on = quickRollParts({ startingCash: 1500, bankruptProperties: 'choose', shuffleBoard: true }, 'Classic');
    const off = quickRollParts({ startingCash: 1500, bankruptProperties: 'choose', shuffleBoard: false }, 'Classic');
    PASS(on.length === 9 && off.length === 9 && on.at(-1) === 'shuffled board on' && off.at(-1) === 'shuffled board off',
      'nine phrases, the last one the shuffle', on.join(' · '));
    PASS(on.slice(0, 8).join() === off.slice(0, 8).join() && on[7] === 'bankrupt player decides',
      'the first eight are exactly what a 1.0.7 app pairs with its eight rules');
    PASS(quickRollParts({}).at(-1) === 'shuffled board off', 'an unset switch reads as off');

    const q = quickTable(roll({ shuffleBoard: true }));
    const st = q.serialize();
    PASS(st.quickRoll.parts.length === QUICK_ROLL_KEYS.length + 1 && st.quickRoll.parts.at(-1) === 'shuffled board on'
      && st.quickRoll.keys.includes('shuffleBoard'),
    'the state carries it, and names it among the rolled keys', st.quickRoll.parts.join(' · '));
    PASS(logText(q).find((t) => t.startsWith('This table rolled:'))?.endsWith(' · shuffled board on'),
      'and the log line that announces the roll ends with it');
    PASS(st.quickLobby.editable.includes('shuffleBoard') && !st.quickLobby.editable.includes('auctionOnly'),
      'quickLobby.editable offers it to the host, and still not auction-only', st.quickLobby.editable.join(', '));
    PASS(st.map.shuffled === false && st.map.uid === 'classic', 'the lobby still shows the printed board: the deal is at the start');
    q.clearQuickTimers();
  }

  // ----------------------------------------------------------------- host --
  section('the quick host switches it, and the table hears about it');
  {
    const q = quickTable(roll({ shuffleBoard: false }));
    PASS(q.hostId === A && q.settings.shuffleBoard === false, 'setup: Ann hosts a table that rolled the shuffle off');
    q.player(B).ready = true;
    q.player(C).ready = true;
    const res = q.updateSettings(A, { shuffleBoard: true });
    PASS(!res?.error && q.settings.shuffleBoard === true && q.ruleOn('shuffleBoard') === true,
      'the host turns it on', short(res));
    PASS(q.quickEdited().includes('shuffleBoard') && q.serialize().quickRoll.edited.includes('shuffleBoard'),
      'the lobby marks it changed by the host', short(q.serialize().quickRoll.edited));
    PASS(q.player(B).ready === false && q.player(C).ready === false, 'and Ben and Cat say ready again, to the new rules');
    PASS(logText(q).at(-1) === 'Ann changed the rules: shuffled board on', 'the log says who changed what', logText(q).at(-1));
    PASS(q.serialize().quickRoll.parts.at(-1) === 'shuffled board on', 'the chip reads on');

    const before = logText(q).length;
    q.updateSettings(A, { shuffleBoard: true });
    PASS(logText(q).length === before, 'tapping the value already set is not news');

    PASS(q.updateSettings(B, { shuffleBoard: false }) === undefined && q.settings.shuffleBoard === true,
      'a guest changes nothing');
    PASS(q.updateSettings(A, { shuffleBoard: false, auctionOnly: true })?.error
      === 'A Play-now table keeps its seats, privacy, house players, teams and clock' && q.settings.shuffleBoard === true,
    'a patch that also reaches for auction-only is refused whole');

    q.updateSettings(A, { shuffleBoard: false });
    PASS(!q.quickEdited().includes('shuffleBoard') && logText(q).at(-1) === 'Ann changed the rules: shuffled board off',
      'put back to the roll, it is no longer marked as changed', logText(q).at(-1));
    q.updateSettings(A, { shuffleBoard: true, auction: !q.settings.auction });
    PASS(/^Ann changed the rules: auctions o(n|ff) · shuffled board on$/.test(logText(q).at(-1)),
      'changed with another rule, it is named last, in the chips\' own order', logText(q).at(-1));
    q.clearQuickTimers();
  }

  // ---------------------------------------------------------------- deal --
  section('the deal: a shuffled board, and a line worth reading');
  {
    const q = quickTable(roll({ shuffleBoard: true }));
    seeded(7, () => q.start(A));
    const st = q.serialize();
    const line = shuffleLine(q);
    PASS(q.status === 'playing' && q.map.shuffled === true && q.shuffleSeed != null
      && st.map.shuffled === true && st.map.uid.startsWith('classic~') && st.mapId === 'classic',
    'a Play-now table that rolled it deals a shuffled board, still Classic by id', st.map.uid);
    const at = logText(q).indexOf(line);
    PASS(!!line && at === logText(q).indexOf('Game started! Good luck.') + 1,
      'the log says "The board was shuffled", right after the start', line);
    PASS(lineIsTrue(line, MAPS.classic, q.map), 'and what it says about the board is true of the board');
    PASS(!line.includes('\n') && line.length <= 90, 'one short line', `${line.length} characters`);

    // Every shape the line comes in, on every kind of board, and true each time.
    const lies = [];
    const kinds = new Set();
    for (const mapId of ['classic', 'worldwide', 'deathvalley', 'blitz', 'luckywheel', 'country-in', 'continent-europe', 'random']) {
      for (let s = 1; s <= 12; s++) {
        const t = quickTable(roll({ mapId, shuffleBoard: true }));
        seeded(s * 101, () => t.start(A));
        const l = shuffleLine(t);
        if (!t.map.shuffled || !lineIsTrue(l, t.boardBeforeShuffle, t.map)) lies.push(`${mapId}/${s}: ${l}`);
        kinds.add(l.includes('priciest') ? 'priciest' : l.includes('now sits') ? 'now' : 'still');
        t.dispose();
      }
    }
    PASS(lies.length === 0, 'ninety-six deals on eight boards: every line true of its board', lies[0] || 'all true');
    PASS(kinds.size === 3, 'and all three ways of saying it turn up', [...kinds].join(', '));

    const off = quickTable(roll({ shuffleBoard: false }));
    off.start(A);
    PASS(!off.map.shuffled && off.map === MAPS.classic && !shuffleLine(off),
      'a Play-now table that rolled it off plays the printed board, and says nothing of a shuffle');

    // The host's switch is the one the deal reads, not the roll's.
    const flipped = quickTable(roll({ shuffleBoard: false }));
    flipped.updateSettings(A, { shuffleBoard: true });
    flipped.start(A);
    PASS(flipped.map.shuffled && !!shuffleLine(flipped), 'turned on by the host, the deal is shuffled');
  }

  // ----------------------------------------------------------------- cup --
  section('a cup table never shuffles');
  {
    const cup = stubbed(new GameRoom(`qs-${++serial}`, () => {}));
    for (const id of [A, B]) cup.addPlayer({ id, name: NAMES[id] });
    cup.cupMatch = { cupId: 'test', round: 1 };
    PASS(cup.updateSettings(A, { shuffleBoard: true })?.error === 'A cup table is set by the cup'
      && cup.settings.shuffleBoard === false, 'the host cannot set it');
    cup.settings.shuffleBoard = true; // forced past the door
    PASS(cup.ruleOn('shuffleBoard') === false, 'forced into the field, the table still plays the default');
    cup.start(A);
    PASS(!cup.map.shuffled && cup.map === MAPS.classic && !shuffleLine(cup), 'and deals the printed board');
  }

  // ------------------------------------------------------------- rematch --
  section('the next game is dealt from the printed board');
  {
    // A Play-now table breaks up when it ends; the next one is a fresh table
    // with a fresh roll, and its lobby is on the printed board.
    const q = quickTable(roll({ shuffleBoard: true }));
    q.start(A);
    q.status = 'ended';
    PASS(!!q.rematch(A)?.error && q.status === 'ended', 'Play again is not a Play-now thing — the table breaks up');
    const next = quickTable(roll({ shuffleBoard: true }));
    PASS(!next.map.shuffled && next.map === MAPS.classic && next.serialize().map.uid === 'classic',
      'the next Play-now table\'s lobby is on the printed board');
    seeded(8, () => next.start(A));
    PASS(next.map.shuffled && next.map.uid !== q.map.uid, 'and it deals a shuffle of its own', `${q.map.uid} → ${next.map.uid}`);
    next.clearQuickTimers();

    // A private table's Play again goes back to the print, and deals afresh.
    const p = privateTable({ shuffleBoard: true });
    seeded(3, () => p.start(A));
    const first = p.map;
    p.status = 'ended';
    p.rematch(A);
    PASS(p.status === 'lobby' && p.map === MAPS.classic && !p.serialize().map.shuffled,
      'Play again at a private table: the lobby is back on the printed board');
    seeded(4, () => p.start(A));
    PASS(p.map.shuffled && p.map.uid !== first.uid && lineIsTrue(shuffleLine(p), MAPS.classic, p.map),
      'the next game is a new shuffle of the print, announced truly', shuffleLine(p));
  }

  // ------------------------------------------------------------ defaults --
  section('nothing else moved');
  {
    PASS(DEFAULT_SETTINGS.shuffleBoard === false, 'a new private table still starts with the shuffle off');
    const plain = privateTable();
    plain.start(A);
    PASS(!plain.map.shuffled && !shuffleLine(plain), 'and plays the printed board');
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
  const token = `qs-${name.toLowerCase()}-${hex(6)}`;
  const sock = io(srv.url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(sock);
  const chair = { sock, name, token, state: null, seq: 0, toasts: [] };
  sock.on('state', (s) => { chair.state = s; chair.seq++; });
  sock.on('toast', (t) => chair.toasts.push(t?.message));
  chair.emit = (...a) => sock.emit(...a);
  chair.quickplay = () => new Promise((r) => sock.emit('quickplay', { token }, (d) => r(d?.roomId || '')));
  chair.join = (roomId, extra = {}) => sock.emit('join', { roomId, token, name, flag: '', canReady: true, ...extra });
  chair.heard = (msg, ms = 3000) => until(() => chair.toasts.includes(msg), ms);
  chair.close = () => sock.close();
  return chair;
}

async function overTheWire() {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'wire-'));
  const S = await startServer('quick-shuffle', dir);

  section('over the wire: a Play-now lobby');
  {
    const host = seat(S, 'Hana');
    const roomId = await host.quickplay();
    host.join(roomId);
    await until(() => host.state?.quickLobby && host.state.quickRoll);
    const st = host.state;
    const was = st.settings.shuffleBoard;
    PASS(typeof was === 'boolean' && st.quickRoll.parts.length === 9
      && st.quickRoll.parts.at(-1) === `shuffled board ${was ? 'on' : 'off'}` && /^bankrupt (streets|player)/.test(st.quickRoll.parts[7]),
    'the table rolled the shuffle, and says it last, after the bankruptcy phrase', short(st.quickRoll.parts));
    PASS(st.quickLobby.editable.includes('shuffleBoard') && !st.quickLobby.editable.includes('auctionOnly'),
      'the host may change it, and still not auction-only');
    PASS(st.map.shuffled === false, 'the lobby is on the printed board');
    const seq = host.seq;
    host.emit('settings', { shuffleBoard: !was });
    await until(() => host.seq !== seq && host.state.settings.shuffleBoard === !was);
    PASS(host.state.settings.shuffleBoard === !was && host.state.quickRoll.edited.includes('shuffleBoard')
      && host.state.quickRoll.parts.at(-1) === `shuffled board ${!was ? 'on' : 'off'}`
      && host.state.log.some((l) => l.text === `Hana changed the rules: shuffled board ${!was ? 'on' : 'off'}`),
    `…and does (${!was ? 'on' : 'off'}): the chip, the mark and the log all follow`);
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
