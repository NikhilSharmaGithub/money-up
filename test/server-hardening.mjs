// The socket and process half of the same review as rules-hardening.mjs,
// driven against the real server the way the apps drive it.
//
// Each section is a defect that was reproduced against a running server, and
// each check fails on the code as it was: a host removing a live player
// mid-game, a stranger joining as a house player, one socket sitting in two
// rooms, room creation without a ceiling, a flag that freezes the iPhones at a
// table, a two-window coin farm, a deploy that walked over cup players who
// were reconnecting, a deploy losing the last writes, and a store that would
// not parse being treated as a first run.
//
//   node test/server-hardening.mjs
//
// Temporary data dirs go under os.tmpdir() and are removed afterwards; every
// process started is stopped, pass or fail.

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
let passed = 0;
const PASS = (ok, label, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail !== '' ? `  — ${detail}` : ''}`);
  return ok;
};
const section = (t) => console.log(`\n── ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000, step = 25) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(step);
  }
}
const started = Date.now();
const tok = (tag) => `hard-${tag}-${crypto.randomBytes(5).toString('hex')}`;

// ------------------------------------------------------------ the server --
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-hard-'));
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

async function startServer(dataDir, extra = {}) {
  const port = await freePort();
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(APPLE_|GOOGLE_|APNS_|STRIPE_|MM_)/.test(k)) delete env[k];
  }
  delete env.RENDER;
  delete env.NODE_ENV;
  delete env.MONEYMOVE_TEST_HOOKS;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...env, PORT: String(port), DATA_DIR: dataDir, ...extra },
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

async function stopServer(srv, signal = 'SIGTERM') {
  if (!srv?.child || srv.child.exitCode != null) return srv?.child?.exitCode;
  srv.child.kill(signal);
  const deadline = Date.now() + 5000;
  while (srv.child.exitCode == null && srv.child.signalCode == null && Date.now() < deadline) await sleep(25);
  if (srv.child.exitCode == null && srv.child.signalCode == null) srv.child.kill('SIGKILL');
  return srv.child.exitCode;
}

