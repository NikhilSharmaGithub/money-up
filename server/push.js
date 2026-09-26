// Turn notifications.
//
// "It's your turn" is the reason this exists, and it only says it to a player
// whose every tab and phone has gone away — the call site in index.js decides
// that, because it is the only thing that knows. The cup's reminders, a
// friend's invite and the owner's notes ride the same door. This file's whole
// job is the last mile: sign a token, post to the service that reaches the
// phone, and be honest in the log about what happened.
//
// Two services, one per kind of phone: an iPhone is reached through Apple
// (APNs, over HTTP/2), an Android phone through Google (FCM's HTTP v1 API).
// Each is dark until its own credential is found, independently of the other,
// and a player with one of each hears on both.
//
// No SDK for either. APNs is two things — an ES256 JWT that Node's crypto can
// mint on its own, and an HTTP/2 POST that node:http2 can make on its own. FCM
// is an RS256 JWT traded for an access token, and a JSON POST that fetch can
// make. A dependency here would buy nothing and cost the usual.
//
// Apple is dark until the .p8 is found — pasted into APNS_KEY, a path in it, or
// the Render secret file AuthKey_<APNS_KEY_ID>.p8 (the key and team ids default
// to the team's own; see p8.js for how a pasted key is read). Until then it
// logs what it would have sent, which is how the call site was tested before
// Apple was involved at all. Google waits on a Firebase service account the
// same way — see "Google" below.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http2 from 'node:http2';
import { readP8 } from './p8.js';
import { pushDevicesOf, forgetPushDevice } from './social.js';

// ----------------------------------------------------------------- Apple --

const TOPIC = process.env.APNS_TOPIC || 'com.moneymove.game';
// The team's APNs key ("Pathsure Push") is team-scoped for every topic, so it
// signs for MoneyMove as well. Neither id is a secret; the .p8 is, and lives
// in Render's secret files as AuthKey_<key id>.p8.
const KEY_ID = process.env.APNS_KEY_ID || 'LTT7HNR2DR';
const TEAM_ID = process.env.APNS_TEAM_ID || 'HAK23MQ4FD';
// Sandbox exists for builds signed with a development profile; the store's
// build is signed production, so that is the default and the other is opt-in.
const HOST = process.env.APNS_HOST
  || (process.env.APNS_SANDBOX === '1' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');

/**
 * The signing key, however the operator supplied it: the contents of the .p8
 * pasted into APNS_KEY, a path to the file in it, or — when that is empty or
 * leads nowhere — the Render secret file /etc/secrets/AuthKey_<key id>.p8.
 * p8.js reads all three and forgives what a paste does to a key.
 */
const SIGNING_KEY = readP8({
  value: process.env.APNS_KEY || '',
  varName: 'APNS_KEY',
  keyId: KEY_ID,
  tag: 'push',
  dark: 'staying dark',
});

export const pushReady = !!(SIGNING_KEY && KEY_ID && TEAM_ID);

// Apple asks for a fresh token no more than once an hour and no less than
// once every twelve; an hour is the obvious middle and costs one signature.
let cached = { token: '', at: 0 };
function bearer() {
  const now = Date.now();
  if (cached.token && now - cached.at < 55 * 60 * 1000) return cached.token;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: KEY_ID });
  const body = b64({ iss: TEAM_ID, iat: Math.floor(now / 1000) });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`),
    { key: SIGNING_KEY, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  cached = { token: `${head}.${body}.${sig}`, at: now };
  return cached.token;
}

// One connection, reused. APNs would rather have that than a fresh one per
// notification, and a game with four people at a table can produce a few in a
// row. It is dropped on error or on going idle, and the next send reopens it.
let client = null;
let idleTimer = null;
function connection() {
  if (client && !client.closed && !client.destroyed) return client;
  client = http2.connect(HOST);
  client.on('error', (e) => { console.warn('push: connection error —', e.message); client = null; });
  client.on('close', () => { client = null; });
  client.unref?.();
  return client;
}
function goIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { client?.close(); client = null; }, 5 * 60 * 1000);
  idleTimer.unref?.();
}

/** One notification to one device. Resolves to Apple's verdict, never throws. */
function post(deviceToken, payload) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const req = connection().request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${bearer()}`,
        'apns-topic': TOPIC,
        'apns-push-type': 'alert',
        // A turn is worth waking the screen for; it is not worth waking it
        // twice, so a later one for the same table replaces the one before.
        'apns-priority': '10',
        'apns-collapse-id': payload.collapseId || 'turn',
        'content-type': 'application/json',
      });
      let status = 0, body = '';
      req.on('response', (h) => { status = Number(h[':status']) || 0; });
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; });
      req.on('end', () => finish({ status, body }));
      req.on('error', (e) => finish({ status: 0, body: e.message }));
      req.setTimeout(10000, () => { req.close(); finish({ status: 0, body: 'timed out' }); });
      req.end(JSON.stringify(payload.aps));
    } catch (e) {
      finish({ status: 0, body: e.message });
    }
  });
}

