// Friends panel on the landing page. Backed by /api/friends, which keys
// everything off the same identity token the game already uses.

import { api } from './net.js';
import { escapeHtml } from './board.js';
import { icon } from './icons.js';
import { openDmModal, confirmModal, openModal, closeModal } from './ui.js';

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

/** The friends we last heard about, so the card and the room agree. */
let friends = [];
let joinHandler = null;
let toastHandler = () => {};

/** Registers this browser's profile and returns its friend code. */
export async function initSocial({ token, name, flag, onToast, onJoin }) {
  myToken = token;
  joinHandler = onJoin;
  toastHandler = onToast;
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

  const card = $('#friendsCard');
  if (card) card.onclick = () => openFriendsModal();

  await refreshFriends(token);
  clearInterval(pollTimer);
  pollTimer = setInterval(() => refreshFriends(token), 10000);
  return myCode;
}

export function stopSocial() {
  clearInterval(pollTimer);
  pollTimer = null;
}

const STATUS = {
  lobby: { label: 'waiting in a lobby', cls: 'lobby' },
  playing: { label: 'in a game', cls: 'playing' },
  ended: { label: 'finishing up', cls: 'lobby' },
  offline: { label: 'offline', cls: 'off' },
};

const onlineCount = () => friends.filter((f) => (f.status || 'offline') !== 'offline').length;

async function refreshFriends(token) {
  try {
    friends = await fetch(api(`/api/friends?token=${encodeURIComponent(token)}`)).then((r) => r.json());
  } catch {
    return; // keep whatever is on screen rather than blanking it on a blip
  }
  // Whoever you can actually walk in on floats to the top: that is the row
  // with something to do on it.
  const rank = (f) => (f.status === 'lobby' ? 0 : f.status === 'playing' ? 1 : 2);
  friends.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const sub = $('#friendsSub');
  if (sub) {
    const on = onlineCount();
    sub.textContent = !friends.length ? 'Swap codes and play together'
      : on ? `${friends.length} · ${on} on right now`
        : `${friends.length} · nobody on right now`;
    sub.classList.toggle('on', on > 0);
  }
  // Keep an open room in step with the poll.
  if (document.querySelector('.friends-modal')) paintFriendList();
}

/**
 * The room behind the card.
 *
 * Everything friends-shaped used to be stacked on one card on the landing:
 * your code, the add box, and the whole list. Fine for two friends and
 * unreadable for twenty, and the two things people come here to do — hand out
 * their code, and get into a friend's game — were the hardest to find.
 */
export function openFriendsModal() {
  openModal(`<div class="chart-head">
      <div>
        <h2>Friends</h2>
        <p class="sub">Swap codes, message, and drop into each other's tables.</p>
      </div>
      <button class="icon-btn" id="friendsClose" title="Close">✕</button>
    </div>
    <div class="fm-code">
      <div class="fm-code-label">Your friend code</div>
      <div class="fm-code-value">${escapeHtml(myCode || '······')}</div>
      <div class="row-2">
        <button class="btn ghost small" id="fmCopy">${icon('key', 13)} Copy</button>
        <button class="btn ghost small" id="fmShare">${icon('people', 13)} Share</button>
      </div>
      <p class="fm-hint">Give this to somebody and they can add you. Adding works both ways — you will each appear on the other's list.</p>
    </div>
    <div class="chart-label">Add a friend</div>
    <form class="fm-add" id="fmAdd">
      <input id="fmCode" class="code-input" maxlength="6" placeholder="THEIR CODE" autocomplete="off" />
      <button class="btn gold" type="submit">Add</button>
    </form>
    <div class="chart-label" id="fmListLabel">Your friends</div>
    <div id="friendList" class="friend-list"></div>`, (root) => {
    $('#friendsClose', root).onclick = closeModal;
    $('#fmCopy', root).onclick = async () => {
      try {
        await navigator.clipboard.writeText(myCode);
        toastHandler('Friend code copied');
      } catch { toastHandler(`Your code is ${myCode}`); }
    };
    $('#fmShare', root).onclick = async () => {
      const text = `Add me on MoneyMove — my friend code is ${myCode}. https://www.moneymove.live`;
      // The share sheet where there is one, the clipboard where there is not.
      try {
        if (navigator.share) await navigator.share({ text });
        else { await navigator.clipboard.writeText(text); toastHandler('Invite copied'); }
      } catch { /* the sheet was dismissed, which is an answer */ }
    };
    $('#fmAdd', root).onsubmit = async (e) => {
      e.preventDefault();
      const input = $('#fmCode', root);
      const code = input.value.trim().toUpperCase();
      if (!code) return;
      try {
        const { friend } = await post('/api/friends', { token: myToken, code });
        input.value = '';
        toastHandler(`${friend.name} added`);
        await refreshFriends(myToken);
      } catch (err) {
        toastHandler(err.message, 'error');
      }
    };
    paintFriendList();
  }, 'friends-modal');
}

function paintFriendList() {
  const el = $('#friendList');
  if (!el) return;
  const label = $('#fmListLabel');
  if (label) {
    const on = onlineCount();
    label.textContent = friends.length
      ? `Your friends (${friends.length})${on ? ` · ${on} on right now` : ''}`
      : 'Your friends';
  }
  if (!friends.length) {
    el.innerHTML = `<div class="fm-empty">${icon('people', 26, 'solo')}
      <b>Nobody yet</b>
      <span>Send somebody your code, or type theirs in above. Once you are friends you can message them and drop straight into their table.</span>
    </div>`;
    return;
  }

  el.innerHTML = friends.map((f) => {
    const s = STATUS[f.status] || STATUS.offline;
    // Their game is already under way: the seats are shut, so promise a look
    // rather than a seat — "Join" only to end up watching reads as a failure.
    const started = f.status !== 'lobby';
    return `<div class="friend">
      <span class="friend-flag ${s.cls}">${f.avatar || f.flag
      ? escapeHtml(f.avatar || f.flag)
      : icon('people', 16, 'solo')}</span>
      <span class="friend-who">
        <b>${escapeHtml(f.name)}</b>
        <span class="friend-status ${s.cls}">${s.label} <i>${escapeHtml(f.code)}</i></span>
      </span>
      <button class="icon-btn" data-chat="${escapeHtml(f.code)}" data-name="${escapeHtml(f.name)}"
        title="Message ${escapeHtml(f.name)}" aria-label="Message ${escapeHtml(f.name)}">${icon('chat', null, 'solo')}</button>
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
    b.onclick = () => { closeModal(); joinHandler?.(b.dataset.join); };
  });
  // Removing is mutual and there is no undo, and the ✕ sits a thumb's width
  // from Message and Join — worth one question first.
  el.querySelectorAll('[data-drop]').forEach((b) => {
    b.onclick = () => confirmModal(
      `Remove ${b.dataset.name}?`,
      'You drop off each other\'s lists, and you would both have to swap codes again.',
      async () => {
        await post('/api/friends/remove', { token: myToken, code: b.dataset.drop }).catch(() => {});
        await refreshFriends(myToken);
        openFriendsModal();
      },
    );
  });
}
