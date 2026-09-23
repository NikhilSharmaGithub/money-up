import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { GameRoom, COLORS, rollQuickSettings } from './game.js';
import { diff, snapshot, feedTail, RESYNC } from './delta.js';
import { sendTurnPush } from './push.js';
import * as cup from './tournament.js';
import { refreshRates } from './fx.js';
import { mapList } from './maps.js';
import {
  boardAccess, mayUseBoard, priceOn, mapIdOfItem, freeBoardsOn, HOUSE_BOARD,
  isBoardForSale, RENT_PRICE,
} from './boards.js';
import {
  profileFor, addFriend, removeFriend, friendsOf, socialOf, acceptFriend, declineFriend,
  inviteFriend, inviteFor, clearInvite, setPresence, clearPresence,
  sendNotice, noticesFor, markNoticesRead, allNotices, dropNotice,
  allProfiles, attachLogin, detachLogin, meView, walletOf, awardWin, buyItem, equipItem, sendDM, dmsWith,
  rentBoard, rentalOf, hasLiveRental, consumeRental, rentalSpent,
  blockPlayer, unblockPlayer, reportPlayer, reportsView, resolveReport, deleteAccount, guestTokensOf,
  bumpKarma, creditPurchase, ledgerView, adminCredit, setKarma,
  banByCode, unbanByCode, isBanned, bansView, tokenForCode, codeForToken,
  ownedTally, dataFiles,
  dailyView, claimDaily, leaderboardView, achievementsView, recordTitle, noteTurns,
  registerPushDevice, realCounts, roomOf,
  loginOf, takeAppleRefresh, appleSubjectLinkedElsewhere, forgetAppleSubject,
  appleLoginVerified, passAppleRefreshOn, dropUnverifiedAppleLogins,
} from './social.js';
import {
  verifyIdentityToken, exchangeCode, queueRevocation, verifyServerNotification,
  startAppleRevocationRetries, appleRevokeReady, withdrawQueuedRevocations,
} from './appleid.js';
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
 * Pass-and-play seats derive their token from the phone's — `abc_p2` is the
 * second chair on `abc`'s device. It is the same phone, the same wallet and
 * the same rental book, so anything that reads money strips the suffix first.
 */
const baseToken = (t) => String(t || '').replace(/_p\d+$/, '');

/**
 * The board shelf, as one wallet sees it: every board, whether it can be
 * played and why, what it costs if not, and when the day's two free ones
 * change hands.
 *
 * One endpoint rather than the client crossing /api/maps with /api/wallet,
 * because the answer depends on the server's calendar and the server is the
 * only honest clock in the building. A caller with no token gets the shelf a
 * brand new player sees, which is exactly what a brand new player should see.
 *
 * `room` is optional and it is what makes a rented board readable. A pass is
 * good at one table, so "may I play this?" has no answer until the caller
 * says which table they are asking about. Asked from the shop, with no table
 * in hand, a locked board simply reads as locked and rentable — which is the
 * honest answer there.
 */
app.get('/api/boards', (req, res) => {
  const token = String(req.query?.token || '').slice(0, 64);
  const roomId = String(req.query?.room || '').toLowerCase().slice(0, 12);
  const owned = token ? (walletOf(token)?.owned || []) : [];
  const access = boardAccess(owned);
  // The unplayed pass this wallet is holding, wherever it is pointed. Read
  // once and answered from, rather than asked again for every board on the
  // shelf. The client is told about it so it can say "your unplayed game
  // moves here" instead of asking for a coin it is not going to charge.
  const holding = token ? rentalOf(token) : null;
  const rented = (id) => !!roomId && holding?.mapId === id && holding?.roomId === roomId;
  res.json({
    boards: mapList()
      .map((m) => {
        const state = access.state(m.id);
        // A rental beats the calendar: it was paid for, and it is good here.
        return rented(m.id)
          ? { ...m, ...state, playable: true, how: 'rented', rentable: false }
          : { ...m, ...state };
      })
      .sort((a, b) => a.shelf - b.shelf),
    free: access.free,
    sale: access.sale,
    saleOff: access.saleOff,
    until: access.until,
    perDay: access.perDay,
    cycleDays: access.cycleDays,
    house: access.house,
    rent: {
      price: access.rentPrice,
      holding: holding ? { mapId: holding.mapId, roomId: holding.roomId } : null,
    },
    coins: token ? (walletOf(token)?.coins || 0) : 0,
  });
});
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

/** Friends, plus who has asked and who you have asked — the app's shape. */
app.get('/api/social', (req, res) => {
  res.json(socialOf(String(req.query.token || '').slice(0, 64)));
});

app.post('/api/friends/accept', (req, res) => {
  const result = acceptFriend(String(req.body?.token || '').slice(0, 64), req.body?.code);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/friends/decline', (req, res) => {
  res.json(declineFriend(String(req.body?.token || '').slice(0, 64), req.body?.code));
});

app.post('/api/friends/remove', (req, res) => {
  const { token, code } = req.body || {};
  res.json(removeFriend(String(token || '').slice(0, 64), code));
});

/**
 * Ask a friend to your table. They get it on their next poll wherever they
 * are — landing screen or mid-game — and a push if their phone is registered
 * and APNs is configured.
 */
app.post('/api/invite', (req, res) => {
  const result = inviteFriend(String(req.body?.token || '').slice(0, 64),
    req.body?.code, req.body?.roomId);
  if (result.error) return res.status(400).json(result);
  const { token: theirToken, ...safe } = result;
  sendTurnPush(theirToken, `${safe.to?.name ? '' : ''}You have been invited to a game on MoneyMove`,
    { collapseId: 'invite' });
  res.json(safe);
});

/** Whatever is waiting for this player: an invite, for now. */
app.get('/api/invite', (req, res) => {
  res.json({ invite: inviteFor(String(req.query.token || '').slice(0, 64)) });
});

/** The owner's notes to this player, and to the whole field. */
app.get('/api/notices', (req, res) => {
  res.json(noticesFor(String(req.query.token || '').slice(0, 64)));
});

app.post('/api/notices/read', (req, res) => {
  res.json(markNoticesRead(String(req.body?.token || '').slice(0, 64)));
});

app.post('/api/invite/clear', (req, res) => {
  res.json(clearInvite(String(req.body?.token || '').slice(0, 64)));
});

// ---- safety ---------------------------------------------------------------
// Block and report, from chat, a message thread or a friends row. Both need
// only a friend code: the app never learns anyone's device token, and the
// server never sends one.
app.post('/api/block', (req, res) => {
  const result = blockPlayer(String(req.body?.token || '').slice(0, 64), req.body?.code);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/unblock', (req, res) => {
  const result = unblockPlayer(String(req.body?.token || '').slice(0, 64), req.body?.code);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/report', (req, res) => {
  const { token, code, reason, where, text } = req.body || {};
  const result = reportPlayer(String(token || '').slice(0, 64), code, { reason, where, text });
  if (result.error) return res.status(400).json(result);
  // The values the server stored, not the ones the client sent — a raw body
  // field in a log line is a way to write fake lines into the log.
  console.log(`report: ${result.id} — ${result.reason} in ${result.where}`);
  audit('report', result.id, `${result.reason} in ${result.where}`);
  res.json(result);
});

