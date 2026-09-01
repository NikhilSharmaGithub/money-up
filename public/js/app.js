// Entry point: identity, landing screen, socket wiring and the render loop.

import {
  renderBoard, patchBoard, resetBoard, highlightTiles,
  syncTokens, repositionTokens, deedMarkup,
} from './board.js';
import {
  renderPlayers, renderRightPanel, renderCenter, renderLog, renderChat,
  renderDice, toast, showCard, showGameOver, closeModal, showTurnBanner,
  confetti, openDeedModal, openHelpModal, openStoreModal, openJoinNameModal,
  openLeaveModal, showRemovedOverlay, randomName, syncTurnClock, syncOpenModals,
  renderAwaiting,
} from './ui.js';
import { icon } from './icons.js';
import { sfx, setEnabled, isEnabled, unlock } from './sound.js';
import { api, connect, isSplitDeploy, SERVER, useServer, forgetServer } from './net.js';
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

  // Tables stepped away from mid-game get a way back in.
  renderResumeList();

  refreshWallet();
  refreshProfileChip();
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

// ---- sign in with Google (only when the server has a client id) ----------
let googleInitDone = false;
/**
 * The signed-in state, made visible: a photo chip by the theme buttons with
 * the account behind it one tap away. Signing in used to change almost
 * nothing on screen, which read as the button not working.
 */
async function refreshProfileChip() {
  const chip = $('#profileChip');
  const menu = $('#profileMenu');
  if (!chip) return;
  let me = null;
  try {
    me = await fetch(api(`/api/me?token=${encodeURIComponent(token)}`)).then((r) => r.json());
  } catch { return; }
  if (!me?.provider) {
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
        <button class="btn small wide" id="pmSignOut">Sign out</button>
      </div>`;
    menu.classList.remove('hidden');
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
              body: JSON.stringify({ token, credential: resp.credential }),
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
    resetBoard();
    return showLanding();
  }

  roomId = match[1].toLowerCase();
  // Nothing on the landing is on screen any more — stop polling for it.
  clearInterval(roomsTimer);
  stopSocial();
  $('#landing').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#shareLink').value = `${location.origin}/?room=${roomId}`;
  resetBoard();
  lastTurnId = null;
  winnerShown = false;
  removedShown = false;

  if (socket) socket.close();
  socket = connect();

  socket.on('connect', () => socket.emit('join', { roomId, token, name: nickname || 'Player', flag: myFlag }));
  socket.on('you', (d) => { meId = d.playerId; });
  socket.on('state', (s) => {
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
    onStep: () => sfx.step(),
    onArrive: () => highlightTiles(state),
  }));
  if (rebuilt) requestAnimationFrame(() => safe('reposition', () => repositionTokens(state)));

  safe('awaiting', () => renderAwaiting(state, meId, $('#awaitingWell'), actions));
  safe('players', () => renderPlayers(state, meId, $('#playerList'), actions));
  safe('panel', () => renderRightPanel(state, meId, $('#rightPanel'), actions));
  safe('center', () => renderCenter(state, meId, actions));
  safe('dice', () => renderDice(state));
  safe('clock', () => syncTurnClock(state, meId));
  safe('modals', () => syncOpenModals(state));
  safe('log', () => renderLog(state, $('#logList')));
  safe('chatChannels', () => syncChatChannels(state));
  safe('chat', () => renderChat(state, $('#chatList'), chatChannel));

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
    // Nothing left to come back to, so the shelf must stop offering it.
    forgetGame(roomId);
  }
  if (state.status === 'ended' && !winnerShown) {
    winnerShown = true;
    sfx.win();
    confetti();
    setTimeout(() => showGameOver(state, meId, actions), 700);
    // did the win pay out? the wallet knows
    setTimeout(() => refreshWallet({ celebrate: true }), 1200);
  }
  if (state.status !== 'ended') winnerShown = false;
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

  const fresh = state.log.filter((l) => l.at > lastLogAt);
  if (!fresh.length) return;
  lastLogAt = state.log[state.log.length - 1].at;
  const kinds = new Set(fresh.map((l) => l.kind));
  if (kinds.has('bankrupt')) return sfx.bankrupt();
  if (!myDelta && kinds.has('rent')) return sfx.rent();
  if (kinds.has('buy')) return sfx.buy();
  if (kinds.has('jail')) return sfx.jail();
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

$('#helpBtn').addEventListener('click', () => { sfx.click(); openHelpModal(); });

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

/** Drops the socket, clears the board and puts the landing back on screen. */
function goHome() {
  history.pushState({}, '', '/');
  closeModal();
  $('#cardPopup').classList.add('hidden');
  if (socket) { socket.close(); socket = null; }
  state = null;
  roomId = null;
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
  sfx.click();
}

document.querySelectorAll('#themeBtn, #themeBtnLanding').forEach((b) => { b.onclick = toggleTheme; });
paintThemeButtons();

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
  if (e.key === 'Escape') { closeModal(); $('#cardPopup').classList.add('hidden'); }
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
