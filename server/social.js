// Friends without accounts.
//
// Every browser already carries a random identity token. We derive a short,
// stable friend code from it, so people can add each other by code without
// signing up for anything. Presence is tracked per token, which lets the
// friends list offer a "join" button when someone is sitting in a lobby.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { randomName } from './names.js';
import { itemById, emojiFor } from './store.js';
import { TITLE_NAMES } from './game.js';
import { RENT_PRICE } from './boards.js';
import { cleanText, cleanFlag, isAllMasked } from './banter.js';
import { writeFileAtomic, readJsonStore } from './storage.js';
import {
  levelFor, levelInfo, gameXp, seedXp, houseLevel, houseCareer, LEVEL_UP_COINS, MISSION_XP, GAME_XP_PER_DAY,
  CAREER_KEYS, favoriteBoard, foldCareer,
  missionKinds, missionOf, missionProgress, MISSION_COINS, MISSION_BONUS_COINS,
  weekKey, weekResetsAt,
} from './progression.js';

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
/**
 * Every App Store transaction id that has ever paid out, on any profile.
 *
 * The dedupe used to live on the buyer's own profile, which is exactly the
 * thing account deletion removes — so a player could buy a pack, delete their
 * account, and redeem the same receipt again on the fresh identity the app
 * hands them. It lives here now, outside any one player, and it outlives them.
 */
const redeemed = new Set();

// ---------------------------------------------------------------- storage --
function load() {
  // Missing is a first run; broken is set aside and the newest good backup
  // is read instead — see storage.js. Either way, never a silent fresh start
  // that the next save writes over everybody's wallet.
  const raw = readJsonStore(STORE);
  if (!raw) return;
  try {
    for (const p of raw.profiles || []) {
      profiles.set(p.token, p);
      byCode.set(p.code, p.token);
      for (const txn of p.purchases || []) redeemed.add(txn);
      // Names are filtered when they are written now; ones written before
      // that are filtered once here, so an old slur doesn't stay on a board.
      if (p.name) {
        const clean = cleanText(String(p.name).slice(0, 16));
        p.name = isAllMasked(clean) ? 'Player' : clean;
      }
      // Likewise flags written before cleanFlag existed.
      if (p.flag) p.flag = cleanFlag(p.flag);
      // Levels arrived after most of these people had been playing for
      // months. Rather than start a veteran at level 1 beside somebody who
      // installed the app this morning, a profile with no XP on file is
      // credited for the games and wins it already has, once, here — and
      // the level that lands on counts as paid, so nobody is handed a pile
      // of level-up coins for the day the feature shipped. Done at load,
      // before any game can end, so this game's win is never counted twice.
      if (p.xp === undefined) p.xp = seedXp(p);
      p.levelPaid ??= levelFor(p.xp);
    }
    for (const txn of raw.redeemed || []) redeemed.add(txn);
    for (const [key, thread] of Object.entries(raw.dms || {})) {
      dms.set(key, thread);
    }
    if (Array.isArray(raw.notices)) notices.push(...raw.notices);
    if (Array.isArray(raw.reports)) reports.push(...raw.reports);
    console.log(`  social: restored ${profiles.size} profile(s)`);
  } catch (err) {
    console.error('social: the store parsed but could not be loaded —', err.message);
  }
}

function writeStore() {
  try {
    writeFileAtomic(STORE, JSON.stringify({
      profiles: [...profiles.values()],
      dms: Object.fromEntries(dms),
      notices: notices.slice(0, MAX_NOTICES),
      reports: reports.slice(0, MAX_REPORTS),
      redeemed: [...redeemed],
    }));
  } catch (err) {
    console.warn('social: could not persist profiles —', err.message);
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; writeStore(); }, 1500);
  saveTimer.unref?.();
}

// ------------------------------------------------------------------ ledger --
// Every coin credit that had money (or an operator) behind it, in order. This
// file is the revenue source of truth from the moment it was added — earlier
// purchases live only in each profile's dedupe list, with no amounts.
/** @type {Array<{at:number, provider:string, packId:string|null, usd:number, coins:number, token:string, txn:string, note?:string}>} */
let ledger = [];

function loadLedger() {
  // No ledger yet means it begins with the first credit after this deploy.
  const raw = readJsonStore(LEDGER_STORE);
  if (Array.isArray(raw)) ledger = raw;
  if (ledger.length) console.log(`  ledger: restored ${ledger.length} entr${ledger.length === 1 ? 'y' : 'ies'}`);
}

function writeLedger() {
  try {
    writeFileAtomic(LEDGER_STORE, JSON.stringify(ledger));
  } catch (err) {
    console.warn('ledger: could not persist —', err.message);
  }
}

let ledgerTimer = null;
function saveLedger() {
  clearTimeout(ledgerTimer);
  ledgerTimer = setTimeout(() => { ledgerTimer = null; writeLedger(); }, 1500);
  ledgerTimer.unref?.();
}

/**
 * Write whatever is still waiting out its debounce, now. A deploy stops the
 * process with SIGTERM, and without this the last second and a half went
 * with it — a coin pack the phone had already finished with StoreKit, a
 * game's payout, the receipt that makes a replay of it refused.
 */
export function flushSocial() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; writeStore(); }
  if (ledgerTimer) { clearTimeout(ledgerTimer); ledgerTimer = null; writeLedger(); }
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
  if (name) {
    // The same filter the table chat uses. A name is shown to strangers on
    // every board it sits at, so it is held to at least the standard a
    // single chat line is.
    const clean = cleanText(String(name).slice(0, 16));
    p.name = isAllMasked(clean) ? 'Player' : clean;
  }
  if (flag !== undefined) p.flag = cleanFlag(flag);
  // The wallet rides on the profile: coins earned by winning, cosmetics
  // bought in the store, and what's currently equipped.
  p.coins ??= 0;
  p.owned ??= [];
  p.equipped ??= {};
  // Transaction ids already credited — a receipt can never pay out twice.
  p.purchases ??= [];
  // One-game passes on boards this wallet does not own — see "renting a
  // board" below. Unspent ones are money, so they are minted here with
  // everything else rather than only when the first one is bought.
  p.rentals ??= [];
  // Karma is a politeness score: everyone starts full, walking out on a live
  // game or letting the clock run out costs a point.
  p.karma ??= KARMA_MAX;
  // Profiles older than this field get their last sighting as a birthdate —
  // wrong, but wrong in the least misleading direction available.
  p.created ??= p.seen || Date.now();
  // Every coin this wallet has ever been paid, and nothing it has spent. The
  // balance alone cannot tell a client whether a number it just read is news:
  // a poll repeats it, a purchase moves it the other way, and a win followed
  // by a spend can land it back where it started. This only ever goes up, so
  // "it moved" and "coins arrived" are the same sentence — which is what the
  // counter animation on both clients hangs off. A wallet that predates the
  // field starts at nought; it is a watermark, not a lifetime statistic.
  p.earned ??= 0;
  // A profile born today starts at level 1 with nothing to pay for it. (One
  // that predates levels was credited at load — see load().)
  p.xp ??= 0;
  p.levelPaid ??= levelFor(p.xp);
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
  // Karma belongs to somebody who exists. A seat can outlive its account by a
  // few seconds — a game still settling after its owner deleted themselves —
  // and minting a profile here would bring the deleted account straight back.
  if (!profiles.has(token)) return null;
  const p = profileFor(token);
  if (!p) return null;
  p.karma = Math.max(0, Math.min(KARMA_MAX, p.karma + delta));
  save();
  return p.karma;
}

export const karmaOf = (token) => profileFor(token)?.karma ?? KARMA_MAX;

const publicView = (p) => ({
  code: p.code, name: p.name || 'Player', flag: p.flag || '',
  // The face itself, as every other view of a player gives it. `equipped`
  // holds the store item id, and every client printed that id — "av-cool" —
  // as text in the friend's face circle, in front of their flag.
  avatar: emojiFor(p.equipped?.avatar),
});

// ------------------------------------------------------------ store wallet --
/**
 * The one line that adds coins to a wallet.
 *
 * Four things pay out — a purchase, a win, the daily, a rewarded view — and
 * each of them used to do `p.coins += amount` on its own. They go through
 * here now so the earned watermark cannot be forgotten by whatever pays out
 * next: a credit that skipped it would land in the balance and never be
 * announced to the player it belongs to.
 */
function credit(p, amount) {
  const coins = Math.max(0, Math.floor(Number(amount) || 0));
  p.coins += coins;
  p.earned = (p.earned || 0) + coins;
  return p.coins;
}

export function walletOf(token) {
  // Reading a wallet must not mint one: every page load asks, and so does
  // every crawler that executes our JS. The profile is born the first time
  // the visitor actually DOES something — joins a table, sets a name, buys.
  if (!token) return null;
  const p = profiles.get(token);
  if (!p) return { coins: 0, owned: [], equipped: {}, karma: KARMA_MAX, earned: 0 };
  profileFor(token);   // it exists — freshen seen/migrations as before
  return { coins: p.coins, owned: p.owned, equipped: p.equipped, karma: p.karma, earned: p.earned || 0 };
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
  if (p.purchases.includes(txn) || redeemed.has(txn)) {
    return { ok: true, coins: p.coins, earned: p.earned, duplicate: true };
  }
  const amount = Math.max(0, Math.floor(Number(coins) || 0));
  if (!amount) return { error: 'Nothing to credit' };
  p.purchases.push(txn);
  redeemed.add(txn);
  if (p.purchases.length > 500) p.purchases.splice(0, p.purchases.length - 500);
  credit(p, amount);
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
  return { ok: true, coins: p.coins, earned: p.earned };
}

