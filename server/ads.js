// Rewarded ads — the switch, not the billboard.
//
// The point of this file is that the day ads go live nothing gets built. The
// whole system already exists and sits dark; the owner flips a toggle on the
// admin desk and it starts serving, on the same process, with no redeploy.
// ADS_ENABLED is only the boot default now — the live answer lives in
// ads.json beside the wallets, so a restart remembers what was decided.
//
// The other half of the job is that a rewarded view has to be worth watching
// and impossible to farm. A win pays two coins and the day pays one to seven,
// so two coins for thirty seconds of video is real money; an endpoint that
// hands them out on request would be a mint. So a claim takes two calls:
//
//   POST /offer   the server decides the player is eligible and issues a
//                 signed, single-use, short-lived ticket
//   POST /reward  the ticket comes back with the provider's proof that the
//                 ad actually finished, and only then do coins move
//
// The ticket is an HMAC over placement, nonce, expiry and the reference the
// reward hangs on, keyed by a server secret and bound to the caller's own
// identity token. A client cannot forge one, cannot spend one twice, cannot
// spend a stale one, and cannot spend someone else's. Behind all of that the
// credit still goes through the ledger, so even a replay that outlived a
// restart lands on an id that has already been paid and pays nothing.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  adsStateOf, creditAdReward, winAwaitingDouble, winForDouble, adsRewardId, adsDayTotals,
  codeForToken, isBanned,
} from './social.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'ads.json');

// The dashboard is guarded by the same key as the rest of the desk. Read the
// same way index.js reads it, so there is exactly one key to remember.
const ADMIN_KEY = process.env.ADMIN_KEY || 'moneymove-admin';

/** The two things a rewarded view can be worth. Nothing else is a placement. */
export const PLACEMENTS = ['doubleWin', 'freeCoins'];

// ---------------------------------------------------------------- settings --
// Every number here is editable from the desk and persisted. The env vars are
// the shape of the world at boot; after that the file wins.
const defaults = () => ({
  // The master switch. ADS_ENABLED=1 still turns the system on at first boot;
  // once the file exists, the admin toggle is the only thing that matters.
  enabled: process.env.ADS_ENABLED === '1',
  // Which adapter the owner has chosen. 'house' needs nothing configured;
  // 'admob' falls back to the house until its ids are filled in.
  provider: 'house',
  placements: {
    // Win a game, watch one ad, take the purse twice. The bonus is whatever
    // the win actually paid, so a rule change upstream can't be arbitraged.
    doubleWin: {
      enabled: true, kind: 'multiplier', factor: 2, dailyCap: 2,
      description: 'Double your win payout',
    },
    // A faucet for the coinless, kept deliberately thin: two coins is one
    // day's login, not a shortcut past the shop.
    freeCoins: {
      enabled: true, kind: 'grant', coins: 2, dailyCap: 4,
      description: 'A few coins for a view',
    },
  },
  caps: {
    // Seconds between two paid claims. Longer than an ad, so the only way to
    // hit it is to be trying.
    minIntervalSec: 90,
    // The ceiling nothing gets past, whatever the per-placement caps say. At
    // the defaults the caps add up to exactly this, so raising one number
    // without raising this one quietly does nothing — which is the point.
    dailyCoinCap: 12,
    // How long a ticket is good for. An ad is thirty seconds; five minutes
    // covers a slow network and a phone call, and nothing else.
    ticketTtlSec: 300,
    // How stale a win may be and still be worth doubling.
    winWindowMin: 20,
  },
  admob: {
    // Account-specific and deliberately left blank: filled in from the desk
    // or the environment the day there is an AdMob account behind them.
    appId: process.env.ADMOB_APP_ID || '',
    units: {
      doubleWin: process.env.ADMOB_UNIT_DOUBLE_WIN || '',
      freeCoins: process.env.ADMOB_UNIT_FREE_COINS || '',
    },
  },
  // Signing key for tickets. Generated once and kept, so an outstanding
  // ticket survives a restart instead of stranding whoever is mid-video.
  // Never leaves this process — the admin read strips it.
  secret: '',
  changedAt: 0,
});

