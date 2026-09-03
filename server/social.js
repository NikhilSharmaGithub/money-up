// Friends without accounts.
//
// Every browser already carries a random identity token. We derive a short,
// stable friend code from it, so people can add each other by code without
// signing up for anything. Presence is tracked per token, which lets the
// friends list offer a "join" button when someone is sitting in a lobby.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Render's filesystem is wiped on every deploy — point DATA_DIR at a
// persistent disk mount (e.g. /var/data) so wallets survive a release.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STORE = path.join(DATA_DIR, 'social.json');
const LEDGER_STORE = path.join(DATA_DIR, 'ledger.json');
const LEDGER_MAX = 5000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const MAX_FRIENDS = 100;
const KARMA_MAX = 100;
/** Bumped whenever coin values are rescaled, so wallets migrate exactly once. */
const ECON_VERSION = 2;

/** @type {Map<string, {token:string, code:string, name:string, flag:string, friends:string[], seen:number}>} */
const profiles = new Map();
const byCode = new Map();
/** token -> { roomId, at } */
const presence = new Map();

// ---------------------------------------------------------------- storage --
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    for (const p of raw.profiles || []) {
      profiles.set(p.token, p);
      byCode.set(p.code, p.token);
    }
    for (const [key, thread] of Object.entries(raw.dms || {})) {
      dms.set(key, thread);
    }
    console.log(`  social: restored ${profiles.size} profile(s)`);
  } catch {
    // first run, or the store was wiped by a redeploy — start fresh
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(STORE), { recursive: true });
      fs.writeFileSync(STORE, JSON.stringify({
        profiles: [...profiles.values()],
        dms: Object.fromEntries(dms),
      }));
    } catch (err) {
      console.warn('social: could not persist profiles —', err.message);
    }
  }, 1500);
  saveTimer.unref?.();
}

// ------------------------------------------------------------------ ledger --
// Every coin credit that had money (or an operator) behind it, in order. This
// file is the revenue source of truth from the moment it was added — earlier
// purchases live only in each profile's dedupe list, with no amounts.
/** @type {Array<{at:number, provider:string, packId:string|null, usd:number, coins:number, token:string, txn:string, note?:string}>} */
let ledger = [];

function loadLedger() {
  try {
    const raw = JSON.parse(fs.readFileSync(LEDGER_STORE, 'utf8'));
    if (Array.isArray(raw)) ledger = raw;
    if (ledger.length) console.log(`  ledger: restored ${ledger.length} entr${ledger.length === 1 ? 'y' : 'ies'}`);
  } catch {
    // no ledger yet — it begins with the first credit after this deploy
  }
}

let ledgerTimer = null;
function saveLedger() {
  clearTimeout(ledgerTimer);
  ledgerTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(LEDGER_STORE), { recursive: true });
      fs.writeFileSync(LEDGER_STORE, JSON.stringify(ledger));
    } catch (err) {
      console.warn('ledger: could not persist —', err.message);
    }
  }, 1500);
  ledgerTimer.unref?.();
}

function appendLedger(entry) {
  ledger.push(entry);
  if (ledger.length > LEDGER_MAX) ledger.splice(0, ledger.length - LEDGER_MAX);
  saveLedger();
}

/**
 * Read view for the admin dashboard. The raw identity token is a secret that
 * must never reach a browser, so entries go out carrying the public friend
 * code instead.
 */
export function ledgerView() {
  return ledger.map(({ token, ...entry }) => ({
    ...entry,
    code: profiles.get(token)?.code || null,
  }));
}

// ---------------------------------------------------------------- profiles --
/** Stable 6-character code derived from the token — same browser, same code. */
function codeFor(token) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < token.length; i++) {
    h1 = Math.imul(h1 ^ token.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + token.charCodeAt(i) * (i + 7), 2654435761) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 6; i++) {
    const source = i < 3 ? h1 : h2;
    out += CODE_ALPHABET[(source >>> (i % 3) * 5) % CODE_ALPHABET.length];
    if (i === 2) h1 = Math.imul(h1, 2246822519) >>> 0;
  }
  return out;
}

