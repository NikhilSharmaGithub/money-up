import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { GameRoom, COLORS } from './game.js';
import { diff, snapshot, feedTail, RESYNC } from './delta.js';
import { mapList } from './maps.js';
import {
  profileFor, addFriend, removeFriend, friendsOf, setPresence, clearPresence,
  allProfiles, attachLogin, detachLogin, meView, walletOf, awardWin, buyItem, equipItem, sendDM, dmsWith,
  bumpKarma, creditPurchase, ledgerView, adminCredit, setKarma,
  banByCode, unbanByCode, isBanned, bansView, tokenForCode, codeForToken,
  ownedTally, dataFiles,
  dailyView, claimDaily, leaderboardView, achievementsView, recordTitle, noteTurns,
  registerPushDevice, realCounts, roomOf,
} from './social.js';
import { noteGameDay, daySeries, bucketByDay, lastDayKeys } from './dayStats.js';
import {
  startBackups, backupInfo, streamDataBackup,
  initWebhookHealth, noteWebhook, webhookHealth,
} from './ops.js';
import { STORE_ITEMS, COIN_PACKS, itemById, packByProductId, emojiFor } from './store.js';
import { randomName } from './names.js';
import { verifySignedTransaction } from './appstore.js';
import { stripeEnabled, createCheckout, handleWebhook } from './stripe.js';
import { adsRouter, adsTxt, appAdsTxt } from './ads.js';
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
  // Health, not crypto: stripe.js already decided; this just remembers how
  // it went, so the dashboard can notice a run of rejections.
  noteWebhook(!result.error, result.error);
  if (result.error) return res.status(400).json(result);
  res.json({ received: true });
});

app.use(express.json({ limit: '8kb' }));
app.use('/api/ads', adsRouter); // the live gateway — it answers ahead of the dark scaffolding further down, which it supersedes
// The two seller files, ahead of the static handler so a stale copy dropped
// into public/ can never shadow the ids the desk actually holds. Both are
// generated from what the owner has pasted in and both 404 until he has —
// see the block that builds them in ads.js for why they are not behind the
// ads switch.
app.get('/ads.txt', (_req, res) => {
  const body = adsTxt();
  if (!body) return res.status(404).type('text/plain').send('no AdSense publisher configured\n');
  res.type('text/plain').send(body);
});
app.get('/app-ads.txt', (_req, res) => {
  const body = appAdsTxt();
  if (!body) return res.status(404).type('text/plain').send('no AdMob publisher configured\n');
  res.type('text/plain').send(body);
});

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
// ---- rewarded ads ---------------------------------------------------------
// The gateway is mounted above, at /api/ads, and it is the whole system: the
// config, the signed one-shot ticket, AdMob's verification callback and the
// only path a rewarded coin takes into a wallet.
//
// What used to sit here was the scaffolding it grew out of — a /config that
// answered from an env var and a /reward that paid 25 coins for any nonce a
// caller cared to invent, with a TODO where the verification was meant to go.
// It has been dead since the router went in front of it, and dead is not the
// same as harmless: it was a mint, kept out of reach by nothing but the order
// two routes happen to be registered in. The router answers both paths for
// every request, so deleting this changes no behaviour and removes the one
// version of the reward endpoint that would pay without a ticket.

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
// Render's health check knocks here during deploys, so traffic only moves
// to a new process once it actually answers — no more mid-deploy 502s.
app.get('/healthz', (_req, res) => res.json({ ok: true, uptimeSec: Math.round(process.uptime()) }));

app.get('/api/name', (_req, res) => res.json({ name: randomName() }));

app.get('/api/wallet', (req, res) => {
  const w = walletOf(String(req.query.token || '').slice(0, 64));
  if (!w) return res.status(400).json({ error: 'Missing identity' });
  res.json(w);
});