let settings = defaults();

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    settings = merge(defaults(), raw);
    console.log(`  ads: settings restored — ${settings.enabled ? 'ON' : 'dark'}, provider ${settings.provider}`);
  } catch {
    // No file yet: the env vars are the whole configuration, and the first
    // admin change writes one.
  }
  if (!settings.secret) {
    settings.secret = process.env.ADS_SECRET || crypto.randomBytes(32).toString('base64url');
    save();
  }
}

/** Shallow-per-branch merge: unknown keys in the file are ignored, not kept. */
function merge(base, raw) {
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base };
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  if (raw.provider === 'house' || raw.provider === 'admob') out.provider = raw.provider;
  if (typeof raw.secret === 'string' && raw.secret) out.secret = raw.secret;
  if (Number(raw.changedAt) > 0) out.changedAt = Number(raw.changedAt);
  out.placements = { ...base.placements };
  for (const slot of PLACEMENTS) {
    const from = raw.placements?.[slot];
    if (!from || typeof from !== 'object') continue;
    const to = { ...base.placements[slot] };
    if (typeof from.enabled === 'boolean') to.enabled = from.enabled;
    for (const key of ['factor', 'coins', 'dailyCap']) {
      if (to[key] !== undefined && Number.isFinite(Number(from[key]))) to[key] = Number(from[key]);
    }
    out.placements[slot] = to;
  }
  out.caps = { ...base.caps };
  for (const key of Object.keys(base.caps)) {
    if (Number.isFinite(Number(raw.caps?.[key]))) out.caps[key] = Number(raw.caps[key]);
  }
  out.admob = {
    appId: typeof raw.admob?.appId === 'string' ? raw.admob.appId : base.admob.appId,
    units: {
      doubleWin: typeof raw.admob?.units?.doubleWin === 'string' ? raw.admob.units.doubleWin : base.admob.units.doubleWin,
      freeCoins: typeof raw.admob?.units?.freeCoins === 'string' ? raw.admob.units.freeCoins : base.admob.units.freeCoins,
    },
  };
  return out;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.warn('ads: could not persist settings —', err.message);
  }
}

/** The settings as anyone outside this file is allowed to see them. */
const publicSettings = () => {
  const { secret, ...rest } = settings;
  return JSON.parse(JSON.stringify(rest));
};

/**
 * One number off the settings, with a fallback for a number that isn't there.
 *
 * `Number(v) || fallback` would be shorter and is wrong on this file's most
 * important number: it reads a zero as "not set" and hands back the default.
 * An owner who types 0 into the coin ceiling means "nobody earns coins from
 * ads today", and the shortest way to write that check quietly means "no
 * ceiling at all". Every cap here fails closed instead: zero means zero.
 */
const capNum = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** The hard stop on what one device can take from ads in a day. */
const coinCeiling = () => Math.max(0, Math.floor(capNum(settings.caps.dailyCoinCap, 12)));

/** How stale a win may be and still be worth doubling. Zero: nothing is. */
const winWindowMs = () => Math.max(0, capNum(settings.caps.winWindowMin, 20)) * 60000;

// ------------------------------------------------------------------ clocks --
/** When the day's allowances come back — the coming server-local midnight. */
function nextMidnight() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

// ---------------------------------------------------------------- adapters --
// One interface, two implementations. `verify` is the only place a provider
// gets to have an opinion about whether the ad really played; everything else
// — eligibility, caps, the ticket, the coins — is the same either way.
const ADAPTERS = {
  /**
   * The house ad: the game shows its own full-screen promo, so the server
   * already knows the view happened — it served it. The ticket, which the
   * client cannot forge and cannot spend twice, is the whole proof.
   */
  house: {
    id: 'house',
    available: () => true,
    missing: () => '',
    offerExtras: () => ({}),
    verify: async () => ({ ok: true }),
  },

  /**
   * AdMob rewarded, verified the only way that means anything: Google's
   * server-side verification callback. The client never tells us the ad
   * finished — Google does, over a GET to /api/ads/ssv signed with a key from
   * its published key set, carrying our nonce back as custom_data. The claim
   * then presents the ticket and we look for the callback's mark.
   */
  admob: {
    id: 'admob',
    available: () => {
      if (!settings.admob.appId) return false;
      // Every placement that is switched on needs somewhere to serve from.
      return PLACEMENTS.every((slot) => !settings.placements[slot].enabled || !!settings.admob.units[slot]);
    },
    missing: () => {
      const gaps = [];
      if (!settings.admob.appId) gaps.push('app id');
      for (const slot of PLACEMENTS) {
        if (settings.placements[slot].enabled && !settings.admob.units[slot]) gaps.push(`${slot} unit id`);
      }
      return gaps.join(', ');
    },
    // The SDK needs the unit to load, and the nonce has to travel with the
    // impression so the callback can be tied back to the ticket that made it.
    offerExtras: (slot, nonce) => ({ unitId: settings.admob.units[slot] || '', customData: nonce }),
    verify: async (ticket) => {
      const seen = ssvSeen.get(ticket.nonce);
      if (!seen) return { error: 'AdMob has not confirmed that view yet' };
      return { ok: true, transactionId: seen.transactionId };
    },
  },
};

