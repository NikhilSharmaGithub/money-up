// Everything that isn't the board: player cards, settings, action bar, modals,
// chat, toasts and the celebratory bits.

import { escapeHtml, deedMarkup, deckMarkup } from './board.js';
import { icon, groupBanner, groupFlag } from './icons.js';
import { sfx } from './sound.js';
import { api } from './net.js';

const $ = (sel, root = document) => root.querySelector(sel);

export const FLAGS = [
  '🇮🇳', '🇬🇧', '🇺🇸', '🇧🇷', '🇩🇪', '🇫🇷', '🇮🇹', '🇪🇸', '🇵🇹', '🇳🇱',
  '🇮🇪', '🇨🇭', '🇸🇪', '🇳🇴', '🇩🇰', '🇵🇱', '🇺🇦', '🇹🇷', '🇷🇴', '🇬🇷',
  '🇮🇱', '🇦🇪', '🇸🇦', '🇪🇬', '🇿🇦', '🇳🇬', '🇰🇪', '🇨🇳', '🇯🇵', '🇰🇷',
  '🇹🇭', '🇻🇳', '🇵🇭', '🇮🇩', '🇵🇰', '🇧🇩', '🇱🇰', '🇳🇵', '🇦🇺', '🇳🇿',
  '🇨🇦', '🇲🇽', '🇦🇷', '🇨🇱', '🇨🇴', '🇷🇺', '🇸🇬', '🇲🇾', '🏴‍☠️', '🌍',
];
const money = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;

// ─────────────────────────────────────────────────────────────── toasts ──
const MAX_TOASTS = 3;

export function toast(message, type = 'info') {
  const root = $('#toastRoot');

  // Repeating the same message bumps a counter instead of stacking copies.
  const twin = [...root.children].find((c) => c.dataset.msg === message);
  if (twin) {
    twin.dataset.n = String(Number(twin.dataset.n || 1) + 1);
    twin.querySelector('.toast-n').textContent = `×${twin.dataset.n}`;
    clearTimeout(Number(twin.dataset.timer));
    twin.dataset.timer = String(setTimeout(() => dismissToast(twin), 2600));
    return;
  }

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.dataset.msg = message;
  el.dataset.n = '1';
  el.innerHTML = `<span>${icon(type === 'error' ? 'warning' : 'bulb', null, 'solo')}</span>
    <span>${escapeHtml(message)}</span><b class="toast-n"></b>`;
  root.appendChild(el);
  while (root.children.length > MAX_TOASTS) dismissToast(root.firstElementChild);
  if (type === 'error') sfx.error();
  el.dataset.timer = String(setTimeout(() => dismissToast(el), 2600));
}

function dismissToast(el) {
  if (!el || el.dataset.gone) return;
  el.dataset.gone = '1';
  clearTimeout(Number(el.dataset.timer));
  el.classList.add('out');
  setTimeout(() => el.remove(), 320);
}

// Mirrors the server rules so illegal actions never get offered in the first place.
export function canBuildOn(state, meId, i) {
  const t = state.map.tiles[i];
  const o = state.ownership[i];
  if (!o || o.owner !== meId || t.type !== 'property' || o.mortgaged) return false;
  const group = state.map.groups[t.group] || [];
  if (!group.length || !group.every((g) => state.ownership[g]?.owner === meId)) return false;
  if (group.some((g) => state.ownership[g].mortgaged)) return false;
  if ((o.houses || 0) >= 5) return false;
  if (state.settings.evenBuild) {
    const min = Math.min(...group.map((g) => state.ownership[g].houses || 0));
    if ((o.houses || 0) > min) return false;
  }
  return true;
}

export function canSellOn(state, meId, i) {
  const o = state.ownership[i];
  const t = state.map.tiles[i];
  if (!o || o.owner !== meId || !(o.houses > 0)) return false;
  if (state.settings.evenBuild) {
    const group = state.map.groups[t.group] || [];
    const max = Math.max(...group.map((g) => state.ownership[g].houses || 0));
    if (o.houses < max) return false;
  }
  return true;
}

