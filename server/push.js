// Turn notifications.
//
// "It's your turn" is the only thing this sends, and it only sends it to a
// player whose every tab and phone has gone away — the call site in index.js
// decides that, because it is the only thing that knows. This file's whole
// job is Apple's half: sign a token, open one connection, post to it, and be
// honest in the log about what happened.
//
// No SDK. APNs is two things — an ES256 JWT that Node's crypto can mint on
// its own, and an HTTP/2 POST that node:http2 can make on its own — so a
// dependency here would buy nothing and cost the usual.
//
// Dark until the environment carries all three of APNS_KEY (the .p8, either
// inline or a path to it), APNS_KEY_ID and APNS_TEAM_ID. Until then it logs
// what it would have sent, which is how the call site was tested before Apple
// was involved at all. Android waits on an FCM key the same way.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http2 from 'node:http2';
import { pushDevicesOf, forgetPushDevice } from './social.js';

const TOPIC = process.env.APNS_TOPIC || 'com.moneymove.game';
const KEY_ID = process.env.APNS_KEY_ID || '';
const TEAM_ID = process.env.APNS_TEAM_ID || '';
// Sandbox exists for builds signed with a development profile; the store's
// build is signed production, so that is the default and the other is opt-in.
const HOST = process.env.APNS_HOST
  || (process.env.APNS_SANDBOX === '1' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');

/**
 * The signing key, however the operator supplied it: the contents of the .p8
 * pasted into an environment variable (newlines intact or written as \n, both
 * survive), or a path to the file on disk.
 */
const SIGNING_KEY = (() => {
  const raw = process.env.APNS_KEY || '';
  if (!raw) return '';
  if (raw.includes('BEGIN PRIVATE KEY')) return raw.replace(/\\n/g, '\n');
  try {
    return fs.readFileSync(raw, 'utf8');
  } catch {
    console.warn('push: APNS_KEY is neither a key nor a readable file — staying dark');
    return '';
  }
})();

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
 * Tell a player something happened — "it's your turn" being the whole point.
 *
 * Fire and forget by design: a turn must not wait on Apple, so nothing here
 * is awaited by the caller and every failure ends in the log rather than in
 * the game. A device Apple calls gone (410, or 400 BadDeviceToken) is dropped
 * from the profile, because a token that will never be delivered to is one
 * more request on every future turn for the rest of that player's life.
 */
export function sendTurnPush(profileToken, text, { collapseId } = {}) {
  const devices = pushDevicesOf(profileToken).filter((d) => d.platform === 'ios');
  if (!devices.length) return { sent: 0, reason: 'no devices registered' };
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
