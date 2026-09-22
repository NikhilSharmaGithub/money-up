// Quick Play deals its own table, and every table it deals must be playable.
//
// Two separate worries, checked separately.
//
// The first is the roll: it may only ever produce settings the engine already
// has, at values the engine already takes, on a board every single person in
// the queue can sit down on today. A board that is neither the house board nor
// one of the two the calendar is giving away would be a matchmade table half
// the queue is locked out of — which is not a matchmade table at all.
//
// The second is the game behind the roll. Five bankrolls and five rules that
// flip freely is a hundred and sixty tables, and "the engine supports this
// setting" is not the same claim as "the engine finishes a game with this
// setting". So every one of the hundred and sixty is actually played out, to a
// winner, with the invariants checked at the end.
import {
  GameRoom, DEFAULT_SETTINGS, rollQuickSettings, quickRollParts,
  QUICK_ROLL_KEYS, quickRollValues,
} from '../server/game.js';
import { freeBoardsOn, HOUSE_BOARD } from '../server/boards.js';
import { MAPS } from '../server/maps.js';

let failed = 0;
const P = (ok, l, d = '') => { if (!ok) failed++; console.log(`${ok ? '  PASS' : '  X FAIL'}  ${l.padEnd(56)} ${d}`); };
const rule = (t) => console.log(`\n${'─'.repeat(78)}\n  ${t}\n${'─'.repeat(78)}`);

/** The boards a table dealt on this day may legally land on. */
const playableOn = (when) => [HOUSE_BOARD, ...freeBoardsOn(when)];

const DAY = 86_400_000;

