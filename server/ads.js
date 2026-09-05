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
//
// Google sells the same rewarded ad down two different pipes, and which one a
// player gets is not a decision the owner should have to make twice. AdMob is
// the mobile SDK and the H5 Games Ads API is the browser one, so 'google' is
// ONE setting here and the config endpoint answers each client with the half
// that applies to it: an iPhone is told admob and its unit id, a browser is
// told h5 and its client id, off the same toggle. A network whose ids have not
// been pasted in yet is not a broken button — that client is quietly told
// 'house' and shows the game's own promo until the ids arrive.

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

/**
 * Breaks that pay nothing.
 *
 * An interstitial is a different animal from everything else in this file: no
 * ticket, no nonce, no server-side verification, no coin. Nobody is owed
 * anything for having seen one, so there is nothing to defraud and nothing to
 * check — which is exactly why it must stay outside the rewarded machinery
 * rather than being bolted onto it.
 *
 * The only thing the server owns here is whether it may be shown at all and
 * how often. The client obeys the interval; a client that lies shows itself
 * more ads, which is its own punishment.
 */
export const INTERSTITIALS = ['preGame'];

/**
 * The kinds of client that ask. Not an inventory of operating systems — an
 * inventory of ad surfaces, and the Android build is its own surface even
 * though it is a WebView around the same page money-up serves to Chrome.
 *
 * It is on the house, and that is a policy decision rather than a technical
 * one. H5 Games Ads is AdSense inventory, and AdSense is for websites: Google
 * does not allow it to be served inside an app that wraps a page in a WebView,
 * and tells publishers to use AdMob for apps. The tag would load in there and
 * ads would appear, which is exactly what makes it worth refusing here — the
 * cost of finding out the slow way is not a bad night's revenue, it is the
 * owner's AdSense account, and the browser's ads with it. The day a native
 * Android shell with the AdMob SDK in it ships, this line is the one that
 * changes, to 'admob'.
 */
export const PLATFORMS = ['ios', 'android', 'web'];
const NETWORK_FOR = { ios: 'admob', android: 'house', web: 'h5' };

/**
 * Google's own test ids, published in its docs precisely so that nobody has to
 * point a half-built client at live inventory to find out whether it works.
 * They serve a real ad from Google's test account and are safe to ship at a
 * device; they are NOT safe to leave on, which is why test mode is loud
 * everywhere it appears.
 */
const TEST_IDS = {
  admob: {
    appId: { ios: 'ca-app-pub-3940256099942544~1458002511', android: 'ca-app-pub-3940256099942544~3347511713' },
    unit: { ios: 'ca-app-pub-3940256099942544/1712485313', android: 'ca-app-pub-3940256099942544/5224354917' },
    // Google's published interstitial test ids, from the same page.
    interstitial: { ios: 'ca-app-pub-3940256099942544/4411468910', android: 'ca-app-pub-3940256099942544/1033173712' },
  },
  h5: { clientId: 'ca-pub-3940256099942544' },
};

