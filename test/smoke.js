// Headless rules test. Drives bot-only games synchronously (no timers) so a
// few hundred games run in seconds, checking invariants after every action.
// Run with `npm test`.

import { GameRoom } from '../server/game.js';
import { MAPS, generateRandomMap } from '../server/maps.js';
import { TEAMS } from '../server/game.js';

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
  room.map = mapId === 'random' ? generateRandomMap() : MAPS[mapId];

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

/** Every board — handwritten or generated — must satisfy all of this. */
function checkMapIntegrity(id, map) {
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
  const names = props.map((t) => t.name);
  if (new Set(names).size !== names.length) fail(`${id}: duplicate street names`);
  return props;
}

// ---------------------------------------------------------------------------
console.log('\n▶ map integrity');
for (const [id, map] of Object.entries(MAPS)) {
  const props = checkMapIntegrity(id, map);
  ok(`${id}: ${map.size} tiles, ${props.length} streets, ${map.airportCount} airports, ${map.utilityCount} utilities`);
}

{
  // The generator must produce a legal board every time, not just usually.
  const ROUNDS = 200;
  const seenBoards = new Set();
  for (let i = 0; i < ROUNDS; i++) {
    const map = generateRandomMap();
    checkMapIntegrity(`random#${i}`, map);
    if (map.tiles.filter((t) => t.type === 'property').length !== 22) fail(`random#${i}: expected 22 streets`);
    if (map.airportCount !== 4) fail(`random#${i}: expected 4 airports`);
    if (map.utilityCount !== 2) fail(`random#${i}: expected 2 utilities`);
    seenBoards.add(map.tiles.map((t) => t.name).join('|'));
  }
  if (seenBoards.size < ROUNDS * 0.9) fail(`random maps repeat too often (${seenBoards.size}/${ROUNDS} unique)`);
  ok(`random: ${ROUNDS} generated boards all legal, ${seenBoards.size} unique`);

  // Each generated board needs its own uid, otherwise the client reuses the
  // previous tile grid and shows streets the server is no longer playing on.
  const uids = new Set(Array.from({ length: 50 }, () => generateRandomMap().uid));
  if (uids.size !== 50) fail(`generated boards must each have a unique uid (got ${uids.size}/50)`);
  if ([...uids].some((u) => u === 'random')) fail('a generated board reused the shared id as its uid');
  for (const [id, map] of Object.entries(MAPS)) {
    if (map.uid !== id) fail(`${id}: a fixed board's uid should equal its id`);
  }
  ok('every generated board carries a distinct uid');
}

console.log('\n▶ rule variants (every map, twice each)');
const VARIANTS = [
  { label: 'defaults', settings: {} },
  { label: 'x2 rent + vacation pot', settings: { x2rent: true, vacationCash: true } },
  { label: 'no auction, no mortgage', settings: { auction: false, mortgage: false } },
  { label: 'free build order', settings: { evenBuild: false } },
  { label: 'no rent while jailed', settings: { noRentInPrison: true } },
  { label: 'poor start ($500), 6 players', settings: { startingCash: 500, players: 6, maxPlayers: 8 } },
  { label: '2 teams of 2', settings: { teams: 2, players: 4 } },
  { label: '2 teams of 3', settings: { teams: 2, players: 6, maxPlayers: 8 } },
];

const MAP_IDS = [...Object.keys(MAPS), 'random'];
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