/**
 * Delete this account, from inside the app.
 *
 * `appleCode` is a fresh authorization code, sent only by a player who signed
 * in with Apple but has no token on file to revoke (they signed in before the
 * server kept one, or while it could not). The app gets it by running Sign in
 * with Apple once more at the moment of deletion; see eraseAccount for what
 * happens to it, why that is bounded, and why it happens before the account
 * is touched rather than after.
 */
app.post('/api/account/delete', async (req, res) => {
  const token = String(req.body?.token || '').slice(0, 64);
  if (!token) return res.status(400).json({ error: 'Missing identity' });
  try {
    res.json(await eraseAccount(token, 'a player deleted their account from the app',
      { appleCode: req.body?.appleCode }));
  } catch (err) {
    console.error('erase: failed', err);
    res.status(500).json({ error: 'Could not delete the account — try again' });
  }
});

/**
 * Everything deleting a person involves, in the order it has to happen.
 *
 * Out of any table first: a seat that outlives its account would award karma
 * or a payout to it seconds later, and that is exactly how a deleted profile
 * comes back. Then out of any cup still taking entries, then their name off
 * every cup they were in, then the account itself — the owner's seats on this
 * device and the pass & play guests alongside it.
 *
 * Then Apple. Somebody who signed in with Apple and deletes their account is
 * owed the end of MoneyMove's access to their Apple ID too — Apple's rules say
 * so and so does common sense — which takes the refresh token kept at
 * sign-in. It is lifted off the profile just before the profile goes, and
 * revoked whatever other devices are signed in with the same Apple ID: this
 * is the person saying, as plainly as the app lets them, that they are done.
 *
 * With no token on file, a fresh code from the app is exchanged for one. That
 * exchange is the only thing here that waits, and it happens FIRST, before
 * anything is touched: once deleteAccount has run, nothing may await before
 * the reply, because a request landing in that gap — a profile save, a buy, a
 * DM, a push registration — goes through profileFor and mints the account
 * again under the same friend code. The exchange is bounded by its own
 * timeout, so a slow or absent Apple costs the reply a few seconds at worst
 * and never the deletion. A code that turns out to belong to a different
 * Apple ID than the one this profile signed in with is not revoked: that
 * would be ending somebody else's access on this person's word.
 */
async function eraseAccount(token, why, { appleCode } = {}) {
  const asked = loginOf(token);
  const exchanged = asked?.provider === 'apple' && appleCode
    ? await appleRefreshFromCode(appleCode, asked.subject, 'account deletion', { acceptUnknownSubject: true })
    : null;

  // From here to the return: no awaits.
  for (const t of [token, ...guestTokensOf(token)]) {
    const live = rooms.get(roomOf(t) || '');
    try { if (live?.player(t)) live.quit(t); } catch (err) { console.error('erase: quit failed', err); }
    clearPresence(t);
    for (const c of cup.liveCups()) {
      if (c.state === 'joining' && c.entrants?.some((e) => e.token === t)) cup.leave(t, c.id);
    }
    cup.forgetPlayer(t);
  }
  const login = loginOf(token);
  const held = takeAppleRefresh(token);
  const result = deleteAccount(token);
  if (result.deleted) audit('account', 'deleted', why);

  if (held) queueRevocation(held.token, 'account deleted', held.subject || login?.subject || '');
  // Revoking the held token already ends the authorization the exchanged one
  // belongs to when both are for the same Apple ID; only a token that is not
  // provably that needs sending as well.
  // An exchanged token whose Apple ID could not be read is queued with no
  // subject, which means no later sign-in can call it off: nobody can prove
  // it was theirs.
  if (exchanged && !(held && exchanged.sub && held.subject === exchanged.sub)) {
    queueRevocation(exchanged.refreshToken, 'account deleted', exchanged.sub);
  }
  if (!held && !exchanged && (login?.provider === 'apple' || asked?.provider === 'apple')) {
    console.warn('erase: an Apple sign-in was deleted with no Apple token to revoke');
  }
  return result;
}

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
  // A double claim is the client being eager, not broken — 409. Not being
  // signed in is neither: 401, so the card can offer the way in.
  if (result.needsLogin) return res.status(401).json(result);
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

// ---- tournaments ---------------------------------------------------------
// Hidden entirely until the owner switches it on: a client that asks a server
// with cups off gets `enabled: false` and draws nothing at all.
app.get('/api/cup', (req, res) => {
  // `show` names which cup the client is looking at; without it the server
  // picks the one that matters most to this reader — see publicView.
  res.json(cup.publicView(String(req.query.token || '').slice(0, 64),
    String(req.query.show || '').slice(0, 12)));
});

/**
 * The chart. Asked for when somebody opens it, never on the card's poll —
 * see bracketView for why.
 */
app.get('/api/cup/bracket', (req, res) => {
  res.json(cup.bracketView(String(req.query.token || '').slice(0, 64),
    String(req.query.cup || '').slice(0, 12)));
});

