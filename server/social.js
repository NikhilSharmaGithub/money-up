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
const STORE = path.join(__dirname, '..', 'data', 'social.json');

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
    p = { token, code, name: '', flag: '', friends: [], seen: Date.now() };
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
  const p = profileFor(token);
  if (!p) return null;
  return { coins: p.coins, owned: p.owned, equipped: p.equipped, karma: p.karma };
}

/**
 * Credit a verified store purchase. `transactionId` comes from the platform
 * receipt the caller already verified — replaying one is a no-op, so a
 * retried network call can never mint a second batch of coins.
 */
export function creditPurchase(token, transactionId, coins) {
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
/** Everything the admin dashboard needs — read-only snapshot. */
export function allProfiles() {
  return [...profiles.values()].map((p) => ({
    code: p.code, name: p.name || '', flag: p.flag || '',
    friends: (p.friends || []).length,
    roomId: p.roomId || null, status: p.status || 'offline',
    login: p.login || null,
  }));
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
  const p = profileFor(token);
  if (!p) return null;
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

load();
