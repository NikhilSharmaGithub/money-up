// Entry point: identity, landing screen, socket wiring and the render loop.

import {
  renderBoard, patchBoard, resetBoard, highlightTiles,
  syncTokens, repositionTokens, deedMarkup,
} from './board.js';
import {
  renderPlayers, renderRightPanel, renderCenter, renderLog, renderChat,
  renderDice, toast, showCard, showGameOver, closeModal, showTurnBanner,
  confetti, openDeedModal, openHelpModal, openStoreModal,
} from './ui.js';
import { sfx, setEnabled, isEnabled, unlock } from './sound.js';
import { api, connect, isSplitDeploy, SERVER, useServer, forgetServer } from './net.js';
import { initSocial } from './social.js';

const $ = (s) => document.querySelector(s);

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
  chat: emit('chat'),
  rematch: emit('rematch'),
};

// ──────────────────────────────────────────────────────────────── landing ──
function showLanding() {
  $('#landing').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $('#nickInput').value = nickname;

  // A table you stepped away from mid-game gets a way back in.
  let lastRoom = null;
  try { lastRoom = localStorage.getItem('moneymove:lastRoom'); } catch { /* private mode */ }
  const cont = $('#continueBtn');
  cont.classList.toggle('hidden', !lastRoom);
  if (lastRoom) {
    cont.textContent = `▶️ Continue game — room ${lastRoom}`;
    cont.onclick = () => { sfx.click(); go(lastRoom); };
  }

  refreshCoins();
  loadPublicRooms();
  initGoogleSignIn();
  initSocial({
    token, name: nickname, flag: myFlag,
    onToast: toast,
    onJoin: (id) => go(id),
  });
}

// ---- store & coins -------------------------------------------------------
let knownCoins = null;

async function refreshCoins({ celebrate = false } = {}) {
  try {
    const w = await fetch(api(`/api/wallet?token=${encodeURIComponent(token)}`)).then((r) => r.json());
    if (typeof w.coins !== 'number') return;
    const chip = $('#coinChip');
    if (chip) chip.textContent = `🪙 ${w.coins}`;
    if (celebrate && knownCoins != null && w.coins > knownCoins) {
      toast(`🪙 +${w.coins - knownCoins} coin${w.coins - knownCoins > 1 ? 's' : ''} earned — spend them in the Store!`);
    }
    knownCoins = w.coins;
  } catch { /* server nap — the chip just stays put */ }
}

$('#storeBtn').addEventListener('click', () => {
  sfx.click();
  openStoreModal(token);
});

// ---- sign in with Google (only when the server has a client id) ----------
let googleInitDone = false;
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

