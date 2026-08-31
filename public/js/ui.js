// Everything that isn't the board: player cards, settings, action bar, modals,
// chat, toasts and the celebratory bits.

import { escapeHtml, deedMarkup } from './board.js';
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
  el.innerHTML = `<span>${type === 'error' ? '⚠️' : 'ℹ️'}</span>
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
const LOG_ICON = {
  dice: '🎲', money: '💵', rent: '🏠', buy: '🛒', turn: '▶', jail: '🚔',
  bankrupt: '💀', auction: '🔨', trade: '🤝', treasure: '🧰', surprise: '❓',
  system: '✨', build: '🏗️', mortgage: '🏦', join: '👋', leave: '🚪',
  warn: '⚠️', info: '·',
};

export function renderLog(state, el) {
  const sig = `${state.log.length}:${state.log[state.log.length - 1]?.at || 0}`;
  if (el.dataset.sig === sig) return;
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60 || !el.dataset.sig;
  el.dataset.sig = sig;
  el.innerHTML = state.log.map((l) => `<div class="log-line ${l.kind}">
      <span class="log-ico">${LOG_ICON[l.kind] || '·'}</span><span>${escapeHtml(l.text)}</span>
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
  el.dataset.sig = sig;
  if (!msgs.length) {
    el.innerHTML = channel === 'team'
      ? '<div class="empty">Only your team reads this. Plan away 🛡️</div>'
      : '<div class="empty">Say hi 👋</div>';
    return;
  }
  el.innerHTML = msgs.map((m) => {
    const teamColor = m.channel === 'team' ? state.teamInfo?.[m.team]?.color : null;
    return `<div class="chat-msg">
      ${m.flag ? `<span class="chat-flag">${escapeHtml(m.flag)}</span>` : ''}<b style="color:${m.color}">${escapeHtml(m.name)}</b>${teamColor ? ` <span class="chat-team-badge" style="color:${teamColor}">TEAM</span>` : ''} ${escapeHtml(m.text)}
    </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

// ───────────────────────────────────────────────────────────── player list ──
const prevMoney = new Map();

// The action buttons are wired once (dataset.v caching) but must act on the
// CURRENT game, not the render that created them — a trade opened two turns
// later would otherwise show a frozen snapshot.
let livePlayersState = null;

export function renderPlayers(state, meId, el, actions) {
  livePlayersState = state;
  const emptySeats = state.status === 'lobby'
    ? Math.max(0, state.settings.maxPlayers - state.players.length) : 0;
  const structure = state.players.map((p) => `${p.id}:${p.bankrupt ? 1 : 0}:${p.color}:${p.avatar || ''}`).join('|')
    + `:${state.status}:${state.hostId}:${emptySeats}`;

  if (el.dataset.structure !== structure) {
    el.dataset.structure = structure;
    el.innerHTML = state.players.map((p) => `
      <div class="player-card ${p.bankrupt ? 'dead' : ''} ${p.id === meId ? 'me' : ''}" data-pid="${p.id}">
        <div class="pc-glow"></div>
        <div class="avatar ${p.avatar ? 'has-skin' : ''}" style="background:${p.color}">
          ${escapeHtml(p.avatar || (p.name[0] || '?').toUpperCase())}
          <span class="avatar-ring"></span>
          <span class="avatar-flag"></span>
        </div>
        <div class="pinfo">
          <div class="pname">${escapeHtml(p.name)}<span class="tags"></span></div>
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
        ${state.hostId === meId ? '<button class="btn tiny" data-addbot>Add bot</button>' : ''}
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
    if (p.timedOut) tags.push(`<i class="tag off">${p.removedFor === 'quit' ? 'LEFT' : 'TIMED OUT'}</i>`);
    else if (!p.isBot && p.botControlled) tags.push('<i class="tag off">BOT PLAYING</i>');
    else if (!p.connected && !p.isBot) tags.push('<i class="tag off">AWAY</i>');
    if (p.jail) tags.push('<i class="tag jail">JAIL</i>');
    if (p.skipTurns > 0) tags.push('<i class="tag vac">VACATION</i>');
    if (p.getOutCards > 0) tags.push(`<i class="tag card">🎟️${p.getOutCards > 1 ? p.getOutCards : ''}</i>`);
    const tagEl = card.querySelector('.tags');
    const tagHtml = tags.join('');
    if (tagEl.dataset.v !== tagHtml) { tagEl.dataset.v = tagHtml; tagEl.innerHTML = tagHtml; }

    // money + delta bubble
    const moneyEl = card.querySelector('.pmoney');
    const shown = p.timedOut ? '<span class="dim">out of the game</span>'
      : p.bankrupt ? '<span class="dim">bankrupt</span>' : money(p.money);
    if (moneyEl.dataset.v !== shown) {
      const before = prevMoney.get(p.id);
      moneyEl.dataset.v = shown;
      moneyEl.innerHTML = shown;
      if (before != null && before !== p.money && !p.bankrupt) {
        spawnDelta(card, p.money - before);
        moneyEl.classList.remove('bump');
        void moneyEl.offsetWidth;
        moneyEl.classList.add('bump');
      }
    }
    prevMoney.set(p.id, p.money);

    // owned set chips
    const chips = card.querySelector('.chips');
    if (state.status === 'playing') {
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
        + (rails ? `<i class="chip plain" title="Airports">✈️${rails}</i>` : '')
        + (utils ? `<i class="chip plain" title="Utilities">💡${utils}</i>` : '');
      const final = html || '<span class="dim">no property yet</span>';
      if (chips.dataset.v !== final) { chips.dataset.v = final; chips.innerHTML = final; }
    } else if (chips.dataset.v !== 'lobby') {
      chips.dataset.v = 'lobby';
      chips.innerHTML = '<span class="dim">ready</span>';
    }

    // buttons
    const acts = card.querySelector('.player-actions');
    const me = state.players.find((x) => x.id === meId);
    const canTrade = state.status === 'playing' && p.id !== meId && !p.bankrupt && !me?.bankrupt;
    const canKick = state.hostId === meId && state.status === 'lobby' && p.id !== meId;
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
  { key: 'x2rent', icon: '💰', name: 'x2 rent on full sets', desc: 'Owning a whole country doubles its base rent' },
  { key: 'vacationCash', icon: '🏝️', name: 'Vacation cash', desc: 'Taxes and fines pile up and go to whoever lands on Vacation' },
  { key: 'auction', icon: '🔨', name: 'Auction', desc: 'Skipped properties are sold to the highest bidder' },
  { key: 'noRentInPrison', icon: '🚔', name: 'No rent while jailed', desc: 'Owners in prison collect nothing' },
  { key: 'mortgage', icon: '🏦', name: 'Mortgage', desc: 'Raise 50% of a property’s cost, but collect no rent on it' },
  { key: 'evenBuild', icon: '🏘️', name: 'Even build', desc: 'Houses must go up and down evenly across a set' },
  { key: 'randomizeOrder', icon: '🔀', name: 'Randomize order', desc: 'Shuffle the turn order when the game starts' },
];

export function renderRightPanel(state, meId, el, actions) {
  const me = state.players.find((p) => p.id === meId);
  const sig = state.status === 'lobby'
    ? `lobby:${state.hostId}:${meId}:${me?.color}:${JSON.stringify(state.settings)}:${state.map.id}:${state.players.length}`
    : `game:${JSON.stringify(state.ownership)}:${meId}:${state.vacationPot}:${state.trades.map((t) => t.id).join()}:${state.status}:${state.settings.mortgage}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  if (state.status === 'lobby') renderSettings(state, meId, el, actions);
  else renderMyStuff(state, meId, el, actions);
}

function renderSettings(state, meId, el, actions) {
  const isHost = state.hostId === meId;
  const dis = isHost ? '' : 'disabled';
  const me = state.players.find((p) => p.id === meId);
  const COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185', '#22d3ee', '#f97316'];

  const toggle = (d) => `<div class="setting">
      <span class="s-icon">${d.icon}</span>
      <div class="s-body"><div class="s-name">${d.name}</div><div class="s-desc">${d.desc}</div></div>
      <label class="switch">
        <input type="checkbox" data-set="${d.key}" ${state.settings[d.key] ? 'checked' : ''} ${dis} />
        <span class="track"></span><span class="thumb"></span>
      </label>
    </div>`;

  el.innerHTML = `
    <div class="panel">
      <div class="panel-title">Your look</div>
      <input id="nameField" class="name-field" value="${escapeHtml(me?.name || '')}" maxlength="16" placeholder="Nickname" />
      <div class="swatches">
        ${COLORS.map((c) => {
          const taken = state.players.some((p) => p.color === c && p.id !== meId);
          return `<button class="swatch ${me?.color === c ? 'sel' : ''}" data-color="${c}"
            ${taken ? 'disabled' : ''} style="--c:${c}"></button>`;
        }).join('')}
      </div>
      <div class="flag-picker">
        ${FLAGS.map((f) => `<button class="flag-opt ${me?.flag === f ? 'sel' : ''}" data-flag="${f}">${f}</button>`).join('')}
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Game settings</div>
      <div class="setting">
        <span class="s-icon">👥</span>
        <div class="s-body"><div class="s-name">Maximum players</div><div class="s-desc">Seats available in this room</div></div>
        <select data-set="maxPlayers" ${dis}>
          ${[2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}" ${state.settings.maxPlayers === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
      <div class="setting">
        <span class="s-icon">🔑</span>
        <div class="s-body"><div class="s-name">Private room</div><div class="s-desc">Only people with the link can join</div></div>
        <label class="switch"><input type="checkbox" data-set="isPrivate" ${state.settings.isPrivate ? 'checked' : ''} ${dis} />
          <span class="track"></span><span class="thumb"></span></label>
      </div>
      <div class="setting">
        <span class="s-icon">🤖</span>
        <div class="s-body"><div class="s-name">Allow bots</div><div class="s-desc">Bots fill the empty seats on start</div></div>
        <label class="switch"><input type="checkbox" data-set="allowBots" ${state.settings.allowBots ? 'checked' : ''} ${dis} />
          <span class="track"></span><span class="thumb"></span></label>
      </div>
      <div class="setting">
        <span class="s-icon">🤝</span>
        <div class="s-body"><div class="s-name">Teams</div>
          <div class="s-desc">Teammates never charge each other rent and win together</div></div>
        <select data-set="teams" ${dis}>
          ${[0, 2, 3, 4].map((n) => `<option value="${n}" ${state.settings.teams === n ? 'selected' : ''}>${n === 0 ? 'Off' : `${n} teams`}</option>`).join('')}
        </select>
      </div>
      ${state.settings.teams > 0 && isHost ? '<button class="btn small wide" id="balanceBtn">⇄ Balance teams</button>' : ''}
      <div class="setting">
        <span class="s-icon">🗺️</span>
        <div class="s-body"><div class="s-name">Board map</div><div class="s-desc">${escapeHtml(state.map.name)} · ${state.map.size} tiles</div></div>
        <button class="btn small" id="mapBtn" ${dis}>Change ›</button>
      </div>
      <div class="setting">
        <span class="s-icon">💵</span>
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
        <button class="btn primary big" id="startBtn">▶ Start Game</button>
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
  const mapBtn = $('#mapBtn', el);
  if (mapBtn) mapBtn.onclick = () => { sfx.click(); openMapModal(state, actions); };
  const balanceBtn = $('#balanceBtn', el);
  if (balanceBtn) balanceBtn.onclick = () => { sfx.click(); actions.balanceTeams(); };
  const startBtn = $('#startBtn', el);
  if (startBtn) startBtn.onclick = () => actions.start();
  const botBtn = $('#botBtn', el);
  if (botBtn) botBtn.onclick = () => { sfx.click(); actions.addBot(); };
}

function renderMyStuff(state, meId, el, actions) {
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
    const title = g ? `${g.flag} ${g.name}` : (key === '__air' ? '✈️ Airports' : '💡 Utilities');
    const complete = g && list.length === state.map.groups[key].length;
    const rows = list.sort((a, b) => a.i - b.i).map((m) => {
      const t = state.map.tiles[m.i];
      const color = g?.color || '#7c6bb0';
      const buildings = m.houses === 5 ? '<span class="hotel">🏨</span>' : '🏠'.repeat(m.houses || 0);
      return `<div class="prop-row ${m.mortgaged ? 'mortgaged' : ''}" data-open="${m.i}">
        <span class="prop-swatch" style="background:${color}"></span>
        <span class="prop-name">${escapeHtml(t.name)}</span>
        <span class="prop-houses">${buildings}</span>
        <span class="prop-actions">
          ${canBuildOn(state, meId, m.i) ? `<button class="btn tiny" data-build="${m.i}" title="Build for $${t.houseCost}">＋</button>` : ''}
          ${canSellOn(state, meId, m.i) ? `<button class="btn tiny" data-sell="${m.i}" title="Sell a building for $${Math.floor(t.houseCost / 2)}">−</button>` : ''}
          ${m.mortgaged
            ? (state.settings.mortgage ? `<button class="btn tiny gold" data-unmort="${m.i}" title="Buy back for $${Math.ceil((t.price / 2) * 1.1)}">↺</button>` : '')
            : (canMortgage(state, meId, m.i) ? `<button class="btn tiny" data-mort="${m.i}" title="Mortgage for $${Math.floor(t.price / 2)}">🏦</button>` : '')}
        </span>
      </div>`;
    }).join('');
    return `<div class="group-head ${complete ? 'complete' : ''}">${title}${complete ? '<i>FULL SET</i>' : ''}</div>${rows}`;
  }).join('');

  const incoming = state.trades.filter((t) => t.to === meId);
  const outgoing = state.trades.filter((t) => t.from === meId);

  el.innerHTML = `
    ${incoming.map((t) => tradeCard(state, t, meId)).join('')}
    ${outgoing.map((t) => `<div class="panel">
      <div class="panel-title">Offer sent</div>
      <div class="dim small">${t.ignored
        ? `💤 ${escapeHtml(state.players.find((p) => p.id === t.to)?.name || '')} set it aside for later`
        : `Waiting for ${escapeHtml(state.players.find((p) => p.id === t.to)?.name || '')}…`}</div>
      ${tradeViewerLine(state, t, meId)}
      <button class="btn small wide" style="margin-top:8px" data-cancel="${t.id}">Cancel offer</button>
    </div>`).join('')}

    <div class="panel">
      <div class="panel-title">Your properties</div>
      ${mine.length ? sections : '<div class="empty">Nothing owned yet — land on a street and buy it.</div>'}
    </div>

    ${state.settings.vacationCash ? `<div class="panel pot">
      <div class="panel-title">Vacation pot</div>
      <div class="pot-amount">${money(state.vacationPot)}</div>
    </div>` : ''}

    ${state.status === 'ended' && state.hostId === meId ? '<button class="btn primary wide" id="rematchBtn">🔁 Play again</button>' : ''}
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

/** "👀 Ravi is viewing…" — everyone on the offer except yourself. */
function tradeViewerLine(state, t, meId) {
  const names = (t.viewers || []).filter((v) => v !== meId)
    .map((v) => state.players.find((p) => p.id === v)?.name)
    .filter(Boolean);
  if (!names.length) return '';
  return `<div class="trade-viewing">👀 ${names.map(escapeHtml).join(', ')} ${names.length > 1 ? 'are' : 'is'} viewing…</div>`;
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
      <div class="trade-line"><span>🤝 From ${escapeHtml(from?.name || '')}</span><b class="dim">💤 set aside</b></div>
      <button class="btn small wide" data-unignore="${t.id}">Review offer</button>
    </div>`;
  }

  return `<div class="panel trade-offer">
    <div class="panel-title">🤝 Offer from ${escapeHtml(from?.name || '')}</div>
    <div class="trade-line good"><span>You get</span><b>${describe(t.give)}</b></div>
    <div class="trade-line bad"><span>You give</span><b>${describe(t.get)}</b></div>
    ${tradeViewerLine(state, t, meId)}
    <div class="row-2">
      <button class="btn good small" data-accept="${t.id}">Accept</button>
      <button class="btn bad small" data-decline="${t.id}">Decline</button>
    </div>
    <div class="row-2" style="margin-top:6px">
      <button class="btn small" data-negotiate="${t.id}">🤝 Negotiate</button>
      <button class="btn ghost small" data-ignore="${t.id}" title="Keep it in the list, decide later">💤 Later</button>
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

  const on = (id, fn, sound) => {
    const b = $(id);
    if (b) b.onclick = () => { (sound || sfx.click)(); fn(); };
  };

  // lobby ────────────────────────────────────────────────────────────────
  if (state.status === 'lobby') {
    const seated = state.players.length;
    const seats = state.settings.maxPlayers;
    actionEl.innerHTML = state.hostId === meId
      ? `<button class="btn primary big" id="cStart">▶ Start Game</button>`
      : '<div class="waiting"><span class="pulse-dot"></span> Waiting for the host…</div>';
    statusEl.innerHTML = `
      <div class="lobby-head">
        <div class="room-code">Room <b>${escapeHtml(state.id)}</b></div>
        <div class="lobby-map">${state.map.icon} ${escapeHtml(state.map.name)} · ${state.map.size} tiles${state.settings.teams > 0 ? ` · ${state.settings.teams} teams` : ''}</div>
      </div>
      <div class="seat-dots">${Array.from({ length: seats }, (_, i) => {
        const p = state.players[i];
        return p
          ? `<span class="seat-dot filled" style="background:${p.color}" title="${escapeHtml(p.name)}"></span>`
          : '<span class="seat-dot"></span>';
      }).join('')}</div>
      <div class="dim small">${seated} of ${seats} seats taken</div>`;
    on('#cStart', actions.start);
    return;
  }

  // game over ────────────────────────────────────────────────────────────
  if (state.status === 'ended') {
    actionEl.innerHTML = '';
    statusEl.innerHTML = state.winner
      ? `<div class="win-line" style="color:${state.winner.color}">🏆 ${escapeHtml(state.winner.name)} wins!</div>`
      : '<div class="win-line">Game over</div>';
    return;
  }

  // auction ──────────────────────────────────────────────────────────────
  if (state.auction) {
    const a = state.auction;
    const tile = state.map.tiles[a.tile];
    const leader = state.players.find((p) => p.id === a.leader);
    const inRace = a.inRace.includes(meId);
    const min = a.bid === 0 ? 10 : a.bid + 10;
    cardEl.innerHTML = deedMarkup(state, a.tile, { compact: true }) || '';
    actionEl.innerHTML = `
      <div class="auction-box">
        <div class="auction-label">🔨 Auction</div>
        <div class="auction-bid">${money(a.bid)}</div>
        <div class="dim small">${leader ? `leading: <b style="color:${leader.color}">${escapeHtml(leader.name)}</b>` : 'no bids yet'}</div>
        <div class="auction-timer"><i id="auctionBar"></i></div>
        ${inRace ? `<div class="bid-row">
            ${[min, min + 40, min + 90].filter((v) => v <= (me?.money || 0)).map((v) => `<button class="btn small" data-bid="${v}">${money(v)}</button>`).join('')}
            <button class="btn small bad" id="passBid">Pass</button>
          </div>`
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
      <div class="dim small">Sell buildings, mortgage streets or trade to raise the cash.</div>`;
  } else if (t.phase === 'action' && t.pending?.type === 'buy') {
    const tile = state.map.tiles[t.pending.tile];
    cardEl.innerHTML = deedMarkup(state, t.pending.tile, { compact: true }) || '';
    html = `<button class="btn good big" id="cBuy" ${me.money < tile.price ? 'disabled' : ''}>Buy for ${money(tile.price)}</button>
            <button class="btn wide ghost" id="cSkip">${state.settings.auction ? '🔨 Send to auction' : 'Skip'}</button>`;
    status = me.money < tile.price ? '<div class="dim small">Not enough cash for this one.</div>' : '';
  } else if (t.phase === 'roll') {
    if (me.jail) {
      html = `<button class="btn primary big" id="cRoll">🎲 Roll for a double</button>
              <div class="row-2">
                <button class="btn ghost" id="cJailPay" ${me.money < 50 ? 'disabled' : ''}>Pay $50</button>
                ${me.getOutCards > 0 ? '<button class="btn gold" id="cJailCard">Use 🎟️ card</button>' : ''}
              </div>`;
      status = `<div class="dim small">In prison · attempt ${me.jailTurns + 1} of 3</div>`;
    } else {
      html = '<button class="btn primary big" id="cRoll">🎲 Roll dice</button>';
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

// ─────────────────────────────────────────────────────────── turn clock ──
// The deadline rides along with the state, but the seconds are counted here:
// a push can be minutes old after a sleeping tab, and a chip frozen on "42s"
// reads as a broken game.
const clock = { endsAt: null, playerId: null, mine: false };
let clockTimer = null;

const clockText = (secs) => (secs >= 60
  ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  : `${secs}s`);

export function syncTurnClock(state, meId) {
  const live = state.status === 'playing' && state.turn?.endsAt ? state.turn : null;
  clock.endsAt = live?.endsAt || null;
  clock.playerId = live?.playerId || null;
  clock.mine = !!live && live.playerId === meId;
  paintTurnClock();
  if (clock.endsAt && !clockTimer) clockTimer = setInterval(paintTurnClock, 250);
  else if (!clock.endsAt && clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}

function paintTurnClock() {
  const secs = clock.endsAt ? Math.max(0, Math.ceil((clock.endsAt - Date.now()) / 1000)) : null;
  const urgent = secs !== null && secs <= 10;

  document.querySelectorAll('.player-card').forEach((card) => {
    const el = card.querySelector('.turn-clock');
    if (!el) return;
    const on = secs !== null && card.dataset.pid === clock.playerId;
    el.classList.toggle('hidden', !on);
    if (!on) return;
    el.textContent = `⏱ ${clockText(secs)}`;
    el.classList.toggle('urgent', urgent);
  });

  const well = $('#centerClock');
  if (!well) return;
  well.classList.toggle('hidden', secs === null);
  if (secs === null) return;
  well.textContent = clock.mine ? `⏱ ${clockText(secs)} left on your turn` : `⏱ ${clockText(secs)}`;
  well.classList.toggle('urgent', urgent);
}

let auctionRaf = null;
function animateAuctionBar(a) {
  cancelAnimationFrame(auctionRaf);
  const step = () => {
    const bar = document.getElementById('auctionBar');
    if (!bar) return;
    const left = Math.max(0, a.endsAt - Date.now());
    bar.style.width = `${Math.min(100, (left / 20000) * 100)}%`;
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

/** The cosmetics shop: token skins for the board piece, avatars for the chip. */
export function openStoreModal(token) {
  Promise.all([
    fetch(api('/api/store')).then((r) => r.json()),
    fetch(api(`/api/wallet?token=${encodeURIComponent(token)}`)).then((r) => r.json()),
  ]).then(([storeData, wallet]) => {
    const items = storeData.items || [];
    const packs = storeData.packs || [];
    const section = (kind, title, sub) => `
      <h3 class="map-section">${title}</h3>
      <p class="sub">${sub}</p>
      <div class="store-grid">
        ${items.filter((i) => i.kind === kind).map((i) => {
          const owned = wallet.owned?.includes(i.id);
          const equipped = wallet.equipped?.[i.kind] === i.id;
          return `<button class="store-card ${equipped ? 'equipped' : owned ? 'owned' : ''}"
                    data-item="${i.id}" data-kind="${i.kind}" data-owned="${owned ? 1 : 0}">
            <span class="sc-emoji">${i.emoji}</span>
            <span class="sc-name">${escapeHtml(i.name)}</span>
            <span class="sc-price">${equipped ? '✓ Equipped' : owned ? 'Tap to equip' : `🪙 ${i.price}`}</span>
          </button>`;
        }).join('')}
      </div>`;

    // The web build has no payment processor behind it, so the packs are a
    // shop window: they say what a top-up costs and point at the iOS app.
    const packSection = packs.length ? `
      <h3 class="map-section">🪙 Coin packs</h3>
      <p class="sub">Coin packs are purchased in the iOS app.
        <a class="pack-link" href="/app.html" target="_blank" rel="noopener">Get MoneyMove for iPhone →</a></p>
      <div class="pack-grid">
        ${packs.map((p) => `<a class="pack-card" href="/app.html" target="_blank" rel="noopener">
          <span class="pk-emoji">${p.emoji}</span>
          ${p.bonus ? `<span class="pk-bonus">+${p.bonus}%</span>` : ''}
          <span class="pk-coins">🪙 ${p.coins}</span>
          <span class="pk-name">${escapeHtml(p.name)}</span>
          <span class="pk-price">$${escapeHtml(p.price)}</span>
        </a>`).join('')}
      </div>` : '';

    openModal(`
      <div class="store-head">
        <h2>Store</h2>
        <span class="coin-chip">🪙 ${wallet.coins ?? 0}</span>
      </div>
      <p class="sub">Win games to earn coins — 50 for a quick match, 100 when it goes long. Everything here is pure style.</p>
      ${packSection}
      ${section('token', '🎲 Token skins', 'Your piece on the board.')}
      ${section('avatar', '🙂 Avatars', 'Your face in the player chip.')}
      <div class="modal-actions"><button class="btn ghost" id="stClose">Close</button></div>`, (root) => {
      $('#stClose', root).onclick = closeModal;
      root.querySelectorAll('[data-item]').forEach((card) => {
        card.onclick = async () => {
          sfx.click();
          const id = card.dataset.item;
          const kind = card.dataset.kind;
          const owned = card.dataset.owned === '1';
          const equipped = card.classList.contains('equipped');
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
            openStoreModal(token);   // re-render with fresh wallet
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
    <h2>💬 ${escapeHtml(name)}</h2>
    <div id="dmList" class="dm-list"><div class="empty">Say hi 👋</div></div>
    <form id="dmForm" class="chat-form">
      <input id="dmInput" maxlength="300" placeholder="Message ${escapeHtml(name)}…" autocomplete="off" />
      <button class="icon-btn send" type="submit">➤</button>
    </form>`, (root) => {
    const list = $('#dmList', root);
    let lastSig = '';

    const paint = (messages, me) => {
      const sig = `${messages.length}:${messages[messages.length - 1]?.at || 0}`;
      if (sig === lastSig) return;
      lastSig = sig;
      list.innerHTML = messages.length
        ? messages.map((m) => `<div class="dm-msg ${m.from === me ? 'mine' : ''}">${escapeHtml(m.text)}</div>`).join('')
        : '<div class="empty">Say hi 👋</div>';
      list.scrollTop = list.scrollHeight;
    };

    const load = async () => {
      if (!document.body.contains(root)) { clearInterval(timer); return; }
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
      await fetch(api('/api/dm'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, code, text }),
      }).catch(() => toast('Message did not send', 'error'));
      load();
    });
  });
}

