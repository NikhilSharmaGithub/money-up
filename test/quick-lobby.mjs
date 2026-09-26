// The Play-now lobby: a table that searches, then waits for Ready, then deals.
//
// Matchmaking used to deal the moment its fuse burnt down. Now a Play-now
// table searches for people, then sits in a lobby where the host gets Start,
// everyone else gets Ready, the host may re-deal what the table rolled, and a
// clock deals anyway so an idle host cannot hold strangers for ever. All of it
// runs on timers, so this test runs it on real ones — shrunk from seconds to
// milliseconds, the same machine at a hundredth of the speed:
//
//   · the search refuses Start, and a table full of people stops searching
//   · the host is always the person who has been there longest
//   · empty chairs fill with house players that look and act like people
//   · Start waits for Ready; the clock does not
//   · the host may change the rolled rules and nothing else, and a change
//     un-readies the table and says so
//   · the deadline formula, case by case, including the hard stop
//   · a chair somebody walks out of is held for a person, then back-filled
//   · the last one out empties the table, and the next one in starts over
//   · builds with no Ready button are never waited on
//   · matchmaking's choice of table
//   · and the same contract over a real socket, against a real server
//
//   node test/quick-lobby.mjs
//
// The scenarios are independent tables, so they run side by side and report
// in order; the socket block starts its own server process and stops it.

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import {
  GameRoom, QUICK_HOST_KEYS, QUICK_ROLL_KEYS, rollQuickSettings, pickQuickRoom,
} from '../server/game.js';
import { diff, applyPatch } from '../server/delta.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const rule = (t) => console.log(`\n${'─'.repeat(78)}\n  ${t}\n${'─'.repeat(78)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Poll until `cond` holds or `ms` runs out; says which. It returns the moment
 * the condition holds, so a generous ceiling costs a quiet machine nothing and
 * keeps a busy one — a compile running next door — from failing a table that
 * was merely late. What the checks below lean on instead is the one thing a
 * timer does promise: it never fires early.
 */
const PATIENCE = 3000;
async function until(cond, ms = PATIENCE) {
  const end = Date.now() + ms;
  for (;;) {
    if (cond()) return true;
    if (Date.now() > end) return false;
    await sleep(5);
  }
}

// The house clocks at about a hundredth of the speed. The start window is
// five times the search and the hard stop sits past it, as they do live, so
// every rule below has room to show itself.
const Q = {
  gatherMs: 300,
  botWindowMs: 150,
  startWindowMs: 1500,
  settleMs: 300,
  hardStopMs: 2400,
  backfillMs: 400,
  botReadyMs: [10, 40],
  joinCutoffMs: 100,
};
GameRoom.QUICK = { ...Q };

const made = [];
/** A Play-now table on the classic board. `seconds` stretches its search. */
function table(id, seconds, rolled = rollQuickSettings(['classic'])) {
  const r = new GameRoom(id, () => {});
  r.makeQuickMatch(seconds, rolled);
  made.push(r);
  return r;
}
const quickTimers = (r) => Object.keys(r.timers).filter((k) => k.startsWith('quick'));
const botsOf = (r) => r.players.filter((p) => p.isBot);
const othersReady = (r) => r.players.every((p) => p.id === r.hostId || p.ready);

const scenarios = [];
const scenario = (title, fn) => scenarios.push({ title, fn });

// ───────────────────────────────────────────────────────────────────────────
scenario('THE SEARCH', async (P) => {
  const r = table('search');
  r.addPlayer({ id: 'asha', name: 'Asha' });
  const opened = r.quickLobby.gatherUntil;
  let s = r.serialize();
  P(s.quickLobby?.phase === 'gathering', 'a fresh table is searching', s.quickLobby?.phase);
  P(s.quickStartAt === s.quickLobby.startBy, 'an old build counts down to the moment the lobby does',
    `${s.quickStartAt} / ${s.quickLobby.startBy}`);
  P(s.quickLobby.startBy === s.quickLobby.gatherUntil + Q.startWindowMs,
    'and that moment is a start window after the search');
  P(r.hostId === 'asha', 'the first person to sit down is the host');
  const early = r.requestStart('asha');
  P(/^Still finding players/.test(early?.error || ''), 'Start is refused while it searches', early?.error || 'started');
  r.addPlayer({ id: 'bina', name: 'Bina' });
  P(r.requestStart('bina')?.error === 'Only the host can start the game', 'nobody else may press it at all');
  P(r.setReady('bina', true)?.ok && r.player('bina').ready, 'but Ready works from the moment you sit');
  P(r.setReady('bina', false)?.ok && !r.player('bina').ready, 'and can be taken back');
  P(r.setReady('ghost', true)?.error === 'Take a seat first', 'a spectator has nothing to be ready for');
  P(r.setReady('asha', true)?.ok && !r.player('asha').ready, 'and the host\'s Ready is a quiet no-op');
  P(r.status === 'lobby', 'and none of that dealt anything');

  await until(() => r.players.length === 4);
  const arrivals = r.log.filter((l) => l.kind === 'join' && !['Asha', 'Bina'].includes(l.text.split(' joined')[0]));
  P(botsOf(r).length === 2, 'the empty chairs fill with house players', `${botsOf(r).length} of them`);
  P(arrivals.length === 2 && arrivals.every((l) => l.at >= opened - Q.botWindowMs - 5),
    'and not before the last stretch of the search',
    arrivals.map((l) => `${l.at - opened}ms`).join(', '));

  await until(() => !r.quickSearching() && botsOf(r).every((b) => b.ready));
  s = r.serialize();
  P(s.players.every((p) => p.isBot === false), 'not one of them is labelled a house player');
  P(botsOf(r).every((b) => s.players.find((p) => p.name === b.name)?.ready === true),
    'and each says it is ready a moment after sitting down');
  P(s.quickLobby.phase === 'ready' && s.quickLobby.waitingOn === 1 && s.quickLobby.canStart === false,
    'the search is over, and the lobby waits on the one person', JSON.stringify({ ...s.quickLobby, editable: undefined }));
  P(s.players.find((p) => p.id === 'asha')?.ready === false, 'the host has a Start, not a Ready');
  r.setReady('bina', true);
  P(r.serialize().quickLobby.canStart === true, 'one tap from them and Start opens');

  const go = r.requestStart('asha');
  P(go?.ok && r.status === 'playing', 'the host deals', go?.error || r.status);
  P(quickTimers(r).length === 0, 'and not one lobby timer outlives the lobby', quickTimers(r).join(', ') || 'none');
  s = r.serialize();
  P(s.quickLobby === null && s.quickStartAt === null && s.players.every((p) => p.ready === false),
    'the lobby is gone from the state, and so is every Ready');
  const twice = r.requestStart('asha');
  P(twice?.error === 'The game has already started' && r.status === 'playing',
    'a second press deals nothing twice', twice?.error || 'accepted');
  P(r.setReady('bina', false)?.ok === true && r.player('bina').ready === false,
    'a Ready that crossed the deal on the wire is not an error');
  r.dispose();
});