export function profileFor(token, { name, flag } = {}) {
  if (!token) return null;
  let p = profiles.get(token);
  if (!p) {
    let code = codeFor(token);
    // Vanishingly unlikely, but never hand two people the same code.
    let salt = 0;
    while (byCode.has(code) && byCode.get(code) !== token) code = codeFor(token + ':' + ++salt);
    p = { token, code, name: '', flag: '', friends: [], seen: Date.now(), created: Date.now() };
    profiles.set(token, p);
    byCode.set(code, token);
  }
  if (name) p.name = String(name).slice(0, 16);
  if (flag !== undefined) p.flag = String(flag || '').slice(0, 8);
  // The wallet rides on the profile: coins earned by winning, cosmetics
  // bought in the store, and what's currently equipped.
  p.coins ??= 0;
  p.owned ??= [];
  p.equipped ??= {};
  // Transaction ids already credited — a receipt can never pay out twice.
  p.purchases ??= [];
  // Karma is a politeness score: everyone starts full, walking out on a live
  // game or letting the clock run out costs a point.
  p.karma ??= KARMA_MAX;
  // Profiles older than this field get their last sighting as a birthdate —
  // wrong, but wrong in the least misleading direction available.
  p.created ??= p.seen || Date.now();
  // The coin economy was rescaled 50x when paid packs arrived; old wallets
  // are converted once so nobody's balance silently shrinks in value.
  if (p.econ !== ECON_VERSION) {
    if (p.econ === undefined && p.coins > 0) p.coins *= 50;
    p.econ = ECON_VERSION;
  }
  p.seen = Date.now();
  save();
  return p;
}

/** Politeness score, 0–100. Leaving a live game or timing out costs a point. */
export function bumpKarma(token, delta) {
  const p = profileFor(token);
  if (!p) return null;
  p.karma = Math.max(0, Math.min(KARMA_MAX, p.karma + delta));
  save();
  return p.karma;
}

export const karmaOf = (token) => profileFor(token)?.karma ?? KARMA_MAX;

const publicView = (p) => ({
  code: p.code, name: p.name || 'Player', flag: p.flag || '',
  avatar: p.equipped?.avatar || '',
});

// ------------------------------------------------------------ store wallet --
export function walletOf(token) {
  // Reading a wallet must not mint one: every page load asks, and so does
  // every crawler that executes our JS. The profile is born the first time
  // the visitor actually DOES something — joins a table, sets a name, buys.
  if (!token) return null;
  const p = profiles.get(token);
  if (!p) return { coins: 0, owned: [], equipped: {}, karma: KARMA_MAX };
  profileFor(token);   // it exists — freshen seen/migrations as before
  return { coins: p.coins, owned: p.owned, equipped: p.equipped, karma: p.karma };
}

/**
 * Credit a verified store purchase. `transactionId` comes from the platform
 * receipt the caller already verified — replaying one is a no-op, so a
 * retried network call can never mint a second batch of coins.
 */
export function creditPurchase(token, transactionId, coins, meta = {}) {
  const p = profileFor(token);
  if (!p) return { error: 'Unknown player' };
  const txn = String(transactionId || '');
  if (!txn) return { error: 'Missing transaction' };
  if (p.purchases.includes(txn)) return { ok: true, coins: p.coins, duplicate: true };
  const amount = Math.max(0, Math.floor(Number(coins) || 0));
  if (!amount) return { error: 'Nothing to credit' };
  p.purchases.push(txn);
  if (p.purchases.length > 500) p.purchases.splice(0, p.purchases.length - 500);
  p.coins += amount;
  appendLedger({
    at: Date.now(),
    provider: String(meta.provider || 'unknown'),
    packId: meta.packId ? String(meta.packId) : null,
    usd: Math.round((Number(meta.usd) || 0) * 100) / 100,
    coins: amount,
    token,
    txn,
  });
  save();
  return { ok: true, coins: p.coins };
}

/** Winning pays out — a coin or two, longer games pay the bigger purse. */
export function awardCoins(token, amount) {
  const p = profileFor(token);
  if (!p || amount <= 0) return null;
  p.coins += amount;
  save();
  return p.coins;
}

/**
 * The same payout, written down. awardCoins predates the ledger and leaves no
 * trace; wins routed through here get a zero-dollar entry, so the economy
 * panel can say where every coin came from instead of guessing.
 *
 * `placing` is for a payout that is not a win — the runner-up's consolation
 * coin. It banks and it is written down like any other, but it must not touch
 * the lifetime win tally: the public leaderboard and the admin's wins column
 * both read that number, and a player who was beaten showing up as a winner
 * is a lie neither of them can be talked out of afterwards.
 */
