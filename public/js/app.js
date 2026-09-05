// Entry point: identity, landing screen, socket wiring and the render loop.

import {
  renderBoard, patchBoard, resetBoard, highlightTiles,
  syncTokens, repositionTokens, deedMarkup, syncUndealt, dealBoardIn,
} from './board.js';
import {
  renderPlayers, renderRightPanel, renderCenter, renderLog, renderChat,
  renderDice, toast, showCard, showGameOver, closeModal, showTurnBanner,
  confetti, openDeedModal, openHelpModal, openStoreModal, openJoinNameModal,
  openLeaveModal, showRemovedOverlay, randomName, syncTurnClock, syncOpenModals,
  renderAwaiting, openReportCard, setAdsConfig, openLeaderboardModal,
  openAchievementsModal, leaderRowsHTML, openTradeOfferModal, isModalOpen, openCupBracket, openCupPoster, cupMoney,
} from './ui.js';
import { icon } from './icons.js';
import { sfx, setEnabled, isEnabled, unlock } from './sound.js';
import {
  api, connect, isSplitDeploy, SERVER, useServer, forgetServer, PROTO, onState,
} from './net.js';
import { initSocial, stopSocial } from './social.js';

const $ = (s) => document.querySelector(s);

// index.html names its glyphs with data-ico instead of typing an emoji, so the
// markup stays free of another vendor's artwork and every drawing comes from
// icons.js. Prepending rather than replacing lets a chip keep its own label.
document.querySelectorAll('[data-ico]').forEach((el) => {
  const solo = !el.textContent.trim();   // nothing but the glyph — centre it
  el.insertAdjacentHTML('afterbegin', icon(el.dataset.ico, null, solo ? 'solo' : ''));
});

