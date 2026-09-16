// Sign in with Apple, the server's half.
//
// Two jobs, and they are the two ends of the same promise.
//
// The first is believing a sign-in. The app used to send Apple's user id and
// nothing else, and a user id is a string: anybody who typed one into a POST
// could mark a profile signed in, and being signed in is what unlocks the
// daily coin and a seat in a cup. So the app now sends the identity token
// Apple minted on the phone, and nothing about the profile changes until
// that token has been checked against Apple's published keys — Apple as the
// issuer, this app as the audience, not expired, and bound to the nonce the
// app asked for, so a token lifted from somebody else's sign-in cannot be
// replayed into this one.
//
// The second is letting go. Apple requires an app that offers the sign-in to
// revoke it when the account is deleted, and revoking needs a token that
// Apple only hands over in exchange for the one-time authorization code. So
// the code is exchanged at sign-in, the refresh token it buys is kept on the
// profile, and it is handed back to Apple when the player signs out or
// deletes themselves. A revocation that cannot be delivered right now goes
// into a small queue on disk and is tried again, because "Apple was having an
// afternoon" must not be the reason somebody's authorization outlives their
// account.
//
// No SDK, for the same reason push.js has none: the client secret is an ES256
// JWT Node's crypto can mint, Apple's tokens are RS256 JWTs it can verify
// against a JWK, and the three endpoints are form POSTs global fetch can make.
// This is the only file in the server that talks to appleid.apple.com.
//
// Verifying needs nothing configured — Apple's keys are public. Exchanging and
// revoking are dark until the Sign in with Apple key is present (the .p8,
// inline or as a path, plus its key id); until then a sign-in still works and
// simply keeps no token, and a revocation already queued waits for the key.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The same data dir social.js keeps the wallets in: the queue is as durable as
// the profiles the tokens came off, and no more.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'apple-revocations.json');
// Dot-prefixed so a backup taken mid-write never lists the half-written copy.
const QUEUE_TMP = path.join(DATA_DIR, '.apple-revocations.json.tmp');

export const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || 'com.moneymove.game';
const TEAM_ID = process.env.APPLE_TEAM_ID || 'HAK23MQ4FD';
// The key id is not a secret (it rides in every client secret's header); the
// .p8 it names is, and lives only in Render's secret files.
const KEY_ID = process.env.APPLE_SIWA_KEY_ID || '6774FV8DJY';
// Where the requests go. Tests point this at a local stand-in; the issuer a
// token has to name is Apple's own and never moves with it.
const BASE = (process.env.APPLE_ID_BASE || 'https://appleid.apple.com').replace(/\/+$/, '');
const ISSUER = 'https://appleid.apple.com';

// A real identity token is well under 2KB. Anything eight times that is not
// one, and is not worth base64-decoding to find out.
const MAX_JWT = 8 * 1024;
const CLOCK_SKEW_S = 60;
const FUTURE_IAT_S = 5 * 60;
// Apple may redeliver a server notification that went unanswered; a week is
// generous for that and still refuses a stale one dug out of a log.
const NOTIFICATION_MAX_AGE_S = 7 * 24 * 60 * 60;

const KEYS_TIMEOUT_MS = 5000;
const EXCHANGE_TIMEOUT_MS = 8000;
const REVOKE_TIMEOUT_MS = 8000;

/** A failure with a short, loggable reason — never a token, never a code. */
const refuse = (reason) => new Error(reason);

// ------------------------------------------------------------ signing key --
/**
 * The Sign in with Apple key, however the operator supplied it: the .p8's
 * contents in APPLE_SIWA_KEY (newlines intact or written as \n), a path to
 * the file in the same variable, or — with neither — the secret file Render
 * mounts at /etc/secrets/AuthKey_<key id>.p8.
 *
 * It is loaded once and checked once. A key that will not parse, or parses as
 * something other than the P-256 key Apple issues, is a warning at boot and a
 * dark feature afterwards — not a stack trace on the first player who signs
 * out.
 */