// ───────────────────────────────────────────────────────────────────────────
scenario('THE HOST IS A PERSON', async (P) => {
  const r = table('host', 3600);
  r.addPlayer({ id: 'asha', name: 'Asha' });
  r.endGathering();
  P(botsOf(r).length === 3 && r.hostId === 'asha', 'three house players in, and the host is still the person');
  const newest = botsOf(r).at(-1);
  P(!!r.timers[`quickBotReady:${newest.id}`], 'the newest house player is about to say it is ready');
  // Not on the next tick: a seat that is ready the instant it appears is the
  // one that is not a person. (_idleTimeout is the delay Node armed it with.)
  const pause = r.timers[`quickBotReady:${newest.id}`]?._idleTimeout;
  P(pause >= Q.botReadyMs[0] && pause <= Q.botReadyMs[1], 'after the pause a person would take', `${pause}ms`);
  r.addPlayer({ id: 'bina', name: 'Bina' });
  P(!r.player(newest.id), 'a person arriving at a full table takes the newest house player\'s chair');
  P(!r.timers[`quickBotReady:${newest.id}`], 'and the Ready it was about to press goes with it');

  r.removePlayer('asha');
  P(r.players[0].isBot, 'a house player now sits earliest at the table', r.players.map((p) => p.name).join(', '));
  P(r.hostId === 'bina', 'but the chair goes to the person who has been there longest', r.hostId);
  P(r.log.some((l) => l.text === 'Bina is the host now'), 'and the table is told', r.log.at(-1)?.text);

  const handed = r.makeHost('bina', r.players[0].id);
  P(/whoever has been there longest/.test(handed?.error || ''), 'the chair cannot be handed on here', handed?.error);
  r.status = 'ended';
  const again = r.rematch('bina');
  P(/breaks up when it ends/.test(again?.error || '') && r.status === 'ended',
    'and a Play-now table has no rematch', again?.error);
  r.dispose();
});

// ───────────────────────────────────────────────────────────────────────────
scenario('A TABLE OF PEOPLE STOPS LOOKING', async (P) => {
  const r = table('full', 60);
  for (const n of ['Asha', 'Bina', 'Cyra', 'Devi']) r.addPlayer({ id: n.toLowerCase(), name: n });
  const s = r.serialize();
  P(!r.quickSearching() && s.quickLobby.phase === 'ready', 'a table full of people stops searching at once',
    `${Math.round((r.quickLobby.gatherUntil - Date.now()) / 1000)}s of search left`);
  P(!r.timers.quickGather && !quickTimers(r).some((k) => k.startsWith('quickSeat')),
    'with nothing left on the clock to look for anybody');
  P(s.quickLobby.startBy - s.quickLobby.gatherUntil === Q.startWindowMs,
    'the start window runs from now, not from the old end of the search');
  P(r.players.every((p) => !p.isBot), 'and no house player took anybody\'s seat');
  P(r.addPlayer({ id: 'eli', name: 'Eli' })?.error === 'Room is full', 'a fifth person is turned away, not seated');
  r.dispose();
});

