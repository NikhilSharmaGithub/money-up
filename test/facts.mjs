// 1.0.7 — the place facts: one checked "Did you know?" line per street and
// one per country or region, served at GET /api/facts.
//
// Facts are content, and the way content goes wrong is by not being there: a
// new board ships, a street is renamed, the random board's pool gains a city,
// and a card quietly loses its footnote on every phone. So this checks the
// file against everything the server can actually put on a table:
//
//   · every street on every stock board (house boards, Bharat, the six
//     continents, every country edition) has a fact under its exact
//     "<name>|<group>" key, and every set on them a fact under its code
//   · the same holds on shuffled boards and on random boards — every city the
//     generator can deal, not just the ones a few deals happened to
//   · every fact is 40–170 characters, has no emoji, and belongs to a street
//     or set some board deals (a fact nobody can reach is a renamed street)
//   · the version is a hash of the content: the same file, the same version;
//     one word changed, a new one
//   · the endpoint answers { version, places, groups } with a day's cache and
//     a strong ETag, the facts word for word, and a 304 to If-None-Match
//
//   node test/facts.mjs
//
// One server is started for the last part, on a free port with its data in a
// temporary directory; both are gone afterwards, pass or fail.

import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { MAPS, GROUPS, CITY_POOL, generateRandomMap, shuffleMap } from '../server/maps.js';
import { FACTS, FACTS_FILE, buildFacts } from '../server/facts.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const started = Date.now();

