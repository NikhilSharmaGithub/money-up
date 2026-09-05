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
// Prices are set against the coin economy the pieces already live in: a win
// pays 2, the daily ladder pays 1 to 7, a watched ad pays 2 with four a day,
// so a regular player banks something like 200 coins a month and a daily one
// closer to 600.
//
// They are also set against the coin packs, and set so that no pack ever just
// barely misses. 500 coins ($4.99) buys any country board outright. 1100
// ($9.99) buys anything on the shelf but Shuffle. 2500 ($19.99) buys Shuffle
// with change. A price that lands a hundred coins above a pack is a trick, and
// we are not running one.
//
// Every country costs the same. There is no version of this where one nation's
// board is worth more than another's.
const PRICES = {
  // house boards — each its own idea of a game
  bharat: 600,
  blitz: 600,
  luckywheel: 650,
  deathvalley: 750,
  worldwide: 800,
  // not a board — a machine that deals a new one every single game, which is
  // why it sits alone at the top of the shelf.
  random: 1500,
};
const COUNTRY_PRICE = 500;

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
  const state = (id) => {
    if (id === HOUSE_BOARD) return { playable: true, how: 'house', price: 0 };
    if (owned.includes(boardItemId(id))) return { playable: true, how: 'owned', price: priceOf(id) };
    if (free.includes(id)) return { playable: true, how: 'today', price: priceOf(id) };
    return { playable: false, how: 'locked', price: priceOf(id) };
  };
  return {
    free,
    until: nextRollover(when),
    cycleDays: CYCLE_DAYS,
    perDay: FREE_PER_DAY,
    house: HOUSE_BOARD,
    state,
  };
}
