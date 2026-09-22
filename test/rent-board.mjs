// One coin, one game, on a board nobody at the table owns.
//
// The shelf sells a board for good and gives two away a day. This is the third
// door: a coin buys one game on a locked board, at one table, for the person
// who paid. Everything that matters about it is a thing a player could try to
// cheat, so it is tested against the real server — a process, over HTTP and a
// socket — rather than against the model in isolation:
//
//   · a locked board is refused before the coin, and allowed after it
//   · the coin leaves the wallet exactly once, however many times it is tapped
//   · the pass is good at THAT table and nowhere else — ten lobbies, ten coins
//   · dealing the cards spends it, and the same table gets no second free game
//   · only the host can rent, because only the host's wallet is ever read
//   · a pass that was never played survives a restart, and moves rather than
//     being quietly eaten
//
//   node test/rent-board.mjs
//
// Temporary data dirs go under os.tmpdir() (set TMPDIR to move them) and are
// removed afterwards; every process started is stopped, pass or fail.

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = 'moneymove-admin';

let failed = 0;
let passed = 0;
const PASS = (ok, label, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  return ok;
};
const section = (t) => console.log(`\n── ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ the server --
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-rent-'));
const children = [];
const sockets = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startServer(dataDir) {
  const port = await freePort();
  const env = { ...process.env };
  // Nothing here wants the owner's real Apple, Google or Stripe wiring.
  for (const k of Object.keys(env)) {
    if (/^(APPLE_|GOOGLE_|APNS_|STRIPE_)/.test(k)) delete env[k];
  }
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...env, PORT: String(port), DATA_DIR: dataDir, ADMIN_KEY: ADMIN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const srv = { url: `http://127.0.0.1:${port}`, dir: dataDir, child, log: '' };
  child.stdout.on('data', (d) => { srv.log += d; });
  child.stderr.on('data', (d) => { srv.log += d; });
  children.push(child);
  const deadline = Date.now() + 20000;
  for (;;) {
    if (child.exitCode != null) throw new Error(`server exited:\n${srv.log}`);
    try {
      if ((await fetch(`${srv.url}/healthz`)).ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`server did not start:\n${srv.log}`);
    await sleep(100);
  }
  return srv;
}

async function stopServer(srv) {
  if (!srv?.child || srv.child.exitCode != null) return;
  srv.child.kill('SIGTERM');
  const deadline = Date.now() + 5000;
  while (srv.child.exitCode == null && Date.now() < deadline) await sleep(50);
  if (srv.child.exitCode == null) srv.child.kill('SIGKILL');
}

async function call(srv, method, p, body) {
  const res = await fetch(srv.url + p, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = JSON.parse(await res.text()); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const get = (srv, p) => call(srv, 'GET', p);
const post = (srv, p, body) => call(srv, 'POST', p, body);

// -------------------------------------------------------------- a player --
const device = (tag) => `dev-${tag}-${crypto.randomBytes(6).toString('hex')}`;

async function newPlayer(srv, tag, coins) {
  const token = device(tag);
  const { json } = await post(srv, '/api/profile', { token, name: tag });
  if (coins > 0) await post(srv, '/api/admin/credit', { key: ADMIN, code: json.code, coins });
  return { token, code: json.code, name: tag };
}

const coinsOf = async (srv, who) =>
  (await get(srv, `/api/wallet?token=${encodeURIComponent(who.token)}`)).json?.coins ?? -1;

const shelfFor = async (srv, who, roomId) =>
  (await get(srv, `/api/boards?token=${encodeURIComponent(who.token)}`
    + (roomId ? `&room=${encodeURIComponent(roomId)}` : ''))).json;

const howIs = (shelf, mapId) => shelf.boards.find((b) => b.id === mapId)?.how;

/**
 * A seat at a table, on its own socket. Full states only (no `proto`), so
 * every push arrives whole and the last one is always the truth.
 */
function seat(srv, who, roomId) {
  const sock = io(srv.url, { transports: ['websocket'], forceNew: true });
  sockets.push(sock);
  const chair = { sock, state: null, toasts: [] };
  sock.on('state', (s) => { chair.state = s; });
  sock.on('toast', (t) => chair.toasts.push(t?.message || ''));
  sock.on('joinFailed', (d) => chair.toasts.push(d?.message || 'join failed'));
  chair.emit = (...args) => sock.emit(...args);
  chair.settle = async (ms = 400) => { await sleep(ms); return chair.state; };
  chair.join = async () => {
    sock.emit('join', { roomId, token: who.token, name: who.name });
    const deadline = Date.now() + 5000;
    while (!chair.state && Date.now() < deadline) await sleep(25);
    return chair.state;
  };
  return chair;
}

/** A fresh table id, and never the same one twice in one run. */
let roomCount = 0;
const roomName = () => `t${(++roomCount).toString(36)}`
  + Array.from(crypto.randomBytes(4), (b) => 'abcdefghijkmnopqrstuvwxyz'[b % 25]).join('');

// ═══════════════════════════════════════════════════════════════════════════
let srv = null;
const dataDir = fs.mkdtempSync(path.join(tmpRoot, 'data-'));

try {
  srv = await startServer(dataDir);

  const host = await newPlayer(srv, 'host', 3);
  const other = await newPlayer(srv, 'other', 3);
  const broke = await newPlayer(srv, 'broke', 0);

  const shelf0 = await shelfFor(srv, host);
  const locked = shelf0.boards.find((b) => b.how === 'locked' && b.rentable);
  const freeToday = shelf0.boards.find((b) => b.how === 'today');
  if (!locked) throw new Error('no locked board on the shelf — nothing to rent');

  section('the price is the server\'s to name');
  PASS(shelf0.rent?.price === 1, 'one game costs one coin', `price ${shelf0.rent?.price}`);
  PASS(shelf0.rent?.holding === null, 'a new wallet holds no pass');
  PASS(await coinsOf(srv, host) === 3, 'the host starts with three coins');

  // ───────────────────────────────────────────────────────────────────────
  section(`a locked board is refused before the coin (${locked.name})`);
  const r1 = roomName();
  const t1 = seat(srv, host, r1);
  await t1.join();
  PASS(t1.state?.hostId === host.token, 'the first to sit down is the host');
  t1.emit('settings', { mapId: locked.id });
  await t1.settle();
  PASS(t1.state?.settings?.mapId !== locked.id, 'the board did not change', `on ${t1.state?.settings?.mapId}`);
  PASS(t1.toasts.some((m) => /locked/i.test(m)), 'and it said why', t1.toasts.join(' | '));

  // ───────────────────────────────────────────────────────────────────────
  section('paying for one game');
  const paid = await post(srv, '/api/boards/rent',
    { token: host.token, mapId: locked.id, roomId: r1, expect: 1 });
  PASS(paid.status === 200 && paid.json?.ok === true, 'the rent goes through', String(paid.status));
  PASS(paid.json?.charged === 1, 'one coin, charged once');
  PASS(await coinsOf(srv, host) === 2, 'and the wallet says so', `${await coinsOf(srv, host)} left`);

  const again = await post(srv, '/api/boards/rent',
    { token: host.token, mapId: locked.id, roomId: r1, expect: 1 });
  PASS(again.json?.charged === 0, 'a second tap on the same table charges nothing');
  PASS(await coinsOf(srv, host) === 2, 'the wallet is untouched by it');

  PASS(howIs(await shelfFor(srv, host, r1), locked.id) === 'rented',
    'the shelf calls it rented at this table');
  PASS(howIs(await shelfFor(srv, host, roomName()), locked.id) === 'locked',
    'and locked at any other');
  PASS(howIs(await shelfFor(srv, other, r1), locked.id) === 'locked',
    'and locked for anybody else at the same table');

  // ───────────────────────────────────────────────────────────────────────
  section('playing it');
  t1.emit('settings', { mapId: locked.id });
  await t1.settle();
  PASS(t1.state?.settings?.mapId === locked.id, 'the board is the one that was paid for',
    String(t1.state?.settings?.mapId));
  t1.emit('addBot');
  await t1.settle(250);
  t1.emit('start');
  await t1.settle(600);
  PASS(t1.state?.status === 'playing', 'the table deals', String(t1.state?.status));
  PASS(t1.state?.mapId === locked.id, 'on the rented board', String(t1.state?.mapId));
  PASS(await coinsOf(srv, host) === 2, 'dealing costs nothing more');

  PASS(howIs(await shelfFor(srv, host, r1), locked.id) === 'locked',
    'and the pass is spent — this table gets no second game either');
  PASS((await shelfFor(srv, host)).rent?.holding === null, 'nothing is being held any more');

  // ───────────────────────────────────────────────────────────────────────
  section('a second table is a second coin');
  const r2 = roomName();
  const t2 = seat(srv, host, r2);
  await t2.join();
  t2.emit('settings', { mapId: locked.id });
  await t2.settle();
  PASS(t2.state?.settings?.mapId !== locked.id, 'the spent pass opens nothing here',
    `on ${t2.state?.settings?.mapId}`);

  const paid2 = await post(srv, '/api/boards/rent',
    { token: host.token, mapId: locked.id, roomId: r2, expect: 1 });
  PASS(paid2.json?.charged === 1, 'the second game is charged for');
  PASS(await coinsOf(srv, host) === 1, 'two games, two coins', `${await coinsOf(srv, host)} left`);
  t2.emit('settings', { mapId: locked.id });
  await t2.settle();
  PASS(t2.state?.settings?.mapId === locked.id, 'and now it plays');

  // ───────────────────────────────────────────────────────────────────────
  section('what is refused');
  const guest = seat(srv, other, r2);
  await guest.join();
  const byGuest = await post(srv, '/api/boards/rent',
    { token: other.token, mapId: locked.id, roomId: r2, expect: 1 });
  PASS(byGuest.status === 403, 'a guest cannot rent the host\'s table', String(byGuest.status));
  PASS(await coinsOf(srv, other) === 3, 'and is not charged for trying');

  const nowhere = await post(srv, '/api/boards/rent',
    { token: other.token, mapId: locked.id, roomId: 'zzzzz', expect: 1 });
  PASS(nowhere.status === 404, 'a table that does not exist cannot be rented for',
    String(nowhere.status));

  const houseBoard = await post(srv, '/api/boards/rent',
    { token: other.token, mapId: 'classic', roomId: r2, expect: 1 });
  PASS(houseBoard.status === 400, 'the house board is not for rent', String(houseBoard.status));

  // A matchmade table deals its own board and then refuses every change to it,
  // so a pass bought at one could never be spent there. The coin must not
  // leave the wallet for a table that cannot honour it — the same reason a cup
  // table, which is set by the cup, is refused one line above it in the server.
  const quickId = await new Promise((resolve) => {
    const sock = io(srv.url, { transports: ['websocket'], forceNew: true });
    sockets.push(sock);
    const done = setTimeout(() => resolve(''), 4000);
    sock.emit('quickplay', { token: other.token }, (d) => { clearTimeout(done); resolve(d?.roomId || ''); });
  });
  if (!quickId) {
    PASS(false, 'a matchmade table could be opened to try it against');
  } else {
    const tq = seat(srv, other, quickId);
    await tq.join();
    PASS(tq.state?.quick === true, 'the matchmade table is a matchmade table', String(tq.state?.quick));
    const atQuick = await post(srv, '/api/boards/rent',
      { token: other.token, mapId: locked.id, roomId: quickId, expect: 1 });
    PASS(atQuick.status === 409, 'a matchmade table does not sell a board it will not play',
      `${atQuick.status} ${atQuick.json?.error || ''}`);
    PASS(await coinsOf(srv, other) === 3, 'and the coin stays in the wallet');
    tq.sock.disconnect();
  }

  if (freeToday) {
    const r3 = roomName();
    const t3 = seat(srv, other, r3);
    await t3.join();
    const already = await post(srv, '/api/boards/rent',
      { token: other.token, mapId: freeToday.id, roomId: r3, expect: 1 });
    PASS(already.status === 400 && /already/i.test(already.json?.error || ''),
      'a board that is free today is not sold by the evening', already.json?.error || '');
    PASS(await coinsOf(srv, other) === 3, 'still not charged');
    t3.sock.disconnect();
  }

  const wrongPrice = await post(srv, '/api/boards/rent',
    { token: other.token, mapId: locked.id, roomId: r2, expect: 7 });
  PASS(wrongPrice.status === 409, 'a client showing the wrong price is refused, not charged',
    String(wrongPrice.status));

  const r4 = roomName();
  const t4 = seat(srv, broke, r4);
  await t4.join();
  const skint = await post(srv, '/api/boards/rent',
    { token: broke.token, mapId: locked.id, roomId: r4, expect: 1 });
  PASS(skint.status === 400 && /enough coins/i.test(skint.json?.error || ''),
    'an empty wallet is told plainly', skint.json?.error || '');
  PASS(await coinsOf(srv, broke) === 0, 'and stays empty');
  t4.sock.disconnect();

  // ───────────────────────────────────────────────────────────────────────
  section('a game paid for and never played survives the lights going out');
  // r2's pass is still unspent — the table never dealt. Let the debounced
  // write land, then take the whole process away.
  const coinsBefore = await coinsOf(srv, host);
  await sleep(1800);
  for (const s of sockets) s.disconnect();
  sockets.length = 0;
  await stopServer(srv);

  srv = await startServer(dataDir);
  const afterBoot = await shelfFor(srv, host);
  PASS(await coinsOf(srv, host) === coinsBefore, 'the wallet came back', `${coinsBefore} coins`);
  PASS(afterBoot.rent?.holding?.mapId === locked.id && afterBoot.rent?.holding?.roomId === r2,
    'and so did the unplayed game', JSON.stringify(afterBoot.rent?.holding));

  // The rooms did not: they live in memory and every deploy takes them with
  // it. So the pass is stranded — and this is the part that has to be fair.
  const r5 = roomName();
  const t5 = seat(srv, host, r5);
  await t5.join();
  const moved = await post(srv, '/api/boards/rent',
    { token: host.token, mapId: locked.id, roomId: r5, expect: 1 });
  PASS(moved.json?.charged === 0, 'it moves to the new table rather than being sold again');
  PASS(moved.json?.movedFrom?.roomId === r2, 'and says where it came from',
    JSON.stringify(moved.json?.movedFrom));
  PASS(await coinsOf(srv, host) === coinsBefore, 'nothing left the wallet for it');

  t5.emit('settings', { mapId: locked.id });
  await t5.settle();
  PASS(t5.state?.settings?.mapId === locked.id, 'and the game that was paid for is played');
  t5.emit('addBot');
  await t5.settle(250);
  t5.emit('start');
  await t5.settle(600);
  PASS(t5.state?.status === 'playing' && t5.state?.mapId === locked.id,
    'on the board it was bought for', `${t5.state?.status} on ${t5.state?.mapId}`);
  PASS((await shelfFor(srv, host)).rent?.holding === null, 'and now it is spent');
  PASS(await coinsOf(srv, host) === coinsBefore, 'one coin, one game — never two');
} catch (err) {
  failed++;
  console.error('\n  FAIL  the run itself —', err?.stack || err);
} finally {
  for (const s of sockets) { try { s.disconnect(); } catch { /* gone */ } }
  await stopServer(srv);
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* leave it */ }
}

console.log(`\n${failed ? 'FAIL' : 'PASS'}  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