// ───────────────────────────────────────────────────────────────────────────
scenario('READY, AND THE RULES', async (P) => {
  const r = table('rules', 3600);
  r.addPlayer({ id: 'asha', name: 'Asha' });
  r.addPlayer({ id: 'bina', name: 'Bina' });
  r.addPlayer({ id: 'olde', name: 'Olde', canReady: false });
  r.endGathering();
  const bot = botsOf(r)[0];
  await until(() => bot.ready);
  r.setReady('bina', true);
  const x = r.settings.auction;
  const settledBefore = r.quickLobby.settledAt;

  const mixed = r.updateSettings('asha', { auction: !x, turnSeconds: 30 });
  P(mixed?.error === 'A Play-now table keeps its seats, privacy, house players, teams and clock',
    'a patch with a locked key is refused whole', mixed?.error || 'accepted');
  P(r.settings.auction === x && r.settings.turnSeconds === 90, 'the allowed half of it did not sneak through');
  P(r.updateSettings('bina', { auction: !x }) === undefined && r.settings.auction === x,
    'nobody but the host may change a thing');

  const logLen = r.log.length;
  const same = r.updateSettings('asha', { auction: x });
  P(!same?.error && r.player('bina').ready && bot.ready && r.quickLobby.settledAt === settledBefore,
    'a patch that changes nothing un-readies nobody');
  P(r.log.length === logLen, 'and is not announced');

  const changedAt = Date.now();
  r.updateSettings('asha', { auction: !x });
  P(r.settings.auction === !x, 'a rolled rule is the host\'s to change');
  P(!r.player('bina').ready && !bot.ready, 'everyone who was ready is asked again — the house included');
  P(r.player('olde').ready, 'except a seat that has no Ready button to press');
  P(r.quickLobby.settledAt >= changedAt, 'and the table settles from the change');
  P(r.log.at(-1)?.text === `Asha changed the rules: auctions ${!x ? 'on' : 'off'}`,
    'the log says who changed what', r.log.at(-1)?.text);
  P(JSON.stringify(r.serialize().quickRoll?.edited) === '["auction"]', 'the lobby knows which rule moved',
    JSON.stringify(r.serialize().quickRoll?.edited));
  P(await until(() => bot.ready), 'the house player says it is ready again after a pause');

  const cash = r.settings.startingCash === 1500 ? 3000 : 1500;
  r.updateSettings('asha', { startingCash: cash });
  P(r.players.every((p) => p.money === cash), 'every seat\'s money follows the bankroll', `$${cash}`);
  P(r.log.at(-1)?.text === `Asha changed the rules: $${cash.toLocaleString('en-US')} to start`,
    'in the words the chips use', r.log.at(-1)?.text);

  r.hooks.mayUseBoard = (token, mapId) => mapId === 'classic' || (token === 'asha' && mapId === 'blitz');
  r.updateSettings('asha', { mapId: 'blitz' });
  P(r.map.id === 'blitz' && r.serialize().quickRoll.edited.includes('mapId'),
    'the host may put down a board they own', r.log.at(-1)?.text);
  const locked = r.updateSettings('asha', { mapId: 'deathvalley' });
  P(/locked/.test(locked?.error || '') && r.map.id === 'blitz', 'but not one they do not', locked?.error);

  r.updateSettings('asha', { auction: x });
  P(!r.serialize().quickRoll.edited.includes('auction'), 'a rule put back is no longer marked as changed',
    JSON.stringify(r.serialize().quickRoll.edited));

  // The chips say "on" or "off"; whatever a socket sends, that is all a
  // switch at a stranger's table may hold.
  const eb = r.settings.evenBuild;
  r.updateSettings('asha', { evenBuild: eb ? 0 : 'yes' });
  P(r.settings.evenBuild === !eb, 'a switch is stored as a switch, whatever the wire sent',
    JSON.stringify(r.settings.evenBuild));

  await until(() => bot.ready);
  const one = r.requestStart('asha');
  P(one?.error === 'Waiting for Bina to get ready', 'Start names who it is waiting for', one?.error || 'started');
  bot.ready = false;
  const two = r.requestStart('asha');
  P(two?.error === 'Waiting for Bina and 1 more to get ready', 'and counts the rest', two?.error || 'started');
  bot.ready = true;
  r.setReady('bina', true);

  r.removePlayer('asha');
  P(r.hostId === 'bina', 'the host walks out and the next person has the chair');
  const go = r.requestStart('bina');
  P(go?.ok && r.status === 'playing', 'the new host deals, the empty chair filled on the way', go?.error || r.status);
  P(r.map.id === 'classic' && r.log.some((l) => /not unlocked for the new host/.test(l.text)),
    'on a board the new host may actually use', r.map.id);
  P(r.players.length === 4 && quickTimers(r).length === 0, 'four seats, and no backfill left on the clock',
    quickTimers(r).join(', ') || 'none');
  r.dispose();
});

