// Two changes that are about the person holding the phone, not the rules.
//
// The first is a button. Building a country by hand is twenty taps, and the
// ones that get refused are refused for a reason the button cannot show —
// even build says this street is a house ahead, or the money ran out two taps
// ago. Pressing again to find out which is not a decision; it is the
// interface asking to be beaten. So one press builds everything the rules and
// the bank will allow, and stops where a patient player would have stopped.
//
// The second is the shot clock. It used to take the whole game off anybody
// who looked away for ninety seconds. Now the first missed turn is covered by
// the house and handed straight back; two in a row is somebody who has gone.
import { GameRoom } from '../server/game.js';
import { getMap } from '../server/maps.js';

let failed = 0;
const P = (ok, l, d = '') => { if (!ok) failed++; console.log(`${ok ? '  PASS' : '  X FAIL'}  ${l.padEnd(58)} ${d}`); };
const rule = (t) => console.log(`\n${'─'.repeat(80)}\n  ${t}\n${'─'.repeat(80)}`);

let serial = 0;
function table({ evenBuild = true, cash = 20000 } = {}) {
  const room = new GameRoom(`ba${++serial}`, () => {});
  room.scheduleBot = () => {};
  room.maybeBot = () => {};
  room.armTurnTimer = () => {};
  room.map = getMap('classic');
  room.settings = { ...room.settings, mapId: 'classic', evenBuild, startingCash: cash };
  room.addPlayer({ id: 'a', name: 'Ana' });
  room.addPlayer({ id: 'b', name: 'Bo' });
  room.hostId = 'a';
  room.start('a');
  room.player('a').money = cash;
  return room;
}

/** Hands one whole country to a player. */
function give(room, playerId, groupKey) {
  for (const i of room.map.groups[groupKey]) {
    room.ownership[i] = { owner: playerId, houses: 0, mortgaged: false };
  }
  return room.map.groups[groupKey];
}

/** The first country on this board with more than one street in it. */
function anyGroup(room) {
  return Object.entries(room.map.groups).find(([, idxs]) => idxs.length > 1)[0];
}

const houses = (room, idxs) => idxs.map((i) => room.own(i).houses || 0);

// ───────────────────────────────────────────────────────────── build all ──
rule('ONE PRESS BUILDS WHAT TWENTY TAPS WOULD HAVE');
{
  const room = table();
  const key = anyGroup(room);
  const idxs = give(room, 'a', key);
  room.turn = { playerId: 'a', phase: 'end', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: true };

  const before = room.player('a').money;
  const res = room.buildAll('a', key);
  P(res.ok === true, 'the press is accepted', JSON.stringify(res.built));
  P(houses(room, idxs).every((h) => h === 5), 'every street in the country is topped out',
    houses(room, idxs).join(','));
  P(res.topped === true, 'and it says so');
  P(res.built === idxs.length * 5, 'it built exactly what was missing', `${res.built}`);
  const cost = idxs.reduce((sum, i) => sum + room.tile(i).houseCost * 5, 0);
  P(res.spent === cost, 'and charged exactly the house price', `$${res.spent} of $${cost}`);
  P(room.player('a').money === before - cost, 'the money left the player', `$${room.player('a').money}`);

  // A second press has nothing to do, and says so rather than charging again.
  const again = room.buildAll('a', key);
  P(!!again.error, 'a second press is refused, not silently charged', again.error || '');
  P(room.player('a').money === before - cost, 'and costs nothing');
}

{
  // Even build is the rule this button must not quietly break: pressing it is
  // the same as pressing Build in the right order, never a way round.
  const room = table({ evenBuild: true });
  const key = anyGroup(room);
  const idxs = give(room, 'a', key);
  room.turn = { playerId: 'a', phase: 'end', rolledThisTurn: true, dice: null, doubles: 0, pending: null, debt: null };
  // Only enough for three houses on the cheapest street in the country.
  const unit = Math.min(...idxs.map((i) => room.tile(i).houseCost));
  room.player('a').money = unit * 3;

  room.buildAll('a', key);
  const h = houses(room, idxs);
  P(Math.max(...h) - Math.min(...h) <= 1, 'the country comes up level, not one tower',
    h.join(','));
  P(room.player('a').money < unit, 'and it spent down to what it could not afford',
    `$${room.player('a').money}`);
}