app.post('/api/cup/join', (req, res) => {
  const result = cup.join(String(req.body?.token || '').slice(0, 64),
    String(req.body?.code || '').slice(0, 32),
    String(req.body?.cupId || '').slice(0, 12));
  if (result.needsLogin) return res.status(401).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/cup/leave', (req, res) => {
  const result = cup.leave(String(req.body?.token || '').slice(0, 64),
    String(req.body?.cupId || '').slice(0, 12));
  if (result.error) return res.status(400).json(result);
  res.json(result);
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
  const { token, itemId, expect } = req.body || {};
  const item = itemById(String(itemId || ''));
  if (!item) return res.status(400).json({ error: 'Unknown item' });
  // Three boards are discounted every day, and the discount has to be real
  // where it counts — at the till. The catalogue carries the sticker price;
  // this is the only place that decides what actually leaves the wallet, so
  // it is the only place that needs to know about the sale.
  const mapId = mapIdOfItem(item.id);
  const charged = mapId ? { ...item, price: priceOn(mapId) } : item;
  // And the price the player agreed to is the price they pay.
  //
  // The shelf turns over at midnight; a client that read it last night and
  // taps this morning would otherwise be charged today's number without ever
  // being shown it — silently, because a purchase at the wrong price still
  // succeeds. So the client says what it is expecting, and a disagreement is
  // a refusal rather than a surprise. Cosmetics send nothing and are
  // unaffected: their price cannot move.
  if (expect != null && Number(expect) !== charged.price) {
    return res.status(409).json({
      // True whichever way it happened: the shelf turned over under a client
      // that read it last night, or a client asked for a price that was never
      // on offer. Either way the screen is out of date and the number is here.
      error: `The price has moved since that was drawn — it is ${charged.price} now.`,
      price: charged.price,
    });
  }
  const result = buyItem(String(token || '').slice(0, 64), charged);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/**
 * One coin, one game, on a board you do not own.
 *
 * The shop sells a board for good; this sells an evening on it. The table is
 * named because a pass is good at exactly one table — that is what keeps a
 * single coin from opening ten lobbies — so the checks here are about the
 * table as much as the board: it has to exist, it has to still be a lobby,
 * and the caller has to be the host, because the host is the only seat whose
 * entitlement the board is ever read against. Renting from any other chair
 * would be a coin spent on nothing.
 *
 * What the wallet does about it is social.js's business, including the part
 * where an unplayed pass moves rather than being bought twice.
 */
app.post('/api/boards/rent', (req, res) => {
  const token = String(req.body?.token || '').slice(0, 64);
  const mapId = String(req.body?.mapId || '').slice(0, 40);
  const roomId = String(req.body?.roomId || '').toLowerCase().slice(0, 12);
  const expect = req.body?.expect;
  // The same price-agreement the shop keeps: a client showing an old number
  // is refused rather than quietly charged a new one.
  if (expect != null && Number(expect) !== RENT_PRICE) {
    return res.status(409).json({ error: `A game costs ${RENT_PRICE} coin.`, price: RENT_PRICE });
  }
  if (!token) return res.status(400).json({ error: 'Missing identity' });
  if (!isBoardForSale(mapId)) return res.status(400).json({ error: 'No such board' });
  const base = baseToken(token);
  if (mayUseBoard(mapId, walletOf(base)?.owned || [])) {
    return res.status(400).json({ error: 'You can already play that one' });
  }
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'That table is gone' });
  if (room.status !== 'lobby') return res.status(409).json({ error: 'That table has already started' });
  // A cup table is set by the cup, and the socket that changes a board says so
  // too. Without the same guard here the coin was taken for a board this table
  // will refuse for as long as it exists — the pass is recoverable, it moves
  // free of charge to any other table, but nobody should be charged and then
  // told something that is not true.
  if (room.cupMatch) return res.status(409).json({ error: 'A cup table is set by the cup' });
  // And a matchmade table deals its own board, for the same reason: a coin
  // spent on a board this table will never accept is a coin spent on nothing.
  if (room.quick) return res.status(409).json({ error: 'A matchmade table sets itself' });
  if (baseToken(room.hostId || '') !== base) {
    return res.status(403).json({ error: 'Only the host picks the board' });
  }
  const result = rentBoard(base, mapId, roomId);
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
    // Whether this server can revoke Sign in with Apple — a yes or a no, and
    // nothing about the key that makes it one.
    appleRevoke: appleRevokeReady,
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
    // Google taking the place of an Apple login on this profile: the Apple
    // token it was holding is handed back, unless the same Apple ID is still
    // in use on another device.
    retireAppleRefresh(String(token).slice(0, 64), 'replaced by a Google sign-in');
    // info.name is deliberately unused: the play name comes from the player,
    // not from their Google account. The address and photo are kept — the
    // profile card is the only place they appear, and only to their owner.
    const linked = attachLogin(String(token).slice(0, 64), 'google', info.sub, req.body?.nickname,
      { email: info.email, picture: info.picture });
    // The name that goes back is the PLAY name — theirs if they had one, a
    // fresh one off the dice list if they did not. Never info.name: falling
    // back to Google's would put the real name on the board the one time it
    // matters, which is a new player's very first game.
    res.json({ ok: true, name: linked?.name || '', code: linked?.code, picture: linked?.picture || '' });
  } catch {
    res.status(401).json({ error: 'Could not verify the Google token' });
  }
});

/** Who am I — drives the profile chip. Includes the sign-in state. */
app.get('/api/me', (req, res) => {
  const me = meView(String(req.query.token || '').slice(0, 64));
  if (!me) return res.status(400).json({ error: 'Missing identity' });
  res.json(me);
});

/**
 * Sign out. The device identity, the wallet and the friends all stay; only
 * the link to Google or Apple goes — and with an Apple link, MoneyMove's
 * access to that Apple ID goes back to Apple as well, unless another device
 * is still signed in with it (see retireAppleRefresh).
 */
app.post('/api/auth/logout', (req, res) => {
  const token = String(req.body?.token || '').slice(0, 64);
  retireAppleRefresh(token, 'signed out');
  res.json(detachLogin(token));
});

// ---- sign in with apple -----------------------------------------------------
// The talking to Apple lives in appleid.js. What lives here is the lifecycle
// of the one Apple token a profile can hold: when a sign-in brings a new one,
// when an old one has to be handed back, and when it must not be.
//
// The rule that shapes all of it: revoking ANY token for an Apple ID ends
// MoneyMove's authorization for that Apple ID as a whole — every token, on
// every device, including one issued a second ago. So a token is only handed
// back when nothing still signed in could be relying on the authorization.

/**
 * Builds 10 and earlier sent Apple's user id and nothing Apple signed, which
 * is a claim anybody can type. None of those builds ever reached the store —
 * build 11 is the first that goes out, and it sends a signed identity token —
 * so the old path is closed by default: the only way to be signed in with
 * Apple is to have actually signed in with Apple, and every boot signs out any
 * Apple login that was let in the old way (dropUnverifiedAppleLogins).
 *
 * APPLE_UNVERIFIED_SIGNIN=on (or 1/true/yes) opens it again, loudly — one
 * warning per request — for the day an old TestFlight phone has to be let in.
 * Anything else, unset included, keeps it closed: a switch that guards a way
 * to forge a sign-in fails closed, and an operator who typed "disabled" meant
 * off. The state is written to the log once at boot so nobody has to guess.
 */
const APPLE_UNVERIFIED_SIGNIN = (() => {
  const raw = String(process.env.APPLE_UNVERIFIED_SIGNIN ?? '').trim().toLowerCase();
  if (['1', 'on', 'true', 'yes'].includes(raw)) return true;
  if (raw && !['0', 'off', 'false', 'no'].includes(raw)) {
    console.warn(`apple: APPLE_UNVERIFIED_SIGNIN=${JSON.stringify(raw.slice(0, 20))} is neither on nor off — treating it as off`);
  }
  return false;
})();
console.log(`  apple: unverified (pre-build-11) Sign in with Apple is ${APPLE_UNVERIFIED_SIGNIN
  ? 'ON — APPLE_UNVERIFIED_SIGNIN lets builds 10 and earlier in unverified' : 'off'}`);

