// Sign in with Apple, end to end, against a stand-in for Apple.
//
// Apple's Guideline 5.1.1(v): an app that offers Sign in with Apple has to
// revoke the user's Apple tokens when they delete their account. That is a
// promise made across three parties — the app, this server, and Apple — so
// it is tested the only way that means anything: the real server, started as
// a process, talking over HTTP to a fake appleid.apple.com that checks what a
// real one would check (the client secret's ES256 signature and claims) and
// writes down every token it is asked to revoke.
//
// The keys are made fresh on every run: an RSA pair plays Apple's identity
// token key (published at /auth/keys), and a P-256 pair plays the Sign in
// with Apple .p8 the server signs its client secret with. Nothing here needs
// the network or an Apple account.
//
//   node test/apple-revoke.mjs
//
// Temporary data dirs go under os.tmpdir() (set TMPDIR to move them) and are
// removed afterwards; every process started is stopped, pass or fail.

import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_ID = 'com.moneymove.game';
const TEAM_ID = 'HAK23MQ4FD';
const KEY_ID = 'TESTKEY01';
const ISS = 'https://appleid.apple.com';
const ADMIN = 'moneymove-admin';

let failed = 0;
let passed = 0;
const PASS = (ok, label, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  return ok;
};
const SKIP = (label, why) => console.log(`  SKIP  ${label}  — ${why}`);
const section = (t) => console.log(`\n── ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000, step = 40) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(step);
  }
}

// ------------------------------------------------------------------- keys --
const appleRsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const rogueRsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const siwa = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const APPLE_KID = 'TESTRSA1';
const appleJwk = { ...appleRsa.publicKey.export({ format: 'jwk' }), kid: APPLE_KID, alg: 'RS256', use: 'sig' };
const siwaPem = siwa.privateKey.export({ type: 'pkcs8', format: 'pem' });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowS = () => Math.floor(Date.now() / 1000);

/** A JWT signed however the scenario needs — honestly or otherwise. */
function mint(claims, { key = appleRsa.privateKey, kid = APPLE_KID, alg = 'RS256' } = {}) {
  const head = b64({ alg, kid });
  const body = b64(claims);
  const input = `${head}.${body}`;
  let sig = '';
  if (alg === 'RS256') sig = crypto.sign('sha256', Buffer.from(input), key).toString('base64url');
  // The classic confusion attack: HMAC keyed with the verifier's public key.
  if (alg === 'HS256') {
    const pub = appleRsa.publicKey.export({ type: 'spki', format: 'pem' });
    sig = crypto.createHmac('sha256', pub).update(input).digest('base64url');
  }
  return `${input}.${sig}`;
}

const idClaims = (sub, extra = {}) => ({
  iss: ISS, aud: CLIENT_ID, exp: nowS() + 600, iat: nowS(), sub,
  nonce_supported: true, email: `${sub.slice(0, 6)}@privaterelay.appleid.com`,
  email_verified: 'true', is_private_email: 'true', ...extra,
});

function signIn(sub, { code = true, nonce = crypto.randomBytes(16).toString('hex') } = {}) {
  return {
    identityToken: mint(idClaims(sub, { nonce: sha256hex(nonce) })),
    authorizationCode: code === true ? `good-code-${sub}` : (code || undefined),
    nonce,
    userId: sub,
  };
}

// ------------------------------------------------------------- fake Apple --
const mock = {
  exchanges: [],        // { code, secret: '' | problem }
  revokes: [],          // { token, hint, secret, status }
  failRevokes: 0,       // answer this many revokes with a bare 503
  revokeFaults: [],     // [{ status, type, body }] answered first, one per revoke
  failKeys: false,      // /auth/keys answers 500
  keyFetches: 0,
  tokenDelayMs: 0,      // hold /auth/token this long before answering
  issued: new Map(),    // refresh token -> sub
};

function clientSecretProblem(form) {
  if (form.get('client_id') !== CLIENT_ID) return 'client_id';
  const parts = String(form.get('client_secret') || '').split('.');
  if (parts.length !== 3) return 'shape';
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
  } catch { return 'unreadable'; }
  if (header.alg !== 'ES256') return 'alg';
  if (header.kid !== KEY_ID) return 'kid';
  const ok = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`),
    { key: siwa.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'));
  if (!ok) return 'signature';
  if (claims.iss !== TEAM_ID) return 'iss';
  if (claims.sub !== CLIENT_ID) return 'sub';
  if (claims.aud !== ISS) return 'aud';
  const t = nowS();
  if (typeof claims.iat !== 'number' || claims.iat > t + 60) return 'iat';
  if (typeof claims.exp !== 'number' || claims.exp <= t || claims.exp - claims.iat > 15777000) return 'exp';
  return '';
}

const readBody = (req) => new Promise((resolve) => {
  let s = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { s += c; });
  req.on('end', () => resolve(s));
});
const reply = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(obj == null ? '' : JSON.stringify(obj));
};

const apple = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock');
  const form = new URLSearchParams(await readBody(req));
  if (req.method === 'GET' && url.pathname === '/auth/keys') {
    mock.keyFetches++;
    if (mock.failKeys) return reply(res, 500, { error: 'server_error' });
    return reply(res, 200, { keys: [appleJwk] });
  }

  if (req.method === 'POST' && url.pathname === '/auth/token') {
    const secret = clientSecretProblem(form);
    mock.exchanges.push({ code: form.get('code'), secret });
    if (secret) return reply(res, 400, { error: 'invalid_client' });
    if (form.get('grant_type') !== 'authorization_code') return reply(res, 400, { error: 'unsupported_grant_type' });
    // good-code-<sub> buys a token for <sub>; good-code-noid-<sub> buys one
    // whose reply carries no id_token, so its Apple ID cannot be read.
    const m = /^good-code-(noid-)?(.+)$/.exec(form.get('code') || '');
    if (!m) return reply(res, 400, { error: 'invalid_grant' });
    if (mock.tokenDelayMs) await sleep(mock.tokenDelayMs);
    const refresh = `rt_${crypto.randomBytes(20).toString('hex')}`;
    mock.issued.set(refresh, m[2]);
    // Apple repeats the sign-in's nonce here; the server must not choke on it.
    return reply(res, 200, {
      access_token: `at_${crypto.randomBytes(12).toString('hex')}`,
      token_type: 'Bearer', expires_in: 3600, refresh_token: refresh,
      ...(m[1] ? {} : { id_token: mint(idClaims(m[2], { nonce: sha256hex('some-earlier-nonce') })) }),
    });
  }

  if (req.method === 'POST' && url.pathname === '/auth/revoke') {
    const secret = clientSecretProblem(form);
    const entry = { token: form.get('token'), hint: form.get('token_type_hint'), secret, status: 200 };
    mock.revokes.push(entry);
    if (secret) { entry.status = 400; return reply(res, 400, { error: 'invalid_client' }); }
    const fault = mock.revokeFaults.shift();
    if (fault) {
      entry.status = fault.status;
      res.writeHead(fault.status, { 'content-type': fault.type || 'application/json' });
      return res.end(fault.body || '');
    }
    if (mock.failRevokes > 0) { mock.failRevokes--; entry.status = 503; return reply(res, 503, null); }
    return reply(res, 200, null);
  }
  reply(res, 404, { error: 'not_found' });
});