/**
 * Apple's half of sendTurnPush, exactly as it was when Apple was the only
 * half: the same dark line, the same request, the same pruning.
 */
function sendToApple(profileToken, devices, text, collapseId) {
  if (!pushReady) {
    console.log(`push (dark): would send "${String(text || '').slice(0, 80)}" to ${devices.length} device(s)`);
    return { sent: 0, reason: 'push not configured' };
  }

  const payload = {
    collapseId,
    aps: {
      aps: {
        alert: { title: 'MoneyMove', body: String(text || '').slice(0, 180) },
        sound: 'default',
        'interruption-level': 'active',
      },
    },
  };

  for (const d of devices) {
    post(d.device, payload).then(({ status, body }) => {
      if (status === 200) return;
      // Gone for good — Apple says so in two different ways.
      const reason = (() => { try { return JSON.parse(body).reason; } catch { return ''; } })();
      if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') {
        forgetPushDevice(profileToken, d.device);
        console.log(`push: dropped a device Apple has forgotten (${reason || status})`);
        return;
      }
      console.warn(`push: ${status || 'no response'} ${reason || body.slice(0, 120)}`);
    }).finally(goIdle);
  }
  return { sent: devices.length, reason: 'queued' };
}

// ---------------------------------------------------------------- Google --
// Firebase Cloud Messaging, HTTP v1, in three steps:
//
//   1. A service account — the JSON Firebase's console hands over under
//      Project settings → Service accounts → Generate new private key. It
//      holds an RSA key and the address that key belongs to.
//   2. A JWT signed with that key, traded at Google's token endpoint for an
//      access token good for an hour. It is kept until a minute before it
//      lapses, so a busy evening costs one trade an hour, not one a buzz.
//   3. One POST per phone to projects/<id>/messages:send.
//
// The account reaches this server the ways Apple's key does: its JSON pasted
// into FCM_SERVICE_ACCOUNT, a path to the file in it, or — when that is empty
// or leads nowhere — the Render secret file /etc/secrets/firebase-sa.json.
// The repository is public, so the account is never in it. (The phone's
// google-services.json is a different thing: it names the project and can
// send nothing.)

const SA_SECRET_FILE = '/etc/secrets/firebase-sa.json';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const GOOGLE_FCM = 'https://fcm.googleapis.com';