/**
 * Take this profile's Apple token off it, and hand it back to Apple if that
 * is safe.
 *
 * `keepSubject` is for a sign-in with the same Apple ID the token belongs to:
 * that token is returned to the caller to store again, untouched — revoking
 * it would take the brand new sign-in down with it.
 *
 * Otherwise it is revoked, unless another profile is signed in (verified)
 * with the same Apple ID. That device's authorization is the same
 * authorization and still in use, so the token is not revoked — but it is
 * not simply dropped either. If that device holds no token of its own it
 * inherits this one, so that whichever device is last to sign out or be
 * deleted can still end the authorization. Only when every other device
 * already holds a token is this one let go, because nothing is lost.
 */
function retireAppleRefresh(token, why, keepSubject = null) {
  const held = takeAppleRefresh(token);
  if (!held) return null;
  if (keepSubject && held.subject === keepSubject) return held;
  if (appleSubjectLinkedElsewhere(held.subject, token)) {
    if (passAppleRefreshOn(held, token)) {
      console.log(`apple: ${why} — the Apple ID is still signed in on another device, which now holds its token`);
    } else {
      console.log(`apple: ${why} — the Apple ID is still signed in on another device with its own token, so its access stays`);
    }
    return null;
  }
  queueRevocation(held.token, why, held.subject);
  return null;
}

/**
 * Exchange an authorization code for a refresh token, or come back empty.
 *
 * Empty is an answer, not an error: no code, no key configured, Apple slow or
 * saying no — the sign-in or the deletion carries on regardless, and the log
 * says which (Apple's error code only; never the code or a token). A code
 * whose Apple ID is not `subject` is refused here, so neither caller ever
 * stores or revokes a token for somebody it was not asked about. An empty
 * `subject` accepts whoever the code belongs to.
 *
 * `acceptUnknownSubject` is for deletion only. Apple can issue a token whose
 * id_token will not read, leaving its Apple ID unknown (sub ''); the code was
 * minted on the deleting player's own phone a moment ago, and revoking that
 * token is better than losing it. A sign-in never stores one it cannot place.
 */
async function appleRefreshFromCode(rawCode, subject, when, { acceptUnknownSubject = false } = {}) {
  const code = typeof rawCode === 'string' ? rawCode.trim().slice(0, 1024) : '';
  if (!code || !appleRevokeReady) return null;
  try {
    const got = await exchangeCode(code);
    if (!got.sub && acceptUnknownSubject) return got;
    if (subject && got.sub !== subject) {
      console.warn(`apple: ${when} — the authorization code ${got.sub
        ? 'belongs to a different Apple ID' : 'came back without a readable Apple ID'}; not using it`);
      return null;
    }
    return got;
  } catch (err) {
    console.warn(`apple: ${when} — could not exchange the authorization code (${String(err?.message).slice(0, 40)})`);
    return null;
  }
}

/**
 * Sign in with Apple, from the app.
 *
 * Body: token, identityToken (the JWT), authorizationCode, nonce (the raw one
 * — its SHA-256 is what the token carries), nickname, and userId, which is
 * only ever checked against what Apple signed and never believed on its own.
 *
 * The order matters. Nothing about the profile changes until the identity
 * token has been verified. The code is exchanged next, while it is still
 * good. Only then, synchronously and all at once, is the old token dealt with
 * and the login written — so there is no moment in which a request that
 * arrived during the awaits (a sign-out, a deletion) sees half of a sign-in.
 */
app.post('/api/auth/apple', async (req, res) => {
  // `name` still arrives from older apps — it is Apple's copy of the player's
  // real name, and it is ignored. `nickname` is what they call themselves.
  const body = req.body || {};
  const token = String(body.token || '').slice(0, 64);
  const userId = body.userId == null ? '' : String(body.userId);
  const identityToken = typeof body.identityToken === 'string' ? body.identityToken : '';
  if (!identityToken) return legacyAppleSignIn(res, token, userId.slice(0, 128), body.nickname);
  if (!token) return res.status(400).json({ error: 'Missing token' });

  try {
    const existed = !!codeForToken(token);
    let who;
    try {
      who = await verifyIdentityToken(identityToken, {
        nonce: typeof body.nonce === 'string' ? body.nonce.slice(0, 256) : '',
      });
    } catch (err) {
      console.warn(`apple: refused a sign-in (${String(err?.message).slice(0, 60)})`);
      return res.status(401).json({ error: 'Could not verify the Apple sign-in' });
    }
    if (userId && userId !== who.sub) {
      console.warn('apple: refused a sign-in (userId does not match the identity token)');
      return res.status(401).json({ error: 'Could not verify the Apple sign-in' });
    }

    const fresh = await appleRefreshFromCode(body.authorizationCode, who.sub, 'sign-in');

    // Deleted while Apple was being asked. Writing the login now would bring
    // the account straight back, so it is not written — and a token that was
    // just issued for it has nobody left to hold it.
    if (existed && !codeForToken(token)) {
      if (fresh) queueRevocation(fresh.refreshToken, 'account deleted during sign-in', who.sub);
      return res.status(409).json({ error: 'This account was just deleted' });
    }

    // A revocation still waiting for this Apple ID (Apple was down when they
    // signed out, say) would, delivered later, end the authorization this
    // sign-in stands on. It is called off. With no token of its own from this
    // sign-in, the newest one withdrawn is kept instead — same authorization,
    // and the next sign-out or deletion can still revoke it.
    const pending = withdrawQueuedRevocations(who.sub);
    const kept = retireAppleRefresh(token, 'signed in with a different Apple ID', who.sub);
    const appleRefresh = fresh ? { token: fresh.refreshToken, subject: who.sub }
      : kept || (pending[0] ? { token: pending[0], subject: who.sub } : null);
    const linked = attachLogin(token, 'apple', who.sub, body.nickname, { appleRefresh, verified: true });
    res.json({ ok: true, name: linked?.name || '', code: linked?.code });
  } catch (err) {
    console.error('apple: sign-in failed —', String(err?.message).slice(0, 80));
    res.status(500).json({ error: 'Sign in with Apple failed — try again' });
  }
});

/**
 * The pre-build-11 shape: a bare user id. See APPLE_UNVERIFIED_SIGNIN.
 *
 * The login it writes is marked unverified, so it can be told apart from a
 * real one later — except when this very profile is already verified as that
 * same Apple ID (an old TestFlight build on a phone that has since signed in
 * properly), which a repeat of the same claim does not downgrade. It never
 * withdraws a queued revocation: a typed user id must not be able to cancel
 * one.
 */