// ---------------------------------------------------------------- settings --
// Every number here is editable from the desk and persisted. The env vars are
// the shape of the world at boot; after that the file wins.
const defaults = () => ({
  // The master switch. ADS_ENABLED=1 still turns the system on at first boot;
  // once the file exists, the admin toggle is the only thing that matters.
  enabled: process.env.ADS_ENABLED === '1',
  // One switch per family, under the master and over the individual slots.
  // The two are genuinely different products — one trades thirty seconds for
  // coins, the other takes the player's time and gives nothing back — and an
  // owner wanting the second gone at midnight should not have to remember
  // which of four slot switches belonged to it.
  kinds: {
    rewarded: true,
    interstitial: true,
  },
  // Which adapter the owner has chosen. 'house' needs nothing configured;
  // 'google' means the real networks — AdMob on the phone, H5 in the browser —
  // and each falls back to the house on its own until its ids are filled in.
  // 'admob' and 'h5' are still accepted here and mean 'google': that is what
  // an ads.json written before the web network existed says.
  provider: 'house',
  // Google's published test ids instead of the owner's. Everything else works
  // exactly as it does live, which is the point: it is how you find out the
  // client is wired up before there is an account behind it. It also means
  // AdMob cannot send a verification callback — see the adapter — so this is
  // never a state to leave a live server in.
  testMode: false,
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
  // Interstitials, by slot. `everyMinutes` is the shortest gap between two of
  // them — an ad every single game is how an app gets deleted.
  interstitials: {
    preGame: {
      enabled: false,
      everyMinutes: 5,
      description: 'One break while a quick match is being found',
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
    // How long a claim will wait at the door for Google's callback before it
    // gives up and says "not yet". The callback normally beats the client
    // back; when it doesn't, a couple of seconds of patience is the difference
    // between a paid view and a player staring at a refusal for an ad they
    // definitely watched. Zero turns the wait off.
    ssvWaitSec: 5,
  },
  admob: {
    // Account-specific and deliberately left blank: filled in from the desk
    // or the environment the day there is an AdMob account behind them.
    appId: process.env.ADMOB_APP_ID || '',
    units: {
      doubleWin: process.env.ADMOB_UNIT_DOUBLE_WIN || '',
      freeCoins: process.env.ADMOB_UNIT_FREE_COINS || '',
    },
    // Interstitial units are their own kind and their own ids: an AdMob
    // rewarded unit will not serve one, and vice versa.
    interstitialUnits: {
      preGame: process.env.ADMOB_UNIT_PREGAME || '',
    },
    // The ad network id the callback should carry, if the owner wants it
    // pinned. Left blank on purpose: AdMob's own id is 5450213213286189855,
    // but under mediation the callback names whichever network actually filled
    // the slot, so pinning it before you have seen what arrives is a way to
    // reject your own revenue. The desk shows the last one seen; paste that in
    // if you want the check.
    adNetworkId: process.env.ADMOB_AD_NETWORK_ID || '',
  },
  // The browser half: Google's H5 Games Ads, which is AdSense inventory served
  // through adBreak(). The publisher id is the whole configuration; the slot
  // ids are optional and only matter to a client that places a fixed unit.
  h5: {
    clientId: process.env.H5_CLIENT_ID || process.env.ADSENSE_CLIENT_ID || '',
    slots: {
      doubleWin: process.env.H5_SLOT_DOUBLE_WIN || '',
      freeCoins: process.env.H5_SLOT_FREE_COINS || '',
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
  const provider = normalizeProvider(raw.provider);
  if (provider) out.provider = provider;
  if (typeof raw.testMode === 'boolean') out.testMode = raw.testMode;
  if (typeof raw.secret === 'string' && raw.secret) out.secret = raw.secret;
  if (Number(raw.changedAt) > 0) out.changedAt = Number(raw.changedAt);
  out.kinds = { ...base.kinds };
  for (const kind of ['rewarded', 'interstitial']) {
    if (typeof raw.kinds?.[kind] === 'boolean') out.kinds[kind] = raw.kinds[kind];
  }
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
  out.interstitials = { ...base.interstitials };
  for (const slot of INTERSTITIALS) {
    const from = raw.interstitials?.[slot];
    if (!from || typeof from !== 'object') continue;
    const to = { ...base.interstitials[slot] };
    if (typeof from.enabled === 'boolean') to.enabled = from.enabled;
    if (Number.isFinite(Number(from.everyMinutes))) {
      to.everyMinutes = Math.max(0, Math.min(720, Number(from.everyMinutes)));
    }
    out.interstitials[slot] = to;
  }
  out.caps = { ...base.caps };
  for (const key of Object.keys(base.caps)) {
    if (Number.isFinite(Number(raw.caps?.[key]))) out.caps[key] = Number(raw.caps[key]);
  }
  const str = (v, fallback) => (typeof v === 'string' ? v : fallback);
  out.admob = {
    appId: str(raw.admob?.appId, base.admob.appId),
    units: {
      doubleWin: str(raw.admob?.units?.doubleWin, base.admob.units.doubleWin),
      freeCoins: str(raw.admob?.units?.freeCoins, base.admob.units.freeCoins),
    },
    interstitialUnits: {
      preGame: str(raw.admob?.interstitialUnits?.preGame, base.admob.interstitialUnits?.preGame || ''),
    },
    adNetworkId: str(raw.admob?.adNetworkId, base.admob.adNetworkId),
  };
  out.h5 = {
    clientId: str(raw.h5?.clientId, base.h5.clientId),
    slots: {
      doubleWin: str(raw.h5?.slots?.doubleWin, base.h5.slots.doubleWin),
      freeCoins: str(raw.h5?.slots?.freeCoins, base.h5.slots.freeCoins),
    },
  };
  return out;
}

/**
 * The stored provider, in today's vocabulary. There used to be one network and
 * the setting named it; now 'google' names both and the old names are aliases
 * for it. An ads.json written by last year's admin desk therefore keeps
 * meaning what it meant — AdMob on the phone — and gains the browser half for
 * free the day a client id is pasted in.
 */
function normalizeProvider(v) {
  const s = String(v || '');
  if (s === 'house' || s === 'google') return s;
  if (s === 'admob' || s === 'h5' || s === 'adsense') return 'google';
  return '';
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

// --------------------------------------------------------------- platforms --
/**
 * Which kind of client is asking, and whether it was able to say so itself.
 *
 * The two answers do different jobs. `platform` picks the network. `declared`
 * says whether this build knows the field exists at all, which is the only
 * thing that separates an app that can load a rewarded ad from one that
 * cannot — and that distinction is worth a coin.
 *
 * A client that names itself is believed about WHICH browser-shaped surface it
 * is, and disbelieved about being a browser at all when its User-Agent says
 * otherwise. Two stamps beat the field, and both for the same reason: they are
 * things a browser cannot say about itself. URLSession stamps CFNetwork/Darwin
 * and no browser ever does. Android's WebView stamps "; wv" in the token that
 * would otherwise read as Chrome, and the page inside it has no idea — it is
 * the same ui.js Chrome runs, so it declares 'web' in perfect good faith and
 * is wrong. Since 'web' is the surface allowed to load AdSense and a WebView
 * is the surface that must not, that is the one guess in this function that
 * cannot be left to the client.
 *
 * Anything with no opinion either way — curl, a health check, a crawler — is
 * treated as a browser, which is the answer that costs nothing to be wrong
 * about.
 */
function platformOf(req) {
  const raw = req?.query?.platform ?? req?.body?.platform;
  const said = String(raw ?? '').toLowerCase().trim();
  // Anything in the field at all means a build that was written after this
  // field was. A value we don't recognise still says that much, and saying it
  // is the point — see `adapterFor`.
  const declared = said !== '';
  const ua = String(req?.get?.('user-agent') || '');
  const native = /CFNetwork|Darwin/i.test(ua) && !/Mozilla/i.test(ua);
  if (native) return { platform: 'ios', declared };
  // "; wv)" is the WebView's own mark, and Chrome for Android never carries
  // it. Read before the declared field, never after.
  if (/;\s*wv[);]/i.test(ua)) return { platform: 'android', declared };
  if (PLATFORMS.includes(said)) return { platform: said, declared };
  if (said === 'iphone' || said === 'ipad' || said === 'ipados') return { platform: 'ios', declared };
  if (/okhttp|Dalvik|Ktor-client/i.test(ua)) return { platform: 'android', declared };
  return { platform: 'web', declared };
}

// ---------------------------------------------------------------- adapters --
// One interface, three implementations. `verify` is the only place a provider
// gets to have an opinion about whether the ad really played; everything else
// — eligibility, caps, the ticket, the coins — is the same either way.
//
// `available` answers for one platform, because the two Google networks are
// configured independently and the honest answer to "are we ready" is only
// ever "for whom".
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
    surfaces: ['ios', 'android'],
    available: (platform) => {
      if (settings.testMode) return true; // Google's ids need no account
      if (!admobAppId(platform)) return false;
      // Every placement that is switched on needs somewhere to serve from.
      return PLACEMENTS.every((slot) => !settings.placements[slot].enabled || !!admobUnit(slot, platform));
    },
    missing: (platform) => {
      const gaps = [];
      if (!admobAppId(platform)) gaps.push('app id');
      for (const slot of PLACEMENTS) {
        if (settings.placements[slot].enabled && !admobUnit(slot, platform)) gaps.push(`${slot} unit id`);
      }
      return gaps.join(', ');
    },
    // The SDK needs the unit to load, and the nonce has to travel with the
    // impression so the callback can be tied back to the ticket that made it.
    // The user id rides along too: it is not the wallet token — a value that
    // ends up in Google's logs must not be one that spends coins — but a short
    // opaque tag derived from it, which is enough to notice a callback landing
    // against the wrong ticket.
    offerExtras: (slot, nonce, platform) => ({
      unitId: admobUnit(slot, platform),
      customData: nonce,
      userId: ssvUserId(nonce),
      appId: admobAppId(platform),
      test: !!settings.testMode,
    }),
    verify: async (ticket) => {
      const seen = ssvSeen.get(ticket.nonce);
      if (seen) return { ok: true, transactionId: seen.transactionId, note: 'admob rewarded view' };
      // Test mode runs on Google's own ad units, and nobody can set an SSV URL
      // on a unit they do not own — so there is no callback coming and waiting
      // for one would leave a permanently dead button. The ticket is the whole
      // proof here, exactly as it is on the house adapter, and every payout
      // says so in the log so this is never mistaken for verified revenue.
      //
      // Read off the ticket, not the settings. Test mode is one click on the
      // desk, and if this asked the settings it would be a click that pays out
      // every real AdMob view currently in flight without asking Google.
      if (ticket.test) {
        return { ok: true, note: 'admob TEST rewarded view (no server-side verification)' };
      }
      // `pending` is the difference between "no" and "not yet", and it is a
      // field rather than a sentence because a client that has to read English
      // to know whether to come back will one day be given different English.
      // The ticket is deliberately NOT burnt on this answer — it is still good
      // until it expires, which is the only reason a retry can work at all.
      return { error: 'AdMob has not confirmed that view yet', retryInSec: 3, pending: true };
    },
  },

  /**
   * The browser half: Google's H5 Games Ads, the adBreak() API over AdSense
   * inventory. It is deliberately NOT pretending to be AdMob. There is no
   * server-side verification callback in the H5 product at all — Google
   * publishes none — so the only proof a browser can offer is its own word.
   *
   * Rather than invent a confirmation that does not exist, this adapter is
   * honest: the ticket is the proof, the same as the house adapter, and the
   * things that actually bound a web faucet are the ones that always did —
   * one-shot tickets, the interval, the per-placement caps and the daily coin
   * ceiling. Nothing here loosens the AdMob path by a millimetre; the two
   * verify functions never meet.
   */
  h5: {
    id: 'h5',
    surfaces: ['web', 'android'],
    available: () => !!h5ClientId(),
    missing: () => (h5ClientId() ? '' : 'publisher id'),
    offerExtras: (slot) => ({
      clientId: h5ClientId(),
      slot: settings.h5.slots[slot] || '',
      unitId: settings.h5.slots[slot] || '',
      test: !!settings.testMode,
    }),
    verify: async (ticket, body) => {
      // A client that reports the break's outcome is taken at its word in both
      // directions: adBreak() saying it was dismissed is a refusal, not a coin.
      // A client that reports nothing — every browser build shipped before the
      // H5 API existed — is treated the way it was treated yesterday.
      // Absent and false are different answers. A field that is simply not
      // there is an older client; a field that is there and says anything
      // other than "watched" — false, 'dismissed', an empty string — is this
      // client telling us not to pay, and it is taken at its word.
      const reported = body?.outcome ?? body?.signal;
      const said = reported === undefined || reported === null ? null : String(reported).toLowerCase();
      if (said !== null && !H5_WATCHED.has(said)) {
        return { error: 'That ad break did not finish', status: 400 };
      }
      if (Date.now() - ticket.at < H5_MIN_WATCH_MS) {
        return { error: 'That ad has not finished yet', status: 400 };
      }
      return { ok: true, note: `h5 rewarded view${said === null ? ' (client did not report an outcome)' : ''}` };
    },
  },
};

/** What adBreak() calls a break that ran to the end, in every spelling. */
const H5_WATCHED = new Set(['viewed', 'adviewed', 'ad_viewed', 'ok', 'complete', 'completed', 'rewarded', 'true']);

// An H5 rewarded break runs fifteen seconds or more. This is not a security
// boundary — the caps are — but it is the only thing about a web claim that a
// script would have to actually wait out, since it carries no provider's word.
//
// Deliberately UNDER the house break's five seconds rather than equal to it.
// An h5 ticket does not always end up in front of an h5 ad: a blocker, an
// empty slot or an unapproved account all send the player to the house
// countdown instead, and the claim that follows is then five seconds plus a
// round trip old. Setting this to exactly five seconds would make every one of
// those claims a race between two clocks that have no reason to agree, decided
// by network latency. A second of daylight costs nothing and removes the race.
const H5_MIN_WATCH_MS = 4000;

// -------------------------------------------------------------- which ids ---
// Every read of an account id goes through these three, so test mode is one
// decision made once rather than a conditional at each use.
const admobAppId = (platform) =>
  (settings.testMode ? TEST_IDS.admob.appId[platform === 'android' ? 'android' : 'ios'] : settings.admob.appId) || '';
const admobUnit = (slot, platform) =>
  (settings.testMode ? TEST_IDS.admob.unit[platform === 'android' ? 'android' : 'ios'] : settings.admob.units[slot]) || '';
const h5ClientId = () => (settings.testMode ? TEST_IDS.h5.clientId : settings.h5.clientId) || '';
const admobInterstitial = (slot, platform) => (settings.testMode
  ? TEST_IDS.admob.interstitial[platform === 'android' ? 'android' : 'ios']
  : settings.admob.interstitialUnits?.[slot]) || '';

/** The tag that rides to Google as user_id — derived from the nonce, never the token. */
const ssvUserId = (nonce) =>
  crypto.createHmac('sha256', settings.secret).update(`ssv.${nonce}`).digest('base64url').slice(0, 22);

/**
 * The network the owner has chosen for this platform — 'house' when that is
 * the choice, and 'house' again when the chosen network has no ids yet. The
 * fallback is per platform on purpose: AdSense approval and an AdMob account
 * do not arrive on the same day, and the phone should not have to wait for the
 * browser.
 *
 * `declared` is the third way to end up on the house, and it is about the
 * builds already on people's phones. AdMob is the one network whose claim is
 * settled by Google's own callback, and that callback only exists because the
 * client loaded Google's SDK and handed it our nonce. A build that predates
 * that code shows the house ad and then claims — and if we had offered it an
 * AdMob ticket, its claim would wait for a callback nobody was ever going to
 * send, and every player on the shipped version would find both buttons
 * permanently refusing them the day the switch is flipped. Such a build is
 * known by the field it does not send, so it is served the house instead.
 */
function adapterFor(platform = 'web', declared = true) {
  if (settings.provider !== 'google') return ADAPTERS.house;
  const want = ADAPTERS[NETWORK_FOR[platform] || 'h5'] || ADAPTERS.house;
  if (want.id === 'admob' && !declared) return ADAPTERS.house;
  return want.available(platform) ? want : ADAPTERS.house;
}

/**
 * Which adapter a claim is settled against: the one the offer wrote down, and
 * nothing else. Read live, this would be the seam the whole gateway turns on —
 * a ticket cut against AdMob while a player watched thirty seconds of video
 * would settle against the house the moment the owner touched a switch, and
 * pay without Google's word. The network is decided once, at the offer, in a
 * record no client can reach.
 */
const adapterForTicket = (rec) => ADAPTERS[rec?.network] || ADAPTERS.house;

/**
 * One plain line for the desk about who is serving and what is missing —
 * overall, and then per network, because "ready" is now a different answer for
 * the phone and the browser and the desk has to be able to say which.
 */
export function providerStatus() {
  const chosen = settings.provider;
  const per = {};
  for (const platform of PLATFORMS) per[platform] = adapterFor(platform).id;
  const networks = {};
  for (const id of ['admob', 'h5']) {
    const net = ADAPTERS[id];
    // AdMob is configured per app id, and the ios one is the app that exists.
    const probe = id === 'admob' ? 'ios' : 'web';
    const ready = net.available(probe);
    networks[id] = {
      ready,
      test: !!settings.testMode,
      missing: ready ? '' : net.missing(probe),
      serving: chosen === 'google' && ready,
      line: describeNetwork(id, ready),
    };
  }
  const live = per.web === 'house' && per.ios === 'house' ? 'house' : `${per.ios}/${per.web}`;
  let line;
  if (chosen !== 'google') {
    line = 'House ads are serving — the game shows its own full-screen promo.';
  } else if (networks.admob.ready && networks.h5.ready) {
    line = settings.testMode
      ? 'Google TEST ids are serving on both surfaces — AdMob on the app, H5 in the browser. No revenue, and no verification.'
      : 'Google is serving on both surfaces — AdMob on the app, H5 in the browser.';
  } else if (networks.admob.ready) {
    line = `AdMob is serving the app; the browser is on house ads (${networks.h5.missing} not set).`;
  } else if (networks.h5.ready) {
    line = `H5 is serving the browser; the app is on house ads (${networks.admob.missing} not set).`;
  } else {
    line = `Google is chosen but nothing is configured (AdMob: ${networks.admob.missing}; H5: ${networks.h5.missing}) — house ads are serving everywhere.`;
  }
  return {
    chosen, live, per, networks, testMode: !!settings.testMode,
    // `ok` keeps its old meaning for the alert on the overview: true when what
    // is serving is what was asked for.
    ok: chosen !== 'google' || networks.admob.ready || networks.h5.ready,
    line,
  };
}

function describeNetwork(id, ready) {
  const test = settings.testMode ? ' Google test ids are in use — no revenue, and rewards pay without verification.' : '';
  if (id === 'admob') {
    return ready
      ? `AdMob is ready — app id and rewarded unit ids are set.${test}`
      : `AdMob is not configured (${ADAPTERS.admob.missing('ios')}). Paste the ids from the AdMob console.`;
  }
  return ready
    ? `H5 Games Ads is ready — publisher id is set. There is no server-side verification in this product; the caps are the limit.${test}`
    : 'H5 Games Ads is not configured (publisher id). It needs an approved AdSense account.';
}

// ------------------------------------------------------- AdMob's key fetch --
// Google publishes the verifier keys as plain JSON and rotates them; fetched
// on demand and held for a day, exactly like the App Store roots.
// The override exists so the signature path can be exercised against a key
// set we hold the private half of. Nothing sets it in production.
const ADMOB_KEYS_URL = process.env.ADMOB_KEYS_URL || 'https://gstatic.com/admob/reward/verifier-keys.json';

/**
 * What the SSV door has seen. This exists because the thing that goes wrong in
 * production is not a forged callback — it is a callback that never arrives,
 * or arrives and is thrown away, because an SSV URL was typed with a typo in
 * it eight months ago and nobody has looked since. Every rejection is counted
 * and the last one is kept in full, so the desk can answer "is Google actually
 * calling us, and if it is, what are we telling it to go away for".
 */
const ssvLog = {
  ok: 0, rejected: 0,
  lastOkAt: 0, lastOkUnit: '', lastOkNetwork: '', lastOkTxn: '',
  lastRejectAt: 0, lastRejectReason: '', lastRejectUnit: '',
  keysAt: 0, keyCount: 0, keysError: '',
};
const KEY_TTL_MS = 24 * 60 * 60 * 1000;
// A key fetch happens inside a callback Google is waiting on, so it gets a
// short leash. Without one, a hung connection to gstatic would hold the
// request open until the platform's own timeout killed it.
const KEY_FETCH_TIMEOUT_MS = 5000;
// Google rotates the set rather than replacing it, so a signature from an hour
// ago verifies against today's fetch. When the fetch fails we keep serving the
// stale set for a while rather than rejecting every callback — but not for
// ever, because a set we can no longer refresh is a set we can no longer trust
// to have had a compromised key removed from it.
const KEY_STALE_MS = 7 * 24 * 60 * 60 * 1000;
// After a failure, how long before trying gstatic again. Without it a network
// that is down turns every callback into its own five-second wait, which is a
// way of making one outage into two.
const KEY_RETRY_MS = 60000;
let keyCache = null;
let keyCachedAt = 0;
let keyTriedAt = 0;
let keyFetch = null;

async function admobKeys() {
  const now = Date.now();
  if (keyCache && now - keyCachedAt < KEY_TTL_MS) return keyCache;
  if (now - keyTriedAt > KEY_RETRY_MS || !keyTriedAt) {
    // Ten callbacks arriving together should cause one fetch, not ten.
    if (!keyFetch) keyFetch = fetchAdmobKeys().finally(() => { keyFetch = null; });
    await keyFetch;
  }
  if (!keyCache) return null;
  if (Date.now() - keyCachedAt > KEY_STALE_MS) return null;
  return keyCache;
}

async function fetchAdmobKeys() {
  keyTriedAt = Date.now();
  try {
    const res = await fetch(ADMOB_KEYS_URL, { signal: AbortSignal.timeout(KEY_FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const map = new Map();
    for (const k of body.keys || []) {
      if (k.keyId != null && k.pem) map.set(String(k.keyId), String(k.pem));
    }
    if (!map.size) throw new Error('empty key set');
    keyCache = map;
    keyCachedAt = Date.now();
    ssvLog.keysAt = keyCachedAt;
    ssvLog.keyCount = map.size;
  } catch (err) {
    // A key set we couldn't fetch is not a reason to pay out; it is a reason
    // to refuse until we can. Keep whatever we had rather than clearing it.
    console.warn('ads: could not fetch AdMob verifier keys —', err.message);
    ssvLog.keysError = err.message;
  }
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
const issued = new Map();   // nonce -> { token, placement, platform, network, test, exp, ref, at }
const spent = new Map();    // nonce -> exp
const ssvSeen = new Map();  // nonce -> { at, transactionId, adUnit, adNetwork }
// Google's transaction id for a rewarded impression is unique to it. Holding
// the ones already accepted is what turns a captured callback URL — signature
// and all, perfectly valid for ever — from a replayable coin into a single
// event. Swept on the same clock as the tickets it belongs to.
const ssvTxns = new Map(); // transactionId -> at

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
  // A transaction id is worth remembering for as long as the ticket it could
  // be replayed against could still be alive, and no longer.
  for (const [txn, at] of ssvTxns) if (now - at > ticketTtlMs() + 60000) ssvTxns.delete(txn);
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

function issueTicket(token, placement, ref, { platform, network, test }) {
  const nonce = crypto.randomBytes(12).toString('base64url');
  const now = Date.now();
  const exp = now + ticketTtlMs();
  const payload = Buffer.from(JSON.stringify({ p: placement, n: nonce, e: exp, r: ref || '' })).toString('base64url');
  // Everything that decides how hard this ticket will be to redeem is written
  // down here rather than carried in the ticket: which network sold the view,
  // and whether it was sold on Google's test ids. A field a client could edit
  // between the offer and the claim would let it pick the adapter with the
  // weakest proof; a field re-read from the settings at claim time would let a
  // switch flipped mid-video do the same thing by accident. Neither leaves
  // this process.
  issued.set(nonce, { token, placement, platform, network, test: !!test, exp, ref: ref || '', at: now });
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
  return {
    ok: true, placement: data.p, nonce: data.n, exp: Number(data.e), ref: String(data.r || ''),
    // The facts the adapters need and the ticket deliberately does not carry:
    // when this view actually started, which network sold it, on which
    // surface, and whether it was sold on test ids.
    at: rec.at, platform: rec.platform || 'web', network: rec.network || 'house', test: !!rec.test,
  };
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
  // The family switch is checked here as well as in the config a client
  // reads: a client holding a config from before the flip must not be able to
  // claim against it.
  if (settings.kinds?.rewarded === false) {
    return { error: 'Rewarded ads are switched off', status: 403 };
  }
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
    if (!settings.enabled || settings.kinds?.rewarded === false || !spec.enabled) { out[slot] = 0; continue; }
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
export function configFor(token, platform = 'web', declared = true) {
  // A dark server is on the house and says so. Every client checks `enabled`
  // before it reads any of this, so answering 'house' here is belt on top of
  // braces — but it is the belt that keeps a switched-off server from naming a
  // network, publishing an account id, or talking any client, present or
  // future, into fetching a third-party script.
  const live = settings.enabled ? adapterFor(platform, declared) : ADAPTERS.house;
  const state = adsStateOf(token);
  const remaining = remainingFor(token);
  const placements = {};
  for (const slot of PLACEMENTS) {
    const spec = settings.placements[slot];
    placements[slot] = {
      ...spec,
      enabled: settings.enabled && settings.kinds?.rewarded !== false && !!spec.enabled,
      remaining: remaining[slot],
      // `unitId` is the field the first shipped clients read and it still
      // means the same thing: the id this client hands its SDK for this slot.
      // On AdMob that is the rewarded unit; on H5 it is the slot, when there
      // is one; on the house it is empty, as it always was.
      unitId: live.id === 'admob' ? admobUnit(slot, platform)
        : live.id === 'h5' ? (settings.h5.slots[slot] || '') : '',
    };
  }
  // Breaks that pay nothing. Only ever named when ads are on, the slot is on
  // and there is a unit to serve from — a client with no unit shows nothing
  // rather than falling back to a house ad, because there is nothing to fall
  // back to: an interstitial the house serves would be an advert for itself.
  const interstitials = {};
  for (const slot of INTERSTITIALS) {
    const spec = settings.interstitials?.[slot] || {};
    const unitId = live.id === 'admob' ? admobInterstitial(slot, platform) : '';
    interstitials[slot] = {
      enabled: !!(settings.enabled && settings.kinds?.interstitial !== false && spec.enabled && unitId),
      everyMinutes: Math.max(0, Number(spec.everyMinutes) || 0),
      unitId,
    };
  }

  return {
    enabled: !!settings.enabled,
    // Echoed so a client can tell "ads are off" from "this kind is off", and
    // so a future surface has one field to read rather than four.
    kinds: { ...(settings.kinds || { rewarded: true, interstitial: true }) },
    provider: live.id,
    placements,
    interstitials,
    remaining,
    coinsToday: state.coins || 0,
    dailyCoinCap: coinCeiling(),
    minIntervalSec: Math.max(0, capNum(settings.caps.minIntervalSec, 0)),
    resetsAt: nextMidnight(),
    // Everything from here down is new and additive — an old client reads past
    // it without noticing. `platform` is echoed so a client can see which way
    // it was read; `network` is the one object a client needs to boot an SDK,
    // so nothing has to be assembled out of loose fields.
    platform,
    testMode: !!settings.testMode,
    network: live.id === 'admob'
      ? { id: 'admob', appId: admobAppId(platform), test: !!settings.testMode }
      : live.id === 'h5'
        ? { id: 'h5', clientId: h5ClientId(), test: !!settings.testMode }
        : { id: 'house' },
  };
}

// ------------------------------------------------------------------ router --
export const adsRouter = express.Router();

const cleanToken = (v) => String(v || '').slice(0, 64);
const cleanSlot = (v) => (PLACEMENTS.includes(String(v)) ? String(v) : '');

adsRouter.get('/config', (req, res) => {
  const { platform, declared } = platformOf(req);
  res.json(configFor(cleanToken(req.query.token), platform, declared));
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

  const { platform, declared } = platformOf(req);
  const live = adapterFor(platform, declared);
  const { ticket, nonce, exp } = issueTicket(token, slot, check.ref, {
    platform, network: live.id, test: settings.testMode,
  });
  res.json({
    ok: true,
    ticket,
    placement: slot,
    provider: live.id,
    platform,
    expiresAt: exp,
    reward: { coins: check.coins },
    remaining: remainingFor(token),
    ...live.offerExtras(slot, nonce, platform),
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

  // Settled against the network that SOLD this view, read off the server's own
  // record of the offer. Not off the request, and not off whatever the setting
  // says right now: a ticket issued against AdMob two minutes ago is still an
  // AdMob ticket if the owner has flipped a switch since, and it still needs
  // Google's word before it pays.
  const live = adapterForTicket(ticket);
  let proof = await live.verify(ticket, req.body || {});
  // A rewarded view and its verification callback race each other back, and
  // the client usually wins by a second or two. Refusing on that basis alone
  // would put "not confirmed" in front of a player who watched the whole
  // thing, so the claim waits at the door for a moment before saying no.
  if (proof.error && live.id === 'admob') proof = await waitForSsv(ticket, live, req.body || {});
  if (proof.error) {
    return res.status(proof.status || 402).json({
      error: proof.error, retryInSec: proof.retryInSec,
      // Says out loud that the ticket survived this refusal and the same claim
      // is worth making again. Without it a player who watched thirty seconds
      // of Google's video and beat its callback home keeps neither the coin
      // nor any way of asking for it.
      pending: !!proof.pending,
    });
  }

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
    : proof.note || `${live.id} rewarded view`;
  const out = creditAdReward(token, adsRewardId(ticket.placement, ref), check.coins, {
    placement: ticket.placement,
    note,
  });
  if (out.error) return res.status(409).json({ ...out, remaining: remainingFor(token) });

  // The unverified payouts are the ones worth being able to grep for later:
  // test mode, and the browser, where no server-side proof exists at all.
  const flag = ticket.test && live.id === 'admob' ? ' [TEST — unverified]'
    : live.id === 'h5' ? ' [no server-side verification]' : '';
  console.log(`ads: paid ${check.coins} coin(s) to ${codeForToken(token) || '?'} for ${ticket.placement} via ${live.id}${flag}`);
  return res.json({
    ok: true,
    placement: ticket.placement,
    awarded: out.awarded,
    coins: out.coins,
    remaining: remainingFor(token),
  });
}

/**
 * Give the callback a few seconds to catch up before refusing a claim. Polled
 * rather than signalled because the two arrive on different requests and a
 * shared promise between them would be a lot of machinery for four seconds of
 * waiting. Bounded by the admin's own number, and by nothing else.
 */
async function waitForSsv(ticket, live, body) {
  const budgetMs = Math.min(30, Math.max(0, capNum(settings.caps.ssvWaitSec, 5))) * 1000;
  const deadline = Date.now() + budgetMs;
  let proof = { error: 'AdMob has not confirmed that view yet', retryInSec: 3 };
  while (Date.now() < deadline) {
    await new Promise((r) => { const t = setTimeout(r, 250); t.unref?.(); });
    proof = await live.verify(ticket, body);
    if (!proof.error) return proof;
  }
  return proof;
}

/**
 * AdMob's server-side verification callback. Google calls this directly — the
 * client is not in the conversation — so the only thing that matters is what
 * arrives here and whether it holds up. The answer is always 200: a rejected
 * callback is our problem to log, not something to make Google retry forever.
 *
 * Six things have to be true, and the reason it is written out this long is
 * that five of them are the ones that get quietly misconfigured and never
 * noticed. The signature proves Google sent it. The transaction id proves it
 * is not a callback we have already banked, replayed from an access log. The
 * custom_data names a ticket this process actually issued. The ad_unit is the
 * unit that ticket was offered against — a callback from the wrong unit means
 * an SSV URL pasted onto the wrong ad unit in the console, which is the single
 * most common way this ends up dark. The user_id is the tag we sent with the
 * impression. And ad_network, when the owner has pinned one, is who filled it.
 *
 * Every refusal is logged with its reason and the unit it named, and counted
 * on the desk, because the failure mode here is silence.
 */
adsRouter.get('/ssv', async (req, res) => {
  const raw = String(req.originalUrl.split('?')[1] || '');
  const deny = (reason, unit = '') => {
    ssvLog.rejected += 1;
    ssvLog.lastRejectAt = Date.now();
    ssvLog.lastRejectReason = reason;
    ssvLog.lastRejectUnit = unit;
    console.warn(`ads: rejected an SSV callback — ${reason}${unit ? ` (ad_unit ${unit})` : ' (no ad_unit)'}`);
    return res.status(200).send('ignored');
  };

  // Google's callback is a couple of hundred characters. Anything of a size
  // that could be worth signing-checking as an attack is refused before the
  // crypto, not after.
  if (!raw || raw.length > 4096) return deny('Malformed callback');

  const params = new URLSearchParams(raw);
  const unit = String(params.get('ad_unit') || '').slice(0, 120);
  const verdict = await verifySsvQuery(raw, params);
  if (verdict.error) return deny(verdict.error, unit);

  const txn = String(params.get('transaction_id') || '').slice(0, 120);
  if (!txn) return deny('No transaction id', unit);
  if (ssvTxns.has(txn)) return deny('Replayed transaction id', unit);

  const nonce = String(params.get('custom_data') || '');
  const rec = issued.get(nonce);
  if (!rec) {
    // Either the ticket expired while the ad played, or this callback belongs
    // to a different server. Both are worth saying out loud in a deploy where
    // two instances share one SSV URL.
    return deny(spent.has(nonce) ? 'Ticket already claimed' : 'No open ticket for that custom_data', unit);
  }

  const want = admobUnit(rec.placement, rec.platform);
  if (want && unit && unit !== want) {
    return deny(`Callback is for a different ad unit (expected ${want})`, unit);
  }
  if (!want) {
    // Nothing to compare against means the unit id was cleared after the offer
    // went out. Let it through — the ticket is still ours — but say so.
    console.warn(`ads: SSV callback accepted with no configured unit to check it against (${unit || 'no ad_unit'})`);
  }

  const user = String(params.get('user_id') || '');
  if (user && user !== ssvUserId(nonce)) return deny('Callback user_id does not match the ticket', unit);

  const network = String(params.get('ad_network') || '').slice(0, 64);
  const pinned = String(settings.admob.adNetworkId || '');
  if (pinned && network !== pinned) return deny(`Callback ad_network ${network || '(none)'} is not the pinned ${pinned}`, unit);

  const now = Date.now();
  ssvTxns.set(txn, now);
  ssvSeen.set(nonce, { at: now, transactionId: txn, adUnit: unit, adNetwork: network });
  ssvLog.ok += 1;
  ssvLog.lastOkAt = now;
  ssvLog.lastOkUnit = unit;
  ssvLog.lastOkNetwork = network;
  ssvLog.lastOkTxn = txn;
  console.log(`ads: SSV confirmed ${rec.placement} on ${rec.platform} (ad_unit ${unit || '?'}, network ${network || '?'})`);
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
    // The SSV door's own record. The desk reads this to answer the only
    // question that matters once ids are pasted in: is Google calling, and if
    // it is, is anything here throwing its callbacks away.
    ssv: { ...ssvLog, url: '/api/ads/ssv' },
    // What each kind of client is being told right now, which is the thing the
    // per-platform provider makes hard to hold in your head otherwise.
    platforms: PLATFORMS.map((platform) => ({
      platform, network: adapterFor(platform).id, would: NETWORK_FOR[platform],
    })),
    boot: {
      adsEnabledEnv: process.env.ADS_ENABLED === '1',
      secretFromEnv: !!process.env.ADS_SECRET,
      dataDirEnv: !!process.env.DATA_DIR,
      keysUrlOverride: !!process.env.ADMOB_KEYS_URL,
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
  // 'admob' and 'h5' still arrive here from an admin page cached in somebody's
  // tab since before there were two networks. Both mean 'google' now.
  const wantProvider = normalizeProvider(body.provider);
  if (wantProvider && wantProvider !== settings.provider) {
    settings.provider = wantProvider;
    changes.push(`provider ${wantProvider}`);
  }
  if (typeof body.testMode === 'boolean' && body.testMode !== settings.testMode) {
    settings.testMode = body.testMode;
    changes.push(`test mode ${body.testMode ? 'ON' : 'off'}`);
    if (body.testMode) {
      console.warn('admin: ads TEST MODE is on — Google test ids are serving and rewards pay without server-side verification.');
    }
  }

  settings.kinds ??= { rewarded: true, interstitial: true };
  for (const kind of ['rewarded', 'interstitial']) {
    const want = body.kinds?.[kind];
    if (typeof want !== 'boolean' || want === settings.kinds[kind]) continue;
    settings.kinds[kind] = want;
    changes.push(`${kind} ads ${want ? 'ON' : 'off'}`);
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

  // Breaks that pay nothing: on or off, and how rarely.
  for (const slot of INTERSTITIALS) {
    const from = body.interstitials?.[slot];
    if (!from || typeof from !== 'object') continue;
    const spec = settings.interstitials[slot];
    if (typeof from.enabled === 'boolean' && from.enabled !== spec.enabled) {
      spec.enabled = from.enabled;
      changes.push(`${slot} interstitial ${from.enabled ? 'on' : 'off'}`);
    }
    if (from.everyMinutes !== undefined && from.everyMinutes !== '') {
      const n = Number(from.everyMinutes);
      if (!Number.isFinite(n) || n < 0 || n > 720) {
        return res.status(400).json({ error: `${slot}.everyMinutes must be a number from 0 to 720` });
      }
      const v = Math.floor(n);
      if (v !== spec.everyMinutes) { spec.everyMinutes = v; changes.push(`${slot} every ${v}m`); }
    }
  }

  const CAP_MAX = { minIntervalSec: 86400, dailyCoinCap: 10000, ticketTtlSec: 3600, winWindowMin: 1440, ssvWaitSec: 30 };
  for (const [key, max] of Object.entries(CAP_MAX)) {
    if (body.caps?.[key] === undefined || body.caps[key] === '') continue;
    const n = Number(body.caps[key]);
    if (!Number.isFinite(n) || n < 0 || n > max) {
      return res.status(400).json({ error: `caps.${key} must be a number from 0 to ${max}` });
    }
    const v = Math.floor(n);
    if (v !== settings.caps[key]) { settings.caps[key] = v; changes.push(`${key}=${v}`); }
  }

  // Account ids: trimmed, length-capped, and otherwise taken as typed. They
  // are Google's format to validate, not ours — a server that decided it knew
  // what an ad unit id looks like would be the thing standing between the
  // owner and his revenue the day the format changes.
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
    settings.admob.interstitialUnits ??= {};
    for (const slot of INTERSTITIALS) {
      const unit = body.admob.interstitialUnits?.[slot];
      if (typeof unit !== 'string' || unit.trim() === settings.admob.interstitialUnits[slot]) continue;
      settings.admob.interstitialUnits[slot] = unit.trim().slice(0, 120);
      changes.push(`admob ${slot} interstitial unit`);
    }
    if (typeof body.admob.adNetworkId === 'string' && body.admob.adNetworkId.trim() !== settings.admob.adNetworkId) {
      settings.admob.adNetworkId = body.admob.adNetworkId.trim().slice(0, 64);
      changes.push('admob ad network pin');
    }
  }

  if (body.h5 && typeof body.h5 === 'object') {
    if (typeof body.h5.clientId === 'string' && body.h5.clientId.trim() !== settings.h5.clientId) {
      settings.h5.clientId = body.h5.clientId.trim().slice(0, 120);
      changes.push('h5 publisher id');
    }
    for (const slot of PLACEMENTS) {
      const s = body.h5.slots?.[slot];
      if (typeof s !== 'string' || s.trim() === settings.h5.slots[slot]) continue;
      settings.h5.slots[slot] = s.trim().slice(0, 120);
      changes.push(`h5 ${slot} slot`);
    }
  }

  if (!changes.length) return res.json({ ok: true, changed: [], settings: publicSettings(), provider: providerStatus() });

  settings.changedAt = Date.now();
  save();
  console.log(`admin: ads — ${changes.join(', ')}`);
  res.json({ ok: true, changed: changes, settings: publicSettings(), provider: providerStatus() });
});

// ----------------------------------------------------- the two seller files --
/**
 * ads.txt and app-ads.txt: the two files that decide whether anybody actually
 * bids.
 *
 * They are not part of the gateway and no coin passes through them, but
 * leaving them out is the classic way to wire up ads perfectly and then earn
 * nothing. The IAB rule is that a buyer will only pay for inventory whose
 * domain vouches, in a plain text file at its root, for the publisher selling
 * it. AdSense checks ads.txt during site review and puts an "earnings at risk"
 * banner on an account without one; AdMob reads app-ads.txt from the marketing
 * URL in the App Store listing and, without it, most programmatic demand
 * simply declines to bid — which looks exactly like a broken integration and
 * is not one.
 *
 * Both are generated from ids the owner has already pasted into the desk, so
 * there is nothing new to keep in step, and both 404 until he has. And neither
 * is behind the ads switch, on purpose: Google has to be able to read these
 * BEFORE the switch is flipped — the AdSense review that produces the
 * publisher id is itself waiting on the file.
 */
const SELLER_LINE = (pub) => `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`;

/** The publisher half of any Google id: ca-pub-123… and ca-app-pub-123~456 both give pub-123. */
function publisherOf(id) {
  const m = /(?:^|-)pub-(\d{10,24})/.exec(String(id || ''));
  return m ? `pub-${m[1]}` : '';
}

/** The web's seller file, vouching for the AdSense account H5 serves from. */
export function adsTxt() {
  return publisherOf(settings.h5.clientId) && SELLER_LINE(publisherOf(settings.h5.clientId));
}

/** The app's, vouching for the AdMob account. Same publisher, different file. */
export function appAdsTxt() {
  return publisherOf(settings.admob.appId) && SELLER_LINE(publisherOf(settings.admob.appId));
}

load();