export function canMortgage(state, meId, i) {
  const o = state.ownership[i];
  const t = state.map.tiles[i];
  if (!state.settings.mortgage || !o || o.owner !== meId || o.mortgaged) return false;
  if (t.type === 'property') {
    const group = state.map.groups[t.group] || [];
    if (group.some((g) => (state.ownership[g]?.houses || 0) > 0)) return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────── log/chat ──
// One drawn mark per kind of thing that happened. Most of these paint with
// currentColor, so each mark takes the colour its own line is already printed
// in — a rent line's house is as red as the words beside it.
const LOG_ICON = {
  dice: 'dice', money: 'cash', rent: 'houses', buy: 'bag', jail: 'police',
  bankrupt: 'skull', auction: 'gavel', trade: 'trade', treasure: 'toolbox', surprise: 'question',
  system: 'sparkle', build: 'crane', mortgage: 'bank', join: 'people', leave: 'door',
  // A turn is the play coming round the table again.
  warn: 'warning', turn: 'replay',
};

export function renderLog(state, el) {
  const sig = `${state.log.length}:${state.log[state.log.length - 1]?.at || 0}`;
  if (el.dataset.sig === sig) return;
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60 || !el.dataset.sig;
  el.dataset.sig = sig;
  el.innerHTML = state.log.map((l) => `<div class="log-line ${l.kind}">
      <span class="log-ico">${icon(LOG_ICON[l.kind]) || '·'}</span><span>${escapeHtml(l.text)}</span>
    </div>`).join('');
  if (wasAtBottom) el.scrollTop = el.scrollHeight;
}

export function renderChat(state, el, channel = 'all') {
  // Team messages live in their own channel; the server already keeps other
  // teams' messages out of this client's copy of the chat.
  const teamed = (state.settings?.teams || 0) > 0;
  const msgs = teamed
    ? state.chat.filter((m) => (channel === 'team' ? m.channel === 'team' : m.channel !== 'team'))
    : state.chat;
  const sig = `${channel}:${msgs.length}:${msgs[msgs.length - 1]?.id || ''}`;
  if (el.dataset.sig === sig) return;
  // Scrolled up to re-read something? A new line shouldn't drag you back down
  // — the game log already behaves this way, and chat should match it.
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40 || !el.dataset.sig;
  el.dataset.sig = sig;
  if (!msgs.length) {
    el.innerHTML = channel === 'team'
      ? `<div class="empty">Only your team reads this. Plan away ${icon('shield')}</div>`
      : `<div class="empty">Say hi ${icon('people')}</div>`;
    return;
  }
  el.innerHTML = msgs.map((m) => {
    const teamColor = m.channel === 'team' ? state.teamInfo?.[m.team]?.color : null;
    return `<div class="chat-msg">
      ${m.flag ? `<span class="chat-flag">${escapeHtml(m.flag)}</span>` : ''}<b style="color:${m.color}">${escapeHtml(m.name)}</b>${teamColor ? ` <span class="chat-team-badge" style="color:${teamColor}">TEAM</span>` : ''} ${escapeHtml(m.text)}
    </div>`;
  }).join('');
  if (wasAtBottom) el.scrollTop = el.scrollHeight;
}

// ───────────────────────────────────────────────────────────── player list ──
const prevMoney = new Map();

// The action buttons are wired once (dataset.v caching) but must act on the
// CURRENT game, not the render that created them — a trade opened two turns
// later would otherwise show a frozen snapshot.
let livePlayersState = null;

// A seat whose player was removed is out of the running whatever the money
// says: it takes no turns, holds no deeds and cannot be traded with. The
// server usually bankrupts them too, but a rematch clears that flag and leaves
// the removal behind — so both are checked everywhere the roster asks.
const isOut = (p) => !!(p.bankrupt || p.timedOut);

/**
 * Live standings by net worth. Seating order breaks ties so two players on the
 * same money don't swap numbers back and forth on every push.
 */
function rankByWorth(state) {
  const rank = new Map();
  state.players
    .map((p, seat) => ({ id: p.id, seat, worth: p.netWorth || 0, out: isOut(p) }))
    .sort((a, b) => Number(a.out) - Number(b.out) || b.worth - a.worth || a.seat - b.seat)
    .forEach((p, k) => rank.set(p.id, k + 1));
  return rank;
}

/**
 * Whoever plays after the current chair — bankrupt seats and players sitting
 * out a vacation are stepped over, the same way the server steps over them.
 */
function nextUpId(state) {
  const { players } = state;
  if (state.status !== 'playing' || !state.turn?.playerId) return null;
  const idx = players.findIndex((p) => p.id === state.turn.playerId);
  if (idx < 0) return null;
  for (let step = 1; step < players.length; step++) {
    const cand = players[(idx + step) % players.length];
    if (isOut(cand) || cand.skipTurns > 0) continue;
    return cand.id;
  }
  return null;
}

export function renderPlayers(state, meId, el, actions) {
  livePlayersState = state;
  const rank = rankByWorth(state);
  const nextUp = nextUpId(state);
  const emptySeats = state.status === 'lobby'
    ? Math.max(0, state.settings.maxPlayers - state.players.length) : 0;
  const structure = state.players.map((p) => `${p.id}:${isOut(p) ? 1 : 0}:${p.color}:${p.avatar || ''}`).join('|')
    + `:${state.status}:${state.hostId}:${emptySeats}`;

  if (el.dataset.structure !== structure) {
    el.dataset.structure = structure;
    el.innerHTML = state.players.map((p) => `
      <div class="player-card ${isOut(p) ? 'dead' : ''} ${p.id === meId ? 'me' : ''}" data-pid="${p.id}">
        <span class="prank hidden"></span>
        <div class="avatar ${p.avatar ? 'has-skin' : ''}" style="background:${p.color}">
          <span class="avatar-face"></span>
          <span class="avatar-ring"></span>
          <span class="avatar-flag"></span>
        </div>
        <div class="pinfo">
          <div class="pname"><span class="pn-text"></span><span class="tags"></span></div>
          <div class="pmoney"></div>
          <div class="chips"></div>
        </div>
        <span class="turn-clock hidden"></span>
        <div class="player-actions"></div>
        <div class="delta-slot"></div>
      </div>`).join('')
      + Array.from({ length: emptySeats }, () => `
      <div class="player-card empty-seat">
        <div class="avatar ghost-seat">+</div>
        <div class="pinfo"><div class="pname dim">Empty seat</div>
          <div class="pmeta dim">waiting for a player…</div></div>
        ${state.hostId === meId && !state.quick ? '<button class="btn tiny" data-addbot>Add bot</button>' : ''}
      </div>`).join('');

    el.querySelectorAll('[data-addbot]').forEach((b) => {
      b.onclick = () => { sfx.click(); actions.addBot(); };
    });
  }

  state.players.forEach((p) => {
    const card = el.querySelector(`[data-pid="${CSS.escape(p.id)}"]`);
    if (!card) return;
    const isTurn = state.turn?.playerId === p.id && state.status === 'playing';
    card.classList.toggle('turn', isTurn);
    card.classList.toggle('next-up', p.id === nextUp && !isTurn);

    // Renaming yourself in the lobby has to reach the roster: the card is only
    // rebuilt when the table itself changes, so the name and the initial on
    // the disc are patched in place like every other live field.
    const nameEl = card.querySelector('.pn-text');
    if (nameEl.dataset.v !== p.name) {
      nameEl.dataset.v = p.name;
      nameEl.textContent = p.name;
    }
    const faceEl = card.querySelector('.avatar-face');
    const face = p.avatar || (p.name[0] || '?').toUpperCase();
    if (faceEl.dataset.v !== face) {
      faceEl.dataset.v = face;
      faceEl.textContent = face;
    }

    // live position — the leader wears the crown, everyone else their number
    const rankEl = card.querySelector('.prank');
    const pos = state.status === 'playing' ? rank.get(p.id) : null;
    const rankHtml = !pos ? '' : pos === 1 ? `<b>${icon('crown')}</b><span>#1</span>` : `<span>#${pos}</span>`;
    if (rankEl.dataset.v !== rankHtml) {
      rankEl.dataset.v = rankHtml;
      rankEl.innerHTML = rankHtml;
      rankEl.classList.toggle('hidden', !rankHtml);
      rankEl.classList.toggle('lead', pos === 1);
      rankEl.title = pos ? `#${pos} by net worth` : '';
    }

    // tags
    const flagEl = card.querySelector('.avatar-flag');
    if (flagEl.dataset.v !== (p.flag || '')) {
      flagEl.dataset.v = p.flag || '';
      flagEl.textContent = p.flag || '';
      flagEl.classList.toggle('hidden', !p.flag);
    }

    const team = p.team != null ? state.teamInfo?.[p.team] : null;
    card.style.setProperty('--team-color', team ? team.color : 'transparent');
    card.classList.toggle('teamed', !!team);

    const tags = [];
    if (team) tags.push(`<i class="tag team" style="background:${team.color}22;color:${team.color}">${escapeHtml(team.name)}</i>`);
    if (p.isBot) tags.push('<i class="tag bot">BOT</i>');
    if (state.hostId === p.id) tags.push('<i class="tag host">HOST</i>');
    if (p.id === meId) tags.push('<i class="tag you">YOU</i>');
    // A quiet heads-up so people look up before the turn lands on them.
    if (p.id === nextUp && !isTurn) tags.push(`<i class="tag next">${p.id === meId ? "YOU'RE NEXT" : 'NEXT'}</i>`);
    // "Timed out" is a story about a game that is running; back in a lobby the
    // same seat is simply someone who has not come back to the table.
    if (p.timedOut) {
      tags.push(`<i class="tag off">${state.status === 'lobby' ? 'NOT BACK'
        : p.removedFor === 'quit' ? 'LEFT' : 'TIMED OUT'}</i>`);
    } else if (!p.isBot && p.botControlled) tags.push('<i class="tag off">BOT PLAYING</i>');
    else if (!p.connected && !p.isBot) tags.push('<i class="tag off">AWAY</i>');
    if (p.jail) tags.push('<i class="tag jail">JAIL</i>');
    if (p.skipTurns > 0) tags.push('<i class="tag vac">VACATION</i>');
    if (p.getOutCards > 0) tags.push(`<i class="tag card">${icon('ticket')}${p.getOutCards > 1 ? p.getOutCards : ''}</i>`);
    const tagEl = card.querySelector('.tags');
    const tagHtml = tags.join('');
    if (tagEl.dataset.v !== tagHtml) { tagEl.dataset.v = tagHtml; tagEl.innerHTML = tagHtml; }

    // money + delta bubble
    const moneyEl = card.querySelector('.pmoney');
    const shown = state.status === 'lobby' ? money(p.money)
      : p.timedOut ? '<span class="dim">out of the game</span>'
      : p.bankrupt ? '<span class="dim">bankrupt</span>' : money(p.money);
    if (moneyEl.dataset.v !== shown) {
      const before = prevMoney.get(p.id);
      moneyEl.dataset.v = shown;
      moneyEl.innerHTML = shown;
      // A rematch resets every wallet at once; that is a new game starting,
      // not eight players suddenly winning money.
      if (before != null && before !== p.money && !isOut(p) && state.status === 'playing') {
        spawnDelta(card, p.money - before);
        moneyEl.classList.remove('bump');
        void moneyEl.offsetWidth;
        moneyEl.classList.add('bump');
      }
    }
    prevMoney.set(p.id, p.money);

    // owned set chips — they stay up after the last bankruptcy, because the
    // final board is exactly what everyone wants to read on the way out.
    const chips = card.querySelector('.chips');
    if (state.status !== 'lobby') {
      const owned = Object.entries(state.ownership).filter(([, o]) => o.owner === p.id).map(([i]) => Number(i));
      const perGroup = {};
      let rails = 0, utils = 0;
      owned.forEach((i) => {
        const t = state.map.tiles[i];
        if (t.type === 'property') perGroup[t.group] = (perGroup[t.group] || 0) + 1;
        else if (t.type === 'airport') rails++;
        else utils++;
      });
      const html = Object.entries(perGroup).map(([g, n]) => {
        const total = state.map.groups[g].length;
        return `<i class="chip ${n === total ? 'full' : ''}" style="--c:${state.groups[g].color}"
                  title="${escapeHtml(state.groups[g].name)} ${n}/${total}">${n}<small>/${total}</small></i>`;
      }).join('')
        + (rails ? `<i class="chip plain" title="Airports">${icon('plane')}${rails}</i>` : '')
        + (utils ? `<i class="chip plain" title="Utilities">${icon('bulb')}${utils}</i>` : '');
      const final = html || `<span class="dim">${isOut(p) ? 'nothing left' : 'no property yet'}</span>`;
      if (chips.dataset.v !== final) { chips.dataset.v = final; chips.innerHTML = final; }
    } else if (chips.dataset.v !== 'lobby') {
      chips.dataset.v = 'lobby';
      chips.innerHTML = '<span class="dim">ready</span>';
    }

    // buttons
    const acts = card.querySelector('.player-actions');
    const me = state.players.find((x) => x.id === meId);
    const canTrade = state.status === 'playing' && p.id !== meId && !isOut(p) && !isOut(me || {});
    // Nobody hosts a Quick Play table, so nobody gets to throw strangers off it.
    const canKick = state.hostId === meId && state.status === 'lobby' && p.id !== meId && !state.quick;
    const canPickTeam = state.status === 'lobby' && state.settings.teams > 0
      && (p.id === meId || (state.hostId === meId && p.isBot));
    const want = `${canTrade ? 't' : ''}${canKick ? 'k' : ''}${canPickTeam ? 'm' : ''}`;
    if (acts.dataset.v !== want) {
      acts.dataset.v = want;
      acts.innerHTML = `${canPickTeam ? '<button class="btn tiny" data-team title="Switch team">⇄</button>' : ''}
                        ${canTrade ? '<button class="btn tiny" data-trade>Trade</button>' : ''}
                        ${canKick ? '<button class="icon-btn" data-kick title="Remove">✕</button>' : ''}`;
      const pid = p.id;
      const mb = acts.querySelector('[data-team]');
      if (mb) mb.onclick = () => {
        sfx.click();
        const st = livePlayersState;
        const cur = st?.players.find((x) => x.id === pid);
        if (!st || !cur) return;
        const next = ((cur.team ?? -1) + 1) % st.settings.teams;
        actions.setTeam(pid, next);
      };
      const tb = acts.querySelector('[data-trade]');
      if (tb) tb.onclick = () => {
        sfx.click();
        if (livePlayersState) openTradeModal(livePlayersState, meId, pid, actions);
      };
      const kb = acts.querySelector('[data-kick]');
      if (kb) kb.onclick = () => actions.kick(pid);
    }
  });
}

function spawnDelta(card, amount) {
  const slot = card.querySelector('.delta-slot');
  const el = document.createElement('div');
  el.className = `delta ${amount > 0 ? 'up' : 'down'}`;
  el.textContent = `${amount > 0 ? '+' : '−'}${money(Math.abs(amount))}`;
  slot.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// ──────────────────────────────────────────────────────────── right panel ──
const RULES = [
  { key: 'x2rent', icon: 'coin', name: 'x2 rent on full sets', desc: 'Owning a whole country doubles its base rent' },
  { key: 'vacationCash', icon: 'island', name: 'Vacation cash', desc: 'Taxes and fines pile up and go to whoever lands on Vacation' },
  { key: 'auction', icon: 'gavel', name: 'Auction', desc: 'Skipped properties are sold to the highest bidder' },
  { key: 'noRentInPrison', icon: 'police', name: 'No rent while jailed', desc: 'Owners in prison collect nothing' },
  { key: 'mortgage', icon: 'bank', name: 'Mortgage', desc: 'Raise 50% of a property’s cost, but collect no rent on it' },
  { key: 'evenBuild', icon: 'houses', name: 'Even build', desc: 'Houses must go up and down evenly across a set' },
  { key: 'randomizeOrder', icon: 'shuffle', name: 'Randomize order', desc: 'Shuffle the turn order when the game starts' },
];

/**
 * Only the debtor's own shortfall belongs in the signature: folding cash in
 * the rest of the time would rebuild the panel on every rent payment.
 */
function debtSig(state, meId) {
  const d = state.turn?.phase === 'debt' ? state.turn.debt : null;
  if (!d || d.debtor !== meId) return '';
  return `${d.amount}:${state.players.find((p) => p.id === meId)?.money}`;
}

/**
 * An offer changes without the list of ids changing: someone sets it aside for
 * later, or opens it and starts reading. Those are the whole point of the
 * card, so they have to be in the signature or they never reach the screen.
 */
function tradeSig(state) {
  return state.trades
    .map((t) => `${t.id}${t.ignored ? '!' : ''}${(t.viewers || []).join('.')}`)
    .join();
}

/** A lap walked while deadlocked changes the panel, so it has to be in the key. */
function lapSig(state) {
  return state.players.map((p) => p.blockedLaps || 0).join('');
}

export function renderRightPanel(state, meId, el, actions) {
  const me = state.players.find((p) => p.id === meId);
  const sig = state.status === 'lobby'
    ? `lobby:${state.hostId}:${meId}:${me?.color}:${JSON.stringify(state.settings)}:${state.map.id}:${state.players.length}:${state.quickStartAt || 0}`
    : `game:${JSON.stringify(state.ownership)}:${meId}:${state.vacationPot}:${tradeSig(state)}:${state.status}:${state.settings.mortgage}:${debtSig(state, meId)}:${me?.bankrupt ? 1 : 0}${me?.timedOut ? 'x' : ''}:${lapSig(state)}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  if (state.status !== 'lobby') renderMyStuff(state, meId, el, actions);
  else if (state.quick) renderQuickLobby(state, meId, el, actions);
  else renderSettings(state, meId, el, actions);
}

const LOOK_COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185', '#22d3ee', '#f97316'];

/** Name, colour and flag — the one part of any lobby every player owns. */
function lookPanel(state, meId) {
  const me = state.players.find((p) => p.id === meId);
  return `<div class="panel">
      <div class="panel-title">Your look</div>
      <input id="nameField" class="name-field" value="${escapeHtml(me?.name || '')}" maxlength="16" placeholder="Nickname" />
      <div class="swatches">
        ${LOOK_COLORS.map((c) => {
          const taken = state.players.some((p) => p.color === c && p.id !== meId);
          return `<button class="swatch ${me?.color === c ? 'sel' : ''}" data-color="${c}"
            ${taken ? 'disabled' : ''} style="--c:${c}"></button>`;
        }).join('')}
      </div>
      <div class="flag-picker">
        ${FLAGS.map((f) => `<button class="flag-opt ${me?.flag === f ? 'sel' : ''}" data-flag="${f}">${f}</button>`).join('')}
      </div>
    </div>`;
}

function wireLookPanel(state, meId, el, actions) {
  const me = state.players.find((p) => p.id === meId);
  el.querySelectorAll('[data-color]').forEach((b) => {
    b.onclick = () => { sfx.click(); actions.appearance({ color: b.dataset.color }); };
  });
  el.querySelectorAll('[data-flag]').forEach((b) => {
    b.onclick = () => {
      sfx.click();
      // Clicking the flag you already wear takes it off again.
      actions.appearance({ flag: me?.flag === b.dataset.flag ? '' : b.dataset.flag });
    };
  });
  const nameField = $('#nameField', el);
  if (nameField) nameField.onchange = () => actions.appearance({ name: nameField.value.trim() || 'Player' });
}

/**
 * A Quick Play table runs itself — nobody sitting here owns its settings, so
 * the panel is about who has turned up rather than what to switch on.
 */
function renderQuickLobby(state, meId, el, actions) {
  const seats = state.settings.maxPlayers;
  const open = Math.max(0, seats - state.players.length);
  el.innerHTML = `
    <div class="panel">
      <div class="panel-title">${icon('bolt')} Quick Play</div>
      <div class="quick-blurb">A public table with whoever is online. It deals
        itself in as soon as the seats fill${state.quickStartAt ? ', or when the countdown runs out' : ''}.</div>
      <div class="quick-seats">
        ${state.players.map((p) => `<div class="quick-seat">
          <span class="avatar sm ${p.avatar ? 'has-skin' : ''}" style="background:${p.color}">${escapeHtml(p.avatar || (p.name[0] || '?').toUpperCase())}</span>
          <span class="qs-name">${escapeHtml(p.name)}</span>
          ${p.id === meId ? '<i class="tag you">YOU</i>' : ''}
        </div>`).join('')}
        ${Array.from({ length: open }, () => `<div class="quick-seat open">
          <span class="avatar sm ghost-seat">+</span>
          <span class="qs-name dim">Open seat</span>
        </div>`).join('')}
      </div>
      <div class="dim small">${state.players.length} of ${seats} seats taken</div>
    </div>
    ${lookPanel(state, meId)}`;
  wireLookPanel(state, meId, el, actions);
}

function renderSettings(state, meId, el, actions) {
  const isHost = state.hostId === meId;
  const dis = isHost ? '' : 'disabled';

  const toggle = (d) => `<div class="setting">
      <span class="s-icon">${icon(d.icon)}</span>
      <div class="s-body"><div class="s-name">${d.name}</div><div class="s-desc">${d.desc}</div></div>
      <label class="switch">
        <input type="checkbox" data-set="${d.key}" ${state.settings[d.key] ? 'checked' : ''} ${dis} />
        <span class="track"></span><span class="thumb"></span>
      </label>
    </div>`;

  el.innerHTML = `
    ${lookPanel(state, meId)}

    <div class="panel">
      <div class="panel-title">Game settings</div>
      <div class="setting">
        <span class="s-icon">${icon('people')}</span>
        <div class="s-body"><div class="s-name">Maximum players</div><div class="s-desc">Seats available in this room</div></div>
        <select data-set="maxPlayers" ${dis}>
          ${[2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}" ${state.settings.maxPlayers === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
      <div class="setting">
        <span class="s-icon">${icon('key')}</span>
        <div class="s-body"><div class="s-name">Private room</div>
          <div class="s-desc">${state.settings.isPrivate
            ? 'Only people with the link can join. Switch it off to list this table under All rooms.'
            : 'Listed under All rooms — anyone can take a free seat.'}</div></div>
        <label class="switch"><input type="checkbox" data-set="isPrivate" ${state.settings.isPrivate ? 'checked' : ''} ${dis} />
          <span class="track"></span><span class="thumb"></span></label>
      </div>
      <div class="setting">
        <span class="s-icon">${icon('robot')}</span>
        <div class="s-body"><div class="s-name">Allow bots</div><div class="s-desc">Bots fill the empty seats on start</div></div>
        <label class="switch"><input type="checkbox" data-set="allowBots" ${state.settings.allowBots ? 'checked' : ''} ${dis} />
          <span class="track"></span><span class="thumb"></span></label>
      </div>
      <div class="setting">
        <span class="s-icon">${icon('shield')}</span>
        <div class="s-body"><div class="s-name">Teams</div>
          <div class="s-desc">Teammates never charge each other rent and win together</div></div>
        <select data-set="teams" ${dis}>
          ${[0, 2, 3, 4].map((n) => `<option value="${n}" ${state.settings.teams === n ? 'selected' : ''}>${n === 0 ? 'Off' : `${n} teams`}</option>`).join('')}
        </select>
      </div>
      ${state.settings.teams > 0 && isHost ? '<button class="btn small wide" id="balanceBtn">⇄ Balance teams</button>' : ''}
      <div class="setting">
        <span class="s-icon">${icon('map')}</span>
        <div class="s-body"><div class="s-name">Board map</div><div class="s-desc">${escapeHtml(state.map.name)} · ${state.map.size} tiles</div></div>
        <button class="btn small" id="mapBtn" ${dis}>Change ›</button>
      </div>
      <div class="setting">
        <span class="s-icon">${icon('cash')}</span>
        <div class="s-body"><div class="s-name">Starting cash</div><div class="s-desc">Lower cash means faster, meaner games</div></div>
        <select data-set="startingCash" ${dis}>
          ${[500, 1000, 1500, 2000, 2500, 3000, 5000].map((n) => `<option value="${n}" ${state.settings.startingCash === n ? 'selected' : ''}>$${n}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Gameplay rules</div>
      ${RULES.map(toggle).join('')}
    </div>

    ${isHost ? `
      <div class="stack">
        <button class="btn primary big" id="startBtn">${icon('dice')} Start Game</button>
        <button class="btn wide ghost" id="botBtn">＋ Add a bot</button>
      </div>`
      : '<div class="panel waiting"><span class="pulse-dot"></span> Waiting for the host to start…</div>'}
  `;

  el.querySelectorAll('[data-set]').forEach((input) => {
    input.onchange = () => {
      const key = input.dataset.set;
      let value = input.type === 'checkbox' ? input.checked : input.value;
      if (['maxPlayers', 'startingCash'].includes(key)) value = Number(value);
      sfx.click();
      actions.settings({ [key]: value });
    };
  });
  wireLookPanel(state, meId, el, actions);
  const mapBtn = $('#mapBtn', el);
  if (mapBtn) mapBtn.onclick = () => { sfx.click(); openMapModal(state, actions); };
  const balanceBtn = $('#balanceBtn', el);
  if (balanceBtn) balanceBtn.onclick = () => { sfx.click(); actions.balanceTeams(); };
  const startBtn = $('#startBtn', el);
  if (startBtn) startBtn.onclick = () => actions.start();
  const botBtn = $('#botBtn', el);
  if (botBtn) botBtn.onclick = () => { sfx.click(); actions.addBot(); };
}

/**
 * "1 away — Venice is with Ravi". A set you nearly hold is the most valuable
 * thing on your board, so the missing street is named next to the group it
 * belongs to, with the trade that would finish it one tap away.
 */
function oneAwayRow(state, meId, key) {
  const group = state.map.groups[key];
  if (!group || group.length < 2) return '';
  const missing = group.filter((i) => state.ownership[i]?.owner !== meId);
  if (missing.length !== 1) return '';

  const i = missing[0];
  const name = escapeHtml(state.map.tiles[i].name);
  const holder = state.players.find((p) => p.id === state.ownership[i]?.owner);
  if (!holder) {
    return `<div class="one-away"><span>1 away — <b>${name}</b> is still with the bank</span></div>`;
  }
  const dealable = state.status === 'playing' && !holder.bankrupt && holder.id !== meId;
  return `<div class="one-away">
      <span>1 away — <b>${name}</b> is with ${escapeHtml(holder.name)}</span>
      ${dealable ? `<button class="btn tiny gold" data-ask="${i}" data-ask-to="${escapeHtml(holder.id)}">Ask for it</button>` : ''}
    </div>`;
}

/**
 * Owing money turns the panel into a scavenger hunt through your own deeds.
 * This puts the shortfall on top and the biggest levers under it, so paying up
 * is a few taps rather than a search.
 */
function raiseCashPanel(state, meId) {
  const d = state.turn?.phase === 'debt' ? state.turn.debt : null;
  if (state.status !== 'playing' || !d || d.debtor !== meId) return '';

  const cash = state.players.find((p) => p.id === meId)?.money || 0;
  const short = Math.max(0, (d.amount || 0) - cash);

  const moves = [];
  Object.entries(state.ownership).forEach(([key, o]) => {
    if (o.owner !== meId) return;
    const i = Number(key);
    const t = state.map.tiles[i];
    if (canSellOn(state, meId, i)) {
      moves.push({ attr: 'sell', i, value: Math.floor((t.houseCost || 0) / 2), icon: 'houses', what: `Sell a building on ${t.name}` });
    }
    if (canMortgage(state, meId, i)) {
      moves.push({ attr: 'mort', i, value: Math.floor((t.price || 0) / 2), icon: 'bank', what: `Mortgage ${t.name}` });
    }
  });
  moves.sort((a, b) => b.value - a.value);
  const reach = moves.reduce((sum, m) => sum + m.value, 0);

  const head = short === 0
    ? `<div class="raise-line good-text">You can cover it — hit <b>Pay ${money(d.amount)}</b> on the board.</div>`
    : `<div class="raise-line">Still to raise <b class="bad-text">${money(short)}</b>
         <span class="dim small">of ${money(d.amount)}</span></div>`;

  const list = moves.length
    ? moves.slice(0, 8).map((m) => `<div class="raise-row">
        <span class="raise-what">${icon(m.icon)} ${escapeHtml(m.what)}</span>
        <button class="btn tiny gold" data-${m.attr}="${m.i}">+${money(m.value)}</button>
      </div>`).join('')
    : '<div class="empty small">Nothing left to sell or mortgage — a trade is the only way out.</div>';

  // Say it straight when the deeds don't add up: a hopeful list would only
  // waste the taps that are left.
  const foot = short > 0 && reach < short
    ? `<div class="raise-line dim small">Everything above adds up to ${money(reach)} — you will need a trade to close the gap.</div>`
    : '';

  return `<div class="panel raise-panel">
      <div class="panel-title">${icon('payment')} You owe ${money(d.amount)}</div>
      ${head}
      ${short > 0 ? list : ''}
      ${short > 0 ? foot : ''}
    </div>`;
}

// Laps a blocked player walks before the board steps in, and what the street
// then costs. Copy only — the server owns the rule.
const RELIEF_LAPS = 4;
const RELIEF_MARKUP = '1.7x';

/**
 * The deadlock rule counts laps in the background, which is exactly the sort of
 * thing a player discovers only when a street vanishes from under them. It gets
 * a quiet panel instead of a toast per lap: how far the count has got, and what
 * lands at the end of it — read from both sides of the table.
 */
function deadlockPanel(state, meId) {
  if (state.status !== 'playing') return '';
  const stuck = state.players.find((p) => (p.blockedLaps || 0) > 0 && !p.bankrupt);
  if (!stuck) return '';

  const walked = Math.min(RELIEF_LAPS, stuck.blockedLaps);
  const left = Math.max(0, RELIEF_LAPS - walked);
  const laps = left === 1 ? 'one more lap' : `${left} more laps`;
  const pips = Array.from({ length: RELIEF_LAPS }, (_, i) =>
    `<i class="${i < walked ? 'on' : ''}"></i>`).join('');

  const body = stuck.id === meId
    ? `You hold all but one street of a colour, so you can never build.
       ${left ? `After ${laps} past START the` : 'On your next lap past START the'}
       street you are missing changes hands for ${RELIEF_MARKUP} its price — if you
       can pay for it on the day. A trade gets there sooner.`
    : `${escapeHtml(stuck.name)} holds all but one street of a colour and cannot build.
       ${left ? `After ${laps} past START the` : 'On their next lap past START the'}
       board moves that street to them for ${RELIEF_MARKUP} its price. Trading it
       yourself is the version you set the terms of.`;

  return `<div class="panel deadlock">
      <div class="panel-title">${icon('scales')} Deadlock rule</div>
      <div class="dl-laps">
        <span class="lap-pips">${pips}</span>
        <span class="dl-count">${walked} of ${RELIEF_LAPS} laps</span>
      </div>
      <div class="dim small">${body}</div>
    </div>`;
}

function renderMyStuff(state, meId, el, actions) {
  const me = state.players.find((p) => p.id === meId);
  // Once the game is over — or this seat is out of it — the deed buttons only
  // earn a "Not available" from the server, so the list turns into a record.
  const live = state.status === 'playing' && !isOut(me || {});
  const mine = Object.entries(state.ownership)
    .filter(([, o]) => o.owner === meId)
    .map(([i, o]) => ({ i: Number(i), ...o }));

  const byGroup = {};
  mine.forEach((m) => {
    const t = state.map.tiles[m.i];
    const key = t.group || (t.type === 'airport' ? '__air' : '__util');
    (byGroup[key] ||= []).push(m);
  });

  const sections = Object.entries(byGroup).map(([key, list]) => {
    const g = state.groups[key];
    const title = g ? `${groupFlag(g.flag, g.color)} ${escapeHtml(g.name)}`
      : key === '__air' ? `${icon('plane')} Airports`
      : `${icon('bulb')} Utilities`;
    const complete = g && list.length === state.map.groups[key].length;
    const rows = list.sort((a, b) => a.i - b.i).map((m) => {
      const t = state.map.tiles[m.i];
      const color = g?.color || '#7c6bb0';
      const buildings = m.houses === 5 ? icon('hotel') : icon('house').repeat(m.houses || 0);
      return `<div class="prop-row ${m.mortgaged ? 'mortgaged' : ''}" data-open="${m.i}">
        <span class="prop-swatch" style="background:${color}"></span>
        <span class="prop-name">${escapeHtml(t.name)}</span>
        <span class="prop-houses">${buildings}</span>
        <span class="prop-actions">
          ${live && canBuildOn(state, meId, m.i) ? `<button class="btn tiny" data-build="${m.i}" title="Build for $${t.houseCost}">＋</button>` : ''}
          ${live && canSellOn(state, meId, m.i) ? `<button class="btn tiny" data-sell="${m.i}" title="Sell a building for $${Math.floor(t.houseCost / 2)}">−</button>` : ''}
          ${m.mortgaged
            ? (live && state.settings.mortgage ? `<button class="btn tiny gold" data-unmort="${m.i}" title="Buy back for $${Math.ceil((t.price / 2) * 1.1)}">↺</button>` : '')
            : (live && canMortgage(state, meId, m.i) ? `<button class="btn tiny" data-mort="${m.i}" title="Mortgage for $${Math.floor(t.price / 2)}">${icon('bank', null, 'solo')}</button>` : '')}
        </span>
      </div>`;
    }).join('');
    return `<div class="group-head ${complete ? 'complete' : ''}">${title}${complete ? '<i>FULL SET</i>' : ''}</div>${rows}${oneAwayRow(state, meId, key)}`;
  }).join('');

  const incoming = state.trades.filter((t) => t.to === meId);
  const outgoing = state.trades.filter((t) => t.from === meId);

  el.innerHTML = `
    ${raiseCashPanel(state, meId)}
    ${deadlockPanel(state, meId)}
    ${incoming.map((t) => tradeCard(state, t, meId)).join('')}
    ${outgoing.map((t) => `<div class="panel">
      <div class="panel-title">Offer sent</div>
      <div class="dim small">${t.ignored
        ? `${icon('snooze')} ${escapeHtml(state.players.find((p) => p.id === t.to)?.name || '')} set it aside for later`
        : `Waiting for ${escapeHtml(state.players.find((p) => p.id === t.to)?.name || '')}…`}</div>
      ${tradeViewerLine(state, t, meId)}
      <button class="btn small wide" style="margin-top:8px" data-cancel="${t.id}">Cancel offer</button>
    </div>`).join('')}

    <div class="panel">
      <div class="panel-title">Your properties</div>
      ${mine.length ? sections : `<div class="empty">${
        isOut(me || {}) ? `Your deeds went back to the bank. You are watching from the rail now ${icon('eye')}`
          : state.status === 'ended' ? 'You finished with nothing on the board.'
          : 'Nothing owned yet — land on a street and buy it.'}</div>`}
    </div>

    ${state.settings.vacationCash ? `<div class="panel pot">
      <div class="panel-title">Vacation pot</div>
      <div class="pot-amount">${money(state.vacationPot)}</div>
    </div>` : ''}

    ${state.status === 'ended' && state.hostId === meId
      ? `<button class="btn primary wide wrap" id="rematchBtn">${icon('replay')} Play again with the same players</button>`
      : ''}
  `;

  el.querySelectorAll('[data-open]').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest('button')) return;
      openDeedModal(state, Number(row.dataset.open), meId, actions);
    };
  });
  const wire = (attr, fn, sound) => el.querySelectorAll(`[data-${attr}]`).forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); sound?.(); fn(Number(b.dataset[attr])); };
  });
  wire('build', actions.build, sfx.build);
  wire('sell', actions.sellHouse, sfx.click);
  wire('mort', actions.mortgage, sfx.cash);
  wire('unmort', actions.unmortgage, sfx.cash);
  wire('cancel', actions.cancelTrade, sfx.click);
  wire('ignore', (id) => actions.ignoreTrade(id, true), sfx.click);
  wire('unignore', (id) => actions.ignoreTrade(id, false), sfx.click);
  el.querySelectorAll('[data-accept]').forEach((b) => {
    b.onclick = () => { sfx.trade(); actions.respondTrade(Number(b.dataset.accept), true); };
  });
  el.querySelectorAll('[data-decline]').forEach((b) => {
    b.onclick = () => { sfx.click(); actions.respondTrade(Number(b.dataset.decline), false); };
  });
  // "1 away" → the composer opens with that street already on their side.
  el.querySelectorAll('[data-ask]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      sfx.click();
      openTradeModal(state, meId, b.dataset.askTo, actions, { get: { tiles: [Number(b.dataset.ask)] } });
    };
  });
  el.querySelectorAll('[data-negotiate]').forEach((b) => {
    b.onclick = () => {
      sfx.click();
      const t = state.trades.find((x) => x.id === Number(b.dataset.negotiate));
      // Counter their offer: same deal, seen from this side of the table.
      if (t) openTradeModal(state, meId, t.from, actions, { give: t.get, get: t.give, counterOf: t.id });
    };
  });
  const rb = $('#rematchBtn', el);
  if (rb) rb.onclick = () => actions.rematch();
}