function legacyAppleSignIn(res, token, userId, nickname) {
  if (!token || !userId) return res.status(400).json({ error: 'Missing token or userId' });
  if (!APPLE_UNVERIFIED_SIGNIN) {
    return res.status(401).json({ error: 'Update MoneyMove to sign in with Apple' });
  }
  console.warn('apple: accepted an UNVERIFIED sign-in from a pre-build-11 app (APPLE_UNVERIFIED_SIGNIN is on)');
  const prev = loginOf(token);
  const stillVerified = prev?.provider === 'apple' && prev.subject === userId && appleLoginVerified(token);
  const kept = retireAppleRefresh(token, 'signed in with a different Apple ID', userId);
  const linked = attachLogin(token, 'apple', userId, nickname, { appleRefresh: kept, verified: stillVerified });
  res.json({ ok: true, name: linked?.name || '', code: linked?.code });
}

/**
 * Apple's server-to-server notifications, for the endpoint registered against
 * the app's Sign in with Apple configuration.
 *
 * Apple posts a signed JWT whenever a player stops using Sign in with Apple
 * for MoneyMove from Apple's side — removing the app under their Apple ID
 * settings (consent-revoked) or deleting the Apple ID (account-deleted).
 * Apple's current documentation names that last one "account-deleted"; older
 * copies of it said "account-delete", so both are accepted. All of
 * them mean the same thing here: every profile signed in with that Apple ID is
 * signed out, and the token it held is dropped without being revoked, since
 * Apple has already done that. The email relay events change nothing we
 * keep and are acknowledged and ignored.
 *
 * Anything that does not verify is a 400. Apple sends JSON; the text parser
 * is only there so a body that arrives under some other content type is
 * still read rather than silently seen as empty.
 */
const APPLE_UNLINK_EVENTS = new Set(['consent-revoked', 'account-deleted', 'account-delete']);

