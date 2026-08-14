// Headless rules test. Drives bot-only games synchronously (no timers) so a
// few hundred games run in seconds, checking invariants after every action.
// Run with `npm test`.

import { GameRoom } from '../server/game.js';
import { MAPS } from '../server/maps.js';

let failures = 0;
const seen = new Set();
const fail = (msg) => {
  failures++;
  if (!seen.has(msg)) { seen.add(msg); console.error('  ✗', msg); }
};
const ok = (msg) => console.log('  ✓', msg);

function checkInvariants(room, where) {
  for (const p of room.players) {
    if (p.money < 0) fail(`${where}: ${p.name} has negative cash (${p.money})`);
    if (!Number.isFinite(p.money)) fail(`${where}: ${p.name} has non-numeric cash`);
    if (p.pos < 0 || p.pos >= room.map.size) fail(`${where}: ${p.name} is off the board (${p.pos})`);
    if (p.bankrupt && room.tilesOf(p.id).length) fail(`${where}: bankrupt ${p.name} still owns property`);
  }
  for (const [key, o] of Object.entries(room.ownership)) {
    const i = Number(key);
    const tile = room.tile(i);
    const owner = room.player(o.owner);
    if (!owner) { fail(`${where}: tile ${i} owned by a ghost`); continue; }
    if (owner.bankrupt) fail(`${where}: ${tile.name} owned by bankrupt ${owner.name}`);
    if (o.houses > 5) fail(`${where}: ${tile.name} has ${o.houses} houses`);
    if (o.houses > 0 && o.mortgaged) fail(`${where}: ${tile.name} is mortgaged with buildings`);
    if (o.houses > 0) {
      if (tile.type !== 'property') fail(`${where}: buildings on a ${tile.type}`);
      else if (!room.ownsFullGroup(o.owner, tile.group)) fail(`${where}: buildings on ${tile.name} without the full set`);
      else if (room.settings.evenBuild) {
        const group = room.map.groups[tile.group];
        const spread = Math.max(...group.map((g) => room.own(g).houses || 0)) - Math.min(...group.map((g) => room.own(g).houses || 0));
        if (spread > 1) fail(`${where}: uneven build in ${tile.group} (spread ${spread})`);
      }
    }
  }
  const phase = room.turn?.phase;
  if (room.status === 'playing' && !['roll', 'action', 'auction', 'debt', 'end'].includes(phase)) {
    fail(`${where}: unknown phase "${phase}"`);
  }
}

/** Runs one bot game with the timer-driven bot loop replaced by direct calls. */
function playGame(mapId, settings = {}, maxSteps = 4000) {
  const room = new GameRoom('test', () => {});
  room.scheduleBot = () => {};
  room.maybeBot = () => {};
  room.maybeBotAuction = () => {};
  room.armAuctionTimer = () => {};
  const pendingTrades = [];
  room.scheduleBotTrade = (tradeId) => pendingTrades.push(tradeId);
  room.settings = { ...room.settings, ...settings, mapId };
  room.map = MAPS[mapId];

  let turns = 0;
  const say = room.say.bind(room);
  room.say = (text, kind) => { if (kind === 'turn') turns++; say(text, kind); };

  for (let i = 0; i < (settings.players || 4); i++) room.addBot();
  room.hostId = room.players[0].id;
  const started = room.start(room.hostId);
  if (started?.error) fail(`${mapId}: could not start (${started.error})`);

  let steps = 0;
  while (room.status === 'playing' && steps++ < maxSteps) {
    try {
      room.runBot();
      if (room.auction) room.runBotAuction();
      while (pendingTrades.length) room.botTradeReply(pendingTrades.shift());
    } catch (e) {
      fail(`${mapId}: crash — ${e.message}\n${e.stack.split('\n')[1]?.trim()}`);
      break;
    }
    if (steps % 25 === 0) checkInvariants(room, mapId);
  }
  checkInvariants(room, `${mapId}(final)`);
  room.dispose();
  return { room, turns, steps };
}