const SIGNING_KEY = (() => {
  const raw = process.env.APPLE_SIWA_KEY || '';
  let pem = '';
  if (/PRIVATE\s+KEY/i.test(raw)) {
    pem = raw.replace(/\\n/g, '\n');
  } else if (raw) {
    try {
      pem = fs.readFileSync(raw, 'utf8');
    } catch {
      console.warn('appleid: APPLE_SIWA_KEY is neither a key nor a readable file — Apple tokens will not be kept or revoked');
      return null;
    }
  } else if (/^[A-Za-z0-9]{1,32}$/.test(KEY_ID)) {
    try {
      pem = fs.readFileSync(`/etc/secrets/AuthKey_${KEY_ID}.p8`, 'utf8');
    } catch {
      console.warn('appleid: no Sign in with Apple key found (APPLE_SIWA_KEY or /etc/secrets) — Apple tokens will not be kept or revoked');
      return null;
    }
  } else {
    return null;
  }
  try {
    return loadP256(pem);
  } catch (err) {
    console.warn(`appleid: the Sign in with Apple key would not load (${String(err.message).slice(0, 60)}; ${describePaste(pem)}) — Apple tokens will not be kept or revoked`);
    return null;
  }
})();

/**
 * The key as a P-256 private key, from whatever a dashboard's text box did to
 * the .p8 on the way in.
 *
 * The file itself parses as it is. What arrives after a copy and a paste often
 * does not: spaces in front of the first line, a byte-order mark, Windows line
 * endings, every line run into one, dashes a text editor "smartened" into en
 * or em dashes, or the \n escapes of an environment variable left as they
 * were. None of that changes the key — it is the same base64 inside the same
 * two marker lines — so when the text will not parse as given, the base64 is
 * lifted out from between the markers and read as the PKCS#8 bytes Apple
 * actually issued. Only a key that still will not read after that is refused.
 */
function loadP256(text) {
  const asP256 = (key) => {
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('not a P-256 key');
    }
    return key;
  };
  try {
    return asP256(crypto.createPrivateKey(text));
  } catch (first) {
    const der = Buffer.from(pastedBase64(text), 'base64');
    if (der.length < 32) throw first;
    try {
      return asP256(crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }));
    } catch {
      throw first;
    }
  }
}

/** The base64 body of a pasted PEM, with markers, escapes and whitespace gone. */
function pastedBase64(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\\[nr]/g, '\n')
    .replace(/[-\u2010-\u2015\u2212]{2,}\s*(BEGIN|END)[^-\u2010-\u2015\u2212]*[-\u2010-\u2015\u2212]{2,}/gi, '\n')
    .replace(/[^A-Za-z0-9+/=]/g, '');
}

/**
 * What the loaded text looked like, in counts only — enough to tell a
 * truncated paste from a mangled one in a log line, and nothing that is any
 * part of the key.
 */
function describePaste(text) {
  const t = String(text || '');
  const lines = t.split(/\r?\n/).filter((l) => l.trim()).length;
  const begin = /BEGIN\s+PRIVATE\s+KEY/i.test(t);
  const end = /END\s+PRIVATE\s+KEY/i.test(t);
  const odd = (t.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []).length;
  return `${t.length} chars, ${lines} lines, begin marker ${begin ? 'yes' : 'no'}, end marker ${end ? 'yes' : 'no'}, `
    + `${pastedBase64(t).length} base64 chars (a .p8 has 200), ${odd} unusual characters`;
}

if (SIGNING_KEY && !KEY_ID) {
  console.warn('appleid: a Sign in with Apple key is set but APPLE_SIWA_KEY_ID is not — Apple tokens will not be kept or revoked');
}

/** Everything the token endpoints need to accept a request from us. */
export const appleRevokeReady = !!(SIGNING_KEY && KEY_ID && TEAM_ID);

const b64json = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/**
 * The client secret Apple's token and revoke endpoints ask for: a JWT this
 * server signs with the Sign in with Apple key, naming the team as issuer and
 * the app as subject.
 *
 * Apple would accept one that lives for months. An hour is plenty for a
 * server that is up, costs one signature an hour, and means a secret that
 * turns up somewhere it should not have is worth very little by the time it
 * does. It is reused until five minutes before it runs out, so a revocation
 * never goes out carrying one that expires in flight.
 */