// ───────────────────────────────────────────────────────────────────────────
scenario('THE DEADLINE, CASE BY CASE', async (P) => {
  // A search a day long, so no timer here fires while the clock is being
  // read; the lobby's numbers are then set by hand and the formula checked.
  const r = table('deadline', 86_400);
  r.addPlayer({ id: 'asha', name: 'Asha' });
  for (let i = 0; i < 3; i++) r.addBot();
  await until(() => othersReady(r));
  // Everything below is synchronous: nothing can move the lobby under it.
  const L = r.quickLobby;
  const T = Date.now();
  const at = (fields) => {
    Object.assign(L, fields);
    r.scheduleQuick();
    return L.startBy;
  };
  const armed = () => !!r.timers.quick && r.quickStartAt === L.startBy;
  const bot = botsOf(r)[0];

  bot.ready = false;
  let got = at({ gatherUntil: T, hardStopAt: T + Q.hardStopMs, settledAt: 0, allSetAt: null });
  P(got === T + Q.startWindowMs && armed(), 'the start window: a table that is not ready deals at its end',
    `+${got - T}ms`);

  got = at({ settledAt: T + 1400 });
  P(got === T + 1400 + Q.settleMs, 'a change late in it pushes the deal a settle past the change', `+${got - T}ms`);

  bot.ready = true;
  got = at({ settledAt: T - 5000, allSetAt: null });
  const firstSet = L.allSetAt;
  P(firstSet != null && got === T + Q.startWindowMs && armed(),
    'every seat ready unlocks Start but does not pull the deal in — the host deals', `+${got - T}ms`);

  got = at({ allSetAt: T - 200 });
  P(L.allSetAt === T - 200 && got === T + Q.startWindowMs,
    'however long they have been ready, the clock is still the start window', `+${got - T}ms`);

  got = at({ settledAt: T + 700 });
  P(got === Math.max(T + Q.startWindowMs, T + 700 + Q.settleMs),
    'an arrival or a change after that still gets its settle', `+${got - T}ms`);

  bot.ready = false;
  got = at({});
  P(L.allSetAt === null && got === T + Q.startWindowMs,
    'one seat un-readied: the start window, as before', `+${got - T}ms`);

  got = at({ settledAt: L.hardStopAt - 100 });
  P(got === L.hardStopAt, 'no change, however late, pushes past the hard stop', `+${got - T}ms`);

  bot.ready = true;
  got = at({ allSetAt: T + 1400, settledAt: 0 });
  P(got === T + Q.startWindowMs, 'being ready never makes the wait longer', `+${got - T}ms`);

  // A real arrival rather than a number set by hand. The table was all set a
  // while ago and is due to deal; an old build sits down in a house player's
  // chair, so the table is all set still — but the newcomer gets a settle to
  // read it before it deals, not a table leaving under them.
  got = at({ gatherUntil: T - 1000, settledAt: 0, allSetAt: T - 500, searchOver: true });
  const came = Date.now();
  r.addPlayer({ id: 'olde', name: 'Olde', canReady: false });
  P(got === T - 1000 + Q.startWindowMs && L.allSetAt === T - 500 && L.startBy >= came + Q.settleMs,
    'someone new after the search gets a settle before the deal', `+${L.startBy - came}ms`);
  r.dispose();
});

// ───────────────────────────────────────────────────────────────────────────
scenario('THE CLOCK DEALS', async (P) => {
  // Somebody never presses Ready. They have had the start window to read the
  // table; the table deals and they play.
  const idle = table('clock-idle');
  idle.addPlayer({ id: 'asha', name: 'Asha' });
  idle.addPlayer({ id: 'bina', name: 'Bina' });
  await until(() => !idle.quickSearching());
  const due = idle.quickLobby.startBy;
  P(due === idle.quickLobby.gatherUntil + Q.startWindowMs, 'with someone unready it waits out the start window');
  await until(() => idle.status !== 'lobby', Q.startWindowMs + PATIENCE);
  const dealt = idle.log.find((l) => l.text === 'Game started! Good luck.')?.at || 0;
  P(idle.status === 'playing' && dealt >= due - 2 && dealt - due < 600, 'and then deals by itself',
    `${dealt - due}ms after the deadline`);
  P(!!idle.player('bina') && !idle.player('bina').bankrupt, 'the player who never pressed Ready plays');
  idle.dispose();

  // Everyone ready and nobody pressing Start: Start is there for the host
  // for the whole window — a host still watching the ad their tap opened
  // must not come back to a game already dealt — and only then the clock.
  const keen = table('clock-keen');
  keen.addPlayer({ id: 'asha', name: 'Asha' });
  keen.addPlayer({ id: 'bina', name: 'Bina' });
  keen.setReady('bina', true);
  const searchEnd = keen.quickLobby.gatherUntil;
  await until(() => !keen.quickSearching());
  await sleep(Q.settleMs + 50);
  P(keen.status === 'lobby' && keen.quickLobbyView()?.canStart === true,
    'all ready, a settle after the search: still the lobby, and the host may Start');
  await until(() => keen.status !== 'lobby', Q.startWindowMs + PATIENCE);
  const keenAt = keen.log.find((l) => l.text === 'Game started! Good luck.')?.at || Infinity;
  P(keen.status === 'playing', 'a host who never presses Start is dealt in by the clock');
  P(keenAt - searchEnd >= Q.startWindowMs - 2 && keenAt - searchEnd < Q.startWindowMs + 600,
    'at the end of the start window, not a settle after the search', `${keenAt - searchEnd}ms after it`);
  keen.dispose();

  // A table nobody ever sat down at does nothing when its time comes.
  const empty = table('clock-empty');
  const emptyDue = empty.quickLobby.startBy;
  await sleep(Math.max(0, emptyDue - Date.now()) + 150);
  P(empty.status === 'lobby' && empty.players.length === 0, 'an empty table never deals itself');
  P(!!empty.launchQuick()?.error, 'the house does not play itself');
  empty.dispose();

  // A host who keeps changing the rules. Each change un-readies the table
  // and buys a settle — until the hard stop, which nothing buys past.
  const busy = table('clock-busy');
  busy.addPlayer({ id: 'asha', name: 'Asha' });
  await until(() => !busy.quickSearching());
  const stop = busy.quickLobby.hardStopAt;
  let overshoot = 0;
  let undersettled = 0;
  let changes = 0;
  while (busy.status === 'lobby' && Date.now() < stop + PATIENCE) {
    // Read the clock before the change: the settle it buys counts from a
    // moment no earlier than this, however long the change itself takes.
    const before = Date.now();
    busy.updateSettings('asha', { auction: !busy.settings.auction });
    changes++;
    const L = busy.quickLobby;
    if (L.startBy > stop) overshoot++;
    if (L.startBy < Math.min(before + Q.settleMs, stop)) undersettled++;
    await sleep(200);
  }
  const busyAt = busy.log.find((l) => l.text === 'Game started! Good luck.')?.at || 0;
  P(overshoot === 0 && undersettled === 0, 'every change gets its settle, and none reaches past the hard stop',
    `${changes} changes`);
  P(busy.status === 'playing' && busyAt >= stop - 2 && busyAt - stop < 600, 'the hard stop deals the table',
    `${busyAt - stop}ms after it`);
  busy.dispose();
});