/** "Ravi is viewing…" — everyone on the offer except yourself. */
function tradeViewerLine(state, t, meId) {
  const names = (t.viewers || []).filter((v) => v !== meId)
    .map((v) => state.players.find((p) => p.id === v)?.name)
    .filter(Boolean);
  if (!names.length) return '';
  return `<div class="trade-viewing">${icon('eye')} ${names.map(escapeHtml).join(', ')} ${names.length > 1 ? 'are' : 'is'} viewing…</div>`;
}

function tradeCard(state, t, meId) {
  const from = state.players.find((p) => p.id === t.from);
  const describe = (side) => {
    const bits = [];
    if (side.money) bits.push(money(side.money));
    side.tiles.forEach((i) => bits.push(state.map.tiles[i].name));
    if (side.cards) bits.push(`${side.cards}× prison card`);
    return bits.length ? bits.map(escapeHtml).join(' · ') : 'nothing';
  };

  // Set aside: stays in the list as a quiet one-liner until you pick it back up.
  if (t.ignored) {
    return `<div class="panel trade-offer ignored">
      <div class="trade-line"><span>${icon('trade')} From ${escapeHtml(from?.name || '')}</span><b class="dim">${icon('snooze')} set aside</b></div>
      <button class="btn small wide" data-unignore="${t.id}">Review offer</button>
    </div>`;
  }

  return `<div class="panel trade-offer">
    <div class="panel-title">${icon('trade')} Offer from ${escapeHtml(from?.name || '')}</div>
    <div class="trade-line good"><span>You get</span><b>${describe(t.give)}</b></div>
    <div class="trade-line bad"><span>You give</span><b>${describe(t.get)}</b></div>
    ${tradeViewerLine(state, t, meId)}
    <div class="row-2">
      <button class="btn good small" data-accept="${t.id}">Accept</button>
      <button class="btn bad small" data-decline="${t.id}">Decline</button>
    </div>
    <div class="row-2" style="margin-top:6px">
      <button class="btn small" data-negotiate="${t.id}">${icon('trade')} Negotiate</button>
      <button class="btn ghost small" data-ignore="${t.id}" title="Keep it in the list, decide later">${icon('snooze')} Later</button>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────── board centre ──
export function renderCenter(state, meId, actions) {
  const actionEl = $('#centerAction');
  const statusEl = $('#centerStatus');
  const cardEl = $('#centerCard');
  const me = state.players.find((p) => p.id === meId);
  const turnPlayer = state.turn ? state.players.find((p) => p.id === state.turn.playerId) : null;
  const myTurn = state.turn?.playerId === meId;
  cardEl.innerHTML = '';
  syncQuickCountdown(state.status === 'lobby' && state.quick ? state.quickStartAt : null);
  // Which long-lived scene the action well is showing. The quick-play wait
  // carries a looping deck animation, so that scene is written once and left
  // alone; every other branch repaints and drops the mark.
  const wasMode = actionEl.dataset.mode || '';
  actionEl.dataset.mode = '';

  const on = (id, fn, sound) => {
    const b = $(id);
    if (b) b.onclick = () => { (sound || sfx.click)(); fn(); };
  };

  // lobby ────────────────────────────────────────────────────────────────
  if (state.status === 'lobby') {
    const seated = state.players.length;
    const seats = state.settings.maxPlayers;
    // A Quick Play table deals itself in on its own clock, so it shows the
    // wait instead of controls nobody at this table owns — with the still-
    // undealt deck riffling above the search line. The deck loops, so this
    // scene is painted once; the countdown and table talk tick themselves.
    const searching = !!(state.quick && state.quickStartAt);
    // The mark carries the room id: a well left over from an earlier table's
    // wait gets repainted for this one, not trusted.
    const waitMode = `quick-wait:${state.id}`;
    if (searching) {
      actionEl.dataset.mode = waitMode;
      if (wasMode !== waitMode) {
        actionEl.innerHTML = `${deckMarkup('idle')}
          <div class="quick-search"><span class="pulse-dot"></span> Finding players…</div>
          <div class="quick-count">Starting in <b id="quickCount">…</b></div>
          ${tableTalkHTML()}`;
      }
    } else {
      actionEl.innerHTML = state.hostId === meId
        ? `<button class="btn primary big" id="cStart">${icon('dice')} Start Game</button>`
        : '<div class="waiting"><span class="pulse-dot"></span> Waiting for the host…</div>';
    }
    statusEl.innerHTML = `
      <div class="lobby-head">
        <div class="room-code">${searching ? `${icon('bolt')} Quick Play` : `Room <b>${escapeHtml(state.id)}</b>`}</div>
        <div class="lobby-map">${icon('map')} ${escapeHtml(state.map.name)} · ${state.map.size} tiles${state.settings.teams > 0 ? ` · ${state.settings.teams} teams` : ''}</div>
      </div>
      <div class="seat-row">${Array.from({ length: seats }, (_, i) => {
        const p = state.players[i];
        // Waiting is nicer when you can see the table filling up, so each seat
        // shows who took it rather than an anonymous dot.
        if (!p) return '<div class="seat-slot open"><span class="seat-face"></span><span class="seat-name">open</span></div>';
        const face = p.avatar || (p.name[0] || '?').toUpperCase();
        return `<div class="seat-slot">
          <span class="seat-face" style="background:${p.color}">${escapeHtml(face)}</span>
          <span class="seat-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
        </div>`;
      }).join('')}</div>
      <div class="dim small">${seated} of ${seats} ${seated === 1 ? 'seat' : 'seats'} taken</div>`;
    on('#cStart', actions.start);
    paintQuickCountdown();
    return;
  }

  // game over ────────────────────────────────────────────────────────────
  // Closing the result sheet used to leave an empty board with no way on, so
  // the well keeps the two moves that are left: read it again, or go home.
  if (state.status === 'ended') {
    actionEl.innerHTML = `<div class="row-2">
        <button class="btn" id="cStandings">${icon('chart')} Final standings</button>
        <button class="btn ghost" id="cHome">${icon('door')} Back to home</button>
      </div>
      ${state.hostId === meId ? `<button class="btn primary wide wrap" id="cAgain">${icon('replay')} Play again with the same players</button>` : ''}`;
    statusEl.innerHTML = state.winner
      ? `<div class="win-line" style="color:${state.winner.color}">${icon('trophy')} ${escapeHtml(state.winner.name)} wins!</div>`
      : '<div class="win-line">Game over</div>';
    on('#cStandings', () => showGameOver(state, meId, actions));
    on('#cHome', () => actions.goHome?.());
    on('#cAgain', actions.rematch);
    return;
  }

  // auction ──────────────────────────────────────────────────────────────
  if (state.auction) {
    const a = state.auction;
    const tile = state.map.tiles[a.tile];
    const leader = state.players.find((p) => p.id === a.leader);
    const inRace = a.inRace.includes(meId);
    const min = a.bid === 0 ? 10 : a.bid + 10;
    // The leading bid is escrowed out of the leader's wallet the moment it
    // lands, so their real ceiling is the cash still showing plus the money
    // already on the table — read off the wallet alone it looks lower.
    const purse = (me?.money || 0) + (a.leader === meId ? a.bid : 0);
    const steps = [min, min + 40, min + 90].filter((v) => v <= purse);
    cardEl.innerHTML = deedMarkup(state, a.tile, { compact: true }) || '';
    actionEl.innerHTML = `
      <div class="auction-box">
        <div class="auction-label">${icon('gavel')} Auction</div>
        <div class="auction-bid">${money(a.bid)}</div>
        <div class="dim small">${leader
          ? `leading: <b style="color:${leader.color}">${escapeHtml(leader.name)}${a.leader === meId ? ' (you)' : ''}</b>`
          : 'no bids yet'}</div>
        <div class="auction-timer"><i id="auctionBar"></i></div>
        ${inRace ? `<div class="bid-row">
            ${steps.map((v) => `<button class="btn small" data-bid="${v}">${money(v)}</button>`).join('')}
            <button class="btn small bad" id="passBid">Pass</button>
          </div>
          ${steps.length ? '' : `<div class="dim small mt">${money(min)} is the next bid — more than you can raise. Passing is the only move left.</div>`}`
        : '<div class="dim small mt">You are out of this auction</div>'}
      </div>`;
    statusEl.innerHTML = '';
    actionEl.querySelectorAll('[data-bid]').forEach((b) => {
      // the state diff plays the bid sound for everyone (including us) — a
      // click sound here would double it up
      b.onclick = () => actions.bid(Number(b.dataset.bid));
    });
    on('#passBid', actions.passBid);
    animateAuctionBar(a);
    return;
  }

  // waiting for someone else ─────────────────────────────────────────────
  if (!myTurn) {
    actionEl.innerHTML = '';
    statusEl.innerHTML = turnPlayer
      ? `<div class="turn-block">
           <span class="avatar lg" style="background:${turnPlayer.color}">${escapeHtml((turnPlayer.name[0] || '?').toUpperCase())}</span>
           <div class="turn-line" style="color:${turnPlayer.color}">${escapeHtml(turnPlayer.name)}'s turn</div>
           <div class="dim small">${phaseHint(state, turnPlayer)}</div>
         </div>`
      : '';
    return;
  }

  // my turn ──────────────────────────────────────────────────────────────
  const t = state.turn;
  let html = '';
  let status = '';

  if (t.phase === 'debt') {
    const d = t.debt;
    const creditor = d.creditor ? state.players.find((p) => p.id === d.creditor) : null;
    html = `<button class="btn good big" id="cPayDebt" ${me.money < d.amount ? 'disabled' : ''}>Pay ${money(d.amount)}</button>
            <button class="btn bad wide" id="cBankrupt">Declare bankruptcy</button>`;
    status = `<div class="alert">You owe <b>${money(d.amount)}</b>${creditor ? ` to <b style="color:${creditor.color}">${escapeHtml(creditor.name)}</b>` : ' to the bank'}</div>
      <div class="dim small">Your properties panel lists the fastest ways to raise it.</div>`;
  } else if (t.phase === 'action' && t.pending?.type === 'buy') {
    const tile = state.map.tiles[t.pending.tile];
    cardEl.innerHTML = deedMarkup(state, t.pending.tile, { compact: true }) || '';
    html = `<button class="btn good big" id="cBuy" ${me.money < tile.price ? 'disabled' : ''}>Buy for ${money(tile.price)}</button>
            <button class="btn wide ghost" id="cSkip">${state.settings.auction ? `${icon('gavel')} Send to auction` : 'Skip'}</button>`;
    status = me.money < tile.price ? '<div class="dim small">Not enough cash for this one.</div>' : '';
  } else if (t.phase === 'roll') {
    if (me.jail) {
      html = `<button class="btn primary big" id="cRoll">${icon('dice')} Roll for a double</button>
              <div class="row-2">
                <button class="btn ghost" id="cJailPay" ${me.money < 50 ? 'disabled' : ''}>Pay $50</button>
                ${me.getOutCards > 0 ? `<button class="btn gold" id="cJailCard">Use ${icon('ticket')} card</button>` : ''}
              </div>`;
      status = `<div class="dim small">In prison · attempt ${me.jailTurns + 1} of 3</div>`;
    } else {
      html = `<button class="btn primary big" id="cRoll">${icon('dice')} Roll dice</button>`;
      status = t.doubles > 0 ? `<div class="dim small">Double! Free roll (${t.doubles} of 2)</div>` : '';
    }
  } else if (t.phase === 'end') {
    html = '<button class="btn primary big" id="cEnd">End turn →</button>';
    status = '<div class="dim small">Build, mortgage or trade before you finish.</div>';
  }

  actionEl.innerHTML = html;
  statusEl.innerHTML = status;

  on('#cRoll', actions.roll, sfx.dice);
  on('#cBuy', actions.buy, sfx.buy);
  on('#cSkip', actions.skipBuy);
  on('#cEnd', actions.endTurn);
  on('#cJailPay', actions.jailPay, sfx.cash);
  on('#cJailCard', actions.jailCard, sfx.cash);
  on('#cPayDebt', actions.payDebt, sfx.cash);
  on('#cBankrupt', () => confirmModal('Declare bankruptcy?',
    'Everything you own goes to your creditor and you are out of the game.', actions.bankrupt));
}

function phaseHint(state, p) {
  const t = state.turn;
  if (!t) return '';
  if (t.phase === 'debt') return 'raising funds…';
  if (t.phase === 'action') return 'deciding on a property…';
  if (t.phase === 'roll') return p.jail ? 'locked up' : 'about to roll…';
  return 'wrapping up…';
}

// ─────────────────────────────────────────────────────────── table talk ──
// Two waits leave everyone staring at one spot: the quick-play search, and
// the result sheet while the host decides. That spot gets a line worth
// reading — a gameplay tip or a fact about one of the board's cities —
// turned over every eight seconds. Renders repaint whatever line is current;
// only the ticker advances it, and the ticker puts itself away once nothing
// on screen carries the line.
let talkPool = null;
let talkFetch = null; // one fetch a page load, shared by every wait
let talkAt = 0;
let talkTimer = null;

const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function loadTalk() {
  if (talkFetch) return;
  // Whichever host served the page also serves this file.
  talkFetch = fetch('/data/tips.json').then((r) => r.json()).then((d) => {
    const tips = shuffled((d.tips || []).map((t) => escapeHtml(t)));
    const facts = shuffled((d.facts || [])
      .map((f) => `<b>${escapeHtml(f.city)}</b> — ${escapeHtml(f.text)}`));
    // Strict alternation, each deck looping on its own — there are six facts
    // to every tip, and a plain concat would bury the tips at the front.
    talkPool = [];
    for (let i = 0; i < Math.max(tips.length, facts.length) * 2; i++) {
      const deck = i % 2 ? facts : tips;
      if (deck.length) talkPool.push(deck[(i >> 1) % deck.length]);
    }
    // The first paint went out before the file arrived — fill it in.
    const el = document.getElementById('tableTalk');
    if (el) el.innerHTML = talkSpan('talk-in');
  }).catch(() => { talkFetch = null; /* offline — a later wait tries again */ });
}

const talkSpan = (cls) => (talkPool?.length
  ? `<span class="${cls}">${talkPool[talkAt % talkPool.length]}</span>` : '');

function tableTalkHTML() {
  loadTalk();
  if (!talkTimer) {
    talkTimer = setInterval(() => {
      const el = document.getElementById('tableTalk');
      if (!el) { clearInterval(talkTimer); talkTimer = null; return; }
      talkAt += 1;
      el.innerHTML = talkSpan('talk-in');
    }, 8000);
  }
  return `<div class="table-talk" id="tableTalk">${talkSpan('')}</div>`;
}

// ──────────────────────────────────────────────── quick play countdown ──
// The deal-in deadline rides along with the state, but the seconds are counted
// here: a state push can be a minute old after a sleeping tab, and a number
// frozen mid-countdown reads as a table that has given up on you.
let quickEndsAt = null;
let quickTimer = null;

function paintQuickCountdown() {
  const el = document.getElementById('quickCount');
  if (!el) return; // the searching state isn't on screen
  const secs = quickEndsAt ? Math.max(0, Math.ceil((quickEndsAt - Date.now()) / 1000)) : 0;
  el.textContent = secs ? `${secs}s` : 'a moment';
}

function syncQuickCountdown(endsAt) {
  quickEndsAt = endsAt || null;
  paintQuickCountdown();
  if (quickEndsAt && !quickTimer) quickTimer = setInterval(paintQuickCountdown, 250);
  else if (!quickEndsAt && quickTimer) { clearInterval(quickTimer); quickTimer = null; }
}

// ─────────────────────────────────────────────────────────── turn clock ──
// The deadline rides along with the state, but the seconds are counted here:
// a push can be minutes old after a sleeping tab, and a chip frozen on "42s"
// reads as a broken game.
const clock = { endsAt: null, total: 0, playerId: null, mine: false };
let clockTimer = null;

const clockText = (secs) => (secs >= 60
  ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  : `${secs}s`);

export function syncTurnClock(state, meId) {
  const playing = state.status === 'playing';
  // A table where one person is playing the house's seats runs no shot clock,
  // and the server says so by sending no deadline. That is not "zero seconds
  // left" — there is nothing to count, so nothing is shown.
  const live = playing && state.turn?.endsAt ? state.turn : null;
  clock.endsAt = live?.endsAt || null;
  clock.playerId = live?.playerId || null;
  clock.mine = !!live && live.playerId === meId;
  clock.total = Math.max(0, Number(state.settings?.turnSeconds) || 0) * 1000;
  paintTurnClock();
  // Turns carry their own deadline, so the ticker runs across the whole game
  // rather than being torn down and rebuilt around each one — a clock that
  // stops between turns reads as a dead table.
  if (playing && clock.endsAt && !clockTimer) clockTimer = setInterval(paintTurnClock, 200);
}

/** Whole seconds left on the turn, or null when this table runs no shot clock. */
function clockSeconds() {
  if (!clock.endsAt) return null;
  const left = clock.endsAt - Date.now();
  // A device whose own clock sits minutes behind the server's would otherwise
  // show "9:58" on a sixty-second turn; the turn length is the honest ceiling.
  return Math.max(0, Math.ceil((clock.total ? Math.min(left, clock.total) : left) / 1000));
}

function paintTurnClock() {
  const secs = clockSeconds();
  const urgent = secs !== null && secs <= 10;

  document.querySelectorAll('.player-card').forEach((card) => {
    const el = card.querySelector('.turn-clock');
    if (!el) return;
    const on = secs !== null && card.dataset.pid === clock.playerId;
    el.classList.toggle('hidden', !on);
    // Emptied rather than left as it was: a hidden chip still holding "0s" is
    // one stylesheet accident away from being on screen.
    if (!on) { el.textContent = ''; el.classList.remove('urgent'); return; }
    el.textContent = clockText(secs);
    el.classList.toggle('urgent', urgent);
  });

  const well = $('#centerClock');
  if (well) {
    well.classList.toggle('hidden', secs === null);
    well.classList.toggle('urgent', secs !== null && urgent);
    well.textContent = secs === null ? ''
      : clock.mine ? `${clockText(secs)} left on your turn` : clockText(secs);
  }

  // Nothing to count — stop the ticker until a turn arrives that has an end.
  if (secs === null && clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}

// ──────────────────────────────────────────── holding a dropped chair ──
// A seat is only held for as long as the table agrees to hold it, so the card
// has to answer three things at a glance: who we are waiting for, how long is
// left, and — once the free favours are spent — how many people still have to
// click before the minute lands.
let awaitTimer = null;

export function renderAwaiting(state, meId, el, actions) {
  if (!el) return;
  const seats = (state.status === 'playing' ? state.awaiting || [] : [])
    .map((a) => ({ ...a, granted: a.granted || [], player: state.players.find((p) => p.id === a.id) }))
    // Nobody is asked to wait for themselves, and a chair whose player is back
    // — or that has already gone back to the board — is nobody's problem.
    .filter((a) => a.player && a.id !== meId && !a.player.connected && !a.player.timedOut);

  el.classList.toggle('hidden', !seats.length);

  // Only the countdown moves between pushes, and rebuilding a button under a
  // finger swallows the tap that was already on its way to it.
  const sig = seats.map((a) => `${a.id}:${a.needAll ? 1 : 0}:${a.granted.join(',')}:${a.voters}:${a.until}`).join('|');
  if (el.dataset.sig !== sig) {
    el.dataset.sig = sig;
    el.innerHTML = seats.map((a) => awaitCard(a, meId)).join('');
    el.querySelectorAll('[data-grant]').forEach((b) => {
      b.onclick = () => { sfx.click(); actions.grantTime(b.dataset.grant); };
    });
  }
  paintAwaiting();
  if (seats.length && !awaitTimer) awaitTimer = setInterval(paintAwaiting, 250);
  else if (!seats.length && awaitTimer) { clearInterval(awaitTimer); awaitTimer = null; }
}

function awaitCard(a, meId) {
  const p = a.player;
  // A vote only exists once one click is no longer enough, so before that
  // nobody is ever locked out of the button.
  const voted = a.needAll && a.granted.includes(meId);
  const need = Math.max(1, a.voters);
  const agreed = Math.min(a.granted.length, need);
  // With nobody else left to ask, a "vote" is just you clicking again — so the
  // card drops the ballot language rather than counting you as a missing voter.
  const alone = need <= 1;

  const label = !a.needAll || alone ? `${icon('trade')} Grant a minute`
    : voted ? `✓ You agreed · ${agreed} of ${need}`
    : `${icon('trade')} Vote to wait · ${agreed} of ${need} agreed`;
  const note = !a.needAll
    ? 'Any one player can do this alone for now.'
    : alone ? 'You are the only one left to ask — keep the seat open as long as you like.'
      : voted ? 'Waiting on the rest of the table — everyone has to click.'
      : `${need - agreed} more ${need - agreed === 1 ? 'player has' : 'players have'} to agree before the minute lands.`;

  return `<div class="await-card">
    <div class="aw-head">
      <span class="avatar sm" style="background:${p.color}">${escapeHtml((p.name[0] || '?').toUpperCase())}</span>
      <div class="aw-who">
        <b>${escapeHtml(p.name)}</b> dropped out
        <span class="aw-left" data-until="${Number(a.until) || 0}"></span>
      </div>
    </div>
    ${a.needAll && !alone ? `<div class="aw-votes">${Array.from({ length: need },
      (_, k) => `<i class="${k < agreed ? 'on' : ''}"></i>`).join('')}</div>` : ''}
    <button class="btn small wide ${voted ? 'ghost' : 'gold'}"
      data-grant="${escapeHtml(a.id)}" ${voted ? 'disabled' : ''}>${label}</button>
    <span class="aw-note">${note}</span>
  </div>`;
}

function paintAwaiting() {
  document.querySelectorAll('.aw-left').forEach((el) => {
    const secs = Math.max(0, Math.ceil((Number(el.dataset.until) - Date.now()) / 1000));
    el.textContent = secs ? `Seat goes back to the board in ${clockText(secs)}` : 'Letting the seat go…';
    el.classList.toggle('urgent', secs > 0 && secs <= 10);
  });
}

let auctionRaf = null;
// A bid buys the auction a fresh, shorter deadline than the one it opened
// with, so the bar has to be measured against the stretch it is actually
// counting down — a fixed span would refill to two-thirds and read as a
// timer that shrank when it had in fact just been extended.
const auctionSpan = { endsAt: 0, ms: 1 };

function animateAuctionBar(a) {
  cancelAnimationFrame(auctionRaf);
  if (auctionSpan.endsAt !== a.endsAt) {
    auctionSpan.endsAt = a.endsAt;
    auctionSpan.ms = Math.max(1, a.endsAt - Date.now());
  }
  const step = () => {
    const bar = document.getElementById('auctionBar');
    if (!bar) return;
    const left = Math.max(0, a.endsAt - Date.now());
    bar.style.width = `${Math.min(100, (left / auctionSpan.ms) * 100)}%`;
    if (left > 0) auctionRaf = requestAnimationFrame(step);
  };
  step();
}

// ───────────────────────────────────────────────────────────────── dice ──
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const pipHtml = (v) => Array.from({ length: 9 }, (_, i) => (PIPS[v].includes(i) ? '<span class="pip"></span>' : '<span></span>')).join('');

export function renderDice(state) {
  const dice = state.turn?.dice;
  const stamp = String(state.lastMove?.at || state.turn?.dice?.join('') || '');
  document.querySelectorAll('.die').forEach((die, k) => {
    const v = dice?.[k];
    if (!v) { die.classList.remove('show'); die.dataset.stamp = ''; return; }
    die.classList.add('show');
    if (die.dataset.stamp !== stamp || die.dataset.v !== String(v)) {
      die.dataset.stamp = stamp;
      die.dataset.v = String(v);
      die.innerHTML = pipHtml(v);
      die.classList.remove('rolling');
      void die.offsetWidth;
      die.classList.add('rolling');
    }
  });
}

// ─────────────────────────────────────────────────────────── turn banner ──
export function showTurnBanner(player, isMe) {
  const el = $('#turnBanner');
  el.innerHTML = `<div class="tb-inner" style="--c:${player.color}">
      <span class="tb-avatar" style="background:${player.color}">${escapeHtml((player.name[0] || '?').toUpperCase())}</span>
      <span class="tb-text">${isMe ? 'Your turn!' : `${escapeHtml(player.name)}'s turn`}</span>
    </div>`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1600);
}

// ─────────────────────────────────────────────────────────────── modals ──
// ─────────────────────────────────────────────────────────────── store ──

/**
 * The cosmetics shop: token skins for the board piece, avatars for the chip.
 *
 * `onWallet` is called whenever the balance moves, so the coin chip the player
 * came from doesn't sit there showing what they had before they spent it.
 * `scrollTo` restores the scroll position when the sheet redraws itself after a
 * purchase — equipping an avatar used to throw you back to the top of the shop.
 */
// A pack's own emoji says what size of top-up it is; these are the drawings
// that say the same thing — a coin, a note, a bank — in the app's own hand.
const PACK_ART = { '🪙': 'coin', '💰': 'cash', '🏦': 'bank' };

export function openStoreModal(token, onWallet, scrollTo = 0) {
  Promise.all([
    fetch(api('/api/store')).then((r) => r.json()),
    fetch(api(`/api/wallet?token=${encodeURIComponent(token)}`)).then((r) => r.json()),
  ]).then(([storeData, wallet]) => {
    const items = storeData.items || [];
    const packs = storeData.packs || [];
    const coins = wallet.coins ?? 0;
    const section = (kind, title, sub) => `
      <h3 class="map-section">${title}</h3>
      <p class="sub">${sub}</p>
      <div class="store-grid">
        ${items.filter((i) => i.kind === kind).map((i) => {
          const owned = wallet.owned?.includes(i.id);
          const equipped = wallet.equipped?.[i.kind] === i.id;
          const locked = !owned && coins < i.price;
          return `<button class="store-card ${equipped ? 'equipped' : owned ? 'owned' : ''} ${locked ? 'locked' : ''}"
                    data-item="${i.id}" data-kind="${i.kind}" data-owned="${owned ? 1 : 0}"
                    title="${locked ? `${i.price - coins} more coins needed` : escapeHtml(i.name)}">
            <span class="sc-emoji">${i.emoji}</span>
            <span class="sc-name">${escapeHtml(i.name)}</span>
            <span class="sc-price">${equipped ? '✓ Equipped' : owned ? 'Tap to equip' : `${icon('coin', 13)} ${i.price}`}</span>
          </button>`;
        }).join('')}
      </div>`;

    // With Stripe configured the packs are real buy buttons; without it they
    // stay a shop window pointing at the iOS app, never a dead button.
    const canPay = !!storeData.stripe;
    const packCard = (p) => {
      const inner = `
          <span class="pk-emoji">${icon(PACK_ART[p.emoji] || 'coin', 32, 'solo')}</span>
          ${p.bonus ? `<span class="pk-bonus">+${p.bonus}%</span>` : ''}
          <span class="pk-coins">${icon('coin', 15)} ${p.coins}</span>
          <span class="pk-name">${escapeHtml(p.name)}</span>
          <span class="pk-price">$${escapeHtml(p.price)}</span>`;
      return canPay
        ? `<button class="pack-card" data-pack="${p.id}">${inner}</button>`
        : `<a class="pack-card" href="/app.html" target="_blank" rel="noopener">${inner}</a>`;
    };
    const packSection = packs.length ? `
      <h3 class="map-section">${icon('coin')} Coin packs</h3>
      <p class="sub">${canPay
        ? 'Pay by card — coins land in your wallet as soon as the payment clears.'
        : `Coin packs are purchased in the iOS app.
        <a class="pack-link" href="/app.html" target="_blank" rel="noopener">Get MoneyMove for iPhone →</a>`}</p>
      <div class="pack-grid">
        ${packs.map(packCard).join('')}
      </div>` : '';

    openModal(`
      <div class="store-head">
        <h2>Store</h2>
        <span class="coin-chip">${icon('coin')} ${coins}</span>
        <button class="icon-btn sheet-x" id="stX" title="Close the store" aria-label="Close the store">✕</button>
      </div>
      <p class="sub">Win games to earn coins — 50 for a quick match, 100 when it goes long. Everything here is pure style.</p>
      ${packSection}
      ${section('token', `${icon('dice')} Token skins`, 'Your piece on the board.')}
      ${section('avatar', `${icon('people')} Avatars`, 'Your face in the player chip.')}
      <div class="modal-actions"><button class="btn ghost" id="stClose">Close</button></div>`, (root) => {
      const sheet = $('.modal', root);
      sheet.scrollTop = scrollTo;
      onWallet?.(coins);
      $('#stClose', root).onclick = closeModal;
      // The shop is long enough that its only way out used to be a scroll away.
      $('#stX', root).onclick = closeModal;
    root.querySelectorAll('[data-pack]').forEach((b) => {
      b.onclick = async () => {
        sfx.click();
        b.disabled = true;
        try {
          const out = await fetch(api('/api/store/checkout'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, packId: b.dataset.pack }),
          }).then((r) => r.json());
          // Stripe hosts the payment page; the webhook credits the coins, so
          // there is nothing to await here — just go.
          if (out.url) { location.href = out.url; return; }
          toast(out.error || 'Could not start the payment', 'error');
        } catch {
          toast('Could not start the payment', 'error');
        }
        b.disabled = false;
      };
    });
      root.querySelectorAll('[data-item]').forEach((card) => {
        card.onclick = async () => {
          sfx.click();
          const id = card.dataset.item;
          const kind = card.dataset.kind;
          const owned = card.dataset.owned === '1';
          const equipped = card.classList.contains('equipped');
          const at = sheet.scrollTop;
          try {
            if (!owned) {
              const res = await fetch(api('/api/store/buy'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, itemId: id }),
              }).then((r) => r.json());
              if (res.error) return toast(res.error, 'error');
              sfx.buy();
            }
            // buying auto-equips; tapping an equipped item takes it off
            await fetch(api('/api/store/equip'), {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, slot: kind, itemId: equipped ? null : id }),
            });
            closeModal();
            openStoreModal(token, onWallet, at);   // re-render with fresh wallet
          } catch {
            toast('Store is unreachable', 'error');
          }
        };
      });
    }, 'wide');
  }).catch(() => toast('Store is unreachable', 'error'));
}

// ──────────────────────────────────────────────────────────── friend DMs ──

export function openDmModal(token, code, name) {
  openModal(`
    <h2>${icon('chat')} ${escapeHtml(name)}</h2>
    <div id="dmList" class="dm-list"><div class="empty">${icon('chat')} Say hi</div></div>
    <form id="dmForm" class="chat-form">
      <input id="dmInput" maxlength="300" placeholder="Message ${escapeHtml(name)}…" autocomplete="off" />
      <button class="icon-btn send" type="submit">➤</button>
    </form>
    <div class="modal-actions"><button class="btn ghost" id="dmClose">Close</button></div>`, (root) => {
    const list = $('#dmList', root);
    let lastSig = '';
    $('#dmClose', root).onclick = closeModal;

    const paint = (messages, me) => {
      const sig = `${messages.length}:${messages[messages.length - 1]?.at || 0}`;
      if (sig === lastSig) return;
      lastSig = sig;
      list.innerHTML = messages.length
        ? messages.map((m) => `<div class="dm-msg ${m.from === me ? 'mine' : ''}">${escapeHtml(m.text)}</div>`).join('')
        : `<div class="empty">${icon('chat')} Say hi</div>`;
      list.scrollTop = list.scrollHeight;
    };

    // `root` is the permanent modal host, so watching it never ends the poll —
    // the list itself is what closing the sheet takes out of the document.
    const load = async () => {
      if (!document.body.contains(list)) { clearInterval(timer); return; }
      try {
        const d = await fetch(api(`/api/dm?token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`))
          .then((r) => r.json());
        if (d.messages) paint(d.messages, d.me);
      } catch { /* server nap — next poll retries */ }
    };
    const timer = setInterval(load, 2500);
    load();

    $('#dmForm', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('#dmInput', root);
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      sfx.click();
      try {
        // A refused message (they dropped you as a friend, say) came back as a
        // 400 the old code never read, so the line just vanished.
        const res = await fetch(api('/api/dm'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, code, text }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          input.value = text;
          toast(d.error || 'Message did not send', 'error');
        }
      } catch {
        input.value = text;
        toast('Message did not send', 'error');
      }
      load();
    });
  });
}

// The deed sheet outlives the state that opened it — building from it must
// leave the numbers fresh, so it registers a repainter the render loop calls.
let deedRepaint = null;

// Some sheets announce themselves to the table while they are open — the trade
// composer tells the other side you are reading their offer. That has to be
// taken back however the sheet goes away, Escape and a replacing sheet
// included, or the table is told you are still reading it forever.
let modalCleanup = null;
export function onModalClose(fn) { modalCleanup = fn; }
function runModalCleanup() {
  const done = modalCleanup;
  modalCleanup = null;
  done?.();
}

/** Redraws whatever open modal has to follow the live game. */
export function syncOpenModals(state) {
  deedRepaint?.(state);
}

export function closeModal() {
  const root = $('#modalRoot');
  deedRepaint = null;
  runModalCleanup();
  root.classList.add('hidden');
  root.innerHTML = '';
}

function openModal(html, onMount, extraClass = '') {
  const root = $('#modalRoot');
  deedRepaint = null; // a new sheet replaces whatever was repainting
  runModalCleanup();  // …and a replaced sheet is a closed one
  root.classList.remove('hidden');
  root.innerHTML = `<div class="modal ${extraClass}">${html}</div>`;
  root.onclick = (e) => { if (e.target === root) closeModal(); };
  onMount?.(root);
}

export function confirmModal(title, body, onYes) {
  openModal(`
    <h2>${escapeHtml(title)}</h2>
    <p class="sub">${escapeHtml(body)}</p>
    <div class="modal-actions">
      <button class="btn ghost" id="mNo">Cancel</button>
      <button class="btn bad" id="mYes">Confirm</button>
    </div>`, (root) => {
    $('#mNo', root).onclick = closeModal;
    $('#mYes', root).onclick = () => { closeModal(); onYes(); };
  }, 'small');
}

// ────────────────────────────────────────────────────── random nickname ──
// The server hands out the real list; these two columns only exist so the
// dice still work when it is asleep.
const NAME_ADJECTIVES = ['Lucky', 'Bold', 'Royal', 'Swift', 'Golden', 'Cheeky', 'Wild', 'Neon', 'Jolly', 'Turbo'];
const NAME_NOUNS = ['Tycoon', 'Baron', 'Trader', 'Broker', 'Tiger', 'Falcon', 'Rocket', 'Seth', 'Raja', 'Boss'];

export async function randomName() {
  try {
    const d = await fetch(api('/api/name')).then((r) => r.json());
    if (d?.name) return String(d.name).slice(0, 16);
  } catch { /* offline — the local pair below still reads like a table name */ }
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return `${pick(NAME_ADJECTIVES)} ${pick(NAME_NOUNS)}`.slice(0, 16);
}

/** A stranger arriving on a share link needs a name before they can sit down. */
export function openJoinNameModal(roomId, onJoin) {
  openModal(`
    <h2>What should we call you?</h2>
    <p class="sub">You have been invited to room <b>${escapeHtml(roomId)}</b>. Pick a name and take a seat.</p>
    <div class="name-row">
      <input id="jnName" maxlength="16" placeholder="Nickname" autocomplete="off" />
      <button class="btn dice-btn" id="jnDice" type="button"
        title="Give me a name" aria-label="Give me a name">${icon('dice', null, 'solo')}</button>
    </div>
    <div class="modal-actions"><button class="btn primary wide" id="jnGo">Join the game</button></div>`, (root) => {
    const input = $('#jnName', root);
    input.focus();
    $('#jnDice', root).onclick = async () => { sfx.click(); input.value = await randomName(); };
    const join = () => {
      const name = input.value.trim().slice(0, 16);
      if (!name) return toast('Type a name, or roll the dice for one', 'error');
      sfx.click();
      closeModal();
      onJoin(name);
    };
    $('#jnGo', root).onclick = join;
    input.onkeydown = (e) => { if (e.key === 'Enter') join(); };
  }, 'small');
}

/** Two ways out of a live game, spelled out — one keeps the chair, one doesn't. */
export function openLeaveModal({ onKeepSeat, onQuit }) {
  openModal(`
    <h2>Leaving the table?</h2>
    <p class="sub">The game is still running — pick how you go.</p>
    <div class="leave-choices">
      <button class="leave-choice" id="lBack">
        <b>${icon('replay')} I'll come back</b>
        <span>A bot holds your seat and your properties. Continue from the home screen any time.</span>
      </button>
      <button class="leave-choice bad" id="lQuit">
        <b>${icon('door')} Leave for good</b>
        <span>Your deeds go back to the bank and the table plays on without you.</span>
      </button>
    </div>
    <p class="karma-note">Leaving or timing out costs 1 karma.</p>
    <div class="modal-actions"><button class="btn ghost" id="lStay">Stay in the game</button></div>`, (root) => {
    $('#lStay', root).onclick = closeModal;
    $('#lBack', root).onclick = () => { sfx.click(); closeModal(); onKeepSeat(); };
    $('#lQuit', root).onclick = () => { sfx.click(); closeModal(); onQuit(); };
  }, 'small');
}

/** The clock ran out on this seat — say so plainly and offer both exits. */
export function showRemovedOverlay({ onHome, onWatch }) {
  openModal(`
    <div class="removed-mark">${icon('door')}</div>
    <h2 class="removed-title">Your time ran out</h2>
    <p class="sub">You were removed to keep the game moving. You can head back or stay and watch how it ends.</p>
    <p class="karma-note">Leaving or timing out costs 1 karma.</p>
    <div class="modal-actions">
      <button class="btn ghost" id="rHome">Back to home</button>
      <button class="btn primary" id="rWatch">Stay and watch</button>
    </div>`, (root) => {
    // A stray click on the felt shouldn't decide this for them.
    root.onclick = null;
    $('#rHome', root).onclick = () => { sfx.click(); closeModal(); onHome(); };
    $('#rWatch', root).onclick = () => { sfx.click(); closeModal(); onWatch?.(); };
  }, 'small removed-modal');
}

/**
 * The tap-up / tap-down row on a deed you own. Sell sits left of the building
 * count and build sits right of it, so a whole street can be taken to a hotel
 * without the sheet closing between taps. It rides high on the card — right
 * under the price — with the building count and the next-cost line, so the
 * rent table never has to be scrolled past to reach a button.
 */
function quickBuildBar(state, meId, i) {
  const tile = state.map.tiles[i];
  const own = state.ownership[i];
  const me = state.players.find((p) => p.id === meId);
  const cash = me?.money || 0;
  const houses = own.houses || 0;
  const street = tile.type === 'property';
  const houseCost = tile.houseCost || 0;
  const sellBack = Math.floor(houseCost / 2);
  const mortValue = Math.floor((tile.price || 0) / 2);
  const liftCost = Math.ceil(((tile.price || 0) / 2) * 1.1);

  const buildable = street && canBuildOn(state, meId, i);
  const sellable = canSellOn(state, meId, i);
  const canAfford = cash >= houseCost;
  const mortgageable = canMortgage(state, meId, i);
  const canLift = own.mortgaged && state.settings.mortgage;

  const level = own.mortgaged ? `${icon('bank')} Mortgaged`
    : houses === 5 ? `${icon('hotel')} Hotel`
    : houses ? icon('house').repeat(houses)
    : 'No buildings yet';

  // Why the ＋ is greyed out matters more than that it is: "even build" is the
  // rule people meet first and understand last, so it gets named.
  const group = street ? (state.map.groups[tile.group] || []) : [];
  const wholeSet = group.length > 0 && group.every((g) => state.ownership[g]?.owner === meId);
  const setMortgaged = wholeSet && group.some((g) => state.ownership[g]?.mortgaged);
  const evenBlocked = wholeSet && !setMortgaged && state.settings.evenBuild
    && houses > Math.min(...group.map((g) => state.ownership[g].houses || 0));
  const behind = evenBlocked
    ? group.filter((g) => (state.ownership[g].houses || 0) < houses)
      .map((g) => state.map.tiles[g].name)
    : [];

  const next = !street ? 'Airports and utilities can only be mortgaged.'
    : own.mortgaged ? `Buy the mortgage back for $${liftCost} before building.`
    : houses === 5 ? 'Fully built — nothing more to add.'
    : evenBlocked ? `Even build — put a house on ${behind.join(' and ')} first.`
    : setMortgaged ? 'Lift the mortgage on the rest of this set before building.'
    : !wholeSet ? 'You need every street of this country to build.'
    : !buildable ? 'You cannot build here right now.'
    : `Next ${houses === 4 ? 'hotel' : 'house'} costs $${houseCost}${!canAfford ? ' — short on cash' : ''}`;

  return `<div class="quick-build">
    <div class="qb-status">
      <span class="qb-level">${level}</span>
      <span class="qb-next">${escapeHtml(next)}</span>
    </div>
    <div class="qb-row">
      ${street ? `
        <button class="qb-btn" data-qb-sell title="Sell a building for $${sellBack}" ${sellable ? '' : 'disabled'}>−</button>
        <span class="qb-count">${houses === 5 ? icon('hotel') : houses}<small>${houses === 5 ? '' : '/5'}</small></span>
        <button class="qb-btn" data-qb-build title="Build for $${houseCost}" ${buildable && canAfford ? '' : 'disabled'}>＋</button>` : ''}
      ${own.mortgaged
        ? `<button class="qb-btn mort gold" data-qb-unmort title="${escapeHtml(!state.settings.mortgage ? 'Mortgages are switched off on this table'
            : cash < liftCost ? `You need $${liftCost} to buy this mortgage back` : 'Buy the mortgage back')}"
            ${canLift && cash >= liftCost ? '' : 'disabled'}>↺ Buy back $${liftCost}</button>`
        : `<button class="qb-btn mort" data-qb-mort title="${escapeHtml(!state.settings.mortgage ? 'Mortgages are switched off on this table'
            : group.some((g) => (state.ownership[g]?.houses || 0) > 0) ? 'Sell the buildings on this set first'
            : 'Mortgage this deed')}" ${mortgageable ? '' : 'disabled'}>${icon('bank')} Mortgage $${mortValue}</button>`}
    </div>
  </div>`;
}

export function openDeedModal(state, i, meId, actions) {
  if (!deedMarkup(state, i)) return;

  // Every tap redraws this sheet from the state the server sends back, so the
  // counts and prices under the buttons are never a turn behind.
  const paint = (s, sheet) => {
    const own = s.ownership[i];
    const me = s.players.find((p) => p.id === meId);
    const isMine = own?.owner === meId && !isOut(me || {}) && s.status === 'playing';
    sheet.innerHTML = `${deedMarkup(s, i, { actions: isMine ? quickBuildBar(s, meId, i) : '' })}
      <div class="modal-actions"><button class="btn ghost" data-deed-close>Close</button></div>`;
    sheet.querySelector('[data-deed-close]').onclick = closeModal;
    const tap = (attr, fn, sound) => {
      const b = sheet.querySelector(`[${attr}]`);
      if (b && !b.disabled) b.onclick = () => { (sound || sfx.click)(); fn(i); };
    };
    tap('data-qb-build', actions.build, sfx.build);
    tap('data-qb-sell', actions.sellHouse);
    tap('data-qb-mort', actions.mortgage, sfx.cash);
    tap('data-qb-unmort', actions.unmortgage, sfx.cash);
  };

  openModal('', (root) => {
    const sheet = $('.modal', root);
    paint(state, sheet);
    deedRepaint = (s) => paint(s, sheet);
  }, 'deed-modal');
}

/** Draws a miniature of a board from the colour + side data the API returns. */
function miniBoard(preview) {
  const { colors, sides } = preview;
  const cols = Math.max(sides.top, sides.bottom) + 2;
  const rows = Math.max(sides.left, sides.right) + 2;
  const cells = [];
  const put = (i, r, c) => cells.push(
    `<i style="grid-row:${r};grid-column:${c};background:${colors[i]}"></i>`);

  let i = 0;
  put(i++, 1, 1);
  for (let k = 0; k < sides.top; k++) put(i++, 1, k + 2);
  put(i++, 1, cols);
  for (let k = 0; k < sides.right; k++) put(i++, k + 2, cols);
  put(i++, rows, cols);
  for (let k = 0; k < sides.bottom; k++) put(i++, rows, cols - 1 - k);
  put(i++, rows, 1);
  for (let k = 0; k < sides.left; k++) put(i++, rows - 1 - k, 1);

  return `<span class="mini-board" style="grid-template-columns:repeat(${cols},1fr);
    grid-template-rows:repeat(${rows},1fr)">${cells.join('')}</span>`;
}

