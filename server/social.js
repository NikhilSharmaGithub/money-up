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
      fs.writeFileSync(STORE, JSON.stringify({ profiles: [...profiles.values()] }));
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
  p.seen = Date.now();
  save();
  return p;
}

const publicView = (p) => ({ code: p.code, name: p.name || 'Player', flag: p.flag || '' });

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
export function setPresence(token, roomId, status = 'lobby') {
  if (!token) return;
  if (roomId) presence.set(token, { roomId, status, at: Date.now() });
  else presence.delete(token);
}

export const clearPresence = (token) => presence.delete(token);

load();