// ───────────────────────────────────────────────────────────────────────────
scenario('A CHAIR LEFT EMPTY', async (P) => {
  // After the search: the chair is held for a person, then the house takes it.
  const r = table('chair');
  r.addPlayer({ id: 'asha', name: 'Asha' });
  r.addPlayer({ id: 'bina', name: 'Bina' });
  await until(() => !r.quickSearching() && r.players.length === 4 && botsOf(r).every((b) => b.ready));
  const leftAt = Date.now();
  r.removePlayer('bina');
  const view = r.serialize().quickLobby;
  P(r.players.length === 3 && view.backfillAt >= leftAt + Q.backfillMs
    && view.backfillAt <= Date.now() + Q.backfillMs,
    'the chair is held open, and the lobby says until when', `${view.backfillAt - leftAt}ms`);
  await sleep(Q.backfillMs - 150);
  P(r.players.length === 3, 'nobody takes it early');
  P(await until(() => r.players.length === 4), 'then a house player sits down');
  const late = r.players.at(-1);
  P(late.isBot && await until(() => late.ready), 'and says it is ready like the rest');
  P((r.serialize().quickLobby?.backfillAt ?? null) === null, 'with nothing more held open');
  r.dispose();

  // A person gets there first: the house player is called off, and nobody
  // is pushed out to make room.
  const q = table('chair-person');
  q.addPlayer({ id: 'asha', name: 'Asha' });
  q.addPlayer({ id: 'bina', name: 'Bina' });
  await until(() => !q.quickSearching() && q.players.length === 4);
  const house = botsOf(q).map((b) => b.id).sort().join();
  q.removePlayer('bina');
  q.addPlayer({ id: 'cyra', name: 'Cyra' });
  P(!quickTimers(q).some((k) => k.startsWith('quickBackfill')) && q.quickBackfills.size === 0,
    'a person takes the held chair and its house player is called off');
  P(botsOf(q).map((b) => b.id).sort().join() === house, 'nobody is pushed out to make room');
  await sleep(Q.backfillMs + 150);
  P(q.players.length === 4 && botsOf(q).map((b) => b.id).sort().join() === house,
    'and nobody turns up for it later');
  q.dispose();

  // Early in a long search the chair simply goes back into the plan…
  const e = table('chair-early', 3);
  e.addPlayer({ id: 'asha', name: 'Asha' });
  e.addPlayer({ id: 'bina', name: 'Bina' });
  e.removePlayer('bina');
  P(e.quickBackfills.size === 0 && quickTimers(e).filter((k) => k.startsWith('quickSeat')).length === 3,
    'early in the search a freed chair goes back into the plan');
  e.dispose();

  // …but late in it, the chair is held past the end of the search.
  const l = table('chair-late');
  let atEnd = null;
  const endGathering = l.endGathering.bind(l);
  l.endGathering = (...a) => { endGathering(...a); atEnd = l.players.length; };
  l.addPlayer({ id: 'asha', name: 'Asha' });
  l.addPlayer({ id: 'bina', name: 'Bina' });
  l.removePlayer('bina');
  P(l.quickBackfills.size === 1, 'late in the search it is held for a person instead');
  // Somebody else sits down before the end, and the house re-plans around
  // them — without planning a house player for the chair already being held.
  l.addPlayer({ id: 'cyra', name: 'Cyra' });
  const planned = quickTimers(l).filter((k) => k.startsWith('quickSeat:')).length;
  P(l.quickBackfills.size === 1 && planned === 1, 'a re-plan leaves the held chair out of it',
    `${planned} planned, ${l.quickBackfills.size} held`);
  await until(() => atEnd !== null);
  P(atEnd === 3, 'the end of the search leaves it empty', `${atEnd} seated`);
  P(await until(() => l.players.length === 4), 'until its own time comes');
  l.dispose();
});