console.log('\n▶ teams');
{
  const room = new GameRoom('t', () => {});
  room.map = MAPS.classic;
  room.settings.teams = 2;
  ['a', 'b', 'c', 'd'].forEach((id) => room.addPlayer({ id, name: id.toUpperCase() }));
  room.hostId = 'a';

  room.balanceTeams();
  const spread = [0, 1].map((n) => room.players.filter((p) => p.team === n).length);
  if (spread[0] !== 2 || spread[1] !== 2) fail(`balanceTeams should split 2/2, got ${spread.join('/')}`);
  ok('balanceTeams splits the room evenly');

  room.settings.randomizeOrder = false;
  room.start('a');

  // start() wipes ownership, so hand out the deed after the game begins.
  const [x] = room.map.groups.IT;
  room.ownership[x] = { owner: 'a', houses: 0, mortgaged: false };

  const mate = room.players.find((p) => p.id !== 'a' && p.team === room.player('a').team);
  const foe = room.players.find((p) => p.team !== room.player('a').team);
  if (!room.sameTeam(room.player('a'), mate)) fail('teammates should register as same team');
  if (room.sameTeam(room.player('a'), foe)) fail('opponents should not register as same team');

  const rentDue = room.rentFor(x);
  if (!(rentDue > 0)) fail('test setup: the street should charge rent');

  const mateBefore = mate.money;
  room.turn = { playerId: mate.id, phase: 'roll', dice: [1, 1], doubles: 0, pending: null, debt: null, rolledThisTurn: true };
  room.landOn(mate, x);
  if (mate.money !== mateBefore) fail(`teammate paid ${mateBefore - mate.money} rent — should pay nothing`);
  ok('teammates pay no rent to each other');

  const foeBefore = foe.money;
  room.turn = { playerId: foe.id, phase: 'roll', dice: [1, 1], doubles: 0, pending: null, debt: null, rolledThisTurn: true };
  room.landOn(foe, x);
  if (foe.money !== foeBefore - rentDue) fail(`opponent should pay ${rentDue}, paid ${foeBefore - foe.money}`);
  ok('opponents still pay full rent');

  // Knocking out one member must not end a team game.
  room.bankrupt(foe, room.player('a'));
  if (room.status === 'ended') fail('game ended while the losing team still had a player');
  ok('a team survives while any member is solvent');

  const lastFoe = room.active.find((p) => p.team !== room.player('a').team);
  room.bankrupt(lastFoe, room.player('a'));
  if (room.status !== 'ended') fail('game should end once a whole team is bankrupt');
  if (room.winningTeam !== room.player('a').team) fail('the surviving team should be recorded as the winner');
  ok(`team game ends on the last opponent (Team ${TEAMS[room.winningTeam].name} won)`);
}