// A test points both of Google's addresses at a stand-in on this machine, and
// only a test can: never on Render, never in production, and never at
// anything but loopback. The access token rides every one of these requests,
// and it is not something to hand to whatever a stray variable happens to
// name.
const TESTING = !process.env.RENDER && process.env.NODE_ENV !== 'production';
function testUrl(value) {
  if (!TESTING || !value) return '';
  try {
    const u = new URL(value);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
    return local && /^https?:$/.test(u.protocol) ? String(value).replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}
const FCM_BASE = testUrl(process.env.FCM_TEST_BASE) || GOOGLE_FCM;
const TEST_TOKEN_URI = testUrl(process.env.FCM_TEST_TOKEN_URI);

/**
 * What a service account's text looked like, in counts only — enough to tell
 * a truncated paste from a mangled one, and nothing that is any part of it.
 * (JSON.parse's own complaint quotes the text it choked on, which is why no
 * parse error from here ever reaches the log.)
 */
function describeText(text) {
  const t = String(text || '');
  return `${t.length} chars, ${t.split(/\r?\n/).length} lines, `
    + `${/"private_key"/.test(t) ? 'has' : 'no'} private_key, ${/"client_email"/.test(t) ? 'has' : 'no'} client_email`;
}

/**
 * The account's JSON, through what a paste does to it: a byte-order mark,
 * quotes around the whole thing (or the whole thing escaped as one JSON
 * string), and the key's line breaks turned from \n escapes into real ones —
 * which JSON will not have inside a string, and which are only whitespace in
 * a PEM, so they become spaces and loadRsa reads the base64 between them.
 */
function parseAccount(text) {
  let t = String(text || '').replace(/^\uFEFF/, '').trim();
  for (let tries = 0; tries < 5; tries++) {
    let v;
    try {
      v = JSON.parse(t);
    } catch {
      const quoted = /^(['"`])([\s\S]*)\1$/.exec(t);
      if (quoted) { t = quoted[2].trim(); continue; }
      const flat = t.replace(/[\r\n\t]+/g, ' ');
      if (flat !== t) { t = flat; continue; }
      return null;
    }
    if (typeof v === 'string') { t = v.replace(/^\uFEFF/, '').trim(); continue; }
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  }
  return null;
}

/** A service account sent as base64 — a common way to fit JSON into one line. */
function fromBase64(value) {
  if (!/^[A-Za-z0-9+/_=\s-]{80,}$/.test(value)) return '';
  const text = Buffer.from(value.replace(/\s+/g, ''), 'base64').toString('utf8').trim();
  return text.startsWith('{') && text.includes('private_key') ? text : '';
}

/**
 * The account's RSA key: as given first (with any \n escapes a paste left
 * behind turned back into line breaks), then as the base64 between its marker
 * lines, read as the PKCS#8 bytes Google issued. Throws the first error when
 * neither works, since that is the one that describes the text as it arrived.
 */
function loadRsa(text) {
  const asRsa = (key) => {
    if (key.asymmetricKeyType !== 'rsa') throw new Error('not an RSA key');
    return key;
  };
  try {
    return asRsa(crypto.createPrivateKey(String(text).replace(/\\r/g, '').replace(/\\n/g, '\n')));
  } catch (first) {
    const der = Buffer.from(String(text || '')
      .replace(/\\[nr]/g, '\n')
      .replace(/-{2,}\s*(BEGIN|END)[^-]*-{2,}/gi, '\n')
      .replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
    if (der.length < 256) throw first;
    try {
      return asRsa(crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }));
    } catch {
      throw first;
    }
  }
}

/** Only ever Google's own token endpoint, whatever the file says, outside a test. */
function tokenUriOf(sa) {
  if (TEST_TOKEN_URI) return TEST_TOKEN_URI;
  try {
    const u = new URL(String(sa.token_uri || ''));
    if (u.protocol === 'https:' && u.hostname.endsWith('.googleapis.com')) return u.href;
  } catch { /* not a URL: use Google's */ }
  return GOOGLE_TOKEN_URI;
}

/**
 * The service account, or why there is none. Never throws, and says nothing
 * in the log that is any part of the account.
 */
function readServiceAccount() {
  const value = String(process.env.FCM_SERVICE_ACCOUNT || '').replace(/^\uFEFF/, '').trim();
  let text = '';
  let from = '';
  if (/[{}]|private_key/.test(value)) {
    text = value;
    from = 'FCM_SERVICE_ACCOUNT';
  } else if (fromBase64(value)) {
    text = fromBase64(value);
    from = 'FCM_SERVICE_ACCOUNT';
  } else {
    // A path, perhaps quoted — or nothing, and then the secret file.
    const named = value.replace(/^(['"])(.*)\1$/, '$2').trim();
    for (const candidate of [named, SA_SECRET_FILE].filter(Boolean)) {
      try {
        text = fs.readFileSync(candidate, 'utf8');
        from = candidate === SA_SECRET_FILE ? SA_SECRET_FILE : 'the file FCM_SERVICE_ACCOUNT names';
        break;
      } catch { /* try the next place */ }
    }
  }
  if (!text) {
    // Nothing set anywhere is a feature nobody has switched on yet. Something
    // set that led nowhere is worth saying louder.
    return value
      ? { why: `FCM_SERVICE_ACCOUNT is neither a service account nor a readable file, and there is no ${SA_SECRET_FILE}`, loud: true }
      : { why: 'no service account', loud: false };
  }

  const sa = parseAccount(text);
  if (!sa) return { why: `the service account in ${from} is not JSON (${describeText(text)})`, loud: true };
  if (sa.project_info && !sa.private_key) {
    return { why: `${from} holds google-services.json, the phone's half — the server needs a service account key`, loud: true };
  }
  const missing = ['project_id', 'client_email', 'private_key']
    .filter((k) => typeof sa[k] !== 'string' || !sa[k].trim());
  if (missing.length) return { why: `the service account in ${from} has no ${missing.join(', ')}`, loud: true };
  const projectId = String(process.env.FCM_PROJECT_ID || sa.project_id).trim();
  if (!/^[a-z0-9-]{1,64}$/i.test(projectId)) return { why: `the project id in ${from} is not one`, loud: true };

  let key;
  try {
    key = loadRsa(sa.private_key);
  } catch (err) {
    const k = String(sa.private_key);
    return {
      why: `the key in ${from} would not load (${String(err.message).slice(0, 60)}; ${k.length} chars, `
        + `begin marker ${/BEGIN\s+PRIVATE\s+KEY/i.test(k) ? 'yes' : 'no'}, end marker ${/END\s+PRIVATE\s+KEY/i.test(k) ? 'yes' : 'no'})`,
      loud: true,
    };
  }
  return {
    account: {
      projectId,
      email: sa.client_email.trim(),
      keyId: typeof sa.private_key_id === 'string' ? sa.private_key_id.trim() : '',
      key,
      tokenUri: tokenUriOf(sa),
    },
  };
}

const SA = readServiceAccount();
const ACCOUNT = SA.account || null;

/** Whether a Firebase service account was found and its key loads. */
export const fcmReady = !!ACCOUNT;

// One line at boot, whichever way it went: the owner reads this log to learn
// whether the secret file took, and silence would answer nothing.
if (ACCOUNT) {
  const testing = FCM_BASE !== GOOGLE_FCM || TEST_TOKEN_URI ? ', test endpoints' : '';
  console.log(`push: fcm on (project ${ACCOUNT.projectId}${testing})`);
} else if (SA.loud) {
  console.warn(`push: fcm off — ${SA.why}`);
} else {
  console.log(`push: fcm off — ${SA.why}`);
}

// The access token, kept until a minute before Google says it lapses. One
// trade at a time: a table's worth of sends arriving together, or a burst of
// 401s, all wait on the same trade rather than each starting their own.
let access = { token: '', until: 0 };
let trading = null;
// After a trade fails, when the next one may be tried — a key Google has
// deleted must not cost a round trip on every turn of every game.
let quietUntil = 0;
// Google turned the account itself down (a deleted key, a disabled account).
// Until a trade succeeds again, an Android phone is told nothing will arrive,
// so it keeps the reminders it sets for itself.
let refused = false;
// Google signed the account in and then would not send for the project: the
// FCM API switched off in it, an account without the right to send, a project
// id that names nothing. An access token is issued all the same, so a good
// trade proves none of this; only a send that gets through clears it.
let denied = false;

const tidy = (s, n = 60) => String(s || '').replace(/[^\w .:/-]/g, '').slice(0, n);

/** The RS256 assertion Google trades for an access token. */
function assertion(now) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', typ: 'JWT', ...(ACCOUNT.keyId ? { kid: ACCOUNT.keyId } : {}) });
  const iat = Math.floor(now / 1000);
  const body = b64({ iss: ACCOUNT.email, scope: FCM_SCOPE, aud: ACCOUNT.tokenUri, iat, exp: iat + 3600 });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), ACCOUNT.key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

async function trade() {
  let status = 0;
  let reply = {};
  try {
    const res = await fetch(ACCOUNT.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: assertion(Date.now()),
      }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    status = res.status;
    reply = await res.json().catch(() => ({}));
  } catch (e) {
    reply = { error: e?.name === 'TimeoutError' ? 'timed out' : (e?.cause?.code || 'unreachable') };
  }
  if (status === 200 && typeof reply?.access_token === 'string' && reply.access_token) {
    const life = Number(reply.expires_in) > 0 ? Number(reply.expires_in) : 3600;
    access = { token: reply.access_token, until: Date.now() + Math.max(0, life - 60) * 1000 };
    refused = false;
    quietUntil = 0;
    return access.token;
  }
  // Only a definite no about the account changes what phones are told. A
  // timeout or a busy Google says nothing either way, and must not turn an
  // account Google has just refused back into a promise to every Android
  // phone that registers in the next half minute.
  const turnedDown = status === 400 || status === 401 || status === 403;
  if (turnedDown) refused = true;
  quietUntil = Date.now() + (turnedDown ? 5 * 60 * 1000 : 30 * 1000);
  console.warn(`push: fcm sign-in failed (${status || 'no response'} ${tidy(reply?.error, 40)}) — `
    + `Android pushes wait ${turnedDown ? 'five minutes' : 'half a minute'} before trying again`);
  return '';
}

/** A usable access token, or '' when there is none to be had right now. */
function accessToken() {
  if (access.token && Date.now() < access.until) return Promise.resolve(access.token);
  if (Date.now() < quietUntil) return Promise.resolve('');
  trading ??= trade().finally(() => { trading = null; });
  return trading;
}

/** One message to one phone. Resolves to Google's verdict, never throws. */
async function postFcm(message, token) {
  try {
    const res = await fetch(`${FCM_BASE}/v1/projects/${encodeURIComponent(ACCOUNT.projectId)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(10000),
    });
    return { status: res.status, body: await res.text(), retryAfter: res.headers.get('retry-after') };
  } catch (e) {
    return { status: 0, body: e?.name === 'TimeoutError' ? 'timed out' : 'unreachable', retryAfter: null };
  }
}

/** What went wrong, read out of FCM's error body. */
function fcmError(body) {
  let e = {};
  try { e = JSON.parse(body)?.error || {}; } catch { /* not JSON */ }
  const details = Array.isArray(e.details) ? e.details : [];
  return {
    code: String(details.find((d) => d?.errorCode)?.errorCode || e.status || ''),
    status: String(e.status || ''),
    message: String(e.message || (typeof body === 'string' ? body : '')).slice(0, 120),
    fields: details.flatMap((d) => (Array.isArray(d?.fieldViolations) ? d.fieldViolations : []))
      .map((v) => String(v?.field || '')),
  };
}

// Gone for good. UNREGISTERED is an app deleted or a token rotated. An
// INVALID_ARGUMENT only counts when it is the token Google is complaining
// about: the same code comes back for a malformed message, and pruning on
// that would unregister every Android phone there is on one bad deploy.
const tokenIsDead = (status, why) => (status === 404 && why.code === 'UNREGISTERED')
  || (status === 400 && (why.code === 'INVALID_ARGUMENT' || why.status === 'INVALID_ARGUMENT')
    && (why.fields.includes('message.token') || /registration token/i.test(why.message)));

// Not this phone but the project: every send would get the same answer. A
// SENDER_ID_MISMATCH is also a 403, but it is one token minted for some other
// Firebase project — a stray debug build — and says nothing about the rest.
const projectIsRefused = (status, why) => (status === 403 && why.code !== 'SENDER_ID_MISMATCH')
  || (status === 404 && why.code !== 'UNREGISTERED');

/**
 * How long to wait before the one retry a busy or broken Google gets, or null
 * for no retry at all. Google's own Retry-After is honoured when it is short;
 * one that asks for more than half a minute is a quota spent, and a turn
 * notification that late is not worth holding a request open for.
 */
function backoff(retryAfter) {
  const s = retryAfter == null || retryAfter === '' ? NaN : Number(retryAfter);
  if (Number.isFinite(s) && s >= 0) return s > 30 ? null : s * 1000;
  return 1000 + Math.floor(Math.random() * 1000);
}
const pause = (ms) => new Promise((r) => { setTimeout(r, ms).unref?.(); });

/**
 * One notification to one Android phone, seen through to Google's answer.
 *
 * A 401 is an access token Google no longer takes: trade for a new one and
 * try once more. A 429, a 5xx or no answer at all gets a single retry after a
 * pause — never a loop, because a Google having a bad evening with a table of
 * four each retrying on a timer is how one outage becomes two. A device Google
 * calls dead is dropped from the profile, as Apple's are.
 */
async function deliverFcm(profileToken, device, message) {
  let reauthed = false;
  let retried = false;
  for (;;) {
    const token = await accessToken();
    if (!token) return;                     // the failed trade has said why
    const { status, body, retryAfter } = await postFcm({ token: device.device, ...message }, token);
    if (status === 200) {
      denied = false;
      return;
    }
    const why = fcmError(body);
    // Said to phones as they register (pushSends), and in the warning below.
    if (projectIsRefused(status, why)) denied = true;
    if (status === 401 && !reauthed) {
      reauthed = true;
      // Only this token is stale. Another send may already have traded for a
      // fresh one, and that one stays.
      if (access.token === token) access = { token: '', until: 0 };
      continue;
    }
    if (tokenIsDead(status, why)) {
      forgetPushDevice(profileToken, device.device);
      console.log(`push: dropped a device Google has forgotten (${why.code || status})`);
      return;
    }
    if ((status === 0 || status === 429 || status >= 500) && !retried) {
      const wait = backoff(retryAfter);
      if (wait != null) {
        retried = true;
        await pause(wait);
        continue;
      }
    }
    console.warn(`push: fcm ${status || 'no response'} ${why.code} ${why.message}`.replace(/\s+/g, ' ').trim());
    return;
  }
}

// What each collapse id the server sends under is about, for a phone that has
// to decide which channel it rings on and what a tap opens. The call sites:
//
//   <room id>                    turn    index.js, room.hooks.turn (says so itself)
//   invite                       invite  index.js, POST /api/invite
//   notice                       notice  index.js, POST /api/admin/notice
//   cup:<room>                   cup     index.js seatCupMatches — the table is open
//   cup:last:<room>              cup     index.js sweepCupNoShows — three minutes left
//   cup:<cup>:r<n>:draw | :soon  cup     tournament.js remindersDue — the draw, the warning
//   cup:<cup>:done               cup     tournament.js remindersDue — how it ended
//
// Nothing sends for a DM or a friend request yet; when something does, the
// id's first word says which, and both ring on the social channel.
//
// The three channel ids are the Android app's own — it creates exactly these,
// and a message naming any other lands on its fallback channel instead.
const CHANNELS = {
  turn: 'turns', cup: 'cup', invite: 'social', notice: 'social', dm: 'social', friend: 'social',
};

/** kind, collapse id, and the room or cup a tap should open, all as strings. */
function describe({ collapseId, kind, roomId, cupId } = {}) {
  const id = String(collapseId || 'turn');
  const parts = id.split(':');
  let k = kind && CHANNELS[kind] ? kind : '';
  if (!k) {
    if (id === 'invite' || id === 'notice') k = id;
    else if (parts[0] === 'dm' || parts[0] === 'friend') k = parts[0];
    else if (parts[0] === 'cup') k = 'cup';
    else k = 'turn';
  }
  let room = roomId ? String(roomId) : '';
  let cupRef = cupId ? String(cupId) : '';
  if (k === 'cup' && !room && !cupRef) {
    if (parts[1] === 'last' && parts.length === 3) room = parts[2];
    else if (parts.length === 2) room = parts[1];
    else if (parts.length > 2) cupRef = parts[1];
  }
  // A turn's collapse id is its table.
  if (k === 'turn' && !room && collapseId) room = id;
  return { kind: k, collapseId: id, roomId: room, cupId: cupRef };
}

/** The message every Android phone of this player is sent, less its token. */
function fcmMessage(text, opts) {
  const about = describe(opts);
  // FCM refuses a data value that is not a string, so everything here is one.
  const data = { kind: about.kind, collapseId: about.collapseId };
  if (about.roomId) data.roomId = about.roomId;
  if (about.cupId) data.cupId = about.cupId;
  return {
    notification: { title: 'MoneyMove', body: String(text || '').slice(0, 180) },
    data,
    android: {
      // High, like Apple's priority 10: it is the only way through Doze in
      // time for a door that shuts in three minutes.
      priority: 'high',
      // One waiting per table, or per invite, or per step of a cup, as on an
      // iPhone: the collapse key for Google's queue while the phone is off,
      // the tag for the tray once it is on.
      collapse_key: about.collapseId,
      // A turn that arrives tomorrow is about a game that has moved on, and
      // Google would otherwise hold it for four weeks.
      ttl: '86400s',
      notification: {
        channel_id: CHANNELS[about.kind],
        tag: about.collapseId,
        sound: 'default',
        // The cup wears the trophy, as the phone's own cup reminders do;
        // everything else takes the die the manifest names as the default.
        // A build without the drawable falls back to that default too.
        ...(about.kind === 'cup' ? { icon: 'ic_stat_cup' } : {}),
      },
    },
  };
}

/** Google's half of sendTurnPush. */
function sendToGoogle(profileToken, devices, text, opts) {
  if (!fcmReady) {
    // Not "push (dark):" — that line has always meant an iPhone, and is read
    // as one (test/cup-flow.mjs counts it).
    console.log(`push (dark, android): would send "${String(text || '').slice(0, 80)}" to ${devices.length} device(s)`);
    return { sent: 0, reason: 'fcm not configured' };
  }
  const message = fcmMessage(text, opts);
  for (const d of devices) {
    deliverFcm(profileToken, d, message).catch((e) => console.warn('push: fcm —', e?.message));
  }
  return { sent: devices.length, reason: 'queued' };
}

// ------------------------------------------------------------------ both --

/**
 * Tell a player something happened — "it's your turn" being the whole point.
 *
 * Fire and forget by design: a turn must not wait on Apple or Google, so
 * nothing here is awaited by the caller and every failure ends in the log
 * rather than in the game. A device either service calls gone is dropped from
 * the profile, because a token that will never be delivered to is one more
 * request on every future turn for the rest of that player's life.
 *
 * `collapseId` is what a newer notification replaces an older one by, on
 * both kinds of phone. `kind`, `roomId` and `cupId` are for Android, which is
 * told what a message is about (see describe); a call site that leaves them
 * out has them read off the collapse id.
 */
export function sendTurnPush(profileToken, text, { collapseId, kind, roomId, cupId } = {}) {
  const devices = pushDevicesOf(profileToken);
  const apple = devices.filter((d) => d.platform === 'ios');
  const google = devices.filter((d) => d.platform === 'android');
  if (!apple.length && !google.length) return { sent: 0, reason: 'no devices registered' };

  let sent = 0;
  const reasons = [];
  if (apple.length) {
    const r = sendToApple(profileToken, apple, text, collapseId);
    sent += r.sent;
    reasons.push(r.reason);
  }
  if (google.length) {
    try {
      const r = sendToGoogle(profileToken, google, text, { collapseId, kind, roomId, cupId });
      sent += r.sent;
      reasons.push(r.reason);
    } catch (e) {
      console.warn('push: fcm —', e?.message);
    }
  }
  return { sent, reason: sent ? 'queued' : reasons.join('; ') };
}

/**
 * Whether a phone on this platform will actually hear anything from here.
 *
 * Told to a phone when it registers. The Android app sets its own alarms for
 * a cup's doors because, without a sender, nothing else would wake it; it
 * stands them down only when this says real pushes will come instead. So for
 * Android a credential is not enough: Google must also have taken it (no
 * refused sign-in) and be sending with it (no project-wide refusal since the
 * last send that got through).
 */
export function pushSends(platform) {
  const p = String(platform || '').trim().toLowerCase();
  if (p === 'ios') return pushReady;
  if (p === 'android') return fcmReady && !refused && !denied;
  return false;
}