let failed = 0;
let passed = 0;
const PASS = (ok, label, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  return ok;
};
const section = (t) => console.log(`\n── ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000, step = 25) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(step);
  }
}
const list = (a, n = 12) => (a.length > n ? `${a.slice(0, n).join(', ')} … (${a.length})` : a.join(', '));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-facts-'));

// The rules for a line that has to fit under a card on a phone. Lengths are
// counted in code points, so "São Paulo" is nine, as a reader would count it.
const MIN = 40;
const MAX = 170;
// Pictographs, flag halves, the emoji variation selector and the keycap mark:
// the facts are plain text, and the board already draws its own flags.
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}|\u{20E3}/u;

const RAW = JSON.parse(fs.readFileSync(FACTS_FILE, 'utf8'));
const streets = (map) => map.tiles.filter((t) => t.type === 'property');
const keyOf = (t) => `${t.name}|${t.group}`;

// ================================================================ the file ==

function theFile() {
  section('the file');
  PASS(RAW && typeof RAW.places === 'object' && typeof RAW.groups === 'object',
    'server/facts.json parses, with a "places" and a "groups" table');
  const all = [
    ...Object.entries(RAW.places).map(([k, v]) => [`places["${k}"]`, v]),
    ...Object.entries(RAW.groups).map(([k, v]) => [`groups["${k}"]`, v]),
  ];
  const notText = all.filter(([, v]) => typeof v !== 'string').map(([k]) => k);
  PASS(!notText.length, `all ${all.length} facts are text`, list(notText));
  const size = all.filter(([, v]) => typeof v === 'string')
    .map(([k, v]) => [k, [...v].length])
    .filter(([, n]) => n < MIN || n > MAX);
  PASS(!size.length, `every one is ${MIN}–${MAX} characters`, list(size.map(([k, n]) => `${k} is ${n}`)));
  const emoji = all.filter(([, v]) => EMOJI.test(String(v))).map(([k]) => k);
  PASS(!emoji.length, 'none has an emoji in it', list(emoji));
  const padded = all.filter(([, v]) => String(v) !== String(v).trim()).map(([k]) => k);
  PASS(!padded.length, 'none starts or ends with a space', list(padded));
}

// ============================================================== the boards ==

function theBoards() {
  section('every stock board — exact keys in the file');
  for (const [id, map] of Object.entries(MAPS)) {
    const ss = streets(map);
    const sets = Object.keys(map.groups);
    const noPlace = ss.map(keyOf).filter((k) => !RAW.places[k]);
    const noGroup = sets.filter((g) => !RAW.groups[g]);
    PASS(ss.length > 0 && !noPlace.length && !noGroup.length,
      `${map.name} (${id}): ${ss.length} streets, ${sets.length} sets — a fact for each`,
      [noPlace.length && `no fact for ${list(noPlace)}`, noGroup.length && `no set fact for ${list(noGroup)}`]
        .filter(Boolean).join('; '));
  }

  section('shuffled boards');
  // A shuffle only moves deeds between slots, so the facts follow the deed;
  // this is here so a shuffle that ever rebuilt a tile would be noticed.
  const SEEDS = [1, 7, 2026];
  let dealt = 0;
  const lost = [];
  for (const map of Object.values(MAPS)) {
    for (const seed of SEEDS) {
      const m = shuffleMap(map, seed);
      if (m.shuffled) dealt++;
      for (const t of streets(m)) if (!FACTS.places[keyOf(t)] || !FACTS.groups[t.group]) lost.push(`${m.uid} ${keyOf(t)}`);
    }
  }
  PASS(dealt === Object.keys(MAPS).length * SEEDS.length && !lost.length,
    `${dealt} shuffled boards (every board, seeds ${SEEDS.join(', ')}) — every street keeps its fact`, list(lost));

  section('random boards');
  // The whole pool, not a sample: a random board is a fresh deal every game,
  // so any city in it will be on somebody's table sooner or later. Checked
  // against what is served, since a pool city may read the same city's fact
  // from a country board (facts.js says why).
  const pool = Object.entries(CITY_POOL).flatMap(([g, cities]) => cities.map((name) => `${name}|${g}`));
  const poolMissing = pool.filter((k) => !FACTS.places[k]);
  PASS(!poolMissing.length, `every one of the ${pool.length} cities the random board can deal has a fact`,
    poolMissing.length ? `no fact for ${list(poolMissing, 20)}` : '');
  const poolSets = Object.keys(CITY_POOL).filter((g) => !FACTS.groups[g]);
  PASS(!poolSets.length, `…and each of its ${Object.keys(CITY_POOL).length} countries a set fact`, list(poolSets));

  // And a few real deals, seeded so a failure names the same board every run:
  // the generator really does deal from that pool, under those keys.
  const realRandom = Math.random;
  const off = [];
  let n = 0;
  try {
    for (let seed = 1; seed <= 12; seed++) {
      let a = seed;
      Math.random = () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const m = generateRandomMap();
      n += streets(m).length;
      for (const t of streets(m)) {
        if (!FACTS.places[keyOf(t)]) off.push(`seed ${seed} ${keyOf(t)}`);
        if (!FACTS.groups[t.group]) off.push(`seed ${seed} set ${t.group}`);
      }
    }
  } finally {
    Math.random = realRandom;
  }
  PASS(!off.length, `12 seeded random boards, ${n} streets — a fact for each, and for each set`, list(off));

  section('nothing left over');
  // A fact no board can reach is almost always a street renamed on its board
  // but not in the file — the new name then shows nothing.
  const reachable = new Set([...Object.values(MAPS).flatMap((m) => streets(m).map(keyOf)), ...pool]);
  const sets = new Set([...Object.values(MAPS).flatMap((m) => Object.keys(m.groups)), ...Object.keys(CITY_POOL)]);
  const strayPlaces = Object.keys(RAW.places).filter((k) => !reachable.has(k));
  const strayGroups = Object.keys(RAW.groups).filter((g) => !sets.has(g));
  PASS(!strayPlaces.length, `all ${Object.keys(RAW.places).length} street facts belong to a street some board deals`, list(strayPlaces));
  PASS(!strayGroups.length && Object.keys(RAW.groups).every((g) => GROUPS[g]),
    `all ${Object.keys(RAW.groups).length} set facts belong to a set some board deals`, list(strayGroups));
}

// ============================================================= the payload ==

function thePayload() {
  section('what is served, and its version');
  // Word for word: the server may add a borrowed key, never change a line.
  const changed = Object.entries(RAW.places).filter(([k, v]) => FACTS.places[k] !== v).map(([k]) => k);
  PASS(!changed.length && isDeepStrictEqual(FACTS.groups, RAW.groups),
    'every fact in the file is served exactly as written', list(changed));
  const own = new Set(Object.values(RAW.places));
  const borrowed = Object.keys(FACTS.places).filter((k) => !Object.hasOwn(RAW.places, k));
  const badBorrow = borrowed.filter((k) => {
    const name = k.slice(0, k.lastIndexOf('|'));
    return !own.has(FACTS.places[k])
      || !Object.entries(RAW.places).some(([rk, v]) => v === FACTS.places[k] && rk.startsWith(`${name}|`));
  });
  PASS(!badBorrow.length, `the ${borrowed.length} random-board cities that borrow, borrow the same city's own fact`,
    list(badBorrow) || list(borrowed));

  const again = buildFacts(JSON.parse(fs.readFileSync(FACTS_FILE, 'utf8')));
  PASS(again.version === FACTS.version && again.body === FACTS.body && /^[0-9a-f]{16}$/.test(FACTS.version),
    `the same file builds the same version (${FACTS.version})`);
  const [firstKey] = Object.keys(RAW.places);
  const edited = buildFacts({ ...RAW, places: { ...RAW.places, [firstKey]: `${RAW.places[firstKey]} ` } });
  const regrouped = buildFacts({ ...RAW, groups: { ...RAW.groups, ZZ: 'x'.repeat(50) } });
  PASS(edited.version !== FACTS.version && regrouped.version !== FACTS.version,
    'one character changed, or one fact added, and the version moves');
  PASS(FACTS.etag === `"${FACTS.version}"`, 'the ETag is the version, as a strong tag');
}

// ============================================================ over the wire ==

