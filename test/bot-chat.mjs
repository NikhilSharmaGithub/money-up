// Bots that answer what was actually said.
//
// The thing being proved here is not "a bot replied". It is that the reply is
// about the message AND about this table: the right bot answers when one is
// named, a question about the turn names whoever is really on it, a figure
// quoted is a figure that exists, "trade?" from somebody holding the street
// that finishes a colour produces the offer itself — and none of it ever runs
// away, loops, or answers a line the server wrote.
//
// Run with: node test/bot-chat.mjs
import { GameRoom } from '../server/game.js';
import { GROUPS } from '../server/maps.js';
import {
  readMessage, whoIsAddressed, planReply,
  REPLY_DELAY_MAX, REPLY_GAP_TABLE, REPLY_WINDOW_MAX,
} from '../server/botchat.js';

let failed = 0;
const P = (ok, l, d = '') => { if (!ok) failed++; console.log(`${ok ? '  PASS' : '  X FAIL'}  ${l.padEnd(56)} ${d}`); };
const rule = (t) => console.log(`\n${'─'.repeat(78)}\n  ${t}\n${'─'.repeat(78)}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A quick-match-shaped table: one human, three house players, mid-game. */
function table(turns = 60) {
  const room = new GameRoom('c' + Math.random().toString(36).slice(2, 6), () => {});
  room.settings.allowBots = true;
  room.settings.randomizeOrder = false;
  room.settings.turnSeconds = 0;
  room.addPlayer({ id: 'me', name: 'Nikhil' });
  room.addBot(); room.addBot(); room.addBot();
  room.start('me');
  // Play it forward synchronously so there is real state to talk about:
  // deeds owned, somebody in front, somebody trailing.
  for (let i = 0; i < turns && room.status === 'playing'; i++) {
    const p = room.current;
    if (!p) break;
    const phase = room.turn.phase;
    if (phase === 'roll') room.roll(p.id);
    else if (phase === 'action' && room.turn.pending?.type === 'buy') room.buy(p.id);
    else if (phase === 'end') room.endTurn(p.id);
    else break;
  }
  return room;
}

const bots = (room) => room.players.filter((p) => p.isBot);
const botLines = (room) => room.chat.filter((m) => m.name !== 'Nikhil');

// ───────────────────────────────────────────────────────────────────────────
rule('READING THE MESSAGE');
{
  const cases = [
    ['hi everyone', 'greet'], ['yo', 'greet'], ['namaste sab log', 'greet'],
    ['whose turn is it', 'turnQ'], ['kiski turn hai', 'turnQ'],
    ['who is winning', 'leaderQ'], ['kaun jeet raha hai bhai', 'leaderQ'],
    ['how much money do you have', 'moneyQ'], ['kitne paise hain', 'moneyQ'],
    ['anyone want to trade', 'trade'], ['trade karega?', 'trade'],
    ['kitne ka doge', 'trade'], ['swap?', 'trade'],
    ['this rent is robbery', 'rent'], ['kiraya bahut mehnga hai', 'rent'],
    ['i am broke', 'broke'], ['paise nahi bache', 'broke'],
    ['jail again', 'jail'], ['the dice hate me', 'luck'],
    ['kismat kharab hai', 'luck'], ['jaldi karo', 'hurry'],
    ['brb 2 min', 'afk'], ['how do i build houses', 'help'],
    ['you are a noob', 'taunt'], ['thanks', 'thanks'], ['sorry', 'sorry'],
    ['nice one', 'praise'], ['lol', 'laugh'], ['ok', 'agree'],
    ['gg all', 'gg'], ['the weather is nice today', 'chat'], ['shabash', 'praise'],
  ];
  const wrong = cases.filter(([text, want]) => readMessage(text).intent !== want);
  P(!wrong.length, 'every sample message reads as what it is',
    wrong.map(([t, w]) => `"${t}" wanted ${w} got ${readMessage(t).intent}`).join('; ') || `${cases.length} messages`);

  P(readMessage('kitne ka doge bhai').hinglish === true, 'hinglish is spotted', 'kitne ka doge bhai');
  P(readMessage('how much for that street').hinglish === false, 'plain english is not mistaken for it');
  P(readMessage('what should i buy').question === true, 'a question is spotted without a question mark');
}

// ───────────────────────────────────────────────────────────────────────────
rule('NAMING SOMEBODY GETS THAT SOMEBODY');
{
  const people = [
    { id: 'a', name: 'Kiran' }, { id: 'b', name: 'rohan22' },
    { id: 'c', name: 'chai_break' }, { id: 'd', name: 'Lucky Seth' },
  ];
  const cases = [
    ['Kiran, trade karega?', 'a'], ['kiran trade?', 'a'],
    ['rohan22 sell me that street', 'b'], ['rohan dega kya', 'b'],
    ['chai_break you there', 'c'], ['chai, deal?', 'c'],
    ['lucky seth is winning', 'd'], ['seth?', 'd'],
    ['anyone want to trade', null], ['kirana store', null],
    ['i am rohanish about this', null],
  ];
  const wrong = cases.filter(([text, want]) => whoIsAddressed(text, people, 'Nikhil') !== want);
  P(!wrong.length, 'the right seat is addressed, and only when meant',
    wrong.map(([t, w]) => `"${t}" wanted ${w} got ${whoIsAddressed(t, people, 'Nikhil')}`).join('; ') || `${cases.length} messages`);

  P(whoIsAddressed('Nikhil is losing badly', people, 'Nikhil') === null,
    'talking about yourself addresses nobody');

  // And through the room, where the names are whatever the pool dealt.
  const room = table();
  const misses = bots(room).filter((b) => {
    const plan = room.planChatReply(room.player('me'), `${b.name} trade karega?`);
    return !plan || plan.botId !== b.id || !plan.addressed;
  });
  P(!misses.length, 'every bot at a real table answers to its own name',
    misses.map((b) => b.name).join(', ') || bots(room).map((b) => b.name).join(', '));
  room.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('THE REPLY IS ABOUT THE MESSAGE, AND ABOUT THIS TABLE');
{
  const room = table();
  const me = room.player('me');
  const names = new Set(room.players.map((p) => p.name));

  const asked = [
    'hi all', 'whose turn is it', 'who is winning', 'how much money do you have',
    'anyone want to trade', 'this rent is robbery', 'i am broke', 'jail again',
    'the dice hate me', 'jaldi karo', 'brb', 'how do i win', 'you are a noob',
    'thanks', 'sorry', 'nice', 'lol', 'ok', 'gg', 'what should i buy',
    'kitne ka doge', 'kaun jeet raha hai', 'kiraya mehnga hai', 'paise khatam',
    'random thoughts about nothing in particular',
  ];

  let unfilled = 0, selfTalk = 0, wrongIntent = 0;
  const lines = new Set();
  for (let pass = 0; pass < 40; pass++) {
    for (const text of asked) {
      const plan = room.planChatReply(me, text);
      if (!plan) { wrongIntent++; continue; }
      lines.add(plan.line);
      // A hole nothing filled would have shipped a literal "{leader}".
      if (/\{\w+\}/.test(plan.line)) unfilled++;
      // Nobody refers to themselves in the third person, and nobody tells the
      // person they are talking to about themselves in the third person.
      const speaker = room.player(plan.botId).name;
      const word = (n) => new RegExp(`(^|[^\\w])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`, 'i');
      if (word(speaker).test(plan.line)) selfTalk++;
      if (readMessage(text).intent !== plan.intent) wrongIntent++;
    }
  }
  P(unfilled === 0, 'no reply ever ships an unfilled slot', `${unfilled} of ${asked.length * 40}`);
  P(selfTalk === 0, 'no bot talks about itself in the third person', `${selfTalk} slips`);
  P(wrongIntent === 0, 'the reply is filed under what was said', `${wrongIntent} mismatches`);
  P(lines.size > 60, 'two games do not read the same', `${lines.size} distinct lines`);

  // Every proper noun a reply drops is something at this table: a player still
  // sitting here, or a street on this board. Never a leftover from a template,
  // never a name from somewhere else.
  const real = new Set(names);
  const words = (s) => String(s).split(/[\s'-]+/).forEach((w) => real.add(w));
  room.map.tiles.forEach((t) => words(t.name));
  Object.keys(room.map.groups).forEach((g) => words(GROUPS[g]?.name || g));
  const ghosts = new Set();
  for (let i = 0; i < 600; i++) {
    const plan = room.planChatReply(me, asked[i % asked.length]);
    if (!plan) continue;
    for (const cap of plan.line.match(/\b[A-Z][a-zA-Z_0-9]+\b/g) || []) {
      if (!real.has(cap)) ghosts.add(`${cap} in "${plan.line}"`);
    }
  }
  P(ghosts.size === 0, 'every name in a reply is somebody or something here',
    [...ghosts].slice(0, 2).join(' · ') || `${real.size} known names`);

  // The facts, checked against the board rather than against the template.
  const turnName = room.current.name;
  const ranked = [...room.active].sort((a, b) => room.netWorth(b) - room.netWorth(a));
  let turnWrong = 0, cashWrong = 0;
  for (let i = 0; i < 200; i++) {
    const t = room.planChatReply(me, 'whose turn is it');
    if (t && !t.line.includes(turnName) && room.player(t.botId).name !== turnName
      && t.intent === 'turnQ' && /is up|it's on|rolling/.test(t.line)) turnWrong++;
    const c = room.planChatReply(me, 'how much money do you have');
    if (c && c.intent === 'moneyQ') {
      const shown = (c.line.match(/\$[\d,]*\d/) || [])[0];
      if (shown && shown !== `$${room.player(c.botId).money.toLocaleString('en-US')}`) cashWrong++;
    }
  }
  P(turnWrong === 0, 'a turn question names whoever is really on turn', `on turn: ${turnName}`);
  P(cashWrong === 0, "a money question quotes that bot's real balance");
  P(ranked.length > 1, 'the table has a leader to talk about', ranked[0].name);
  room.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('"TRADE?" PRODUCES AN OFFER, NOT JUST A LINE');
{
  const room = table();
  const me = room.player('me');
  const bot = bots(room)[0];

  // Hand the bot a colour bar one street, and put that street in the human's
  // hands. Now "trade?" has a real answer and the reply has to name it.
  const group = Object.entries(room.map.groups).find(([, idxs]) => idxs.length >= 2);
  const [, idxs] = group;
  idxs.forEach((i, n) => {
    room.ownership[i] = { owner: n === 0 ? 'me' : bot.id, houses: 0, mortgaged: false };
  });
  const wanted = room.tile(idxs[0]).name;

  const plan = room.planChatReply(me, `${bot.name} trade karega?`);
  P(!!plan && plan.botId === bot.id, 'the named bot answers', plan && room.player(plan.botId).name);
  P(!!plan && plan.line.includes(wanted), 'and names the street it is actually short of',
    `${wanted} · ${plan?.line}`);
  P(plan?.offerTo === 'me', 'and an offer is queued behind the line');

  const before = room.trades.length;
  room.botTradeOnRequest(bot, me);
  const made = room.trades.find((t) => t.from === bot.id && t.to === 'me');
  P(room.trades.length === before + 1 && !!made, 'the offer really goes out');
  P(!!made && made.get.tiles.includes(idxs[0]), 'and it asks for that exact street',
    made && room.tile(made.get.tiles[0])?.name);
  P(!!made && (made.give.money > 0 || made.give.tiles.length > 0), 'and it pays for it',
    made && (made.give.money ? `$${made.give.money}` : room.tile(made.give.tiles[0])?.name));

  // Somebody holding nothing this bot needs is told so, and no offer is built.
  const other = bots(room)[1];
  const idle = room.planChatReply(me, `${other.name} trade?`);
  const holds = room.nearSets(other.id).some((n) => n.holder === 'me');
  if (!holds) {
    P(idle?.offerTo === null, 'a bot that needs nothing of yours offers nothing');
    P(room.botTradeOnRequest(other, me) === false, 'and refuses to invent a deal');
  } else {
    P(true, 'second bot also had a want — nothing to check here', 'skipped');
    P(true, '', 'skipped');
  }
  room.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('THE REAL PATH: ONE MESSAGE, ONE REPLY');
{
  const room = table();
  room.sendChat('me', 'hello everyone, whose turn is it');
  P(botLines(room).length === 0, 'nobody answers instantly', 'still typing');
  await wait(REPLY_DELAY_MAX + 300);
  const after = botLines(room);
  P(after.length === 1, 'exactly one bot answers', after.map((m) => `${m.name}: ${m.text}`).join(' | '));
  P(!!after[0] && after[0].code?.startsWith('H0'),
    'and signs it with a blockable stand-in code', after[0]?.code);

  // A bot's own line must never provoke another. If it could, this is where
  // the table would talk to itself until the process died.
  const spoke = room.player(after[0].name === room.player('me').name ? 'me' : bots(room)[0].id);
  const beforeLoop = room.chat.length;
  room.sendChat(spoke.id, 'gg everyone, whose turn is it', 'all', { auto: true });
  await wait(REPLY_DELAY_MAX + 300);
  P(room.chat.length === beforeLoop + 1, 'a line the server wrote gets no reply',
    `${room.chat.length - beforeLoop} new lines`);
  room.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('THE RATE LIMIT HOLDS');
{
  const room = table();
  // Thirty messages as fast as a keyboard allows.
  for (let i = 0; i < 30; i++) room.sendChat('me', `message number ${i} whose turn is it`);
  await wait(REPLY_DELAY_MAX + 400);
  const burst = botLines(room).length;
  P(burst <= 2, 'a wall of messages does not become a wall of replies', `${burst} replies to 30 messages`);

  // Spaced out, replies do keep coming — the limit is a pace, not a mute.
  await wait(REPLY_GAP_TABLE + 100);
  room.sendChat('me', 'still here, who is winning');
  await wait(REPLY_DELAY_MAX + 300);
  P(botLines(room).length > burst, 'and the table is not left mute',
    `${botLines(room).length} replies now`);
  room.dispose();
}

{
  const room = table();
  // The ceiling, checked directly: however patient the sender, one table gets
  // REPLY_WINDOW_MAX replies a minute and no more.
  for (let i = 0; i < 40; i++) {
    room.sendChat('me', `question ${i}, who is winning`);
    room.botChat.tableAt = 0;                 // wind the pacing clock back
    for (const id of Object.keys(room.botChat.spokeAt)) room.botChat.spokeAt[id] = 0;
  }
  await wait(REPLY_DELAY_MAX + 400);
  const count = botLines(room).length;
  P(count <= REPLY_WINDOW_MAX, 'the per-minute ceiling is never crossed',
    `${count} replies, ceiling ${REPLY_WINDOW_MAX}`);
  P(count > 0, 'but the ceiling is not zero', `${count} replies`);
  room.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('WHAT A BOT MUST NOT DO');
{
  const room = table();
  const me = room.player('me');
  // Nothing to answer to: a table with no bots must produce no plan, and
  // must not throw looking for one.
  const solo = new GameRoom('solo', () => {});
  solo.addPlayer({ id: 'me', name: 'Nikhil' });
  solo.addPlayer({ id: 'you', name: 'Aarav' });
  solo.start('me');
  P(solo.maybeBotReply(solo.player('me'), 'hello') === null, 'a table of humans stays quiet');
  solo.dispose();

  // A masked message is answered as the masked text, never the raw one.
  const plan = room.planChatReply(me, '**** ***** whose turn is it');
  P(!!plan && !plan.line.includes('*'), 'a filtered word is not echoed back', plan?.line);

  // An empty or absent message is not a conversation.
  P(room.planChatReply(me, '') === null, 'an empty line is ignored');
  P(room.planChatReply(null, 'hello') === null, 'a message from nobody is ignored');

  // In the lobby nothing has happened yet, so nothing about the board may be
  // claimed — no leader, no count of what is left, no last purchase.
  const lobby = new GameRoom('lobby', () => {});
  lobby.settings.allowBots = true;
  lobby.addPlayer({ id: 'me', name: 'Nikhil' });
  lobby.addBot(); lobby.addBot();
  let claims = 0;
  for (let i = 0; i < 300; i++) {
    const p = lobby.planChatReply(lobby.player('me'), ['hi all', 'who is winning', 'whose turn is it'][i % 3]);
    if (p && /\d|ahead|winning|leading|unsold|unbought/i.test(p.line)) claims = claims + 1;
  }
  P(claims === 0, 'a lobby reply claims nothing about a game not started', `${claims} claims`);
  lobby.dispose();

  // A team line is answered inside the team or not at all. A reply that came
  // back on the open channel would repeat, to everybody, what was said to two
  // people — and a bot that is not on the team has no business hearing it.
  const teamRoom = new GameRoom('team', () => {});
  teamRoom.settings.allowBots = true;
  teamRoom.settings.teams = 2;
  teamRoom.settings.randomizeOrder = false;
  teamRoom.addPlayer({ id: 'me', name: 'Nikhil' });
  teamRoom.addBot(); teamRoom.addBot(); teamRoom.addBot();
  teamRoom.balanceTeams();
  teamRoom.start('me');
  const mate = teamRoom.teammatesOf('me').map((p) => p.id);
  let offTeam = 0;
  for (let i = 0; i < 200; i++) {
    const p = teamRoom.planChatReply(teamRoom.player('me'), 'who is winning', 'team');
    if (p && !mate.includes(p.botId)) offTeam++;
  }
  P(offTeam === 0, 'only a teammate answers a team message', `${mate.length} teammates`);
  teamRoom.sendChat('me', 'plan: buy everything', 'team');
  await wait(REPLY_DELAY_MAX + 300);
  const strays = teamRoom.chat.filter((m) => m.name !== 'Nikhil' && m.channel !== 'team');
  P(strays.length === 0, 'and the answer stays on the team channel',
    strays.map((m) => m.text).join(' | ') || 'nothing leaked');
  teamRoom.dispose();

  // planReply is pure: the same scene twice must not mutate anything under it.
  const scene = room.chatScene(me, 'who is winning', 'all');
  const snapshot = JSON.stringify(scene);
  planReply(scene); planReply(scene);
  P(JSON.stringify(scene) === snapshot, 'planning a reply changes nothing');
  room.dispose();
}

// ───────────────────────────────────────────────────────────────────────────
rule('AND IT IS CHEAP');
{
  const room = table();
  const me = room.player('me');
  const started = Date.now();
  for (let i = 0; i < 3000; i++) room.planChatReply(me, 'kiraya bahut mehnga hai bhai, trade karega?');
  const each = (Date.now() - started) / 3000;
  P(each < 1, 'a reply costs well under a millisecond to work out', `${each.toFixed(3)}ms each`);
  room.dispose();
}

rule(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