// ─────────────────────────────────────────────────────────────── identity ──
// Normally your seat lives in localStorage, so a refresh drops you back into the
// same game. Opening a window with #newplayer gives that tab its own identity in
// sessionStorage instead, which is what makes pass-and-play on one machine work.
const TOKEN_KEY = 'moneymove:token';
const NAME_KEY = 'moneymove:name';
const newId = () => `u_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

// Browsers with site data blocked make every storage call THROW — the app
// must still boot (with a per-tab identity) instead of dying at module scope.
const safeGet = (s, k) => { try { return s.getItem(k); } catch { return null; } };
const safeSet = (s, k, v) => { try { s.setItem(k, v); } catch { /* storage blocked */ } };

if (location.hash === '#newplayer') {
  safeSet(sessionStorage, TOKEN_KEY, newId());
  safeSet(sessionStorage, NAME_KEY, '');
  history.replaceState({}, '', location.pathname);
}

let token = safeGet(sessionStorage, TOKEN_KEY) || safeGet(localStorage, TOKEN_KEY);
if (!token) {
  token = newId();
  safeSet(localStorage, TOKEN_KEY, token);
}
const isLocalGuest = !!safeGet(sessionStorage, TOKEN_KEY);
const storeName = (name) => safeSet(isLocalGuest ? sessionStorage : localStorage, NAME_KEY, name);
let nickname = (isLocalGuest ? safeGet(sessionStorage, NAME_KEY) : safeGet(localStorage, NAME_KEY)) || '';

const FLAG_KEY = 'moneymove:flag';
const storeFlag = (f) => safeSet(isLocalGuest ? sessionStorage : localStorage, FLAG_KEY, f);
let myFlag = (isLocalGuest ? safeGet(sessionStorage, FLAG_KEY) : safeGet(localStorage, FLAG_KEY)) || '';

// ────────────────────────────────────────────────────────────────── state ──
let socket = null;
let state = null;
let meId = token;
let roomId = null;
let lastCardAt = 0;
let lastLogAt = 0;
let lastTurnId = null;
let winnerShown = false;
let removedShown = false;
// The status of the last state rendered. The deal-in flourish belongs to a
// kick-off actually watched — a lobby turning into a game across two pushes —
// never to a reconnect or a mid-game join, whose first state is already
// 'playing' and must show the board instantly.
let lastStatus = null;
// Set while walking back into a table left mid-game. The server opens a room
// for any code asked of it, so an abandoned table comes back as an empty lobby
// wearing the old code — read once, on the first state, to say so out loud.
let resuming = false;

// ──────────────────────────────────────────────────────────────── actions ──
const emit = (evt) => (...args) => socket?.emit(evt, ...args);
const actions = {
  start: emit('start'),
  addBot: emit('addBot'),
  setTeam: (playerId, team) => socket?.emit('team', team, playerId),
  balanceTeams: emit('balanceTeams'),
  kick: emit('kick'),
  settings: emit('settings'),
  appearance: (d) => {
    if (d.name) storeName(d.name);
    if (d.flag !== undefined) { myFlag = d.flag; storeFlag(d.flag); }
    socket?.emit('appearance', d);
  },
  roll: emit('roll'),
  buy: emit('buy'),
  skipBuy: emit('skipBuy'),
  bid: emit('bid'),
  passBid: emit('passBid'),
  endTurn: emit('endTurn'),
  jailPay: emit('jailPay'),
  jailCard: emit('jailCard'),
  build: emit('build'),
  sellHouse: emit('sellHouse'),
  mortgage: emit('mortgage'),
  unmortgage: emit('unmortgage'),
  proposeTrade: emit('trade:propose'),
  respondTrade: (id, accept) => socket?.emit('trade:respond', { id, accept }),
  cancelTrade: (id) => socket?.emit('trade:cancel', { id }),
  ignoreTrade: (id, ignored = true) => socket?.emit('trade:ignore', { id, ignored }),
  tradeViewing: (id, viewing) => socket?.emit('trade:viewing', { id, viewing }),
  payDebt: emit('payDebt'),
  bankrupt: emit('bankrupt'),
  quit: emit('quit'),
  grantTime: (id) => socket?.emit('grantTime', { id }),
  chat: emit('chat'),
  rematch: emit('rematch'),
  makeHost: (id) => socket.emit('makeHost', { id }),
  // A matchmade table breaks up when it ends — going again means finding
  // strangers, not reconvening the ones you just played.
  newTable: () => {
    forgetGame(roomId);
    goHome();
    setTimeout(() => $('#quickBtn')?.click(), 120);
  },
  // A finished board is a dead end without a way off it, so the result sheet
  // and the well can both send you home.
  goHome: () => {
    forgetGame(roomId);
    goHome();
  },
};

// ──────────────────────────────────────────────────────────────── landing ──
function showLanding() {
  $('#landing').classList.remove('hidden');
  $('#app').classList.add('hidden');
  // A name you picked before is yours again; a first visit gets an empty field
  // and its placeholder, never a name someone else chose for you.
  $('#nickInput').value = nickname || '';

  // Tables stepped away from mid-game get a way back in; finished ones
  // keep their report cards.
  renderResumeList();
  renderRecentGames();

  refreshWallet();
  // Rewarded-ads switchboard — dark today, one env var away from live.
  fetch(api('/api/ads/config')).then((r) => r.json()).then(setAdsConfig).catch(() => {});
  refreshProfileChip();
  refreshDaily();
  watchCup();
  refreshLeaderboard();
  watchPublicRooms();
  initGoogleSignIn();
  initSocial({
    token, name: nickname, flag: myFlag,
    onToast: toast,
    onJoin: (id) => go(id),
  });
}

// ---- store, coins & karma ------------------------------------------------
let knownCoins = null;

async function refreshWallet({ celebrate = false } = {}) {
  try {
    const w = await fetch(api(`/api/wallet?token=${encodeURIComponent(token)}`)).then((r) => r.json());
    if (typeof w.coins !== 'number') return;
    const chip = $('#coinChip');
    if (chip) chip.innerHTML = `${icon('coin')} ${w.coins}`;
    // Karma only ever goes down by walking out, so it sits beside the coins as
    // a reminder rather than a score to chase.
    const karma = $('#karmaChip');
    if (karma && typeof w.karma === 'number') {
      karma.innerHTML = `${icon('heart')} ${w.karma} karma`;
      karma.classList.toggle('low', w.karma < 60);
      karma.classList.remove('hidden');
    }
    if (celebrate && knownCoins != null && w.coins > knownCoins) {
      toast(`+${w.coins - knownCoins} coin${w.coins - knownCoins > 1 ? 's' : ''} earned — spend them in the Store!`);
    }
    knownCoins = w.coins;
  } catch { /* server nap — the chip just stays put */ }
}

$('#storeBtn').addEventListener('click', () => {
  sfx.click();
  // Spending in the shop has to show on the chip you spent it from.
  openStoreModal(token, (coins) => {
    knownCoins = coins;
    const chip = $('#coinChip');
    if (chip) chip.innerHTML = `${icon('coin')} ${coins}`;
  });
});

/**
 * Coins landing in your hand, rather than a number that was one thing and is
 * now another. A repaint reads as the page reloading; a count-up reads as pay.
 */
function countCoinChip(from, to) {
  const chip = $('#coinChip');
  if (!chip) return;
  const paint = (n) => { chip.innerHTML = `${icon('coin')} ${n}`; };
  // Someone who asked for less motion gets the number, not the ride.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) return paint(to);
  chip.classList.add('minted');
  setTimeout(() => chip.classList.remove('minted'), 900);
  const started = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - started) / 700);
    paint(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  return requestAnimationFrame(step);
}

// ---- the daily reward ----------------------------------------------------
// A card that only ever speaks when it has something to say: coins waiting, or
// a countdown to the next lot. An unknown player and a sleeping server both
// leave the landing exactly as they found it — this is a gift, not a nag.
let dailyClock = null;
// How many times running the countdown has run out while the server still says
// "claimed today" — a device whose clock leads the server's, not a new day.
let dailyLate = 0;

function stopDailyClock() {
  clearTimeout(dailyClock);
  clearInterval(dailyClock);
  dailyClock = null;
}

// The purse starts at a single coin and climbs a coin a day, so every line
// that prints it has to be able to say "coin" as well as "coins".
const coinWord = (n) => `${n} coin${n === 1 ? '' : 's'}`;

/** "07:12:44" — hours first, because the wait is always most of a day. */
function untilText(at) {
  const ms = Math.max(0, at - Date.now());
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, '0')).join(':');
}

function paintDaily(d) {
  const card = $('#dailyCard');
  if (!card) return;
  stopDailyClock();
  // Nothing collectable and nothing to count down to: stay out of the way.
  // Signed out is not that case — there is something to collect, behind a
  // door — so it is answered further down.
  if (!d || (!d.claimable && !d.nextAt && d.signedIn !== false)) {
    card.classList.add('hidden'); dailyLate = 0; return;
  }

  const streak = Number(d.streak) || 0;
  const amount = Number(d.amount) || 0;
  const streakChip = streak > 0
    ? `<span class="dc-streak" title="${streak} day${streak > 1 ? 's' : ''} in a row">${icon('flame', 13)}${streak}</span>`
    : '';

  card.classList.toggle('done', !d.claimable && d.signedIn !== false);
  // Signed out, the coin is not gone — it is behind an account, and saying
  // which is the difference between a locked door and a broken one.
  if (d.signedIn === false) {
    card.classList.remove('hidden', 'done');
    card.innerHTML = `<div class="dc-head">
        <span class="dc-mark">${icon('coin', 22, 'solo')}</span>
        <div class="dc-body">
          <div class="dc-title">Daily reward</div>
          <div class="dc-sub">Sign in and it is yours every day — and your coins
            follow you to any device.</div>
        </div>
      </div>
      <button class="btn wide wrap" id="dailySignIn">${icon('key', 15)} Sign in to collect</button>`;
    const go = $('#dailySignIn');
    if (go) {
      go.onclick = () => {
        sfx.click();
        const row = $('#authRow');
        row?.classList.remove('hidden');
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Google's own button is the only thing that can start the flow, so
        // point at it rather than pretending this button is it.
        const btn = row?.querySelector('#googleSignIn div[role=button], #googleSignIn div');
        btn?.classList.add('nudge');
        setTimeout(() => btn?.classList.remove('nudge'), 1600);
      };
    }
    return;
  }
  card.innerHTML = d.claimable
    ? `<div class="dc-head">
        <span class="dc-mark">${icon('coin', 22, 'solo')}</span>
        <div class="dc-body">
          <div class="dc-title">Daily reward</div>
          <div class="dc-sub">${streak > 0
            ? `Day ${streak + 1} of your streak — miss a day and it starts again`
            : 'Free coins, every day you turn up'}</div>
        </div>
        ${streakChip}
      </div>
      <button class="btn gold wide wrap" id="dailyBtn">
        <span class="btn-ico">${icon('coin')}</span> Collect your daily ${coinWord(amount)}
      </button>`
    : `<div class="dc-head">
        <span class="dc-mark quiet">${icon('snooze', 22, 'solo')}</span>
        <div class="dc-body">
          <div class="dc-title">Back tomorrow</div>
          <!-- Tomorrow's payout climbs with the streak, and only the server
               knows by how much. Until it has said, the line promises coins
               without naming a figure rather than naming the wrong one. -->
          <div class="dc-sub">${amount > 0
            ? `${amount} more coin${amount === 1 ? '' : 's'}`
            : 'More coins'} in <b id="dailyClock">${untilText(d.nextAt)}</b></div>
        </div>
        ${streakChip}
      </div>`;
  card.classList.remove('hidden');

  if (d.claimable) {
    dailyLate = 0;
    $('#dailyBtn').onclick = claimDaily;
    return;
  }
  // Midnight is a real deadline, so the card counts down to it rather than
  // showing whatever the gap happened to be when the page loaded.
  if (d.nextAt - Date.now() > 0) {
    dailyLate = 0;
    dailyClock = setInterval(() => {
      const el = $('#dailyClock');
      if (!el) return stopDailyClock();
      if (d.nextAt - Date.now() <= 0) { stopDailyClock(); return refreshDaily(); }
      el.textContent = untilText(d.nextAt);
      return undefined;
    }, 1000);
    return;
  }
  // The clock has run out and the server still says today: this device is
  // ahead of it, not into tomorrow. Asking again on the second would poll for
  // as long as the two disagree, so each attempt waits twice as long as the
  // last — a minute at worst, and no clock a phone actually carries is
  // anywhere near that far out.
  dailyLate = Math.min(dailyLate + 1, 6);
  dailyClock = setTimeout(refreshDaily, 1000 * 2 ** dailyLate);
}

function refreshDaily() {
  fetch(api(`/api/daily?token=${encodeURIComponent(token)}`))
    .then((r) => r.json())
    .then(paintDaily)
    .catch(() => paintDaily(null));
}

async function claimDaily() {
  const btn = $('#dailyBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(api('/api/daily/claim'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const out = await res.json();
    // 409 is an eager client, not a broken one — the card just catches up. The
    // refusal carries no figure for tomorrow, so the card asks for one rather
    // than printing the nothing it was handed.
    if (!res.ok || !out.ok) {
      if (res.status === 409) { paintDaily({ claimable: false, streak: out.streak, nextAt: out.nextAt }); refreshDaily(); }
      else if (res.status === 401) { toast('Sign in first — the daily coin needs an account'); refreshDaily(); }
      else toast(out.error || 'Could not collect today\'s coins', 'error');
      return;
    }
    sfx.gain();
    countCoinChip(knownCoins ?? Math.max(0, out.coins - out.amount), out.coins);
    knownCoins = out.coins;
    toast(out.streak > 1
      ? `+${coinWord(out.amount)} — ${out.streak} days in a row`
      : `+${coinWord(out.amount)} collected`);
    // The card flips the moment the coins land, but without a figure on it:
    // the claim only reports what today paid, and today's streak has already
    // made tomorrow worth more. The read behind the count-up fills the number
    // in. Same trip refreshes the wallet, since the claim moved the karma
    // chip's neighbour.
    paintDaily({ claimable: false, streak: out.streak, nextAt: out.nextAt });
    setTimeout(() => { refreshWallet(); refreshDaily(); }, 900);
  } catch {
    toast('Could not reach the server — try again in a moment', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---- the leaderboard -----------------------------------------------------
// Public by construction on the server's side: friend codes and lifetime
// totals. Five rows here, all fifty behind "See all".
let myCode = '';

function refreshLeaderboard() {
  const card = $('#leaderCard');
  if (!card) return;
  Promise.all([
    fetch(api('/api/leaderboard')).then((r) => r.json()),
    fetchMe(),
  ]).then(([data, me]) => {
    const top = Array.isArray(data?.top) ? data.top : [];
    myCode = me?.code || '';
    card.innerHTML = `
      <div class="fc-head">
        <span class="panel-title" style="margin:0">${icon('trophy')} Leaderboard</span>
        ${top.length > 5 ? '<button class="btn tiny" id="lbAll" type="button">See all</button>' : ''}
      </div>
      ${top.length
        ? `<div class="lb-list">${leaderRowsHTML(top.slice(0, 5), myCode)}</div>`
        : `<div class="empty small">Nobody has won a game yet — the first table to
            finish opens this list.</div>`}`;
    card.classList.remove('hidden');
    const all = $('#lbAll');
    if (all) all.onclick = () => { sfx.click(); openLeaderboardModal(top, myCode); };
  }).catch(() => { /* server nap — the landing keeps its other cards */ });
}

// ---- sign in with Google (only when the server has a client id) ----------
let googleInitDone = false;
/**
 * The signed-in state, made visible: a photo chip by the theme buttons with
 * the account behind it one tap away. Signing in used to change almost
 * nothing on screen, which read as the button not working.
 */
// One read of /api/me per visit to the landing, shared by everything that
// needs to know who this browser is — the chip, and the leaderboard row that
// has to be picked out as yours.
let mePromise = null;
function fetchMe(fresh = false) {
  if (fresh || !mePromise) {
    mePromise = fetch(api(`/api/me?token=${encodeURIComponent(token)}`))
      .then((r) => r.json()).catch(() => null);
  }
  return mePromise;
}

async function refreshProfileChip() {
  const chip = $('#profileChip');
  const menu = $('#profileMenu');
  if (!chip) return;
  const me = await fetchMe(true);
  if (!me) return;
  if (!me.provider) {
    chip.classList.add('hidden');
    menu.classList.add('hidden');
    return;
  }
  const initial = (me.name || '?').trim()[0]?.toUpperCase() || '?';
  const photo = me.picture
    ? `<img src="${me.picture.replace(/"/g, '')}" alt="" referrerpolicy="no-referrer" />`
    : initial;
  chip.innerHTML = photo;
  chip.classList.remove('hidden');
  // A signed-in device doesn't need to be sold the sign-in button again.
  $('#authRow')?.classList.add('hidden');

  chip.onclick = () => {
    if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
    menu.innerHTML = `
      <div class="pm-head">
        <span class="pm-photo">${photo}</span>
        <span>
          <div class="pm-name">${escapeText(me.name || 'Player')}</div>
          ${me.email ? `<div class="pm-mail">${escapeText(me.email)}</div>` : ''}
        </span>
      </div>
      <div class="pm-row"><span>Friend code</span><b>${escapeText(me.code || '')}</b></div>
      <div class="pm-row"><span>Coins</span><b>${Number(me.coins) || 0}</b></div>
      <div class="pm-row"><span>Karma</span><b>${Number(me.karma) || 0}</b></div>
      <div class="pm-row"><span>Signed in with</span><b>${me.provider === 'apple' ? 'Apple' : 'Google'}</b></div>
      <div class="pm-actions">
        <button class="btn small wide" id="pmShelf">${icon('trophy')} Your shelf</button>
      </div>
      <div class="pm-actions">
        <button class="btn small wide" id="pmSignOut">Sign out</button>
      </div>`;
    menu.classList.remove('hidden');
    // Titles are collected across games and kept for good, so they live with
    // the account rather than with any one table's report card.
    $('#pmShelf').onclick = () => {
      sfx.click();
      menu.classList.add('hidden');
      openAchievementsModal(token);
    };
    $('#pmSignOut').onclick = async () => {
      try {
        await fetch(api('/api/auth/logout'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
      } catch { /* the chip check below sorts it out */ }
      menu.classList.add('hidden');
      $('#authRow')?.classList.remove('hidden');
      toast('Signed out — your seat, coins and friends stay with this device');
      refreshProfileChip();
    };
  };
  // A tap anywhere else folds the menu away.
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== chip && !chip.contains(e.target)) {
      menu.classList.add('hidden');
    }
  });
}