// ---------------------------------------------------------------------------
console.log('\n▶ map integrity');
for (const [id, map] of Object.entries(MAPS)) {
  const props = map.tiles.filter((t) => t.type === 'property');
  const bad = props.filter((t) => !Array.isArray(t.rent) || t.rent.length !== 6 || !t.houseCost);
  if (bad.length) fail(`${id}: ${bad.length} properties missing rent data`);
  if (map.layout.corners.length !== 4) fail(`${id}: wrong corner count`);
  for (const type of ['start', 'prison', 'vacation', 'gotoprison']) {
    if (map.tiles.filter((t) => t.type === type).length !== 1) fail(`${id}: needs exactly one ${type}`);
  }
  const covered = map.layout.top.length + map.layout.right.length + map.layout.bottom.length + map.layout.left.length + 4;
  if (covered !== map.size) fail(`${id}: layout covers ${covered} of ${map.size} tiles`);
  if (map.layout.left.length !== map.layout.right.length) fail(`${id}: left/right columns differ`);
  if (map.layout.top.length !== map.layout.bottom.length) fail(`${id}: top/bottom rows differ`);
  for (const [g, idxs] of Object.entries(map.groups)) {
    if (idxs.length < 2) fail(`${id}: group ${g} has a single property`);
  }
  ok(`${id}: ${map.size} tiles, ${props.length} streets, ${map.airportCount} airports, ${map.utilityCount} utilities`);
}

console.log('\n▶ rule variants (every map, twice each)');
const VARIANTS = [
  { label: 'defaults', settings: {} },
  { label: 'x2 rent + vacation pot', settings: { x2rent: true, vacationCash: true } },
  { label: 'no auction, no mortgage', settings: { auction: false, mortgage: false } },
  { label: 'free build order', settings: { evenBuild: false } },
  { label: 'no rent while jailed', settings: { noRentInPrison: true } },
  { label: 'poor start ($500), 6 players', settings: { startingCash: 500, players: 6, maxPlayers: 8 } },
];

const MAP_IDS = Object.keys(MAPS);
const RUNS = MAP_IDS.length * 2; // every map twice per rule variant
for (const v of VARIANTS) {
  let ended = 0, totalTurns = 0;
  for (let i = 0; i < RUNS; i++) {
    const { room, turns } = playGame(MAP_IDS[i % MAP_IDS.length], v.settings);
    if (room.status === 'ended') ended++;
    totalTurns += turns;
  }
  ok(`${v.label}: ${ended}/${RUNS} games reached a winner, ${Math.round(totalTurns / RUNS)} turns avg`);
}