app.post('/api/auth/apple/notifications', express.text({ type: () => true, limit: '16kb' }), async (req, res) => {
  let payload = req.body?.payload;
  if (typeof req.body === 'string') {
    try { payload = JSON.parse(req.body).payload; } catch { payload = req.body.trim(); }
  }
  let event;
  try {
    event = await verifyServerNotification(typeof payload === 'string' ? payload : '');
  } catch (err) {
    console.warn(`apple: refused a server notification (${String(err?.message).slice(0, 60)})`);
    return res.status(400).json({ error: 'Invalid notification' });
  }
  if (APPLE_UNLINK_EVENTS.has(event.type)) {
    const changed = forgetAppleSubject(event.sub, { before: event.eventTime });
    console.log(`apple: ${event.type} — signed out ${changed} profile(s)`);
  }
  res.json({ ok: true });
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
// And any Sign in with Apple revocation that did not get through before the
// last restart picks up where it left off — see the queue in appleid.js.
startAppleRevocationRetries();
// With unverified Apple sign-in switched off, the logins it let in while it
// was on go too — otherwise closing the door would leave everybody who came
// through it signed in for good.
if (!APPLE_UNVERIFIED_SIGNIN) {
  const n = dropUnverifiedAppleLogins();
  if (n) console.warn(`apple: signed out ${n} profile(s) whose Apple sign-in was never verified`);
}

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
    // One coin, one game — and this is the one moment a game begins, which
    // makes it the one place a pass is spent. Not at start(), which a rematch
    // walks through again, and not at the moment the board was picked, which
    // costs somebody a coin for a table that never dealt.
    //
    // Only when the pass is what let this board be dealt. A host who rented
    // Japan on Monday and bought it on Tuesday plays on what they own, and
    // keeps the pass for another night.
    const host = baseToken(room.hostId || '');
    const mapId = String(room.settings?.mapId || '');
    if (host && !mayUseBoard(mapId, walletOf(host)?.owned || [])) {
      consumeRental(host, mapId, room.id);
    }
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

    // A cup table just ended: whoever won goes through, and if that completes
    // the round, the next one is drawn and seated on the spot.
    if (room.cupMatch) {
      // What the two of them were worth when it ended. A bracket with nothing
      // but names beside it tells you who went through and nothing about how
      // close it was; net worth is this game's version of a scoreline.
      const worth = {};
      for (const p of room.players) worth[p.id] = p.bankrupt ? 0 : room.netWorth(p);
      const out = cup.matchFinished(room.id, room.winner?.id, worth);
      if (out?.roundComplete) seatCupMatches();
    }
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
      // What players reported, newest first — codes only.
      reports: reportsView(),
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

// ---- the cup, from the owner's side --------------------------------------
// Everything here is one POST with the key in the body, like every other
// admin action. The read is folded into the dashboard's own state below.
/** The settings the desk sends, whether it is making a cup or changing one. */
const cupSettings = (body = {}) => ({
  name: body.name,
  joinSeconds: body.joinSeconds,
  prize: body.prize,
  // Epoch milliseconds. The desk sends an absolute instant rather than a
  // wall-clock string, so the server never has to guess a timezone.
  opensAt: body.opensAt,
  maxPlayers: body.maxPlayers,
  joinCode: body.joinCode,
  // { times: [minutes past local midnight], windowMinutes, offsetMinutes }.
  // Undefined leaves whatever the cup has; null or an empty list clears it.
  schedule: body.schedule,
});

app.post('/api/admin/cup', (req, res) => {
  if (!adminBodyGuard(req, res)) return;
  const { action } = req.body || {};
  let result;
  switch (action) {
    case 'read':
      result = { ok: true };
      break;
    case 'enable':
      result = cup.setEnabled(!!req.body.enabled);
      audit('cup', 'switch', `tournaments ${result.enabled ? 'ON' : 'off'}`);
      break;
    case 'open':
      result = cup.openCup(cupSettings(req.body));
      if (result.ok) audit('cup', result.cup.id, `made "${result.cup.name}"`);
      break;
    case 'update':
      result = cup.updateCup(String(req.body.cupId || ''), cupSettings(req.body));
      if (result.ok) audit('cup', result.cup.id, `changed "${result.cup.name}"`);
      break;
    case 'openNow':
      result = cup.openDoorsNow(String(req.body.cupId || ''));
      if (result.ok) audit('cup', result.cup.id, 'opened joining early, by hand');
      break;
    case 'close':
      result = cup.closeDoor(String(req.body.cupId || ''));
      if (result.ok) audit('cup', 'doors', result.cancelled ? 'closed with too few entrants' : `closed — ${result.matches} tables`);
      if (result.ok) seatCupMatches();
      break;
    case 'cancel':
      result = cup.cancelCup(String(req.body.cupId || ''));
      if (result.ok) audit('cup', result.cup?.id || 'cup', `deleted "${result.cup?.name || ''}"`);
      break;
    case 'paid':
      result = cup.markPaid(req.body.cupId, req.body.place);
      if (result.ok) audit('cup', req.body.cupId, `${req.body.place} place marked paid`);
      break;
    default:
      result = { error: 'Unknown action' };
  }
  if (result.error) return res.status(400).json(result);
  res.json({ ...result, view: cup.ownerView() });
});

/**
 * Write to the field, or to one player.
 *
 * The one voice the owner has: "round two is at ten", "your prize is on its
 * way". It goes one way — nobody can reply — and a note addressed to somebody
 * also buzzes their phone where push is configured.
 */
app.post('/api/admin/notice', (req, res) => {
  if (!adminBodyGuard(req, res)) return;
  if (req.body?.drop) {
    const gone = dropNotice(req.body.drop);
    return res.status(gone.error ? 400 : 200).json({ ...gone, notices: allNotices() });
  }
  const result = sendNotice({
    text: req.body?.text, title: req.body?.title, toCode: req.body?.code,
  });
  if (result.error) return res.status(400).json(result);
  audit('notice', result.notice.to || 'everyone', String(result.notice.text).slice(0, 120));
  // A note with an address is worth a buzz; one to the whole field is not
  // — a hundred phones lighting up at once is how an app gets muted.
  if (result.token) {
    sendTurnPush(result.token, result.notice.title
      ? `${result.notice.title} — ${result.notice.text}`
      : result.notice.text, { collapseId: 'notice' });
  }
  res.json({ ok: true, notice: result.notice, notices: allNotices() });
});

app.get('/api/admin/notices', (req, res) => {
  if (!adminGuard(req, res)) return;
  res.json({ notices: allNotices() });
});

/**
 * Delete somebody's account on their behalf — the privacy page promises it to
 * anyone who emails their friend code.
 *
 * Apple access is revoked here exactly as it is from the app when a token is
 * on file. When one is not, there is no second sign-in to ask an email for,
 * so the account goes all the same and the log says what could not be done.
 */
app.post('/api/admin/account/delete', async (req, res) => {
  if (!adminBodyGuard(req, res)) return;
  const code = String(req.body?.code || '').trim().toUpperCase();
  const token = tokenForCode(code);
  if (!token) return res.status(400).json({ error: 'No player with that code' });
  try {
    res.json({ ...(await eraseAccount(token, `deleted ${code} on request`)), code });
  } catch (err) {
    console.error('erase: failed', err);
    res.status(500).json({ error: 'Could not delete the account' });
  }
});

/** What players have reported, newest first. Codes only, never tokens. */
app.get('/api/admin/reports', (req, res) => {
  if (!adminGuard(req, res)) return;
  res.json({ reports: reportsView() });
});

app.post('/api/admin/reports/resolve', (req, res) => {
  if (!adminBodyGuard(req, res)) return;
  const result = resolveReport(String(req.body?.id || ''), req.body?.status);
  if (result.error) return res.status(400).json(result);
  audit('report', String(req.body?.id || ''), `marked ${req.body?.status || 'closed'}`);
  res.json({ ...result, reports: reportsView() });
});

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

/**
 * How far back "it was free a moment ago" reaches, for the one sentence a
 * table gets when the calendar turns over under an open lobby. A day, because
 * the rotation is a day wide: anything that was free before that went away for
 * a reason that has nothing to do with midnight.
 */
const ROLLOVER_LOOKBACK_MS = 24 * 60 * 60 * 1000;

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
  // A chat line carries its sender's public friend code, so the person
  // reading it can report or block them. The code, never the token.
  room.hooks.codeOf = (token) => codeForToken(token);
  // Boards are stock. The wallet is read at the moment of the tap rather than
  // cached on the room, because a board bought mid-lobby has to be usable in
  // the same breath — the shop closes and the board is right there.
  //
  // The `_pN` strip is the pass-and-play seats: a second player on one phone
  // gets a token derived from the owner's, and it is the same phone and the
  // same wallet. Without this, buying a board and then handing the chair to
  // Player 2 across the table locks the device out of what it paid for.
  //
  // Owned-or-free first, then the rental book: a one-coin pass is good for one
  // game at THIS table, which is why the room's own id is the second half of
  // the question. Everywhere else the same pass answers no.
  room.hooks.mayUseBoard = (token, mapId) => {
    const base = baseToken(token);
    return mayUseBoard(mapId, walletOf(base)?.owned || [])
      || hasLiveRental(base, mapId, id);
  };
  // And, when the answer is no, why — because the table is told exactly one
  // sentence about it and "the new host" was wrong more often than it was
  // right. Every rented game ended with the rematch lobby blaming a host
  // change that never happened, when the real answer was that the one-game
  // pass had been played, which is the thing the player paid a coin for and
  // is owed a straight account of.
  //
  // Asked here rather than in game.js because all three answers are things
  // only this file knows: the rental book is social.js's and the calendar is
  // boards.js's. An empty string means none of them — the chair really did
  // change hands, which is what settleBoard says by default.
  room.hooks.boardGone = (token, mapId) => {
    const base = baseToken(token);
    const map = String(mapId || '');
    if (rentalSpent(base, map, id)) return 'spent';
    const held = rentalOf(base);
    // A pass is good at one table on one board; holding one that is not this
    // pair is the whole reason this board just went away.
    if (held) return held.roomId === id ? 'other' : 'moved';
    // Nothing to do with a pass, and it was free yesterday: the lobby simply
    // sat across midnight and the rotation moved on under it.
    if (freeBoardsOn(Date.now() - ROLLOVER_LOOKBACK_MS).includes(map)) return 'rollover';
    return '';
  };
  // "Your turn", for somebody who is not looking at the game.
  //
  // Only when every tab and every phone of theirs has gone: a player staring
  // at the board does not need to be told whose turn it is, and a buzz for
  // something already on screen is the fastest way to have notifications
  // switched off for good. Bots and seats a bot is covering are nobody to
  // notify. The sender is dark until APNs credentials exist — until then it
  // says what it would have sent, in the log, which is how this call site can
  // be watched working long before Apple is involved.
  room.hooks.turn = (playerId, live) => {
    const p = live.player(playerId);
    // Not a house player, and not somebody who is out of the game. Being
    // bot-covered is NOT a reason to stay quiet — that flag is set the moment
    // a turn lands on someone who is away, which is the exact person this
    // exists for. Guarding on it meant the nudge only ever fired for people
    // already looking at the board, which is to say never.
    if (!p || p.isBot || p.bankrupt) return;
    if (seatsOf.get(id)?.get(playerId)?.size) return;
    // Collapsed per table: three turns come round while a phone is in a
    // pocket and it should find one notification waiting, not three.
    sendTurnPush(playerId, `Your turn in ${live.map?.name || 'MoneyMove'} — room ${id}`, { collapseId: id });
  };
  // A cup table is only a normal room with a label and a locked lid, and both
  // live in memory. A restart — every deploy is one — would hand the next
  // person to open the link an ordinary room with bots on offer, and the
  // bracket behind it would wait for a result that could never come. So the
  // cup is asked, every time a room is made, whether this id is one of its
  // own. The game inside is gone either way; the match is not.
  const match = cup.matchByRoom(id);
  if (match) dressCupTable(room, match);
  rooms.set(id, room);
  socketsOf.set(id, new Set());
  return room;
}

/** Two seats, no bots, private, and a label the client can read. */
function dressCupTable(room, matchId) {
  room.settings.isPrivate = true;
  room.settings.allowBots = false;
  room.settings.maxPlayers = 2;
  room.cupMatch = matchId;
}

/**
 * Find the quick-match table a player should drop into: the one that already
 * has people waiting (fullest first, so tables fill instead of fragmenting),
 * otherwise a fresh one on a 20-second fuse.
 *
 * A fresh one is also dealt its own house rules — see the roll below. An
 * existing one is not re-rolled: the people sitting in it have already read
 * the table they are waiting for, and changing it under them would make the
 * lobby a thing not worth reading.
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
  // A quick game should not be the same game every time. The board is drawn
  // from what everybody can actually sit down on today — the house board and
  // the two the calendar is giving away — and the house rules are shuffled
  // from the ones the engine already has.
  //
  // Rolled here rather than inside the room because the shelf's calendar
  // lives in boards.js, and game.js does not know what day it is. Only a
  // board that is free for everyone can be dealt: nobody is host yet, and a
  // table strangers cannot join is not a quick match.
  room.makeQuickMatch(
    GameRoom.QUICK_FUSE_SECONDS,
    rollQuickSettings([HOUSE_BOARD, ...freeBoardsOn()]),
  );
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

/**
 * Give every cup match that needs one a table, and start it.
 *
 * A cup table is an ordinary private room with two seats and nobody else
 * allowed in. It is created here rather than by either player, so neither has
 * to be online at the moment the round is drawn: the room waits, and the
 * client walks into it when its owner opens the app.
 */
function seatCupMatches() {
  for (const m of cup.matchesNeedingRooms()) {
    const room = getRoom(newRoomId());
    dressCupTable(room, m.id);
    cup.matchStarted(m.id, room.id);
    console.log(`cup: table ${room.id} for match ${m.id}`);
    // And tell them. The whole design is "turn up inside your window or you
    // are out", and until now the only way to learn the window had opened was
    // to happen to have the app open and watch a poll. In a 256-player cup
    // that is 256 people a round guessing the minute. This is the one message
    // in the app somebody is genuinely waiting for.
    for (const token of [m.a, m.b]) {
      if (token) sendTurnPush(token, 'Your cup match is open — go and play it now', { collapseId: `cup:${room.id}` });
    }
  }
}

/**
 * How long a cup table waits for people who may never come. The doors are
 * shut by then and everyone still in has been sent straight to their table,
 * so this is generous rather than tight — but it is finite, because one
 * empty table otherwise holds up every other player's evening.
 */
const CUP_NO_SHOW_MS = 8 * 60 * 1000;
/** How long before a door shuts anybody still missing gets one last nudge. */
const CUP_LAST_CALL_MS = 3 * 60 * 1000;

/**
 * Tables nobody opened. A match that has started playing is left completely
 * alone however long it runs — games are long, and the sweeper has no
 * business inside one. This only ever looks at tables still in the lobby.
 */
function sweepCupNoShows() {
  const now = Date.now();
  for (const m of cup.playingMatches()) {
    // A table this process has never heard of is not an empty table.
    //
    // Rooms live in memory and memory does not survive a deploy, and Render
    // deploys constantly. Every match that was being played when the process
    // went down comes back pointing at a room id nobody holds — and read as
    // "neither player came", which voided every live game in the round and
    // then abandoned the whole cup, seconds after boot, before a single
    // player could reconnect. Rebuild the table instead: getRoom re-dresses
    // it as a cup table, and the two who were drawn can walk back into it.
    if (!rooms.has(m.roomId)) {
      getRoom(m.roomId);              // re-dressed as this match's table
      console.log(`cup: rebuilt ${m.roomId} after a restart`);
      continue;
    }
    // Every cup game runs to a clock — ninety minutes by default, and never
    // past the moment the next round is due. A property game has no natural
    // length, and a tournament needs one, so at the whistle it is decided the
    // way every timed sport decides one: whoever is ahead. Net worth is this
    // game's score.
    const room = rooms.get(m.roomId);
    if (m.decideAt && now >= m.decideAt && room?.status === 'playing') {
      const worth = (p) => (p.bankrupt ? 0 : room.netWorth(p));
      const standing = room.players.filter((p) => !p.bankrupt)
        .sort((a, b) => worth(b) - worth(a));
      const behind = standing[standing.length - 1];
      if (behind && standing.length > 1) {
        console.log(`cup: ${m.roomId} ran into the next round — decided on net worth`);
        room.quit(behind.id);   // the normal game-end path records it in the cup
      }
      continue;
    }

    // Three minutes before a scheduled door shuts, anybody not yet in their
    // seat gets one last nudge. This is the only reminder that needs to know
    // who is actually in the room, which is why it lives here and not with
    // the others in the tournament's own calendar.
    if (m.deadline && !m.toldLast && now >= m.deadline - CUP_LAST_CALL_MS && now < m.deadline) {
      cup.noteLastCall(m.id);
      const mins = Math.max(1, Math.round((m.deadline - now) / 60000));
      for (const token of [m.a, m.b]) {
        if (token && !room?.player(token)) {
          sendTurnPush(token, `${mins} minute${mins === 1 ? '' : 's'} left to take your seat — miss it and you are out of the cup.`,
            { collapseId: `cup:last:${m.roomId}` });
        }
      }
    }

    // A scheduled round shuts its own door; everything else waits the flat
    // eight minutes it always did.
    const due = m.deadline ? now >= m.deadline : now - (m.startedAt || 0) >= CUP_NO_SHOW_MS;
    if (!due) continue;
    if (room && room.status !== 'lobby') continue;   // being played: not our business
    const came = [m.a, m.b].filter((token) => room?.player(token));
    if (came.length >= 2) continue;                  // both there, the table will start itself
    const winner = came.length === 1 ? came[0] : null;
    const out = cup.forfeit(m.roomId, winner);
    console.log(winner
      ? `cup: walkover in ${m.roomId} — the other player never came`
      : `cup: ${m.roomId} voided — neither player came`);
    if (out?.roundComplete) seatCupMatches();
  }
}

// Today's exchange rates, so a prize written in dollars can be read in the
// money the player actually uses. Once at boot and once a day after that;
// until it lands, everybody simply sees the owner's own figure.
refreshRates();
setInterval(refreshRates, 6 * 60 * 60 * 1000).unref?.();

// The join window closes on its own clock, and the moment it does the first
// round needs tables.
setInterval(() => {
  try {
    cup.tick();
    // Sweep BEFORE seating. The other order judged a table in the same tick
    // it was created in, which is how a deploy that spanned a round's window
    // could seat four dead tables and void all four microseconds later.
    sweepCupNoShows();
    seatCupMatches();
    // Then say whatever the calendar has to say: the draw, a quarter of an
    // hour's warning, and how somebody's tournament ended.
    for (const r of cup.remindersDue()) sendTurnPush(r.token, r.text, { collapseId: r.collapseId });
    cup.prune();
  } catch (e) { console.warn('cup tick:', e.message); }
}, 5000).unref?.();

// Reap idle rooms every couple of minutes — bots playing to an empty
// theatre burn a timer a second for nobody.
/**
 * Is anything at all still due to happen to this table?
 *
 * Every way a game moves itself on is a timer hanging off the room: the shot
 * clock, the bot, the auction countdown, a held seat. None pending, with the
 * game still marked as playing, means it has stopped.
 */
function roomHasWork(room) {
  if (room.auction) return true;
  for (const t of Object.values(room.timers || {})) {
    if (t && typeof t === 'object') return true;
  }
  return false;
}

setInterval(() => {
  // A socket that left without a goodbye would otherwise keep its last state
  // alive forever; io still knows who is actually in the building.
  for (const sid of deltaOf.keys()) {
    if (!io.sockets.sockets.has(sid)) deltaOf.delete(sid);
  }
  for (const [id, room] of rooms) {
    const live = socketsOf.get(id)?.size || 0;
    const idleFor = Date.now() - (room.lastSeen || room.createdAt);

    // ---- the watchdog ----------------------------------------------------
    // The turn loop stays alive by about eight conditions holding at once,
    // spread across the shot clock, the bot driver, the auction and the seat
    // grace. Each one is individually careful and the same mistake has now
    // been found in four of them. So rather than trust all eight for ever,
    // ask the only question that actually matters: is anything at all due to
    // happen to this table?
    //
    // If a game is running, somebody is in the room, and there is not one
    // pending timer anywhere on it, then nothing will ever move again. A bare
    // nextTurn() is enough and it heals permanently — the turn landing on an
    // absent chair is exactly what marks that chair bot-covered, which is the
    // cover the seat could not be given before.
    if (room.status === 'playing' && live > 0 && !roomHasWork(room)) {
      const stuck = (room.stalledSince ||= Date.now());
      if (Date.now() - stuck > 20_000) {
        room.stalledSince = null;
        console.warn(`room ${id}: nothing was due to happen — poking the turn on`);
        try { room.nextTurn(); } catch (err) { console.error(`room ${id}: poke failed:`, err); }
      }
    } else {
      room.stalledSince = null;
    }
    // A table nobody is watching holds still by itself now, so letting it sit
    // costs nothing but the object. Give people a real chance to come back to
    // the game they were in — a lunch break, a train tunnel — and only then
    // call it over. The room itself lingers for the usual half hour.
    // Nobody who is actually IN this game is attached. Counting raw sockets
    // meant a stranger who followed a link to a full table — seated nowhere,
    // in none of the room's own collections — kept the room alive for ever,
    // so the one table that had genuinely been abandoned was the one table
    // that could never be cleaned up.
    const anyPlayerHere = room.players.some((p) => !p.isBot && p.connected);
    if (!anyPlayerHere && room.status === 'playing' && idleFor > 10 * 60 * 1000) {
      // A cup table cannot just be switched off. The result is recorded by
      // recordTransitions, which only ever runs from broadcast() — so ending
      // one here left its match "playing" for ever, invisible to the sweeper
      // (which skips anything not in a lobby) until the room was deleted and
      // both entrants were voided with no net-worth decision at all. Decide
      // it properly: whoever is ahead when the lights go out goes through.
      if (room.cupMatch) {
        const worth = (p) => (p.bankrupt ? 0 : room.netWorth(p));
        const standing = room.players.filter((p) => !p.bankrupt).sort((a, b) => worth(b) - worth(a));
        if (standing.length > 1) {
          console.log(`cup: ${id} went quiet — decided on net worth`);
          room.quit(standing[standing.length - 1].id);
          continue;
        }
      }
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
    // A cup table has exactly two chairs and both have names on them. The
    // link is private, but a link can be forwarded, and a match somebody's
    // friend sat down at is not a match. Everyone else may watch, which is
    // what the ordinary full-table path already does.
    const cupOutsider = !!room.cupMatch && !room.player(playerId)
      && !cup.mayPlay(room.cupMatch, playerId);
    socket.join(roomId);
    socketsOf.get(roomId).add(socket.id);
    claimSeat(roomId, playerId, socket.id);
    setPresence(playerId, roomId, room.status);
    profileFor(playerId, { name, flag });
    room.lastSeen = Date.now();

    if (room.player(playerId)) {
      room.reconnect(playerId);
    } else if (cupOutsider) {
      socket.emit('joinFailed', {
        message: 'This is a cup table — the two players were drawn for it',
        spectate: true,
      });
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
    // A cup match starts itself. Both players were drawn for it and both are
    // now sitting at it; making one of them press a button first is a chance
    // for the other to wait, wonder, and leave.
    if (room.cupMatch && room.status === 'lobby' && room.players.length >= 2) {
      room.start(room.hostId);
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
  socket.on('settings', guard((d = {}) => {
    // The cup sets its own table: two seats, no bots, private.
    if (room.cupMatch) return fail('A cup table is set by the cup');
    // A locked board comes back as an error rather than silently doing
    // nothing, so a client that has fallen behind the day's rotation says
    // why instead of appearing to ignore the tap.
    ok(room.updateSettings(playerId, d));
  }));
  socket.on('addBot', guard(() => {
    if (playerId !== room.hostId) return fail('Only the host can add bots');
    // A cup match is between the two who were drawn. A house player at that
    // table is a free win, so there is no house player at that table.
    if (room.cupMatch) return fail('Not at a cup table');
    ok(room.addBot());
  }));
  // Clients only ever see other players as aliases, so any id that names
  // someone else is translated back to the real token at the door. A caller's
  // own real token still passes through untouched — see GameRoom.resolveId.
  socket.on('kick', guard((targetId) => {
    if (playerId !== room.hostId) return fail('Only the host can remove players');
    // Removing your opponent is not a way to win a cup match.
    if (room.cupMatch) return fail('Not at a cup table');
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
  // One press for a whole country — see GameRoom.buildAll for why the button
  // exists at all.
  socket.on('buildAll', onTurn((group) => ok(room.buildAll(playerId, String(group || '')))));
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
    // A cup match is played once. The result is already in the bracket, and a
    // second game at that table would settle nothing and confuse everyone.
    if (room.cupMatch) return fail('A cup match is played once');
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