const okRevokesOf = (token) => mock.revokes.filter((r) => r.token === token && r.status === 200 && !r.secret);
const attemptsOf = (token) => mock.revokes.filter((r) => r.token === token).length;
const refreshFor = (sub) => [...mock.issued].filter(([, s]) => s === sub).map(([t]) => t);

// ----------------------------------------------------------------- server --
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-apple-revoke-'));
const children = [];

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

async function startServer(name, env, { dataDir } = {}) {
  const port = await freePort();
  const dir = dataDir || fs.mkdtempSync(path.join(tmpRoot, `${name}-`));
  const base = { ...process.env };
  for (const k of Object.keys(base)) {
    if (/^(APPLE_|ADMIN_KEY$|GOOGLE_|APNS_|STRIPE_)/.test(k)) delete base[k];
  }
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...base,
      PORT: String(port),
      DATA_DIR: dir,
      APPLE_ID_BASE: `http://127.0.0.1:${apple.address().port}`,
      APPLE_REVOKE_RETRY_MS: '150',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const srv = { name, url: `http://127.0.0.1:${port}`, dir, child, log: '', bodies: [] };
  child.stdout.on('data', (d) => { srv.log += d; });
  child.stderr.on('data', (d) => { srv.log += d; });
  children.push(child);
  const up = await until(async () => {
    if (child.exitCode != null) return true;
    try { return (await fetch(`${srv.url}/healthz`)).ok; } catch { return false; }
  }, 20000, 100);
  if (!up || child.exitCode != null) throw new Error(`${name} did not start:\n${srv.log}`);
  return srv;
}

