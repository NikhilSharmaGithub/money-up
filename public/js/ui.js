// Everything that isn't the board: player cards, settings, action bar, modals,
// chat, toasts and the celebratory bits.

import { escapeHtml, deedMarkup, deckMarkup } from './board.js';
import {
  icon, groupBanner, groupFlag, circleFlag, utilityName,
} from './icons.js';
import { sfx } from './sound.js';
import { api } from './net.js';
import { loadFacts, factsFor } from './facts.js';
import { configureAdNetwork, playNetworkAd } from './ads.js';
import { noteWallet, setCoins } from './coins.js';
import { drawResultCard, sharePicture, canSharePicture } from './sharecard.js';

const $ = (sel, root = document) => root.querySelector(sel);

export const FLAGS = [
  '🇮🇳', '🇬🇧', '🇺🇸', '🇧🇷', '🇩🇪', '🇫🇷', '🇮🇹', '🇪🇸', '🇵🇹', '🇳🇱',
  '🇮🇪', '🇨🇭', '🇸🇪', '🇳🇴', '🇩🇰', '🇵🇱', '🇺🇦', '🇹🇷', '🇷🇴', '🇬🇷',
  '🇮🇱', '🇦🇪', '🇸🇦', '🇪🇬', '🇿🇦', '🇳🇬', '🇰🇪', '🇨🇳', '🇯🇵', '🇰🇷',
  '🇹🇭', '🇻🇳', '🇵🇭', '🇮🇩', '🇵🇰', '🇧🇩', '🇱🇰', '🇳🇵', '🇦🇺', '🇳🇿',
  '🇨🇦', '🇲🇽', '🇦🇷', '🇨🇱', '🇨🇴', '🇷🇺', '🇸🇬', '🇲🇾', '🏴‍☠️', '🌍',
];
// A balance can sit below zero now — a debt being worked off — and the plain
// formatter would print that as "$-1,300". A real minus sign goes in front of
// the currency instead, the way the delta bubbles already write it.
const money = (n) => {
  const v = Number(n || 0);
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}`;
};

/**
 * A drawn tick, the Ready round's mark — the app has no check glyph, and a
 * typed one comes out as a coloured emoji on half the phones reading it. It
 * paints with currentColor, so it takes whatever ink it is printed in.
 */
export const TICK = `<svg class="ico tick" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
  <path d="M5 12.5 10 17.5 19 7" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ─────────────────────────────────────────────────────────────── toasts ──
const MAX_TOASTS = 3;

