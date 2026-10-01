// Friends panel on the landing page (and the same sheet from a table's lobby),
// plus the invites that arrive wherever this browser is. Backed by
// /api/friends, which keys everything off the same identity token the game
// already uses.

import { api } from './net.js';
import { escapeHtml } from './board.js';
import { icon } from './icons.js';
import { openDmModal, confirmModal, openModal, closeModal } from './ui.js';

let myToken = '';

const $ = (s) => document.querySelector(s);

let myCode = '';
let pollTimer = null;
let inviteTimer = null;

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
let requests = [];      // people who have asked to be friends
let sentAsks = [];      // people this player has asked
let joinHandler = null;
let toastHandler = () => {};
/** Which room this browser is sitting in, so a friend can be invited to it. */
let roomOf = () => null;
/**
 * Opens a private table the way "Create a private game" does and resolves
 * with its id once this browser is on its way in, or with null when no table
 * came back (the landing has already said why). app.js owns the socket dance.
 */
let createTable = null;
/** What /api/profile is told, kept for a friends sheet opened at a table. */
let myName = '';
let myFlag = '';
/** The invite on screen, so a repaint does not re-announce the same one. */
let invitedBy = '';
/** The invite last answered or waved off here, so its notification goes quiet. */
let answered = '';

/** Whoever this browser is, and what the rest of the app wants doing. */
function identify({ token, name, flag, onToast, onJoin, currentRoom, onCreate }) {
  myToken = token;
  if (name !== undefined) myName = name;
  if (flag !== undefined) myFlag = flag;
  if (onJoin) joinHandler = onJoin;
  if (onToast) toastHandler = onToast;
  if (currentRoom) roomOf = currentRoom;
  if (onCreate) createTable = onCreate;
}

/** Registers this browser's profile and returns its friend code. */
export async function initSocial(opts) {
  identify(opts);
  const { token, name, flag } = opts;
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
  watchInvites();
  return myCode;
}

/**
 * The landing's friends poll stops when a table opens. The invite poll does
 * not: the middle of a game is when somebody is most likely to be asked to
 * another one, and the tab most likely to be behind something else when it
 * happens.
 */
export function stopSocial() {
  clearInterval(pollTimer);
  pollTimer = null;
}

/**
 * Keeps the invite poll running, starting it if nothing has yet — a table
 * reached straight from a link never passed through the landing that would
 * otherwise have started it.
 */
export function watchInvites(opts) {
  if (opts) identify(opts);
  if (!myToken) return;
  checkInvite();
  clearInterval(inviteTimer);
  inviteTimer = setInterval(checkInvite, 10000);
}

/**
 * The friend code, for a sheet opened somewhere the landing never fetched it.
 * Posting the profile is what hands it out, and it is the same call the
 * landing makes, so nothing new is created that would not have been anyway.
 */
