// The continent boards: one per inhabited continent, eight of its countries
// on each, on the classic board to the tile.
//
// A board is pure server data and every client reads it off the wire, so the
// only way one of these can be wrong is quietly — a city filed under the
// wrong flag, two sets a player cannot tell apart, a country key that
// silently repaints a region on another board, a shelf whose rotation skips
// somebody. Each of those is checked here:
//
//   · all six build, forty tiles in the classic shape, classic prices
//   · 22 streets in sets of 2,3,3,3,3,3,3,2, four airports, two utilities
//   · every set is a country of that continent, cheapest first, and its flag
//     emoji really is that country's flag
//   · the eight colours on each board can be told apart
//   · the web client has drawn every one of those flags, both as cloth and
//     as a coin (FLAG_ART and CIRCLE_FLAG_ART in public/js/icons.js)
//   · the shop sells all six, shelved between the house boards and the
//     countries, at Bharat's price — like Bharat, they have forty tiles and
//     no deck of their own
//   · the free-pair rotation still reaches every board once per pass
//
//   node test/continent-boards.mjs
//
// Nothing here starts a server or opens a port.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAPS, GROUPS, getMap, mapList } from '../server/maps.js';
import {
  BOARD_ITEMS, CYCLE_DAYS, FREE_PER_DAY, SALE_PER_DAY, boardAccess, boardItemId,
  dayNumber, freeBoardsOn, isBoardForSale, mayUseBoard, priceOf, saleBoardsOn,
} from '../server/boards.js';
import { STORE_ITEMS } from '../server/store.js';
import { buildDecks } from '../server/cards.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
let passed = 0;
const PASS = (ok, label, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  return ok;
};
const section = (t) => console.log(`\n── ${t}`);

// ------------------------------------------------------------- the brief --
// The six boards as decided, cheapest set first. Written out here rather than
// read back from maps.js, so a country moved to the wrong board, or a set
// shuffled out of price order, is a failure rather than the new truth.
const CONTINENTS = {
  'continent-africa': {
    name: 'Africa',
    icon: '🗺️',
    sets: [['ET', 'Ethiopia'], ['GH', 'Ghana'], ['TZ', 'Tanzania'], ['KE', 'Kenya'],
      ['MA', 'Morocco'], ['NG', 'Nigeria'], ['EG', 'Egypt'], ['ZA', 'South Africa']],
  },
  'continent-asia': {
    name: 'Asia',
    icon: '🗺️',
    sets: [['VN', 'Vietnam'], ['ID', 'Indonesia'], ['TH', 'Thailand'], ['IN', 'India'],
      ['KR', 'South Korea'], ['AE', 'United Arab Emirates'], ['CN', 'China'], ['JP', 'Japan']],
  },
  'continent-europe': {
    name: 'Europe',
    icon: '🗺️',
    sets: [['PT', 'Portugal'], ['GR', 'Greece'], ['NL', 'Netherlands'], ['ES', 'Spain'],
      ['IT', 'Italy'], ['DE', 'Germany'], ['FR', 'France'], ['UK', 'United Kingdom']],
  },
  'continent-north-america': {
    name: 'North America',
    icon: '🗺️',
    sets: [['JM', 'Jamaica'], ['CU', 'Cuba'], ['DO', 'Dominican Republic'], ['CR', 'Costa Rica'],
      ['PA', 'Panama'], ['MX', 'Mexico'], ['CA', 'Canada'], ['US', 'United States']],
  },
  'continent-south-america': {
    name: 'South America',
    icon: '🗺️',
    sets: [['BO', 'Bolivia'], ['EC', 'Ecuador'], ['UY', 'Uruguay'], ['PE', 'Peru'],
      ['CO', 'Colombia'], ['CL', 'Chile'], ['AR', 'Argentina'], ['BR', 'Brazil']],
  },
  'continent-oceania': {
    name: 'Oceania',
    icon: '🗺️',
    sets: [['WS', 'Samoa'], ['TO', 'Tonga'], ['SB', 'Solomon Islands'], ['VU', 'Vanuatu'],
      ['PG', 'Papua New Guinea'], ['FJ', 'Fiji'], ['NZ', 'New Zealand'], ['AU', 'Australia']],
  },
};
const IDS = Object.keys(CONTINENTS);

