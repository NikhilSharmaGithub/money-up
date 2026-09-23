// Verifying a Google Play purchase.
//
// The Android half of appstore.js, and a different shape of problem. Apple
// hands the app a JWS the phone can prove on its own; Google hands it an
// opaque purchase token that means nothing until Google is asked about it. So
// this is not signature maths — it is one authenticated call to the Play
// Developer API, made by the server, about a token the client cannot forge
// into anything useful.
//
// Nothing here mints coins on its own. With no service account configured the
// call fails closed and the caller refuses the purchase, which is the only
// safe behaviour: a verifier that cannot verify must never say yes.

import crypto from 'node:crypto';
import fs from 'node:fs';

const PACKAGE = 'com.moneymove.game';

/**
 * The service account that may ask Google about this app's purchases.
 *
 * It is a JSON key from the Google Cloud project the Play Console is linked
 * to, with the Android Publisher API enabled and the account granted "View
 * financial data" on the app. It arrives the same way every other key here
 * does: pasted into an environment variable, a path in one, or a Render
 * secret file — see server/p8.js for why that tolerance exists.
 */
function serviceAccount() {
  const raw = process.env.PLAY_SERVICE_ACCOUNT || '';
  const text = raw.trim().startsWith('{')
    ? raw
    : readIfPossible(raw) || readIfPossible('/etc/secrets/play-service-account.json');
  if (!text) return null;
  try {
    const json = JSON.parse(text);
    return json.client_email && json.private_key ? json : null;
  } catch {
    return null;
  }
}

function readIfPossible(path) {
  if (!path) return '';
  try { return fs.readFileSync(path, 'utf8'); } catch { return ''; }
}

/** Whether a purchase could be checked at all, for the boot log and the desk. */
export const playVerifyReady = () => !!serviceAccount();

// ------------------------------------------------------------------ token --
// Google wants an OAuth access token, which it will trade for a signed JWT.
// One at a time, cached until a minute before it expires: a burst of ten
// redemptions should be one round trip to Google's token endpoint, not ten.

let cached = { token: '', exp: 0 };
let inFlight = null;

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.exp - 60 > now) return cached.token;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const sa = serviceAccount();
    if (!sa) return '';
    const header = b64url({ alg: 'RS256', typ: 'JWT' });
    const claim = b64url({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    });
    let assertion;
    try {
      const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claim}`), sa.private_key);
      assertion = `${header}.${claim}.${sig.toString('base64url')}`;
    } catch {
      return '';   // a key that will not load is a key we do not have
    }
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.access_token) return '';
      cached = { token: body.access_token, exp: now + (Number(body.expires_in) || 3600) };
      return cached.token;
    } catch {
      return '';
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// ---------------------------------------------------------------- verify --

/**
 * Ask Google whether this purchase happened, and whether it is still good.
 *
 * @param {string} productId   the SKU the client says it bought
 * @param {string} purchaseToken  what Play handed the client
 * @returns {Promise<{ok:true, orderId:string, productId:string}|{error:string}>}
 */
export async function verifyPlayPurchase(productId, purchaseToken) {
  if (!productId || !purchaseToken) return { error: 'Missing purchase details' };
  const auth = await accessToken();
  if (!auth) {
    // Said plainly, because this is a configuration gap and not a bad
    // purchase: somebody paid, and the honest answer is that this server
    // cannot check it yet.
    return { error: 'Google Play purchases cannot be verified on this server yet' };
  }

  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/`
    + `${encodeURIComponent(PACKAGE)}/purchases/products/`
    + `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  let body;
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${auth}` } });
    body = await res.json();
    if (!res.ok) {
      return { error: body?.error?.message || 'Google would not confirm that purchase' };
    }
  } catch {
    return { error: 'Could not reach Google to check that purchase' };
  }

  // 0 = purchased, 1 = cancelled, 2 = pending. Only the first is money.
  if (Number(body.purchaseState) !== 0) {
    return { error: 'That purchase has not completed' };
  }
  // A consumed purchase is one Google has already been told was handed over.
  // Re-presenting it is either a replay or a client that lost its answer; the
  // ledger's own idempotency (creditPurchase) settles which, so it is not
  // refused here — but an order id is required, because that is the thing the
  // ledger remembers.
  const orderId = String(body.orderId || '');
  if (!orderId) return { error: 'That purchase carries no order id' };
  return { ok: true, orderId, productId };
}