async function ensureCode() {
  if (myCode || !myToken) return myCode;
  try {
    const me = await post('/api/profile', { token: myToken, name: myName, flag: myFlag });
    myCode = me.code || '';
  } catch { /* the sheet keeps its dots until the server answers */ }
  return myCode;
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
    const d = await fetch(api(`/api/social?token=${encodeURIComponent(token)}`)).then((r) => r.json());
    friends = d.friends || [];
    requests = d.requests || [];
    sentAsks = d.sent || [];
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
    // A request waiting is the one thing worth saying over everything else.
    sub.textContent = requests.length
      ? `${requests.length} friend request${requests.length > 1 ? 's' : ''} waiting`
      : !friends.length ? 'Swap codes and play together'
        : on ? `${friends.length} · ${on} on right now`
          : `${friends.length} · nobody on right now`;
    sub.classList.toggle('on', on > 0 || requests.length > 0);
  }
  const dot = $('#friendsDot');
  if (dot) dot.classList.toggle('hidden', !requests.length);
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
    <div id="fmNotify"></div>
    <div class="fm-code">
      <div class="fm-code-label">Your friend code</div>
      <div class="fm-code-value" id="fmCodeValue">${escapeHtml(myCode || '······')}</div>
      <div class="row-2">
        <button class="btn ghost small" id="fmCopy">${icon('key', 13)} Copy</button>
        <button class="btn ghost small" id="fmShare">${icon('people', 13)} Share</button>
      </div>
      <p class="fm-hint">Give this to somebody and they can ask to be friends. You decide — a request waits here until you accept it.</p>
    </div>
    <div class="chart-label">Add a friend</div>
    <form class="fm-add" id="fmAdd">
      <input id="fmCode" class="code-input" maxlength="6" placeholder="THEIR CODE" autocomplete="off" />
      <button class="btn gold" type="submit">Add</button>
    </form>
    <div id="fmRequests"></div>
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
        const out = await post('/api/friends', { token: myToken, code });
        input.value = '';
        // Most adds are a request the other side still has to accept, and
        // saying "added" for those promised a friend who is not there yet.
        const who = out.friend?.name || code;
        toastHandler(out.accepted ? `You and ${who} are friends now` : `Request sent to ${who}`);
        await refreshFriends(myToken);
      } catch (err) {
        toastHandler(err.message, 'error');
      }
    };
    paintNotify();
    paintFriendList();
    // At a table nothing has been polling the list, and a sheet opened there
    // from a link has never been told this browser's code either.
    if (!pollTimer) refreshFriends(myToken);
    if (!myCode) {
      ensureCode().then((code) => {
        const el = $('#fmCodeValue');
        if (code && el) el.textContent = code;
      });
    }
  }, 'friends-modal');
}

/**
 * An invite, wherever the reader is.
 *
 * It has to work in the middle of a game as much as on the landing screen —
 * that is when somebody is most likely to be asked — so this is a strip that
 * drops in at the top of whatever is on screen rather than a modal, which
 * would take the board away from a player mid-turn.
 */
async function checkInvite() {
  let invite = null;
  try {
    ({ invite } = await fetch(api(`/api/invite?token=${encodeURIComponent(myToken)}`)).then((r) => r.json()));
  } catch { return; }
  if (!invite) { invitedBy = ''; document.querySelector('.invite-strip')?.remove(); return; }
  // Already in the table they are asking about: nothing to announce.
  if (roomOf() === invite.roomId) return;
  // The same invite twice is one invite.
  const key = inviteKey(invite);
  if (invitedBy === key) return;
  invitedBy = key;
  showInvite(invite);
  notifyInvite(invite);
}

const inviteKey = (invite) => `${invite.from}:${invite.roomId}:${invite.at}`;

