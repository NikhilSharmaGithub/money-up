// Android on AdMob: the second app, beside the first rather than instead of it.
//
// The iPhone app has served AdMob for weeks off ids that live in ads.json on
// the server's disk, at the top level of the `admob` block. The Android app is
// a second AdMob app with ids of its own, and it arrives in a world where the
// iPhone's ids are already live — so everything here is really one promise
// made several ways: Android gets AdMob exactly when its own ids are there,
// its own ids and nobody else's, and the iPhone does not notice any of it.
//
//   node test/admob-android.mjs
//
// The gateway runs in this process on a throwaway port, over a temporary
// data directory seeded with an ads.json shaped exactly like the one on the
// live server. Google's verifier key set is served locally from a key pair
// made here, so the SSV callbacks below are signed for real and checked for
// real — nothing talks to Google.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

let failed = 0;
let passed = 0;
const PASS = (ok, label, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  return ok;
};
const section = (t) => console.log(`\n── ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Made-up ids in Google's shapes. The two apps share a publisher, as they do
// in a real account, and differ in everything after it.
const PUB = 'ca-app-pub-1111111111111111';
const IOS = {
  appId: `${PUB}~1000000001`,
  doubleWin: `${PUB}/2000000001`,
  freeCoins: `${PUB}/2000000002`,
  preGame: `${PUB}/2000000003`,
};
const DROID = {
  appId: `${PUB}~3000000001`,
  doubleWin: `${PUB}/4000000001`,
  freeCoins: `${PUB}/4000000002`,
  preGame: `${PUB}/4000000003`,
};
// Google's published test ids, which test mode must hand each platform.
const GOOGLE_TEST = {
  ios: { appId: 'ca-app-pub-3940256099942544~1458002511', unit: 'ca-app-pub-3940256099942544/1712485313', inter: 'ca-app-pub-3940256099942544/4411468910' },
  android: { appId: 'ca-app-pub-3940256099942544~3347511713', unit: 'ca-app-pub-3940256099942544/5224354917', inter: 'ca-app-pub-3940256099942544/1033173712' },
};
const bare = (id) => String(id).split('/').pop();

// ------------------------------------------------------------ the world --
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-admob-android-'));
const ADMIN = 'test-admin-key';

// The file as the live server holds it today: written by a desk that had
// never heard of Android, provider still spelled 'admob', the iPhone's ids at
// the top level. Loading this is the migration, and there must not be one.
const OLD_FILE = {
  enabled: true,
  provider: 'admob',
  testMode: false,
  placements: {
    doubleWin: { enabled: true, kind: 'multiplier', factor: 2, dailyCap: 2 },
    freeCoins: { enabled: true, kind: 'grant', coins: 2, dailyCap: 4 },
  },
  interstitials: { preGame: { enabled: true, everyMinutes: 5 } },
  caps: { minIntervalSec: 0, dailyCoinCap: 12, ticketTtlSec: 300, winWindowMin: 20, ssvWaitSec: 0 },
  admob: {
    appId: IOS.appId,
    units: { doubleWin: IOS.doubleWin, freeCoins: IOS.freeCoins },
    interstitialUnits: { preGame: IOS.preGame },
    adNetworkId: '',
  },
  h5: { clientId: '', slots: { doubleWin: '', freeCoins: '' } },
  secret: crypto.randomBytes(32).toString('base64url'),
  changedAt: 1,
};
fs.writeFileSync(path.join(DATA_DIR, 'ads.json'), JSON.stringify(OLD_FILE, null, 2));

// Google's side of SSV: a key pair we hold both halves of, published the way
// gstatic publishes its own.
const KEY_ID = '7777';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const keyServer = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ keys: [{ keyId: Number(KEY_ID), pem: publicKey.export({ type: 'spki', format: 'pem' }), base64: '' }] }));
});
await new Promise((r) => keyServer.listen(0, '127.0.0.1', r));

// Nothing from the shell running this may leak in: every id here comes from
// the file above or from the desk calls below.
for (const k of Object.keys(process.env)) if (/^(ADMOB_|ADS_|H5_|ADSENSE_)/.test(k)) delete process.env[k];
// The Android app's real ids ship as defaults in ads.js. This file is about
// the path an owner walks from no ids to his own, so it starts from none —
// an empty variable is the documented way to say so.
for (const k of ['ADMOB_ANDROID_APP_ID', 'ADMOB_ANDROID_UNIT_DOUBLE_WIN',
  'ADMOB_ANDROID_UNIT_FREE_COINS', 'ADMOB_ANDROID_UNIT_PREGAME']) process.env[k] = '';
process.env.DATA_DIR = DATA_DIR;
process.env.ADMIN_KEY = ADMIN;
process.env.ADMOB_KEYS_URL = `http://127.0.0.1:${keyServer.address().port}/keys.json`;

const express = (await import('express')).default;
const ads = await import('../server/ads.js');

async function mount(router) {
  const app = express();
  app.use(express.json());
  app.use('/api/ads', router);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/api/ads` };
}
let gate = await mount(ads.adsRouter);

async function call(method, p, { body, headers = {} } = {}) {
  const res = await fetch(gate.url + p, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* the SSV door answers in words */ }
  return { status: res.status, json, text };
}
const config = (platform, token = 'u_reader', headers) =>
  call('GET', `/config?token=${token}${platform ? `&platform=${platform}` : ''}`, { headers }).then((r) => r.json);
const desk = (patch) => call('POST', '/admin', { body: { key: ADMIN, ...patch } });
const deskRead = () => call('GET', `/admin?key=${ADMIN}`).then((r) => r.json);
const offer = (token, platform, placement = 'freeCoins') =>
  call('POST', '/offer', { body: { token, placement, platform } }).then((r) => r.json);
const claim = (token, ticket, platform) =>
  call('POST', '/reward', { body: { token, ticket, platform } });

/** A callback exactly as Google sends one: signed over everything before &signature=. */
let txnSeq = 0;
function signedCallback({ unit, nonce, userId }) {
  const q = new URLSearchParams({
    ad_network: '5450213213286189855',
    ad_unit: bare(unit),
    custom_data: nonce,
    reward_amount: '1',
    reward_item: 'coins',
    timestamp: String(Date.now()),
    transaction_id: `txn-${Date.now()}-${++txnSeq}`,
    user_id: userId,
  }).toString();
  const sig = crypto.sign('sha256', Buffer.from(q, 'utf8'), privateKey).toString('base64url');
  return `/ssv?${q}&signature=${sig}&key_id=${KEY_ID}`;
}
const ssv = async (args) => (await call('GET', signedCallback(args))).text;

// The parts of a config a phone boots its SDK from — what "unchanged" means
// for the iPhone.
const iosView = (c) => JSON.stringify({
  provider: c.provider, network: c.network,
  units: Object.fromEntries(Object.entries(c.placements).map(([k, v]) => [k, v.unitId])),
  inter: c.interstitials.preGame,
});

// ------------------------------------------------------------ the tests --
section('the live file loads as it was');
{
  const read = await deskRead();
  const s = read.settings;
  PASS(s.admob.appId === IOS.appId, 'the iPhone app id stays at the top level of admob');
  PASS(s.admob.units.doubleWin === IOS.doubleWin && s.admob.units.freeCoins === IOS.freeCoins, 'and so do its rewarded units');
  PASS(s.admob.interstitialUnits.preGame === IOS.preGame, 'and its interstitial');
  PASS(s.provider === 'google', "an old 'admob' provider still reads as google");
  PASS(!!s.admob.android && s.admob.android.appId === '', 'an android block appears beside them, empty');
  PASS(s.admob.android.units.doubleWin === '' && s.admob.android.units.freeCoins === '' && s.admob.android.interstitialUnits.preGame === '',
    'with every android unit empty');
}

section('android with no ids of its own');
const iosBefore = await config('ios');
{
  const c = await config('android');
  PASS(c.enabled === true, 'ads are on for android');
  PASS(c.provider === 'house', 'android is told house', c.provider);
  PASS(c.network.id === 'house' && !c.network.appId, 'and names no network or app id');
  PASS(Object.values(c.placements).every((p) => p.unitId === ''), 'no unit id reaches it — least of all the iPhone\'s');
  PASS(c.interstitials.preGame.enabled === false && c.interstitials.preGame.unitId === '', 'and no interstitial, since the house has none');
  const o = await offer('u_droid_house', 'android');
  PASS(o.ok && o.provider === 'house', 'an android offer is cut on the house', o.error || o.provider);
  PASS(!o.unitId && !o.customData, 'and carries nothing for an SDK');

  PASS(iosBefore.provider === 'admob', 'the iPhone is on AdMob all the same');
  PASS(iosBefore.network.appId === IOS.appId, 'with its own app id');
  PASS(iosBefore.placements.freeCoins.unitId === IOS.freeCoins && iosBefore.placements.doubleWin.unitId === IOS.doubleWin, 'and its own units');
  PASS(iosBefore.interstitials.preGame.unitId === IOS.preGame, 'and its own interstitial');

  const read = await deskRead();
  PASS(read.provider.per.android === 'house' && read.provider.per.ios === 'admob', 'the desk says iPhone admob, android house');
  PASS(read.provider.networks.admobAndroid?.ready === false, 'and that android AdMob is not configured');
  PASS(/app id/.test(read.provider.networks.admobAndroid?.missing || ''), 'naming what is missing', read.provider.networks.admobAndroid?.missing);
  PASS(read.provider.networks.admob?.ready === true, 'while the iPhone\'s AdMob reads ready');
}

section('half the android ids is still the house');
{
  const r = await desk({ admob: { android: { appId: DROID.appId } } });
  PASS(r.status === 200, 'an app id alone saves', r.json?.error || '');
  const c = await config('android');
  PASS(c.provider === 'house', 'but with no rewarded units android stays on the house', c.provider);
  const read = await deskRead();
  PASS(/doubleWin unit id/.test(read.provider.networks.admobAndroid.missing), 'and the desk names the units still wanted', read.provider.networks.admobAndroid.missing);
}

section('the desk refuses the wrong kind of id');
{
  const before = (await deskRead()).settings;
  let r = await desk({ admob: { android: { appId: DROID.doubleWin } } });
  PASS(r.status === 400 && /unit id/.test(r.json?.error), 'a unit id in the android app id field is refused', r.json?.error);
  r = await desk({ admob: { android: { units: { freeCoins: DROID.appId } } } });
  PASS(r.status === 400 && /app id/.test(r.json?.error), 'an app id in an android unit field is refused', r.json?.error);
  r = await desk({ admob: { android: { interstitialUnits: { preGame: 'banana' } } } });
  PASS(r.status === 400 && /does not look like/.test(r.json?.error), 'something that is neither is refused', r.json?.error);
  r = await desk({ admob: { units: { doubleWin: IOS.appId } } });
  PASS(r.status === 400 && /iPhone doubleWin unit/.test(r.json?.error), 'the iPhone fields get the same check', r.json?.error);
  r = await desk({ admob: { appId: IOS.freeCoins } });
  PASS(r.status === 400, 'an iPhone app id with a / is refused too', r.json?.error);
  r = await desk({ admob: { android: { units: { doubleWin: IOS.doubleWin } } } });
  PASS(r.status === 400 && /iPhone app's id/.test(r.json?.error), "the iPhone's own unit pasted into android is refused", r.json?.error);
  r = await desk({ admob: { android: { appId: IOS.appId } } });
  PASS(r.status === 400 && /Add app/.test(r.json?.error), "and so is the iPhone's app id, with where to get the right one", r.json?.error);
  // Refused whole: the switch in the same patch must not have been applied.
  r = await desk({ enabled: false, admob: { android: { appId: DROID.freeCoins } } });
  PASS(r.status === 400, 'a patch carrying one bad id is refused');
  PASS((await deskRead()).settings.enabled === true, 'and nothing else in it was applied');
  const after = (await deskRead()).settings;
  PASS(JSON.stringify(after.admob) === JSON.stringify(before.admob), 'no refusal moved any id');
  // The desk sends every field on every save. An unchanged iPhone block must
  // ride along with a new android one without being judged again.
  r = await desk({ admob: { appId: IOS.appId, units: { doubleWin: IOS.doubleWin, freeCoins: IOS.freeCoins }, android: { appId: DROID.appId } } });
  PASS(r.status === 200, 'unchanged ids beside a valid new one save', r.json?.error || '');
}

section('android with its own ids');
{
  const r = await desk({
    admob: {
      // Exactly what the desk's Save button sends: both apps, every field.
      appId: IOS.appId,
      units: { doubleWin: IOS.doubleWin, freeCoins: IOS.freeCoins },
      interstitialUnits: { preGame: IOS.preGame },
      adNetworkId: '',
      android: {
        appId: DROID.appId,
        units: { doubleWin: DROID.doubleWin, freeCoins: DROID.freeCoins },
        interstitialUnits: { preGame: DROID.preGame },
      },
    },
  });
  PASS(r.status === 200, 'the android ids save', r.json?.error || '');
  PASS((r.json?.changed || []).every((c) => c.startsWith('admob android')), 'and only the android ids changed', (r.json?.changed || []).join(', '));

  const c = await config('android');
  PASS(c.provider === 'admob', 'android is told admob', c.provider);
  PASS(c.network.id === 'admob' && c.network.appId === DROID.appId, 'with the android app id', c.network.appId);
  PASS(c.placements.freeCoins.unitId === DROID.freeCoins, 'its own free-coins unit', c.placements.freeCoins.unitId);
  PASS(c.placements.doubleWin.unitId === DROID.doubleWin, 'its own double-win unit', c.placements.doubleWin.unitId);
  PASS(c.interstitials.preGame.enabled === true && c.interstitials.preGame.unitId === DROID.preGame, 'its own interstitial', c.interstitials.preGame.unitId);
  PASS(c.network.test === false && c.testMode === false, 'live ids, not test ones');

  const o = await offer('u_droid_offer', 'android');
  PASS(o.ok && o.provider === 'admob', 'an android offer is cut on admob', o.error || o.provider);
  PASS(o.unitId === DROID.freeCoins && o.appId === DROID.appId, 'naming the android unit and app', `${o.unitId} ${o.appId}`);
  PASS(!!o.customData && !!o.userId, 'with the nonce and tag the SDK hands Google');

  const iosNow = await config('ios');
  PASS(iosView(iosNow) === iosView(iosBefore), 'the iPhone\'s config is byte-for-byte what it was');

  const read = await deskRead();
  PASS(read.provider.per.android === 'admob' && read.provider.per.ios === 'admob', 'the desk says admob on both apps');
  PASS(read.provider.networks.admobAndroid.ready === true, 'and android AdMob reads ready');
  PASS(read.platforms.find((p) => p.platform === 'android')?.network === 'admob', 'the per-client table agrees');

  // A client too old to name itself, and the WebView shell, which names
  // itself 'web' in good faith: neither can load an SDK, so neither may be
  // sold AdMob, however ready Android is.
  const okhttp = await config('', 'u_old', { 'user-agent': 'okhttp/4.12.0' });
  PASS(okhttp.platform === 'android' && okhttp.provider === 'house', 'an android build that sends no platform gets house', okhttp.provider);
  const wv = await config('web', 'u_wv', { 'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36' });
  PASS(wv.platform === 'android' && wv.provider === 'house', 'the old WebView shell gets house, not admob', wv.provider);
  PASS(wv.network.id === 'house', 'and certainly not h5');
}

section('switching android off leaves the iPhone alone');
{
  await desk({ platforms: { android: false } });
  const c = await config('android');
  PASS(c.enabled === false && c.provider === 'house', 'android off is off');
  PASS(iosView(await config('ios')) === iosView(iosBefore), 'and the iPhone is unmoved');
  await desk({ platforms: { android: true } });
}

section('test mode hands each platform Google\'s own ids');
{
  await desk({ testMode: true });
  for (const platform of ['ios', 'android']) {
    const c = await config(platform);
    const t = GOOGLE_TEST[platform];
    PASS(c.provider === 'admob' && c.network.test === true, `${platform} is on admob test`);
    PASS(c.network.appId === t.appId, `${platform} gets Google's ${platform} test app id`, c.network.appId);
    PASS(c.placements.freeCoins.unitId === t.unit && c.placements.doubleWin.unitId === t.unit, `${platform} gets Google's ${platform} rewarded test unit`);
    PASS(c.interstitials.preGame.unitId === t.inter, `${platform} gets Google's ${platform} interstitial test unit`);
  }
  // Test mode needs no account, so android with nothing pasted is still admob.
  await desk({ admob: { android: { appId: '', units: { doubleWin: '', freeCoins: '' }, interstitialUnits: { preGame: '' } } } });
  const bareDroid = await config('android');
  PASS(bareDroid.provider === 'admob' && bareDroid.network.appId === GOOGLE_TEST.android.appId, 'android with no ids still gets the test ids in test mode');
  await desk({ testMode: false });
  PASS((await config('android')).provider === 'house', 'and back on the house once test mode is off');
  const r = await desk({ admob: { android: { appId: DROID.appId, units: { doubleWin: DROID.doubleWin, freeCoins: DROID.freeCoins }, interstitialUnits: { preGame: DROID.preGame } } } });
  PASS(r.status === 200 && (await config('android')).provider === 'admob', 'and on admob again once its ids are back');
}

