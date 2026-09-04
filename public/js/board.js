// Board rendering: builds the tile grid once per map, patches ownership and
// buildings on every update, and animates player tokens on a floating layer so
// they can hop tile-by-tile instead of teleporting.

import { ART, utilityArt, icon, groupFlag, circleFlag } from './icons.js';
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
    // No tint at birth: the wash is the owner's mark, painted only once
    // somebody buys the place (see the patch loop below).
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

// Each tile carries the group colour as a wash from the inner edge, a round
// medallion for identity astride that edge, and the price on its own chip at
// the outer edge.
function tileMarkup(tile, groups) {
  const g = tile.group ? groups[tile.group] : null;
  const price = tile.price ? `<span class="tile-price">${tile.price}$</span>` : '';
  const art = (drawing, cls = '') => `<span class="tile-art ${cls}">${drawing}</span>`;

  // A country used to fly an emoji — missing outright on Windows, and a
  // different vendor's drawing on every other platform. Countries get their
  // flag drawn instead, cropped into a round medallion that rides the tile's
  // inner edge — half on the colour band, half out over the board, the way a
  // printed richup board wears them. The regional boards keep their
  // pictograph, centred in the same circle. It is its own layer rather than
  // part of the body: the body rotates on the side columns, and a flag has
  // to read upright from every seat.
  const medal = tile.type === 'property'
    ? `<span class="medal">${circleFlag(g?.flag, g?.color)}</span>` : '';

  let body;
  switch (tile.type) {
    case 'property':
      body = `${price}<span class="tile-name">${escapeHtml(tile.name)}</span>`;
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
              <span class="tile-sub vac-sub">skip a turn</span>`;
      break;
    case 'gotoprison':
      body = `${art(ART.gotoprison, 'huge')}<span class="tile-name">Go to prison</span>`;
      break;
    default:
      body = `<span class="tile-name">${escapeHtml(tile.name || '')}</span>`;
  }

  // The mortgage stamp is its own layer rather than a CSS `content:` mark, so
  // it can be the drawn bank instead of an emoji the stylesheet has to spell.
  const stamp = isOwnable(tile) ? `<div class="tile-stamp">${icon('bank')}</div>` : '';

  // Buildings live INSIDE the body, the way the app draws them: on the narrow
  // side rails a chip riding the outer edge hung off the tile and over its
  // neighbour. The medallion keeps the edge to itself.
  return `<div class="tile-wash"></div>
    <div class="tile-body">${body}<div class="tile-houses"></div></div>
    ${medal}
    ${stamp}
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

  // The pot rides on the tile it pays out from — you should be able to see
  // what landing there is worth without hunting for a panel.
  const vacIdx = state.map.tiles.findIndex((t) => t.type === 'vacation');
  const vacSub = vacIdx >= 0 ? tileEls[vacIdx]?.querySelector('.vac-sub') : null;
  if (vacSub) {
    const pot = state.settings?.vacationCash ? (state.vacationPot || 0) : 0;
    const text = pot > 0 ? `$${pot.toLocaleString('en-US')} on hold` : 'skip a turn';
    if (vacSub.textContent !== text) {
      vacSub.textContent = text;
      vacSub.classList.toggle('has-pot', pot > 0);
    }
  }

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
    // Unowned streets stay clean — the medallion names the country; the
    // band is the owner's mark alone.
    el.style.setProperty('--g', owner ? owner.color : 'transparent');
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
        ? `<span class="hotel-badge">${ART.hotel}<b>HOTEL</b></span>`
        : h > 0
          ? `<span class="house">${ART.house}</span>${h > 1 ? `<b class="house-count">${h}×</b>` : ''}`
          : '';
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
export function resetBoard() {
  builtMapId = null; tileEls = []; tokens.clear(); resetSetTracking();
  // Leaving mid-deal must not strand the flying deck on the next table,
  // nor leave its clean-up timer to go off over the next room's board.
  dealtRoom = null;
  clearTimeout(dealTimer); dealTimer = null;
  const wrap = boardWrap();
  wrap?.classList.remove('undealt', 'dealing');
  wrap?.querySelector('.deal-deck.deal-out')?.remove();
}

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

/**
 * Put a token on a tile.
 *
 * `ease` matters more than it looks: every move used to inherit the stylesheet's
 * `linear`, and a piece that crosses a tile at a constant speed and stops dead
 * reads as a cursor being dragged rather than a piece being played.
 *
 * `lift` raises the token off the board without moving it along it — the
 * carried half of a teleport, where the piece is picked up, flown, and set
 * down rather than sliding through the middle of the felt.
 */
function place(state, playerId, tileIndex, ms = 0, ease = 'linear', lift = 0) {
  const rec = tokens.get(playerId);
  const c = tileCenter(tileIndex);
  if (!rec || !c) return;
  const [ox, oy] = slotFor(state, playerId, tileIndex);
  rec.el.style.transitionTimingFunction = ease;
  rec.el.style.transitionDuration = `${ms}ms`;
  rec.el.style.transform = `translate(${c.x + ox * c.size}px, ${c.y + oy * c.size - lift}px) translate(-50%, -50%)`;
  rec.pos = tileIndex;
}

/** A step of a walk: quick, with a little overshoot, so it lands rather than stops. */
const STEP_EASE = 'cubic-bezier(.32, 1.45, .52, 1)';
/** Carried through the air: slow out, slow in, nothing abrupt at either end. */
const FLIGHT_EASE = 'cubic-bezier(.45, 0, .25, 1)';

/**
 * Reconciles the token layer with server state. Tokens hop tile by tile when a
 * player rolled, and glide directly when they were teleported by a card.
 */
export function syncTokens(state, { onStep, onArrive, onJailed, meId } = {}) {
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
    // Eight discs of similar size, and one of them is yours. Marking it — a
    // quiet ring always, a lit one on your own turn — is the difference
    // between reading the board and hunting for yourself on it.
    rec.el.classList.toggle('is-mine', !!meId && p.id === meId);
    rec.el.title = p.name;
  }

  const move = state.lastMove;
  const fresh = move && move.at !== lastMoveAt;
  if (fresh) lastMoveAt = move.at;

  for (const p of state.players) {
    if (p.bankrupt) continue;
    const rec = tokens.get(p.id);
    // Mid-air, and already on its way to the right tile: leave it alone.
    if (flying.get(p.id) === p.pos) continue;
    if (!rec || rec.pos === p.pos) { place(state, p.id, p.pos, 220, 'ease-out'); continue; }

    const gen = (walkGen.get(p.id) || 0) + 1;
    walkGen.set(p.id, gen);

    if (fresh && move.playerId === p.id && move.steps) {
      walk(state, p, rec.pos, p.pos, move.steps > 0 ? 1 : -1, gen, onStep, onArrive);
    } else {
      // Why the piece is being carried, as the server told it: a card, or a
      // jailing. Only the second one slams a door.
      const cause = [...(state.moves || [])].reverse()
        .find((m) => m.playerId === p.id && m.to === p.pos)?.cause;
      fly(state, p, p.pos, gen, onArrive, (who, at) => {
        if (cause !== 'jail') return;
        slamPrison(at);
        onJailed?.(who, at);
      });
    }
  }
}

async function walk(state, player, from, to, dir, gen, onStep, onArrive) {
  const size = state.map.size;
  const distance = dir > 0 ? (to - from + size) % size : (from - to + size) % size;
  // Long rolls used to run at 55ms a tile, which is faster than an eye can
  // follow a piece around a corner. Slow enough to read, quick enough that
  // eleven of them is not a wait.
  const ms = distance > 12 ? 78 : distance > 7 ? 96 : 128;
  let cur = from;
  for (let n = 0; n < distance; n++) {
    if (walkGen.get(player.id) !== gen) return;
    cur = (cur + dir + size) % size;
    place(state, player.id, cur, ms, STEP_EASE);
    onStep?.(cur, n === distance - 1);
    await sleep(ms);
  }
  if (walkGen.get(player.id) === gen) onArrive?.(player);
}

/**
 * Not a walk: a card, or the corner that sends you to prison.
 *
 * This used to be one 420ms straight line, which on a square board means the
 * piece cuts diagonally across the middle of the felt — over the logo, through
 * the dice — and arrives somewhere else with nothing to say it happened. Watch
 * a game and you cannot tell that "Go to prison" sent you to prison.
 *
 * So the piece is picked up, carried, and set down. Three beats, and the one
 * in the middle is slow enough to follow with your eyes.
 */
// Where each token is being carried to, while it is in the air. The board is
// re-rendered on every push from the server — a bid, a chat line, somebody
// else's rent — and each of those used to start the flight again from
// wherever the piece had got to. The lift never finished, so the piece
// appeared to slide and then drop for no reason. A flight already heading for
// the right tile is left alone.
const flying = new Map();

/**
 * The door closing behind somebody.
 *
 * Only for an arrival that is a jailing — a card that lands you on the prison
 * tile as a visitor is not the same event and gets nothing. The tile itself
 * does the reacting, because the piece is small and the corner is where the
 * eye needs to be told to look.
 */
function slamPrison(index) {
  const el = tileEls[index];
  if (!el) return;
  el.classList.remove('slammed');
  // Reading it back restarts the animation on a second jailing in one game.
  void el.offsetWidth;
  el.classList.add('slammed');
  setTimeout(() => el.classList.remove('slammed'), 900);
}

async function fly(state, player, to, gen, onArrive, onLand) {
  const rec = tokens.get(player.id);
  if (!rec) return;
  const from = rec.pos;
  const alive = () => walkGen.get(player.id) === gen;
  flying.set(player.id, to);
  const land = () => { if (flying.get(player.id) === to) flying.delete(player.id); };

  rec.el.classList.add('in-flight');
  place(state, player.id, from, 190, 'cubic-bezier(.2,.8,.3,1)', 26);   // lifted
  await sleep(190);
  if (!alive()) { rec.el.classList.remove('in-flight'); land(); return; }

  place(state, player.id, to, 560, FLIGHT_EASE, 26);                    // carried
  await sleep(560);
  if (!alive()) { rec.el.classList.remove('in-flight'); land(); return; }

  place(state, player.id, to, 260, 'cubic-bezier(.34,1.5,.5,1)', 0);    // set down
  await sleep(260);
  rec.el.classList.remove('in-flight');
  land();
  if (!alive()) return;
  onLand?.(player, to);
  onArrive?.(player);
}

/** Keeps tokens glued to their tiles when the window resizes. */
export function repositionTokens(state) {
  if (!state) return;
  for (const [id, rec] of tokens) {
    if (rec.pos != null) place(state, id, rec.pos, 0);
  }
}

// ═══════════════════════════════════════════════════════════════ deal-in ══
// Web twin of the iOS deck intro: a quick-match table keeps its tiles in the
// deck while it looks for players, and every fresh game opens with the deck
// dealing the board out — each tile flying from the middle of the table.

// Room whose current game has already been dealt — state is pushed dozens of
// times a game, and only the first render after kick-off gets the flourish.
// Passing back through a lobby re-arms it: the next start is a fresh game.
let dealtRoom = null;
// The deal's clean-up timer, held so leaving mid-deal can cancel it — left
// running it would fire into whatever board is on screen two seconds later.
let dealTimer = null;

const boardWrap = () => document.getElementById('board')?.parentElement;

/** The drawn deck: stacked card backs in the game's red, "MM" on each. */
export function deckMarkup(extra = '') {
  const cards = Array.from({ length: 7 }, (_, i) =>
    `<i class="deal-card" style="--i:${i};--h:${i % 2 ? 1 : -1}"></i>`).join('');
  return `<div class="deal-deck${extra ? ` ${extra}` : ''}" aria-hidden="true">${cards}</div>`;
}

/**
 * An undealt table: while a quick match is still finding players the tiles
 * stay in the deck, so kick-off has a moment to make. A private lobby keeps
 * the full preview — the host picked that map to look at it.
 */
export function syncUndealt(state) {
  const wrap = boardWrap();
  if (!wrap) return;
  wrap.classList.toggle('undealt',
    state.status === 'lobby' && !!state.quick && !!state.quickStartAt);
  if (state.status === 'lobby') dealtRoom = null;
}

/**
 * The deal at kick-off: a deck at the board centre riffles once and sinks
 * away while every tile flies out to its place, one after another. The
 * caller fires this on the lobby → playing edge it watched happen, so a
 * reconnect or a mid-game join shows the board instantly instead.
 */
export function dealBoardIn(state) {
  const wrap = boardWrap();
  const root = document.getElementById('board');
  if (!wrap || !root || dealtRoom === state.id) return false;
  dealtRoom = state.id;

  // Measure before any transform lands — a transformed tile reports the rect
  // of wherever it is mid-flight, not of its seat in the grid.
  const b = root.getBoundingClientRect();
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;

  const RIFFLE = 620;   // the deck's one riffle before the first card leaves
  const STAGGER = 25;   // per-tile delay, matching the iOS deal
  const FLIGHT = 520;
  let last = 0;

  tileEls.forEach((el, i) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = cx - (r.left + r.width / 2);
    const dy = cy - (r.top + r.height / 2);
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(-24deg) scale(.22)`;
    el.style.opacity = '0';
    last = i;
  });
  void root.offsetWidth; // commit the stacked state before releasing it

  wrap.classList.add('dealing'); // tokens stay hidden until the cards land
  wrap.insertAdjacentHTML('beforeend', deckMarkup('deal-out'));

  tileEls.forEach((el, i) => {
    if (!el) return;
    el.style.transition = `transform ${FLIGHT}ms cubic-bezier(.22, 1.35, .36, 1), opacity 300ms ease-out`;
    el.style.transitionDelay = `${RIFFLE + i * STAGGER}ms`;
    el.style.transform = '';
    el.style.opacity = '';
  });

  clearTimeout(dealTimer);
  dealTimer = setTimeout(() => {
    dealTimer = null;
    tileEls.forEach((el) => {
      if (!el) return;
      el.style.transition = '';
      el.style.transitionDelay = '';
    });
    wrap.classList.remove('dealing');
    wrap.querySelector('.deal-deck.deal-out')?.remove();
    // Tokens placed while their tile was mid-flight measured a moving target.
    repositionTokens(state);
  }, RIFFLE + last * STAGGER + FLIGHT + 80);
  return true;
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
      <span class="deed-flag">${g
        ? groupFlag(g.flag, 'currentColor')
        : tile.type === 'airport' ? ART.airport
          : tile.type === 'utility' ? utilityArt(tile.icon)
          : ART.tax}</span>
      <span class="deed-title">${escapeHtml(tile.name)}</span>
    </div>
    ${tile.price ? `<div class="deed-price">$${tile.price}</div>` : ''}
    ${actions}
    <div class="deed-rows">${rows}${mort}${ownerRow}</div>
  </div>`;
}
