// Entry point: identity, landing screen, socket wiring and the render loop.

import {
  renderBoard, patchBoard, resetBoard, highlightTiles,
  syncTokens, repositionTokens, deedMarkup,
} from './board.js';
import {
  renderPlayers, renderRightPanel, renderCenter, renderLog, renderChat,
  renderDice, toast, showCard, showGameOver, closeModal, showTurnBanner,
  confetti, openDeedModal, openHelpModal,
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

if (location.hash === '#newplayer') {
  sessionStorage.setItem(TOKEN_KEY, newId());
  sessionStorage.setItem(NAME_KEY, '');
  history.replaceState({}, '', location.pathname);
}

let token = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
if (!token) {
  token = newId();
  localStorage.setItem(TOKEN_KEY, token);
}
const isLocalGuest = !!sessionStorage.getItem(TOKEN_KEY);
const storeName = (name) => (isLocalGuest ? sessionStorage : localStorage).setItem(NAME_KEY, name);
let nickname = (isLocalGuest ? sessionStorage.getItem(NAME_KEY) : localStorage.getItem(NAME_KEY)) || '';

const FLAG_KEY = 'moneymove:flag';
const storeFlag = (f) => (isLocalGuest ? sessionStorage : localStorage).setItem(FLAG_KEY, f);
let myFlag = (isLocalGuest ? sessionStorage.getItem(FLAG_KEY) : localStorage.getItem(FLAG_KEY)) || '';

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
  loadPublicRooms();
  initSocial({
    token, name: nickname, flag: myFlag,
    onToast: toast,
    onJoin: (id) => go(id),
  });
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
  if (!match) return showLanding();

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
  socket.on('state', (s) => { state = s; render(); });
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
  safe('chat', () => renderChat(state, $('#chatList')));

  $('#shareCard').classList.toggle('hidden', state.status !== 'lobby');
  document.body.classList.toggle('my-turn', state.turn?.playerId === meId && state.status === 'playing');

  playSoundsForNewEvents();

  // turn banner
  if (state.status === 'playing' && state.turn?.playerId && state.turn.playerId !== lastTurnId) {
    lastTurnId = state.turn.playerId;
    const p = state.players.find((x) => x.id === lastTurnId);
    if (p) { showTurnBanner(p, p.id === meId); if (p.id === meId) sfx.turn(); }
  }

  // drawn card
  if (state.lastCard && state.lastCard.at !== lastCardAt) {
    lastCardAt = state.lastCard.at;
    $('#cardPopup').classList.remove('hidden');
    showCard(state.lastCard);
  }

  // game over
  if (state.status === 'ended' && !winnerShown) {
    winnerShown = true;
    sfx.win();
    confetti();
    setTimeout(() => showGameOver(state, meId, actions), 700);
  }
  if (state.status !== 'ended') winnerShown = false;
}

/** Turns fresh log lines into sound effects. */
function playSoundsForNewEvents() {
  const fresh = state.log.filter((l) => l.at > lastLogAt);
  if (!fresh.length) return;
  lastLogAt = state.log[state.log.length - 1].at;
  const kinds = new Set(fresh.map((l) => l.kind));
  if (kinds.has('bankrupt')) return sfx.bankrupt();
  if (kinds.has('rent')) return sfx.rent();
  if (kinds.has('buy')) return sfx.buy();
  if (kinds.has('jail')) return sfx.jail();
  if (kinds.has('build')) return sfx.build();
  if (kinds.has('trade')) return sfx.trade();
  if (kinds.has('auction')) return sfx.auction();
  if (kinds.has('money')) return sfx.cash();
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

$('#leaveBtn').addEventListener('click', () => {
  history.pushState({}, '', '/');
  if (socket) { socket.close(); socket = null; }
  state = null;
  resetBoard();
  showLanding();
});

const EMOTES = ['👍', '😂', '😱', '🔥', '💸', '🎲', '😭', '🤝', '🏠', '🤡'];
const emoteRow = $('#emoteRow');
emoteRow.innerHTML = EMOTES.map((e) => `<button class="emote" type="button">${e}</button>`).join('');
emoteRow.querySelectorAll('.emote').forEach((b) => {
  b.onclick = () => { sfx.click(); actions.chat(b.textContent); };
});

$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) return;
  actions.chat(text);
  input.value = '';
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
