// Turn notifications, shipped dark.
//
// The registration path is live — clients can hand us their device tokens
// today via POST /api/push/register — but nothing actually sends until the
// operator supplies APNs credentials. No SDK: when this goes live it will be
// a couple of signed HTTP/2 requests, not a dependency.
//
// TODO(go-live): needs APNS_KEY (the .p8 signing key, inline or a file path),
// APNS_KEY_ID and APNS_TEAM_ID in the environment, with the app's bundle id
// (com.moneymove.game) as the topic. Mint an ES256 JWT from the key, POST to
// api.push.apple.com/3/device/<token> over HTTP/2, and forget device tokens
// that come back 410 Unregistered. Android waits on an FCM key the same way.

import { pushDevicesOf } from './social.js';

const APNS_KEY = process.env.APNS_KEY || '';

/**
 * Tell a player something happened — "it's your turn" being the whole point.
 * Today: log and drop, so the wiring can be watched working in the server
 * log long before Apple is involved. The intended call site is wherever a
 * turn lands on a player whose sockets have all gone away.
 */
export function sendTurnPush(profileToken, text) {
  const devices = pushDevicesOf(profileToken);
  if (!devices.length) return { sent: 0, reason: 'no devices registered' };
  if (!APNS_KEY) {
    console.log(`push (dark): would send "${String(text || '').slice(0, 80)}" to ${devices.length} device(s)`);
    return { sent: 0, reason: 'push not configured' };
  }
  // Unreachable until APNS_KEY exists — the real sender lands here.
  return { sent: 0, reason: 'sender not implemented yet' };
}
