// Friends panel on the landing page. Backed by /api/friends, which keys
// everything off the same identity token the game already uses.

import { api } from './net.js';
import { escapeHtml } from './board.js';
import { openDmModal, confirmModal } from './ui.js';

let myToken = '';

const $ = (s) => document.querySelector(s);

let myCode = '';
let pollTimer = null;

const post = (path, body) => fetch(api(path), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then(async (r) => {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
});

/** Registers this browser's profile and returns its friend code. */
export async function initSocial({ token, name, flag, onToast, onJoin }) {
  myToken = token;
  try {
    const me = await post('/api/profile', { token, name, flag });
    myCode = me.code;
    $('#myCode').textContent = myCode;
    // A blip on an earlier visit had hidden the card for good.
    $('#friendsCard')?.classList.remove('hidden');
  } catch {
    // The server is unreachable — the friends card is useless, so hide it.
    $('#friendsCard')?.classList.add('hidden');
    return null;
  }

  $('#myCode').onclick = async () => {
    try {
      await navigator.clipboard.writeText(myCode);
      onToast('Friend code copied — send it to a friend');
    } catch {
      onToast(`Your code is ${myCode}`);
    }
  };

  $('#addFriendForm').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#friendCode');
    const code = input.value.trim().toUpperCase();
    if (!code) return;
    try {
      const { friend } = await post('/api/friends', { token, code });
      input.value = '';
      onToast(`${friend.name} added`);
      refreshFriends(token, onJoin);
    } catch (err) {
      onToast(err.message, 'error');
    }
  };

  refreshFriends(token, onJoin);
  clearInterval(pollTimer);
  pollTimer = setInterval(() => refreshFriends(token, onJoin), 10000);
  return myCode;
}

export function stopSocial() {
  clearInterval(pollTimer);
  pollTimer = null;
}

const STATUS = {
  lobby: { label: 'in a lobby', cls: 'lobby' },
  playing: { label: 'in a game', cls: 'playing' },
  ended: { label: 'finishing up', cls: 'lobby' },
  offline: { label: 'offline', cls: 'off' },
};

async function refreshFriends(token, onJoin) {
  let friends = [];
  try {
    friends = await fetch(api(`/api/friends?token=${encodeURIComponent(token)}`)).then((r) => r.json());
  } catch {
    return; // keep whatever is on screen rather than blanking it on a blip
  }

  const el = $('#friendList');
  if (!el) return;
  if (!friends.length) {
    el.innerHTML = '<div class="empty small">No friends yet — swap codes to add each other.</div>';
    return;
  }

  // People you can actually join float to the top.
  friends.sort((a, b) => (b.roomId ? 1 : 0) - (a.roomId ? 1 : 0) || a.name.localeCompare(b.name));

  el.innerHTML = friends.map((f) => {
    const s = STATUS[f.status] || STATUS.offline;
    // Their game is already under way: the seats are shut, so promise a look
    // rather than a seat — "Join" only to end up watching reads as a failure.
    const started = f.status !== 'lobby';
    return `<div class="friend">
      <span class="friend-flag">${escapeHtml(f.avatar || f.flag || '🙂')}</span>
      <span class="friend-name">${escapeHtml(f.name)}</span>
      <span class="friend-status ${s.cls}">${s.label}</span>
      <button class="icon-btn" data-chat="${escapeHtml(f.code)}" data-name="${escapeHtml(f.name)}" title="Chat">💬</button>
      ${f.roomId ? `<button class="btn tiny ${started ? '' : 'primary'}" data-join="${escapeHtml(f.roomId)}"
          title="${started ? 'Their game has started — you can watch it' : 'Take a seat at their table'}"
        >${started ? 'Watch' : 'Join'}</button>` : ''}
      <button class="icon-btn tiny-x" data-drop="${escapeHtml(f.code)}" data-name="${escapeHtml(f.name)}"
        title="Remove ${escapeHtml(f.name)}" aria-label="Remove ${escapeHtml(f.name)}">✕</button>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-chat]').forEach((b) => {
    b.onclick = () => openDmModal(myToken, b.dataset.chat, b.dataset.name);
  });
  el.querySelectorAll('[data-join]').forEach((b) => {
    b.onclick = () => onJoin(b.dataset.join);
  });
  // Removing is mutual and there is no undo, and the ✕ sits a thumb's width
  // from Chat and Join — worth one question first.
  el.querySelectorAll('[data-drop]').forEach((b) => {
    b.onclick = () => confirmModal(
      `Remove ${b.dataset.name}?`,
      'You drop off each other\'s lists, and you would both have to swap codes again.',
      async () => {
        await post('/api/friends/remove', { token, code: b.dataset.drop }).catch(() => {});
        refreshFriends(token, onJoin);
      },
    );
  });
}