let secretCache = { jwt: '', exp: 0 };
function clientSecret() {
  const now = Math.floor(Date.now() / 1000);
  if (secretCache.jwt && secretCache.exp - now > 5 * 60) return secretCache.jwt;
  const exp = now + 60 * 60;
  const head = b64json({ alg: 'ES256', kid: KEY_ID });
  const body = b64json({ iss: TEAM_ID, iat: now, exp, aud: ISSUER, sub: APPLE_CLIENT_ID });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`),
    { key: SIGNING_KEY, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  secretCache = { jwt: `${head}.${body}.${sig}`, exp };
  return secretCache.jwt;
}

// ------------------------------------------------------------ Apple's keys --
// Apple signs identity tokens with one of a handful of RSA keys it publishes
// at /auth/keys and rotates rarely. They are held for hours. A token naming a
// key id we have not seen is either a rotation or a forgery, and the set is
// fetched again to find out — but not more than once a minute, or a stream of
// made-up key ids becomes a way to make this server hammer Apple on somebody
// else's behalf. Until a first set has ever loaded, the wait is five seconds
// instead, so a boot that happened to coincide with a network blip recovers
// on the next sign-in rather than a minute later.
const JWKS_TTL_MS = 6 * 60 * 60 * 1000;
const JWKS_MIN_GAP_MS = 60 * 1000;
const JWKS_COLD_GAP_MS = 5 * 1000;
let jwks = { keys: new Map(), at: 0 };
let jwksTriedAt = 0;
let jwksInFlight = null;

function fetchAppleKeys() {
  if (jwksInFlight) return jwksInFlight;
  jwksTriedAt = Date.now();
  jwksInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/keys`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(KEYS_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const keys = new Map();
      for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
        // RSA signing keys only. A key of any other type under a familiar kid
        // must never become the thing a token is checked against.
        if (jwk?.kty !== 'RSA' || typeof jwk.kid !== 'string' || !jwk.kid) continue;
        if (jwk.use && jwk.use !== 'sig') continue;
        if (jwk.alg && jwk.alg !== 'RS256') continue;
        try {
          keys.set(jwk.kid, crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' }));
        } catch { /* one unreadable key does not spoil the rest */ }
      }
      if (!keys.size) throw new Error('no usable keys');
      jwks = { keys, at: Date.now() };
    } catch (err) {
      // The old set, if there is one, stays: a key Apple signed with an hour
      // ago still proves what it proved an hour ago.
      console.warn(`appleid: could not refresh Apple's signing keys (${err?.name === 'TimeoutError' ? 'timed out' : String(err?.message).slice(0, 60)})`);
    } finally {
      jwksInFlight = null;
    }
  })();
  return jwksInFlight;
}

async function appleSigningKey(kid) {
  if (jwks.keys.has(kid) && Date.now() - jwks.at < JWKS_TTL_MS) return jwks.keys.get(kid);
  const gap = jwks.keys.size ? JWKS_MIN_GAP_MS : JWKS_COLD_GAP_MS;
  if (jwksInFlight || Date.now() - jwksTriedAt >= gap) await fetchAppleKeys();
  return jwks.keys.get(kid) || null;
}

// --------------------------------------------------------------- verifying --
function decodeJwt(jwt) {
  if (typeof jwt !== 'string' || !jwt || jwt.length > MAX_JWT) throw refuse('malformed token');
  const parts = jwt.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) throw refuse('malformed token');
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw refuse('malformed token');
  }
  const isObject = (o) => o && typeof o === 'object' && !Array.isArray(o);
  if (!isObject(header) || !isObject(payload)) throw refuse('malformed token');
  return {
    header,
    payload,
    signingInput: Buffer.from(`${parts[0]}.${parts[1]}`),
    signature: Buffer.from(parts[2], 'base64url'),
  };
}