// ───────────────────────────────────────────────────────────────────────────
scenario('THE LAST ONE OUT', async (P) => {
  const r = table('last');
  r.addPlayer({ id: 'asha', name: 'Asha' });
  await until(() => !r.quickSearching() && r.players.length === 4);
  r.removePlayer('asha');
  P(r.players.length === 0 && r.hostId === null, 'the house players leave with the last person');
  P(quickTimers(r).length === 0, 'and nothing is left on the clock', quickTimers(r).join(', ') || 'none');
  const back = Date.now();
  r.addPlayer({ id: 'devi', name: 'Devi' });
  P(r.quickSearching() && r.quickLobby.gatherUntil >= back + Q.gatherMs
    && r.quickLobby.gatherUntil <= Date.now() + Q.gatherMs && r.hostId === 'devi',
    'the next person in starts the search from the top');
  P(await until(() => r.players.length === 4), 'and the table fills again around them');
  r.dispose();

  // Mid-search, too.
  const m = table('last-mid', 5);
  m.addPlayer({ id: 'asha', name: 'Asha' });
  P(quickTimers(m).some((k) => k.startsWith('quickSeat')), 'the house arrivals are planned');
  m.removePlayer('asha');
  P(!quickTimers(m).length, 'and called off when the only person leaves mid-search');
  m.dispose();
});

// ───────────────────────────────────────────────────────────────────────────
scenario('OLD BUILDS, AND PRIVATE TABLES', async (P) => {
  const r = table('old', 3600);
  r.addPlayer({ id: 'asha', name: 'Asha' });
  r.addPlayer({ id: 'old1', name: 'Oma', canReady: false });
  r.addPlayer({ id: 'old2', name: 'Opa', canReady: false });
  P(r.player('old1').ready && r.player('old2').ready, 'a build with no Ready button counts as ready');
  r.addPlayer({ id: 'bina', name: 'Bina' });
  P(r.requestStart('asha')?.error === 'Waiting for Bina to get ready', 'so Start waits only on those who can answer');
  r.updateSettings('asha', { evenBuild: !r.settings.evenBuild });
  P(r.player('old1').ready && r.player('old2').ready, 'and a rule change never un-readies them');
  r.setReady('bina', true);
  P(r.serialize().quickLobby.canStart === true, 'one tap from the one who can, and the host may start');
  P(r.requestStart('asha')?.ok && r.status === 'playing', 'and does');
  r.dispose();

  // An old build can be first in, and so hold the chair. It has no Start to
  // press either, so the clock deals — but a host is never asked to be ready,
  // and a tick beside the host's name would say it had been.
  const h = table('old-host', 3600);
  h.addPlayer({ id: 'olde', name: 'Olde', canReady: false });
  h.addPlayer({ id: 'newb', name: 'Newb' });
  const hs = h.serialize();
  P(h.hostId === 'olde' && hs.players.find((x) => x.id === 'olde')?.ready === false,
    'an old build holding the chair shows no tick', JSON.stringify(hs.players.map((x) => [x.name, x.ready])));
  P(hs.quickLobby.waitingOn === 1, 'and the lobby waits only on the one who can answer', `${hs.quickLobby.waitingOn}`);
  h.dispose();

  const p = new GameRoom('private', () => {});
  made.push(p);
  p.addPlayer({ id: 'me', name: 'Me' });
  P(p.setReady('me', true)?.error === 'Nothing to get ready for', 'a private table has no Ready');
  const s = p.serialize();
  P(s.quickLobby === null && s.players.every((x) => x.ready === false), 'nor any lobby in its state');
  p.addBot();
  P(p.requestStart('me')?.ok && p.status === 'playing', 'and starts on the host\'s word, as it always has');
  p.dispose();
});

