// Headless rules test. Drives bot-only games synchronously (no timers) so a
// few hundred games run in seconds, checking invariants after every action.
// Run with `npm test`.

import { GameRoom } from '../server/game.js';
import { MAPS, generateRandomMap, GROUPS } from '../server/maps.js';
import { TEAMS } from '../server/game.js';
import { diff, applyPatch, snapshot, feedTail, applyFeed, RESYNC } from '../server/delta.js';

let failures = 0;
const seen = new Set();
const fail = (msg) => {
  failures++;
  if (!seen.has(msg)) { seen.add(msg); console.error('  ✗', msg); }
};
const ok = (msg) => console.log('  ✓', msg);

function checkInvariants(room, where) {
  const debt = room.turn?.debt || null;
  for (const p of room.players) {
    // The red is legal for exactly one player: the live debtor named on the
    // open debt. Money streams to the creditors as it arrives, so a negative
    // balance IS the ledger of what is still owed — anywhere else it's a bug.
    const inTheRed = room.status === 'playing' && debt?.debtor === p.id && !p.bankrupt;
    if (p.money < 0 && !inTheRed) fail(`${where}: ${p.name} has negative cash (${p.money})`);
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
  if (debt && room.status === 'playing') {
    const debtor = room.player(debt.debtor);
    if (!debtor) fail(`${where}: debt owed by a ghost`);
    else {
      if (debtor.money >= 0) fail(`${where}: a cleared debt is still open (balance ${debtor.money})`);
      if (debt.amount !== Math.max(0, -debtor.money)) {
        fail(`${where}: debt ledger out of sync (shows ${debt.amount}, balance says ${-debtor.money})`);
      }
      if (debt.owedTo) {
        const split = debt.owedLeft.reduce((s, n) => s + n, 0);
        if (split !== debt.amount) fail(`${where}: pro-rata split leaks coins (${split} vs ${debt.amount})`);
      }
    }
    // A debt can only stall the turn it was charged on — the active player's.
    if (debt.debtor !== room.turn.playerId) fail(`${where}: debt owed by ${debt.debtor} on ${room.turn.playerId}'s turn`);
    if (phase !== 'debt') fail(`${where}: open debt but phase "${phase}"`);
  }
  // The contract is an iff: the phase without the object would strand clients.
  if (!debt && room.status === 'playing' && phase === 'debt') fail(`${where}: debt phase with nothing owed`);
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

  // Every hammer raised must fall: the convergence check below audits this.
  const auctions = { opened: 0, closed: 0 };
  const startAuction = room.startAuction.bind(room);
  room.startAuction = (i) => { auctions.opened++; return startAuction(i); };
  const finishAuction = room.finishAuction.bind(room);
  room.finishAuction = () => { if (room.auction) auctions.closed++; return finishAuction(); };

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
  return { room, turns, steps, auctions };
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

  // …including when it lands short: the cash on hand splits pro rata right
  // now, and every later gain streams the same way — never into the pot.
  a.money = 20;
  room.applyCard(a, { kind: 'payEach', amount: 50 });
  if (room.turn.phase !== 'debt') fail('unaffordable payEach should open a debt');
  if (a.money !== -80) fail(`the shortfall should show as a negative balance (${a.money})`);
  if (room.player('b').money !== 2560 || room.player('c').money !== 2560) fail('the $20 on hand should split $10/$10 immediately');
  room.receive(a, 200);
  if (room.vacationPot !== 0) fail('debt-streamed payEach must not feed the pot');
  if (room.player('b').money !== 2600 || room.player('c').money !== 2600) fail('the stream should top both up to their $50');
  if (a.money !== 120 || room.turn.debt) fail(`the debt should close with the rest in hand (${a.money})`);
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
  if (a.money !== -40) fail(`the $10 on hand should sink into the fine first (${a.money})`);
  room.receive(a, 400);               // raises cash — the last $40 streams to the bank
  if (a.jail) fail('paying off the fine debt must release the player');
  if (a.money !== 360) fail(`the player should keep what the fine did not eat (${a.money})`);
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
  // The rule waits for a sold-out board, so give Ava everything first.
  room.map.tiles.forEach((t, i) => {
    if (t.type === 'property') room.ownership[i] = { owner: 'a', houses: 0, mortgaged: false };
  });
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
  // Sold out board, so only the third player keeps the rule quiet here.
  room.map.tiles.forEach((t, i) => {
    if (t.type === 'property') room.ownership[i] = { owner: 'c', houses: 0, mortgaged: false };
  });
  for (const i of g1[1]) room.ownership[i] = { owner: 'a', houses: 1, mortgaged: false };
  g2[1].forEach((i, n) => {
    room.ownership[i] = { owner: n === 0 ? 'a' : 'b', houses: 0, mortgaged: false };
  });
  for (let lap = 0; lap < 5; lap++) room.noteLap(room.player('b'));
  if (room.own(g2[1][0]).owner !== 'a') fail('the rule should not fire in a three-player game');
  if (room.blockingTiles(room.player('b')).length) fail('three players should report no deadlock');
  ok('deadlock relief stays out of games with more than two players');
}

{
  // While any street is still unsold the wall might yet come down by luck —
  // the blocked player could land on the open street and start a colour of
  // their own — so the deadlock rule must stay silent until every property
  // tile has an owner.
  const room = new GameRoom('dl4', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'Ava' });
  room.addPlayer({ id: 'b', name: 'Bo' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const b = room.player('b');
  const [g1, g2] = Object.entries(room.map.groups);
  const streets = room.map.tiles.filter((t) => t.type === 'property').map((t) => t.index);
  const open = streets.find((i) => !g1[1].includes(i) && !g2[1].includes(i));
  for (const i of streets) {
    if (i !== open) room.ownership[i] = { owner: 'a', houses: 0, mortgaged: false };
  }
  for (const i of g1[1]) room.ownership[i] = { owner: 'a', houses: 1, mortgaged: false };
  g2[1].forEach((i, n) => {
    room.ownership[i] = { owner: n === 0 ? 'a' : 'b', houses: 0, mortgaged: false };
  });

  for (let lap = 0; lap < 5; lap++) room.noteLap(b);
  if (room.blockingTiles(b).length) fail('an unsold street should keep the deadlock rule quiet');
  if (b.blockedLaps) fail('laps must not count while a street is unsold');
  if (room.reliefCard) fail('the rule must not announce itself while a street is unsold');
  if (room.own(g2[1][0]).owner !== 'a') fail('the wall must not move while a street is unsold');

  // The last street selling is what wakes the rule up.
  room.ownership[open] = { owner: 'a', houses: 0, mortgaged: false };
  room.noteLap(b);
  if (b.blockedLaps !== 1) fail('the rule should wake once the board is sold out');
  if (!room.reliefCard) fail('the rule should introduce itself once the board is sold out');
  ok('deadlock relief waits until every street has an owner');
}

{
  // Match stats land where the events happen, and the ended state hands out
  // honest, unique titles.
  const room = new GameRoom('stat', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a');

  room.roll('a', [2, 2]);                       // one double (lands on a tax tile)
  room.turn.pending = null;
  if (room.stats.a?.doubles !== 1) fail(`doubles counter: ${room.stats.a?.doubles}`);
  room.sendToJail(a);
  if (room.stats.a.jailed !== 1) fail(`jailed counter: ${room.stats.a.jailed}`);
  a.jail = false;
  a.jailTurns = 0;

  // Rent paid on the spot…
  const s = room.map.groups.IL[0];
  room.ownership[s] = { owner: 'b', houses: 0, mortgaged: false };
  const rent = room.rentFor(s);
  room.turn = { playerId: 'a', phase: 'roll', dice: [1, 2], doubles: 0, pending: null, debt: null, rolledThisTurn: true };
  room.landOn(a, s);
  if (room.stats.a.rentPaid !== rent) fail(`rentPaid ${room.stats.a.rentPaid}, expected ${rent}`);
  if (room.stats.b.rentCollected !== rent) fail(`rentCollected ${room.stats.b.rentCollected}, expected ${rent}`);
  if (room.stats.b.biggestRent !== rent || room.stats.b.biggestRentTile !== room.tile(s).name) {
    fail('biggest rent should remember the amount and the street');
  }

  // …and rent streamed late through the debt phase both count.
  a.money = 0;
  room.landOn(a, s);
  if (room.turn.phase !== 'debt') fail('broke tenant should open a debt');
  room.receive(a, 500);
  if (room.stats.a.rentPaid !== rent * 2) fail('debt-streamed rent should still count as rent paid');
  if (room.stats.b.rentCollected !== rent * 2) fail('debt-streamed rent should still count as rent collected');

  // A lap past START and a street bought at asking price.
  a.money = 500;
  a.pos = room.map.size - 2;
  room.movePlayer(a, 3);                        // wraps START, lands on an unsold street
  if (room.stats.a.laps !== 1) fail(`laps counter: ${room.stats.a.laps}`);
  if (room.turn.pending?.type !== 'buy') fail('test setup: expected a buy offer');
  room.buy('a');
  if (room.stats.a.streetsBought !== 1) fail(`streetsBought counter: ${room.stats.a.streetsBought}`);

  // Stats and titles are an end-of-game reveal.
  if (room.serialize().stats !== null) fail('stats must stay hidden while the game runs');
  room.bankrupt(room.player('b'), a);
  const state = room.serialize();
  if (!state.stats?.a || !state.stats?.b) fail('ended state should carry both stat lines');
  if (!state.titles || !Object.keys(state.titles).length) fail('ended game should award titles');
  const names = Object.values(state.titles).map((t) => t.title);
  if (new Set(names).size !== names.length) fail('no title may be held by two players');
  if (names.includes('Auction Hawk')) fail('nobody won an auction — the title must not be awarded');
  if (names.includes('Dealmaker')) fail('nobody traded — the title must not be awarded');
  if (state.titles.b?.title !== 'Heavy Hitter') fail(`B collected the only rent, got ${JSON.stringify(state.titles.b)}`);
  if (!state.titles.b?.reason.includes(`${rent}`)) fail('the title reason should cite the number');
  ok('match stats and end-of-game titles');
}

{
  // One roll onto Surprise can move a piece twice; the moves list tells the
  // whole story in order so a client can pace the theatre.
  const room = new GameRoom('mv', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'Ava' });
  room.addPlayer({ id: 'b', name: 'Bo' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const surprise = room.map.tiles.find((t) => t.type === 'surprise');
  // Stack the deck: the top Surprise card walks the piece backwards.
  room.decks.surprise = [{ id: 0, text: 'Go back three spaces.', act: { kind: 'moveBy', n: -3 } }];
  const a = room.player('a');
  a.pos = surprise.index - 4;
  room.roll('a', [1, 3]);
  const causes = room.actionMoves.map((m) => m.cause).join(',');
  if (room.actionMoves.length !== 2) fail(`expected 2 moves, got ${room.actionMoves.length} (${causes})`);
  else if (causes !== 'roll,card') fail(`move causes out of order: ${causes}`);
  else if (room.actionMoves[0].to !== surprise.index) fail('first leg should land on Surprise');
  else if (room.actionMoves[1].from !== surprise.index) fail('card leg should start from Surprise');
  else ok('the moves list carries both legs of a card walk, in order');

  // perProperty charges by street count.
  room.map.tiles.forEach((t, i) => { if (t.type === 'property') delete room.ownership[i]; });
  const streets = room.map.tiles.filter((t) => t.type === 'property').slice(0, 3);
  streets.forEach((t) => { room.ownership[t.index] = { owner: 'a', houses: 0, mortgaged: false }; });
  const before = a.money;
  room.applyCard(a, { kind: 'perProperty', amount: -25 });
  if (a.money !== before - 75) fail(`perProperty charged ${before - a.money}, expected 75`);
  else ok('perProperty taxes each owned street');

  // Conceding is allowed off-turn now — Bo gives up while Ava holds the dice.
  const res = room.declareBankrupt('b');
  if (res.error) fail(`off-turn concede refused: ${res.error}`);
  else if (!room.player('b').bankrupt) fail('conceding player is not bankrupt');
  else if (room.status !== 'ended') fail('two-hander should end when one concedes');
  else ok('a player can concede at any moment, ending a two-hander');
}

{
  // A vacation starts now: even a double buys no second roll from the deck
  // chair, and the next turn is skipped as before.
  const room = new GameRoom('vac', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'Ava' });
  room.addPlayer({ id: 'b', name: 'Bo' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const vac = room.map.tiles.find((t) => t.type === 'vacation').index;
  const a = room.player('a');
  const size = room.map.size;
  a.pos = (vac - 4 + size) % size;
  room.roll('a', [2, 2]);
  if (room.turn.phase === 'roll' && room.turn.playerId === 'a') fail('vacation must cancel the double encore');
  else if (a.pos !== vac) fail(`expected Ava on vacation tile ${vac}, got ${a.pos}`);
  else ok('vacation cancels the rest of the turn, doubles included');
  room.dispose();
}

{
  // Denial: a rival one street from a full colour, that street on the block —
  // a bot with ordinary cash outbids the sticker to kill the set.
  const room = new GameRoom('shark', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'h', name: 'Hema' });
  room.addPlayer({ id: 'u_shark1', name: 'Shark', isBot: true });
  room.hostId = 'h';
  room.settings.randomizeOrder = false;
  room.start('h');
  const [gname, gtiles] = Object.entries(room.map.groups).find(([, t]) => t.length === 3);
  const last = gtiles[2];
  gtiles.slice(0, 2).forEach((i) => { room.ownership[i] = { owner: 'h', houses: 0, mortgaged: false }; });
  const bot = room.player('u_shark1');
  bot.money = 500;
  const price = room.tile(last).price;
  const worth = room.botValueOf(bot, last);
  if (worth < Math.floor(price * 1.8)) fail(`denial worth too shy: ${worth} for a $${price} street`);
  // Drive the auction by hand: the human opens at list price, the shark answers.
  room.auction = { tile: last, bid: price, leader: 'h', inRace: ['h', 'u_shark1'], endsAt: null };
  room.runBotAuction();
  if (room.auction.leader !== 'u_shark1' || room.auction.bid <= price) {
    fail(`the shark let a set complete (bid ${room.auction.bid}, leader ${room.auction.leader})`);
  } else ok('a bot outbids the sticker price to deny an imminent set');
  room.auction = null;

  // Trades: the set-completing street never moves for pocket change, and
  // moves when the package pays the denial premium.
  room.ownership[last] = { owner: 'u_shark1', houses: 0, mortgaged: false };
  const cheapAsk = { from: 'h', to: 'u_shark1', give: { money: 20, tiles: [], cards: 0 }, get: { money: 0, tiles: [last], cards: 0 }, id: 't1' };
  room.trades = [cheapAsk];
  room.botTradeReply('t1');
  if (room.own(last)?.owner !== 'u_shark1') fail('a set-completing street moved for pocket change');
  else ok('a bot refuses to arm a rival for pocket change');
  room.player('h').money = 5000;
  const richAsk = { from: 'h', to: 'u_shark1', give: { money: price * 5, tiles: [], cards: 0 }, get: { money: 0, tiles: [last], cards: 0 }, id: 't2' };
  room.trades = [richAsk];
  room.botTradeReply('t2');
  if (room.own(last)?.owner === 'u_shark1') fail('the premium package should have moved the street');
  else ok('the same street moves when the package pays the premium');
  room.dispose();
}




console.log('\n▶ cards through START');
{
  // An "advance" card wraps through START like any roll: salary and lap both.
  // A backwards card stays salary-free.
  const room = new GameRoom('mb', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a');
  a.pos = room.map.size - 2;
  const cash = a.money;
  room.applyCard(a, { kind: 'moveBy', n: 3 });
  if (a.pos !== 1) fail(`the forward card should land on tile 1, got ${a.pos}`);
  if (a.money !== cash + 200) fail(`a forward card past START should pay the $200 salary (got ${a.money - cash})`);
  if ((room.stats.a?.laps || 0) !== 1) fail('the wrap should count as a lap');

  room.turn.pending = null;
  room.turn.phase = 'end';
  a.pos = 4;
  const cash2 = a.money;
  room.applyCard(a, { kind: 'moveBy', n: -3 });
  if (a.pos !== 1) fail(`the backwards card should land on tile 1, got ${a.pos}`);
  if (a.money !== cash2) fail(`a backwards card must not pay salary (moved $${a.money - cash2})`);
  if ((room.stats.a?.laps || 0) !== 1) fail('walking backwards is not a lap');
  room.dispose();
  ok('moveBy cards pay the salary forward, never backwards');
}

console.log('\n▶ exits during a live auction');
{
  // Removing the roller mid-auction used to fork the table: nextTurn() handed
  // the next player a roll phase and finishAuction later stomped it. The turn
  // now stays parked on the auction until the hammer falls.
  const room = new GameRoom('auc1', () => {});
  room.map = MAPS.classic;
  ['a', 'b', 'c'].forEach((id) => room.addPlayer({ id, name: id.toUpperCase() }));
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const street = room.map.tiles.find((t) => t.type === 'property').index;
  room.startAuction(street);
  room.bid('b', 100);
  room.removeFromPlay(room.player('a'), 'quit');
  if (!room.auction) fail('the auction should continue while others still race');
  if (room.turn.playerId !== 'a' || room.turn.phase !== 'auction') {
    fail(`the turn advanced out from under a live auction (${room.turn.playerId}/${room.turn.phase})`);
  }
  room.passBid('c');
  if (room.auction) fail('the auction should close once only the leader remains');
  if (room.own(street)?.owner !== 'b') fail('the leader should still win the tile');
  if (room.player('b').money !== 2400) fail(`the winner should pay exactly once, has ${room.player('b').money}`);
  if (room.turn.playerId !== 'b' || room.turn.phase !== 'roll') {
    fail(`the turn should pass on after the hammer (${room.turn.playerId}/${room.turn.phase})`);
  }
  room.dispose();
  ok('a removed roller no longer forks a live auction');
}

{
  // The leader leaving voids their bid: the escrow leaves with their cash and
  // the bidding restarts at the minimum for whoever is left.
  const room = new GameRoom('auc2', () => {});
  room.map = MAPS.classic;
  ['a', 'b', 'c'].forEach((id) => room.addPlayer({ id, name: id.toUpperCase() }));
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const street = room.map.tiles.find((t) => t.type === 'property').index;
  room.startAuction(street);
  room.bid('b', 100);
  room.removeFromPlay(room.player('b'), 'timeout');
  if (!room.auction) fail('the auction should survive its leader leaving');
  if (room.auction.leader !== null || room.auction.bid !== 0) fail('a removed leader\'s bid should be void');
  if (room.player('b').money !== 0) fail('the escrow leaves with the removed leader');
  const res = room.bid('c', 10);
  if (res?.error) fail(`bidding should restart at $10 (${res.error})`);
  room.passBid('a');
  if (room.auction) fail('the auction should end with only the new leader left');
  if (room.own(street)?.owner !== 'c') fail('the remaining bidder should win');
  if (room.turn.playerId !== 'a' || room.turn.phase !== 'end') {
    fail(`the roller keeps their turn when still in play (${room.turn.playerId}/${room.turn.phase})`);
  }
  room.dispose();
  ok('a removed leader voids the bid without stalling the race');
}

{
  // Bankruptcy mid-auction: the escrowed bid returns to the estate first, so
  // the creditor inherits it rather than the void.
  const room = new GameRoom('auc3', () => {});
  room.map = MAPS.classic;
  ['a', 'b', 'c'].forEach((id) => room.addPlayer({ id, name: id.toUpperCase() }));
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const street = room.map.tiles.find((t) => t.type === 'property').index;
  room.startAuction(street);
  room.bid('b', 100);
  room.bankrupt(room.player('b'), room.player('c'));
  if (room.player('c').money !== 5000) fail(`the creditor should inherit the refunded escrow (got ${room.player('c').money})`);
  if (!room.auction) fail('the race should carry on for the others');
  if (room.auction.leader !== null || room.auction.bid !== 0) fail('a bankrupt leader\'s bid should be void');
  room.dispose();
  ok('a bankrupt leader\'s escrow goes to the creditor, not the void');
}

console.log('\n▶ debts and departures');
{
  // A "pay each player" debt settled late pays exactly the players it was
  // owed to and who are still in the game — leavers shrink the bill.
  const room = new GameRoom('pe2', () => {});
  room.map = MAPS.classic;
  ['a', 'b', 'c', 'd'].forEach((id) => room.addPlayer({ id, name: id.toUpperCase() }));
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.settings.vacationCash = true;
  room.start('a');
  const a = room.player('a');
  a.money = 20;
  room.applyCard(a, { kind: 'payEach', amount: 50 });
  if (room.turn.phase !== 'debt') fail('an unaffordable payEach should open a debt');
  // The $20 on hand splits pro rata over $50/$50/$50, floor-and-carry: 6/7/7.
  if (room.player('b').money !== 2506 || room.player('c').money !== 2507 || room.player('d').money !== 2507) {
    fail(`the immediate split should be integer-exact 6/7/7, got ${['b', 'c', 'd'].map((x) => room.player(x).money - 2500).join('/')}`);
  }
  if (a.money !== -130) fail(`the debtor should carry the $130 remainder (${a.money})`);
  // D walks out mid-stream: their unpaid $43 is forgiven, not paid to a ghost.
  room.removeFromPlay(room.player('d'), 'quit');
  if (a.money !== -87) fail(`the leaver's share should be forgiven, balance ${a.money}`);
  if (room.turn.debt?.amount !== 87) fail(`the ledger should shrink with the leaver (${room.turn.debt?.amount})`);
  room.receive(a, 500);
  if (a.money !== 413) fail(`the debtor keeps what the survivors were not owed (${a.money})`);
  if (room.player('b').money !== 2550 || room.player('c').money !== 2550) fail('each survivor should end on exactly their $50');
  if (room.player('d').money !== 0) fail('a leaver must not keep accruing');
  if (room.vacationPot !== 0) fail('the shrunken debt must not leak into the pot');
  if (room.turn.debt) fail('the debt should be closed');
  room.dispose();
  ok('payEach streams pro rata, forgives a leaver, and stays integer-exact');
}

{
  // A doubles roll whose landing opened a debt still owes the re-roll.
  const room = new GameRoom('dd', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a');
  const s = room.map.tiles.find((t) => t.type === 'property' && t.index >= 3).index;
  room.ownership[s] = { owner: 'b', houses: 0, mortgaged: false };
  a.pos = s - 2;
  a.money = 0;
  room.roll('a', [1, 1]);
  if (room.turn.phase !== 'debt') fail('unpayable rent should stall in the debt phase');
  room.receive(a, 500);
  if (room.turn.phase !== 'roll') fail(`clearing the debt should hand the double back its re-roll (got ${room.turn.phase})`);

  // …and a plain roll still ends the turn once the debt clears.
  room.turn = { playerId: 'a', phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false };
  a.pos = s - 3;
  a.money = 0;
  room.roll('a', [1, 2]);
  if (room.turn.phase !== 'debt') fail('setup: the plain roll should open a debt too');
  room.receive(a, 500);
  if (room.turn.phase !== 'end') fail('a plain roll must not gain a re-roll from the debt');
  room.dispose();
  ok('doubles survive a debt settlement, plain rolls do not');
}

console.log('\n▶ the debt stream (money is never minted)');
{
  const room = new GameRoom('ds', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'Ava' });
  room.addPlayer({ id: 'b', name: 'Bo' });
  room.addPlayer({ id: 'c', name: 'Cy' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a'), b = room.player('b'), c = room.player('c');
  a.money = 1000; b.money = 500; c.money = 2000;

  // Bo owns a full colour with one house, plus a lone street to sell later.
  const [g1, g2] = Object.values(room.map.groups);
  g1.forEach((i) => { room.ownership[i] = { owner: 'b', houses: 0, mortgaged: false }; });
  room.ownership[g1[0]].houses = 1;
  const lone = g2[0];
  room.ownership[lone] = { owner: 'b', houses: 0, mortgaged: false };

  // (a) Bo lands on Ava's hotel: $1,800 due against $500 in hand. Ava banks
  // the $500 that exists right now; the rest is Bo's balance, in the red.
  room.turn = { playerId: 'b', phase: 'roll', dice: [4, 4], doubles: 1, pending: null, debt: null, rolledThisTurn: true };
  room.charge(b, 1800, a, 'for the Grand Hotel');
  if (a.money !== 1500) fail(`(a) the creditor banks the $500 that exists (has ${a.money})`);
  if (b.money !== -1300) fail(`(a) the debtor sits at -1300 (${b.money})`);
  if (room.turn.phase !== 'debt' || room.turn.debt?.amount !== 1300) fail('(a) the debt phase opens at the remainder');
  room.push();
  if (room.turn.debt.amount !== 1300) fail('(a) push must keep the ledger synced for old clients');

  // While in the red: no buying, no building, no bidding, no ending the turn.
  if (!room.build('b', g1[1]).error) fail('a negative purse must fail the build check');
  room.turn.pending = { type: 'buy', tile: lone, price: room.tile(lone).price };
  if (!room.buy('b').error) fail('a negative purse must fail the buy check');
  room.turn.pending = null;
  if (!room.endTurn('b').error) fail('the turn must not move past an open debt');
  room.auction = { tile: lone, bid: 0, leader: null, inRace: ['b', 'c'], endsAt: Date.now() + 60000 };
  if (!room.bid('b', 50).error) fail('(h) an auction bid from the red must be refused');
  room.auction = null;

  // (b) Selling the house flows straight through — Bo's balance climbs.
  const R = Math.floor(room.tile(g1[0]).houseCost / 2);
  room.sellHouse('b', g1[0]);
  if (a.money !== 1500 + R) fail(`(b) the sale price flows straight to the creditor (${a.money})`);
  if (b.money !== -1300 + R) fail(`(b) the debtor climbs by the sale (${b.money})`);
  if (room.turn.debt?.amount !== 1300 - R) fail(`(b) the ledger follows the balance (${room.turn.debt?.amount})`);

  // (c) A trade's cash clears the rest to the rupee: debt closed, and the
  // (e) doubles roll that opened it keeps its re-roll.
  const owed = 1300 - R;
  const offer = room.proposeTrade('b', { to: 'c', give: { money: 0, tiles: [lone], cards: 0 }, get: { money: owed, tiles: [], cards: 0 } });
  if (offer.error) fail(`(c) a debtor must still be able to trade (${offer.error})`);
  else room.respondTrade('c', offer.trade.id, true);
  if (b.money !== 0) fail(`(c) the debt closes at exactly zero (${b.money})`);
  if (a.money !== 2800) fail(`(c/d) the creditor's total is exactly the $1,800 billed (${a.money})`);
  if (c.money !== 2000 - owed) fail(`(c) the buyer paid exactly the asking cash (${c.money})`);
  if (room.own(lone)?.owner !== 'c') fail('(c) the traded street should change hands');
  if (room.turn.debt) fail('(c) a zeroed balance closes the debt');
  if (room.turn.phase !== 'roll') fail(`(e) the doubles re-roll survives the red (got ${room.turn.phase})`);
  // (f) Conservation across the whole lifecycle: the table's total moved by
  // exactly the one bank-minted house refund — nothing else appeared.
  if (a.money + b.money + c.money !== 3500 + R) {
    fail(`(f) the table total drifted (${a.money + b.money + c.money} vs ${3500 + R})`);
  }

  // (d) A windfall bigger than the bill: the creditor gets the bill, the
  // debtor pockets every rupee past it — never a double payment.
  room.turn = { playerId: 'b', phase: 'end', dice: [2, 1], doubles: 0, pending: null, debt: null, rolledThisTurn: true };
  room.charge(b, 100, a, 'for a kiosk');
  room.receive(b, 500);
  if (a.money !== 2900) fail(`(d) the creditor never sees more than the charge (${a.money})`);
  if (b.money !== 400) fail(`(d) the debtor pockets the overshoot (${b.money})`);
  if (room.turn.debt) fail('(d) the closed debt should be gone');
  room.dispose();
  ok('a debt streams every gain to the creditor, to the rupee, and closes itself');
}

{
  // (g) A hopeless debtor: the creditor collects only what actually existed —
  // cash on hand, then what liquidation raises, then the estate. The phantom
  // remainder dies unprinted.
  const room = new GameRoom('ds2', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'Ava' });
  room.addPlayer({ id: 'b', name: 'Bo' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a'), b = room.player('b');
  a.money = 100; b.money = 300;
  const s = room.map.tiles.find((t) => t.type === 'property').index;
  room.ownership[s] = { owner: 'b', houses: 0, mortgaged: false };
  room.turn = { playerId: 'b', phase: 'end', dice: [2, 1], doubles: 0, pending: null, debt: null, rolledThisTurn: true };
  room.charge(b, 5000, a, 'for the whole promenade');
  if (a.money !== 400) fail(`(g) the creditor banks the $300 on hand (${a.money})`);
  const V = Math.floor(room.tile(s).price / 2);
  room.mortgage('b', s);
  if (a.money !== 400 + V) fail(`(g) the mortgage value flows straight through (${a.money})`);
  if (b.money !== -4700 + V) fail(`(g) the balance climbs but stays deep red (${b.money})`);
  room.declareBankrupt('b');
  if (!b.bankrupt) fail('(g) a hopeless debtor goes bankrupt');
  if (b.money !== 0) fail(`(g) the debtor leaves at zero — the remainder never existed (${b.money})`);
  if (a.money !== 400 + V) fail(`(g) the creditor total is what existed, not the $5,000 billed (${a.money})`);
  // The owner's rule: streets never follow the debt — the estate returns to
  // the bank, mortgage cleared, for whoever lands there next.
  if (room.own(s)) fail('(g) the estate returns to the bank, not the creditor');
  if (room.status !== 'ended' || room.winner?.id !== 'a') fail('(g) the two-hander ends for the creditor');
  room.dispose();
  ok('a hopeless debtor pays out only the money that ever existed');
}

{
  // A creditor who leaves forgives the remainder — nobody pays a ghost.
  const room = new GameRoom('ds3', () => {});
  room.map = MAPS.classic;
  ['a', 'b', 'c'].forEach((id) => room.addPlayer({ id, name: id.toUpperCase() }));
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const b = room.player('b');
  b.money = 100;
  room.turn = { playerId: 'b', phase: 'end', dice: [2, 1], doubles: 0, pending: null, debt: null, rolledThisTurn: true };
  room.charge(b, 500, room.player('a'), 'for Main Street');
  if (b.money !== -400) fail(`setup: the debtor should owe $400 (${b.money})`);
  room.removeFromPlay(room.player('a'), 'quit');
  if (b.money !== 0) fail(`a leaving creditor forgives the remainder (${b.money})`);
  if (room.turn?.debt) fail('the forgiven debt should be closed');
  room.dispose();
  ok('a creditor who leaves takes their claim with them');
}

{
  // A payEach debtor who goes bankrupt mid-stream: the recipients keep only
  // the slices that actually landed, and the unpaid remainder dies unprinted.
  // A recipient going bankrupt first is forgiven exactly like a quitter.
  const room = new GameRoom('ds4', () => {});
  room.map = MAPS.classic;
  ['a', 'b', 'c', 'd'].forEach((id) => room.addPlayer({ id, name: id.toUpperCase() }));
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a');
  ['a', 'b', 'c', 'd'].forEach((id) => { room.player(id).money = id === 'a' ? 0 : 2500; });
  room.turn = { playerId: 'a', phase: 'end', dice: [2, 1], doubles: 0, pending: null, debt: null, rolledThisTurn: true };
  room.applyCard(a, { kind: 'payEach', amount: 100 });
  room.receive(a, 90);                          // $30 lands on each of the three
  room.bankrupt(room.player('d'), null);        // d's unpaid $70 is forgiven
  if (a.money !== -140) fail(`a bankrupt recipient is forgiven like a quitter (${a.money})`);
  const bBefore = room.player('b').money, cBefore = room.player('c').money;
  room.declareBankrupt('a');
  if (!a.bankrupt || a.money !== 0) fail(`the debtor leaves at zero (${a.money})`);
  if (room.player('b').money !== bBefore || room.player('c').money !== cBefore) {
    fail('a payEach bankruptcy must not conjure the unpaid remainder');
  }
  if (room.turn?.debt) fail('the debt should leave with the debtor');
  room.dispose();
  ok('a payEach debtor going bankrupt pays out only what landed');
}

{
  // A debt born INSIDE the jail-release walk: the fine debt settles, the
  // stored roll plays out, and the landing's unpayable rent must open a
  // second debt that stands — and then streams like any other.
  const room = new GameRoom('ds5', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'Ava' });
  room.addPlayer({ id: 'b', name: 'Bo' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const a = room.player('a'), b = room.player('b');
  const prison = room.cornerIndex('prison');
  // A street a non-double walk from prison, dressed up with a hotel.
  let s = -1, dice = null;
  for (let k = 3; k <= 11 && s < 0; k++) {
    const d1 = Math.min(6, k - 1), d2 = k - d1;
    if (room.tile(prison + k)?.type === 'property' && d1 !== d2 && d2 >= 1) { s = prison + k; dice = [d1, d2]; }
  }
  if (s < 0) fail('setup: classic should have a street within a walk of prison');
  const t = room.tile(s);
  room.map.groups[t.group].forEach((i) => { room.ownership[i] = { owner: 'b', houses: 0, mortgaged: false }; });
  room.ownership[s].houses = 5;
  const rent = room.rentFor(s);
  a.jail = true; a.jailTurns = 2; a.pos = prison; a.money = 10; b.money = 1000;
  room.turn = { playerId: 'a', phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false };
  room.roll('a', dice);                         // third failed attempt → fine → debt
  if (room.turn.phase !== 'debt' || !room.turn.debt?.jailRelease) fail('setup: the fine should stall with a stored walk');
  room.receive(a, 60);                          // fine paid ($40) + $20 spare → the walk plays
  if (a.jail || a.pos !== s) fail(`the release walk should land on the hotel (at ${a.pos}, wanted ${s})`);
  if (room.turn.phase !== 'debt') fail(`the walk's rent debt must stand (${room.turn.phase})`);
  if (room.turn.debt?.creditor !== 'b') fail('the second debt is owed to the landlord');
  if (a.money !== 20 - rent) fail(`red by exactly the shortfall (${a.money} vs ${20 - rent})`);
  room.receive(a, rent);                        // clears it — landlord gets rent to the rupee
  if (a.money !== 20 || b.money !== 1000 + rent) fail(`the landlord ends on exactly the rent (${b.money - 1000})`);
  if (room.turn.debt) fail('the second debt should close itself');
  room.dispose();
  ok('a debt born inside the jail-release walk stands and streams');
}

{
  // The pro-rata splitter, hammered: every slice lands whole, nobody is paid
  // past what they are owed, and the remainders never go negative.
  const room = new GameRoom('ds6', () => {});
  room.map = MAPS.classic;
  ['a', 'b', 'c', 'd'].forEach((id) => room.addPlayer({ id, name: id.toUpperCase() }));
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  const rec = ['b', 'c', 'd'];
  let bad = 0;
  for (let n = 0; n < 500 && !bad; n++) {
    const owed = rec.map(() => 1 + Math.floor(Math.random() * 997));
    const total = owed.reduce((x, y) => x + y, 0);
    const d = { debtor: 'a', creditor: null, amount: total, reason: 'x', each: 1, owedTo: [...rec], owedLeft: [...owed] };
    const slice = 1 + Math.floor(Math.random() * total);
    const before = rec.map((id) => room.player(id).money);
    room.splitAmongOwed(d, slice);
    const given = rec.reduce((sum, id, i) => sum + room.player(id).money - before[i], 0);
    if (given !== slice) { fail(`split ${slice} of [${owed}] delivered ${given}`); bad++; }
    if (d.owedLeft.some((x) => x < 0)) { fail(`negative remainder splitting ${slice} of [${owed}]`); bad++; }
    if (d.owedLeft.reduce((x, y) => x + y, 0) !== total - slice) { fail(`remainder drift splitting ${slice} of [${owed}]`); bad++; }
    rec.forEach((id, i) => {
      if (room.player(id).money - before[i] > owed[i]) { fail(`recipient overpaid splitting ${slice} of [${owed}]`); bad++; }
    });
  }
  room.dispose();
  if (!bad) ok('the pro-rata split is integer-exact over 500 random slices');
}

console.log('\n▶ rematch');
{
  // Rematch drops the departed instead of resurrecting them as ghosts, and
  // clears the removal flags on everyone who stays.
  const room = new GameRoom('rm', () => {});
  room.map = MAPS.classic;
  ['a', 'b', 'c'].forEach((id) => room.addPlayer({ id, name: id.toUpperCase() }));
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  room.quit('c');                                     // c walks out mid-game
  room.bankrupt(room.player('b'), room.player('a'));  // a wins; b loses honestly
  if (room.status !== 'ended') fail('setup: the game should have ended');
  const res = room.rematch('a');
  if (res?.error) fail(`rematch refused: ${res.error}`);
  if (room.player('c')) fail('a quitter must not be resurrected on rematch');
  const b = room.player('b');
  if (!b) fail('an honest loser keeps their seat for the rematch');
  else if (b.bankrupt || b.timedOut || b.removedFor || b.botControlled) fail('rematch should wipe the removal flags');
  if (room.status !== 'lobby' || room.hostId !== 'a') fail('rematch should reopen the lobby under the presser');
  room.dispose();
  ok('rematch drops the departed and cleans the survivors');
}

console.log('\n▶ a seat somebody walked away from');
{
  // A player alone with the bots they added themselves has nobody waiting on
  // them, so nothing should ever take their game away — half a minute of a
  // locked screen used to cost them the lot.
  const room = new GameRoom('solo', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'solo', name: 'Solo' });
  room.addBot();
  room.hostId = 'solo';
  room.settings.randomizeOrder = false;
  room.start('solo');
  room.removePlayer('solo');
  const seat = room.awaiting?.solo;
  if (!seat) fail('a dropped player should still have their seat held');
  else if (seat.until) fail('with nobody else at the table there should be no deadline at all');
  if (room.timers['grace:solo']) fail('and no timer counting down to taking the seat away');
  room.seatRanOut('solo');           // the old path, called outright
  const p = room.player('solo');
  if (!p || p.bankrupt || p.timedOut) fail('the seat must survive');
  room.dispose();
  ok('alone with your own bots, a dropped connection costs nothing');
}
{
  // With somebody actually waiting, the clock still runs — and it is now long
  // enough to survive a tunnel rather than a sneeze.
  const room = new GameRoom('pair', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'a', name: 'Ana' });
  room.addPlayer({ id: 'b', name: 'Bo' });
  room.hostId = 'a';
  room.settings.randomizeOrder = false;
  room.start('a');
  room.removePlayer('b');
  const seat = room.awaiting?.b;
  if (!seat?.until) fail('a table with someone left waiting still needs a deadline');
  else {
    const left = seat.until - Date.now();
    if (left < 150000) fail(`the grace is back to a sneeze: ${Math.round(left / 1000)}s`);
  }
  // …and the table holds still rather than playing itself out to an empty room.
  room.removePlayer('a');
  if (room.watched) fail('nobody is here, so nothing should count as watching');
  room.dispose();
  ok('with someone waiting the clock runs, and an empty table stops playing');
}

console.log('\n▶ identity aliasing');
{
  // The player id is the wallet key on the HTTP API, so the state a viewer
  // gets must never carry anyone else's real token — every other id is a
  // stable, ordinary-looking alias, in every field it appears in.
  const room = new GameRoom('leak', () => {});
  room.map = MAPS.classic;
  const tokA = 'secret-token-aaaa';
  const tokB = 'secret-token-bbbb';
  room.addPlayer({ id: tokA, name: 'Ava' });
  room.addPlayer({ id: tokB, name: 'Bo' });
  room.addBot();
  room.hostId = tokA;
  room.settings.randomizeOrder = false;
  room.start(tokA);
  room.ownership[1] = { owner: tokB, houses: 0, mortgaged: false };
  const offer = room.proposeTrade(tokA, { to: tokB, give: { money: 10 }, get: {} });
  room.setTradeViewing(tokB, offer.trade.id, true);
  room.removePlayer(tokB); // opens an awaiting seat that carries B's id

  const viewA = room.serializeFor([tokA]);
  const viewB = room.serializeFor([tokB]);
  const spect = room.serializeFor([]);
  const jsonA = JSON.stringify(viewA);
  const jsonB = JSON.stringify(viewB);
  if (!jsonA.includes(tokA)) fail('a viewer must still find their own token in their state');
  if (jsonA.includes(tokB)) fail("another player's token leaked into A's state");
  if (jsonB.includes(tokA)) fail("another player's token leaked into B's state");
  if (!jsonB.includes(tokB)) fail('B must still find their own token');
  const spectJson = JSON.stringify(spect);
  if (spectJson.includes(tokA) || spectJson.includes(tokB)) fail('a spectator must see only aliases');

  // One alias per player, worn consistently across every field.
  const aliasB = viewA.players.find((p) => p.name === 'Bo').id;
  if (!/^u_[a-z0-9]+$/.test(aliasB)) fail(`an alias should look like an ordinary guest id, got ${aliasB}`);
  if (viewA.ownership[1].owner !== aliasB) fail('ownership should wear the same alias as the roster');
  if (viewA.trades[0].to !== aliasB) fail('trades should wear the alias');
  if (viewA.awaiting[0]?.id !== aliasB) fail('the awaiting seat should wear the alias');
  if (viewA.hostId !== tokA) fail("the host sees their own id on the host chair");
  if (viewB.hostId !== viewB.players.find((p) => p.name === 'Ava').id) {
    fail('hostId should match the aliased roster entry for other viewers');
  }
  if (viewA.turn.playerId !== tokA) fail("A's own turn id should stay real for A");
  if (viewB.turn.playerId === tokA) fail('the turn id must be aliased for the other viewer');

  // Stable across pushes (and the deterministic hash survives reconnects).
  room.push();
  room.push();
  if (room.serializeFor([tokA]).players.find((p) => p.name === 'Bo').id !== aliasB) {
    fail('aliases must be stable across pushes');
  }

  // Bots keep their ids — clients sniff the bot: prefix.
  const botId = room.players.find((p) => p.isBot).id;
  if (!viewA.players.some((p) => p.id === botId)) fail('bot ids must pass through untouched');

  // Inbound: an alias resolves back to the token; a real token passes through.
  if (room.resolveId(aliasB) !== tokB) fail('resolveId should translate an alias to its token');
  if (room.resolveId(tokB) !== tokB) fail('resolveId must accept a real token unchanged');

  // An aliased trade round-trips: A proposes to B by B's alias, B accepts.
  const before = room.player(tokB).money;
  const res = room.proposeTrade(tokA, { to: room.resolveId(aliasB), give: { money: 50 }, get: {} });
  if (res.error) fail(`aliased trade refused: ${res.error}`);
  else {
    room.respondTrade(tokB, res.trade.id, true);
    if (room.player(tokB).money !== before + 50) fail('the aliased trade never moved the money');
  }

  // The end-of-game reveal (winner, history, stats, titles) is aliased too.
  room.bankrupt(room.player(tokB), room.player(tokA));
  room.bankrupt(room.players.find((p) => p.isBot), room.player(tokA));
  if (room.status !== 'ended') fail('setup: the game should have ended');
  const endA = room.serializeFor([tokA]);
  if (JSON.stringify(endA).includes(tokB)) fail('the end-of-game reveal leaked a token');
  if (!endA.stats || !(tokA in endA.stats)) fail("A's own stats key should stay real");
  if (endA.winner.id !== tokA) fail('the winner id should stay real for the winner');
  const endB = room.serializeFor([tokB]);
  if (JSON.stringify(endB).includes(tokA)) fail('the ended state leaked the winner\'s token');
  room.dispose();
  ok('tokens stay private: own ids real, everyone else stable aliases');
}

{
  // Pass & play: guest seats (`token_pN`) ride separate sockets but share a
  // screen — the whole family stays real for any of its sockets.
  const room = new GameRoom('fam', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'tok-main', name: 'Main' });
  room.addPlayer({ id: 'tok-main_p2', name: 'Guest' });
  room.addPlayer({ id: 'tok-rival', name: 'Rival' });
  const view = room.serializeFor(['tok-main']);
  if (!view.players.some((p) => p.id === 'tok-main_p2')) fail('a pass & play guest seat must stay real on the main socket');
  const guestView = room.serializeFor(['tok-main_p2']);
  if (!guestView.players.some((p) => p.id === 'tok-main')) fail('the base seat must stay real on a guest socket');
  if (guestView.players.some((p) => p.id === 'tok-rival')) fail('a rival token must still be aliased for the family');
  room.dispose();
  ok('a pass & play family sees itself, and only itself, unmasked');
}

console.log('\n▶ state deltas');

// Key order is nobody's promise, and JSON drops an undefined on the way out,
// so "the same state" is judged canonically here rather than by stringify.
const canon = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  const ks = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${ks.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
};

// An independent deep comparison for the hot path, deliberately not
// delta.js's own equal() — that is the thing under test. Identical references
// are identical values, which is what makes checking every push affordable:
// the branches a patch never touched are shared, not copied.
const same = (a, b) => {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same(a[k], b[k]));
};

// The keys index.js lets ride by reference — module constants and the two
// write-once feeds. Everything else gets frozen before it is diffed against.
const SHARED = new Set(['map', 'groups', 'teamInfo', 'log', 'chat']);

/** The per-viewer cut a socket actually receives, team-chat filter and all. */
const viewOf = (room, held, base) => {
  const s = room.serializeFor(held, base);
  if (!s.chat.some((m) => m.channel === 'team')) return s;
  const teams = new Set();
  for (const id of held) {
    const t = room.player(id)?.team;
    if (t != null) teams.add(t);
  }
  return { ...s, chat: s.chat.filter((m) => m.channel !== 'team' || teams.has(m.team)) };
};

{
  const trip = (label, prev, next) => {
    const patch = diff(prev, next);
    if (canon(applyPatch(prev, patch)) !== canon(next)) fail(`delta: ${label} lost something on the round trip`);
    return patch;
  };

  trip('a scalar moves', { money: 1500 }, { money: 1300 });
  trip('a nested object', { turn: { phase: 'roll', dice: null } }, { turn: { phase: 'action', dice: [3, 4] } });
  trip('a key vanishes', { turn: { a: 1, b: 2 } }, { turn: { a: 1 } });
  trip('a key arrives', { turn: { a: 1 } }, { turn: { a: 1, b: 2 } });
  trip('an object becomes null', { turn: { phase: 'end' } }, { turn: null });
  trip('null becomes an object', { auction: null }, { auction: { tile: 5, bid: 10, inRace: ['a'] } });
  trip('an array is replaced whole', { order: [1, 2, 3] }, { order: [3, 2, 1] });
  trip('an array empties', { trades: [{ id: 'a' }] }, { trades: [] });
  trip('an array of objects grows', { moves: [] }, { moves: [{ playerId: 'a', to: 3 }] });
  trip('an object becomes an array', { x: { 0: 'a' } }, { x: ['a'] });
  trip('a number becomes a string', { v: 1 }, { v: '1' });
  trip('a map key is deleted', { ownership: { 1: { o: 'a' }, 5: { o: 'b' } } }, { ownership: { 5: { o: 'b' } } });
  trip('a map key is added', { ownership: {} }, { ownership: { 3: { o: 'a', houses: 0 } } });
  trip('undefined counts as absent', { a: 1, b: undefined }, { a: 1 });
  trip('going undefined is going away', { a: 1, b: 2 }, { a: 1, b: undefined });
  trip('deep nesting', { a: { b: { c: { d: 1 } } } }, { a: { b: { c: { d: 2 } } } });
  trip('the root is replaced', { a: 1 }, null);
  trip('the root arrives', null, { a: 1 });
  trip('an empty object', {}, {});

  if (diff({ a: 1, b: [1, 2, { c: 3 }] }, { a: 1, b: [1, 2, { c: 3 }] })) {
    fail('delta: a state that did not move should produce no patch at all');
  }
  const dropped = diff({ a: 1, b: 2 }, { a: 1 });
  if (!dropped?.d?.includes('b')) fail('delta: a deletion has to be spelled out in the patch');
  const gone = diff({ a: 1, b: 2 }, { a: 1, b: undefined });
  if (!gone?.d?.includes('b')) fail('delta: a key going undefined has to read as a deletion');

  // The whole point: the furniture must not be in the envelope. One coin
  // moving on a state carrying a board should cost a few dozen bytes, not
  // the board again.
  const board = { tiles: Array.from({ length: 40 }, (_, i) => ({ i, name: `Tile ${i}`, rent: [1, 2, 3, 4, 5, 6] })) };
  const before = { map: board, groups: { a: [1, 2] }, players: [{ id: 'p', money: 1500 }] };
  const after = { ...before, players: [{ id: 'p', money: 1300 }] };
  const small = JSON.stringify(diff(before, after)).length;
  if (small > 80) fail(`delta: a one-field change dragged ${small} bytes along with it`);
  if (JSON.stringify(before).length < 1000) fail('setup: that board was meant to be bulky');

  ok(`round trips hold across 19 shapes, and a coin moving costs ${small} bytes on a ${JSON.stringify(before).length}-byte state`);
}

{
  // The freeze earns its keep here. The room edits its own settings object in
  // place, so a remembered state that shared the reference would show the new
  // value on both sides of the diff — and the change would never ship.
  const room = new GameRoom('freeze', () => {});
  room.map = MAPS.classic;
  room.addPlayer({ id: 'host-token', name: 'H' });
  room.hostId = 'host-token';
  const live = room.serialize();
  const frozen = snapshot(room.serialize(), SHARED);
  room.updateSettings('host-token', { startingCash: 999 });
  if (live.settings.startingCash !== 999) fail('delta: settings were meant to be shared by reference');
  if (frozen.settings.startingCash === 999) fail('delta: the frozen base followed the room into the future');
  if (diff(frozen, snapshot(room.serialize(), SHARED))?.p?.settings?.s?.startingCash !== 999) {
    fail('delta: an in-place settings edit never reached a patch');
  }

  // The board rides by reference because it never changes — except when it
  // does, and then it has to show.
  const ids = Object.keys(MAPS);
  const beforeMap = snapshot(room.serialize(), SHARED);
  if (diff(beforeMap, snapshot(room.serialize(), SHARED))) fail('delta: a still room should produce no patch');
  room.map = MAPS[ids[0]] === room.map ? MAPS[ids[1]] : MAPS[ids[0]];
  if (!diff(beforeMap, snapshot(room.serialize(), SHARED))?.p?.map) fail('delta: swapping boards must still show up');
  room.dispose();

  // The group table rides by reference too, which only holds while it is
  // finished being written at import time — generating boards must not add to it.
  const groupsBefore = Object.keys(GROUPS).length;
  for (let i = 0; i < 5; i++) generateRandomMap();
  if (Object.keys(GROUPS).length !== groupsBefore) {
    fail('delta: the group table grew after load — it can no longer ride by reference');
  }
  ok('the frozen base catches in-place edits, and shares only what truly never moves');
}

{
  // Now the real thing: a full game, every push, three viewpoints — two
  // seats and a spectator — with the client half rebuilt from patches alone
  // and checked against the state a full push would have delivered.
  const seen = {
    turnNull: 0, auctionEnd: 0, bankrupt: 0, tradeOpen: 0, tradeClear: 0,
    tileFreed: 0, reveal: 0, logTail: 0, chatTail: 0, resync: 0, trimmed: 0,
  };
  let fullBytes = 0; let patchBytes = 0; let pushes = 0; let patches = 0; let fulls = 0;

  const makeViewer = (name, held) => ({ name, held, server: null, client: null, cv: -1 });

  // Tally the awkward moments, so a green run can prove it saw them. Only
  // the first viewpoint counts, or every moment would be counted three times.
  let watched = null;
  const note = (v, state, patch) => {
    if (v !== watched) return;
    if (state.turn === null) seen.turnNull++;
    if (patch?.s && 'auction' in patch.s && patch.s.auction === null) seen.auctionEnd++;
    if (patch?.p?.ownership?.d?.length) seen.tileFreed++;
    if (state.players.some((p) => p.bankrupt)) seen.bankrupt++;
    if (patch?.s?.trades?.length) seen.tradeOpen++;
    if (patch?.s?.trades && patch.s.trades.length === 0) seen.tradeClear++;
    if (state.history.length) seen.reveal++;
  };

  function deliver(room, viewers) {
    watched ??= viewers[0];
    pushes++;
    const base = snapshot(room.serialize(), SHARED);
    for (const v of viewers) {
      const state = viewOf(room, v.held, base);
      // What today costs: the whole state, to every viewer, every push.
      fullBytes += JSON.stringify(state).length;
      const { log, chat, ...lean } = state;
      const wholeThing = (why) => {
        patchBytes += JSON.stringify(state).length;
        fulls++;
        if (why) seen.resync++;
        v.client = { lean, log: log.slice(), chat: chat.slice() };
        v.cv = state.version;
        v.server = { lean, log, chat, v: state.version };
      };
      if (!v.server) { wholeThing(false); note(v, state, null); continue; }

      const logTail = feedTail(v.server.log, log, 'at');
      const chatTail = feedTail(v.server.chat, chat, 'id');
      if (logTail === RESYNC || chatTail === RESYNC) { wholeThing(true); note(v, state, null); continue; }
      const patch = diff(v.server.lean, lean);
      if (!patch && !logTail && !chatTail) continue;
      const msg = { v: state.version, from: v.server.v };
      if (patch) msg.patch = patch;
      if (logTail) msg.log = logTail;
      if (chatTail) msg.chat = chatTail;
      patchBytes += JSON.stringify(msg).length;
      patches++;
      v.server = { lean, log, chat, v: state.version };

      // ---- and now the client, which has only ever seen patches ----
      if (msg.from !== v.cv) fail(`delta: ${v.name} got a patch off v${msg.from} while holding v${v.cv}`);
      for (const [feed, key] of [['log', 'at'], ['chat', 'id']]) {
        const tail = msg[feed];
        if (!tail) continue;
        const held = v.client[feed];
        const last = held.length ? held[held.length - 1][key] : null;
        if (last !== tail.after) fail(`delta: ${v.name}'s ${feed} anchor did not match (${last} vs ${tail.after})`);
        if (tail.keep > held.length) fail(`delta: ${v.name} was told to keep more ${feed} than it holds`);
        if (tail.keep < held.length) seen.trimmed++;
        seen[feed === 'log' ? 'logTail' : 'chatTail']++;
      }
      v.client = {
        lean: msg.patch ? applyPatch(v.client.lean, msg.patch) : v.client.lean,
        log: applyFeed(v.client.log, msg.log),
        chat: applyFeed(v.client.chat, msg.chat),
      };
      v.cv = msg.v;

      const rebuilt = { ...v.client.lean, log: v.client.log, chat: v.client.chat };
      if (!same(rebuilt, state)) fail(`delta: ${v.name}'s patched state drifted from the real one`);
      if (v.cv !== state.version) fail(`delta: ${v.name} landed on version ${v.cv}, not ${state.version}`);

      note(v, state, patch);
    }
  }

  const room = new GameRoom('delta', () => {});
  room.scheduleBot = () => {};
  room.maybeBot = () => {};
  room.maybeBotAuction = () => {};
  room.armAuctionTimer = () => {};
  const pending = [];
  room.scheduleBotTrade = (id) => pending.push(id);
  room.map = MAPS.classic;
  room.settings.randomizeOrder = false;
  const tokens = ['tok-alpha-secret', 'tok-beta-secret'];
  tokens.forEach((t, i) => room.addPlayer({ id: t, name: `P${i + 1}` }));
  room.addBot();
  room.addBot();
  room.hostId = tokens[0];
  // Real tokens, played by the house: the aliasing is the part that makes a
  // per-viewer diff necessary, so the game has to run over ids worth hiding.
  const autopilot = () => room.players.forEach((p) => { if (!p.isBot) p.botControlled = true; });
  autopilot();

  const viewers = [
    makeViewer('alpha', new Set([tokens[0]])),
    makeViewer('beta', new Set([tokens[1]])),
    makeViewer('the spectator', new Set()),
  ];
  room.onUpdate = () => deliver(room, viewers);

  const step = () => {
    room.runBot();
    if (room.auction) room.runBotAuction();
    while (pending.length) room.botTradeReply(pending.shift());
  };
  const started = room.start(room.hostId);
  if (started?.error) fail(`delta: could not start (${started.error})`);

  // Three moments too important to leave to the dice: an auction opening and
  // closing, a trade appearing and clearing, and a deed on each seat so the
  // eliminations to come are certain to take keys back out of the ownership
  // map — the deletion a patch has to be able to say out loud.
  const streets = room.map.tiles.reduce((acc, t, i) => (t.type === 'property' ? acc.concat(i) : acc), []);
  tokens.forEach((t, i) => { room.ownership[streets[i]] = { owner: t, houses: 0, mortgaged: false }; });
  room.push();
  room.startAuction(streets[2]);
  for (let i = 0; i < 60 && room.auction; i++) room.runBotAuction();
  if (room.auction) room.finishAuction();
  const offer = room.proposeTrade(tokens[0], { to: tokens[1], give: { money: 25 }, get: {} });
  if (offer?.error) fail(`delta: could not stage a trade (${offer.error})`);
  else room.respondTrade(tokens[1], offer.trade.id, false);
  let steps = 0;
  while (room.status === 'playing' && steps++ < 4000) {
    step();
    // A little table talk, so the chat feed slides under the diff too.
    if (steps % 12 === 0 && room.active.length) {
      room.sendChat(room.active[steps % room.active.length].id, `steady on, step ${steps}`, 'all');
    }
  }
  // Not every table converges inside four thousand steps, and the reveal and
  // the rematch still have to be watched go past. Call it.
  while (room.status === 'playing' && room.active.length > 1) {
    room.bankrupt(room.active[room.active.length - 1], room.active[0]);
  }
  if (room.status !== 'ended') fail('delta: the game never reached an ending');

  // Back to the lobby: the turn goes null, the reveal falls away, and the
  // whole shape of the state changes under the diff.
  // The presser has to be a seat, not a house player — and a rematch wipes
  // the log, which is exactly the gap a viewer cannot patch across.
  const presser = room.player(tokens[0]) ? tokens[0] : room.players.find((p) => !p.isBot)?.id;
  const again = room.rematch(presser);
  if (again?.error) fail(`delta: rematch refused (${again.error})`);
  autopilot();
  room.start(room.hostId);
  for (let i = 0; i < 200 && room.status === 'playing'; i++) step();
  room.dispose();

  const missing = Object.entries(seen).filter(([, n]) => !n).map(([k]) => k);
  if (missing.length) fail(`delta: the run never exercised ${missing.join(', ')}`);
  const ratio = fullBytes / patchBytes;
  ok(`${pushes} pushes × ${viewers.length} viewers: ${patches} patches, ${fulls} full states, every one rebuilt exactly`);
  ok(`saw turn→null, an auction closing, a bankruptcy, tiles freed, trades opening and clearing, and the reveal`);
  ok(`${(fullBytes / 1024 / 1024).toFixed(2)} MB of full pushes became ${(patchBytes / 1024 / 1024).toFixed(2)} MB — ${ratio.toFixed(1)}× smaller`);
  if (ratio < 5) fail(`delta: only ${ratio.toFixed(1)}× smaller — the diff is not earning its keep`);
}

{
  // Team chat is cut per viewer, so the tail has to be too: what a client
  // stitches together must match the array a full state would have handed
  // that viewer, not the room's own longer window.
  const room = new GameRoom('teamchat', () => {});
  room.map = MAPS.classic;
  room.settings.teams = 2;
  room.settings.randomizeOrder = false;
  const ids = ['t-a', 't-b', 't-c', 't-d'];
  ids.forEach((id, i) => { room.addPlayer({ id, name: id.toUpperCase() }); room.setTeam(id, i % 2); });
  room.hostId = 't-a';
  room.start('t-a');

  const viewers = [new Set(['t-a']), new Set(['t-b']), new Set()].map((held) => ({ held, server: null, client: null }));
  let checked = 0; let trimmed = 0;
  const deliver = () => {
    const base = snapshot(room.serialize(), SHARED);
    for (const v of viewers) {
      const state = viewOf(room, v.held, base);
      if (!v.server) { v.server = state.chat; v.client = state.chat.slice(); continue; }
      const tail = feedTail(v.server, state.chat, 'id');
      if (tail === RESYNC) { v.server = state.chat; v.client = state.chat.slice(); continue; }
      if (tail) {
        if (tail.keep < v.client.length) trimmed++;
        v.client = applyFeed(v.client, tail);
      }
      v.server = state.chat;
      if (canon(v.client) !== canon(state.chat)) fail('delta: a filtered chat tail did not rebuild the viewer\'s own window');
      checked++;
    }
  };
  deliver();
  // Well past the 50-line window the wire carries, so it slides properly.
  for (let i = 0; i < 90; i++) {
    const who = ids[i % ids.length];
    room.sendChat(who, `line ${i}`, i % 3 === 0 ? 'team' : 'all');
    deliver();
  }
  room.dispose();
  if (!trimmed) fail('delta: the chat window never slid, so the keep count went untested');
  ok(`${checked} filtered chat tails rebuilt their viewer's window exactly, window sliding included`);
}

console.log(failures ? `\n✗ ${failures} problem(s) found\n` : '\n✓ all checks passed\n');
process.exit(failures ? 1 : 0);