export function toast(message, type = 'info') {
  const root = $('#toastRoot');

  // Repeating the same message bumps a counter instead of stacking copies —
  // of one still showing, not of one already on its way out.
  const twin = [...root.children].find((c) => c.dataset.msg === message && !c.dataset.gone);
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
  // A dismissed toast stays in the DOM for its 320 ms fade, so counting
  // children would never drop below the cap inside one synchronous pass — a
  // loop over them spun forever and froze the tab. Count only the live ones.
  const live = [...root.children].filter((c) => !c.dataset.gone);
  live.slice(0, Math.max(0, live.length - MAX_TOASTS)).forEach(dismissToast);
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
  // Construction and paperwork happen on your clock only.
  if (state.turn?.playerId !== state.ownership?.[i]?.owner) return false;
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

/**
 * How many buildings one press of Build all would actually put up.
 *
 * The server decides; this only decides whether to offer the button and what
 * number to print on it. It walks the same loop `GameRoom.buildAll` does —
 * always the shortest street in the country next, cheapest first when they
 * are level — so the number on the button is the number in the log a moment
 * later, rather than an optimistic guess the player has to reconcile.
 *
 * Zero means don't offer it; one means the ＋ beside it already says
 * everything this button would.
 */
export function buildAllCount(state, meId, i) {
  const tile = state.map.tiles[i];
  const group = state.map.groups?.[tile?.group] || [];
  // Ownership, mortgages, whose turn it is: canBuildOn already says all of
  // it. If no street in the country may take a house, neither may this.
  if (group.length < 2 || !group.some((g) => canBuildOn(state, meId, g))) return 0;

  const houses = Object.fromEntries(group.map((g) => [g, state.ownership[g]?.houses || 0]));
  let purse = state.players.find((p) => p.id === meId)?.money || 0;
  const even = !!state.settings.evenBuild;
  let built = 0;

  // At most five to a street, so this cannot run away.
  for (let guard = group.length * 5; guard > 0; guard--) {
    const lowest = Math.min(...group.map((g) => houses[g]));
    const next = group
      .filter((g) => {
        const cost = state.map.tiles[g].houseCost || 0;
        if (houses[g] >= 5 || !cost || cost > purse) return false;
        return even ? houses[g] === lowest : true;
      })
      .sort((a, b) => (houses[a] - houses[b])
        || ((state.map.tiles[a].houseCost || 0) - (state.map.tiles[b].houseCost || 0)))[0];
    if (next === undefined) break;
    purse -= state.map.tiles[next].houseCost || 0;
    houses[next]++;
    built++;
  }
  return built;
}

export function canSellOn(state, meId, i) {
  if (state.turn?.playerId !== state.ownership?.[i]?.owner) return false;
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
  // Construction and paperwork happen on your clock only.
  if (state.turn?.playerId !== state.ownership?.[i]?.owner) return false;
  const o = state.ownership[i];
  const t = state.map.tiles[i];
  if (!state.settings.mortgage || !o || o.owner !== meId || o.mortgaged) return false;
  if (t.type === 'property') {
    const group = state.map.groups[t.group] || [];
    if (group.some((g) => (state.ownership[g]?.houses || 0) > 0)) return false;
  }
  return true;
}

/**
 * A deed that cannot change hands — tradeBlocked() in server/game.js. A street
 * is locked while any street of its colour carries a building, not only while
 * it does itself: trading the bare one away would leave houses standing on a
 * colour its owner no longer holds whole, and the server refuses the offer.
 */
function tradeLocked(state, i) {
  const o = state.ownership[i];
  if (!o) return false;
  if ((o.houses || 0) > 0) return true;
  const t = state.map.tiles[i];
  if (t?.type !== 'property') return false;
  return (state.map.groups[t.group] || []).some((g) => (state.ownership[g]?.houses || 0) > 0);
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

/**
 * Street names by board, so a line that names a city can fly its flag. Kept
 * by the layout's uid rather than the board's id: two Random boards share an
 * id and not a street, and the index must be read off the board this table
 * is playing (state.map), never one remembered from somewhere else.
 */
let flagIndexFor = null;
let flagIndex = new Map();
function cityFlags(state) {
  const key = state.map?.uid || state.map?.id;
  if (flagIndexFor !== key) {
    flagIndexFor = key;
    flagIndex = new Map();
    for (const t of state.map?.tiles || []) {
      const mark = t.group ? state.groups?.[t.group]?.flag : null;
      if (t.name && mark) flagIndex.set(t.name, mark);
    }
  }
  return flagIndex;
}

/** The first street a line names, longest name first so "New York" beats "York". */
function cityIn(text, flags) {
  let best = null;
  for (const [name, mark] of flags) {
    if (text.includes(name) && (!best || name.length > best.name.length)) best = { name, mark };
  }
  return best;
}

/**
 * `lines` is the log as the caller shows it — app.js holds back a line the
 * walk caused until the piece lands and its money moves (see "the purse
 * ledger"), so a feed with nothing held is simply the server's log.
 */
export function renderLog(state, el, lines = state.log) {
  // How many lines are shown belongs in the key as well as how many exist: a
  // held line let go lands in the middle of the feed, not at its end, and
  // leaves the server's own log exactly as it was.
  const sig = `${state.log.length}:${state.log[state.log.length - 1]?.at || 0}:${lines.length}`;
  if (el.dataset.sig === sig) return;
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60 || !el.dataset.sig;
  el.dataset.sig = sig;
  const flags = cityFlags(state);
  el.innerHTML = lines.map((l) => {
    // A line about a street wears that street's flag, the same coin the
    // board wears — you can read the log by colour alone.
    const city = cityIn(l.text, flags);
    const mark = city ? `<span class="log-flag">${circleFlag(city.mark, '#888', 15)}</span>` : '';
    return `<div class="log-line ${l.kind}">
      <span class="log-ico">${LOG_ICON[l.kind] ? icon(LOG_ICON[l.kind]) : '·'}</span>${mark}<span>${escapeHtml(l.text)}</span>
    </div>`;
  }).join('');
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
 * How a seat reads when the caller has nothing held back: the server's own
 * numbers. app.js passes its own reading instead while a piece is still
 * walking to the rent it has already been charged — see "the purse ledger".
 * `snap` is a first paint: numbers are put in place, not counted to.
 */
const RAW = { money: (p) => p.money || 0, worth: (p) => p.netWorth || 0, out: isOut, snap: false };

/**
 * Live standings by net worth. Seating order breaks ties so two players on the
 * same money don't swap numbers back and forth on every push.
 */
function rankByWorth(state, shown = RAW) {
  const rank = new Map();
  state.players
    .map((p, seat) => ({ id: p.id, seat, worth: shown.worth(p), out: shown.out(p) }))
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

export function renderPlayers(state, meId, el, actions, shown = RAW) {
  // The trade sheet reads this, and a trade is made with real money — so it
  // is the server's state, never the shown one.
  livePlayersState = state;
  const rank = rankByWorth(state, shown);
  const nextUp = nextUpId(state);
  // This browser's own seats, read once for the whole roster: none of them
  // opens a profile (see opensProfile).
  const here = deviceCodes();
  const emptySeats = state.status === 'lobby'
    ? Math.max(0, state.settings.maxPlayers - state.players.length) : 0;
  const structure = state.players.map((p) => `${p.id}:${shown.out(p) ? 1 : 0}:${p.color}:${p.avatar || ''}:${p.isBot ? 1 : 0}`).join('|')
    + `:${state.status}:${state.hostId}:${emptySeats}:${botSkillShown(state) ? botLevelOf(state).id : ''}`;

  if (el.dataset.structure !== structure) {
    el.dataset.structure = structure;
    el.innerHTML = state.players.map((p) => `
      <div class="player-card ${shown.out(p) ? 'dead' : ''} ${p.id === meId ? 'me' : ''}" data-pid="${p.id}">
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
        ${state.hostId === meId && !state.quick && !state.cup ? '<button class="btn tiny" data-addbot>Add bot</button>' : ''}
      </div>`).join('')
      + botSkillCard(state, meId);

    el.querySelectorAll('[data-addbot]').forEach((b) => {
      b.onclick = () => { sfx.click(); botAddedAt = Date.now(); actions.addBot(); };
    });
    wirePickers(el, actions);
    // A bot added from the foot of the settings is seated a long way up the
    // column; the host is shown the card it brought with it.
    const arrived = $('.bot-skill.arriving', el);
    if (arrived && Date.now() - botAddedAt < 4000) {
      requestAnimationFrame(() => arrived.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
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

    // The face and the name open this player's profile (1.0.6) — the sheet
    // the result standings open — at the lobby and mid-game alike, for any
    // seat with a friend code that is not sitting at this keyboard. Nothing
    // else on the card answers a tap: Trade, Make host and the rest are
    // buttons of their own, so the two never compete for one touch. The face
    // is the one keyboard stop; the name is the same target for a pointer.
    const profile = opensProfile(p, meId, here);
    const profileKey = profile ? `${p.code}:${p.name}` : '';
    if (card.dataset.profile !== profileKey) {
      card.dataset.profile = profileKey;
      card.classList.toggle('has-profile', profile);
      const disc = card.querySelector('.avatar');
      const pid = p.id;
      const open = (e) => {
        e.stopPropagation();
        sfx.click();
        // The seat as it is now, not as it was when the card was wired: the
        // name and the level move under a card that is never rebuilt for it.
        const seat = livePlayersState?.players.find((x) => x.id === pid);
        if (seat?.code) openPlayerProfile(seat, { token: meId });
      };
      if (profile) {
        const label = `See ${p.name}'s profile`;
        disc.setAttribute('role', 'button');
        disc.tabIndex = 0;
        disc.setAttribute('aria-label', label);
        disc.title = label;
        nameEl.title = label;
        disc.onclick = open;
        nameEl.onclick = open;
        disc.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); }
        };
      } else {
        ['role', 'tabindex', 'aria-label', 'title'].forEach((a) => disc.removeAttribute(a));
        nameEl.removeAttribute('title');
        disc.onclick = null;
        nameEl.onclick = null;
        disc.onkeydown = null;
      }
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
    // The level is who somebody is before the dice start and after they stop,
    // so it rides the seat in the lobby and on the final standings. Mid-game
    // the row is busy telling you who is next and who is in jail, and the
    // level is not news there.
    if (state.status !== 'playing' && p.level > 0) tags.push(levelChip(p.level, 'seat'));
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
    // The game is waiting on this seat's answer about its streets (1.0.7).
    if (state.bankruptChoice?.playerId === p.id) tags.push('<i class="tag deciding">DECIDING</i>');
    if (p.jail) tags.push('<i class="tag jail">JAIL</i>');
    if (p.skipTurns > 0) tags.push('<i class="tag vac">VACATION</i>');
    if (p.getOutCards > 0) tags.push(`<i class="tag card">${icon('ticket')}${p.getOutCards > 1 ? p.getOutCards : ''}</i>`);
    const tagEl = card.querySelector('.tags');
    const tagHtml = tags.join('');
    if (tagEl.dataset.v !== tagHtml) { tagEl.dataset.v = tagHtml; tagEl.innerHTML = tagHtml; }

    // money + delta bubble
    const moneyEl = card.querySelector('.pmoney');
    const cash = shown.money(p);
    const out = shown.out(p);
    // Below zero the wallet IS the debt: it wears the danger red, and the row
    // pulses quietly until the balance climbs back into the black.
    const inRed = cash < 0 && !out;
    card.classList.toggle('in-debt', inRed);
    moneyEl.classList.toggle('neg', inRed);
    const label = state.status === 'lobby' ? money(p.money)
      : out ? `<span class="dim">${p.timedOut ? 'out of the game' : 'bankrupt'}</span>`
      : money(cash);
    if (moneyEl.dataset.v !== label) {
      const before = prevMoney.get(p.id);
      moneyEl.dataset.v = label;
      // A payment lands as one event: the badge, the coins, the number
      // counting to its new value. A lobby is not a game yet, a rematch
      // resets every wallet at once (a new game, not eight players suddenly
      // winning), a first paint is a position, and a seat that has just gone
      // bankrupt says so instead of "+$300" for the debt it walked away from.
      if (before != null && before !== cash && !out && state.status !== 'lobby' && !shown.snap) {
        const paid = cash > before;
        countMoney(moneyEl, before, cash, paid ? 250 : 0);
        spawnDelta(card, cash - before);
        spillCoins(card, cash - before);
        moneyEl.classList.remove('bump');
        void moneyEl.offsetWidth;
        moneyEl.classList.add('bump');
      } else {
        stopCount(moneyEl);
        moneyEl.innerHTML = label;
      }
    }
    prevMoney.set(p.id, cash);

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
      const final = html || `<span class="dim">${out ? 'nothing left' : 'no property yet'}</span>`;
      if (chips.dataset.v !== final) { chips.dataset.v = final; chips.innerHTML = final; }
    } else {
      // Only a Play-now table's Ready round gives "ready" a meaning. It said
      // so of every seat at every lobby, which was never true of anyone —
      // and is now the one word at that table somebody can be waiting on.
      // The host has nothing to press but Start, so it says that instead.
      const lobbyNote = !state.quickLobby ? '<span class="dim">in the lobby</span>'
        : p.id === state.hostId ? '<span class="dim">starts the game</span>'
        : p.ready ? `<span class="lobby-ready">${TICK} Ready</span>`
        : '<span class="dim">Not ready</span>';
      if (chips.dataset.v !== lobbyNote) { chips.dataset.v = lobbyNote; chips.innerHTML = lobbyNote; }
    }

    // buttons
    const acts = card.querySelector('.player-actions');
    const me = state.players.find((x) => x.id === meId);
    // Someone only watching has no seat to trade from — openTradeModal
    // would throw on the missing player rather than open.
    const canTrade = !!me && state.status === 'playing' && p.id !== meId && !isOut(p) && !isOut(me);
    // Nobody hosts a Quick Play table, so nobody gets to throw strangers off it.
    const canKick = state.hostId === meId && state.status === 'lobby' && p.id !== meId
      && !state.quick && !state.cup;
    // The chair travels: a host can pass it to anyone actually at the table.
    const canPassHost = state.hostId === meId && p.id !== meId && !p.isBot
      && p.connected !== false && !state.quick && state.status !== 'playing';
    const canPickTeam = state.status === 'lobby' && state.settings.teams > 0
      && (p.id === meId || (state.hostId === meId && p.isBot));
    const want = `${canTrade ? 't' : ''}${canKick ? 'k' : ''}${canPickTeam ? 'm' : ''}${canPassHost ? 'h' : ''}`;
    if (acts.dataset.v !== want) {
      acts.dataset.v = want;
      acts.innerHTML = `${canPickTeam ? '<button class="btn tiny" data-team title="Switch team">⇄</button>' : ''}
                        ${canTrade ? '<button class="btn tiny" data-trade>Trade</button>' : ''}
                        ${canPassHost ? `<button class="btn tiny" data-host title="Hand the host chair to ${escapeHtml(p.name)}">Make host</button>` : ''}
                        ${canKick ? '<button class="icon-btn" data-kick title="Remove">✕</button>' : ''}`;
      const pid = p.id;
      const hb = acts.querySelector('[data-host]');
      if (hb) hb.onclick = () => { sfx.click(); actions.makeHost?.(pid); };
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

/**
 * Three coins for a payment: lifting off the purse that paid, dropping into
 * the one that was paid — a beat later, so the money reads as travelling
 * from one seat to the other. The stylesheet does the moving (and hides them
 * for anyone who has asked for less motion).
 */
function spillCoins(card, amount) {
  const slot = card.querySelector('.delta-slot');
  if (!slot) return;
  const way = amount < 0 ? 'out' : 'in';
  const coins = [0, 1, 2].map((k) => {
    const el = document.createElement('i');
    el.className = `coin-spill ${way}`;
    el.style.setProperty('--k', String(k));
    el.innerHTML = icon('coin', 13);
    slot.appendChild(el);
    return el;
  });
  setTimeout(() => coins.forEach((el) => el.remove()), 900);
}

/**
 * A purse counting to its new value instead of snapping to it — the number
 * moving is the money arriving. 600ms, easing out; a payee starts a quarter
 * second late, as its first coin lands. A second payment mid-count picks up
 * from whatever the purse is showing, so the number never jumps backwards.
 */
const counts = new WeakMap();

function stopCount(el) {
  const run = counts.get(el);
  if (!run) return;
  cancelAnimationFrame(run.raf);
  clearTimeout(run.wait);
  counts.delete(el);
}

function countMoney(el, from, to, delay = 0) {
  const running = counts.get(el);
  const start = running ? running.now : from;
  stopCount(el);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.innerHTML = money(to); return; }
  const run = { raf: 0, wait: 0, now: start };
  counts.set(el, run);
  el.innerHTML = money(start);
  const go = () => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 600);
      run.now = Math.round(start + (to - start) * (1 - (1 - t) ** 3));
      el.innerHTML = money(run.now);
      if (t < 1) run.raf = requestAnimationFrame(step);
      else counts.delete(el);
    };
    run.raf = requestAnimationFrame(step);
  };
  if (delay) run.wait = setTimeout(go, delay);
  else go();
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

/**
 * What a Play-now lobby's panel shows that the settings do not: who is in
 * which seat and who has pressed Ready, which phase the table is in, whether
 * an empty chair is being found, and which rules the host has moved off the
 * roll. The deadline itself is left out on purpose — it moves with every
 * arrival and every change, and the panel holds the name field somebody may
 * be typing in; the countdown lives in the well, which ticks on its own.
 */
function quickSig(state) {
  const q = state.quickLobby;
  if (!q) return state.quickStartAt ? 'counting' : '';
  return `${q.phase}:${q.canStart ? 1 : 0}:${q.backfillAt ? 1 : 0}:${(q.editable || []).join(',')}:`
    + `${state.players.map((p) => `${p.id}${p.ready ? '+' : ''}`).join(',')}:${(state.quickRoll?.edited || []).join(',')}`;
}

export function renderRightPanel(state, meId, el, actions) {
  const me = state.players.find((p) => p.id === meId);
  // Whose turn it is decides whether the deed rows carry ＋, − and the
  // mortgage buttons at all, so a turn passing has to repaint them even when
  // no deed changed. The layout is in it too: every street name and flag on
  // this panel is read off state.map, and a shuffled board (1.0.6) is the
  // same board id dealt into a different order — only its uid moves.
  const layout = state.map.uid || state.map.id;
  const sig = state.status === 'lobby'
    ? `lobby:${state.hostId}:${meId}:${me?.color}:${JSON.stringify(state.settings)}:${layout}:${state.players.length}:${state.players.filter((p) => p.isBot).length}:${quickSig(state)}`
    : `game:${layout}:${JSON.stringify(state.ownership)}:${meId}:${state.vacationPot}:${tradeSig(state)}:${state.status}:${state.settings.mortgage}:${debtSig(state, meId)}:${me?.bankrupt ? 1 : 0}${me?.timedOut ? 'x' : ''}:${lapSig(state)}:${state.turn?.playerId || ''}${me ? '' : `:w${state.spectators || 0}`}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  // A lobby repaints under whoever is typing their name — somebody sat
  // down, somebody pressed Ready, the host changed a rule — and a field
  // rebuilt mid-word loses the word. It is put back as it was, caret and all.
  const field = document.activeElement?.id === 'nameField' && el.contains(document.activeElement)
    ? document.activeElement : null;
  const typing = field && { value: field.value, from: field.selectionStart, to: field.selectionEnd };
  if (state.status !== 'lobby') renderMyStuff(state, meId, el, actions);
  else if (state.quick) renderQuickLobby(state, meId, el, actions);
  else renderSettings(state, meId, el, actions);
  const again = typing && $('#nameField', el);
  if (again) {
    again.value = typing.value;
    again.focus();
    again.setSelectionRange(typing.from, typing.to);
  }
}

const LOOK_COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185', '#22d3ee', '#f97316'];

// ─────────────────────────────────────────────────────────── board shelf ──
// Boards are stock. Two are free every day, Classic is free forever, and the
// rest are bought — so what the lobby can show is a question with an answer
// only the server has, and it is asked once and kept here.
//
// The three boxes are always the same three things: today's two free boards,
// and then whatever board this table is actually on. That last slot is the
// point — a host who has bought Bharat sees Bharat, everyone else sees
// Classic, and nobody has to open a menu to find out what they are playing.
let boardShelf = null;      // { boards, free, until, ... } once it has loaded
let boardLoading = null;    // the flight in progress, so two renders share one
// Which table the kept shelf was asked about. A board can be rented for one
// game at one table, so the same wallet gets a different answer in a different
// lobby — and a shelf read in the shop, with no table at all, must not be
// handed back to a lobby as if it knew about this one.
let boardShelfRoom = null;
// Which table the flight in progress is asking about — a separate note, kept
// only for the dedupe below. Stamping the answer's room before the answer
// arrived meant a failed refetch left one table's shelf labelled as another's,
// and paintBoards' freshness test is exactly that label: the lobby would draw
// a board rented at the table you just left as playable here, unlocked and
// tagged "One game", and tapping it went straight past the buy sheet into a
// board change the server then refused.
let boardLoadingRoom = null;

function loadBoardShelf(token, force = false, roomId = '') {
  const room = roomId || '';
  if (boardShelf && !force && boardShelfRoom === room) return Promise.resolve(boardShelf);
  if (boardLoading && !force && boardLoadingRoom === room) return boardLoading;
  boardLoadingRoom = room;
  boardLoading = fetch(api(`/api/boards?token=${encodeURIComponent(token || '')}`
    + (room ? `&room=${encodeURIComponent(room)}` : '')))
    .then((r) => r.json())
    // The room goes on the shelf with the shelf, never before it — the label
    // is only true of data that actually arrived.
    .then((d) => { boardShelf = d; boardShelfRoom = room; return d; })
    // A refresh that failed is not news that the shelf is empty. Keeping the
    // last good one means a dropped packet costs a stale price, not a shop
    // full of cards that do nothing when you tap them.
    .catch(() => boardShelf)
    .finally(() => { boardLoading = null; });
  return boardLoading;
}

/** The board a table is on, by id, however the state happens to spell it. */
const currentMapId = (state) => state.mapId || state.settings?.mapId || 'classic';

/**
 * The three: both of the day's free boards, then the one in play. When the
 * table is already on a free board the third slot falls back to Classic, so
 * the row never repeats itself and the house board is never more than a tap
 * away.
 */
function boardTrio(state) {
  if (!boardShelf) return [];
  const by = (id) => boardShelf.boards.find((b) => b.id === id);
  const out = [];
  const add = (id) => {
    const b = by(id);
    if (b && !out.some((x) => x.id === b.id)) out.push(b);
  };
  (boardShelf.free || []).forEach(add);
  add(currentMapId(state));
  add(boardShelf.house || 'classic');
  return out.slice(0, 3);
}

/** What a box says under its name — and it never says two things at once. */
function boardTag(b) {
  if (b.how === 'house') return '<span class="bb-tag free">Always free</span>';
  if (b.how === 'today') return '<span class="bb-tag today">Free today</span>';
  if (b.how === 'owned') return '<span class="bb-tag owned">Yours</span>';
  // Paid for, and good for this table only. It says how long it lasts because
  // that is the whole difference between this tag and the one above it.
  if (b.how === 'rented') return '<span class="bb-tag rented">One game</span>';
  // The old price only when there really is one — a "was" that matches the
  // price is the oldest lie in retail.
  const was = b.was ? `<s>${b.was}</s> ` : '';
  return `<span class="bb-tag locked ${b.was ? 'sale' : ''}">${icon('coin', 10)} ${was}${b.price}</span>`;
}

/**
 * Three of the places on it — what a card too small to list them all says.
 *
 * The server picks the dearest three rather than the first three, because a
 * board is laid out cheapest-first and the top of that list sells Canada on
 * Corner Brook. The fallback is only for a server too old to know that.
 */
const boardTeaser = (b) =>
  (b.headline?.length ? b.headline : (b.sets || []).flatMap((s) => s.cities).slice(0, 3))
    .join(' · ');

/**
 * The board in words: every colour set with its own streets.
 *
 * A rim of coloured chips says a board exists. This says whether you want it,
 * and it is the only thing on the sheet anybody reads twice — nobody ever
 * bought a board because it had twenty-two streets.
 */
function boardContents(b) {
  if (!b.sets?.length) return '';
  return `<div class="board-sets">
    <div class="bs-head">What's on it</div>
    ${b.sets.map((x) => `<div class="bs-row">
      <i style="background:${escapeHtml(x.color)}"></i>
      <div><b>${escapeHtml(x.name)}</b><span>${x.cities.map(escapeHtml).join(', ')}</span></div>
    </div>`).join('')}
  </div>`;
}

function boardBoxesHTML(state, isHost) {
  if (!boardShelf) return '<div class="board-boxes loading"></div>';
  const cur = currentMapId(state);
  const trio = boardTrio(state);
  const locked = boardShelf.boards.filter((b) => !b.playable).length;
  const box = (b) => `<button class="board-box ${b.id === cur ? 'sel' : ''} ${b.playable ? '' : 'locked'}"
      data-board="${b.id}" ${isHost ? '' : 'disabled'} title="${escapeHtml(b.description || b.name)}">
      ${miniBoard(b.preview)}
      <span class="bb-name">${escapeHtml(b.name)}</span>
      ${boardTag(b)}
    </button>`;
  return `<div class="board-boxes">${trio.map(box).join('')}</div>
    <button class="board-all" id="boardAll">
      <span>All boards</span>
      <span class="ba-meta">${boardShelf.boards.length} boards · ${locked} locked ›</span>
    </button>
    <div class="board-clock" id="boardClock"></div>`;
}

/**
 * Paint the boxes into whatever lobby is on screen, and wire them.
 *
 * `mayRent` is whether a one-game rent is offered, which is the host's to
 * spend — except at a Play-now table, where the host is whoever has sat
 * there longest and the chair can pass to a stranger mid-lobby, taking a
 * paid game with it. The server refuses a rent there; this keeps the button
 * from being offered in the first place.
 */
function paintBoards(state, el, token, actions, isHost, mayRent = isHost) {
  const host = $('#boardPick', el);
  if (!host) return;
  const again = () => paintBoards(state, el, token, actions, isHost, mayRent);
  // The table's own id goes with every ask: a rented board is only rented
  // here, and the shelf cannot say so without being told where "here" is.
  if (!boardShelf || boardShelfRoom !== (state.id || '')) {
    loadBoardShelf(token, false, state.id).then((d) => { if (d) again(); });
    return;
  }
  host.innerHTML = boardBoxesHTML(state, isHost);

  const clock = $('#boardClock', host);
  if (clock && boardShelf.until) {
    const tick = () => {
      const left = boardShelf.until - Date.now();
      if (left <= 0) {
        // Midnight passed while this lobby sat open. Re-ask rather than
        // guess: the server owns the calendar, and the two new boards are
        // the only thing on this panel that changes without being touched.
        clock.textContent = 'New boards…';
        loadBoardShelf(token, true, state.id).then((d) => { if (d) again(); });
        return;
      }
      clock.textContent = `Two new free boards in ${longCountdownText(left)}`;
    };
    tick();
    const timer = setInterval(() => (host.isConnected ? tick() : clearInterval(timer)), 1000);
  }

  host.querySelectorAll('[data-board]').forEach((b) => {
    b.onclick = () => {
      sfx.click();
      const id = b.dataset.board;
      if (b.classList.contains('locked')) {
        // Bought — or rented for one game — from the lobby: play it straight
        // away. That is what they were reaching for when they tapped it.
        return openBoardBuy(token, id, (bought) => {
          if (isHost) actions.settings({ mapId: bought });
          again();
        }, state.id, mayRent);
      }
      actions.settings({ mapId: id });
    };
  });
  const all = $('#boardAll', host);
  if (all) {
    all.onclick = () => {
      sfx.click();
      // The same host-ness the boxes were painted with — a cup table and a
      // guest's chair are both already folded into it.
      openBoardModal(state, actions, token, again, mayRent);
    };
  }
}

/**
 * Buying a board where you found it — or borrowing it for one game.
 *
 * The shop is a long page and the board is near the bottom of it; sending
 * somebody down there to spend six hundred coins, and then back, is three
 * steps too many for a decision they have already made. So the price is paid
 * here, next to the board it buys, with the board itself as the thing being
 * looked at.
 *
 * `roomId` is the table the rent would be good at, and a rent is offered only
 * when there is one. Opened from the shop there is no table to play at, so
 * there is one button on this sheet and it buys the board outright.
 *
 * `mayRent` is the other half of that: the board a table plays is read against
 * the HOST's wallet and nobody else's, so the host is the only chair a rent
 * can be spent from. Without this a guest was shown a coin button that the
 * server answered with "Only the host picks the board" every time — a money
 * button somebody was invited to press and could never use. Buying outright is
 * open to anyone, because a board you buy is yours wherever you sit next.
 */
export function openBoardBuy(token, boardId, onBought, roomId = '', mayRent = false) {
  const b = boardShelf?.boards.find((x) => x.id === boardId);
  // Nothing to open means the shelf never arrived. Silence here reads as a
  // broken shop — the player taps the same card three times and gives up.
  if (!b) {
    loadBoardShelf(token, true, roomId);
    return toast('Boards are unreachable — try again in a moment', 'error');
  }
  const coins = boardShelf.coins ?? 0;
  const short = Math.max(0, b.price - coins);
  // One coin, one game — and a game already paid for and never played moves
  // here rather than being charged for twice, so the button says so and asks
  // for nothing. (The server decides that either way; this only reads it.)
  const rentPrice = boardShelf.rent?.price ?? 1;
  const holding = boardShelf.rent?.holding || null;
  const moving = !!holding && !(holding.mapId === boardId && holding.roomId === roomId);
  const canRent = mayRent && !!roomId && b.rentable && (coins >= rentPrice || !!holding);
  const rentLabel = holding
    ? (moving ? 'Move your unplayed game here' : 'Play this game — already paid')
    : `Play one game — ${rentPrice} coin`;
  const rentLine = holding
    ? (moving
      ? 'You have a game you paid for and never played. It moves to this table and this board — nothing more to pay.'
      : 'Paid for and waiting. It is spent when this table deals, and only then.')
    : `${rentPrice} coin plays one game here, on this table. Unplayed, it keeps: rent a different board and the same game moves with you.`;
  openModal(`
    <div class="buy-board">
      ${miniBoard(b.preview)}
      <h2>${escapeHtml(b.name)}</h2>
      <p class="sub">${escapeHtml(b.description || '')}</p>
      <div class="bb-stats">
        <span><b>${b.size}</b> tiles</span>
        <span><b>${b.streets}</b> streets</span>
        <span><b>${b.countries}</b> sets</span>
      </div>
      ${boardContents(b)}
      <p class="sub">Buy it once and it is yours for good. Only the host needs to own a board —
        everyone at your table plays it with you.</p>
      <button class="btn primary big wide" id="bbGo" ${short ? 'disabled' : ''}>
        ${icon('coin')} ${short ? `${short} more coins needed`
          : `${b.was ? `<s>${b.was}</s> ` : ''}Unlock for ${b.price}`}
      </button>
      ${canRent ? `<button class="btn wide" id="bbRent">
        ${icon('coin')} ${rentLabel}
      </button>
      <p class="bb-wallet">${escapeHtml(rentLine)}</p>` : ''}
      <p class="bb-wallet">${short
        ? `You have ${coins}. Win a game, collect the daily reward, or top up in the store.`
        : b.was ? `You have ${coins} coins. On sale today — three boards are, every day.`
        : `You have ${coins} coins.`}</p>
      <div class="modal-actions"><button class="btn ghost" id="bbClose">Close</button></div>
    </div>`, (root) => {
    $('#bbClose', root).onclick = closeModal;
    const rent = $('#bbRent', root);
    if (rent) {
      rent.onclick = async () => {
        rent.disabled = true;
        sfx.click();
        try {
          const res = await fetch(api('/api/boards/rent'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, mapId: boardId, roomId, expect: rentPrice }),
          }).then((r) => r.json());
          if (res.error) {
            rent.disabled = false;
            toast(res.error, 'error');
            await loadBoardShelf(token, true, roomId);
            return;
          }
          sfx.buy();
          toast(res.charged
            ? `${b.name} for one game — good at this table`
            : `Your unplayed game moved to ${b.name}`);
          closeModal();
          await loadBoardShelf(token, true, roomId);
          onBought?.(boardId);
        } catch {
          rent.disabled = false;
          toast('Store is unreachable', 'error');
        }
      };
    }
    const go = $('#bbGo', root);
    if (!go || short) return;
    go.onclick = async () => {
      go.disabled = true;
      sfx.click();
      try {
        const res = await fetch(api('/api/store/buy'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          // The price we are agreeing to. The shelf turns over at midnight and
          // the server refuses rather than quietly charging the new number.
          body: JSON.stringify({ token, itemId: `brd-${boardId}`, expect: b.price }),
        }).then((r) => r.json());
        if (res.error) {
          go.disabled = false;
          toast(res.error, 'error');
          // Whatever it was, what is on screen is no longer to be trusted.
          await loadBoardShelf(token, true, roomId);
          return;
        }
        sfx.buy();
        toast(`${b.name} is yours!`);
        closeModal();
        await loadBoardShelf(token, true, roomId);
        onBought?.(boardId);
      } catch {
        go.disabled = false;
        toast('Store is unreachable', 'error');
      }
    };
  });
}


// ────────────────────────────────────────────────────────── piece picker ──
// The shop already sells pieces; this is the same shelf carried to the seat
// you actually choose from. Sitting down and picking your token is one motion
// now — the plain disc is everyone's, the skins are whatever the wallet has
// paid for, and a locked one is a door into the store rather than a dead chip.
//
// Catalogue and wallet are read once and kept here: the panel repaints on every
// colour change and player join, and none of those are news about your wallet.
let pieceShelf = null;      // { items, owned, equipped } once it has loaded
let pieceLoading = null;    // the flight in progress, so two renders share one
let pieceColor = '#888';    // the disc wears your colour, same as the board

function loadPieceShelf(token, force = false) {
  if (pieceShelf && !force) return Promise.resolve(pieceShelf);
  if (pieceLoading && !force) return pieceLoading;
  pieceLoading = Promise.all([
    fetch(api('/api/store')).then((r) => r.json()),
    fetch(api(`/api/wallet?token=${encodeURIComponent(token)}`)).then((r) => r.json()),
  ]).then(([store, wallet]) => {
    pieceShelf = {
      items: (store.items || []).filter((i) => i.kind === 'token'),
      owned: wallet.owned || [],
      equipped: wallet.equipped?.token || '',
    };
    return pieceShelf;
  }).catch(() => null).finally(() => { pieceLoading = null; });
  return pieceLoading;
}

function pieceRowHTML() {
  if (!pieceShelf) return '';   // still in the air — paintPieces fills it in
  // A skin this catalogue doesn't sell — an id from an older shelf, or a
  // newer client's — comes out of the server as no emoji at all, which is a
  // plain disc on the board. So the disc is what wears the ring, and one
  // chip is always the answer to "which one am I?".
  const worn = pieceShelf.items.some((i) => i.id === pieceShelf.equipped) ? pieceShelf.equipped : '';
  const chip = (i) => {
    const owned = pieceShelf.owned.includes(i.id);
    return `<button class="piece-chip ${owned ? '' : 'locked'} ${worn === i.id ? 'sel' : ''}"
        data-piece="${i.id}" data-owned="${owned ? 1 : 0}"
        title="${escapeHtml(i.name)}${owned ? '' : ` — ${i.price} coins`}">
        <span class="pc-face">${i.emoji}</span>
        ${owned ? '' : `<span class="pc-price">${icon('coin', 10)}${i.price}</span>`}
      </button>`;
  };
  return `<div class="look-label">Piece</div>
    <div class="piece-row">
      <button class="piece-chip ${worn ? '' : 'sel'}" data-piece="" data-owned="1" title="Plain disc">
        <span class="pc-disc" style="background:${pieceColor}"></span>
      </button>
      ${pieceShelf.items.map(chip).join('')}
    </div>`;
}

/**
 * The shop opens at its top, and on a phone that leaves the piece you tapped
 * a scroll below the fold — a door onto the wrong shelf. Nudge the card into
 * view by the smallest amount that does it, so on a laptop, where it is
 * already there, the coin balance in the shop's head stays on screen.
 */
function showPieceInStore(itemId) {
  const sheet = $('#modalRoot .modal');
  const card = sheet?.querySelector(`.store-card[data-item="${itemId}"]`);
  if (!card) return;
  const s = sheet.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  if (c.bottom > s.bottom) sheet.scrollTop += c.bottom - s.bottom + 16;
  else if (c.top < s.top) sheet.scrollTop += c.top - s.top - 16;
}

/** Draw the strip into whatever panel is on screen and wire its chips. */
function paintPieces(el, token) {
  const strip = $('#pieceStrip', el);
  if (!strip) return;
  if (!pieceShelf) {
    // First lobby of the session: fetch, then come back and paint. A panel
    // that has been replaced in the meantime is simply no longer here.
    loadPieceShelf(token).then((shelf) => { if (shelf) paintPieces(el, token); });
    return;
  }
  strip.innerHTML = pieceRowHTML();

  // Once the shelf is longer than the three rows the strip shows, the piece
  // you are wearing can be sitting below them — and "which one am I?" is the
  // first thing this strip has to answer. Scroll it up into the rows, by the
  // least that does it; a shelf that fits never moves.
  const row = $('.piece-row', strip);
  const ring = $('.piece-chip.sel', strip);
  if (row && ring) {
    const r = row.getBoundingClientRect();
    const w = ring.getBoundingClientRect();
    if (w.bottom > r.bottom) row.scrollTop += w.bottom - r.bottom + 4;
    else if (w.top < r.top) row.scrollTop += w.top - r.top - 4;
  }

  strip.querySelectorAll('[data-piece]').forEach((b) => {
    b.onclick = async () => {
      sfx.click();
      const id = b.dataset.piece;
      if (b.dataset.owned !== '1') {
        // Not bought yet. The shop re-reads the wallet every time it repaints,
        // so its callback is also the moment a just-bought piece exists here.
        openStoreModal(token, (coins) => {
          setCoins(coins);
          showPieceInStore(id);
          loadPieceShelf(token, true).then(() => paintPieces(el, token));
        });
        return;
      }
      if (pieceShelf.equipped === id) return;   // already the one you're wearing

      // Ring it gold now — the choice is made here, not when the network
      // agrees. The board wears the piece the next time the server dresses
      // it: today that is the join handler, because the equip route looks for
      // a roomId on the profile and presence keeps that in a map of its own.
      const worn = pieceShelf.equipped;
      pieceShelf.equipped = id;
      paintPieces(el, token);
      try {
        const res = await fetch(api('/api/store/equip'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, slot: 'token', itemId: id || null }),
        }).then((r) => r.json());
        if (res.error) throw new Error(res.error);
      } catch {
        pieceShelf.equipped = worn;             // put the ring back where it was
        paintPieces(el, token);
        toast('Could not change your piece', 'error');
      }
    };
  });
}

/** Name, piece, colour and flag — the one part of any lobby every player owns. */
function lookPanel(state, meId) {
  const me = state.players.find((p) => p.id === meId);
  pieceColor = me?.color || '#888';
  // Nobody to dress: somebody watching from the rail, or at a full table,
  // has no piece on this board for a name, a colour or a flag to go on.
  if (!me) return '';
  return `<div class="panel">
      <div class="panel-title">Your look</div>
      <input id="nameField" class="name-field" value="${escapeHtml(me?.name || '')}" maxlength="16" placeholder="Nickname" />
      <div id="pieceStrip">${pieceRowHTML()}</div>
      <div class="look-label">Colour</div>
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
  // The seat's own id IS the wallet token — the server hands both out as one.
  paintPieces(el, meId);
}

/**
 * The phrases a Play-now table's roll is told in, in the server's reading
 * order (quickRollParts), each paired with the setting it describes — so a
 * chip can say which rule it is when the host has moved it off the roll.
 * What a bankruptcy does with the streets is rolled too (1.0.7), and is the
 * last phrase.
 */
const QUICK_PART_KEYS = ['mapId', 'startingCash', 'x2rent', 'vacationCash', 'auction', 'noRentInPrison', 'evenBuild', 'bankruptProperties'];

/** The five house rules a Play-now table rolls, as the settings name them. */
const ROLLED_RULES = ['x2rent', 'vacationCash', 'auction', 'noRentInPrison', 'evenBuild'];

/**
 * What a matchmade table dealt itself. Nobody sitting at one picked the board
 * or the rules, so the least it can do is show them before the dice start —
 * in the server's own words, so a phone at the same table reads the same
 * table. Whatever the host has since moved off the roll wears the accent's
 * ring and is counted in the heading, so a stranger can see which rules a
 * person chose and which the dice did.
 */
function rolledChipsHTML(state) {
  const parts = state.quickRoll?.parts || [];
  const edited = new Set(state.quickRoll?.edited || []);
  return `<div class="rolled-rules">${parts.map((p, i) => {
    const changed = edited.has(QUICK_PART_KEYS[i]);
    return `<span class="rolled-chip${changed ? ' edited' : ''}"${changed ? ' title="Changed by the host"' : ''}>${escapeHtml(p)}</span>`;
  }).join('')}</div>`;
}

function rolledHeading(state) {
  const n = state.quickRoll?.edited?.length || 0;
  return n ? `This table's rules · host changed ${n}` : 'This table rolled';
}

function rolledRulesHTML(state) {
  if (!state.quickRoll?.parts?.length) return '';
  return `<div class="panel">
      <div class="panel-title">${icon('dice')} ${rolledHeading(state)}</div>
      ${rolledChipsHTML(state)}
    </div>`;
}

/** One on/off rule as a lobby row — the private lobby's and the Play-now one's. */
function toggleRow(state, d, dis) {
  return `<div class="setting">
      <span class="s-icon">${icon(d.icon)}</span>
      <div class="s-body"><div class="s-name">${d.name}</div><div class="s-desc">${d.desc}</div></div>
      <label class="switch">
        <input type="checkbox" data-set="${d.key}" ${state.settings[d.key] ? 'checked' : ''} ${dis} />
        <span class="track"></span><span class="thumb"></span>
      </label>
    </div>`;
}

/** Every lobby control that names a setting sends it the same way. */
function wireSettingInputs(root, actions) {
  root.querySelectorAll('[data-set]').forEach((input) => {
    if (input.disabled) return;
    input.onchange = () => {
      const key = input.dataset.set;
      let value = input.type === 'checkbox' ? input.checked : input.value;
      if (['maxPlayers', 'startingCash', 'turnSeconds', 'timeLimit'].includes(key)) value = Number(value);
      sfx.click();
      actions.settings({ [key]: value });
    };
  });
}

const STARTING_CASH = [500, 1000, 1500, 2000, 2500, 3000, 5000];
const cashOptions = (current) => {
  const n = Number(current) || 0;
  return STARTING_CASH.includes(n) ? STARTING_CASH : [...STARTING_CASH, n].sort((a, b) => a - b);
};

/**
 * A Play-now table's rules: the chips it rolled, then the controls under
 * them. Its host may change exactly what the server lists in `editable` —
 * the money, the board, the five house rules the table rolled and, since
 * 1.0.7, where a bankrupt player's streets go — from the same rows a private
 * host uses. Everything else a stranger sat down under is shown locked, and
 * everybody else reads every row switched off. A board is never rented here
 * (see paintBoards).
 */
function quickRulesHTML(state, meId) {
  const q = state.quickLobby;
  const isHost = state.hostId === meId;
  const can = (k) => isHost && (q.editable || []).includes(k);
  const dis = (k) => (can(k) ? '' : 'disabled');
  const rolled = RULES.filter((d) => ROLLED_RULES.includes(d.key));
  const fixed = RULES.filter((d) => !ROLLED_RULES.includes(d.key));
  return `<div class="panel quick-rules" id="quickRules">
      <div class="panel-title">${icon('dice')} ${rolledHeading(state)}</div>
      ${rolledChipsHTML(state)}
      <div class="qr-note">${isHost
        ? 'You can change the money, the board and these six rules. Changing one un-readies everyone so they can read it.'
        : 'The host can change the money, the board and these six rules — and a change un-readies everyone, so you get to read it first.'}</div>
      <div class="setting board-setting">
        <div class="s-body">
          <div class="s-name">${icon('map')} Board</div>
          <div class="s-desc">${can('mapId') ? 'Today\'s free boards, or any board you own.' : 'The host picks the board.'}</div>
        </div>
        <div id="boardPick" class="board-pick"></div>
      </div>
      <div class="setting">
        <span class="s-icon">${icon('cash')}</span>
        <div class="s-body"><div class="s-name">Starting cash</div><div class="s-desc">Lower cash means faster, meaner games</div></div>
        <select data-set="startingCash" ${dis('startingCash')}>
          ${cashOptions(state.settings.startingCash).map((n) => `<option value="${n}" ${Number(state.settings.startingCash) === n ? 'selected' : ''}>$${n}</option>`).join('')}
        </select>
      </div>
      ${rolled.map((d) => toggleRow(state, d, dis(d.key))).join('')}
      ${estateRow(state, dis('bankruptProperties'))}
      <div class="qr-locked">
        <div class="look-label">${icon('key')} Set by Play now</div>
        ${fixed.map((d) => toggleRow(state, d, 'disabled')).join('')}
        <div class="setting">
          <span class="s-icon">${icon('snooze')}</span>
          <div class="s-body"><div class="s-name">Turn timer</div>
            <div class="s-desc">A timeout costs karma, so strangers keep the clock they sat down under</div></div>
          <span class="qr-value">${clockOptionLabel(Number(state.settings.turnSeconds) || 0)}</span>
        </div>
        <div class="s-desc qr-foot">${state.settings.maxPlayers} public seats, and house players take any seat nobody does — matchmaking stands on them.</div>
      </div>
    </div>`;
}

/**
 * A Play-now table between the tap and the deal. Nobody picked this table,
 * so the panel is about who has turned up and what they are about to play
 * by: the seats, with the host marked and everybody's Ready beside them, and
 * then the rules. A server from before the Ready round sends no
 * `quickLobby`, and gets the panel it always had.
 */
function renderQuickLobby(state, meId, el, actions) {
  const lobby = state.quickLobby;
  const seats = state.settings.maxPlayers;
  const open = Math.max(0, seats - state.players.length);
  // The host starts the table rather than readying for it, so the host's
  // row says so; everybody else's says whether they are ready yet.
  const seatNote = (p) => {
    if (!lobby) return '';
    if (p.id === state.hostId) return `<i class="tag host">${icon('crown')} HOST</i>`;
    return p.ready
      ? `<span class="qs-ready" title="Ready">${TICK}</span>`
      : '<span class="qs-wait">not ready</span>';
  };
  el.innerHTML = `
    <div class="panel">
      <div class="panel-title">${icon('bolt')} Quick Play</div>
      <div class="quick-blurb">${lobby
        ? 'A public table with whoever is online. When the search ends the host starts it once everyone is ready — or it deals itself in when the clock in the middle runs out.'
        : `A public table with whoever is online. It deals itself in as soon as the seats fill${state.quickStartAt ? ', or when the countdown runs out' : ''}.`}</div>
      <div class="quick-seats">
        ${state.players.map((p) => `<div class="quick-seat">
          <span class="avatar sm ${p.avatar ? 'has-skin' : ''}" style="background:${p.color}">${escapeHtml(p.avatar || (p.name[0] || '?').toUpperCase())}</span>
          <span class="qs-name">${escapeHtml(p.name)}</span>
          ${levelChip(p.level, 'seat')}
          ${p.id === meId ? '<i class="tag you">YOU</i>' : ''}
          ${seatNote(p)}
        </div>`).join('')}
        ${Array.from({ length: open }, () => `<div class="quick-seat open">
          <span class="avatar sm ghost-seat">+</span>
          <span class="qs-name dim">${lobby?.backfillAt ? 'Finding a player…' : 'Open seat'}</span>
        </div>`).join('')}
      </div>
      <div class="dim small">${state.players.length} of ${seats} seated</div>
    </div>
    ${lobby ? quickRulesHTML(state, meId) : rolledRulesHTML(state)}
    ${lookPanel(state, meId)}`;
  wireLookPanel(state, meId, el, actions);
  if (!lobby) return;
  const rules = $('#quickRules', el);
  wireSettingInputs(rules, actions);
  wirePickers(rules, actions);
  const mayPickBoard = state.hostId === meId && (lobby.editable || []).includes('mapId');
  paintBoards(state, rules, meId, actions, mayPickBoard, false);
}

// The turn clock, in the lengths a table actually picks. The iOS sheet offers
// a 3-minute setting too, so a room set from a phone keeps whatever it was
// given rather than silently reading back as the first option in this list.
const TURN_CLOCKS = [0, 30, 60, 90, 120];
const clockOptionLabel = (n) => (n === 0 ? 'Off' : n >= 120 ? `${n / 60} min` : `${n}s`);
const turnClockOptions = (current) => {
  const n = Math.floor(Number(current) || 0);
  return TURN_CLOCKS.includes(n) ? TURN_CLOCKS : [...TURN_CLOCKS, n].sort((a, b) => a - b);
};

// How well the house players the host adds play (1.0.6). The words under the
// picker change with it, because "Hard" means nothing until it says what a
// hard bot does differently — and those are the things a player will notice.
const BOT_LEVELS = [
  { id: 'easy', name: 'Easy', desc: 'House players buy cautiously, bid low and never start a trade' },
  { id: 'normal', name: 'Normal', desc: 'House players play the way they always have' },
  { id: 'hard', name: 'Hard', desc: 'House players buy almost everything, race to three houses and bid to stop the leader' },
];
/** The table's bot skill, read as normal from a server that has never heard of it. */
const botLevelOf = (state) => BOT_LEVELS.find((b) => b.id === state.settings?.botLevel) || BOT_LEVELS[1];

/**
 * Whether this table has house players for a bot skill to be about (1.0.7):
 * one is sitting at it, or — in the lobby — the host's Allow bots switch will
 * fill an empty chair with one at the deal. A switch with every chair taken
 * by people deals nobody in, so it does not count. Without either, a "Bot
 * skill" picker is a question about players who are not there, and it read
 * as one. The same rule as the phones' (hasHouseBots / showsBotSkill).
 */
const houseAtTable = (state) => (state.players || []).some((p) => p.isBot)
  || (state.status === 'lobby' && !!state.settings?.allowBots
    && (state.players || []).length < (Number(state.settings.maxPlayers) || 0));

// The whole game's clock, in minutes; 0 is no clock at all. A server sends
// only these five, so there is no odd value to keep the way the turn clock does.
const GAME_LENGTHS = [0, 20, 30, 45, 60];
const gameLengthLabel = (n) => (n ? `${n} min` : 'Unlimited');

// The bot skill card comes up when the first house player sits down, and it
// arrives rather than just being there — once, as it appears, not on every
// repaint of the seats while it stays.
let botRowWas = '';
let botAddedAt = 0;

/** Whether the seats carry the bot skill card (see botSkillCard). */
const botSkillShown = (state) => state.status === 'lobby' && !state.quick && !state.cup && houseAtTable(state);

/**
 * Bot skill, under the seats it is about (1.0.7): the first "Add bot" brings
 * it, and removing the last house player takes it away again — a "Bot skill"
 * picker over a table of people only was a question about nobody, and it
 * read as one. A Play-now table's house players always play the usual way
 * and a cup has none, so it is never drawn at either (the server refuses the
 * change there anyway). Everybody but the host reads it switched off.
 */
function botSkillCard(state, meId) {
  const shown = botSkillShown(state);
  const key = shown ? state.id : '';
  const arriving = shown && botRowWas !== key;
  botRowWas = key;
  if (!shown) return '';
  const bots = botLevelOf(state);
  const dis = state.hostId === meId ? '' : 'disabled';
  return `
      <div class="bot-skill${arriving ? ' arriving' : ''}">
        <div class="bsk-head"><span class="s-icon">${icon('robot')}</span><b>Bot skill</b>
          <span>${state.players.some((p) => p.isBot) ? 'for the house players at this table' : 'for the house players Allow bots deals in'}</span></div>
        <div class="chat-channels seg3 bot-seg" role="radiogroup" aria-label="Bot skill">${BOT_LEVELS.map((b) => `
          <button type="button" role="radio" data-bot="${b.id}" class="${b.id === bots.id ? 'on' : ''}"
            aria-checked="${b.id === bots.id}" ${dis}>${b.name}</button>`).join('')}
        </div>
        <div class="s-desc">${bots.desc}</div>
      </div>`;
}

/**
 * Game length as a lobby row. A Play-now table keeps the clock it was matched
 * under, and a cup sets its own table, so it is not drawn at either.
 */
function gameLengthRow(state, dis) {
  if (state.quick || state.cup) return '';
  const minutes = Number(state.settings.timeLimit) || 0;
  return `
      <div class="setting">
        <span class="s-icon">${icon('clock')}</span>
        <div class="s-body"><div class="s-name">Game length</div>
          <div class="s-desc">${minutes
            ? 'When the clock runs out, the richest player wins'
            : 'Play on until one player is left standing'}</div></div>
        <select data-set="timeLimit" ${dis}>
          ${GAME_LENGTHS.map((n) => `<option value="${n}" ${minutes === n ? 'selected' : ''}>${gameLengthLabel(n)}</option>`).join('')}
        </select>
      </div>`;
}

// What happens to a bankrupt player's properties: back to the bank or under
// the hammer (1.0.6), or — since 1.0.7 — the bankrupt player's own call. A
// list like the bot skill rather than a switch, because "off" would not say
// which of the three a table is doing, and the words under it are the rule
// itself. `value` is how the rules sheet prints it.
const ESTATE_RULES = [
  { id: 'release', name: 'Back to the bank', value: 'Back to the bank',
    desc: 'A bankrupt player’s properties go back to the bank, unowned' },
  { id: 'auction', name: 'Auction them', value: 'Auctioned',
    desc: 'A bankrupt player’s properties are auctioned to everyone, one by one' },
  { id: 'choose', name: 'Player decides', value: 'Player decides',
    desc: 'The player who goes bankrupt picks: back to the bank, or auction' },
];
/**
 * The estate rule this table plays. A cup always sends estates back to the
 * bank whatever the field says, and so does a server that has never heard of
 * the setting. A Play-now table plays what it rolled (1.0.7).
 */
const estateRuleOf = (state) => (state?.cup ? ESTATE_RULES[0]
  : ESTATE_RULES.find((r) => r.id === state?.settings?.bankruptProperties) || ESTATE_RULES[0]);
/** 'release', 'auction' or 'choose' — where a seat's streets go when it leaves the game. */
export const estateRule = (state) => estateRuleOf(state).id;

/**
 * Bankrupt properties as a lobby row: the three ways side by side across the
 * row, and the one in force spelled out under them. The same row at a
 * private table and, for its host, at a Play-now one (1.0.7) — wherever the
 * server lets the host change it; everyone else reads it switched off.
 */
function estateRow(state, dis) {
  const estate = estateRuleOf(state);
  return `
      <div class="setting stacked estate-setting">
        <span class="s-icon">${icon('skull')}</span>
        <div class="s-body"><div class="s-name">Bankrupt properties</div></div>
        <div class="chat-channels seg3 bot-seg estate-seg" role="radiogroup" aria-label="Bankrupt properties">${ESTATE_RULES.map((r) => `
          <button type="button" role="radio" data-estate="${r.id}" class="${r.id === estate.id ? 'on' : ''}"
            aria-checked="${r.id === estate.id}" ${dis}>${r.name}</button>`).join('')}
        </div>
        <div class="s-desc estate-desc">${estate.desc}</div>
      </div>`;
}

/**
 * The pickers answer when the state says the table changed, not under the
 * finger: a refused change sends no new state, and a lozenge moved ahead of
 * the server would be left sitting on a side the table does not have.
 */
function wirePickers(root, actions) {
  root.querySelectorAll('[data-bot]').forEach((b) => {
    if (b.disabled) return;
    b.onclick = () => {
      if (b.classList.contains('on')) return;
      sfx.click();
      actions.settings({ botLevel: b.dataset.bot });
    };
  });
  root.querySelectorAll('[data-estate]').forEach((b) => {
    if (b.disabled) return;
    b.onclick = () => {
      if (b.classList.contains('on')) return;
      sfx.click();
      actions.settings({ bankruptProperties: b.dataset.estate });
    };
  });
}

/**
 * Auction only, as a lobby row that sits straight under Auction: the two are
 * one decision — turning it on turns auctions on, and turning auctions off
 * turns it off, both on the server — so they read as a pair, and each row is
 * drawn from state.settings as it is, never from the tap.
 */
function auctionOnlyRow(state, dis) {
  if (state.quick || state.cup) return '';
  const on = !!state.settings.auctionOnly;
  return toggleRow(state, {
    key: 'auctionOnly', icon: 'gavel', name: 'Auction only',
    desc: on ? 'Nobody buys at the printed price — every unowned street goes straight to auction'
      : 'Land on an unowned street and you may buy it at its price first',
  }, dis);
}

/**
 * The other two house rules of 1.0.6 round 2: a shuffled board and what a
 * bankruptcy does with the streets. Neither is drawn here at a Play-now or a
 * cup table: both play the printed board, a cup sends estates back to the
 * bank, and a Play-now table shows its estate rule with the rules it rolled
 * (see quickRulesHTML).
 */
function houseRuleRows(state, dis) {
  if (state.quick || state.cup) return '';
  const shuffle = !!state.settings.shuffleBoard;
  return `
      ${toggleRow(state, {
        key: 'shuffleBoard', icon: 'map', name: 'Shuffle the board',
        desc: shuffle ? 'The colour sets are dealt to new places at the start — prices and rents move with them'
          : 'Every street sits where the board prints it',
      }, dis)}
      ${estateRow(state, dis)}`;
}

/**
 * The lobby headline's half-line about how this game will be played, for
 * the people who cannot open the settings: the clock, a bot skill other
 * than the usual when there are bots to have it, and the two house rules
 * that change what the board in front of them is about to do — the lobby
 * shows the printed board, and a shuffle only happens at the deal.
 */
function lobbyTerms(state) {
  if (state.quick || state.cup) return '';
  const parts = [];
  const minutes = Number(state.settings?.timeLimit) || 0;
  if (minutes) parts.push(`${minutes}-minute game`);
  const bots = botLevelOf(state);
  if (bots.id !== 'normal' && houseAtTable(state)) parts.push(`${bots.name} bots`);
  if (state.settings?.shuffleBoard) parts.push('Shuffled board');
  if (state.settings?.auctionOnly) parts.push('Auction only');
  return parts.map((p) => ` · ${p}`).join('');
}

function renderSettings(state, meId, el, actions) {
  const isHost = state.hostId === meId;
  // A cup table is set by the cup: two seats, no bots, nothing to argue over.
  // The server refuses all of it anyway; this is so nobody is invited to try.
  const dis = isHost && !state.cup ? '' : 'disabled';
  const toggle = (d) => toggleRow(state, d, dis);

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
      <div class="setting board-setting">
        <div class="s-body">
          <div class="s-name">${icon('map')} Board</div>
          <div class="s-desc">Two boards are free every day. The rest are yours once you buy them.</div>
        </div>
        <div id="boardPick" class="board-pick"></div>
      </div>
      <div class="setting">
        <span class="s-icon">${icon('cash')}</span>
        <div class="s-body"><div class="s-name">Starting cash</div><div class="s-desc">Lower cash means faster, meaner games</div></div>
        <select data-set="startingCash" ${dis}>
          ${cashOptions(state.settings.startingCash).map((n) => `<option value="${n}" ${Number(state.settings.startingCash) === n ? 'selected' : ''}>$${n}</option>`).join('')}
        </select>
      </div>
      <div class="setting">
        <span class="s-icon">${icon('snooze')}</span>
        <div class="s-body"><div class="s-name">Turn timer</div>
          <div class="s-desc">Run out of time and the table moves on without you</div></div>
        <select data-set="turnSeconds" ${dis}>
          ${turnClockOptions(state.settings.turnSeconds).map((n) =>
            `<option value="${n}" ${Number(state.settings.turnSeconds) === n ? 'selected' : ''}>${clockOptionLabel(n)}</option>`).join('')}
        </select>
      </div>
      ${gameLengthRow(state, dis)}
    </div>

    <div class="panel">
      <div class="panel-title">Gameplay rules</div>
      ${RULES.map((d) => toggle(d) + (d.key === 'auction' ? auctionOnlyRow(state, dis) : '')).join('')}
      ${houseRuleRows(state, dis)}
    </div>

    ${isHost ? `
      <div class="stack">
        <button class="btn primary big" id="startBtn">${icon('dice')} Start Game</button>
        ${state.cup ? '' : '<button class="btn wide ghost" id="botBtn">＋ Add a bot</button>'}
      </div>`
      : '<div class="panel waiting"><span class="pulse-dot"></span> Waiting for the host to start…</div>'}
  `;

  wireSettingInputs(el, actions);
  wirePickers(el, actions);
  wireLookPanel(state, meId, el, actions);
  // A cup fixes its own board; the server refuses the change either way.
  paintBoards(state, el, meId, actions, isHost && !state.cup);
  const balanceBtn = $('#balanceBtn', el);
  if (balanceBtn) balanceBtn.onclick = () => { sfx.click(); actions.balanceTeams(); };
  const startBtn = $('#startBtn', el);
  if (startBtn) startBtn.onclick = () => actions.start();
  const botBtn = $('#botBtn', el);
  if (botBtn) botBtn.onclick = () => { sfx.click(); botAddedAt = Date.now(); actions.addBot(); };
}

/**
 * Whether "Ask for it" can go out for deed `i`: the game is on, this seat is
 * still in it, and the deed sits with somebody else who is still in it too and
 * is free to change hands. The "1 away" row and the deed card both ask here,
 * so the one-tap trade turns up in exactly the same situations from either —
 * and never for a deed the server would only answer with a refusal.
 */
function canAskFor(state, meId, i) {
  if (state.status !== 'playing') return false;
  const me = state.players.find((p) => p.id === meId);
  const holder = state.players.find((p) => p.id === state.ownership[i]?.owner);
  if (!me || isOut(me) || !holder || holder.id === meId || isOut(holder)) return false;
  return !tradeLocked(state, i);
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
  return `<div class="one-away">
      <span>1 away — <b>${name}</b> is with ${escapeHtml(holder.name)}</span>
      ${canAskFor(state, meId, i) ? `<button class="btn tiny gold" data-ask="${i}" data-ask-to="${escapeHtml(holder.id)}">Ask for it</button>` : ''}
    </div>`;
}

/**
 * Where an open debt streams to, written the way a sentence needs it: the
 * creditor's coloured name, the still-owed players of a payEach split, or
 * plain "the bank" when the money simply leaves the game.
 */
function debtDestination(state, d) {
  const names = (d.owedTo || [])
    .map((id, k) => ({ p: state.players.find((x) => x.id === id), left: d.owedLeft?.[k] ?? 0 }))
    .filter((r) => r.p && !r.p.bankrupt && r.left > 0)
    .map((r) => `<b style="color:${r.p.color}">${escapeHtml(r.p.name)}</b>`);
  if (names.length > 1) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  if (names.length === 1) return names[0];
  const creditor = d.creditor ? state.players.find((x) => x.id === d.creditor) : null;
  return creditor ? `<b style="color:${creditor.color}">${escapeHtml(creditor.name)}</b>` : 'the bank';
}

/**
 * Owing money turns the panel into a scavenger hunt through your own deeds.
 * The wallet is the ledger now — the red on it is exactly what is still owed,
 * and every dollar raised streams straight through — so this puts the climb
 * that is left on top and the biggest levers under it.
 */
function raiseCashPanel(state, meId) {
  const d = state.turn?.phase === 'debt' ? state.turn.debt : null;
  if (state.status !== 'playing' || !d || d.debtor !== meId) return '';

  const owed = Math.max(0, -(state.players.find((p) => p.id === meId)?.money || 0));

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

  const head = owed === 0
    ? '<div class="raise-line good-text">You\'re square — the turn carries on.</div>'
    : `<div class="raise-line">Everything you raise goes straight to ${debtDestination(state, d)}
         until you're square — <b class="bad-text">${money(-owed)}</b> still to climb.</div>`;

  const list = moves.length
    ? moves.slice(0, 8).map((m) => `<div class="raise-row">
        <span class="raise-what">${icon(m.icon)} ${escapeHtml(m.what)}</span>
        <button class="btn tiny gold" data-${m.attr}="${m.i}">+${money(m.value)}</button>
      </div>`).join('')
    : '<div class="empty small">Nothing left to sell or mortgage — a trade is the only way out.</div>';

  // Say it straight when the deeds don't add up: a hopeful list would only
  // waste the taps that are left.
  const foot = owed > 0 && reach < owed
    ? `<div class="raise-line dim small">Everything above adds up to ${money(reach)} — you will need a trade to close the gap.</div>`
    : '';

  return `<div class="panel raise-panel">
      <div class="panel-title">${icon('payment')} ${owed > 0 ? `You're ${money(owed)} in the red` : 'Back in the black'}</div>
      ${head}
      ${owed > 0 ? list : ''}
      ${owed > 0 ? foot : ''}
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

/**
 * The side panel for somebody with no seat at the table — a watcher (1.0.6),
 * or anyone who arrived at a game already under way. "Your properties" with
 * nothing in it told them to go and buy a street they had no way to buy;
 * this says what they are looking at instead, and how to leave it.
 */
function watchPanelHTML(state) {
  const others = Math.max(0, (Number(state.spectators) || 0) - 1);
  return `<div class="panel watch-panel">
      <div class="panel-title">${icon('eye')} Watching</div>
      <div class="dim small">${state.status === 'ended'
        ? 'This game is over. The standings are on the board and in the result sheet.'
        : 'Every move here is live. Nothing on the board is yours to touch, and the players only see how many people are watching, not who.'}</div>
      ${others ? `<div class="dim small wp-count">${others === 1 ? 'One other person is' : `${others} other people are`} watching too</div>` : ''}
      <button class="btn ghost small wide" id="watchHome" type="button">${icon('door')} Back to home</button>
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
            ? (live && state.settings.mortgage && state.turn?.playerId === meId ? `<button class="btn tiny gold" data-unmort="${m.i}" title="Buy back for $${Math.ceil((t.price / 2) * 1.1)}">↺</button>` : '')
            : (live && canMortgage(state, meId, m.i) ? `<button class="btn tiny" data-mort="${m.i}" title="Mortgage for $${Math.floor(t.price / 2)}">${icon('bank', null, 'solo')}</button>` : '')}
        </span>
      </div>`;
    }).join('');
    return `<div class="group-head ${complete ? 'complete' : ''}">${title}${complete ? '<i>FULL SET</i>' : ''}</div>${rows}${oneAwayRow(state, meId, key)}`;
  }).join('');

  // Trades, top to bottom: the offers waiting on you (one panel, however
  // many), the ones you sent, then everybody else's (1.0.6) — what you can
  // answer first, what you can only read last.
  el.innerHTML = `
    ${raiseCashPanel(state, meId)}
    ${deadlockPanel(state, meId)}
    ${offersPanelHTML(state, meId)}
    ${sentOffersHTML(state, meId)}
    ${tableTradesHTML(state, meId)}

    ${me ? `<div class="panel">
      <div class="panel-title">Your properties</div>
      ${mine.length ? sections : `<div class="empty">${
        isOut(me) ? `You are out of this game and watching from the rail now ${icon('eye')}`
          : state.status === 'ended' ? 'You finished with nothing on the board.'
          : 'Nothing owned yet — land on a street and buy it.'}</div>`}
    </div>` : watchPanelHTML(state)}

    ${state.settings.vacationCash ? `<div class="panel pot">
      <div class="panel-title">Vacation pot</div>
      <div class="pot-amount">${money(state.vacationPot)}</div>
    </div>` : ''}

    ${state.status === 'ended' && !state.cup
      ? (state.quick
        ? `<button class="btn primary wide wrap" id="againBtn">${icon('replay')} Play again</button>`
        // A rematch is the seated players' to call; from the rail the
        // server would only answer that this game is being watched.
        : me ? `<button class="btn primary wide wrap" id="rematchBtn">${icon('replay')} Play again</button>` : '')
      : ''}
  `;
  const watchHome = $('#watchHome', el);
  if (watchHome) watchHome.onclick = () => { sfx.click(); actions.goHome?.(); };

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
  // Accept, Decline, Counter, Later and Open — the same wiring the Offers
  // sheet gives the same cards.
  wireOfferButtons(el, () => livePlayersState || state, meId, actions);
  // "1 away" → the composer opens with that street already on their side.
  el.querySelectorAll('[data-ask]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      sfx.click();
      openTradeModal(state, meId, b.dataset.askTo, actions, { get: { tiles: [Number(b.dataset.ask)] } });
    };
  });
  const rb = $('#rematchBtn', el);
  if (rb) rb.onclick = () => actions.rematch();
  const ab = $('#againBtn', el);
  if (ab) ab.onclick = () => actions.newTable?.();
}