/** Winning pays out — a coin or two, longer games pay the bigger purse. */
export function awardCoins(token, amount) {
  // The same rule as karma: a payout never creates the person it pays.
  if (!profiles.has(token) || amount <= 0) return null;
  const p = profileFor(token);
  if (!p) return null;
  credit(p, amount);
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
/**
 * Coins one wallet may take from finished tables in a day, wins and
 * runner-up places together.
 *
 * Every finished table pays, and nothing stops two windows on one machine
 * starting a game, conceding it and pressing Play again, a few coins a lap
 * and a leaderboard win each time. The server already refuses to pay a table
 * that was never really played (see recordTransitions); this is the ceiling
 * over the ones that were. Twenty wins a day is far past any real evening.
 */
export const TABLE_COINS_PER_DAY = 40;

export function awardWin(token, amount, note, { placing = false, daily = false } = {}) {
  const coins = Math.floor(Number(amount) || 0);
  // `daily` is a table's payout, and counts against the ceiling above. An
  // operator's float or a test's does not.
  const day = daily ? dayKey() : null;
  const sofar = (p) => (day && p?.tableCoins?.day === day ? p.tableCoins.coins : 0);
  if (day && sofar(profiles.get(token)) + coins > TABLE_COINS_PER_DAY) return null;
  const balance = awardCoins(token, coins);
  if (balance == null) return null;
  if (day) {
    const p = profiles.get(token);
    if (p) p.tableCoins = { day, coins: sofar(p) + coins };
  }
  // The lifetime tally the leaderboard reads: every win routed through here
  // bumps the count and banks the purse. awardCoins just minted the profile
  // if it somehow didn't exist, so the get can't miss.
  const p = profiles.get(token);
  if (p && !placing) {
    p.wins = (p.wins || 0) + 1;
    p.winnings = (p.winnings || 0) + coins;
    // And this week's, for the weekly board. A tally from an older week is
    // simply last week's: it starts over at the first win of the new one,
    // and the board ignores it until then (see leaderboardFor).
    const week = weekKey();
    if (p.weekly?.week !== week) p.weekly = { week, wins: 0, winnings: 0 };
    p.weekly.wins += 1;
    p.weekly.winnings += coins;
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
  return { ok: true, coins: p.coins, earned: p.earned, owned: p.owned };
}

export function equipItem(token, slot, itemId) {
  const p = profileFor(token);
  if (!p) return { error: 'Unknown player' };
  if (!['token', 'avatar'].includes(slot)) return { error: 'Unknown slot' };
  if (itemId && !p.owned.includes(itemId)) return { error: 'Not owned' };
  // Owning a thing is not the same as it fitting the slot. The shelf sells
  // boards now, and a board is bought into the same `owned` list as a piece —
  // so without this a player could wear their board as their token and walk
  // around the map as a tiny tricolour.
  if (itemId && itemById(itemId)?.kind !== slot) {
    return { error: `That is not ${slot === 'avatar' ? 'an avatar' : 'a token'}` };
  }
  if (itemId) p.equipped[slot] = itemId;
  else delete p.equipped[slot];
  save();
  return { ok: true, equipped: p.equipped };
}

// --------------------------------------------------------- renting a board --
// A third door onto a locked board, beside free-today and bought-outright:
// one coin, one game.
//
// What gets written down is a pass, and a pass names two things — the board it
// is good for and the one table it is good at. The table is the whole trick.
// Without it a single coin would open ten lobbies at once; with it, a second
// table is a second pass and a second coin.
//
// An unspent pass is never eaten. Renting while you already hold one that has
// not been played MOVES it to the new table and the new board rather than
// charging again, so the coin always buys the game it promised — tonight, or
// whenever the table it was bought for finally happens. Only dealing the cards
// spends it, and that is stamped in exactly one place: recordTransitions in
// server/index.js, the moment a room turns from lobby to playing.
//
// Spent passes are kept a day as a record and then swept. Unspent ones are
// never swept, because an unspent pass IS the coin.

/** Pass-and-play seats derive their token from the phone's — one wallet, one book. */
const baseToken = (t) => String(t || '').replace(/_p\d+$/, '');

const RENTAL_KEEP_MS = 24 * 60 * 60 * 1000;
const RENTAL_MAX = 20;

/**
 * The book, swept on the way out.
 *
 * The cap only ever trims from the front, which is the oldest end, and the
 * unspent pass is always the newest entry — renting again moves that one
 * rather than pushing another — so the sweep can never cost anybody a game
 * they have paid for.
 */
function rentalBook(p) {
  p.rentals ??= [];
  const cutoff = Date.now() - RENTAL_KEEP_MS;
  p.rentals = p.rentals.filter((r) => !r.startedAt || r.startedAt > cutoff);
  if (p.rentals.length > RENTAL_MAX) p.rentals.splice(0, p.rentals.length - RENTAL_MAX);
  return p.rentals;
}

/** The one unspent pass this wallet is holding, if it is holding one. */
export function rentalOf(token) {
  const p = profiles.get(baseToken(token));
  if (!p) return null;
  return rentalBook(p).find((r) => !r.startedAt) || null;
}

/**
 * Was a pass for this board, at this table, bought and then actually played?
 *
 * Only the log of what happened — nothing is decided by it. It exists so that
 * a table which loses its board can be told the true reason instead of being
 * told the host changed, which after a rented game is wrong every time: the
 * same host is standing there and the pass they paid for has simply been used.
 */
export function rentalSpent(token, mapId, roomId) {
  const p = profiles.get(baseToken(token));
  if (!p) return false;
  const map = String(mapId || '');
  const room = String(roomId || '');
  return rentalBook(p).some((r) => r.startedAt && r.mapId === map && r.roomId === room);
}

/** Is this table, on this board, covered by a pass that has not been played? */
export function hasLiveRental(token, mapId, roomId) {
  const open = rentalOf(token);
  return !!open && open.mapId === String(mapId || '') && open.roomId === String(roomId || '');
}

/**
 * Pay for one game on a board you do not own.
 *
 * Whether the board is locked at all is the calendar's business and is settled
 * by the caller (see /api/boards/rent) — this end only knows wallets. It is
 * idempotent by construction: a second tap on the same board and table finds
 * the same unspent pass and charges nothing.
 */
export function rentBoard(token, mapId, roomId) {
  const base = baseToken(token);
  const map = String(mapId || '').slice(0, 40);
  const room = String(roomId || '').slice(0, 12);
  if (!base || !map || !room) return { error: 'Missing player, board or table' };
  const p = profileFor(base);
  if (!p) return { error: 'Unknown player' };
  const book = rentalBook(p);
  const open = book.find((r) => !r.startedAt);
  if (open) {
    const moved = (open.mapId === map && open.roomId === room)
      ? null : { mapId: open.mapId, roomId: open.roomId };
    open.mapId = map;
    open.roomId = room;
    open.at = Date.now();
    save();
    return { ok: true, coins: p.coins, charged: 0, mapId: map, roomId: room, movedFrom: moved };
  }
  if (p.coins < RENT_PRICE) return { error: 'Not enough coins' };
  p.coins -= RENT_PRICE;
  book.push({ mapId: map, roomId: room, at: Date.now(), coins: RENT_PRICE, startedAt: null });
  save();
  return { ok: true, coins: p.coins, charged: RENT_PRICE, mapId: map, roomId: room, movedFrom: null };
}

/**
 * Stamp a pass used. One table, one game: after this the board falls back to
 * Classic anywhere else, including this table's own rematch.
 */
export function consumeRental(token, mapId, roomId) {
  const p = profiles.get(baseToken(token));
  if (!p) return false;
  const map = String(mapId || '');
  const room = String(roomId || '');
  const open = rentalBook(p).find((r) => !r.startedAt && r.mapId === map && r.roomId === room);
  if (!open) return false;
  open.startedAt = Date.now();
  save();
  return true;
}

// ------------------------------------------------------------ daily reward --
// Showing up pays, but barely: one coin on day one, two on the second day
// in a row, up to seven — and then the week starts again at one. A streak
// is a run of seven-day cycles, 1 → 7 → 1 → 7, for as long as it lasts; a
// missed day starts it over at one too. Coins have to stay scarce enough
// that the shop is worth visiting, and a ladder that parked at seven paid a
// regular the top rate every day for as long as they kept coming. Dates are
// the server's calendar.
const DAILY_BASE = 1;
const DAILY_CYCLE = 7;

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
function nextMidnight(when = Date.now()) {
  const d = new Date(when);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/**
 * Where in the seven-day cycle a streak's last claim stood, 1–7. Kept on the
 * profile (`daily.cycle`) since the cycle began; a profile from before it
 * only has the streak, and its last claim paid what the old ladder paid —
 * the streak, held at seven — which is exactly its place in a cycle. A
 * regular who sat on seven-coin days under the old ladder therefore starts
 * the next cycle at one, as the rule says the day after a seven does.
 */
function cycleOf(d) {
  const c = Math.floor(Number(d?.cycle));
  if (c >= 1 && c <= DAILY_CYCLE) return c;
  return Math.max(1, Math.min(DAILY_CYCLE, Math.floor(Number(d?.streak)) || 1));
}

/** The step after this one: 7 wraps to 1. */
const nextStep = (step) => (step % DAILY_CYCLE) + 1;

/** What a claim pays at a given step of the cycle — the step, in coins. */
const dailyAmount = (step) => DAILY_BASE + (step - 1);

/**
 * Read-only peek — the same rule as walletOf: the home screen asks on every
 * load, and asking must not mint a profile. An unknown token simply sees day
 * one waiting for it; a lapsed streak already reads as zero.
 *
 * `cycleDay` is the step of the seven-day cycle the card is about, for the
 * seven-step bar: before today's claim, the step today's claim pays (always
 * `amount`); once it is claimed (`claimedToday`), the step that was claimed —
 * `amount` is then tomorrow's, which is the next step round.
 */
export function dailyView(token) {
  const p = token ? profiles.get(token) : null;
  // The daily coin is the one thing here that pays out for nothing but
  // turning up, which makes it the one thing worth farming: a fresh device
  // identity costs a private window. Tying it to a real account is what
  // stops one person collecting it eight times a morning — and it is why the
  // card says so rather than simply going quiet.
  const signedIn = !!p?.login;
  const d = p?.daily;
  const today = dayKey();
  const cycle = { cycleLength: DAILY_CYCLE };
  if (!d?.last) {
    return { signedIn, claimable: signedIn, streak: 0, amount: dailyAmount(1), nextAt: null,
      cycleDay: 1, claimedToday: false, ...cycle };
  }
  if (d.last === today) {
    // Claimed already; the amount shown is what tomorrow's claim will pay.
    const step = cycleOf(d);
    return { signedIn, claimable: false, streak: d.streak, amount: dailyAmount(nextStep(step)), nextAt: nextMidnight(),
      cycleDay: step, claimedToday: true, ...cycle };
  }
  const streakAlive = d.last === yesterdayKey();
  const step = streakAlive ? nextStep(cycleOf(d)) : 1;
  return {
    signedIn,
    claimable: signedIn,
    streak: streakAlive ? d.streak : 0,
    amount: dailyAmount(step),
    nextAt: null,
    cycleDay: step,
    claimedToday: false,
    ...cycle,
  };
}

/**
 * The claim itself. This is a real action, so profileFor applies — a fresh
 * token earns its profile the moment it collects day one. Coins move through
 * the same ledger money does: provider 'daily', zero dollars, streak noted.
 */
export function claimDaily(token) {
  // Checked before profileFor, so a token that has never signed in cannot
  // even mint a profile by asking for the coin.
  if (!profiles.get(token)?.login) {
    return { error: 'Sign in to collect your daily coins', needsLogin: true };
  }
  const p = profileFor(token);
  if (!p) return { error: 'Missing identity' };
  const today = dayKey();
  const d = p.daily ?? (p.daily = { last: null, streak: 0 });
  if (d.last === today) {
    return { error: 'Already claimed today', claimed: true, streak: d.streak, nextAt: nextMidnight(), cycleDay: cycleOf(d) };
  }
  const alive = d.last === yesterdayKey();
  // The step is worked out from the last claim before either is moved on.
  const step = alive ? nextStep(cycleOf(d)) : 1;
  d.streak = alive ? d.streak + 1 : 1;
  d.cycle = step;
  d.last = today;
  // The moment, not just the day: the daily reminder rings about a day after
  // this, which is about the time of day this player tends to turn up.
  d.at = Date.now();
  const amount = dailyAmount(step);
  credit(p, amount);
  appendLedger({
    at: Date.now(),
    provider: 'daily',
    packId: null,
    usd: 0,
    coins: amount,
    token,
    txn: `daily:${today}:${p.code}`,
    note: `day ${d.streak} of the streak, ${step} of ${DAILY_CYCLE}`,
  });
  save();
  return { ok: true, amount, coins: p.coins, earned: p.earned, streak: d.streak, nextAt: nextMidnight(), cycleDay: step };
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
  credit(p, amount);
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
  return {
    ok: true, coins: p.coins, earned: p.earned, awarded: amount,
    views: { ...book.views }, adCoins: book.coins,
  };
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

/**
 * One specific win, named by its ledger id: the row a ticket was cut against.
 * The claim asks for this rather than "their latest win" so the coins paid are
 * the coins the offer promised — a player who wins again mid-ad cannot end up
 * paid for the bigger purse while the bigger purse stays doubleable.
 */
export function winForDouble(token, txn) {
  const p = token ? profiles.get(token) : null;
  if (!p || !txn) return null;
  if (p.purchases?.includes(adsRewardId('doubleWin', txn))) return null;
  for (let i = ledger.length - 1; i >= 0; i--) {
    const e = ledger[i];
    if (e.txn !== txn) continue;
    if (e.token !== token || e.provider !== 'win' || e.placing) return null;
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
  return leaderboardFor({ limit }).top;
}

const BOARD_SCOPES = ['all', 'week', 'friends'];

/**
 * One of the three boards, as the caller sees it.
 *
 *   all      lifetime wins, everybody who has one — the board there always was
 *   week     wins since Monday 00:00 UTC, everybody who has one this week
 *   friends  the caller and their friends by lifetime wins, a friend with no
 *            wins included: a board of three people you know, two of them on
 *            nought, is still a board worth looking at
 *
 * Ties go to the bigger purse, then alphabetically, so two looks at the same
 * standings never disagree about who is above whom. `you` is the caller's own
 * place — their rank in the whole ordering, not just the top slice, or null
 * when they are not on this board at all — and their row in `top` says
 * `you: true`. No token, no `you`. Rows carry codes and totals only, the same
 * public fields this board has always printed, plus the level chip.
 */
export function leaderboardFor({ scope = 'all', token = '', limit = 50, now = Date.now() } = {}) {
  const which = BOARD_SCOPES.includes(scope) ? scope : 'all';
  const viewer = token ? profiles.get(token) || null : null;
  let entries;
  if (which === 'friends') {
    if (!viewer) return { scope: which, top: [], you: null };
    const friends = (viewer.friends || []).map((c) => profiles.get(byCode.get(c))).filter(Boolean);
    entries = [viewer, ...friends.filter((f) => f !== viewer && !blockedEitherWay(viewer, f))]
      .map((p) => ({ p, wins: p.wins || 0, winnings: p.winnings || 0 }));
  } else if (which === 'week') {
    const week = weekKey(now);
    entries = [...profiles.values()]
      .filter((p) => p.weekly?.week === week && p.weekly.wins > 0)
      .map((p) => ({ p, wins: p.weekly.wins, winnings: p.weekly.winnings || 0 }));
  } else {
    entries = [...profiles.values()]
      .filter((p) => (p.wins || 0) > 0)
      .map((p) => ({ p, wins: p.wins || 0, winnings: p.winnings || 0 }));
  }
  entries.sort((a, b) => b.wins - a.wins || b.winnings - a.winnings
    || (a.p.name || '').localeCompare(b.p.name || '') || a.p.code.localeCompare(b.p.code));

  const row = ({ p, wins, winnings }) => ({
    code: p.code,
    name: p.name || 'Player',
    flag: p.flag || '',
    level: levelFor(p.xp || 0),
    wins,
    winnings,
    ...(viewer && p === viewer ? { you: true } : {}),
  });
  let you = null;
  if (viewer) {
    const at = entries.findIndex((e) => e.p === viewer);
    const mine = which === 'week'
      ? (viewer.weekly?.week === weekKey(now) ? viewer.weekly.wins || 0 : 0)
      : viewer.wins || 0;
    you = { rank: at >= 0 ? at + 1 : null, wins: mine };
  }
  return {
    scope: which,
    ...(which === 'week' ? { week: weekKey(now), resetsAt: weekResetsAt(now) } : {}),
    top: entries.slice(0, Math.max(1, Math.min(200, Math.floor(limit) || 50))).map(row),
    you,
  };
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

/**
 * A profile as it stands, or nothing. Reading must not mint — the same rule
 * walletOf states — so this is a lookup and never a constructor.
 */
export const profilesByToken = (token) => (token ? profiles.get(token) : null) || null;

/** The sender's read — push.js needs the devices, never the whole profile. */
export const pushDevicesOf = (token) => profiles.get(token)?.push || [];

/**
 * Apple or Google says a device token is dead — the app was deleted, or the
 * token was reissued. Keeping it means one more doomed request on every future
 * turn for the rest of that player's life, so it goes.
 */
export function forgetPushDevice(token, device) {
  const p = profiles.get(token);
  if (!p?.push?.length) return { ok: true, devices: 0 };
  const before = p.push.length;
  p.push = p.push.filter((d) => d.device !== device);
  if (p.push.length !== before) save();
  return { ok: true, devices: p.push.length };
}

// -------------------------------------------------------------------- bans --
// A ban sticks to the device token, not the name on it — renaming doesn't
// help. Clearing the browser does; this is a lock on the door, not a fortress.
const BANS_STORE = path.join(DATA_DIR, 'bans.json');
/** @type {Map<string, {token:string, code:string, name:string, reason:string, at:number}>} */
const bans = new Map();

function loadBans() {
  // Nobody banned yet reads as null.
  const raw = readJsonStore(BANS_STORE);
  for (const b of Array.isArray(raw) ? raw : []) bans.set(b.token, b);
  if (bans.size) console.log(`  bans: restored ${bans.size}`);
}

function saveBans() {
  try {
    writeFileAtomic(BANS_STORE, JSON.stringify([...bans.values()]));
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
  if (blockedEitherWay(me, them)) return { error: 'You can only message friends' };
  const clean = cleanText(String(text || '').slice(0, 300)).trim();
  if (!clean) return { error: 'Empty message' };
  const key = dmKey(me.code, code);
  const thread = dms.get(key) || [];
  thread.push({ from: me.code, text: clean, at: Date.now() });
  dms.set(key, thread.slice(-200));
  save();
  return { ok: true };
}

export function dmsWith(token, rawCode) {
  // Reading a thread must not mint a profile — the same rule walletOf and
  // meView follow. This route was the hole in it: any GET with any token in
  // the query string created a permanent player, so a crawler could write
  // itself into the roster the owner reads as "new players today".
  const me = token ? profiles.get(token) : null;
  const code = String(rawCode || '').trim().toUpperCase();
  if (!me) return { error: 'Unknown player' };
  if (!me.friends.includes(code)) return { error: 'You can only message friends' };
  return { messages: dms.get(dmKey(me.code, code)) || [], me: me.code };
}

export function dmThreads() { return dms; }

// ------------------------------------------------------- safety: block/report --
//
// Anybody who can talk to strangers needs two things the moment somebody is
// unpleasant: a way to make them go away, and a way to tell whoever runs the
// place. Blocking is the first and takes effect at once — no friendship, no
// requests, no messages, and their chat hidden on your screen. Reporting is
// the second, and it lands on the owner's desk with enough context to act on.

/** Did either of these two block the other? Direction never matters here. */
function blockedEitherWay(a, b) {
  if (!a || !b) return false;
  return (a.blocked || []).includes(b.code) || (b.blocked || []).includes(a.code);
}

export function blockPlayer(token, rawCode) {
  const me = profileFor(token);
  if (!me) return { error: 'Unknown player' };
  const code = asCode(rawCode);
  if (!code || !isCode(code)) return { error: 'Pick a player' };
  if (code === me.code) return { error: "You can't block yourself" };
  me.blocked ??= [];
  if (!me.blocked.includes(code)) me.blocked.push(code);
  if (me.blocked.length > 500) me.blocked.splice(0, me.blocked.length - 500);
  // Everything that connected the two of you goes, both ways.
  pending(me);
  me.friends = me.friends.filter((c) => c !== code);
  me.wants = me.wants.filter((c) => c !== code);
  me.asked = me.asked.filter((c) => c !== code);
  if (me.botWants?.length) me.botWants = me.botWants.filter((w) => w.code !== code);
  const them = profiles.get(byCode.get(code));
  if (them) {
    pending(them);
    them.friends = them.friends.filter((c) => c !== me.code);
    them.wants = them.wants.filter((c) => c !== me.code);
    them.asked = them.asked.filter((c) => c !== me.code);
    if (invites.get(them.token)?.from === me.code) invites.delete(them.token);
  }
  if (invites.get(token)?.from === code) invites.delete(token);
  save();
  return { ok: true, blocked: [...me.blocked] };
}

export function unblockPlayer(token, rawCode) {
  const me = profiles.get(token);
  if (!me) return { error: 'Unknown player' };
  const code = asCode(rawCode);
  me.blocked = (me.blocked || []).filter((c) => c !== code);
  save();
  return { ok: true, blocked: [...me.blocked] };
}

/** @type {{id:string, at:number, from:string, about:string, reason:string, where:string, text:string, status:string}[]} */
const reports = [];        // newest first
const MAX_REPORTS = 1000;
const REPORT_REASONS = ['abuse', 'hate', 'sexual', 'spam', 'cheating', 'name', 'other'];

/**
 * Tell the owner. `text` is the message being reported, quoted as the
 * reporter saw it; `where` is chat, dm, friend or name.
 */
export function reportPlayer(token, rawCode, { reason, where, text } = {}) {
  // Somebody who has actually played — reading an existing profile rather
  // than minting one, so a script with a thousand fresh tokens cannot fill
  // the queue and push genuine reports out of it.
  const me = token ? profiles.get(token) : null;
  if (!me) return { error: 'Unknown player' };
  const code = asCode(rawCode);
  if (!code || !isCode(code) || code === me.code) return { error: 'Pick a player' };
  // A report box is also a way to flood an inbox. Twenty a day is far more
  // than anybody honestly needs.
  const today = Date.now() - 24 * 60 * 60 * 1000;
  if (reports.filter((r) => r.from === me.code && r.at > today).length >= 20) {
    return { error: 'You have sent a lot of reports today — we are looking at them' };
  }
  const report = {
    id: Math.random().toString(36).slice(2, 10),
    at: Date.now(),
    from: me.code,
    about: code,
    aboutName: profiles.get(byCode.get(code))?.name || '',
    reason: REPORT_REASONS.includes(reason) ? reason : 'other',
    where: ['chat', 'dm', 'friend', 'name'].includes(where) ? where : 'other',
    text: String(text || '').slice(0, 400),
    status: 'open',
  };
  reports.unshift(report);
  // Over the cap, the oldest CLOSED report goes first; an open one is only
  // dropped when there is nothing else left to drop.
  while (reports.length > MAX_REPORTS) {
    const i = reports.findLastIndex((r) => r.status !== 'open');
    reports.splice(i >= 0 ? i : reports.length - 1, 1);
  }
  save();
  return { ok: true, id: report.id, reason: report.reason, where: report.where };
}

/** The owner's view. Codes only — never a token. */
export const reportsView = () => reports.slice(0, 200);

export function resolveReport(id, status = 'closed') {
  const r = reports.find((x) => x.id === id);
  if (!r) return { error: 'No such report' };
  r.status = ['open', 'closed', 'actioned'].includes(status) ? status : 'closed';
  save();
  return { ok: true };
}

// --------------------------------------------------------- account deletion --
//
// Signing in makes an account, so there has to be a way to unmake one from
// inside the app. This removes the person, not just the login: the profile,
// the wallet and everything bought with it, their place on every friends list,
// their messages, their notes, and the push tokens that could still reach
// their phone. What is kept is what has to be — the purchase ledger, with the
// identity scrubbed out of it, because a sale is a record of money that
// changed hands, and a ban, because deleting an account must not be a way to
// wipe one.

export function deleteAccount(token) {
  // Pass & play seats on the same phone are profiles of their own
  // (`<token>_p2`, `_p3`…), with names and codes on other people's lists.
  // They belong to the same person and go with them.
  for (const t of [...profiles.keys()]) {
    if (t.startsWith(token + '_p') && /^_p\d+$/.test(t.slice(token.length))) deleteOne(t);
  }
  return deleteOne(token);
}

/** The guest seats of one device, for the route that has to unseat them. */
export const guestTokensOf = (token) =>
  [...profiles.keys()].filter((t) => t.startsWith(token + '_p') && /^_p\d+$/.test(t.slice(token.length)));

function deleteOne(token) {
  const me = profiles.get(token);
  if (!me) return { ok: true, deleted: false };
  const code = me.code;

  for (const other of profiles.values()) {
    if (other === me) continue;
    if (other.friends?.length) other.friends = other.friends.filter((c) => c !== code);
    if (other.wants?.length) other.wants = other.wants.filter((c) => c !== code);
    if (other.asked?.length) other.asked = other.asked.filter((c) => c !== code);
    if (invites.get(other.token)?.from === code) invites.delete(other.token);
  }
  invites.delete(token);
  for (const key of [...dms.keys()]) {
    if (key.split('|').includes(code)) dms.delete(key);
  }
  for (let i = notices.length - 1; i >= 0; i--) {
    if (notices[i].to === code) notices.splice(i, 1);
  }
  for (const r of reports) {
    if (r.from === code) r.from = 'deleted';
    if (r.about === code) { r.aboutName = ''; }
  }
  for (const entry of ledger) {
    // null, not a marker string: a string is a token somebody could claim.
    if (entry.token === token) { entry.token = null; entry.code = null; }
  }

  profiles.delete(token);
  byCode.delete(code);
  presence.delete(token);
  save();
  saveLedger();
  return { ok: true, deleted: true };
}

// ----------------------------------------------------------------- friends --
//
// Adding somebody used to put each of you straight on the other's list, on
// the grounds that you had to know their code. But a code gets read over a
// shoulder, forwarded, guessed at six characters — and being on a stranger's
// list means they can message you and see when you are online. So it is a
// request now, and the other person decides.

/** Codes come off keyboards, so they are compared uppercased and trimmed. */
const asCode = (raw) => String(raw || '').trim().toUpperCase().slice(0, 12);
/** A real friend code, or a house player's stand-in: six letters and digits. */
const isCode = (c) => /^[A-Z0-9]{6}$/.test(c);

/** The two lists every profile keeps besides its friends, made on demand. */
function pending(p) {
  p.wants ??= [];       // codes this player has asked to be friends with
  p.asked ??= [];       // codes that have asked this player
  return p;
}

export function addFriend(token, rawCode) {
  const me = profileFor(token);
  if (!me) return { error: 'Unknown player' };
  const code = asCode(rawCode);
  if (!code) return { error: 'Enter a friend code' };
  if (code === me.code) return { error: "That's your own code" };

  const theirToken = byCode.get(code);
  if (!theirToken) return isHouseCode(code) ? askHousePlayer(me, code) : { error: 'No player with that code' };
  const them = pending(profiles.get(theirToken));
  pending(me);
  // Blocked in either direction. The answer is deliberately the same one a
  // wrong code gets: telling somebody "they have blocked you" is exactly the
  // information a person being harassed does not want handed to the harasser.
  if (blockedEitherWay(me, them)) return { error: 'No player with that code' };

  if (me.friends.includes(code)) return { error: 'You are already friends', already: true };
  if (me.friends.length >= MAX_FRIENDS) return { error: 'Your friends list is full' };
  if (them.friends.length >= MAX_FRIENDS) return { error: 'Their friends list is full' };

  // They asked first: this is an acceptance, not a second request.
  if (me.asked.includes(code)) return acceptFriend(token, code);
  if (me.wants.includes(code)) return { ok: true, sent: true, friend: publicView(them) };

  me.wants.push(code);
  them.asked.push(me.code);
  save();
  return { ok: true, sent: true, friend: publicView(them) };
}

/** Say yes to a request. Only then does either list change. */
export function acceptFriend(token, rawCode) {
  const me = pending(profiles.get(token) || {});
  if (!me.code) return { error: 'Unknown player' };
  const code = asCode(rawCode);
  if (!me.asked.includes(code)) return { error: 'No request from that player' };
  const them = pending(profiles.get(byCode.get(code)) || {});
  if (!them.code) return { error: 'That player is gone' };
  if (me.friends.length >= MAX_FRIENDS) return { error: 'Your friends list is full' };

  me.asked = me.asked.filter((c) => c !== code);
  them.wants = them.wants.filter((c) => c !== me.code);
  if (!me.friends.includes(code)) me.friends.push(code);
  if (!them.friends.includes(me.code)) them.friends.push(me.code);
  save();
  return { ok: true, accepted: true, friend: publicView(them) };
}

/** Say no, or take back a request you sent. Both are this. */
export function declineFriend(token, rawCode) {
  const me = pending(profiles.get(token) || {});
  if (!me.code) return { error: 'Unknown player' };
  const code = asCode(rawCode);
  const them = pending(profiles.get(byCode.get(code)) || {});
  me.asked = me.asked.filter((c) => c !== code);
  me.wants = me.wants.filter((c) => c !== code);
  // A request to a house player is only ever taken back, never answered.
  if (me.botWants?.length) me.botWants = me.botWants.filter((w) => w.code !== code);
  if (them.code) {
    them.wants = them.wants.filter((c) => c !== me.code);
    them.asked = them.asked.filter((c) => c !== me.code);
  }
  save();
  return { ok: true };
}

export function removeFriend(token, rawCode) {
  const me = profiles.get(token);
  if (!me) return { error: 'Unknown player' };
  const code = asCode(rawCode);
  me.friends = me.friends.filter((c) => c !== code);
  const them = profiles.get(byCode.get(code));
  if (them) them.friends = them.friends.filter((c) => c !== me.code);
  save();
  return { ok: true };
}

/** One person, dressed with wherever they are right now. */
function withPresence(them) {
  if (!them) return null;
  const at = presence.get(them.token);
  return { ...publicView(them), ...(at ? { roomId: at.roomId, status: at.status } : { status: 'offline' }) };
}

export function friendsOf(token) {
  const me = profiles.get(token);
  if (!me) return [];
  return me.friends.map((code) => withPresence(profiles.get(byCode.get(code)))).filter(Boolean);
}

/**
 * The whole friends picture for one player: who they are friends with, who
 * has asked them, and who they have asked. The list route still answers with
 * a plain array for older clients — this is the shape the app reads.
 */
export function socialOf(token) {
  const me = profiles.get(token);
  if (!me) return { friends: [], requests: [], sent: [] };
  pending(me);
  const card = (code) => {
    const them = profiles.get(byCode.get(code));
    return them ? publicView(them) : null;
  };
  return {
    friends: friendsOf(token),
    requests: me.asked.map(card).filter(Boolean),
    // Requests to house players sit here too, looking like any other that
    // has not been answered yet — which is exactly what they are.
    sent: [...me.wants.map(card).filter(Boolean), ...(me.botWants || []).map(houseCard)],
    // Codes rather than cards: a blocked player may since have deleted their
    // account, and the app still has to hide what they wrote.
    blocked: [...(me.blocked || [])],
  };
}

// ----------------------------------------------------------- house players --
//
// After a game anyone at the table can open anyone else's profile, and the
// house players sat at that table too. They have no profile — they never
// touch profileFor — so what they show is made up here: the name and flag
// they played under, and numbers drawn from their code, so the same card
// reads the same on every visit. A friend request to one is taken and kept,
// and simply never answered, the way a stranger might leave one hanging.
//
// Their code is the H0 stand-in the room signs their chat with. Real codes
// come from an alphabet with no zero, so the two can never be confused.

/** A house player's code: H0 and four hex digits, as GameRoom.chatCodeOf cuts it. */
const isHouseCode = (c) => /^H0[0-9A-F]{4}$/.test(c);

/**
 * Who each recent house code was, newest last. The room tells us every time
 * it serialises a house seat, so anyone still on a results screen keeps their
 * table's names warm; past the cap the longest-unseen goes first. Memory only:
 * a restart forgets them, and a request already sent keeps its own copy.
 */
const HOUSE_CARDS_MAX = 5000;
const houseCards = new Map();   // code -> { name, flag, avatar }
/** Pending requests to house players, per profile. Old ones make room for new. */
const HOUSE_WANTS_MAX = 100;

export function noteBotCard(rawCode, { name, flag, avatar } = {}) {
  const code = asCode(rawCode);
  if (!isHouseCode(code)) return;
  const card = {
    name: String(name || '').slice(0, 24) || 'Player',
    flag: String(flag || '').slice(0, 8),
    avatar: String(avatar || '').slice(0, 8),
  };
  // Delete then set is what moves a Map entry to the back of the line.
  houseCards.delete(code);
  houseCards.set(code, card);
  if (houseCards.size > HOUSE_CARDS_MAX) houseCards.delete(houseCards.keys().next().value);
}

/** The same four fields publicView gives a person; a house player wears nothing. */
const houseCard = (w) => ({ code: w.code, name: w.name || 'Player', flag: w.flag || '', avatar: '' });

/**
 * A friend request to a house player. It is written down on the asker's own
 * profile — there is no other profile to write it on — and answered exactly
 * as one to a person would be, so nothing here tells the asker who they were
 * sitting with. A code the server has never seen is as unknown as any other.
 */
function askHousePlayer(me, code) {
  if ((me.blocked || []).includes(code)) return { error: 'No player with that code' };
  me.botWants ??= [];
  const held = me.botWants.find((w) => w.code === code);
  if (held) return { ok: true, sent: true, friend: houseCard(held) };
  const seen = houseCards.get(code);
  if (!seen) return { error: 'No player with that code' };
  me.botWants.push({ code, name: seen.name, flag: seen.flag, at: Date.now() });
  if (me.botWants.length > HOUSE_WANTS_MAX) me.botWants.splice(0, me.botWants.length - HOUSE_WANTS_MAX);
  save();
  return { ok: true, sent: true, friend: houseCard({ code, ...seen }) };
}

/** When the made-up numbers say a house player started: some day this spring or summer. */
const HOUSE_EPOCH = Date.UTC(2026, 2, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A house player's lifetime numbers, from nothing but its code. Believable
 * rather than impressive — a few dozen wins out of rather more games, about
 * what a win pays on top — and fixed, so a second look never catches them
 * moving. Titles come from the real book, at most two.
 */
function houseStats(code) {
  const h = createHash('sha1').update(code).digest();
  const wins = 3 + (h.readUInt16BE(0) % 88);                // 3–90
  const games = wins + 6 + (h.readUInt16BE(2) % 135);       // and 6–140 more played
  const winnings = wins * 2 + (h[4] % 41);                  // two a win, and change
  const since = HOUSE_EPOCH + (h.readUInt16BE(5) % 181) * DAY_MS + (h[7] % 24) * 60 * 60 * 1000;
  const titles = [];
  for (let i = 0; i < h[8] % 3; i++) {
    const title = TITLE_NAMES[h[9 + i] % TITLE_NAMES.length];
    if (titles.some((t) => t.title === title)) continue;
    titles.push({ title, count: 1 + (h[11 + i] % Math.min(wins, 9)) });
  }
  titles.sort((a, b) => b.count - a.count);
  return { wins, games, winnings, titles, since };
}

// --------------------------------------------------------- public profiles --

/** The three titles a player has earned most, as the profile card lists them. */
const topTitles = (counts) => Object.entries(counts || {})
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 3)
  .map(([title, count]) => ({ title, count }));

/** Where the viewer stands with a code, for the one button the card offers. */
function relationTo(viewer, code) {
  if (!viewer) return 'none';
  if (viewer.code === code) return 'self';
  if ((viewer.friends || []).includes(code)) return 'friend';
  if ((viewer.wants || []).includes(code)) return 'sent';
  if ((viewer.asked || []).includes(code)) return 'asked';
  return 'none';
}

/**
 * One player's public card, by code: who they are, what they have won, and
 * where the viewer stands with them. The viewer's token is optional and only
 * ever read — neither side is minted by looking.
 *
 * Strictly the fields any table already shows or the leaderboard already
 * prints, plus the counts that go with them. Never an email, a photo, a
 * login, a wallet, karma or a token. A block in either direction answers
 * exactly as a wrong code does, for the reason addFriend gives.
 *
 * A house player answers in the same shape with nothing in it to say so.
 * After a restart its name is gone from memory; a viewer who asked it to be
 * friends kept a copy, and anyone else is told there is nobody by that code.
 */
export function playerView(rawCode, viewerToken) {
  const code = asCode(rawCode);
  const viewer = viewerToken ? profiles.get(viewerToken) || null : null;
  const nobody = { error: 'No player with that code' };
  if (!isCode(code)) return nobody;

  const theirToken = byCode.get(code);
  if (theirToken) {
    const p = profiles.get(theirToken);
    if (!p || blockedEitherWay(viewer, p)) return nobody;
    const wins = p.wins || 0;
    return {
      code: p.code,
      name: p.name || 'Player',
      flag: p.flag || '',
      avatar: emojiFor(p.equipped?.avatar),
      wins,
      // Wins from before games were counted would otherwise outnumber them.
      games: Math.max(p.games || 0, wins),
      winnings: p.winnings || 0,
      titles: topTitles(p.titleCounts),
      since: p.firstPlayed || p.created || p.seen || 0,
      relation: relationTo(viewer, p.code),
      level: levelFor(p.xp || 0),
      career: careerView(p),
    };
  }

  if (!isHouseCode(code) || (viewer?.blocked || []).includes(code)) return nobody;
  const asked = viewer?.botWants?.find((w) => w.code === code) || null;
  const card = houseCards.get(code) || asked;
  if (!card) return nobody;
  const stats = houseStats(code);
  return {
    code,
    name: card.name || 'Player',
    flag: card.flag || '',
    avatar: card.avatar || '',
    ...stats,
    relation: asked ? 'sent' : 'none',
    // The same chip it wore at the table (GameRoom.seatLevel), and a career
    // scaled to the games its card already claims.
    level: houseLevel(code),
    career: houseCareer(code, stats.games),
  };
}

// ------------------------------------------------------------- progression --
//
// Levels, the career card, daily missions, the player's own switches and the
// daily reminder. The sums are progression.js's; what lives here is the book:
// who has how much, what has already been paid, and the rule that nothing is
// paid twice.
//
// Two kinds of payout come out of this section, both outside the daily
// ceiling on table coins (TABLE_COINS_PER_DAY) because both have bounds of
// their own — a level is reached once and the XP games pay towards levels
// has a daily ceiling (GAME_XP_PER_DAY), and a day has three missions and
// one bonus. Both go through credit() and the ledger like every other coin.

/** A pass & play guest: a chair on somebody else's phone, not a person. */
const isGuestToken = (t) => /_p\d+$/.test(String(t || ''));

/**
 * Add XP and pay for every level it crosses: LEVEL_UP_COINS each, written to
 * the ledger as provider 'level', once per level for the life of the profile.
 * `levelPaid` is the watermark that makes it once — it only ever rises, and
 * it is saved in the same write as the coins it paid for, so neither a retry
 * nor a restart can pay a level again.
 */
function addXp(p, amount, now = Date.now()) {
  const gained = Math.max(0, Math.floor(Number(amount) || 0));
  const from = levelFor(p.xp || 0);
  p.xp = (p.xp || 0) + gained;
  const to = levelFor(p.xp);
  p.levelPaid = Math.max(1, Math.floor(Number(p.levelPaid) || from));
  let coins = 0;
  while (p.levelPaid < to) {
    p.levelPaid++;
    credit(p, LEVEL_UP_COINS);
    coins += LEVEL_UP_COINS;
    appendLedger({
      at: now,
      provider: 'level',
      packId: null,
      usd: 0,
      coins: LEVEL_UP_COINS,
      token: p.token,
      txn: `level:${p.code}:${p.levelPaid}`,
      note: `reached level ${p.levelPaid}`,
    });
  }
  const levelUp = to > from ? { from, to, coins } : null;
  // Kept for a client that was not listening when it happened — a phone that
  // was in a pocket when the game ended reads it off /api/me instead.
  if (levelUp) p.lastLevelUp = { ...levelUp, at: now };
  return { gained, levelUp };
}

/** The level a seat wears at the table: 0 for a guest, 1 at the least for anybody else. */
export function levelOfToken(token) {
  if (!token || isGuestToken(token)) return 0;
  return levelFor(profiles.get(token)?.xp || 0);
}

/** The public half of a career: the counters, and the board played most. */
function careerView(p) {
  const c = p?.career || {};
  const out = {};
  for (const key of CAREER_KEYS) out[key] = Math.max(0, Math.floor(Number(c[key]) || 0));
  out.favoriteBoard = favoriteBoard(c.boards);
  return out;
}

/** Today's mission book, rolled over the moment the calendar day turns. */
function missionBook(p, now = Date.now()) {
  const day = dayKey(now);
  if (p.missions?.day !== day) p.missions = { day, progress: {}, claimed: [], bonus: false };
  p.missions.progress ??= {};
  p.missions.claimed ??= [];
  return p.missions;
}

/**
 * One finished game, for one person at the table: XP up to the day's
 * ceiling (and any level it reaches), the career counters, and today's
 * missions. The caller has
 * already decided the game counts — only games that pass the anti-farm rule
 * come here (see recordTransitions in index.js).
 *
 * `game` names the game, and a profile remembers the last ten it was paid
 * for: the transition that calls this happens once per game, but "once" is a
 * promise worth keeping in the book as well as in the caller. A guest seat
 * and a token with no profile get nothing — the same rule as karma, so a
 * game still settling after its owner deleted themselves cannot mint them
 * back. Returns what happened, for the 'progress' event, or null.
 */
export function recordGameProgress(token, {
  game = '', won = false, runnerUp = false, turns = 0, stats = {}, mapId = '', now = Date.now(),
} = {}) {
  if (!token || isGuestToken(token)) return null;
  const p = profiles.get(token);
  if (!p) return null;
  const key = String(game || '').slice(0, 80);
  p.progressGames ??= [];
  if (key) {
    if (p.progressGames.includes(key)) return null;
    p.progressGames.push(key);
    if (p.progressGames.length > 10) p.progressGames.splice(0, p.progressGames.length - 10);
  }

  const xp = gameXp({ won, runnerUp, turns });
  // Held to the day's ceiling the way table coins are (see GAME_XP_PER_DAY):
  // the game that crosses it pays the part that fits, and the games after it
  // pay none. The day is the one the missions below are booked on. Only the
  // XP stops — the career and the missions still count the game, since
  // neither pays anything a day does not already bound.
  const day = dayKey(now);
  const sofar = p.xpDay?.day === day ? Math.max(0, Math.floor(Number(p.xpDay.xp) || 0)) : 0;
  const paid = Math.max(0, Math.min(xp.total, GAME_XP_PER_DAY - sofar));
  p.xpDay = { day, xp: sofar + paid };
  const { levelUp } = addXp(p, paid, now);
  p.career = foldCareer(p.career, stats, mapId);

  const book = missionBook(p, now);
  const completed = [];
  for (const kind of missionKinds(p.code, book.day)) {
    const target = missionOf(kind).target;
    const before = Math.floor(book.progress[kind] || 0);
    const add = missionProgress(kind, stats, won);
    if (!add || before >= target) continue;
    // Held at the target: past it is nothing more to show or to pay.
    book.progress[kind] = Math.min(target, before + add);
    if (book.progress[kind] >= target) completed.push(kind);
  }
  save();
  return {
    // What was added, and what the game was worth before the ceiling: the
    // parts always add up to the latter, so a client can show both.
    xpGained: paid, xpParts: xp.parts, xpCapped: paid < xp.total,
    ...levelInfo(p.xp), levelUp, missionsCompleted: completed,
  };
}

/**
 * Today's missions, as the card draws them. Read-only and no minting, the
 * walletOf rule: the home screen asks on every visit. A token with no profile
 * yet is shown the three its code will be dealt, at nought — the code is
 * derived from the token, so they are the same three it will play for.
 */
export function missionsView(token, now = Date.now()) {
  const p = token ? profiles.get(token) : null;
  const day = dayKey(now);
  const code = p?.code || (token ? codeFor(token) : '');
  const book = p?.missions?.day === day ? p.missions : { progress: {}, claimed: [], bonus: false };
  const missions = missionKinds(code, day).map((kind) => {
    const m = missionOf(kind);
    const progress = Math.min(m.target, Math.max(0, Math.floor(book.progress?.[kind] || 0)));
    return {
      id: kind, kind, title: m.title, target: m.target, progress,
      coins: MISSION_COINS, xp: MISSION_XP,
      done: progress >= m.target,
      claimed: (book.claimed || []).includes(kind),
    };
  });
  const allDone = missions.every((m) => m.done);
  return {
    day,
    resetsAt: nextMidnight(now),
    // Progress counts for everybody; only a signed-in account can claim, the
    // daily reward's rule and for the daily reward's reason (see dailyView).
    signedIn: !!p?.login,
    missions,
    bonus: { coins: MISSION_BONUS_COINS, ready: allDone && !book.bonus, claimed: !!book.bonus },
  };
}

/**
 * Claim one finished mission (`id` is its kind) or the bonus for all three.
 *
 * Idempotent: a mission already claimed answers ok with `duplicate: true` and
 * pays nothing, so a retried request or a second tab sees success rather
 * than an error, and the balance in the reply is the true one either way.
 * The claim and the payout happen in one synchronous step, so two requests
 * racing each other cannot both get past the check.
 */
export function claimMission(token, rawId, now = Date.now()) {
  const p = token ? profiles.get(token) : null;
  if (!p?.login) return { error: 'Sign in to claim mission rewards', needsLogin: true };
  const id = String(rawId || '').slice(0, 32);
  const book = missionBook(p, now);
  const view = () => missionsView(token, now);
  const reply = (awarded, levelUp = null, extra = {}) => ({
    ok: true, id, awarded, ...extra,
    coins: p.coins, earned: p.earned || 0,
    ...levelInfo(p.xp), levelUp,
    missions: view(),
  });

  if (id === 'bonus') {
    if (book.bonus) return reply({ coins: 0, xp: 0 }, null, { duplicate: true });
    if (!view().missions.every((m) => m.done)) return { error: 'Finish all three missions first' };
    book.bonus = true;
    credit(p, MISSION_BONUS_COINS);
    appendLedger({
      at: now, provider: 'mission', packId: 'bonus', usd: 0, coins: MISSION_BONUS_COINS, token,
      txn: `mission:${book.day}:${p.code}:bonus`, note: 'all three daily missions',
    });
    save();
    return reply({ coins: MISSION_BONUS_COINS, xp: 0 });
  }

  const kinds = missionKinds(p.code, book.day);
  // Usually a card left open across midnight: yesterday's mission is gone,
  // and the reply carries today's so the card can redraw at once.
  if (!kinds.includes(id)) return { error: 'That mission is not one of today\'s', missions: view() };
  if (book.claimed.includes(id)) return reply({ coins: 0, xp: 0 }, null, { duplicate: true });
  const m = missionOf(id);
  if ((book.progress[id] || 0) < m.target) return { error: 'That mission is not finished yet' };
  book.claimed.push(id);
  // A mission on its own pays XP only now (see MISSION_COINS). Nothing is
  // minted, so nothing goes in the coin ledger — the ledger is a record of
  // coins, and a row of zeros in it is a coin flow that never happened. The
  // claim itself is still remembered, in the day's book, exactly once.
  if (MISSION_COINS > 0) {
    credit(p, MISSION_COINS);
    appendLedger({
      at: now, provider: 'mission', packId: id, usd: 0, coins: MISSION_COINS, token,
      txn: `mission:${book.day}:${p.code}:${id}`, note: m.title,
    });
  }
  const { levelUp } = addXp(p, MISSION_XP, now);
  save();
  return reply({ coins: MISSION_COINS, xp: MISSION_XP }, levelUp);
}

// ------------------------------------------------------------ preferences --
// The player's own switches. Both start on, and an absent field reads as on,
// so every profile that predates them behaves exactly as it did.
const PREF_KEYS = ['dailyReminder', 'inviteAlerts'];

const prefsView = (p) => ({
  dailyReminder: p?.prefs?.dailyReminder !== false,
  inviteAlerts: p?.prefs?.inviteAlerts !== false,
});

/** Read-only, like every other GET: asking does not make a profile. */
export const prefsOf = (token) => prefsView(token ? profiles.get(token) : null);

/** JSON booleans, and the strings and digits a form or a hand-written client might send for them. */
function asSwitch(v) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return null;
}

/**
 * Change either switch, or both; a field left out keeps its value. Anything
 * that is not a yes or a no is refused outright rather than read as one — a
 * typo must not quietly switch somebody's notifications off.
 */
export function setPrefs(token, changes = {}) {
  if (!token) return { error: 'Missing identity' };
  const wanted = {};
  for (const key of PREF_KEYS) {
    if (changes?.[key] === undefined) continue;
    const v = asSwitch(changes[key]);
    if (v == null) return { error: `${key} must be true or false` };
    wanted[key] = v;
  }
  const p = profileFor(token);
  if (!p) return { error: 'Missing identity' };
  p.prefs = { ...prefsView(p), ...wanted };
  save();
  return { ok: true, ...p.prefs };
}

// --------------------------------------------------------- daily reminder --
// One buzz a day, about a day after the last claim, to somebody who would
// lose a streak by forgetting. The rules, in the order they are checked:
//
//   · signed in — only an account can claim, so only an account is reminded
//   · the reminder switch is on, a phone is registered, and not banned
//   · seen in the last week — a player who has stopped opening the app is not
//     chased by it every day for the rest of their life
//   · the coin is there to collect: not claimed today
//   · not reminded today, and not in the last twenty hours
//   · and it is that player's time of day: between twenty and twenty-four
//     hours on from their last claim (or, with no claim on file, their last
//     reminder or their last visit), counted in whole days from it. The
//     server does not know anybody's timezone; the hour they last claimed at
//     is the best guess there is of an hour they are awake.
//
// The scheduler in index.js runs this every ten minutes, which visits each
// four-hour window more than twenty times — plenty to catch everybody once.
export const DAILY_REMINDER_TEXT = 'Your daily coins are ready — keep your streak going';
const HOUR_MS = 60 * 60 * 1000;
export const REMINDER_RULES = { gapMs: 20 * HOUR_MS, windowFromMs: 20 * HOUR_MS, lapseMs: 7 * DAY_MS };

/**
 * When this profile last claimed, to the millisecond if it claimed since that
 * was written down. An older claim only has its day on file; the middle of
 * that day is the least wrong guess at when in it.
 */
function lastClaimAt(p) {
  if (Number.isFinite(p.daily?.at)) return p.daily.at;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(p.daily?.last || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime() : null;
}

/** Whether this profile should be reminded at `now`. See the rules above. */
export function reminderDue(p, now = Date.now()) {
  if (!p?.login || !p.push?.length) return false;
  if (p.prefs?.dailyReminder === false) return false;
  if (bans.has(p.token)) return false;
  if (!p.seen || now - p.seen > REMINDER_RULES.lapseMs) return false;
  const today = dayKey(now);
  if (p.daily?.last === today) return false;
  const last = p.reminded;
  if (last?.day === today) return false;
  if (last?.at && now - last.at < REMINDER_RULES.gapMs) return false;
  const anchor = lastClaimAt(p) ?? last?.at ?? p.seen;
  const since = now - anchor;
  if (since < REMINDER_RULES.windowFromMs) return false;
  return since % DAY_MS >= REMINDER_RULES.windowFromMs;
}

/**
 * Send every reminder that is due. `send` is the push sender
 * (sendTurnPush in production, a stand-in in the tests) — passed in rather
 * than imported because push.js already reads this module, and a sender a
 * test can swap is the whole of what a test needs. A profile is marked
 * reminded before its push goes, so one that throws is not retried every ten
 * minutes for the rest of the window. Returns how many were sent.
 */
export function runDailyReminders(send, now = Date.now()) {
  let sent = 0;
  for (const p of profiles.values()) {
    if (!reminderDue(p, now)) continue;
    p.reminded = { at: now, day: dayKey(now) };
    sent++;
    try {
      send(p.token, DAILY_REMINDER_TEXT, { collapseId: 'daily', kind: 'daily' });
    } catch (err) {
      console.warn('reminder: send failed —', err?.message);
    }
  }
  if (sent) save();
  return sent;
}

// ----------------------------------------------------------------- notices --
//
// A note from the owner to a player, or to everybody.
//
// This is not chat and not a DM: it goes one way, it is written by whoever
// runs the game, and it exists for the two things a tournament needs a voice
// for — telling the field when the next round is, and telling a winner their
// prize is on its way. Nobody can reply to one, so nobody can be dragged into
// a conversation they did not ask for.

/** @type {{id:string, text:string, title:string, to:string, at:number}[]} */
const notices = [];        // newest first
const MAX_NOTICES = 200;

/**
 * Write one. `toCode` empty means everybody; a friend code means that player
 * alone. Returns the notice, and the token to push to when it has an address.
 */
export function sendNotice({ text, title, toCode } = {}) {
  const body = String(text || '').trim().slice(0, 400);
  if (!body) return { error: 'Write something first' };
  const to = asCode(toCode);
  let theirToken = '';
  if (to) {
    theirToken = byCode.get(to) || '';
    if (!theirToken) return { error: 'No player with that code' };
  }
  const notice = {
    id: Math.random().toString(36).slice(2, 10),
    text: body,
    title: String(title || '').trim().slice(0, 60),
    to,                                   // '' = everyone
    at: Date.now(),
  };
  notices.unshift(notice);
  notices.length = Math.min(notices.length, MAX_NOTICES);
  save();
  return { ok: true, notice, token: theirToken };
}

/** Everything this player is meant to see, newest first, and how many are new. */
export function noticesFor(token) {
  const me = profiles.get(token);
  if (!me) return { notices: [], unread: 0 };
  const mine = notices.filter((n) => !n.to || n.to === me.code);
  const seen = Number(me.noticesSeen) || 0;
  return {
    notices: mine.slice(0, 50).map((n) => ({
      id: n.id, text: n.text, title: n.title, at: n.at,
      // Whether it was written to this player or to the whole field. Worth
      // saying: "you won" reads differently from "everybody won".
      personal: !!n.to,
      unread: n.at > seen,
    })),
    unread: mine.filter((n) => n.at > seen).length,
  };
}

/** Opening the list is reading it. */
export function markNoticesRead(token) {
  const me = profiles.get(token);
  if (!me) return { ok: true };
  me.noticesSeen = Date.now();
  save();
  return { ok: true };
}

/** The owner's own view: everything sent, whoever it went to. */
export function allNotices() {
  return notices.slice(0, 50).map((n) => ({ ...n, to: n.to || '' }));
}

/** Delete one that was sent by mistake. */
export function dropNotice(id) {
  const i = notices.findIndex((n) => n.id === String(id || ''));
  if (i < 0) return { error: 'No such note' };
  notices.splice(i, 1);
  save();
  return { ok: true };
}

// ----------------------------------------------------------------- invites --
//
// "Join their table" only ever worked one way round: you could walk into a
// friend's lobby, but you could not ask a friend to come to yours. An invite
// is that other direction — a note that expires, so nobody is chasing a table
// that filled up ten minutes ago.

/** @type {Map<string, {from:string, name:string, flag:string, roomId:string, at:number}>} */
const invites = new Map();     // recipient token -> the newest invite for them
const INVITE_LIFE_MS = 5 * 60 * 1000;
/**
 * An invite is a buzz in somebody's pocket, and a button is easy to press
 * twice. One pair gets one push per this long; the ones in between still
 * update the invite, they just do not ring again.
 */
const INVITE_GAP_MS = 20 * 1000;
const invitePushed = new Map();  // 'FROM>TO' -> when that pair last rang

/**
 * Ask a friend to come and play. Friends only, because an invite is a
 * notification and a stranger with your code should not be able to send you
 * one. The newest replaces any older one: two invites from the same evening
 * are not two things to answer.
 *
 * `throttled` says this pair already rang inside the last twenty seconds.
 * The invite is still the newest — if the inviter has moved tables since,
 * the banner should say so — but the caller must not push it again.
 */
export function inviteFriend(token, rawCode, roomId) {
  const me = profiles.get(token);
  if (!me) return { error: 'Unknown player' };
  const code = asCode(rawCode);
  if (!me.friends.includes(code)) return { error: 'You can only invite friends' };
  const them = profiles.get(byCode.get(code));
  if (!them) return { error: 'That player is gone' };
  const room = String(roomId || '').toLowerCase().slice(0, 12);
  if (!room) return { error: 'No table to invite them to' };

  const now = Date.now();
  invites.set(them.token, {
    from: me.code, name: me.name || 'A friend', flag: me.flag || '', roomId: room, at: now,
  });
  const pair = `${me.code}>${code}`;
  if (now - (invitePushed.get(pair) || 0) < INVITE_GAP_MS) {
    return { ok: true, throttled: true, to: publicView(them), token: them.token };
  }
  invitePushed.set(pair, now);
  // Only the last twenty seconds matter, so anything older is dead weight.
  if (invitePushed.size > 1000) {
    for (const [k, at] of invitePushed) if (now - at >= INVITE_GAP_MS) invitePushed.delete(k);
  }
  return { ok: true, to: publicView(them), token: them.token };
}

/** The invite waiting for this player, if it has not gone stale. */
export function inviteFor(token) {
  const inv = invites.get(token);
  if (!inv) return null;
  if (Date.now() - inv.at > INVITE_LIFE_MS) { invites.delete(token); return null; }
  return { from: inv.from, name: inv.name, flag: inv.flag || '', roomId: inv.roomId, at: inv.at };
}

/** Answered, ignored, or acted on — either way it is done with. */
export function clearInvite(token) {
  invites.delete(token);
  return { ok: true };
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

/**
 * Records an external login (google/apple) against the identity token.
 *
 * The name Google hands over is the player's real one, and that is the last
 * thing most people want floating over a token on a board other people can
 * see. So it is not taken. Somebody who already picked a nickname keeps it —
 * signing in is not a reason to be renamed — and somebody arriving with none
 * is given a name off the same list the dice button uses. The real name is
 * not stored anywhere: the profile card shows the photo and the address,
 * which only its owner ever sees.
 *
 * An Apple login can bring the refresh token Apple issued for it, which is
 * what revoking the login later takes — see the Sign in with Apple block
 * below. This only ever writes one; the route decides beforehand what
 * happens to any token the profile was already holding, because whether that
 * one gets revoked depends on who else is signed in with it, and that is not
 * a question for the function that stores things.
 *
 * An Apple login also says whether it was `verified` — made from an identity
 * token whose signature checked out — or merely claimed, by a pre-build-11
 * app that sent a bare user id. Both unlock the same things while unverified
 * sign-in is allowed at all, but only a verified one is believed about which
 * Apple ID it is (see appleSubjectLinkedElsewhere), and the unverified ones
 * are signed out once that door is closed (dropUnverifiedAppleLogins).
 * Google logins are always checked against Google and carry no flag.
 */
export function attachLogin(token, provider, subject, preferred, { email, picture, appleRefresh, verified } = {}) {
  const p = profileFor(token);
  if (!p) return null;
  const stored = profiles.get(token);
  stored.login = {
    provider, subject, at: Date.now(),
    ...(provider === 'apple' ? { verified: verified === true } : {}),
  };
  if (provider === 'apple' && appleRefresh?.token) {
    stored.appleRefresh = {
      token: String(appleRefresh.token),
      subject: String(appleRefresh.subject || subject || ''),
      at: appleRefresh.at || Date.now(),
    };
  }
  // `preferred` is what the PLAYER is already calling themselves on this
  // device — never what Google or Apple call them. Somebody who typed a
  // nickname and then signed in keeps it; anyone else gets a game name.
  if (!stored.name) {
    const nick = cleanText(String(preferred || '').trim().slice(0, 16));
    stored.name = nick && !isAllMasked(nick) ? nick : randomName();
  }
  // The photo and address are display-only — they make the signed-in state
  // visible, they are never used to look anything up.
  if (email) stored.email = String(email).slice(0, 120);
  if (picture) stored.picture = String(picture).slice(0, 400);
  saveSoon();
  return { code: stored.code, name: stored.name, picture: stored.picture || '' };
}

/**
 * Unlink the provider — the anonymous device identity stays untouched.
 *
 * An Apple refresh token is deliberately NOT dropped here. A caller that
 * wants it gone takes it first (takeAppleRefresh) and decides whether Apple
 * should hear about it; a token left behind by one that did not is still on
 * the profile when the account is deleted, and is revoked then. Losing one
 * silently is the only outcome ruled out.
 */
export function detachLogin(token) {
  const stored = profiles.get(token);
  if (!stored) return { ok: true };
  unlink(stored);
  saveSoon();
  return { ok: true };
}

function unlink(stored) {
  delete stored.login;
  delete stored.email;
  delete stored.picture;
}

// ------------------------------------------------------ sign in with apple --
// The refresh token Apple issues when a sign-in's authorization code is
// exchanged. It exists for one purpose — handing it back to Apple, which
// ends MoneyMove's access to that Apple ID — so it lives in its own field,
// `appleRefresh`, beside the login rather than inside it: `login` is copied
// wholesale into the admin dashboard's player rows, and this must never be.
// No view in this file reads it except to say whether one is on file.
//
// Everything here is bookkeeping. Talking to Apple is appleid.js's job, and
// deciding when to is the routes'.

/** The provider and subject this profile is signed in with, if any. */
export function loginOf(token) {
  const login = token ? profiles.get(token)?.login : null;
  return login ? { provider: login.provider, subject: login.subject || '', verified: login.verified === true } : null;
}

/** Whether this profile's Apple login came from an identity token that verified. */
export function appleLoginVerified(token) {
  const login = token ? profiles.get(token)?.login : null;
  return login?.provider === 'apple' && login.verified === true;
}

/**
 * Remove this profile's Apple refresh token and hand it to the caller, who is
 * now the only holder and is expected to revoke it or knowingly let it go.
 */
export function takeAppleRefresh(token) {
  const stored = token ? profiles.get(token) : null;
  const held = stored?.appleRefresh;
  if (!held) return null;
  delete stored.appleRefresh;
  save();
  return { token: held.token, subject: held.subject || '', at: held.at || 0 };
}

/**
 * Is some other profile still signed in with this Apple ID?
 *
 * Logins are keyed on the device, not the Apple ID, so one person with a
 * phone and an iPad is two profiles carrying the same subject. Revoking any
 * token of theirs ends the app's authorization for the Apple ID as a whole —
 * the other device included — so signing out of one must not do it while the
 * other is still using it.
 *
 * Only verified logins count. An unverified one is somebody's say-so about
 * whose Apple ID it is, and anyone who learned a player's Apple user id could
 * otherwise link a throwaway profile to it and make sure that player's
 * sign-out never revoked anything.
 */
export function appleSubjectLinkedElsewhere(subject, exceptToken) {
  if (!subject) return false;
  for (const p of profiles.values()) {
    if (p.token === exceptToken) continue;
    if (isVerifiedAppleLogin(p, subject)) return true;
  }
  return false;
}

const isVerifiedAppleLogin = (p, subject) =>
  p.login?.provider === 'apple' && p.login.verified === true && p.login.subject === subject;

/**
 * Hand a token that is coming off one profile to another profile signed in
 * with the same Apple ID that holds none, so the last device to sign out (or
 * be deleted) still has something to revoke.
 *
 * Without this, a phone signed in before tokens were kept — or whose code
 * exchange failed — and a tablet holding the only token would lose it the
 * moment the tablet signed out: not revoked, because the phone still relies
 * on the authorization, and not kept, because nothing held it. The phone's
 * own sign-out or deletion would then have nothing to hand back to Apple, and
 * MoneyMove's access to that Apple ID would outlive everything.
 *
 * The heir is the most recent such sign-in, and only a verified one: a bare
 * user id typed into an old app must not be able to collect a real player's
 * token, and with it the power to end their authorization by signing out.
 * Returns true if somebody took it; false when every other device already
 * holds a token for the same authorization, and letting this one go loses
 * nothing.
 */
export function passAppleRefreshOn(held, exceptToken) {
  if (!held?.token || !held.subject) return false;
  let heir = null;
  for (const p of profiles.values()) {
    if (p.token === exceptToken || p.appleRefresh?.token) continue;
    if (!isVerifiedAppleLogin(p, held.subject)) continue;
    if (!heir || (p.login.at || 0) > (heir.login.at || 0)) heir = p;
  }
  if (!heir) return false;
  heir.appleRefresh = { token: String(held.token), subject: held.subject, at: held.at || Date.now() };
  save();
  return true;
}

/**
 * Sign out every Apple login that was never verified. Called at boot once
 * unverified sign-in has been switched off: the logins it let in while it was
 * on — pre-build-11 phones, and anybody who typed a user id — would otherwise
 * stay signed in for good, daily coin and cup seat included. Those players
 * sign in again with a build that sends a real identity token.
 *
 * A refresh token on such a profile is left where it is, for the same reason
 * detachLogin leaves one: it is still revoked when the account is deleted.
 * Returns how many profiles were signed out.
 */
export function dropUnverifiedAppleLogins() {
  let dropped = 0;
  for (const p of profiles.values()) {
    if (p.login?.provider !== 'apple' || p.login.verified === true) continue;
    unlink(p);
    dropped++;
  }
  if (dropped) save();
  return dropped;
}

/**
 * Apple says this Apple ID has stopped using the app — the player removed it
 * under Settings, or deleted the Apple ID. Every profile signed in with it is
 * signed out, and its refresh token is dropped without being revoked: Apple
 * already did that, which is what the notification is telling us.
 *
 * `before` is when Apple says it happened. A login made after that is a
 * player who came back and signed in again, and a late (or redelivered)
 * notice about the old authorization is no reason to throw out the new one.
 *
 * Returns how many profiles changed.
 */
export function forgetAppleSubject(subject, { before = null } = {}) {
  if (!subject) return 0;
  let changed = 0;
  for (const p of profiles.values()) {
    const linked = p.login?.provider === 'apple' && p.login.subject === subject;
    const holds = p.appleRefresh?.subject === subject;
    if (!linked && !holds) continue;
    if (before != null && linked && (p.login.at || 0) > before) continue;
    if (holds) delete p.appleRefresh;
    if (linked) unlink(p);
    changed++;
  }
  if (changed) save();
  return changed;
}

/** Who this device is, for the profile chip: sign-in state included. */
export function meView(token) {
  // Same read-only rule as walletOf — the profile chip asks on every visit.
  if (!token) return null;
  if (!profiles.get(token)) {
    return {
      code: '', name: '', flag: '', coins: 0, karma: KARMA_MAX, provider: null, email: '', picture: '',
      appleRevocable: false,
      ...levelInfo(0), career: careerView(null), prefs: prefsView(null), lastLevelUp: null,
    };
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
    // One bit about the Apple token, never the token: whether deleting this
    // account can revoke Apple access on its own, or the app has to ask the
    // player to sign in with Apple once more so there is something to revoke.
    appleRevocable: stored.login?.provider === 'apple' && !!stored.appleRefresh?.token,
    // The level chip and its bar: xp, level, levelFloor, levelNext.
    ...levelInfo(stored.xp || 0),
    // The same career anybody else sees on this player's card.
    career: careerView(stored),
    prefs: prefsView(stored),
    // The newest level-up, for a client that missed the 'progress' event.
    lastLevelUp: stored.lastLevelUp || null,
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