section('SSV: an android view is verified and paid like an iPhone one');
{
  // Every offer first, so one wait covers the shortest-possible-ad rule.
  const droid = await offer('u_ssv_droid', 'android');
  const droidWrong = await offer('u_ssv_droid_wrong', 'android');
  const iphone = await offer('u_ssv_ios', 'ios');
  const iphoneWrong = await offer('u_ssv_ios_wrong', 'ios');
  PASS([droid, droidWrong, iphone, iphoneWrong].every((o) => o.ok && o.provider === 'admob'), 'four admob offers, two per app');
  PASS(droid.unitId === DROID.freeCoins && iphone.unitId === IOS.freeCoins, 'each on its own app\'s unit');

  const before = (await deskRead()).ssv;

  // The right callbacks: Google names each ticket's own unit, bare.
  PASS(await ssv({ unit: DROID.freeCoins, nonce: droid.customData, userId: droid.userId }) === 'ok',
    'a signed callback from the android unit for an android ticket is accepted');
  PASS(await ssv({ unit: IOS.freeCoins, nonce: iphone.customData, userId: iphone.userId }) === 'ok',
    'an iPhone callback from the iPhone unit is accepted, as before');

  // The crossed ones: a real, signed callback from the other app's unit.
  PASS(await ssv({ unit: IOS.freeCoins, nonce: droidWrong.customData, userId: droidWrong.userId }) === 'ignored',
    "an android ticket is not confirmed by the iPhone's unit");
  let log = (await deskRead()).ssv;
  PASS(/different ad unit/.test(log.lastRejectReason) && log.lastRejectPlatform === 'android', 'and the desk says why, and for which app', `${log.lastRejectReason} [${log.lastRejectPlatform}]`);
  PASS(await ssv({ unit: DROID.freeCoins, nonce: iphoneWrong.customData, userId: iphoneWrong.userId }) === 'ignored',
    "an iPhone ticket is not confirmed by the android unit");

  log = (await deskRead()).ssv;
  PASS(log.ok === before.ok + 2 && log.rejected === before.rejected + 2, 'two confirmed, two turned away', `ok ${log.ok}, rejected ${log.rejected}`);
  PASS(log.byPlatform.android.ok === 1 && log.byPlatform.android.lastOkUnit === bare(DROID.freeCoins), 'the android confirmation is counted as android\'s');
  PASS(log.byPlatform.ios.ok === 1, 'and the iPhone\'s as the iPhone\'s');

  await sleep(3100);

  let r = await claim('u_ssv_droid', droid.ticket, 'android');
  PASS(r.status === 200 && r.json?.ok && r.json.awarded === 2, 'the android claim pays', r.json?.error || `awarded ${r.json?.awarded}`);
  r = await claim('u_ssv_ios', iphone.ticket, 'ios');
  PASS(r.status === 200 && r.json?.ok && r.json.awarded === 2, 'the iPhone claim pays, exactly as it did', r.json?.error || '');

  r = await claim('u_ssv_droid_wrong', droidWrong.ticket, 'android');
  PASS(r.status === 402 && r.json?.pending === true, "the android ticket the iPhone's unit tried to confirm is still unpaid", `${r.status} ${r.json?.error}`);
  r = await claim('u_ssv_ios_wrong', iphoneWrong.ticket, 'ios');
  PASS(r.status === 402, 'and so is the iPhone ticket the android unit tried to confirm', `${r.status}`);

  // Still good, just unconfirmed: the right unit's callback settles it.
  PASS(await ssv({ unit: DROID.freeCoins, nonce: droidWrong.customData, userId: droidWrong.userId }) === 'ok',
    'the right unit can still confirm it afterwards');
  r = await claim('u_ssv_droid_wrong', droidWrong.ticket, 'android');
  PASS(r.status === 200 && r.json?.awarded === 2, 'and then it pays, once', r.json?.error || '');
  r = await claim('u_ssv_droid_wrong', droidWrong.ticket, 'android');
  PASS(r.status === 400, 'and never twice');
}

