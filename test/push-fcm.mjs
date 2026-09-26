// Android pushes, end to end, against a stand-in for Google.
//
// An Android phone hears about its turn through Firebase Cloud Messaging, and
// that is a promise made across three parties — the app, this server, and
// Google — so it is tested the way apple-revoke.mjs tests Sign in with Apple:
// the real server, started as a process, talking over HTTP to a fake Google
// that checks what the real one would check. Its token endpoint verifies the
// server's RS256 assertion against the service account's public key; its
// messages:send refuses a bearer it never issued, and a message with a field
// FCM does not have. A fake APNs sits beside it, so the one test also holds
// Apple's half to the request it has always made.
//
// Every push is set off by the real thing that sends it: an owner's note, an
// invite between friends, a turn coming round to somebody who has walked away
// from the table, a cup table opening and a cup's draw. Then the parts that
// only show when Google misbehaves: one sign-in for many sends, a fresh one on
// a 401, one retry and no more for a 503, none for a spent quota, phones
// Google has forgotten dropped (and a phone it merely complained about kept),
// and the register reply saying honestly whether anything will arrive — which
// a refused sign-in and a project Google will not send for both take back.
//
// The keys are made fresh on every run — an RSA pair for the service account,
// a P-256 pair for APNs — and nothing here needs the network or a Google
// account.
//
//   node test/push-fcm.mjs
//
// Temporary data dirs go under os.tmpdir() (set TMPDIR to move them) and are
// removed afterwards; every process started is stopped, pass or fail.

import crypto from 'node:crypto';
import http from 'node:http';
import http2 from 'node:http2';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { io } from 'socket.io-client';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = 'push-test-admin';
const PROJECT = 'mm-push-test';
const SA_EMAIL = `push-sender@${PROJECT}.iam.gserviceaccount.com`;
const SA_KID = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const APNS_KID = 'TESTAPNS01';
const APNS_TEAM = 'TESTTEAM01';
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

// ------------------------------------------------------------------- keys --
const saPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const apnsPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const saPem = saPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const apnsPem = apnsPair.privateKey.export({ type: 'pkcs8', format: 'pem' });