export function awardWin(token, amount, note, { placing = false } = {}) {
  const coins = Math.floor(Number(amount) || 0);
  const balance = awardCoins(token, coins);
  if (balance == null) return null;
  // The lifetime tally the leaderboard reads: every win routed through here
  // bumps the count and banks the purse. awardCoins just minted the profile
  // if it somehow didn't exist, so the get can't miss.
  const p = profiles.get(token);
  if (p && !placing) {
    p.wins = (p.wins || 0) + 1;
    p.winnings = (p.winnings || 0) + coins;
  }
  appendLedger({
    at: Date.now(),
    provider: 'win',
    packId: null,
    usd: 0,
    coins,
    token,
    txn: `win:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    note: String(note || '').slice(0, 140),
    // The consolation coin is written down the same way a win is, which
    // leaves the book unable to tell them apart on its own. It says so here
    // instead: the rewarded-ad double-up only ever offers itself to an
    // actual winner, and this flag is how it knows which rows those are.
    ...(placing ? { placing: true } : {}),
  });
  return balance;
}

/**
 * An operator grant from the admin dashboard: resolve the public friend code
 * back to a wallet, pay it through awardCoins, and record the grant in the
 * same ledger real purchases use — provider 'admin', zero dollars, reason
 * attached so the books explain themselves later.
 */
export function adminCredit(rawCode, amount, reason) {
  const code = String(rawCode || '').trim().toUpperCase();
  const token = byCode.get(code);
  if (!token) return { error: 'No player with that code' };
  const coins = Math.floor(Number(amount) || 0);
  if (coins <= 0 || coins > 1000000) return { error: 'Credit between 1 and 1,000,000 coins' };
  const balance = awardCoins(token, coins);
  appendLedger({
    at: Date.now(),
    provider: 'admin',
    packId: null,
    usd: 0,
    coins,
    token,
    txn: `admin:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    note: String(reason || '').slice(0, 140),
  });
  const p = profiles.get(token);
  return { ok: true, code, name: p?.name || '', coins: balance };
}

/** The operator's thumb on the politeness scale — set outright, 0 to 100. */
export function setKarma(rawCode, value) {
  const code = String(rawCode || '').trim().toUpperCase();
  const token = byCode.get(code);
  if (!token) return { error: 'No player with that code' };
  const v = Math.round(Number(value));
  if (!Number.isFinite(v) || v < 0 || v > KARMA_MAX) return { error: `Karma is 0-${KARMA_MAX}` };
  const p = profiles.get(token);
  p.karma = v;
  save();
  return { ok: true, code, name: p.name || '', karma: v };
}

/** Resolve a public code back to its device token — never sent to a browser. */
export const tokenForCode = (rawCode) => byCode.get(String(rawCode || '').trim().toUpperCase()) || null;

/** And the other direction, for stamping server objects with a public name. */
export const codeForToken = (token) => profiles.get(token)?.code || null;

export function buyItem(token, item) {
  const p = profileFor(token);
  if (!p) return { error: 'Unknown player' };
  if (p.owned.includes(item.id)) return { error: 'Already owned' };
  if (p.coins < item.price) return { error: 'Not enough coins' };
  p.coins -= item.price;
  p.owned.push(item.id);
  save();
  return { ok: true, coins: p.coins, owned: p.owned };
}

export function equipItem(token, slot, itemId) {
  const p = profileFor(token);
  if (!p) return { error: 'Unknown player' };
  if (!['token', 'avatar'].includes(slot)) return { error: 'Unknown slot' };
  if (itemId && !p.owned.includes(itemId)) return { error: 'Not owned' };
  if (itemId) p.equipped[slot] = itemId;
  else delete p.equipped[slot];
  save();
  return { ok: true, equipped: p.equipped };
}

// ------------------------------------------------------------ daily reward --
// Showing up pays, but barely: one coin on day one, two on the second day
// in a row, up to seven and no further — a week of habit is worth a week's
// worth, and a missed day starts the ladder over. Coins have to stay scarce
// enough that the shop is worth visiting. Dates are the server's calendar.
const DAILY_BASE = 1;
const DAILY_STEP = 1;
const DAILY_CAP = 7;

