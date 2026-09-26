// A whole cup, from the join window to the podium, against the real server.
//
// Seven players is an odd field, so the first round has a bye — and seven is
// the smallest odd field whose semi-finals are two real tables, which is what
// it takes for the last evening to hold both a final and a play-off for third.
// Everything is driven the way the apps drive it: accounts signed in on three
// kinds of device, joins over HTTP, the doors shutting on their own clock, the
// draw, tables the server builds, players sitting down on sockets, a no-show
// walked over when the door shuts, games decided at the whistle on net worth,
// the next round drawn from the winners, the final and the third-place table
// played side by side, and the podium.
//
// At every step it reads GET /api/cup as each of the seven, and checks what
// that player is told: joined, out, the next match, round X of Y, their run a
// rung per round, their placing. It also works out, from the same payload,
// what the apps ALREADY on phones print — iOS 1.0.2 cannot be updated from
// here — and checks that those numbers are right too: never "Round 0 of 3",
// never "Round 4 of 3", a finalist's room showing the final.
//
// A cup lives in hours, so the server is started with MONEYMOVE_TEST_HOOKS=1,
// which lets the owner's desk wind the cup clock forward (and is refused on
// any server that is on Render or in production — checked here too). Who wins
// each table is not left to the dice: before the whistle the player named
// first alphabetically is handed a 400 lead by a cash trade the other side
// accepts, so the richer player going through is the same player every run.
// The draw itself is random and is read back, not assumed.
//
//   node test/cup-flow.mjs
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
const CUP = 'Flow Cup';
const WINDOW = 10;                                        // minutes a door is open
const MATCH = 30;                                         // minutes a cup game may run
const SLOTS = Array.from({ length: 12 }, (_, i) => i * 120);   // every even hour, UTC
const HOUR = 3600000;