/**
 * The checks every JWT from Apple has to pass, whatever it is carrying: an
 * RS256 signature — the algorithm is decided here, never by the token, so
 * "none" and an HMAC keyed with Apple's public key are both just refusals —
 * by one of Apple's published keys, for this app.
 */
async function verifyAppleJwt(jwt) {
  const { header, payload, signingInput, signature } = decodeJwt(jwt);
  if (header.alg !== 'RS256') throw refuse('unexpected algorithm');
  if (typeof header.kid !== 'string' || !header.kid || header.kid.length > 64) throw refuse('missing key id');
  const key = await appleSigningKey(header.kid);
  if (!key) throw refuse('unknown signing key');
  let valid = false;
  try {
    valid = crypto.verify('sha256', signingInput, key, signature);
  } catch {
    valid = false;
  }
  if (!valid) throw refuse('bad signature');
  const aud = payload.aud;
  if (!(aud === APPLE_CLIENT_ID || (Array.isArray(aud) && aud.includes(APPLE_CLIENT_ID)))) {
    throw refuse('wrong audience');
  }
  return payload;
}

const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const truthy = (v) => v === true || v === 'true';

/**
 * The nonce ties an identity token to the one sign-in that asked for it. The
 * app makes a random string, gives Apple its SHA-256, and sends us the
 * original; Apple writes the hash into the token. A token that carries a
 * nonce is only good alongside the string that hashes to it, and a caller who
 * says it used a nonce is not believed when the token it sends has none.
 */
function checkNonce(claims, rawNonce) {
  const raw = typeof rawNonce === 'string' ? rawNonce : '';
  const bound = typeof claims.nonce === 'string' && claims.nonce !== '';
  if (!bound) {
    if (raw) throw refuse('token carries no nonce');
    return;
  }
  if (!raw) throw refuse('nonce required');
  if (sha256hex(raw) !== claims.nonce) throw refuse('nonce mismatch');
}

async function identityClaims(jwt, { nonce } = {}) {
  const claims = await verifyAppleJwt(jwt);
  if (claims.iss !== ISSUER) throw refuse('wrong issuer');
  const now = Date.now() / 1000;
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S <= now) throw refuse('expired');
  if (typeof claims.iat !== 'number' || claims.iat > now + FUTURE_IAT_S) throw refuse('bad issue time');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw refuse('missing subject');
  checkNonce(claims, nonce);
  return claims;
}

/**
 * The id_token that comes back from /auth/token, read without Apple's keys.
 *
 * It never passed through the app. It is the body of this server's own
 * request to Apple, made over TLS and authenticated with the client secret,
 * and that vouches for it the way a signature would — OpenID Connect Core
 * 3.1.3.7(6) allows exactly this in place of the signature check. All it is
 * wanted for is its subject, to compare with the Apple ID a profile is
 * signed in with.
 *
 * Not needing the keys is the point, not a shortcut. By the time this runs
 * the one-time code is spent and Apple has already issued a refresh token;
 * a key fetch that is slow, failing, or held back by the once-a-minute limit
 * would throw that token away — on the deletion path, for good, with no code
 * left to try again with. No nonce (the one the sign-in carried is not ours to
 * hold any more) and no expiry either: the token is seconds old, and a clock
 * that disagrees with Apple's must not be another way to lose it.
 */
function tokenEndpointClaims(jwt) {
  const { payload: claims } = decodeJwt(jwt);
  if (String(claims.iss || '').replace(/\/$/, '') !== ISSUER) throw refuse('wrong issuer');
  const aud = claims.aud;
  if (!(aud === APPLE_CLIENT_ID || (Array.isArray(aud) && aud.includes(APPLE_CLIENT_ID)))) {
    throw refuse('wrong audience');
  }
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw refuse('missing subject');
  return claims;
}

/**
 * Verify the identity token the app got from Sign in with Apple.
 *
 * Resolves to who Apple says this is, or throws an Error whose message is a
 * short reason fit for a log line. The subject is the only thing the caller
 * should ever record as the login — never a user id the client sent
 * alongside it.
 *
 * @returns {Promise<{sub:string, email:string, emailVerified:boolean, privateEmail:boolean}>}
 */