/** A service account shaped exactly like the one Firebase's console downloads. */
const account = (extra = {}) => ({
  type: 'service_account',
  project_id: PROJECT,
  private_key_id: SA_KID,
  private_key: saPem,
  client_email: SA_EMAIL,
  client_id: '109876543210987654321',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/push-sender%40${PROJECT}.iam.gserviceaccount.com`,
  universe_domain: 'googleapis.com',
  ...extra,
});

/** Every run of the key's base64, for the leak scan. */
const keyLines = saPem.split('\n').filter((l) => l.length >= 48 && !l.startsWith('-----'));

// ------------------------------------------------------------- fake Google --
const mock = {
  exchanges: [],         // { at, problem, token }
  live: new Set(),       // access tokens it will accept
  issued: 0,
  expiresIn: 3600,
  refuseSignIn: false,   // answer the next trades 400 invalid_grant
  sends: [],             // { at, path, auth, type, body, token, status }
  faults: [],            // { device, marker, status, code, message, retryAfter } — each used once
  dead: new Set(),       // tokens FCM answers 404 UNREGISTERED
  invalid: new Set(),    // tokens FCM calls not a registration token
  malformed: new Set(),  // tokens whose messages FCM rejects for some other field
};
let TOKEN_URL = '';

const readBody = (req) => new Promise((resolve) => {
  let s = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { s += c; });
  req.on('end', () => resolve(s));
});
const googleError = (code, status, message, errorCode, fieldViolations) => ({
  error: {
    code, message, status,
    details: [
      ...(errorCode ? [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }] : []),
      ...(fieldViolations ? [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations }] : []),
    ],
  },
});

/** What Google's token endpoint would object to in an assertion, or ''. */
function assertionProblem(form) {
  if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return 'grant_type';
  const parts = String(form.get('assertion') || '').split('.');
  if (parts.length !== 3) return 'shape';
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
  } catch { return 'unreadable'; }
  if (header.alg !== 'RS256') return 'alg';
  if (header.typ !== 'JWT') return 'typ';
  if (header.kid !== SA_KID) return 'kid';
  const ok = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), saPair.publicKey,
    Buffer.from(parts[2], 'base64url'));
  if (!ok) return 'signature';
  if (claims.iss !== SA_EMAIL) return 'iss';
  if (claims.scope !== SCOPE) return 'scope';
  if (claims.aud !== TOKEN_URL) return `aud ${claims.aud}`;
  const t = Math.floor(Date.now() / 1000);
  if (typeof claims.iat !== 'number' || Math.abs(claims.iat - t) > 60) return 'iat';
  if (claims.exp !== claims.iat + 3600) return 'exp';
  return '';
}

// The fields FCM v1 knows. It answers 400 to anything else, so a typo in a
// field name is a message that never arrives — caught here, not on a phone.
const KNOWN = {
  message: ['name', 'token', 'topic', 'condition', 'data', 'notification', 'android', 'webpush', 'apns', 'fcm_options'],
  notification: ['title', 'body', 'image'],
  android: ['collapse_key', 'priority', 'ttl', 'restricted_package_name', 'data', 'notification', 'fcm_options', 'direct_boot_ok'],
  androidNotification: ['title', 'body', 'icon', 'color', 'sound', 'tag', 'click_action', 'body_loc_key', 'body_loc_args',
    'title_loc_key', 'title_loc_args', 'channel_id', 'ticker', 'sticky', 'event_time', 'local_only',
    'notification_priority', 'default_sound', 'default_vibrate_timings', 'default_light_settings',
    'vibrate_timings', 'visibility', 'notification_count', 'light_settings', 'image'],
};
function messageProblem(m) {
  const stray = (o, allowed) => Object.keys(o || {}).find((k) => !allowed.includes(k));
  if (!m || typeof m !== 'object') return 'no message';
  if (typeof m.token !== 'string' || !m.token) return 'message.token';
  let s = stray(m, KNOWN.message) || stray(m.notification, KNOWN.notification)
    || stray(m.android, KNOWN.android) || stray(m.android?.notification, KNOWN.androidNotification);
  if (s) return `Unknown name "${s}"`;
  s = Object.entries(m.data || {}).find(([, v]) => typeof v !== 'string');
  if (s) return `message.data.${s[0]} is not a string`;
  if (m.android?.priority && !['high', 'normal', 'HIGH', 'NORMAL'].includes(m.android.priority)) return 'android.priority';
  if (m.android?.ttl && !/^\d+(\.\d+)?s$/.test(m.android.ttl)) return 'android.ttl';
  return '';
}

const google = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock');
  const raw = await readBody(req);
  const answer = (status, obj, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=UTF-8', ...headers });
    res.end(JSON.stringify(obj));
    return status;
  };

  if (req.method === 'POST' && url.pathname === '/token') {
    const problem = assertionProblem(new URLSearchParams(raw));
    const entry = { at: Date.now(), problem, token: '' };
    mock.exchanges.push(entry);
    if (problem) return answer(400, { error: 'invalid_grant', error_description: `Invalid JWT: ${problem}` });
    if (mock.refuseSignIn) return answer(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
    entry.token = `ya29.mock-${++mock.issued}`;
    mock.live.add(entry.token);
    return answer(200, { access_token: entry.token, expires_in: mock.expiresIn, token_type: 'Bearer' });
  }

  const sendPath = /^\/v1\/projects\/([^/]+)\/messages:send$/.exec(url.pathname);
  if (req.method === 'POST' && sendPath) {
    let body = null;
    try { body = JSON.parse(raw); } catch { /* checked below */ }
    const msg = body?.message || {};
    const auth = String(req.headers.authorization || '');
    const entry = {
      at: Date.now(), path: url.pathname, auth, type: req.headers['content-type'], body, token: msg.token, status: 0,
    };
    mock.sends.push(entry);
    const reply = (status, obj, headers) => { entry.status = status; return answer(status, obj, headers); };
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!mock.live.has(bearer)) {
      return reply(401, googleError(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.'));
    }
    if (sendPath[1] !== PROJECT) return reply(404, googleError(404, 'NOT_FOUND', 'Requested entity was not found.'));
    const problem = messageProblem(msg);
    if (problem) return reply(400, googleError(400, 'INVALID_ARGUMENT', problem, 'INVALID_ARGUMENT'));

    const f = mock.faults.findIndex((x) => x.device === msg.token
      && String(msg.notification?.body || '').includes(x.marker));
    if (f >= 0) {
      const fault = mock.faults.splice(f, 1)[0];
      if (fault.status === 401) mock.live.delete(bearer);   // Google stopped taking that token
      return reply(fault.status, googleError(fault.status, fault.code, fault.message, fault.errorCode),
        fault.retryAfter != null ? { 'retry-after': fault.retryAfter } : {});
    }
    if (mock.dead.has(msg.token)) {
      return reply(404, googleError(404, 'NOT_FOUND', 'Requested entity was not found.', 'UNREGISTERED'));
    }
    if (mock.invalid.has(msg.token)) {
      return reply(400, googleError(400, 'INVALID_ARGUMENT',
        'The registration token is not a valid FCM registration token', 'INVALID_ARGUMENT'));
    }
    if (mock.malformed.has(msg.token)) {
      return reply(400, googleError(400, 'INVALID_ARGUMENT', "Invalid value at 'message.android.notification.color'",
        'INVALID_ARGUMENT', [{ field: 'message.android.notification.color', description: 'Invalid color' }]));
    }
    return reply(200, { name: `projects/${PROJECT}/messages/0:${mock.sends.length}` });
  }
  answer(404, { error: 'not_found' });
});

// --------------------------------------------------------------- fake APNs --
const apnsSeen = [];
const apns = http2.createServer();
apns.on('stream', (stream, headers) => {
  let body = '';
  stream.setEncoding('utf8');
  stream.on('data', (c) => { body += c; });
  stream.on('end', () => {
    let json = null;
    try { json = JSON.parse(body); } catch { /* recorded as null */ }
    apnsSeen.push({ headers, body: json });
    stream.respond({ ':status': 200 });
    stream.end();
  });
});

/** Apple's provider token, checked the way Apple checks it. */
function apnsJwtProblem(authorization) {
  const m = /^bearer (.+)$/.exec(String(authorization || ''));
  if (!m) return 'scheme';
  const [h, c, s] = m[1].split('.');
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url'));
    claims = JSON.parse(Buffer.from(c, 'base64url'));
  } catch { return 'unreadable'; }
  if (header.alg !== 'ES256' || header.kid !== APNS_KID) return 'header';
  if (claims.iss !== APNS_TEAM || typeof claims.iat !== 'number') return 'claims';
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`),
    { key: apnsPair.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  return ok ? '' : 'signature';
}

// ----------------------------------------------------------------- server --
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-push-fcm-'));
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

async function startServer(name, env, { seed } = {}, attempt = 1) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(tmpRoot, `${name}-`));
  if (seed) fs.writeFileSync(path.join(dir, 'social.json'), JSON.stringify({ profiles: seed }));
  const base = { ...process.env };
  // Nothing inherited may decide which senders are on, or where they point.
  for (const k of Object.keys(base)) {
    if (/^(APPLE_|GOOGLE_|APNS_|STRIPE_|FCM_|PLAY_)/.test(k)) delete base[k];
  }
  delete base.RENDER;
  delete base.NODE_ENV;
  delete base.MONEYMOVE_TEST_HOOKS;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...base,
      PORT: String(port),
      DATA_DIR: dir,
      ADMIN_KEY: ADMIN,
      FCM_TEST_BASE: `http://127.0.0.1:${google.address().port}`,
      FCM_TEST_TOKEN_URI: TOKEN_URL,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const srv = { name, url: `http://127.0.0.1:${port}`, dir, child, log: '', err: '' };
  child.stdout.on('data', (d) => { srv.log += d; });
  child.stderr.on('data', (d) => { srv.log += d; srv.err += d; });
  children.push(child);
  const up = await until(async () => {
    if (child.exitCode != null) return true;
    try { return (await fetch(`${srv.url}/healthz`)).ok; } catch { return false; }
  }, 20000, 100);
  if (!up || child.exitCode != null) {
    // A port found free can be handed to somebody's outgoing connection
    // before the server binds it — this file makes plenty. Another port, then.
    if (/EADDRINUSE/.test(srv.log) && attempt < 4) return startServer(name, env, { seed }, attempt + 1);
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
const post = (srv, p, body) => call(srv, 'POST', p, body);
const register = (srv, who, deviceToken, platform) => post(srv, '/api/push/register', { token: who.token, deviceToken, platform });
const note = (srv, who, text, title = '') => post(srv, '/api/admin/notice', { key: ADMIN, code: who.code, text, title });
const bootLine = (srv) => (srv.log.match(/^push: fcm .*$/m) || [''])[0];

// ------------------------------------------------------------- the people --
const hex = (n) => crypto.randomBytes(n).toString('hex');
const CODES = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => `PF${[...crypto.randomBytes(4)].map((b) => CODES[b % 32]).join('')}`;
const ASHA = { name: 'Asha', token: `dev-asha-${hex(6)}`, code: code() };     // on the web: no phone
const BILAL = { name: 'Bilal', token: `dev-bilal-${hex(6)}`, code: code() };  // an Android phone and an iPhone
function seedFriends() {
  const at = Date.now();
  return [ASHA, BILAL].map((p, i) => ({
    token: p.token, code: p.code, name: p.name, flag: '', seen: at, created: at,
    friends: [(i ? ASHA : BILAL).code],
    // Signed in, as a cup needs; written the shape a Google sign-in leaves.
    login: { provider: 'google', subject: `google-${p.name}`, at },
  }));
}
const phone = (tag) => `${tag}:APA91b${hex(60)}`;    // the shape of an FCM registration token
const iphone = () => hex(32);                         // and of an APNs device token

const sendsTo = (device) => mock.sends.filter((s) => s.token === device);
const lastTo = (device, pred = () => true) => sendsTo(device).filter(pred).at(-1);
const withText = (marker) => (s) => String(s.body?.message?.notification?.body || '').includes(marker);
const apnsTo = (device) => apnsSeen.filter((a) => a.headers[':path'] === `/3/device/${device}`);

/** The message FCM should be handed for one push, less nothing. */
function expected(device, body, { kind, collapseId, channel, roomId, cupId }) {
  return {
    message: {
      token: device,
      notification: { title: 'MoneyMove', body },
      data: { kind, collapseId, ...(roomId ? { roomId } : {}), ...(cupId ? { cupId } : {}) },
      android: {
        priority: 'high',
        collapse_key: collapseId,
        ttl: '86400s',
        notification: {
          channel_id: channel, tag: collapseId, sound: 'default',
          ...(kind === 'cup' ? { icon: 'ic_stat_cup' } : {}),
        },
      },
    },
  };
}
/** The one line per push that says whether FCM got exactly what it should. */
function checkMessage(label, sent, device, body, want) {
  const exp = expected(device, body, want);
  const got = sent?.body;
  return PASS(!!sent && sent.status === 200 && isDeepStrictEqual(got, exp)
    && sent.path === `/v1/projects/${PROJECT}/messages:send` && /^application\/json/.test(sent.type || ''),
  label, sent ? (isDeepStrictEqual(got, exp) ? `${sent.status} ${sent.path}` : `got ${short(got)}\n        want ${short(exp)}`) : 'nothing arrived');
}
/** Apple's request, held to exactly what it has always been. */
function checkApns(label, got, body, collapseId) {
  const h = got?.headers || {};
  const want = { aps: { alert: { title: 'MoneyMove', body }, sound: 'default', 'interruption-level': 'active' } };
  const wrong = [
    h[':method'] !== 'POST' && 'method',
    h['apns-topic'] !== 'com.moneymove.game' && 'topic',
    h['apns-push-type'] !== 'alert' && 'push-type',
    h['apns-priority'] !== '10' && 'priority',
    h['apns-collapse-id'] !== collapseId && `collapse-id ${h['apns-collapse-id']}`,
    h['content-type'] !== 'application/json' && 'content-type',
    apnsJwtProblem(h.authorization),
    !isDeepStrictEqual(got?.body, want) && `body ${short(got?.body)}`,
  ].filter(Boolean);
  return PASS(!!got && !wrong.length, label, got ? wrong.join(', ') : 'nothing arrived');
}

// ------------------------------------------------------------- the table --
function seat(srv, who) {
  const sock = io(srv.url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(sock);
  const chair = { sock, who, state: null, seq: 0, toasts: [] };
  sock.on('state', (s) => { chair.state = s; chair.seq++; });
  sock.on('toast', (t) => chair.toasts.push(t?.message));
  chair.emit = (...a) => sock.emit(...a);
  chair.mine = () => chair.state?.status === 'playing' && chair.state.turn?.playerId === who.token;
  return chair;
}

/**
 * Play this chair's turn to its end, the plainest way there is: roll, buy
 * whatever is landed on, and hand the dice on. Doubles, cards and tax all
 * come round through the same few phases.
 */
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

// ---------------------------------------------------------------- scenarios --
async function main() {
  await new Promise((r) => google.listen(0, '127.0.0.1', r));
  await new Promise((r) => apns.listen(0, '127.0.0.1', r));
  TOKEN_URL = `http://127.0.0.1:${google.address().port}/token`;

  // The account as a dashboard's text box tends to hand it over: wrapped in
  // quotes, padded, and its key's line breaks escaped once too often.
  const damaged = `  '${JSON.stringify(account()).replace(/\\n/g, '\\\\n')}'  \n`;
  const S = await startServer('keyed', {
    FCM_SERVICE_ACCOUNT: damaged,
    APNS_KEY: apnsPem.replace(/\n/g, '\\n'),
    APNS_KEY_ID: APNS_KID,
    APNS_TEAM_ID: APNS_TEAM,
    APNS_HOST: `http://127.0.0.1:${apns.address().port}`,
  }, { seed: seedFriends() });

  section('boot');
  PASS(bootLine(S) === `push: fcm on (project ${PROJECT}, test endpoints)`, 'one line says FCM is on, and for which project',
    bootLine(S));
  PASS(mock.exchanges.length === 0, 'and nobody signs in to Google until there is something to send');

  section('registering says whether anything will arrive');
  const B1 = phone('b1');
  const BI = iphone();
  {
    const r = await register(S, BILAL, B1, 'android');
    PASS(r.status === 200 && isDeepStrictEqual(r.json, { ok: true, devices: 1, sends: true }),
      'an Android phone: {ok, devices, sends: true}', r.text);
    const i = await register(S, BILAL, BI, 'ios');
    PASS(i.status === 200 && isDeepStrictEqual(i.json, { ok: true, devices: 2, sends: true }),
      'an iPhone: the same reply the shipped app reads, plus sends', i.text);
    const w = await register(S, BILAL, 'x', 'web');
    PASS(w.status === 400 && w.json?.error === 'Unknown platform' && !('sends' in (w.json || {})),
      'an unknown platform is still refused, and told nothing about sending', w.text);
  }

  section('a note from the owner');
  {
    const r = await note(S, BILAL, 'Round two is at ten', 'Cup night');
    PASS(r.json?.ok === true, 'the owner writes to Bilal', r.text.slice(0, 80));
    const body = 'Cup night — Round two is at ten';
    const sent = await until(() => lastTo(B1, withText('Round two')));
    const ex = mock.exchanges[0];
    PASS(mock.exchanges.length === 1 && ex?.problem === '' && ex.token === 'ya29.mock-1',
      'the server signed in once, with an assertion Google accepts (RS256, kid, iss, scope, aud, iat, exp — signature checked)',
      short(mock.exchanges));
    PASS(sent?.auth === 'Bearer ya29.mock-1', 'and sent with the access token it was given', sent?.auth);
    checkMessage('FCM gets kind notice, on the social channel, collapsed under "notice"', sent, B1, body,
      { kind: 'notice', collapseId: 'notice', channel: 'social' });
    checkApns('the iPhone gets exactly the APNs request it always has', await until(() => apnsTo(BI).at(-1)), body, 'notice');
  }

  section('an invite between friends');
  {
    const r = await post(S, '/api/invite', { token: ASHA.token, code: BILAL.code, roomId: 'tbl42' });
    PASS(r.json?.ok === true, 'Asha asks Bilal to her table', r.text.slice(0, 80));
    const body = 'You have been invited to a game on MoneyMove';
    checkMessage('FCM gets kind invite with the table to open, on the social channel', await until(() => lastTo(B1, withText('invited'))),
      B1, body, { kind: 'invite', collapseId: 'invite', channel: 'social', roomId: 'tbl42' });
    checkApns('APNs gets the invite as it always has', await until(() => apnsTo(BI).find((a) => a.headers['apns-collapse-id'] === 'invite')),
      body, 'invite');
  }

  section('a turn comes round to somebody who has walked away');
  let roomId = '';
  {
    const a = seat(S, ASHA);
    const b = seat(S, BILAL);
    ({ roomId } = await new Promise((r) => a.sock.emit('createRoom', { token: ASHA.token }, r)));
    a.emit('join', { roomId, token: ASHA.token, name: ASHA.name });
    await until(() => a.state?.players?.length === 1);
    b.emit('join', { roomId, token: BILAL.token, name: BILAL.name });
    await until(() => a.state?.players?.length === 2 && b.state);
    a.emit('settings', { randomizeOrder: false });
    await sleep(50);
    a.emit('start');
    const playing = await until(() => a.state?.status === 'playing' && b.state?.status === 'playing');
    if (!PASS(!!playing, 'Asha and Bilal sit down and the game starts', `${a.state?.status} ${a.toasts.join('; ')}`)) {
      throw new Error('the table never started');
    }
    // Whoever the dice start with, Bilal has to be gone by the time they reach him.
    if (b.mine()) await playTurn(b);
    await until(() => a.mine(), 3000);
    const early = sendsTo(B1).filter((s) => s.body?.message?.data?.kind === 'turn').length;
    PASS(early === 0, 'nobody is told about a turn while they are looking at the board', `${early} sent`);
    b.sock.disconnect();
    await until(() => a.state?.players?.some((p) => p.name === BILAL.name && p.connected === false), 2000);
    const handed = await playTurn(a);
    PASS(handed, 'Asha plays her turn and hands the dice on', a.toasts.slice(-3).join('; '));
    const sent = await until(() => lastTo(B1, (s) => s.body?.message?.data?.kind === 'turn'), 5000);
    const body = sent?.body?.message?.notification?.body || '';
    PASS(body.startsWith('Your turn in ') && body.endsWith(`— room ${roomId}`), 'the turn is Bilal\'s, and he hears it', body);
    checkMessage('FCM gets kind turn, the room, on the turns channel, collapsed per table', sent, B1, body,
      { kind: 'turn', collapseId: roomId, channel: 'turns', roomId });
    checkApns('APNs gets the turn collapsed per table, as before',
      await until(() => apnsTo(BI).find((x) => x.headers['apns-collapse-id'] === roomId)), body, roomId);
    // Asha stays seated and does nothing; her ninety-second clock outlasts this test.
  }

  section('the cup');
  {
    const desk = (body) => post(S, '/api/admin/cup', { key: ADMIN, ...body });
    await desk({ action: 'enable', enabled: true });
    const cupId = (await desk({ action: 'open', name: 'Push Cup', joinSeconds: 600 })).json?.cup?.id;
    for (const p of [ASHA, BILAL]) {
      const j = await post(S, '/api/cup/join', { token: p.token, cupId });
      if (!j.json?.ok) PASS(false, `${p.name} joins the cup`, j.text);
    }
    const closed = await desk({ action: 'close', cupId });
    PASS(closed.json?.ok === true && !!cupId, 'two players, one cup, the door shut by hand', closed.text.slice(0, 80));
    const open = await until(() => lastTo(B1, withText('Your cup match is open')));
    const table = open?.body?.message?.data?.roomId || '';
    checkMessage('the table is open: kind cup, the room, on the cup channel', open, B1,
      'Your cup match is open — go and play it now',
      { kind: 'cup', collapseId: `cup:${table}`, channel: 'cup', roomId: table });
    PASS(/^[a-z0-9]{5}$/.test(table) && table !== roomId, 'and the room is the cup table the server just built', table);
    // The calendar's reminders go out on the cup's own tick; a test run may
    // wind that clock, and winding it by nothing runs the tick now.
    await desk({ action: 'wind', minutes: 0 });
    const drawn = await until(() => lastTo(B1, withText('The draw is out')));
    checkMessage('the draw: kind cup, the cup to open, on the cup channel', drawn, B1,
      drawn?.body?.message?.notification?.body || '(none)',
      { kind: 'cup', collapseId: `cup:${cupId}:r0:draw`, channel: 'cup', cupId });
    checkApns('and APNs hears the draw under the same collapse id', await until(() => apnsTo(BI)
      .find((x) => x.headers['apns-collapse-id'] === `cup:${cupId}:r0:draw`)),
    drawn?.body?.message?.notification?.body, `cup:${cupId}:r0:draw`);
  }

  section('one sign-in, many sends');
  {
    const ok = mock.sends.filter((s) => s.status === 200);
    PASS(mock.exchanges.length === 1 && ok.length >= 5 && ok.every((s) => s.auth === 'Bearer ya29.mock-1'),
      'five pushes and more, one trade for an access token', `${mock.exchanges.length} trade(s), ${ok.length} sends`);
  }

  section('a 401 buys one fresh sign-in and one retry');
  {
    // The next token lives 62 seconds, so the server may keep it for two:
    // it lets go a minute before Google says it lapses.
    mock.expiresIn = 62;
    mock.faults.push({ device: B1, marker: 'stale-token', status: 401, code: 'UNAUTHENTICATED', message: 'Request had invalid authentication credentials.' });
    await note(S, BILAL, 'A stale-token check');
    const done = await until(() => lastTo(B1, (s) => withText('stale-token')(s) && s.status === 200));
    const tries = sendsTo(B1).filter(withText('stale-token'));
    PASS(!!done && tries.length === 2 && tries[0].status === 401 && tries[1].auth === 'Bearer ya29.mock-2'
      && mock.exchanges.length === 2 && mock.exchanges[1].problem === '',
    'refused once, signed in again, delivered on the retry', tries.map((t) => `${t.status} ${t.auth.slice(7)}`).join(', '));
    mock.expiresIn = 3600;
  }

  section('phones Google has forgotten are dropped, and only those');
  const DEAD = phone('dead');
  const BAD = phone('bad');
  const ODD = phone('odd');
  {
    mock.dead.add(DEAD);
    mock.invalid.add(BAD);
    mock.malformed.add(ODD);
    for (const d of [DEAD, BAD, ODD]) await register(S, BILAL, d, 'android');
    // Past the short-lived token's life: four sends at once all need a new one.
    await until(() => Date.now() - mock.exchanges[1].at > 2300, 4000);
    await note(S, BILAL, 'A pruning check');
    await until(() => [B1, DEAD, BAD, ODD].every((d) => sendsTo(d).some(withText('pruning'))));
    PASS(mock.exchanges.length === 3 && [B1, DEAD, BAD, ODD].every((d) => lastTo(d)?.auth === 'Bearer ya29.mock-3'),
      'a token near its end is traded early, once, for four sends waiting on it together',
      `${mock.exchanges.length} trades; ${[B1, DEAD, BAD, ODD].map((d) => lastTo(d)?.auth.slice(7)).join(', ')}`);
    await until(() => (S.log.match(/dropped a device Google has forgotten/g) || []).length >= 2);
    const again = await register(S, BILAL, B1, 'android');
    PASS(again.json?.devices === 3, 'UNREGISTERED and "not a valid registration token" are dropped; the rest stay',
      `${again.json?.devices} devices (want B1, the iPhone, and the one with a bad message)`);
    PASS(/dropped a device Google has forgotten \(UNREGISTERED\)/.test(S.log)
      && /dropped a device Google has forgotten \(INVALID_ARGUMENT\)/.test(S.log),
    'and the log says which way each one went');
    await note(S, BILAL, 'A second pruning check');
    await until(() => sendsTo(ODD).some(withText('second pruning')));
    await sleep(200);
    PASS(sendsTo(DEAD).length === 1 && sendsTo(BAD).length === 1 && sendsTo(ODD).length === 2,
      'nothing is sent to a dropped phone again; a 400 about the message is not a dead phone',
      `dead ${sendsTo(DEAD).length}, bad ${sendsTo(BAD).length}, odd ${sendsTo(ODD).length}`);
  }

  section('a busy Google gets one retry, never a storm');
  {
    mock.faults.push({ device: B1, marker: 'busy-once', status: 503, code: 'UNAVAILABLE', message: 'The service is currently unavailable.', retryAfter: '1' });
    await note(S, BILAL, 'A busy-once check');
    await until(() => lastTo(B1, (s) => withText('busy-once')(s) && s.status === 200), 5000);
    const once = sendsTo(B1).filter(withText('busy-once'));
    PASS(once.length === 2 && once[0].status === 503 && once[1].status === 200 && once[1].at - once[0].at >= 900,
      'a 503 is tried once more, after the second Google asked for, and lands',
      once.map((t) => t.status).join(', ') + (once[1] ? ` after ${once[1].at - once[0].at}ms` : ''));

    for (let i = 0; i < 3; i++) {
      mock.faults.push({ device: B1, marker: 'busy-always', status: 500, code: 'INTERNAL', message: 'Internal error.', retryAfter: '0' });
    }
    await note(S, BILAL, 'A busy-always check');
    await until(() => sendsTo(B1).filter(withText('busy-always')).length >= 2);
    await sleep(500);
    const storm = sendsTo(B1).filter(withText('busy-always'));
    PASS(storm.length === 2 && /push: fcm 500 INTERNAL/.test(S.log),
      'a Google that keeps failing gets two tries in all, then a line in the log', `${storm.length} tries`);
    mock.faults = mock.faults.filter((f) => f.marker !== 'busy-always');

    mock.faults.push({ device: B1, marker: 'quota', status: 429, code: 'QUOTA_EXCEEDED', message: 'Quota exceeded.', retryAfter: '120' });
    await note(S, BILAL, 'A quota check');
    await until(() => sendsTo(B1).some(withText('quota')));
    await sleep(400);
    PASS(sendsTo(B1).filter(withText('quota')).length === 1 && /push: fcm 429 QUOTA_EXCEEDED/.test(S.log),
      'a spent quota asking for two minutes is not retried at all', `${sendsTo(B1).filter(withText('quota')).length} tries`);
  }

  section('a project Google will not send for stops promising, until a send gets through');
  {
    // Signed in, then refused at the send: the shape Google answers with when
    // the FCM API is switched off in the project. A good sign-in proves
    // nothing about this, so only the sends can say it.
    mock.faults.push({ device: B1, marker: 'api-off', status: 403, code: 'PERMISSION_DENIED',
      message: 'Firebase Cloud Messaging API has not been used in project 968669711294 before or it is disabled.' });
    await note(S, BILAL, 'An api-off check');
    await until(() => /push: fcm 403 PERMISSION_DENIED/.test(S.log));
    const off = await register(S, BILAL, B1, 'android');
    PASS(off.json?.sends === false, 'Android is told nothing will arrive, so it keeps its own cup alarms',
      `sends ${off.json?.sends}`);
    await note(S, BILAL, 'An api-back check');
    await until(() => lastTo(B1, (s) => withText('api-back')(s) && s.status === 200));
    const back = await register(S, BILAL, B1, 'android');
    PASS(back.json?.sends === true, 'and the first send that gets through takes that back', `sends ${back.json?.sends}`);

    // One phone minted for some other Firebase project is that phone's
    // problem, not the project's.
    mock.faults.push({ device: B1, marker: 'mismatch', status: 403, code: 'PERMISSION_DENIED',
      message: 'SenderId mismatch', errorCode: 'SENDER_ID_MISMATCH' });
    await note(S, BILAL, 'A mismatch check');
    await until(() => /push: fcm 403 SENDER_ID_MISMATCH/.test(S.log));
    const one = await register(S, BILAL, B1, 'android');
    PASS(one.json?.sends === true, 'a SENDER_ID_MISMATCH on one phone does not stop the promise to the rest',
      `sends ${one.json?.sends}`);
  }

  section('a turned-down account stops promising');
  {
    mock.refuseSignIn = true;
    mock.faults.push({ device: B1, marker: 'refused', status: 401, code: 'UNAUTHENTICATED', message: 'Request had invalid authentication credentials.' });
    const trades = mock.exchanges.length;
    await note(S, BILAL, 'A refused check');
    await until(() => /push: fcm sign-in failed \(400 invalid_grant\)/.test(S.log));
    await sleep(200);
    PASS(mock.exchanges.length === trades + 1 && sendsTo(B1).filter(withText('refused')).length === 1,
      'the new sign-in is refused, and the message is given up rather than sent without one',
      `${mock.exchanges.length - trades} trade(s), ${sendsTo(B1).filter(withText('refused')).length} send(s)`);
    const r = await register(S, BILAL, B1, 'android');
    const i = await register(S, BILAL, BI, 'ios');
    PASS(r.json?.sends === false && i.json?.sends === true,
      'Android is now told nothing will arrive (so it keeps its own cup alarms); iOS is not affected',
      `android ${r.json?.sends}, ios ${i.json?.sends}`);
    const before = mock.exchanges.length;
    await note(S, BILAL, 'A quiet check');
    await sleep(300);
    PASS(mock.exchanges.length === before, 'and Google is not asked again on every push while it is saying no',
      `${mock.exchanges.length - before} more trade(s)`);
    mock.refuseSignIn = false;
  }

  section('nothing secret reaches the log');
  {
    const leaked = keyLines.filter((l) => S.log.includes(l.slice(8, 48)));
    PASS(!leaked.length && !/PRIVATE KEY/.test(S.log), 'no part of the private key', `${leaked.length} line(s)`);
    PASS(!/ya29\./.test(S.log), 'no access token');
    PASS(![B1, DEAD, BAD, ODD, BI].some((d) => S.log.includes(d)), 'no device token');
    // "push: fcm — …" is the catch-all sendTurnPush and sendToGoogle log a
    // thrown error under, by its message alone — which never says TypeError,
    // so without it here a bug in the sender would pass as a quiet run.
    const crash = /Unhandled|TypeError|ReferenceError|^\s+at\s|^push: fcm — /m;
    PASS(!crash.test(S.log), 'no exceptions', (S.log.match(new RegExp(`.*(${crash.source}).*`, 'm')) || [''])[0].slice(0, 120));
  }
  await stop(S.child);

  section('with no service account, nothing is sent and nothing is promised');
  {
    const trades = mock.exchanges.length;
    const sends = mock.sends.length;
    const N = await startServer('bare', {}, { seed: seedFriends() });
    PASS(bootLine(N) === 'push: fcm off — no service account', 'one quiet line at boot', bootLine(N));
    PASS(!/fcm/.test(N.err), 'and no warning about it', N.err.split('\n').find((l) => /fcm/.test(l)) || '');
    const r = await register(N, BILAL, phone('bare'), 'android');
    const i = await register(N, BILAL, iphone(), 'ios');
    PASS(r.json?.ok === true && r.json.sends === false && i.json?.sends === false,
      'both platforms are told sends: false', `${r.text} ${i.text}`);
    await note(N, BILAL, 'Nobody will hear this');
    const dark = await until(() => /push \(dark, android\): would send "Nobody will hear this" to 1 device\(s\)/.test(N.log)
      && /push \(dark\): would send "Nobody will hear this" to 1 device\(s\)/.test(N.log));
    PASS(!!dark, 'the log says what each would have sent — the iPhone\'s line exactly as before, counting only iPhones');
    await sleep(300);
    PASS(mock.exchanges.length === trades && mock.sends.length === sends, 'and Google is never called',
      `${mock.exchanges.length - trades} trade(s), ${mock.sends.length - sends} send(s)`);
    await stop(N.child);
  }

  section('the other ways an account arrives, and the ways it goes wrong');
  {
    const file = path.join(tmpRoot, 'firebase-sa.json');
    fs.writeFileSync(file, JSON.stringify(account(), null, 2));
    // The key's \n escapes pasted as real line breaks: not JSON any more.
    const broken = JSON.stringify(account(), null, 2).replace(/\\n/g, '\n');
    const truncated = JSON.stringify(account({ private_key: saPem.slice(0, 400) }));
    const phoneHalf = JSON.stringify({ project_info: { project_number: '968669711294', project_id: PROJECT }, client: [] });
    const [F, R, B64, BR, T, G] = await Promise.all([
      startServer('file', { FCM_SERVICE_ACCOUNT: file }),
      startServer('render', { FCM_SERVICE_ACCOUNT: file, RENDER: 'true' }),
      startServer('base64', { FCM_SERVICE_ACCOUNT: Buffer.from(JSON.stringify(account())).toString('base64') }),
      startServer('linebreaks', { FCM_SERVICE_ACCOUNT: broken }),
      startServer('truncated', { FCM_SERVICE_ACCOUNT: truncated }),
      startServer('phonehalf', { FCM_SERVICE_ACCOUNT: phoneHalf }),
    ]);
    PASS(bootLine(F) === `push: fcm on (project ${PROJECT}, test endpoints)`, 'a path to the file', bootLine(F));
    PASS(bootLine(R) === `push: fcm on (project ${PROJECT})`,
      'on Render the test addresses are ignored — Google\'s own are used', bootLine(R));
    PASS(bootLine(B64) === `push: fcm on (project ${PROJECT}, test endpoints)`, 'the JSON as base64', bootLine(B64));
    PASS(bootLine(BR) === `push: fcm on (project ${PROJECT}, test endpoints)`,
      'the JSON with the key\'s line breaks pasted in for real', bootLine(BR));
    PASS(/^push: fcm off — the key in FCM_SERVICE_ACCOUNT would not load \(.*chars, begin marker yes, end marker no\)$/.test(bootLine(T)),
      'a truncated key: off, described by counts', bootLine(T));
    PASS(/google-services\.json, the phone's half/.test(bootLine(G)), 'the phone\'s google-services.json: off, and says why',
      bootLine(G));
    const reg = await register(B64, BILAL, phone('b64'), 'android');
    const regT = await register(T, BILAL, phone('trunc'), 'android');
    PASS(reg.json?.sends === true && regT.json?.sends === false, 'and each tells a phone the truth',
      `base64 ${reg.json?.sends}, truncated ${regT.json?.sends}`);
    const all = [F, R, B64, BR, T, G].map((s) => s.log).join('\n');
    const leaked = keyLines.filter((l) => all.includes(l.slice(8, 48)));
    PASS(!leaked.length && !/PRIVATE KEY/.test(all), 'none of them logs any part of the key', `${leaked.length} line(s)`);
    await Promise.all([F, R, B64, BR, T, G].map((s) => stop(s.child)));
  }
}

const watchdog = setTimeout(() => {
  console.log('  FAIL  the whole run took longer than 90s');
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  process.exit(1);
}, 90000);

try {
  await main();
} catch (err) {
  failed++;
  console.log(`  FAIL  the run stopped early — ${err?.stack || err}`);
} finally {
  clearTimeout(watchdog);
  for (const s of sockets) { try { s.disconnect(); } catch { /* gone */ } }
  await Promise.all(children.map(stop));
  google.close();
  apns.close();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* leave it */ }
  console.log(`\n${failed ? 'FAIL' : 'PASS'}  ${passed} passed, ${failed} failed  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  process.exit(failed ? 1 : 0);
}
