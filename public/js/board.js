// Board rendering: builds the tile grid once per map, patches ownership and
// buildings on every update, and animates player tokens on a floating layer so
// they can hop tile-by-tile instead of teleporting.

import { ART, utilityArt } from './icons.js';
import { sfx } from './sound.js';

let builtMapId = null;
let tileEls = [];

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const isOwnable = (t) => ['property', 'airport', 'utility'].includes(t.type);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════ build the grid ══
export function renderBoard(state, root) {
  const { map, groups } = state;
  // uid, not id — two "random" boards are different boards.
  const key = map.uid || map.id;
  if (builtMapId === key && tileEls.length === map.tiles.length) return false;

  builtMapId = key;
  root.innerHTML = '';
  tileEls = new Array(map.tiles.length);
  resetSetTracking(); // a fresh grid must not flash sets it just learned about

  const L = map.layout;
  const cols = Math.max(L.top.length, L.bottom.length) + 2;
  const rows = Math.max(L.left.length, L.right.length) + 2;
  root.style.gridTemplateColumns = `1.5fr repeat(${cols - 2}, 1fr) 1.5fr`;
  root.style.gridTemplateRows = `1.5fr repeat(${rows - 2}, 1fr) 1.5fr`;

  const place = (index, row, col, side) => {
    const tile = map.tiles[index];
    const el = document.createElement('div');
    el.className = `tile t-${side}${side === 'corner' ? ' corner' : ''}${isOwnable(tile) ? ' ownable' : ''} type-${tile.type}`;
    const tint = tile.group ? groups[tile.group]?.color
      : tile.type === 'airport' ? '#6aa2ff'
      : tile.type === 'utility' ? '#3fd8ef' : '';
    if (tint) el.style.setProperty('--g', tint);
    el.style.gridRow = row;
    el.style.gridColumn = col;
    el.dataset.i = index;
    el.innerHTML = tileMarkup(tile, groups);
    root.appendChild(el);
    tileEls[index] = el;
  };

  const [c0, c1, c2, c3] = L.corners;
  place(c0, 1, 1, 'corner');
  L.top.forEach((idx, k) => place(idx, 1, k + 2, 'top'));
  place(c1, 1, cols, 'corner');
  L.right.forEach((idx, k) => place(idx, k + 2, cols, 'right'));
  place(c2, rows, cols, 'corner');
  L.bottom.forEach((idx, k) => place(idx, rows, cols - 1 - k, 'bottom'));
  place(c3, rows, 1, 'corner');
  L.left.forEach((idx, k) => place(idx, rows - 1 - k, 1, 'left'));
  return true;
}

// Each tile carries the group colour as a wash from the inner edge, a round flag
// medallion for identity, and the price on its own chip at the outer edge.
function tileMarkup(tile, groups) {
  const g = tile.group ? groups[tile.group] : null;
  const price = tile.price ? `<span class="tile-price">${tile.price}$</span>` : '';
  const flag = (mark) => `<span class="medal"><span>${mark}</span></span>`;
  const art = (drawing, cls = '') => `<span class="tile-art ${cls}">${drawing}</span>`;

  let body;
  switch (tile.type) {
    case 'property':
      body = `${price}<span class="tile-name">${escapeHtml(tile.name)}</span>${flag(g?.flag || '🏳️')}`;
      break;
    case 'airport':
      body = `${price}<span class="tile-name">${escapeHtml(tile.name)}</span>${art(ART.airport)}`;
      break;
    case 'utility':
      body = `${price}<span class="tile-name">${escapeHtml(tile.name)}</span>${art(utilityArt(tile.icon))}`;
      break;
    case 'tax':
      body = `<span class="tile-name">${escapeHtml(tile.name)}</span>${art(ART.tax)}
              <span class="tile-price solo">${tile.amount ? `$${tile.amount}` : `${tile.percent}%`}</span>`;
      break;
    case 'refund':
      body = `<span class="tile-name">${escapeHtml(tile.name)}</span>${art(ART.refund)}
              <span class="tile-price solo">$${tile.amount}</span>`;
      break;
    case 'treasure':
      body = `<span class="tile-name accent-treasure">Treasure</span>${art(ART.treasure, 'big')}`;
      break;
    case 'surprise':
      body = `<span class="tile-name accent-surprise">Surprise</span>${art(ART.surprise, 'big')}`;
      break;
    case 'start':
      body = `<span class="tile-name start-word">START</span>${art(ART.start, 'huge')}
              <span class="tile-sub">collect $200</span>`;
      break;
    case 'prison':
      body = `<span class="tile-sub">Passing by</span>${art(ART.prison, 'huge')}
              <span class="tile-name">In Prison</span>`;
      break;
    case 'vacation':
      body = `${art(ART.vacation, 'huge')}<span class="tile-name">Vacation</span>
              <span class="tile-sub">skip a turn</span>`;
      break;
    case 'gotoprison':
      body = `${art(ART.gotoprison, 'huge')}<span class="tile-name">Go to prison</span>`;
      break;
    default:
      body = `<span class="tile-name">${escapeHtml(tile.name || '')}</span>`;
  }

  return `<div class="tile-wash"></div>
    <div class="tile-body">${body}</div>
    <div class="tile-houses"></div>
    <div class="tile-owner"></div>`;
}