// The house boards each get a drawing of what they are. Every other board is a
// country, and a country used to fly its flag emoji here — the one glyph Windows
// refuses to draw at all. They fly the board's own pennant instead, tinted with
// the colour of their first street so no two nations look alike.
const MAP_ART = {
  classic: 'globe', worldwide: 'plane', deathvalley: 'skull',
  blitz: 'bolt', luckywheel: 'sparkle', random: 'dice',
};
// The house boards have a glyph of their own; a country board flies its flag.
const mapArt = (m) => (MAP_ART[m.id]
  ? icon(MAP_ART[m.id], 17)
  : groupFlag(m.icon, m.preview?.colors?.[1], 17));

export function openMapModal(state, actions) {
  fetch(api('/api/maps')).then((r) => r.json()).then((maps) => {
    const card = (m) => `<button class="map-card ${m.id === state.mapId ? 'sel' : ''}" data-map="${m.id}">
          ${miniBoard(m.preview)}
          <span class="mn">${mapArt(m)} ${escapeHtml(m.name)}</span>
          <span class="md">${escapeHtml(m.description)}</span>
          <span class="mstats">
            <b>${m.size}</b> tiles · <b>${m.streets}</b> streets · <b>${m.countries}</b> sets
          </span>
        </button>`;
    const house = maps.filter((m) => !m.country);
    const custom = maps.filter((m) => m.country);

    openModal(`
      <h2>Pick a board</h2>
      <p class="sub">Every map has its own cities, prices and layout.</p>
      <div class="map-grid">${house.map(card).join('')}</div>
      <h3 class="map-section">${icon('map')} Custom — pick your country</h3>
      <p class="sub">One nation per board, with its own regions and its own Treasure &amp; Surprise deck.</p>
      <div class="map-grid">${custom.map(card).join('')}</div>
      <div class="modal-actions"><button class="btn ghost" id="mClose">Close</button></div>`, (root) => {
      root.querySelectorAll('[data-map]').forEach((c) => {
        c.onclick = () => { sfx.click(); actions.settings({ mapId: c.dataset.map }); closeModal(); };
      });
      $('#mClose', root).onclick = closeModal;
    }, 'wide');
  });
}