/**
 * Somebody has your offer open in front of them.
 *
 * The seconds between sending a deal and hearing back are the only part of a
 * trade with nothing in them, and they are exactly when a player decides the
 * other side is ignoring them. This is the answer to that: their piece,
 * their name, and an eye that blinks on its own — the one signal that reads
 * as a person rather than a spinner. It goes when they close the sheet,
 * whichever way they close it.
 */
function tradeViewerLine(state, t, meId) {
  const watching = (t.viewers || [])
    .filter((v) => v !== meId)
    .map((v) => state.players.find((p) => p.id === v))
    .filter(Boolean);
  if (!watching.length) return '';
  const names = watching.map((p) => escapeHtml(p.name)).join(', ');
  return `<div class="trade-viewing">
    <span class="tv-eye">${icon('eye', 15)}</span>
    <span class="tv-faces">${watching.map((p) => `<i style="background:${p.color}"></i>`).join('')}</span>
    <span class="tv-text">${names} ${watching.length > 1 ? 'are' : 'is'} reading this</span>
  </div>`;
}

/**
 * An offer you set aside, folded down to a single quiet line. It is still a
 * live offer — the sender is still waiting on it — so it keeps a face, a name
 * and a way back in, and nothing else.
 */
function setAsideRow(state, t) {
  const from = state.players.find((p) => p.id === t.from);
  return `<div class="trade-mini">
      <span class="avatar xs" style="background:${from?.color || 'var(--ink-3)'}">${escapeHtml((from?.name?.[0] || '?').toUpperCase())}</span>
      <span class="tm-text">${escapeHtml(from?.name || '')}<i>${icon('snooze', 12)} set aside</i></span>
      <button class="btn tiny" data-unignore="${t.id}">Open</button>
    </div>`;
}

/**
 * A tile's mark in a trade, the one the board wears for it: a country's flag
 * on its medallion, the plane on an airport, a utility's own drawing. Anything
 * with none of those keeps its colour as a dot.
 */
function tileMark(tile, g, size) {
  if (g?.flag) return circleFlag(g.flag, g.color, size);
  if (tile.type === 'airport') return icon('airport', size);
  if (tile.type === 'utility') return icon(utilityName(tile.icon), size);
  return `<span class="dotc" style="background:${g?.color || '#7c6bb0'}"></span>`;
}

/**
 * One side of a deal drawn as the things on it: a coin for cash, a street in
 * its own colour with its own flag and price, a card for a card. A tile index
 * in a trade is a square of the board this table is playing, so it is read
 * off state.map — on a shuffled board (1.0.6) a stale copy would name the
 * wrong street.
 */
function dealChips(state, side) {
  const out = [];
  if (side.money) {
    out.push(`<span class="deal-chip cash">${icon('coin', 15)}<b>${money(side.money)}</b></span>`);
  }
  (side.tiles || []).forEach((i) => {
    const tile = state.map.tiles[i];
    if (!tile) return;
    const g = tile.group ? state.groups[tile.group] : null;
    const mark = g?.flag || tile.type === 'airport' || tile.type === 'utility'
      ? `<span class="dc-flag">${tileMark(tile, g, 16)}</span>`
      : `<i class="dc-dot" style="background:${g?.color || 'var(--ink-3)'}"></i>`;
    out.push(`<span class="deal-chip street" style="--c:${g?.color || 'var(--ink-3)'}">
      ${mark}<b>${escapeHtml(tile.name)}</b><em>$${tile.price}</em></span>`);
  });
  if (side.cards) {
    out.push(`<span class="deal-chip card">${icon('key', 14)}<b>${side.cards}× out of prison</b></span>`);
  }
  return out.length ? out.join('') : '<span class="deal-chip empty">nothing</span>';
}

/**
 * Which way an offer leans for the person it was sent to. Face value only —
 * the price on the deed, not what it is worth to whoever needs that last
 * street — and everything that prints it says so.
 */
function dealLean(state, t) {
  const worth = (side) => (side.money || 0) + (side.cards || 0) * 50
    + (side.tiles || []).reduce((sum, i) => sum + (state.map.tiles[i]?.price || 0), 0);
  const mine = worth(t.give);
  const theirs = worth(t.get);
  const diff = mine - theirs;
  const even = Math.abs(diff) < 25;
  return {
    mine,
    theirs,
    // Half the track is neutral; the needle leans as far as the gap is wide.
    lean: Math.max(-1, Math.min(1, diff / Math.max(mine, theirs, 1))),
    verdict: even ? 'An even deal' : diff > 0 ? `${money(diff)} your way` : `${money(-diff)} their way`,
    mood: even ? 'even' : diff > 0 ? 'good' : 'bad',
  };
}

/**
 * An offer folded to the size of a card in a list (1.0.6). Two or three
 * offers at once used to be two or three full panels down the rail and a
 * sheet apiece, one over the other; now each is a card — who it is from,
 * what you get and what you give as the chips the full sheet draws, which
 * way it leans, and the answers — so the third offer costs a card's height
 * rather than a screen. The rail and the Offers sheet print the same card.
 */
function offerCardHTML(state, t) {
  const from = state.players.find((p) => p.id === t.from);
  const { verdict, mood } = dealLean(state, t);
  return `<div class="offer-card" data-offer="${t.id}">
      <div class="oc-head">
        <span class="avatar xs" style="background:${from?.color || 'var(--ink-3)'}">${escapeHtml((from?.name?.[0] || '?').toUpperCase())}</span>
        <b class="oc-from">${escapeHtml(from?.name || 'Somebody')}</b>
        <span class="oc-lean ${mood}" title="Weighed by the price on the deeds">${escapeHtml(verdict)}</span>
      </div>
      <div class="oc-side good"><span class="oc-label">You get</span><div class="oc-items">${dealChips(state, t.give)}</div></div>
      <div class="oc-side bad"><span class="oc-label">You give</span><div class="oc-items">${dealChips(state, t.get)}</div></div>
      <div class="oc-actions">
        <button class="btn good small" data-accept="${t.id}">Accept</button>
        <button class="btn small" data-negotiate="${t.id}">Counter</button>
        <button class="btn ghost danger small" data-decline="${t.id}">Decline</button>
        <button class="btn ghost small oc-later" data-ignore="${t.id}" title="Keep it in the list, decide later"
          aria-label="Decide later">${icon('snooze', null, 'solo')}</button>
      </div>
    </div>`;
}

/**
 * Every offer sent to this seat, in one panel: "Offers", how many, and the
 * cards in a list that scrolls inside the panel once it holds more than two,
 * so the deeds below stay where they were however many deals land at once.
 * Offers set aside fold to a line each under the list.
 */
function offersPanelHTML(state, meId) {
  const incoming = state.trades.filter((t) => t.to === meId).sort((a, b) => a.id - b.id);
  if (!incoming.length) return '';
  const open = incoming.filter((t) => !t.ignored);
  const aside = incoming.filter((t) => t.ignored);
  return `<div class="panel trade-offer offers-panel">
      <div class="panel-title">${icon('trade')} Offers <i class="panel-n">${incoming.length}</i></div>
      ${open.length ? `<div class="offer-list${open.length > 2 ? ' scrolls' : ''}">${open.map((t) => offerCardHTML(state, t)).join('')}</div>` : ''}
      ${aside.length ? `<div class="offers-aside">${aside.map((t) => setAsideRow(state, t)).join('')}</div>` : ''}
    </div>`;
}

/**
 * One side of somebody's deal in words, each street flying its flag:
 * "Tel Aviv and $300". For the lines a reader only reads — the table's
 * trades, and what you sent.
 */