console.log('\n▶ targeted rules');
{
  // Rent doubles on a full set only when the rule is on.
  const room = new GameRoom('r', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  const brazil = room.map.groups.BR;
  brazil.forEach((i) => { room.ownership[i] = { owner: 'a', houses: 0, mortgaged: false }; });
  const base = room.map.tiles[brazil[0]].rent[0];
  room.settings.x2rent = false;
  if (room.rentFor(brazil[0]) !== base) fail(`full-set rent should stay $${base} with the rule off`);
  room.settings.x2rent = true;
  if (room.rentFor(brazil[0]) !== base * 2) fail(`full-set rent should double to $${base * 2}`);
  ok('x2 full-set rent rule');

  // Airports scale 25/50/100/200.
  const airports = room.map.tiles.filter((t) => t.type === 'airport').map((t) => t.index);
  const expect = [25, 50, 100, 200];
  airports.forEach((idx, k) => {
    room.ownership[idx] = { owner: 'a', houses: 0, mortgaged: false };
    if (room.rentFor(airports[0]) !== expect[k]) fail(`airport rent with ${k + 1} owned should be $${expect[k]}`);
  });
  ok('airport rent scaling');

  // Mortgaged property collects nothing.
  room.ownership[brazil[0]].mortgaged = true;
  if (room.rentFor(brazil[0]) !== 0) fail('mortgaged property should collect no rent');
  ok('mortgaged property collects no rent');

  // Even build blocks a second house before the set is level.
  room.ownership[brazil[0]].mortgaged = false;
  room.settings.evenBuild = true;
  room.status = 'playing';
  room.turn = { playerId: 'a', phase: 'end', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: true };
  room.player('a').money = 10000;
  room.build('a', brazil[0]);
  const second = room.build('a', brazil[0]);
  if (!second.error) fail('even build should block a second house on the same street');
  room.build('a', brazil[1]);
  if ((room.own(brazil[0]).houses !== 1) || (room.own(brazil[1]).houses !== 1)) fail('even build should leave 1 house each');
  ok('even build restriction');

  // Bankruptcy hands everything to the creditor.
  room.ownership[brazil[0]].houses = 0;
  room.ownership[brazil[1]].houses = 0;
  room.player('b').money = 10;
  room.bankrupt(room.player('b'), room.player('a'));
  if (!room.player('b').bankrupt) fail('player should be marked bankrupt');
  if (room.status !== 'ended') fail('game should end when one player remains');
  ok('bankruptcy and win detection');
}

{
  // Three doubles send you to prison.
  const room = new GameRoom('d', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a');
  room.roll('a', [2, 2]);
  room.roll('a', [3, 3]);
  room.roll('a', [4, 4]);
  if (!a.jail) fail('three doubles should send the player to prison');
  if (a.pos !== room.cornerIndex('prison')) fail('jailed player should sit on the prison tile');
  ok('three doubles → prison');

  // Paying the fine releases the player.
  a.money = 500;
  room.turn.playerId = 'a';
  room.turn.phase = 'roll';
  room.jailPay('a');
  if (a.jail) fail('paying the fine should release the player');
  if (a.money !== 450) fail(`fine should cost $50, cash is ${a.money}`);
  ok('prison fine');
}

{
  // Passing START pays a salary; landing on it pays twice.
  const room = new GameRoom('s', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a');
  // Land on tile 1 (an unowned street) so no card or tax can muddy the total.
  const landing = 1;
  if (room.tile(landing).type !== 'property') fail('test setup: tile 1 should be a street');
  a.pos = room.map.size - 2;
  const before = a.money;
  room.movePlayer(a, landing + 2); // wraps past START
  if (a.pos !== landing) fail(`expected to land on tile ${landing}, got ${a.pos}`);
  if (a.money !== before + 200) fail(`passing START should pay exactly $200 (got ${a.money - before})`);
  ok('START salary');
}

{
  // A dropped connection holds the seat; only the grace timer hands it to a bot.
  const room = new GameRoom('rc', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a');

  room.removePlayer('a');
  if (a.connected) fail('a dropped connection should mark the player offline');
  if (a.botControlled) fail('a bot must not take over immediately on disconnect');
  if (room.autoPlayed(a)) fail('the seat should still be held right after dropping');
  if (!room.player('a')) fail('the player must keep their seat mid-game');

  room.reconnect('a');
  if (!a.connected || a.botControlled) fail('reconnecting should restore the seat');

  // once the grace period has elapsed the bot really does take over
  room.removePlayer('a');
  a.botControlled = true;
  if (!room.autoPlayed(a)) fail('after the grace period a bot should play the seat');
  room.reconnect('a');
  if (room.autoPlayed(a)) fail('coming back should take the seat off the bot');
  room.dispose();
  ok('disconnect grace period and seat recovery');
}

{
  // A trade moves properties and cash both ways.
  const room = new GameRoom('t', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.hostId = 'a';
  room.start('a');
  const [x, y] = room.map.groups.IT;
  room.ownership[x] = { owner: 'a', houses: 0, mortgaged: false };
  room.ownership[y] = { owner: 'b', houses: 0, mortgaged: false };
  room.player('a').money = 1000;
  room.player('b').money = 1000;
  const res = room.proposeTrade('a', { to: 'b', give: { money: 300, tiles: [x], cards: 0 }, get: { money: 0, tiles: [y], cards: 0 } });
  room.respondTrade('b', res.trade.id, true);
  if (room.own(x).owner !== 'b' || room.own(y).owner !== 'a') fail('trade should swap the properties');
  if (room.player('a').money !== 700 || room.player('b').money !== 1300) fail('trade should move the cash');
  ok('trade execution');
}

console.log(failures ? `\n✗ ${failures} problem(s) found\n` : '\n✓ all checks passed\n');
process.exit(failures ? 1 : 0);
