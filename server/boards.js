// Boards are stock now, and the shelf changes every day.
//
// Classic is the house board: free forever, never for sale, the one thing any
// table can fall back to. That matters more than it looks — a player who owns
// nothing, on a day the rotation has dealt them two boards they do not fancy,
// must still be able to sit down and play. So there is always a door open, and
// it is the door the game was built around.
//
// The other eighteen are borrowed or owned. Two of them are free every day —
// the same two for everybody, worked out from the calendar so the server and
// every client reach the same answer without a word passing between them — and
// the rest are bought with coins in the same shop that sells pieces.
//
// The rotation is a shuffled cycle, not a dice roll. Eighteen boards, two a
// day, so every board comes free exactly once in nine days and the order is
// redealt each time round. Nobody waits forever for the one they want, nobody
// can memorise the timetable, and nothing has to be written down: the same
// date always deals the same hand, on any process, after any restart.
//
// One deliberate looseness. Entitlement is checked when a board is CHOSEN, not
// when the game starts. A lobby that sits open across midnight keeps the board
// it picked. The alternative — pulling the board out from under a table that
// is about to start — is a far worse thing to do to four people than one free
// game is to us.

import { MAPS } from './maps.js';

/** Free forever, never for sale. Every table's fallback. */
export const HOUSE_BOARD = 'classic';

/** How many of the rest are free on any given day. */
export const FREE_PER_DAY = 2;

// ---------------------------------------------------------------- the shelf --
// What a board costs is set against what a board IS, and nothing else.
//
// Blitz is a 28-tile board with sixteen streets — a short game, priced short.
// Mr. Worldwide is 48 tiles and ten countries, the biggest thing here. Lucky
// Wheel gives half its board to chance. Death Valley has four sets instead of
// eight. Those are real differences and they are what the numbers below are
// measuring.
//
// The twelve country boards are identical in every way that can be counted:
// eight sets, twenty-two streets, and twenty-eight Treasure and Surprise cards
// written for that country alone. So they cost the same. There is no version
// of this where India is dearer than Spain, and any spread invented to make
// the shelf look livelier would be exactly that — invented.
//
// The shelf gets its life somewhere honest instead: three boards go on sale
// every day, and the order is redealt every day. Over a cycle every board has
// its turn at the front and its turn at a discount, so the list is never the
// same twice and never a price ladder with the dear one parked at the end.
//
// They are also set against the coin packs. 500 coins is $4.99, and that buys
// any country board outright at full price. A price that lands a hundred coins
// above a pack is a trick, and we are not running one.
const PRICES = {
  blitz: 350,        // 28 tiles, 16 streets — the short game
  luckywheel: 400,   // half the board is chance
  bharat: 450,       // 40 tiles, no deck of its own
  deathvalley: 550,  // four sets, head to head
  worldwide: 700,    // 48 tiles, 28 streets, ten countries — the biggest
  // Not a board: a machine that deals a new one every single game, which is
  // why it sits alone at the top of the shelf.
  random: 1200,
};
// Eight sets, twenty-two streets, and twenty-eight cards nobody else has.
const COUNTRY_PRICE = 500;

/** How many boards are discounted on any given day, and by how much. */
export const SALE_PER_DAY = 3;
export const SALE_OFF = 0.30;

/** Store id for a board. Namespaced so it can never collide with a piece. */
export const boardItemId = (mapId) => `brd-${mapId}`;

/** And back again, for a wallet full of ids that mean different things. */
export const mapIdOfItem = (itemId) =>
  (String(itemId || '').startsWith('brd-') ? String(itemId).slice(4) : null);

/**
 * Every board that can be bought, in shelf order: the house specials first,
 * then the countries alphabetically, then Shuffle alone at the end.
 *
 * `random` is not in MAPS — it is generated fresh on every call — so it is
 * named here rather than discovered.
 */
const SELLABLE = (() => {
  const ids = Object.keys(MAPS).filter((id) => id !== HOUSE_BOARD);
  const house = ids.filter((id) => !id.startsWith('country-'));
  const countries = ids.filter((id) => id.startsWith('country-'))
    .sort((a, b) => (MAPS[a].name || a).localeCompare(MAPS[b].name || b));
  return [...house, ...countries, 'random'];
})();

export const priceOf = (mapId) => PRICES[mapId] ?? COUNTRY_PRICE;

/** Catalogue rows, shaped exactly like a piece so buyItem needs no new code. */
export const BOARD_ITEMS = SELLABLE.map((id) => ({
  id: boardItemId(id),
  kind: 'board',
  mapId: id,
  name: id === 'random' ? 'Random' : (MAPS[id]?.name || id),
  emoji: id === 'random' ? '🎲' : (MAPS[id]?.icon || '🎲'),
  price: priceOf(id),
}));

// ------------------------------------------------------------ the rotation --