function showInvite(invite) {
  document.querySelector('.invite-strip')?.remove();
  const el = document.createElement('div');
  el.className = 'invite-strip';
  el.innerHTML = `<span class="is-mark">${icon('people', 17, 'solo')}</span>
    <span class="is-body">
      <b>${escapeHtml(invite.name)}</b>
      <span>wants you at their table</span>
    </span>
    <button class="btn tiny primary" data-go>Join</button>
    <button class="icon-btn tiny-x" data-shut title="Not now">✕</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));

  const clear = () => {
    answered = inviteKey(invite);
    post('/api/invite/clear', { token: myToken }).catch(() => {});
    el.classList.remove('in');
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector('[data-go]').onclick = () => { clear(); joinHandler?.(invite.roomId); };
  el.querySelector('[data-shut]').onclick = clear;
  // Nobody should have to dismiss a note about a table that will have started
  // by the time they look up. The clock starts when they can see it, though:
  // an invite landing in a tab behind something else would otherwise be gone
  // before anyone came back to read it, and the server retires a stale one on
  // its own after five minutes either way.
  const retire = () => setTimeout(() => {
    if (el.isConnected) { el.classList.remove('in'); setTimeout(() => el.remove(), 220); }
  }, 45000);
  if (!document.hidden) { retire(); return; }
  const onShow = () => {
    if (document.hidden) return;
    document.removeEventListener('visibilitychange', onShow);
    retire();
  };
  document.addEventListener('visibilitychange', onShow);
}

// ---- invite notifications -------------------------------------------------
// The web has no push, so an invite is heard on the same ten-second poll that
// puts the strip up. The strip is for somebody looking at the game; a system
// notification is for the tab they are not looking at, so it only fires when
// this one is hidden or out of focus, and only once they have said yes.

const canNotify = () => typeof window.Notification === 'function';

/**
 * Asks once, from a tap. Browsers refuse a prompt that no gesture asked for,
 * and Safari only learned the promise form late, so the callback form rides
 * along and whichever answers first is the answer.
 */
function askToNotify() {
  if (!canNotify()) return Promise.resolve('denied');
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
  return new Promise((resolve) => {
    try {
      const asked = Notification.requestPermission(resolve);
      if (asked?.then) asked.then(resolve, () => resolve('default'));
    } catch { resolve('default'); }
  }).then((answer) => { paintNotify(); return answer; });
}

function notifyInvite(invite) {
  if (!canNotify() || Notification.permission !== 'granted') return;
  if (!document.hidden && document.hasFocus()) return;
  const key = inviteKey(invite);
  try {
    // One tag, so a second invite replaces the first in the tray as it does
    // on screen — and still sounds, because it is a new invite.
    const note = new Notification('MoneyMove', {
      body: `${invite.name || 'A friend'} invited you to a game`,
      tag: 'moneymove-invite',
      renotify: true,
    });
    note.onclick = () => {
      window.focus();
      note.close();
      // Back to the strip, which is still where an invite is answered — put
      // up again if it timed out, but not once it has been answered here.
      if (answered !== key && invitedBy === key && !document.querySelector('.invite-strip')) showInvite(invite);
    };
  } catch {
    // Chrome on Android only notifies through a service worker, which this
    // site does not have. The strip is still there when they come back.
  }
}

/** The friends sheet's offer to turn notifications on, while there is a question to ask. */
function paintNotify() {
  const el = $('#fmNotify');
  if (!el) return;
  if (!canNotify() || Notification.permission !== 'default') { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="fm-notify">
      <span class="fm-notify-mark">${icon('bell', 16, 'solo')}</span>
      <span class="fm-notify-text">Get a notification when a friend invites you, even with this tab in the background.</span>
      <button class="btn tiny" id="fmNotifyOn" type="button">Turn on</button>
    </div>`;
  $('#fmNotifyOn').onclick = () => askToNotify().then((answer) => {
    if (answer === 'granted') toastHandler('Notifications on — you will hear about invites');
  });
}

/**
 * Requests, above the list.
 *
 * Adding somebody used to put you straight on their list, on the grounds
 * that you had to know their code. But a code gets read over a shoulder or
 * guessed at six characters, and being on a stranger's list means they can
 * message you and see when you are online. The other person decides now.
 */
function paintRequests() {
  const el = $('#fmRequests');
  if (!el) return;
  if (!requests.length && !sentAsks.length) { el.innerHTML = ''; return; }
  el.innerHTML = `${requests.length ? `<div class="chart-label">Wants to be friends (${requests.length})</div>
      ${requests.map((r) => `<div class="friend req">
          <span class="friend-flag">${r.avatar || r.flag ? escapeHtml(r.avatar || r.flag) : icon('people', 16, 'solo')}</span>
          <span class="friend-who"><b>${escapeHtml(r.name)}</b>
            <span class="friend-status off">asked to be friends <i>${escapeHtml(r.code)}</i></span></span>
          <button class="btn tiny primary" data-yes="${escapeHtml(r.code)}">Accept</button>
          <button class="icon-btn tiny-x" data-no="${escapeHtml(r.code)}" title="Decline">✕</button>
        </div>`).join('')}` : ''}
    ${sentAsks.length ? `<div class="chart-label">Asked (${sentAsks.length})</div>
      ${sentAsks.map((r) => `<div class="friend">
          <span class="friend-flag">${r.avatar || r.flag ? escapeHtml(r.avatar || r.flag) : icon('people', 16, 'solo')}</span>
          <span class="friend-who"><b>${escapeHtml(r.name)}</b>
            <span class="friend-status off">waiting for them to accept</span></span>
          <button class="icon-btn tiny-x" data-no="${escapeHtml(r.code)}" title="Take it back">✕</button>
        </div>`).join('')}` : ''}`;

  el.querySelectorAll('[data-yes]').forEach((b) => {
    b.onclick = async () => {
      await post('/api/friends/accept', { token: myToken, code: b.dataset.yes }).catch(() => {});
      toastHandler('You are friends now');
      await refreshFriends(myToken);
    };
  });
  el.querySelectorAll('[data-no]').forEach((b) => {
    b.onclick = async () => {
      await post('/api/friends/decline', { token: myToken, code: b.dataset.no }).catch(() => {});
      await refreshFriends(myToken);
    };
  });
}