const RULES_HELP = [
  ['dice', 'Rolling', 'Roll two dice and move. A double lets you roll again — but three doubles in a row sends you straight to prison.'],
  ['key', 'Buying', 'Land on an unowned street, airport or utility and you may buy it. Turn it down and it goes to auction, where everyone can bid.'],
  ['crane', 'Building', 'Own every street of one country and you can build houses, then a hotel. Rent climbs steeply with each one.'],
  ['payment', 'Rent', 'Land on someone else’s property and you pay their rent. Airports scale 25 / 50 / 100 / 200; utilities charge 4× or 10× your roll.'],
  ['bank', 'Mortgage', 'Short of cash? Mortgage a property for half its price. Mortgaged streets collect no rent until you buy them back at 10% interest.'],
  ['trade', 'Trading', 'Offer any mix of cash, properties and prison cards to any player, at any time. Streets with buildings can’t be traded.'],
  ['police', 'Prison', 'Roll a double to walk out, pay the $50 fine, or use a card. After three failed attempts you pay anyway.'],
  ['skull', 'Bankruptcy', 'Owe more than you can raise and you must sell, mortgage or trade. Give up and everything goes to your creditor. Last player standing wins.'],
];

export function openHelpModal() {
  openModal(`
    <h2>How to play</h2>
    <p class="sub">The classic property-trading rules, in one screen.</p>
    <div class="help-list">
      ${RULES_HELP.map(([glyph, title, body]) => `<div class="help-row">
        <span class="help-ico">${icon(glyph, 22, 'solo')}</span>
        <div><b>${title}</b><span>${body}</span></div>
      </div>`).join('')}
    </div>
    <p class="sub" style="margin-top:16px">
      <b>Shortcuts</b> · Space or Enter fires the main button · C jumps to chat · Esc closes a dialog.
      Hover any tile for its rent card, click it for the full deed.
    </p>
    <div class="modal-actions"><button class="btn primary" id="hClose">Got it</button></div>`, (root) => {
    $('#hClose', root).onclick = closeModal;
  });
}