export async function verifyIdentityToken(jwt, { nonce } = {}) {
  const claims = await identityClaims(jwt, { nonce });
  return {
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email.slice(0, 120) : '',
    emailVerified: truthy(claims.email_verified),
    privateEmail: truthy(claims.is_private_email),
  };
}

/**
 * Apple's server-to-server notification, verified and opened.
 *
 * Same keys, same audience — but these are not sign-ins, and Apple does not
 * promise them an expiry, so what is checked instead is that the issue time
 * is believable: not from the future, not from last month. The events claim
 * is a JSON string inside the JSON; it is parsed here so the route only ever
 * sees a plain object. event_time arrives in milliseconds in practice and in
 * seconds in some of Apple's examples, and comes back as milliseconds either
 * way.
 *
 * @returns {Promise<{type:string, sub:string, eventTime:number|null}>}
 */
export async function verifyServerNotification(payloadJwt) {
  const claims = await verifyAppleJwt(payloadJwt);
  // Apple's own documentation has shown the issuer with a trailing slash; the
  // signature has already said who sent it, so both spellings are Apple.
  if (String(claims.iss || '').replace(/\/$/, '') !== ISSUER) throw refuse('wrong issuer');
  const now = Date.now() / 1000;
  if (typeof claims.iat !== 'number') throw refuse('missing issue time');
  if (claims.iat > now + FUTURE_IAT_S) throw refuse('bad issue time');
  if (claims.iat < now - NOTIFICATION_MAX_AGE_S) throw refuse('stale notification');
  let events = claims.events;
  if (typeof events === 'string') {
    try { events = JSON.parse(events); } catch { throw refuse('unreadable events'); }
  }
  if (!events || typeof events !== 'object') throw refuse('missing events');
  if (typeof events.type !== 'string' || !events.type) throw refuse('missing event type');
  if (typeof events.sub !== 'string' || !events.sub || events.sub.length > 255) throw refuse('missing subject');
  const t = Number(events.event_time);
  const eventTime = Number.isFinite(t) && t > 0 ? (t < 1e12 ? t * 1000 : t) : null;
  return { type: events.type.slice(0, 40), sub: events.sub, eventTime };
}

// --------------------------------------------------------- token endpoints --
/**
 * One form POST to Apple, bounded, and read defensively.
 *
 * The error that comes back is Apple's own error code when Apple sent one in
 * the shape its docs describe (invalid_grant, invalid_client…), and a bare
 * status or "timeout"/"network" otherwise. Nothing Apple wrote beyond that
 * code is passed on, so a log line built from it cannot carry anything else.
 */