let failed = 0;
let passed = 0;
const PASS = (ok, label, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  return ok;
};
const section = (t) => console.log(`\n── ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000, step = 30) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(step);
  }
}
const started = Date.now();

// ------------------------------------------------------------ the server --
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-cup-'));
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
  // Nothing here wants the owner's real Apple, Google or Stripe wiring, and
  // nothing inherited may decide whether the test hooks are on.
  for (const k of Object.keys(env)) {
    if (/^(APPLE_|GOOGLE_|APNS_|STRIPE_)/.test(k)) delete env[k];
  }
  delete env.RENDER;
  delete env.NODE_ENV;
  delete env.MONEYMOVE_TEST_HOOKS;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...env, PORT: String(port), DATA_DIR: dataDir, ADMIN_KEY: ADMIN, ...extra },
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
const enc = encodeURIComponent;

// ------------------------------------------------------------ the people --
// Signed in the way each device signs in: Sign in with Apple on an iPhone,
// Google on Android and the web. Neither provider can be reached from a test,
// so the accounts are written into the store the server boots from — the
// same shape a real sign-in leaves behind. Everything after that is HTTP.
const device = (tag) => `dev-${tag}-${crypto.randomBytes(6).toString('hex')}`;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codeFor = (i) => `CF${[...crypto.randomBytes(3)].map((b) => CODE_ALPHABET[b % 32]).join('')}${CODE_ALPHABET[i]}`;

const ENTRANTS = [
  ['Asha', 'ios'], ['Bilal', 'android'], ['Chen', 'web'], ['Dara', 'ios'],
  ['Emeka', 'android'], ['Farah', 'web'], ['Goran', 'ios'],
].map(([name, from], i) => ({ name, from, token: device(name.toLowerCase()), code: codeFor(i) }));
const SPECTATOR = { name: 'Hana', from: 'web', token: device('hana'), code: codeFor(8) };
const GUEST = { name: 'Ivo', from: 'web', token: device('ivo') };      // never signs in
const byName = new Map(ENTRANTS.map((p) => [p.name, p]));
const iosNames = new Set(ENTRANTS.filter((p) => p.from === 'ios').map((p) => p.name));

function seedAccounts(dataDir) {
  const at = Date.now();
  const profiles = [...ENTRANTS, SPECTATOR].map((p) => ({
    token: p.token, code: p.code, name: p.name, flag: '', friends: [], seen: at, created: at,
    login: p.from === 'ios'
      ? { provider: 'apple', subject: `apple-${p.name}`, at, verified: true }
      : { provider: 'google', subject: `google-${p.name}`, at },
  }));
  fs.writeFileSync(path.join(dataDir, 'social.json'), JSON.stringify({ profiles }));
}

// ------------------------------------------------ what the apps are told --
const view = async (srv, who, show = '') =>
  (await get(srv, `/api/cup?token=${enc(who.token)}&show=${enc(show)}`)).json;

// What the apps already on phones print from this payload — iOS 1.0.2's
// CupDetailSheet and CupCard, which Android and the web copy line for line —
// written out the way they compute it, so the test can hold the live apps to
// the same numbers as the new ones.
const liveDepth = (entrants) => {
  let n = Math.max(2, entrants), d = 0;
  while (n > 1) { n = Math.ceil(n / 2); d++; }
  return d;
};
const liveTile = (cup) => `${cup.you.round ?? cup.rounds} of ${liveDepth(cup.entrants)}`;
const liveCardLine = (cup) => {
  if (cup.you.joined !== true) return 'Running now — the doors are shut.';
  if (cup.you.out === true) return 'You are out of this one.';
  if (cup.you.roomId) return 'Your table is open';
  return 'Waiting for your next table.';
};
const liveRoomRun = (cup) => {
  const me = cup.you.name;
  const r = cup.round;
  if (!me || !r?.matches) return [];
  return r.matches.filter((m) => m.a === me || m.b === me)
    .map(() => (r.kind === 'final' ? 'The final' : `Round ${r.n ?? 1}`));
};

/**
 * One line per player per step: everything that player is told, against
 * what they should be told. `want` holds only the fields this step is about.
 */
function tell(when, who, v, want) {
  const cup = v?.cup;
  const you = cup?.you || {};
  const got = {
    cup: cup?.name,
    state: cup?.state,
    joined: you.joined === true,
    out: you.out === true,
    progress: cup?.progress ? `${cup.progress.round} of ${cup.progress.of}` : null,
    next: you.next ? `${you.next.label} v ${you.next.opponent ?? 'a bye'}${you.next.open ? ' (open)' : ''}` : null,
    nextRound: you.next?.round ?? null,
    run: (you.run || []).map((r) => `${r.label}:${r.result}${r.walkover ? '/walkover' : ''}`).join(' > '),
    placed: you.placed || null,
    settled: you.settled || null,
    table: v?.table ? `${v.table.label} v ${v.table.opponent}` : null,
    liveTile: cup ? liveTile(cup) : null,
    liveCard: cup ? liveCardLine(cup) : null,
  };
  const wrong = Object.entries(want)
    .filter(([k, w]) => JSON.stringify(got[k]) !== JSON.stringify(w))
    .map(([k, w]) => `${k}: got ${JSON.stringify(got[k])}, want ${JSON.stringify(w)}`);
  const shown = [
    got.joined ? 'joined' : 'not joined',
    got.out ? 'OUT' : 'in',
    got.progress && `round ${got.progress}`,
    got.next && `next ${got.next}`,
    got.run && `run [${got.run}]`,
    got.placed && `placed ${got.placed}`,
    got.settled && `settled ${got.settled}`,
  ].filter(Boolean).join(', ');
  return PASS(!wrong.length, `${when}: ${who.name} — ${shown}`, wrong.join('; '));
}

/** The pushes the server would have sent an iPhone, read off its log. */
const pushed = (srv, text) => srv.log.split('\n')
  .filter((l) => l.includes('push (dark): would send "') && l.includes(text)).length;

// ------------------------------------------------------------ the tables --
/**
 * A seat at a cup table, on its own socket, the way every app sits down.
 * Full states only (no `proto`), so the last push is always the truth.
 */
function seat(srv, who, roomId) {
  const sock = io(srv.url, { transports: ['websocket'], forceNew: true });
  sockets.push(sock);
  const chair = { sock, who, state: null, fails: [] };
  sock.on('state', (s) => { chair.state = s; });
  sock.on('joinFailed', (d) => chair.fails.push(d?.message || 'join failed'));
  chair.emit = (...args) => sock.emit(...args);
  chair.me = () => chair.state?.players?.find((p) => p.id === who.token);
  chair.them = () => chair.state?.players?.find((p) => p.id !== who.token);
  chair.join = async () => {
    sock.emit('join', { roomId, token: who.token, name: who.name });
    await until(() => chair.state);
    return chair.state;
  };
  chair.leave = () => { try { sock.disconnect(); } catch { /* gone */ } };
  return chair;
}

/**
 * Hand `ahead` a lead nobody can roll away before the whistle: a cash trade,
 * proposed by one side and accepted by the other, like any trade at a table.
 */
async function lead(ahead, behind) {
  await until(() => ahead.state?.status === 'playing' && behind.state?.status === 'playing');
  const gap0 = (ahead.me()?.money ?? 0) - (behind.me()?.money ?? 0);
  ahead.emit('trade:propose', { to: ahead.them()?.id, give: { money: 0 }, get: { money: 400 } });
  const offer = await until(() => behind.state?.trades?.find((t) => t.get?.money === 400));
  if (offer) behind.emit('trade:respond', { id: offer.id, accept: true });
  return until(() => (ahead.me()?.money ?? 0) - (behind.me()?.money ?? 0) >= gap0 + 800);
}

/** Alphabetical order decides who is handed the lead — the same every run. */
const inOrder = (a, b) => (a.name < b.name ? [a, b] : [b, a]);

// ═══════════════════════════════════════════════════════════════════════════
let srv = null;
const dataDir = fs.mkdtempSync(path.join(tmpRoot, 'data-'));
seedAccounts(dataDir);

try {
  srv = await startServer(dataDir, { MONEYMOVE_TEST_HOOKS: '1' });
  const desk = (body) => post(srv, '/api/admin/cup', { key: ADMIN, ...body });
  // Wind the cup clock and run the five-second housekeeping at once.
  const wind = async (minutes) => {
    const r = await desk({ action: 'wind', minutes });
    if (!r.json?.ok) throw new Error(`the clock would not wind: ${r.status} ${r.json?.error}`);
    return r.json.now;
  };
  /** On to `at` on the cup's clock (the first minute that reaches it), plus `extra`. */
  const windTo = async (at, extra = 0) => {
    const nowAt = await wind(0);
    return wind(Math.max(0, Math.ceil((at - nowAt) / 60000)) + extra);
  };
  const everyone = async (show = '') => {
    const out = new Map();
    for (const p of ENTRANTS) out.set(p.name, await view(srv, p, show));
    return out;
  };

  section('the owner sets it up');
  PASS((await post(srv, '/api/admin/cup', { key: 'wrong', action: 'wind', minutes: 5 })).status === 401,
    'the clock does not move for somebody without the key');
  PASS((await desk({ action: 'enable', enabled: true })).json?.enabled === true, 'cups are switched on');
  const opened = await desk({
    action: 'open', name: CUP, joinSeconds: 60,
    prize: { currency: 'USD', first: 300, second: 150, third: 75 },
    schedule: { times: SLOTS, windowMinutes: WINDOW, matchMinutes: MATCH, offsetMinutes: 0 },
  });
  const A = opened.json?.cup;
  // A second cup, open for a month, that nobody here enters: somewhere for a
  // player to be looking when their own table opens.
  const B = (await desk({ action: 'open', name: 'Side Cup', joinSeconds: 30 * 86400 })).json?.cup;
  PASS(!!A?.id && A.state === 'joining' && !!B?.id, 'two cups are taking entries',
    `${A?.state} / ${B?.state}`);

  // ─────────────────────────────────────────────────────────────────────
  section('joining, from an iPhone, an Android phone and a browser');
  for (const p of ENTRANTS) {
    if (p.from === 'web') continue;
    const r = await post(srv, '/api/push/register',
      { token: p.token, deviceToken: crypto.randomBytes(32).toString('hex'), platform: p.from });
    if (!r.json?.ok) PASS(false, `${p.name}'s ${p.from} device registers for pushes`, JSON.stringify(r.json));
  }
  await post(srv, '/api/profile', { token: GUEST.token, name: GUEST.name });
  const refused = await post(srv, '/api/cup/join', { token: GUEST.token, cupId: A.id });
  PASS(refused.status === 401 && refused.json?.needsLogin === true,
    'somebody who never signed in is sent to sign in, not let in', String(refused.status));

  for (const p of ENTRANTS) {
    const r = await post(srv, '/api/cup/join', { token: p.token, cupId: A.id });
    if (!PASS(r.json?.ok === true, `${p.name} joins from ${p.from === 'ios' ? 'an iPhone' : p.from === 'android' ? 'an Android phone' : 'the web'}`,
      r.json?.error || '')) throw new Error('an entrant was refused');
  }
  const twice = await post(srv, '/api/cup/join', { token: ENTRANTS[0].token, cupId: A.id });
  PASS(twice.json?.already === true && twice.json?.entrants === 7, 'a second knock changes nothing',
    JSON.stringify(twice.json));

  let seen = await everyone();
  for (const p of ENTRANTS) {
    tell('the join window', p, seen.get(p.name), {
      cup: CUP, state: 'joining', joined: true, out: false, progress: '1 of 3', next: null,
      run: '', placed: null, table: null,
      // "0 of 3" for the whole join window, before.
      liveTile: '1 of 3',
    });
  }
  const joining = seen.get('Asha').cup;
  const clockNow = await wind(0);
  PASS(JSON.stringify(joining.plan.map((r) => r.label)) === '["Quarter-finals","Semi-finals","Final"]'
    && joining.plan.every((r) => r.projected),
  'the plan is three rounds, all still to be drawn', joining.plan.map((r) => r.label).join(', '));
  const at = joining.schedule?.at || [];
  PASS(at.length === SLOTS.length
    && at.every((ms, i) => (ms % 86400000) / 60000 === SLOTS[i] && ms > clockNow - 60000 && ms - clockNow <= 86400000),
  'the schedule carries each slot as the next instant it strikes, for the reader\'s own clock',
  `${at.length} instants`);
  // That cup is set on Greenwich's clock, where a sign slipped the wrong way
  // reads exactly as a right one. An organiser five and a half hours east —
  // offsetMinutes as the desk sends it, minus getTimezoneOffset — with a slot
  // at two in the morning, which is the evening before in UTC.
  const east = (await desk({
    action: 'open', name: 'East Cup', joinSeconds: 600, opensAt: clockNow + 3 * 86400000,
    schedule: { times: [2 * 60, 20 * 60], windowMinutes: WINDOW, matchMinutes: MATCH, offsetMinutes: 330 },
  })).json?.cup;
  const eastAt = (await view(srv, SPECTATOR, east?.id || '')).cup?.schedule?.at || [];
  const utcMinute = (ms) => ((ms % 86400000) + 86400000) % 86400000 / 60000;
  PASS(east?.state === 'scheduled' && eastAt.length === 2
    && utcMinute(eastAt[0]) === 20 * 60 + 30 && utcMinute(eastAt[1]) === 14 * 60 + 30
    && eastAt.every((ms) => ms > clockNow && ms - clockNow <= 86400000),
  'an organiser\'s 02:00 and 20:00 in India come back as the instants 20:30 and 14:30 UTC',
  eastAt.map((ms) => new Date(ms).toISOString().slice(11, 16)).join(', '));
  await desk({ action: 'cancel', cupId: east?.id });
  PASS(JSON.stringify(seen.get('Asha').others.map((o) => [o.name, o.joined])) === '[["Side Cup",false]]',
    'the other cup is listed beside it, not joined');
  const spec0 = await view(srv, SPECTATOR);
  PASS(spec0.cup?.id === A.id && spec0.cup.you.joined === false && liveTile(spec0.cup) === '1 of 3'
    && spec0.cup.progress?.round === 1,
  'a signed-in onlooker sees the cup, not joined, and round 1 of 3 rather than 0',
  spec0.cup && liveTile(spec0.cup));

  // ─────────────────────────────────────────────────────────────────────
  section('the doors close on their own clock, and the draw is made');
  // Close them on an odd hour, so the first door (an even hour) is exactly an
  // hour off and nothing the server does on its own five-second tick can
  // reach it while this is being read.
  const evenHour = Math.ceil((clockNow + 61000) / (2 * HOUR)) * 2 * HOUR;
  await windTo(evenHour + HOUR);
  seen = await everyone();
  const drawn = seen.get('Asha').cup;
  PASS(drawn.state === 'running' && drawn.rounds === 1 && drawn.round?.matches?.length === 4,
    'the cup is running: one round, three tables and a bye', `${drawn.state}, ${drawn.round?.matches?.length} rows`);

  const byeName = ENTRANTS.find((p) => seen.get(p.name).cup.you.run?.[0]?.result === 'bye')?.name;
  const pairs = [];
  for (const p of ENTRANTS) {
    const opp = seen.get(p.name).cup.you.next?.opponent;
    if (opp && p.name < opp) pairs.push(inOrder(p, byName.get(opp)));
  }
  pairs.sort((x, y) => (x[0].name < y[0].name ? -1 : 1));
  PASS(!!byeName && pairs.length === 3, 'every entrant is either at a table or has the bye',
    `bye ${byeName}; ${pairs.map(([a, b]) => `${a.name} v ${b.name}`).join(', ')}`);
  if (!byeName || pairs.length !== 3) throw new Error('the draw did not come back whole');
  const D1 = seen.get(pairs[0][0].name).cup.you.next.opensAt;
  PASS(D1 - (await wind(0)) > 55 * 60000 && (D1 % (2 * HOUR)) === 0,
    'the first round opens at the next slot on the schedule, not the moment the doors shut',
    new Date(D1).toISOString());

  for (const p of ENTRANTS) {
    const opp = pairs.flat().includes(p) ? pairs.find((pr) => pr.includes(p)).find((x) => x !== p) : null;
    tell('after the draw', p, seen.get(p.name), p.name === byeName ? {
      joined: true, out: false, progress: '1 of 3', next: null, run: 'Quarter-finals:bye', table: null, liveTile: '1 of 3',
    } : {
      joined: true, out: false, progress: '1 of 3', next: `Quarter-finals v ${opp.name}`, nextRound: 1,
      run: 'Quarter-finals:waiting', table: null, liveTile: '1 of 3', liveCard: 'Waiting for your next table.',
    });
  }
  const plan1 = drawn.plan;
  PASS(plan1[0].projected === false && plan1[0].players === 7 && plan1[0].opensAt === D1
    && plan1.slice(1).every((r) => r.projected),
  'the plan now has the real first round and two still projected');
  PASS(await until(() => pushed(srv, 'The draw is out') === [...pairs.flat()].filter((p) => iosNames.has(p.name)).length, 3000),
    'every iPhone at a table is told the draw, and nobody else\'s phone is',
    `${pushed(srv, 'The draw is out')} told`);

  // Who does what in round one. The first table has a no-show; the other two
  // are played, and the whistle decides them.
  const [comer, absentee] = pairs[0];
  const played1 = pairs.slice(1);

  // ─────────────────────────────────────────────────────────────────────
  section('the first door opens, and the tables are made');
  await windTo(D1);
  seen = await everyone();
  for (const [a, b] of pairs) {
    for (const [p, o] of [[a, b], [b, a]]) {
      tell('the door is open', p, seen.get(p.name), {
        joined: true, out: false, next: `Quarter-finals v ${o.name} (open)`,
        run: 'Quarter-finals:playing', table: `Quarter-finals v ${o.name}`, liveCard: 'Your table is open',
      });
    }
  }
  tell('the door is open', byName.get(byeName), seen.get(byeName), { next: null, table: null, run: 'Quarter-finals:bye' });
  const roomOf = (p) => seen.get(p.name).table?.roomId;
  PASS(pairs.every(([a, b]) => roomOf(a) && roomOf(a) === roomOf(b)
    && seen.get(a.name).cup.you.roomId === roomOf(a)),
  'both players at each table are pointed at the same room, on the card and at the top');

  section('a player looking at another cup is still taken to their table');
  let away = await view(srv, comer, B.id);
  PASS(away.cup?.id === A.id && away.cup.you.roomId === roomOf(comer) && away.table?.seated === false,
    `${comer.name} asks for the other cup while their door is open, and is shown their own table`,
    `shown ${away.cup?.name}, room ${away.cup?.you?.roomId}`);
  const chairs = new Map();
  const sit = async (p) => {
    const c = seat(srv, p, roomOf(p));
    chairs.set(p.name, c);
    await c.join();
    return c;
  };
  await sit(comer);
  away = await view(srv, comer, B.id);
  PASS(away.cup?.id === B.id && away.table?.roomId === roomOf(comer) && away.table?.seated === true,
    `once seated, ${comer.name} may look at the other cup — and still knows where their table is`,
    `shown ${away.cup?.name}, table ${away.table?.roomId}`);
  const stray = await view(srv, absentee, B.id);
  PASS(stray.cup?.id === A.id && stray.cup.you.roomId === roomOf(absentee),
    `${absentee.name}, who never sits down, is shown their table whichever cup they ask for`);

  section('two tables are played; one is not');
  for (const [a, b] of played1) {
    const ca = await sit(a);
    const cb = await sit(b);
    PASS(await lead(ca, cb), `${a.name} v ${b.name} starts, and ${a.name} goes 800 ahead on a trade`,
      `${ca.me()?.money} v ${cb.me()?.money}`);
  }
  PASS(chairs.get(comer.name).state?.status === 'lobby', `${comer.name} waits alone at a table ${absentee.name} never opens`);

  // ─────────────────────────────────────────────────────────────────────
  section('the door shuts: a walkover');
  await windTo(D1 + WINDOW * 60000, 1);
  seen = await everyone();
  tell('the door has shut', comer, seen.get(comer.name), {
    out: false, next: null, run: 'Quarter-finals:won/walkover', table: null,
  });
  tell('the door has shut', absentee, seen.get(absentee.name), {
    joined: true, out: true, next: null, run: 'Quarter-finals:lost/walkover', table: null, progress: '1 of 3',
    // The live card does tell them. The live ROOM does not — it gates the
    // line on `joined` being false — which only a new build can fix.
    liveCard: 'You are out of this one.',
  });
  for (const [a, b] of played1) {
    for (const [p, o] of [[a, b], [b, a]]) {
      tell('the door has shut', p, seen.get(p.name), {
        out: false, next: `Quarter-finals v ${o.name} (open)`, run: 'Quarter-finals:playing',
      });
    }
  }
  chairs.get(comer.name).leave();

  // ─────────────────────────────────────────────────────────────────────
  section('the whistle: the richer player goes through');
  const whistle1 = Math.max(...played1.map(([a]) => seen.get(a.name).cup.you.next?.endsAt || 0));
  PASS(whistle1 > D1 && whistle1 <= D1 + (MATCH + 1) * 60000,
    'each game shows the whistle it will be decided at', new Date(whistle1).toISOString());
  await windTo(whistle1, 1);
  seen = await everyone();
  const semis = [comer, byName.get(byeName), ...played1.map(([a]) => a)];
  const out1 = [absentee, ...played1.map(([, b]) => b)];
  for (const [a, b] of played1) {
    const run = seen.get(a.name).cup.you.run?.[0];
    // Both sides are still worth something at a whistle: the scoreline is
    // read before the one behind is walked off the board, not after, when
    // their pockets have already been emptied.
    PASS(run?.result === 'won' && run.worth?.them > 0 && run.worth.you > run.worth.them,
      `${a.name} was ahead at the whistle and went through`, JSON.stringify(run?.worth));
    tell('after the whistle', b, seen.get(b.name), {
      out: true, next: null, run: 'Quarter-finals:lost', table: null, liveCard: 'You are out of this one.',
    });
    // Behind at the whistle is not walking out: the game is ended by retiring
    // them, but no karma goes with it.
    const karmaB = (await get(srv, `/api/me?token=${enc(b.token)}`)).json?.karma;
    PASS(karmaB === 100, `${b.name} lost at the whistle and kept their karma`, String(karmaB));
    chairs.get(a.name).leave();
    chairs.get(b.name).leave();
  }
  const semiPairs = [];
  for (const p of semis) {
    const opp = seen.get(p.name).cup.you.next?.opponent;
    if (opp && p.name < opp) semiPairs.push(inOrder(p, byName.get(opp)));
  }
  semiPairs.sort((x, y) => (x[0].name < y[0].name ? -1 : 1));
  if (semiPairs.length !== 2) throw new Error(`the semi-finals did not draw: ${JSON.stringify(semiPairs.map((x) => x.map((y) => y.name)))}`);
  const D2 = seen.get(semis[0].name).cup.you.next.opensAt;
  PASS(D2 === D1 + 2 * HOUR, 'the semi-finals are drawn for the next slot', new Date(D2).toISOString());
  for (const p of semis) {
    const opp = semiPairs.find((pr) => pr.includes(p)).find((x) => x !== p);
    tell('the semi-finals are drawn', p, seen.get(p.name), {
      joined: true, out: false, progress: '2 of 3', next: `Semi-finals v ${opp.name}`, nextRound: 2,
      run: `Quarter-finals:${p.name === byeName ? 'bye' : p === comer ? 'won/walkover' : 'won'} > Semi-finals:waiting`,
      liveTile: '2 of 3',
    });
  }
  // Asked for by name: left to itself, an onlooker's card goes to the cup
  // still taking entries, which is one they could actually join.
  const spec1 = await view(srv, SPECTATOR, A.id);
  PASS(spec1.cup?.id === A.id && liveTile(spec1.cup) === '2 of 3' && spec1.cup.progress?.round === 2,
    'an onlooker is told the cup is in round 2 of 3', liveTile(spec1.cup));
  PASS((await view(srv, SPECTATOR)).cup?.id === B.id,
    'and, left to itself, their card offers the cup they could still enter');
  PASS(await until(() => pushed(srv, `You are out of ${CUP}`) === out1.filter((p) => iosNames.has(p.name)).length, 3000),
    'the three knocked out in round one are told so, on the iPhones among them',
    `${pushed(srv, `You are out of ${CUP}`)} told`);

  // ─────────────────────────────────────────────────────────────────────
  section('the semi-finals');
  // Only an iPhone is pushed to, and the draw decides who reaches the last
  // four. So every semi-finalist picks theirs up — an account may have a
  // phone beside its browser — and what the last evening says to each of
  // them can be counted whichever way the draw fell.
  for (const p of semis) {
    if (iosNames.has(p.name)) continue;
    const r = await post(srv, '/api/push/register',
      { token: p.token, deviceToken: crypto.randomBytes(32).toString('hex'), platform: 'ios' });
    if (r.json?.ok) iosNames.add(p.name);
  }
  PASS(semis.every((p) => iosNames.has(p.name)), 'all four semi-finalists have an iPhone to hand',
    semis.map((p) => `${p.name} (${p.from})`).join(', '));
  await windTo(D2);
  seen = await everyone();
  for (const [a, b] of semiPairs) {
    PASS(seen.get(a.name).table?.label === 'Semi-finals' && seen.get(a.name).table?.round === 2,
      `${a.name} v ${b.name}: the table is open`);
    const ca = seat(srv, a, seen.get(a.name).table.roomId);
    const cb = seat(srv, b, seen.get(b.name).table.roomId);
    chairs.set(a.name, ca);
    chairs.set(b.name, cb);
    await ca.join();
    await cb.join();
    PASS(await lead(ca, cb), `${a.name} goes 800 ahead of ${b.name}`);
  }
  const whistle2 = Math.max(...semiPairs.map(([a]) => seen.get(a.name).table?.endsAt || 0));
  const r1Of = (p) => `Quarter-finals:${p.name === byeName ? 'bye' : p === comer ? 'won/walkover' : 'won'}`;

  // One semi-final is over long before the other: its loser walks out. Real
  // games end when they end, and two semi-finals decided in the same second
  // — as they are at a shared whistle — hide the minutes in between, in which
  // the one who lost first has no game and no opponent yet, and is about to
  // be drawn into the play-off. They must not be told they are out.
  const [, early] = semiPairs[0];
  const outSoFar = pushed(srv, `You are out of ${CUP}`);
  chairs.get(early.name).emit('quit');
  await until(async () => (await view(srv, early)).cup?.you?.run?.at(-1)?.result === 'lost');
  await wind(0);
  const gap = await view(srv, early);
  tell('one semi-final is over, the other is not', early, gap, {
    state: 'running', joined: true, out: false, next: null, table: null, settled: null,
    run: `${r1Of(early)} > Semi-finals:lost`, progress: '2 of 3',
    liveTile: '2 of 3', liveCard: 'Waiting for your next table.',
  });
  await sleep(300);
  PASS(pushed(srv, `You are out of ${CUP}`) === outSoFar,
    `${early.name} is not told they are out while the other semi-final is still being played`,
    `${pushed(srv, `You are out of ${CUP}`) - outSoFar} told`);

  await windTo(whistle2, 1);
  for (const p of semiPairs.flat()) chairs.get(p.name).leave();
  seen = await everyone();

  const finalists = semiPairs.map(([a]) => a);
  const playoff = semiPairs.map(([, b]) => b);
  const D3 = seen.get(finalists[0].name).cup.you.next?.opensAt;
  PASS(D3 === D2 + 2 * HOUR, 'the final and the play-off share the next slot', new Date(D3 || 0).toISOString());

  section('the last evening, before its door opens');
  for (const [p, o] of [[finalists[0], finalists[1]], [finalists[1], finalists[0]]]) {
    tell('the final is drawn', p, seen.get(p.name), {
      joined: true, out: false, progress: '3 of 3', next: `Final v ${o.name}`, nextRound: 3,
      run: `${r1Of(p)} > Semi-finals:won > Final:waiting`, liveTile: '3 of 3',
    });
    const room = liveRoomRun(seen.get(p.name).cup);
    PASS(seen.get(p.name).cup.round?.kind === 'final' && JSON.stringify(room) === '["The final"]',
      `${p.name}'s card is about the final, and the live room shows their final as their run`,
      `${seen.get(p.name).cup.round?.kind}, ${JSON.stringify(room)}`);
  }
  for (const [p, o] of [[playoff[0], playoff[1]], [playoff[1], playoff[0]]]) {
    tell('the play-off is drawn', p, seen.get(p.name), {
      joined: true, out: false, progress: '3 of 3', next: `Third place v ${o.name}`, nextRound: 3,
      run: `${r1Of(p)} > Semi-finals:lost > Third place:waiting`,
      // "4 of 3", before: the play-off sits one past the final on the list.
      liveTile: '3 of 3', liveCard: 'Waiting for your next table.',
    });
    PASS(seen.get(p.name).cup.round?.kind === 'thirdPlace' && seen.get(p.name).cup.round?.n === 3,
      `${p.name}'s card is about the play-off, numbered with the final rather than after it`);
  }
  for (const p of out1) {
    tell('the last evening', p, seen.get(p.name), { out: true, next: null, progress: '1 of 3', liveTile: '1 of 3' });
    PASS(seen.get(p.name).cup.round?.kind === 'final',
      `${p.name}, out already, is shown the final rather than the play-off beside it`);
  }
  PASS(pushed(srv, `You are out of ${CUP}`) === out1.filter((p) => iosNames.has(p.name)).length,
    'nobody going into the play-off has been told they are out');
  PASS(await until(() => pushed(srv, 'One more game — the play-off for third')
    === playoff.filter((p) => iosNames.has(p.name)).length, 3000),
  'the play-off players are told about one more game, not "You are through!"',
  `${pushed(srv, 'One more game')} told, ${pushed(srv, 'You are through! Third place')} through`);
  PASS(pushed(srv, 'You are through! Third place') === 0, 'and no semi-final loser is told they are through');

  // ─────────────────────────────────────────────────────────────────────
  section('the final and the play-off, side by side');
  await windTo(D3);
  seen = await everyone();
  const lastPairs = [inOrder(...finalists), inOrder(...playoff)];
  for (const [a, b] of lastPairs) {
    const label = finalists.includes(a) ? 'Final' : 'Third place';
    PASS(seen.get(a.name).table?.label === label && seen.get(a.name).table?.round === 3,
      `${label}: ${a.name} v ${b.name}, the table is open, round 3`);
    const ca = seat(srv, a, seen.get(a.name).table.roomId);
    const cb = seat(srv, b, seen.get(b.name).table.roomId);
    chairs.set(a.name, ca);
    chairs.set(b.name, cb);
    await ca.join();
    await cb.join();
    PASS(await lead(ca, cb), `${a.name} goes 800 ahead of ${b.name}`);
  }
  const whistle3 = Math.max(...lastPairs.map(([a]) => seen.get(a.name).table?.endsAt || 0));

  // The play-off does not wait for the whistle: its loser walks out, and it
  // is over while the final is still being played. Third place is decided;
  // the podium is not written until the final is, and until then nobody who
  // played on this last evening may be told they are out.
  const [third, fourth] = lastPairs[1];
  chairs.get(fourth.name).emit('quit');
  await until(async () => (await view(srv, third)).cup?.you?.run?.at(-1)?.result === 'won');
  const outBefore = pushed(srv, `You are out of ${CUP}`);
  await wind(0);
  seen = await everyone();
  // Third is won and not yet written: `settled` says so, and the apps say the
  // place rather than "out".
  tell('the play-off is over, the final is not', third, seen.get(third.name), {
    state: 'running', placed: null, settled: 'third', next: null, table: null,
    run: `${r1Of(third)} > Semi-finals:lost > Third place:won`,
  });
  tell('the play-off is over, the final is not', fourth, seen.get(fourth.name), {
    state: 'running', out: true, placed: null, settled: null, next: null,
    run: `${r1Of(fourth)} > Semi-finals:lost > Third place:lost`,
  });
  for (const p of lastPairs[0]) {
    tell('the play-off is over, the final is not', p, seen.get(p.name), {
      state: 'running', out: false, settled: null, run: `${r1Of(p)} > Semi-finals:won > Final:playing`,
    });
  }
  await sleep(300);
  PASS(pushed(srv, `You are out of ${CUP}`) === outBefore,
    'neither play-off player is told they are out while the podium waits on the final',
    `${pushed(srv, `You are out of ${CUP}`) - outBefore} told`);

  await windTo(whistle3, 1);
  for (const p of lastPairs.flat()) chairs.get(p.name).leave();

  // ─────────────────────────────────────────────────────────────────────
  section('the podium');
  seen = await everyone();
  const [champion, runnerUp] = lastPairs[0];
  const done = seen.get(champion.name).cup;
  PASS(done.state === 'done'
    && done.standings?.first?.code === champion.code
    && done.standings?.second?.code === runnerUp.code
    && done.standings?.third?.code === third.code,
  `${champion.name} first, ${runnerUp.name} second, ${third.name} third`,
  `${done.standings?.first?.name}, ${done.standings?.second?.name}, ${done.standings?.third?.name}`);
  tell('the podium', champion, seen.get(champion.name), {
    state: 'done', joined: true, out: false, placed: 'first', settled: null, next: null, table: null,
    run: `${r1Of(champion)} > Semi-finals:won > Final:won`,
  });
  tell('the podium', runnerUp, seen.get(runnerUp.name), {
    state: 'done', out: false, placed: 'second', next: null,
    run: `${r1Of(runnerUp)} > Semi-finals:won > Final:lost`,
  });
  tell('the podium', third, seen.get(third.name), {
    state: 'done', out: false, placed: 'third', next: null,
    run: `${r1Of(third)} > Semi-finals:lost > Third place:won`,
  });
  tell('the podium', fourth, seen.get(fourth.name), {
    state: 'done', out: true, placed: null, next: null,
    run: `${r1Of(fourth)} > Semi-finals:lost > Third place:lost`,
  });
  for (const p of out1) {
    tell('the podium', p, seen.get(p.name), { state: 'done', out: true, placed: null, next: null });
  }
  PASS(JSON.stringify(liveRoomRun(seen.get(champion.name).cup)) === '["The final"]',
    'the live room still shows the champion their final once it is over');

  const chart = (await get(srv, `/api/cup/bracket?token=${enc(champion.token)}&cup=${A.id}`)).json?.bracket;
  PASS(JSON.stringify(chart?.rounds?.map((r) => r.label)) === '["Quarter-finals","Semi-finals","Final","Third place"]'
    && chart?.you?.placed === 'first',
  'the chart names all four rounds and the champion\'s place', chart?.rounds?.map((r) => r.label).join(', '));

  const podiumPushes = [
    [`You won ${CUP}`, champion], [`You finished second in ${CUP}`, runnerUp], [`You finished third in ${CUP}`, third],
  ];
  const told = await until(() => podiumPushes.every(([text, p]) => pushed(srv, text) === (iosNames.has(p.name) ? 1 : 0))
    && pushed(srv, `You are out of ${CUP}`) === [...out1, fourth].filter((p) => iosNames.has(p.name)).length, 3000);
  PASS(told, 'the podium is told its places, and nobody on it was ever told they were out',
    podiumPushes.map(([text]) => `${text.split(' in ')[0]}: ${pushed(srv, text)}`).join(', ')
      + `, out: ${pushed(srv, `You are out of ${CUP}`)}`);

  const specEnd = await view(srv, SPECTATOR);
  PASS(specEnd.cup?.id === B.id, 'an onlooker has moved on to the cup still taking entries', specEnd.cup?.name);

  // ─────────────────────────────────────────────────────────────────────
  section('a cup of three: third place with nobody to play off against');
  // Any field that reaches the semi-finals three strong has a bye in them, so
  // only one person loses there and there is no play-off: they are third, and
  // it is settled the moment their semi-final is. The three knocked out of the
  // first cup play this one.
  const TRIO = 'Trio Cup';
  const trio = [...out1].sort((x, y) => (x.name < y.name ? -1 : 1));
  for (const p of trio) {
    if (iosNames.has(p.name)) continue;
    const r = await post(srv, '/api/push/register',
      { token: p.token, deviceToken: crypto.randomBytes(32).toString('hex'), platform: 'ios' });
    if (r.json?.ok) iosNames.add(p.name);
  }
  const C = (await desk({
    action: 'open', name: TRIO, joinSeconds: 60,
    schedule: { times: SLOTS, windowMinutes: WINDOW, matchMinutes: MATCH, offsetMinutes: 0 },
  })).json?.cup;
  for (const p of trio) {
    const r = await post(srv, '/api/cup/join', { token: p.token, cupId: C?.id });
    if (!PASS(r.json?.ok === true, `${p.name}, out of the first cup, enters the second`, r.json?.error || '')) {
      throw new Error('an entrant was refused');
    }
  }
  const trioNow = await wind(0);
  await windTo(Math.ceil((trioNow + 61000) / (2 * HOUR)) * 2 * HOUR + HOUR);
  const trioView = async () => new Map(await Promise.all(trio.map(async (p) => [p.name, await view(srv, p, C.id)])));
  let tv = await trioView();
  const trioBye = trio.find((p) => tv.get(p.name).cup?.you?.run?.[0]?.result === 'bye');
  const [tWin, tLose] = inOrder(...trio.filter((p) => p !== trioBye));
  PASS(!!trioBye && tv.get(tWin.name).cup.you.next?.opponent === tLose.name
    && tv.get(tWin.name).cup.you.next?.label === 'Semi-finals',
  'three entrants make one semi-final and a bye', `bye ${trioBye?.name}; ${tWin.name} v ${tLose.name}`);
  PASS(await until(() => pushed(srv, 'A bye — you go straight through to the final.') === 1, 3000),
    `${trioBye?.name} is told the bye takes them to the final, not to the semi-final it skips`);
  await windTo(tv.get(tWin.name).cup.you.next.opensAt);
  tv = await trioView();
  const tRoom = tv.get(tWin.name).table?.roomId;
  const tw = seat(srv, tWin, tRoom);
  const tl = seat(srv, tLose, tRoom);
  chairs.set(tWin.name, tw);
  chairs.set(tLose.name, tl);
  await tw.join();
  await tl.join();
  await until(() => tw.state?.status === 'playing' && tl.state?.status === 'playing');
  tl.emit('quit');
  await until(async () => (await view(srv, tWin, C.id)).cup?.you?.next?.label === 'Final');
  await wind(0);
  tv = await trioView();
  tell('the semi-final is over', tLose, tv.get(tLose.name), {
    cup: TRIO, state: 'running', joined: true, out: true, settled: 'third', placed: null, next: null,
    run: 'Semi-finals:lost', progress: '1 of 2',
    // What the apps already on phones say: out, until the podium is written.
    liveCard: 'You are out of this one.',
  });
  for (const [p, o] of [[tWin, trioBye], [trioBye, tWin]]) {
    tell('the final is drawn', p, tv.get(p.name), {
      out: false, settled: null, next: `Final v ${o.name}`, progress: '2 of 2', liveTile: '2 of 2',
    });
  }
  await sleep(300);
  PASS(pushed(srv, `You are out of ${TRIO}`) === 0,
    `${tLose.name}, third by default, is not told they are out while the final is played`);

  await windTo(tv.get(tWin.name).cup.you.next.opensAt);
  tv = await trioView();
  const [fA, fB] = inOrder(tWin, trioBye);
  const fRoom = tv.get(fA.name).table?.roomId;
  const fa = seat(srv, fA, fRoom);
  const fb = seat(srv, fB, fRoom);
  chairs.set(fA.name, fa);
  chairs.set(fB.name, fb);
  await fa.join();
  await fb.join();
  await until(() => fa.state?.status === 'playing' && fb.state?.status === 'playing');
  fb.emit('quit');
  await until(async () => (await view(srv, fA, C.id)).cup?.state === 'done');
  await wind(0);
  tv = await trioView();
  tell('the trio\'s podium', tLose, tv.get(tLose.name), {
    state: 'done', out: false, placed: 'third', settled: null, next: null,
  });
  PASS(tv.get(fA.name).cup?.standings?.third?.code === tLose.code
    && tv.get(fA.name).cup?.you?.placed === 'first' && tv.get(fB.name).cup?.you?.placed === 'second',
  `${fA.name} first, ${fB.name} second, ${tLose.name} third without a play-off`);
  PASS(await until(() => pushed(srv, `You finished third in ${TRIO}`) === 1, 3000)
    && pushed(srv, `You are out of ${TRIO}`) === 0,
  `${tLose.name} is told they finished third, and was never told they were out`,
  `third: ${pushed(srv, `You finished third in ${TRIO}`)}, out: ${pushed(srv, `You are out of ${TRIO}`)}`);
  for (const c of [tw, tl, fa, fb]) c.leave();

  // ─────────────────────────────────────────────────────────────────────
  section('the clock cannot be wound anywhere real');
  const realDir = fs.mkdtempSync(path.join(tmpRoot, 'real-'));
  const real = await startServer(realDir, { MONEYMOVE_TEST_HOOKS: '1', RENDER: 'true' });
  const nope = await post(real, '/api/admin/cup', { key: ADMIN, action: 'wind', minutes: 60 });
  PASS(nope.status === 400 && /unknown action/i.test(nope.json?.error || ''),
    'a server on Render refuses the test hook even with it switched on', `${nope.status} ${nope.json?.error}`);
  await stopServer(real);
} catch (err) {
  failed++;
  console.error('\n  FAIL  the run itself —', err?.stack || err);
  if (srv?.log) console.error(srv.log.split('\n').filter((l) => /cup|error|warn/i.test(l)).slice(-30).join('\n'));
} finally {
  for (const s of sockets) { try { s.disconnect(); } catch { /* gone */ } }
  await stopServer(srv);
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* leave it */ }
}

console.log(`\n${failed ? 'FAIL' : 'PASS'}  ${passed} passed, ${failed} failed  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
process.exit(failed ? 1 : 0);