const children = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startServer(dir, attempt = 1) {
  const port = await freePort();
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(APPLE_|GOOGLE_|APNS_|STRIPE_|FCM_|PLAY_)/.test(k)) delete env[k];
  }
  delete env.RENDER;
  delete env.NODE_ENV;
  delete env.MONEYMOVE_TEST_HOOKS;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...env, PORT: String(port), DATA_DIR: dir, ADMIN_KEY: `admin-${crypto.randomBytes(4).toString('hex')}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const srv = { url: `http://127.0.0.1:${port}`, child, log: '' };
  child.stdout.on('data', (d) => { srv.log += d; });
  child.stderr.on('data', (d) => { srv.log += d; });
  children.push(child);
  const up = await until(async () => {
    if (child.exitCode != null) return true;
    try { return (await fetch(`${srv.url}/healthz`)).ok; } catch { return false; }
  }, 20000, 100);
  if (!up || child.exitCode != null) {
    if (/EADDRINUSE/.test(srv.log) && attempt < 4) return startServer(dir, attempt + 1);
    throw new Error(`the server did not start:\n${srv.log}`);
  }
  return srv;
}

function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 3000).unref();
  });
}

async function overTheWire() {
  section('GET /api/facts');
  const dir = path.join(tmpRoot, 'srv');
  fs.mkdirSync(dir, { recursive: true });
  const srv = await startServer(dir);
  const url = `${srv.url}/api/facts`;

  const res = await fetch(url);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* checked below */ }
  const etag = res.headers.get('etag');
  const cc = res.headers.get('cache-control') || '';
  PASS(res.status === 200 && /^application\/json/.test(res.headers.get('content-type') || ''),
    '200, as JSON', `${res.status} ${res.headers.get('content-type')}`);
  PASS(isDeepStrictEqual(Object.keys(body || {}), ['version', 'places', 'groups'])
    && typeof body.version === 'string'
    && Object.values(body.places).every((v) => typeof v === 'string')
    && Object.values(body.groups).every((v) => typeof v === 'string'),
  'the shape is { version, places: { "<name>|<group>": text }, groups: { "<code>": text } }', Object.keys(body || {}).join(', '));
  PASS(body && isDeepStrictEqual(body.places, FACTS.places) && isDeepStrictEqual(body.groups, RAW.groups),
    `all ${Object.keys(body?.places || {}).length} street facts and ${Object.keys(body?.groups || {}).length} set facts, word for word`);
  PASS(/\bpublic\b/.test(cc) && Number(cc.match(/max-age=(\d+)/)?.[1]) >= 86400,
    'cached for a day, publicly', cc);
  PASS(etag === `"${body?.version}"` && body?.version === FACTS.version,
    'a strong ETag, and it is the version in the body', `${etag} / ${body?.version}`);
  PASS(res.headers.get('access-control-allow-origin') === '*', 'readable cross-origin, like the rest of /api');

  // fetch() adds Cache-Control: no-cache to any request with an If-None-Match
  // of its own, in Node as in a browser — so these are asked the way the web
  // client will ask, and the bare request below the way a phone's will.
  const ask = (inm) => fetch(url, { headers: { 'If-None-Match': inm } });
  const same = await ask(etag);
  const sameText = await same.text();
  PASS(same.status === 304 && sameText === '' && same.headers.get('etag') === etag
    && same.headers.get('cache-control') === cc,
  'If-None-Match with that tag, from fetch(): 304, no body, the same ETag and cache', `${same.status}, ${sameText.length} bytes`);
  const bare = await new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { 'If-None-Match': etag } }, (r) => {
      let n = 0;
      r.on('data', (d) => { n += d.length; });
      r.on('end', () => resolve({ status: r.statusCode, bytes: n }));
    });
    req.on('error', reject);
  });
  PASS(bare.status === 304 && bare.bytes === 0, '…and from a bare request with nothing else on it', `${bare.status}, ${bare.bytes} bytes`);
  const weak = await ask(`W/${etag}`);
  await weak.text();
  const among = await ask(`"stale-one", ${etag}`);
  await among.text();
  PASS(weak.status === 304 && among.status === 304, '…also as a weak tag, or one of a list', `${weak.status}, ${among.status}`);
  const old = await ask('"0000000000000000"');
  const oldBody = await old.json().catch(() => null);
  PASS(old.status === 200 && oldBody?.version === FACTS.version, 'an old tag gets the whole set again', String(old.status));
}

let crashed = null;
try {
  theFile();
  theBoards();
  thePayload();
  await overTheWire();
} catch (err) {
  crashed = err;
  failed++;
  console.log(`\n  FAIL  the test itself crashed — ${err?.stack || err}`);
} finally {
  await Promise.all(children.map(stop));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`\n${failed ? 'FAILED' : 'OK'} — ${passed} passed, ${failed} failed (${((Date.now() - started) / 1000).toFixed(1)}s)`);
process.exit(failed || crashed ? 1 : 0);