// ══════════════════════════════════════════════════ ownership / buildings ══

// group key -> ownerId for every completed set, so a NEW completion (buy or
// trade) can flood-flash the whole section in the owner's colour.
const completedSets = new Map();
let setsSeeded = false;
export function resetSetTracking() { completedSets.clear(); setsSeeded = false; }

export function patchBoard(state) {
  const { ownership, players } = state;
  const owners = new Map(players.map((p) => [p.id, p]));

  // which colour groups are fully owned right now, and by whom
  const nowComplete = new Map();
  for (const [g, idxs] of Object.entries(state.map.groups || {})) {
    if (!idxs.length) continue;
    const owner = ownership[idxs[0]]?.owner;
    if (owner && idxs.every((k) => ownership[k]?.owner === owner)) nowComplete.set(g, owner);
  }
  if (setsSeeded && state.status === 'playing') {
    for (const [g, owner] of nowComplete) {
      if (completedSets.get(g) === owner) continue;
      // a set just came together — pulse the whole section, deep then back
      (state.map.groups[g] || []).forEach((k) => {
        const el = tileEls[k];
        if (!el) return;
        el.classList.remove('set-flash');
        void el.offsetWidth; // restart the animation if it re-fires
        el.classList.add('set-flash');
        setTimeout(() => el.classList.remove('set-flash'), 3500);
      });
      sfx.setComplete();
    }
  }
  completedSets.clear();
  for (const [g, owner] of nowComplete) completedSets.set(g, owner);
  setsSeeded = true;

  state.map.tiles.forEach((tile, i) => {
    const el = tileEls[i];
    if (!el) return;
    const own = ownership[i];
    const owner = own ? owners.get(own.owner) : null;

    el.classList.toggle('owned', !!owner);
    el.classList.toggle('mortgaged', !!own?.mortgaged);
    el.style.setProperty('--own-color', owner?.color || 'transparent');

    // richup rule: a bought tile's colour band belongs to its owner, and a
    // full country wears a thicker band plus a ring — one glance says whose.
    const groupTint = tile.group ? state.groups[tile.group]?.color
      : tile.type === 'airport' ? '#6aa2ff'
      : tile.type === 'utility' ? '#3fd8ef' : '';
    const fullSet = !!(owner && tile.group
      && (state.map.groups?.[tile.group] || []).length
      && state.map.groups[tile.group].every((k) => ownership[k]?.owner === owner.id));
    el.style.setProperty('--g', owner ? owner.color : (groupTint || 'transparent'));
    el.classList.toggle('full-set', fullSet);

    const badge = el.querySelector('.tile-owner');
    const sig = owner ? owner.id + (own.mortgaged ? 'm' : '') : '';
    if (badge.dataset.sig !== sig) {
      badge.dataset.sig = sig;
      badge.innerHTML = owner
        ? `<span class="owner-dot" style="background:${owner.color}">${escapeHtml(owner.name[0] || '?').toUpperCase()}</span>`
        : '';
    }

    const houses = el.querySelector('.tile-houses');
    const h = own?.houses || 0;
    el.classList.toggle('has-buildings', h > 0);
    if (houses.dataset.v !== String(h)) {
      houses.dataset.v = String(h);
      houses.innerHTML = h === 5
        ? `<span class="hotel">${ART.hotel}</span>`
        : Array.from({ length: h }, () => `<span class="house">${ART.house}</span>`).join('');
    }
  });
}