// ───────────────────────────────────────────────────────────────────────────
scenario('MATCHMAKING', async (P) => {
  const now = Date.now();
  let n = 0;
  const room = (people, { bots = 0, startIn = 5000, quick = true, status = 'lobby', lobby = true } = {}) => {
    const r = new GameRoom(`mm${++n}`, () => {});
    made.push(r);
    if (quick) r.makeQuickMatch(3600);
    for (let i = 0; i < people; i++) r.addPlayer({ id: `mm${n}-${i}`, name: `P${i}` });
    for (let i = 0; i < bots; i++) r.addBot();
    if (r.quickLobby) r.quickLobby.startBy = now + startIn;
    if (!lobby) r.quickLobby = null;
    r.status = status;
    return r;
  };
  const A = room(2, { bots: 2, startIn: 20000 });
  const B = room(1, { startIn: 1000 });
  const C = room(3, { startIn: Q.joinCutoffMs - 50 });
  const D = room(1, { quick: false });
  const E = room(2, { status: 'playing' });
  const F = room(4);
  const G = room(2, { bots: 1, startIn: 30000 });
  const H = room(2, { bots: 2, startIn: 10000 });
  const I = room(3, { lobby: false });
  const all = [A, B, C, D, E, F, G, H, I];
  const order = [];
  const left = [...all];
  for (;;) {
    const pick = pickQuickRoom(left, now);
    if (!pick) break;
    order.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  const name = (r) => 'ABCDEFGHI'[all.indexOf(r)];
  P(order.map(name).join('') === 'GHAB', 'most people first, then an empty chair, then the soonest start',
    order.map(name).join(' > '));
  P(!order.includes(C), 'never a table about to deal before they can sit down');
  P(![D, E, F, I].some((r) => order.includes(r)), 'nor a private table, a game under way, or one full of people');

  // Sending somebody to a table holds its deal until they could be there.
  const x = table('mm-expect', 3600);
  x.addPlayer({ id: 'x0', name: 'X' });
  x.endGathering();
  Object.assign(x.quickLobby, { gatherUntil: Date.now() - (Q.startWindowMs - Q.joinCutoffMs - 100), settledAt: 0 });
  x.scheduleQuick();
  P(pickQuickRoom([x], Date.now()) === x, 'a table a moment from dealing can still be picked');
  let pushed = 0;
  x.onUpdate = () => { pushed++; };
  x.expectArrival();
  P(x.quickLobby.startBy >= Date.now() + Q.settleMs - 5 && pushed === 1,
    'and picking it holds the deal a settle for the newcomer, and says so',
    `+${x.quickLobby.startBy - Date.now()}ms`);
  for (const r of [...all, x]) r.dispose();
});

// ───────────────────────────────────────────────────────────────────────────
scenario('THE STATE EVERY CLIENT READS', async (P) => {
  const r = table('state', 3600);
  r.addPlayer({ id: 'asha', name: 'Asha' });
  r.addPlayer({ id: 'bina', name: 'Bina' });
  const before = r.serializeFor(['bina']);
  const view = before.quickLobby;
  P(JSON.stringify(Object.keys(view).sort())
    === JSON.stringify(['backfillAt', 'canStart', 'editable', 'gatherUntil', 'phase', 'startBy', 'waitingOn']),
  'quickLobby carries exactly its seven fields', Object.keys(view).join(', '));
  P(JSON.stringify(view.editable) === JSON.stringify(QUICK_HOST_KEYS)
    && QUICK_HOST_KEYS.length === QUICK_ROLL_KEYS.length + 1 && QUICK_HOST_KEYS.includes('mapId'),
  'editable is what the table rolled, plus the board', view.editable.join(', '));
  P(before.players.every((p) => typeof p.ready === 'boolean'), 'every seat carries a ready flag');
  P(Array.isArray(before.quickRoll?.edited) && before.quickRoll.edited.length === 0, 'and the roll an empty edited list');
  P(before.players.some((p) => p.id === 'bina') && before.hostId !== 'asha',
    'a viewer still sees only their own real id');

  r.setReady('bina', true);
  const after = r.serializeFor(['bina']);
  const patched = applyPatch(JSON.parse(JSON.stringify(before)), diff(before, after));
  P(patched.players.find((p) => p.id === 'bina')?.ready === true
    && JSON.stringify(patched.quickLobby) === JSON.stringify(after.quickLobby),
  'a Ready rides the ordinary state patch');
  r.dispose();
});

// ═══════════════════════════════════════════════════════════════════════════
const results = await Promise.all(scenarios.map(async (s) => {
  const lines = [];
  let bad = 0;
  const P = (ok, l, d = '') => {
    if (!ok) bad++;
    lines.push(`${ok ? '  PASS' : '  X FAIL'}  ${l.padEnd(56)} ${d}`);
  };
  try {
    await s.fn(P);
  } catch (err) {
    bad++;
    lines.push(`  X FAIL  the scenario threw — ${err?.stack || err}`);
  }
  return { title: s.title, lines, bad };
}));
for (const res of results) {
  rule(res.title);
  for (const l of res.lines) console.log(l);
  failed += res.bad;
}
for (const r of made) r.dispose();

// ═══════════════════════════════════════════════════════════════════════════
// Over the wire. A real server, with its lobby clocks shortened through
// MM_QUICK_MS, and real sockets: one new build, a second, and an old one.
rule('OVER A REAL SOCKET');
{
  const SQ = {
    gatherMs: 1500, botWindowMs: 400, startWindowMs: 6000, settleMs: 1500,
    hardStopMs: 10000, backfillMs: 400, botReadyMs: [10, 40], joinCutoffMs: 200,
  };
  let passed = 0;
  const P = (ok, l, d = '') => {
    if (ok) passed++; else failed++;
    console.log(`${ok ? '  PASS' : '  X FAIL'}  ${l.padEnd(56)} ${d}`);
  };
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-lobby-'));
  const sockets = [];
  let child = null;
  let log = '';
  const freePort = () => new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
  try {
    const port = await freePort();
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(APPLE_|GOOGLE_|APNS_|STRIPE_|FCM_)/.test(k)) delete env[k];
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: {
        ...env, PORT: String(port), DATA_DIR: tmpRoot, ADMIN_KEY: 'lobby-admin', MM_QUICK_MS: JSON.stringify(SQ),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    const url = `http://127.0.0.1:${port}`;
    let up = false;
    for (const end = Date.now() + 20000; !up && Date.now() < end && child.exitCode == null;) {
      try { up = (await fetch(`${url}/healthz`)).ok; } catch { /* not yet */ }
      if (!up) await sleep(100);
    }
    if (!up) throw new Error(`server did not start:\n${log}`);

    const chair = (name, { canReady = true } = {}) => {
      const token = `dev-${name.toLowerCase()}-${crypto.randomBytes(6).toString('hex')}`;
      const sock = io(url, { transports: ['websocket'], forceNew: true });
      sockets.push(sock);
      const c = { name, token, sock, state: null, toasts: [] };
      sock.on('state', (s) => { c.state = s; });
      sock.on('toast', (t) => c.toasts.push(t?.message || ''));
      c.emit = (...a) => sock.emit(...a);
      c.me = () => c.state?.players?.find((p) => p.id === token) || null;
      c.quickplay = () => new Promise((resolve) => {
        const t = setTimeout(() => resolve(''), 4000);
        sock.emit('quickplay', { token }, (d) => { clearTimeout(t); resolve(d?.roomId || ''); });
      });
      c.join = async (roomId) => {
        sock.emit('join', { roomId, token, name, ...(canReady ? { canReady: true } : {}) });
        return until(() => !!c.state, 2 * PATIENCE);
      };
      c.heard = (re, ms = PATIENCE) => until(() => c.toasts.some((m) => re.test(m)), ms);
      return c;
    };

    const asha = chair('Asha');
    const roomId = await asha.quickplay();
    await asha.join(roomId);
    const st = asha.state;
    P(st?.quick === true && st.quickLobby?.phase === 'gathering', 'Play now opens a lobby that is searching',
      st?.quickLobby?.phase);
    P(st.quickStartAt === st.quickLobby.startBy, 'with the old countdown on the same moment');
    P(st.hostId === asha.token && asha.me()?.ready === false, 'the first one in is host, and nobody is ready yet');

    asha.emit('start');
    P(await asha.heard(/^Still finding players/), 'Start during the search comes back as a toast',
      asha.toasts.at(-1));

    const bina = chair('Bina');
    const second = await bina.quickplay();
    P(second === roomId, 'the next Play now is sent to the table already waiting');
    await bina.join(second);
    const olde = chair('Olde', { canReady: false });
    P(await olde.quickplay() === roomId, 'and so is an old build');
    await olde.join(roomId);
    P(await until(() => olde.me()?.ready === true), 'which is counted as ready from the moment it sits');
    // Connected now, so that when Dee taps Play now below it is one round
    // trip and not a handshake as well.
    const dee = chair('Dee');

    const binaAlias = asha.state.players.find((p) => p.name === 'Bina')?.id;
    asha.emit('kick', binaAlias);
    P(await asha.heard(/^Nobody is removed from a Play-now table/), 'the host cannot throw a stranger out');
    asha.emit('addBot');
    P(await asha.heard(/^A Play-now table fills its own seats/), 'or seat a house player of their own');
    asha.emit('makeHost', { id: binaAlias });
    P(await asha.heard(/whoever has been there longest/), 'or hand the chair on');

    P(await until(() => asha.state?.quickLobby?.phase === 'ready' && asha.state.players.length === 4
      && asha.state.quickLobby.waitingOn === 1, SQ.gatherMs + PATIENCE),
    'the search ends with the table full, waiting on one', JSON.stringify({
      phase: asha.state?.quickLobby?.phase, seats: asha.state?.players?.length, waitingOn: asha.state?.quickLobby?.waitingOn,
    }));
    asha.emit('start');
    P(await asha.heard(/^Waiting for Bina to get ready$/), 'Start says who it is waiting for', asha.toasts.at(-1));

    bina.emit('ready', true);
    P(await until(() => bina.me()?.ready === true), '"ready" round-trips');
    P(await until(() => asha.state?.quickLobby?.canStart === true), 'and the host sees Start open up');
    bina.emit('ready', false);
    P(await until(() => bina.me()?.ready === false && asha.state?.quickLobby?.canStart === false),
      'false takes it back');
    bina.emit('ready');
    P(await until(() => bina.me()?.ready === true), 'and a bare "ready" means yes');

    // The table is all set and a settle from dealing by itself. Somebody taps
    // Play now: the house player's chair is theirs for the taking, so they are
    // sent here — and the table holds its deal until they could be sitting in
    // it, rather than leaving the moment before they arrive.
    const asked = Date.now();
    P(await dee.quickplay() === roomId, 'a newcomer is sent to the table with a chair for them');
    P(await until(() => asha.state?.quickLobby?.startBy >= asked + SQ.settleMs),
      'and the table holds its deal until they could be in it',
      asha.state?.quickLobby ? `+${asha.state.quickLobby.startBy - asked}ms` : `already ${asha.state?.status}`);

    const pressed = Date.now();
    asha.emit('start');
    P(await until(() => asha.state?.status === 'playing'), 'the host deals');
    P(Date.now() - pressed < SQ.settleMs, 'on the button, not on the clock', `${Date.now() - pressed}ms`);
    P(asha.state.quickLobby === null && asha.state.quickStartAt === null
      && asha.state.players.every((p) => p.ready === false), 'and the lobby is gone from every seat\'s state');

    const pat = chair('Pat');
    await pat.join(`p${crypto.randomBytes(4).toString('hex')}`);
    pat.emit('ready', true);
    P(await pat.heard(/^Nothing to get ready for$/), 'a private table has no Ready to press');
  } catch (err) {
    failed++;
    console.error('\n  X FAIL  the socket run itself —', err?.stack || err);
    if (log) console.error(log.split('\n').slice(-20).join('\n'));
  } finally {
    for (const s of sockets) { try { s.disconnect(); } catch { /* gone */ } }
    if (child && child.exitCode == null) {
      child.kill('SIGTERM');
      const end = Date.now() + 5000;
      while (child.exitCode == null && Date.now() < end) await sleep(50);
      if (child.exitCode == null) child.kill('SIGKILL');
    }
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* leave it */ }
  }
  void passed;
}

rule(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
