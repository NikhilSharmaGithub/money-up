import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { GameRoom, COLORS } from './game.js';
import { mapList } from './maps.js';
import {
  profileFor, addFriend, removeFriend, friendsOf, setPresence, clearPresence,
  allProfiles, attachLogin, detachLogin, meView, walletOf, awardCoins, buyItem, equipItem, sendDM, dmsWith,
  bumpKarma, creditPurchase, ledgerView, adminCredit,
} from './social.js';
import { STORE_ITEMS, COIN_PACKS, itemById, packByProductId, emojiFor } from './store.js';
import { randomName } from './names.js';
import { verifySignedTransaction } from './appstore.js';
import { stripeEnabled, createCheckout, handleWebhook } from './stripe.js';
import { adminPageHTML } from './adminPage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// The front end may be hosted elsewhere (e.g. Vercel) while this process runs
// the game, so the read-only API has to be reachable cross-origin.
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
  // A JSON POST from another origin is preflighted; answer it here or the
  // browser never sends the real request.
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Stripe signs the exact bytes it sent; this route must read them before the
// JSON parser gets a chance to rewrite the body.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const result = handleWebhook(req.body, req.headers['stripe-signature']);
  if (result.error) return res.status(400).json(result);
  res.json({ received: true });
});

app.use(express.json({ limit: '8kb' }));
app.use(express.static(PUBLIC_DIR));
app.get('/api/maps', (_req, res) => res.json(mapList()));
/**
 * Every public table, not just the ones still filling up. A game already in
 * progress can't be joined, but seeing it is the difference between "nobody
 * plays this" and "there's a game on right now".
 */
app.get('/api/rooms', (_req, res) => {
  res.json(
    [...rooms.values()]
      .filter((r) => !r.settings.isPrivate && r.status !== 'ended')
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'lobby' ? -1 : 1))
      .map((r) => ({
        id: r.id,
        players: r.players.length,
        maxPlayers: r.settings.maxPlayers,
        map: r.map.name,
        status: r.status,
        joinable: r.status === 'lobby' && r.players.length < r.settings.maxPlayers,
        quick: !!r.quick,
      })),
  );
});
// ---- friends -------------------------------------------------------------
// The identity token is the caller's own secret, so it only ever grants access
// to their own profile; friends are exchanged as short codes instead.
app.post('/api/profile', (req, res) => {
  const { token, name, flag } = req.body || {};
  const profile = profileFor(String(token || '').slice(0, 64), { name, flag });
  if (!profile) return res.status(400).json({ error: 'Missing identity' });
  res.json({ code: profile.code, name: profile.name, flag: profile.flag });
});

app.get('/api/friends', (req, res) => {
  res.json(friendsOf(String(req.query.token || '').slice(0, 64)));
});

app.post('/api/friends', (req, res) => {
  const { token, code } = req.body || {};
  const result = addFriend(String(token || '').slice(0, 64), code);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/friends/remove', (req, res) => {
  const { token, code } = req.body || {};
  res.json(removeFriend(String(token || '').slice(0, 64), code));
});