// ---- daily reward --------------------------------------------------------
// The GET is a read-only peek (the home screen polls it, and reads must not
// mint profiles); the claim is the action, and it lands in the same ledger
// every other credit does — provider 'daily', zero dollars.
app.get('/api/daily', (req, res) => {
  res.json(dailyView(String(req.query.token || '').slice(0, 64)));
});

app.post('/api/daily/claim', (req, res) => {
  const result = claimDaily(String(req.body?.token || '').slice(0, 64));
  // A double claim is the client being eager, not broken — 409, with the
  // when-next attached so it can set its own countdown.
  if (result.error) return res.status(result.claimed ? 409 : 400).json(result);
  res.json(result);
});

// ---- leaderboard & shelf -------------------------------------------------
/** Public by construction: friend codes and lifetime totals, nothing else. */
app.get('/api/leaderboard', (_req, res) => res.json({ top: leaderboardView() }));

/** Only ever your own shelf — the token is a secret, so that's all it opens. */
app.get('/api/achievements', (req, res) => {
  res.json(achievementsView(String(req.query.token || '').slice(0, 64)));
});

// ---- push (scaffolding) --------------------------------------------------
// Registration is live so shipped clients can start handing over device
// tokens; nothing sends until APNs credentials exist — see server/push.js.
app.post('/api/push/register', (req, res) => {
  const { token, deviceToken, platform } = req.body || {};
  const result = registerPushDevice(String(token || '').slice(0, 64), deviceToken, platform);
  if (result.error) return res.status(400).json(result);
  res.json(result);
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
  // Already sitting at a table? Restyle the piece live. Presence is its own
  // book — the profile never carried a room, so this used to look somewhere
  // nothing was written and the board only caught up on the next join.
  const room = rooms.get(roomOf(token) || '');
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
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const WEBHOOK_HEALTH_FILE = path.join(DATA_DIR, 'webhook-health.json');

// Boot-time ops: remember how Stripe deliveries have been going, and take
// the first daily snapshot now — yesterday's data is worth having the day
// something breaks, and "the day something breaks" is not announced.
initWebhookHealth(DATA_DIR);
startBackups(DATA_DIR);

// Every admin POST leaves a line here. The dashboard shows the tail; the file
// is the memory — an operator action that isn't written down didn't happen.
const AUDIT_FILE = path.join(DATA_DIR, 'audit.json');
let auditLog = [];
try {
  const raw = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
  if (Array.isArray(raw)) auditLog = raw;
} catch { /* first run */ }

function audit(action, target, detail) {
  auditLog.push({ at: Date.now(), action, target: String(target || ''), detail: String(detail || '').slice(0, 200) });
  if (auditLog.length > 2000) auditLog.splice(0, auditLog.length - 2000);
  try {
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(auditLog));
  } catch (err) {
    console.warn('audit: could not persist —', err.message);
  }
}

/** stat() that shrugs — a missing file is an answer, not an error. */
const fileInfo = (file) => {
  try {
    const s = fs.statSync(file);
    return { size: s.size, savedAt: s.mtimeMs };
  } catch { return null; }
};
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
    // How long the table ran: the lifetime turn tally and the game record
    // both read it, so it has to be in hand before either is written.
    const turns = room.turnCount || 0;
    // Winning pays two coins, the runner-up one. A token, not a wage — the
    // shop is where coins are meant to come from.
    // Team games pay every human on the winning side.
    const winners = room.winningTeam != null
      ? room.players.filter((p) => p.team === room.winningTeam && !p.isBot && !p.bankrupt)
      : room.players.filter((p) => p.id === room.winner?.id && !p.isBot);
    for (const w of winners) awardWin(w.id, 2, `won ${room.id} on ${room.map.name}`);
    // Second place is whoever stood tallest among the beaten: solvent seats
    // by net worth first, then whoever fell last. Net worth walks the
    // ownership map, and this whole block runs inside a state broadcast —
    // one throw here and the table's last frame never ships while the tally
    // is left half-written, so the walk is allowed to shrug.
    const worth = (p) => { try { return room.netWorth(p) || 0; } catch { return 0; } };
    const winnerIds = new Set(winners.map((w) => w.id));
    const runnerUp = [...room.players]
      .filter((p) => !p.isBot && !winnerIds.has(p.id))
      .sort((a, b) => Number(a.bankrupt) - Number(b.bankrupt) || worth(b) - worth(a))[0];
    // Second place is paid, not credited with a win: `placing` keeps the coin
    // out of the lifetime tally the leaderboard and the wins column read.
    if (runnerUp) awardWin(runnerUp.id, 1, `runner-up in ${room.id}`, { placing: true });
    // The same moment feeds the trophy shelf and the lifetime tallies: one
    // title per human — winners and losers alike — and the game's turn count
    // for everyone who saw it end. House players fall through both filters:
    // no profile ever existed for a bot id, so there is nothing to bump.
    for (const [pid, t] of Object.entries(room.titles || {})) {
      if (!room.player(pid)?.isBot) recordTitle(pid, t.title);
    }
    for (const p of room.players) {
      if (!p.isBot) noteTurns(p.id, turns);
    }
    // The other book, and the one the owner actually asked for: which real
    // humans played on which calendar day. Public codes only, deduped by
    // the day tally — a browser that opened a lobby and left never reaches
    // here, so this line cannot be padded by visitors.
    noteGameDay(stats, room.players.filter((p) => !p.isBot).map((p) => codeForToken(p.id)));
    stats.recent.unshift({
      roomId: room.id,
      map: room.map.name,
      players: room.players.map((p) => p.name),
      winner: room.winner?.name || null,
      // The lobby illusion stops at this desk: the owner sees which winners
      // were house players.
      winnerIsBot: !!room.winner?.isBot,
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

  const dayMs = 24 * 60 * 60 * 1000;
  const activeSince = (ms) => profs.filter((p) => p.seen && now - p.seen < ms).length;

  // Revenue sliced by pack, and who actually pays.
  const byPack = new Map();
  const buyers = new Set();
  for (const e of paid) {
    const k = e.packId || 'other';
    const row = byPack.get(k) || { packId: k, usd: 0, coins: 0, count: 0 };
    row.usd += e.usd;
    row.coins += e.coins;
    row.count++;
    byPack.set(k, row);
    if (e.code) buyers.add(e.code);
  }
  const revenueTotal = round2(paid.reduce((n, e) => n + e.usd, 0));

  // Where coins come from and where they go. Mints are read off the ledger
  // (wins only started writing entries when this shipped); the burn is the
  // replacement price of every cosmetic sitting in a wallet.
  const flows = { wins: 0, purchases: 0, grants: 0, burned: 0 };
  for (const e of ledger) {
    if (e.provider === 'win') flows.wins += e.coins;
    else if (e.provider === 'admin') flows.grants += e.coins;
    else flows.purchases += e.coins;
  }
  const tally = ownedTally();
  for (const item of STORE_ITEMS) flows.burned += (tally[item.id] || 0) * item.price;

  const roomsByStatus = { lobby: 0, playing: 0, ended: 0 };
  for (const r of rooms.values()) roomsByStatus[r.status] = (roomsByStatus[r.status] || 0) + 1;

  // Real players — the headline the profile count was never able to give.
  // A profile is minted the moment a browser joins a lobby; a real player
  // has finished a game. The dashboard leads with the second number and
  // labels the first one honestly.
  const real = realCounts(now);
  const dayKeys = lastDayKeys(30, now);
  const newRealPerDay = bucketByDay(dayKeys, profs.filter((p) => p.real).map((p) => p.firstPlayed));
  const series = daySeries(stats, 30, now).map((d, i) => ({ ...d, newReal: newRealPerDay[i] }));

  res.json({
    totals: {
      gamesStarted: stats.gamesStarted,
      gamesEnded: stats.gamesEnded,
      liveRooms: rooms.size,
      liveSockets: [...socketsOf.values()].reduce((n, s) => n + s.size, 0),
      profiles: profs.length,
      realPlayers: real.all,
      realToday: real.today,
      realWeek: real.week,
      realMonth: real.month,
      tourists: real.tourists,
      coinsInCirculation,
      avgKarma,
      dau: activeSince(dayMs),
      wau: activeSince(7 * dayMs),
      mau: activeSince(30 * dayMs),
    },
    // Real players and games per calendar day, oldest first, plus the day
    // each real player's first finished game landed on. Recorded from the
    // game-end hook, capped at 90 days on disk, served 30 at a time.
    series,
    revenue: {
      // The ledger began with a deploy; purchases before its first entry
      // exist only as dedupe ids with no amounts, so they are not counted.
      since: ledger[0]?.at || null,
      total: revenueTotal,
      last7d: round2(paid.filter((e) => e.at >= weekAgo).reduce((n, e) => n + e.usd, 0)),
      purchases: paid.length,
      byPack: [...byPack.values()]
        .map((r) => ({ ...r, usd: round2(r.usd) }))
        .sort((a, b) => b.usd - a.usd),
      buyers: buyers.size,
      arpu: buyers.size ? round2(revenueTotal / buyers.size) : null,
    },
    ledger: ledger.slice(-1000),
    economy: {
      coinsInCirculation,
      avgKarma,
      flows,
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
        // The public code, so a seat can be kicked or looked up — never the token.
        code: p.isBot ? null : codeForToken(p.id),
        bankrupt: !!p.bankrupt, connected: p.connected !== false,
        money: typeof p.money === 'number' ? p.money : null,
        netWorth: safeNetWorth(r, p),
      })),
      sockets: socketsOf.get(r.id)?.size || 0,
      turns: r.turnCount || 0,
      ageMs: now - (r.createdAt || now),
      quick: !!r.quick,
      maxPlayers: r.settings.maxPlayers,
      quickStartAt: r.quickStartAt || null,
    })),
    recentGames: stats.recent,
    // Every profile, each row flagged real (finished a game) or not, so the
    // desk can show players by default and visitors on request. Public
    // fields only — the identity token never appears here.
    players: profs,
    moderation: {
      bans: bansView(),
      audit: auditLog.slice(-300),
    },
    system: {
      uptimeSec: Math.floor(process.uptime()),
      rss: process.memoryUsage().rss,
      node: process.version,
      sockets: io.engine?.clientsCount ?? 0,
      roomsByStatus,
      webhook: webhookHealth(),
      backup: backupInfo(),
      data: {
        ...dataFiles(),
        stats: fileInfo(STATS_FILE),
        audit: fileInfo(AUDIT_FILE),
        webhook: fileInfo(WEBHOOK_HEALTH_FILE),
      },
    },
    config: {
      dataDirEnv: !!process.env.DATA_DIR,
      adminKeyDefault: ADMIN_KEY === 'moneymove-admin',
      stripe: stripeEnabled(),
      stripeWebhook: !!process.env.STRIPE_WEBHOOK_SECRET,
    },
  });
});