function loadPublicRooms() {
  fetch(api('/api/rooms')).then((r) => r.json()).then((rooms) => {
    const el = $('#publicRooms');
    if (!rooms.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="pr-title">Public rooms</div>' + rooms.map((r) => `
      <button class="public-room" data-room="${r.id}">
        <span>${r.map}</span><span class="dim">${r.players}/${r.maxPlayers} · ${r.id}</span>
      </button>`).join('');
    el.querySelectorAll('[data-room]').forEach((c) => { c.onclick = () => go(c.dataset.room); });
  }).catch(() => {});
}

function go(id) {
  history.pushState({}, '', `/room/${id}`);
  boot();
}

$('#nickInput').addEventListener('change', (e) => {
  nickname = e.target.value.trim().slice(0, 16);
  storeName(nickname);
});

$('#createBtn').addEventListener('click', () => {
  unlock(); sfx.click();
  nickname = $('#nickInput').value.trim().slice(0, 16) || 'Player';
  storeName(nickname);

  const btn = $('#createBtn');
  btn.disabled = true;
  btn.dataset.label ||= btn.innerHTML;
  btn.innerHTML = '<span class="btn-ico">⏳</span> Creating…';

  const s = connect({ timeout: 8000, reconnectionAttempts: 2 });
  let settled = false;
  const giveUp = (why) => {
    if (settled) return;
    settled = true;
    s.close();
    btn.disabled = false;
    btn.innerHTML = btn.dataset.label;
    serverUnreachable(why);
  };

  const bail = setTimeout(() => giveUp('The game server did not respond.'), 9000);
  s.on('connect_error', () => giveUp('Could not reach the game server.'));
  s.emit('createRoom', {}, ({ roomId: id }) => {
    if (settled) return;
    settled = true;
    clearTimeout(bail);
    s.close();
    // Restore the button before leaving — coming back to the landing later
    // must not find it stuck on "Creating…".
    btn.disabled = false;
    btn.innerHTML = btn.dataset.label;
    go(id);
  });
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
      <b>⚠️ Can't reach the game server</b>
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

$('#joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  unlock(); sfx.click();
  nickname = $('#nickInput').value.trim().slice(0, 16) || 'Player';
  storeName(nickname);
  const code = $('#codeInput').value.trim().toLowerCase();
  if (code) go(code);
});

// ─────────────────────────────────────────────────────────────────── boot ──
function boot() {
  const match = location.pathname.match(/^\/room\/([a-z0-9]+)/i);
  if (!match) {
    // Reached via browser Back mid-game: release the seat properly (a held
    // socket would stall the room) and leave a way back in.
    if (state?.status === 'playing' && roomId) {
      try { localStorage.setItem(LAST_ROOM_KEY, roomId); } catch { /* blocked */ }
    }
    if (socket) { socket.close(); socket = null; }
    state = null;
    roomId = null;
    resetBoard();
    return showLanding();
  }

  roomId = match[1].toLowerCase();
  $('#landing').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#shareLink').value = `${location.origin}/room/${roomId}`;
  resetBoard();
  lastTurnId = null;
  winnerShown = false;

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
    }
    state = s;
    render();
  });
  socket.on('toast', (t) => toast(t.message, t.type));
  socket.on('joinFailed', (d) => toast(d.message, 'error'));
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

  safe('players', () => renderPlayers(state, meId, $('#playerList'), actions));
  safe('panel', () => renderRightPanel(state, meId, $('#rightPanel'), actions));
  safe('center', () => renderCenter(state, meId, actions));
  safe('dice', () => renderDice(state));
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
    const mv = state.lastMove;
    const steps = mv && mv.steps && Math.abs(mv.at - card.at) < 2500 ? Math.abs(mv.steps) : 0;
    const delay = steps ? steps * 120 + 350 : 0;
    setTimeout(() => {
      if (state?.lastCard?.at !== card.at) return; // superseded meanwhile
      $('#cardPopup').classList.remove('hidden');
      showCard(card);
    }, delay);
  }

  // game over
  if (state.status === 'ended' && !winnerShown) {
    winnerShown = true;
    sfx.win();
    confetti();
    setTimeout(() => showGameOver(state, meId, actions), 700);
    // did the win pay out? the wallet knows
    setTimeout(() => refreshCoins({ celebrate: true }), 1200);
  }
  if (state.status !== 'ended') winnerShown = false;
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

const LAST_ROOM_KEY = 'moneymove:lastRoom';

$('#leaveBtn').addEventListener('click', () => {
  // Mid-game, leaving deserves a second thought — a bot holds the seat and
  // the landing screen offers a way back in.
  if (state?.status === 'playing') {
    const stay = !window.confirm('Game chal rahi hai! A bot will hold your seat — you can continue from the home screen. Leave?');
    if (stay) return;
    try { localStorage.setItem(LAST_ROOM_KEY, roomId || ''); } catch { /* private mode */ }
  } else {
    try { localStorage.removeItem(LAST_ROOM_KEY); } catch { /* private mode */ }
  }
  history.pushState({}, '', '/');
  if (socket) { socket.close(); socket = null; }
  state = null;
  resetBoard();
  showLanding();
});

// Closing the tab mid-game gets the browser's own "are you sure".
window.addEventListener('beforeunload', (e) => {
  if (state?.status !== 'playing') return;
  try { localStorage.setItem(LAST_ROOM_KEY, roomId || ''); } catch { /* private mode */ }
  e.preventDefault();
  e.returnValue = '';
});

const EMOTES = ['👍', '😂', '😱', '🔥', '💸', '🎲', '😭', '🤝', '🏠', '🤡'];
const emoteRow = $('#emoteRow');
emoteRow.innerHTML = EMOTES.map((e) => `<button class="emote" type="button">${e}</button>`).join('');
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
    b.textContent = dark ? '☀️' : '🌙';
    b.title = dark ? 'Switch to light' : 'Switch to dark';
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
  `<button class="pswatch" data-pal="${p.id}" title="${p.name}" style="--dot:${p.dot}"></button>`).join('');
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
soundBtn.textContent = isEnabled() ? '🔊' : '🔇';
soundBtn.addEventListener('click', () => {
  setEnabled(!isEnabled());
  soundBtn.textContent = isEnabled() ? '🔊' : '🔇';
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
  if (e.key === ' ' || e.key === 'Enter') {
    const btn = document.querySelector('#centerAction .btn.primary, #centerAction .btn.good');
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  }
  if (e.key === 'c' || e.key === 'C') $('#chatInput')?.focus();
});

window.addEventListener('popstate', boot);
boot();