export function openTradeModal(state, meId, targetId, actions, prefill = null) {
  const me = state.players.find((p) => p.id === meId);
  const them = state.players.find((p) => p.id === targetId);
  const listFor = (playerId) => Object.entries(state.ownership)
    .filter(([, o]) => o.owner === playerId)
    .map(([i, o]) => ({ i: Number(i), ...o }))
    .sort((a, b) => a.i - b.i);

  const side = (player, list, prefix) => `
    <div class="trade-side">
      <div class="trade-who"><span class="avatar sm" style="background:${player.color}">${escapeHtml((player.name[0] || '?').toUpperCase())}</span>
        ${escapeHtml(player.name)}</div>
      <div class="trade-list">
        ${list.length ? list.map((m) => {
          const t = state.map.tiles[m.i];
          const g = t.group ? state.groups[t.group] : null;
          const blocked = (m.houses || 0) > 0;
          return `<label class="check-row ${blocked ? 'blocked' : ''}" title="${blocked ? 'Sell the buildings first' : ''}">
            <input type="checkbox" data-side="${prefix}" value="${m.i}" ${blocked ? 'disabled' : ''} />
            <span class="dotc" style="background:${g?.color || '#7c6bb0'}"></span>
            <span class="cr-name">${escapeHtml(t.name)}${m.mortgaged ? ' <i>mortgaged</i>' : ''}${blocked ? ` ${icon('house', 12)}` : ''}</span>
            <span class="dim">$${t.price}</span>
          </label>`;
        }).join('') : '<div class="empty small">No properties</div>'}
      </div>
      <div class="cash-slider">
        <span class="cs-label">Cash</span>
        <div class="cs-track" style="--pct:0">
          <input type="range" min="0" max="${Math.max(0, player.money)}" step="1" value="0"
                 data-cash="${prefix}" ${player.money > 0 ? '' : 'disabled'}
                 aria-label="Cash from ${escapeHtml(player.name)}" />
          <b class="cs-bubble" data-cash-out="${prefix}">$0</b>
        </div>
        <span class="cs-max">max ${money(player.money)}</span>
      </div>
      ${player.getOutCards ? `<label class="field tight"><span>Prison cards · max ${player.getOutCards}</span>
        <input type="number" min="0" max="${player.getOutCards}" value="" placeholder="0" data-cards="${prefix}" /></label>` : ''}
    </div>`;

  openModal(`
    <h2>${prefill?.counterOf != null ? 'Negotiate' : 'Trade'} with ${escapeHtml(them.name)}</h2>
    <p class="sub">${prefill?.counterOf != null
      ? 'Their offer is on the table — nudge it your way and send it back.'
      : "Tick what each side puts on the table. Streets with buildings can't move."}</p>
    <div class="trade-grid">
      ${side(me, listFor(meId), 'give')}
      <div class="trade-arrow">⇄</div>
      ${side(them, listFor(targetId), 'get')}
    </div>
    <div class="trade-totals">
      <span>You give <b id="giveTotal">$0</b></span>
      <span id="tradeVerdict" class="dim"></span>
      <span>You get <b id="getTotal">$0</b></span>
    </div>
    <div class="trade-tools">
      <button class="btn small" type="button" id="tBalance">${icon('scales')} Balance it</button>
      <span class="dim small">Tops up the lighter side with cash, as far as that wallet goes.</span>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" id="tCancel">Cancel</button>
      <button class="btn primary" id="tSend">${prefill?.counterOf != null ? 'Send counter-offer' : 'Send offer'}</button>
    </div>`, (root) => {
    // The slider's max already stops it, but a clamp here means no hand-edited
    // range can put more cash on the table than that side actually holds.
    const cashOf = (prefix) => {
      const el = root.querySelector(`input[data-cash="${prefix}"]`);
      if (!el) return 0;
      const cap = Math.max(0, Number(el.max) || 0);
      return Math.min(cap, Math.max(0, Math.round(Number(el.value) || 0)));
    };
    // Prison cards are a typed number, and the server quietly clamps what it
    // gets — so the same clamp runs here, or the running total would promise
    // more than the offer actually carries.
    const cardsOf = (prefix) => {
      const el = root.querySelector(`input[data-cards="${prefix}"]`);
      if (!el) return 0;
      const cap = Math.max(0, Number(el.max) || 0);
      const value = Math.min(cap, Math.max(0, Math.floor(Number(el.value) || 0)));
      if (el.value !== '' && Number(el.value) !== value) el.value = String(value);
      return value;
    };
    const collect = (prefix) => ({
      tiles: [...root.querySelectorAll(`input[data-side="${prefix}"]:checked`)].map((i) => Number(i.value)),
      money: cashOf(prefix),
      cards: cardsOf(prefix),
    });

    /** Moves the value pill under the thumb and fills the track behind it. */
    const paintCash = (prefix) => {
      const el = root.querySelector(`input[data-cash="${prefix}"]`);
      if (!el) return;
      const cap = Math.max(0, Number(el.max) || 0);
      const value = cashOf(prefix);
      el.closest('.cs-track')?.style.setProperty('--pct', cap ? value / cap : 0);
      const out = root.querySelector(`[data-cash-out="${prefix}"]`);
      if (out) out.textContent = money(value);
    };
    // Face value only — it ignores how badly you need that last street.
    const worth = (side) => side.money + side.cards * 50
      + side.tiles.reduce((sum, i) => sum + state.map.tiles[i].price, 0);

    const refresh = () => {
      paintCash('give');
      paintCash('get');
      const give = worth(collect('give'));
      const get = worth(collect('get'));
      $('#giveTotal', root).textContent = money(give);
      $('#getTotal', root).textContent = money(get);
      const v = $('#tradeVerdict', root);
      const diff = get - give;
      v.textContent = !give && !get ? '' : Math.abs(diff) < 25 ? 'even trade'
        : diff > 0 ? `+${money(diff)} your way` : `${money(-diff)} in their favour`;
      v.className = !give && !get ? 'dim' : Math.abs(diff) < 25 ? 'dim' : diff > 0 ? 'good-text' : 'bad-text';
    };
    /**
     * Put cash on whichever side is offering less, until the verdict reads
     * even. The payer can only stake what they actually hold, so a gap their
     * wallet can't close stays visible in the verdict instead of being papered
     * over — a deal that reads "even" has to be one.
     */
    const balance = () => {
      const goods = (side) => side.cards * 50
        + side.tiles.reduce((sum, i) => sum + state.map.tiles[i].price, 0);
      const gap = goods(collect('get')) - goods(collect('give'));
      const light = gap > 0 ? 'give' : 'get';   // getting more means you top up
      const heavy = gap > 0 ? 'get' : 'give';

      const heavyEl = root.querySelector(`input[data-cash="${heavy}"]`);
      if (heavyEl) heavyEl.value = 0;
      const lightEl = root.querySelector(`input[data-cash="${light}"]`);
      const owed = Math.abs(gap);
      const paid = lightEl ? Math.min(owed, Math.max(0, Number(lightEl.max) || 0)) : 0;
      if (lightEl) lightEl.value = paid;
      refresh();

      const payer = light === 'give' ? me : them;
      if (owed - paid > 0) {
        toast(`${payer.name} is ${money(owed - paid)} short — that is as even as this deal gets`);
      }
    };

    // While the composer is open on their offer, they can see you're reading
    // it. Hung on closeModal() so every exit takes it back — Escape and the
    // backdrop used to leave the other side reading "is viewing…" for good.
    // By then the offer may be gone (answered, or replaced by this counter),
    // and telling the server about a trade it has dropped only earns a
    // "Trade not found" — so the live roster decides whether to bother.
    if (prefill?.counterOf != null) {
      const offerId = prefill.counterOf;
      actions.tradeViewing?.(offerId, true);
      onModalClose(() => {
        if (livePlayersState?.trades?.some((t) => t.id === offerId)) {
          actions.tradeViewing?.(offerId, false);
        }
      });
    }

    // Negotiating: seed the form with their offer flipped to this side.
    if (prefill) {
      const seed = (prefix, side) => {
        (side.tiles || []).forEach((i) => {
          const box = root.querySelector(`input[data-side="${prefix}"][value="${i}"]`);
          if (box && !box.disabled) box.checked = true;
        });
        // Their old offer can name more cash than this side holds today, and
        // the slider must never seed above its own maximum.
        const cash = root.querySelector(`input[data-cash="${prefix}"]`);
        if (cash && side.money) cash.value = Math.min(side.money, Number(cash.max) || 0);
        const cards = root.querySelector(`input[data-cards="${prefix}"]`);
        if (cards && side.cards) cards.value = side.cards;
      };
      seed('give', prefill.give || {});
      seed('get', prefill.get || {});
    }
    root.querySelectorAll('input').forEach((i) => { i.oninput = refresh; i.onchange = refresh; });
    refresh();

    $('#tBalance', root).onclick = () => { sfx.click(); balance(); };
    $('#tCancel', root).onclick = closeModal;
    $('#tSend', root).onclick = () => {
      sfx.trade();
      // A counter-offer replaces the one it answers (declining it also clears
      // the viewer flag server-side, so no separate viewing=false needed —
      // and sending one for an offer the server has just dropped would only
      // come back as an error).
      if (prefill?.counterOf != null) {
        onModalClose(null);
        actions.respondTrade(prefill.counterOf, false);
      }
      actions.proposeTrade({ to: targetId, give: collect('give'), get: collect('get') });
      closeModal();
    };
  }, 'wide');
}