{
  // A lobby stacked onto one side cannot produce a winner, so refuse to start.
  const room = new GameRoom('t2', () => {});
  room.map = MAPS.classic;
  room.settings.teams = 2;
  ['a', 'b'].forEach((id) => room.addPlayer({ id, name: id }));
  room.hostId = 'a';
  room.players.forEach((p) => { p.team = 0; });
  const res = room.start('a');
  if (!res.error) fail('starting with everyone on one team should be refused');
  ok('refuses to start with every player on one team');
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
  // Passing START pays $200; landing dead on it pays $300 instead.
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

  // Exact landing: $300, and no double-dip with the passing salary.
  a.pos = room.map.size - 3;
  const cash = a.money;
  room.movePlayer(a, 3); // lands dead on START
  if (a.pos !== 0) fail(`expected to land on START, got ${a.pos}`);
  if (a.money !== cash + 300) fail(`landing on START should pay exactly $300 (got ${a.money - cash})`);
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

{
  // Accepting a stale trade must not steal a tile from its new owner.
  const room = new GameRoom('st', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.addPlayer({ id: 'c', name: 'C' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const street = room.map.tiles.find((t) => t.type === 'property').index;
  room.ownership[street] = { owner: 'a', houses: 0, mortgaged: false };

  const toB = room.proposeTrade('a', { to: 'b', give: { money: 0, tiles: [street], cards: 0 }, get: { money: 100, tiles: [], cards: 0 } });
  const toC = room.proposeTrade('a', { to: 'c', give: { money: 0, tiles: [street], cards: 0 }, get: { money: 100, tiles: [], cards: 0 } });
  room.respondTrade('b', toB.trade.id, true);
  if (room.own(street).owner !== 'b') fail('first accept should hand the tile to b');
  const cCashBefore = room.player('c').money;
  const res = room.respondTrade('c', toC.trade.id, true);
  if (!res.error) fail('stale duplicate trade should be rejected');
  if (room.own(street).owner !== 'b') fail('stale trade must not rip the tile off its new owner');
  if (room.player('c').money !== cCashBefore) fail('stale trade must not move cash');
  ok('stale trade rejected on accept');
}

{
  // "Pay each player" goes to the players — never into the vacation pot.
  const room = new GameRoom('pe', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.addPlayer({ id: 'c', name: 'C' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.settings.vacationCash = true;
  room.start('a');
  const a = room.player('a');
  a.money = 500;
  room.applyCard(a, { kind: 'payEach', amount: 50 });
  if (room.vacationPot !== 0) fail(`payEach must not feed the vacation pot (pot ${room.vacationPot})`);
  if (a.money !== 400) fail(`payEach should cost $100, cash is ${a.money}`);
  if (room.player('b').money !== 2550 || room.player('c').money !== 2550) fail('payEach should credit each opponent');

  // …including when it has to go through the debt phase.
  a.money = 20;
  room.applyCard(a, { kind: 'payEach', amount: 50 });
  if (room.turn.phase !== 'debt') fail('unaffordable payEach should open a debt');
  a.money = 200;
  room.payDebt('a');
  if (room.vacationPot !== 0) fail('debt-settled payEach must not feed the pot');
  if (room.player('b').money !== 2600 || room.player('c').money !== 2600) fail('debt-settled payEach should credit opponents');
  ok('payEach pays the players, not the pot');
}

{
  // Settling the forced prison fine actually releases the player.
  const room = new GameRoom('jf', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a');
  room.sendToJail(a);
  a.jailTurns = 2;
  a.money = 10;                       // cannot afford the $50 fine
  room.turn = { playerId: 'a', phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false };
  room.roll('a', [2, 3]);             // third failed attempt → fine → debt
  if (room.turn.phase !== 'debt') fail('unpayable fine should open a debt');
  if (!room.turn.debt?.jailRelease) fail('the fine debt should remember the rolled move');
  a.money = 400;
  room.payDebt('a');
  if (a.jail) fail('paying the fine debt must release the player');
  if (a.pos !== room.cornerIndex('prison') + 5) fail(`released player should have walked 5 tiles, at ${a.pos}`);
  ok('prison fine via debt releases and moves');
}

{
  // Auction money is escrowed: outbid players are refunded, winners cannot
  // spend their bid elsewhere during the countdown.
  const room = new GameRoom('ae', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const street = room.map.tiles.find((t) => t.type === 'property').index;
  room.startAuction(street);
  room.bid('a', 100);
  if (room.player('a').money !== 2400) fail('leading bid should be escrowed');
  room.bid('b', 200);
  if (room.player('a').money !== 2500) fail('outbid player should be refunded');
  if (room.player('b').money !== 2300) fail('new leader should be escrowed');
  room.finishAuction();
  if (room.own(street)?.owner !== 'b') fail('auction winner should own the tile');
  if (room.player('b').money !== 2300) fail('winner must not be charged twice');
  ok('auction escrow');
}

{
  // A double that breaks you OUT of prison does not earn a free reroll —
  // not even after buying the tile you landed on.
  const room = new GameRoom('nr', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a');
  room.sendToJail(a);
  room.turn = { playerId: 'a', phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false };
  room.roll('a', [3, 3]);             // escape double, lands on tile 16 (street)
  if (a.jail) fail('escape double should release');
  if (room.turn.pending?.type === 'buy') {
    room.buy('a');
    if (room.turn.phase === 'roll') fail('jail-escape double must not grant a reroll after buying');
  } else if (room.turn.phase === 'roll') {
    fail('jail-escape double must not grant a reroll');
  }
  ok('no reroll after jail-escape double');
}

{
  // A backwards teleport to Vacation is not a lap — no START salary.
  const room = new GameRoom('vt', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a');
  a.pos = room.cornerIndex('vacation') + 2;   // just past Vacation
  const cash = a.money;
  room.applyCard(a, { kind: 'moveTo', tile: 'vacation' });
  if (a.pos !== room.cornerIndex('vacation')) fail('should land on Vacation');
  if (a.money !== cash) fail(`backwards vacation hop paid $${a.money - cash} salary`);
  ok('no salary for backwards vacation teleport');
}

{
  // Ignore parks an offer without killing it; viewers track live presence
  // and vanish with the trade.
  const room = new GameRoom('ig', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const res = room.proposeTrade('a', { to: 'b', give: { money: 100 }, get: {} });
  const tid = res.trade.id;
  if (room.ignoreTrade('a', tid).error === undefined) fail('only the recipient may ignore');
  room.ignoreTrade('b', tid);
  let t = room.trades.find((x) => x.id === tid);
  if (t?.ignored !== true) fail('ignore should park the offer');
  if (!room.trades.includes(t)) fail('ignored offer must stay in the list');
  room.setTradeViewing('b', tid, true);
  if (!t.viewers?.includes('b')) fail('viewing should record the viewer');
  room.ignoreTrade('b', tid, false);
  if (t.ignored !== false) fail('un-ignore should bring the offer back');
  room.setTradeViewing('b', tid, true);
  room.respondTrade('b', tid, false);
  if (room.trades.some((x) => x.id === tid)) fail('declined trade should be gone');
  if (room.setTradeViewing('b', tid, false).error === undefined) fail('viewing a dead trade should error');
  ok('trade ignore + viewer presence');
}

{
  // The shot clock removes a silent player without paying anyone off, and
  // the seat stays in the roster so their client can keep watching.
  const room = new GameRoom('to', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.addPlayer({ id: 'c', name: 'C' }); // three, so losing one doesn't end it
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  let karmaHits = [];
  room.hooks.karma = (id, delta) => karmaHits.push([id, delta]);
  room.start('a');
  const a = room.player('a');
  const bCash = room.player('b').money;
  room.buyFor?.(a, 1);
  room.ownership[1] = { owner: 'a', houses: 0, mortgaged: false };
  if (!room.turn.endsAt) fail('turn should carry a deadline');
  room.turnTimedOut('a');
  if (!a.timedOut) fail('timeout should mark the player');
  if (room.ownership[1]) fail('timed-out player\'s deeds should return to the bank');
  if (room.player('b').money !== bCash) fail('a timeout must not pay the other players');
  if (!room.players.some((p) => p.id === 'a')) fail('seat should stay in the roster to spectate');
  if (room.turn.playerId !== 'b') fail('play should move on');
  if (JSON.stringify(karmaHits) !== JSON.stringify([['a', -1]])) fail(`karma hook wrong: ${JSON.stringify(karmaHits)}`);
  ok('turn timeout removes the player and moves on');
}

{
  // Turning the clock off means no deadline at all.
  const room = new GameRoom('to2', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.addPlayer({ id: 'c', name: 'C' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.settings.turnSeconds = 0;
  room.start('a');
  if (room.turn.endsAt) fail('turnSeconds 0 should disable the clock');
  room.quit('a');
  if (!room.player('a').timedOut || room.turn.playerId !== 'b') fail('quit should hand the turn on');
  ok('clock can be switched off; quitting still frees the seat');
}

{
  // A trade can never offer money the sender does not have.
  const room = new GameRoom('mx', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  room.player('a').money = 100;
  const res = room.proposeTrade('a', { to: 'b', give: { money: 1000 }, get: {} });
  if (res.trade.give.money !== 100) fail(`over-offer should clamp to cash on hand, got ${res.trade.give.money}`);
  const neg = room.proposeTrade('a', { to: 'b', give: { money: -50 }, get: { money: 20 } });
  if (neg.trade.give.money !== 0) fail('negative cash should clamp to zero');
  ok('trade cash clamps to what each side actually holds');
}

{
  // Two bots, each one street short, each holding what the other needs. The
  // brain should spot the swap and offer streets — not cash.
  const room = new GameRoom('sw', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'x', name: 'X', isBot: true });
  room.addPlayer({ id: 'y', name: 'Y', isBot: true });
  room.hostId = 'x';
  room.settings.randomizeOrder = false;
  room.start('x');

  const groups = Object.entries(room.map.groups).filter(([, g]) => g.length >= 2);
  const [, gA] = groups[0];
  const [, gB] = groups[1];
  // X owns all of A but one — and that one sits with Y, and vice versa.
  gA.forEach((i, n) => { room.ownership[i] = { owner: n === 0 ? 'y' : 'x', houses: 0, mortgaged: false }; });
  gB.forEach((i, n) => { room.ownership[i] = { owner: n === 0 ? 'x' : 'y', houses: 0, mortgaged: false }; });

  room.trades = [];
  room.botMaybeTrade(room.player('x'));
  const offer = room.trades[0];
  if (!offer) fail('bot should have spotted the mutual swap');
  else if (offer.give.money !== 0 || offer.give.tiles.length !== 1 || offer.get.tiles.length !== 1) {
    fail(`swap should be street-for-street, got ${JSON.stringify(offer)}`);
  } else if (offer.give.tiles[0] !== gB[0] || offer.get.tiles[0] !== gA[0]) {
    fail('swap traded the wrong streets');
  } else {
    ok('bots offer the street-for-street swap that completes both sets');
  }

  // And the receiving bot should take an even swap that finishes its colour.
  const before = room.trades.length;
  room.botTradeReply(offer.id);
  if (room.trades.length !== before - 1) fail('bot never answered the swap');
  else if (room.own(gB[0])?.owner !== 'y') fail('bot turned down a set-completing swap');
  else ok('bots accept a swap that completes their own set');
}

{
  // Chat and names are masked server-side, so every client sees it the same.
  const room = new GameRoom('cl', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'bhosdike' });
  room.addPlayer({ id: 'b', name: 'B' });
  if (room.player('a').name !== 'Player') fail(`slur name should fall back, got ${room.player('a').name}`);
  room.sendChat('b', 'you absolute sh1t, nice classic pass');
  const last = room.chat[room.chat.length - 1].text;
  if (last.includes('sh1t')) fail('profanity should be masked');
  if (!last.includes('classic') || !last.includes('pass')) fail(`clean words were eaten: ${last}`);
  ok('chat and names are filtered on the server');
}

{
  // A dropped player's chair is held, and the table decides how long: two
  // favours anyone can do alone, after that it takes everyone still playing.
  const room = new GameRoom('hold', () => {});
  room.map = MAPS.classic;
  ['a', 'b', 'c'].forEach((id) => room.addPlayer({ id, name: id.toUpperCase() }));
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');

  room.removePlayer('c');
  const seat = () => room.awaiting?.c;
  if (!seat()) fail('a dropped player should leave a seat to wait on');
  if (room.player('c').botControlled) fail('a bot must not take over the moment someone drops');

  // First two extensions: one player is enough.
  const first = room.grantTime('a', 'c');
  if (!first.ok || first.pending) fail('the first minute should not need a vote');
  const second = room.grantTime('b', 'c');
  if (!second.ok || second.pending) fail('the second minute should not need a vote');
  if (seat().grants !== 2) fail(`expected 2 grants, got ${seat().grants}`);

  // Third: now it takes the whole table.
  const third = room.grantTime('a', 'c');
  if (!third.pending) fail('past two favours a single click should not be enough');
  if (seat().grants !== 2) fail('a pending vote must not extend the clock');
  const fourth = room.grantTime('b', 'c');
  if (fourth.pending) fail('once everyone has clicked the minute should land');
  if (seat().grants !== 3) fail('the granted minute never counted');

  if (room.grantTime('c', 'c').error === undefined) fail('you cannot grant your own time');

  // Nobody grants again — the chair goes back to the board.
  room.seatRanOut('c');
  if (!room.player('c').timedOut) fail('an abandoned seat should leave play');
  if (room.awaiting?.c) fail('the wait should be cleared once it resolves');
  ok('a dropped seat is held, extended by agreement, and finally released');
}

{
  // With people waiting, every turn shows a deadline — including the ones the
  // house plays, so the clock never blinks out and never gives a bot away.
  const room = new GameRoom('clk', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.addBot();
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  for (let i = 0; i < 4; i++) {
    if (!room.turn.endsAt) { fail('a turn went by with no clock on it'); break; }
    room.nextTurn();
  }
  ok('every turn carries a clock while people are waiting');
}

{
  // Alone against bots you added yourself, nobody is kept waiting — so no
  // clock, and no chance of your own bots timing you out.
  const room = new GameRoom('clk2', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addBot();
  room.addBot();
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  for (let i = 0; i < 4; i++) {
    if (room.turn.endsAt) { fail('a solo game against bots should have no clock'); break; }
    room.nextTurn();
  }
  ok('no shot clock when the only person at the table is you');
}

{
  // Head-to-head deadlock: one player builds, the other holds all but one of
  // a colour and can never build. Four laps and the wall comes down.
  const room = new GameRoom('dl', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'Ava' });
  room.addPlayer({ id: 'b', name: 'Bo' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a');
  const b = room.player('b');

  // The rule only wakes once the board is sold out — while a street is still
  // unowned, Bo could yet land on it and build a colour of their own. Ava takes
  // the whole board except the one colour Bo is short in, which also keeps the
  // wall down to a single street so the roll has nothing to choose between.
  const [g1, g2] = Object.entries(room.map.groups);
  room.map.tiles.forEach((t, i) => {
    if (t.type === 'property') room.ownership[i] = { owner: 'a', houses: 0, mortgaged: false };
  });
  // Ava owns a colour outright and has built on all of it.
  for (const i of g1[1]) room.ownership[i] = { owner: 'a', houses: 1, mortgaged: false };
  // Bo holds all of another colour but the last street, which Ava owns.
  const blocked = g2[1];
  blocked.forEach((i, n) => {
    room.ownership[i] = { owner: n === 0 ? 'a' : 'b', houses: 0, mortgaged: false };
  });
  const wall = blocked[0];
  const price = Math.ceil(room.tile(wall).price * 1.7);
  b.money = price + 50;
  const avaBefore = a.money;

  for (let lap = 1; lap <= 3; lap++) {
    room.noteLap(b);
    if (room.own(wall).owner !== 'a') { fail(`the street moved after only ${lap} lap(s)`); break; }
  }
  if (b.blockedLaps !== 3) fail(`expected 3 laps counted, got ${b.blockedLaps}`);
  if (!room.reliefCard) fail('both players should have been told the rule');

  room.noteLap(b);
  if (room.own(wall).owner !== 'b') fail('the fourth lap should move the street');
  if (b.money !== 50) fail(`buyer should have paid ${price}, left with ${b.money}`);
  if (a.money !== avaBefore + price) fail('the seller was not paid');
  if (b.blockedLaps !== 0) fail('the lap count should reset once it fires');
  ok('deadlock relief moves the blocking street after four laps');
}

{
  // Too poor to pay: the chance lapses and the laps start over.
  const room = new GameRoom('dl2', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'Ava' });
  room.addPlayer({ id: 'b', name: 'Bo' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const [g1, g2] = Object.entries(room.map.groups);
  for (const i of g1[1]) room.ownership[i] = { owner: 'a', houses: 1, mortgaged: false };
  g2[1].forEach((i, n) => {
    room.ownership[i] = { owner: n === 0 ? 'a' : 'b', houses: 0, mortgaged: false };
  });
  const wall = g2[1][0];
  room.player('b').money = 1;
  for (let lap = 0; lap < 4; lap++) room.noteLap(room.player('b'));
  if (room.own(wall).owner !== 'a') fail('a player who cannot pay must not get the street');
  if (room.player('b').blockedLaps !== 0) fail('the lap count should restart after a failed claim');
  ok('no money, no street — the laps start again');
}

{
  // The rule is for two. A third player at the table switches it off, and so
  // does owning a colour of your own.
  const room = new GameRoom('dl3', () => {});
  room.map = MAPS.classic;
  ['a', 'b', 'c'].forEach((id) => room.addPlayer({ id, name: id.toUpperCase() }));
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const [g1, g2] = Object.entries(room.map.groups);
  for (const i of g1[1]) room.ownership[i] = { owner: 'a', houses: 1, mortgaged: false };
  g2[1].forEach((i, n) => {
    room.ownership[i] = { owner: n === 0 ? 'a' : 'b', houses: 0, mortgaged: false };
  });
  for (let lap = 0; lap < 5; lap++) room.noteLap(room.player('b'));
  if (room.own(g2[1][0]).owner !== 'a') fail('the rule should not fire in a three-player game');
  if (room.blockingTiles(room.player('b')).length) fail('three players should report no deadlock');
  ok('deadlock relief stays out of games with more than two players');
}

console.log(failures ? `\n✗ ${failures} problem(s) found\n` : '\n✓ all checks passed\n');
process.exit(failures ? 1 : 0);