/** Server-local calendar date as a key: same day, same string. */
function dayKey(when = Date.now()) {
  const d = new Date(when);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Yesterday by calendar arithmetic, so a DST hour can't skip a day. */
function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dayKey(d);
}

/** When the next claim opens — the coming server-local midnight. */
function nextMidnight() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/** What a claim pays once the streak stands at `streak` days. */
const dailyAmount = (streak) => Math.min(DAILY_CAP, DAILY_BASE + (streak - 1) * DAILY_STEP);

/**
 * Read-only peek — the same rule as walletOf: the home screen asks on every
 * load, and asking must not mint a profile. An unknown token simply sees day
 * one waiting for it; a lapsed streak already reads as zero.
 */
export function dailyView(token) {
  const p = token ? profiles.get(token) : null;
  const d = p?.daily;
  const today = dayKey();
  if (!d?.last) return { claimable: !!token, streak: 0, amount: DAILY_BASE, nextAt: null };
  if (d.last === today) {
    // Claimed already; the amount shown is what tomorrow's claim will pay.
    return { claimable: false, streak: d.streak, amount: dailyAmount(d.streak + 1), nextAt: nextMidnight() };
  }
  const streakAlive = d.last === yesterdayKey();
  return {
    claimable: true,
    streak: streakAlive ? d.streak : 0,
    amount: dailyAmount(streakAlive ? d.streak + 1 : 1),
    nextAt: null,
  };
}

/**
 * The claim itself. This is a real action, so profileFor applies — a fresh
 * token earns its profile the moment it collects day one. Coins move through
 * the same ledger money does: provider 'daily', zero dollars, streak noted.
 */
export function claimDaily(token) {
  const p = profileFor(token);
  if (!p) return { error: 'Missing identity' };
  const today = dayKey();
  const d = p.daily ?? (p.daily = { last: null, streak: 0 });
  if (d.last === today) {
    return { error: 'Already claimed today', claimed: true, streak: d.streak, nextAt: nextMidnight() };
  }
  d.streak = d.last === yesterdayKey() ? d.streak + 1 : 1;
  d.last = today;
  const amount = dailyAmount(d.streak);
  p.coins += amount;
  appendLedger({
    at: Date.now(),
    provider: 'daily',
    packId: null,
    usd: 0,
    coins: amount,
    token,
    txn: `daily:${today}:${p.code}`,
    note: `day ${d.streak} of the streak`,
  });
  save();
  return { ok: true, amount, coins: p.coins, streak: d.streak, nextAt: nextMidnight() };
}

// ------------------------------------------------------------ rewarded ads --
// A rewarded view pays real coins, so the counters that stop it being farmed
// have to live where the wallet lives: on the profile, in social.json, right
// next to the daily streak. The rules — what a view is worth, how many a day,
// how long between them — belong to ads.js, which can change them at runtime.
// This module only remembers what has already been paid out, and refuses to
// pay for the same view twice.

/**
 * The reward id for one view. Deliberately derived rather than random: the
 * double-up's id contains the win it doubled, so the same win can never be
 * doubled again no matter how many tickets are waved at it.
 */
export const adsRewardId = (placement, ref) => `ads:${placement}:${ref}`;

/** The profile's ad book, rolled over the moment the calendar day turns. */
function adsBook(p) {
  const today = dayKey();
  const a = p.ads ?? (p.ads = { day: today, views: {}, coins: 0, lastAt: 0 });
  if (a.day !== today) { a.day = today; a.views = {}; a.coins = 0; }
  a.views ??= {};
  return a;
}

/**
 * What this device has already taken from ads today. Read-only, and the same
 * no-minting rule as walletOf: every config fetch asks, and asking must not
 * conjure a wallet. A device with no book yet has taken nothing, which is
 * exactly what a fresh one reads as.
 */
export function adsStateOf(token) {
  const p = token ? profiles.get(token) : null;
  if (!p || !p.ads) return { views: {}, coins: 0, lastAt: 0 };
  // The day's tallies reset at midnight; the clock since the last view does
  // not, or the minute before midnight would be a free-for-all.
  if (p.ads.day !== dayKey()) return { views: {}, coins: 0, lastAt: p.ads.lastAt || 0 };
  return { views: { ...p.ads.views }, coins: p.ads.coins || 0, lastAt: p.ads.lastAt || 0 };
}