const escapeText = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function initGoogleSignIn() {
  if (googleInitDone) return;
  fetch(api('/api/auth/config')).then((r) => r.json()).then((cfg) => {
    if (!cfg.google || !cfg.googleClientId) return; // not configured — stay hidden
    googleInitDone = true;
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => {
      $('#authRow').classList.remove('hidden');
      window.google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: async (resp) => {
          try {
            const out = await fetch(api('/api/auth/google'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // What this browser already calls itself, so signing in never
              // renames somebody who had just typed a name in the box.
              body: JSON.stringify({ token, credential: resp.credential,
                                     nickname: ($('#nickInput')?.value || '').trim() }),
            }).then((r) => r.json());
            if (out.ok) {
              if (out.name) { $('#nickInput').value = out.name; storeName(out.name); }
              $('#authStatus').textContent = `Signed in as ${out.name || 'you'} · code ${out.code || ''}`;
              toast('Signed in with Google');
              refreshProfileChip();
            } else {
              toast(out.error || 'Sign-in failed', 'error');
            }
          } catch {
            toast('Sign-in failed', 'error');
          }
        },
      });
      window.google.accounts.id.renderButton($('#googleSignIn'), { theme: 'outline', size: 'large', shape: 'pill' });
    };
    document.head.appendChild(s);
  }).catch(() => { /* server offline — landing still works */ });
}

// Open tables come and go while someone is still reading the landing, so the
// list keeps itself honest instead of showing whatever was true on arrival.
let roomsTimer = null;
// What the last poll saw, so a remembered game can say whether it is still on.
let liveRooms = new Map();

/**
 * Every public table, not only the ones still filling up. A game already under
 * way can't be joined — but "there is a game on right now" is a far better
 * thing to read than an empty box, so it is listed and labelled as what it is.
 */
function loadRoomList() {
  fetch(api('/api/rooms')).then((r) => r.json()).then((rooms) => {
    if (!Array.isArray(rooms)) return;
    // The same answer settles which remembered games are still there.
    pruneGamesAgainst(rooms);
    renderResumeList();

    const el = $('#publicRooms');
    // Don't paint over the "can't reach the server" panel that shares this slot.
    if (el.querySelector('.server-down')) return;
    if (!rooms.length) {
      el.innerHTML = `<div class="pr-title">All rooms</div>
        <div class="empty small">Not a single table open right now — yours would be the
          first. <button class="link-btn" id="prPlayNow" type="button">Play now</button>
          opens one, and it shows up here for everyone else.</div>`;
      $('#prPlayNow').onclick = () => $('#quickBtn').click();
      return;
    }
    el.innerHTML = '<div class="pr-title">All rooms</div>' + rooms.map((r) => {
      const playing = r.status === 'playing';
      const label = r.joinable ? 'Join' : playing ? 'In progress' : 'Full';
      const title = r.joinable ? `Take a seat at ${r.map}`
        : playing ? 'Already under way — you can watch this one'
        : 'Every seat is taken — you can watch this one';
      return `<button class="public-room ${r.joinable ? '' : 'busy'}" data-room="${escapeHtml(r.id)}"
          title="${escapeHtml(title)}">
        <span class="pr-name">${r.quick ? icon('bolt') : ''}${escapeHtml(r.map)}</span>
        <span class="pr-meta">
          <span class="dim">${r.players}/${r.maxPlayers} · ${escapeHtml(r.id)}</span>
          <i class="pr-tag ${r.joinable ? 'open' : 'busy'}">${label}</i>
        </span>
      </button>`;
    }).join('');
    el.querySelectorAll('[data-room]').forEach((c) => { c.onclick = () => go(c.dataset.room); });
  }).catch(() => {});
}

function watchPublicRooms() {
  clearInterval(roomsTimer);
  // A "can't reach the server" panel from an earlier attempt shares this slot
  // and the poll leaves it alone; arriving at the landing clears the slate.
  $('#publicRooms').innerHTML = '';
  loadRoomList();
  roomsTimer = setInterval(loadRoomList, 8000);
}

function go(id) {
  history.pushState({}, '', `/room/${id}`);
  boot();
}

$('#nickInput').addEventListener('change', (e) => {
  nickname = e.target.value.trim().slice(0, 16);
  storeName(nickname);
});

// Nobody should be stuck at the door for want of a nickname.
$('#nameDiceBtn').addEventListener('click', async () => {
  sfx.click();
  const name = await randomName();
  $('#nickInput').value = name;
  nickname = name;
  storeName(name);
});

const takeNickname = () => {
  nickname = $('#nickInput').value.trim().slice(0, 16) || 'Player';
  storeName(nickname);
};

/**
 * Both landing buttons do the same dance: a throwaway socket asks the server
 * for a room id, then boot() opens the real one. Nothing here may dead-end —
 * every way out puts the button back so the rest of the landing stays usable.
 */
function askForRoom(btn, busyLabel, event) {
  // Both buttons ask the same server for the same thing, so a second press on
  // the other one only opens a table nobody ever sits at.
  const others = [$('#quickBtn'), $('#createBtn')].filter((b) => b && b !== btn);
  btn.disabled = true;
  others.forEach((b) => { b.disabled = true; });
  btn.dataset.label ||= btn.innerHTML;
  btn.innerHTML = busyLabel;

  // Coming back to the landing later must not find it stuck on "Creating…".
  const restore = () => {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.label;
    others.forEach((b) => { b.disabled = false; });
  };

  const s = connect({ timeout: 8000, reconnectionAttempts: 2 });
  let settled = false;
  let bail = null;
  const giveUp = (why, reachable) => {
    if (settled) return;
    settled = true;
    clearTimeout(bail);
    s.close();
    restore();
    // A socket that opened and then went quiet is a server that is up but
    // unhappy — pointing at the "set your server URL" form would be a lie.
    if (reachable) toast(why, 'error');
    else serverUnreachable(why);
  };

  bail = setTimeout(() => giveUp(s.connected
    ? 'That table never came back. Try again, or create a private game.'
    : 'The game server did not respond.', s.connected), 9000);
  s.on('connect_error', () => giveUp('Could not reach the game server.', false));
  s.emit(event, {}, ({ roomId: id } = {}) => {
    if (settled) return;
    settled = true;
    clearTimeout(bail);
    s.close();
    restore();
    if (!id) return toast('No table came back — try again in a moment.', 'error');
    return go(id);
  });
}

// Quick Play: the server hands back a public table that is already filling up,
// or opens a fresh one — either way it is one tap to a seat.
$('#quickBtn').addEventListener('click', () => {
  unlock(); sfx.click();
  takeNickname();
  askForRoom($('#quickBtn'), `<span class="btn-ico">${icon('replay', null, 'spin')}</span> Finding a table…`, 'quickplay');
});

$('#createBtn').addEventListener('click', () => {
  unlock(); sfx.click();
  takeNickname();
  askForRoom($('#createBtn'), `<span class="btn-ico">${icon('replay', null, 'spin')}</span> Creating…`, 'createRoom');
});

/**
 * The realtime server is the whole game — if it is missing, say so loudly
 * instead of leaving a dead button. Usually this means the app was deployed
 * somewhere that cannot hold a WebSocket open (see the README's deploy notes).
 */
function serverUnreachable(why) {
  toast(why, 'error');
  const el = $('#publicRooms');
  if (!el) return;
  const detail = isSplitDeploy()
    ? `Nothing answered at <code>${escapeHtml(SERVER)}</code>. If it is on a free
       tier it may be waking up — give it a minute and try again.`
    : `This page is served by a static host with no game server behind it.
       MoneyMove needs a long-running Node process for WebSockets.`;

  el.innerHTML = `<div class="server-down">
      <b>${icon('warning')} Can't reach the game server</b>
      <span>${detail}</span>
      <form class="server-form" id="serverForm">
        <input id="serverInput" placeholder="https://your-server.onrender.com"
               value="${escapeHtml(SERVER)}" autocomplete="off" spellcheck="false" />
        <button class="btn small primary" type="submit">Connect</button>
      </form>
      ${isSplitDeploy() ? '<button class="link-btn" id="serverReset">Reset to this site\'s own server</button>' : ''}
    </div>`;

  $('#serverForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!useServer($('#serverInput').value)) toast('Enter your server URL first', 'error');
  });
  $('#serverReset')?.addEventListener('click', forgetServer);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * What people actually put in the code box: the code, or the whole invite link
 * they were sent. A pasted link used to be taken literally and dropped them in
 * a brand-new room called "http", so pull the code out of either shape.
 */
function roomCodeFrom(raw) {
  const text = String(raw || '').trim();
  const linked = text.match(/[?&]room=([a-z0-9]+)/i) || text.match(/\/room\/([a-z0-9]+)/i);
  return (linked ? linked[1] : text).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
}

// Tidy the field as it is typed, so what you see is what will be joined.
$('#codeInput').addEventListener('input', (e) => {
  const clean = roomCodeFrom(e.target.value);
  if (clean !== e.target.value) e.target.value = clean;
});

$('#joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  unlock(); sfx.click();
  takeNickname();
  const code = roomCodeFrom($('#codeInput').value);
  if (!code) return toast('Enter a room code, or paste the invite link', 'error');
  return go(code);
});