async function postForm(pathname, fields, timeoutMs) {
  let res;
  try {
    res = await fetch(`${BASE}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { status: 0, body: {}, error: err?.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
  let body = {};
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  const code = typeof body?.error === 'string' && /^[a-z_]{1,40}$/.test(body.error) ? body.error : '';
  return { status: res.status, body, error: res.ok ? '' : (code || `http_${res.status}`) };
}

/**
 * Trade a one-time authorization code for the refresh token revocation needs.
 *
 * Codes live about five minutes and work once, so this is called while the
 * sign-in (or the deletion) that produced one is still in flight, and it is
 * bounded because both callers are a person waiting on a spinner. The bound
 * is the POST's own timeout, which covers reading the reply as well — and
 * once that reply is in, nothing else is awaited. There used to be a key
 * fetch after it, under one deadline with the POST; a deadline that fired
 * there fired after Apple had issued the token, and the token went nowhere.
 *
 * The subject comes back alongside, so the caller can make sure the code
 * belongs to the Apple ID it thinks it does. It is '' when Apple issued a
 * refresh token but the id_token with it is missing or will not read: the
 * token is still ours (only this app's client secret could have bought it),
 * and a deletion would rather revoke it than lose it. A sign-in treats '' as
 * a mismatch and keeps nothing.
 *
 * Throws with Apple's error code (invalid_grant: stale or used code;
 * invalid_client: our key or ids are wrong) or a short local reason — and
 * only ever before Apple has handed a token over.
 *
 * @returns {Promise<{refreshToken:string, sub:string}>}
 */
export async function exchangeCode(code, { timeoutMs = EXCHANGE_TIMEOUT_MS } = {}) {
  if (!appleRevokeReady) throw refuse('not_configured');
  const c = typeof code === 'string' ? code.trim() : '';
  if (!c || c.length > 1024) throw refuse('malformed_code');
  const r = await postForm('/auth/token', {
    client_id: APPLE_CLIENT_ID,
    client_secret: clientSecret(),
    code: c,
    grant_type: 'authorization_code',
  }, timeoutMs);
  if (r.error) throw refuse(r.error);
  const refreshToken = r.body?.refresh_token;
  if (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > 2048) {
    throw refuse('incomplete_response');
  }
  let sub = '';
  try {
    sub = tokenEndpointClaims(r.body?.id_token).sub;
  } catch (err) {
    console.warn(`appleid: the token endpoint's id_token would not read (${err.message}) — keeping the refresh token without a subject`);
  }
  return { refreshToken, sub };
}

// Apple's documented ErrorResponse codes that describe the token or the
// request itself — the only refusals that will read the same tomorrow.
// invalid_client is deliberately absent: it means our key or ids are wrong,
// and an operator can fix that.
const PERMANENT_REVOKE_ERRORS = new Set([
  'invalid_request', 'invalid_grant', 'unauthorized_client',
  'unsupported_grant_type', 'unsupported_token_type', 'invalid_scope',
]);

/**
 * Hand a token back to Apple. Revoking any one token ends this app's whole
 * authorization for that Apple ID, which is the point — and also why the
 * callers are careful about which token they hand over, and when.
 *
 * Never throws. The verdict says whether trying again could help, and the
 * default is yes. Only a refusal Apple words as one of its documented errors
 * about the token or request (invalid_grant, invalid_request…) is final; a
 * bare 4xx from whatever sits in front of Apple — a CDN's 403 or 404 with an
 * HTML body, a 408 — says nothing about the token and is treated like a 5xx.
 * Apple answers 200 even for a token that is already dead, so giving up on
 * one that might still be alive is the only mistake worth guarding against.
 * The queue's thirty days and its backoff are what keep "retry" bounded.
 *
 * @returns {Promise<{ok:true} | {ok:false, retryable:boolean, reason:string}>}
 */
export async function revokeToken(token, hint = 'refresh_token', { timeoutMs = REVOKE_TIMEOUT_MS } = {}) {
  if (!appleRevokeReady) return { ok: false, retryable: true, reason: 'not_configured' };
  if (typeof token !== 'string' || !token) return { ok: false, retryable: false, reason: 'no_token' };
  let secret;
  try {
    secret = clientSecret();
  } catch {
    return { ok: false, retryable: true, reason: 'signing_failed' };
  }
  const r = await postForm('/auth/revoke', {
    client_id: APPLE_CLIENT_ID,
    client_secret: secret,
    token,
    token_type_hint: hint === 'access_token' ? 'access_token' : 'refresh_token',
  }, timeoutMs);
  if (r.status === 200) return { ok: true };
  const permanent = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429
    && PERMANENT_REVOKE_ERRORS.has(r.error);
  return { ok: false, retryable: !permanent, reason: r.error || 'unknown' };
}

// ------------------------------------------------------ the retry queue --
// Every revocation goes through here, and is written down BEFORE it is tried:
// the account it belonged to is usually already gone by the time Apple is
// asked, so if the process dies mid-request this file is the only place the
// token still exists. A success or a permanent refusal crosses it off; a
// failure that might pass is tried again later, further apart each time, for
// up to thirty days. While the key is not configured nothing is tried and no
// attempt is counted — the entries simply wait for an operator.
//
// Each entry remembers whose Apple ID it was, because a revocation that is
// still waiting can go stale in the one way that hurts: the same person signs
// in again. Nothing was revoked, so their new sign-in rides on the very
// authorization the waiting entry would end — and delivering it an hour later
// would sign them out of a sign-in that worked. A verified sign-in withdraws
// what is waiting for its Apple ID (see withdrawQueuedRevocations).
const RETRY_MS = Math.max(50, Number(process.env.APPLE_REVOKE_RETRY_MS) || 10 * 60 * 1000);
const GIVE_UP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

// Declared before the queue is loaded, which uses it: loadQueue runs while
// this module is still being evaluated, and a const it reached before its
// line would throw — into loadQueue's own catch, which reads as "nothing
// waiting" and silently forgets every revocation on disk.
const cleanSubject = (s) => (typeof s === 'string' ? s.slice(0, 255) : '');

/** @type {Array<{token:string, hint:string, reason:string, subject:string, tries:number, nextAt:number, firstAt:number}>} */
let queue = loadQueue();
/** Tokens with a request to Apple open right now — never two at once. */
const busy = new Set();

function loadQueue() {
  try {
    const raw = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    const seen = new Set();
    return (Array.isArray(raw) ? raw : [])
      .filter((e) => e && typeof e.token === 'string' && e.token && !seen.has(e.token) && seen.add(e.token))
      .map((e) => ({
        token: e.token,
        hint: e.hint === 'access_token' ? 'access_token' : 'refresh_token',
        reason: String(e.reason || '').slice(0, 60),
        // Entries written before subjects were kept have none, and so can
        // never be withdrawn — they are simply delivered, as they always were.
        subject: cleanSubject(e.subject),
        tries: Math.max(0, Number(e.tries) || 0),
        nextAt: Number(e.nextAt) || 0,
        firstAt: Number(e.firstAt) || Date.now(),
      }));
  } catch {
    return []; // nothing waiting, or never written
  }
}

function saveQueue() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Written aside and renamed into place: a crash mid-write leaves the old
    // list rather than half of a new one.
    fs.writeFileSync(QUEUE_TMP, JSON.stringify(queue), { mode: 0o600 });
    fs.renameSync(QUEUE_TMP, QUEUE_FILE);
  } catch (err) {
    console.warn('appleid: could not persist the revocation queue —', err.message);
  }
}