/**
 * Pay for one finished view. This is creditPurchase's discipline borrowed
 * whole, down to sharing its already-credited list: a replayed claim finds
 * its own id sitting there and pays nothing the second time. That matters
 * more here than it does for a receipt, because the spent-ticket set lives in
 * memory and a restart forgets it — the list on disk does not.
 */
export function creditAdReward(token, rewardId, coins, { placement, note } = {}) {
  const p = profileFor(token);
  if (!p) return { error: 'Unknown player' };
  const id = String(rewardId || '');
  if (!id) return { error: 'Missing reward id' };
  if (p.purchases.includes(id)) return { error: 'That view was already paid for', duplicate: true };
  const amount = Math.max(0, Math.floor(Number(coins) || 0));
  if (!amount) return { error: 'Nothing to credit' };
  p.purchases.push(id);
  if (p.purchases.length > 500) p.purchases.splice(0, p.purchases.length - 500);
  p.coins += amount;
  const book = adsBook(p);
  const slot = String(placement || 'unknown');
  book.views[slot] = (book.views[slot] || 0) + 1;
  book.coins = (book.coins || 0) + amount;
  book.lastAt = Date.now();
  appendLedger({
    at: Date.now(),
    provider: 'ads',
    packId: slot,
    usd: 0,
    coins: amount,
    token,
    txn: id,
    note: String(note || '').slice(0, 140),
  });
  save();
  return { ok: true, coins: p.coins, awarded: amount, views: { ...book.views }, adCoins: book.coins };
}

/**
 * The win a double-up would be doubling: this device's most recent real win,
 * still inside the window, not already doubled. Anything else — a runner-up
 * coin, a win from this morning, a win that has had its ad — comes back null,
 * and the offer is refused before a single frame of video is served.
 */
export function winAwaitingDouble(token, { withinMs = 20 * 60 * 1000, now = Date.now() } = {}) {
  const p = token ? profiles.get(token) : null;
  if (!p) return null;
  for (let i = ledger.length - 1; i >= 0; i--) {
    const e = ledger[i];
    // The ledger is written in order, so the first row older than the window
    // means every row behind it is too.
    if (now - e.at > withinMs) return null;
    if (e.token !== token || e.provider !== 'win' || e.placing) continue;
    if (p.purchases?.includes(adsRewardId('doubleWin', e.txn))) return null;
    return { txn: e.txn, coins: e.coins || 0, at: e.at, note: e.note || '' };
  }
  return null;
}

/** Today's ad payout, read straight off the ledger — the desk's headline. */
export function adsDayTotals(now = Date.now()) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const from = midnight.getTime();
  const out = { views: 0, coins: 0, players: 0, byPlacement: {} };
  const seen = new Set();
  for (let i = ledger.length - 1; i >= 0; i--) {
    const e = ledger[i];
    if (e.at < from) break;
    if (e.provider !== 'ads') continue;
    out.views++;
    out.coins += e.coins || 0;
    const slot = e.packId || 'unknown';
    const row = out.byPlacement[slot] ?? (out.byPlacement[slot] = { views: 0, coins: 0 });
    row.views++;
    row.coins += e.coins || 0;
    if (e.token) seen.add(e.token);
  }
  out.players = seen.size;
  return out;
}

// ------------------------------------------------------------- leaderboard --
/**
 * The lifetime table, top of the pile first. Strictly public fields — codes
 * and totals, never tokens or emails — and only people who have actually won
 * something. House players can't appear by construction: they never touch
 * profileFor, so there is no profile to rank.
 */
export function leaderboardView(limit = 50) {
  return [...profiles.values()]
    .filter((p) => (p.wins || 0) > 0)
    .sort((a, b) => (b.wins || 0) - (a.wins || 0) || (b.winnings || 0) - (a.winnings || 0))
    .slice(0, limit)
    .map((p) => ({
      code: p.code,
      name: p.name || 'Player',
      flag: p.flag || '',
      wins: p.wins || 0,
      winnings: p.winnings || 0,
    }));
}

// ------------------------------------------------------------ achievements --
/**
 * End-of-game badges, kept for good. The room hands out at most one title per
 * player per game; the shelf just counts how often each one lands. Only an
 * existing profile collects — a title was earned in a game the human joined,
 * so the profile is already there, and a bot id resolves to nothing.
 */
