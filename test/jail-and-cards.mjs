// Three rules that are only ever seen, never read: the price of the prison
// door, the order a drawn card happens in, and the colour it arrives wearing.
//
// The first is a rule change with a cost attached — the $50 fine used to open
// the cell *and* hand back a full turn, which made prison a toll on a bad
// landing rather than a place anybody gets stuck. It now buys the door alone.
//
// The second and third are the client's, but they live or die on what the
// server hands it: an ordered chain of legs it can replay one at a time, and
// a tone on the card so green and red are decided once, on the server, rather
// than guessed at from the card's wording in three different clients.
import { GameRoom } from '../server/game.js';
import { getMap } from '../server/maps.js';
import { buildDecks, cardTone } from '../server/cards.js';

let failed = 0;
const P = (ok, l, d = '') => { if (!ok) failed++; console.log(`${ok ? '  PASS' : '  X FAIL'}  ${l.padEnd(58)} ${d}`); };
const rule = (t) => console.log(`\n${'─'.repeat(80)}\n  ${t}\n${'─'.repeat(80)}`);

let serial = 0;
/** A quiet two-seat table: no timers, no bots taking their own turns. */
function table(mapId = 'classic') {
  const room = new GameRoom(`jc${++serial}`, () => {});
  room.scheduleBot = () => {};
  room.maybeBot = () => {};
  room.armTurnTimer = () => {};
  room.map = getMap(mapId);
  // Seated in order: every rule below is written from Ana's turn, and a
  // shuffled start handed Bo the dice half the time, which refused Ana's roll
  // and left the journey check reading legs that were never walked.
  room.settings = { ...room.settings, mapId, randomizeOrder: false };
  room.addPlayer({ id: 'a', name: 'Ana' });
  room.addPlayer({ id: 'b', name: 'Bo' });
  room.hostId = 'a';
  room.start('a');
  return room;
}

// ───────────────────────────────────────────────────────────── the fine ──
rule('THE FINE BUYS THE DOOR, NOT THE DICE');
{
  const room = table();
  const ana = room.player('a');
  room.sendToJail(ana);
  room.turn = { playerId: 'a', phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false };
  const before = ana.money;
  const pos = ana.pos;

  const res = room.jailPay('a');
  P(res.ok === true, 'paying the fine is accepted');
  P(ana.money === before - 50, 'it costs exactly $50', `${before} → ${ana.money}`);
  P(ana.jail === false, 'the cell opens');
  P(ana.pos === pos, 'and the piece has not moved', `tile ${ana.pos}`);
  P(room.turn.playerId === 'b', 'the turn passes — no roll this turn', `now ${room.turn.playerId}`);

  // The rule is worth nothing if the cell can still be bought out twice, or
  // if the door reopens on somebody else's turn.
  P(room.jailPay('a').error === 'Not your turn', 'and cannot be paid again out of turn');
}

{
  const room = table();
  const ana = room.player('a');
  room.sendToJail(ana);
  room.turn = { playerId: 'a', phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false };
  ana.money = 40;
  const res = room.jailPay('a');
  P(res.error === 'Not enough money', 'a player who cannot afford it is refused');
  P(ana.jail === true, 'and stays in the cell');
  P(room.turn.playerId === 'a', 'and keeps their turn', `now ${room.turn.playerId}`);
}

{
  // The get-out card is the other half of the choice and is deliberately not
  // touched: it frees *and* rolls, which is what makes it worth keeping.
  const room = table();
  const ana = room.player('a');
  room.sendToJail(ana);
  ana.getOutCards = 1;
  room.turn = { playerId: 'a', phase: 'roll', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: false };
  const money = ana.money;
  room.jailCard('a');
  P(ana.jail === false, 'the card opens the cell');
  P(ana.money === money, 'and costs nothing');
  P(room.turn.playerId === 'a' && room.turn.phase === 'roll', 'and the turn is still theirs to roll');
}