/** The adapter actually serving: the choice, unless the choice can't serve. */
function liveAdapter() {
  const chosen = ADAPTERS[settings.provider] || ADAPTERS.house;
  return chosen.available() ? chosen : ADAPTERS.house;
}

/** One plain line for the desk about who is serving and what is missing. */
export function providerStatus() {
  const chosen = settings.provider;
  const live = liveAdapter().id;
  if (chosen === 'admob' && live === 'admob') {
    return { chosen, live, ok: true, line: 'AdMob is serving — app id and unit ids are configured.' };
  }
  if (chosen === 'admob') {
    return {
      chosen, live, ok: false,
      line: `AdMob keys not configured (${ADAPTERS.admob.missing()}) — house ads are serving.`,
    };
  }
  return { chosen, live, ok: true, line: 'House ads are serving — the game shows its own full-screen promo.' };
}

// ------------------------------------------------------- AdMob's key fetch --
// Google publishes the verifier keys as plain JSON and rotates them; fetched
// on demand and held for a day, exactly like the App Store roots.
// The override exists so the signature path can be exercised against a key
// set we hold the private half of. Nothing sets it in production.
const ADMOB_KEYS_URL = process.env.ADMOB_KEYS_URL || 'https://gstatic.com/admob/reward/verifier-keys.json';
const KEY_TTL_MS = 24 * 60 * 60 * 1000;
let keyCache = null;
let keyCachedAt = 0;