function dealWords(state, side) {
  const bits = [];
  (side.tiles || []).forEach((i) => {
    const tile = state.map.tiles[i];
    if (!tile) return;
    const g = tile.group ? state.groups[tile.group] : null;
    bits.push(`<span class="tt-street">${tileMark(tile, g, 13)}${escapeHtml(tile.name)}</span>`);
  });
  if (side.money) bits.push(`<b>${money(side.money)}</b>`);
  if (side.cards) bits.push(side.cards === 1 ? 'a get-out card' : `${side.cards} get-out cards`);
  if (bits.length < 2) return bits.join('');
  return `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;
}

/** "Tel Aviv for $300" — `give` is what the sender parts with, `get` what they ask for. */
function dealLine(state, t) {
  const give = dealWords(state, t.give);
  const get = dealWords(state, t.get);
  if (give && get) return `${give} for ${get}`;
  if (give) return `${give}, asking nothing back`;
  return get ? `asks for ${get}` : 'an empty offer';
}

/**
 * Everybody else's open offers (1.0.6). The table has always been sent every
 * trade; now it is shown them — read-only, because only the person an offer
 * is sent to can answer it and only its sender can take it back, and a
 * button the server would refuse is a button nobody should be shown. One
 * line each, "Ravi → Asha: Tel Aviv for $300". Somebody watching gets the
 * same list, which is half of what watching a table is for.
 */
function tableTradesHTML(state, meId) {
  const others = state.trades
    .filter((t) => t.from !== meId && t.to !== meId)
    .sort((a, b) => a.id - b.id);
  if (!others.length) return '';
  const who = (id) => state.players.find((p) => p.id === id);
  const face = (p) => `<span class="avatar xs" style="background:${p?.color || 'var(--ink-3)'}">${escapeHtml((p?.name?.[0] || '?').toUpperCase())}</span>`;
  const rows = others.map((t) => {
    const from = who(t.from);
    const to = who(t.to);
    const note = t.ignored ? `<i class="tt-note">${icon('snooze', 12)} set aside</i>`
      : (t.viewers || []).includes(t.to) ? `<i class="tt-note">${icon('eye', 12)} reading</i>` : '';
    return `<div class="tt-row">
        <div class="tt-who">${face(from)}<b>${escapeHtml(from?.name || '')}</b><span class="tt-arrow" aria-label="to">→</span>${face(to)}<b>${escapeHtml(to?.name || '')}</b>${note}</div>
        <div class="tt-what">${dealLine(state, t)}</div>
      </div>`;
  }).join('');
  return `<div class="panel table-trades">
      <div class="panel-title">${icon('trade')} Table trades <i class="panel-n">${others.length}</i></div>
      <div class="tt-list${others.length > 3 ? ' scrolls' : ''}">${rows}</div>
    </div>`;
}

/**
 * The offers this seat has sent, in one panel however many there are: who
 * each went to and what it says, whether they set it aside or have it open
 * in front of them, and a way to take it back.
 */
function sentOffersHTML(state, meId) {
  const outgoing = state.trades.filter((t) => t.from === meId).sort((a, b) => a.id - b.id);
  if (!outgoing.length) return '';
  return `<div class="panel offers-sent">
      <div class="panel-title">${outgoing.length > 1 ? `Offers sent <i class="panel-n">${outgoing.length}</i>` : 'Offer sent'}</div>
      ${outgoing.map((t) => {
        const name = escapeHtml(state.players.find((p) => p.id === t.to)?.name || '');
        return `<div class="sent-row">
          <div class="dim small">${t.ignored
            ? `${icon('snooze')} ${name} set it aside for later`
            : `Waiting for ${name}…`}</div>
          <div class="tt-what">${dealLine(state, t)}</div>
          ${tradeViewerLine(state, t, meId)}
          <button class="btn small wide" data-cancel="${t.id}">Cancel offer</button>
        </div>`;
      }).join('')}
    </div>`;
}

/**
 * The answers on an offer card, wherever the card is printed. Accepting or
 * declining folds the card at once — the state that removes it is a moment
 * behind — and gives it back if the server refused and nothing changed.
 * Counter opens the composer with their deal turned round, as the full
 * sheet's Negotiate does.
 */
function wireOfferButtons(root, liveState, meId, actions) {
  const answered = (b) => {
    const card = b.closest('.offer-card');
    if (!card) return;
    card.classList.add('answered');
    const keys = card.querySelectorAll('button');
    keys.forEach((k) => { k.disabled = true; });
    setTimeout(() => {
      if (!card.isConnected) return;
      card.classList.remove('answered');
      keys.forEach((k) => { k.disabled = false; });
    }, 2500);
  };
  const each = (attr, fn) => root.querySelectorAll(`[data-${attr}]`).forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); fn(Number(b.dataset[attr]), b); };
  });
  each('accept', (id, b) => { sfx.trade(); answered(b); actions.respondTrade(id, true); });
  each('decline', (id, b) => { sfx.click(); answered(b); actions.respondTrade(id, false); });
  each('ignore', (id) => { sfx.click(); actions.ignoreTrade(id, true); });
  each('unignore', (id) => { sfx.click(); actions.ignoreTrade(id, false); });
  each('negotiate', (id) => {
    sfx.click();
    const s = liveState();
    const t = s?.trades.find((x) => x.id === id);
    // Counter their offer: same deal, seen from this side of the table.
    if (t) openTradeModal(s, meId, t.from, actions, { give: t.get, get: t.give, counterOf: t.id });
  });
}

/**
 * An offer, put in front of you instead of down the page.
 *
 * The rail card below the board says all of this too, and on a desktop that is
 * where a deal is read. On a phone the rail is a scroll away past the chat, so
 * an offer could sit there for a whole turn without the person it was sent to
 * ever knowing — the sender waiting on an answer that was never seen.
 *
 * What is on the table is the thing worth showing, so it is shown as things:
 * a coin for cash, a street with its own colour and flag, a card for a card.
 * A line of text saying "$350 · Venice · 1× prison card" is a receipt; this is
 * an offer. The meter underneath weighs the two sides by the price printed on
 * the deeds — which is not what a street is worth to the person who needs it,
 * and says so rather than pretending to advise.
 *
 * The cross closes it without touching the deal: it stays live on the rail,
 * and this sheet will not reopen for the same offer. If the deal goes away
 * underneath it — withdrawn, or its sender out of the game — the sheet goes
 * with it rather than offering an Accept the server can only refuse; a second
 * offer arriving turns it into the Offers list (see app.js).
 */
export function openTradeOfferModal(state, t, meId, actions, onDismiss) {
  const from = state.players.find((p) => p.id === t.from);
  if (!from) return;

  const { mine, theirs, lean, verdict, mood } = dealLean(state, t);

  const seat = (player, label, cls, total, side) => `
    <div class="deal-side ${cls}">
      <div class="ds-head">
        <span class="ds-label">${label}</span>
        <span class="ds-total">${money(total)}</span>
      </div>
      <div class="ds-items">${dealChips(state, side)}</div>
      <div class="ds-who">
        <span class="avatar xs" style="background:${player.color}">${escapeHtml((player.name[0] || '?').toUpperCase())}</span>
        from ${player.id === meId ? 'you' : escapeHtml(player.name)}
      </div>
    </div>`;

  const me = state.players.find((p) => p.id === meId) || { name: 'You', color: 'var(--ink-3)' };

  openModal(`
    <div class="offer-top">
      <span class="offer-avatar" style="--c:${from.color}">${escapeHtml((from.name[0] || '?').toUpperCase())}</span>
      <div class="offer-title">
        <h2>${escapeHtml(from.name)} wants to trade</h2>
        <p class="sub">Their offer is on the table.</p>
      </div>
      <button class="sheet-x" id="toClose" aria-label="Close">${icon('close')}</button>
    </div>

    <div class="deal-table">
      ${seat(from, 'You get', 'good', mine, t.give)}
      <span class="deal-swap">${icon('swap', 18)}</span>
      ${seat(me, 'You give', 'bad', theirs, t.get)}
    </div>

    <div class="deal-meter ${mood}">
      <div class="dm-track"><i class="dm-fill" style="--lean:${lean}"></i><i class="dm-notch"></i></div>
      <div class="dm-line"><b>${escapeHtml(verdict)}</b><span class="dim">by the price on the deeds</span></div>
    </div>

    <div class="offer-actions">
      <button class="btn good wide big" id="toAccept">Accept the deal</button>
      <button class="btn" id="toNegotiate">${icon('swap', 15)} Negotiate</button>
      <button class="btn ghost danger" id="toDecline">Decline</button>
    </div>
    <p class="offer-foot dim small">Closing this leaves the offer on the table — it waits under Offers.</p>`,
  (root) => {
    // A sheet nobody asked for arrives under whatever finger or cursor was
    // already on its way somewhere else, and the button it lands on accepts a
    // trade. Found on a phone: a tap meant for "Start Game" gave away a
    // street. So the three answers do nothing at all for a moment.
    const answers = [...root.querySelectorAll('#toAccept, #toDecline, #toNegotiate')];
    answers.forEach((b) => { b.disabled = true; });
    setTimeout(() => answers.forEach((b) => { b.disabled = false; }), 450);
    // The sender watches for this: the eye on their card lights while the
    // sheet is open, and goes out however it closes — button, cross, Escape,
    // or another sheet taking its place.
    actions.tradeViewing?.(t.id, true);
    onModalClose(() => {
      if (livePlayersState?.trades?.some((x) => x.id === t.id)) actions.tradeViewing?.(t.id, false);
    });
    sheetRepaint = (s) => {
      if (s?.trades?.some((x) => x.id === t.id)) return;
      closeModal();
      toast(`${from.name}’s offer is off the table`);
    };
    const retire = () => onDismiss?.(t.id);
    $('#toClose', root).onclick = () => { sfx.click(); retire(); closeModal(); };
    $('#toAccept', root).onclick = () => { sfx.trade(); retire(); closeModal(); actions.respondTrade(t.id, true); };
    $('#toDecline', root).onclick = () => { sfx.click(); retire(); closeModal(); actions.respondTrade(t.id, false); };
    $('#toNegotiate', root).onclick = () => {
      sfx.click();
      retire();
      // Their deal, seen from this side of the table, ready to be nudged.
      openTradeModal(state, meId, t.from, actions, { give: t.get, get: t.give, counterOf: t.id });
    };
  }, 'offer-sheet');
}

/**
 * Every offer waiting on you, in one sheet (1.0.6). Two offers arriving
 * together used to be two sheets — the second waiting under the first, and
 * on a phone not seen at all until the first was answered. Now a second
 * offer turns the sheet into this list: one header with the count, one card
 * per offer, scrolling once there are more than fit, each with its own
 * Accept, Counter and Decline. It follows the table while it is open — an
 * offer answered, withdrawn or newly sent is seen leaving or arriving — and
 * closes itself when the last one goes.
 */
export function openOffersModal(state, meId, actions) {
  const waiting = (s) => (s?.status === 'playing' ? s.trades || [] : [])
    .filter((t) => t.to === meId)
    .sort((a, b) => a.id - b.id);
  if (!waiting(state).length) return;
  openModal(`
    <div class="offer-top">
      <span class="offer-avatar offers-mark">${icon('trade', 22)}</span>
      <div class="offer-title">
        <h2>Offers <span class="panel-n" id="ofN"></span></h2>
        <p class="sub" id="ofSub"></p>
      </div>
      <button class="sheet-x" id="ofClose" aria-label="Close">${icon('close')}</button>
    </div>
    <div class="offers-scroll" id="ofList"></div>
    <p class="offer-foot dim small">Closing this leaves every offer on the table — they wait under Offers.</p>`,
  (root) => {
    const list = $('#ofList', root);
    let live = state;
    let last = '';
    // When each card's buttons wake. A card is guarded the first time this
    // sheet draws it, for the same reason the single sheet is: it arrived
    // under a finger that was on its way to something else.
    const wake = new Map();
    // Offers the senders are being told you are reading.
    const reading = new Set();
    const paint = (s) => {
      if (!s) return;
      live = s;
      const mine = waiting(s);
      if (!mine.length) { closeModal(); return; }
      const sig = mine.map((t) => `${t.id}${t.ignored ? '!' : ''}`).join();
      if (sig === last) return;
      last = sig;
      const open = mine.filter((t) => !t.ignored);
      const aside = mine.filter((t) => t.ignored);
      $('#ofN', root).textContent = String(mine.length);
      $('#ofSub', root).textContent = [
        open.length ? `${open.length} waiting for your answer` : 'Nothing waiting for an answer',
        aside.length ? `${aside.length} set aside` : '',
      ].filter(Boolean).join(' · ');
      list.innerHTML = open.map((t) => offerCardHTML(s, t)).join('')
        + (aside.length ? `<div class="offers-aside">${aside.map((t) => setAsideRow(s, t)).join('')}</div>` : '');
      wireOfferButtons(list, () => live, meId, actions);

      const now = Date.now();
      open.forEach((t) => { if (!wake.has(t.id)) wake.set(t.id, now + 450); });
      list.querySelectorAll('.offer-card').forEach((card) => {
        const wait = (wake.get(Number(card.dataset.offer)) || 0) - Date.now();
        if (wait <= 0) return;
        const keys = card.querySelectorAll('button');
        keys.forEach((k) => { k.disabled = true; });
        setTimeout(() => keys.forEach((k) => { if (!card.classList.contains('answered')) k.disabled = false; }), wait);
      });

      // The eye on each sender's card follows the list: lit while their offer
      // is a card here, out once it is answered, set aside or gone.
      open.forEach((t) => {
        if (reading.has(t.id)) return;
        reading.add(t.id);
        actions.tradeViewing?.(t.id, true);
      });
      for (const id of [...reading]) {
        if (open.some((t) => t.id === id)) continue;
        reading.delete(id);
        if (mine.some((t) => t.id === id)) actions.tradeViewing?.(id, false);
      }
    };
    paint(state);
    sheetRepaint = paint;
    onModalClose(() => {
      const still = new Set((livePlayersState?.trades || []).map((t) => t.id));
      for (const id of reading) if (still.has(id)) actions.tradeViewing?.(id, false);
      reading.clear();
    });
    $('#ofClose', root).onclick = () => { sfx.click(); closeModal(); };
  }, 'offer-sheet offers-sheet');
}

/** Which offer sheet holds the screen, if any: the one offer, or the list. */
export function offerSheetOpen() {
  if (!isModalOpen()) return null;
  const sheet = $('#modalRoot > .modal');
  if (sheet?.classList.contains('offers-sheet')) return 'list';
  return sheet?.classList.contains('offer-sheet') ? 'one' : null;
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
  syncQuickCountdown(quickDeadline(state));
  // Which long-lived scene the action well is showing. The quick-play wait
  // carries a looping deck animation, so that scene is written once and left
  // alone; every other branch repaints and drops the mark.
  const wasMode = actionEl.dataset.mode || '';
  actionEl.dataset.mode = '';
  // The line under the buttons is kept the same way, for the lobby only:
  // its seat faces pop in when they are drawn, and a Ready round pushes a
  // state for every tap at the table.
  const statusWas = statusEl.dataset.sig || '';
  statusEl.dataset.sig = '';
  // The auction card and the bankrupt player's question (1.0.7) are rebuilt
  // only when what they say has changed: a push that moves nothing else must
  // not rebuild a bid button under a finger already on its way to it. Their
  // buttons act on the newest state, kept here, never on the one that drew
  // them.
  const htmlWas = wellHtml;
  wellHtml = '';
  wellState = state;
  noteEstates(state);

  const on = (id, fn, sound) => {
    const b = $(id);
    if (b) b.onclick = () => { (sound || sfx.click)(); fn(); };
  };

  // lobby ────────────────────────────────────────────────────────────────
  if (state.status === 'lobby') {
    const seated = state.players.length;
    const seats = state.settings.maxPlayers;
    // A Play-now table runs itself in two acts (see quickLobbyWell). A
    // server from before the Ready round sends only the deadline, and gets
    // the wait it always had: the deck riffling over the search line, and
    // nothing to press, because that server has nothing for it to do.
    const lobby = state.quick ? state.quickLobby || null : null;
    const legacy = !!(state.quick && !lobby && state.quickStartAt);
    if (lobby) {
      quickLobbyWell(state, meId, actions, actionEl, wasMode);
    } else if (legacy) {
      // The mark carries the room id: a well left over from an earlier
      // table's wait gets repainted for this one, not trusted.
      const waitMode = `quick-wait:${state.id}`;
      actionEl.dataset.mode = waitMode;
      if (wasMode !== waitMode) {
        actionEl.innerHTML = `${deckMarkup('idle')}
          <div class="quick-search"><span class="pulse-dot"></span> <b id="quickPhase">Finding players…</b></div>
          <div class="quick-count">Starting in <b id="quickCount">…</b></div>
          ${tableTalkHTML()}`;
      }
    } else if (actions.isWatching?.() && !state.cup) {
      // Somebody who came to watch a game that has since gone back to its
      // lobby — a rematch — may sit down in the next one, while there is a
      // chair. Only through the ordinary door: watching never turns into a
      // seat by itself.
      const open = seated < seats;
      actionEl.innerHTML = `${open
        ? `<button class="btn primary big" id="cSit">${icon('people')} Take a seat</button>` : ''}
        <div class="waiting">${icon('eye')} You are watching${open ? '' : ' — every seat is taken'}</div>`;
      on('#cSit', () => actions.takeSeat?.());
    } else {
      actionEl.innerHTML = state.hostId === meId
        ? `<button class="btn primary big" id="cStart">${icon('dice')} Start Game</button>`
        : '<div class="waiting"><span class="pulse-dot"></span> Waiting for the host…</div>';
    }
    // At a Play-now table the host wears the crown — the longest-seated real
    // person, so it never lands on a house player — and anybody who has
    // pressed Ready wears the tick. A chair somebody just left says it is
    // being found rather than sitting there looking abandoned.
    //
    // A seat somebody else is sitting in opens their profile, as their card
    // in the rail does — on a phone these faces are the first of the table
    // anybody sees. Whether it opens is part of the markup, so the line is
    // rewired whenever it is redrawn and left alone when it is not.
    const here = deviceCodes();
    const seatHtml = (p) => {
      if (!p) return `<div class="seat-slot open"><span class="seat-face"></span><span class="seat-name">${lobby?.backfillAt ? 'finding…' : 'open'}</span></div>`;
      const face = p.avatar || (p.name[0] || '?').toUpperCase();
      const crown = lobby && p.id === state.hostId;
      const ready = lobby && !crown && p.ready;
      const opens = opensProfile(p, meId, here);
      return `<div class="seat-slot${crown ? ' host' : ''}${ready ? ' ready' : ''}${opens ? ' tap' : ''}"${opens
        ? ` data-pid="${escapeHtml(p.id)}" role="button" tabindex="0" title="See ${escapeHtml(p.name)}'s profile"` : ''}>
          <span class="seat-face" style="background:${p.color}">${escapeHtml(face)}${crown ? `<i class="seat-crown">${icon('crown')}</i>` : ''}${ready ? `<i class="seat-tick">${TICK}</i>` : ''}</span>
          <span class="seat-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
        </div>`;
    };
    const quick = !!lobby || legacy;
    const status = `
      <div class="lobby-head">
        <div class="room-code">${quick ? `${icon('bolt')} Quick Play`
          : state.cup ? `${icon('trophy')} Cup match`
          : `Room <b>${escapeHtml(state.id)}</b>`}</div>
        <div class="lobby-map">${icon('map')} ${escapeHtml(state.map.name)} · ${state.map.size} tiles${state.settings.teams > 0 ? ` · ${state.settings.teams} teams` : ''}${lobbyTerms(state)}</div>
        ${state.quickRoll?.parts?.length
          // The board is already on the line above, so this picks up the rules.
          ? `<div class="lobby-rolled">${escapeHtml(state.quickRoll.parts.slice(1).join(' · '))}</div>` : ''}
      </div>
      <div class="seat-row${lobby ? ' marked' : ''}">${Array.from({ length: seats }, (_, i) => seatHtml(state.players[i])).join('')}</div>
      <div class="dim small">${state.cup && seated < seats
        ? 'Waiting for the player drawn against you'
        : lobby ? `${seated} of ${seats} seated`
        : `${seated} of ${seats} seats taken`}</div>
      ${state.cup ? '<div class="dim small cup-note">Winner goes through. Loser is out of the cup.</div>' : ''}`;
    if (statusWas !== status) {
      statusEl.innerHTML = status;
      statusEl.querySelectorAll('.seat-slot.tap[data-pid]').forEach((el) => {
        const open = () => {
          sfx.click();
          const seat = livePlayersState?.players.find((x) => x.id === el.dataset.pid);
          if (seat?.code) openPlayerProfile(seat, { token: meId });
        };
        el.onclick = open;
        el.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        };
      });
    }
    statusEl.dataset.sig = status;
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
      ${(state.quick || state.hostId === meId) && !state.cup
        ? `<button class="btn primary wide wrap" id="cAgain">${icon('replay')} Play again</button>`
        : ''}
      ${state.cup ? `<div class="cup-note dim small">${icon('trophy')} A cup match is played once — the bracket has your result.</div>` : ''}`;
    const won = winnerLabel(state);
    statusEl.innerHTML = (won
      ? `<div class="win-line" style="color:${won.color}">${icon('trophy')} ${escapeHtml(won.name)} wins!</div>`
      : '<div class="win-line">Game over</div>')
      + (endedOnTime(state) ? `<div class="dim small time-up">${icon('clock')} Time's up — the richest player won</div>` : '');
    on('#cStandings', () => showGameOver(state, meId, actions));
    on('#cHome', () => actions.goHome?.());
    // A matchmade table breaks up when it ends, and the server refuses to
    // reconvene it: going again from one means Play now finding a fresh
    // table, for whoever presses it — the same as the result sheet's button
    // and the side panel's.
    on('#cAgain', state.quick ? () => actions.newTable?.() : actions.rematch);
    return;
  }

  // auction ──────────────────────────────────────────────────────────────
  // One card for every lot (1.0.7): a street somebody turned down, an
  // auction-only landing, a lot from a bankrupt player's estate. A question
  // still open about somebody's streets does not stop a hammer already up,
  // so the card says it while the bidding runs (see auctionCardHTML).
  if (state.auction) {
    const a = state.auction;
    const mode = `auction:${state.id}:${a.tile}:${a.estate ? a.estate.left : ''}`;
    // A new top bid gives the number a knock, once, as it lands.
    const bump = bidSeen.mode === mode && bidSeen.bid !== a.bid;
    bidSeen = { mode, bid: a.bid };
    const html = auctionCardHTML(state, meId);
    actionEl.dataset.mode = mode;
    wellHtml = wellSig(html);
    if (wellHtml !== htmlWas || wasMode !== mode) {
      actionEl.innerHTML = html;
      // A new lot arrives; a new bid lands. Both are said once, as they
      // happen, and are not part of what the card says — so a later push
      // that changes nothing does not rebuild it to take them off again.
      if (wasMode !== mode) actionEl.firstElementChild?.classList.add('enter');
      if (bump) $('.ab-bid', actionEl)?.classList.add('bump');
      actionEl.querySelectorAll('[data-bid]').forEach((b) => {
        // the state diff plays the bid sound for everyone (including us) — a
        // click sound here would double it up
        b.onclick = () => actions.bid(Number(b.dataset.bid));
      });
      on('#passBid', actions.passBid);
      on('.ab-deed', () => openDeedModal(wellState, a.tile, meId, actions));
    }
    statusEl.innerHTML = '';
    on('#cbReopen', () => openEstateChoiceSheet(wellState, meId, actions));
    paintCountdowns();
    return;
  }

  // a bankrupt player deciding ──────────────────────────────────────────
  // At a table where the bankrupt player decides (1.0.7), the game holds
  // still on their answer: they get the question, everyone else is told who
  // is deciding and for how long. A seat in debt keeps raising money in the
  // meantime, so its own panel stays, with the wait said under it.
  const choice = state.status === 'playing' ? state.bankruptChoice : null;
  if (choice && !(myTurn && state.turn?.phase === 'debt')) {
    const mode = `choice:${state.id}:${choice.endsAt}`;
    const html = choiceCardHTML(state, meId);
    actionEl.dataset.mode = mode;
    wellHtml = wellSig(html);
    if (wellHtml !== htmlWas || wasMode !== mode) {
      actionEl.innerHTML = html;
      if (wasMode !== mode) actionEl.firstElementChild?.classList.add('enter');
      actionEl.querySelectorAll('[data-estate-answer]').forEach((b) => {
        b.onclick = () => answerEstate(b, actions);
      });
      on('#cbSheet', () => openEstateChoiceSheet(wellState, meId, actions));
    }
    statusEl.innerHTML = '';
    paintCountdowns();
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
    // The wallet is the ledger: what is still owed is exactly the red on the
    // balance, so it climbs live as every raised dollar streams through. The
    // button is the old pay control kept as an exit — it only unlocks once
    // the balance touches zero (the server usually closes the debt itself
    // before this frame is even seen).
    const owed = Math.max(0, -(me.money || 0));
    html = `<button class="btn good big" id="cPayDebt" ${owed > 0 ? 'disabled' : ''}>Back in the black — continue</button>
            <button class="btn bad wide" id="cBankrupt">Declare bankruptcy</button>`;
    status = owed > 0
      ? `<div class="alert">You're <b>${money(owed)}</b> in the red — everything you raise goes to ${debtDestination(state, t.debt || {})} until you're square.</div>
         <div class="dim small">Your properties panel lists the fastest ways to raise it.</div>`
      : '<div class="dim small">Debt settled — carrying on.</div>';
  } else if (t.phase === 'action' && t.pending?.type === 'buy') {
    const tile = state.map.tiles[t.pending.tile];
    cardEl.innerHTML = deedMarkup(state, t.pending.tile, { compact: true }) || '';
    // An auction-only table (1.0.6) has no Buy step: the server opens the
    // hammer on the landing and never sends a deed on offer. Should one get
    // here all the same, the only way on is the one that table allows.
    if (state.settings.auctionOnly) {
      html = `<button class="btn primary big" id="cSkip">${icon('gavel')} Send to auction</button>`;
      status = `<div class="dim small">Auction only · the deed says ${money(tile.price)}</div>`;
    } else {
      html = `<button class="btn good big" id="cBuy" ${me.money < tile.price ? 'disabled' : ''}>Buy for ${money(tile.price)}</button>
            <button class="btn wide ghost" id="cSkip">${state.settings.auction ? `${icon('gavel')} Send to auction` : 'Skip'}</button>`;
      status = me.money < tile.price ? '<div class="dim small">Not enough cash for this one.</div>' : '';
    }
  } else if (t.phase === 'roll') {
    if (me.jail) {
      html = `<button class="btn primary big" id="cRoll">${icon('dice')} Roll for a double</button>
              <div class="row-2">
                <button class="btn ghost" id="cJailPay" ${me.money < 50 ? 'disabled' : ''}>Pay $50 &amp; wait</button>
                ${me.getOutCards > 0 ? `<button class="btn gold" id="cJailCard">Use ${icon('ticket')} card</button>` : ''}
              </div>`;
      // The fine buys the door and nothing else, so the button has to say so
      // before it is pressed — a player who expects to roll afterwards has
      // spent $50 on the turn they were going to lose anyway. On the last
      // try it is worth even less: a miss now walks out free (1.0.6), so the
      // line says that before anybody pays for a door about to open itself.
      const lastTry = (me.jailTurns || 0) >= 2;
      status = `<div class="dim small">In prison · attempt ${(me.jailTurns || 0) + 1} of 3<br>
        ${lastTry ? 'Miss this one and you walk out free anyway, moving by the roll.'
          : 'Paying the fine ends your turn — the card lets you roll.'}</div>`;
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
  // What the button costs, in the table's own terms. The streets have never
  // followed the debt — whatever was raised already went to whoever was owed
  // — so the sheet says where they really go: back to the bank, under the
  // hammer at a table that auctions estates (1.0.6), or, where the bankrupt
  // player decides (1.0.7), wherever they say on that same sheet. Once no
  // sale can happen any more (estateFate) it is the bank at every table.
  on('#cBankrupt', () => openGiveUpSheet(wellState, meId, actions, 'declare'));
  if (choice) statusEl.innerHTML += choiceAsideHTML(state, meId);
}

function phaseHint(state, p) {
  const t = state.turn;
  if (!t) return '';
  if (t.phase === 'debt') return 'raising funds…';
  if (t.phase === 'action') return 'deciding on a property…';
  if (t.phase === 'auction') return 'waiting on the hammer…';
  if (t.phase === 'roll') return p.jail ? 'locked up' : 'about to roll…';
  return 'wrapping up…';
}

// ─────────────────────────────────────────────── the hammer and the estate ──
// 1.0.7: the auction card, the bankrupt player's question and the sheets that
// ask it. They share their parts — a deed in miniature, a face, a countdown —
// so an estate sale reads as one story from the bust to the last lot.

// What the well last drew for the auction or the question (see renderCenter),
// and the newest state its buttons act on. A coin flag numbers its clip path
// afresh every time it is drawn (see circleFlag), which is no change to what
// the card says, so the comparison reads past the number.
let wellHtml = '';
let wellState = null;
const wellSig = (html) => html.replace(/coinclip-\d+/g, 'coinclip');
let bidSeen = { mode: '', bid: 0 };

/** A player's face at the size of a chip, with the avatar they wear. */
function chipFace(p, size = 'xs') {
  return `<span class="avatar ${size}${p?.avatar ? ' has-skin' : ''}" style="background:${p?.color || 'var(--ink-3)'}">${
    escapeHtml(p?.avatar || (String(p?.name || '?')[0] || '?').toUpperCase())}</span>`;
}

/** The colour a deed wears: its country's, or the airport's and utility's own. */
function deedColour(state, tile) {
  const g = tile?.group ? state.groups?.[tile.group] : null;
  return g?.color || (tile?.type === 'airport' ? '#5b8def' : tile?.type === 'utility' ? '#38bdf8' : '#7c6bb0');
}

/** The deeds a seat holds, in board order. */
function deedsOf(state, id) {
  return Object.entries(state.ownership || {})
    .filter(([, o]) => o.owner === id)
    .map(([i]) => Number(i))
    .sort((x, y) => x - y);
}

// ── which lot is this ──
// The server tells an estate lot whose estate it is and how many more follow
// it — never the lots themselves. They are read off the table instead, as the
// player goes out: the deeds they held in the last state before the bust, or,
// where they decide, the very list they were asked about. A seat that sat
// down after the bust has neither, and its card counts what is left instead.
let estateBook = { room: '', lots: new Map(), held: new Map() };
const FOR_SALE = new Set(['property', 'airport', 'utility']);

function noteEstates(state) {
  if (estateBook.room !== state.id || state.status !== 'playing') {
    estateBook = { room: state.id, lots: new Map(), held: new Map() };
    if (state.status !== 'playing') return;
  }
  const c = state.bankruptChoice;
  if (c?.name && Array.isArray(c.properties) && c.properties.length) {
    estateBook.lots.set(c.name, [...c.properties].sort((x, y) => x - y));
  }
  const held = new Map();
  for (const p of state.players) {
    if (isOut(p)) {
      const before = estateBook.held.get(p.name);
      if (before?.length && !estateBook.lots.has(p.name)) estateBook.lots.set(p.name, before);
      continue;
    }
    held.set(p.name, deedsOf(state, p.id).filter((i) => FOR_SALE.has(state.map.tiles[i]?.type)));
  }
  estateBook.held = held;
}

/**
 * Where this lot sits in its estate: `{ left, n, total, next }` when the book
 * knows the estate and agrees with the server about what is left, otherwise
 * `{ left }` alone — a count the card can still say.
 */
function estateLot(a) {
  const left = Math.max(0, Math.floor(Number(a.estate?.left) || 0));
  const all = estateBook.lots.get(a.estate?.from);
  const k = all ? all.indexOf(a.tile) : -1;
  if (k < 0 || all.length - k - 1 !== left) return { left };
  return { left, n: k + 1, total: all.length, next: all.slice(k + 1) };
}

/** The rent a bidder weighs, in a few words: a street's base and its hotel, an airport's range. */
function lotFacts(tile) {
  if (tile.type === 'property') {
    const hotel = tile.rent?.[5];
    return `rent ${money(tile.rent?.[0] || 0)}${hotel ? `<span class="ab-hotel"> · hotel ${money(hotel)}</span>` : ''}`;
  }
  if (tile.type === 'airport') return 'rent $25 – $200';
  if (tile.type === 'utility') return 'rent 4× or 10× the dice';
  return '';
}

/**
 * What this lot does to the race for a colour — the thing a bidder most needs
 * to know and the deed alone does not say: it finishes somebody's set. Yours,
 * or a rival's, who will pay accordingly.
 */
function lotStakes(state, meId, i) {
  const tile = state.map.tiles[i];
  if (tile?.type !== 'property') return null;
  const rest = (state.map.groups[tile.group] || []).filter((k) => k !== i);
  const owners = new Set(rest.map((k) => state.ownership[k]?.owner || ''));
  if (!rest.length || owners.size !== 1) return null;
  const p = state.players.find((x) => x.id === [...owners][0] && !isOut(x));
  if (!p) return null;
  return p.id === meId
    ? { mine: true, text: 'Completes your set' }
    : { mine: false, text: `Completes ${p.name}’s set` };
}

/**
 * The auction card. Read top to bottom it answers what a bidder asks in the
 * order they ask it: what kind of sale, what is up (a deed in miniature that
 * opens the real one), where the bidding stands, how long is left, and what
 * this seat can do about it — bid, pass, or a pill that says why not.
 */
function auctionCardHTML(state, meId) {
  const a = state.auction;
  const tile = state.map.tiles[a.tile] || { name: '?' };
  const g = tile.group ? state.groups?.[tile.group] : null;
  const me = state.players.find((p) => p.id === meId);
  const leader = state.players.find((p) => p.id === a.leader);
  const leading = !!me && a.leader === meId;
  const inRace = (a.inRace || []).includes(meId);
  const min = a.bid === 0 ? 10 : a.bid + 10;
  // The leading bid is escrowed out of the leader's wallet the moment it
  // lands, so their real ceiling is the cash still showing plus the money
  // already on the table — read off the wallet alone it looks lower.
  const purse = (me?.money || 0) + (leading ? a.bid : 0);
  const steps = [min, min + 40, min + 90].filter((v) => v <= purse);
  const estate = a.estate || null;
  const lot = estate ? estateLot(a) : null;
  const from = estate ? state.players.find((p) => p.name === estate.from) : null;
  const stakes = lotStakes(state, meId, a.tile);

  // Which sale, and how far through it. An estate (1.0.6) says whose and
  // which lot of how many, so a table watching five auctions in a row knows
  // it is one sale and when it ends; an auction-only table says why there
  // was no Buy button.
  const pips = lot?.total && lot.total <= 12
    ? `<i class="ab-pips" aria-hidden="true">${Array.from({ length: lot.total }, (_, k) =>
      `<i class="${k < lot.n - 1 ? 'done' : k === lot.n - 1 ? 'now' : ''}"></i>`).join('')}</i>` : '';
  const where = lot?.total ? `<span class="ab-where"><span><span class="ab-wide">Lot </span>${lot.n} of ${lot.total}</span>${pips}</span>`
    : estate ? `<span class="ab-where">${lot.left ? `<span>${lot.left} more<span class="ab-wide"> after this</span></span>` : 'Last lot'}</span>`
    : state.settings.auctionOnly ? '<span class="ab-where">Auction only</span>' : '';
  // The lots still to come, in a few words. The card ends on them where it
  // has the room; a phone's well does not, so the header carries them too.
  const nextNames = lot?.next?.length
    ? `${lot.next.slice(0, 2).map((k) => state.map.tiles[k]?.name || '').join(' · ')}${
      lot.next.length > 2 ? ` +${lot.next.length - 2}` : ''}` : '';
  // One line, whatever the names: the bankrupt player's name is the part
  // that gives way. As the card narrows the kind's word, then the pips, then
  // the "Lot" of "Lot 2 of 4" step aside first (see the well's container
  // queries) — the gavel and a "’s estate" after the name, shown once the
  // word has gone, still say what sale this is.
  const head = `<div class="ab-head"${nextNames ? ` title="Up next: ${escapeHtml(nextNames)}"` : ''}>
      <span class="ab-kind">${icon('gavel')}<span class="ab-kword">${estate ? 'Estate sale' : 'Auction'}</span></span>
      ${estate ? `<span class="ab-from">${chipFace(from || { name: estate.from })}<span class="ab-who"><b>${escapeHtml(estate.from)}</b><span>’s estate</span></span></span>` : ''}
      ${where}
    </div>`;

  const deed = `<button type="button" class="ab-deed" style="--c:${deedColour(state, tile)}"
      title="Open the deed" aria-label="${escapeHtml(tile.name)} — open the deed">
      <span class="ab-band">${tileMark(tile, g, 26)}</span>
      <span class="ab-what">
        <b>${escapeHtml(tile.name)}</b>
        <span class="ab-facts">${lotFacts(tile)}</span>
      </span>
      ${tile.price ? `<span class="ab-price"><small>deed</small>${money(tile.price)}</span>` : ''}
    </button>
    ${stakes ? `<div class="ab-stakes ${stakes.mine ? 'mine' : 'rival'}" title="${escapeHtml(stakes.text)}">${icon(stakes.mine ? 'star' : 'warning')}<span>${escapeHtml(stakes.text)}</span></div>` : ''}`;

  const standing = `<div class="ab-standing">
      ${a.bid
        ? `<div class="ab-bid"><small>top bid</small>${money(a.bid)}</div>`
        : `<div class="ab-bid none"><b>No bids yet</b><small>opens at ${money(10)}</small></div>`}
      ${leader ? `<span class="ab-leader" style="--c:${leader.color}">${chipFace(leader)}<b>${leading
        ? '<span class="ab-lname">Your bid</span>' : `<span class="ab-lname">${escapeHtml(leader.name)}</span><i>leads</i>`}</b></span>` : ''}
    </div>`;

  // A bankrupt player's question still open while this hammer is up (1.0.7)
  // belongs on the card, not under it: under it, a phone's well had already
  // scrolled it out of sight. The player being asked gets their way back to
  // it where their keys would be; everyone else, a line at the foot.
  const ask = state.status === 'playing' ? state.bankruptChoice : null;
  const asked = !!ask && ask.playerId === meId;

  // What this seat can do. The leader has nothing to press — raising their
  // own bid buys nothing, and passing would only throw away their answer to
  // the next one — so the state is a pill, as it is for anyone with no move.
  let moves;
  if (asked) {
    moves = `<button type="button" class="btn small gold cb-reopen" id="cbReopen">${icon('skull')} Decide about your properties</button>`;
  } else if (!me || isOut(me)) {
    moves = `<span class="ab-pill out">${icon(me ? 'skull' : 'eye')} ${me ? 'You’re out' : 'Watching'}</span>`;
  } else if (leading) {
    moves = `<span class="ab-pill lead">${TICK} You lead</span>`;
  } else if (inRace) {
    // Short of the next bid, the row says so where the keys would be, beside
    // the one key left — a line under it cost a phone's well its last room.
    moves = `<div class="bid-row${steps.some((v) => v >= 10000) ? ' wide' : ''}">
        ${steps.length
          ? steps.map((v, k) => `<button class="btn small${k ? '' : ' gold'}" data-bid="${v}">${money(v)}</button>`).join('')
          : `<span class="ab-note">${money(min)} is more than you can raise</span>`}
        <button class="btn small ghost pass" id="passBid">Pass</button>
      </div>`;
  } else {
    moves = '<span class="ab-pill passed">You passed</span>';
  }

  // The foot: who the game is waiting on, while somebody else is deciding
  // about their streets; otherwise the lots still to come.
  const foot = ask && !asked
    ? `<div class="ab-foot ab-ask" title="${escapeHtml(ask.name)} is deciding what happens to their streets">${icon('clock')}<b>${escapeHtml(ask.name)}</b> is deciding about their streets…</div>`
    : lot?.next?.length
      ? `<div class="ab-foot ab-next"><span>Up next</span> ${lot.next.slice(0, 2).map((k) => escapeHtml(state.map.tiles[k]?.name || '')).join(' · ')}${
        lot.next.length > 2 ? ` <em>+${lot.next.length - 2}</em>` : ''}</div>`
      : '';

  return `<div class="auction-box${estate ? ' estate' : ''}">
      ${head}
      ${deed}
      ${standing}
      ${countdownHTML('auction', a.endsAt)}
      <div class="ab-moves">${moves}</div>
      ${foot}
    </div>`;
}

/**
 * The deeds in question as a row of their flags, so the table sees how much
 * is at stake. For the player being asked it is a button too: it opens the
 * whole list, by name and price, on the question's sheet.
 */
function lotFlagsHTML(state, lots, opens = false, max = 7) {
  const shown = lots.slice(0, lots.length > max ? max - 1 : max);
  const more = lots.length - shown.length;
  const flags = `${shown.map((i) => {
    const tile = state.map.tiles[i];
    if (!tile) return '';
    const g = tile.group ? state.groups?.[tile.group] : null;
    return `<span class="cb-lot" style="--c:${deedColour(state, tile)}" title="${escapeHtml(tile.name)}">${tileMark(tile, g, 18)}</span>`;
  }).join('')}${more > 0 ? `<span class="cb-lot more">+${more}</span>` : ''}`;
  return opens
    ? `<button type="button" class="cb-lots tap" id="cbSheet" title="See them by name">${flags}</button>`
    : `<div class="cb-lots">${flags}</div>`;
}

const propertyWord = (n) => (n === 1 ? 'property' : `${n} properties`);

/**
 * The well while a bankrupt player decides (1.0.7). For them: the question,
 * the clock and both answers, with the full list one tap away. For everyone
 * else: who is deciding, about how much, and how long the game waits.
 */
function choiceCardHTML(state, meId) {
  const c = state.bankruptChoice;
  const lots = (c.properties || []).filter((i) => state.map.tiles[i]);
  const mine = c.playerId === meId;
  const flags = lotFlagsHTML(state, lots, mine);
  const clock = countdownHTML('choice', c.endsAt);
  if (mine) {
    return `<div class="choice-box mine">
        <div class="cb-head"><span class="cb-mark">${icon('skull')}</span><b>You’re bankrupt</b></div>
        <div class="cb-q">What happens to your ${propertyWord(lots.length)}?</div>
        ${flags}
        ${clock}
        <div class="cb-actions">
          <button class="btn" data-estate-answer="bank">${icon('bank')} Back to the bank</button>
          <button class="btn" data-estate-answer="auction">${icon('gavel')} Auction ${lots.length === 1 ? 'it' : 'them'}</button>
        </div>
      </div>`;
  }
  const p = state.players.find((x) => x.id === c.playerId) || { name: c.name };
  const myTurn = state.turn?.playerId === meId;
  return `<div class="choice-box">
      <div class="cb-head">${chipFace(p, 'sm')}<b>${escapeHtml(c.name)}</b><span>went bankrupt</span></div>
      <div class="cb-q">${escapeHtml(c.name)} is deciding what happens to their streets…</div>
      ${flags}
      ${clock}
      <div class="cb-note">${myTurn
        ? 'Your turn picks up the moment they choose.'
        : 'Back to the bank, or auctioned to everyone. When the time is up, the house decides.'}</div>
    </div>`;
}

/**
 * A question still open while a seat busy raising money holds the well, said
 * in one line under its panel. The player being asked gets a way back to
 * their question instead. (A hammer that was already up says it on its own
 * card, where a phone's well still has it in sight.)
 */
function choiceAsideHTML(state, meId) {
  const c = state.status === 'playing' ? state.bankruptChoice : null;
  if (!c) return '';
  if (c.playerId === meId) {
    return `<button type="button" class="btn small gold cb-reopen" id="cbReopen">${icon('skull')} Decide about your properties</button>`;
  }
  return `<div class="cb-aside">${icon('clock')} ${escapeHtml(c.name)} is deciding what happens to their streets…</div>`;
}

/** Send an answer from the well — once: the keys go quiet until the state says what happened. */
function answerEstate(button, actions) {
  sfx.click();
  const keys = button.closest('.cb-actions')?.querySelectorAll('button') || [button];
  keys.forEach((k) => { k.disabled = true; });
  // Refused (it was not ours any more, or the clock beat us), nothing new
  // arrives to redraw them — so they come back on their own.
  setTimeout(() => keys.forEach((k) => { if (k.isConnected) k.disabled = false; }), 1500);
  actions.bankruptChoice(button.dataset.estateAnswer === 'auction');
}

/** The deeds about to change hands, one row each: flag, street, the price on the deed. */
function estateListHTML(state, lots) {
  return `<div class="bk-lots">${lots.map((i) => {
    const tile = state.map.tiles[i];
    if (!tile) return '';
    const g = tile.group ? state.groups?.[tile.group] : null;
    return `<div class="bk-lot" style="--c:${deedColour(state, tile)}">
        <span class="bk-flag">${tileMark(tile, g, 18)}</span>
        <b>${escapeHtml(tile.name)}</b>
        <em>${money(tile.price || 0)}</em>
      </div>`;
  }).join('')}</div>`;
}

/** The two answers, as the two big buttons both sheets end on. */
function estateOptionsHTML(n) {
  const them = n === 1 ? 'it' : 'them';
  return `<div class="bk-options">
      <button type="button" class="bk-option" data-answer="bank">
        <span class="bk-ico">${icon('bank', 22)}</span>
        <b>Give ${them} back to the bank</b>
        <span>Nobody gets ${them} now. ${n === 1 ? 'It sits' : 'They sit'} unowned until somebody lands there and buys.</span>
      </button>
      <button type="button" class="bk-option" data-answer="auction">
        <span class="bk-ico">${icon('gavel', 22)}</span>
        <b>Auction ${them} to everyone</b>
        <span>${n === 1 ? 'Goes' : 'Sold one at a time'} to the highest bidder, starting at $10.</span>
      </button>
    </div>`;
}

/** The sheet's heading, with the mark of what is happening beside it. */
function estateHead(title, sub) {
  return `<div class="bk-head">
      <span class="bk-mark">${icon('skull', 26)}</span>
      <div class="bk-titles"><h2>${title}</h2><p class="sub">${sub}</p></div>
    </div>`;
}

/**
 * The bankrupt player's question as a sheet (1.0.7): opened once, the moment
 * the server asks, and gone the moment the question is — answered here, in
 * the well, by the house, or overtaken by the next player's. It does not
 * close on a stray tap on the felt; Escape still puts it away, and the well
 * keeps both answers on screen.
 */
function openEstateChoiceSheet(state, meId, actions) {
  const c = state?.status === 'playing' ? state.bankruptChoice : null;
  if (!c || c.playerId !== meId) return;
  const lots = (c.properties || []).filter((i) => state.map.tiles[i]);
  const asked = c.endsAt;
  openModal(`
    ${estateHead('You’re bankrupt', `What happens to your ${propertyWord(lots.length)}?`)}
    ${countdownHTML('choice', c.endsAt)}
    <p class="bk-note">No answer in time and the house decides — it picks whatever keeps the game close.</p>
    ${estateListHTML(state, lots)}
    ${estateOptionsHTML(lots.length)}`, (root) => {
    root.onclick = null;
    root.querySelectorAll('[data-answer]').forEach((b) => {
      b.onclick = () => {
        sfx.click();
        closeModal();
        actions.bankruptChoice(b.dataset.answer === 'auction');
      };
    });
    sheetRepaint = (s) => {
      const now = s?.status === 'playing' ? s.bankruptChoice : null;
      if (!now || now.playerId !== meId || now.endsAt !== asked) closeModal();
    };
    paintCountdowns();
  }, 'small estate-sheet');
}

// The question this screen has already put up, so a state push does not put
// it up again after it was closed.
let choiceAsked = '';

/** Put the bankrupt player's question in front of them, once, when the server asks it. */
export function syncEstateChoice(state, meId, actions) {
  const c = state?.status === 'playing' ? state.bankruptChoice : null;
  if (!c || c.playerId !== meId) return;
  const key = `${state.id}:${c.endsAt}`;
  if (choiceAsked === key) return;
  choiceAsked = key;
  openEstateChoiceSheet(state, meId, actions);
}

/**
 * Where this seat's streets go if it leaves play now, read off the table the
 * way the server decides it (estateSaleOpen, disposeEstate): 'ask' when the
 * bankrupt-player-decides question would really be put to them, 'auction'
 * when the table sells them, 'release' when the bank keeps them. Nothing is
 * sold once the game clock has run out, or without at least two other
 * players still in to bid — and at a team table they must be on two teams,
 * because one team left is a game already won. Past that every table sends
 * the deeds back to the bank and one where the player decides asks nothing,
 * so no dialog here offers a choice or an auction that is not going to
 * happen. A seat with no deeds has nothing to be asked about either.
 */
function estateFate(state, meId) {
  const rule = estateRule(state);
  if (rule === 'release' || state?.status !== 'playing' || state.timeUp) return 'release';
  const others = (state.players || []).filter((p) => p.id !== meId && !p.bankrupt);
  const teamed = (state.settings?.teams || 0) > 0;
  if (others.length < 2 || (teamed && new Set(others.map((p) => p.team)).size < 2)) return 'release';
  if (rule === 'auction') return 'auction';
  return deedsOf(state, meId).length ? 'ask' : 'release';
}

/**
 * Going out on purpose — Give up in the leave sheet, Declare bankruptcy in a
 * debt. Where the bankrupt player decides (1.0.7) and they really would be
 * asked (estateFate), the question they would get a moment later is asked
 * here, inside the confirmation, so they decide once: either answer is the
 * confirmation. Anywhere else it is a plain confirmation that says where the
 * streets go.
 */
export function openGiveUpSheet(state, meId, actions, kind = 'concede') {
  if (!state) return;
  const where = estateFate(state, meId);
  const lots = deedsOf(state, meId);
  const asks = where === 'ask';
  const auctioned = where === 'auction' && lots.length > 0;
  const declare = kind === 'declare';
  const debt = declare ? state.turn?.debt : null;
  const sub = declare
    ? `You are out of the game. Whatever you have raised stays with ${debt ? debtDestination(state, debt) : 'whoever you owe'}.`
    : 'You go bankrupt on the spot and keep your seat to watch the end.';
  const fate = !lots.length ? 'You hold no properties, so nothing changes hands.'
    : auctioned
      ? `Your ${lots.length === 1 ? 'property is' : `${lots.length} properties are`} auctioned to the other players, one at a time.`
      : `Your ${lots.length === 1 ? 'property goes' : `${lots.length} properties go`} back to the bank, unowned.`;
  openModal(`
    ${estateHead(declare ? 'Declare bankruptcy?' : 'Give up the game?', sub)}
    ${asks ? `
      <p class="bk-q">What happens to your ${propertyWord(lots.length)}?</p>
      ${estateListHTML(state, lots)}
      ${estateOptionsHTML(lots.length)}
      <div class="modal-actions"><button class="btn ghost" id="bkNo">Keep playing</button></div>`
    : `
      <div class="bk-fate">${icon(auctioned ? 'gavel' : 'bank', 18)}<span>${fate}</span></div>
      <div class="modal-actions">
        <button class="btn ghost" id="bkNo">Keep playing</button>
        <button class="btn bad" id="bkYes">${declare ? 'Declare bankruptcy' : 'Give up'}</button>
      </div>`}`, (root) => {
    $('#bkNo', root).onclick = () => { sfx.click(); closeModal(); };
    const go = (answer) => {
      closeModal();
      // No answer is the plain concede every client has always sent.
      if (answer) actions.bankrupt(answer);
      else actions.bankrupt();
    };
    const yes = $('#bkYes', root);
    if (yes) yes.onclick = () => go();
    root.querySelectorAll('[data-answer]').forEach((b) => {
      b.onclick = () => go({ auction: b.dataset.answer === 'auction' });
    });
  }, 'small estate-sheet');
}

/**
 * Give up from the leave sheet: where the bankrupt player would be asked
 * (estateFate), the sheet above asks first; anywhere else the leave sheet
 * already was the confirmation.
 */
export function giveUp(state, meId, actions) {
  if (estateFate(state, meId) === 'ask') openGiveUpSheet(state, meId, actions, 'concede');
  else actions.bankrupt();
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

// ─────────────────────────────────────────────────── the Play-now lobby ──
/**
 * The well at a Play-now table, in two acts, in the phones' words.
 *
 * First the search: the table looks for real people and only pads itself
 * out with house players in its last few seconds, and a big gold number
 * counts it down. Then the Ready round: everybody reads what the table
 * rolled, says hello, and presses Ready; the host starts once they have — or
 * the table deals itself in at the server's deadline, because a host who
 * wandered off must not be able to hold three strangers for ever. Ready can
 * be pressed from the moment you sit; only Start waits for the search.
 *
 * The search carries the looping deck, so each act's scene is painted once
 * and left alone; the buttons under it are repainted only when what they
 * say changes, so a tap already on its way is never swallowed by a rebuild.
 */
function quickLobbyWell(state, meId, actions, actionEl, wasMode) {
  const q = state.quickLobby;
  const gathering = q.phase !== 'ready';
  const mode = `quick:${state.id}:${gathering ? 'search' : 'ready'}`;
  actionEl.dataset.mode = mode;
  if (wasMode !== mode) {
    actionEl.innerHTML = gathering
      ? `${deckMarkup('idle')}
        <div class="quick-search"><span class="pulse-dot"></span> <b id="quickPhase">Finding players…</b></div>
        <div class="quick-big"><b id="quickCount">…</b><span id="quickCap">SECONDS TO FIND PLAYERS</span></div>
        <div id="quickControls" class="quick-controls"></div>
        ${tableTalkHTML()}`
      : `<div class="quick-ready" id="quickReady">
          <div class="quick-head" id="quickHead"></div>
          <div class="quick-count" id="quickCount"></div>
        </div>
        <div id="quickControls" class="quick-controls"></div>`;
  }

  const isHost = state.hostId === meId;
  const me = state.players.find((p) => p.id === meId);
  // The server counts who it is waiting on; one that sends the list instead
  // of the number, or neither, is counted here the same way.
  const waiting = Array.isArray(q.waitingOn) ? q.waitingOn.length
    : Number.isFinite(q.waitingOn) ? q.waitingOn
    : state.players.filter((p) => p.id !== state.hostId && !p.ready).length;
  const allSet = !!q.canStart || waiting === 0;

  const head = $('#quickHead', actionEl);
  if (head) {
    const html = allSet
      ? `<span class="qh-mark good">${TICK}</span> Everyone's ready`
      : `<span class="pulse-dot"></span> Waiting for ${waiting} to get ready`;
    if (head.dataset.v !== html) { head.dataset.v = html; head.innerHTML = html; }
    $('#quickReady', actionEl)?.classList.toggle('set', allSet);
  }

  const box = $('#quickControls', actionEl);
  if (!box) return;
  const open = !gathering && !!q.canStart;
  const ready = !!me?.ready;
  const sig = `${isHost ? 'host' : me ? 'seat' : 'watch'}:${open ? 1 : 0}:${gathering ? 1 : 0}:${ready ? 1 : 0}`;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  // Start for the host, Ready for everybody else seated. A spectator — a
  // full table watched from the landing — gets neither, only the chat.
  const main = isHost
    // The server has the last word (Start is refused while anybody is still
    // reading); the button only says what it will answer.
    ? `<button class="btn primary big" id="cStart" ${open ? '' : 'disabled'}>${icon('dice')} Start game</button>
       ${gathering ? '<div class="quick-note-host">You\'re the host. Start unlocks when the search ends.</div>' : ''}`
    : me
      // Pressed, it turns green and says so; pressed again it takes it
      // back — a player who needs a moment is not trapped by a tap.
      ? `<button class="btn ${ready ? 'good' : 'primary'} big" id="cReady" aria-pressed="${ready}">${ready ? `Ready ${TICK}` : 'I\'m ready'}</button>`
      : '';
  box.innerHTML = `${main}
    <div class="row-2 quick-more">
      <button class="btn ghost" id="cRules">${icon(isHost ? 'toolbox' : 'scales')} ${isHost ? 'Change rules' : 'See all rules'}</button>
      <button class="btn ghost quick-chat" id="cChat">${icon('chat')} Chat with the table</button>
    </div>`;
  const start = $('#cStart', box);
  if (start) start.onclick = () => { sfx.click(); actions.start(); };
  const press = $('#cReady', box);
  if (press) press.onclick = () => { sfx.click(); actions.ready?.(!ready); };
  // The rules are the side panel's, where a private host sets theirs: on a
  // desktop that is the rail beside the board, on a phone the page under it.
  // Either way the button takes you there and lights the panel you landed on.
  $('#cRules', box).onclick = () => {
    sfx.click();
    const rules = document.getElementById('quickRules');
    if (!rules) return;
    rules.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    rules.classList.remove('flash');
    void rules.offsetWidth;
    rules.classList.add('flash');
  };
  $('#cChat', box).onclick = () => { sfx.click(); actions.openChat?.(); };
}

// ──────────────────────────────────────────────── quick play countdown ──
// The deal-in deadline rides along with the state, but the seconds are counted
// here: a state push can be a minute old after a sleeping tab, and a number
// frozen mid-countdown reads as a table that has given up on you.
//
// Which deadline depends on the act: the search counts to its own end, the
// Ready round to the moment the table deals itself in, and a server from
// before the Ready round to the only deadline it has.
let quickEndsAt = null;
let quickAct = 'legacy';
let quickTimer = null;

/** The deadline a Play-now lobby is counting to, or null when it is not one. */
function quickDeadline(state) {
  if (state.status !== 'lobby' || !state.quick) { quickAct = 'legacy'; return null; }
  const q = state.quickLobby;
  if (!q) { quickAct = 'legacy'; return state.quickStartAt; }
  quickAct = q.phase === 'ready' ? 'ready' : 'search';
  return quickAct === 'ready' ? q.startBy ?? state.quickStartAt : q.gatherUntil;
}

/** "0:24" — the Ready round runs up to a couple of minutes, so it reads as a time. */
const minSec = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

function paintQuickCountdown() {
  const el = document.getElementById('quickCount');
  if (!el) return; // the searching state isn't on screen
  const secs = quickEndsAt ? Math.max(0, Math.ceil((quickEndsAt - Date.now()) / 1000)) : 0;
  const say = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
  if (quickAct === 'ready') {
    // Everybody sees the deadline, the host included: the table goes at
    // that moment whether or not anybody pressed anything.
    say(el, secs ? `Starts by itself in ${minSec(secs)}` : 'Dealing you in…');
    return;
  }
  if (quickAct === 'search') {
    say(el, secs ? String(secs) : '…');
    say(document.getElementById('quickCap'), secs ? 'SECONDS TO FIND PLAYERS' : 'STARTING THE READY ROUND');
  } else {
    say(el, secs ? `${secs}s` : 'a moment');
  }
  // The table spends most of the fuse actually looking for people, and only
  // the last few seconds filling the chairs nobody took. Saying which is
  // happening is the difference between "nobody came" and "it lied to me".
  say(document.getElementById('quickPhase'), secs > 5 ? 'Finding players…' : 'Filling the table…');
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

// ─────────────────────────────────────────────────────────── game clock ──
// A timed game (1.0.6) carries the moment its whole clock runs out, `endsAt`,
// beside the turn's own. It is counted down here between pushes for the same
// reason the turn clock is, and capped the same way, at the game's length, so
// a device running minutes slow cannot show more time than the table has.
// It is only ever a reading: the game ends when the server says it has.
const gameClock = { endsAt: null, total: 0, timeUp: false };
let gameClockTimer = null;

/**
 * The chips under the table's toolbar: the game clock at a timed table, and
 * how many people are watching. Both are facts about the whole table, so
 * everybody sees them, watchers included.
 */
export function syncTableChips(state) {
  const playing = state?.status === 'playing';
  gameClock.endsAt = playing && Number(state.endsAt) > 0 ? Number(state.endsAt) : null;
  gameClock.timeUp = playing && !!state.timeUp;
  gameClock.total = Math.max(0, Number(state?.settings?.timeLimit) || 0) * 60000;
  paintGameClock();
  if (gameClock.endsAt && !gameClockTimer) gameClockTimer = setInterval(paintGameClock, 500);

  const eye = $('#watchCount');
  if (eye) {
    const n = Math.max(0, Math.floor(Number(state?.spectators) || 0));
    // Compared by the count rather than by innerHTML, which the browser
    // re-serialises and so never reads back as the string it was handed.
    if (eye.dataset.n !== String(n)) {
      eye.dataset.n = String(n);
      eye.innerHTML = n ? `${icon('eye')}<b>${n}</b> watching` : '';
    }
    eye.classList.toggle('hidden', !n);
    eye.title = n === 1 ? 'One person is watching this table' : `${n} people are watching this table`;
  }
  paintChipRow();
}

/** Seconds left on the game, or null when this table plays without a clock. */
function gameClockSeconds() {
  if (!gameClock.endsAt) return null;
  let left = gameClock.endsAt - Date.now();
  if (gameClock.total) left = Math.min(left, gameClock.total);
  return Math.max(0, Math.ceil(left / 1000));
}

function paintGameClock() {
  const el = $('#gameClock');
  const secs = gameClockSeconds();
  if (secs === null) {
    if (gameClockTimer) { clearInterval(gameClockTimer); gameClockTimer = null; }
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('warm', 'last');
      el.innerHTML = '';
      el.dataset.t = '';
    }
    paintChipRow();
    return;
  }
  if (!el) return;
  // At the whistle the turn being played is the last one; the chip says so
  // rather than sitting on 0:00 as if the clock had stuck.
  const last = gameClock.timeUp || secs === 0;
  const words = last ? 'Last turn' : minSec(secs);
  if (el.dataset.t !== words) {
    el.dataset.t = words;
    el.innerHTML = `${icon('clock')}<b>${words}</b>`;
  }
  el.classList.remove('hidden');
  el.classList.toggle('warm', !last && secs <= 120);
  el.classList.toggle('last', last);
  el.title = last ? 'Time is up — the richest player wins when this turn ends'
    : 'Game clock — when it runs out, the richest player wins';
  paintChipRow();
}

/** The row hides itself when neither chip has anything to say. */
function paintChipRow() {
  const row = $('#tableChips');
  if (!row) return;
  const any = [...row.children].some((c) => !c.classList.contains('hidden'));
  row.classList.toggle('hidden', !any);
}

/** Whether a finished game was decided on the clock rather than by the last one standing. */
export function endedOnTime(state) {
  return state?.status === 'ended' && state.endReason === 'time';
}

// ──────────────────────────────────────────── holding a dropped chair ──
// A seat is only held for as long as the table agrees to hold it, so the card
// has to answer three things at a glance: who we are waiting for, how long is
// left, and — once the free favours are spent — how many people still have to
// click before the minute lands.
let awaitTimer = null;

export function renderAwaiting(state, meId, el, actions) {
  if (!el) return;
  // Only a seat at the table can hand out time; someone watching would get
  // the server's refusal for every tap.
  const seated = state.players.some((p) => p.id === meId);
  const seats = (state.status === 'playing' && seated ? state.awaiting || [] : [])
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
    const until = Number(el.dataset.until) || 0;
    const secs = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    // No deadline at all means the table is waiting as long as it takes —
    // there is nobody here being kept waiting by the empty chair.
    el.textContent = !until ? 'Their seat is being held'
      : secs ? `Seat goes back to the board in ${clockText(secs)}`
      : 'Letting the seat go…';
    el.classList.toggle('urgent', secs > 0 && secs <= 10);
  });
}

