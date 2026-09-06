// A table with somebody watching must never stop.
//
// The original bug: the turn passes to somebody who is away, so the server
// marks their seat bot-covered and arms no shot clock for it — a bot cannot
// run out of time. The bot is then the only thing that can move the game on,
// but runBot refuses to play to an "empty" room, and empty was decided by a
// predicate that dropped anybody knocked out. A table watched only by people
// who were already out was a room the server believed nobody was in.
//
// An adversarial pass then found the same wrong question in three more places
// and two ways to lose a player (or the whole process) that had nothing to do
// with it. Every one of them is checked here.
import { GameRoom } from '../server/game.js';

let failed = 0;
const P = (ok, l, d = '') => { if (!ok) failed++; console.log(`${ok ? '  PASS' : '  X FAIL'}  ${l.padEnd(52)} ${d}`); };
const rule = (t) => console.log(`\n${'─'.repeat(74)}\n  ${t}\n${'─'.repeat(74)}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pending = (room) =>
  Object.entries(room.timers || {}).filter(([, v]) => v && typeof v === 'object').map(([k]) => k);

const table = (names, seconds = 1) => {
  const room = new GameRoom('t' + Math.random().toString(36).slice(2, 6), () => {});
  for (const [id, name] of names) room.addPlayer({ id, name });
  room.settings.turnSeconds = seconds;
  room.settings.randomizeOrder = false;
  room.start(names[0][0]);
  return room;
};

// ───────────────────────────────────────────────────────────────────────────
rule('THE ORIGINAL: a table watched only by people who are out');
{
  const room = table([['me', 'Me'], ['marcus', 'Marcus'], ['zara', 'Zara'], ['dan', 'Dan']]);
  room.removeFromPlay(room.player('me'), 'timeout');    // out, and stays to watch
  room.removePlayer('zara');
  room.removePlayer('dan');
  await wait(4000);                                     // Marcus times out too

  console.log(`  turn on ${room.current?.name} (covered: ${room.current?.botControlled})` +
    ` · alive: ${room.players.filter((p) => !p.bankrupt).map((p) => p.name).join(', ')}` +
    ` · app open: ${room.players.filter((p) => p.connected).map((p) => p.name).join(', ')}`);
  P(room.watched === true, 'somebody watching counts as watching', String(room.watched));

  const before = { turn: room.current?.id, count: room.turnCount };
  await wait(3500);
  P(room.turnCount > before.count || room.current?.id !== before.turn,
    'the table plays on for them',
    `turnCount ${before.count} -> ${room.turnCount}`);
  P(pending(room).length > 0, 'something is always due to happen next', pending(room).join(', '));
}

// ───────────────────────────────────────────────────────────────────────────
rule('S1: the last player standing still gets a clock');
{
  // A private table with a bot in it. Knock everyone out but one, and the
  // shot clock used to switch off — leaving that seat with no clock, no bot
  // cover and no grace the moment its owner walked away.
  const room = new GameRoom('s1', () => {});
  room.addPlayer({ id: 'ann', name: 'Ann' });
  room.addPlayer({ id: 'ben', name: 'Ben' });
  room.settings.turnSeconds = 60;
  room.settings.randomizeOrder = false;
  room.settings.allowBots = true;
  room.start('ann');
  room.quit('ben');                                     // Ben is out, still here
  // Walk the turn round until it is Ann's again — the table also holds a bot.
  for (let i = 0; i < 6 && room.current?.id !== 'ann'; i++) room.nextTurn();

  P(room.current?.id === 'ann', 'the turn is Ann\'s', room.current?.name);
  P(room.present.length >= 2, 'Ben still counts as being in the room',
    room.present.map((p) => p.name).join(', '));
  P(room.turn?.endsAt != null, 'Ann is on the clock with Ben watching',
    room.turn?.endsAt ? `${Math.round((room.turn.endsAt - Date.now()) / 1000)}s` : 'NO CLOCK');
  P(pending(room).includes('turn'), 'and the clock is really armed', pending(room).join(', '));
}

// ───────────────────────────────────────────────────────────────────────────
rule('X1: an auction is not you dawdling');
{
  const room = table([['ravi', 'Ravi'], ['nina', 'Nina'], ['omar', 'Omar']], 1);
  // Ravi sends a street to auction and passes; the auction runs on past his
  // clock while other people bid. He must still be at the table afterwards.
  room.turn.phase = 'action';
  room.turn.pending = { type: 'buy', tile: 1 };
  room.skipBuy('ravi');
  P(!!room.auction, 'the street went to auction', room.auction ? 'yes' : 'no');
  await wait(3000);                                     // well past a 1s clock
  P(!room.player('ravi').bankrupt,
    'Ravi is not thrown out for somebody else bidding',
    room.player('ravi').bankrupt ? `REMOVED for ${room.player('ravi').removedFor}` : 'still in');
  room.finishAuction();
  P(room.turn?.endsAt != null, 'and the hammer hands his clock back',
    room.turn?.endsAt ? 'clock armed' : 'NO CLOCK');
}

// ───────────────────────────────────────────────────────────────────────────
rule('X2: a trade whose proposer has left must not take the box down');
{
  const room = table([['a', 'Ann'], ['b', 'Ben']], 60);
  const offer = room.proposeTrade('a', {
    to: 'b', give: { money: 10, tiles: [], cards: 0 }, get: { money: 0, tiles: [], cards: 0 },
  });
  room.status = 'ended';
  room.removePlayer('a');                               // the proposer walks out
  let threw = null;
  let res;
  try { res = room.respondTrade('b', offer.trade?.id ?? offer.id, true); }
  catch (e) { threw = e; }
  P(!threw, 'answering it does not throw', threw ? threw.message : 'no throw');
  P(res?.error != null, 'it comes back as a refusal instead', res?.error || JSON.stringify(res));
}

// ───────────────────────────────────────────────────────────────────────────
rule('S2: walking in re-opens the deadlines nobody was here for');
{
  const room = table([['me', 'Me'], ['marcus', 'Marcus'], ['zara', 'Zara']], 60);
  room.removeFromPlay(room.player('me'), 'timeout');
  room.removePlayer('marcus');
  room.removePlayer('zara');
  room.removePlayer('me');                              // even the watcher goes
  const heldWithNoDeadline = () => room.players.filter(
    (p) => room.awaiting?.[p.id] && !room.awaiting[p.id].until).length;
  console.log(`  seats held with no deadline: ${heldWithNoDeadline()}`);
  room.reconnect('me');                                 // somebody comes back to watch
  P(heldWithNoDeadline() === 0, 'every held seat is given a deadline again',
    `${heldWithNoDeadline()} still open-ended`);
  P(pending(room).some((k) => k.startsWith('grace:')), 'so the table will resolve itself',
    pending(room).join(', ') || 'NOTHING');
}

// ───────────────────────────────────────────────────────────────────────────
rule('AND AN EMPTY ROOM STILL HOLDS STILL');
{
  const room = table([['me', 'Me'], ['marcus', 'Marcus'], ['zara', 'Zara'], ['dan', 'Dan']]);
  room.removeFromPlay(room.player('me'), 'timeout');
  for (const id of ['marcus', 'zara', 'dan', 'me']) room.removePlayer(id);
  await wait(2500);
  P(room.watched === false, 'nothing is played to nobody', String(room.watched));
}

rule(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