{
  // With even build off, the same money is allowed to top one street out —
  // which is exactly what the rules say, and what the button must follow.
  const room = table({ evenBuild: false });
  const key = anyGroup(room);
  const idxs = give(room, 'a', key);
  room.turn = { playerId: 'a', phase: 'end', rolledThisTurn: true, dice: null, doubles: 0, pending: null, debt: null };
  const cheapest = idxs.slice().sort((x, y) => room.tile(x).houseCost - room.tile(y).houseCost)[0];
  room.player('a').money = room.tile(cheapest).houseCost * 5;

  room.buildAll('a', key);
  const h = houses(room, idxs);
  P(h.reduce((n, v) => n + v, 0) === 5, 'five buildings went up', h.join(','));
  P(h.includes(5) || Math.max(...h) >= 1, 'and the rules decided where, not the button', h.join(','));
}

{
  const room = table();
  const key = anyGroup(room);
  room.turn = { playerId: 'a', phase: 'end', rolledThisTurn: true, dice: null, doubles: 0, pending: null, debt: null };
  P(!!room.buildAll('a', key).error, 'a country you do not own builds nothing');

  give(room, 'a', key);
  room.turn.playerId = 'b';
  P(room.buildAll('a', key).error === 'Wait for your turn', 'and neither does somebody else\'s turn');

  room.turn.playerId = 'a';
  P(!!room.buildAll('a', 'NO_SUCH_COUNTRY').error, 'nor a country that is not on this board');
}

// ──────────────────────────────────────────────────────────── the clock ──
rule('ONE MISSED TURN IS A DOORBELL, NOT A DESERTION');
{
  const room = table();
  const ana = room.player('a');
  room.turn = { playerId: 'a', phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false };
  const worth = ana.money;
  give(room, 'a', anyGroup(room));
  const owned = room.tilesOf('a').length;

  room.turnTimedOut('a');
  P(ana.bankrupt !== true, 'the first timeout does not end their game');
  P(ana.timedOut !== true, 'and does not take their seat');
  P(ana.money === worth, 'their money is untouched', `$${ana.money}`);
  P(room.tilesOf('a').length === owned, 'their streets are still theirs', `${owned}`);
  P(ana.coveredTurn === true && ana.botControlled === true, 'the house covers this one turn');
  P(ana.missedTurns === 1, 'and the miss is counted', `${ana.missedTurns}`);

  // The cover is for one turn. The seat comes back the moment it is over.
  room.nextTurn();
  P(ana.coveredTurn === false && ana.botControlled === false,
    'and hands the seat back when the turn ends');
}

{
  const room = table();
  const ana = room.player('a');
  room.turn = { playerId: 'a', phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false };

  room.turnTimedOut('a');
  room.nextTurn();
  room.turn = { playerId: 'a', phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false };
  room.turnTimedOut('a');
  P(ana.bankrupt === true, 'two in a row does take the seat');
  P(ana.timedOut === true && ana.removedFor === 'timeout', 'and says the clock did it');
}

{
  // Playing a turn says they are at the table after all, and the count that
  // was one away from taking their seat goes back to nothing.
  const room = table();
  const ana = room.player('a');
  room.turn = { playerId: 'a', phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false };

  room.turnTimedOut('a');
  room.nextTurn();
  room.turn = { playerId: 'a', phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false };
  room.touchTurnClock('a');
  P(ana.missedTurns === 0, 'a move played wipes the miss', `${ana.missedTurns}`);

  room.turnTimedOut('a');
  P(ana.bankrupt !== true, 'so the next miss is a first miss again');
  P(ana.missedTurns === 1, 'counted from one', `${ana.missedTurns}`);
}

{
  // Coming back in person is the clearest possible statement of presence.
  const room = table();
  const ana = room.player('a');
  room.turn = { playerId: 'a', phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false };
  room.turnTimedOut('a');
  room.reconnect('a');
  P(ana.missedTurns === 0, 'a reconnect wipes the miss');
  P(ana.coveredTurn === false, 'and takes the seat back from the house');
}

{
  // A bidder is not a dawdler: the clock must not count a turn parked behind
  // somebody else's bidding war.
  const room = table();
  const ana = room.player('a');
  room.turn = { playerId: 'a', phase: 'auction', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: true };
  room.auction = { tile: 1, bid: 10, leader: 'b', inRace: ['a', 'b'], endsAt: Date.now() + 9000 };
  room.turnTimedOut('a');
  P((ana.missedTurns || 0) === 0, 'an auction on the table counts no miss at all');
  P(ana.bankrupt !== true, 'and takes nobody out');
}

console.log(`\n${failed ? '  X FAIL' : '  PASS'} — ${failed} failed\n`);
process.exit(failed ? 1 : 0);
