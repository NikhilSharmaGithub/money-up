// Player profiles from the results screen, friend requests to house players,
// and invites that say who is asking.
//
// After a game anyone can open anyone else's card: wins, games, titles, and an
// Add friend button. That needs three things from the server, and this test
// holds each of them over the real wire — the server started as a process,
// people sitting down on real sockets:
//
//   · every seat in the state carries a public code — a person's friend code,
//     a house player's H0 stand-in, nothing for a pass & play guest — in full
//     states and in patches alike, and never a token
//   · GET /api/player answers for a person with public fields only, for a
//     house player with numbers that do not move between looks, and with a
//     404 for anybody else, or for anybody behind a block
//   · a friend request to a house player is taken, shown as sent, can be
//     taken back, survives a restart, and is never accepted
//
// And invites: the push names the inviter, an iPhone push would carry what a
// tap needs, the banner's invite carries the inviter's flag, and pressing
// Invite twice inside twenty seconds rings the friend's phone once.
//
// No push credentials are given, so both senders stay dark and say in the log
// what they would have sent — which is what this reads, as cup-flow.mjs does.
// The exact Apple and Google payloads are held by push-fcm.mjs.
//
//   node test/player-profile.mjs
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
import { applyPatch, applyFeed } from '../server/delta.js';
import { itemById } from '../server/store.js';

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
const short = (v) => JSON.stringify(v)?.slice(0, 300);

// ------------------------------------------------------------- the people --
const hex = (n) => crypto.randomBytes(n).toString('hex');
const CODES = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = (tag) => `${tag}${[...crypto.randomBytes(4)].map((b) => CODES[b % 32]).join('')}`;
const AVATAR = 'av-crownface';
const person = (name, tag, flag = '') => ({ name, flag, token: `dev-${name.toLowerCase()}-${hex(6)}`, code: code(tag) });
const ASHA = person('Asha', 'PA', '🇮🇳');
const BILAL = person('Bilal', 'PB');
const CHANDRA = person('Chandra', 'PC');   // has blocked Asha
const DEV = person('Dev', 'PD');           // has asked Asha to be friends
const ELLA = person('Ella', 'PE');         // won before games were counted

/** What social.json holds for them, including everything that must never be read out. */
function seedPeople() {
  const at = Date.now();
  const base = (p) => ({
    token: p.token, code: p.code, name: p.name, flag: p.flag, seen: at, created: at - 50 * 86400000,
    friends: [], wants: [], asked: [], coins: 0, owned: [], equipped: {}, karma: 100,
  });
  return [
    {
      ...base(ASHA),
      friends: [BILAL.code],
      asked: [DEV.code],
      wins: 7, games: 12, winnings: 15, turnsPlayed: 300, firstPlayed: at - 40 * 86400000,
      titleCounts: { Landlord: 3, 'Hot Dice': 1, Dealmaker: 5, Jailbird: 2 },
      coins: 4321, karma: 77, owned: [AVATAR], equipped: { avatar: AVATAR },
      email: 'asha.private@example.com', picture: 'https://example.com/asha-face.png',
      login: { provider: 'google', subject: 'google-subject-asha-0042', at },
      appleRefresh: { token: 'apple-refresh-secret-asha', subject: 'apple-subject-asha' },
    },
    { ...base(BILAL), friends: [ASHA.code] },
    { ...base(CHANDRA), blocked: [ASHA.code] },
    { ...base(DEV), wants: [ASHA.code] },
    { ...base(ELLA), wins: 4, winnings: 8 },
  ];
}
const SECRETS = ['asha.private@example.com', 'asha-face.png', 'google-subject-asha', 'apple-refresh-secret',
  'apple-subject-asha', ASHA.token, '4321'];

const PROFILE_KEYS = ['code', 'name', 'flag', 'avatar', 'wins', 'games', 'winnings', 'titles', 'since', 'relation'].sort();
const HOUSE = /^H0[0-9A-F]{4}$/;