// ─────────────────────────────────────────────────────────── report card ──
// Which drawing each title wears. The words come from the server; a title
// this table has never heard of still gets a sparkle rather than a blank.
const TITLE_ART = {
  'Heavy Hitter': 'bolt',
  'Dealmaker': 'trade',
  'Master Builder': 'crane',
  'Front Runner': 'crown',
  'Landlord': 'house',
  'Auction Hawk': 'gavel',
  'Land Grabber': 'map',
  'Hot Dice': 'dice',
  'Globetrotter': 'globe',
  'Jailbird': 'police',
  'Star Tenant': 'payment',
};

// One column per counter; a cell shows whatever the book recorded, or a
// quiet zero — the server omits stats a player never touched.
const STAT_COLS = [
  ['Laps', (s) => s.laps || 0],
  ['Doubles', (s) => s.doubles || 0],
  ['Streets', (s) => s.streetsBought || 0],
  ['Houses', (s) => s.housesBuilt || 0],
  ['Auctions', (s) => s.auctionsWon || 0],
  ['Trades', (s) => s.tradesCompleted || 0],
  ['Rent in', (s) => money(s.rentCollected)],
  ['Rent out', (s) => money(s.rentPaid)],
  ['Biggest rent', (s) => (s.biggestRent
    ? `${money(s.biggestRent)}${s.biggestRentTile ? `<i>${escapeHtml(s.biggestRentTile)}</i>` : ''}`
    : '—')],
  ['Jailed', (s) => s.jailed || 0],
  ['Lead %', (s) => `${s.leadShare || 0}%`],
];