export function recordTitle(token, title) {
  const p = profiles.get(token);
  const name = String(title || '').slice(0, 60);
  if (!p || !name) return;
  p.titleCounts ??= {};
  p.titleCounts[name] = (p.titleCounts[name] || 0) + 1;
  save();
}

/**
 * Lifetime turns, bumped once per finished game for everyone still seated.
 * The same call is where a visitor becomes a player: the first game that
 * puts a turn on the board stamps `firstPlayed`, and that date is what the
 * "new real players" chart is drawn from. `games` counts the sittings even
 * when a table somehow ends on turn zero.
 */
export function noteTurns(token, turns) {
  const p = profiles.get(token);
  const n = Math.floor(Number(turns) || 0);
  if (!p) return;
  p.games = (p.games || 0) + 1;
  if (n > 0) {
    if (!(p.turnsPlayed > 0)) p.firstPlayed = Date.now();
    p.turnsPlayed = (p.turnsPlayed || 0) + n;
  }
  save();
}

// ----------------------------------------------------------- real players --
// A profile is minted the moment a browser joins a lobby, so the profile
// count is a count of visitors: the owner's own test tabs, anyone who opened
// a table and left, every extra browser. The book that answers "who actually
// played" is this one — a real player has finished at least one game, which
// is exactly what turnsPlayed records.
export const isRealProfile = (p) => (p && p.turnsPlayed > 0) || false;

/** The public row for one profile — codes and totals, never tokens. */
const playerRow = (p) => ({
  code: p.code,
  name: p.name || '',
  flag: p.flag || '',
  coins: p.coins ?? 0,
  karma: p.karma ?? KARMA_MAX,
  games: p.games || 0,
  wins: p.wins || 0,
  winnings: p.winnings || 0,
  turnsPlayed: p.turnsPlayed || 0,
  // Profiles that turned real before turn tracking shipped have no first
  // game on file; their birthdate is the closest honest stand-in, and the
  // flag says which one the caller is looking at. A visitor has no first
  // game at all, and says so.
  firstPlayed: p.turnsPlayed > 0 ? (p.firstPlayed || p.created || null) : null,
  firstPlayedExact: !!p.firstPlayed,
  seen: p.seen || null,
  created: p.created || null,
});

/** Everyone who has finished a game, busiest first. */
export function realPlayers() {
  return [...profiles.values()]
    .filter(isRealProfile)
    .map(playerRow)
    .sort((a, b) => b.games - a.games || b.wins - a.wins || b.coins - a.coins);
}

/**
 * The headline counts. `today` and `week` are real players *seen* in the
 * window — the profile's last sighting, the same clock the DAU strip uses —
 * so the hero can lead with people instead of browsers.
 */
export function realCounts(now = Date.now()) {
  const day = 24 * 60 * 60 * 1000;
  let all = 0, today = 0, week = 0, month = 0;
  for (const p of profiles.values()) {
    if (!isRealProfile(p)) continue;
    all++;
    const since = p.seen ? now - p.seen : Infinity;
    if (since < day) today++;
    if (since < 7 * day) week++;
    if (since < 30 * day) month++;
  }
  return { all, today, week, month, tourists: profiles.size - all, profiles: profiles.size };
}

/** The caller's own shelf — read-only, same no-minting rule as walletOf. */
export function achievementsView(token) {
  const p = token ? profiles.get(token) : null;
  if (!p) return { titles: {}, wins: 0, winnings: 0, turnsPlayed: 0 };
  return {
    titles: p.titleCounts || {},
    wins: p.wins || 0,
    winnings: p.winnings || 0,
    turnsPlayed: p.turnsPlayed || 0,
  };
}

// -------------------------------------------------------------------- push --
// Device tokens for turn notifications, stored per profile. Capped at five —
// a household of devices, not a botnet — and deduped, because clients
// re-register on every launch and the list must not grow for it.
const PUSH_MAX_DEVICES = 5;
const PUSH_PLATFORMS = ['ios', 'android'];

export function registerPushDevice(token, deviceToken, platform) {
  const device = String(deviceToken || '').trim().slice(0, 200);
  const plat = String(platform || '').trim().toLowerCase();
  if (!device) return { error: 'Missing device token' };
  if (!PUSH_PLATFORMS.includes(plat)) return { error: 'Unknown platform' };
  const p = profileFor(token);
  if (!p) return { error: 'Missing identity' };
  p.push ??= [];
  // Re-registering moves the device to the back of the line, freshly stamped.
  p.push = p.push.filter((d) => d.device !== device);
  p.push.push({ device, platform: plat, at: Date.now() });
  if (p.push.length > PUSH_MAX_DEVICES) p.push.splice(0, p.push.length - PUSH_MAX_DEVICES);
  save();
  return { ok: true, devices: p.push.length };
}