// ─────────────────────────────────────────────────────────── countdowns ──
// The auction's clock and the bankrupt player's twenty seconds (1.0.7) are
// one control: a thick bar running down beside its seconds, warming over the
// last five. Every one on screen — in the well, on a sheet — is painted by
// the one loop below, which puts itself away once none is left.

// How long a deadline had when this screen first saw it. A bid buys the
// auction a fresh, shorter deadline than the one it opened with (12 s against
// 20), so the bar has to be measured against the stretch it is actually
// counting down — a fixed span would refill to two-thirds and read as a timer
// that shrank when it had in fact just been extended. Measured off this
// device's own clock, it also starts full whatever the server's says.
//
// None of them is ever longer than twenty seconds — an auction opens with 20
// and a bid leaves 12, the bankrupt player gets 20 — so that is the ceiling
// for the span and for the seconds shown. A device whose clock runs behind
// the server's would otherwise read a deadline as further off than it is,
// and show a 26 s bar on a twenty-second question.
const COUNT_MAX_MS = 20000;
const countSpans = new Map();
function spanOf(kind, endsAt) {
  const key = `${kind}:${endsAt}`;
  if (!countSpans.has(key)) {
    if (countSpans.size > 32) countSpans.clear();
    countSpans.set(key, Math.min(COUNT_MAX_MS, Math.max(1000, Number(endsAt) - Date.now())));
  }
  return countSpans.get(key);
}

/** A countdown to `endsAt`, as markup; paintCountdowns() moves it. */
function countdownHTML(kind, endsAt) {
  const ends = Number(endsAt) || 0;
  return `<div class="mm-count" data-ends="${ends}" data-span="${Math.round(spanOf(kind, ends))}" role="timer">
      <span class="mm-track"><i></i></span><b class="mm-secs"></b>
    </div>`;
}

// The loop runs only while some bar on screen still has time to lose: once
// every one reads 0s there is nothing left to move, and the next render that
// draws a countdown calls this again.
let countRaf = 0;
function paintCountdowns() {
  cancelAnimationFrame(countRaf);
  countRaf = 0;
  const all = document.querySelectorAll('.mm-count[data-ends]');
  if (!all.length) return;
  const now = Date.now();
  let running = false;
  all.forEach((el) => {
    const left = Math.min(COUNT_MAX_MS, Math.max(0, Number(el.dataset.ends) - now));
    if (left > 0) running = true;
    const fill = el.querySelector('.mm-track > i');
    if (fill) fill.style.transform = `scaleX(${Math.min(1, left / (Number(el.dataset.span) || 1)).toFixed(4)})`;
    const secs = `${Math.ceil(left / 1000)}s`;
    const label = el.querySelector('.mm-secs');
    if (label && label.textContent !== secs) label.textContent = secs;
    el.classList.toggle('warm', left > 0 && left <= 5000);
  });
  if (running) countRaf = requestAnimationFrame(paintCountdowns);
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

/**
 * The board shelf inside the shop.
 *
 * Its own function rather than another `section(kind)` because a board is not
 * a piece: it is sold on how it looks, so the card carries a drawing of the
 * board instead of an emoji, and it says out loud when a board is free today
 * — the shop's job is to sell one, not to sell one to somebody who could have
 * had it for nothing this afternoon.
 */
function boardSection(items, wallet, coins, shelf) {
  const byMap = new Map((shelf?.boards || []).map((b) => [b.id, b]));
  // In today's shelf order, the one the pickers and both apps' stores use.
  // The catalogue's own order is fixed, so laid out as it comes it would park
  // the same boards at the front for ever under a line promising a redeal
  // every morning. With no shelf to hand the sort is stable and changes
  // nothing.
  const at = (i) => byMap.get(i.mapId)?.shelf ?? 1e9;
  const boards = items.filter((i) => i.kind === 'board').sort((a, b) => at(a) - at(b));
  if (!boards.length) return '';
  const card = (i) => {
    const owned = wallet.owned?.includes(i.id);
    const m = byMap.get(i.mapId);
    const freeNow = m?.how === 'today';
    const price = m?.price ?? i.price;
    const short = !owned && coins < price;
    // Worked out from the two numbers on the card rather than the headline
    // rate: prices round to the nearest 25, so a flat "30% off" was wrong on
    // six of the seven price points, overstating it on three.
    const flag = freeNow ? 'Free today'
      : m?.was ? `${Math.round((1 - price / m.was) * 100)}% off` : '';
    return `<button class="store-card board-card ${owned ? 'owned' : ''} ${short ? 'locked' : ''}"
        data-item="${i.id}" data-kind="board" data-owned="${owned ? 1 : 0}"
        title="${owned ? 'Yours' : short ? `${price - coins} more coins needed` : escapeHtml(i.name)}">
        ${m ? miniBoard(m.preview) : ''}
        <span class="sc-name">${escapeHtml(m?.name || i.name)}</span>
        ${m ? `<span class="sc-cities">${escapeHtml(boardTeaser(m))}</span>` : ''}
        <span class="sc-price">${owned ? '✓ Yours'
          : `${icon('coin', 13)} ${m?.was ? `<s>${m.was}</s> ` : ''}${price}`}</span>
        ${flag && !owned ? `<span class="sc-flag ${freeNow ? '' : 'gold'}">${flag}</span>` : ''}
      </button>`;
  };
  return `
    <h3 class="map-section">${icon('map')} Boards</h3>
    <p class="sub">Classic is free forever and two more every day. Three boards are on sale, and the
      shelf is redealt every morning. Only the host needs to own a board — everyone at the table plays it.</p>
    <div class="store-grid board-store-grid">${boards.map(card).join('')}</div>`;
}

export function openStoreModal(token, onWallet, scrollTo = 0, focusItem = '') {
  Promise.all([
    fetch(api('/api/store')).then((r) => r.json()),
    fetch(api(`/api/wallet?token=${encodeURIComponent(token)}`)).then((r) => r.json()),
    // Boards are on this shelf too, and a board is sold on the strength of
    // what it looks like — so the catalogue row is not enough. The shelf
    // carries the thumbnail, and which two are free today, which is the one
    // thing that can make a card here say "don't buy me yet".
    loadBoardShelf(token, true),
  ]).then(([storeData, wallet, shelf]) => {
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
      ${boardSection(items, wallet, coins, shelf)}
      <div class="modal-actions"><button class="btn ghost" id="stClose">Close</button></div>`, (root) => {
      const sheet = $('.modal', root);
      sheet.scrollTop = scrollTo;
      // Arriving from a locked card somewhere else: the shop is long, and the
      // thing they tapped is the only thing they came for. Scroll to it here
      // rather than from the caller — the caller has no idea when this sheet
      // finishes painting, and a timer that guesses gets it wrong on a slow
      // connection every time.
      if (focusItem) showPieceInStore(focusItem);
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
          // there is nothing to await here — just go. Only to Stripe, though:
          // a card form anywhere else is not one this game asked for.
          if (/^https:\/\/checkout\.stripe\.com\//.test(out.url || '')) { location.href = out.url; return; }
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
          if (kind === 'board' && card.dataset.owned !== '1') {
            // The board shelf in the shop goes through the same sheet as the
            // one in the lobby, so a board is bought one way in this app.
            const at = sheet.scrollTop;
            return openBoardBuy(token, id.slice(4),
              () => openStoreModal(token, onWallet, at, focusItem));
          }
          if (kind === 'board') return;   // already yours; nothing to equip
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
            // Buying auto-equips; tapping an equipped item takes it off. A
            // board is worn by the table, not by the player, so it has no
            // slot to go in and this step is simply not for it.
            if (kind !== 'board') {
              await fetch(api('/api/store/equip'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, slot: kind, itemId: equipped ? null : id }),
              });
            }
            closeModal();
            openStoreModal(token, onWallet, at, focusItem);   // re-render with fresh wallet
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

// Some sheets outlive the state that opened them — building from the deed
// sheet must leave the numbers fresh, and the table's rules must follow a
// host still changing them in the lobby — so the open one registers a
// repainter the render loop calls. There is one modal root, so one slot.
let sheetRepaint = null;

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
  sheetRepaint?.(state);
}

/** Is a sheet already holding the screen? An offer waits its turn. */
export function isModalOpen() {
  return !$('#modalRoot')?.classList.contains('hidden');
}

export function closeModal() {
  const root = $('#modalRoot');
  sheetRepaint = null;
  runModalCleanup();
  root.classList.add('hidden');
  root.innerHTML = '';
}

export function openModal(html, onMount, extraClass = '') {
  const root = $('#modalRoot');
  sheetRepaint = null; // a new sheet replaces whatever was repainting
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

/**
 * Two ways out of a live game, spelled out — one keeps the chair, one doesn't.
 * A walkout's streets go where a bankrupt's do (1.0.6): back to the bank, or
 * under the hammer at a table that auctions estates — and at a table where
 * the bankrupt player decides (1.0.7), somebody walking out is not there to
 * be asked, so the house decides for them. Giving up at that table asks the
 * question on the next sheet (see giveUp). Both lines follow estateFate, so
 * once no sale can happen — the clock has run out, or too few are left to
 * bid — they say the deeds go back to the bank, and no choice is promised.
 */
export function openLeaveModal({ onKeepSeat, onQuit, onConcede, state = null, meId = null }) {
  const fate = estateFate(state, meId);
  const walkout = {
    auction: 'Your properties are auctioned to the other players one at a time and the table plays on without you.',
    ask: 'The house decides whether your properties go back to the bank or to auction, and the table plays on without you.',
  }[fate] || 'Your deeds go back to the bank and the table plays on without you.';
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
        <span>${walkout}</span>
      </button>
      ${onConcede ? `<button class="leave-choice bad" id="lConcede">
        <b>${icon('skull')} Give up — declare bankruptcy</b>
        <span>${fate === 'ask'
          ? 'You go bankrupt on the spot, choose where your properties go, and keep your seat to watch the end.'
          : 'You go bankrupt on the spot but keep your seat to watch the end.'}</span>
      </button>` : ''}
    </div>
    <p class="karma-note">Leaving or timing out costs 1 karma.</p>
    <div class="modal-actions"><button class="btn ghost" id="lStay">Stay in the game</button></div>`, (root) => {
    $('#lStay', root).onclick = closeModal;
    $('#lBack', root).onclick = () => { sfx.click(); closeModal(); onKeepSeat(); };
    $('#lQuit', root).onclick = () => { sfx.click(); closeModal(); onQuit(); };
    const con = $('#lConcede', root);
    if (con) con.onclick = () => { sfx.click(); closeModal(); onConcede(); };
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
  // Build all earns its place only when it would do something ＋ does not:
  // one more building is one tap either way.
  const sweep = street ? buildAllCount(state, meId, i) : 0;
  const groupName = state.groups?.[tile.group]?.name || tile.group || 'this country';
  const sellable = canSellOn(state, meId, i);
  const canAfford = cash >= houseCost;
  const mortgageable = canMortgage(state, meId, i);
  const canLift = own.mortgaged && state.settings.mortgage && state.turn?.playerId === own.owner;

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
        <button class="qb-btn" data-qb-build title="Build for $${houseCost}" ${buildable && canAfford ? '' : 'disabled'}>＋</button>
        ${sweep > 1 ? `<button class="qb-btn all" data-qb-build-all
            title="Build ${sweep} buildings across ${escapeHtml(groupName)} in one go"
            >${icon('houses')} All ×${sweep}</button>` : ''}` : ''}
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
    // Somebody else's deed carries the same "Ask for it" as the "1 away" row,
    // under the same rule, so nobody has to go looking for who holds it.
    const ask = canAskFor(s, meId, i)
      ? '<button class="btn tiny gold" data-deed-ask>Ask for it</button>' : '';
    sheet.innerHTML = `${deedMarkup(s, i, {
      actions: isMine ? quickBuildBar(s, meId, i) : '', ask, facts: factsFor(s.map.tiles[i]),
    })}
      <div class="modal-actions"><button class="btn ghost" data-deed-close>Close</button></div>`;
    sheet.querySelector('[data-deed-close]').onclick = closeModal;
    // The composer opens with this deed already on their side, aimed at
    // whoever holds it now — the state of this paint, not the one that
    // first opened the sheet, since the deed may have moved since.
    const askBtn = sheet.querySelector('[data-deed-ask]');
    if (askBtn) {
      askBtn.onclick = () => {
        sfx.click();
        closeModal();
        openTradeModal(s, meId, own.owner, actions, { get: { tiles: [i] } });
      };
    }
    const tap = (attr, fn, sound) => {
      const b = sheet.querySelector(`[${attr}]`);
      if (b && !b.disabled) b.onclick = () => { (sound || sfx.click)(); fn(i); };
    };
    tap('data-qb-build', actions.build, sfx.build);
    // The whole country: the server takes the country's key, not a tile.
    const allBtn = sheet.querySelector('[data-qb-build-all]');
    if (allBtn && !allBtn.disabled) {
      allBtn.onclick = () => { sfx.build(); actions.buildAll(s.map.tiles[i].group); };
    }
    tap('data-qb-sell', actions.sellHouse);
    tap('data-qb-mort', actions.mortgage, sfx.cash);
    tap('data-qb-unmort', actions.unmortgage, sfx.cash);
  };

  openModal('', (root) => {
    const sheet = $('.modal', root);
    let shown = state;
    const repaint = (s) => { shown = s; paint(s, sheet); };
    repaint(state);
    sheetRepaint = repaint;
    // The facts usually come from storage at once; when they arrive (or
    // change) over the wire instead, the card gains its footnote in place —
    // if it is still this card that is open.
    loadFacts().then((changed) => { if (changed && sheetRepaint === repaint) repaint(shown); });
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
// A continent has no one flag to fly, and its mark is an emoji nothing here
// draws, so it wears the folded map — the same badge the iOS and Android
// pickers give it, and not the globe, which is Classic's.
const mapArt = (m) => (MAP_ART[m.id] ? icon(MAP_ART[m.id], 17)
  : String(m.id).startsWith('continent-') ? icon('map', 17)
    : groupFlag(m.icon, m.preview?.colors?.[1], 17));

/**
 * A cup prize, written the way the reader reads money.
 *
 * The owner sets one number and the server converts it for whoever asked —
 * see fx.js. A converted figure always carries its "≈", because the prize is
 * the owner's number and this is a reading aid, not a promise.
 */
export function cupMoney(cup, place) {
  const local = cup?.local;
  if (local && local[place] != null) {
    return `≈${local.symbol || `${local.code} `}${Number(local[place]).toLocaleString('en-US')}`;
  }
  const cur = cup?.prize?.currency === 'USD' ? '$' : `${cup?.prize?.currency || ''} `;
  return `${cur}${Number(cup?.prize?.[place] ?? 0).toLocaleString('en-US')}`;
}

/**
 * A podium place already won that the podium has not caught up with, in the
 * apps' words — or '' when there is none.
 *
 * `placed` is written only once the final and the play-off are both in, and
 * until then a beaten finalist, the play-off's winner and a semi-final loser
 * left third by default (a bye, and nobody to play off against) all read
 * `out`. `settled` is the server saying which place is theirs already; the
 * card and the room both say it ahead of "out".
 */
export function cupSettledLine(cup) {
  if (cup?.state !== 'running' || cup.you?.placed) return '';
  switch (cup.you?.settled) {
    case 'first': return 'You won the final. The podium goes up once the play-off for third is done.';
    case 'second': return 'You finished second. The podium goes up once the play-off for third is done.';
    case 'third': return 'You finished third. The podium goes up once the final is done.';
    default: return '';
  }
}

/**
 * When a cup's rounds strike, on the reader's own clock.
 *
 * `times` are minutes past midnight where the organiser sits, and printing
 * them as they stand put "Rounds at 20:00" over a plan that said 14:30 for
 * anybody a few time zones away — two clocks on one screen. `at` is the same
 * slots as instants, so they print the way the plan prints: here. Moved onto
 * this clock, two slots either side of midnight can swap places, so they are
 * put back in the order the reader's day runs. A server from before `at`
 * only has the organiser's figures, and they are still better than nothing.
 */
function cupClock(schedule) {
  const at = (schedule?.at || []).filter((ms) => Number.isFinite(ms));
  if (at.length) {
    const seen = new Map();   // what is printed → minutes into the reader's day
    at.forEach((ms) => {
      const d = new Date(ms);
      const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (!seen.has(clock)) seen.set(clock, d.getHours() * 60 + d.getMinutes());
    });
    return [...seen].sort((a, b) => a[1] - b[1]).map(([clock]) => clock);
  }
  const pad = (n) => String(n).padStart(2, '0');
  return (schedule?.times || []).map((m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
}

/**
 * The tournament, opened.
 *
 * The card is a summary — a countdown, three prizes, one button. This is the
 * room behind it, and it answers the question a player in a cup actually has
 * at nine in the evening: not "what round am I in" but "who do I play, when
 * does the door open, and what happens if I miss it". That goes at the top.
 */
export function openCupDetail(cup, token, onJoin) {
  const money = (place) => cupMoney(cup, place);
  const you = cup.you || {};
  const next = you.next || null;
  const num = (n) => Number(n || 0).toLocaleString('en-US');

  // "Round X of Y". The server works it out for every client now, and it
  // cannot slip at either end: never "0 of 3" before the draw, never "4 of 3"
  // for the play-off beside the final. A server from before `progress` gets
  // the same sum done here off the plan, clamped the same way.
  const progress = cup.progress?.of ? cup.progress : (() => {
    const of = Math.max(1, (cup.plan || []).length);
    return { round: Math.min(of, Math.max(1, you.round || cup.rounds || 1)), of };
  })();

  const pool = (() => {
    const l = cup.local;
    if (l && l.first != null) {
      return `≈${l.symbol || `${l.code} `}${num(l.first + l.second + l.third)}`;
    }
    const cur = cup.prize?.currency === 'USD' ? '$' : `${cup.prize?.currency || ''} `;
    return `${cur}${num((cup.prize?.first || 0) + (cup.prize?.second || 0) + (cup.prize?.third || 0))}`;
  })();

  // On the reader's clock, like the plan below it — see cupClock.
  const schedLine = (() => {
    const clock = cupClock(cup.schedule);
    if (!clock.length) return '';
    const joined = clock.length === 1 ? clock[0]
      : `${clock.slice(0, -1).join(', ')} and ${clock[clock.length - 1]}`;
    return `Rounds at ${joined} · ${cup.schedule.windowMinutes} minutes to turn up`;
  })();

  const nextBlock = next ? `<div class="cd-next ${next.open ? 'open' : ''}">
      <div class="cd-next-head">${next.open ? 'Your match is open' : 'Your next match'}</div>
      <div class="cd-vs">
        <span class="cd-side mine">${escapeHtml(you.name || 'You')}</span>
        <span class="cd-v">v</span>
        <span class="cd-side">${escapeHtml(next.opponent || 'a bye')}</span>
      </div>
      <div class="cd-when" id="cdWhen"></div>
      ${next.roomId ? `<button class="btn primary wide" id="cdPlay">${icon('dice', 15)} Play your match</button>` : ''}
    </div>` : '';

  // Knocked out, said in so many words. The card has always said it; the room
  // behind it never did, so somebody who opened it after losing found the
  // plan and the rules and nothing about themselves. It borrows the next
  // match's box, because it sits where that box stood while there was one.
  //
  // A place already won comes ahead of it: a beaten finalist is out of the
  // cup and second in it, and for the minutes the other game runs the second
  // is the news. See cupSettledLine.
  const settledLine = cupSettledLine(cup);
  const standBlock = settledLine ? `<div class="cd-next cup-in ok">
      ${icon('trophy', 15)} <span>${settledLine}</span>
    </div>` : you.joined && you.out ? `<div class="cd-next cup-in">
      ${icon('skull', 15)} <span>You are out of this one. The chart below ${cup.state === 'done'
    ? 'shows how it finished' : 'follows the rest of it'}.</span>
    </div>` : '';

  // Your own run, a rung for every round you were drawn in — the server says
  // them all, each named the way the chart names it, so the whole bracket (a
  // separate fetch) is not needed and this still opens instantly.
  //
  // A server from before `run` sent only the round on the card, and that is
  // still read when the list is missing: one rung is less than the story,
  // but it is not nothing.
  const myName = you.name;
  const rungs = [];
  const r = cup.round;
  const rungOf = (x) => {
    const other = x.opponent ? escapeHtml(x.opponent) : '';
    switch (x.result) {
      case 'waiting': return { cls: 'live', line: other ? `waiting to play ${other}` : 'waiting for a table' };
      case 'playing': return { cls: 'live', line: `playing ${other || '…'}` };
      case 'bye': return { cls: 'won', line: 'a bye — straight through' };
      case 'won': return {
        cls: 'won',
        line: x.walkover ? `through — ${other || 'the other side'} never came` : `beat ${other || 'a walkover'}`,
      };
      case 'lost': return {
        cls: 'lost',
        line: x.walkover ? `missed the door — ${other || 'the other side'} went through`
          : `lost to ${other || 'the other side'}`,
      };
      case 'void': return { cls: 'lost', line: 'nobody came' };
      default: return { cls: '', line: other ? `against ${other}` : '' };
    }
  };
  if (Array.isArray(you.run)) {
    you.run.forEach((x) => rungs.push({ label: x.label || `Round ${x.round || 1}`, ...rungOf(x) }));
  } else if (myName && r?.matches) {
    r.matches.forEach((m) => {
      if (m.a !== myName && m.b !== myName) return;
      const other = m.a === myName ? m.b : m.a;
      const won = m.winner === myName;
      rungs.push({
        label: r.kind === 'final' ? 'The final' : `Round ${r.n || 1}`,
        line: m.state !== 'done' ? `playing ${escapeHtml(other || '…')}`
          : won ? `beat ${escapeHtml(other || 'a walkover')}`
            : `lost to ${escapeHtml(m.winner || 'the other side')}`,
        cls: m.state !== 'done' ? 'live' : won ? 'won' : 'lost',
      });
    });
  }

  const standings = cup.standings?.first ? `<div class="chart-label">Final standings</div>
    <div class="chart-podium">
      ${['first', 'second', 'third'].map((place, i) => {
    const who = cup.standings[place];
    const mine = who?.code && who.code === you.code;
    return `<div class="cup-step ${place} ${mine ? 'mine' : ''}">
          <span class="cup-place">${['1st', '2nd', '3rd'][i]}</span>
          <b>${who ? escapeHtml(who.name) : '—'}</b>
          <span class="cup-won">${money(place)}</span>
          ${who?.code && !mine ? `<button class="icon-btn cd-add" data-ask="${escapeHtml(who.code)}"
            title="Ask ${escapeHtml(who.name)} to be friends">${icon('people', 13, 'solo')}</button>` : ''}
        </div>`;
  }).join('')}
    </div>` : '';

  openModal(`<div class="chart-head">
      <div>
        <h2>${escapeHtml(cup.name)}</h2>
        <p class="sub">${cup.needsCode ? 'Invite only' : 'Open to everyone'} · knockout — last one standing takes ${money('first')}</p>
        ${schedLine ? `<p class="sub">${icon('snooze', 12)} ${escapeHtml(schedLine)}</p>` : ''}
      </div>
      <button class="icon-btn" id="cdClose" title="Close">✕</button>
    </div>
    <div class="cd-tiles">
      <div><span>Prize pool</span><b>${pool}</b></div>
      <div><span>${cup.state === 'done' ? 'Finished' : 'Round'}</span><b>${cup.state === 'done' ? '—' : `${progress.round} of ${progress.of}`}</b></div>
      <div><span>Still in</span><b>${num(you.left ?? cup.entrants)}</b></div>
    </div>
    ${nextBlock}
    ${standBlock}
    ${rungs.length ? `<div class="chart-label">Your run</div>
      <ol class="cup-ladder">${rungs.map((x) => `<li class="${x.cls}">
        <span class="lad-dot"></span>
        <span class="lad-body"><b>${escapeHtml(x.label)}</b><span>${x.line}</span></span>
      </li>`).join('')}</ol>` : ''}
    ${standings}
    ${(cup.plan || []).length ? `<div class="chart-label">The whole plan</div>
      <div class="cd-plan">${cup.plan.map((r) => {
    const when = r.opensAt ? new Date(r.opensAt).toLocaleString([], {
      weekday: 'short', hour: '2-digit', minute: '2-digit',
    }) : '';
    return `<div class="cd-round ${r.done ? 'done' : ''} ${r.yours && !r.done ? 'yours' : ''}">
          <span class="cd-n">${r.n}</span>
          <span class="cd-what"><b>${escapeHtml(r.label)}</b>
            <span>${r.players} players → ${Math.ceil(r.players / 2)} through</span></span>
          <span class="cd-at"><b>${escapeHtml(when)}</b>
            <span>${r.done ? 'played' : r.projected ? 'planned' : ''}</span></span>
        </div>`;
  }).join('')}</div>` : ''}
    <button class="btn ghost small wide" id="cdChart">${icon('chart', 13)} See the whole chart</button>
    <div class="chart-label">How it works</div>
    <ul class="poster-rules">
      <li>Win your match and you go through. Lose it and you are out.</li>
      ${cup.schedule?.times?.length ? `<li>Each round opens at its time and stays open ${cup.schedule.windowMinutes} minutes. <b>Turn up inside that window or you are out</b> — even if you would have won.</li>` : ''}
      ${cup.schedule?.times?.length ? '<li>A game still running when the next round is due is decided on net worth — whoever is ahead goes through, so one long game never holds up everybody else\'s evening.</li>' : ''}
      <li>Prizes are paid by hand by whoever set the cup up. Keep your friend code.</li>
    </ul>`, (root) => {
    $('#cdClose', root).onclick = closeModal;
    $('#cdChart', root).onclick = () => openCupBracket(token, cup.id);
    const play = $('#cdPlay', root);
    if (play) play.onclick = () => { closeModal(); onJoin?.(next.roomId); };
    // The door's clock, ticking, because a countdown that only moves on a
    // refresh is not one.
    const when = $('#cdWhen', root);
    if (when && next) {
      const paint = () => {
        if (!when.isConnected) return clearInterval(timer);
        if (!next.open && next.opensAt) {
          when.textContent = `Opens in ${longCountdownText(next.opensAt - Date.now())}`;
          when.className = 'cd-when';
        } else if (next.closesAt) {
          when.textContent = `Door shuts in ${longCountdownText(next.closesAt - Date.now())} — miss it and you are out`;
          when.className = 'cd-when urgent';
        } else {
          when.textContent = 'Your table is being made…';
        }
      };
      paint();
      const timer = setInterval(paint, 1000);
    }
    root.querySelectorAll('[data-ask]').forEach((b) => {
      b.onclick = async () => {
        try {
          const res = await fetch(api('/api/friends'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, code: b.dataset.ask }),
          });
          const out = await res.json();
          b.textContent = out.ok ? '✓' : '✕';
          b.disabled = true;
        } catch { /* the next open of this sheet tries again */ }
      };
    });
  }, 'wide cup-detail');
}

/** Days and hours when it is far off, minutes and seconds when it is close. */
function longCountdownText(ms) {
  const left = Math.max(0, Math.round(ms / 1000));
  if (left >= 86400) return `${Math.floor(left / 86400)}d ${Math.floor((left % 86400) / 3600)}h`;
  if (left >= 3600) return `${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m`;
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────── the cup chart ──
/**
 * The bracket, as a chart you can read your own run off.
 *
 * Two things stacked: your path — the rounds you have played, who you beat
 * and where it ended — and then the whole tree, scrolled to your match. A
 * hundred entrants is fifty cards in the first column, which is a long
 * column and an honest one; the path above it is the part that answers
 * "where am I", and it stays short however big the cup gets.
 */
export function openCupBracket(token, cupId) {
  openModal(`<div class="chart-loading">${icon('trophy', 22, 'solo')}<p>Drawing the chart…</p></div>`,
    null, 'wide chart-modal');
  fetch(api(`/api/cup/bracket?token=${encodeURIComponent(token || '')}&cup=${encodeURIComponent(cupId || '')}`))
    .then((r) => r.json())
    .then((data) => {
      const b = data?.bracket;
      if (!b) return closeModal();
      openModal(chartHTML(b), (root) => {
        $('#chartClose', root).onclick = closeModal;
        // Land on your own match rather than on the top of a fifty-card
        // column somebody else is in.
        const mine = root.querySelector('.cup-match.mine.latest') || root.querySelector('.cup-match.mine');
        const tree = $('.cup-tree', root);
        if (mine && tree) {
          tree.scrollLeft = Math.max(0, mine.offsetLeft - tree.clientWidth / 2 + mine.offsetWidth / 2);
          tree.scrollTop = Math.max(0, mine.offsetTop - tree.clientHeight / 2 + mine.offsetHeight / 2);
        }
      }, 'wide chart-modal');
    })
    .catch(() => closeModal());
}

function chartHTML(b) {
  const money = (place) => cupMoney(b, place);
  const num = (n) => (n == null ? '' : Number(n).toLocaleString('en-US'));

  // Your run, round by round. The one part of this that stays readable at any
  // size, and the part that answers the only question a player really has.
  const myName = b.you?.name || null;
  const path = [];
  for (const r of b.rounds) {
    const m = r.matches.find((x) => x.mine);
    if (!m) continue;
    const other = m.a === myName ? m.b : m.a;
    const won = m.winner === myName;
    path.push({
      label: r.label,
      players: r.players,
      state: m.state,
      won,
      other,
      line: m.state !== 'done'
        ? (other ? `playing ${escapeHtml(other)}` : 'waiting for a table')
        : m.void ? 'nobody came'
          : won ? `beat ${escapeHtml(other || 'a walkover')}`
            : `lost to ${escapeHtml(m.winner || 'the other side')}`,
    });
  }
  const ladder = path.length ? `<ol class="cup-ladder">
      ${path.map((p) => `<li class="${p.state !== 'done' ? 'live' : p.won ? 'won' : 'lost'}">
          <span class="lad-dot"></span>
          <span class="lad-body">
            <b>${escapeHtml(p.label)}</b>
            <span>${p.line}</span>
          </span>
          <span class="lad-count">${p.players}</span>
        </li>`).join('')}
    </ol>` : '';

  const standing = (() => {
    if (!b.you) return `${b.entrants} entered`;
    if (b.you.placed) return `You finished ${b.you.placed} — ${money(b.you.placed)}`;
    if (b.you.out) return `Knocked out after ${path.filter((p) => p.won).length} won`;
    const live = path[path.length - 1];
    return live ? `You are in the ${live.label.toLowerCase()}` : `${b.entrants} entered`;
  })();

  const matchCard = (m, isLatestMine) => {
    const row = (name, score, won) => `<div class="cm-row ${won ? 'won' : ''} ${name ? '' : 'empty'}">
        <span class="cm-name">${name ? escapeHtml(name) : '—'}</span>
        <b class="cm-score">${m.state === 'done' && score != null ? num(score) : ''}</b>
      </div>`;
    return `<div class="cup-match ${m.mine ? 'mine' : ''} ${isLatestMine ? 'latest' : ''} ${m.state}">
        ${m.mine ? '<span class="cm-you">YOU</span>' : ''}
        ${row(m.a, m.aScore, m.winner && m.winner === m.a)}
        ${row(m.b, m.bScore, m.winner && m.winner === m.b)}
        ${m.void ? '<span class="cm-note">void</span>'
          : m.walkover ? '<span class="cm-note">walkover</span>' : ''}
      </div>`;
  };

  // The last round this player appears in — what the chart scrolls to.
  let latestMine = null;
  b.rounds.forEach((r, ri) => r.matches.forEach((m, mi) => { if (m.mine) latestMine = `${ri}:${mi}`; }));

  const tree = `<div class="cup-tree">
      ${b.rounds.map((r, ri) => `<div class="cup-col">
          <div class="cup-col-head">
            <b>${escapeHtml(r.label)}</b>
            <span>${r.players} left</span>
          </div>
          <div class="cup-col-body ${ri === b.rounds.length - 1 ? 'last' : ''}">
            ${r.matches.map((m, mi) => matchCard(m, `${ri}:${mi}` === latestMine)).join('')}
          </div>
        </div>`).join('')}
    </div>`;

  const podium = b.standings?.first ? `<div class="chart-podium">
      ${['first', 'second', 'third'].map((place, i) => {
    const who = b.standings[place];
    return `<div class="cup-step ${place}">
          <span class="cup-place">${['1st', '2nd', '3rd'][i]}</span>
          <b>${who ? escapeHtml(who.name) : '—'}</b>
          <span class="cup-won">${money(place)}</span>
        </div>`;
  }).join('')}
    </div>` : '';

  return `<div class="chart-head">
      <div>
        <h2>${escapeHtml(b.name)}</h2>
        <p class="sub">${escapeHtml(standing)}</p>
      </div>
      <button class="icon-btn" id="chartClose" title="Close">✕</button>
    </div>
    ${podium}
    ${ladder ? '<div class="chart-label">Your run</div>' : ''}
    ${ladder}
    <div class="chart-label">The chart</div>
    ${tree}`;
}

/**
 * The poster. What a cup is, in the order somebody deciding whether to enter
 * wants it: the prize, the shape of the thing, and the two rules that catch
 * people out.
 */
export function openCupPoster(cup) {
  const money = (place) => cupMoney(cup, place);
  // What this cup is committing its players to, in dates and hours.
  const sched = cup.schedule?.times?.length ? {
    windowMinutes: cup.schedule.windowMinutes || 10,
    matchMinutes: cup.schedule.matchMinutes || 90,
    // The reader's clock, as the join deadline and the final below are.
    clock: cupClock(cup.schedule).join(' and '),
  } : null;
  const plan = cup.plan || [];
  const shape = (() => {
    let n = Math.max(2, cup.maxPlayers || cup.entrants || 2), rounds = 0;
    while (n > 1) { n = Math.ceil(n / 2); rounds++; }
    return { rounds, evenings: Math.ceil(rounds / (cup.schedule?.times?.length || 2)) };
  })();
  const when = (ms) => new Date(ms).toLocaleString([], {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const shutAt = cup.closesAt ? when(cup.closesAt) : '';
  const finalAt = plan.length ? when(plan[plan.length - 1].opensAt) : '';

  // The ladder a cup of this size actually runs: 100 → 50 → 25 → …
  const rungs = [];
  let left = Math.max(2, cup.entrants || 2);
  for (let i = 0; i < 9 && left > 1; i++) { rungs.push(left); left = Math.ceil(left / 2); }
  rungs.push(1);

  openModal(`<div class="poster">
      <button class="icon-btn poster-x" id="posterClose" title="Close">✕</button>
      <div class="poster-top">
        <span class="poster-mark">${icon('trophy', 30, 'solo')}</span>
        <div class="poster-name">${escapeHtml(cup.name)}</div>
        <div class="poster-tag">Knockout · winner takes ${money('first')}</div>
      </div>
      <div class="poster-prizes">
        <div class="cup-prize gold"><span class="cup-place">1st</span><b>${money('first')}</b></div>
        <div class="cup-prize silver"><span class="cup-place">2nd</span><b>${money('second')}</b></div>
        <div class="cup-prize bronze"><span class="cup-place">3rd</span><b>${money('third')}</b></div>
      </div>
      <div class="poster-rungs">
        ${rungs.map((n, i) => `<span class="rung ${i === rungs.length - 1 ? 'last' : ''}">${n === 1 ? '🏆' : n}</span>`)
    .join('<i class="rung-arrow">→</i>')}
      </div>
      ${sched ? `<div class="poster-when">
        <div class="pw-line"><span>Joining shuts</span><b>${escapeHtml(shutAt)}</b></div>
        <div class="pw-line"><span>Rounds</span><b>${escapeHtml(sched.clock)}</b></div>
        <div class="pw-line"><span>Evenings</span><b>${shape.evenings} · ${shape.rounds} rounds</b></div>
        ${finalAt ? `<div class="pw-line"><span>The final</span><b>${escapeHtml(finalAt)}</b></div>` : ''}
      </div>` : ''}
      <ul class="poster-rules">
        <li><b>Everyone enters at once.</b> When joining shuts the whole field is paired off — a hundred players make fifty tables.</li>
        <li><b>Win and you go through. Lose and you are out.</b> One defeat ends your tournament: there is no second chance and no losers' bracket.</li>
        ${sched ? `<li><b>Turn up inside the window.</b> Each round opens at its time and stays open ${sched.windowMinutes} minutes. Miss it and you are out — even if you would have won.</li>
        <li><b>Every game is ${sched.matchMinutes} minutes.</b> Nobody bankrupt by then? The player with the higher net worth goes through.</li>` : ''}
        <li><b>Two seats, no bots.</b> A cup table cannot be filled with house players, and the link cannot seat a third.</li>
      </ul>
      <p class="poster-foot">${cup.local ? `Prizes are set in ${escapeHtml(cup.prize?.currency || 'USD')} and shown here in your own money at today’s rate. ` : ''}Entering needs an account, because a prize needs somebody to pay. Prizes are paid by hand — keep your friend code.</p>
    </div>`, (root) => {
    $('#posterClose', root).onclick = closeModal;
  }, 'poster-modal');
}

/**
 * Every board there is, and what standing you have with each of them.
 *
 * Three shelves, in the order somebody actually shops: what is free right now,
 * what they already own, and what is still behind a price. A locked card is a
 * door into the shop rather than a dead one — the same manners the piece
 * shelf keeps.
 *
 * `mayRent` rides through to the buy sheet: a one-game pass is read against
 * the host's wallet, so it is the host's to spend and nobody else's.
 */
export function openBoardModal(state, actions, token, onChange, mayRent = false) {
  // Asked about this table, so a board rented for it reads as playable here
  // rather than as one more locked card with a price on it.
  loadBoardShelf(token, true, state.id).then((shelf) => {
    if (!shelf) return toast('Boards are unreachable', 'error');
    const cur = currentMapId(state);
    const card = (m) => `<button class="map-card ${m.id === cur ? 'sel' : ''} ${m.playable ? '' : 'locked'}"
          data-map="${m.id}" data-playable="${m.playable ? 1 : 0}">
          ${miniBoard(m.preview)}
          <span class="mn">${mapArt(m)} ${escapeHtml(m.name)}</span>
          <span class="md">${escapeHtml(m.description)}</span>
          <span class="mcities">${escapeHtml(boardTeaser(m))}</span>
          <span class="mstats">
            <b>${m.size}</b> tiles · <b>${m.streets}</b> streets · <b>${m.countries}</b> sets
          </span>
          ${boardTag(m)}
        </button>`;

    const free = shelf.boards.filter((m) => m.how === 'house' || m.how === 'today' || m.how === 'rented');
    const mine = shelf.boards.filter((m) => m.how === 'owned');
    const locked = shelf.boards.filter((m) => m.how === 'locked');
    const shelfOf = (list, title, sub) => (list.length ? `
      <h3 class="map-section">${title}</h3>
      <p class="sub">${sub}</p>
      <div class="map-grid">${list.map(card).join('')}</div>` : '');

    openModal(`
      <div class="store-head">
        <h2>Boards</h2>
        <span class="coin-chip">${icon('coin')} ${shelf.coins ?? 0}</span>
        <button class="icon-btn sheet-x" id="bdX" title="Close" aria-label="Close">✕</button>
      </div>
      <p class="sub" id="bdClock"></p>
      ${shelfOf(free, `${icon('map')} Playable now`,
        `Classic is always free. Two more rotate every day — every board comes round once every ${shelf.cycleDays} days.`)}
      ${shelfOf(mine, `${icon('key')} Yours`, 'Bought and kept. Play them whenever you like.')}
      ${shelfOf(locked, `${icon('coin')} In the store`,
        mayRent
          ? `Buy one and it is yours for good — or pay ${shelf.rent?.price ?? 1} coin to play it once, here at this table. Everyone plays it with you; only the host needs it.`
          : 'Buy one and it is yours for good. Everyone at your table plays it with you; only the host needs it.')}
      <div class="modal-actions"><button class="btn ghost" id="mClose">Close</button></div>`, (root) => {
      const clock = $('#bdClock', root);
      const tick = () => {
        const left = shelf.until - Date.now();
        if (left <= 0) return closeModal();
        clock.textContent = `Today's free boards change in ${longCountdownText(left)}.`;
      };
      tick();
      const timer = setInterval(() => (clock.isConnected ? tick() : clearInterval(timer)), 1000);

      root.querySelectorAll('[data-map]').forEach((c) => {
        c.onclick = () => {
          sfx.click();
          const id = c.dataset.map;
          if (c.dataset.playable !== '1') {
            openBoardBuy(token, id, (bought) => {
              actions.settings({ mapId: bought });
              onChange?.();
            }, state.id, mayRent);
            return;
          }
          actions.settings({ mapId: id });
          closeModal();
          onChange?.();
        };
      });
      $('#mClose', root).onclick = closeModal;
      $('#bdX', root).onclick = closeModal;
    }, 'wide');
  });
}