// ───────────────────────────────────────────────────────────── invites ──
// A share link arrives as /?room=CODE, which any host can serve; the older
// /room/CODE links still work and are handled by boot() itself.
// Back from Stripe. The webhook is what actually credits the coins, so the
// wallet may land a beat after the redirect — poll it a few times rather than
// showing a stale zero next to a thank-you.
{
  const outcome = new URLSearchParams(location.search).get('coins');
  if (outcome) {
    history.replaceState({}, '', location.pathname);
    if (outcome === 'purchased') {
      toast('Payment received — your coins are on the way in');
      let tries = 0;
      const tick = () => { refreshWallet({ celebrate: true }); if (++tries < 6) setTimeout(tick, 2500); };
      setTimeout(tick, 1500);
    } else if (outcome === 'cancelled') {
      toast('Payment cancelled — nothing was charged');
    }
  }
}

const inviteCode = () => (new URLSearchParams(location.search).get('room') || '')
  .trim().toLowerCase().replace(/[^a-z0-9]/g, '');

/** Strangers are asked what to call them first; regulars walk straight in. */
function joinInvite(code) {
  if (nickname) {
    history.replaceState({}, '', `/room/${code}`);
    return boot();
  }
  showLanding();
  // Dismissing the name sheet must not lose the invite: the code is sitting in
  // the join field behind it, one tap from being used again.
  $('#codeInput').value = code;
  openJoinNameModal(code, (name) => {
    nickname = name;
    storeName(name);
    $('#nickInput').value = name;
    go(code);
  });
  return undefined;
}

// ─────────────────────────────────────────────────────────────────── boot ──
function boot() {
  const invite = inviteCode();
  if (invite && !/^\/room\//i.test(location.pathname)) return joinInvite(invite);

  // Whatever sheet the last table left open belongs to that table. A result
  // screen still sitting over the landing — or over the next game — is the
  // single most confusing thing this app can put on screen.
  closeModal();
  $('#cardPopup').classList.add('hidden');

  const match = location.pathname.match(/^\/room\/([a-z0-9]+)/i);
  if (!match) {
    resuming = false;
    // Reached via browser Back mid-game: release the seat properly (a held
    // socket would stall the room) and leave a way back in.
    rememberGame();
    if (socket) { socket.close(); socket = null; }
    state = null;
    roomId = null;
    lastStatus = null;
    resetBoard();
    return showLanding();
  }

  roomId = match[1].toLowerCase();
  // Offer ids start again at 1 in a new room, so what has already been shown
  // has to be forgotten with the room it belonged to.
  offersShown.clear();
  // Nothing on the landing is on screen any more — stop polling for it.
  clearInterval(roomsTimer);
  stopDailyClock();
  stopSocial();
  $('#landing').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#shareLink').value = `${location.origin}/?room=${roomId}`;
  resetBoard();
  lastTurnId = null;
  lastStatus = null;
  winnerShown = false;
  removedShown = false;

  if (socket) socket.close();
  socket = connect();

  // `proto` is the whole handshake: it rides every join, reconnects included,
  // and asks for patches instead of a fresh 13.5 KB board per action. A server
  // that has never heard of it ignores the field and keeps sending whole
  // states, which is what onState is handed either way.
  socket.on('connect', () => socket.emit('join', {
    roomId, token, name: nickname || 'Player', flag: myFlag, proto: PROTO,
  }));
  socket.on('you', (d) => { meId = d.playerId; });
  onState(socket, (s) => {
    // First state after a (re)join is history, not news: seed the one-shot
    // trackers so the last card doesn't pop again and old log lines and the
    // opening balance don't play sounds.
    if (!state) {
      lastCardAt = s.lastCard?.at ?? 0;
      lastLogAt = s.log?.[s.log.length - 1]?.at ?? 0;
      lastMyMoney = null;
      hadAuction = !!s.auction;
      lastAuctionBid = s.auction?.bid || 0;
      if (resuming) {
        resuming = false;
        // An empty lobby where a game was is the table having been packed away,
        // and a finished one is nothing to come back to. Either way the shelf
        // must not keep offering it — this is the "join failed" half of the
        // check that /api/rooms cannot make for a private room.
        if (s.status === 'ended' || (s.status === 'lobby' && s.players.length <= 1)) {
          toast(s.status === 'ended'
            ? 'That game finished without you'
            : 'That table has closed — this is a fresh room with the same code');
          forgetGame(roomId);
        }
      }
    }
    state = s;
    render();
  });
  socket.on('toast', (t) => toast(t.message, t.type));
  // No seat left (started, or full). You are still shown the table, so say that
  // out loud — a bare red "Game already started" reads as a failed navigation.
  socket.on('joinFailed', (d) => toast(
    d.spectate ? `${d.message} — you're watching this table` : d.message,
    d.spectate ? 'info' : 'error',
  ));
  socket.on('disconnect', () => toast('Connection lost — reconnecting…', 'error'));
  socket.on('connect_error', () => {
    if (state) return; // already in a game, socket.io will keep retrying
    toast('Could not reach the game server — is it running?', 'error');
  });
}

// ───────────────────────────────────────────────────────────────── render ──
/** One broken panel should never wedge the rest of the UI. */
function safe(label, fn) {
  try { return fn(); } catch (err) { console.error(`render:${label}`, err); return undefined; }
}

function render() {
  if (!state) return;

  const rebuilt = safe('board', () => renderBoard(state, $('#board')));
  safe('ownership', () => patchBoard(state));
  safe('highlight', () => highlightTiles(state));
  safe('tokens', () => syncTokens(state, {
    meId,
    onStep: (_tile, last, who, i, total) => sfx.stepFor(who?.tokenSkin, { i, total, last }),
    onArrive: () => highlightTiles(state),
    // The clank belongs to the door closing, not to the server saying so —
    // it waits for the piece to be set down inside.
    onJailed: () => sfx.jail(),
  }));
  if (rebuilt) requestAnimationFrame(() => safe('reposition', () => repositionTokens(state)));

  // A quick match keeps its tiles in the deck while it looks for players, and
  // a kick-off seen live — any lobby turning into a game — deals the board
  // out of the deck. After syncTokens on purpose: the deal transforms every
  // tile, and a token placed against a transformed tile lands mid-air.
  const sawLobby = lastStatus === 'lobby';
  lastStatus = state.status;
  safe('deal', () => {
    syncUndealt(state);
    if (sawLobby && state.status === 'playing' && dealBoardIn(state)) sfx.shuffle();
  });

  safe('awaiting', () => renderAwaiting(state, meId, $('#awaitingWell'), actions));
  safe('players', () => renderPlayers(state, meId, $('#playerList'), actions));
  safe('panel', () => renderRightPanel(state, meId, $('#rightPanel'), actions));
  safe('center', () => renderCenter(state, meId, actions));
  safe('dice', () => renderDice(state));
  safe('clock', () => syncTurnClock(state, meId));
  safe('modals', () => syncOpenModals(state));
  safe('log', () => {
    renderLog(state, $('#logList'));
    // The board's own quiet feed — same lines, ghosted under the dice.
    const centre = $('#centerLog');
    if (centre) renderLog(state, centre);
  });
  safe('chatChannels', () => syncChatChannels(state));
  safe('chat', () => renderChat(state, $('#chatList'), chatChannel));
  safe('chatDock', () => syncChatDock(state));
  safe('offer', () => showNewOffers(state));

  $('#shareCard').classList.toggle('hidden', state.status !== 'lobby');
  document.body.classList.toggle('my-turn', state.turn?.playerId === meId && state.status === 'playing');

  playSoundsForNewEvents();

  // turn banner
  if (state.status === 'playing' && state.turn?.playerId && state.turn.playerId !== lastTurnId) {
    lastTurnId = state.turn.playerId;
    const p = state.players.find((x) => x.id === lastTurnId);
    if (p) { showTurnBanner(p, p.id === meId); if (p.id === meId) sfx.turn(); }
  }

  // drawn card — revealed only once the token has walked onto the tile; the
  // server resolves instantly, but the reveal must not beat the piece there.
  if (state.lastCard && state.lastCard.at !== lastCardAt) {
    lastCardAt = state.lastCard.at;
    const card = state.lastCard;
    setTimeout(() => {
      if (state?.lastCard?.at !== card.at) return; // superseded meanwhile
      $('#cardPopup').classList.remove('hidden');
      showCard(card);
    }, moveDelay(card.at));
  }

  safe('relief', showReliefCardOnce);

  // removed from play — the clock ran out on this seat. A quit is the player's
  // own doing, so it never gets the "your time ran out" story.
  const meNow = state.players.find((p) => p.id === meId);
  if (state.status === 'playing' && meNow?.timedOut && meNow.removedFor !== 'quit' && !removedShown) {
    removedShown = true;
    showRemovedOverlay({
      onHome: () => {
        forgetGame(roomId);
        goHome();
      },
      onWatch: () => toast('Staying on as a spectator'),
    });
  }
  if (!meNow?.timedOut) removedShown = false;

  // game over
  if (state.status === 'ended') {
    // Nothing left to come back to, so the shelf must stop offering it —
    // though the ending itself is worth keeping.
    forgetGame(roomId);
    recordMatch(state);
  }
  if (state.status === 'ended' && !winnerShown) {
    winnerShown = true;
    sfx.win();
    confetti();
    setTimeout(() => showGameOver(state, meId, actions), 700);
    // did the win pay out? the wallet knows
    setTimeout(() => refreshWallet({ celebrate: true }), 1200);
  }
  if (state.status !== 'ended') { winnerShown = false; matchSavedFor = null; }
}

/** Long enough for the piece to finish walking to whatever caused the card. */
function moveDelay(at) {
  const mv = state?.lastMove;
  const steps = mv && mv.steps && Math.abs(mv.at - at) < 2500 ? Math.abs(mv.steps) : 0;
  return steps ? steps * 120 + 350 : 0;
}

// ─────────────────────────────────────────────────────── deadlock rule ──
// The server explains the deadlock rule once, the first time a table could ever
// hit it, by hanging a card on the state. State is pushed dozens of times a
// turn and survives a refresh, so "once" has to be remembered here: in memory
// for this session, and in storage for the next one. A handful of marks is
// plenty — one per table, and pass-and-play windows share the same storage.
const RELIEF_SEEN_KEY = 'moneymove:reliefSeen';
let reliefShownAt = 0;

function reliefMarks() {
  return (safeGet(localStorage, RELIEF_SEEN_KEY) || '').split('|').filter(Boolean);
}

function showReliefCardOnce() {
  const rc = state.reliefCard;
  if (!rc || reliefShownAt === rc.at) return;
  // Per identity as well as per table: two pass-and-play windows on one machine
  // share a localStorage, and both players are meant to read this.
  const mark = `${roomId}:${rc.at}:${meId}`;
  reliefShownAt = rc.at;
  if (reliefMarks().includes(mark)) return;
  safeSet(localStorage, RELIEF_SEEN_KEY, [...reliefMarks().slice(-3), mark].join('|'));

  // It lands as someone passes START, so it waits for the piece to get there
  // instead of covering the board mid-step.
  setTimeout(() => {
    if (state?.reliefCard?.at !== rc.at) return;
    $('#cardPopup').classList.remove('hidden');
    // A rule to read, not a payout to glance at — it stays up long enough.
    showCard({ deck: 'rule', title: rc.title, text: rc.text }, { hold: 12000 });
  }, moveDelay(rc.at));
}

/** Turns fresh log lines into sound effects. */
let lastMyMoney = null;
let hadAuction = false;
let lastAuctionBid = 0;
// The newest jailing this client has already handed to the flight, so a
// re-render of the same state does not queue a second door.
let lastJailMoveAt = 0;

function playSoundsForNewEvents() {
  // My own wallet gets its own voice: a coin ring when money lands, an
  // "ishh…" when it leaves — the generic room sounds stay for everyone else.
  const meNow = state.players.find((p) => p.id === meId);
  let myDelta = 0;
  if (state.status === 'playing' && meNow && !meNow.bankrupt) {
    if (lastMyMoney != null) myDelta = meNow.money - lastMyMoney;
    lastMyMoney = meNow.money;
  } else {
    lastMyMoney = null;
  }
  if (myDelta > 0) sfx.gain();
  else if (myDelta < 0) sfx.lose();

  // Auction: the gavel when it opens, a rising paddle-tick for every new bid
  // (pitched by how high the bid is).
  const a = state.auction;
  if (a && !hadAuction) sfx.auction();
  else if (a && hadAuction && a.bid > lastAuctionBid) sfx.bid(a.bid);
  hadAuction = !!a;
  lastAuctionBid = a?.bid || 0;

  // Is a piece on its way to prison right now? The server marks that move
  // 'jail'; nothing else does.
  const jailMove = (state.moves || []).filter((m) => m.cause === 'jail').pop();
  const jailFlight = !!jailMove && jailMove.at > lastJailMoveAt;
  if (jailFlight) lastJailMoveAt = jailMove.at;

  const fresh = state.log.filter((l) => l.at > lastLogAt);
  if (!fresh.length) return;
  lastLogAt = state.log[state.log.length - 1].at;
  const kinds = new Set(fresh.map((l) => l.kind));
  if (kinds.has('bankrupt')) return sfx.bankrupt();
  if (!myDelta && kinds.has('rent')) return sfx.rent();
  if (kinds.has('buy')) return sfx.buy();
  // A jailing is voiced on landing (see onJailed above), so the line that
  // announces it stays quiet — otherwise the door slams a second before the
  // piece is anywhere near it. Every other jail line — paying the fine,
  // spending a card — moves nobody, and keeps its sound here.
  if (kinds.has('jail') && !jailFlight) return sfx.jail();
  if (kinds.has('build')) return sfx.build();
  if (kinds.has('trade')) return sfx.trade();
  // auction openings + bids are voiced by the state diff below, not the log
  if (!myDelta && kinds.has('money')) return sfx.cash();
}

// ───────────────────────────────────────────────────────────────── inputs ──
$('#copyBtn').addEventListener('click', async () => {
  sfx.click();
  const link = $('#shareLink').value;
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copied — send it to your friends');
  } catch {
    $('#shareLink').select();
    document.execCommand('copy');
    toast('Link copied');
  }
});