export function highlightTiles(state) {
  const cur = state.turn ? state.players.find((p) => p.id === state.turn.playerId) : null;
  tileEls.forEach((el, i) => {
    if (!el) return;
    el.classList.toggle('active-tile', !!cur && cur.pos === i);
  });
}

export function tileElement(i) { return tileEls[i]; }
export function resetBoard() { builtMapId = null; tileEls = []; tokens.clear(); resetSetTracking(); }

// ═══════════════════════════════════════════════════════════ token layer ══
const tokens = new Map();   // playerId -> { el, pos }
const walkGen = new Map();  // playerId -> generation counter
let layerEl = null;
let lastMoveAt = 0;

const SLOT_OFFSETS = [
  [-0.20, -0.18], [0.20, -0.18], [-0.20, 0.18], [0.20, 0.18],
  [0, -0.30], [0, 0.30], [-0.34, 0], [0.34, 0],
];

function tileCenter(i) {
  const tile = tileEls[i];
  if (!tile || !layerEl) return null;
  const t = tile.getBoundingClientRect();
  const w = layerEl.getBoundingClientRect();
  return { x: t.left - w.left + t.width / 2, y: t.top - w.top + t.height / 2, size: Math.min(t.width, t.height) };
}

function slotFor(state, playerId, tileIndex) {
  const here = state.players.filter((p) => !p.bankrupt && p.pos === tileIndex).map((p) => p.id);
  const k = here.indexOf(playerId);
  if (here.length <= 1 || k === -1) return [0, 0];
  return SLOT_OFFSETS[k % SLOT_OFFSETS.length];
}

function place(state, playerId, tileIndex, ms = 0) {
  const rec = tokens.get(playerId);
  const c = tileCenter(tileIndex);
  if (!rec || !c) return;
  const [ox, oy] = slotFor(state, playerId, tileIndex);
  rec.el.style.transitionDuration = `${ms}ms`;
  rec.el.style.transform = `translate(${c.x + ox * c.size}px, ${c.y + oy * c.size}px) translate(-50%, -50%)`;
  rec.pos = tileIndex;
}

/**
 * Reconciles the token layer with server state. Tokens hop tile by tile when a
 * player rolled, and glide directly when they were teleported by a card.
 */
export function syncTokens(state, { onStep, onArrive } = {}) {
  layerEl = document.getElementById('tokenLayer');
  if (!layerEl) return;

  // add / remove
  const live = new Set(state.players.filter((p) => !p.bankrupt).map((p) => p.id));
  for (const [id, rec] of tokens) {
    if (!live.has(id)) { rec.el.remove(); tokens.delete(id); }
  }
  for (const p of state.players) {
    if (p.bankrupt) continue;
    let rec = tokens.get(p.id);
    if (!rec) {
      const el = document.createElement('div');
      el.className = 'token';
      layerEl.appendChild(el);
      rec = { el, pos: null, face: null };
      tokens.set(p.id, rec);
      rec.el.style.background = p.color;
      rec.el.style.setProperty('--tc', p.color);
      place(state, p.id, p.pos, 0);
    }
    // a store token skin replaces the initial — live, so equipping mid-game
    // restyles the piece on everyone's board
    const face = p.tokenSkin || (p.name[0] || '?').toUpperCase();
    if (rec.face !== face) {
      rec.face = face;
      rec.el.innerHTML = `<span class="token-face${p.tokenSkin ? ' skin' : ''}">${escapeHtml(face)}</span>`;
    }
    rec.el.classList.toggle('is-turn', state.turn?.playerId === p.id && state.status === 'playing');
    rec.el.title = p.name;
  }

  const move = state.lastMove;
  const fresh = move && move.at !== lastMoveAt;
  if (fresh) lastMoveAt = move.at;

  for (const p of state.players) {
    if (p.bankrupt) continue;
    const rec = tokens.get(p.id);
    if (!rec || rec.pos === p.pos) { place(state, p.id, p.pos, 220); continue; }

    const gen = (walkGen.get(p.id) || 0) + 1;
    walkGen.set(p.id, gen);

    if (fresh && move.playerId === p.id && move.steps) {
      walk(state, p, rec.pos, p.pos, move.steps > 0 ? 1 : -1, gen, onStep, onArrive);
    } else {
      place(state, p.id, p.pos, 420);
      onArrive?.(p);
    }
  }
}