function statsTableHTML(state, rank) {
  if (!state.stats) return ''; // an older server kept no diary
  const rows = rank.map((p) => {
    const s = state.stats[p.id] || {};
    return `<tr${p.bankrupt ? ' class="out"' : ''}>
      <th scope="row"><i class="dotc" style="background:${p.color}"></i>${escapeHtml(p.name)}</th>
      ${STAT_COLS.map(([, cell]) => `<td>${cell(s)}</td>`).join('')}
    </tr>`;
  }).join('');
  return `<p class="sub">The numbers</p>
    <div class="stats-scroll"><table class="stats-table">
      <thead><tr><th></th>${STAT_COLS.map(([label]) => `<th>${label}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

/**
 * Standings, titles and the numbers, as one block of markup. The live result
 * sheet and a record replayed off the landing shelf both draw this — which is
 * why it reads everything defensively: a saved game is only as complete as
 * the server that ended it.
 */
export function reportCardHTML(state, meId) {
  const rank = [...(state.players || [])].sort((a, b) =>
    Number(a.bankrupt) - Number(b.bankrupt) || b.netWorth - a.netWorth);
  const medals = ['medalGold', 'medalSilver', 'medalBronze'];
  const rows = rank.map((p, k) => {
    const t = state.titles?.[p.id];
    return `<div class="rank-row ${p.id === meId ? 'me' : ''}">
      <span class="rank-pos">${medals[k] ? icon(medals[k]) : k + 1}</span>
      <span class="avatar sm" style="background:${p.color}">${escapeHtml((p.name[0] || '?').toUpperCase())}</span>
      <span class="rank-main">
        <span class="rank-name">${escapeHtml(p.name)}</span>
        ${t ? `<span class="rank-title">${icon(TITLE_ART[t.title] || 'sparkle', 14)}<b>${escapeHtml(t.title)}</b><i>${escapeHtml(t.reason || '')}</i></span>` : ''}
      </span>
      <span class="rank-worth">${p.bankrupt ? '<span class="dim">bankrupt</span>' : money(p.netWorth)}</span>
    </div>`;
  }).join('');
  return `<p class="sub">Final standings</p>${rows}${statsTableHTML(state, rank)}`;
}

/** A finished game pulled back off the landing shelf — same card, later date. */
export function openReportCard(record) {
  const s = record?.state || {};
  const when = new Date(record?.at || Date.now())
    .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  openModal(`
    <h2>${escapeHtml(record?.map || s.map?.name || 'A finished game')}</h2>
    <p class="sub">${escapeHtml(when)}${record?.winner ? ` · ${escapeHtml(record.winner)} won` : ''}</p>
    ${reportCardHTML(s, null)}
    <div class="modal-actions"><button class="btn ghost" id="rcClose">Close</button></div>`,
  (root) => { $('#rcClose', root).onclick = closeModal; });
}

/** richup-style stepped net-worth chart, drawn straight into SVG. */
function worthChartSVG(state) {
  const history = state.history || [];
  if (history.length < 3 || !state.players.length) return '';

  const W = 460, H = 210, padL = 44, padR = 12, padT = 16, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxT = Math.max(1, history[history.length - 1].t);
  const maxW = Math.max(100, ...history.flatMap((pt) => Object.values(pt.w)));
  const x = (t) => padL + (t / maxT) * innerW;
  const y = (w) => padT + innerH - (w / maxW) * innerH;

  // grid + labels
  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const v = Math.round((maxW / 4) * k);
    const yy = y(v);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" class="gc-grid"/>
      <text x="${padL - 6}" y="${yy + 3}" class="gc-label" text-anchor="end">$${v >= 1000 ? Math.round(v / 100) / 10 + 'k' : v}</text>`;
  }
  grid += `<text x="${W - padR}" y="${H - 8}" class="gc-label" text-anchor="end">turn ${maxT}</text>`;

  // one stepped line per player
  const lines = state.players.map((p) => {
    let d = '';
    history.forEach((pt, k) => {
      const px = x(pt.t), py = y(pt.w[p.id] ?? 0);
      d += k === 0 ? `M${px.toFixed(1)} ${py.toFixed(1)}` : `H${px.toFixed(1)}V${py.toFixed(1)}`;
    });
    const isWinner = p.id === state.winner?.id;
    return `<path d="${d}" fill="none" stroke="${p.color}" stroke-width="${isWinner ? 2.6 : 1.8}"
      stroke-linejoin="round" opacity="${isWinner ? 1 : 0.75}"/>`;
  }).join('');

  // where the winner grabbed the lead for good
  let flipMark = '';
  if (state.winner) {
    let flip = null;
    for (const pt of history) {
      const mine = pt.w[state.winner.id] ?? 0;
      const best = Math.max(...Object.values(pt.w));
      if (mine >= best) { if (flip === null) flip = pt.t; } else flip = null;
    }
    if (flip !== null && flip !== history[0].t) {
      flipMark = `<line x1="${x(flip)}" y1="${padT}" x2="${x(flip)}" y2="${padT + innerH}" class="gc-flip"/>
        <text x="${Math.min(x(flip) + 4, W - 90)}" y="${padT + 9}" class="gc-flip-label">game turned</text>`;
    }
  }

  const legend = state.players.map((p) => `<span class="gc-key">
      <i style="background:${p.color}"></i>${escapeHtml(p.name)}${p.id === state.winner?.id ? icon('crown', 12) : ''}</span>`).join('');

  return `<div class="go-chart">
      <p class="sub">Net worth over time</p>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${lines}${flipMark}</svg>
      <div class="gc-legend">${legend}</div>
    </div>`;
}

export function showGameOver(state, meId, actions) {
  openModal(`
    <div class="go-crown">${icon('trophy')}</div>
    <h2 class="go-title" style="color:${state.winner?.color || '#fff'}">${escapeHtml(state.winner?.name || 'Nobody')} wins!</h2>
    ${worthChartSVG(state)}
    ${reportCardHTML(state, meId)}
    <div class="modal-actions go-actions">
      ${state.hostId === meId
        ? `<button class="btn primary big wrap" id="gAgain">${icon('replay')} Play again with the same players</button>`
        : '<div class="dim small go-wait">Sit tight — the host can deal the same table again.</div>'}
      <div class="row-2">
        <button class="btn ghost" id="gHome">${icon('door')} Back to home</button>
        <button class="btn ghost" id="gClose">Stay on this board</button>
      </div>
    </div>
    ${tableTalkHTML()}`, (root) => {
    $('#gClose', root).onclick = closeModal;
    $('#gHome', root).onclick = () => { sfx.click(); closeModal(); actions.goHome?.(); };
    const again = $('#gAgain', root);
    if (again) again.onclick = () => { closeModal(); actions.rematch(); };
  });
}

// ──────────────────────────────────────────────────────────── card popup ──
let cardTimer = null;
const CARD_ART = { treasure: 'toolbox', surprise: 'question', rule: 'scales' };

/**
 * The deck cards, and anything else that deserves the same treatment: a card
 * carrying its own `title` names itself, and `hold` buys reading time for the
 * ones that are a rule rather than a payout.
 */
export function showCard(card, { hold = 3400 } = {}) {
  const el = $('#cardPopup');
  el.className = `card-popup ${card.deck}`;
  const kind = card.title || (card.deck === 'treasure' ? 'Treasure' : 'Surprise');
  el.innerHTML = `
    <div class="cp-ico">${icon(CARD_ART[card.deck] || 'question')}</div>
    <div class="cp-kind">${escapeHtml(kind)}</div>
    <div class="cp-text">${escapeHtml(card.text)}</div>
    <div class="cp-hint">tap to dismiss</div>`;
  // It lands square on the action dock, so a player who has already read it
  // can put it away instead of waiting out the timer to reach Roll or End.
  el.onclick = () => { clearTimeout(cardTimer); el.classList.add('hidden'); };
  sfx.card();
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => el.classList.add('hidden'), hold);
}

// ────────────────────────────────────────────────────────────── confetti ──
export function confetti(duration = 2600) {
  const canvas = $('#confetti');
  canvas.classList.remove('hidden');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);

  const colors = ['#8b5cf6', '#22d3ee', '#4ade80', '#fbbf24', '#f472b6', '#fb7185'];
  const bits = Array.from({ length: 160 }, () => ({
    x: Math.random() * innerWidth,
    y: -20 - Math.random() * innerHeight * 0.6,
    w: 6 + Math.random() * 7,
    h: 9 + Math.random() * 9,
    vy: 2 + Math.random() * 3.5,
    vx: -1.4 + Math.random() * 2.8,
    rot: Math.random() * Math.PI,
    vr: -0.14 + Math.random() * 0.28,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));

  const t0 = performance.now();
  const frame = (now) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    bits.forEach((b) => {
      b.x += b.vx; b.y += b.vy; b.rot += b.vr;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.fillStyle = b.c;
      ctx.globalAlpha = Math.max(0, 1 - (now - t0) / duration);
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    });
    if (now - t0 < duration) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, innerWidth, innerHeight); canvas.classList.add('hidden'); }
  };
  requestAnimationFrame(frame);
}