// The same sheet from the toolbar in game and from the landing header, where
// someone who has never played is the one who actually needs it.
document.querySelectorAll('#helpBtn, #helpBtnLanding').forEach((b) => {
  b.addEventListener('click', () => { sfx.click(); openHelpModal(); });
});

// Pass-and-play: opens a second window with its own identity in the same room.
$('#addLocalBtn').addEventListener('click', () => {
  sfx.click();
  if (!roomId) return;
  const win = window.open(`${location.origin}/room/${roomId}#newplayer`, '_blank');
  if (!win) toast('Allow pop-ups to add another player on this device', 'error');
  else toast('New window opened — that player picks their own name and colour');
});

// ────────────────────────────────────────────────── unfinished games ──
// Walking out of a live table is usually "back in a minute", so the browser
// keeps a short shelf of the games it left rather than only the last one. Each
// entry carries enough to recognise the table without asking the server: the
// board, when you left, and who was sitting at it.
const GAMES_KEY = 'moneymove:games';
const LAST_ROOM_KEY = 'moneymove:lastRoom'; // the single room this replaced
const MAX_GAMES = 5;
// The server stops a game nobody is watching after a few minutes and clears the
// room out half an hour later, so an entry this old cannot still be a table.
const GAME_TTL = 12 * 60 * 60 * 1000;

function writeGames(list) {
  safeSet(localStorage, GAMES_KEY, JSON.stringify(list.slice(0, MAX_GAMES)));
}

/** The shelf, oldest junk and stale entries already dropped. */
function readGames() {
  const raw = safeGet(localStorage, GAMES_KEY);
  let list = [];
  try { list = JSON.parse(raw || '[]'); } catch { /* someone else's key */ }
  if (!Array.isArray(list)) list = [];

  // Anyone mid-upgrade still has the old single room in hand; it becomes the
  // first entry on the shelf instead of being thrown away.
  const old = safeGet(localStorage, LAST_ROOM_KEY);
  if (old) {
    try { localStorage.removeItem(LAST_ROOM_KEY); } catch { /* private mode */ }
    if (!list.some((g) => g && g.id === old)) list.unshift({ id: old, at: Date.now(), map: '', players: [] });
  }

  const fresh = list
    .filter((g) => g && typeof g.id === 'string' && Date.now() - (g.at || 0) < GAME_TTL)
    .slice(0, MAX_GAMES);
  // Only when something actually changed: this is read on every rooms poll.
  if (JSON.stringify(fresh) !== (raw || '[]')) writeGames(fresh);
  return fresh;
}

/** Called on the way out of a live table — newest first, five deep. */
function rememberGame() {
  if (!roomId || state?.status !== 'playing') return;
  writeGames([{
    id: roomId,
    map: state.map?.name || '',
    at: Date.now(),
    // Two half-finished games are told apart by who you were playing, not by a
    // five-letter code, so the rest of the table is worth keeping.
    players: state.players
      .filter((p) => p.id !== meId && !p.bankrupt && !p.timedOut)
      .map((p) => p.name).slice(0, 8),
    // A public table can be checked against /api/rooms later. A private one
    // never appears there, so its absence would prove nothing.
    open: !state.settings?.isPrivate,
  }, ...readGames().filter((g) => g.id !== roomId)]);
}

function forgetGame(id) {
  if (!id) return;
  const list = readGames();
  const kept = list.filter((g) => g.id !== id);
  if (kept.length === list.length) return;
  writeGames(kept);
  renderResumeList();
}

/**
 * A remembered public table that the server no longer lists has either finished
 * or been packed away, so it comes off the shelf. A private one is never listed
 * in the first place: those leave when a rejoin finds nothing, when the game
 * ends under you, or when the entry simply ages out.
 */
function pruneGamesAgainst(rooms) {
  liveRooms = new Map(rooms.map((r) => [r.id, r]));
  const list = readGames();
  const kept = list.filter((g) => !g.open || liveRooms.has(g.id));
  if (kept.length !== list.length) writeGames(kept);
}

const agoText = (at) => {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? 'an hour ago' : `${hrs} hours ago`;
};

/** "Ravi, Mo and 2 more" — a roster that fits on one line. */
const whoText = (names) => {
  if (!names?.length) return '';
  if (names.length <= 3) return names.map(escapeHtml).join(', ');
  return `${names.slice(0, 2).map(escapeHtml).join(', ')} and ${names.length - 2} more`;
};

function resumeGame(id) {
  sfx.click();
  resuming = true;
  go(id);
}

let resumeHtml = '';

/**
 * The newest unfinished game keeps the big Continue button it always had; the
 * ones behind it get a list, so a game left the day before is not lost the
 * moment a second one is started.
 */
function renderResumeList() {
  const games = readGames();
  const cont = $('#continueBtn');
  const list = $('#resumeList');
  if (!cont || !list) return;

  cont.classList.toggle('hidden', !games.length);
  if (games[0]) {
    const top = games[0];
    cont.innerHTML = `${icon('replay')} Continue — ${top.map ? `${escapeHtml(top.map)} · ` : ''}room ${escapeHtml(top.id)}`;
    cont.onclick = () => resumeGame(top.id);
  }

  const rest = games.slice(1);
  list.classList.toggle('hidden', !rest.length);
  const html = !rest.length ? '' : `<div class="pr-title">Also unfinished</div>${rest.map((g) => {
    const live = liveRooms.get(g.id);
    const who = whoText(g.players);
    return `<div class="resume-row">
        <button class="resume-go" data-resume="${escapeHtml(g.id)}" type="button">
          <span class="rr-main">${escapeHtml(g.map || `Room ${g.id}`)}</span>
          <span class="rr-sub">${who ? `${who} · ` : ''}left ${agoText(g.at)}${
            live ? ` · ${live.status === 'playing' ? 'still on' : 'in the lobby'}` : ''}</span>
        </button>
        <button class="rr-x" data-forget="${escapeHtml(g.id)}" type="button"
          title="Forget this game" aria-label="Forget this game">×</button>
      </div>`;
  }).join('')}`;

  // The rooms poll calls this every few seconds. Repainting an unchanged list
  // would move a row out from under a finger mid-tap.
  if (html === resumeHtml) return;
  resumeHtml = html;
  list.innerHTML = html;

  list.querySelectorAll('[data-resume]').forEach((b) => {
    b.onclick = () => resumeGame(b.dataset.resume);
  });
  list.querySelectorAll('[data-forget]').forEach((b) => {
    b.onclick = () => { sfx.click(); forgetGame(b.dataset.forget); };
  });
}