/** The sender's read — push.js needs the devices, never the whole profile. */
export const pushDevicesOf = (token) => profiles.get(token)?.push || [];

// -------------------------------------------------------------------- bans --
// A ban sticks to the device token, not the name on it — renaming doesn't
// help. Clearing the browser does; this is a lock on the door, not a fortress.
const BANS_STORE = path.join(DATA_DIR, 'bans.json');
/** @type {Map<string, {token:string, code:string, name:string, reason:string, at:number}>} */
const bans = new Map();

function loadBans() {
  try {
    const raw = JSON.parse(fs.readFileSync(BANS_STORE, 'utf8'));
    for (const b of raw || []) bans.set(b.token, b);
    if (bans.size) console.log(`  bans: restored ${bans.size}`);
  } catch {
    // nobody banned yet
  }
}

function saveBans() {
  try {
    fs.mkdirSync(path.dirname(BANS_STORE), { recursive: true });
    fs.writeFileSync(BANS_STORE, JSON.stringify([...bans.values()]));
  } catch (err) {
    console.warn('bans: could not persist —', err.message);
  }
}

export const isBanned = (token) => bans.has(token);

export function banByCode(rawCode, reason) {
  const code = String(rawCode || '').trim().toUpperCase();
  const token = byCode.get(code);
  if (!token) return { error: 'No player with that code' };
  if (bans.has(token)) return { error: 'Already banned' };
  const p = profiles.get(token);
  bans.set(token, { token, code, name: p?.name || '', reason: String(reason || '').slice(0, 140), at: Date.now() });
  saveBans();
  return { ok: true, code, name: p?.name || '' };
}

export function unbanByCode(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  for (const [token, b] of bans) {
    if (b.code !== code) continue;
    bans.delete(token);
    saveBans();
    return { ok: true, code };
  }
  return { error: 'Not on the banned list' };
}

/** The list as the dashboard sees it — tokens withheld, newest first. */
export function bansView() {
  return [...bans.values()]
    .map(({ token, ...b }) => b)
    .sort((a, b) => b.at - a.at);
}

// ------------------------------------------------------------ friend chat --
// Lightweight DMs between friends, polled over REST. One thread per pair,
// keyed by their sorted codes, capped so the file can't balloon.
const dms = new Map(); // 'CODE1|CODE2' -> [{from, text, at}]

const dmKey = (a, b) => [a, b].sort().join('|');

export function sendDM(token, rawCode, text) {
  const me = profileFor(token);
  const code = String(rawCode || '').trim().toUpperCase();
  const themToken = byCode.get(code);
  const them = themToken ? profiles.get(themToken) : null;
  if (!me || !them) return { error: 'Unknown player' };
  if (!me.friends.includes(code)) return { error: 'You can only message friends' };
  const clean = String(text || '').slice(0, 300).trim();
  if (!clean) return { error: 'Empty message' };
  const key = dmKey(me.code, code);
  const thread = dms.get(key) || [];
  thread.push({ from: me.code, text: clean, at: Date.now() });
  dms.set(key, thread.slice(-200));
  save();
  return { ok: true };
}

export function dmsWith(token, rawCode) {
  const me = profileFor(token);
  const code = String(rawCode || '').trim().toUpperCase();
  if (!me) return { error: 'Unknown player' };
  if (!me.friends.includes(code)) return { error: 'You can only message friends' };
  return { messages: dms.get(dmKey(me.code, code)) || [], me: me.code };
}

export function dmThreads() { return dms; }

// ----------------------------------------------------------------- friends --
export function addFriend(token, rawCode) {
  const me = profileFor(token);
  if (!me) return { error: 'Unknown player' };
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { error: 'Enter a friend code' };
  if (code === me.code) return { error: "That's your own code" };

  const theirToken = byCode.get(code);
  if (!theirToken) return { error: 'No player with that code' };
  const them = profiles.get(theirToken);

  if (me.friends.length >= MAX_FRIENDS) return { error: 'Your friends list is full' };

  // Friendship is mutual and needs no approval step — you had to know the code.
  if (!me.friends.includes(them.code)) me.friends.push(them.code);
  if (!them.friends.includes(me.code)) them.friends.push(me.code);
  save();
  return { ok: true, friend: publicView(them) };
}