async function call(srv, method, p, body) {
  const res = await fetch(srv.url + p, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  srv.bodies.push(`${method} ${p} -> ${text}`);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const get = (srv, p) => call(srv, 'GET', p);
const post = (srv, p, body) => call(srv, 'POST', p, body);

const device = (tag) => `dev-${tag}-${crypto.randomBytes(8).toString('hex')}`;
async function newProfile(srv, tag, name = 'Tester') {
  const token = device(tag);
  await post(srv, '/api/profile', { token, name });
  return token;
}
const me = async (srv, token) => (await get(srv, `/api/me?token=${encodeURIComponent(token)}`)).json;

const readJson = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const queuedTokens = (srv) => (readJson(path.join(srv.dir, 'apple-revocations.json'), []) || []).map((e) => e.token);
const socialIncludes = (srv, text) => {
  try { return fs.readFileSync(path.join(srv.dir, 'social.json'), 'utf8').includes(text); } catch { return false; }
};

/** Every read that could conceivably echo a profile back, for the leak scan. */
async function readEverything(srv, token) {
  const q = `?token=${encodeURIComponent(token)}`;
  for (const p of ['/api/me', '/api/social', '/api/friends', '/api/wallet', '/api/daily',
    '/api/achievements', '/api/invite', '/api/notices', '/api/boards', '/api/cup']) {
    await get(srv, p + q);
  }
  await post(srv, '/api/profile', { token });
  for (const p of ['/api/leaderboard', '/api/auth/config', '/api/rooms']) await get(srv, p);
  for (const p of ['/api/admin/data', '/api/admin/reports', '/api/admin/notices']) await get(srv, `${p}?key=${ADMIN}`);
  await post(srv, '/api/admin/cup', { key: ADMIN, action: 'read' });
}

// ---------------------------------------------------------------- scenarios --
async function main() {
  await new Promise((r) => apple.listen(0, '127.0.0.1', r));
  const A = await startServer('keyed', {
    APPLE_SIWA_KEY: siwaPem.replace(/\n/g, '\\n'), // the escaped form an env panel produces
    APPLE_SIWA_KEY_ID: KEY_ID,
  });

  section('configuration');
  {
    const cfg = (await get(A, '/api/auth/config')).json;
    PASS(cfg?.appleRevoke === true, 'keyed server reports appleRevoke: true', JSON.stringify(cfg?.appleRevoke));
  }

  section('a real sign-in keeps a token, and the token never leaves the server');
  const SUB_A = '001234.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.0101';
  const devA = await newProfile(A, 'a', 'Ann');
  {
    const before = mock.exchanges.length;
    const r = await post(A, '/api/auth/apple', { token: devA, nickname: 'Ann', ...signIn(SUB_A) });
    PASS(r.status === 200 && r.json?.ok === true && !!r.json.code && typeof r.json.name === 'string',
      'sign-in answers {ok, name, code}', `${r.status} ${r.text.slice(0, 80)}`);
    PASS(Object.keys(r.json || {}).sort().join() === 'code,name,ok', 'reply shape is unchanged', Object.keys(r.json || {}).join());
    PASS(mock.exchanges.length === before + 1 && mock.exchanges.at(-1).secret === '',
      'the code was exchanged with a valid client secret', JSON.stringify(mock.exchanges.at(-1)));
    const m = await me(A, devA);
    PASS(m?.provider === 'apple' && m.appleRevocable === true, '/api/me: provider apple, appleRevocable true', JSON.stringify(m));
    const daily = (await get(A, `/api/daily?token=${devA}`)).json;
    PASS(daily?.signedIn === true, 'the profile counts as signed in', JSON.stringify(daily));
    PASS(refreshFor(SUB_A).length === 1, 'Apple issued exactly one refresh token for it');
    await readEverything(A, devA);
    // social.json is written on a short debounce; the token has to reach it,
    // or a restart would forget what there is to revoke.
    const onDisk = await until(() => {
      try { return fs.readFileSync(path.join(A.dir, 'social.json'), 'utf8').includes(refreshFor(SUB_A)[0]); } catch { return false; }
    }, 4000, 100);
    PASS(!!onDisk, 'the token is persisted with the profile (social.json)');
  }

  section('forged or mismatched identity tokens are refused and change nothing');
  {
    const SUB_F = '001234.ffffffffffffffffffffffffffffffff.0202';
    const nonce = 'n-' + crypto.randomBytes(8).toString('hex');
    const good = (extra = {}) => idClaims(SUB_F, { nonce: sha256hex(nonce), ...extra });
    const cases = [
      ['bad signature (another RSA key, Apple\'s kid)', { identityToken: mint(good(), { key: rogueRsa.privateKey }), nonce }],
      ['wrong audience', { identityToken: mint(good({ aud: 'com.someone.else' })), nonce }],
      ['wrong issuer', { identityToken: mint(good({ iss: 'https://evil.example.com' })), nonce }],
      ['expired', { identityToken: mint(good({ exp: nowS() - 3600, iat: nowS() - 7200 })), nonce }],
      ['issued in the future', { identityToken: mint(good({ iat: nowS() + 3600, exp: nowS() + 7200 })), nonce }],
      ['alg none', { identityToken: mint(good(), { alg: 'none' }), nonce }],
      ['alg HS256 keyed with the public key', { identityToken: mint(good(), { alg: 'HS256' }), nonce }],
      ['unknown key id', { identityToken: mint(good(), { kid: 'NOPE' }), nonce }],
      ['nonce mismatch', { identityToken: mint(good()), nonce: 'a-different-nonce' }],
      ['nonce in token, none sent', { identityToken: mint(good()) }],
      ['nonce sent, none in token', { identityToken: mint(idClaims(SUB_F)), nonce }],
      ['userId does not match the token', { identityToken: mint(good()), nonce, userId: '009999.someone.else' }],
      ['missing subject', { identityToken: mint({ ...good(), sub: '' }), nonce }],
      ['garbage', { identityToken: 'not.a.jwt', nonce }],
    ];
    const exchangesBefore = mock.exchanges.length;
    for (const [label, fields] of cases) {
      const dev = await newProfile(A, 'forged');
      const r = await post(A, '/api/auth/apple', {
        token: dev, nickname: 'Mallory', authorizationCode: `good-code-${SUB_F}`, ...fields,
      });
      const m = await me(A, dev);
      PASS(r.status === 401 && !m?.provider && m?.appleRevocable === false,
        `refused: ${label}`, `${r.status} provider=${m?.provider}`);
    }
    PASS(mock.exchanges.length === exchangesBefore, 'no refused sign-in ever spent its authorization code',
      `${mock.exchanges.length - exchangesBefore} exchange(s)`);
    // A verified sign-in with a userId that matches is fine, and so is one
    // with no userId at all.
    const dev = await newProfile(A, 'nouid');
    const { userId, ...noUid } = signIn(SUB_F, { code: false });
    const r = await post(A, '/api/auth/apple', { token: dev, ...noUid });
    PASS(r.status === 200 && (await me(A, dev))?.provider === 'apple', 'a verified sign-in without userId is accepted', `${r.status}`);
  }

  section('deleting an account revokes the stored token');
  {
    const SUB = '001234.dddddddddddddddddddddddddddddddd.0303';
    const dev = await newProfile(A, 'del');
    await post(A, '/api/auth/apple', { token: dev, ...signIn(SUB) });
    const [rt] = refreshFor(SUB);
    const r = await post(A, '/api/account/delete', { token: dev });
    PASS(r.status === 200 && r.json?.ok === true && r.json?.deleted === true, 'delete answers {ok, deleted: true}', r.text);
    const done = await until(() => okRevokesOf(rt).length > 0);
    PASS(!!done, 'Apple was asked to revoke that refresh token, with a valid client secret');
    PASS(okRevokesOf(rt)[0]?.hint === 'refresh_token', 'token_type_hint is refresh_token', okRevokesOf(rt)[0]?.hint);
    PASS((await me(A, dev))?.code === '', 'the profile is gone');
  }

  section('deleting with appleCode and no stored token exchanges, then revokes');
  {
    const SUB = '001234.eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.0404';
    const dev = await newProfile(A, 'delcode');
    await post(A, '/api/auth/apple', { token: dev, ...signIn(SUB, { code: false }) });
    PASS((await me(A, dev))?.appleRevocable === false, 'signed in without a code: appleRevocable false');
    const r = await post(A, '/api/account/delete', { token: dev, appleCode: `good-code-${SUB}` });
    PASS(r.status === 200 && r.json?.deleted === true, 'delete answers {ok, deleted: true}', r.text);
    const [rt] = refreshFor(SUB);
    PASS(!!rt && !!(await until(() => okRevokesOf(rt).length > 0)), 'the exchanged token was revoked');

    // A code for somebody else's Apple ID is not revoked on this person's word.
    const SUB2 = '001234.e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2.0405';
    const OTHER = '001234.0t0t0t0t0t0t0t0t0t0t0t0t0t0t0t0t.0406';
    const dev2 = await newProfile(A, 'delother');
    await post(A, '/api/auth/apple', { token: dev2, ...signIn(SUB2, { code: false }) });
    const r2 = await post(A, '/api/account/delete', { token: dev2, appleCode: `good-code-${OTHER}` });
    await sleep(600);
    const [otherRt] = refreshFor(OTHER);
    PASS(r2.json?.deleted === true && otherRt && okRevokesOf(otherRt).length === 0 && mock.revokes.every((x) => x.token !== otherRt),
      'a code for a different Apple ID is exchanged but not revoked, and deletion still happens', r2.text);

    // A code Apple rejects costs nothing but the attempt.
    const dev3 = await newProfile(A, 'delbad');
    await post(A, '/api/auth/apple', { token: dev3, ...signIn('001234.b4db4db4db4db4db4db4db4db4db4d.0407', { code: false }) });
    const r3 = await post(A, '/api/account/delete', { token: dev3, appleCode: 'stale-code' });
    PASS(r3.status === 200 && r3.json?.deleted === true && (await me(A, dev3))?.code === '',
      'a rejected code (invalid_grant) still deletes the account', r3.text);
  }

  section('a token whose id_token will not read: kept from a deletion, never stored at sign-in');
  {
    const SUB = '001234.n0n0n0n0n0n0n0n0n0n0n0n0n0n0n0n0.0408';
    const dev = await newProfile(A, 'noid');
    const r = await post(A, '/api/auth/apple', { token: dev, ...signIn(SUB, { code: `good-code-noid-${SUB}` }) });
    const m = await me(A, dev);
    PASS(r.status === 200 && m?.provider === 'apple' && m?.appleRevocable === false,
      'a sign-in cannot place the token, so it keeps none', `${r.status} ${JSON.stringify(m)}`);
    const d = await post(A, '/api/account/delete', { token: dev, appleCode: `good-code-noid-${SUB}` });
    const rt = refreshFor(SUB).at(-1);
    PASS(d.json?.deleted === true && refreshFor(SUB).length === 2 && !!(await until(() => okRevokesOf(rt).length > 0)),
      'a deletion revokes it anyway — the code came from the deleting player\'s own phone', d.text);
  }

  section('a deletion waiting on Apple cannot be undone by a request that lands meanwhile');
  {
    const SUB = '001234.z0z0z0z0z0z0z0z0z0z0z0z0z0z0z0z0.0409';
    const dev = await newProfile(A, 'race');
    await post(A, '/api/auth/apple', { token: dev, ...signIn(SUB, { code: false }) });
    PASS(!!(await until(() => socialIncludes(A, dev), 5000, 100)), 'the signed-in profile is on disk before the deletion');
    mock.tokenDelayMs = 2000;
    const started = Date.now();
    const pending = post(A, '/api/account/delete', { token: dev, appleCode: `good-code-${SUB}` });
    await sleep(600);
    const during = await post(A, '/api/profile', { token: dev, name: 'Zombie' });
    const r = await pending;
    mock.tokenDelayMs = 0;
    PASS(during.status === 200 && r.json?.deleted === true && Date.now() - started >= 1900,
      'the profile save lands while the deletion waits on Apple, and the deletion still answers deleted', `${during.status} ${r.text}`);
    const m = await me(A, dev);
    PASS(m?.code === '' && m?.provider === null, 'afterwards the profile is gone, not brought back', JSON.stringify(m));
    PASS(!!(await until(() => !socialIncludes(A, dev), 5000, 100)), 'and social.json no longer holds it');
    const [rt] = refreshFor(SUB);
    PASS(!!rt && !!(await until(() => okRevokesOf(rt).length > 0)), 'the token the code bought was revoked');
  }

  section('the admin deletion route revokes too');
  {
    const SUB = '001234.adadadadadadadadadadadadadadadad.0505';
    const dev = await newProfile(A, 'admindel');
    const signedIn = await post(A, '/api/auth/apple', { token: dev, ...signIn(SUB) });
    const [rt] = refreshFor(SUB);
    const r = await post(A, '/api/admin/account/delete', { key: ADMIN, code: signedIn.json?.code });
    PASS(r.status === 200 && r.json?.deleted === true && r.json?.code === signedIn.json?.code, 'admin delete answers {ok, deleted, code}', r.text);
    PASS(!!(await until(() => okRevokesOf(rt).length > 0)), 'the stored token was revoked');
  }

  section('a revocation Apple cannot take right now is queued, retried and crossed off');
  {
    const SUB = '001234.r3r3r3r3r3r3r3r3r3r3r3r3r3r3r3r3.0606';
    const dev = await newProfile(A, 'retry');
    await post(A, '/api/auth/apple', { token: dev, ...signIn(SUB) });
    const [rt] = refreshFor(SUB);
    mock.failRevokes = 2;
    const queueFile = path.join(A.dir, 'apple-revocations.json');
    const r = await post(A, '/api/account/delete', { token: dev });
    PASS(r.json?.deleted === true, 'deletion does not wait for Apple', r.text);
    const queued = await until(() => {
      try { return JSON.parse(fs.readFileSync(queueFile, 'utf8')).some((e) => e.token === rt); } catch { return false; }
    }, 3000, 10);
    PASS(!!queued, 'the token was written to apple-revocations.json');
    const ok = await until(() => okRevokesOf(rt).length > 0, 8000);
    const attempts = mock.revokes.filter((x) => x.token === rt).length;
    PASS(!!ok && attempts >= 3, 'two 503s, then revoked by the retry loop', `${attempts} attempt(s)`);
    const emptied = await until(() => {
      try { return JSON.parse(fs.readFileSync(queueFile, 'utf8')).length === 0; } catch { return false; }
    }, 3000);
    PASS(!!emptied, 'and the queue file is empty again');
    mock.failRevokes = 0;
  }

  section('what counts as Apple saying no for good');
  {
    const SUB = '001234.f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4.0607';
    const dev = await newProfile(A, 'fault404');
    await post(A, '/api/auth/apple', { token: dev, ...signIn(SUB) });
    const [rt] = refreshFor(SUB);
    mock.revokeFaults = [{ status: 404, type: 'text/html', body: '<html><body><h1>Not Found</h1></body></html>' }];
    await post(A, '/api/account/delete', { token: dev });
    const ok = await until(() => okRevokesOf(rt).length > 0, 8000);
    PASS(!!ok && attemptsOf(rt) >= 2, 'a 404 with an HTML body (a CDN, not Apple) is retried, then revoked', `${attemptsOf(rt)} attempt(s)`);
    PASS(!!(await until(() => !queuedTokens(A).includes(rt), 3000)), 'and crossed off the queue');

    const SUB2 = '001234.f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5.0608';
    const dev2 = await newProfile(A, 'fault400');
    await post(A, '/api/auth/apple', { token: dev2, ...signIn(SUB2) });
    const [rt2] = refreshFor(SUB2);
    mock.revokeFaults = [{ status: 400, body: JSON.stringify({ error: 'invalid_grant' }) }];
    await post(A, '/api/account/delete', { token: dev2 });
    await until(() => attemptsOf(rt2) > 0, 3000, 10);
    await sleep(900);
    PASS(attemptsOf(rt2) === 1 && !queuedTokens(A).includes(rt2),
      'Apple\'s own invalid_grant is final: tried once and crossed off', `${attemptsOf(rt2)} attempt(s)`);
    mock.revokeFaults = [];
  }

  section('a revocation still waiting is called off when the same Apple ID signs in again');
  {
    const SUB = '001234.q1q1q1q1q1q1q1q1q1q1q1q1q1q1q1q1.0609';
    const dev = await newProfile(A, 'withdraw');
    await post(A, '/api/auth/apple', { token: dev, ...signIn(SUB) });
    const [t1] = refreshFor(SUB);
    mock.failRevokes = 1000;
    await post(A, '/api/auth/logout', { token: dev });
    const queued = await until(() => {
      const e = readJson(path.join(A.dir, 'apple-revocations.json'), []).find((x) => x.token === t1);
      return e && e.tries >= 1 && e.subject === SUB;
    }, 3000, 10);
    PASS(!!queued, 'signing out while Apple is down queues the revocation, with its Apple ID');
    const again = await post(A, '/api/auth/apple', { token: dev, ...signIn(SUB) });
    const t2 = refreshFor(SUB).find((t) => t !== t1);
    mock.failRevokes = 0;
    await sleep(1200); // several retry intervals
    PASS(again.status === 200 && okRevokesOf(t1).length === 0 && okRevokesOf(t2).length === 0,
      'the new sign-in is not undone: neither token is revoked', `${again.status}`);
    PASS(!queuedTokens(A).includes(t1), 'and the queue no longer holds the old one');
    const m = await me(A, dev);
    PASS(m?.provider === 'apple' && m?.appleRevocable === true, 'still signed in, holding the new token', JSON.stringify(m));

    // No token from the new sign-in (its code fails): the withdrawn one is kept.
    const SUB2 = '001234.q2q2q2q2q2q2q2q2q2q2q2q2q2q2q2q2.0610';
    const dev2 = await newProfile(A, 'adopt');
    await post(A, '/api/auth/apple', { token: dev2, ...signIn(SUB2) });
    const [u1] = refreshFor(SUB2);
    mock.failRevokes = 1000;
    await post(A, '/api/auth/logout', { token: dev2 });
    await until(() => readJson(path.join(A.dir, 'apple-revocations.json'), []).some((x) => x.token === u1 && x.tries >= 1), 3000, 10);
    await post(A, '/api/auth/apple', { token: dev2, ...signIn(SUB2, { code: 'stale-code' }) });
    mock.failRevokes = 0;
    await sleep(1200);
    PASS(okRevokesOf(u1).length === 0 && (await me(A, dev2))?.appleRevocable === true && !queuedTokens(A).includes(u1),
      'a re-sign-in whose own code fails keeps the withdrawn token instead');
    await post(A, '/api/account/delete', { token: dev2 });
    PASS(!!(await until(() => okRevokesOf(u1).length > 0)), 'and deleting the account then revokes it');

    // A bare user id cannot call a revocation off.
    const SUB3 = '001234.q3q3q3q3q3q3q3q3q3q3q3q3q3q3q3q3.0611';
    const dev3 = await newProfile(A, 'nowithdraw');
    await post(A, '/api/auth/apple', { token: dev3, ...signIn(SUB3) });
    const [v1] = refreshFor(SUB3);
    mock.failRevokes = 1000;
    await post(A, '/api/auth/logout', { token: dev3 });
    await until(() => readJson(path.join(A.dir, 'apple-revocations.json'), []).some((x) => x.token === v1 && x.tries >= 1), 3000, 10);
    await post(A, '/api/auth/apple', { token: await newProfile(A, 'claims-q3'), userId: SUB3 });
    mock.failRevokes = 0;
    PASS(!!(await until(() => okRevokesOf(v1).length > 0, 8000)), 'an unverified claim to the same Apple ID does not stop the revocation');
  }

  section('signing out');
  {
    const SUB = '001234.l0l0l0l0l0l0l0l0l0l0l0l0l0l0l0l0.0707';
    const dev = await newProfile(A, 'logout');
    await post(A, '/api/auth/apple', { token: dev, ...signIn(SUB) });
    const [rt] = refreshFor(SUB);
    const r = await post(A, '/api/auth/logout', { token: dev });
    PASS(r.status === 200 && JSON.stringify(r.json) === '{"ok":true}', 'logout answers {ok:true}', r.text);
    PASS(!!(await until(() => okRevokesOf(rt).length > 0)), 'logout revokes the token');
    const m = await me(A, dev);
    PASS(m?.provider === null && m?.appleRevocable === false && m?.code, 'signed out, profile kept', JSON.stringify(m));

    // Same Apple ID on two devices: signing out of one leaves the other alone.
    const SUB2 = '001234.m2m2m2m2m2m2m2m2m2m2m2m2m2m2m2m2.0708';
    const phone = await newProfile(A, 'phone');
    const tablet = await newProfile(A, 'tablet');
    await post(A, '/api/auth/apple', { token: phone, ...signIn(SUB2) });
    await post(A, '/api/auth/apple', { token: tablet, ...signIn(SUB2) });
    const tokens = refreshFor(SUB2);
    const revokesBefore = mock.revokes.length;
    await post(A, '/api/auth/logout', { token: phone });
    await sleep(700);
    PASS(tokens.length === 2 && mock.revokes.slice(revokesBefore).every((x) => !tokens.includes(x.token)),
      'no revoke while another profile is signed in with the same Apple ID',
      `${mock.revokes.length - revokesBefore} revoke call(s)`);
    const t = await me(A, tablet);
    PASS((await me(A, phone))?.provider === null && t?.provider === 'apple' && t?.appleRevocable === true,
      'phone signed out, tablet still signed in and revocable');
    await post(A, '/api/auth/logout', { token: tablet });
    PASS(!!(await until(() => okRevokesOf(tokens[1]).length > 0)), 'signing out of the last device does revoke');
  }

  section('a token is passed on, not dropped, while the Apple ID is in use elsewhere');
  {
    // The phone signed in without a token; the tablet holds the only one.
    const S = '001234.h1h1h1h1h1h1h1h1h1h1h1h1h1h1h1h1.0709';
    const phone = await newProfile(A, 'h-phone');
    const tablet = await newProfile(A, 'h-tablet');
    const phoneIn = await post(A, '/api/auth/apple', { token: phone, ...signIn(S, { code: false }) });
    await post(A, '/api/auth/apple', { token: tablet, ...signIn(S) });
    const [tb] = refreshFor(S);
    await post(A, '/api/auth/logout', { token: tablet });
    await sleep(500);
    PASS(attemptsOf(tb) === 0, 'the tablet signing out revokes nothing — the phone still uses the Apple ID');
    PASS((await me(A, phone))?.appleRevocable === true, 'and the phone, which held no token, now holds the tablet\'s');
    const del = await post(A, '/api/admin/account/delete', { key: ADMIN, code: phoneIn.json?.code });
    PASS(del.json?.deleted === true && !!(await until(() => okRevokesOf(tb).length > 0)),
      'deleting the phone through the admin route then revokes it', del.text);

    // The other way round, ending in two sign-outs.
    const S2 = '001234.h2h2h2h2h2h2h2h2h2h2h2h2h2h2h2h2.0710';
    const phone2 = await newProfile(A, 'h-phone2');
    const tablet2 = await newProfile(A, 'h-tablet2');
    await post(A, '/api/auth/apple', { token: phone2, ...signIn(S2) });
    await post(A, '/api/auth/apple', { token: tablet2, ...signIn(S2, { code: false }) });
    const [pa] = refreshFor(S2);
    await post(A, '/api/auth/logout', { token: phone2 });
    await sleep(500);
    PASS(attemptsOf(pa) === 0 && (await me(A, tablet2))?.appleRevocable === true,
      'the phone signs out: no revoke, the tablet inherits the token');
    await post(A, '/api/auth/logout', { token: tablet2 });
    PASS(!!(await until(() => okRevokesOf(pa).length > 0)), 'the tablet signs out last: the phone\'s original token is revoked');
  }

  section('a claimed (unverified) Apple login neither shields a token nor inherits one');
  {
    const S = '001234.c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1.0711';
    const claimer = await newProfile(A, 'claimer');
    const claimed = await post(A, '/api/auth/apple', { token: claimer, userId: S });
    const real = await newProfile(A, 'real');
    await post(A, '/api/auth/apple', { token: real, ...signIn(S) });
    const [rt] = refreshFor(S);
    await post(A, '/api/auth/logout', { token: real });
    PASS(claimed.status === 200 && !!(await until(() => okRevokesOf(rt).length > 0)),
      'signing out revokes, though a bare user id names the same Apple ID elsewhere');
    PASS((await me(A, claimer))?.appleRevocable === false, 'and the claim did not inherit the token');
  }

  section('signing in again');
  {
    const SUB = '001234.s5s5s5s5s5s5s5s5s5s5s5s5s5s5s5s5.0808';
    const dev = await newProfile(A, 'again');
    await post(A, '/api/auth/apple', { token: dev, ...signIn(SUB) });
    await post(A, '/api/auth/apple', { token: dev, ...signIn(SUB) });
    const revokesBefore = mock.revokes.length;
    await post(A, '/api/auth/apple', { token: dev, ...signIn(SUB, { code: false }) });
    await sleep(700);
    const [first, second] = refreshFor(SUB);
    PASS(mock.revokes.every((x) => x.token !== first && x.token !== second) && mock.revokes.length === revokesBefore,
      'the same Apple ID signing in again revokes nothing');
    PASS((await me(A, dev))?.appleRevocable === true, 'a re-sign-in without a code keeps the token on file');
    await post(A, '/api/account/delete', { token: dev });
    await until(() => okRevokesOf(second).length > 0);
    PASS(okRevokesOf(second).length === 1 && okRevokesOf(first).length === 0,
      'deletion revokes the newest token (the one on file)');

    // A different Apple ID on the same profile: the old one is handed back.
    const W1 = '001234.w1w1w1w1w1w1w1w1w1w1w1w1w1w1w1w1.0809';
    const W2 = '001234.w2w2w2w2w2w2w2w2w2w2w2w2w2w2w2w2.0810';
    const dev2 = await newProfile(A, 'switch');
    await post(A, '/api/auth/apple', { token: dev2, ...signIn(W1) });
    await post(A, '/api/auth/apple', { token: dev2, ...signIn(W2) });
    const [oldRt] = refreshFor(W1);
    const [newRt] = refreshFor(W2);
    PASS(!!(await until(() => okRevokesOf(oldRt).length > 0)), 'switching Apple IDs revokes the old one');
    await sleep(300);
    PASS(okRevokesOf(newRt).length === 0 && (await me(A, dev2))?.appleRevocable === true, 'and keeps the new one');
  }

  section('Google replacing Apple');
  SKIP('google sign-in revokes the Apple token it replaces',
    'the Google route verifies against oauth2.googleapis.com, which this offline test cannot stand in for');

  section('Apple server-to-server notifications');
  {
    const SUB = '001234.n7n7n7n7n7n7n7n7n7n7n7n7n7n7n7n7.0909';
    const one = await newProfile(A, 'n1');
    const two = await newProfile(A, 'n2');
    await post(A, '/api/auth/apple', { token: one, ...signIn(SUB) });
    await post(A, '/api/auth/apple', { token: two, ...signIn(SUB) });
    const note = (type, sub, extra = {}, opts = {}) => mint({
      iss: ISS, aud: CLIENT_ID, iat: nowS(), jti: crypto.randomUUID(),
      events: JSON.stringify({ type, sub, event_time: Date.now(), ...extra }),
      ...(opts.claims || {}),
    }, opts);

    const bad = await post(A, '/api/auth/apple/notifications', { payload: note('consent-revoked', SUB, {}, { key: rogueRsa.privateKey }) });
    const wrongAud = await post(A, '/api/auth/apple/notifications', { payload: note('consent-revoked', SUB, {}, { claims: { aud: 'com.other' } }) });
    const stale = await post(A, '/api/auth/apple/notifications', { payload: note('consent-revoked', SUB, {}, { claims: { iat: nowS() - 30 * 86400 } }) });
    const empty = await post(A, '/api/auth/apple/notifications', {});
    PASS([bad, wrongAud, stale, empty].every((r) => r.status === 400),
      'forged, wrong-audience, stale and empty notifications are 400', [bad, wrongAud, stale, empty].map((r) => r.status).join());
    PASS((await me(A, one))?.provider === 'apple' && (await me(A, two))?.provider === 'apple', 'and change nothing');

    const email = await post(A, '/api/auth/apple/notifications', { payload: note('email-disabled', SUB) });
    PASS(email.status === 200 && email.json?.ok === true && (await me(A, one))?.appleRevocable === true,
      'email-disabled is acknowledged and ignored', email.text);

    // Delivered before the player's latest sign-in: a stale notice about an
    // authorization they have since renewed.
    const early = await post(A, '/api/auth/apple/notifications', {
      payload: note('consent-revoked', SUB, { event_time: Date.now() - 10 * 60 * 1000 }),
    });
    PASS(early.status === 200 && (await me(A, one))?.provider === 'apple',
      'a revocation dated before the latest sign-in does not sign anybody out');

    const revokesBefore = mock.revokes.length;
    const r = await post(A, '/api/auth/apple/notifications', { payload: note('consent-revoked', SUB) });
    const m1 = await me(A, one);
    const m2 = await me(A, two);
    PASS(r.status === 200 && JSON.stringify(r.json) === '{"ok":true}', 'consent-revoked answers {ok:true}', r.text);
    PASS(m1?.provider === null && m1?.appleRevocable === false && m2?.provider === null && m2?.appleRevocable === false,
      'every profile with that Apple ID is signed out and holds no token');
    await sleep(500);
    PASS(mock.revokes.length === revokesBefore, 'nothing is revoked — Apple already did it');

    const SUB2 = '001234.x8x8x8x8x8x8x8x8x8x8x8x8x8x8x8x8.0910';
    const three = await newProfile(A, 'n3');
    await post(A, '/api/auth/apple', { token: three, ...signIn(SUB2) });
    // A non-JSON content type must still be read.
    const raw = await fetch(`${A.url}/api/auth/apple/notifications`, {
      method: 'POST', headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ payload: note('account-deleted', SUB2) }),
    });
    PASS(raw.status === 200 && (await me(A, three))?.provider === null,
      'account-deleted (what Apple sends) signs out too (sent as text/plain)', `${raw.status}`);

    // The spelling Apple's documentation used to show still works.
    const SUB3 = '001234.x9x9x9x9x9x9x9x9x9x9x9x9x9x9x9x9.0911';
    const four = await newProfile(A, 'n4');
    await post(A, '/api/auth/apple', { token: four, ...signIn(SUB3) });
    const legacySpelling = await post(A, '/api/auth/apple/notifications', { payload: note('account-delete', SUB3) });
    PASS(legacySpelling.status === 200 && (await me(A, four))?.provider === null, 'account-delete (the documented spelling) signs out');
  }

  section('legacy userId-only sign-in (builds ≤ 10)');
  {
    const dev = await newProfile(A, 'legacy');
    const r = await post(A, '/api/auth/apple', { token: dev, userId: '000111.legacylegacylegacy.0001', nickname: 'Old' });
    const m = await me(A, dev);
    PASS(r.status === 200 && r.json?.ok === true && m?.provider === 'apple' && m?.appleRevocable === false,
      'accepted while APPLE_UNVERIFIED_SIGNIN is on (the default)', r.text);
    PASS(/UNVERIFIED sign-in/.test(A.log), 'and warned about in the log');
    const missing = await post(A, '/api/auth/apple', { token: dev });
    PASS(missing.status === 400, 'no identityToken and no userId is still a 400', `${missing.status}`);
  }

  section('nothing secret in any reply or log line');
  {
    for (const dev of [devA]) await readEverything(A, dev);
    const secrets = [...mock.issued.keys()];
    const replies = A.bodies.join('\n');
    const leaked = secrets.filter((s) => replies.includes(s));
    PASS(secrets.length > 5 && leaked.length === 0, `no refresh token in ${A.bodies.length} server replies`, `${leaked.length} leaked`);
    PASS(!/"appleRefresh"/.test(replies), 'no reply names the appleRefresh field');
    const inLog = secrets.filter((s) => A.log.includes(s));
    PASS(inLog.length === 0 && !/good-code-/.test(A.log) && !/eyJ[A-Za-z0-9_-]{20,}\./.test(A.log),
      'no refresh token, authorization code or JWT in the server log');
  }

  section('the queue survives a restart');
  {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'restart-'));
    const waiting = `rt_waiting_${crypto.randomBytes(8).toString('hex')}`;
    const ancient = `rt_ancient_${crypto.randomBytes(8).toString('hex')}`;
    // Due tomorrow, and for an Apple ID that is about to sign in again.
    const later = `rt_later_${crypto.randomBytes(8).toString('hex')}`;
    const LATER_SUB = '001234.r9r9r9r9r9r9r9r9r9r9r9r9r9r9r9r9.1201';
    fs.writeFileSync(path.join(dir, 'apple-revocations.json'), JSON.stringify([
      { token: waiting, hint: 'refresh_token', reason: 'from before the restart', tries: 1, nextAt: 0, firstAt: Date.now() - 60000 },
      { token: ancient, hint: 'refresh_token', reason: 'from long ago', tries: 40, nextAt: 0, firstAt: Date.now() - 31 * 86400000 },
      { token: later, hint: 'refresh_token', reason: 'signed out', subject: LATER_SUB, tries: 3, nextAt: Date.now() + 86400000, firstAt: Date.now() - 3600000 },
    ]));
    const C = await startServer('restart', { APPLE_SIWA_KEY: siwaPem, APPLE_SIWA_KEY_ID: KEY_ID }, { dataDir: dir });
    PASS(/3 Sign in with Apple revocation\(s\) waiting/.test(C.log), 'all three entries are read back at boot');
    PASS(!!(await until(() => okRevokesOf(waiting).length > 0, 8000)), 'a revocation queued before a restart is sent after it');
    const emptied = await until(() => {
      const left = queuedTokens(C);
      return left.length === 1 && left[0] === later;
    }, 3000);
    PASS(!!emptied && mock.revokes.every((x) => x.token !== ancient), 'one queued over 30 days ago is given up on, not sent');
    PASS(/gave up on a revocation after 30 days/.test(C.log), 'and the log says so');
    const back = await newProfile(C, 'back');
    await post(C, '/api/auth/apple', { token: back, ...signIn(LATER_SUB, { code: false }) });
    PASS((await me(C, back))?.appleRevocable === true && !queuedTokens(C).includes(later) && attemptsOf(later) === 0,
      'an entry read back from disk keeps its Apple ID: signing in again withdraws it and keeps the token');
    await stop(C.child);
  }

  section('a server with no Sign in with Apple key (and unverified sign-in switched off)');
  {
    const B = await startServer('keyless', { APPLE_SIWA_KEY_ID: KEY_ID, APPLE_UNVERIFIED_SIGNIN: 'off' });
    PASS((await get(B, '/api/auth/config')).json?.appleRevoke === false, 'reports appleRevoke: false');
    const SUB = '001234.k9k9k9k9k9k9k9k9k9k9k9k9k9k9k9k9.1010';
    const dev = await newProfile(B, 'keyless');
    const exchangesBefore = mock.exchanges.length;
    const revokesBefore = mock.revokes.length;
    const r = await post(B, '/api/auth/apple', { token: dev, ...signIn(SUB) });
    const m = await me(B, dev);
    PASS(r.status === 200 && m?.provider === 'apple' && m?.appleRevocable === false,
      'a real sign-in still verifies and signs in, keeping no token', `${r.status} ${JSON.stringify(m)}`);
    PASS(mock.exchanges.length === exchangesBefore, 'and never tries to exchange the code');
    const forged = await post(B, '/api/auth/apple', {
      token: await newProfile(B, 'keyless-forged'),
      ...signIn(SUB), identityToken: mint(idClaims(SUB), { key: rogueRsa.privateKey }),
    });
    PASS(forged.status === 401, 'a forged token is still refused', `${forged.status}`);
    const legacy = await post(B, '/api/auth/apple', { token: await newProfile(B, 'keyless-legacy'), userId: 'someone' });
    PASS(legacy.status === 401, 'APPLE_UNVERIFIED_SIGNIN=off refuses a bare userId', `${legacy.status} ${legacy.text}`);
    const d = await post(B, '/api/account/delete', { token: dev, appleCode: `good-code-${SUB}` });
    await sleep(400);
    PASS(d.status === 200 && d.json?.deleted === true && (await me(B, dev))?.code === '',
      'deletion still works', d.text);
    PASS(mock.exchanges.length === exchangesBefore && mock.revokes.length === revokesBefore,
      'and nothing is sent to Apple');
    await stop(B.child);
  }

  section('switching unverified sign-in off (" disabled "), on the same data, with Apple\'s keys unreachable');
  {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'switch-'));
    const keyed = { APPLE_SIWA_KEY: siwaPem, APPLE_SIWA_KEY_ID: KEY_ID };
    const D1 = await startServer('switch-on', keyed, { dataDir: dir });
    PASS(/unverified \(pre-build-11\) Sign in with Apple is ON/.test(D1.log), 'unset, the boot log says unverified sign-in is on');
    const LSUB = '000111.claimedclaimedclaimed.0002';
    const VSUB = '001234.v5v5v5v5v5v5v5v5v5v5v5v5v5v5v5v5.1101';
    const legacy = await newProfile(D1, 'sw-legacy');
    const lIn = await post(D1, '/api/auth/apple', { token: legacy, userId: LSUB });
    const verified = await newProfile(D1, 'sw-verified');
    const vIn = await post(D1, '/api/auth/apple', { token: verified, ...signIn(VSUB, { code: false }) });
    // The same phone on an old TestFlight build, repeating the Apple ID it really is.
    await post(D1, '/api/auth/apple', { token: verified, userId: VSUB });
    const players = (await get(D1, `/api/admin/data?key=${ADMIN}`)).json?.players || [];
    const loginOfCode = (code) => players.find((p) => p.code === code)?.login;
    const lLogin = loginOfCode(lIn.json?.code);
    const vLogin = loginOfCode(vIn.json?.code);
    PASS(lLogin?.verified === false && vLogin?.verified === true,
      'a bare user id is recorded as unverified; repeating a verified one does not downgrade it', JSON.stringify([lLogin, vLogin]));
    const flushed = await until(() => {
      const rows = readJson(path.join(dir, 'social.json'))?.profiles || [];
      const L = rows.find((p) => p.token === legacy)?.login;
      const V = rows.find((p) => p.token === verified)?.login;
      return L?.verified === false && V?.verified === true && V.at === vLogin?.at;
    }, 5000, 100);
    PASS(!!flushed, 'both are on disk before the restart');
    await stop(D1.child);

    mock.failKeys = true;
    const keyFetchesBefore = mock.keyFetches;
    const D2 = await startServer('switch-off', { ...keyed, APPLE_UNVERIFIED_SIGNIN: ' disabled ' }, { dataDir: dir });
    PASS(/APPLE_UNVERIFIED_SIGNIN="disabled" is neither on nor off/.test(D2.log) && /Sign in with Apple is off/.test(D2.log),
      'an unrecognised value turns it off, and the boot log says so');
    PASS(/signed out 1 profile\(s\) whose Apple sign-in was never verified/.test(D2.log), 'the boot signs out the unverified login');
    const lm = await me(D2, legacy);
    PASS(lm?.provider === null && !!lm?.code, 'the claimed login is signed out, the profile kept', JSON.stringify(lm));
    const claim = await post(D2, '/api/daily/claim', { token: legacy });
    PASS(claim.status === 401 && claim.json?.needsLogin === true, 'and the daily coin asks it to sign in', claim.text);
    PASS((await me(D2, verified))?.provider === 'apple', 'the verified login survives the restart');
    const bare = await post(D2, '/api/auth/apple', { token: await newProfile(D2, 'sw-bare'), userId: 'typed-in' });
    PASS(bare.status === 401, 'a bare user id is refused', `${bare.status}`);

    // This server has never had Apple's keys, and cannot get them now.
    const exchangesBefore = mock.exchanges.length;
    const d = await post(D2, '/api/account/delete', { token: verified, appleCode: `good-code-${VSUB}` });
    const rt = refreshFor(VSUB).at(-1);
    PASS(d.json?.deleted === true && mock.exchanges.length === exchangesBefore + 1 && mock.keyFetches === keyFetchesBefore,
      'deletion exchanges the code without asking for Apple\'s keys', `${d.text} keyFetches +${mock.keyFetches - keyFetchesBefore}`);
    await until(() => okRevokesOf(rt).length > 0);
    await sleep(300);
    PASS(okRevokesOf(rt).length === 1 && attemptsOf(rt) === 1, 'and the token Apple issued is revoked, exactly once', `${attemptsOf(rt)} call(s)`);
    mock.failKeys = false;
    await stop(D2.child);
  }

  section('server log');
  // Our own failure lines and stack traces only — the fx and ads modules log
  // their network misses in words, and an offline run is not a failure here.
  const crash = /apple: sign-in failed|erase: failed|Unhandled|^\s+at\s/m;
  PASS(!crash.test(A.log), 'the keyed server logged no exceptions',
    (A.log.match(new RegExp(`.*(${crash.source}).*`, 'm')) || [''])[0].slice(0, 120));
}

function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 3000).unref();
  });
}

const watchdog = setTimeout(() => {
  console.log('  FAIL  the whole run took longer than 180s');
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  process.exit(1);
}, 180000);

try {
  await main();
} catch (err) {
  failed++;
  console.log(`  FAIL  the run stopped early — ${err?.stack || err}`);
} finally {
  clearTimeout(watchdog);
  await Promise.all(children.map(stop));
  await new Promise((r) => apple.close(r));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(`\n${failed ? 'FAIL' : 'PASS'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