// The prison row is the paragraph the phones and /how-to-play print word for
// word. The third miss used to cost the $50 fine; since 1.0.6 it walks the
// player out for nothing, and a sheet that still said "you pay anyway" would
// be telling somebody to fear a charge the table no longer makes. The
// bankruptcy row had the same kind of lie in it: the streets never went to
// the creditor, only the cash already raised did.
const RULES_HELP = [
  ['dice', 'Rolling', 'Roll two dice and move. A double lets you roll again — but three doubles in a row sends you straight to prison.'],
  ['key', 'Buying', 'Land on an unowned street, airport or utility and you may buy it. Turn it down and it goes to auction, where everyone can bid.'],
  ['crane', 'Building', 'Own every street of one country and you can build houses, then a hotel. Rent climbs steeply with each one.'],
  ['payment', 'Rent', 'Land on someone else’s property and you pay their rent. Airports scale 25 / 50 / 100 / 200; utilities charge 4× or 10× your roll.'],
  ['bank', 'Mortgage', 'Short of cash? Mortgage a property for half its price. Mortgaged streets collect no rent until you buy them back at 10% interest.'],
  ['trade', 'Trading', 'Offer any mix of cash, properties and prison cards to any player, at any time. Streets with buildings can’t be traded. Every open offer is shown to the whole table; only the player it is sent to can answer it.'],
  ['police', 'Prison', 'Land on Go to Prison, draw the card, or roll three doubles in a row, and you are locked up. On each turn inside you can roll for a double, which walks you out and moves you by that roll. You can also pay the $50 fine before rolling, which opens the door but ends that turn, or use a get-out card. If your third roll still is not a double, you walk out for free and move by that roll anyway.'],
  ['skull', 'Bankruptcy', 'Owe more than you can raise and you must sell, mortgage or trade. Give up and you are out: what you raised stays with whoever you owed, and your properties go back to the bank — or to auction, or you choose which, if the table says so. Last player standing wins.'],
];

// ────────────────────────────────────────────────────────── first minutes ──
// The same six cards the app shows a new player, word for word, so somebody
// who learns the game in a browser and finishes it on a phone is never told
// two different things.
//
// Skippable from the first frame, and reachable again from the help sheet, so
// skipping it costs nothing.

export const INTRO_VERSION = 1;

const INTRO_PAGES = [
  {
    icon: 'globe',
    title: 'Welcome to MoneyMove',
    line: 'Buy streets. Build hotels. Bankrupt your friends.',
    points: [
      ['people', 'Two to eight players, on one screen or across the world'],
      ['map', 'Twenty-five boards — a world tour, six continents, single countries, and a few odd ones'],
      ['dice', 'A game runs about half an hour'],
    ],
  },
  {
    icon: 'dice',
    title: 'A turn is three things',
    line: 'Roll, move, and deal with wherever you land.',
    points: [
      ['dice', 'Roll two dice and move. A double lets you roll again — three in a row and you are in prison'],
      ['key', 'Land on a street nobody owns and you may buy it. Turn it down and everyone bids for it'],
      ['payment', "Land on somebody else's and you pay their rent"],
    ],
  },
  {
    icon: 'houses',
    title: 'Whole sets win games',
    line: 'One street collects pennies. A country collects the game.',
    points: [
      ['crane', 'Own every street of one colour and you can build — houses first, then a hotel'],
      ['cash', 'Rent climbs steeply with each one. A hotel on a good set ends most games'],
      ['warning', 'This is the rule new players lose to. Chase sets, not bargains'],
    ],
  },
  {
    icon: 'trade',
    title: 'Deals decide it',
    line: 'Nobody completes a set by luck alone.',
    points: [
      ['trade', 'Offer cash, streets and prison cards to anyone, any time'],
      ['gavel', 'A street somebody refuses goes to auction — that is where sets get finished'],
      ['bank', 'Short of money? Mortgage a street for half, and buy it back later'],
    ],
  },
  {
    icon: 'people',
    title: 'Play with anyone',
    line: 'One tap and you are at a table.',
    points: [
      ['bolt', 'Play now drops you in with whoever else is online'],
      ['door', 'Or make a private room and send the link to your friends'],
      ['ticket', 'Nobody around? Share one screen and pass it around the table'],
    ],
  },
  {
    icon: 'trophy',
    title: 'Cups, coins and boards',
    line: 'There is more here than one game.',
    points: [
      ['trophy', 'Tournaments run to a clock, with real prizes for the last few standing'],
      ['coin', 'Win games and turn up daily to earn coins'],
      ['map', 'Two boards are free every day. Spend the coins to keep the ones you love'],
    ],
  },
];