// ────────────────────────────────────────────────────────── the journey ──
rule('A JOURNEY ARRIVES AS ORDERED LEGS, NOT AS A DESTINATION');
{
  const room = table();
  const ana = room.player('a');

  // A roll onto a Surprise that then walks the player somewhere else is the
  // case the client used to get wrong: one push, two legs, and only the
  // second of them survived — so on a card that undoes the roll exactly, the
  // piece never moved at all while the card had already been read out.
  const surprise = room.map.tiles.find((t) => t.type === 'surprise');
  ana.pos = (surprise.index - 6 + room.map.size) % room.map.size;
  room.turn.phase = 'roll';
  room.actionMoves = [];
  room.drawCard = function (p, deckName) {
    this.lastCard = { deck: deckName, text: 'Go back 10 steps.', tone: 'bad', playerId: p.id, at: Date.now() };
    this.movePlayer(p, -10, { collectSalary: false, cause: 'card' });
  };
  room.roll('a', [3, 3]);

  const legs = room.actionMoves;
  P(legs.length >= 2, 'both legs are on the state', `${legs.length} legs`);
  P(legs.every((m) => Number.isInteger(m.seq)), 'every leg is numbered');
  P(legs.every((m, i) => i === 0 || m.seq > legs[i - 1].seq), 'and the numbers only go up',
    legs.map((m) => m.seq).join(','));
  P(legs[0].to === surprise.index, 'the first leg lands on the Surprise', `tile ${legs[0].to}`);
  P(legs[0].cause === 'roll' && legs[1].cause === 'card', 'and the legs say which was which',
    legs.map((m) => m.cause).join(' → '));
  P(legs[1].steps === -10, 'the card walks, so the client can walk it', `steps ${legs[1].steps}`);
  P(room.lastCard.playerId === 'a', 'the card names who drew it');
}

{
  // Two legs resolved inside one millisecond is the normal case, not a rare
  // one — which is exactly why the client cannot tell them apart by clock.
  const room = table();
  const seqs = new Set();
  for (let i = 0; i < 40; i++) room.noteMove(room.player('a'), 0, i, 1, 'roll');
  for (const m of room.actionMoves) seqs.add(m.seq);
  P(seqs.size === room.actionMoves.length, 'no two legs ever share a number');
}

// ──────────────────────────────────────────────────────────── the colour ──
rule('GREEN PAYS, RED CHARGES');
{
  const cases = [
    [{ kind: 'money', amount: 200 }, 'good', 'a payout'],
    [{ kind: 'money', amount: -70 }, 'bad', 'a fine'],
    [{ kind: 'money', amount: 0 }, 'good', 'a nil card still is not a charge'],
    [{ kind: 'collectEach', amount: 10 }, 'good', 'everyone pays you'],
    [{ kind: 'payEach', amount: 10 }, 'bad', 'you pay everyone'],
    [{ kind: 'getout', }, 'good', 'a prison card'],
    [{ kind: 'jail' }, 'bad', 'prison itself'],
    [{ kind: 'repairs', house: 25, hotel: 100 }, 'bad', 'street repairs'],
    [{ kind: 'moveBy', n: -10 }, 'bad', 'back ten steps'],
    [{ kind: 'moveBy', n: 5 }, 'plain', 'forward five, which could be either'],
    [{ kind: 'moveTo', tile: 'start', collect: true }, 'good', 'advance to START'],
    [{ kind: 'moveTo', tile: 'prison' }, 'bad', 'straight to prison'],
    [{ kind: 'moveTo', tile: 'priciest' }, 'plain', 'the priciest street, yours or not'],
    [{ kind: 'nearest', target: 'airport', payMultiplier: 2 }, 'bad', 'double rent at the airport'],
    [{ kind: 'nearest', target: 'airport', payMultiplier: 1 }, 'plain', 'an ordinary trip'],
    [{ kind: 'perProperty', amount: -40 }, 'bad', 'per street, out of pocket'],
    [{ kind: 'perProperty', amount: 40 }, 'good', 'per street, into it'],
  ];
  for (const [act, want, what] of cases) {
    const got = cardTone(act);
    P(got === want, what.padEnd(40), `${got}`);
  }
  P(cardTone(undefined) === 'plain', 'a card with no action is never coloured');
}

{
  // Every card of every deck the game can build must get a tone the client
  // knows how to paint — an unknown one would render as an untinted card,
  // which is a silent failure nobody would ever file a bug about.
  const TONES = new Set(['good', 'bad', 'plain']);
  const strays = [];
  let counted = 0;
  const balance = { good: 0, bad: 0, plain: 0 };
  for (const mapId of ['classic', 'india', 'world']) {
    let decks;
    try { decks = buildDecks(getMap(mapId)); } catch { continue; }
    for (const deck of Object.values(decks)) {
      for (const card of deck) {
        counted++;
        const tone = cardTone(card.act);
        if (!TONES.has(tone)) strays.push(`${card.text} → ${tone}`);
        else balance[tone]++;
      }
    }
  }
  P(counted > 40, 'the decks were actually built', `${counted} cards`);
  P(!strays.length, 'every card gets a tone the client can paint', strays.slice(0, 3).join('; '));
  // If nearly everything came out neutral the feature would technically pass
  // and mean nothing on the table.
  P(balance.plain / counted < 0.4, 'and most cards actually say something',
    `${balance.good} good / ${balance.bad} bad / ${balance.plain} neutral`);
}

console.log(`\n${failed ? '  X FAIL' : '  PASS'} — ${failed} failed\n`);
process.exit(failed ? 1 : 0);