function crossOff(entry) {
  const i = queue.indexOf(entry);
  if (i < 0) return;
  queue.splice(i, 1);
  saveQueue();
}

const backoff = (tries) => Math.min(MAX_BACKOFF_MS, RETRY_MS * 2 ** Math.max(0, tries - 1));

/**
 * A failed attempt that might pass later is booked for later — unless the
 * entry was withdrawn while its request was out, in which case there is no
 * later: it is no longer in the queue, and putting it back would revive a
 * revocation the player's new sign-in has already called off.
 */
function reschedule(entry, reason) {
  if (!queue.includes(entry)) return;
  entry.tries += 1;
  entry.nextAt = Date.now() + backoff(entry.tries);
  saveQueue();
  console.warn(`appleid: revocation attempt ${entry.tries} failed (${reason}) — will retry`);
}

async function attempt(entry) {
  if (busy.has(entry.token)) return { ok: false, retryable: true, reason: 'in_flight' };
  busy.add(entry.token);
  try {
    const verdict = await revokeToken(entry.token, entry.hint);
    if (verdict.ok) {
      crossOff(entry);
      console.log(`appleid: revoked Sign in with Apple access (${entry.reason || 'no reason given'})`);
    } else if (verdict.reason === 'not_configured') {
      // Waiting for a key is not a failed attempt.
    } else if (!verdict.retryable) {
      crossOff(entry);
      console.warn(`appleid: Apple refused a revocation (${verdict.reason}) — not retrying`);
    } else {
      reschedule(entry, verdict.reason);
    }
    return verdict;
  } catch (err) {
    // revokeToken does not throw; this is for the day somebody changes that.
    reschedule(entry, String(err?.message).slice(0, 60));
    return { ok: false, retryable: true, reason: 'error' };
  } finally {
    busy.delete(entry.token);
  }
}