// ─────────────────────────────────────────────────── finished games ──
// The shelf above holds games to walk back into; this one holds the endings.
// A record is the report card and nothing else — enough to redraw the sheet
// months later without a server that has long since forgotten the room.
const MATCH_KEY = 'moneymove:matches';
const MAX_MATCHES = 20;
let matchSavedFor = null; // the room whose ending this session already wrote

function readMatches() {
  let list = [];
  try { list = JSON.parse(safeGet(localStorage, MATCH_KEY) || '[]'); } catch { /* someone else's key */ }
  return Array.isArray(list) ? list.filter((m) => m && m.state) : [];
}

/** Called on the ended state — once per game, not once per push of it. */
function recordMatch(s) {
  if (!roomId || matchSavedFor === roomId) return;
  if (!s.players?.some((p) => p.id === meId)) return; // watching, not playing
  matchSavedFor = roomId;
  const players = (s.players || []).map((p) => ({
    id: p.id, name: p.name, color: p.color, netWorth: p.netWorth, bankrupt: p.bankrupt,
  }));
  const list = readMatches();
  // A refresh on a finished board replays the ending. The same room showing
  // the same final books is the same game — a rematch reuses the room, but
  // never lands on identical numbers.
  if (list.some((m) => m.room === roomId
    && JSON.stringify(m.state.players) === JSON.stringify(players))) return;
  list.unshift({
    at: Date.now(),
    room: roomId,
    map: s.map?.name || '',
    players: (s.players || []).map((p) => p.name),
    winner: s.winner?.name || '',
    meWon: !!s.winner && s.winner.id === meId,
    // The slice of state the report card actually reads. History is the one
    // heavy field, and the card never charts it.
    state: {
      players,
      winner: s.winner ? { id: s.winner.id, name: s.winner.name, color: s.winner.color } : null,
      titles: s.titles || null,
      stats: s.stats || null,
      map: { name: s.map?.name || '' },
      history: [],
    },
  });
  safeSet(localStorage, MATCH_KEY, JSON.stringify(list.slice(0, MAX_MATCHES)));
}

const matchDay = (at) => {
  const d = new Date(at || 0);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'today';
  if (d.toDateString() === new Date(now - 86400000).toDateString()) return 'yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** Up to five finished games on the landing, each a tap from its report card. */
function renderRecentGames() {
  const el = $('#recentGames');
  if (!el) return;
  const list = readMatches().slice(0, 5);
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="pr-title">Recent games</div>' + list.map((m, i) => {
    const result = m.meWon ? 'You won' : m.winner ? `${escapeHtml(m.winner)} won` : 'Nobody won';
    return `<button class="recent-game" data-match="${i}" type="button" title="Open the report card">
      <span class="rg-main">${escapeHtml(m.map || `Room ${m.room || '?'}`)}
        <i class="rg-tag ${m.meWon ? 'won' : ''}">${result}</i></span>
      <span class="rg-sub">${matchDay(m.at)}${m.players?.length ? ` · ${whoText(m.players)}` : ''}</span>
    </button>`;
  }).join('');
  el.querySelectorAll('[data-match]').forEach((b) => {
    b.onclick = () => { sfx.click(); openReportCard(list[Number(b.dataset.match)]); };
  });
}

/** Drops the socket, clears the board and puts the landing back on screen. */
function goHome() {
  history.pushState({}, '', '/');
  closeModal();
  $('#cardPopup').classList.add('hidden');
  if (socket) { socket.close(); socket = null; }
  state = null;
  roomId = null;
  offersShown.clear();
  if (document.body.classList.contains('chat-open')) closeChatDock();
  chatSeen = 0;
  heardChatId = null;
  resetBoard();
  showLanding();
}

$('#leaveBtn').addEventListener('click', () => {
  sfx.click();
  // Mid-game, leaving deserves a second thought — and a choice: a bot can hold
  // the seat, or the deeds can go back to the bank for good.
  if (state?.status === 'playing') {
    openLeaveModal({
      onKeepSeat: () => {
        rememberGame();
        goHome();
      },
      onQuit: () => {
        actions.quit();
        forgetGame(roomId);
        // Let the quit reach the server before the socket goes down under it.
        setTimeout(goHome, 150);
      },
      // Conceding is only on the table while this seat is still in the game.
      onConcede: state?.players?.some((p) => p.id === meId && !p.bankrupt)
        ? () => actions.bankrupt()
        : null,
    });
    return;
  }
  forgetGame(roomId);
  goHome();
});

// Closing the tab mid-game gets the browser's own "are you sure".
window.addEventListener('beforeunload', (e) => {
  if (state?.status !== 'playing') return;
  rememberGame();
  e.preventDefault();
  e.returnValue = '';
});

// Quick reactions: a tap posts the emoji as an ordinary chat message, so it
// lands in the same channel the player is reading.
const REACTIONS = ['👍', '😂', '😱', '🤝', '🔥'];
const emoteRow = $('#emoteRow');
emoteRow.innerHTML = REACTIONS.map((e) =>
  `<button class="emote" type="button" title="Send ${e}" aria-label="Send ${e}">${e}</button>`).join('');
emoteRow.querySelectorAll('.emote').forEach((b) => {
  b.onclick = () => { sfx.click(); actions.chat(b.textContent, chatChannel); };
});

$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) return;
  actions.chat(text, chatChannel);
  input.value = '';
});

// ---- the cup -------------------------------------------------------------
//
// A tournament: a five-minute door, everybody paired off behind it, and three
// prizes at the end. The card exists only while the server says cups are on —
// a server with them off answers `enabled: false` and nothing is drawn, which
// is how this ships hidden.
//
// The poll is slow (six seconds) except while a door is open or a round is
// being drawn, when a player is waiting on a number that changes.

let cupTimer = null;
let cupClock = null;
let cupSeen = null;          // the match this browser has already walked into

function watchCup() {
  clearTimeout(cupTimer);
  fetch(api(`/api/cup?token=${encodeURIComponent(token)}`))
    .then((r) => r.json())
    .then(paintCup)
    .catch(() => {})
    .finally(() => { cupTimer = setTimeout(watchCup, cupPollMs); });
}
let cupPollMs = 6000;

function stopCupClock() { clearInterval(cupClock); cupClock = null; }