export function removeFriend(token, rawCode) {
  const me = profiles.get(token);
  if (!me) return { error: 'Unknown player' };
  const code = String(rawCode || '').trim().toUpperCase();
  me.friends = me.friends.filter((c) => c !== code);
  const them = profiles.get(byCode.get(code));
  if (them) them.friends = them.friends.filter((c) => c !== me.code);
  save();
  return { ok: true };
}

export function friendsOf(token) {
  const me = profiles.get(token);
  if (!me) return [];
  return me.friends.map((code) => {
    const them = profiles.get(byCode.get(code));
    if (!them) return null;
    const at = presence.get(them.token);
    return { ...publicView(them), ...(at ? { roomId: at.roomId, status: at.status } : { status: 'offline' }) };
  }).filter(Boolean);
}

// ---------------------------------------------------------------- presence --
/**
 * Everything the admin dashboard needs — read-only snapshot. Every row says
 * whether it belongs to a real player or a visitor, so the desk can filter
 * the tourists out instead of counting them as customers.
 */
export function allProfiles() {
  return [...profiles.values()].map((p) => {
    const at = presence.get(p.token);
    return {
      ...playerRow(p),
      friends: (p.friends || []).length,
      roomId: at?.roomId || null, status: at?.status || 'offline',
      login: p.login || null, email: p.email || null,
      banned: bans.has(p.token),
      real: isRealProfile(p),
    };
  });
}

/** Records an external login (google/apple) against the identity token. */
export function attachLogin(token, provider, subject, name, { email, picture } = {}) {
  const p = profileFor(token, { name });
  if (!p) return null;
  const stored = profiles.get(token);
  stored.login = { provider, subject, at: Date.now() };
  if (name) stored.name = name;
  // The photo and address are display-only — they make the signed-in state
  // visible, they are never used to look anything up.
  if (email) stored.email = String(email).slice(0, 120);
  if (picture) stored.picture = String(picture).slice(0, 400);
  saveSoon();
  return { code: stored.code, name: stored.name, picture: stored.picture || '' };
}

/** Unlink the provider — the anonymous device identity stays untouched. */
export function detachLogin(token) {
  const stored = profiles.get(token);
  if (!stored) return { ok: true };
  delete stored.login;
  delete stored.email;
  delete stored.picture;
  saveSoon();
  return { ok: true };
}

/** Who this device is, for the profile chip: sign-in state included. */
export function meView(token) {
  // Same read-only rule as walletOf — the profile chip asks on every visit.
  if (!token) return null;
  if (!profiles.get(token)) {
    return { code: '', name: '', flag: '', coins: 0, karma: KARMA_MAX, provider: null, email: '', picture: '' };
  }
  const p = profileFor(token);
  const stored = profiles.get(token);
  return {
    code: stored.code,
    name: stored.name || '',
    flag: stored.flag || '',
    coins: stored.coins ?? 0,
    karma: stored.karma ?? 100,
    provider: stored.login?.provider || null,
    email: stored.email || '',
    picture: stored.picture || '',
  };
}

function saveSoon() { save(); }

export function setPresence(token, roomId, status = 'lobby') {
  if (!token) return;
  if (roomId) presence.set(token, { roomId, status, at: Date.now() });
  else presence.delete(token);
}

export const clearPresence = (token) => presence.delete(token);

/** Which room this device is sitting in right now, if any. */
export const roomOf = (token) => presence.get(token)?.roomId || null;

/** How many of each store item are owned across every wallet — the burn side. */
export function ownedTally() {
  const tally = {};
  for (const p of profiles.values()) {
    for (const id of p.owned || []) tally[id] = (tally[id] || 0) + 1;
  }
  return tally;
}

/** What this module keeps on disk, and when it last got there. */
export function dataFiles() {
  const stat = (file) => {
    try {
      const s = fs.statSync(file);
      return { size: s.size, savedAt: s.mtimeMs };
    } catch { return null; }
  };
  return { dir: DATA_DIR, social: stat(STORE), ledger: stat(LEDGER_STORE), bans: stat(BANS_STORE) };
}

load();
loadLedger();
loadBans();