// The deed sheet outlives the state that opened it — building from it must
// leave the numbers fresh, so it registers a repainter the render loop calls.
let deedRepaint = null;

/** Redraws whatever open modal has to follow the live game. */
export function syncOpenModals(state) {
  deedRepaint?.(state);
}

export function closeModal() {
  const root = $('#modalRoot');
  deedRepaint = null;
  root.classList.add('hidden');
  root.innerHTML = '';
}

function openModal(html, onMount, extraClass = '') {
  const root = $('#modalRoot');
  deedRepaint = null; // a new sheet replaces whatever was repainting
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
      <button class="btn dice-btn" id="jnDice" type="button" title="Give me a name">🎲</button>
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
    <p class="sub">Game chal rahi hai — pick how you go.</p>
    <div class="leave-choices">
      <button class="leave-choice" id="lBack">
        <b>↩️ I'll come back</b>
        <span>A bot holds your seat and your properties. Continue from the home screen any time.</span>
      </button>
      <button class="leave-choice bad" id="lQuit">
        <b>🚪 Leave for good</b>
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
    <div class="removed-mark">⏳</div>
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
 * The tap-up / tap-down row under a deed you own. Sell sits left of the
 * building count and build sits right of it, so a whole street can be taken to
 * a hotel without the sheet closing between taps.
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

  const level = own.mortgaged ? '🏦 Mortgaged'
    : houses === 5 ? '🏨 Hotel'
    : houses ? '🏠'.repeat(houses)
    : 'No buildings yet';

  const next = !street ? 'Airports and utilities can only be mortgaged.'
    : own.mortgaged ? `Buy the mortgage back for $${liftCost} before building.`
    : houses === 5 ? 'Fully built — nothing more to add.'
    : !buildable ? (canSellOn(state, meId, i) ? `Sell a building back for $${sellBack}.` : 'You need the whole set, unmortgaged, to build.')
    : `Next ${houses === 4 ? 'hotel' : 'house'} costs $${houseCost}${!canAfford ? ' — short on cash' : ''}`;

  return `<div class="quick-build">
    <div class="qb-status">
      <span class="qb-level">${level}</span>
      <span class="qb-next">${escapeHtml(next)}</span>
    </div>
    <div class="qb-row">
      ${street ? `
        <button class="qb-btn" data-qb-sell title="Sell a building for $${sellBack}" ${sellable ? '' : 'disabled'}>−</button>
        <span class="qb-count">${houses === 5 ? '🏨' : houses}<small>${houses === 5 ? '' : '/5'}</small></span>
        <button class="qb-btn" data-qb-build title="Build for $${houseCost}" ${buildable && canAfford ? '' : 'disabled'}>＋</button>` : ''}
      ${own.mortgaged
        ? `<button class="qb-btn mort gold" data-qb-unmort title="Buy the mortgage back" ${canLift && cash >= liftCost ? '' : 'disabled'}>↺ Buy back $${liftCost}</button>`
        : `<button class="qb-btn mort" data-qb-mort title="Mortgage this deed" ${mortgageable ? '' : 'disabled'}>🏦 Mortgage $${mortValue}</button>`}
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
    const isMine = own?.owner === meId && !me?.bankrupt;
    sheet.innerHTML = `${deedMarkup(s, i)}
      ${isMine ? quickBuildBar(s, meId, i) : ''}
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

export function openMapModal(state, actions) {
  fetch(api('/api/maps')).then((r) => r.json()).then((maps) => {
    const card = (m) => `<button class="map-card ${m.id === state.mapId ? 'sel' : ''}" data-map="${m.id}">
          ${miniBoard(m.preview)}
          <span class="mn">${m.icon} ${escapeHtml(m.name)}</span>
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
      <h3 class="map-section">🗺️ Custom — pick your country</h3>
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
  ['🎲', 'Rolling', 'Roll two dice and move. A double lets you roll again — but three doubles in a row sends you straight to prison.'],
  ['🏠', 'Buying', 'Land on an unowned street, airport or utility and you may buy it. Turn it down and it goes to auction, where everyone can bid.'],
  ['🏗️', 'Building', 'Own every street of one country and you can build houses, then a hotel. Rent climbs steeply with each one.'],
  ['💸', 'Rent', 'Land on someone else’s property and you pay their rent. Airports scale 25 / 50 / 100 / 200; utilities charge 4× or 10× your roll.'],
  ['🏦', 'Mortgage', 'Short of cash? Mortgage a property for half its price. Mortgaged streets collect no rent until you buy them back at 10% interest.'],
  ['🤝', 'Trading', 'Offer any mix of cash, properties and prison cards to any player, at any time. Streets with buildings can’t be traded.'],
  ['🚔', 'Prison', 'Roll a double to walk out, pay the $50 fine, or use a card. After three failed attempts you pay anyway.'],
  ['💀', 'Bankruptcy', 'Owe more than you can raise and you must sell, mortgage or trade. Give up and everything goes to your creditor. Last player standing wins.'],
];

export function openHelpModal() {
  openModal(`
    <h2>How to play</h2>
    <p class="sub">The classic property-trading rules, in one screen.</p>
    <div class="help-list">
      ${RULES_HELP.map(([icon, title, body]) => `<div class="help-row">
        <span class="help-ico">${icon}</span>
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
            <span class="cr-name">${escapeHtml(t.name)}${m.mortgaged ? ' <i>mortgaged</i>' : ''}${blocked ? ' 🏠' : ''}</span>
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
    const collect = (prefix) => ({
      tiles: [...root.querySelectorAll(`input[data-side="${prefix}"]:checked`)].map((i) => Number(i.value)),
      money: cashOf(prefix),
      cards: Number(root.querySelector(`input[data-cards="${prefix}"]`)?.value || 0),
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
    // While the composer is open on their offer, they can see you're reading it.
    const watching = prefill?.counterOf != null;
    if (watching) actions.tradeViewing?.(prefill.counterOf, true);
    const stopWatching = () => { if (watching) actions.tradeViewing?.(prefill.counterOf, false); };
    if (watching) {
      const rootEl = root.closest('.modal-root') || root;
      rootEl.onclick = (e) => { if (e.target === rootEl) { stopWatching(); closeModal(); } };
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

    $('#tCancel', root).onclick = () => { stopWatching(); closeModal(); };
    $('#tSend', root).onclick = () => {
      sfx.trade();
      // A counter-offer replaces the one it answers (declining it also clears
      // the viewer flag server-side, so no separate viewing=false needed).
      if (prefill?.counterOf != null) actions.respondTrade(prefill.counterOf, false);
      actions.proposeTrade({ to: targetId, give: collect('give'), get: collect('get') });
      closeModal();
    };
  }, 'wide');
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
        <text x="${Math.min(x(flip) + 4, W - 90)}" y="${padT + 9}" class="gc-flip-label">👑 game turned</text>`;
    }
  }

  const legend = state.players.map((p) => `<span class="gc-key">
      <i style="background:${p.color}"></i>${escapeHtml(p.name)}${p.id === state.winner?.id ? ' 👑' : ''}</span>`).join('');

  return `<div class="go-chart">
      <p class="sub">Net worth over time</p>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${lines}${flipMark}</svg>
      <div class="gc-legend">${legend}</div>
    </div>`;
}

export function showGameOver(state, meId, actions) {
  const rank = [...state.players].sort((a, b) =>
    Number(a.bankrupt) - Number(b.bankrupt) || b.netWorth - a.netWorth);
  const medals = ['🥇', '🥈', '🥉'];
  openModal(`
    <div class="go-crown">🏆</div>
    <h2 class="go-title" style="color:${state.winner?.color || '#fff'}">${escapeHtml(state.winner?.name || 'Nobody')} wins!</h2>
    ${worthChartSVG(state)}
    <p class="sub">Final standings</p>
    ${rank.map((p, k) => `<div class="rank-row ${p.id === meId ? 'me' : ''}">
      <span class="rank-pos">${medals[k] || k + 1}</span>
      <span class="avatar sm" style="background:${p.color}">${escapeHtml((p.name[0] || '?').toUpperCase())}</span>
      <span class="rank-name">${escapeHtml(p.name)}</span>
      <span class="rank-worth">${p.bankrupt ? '<span class="dim">bankrupt</span>' : money(p.netWorth)}</span>
    </div>`).join('')}
    <div class="modal-actions">
      <button class="btn ghost" id="gClose">Close</button>
      ${state.hostId === meId ? '<button class="btn primary" id="gAgain">🔁 Play again</button>' : ''}
    </div>`, (root) => {
    $('#gClose', root).onclick = closeModal;
    const again = $('#gAgain', root);
    if (again) again.onclick = () => { closeModal(); actions.rematch(); };
  });
}

// ──────────────────────────────────────────────────────────── card popup ──
let cardTimer = null;
export function showCard(card) {
  const el = $('#cardPopup');
  el.className = `card-popup ${card.deck}`;
  el.innerHTML = `
    <div class="cp-ico">${card.deck === 'treasure' ? '🧰' : '❓'}</div>
    <div class="cp-kind">${card.deck === 'treasure' ? 'Treasure' : 'Surprise'}</div>
    <div class="cp-text">${escapeHtml(card.text)}</div>`;
  sfx.card();
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => el.classList.add('hidden'), 3400);
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