function paintCup(data) {
  const card = $('#cupCard');
  if (!card) return;
  const cup = data?.enabled ? data.cup : null;
  if (!cup) { card.classList.add('hidden'); stopCupClock(); cupPollMs = 30000; return; }
  card.classList.remove('hidden');

  // Your table is ready: go, once. Walking in is the player's own click on
  // every later visit, but the first one should not need finding.
  if (cup.you?.roomId && cupSeen !== cup.you.roomId) {
    cupSeen = cup.you.roomId;
    toast(`Your cup table is ready — playing ${cup.you.opponent || 'your opponent'}`);
    setTimeout(() => go(cup.you.roomId), 900);
  }

  // The reader's own money where the server worked one out — see fx.js.
  const money = (place) => cupMoney(cup, place);
  // Three places, three metals. The first is bigger than the others because
  // it is the thing everybody is actually here for.
  const prizes = `<div class="cup-prizes">
      <div class="cup-prize gold"><span class="cup-place">1st</span><b>${money('first')}</b></div>
      <div class="cup-prize silver"><span class="cup-place">2nd</span><b>${money('second')}</b></div>
      <div class="cup-prize bronze"><span class="cup-place">3rd</span><b>${money('third')}</b></div>
    </div>`;

  // Announced, not open. Everybody can see it and count down to it; nobody
  // can enter yet. This is what makes a cup something to turn up for rather
  // than something you had to happen to be online for.
  if (cup.state === 'scheduled') {
    cupPollMs = 30000;
    const opens = new Date(cup.openedAt);
    card.innerHTML = `<div class="cup-head">
        <span class="cup-mark">${icon('trophy', 20, 'solo')}</span>
        <div class="cup-body">
          <div class="cup-title">${escapeHtml(cup.name)}</div>
          <div class="cup-sub">Knockout — last one standing takes ${money('first')}</div>
        </div>
        <span class="cup-count soon">soon</span>
      </div>
      <div class="cup-clock">
        <div class="cup-clock-line">
          <span>Doors open in</span>
          <b id="cupClockText">…</b>
        </div>
      </div>
      <div class="cup-when">${icon('snooze', 13)} ${escapeHtml(opens.toLocaleString([], {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }))} · doors stay open ${Math.round((cup.closesAt - cup.openedAt) / 60000)} min</div>
      ${prizes}
      <div class="cup-in">${icon('people', 14)} Come back then — entering takes one tap once the doors are open.</div>
      <button class="btn ghost small wide" id="cupPoster">${icon('question', 13)} What is a cup?</button>`;
    const clock = () => {
      const el = $('#cupClockText');
      if (!el) return;
      el.textContent = longCountdown(cup.openedAt - Date.now());
    };
    clock();
    stopCupClock();
    cupClock = setInterval(clock, 1000);
    wireCupPoster(cup);
    return;
  }

  if (cup.state === 'joining') {
    cupPollMs = 3000;
    card.innerHTML = `<div class="cup-head">
        <span class="cup-mark">${icon('trophy', 20, 'solo')}</span>
        <div class="cup-body">
          <div class="cup-title">${escapeHtml(cup.name)}</div>
          <div class="cup-sub">Knockout — last one standing takes ${money('first')}</div>
        </div>
        <span class="cup-count"><b>${cup.entrants}</b> in</span>
      </div>
      <div class="cup-clock">
        <div class="cup-clock-line">
          <span>Doors close in</span>
          <b id="cupClockText">…</b>
        </div>
        <div class="cup-bar"><i id="cupBar" style="width:100%"></i></div>
      </div>
      ${prizes}
      ${cup.you.joined
        ? `<div class="cup-in ok">${icon('people', 14)} You are in. Your first table opens when the doors close.</div>
           <div class="row-2">
             <button class="btn ghost small" id="cupPoster">${icon('question', 13)} How it works</button>
             <button class="btn ghost small" id="cupLeave">Withdraw</button>
           </div>`
        : `<button class="btn gold wide wrap" id="cupJoin">Enter the cup</button>
           <button class="btn ghost small wide" id="cupPoster">${icon('question', 13)} What is a cup?</button>`}`;
    const opened = cup.openedAt || cup.closesAt - 5 * 60 * 1000;
    const clock = () => {
      const el = $('#cupClockText');
      if (!el) return;
      const left = Math.max(0, cup.closesAt - Date.now());
      const secs = Math.ceil(left / 1000);
      el.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      // Under half a minute the clock stops being information and starts
      // being a nudge, so it says so in red.
      el.classList.toggle('urgent', secs <= 30);
      const bar = $('#cupBar');
      const span = Math.max(1, cup.closesAt - opened);
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, (left / span) * 100)).toFixed(2)}%`;
    };
    clock();
    stopCupClock();
    cupClock = setInterval(clock, 500);
    const join = $('#cupJoin');
    if (join) join.onclick = () => { sfx.click(); enterCup(); };
    const leave = $('#cupLeave');
    if (leave) leave.onclick = () => { sfx.click(); leaveCup(); };
    wireCupPoster(cup);
    return;
  }

  stopCupClock();
  if (cup.state === 'running') {
    cupPollMs = 4000;
    const r = cup.round;
    const you = cup.you.joined
      ? (cup.you.out ? 'You are out of this one.'
        : cup.you.roomId ? 'Your table is open — good luck.'
        : 'Waiting for your next table.')
      : 'Running now — the doors are shut.';
    // The bracket as a row of lights: one per table in this round, lit while
    // it is still being played, dimmed once it is decided.
    const dots = r ? `<div class="cup-dots">${r.matches
      .map((m) => `<i class="${m.state === 'done' ? 'done' : 'live'}" title="${escapeHtml(`${m.a} v ${m.b}`)}"></i>`)
      .join('')}</div>` : '';
    card.innerHTML = `<div class="cup-head">
        <span class="cup-mark">${icon('trophy', 20, 'solo')}</span>
        <div class="cup-body">
          <div class="cup-title">${escapeHtml(cup.name)}</div>
          <div class="cup-sub">${r ? escapeHtml(roundName(r)) : 'Drawing the bracket…'}</div>
        </div>
        <span class="cup-count"><b>${cup.entrants}</b> in</span>
      </div>
      ${dots}
      ${prizes}
      <div class="cup-in${cup.you.roomId ? ' ok' : cup.you.out ? ' out' : ''}">${escapeHtml(you)}</div>
      ${cup.you.joined && cup.you.survived != null
        ? `<div class="cup-run">${icon('trophy', 12)} ${cup.you.survived} won · <b>${cup.you.left}</b> still in${cup.you.roundLabel ? ` · ${escapeHtml(cup.you.roundLabel)}` : ''}</div>`
        : ''}
      ${cup.you.roomId ? `<button class="btn primary wide" id="cupGo">Go to your table</button>` : ''}
      <button class="btn ghost small wide" id="cupChart">${icon('chart', 13)} See the chart</button>`;
    const goBtn = $('#cupGo');
    if (goBtn) goBtn.onclick = () => { sfx.click(); go(cup.you.roomId); };
    wireCupChart();
    return;
  }

  // Finished. The server keeps it in front of everyone for a few minutes,
  // because a cup that disappears the moment it is won never tells the winner
  // they won it.
  if (cup.state === 'done' && cup.standings) {
    cupPollMs = 20000;
    const s = cup.standings;
    const mine = cup.you.placed;
    const step = (place, who, label) => `<div class="cup-step ${place}${mine === place ? ' mine' : ''}">
        <span class="cup-place">${label}</span>
        <b>${who ? escapeHtml(who.name) : '—'}</b>
        <span class="cup-won">${money(place)}</span>
      </div>`;
    card.innerHTML = `<div class="cup-head">
        <span class="cup-mark">${icon('trophy', 20, 'solo')}</span>
        <div class="cup-body">
          <div class="cup-title">${escapeHtml(cup.name)}</div>
          <div class="cup-sub">${s.first ? `${escapeHtml(s.first.name)} takes it` : 'Nobody finished this one'}</div>
        </div>
      </div>
      <div class="cup-podium">
        ${step('first', s.first, '1st')}
        ${step('second', s.second, '2nd')}
        ${step('third', s.third, '3rd')}
      </div>
      ${mine ? `<div class="cup-in ok">${icon('trophy', 14)} You finished ${mine}. The prize is paid by hand — hold on to your friend code.</div>` : ''}
      <button class="btn ghost small wide" id="cupChart">${icon('chart', 13)} See the chart</button>`;
    wireCupChart();
    return;
  }

  cupPollMs = 20000;
  card.classList.add('hidden');
}

/** "3d 4h", "5h 12m", "4:26" — whichever the wait deserves. */
function longCountdown(ms) {
  const left = Math.max(0, Math.round(ms / 1000));
  if (left >= 86400) return `${Math.floor(left / 86400)}d ${Math.floor((left % 86400) / 3600)}h`;
  if (left >= 3600) return `${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m`;
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

function wireCupChart() {
  const b = $('#cupChart');
  if (b) b.onclick = () => { sfx.click(); openCupBracket(token); };
}

function wireCupPoster(cup) {
  const b = $('#cupPoster');
  if (b) b.onclick = () => { sfx.click(); openCupPoster(cup); };
}

function roundName(r) {
  if (r.kind === 'final') return 'The final';
  if (r.kind === 'thirdPlace') return 'Third place';
  const live = r.matches.filter((m) => m.state !== 'done').length;
  return `Round ${r.n} — ${live} of ${r.matches.length} still playing`;
}

async function enterCup() {
  try {
    const res = await fetch(api('/api/cup/join'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const out = await res.json();
    if (res.status === 401) return toast('Sign in first — a prize needs somebody to pay');
    if (!res.ok || out.error) return toast(out.error || 'Could not enter', 'error');
    toast('You are in the cup');
    watchCup();
  } catch { toast('Could not reach the server', 'error'); }
}

async function leaveCup() {
  try {
    await fetch(api('/api/cup/leave'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    watchCup();
  } catch { /* the next poll puts it right */ }
}

// ---- an offer arrives ----------------------------------------------------
// Every offer is put in front of its reader exactly once. Answering it, or
// closing the sheet, retires the id — a state push a second later must not
// throw the same deal back up, and neither must a reconnect, so the set is
// only ever added to while this table is open.
const offersShown = new Set();

function showNewOffers(s) {
  if (s.status !== 'playing') return;
  const live = new Set(s.trades.map((t) => t.id));
  // Deals that are over stop taking up room in the set.
  for (const id of offersShown) if (!live.has(id)) offersShown.delete(id);
  // One at a time, oldest first: two sheets stacked on each other would bury
  // the first, and a sheet already open (a deed, the composer, the report
  // card) is not something an offer gets to interrupt.
  if (isModalOpen()) return;
  const next = s.trades
    .filter((t) => t.to === meId && !t.ignored && !offersShown.has(t.id))
    .sort((a, b) => a.id - b.id)[0];
  if (!next) return;
  offersShown.add(next.id);
  sfx.trade();
  openTradeOfferModal(s, next, meId, actions, (id) => offersShown.add(id));
}

// ---- the chat dock -------------------------------------------------------
// On a phone the chat used to be a panel below the board, below the log, in a
// column you had to scroll to — so it was both in the way and easy to miss.
// It moves to where the app puts it: a round button at thumb height that
// opens the same panel over the board. The panel itself is untouched, so the
// channel chips, the emotes and the input keep working exactly as they did.
const chatDockBtn = $('#chatBubble');
const chatPanel = document.querySelector('.chat-panel');
let chatSeen = 0;

function chatCount(s) {
  return (s?.chat || []).length;
}

function openChatDock() {
  document.body.classList.add('chat-open');
  chatSeen = chatCount(state);
  paintChatBadge();
  // The keyboard should land in the message box, but not on a phone where
  // that would throw the keyboard up over the panel before it is even read.
  if (window.matchMedia('(min-width: 700px)').matches) $('#chatInput')?.focus();
  const list = $('#chatList');
  if (list) list.scrollTop = list.scrollHeight;
}

function closeChatDock() {
  document.body.classList.remove('chat-open');
  chatSeen = chatCount(state);
  paintChatBadge();
}

function paintChatBadge() {
  if (!chatDockBtn) return;
  const unread = Math.max(0, chatCount(state) - chatSeen);
  const open = document.body.classList.contains('chat-open');
  chatDockBtn.classList.toggle('has-unread', unread > 0 && !open);
  chatDockBtn.dataset.unread = unread > 99 ? '99+' : String(unread);
}

if (chatDockBtn) {
  chatDockBtn.onclick = () => {
    sfx.click();
    if (document.body.classList.contains('chat-open')) closeChatDock();
    else openChatDock();
  };
}
document.querySelector('#chatDockClose')?.addEventListener('click', () => {
  sfx.click();
  closeChatDock();
});
// The scrim behind the panel is a target too — tapping the board to get back
// to the game is the obvious thing to try.
document.querySelector('#chatScrim')?.addEventListener('click', closeChatDock);

// The id of the last line this device has heard, so a push that carries the
// same tail twice does not pop twice — and so a reconnect, which redelivers
// the whole window, is silent.
let heardChatId = null;

/** Keep the unread count honest, and sound the ones that just arrived. */
function syncChatDock(s) {
  const feed = s?.chat || [];
  const last = feed[feed.length - 1];
  if (heardChatId === null) {
    // First state of this table: whatever was already said is history, and
    // none of it is unread either.
    heardChatId = last?.id ?? '';
    chatSeen = feed.length;
  } else if (last && last.id !== heardChatId) {
    const from = feed.findIndex((m) => m.id === heardChatId);
    // No anchor, or one that has scrolled off the server's window: everything
    // in hand is news.
    const fresh = from >= 0 ? feed.slice(from + 1) : feed;
    heardChatId = last.id;
    // Your own line is not news to you. A chat line carries a name and not an
    // id, and a table cannot hold two of the same name, so the name is enough.
    // Pass & play on the web is a second window with its own identity, so
    // this window has exactly one voice of its own to ignore.
    const mine = myName();
    if (fresh.some((m) => m.name !== mine)) sfx.pop();
  }
  if (document.body.classList.contains('chat-open')) chatSeen = chatCount(s);
  paintChatBadge();
}

/** This window's own seat name. */
function myName() {
  return state?.players?.find((p) => p.id === meId)?.name || '';
}

// ---- chat channels (everyone / team) ------------------------------------
let chatChannel = 'all';
const channelBar = $('#chatChannels');
channelBar.querySelectorAll('button').forEach((b) => {
  b.onclick = () => {
    sfx.click();
    chatChannel = b.dataset.ch;
    channelBar.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    if (state) renderChat(state, $('#chatList'), chatChannel);
    $('#chatInput').placeholder = chatChannel === 'team' ? 'Message your team…' : 'Say something…';
  };
});

/** The team channel only shows up when this player is actually on a team. */
function syncChatChannels(s) {
  const me = s.players.find((p) => p.id === meId);
  const hasTeam = (s.settings?.teams || 0) > 0 && me?.team != null;
  channelBar.classList.toggle('hidden', !hasTeam);
  if (!hasTeam && chatChannel !== 'all') {
    chatChannel = 'all';
    channelBar.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.ch === 'all'));
    $('#chatInput').placeholder = 'Say something…';
  }
}

// ---- focus mode ---------------------------------------------------------
const FOCUS_KEY = 'moneymove:focus';
const focusBtn = $('#focusBtn');

function paintFocus() {
  const on = document.body.classList.contains('focus-board');
  focusBtn.classList.toggle('on', on);
  focusBtn.title = on ? 'Show the side panel' : 'Hide the side panel and enlarge the board';
  // Focus mode fades out the whole panel this button lives in — and the choice
  // is remembered — so left where it is, it is the switch that turns itself
  // off and cannot be turned back on. It moves to the corner of the screen
  // instead, and goes home to the toolbar when the panel comes back.
  focusBtn.classList.toggle('floating', on);
  const host = on ? document.body : $('.brand-actions');
  if (focusBtn.parentElement !== host) {
    if (on) host.appendChild(focusBtn);
    else host.prepend(focusBtn);
  }
  // the board grew or shrank, so the tokens need to find their tiles again
  requestAnimationFrame(() => safe('reposition', () => repositionTokens(state)));
}

try {
  if (localStorage.getItem(FOCUS_KEY) === 'on') document.body.classList.add('focus-board');
} catch { /* private mode */ }

focusBtn.onclick = () => {
  const on = document.body.classList.toggle('focus-board');
  try { localStorage.setItem(FOCUS_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  sfx.click();
  paintFocus();
  setTimeout(() => safe('reposition', () => repositionTokens(state)), 320);
};
paintFocus();

// ---- light / dark -------------------------------------------------------
const THEME_KEY = 'moneymove:theme';
const readTheme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

/**
 * The browser's own chrome — the status bar on a phone, the tab strip on a
 * desktop — wearing the table the player picked. Theme and palette both move
 * it, so it is read back off the page rather than kept in a second list here.
 */
function paintThemeColour() {
  const tag = $('#themeColor');
  const page = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
  if (tag && page) tag.setAttribute('content', page);
}

function paintThemeButtons() {
  const dark = readTheme() === 'dark';
  document.querySelectorAll('#themeBtn, #themeBtnLanding').forEach((b) => {
    b.innerHTML = icon(dark ? 'sun' : 'moon', null, 'solo');
    b.title = dark ? 'Switch to light' : 'Switch to dark';
    b.setAttribute('aria-label', b.title);
  });
}

function toggleTheme() {
  const next = readTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
  paintThemeButtons();
  paintThemeColour();
  sfx.click();
}

document.querySelectorAll('#themeBtn, #themeBtnLanding').forEach((b) => { b.onclick = toggleTheme; });
paintThemeButtons();
paintThemeColour();

// ---- table styles (7 palettes, each with its own light + dark) ----------
const PALETTE_KEY = 'moneymove:palette';
const PALETTES = [
  { id: 'felt', name: 'Midnight Felt', dot: '#2e7d5b' },
  { id: 'crimson', name: 'Crimson Classic', dot: '#d92037' },
  { id: 'royale', name: 'Purple Royale', dot: '#8b5cf6' },
  { id: 'blush', name: 'Blush Pink', dot: '#f472b6' },
  { id: 'marine', name: 'Deep Marine', dot: '#38bdf8' },
  { id: 'sands', name: 'Desert Sands', dot: '#f59e0b' },
  { id: 'noir', name: 'Silver Noir', dot: '#c9a86a' },
];

const paletteBar = document.createElement('div');
paletteBar.id = 'paletteBar';
paletteBar.className = 'palette-bar hidden';
paletteBar.innerHTML = PALETTES.map((p) =>
  `<button class="pswatch" data-pal="${p.id}" title="${p.name}" aria-label="${p.name}" style="--dot:${p.dot}"></button>`).join('');
document.body.appendChild(paletteBar);

function currentPalette() { return document.documentElement.dataset.palette || 'felt'; }
function paintPaletteBar() {
  paletteBar.querySelectorAll('.pswatch').forEach((b) =>
    b.classList.toggle('on', b.dataset.pal === currentPalette()));
}
paletteBar.querySelectorAll('.pswatch').forEach((b) => {
  b.onclick = () => {
    const id = b.dataset.pal;
    if (id === 'felt') delete document.documentElement.dataset.palette;
    else document.documentElement.dataset.palette = id;
    try { localStorage.setItem(PALETTE_KEY, id); } catch { /* private mode */ }
    paintPaletteBar();
    paintThemeColour();
    sfx.click();
  };
});
document.querySelectorAll('#paletteBtn, #paletteBtnLanding').forEach((b) => {
  b.onclick = (e) => {
    sfx.click();
    const r = e.currentTarget.getBoundingClientRect();
    paletteBar.style.top = `${Math.min(innerHeight - 60, r.bottom + 8)}px`;
    paletteBar.style.left = `${Math.max(8, Math.min(innerWidth - 268, r.left - 110))}px`;
    paletteBar.classList.toggle('hidden');
    paintPaletteBar();
  };
});
document.addEventListener('click', (e) => {
  if (!paletteBar.contains(e.target) && !e.target.closest?.('#paletteBtn, #paletteBtnLanding')) {
    paletteBar.classList.add('hidden');
  }
});

// Follow the system only while the player hasn't chosen for themselves.
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  if (saved) return;
  document.documentElement.dataset.theme = e.matches ? 'dark' : 'light'; // e is the dark query
  paintThemeButtons();
  paintThemeColour();
});

const soundBtn = $('#soundBtn');
const paintSoundBtn = () => {
  soundBtn.innerHTML = icon(isEnabled() ? 'soundOn' : 'soundOff', null, 'solo');
  soundBtn.title = isEnabled() ? 'Turn sound off' : 'Turn sound on';
  soundBtn.setAttribute('aria-label', soundBtn.title);
};
paintSoundBtn();
soundBtn.addEventListener('click', () => {
  setEnabled(!isEnabled());
  paintSoundBtn();
  if (isEnabled()) sfx.click();
});
document.addEventListener('pointerdown', unlock, { once: true });

// tile hover tooltip + click for the full deed
const tip = $('#tooltip');
const board = $('#board');
board.addEventListener('mousemove', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile || !state) { tip.classList.add('hidden'); return; }
  const html = deedMarkup(state, Number(tile.dataset.i), { compact: true });
  if (!html) { tip.classList.add('hidden'); return; }
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  const rect = tip.getBoundingClientRect();
  const pad = 16;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + rect.width > innerWidth) x = e.clientX - rect.width - pad;
  if (y + rect.height > innerHeight) y = innerHeight - rect.height - pad;
  tip.style.left = `${Math.max(pad, x)}px`;
  tip.style.top = `${Math.max(pad, y)}px`;
});
board.addEventListener('mouseleave', () => tip.classList.add('hidden'));
board.addEventListener('click', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile || !state) return;
  tip.classList.add('hidden');
  openDeedModal(state, Number(tile.dataset.i), meId, actions);
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => repositionTokens(state), 120);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    $('#cardPopup').classList.add('hidden');
    if (document.body.classList.contains('chat-open')) closeChatDock();
  }
  if (document.activeElement?.tagName === 'INPUT') return;
  // A sheet on top owns the keyboard: Space must not reach through a trade
  // composer or a "declare bankruptcy?" prompt and fire the board behind it.
  if (!$('#modalRoot').classList.contains('hidden')) return;
  if (e.key === ' ' || e.key === 'Enter') {
    const btn = document.querySelector('#centerAction .btn.primary, #centerAction .btn.good');
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  }
  if (e.key === 'c' || e.key === 'C') $('#chatInput')?.focus();
});

window.addEventListener('popstate', boot);
boot();