// ----------------------------------------------------------------- server --
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-player-profile-'));
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
  // Both push senders dark, whatever this machine's shell has lying around.
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
const profile = (srv, c, viewer) => get(srv,
  `/api/player?code=${encodeURIComponent(c)}${viewer ? `&token=${encodeURIComponent(viewer.token)}` : ''}`);

/** The pushes the server would have sent an iPhone, read off its log. */
const pushed = (srv, text) => srv.log.split('\n')
  .filter((l) => l.includes('push (dark): would send "') && l.includes(text)).length;

// ------------------------------------------------------------- the table --
/**
 * A chair on its own socket. `delta` asks for patches, the way current apps
 * do, and stitches them back together the way they do — so what the checks
 * read is what a patching client would actually be holding.
 */
function seat(srv, who, { delta = false } = {}) {
  const sock = io(srv.url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(sock);
  const chair = { sock, who, state: null, seq: 0, patches: 0, toasts: [] };
  sock.on('state', (s) => { chair.state = s; chair.seq++; });
  sock.on('statePatch', (m) => {
    const cur = chair.state;
    if (!cur || m.from !== cur.version) { sock.emit('resync'); return; }
    const { log, chat, ...lean } = cur;
    const next = m.patch ? applyPatch(lean, m.patch) : lean;
    next.log = m.log ? applyFeed(log, m.log) : log;
    next.chat = m.chat ? applyFeed(chat, m.chat) : chat;
    next.version = m.v;
    chair.state = next;
    chair.patches++;
    chair.seq++;
  });
  sock.on('toast', (t) => chair.toasts.push(t?.message));
  chair.join = (roomId) => sock.emit('join', {
    roomId, token: who.token, name: who.name, flag: who.flag, ...(delta ? { proto: 2 } : {}),
  });
  chair.emit = (...a) => sock.emit(...a);
  return chair;
}
const rowNamed = (state, name) => state?.players?.find((p) => p.name === name);

// ---------------------------------------------------------------- scenarios --
async function main() {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'data-'));
  fs.writeFileSync(path.join(dir, 'social.json'), JSON.stringify({ profiles: seedPeople() }));
  let S = await startServer('first', dir);

  // First, so the twenty seconds it has to wait out run under everything else.
  section('an invite names who is asking, and rings once per twenty seconds');
  const BI = hex(32);
  let firstRang = 0;
  {
    const r = await post(S, '/api/push/register', { token: BILAL.token, deviceToken: BI, platform: 'ios' });
    PASS(r.json?.ok === true, 'Bilal\'s iPhone is registered', r.text);
    const inv = await post(S, '/api/invite', { token: ASHA.token, code: BILAL.code, roomId: 'tbl42' });
    firstRang = Date.now();
    PASS(inv.status === 200 && inv.json?.ok === true && !inv.json.throttled && inv.json.to?.code === BILAL.code
      && !('token' in inv.json), 'Asha invites Bilal: ok, who it went to, and no token in the reply', inv.text);
    const text = 'Asha invited you to a game — tap to join';
    PASS(!!await until(() => pushed(S, text) === 1), 'the push names Asha', `"${text}" ×${pushed(S, text)}`);
    PASS(pushed(S, 'You have been invited') === 0, 'and the old nameless line is gone');
    const banner = (await get(S, `/api/invite?token=${BILAL.token}`)).json?.invite;
    PASS(banner?.from === ASHA.code && banner.name === 'Asha' && banner.flag === ASHA.flag && banner.roomId === 'tbl42'
      && typeof banner.at === 'number', 'the banner\'s invite carries her code, name, flag and table', short(banner));

    const again = await post(S, '/api/invite', { token: ASHA.token, code: BILAL.code, roomId: 'tbl43' });
    PASS(again.status === 200 && again.json?.ok === true && again.json.throttled === true && !('token' in again.json),
      'pressing Invite again at once: ok, throttled', again.text);
    await sleep(400);
    PASS(pushed(S, text) === 1, 'and Bilal\'s phone does not ring a second time', `${pushed(S, text)} push(es)`);
    const moved = (await get(S, `/api/invite?token=${BILAL.token}`)).json?.invite;
    PASS(moved?.roomId === 'tbl43', 'but the invite now names the newer table', short(moved));

    const back = await post(S, '/api/invite', { token: BILAL.token, code: ASHA.code, roomId: 'tbl44' });
    PASS(back.json?.ok === true && !back.json.throttled, 'the other direction is its own pair, and is not held back', back.text);
    const stranger = await post(S, '/api/invite', { token: ASHA.token, code: CHANDRA.code, roomId: 'tbl42' });
    PASS(stranger.status === 400 && stranger.json?.error === 'You can only invite friends',
      'and a stranger still cannot be invited', stranger.text);
  }

  section('every seat carries a public code');
  let houseCode = '';
  let houseName = '';
  let roomId = '';
  {
    const a = seat(S, ASHA, { delta: true });
    const g = seat(S, { name: 'Guest', flag: '', token: `${ASHA.token}_p2` });
    const b = seat(S, BILAL);
    ({ roomId } = await new Promise((r) => a.sock.emit('createRoom', { token: ASHA.token }, r)));
    a.join(roomId);
    await until(() => a.state?.players?.length === 1);
    a.emit('addBot');
    await until(() => a.state?.players?.length === 2);
    g.join(roomId);
    b.join(roomId);
    const all = await until(() => a.state?.players?.length === 4 && b.state?.players?.length === 4);
    PASS(!!all, 'Asha, a bot, her pass & play guest and Bilal sit down', a.state?.players?.map((p) => p.name).join(', '));

    const check = (who, state) => {
      const asha = rowNamed(state, 'Asha');
      const bilal = rowNamed(state, 'Bilal');
      const guest = rowNamed(state, 'Guest');
      const bot = state?.players?.find((p) => p.isBot);
      PASS(asha?.code === ASHA.code && bilal?.code === BILAL.code, `${who}: each person's row carries their friend code`,
        `${asha?.code} ${bilal?.code}`);
      PASS(HOUSE.test(bot?.code || ''), `${who}: the house player carries an H0 stand-in`, bot?.code);
      PASS(guest?.code === '', `${who}: the pass & play guest carries none`, JSON.stringify(guest?.code));
      return bot;
    };
    const botA = check('Asha, patched', a.state);
    const botB = check('Bilal, full states', b.state);
    PASS(a.patches > 0, 'Asha\'s copy really was built from patches', `${a.patches} patch(es)`);
    PASS(botA?.code === botB?.code, 'both see the same stand-in for the same bot', `${botA?.code} ${botB?.code}`);
    houseCode = botB?.code || '';
    houseName = botB?.name || '';
    const ashaRow = rowNamed(b.state, 'Asha');
    PASS(ashaRow && ashaRow.id !== ASHA.token && ashaRow.id !== ashaRow.code,
      'Bilal sees Asha under an alias, and the code is not it', ashaRow?.id);
    const raw = JSON.stringify(b.state);
    PASS(!raw.includes(ASHA.token), 'Asha\'s token (and so her guest\'s) is nowhere in Bilal\'s state');

    // A rival bot table, to be sure two house players never share a code.
    const c = seat(S, DEV);
    const other = (await new Promise((r) => c.sock.emit('createRoom', { token: DEV.token }, r))).roomId;
    c.join(other);
    await until(() => c.state?.players?.length === 1);
    c.emit('addBot');
    c.emit('addBot');
    await until(() => c.state?.players?.length === 3);
    const codes = (c.state?.players || []).filter((p) => p.isBot).map((p) => p.code);
    PASS(codes.length === 2 && codes.every((x) => HOUSE.test(x)) && codes[0] !== codes[1] && !codes.includes(houseCode),
      'house players at another table get stand-ins of their own', codes.join(' '));

    // Play it out: the three people concede, the bot wins, and the results
    // screen still carries every code.
    a.emit('start');
    await until(() => a.state?.status === 'playing' && b.state?.status === 'playing');
    PASS(a.state?.status === 'playing', 'the game starts', `${a.state?.status} ${a.toasts.join('; ')}`);
    for (const chair of [g, b, a]) {
      chair.emit('bankrupt');
      await sleep(80);
    }
    const ended = await until(() => a.state?.status === 'ended' && b.state?.status === 'ended', 8000);
    PASS(!!ended, 'everyone concedes and the game ends', `${a.state?.status} / ${b.state?.status}`);
    check('Asha, at the results', a.state);
    check('Bilal, at the results', b.state);
    PASS(a.state?.winner?.name === houseName, 'the house player won it', a.state?.winner?.name);
  }

  section('a person\'s profile');
  {
    const r = await profile(S, ASHA.code, BILAL);
    const p = r.json || {};
    PASS(r.status === 200 && isDeepStrictEqual(Object.keys(p).sort(), PROFILE_KEYS),
      'Bilal opens Asha: exactly the public fields', Object.keys(p).sort().join(','));
    PASS(p.code === ASHA.code && p.name === 'Asha' && p.flag === ASHA.flag && p.avatar === itemById(AVATAR).emoji,
      'her code, name, flag and avatar — the emoji, not the item id', `${p.name} ${p.flag} ${p.avatar}`);
    PASS(p.wins === 7 && p.games === 13 && p.winnings === 15,
      'her wins, games and coins won — the game she just lost counted as a game', `${p.wins}/${p.games}/${p.winnings}`);
    PASS(isDeepStrictEqual(p.titles, [{ title: 'Dealmaker', count: 5 }, { title: 'Landlord', count: 3 }, { title: 'Jailbird', count: 2 }]),
      'her three most-earned titles, most first', short(p.titles));
    PASS(typeof p.since === 'number' && p.since < Date.now() - 39 * 86400000, 'playing since her first game', new Date(p.since).toISOString());
    PASS(p.relation === 'friend', 'and to Bilal she is a friend', p.relation);
    const leaked = SECRETS.filter((s) => r.text.includes(s));
    PASS(!leaked.length, 'no email, photo, login, Apple token, coins or device token in it', leaked.join(', '));

    const rel = async (c, viewer) => (await profile(S, c, viewer)).json?.relation;
    PASS(await rel(ASHA.code, ASHA) === 'self', 'Asha opening her own: self');
    PASS(await rel(DEV.code, ASHA) === 'asked', 'Asha opening Dev, who asked her: asked');
    PASS(await rel(ASHA.code, DEV) === 'sent', 'Dev opening Asha: sent');
    PASS(await rel(BILAL.code, CHANDRA) === 'none', 'Chandra opening Bilal: none');
    const anon = await profile(S, ASHA.code);
    PASS(anon.status === 200 && anon.json?.relation === 'none', 'no token at all: the card, with relation none', anon.text.slice(0, 80));
    const lower = await profile(S, ASHA.code.toLowerCase(), BILAL);
    PASS(lower.json?.code === ASHA.code, 'a code typed in lower case still finds her');

    const ella = (await profile(S, ELLA.code)).json;
    PASS(ella?.wins === 4 && ella.games === 4, 'wins from before games were counted never outnumber the games',
      `${ella?.wins}/${ella?.games}`);

    const blocked = await profile(S, ASHA.code, CHANDRA);
    PASS(blocked.status === 404 && blocked.json?.error === 'No player with that code',
      'Chandra blocked Asha: Chandra is told there is nobody', blocked.text);
    const blocker = await profile(S, CHANDRA.code, ASHA);
    PASS(blocker.status === 404 && blocker.json?.error === 'No player with that code',
      'and Asha, opening Chandra, is told the very same', blocker.text);

    const fresh = { token: `dev-fresh-${hex(6)}` };
    const looked = await profile(S, ASHA.code, fresh);
    const me = (await get(S, `/api/me?token=${fresh.token}`)).json;
    PASS(looked.status === 200 && looked.json?.relation === 'none' && me?.code === '',
      'a viewer nobody has met gets the card, and is not made a profile by looking', short(me));
  }

  section('a house player\'s profile');
  let houseCard = null;
  {
    const r1 = await profile(S, houseCode, BILAL);
    const r2 = await profile(S, houseCode, BILAL);
    const p = r1.json || {};
    PASS(r1.status === 200 && isDeepStrictEqual(Object.keys(p).sort(), PROFILE_KEYS),
      'Bilal opens the bot: the same fields a person has', Object.keys(p).sort().join(','));
    PASS(p.code === houseCode && p.name === houseName && p.flag === '' && p.avatar === '' && p.relation === 'none',
      'its name from the table, and relation none', `${p.name} ${p.relation}`);
    PASS(isDeepStrictEqual(r1.json, r2.json), 'two looks, the same numbers', `${p.wins}/${p.games}/${p.winnings}`);
    const sinceOk = p.since >= Date.UTC(2026, 2, 1) && p.since < Date.UTC(2026, 2, 1) + 182 * 86400000;
    PASS(p.wins >= 3 && p.wins <= 90 && p.games >= p.wins + 6 && p.games <= p.wins + 140
      && p.winnings >= p.wins * 2 && p.winnings <= p.wins * 2 + 40 && sinceOk,
    'believable: 3–90 wins, more games than that, about two coins a win, playing since this year',
    `${p.wins} wins, ${p.games} games, ${p.winnings} coins, since ${new Date(p.since).toISOString().slice(0, 10)}`);
    PASS(Array.isArray(p.titles) && p.titles.length <= 2
      && p.titles.every((t) => typeof t.title === 'string' && t.count >= 1 && t.count <= p.games),
    'at most two titles from the real book', short(p.titles));
    PASS(!/bot|house/i.test(r1.text.replace(houseName, '')), 'and nothing in it says what it is');
    houseCard = p;

    const unseen = ['H00000', 'H0FFFF', 'H01234'].find((c) => c !== houseCode);
    for (const [c, why] of [['ZZZZZZ', 'a code nobody has'], [unseen, 'a stand-in the server never handed out'],
      ['abc', 'something that is not a code']]) {
      const r = await profile(S, c, BILAL);
      PASS(r.status === 404 && r.json?.error === 'No player with that code', `${why}: 404`, `${c} → ${r.status} ${r.text}`);
    }
  }

  section('a friend request to a house player');
  {
    const card = { code: houseCode, name: houseName, flag: '', avatar: '' };
    const r = await post(S, '/api/friends', { token: ASHA.token, code: houseCode });
    PASS(r.status === 200 && isDeepStrictEqual(r.json, { ok: true, sent: true, friend: card }),
      'Asha asks the bot: sent, with its card', r.text);
    const twice = await post(S, '/api/friends', { token: ASHA.token, code: houseCode.toLowerCase() });
    PASS(isDeepStrictEqual(twice.json, { ok: true, sent: true, friend: card }), 'asking again changes nothing', twice.text);
    let social = (await get(S, `/api/social?token=${ASHA.token}`)).json;
    PASS(social?.sent?.filter((s) => s.code === houseCode).length === 1
      && isDeepStrictEqual(social.sent.find((s) => s.code === houseCode), card),
    'Social lists it once under sent, as any unanswered request', short(social?.sent));
    PASS(!social?.friends?.some((f) => f.code === houseCode) && !social?.requests?.some((f) => f.code === houseCode),
      'and not as a friend, nor as a request to answer');
    PASS((await profile(S, houseCode, ASHA)).json?.relation === 'sent', 'her card for it now says sent');
    const accept = await post(S, '/api/friends/accept', { token: ASHA.token, code: houseCode });
    PASS(accept.status === 400 && !accept.json?.ok, 'there is nothing for Asha to accept from its side', accept.text);
    const invite = await post(S, '/api/invite', { token: ASHA.token, code: houseCode, roomId });
    PASS(invite.status === 400, 'and it cannot be invited like a friend', invite.text);
    const ghost = await post(S, '/api/friends', { token: ASHA.token, code: 'H00000' === houseCode ? 'H0FFFF' : 'H00000' });
    PASS(ghost.status === 400 && ghost.json?.error === 'No player with that code',
      'a stand-in the server never handed out is nobody', ghost.text);

    const take = await post(S, '/api/friends/decline', { token: ASHA.token, code: houseCode });
    social = (await get(S, `/api/social?token=${ASHA.token}`)).json;
    PASS(take.json?.ok === true && !social?.sent?.some((s) => s.code === houseCode),
      'taking it back removes it from sent', short(social?.sent));
    PASS((await profile(S, houseCode, ASHA)).json?.relation === 'none', 'and her card for it says none again');

    // Bilal blocks it from the chat, then tries to befriend it.
    await post(S, '/api/block', { token: BILAL.token, code: houseCode });
    const behind = await profile(S, houseCode, BILAL);
    const blockedAsk = await post(S, '/api/friends', { token: BILAL.token, code: houseCode });
    PASS(behind.status === 404 && blockedAsk.status === 400, 'a house player you blocked is nobody to you',
      `${behind.status} ${blockedAsk.status}`);

    // Asked again and kept, for the restart below.
    await post(S, '/api/friends', { token: ASHA.token, code: houseCode });
    const kept = await until(() => {
      try {
        const saved = JSON.parse(fs.readFileSync(path.join(dir, 'social.json'), 'utf8'));
        const asha = saved.profiles.find((p) => p.token === ASHA.token);
        return asha?.botWants?.some((w) => w.code === houseCode && w.name === houseName && typeof w.at === 'number');
      } catch { return false; }
    }, 6000, 100);
    PASS(!!kept, 'the request is written down with Asha\'s profile');
  }

  section('the twenty seconds pass');
  {
    const text = 'Asha invited you to a game — tap to join';
    await sleep(Math.max(0, firstRang + 20500 - Date.now()));
    const r = await post(S, '/api/invite', { token: ASHA.token, code: BILAL.code, roomId });
    PASS(r.json?.ok === true && !r.json.throttled, 'Asha invites Bilal to her real table: not throttled now', r.text);
    PASS(!!await until(() => pushed(S, text) === 2), 'and his phone rings again', `${pushed(S, text)} push(es)`);
    const banner = (await get(S, `/api/invite?token=${BILAL.token}`)).json?.invite;
    PASS(banner?.roomId === roomId, 'for the table she is at', short(banner));
  }

  section('after a restart');
  {
    for (const s of sockets) s.close();
    await stop(S.child);
    S = await startServer('second', dir);
    const asked = await profile(S, houseCode, ASHA);
    PASS(asked.status === 200 && asked.json?.name === houseName && asked.json.relation === 'sent',
      'Asha, who asked it, still gets the bot\'s card — name and all', asked.text.slice(0, 120));
    const same = ['wins', 'games', 'winnings', 'since', 'titles'].every((k) => isDeepStrictEqual(asked.json?.[k], houseCard?.[k]));
    PASS(same, 'with the very numbers it showed before', `${asked.json?.wins}/${asked.json?.games}`);
    const other = await profile(S, houseCode, DEV);
    PASS(other.status === 404, 'anyone else is told there is nobody by that code now', other.text);
    const social = (await get(S, `/api/social?token=${ASHA.token}`)).json;
    PASS(social?.sent?.some((s) => s.code === houseCode && s.name === houseName), 'and Social still shows it as sent');
    PASS(!social?.friends?.some((f) => f.code === houseCode), 'still never a friend');
  }
}

let crashed = null;
try {
  await main();
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