export function openIntroModal(onDone) {
  let page = 0;
  const draw = (root) => {
    const p = INTRO_PAGES[page];
    const last = page === INTRO_PAGES.length - 1;
    $('#introBody', root).innerHTML = `
      <div class="intro-hero">${icon(p.icon, 54, 'solo')}</div>
      <h2 class="intro-title">${escapeHtml(p.title)}</h2>
      <p class="intro-line">${escapeHtml(p.line)}</p>
      <div class="intro-points">
        ${p.points.map(([g, text]) => `<div class="ip-row">
          <span class="ip-ico">${icon(g, 17)}</span>
          <span>${escapeHtml(text)}</span>
        </div>`).join('')}
      </div>`;
    $('#introDots', root).innerHTML = INTRO_PAGES
      .map((_, i) => `<i class="${i === page ? 'on' : ''}"></i>`).join('');
    $('#introNext', root).textContent = last ? "Let's play" : 'Next';
    $('#introNext', root).classList.toggle('gold', last);
  };

  openModal(`
    <div class="intro">
      <button class="intro-skip" id="introSkip">Skip</button>
      <div id="introBody"></div>
      <div class="intro-dots" id="introDots"></div>
      <button class="btn primary big wide" id="introNext">Next</button>
      <p class="intro-foot">You can read all this again from the ? in the corner.</p>
    </div>`, (root) => {
    draw(root);
    const done = () => { closeModal(); onDone?.(); };
    $('#introSkip', root).onclick = () => { sfx.click(); done(); };
    $('#introNext', root).onclick = () => {
      sfx.click();
      if (page === INTRO_PAGES.length - 1) return done();
      page++;
      draw(root);
    };
  }, 'intro-modal');
}

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
    <div class="modal-actions">
      <button class="btn ghost" id="hIntro">Show me the basics</button>
      <button class="btn primary" id="hClose">Got it</button>
    </div>`, (root) => {
    $('#hClose', root).onclick = closeModal;
    // Skipping the six cards has to cost nothing, which means they have to be
    // findable afterwards — and this sheet is where somebody looks.
    $('#hIntro', root).onclick = () => { sfx.click(); closeModal(); openIntroModal(); };
  });
}

// ─────────────────────────────────────────────────── this table's rules ──
// The toolbar's i, beside the sound: every rule this table plays by, in plain
// words, read off state.settings. The ? in the same toolbar is how the game
// works anywhere; this is how this table runs it — which a stranger who sat down at
// a Play-now table, a guest who never saw the host's lobby, and anybody
// watching from the rail had no other way to find out.

/**
 * The rules as three short lists of rows: [glyph, name, value, words, on].
 * `on` colours the value — true for a switch that is on, false for one that
 * is off, null for a value that is neither (a board, a sum, a length).
 *
 * A Play-now table and a cup table always play auction-only, the shuffled
 * board and the game clock at their defaults whatever the fields say — the
 * server checks them at its own door — so they are read the same way here
 * rather than taken on the field's word. Bankrupt properties is rolled at a
 * Play-now table since 1.0.7 and played as rolled; a cup still sends them to
 * the bank (estateRuleOf). A row may be null: a rule this table does not
 * have to tell anybody about.
 */
function tableRuleSections(state) {
  const s = state.settings || {};
  const own = !state.quick && !state.cup;
  const sw = (v) => (v ? 'On' : 'Off');
  const live = state.status !== 'lobby';
  const map = state.map || {};
  const sets = Object.keys(map.groups || {}).length;
  const squares = Number(map.size) || map.tiles?.length || 0;

  const seats = Math.floor(Number(s.maxPlayers) || 0);
  const seatWord = seats ? ` · ${seats} seats` : '';
  const table = state.cup ? ['Cup match', 'Two seats, set by the cup']
    : state.quick ? ['Play now', `A public table, matched with whoever was online${seatWord}`]
    : s.isPrivate ? ['Private', `Only people with the link can join${seatWord}`]
    : ['Public', `Listed under All rooms — anyone can take a free seat${seatWord}`];

  const teams = Math.floor(Number(s.teams) || 0);
  const turn = Math.floor(Number(s.turnSeconds) || 0);
  const minutes = own ? Math.floor(Number(s.timeLimit) || 0) : 0;
  // Bot skill is a row only where it is about somebody (1.0.7): the house
  // players the host sat down, or the ones Allow bots will deal in. A
  // Play-now table's house players always play the usual way and a cup has
  // none, so neither table prints it.
  const bots = botLevelOf(state);
  const botRow = own && houseAtTable(state) ? ['robot', 'Bot skill', bots.name, bots.desc, null] : null;

  // Where a bankrupt player's streets go is played at a Play-now table too
  // (1.0.7); only a cup is fixed to the bank.
  const estate = estateRuleOf(state);
  const auctionOnly = own && !!s.auctionOnly;
  // A shuffled game says so from the board it is playing, which is the truth
  // whatever the switch says; the lobby only has the switch, and the deal
  // that honours it is still to come.
  const shuffled = !!map.shuffled;
  const shuffle = shuffled || (own && !!s.shuffleBoard);
  const pot = Number(state.vacationPot) || 0;

  return [
    ['The table', [
      ['map', 'Board', map.name || 'Classic',
        shuffled ? 'Shuffled for this game — the colour sets sit in new places'
          : `${squares ? `${squares} squares` : ''}${squares && sets ? ', ' : ''}${sets ? `${sets} colour sets` : ''}`, null],
      [state.quick ? 'bolt' : state.cup ? 'trophy' : 'key', 'Table', table[0], table[1], null],
      ['cash', 'Starting cash', money(s.startingCash), 'What every player starts the game with', null],
      ['shield', 'Teams', teams > 0 ? `${teams} teams` : 'Off', teams > 0
        ? 'Teammates never charge each other rent and win together' : 'Every player for themselves', teams > 0],
      ['snooze', 'Turn clock', turn ? `${clockOptionLabel(turn)} a turn` : 'Off', turn
        ? 'Run out of time and the table moves on without you' : 'Take as long as you need', turn > 0],
      // A cup game has no host clock, but it is not unlimited: the cup blows
      // its whistle (see sweepCupNoShows on the server) and decides it on
      // net worth. A Play-now table really does play on to the last one.
      ['clock', 'Game length', state.cup ? 'Cup whistle' : minutes ? `${minutes} min` : 'Unlimited', state.cup
        ? 'A game still running at the cup’s whistle is decided on net worth — whoever is ahead goes through'
        : minutes ? 'When the clock runs out, the richest player wins' : 'Play on until one player is left standing', null],
      botRow,
      ['shuffle', 'Turn order', s.randomizeOrder ? 'Drawn' : 'As seated', s.randomizeOrder
        ? 'The order of play is drawn at random when the game starts'
        : 'Players take their turns in the order they sat down', null],
    ]],
    ['Streets and money', [
      ['coin', 'Double rent on full sets', sw(s.x2rent), s.x2rent
        ? 'Owning a whole country doubles its base rent' : 'A full set charges the rent on the deed', !!s.x2rent],
      ['gavel', 'Auctions', sw(s.auction), s.auction
        ? 'A street somebody turns down goes to the highest bidder'
        : 'A street somebody turns down stays with the bank', !!s.auction],
      ['gavel', 'Auction-only', sw(auctionOnly), auctionOnly
        ? 'Nobody buys at the price on the deed — every unowned street goes straight to auction'
        : 'Land on an unowned street and you may buy it at its price', auctionOnly],
      ['bank', 'Mortgages', sw(s.mortgage), s.mortgage
        ? 'Raise half a property’s price; it collects no rent until you buy it back at 10% interest'
        : 'Properties cannot be mortgaged at this table', !!s.mortgage],
      ['houses', 'Even building', sw(s.evenBuild), s.evenBuild
        ? 'Houses go up and come down evenly across a set'
        : 'Build on any street of a full set, in any order', !!s.evenBuild],
      ['skull', 'Bankrupt properties', estate.value, estate.id === 'choose'
        ? 'The player who goes bankrupt picks: back to the bank, or auctioned to everyone one by one. Twenty seconds to choose, then the house picks whatever keeps the game close'
        : estate.desc, null],
      ['shuffle', 'Shuffled board', sw(shuffle), !shuffle ? 'Every street sits where the board prints it'
        : live ? 'The colour sets were dealt to new places for this game — prices and rents moved with them'
        : 'The colour sets are dealt to new places when the game starts — prices and rents move with them', shuffle],
      ['island', 'Vacation cash', sw(s.vacationCash), s.vacationCash
        ? `Taxes and fines pile up and go to whoever lands on Vacation${live && pot > 0 ? ` — ${money(pot)} in the pot now` : ''}`
        : 'Taxes and fines go to the bank', !!s.vacationCash],
    ]],
    ['Prison', [
      ['police', 'Getting out', '3 tries',
        'Roll a double to walk out and move by that roll. Paying the $50 fine before rolling opens the door but ends that turn; a get-out card lets you roll. Miss the third try and you walk out free, moving by that roll anyway.', null],
      ['police', 'No rent while in prison', sw(s.noRentInPrison), s.noRentInPrison
        ? 'Owners in prison collect no rent' : 'Owners keep collecting rent from inside', !!s.noRentInPrison],
    ]],
  ];
}

/** Who decided this table's rules — the line under the sheet's title. */
function tableRulesWho(state) {
  if (state.cup) return 'Set by the cup — the same for both seats.';
  if (state.quick) {
    const n = state.quickRoll?.edited?.length || 0;
    return n ? `Rolled by Play now — the host changed ${n}.` : 'Rolled by Play now when the table was made.';
  }
  return state.status === 'lobby'
    ? 'Set by the host — they can still change them until the game starts.'
    : 'Set by the host before the game started.';
}

function tableRulesHTML(state) {
  return `<p class="sub">${escapeHtml(tableRulesWho(state))}</p>
    ${tableRuleSections(state).map(([title, rows]) => `
      <p class="tr-head">${escapeHtml(title)}</p>
      <div class="tr-list">${rows.filter(Boolean).map(([glyph, name, value, words, on]) => `
        <div class="tr-row">
          <span class="tr-ico">${icon(glyph, 19, 'solo')}</span>
          <div class="tr-main">
            <div class="tr-name"><b>${escapeHtml(name)}</b><span class="tr-val${on === true ? ' on' : on === false ? ' off' : ''}">${escapeHtml(value)}</span></div>
            ${words ? `<div class="tr-desc">${escapeHtml(words)}</div>` : ''}
          </div>
        </div>`).join('')}
      </div>`).join('')}`;
}

/**
 * The sheet. It follows the live state while it is open, so a host flipping
 * a switch in the lobby is seen flipping it — but only repaints when one of
 * the things it prints has moved, so a rent payment does not jump the list
 * back to the top under somebody reading the bottom of it.
 */
export function openTableRulesModal(state) {
  if (!state?.settings) return;
  // The Bot skill row follows houseAtTable, which also moves with the seats
  // alone — the last chair filling leaves Allow bots nobody to deal in — so
  // the signature carries its answer rather than only whether a house
  // player is sitting down.
  const sig = (s) => `${JSON.stringify(s.settings)}:${s.map?.uid || s.map?.id}:${s.map?.shuffled ? 1 : 0}:`
    + `${s.status}:${s.quick ? 1 : 0}:${s.cup ? 1 : 0}:${s.vacationPot || 0}:${(s.quickRoll?.edited || []).length}:`
    + `${houseAtTable(s) ? 1 : 0}`;
  openModal(`
    <h2>This table’s rules</h2>
    <div id="trBody"></div>
    <div class="modal-actions">
      <button class="btn ghost" id="trHelp">How to play</button>
      <button class="btn primary" id="trClose">Got it</button>
    </div>`, (root) => {
    const body = $('#trBody', root);
    let last = '';
    const paint = (s) => {
      if (!s?.settings) return;
      const now = sig(s);
      if (now === last) return;
      last = now;
      body.innerHTML = tableRulesHTML(s);
    };
    paint(state);
    sheetRepaint = paint;
    $('#trClose', root).onclick = closeModal;
    $('#trHelp', root).onclick = () => { sfx.click(); openHelpModal(); };
  }, 'table-rules');
}

export function openTradeModal(state, meId, targetId, actions, prefill = null) {
  const me = state.players.find((p) => p.id === meId);
  const them = state.players.find((p) => p.id === targetId);
  const listFor = (playerId) => Object.entries(state.ownership)
    .filter(([, o]) => o.owner === playerId)
    .map(([i, o]) => ({ i: Number(i), ...o }))
    .sort((a, b) => a.i - b.i);

  const side = (player, list, prefix, label, tone) => `
    <div class="trade-side ${tone}">
      <div class="trade-who">
        <span class="ts-label">${label}</span>
        <span class="ts-who"><span class="avatar xs" style="background:${player.color}">${escapeHtml((player.name[0] || '?').toUpperCase())}</span>${escapeHtml(player.name)}</span>
      </div>
      <div class="trade-list">
        ${list.length ? list.map((m) => {
          const t = state.map.tiles[m.i];
          const g = t.group ? state.groups[t.group] : null;
          const blocked = (m.houses || 0) > 0;
          const mark = `<span class="cr-flag">${tileMark(t, g, 18)}</span>`;
          return `<label class="check-row ${blocked ? 'blocked' : ''}" title="${blocked ? 'Sell the buildings first' : ''}">
            <input type="checkbox" data-side="${prefix}" value="${m.i}" ${blocked ? 'disabled' : ''} />
            ${mark}
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
        <span class="cs-max">max ${money(Math.max(0, player.money))}</span>
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
      ${side(me, listFor(meId), 'give', 'You give', 'bad')}
      <span class="trade-arrow">${icon('swap', 18)}</span>
      ${side(them, listFor(targetId), 'get', 'You get', 'good')}
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

/**
 * The final standings, in the order the sheet prints them: everyone still
 * standing by what they were worth, then the bankrupt. The share picture
 * reads the same list, so it can never put a different player on the podium.
 */
function finalStandings(state) {
  return [...(state.players || [])].sort((a, b) =>
    Number(a.bankrupt) - Number(b.bankrupt) || b.netWorth - a.netWorth);
}

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
  const rank = finalStandings(state);
  const medals = ['medalGold', 'medalSilver', 'medalBronze'];
  // Once any row carries the chevron, every row keeps its slot, so the money
  // column still lines up down the card.
  const here = deviceCodes();
  const chevrons = rank.some((p) => opensProfile(p, meId, here));
  const rows = rank.map((p, k) => {
    const t = state.titles?.[p.id];
    const opens = opensProfile(p, meId, here);
    return `<div class="rank-row ${p.id === meId ? 'me' : ''}${opens ? ' tap' : ''}"${opens
      ? ` data-pid="${escapeHtml(p.id)}" role="button" tabindex="0" title="See ${escapeHtml(p.name)}'s profile"` : ''}>
      <span class="rank-pos">${medals[k] ? icon(medals[k]) : k + 1}</span>
      <span class="avatar sm" style="background:${p.color}">${escapeHtml((p.name[0] || '?').toUpperCase())}</span>
      <span class="rank-main">
        <span class="rank-name">${escapeHtml(p.name)}</span>
        ${t ? `<span class="rank-title">${icon(TITLE_ART[t.title] || 'sparkle', 14)}<b>${escapeHtml(t.title)}</b><i>${escapeHtml(t.reason || '')}</i></span>` : ''}
      </span>
      <span class="rank-worth">${p.bankrupt ? '<span class="dim">bankrupt</span>'
        : p.netWorth < 0 ? `<span class="neg-money">${money(p.netWorth)}</span>` : money(p.netWorth)}</span>
      ${chevrons ? `<span class="rank-chev" aria-hidden="true">${opens ? '›' : ''}</span>` : ''}
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
  (root) => {
    $('#rcClose', root).onclick = closeModal;
    wireProfileRows(root, s, () => openReportCard(record));
  });
}

// ───────────────────────────────────────────────────────── player profile ──
// Every seat this browser has played as, by friend code. A second player
// added on this device sits in a #newplayer window with an identity of its
// own, so to the server — and to the other window, which only sees its alias
// — that seat looks like anybody else's. The windows share localStorage, so
// each one notes its own code here and the result sheet in either of them
// can tell who is sitting at the same keyboard.
const DEVICE_CODES_KEY = 'moneymove:deviceCodes';
const MAX_DEVICE_CODES = 12;
let notedCode = '';

function deviceCodes() {
  try {
    const list = JSON.parse(localStorage.getItem(DEVICE_CODES_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

/** The code of the seat this tab plays as; app.js hands it over on every state. */
export function noteDeviceSeat(code) {
  if (!code || code === notedCode) return;
  notedCode = code;
  const list = [code, ...deviceCodes().filter((c) => c !== code)].slice(0, MAX_DEVICE_CODES);
  try { localStorage.setItem(DEVICE_CODES_KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
}

/**
 * Whether a standings row opens that player's profile: it needs the friend
 * code the server put on the seat, and it is never one of this device's own
 * seats. Pass-and-play guests carry no code, so they drop out on the first
 * test; a shelf record has no seat id for this player, so the device's own
 * identity is checked as well, and a player added in another window of this
 * browser is caught by the codes those windows noted.
 */
function opensProfile(p, meId, here = deviceCodes()) {
  if (!p?.code) return false;
  const mine = walletToken();
  return p.id !== meId && (!mine || p.id !== mine) && !here.includes(p.code);
}

/**
 * Makes every profile row on a result sheet open its player. The profile
 * replaces the sheet — there is one modal root — so it is handed the way
 * back, which redraws the sheet and puts it back where it was scrolled to:
 * the standings sit under the chart, and coming back to the top of it would
 * lose the row that was just tapped.
 *
 * `meId` is the seat id, which is the identity token itself; it is handed on
 * so a browser with site storage blocked, where app.js keeps the token in
 * memory and walletToken() finds nothing, still reads and asks as itself.
 */
function wireProfileRows(root, state, reopen, meId = null) {
  root.querySelectorAll('.rank-row.tap[data-pid]').forEach((row) => {
    const seat = (state.players || []).find((p) => p.id === row.dataset.pid);
    if (!seat?.code) return;
    const open = () => {
      sfx.click();
      const y = $('.modal', root)?.scrollTop || 0;
      openPlayerProfile(seat, {
        token: meId,
        onBack: () => {
          reopen();
          const sheet = $('#modalRoot .modal');
          if (sheet) sheet.scrollTop = y;
        },
      });
    };
    row.onclick = open;
    row.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    };
  });
}

/** What each answer from /api/player leaves on the profile's one button. */
const PROFILE_ACTIONS = {
  none: { label: `${icon('people')} Add friend`, cls: 'primary', act: 'add' },
  asked: { label: `${icon('people')} Accept request`, cls: 'primary', act: 'accept' },
  sent: { label: 'Request sent', cls: '' },
  friend: { label: `${TICK} Friends`, cls: 'ghost' },
};

/**
 * "Lv 12" — the level as a chip, wherever a player is named: a seat, a row on
 * the leaderboard, a profile, your own card on the landing. A drawn star, not
 * an emoji, so it is the same chip on every platform. Nothing at all for 0 or
 * a missing level: that is a pass & play guest, or a server from before
 * levels, and a "Lv 0" would read as a beginner rather than as nobody.
 */
export function levelChip(level, cls = '') {
  const n = Math.floor(Number(level) || 0);
  if (n < 1) return '';
  return `<span class="lv-chip${cls ? ` ${cls}` : ''}" title="Level ${n}">${icon('star')}Lv ${n}</span>`;
}

/**
 * Table money in a tile a thumb wide. Rent adds up over a career, and seven
 * digits in a tile sized for three pushed the grid off a phone — so past a
 * hundred thousand it is rounded to the thousand, and past a million to a
 * tenth of one. The exact sum is in the tile's title.
 */
function compactMoney(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e5) return `$${Math.round(v / 1e3)}k`;
  return money(v);
}

/**
 * The career grid on a profile: what they have done at the tables, counted
 * from 1.0.6 on. Older games were never broken down this way, so a veteran's
 * grid can be all zeroes under forty wins — the line under the heading says
 * why rather than letting the zeroes look like a broken card.
 */
function careerHTML(career) {
  if (!career || typeof career !== 'object') return '';
  const num = (v) => (Number(v) || 0).toLocaleString('en-US');
  const tiles = [
    ['Streets bought', num(career.streetsBought)],
    ['Houses built', num(career.housesBuilt)],
    ['Rent collected', compactMoney(career.rentCollected), money(career.rentCollected)],
    ['Biggest rent', compactMoney(career.biggestRent), money(career.biggestRent)],
    ['Auctions won', num(career.auctionsWon)],
    ['Trades', num(career.tradesCompleted)],
  ];
  const fav = career.favoriteBoard;
  const empty = !fav && ['streetsBought', 'housesBuilt', 'rentCollected', 'biggestRent',
    'auctionsWon', 'tradesCompleted'].every((k) => !Number(career[k]));
  const games = Number(fav?.games) || 0;
  return `<p class="sub pp-label">Career</p>
    ${empty ? `<p class="pp-note">Nothing on the books yet — the career grid fills in
      from the next finished game.</p>` : ''}
    <div class="ach-tiles career">
      ${tiles.map(([label, value, exact]) => `<div class="ach-tile"${exact ? ` title="${escapeHtml(exact)}"` : ''}>
        <b>${escapeHtml(value)}</b><span>${label}</span></div>`).join('')}
    </div>
    <div class="pp-fav">
      <span class="pp-fav-ico">${icon('map', 16, 'solo')}</span>
      <span class="pp-fav-label">Favourite board</span>
      ${fav ? `<b>${escapeHtml(fav.name || fav.id || 'Classic')}</b>
        <i>${games} game${games === 1 ? '' : 's'}</i>` : '<b class="dim">None yet</b>'}
    </div>`;
}

/**
 * Somebody you have just played, from the result sheet: who they are, what
 * they have won, and a way to ask them to be friends.
 *
 * Everything on it comes from /api/player, read by the seat's friend code.
 * The sheet goes up at once with the face the table already knows, and fills
 * in when the server answers — a profile that waited for the network before
 * appearing would read as a tap that did nothing. It never decides for itself
 * who is a person: the server answers for every seat it put a code on, and
 * the sheet draws whatever comes back.
 *
 * The same sheet opens off a leaderboard row and a friend's row, and each of
 * those hands its own way back and says where it goes (`backLabel`), so the
 * button never promises a result sheet to somebody who came from Friends.
 */
export function openPlayerProfile(seat, { onBack, token: viewer, backLabel } = {}) {
  const code = String(seat?.code || '');
  if (!code) return;
  const token = viewer || walletToken();
  const back = onBack || closeModal;
  const backText = onBack ? backLabel || 'Back to the results' : 'Close';
  const face = (avatar, name) => `<span class="avatar pp-face ${avatar ? 'has-skin' : ''}"
      style="background:${seat.color || 'var(--red)'}">${escapeHtml(avatar || (String(name || '?')[0] || '?').toUpperCase())}</span>`;

  openModal(`
    <div class="pp-head" id="ppHead">
      ${face(seat.avatar, seat.name)}
      <div class="pp-who">
        <h2><b>${escapeHtml(seat.name || 'Player')}</b>${seat.flag ? `<span class="pp-flag">${escapeHtml(seat.flag)}</span>` : ''}</h2>
        <p class="sub">${levelChip(seat.level) || '&nbsp;'}</p>
      </div>
    </div>
    <div id="ppBody"><div class="pp-state">${icon('replay', 22, 'spin')}<p>Looking them up…</p></div></div>
    <div class="modal-actions">
      <button class="btn ghost" id="ppBack">${escapeHtml(backText)}</button>
      <span id="ppAction"></span>
    </div>`, (root) => {
    const sheet = $('.modal', root);
    $('#ppBack', root).onclick = () => { sfx.click(); back(); };
    // Over a result sheet, a tap outside goes back to it rather than taking
    // both away at once.
    if (onBack) root.onclick = (e) => { if (e.target === root) back(); };

    const paintAction = (relation) => {
      const slot = $('#ppAction', root);
      const spec = PROFILE_ACTIONS[relation];
      if (!slot) return;
      if (!spec) { slot.innerHTML = ''; return; } // your own profile: nothing to ask
      slot.innerHTML = `<button class="btn ${spec.cls}" id="ppGo" ${spec.act ? '' : 'disabled'}>${spec.label}</button>`;
      const go = $('#ppGo', root);
      if (!spec.act) return;
      go.onclick = async () => {
        sfx.click();
        go.disabled = true;
        try {
          const res = await fetch(api(spec.act === 'add' ? '/api/friends' : '/api/friends/accept'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, code }),
          });
          const out = await res.json().catch(() => ({}));
          if (!res.ok) {
            // Asking twice is not a mistake worth a red toast: they are friends.
            if (out.already) { paintAction('friend'); return; }
            go.disabled = false;
            toast(out.error || 'That did not go through — try again', 'error');
            return;
          }
          if (out.accepted) {
            paintAction('friend');
            toast(`You and ${seat.name || 'they'} are friends now`);
          } else {
            paintAction('sent');
            toast(`Request sent to ${seat.name || 'them'}`);
          }
        } catch {
          go.disabled = false;
          toast('Could not reach the server — try again in a moment', 'error');
        }
      };
    };

    const query = `code=${encodeURIComponent(code)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    fetch(api(`/api/player?${query}`))
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Could not load this profile');
        return d;
      })
      .then((d) => {
        if (!sheet?.isConnected) return; // closed, or replaced, while it loaded
        const wins = Number(d.wins) || 0;
        const games = Math.max(wins, Number(d.games) || 0);
        const rate = games ? `${Math.round((wins / games) * 100)}%` : '—';
        const since = Number(d.since) || 0;
        const name = d.name || seat.name || 'Player';
        // The level leads the line under the name, ahead of how long they
        // have been playing: it is the one number that says both at once.
        $('#ppHead', root).innerHTML = `${face(d.avatar, name)}
          <div class="pp-who">
            <h2><b>${escapeHtml(name)}</b>${d.flag ? `<span class="pp-flag">${escapeHtml(d.flag)}</span>` : ''}</h2>
            <p class="sub">${levelChip(d.level ?? seat.level)}<span>${since ? `Playing since ${escapeHtml(new Date(since)
              .toLocaleDateString(undefined, { month: 'short', year: 'numeric' }))}` : 'New to the tables'}</span></p>
          </div>`;
        const tiles = [
          ['Wins', wins.toLocaleString('en-US')],
          ['Games', games.toLocaleString('en-US')],
          ['Win rate', rate],
          ['Coins won', (Number(d.winnings) || 0).toLocaleString('en-US')],
        ];
        const titles = (Array.isArray(d.titles) ? d.titles : []).slice(0, 3);
        $('#ppBody', root).innerHTML = `
          <div class="ach-tiles four">
            ${tiles.map(([label, value]) => `<div class="ach-tile"><b>${value}</b><span>${label}</span></div>`).join('')}
          </div>
          ${titles.length ? `<p class="sub">Titles they wear most</p>
            <div class="pp-titles">${titles.map((t) => `<span class="pp-title">
              ${icon(TITLE_ART[t.title] || 'sparkle', 14)}<b>${escapeHtml(t.title)}</b>${
              Number(t.count) > 1 ? `<i>×${Number(t.count)}</i>` : ''}</span>`).join('')}</div>` : ''}
          ${careerHTML(d.career)}`;
        paintAction(d.relation);
      })
      .catch((err) => {
        if (!sheet?.isConnected) return;
        const missing = /no player/i.test(err.message || '');
        $('#ppBody', root).innerHTML = `<div class="pp-state">${icon('warning', 22, 'solo')}
          <p>${missing ? 'This profile is not available any more.'
            : 'Could not load this profile — try again in a moment.'}</p></div>`;
      });
  }, 'player-profile');
}

// ─────────────────────────────────────────────────────────── leaderboard ──
// The same rows on the landing card and in the sheet behind it, so the top
// five you tapped are the top five you land on. `winnings` is a purse of
// coins, not table money — it wears the coin, not a dollar sign.
//
// Three boards share the rows: everyone's lifetime wins, this week's, and
// you and your friends. Every row opens that player's profile.
const MEDALS = ['medalGold', 'medalSilver', 'medalBronze'];

export const LEADER_SCOPES = [
  { id: 'all', label: 'All time' },
  { id: 'week', label: 'This week' },
  { id: 'friends', label: 'Friends' },
];
const isScope = (s) => LEADER_SCOPES.some((x) => x.id === s);

/**
 * The three boards as a segmented control: the chat's channel picker, one
 * side wider. Each button carries its scope; the caller wires the taps.
 */
export function leaderTabsHTML(scope) {
  return `<div class="chat-channels seg3 lb-tabs" role="tablist" aria-label="Leaderboard">${LEADER_SCOPES.map((s) => `
    <button type="button" role="tab" data-scope="${s.id}" class="${s.id === scope ? 'on' : ''}"
      aria-selected="${s.id === scope}">${s.label}</button>`).join('')}</div>`;
}

// Each board read is kept for half a minute, so going from a row to its
// profile and back — or flicking between tabs — does not ask the server the
// same question again and redraw a list that has not changed.
const BOARD_TTL = 30000;
const boardCache = new Map();

/** One board, as /api/leaderboard answers it. The token only marks your row. */
export function fetchLeaderboard(scope, token, { fresh = false } = {}) {
  const which = isScope(scope) ? scope : 'all';
  const key = `${which}:${token || ''}`;
  const hit = boardCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < BOARD_TTL) return Promise.resolve(hit.data);
  const query = `scope=${which}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  return fetch(api(`/api/leaderboard?${query}`))
    .then((r) => r.json())
    .then((data) => {
      boardCache.set(key, { at: Date.now(), data });
      return data;
    });
}

/** "in 3 days", "in 5 hours" — how long the weekly board has left. */
function resetsIn(at) {
  const ms = Number(at) - Date.now();
  if (!(ms > 0)) return 'any minute';
  const hours = Math.round(ms / 3600000);
  if (hours >= 36) { const d = Math.round(hours / 24); return `in ${d} day${d === 1 ? '' : 's'}`; }
  if (hours >= 1) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  return 'within the hour';
}

/** The line under the tabs: what this board counts, and for the week, when it ends. */
export function leaderNote(scope, data) {
  if (scope === 'week') {
    return `Wins since Monday. Resets Monday${data?.resetsAt ? ` — ${resetsIn(data.resetsAt)}` : ''}.`;
  }
  if (scope === 'friends') return 'You and your friends, by wins over all time.';
  return 'Every player who has taken a table, most wins first. The purse is the coins those wins paid out.';
}

/** What an empty board says, which is different for each of the three. */
export function leaderEmpty(scope) {
  if (scope === 'week') return 'No wins yet this week — the first table to finish opens it.';
  if (scope === 'friends') return 'Swap friend codes with somebody and the two of you are on it.';
  return 'Nobody has won a game yet.';
}

/**
 * Where you stand when your own row is not among the ones shown: the server
 * ranks you against the whole board, not just the fifty it sends.
 */
export function leaderYouHTML(scope, data, shown) {
  const you = data?.you;
  if (!you) return '';
  const wins = Number(you.wins) || 0;
  if (you.rank && you.rank <= shown) return '';
  if (you.rank) {
    return `<div class="lb-you">You are <b>#${Number(you.rank).toLocaleString('en-US')}</b> with
      ${wins} ${wins === 1 ? 'win' : 'wins'}${scope === 'week' ? ' this week' : ''}.</div>`;
  }
  return `<div class="lb-you">${scope === 'week'
    ? 'Win a game this week and you are on it.'
    : 'Win a game and you are on it.'}</div>`;
}

export function leaderRowsHTML(rows, myCode = '') {
  return (rows || []).map((r, i) => {
    const wins = Number(r.wins) || 0;
    const mine = !!r.you || (!!myCode && r.code === myCode);
    const name = r.name || 'Player';
    // A friends board ranks people with no wins at all, and a gold medal on
    // a nought is a prize for nothing — the medals go to winners only.
    const rank = MEDALS[i] && wins > 0 ? icon(MEDALS[i], 18) : i + 1;
    return `<div class="lb-row ${mine ? 'me' : ''} ${r.code ? 'tap' : ''}" ${r.code
      ? `data-code="${escapeHtml(r.code)}" role="button" tabindex="0" aria-label="${escapeHtml(name)}'s profile"` : ''}>
      <span class="lb-rank">${rank}</span>
      <span class="lb-flag">${escapeHtml(r.flag || '')}</span>
      <span class="lb-name"><span class="lb-n">${escapeHtml(name)}</span>${levelChip(r.level)}${
        mine ? '<i class="tag you">YOU</i>' : ''}</span>
      <span class="lb-wins">${wins}<i>${wins === 1 ? 'win' : 'wins'}</i></span>
      <span class="lb-cash">${icon('coin', 12)}${(Number(r.winnings) || 0).toLocaleString('en-US')}</span>
    </div>`;
  }).join('');
}

/**
 * Makes every row of a board open its player's profile. `onBack` is handed
 * on to the profile, so a sheet opened over the board can put the board back
 * where it was; the landing card has nothing under it to go back to. It is
 * called with the list's scroll offset at the tap: the profile replaces the
 * sheet, so by the time Back is pressed the list it would be read from is
 * gone, and a detached list always says 0.
 */
export function wireLeaderRows(root, rows, { token, onBack, backLabel } = {}) {
  root.querySelectorAll('.lb-row.tap[data-code]').forEach((el) => {
    const row = (rows || []).find((r) => r.code === el.dataset.code);
    if (!row) return;
    const open = () => {
      sfx.click();
      const y = root.scrollTop;
      openPlayerProfile({ code: row.code, name: row.name, flag: row.flag, level: row.level },
        { token, onBack: onBack && (() => onBack(y)), backLabel });
    };
    el.onclick = open;
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    };
  });
}

/**
 * The whole board — fifty deep, and it scrolls rather than growing — with
 * the three tabs across the top. `scope` picks the tab it opens on, and
 * `scrollTop` puts the list back where it was when a profile hands the sheet
 * back. `onScope` tells whoever opened it which tab the reader ended on, so
 * the landing card can follow them.
 */
export function openLeaderboardModal(token, scope = 'all', { scrollTop = 0, onScope } = {}) {
  let current = isScope(scope) ? scope : 'all';
  let seq = 0;
  openModal(`
    <h2>${icon('trophy')} Leaderboard</h2>
    ${leaderTabsHTML(current)}
    <p class="sub lb-sub" id="lbSub">${escapeHtml(leaderNote(current))}</p>
    <div class="lb-list tall" id="lbList"></div>
    <div id="lbYou"></div>
    <div class="modal-actions"><button class="btn ghost" id="lbClose">Close</button></div>`,
  (root) => {
    $('#lbClose', root).onclick = closeModal;
    const list = $('#lbList', root);
    const load = (first) => {
      const mine = ++seq;
      // Only a tab that has to wait shows the spinner; one already read
      // paints in the same frame and would only flash it.
      const wait = setTimeout(() => {
        if (mine === seq) list.innerHTML = `<div class="pp-state">${icon('replay', 22, 'spin')}<p>Loading…</p></div>`;
      }, 120);
      fetchLeaderboard(current, token)
        .then((data) => {
          clearTimeout(wait);
          if (mine !== seq || !list.isConnected) return;
          const rows = Array.isArray(data?.top) ? data.top : [];
          $('#lbSub', root).textContent = leaderNote(current, data);
          list.innerHTML = rows.length ? leaderRowsHTML(rows)
            : `<div class="empty small">${escapeHtml(leaderEmpty(current))}</div>`;
          $('#lbYou', root).innerHTML = leaderYouHTML(current, data, rows.length);
          const at = current;
          wireLeaderRows(list, rows, {
            token,
            backLabel: 'Back to the leaderboard',
            onBack: (y) => openLeaderboardModal(token, at, { scrollTop: y, onScope }),
          });
          if (first && scrollTop) list.scrollTop = scrollTop;
          else {
            // Your own row is the one you came to find — put it in the middle
            // of the list. Only the list scrolls: scrollIntoView would scroll
            // the sheet as well and push the tabs off the top of it.
            const me = list.querySelector('.lb-row.me');
            list.scrollTop = 0;
            if (me) {
              const at = me.getBoundingClientRect().top - list.getBoundingClientRect().top;
              list.scrollTop = Math.max(0, at - (list.clientHeight - me.offsetHeight) / 2);
            }
          }
        })
        .catch(() => {
          clearTimeout(wait);
          if (mine !== seq || !list.isConnected) return;
          list.innerHTML = `<div class="pp-state">${icon('warning', 22, 'solo')}
            <p>Could not load the leaderboard — try again in a moment.</p></div>`;
        });
    };
    root.querySelectorAll('.lb-tabs [data-scope]').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.scope === current) return;
        sfx.click();
        current = b.dataset.scope;
        root.querySelectorAll('.lb-tabs [data-scope]').forEach((x) => {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-selected', String(x === b));
        });
        onScope?.(current);
        load(false);
      };
    });
    load(true);
  });
}

// ───────────────────────────────────────────────────────── watch live ──
// Public games being played right now (GET /api/live, 1.0.6), a tap from the
// rail. The list is public by construction — boards, names, flags, colours,
// how far in — and carries no tokens and no friend codes; the room code it
// does carry is the one the All rooms list has always shown.

// The list is read off a public endpoint rather than a table this browser
// sits at, so a seat's colour is only printed into a style when it is a
// plain hex colour — the only kind the server hands out.
const liveColour = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '#888888');

/** "Asha, Ravi & 2 more" — the table, by who is still in it. */
function liveNames(players) {
  const names = players.filter((p) => !p.out).map((p) => p.name);
  if (!names.length) return 'Everyone is out';
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} & ${names.length - 2} more`;
}

/** How far in a game is, as a watcher would ask it. */
function liveProgress(g) {
  const turns = Math.max(0, Math.floor(Number(g.turnCount) || 0));
  const parts = [turns ? `Turn ${turns}` : 'Just started'];
  const ends = Number(g.endsAt) || 0;
  if (ends) {
    const mins = Math.ceil((ends - Date.now()) / 60000);
    parts.push(mins > 0 ? `${icon('clock')} ${mins} min left` : `${icon('clock')} Last turn`);
  }
  const watching = Math.max(0, Math.floor(Number(g.watching) || 0));
  if (watching) parts.push(`${icon('eye')} ${watching}`);
  return parts.join('<span class="live-sep">·</span>');
}

/**
 * One row per game. A game this browser still has a seat at — walked away
 * from, the house covering the chair — is offered back as a seat rather
 * than as something to watch: watching your own game from the rail while a
 * bot plays your hand would be a strange way to come back to it.
 */
export function liveRowsHTML(games, mine = new Set()) {
  return games.map((g) => {
    const players = Array.isArray(g.players) ? g.players : [];
    const faces = players.slice(0, 4).map((p) => `<span class="avatar xs${p.out ? ' out' : ''}"
      style="background:${liveColour(p.color)}">${escapeHtml(p.avatar || (String(p.name || '?')[0] || '?').toUpperCase())}</span>`).join('');
    // A phone shows three of the four faces (the stylesheet hides the
    // fourth), so "+N" is written for both and each screen picks the one that
    // counts the players it is actually not showing.
    const more = [[4, 'wide'], [3, 'narrow']].map(([n, cls]) => (players.length > n
      ? `<span class="live-more ${cls}">+${players.length - n}</span>` : '')).join('');
    const own = mine.has(g.roomId);
    return `<button class="live-row" type="button" data-live="${escapeHtml(g.roomId)}"
        title="${own ? 'Back to your seat at this table' : `Watch this game on ${escapeHtml(g.mapName || 'its board')}`}">
      <span class="live-faces">${faces}${more}</span>
      <span class="live-main">
        <span class="live-map">${escapeHtml(g.mapName || 'A board')}</span>
        <span class="live-who">${escapeHtml(liveNames(players))}</span>
      </span>
      <span class="live-side">
        <i class="pr-tag ${own ? 'open' : 'watch'}">${own ? 'Your seat' : `${icon('eye')} Watch`}</i>
        <span class="live-turn">${liveProgress(g)}</span>
      </span>
    </button>`;
  }).join('');
}

/** Each row opens its game: `onPick(roomId)`. */
export function wireLiveRows(root, onPick) {
  root.querySelectorAll('[data-live]').forEach((b) => {
    b.onclick = () => { sfx.click(); onPick(b.dataset.live); };
  });
}

export const LIVE_EMPTY = 'No public games right now';

/** Every game on the list, in a sheet — the landing card only shows three. */
export function openLiveModal(games, { mine = new Set(), onPick } = {}) {
  openModal(`
    <h2>${icon('eye')} Watch live</h2>
    <p class="sub">Public games being played right now. Watching is read-only, and the
      players only see how many people are watching, not who.</p>
    <div class="live-list tall">${games.length ? liveRowsHTML(games, mine)
      : `<div class="empty small">${LIVE_EMPTY}</div>`}</div>
    <div class="modal-actions"><button class="btn ghost" id="liveClose">Close</button></div>`,
  (root) => {
    $('#liveClose', root).onclick = closeModal;
    // The sheet goes first, so the table opens on its own rather than
    // under a list of games nobody is looking at any more.
    wireLiveRows(root, (id) => { closeModal(); onPick?.(id); });
  });
}

// ────────────────────────────────────────────────────────── the shelf ──
/**
 * Titles collected across every game, with the lifetime numbers under them.
 * They wear the same drawings the report card hands them out with, so a
 * "Landlord" on the shelf is the "Landlord" you remember winning.
 */
export function openAchievementsModal(token) {
  fetch(api(`/api/achievements?token=${encodeURIComponent(token)}`))
    .then((r) => r.json())
    .then((d) => {
      const titles = Object.entries(d?.titles || {}).sort((a, b) => b[1] - a[1]);
      const tiles = [
        ['Wins', Number(d?.wins) || 0],
        ['Coins won', (Number(d?.winnings) || 0).toLocaleString('en-US')],
        ['Turns played', (Number(d?.turnsPlayed) || 0).toLocaleString('en-US')],
      ];
      openModal(`
        <h2>Your shelf</h2>
        <p class="sub">Every title this seat has been handed, and what they add up to.</p>
        <div class="ach-tiles">
          ${tiles.map(([label, value]) => `<div class="ach-tile"><b>${value}</b><span>${label}</span></div>`).join('')}
        </div>
        ${titles.length ? `<p class="sub">Titles</p>
          <div class="ach-list">${titles.map(([name, n]) => `<div class="ach-row">
            <span class="ach-ico">${icon(TITLE_ART[name] || 'sparkle', 20, 'solo')}</span>
            <b>${escapeHtml(name)}</b>
            ${n > 1 ? `<i class="ach-n">×${n}</i>` : ''}
          </div>`).join('')}</div>`
        : `<div class="empty small">No titles yet — one is handed out per player at
            the end of every game. Finish one and this fills up.</div>`}
        <div class="modal-actions"><button class="btn ghost" id="acClose">Close</button></div>`,
      (root) => { $('#acClose', root).onclick = closeModal; });
    })
    .catch(() => toast('Could not reach the server — try again in a moment', 'error'));
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

// ══════════════════════════════════════════════════════ rewarded ads ══
// Everything in this block is dead weight until the server says otherwise.
// GET /api/ads/config is the whole switch: while it answers `enabled: false`
// no button is drawn, no card is mounted and no countdown exists, so a player
// on a dark server sees the app exactly as it was yesterday. Going live is one
// toggle on the admin desk — nothing here is built or shipped on that day.
//
// Coins are scarce here on purpose — the daily ladder starts at one, climbs
// to seven and goes round again, a win pays two, and the cheapest piece in
// the shop is 300. A view is therefore worth real money, so this client
// never mints anything: it asks for a ticket, plays the ad, and hands the
// ticket back. What that was worth, how many are left today and whether this
// one counts at all are the server's business, and its refusals are printed
// rather than swallowed.
let adsConfig = null;
// Whether the server has been asked at all yet. `adsConfig === null` on its own
// cannot tell "ads are off" from "the answer is still in the air", and the two
// deserve opposite treatment: the first is final, the second is worth asking
// about again before giving up on an offer.
let adsAsked = false;

export function setAdsConfig(c) {
  adsAsked = true;
  adsConfig = c?.enabled ? c : null;
  // The one thing the tokenless answer settles for good is which network is
  // serving, so this is the earliest a third-party script could be loaded —
  // and it wants to be the earliest, because a rewarded ad has to be fetched
  // before the button is pressed to be there when it is. On a dark server, or
  // on the house, nothing is loaded and nothing is contacted.
  configureAdNetwork(adsConfig);
  // app.js asks for the config before it has anything to say about who is
  // asking, and the per-device counts ("3 left today") only exist once the
  // server knows. So the tokenless answer is used for the one thing it can
  // answer — on or off — and the real numbers are fetched behind it. Nothing
  // is requested at all on a dark server.
  if (adsConfig) refreshAdsConfig();
  else mountFreeCoins();
}

/** Re-reads the config as this device, then repaints whatever it changes. */
async function refreshAdsConfig() {
  const token = walletToken();
  if (!token) return mountFreeCoins();
  try {
    const fresh = await fetch(api(`/api/ads/config?token=${encodeURIComponent(token)}&platform=web`))
      .then((r) => r.json());
    adsConfig = fresh?.enabled ? fresh : null;
    // The tokenless answer above may have arrived before the desk was touched.
    // If this one is the first to name a network, it is still early enough.
    configureAdNetwork(adsConfig);
  } catch { /* the switch we already have stands; the counts stay coarse */ }
  mountFreeCoins();
}

/**
 * The placement's terms, or null when it must not be offered at all: ads off,
 * this slot off, or nothing left in it today. Every call site starts here, so
 * "don't render it" and "don't let them press it" are the same question.
 */
function placement(name) {
  const p = adsConfig?.placements?.[name];
  if (!p || p.enabled === false) return null;
  // `remaining` is the server's count of views this device may still be paid
  // for today. Absent means it hasn't said; zero means the faucet is shut.
  if (typeof p.remaining === 'number' && p.remaining <= 0) return null;
  return p;
}

/** Folds a fresh `remaining` map from an offer or a claim back into the config. */
function noteRemaining(remaining) {
  if (!remaining || !adsConfig?.placements) return;
  for (const [slot, n] of Object.entries(remaining)) {
    if (adsConfig.placements[slot]) adsConfig.placements[slot].remaining = n;
  }
}

// app.js owns the device token and this module is never handed it. Both read
// the same two keys in the same order — session first, so a second tab that
// took a fresh identity spends its own coins and not the stored one's.
const WALLET_KEY = 'moneymove:token';
function walletToken() {
  const read = (store) => { try { return store.getItem(WALLET_KEY) || ''; } catch { return ''; } };
  return read(sessionStorage) || read(localStorage);
}

// The purse is small enough that "1 coin" happens often; every line
// that prints a payout has to be able to say it in the singular.
const coinWord = (n) => `${n} coin${n === 1 ? '' : 's'}`;

// ---- the house ad --------------------------------------------------------
// What runs today, and what runs forever whenever a network has nothing to
// fill the slot with. An unfilled break is still five seconds somebody was
// promised a reward for, so it is never allowed to be a blank screen.

// One is picked per view. They are honest about what the screen is, because a
// house ad pretending to be a real one is just a worse real one.
const HOUSE_LINES = [
  'Nobody has bought this slot yet, so the house took it.',
  'This break is brought to you by the table you are already at.',
  'Five seconds of nothing, and then some coins. Fair trade.',
  'An advert for the game you are currently playing. We know.',
];

/** The mark: an ivory die on a brass ring, the same one the app opens with. */
function houseAdMark() {
  const pip = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="5.6" fill="#1B5E3F"/>`;
  // The die is ivory and the pips are felt green on every table, exactly as
  // the favicon and the iOS splash draw them — which is why the disc behind it
  // is a colour rather than a token. An ivory die on the ivory daytime card
  // has no edges at all; on its own patch of felt it reads on any background.
  return `<svg class="ad-mark" viewBox="0 0 120 120" fill="none" aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg">
    <circle cx="60" cy="60" r="53" stroke="var(--gold)" stroke-opacity=".7" stroke-width="2.6"/>
    <circle cx="60" cy="60" r="47" fill="#0F1B16"/>
    <g transform="rotate(-11 60 60)">
      <rect x="24" y="24" width="72" height="72" rx="14" fill="#FBF6E9"/>
      ${pip(43, 43)}${pip(77, 43)}${pip(60, 60)}${pip(43, 77)}${pip(77, 77)}
    </g>
  </svg>`;
}