app.get('/admin', (req, res) => {
  if (!adminGuard(req, res)) return;
  res.type('html').send(adminPageHTML);
});

/**
 * The whole data dir as one download — tar.gz where the box has tar (Render
 * does), a JSON bundle where it doesn't. A GET, like the dashboard itself:
 * it changes nothing, but taking a copy is still worth an audit line.
 */
app.get('/api/admin/backup', (req, res) => {
  if (!adminGuard(req, res)) return;
  audit('backup', 'data-dir', 'downloaded a copy');
  streamDataBackup(res, DATA_DIR);
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
  audit('credit', result.code, `+${Math.floor(Number(req.body?.coins))} coins${req.body?.reason ? ' — ' + String(req.body.reason).slice(0, 140) : ''}`);
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
  audit('close-room', id, '');
  console.log(`admin: closed room ${id}`);
  res.json({ ok: true });
});

/** Set a player's karma outright — the operator's thumb on the scale. */
app.post('/api/admin/karma', (req, res) => {
  if (!adminBodyGuard(req, res)) return;
  const result = setKarma(req.body?.code, req.body?.karma);
  if (result.error) return res.status(400).json(result);
  audit('karma', result.code, `set to ${result.karma}${req.body?.reason ? ' — ' + String(req.body.reason).slice(0, 140) : ''}`);
  res.json(result);
});