/**
 * Revoke this refresh token: now if Apple answers, later if it does not.
 *
 * Returns the first attempt's verdict as a promise that never rejects, so a
 * caller may await it or — as every request handler does — not. `why` is a
 * few words for the log ("signed out", "account deleted"); the token itself
 * is never logged, here or anywhere. `subject` is the Apple ID the token was
 * issued for, when the caller knows it, so that a later sign-in with that
 * Apple ID can call a waiting revocation off.
 */
export function queueRevocation(refreshToken, why = '', subject = '') {
  const token = typeof refreshToken === 'string' ? refreshToken : '';
  if (!token) return Promise.resolve({ ok: false, retryable: false, reason: 'no_token' });
  let entry = queue.find((e) => e.token === token);
  if (!entry) {
    entry = {
      token, hint: 'refresh_token', reason: String(why || '').slice(0, 60), subject: cleanSubject(subject),
      tries: 0, nextAt: 0, firstAt: Date.now(),
    };
    queue.push(entry);
    saveQueue();
    if (!appleRevokeReady) console.warn(`appleid: revocation queued until the Sign in with Apple key is configured (${entry.reason})`);
  } else if (!entry.subject && subject) {
    entry.subject = cleanSubject(subject);
    saveQueue();
  }
  return attempt(entry);
}

/**
 * The same Apple ID has just signed in again, verified: call off every
 * revocation still waiting for it, and hand the tokens back, newest first.
 *
 * Revoking any of them now would end the authorization the new sign-in
 * stands on. They are still good tokens for it, too — the caller may keep
 * the newest on the profile when the sign-in brought no token of its own, so
 * that a later sign-out or deletion still has something to revoke and the
 * player's earlier request is not quietly lost.
 *
 * A request already on its way to Apple cannot be recalled; the entry is
 * taken out of the queue all the same, so that if that request fails it is
 * not booked again (see reschedule).
 *
 * Only ever called for a sign-in whose identity token verified: a subject
 * somebody merely typed must never be able to cancel a revocation.
 */
export function withdrawQueuedRevocations(subject) {
  if (!subject) return [];
  const withdrawn = queue.filter((e) => e.subject === subject);
  if (!withdrawn.length) return [];
  queue = queue.filter((e) => e.subject !== subject);
  saveQueue();
  console.log(`appleid: ${withdrawn.length} pending revocation(s) withdrawn — the Apple ID signed in again`);
  return withdrawn.sort((a, b) => b.firstAt - a.firstAt).map((e) => e.token);
}

let draining = false;
async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    const now = Date.now();
    for (const entry of [...queue]) {
      // Withdrawn by a sign-in while an earlier entry in this pass was out.
      if (!queue.includes(entry) || busy.has(entry.token)) continue;
      if (now - entry.firstAt > GIVE_UP_MS) {
        crossOff(entry);
        console.warn(`appleid: gave up on a revocation after 30 days and ${entry.tries} attempt(s) (${entry.reason || 'no reason given'})`);
        continue;
      }
      if (!appleRevokeReady || entry.nextAt > now) continue;
      await attempt(entry);
    }
  } catch (err) {
    console.warn('appleid: retry pass failed —', String(err?.message).slice(0, 60));
  } finally {
    draining = false;
  }
}

/**
 * Start working through whatever is waiting. Called once at boot; the timer
 * never keeps the process alive. The first pass comes a little after boot
 * rather than a whole interval later, so a restart does not add ten minutes
 * to a revocation that was already due.
 */
let retryTimer = null;
export function startAppleRevocationRetries() {
  if (retryTimer) return;
  if (queue.length) {
    console.log(`  appleid: ${queue.length} Sign in with Apple revocation(s) waiting to be retried`);
  }
  retryTimer = setInterval(drainQueue, RETRY_MS);
  retryTimer.unref?.();
  const first = setTimeout(drainQueue, Math.min(RETRY_MS, 30 * 1000));
  first.unref?.();
}
