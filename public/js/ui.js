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
  const structure = state.players.map((p) => `${p.id}:${p.bankrupt ? 1 : 0}:${p.color}`).join('|')
    + `:${state.status}:${state.hostId}:${emptySeats}`;

  if (el.dataset.structure !== structure) {
    el.dataset.structure = structure;
    el.innerHTML = state.players.map((p) => `
      <div class="player-card ${p.bankrupt ? 'dead' : ''} ${p.id === meId ? 'me' : ''}" data-pid="${p.id}">
        <div class="pc-glow"></div>
        <div class="avatar" style="background:${p.color}">
          ${escapeHtml((p.name[0] || '?').toUpperCase())}
          <span class="avatar-ring"></span>
          <span class="avatar-flag"></span>
        </div>
        <div class="pinfo">
          <div class="pname">${escapeHtml(p.name)}<span class="tags"></span></div>
          <div class="pmoney"></div>
          <div class="chips"></div>
        </div>
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
    if (!p.isBot && p.botControlled) tags.push('<i class="tag off">BOT PLAYING</i>');
    else if (!p.connected && !p.isBot) tags.push('<i class="tag off">AWAY</i>');
    if (p.jail) tags.push('<i class="tag jail">JAIL</i>');
    if (p.skipTurns > 0) tags.push('<i class="tag vac">VACATION</i>');
    if (p.getOutCards > 0) tags.push(`<i class="tag card">🎟️${p.getOutCards > 1 ? p.getOutCards : ''}</i>`);
    const tagEl = card.querySelector('.tags');
    const tagHtml = tags.join('');
    if (tagEl.dataset.v !== tagHtml) { tagEl.dataset.v = tagHtml; tagEl.innerHTML = tagHtml; }

    // money + delta bubble
    const moneyEl = card.querySelector('.pmoney');
    const shown = p.bankrupt ? '<span class="dim">bankrupt</span>' : money(p.money);
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
    ${incoming.map((t) => tradeCard(state, t)).join('')}
    ${outgoing.map((t) => `<div class="panel">
      <div class="panel-title">Offer sent</div>
      <div class="dim small">Waiting for ${escapeHtml(state.players.find((p) => p.id === t.to)?.name || '')}…</div>
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
  el.querySelectorAll('[data-accept]').forEach((b) => {
    b.onclick = () => { sfx.trade(); actions.respondTrade(Number(b.dataset.accept), true); };
  });
  el.querySelectorAll('[data-decline]').forEach((b) => {
    b.onclick = () => { sfx.click(); actions.respondTrade(Number(b.dataset.decline), false); };
  });
  const rb = $('#rematchBtn', el);
  if (rb) rb.onclick = () => actions.rematch();
}

function tradeCard(state, t) {
  const from = state.players.find((p) => p.id === t.from);
  const describe = (side) => {
    const bits = [];
    if (side.money) bits.push(money(side.money));
    side.tiles.forEach((i) => bits.push(state.map.tiles[i].name));
    if (side.cards) bits.push(`${side.cards}× prison card`);
    return bits.length ? bits.map(escapeHtml).join(' · ') : 'nothing';
  };
  return `<div class="panel trade-offer">
    <div class="panel-title">🤝 Offer from ${escapeHtml(from?.name || '')}</div>
    <div class="trade-line good"><span>You get</span><b>${describe(t.give)}</b></div>
    <div class="trade-line bad"><span>You give</span><b>${describe(t.get)}</b></div>
    <div class="row-2">
      <button class="btn good small" data-accept="${t.id}">Accept</button>
      <button class="btn bad small" data-decline="${t.id}">Decline</button>
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
      b.onclick = () => { sfx.bid(); actions.bid(Number(b.dataset.bid)); };
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
export function closeModal() {
  const root = $('#modalRoot');
  root.classList.add('hidden');
  root.innerHTML = '';
}

function openModal(html, onMount, extraClass = '') {
  const root = $('#modalRoot');
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

export function openDeedModal(state, i, meId, actions) {
  const deed = deedMarkup(state, i);
  if (!deed) return;
  const tile = state.map.tiles[i];
  const own = state.ownership[i];
  const isMine = own?.owner === meId;

  openModal(`${deed}
    ${isMine ? `<div class="modal-actions">
      ${canBuildOn(state, meId, i) ? `<button class="btn" id="dBuild">🏗️ Build ($${tile.houseCost})</button>` : ''}
      ${canSellOn(state, meId, i) ? '<button class="btn ghost" id="dSell">Sell building</button>' : ''}
      ${own.mortgaged
        ? (state.settings.mortgage ? `<button class="btn gold" id="dUnmort">Buy back ($${Math.ceil((tile.price / 2) * 1.1)})</button>` : '')
        : (canMortgage(state, meId, i) ? `<button class="btn ghost" id="dMort">Mortgage ($${Math.floor(tile.price / 2)})</button>` : '')}
      <button class="btn ghost" id="dClose">Close</button>
    </div>`
    : '<div class="modal-actions"><button class="btn ghost" id="dClose">Close</button></div>'}
  `, (root) => {
    const hook = (id, fn, sound) => {
      const b = $(id, root);
      if (b) b.onclick = () => { (sound || sfx.click)(); fn(i); closeModal(); };
    };
    hook('#dBuild', actions.build, sfx.build);
    hook('#dSell', actions.sellHouse);
    hook('#dMort', actions.mortgage, sfx.cash);
    hook('#dUnmort', actions.unmortgage, sfx.cash);
    $('#dClose', root).onclick = closeModal;
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

export function openTradeModal(state, meId, targetId, actions) {
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
      <label class="field tight"><span>Cash · max ${money(player.money)}</span>
        <input type="number" min="0" max="${player.money}" value="" placeholder="0" data-cash="${prefix}" /></label>
      ${player.getOutCards ? `<label class="field tight"><span>Prison cards · max ${player.getOutCards}</span>
        <input type="number" min="0" max="${player.getOutCards}" value="" placeholder="0" data-cards="${prefix}" /></label>` : ''}
    </div>`;

  openModal(`
    <h2>Trade with ${escapeHtml(them.name)}</h2>
    <p class="sub">Tick what each side puts on the table. Streets with buildings can't move.</p>
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
      <button class="btn primary" id="tSend">Send offer</button>
    </div>`, (root) => {
    const collect = (prefix) => ({
      tiles: [...root.querySelectorAll(`input[data-side="${prefix}"]:checked`)].map((i) => Number(i.value)),
      money: Number(root.querySelector(`input[data-cash="${prefix}"]`)?.value || 0),
      cards: Number(root.querySelector(`input[data-cards="${prefix}"]`)?.value || 0),
    });
    // Face value only — it ignores how badly you need that last street.
    const worth = (side) => side.money + side.cards * 50
      + side.tiles.reduce((sum, i) => sum + state.map.tiles[i].price, 0);

    const refresh = () => {
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
    root.querySelectorAll('input').forEach((i) => { i.oninput = refresh; i.onchange = refresh; });
    refresh();

    $('#tCancel', root).onclick = closeModal;
    $('#tSend', root).onclick = () => {
      sfx.trade();
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