// ───────────────────────────────────────────────────────────────────────────
rule('WHAT THE ROLL IS ALLOWED TO SAY');
{
  const ROLLS = 400;
  const DAYS = 40;
  const known = Object.keys(DEFAULT_SETTINGS);
  const seen = Object.fromEntries(QUICK_ROLL_KEYS.map((k) => [k, new Set()]));
  const boards = new Set();
  const strays = [];
  const offMenu = [];
  const unknown = new Set();
  const wrongShape = [];

  for (let i = 0; i < ROLLS; i++) {
    // Spread the rolls across the calendar, so this is not a statement about
    // one afternoon's pair of free boards.
    const when = Date.now() + (i % DAYS) * DAY;
    const allowed = playableOn(when);
    const rolled = rollQuickSettings(allowed);

    for (const [k, v] of Object.entries(rolled)) {
      if (!known.includes(k)) { unknown.add(k); continue; }
      if (k === 'mapId') continue;
      if (typeof v !== typeof DEFAULT_SETTINGS[k]) wrongShape.push(`${k}=${JSON.stringify(v)}`);
      if (!quickRollValues(k).includes(v)) offMenu.push(`${k}=${JSON.stringify(v)}`);
      seen[k].add(v);
    }
    if (!allowed.includes(rolled.mapId)) strays.push(`${rolled.mapId} on day+${i % DAYS}`);
    // Shuffle is the one board with no MAPS entry — getMap builds it fresh
    // every game — so it is a board by every test that matters except this
    // one. Asserting MAPS alone here is what let the roll quietly drop it.
    if (rolled.mapId !== 'random' && !Object.hasOwn(MAPS, rolled.mapId)) {
      strays.push(`${rolled.mapId} is not a board`);
    }
    boards.add(rolled.mapId);
  }

  P(unknown.size === 0, 'every rolled key is one the engine has', [...unknown].join(', ') || 'no strangers');
  P(wrongShape.length === 0, 'every rolled value is the right type', wrongShape.slice(0, 3).join(', ') || 'clean');
  P(offMenu.length === 0, 'no value outside the menu it is drawn from', offMenu.slice(0, 3).join(', ') || 'clean');
  P(strays.length === 0, 'no board outside what is free that day', strays.slice(0, 3).join(', ') || `${boards.size} distinct boards`);

  // A roll that always says the same thing is not a roll. Every value on
  // every menu has to actually turn up.
  const stuck = QUICK_ROLL_KEYS.filter((k) => seen[k].size < quickRollValues(k).length);
  P(stuck.length === 0, 'every value on every menu came up at least once',
    stuck.join(', ') || QUICK_ROLL_KEYS.map((k) => `${k}:${seen[k].size}`).join(' '));
  P(boards.size > 1, 'the board is not the same board every time', `${boards.size} seen over ${DAYS} days`);

  // The one thing the roll must never touch, said as a rule rather than left
  // to be noticed: the keys it does not deal are the keys that keep a table
  // playable for strangers.
  const LOCKED = ['mortgage', 'deadlockRelief', 'teams', 'turnSeconds', 'randomizeOrder',
    'maxPlayers', 'isPrivate', 'allowBots'];
  const dealt = LOCKED.filter((k) => QUICK_ROLL_KEYS.includes(k));
  P(dealt.length === 0, 'the rules that are not up for rolling are not rolled', dealt.join(', ') || LOCKED.join(', '));

  // Shuffle is free twice every nine days like every other board, and it is
  // the only one that is a different board every single game — which makes it
  // exactly the variety a quick table is for. It has no MAPS entry, so the
  // filter that drops ids this build does not have was dropping it too: on
  // those two days every quick table was dealt from two boards instead of
  // three and Classic's share went from a third to a half.
  let shuffleDay = -1;
  for (let d = 0; d < 20 && shuffleDay < 0; d++) {
    if (freeBoardsOn(Date.now() + d * DAY).includes('random')) shuffleDay = d;
  }
  if (shuffleDay < 0) {
    P(false, 'Shuffle comes round in the free rotation', 'not in twenty days');
  } else {
    const pool = playableOn(Date.now() + shuffleDay * DAY);
    const landed = new Set();
    for (let i = 0; i < 300; i++) landed.add(rollQuickSettings(pool).mapId);
    P(landed.has('random'), 'Shuffle is dealt on the days it is free',
      `day+${shuffleDay} deals ${[...landed].sort().join(', ')}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
rule('AND NOBODY REWRITES IT AFTERWARDS');
{
  // The first person to tap Play Now holds the chair only because somebody
  // had to. The three strangers behind them read what the table rolled and
  // agreed to that — so the host seat is not a licence to change it, and the
  // clock least of all: a five-second turn on somebody who never asked for one
  // is a timeout, and a timeout takes them out of the game and costs karma.
  const room = new GameRoom('quick-lock', () => {});
  room.makeQuickMatch(86_400, rollQuickSettings(playableOn()));
  room.addPlayer({ id: 'first', name: 'First' });
  room.addPlayer({ id: 'second', name: 'Second' });
  const before = { ...room.settings };

  const said = room.updateSettings(room.hostId, {
    startingCash: 10_000_000, turnSeconds: 5, maxPlayers: 8, auction: !before.auction,
  });
  P(!!said?.error, 'a quick host is told the table sets itself', said?.error || 'accepted in silence');
  P(room.settings.startingCash === before.startingCash
    && room.settings.turnSeconds === before.turnSeconds
    && room.settings.maxPlayers === before.maxPlayers
    && room.settings.auction === before.auction,
    'and not one of the four settings moved',
    `$${room.settings.startingCash} · ${room.settings.turnSeconds}s · ${room.settings.maxPlayers} seats`);
  room.dispose();

  // An ordinary table still belongs to its host — and the two numbers that go
  // straight onto a seat are still pinned to what the pickers offer, because
  // "a number from a client" and "a number" are not the same thing.
  const mine = new GameRoom('quick-lock-2', () => {});
  mine.addPlayer({ id: 'me', name: 'Me' });
  mine.updateSettings('me', { startingCash: 1000, turnSeconds: 60 });
  P(mine.settings.startingCash === 1000 && mine.settings.turnSeconds === 60,
    'a private table still takes its host\'s word');
  mine.updateSettings('me', { startingCash: {}, turnSeconds: 1 });
  P(Number.isFinite(mine.settings.startingCash) && mine.settings.startingCash >= 100,
    'a bankroll that is not a number never reaches a seat', `$${mine.settings.startingCash}`);
  P(mine.settings.turnSeconds >= 30, 'and a one-second clock is not a clock',
    `${mine.settings.turnSeconds}s`);
  mine.updateSettings('me', { turnSeconds: 0 });
  P(mine.settings.turnSeconds === 0, 'while "off" is still a real answer');
  mine.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('WHAT THE TABLE DOES WITH IT');
{
  const rolled = rollQuickSettings(playableOn());
  const room = new GameRoom('roll-1', () => {});
  room.makeQuickMatch(GameRoom.QUICK_FUSE_SECONDS, rolled);

  P(room.settings.mapId === rolled.mapId && room.map.id === rolled.mapId,
    'the board on the table is the board that was rolled', `${room.map.id} / ${room.map.name}`);
  P(QUICK_ROLL_KEYS.every((k) => room.settings[k] === rolled[k]),
    'every rolled rule reached the settings');
  P(room.settings.mortgage === true && room.settings.deadlockRelief === true
    && room.settings.teams === 0 && room.settings.turnSeconds === 90
    && room.settings.randomizeOrder === true,
    'the locked rules are still at their defaults');
  P(room.settings.isPrivate === false && room.settings.allowBots === true
    && room.settings.maxPlayers === 4,
    'quick play still owns the seats, the privacy and the house players');

  const line = room.log.find((l) => l.text.startsWith('This table rolled:'));
  P(!!line, 'the table says what it rolled, in the log', line?.text || 'nothing said');

  const sent = room.serialize();
  P(Array.isArray(sent.quickRoll?.parts) && sent.quickRoll.parts.length === QUICK_ROLL_KEYS.length + 1,
    'the state carries one phrase per rolled rule, plus the board',
    (sent.quickRoll?.parts || []).join(' · '));
  P(sent.quickRoll.parts[0] === room.map.name, 'the board leads the phrasing', sent.quickRoll.parts[0]);
  P(sent.quickRoll.parts[1] === `$${room.settings.startingCash.toLocaleString('en-US')} to start`,
    'the bankroll is written the way money is written', sent.quickRoll.parts[1]);
  P((sent.quickRoll.keys || []).every((k) => Object.hasOwn(DEFAULT_SETTINGS, k)),
    'the state names only settings the engine has');
  room.dispose();

  // The phrasing is read off the live settings, not stored with the roll, so
  // that a board moved afterwards — a rollover at midnight sending a table
  // back to Classic — cannot leave the lobby promising something else.
  const moved = new GameRoom('roll-2', () => {});
  moved.makeQuickMatch(GameRoom.QUICK_FUSE_SECONDS, { ...rolled, mapId: 'classic', auction: true });
  moved.settings.auction = false;
  moved.settings.mapId = 'blitz';
  moved.map = MAPS.blitz;
  const after = moved.serialize().quickRoll.parts;
  P(after[0] === MAPS.blitz.name && after.includes('auctions off'),
    'the phrasing follows the table, not the roll', after.join(' · '));
  moved.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('AND AN ORDINARY TABLE IS LEFT ALONE');
{
  const plain = new GameRoom('plain-1', () => {});
  const same = Object.keys(DEFAULT_SETTINGS).every((k) => plain.settings[k] === DEFAULT_SETTINGS[k]);
  P(same, 'a private room still opens on the default settings');
  P(plain.serialize().quickRoll === null, 'and carries no roll for the lobby to show');
  plain.dispose();

  // Quick play without a roll — an older call site, or a day with nothing to
  // deal — must still make an ordinary quick table rather than a broken one.
  const bare = new GameRoom('plain-2', () => {});
  bare.makeQuickMatch();
  P(bare.settings.mapId === DEFAULT_SETTINGS.mapId && bare.serialize().quickRoll === null,
    'an unrolled quick table is the table it always was', bare.settings.mapId);
  bare.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('EVERY COMBINATION PLAYED OUT');
{
  const FLAGS = QUICK_ROLL_KEYS.filter((k) => typeof DEFAULT_SETTINGS[k] === 'boolean');
  const CASH = quickRollValues('startingCash');
  const boards = playableOn();

  /** One bot game, with the timer-driven bot loop replaced by direct calls. */
  const play = (settings, mapId, maxSteps = 4000) => {
    const room = new GameRoom(`q${Math.random().toString(36).slice(2, 6)}`, () => {});
    // A fuse long enough that nothing here can be interrupted by it.
    room.makeQuickMatch(86_400, { ...settings, mapId });
    room.scheduleBot = () => {};
    room.maybeBot = () => {};
    room.maybeBotAuction = () => {};
    room.armAuctionTimer = () => {};
    const trades = [];
    room.scheduleBotTrade = (id) => trades.push(id);
    // One person and three house players, which is what a quick table is.
    // The person's seat is then played for them — a real state, the one a
    // table reaches when somebody lets their clock run out — because the
    // engine will not play a table nobody is sitting at, and a room of four
    // bots is a room nobody is sitting at.
    room.addPlayer({ id: 'human', name: 'Nikhil' });
    for (let i = 0; i < 3; i++) room.addBot();
    room.hostId = 'human';
    const started = room.start(room.hostId);
    room.player('human').botControlled = true;
    let crash = started?.error || null;
    let steps = 0;
    while (!crash && room.status === 'playing' && steps++ < maxSteps) {
      try {
        room.runBot();
        if (room.auction) room.runBotAuction();
        while (trades.length) room.botTradeReply(trades.shift());
      } catch (e) { crash = `${e.message} @ ${e.stack.split('\n')[1]?.trim()}`; }
    }
    // The handful of things that are never true of a legal table, checked at
    // the end rather than every step — this is a hundred and sixty games.
    const debt = room.turn?.debt || null;
    for (const p of room.players) {
      const owing = room.status === 'playing' && debt?.debtor === p.id && !p.bankrupt;
      if (!Number.isFinite(p.money) || (p.money < 0 && !owing)) crash ||= `${p.name} holds ${p.money}`;
      if (p.pos < 0 || p.pos >= room.map.size) crash ||= `${p.name} is off the board at ${p.pos}`;
    }
    for (const [key, o] of Object.entries(room.ownership)) {
      const tile = room.tile(Number(key));
      if (o.houses > 5) crash ||= `${tile.name} has ${o.houses} houses`;
      if (o.houses > 0 && o.mortgaged) crash ||= `${tile.name} is mortgaged with buildings`;
      if (o.houses > 0 && !room.ownsFullGroup(o.owner, tile.group)) crash ||= `${tile.name} built without the set`;
    }
    const status = room.status;
    room.dispose();
    return { status, steps, crash };
  };

  const broke = [];
  const stalled = [];
  let played = 0;
  let boardAt = 0;
  for (const cash of CASH) {
    // All thirty-two ways the five flippable rules can land, exhaustively —
    // a combination the roll can produce is a combination somebody will be
    // sat down at.
    for (let mask = 0; mask < (1 << FLAGS.length); mask++) {
      const settings = { startingCash: cash };
      FLAGS.forEach((k, i) => { settings[k] = !!(mask & (1 << i)); });
      // Rotate the boards through the combinations so the day's whole shelf
      // is played, not only the house board.
      const mapId = boards[boardAt++ % boards.length];
      const { status, crash } = play(settings, mapId);
      played++;
      const label = `${mapId} $${cash} ${FLAGS.map((k, i) => (mask & (1 << i) ? k : `no-${k}`)).join(' ')}`;
      if (crash) broke.push(`${label}: ${crash}`);
      else if (status !== 'ended') stalled.push(label);
    }
  }

  P(broke.length === 0, `${played} combinations played without a crash`, broke[0] || 'clean');
  P(stalled.length === 0, 'every one of them reached a winner',
    stalled.length ? `${stalled.length} unfinished, e.g. ${stalled[0]}` : `${played}/${played}`);
}

rule(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
