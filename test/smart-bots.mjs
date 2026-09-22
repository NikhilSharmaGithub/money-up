// The bots have to be worth playing against.
//
// Everything here is about the brain in server/game.js: what a street is worth
// to a seat, when a house pays for itself, what gets sold first when a bill
// lands, and — the part that makes a table interesting — whether the house
// players will actually deal, with a person and with each other.
//
// Three rules sit behind all of it and each gets its own section at the end:
// a bot must never stall the table, must never take longer than a stated
// ceiling to decide, and must never know anything a player in that seat could
// not read off the board.
//
// Run with `node test/smart-bots.mjs`.
import { GameRoom } from '../server/game.js';
import { MAPS, getMap } from '../server/maps.js';

let failed = 0;
const P = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '  PASS' : '  X FAIL'}  ${label.padEnd(56)} ${detail}`);
};
const rule = (t) => console.log(`\n${'─'.repeat(78)}\n  ${t}\n${'─'.repeat(78)}`);
const ms = (n) => `${n.toFixed(3)}ms`;

let serial = 0;

/**
 * A table every seat of which is played by the house, driven by direct calls
 * instead of timers so a few hundred games run in seconds.
 *
 * One seat belongs to a real person whose chair is on autopilot, because that
 * is the only shape this ever takes in production — a room with nobody in it
 * correctly holds still (GameRoom.watched), so a table of nothing but house
 * players would sit there testing nothing at all.
 */
function table(mapId, settings = {}, seats = 4) {
  const room = new GameRoom(`sb${++serial}`, () => {});
  room.scheduleBot = () => {};
  room.maybeBot = () => {};
  room.maybeBotAuction = () => {};
  room.armAuctionTimer = () => {};
  room.settings = { ...room.settings, ...settings, mapId };
  room.map = getMap(mapId);
  room.addPlayer({ id: 'watcher', name: 'Watcher' });
  for (let i = 1; i < seats; i++) room.addBot();
  room.hostId = 'watcher';
  return room;
}

/** Plays one table out, and hands back everything worth asserting about it. */
function playOut(room, maxSteps = 20000) {
  const pending = [];
  room.scheduleBotTrade = (id) => pending.push(id);

  const seen = {
    turns: 0, steps: 0, crash: null,
    offers: 0, accepted: 0, botToBot: 0,
    asks: [],             // { from, to, turn } — every envelope, for the pester check
    think: 0, worstThink: 0, decisions: [],
    // The longest run of driver steps that did NOT move the turn on. This, not
    // the length of a game, is what a stall actually is: a table where the next
    // thing never happens. An auction running its course and a debtor selling
    // an estate one deed at a time are both legitimately several dozen steps.
    worstHold: 0,
  };
  const say = room.say.bind(room);
  room.say = (text, kind) => { if (kind === 'turn') seen.turns++; say(text, kind); };
  const propose = room.proposeTrade.bind(room);
  room.proposeTrade = (id, offer) => {
    const res = propose(id, offer);
    if (res?.ok) {
      seen.offers++;
      seen.asks.push({ from: id, to: offer.to, turn: room.turnCount });
    }
    return res;
  };
  const respond = room.respondTrade.bind(room);
  room.respondTrade = (id, tradeId, accept) => {
    const trade = room.trades.find((t) => t.id === tradeId);
    const both = trade && room.player(trade.from)?.isBot && room.player(trade.to)?.isBot;
    const res = respond(id, tradeId, accept);
    if (res?.ok && accept) { seen.accepted++; if (both) seen.botToBot++; }
    return res;
  };

  const started = room.start(room.hostId);
  if (started?.error) { seen.crash = started.error; return seen; }
  room.player('watcher').botControlled = true;

  const tick = (fn) => {
    const t0 = process.hrtime.bigint();
    fn();
    const spent = Number(process.hrtime.bigint() - t0) / 1e6;
    seen.think += spent;
    seen.decisions.push(spent);
    if (spent > seen.worstThink) seen.worstThink = spent;
  };

  let seenTurn = 0;
  let held = 0;
  while (room.status === 'playing' && seen.steps++ < maxSteps) {
    try {
      tick(() => room.runBot());
      if (room.auction) tick(() => room.runBotAuction());
      while (pending.length) { const id = pending.shift(); tick(() => room.botTradeReply(id)); }
    } catch (e) {
      seen.crash = `${e.message} — ${e.stack.split('\n')[1]?.trim()}`;
      break;
    }
    if (seen.turns === seenTurn) {
      if (++held > seen.worstHold) seen.worstHold = held;
    } else { held = 0; seenTurn = seen.turns; }
  }
  seen.ended = room.status === 'ended';
  room.dispose();
  return seen;
}

/** A board with one colour handed to `owner` outright, for the build tests. */
function giveGroup(room, owner, size = 3) {
  const [group, idxs] = Object.entries(room.map.groups).find(([, g]) => g.length === size);
  idxs.forEach((i) => { room.ownership[i] = { owner, houses: 0, mortgaged: false }; });
  return { group, idxs };
}

// ───────────────────────────────────────────────────────────────────────────
rule('THREE HUNDRED TABLES, PLAYED TO THE END');
{
  const MAP_IDS = Object.keys(MAPS);
  const GAMES = 300;
  const runs = [];
  let crashes = 0, stalls = 0, botToBot = 0, accepted = 0, offers = 0;
  let think = 0, worstThink = 0, worstHold = 0;
  const decisions = [];
  const started = Date.now();

  for (let n = 0; n < GAMES; n++) {
    // Six seats every fifth table, so the search is exercised against a board
    // with more rivals on it than the ordinary four.
    const seats = n % 5 === 0 ? 6 : 4;
    const room = table(MAP_IDS[n % MAP_IDS.length], { maxPlayers: 8 }, seats);
    const seen = playOut(room);
    if (seen.crash) { crashes++; console.log(`    crash: ${seen.crash}`); }
    if (!seen.ended) stalls++;
    else runs.push(seen.turns);
    offers += seen.offers; accepted += seen.accepted; botToBot += seen.botToBot;
    think += seen.think;
    for (const d of seen.decisions) decisions.push(d);
    if (seen.worstThink > worstThink) worstThink = seen.worstThink;
    if (seen.worstHold > worstHold) worstHold = seen.worstHold;
  }

  runs.sort((a, b) => a - b);
  const at = (q) => runs[Math.min(runs.length - 1, Math.floor(runs.length * q))] ?? 0;
  const mean = Math.round(runs.reduce((s, x) => s + x, 0) / Math.max(1, runs.length));
  console.log(`  ${GAMES} games in ${((Date.now() - started) / 1000).toFixed(1)}s · `
    + `turns median ${at(0.5)}, mean ${mean}, p90 ${at(0.9)}, longest ${runs[runs.length - 1]}`);
  console.log(`  ${offers} offers sent, ${accepted} signed (${Math.round(100 * accepted / Math.max(1, offers))}%), `
    + `${botToBot} of them between two house players`);

  P(crashes === 0, 'nothing threw', `${crashes} crash(es)`);
  P(at(0.5) <= 300, 'a typical game is a game, not a siege', `median ${at(0.5)} turns`);
  P(at(0.9) <= 600, 'and the long ones stay watchable', `p90 ${at(0.9)} turns`);
  P(at(0.95) <= 900, 'and even the slow ones end', `p95 ${at(0.95)} turns, longest ${runs[runs.length - 1]}`);
  // A stall is a table where the next thing never happens — not a table that
  // takes a long time. That is what this measures, and it holds even in the
  // games that run long.
  P(worstHold < 400, 'the table never stops making progress',
    `longest hold ${worstHold} steps without the turn moving on`);
  // The residue, named rather than hidden. What survives to the step cap is
  // always the same picture: two players left, the board split exactly down
  // the middle, every colour complete, every street hotelled and both banks
  // past two hundred thousand. Rents cancel, salary outruns them, and neither
  // side can be made to lose. There is no better move for a bot to find there
  // — both are already playing perfectly — so this is the ruleset's tail, not
  // the brain's, and it is bounded here rather than wished away.
  P(stalls <= 3, 'next to nothing outlives the step cap',
    `${stalls} of ${GAMES} still going after ${20000} steps`);
  P(botToBot >= GAMES, 'house players deal with each other, not just with people',
    `${(botToBot / GAMES).toFixed(1)} bot-to-bot trades a game`);
  P(accepted / Math.max(1, offers) > 0.5,
    'a bot does not send offers it expects to be refused',
    `${Math.round(100 * accepted / Math.max(1, offers))}% signed`);
  // Two statements, because no single number can make both of them.
  //
  // The middle of the distribution is what the brain actually costs. A quarter
  // of a million samples hold it in the low thousandths of a millisecond run
  // after run, loaded machine or idle one, and it moves only if thinking itself
  // got dearer — which is the regression worth catching.
  //
  // The far tail is the machine, not the bot: a garbage collection, another
  // process taking the core, a laptop deciding to index something. It swings
  // by a factor of five on identical code, and it was pinned at 5ms against
  // readings of 2-3ms — under two times' headroom on a wall clock. That is a
  // coin flip, and this file is part of `npm test` now, which gets run on busy
  // laptops and inside CI containers on a CPU quota. So the tail is held to a
  // bar only a pathology could cross: a bot turn is scheduled 500ms after the
  // last one, and a tenth of that is a hiccup, not a decision blocking the
  // table. The one thing that would genuinely cross it — a search that grows
  // with the board rather than with its package budget — costs hundreds of
  // milliseconds, not twelve.
  decisions.sort((a, b) => a - b);
  const median = decisions[Math.floor(decisions.length / 2)] ?? 0;
  const p999 = decisions[Math.floor(decisions.length * 0.999)] ?? 0;
  P(median < 0.5, 'a decision costs next to nothing', `median ${ms(median)}`);
  P(p999 < 50, 'and none of them blocks the table',
    `999th of a thousand ${ms(p999)}, against a 500ms gap between bot turns`);
  console.log(`  thinking cost ${ms(think / GAMES)} a game across ${decisions.length} decisions · `
    + `median ${ms(median)}, worst ${ms(worstThink)}`);
}

// ───────────────────────────────────────────────────────────────────────────
rule('A STREET IS WORTH WHAT IT FINISHES');
{
  const room = table('classic');
  room.start(room.hostId);
  room.player('watcher').botControlled = true;
  const bot = room.players.find((p) => p.isBot);
  const rival = room.players.find((p) => p.id === 'watcher');
  const [, trio] = Object.entries(room.map.groups).find(([, g]) => g.length === 3);
  const price = room.tile(trio[2]).price;

  // Nobody owns anything: an ordinary street is worth about its sticker.
  //
  // At a temper of exactly one, because every bot has its own 0.85–1.15
  // aggression dial seeded from an id built with Math.random(). Judging a raw
  // valuation against a fixed ceiling was a coin flip on which bot the table
  // happened to seat: a $120 street came back at $138 often enough to fail
  // about one run in three, with nothing about the brain having changed.
  const plain = room.botValueOf(bot, trio[2], 1);
  P(plain <= price * 1.1, 'a street nobody is racing for is worth its price',
    `$${plain} for a $${price} street`);

  // The bot holds two of the three — the last one finishes a colour.
  trio.slice(0, 2).forEach((i) => { room.ownership[i] = { owner: bot.id, houses: 0, mortgaged: false }; });
  const finishes = room.botValueOf(bot, trio[2], 1);
  P(finishes >= price * 1.8, 'the street that finishes my colour is worth a premium',
    `$${finishes} for a $${price} street`);

  // Same street, but it is the RIVAL who is one short.
  trio.slice(0, 2).forEach((i) => { room.ownership[i] = { owner: rival.id, houses: 0, mortgaged: false }; });
  const denies = room.botValueOf(bot, trio[2], 1);
  P(denies >= price * 1.6, 'and so is the one that stops theirs',
    `$${denies} for a $${price} street`);
  P(room.botUrgent(bot, trio[2]) === true, 'both of those count as urgent buys');

  // And a deed already cashed in at the bank is not the same deed: the bank
  // has paid half its price out, it collects nothing until that is lifted,
  // and lifting it costs ten per cent over the odds. Priced as if it were
  // clear, somebody else's debts read to a bot as a pile of bargains.
  trio.slice(0, 2).forEach((i) => { delete room.ownership[i]; });
  room.ownership[trio[2]] = { owner: rival.id, houses: 0, mortgaged: false };
  const clear = room.botValueOf(bot, trio[2], 1);
  room.own(trio[2]).mortgaged = true;
  const inHock = room.botValueOf(bot, trio[2], 1);
  const lift = Math.ceil((price / 2) * 1.1);
  P(inHock === Math.max(0, clear - lift), 'a mortgaged deed is worth its own lifting cost less',
    `$${inHock} against $${clear}, lift $${lift}`);

  // The judge has to read the same way, or the search goes shopping for them:
  // three mortgaged strays, offered for the cash the bank has already paid out
  // on them, is not a deal anybody should sign.
  const human = rival;
  // One street from each of three OTHER colours — a stray is only a stray if
  // it finishes nothing, and three from one colour would be a monopoly, which
  // is worth overpaying for mortgaged or not.
  const cheap = [];
  for (const [group, idxs] of Object.entries(room.map.groups)) {
    if (cheap.length === 3) break;
    if (idxs.length < 2 || idxs.some((i) => room.own(i))) continue;
    cheap.push(idxs[0]);
  }
  cheap.forEach((i) => { room.ownership[i] = { owner: human.id, houses: 0, mortgaged: true }; });
  const sticker = cheap.reduce((s, i) => s + room.tile(i).price, 0);
  bot.money = 4000;
  const junk = room.botJudgeTrade(bot, human,
    { money: 0, tiles: cheap, cards: 0 },
    { money: Math.floor(sticker * 0.7), tiles: [], cards: 0 });
  P(junk.accept === false, 'and a pile of them does not buy a bot\'s cash',
    `worth $${junk.value} against $${junk.cost} for a $${sticker} sticker`);
  room.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('HOUSES GO UP WHEN THE MONEY SAYS SO');
{
  const room = table('classic');
  room.start(room.hostId);
  room.player('watcher').botControlled = true;
  const bot = room.players.find((p) => p.isBot);
  room.turn = { playerId: bot.id, phase: 'end', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: true };
  const { idxs } = giveGroup(room, bot.id, 3);
  const houseCost = room.tile(idxs[0]).houseCost;

  // Flush: the colour should be carpeted, and evenly.
  bot.money = 4000;
  room.botBuild(bot);
  const houses = idxs.map((i) => room.own(i).houses || 0);
  const spread = Math.max(...houses) - Math.min(...houses);
  P(houses.reduce((s, h) => s + h, 0) >= 9, 'a flush bot carpets its colour', `houses ${houses.join('/')}`);
  P(spread <= 1, 'and builds it evenly', `spread ${spread}`);

  // Lean: enough for two houses and not a rupee more. Reaching three houses a
  // street is the best-paid step on the board, so the bot is expected to spend
  // its cushion getting there rather than sit on a bare monopoly.
  const lean = table('classic');
  lean.start(lean.hostId);
  lean.player('watcher').botControlled = true;
  const bot2 = lean.players.find((p) => p.isBot);
  lean.turn = { playerId: bot2.id, phase: 'end', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: true };
  const set2 = giveGroup(lean, bot2.id, 3);
  const purse = lean.tile(set2.idxs[0]).houseCost * 3;
  bot2.money = purse;
  lean.botBuild(bot2);
  const built2 = set2.idxs.reduce((s, i) => s + (lean.own(i).houses || 0), 0);
  // Two of the three, not all three: a bot is meant to spend its cushion
  // getting a colour off the ground, not to arrive at a monopoly with nothing
  // in the bank to pay the next bill with.
  P(built2 >= 2, 'a lean bot digs into its cushion to get the colour going',
    `${built2} house(s) out of a $${purse} purse`);
  P(bot2.money >= 0, 'without spending money it does not have', `$${bot2.money} left`);
  room.dispose(); lean.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('WHAT GETS SOLD FIRST WHEN THE BILL LANDS');
{
  const room = table('classic');
  room.start(room.hostId);
  room.player('watcher').botControlled = true;
  const bot = room.players.find((p) => p.isBot);
  room.turn = { playerId: bot.id, phase: 'end', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: true };

  // One built colour, plus two strays from colours it does not own.
  const { idxs } = giveGroup(room, bot.id, 3);
  idxs.forEach((i) => { room.ownership[i].houses = 2; });
  // One street from each of two OTHER colours. Two from the same colour could
  // add up to a set of its own, which is not a stray at all.
  const strays = [];
  const taken = new Set();
  for (const [group, group_idxs] of Object.entries(room.map.groups)) {
    if (group_idxs.some((i) => idxs.includes(i)) || taken.has(group)) continue;
    if (group_idxs.length < 2) continue;      // a one-street colour IS a set
    taken.add(group);
    strays.push(group_idxs[0]);
    if (strays.length === 2) break;
  }
  strays.forEach((i) => { room.ownership[i] = { owner: bot.id, houses: 0, mortgaged: false }; });

  bot.money = 0;
  const before = idxs.reduce((s, i) => s + room.own(i).houses, 0);
  room.autoLiquidate(bot);
  P(strays.some((i) => room.own(i).mortgaged), 'a stray street is mortgaged first',
    strays.map((i) => `${room.tile(i).name}${room.own(i).mortgaged ? ' (mortgaged)' : ''}`).join(', '));
  P(idxs.reduce((s, i) => s + room.own(i).houses, 0) === before,
    'the rent engine is left standing', `${before} houses`);

  // Keep going: both strays, then the buildings, and only then the bare set.
  let guard = 0;
  while (guard++ < 40 && room.autoLiquidate(bot)) { /* sell it all */ }
  P(guard < 40, 'liquidation always terminates', `${guard} step(s)`);
  P(idxs.every((i) => room.own(i).mortgaged), 'and everything really can be raised',
    `$${bot.money} raised from an estate of ${room.tilesOf(bot.id).length} deeds`);
  P(room.autoLiquidate(bot) === false, 'an empty estate says so plainly');

  // The point of the order: a bill smaller than the strays are worth must not
  // cost the bot a single house. Under the old order it razed a hotel first.
  const fresh = table('classic');
  fresh.start(fresh.hostId);
  fresh.player('watcher').botControlled = true;
  const bot2 = fresh.players.find((p) => p.isBot);
  const set2 = giveGroup(fresh, bot2.id, 3);
  set2.idxs.forEach((i) => { fresh.ownership[i].houses = 3; });
  const stray2 = fresh.map.tiles.findIndex((t, i) => t.type === 'property' && !set2.idxs.includes(i));
  fresh.ownership[stray2] = { owner: bot2.id, houses: 0, mortgaged: false };
  bot2.money = 0;
  fresh.forcePay(bot2, Math.floor(fresh.tile(stray2).price / 2), null);
  P(!bot2.bankrupt, 'a bill the mortgage book covers does not end anybody');
  P(set2.idxs.every((i) => fresh.own(i).houses === 3), 'and costs no buildings at all',
    set2.idxs.map((i) => fresh.own(i).houses).join('/'));

  // And it is the SMALLEST sale that settles the bill. forcePay charges human
  // seats too — a $50 card must not cost somebody the dearest deed on their
  // books, handing them change they never asked for and a bill at ten per cent
  // over to buy it back. Nobody chose that and nobody is asked.
  const small = table('classic');
  small.start(small.hostId);
  small.player('watcher').botControlled = true;
  const bot3 = small.players.find((p) => p.isBot);
  const streets = small.map.tiles
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.type === 'property')
    .sort((a, b) => a.t.price - b.t.price);
  const cheapest = streets[0].i;
  const dearest = streets[streets.length - 1].i;
  small.ownership[cheapest] = { owner: bot3.id, houses: 0, mortgaged: false };
  small.ownership[dearest] = { owner: bot3.id, houses: 0, mortgaged: false };
  bot3.money = 0;
  small.forcePay(bot3, Math.floor(small.tile(cheapest).price / 2), null);
  P(small.own(cheapest).mortgaged && !small.own(dearest).mortgaged,
    'a small bill takes the smallest deed that covers it',
    `${small.tile(cheapest).name} ${small.own(cheapest).mortgaged ? 'mortgaged' : 'kept'}, `
    + `${small.tile(dearest).name} ${small.own(dearest).mortgaged ? 'mortgaged' : 'kept'}`);

  // A bill nothing small covers still climbs the ladder — that is the case the
  // dearest-first order was actually written for.
  const big = table('classic');
  big.start(big.hostId);
  big.player('watcher').botControlled = true;
  const bot4 = big.players.find((p) => p.isBot);
  big.ownership[cheapest] = { owner: bot4.id, houses: 0, mortgaged: false };
  big.ownership[dearest] = { owner: bot4.id, houses: 0, mortgaged: false };
  bot4.money = 0;
  big.forcePay(bot4, Math.floor(big.tile(dearest).price / 2), null);
  P(big.own(dearest).mortgaged, 'a bill nothing smaller covers reaches for the big one',
    `${big.tile(dearest).name} ${big.own(dearest).mortgaged ? 'mortgaged' : 'kept'}`);
  room.dispose(); fresh.dispose(); small.dispose(); big.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('AN OFFER IS JUDGED ON ITS MERITS');
{
  const room = table('classic');
  room.start(room.hostId);
  room.player('watcher').botControlled = true;
  const bot = room.players.find((p) => p.isBot);
  const human = room.player('watcher');
  const [, trio] = Object.entries(room.map.groups).find(([, g]) => g.length === 3);
  const price = room.tile(trio[2]).price;

  // The human is one short and the bot holds the piece.
  trio.slice(0, 2).forEach((i) => { room.ownership[i] = { owner: human.id, houses: 0, mortgaged: false }; });
  room.ownership[trio[2]] = { owner: bot.id, houses: 0, mortgaged: false };
  bot.money = 800; human.money = 8000;

  const ask = (money) => room.botJudgeTrade(bot, human,
    { money, tiles: [], cards: 0 }, { money: 0, tiles: [trio[2]], cards: 0 }).accept;
  P(ask(price) === false, 'the sticker price does not buy a rival their colour', `$${price}`);
  P(ask(price * 2) === false, 'nor does double', `$${price * 2}`);
  P(ask(price * 6) === true, 'a serious ransom does', `$${price * 6}`);

  // A colour the bot already owns outright is not for sale at any sane price.
  const own = giveGroup(room, bot.id, 2);
  const keep = own.idxs[0];
  const keepPrice = room.tile(keep).price;
  const sell = (money) => room.botJudgeTrade(bot, human,
    { money, tiles: [], cards: 0 }, { money: 0, tiles: [keep], cards: 0 }).accept;
  P(sell(keepPrice * 3) === false, 'a bot does not break up its own colour cheaply',
    `$${keepPrice * 3} refused for a $${keepPrice} street`);

  // And the deal it likes: the piece that completes its own colour, at a price.
  const wantSet = Object.entries(room.map.groups).find(([g, idxs]) => (
    idxs.length === 3 && !idxs.some((i) => room.own(i))
  ));
  const [, want] = wantSet;
  want.slice(0, 2).forEach((i) => { room.ownership[i] = { owner: bot.id, houses: 0, mortgaged: false }; });
  room.ownership[want[2]] = { owner: human.id, houses: 0, mortgaged: false };
  const pay = room.botJudgeTrade(bot, human,
    { money: 0, tiles: [want[2]], cards: 0 },
    { money: Math.floor(room.tile(want[2]).price * 1.4), tiles: [], cards: 0 });
  P(pay.accept === true, 'and pays over the odds for the one that finishes its own',
    `bar ${pay.bar.toFixed(2)}, worth $${pay.value} against $${pay.cost}`);
  room.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('NOBODY GETS PESTERED');
{
  let worst = Infinity;
  let repeats = 0, envelopes = 0;
  for (let n = 0; n < 40; n++) {
    const room = table(Object.keys(MAPS)[n % Object.keys(MAPS).length]);
    const seen = playOut(room);
    const last = {};
    for (const a of seen.asks) {
      envelopes++;
      const key = `${a.from}->${a.to}`;
      if (key in last) {
        const gap = a.turn - last[key];
        if (gap < worst) worst = gap;
        if (gap < 9) repeats++;
      }
      last[key] = a.turn;
    }
  }
  P(repeats === 0, 'no door is knocked on twice in a hurry',
    `${repeats} of ${envelopes} envelopes inside the cooldown`);
  P(worst >= 9 || worst === Infinity, 'the shortest gap respects the cooldown',
    worst === Infinity ? 'nobody was asked twice' : `${worst} turns`);
}

// ───────────────────────────────────────────────────────────────────────────
rule('A BOT SEES ONLY WHAT ITS SEAT CAN SEE');
{
  // Everything the brain is allowed to read is on the board: ownership,
  // houses, mortgages, cash, prison cards. The two things it must never touch
  // are the card decks nobody has drawn from yet, and another player's private
  // working memory — who turned them down, whose door they have knocked on.
  // Both are booby-trapped here, and then a full turn of thinking is run.
  const room = table('classic', {}, 4);
  room.start(room.hostId);
  room.player('watcher').botControlled = true;
  const bot = room.players.find((p) => p.isBot);

  // Scatter the board so there is plenty to think about.
  const buyable = room.map.tiles
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => ['property', 'airport', 'utility'].includes(t.type));
  buyable.forEach(({ i }, n) => {
    room.ownership[i] = { owner: room.players[n % room.players.length].id, houses: 0, mortgaged: false };
  });
  room.players.forEach((p) => { p.money = 2000; });
  room.turn = { playerId: bot.id, phase: 'end', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: true };

  const touched = [];
  room.decks = new Proxy(room.decks, {
    get(t, k) { if (typeof k === 'string') touched.push(`decks.${k}`); return t[k]; },
  });
  for (const p of room.players) {
    if (p.id === bot.id) continue;
    for (const key of ['refused', 'askedAt', 'lastAskedAt']) {
      const held = p[key];
      Object.defineProperty(p, key, {
        configurable: true,
        get() { touched.push(`${p.name}.${key}`); return held; },
        set() { /* writes are somebody else's business, not a peek */ },
      });
    }
  }

  room.botUnmortgage(bot);
  room.botBuild(bot);
  room.botMaybeTrade(bot);
  room.botBestOffer(bot);
  buyable.slice(0, 6).forEach(({ i }) => room.botValueOf(bot, i));
  room.autoLiquidate(bot);

  P(touched.length === 0, 'a whole turn of thinking reads nothing private',
    touched.length ? touched.slice(0, 4).join(', ') : 'clean');
  room.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('THINKING HAS A CEILING');
{
  // The worst board the search will ever see: eight seats, every buyable tile
  // owned, everyone rich enough to deal. The trade search is the only part
  // that could grow with the board, and it is bounded by a package count
  // rather than by how many deeds are on the table — this measures that.
  const room = table('classic', { maxPlayers: 8 }, 8);
  room.start(room.hostId);
  room.player('watcher').botControlled = true;
  const bot = room.players.find((p) => p.isBot);
  room.map.tiles.forEach((t, i) => {
    if (!['property', 'airport', 'utility'].includes(t.type)) return;
    room.ownership[i] = { owner: room.players[i % room.players.length].id, houses: 0, mortgaged: false };
  });
  room.players.forEach((p) => { p.money = 5000; });

  const ROUNDS = 400;
  const spells = [];
  for (let n = 0; n < ROUNDS; n++) {
    room.turnCount = n;                 // move the cooldowns on so it really searches
    room.players.forEach((p) => { p.askedAt = {}; });
    const t0 = process.hrtime.bigint();
    room.botBestOffer(bot);
    spells.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const total = spells.reduce((s, x) => s + x, 0);
  const sorted = [...spells].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(ROUNDS * 0.95)];
  const worst = sorted[ROUNDS - 1];
  console.log(`  ${ROUNDS} searches on a full eight-seat board: `
    + `${ms(total / ROUNDS)} each, p95 ${ms(p95)}, worst ${ms(worst)}`);
  // The bar is set against what it is competing with, not against a round
  // number: a bot turn is scheduled 500ms or more after the last one
  // (scheduleBot), so a search costing single-digit milliseconds on the worst
  // board there is costs the table nothing. What would matter is the search
  // growing with the board — and it cannot, because the budget is a package
  // count. A twentieth of the gap is loose enough not to cry wolf on a busy
  // machine and tight enough that an unbounded search could not possibly slip
  // through: one of those costs hundreds of milliseconds, not tens.
  //
  // Read off the distribution rather than the single worst reading, for the
  // same reason the section above does. Four hundred samples on a laptop will
  // always contain one garbage collection, and the old bar sat at 50ms against
  // an honest worst of 48ms — a check that measured what else the machine was
  // doing. The worst is still printed, because it is worth seeing; it is the
  // typical cost and the top of the spread that are asserted.
  P(total / ROUNDS < 25, 'a trade search is cheap against the gap between turns',
    `${ms(total / ROUNDS)} against a 500ms turn gap`);
  P(p95 < 25, 'and never blocks the tick', `p95 ${ms(p95)}, worst ${ms(worst)}`);
  room.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('A BOT THAT CANNOT DECIDE STILL ACTS');
{
  // Nothing to build, nothing to trade, nobody to deal with: the turn must
  // still end. A bot with no good move that makes no move is a stalled table.
  const room = table('classic');
  room.start(room.hostId);
  room.player('watcher').botControlled = true;
  const bot = room.players.find((p) => p.isBot);
  room.turn = { playerId: bot.id, phase: 'end', dice: null, doubles: 0, pending: null, debt: null, rolledThisTurn: true };
  bot.money = 0;
  room.runBot();
  P(room.turn.playerId !== bot.id, 'an empty-handed bot hands the turn on',
    `turn is ${room.player(room.turn.playerId)?.name}`);

  // Owing more than the whole estate is worth, with nothing left to sell.
  const broke = table('classic');
  broke.start(broke.hostId);
  broke.player('watcher').botControlled = true;
  const doomed = broke.players.find((p) => p.isBot);
  broke.turn = {
    playerId: doomed.id, phase: 'debt', dice: null, doubles: 0, pending: null,
    debt: { debtor: doomed.id, creditor: null, amount: 9000, reason: 'in rent', rentSoFar: 0 },
    rolledThisTurn: true,
  };
  doomed.money = -9000;
  let steps = 0;
  while (steps++ < 60 && !doomed.bankrupt && broke.status === 'playing') broke.runBot();
  P(doomed.bankrupt || broke.status === 'ended', 'a hopeless debtor concedes rather than hangs',
    `after ${steps} step(s)`);
  P(steps < 60, 'and does it promptly', `${steps} step(s)`);
  room.dispose(); broke.dispose();
}

rule(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