section('SSV: the other app\'s unit stays wrong even with nothing to compare against');
{
  const o = await offer('u_ssv_cleared', 'android');
  PASS(o.ok && o.provider === 'admob', 'an android admob offer');
  // The owner clears the android units while the ad is playing — the one
  // case where the ticket has no unit of its own left to be checked against.
  await desk({ admob: { android: { units: { doubleWin: '', freeCoins: '' } } } });
  PASS(await ssv({ unit: IOS.freeCoins, nonce: o.customData, userId: o.userId }) === 'ignored',
    "a callback from the iPhone's unit is still refused");
  PASS(/ios app's ad unit/.test((await deskRead()).ssv.lastRejectReason), 'as the other app\'s unit');
  PASS(await ssv({ unit: '9999999999', nonce: o.customData, userId: o.userId }) === 'ok',
    'while one from a unit nobody knows is let through, as it always was');
  await desk({ admob: { android: { units: { doubleWin: DROID.doubleWin, freeCoins: DROID.freeCoins } } } });
}

section('a restart reads both apps back from disk');
{
  const onDisk = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ads.json'), 'utf8'));
  PASS(onDisk.admob.appId === IOS.appId && onDisk.admob.units.freeCoins === IOS.freeCoins, 'the iPhone ids are written where they always were');
  PASS(onDisk.admob.android?.appId === DROID.appId && onDisk.admob.android?.units?.freeCoins === DROID.freeCoins, 'the android ids beside them');

  const restarted = await import('../server/ads.js?restart=1');
  gate.server.close();
  gate = await mount(restarted.adsRouter);
  const c = await config('android');
  PASS(c.provider === 'admob' && c.network.appId === DROID.appId && c.placements.freeCoins.unitId === DROID.freeCoins,
    'a restarted server still sends android to its own AdMob app');
  PASS(iosView(await config('ios')) === iosView(iosBefore), 'and the iPhone to its');
  PASS(/pub-1111111111111111/.test(restarted.appAdsTxt() || ''), 'app-ads.txt still names the publisher');
}

gate.server.close();
keyServer.close();
fs.rmSync(DATA_DIR, { recursive: true, force: true });
console.log(`\n${failed ? 'FAIL' : 'PASS'} — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