/** Ban a device by its public code. The token underneath is what's banned. */
app.post('/api/admin/ban', (req, res) => {
  if (!adminBodyGuard(req, res)) return;
  const result = banByCode(req.body?.code, req.body?.reason);
  if (result.error) return res.status(400).json(result);
  audit('ban', result.code, String(req.body?.reason || '').slice(0, 140));
  console.log(`admin: banned ${result.code}`);
  res.json(result);
});

app.post('/api/admin/unban', (req, res) => {
  if (!adminBodyGuard(req, res)) return;
  const result = unbanByCode(req.body?.code);
  if (result.error) return res.status(400).json(result);
  audit('unban', result.code, '');
  console.log(`admin: unbanned ${result.code}`);
  res.json(result);
});

/**
 * Pull one seat out of a live table — the same exit a timeout takes: deeds
 * back to the bank, turn order moves on, the client offers "watch how it ends".
 */
app.post('/api/admin/kick', (req, res) => {
  if (!adminBodyGuard(req, res)) return;
  const roomId = String(req.body?.roomId || '').toLowerCase().slice(0, 12);
  const code = String(req.body?.code || '').trim().toUpperCase();
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'No such room' });
  const token = tokenForCode(code);
  const p = token ? room.player(token) : null;
  if (!p) return res.status(404).json({ error: 'No seat with that code in this room' });
  if (p.isBot) return res.status(400).json({ error: 'That seat is a bot — close the room instead' });
  if (room.status === 'playing' && !p.bankrupt) {
    room.say(`${p.name} was removed by the admin`, 'leave');
    room.removeFromPlay(p, 'timeout');
  } else {
    room.removePlayer(token);
  }
  audit('kick', code, `from ${roomId}`);
  res.json({ ok: true, code, roomId });
});