async function walk(state, player, from, to, dir, gen, onStep, onArrive) {
  const size = state.map.size;
  const distance = dir > 0 ? (to - from + size) % size : (from - to + size) % size;
  const ms = distance > 12 ? 55 : distance > 7 ? 80 : 115;
  let cur = from;
  for (let n = 0; n < distance; n++) {
    if (walkGen.get(player.id) !== gen) return;
    cur = (cur + dir + size) % size;
    place(state, player.id, cur, ms);
    onStep?.(cur, n === distance - 1);
    await sleep(ms);
  }
  if (walkGen.get(player.id) === gen) onArrive?.(player);
}

/** Keeps tokens glued to their tiles when the window resizes. */
export function repositionTokens(state) {
  if (!state) return;
  for (const [id, rec] of tokens) {
    if (rec.pos != null) place(state, id, rec.pos, 0);
  }
}

// ══════════════════════════════════════════════════════════ deed rendering ══
const RENT_LABELS = ['Base rent', 'With 1 house', 'With 2 houses', 'With 3 houses', 'With 4 houses', 'With hotel'];

/**
 * The deed card. `actions` is a slot for the owner's Build / Sell / Mortgage
 * row: it renders straight under the price, because those are the buttons
 * people opened the card for — behind the rent table they may as well not exist.
 */
export function deedMarkup(state, i, { compact = false, actions = '' } = {}) {
  const tile = state.map.tiles[i];
  if (!tile || !['property', 'airport', 'utility', 'tax'].includes(tile.type)) return null;

  const own = state.ownership[i];
  const owner = own ? state.players.find((p) => p.id === own.owner) : null;
  const g = tile.group ? state.groups[tile.group] : null;
  const headColor = g?.color || (tile.type === 'airport' ? '#5b8def' : tile.type === 'utility' ? '#38bdf8' : '#7c6bb0');

  let rows = '';
  if (tile.type === 'property') {
    rows = tile.rent.map((r, k) => `<div class="deed-row${(own?.houses || 0) === k && owner ? ' hl' : ''}">
        <span>${RENT_LABELS[k]}</span><b>$${r}</b></div>`).join('');
    rows += `<div class="deed-row sep"><span>House / hotel cost</span><b>$${tile.houseCost}</b></div>`;
  } else if (tile.type === 'airport') {
    const held = owner ? state.map.tiles.filter((t, k) => t.type === 'airport' && state.ownership[k]?.owner === owner.id).length : 0;
    rows = [1, 2, 3, 4].map((n) => `<div class="deed-row${held === n ? ' hl' : ''}">
        <span>${n} airport${n > 1 ? 's' : ''} owned</span><b>$${25 * 2 ** (n - 1)}</b></div>`).join('');
  } else if (tile.type === 'utility') {
    const held = owner ? state.map.tiles.filter((t, k) => t.type === 'utility' && state.ownership[k]?.owner === owner.id).length : 0;
    rows = `<div class="deed-row${held === 1 ? ' hl' : ''}"><span>1 utility owned</span><b>4 × dice</b></div>
            <div class="deed-row${held >= 2 ? ' hl' : ''}"><span>2 utilities owned</span><b>10 × dice</b></div>`;
  } else {
    rows = `<div class="deed-row"><span>Pay</span><b>${tile.amount ? `$${tile.amount}` : `${tile.percent}% of your cash`}</b></div>`;
  }

  const mort = tile.price ? `<div class="deed-row"><span>Mortgage value</span><b>$${Math.floor(tile.price / 2)}</b></div>` : '';
  const ownerRow = tile.price ? `<div class="deed-row"><span>Owner</span>${owner
    ? `<b style="color:${owner.color}">${escapeHtml(owner.name)}${own.mortgaged ? ' (mortgaged)' : ''}</b>`
    : '<b class="dim">Bank</b>'}</div>` : '';

  return `<div class="deed${compact ? ' compact' : ''}">
    <div class="deed-head" style="background:${headColor}">
      <span class="deed-flag">${g?.flag
        || (tile.type === 'airport' ? ART.airport
          : tile.type === 'utility' ? utilityArt(tile.icon)
          : ART.tax)}</span>
      <span class="deed-title">${escapeHtml(tile.name)}</span>
    </div>
    ${tile.price ? `<div class="deed-price">$${tile.price}</div>` : ''}
    ${actions}
    <div class="deed-rows">${rows}${mort}${ownerRow}</div>
  </div>`;
}