const getJson = async (srv, p) => (await fetch(srv.url + p)).json();
const postJson = async (srv, p, body) => (await fetch(srv.url + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).json();

/**
 * One client: a socket that keeps the last state it was sent, every toast
 * and joinFailed, and the room ids of every state that ever arrived.
 */
function client(srv, token, name = token.slice(5, 12)) {
  const s = io(srv.url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(s);
  const c = { s, token, name, state: null, rooms: [], toasts: [], failed: [] };
  s.on('state', (st) => { c.state = st; c.rooms.push(st.id); });
  s.on('toast', (t) => c.toasts.push(t.message));
  s.on('joinFailed', (d) => c.failed.push(d.message));
  c.join = (roomId, extra = {}) => s.emit('join', { roomId, token, name, ...extra });
  c.ask = (event, payload = {}) => new Promise((resolve) => s.emit(event, payload, resolve));
  c.me = () => c.state?.players.find((p) => p.id === token);
  c.seat = (who) => c.state?.players.find((p) => p.name === who.name);
  return c;
}
const connected = (c) => until(() => c.s.connected, 5000);

async function newRoom(c) {
  const res = await c.ask('createRoom');
  return res?.roomId;
}

// Play turns as whoever is on them, the simplest way through: roll, buy,
// pass at auction, end the turn. Enough to make a game a real one.
function autoPlay(...cs) {
  const acted = new Map();
  const step = (c) => {
    const st = c.state;
    if (!st || st.status !== 'playing') return;
    if (acted.get(c) === st.version) return;
    if (st.auction) {
      if (st.auction.inRace?.includes(c.token)) { acted.set(c, st.version); c.s.emit('passBid'); }
      return;
    }
    if (st.turn?.playerId !== c.token) return;
    acted.set(c, st.version);
    const t = st.turn;
    if (t.phase === 'roll') c.s.emit('roll');
    else if (t.phase === 'action' && t.pending?.type === 'buy') c.s.emit('buy');
    else if (t.phase === 'debt') c.s.emit('bankrupt');
    else c.s.emit('endTurn');
  };
  const timer = setInterval(() => cs.forEach(step), 40);
  return () => clearInterval(timer);
}

try {
  // ======================================================== one server ==
  const dir = path.join(tmpRoot, 'main');
  fs.mkdirSync(dir);
  const srv = await startServer(dir);

  section('a host cannot remove a live player mid-game');
  {
    const host = client(srv, tok('host'), 'Hosty');
    const pal = client(srv, tok('pal'), 'Pally');
    await connected(host); await connected(pal);
    const roomId = await newRoom(host);
    host.join(roomId);
    await until(() => host.state);
    pal.join(roomId);
    await until(() => host.state?.players.length === 2);
    host.s.emit('start');
    await until(() => host.state?.status === 'playing' && pal.state?.status === 'playing');
    const alias = host.seat(pal)?.id;
    PASS(!!alias && alias !== pal.token, 'setup: the host sees the other player by an alias', String(alias));
    host.s.emit('kick', alias);
    await until(() => host.toasts.length, 2000);
    await sleep(200);
    PASS(host.toasts.some((t) => /before the game starts/.test(t)), 'the kick is refused, out loud', host.toasts.join(' | '));
    const seat = host.seat(pal);
    PASS(seat?.connected === true && !seat?.bankrupt, 'and the player is still seated, still connected',
      JSON.stringify({ connected: seat?.connected, bankrupt: seat?.bankrupt }));
    PASS(!host.state.awaiting.length, 'with no "waiting for" card raised against them');

    // In the lobby it still works, as it always has.
    const lobbyId = await newRoom(host);
    const guest = client(srv, tok('guest'), 'Guesty');
    await connected(guest);
    host.join(lobbyId);
    await until(() => host.state?.id === lobbyId);
    guest.join(lobbyId);
    await until(() => host.state?.players.length === 2);
    host.s.emit('kick', host.seat(guest)?.id);
    await until(() => host.state?.players.length === 1, 2000);
    PASS(host.state?.players.length === 1, 'in the lobby the host can still remove somebody');
  }

  section('nobody can join as a house player');
  {
    const host = client(srv, tok('bothost'), 'Botter');
    await connected(host);
    const roomId = await newRoom(host);
    host.join(roomId);
    await until(() => host.state);
    host.s.emit('addBot');
    await until(() => host.state?.players.some((p) => p.isBot));
    const bot = host.state.players.find((p) => p.isBot);
    PASS(bot?.id.startsWith('bot:'), 'setup: the bot\'s id is in the state for all to read', bot?.id);
    const thief = client(srv, bot.id, 'Thief');
    await connected(thief);
    thief.join(roomId);
    await until(() => thief.failed.length, 2000);
    PASS(thief.failed.some((m) => /taken/.test(m)), 'joining under the bot\'s id is refused', thief.failed.join(' | '));
    thief.s.emit('roll');
    await sleep(200);
    const still = host.state.players.find((p) => p.id === bot.id);
    PASS(still?.isBot === true && still?.name === bot.name, 'the seat is still the house\'s');
    PASS(host.state.players.length === 2, 'and nobody new sat down', String(host.state.players.length));
  }

  section('one socket, one room');
  {
    const host = client(srv, tok('h1'), 'Holly');
    const roamer = client(srv, tok('roam'), 'Roamy');
    await connected(host); await connected(roamer);
    const first = await newRoom(host);
    host.join(first);
    await until(() => host.state);
    roamer.join(first);
    await until(() => host.state?.players.length === 2);
    host.s.emit('start');
    await until(() => roamer.state?.status === 'playing');
    // The invite banner: the same socket, a join to somewhere else.
    const other = client(srv, tok('h2'), 'Otto');
    await connected(other);
    const second = await newRoom(other);
    other.join(second);
    await until(() => other.state);
    roamer.join(second);
    await until(() => other.state?.players.length === 2);
    await until(() => host.seat(roamer)?.connected === false, 2000);
    const left = host.seat(roamer);
    PASS(left?.connected === false, 'the old table sees the player gone, so their seat is held and covered',
      JSON.stringify({ connected: left?.connected }));
    PASS(host.state.awaiting.some((a) => a.id === left?.id), 'with the usual "waiting for" card');
    roamer.rooms.length = 0;
    host.s.emit('chat', 'anyone there?');
    other.s.emit('chat', 'hello');
    await sleep(400);
    PASS(roamer.rooms.length > 0 && roamer.rooms.every((r) => r === second), 'and the socket only hears the table it is at now',
      [...new Set(roamer.rooms)].join(', '));
  }

  section('what a flag can be');
  {
    const a = client(srv, tok('flag'), 'Flaggy');
    await connected(a);
    const roomId = await newRoom(a);
    a.s.emit('join', { roomId, token: a.token, name: 12345, flag: 12345 });
    await until(() => a.state);
    PASS(a.me()?.flag === '', 'a number for a flag reaches nobody', JSON.stringify(a.me()?.flag));
    PASS(a.me()?.name === '12345', 'and a number for a name is seated as text', JSON.stringify(a.me()?.name));
    const b = client(srv, tok('flag2'), 'Objy');
    await connected(b);
    b.join(roomId, { flag: { x: 1 } });
    await until(() => a.state?.players.length === 2);
    PASS(a.state.players.every((p) => typeof p.flag === 'string'), 'every flag in the state is a string');
  }

  section('a new room costs something');
  {
    const c = client(srv, tok('maker'), 'Maker');
    await connected(c);
    const made = [];
    for (let i = 0; i < 12; i++) made.push(await c.ask('createRoom'));
    const ok = made.filter((r) => r?.roomId).length;
    PASS(ok === 10, 'ten new rooms a minute from one connection', `${ok} made`);
    PASS(!!made[11]?.error && !made[11]?.roomId, 'then a refusal the client can read', JSON.stringify(made[11]));
    // A code nobody holds opens a room too, so it counts the same.
    c.join('zzzz9');
    await until(() => c.failed.length, 2000);
    PASS(c.failed.some((m) => /Too many new tables/.test(m)), 'joining a made-up code is refused as well', c.failed.join(' | '));
  }

  section('a table that was never played pays nothing');
  {
    const farmer = client(srv, tok('farm'), 'Farmer');
    const mule = client(srv, tok('mule'), 'Mule');
    await connected(farmer); await connected(mule);
    const roomId = await newRoom(farmer);
    farmer.join(roomId);
    await until(() => farmer.state);
    mule.join(roomId);
    await until(() => farmer.state?.players.length === 2);
    farmer.s.emit('start');
    await until(() => mule.state?.status === 'playing');
    mule.s.emit('bankrupt');
    await until(() => farmer.state?.status === 'ended');
    await sleep(150);
    const w = await getJson(srv, `/api/wallet?token=${farmer.token}`);
    const m = await getJson(srv, `/api/wallet?token=${mule.token}`);
    PASS(farmer.state?.status === 'ended', 'setup: the mule concedes before a single roll');
    PASS(w.coins === 0 && m.coins === 0, 'neither side is paid for it', `${w.coins} / ${m.coins}`);

    // A game that is played, then conceded, still pays as it always did.
    farmer.s.emit('rematch');
    await until(() => farmer.state?.status === 'lobby');
    farmer.s.emit('start');
    await until(() => mule.state?.status === 'playing');
    const stop = autoPlay(farmer, mule);
    let turns = 0;
    let last = null;
    await until(() => {
      const who = farmer.state?.turn?.playerId;
      if (who && who !== last) { turns++; last = who; }
      return turns >= 6;
    }, 15000, 20);
    stop();
    PASS(turns >= 6, 'setup: six turns are played', String(turns));
    mule.s.emit('bankrupt');
    await until(() => farmer.state?.status === 'ended', 4000);
    await sleep(150);
    const w2 = await getJson(srv, `/api/wallet?token=${farmer.token}`);
    const m2 = await getJson(srv, `/api/wallet?token=${mule.token}`);
    PASS(w2.coins === 2 && m2.coins === 1, 'the winner and the runner-up are paid', `${w2.coins} / ${m2.coins}`);
  }

  await stopServer(srv);

  // ===================================== a box that is full, then stops ==
  section('a ceiling on rooms, and a store found broken at boot');
  {
    const dir2 = path.join(tmpRoot, 'full');
    const day = new Date();
    const stamp = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    fs.mkdirSync(path.join(dir2, 'backup', stamp), { recursive: true });
    const saved = { token: tok('saved'), code: 'SAVED2', name: 'Saved', flag: '', friends: [], coins: 77, econ: 2, seen: Date.now(), created: Date.now() };
    fs.writeFileSync(path.join(dir2, 'backup', stamp, 'social.json'), JSON.stringify({ profiles: [saved] }));
    fs.writeFileSync(path.join(dir2, 'social.json'), '{"profiles":[{"token":"half-writ');
    const full = await startServer(dir2, { MM_MAX_ROOMS: '3' });

    const w = await getJson(full, `/api/wallet?token=${saved.token}`);
    PASS(w.coins === 77, 'a social.json that will not parse is restored from the backup', `${w.coins} coins`);
    PASS(fs.readdirSync(dir2).some((f) => f.startsWith('social.json.corrupt-')), 'and the broken file is set aside, not overwritten');
    // Before anyone has saved anything: a restart now must not find no file.
    const restored = JSON.parse(fs.readFileSync(path.join(dir2, 'social.json'), 'utf8'));
    PASS(restored.profiles?.some((p) => p.token === saved.token && p.coins === 77),
      'the restore is on disk at once, before the first save');

    const c = client(full, tok('filler'), 'Filler');
    await connected(c);
    const made = [];
    for (let i = 0; i < 4; i++) made.push(await c.ask('createRoom'));
    PASS(made.filter((r) => r?.roomId).length === 3 && !!made[3]?.error, 'a server holding its ceiling makes no more rooms',
      made.map((r) => r?.roomId || 'refused').join(', '));
    c.join(made[0].roomId);
    await until(() => c.state, 2000);
    PASS(c.state?.id === made[0].roomId, 'but the rooms it has still open');

    // A deploy: a change, then SIGTERM before the debounce is out.
    const late = tok('late');
    await postJson(full, '/api/profile', { token: late, name: 'Late' });
    const code = await stopServer(full, 'SIGTERM');
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir2, 'social.json'), 'utf8'));
    PASS(code === 0, 'SIGTERM ends the process cleanly', String(code));
    PASS(onDisk.profiles.some((p) => p.token === late), 'with the change made a moment before on disk');
    PASS(onDisk.profiles.some((p) => p.token === saved.token && p.coins === 77), 'and the restored wallets with it');
  }

  // ================================= a cup the deploy interrupted ==
  section('a deploy in the middle of a cup');
  {
    const dir3 = path.join(tmpRoot, 'cup');
    fs.mkdirSync(dir3);
    const now = Date.now();
    const people = ['Asha', 'Bilal', 'Chen', 'Dara'].map((name, i) => ({ name, token: tok(name.toLowerCase()), code: `RSCUP${i}` }));
    const [A, B, C, D] = people;
    fs.writeFileSync(path.join(dir3, 'tournaments.json'), JSON.stringify({
      enabled: true,
      cups: [{
        id: 'rscup1',
        name: 'Restart Cup',
        state: 'running',
        prize: { currency: 'USD', first: 0, second: 0, third: 0 },
        maxPlayers: 0,
        joinCode: '',
        // Ten-minute games, both started twenty minutes ago: every clock the
        // match had — its eight-minute wait and its whistle — ran out while
        // the process was down.
        schedule: { times: [20 * 60, 22 * 60], windowMinutes: 10, matchMinutes: 10, offsetMinutes: 0 },
        announcedAt: now - 3600000,
        openedAt: now - 3600000,
        closesAt: now - 1800000,
        entrants: people.map((p) => ({ token: p.token, name: p.name, code: p.code })),
        rounds: [{
          kind: 'round', bye: null, at: now - 1500000, opensAt: null, closesAt: null,
          matches: [
            { id: 'mAB', a: A.token, b: B.token, roomId: 'cupaa1', state: 'playing', startedAt: now - 20 * 60000, winner: null },
            { id: 'mCD', a: C.token, b: D.token, roomId: 'cupbb2', state: 'playing', startedAt: now - 20 * 60000, winner: null },
          ],
        }],
        standings: null,
        paid: {},
      }],
      history: [],
    }));
    const cupSrv = await startServer(dir3);
    const a = client(cupSrv, A.token, A.name);
    await connected(a);
    a.join('cupaa1');
    await until(() => a.state);
    // The other table: both players are back at once, so their game restarts
    // before the first sweep — under a whistle that went while it was down.
    const c = client(cupSrv, C.token, C.name);
    const d = client(cupSrv, D.token, D.name);
    await connected(c); await connected(d);
    c.join('cupbb2');
    d.join('cupbb2');
    await until(() => c.state?.status === 'playing', 3000);
    PASS(c.state?.status === 'playing', 'setup: a table whose two players came straight back restarts', c.state?.status);
    // Two sweeps go by: the one that rebuilds the tables and the one that
    // used to judge them.
    await sleep(11000);
    PASS(c.state?.status === 'playing', 'its replay is not decided by the whistle that went while the server was down',
      c.state?.status);
    const b = client(cupSrv, B.token, B.name);
    await connected(b);
    b.join('cupaa1');
    await until(() => a.state?.status === 'playing', 3000);
    PASS(!/walkover|voided/.test(cupSrv.log), 'nobody is walked over or voided seconds after boot',
      (cupSrv.log.match(/cup: .*(walkover|voided).*/) || [''])[0]);
    PASS(!b.failed.length && a.state?.status === 'playing', 'the second player is let back in and the game restarts',
      b.failed.join(' | ') || a.state?.status);
    // And the replay is not decided on the next sweep by a whistle that went
    // while the server was down.
    await sleep(6000);
    PASS(a.state?.status === 'playing', 'a whistle that already went does not decide the replay on the spot', a.state?.status);
    PASS(!/decided on net worth/.test(cupSrv.log), 'nothing is decided on net worth yet');
    await stopServer(cupSrv);
  }
} catch (err) {
  failed++;
  console.error('  FAIL  the run itself threw:', err);
} finally {
  for (const s of sockets) s.close();
  for (const c of children) if (c.exitCode == null && c.signalCode == null) c.kill('SIGKILL');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`\n${failed ? 'FAILED' : 'OK'} — ${passed} passed, ${failed} failed (${((Date.now() - started) / 1000).toFixed(1)}s)`);
process.exit(failed ? 1 : 0);