/** One line to every open client, over the toast every UI already renders. */
app.post('/api/admin/broadcast', (req, res) => {
  if (!adminBodyGuard(req, res)) return;
  const message = String(req.body?.message || '').trim().slice(0, 200);
  if (!message) return res.status(400).json({ error: 'Nothing to say' });
  io.emit('toast', { type: 'info', message });
  audit('broadcast', 'everyone', message);
  res.json({ ok: true, reached: io.engine?.clientsCount ?? null });
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
  // Seats are counted in people: the house players filling a quick lobby give
  // their chair back the moment someone real wants it, so a table only reads
  // as full once it is full of humans.
  const humansIn = (r) => r.players.filter((p) => !p.isBot).length;
  const waiting = [...rooms.values()]
    .filter((r) => r.quick && r.status === 'lobby' && humansIn(r) < r.settings.maxPlayers)
    .sort((a, b) => humansIn(b) - humansIn(a));
  if (waiting.length) {
    // Someone new arriving is worth a moment's grace for others to land too.
    const room = waiting[0];
    if (humansIn(room) === room.settings.maxPlayers - 1) room.armQuickStart(6);
    return room;
  }
  const room = getRoom(newRoomId());
  room.makeQuickMatch(20);
  return room;
}

/** Team chat stays inside the team: strip other teams' messages per viewer. */
function stateFor(base, room, viewerIds) {
  if (!base.chat.some((m) => m.channel === 'team')) return base;
  const teams = new Set();
  for (const id of viewerIds || []) {
    const t = room.player(id)?.team;
    if (t != null) teams.add(t);
  }
  return { ...base, chat: base.chat.filter((m) => m.channel !== 'team' || teams.has(m.team)) };
}

/** The player ids this socket has claimed here — several, on pass & play. */
function seatsHeldBy(roomId, socketId) {
  const held = new Set();
  for (const [playerId, socketIds] of seatsOf.get(roomId) || []) {
    if (socketIds.has(socketId)) held.add(playerId);
  }
  return held;
}

// --------------------------------------------------------- state on a diet --
/**
 * A full state is around 13.5 KB and most of it is furniture: the same board,
 * the same group table, the same settings everyone agreed on in the lobby,
 * re-sent thirty-odd times a minute to every viewer. A socket that says
 * `proto: 2` when it joins gets one full state and then only what moved.
 *
 * Nobody is made to. A client that announces nothing — the build sitting in
 * App Store review, a browser holding last week's bundle — keeps receiving
 * full 'state' events, byte for byte as before, for as long as it likes.
 *
 * The diff is per viewer and never shared. Ids in a state are aliased to the
 * socket reading it, so a patch cut against somebody else's copy would hand
 * out the wrong disguises.
 */
const deltaOf = new Map(); // socket.id -> { roomId, seats, v, lean, log, chat }

// One remembered state per socket is cheap, but not free, and a leak here
// would be a slow one. Past this many tracked sockets — far more than this box
// can hold games for — newcomers simply keep getting full states.
const MAX_TRACKED = 4000;

// snapshot() freezes the base a viewer is cut from, because the room edits its
// own settings and turn objects in place between pushes. These keys are the
// exception: the board and the group table are module constants, and log and
// chat entries are written once and never touched again — so they ride along
// by reference, and they are most of the bytes.
const SHARED_KEYS = new Set(['map', 'groups', 'teamInfo', 'log', 'chat']);

/** The seats a socket holds, as one comparable string. */
const seatKey = (held) => [...held].sort().join(',');

/** A base that will not move under the diff — only needed by delta viewers. */
const frozenBase = (room, track) => (track ? snapshot(room.serialize(), SHARED_KEYS) : room.serialize());

/** The whole thing — and, for a delta viewer, the point their next diff
 *  will be measured from. Old clients pass no tracker and nothing is kept. */
function sendFullState(sid, room, held, state, track) {
  io.to(sid).emit('state', state);
  if (!track) return;
  const { log, chat, ...lean } = state;
  track.roomId = room.id;
  track.seats = seatKey(held);
  track.v = state.version;
  track.lean = lean;
  track.log = log;
  track.chat = chat;
}

/**
 * One push, to one delta socket: a patch if we can honestly cut one against
 * what that socket was last sent, the whole state if we cannot.
 */
function sendPatch(sid, room, held, track, frozen) {
  const state = stateFor(room.serializeFor(held, frozen), room, held);
  // Nothing to diff against, or the ids in this state no longer mean what
  // they did: claiming or releasing a seat re-cuts who is aliased, and a room
  // switch is a different story entirely.
  if (!track.lean || track.roomId !== room.id || track.seats !== seatKey(held)) {
    sendFullState(sid, room, held, state, track);
    return;
  }
  // The two feeds ride as tails rather than through the diff — they only ever
  // grow, and re-sending sixty log lines for the sake of one is the single
  // biggest thing wrong with a full push.
  const { log, chat, ...lean } = state;
  const logTail = feedTail(track.log, log, 'at');
  const chatTail = feedTail(track.chat, chat, 'id');
  // Fallen out of the window: they would be stitching a hole into their own
  // scrollback, so hand them the whole state instead.
  if (logTail === RESYNC || chatTail === RESYNC) {
    sendFullState(sid, room, held, state, track);
    return;
  }
  const patch = diff(track.lean, lean);
  // A push that moved nothing this viewer can see costs them nothing, and
  // leaves their version where it was — so the next patch still lines up.
  if (!patch && !logTail && !chatTail) return;
  const msg = { v: state.version, from: track.v };
  if (patch) msg.patch = patch;
  if (logTail) msg.log = logTail;
  if (chatTail) msg.chat = chatTail;
  io.to(sid).emit('statePatch', msg);
  track.v = state.version;
  track.lean = lean;
  track.log = log;
  track.chat = chat;
}

function broadcast(room) {
  recordTransitions(room);
  // Serialized once, then cut per socket: a viewer's own seats keep their
  // real ids (the id is their secret token), everyone else's are aliased —
  // see GameRoom.serializeFor. Spectators hold no seat and get only aliases.
  const base = room.serialize();
  let frozen = null;
  for (const sid of socketsOf.get(room.id) || []) {
    const held = seatsHeldBy(room.id, sid);
    const track = deltaOf.get(sid);
    if (!track) {
      io.to(sid).emit('state', stateFor(room.serializeFor(held, base), room, held));
      continue;
    }
    // Frozen once for the whole room, not once per viewer: what serializeFor
    // rebuilds per viewer is already fresh, and the rest is what needs pinning.
    frozen ??= snapshot(base, SHARED_KEYS);
    sendPatch(sid, room, held, track, frozen);
  }
  // Keep each seated player's presence in step with what the room is doing,
  // so a friends list can say "in a lobby" vs "in a game".
  for (const playerId of seatsOf.get(room.id)?.keys() || []) {
    setPresence(playerId, room.id, room.status);
  }
}

// Reap idle rooms every couple of minutes — bots playing to an empty
// theatre burn a timer a second for nobody.
setInterval(() => {
  // A socket that left without a goodbye would otherwise keep its last state
  // alive forever; io still knows who is actually in the building.
  for (const sid of deltaOf.keys()) {
    if (!io.sockets.sockets.has(sid)) deltaOf.delete(sid);
  }
  for (const [id, room] of rooms) {
    const live = socketsOf.get(id)?.size || 0;
    const idleFor = Date.now() - (room.lastSeen || room.createdAt);
    // A table nobody is watching holds still by itself now, so letting it sit
    // costs nothing but the object. Give people a real chance to come back to
    // the game they were in — a lunch break, a train tunnel — and only then
    // call it over. The room itself lingers for the usual half hour.
    if (live === 0 && room.status === 'playing' && idleFor > 10 * 60 * 1000) {
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
}, 2 * 60 * 1000);

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
    const t = String(payload?.token || '').slice(0, 64);
    if (t && isBanned(t)) return fail('You are banned from MoneyMove');
    const id = newRoomId();
    getRoom(id);
    if (typeof cb === 'function') cb({ roomId: id });
    else socket.emit('roomCreated', { roomId: id });
  }));

  socket.on('quickplay', safely('quickplay', (payload = {}, cb) => {
    const t = String(payload?.token || '').slice(0, 64);
    if (t && isBanned(t)) return fail('You are banned from MoneyMove');
    const room = quickMatchRoom();
    if (typeof cb === 'function') cb({ roomId: room.id });
    else socket.emit('roomCreated', { roomId: room.id });
  }));

  socket.on('join', safely('join', ({
    roomId, token, name, flag, proto,
  } = {}) => {
    if (!roomId || !token) return fail('Missing room or identity');
    // The banned find out at the door, plainly — no seat, no spectating.
    if (isBanned(String(token).slice(0, 64))) {
      return socket.emit('joinFailed', { message: 'You are banned from MoneyMove', spectate: false });
    }
    roomId = String(roomId).toLowerCase().slice(0, 12);
    // The one thing a client has to say to get patches instead of whole
    // states. Said here rather than in a handshake of its own so it rides
    // every reconnect for free, and so silence keeps its old meaning.
    if (Number(proto) >= 2 && deltaOf.size < MAX_TRACKED) {
      deltaOf.set(socket.id, deltaOf.get(socket.id) || {});
    } else {
      deltaOf.delete(socket.id);
    }
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
    // "Filled" is measured in people here too — house players pad the seat
    // count long before kick-off, and starting the moment they do would cut
    // the fuse short and strand the next human queueing on a fresh table.
    if (room.quick && room.status === 'lobby'
        && room.players.filter((p) => !p.isBot).length >= room.settings.maxPlayers) {
      room.startQuickMatch();
    }
    socket.emit('you', { playerId, roomId });
    const held = seatsHeldBy(roomId, socket.id);
    const track = deltaOf.get(socket.id);
    // Always the whole thing at the door, whatever the socket speaks: it is
    // the fixed point every later patch is measured from.
    sendFullState(socket.id, room, held,
      stateFor(room.serializeFor(held, frozenBase(room, track)), room, held), track);
  }));

  /**
   * The client's way of saying it lost the thread — a patch arrived for a
   * version it doesn't hold, or a feed anchor didn't match. Answer with the
   * whole state, but only so often: a confused client shouldn't be able to
   * bill the server for a hundred of them a second.
   */
  let lastResync = 0;
  socket.on('resync', safely('resync', () => {
    if (!room) return;
    const now = Date.now();
    if (now - lastResync < 250) return;
    lastResync = now;
    const track = deltaOf.get(socket.id);
    room.lastSeen = now;
    const held = seatsHeldBy(room.id, socket.id);
    sendFullState(socket.id, room, held,
      stateFor(room.serializeFor(held, frozenBase(room, track)), room, held), track);
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
  // Clients only ever see other players as aliases, so any id that names
  // someone else is translated back to the real token at the door. A caller's
  // own real token still passes through untouched — see GameRoom.resolveId.
  socket.on('kick', guard((targetId) => {
    if (playerId !== room.hostId) return fail('Only the host can remove players');
    const target = room.resolveId(String(targetId || ''));
    if (target === room.hostId) return;
    room.removePlayer(target);
  }));
  socket.on('team', guard((team, targetId) => {
    const asked = targetId ? room.resolveId(String(targetId)) : null;
    const target = asked && asked !== playerId ? asked : playerId;
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

  socket.on('trade:propose', guard((d = {}) => ok(room.proposeTrade(playerId, { ...d, to: room.resolveId(d.to) }))));
  socket.on('trade:respond', guard(({ id, accept } = {}) => ok(room.respondTrade(playerId, id, !!accept))));
  socket.on('trade:cancel', guard(({ id } = {}) => ok(room.cancelTrade(playerId, id))));
  socket.on('trade:ignore', guard(({ id, ignored } = {}) => ok(room.ignoreTrade(playerId, id, ignored !== false))));
  socket.on('trade:viewing', guard(({ id, viewing } = {}) => ok(room.setTradeViewing(playerId, id, !!viewing))));

  socket.on('payDebt', onTurn(() => ok(room.payDebt(playerId))));
  socket.on('bankrupt', guard(() => ok(room.declareBankrupt(playerId))));
  socket.on('quit', guard(() => ok(room.quit(playerId))));
  socket.on('grantTime', guard(({ id } = {}) => ok(room.grantTime(playerId, room.resolveId(String(id || ''))))));
  socket.on('chat', guard((text, channel) => room.sendChat(playerId, text, channel)));

  socket.on('makeHost', guard(({ id } = {}) => ok(room.makeHost(playerId, room.resolveId(String(id || ''))))));

  socket.on('rematch', guard(() => {
    // First one to want another game gets to run it — whoever presses
    // Play again takes the host chair; the departed stay departed.
    ok(room.rematch(playerId));
  }));

  socket.on('disconnect', () => {
    // The remembered state goes out with the socket that was reading it.
    deltaOf.delete(socket.id);
    if (!room) return;
    socketsOf.get(room.id)?.delete(socket.id);
    // Other tabs of the same player keep the seat alive.
    if (releaseSeat(room.id, playerId, socket.id) > 0) return;
    clearPresence(playerId);
    room.removePlayer(playerId);
    // Nobody left watching: an empty room dies, and so does a quick table —
    // its remaining seats are house players performing to an empty theatre.
    const deserted = (socketsOf.get(room.id)?.size || 0) === 0
      && (room.players.length === 0 || (room.quick && room.players.every((pl) => pl.isBot)));
    if (deserted) {
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