/**
 * The server's own calendar day, counted in whole days.
 *
 * Deliberately the same notion of "a day" the daily reward keeps (a local
 * civil date, not a UTC instant), so the shelf and the login streak turn over
 * together and a player who opens the app at midnight sees one rollover, not
 * two an hour apart.
 */
export const dayNumber = (when = Date.now()) => {
  const d = new Date(when);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
};

/** The coming server-local midnight — what the countdown on the shelf counts to. */
export const nextRollover = (when = Date.now()) => {
  const d = new Date(when);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
};

/** Small, fast, and identical everywhere — all this needs of a PRNG. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Fisher–Yates against a seeded stream: same seed, same deal, forever. */
function dealtBy(seed, list) {
  const out = [...list];
  const rnd = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Days it takes to get all the way round the shelf. */
export const CYCLE_DAYS = Math.ceil(SELLABLE.length / FREE_PER_DAY);

/**
 * The boards that are free on a given day.
 *
 * A cycle is one full pass over the shelf. The pass is shuffled by its cycle
 * number, so every board is free exactly once per pass and the order is new
 * each time. The modulo on the way out only matters if the shelf ever holds an
 * odd number of boards — then the last day of a pass borrows from the top of
 * it rather than handing back an empty slot.
 */
export function freeBoardsOn(when = Date.now()) {
  const day = dayNumber(when);
  const cycle = Math.floor(day / CYCLE_DAYS);
  const slot = ((day % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
  const order = dealtBy(cycle * 2_654_435_761, SELLABLE);
  return Array.from({ length: FREE_PER_DAY },
    (_, k) => order[(slot * FREE_PER_DAY + k) % order.length]);
}

/**
 * The three boards that are cheap today.
 *
 * Drawn from everything that is NOT free today — discounting a board somebody
 * can already play for nothing is not an offer, it is noise — and dealt by the
 * day, so the sale is the same for everybody and needs no more storing than
 * the free pair does.
 */
export function saleBoardsOn(when = Date.now()) {
  const free = new Set(freeBoardsOn(when));
  const pool = SELLABLE.filter((id) => !free.has(id));
  const order = dealtBy(dayNumber(when) * 1_000_003 + 7, pool);
  return order.slice(0, Math.min(SALE_PER_DAY, pool.length));
}

/** What this board actually costs today, sale and all. Rounded to a round number. */
export function priceOn(mapId, when = Date.now()) {
  const base = priceOf(mapId);
  if (!saleBoardsOn(when).includes(mapId)) return base;
  return Math.round((base * (1 - SALE_OFF)) / 25) * 25;
}

/**
 * The order the shop lays the boards out in today.
 *
 * Redealt daily for the same reason a shop moves its shelves: a list that
 * never changes stops being looked at, and a list sorted by price teaches
 * people to read only one end of it.
 */
export function shelfOrderOn(when = Date.now()) {
  return dealtBy(dayNumber(when) * 2_246_822_519 + 11, SELLABLE);
}

// --------------------------------------------------------------- the answer --

/**
 * May this wallet start a game on this board?
 *
 * The one question the whole file exists to answer, and the one the server
 * asks before it lets a board be chosen. An unknown id is a yes: `getMap`
 * falls back to Classic for anything it does not recognise, so refusing here
 * would only turn a harmless typo into a locked door.
 */
export function mayUseBoard(mapId, owned = [], when = Date.now()) {
  const id = String(mapId || '');
  if (!id || id === HOUSE_BOARD) return true;
  if (!SELLABLE.includes(id)) return true;
  if (owned.includes(boardItemId(id))) return true;
  return freeBoardsOn(when).includes(id);
}

/**
 * The whole shelf as one wallet sees it, for the picker and the shop.
 *
 * `free` is why it is playable, not merely that it is: a board that is free
 * today reads differently from one that is paid for, and the client is told
 * which so it can say so.
 */
export function boardAccess(owned = [], when = Date.now()) {
  const free = freeBoardsOn(when);
  const sale = saleBoardsOn(when);
  const order = shelfOrderOn(when);
  // `price` is always what you would pay right now. `was` appears only when
  // that is less than the sticker, because a "was" that equals the price is
  // the oldest lie in retail.
  const money = (id) => {
    const now = priceOn(id, when);
    const base = priceOf(id);
    return now < base ? { price: now, was: base } : { price: now };
  };
  const state = (id) => {
    if (id === HOUSE_BOARD) return { playable: true, how: 'house', price: 0, shelf: -1 };
    const at = { shelf: order.indexOf(id) };
    if (owned.includes(boardItemId(id))) return { playable: true, how: 'owned', ...money(id), ...at };
    if (free.includes(id)) return { playable: true, how: 'today', ...money(id), ...at };
    return { playable: false, how: 'locked', ...money(id), ...at };
  };
  return {
    free,
    sale,
    until: nextRollover(when),
    cycleDays: CYCLE_DAYS,
    perDay: FREE_PER_DAY,
    saleOff: SALE_OFF,
    house: HOUSE_BOARD,
    state,
  };
}