/**
 * Who was asked, to which table, and when — so the ten-second repaint does not
 * hand back an Invite button that was pressed a moment ago. The server only
 * lets the same pair ring once every twenty seconds anyway; this keeps the
 * button honest for a minute, which is about how long an answer takes.
 */
const invitesSent = new Map();     // friend code -> { room, at }
const INVITED_MS = 60 * 1000;
const invitedRecently = (code) => {
  const sent = invitesSent.get(code);
  return !!sent && sent.room === roomOf() && Date.now() - sent.at < INVITED_MS;
};

/** Set while a table is being opened for an invite, so a second tap waits. */
let openingTable = false;

/**
 * Ask a friend to come and play.
 *
 * At a table, that table. Anywhere else there is nothing to ask them to yet,
 * so a private one is opened exactly as "Create a private game" opens it, this
 * browser goes in, and the invite follows as soon as the table has an id. The
 * tap is also the gesture a browser insists on before it will ask about
 * notifications — and somebody sending invites is somebody who will want to
 * hear when one comes back — so the first one asks.
 */
async function inviteToTable(code, name, btn) {
  askToNotify();
  let room = roomOf();
  if (!room) {
    if (!createTable || openingTable) return;
    openingTable = true;
    try {
      room = await createTable(btn);
    } finally {
      openingTable = false;
    }
    if (!room) return; // no table came back, and the landing has said so
  }
  try {
    const out = await post('/api/invite', { token: myToken, code, roomId: room });
    invitesSent.set(code, { room, at: Date.now() });
    toastHandler(`Invite sent to ${out.to?.name || name || 'your friend'}`);
    if (btn.isConnected) {
      btn.disabled = true;
      btn.innerHTML = `${icon('ticket', 13)} Invited`;
    }
  } catch (err) {
    toastHandler(err.message, 'error');
  }
}

function paintFriendList() {
  paintRequests();
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

  const here = roomOf();
  el.innerHTML = friends.map((f) => {
    const s = STATUS[f.status] || STATUS.offline;
    // Their game is already under way: the seats are shut, so promise a look
    // rather than a seat — "Join" only to end up watching reads as a failure.
    const started = f.status !== 'lobby';
    // Already sitting at this table: neither door goes anywhere new.
    const withUs = !!here && f.roomId === here;
    const asked = invitedRecently(f.code);
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
      ${f.roomId && !withUs ? `<button class="btn tiny ${started ? '' : 'primary'}" data-join="${escapeHtml(f.roomId)}"
          title="${started ? 'Their game has started — you can watch it' : 'Take a seat at their table'}"
        >${started ? 'Watch' : 'Join'}</button>` : ''}
      ${withUs ? '' : `<button class="btn tiny" data-invite="${escapeHtml(f.code)}" data-name="${escapeHtml(f.name)}"
          ${asked ? 'disabled' : ''}
          title="${here ? `Ask ${escapeHtml(f.name)} to come to your table` : `Open a private table and ask ${escapeHtml(f.name)} to it`}"
        >${icon('ticket', 13)} ${asked ? 'Invited' : 'Invite'}</button>`}
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
  el.querySelectorAll('[data-invite]').forEach((b) => {
    b.onclick = () => inviteToTable(b.dataset.invite, b.dataset.name, b);
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