/** A drawn cross — the app has no × glyph, and an emoji one is not an option. */
const CROSS = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <path d="M5 5 19 19M19 5 5 19" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;

/**
 * Plays one ad break and answers whether it was watched all the way through.
 * `true` means the button lit and they pressed it; `false` means they closed
 * it early, which is always allowed and never pays.
 *
 * The countdown is the contract: nothing is claimable before it runs out, and
 * the caller only gets a truthy answer when it did.
 */
function playHouseAd({ label = 'Claim your reward', seconds = 5 } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'ad-root';
    const R = 20;                       // countdown ring radius
    const C = 2 * Math.PI * R;
    root.innerHTML = `
      <div class="ad-sheet" role="dialog" aria-modal="true" aria-label="Advertisement">
        <span class="ad-flag">Advert</span>
        <button class="ad-x" id="adX" type="button"
          title="Close — you get nothing for a break you walked out of"
          aria-label="Close without the reward">${CROSS}</button>
        ${houseAdMark()}
        <h2 class="logo ad-word">MONEY<span>MOVE</span></h2>
        <p class="ad-copy">${escapeHtml(HOUSE_LINES[Math.floor(Math.random() * HOUSE_LINES.length)])}</p>
        <div class="ad-timer" id="adTimer">
          <svg viewBox="0 0 46 46">
            <circle class="ring-bg" cx="23" cy="23" r="${R}" fill="none" stroke-width="3.5"/>
            <circle class="ring-on" id="adRing" cx="23" cy="23" r="${R}" fill="none" stroke-width="3.5"
              stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="0"/>
          </svg>
          <b id="adCount">${seconds}</b>
        </div>
        <button class="btn primary big wrap ad-go" id="adGo" type="button" disabled>${escapeHtml(label)}</button>
        <p class="ad-note">Close it early and the reward does not count.</p>
      </div>`;
    document.body.appendChild(root);

    let done = false;
    const finish = (watched) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      root.remove();
      resolve(watched);
    };
    // Escape is the keyboard's close button, so it forfeits exactly as the
    // cross does. It must not be able to skip the wait.
    const onKey = (e) => { if (e.key === 'Escape') finish(false); };
    document.addEventListener('keydown', onKey);

    const timer = $('#adTimer', root);
    const ring = $('#adRing', root);
    const count = $('#adCount', root);
    const go = $('#adGo', root);
    $('#adX', root).onclick = () => { sfx.click(); finish(false); };

    const started = performance.now();
    let frame = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - started) / (seconds * 1000));
      ring.style.strokeDashoffset = String(C * t);
      count.textContent = String(Math.ceil(seconds * (1 - t)) || 1);
      if (t < 1) { frame = requestAnimationFrame(tick); return; }
      timer.classList.add('done');
      go.disabled = false;
      go.classList.add('lit');
      go.focus();
      sfx.click();
    };
    frame = requestAnimationFrame(tick);

    go.onclick = () => { if (!go.disabled) { sfx.click(); finish(true); } };
  });
}

/**
 * The one place an ad gets on screen, and the only thing the network changed:
 * everything either side of it — the ticket, the caps, the coins — is the same
 * as it was when the house was the whole system.
 *
 * A network gets first refusal, but only when the offer we are holding said it
 * is the one serving. 'admob' lands here too and goes straight past, because
 * AdMob has no browser SDK to go past it with; the iOS app is where that
 * provider means anything, and on the web it means the house.
 *
 * Everything the network cannot do — no fill, no script, a blocker, an outage,
 * an id nobody has pasted in yet — comes back as the house ad rather than as
 * an error, because a slot nobody bought still owes the player their five
 * seconds, and the ticket pays exactly the same either way.
 */
async function presentAd({ provider, slot, ...house }) {
  if (provider === 'h5' || provider === 'adsense') {
    // A throw is one more way the network can fail to fill the slot, and it
    // has to land where all the others land. Without this the exception walks
    // out through the gateway with `busy` still true, and the button that
    // started it spins until the page is reloaded.
    const seen = await playNetworkAd(slot).catch(() => 'unavailable');
    // Watched through, or walked out of. Both are answers the player gave;
    // only the first is worth coins, and neither wants a second ad on top.
    if (seen === 'viewed' || seen === 'dismissed') return seen;
  }
  return (await playHouseAd(house)) ? 'viewed' : 'dismissed';
}

// ---- the gateway ---------------------------------------------------------
// The only place in the client that knows the server's endpoint names, and the
// only place coins can come from. A ticket is opened before the ad runs and
// redeemed after it, so a claim that never had a ticket — or has one twice —
// is refused server-side rather than argued about here.

/** POSTs JSON and always answers an object, so no caller has to try/catch. */
async function adPost(path, body) {
  try {
    const res = await fetch(api(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    // A refusal carries more than its sentence — when it is allowed again, and
    // what is left in each slot — so the whole body comes back, not just the
    // error line off the front of it.
    if (!res.ok) return { ...data, error: data.error || 'That did not go through — try again.' };
    return data;
  } catch {
    return { error: 'Could not reach the server — try again in a moment.' };
  }
}

/** A refusal, with the server's own wording and its "try again in" attached. */
function refusalLine(out) {
  const wait = Math.ceil(Number(out.retryInSec) || 0);
  // Anything longer than an hour is a cap, not a cooldown, and the sentence
  // the server sent already says so better than a countdown would.
  if (!wait || wait > 3600) return out.error;
  if (wait < 60) return `${out.error} — try again in ${wait}s.`;
  const mins = Math.ceil(wait / 60);
  return `${out.error} — try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
}

/**
 * Offer, ad, reward — the whole rewarded loop, and the only route a coin takes
 * from a view into a wallet. The offer is asked for BEFORE the ad plays, so
 * nobody is ever shown five seconds of promo against a cap they had already
 * hit; the reward is claimed after, with the ticket the offer issued.
 *
 * Every outcome is said out loud. A refusal is printed in the server's own
 * words (cap reached, too soon, ticket expired), an early close says what it
 * cost, and `busy` is always handed back false — a spinner left running would
 * read as coins on the way that are never coming.
 *
 * Resolves { coins, earned, paid } when the server actually paid, else null:
 * the wallet as the claim reported it, and what this view was worth.
 */
async function watchAdFor(name, { token = walletToken(), busy = () => {} } = {}) {
  const spec = placement(name);
  if (!token || !spec) return null;

  busy(true);
  // `platform` says plainly what the User-Agent would otherwise be sniffed for:
  // this is a browser, so the browser's network is the one to quote.
  const offer = await adPost('/api/ads/offer', { token, placement: name, platform: 'web' });
  if (offer.error) {
    busy(false);
    noteRemaining(offer.remaining);
    toast(refusalLine(offer), 'error');
    return null;
  }
  noteRemaining(offer.remaining);

  // What this break is being watched FOR, in the words the button will wear
  // once the countdown lets it be pressed. Only the server knows the figure —
  // a doubled win pays whatever that win paid.
  const worth = Number(offer.reward?.coins ?? spec.coins ?? 0);
  const watched = await presentAd({
    // The offer is the freshest word on who is serving — the config this page
    // booted with can be an hour old and a desk change behind.
    provider: offer.provider,
    slot: name,
    label: worth > 0 ? `Claim your ${coinWord(worth)}` : 'Claim your reward',
  });
  if (watched !== 'viewed') {
    busy(false);
    toast('Closed early — nothing was paid for that one.');
    return null;
  }

  // What the break came to, said out loud. On the web there is no callback
  // from Google to check this against — H5 has no server-side verification, so
  // the ticket, the interval and the caps are what bound the faucet, exactly
  // as they did when the house was the only network. The field is here because
  // it can only ever narrow the outcome: a break this client reports as
  // unfinished is refused, and one it reports as finished still has to get
  // past every rule the server had before it was asked.
  const claim = await claimTicket(token, offer.ticket, watched);
  busy(false);
  if (claim.error) { noteRemaining(claim.remaining); toast(refusalLine(claim), 'error'); return null; }

  noteRemaining(claim.remaining);
  // The server is the authority on the size of the payout: an offer quoting a
  // figure the claim then disagrees with pays what the claim says.
  return {
    coins: Number(claim.coins ?? 0),
    earned: Number(claim.earned),
    paid: Number(claim.awarded ?? worth ?? 0),
  };
}

/**
 * Redeems one ticket, and waits for a provider that hasn't finished speaking.
 *
 * A rewarded view and the network's confirmation of it are two different
 * journeys, and the client usually wins. The gateway holds the claim at the
 * door for a few seconds on that account, but a few seconds is a guess about
 * somebody else's infrastructure, and when the guess is wrong the player has
 * watched the whole ad and gets a red toast — the one failure a rewarded ad
 * must never have. So a refusal that says `pending` is not an answer, it is a
 * "not yet", and the same ticket is offered again until it is one or the
 * budget runs out. The ticket outlives every one of these attempts: the server
 * only burns it when it pays.
 *
 * Nothing else is retried. A cap, a cooldown, an expired ticket and a bad
 * outcome are all final answers, and asking again would just be arguing.
 *
 * The budget is short on purpose, and the reason is the other failure this
 * sits on top of. A callback running a few seconds late is the case worth
 * waiting for; an SSV URL typed with a typo into the AdMob console is a
 * callback that is never coming, and every view under it would spend the whole
 * budget before saying so. Fifteen seconds on top of the gateway's own five is
 * long enough for the first and short enough to survive the second — and the
 * desk counts what the SSV door has actually seen, which is where a typo is
 * meant to be noticed.
 */
async function claimTicket(token, ticket, outcome, { budgetMs = 15000 } = {}) {
  const deadline = Date.now() + budgetMs;
  let claim = await adPost('/api/ads/reward', { token, ticket, outcome });
  while (claim.pending && Date.now() < deadline) {
    const wait = Math.min(4000, Math.max(1000, Number(claim.retryInSec || 2) * 1000));
    await new Promise((r) => setTimeout(r, wait));
    claim = await adPost('/api/ads/reward', { token, ticket, outcome });
  }
  return claim;
}

// ---- doubleWin: the offer on the game-over sheet -------------------------
// The one moment a rewarded ad is worth showing anybody: they have just won,
// the purse is on screen, and the offer is to make it bigger. It appears for
// the winner and nobody else, and only while the server still has a view to
// pay for.

// What a doubled win came to last time this session. Only the server knows
// what a win is worth — asking would cost a ticket — so the first offer of a
// session says it in words and every one after it can do the arithmetic.
let lastDouble = null;

function doubleWinHTML(state, meId) {
  if (state.winner?.id !== meId) return '';
  const spec = placement('doubleWin');
  if (!spec || !walletToken()) return '';
  const factor = Math.max(2, Number(spec.factor) || 2);
  const left = typeof spec.remaining === 'number' ? spec.remaining : null;
  const sum = lastDouble ? ` (${lastDouble.from} → ${lastDouble.to} coins)` : '';
  return `
    <button class="btn primary big wrap" id="gDouble">${icon('coin')} Watch an ad — double your winnings${sum}</button>
    <div class="dim small go-wait" id="gDoubleSub">Five seconds, and the win pays ${
      factor === 2 ? 'twice' : `${factor} times`}.${left === null ? '' : ` ${left} left today.`}</div>`;
}

function wireDoubleWin(root, meId, state) {
  const btn = $('#gDouble', root);
  if (!btn) { offerDoubleLate(root, meId, state); return; }
  const sub = $('#gDoubleSub', root);
  const label = btn.innerHTML;

  btn.onclick = async () => {
    sfx.click();
    const out = await watchAdFor('doubleWin', {
      // The seat's own id IS the wallet token — the server hands both out as
      // one — so the sheet pays the player sitting in it.
      token: meId || walletToken(),
      busy: (on) => {
        btn.disabled = on;
        btn.innerHTML = on ? `${icon('coin')} Loading the ad…` : label;
      },
    });
    if (!out) return;

    // What it came to: the claim pays the bonus, so the purse it was added to
    // is the bonus divided by the extra share, and the total is the two.
    const factor = Math.max(2, Number(placement('doubleWin')?.factor) || 2);
    const from = Math.max(1, Math.round(out.paid / (factor - 1)));
    const to = from + out.paid;
    lastDouble = { from, to };
    noteWallet(out);

    // The offer has been taken, so it is replaced by what it bought rather
    // than sitting there inviting a second press it can't honour.
    sub?.remove();
    const won = document.createElement('div');
    won.className = 'go-doubled';
    won.innerHTML = `
      <span class="gd-mark">${icon('coin', 24, 'solo')}</span>
      <div>
        <div class="gd-num"><b id="gdNum">${from}</b> coins</div>
        <div class="gd-sub">Doubled — that win paid ${to} instead of ${from}.</div>
      </div>`;
    btn.replaceWith(won);
    sfx.gain();
    countUpTo($('#gdNum', won), from, to);
  };
}

/**
 * The offer that could not be drawn in time.
 *
 * Two races put a winner in front of a sheet with no offer on it, and between
 * them they cover nearly everybody.
 *
 * A doubleWin view is only worth anything while there is a win sitting there
 * waiting to be doubled, so the server honestly reports none left until one
 * exists — and the moment one exists is the moment the game ends, long after
 * this page asked what was on offer. And a player who walks straight into a
 * finished table gets the sheet drawn from the socket's first frame, which
 * routinely beats the config fetch home.
 *
 * Either way the answer is the same: ask once more, and put the offer in if
 * the server has since changed its mind. Nothing is asked for anyone but the
 * winner, on a server that has already said ads are off, or when the offer was
 * there and something else took it away.
 */
async function offerDoubleLate(root, meId, state) {
  if (state?.winner?.id !== meId || !walletToken()) return;
  if (adsAsked && !adsConfig) return;
  if (placement('doubleWin')) return;
  await refreshAdsConfig();
  const html = doubleWinHTML(state, meId);
  if (!html) return;
  const actions = $('.go-actions', root);
  if (!actions) return;
  // Back where it would have been: first in the row, above Play again.
  actions.insertAdjacentHTML('afterbegin', html);
  wireDoubleWin(root, meId, state);
}

/** A number climbing to what it became — the payout landing, not a repaint. */
function countUpTo(el, from, to) {
  if (!el) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || to <= from) {
    el.textContent = String(to);
    return;
  }
  const started = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - started) / 800);
    el.textContent = String(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---- freeCoins: the quiet offer on the landing ---------------------------
// It sits under the daily card and behaves like it: it appears only when there
// is something to take, it never plays by itself, and once today's views are
// spent it stops asking. No interstitial, nothing before a game — the player
// comes to this, it never comes to them.

function mountFreeCoins() {
  const host = $('#dailyCard');
  const existing = $('#adOffer');
  const spec = placement('freeCoins');
  // Ads off, slot off, or nothing left today: the card does not exist. Not
  // greyed out, not "come back tomorrow" — gone.
  if (!spec || !host || !walletToken()) { existing?.remove(); return; }

  const card = existing || document.createElement('div');
  if (!existing) {
    card.className = 'landing-card ad-offer';
    card.id = 'adOffer';
    host.insertAdjacentElement('afterend', card);
  }
  paintFreeCoins(card, spec);
}

function paintFreeCoins(card, spec) {
  const worth = Number(spec.coins || 0);
  const left = typeof spec.remaining === 'number' ? spec.remaining : null;
  card.innerHTML = `
    <span class="ao-mark">${icon('ticket', 18, 'solo')}</span>
    <div class="ao-body">
      <div class="ao-title">Watch an ad for ${coinWord(worth)}</div>
      <div class="ao-sub">${left === null ? 'Five seconds, then the coins are yours'
        : `${left} left today`}</div>
    </div>
    <button class="btn small" id="adOfferGo" type="button">Watch</button>`;

  const go = $('#adOfferGo', card);
  go.onclick = async () => {
    sfx.click();
    const out = await watchAdFor('freeCoins', {
      busy: (on) => {
        go.disabled = on;
        go.textContent = on ? 'Loading…' : 'Watch';
      },
    });
    if (!out) { mountFreeCoins(); return; }
    noteWallet(out);
    sfx.gain();
    toast(`+${coinWord(out.paid)} — thanks for watching.`);
    // The server just said how many views are left; if that was the last one
    // the card takes itself off the landing rather than offering a fourth.
    mountFreeCoins();
  };
}

// ---- telling people about it --------------------------------------------
/** The invite link for the table this sheet belongs to. */
function roomInviteLink() {
  const m = location.pathname.match(/^\/room\/([a-z0-9]+)/i);
  return m ? `${location.origin}/?room=${m[1].toLowerCase()}` : location.origin;
}

/**
 * Who the game went to, as a heading names it. A team game is won by a team:
 * the server's `winner` there is only the first of its survivors, and printing
 * that one name told the teammate who won alongside them that they had lost.
 * Null when nobody won.
 */
export function winnerLabel(state) {
  const team = state?.winningTeam != null ? state.teamInfo?.[state.winningTeam] : null;
  if (team) return { name: `Team ${team.name}`, color: team.color };
  return state?.winner ? { name: state.winner.name, color: state.winner.color } : null;
}

/** Whether this seat is on the winning side — its team's, in a team game. */
export function wonGame(state, meId) {
  if (state?.winningTeam != null) {
    const me = state.players?.find((p) => p.id === meId);
    return me?.team != null && me.team === state.winningTeam;
  }
  return !!state?.winner && state.winner.id === meId;
}

/** One line worth pasting: the number, the game, and a way to come and take it. */
function resultLine(state, meId) {
  const link = roomInviteLink();
  // Somebody who only watched lost nothing to anybody, so "off us" would be
  // a story about a game they were never in.
  const seated = state.players?.some((p) => p.id === meId);
  const team = state.winningTeam != null ? winnerLabel(state) : null;
  if (team && wonGame(state, meId)) return `${team.name} won on MoneyMove and I was on it — beat us: ${link}`;
  if (team && !seated) return `${team.name} won on MoneyMove — play the next one: ${link}`;
  if (team) return `${team.name} won it off us on MoneyMove — come and take it back: ${link}`;
  const winner = state.players?.find((p) => p.id === state.winner?.id);
  if (winner && winner.id === meId) return `I won ${money(winner.netWorth)} on MoneyMove — beat me: ${link}`;
  if (winner && !seated) return `${winner.name} won ${money(winner.netWorth)} on MoneyMove — play the next one: ${link}`;
  if (winner) return `${winner.name} won ${money(winner.netWorth)} off us on MoneyMove — come and take it back: ${link}`;
  return `Nobody walked away with it on MoneyMove — try your luck: ${link}`;
}

/**
 * The phone's own share sheet where there is one; the clipboard everywhere
 * else. A share the player backed out of is not a failure, so it is not
 * quietly turned into a copy behind their back.
 */
async function shareResult(text) {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'MoneyMove', text });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Result copied — paste it wherever your friends are');
  } catch {
    toast(`Copy this: ${roomInviteLink()}`);
  }
}

// ───────────────────────────────────────────── the result, as a picture ──
/**
 * What the share picture says, frozen from the finished state: the same
 * standings the sheet prints, the winner the heading names, and where this
 * seat came — nothing for a table that was only watched.
 */
function resultShareData(state, meId) {
  const rank = finalStandings(state);
  if (!rank.length) return null;
  const mine = rank.findIndex((p) => p.id === meId);
  return {
    mapName: state.map?.name || '',
    winner: winnerLabel(state),
    podium: rank.slice(0, 3).map((p) => ({
      name: p.name, color: p.color, avatar: p.avatar || '', flag: p.flag || '',
      worth: p.netWorth, bankrupt: !!p.bankrupt,
    })),
    placing: mine >= 0 ? { rank: mine + 1, of: rank.length } : null,
    won: mine >= 0 && wonGame(state, meId),
    onTime: endedOnTime(state),
  };
}

// The picture of the ending on screen, drawn once however often the sheet is
// opened over it, and drawn again only if the result itself changes.
let picture = { key: '', drawing: null };

function pictureFor(state, meId) {
  const data = resultShareData(state, meId);
  if (!data) return Promise.reject(new Error('no result'));
  const key = JSON.stringify(data);
  if (picture.key !== key || !picture.drawing) {
    const drawing = drawResultCard({ ...data, date: new Date() });
    picture = { key, drawing };
    // A failed draw is not kept, so the next tap tries again.
    drawing.catch(() => { if (picture.drawing === drawing) picture = { key: '', drawing: null }; });
  }
  return picture.drawing;
}

export function showGameOver(state, meId, actions) {
  const won = winnerLabel(state);
  const seated = state.players?.some((p) => p.id === meId);
  // A browser that cannot hand a file to a share sheet saves the picture
  // instead, and the button says that is what it will do.
  const pictureLabel = canSharePicture() ? 'Share result' : 'Save picture';
  openModal(`
    <div class="go-crown">${icon('trophy')}</div>
    <h2 class="go-title" style="color:${won?.color || '#fff'}">${escapeHtml(won?.name || 'Nobody')} wins!</h2>
    ${endedOnTime(state) ? `<p class="go-timeup">${icon('clock')} Time's up — the richest player won</p>` : ''}
    ${worthChartSVG(state)}
    ${reportCardHTML(state, meId)}
    <div class="go-xp hidden" id="goXp"></div>
    <div class="modal-actions go-actions">
      ${doubleWinHTML(state, meId)}
      ${state.cup
        // A cup match is played once, and the server refuses a rematch of
        // one — the same note the centre well gives in place of the button.
        ? `<div class="cup-note dim small">${icon('trophy')} A cup match is played once — the bracket has your result.</div>`
        : state.quick
        // A matchmade table doesn't reconvene — offering "the same players"
        // would tell the room the seats were never strangers.
        ? `<button class="btn primary big wrap" id="gNewTable">${icon('replay')} Play again</button>
           <div class="dim small go-wait">Finds you a fresh table.</div>`
        // A rematch is the seated players' to call; somebody watching has
        // only the way home and the share.
        : seated ? `<button class="btn primary big wrap" id="gAgain">${icon('replay')} Play again</button>
           <div class="dim small go-wait">Whoever presses first hosts the next one.</div>` : ''}
      <div class="row-2 go-share">
        <button class="btn wrap" id="gPicture" type="button">${icon('picture')} ${pictureLabel}</button>
        <button class="btn wrap" id="gShare" type="button">${icon('globe')} Share link</button>
      </div>
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
    const fresh = $('#gNewTable', root);
    if (fresh) fresh.onclick = () => { sfx.click(); closeModal(); actions.newTable?.(); };
    const share = $('#gShare', root);
    if (share) share.onclick = () => { sfx.click(); shareResult(resultLine(state, meId)); };
    const pic = $('#gPicture', root);
    // Drawn once the sheet has finished arriving — a canvas painted in the
    // middle of its entrance would stall it — so that by the time the button
    // is pressed the share sheet can open on the tap itself. A browser lets
    // a share sheet open only that close to the tap that asked for it.
    const early = setTimeout(() => { pictureFor(state, meId).catch(() => {}); }, 650);
    if (pic) {
      pic.onclick = async () => {
        clearTimeout(early);
        sfx.click();
        pic.disabled = true;
        try {
          const how = await sharePicture(await pictureFor(state, meId));
          if (how === 'saved') toast('Picture saved — post it wherever your friends are');
        } catch {
          toast('That picture would not draw — Share link still works', 'error');
        } finally {
          pic.disabled = false;
        }
      };
    }
    wireDoubleWin(root, meId, state);
    wireProfileRows(root, state, () => showGameOver(state, meId, actions), meId);
    paintGameXp($('#goXp', root));
  });
}

// ──────────────────────────────────────────────────────── levels & missions ──
/**
 * The ten daily missions, by kind: the drawing each one wears, and its name
 * for the places that only have the kind to go on (the `progress` event lists
 * kinds). The card itself prints the title the server sends.
 */
export const MISSIONS = {
  playGames: { art: 'people', title: 'Play 2 games' },
  winGame: { art: 'trophy', title: 'Win a game' },
  buyStreets: { art: 'house', title: 'Buy 6 streets' },
  buildHouses: { art: 'crane', title: 'Build 4 houses' },
  collectRent: { art: 'cash', title: 'Collect $1,500 in rent' },
  completeSet: { art: 'deeds', title: 'Complete a colour set' },
  winAuction: { art: 'gavel', title: 'Win an auction' },
  completeTrade: { art: 'trade', title: 'Complete a trade' },
  rollDoubles: { art: 'dice', title: 'Roll 3 doubles' },
  lapsBoard: { art: 'start', title: 'Lap the board 3 times' },
};

/** How far through the current level a player is, 0…1, from the server's four numbers. */
export function levelFraction({ xp, levelFloor, levelNext } = {}) {
  const span = Number(levelNext) - Number(levelFloor);
  if (!(span > 0)) return 0;
  return Math.min(1, Math.max(0, (Number(xp) - Number(levelFloor)) / span));
}

// What the server said the game just finished was worth to this player — the
// `progress` event — kept so the result sheet can show it however many times
// it is redrawn (a profile opened off it hands it back).
let lastProgress = null;

/**
 * Hands the result sheet the game's XP, or null to forget it when a new game
 * starts. If the sheet is already up, its strip fills in on the spot.
 */
export function noteGameProgress(progress) {
  lastProgress = progress || null;
  const slot = document.querySelector('#modalRoot #goXp');
  if (slot) paintGameXp(slot);
}

/**
 * The strip on the result sheet: the level, the bar filling from where it
 * stood before the game to where it stands now, and what the game paid. A
 * game that crossed a level starts the bar from empty — it is a new level's
 * bar — and the celebration says the rest.
 */
function paintGameXp(slot) {
  const p = lastProgress;
  if (!p) { slot.innerHTML = ''; slot.classList.add('hidden'); return; }
  const gained = Math.max(0, Number(p.xpGained) || 0);
  const level = Number(p.level) || 1;
  const now = levelFraction(p);
  const before = p.levelUp ? 0 : levelFraction({ ...p, xp: (Number(p.xp) || 0) - gained });
  const toGo = Math.max(0, (Number(p.levelNext) || 0) - (Number(p.xp) || 0));
  const done = (Array.isArray(p.missionsCompleted) ? p.missionsCompleted : [])
    .map((kind) => MISSIONS[kind]?.title).filter(Boolean);
  slot.innerHTML = `
    <div class="go-xp-row">
      ${levelChip(level)}
      <span class="xp-track" role="progressbar" aria-label="Progress to level ${level + 1}"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(now * 100)}"><i style="width:${(before * 100).toFixed(1)}%"></i></span>
      <b class="go-xp-gain">+${gained} XP</b>
    </div>
    <div class="go-xp-sub">${p.xpCapped
      ? (gained ? 'Daily XP limit reached — this game paid what was left of it'
        : 'Daily XP limit reached — games pay XP again after midnight')
      : `${toGo.toLocaleString('en-US')} XP to Lv ${level + 1}`}</div>
    ${done.length ? `<div class="go-xp-missions">${icon('target', 15)}<span>Mission done: ${
      escapeHtml(done.join(', '))} — the reward is waiting on the home screen</span></div>` : ''}`;
  slot.classList.remove('hidden');
  // One frame at the old width, then the climb, so the bar is seen to fill.
  const bar = slot.querySelector('.xp-track i');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (bar) bar.style.width = `${(now * 100).toFixed(1)}%`;
  }));
}

/**
 * "Level 7!" — a medallion that drops in at the top of whatever is on screen
 * (the result sheet, usually), with the coins the level paid. It is a banner
 * rather than a sheet because it lands on top of one: the results are what
 * the player is reading, and this is news about them, not instead of them.
 * The coins themselves fly in from the wallet read the caller makes.
 */
export function celebrateLevelUp(up) {
  const to = Math.floor(Number(up?.to) || 0);
  if (to < 2) return;
  const coins = Math.max(0, Number(up.coins) || 0);
  document.querySelector('.levelup')?.remove();
  const el = document.createElement('div');
  el.className = 'levelup glass';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="lu-badge">${icon('star', null, 'solo')}<b>${to}</b></span>
    <span class="lu-text"><b>Level ${to}!</b><span>${coins
      ? `${icon('coin', 14)} +${coinWord(coins)}` : 'A new level'}</span></span>`;
  document.body.appendChild(el);
  const leave = () => {
    if (el.classList.contains('out')) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 380);
  };
  el.onclick = leave;
  sfx.setComplete();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) confetti(2200);
  setTimeout(leave, 3800);
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
  // Good news or bad, carried in the colour, because the colour is read a
  // second before the words are. Cards that genuinely cut both ways — advance
  // to the priciest street — keep the deck's own colour and say nothing.
  const tone = card.tone && card.tone !== 'plain' ? ` tone-${card.tone}` : '';
  el.className = `card-popup ${card.deck}${tone}`;
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