// ---- friend chat (DMs, polled) -------------------------------------------
app.post('/api/dm', (req, res) => {
  const { token, code, text } = req.body || {};
  const result = sendDM(String(token || '').slice(0, 64), code, text);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.get('/api/dm', (req, res) => {
  const result = dmsWith(String(req.query.token || '').slice(0, 64), req.query.code);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ---- store & wallet ------------------------------------------------------
app.get('/api/store', (_req, res) => res.json({
  items: STORE_ITEMS,
  packs: COIN_PACKS,
  // The web client only offers card checkout when this server can honour it.
  stripe: stripeEnabled(),
}));

/** Start a card payment for one pack; the webhook does the crediting. */
app.post('/api/store/checkout', async (req, res) => {
  const { token, packId } = req.body || {};
  const result = await createCheckout({
    token: String(token || '').slice(0, 64),
    packId: String(packId || ''),
    origin: String(req.headers.origin || ''),
  });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** A nickname for anyone who'd rather not think of one. */
app.get('/api/name', (_req, res) => res.json({ name: randomName() }));

app.get('/api/wallet', (req, res) => {
  const w = walletOf(String(req.query.token || '').slice(0, 64));
  if (!w) return res.status(400).json({ error: 'Missing identity' });
  res.json(w);
});

app.post('/api/store/buy', (req, res) => {
  const { token, itemId } = req.body || {};
  const item = itemById(String(itemId || ''));
  if (!item) return res.status(400).json({ error: 'Unknown item' });
  const result = buyItem(String(token || '').slice(0, 64), item);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/**
 * Credit a coin pack. The client sends the platform's signed transaction —
 * never a bare pack id — and coins appear only once that receipt proves it
 * came from Apple and hasn't already been redeemed.
 */
app.post('/api/store/redeem', async (req, res) => {
  const token = String(req.body?.token || '').slice(0, 64);
  const signed = String(req.body?.signedTransaction || '');
  if (!token) return res.status(400).json({ error: 'Missing identity' });

  const verdict = await verifySignedTransaction(signed, { bundleId: 'com.moneymove.game' });
  if (verdict.error) return res.status(400).json({ error: verdict.error });

  const pack = packByProductId(verdict.payload.productId);
  if (!pack) return res.status(400).json({ error: 'Unknown product' });

  const result = creditPurchase(token, verdict.payload.transactionId, pack.coins, {
    provider: 'apple', packId: pack.id, usd: Number(pack.price) || 0,
  });
  if (result.error) return res.status(400).json(result);
  res.json({ ...result, pack: pack.id });
});

app.post('/api/store/equip', (req, res) => {
  const token = String(req.body?.token || '').slice(0, 64);
  const { slot, itemId } = req.body || {};
  const result = equipItem(token, slot, itemId ? String(itemId) : null);
  if (result.error) return res.status(400).json(result);
  // Already sitting at a table? Restyle the piece live.
  const profile = profileFor(token);
  const room = profile?.roomId ? rooms.get(profile.roomId) : null;
  if (room?.player(token)) {
    room.setCosmetics(token, {
      tokenSkin: emojiFor(result.equipped.token),
      avatar: emojiFor(result.equipped.avatar),
    });
  }
  res.json(result);
});

// ---- auth (config-gated: works once the operator supplies credentials) ----
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
// The native app signs in through its own OAuth client (a web client refuses
// the custom-scheme redirect an app needs), so its ID is a second valid
// audience. Client IDs are public — only the audience CHECK protects anything.
const GOOGLE_IOS_CLIENT_ID = process.env.GOOGLE_IOS_CLIENT_ID
  || '968669711294-1j5h53fjj9mu3lgji4fre12q41o9rr9o.apps.googleusercontent.com';
const GOOGLE_AUDIENCES = new Set([GOOGLE_CLIENT_ID, GOOGLE_IOS_CLIENT_ID].filter(Boolean));

app.get('/api/auth/config', (_req, res) => {
  res.json({
    google: !!GOOGLE_CLIENT_ID,
    googleClientId: GOOGLE_CLIENT_ID || null,
    googleIosClientId: GOOGLE_CLIENT_ID ? GOOGLE_IOS_CLIENT_ID : null,
  });
});

app.post('/api/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(501).json({ error: 'Google login not configured on this server' });
  const { token, credential } = req.body || {};
  if (!token || !credential) return res.status(400).json({ error: 'Missing token or credential' });
  try {
    const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`)
      .then((r) => r.json());
    if (!GOOGLE_AUDIENCES.has(info.aud)) return res.status(401).json({ error: 'Token was not issued for this app' });
    const linked = attachLogin(String(token).slice(0, 64), 'google', info.sub, info.name || info.email,
      { email: info.email, picture: info.picture });
    res.json({ ok: true, name: linked?.name || info.name || '', code: linked?.code, picture: linked?.picture || '' });
  } catch {
    res.status(401).json({ error: 'Could not verify the Google token' });
  }
});

// The native flow on iOS: Apple has already authenticated the user on-device;
// we record the stable user id against this install's identity token.
/** Who am I — drives the profile chip. Includes the sign-in state. */
app.get('/api/me', (req, res) => {
  const me = meView(String(req.query.token || '').slice(0, 64));
  if (!me) return res.status(400).json({ error: 'Missing identity' });
  res.json(me);
});

app.post('/api/auth/logout', (req, res) => {
  res.json(detachLogin(String(req.body?.token || '').slice(0, 64)));
});

app.post('/api/auth/apple', (req, res) => {
  const { token, userId, name } = req.body || {};
  if (!token || !userId) return res.status(400).json({ error: 'Missing token or userId' });
  const linked = attachLogin(String(token).slice(0, 64), 'apple', String(userId).slice(0, 128), name);
  res.json({ ok: true, name: linked?.name || name || '', code: linked?.code });
});

// ---- master admin ---------------------------------------------------------
// GET /admin?key=... — a live dashboard of rooms, games and profiles.
// Set ADMIN_KEY in the environment; the default is for local tinkering only.
const ADMIN_KEY = process.env.ADMIN_KEY || 'moneymove-admin';
const STATS_FILE = path.join(__dirname, '..', 'data', 'stats.json');
const stats = { gamesStarted: 0, gamesEnded: 0, recent: [] };
try {
  Object.assign(stats, JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')));
} catch { /* first run */ }

function saveStats() {
  try {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats));
  } catch (err) {
    console.warn('stats: could not persist —', err.message);
  }
}

const lastStatus = new Map(); // roomId -> status, to spot transitions
function recordTransitions(room) {
  const prev = lastStatus.get(room.id);
  if (prev === room.status) return;
  lastStatus.set(room.id, room.status);
  if (room.status === 'playing' && prev !== 'playing') {
    stats.gamesStarted++;
    saveStats();
  }
  if (room.status === 'ended' && prev === 'playing') {
    stats.gamesEnded++;
    // Winning pays: 50 coins for a quick game, 100 once it went the distance.
    // Team games pay every human on the winning side.
    const turns = room.turnCount || 0;
    const payout = turns >= 40 ? 100 : 50;
    const winners = room.winningTeam != null
      ? room.players.filter((p) => p.team === room.winningTeam && !p.isBot && !p.bankrupt)
      : room.players.filter((p) => p.id === room.winner?.id && !p.isBot);
    for (const w of winners) awardCoins(w.id, payout);
    stats.recent.unshift({
      roomId: room.id,
      map: room.map.name,
      players: room.players.map((p) => p.name),
      winner: room.winner?.name || null,
      winningTeam: room.winningTeam ?? null,
      turns: room.turnCount || 0,
      at: Date.now(),
    });
    stats.recent = stats.recent.slice(0, 100);
    saveStats();
  }
}

const adminGuard = (req, res) => {
  if ((req.query.key || '') === ADMIN_KEY) return true;
  res.status(401).send('Missing or wrong ?key=');
  return false;
};

app.get('/api/admin/data', (req, res) => {
  if (!adminGuard(req, res)) return;
  const now = Date.now();
  const profs = allProfiles();
  const ledger = ledgerView();
  const paid = ledger.filter((e) => e.usd > 0);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const round2 = (n) => Math.round(n * 100) / 100;

  const coinsInCirculation = profs.reduce((n, p) => n + (p.coins || 0), 0);
  const avgKarma = profs.length
    ? round2(profs.reduce((n, p) => n + (p.karma ?? 100), 0) / profs.length)
    : null;

  // Ten karma buckets: 0-9, 10-19, ... with 100 folded into the top one.
  const karmaBuckets = Array.from({ length: 10 }, () => 0);
  for (const p of profs) karmaBuckets[Math.min(9, Math.floor((p.karma ?? 100) / 10))]++;

  // Net worth walks the ownership map; never let a half-built room 500 the
  // whole dashboard over it.
  const safeNetWorth = (room, p) => {
    try { return room.netWorth(p); } catch { return null; }
  };

  res.json({
    totals: {
      gamesStarted: stats.gamesStarted,
      gamesEnded: stats.gamesEnded,
      liveRooms: rooms.size,
      liveSockets: [...socketsOf.values()].reduce((n, s) => n + s.size, 0),
      profiles: profs.length,
      coinsInCirculation,
      avgKarma,
    },
    revenue: {
      // The ledger began with a deploy; purchases before its first entry
      // exist only as dedupe ids with no amounts, so they are not counted.
      since: ledger[0]?.at || null,
      total: round2(paid.reduce((n, e) => n + e.usd, 0)),
      last7d: round2(paid.filter((e) => e.at >= weekAgo).reduce((n, e) => n + e.usd, 0)),
      purchases: paid.length,
    },
    ledger: ledger.slice(-1000),
    economy: {
      coinsInCirculation,
      avgKarma,
      signedIn: profs.filter((p) => p.login).length,
      anonymous: profs.filter((p) => !p.login).length,
      karmaBuckets,
      topWallets: [...profs]
        .sort((a, b) => (b.coins || 0) - (a.coins || 0))
        .slice(0, 20)
        .map((p) => ({ code: p.code, name: p.name, coins: p.coins || 0, karma: p.karma })),
    },
    rooms: [...rooms.values()].map((r) => ({
      id: r.id, status: r.status, map: r.map.name,
      players: r.players.map((p) => ({
        name: p.name, isBot: !!p.isBot,
        bankrupt: !!p.bankrupt, connected: p.connected !== false,
        money: typeof p.money === 'number' ? p.money : null,
        netWorth: safeNetWorth(r, p),
      })),
      sockets: socketsOf.get(r.id)?.size || 0,
      turns: r.turnCount || 0,
      ageMs: now - (r.createdAt || now),
      quick: !!r.quick,
    })),
    recentGames: stats.recent,
    profiles: profs,
  });
});

app.get('/admin', (req, res) => {
  if (!adminGuard(req, res)) return;
  res.type('html').send(adminPageHTML);
});

// Admin actions arrive as POSTs carrying the key in the body, so a mutating
// URL never lands in an access log with the key attached.
const adminBodyGuard = (req, res) => {
  if ((req.body?.key || '') === ADMIN_KEY) return true;
  res.status(401).json({ error: 'Missing or wrong admin key' });
  return false;
};

/** Grant coins to a friend code — recorded in the ledger as provider 'admin'. */
app.post('/api/admin/credit', (req, res) => {
  if (!adminBodyGuard(req, res)) return;
  const result = adminCredit(req.body?.code, req.body?.coins, req.body?.reason);
  if (result.error) return res.status(400).json(result);
  console.log(`admin: credited ${result.coins} total to ${result.code} (+${Math.floor(Number(req.body?.coins))})`);
  res.json(result);
});

/** Tear a room down — the same disposal the idle reaper performs. */
app.post('/api/admin/close-room', (req, res) => {
  if (!adminBodyGuard(req, res)) return;
  const id = String(req.body?.roomId || '').toLowerCase().slice(0, 12);
  const room = rooms.get(id);
  if (!room) return res.status(404).json({ error: 'No such room' });
  io.to(id).emit('toast', { type: 'error', message: 'This table was closed by the admin' });
  // Pull the survivors out of the socket.io channel too: room ids get reissued
  // once a room is deleted, and a lingering socket must not overhear the next
  // tenant of the same id.
  io.in(id).socketsLeave(id);
  for (const pid of seatsOf.get(id)?.keys() || []) clearPresence(pid);
  room.status = 'ended';
  room.dispose();
  rooms.delete(id);
  socketsOf.delete(id);
  seatsOf.delete(id);
  lastStatus.delete(id);
  console.log(`admin: closed room ${id}`);
  res.json({ ok: true });
});

app.get(/^\/room\/.*/, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

/** @type {Map<string, GameRoom>} */
const rooms = new Map();
const socketsOf = new Map();  // roomId -> Set(socketId)
const seatsOf = new Map();    // roomId -> Map(playerId -> Set(socketId))

/** A player is only dropped once their last tab/device goes away. */
function claimSeat(roomId, playerId, socketId) {
  const seats = seatsOf.get(roomId) || seatsOf.set(roomId, new Map()).get(roomId);
  const set = seats.get(playerId) || seats.set(playerId, new Set()).get(playerId);
  set.add(socketId);
  return set.size;
}

function releaseSeat(roomId, playerId, socketId) {
  const seats = seatsOf.get(roomId);
  const set = seats?.get(playerId);
  if (!set) return 0;
  set.delete(socketId);
  if (!set.size) seats.delete(playerId);
  return set.size;
}

const ROOM_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';
function newRoomId() {
  let id;
  do {
    id = Array.from({ length: 5 }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join('');
  } while (rooms.has(id));
  return id;
}

function getRoom(id) {
  if (rooms.has(id)) return rooms.get(id);
  const room = new GameRoom(id, broadcast);
  // Walking out on a live table, or letting the clock run out, costs karma.
  room.hooks.karma = (token, delta) => bumpKarma(token, delta);
  rooms.set(id, room);
  socketsOf.set(id, new Set());
  return room;
}

/**
 * Find the quick-match table a player should drop into: the one that already
 * has people waiting (fullest first, so tables fill instead of fragmenting),
 * otherwise a fresh one on a 20-second fuse.
 */
function quickMatchRoom() {
  const waiting = [...rooms.values()]
    .filter((r) => r.quick && r.status === 'lobby' && r.players.length < r.settings.maxPlayers)
    .sort((a, b) => b.players.length - a.players.length);
  if (waiting.length) {
    // Someone new arriving is worth a moment's grace for others to land too.
    const room = waiting[0];
    if (room.players.length === room.settings.maxPlayers - 1) room.armQuickStart(6);
    return room;
  }
  const room = getRoom(newRoomId());
  room.makeQuickMatch(20);
  return room;
}

/** Team chat stays inside the team: strip other teams' messages per viewer. */
function stateFor(base, room, viewerId) {
  if (!base.chat.some((m) => m.channel === 'team')) return base;
  const team = viewerId != null ? room.player(viewerId)?.team : null;
  return { ...base, chat: base.chat.filter((m) => m.channel !== 'team' || (team != null && m.team === team)) };
}

function broadcast(room) {
  recordTransitions(room);
  const base = room.serialize();
  const delivered = new Set();
  for (const [playerId, socketIds] of seatsOf.get(room.id) || []) {
    const state = stateFor(base, room, playerId);
    for (const sid of socketIds) {
      io.to(sid).emit('state', state);
      delivered.add(sid);
    }
  }
  // Spectators (sockets without a seat) see everything but team chat.
  for (const sid of socketsOf.get(room.id) || []) {
    if (!delivered.has(sid)) io.to(sid).emit('state', stateFor(base, room, null));
  }
  // Keep each seated player's presence in step with what the room is doing,
  // so a friends list can say "in a lobby" vs "in a game".
  for (const playerId of seatsOf.get(room.id)?.keys() || []) {
    setPresence(playerId, room.id, room.status);
  }
}

// Reap idle rooms every 10 minutes.
setInterval(() => {
  for (const [id, room] of rooms) {
    const live = socketsOf.get(id)?.size || 0;
    const idleFor = Date.now() - (room.lastSeen || room.createdAt);
    // A table nobody is watching is just bots playing to an empty room, burning
    // a timer a second for nothing. Once it has been quiet for a few minutes —
    // long enough that a refresh or a phone locking can't be mistaken for it —
    // stop the game. The room itself lingers for the usual half hour.
    if (live === 0 && room.status === 'playing' && idleFor > 3 * 60 * 1000) {
      room.status = 'ended';
      room.dispose();
    }
    if (live === 0 && idleFor > 30 * 60 * 1000) {
      room.dispose();
      rooms.delete(id);
      socketsOf.delete(id);
      seatsOf.delete(id);
    }
  }
}, 10 * 60 * 1000);

io.on('connection', (socket) => {
  let room = null;
  let playerId = null;

  const fail = (message) => socket.emit('toast', { type: 'error', message });
  const ok = (res) => {
    if (res?.error) fail(res.error);
    return !res?.error;
  };

  // One bad message must never take the process down with it. Socket.IO
  // handlers run outside any request lifecycle, so an uncaught throw here is a
  // crashed server for everyone, not a failed action for one player.
  const safely = (label, fn) => (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      console.error(`socket ${label} failed:`, err);
      fail('Something went wrong with that action');
      return undefined;
    }
  };


  socket.on('createRoom', safely('createRoom', (payload = {}, cb) => {
    const id = newRoomId();
    getRoom(id);
    if (typeof cb === 'function') cb({ roomId: id });
    else socket.emit('roomCreated', { roomId: id });
  }));

  socket.on('quickplay', safely('quickplay', (payload = {}, cb) => {
    const room = quickMatchRoom();
    if (typeof cb === 'function') cb({ roomId: room.id });
    else socket.emit('roomCreated', { roomId: room.id });
  }));

  socket.on('join', safely('join', ({ roomId, token, name, flag } = {}) => {
    if (!roomId || !token) return fail('Missing room or identity');
    roomId = String(roomId).toLowerCase().slice(0, 12);
    room = getRoom(roomId);
    playerId = String(token).slice(0, 64);
    socket.join(roomId);
    socketsOf.get(roomId).add(socket.id);
    claimSeat(roomId, playerId, socket.id);
    setPresence(playerId, roomId, room.status);
    profileFor(playerId, { name, flag });
    room.lastSeen = Date.now();

    if (room.player(playerId)) {
      room.reconnect(playerId);
    } else {
      const res = room.addPlayer({ id: playerId, name, flag });
      if (res.error) {
        socket.emit('joinFailed', { message: res.error, spectate: true });
      }
    }
    // Dress the piece in whatever the player bought and equipped.
    const wallet = walletOf(playerId);
    if (wallet && room.player(playerId)) {
      room.setCosmetics(playerId, {
        tokenSkin: emojiFor(wallet.equipped.token),
        avatar: emojiFor(wallet.equipped.avatar),
      });
    }
    if (room.quick && room.status === 'lobby'
        && room.players.length >= room.settings.maxPlayers) {
      room.startQuickMatch();
    }
    socket.emit('you', { playerId, roomId });
    socket.emit('state', stateFor(room.serialize(), room, playerId));
  }));

  const guard = (fn) => safely('action', (...args) => {
    if (!room || !playerId) return fail('Join a room first');
    room.lastSeen = Date.now();
    return fn(...args);
  });

  socket.on('appearance', guard((d = {}) => room.updateAppearance(playerId, d)));
  socket.on('settings', guard((d = {}) => room.updateSettings(playerId, d)));
  socket.on('addBot', guard(() => {
    if (playerId !== room.hostId) return fail('Only the host can add bots');
    ok(room.addBot());
  }));
  socket.on('kick', guard((targetId) => {
    if (playerId !== room.hostId) return fail('Only the host can remove players');
    if (targetId === room.hostId) return;
    room.removePlayer(targetId);
  }));
  socket.on('team', guard((team, targetId) => {
    const target = targetId && targetId !== playerId ? targetId : playerId;
    if (target !== playerId) {
      // You can move yourself, and the host can shuffle the bots — nobody else.
      if (playerId !== room.hostId) return fail('Only the host can move other players');
      if (!room.player(target)?.isBot) return fail('You can only move bots');
    }
    ok(room.setTeam(target, team));
  }));
  socket.on('balanceTeams', guard(() => {
    if (playerId !== room.hostId) return fail('Only the host can shuffle the teams');
    room.balanceTeams();
  }));
  socket.on('start', guard(() => ok(room.start(playerId))));

  /** Like `guard`, but the move also resets this player's shot clock. */
  const onTurn = (fn) => guard((...args) => {
    const res = fn(...args);
    room.touchTurnClock(playerId);
    return res;
  });

  socket.on('roll', onTurn(() => ok(room.roll(playerId))));
  socket.on('buy', onTurn(() => ok(room.buy(playerId))));
  socket.on('skipBuy', onTurn(() => ok(room.skipBuy(playerId))));
  socket.on('bid', onTurn((amount) => ok(room.bid(playerId, amount))));
  socket.on('passBid', onTurn(() => ok(room.passBid(playerId))));
  socket.on('endTurn', onTurn(() => ok(room.endTurn(playerId))));
  socket.on('jailPay', onTurn(() => ok(room.jailPay(playerId))));
  socket.on('jailCard', onTurn(() => ok(room.jailCard(playerId))));

  socket.on('build', onTurn((tile) => ok(room.build(playerId, Number(tile)))));
  socket.on('sellHouse', onTurn((tile) => {
    if (!room.sellHouse(playerId, Number(tile))) fail('Cannot sell that building');
  }));
  socket.on('mortgage', onTurn((tile) => {
    if (!room.mortgage(playerId, Number(tile))) fail('Cannot mortgage that property');
  }));
  socket.on('unmortgage', onTurn((tile) => ok(room.unmortgage(playerId, Number(tile)))));

  socket.on('trade:propose', guard((d = {}) => ok(room.proposeTrade(playerId, d))));
  socket.on('trade:respond', guard(({ id, accept } = {}) => ok(room.respondTrade(playerId, id, !!accept))));
  socket.on('trade:cancel', guard(({ id } = {}) => ok(room.cancelTrade(playerId, id))));
  socket.on('trade:ignore', guard(({ id, ignored } = {}) => ok(room.ignoreTrade(playerId, id, ignored !== false))));
  socket.on('trade:viewing', guard(({ id, viewing } = {}) => ok(room.setTradeViewing(playerId, id, !!viewing))));

  socket.on('payDebt', onTurn(() => ok(room.payDebt(playerId))));
  socket.on('bankrupt', guard(() => ok(room.declareBankrupt(playerId))));
  socket.on('quit', guard(() => ok(room.quit(playerId))));
  socket.on('grantTime', guard(({ id } = {}) => ok(room.grantTime(playerId, String(id || '')))));
  socket.on('chat', guard((text, channel) => room.sendChat(playerId, text, channel)));

  socket.on('rematch', guard(() => {
    if (playerId !== room.hostId) return fail('Only the host can restart');
    room.status = 'lobby';
    room.winner = null;
    room.winningTeam = null;
    room.ownership = {};
    room.turn = null;
    room.auction = null;
    room.trades = [];
    room.vacationPot = 0;
    room.log = [];
    room.players.forEach((p) => {
      p.money = room.settings.startingCash;
      p.pos = 0; p.jail = false; p.jailTurns = 0; p.getOutCards = 0;
      p.bankrupt = false; p.skipTurns = 0;
    });
    room.say('Back to the lobby — set up the next game', 'system');
    room.push();
  }));

  socket.on('disconnect', () => {
    if (!room) return;
    socketsOf.get(room.id)?.delete(socket.id);
    // Other tabs of the same player keep the seat alive.
    if (releaseSeat(room.id, playerId, socket.id) > 0) return;
    clearPresence(playerId);
    room.removePlayer(playerId);
    if ((socketsOf.get(room.id)?.size || 0) === 0 && room.players.length === 0) {
      room.dispose();
      rooms.delete(room.id);
      socketsOf.delete(room.id);
      seatsOf.delete(room.id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  🎲  MoneyMove running at http://localhost:${PORT}\n`);
});

export { app, server, io, rooms, COLORS };