// Board badges the native apps route somewhere other than the folded map.
// mapGlyph() on iOS and Android — the copies already on people's phones
// included — turns 🌍 into Mr. Worldwide's plane and 🌐 into Classic's
// globe, so a continent wearing either would borrow another board's badge.
const TAKEN_BADGES = new Set(['🌐', '🌍', '☠', '⚡', '🍀', '🎲']);
const SET_SIZES = [2, 3, 3, 3, 3, 3, 3, 2];

// The regions of the all-India board share this flat GROUPS object. A new
// country keyed onto one of these would rename and repaint that region on
// Bharat without a single error, so they are pinned here too.
const INDIAN_REGIONS = {
  RJ: 'Rajasthan', UP: 'Uttar Pradesh', MH: 'Maharashtra', GJ: 'Gujarat',
  EA: 'East India', KA: 'Karnataka', TN: 'Tamil Nadu', ME: 'Metro',
};

// The utility marks every client has a drawing for (UTILITY_ART on the web,
// utilityGlyph on iOS and Android). Anything else reaches a player as emoji.
const DRAWN_UTILITIES = new Set(['⚡', '🚰', '💧', '🛢', '☀', '🌬']);

const plain = (s) => String(s || '').replace(/️/g, '');

/** A country's flag emoji from its ISO code: two regional-indicator letters. */
const flagOf = (key) => [...(key === 'UK' ? 'GB' : key)]
  .map((c) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');

// ------------------------------------------------------ telling colours apart --
// CIEDE2000: the distance a person perceives, not the distance in RGB. Two
// sets on one board need to be told apart across a table at a glance. The
// country boards all sit above 12; ten is the line here because Asia has to
// carry China and Japan together, whose colours were set long ago for other
// boards and sit at 10.3 — close, and already side by side on Mr. Worldwide.
const MIN_DELTA_E = 10;

function lab(hex) {
  const h = hex.replace('#', '');
  const lin = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const X = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047;
  const Y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
  const Z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

function deltaE2000(hexA, hexB) {
  const [L1, a1, b1] = lab(hexA);
  const [L2, a2, b2] = lab(hexB);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hue = (x, y) => { const h = Math.atan2(y, x) / rad; return h < 0 ? h + 360 : h; };
  const h1 = hue(ap1, b1);
  const h2 = hue(ap2, b2);
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = h2 - h1;
  if (Cp1 * Cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
  const Lbar = (L1 + L2) / 2;
  const Cpbar = (Cp1 + Cp2) / 2;
  let hbar = h1 + h2;
  if (Cp1 * Cp2 !== 0) {
    hbar = Math.abs(h1 - h2) > 180 ? (h1 + h2 + 360) / 2 : (h1 + h2) / 2;
    if (hbar >= 360) hbar -= 360;
  }
  const T = 1 - 0.17 * Math.cos((hbar - 30) * rad) + 0.24 * Math.cos(2 * hbar * rad)
    + 0.32 * Math.cos((3 * hbar + 6) * rad) - 0.2 * Math.cos((4 * hbar - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cpbar ** 7 / (Cpbar ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const SC = 1 + 0.045 * Cpbar;
  const SH = 1 + 0.015 * Cpbar * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

// ------------------------------------------------------------ the flag art --
// Read icons.js as text and pull the two tables out of it. The file keeps
// them private, and the flag artists are adding to them in parallel, so the
// test neither asks them to export anything nor trusts a regex alone: the
// text is evaluated as its own module with one export appended, which reads
// the keys exactly however they are written. A file mid-edit that will not
// evaluate falls back to reading the keys off the page.
const ICONS = path.join(ROOT, 'public', 'js', 'icons.js');

function keysByReading(source, table) {
  const start = source.indexOf(`const ${table} = {`);
  if (start < 0) return new Set();
  const end = source.indexOf('\n};', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const keys = new Set();
  for (const m of body.matchAll(/^\s*(['"])((?:\\u\{[0-9A-Fa-f]+\}|\\u[0-9A-Fa-f]{4}|[^'"\\\n])+)\1\s*:/gm)) {
    const key = m[2]
      .replace(/\\u\{([0-9A-Fa-f]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    keys.add(plain(key));
  }
  return keys;
}

async function flagTables() {
  const source = fs.readFileSync(ICONS, 'utf8');
  try {
    const probe = `${source}\nexport const __TABLES__ = { FLAG_ART, CIRCLE_FLAG_ART };\n`;
    const mod = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(probe)}`);
    const keys = (t) => new Set(Object.keys(t || {}).map(plain));
    return { how: 'evaluated', rect: keys(mod.__TABLES__.FLAG_ART), coin: keys(mod.__TABLES__.CIRCLE_FLAG_ART) };
  } catch (err) {
    return {
      how: `read as text (${String(err?.message || err).split('\n')[0]})`,
      rect: keysByReading(source, 'FLAG_ART'),
      coin: keysByReading(source, 'CIRCLE_FLAG_ART'),
    };
  }
}

// ================================================================ the run ==
const classic = MAPS.classic;
const classicShape = classic.tiles.map((t) => (t.type === 'tax' ? `tax:${t.name}` : t.type));
const classicPrices = classic.tiles.filter((t) => t.type === 'property').map((t) => t.price);

for (const id of IDS) {
  const want = CONTINENTS[id];
  section(`${want.name} (${id})`);

  const map = MAPS[id];
  if (!PASS(!!map && map.id === id, 'builds, under its own id')) continue;
  PASS(getMap(id) === map, 'getMap hands back this board, not the Classic fallback');
  PASS(map.name === want.name, `named "${want.name}"`, map.name);
  PASS(plain(map.icon) === plain(want.icon), `icon ${want.icon}`, map.icon);
  PASS(!TAKEN_BADGES.has(plain(map.icon)), 'a badge no client draws as another board\'s', map.icon);
  PASS(typeof map.description === 'string' && map.description.length > 10 && map.description.length <= 80,
    'a short description', map.description);

  // Shape: the classic board to the tile.
  PASS(map.size === 40 && map.tiles.length === 40, '40 tiles', String(map.size));
  const shape = map.tiles.map((t) => (t.type === 'tax' ? `tax:${t.name}` : t.type));
  const off = shape.map((s, i) => (s === classicShape[i] ? null : `${i}:${s}≠${classicShape[i]}`)).filter(Boolean);
  PASS(off.length === 0, 'every tile type where the classic board has it', off.join(' '));
  PASS(JSON.stringify(map.layout) === JSON.stringify(classic.layout), 'the same corners and sides as Classic');

  const streets = map.tiles.filter((t) => t.type === 'property');
  const airports = map.tiles.filter((t) => t.type === 'airport');
  const utilities = map.tiles.filter((t) => t.type === 'utility');
  PASS(streets.length === 22, '22 streets', String(streets.length));
  PASS(airports.length === 4 && map.airportCount === 4, 'four airports', String(airports.length));
  PASS(utilities.length === 2 && map.utilityCount === 2, 'two utilities', String(utilities.length));

  // Sets, in board order, and each one contiguous.
  const runs = [];
  for (const s of streets) {
    if (runs.at(-1)?.key === s.group) runs.at(-1).n++;
    else runs.push({ key: s.group, n: 1 });
  }
  PASS(JSON.stringify(runs.map((r) => r.n)) === JSON.stringify(SET_SIZES),
    'sets of 2,3,3,3,3,3,3,2, each one unbroken', runs.map((r) => `${r.key}×${r.n}`).join(' '));
  const wantKeys = want.sets.map(([k]) => k);
  PASS(JSON.stringify(runs.map((r) => r.key)) === JSON.stringify(wantKeys),
    'the brief\'s countries, in the brief\'s order, cheapest first', runs.map((r) => r.key).join(' '));
  const strangers = Object.keys(map.groups).filter((g) => !wantKeys.includes(g));
  PASS(strangers.length === 0, `every set is a country of ${want.name}`, strangers.join(' '));

  // The group records themselves: right country, right flag, a real colour.
  for (const [key, country] of want.sets) {
    const g = GROUPS[key];
    const ok = !!g && g.name === country && plain(g.flag) === flagOf(key) && /^#[0-9a-f]{6}$/i.test(g.color || '');
    PASS(ok, `${key} is ${country} ${flagOf(key)}`, g ? `${g.name} ${g.flag} ${g.color}` : 'missing from GROUPS');
  }

  // Prices: the classic ladder exactly, never falling.
  const prices = streets.map((t) => t.price);
  PASS(JSON.stringify(prices) === JSON.stringify(classicPrices), 'the classic price ladder', prices.join(','));
  PASS(prices.every((v, i) => i === 0 || v >= prices[i - 1]), 'prices never fall around the board');
  const lastOfSet = runs.reduce((acc, r) => { acc.push((acc.at(-1) ?? -1) + r.n); return acc; }, []);
  PASS(lastOfSet.every((i) => streets[i].rent[0] === Math.max(...map.groups[streets[i].group].map((j) => map.tiles[j].rent[0]))),
    'the last street of each set carries its top rent');

  // Names: real-looking, unique on the board, airports as the file writes them.
  const names = streets.map((t) => t.name);
  PASS(new Set(names).size === names.length, 'no city twice on one board');
  PASS(names.every((n) => n.trim() === n && n.length >= 2 && n.length <= 18), 'city names fit a tile',
    names.filter((n) => n.length > 18).join(', '));
  PASS(airports.every((a) => /^[A-Z]{3} Airport$/.test(a.name)) && new Set(airports.map((a) => a.name)).size === 4,
    'four different airports, written "XYZ Airport"', airports.map((a) => a.name).join(', '));
  PASS(utilities.every((u) => DRAWN_UTILITIES.has(plain(u.icon))),
    'utility marks every client can draw', utilities.map((u) => `${u.name} ${u.icon}`).join(', '));

  // Colours: eight sets a player can tell apart.
  let worst = { d: Infinity, pair: '' };
  for (let i = 0; i < wantKeys.length; i++) {
    for (let j = i + 1; j < wantKeys.length; j++) {
      const a = GROUPS[wantKeys[i]]?.color;
      const b = GROUPS[wantKeys[j]]?.color;
      if (!a || !b) continue;
      const d = deltaE2000(a, b);
      if (d < worst.d) worst = { d, pair: `${wantKeys[i]}/${wantKeys[j]}` };
    }
  }
  PASS(worst.d >= MIN_DELTA_E, `the eight colours are pairwise distinct (ΔE2000 ≥ ${MIN_DELTA_E})`,
    `closest ${worst.pair} at ${worst.d.toFixed(1)}`);

  // Cards: no country board deck of its own, so the templates fill the piles
  // from this board's streets — and a placeholder they could not fill would
  // show up on a card as a literal {street}.
  const decks = buildDecks(map);
  const loose = [...decks.treasure, ...decks.surprise].filter((c) => /\{\w+\}/.test(c.text));
  PASS(decks.treasure.length >= 20 && decks.surprise.length >= 20 && loose.length === 0,
    'Treasure and Surprise decks build with every blank filled',
    `${decks.treasure.length}/${decks.surprise.length}${loose.length ? ` · ${loose[0].text}` : ''}`);
}

// ------------------------------------------------------------- the keys --
section('Group keys');
const everyKey = IDS.flatMap((id) => CONTINENTS[id].sets.map(([k]) => k));
PASS(new Set(everyKey).size === everyKey.length, 'no country is on two continents', String(everyKey.length));
const regionsIntact = Object.entries(INDIAN_REGIONS).filter(([k, n]) => GROUPS[k]?.name !== n);
PASS(regionsIntact.length === 0, 'the Indian regions still own RJ UP MH GJ EA KA TN ME',
  regionsIntact.map(([k]) => `${k}=${GROUPS[k]?.name}`).join(' '));
PASS(everyKey.every((k) => /^[A-Z]{2}$/.test(k)), 'every key is two capitals, never a namespaced region');

// ---------------------------------------------------------- the flag art --
section('Drawn flags in public/js/icons.js');
const art = await flagTables();
console.log(`        (tables ${art.how})`);
for (const id of IDS) {
  const flags = CONTINENTS[id].sets.map(([k]) => [k, plain(GROUPS[k]?.flag)]);
  const noRect = flags.filter(([, f]) => !art.rect.has(f)).map(([k]) => k);
  const noCoin = flags.filter(([, f]) => !art.coin.has(f)).map(([k]) => k);
  PASS(noRect.length === 0, `${CONTINENTS[id].name}: every flag in FLAG_ART`, noRect.length ? `missing ${noRect.join(' ')}` : '');
  PASS(noCoin.length === 0, `${CONTINENTS[id].name}: every flag in CIRCLE_FLAG_ART`, noCoin.length ? `missing ${noCoin.join(' ')}` : '');
}

// -------------------------------------------------------------- the shop --
section('The shelf');
const shelf = BOARD_ITEMS.map((i) => i.mapId);
// The shelf prices a board by what it is. A continent is Bharat's shape with
// no deck of its own, so it is Bharat's price — until somebody writes it a
// deck, at which point this should fail and the price should move with it.
const BHARAT_PRICE = priceOf('bharat');
for (const id of IDS) {
  const item = BOARD_ITEMS.find((i) => i.mapId === id);
  PASS(!!item && item.id === boardItemId(id) && item.kind === 'board' && item.price === BHARAT_PRICE
    && item.name === CONTINENTS[id].name,
  `${CONTINENTS[id].name} is sold at ${BHARAT_PRICE}`, item ? `${item.id} ${item.price}` : 'not on the shelf');
  PASS(STORE_ITEMS.some((i) => i.id === boardItemId(id)), `${CONTINENTS[id].name} is in the store catalogue`);
  PASS(isBoardForSale(id) && priceOf(id) === BHARAT_PRICE && !MAPS[id].deck,
    `${CONTINENTS[id].name} is for sale at Bharat's price, and like Bharat has no deck of its own`);
}
PASS(BHARAT_PRICE < priceOf('country-jp'), 'which is under the country price',
  `${BHARAT_PRICE} vs ${priceOf('country-jp')}`);
const kind = (id) => (id === 'random' ? 'random'
  : id.startsWith('continent-') ? 'continent'
    : id.startsWith('country-') ? 'country' : 'house');
const order = shelf.map(kind);
const firstOf = (k) => order.indexOf(k);
const lastOf = (k) => order.lastIndexOf(k);
PASS(lastOf('house') < firstOf('continent') && lastOf('continent') < firstOf('country')
  && order.at(-1) === 'random',
'shelved house specials → continents → countries → Random', order.join(' '));
PASS(order.filter((k) => k === 'continent').length === 6
  && order.slice(firstOf('continent'), lastOf('continent') + 1).every((k) => k === 'continent'),
'the six continents stand together');
PASS(!shelf.includes('classic'), 'Classic is still not for sale');
const listed = new Set(mapList().map((m) => m.id));
PASS(IDS.every((id) => listed.has(id)), 'every continent is in the map list the clients read');

// ---------------------------------------------------------- the rotation --
section('The free pair');
PASS(CYCLE_DAYS === Math.ceil(shelf.length / FREE_PER_DAY),
  'a pass is counted off the shelf, not written down', `${shelf.length} boards, ${CYCLE_DAYS} days`);
PASS(boardAccess([]).cycleDays === CYCLE_DAYS, 'and /api/boards reports that same number', String(boardAccess([]).cycleDays));

// The day number `dayNumber` would give a local noon, read back the other way.
const atDay = (D) => {
  const u = new Date(D * 86_400_000);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 12).getTime();
};
const today = dayNumber();
PASS(dayNumber(atDay(today)) === today, 'the test\'s calendar agrees with the shelf\'s');

const firstPass = Math.ceil(today / CYCLE_DAYS) * CYCLE_DAYS;
for (let pass = 0; pass < 3; pass++) {
  const seen = new Map();
  let saleOk = true;
  for (let d = 0; d < CYCLE_DAYS; d++) {
    const when = atDay(firstPass + pass * CYCLE_DAYS + d);
    const free = freeBoardsOn(when);
    const sale = saleBoardsOn(when);
    for (const id of free) seen.set(id, (seen.get(id) || 0) + 1);
    if (sale.length !== Math.min(SALE_PER_DAY, shelf.length - FREE_PER_DAY)
      || sale.some((id) => free.includes(id) || !shelf.includes(id))) saleOk = false;
  }
  const never = shelf.filter((id) => !seen.has(id));
  const twice = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  PASS(never.length === 0, `pass ${pass + 1}: every board is free on some day`, never.join(' '));
  PASS(shelf.length % FREE_PER_DAY !== 0 || twice.length === 0,
    `pass ${pass + 1}: and none of them twice`, twice.join(' '));
  PASS(saleOk, `pass ${pass + 1}: ${SALE_PER_DAY} on sale daily, never one that is already free`);
}
const daysOfPass = Array.from({ length: CYCLE_DAYS }, (_, d) => atDay(firstPass + d));
PASS(IDS.every((id) => daysOfPass.some((when) => freeBoardsOn(when).includes(id) && mayUseBoard(id, [], when))),
  'on its free day a continent is playable with an empty wallet');
PASS(IDS.every((id) => daysOfPass.every((when) => freeBoardsOn(when).includes(id) || !mayUseBoard(id, [], when))),
  'on every other day it is locked to an empty wallet');
PASS(IDS.every((id) => daysOfPass.every((when) => mayUseBoard(id, [boardItemId(id)], when))),
  'and once owned, it is playable every day');

// ----------------------------------------------------------------- done --
console.log(`\n${failed ? '  FAIL' : '  PASS'} — ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
