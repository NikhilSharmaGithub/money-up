// "Did you know?" — one short fact under a street's card, and one under its
// country's.
//
// The facts are content, not code: server/facts.json, written and checked by
// hand, keyed "<tile name>|<group code>" for a street and by group code for a
// country or region. The same city can sit in more than one set (Jaipur is RJ
// on Bharat and IN_RJ on the India board) and each has its own key, so a fact
// can be written for the board it appears on.
//
// Read once at boot and answered from memory: the file only changes with a
// deploy, so there is nothing to watch. The body is serialised once too, and
// a hash of it is both the `version` inside it and the ETag on it — a phone
// that cached version X asks with If-None-Match: "X" and gets a 304 until a
// deploy changes a word.
//
// The random board deals from CITY_POOL, and several of its cities only have
// a fact under a country board's regional key: Kolkata is EA on Bharat and
// IN_EC on the India board, but plain IN on a random board. A fact is about
// the place, not the colour it is painted, so a pool city with no fact of its
// own reads the same city's from the same country. Never across countries —
// two places can share a name.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPS, CITY_POOL } from './maps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FACTS_FILE = path.join(__dirname, 'facts.json');

// The country a colour set is in. Country boards namespace their regions
// (IN_RJ, CN_PRD), the all-India board's are bare (RJ, TN), and the United
// Kingdom is GB on its own board but UK on every other.
const INDIA_REGIONS = new Set(Object.keys(MAPS.bharat?.groups || {}));
const countryOf = (group) => {
  const c = INDIA_REGIONS.has(group) ? 'IN' : group.split('_')[0];
  return c === 'GB' ? 'UK' : c;
};

/**
 * The payload from the file's parsed contents. Pure, so a test can build one
 * from an edited copy and watch the version move.
 */
export function buildFacts(raw) {
  const places = { ...(raw?.places || {}) };
  const groups = { ...(raw?.groups || {}) };
  // Sorted, so when a city has facts under two regional keys the one a pool
  // city borrows is the same on every boot (and so is the version).
  const own = Object.keys(places).sort();
  for (const [country, cities] of Object.entries(CITY_POOL)) {
    for (const name of cities) {
      const key = `${name}|${country}`;
      if (places[key]) continue;
      const twin = own.find((k) => {
        const bar = k.lastIndexOf('|');
        return k.slice(0, bar) === name && countryOf(k.slice(bar + 1)) === country;
      });
      if (twin) places[key] = places[twin];
    }
  }
  const version = crypto.createHash('sha256')
    .update(JSON.stringify({ places, groups }))
    .digest('hex')
    .slice(0, 16);
  return {
    version,
    etag: `"${version}"`,
    body: JSON.stringify({ version, places, groups }),
    places,
    groups,
  };
}

function load() {
  try {
    return buildFacts(JSON.parse(fs.readFileSync(FACTS_FILE, 'utf8')));
  } catch (err) {
    // A broken facts file costs the cards their footnote, not the server its
    // games: say so loudly and serve none until a deploy fixes it.
    console.error(`[facts] could not read ${FACTS_FILE}: ${err.message}`);
    return buildFacts({});
  }
}

export const FACTS = load();