async function admobKeys() {
  if (keyCache && Date.now() - keyCachedAt < KEY_TTL_MS) return keyCache;
  try {
    const res = await fetch(ADMOB_KEYS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const map = new Map();
    for (const k of body.keys || []) {
      if (k.keyId != null && k.pem) map.set(String(k.keyId), String(k.pem));
    }
    if (!map.size) throw new Error('empty key set');
    keyCache = map;
    keyCachedAt = Date.now();
  } catch (err) {
    // A key set we couldn't fetch is not a reason to pay out; it is a reason
    // to refuse until we can. Keep whatever we had rather than clearing it.
    console.warn('ads: could not fetch AdMob verifier keys —', err.message);
    if (!keyCache) return null;
  }
  return keyCache;
}

/**
 * Verify one SSV callback. Google signs the raw query string up to — but not
 * including — `&signature=`, with ECDSA over SHA-256, and names the key it
 * used in `key_id`. Anything we can't prove is dropped on the floor.
 */
async function verifySsvQuery(rawQuery, params) {
  // The '&' has to be part of what we look for: a parameter whose NAME merely
  // ends in "signature" would otherwise cut the signed message short, and a
  // message we got wrong is one we can never verify.
  const at = rawQuery.indexOf('&signature=');
  if (at < 1) return { error: 'No signature' };
  const message = rawQuery.slice(0, at);
  const keyId = String(params.get('key_id') || '');
  const sig = String(params.get('signature') || '');
  if (!keyId || !sig) return { error: 'No signature' };
  const keys = await admobKeys();
  if (!keys) return { error: 'Verifier keys unavailable' };
  const pem = keys.get(keyId);
  if (!pem) return { error: 'Unknown signing key' };
  let ok = false;
  try {
    ok = crypto.verify('sha256', Buffer.from(message, 'utf8'), pem, Buffer.from(sig, 'base64url'));
  } catch {
    ok = false;
  }
  return ok ? { ok: true } : { error: 'Bad signature' };
}

// ----------------------------------------------------------------- tickets --
// Three small books, all in memory and all swept. `issued` is the list of
// offers this process still stands behind — the SSV callback finds its
// ticket here, and a claim is only honoured while the entry is still in it;
// `spent` is the one-shot rule; `ssvSeen` is the provider's mark. None of
// them is the last line of defence — the ledger is — so losing them to a
// restart costs an in-flight view, not a wallet.
const issued = new Map();   // nonce -> { token, placement, exp, ref, at }
const spent = new Map();    // nonce -> exp
const ssvSeen = new Map();  // nonce -> { at, transactionId }

// A claim that is in the middle of being decided, by the wallet it would pay.
// Between reading a ticket and burning it there is an await. Today both
// adapters answer without touching the network, so nothing gets in between —
// but the adapter seam exists precisely so that one day one of them asks a
// provider over HTTP, and on that day this set is the only thing standing
// between a daily cap and twenty claims fired at once. It costs a lookup.
const claiming = new Set(); // token

// An offer costs nothing to ask for and lives for five minutes, so without a
// ceiling a loop that never intends to watch anything is a memory leak with a
// URL. One device gets a few open at once — enough for two tabs and a
// reconnect — and the process holds a bounded number for everybody.
const MAX_OPEN_PER_TOKEN = 3;
const MAX_OPEN = 5000;

// The shortest gap between being handed a ticket and claiming it that could
// possibly have had an ad in it. The house break runs five seconds and the
// shortest rewarded ad anyone sells is longer, so this refuses only the round
// trip nobody watched. It is not the security boundary — the caps are — but
// on the house adapter, where the ticket is the whole proof, it is the one
// thing that makes "watched" mean anything at all.
const MIN_WATCH_MS = 3000;

const ticketTtlMs = () => Math.max(30, capNum(settings.caps.ticketTtlSec, 300)) * 1000;

function sweep(now = Date.now()) {
  for (const [nonce, rec] of issued) if (rec.exp < now) issued.delete(nonce);
  for (const [nonce, exp] of spent) if (exp < now) spent.delete(nonce);
  // The mark outlives the ticket by a minute so a callback that lands as the
  // ticket expires isn't left pointing at nothing.
  for (const [nonce, rec] of ssvSeen) if (now - rec.at > ticketTtlMs() + 60000) ssvSeen.delete(nonce);
}
const sweeper = setInterval(() => sweep(), 60000);
sweeper.unref?.();

const sign = (payload, token) =>
  crypto.createHmac('sha256', settings.secret).update(`${payload}.${token}`).digest('base64url');

/**
 * Make room for one more offer from this device, and say whether the process
 * has room at all. The oldest of a device's open tickets is dropped rather
 * than the new one refused: an offer is superseded by asking again, and a
 * ticket the server has forgotten is dead — `readTicket` will not honour it.
 */
function roomForOffer(token, now = Date.now()) {
  const mine = [];
  for (const [nonce, rec] of issued) if (rec.token === token) mine.push([nonce, rec.at]);
  if (mine.length >= MAX_OPEN_PER_TOKEN) {
    mine.sort((a, b) => a[1] - b[1]);
    for (let i = 0; i <= mine.length - MAX_OPEN_PER_TOKEN; i++) issued.delete(mine[i][0]);
  }
  if (issued.size < MAX_OPEN) return true;
  sweep(now);
  return issued.size < MAX_OPEN;
}

function issueTicket(token, placement, ref) {
  const nonce = crypto.randomBytes(12).toString('base64url');
  const now = Date.now();
  const exp = now + ticketTtlMs();
  const payload = Buffer.from(JSON.stringify({ p: placement, n: nonce, e: exp, r: ref || '' })).toString('base64url');
  issued.set(nonce, { token, placement, exp, ref: ref || '', at: now });
  return { ticket: `${payload}.${sign(payload, token)}`, nonce, exp };
}

/**
 * Read a ticket back. The identity token is not in the ticket — it is in the
 * signature — so a stolen ticket is worthless to anyone else's wallet.
 *
 * The signature proves we wrote it; `issued` proves we still stand behind it.
 * Both are required, which is what stops a device opening offers all evening
 * and spending the pile later: past a handful, the oldest are forgotten, and
 * a forgotten ticket is as dead as a forged one however well it is signed.
 */
function readTicket(raw, token, now = Date.now()) {
  const parts = String(raw || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { error: 'Malformed ticket' };
  const [payload, sig] = parts;
  const want = sign(payload, token);
  const got = Buffer.from(sig);
  const expect = Buffer.from(want);
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) {
    return { error: 'That ticket was not issued by this server' };
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { error: 'Malformed ticket' };
  }
  if (!data || typeof data.n !== 'string' || !PLACEMENTS.includes(data.p)) return { error: 'Malformed ticket' };
  if (!(Number(data.e) > now)) return { error: 'That ticket has expired — watch again' };
  if (spent.has(data.n)) return { error: 'That ticket has already been used' };
  const rec = issued.get(data.n);
  if (!rec || rec.token !== token || rec.placement !== data.p || rec.ref !== String(data.r || '')) {
    return { error: 'That ticket is no longer valid — watch again' };
  }
  // Nothing anyone could have watched fits in here. On the house adapter the
  // ticket is the only proof there is, so a claim that beats its own ad back
  // is the one thing that can be refused without a provider's help.
  if (now - rec.at < MIN_WATCH_MS) return { error: 'That ad has not finished yet' };
  return { ok: true, placement: data.p, nonce: data.n, exp: Number(data.e), ref: String(data.r || '') };
}

// ------------------------------------------------------------- eligibility --
/**
 * Everything that has to be true before an ad is worth serving, in one place
 * so the offer and the claim answer identically. `ref` is empty at the offer,
 * where the placement is still looking for something to pay for, and set at
 * the claim, where the ticket has already decided.
 */
function eligible(token, slot, { ref: pinned = '', now = Date.now() } = {}) {
  if (!settings.enabled) return { error: 'Ads are not enabled on this server', status: 403 };
  const spec = settings.placements[slot];
  if (!spec) return { error: 'Unknown placement', status: 400 };
  if (!spec.enabled) return { error: 'That placement is switched off', status: 403 };
  if (!token) return { error: 'Missing identity', status: 400 };
  if (isBanned(token)) return { error: 'This device cannot earn rewards', status: 403 };

  const state = adsStateOf(token);
  const cap = Math.max(0, Math.floor(capNum(spec.dailyCap, 0)));
  const used = state.views[slot] || 0;
  if (used >= cap) {
    return { error: "That's all of those for today", status: 429, retryAt: nextMidnight() };
  }

  const gapMs = Math.max(0, capNum(settings.caps.minIntervalSec, 0)) * 1000;
  const since = state.lastAt ? now - state.lastAt : Infinity;
  if (since < gapMs) {
    return {
      error: 'Too soon after the last one', status: 429,
      retryAt: state.lastAt + gapMs, retryInSec: Math.ceil((gapMs - since) / 1000),
    };
  }

  // What this view would pay. The double-up pays the win again, so the purse
  // ends up doubled without this file needing to know what a win is worth.
  let coins = 0;
  let ref = '';
  if (spec.kind === 'multiplier') {
    // At the offer this is a search for something to double; at the claim the
    // ticket has already named the win, and that named win is the only one
    // this ticket can ever pay for.
    const win = pinned
      ? winForDouble(token, pinned)
      : winAwaitingDouble(token, { withinMs: winWindowMs(), now });
    if (!win) {
      return {
        error: pinned ? 'That win has already been doubled' : 'No recent win of yours is waiting to be doubled',
        status: 409,
      };
    }
    const factor = Math.max(0, capNum(spec.factor, 2));
    coins = Math.floor(win.coins * (factor - 1));
    ref = win.txn;
  } else {
    coins = Math.max(0, Math.floor(capNum(spec.coins, 0)));
    // A grant has nothing of its own to hang an id on, so the ticket's nonce
    // becomes the id — filled in by the caller once the ticket exists. That
    // keeps two outstanding tickets independent while still making a replay
    // of either one land on an id the ledger has already paid.
    ref = '';
  }
  if (coins <= 0) return { error: 'This placement pays nothing right now', status: 409 };

  if ((state.coins || 0) + coins > coinCeiling()) {
    return {
      error: "That's all the ad coins for today", status: 429, retryAt: nextMidnight(),
    };
  }

  return { ok: true, coins, ref };
}

/** What one more view of this placement would pay this caller, right now. */
function perViewCoins(token, slot, now = Date.now()) {
  const spec = settings.placements[slot];
  if (spec.kind !== 'multiplier') return Math.max(0, Math.floor(capNum(spec.coins, 0)));
  const win = winAwaitingDouble(token, { withinMs: winWindowMs(), now });
  if (!win) return 0; // nothing of theirs is waiting to be doubled
  return Math.max(0, Math.floor(win.coins * (Math.max(0, capNum(spec.factor, 2)) - 1)));
}

/**
 * What is left in each placement today — the number the client's button reads.
 * It answers the question the player is actually asking, which is not "what is
 * my cap" but "will this pay if I watch it": a placement stopped by the coin
 * ceiling reads zero, and so does a double-up with no win behind it. A button
 * that offers a view the claim would refuse is worse than no button.
 */
function remainingFor(token, now = Date.now()) {
  const state = adsStateOf(token);
  const coinsLeft = Math.max(0, coinCeiling() - (state.coins || 0));
  const out = {};
  for (const slot of PLACEMENTS) {
    const spec = settings.placements[slot];
    if (!settings.enabled || !spec.enabled) { out[slot] = 0; continue; }
    const cap = Math.max(0, Math.floor(capNum(spec.dailyCap, 0)));
    const each = perViewCoins(token, slot, now);
    out[slot] = each > 0
      ? Math.min(Math.max(0, cap - (state.views[slot] || 0)), Math.floor(coinsLeft / each))
      : 0;
  }
  return out;
}

/**
 * The config the clients read. The shape the first shipped clients were
 * written against — enabled, provider, placements — is preserved exactly,
 * because an old app on someone's phone still reads it; everything new is a
 * field alongside, never a field moved.
 */
export function configFor(token) {
  const live = liveAdapter();
  const state = adsStateOf(token);
  const remaining = remainingFor(token);
  const placements = {};
  for (const slot of PLACEMENTS) {
    const spec = settings.placements[slot];
    placements[slot] = {
      ...spec,
      enabled: settings.enabled && !!spec.enabled,
      remaining: remaining[slot],
      unitId: live.id === 'admob' ? (settings.admob.units[slot] || '') : '',
    };
  }
  return {
    enabled: !!settings.enabled,
    provider: live.id,
    placements,
    remaining,
    coinsToday: state.coins || 0,
    dailyCoinCap: coinCeiling(),
    minIntervalSec: Math.max(0, capNum(settings.caps.minIntervalSec, 0)),
    resetsAt: nextMidnight(),
  };
}

// ------------------------------------------------------------------ router --
export const adsRouter = express.Router();

const cleanToken = (v) => String(v || '').slice(0, 64);
const cleanSlot = (v) => (PLACEMENTS.includes(String(v)) ? String(v) : '');

adsRouter.get('/config', (req, res) => {
  res.json(configFor(cleanToken(req.query.token)));
});

/**
 * Step one. Nothing is promised and nothing is spent — but the server has
 * already decided this view will be paid for, so the player is never shown
 * thirty seconds of video against a cap they had already hit.
 */
adsRouter.post('/offer', (req, res) => {
  const token = cleanToken(req.body?.token);
  const slot = cleanSlot(req.body?.placement);
  if (!slot) return res.status(400).json({ error: 'Unknown placement' });
  const check = eligible(token, slot);
  if (check.error) {
    return res.status(check.status || 400).json({
      error: check.error, retryAt: check.retryAt, retryInSec: check.retryInSec,
      // A refusal is also the freshest count there is: the button that just
      // failed can take itself off the screen instead of asking again.
      ...(token ? { remaining: remainingFor(token) } : {}),
    });
  }
  // Handing out offers is the one thing here that is free to ask for, so it
  // is the one thing that has to be told when to stop.
  if (!roomForOffer(token)) {
    return res.status(503).json({ error: 'Too many ads in flight right now — try again in a minute.' });
  }

  const live = liveAdapter();
  const { ticket, nonce, exp } = issueTicket(token, slot, check.ref);
  res.json({
    ok: true,
    ticket,
    placement: slot,
    provider: live.id,
    expiresAt: exp,
    reward: { coins: check.coins },
    remaining: remainingFor(token),
    ...live.offerExtras(slot, nonce),
  });
});

/**
 * Step two. The ticket proves the server agreed to this view; the adapter
 * proves the ad actually played. Both, or nothing moves.
 */
adsRouter.post('/reward', async (req, res) => {
  if (!settings.enabled) return res.status(403).json({ error: 'Ads are not enabled on this server' });
  const token = cleanToken(req.body?.token);
  if (!token) return res.status(400).json({ error: 'Missing identity' });

  // One claim per wallet at a time. Everything from the cap check to the
  // credit is one decision, and it has an await in the middle of it; without
  // this, twenty claims fired together would each read the same allowance and
  // each decide it was theirs. Refusing the second one is honest — a player
  // has one ad on screen — and it means the caps are enforced by this file
  // rather than by how quickly the adapter happens to answer today.
  if (claiming.has(token)) {
    return res.status(429).json({ error: 'That claim is already going through' });
  }
  claiming.add(token);
  try {
    return await payClaim(req, res, token);
  } finally {
    claiming.delete(token);
  }
});

async function payClaim(req, res, token) {
  const ticket = readTicket(req.body?.ticket, token);
  if (ticket.error) return res.status(400).json({ error: ticket.error });

  const live = liveAdapter();
  const proof = await live.verify(ticket, req.body || {});
  if (proof.error) return res.status(402).json({ error: proof.error });

  // Verified: the ticket is burnt whatever happens next. A claim that fails a
  // cap from here has still been used, which is the only way to stop someone
  // grinding tickets against the rules until one slips through.
  spent.set(ticket.nonce, ticket.exp);
  issued.delete(ticket.nonce);

  // The caps are re-read here on purpose: thirty seconds is long enough for
  // another tab to have spent the allowance, and the honest answer then is no.
  const check = eligible(token, ticket.placement, { ref: ticket.ref });
  if (check.error) {
    return res.status(check.status || 400).json({
      error: check.error, retryAt: check.retryAt, retryInSec: check.retryInSec,
      remaining: remainingFor(token),
    });
  }

  // A grant has no reference of its own, so it is paid against its own nonce:
  // one ticket, one payment, for ever.
  const ref = check.ref || ticket.nonce;
  const spec = settings.placements[ticket.placement];
  const note = spec.kind === 'multiplier'
    ? `doubled a win (+${check.coins})`
    : `${live.id} rewarded view`;
  const out = creditAdReward(token, adsRewardId(ticket.placement, ref), check.coins, {
    placement: ticket.placement,
    note,
  });
  if (out.error) return res.status(409).json({ ...out, remaining: remainingFor(token) });

  console.log(`ads: paid ${check.coins} coin(s) to ${codeForToken(token) || '?'} for ${ticket.placement} via ${live.id}`);
  return res.json({
    ok: true,
    placement: ticket.placement,
    awarded: out.awarded,
    coins: out.coins,
    remaining: remainingFor(token),
  });
}

/**
 * AdMob's server-side verification callback. Google calls this directly — the
 * client is not in the conversation — so the only thing that matters is the
 * signature. The answer is always 200: a rejected callback is our problem to
 * log, not something to make Google retry forever.
 */
adsRouter.get('/ssv', async (req, res) => {
  const raw = String(req.originalUrl.split('?')[1] || '');
  const params = new URLSearchParams(raw);
  const verdict = await verifySsvQuery(raw, params);
  if (verdict.error) {
    console.warn('ads: rejected an SSV callback —', verdict.error);
    return res.status(200).send('ignored');
  }
  const nonce = String(params.get('custom_data') || '');
  const rec = issued.get(nonce);
  if (!rec) {
    console.warn('ads: SSV callback for an unknown ticket');
    return res.status(200).send('ignored');
  }
  ssvSeen.set(nonce, { at: Date.now(), transactionId: String(params.get('transaction_id') || '') });
  res.status(200).send('ok');
});

// ------------------------------------------------------------------- admin --
// Same key as the rest of the desk, same discipline: reads carry it in the
// query like the dashboard itself, writes carry it in the body so a mutating
// URL never lands in an access log with the key attached.
const guard = (req, res, where) => {
  const key = where === 'body' ? (req.body?.key || '') : (req.query.key || '');
  if (key === ADMIN_KEY) return true;
  res.status(401).json({ error: 'Missing or wrong admin key' });
  return false;
};

adsRouter.get('/admin', (req, res) => {
  if (!guard(req, res, 'query')) return;
  sweep();
  res.json({
    settings: publicSettings(),
    provider: providerStatus(),
    today: adsDayTotals(),
    tickets: { outstanding: issued.size, spent: spent.size, confirmed: ssvSeen.size },
    boot: {
      adsEnabledEnv: process.env.ADS_ENABLED === '1',
      secretFromEnv: !!process.env.ADS_SECRET,
      dataDirEnv: !!process.env.DATA_DIR,
    },
  });
});

/**
 * The flip itself, and every number behind it. A patch, not a replacement:
 * the desk sends only what changed, so two admins on two tabs can't overwrite
 * each other's untouched fields.
 */
adsRouter.post('/admin', (req, res) => {
  if (!guard(req, res, 'body')) return;
  const body = req.body || {};
  const changes = [];

  if (typeof body.enabled === 'boolean' && body.enabled !== settings.enabled) {
    settings.enabled = body.enabled;
    changes.push(`ads ${body.enabled ? 'ON' : 'dark'}`);
  }
  if ((body.provider === 'house' || body.provider === 'admob') && body.provider !== settings.provider) {
    settings.provider = body.provider;
    changes.push(`provider ${body.provider}`);
  }

  for (const slot of PLACEMENTS) {
    const from = body.placements?.[slot];
    if (!from || typeof from !== 'object') continue;
    const spec = settings.placements[slot];
    if (typeof from.enabled === 'boolean' && from.enabled !== spec.enabled) {
      spec.enabled = from.enabled;
      changes.push(`${slot} ${from.enabled ? 'on' : 'off'}`);
    }
    for (const [key, max] of [['coins', 1000], ['factor', 10], ['dailyCap', 50]]) {
      if (spec[key] === undefined || from[key] === undefined || from[key] === '') continue;
      const n = Number(from[key]);
      if (!Number.isFinite(n) || n < 0 || n > max) {
        return res.status(400).json({ error: `${slot}.${key} must be a number from 0 to ${max}` });
      }
      const v = key === 'factor' ? Math.round(n * 100) / 100 : Math.floor(n);
      if (v !== spec[key]) { spec[key] = v; changes.push(`${slot}.${key}=${v}`); }
    }
  }

  const CAP_MAX = { minIntervalSec: 86400, dailyCoinCap: 10000, ticketTtlSec: 3600, winWindowMin: 1440 };
  for (const [key, max] of Object.entries(CAP_MAX)) {
    if (body.caps?.[key] === undefined || body.caps[key] === '') continue;
    const n = Number(body.caps[key]);
    if (!Number.isFinite(n) || n < 0 || n > max) {
      return res.status(400).json({ error: `caps.${key} must be a number from 0 to ${max}` });
    }
    const v = Math.floor(n);
    if (v !== settings.caps[key]) { settings.caps[key] = v; changes.push(`${key}=${v}`); }
  }

  if (body.admob && typeof body.admob === 'object') {
    if (typeof body.admob.appId === 'string' && body.admob.appId.trim() !== settings.admob.appId) {
      settings.admob.appId = body.admob.appId.trim().slice(0, 120);
      changes.push('admob app id');
    }
    for (const slot of PLACEMENTS) {
      const unit = body.admob.units?.[slot];
      if (typeof unit !== 'string' || unit.trim() === settings.admob.units[slot]) continue;
      settings.admob.units[slot] = unit.trim().slice(0, 120);
      changes.push(`admob ${slot} unit`);
    }
  }

  if (!changes.length) return res.json({ ok: true, changed: [], settings: publicSettings(), provider: providerStatus() });

  settings.changedAt = Date.now();
  save();
  console.log(`admin: ads — ${changes.join(', ')}`);
  res.json({ ok: true, changed: changes, settings: publicSettings(), provider: providerStatus() });
});

load();
