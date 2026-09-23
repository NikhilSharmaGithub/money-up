// Server-authoritative game engine.
// Every rule lives here; clients only send intents and render what comes back.

import { createHash } from 'node:crypto';
import { getMap, GROUPS, MAPS } from './maps.js';
import { buildDecks, shuffled, cardTone } from './cards.js';
import { banter, cleanText, isAllMasked } from './banter.js';
import {
  planReply, REPLY_DELAY_MIN, REPLY_DELAY_MAX,
  REPLY_GAP_TABLE, REPLY_GAP_BOT, REPLY_GAP_ADDRESSED, REPLY_WINDOW, REPLY_WINDOW_MAX,
} from './botchat.js';
import { quickIdentity } from './names.js';

export const COLORS = [
  '#4ade80', '#60a5fa', '#f472b6', '#fbbf24',
  '#a78bfa', '#fb7185', '#22d3ee', '#f97316',
];

export const TEAMS = [
  { name: 'Crimson', color: '#f87171', icon: '🔴' },
  { name: 'Azure',   color: '#60a5fa', icon: '🔵' },
  { name: 'Jade',    color: '#4ade80', icon: '🟢' },
  { name: 'Amber',   color: '#fbbf24', icon: '🟡' },
];

export const DEFAULT_SETTINGS = {
  maxPlayers: 4,
  isPrivate: true,
  allowBots: false,
  mapId: 'classic',
  x2rent: true,
  vacationCash: true,
  auction: true,
  noRentInPrison: true,
  mortgage: true,
  evenBuild: true,
  startingCash: 2500,
  randomizeOrder: true,
  teams: 0, // 0 = free-for-all, otherwise how many teams share the board
  /** Seconds a human gets per turn before the table moves on. 0 turns it off. */
  turnSeconds: 90,
  /** Head-to-head only: frees a player who can never build (see noteLap). */
  deadlockRelief: true,
};

// ------------------------------------------------------- quick-match roll --
// Every matchmade table deals itself its own house rules, so two quick games
// in a row are not the same game twice. Only settings the engine already
// understands, and only values it already accepts — nothing here is invented.
//
// What is missing matters as much as what is in it. `mortgage` stays on:
// with it off, autoLiquidate can do nothing but raze houses, and an ordinary
// rent bill turns into a bankruptcy — not a rule to spring on four strangers.
// `deadlockRelief` stays on because it is the anti-stall valve. `teams` stays
// at nobody's side, because a matchmade table cannot ask strangers to pick
// one. `turnSeconds` stays at ninety, because a shorter clock on people who
// never agreed to it means timeouts, and a timeout costs the player karma.
// And the seats, the privacy and the house players belong to quick play
// itself, which sets them a moment later.
const QUICK_ROLL = {
  // The two he named, and three above them. Below a thousand, four players
  // spend the first lap in the red rather than buying anything.
  startingCash: [1000, 1500, 2000, 2500, 3000],
  x2rent: [true, false],
  vacationCash: [true, false],
  auction: [true, false],
  noRentInPrison: [true, false],
  evenBuild: [true, false],
};

/** The rules a quick table rolls, board aside. Exported so a test can read them. */
export const QUICK_ROLL_KEYS = Object.keys(QUICK_ROLL);

/** The values each of those rules may land on. A copy: callers may keep it. */
export const quickRollValues = (key) => [...(QUICK_ROLL[key] || [])];

/**
 * Deal one quick table's house rules.
 *
 * `boards` is whatever the caller says every player can sit down on today.
 * The calendar lives in boards.js and this file has no idea what day it is,
 * so the list is handed in rather than looked up; an empty one leaves the
 * board where it was, which is the house board.
 */
export function rollQuickSettings(boards = [], rnd = Math.random) {
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
  const rolled = {};
  for (const key of QUICK_ROLL_KEYS) rolled[key] = pick(QUICK_ROLL[key]);
  // A board nobody can play is worse than no roll at all, so an id this build
  // does not have is dropped rather than dealt.
  //
  // Shuffle is the exception that proves the rule: it is in the rotation like
  // any other board, but it has no entry in MAPS because getMap builds it
  // fresh every game. Testing for MAPS alone quietly threw it out on the two
  // days in nine it is free — which meant the one board that is a different
  // board every single game was the one board quick play would never deal.
  const playable = boards.filter((id) => id === 'random' || Object.hasOwn(MAPS, id));
  if (playable.length) rolled.mapId = pick(playable);
  return rolled;
}

/**
 * The rolled rules in the words a player would use, in reading order.
 *
 * Word for word the names the settings panel uses on both clients, and not a
 * second set of phrases meaning the same thing. "No rent from jail" read as a
 * rule about the player in prison; it is a rule about the OWNER in prison, who
 * collects nothing while they sit there. That is a rule about money, told to
 * four strangers who never agreed to it, in the one place they get to read it.
 */
const QUICK_ROLL_LABELS = {
  x2rent: 'x2 rent on full sets',
  vacationCash: 'vacation cash',
  auction: 'auctions',
  noRentInPrison: 'no rent while jailed',
  evenBuild: 'even build',
};

/**
 * What this table is, one phrase at a time: the board, the bankroll, then
 * every rolled rule and whether it is on.
 *
 * Written on the server so a phone and a browser sitting at the same table
 * never describe it differently, and read off the live settings rather than
 * the roll — if anything moved the board afterwards, this says what is
 * actually about to be played.
 */
export function quickRollParts(settings = {}, mapName = '') {
  return [
    String(mapName || 'Classic'),
    `$${Number(settings.startingCash || 0).toLocaleString('en-US')} to start`,
    ...Object.entries(QUICK_ROLL_LABELS).map(([k, label]) => `${label} ${settings[k] ? 'on' : 'off'}`),
  ];
}

/**
 * Why a table just lost the board it was set to — one sentence each.
 *
 * settleBoard used to say "the new host" whatever had happened, which after
 * a rented game was wrong every single time: the host had not changed, the
 * one-game pass had simply been played. A board can now go away for four
 * quite different reasons and a player is owed the right one, because the
 * difference between them is the difference between "you spent your coin"
 * and "somebody took your board away".
 */
const BOARD_GONE = {
  host: 'That board is not unlocked for the new host — back to Classic',
  spent: 'That one-game pass has been used — back to Classic',
  moved: 'That one-game pass moved to another table — back to Classic',
  other: 'That one-game pass is for a different board — back to Classic',
  rollover: 'The day turned over and that board is no longer free — back to Classic',
};

/** Laps a blocked player walks before the board hands them a way out. */
const RELIEF_LAPS = 4;
/** What that way out costs — well over the odds, because it is a forced sale. */
const RELIEF_MULTIPLIER = 1.7;

/**
 * How long a bot is allowed to think, stated as counts rather than a clock.
 *
 * Every loop in the bot brain is bounded here instead of being "short in
 * practice", because a bot runs inside the same tick as everybody else's
 * socket: a search that grows with the board would stall a live table, and a
 * table that stalls is the one bug this game cannot afford. The trade search
 * is the only part that could ever grow — it looks at each rival's deeds — so
 * it gets a hard packet count and stops mid-scan when it is spent.
 *
 * The package count is worth the cost it buys: at 40 a bot on a crowded board
 * ran out of budget before it had looked at everybody, and the tables that
 * would not resolve were exactly the ones where the deal it needed was sitting
 * with the rival it never reached. Ninety-six covers four rivals a turn, and
 * the rest are picked up on the next one.
 *
 * Measured on a full eight-seat board with every street owned: one bot's whole
 * turn of thinking — unmortgage, build and the trade search — costs about nine
 * tenths of a millisecond, against the half-second or more between bot turns.
 * test/smart-bots.mjs asserts the ceiling rather than trusting this note.
 */
const BOT_TRADE_PACKAGES = 96;
const BOT_BUILD_STEPS = 24;
const BOT_UNMORTGAGE_STEPS = 12;
/**
 * Turns before a bot knocks on the same door again, and before it makes any
 * offer at all. Two numbers rather than one: without the per-target wait a
 * bot with a single obvious target asks that one player every few turns for
 * the rest of the game, which is how a helpful bot becomes a pest.
 */
const BOT_ASK_COOLDOWN = 9;
const BOT_OFFER_GAP = 4;

const AUCTION_SECONDS = 20;
const JAIL_FINE = 50;
const SALARY = 200;
/** Landing dead on START pays this instead of the passing salary. */
const START_BONUS = 300;
const MAX_JAIL_TURNS = 3;

/**
 * Missed turns in a row before a seat is actually taken away.
 *
 * Two, because one is a person who looked at something else for ninety
 * seconds and two is a person who has gone. The first costs them the turn and
 * nothing else — the house plays it and hands the seat straight back.
 */
const MAX_MISSED_TURNS = 2;
/**
 * How long a disconnected player keeps their seat. A bot covers their turns
 * from the moment they drop, so this is not the table's patience — the table
 * is already being played for. It is only how long before the chair is given
 * up for good, and the things that take a player away for half a minute are
 * ordinary: a phone locking, a tab going to sleep, wifi handing over to the
 * mobile network. Thirty seconds of that used to cost somebody the whole
 * game. Three minutes matches how long the room itself waits before it stops
 * playing to an empty theatre.
 */
const RECONNECT_GRACE_MS = 3 * 60 * 1000;

const moneyText = (n) => `$${Number(n).toLocaleString('en-US')}`;

let tradeSeq = 1;

/**
 * End-of-game badges, in hand-out order. Each one goes to the outright
 * leader of a stat and says the number out loud; the later entries exist so
 * even a rough game earns you something to laugh about. A title is never
 * handed down the ranking — the leader wears it or nobody does.
 */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const times = (n) => (n === 1 ? 'once' : `${n} times`);
const TITLE_BOOK = [
  { key: 'biggestRent', name: 'Heavy Hitter',
    reason: (v, s) => `took ${moneyText(v)} in a single rent${s.biggestRentTile ? ` on ${s.biggestRentTile}` : ''}` },
  { key: 'tradesCompleted', name: 'Dealmaker', reason: (v) => `closed ${plural(v, 'trade')}` },
  { key: 'housesBuilt', name: 'Master Builder', reason: (v) => `built ${plural(v, 'house')}` },
  { key: 'leadShare', name: 'Front Runner', reason: (v) => `sat in first place for ${v}% of the game` },
  { key: 'rentCollected', name: 'Landlord', reason: (v) => `collected ${moneyText(v)} in rent` },
  { key: 'auctionsWon', name: 'Auction Hawk', reason: (v) => `won ${plural(v, 'auction')}` },
  { key: 'streetsBought', name: 'Land Grabber', reason: (v) => `bought ${plural(v, 'street')}` },
  { key: 'doubles', name: 'Hot Dice', reason: (v) => `rolled ${plural(v, 'double')}` },
  { key: 'laps', name: 'Globetrotter', reason: (v) => `lapped the board ${times(v)}` },
  { key: 'jailed', name: 'Jailbird', reason: (v) => `got locked up ${times(v)}` },
  { key: 'rentPaid', name: 'Star Tenant', reason: (v) => `paid out ${moneyText(v)} in rent to the competition` },
];

export class GameRoom {
  constructor(id, onUpdate) {
    this.id = id;
    this.onUpdate = onUpdate || (() => {});
    this.settings = { ...DEFAULT_SETTINGS };
    this.map = getMap(this.settings.mapId);
    this.status = 'lobby'; // lobby | playing | ended
    this.players = [];
    this.hostId = null;
    this.ownership = {}; // tileIndex -> { owner, houses, mortgaged }
    this.log = [];
    this.chat = [];
    this.turn = null;
    this.auction = null;
    this.trades = [];
    this.vacationPot = 0;
    this.winner = null;
    this.winningTeam = null;
    this.decks = this.freshDecks();
    this.history = []; // per-turn net-worth snapshots, revealed at game end
    this.stats = {};   // per-player match counters, revealed at game end
    this.titles = null; // end-of-game badges derived from the stats
    this.turnCount = 0;
    this.lastCard = null;
    this.lastMove = null;
    // The last deed to change hands, and who took it. Kept only so the bots
    // have something true to talk about — a reply that names what actually
    // just happened is the difference between a table and a noticeboard.
    this.lastBuy = null;
    // Every position change of the current action, in execution order —
    // one dice roll can move a piece twice (walk onto Surprise, then the
    // card sends it elsewhere), and one lastMove can't tell that story.
    this.actionMoves = [];
    this.timers = {};
    /** Set by the server so the room can report karma-worthy exits. */
    this.hooks = {};
    this.createdAt = Date.now();
    this.version = 0;
    // A player's id doubles as their secret identity token, so the state a
    // viewer receives swaps everyone else's for a room-scoped alias. Both
    // directions of that disguise live here for the life of the room.
    this.aliases = new Map();       // real id -> alias
    this.tokensByAlias = new Map(); // alias -> real id
  }

  // ---------------------------------------------------------------- logging --
  say(text, kind = 'info') {
    this.log.push({ text, kind, at: Date.now() });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  push() {
    // Old clients render "Pay $X" straight off turn.debt.amount, so the
    // number is re-derived from the debtor's balance on every broadcast.
    const d = this.turn?.debt;
    if (d) {
      const debtor = this.player(d.debtor);
      if (debtor) d.amount = Math.max(0, -debtor.money);
    }
    this.version++;
    this.onUpdate(this);
  }

  // ---------------------------------------------------------------- players --
  get active() {
    return this.players.filter((p) => !p.bankrupt);
  }

  player(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  freeColor() {
    const used = new Set(this.players.map((p) => p.color));
    return COLORS.find((c) => !used.has(c)) || COLORS[this.players.length % COLORS.length];
  }

  addPlayer({ id, name, isBot = false, flag = '', color = '' }) {
    if (this.players.length >= this.settings.maxPlayers) {
      // A quick table never turns a person away over a house player's chair:
      // the most recent house arrival gives the seat back and slips out.
      const seat = !isBot && this.quick && this.status === 'lobby'
        ? [...this.players].reverse().find((p) => p.isBot) : null;
      if (!seat) return { error: 'Room is full' };
      this.players = this.players.filter((p) => p !== seat);
      if (this.hostId === seat.id) this.hostId = this.players[0]?.id || null;
      this.say(`${seat.name} left the room`, 'leave');
    }
    if (this.status !== 'lobby') return { error: 'Game already started' };
    const clean = cleanText((name || 'Player').slice(0, 16));
    const wantsColor = color && COLORS.includes(color)
      && !this.players.some((p) => p.color === color);
    const player = {
      id,
      name: isAllMasked(clean) ? 'Player' : clean,
      color: wantsColor ? color : this.freeColor(),
      flag: flag || '',
      team: null,
      isBot,
      connected: true,
      botControlled: false,
      /** Turns missed in a row. Two takes the seat; the first is forgiven. */
      missedTurns: 0,
      /** The house is covering this one turn and no more. */
      coveredTurn: false,
      money: this.settings.startingCash,
      pos: 0,
      jail: false,
      jailTurns: 0,
      getOutCards: 0,
      skipTurns: 0,
      bankrupt: false,
      doublesInARow: 0,
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = id;
    this.say(`${player.name} joined the game`, 'join');
    if (this.quick && !isBot && this.status === 'lobby') {
      // A person sat down: relight a burnt-out fuse if need be, and replan
      // the house arrivals around the seats that are actually left.
      if (!this.quickStartAt) this.armQuickStart(GameRoom.QUICK_FUSE_SECONDS);
      else this.planQuickFill();
    }
    this.push();
    return { player };
  }

  removePlayer(id) {
    const p = this.player(id);
    if (!p) return;
    // A seat is only worth holding while a game still needs it. In the lobby,
    // or once the result is on the table, someone who closes the window has
    // left the room — and showing them as still sitting there is a lie the
    // next lobby inherits.
    if (this.status === 'lobby' || this.status === 'ended') {
      this.players = this.players.filter((x) => x.id !== id);
      if (this.hostId === id) this.hostId = this.players[0]?.id || null;
      this.say(`${p.name} left the room`, 'leave');
      if (this.quick && this.status === 'lobby') {
        if (!this.players.some((x) => !x.isBot)) {
          // The last person walked out — the house players don't hang around
          // performing for an empty room.
          for (const b of this.players) this.say(`${b.name} left the room`, 'leave');
          this.players = [];
          this.hostId = null;
        }
        // Either clears the joins still on the clock, or refills the freed
        // chair on the same human rhythm.
        this.planQuickFill();
      }
    } else {
      // Keep the seat warm: a refresh or a flaky network shouldn't instantly
      // hand your turn to a bot. Only after the grace period does one step in.
      p.connected = false;
      // A gone player can't be "viewing" any offer.
      for (const t of this.trades) {
        if (t.viewers?.includes(id)) t.viewers = t.viewers.filter((v) => v !== id);
      }
      this.say(`${p.name} lost connection — holding their seat`, 'leave');
      this.holdSeat(p, RECONNECT_GRACE_MS);
    }
    this.push();
  }

  /** The host hands the chair on to someone else at the table. */
  makeHost(id, targetId) {
    if (id !== this.hostId) return { error: 'Only the host can pass it on' };
    const target = this.player(targetId);
    if (!target || target.isBot) return { error: 'Pick a player at the table' };
    if (target.connected === false) return { error: 'They are not here right now' };
    if (target.id === this.hostId) return { ok: true };
    this.hostId = target.id;
    this.say(`${target.name} is the host now`, 'system');
    this.push();
    return { ok: true };
  }

  reconnect(id) {
    const p = this.player(id);
    if (!p) return false;
    clearTimeout(this.timers[`grace:${id}`]);
    if (this.awaiting) delete this.awaiting[id];
    const wasBot = p.botControlled;
    p.connected = true;
    p.botControlled = false;
    p.coveredTurn = false;
    p.missedTurns = 0;
    this.say(wasBot ? `${p.name} is back and takes over from the bot` : `${p.name} reconnected`, 'join');
    // Walking back in on your own turn puts you back on the clock. The seat had
    // none while the house was covering it — a bot cannot run out of time — so
    // without this a player could reconnect onto their own turn and hold the
    // table for as long as they liked.
    if (this.turn?.playerId === id) this.armTurnTimer();
    // And re-open every seat that was held without a deadline because, at the
    // moment it was vacated, there was nobody here to be kept waiting. There
    // is somebody here now. Without this a table could be left with not one
    // pending timer anywhere and no way back — the person who came to watch
    // being the only one who could have started it, and having no button.
    for (const q of this.players) {
      if (q.isBot || q.connected || q.bankrupt) continue;
      if (this.awaiting?.[q.id] && !this.awaiting[q.id].until) this.holdSeat(q, RECONNECT_GRACE_MS);
    }
    this.push();
    // A table that stopped when the last human left picks up where it stopped.
    this.maybeBot();
    return true;
  }

  // ------------------------------------------------------------------ teams --
  get teamsOn() {
    return this.settings.teams > 0;
  }

  /** Teammates share a win and never charge each other rent. */
  sameTeam(a, b) {
    return this.teamsOn && !!a && !!b && a.id !== b.id
      && a.team != null && a.team === b.team;
  }

  teammatesOf(id) {
    const p = this.player(id);
    if (!this.teamsOn || !p || p.team == null) return [];
    return this.players.filter((x) => x.id !== id && x.team === p.team);
  }

  setTeam(id, team) {
    if (this.status !== 'lobby' || !this.teamsOn) return { error: 'Not available' };
    const p = this.player(id);
    if (!p) return { error: 'No such player' };
    const n = Number(team);
    if (!Number.isInteger(n) || n < 0 || n >= this.settings.teams) return { error: 'No such team' };
    p.team = n;
    this.push();
    return { ok: true };
  }

  /** Spreads everyone across the teams as evenly as the seat count allows. */
  balanceTeams() {
    if (!this.teamsOn) {
      this.players.forEach((p) => { p.team = null; });
      return;
    }
    this.players.forEach((p, i) => { p.team = i % this.settings.teams; });
    this.push();
  }

  /** True when at least two teams are represented, so a game can be won. */
  teamsPlayable() {
    if (!this.teamsOn) return true;
    return new Set(this.players.map((p) => p.team)).size >= 2;
  }

  /** Everyone at the table who is a person, not a seat the house is playing. */
  get humans() {
    return this.players.filter((p) => !p.isBot && !p.bankrupt);
  }

  /** True when the server should play this seat automatically. */
  autoPlayed(p) {
    return !!p && (p.isBot || p.botControlled);
  }

  updateAppearance(id, { name, color, flag }) {
    const p = this.player(id);
    if (!p || this.status !== 'lobby') return;
    if (name) {
      const clean = cleanText(name.slice(0, 16));
      p.name = isAllMasked(clean) ? 'Player' : clean;
    }
    if (flag !== undefined) p.flag = String(flag || '').slice(0, 8);
    if (color && COLORS.includes(color) && !this.players.some((x) => x.id !== id && x.color === color)) {
      p.color = color;
    }
    this.push();
  }

  updateSettings(id, patch) {
    if (id !== this.hostId || this.status !== 'lobby') return;
    // A matchmade table is nobody's table.
    //
    // Whoever tapped Play Now first is host here only because somebody had to
    // hold the chair, and the three strangers matchmaking funnelled in behind
    // them were shown what the table rolled and agreed to that. Rewriting it
    // under them is not a host's privilege, it is a stranger changing the
    // rules of a game already in front of you.
    //
    // The clock is the sharp end and the reason this is a rule rather than a
    // courtesy: a five-second turn on somebody who never asked for one is a
    // timeout, and a timeout takes them out of the game AND costs them karma.
    // Both clients already say the settings here belong to nobody; this is
    // the server finally agreeing. It lives in updateSettings rather than in
    // the socket handler because that is the one door every client uses.
    if (this.quick) return { error: 'A matchmade table sets itself' };
    // A board is stock now. The host may pick the house board, either of the
    // two the day is giving away, or anything they have bought — and nothing
    // else. Hiding the locked ones in the picker is a courtesy to a player;
    // this is the rule, and it lives here because updateSettings is the only
    // door every client has to come through to change a board.
    //
    // Note what is NOT checked: whether the guests own it. They never need to.
    // The host buys the board, the table plays on it, and a locked board is a
    // reason to buy one of your own — not a reason to be turned away from
    // someone else's table.
    if (patch.mapId !== undefined) {
      // Say what it is before asking whether they may have it. This used to
      // store whatever arrived — an object, a megabyte of text — and ship it
      // to every client at the table on the next push, while `getMap` quietly
      // played Classic and the lobby claimed otherwise.
      const want = String(patch.mapId).slice(0, 40);
      // hasOwn, not truthiness: MAPS['__proto__'] and MAPS['constructor'] come
      // back from Object.prototype, and the room would set this.map to that —
      // a board with no tiles and no id, which is a table nobody can play.
      if (want !== 'random' && !Object.hasOwn(MAPS, want)) return { error: 'No such board' };
      if (this.hooks.mayUseBoard && !this.hooks.mayUseBoard(id, want)) {
        return { error: 'That board is locked — unlock it in the store' };
      }
      patch.mapId = want;
    }
    const allowed = Object.keys(DEFAULT_SETTINGS);
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.includes(k)) continue;
      this.settings[k] = v;
    }
    this.settings.maxPlayers = Math.max(2, Math.min(8, Number(this.settings.maxPlayers) || 4));
    // The bankroll and the clock arrive as numbers from a picker, which is to
    // say they arrive as whatever a socket feels like sending. Both are then
    // written straight onto real seats — startingCash onto everybody's money,
    // turnSeconds onto a timer that knocks a player out and docks their karma
    // when it fires — so both are pinned to the ranges the pickers actually
    // offer. A clock of zero is "off", which is a real choice and stays one.
    this.settings.startingCash = Math.max(100, Math.min(50_000,
      Math.floor(Number(this.settings.startingCash)) || DEFAULT_SETTINGS.startingCash));
    const clock = Math.floor(Number(this.settings.turnSeconds));
    if (!Number.isFinite(clock)) this.settings.turnSeconds = DEFAULT_SETTINGS.turnSeconds;
    else this.settings.turnSeconds = clock <= 0 ? 0 : Math.max(30, Math.min(600, clock));
    if (patch.mapId) this.map = getMap(this.settings.mapId);
    if (patch.teams !== undefined) {
      this.settings.teams = Math.max(0, Math.min(4, Number(this.settings.teams) || 0));
      this.syncTeamsWithSettings();
    }
    if (patch.startingCash) {
      this.players.forEach((p) => { p.money = this.settings.startingCash; });
    }
    this.push();
  }

  /** Clears team picks when the mode is switched off mid-lobby. */
  syncTeamsWithSettings() {
    if (!this.teamsOn) {
      this.players.forEach((p) => { p.team = null; });
      return;
    }
    const max = this.settings.teams - 1;
    this.players.forEach((p) => {
      if (p.team == null || p.team > max) p.team = null;
    });
  }

  addBot() {
    if (this.quick) {
      // A quick-table house player borrows everything a real joiner would
      // have: a name drawn from the wider world (never the same crew twice in
      // a row), an id shaped like any web guest's — clients sniff the "bot:"
      // prefix — a colour picked at random the way people pick, and sometimes
      // the flag its identity came with.
      const identity = quickIdentity(this.players.map((p) => p.name));
      const free = COLORS.filter((c) => !this.players.some((p) => p.color === c));
      return this.addPlayer({
        id: `u_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
        name: identity.name,
        flag: identity.flag || '',
        color: free[Math.floor(Math.random() * free.length)] || '',
        isBot: true,
      });
    }
    // Bots you invited yourself carry no disguise — short, friendly, familiar
    // — but drawn rather than counted off, so the same three don't turn up in
    // the same order at every table you make.
    const names = [
      'Ravi', 'Zoe', 'Kabir', 'Nina', 'Otto', 'Maya', 'Leo', 'Ira',
      'Priya', 'Dev', 'Sana', 'Arjun', 'Mira', 'Rohan', 'Tara', 'Vik',
      'Anya', 'Kiran', 'Neel', 'Isha', 'Raj', 'Lila', 'Sam', 'Nia',
      'Aman', 'Rhea', 'Yash', 'Diya', 'Kabeer', 'Simi', 'Manu', 'Zara',
    ];
    const used = new Set(this.players.map((p) => p.name));
    const free = names.filter((n) => !used.has(n));
    const name = free.length
      ? free[Math.floor(Math.random() * free.length)]
      : `Player ${this.players.length + 1}`;
    return this.addPlayer({ id: `bot:${name}:${Math.random().toString(36).slice(2, 7)}`, name, isBot: true });
  }

  // ------------------------------------------------------------------ start --
  /**
   * Put the table on a board its CURRENT host is entitled to.
   *
   * The chair moves without anybody touching the settings — it is handed over,
   * or the host closes the tab, or a house player is turfed out for a real
   * one, or somebody presses Play again and becomes host by pressing it. Every
   * one of those carries whatever board was chosen to whoever holds the chair
   * now, and checking only at the moment of choosing let a bought board be
   * inherited: sit in a lobby, wait for the host to leave, start. Rematch made
   * it unbounded — the same table could replay a board it no longer had a
   * claim to, forever, which is also what turned "one free game across
   * midnight" into free access to the whole shelf for the price of nine
   * parked tabs.
   *
   * This puts it back, and it COERCES rather than refuses. Two callers throw
   * away what start() returns — the quick-match fuse and the cup auto-start —
   * so an error here would be a table that silently never begins. Falling back
   * to the house board is a table that plays.
   *
   * What it says while doing it is the other half of the job. mayUseBoard only
   * ever answers no, and "no" has four quite different causes now; the one
   * sentence the table gets had better be the true one, so the reason is asked
   * for rather than assumed — see the hook in server/index.js, which is where
   * the wallet and the calendar both live.
   */
  settleBoard() {
    const want = String(this.settings.mapId || '');
    if (!this.hostId || !this.hooks.mayUseBoard) return false;
    if (this.hooks.mayUseBoard(this.hostId, want)) return false;
    this.settings.mapId = 'classic';
    this.map = getMap('classic');
    const why = this.hooks.boardGone?.(this.hostId, want) || '';
    this.say(BOARD_GONE[why] || BOARD_GONE.host, 'system');
    return true;
  }

  start(id) {
    if (id !== this.hostId || this.status !== 'lobby') return { error: 'Not allowed' };
    this.settleBoard();
    if (this.settings.allowBots) {
      // Fill every empty seat the table was set for — six-player games included.
      while (this.players.length < this.settings.maxPlayers) this.addBot();
    }
    if (this.players.length < 2) return { error: 'Need at least 2 players' };

    if (this.teamsOn) {
      // Anyone who never picked a side gets dropped into the smallest team.
      const counts = Array.from({ length: this.settings.teams }, () => 0);
      this.players.forEach((p) => { if (p.team != null) counts[p.team]++; });
      this.players.forEach((p) => {
        if (p.team != null) return;
        const smallest = counts.indexOf(Math.min(...counts));
        p.team = smallest;
        counts[smallest]++;
      });
      if (!this.teamsPlayable()) return { error: 'Split the players across at least two teams' };
    } else {
      this.players.forEach((p) => { p.team = null; });
    }

    // "Random" means a brand new board each game, not a fixed shuffle.
    if (this.settings.mapId === 'random') this.map = getMap('random');
    // Country boards bring their own localized Treasure/Surprise decks.
    this.decks = this.freshDecks();

    if (this.settings.randomizeOrder) {
      for (let i = this.players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.players[i], this.players[j]] = [this.players[j], this.players[i]];
      }
    }
    this.players.forEach((p) => {
      p.money = this.settings.startingCash;
      p.pos = 0;
      p.jail = false;
      p.jailTurns = 0;
      p.getOutCards = 0;
      p.skipTurns = 0;
      p.bankrupt = false;
      p.missedTurns = 0;
      p.coveredTurn = false;
    });
    this.status = 'playing';
    this.ownership = {};
    this.vacationPot = 0;
    this.history = [];
    this.stats = {};
    this.titles = null;
    this.turnCount = 0;
    this.lastProgressAt = 0;
    this.progressSig = '';
    this.turn = {
      playerId: this.players[0].id,
      phase: 'roll',
      dice: null,
      doubles: 0,
      pending: null,
      debt: null,
      rolledThisTurn: false,
    };
    this.recordWorth();
    this.say('Game started! Good luck.', 'system');
    const greeter = this.players.filter((x) => this.autoPlayed(x));
    if (greeter.length) {
      this.botSay(greeter[Math.floor(Math.random() * greeter.length)], 'greet',
        {}, { always: true, delay: 2200 });
    }
    this.say(`${this.players[0].name}'s turn`, 'turn');
    this.armTurnTimer();
    this.push();
    this.maybeBot();
    return { ok: true };
  }

  // -------------------------------------------------------- holding a seat --
  /**
   * Somebody's connection dropped. The table gets to decide how long to wait:
   * the first couple of extensions are a favour any one player can do, after
   * that everyone still at the table has to agree — otherwise one kind player
   * could keep a dead chair alive forever.
   */
  holdSeat(p, ms) {
    this.awaiting ??= {};
    const seat = this.awaiting[p.id] ??= { grants: 0, granted: [] };
    seat.granted = [];
    clearTimeout(this.timers[`grace:${p.id}`]);
    // The clock exists so nobody is left waiting on an empty chair. With
    // nobody else at the table there is no one to keep waiting — the same
    // courtesy the shot clock already extends to a player alone with their
    // own bots — so the seat simply stays theirs, and the room's own idle
    // reaper decides when the table is over.
    // Nobody else here at all — not even somebody watching from the sidelines.
    // Anyone with the app open is being kept waiting by this empty chair, out
    // of the game or not, so a spectator is enough to start the clock. The old
    // test asked for a player still in the running, which meant a table with
    // only spectators left held the seat for ever and never resolved.
    if (!this.present.some((x) => x.id !== p.id)) {
      seat.until = null;
      this.push();
      return;
    }
    seat.until = Date.now() + ms;
    this.timers[`grace:${p.id}`] = setTimeout(() => this.seatRanOut(p.id), ms + 200);
    this.timers[`grace:${p.id}`].unref?.();
    this.push();
  }

  /** Everyone present, minus the player we're waiting on. */
  votersFor(id) {
    return this.players.filter((x) => (
      x.id !== id && !x.bankrupt && !x.isBot && x.connected
    ));
  }

  /** How many free extensions a single player can hand out before it takes a vote. */
  static get FREE_GRANTS() { return 2; }

  grantTime(voterId, targetId) {
    const target = this.player(targetId);
    const voter = this.player(voterId);
    const seat = this.awaiting?.[targetId];
    if (!target || !voter || !seat) return { error: 'Nobody is waiting on that seat' };
    if (target.connected) return { error: 'They are already back' };
    if (voterId === targetId) return { error: 'You cannot grant your own time' };

    const needAll = seat.grants >= GameRoom.FREE_GRANTS;
    if (!seat.granted.includes(voterId)) seat.granted.push(voterId);

    const voters = this.votersFor(targetId).map((x) => x.id);
    const everyone = voters.length > 0 && voters.every((v) => seat.granted.includes(v));
    if (needAll && !everyone) {
      this.say(`${voter.name} wants to wait for ${target.name} (${seat.granted.length}/${voters.length})`, 'info');
      this.push();
      return { ok: true, pending: true };
    }

    seat.grants++;
    this.say(`${target.name} gets another minute`, 'info');
    this.holdSeat(target, 60000);
    return { ok: true };
  }

  /** Nobody granted more time — the chair goes back to the board. */
  seatRanOut(id) {
    const p = this.player(id);
    if (!p || p.connected || p.bankrupt || this.status !== 'playing') return;
    // A seat held without a deadline is one nobody is waiting on — it does not
    // run out. Checked here as well as at the timer, so no other caller can
    // take a game off somebody by walking in through this door.
    if (this.awaiting?.[id] && !this.awaiting[id].until) return;
    delete this.awaiting?.[id];
    this.say(`${p.name} never came back`, 'leave');
    this.removeFromPlay(p, 'timeout');
  }

  // ------------------------------------------------------ deadlock relief --
  /**
   * A head-to-head game can lock up: one player completes a colour and starts
   * building, the other holds most of a colour but not the last street, so
   * they can never build anything and simply lose in slow motion. Trading is
   * the intended way out, but the player who is ahead has no reason to agree.
   *
   * So the board itself steps in. Walk four laps in that position and the
   * street you are missing changes hands — at well over the odds, and only if
   * you can pay on the spot.
   */
  noteLap(p) {
    if (!this.settings.deadlockRelief || this.status !== 'playing') return;

    const candidates = this.blockingTiles(p);
    if (!candidates.length) { p.blockedLaps = 0; return; }

    // Both players are told the rule the first time it could ever apply, so
    // nobody is surprised by a street moving later.
    if (!this.reliefExplained) {
      this.reliefExplained = true;
      this.reliefCard = {
        title: 'Deadlock rule',
        text: `${p.name} owns almost a full colour but not the last street, so they can never build. `
          + `After ${RELIEF_LAPS} laps of that, the missing street changes hands for `
          + `${RELIEF_MULTIPLIER}x its price. Trade it yourselves first and the rule never fires.`,
        at: Date.now(),
      };
      this.say(`Deadlock rule is in play — ${p.name} is one street short of building`, 'system');
    }

    p.blockedLaps = (p.blockedLaps || 0) + 1;
    const left = RELIEF_LAPS - p.blockedLaps;
    if (left > 0) {
      this.say(`${p.name} is still stuck — ${left} lap${left === 1 ? '' : 's'} to go`, 'info');
      return;
    }
    this.runRelief(p, candidates);
  }

  /**
   * Streets this player is one away from, held by the opponent — and only when
   * they hold no colour of their own while the opponent is already building.
   * Both halves matter: this is a rule for someone losing to a wall, not for
   * someone merely behind.
   */
  blockingTiles(p) {
    // Head-to-head only. With a third player at the table there is no single
    // "the opponent", and someone else can always break the wall by trading.
    if (this.active.length !== 2) return [];
    const rival = this.active.find((x) => x.id !== p.id);
    if (!rival) return [];

    // While a single street is still unsold, nothing is decided — landing on
    // it could hand this player a colour tomorrow. The rule is only for a
    // board where that can never happen again, so it waits until every street
    // has an owner.
    const streets = this.map.tiles.filter((t) => t.type === 'property');
    if (streets.some((t) => !this.own(t.index)?.owner)) return [];

    const groups = Object.entries(this.map.groups);
    if (groups.some(([g]) => this.ownsFullGroup(p.id, g))) return [];
    const rivalBuilt = groups.some(([g, idxs]) => (
      this.ownsFullGroup(rival.id, g) && idxs.every((i) => (this.own(i)?.houses || 0) > 0)
    ));
    if (!rivalBuilt) return [];

    const out = [];
    for (const [, idxs] of groups) {
      const mine = idxs.filter((i) => this.own(i)?.owner === p.id).length;
      if (mine !== idxs.length - 1) continue;
      const missing = idxs.find((i) => this.own(i)?.owner === rival.id);
      // A mortgaged street would arrive unusable, so it is not a way out.
      if (missing !== undefined && !this.own(missing).mortgaged) out.push(missing);
    }
    return out;
  }

  /** The board rolls for which street moves — nobody gets to pick a favourite. */
  runRelief(p, candidates) {
    const roll = 1 + Math.floor(Math.random() * 6);
    const tileIndex = candidates[(roll - 1) % candidates.length];
    const tile = this.tile(tileIndex);
    const price = Math.ceil((tile.price || 0) * RELIEF_MULTIPLIER);
    const seller = this.player(this.own(tileIndex).owner);

    if (p.money < price) {
      // No money, no street. The clock starts again rather than leaving an
      // offer hanging over the table forever.
      p.blockedLaps = 0;
      this.say(`${p.name} could not raise ${moneyText(price)} for ${tile.name} — four more laps`, 'warn');
      this.push();
      return;
    }

    p.money -= price;
    this.receive(seller, price);
    this.own(tileIndex).owner = p.id;
    p.blockedLaps = 0;
    this.say(`Deadlock rule: ${tile.name} moves from ${seller.name} to ${p.name} for ${moneyText(price)}`, 'trade');
    this.lastCard = {
      deck: 'treasure',
      text: `The board rolled a ${roll}: ${tile.name} changes hands for ${moneyText(price)}.`,
      tone: 'plain',
      playerId: p.id,
      at: Date.now(),
    };
    this.push();
  }

  // ---------------------------------------------------------- quick match --
  /**
   * Turn this room into a drop-in table: public, bot-backed, and on a short
   * fuse. Whoever is queueing right now plays together; the fuse is what stops
   * a lone player staring at an empty lobby.
   */
  /**
   * How long a quick table looks for people before it stops looking.
   * Fifteen seconds of that is the search itself, and only the last five are
   * spent filling the empty chairs with house players — a person who arrives
   * on second nine should find a table of people, not one already padded out.
   */
  static get QUICK_FUSE_SECONDS() { return 15; }

  /** The stretch at the end of the fuse in which house players may arrive. */
  static get QUICK_BOT_WINDOW_MS() { return 5000; }

  makeQuickMatch(seconds = GameRoom.QUICK_FUSE_SECONDS, rolled = null) {
    this.quick = true;
    // The deal comes first, so the log line that announces it is the first
    // thing in the room and the fuse starts on a table that already knows
    // what it is. Quick play's own three settings go on top of it — they are
    // not up for rolling, and this order says so.
    if (rolled) this.applyQuickRoll(rolled);
    this.settings.isPrivate = false;
    this.settings.allowBots = true;
    this.settings.maxPlayers = 4;
    this.armQuickStart(seconds);
  }

  /**
   * Take the deal: write the rolled rules onto the table and say what they
   * are, out loud, in the log. Nobody at a matchmade table chose these, so
   * the least the table can do is tell them before the dice start.
   *
   * Only keys DEFAULT_SETTINGS knows are written. The roll is made in this
   * process and could be trusted, but the rule that the default settings are
   * the whole vocabulary is worth having in one place rather than two.
   */
  applyQuickRoll(rolled) {
    const allowed = Object.keys(DEFAULT_SETTINGS);
    const keys = [];
    for (const [k, v] of Object.entries(rolled || {})) {
      if (!allowed.includes(k)) continue;
      this.settings[k] = v;
      keys.push(k);
    }
    if (!keys.length) return;
    // Same move updateSettings makes: the board is a setting AND an object,
    // and a lobby showing one while the table holds the other is a lie.
    if (keys.includes('mapId')) this.map = getMap(this.settings.mapId);
    this.quickRoll = { at: Date.now(), keys };
    this.say(`This table rolled: ${quickRollParts(this.settings, this.map.name).join(' · ')}`, 'system');
  }

  armQuickStart(seconds) {
    clearTimeout(this.timers.quick);
    if (this.status !== 'lobby') return;
    this.quickStartAt = Date.now() + seconds * 1000;
    this.timers.quick = setTimeout(() => this.startQuickMatch(), seconds * 1000);
    this.timers.quick.unref?.();
    this.planQuickFill();
    this.push();
  }

  /**
   * Seat the house players one at a time, the way a real lobby fills — but
   * not before the search has had its run. The first ten seconds of the fuse
   * belong to whoever else is queueing; only in the last five does the house
   * start taking the chairs nobody claimed, spread across that window with
   * enough jitter that they don't arrive on a metronome.
   *
   * Called whenever the picture changes — fuse armed, person in, person out —
   * and reschedules every pending arrival from scratch, so a real player
   * landing at second nine pushes the house back out of the way.
   */
  planQuickFill() {
    for (const k of Object.keys(this.timers)) {
      if (!k.startsWith('quickSeat:')) continue;
      clearTimeout(this.timers[k]);
      delete this.timers[k];
    }
    if (!this.quick || this.status !== 'lobby' || !this.quickStartAt) return;
    // An empty room needs no performance.
    if (!this.players.some((p) => !p.isBot)) return;
    const seats = this.settings.maxPlayers - this.players.length;
    if (seats <= 0) return;
    // The table is guaranteed full by kick-off regardless — start() tops up
    // any seat still empty — so this is only about the last few seconds being
    // visibly a table filling up rather than a table that was always full.
    const untilStart = this.quickStartAt - Date.now();
    const opens = Math.max(0, untilStart - GameRoom.QUICK_BOT_WINDOW_MS);
    // …and the last arrival still has to land before the deal.
    const closes = Math.max(opens, untilStart - 900);
    const span = closes - opens;
    for (let i = 0; i < seats; i++) {
      // Evenly through the window, nudged either way so two seats never fill
      // on the same beat.
      const slot = span * ((i + 0.5) / seats);
      const jitter = (Math.random() - 0.5) * (span / seats) * 0.7;
      const at = opens + Math.max(0, Math.min(span, slot + jitter));
      const key = `quickSeat:${i}`;
      this.timers[key] = setTimeout(() => {
        delete this.timers[key];
        this.addBot();
      }, at);
      this.timers[key].unref?.();
    }
  }

  /** The fuse burnt down (or the table filled) — deal everyone in. */
  startQuickMatch() {
    clearTimeout(this.timers.quick);
    this.quickStartAt = null;
    // No people means no game — the house doesn't play itself.
    if (this.status !== 'lobby' || !this.players.some((p) => !p.isBot)) return;
    this.hostId = this.players[0].id;
    this.start(this.hostId);
  }

  // -------------------------------------------------------------- turn clock --
  /**
   * Give whoever holds the turn a fresh shot clock. Bots and bot-held seats
   * don't need one, and every real action re-arms it — the clock is there to
   * stop a table stalling on someone who walked away, not to rush a thinker
   * mid-turn.
   */
  armTurnTimer() {
    clearTimeout(this.timers.turn);
    this.timers.turn = null;
    if (!this.turn) return;
    // A turn has just begun. Whether anybody needs telling is not this file's
    // business — the server knows which seats have a tab or a phone still
    // attached, and this one only knows whose turn it is. Both places a turn
    // starts come through here, which is why the hook hangs on this door.
    if (this.status === 'playing') this.hooks.turn?.(this.turn.playerId, this);
    const seconds = Math.max(0, Math.floor(Number(this.settings.turnSeconds) || 0));
    const p = this.player(this.turn.playerId);
    if (this.status !== 'playing' || !seconds || !p) {
      if (this.turn) this.turn.endsAt = null;
      return;
    }
    // A shot clock exists so nobody is left waiting on an empty chair. Playing
    // against bots you added yourself, there is nobody to keep waiting — and
    // being hurried by your own bots would just be rude.
    // Anybody real in the room, not anybody still winning it. This asked for
    // two surviving HUMANS, so a private table where everyone but one player
    // had been knocked out switched its shot clock off entirely — and if that
    // last player then put their phone down, the seat had no clock, no bot
    // cover (a seat is only covered when the turn ARRIVES at an absent chair)
    // and no grace, while the people they knocked out sat watching a board
    // that would never move again.
    if (!this.quick && this.present.length < 2) { this.turn.endsAt = null; return; }

    // Every turn carries a visible deadline, including the seats the house is
    // playing — a clock that blinks out on some turns reads as broken, and on
    // a quick-match table it would also give the house players away.
    this.turn.endsAt = Date.now() + seconds * 1000;
    if (this.autoPlayed(p)) return;      // …but only a real player can run out of time
    const id = p.id;
    this.timers.turn = setTimeout(() => this.turnTimedOut(id), seconds * 1000 + 250);
    this.timers.turn.unref?.();
  }

  /**
   * The clock ran out. The table matters more than the empty chair: their
   * deeds go back to the bank and play moves on, but they keep their seat in
   * the roster so their client can offer "watch how it ends".
   */
  turnTimedOut(id) {
    if (this.status !== 'playing') return;
    if (this.turn?.playerId !== id) return;
    const p = this.player(id);
    if (!p || p.bankrupt || this.autoPlayed(p)) return;
    // Not while an auction is running. Sending a street to auction and then
    // passing leaves you with nothing to do and no button to press, while
    // every bid anybody else makes extends the auction another twelve seconds
    // — so the shot clock, which is measuring your dawdling, was measuring
    // somebody else's bidding war and throwing you out of the game for it.
    // finishAuction hands the clock back the moment the hammer falls.
    if (this.auction) return;

    // One missed turn is a doorbell, not a desertion.
    //
    // The clock used to take the whole game off anybody who looked away for
    // ninety seconds — deeds back to the bank, cash gone, a spectator's seat
    // and a karma point docked, for putting a phone down once. So the first
    // one is covered: the house plays that single turn, the player keeps
    // everything, and their next turn is theirs again with a fresh clock.
    // Two in a row is somebody who has actually gone, and the table has been
    // waiting three minutes for them.
    p.missedTurns = (p.missedTurns || 0) + 1;
    if (p.missedTurns < MAX_MISSED_TURNS) {
      this.say(`${p.name} ran out of time — the house plays this turn`, 'warn');
      // Covering THIS turn only: nextTurn hands the seat straight back, so a
      // player who is simply slow never quietly becomes a bot for the rest of
      // the game (and a bot, having no clock, could never be removed at all).
      p.coveredTurn = true;
      p.botControlled = true;
      this.push();
      return this.maybeBot();
    }
    this.say(`${p.name} ran out of time twice in a row and was removed`, 'leave');
    this.removeFromPlay(p, 'timeout');
  }

  /** Any deliberate move by the player on the clock buys them a fresh one. */
  touchTurnClock(id) {
    if (this.status !== 'playing' || this.turn?.playerId !== id) return;
    // They are at the table after all, so the last missed turn stops counting
    // towards the two in a row that take a seat away.
    const p = this.player(id);
    if (p) p.missedTurns = 0;
    const before = this.turn.endsAt;
    this.armTurnTimer();
    if (this.turn.endsAt !== before) this.push();
  }

  /** Walking out on a live game — the deliberate version of a timeout. */
  quit(id) {
    const p = this.player(id);
    if (!p) return { error: 'Unknown player' };
    if (this.status !== 'playing') { this.removePlayer(id); return { ok: true }; }
    if (p.bankrupt) return { ok: true };
    this.say(`${p.name} left the game`, 'leave');
    this.removeFromPlay(p, 'quit');
    return { ok: true };
  }

  /**
   * Take a player out of the running without handing anyone a windfall: their
   * streets go back on the market, their cash leaves with them, and the turn
   * order simply skips the chair from now on.
   */
  removeFromPlay(p, reason) {
    clearTimeout(this.timers[`grace:${p.id}`]);
    if (this.awaiting) delete this.awaiting[p.id];
    p.bankrupt = true;      // the turn loop already skips these
    p.timedOut = true;      // …but the client shows a different story
    p.removedFor = reason;
    for (const i of this.tilesOf(p.id)) delete this.ownership[i];
    p.money = 0;
    if (this.turn?.debt?.debtor === p.id) this.turn.debt = null;
    else this.forgiveDebtTo(p);
    this.trades = this.trades.filter((t) => t.from !== p.id && t.to !== p.id);
    // A live auction settles their exit itself: any escrowed bid is void
    // (their cash left with them) and the race carries on without them.
    const settled = this.settleAuctionExit(p);
    this.hooks.karma?.(p.id, -1, reason);
    if (this.checkGameEnd()) return;
    // While an auction still runs, the turn stays parked on the auction
    // phase; finishAuction moves it on the moment the hammer falls.
    if (this.turn?.playerId === p.id && !this.auction && !settled) this.nextTurn();
    else this.push();
  }

  // ------------------------------------------------------------ turn helpers --
  get current() {
    return this.turn ? this.player(this.turn.playerId) : null;
  }

  isCurrent(id) {
    return this.status === 'playing' && this.turn?.playerId === id;
  }

  /**
   * The phase a resolved stop hands back to the roller: doubles roll again —
   * unless the double was the one that opened the prison door (noReroll), or
   * the player has just been locked up.
   */
  afterActionPhase(p = this.current) {
    const d = this.turn?.dice;
    return d && d[0] === d[1] && p && !p.jail && !this.turn.noReroll ? 'roll' : 'end';
  }

  tile(i) {
    return this.map.tiles[i];
  }

  own(i) {
    return this.ownership[i] || null;
  }

  ownerOf(i) {
    const o = this.own(i);
    return o ? this.player(o.owner) : null;
  }

  tilesOf(playerId) {
    return Object.entries(this.ownership)
      .filter(([, o]) => o.owner === playerId)
      .map(([i]) => Number(i));
  }

  ownsFullGroup(playerId, group) {
    const idxs = this.map.groups[group] || [];
    return idxs.length > 0 && idxs.every((i) => this.own(i)?.owner === playerId);
  }

  netWorth(p) {
    let total = p.money;
    for (const i of this.tilesOf(p.id)) {
      const t = this.tile(i);
      const o = this.own(i);
      total += o.mortgaged ? Math.floor(t.price / 2) : t.price;
      total += (o.houses || 0) * (t.houseCost || 0);
    }
    return total;
  }

  cornerIndex(type) {
    return this.map.tiles.findIndex((t) => t.type === type);
  }

  /**
   * Snapshots everyone's net worth for the end-of-game chart. Long bot games
   * can run thousands of turns, so the series halves itself when it gets big —
   * the shape survives, the payload stays small.
   */
  recordWorth() {
    if (this.status !== 'playing') return;
    const w = {};
    for (const p of this.players) w[p.id] = p.bankrupt ? 0 : this.netWorth(p);
    this.history.push({ t: this.turnCount, w });
    if (this.history.length > 480) this.history = this.history.filter((_, i) => i % 2 === 0 || i === this.history.length - 1);
  }

  // ------------------------------------------------------------- match stats --
  /** Lazily created per-player counters for the end-of-game report card. */
  statFor(p) {
    const id = typeof p === 'string' ? p : p.id;
    return (this.stats[id] ??= {
      doubles: 0, jailed: 0, streetsBought: 0, auctionsWon: 0,
      tradesCompleted: 0, housesBuilt: 0, rentCollected: 0, rentPaid: 0,
      biggestRent: 0, biggestRentTile: null, laps: 0, leadShare: 0,
    });
  }

  /** One rent payment actually landing — in full, or one slice of a streamed
   *  debt at a time. The biggest-rent title judges the whole bill (`soFar`),
   *  never the individual pieces. */
  noteRent(payer, owner, amount, tileName, soFar = amount) {
    if (!(amount > 0) || !payer || !owner) return;
    this.statFor(payer).rentPaid += amount;
    const s = this.statFor(owner);
    s.rentCollected += amount;
    if (soFar > s.biggestRent) {
      s.biggestRent = soFar;
      s.biggestRentTile = tileName || null;
    }
  }

  /** How much of the game each player spent in front, from the worth history. */
  settleLeadShare() {
    if (!this.history.length) return;
    const led = {};
    for (const snap of this.history) {
      let top = null, topW = -1, tie = false;
      for (const [id, w] of Object.entries(snap.w)) {
        if (w > topW) { top = id; topW = w; tie = false; }
        else if (w === topW) tie = true;
      }
      if (top && !tie && topW > 0) led[top] = (led[top] || 0) + 1;
    }
    for (const p of this.players) {
      this.statFor(p).leadShare = Math.round((100 * (led[p.id] || 0)) / this.history.length);
    }
  }

  /**
   * One badge per player, straight from the numbers. Walking the book in
   * order, each title goes to the outright leader of its stat; a player keeps
   * only the first title they earn, and a title whose leader is already
   * decorated is dropped rather than handed to the runner-up. A stat nobody
   * scored on awards nothing at all.
   */
  computeTitles() {
    const titles = {};
    for (const t of TITLE_BOOK) {
      let best = null, bestV = 0;
      for (const p of this.players) {
        const v = this.stats[p.id]?.[t.key] || 0;
        if (v > bestV) { best = p; bestV = v; }
      }
      if (!best || titles[best.id]) continue;
      titles[best.id] = { title: t.name, reason: t.reason(bestV, this.stats[best.id]) };
    }
    return titles;
  }

  // ------------------------------------------------------------------- money --
  /** What a bank-bound rupee does when it lands: joins the vacation pot when
   *  that rule collects it, and otherwise simply ceases to exist. */
  bankSink(amount) {
    if (amount > 0 && this.settings.vacationCash) this.vacationPot += amount;
  }

  /** The street name a rent reason carries, for the stats. */
  rentTileFrom(reason) {
    return reason?.startsWith('for ') ? reason.slice(4) : null;
  }

  credit(p, amount, reason = '') {
    this.receive(p, amount);
    if (reason) this.say(`${p.name} received $${amount} ${reason}`, 'money');
  }

  /**
   * Every rupee a player gains arrives through here — house sales, mortgages,
   * trade cash, salary, card windfalls, all of it. A player in the red does
   * not pocket new money: it flows straight through to whoever the open debt
   * names, and their balance climbs toward zero as it does. Only what is left
   * once the debt closes actually stays in their pocket.
   */
  receive(p, amount) {
    if (!(amount > 0)) return;
    const d = this.turn?.debt;
    const owed = d && d.debtor === p.id ? Math.max(0, -p.money) : 0;
    p.money += amount;                 // the climb — the creditors are paid alongside it
    if (!owed) return;
    this.streamDebt(d, p, Math.min(amount, owed));
    d.amount = Math.max(0, -p.money);
    this.settleDebtIfPossible();
  }

  /** One recovered slice leaving the debtor's ledger for whoever the debt names. */
  streamDebt(d, p, slice) {
    if (!(slice > 0)) return;
    const left = Math.max(0, -p.money);
    const toGo = left > 0 ? ` — $${left} still owed` : '';
    if (d.owedTo) {
      this.splitAmongOwed(d, slice);
      this.say(`$${slice} flows straight to the players ${p.name} owes${toGo}`, 'money');
      return;
    }
    const creditor = d.creditor ? this.player(d.creditor) : null;
    if (creditor && !creditor.bankrupt) {
      creditor.money += slice;
      // The only charge that stalls a turn with a named creditor is rent, so
      // every slice counts toward the rent stats as it lands.
      d.rentSoFar = (d.rentSoFar || 0) + slice;
      this.noteRent(p, creditor, slice, this.rentTileFrom(d.reason), d.rentSoFar);
      this.say(`$${slice} flows straight from ${p.name} to ${creditor.name}${toGo}`, 'money');
    } else {
      this.bankSink(slice);
      this.say(`$${slice} flows straight to the bank${toGo}`, 'money');
    }
  }

  /**
   * Split one slice across the players a payEach debt still owes, pro rata to
   * what each is owed. Floored shares against a shrinking pool: the last
   * recipient absorbs the rounding, so no coin is ever lost or duplicated.
   */
  splitAmongOwed(d, slice) {
    const alive = (i) => {
      const r = this.player(d.owedTo[i]);
      return r && !r.bankrupt && d.owedLeft[i] > 0 ? r : null;
    };
    let pool = d.owedTo.reduce((sum, _, i) => sum + (alive(i) ? d.owedLeft[i] : 0), 0);
    let left = Math.min(slice, pool);
    for (let i = 0; i < d.owedTo.length && left > 0; i++) {
      const r = alive(i);
      if (!r) continue;
      const share = Math.min(d.owedLeft[i], Math.floor((left * d.owedLeft[i]) / pool));
      pool -= d.owedLeft[i];
      d.owedLeft[i] -= share;
      left -= share;
      r.money += share;
    }
  }

  /**
   * Charge the *current* player. Whatever they can cover moves right now; the
   * rest becomes a negative balance — the amount still owed — and the turn
   * stalls in the "debt" phase. From then on every rupee they gain streams
   * straight to whoever is owed (see receive) until the balance climbs back
   * to zero. Nothing is ever minted to close the gap.
   */
  charge(p, amount, creditor = null, reason = '') {
    if (amount <= 0) return true;
    const pay = Math.max(0, Math.min(p.money, amount));
    if (creditor) creditor.money += pay;
    else this.bankSink(pay);
    p.money -= amount;
    if (p.money >= 0) {
      if (creditor) this.noteRent(p, creditor, pay, this.rentTileFrom(reason));
      if (reason) this.say(`${p.name} paid $${amount} ${reason}`, 'money');
      return true;
    }
    this.turn.debt = {
      debtor: p.id,
      creditor: creditor?.id || null,
      amount: -p.money,               // re-derived from the balance on every push
      reason,
      rentSoFar: creditor ? pay : 0,
    };
    this.turn.phase = 'debt';
    if (creditor && pay > 0) this.noteRent(p, creditor, pay, this.rentTileFrom(reason));
    if (pay > 0) this.say(`${p.name} paid $${pay} ${reason} and still owes $${-p.money}`, 'warn');
    else this.say(`${p.name} owes $${amount} ${reason} and must raise funds`, 'warn');
    if (this.autoPlayed(p)) this.scheduleBot(900);
    return false;
  }

  /** Charge a non-current player: auto-liquidate, then bankrupt if still short. */
  forcePay(p, amount, creditor) {
    while (p.money < amount) {
      // What is still owed goes with the ask, so a $50 card cannot cost
      // somebody the dearest deed they own — see autoLiquidate.
      if (!this.autoLiquidate(p, amount - p.money)) break;
    }
    if (p.money >= amount) {
      p.money -= amount;
      if (creditor) this.receive(creditor, amount);
      else this.bankSink(amount);
      return true;
    }
    this.bankrupt(p, creditor);
    return false;
  }

  /**
   * Raise cash for somebody who is short, one asset at a time. Returns true
   * while there is still something left to sell.
   *
   * The order is the whole point. This used to raze buildings first and only
   * then reach for the mortgage book, which meant a player with one hotel and
   * six spare streets paid a rent bill by knocking down the only thing earning
   * them anything — and then, three bills later, went bankrupt holding a pile
   * of unmortgaged deeds. Same assets, wrong sequence.
   *
   * So: strays first (a street outside a colour collects base rent and is worth
   * more in the bank than on the board). Then buildings, cheapest colour first,
   * so the expensive engine is the last thing dismantled. Then, only when
   * nothing else is left, the bare sets themselves.
   *
   * Within the strays it is the SMALLEST sale that settles the bill, and the
   * price ladder is only climbed when nothing smaller is enough. `need` is
   * what is still owed — this is called for human seats too (forcePay, and any
   * chair the house is minding while a connection is down), and a player who
   * never chose any of this should not lose a $400 deed to a $50 card and then
   * be handed a $221 bill to buy it back. Dearest-first only gives up "the
   * least earning power" when the bill is big enough to need it, and when it
   * is, that is exactly the order this falls into anyway.
   *
   * Every step goes through mortgage()/sellHouse(), so the even-build rule and
   * the mortgage setting still decide what is actually legal — a step that is
   * refused simply falls through to the next candidate rather than reading as
   * "this player is out of road", which is what sends them bankrupt.
   */
  autoLiquidate(p, need = 0) {
    const mine = this.tilesOf(p.id);
    const bare = (i) => !(this.own(i).houses > 0) && !this.own(i).mortgaged;
    const inSet = (i) => {
      const t = this.tile(i);
      return t.type === 'property' && this.ownsFullGroup(p.id, t.group);
    };

    const strays = mine.filter((i) => bare(i) && !inSet(i))
      .sort((a, b) => this.tile(a).price - this.tile(b).price);
    // Enough on its own to end this, cheapest first; then whatever is left,
    // dearest first, because if nothing covers it the most cash per deed sold
    // is the fewest deeds sold.
    const covers = (i) => Math.floor(this.tile(i).price / 2) >= need;
    const ladder = [...strays.filter(covers), ...strays.filter((i) => !covers(i)).reverse()];
    for (const i of ladder) if (this.mortgage(p.id, i, true)) return true;

    const built = mine.filter((i) => (this.own(i).houses || 0) > 0)
      .sort((a, b) => this.tile(a).price - this.tile(b).price);
    for (const i of built) if (this.sellHouse(p.id, i, true)) return true;

    const rest = mine.filter(bare).sort((a, b) => this.tile(a).price - this.tile(b).price);
    for (const i of rest) if (this.mortgage(p.id, i, true)) return true;
    return false;
  }

  // -------------------------------------------------------------------- roll --
  roll(id, forced = null) {
    if (!this.isCurrent(id)) return { error: 'Not your turn' };
    if (this.turn.phase !== 'roll') return { error: 'Cannot roll now' };
    const p = this.current;
    this.actionMoves = [];

    const d1 = forced?.[0] ?? 1 + Math.floor(Math.random() * 6);
    const d2 = forced?.[1] ?? 1 + Math.floor(Math.random() * 6);
    this.turn.dice = [d1, d2];
    this.turn.rolledThisTurn = true;
    const isDouble = d1 === d2;
    if (isDouble) this.statFor(p).doubles++;

    if (p.jail) {
      if (isDouble) {
        p.jail = false;
        p.jailTurns = 0;
        // A jail-escape double buys freedom, not a free roll — and buy/skip/
        // auction must not re-derive a reroll from these dice later.
        this.turn.noReroll = true;
        this.say(`${p.name} rolled a double (${d1}+${d2}) and walked out of prison`, 'dice');
        this.movePlayer(p, d1 + d2);
        this.turn.phase = this.turn.phase === 'debt' ? 'debt' : (this.turn.pending ? this.turn.phase : 'end');
        this.push();
        this.maybeBot();
        return { ok: true };
      }
      p.jailTurns++;
      this.say(`${p.name} rolled ${d1}+${d2} — still in prison (${p.jailTurns}/${MAX_JAIL_TURNS})`, 'dice');
      if (p.jailTurns >= MAX_JAIL_TURNS) {
        this.say(`${p.name} must pay the $${JAIL_FINE} fine`, 'warn');
        if (this.charge(p, JAIL_FINE, null, 'as a prison fine')) {
          p.jail = false;
          p.jailTurns = 0;
          this.movePlayer(p, d1 + d2);
          // The walk itself can land on unpayable rent — that debt must stand.
          this.turn.phase = this.turn.debt ? 'debt' : (this.turn.pending ? this.turn.phase : 'end');
        } else {
          // Can't pay yet: remember the rolled move so settling the fine in
          // the debt phase actually opens the cell and walks the player out.
          this.turn.debt.jailRelease = d1 + d2;
        }
      } else {
        this.turn.phase = 'end';
      }
      this.push();
      this.maybeBot();
      return { ok: true };
    }

    if (isDouble) {
      this.turn.doubles++;
      if (this.turn.doubles >= 3) {
        this.say(`${p.name} rolled three doubles in a row — off to prison!`, 'jail');
        this.sendToJail(p);
        this.turn.phase = 'end';
        this.push();
        this.maybeBot();
        return { ok: true };
      }
    }

    this.say(`${p.name} rolled ${d1} + ${d2} = ${d1 + d2}${isDouble ? ' (double!)' : ''}`, 'dice');
    this.movePlayer(p, d1 + d2);
    if (this.turn.phase !== 'debt' && !this.turn.pending && this.turn.phase !== 'auction') {
      const encore = isDouble && !p.jail && !this.turn.noReroll;
      this.turn.phase = encore ? 'roll' : 'end';
      if (encore) this.say(`${p.name} rolls again`, 'info');
    }
    this.push();
    this.maybeBot();
    return { ok: true };
  }

  noteMove(p, from, to, steps, cause) {
    // A number that only goes up, because the client replays these in order
    // and has to know which of them it has already played. Wall-clock cannot
    // do that job: a roll and the card its tile drew are resolved inside the
    // same millisecond, so two legs of one journey share a timestamp and the
    // second of them looks like something already seen.
    this.moveSeq = (this.moveSeq || 0) + 1;
    this.actionMoves.push({ seq: this.moveSeq, playerId: p.id, from, to, steps, cause, at: Date.now() });
    if (this.actionMoves.length > 6) this.actionMoves.shift();
  }

  movePlayer(p, steps, { collectSalary = true, animate = true, cause = 'roll' } = {}) {
    const size = this.map.size;
    const from = p.pos;
    let to = (p.pos + steps) % size;
    if (to < 0) to += size;
    // Landing dead on START is its own (bigger) payday — see landOn.
    const landsOnStart = this.tile(to)?.type === 'start';
    const passedStart = steps > 0 && to < from && !landsOnStart;
    p.pos = to;
    this.lastMove = animate ? { playerId: p.id, from, to, steps, at: Date.now() } : null;
    if (animate) this.noteMove(p, from, to, steps, cause);
    if (steps > 0 && to < from && collectSalary) this.statFor(p).laps++;
    if (passedStart && collectSalary) {
      this.receive(p, SALARY);
      this.say(`${p.name} passed START and collected $${SALARY}`, 'money');
      this.noteLap(p);
    }
    this.landOn(p, to);
  }

  teleport(p, to, { collectSalary = true, cause = 'card' } = {}) {
    const from = p.pos;
    const landsOnStart = this.tile(to)?.type === 'start';
    const passedStart = to < from && !landsOnStart;
    p.pos = to;
    this.lastMove = { playerId: p.id, from, to, steps: 0, at: Date.now() };
    this.noteMove(p, from, to, 0, cause);
    if (passedStart && collectSalary) {
      this.receive(p, SALARY);
      this.statFor(p).laps++;
      this.say(`${p.name} passed START and collected ${SALARY}`, 'money');
      this.noteLap(p);
    }
    this.landOn(p, to);
  }

  // ------------------------------------------------------------------ landing --
  landOn(p, index, opts = {}) {
    const t = this.tile(index);
    switch (t.type) {
      case 'start':
        this.receive(p, START_BONUS);
        this.say(`${p.name} landed right on START — $${START_BONUS}!`, 'money');
        break;

      case 'prison':
        this.say(`${p.name} is just visiting the prison`, 'info');
        break;

      case 'gotoprison':
        this.say(`${p.name} was sent to prison`, 'jail');
        this.sendToJail(p);
        break;

      case 'vacation': {
        if (this.settings.vacationCash && this.vacationPot > 0) {
          this.say(`${p.name} collected the $${this.vacationPot} vacation pot`, 'money');
          const pot = this.vacationPot;
          this.vacationPot = 0;
          this.receive(p, pot);
        }
        p.skipTurns = 1;
        // A vacation starts NOW: the rest of this turn is cancelled too —
        // a double buys no encore from a deck chair.
        this.turn.noReroll = true;
        this.say(`${p.name} is on vacation and will miss the next turn`, 'info');
        break;
      }

      case 'tax': {
        const due = t.amount ?? Math.floor((p.money * t.percent) / 100);
        this.charge(p, due, null, `for ${t.name}`);
        break;
      }

      case 'refund':
        this.receive(p, t.amount);
        this.say(`${p.name} received a $${t.amount} tax refund`, 'money');
        break;

      case 'treasure':
        this.drawCard(p, 'treasure');
        break;

      case 'surprise':
        this.drawCard(p, 'surprise');
        break;

      case 'property':
      case 'airport':
      case 'utility': {
        const o = this.own(index);
        if (!o) {
          this.offerPurchase(p, index);
        } else if (o.owner === p.id) {
          this.say(`${p.name} landed on their own ${t.name}`, 'info');
        } else if (o.mortgaged) {
          this.say(`${t.name} is mortgaged — no rent due`, 'info');
        } else {
          const owner = this.player(o.owner);
          if (this.sameTeam(p, owner)) {
            this.say(`${t.name} belongs to ${owner.name}'s team — no rent`, 'info');
            break;
          }
          if (this.settings.noRentInPrison && owner.jail) {
            this.say(`${owner.name} is in prison — no rent collected`, 'info');
            break;
          }
          const rent = this.rentFor(index, opts.payMultiplier);
          this.say(`${p.name} pays $${rent} rent to ${owner.name} for ${t.name}`, 'rent');
          if (rent >= 120) {
            this.botSay(owner, 'bigRentTaken');
            this.botSay(p, 'bigRentPaid');
          }
          // charge() itself notes the rent — the full amount when it clears,
          // and each streamed slice as it lands when it does not.
          this.charge(p, rent, owner, `for ${t.name}`);
        }
        break;
      }
      default:
        break;
    }
  }

  rentFor(index, multiplier = 1) {
    const t = this.tile(index);
    const o = this.own(index);
    if (!o || o.mortgaged) return 0;
    const owner = this.player(o.owner);

    if (t.type === 'property') {
      const full = this.ownsFullGroup(owner.id, t.group);
      let rent = t.rent[o.houses || 0];
      if (full && (o.houses || 0) === 0 && this.settings.x2rent) rent *= 2;
      return Math.round(rent * multiplier);
    }
    if (t.type === 'airport') {
      const count = this.tilesOf(owner.id).filter((i) => this.tile(i).type === 'airport').length;
      return 25 * Math.pow(2, Math.max(0, count - 1)) * multiplier;
    }
    if (t.type === 'utility') {
      const count = this.tilesOf(owner.id).filter((i) => this.tile(i).type === 'utility').length;
      const dice = (this.turn?.dice?.[0] || 3) + (this.turn?.dice?.[1] || 4);
      const mult = multiplier > 1 ? multiplier : (count >= 2 ? 10 : 4);
      return dice * mult;
    }
    return 0;
  }

  sendToJail(p) {
    this.botSay(p, 'jail');
    this.statFor(p).jailed++;
    const from = p.pos;
    p.pos = this.cornerIndex('prison');
    p.jail = true;
    p.jailTurns = 0;
    this.turn.doubles = 0;
    this.lastMove = { playerId: p.id, from: p.pos, to: p.pos, steps: 0, at: Date.now() };
    this.noteMove(p, from, p.pos, 0, 'jail');
  }

  // -------------------------------------------------------------------- cards --
  /** The map's own localized deck when it has one, the classic deck otherwise. */
  freshDecks() {
    const built = buildDecks(this.map);
    return {
      treasure: shuffled(built.treasure),
      surprise: shuffled(built.surprise),
    };
  }

  drawCard(p, deckName) {
    const deck = this.decks[deckName];
    if (!deck.length) this.decks[deckName] = shuffled(buildDecks(this.map)[deckName]);
    const card = this.decks[deckName].shift();
    this.decks[deckName].push(card);
    // `tone` is what the client paints the card with, and `playerId` is who
    // it belongs to — both read in the second it turns over, before the words.
    this.lastCard = {
      deck: deckName,
      text: card.text,
      tone: cardTone(card.act),
      playerId: p.id,
      at: Date.now(),
    };
    this.say(`${p.name} drew ${deckName === 'treasure' ? 'a Treasure' : 'a Surprise'}: ${card.text}`, deckName);
    this.applyCard(p, card.act);
  }

  applyCard(p, act) {
    switch (act.kind) {
      case 'money':
        if (act.amount >= 0) this.receive(p, act.amount);
        else this.charge(p, -act.amount, null, 'for a card');
        break;

      case 'moveTo': {
        let idx;
        if (act.tile === 'start') idx = this.cornerIndex('start');
        else if (act.tile === 'vacation') idx = this.cornerIndex('vacation');
        else if (act.tile === 'prison') idx = this.cornerIndex('prison');
        else if (act.tile === 'priciest') {
          idx = this.map.tiles.reduce((best, t) => (t.type === 'property' && t.price > (this.tile(best)?.price || 0) ? t.index : best), 0);
        } else idx = Number(act.tile);
        // Salary only when the card says so (START / priciest cards) — a
        // backwards hop to Vacation is not a lap of the board.
        this.teleport(p, idx, { collectSalary: act.collect === true });
        break;
      }

      case 'moveBy': {
        // A forward hop walks the board like any roll — wrapping past START
        // pays the salary and counts the lap. Backwards stays salary-free.
        this.movePlayer(p, act.n, { collectSalary: act.n > 0, cause: 'card' });
        break;
      }

      case 'nearest': {
        const size = this.map.size;
        for (let step = 1; step <= size; step++) {
          const idx = (p.pos + step) % size;
          if (this.tile(idx).type === act.target) {
            const passedStart = idx < p.pos;
            const from = p.pos;
            p.pos = idx;
            if (passedStart) { this.receive(p, SALARY); this.statFor(p).laps++; this.say(`${p.name} passed START (+${SALARY})`, 'money'); }
            this.lastMove = { playerId: p.id, from, to: idx, steps: step, at: Date.now() };
            this.noteMove(p, from, idx, step, 'card');
            this.landOn(p, idx, { payMultiplier: act.payMultiplier });
            break;
          }
        }
        break;
      }

      case 'perProperty': {
        const owned = this.map.tiles.filter((t) => t.type === 'property' && this.own(t.index)?.owner === p.id).length;
        const total = owned * Math.abs(act.amount);
        if (!owned || !total) { this.say(`${p.name} owns no streets — the card fizzles`, 'info'); break; }
        if (act.amount >= 0) {
          this.receive(p, total);
          this.say(`${p.name} collects $${total} across ${owned} street${owned === 1 ? '' : 's'}`, 'money');
        } else {
          this.charge(p, total, null, `across ${owned} street${owned === 1 ? '' : 's'}`);
        }
        break;
      }

      case 'jail':
        this.sendToJail(p);
        break;

      case 'getout':
        p.getOutCards++;
        break;

      case 'collectEach': {
        for (const other of this.active) {
          if (other.id === p.id) continue;
          this.forcePay(other, act.amount, p);
        }
        break;
      }

      case 'payEach': {
        const others = this.active.filter((o) => o.id !== p.id);
        const total = act.amount * others.length;
        if (total <= 0) break;
        if (p.money >= total) {
          // Straight to the players — this money must never touch the
          // vacation pot, so it can't go through charge()'s bank path.
          p.money -= total;
          for (const other of others) this.receive(other, act.amount);
          this.say(`${p.name} paid $${act.amount} to every player`, 'money');
        } else {
          // The debt remembers exactly who it is owed to, and how much each:
          // the cash on hand splits pro rata right now, every later gain
          // streams the same way, and anyone leaving the game before it
          // settles is forgiven instead of being paid into the void.
          const pay = Math.max(0, p.money);
          p.money -= total;
          this.turn.debt = {
            debtor: p.id, creditor: null, amount: -p.money, reason: 'to the other players',
            each: act.amount,
            owedTo: others.map((o) => o.id),
            owedLeft: others.map(() => act.amount),
          };
          this.turn.phase = 'debt';
          if (pay > 0) this.splitAmongOwed(this.turn.debt, pay);
          if (pay > 0) this.say(`${p.name} paid $${pay} to the other players and still owes $${-p.money}`, 'warn');
          else this.say(`${p.name} owes $${total} to the other players and must raise funds`, 'warn');
          if (this.autoPlayed(p)) this.scheduleBot(900);
        }
        break;
      }

      case 'repairs': {
        let houses = 0, hotels = 0;
        for (const i of this.tilesOf(p.id)) {
          const h = this.own(i).houses || 0;
          if (h === 5) hotels++; else houses += h;
        }
        const due = houses * act.house + hotels * act.hotel;
        if (due > 0) this.charge(p, due, null, 'for repairs');
        else this.say(`${p.name} has no buildings — nothing to repair`, 'info');
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------- buying --
  offerPurchase(p, index) {
    const t = this.tile(index);
    if (this.autoPlayed(p)) {
      this.turn.pending = { type: 'buy', tile: index, price: t.price };
      this.turn.phase = 'action';
      this.scheduleBot(700);
      return;
    }
    this.turn.pending = { type: 'buy', tile: index, price: t.price };
    this.turn.phase = 'action';
  }

  buy(id) {
    if (!this.isCurrent(id)) return { error: 'Not your turn' };
    const pend = this.turn.pending;
    if (!pend || pend.type !== 'buy') return { error: 'Nothing to buy' };
    const p = this.current;
    const t = this.tile(pend.tile);
    if (p.money < t.price) return { error: 'Not enough money' };
    p.money -= t.price;
    this.ownership[pend.tile] = { owner: p.id, houses: 0, mortgaged: false };
    if (t.type === 'property') this.statFor(p).streetsBought++;
    this.lastBuy = { by: p.id, tile: pend.tile, at: Date.now() };
    this.say(`${p.name} bought ${t.name} for ${t.price}`, 'buy');
    this.turn.pending = null;
    this.turn.phase = this.afterActionPhase(p);
    this.push();
    this.maybeBot();
    return { ok: true };
  }

  skipBuy(id) {
    if (!this.isCurrent(id)) return { error: 'Not your turn' };
    const pend = this.turn.pending;
    if (!pend || pend.type !== 'buy') return { error: 'Nothing to skip' };
    const tileIndex = pend.tile;
    this.turn.pending = null;
    const p = this.current;
    if (this.settings.auction && this.active.length > 1) {
      this.startAuction(tileIndex);
    } else {
      this.say(`${p.name} passed on ${this.tile(tileIndex).name}`, 'info');
      this.turn.phase = this.afterActionPhase(p);
      this.push();
      this.maybeBot();
    }
    return { ok: true };
  }

  // ------------------------------------------------------------------ auction --
  startAuction(tileIndex) {
    const t = this.tile(tileIndex);
    // Fresh hammer, fresh heads: every bot re-prices the street once and
    // holds that ceiling for the whole race (see botAuctionCap). Kept off
    // the auction object so nobody's valuation ever reaches a client.
    this.auctionCaps = {};
    this.auction = {
      tile: tileIndex,
      bid: 0,
      leader: null,
      inRace: this.active.map((p) => p.id),
      endsAt: Date.now() + AUCTION_SECONDS * 1000,
    };
    this.turn.phase = 'auction';
    this.say(`${t.name} goes to auction! Starting bid $10`, 'auction');
    this.push();
    this.armAuctionTimer();
    this.maybeBotAuction();
  }

  armAuctionTimer() {
    clearTimeout(this.timers.auction);
    this.timers.auction = setTimeout(() => this.finishAuction(), AUCTION_SECONDS * 1000 + 200);
  }

  bid(id, amount) {
    const a = this.auction;
    if (!a) return { error: 'No auction running' };
    if (!a.inRace.includes(id)) return { error: 'You passed already' };
    const p = this.player(id);
    amount = Math.floor(Number(amount) || 0);
    const min = a.bid === 0 ? 10 : a.bid + 10;
    if (amount < min) return { error: `Minimum bid is $${min}` };
    // Escrow: the leading bid is paid up front (and refunded when outbid), so
    // the winner can never spend the money elsewhere during the countdown and
    // close the auction into a negative balance.
    const available = p.money + (a.leader === id ? a.bid : 0);
    if (amount > available) return { error: 'Not enough money' };
    if (a.leader) this.player(a.leader).money += a.bid; // refund the old escrow
    p.money -= amount;
    a.bid = amount;
    a.leader = id;
    a.endsAt = Date.now() + 12000;
    this.say(`${p.name} bids $${amount}`, 'auction');
    // Everyone else had already passed before this bid landed — the hammer
    // falls on the spot rather than making the only bidder outwait a timer
    // nobody else is on. (passBid applies the same close from its side.)
    if (a.inRace.length <= 1) return this.finishAuction();
    this.push();
    clearTimeout(this.timers.auction);
    this.timers.auction = setTimeout(() => this.finishAuction(), 12200);
    this.maybeBotAuction();
    return { ok: true };
  }

  passBid(id) {
    const a = this.auction;
    if (!a) return { error: 'No auction running' };
    if (!a.inRace.includes(id)) return { ok: true };
    a.inRace = a.inRace.filter((x) => x !== id);
    const p = this.player(id);
    this.say(`${p.name} passed`, 'auction');
    if (a.inRace.length <= 1 && a.leader) return this.finishAuction();
    if (a.inRace.length === 0) return this.finishAuction();
    this.push();
    this.maybeBotAuction();
    return { ok: true };
  }

  finishAuction() {
    const a = this.auction;
    if (!a) return { ok: true };
    clearTimeout(this.timers.auction);
    this.auction = null;
    this.auctionCaps = {};
    // The player on turn was excused the shot clock while this ran. Give it
    // back now, fresh — they have been sitting through somebody else's
    // bidding war and should not lose their turn to the leftover of it.
    if (this.status === 'playing' && this.turn) this.armTurnTimer();
    // A game that ended mid-countdown has nothing left to award.
    if (this.status !== 'playing') return { ok: true };
    const t = this.tile(a.tile);
    if (a.leader && !this.player(a.leader)?.bankrupt) {
      // The bid is already escrowed by bid(); just hand over the deed.
      const winner = this.player(a.leader);
      this.ownership[a.tile] = { owner: winner.id, houses: 0, mortgaged: false };
      this.statFor(winner).auctionsWon++;
      this.lastBuy = { by: winner.id, tile: a.tile, at: Date.now() };
      this.say(`${winner.name} won ${t.name} at auction for ${a.bid}`, 'auction');
    } else {
      this.say(`Nobody bid on ${t.name} — it stays with the bank`, 'auction');
    }
    const p = this.current;
    if (!p || p.bankrupt) {
      // The roller left while the hammer was up — their turn leaves with
      // them now that the auction no longer needs it parked.
      this.nextTurn();
      return { ok: true };
    }
    this.turn.phase = this.turn.debt ? 'debt' : this.afterActionPhase(p);
    this.push();
    this.maybeBot();
    return { ok: true };
  }

  /**
   * A player leaving play mid-auction must not fork the table: their exit is
   * settled here, inside the auction, and the turn is never advanced out
   * from under it — finishAuction hands the turn on when the hammer falls.
   * The escrow follows the caller's rules: refunded into the leaver's cash
   * for a bankruptcy (so a creditor inherits it), voided otherwise.
   * Returns true when their exit ended the auction on the spot.
   */
  settleAuctionExit(p, { refund = false } = {}) {
    const a = this.auction;
    if (!a) return false;
    a.inRace = a.inRace.filter((x) => x !== p.id);
    if (a.leader === p.id) {
      if (refund) p.money += a.bid;
      a.leader = null;
      a.bid = 0;
      this.say(`${p.name}'s bid is void — the auction restarts at $10`, 'auction');
    }
    // The same close passBid uses: nobody left, or only the leader is.
    if (a.inRace.length === 0 || (a.inRace.length === 1 && a.leader)) {
      this.finishAuction();
      return true;
    }
    this.maybeBotAuction();
    return false;
  }

  // -------------------------------------------------------------------- jail --
  jailPay(id) {
    if (!this.isCurrent(id)) return { error: 'Not your turn' };
    const p = this.current;
    if (!p.jail) return { error: 'Not in prison' };
    if (this.turn.phase === 'debt') return { error: 'Settle your debt first' };
    if (this.turn.phase === 'auction') return { error: 'Auction in progress' };
    if (p.money < JAIL_FINE) return { error: 'Not enough money' };
    p.money -= JAIL_FINE;
    p.jail = false;
    p.jailTurns = 0;
    // The fine buys the door, not the dice.
    //
    // It used to open the cell and hand back a whole turn, which made prison
    // a $50 toll on a bad landing rather than a place anybody gets stuck:
    // paying on sight was always right, and the corner that is supposed to
    // cost you three turns cost the price of a cheap street instead. Now the
    // walk waits for the next turn, so rolling for a double is a real choice
    // against buying the door outright.
    this.say(`${p.name} paid $${JAIL_FINE} and left prison — no roll this turn`, 'jail');
    this.nextTurn();
    return { ok: true };
  }

  jailCard(id) {
    if (!this.isCurrent(id)) return { error: 'Not your turn' };
    const p = this.current;
    if (!p.jail || p.getOutCards < 1) return { error: 'No card available' };
    p.getOutCards--;
    p.jail = false;
    p.jailTurns = 0;
    this.say(`${p.name} used a get-out-of-prison card`, 'jail');
    this.push();
    this.maybeBot();
    return { ok: true };
  }

  // --------------------------------------------------------------- buildings --
  canBuild(playerId, index) {
    const t = this.tile(index);
    const o = this.own(index);
    if (!o || o.owner !== playerId || t.type !== 'property') return false;
    if (o.mortgaged) return false;
    if (!this.ownsFullGroup(playerId, t.group)) return false;
    const group = this.map.groups[t.group];
    if (group.some((i) => this.own(i).mortgaged)) return false;
    if ((o.houses || 0) >= 5) return false;
    if (this.settings.evenBuild) {
      const min = Math.min(...group.map((i) => this.own(i).houses || 0));
      if ((o.houses || 0) > min) return false;
    }
    return true;
  }

  build(id, index) {
    const p = this.player(id);
    if (!p || this.status !== 'playing') return { error: 'Not available' };
    // Construction happens on your clock, not between other people's rolls.
    if (!this.isCurrent(id)) return { error: 'Wait for your turn' };
    if (!this.canBuild(id, index)) return { error: 'Cannot build there' };
    const t = this.tile(index);
    if (p.money < t.houseCost) return { error: 'Not enough money' };
    p.money -= t.houseCost;
    const o = this.own(index);
    o.houses = (o.houses || 0) + 1;
    this.statFor(p).housesBuilt++;
    this.say(`${p.name} built ${o.houses === 5 ? 'a hotel' : 'a house'} on ${t.name}`, 'build');
    this.push();
    return { ok: true };
  }

  /**
   * Everything this country will take, in one press.
   *
   * Building by hand is five taps a street and twenty for a country, and the
   * fifth of them is refused for a reason the button cannot show — even build
   * says this street is a house ahead, or the money ran out two taps ago.
   * Pressing again and again to find out which is not a decision anybody is
   * making; it is just the interface asking to be beaten.
   *
   * So this builds the same houses a patient player would, in the same order:
   * always the shortest street in the country first, which is what even build
   * asks for and what brings a country up together rather than leaving one
   * hotel standing over four bare plots. It stops on the first thing that
   * stops it — no money, a mortgage in the country, a hotel already there —
   * and says how far it got. If the rules only allow one street to be topped
   * out, one street is what gets topped out.
   */
  buildAll(id, group) {
    const p = this.player(id);
    if (!p || this.status !== 'playing') return { error: 'Not available' };
    // Construction happens on your clock, not between other people's rolls.
    if (!this.isCurrent(id)) return { error: 'Wait for your turn' };
    const key = String(group || '');
    const tiles = this.map.groups[key];
    if (!tiles?.length) return { error: 'Unknown country' };
    if (!this.ownsFullGroup(id, key)) return { error: 'You need the whole country first' };

    let built = 0;
    let spent = 0;
    // At most five buildings a street, so this cannot run away even if a rule
    // one day stops answering the way this loop expects.
    for (let guard = tiles.length * 5; guard > 0; guard--) {
      const next = tiles
        .filter((i) => this.canBuild(id, i) && p.money >= this.tile(i).houseCost)
        .sort((a, b) => ((this.own(a).houses || 0) - (this.own(b).houses || 0))
          || (this.tile(a).houseCost - this.tile(b).houseCost))[0];
      if (next === undefined) break;
      const t = this.tile(next);
      p.money -= t.houseCost;
      spent += t.houseCost;
      const o = this.own(next);
      o.houses = (o.houses || 0) + 1;
      this.statFor(p).housesBuilt++;
      built++;
    }
    if (!built) return { error: 'Nothing more can be built there' };

    const name = GROUPS[key]?.name || key;
    const topped = tiles.every((i) => (this.own(i).houses || 0) >= 5);
    this.say(
      `${p.name} built ${built} ${built === 1 ? 'building' : 'buildings'} across ${name}`
      + ` for ${moneyText(spent)}${topped ? ' — the country is full' : ''}`,
      'build',
    );
    this.push();
    return { ok: true, built, spent, topped };
  }

  sellHouse(id, index, silent = false) {
    const p = this.player(id);
    const o = this.own(index);
    if (!p || !o || o.owner !== id || !(o.houses > 0)) return false;
    // Same clock rule as building — the system (silent) may raze any time.
    if (!silent && !this.isCurrent(id)) return false;
    const t = this.tile(index);
    if (this.settings.evenBuild) {
      const group = this.map.groups[t.group];
      const max = Math.max(...group.map((i) => this.own(i).houses || 0));
      if (o.houses < max) return false;
    }
    o.houses--;
    const refund = Math.floor(t.houseCost / 2);
    this.say(`${p.name} sold a building on ${t.name} for $${refund}`, 'build');
    this.receive(p, refund);
    if (!silent) this.push();
    return true;
  }

  mortgage(id, index, silent = false) {
    if (!this.settings.mortgage) return false;
    const p = this.player(id);
    const o = this.own(index);
    if (!p || !o || o.owner !== id || o.mortgaged) return false;
    if (!silent && !this.isCurrent(id)) return false;
    const t = this.tile(index);
    if (t.type === 'property') {
      const group = this.map.groups[t.group];
      if (group.some((i) => (this.own(i)?.houses || 0) > 0)) return false;
    }
    o.mortgaged = true;
    const value = Math.floor(t.price / 2);
    this.say(`${p.name} mortgaged ${t.name} for $${value}`, 'mortgage');
    this.receive(p, value);
    if (!silent) this.push();
    return true;
  }

  unmortgage(id, index) {
    const p = this.player(id);
    const o = this.own(index);
    if (!p || !o || o.owner !== id || !o.mortgaged) return { error: 'Not mortgaged' };
    if (!this.isCurrent(id)) return { error: 'Wait for your turn' };
    const t = this.tile(index);
    const cost = Math.ceil((t.price / 2) * 1.1);
    if (p.money < cost) return { error: 'Not enough money' };
    p.money -= cost;
    o.mortgaged = false;
    this.say(`${p.name} lifted the mortgage on ${t.name} for $${cost}`, 'mortgage');
    this.push();
    return { ok: true };
  }

  // -------------------------------------------------------------------- debt --
  /**
   * The moment the debtor's balance climbs back to zero the debt is done —
   * no confirmation step, because the money already flowed as it arrived.
   * The turn picks up exactly where the charge interrupted it: a doubles
   * roll keeps its re-roll, a paid-off prison fine opens the cell and walks
   * the stored move, and a pending purchase gets resolved.
   */
  settleDebtIfPossible() {
    const d = this.turn?.debt;
    if (!d) return;
    const p = this.player(d.debtor);
    if (!p || p.money < 0) return;
    this.turn.debt = null;
    this.say(`${p.name} is back in the black — the debt is settled`, 'money');

    if (d.jailRelease) {
      // The prison fine is paid — open the cell and play out the stored roll.
      p.jail = false;
      p.jailTurns = 0;
      this.turn.phase = 'end';
      this.say(`${p.name} leaves prison`, 'jail');
      this.movePlayer(p, d.jailRelease);
      // landOn set the phase where it belongs (action/debt/auction); a plain
      // tile leaves the 'end' baseline standing.
      if (this.turn.debt) this.turn.phase = 'debt';
      else if (this.turn.pending) this.turn.phase = 'action';
    } else {
      // A doubles roll whose landing opened this debt still owes a re-roll.
      this.turn.phase = this.turn.pending ? 'action' : this.afterActionPhase(p);
    }
    this.maybeBot();
  }

  /**
   * Kept for older clients whose debt sheet still offers a "pay" button.
   * Money streams to the creditors the moment it arrives now, so by the time
   * this could succeed the debt has already closed itself — answer honestly
   * either way.
   */
  payDebt(id) {
    const d = this.turn?.debt;
    if (!d || d.debtor !== id) return { error: 'No debt' };
    const p = this.player(id);
    if (p.money < 0) return { error: 'Still not enough money' };
    this.settleDebtIfPossible();
    this.push();
    return { ok: true };
  }

  /**
   * A player leaving play takes their claims with them: whatever the open
   * debt still owed them is forgiven, and the debtor's balance climbs by
   * that much — the money was never going to be printed for an empty chair.
   */
  forgiveDebtTo(leaver) {
    const d = this.turn?.debt;
    if (!d || d.debtor === leaver.id) return;
    const debtor = this.player(d.debtor);
    if (!debtor) return;
    if (d.creditor === leaver.id) {
      debtor.money += Math.max(0, -debtor.money);
    } else if (d.owedTo) {
      const i = d.owedTo.indexOf(leaver.id);
      if (i === -1) return;
      debtor.money += Math.max(0, Math.min(d.owedLeft[i], -debtor.money));
      d.owedTo.splice(i, 1);
      d.owedLeft.splice(i, 1);
    } else return;
    d.amount = Math.max(0, -debtor.money);
    this.settleDebtIfPossible();
  }

  declareBankrupt(id) {
    const d = this.turn?.debt;
    const p = this.player(id);
    if (!p) return { error: 'No player' };
    if (p.bankrupt) return { error: 'Already out' };
    if (this.status !== 'playing') return { error: 'No game to concede' };
    // Anyone may lay down their tiles at any time — conceding is a right,
    // not a turn action. A debtor's concession still pays the creditor.
    const creditor = d?.debtor === id && d?.creditor ? this.player(d.creditor) : null;
    if (!creditor) this.say(`${p.name} concedes the game`, 'bankrupt');
    this.bankrupt(p, creditor);
    return { ok: true };
  }

  /**
   * Ends the game when only one side is left standing. In team games that
   * means one team, not one player — a team survives while any member does.
   */
  checkGameEnd() {
    // Already decided — an exit settled mid-removal can land here twice.
    if (this.status === 'ended') return true;
    const alive = this.active;
    if (this.teamsOn) {
      const teams = [...new Set(alive.map((p) => p.team))];
      if (teams.length > 1) return false;
      this.turnCount++;
      this.recordWorth();
      this.status = "ended";
      this.winningTeam = teams[0] ?? null;
      this.winner = alive[0] || null;
      const label = this.winningTeam != null ? TEAMS[this.winningTeam].name : "Nobody";
      const roster = alive.map((p) => p.name).join(" & ");
      this.say(`🏆 Team ${label} wins the game! (${roster})`, "system");
      this.botFarewell(alive);
    } else {
      if (alive.length > 1) return false;
      this.turnCount++;
      this.recordWorth();
      this.status = "ended";
      this.winner = alive[0] || null;
      this.say(`🏆 ${this.winner ? this.winner.name : "Nobody"} wins the game!`, "system");
      this.botFarewell(alive);
    }
    this.settleLeadShare();
    this.titles = this.computeTitles();
    this.push();
    return true;
  }

  bankrupt(p, creditor) {
    p.bankrupt = true;
    // Settle any live auction before the estate is counted: an escrowed bid
    // returns to the leaver's cash so a creditor inherits it too, and the
    // race carries on (or closes) without forking the turn.
    const settled = this.settleAuctionExit(p, { refund: true });
    const tiles = this.tilesOf(p.id);
    // The streets do NOT follow the debt: whatever cash existed already
    // streamed to the creditor — the estate itself goes back on the market,
    // houses razed and mortgages cleared, for whoever lands there next.
    if (creditor && !creditor.bankrupt) {
      creditor.money += Math.max(0, p.money);
      this.say(`${p.name} went bankrupt — ${creditor.name} keeps what was paid, the streets return to the bank`, 'bankrupt');
    } else {
      this.say(`${p.name} went bankrupt — the streets return to the bank`, 'bankrupt');
    }
    for (const i of tiles) delete this.ownership[i];
    p.money = 0;
    for (const other of this.players) {
      if (other.id !== p.id) this.botSay(other, 'bust', { name: p.name });
    }
    if (this.turn?.debt?.debtor === p.id) this.turn.debt = null;
    else this.forgiveDebtTo(p);
    this.trades = this.trades.filter((t) => t.from !== p.id && t.to !== p.id);

    if (this.checkGameEnd()) return;
    if (this.turn?.playerId === p.id && !this.auction && !settled) this.nextTurn();
    else this.push();
  }

  // ------------------------------------------------------------------- trade --
  /**
   * A deed cannot change hands while its colour is carrying buildings —
   * anywhere in the colour, not only on that deed.
   *
   * The board sits at 0,1,1 quite legally the moment somebody razes one house
   * to pay a bill, and checking only the deed in the envelope let the
   * house-free member of the group be traded out from under the two that were
   * still built: houses left standing on a colour its owner no longer owns,
   * which is not a rule anywhere and which the invariant check calls out as
   * corruption. mortgage() has always read the rule this way; this is that
   * same rule, said once for both doors.
   */
  tradeBlocked(index) {
    const o = this.own(index);
    if (!o) return false;
    if ((o.houses || 0) > 0) return true;
    const t = this.tile(index);
    if (t?.type !== 'property') return false;
    return (this.map.groups[t.group] || []).some((i) => (this.own(i)?.houses || 0) > 0);
  }

  proposeTrade(id, { to, give, get }) {
    const from = this.player(id);
    const target = this.player(to);
    if (!from || !target || from.bankrupt || target.bankrupt) return { error: 'Invalid player' };
    if (this.status !== 'playing') return { error: 'Game not running' };

    const clean = (side, owner) => ({
      money: Math.max(0, Math.min(owner.money, Math.floor(Number(side?.money) || 0))),
      tiles: (side?.tiles || []).map(Number).filter((i) => this.own(i)?.owner === owner.id),
      cards: Math.max(0, Math.min(owner.getOutCards, Math.floor(Number(side?.cards) || 0))),
    });
    const offer = { id: tradeSeq++, from: id, to, give: clean(give, from), get: clean(get, target), at: Date.now() };
    if (!offer.give.money && !offer.give.tiles.length && !offer.give.cards
      && !offer.get.money && !offer.get.tiles.length && !offer.get.cards) {
      return { error: 'Empty trade' };
    }
    // A property whose colour carries buildings cannot be traded.
    const blocked = [...offer.give.tiles, ...offer.get.tiles].some((i) => this.tradeBlocked(i));
    if (blocked) return { error: 'Sell the buildings first' };

    this.trades.push(offer);
    this.say(`${from.name} sent a trade offer to ${target.name}`, 'trade');
    this.push();
    if (this.autoPlayed(target)) this.scheduleBotTrade(offer.id);
    return { ok: true, trade: offer };
  }

  respondTrade(id, tradeId, accept) {
    const idx = this.trades.findIndex((t) => t.id === tradeId);
    if (idx === -1) return { error: 'Trade not found' };
    const trade = this.trades[idx];
    if (trade.to !== id) return { error: 'Not your trade' };
    this.trades.splice(idx, 1);
    const from = this.player(trade.from);
    const to = this.player(trade.to);
    // One of them is no longer at the table. Every line below reads a name off
    // both, and this runs from a bare setTimeout — so a null here was not a
    // failed trade, it was an uncaught TypeError inside a timer, which in Node
    // takes the process down and every live table on the box with it.
    if (!from || !to) {
      this.push();
      return { error: 'They have left the table' };
    }
    if (!accept) {
      // The asker remembers what they were refused, so the table doesn't spend
      // the rest of the game watching the same offer bounce back and forth.
      if (from) {
        from.refused = [...(from.refused || []), ...trade.get.tiles].slice(-8);
      }
      this.say(`${to.name} declined the trade from ${from.name}`, 'trade');
      this.push();
      return { ok: true };
    }
    // A zero-cash side is always affordable — a debtor's negative balance
    // must not block them trading streets to dig themselves out.
    if ((trade.give.money > 0 && from.money < trade.give.money)
      || (trade.get.money > 0 && to.money < trade.get.money)) {
      this.say('Trade failed — someone no longer has the cash', 'warn');
      this.push();
      return { error: 'Insufficient funds' };
    }
    // Re-validate the whole offer against the CURRENT board: another trade,
    // an auction or a bankruptcy may have moved these pieces since it was
    // proposed. Accepting a stale offer must never rip a tile off its new
    // owner, move buildings, or push prison cards negative.
    const stale =
      from.bankrupt || to.bankrupt
      || trade.give.tiles.some((i) => this.own(i)?.owner !== from.id || this.tradeBlocked(i))
      || trade.get.tiles.some((i) => this.own(i)?.owner !== to.id || this.tradeBlocked(i))
      || from.getOutCards < trade.give.cards
      || to.getOutCards < trade.get.cards;
    if (stale) {
      this.say('Trade failed — the offer no longer matches what each side owns', 'warn');
      this.push();
      return { error: 'Offer is out of date' };
    }
    from.money -= trade.give.money;
    to.money -= trade.get.money;
    this.receive(to, trade.give.money);
    this.receive(from, trade.get.money);
    from.getOutCards -= trade.give.cards;
    to.getOutCards += trade.give.cards;
    to.getOutCards -= trade.get.cards;
    from.getOutCards += trade.get.cards;
    for (const i of trade.give.tiles) if (this.own(i)) this.own(i).owner = to.id;
    for (const i of trade.get.tiles) if (this.own(i)) this.own(i).owner = from.id;
    this.statFor(from).tradesCompleted++;
    this.statFor(to).tradesCompleted++;
    this.say(`${from.name} and ${to.name} completed a trade`, 'trade');
    this.push();
    return { ok: true };
  }

  cancelTrade(id, tradeId) {
    const idx = this.trades.findIndex((t) => t.id === tradeId && (t.from === id || t.to === id));
    if (idx === -1) return { error: 'Trade not found' };
    this.trades.splice(idx, 1);
    this.push();
    return { ok: true };
  }

  /** Set an incoming offer aside: it leaves the recipient's action dock but
   *  stays in everyone's trade list until answered, countered, or cancelled. */
  ignoreTrade(id, tradeId, ignored = true) {
    const trade = this.trades.find((t) => t.id === tradeId && t.to === id);
    if (!trade) return { error: 'Trade not found' };
    trade.ignored = !!ignored;
    if (trade.ignored && trade.viewers?.includes(id)) {
      trade.viewers = trade.viewers.filter((v) => v !== id);
    }
    this.push();
    return { ok: true };
  }

  /** Live presence on an offer — "Ravi is looking at your trade right now". */
  setTradeViewing(id, tradeId, viewing) {
    const trade = this.trades.find((t) => t.id === tradeId);
    if (!trade || !this.player(id)) return { error: 'Trade not found' };
    const list = trade.viewers || [];
    const has = list.includes(id);
    if (viewing === has) return { ok: true }; // no change — don't spam pushes
    trade.viewers = viewing ? [...list, id] : list.filter((v) => v !== id);
    this.push();
    return { ok: true };
  }

  // ---------------------------------------------------------------- end turn --
  endTurn(id) {
    if (!this.isCurrent(id)) return { error: 'Not your turn' };
    if (this.turn.phase === 'debt') return { error: 'Settle your debt first' };
    if (this.turn.phase === 'auction') return { error: 'Auction in progress' };
    if (this.turn.phase === 'action') return { error: 'Resolve the property first' };
    if (this.turn.phase === 'roll' && !this.turn.rolledThisTurn) return { error: 'Roll the dice first' };
    this.nextTurn();
    return { ok: true };
  }

  nextTurn() {
    if (this.status !== 'playing') return;
    if (this.checkGameEnd()) return;
    // A seat the house was covering for one missed turn gets itself back the
    // moment that turn is over, clock and all.
    const leaving = this.player(this.turn?.playerId);
    if (leaving?.coveredTurn) {
      leaving.coveredTurn = false;
      leaving.botControlled = false;
    }
    let idx = this.players.findIndex((p) => p.id === this.turn.playerId);
    for (let step = 1; step <= this.players.length * 2; step++) {
      const cand = this.players[(idx + step) % this.players.length];
      if (cand.bankrupt) continue;
      if (cand.skipTurns > 0) {
        cand.skipTurns--;
        this.say(`${cand.name} is on vacation and skips this turn`, 'info');
        continue;
      }
      this.turn = {
        playerId: cand.id,
        phase: 'roll',
        dice: null,
        doubles: 0,
        pending: null,
        debt: null,
        rolledThisTurn: false,
      };
      // If their turn comes round while they're still away, a bot plays it so
      // the table never stalls on an empty chair. Coming back takes it straight
      // off them again — a refresh alone never costs anyone a turn.
      if (!cand.connected && !cand.isBot) cand.botControlled = true;
      cand.doublesInARow = 0;
      this.turnCount++;
      this.recordWorth();
      this.noteProgress();
      this.noteLeader();
      this.maybeSmallTalk();
      this.say(`${cand.name}'s turn`, 'turn');
      this.armTurnTimer();
      this.push();
      this.maybeBot();
      return;
    }
    this.push();
  }

  /** Store cosmetics: the emoji piece on the board and the chip avatar. */
  setCosmetics(id, { tokenSkin, avatar } = {}) {
    const p = this.player(id);
    if (!p) return;
    const skin = String(tokenSkin || '').slice(0, 8);
    const face = String(avatar || '').slice(0, 8);
    if (p.tokenSkin === skin && p.avatar === face) return;
    p.tokenSkin = skin;
    p.avatar = face;
    this.push();
  }

  // ----------------------------------------------------------------- rematch --
  /**
   * Back to the lobby for another round. Whoever pressed Play again takes the
   * host chair. The departed stay departed: seats that quit, timed out or are
   * still disconnected are dropped rather than resurrected as bot-played
   * ghosts, and the survivors' removal flags are wiped clean.
   */
  rematch(id) {
    const presser = this.player(id);
    if (!presser || presser.isBot) return { error: 'Take a seat first' };
    if (this.status !== 'ended') return { error: 'The game is still on' };
    const stays = (p) => p === presser || p.isBot || (p.connected !== false && !p.removedFor);
    for (const p of this.players) {
      if (stays(p)) continue;
      clearTimeout(this.timers[`grace:${p.id}`]);
      this.say(`${p.name} left the room`, 'leave');
    }
    this.players = this.players.filter(stays);
    this.awaiting = {};
    this.hostId = id;
    this.status = 'lobby';
    this.winner = null;
    this.winningTeam = null;
    this.ownership = {};
    this.turn = null;
    this.auction = null;
    this.trades = [];
    this.vacationPot = 0;
    // Last game's purchase belongs to last game; a bot must not open the
    // rematch talking about a deed nobody at this board owns any more.
    this.lastBuy = null;
    this.log = [];
    this.reliefCard = null;
    this.reliefExplained = false;
    this.players.forEach((p) => {
      p.money = this.settings.startingCash;
      p.pos = 0; p.jail = false; p.jailTurns = 0; p.getOutCards = 0;
      p.bankrupt = false; p.skipTurns = 0;
      p.timedOut = false; p.removedFor = null; p.botControlled = false;
      p.missedTurns = 0; p.coveredTurn = false;
      // A new game is a clean slate for the bot brain too: who turned it down
      // last game, and whose door it already knocked on, are last game's.
      p.blockedLaps = 0; p.refused = []; p.askedAt = {}; p.lastAskedAt = undefined;
    });
    this.say('Back to the lobby — set up the next game', 'system');
    // Whoever pressed Play again is the host now, and the board came with the
    // room. Settle it here rather than at start(), so the lobby shows what it
    // is actually going to play before anybody reaches for the button.
    this.settleBoard();
    this.push();
    return { ok: true };
  }

  // ------------------------------------------------------------------- chat --
  sendChat(id, text, channel, { auto = false } = {}) {
    const p = this.player(id);
    if (!p || !text) return;
    // The team channel only exists when teams do; anything else lands in 'all'.
    const ch = channel === 'team' && this.teamsOn && p.team != null ? 'team' : 'all';
    const msg = {
      id: Math.random().toString(36).slice(2), name: p.name, color: p.color, flag: p.flag || '',
      // Who said it, by public friend code — so the reader can report or block
      // them. Anything the server wrote itself gets a stand-in instead.
      code: this.chatCodeOf(p, auto),
      text: cleanText(String(text).slice(0, 200)), at: Date.now(),
      channel: ch, team: ch === 'team' ? p.team : null,
    };
    this.chat.push(msg);
    if (this.chat.length > 100) this.chat.shift();
    this.push();
    // Somebody real said something out loud, so somebody should answer. The
    // guard is also the loop guard: a bot's own line arrives here with
    // auto:true and a house seat is p.isBot, so nothing the server wrote can
    // ever provoke another reply. The filtered text is what gets read, not the
    // raw one — a masked word should not be answered as if it had landed.
    if (!auto && !p.isBot) this.maybeBotReply(p, msg.text, ch);
  }

  /**
   * The code a chat line is signed with.
   *
   * A real player's line carries their friend code. A house player's line — and
   * banter the server speaks for a seat it is covering — carries a stand-in that
   * is stable for the table, so it can be reported or hidden like anyone else's,
   * but it points at no real person: a human whose seat a bot was minding must
   * not be blamed for words the server wrote. Real codes are drawn from an
   * alphabet with no zero, so an H0 code can never collide with one.
   */
  chatCodeOf(p, auto = false) {
    if (auto || p.isBot) {
      return 'H0' + createHash('sha1').update(`${this.id}:${p.id}`).digest('hex').slice(0, 4).toUpperCase();
    }
    return this.hooks.codeOf?.(p.id) || null;
  }

  // ------------------------------------------------------------- bot replies --
  //
  // Somebody types something; one bot answers it. What gets said is decided in
  // botchat.js — this end gathers the facts, holds the rate limits, and does
  // the talking.
  //
  // Everything gathered below is already on every client's screen: names,
  // cash, who owns what, whose turn it is, the open debt, the last deed sold.
  // Nothing a bot knows privately — what it thinks a street is worth, what it
  // has been refused, what is left in the deck — is collected here, so no
  // reply can say something that seat could not have worked out for itself.
  //
  // The reply goes out through sendChat like any other line, so it is filtered
  // the same way and signed with the same H0 stand-in code, which is what lets
  // a player block or report a bot that is getting on their nerves.

  /** The table as a bot may describe it. Public knowledge only — see above. */
  chatScene(speaker, text, channel, skip = new Set()) {
    const lower = String(text).toLowerCase();
    // Nothing on the board means anything until it is being played: in the
    // lobby everyone holds the same cash and owns nothing, so "who is ahead"
    // and "how many streets are left" have no honest answer yet.
    const live = this.status === 'playing';
    const ranked = live ? [...this.active].sort((a, b) => this.netWorth(b) - this.netWorth(a)) : [];

    // House players only — never an auto-played seat. A person whose
    // connection dropped is being covered by the house for their TURNS; a
    // reply in the chat would come out under their own name, and nobody
    // should find "they" said things while they were gone.
    const bots = this.players
      .filter((b) => b.isBot && b.id !== speaker.id && !skip.has(b.id))
      // A team line is answered inside the team or not at all — a reply that
      // escaped onto the open channel would repeat what was said in private.
      .filter((b) => channel !== 'team' || this.sameTeam(b, speaker))
      .map((b) => ({
        id: b.id,
        name: b.name,
        cash: moneyText(b.money),
        bankrupt: !!b.bankrupt,
        spokeAt: this.botChat?.spokeAt?.[b.id] || 0,
        sets: Object.keys(this.map.groups)
          .filter((g) => this.ownsFullGroup(b.id, g))
          .map((g) => GROUPS[g]?.name || g),
        needs: this.nearSets(b.id).map((n) => ({
          tileName: this.tile(n.missing).name,
          groupName: GROUPS[n.group]?.name || n.group,
          holderId: n.holder,
          holderName: this.player(n.holder)?.name || '',
        })),
      }));

    // A street named in the message is the strongest hint there is about what
    // the line was actually about. Longest name wins, so "Old Delhi" beats
    // "Delhi" on a board that has both.
    let tileHit = null;
    this.map.tiles.forEach((t, i) => {
      if (!t.name || t.name.length < 4 || !lower.includes(t.name.toLowerCase())) return;
      if (tileHit && tileHit.name.length >= t.name.length) return;
      const o = this.own(i);
      tileHit = {
        index: i, name: t.name,
        ownerId: o?.owner || null,
        ownerName: o ? (this.player(o.owner)?.name || '') : '',
      };
    });

    const d = this.turn?.debt;
    const buyer = this.lastBuy && this.player(this.lastBuy.by);
    return {
      text,
      speaker: { id: speaker.id, name: speaker.name },
      bots,
      tileHit,
      turn: this.current ? { id: this.current.id, name: this.current.name } : null,
      // One player ahead of nobody is not a leader, so a two-horse table is
      // where this starts meaning anything.
      leader: ranked.length > 1 ? { id: ranked[0].id, name: ranked[0].name } : null,
      tail: ranked.length > 1 ? { id: ranked.at(-1).id, name: ranked.at(-1).name } : null,
      debt: d ? {
        debtorId: d.debtor,
        debtorName: this.player(d.debtor)?.name || '',
        creditorId: d.creditor,
        creditorName: d.creditor
          ? (this.player(d.creditor)?.name || '')
          : (d.owedTo ? 'the rest of us' : 'the bank'),
        amount: moneyText(d.amount),
      } : null,
      lastBuy: buyer ? { byName: buyer.name, tileName: this.tile(this.lastBuy.tile)?.name || '' } : null,
      left: live ? this.map.tiles.filter((t, i) => (
        (t.type === 'property' || t.type === 'airport' || t.type === 'utility') && !this.own(i)
      )).length : 0,
      pot: this.vacationPot ? moneyText(this.vacationPot) : 0,
      recent: this.botChat?.recent || [],
    };
  }

  /** Who would answer this, and with what — without anybody saying it yet. */
  planChatReply(speaker, text, channel = 'all', skip = new Set()) {
    if (!speaker || !text) return null;
    const scene = this.chatScene(speaker, text, channel, skip);
    if (!scene.bots.length) return null;
    return planReply(scene);
  }

  /**
   * Answer a human, if it is anybody's turn to.
   *
   * Replies are allowed at every table, unlike the ambient banter in botSay,
   * which only runs on quick matches. The reasoning there — that somebody who
   * deliberately added bots to their own game does not need them making small
   * talk at them — does not apply to a reply: they typed first, and being
   * ignored by four opponents is worse than being chatted at.
   */
  maybeBotReply(speaker, text, channel = 'all') {
    if (!this.players.some((b) => b.isBot && b.id !== speaker.id)) return null;
    this.botChat ??= { tableAt: 0, spokeAt: {}, window: [], recent: [] };
    const c = this.botChat;
    const now = Date.now();

    // The ceiling comes first: whatever else is true, a table gets at most
    // REPLY_WINDOW_MAX replies a minute. Somebody pasting a wall of messages
    // gets a conversation back, not a flood.
    c.window = c.window.filter((t) => now - t < REPLY_WINDOW);
    if (c.window.length >= REPLY_WINDOW_MAX) return null;
    if (now - c.tableAt < REPLY_GAP_TABLE) return null;

    // Up to three goes at finding somebody who is not still catching their
    // breath. Being named is the exception: if that bot is on cooldown nobody
    // answers for them, because being spoken to is personal.
    const skip = new Set();
    for (let tries = 0; tries < 3; tries++) {
      const plan = this.planChatReply(speaker, text, channel, skip);
      if (!plan) return null;
      const gap = plan.addressed ? REPLY_GAP_ADDRESSED : REPLY_GAP_BOT;
      if (now - (c.spokeAt[plan.botId] || 0) < gap) {
        if (plan.addressed) return null;
        skip.add(plan.botId);
        continue;
      }
      c.tableAt = now;
      c.spokeAt[plan.botId] = now;
      c.window.push(now);
      // The last dozen templates this table used are avoided where there is a
      // choice, so a long game does not circle the same four lines.
      c.recent.push(plan.template);
      if (c.recent.length > 12) c.recent.shift();

      // Typing takes a moment, and the pause is what sells it.
      //
      // Wrapped, because this runs from a bare setTimeout: everything inside
      // reads a table that has had a second and a half to change under it, and
      // an uncaught throw in a timer takes the process down — and every other
      // live table on the box with it. Nobody loses a game over small talk.
      const timer = setTimeout(() => {
        try {
          const bot = this.player(plan.botId);
          if (!bot) return;
          this.sendChat(bot.id, plan.line, channel, { auto: true });
          if (plan.offerTo) this.botTradeOnRequest(bot, this.player(plan.offerTo));
        } catch (err) {
          console.error('bot reply failed:', err);
        }
      }, REPLY_DELAY_MIN + Math.random() * (REPLY_DELAY_MAX - REPLY_DELAY_MIN));
      timer.unref?.();
      return plan;
    }
    return null;
  }

  /**
   * "Kiran, trade?" answered with the offer itself rather than a line about
   * one.
   *
   * Only ever fires when the person asking is holding the single street that
   * finishes a colour for this bot — which is exactly what the reply just said
   * out loud, so the offer and the sentence agree. A straight swap when they
   * are one short of a different colour the bot is sitting on, otherwise cash
   * well over the sticker price, because a colour is worth more than the
   * street that completes it.
   */
  botTradeOnRequest(bot, target) {
    if (this.status !== 'playing') return false;
    if (!bot || !target || bot.bankrupt || target.bankrupt) return false;
    if (this.trades.some((t) => t.from === bot.id && t.to === target.id)) return false;
    const mine = this.nearSets(bot.id);
    const want = mine.find((n) => n.holder === target.id && !(this.own(n.missing).houses > 0));
    if (!want) return false;

    // The street handed back has to come from a colour neither of us is
    // chasing — swapping inside the group we both want just passes the
    // problem back and forth.
    const theirs = this.nearSets(target.id).find((n) => (
      this.own(n.missing)?.owner === bot.id
      && n.group !== want.group
      && !mine.some((w) => w.group === n.group)
      && !(this.own(n.missing).houses > 0)
    ));
    const propose = (give, get) => {
      // Asked for, so the don't-pester clock in botMaybeTrade is spent here
      // rather than on an offer nobody invited.
      bot.lastAskedAt = this.turnCount;
      return !this.proposeTrade(bot.id, { to: target.id, give, get }).error;
    };
    const taking = { money: 0, tiles: [want.missing], cards: 0 };
    if (theirs) return propose({ money: 0, tiles: [theirs.missing], cards: 0 }, taking);

    const tile = this.tile(want.missing);
    const offer = Math.min(
      bot.money - Math.floor(this.botFloor(bot) / 2),
      Math.round(tile.price * 1.9 * this.botTemper(bot)),
    );
    if (offer < tile.price) return false;
    return propose({ money: offer, tiles: [], cards: 0 }, taking);
  }

  // -------------------------------------------------------------------- bots --
  scheduleBot(delay = 800) {
    clearTimeout(this.timers.bot);
    this.timers.bot = setTimeout(() => this.runBot(), delay);
  }

  /** Is there a human here to see any of this? */
  /**
   * Everybody real with the app still open — including the ones who are out.
   *
   * Being knocked out does not make you furniture. Somebody reading "you're out
   * of this game — watching how it ends" is at the table, is waiting, and is
   * the whole reason the game has to keep playing.
   */
  get present() {
    return this.players.filter((p) => !p.isBot && p.connected);
  }

  /**
   * Is there anybody to play this out for?
   *
   * This used to demand a player who was still IN the game, which read as
   * "nobody is here" the moment the last surviving player lost their
   * connection — even with two people sitting there watching. runBot and
   * maybeBot both stop dead on it, and an auto-played seat is never given a
   * shot clock (a bot cannot run out of time), so the table simply stopped:
   * clock on zero, nothing pending, nothing that would ever fire again.
   */
  get watched() {
    return this.present.length > 0;
  }

  maybeBot() {
    const p = this.current;
    if (!p) return;
    // With every human gone the game holds still. Playing on would burn a
    // timer a second for an empty room, and worse, it would bankrupt the
    // people who are trying to come back. Reconnecting starts it again.
    if (!this.watched) return;
    if (this.autoPlayed(p)) this.scheduleBot(900);
  }

  maybeBotAuction() {
    clearTimeout(this.timers.botAuction);
    this.timers.botAuction = setTimeout(() => this.runBotAuction(), 1100);
  }

  scheduleBotTrade(tradeId) {
    // A little theatre: the bot "opens" the offer, reads it for a moment
    // (the sender sees who's viewing), then answers.
    setTimeout(() => {
      const t = this.trades.find((x) => x.id === tradeId);
      if (t) this.setTradeViewing(t.to, tradeId, true);
    }, 800);
    setTimeout(() => this.botTradeReply(tradeId), 2600);
  }

  runBot() {
    if (this.status !== 'playing') return;
    // Scheduled while somebody was still here; they have since gone.
    if (!this.watched) return;
    const p = this.current;
    if (!this.autoPlayed(p)) return;
    const t = this.turn;

    if (t.phase === 'debt') {
      // Raise cash one piece at a time — the pause reads like a person doing
      // it. The stream forwards each piece and closes the debt on its own;
      // out of road means out of the game. In debt the shortfall IS the
      // negative balance, and saying so keeps a small bill from costing the
      // biggest deed on the board — this runs on human seats too, whenever
      // the house is minding one whose connection has gone.
      //
      // But the theatre has a budget. A bot that now trades and builds owns
      // more, so a big bill can need eight or ten pieces sold, and at half a
      // second each the table sits there not moving for five seconds — which
      // is exactly what "the game froze" looks like from a chair. So the
      // first two pieces keep their pause, and after that it sells faster and
      // several at a time: the debt is always settled inside about two
      // seconds, however much has to go.
      t.raising = (t.raising || 0) + 1;
      const pieces = Math.min(1 + Math.max(0, t.raising - 2), 4);
      let sold = 0;
      while (sold < pieces && p.money < 0 && this.autoLiquidate(p, Math.max(0, -p.money))) sold++;
      if (sold > 0) {
        this.push();
        return this.scheduleBot(t.raising <= 2 ? 500 : 200);
      }
      return this.declareBankrupt(p.id);
    }

    if (t.phase === 'action' && t.pending?.type === 'buy') {
      const tile = this.tile(t.pending.tile);
      // The survival floor collapses only for the buys that decide a colour
      // race today — comfort money means nothing if a rival walks away with
      // a full set because the bot kept a cushion.
      const urgent = this.botUrgent(p, t.pending.tile);
      const wants = this.botWantsTile(p, t.pending.tile);
      if (wants && p.money - tile.price >= this.botFloor(p, { denial: urgent })) return this.buy(p.id);
      return this.skipBuy(p.id);
    }

    if (t.phase === 'roll') {
      if (p.jail) {
        // Leave quickly while there is still land to claim; once the board
        // is bought up and built, the cell is the cheapest room in town.
        const eager = this.map.tiles.some((x) => (
          (x.type === 'property' || x.type === 'airport') && !this.own(x.index)
        )) || this.botFloor(p) < 180;
        if (eager && p.getOutCards > 0) { this.jailCard(p.id); return this.scheduleBot(600); }
        // Bots no longer buy their way out. Since the fine stopped carrying a
        // move with it, paying spends the whole turn standing in the doorway,
        // while rolling for a double costs nothing, can leave *and* move, and
        // loses to the third failed attempt paying the fine and walking out
        // regardless. The dice are the better bet every time, and the cash
        // stays in hand for streets.
      }
      return this.roll(p.id);
    }

    if (t.phase === 'end') {
      this.botUnmortgage(p);
      this.botBuild(p);
      this.botMaybeTrade(p);
      return this.endTurn(p.id);
    }
  }

  /**
   * A bot types something. Kept deliberately thin: one line at a time across
   * the whole table, a long cooldown per bot, and most optional lines dropped
   * on the floor — a bot that comments on everything reads as a machine.
   */
  botSay(p, kind, vars = {}, { delay = 1400, always = false } = {}) {
    // Same rule as the replies: only a house player talks, never a covered
    // human seat speaking in its owner's name.
    if (!p?.isBot) return;
    // Only the house players on a quick table talk. When someone deliberately
    // adds bots to their own game they know exactly what they're playing
    // against, and a bot making small talk at them is just noise.
    if (!this.quick) return;
    this.chatter ??= { table: 0, per: {} };
    const now = Date.now();
    if (!always) {
      // Enough of a filter that nobody comments on everything, loose enough
      // that a table actually sounds inhabited.
      if (Math.random() < 0.22) return;
      if (now - this.chatter.table < 3500) return;
      if (now - (this.chatter.per[p.id] || 0) < 12000) return;
    }
    const line = banter(kind, vars);
    if (!line) return;
    this.chatter.table = now;
    this.chatter.per[p.id] = now;
    // Typing takes a moment, and the pause is what sells it.
    const timer = setTimeout(() => {
      if (this.player(p.id)) this.sendChat(p.id, line, 'all', { auto: true });
    }, delay + Math.random() * 900);
    timer.unref?.();
  }

  /**
   * Who is in front, and who just lost that spot. A table where nobody ever
   * reacts to the scoreboard reads as four people playing alone in the same
   * room, so the new leader gets to enjoy it and someone gets to needle the
   * old one.
   */
  noteLeader() {
    const alive = this.active;
    if (alive.length < 2) return;
    const ranked = [...alive].sort((a, b) => this.netWorth(b) - this.netWorth(a));
    const leader = ranked[0];
    // A nose ahead isn't a lead worth crowing about.
    if (this.netWorth(leader) < this.netWorth(ranked[1]) * 1.15) return;
    const previous = this.leaderId;
    if (leader.id === previous) {
      // Still in front — occasionally let them enjoy it out loud.
      if (Math.random() < 0.22) this.botSay(leader, 'boast', {}, { delay: 2200 });
      return;
    }
    this.leaderId = leader.id;
    if (!previous) return;              // first leader of the game isn't news
    const dethroned = this.player(previous);
    this.botSay(leader, 'overtake', {}, { delay: 1800 });
    if (dethroned && !dethroned.bankrupt) {
      const heckler = alive.find((x) => x.id !== leader.id && x.id !== previous && this.autoPlayed(x));
      this.botSay(heckler, 'tease', { name: dethroned.name }, { delay: 3400 });
      this.botSay(dethroned, 'unlucky', {}, { delay: 4200 });
    }
  }

  /** Every so often, someone says something that isn't about the board. */
  maybeSmallTalk() {
    if (this.turnCount < 4 || Math.random() > 0.18) return;
    const bots = this.active.filter((x) => this.autoPlayed(x));
    if (!bots.length) return;
    this.botSay(bots[Math.floor(Math.random() * bots.length)], 'smallTalk', {}, { delay: 2600 });
  }

  /** Groups where this player holds everything but one street. */
  nearSets(playerId) {
    const out = [];
    for (const [group, idxs] of Object.entries(this.map.groups)) {
      const mine = idxs.filter((i) => this.own(i)?.owner === playerId);
      if (mine.length !== idxs.length - 1) continue;
      const missing = idxs.find((i) => this.own(i)?.owner && this.own(i).owner !== playerId);
      if (missing !== undefined) out.push({ group, missing, holder: this.own(missing).owner });
    }
    return out;
  }

  /**
   * WHAT A BOT IS ALLOWED TO KNOW — the rule the whole brain below obeys.
   *
   * Every decision from here down reads only what the server already sends
   * every client on every push: who owns which tile, how many houses sit on
   * it, whether it is mortgaged, each player's cash, prison cards and net
   * worth, whose turn it is, the settings, and the open trades. Nothing in the
   * brain touches this.decks — the card order nobody has seen — or another
   * player's private working memory, the list of who turned them down and
   * whose door they have already knocked on. A bot is meant to play well by
   * reading the board harder than you do, not by reading your hand, and a bot
   * that cheated would be found out the first time somebody watched a replay.
   * test/smart-bots.mjs booby-traps both and runs a whole turn of thinking
   * over the trap, rather than leaving this paragraph to be believed.
   *
   * The one place that could quietly break the rule is the trade search, which
   * has to guess what the OTHER side will say. It does that by running the
   * same judge from their chair, over the same public board, against the
   * hardest bargainer on the dial — see botJudgeTrade's `blind`.
   */
  botBlindTemper() { return 1.15; }

  /**
   * Every one- and two-piece packet from a shortlist. Two is the ceiling on
   * purpose: a three-street package is a negotiation, and a bot that cannot
   * negotiate has no business sending one.
   */
  botPackets(list) {
    const out = [];
    for (let a = 0; a < list.length; a++) {
      out.push([list[a]]);
      for (let b = a + 1; b < list.length; b++) out.push([list[a], list[b]]);
    }
    return out;
  }

  /**
   * Who owns what, if this deal goes through.
   *
   * Every judgement below is made on the board AFTER the trade rather than on
   * the deeds in the envelope, because a package is worth more or less than
   * the sum of its parts: two streets that finish a colour are a monopoly, the
   * same two streets split across two colours are just two streets. This is
   * one small object and a lookup, so it is cheap enough to run on every
   * package the search weighs.
   */
  botBoardAfter(toMe, toThem, meId, otherId) {
    const moved = {};
    for (const i of toMe) moved[i] = meId;
    for (const i of toThem) moved[i] = otherId;
    return (i) => (i in moved ? moved[i] : this.own(i)?.owner ?? null);
  }

  /**
   * What a finished colour is worth beyond the deeds inside it.
   *
   * Without this a bot prices a monopoly as a multiple of the sticker price of
   * the single street that finishes it, which says a cheap brown pair is worth
   * less than one expensive stray — so the cheap sets, the ones that actually
   * decide games, never moved. A colour is wanted for what it can charge, so
   * it is priced off what it charges once it is built to the knee.
   */
  botSetPremium(group) {
    // Rents never move, so this is a property of the board rather than of the
    // moment — worked out once and then read, because the trade search asks
    // for it a few hundred times a turn.
    if (this.setPremiums?.uid !== this.map.uid) this.setPremiums = { uid: this.map.uid };
    if (group in this.setPremiums) return this.setPremiums[group];
    const idxs = this.map.groups[group] || [];
    let rent = 0;
    for (const i of idxs) {
      const t = this.tile(i);
      if (t?.rent) rent += t.rent[Math.min(3, t.rent.length - 1)] || 0;
    }
    this.setPremiums[group] = Math.floor(rent * 0.9);
    return this.setPremiums[group];
  }

  /** The colours a seat gains (+) or breaks up (-) if this deal goes through. */
  botSetSwing(playerId, before, after) {
    let swing = 0;
    for (const [group, idxs] of Object.entries(this.map.groups)) {
      if (!idxs.length) continue;
      const had = idxs.every((i) => before(i) === playerId);
      const has = idxs.every((i) => after(i) === playerId);
      if (had === has) continue;
      swing += (has ? 1 : -1) * this.botSetPremium(group);
    }
    return swing;
  }

  /** What one side of an offer is worth, in cash, to the seat weighing it. */
  botPackageValue(p, side, temper) {
    let v = (side.money || 0) + (side.cards || 0) * 40;
    for (const i of side.tiles || []) {
      // The floor under a deed is what anybody would give for it — and a deed
      // in hock is worth that much LESS what it costs to get it out, or the
      // floor would hand back exactly the discount botValueOf just applied.
      const floor = Math.floor(this.tile(i).price * 0.9) - this.botLiftCost(i);
      v += Math.max(this.botValueOf(p, i, temper), floor);
    }
    return v;
  }

  /**
   * The one opinion in the file: would this seat sign this deal?
   *
   * A bot runs it on the offers it receives, and — from the other player's
   * chair, over the same public board — on every offer it is thinking of
   * sending, so it only ever knocks with a package the other side has an
   * actual reason to take. One judge doing both jobs is the whole point: a bot
   * cannot talk itself into sending an offer it would refuse itself.
   *
   * `incoming` is what `me` receives, `outgoing` what `me` hands over. `blind`
   * is set when the judge is run from somebody else's chair: a bot can read
   * your deeds and your cash off the board but not your temperament, so it
   * prices you as the hardest bargainer on the dial. Guessing you are soft
   * would only produce envelopes that come straight back.
   */
  botJudgeTrade(me, other, incoming, outgoing, { blind = false } = {}) {
    const temper = blind ? this.botBlindTemper() : this.botTemper(me);
    const before = this.botBoardAfter([], [], me.id, other.id);
    const after = this.botBoardAfter(incoming.tiles || [], outgoing.tiles || [], me.id, other.id);
    const mySwing = this.botSetSwing(me.id, before, after);
    const theirSwing = this.botSetSwing(other.id, before, after);
    const family = this.sameTeam(me, other);

    // A colour gained rides with what comes in, a colour broken up with what
    // goes out — so one premium reads the right way round whichever direction
    // the deeds are travelling.
    const value = this.botPackageValue(me, incoming, temper) + Math.max(0, mySwing) * temper;
    const cost = this.botPackageValue(me, outgoing, temper) + Math.max(0, -mySwing) * temper;

    // What a street is worth depends entirely on what it finishes. Taking the
    // deal that completes my colour is worth overpaying for; handing over the
    // one that completes someone else's is worth being difficult about. The
    // plain margin thins as a set-less table ages — on a board where nothing
    // has moved in eighty turns, a thin deal beats another eighty turns.
    const stale = this.botStaleness();
    let bar = 1.15 - 0.15 * stale;
    if (mySwing > 0) bar = 0.7;
    if (theirSwing > 0 && !family) {
      // Arming a rival costs dearly — the ransom sits on top of a valuation
      // that already carries the denial premium. It only eases as a set-less
      // table ages: a bot playing to win will eventually sell the deadlock
      // for a fortune rather than hold four players in a permanent draw.
      bar = Math.max(bar, 2.0 - 0.8 * stale);
    }
    if (mySwing > 0 && theirSwing > 0) bar = 1.0; // an even swap suits us both
    if (family) bar = Math.min(bar, 0.75);        // one purse, two chairs
    // Breaking up a colour I already own is not a trade, it is a surrender.
    if (mySwing < 0) bar = Math.max(bar, 2.6);

    // Never sign into rent-death: whatever the sticker maths says, the deal
    // has to leave enough cash to survive the board as it stands. A colour is
    // worth going hungry for, but not worth arriving at broke — an unbuilt
    // monopoly with no money behind it is three rent cards.
    const float = this.botFloor(me, { temper });
    const floorAfter = Math.floor(float / (mySwing > 0 ? 4 : 2));
    const affordable = me.money - (outgoing.money || 0) >= floorAfter;
    return {
      accept: value >= cost * bar && affordable,
      value, cost, bar, mySwing, theirSwing, gain: value - cost * bar,
    };
  }

  /**
   * The best deal this bot can see right now, or nothing.
   *
   * Shaped like the way a person shops a table: take the pieces a rival holds
   * that are worth more to me than to them, offer back the pieces of mine that
   * are worth more to them than to me, and close whatever gap is left with the
   * smallest amount of cash that turns their answer. Every candidate then goes
   * in front of BOTH judges — mine, and the same judge run from their chair —
   * and only a package both would sign is worth an envelope.
   *
   * The search is bounded by BOT_TRADE_PACKAGES rather than by the size of the
   * board, and the rivals are walked from a rotating start so that the same
   * player is never the only one considered when the budget runs out.
   */
  botBestOffer(p) {
    p.askedAt ??= {};
    const stale = this.botStaleness();
    const houseless = (i) => !this.tradeBlocked(i);
    const blindTemper = this.botBlindTemper();
    const rivals = this.active.filter((q) => q.id !== p.id
      && this.turnCount - (p.askedAt[q.id] ?? -99) >= BOT_ASK_COOLDOWN);
    if (!rivals.length) return null;

    let budget = BOT_TRADE_PACKAGES;
    let best = null;
    const offset = this.turnCount % rivals.length;
    for (let n = 0; n < rivals.length && budget > 0; n++) {
      const q = rivals[(offset + n) % rivals.length];
      // Both shortlists are read the same way: worth more over there than here.
      // A refused door stays shut — until the desperate hour buys one more knock.
      const theirs = this.tilesOf(q.id)
        .filter((i) => houseless(i) && (!p.refused?.includes(i) || stale >= 0.75))
        .sort((a, b) => (this.botValueOf(p, b) - this.botValueOf(q, b, blindTemper))
          - (this.botValueOf(p, a) - this.botValueOf(q, a, blindTemper)))
        .slice(0, 3);
      if (!theirs.length) continue;
      const mine = this.tilesOf(p.id).filter(houseless)
        .sort((a, b) => (this.botValueOf(q, b, blindTemper) - this.botValueOf(p, b))
          - (this.botValueOf(q, a, blindTemper) - this.botValueOf(p, a)))
        .slice(0, 2);

      const blind = { blind: true };
      for (const take of this.botPackets(theirs)) {
        if (budget <= 0) break;
        for (const give of [[], ...this.botPackets(mine)]) {
          if (budget-- <= 0) break;
          // Their side first, because it prices the deal: the judge is linear
          // in money, so the cash they come up short by IS the asking price.
          const out = { money: 0, tiles: give, cards: 0 };
          const inc = { money: 0, tiles: take, cards: 0 };
          const dry = this.botJudgeTrade(q, p, out, inc, blind);
          const cash = Math.max(0, Math.ceil(dry.cost * dry.bar - dry.value));
          if (cash > p.money) continue;
          out.money = cash;
          // Paying is not the only bar they have to clear — a rival too poor
          // to survive the deal refuses it however much cash is on the table.
          if (!this.botJudgeTrade(q, p, out, inc, blind).accept) continue;
          const verdict = this.botJudgeTrade(p, q, inc, out);
          if (!verdict.accept) continue;
          // Ties go to the plainer offer: fewer deeds moving, less cash down.
          const pieces = take.length + give.length;
          const better = !best || verdict.gain > best.gain + 1
            || (verdict.gain > best.gain - 1 && pieces < best.pieces);
          if (better) best = { q, take, give, cash, gain: verdict.gain, pieces };
        }
      }
    }
    return best;
  }

  /**
   * One offer a turn at most, and never twice through the same door in a
   * hurry. Both waits earn their keep: without the per-target one, a bot with
   * a single obvious target asks that player every few turns for the rest of
   * the game, which is how a helpful bot becomes a pest.
   */
  botMaybeTrade(p) {
    if (this.trades.some((t) => t.from === p.id)) return;
    if (this.turnCount - (p.lastAskedAt ?? -99) < BOT_OFFER_GAP) return;
    const deal = this.botBestOffer(p);
    if (!deal) return;
    const { q, take, give, cash } = deal;
    p.lastAskedAt = this.turnCount;
    p.askedAt[q.id] = this.turnCount;
    const sent = this.proposeTrade(p.id, {
      to: q.id,
      give: { money: cash, tiles: give, cards: 0 },
      get: { money: 0, tiles: take, cards: 0 },
    });
    if (sent?.error) return;
    if (give.length) {
      this.botSay(p, 'swap', {
        name: q.name,
        mine: this.tile(take[0]).name,
        yours: this.tile(give[0]).name,
      }, { delay: 700 });
    } else {
      // Ahead-of-me players get the friendly pressure; everyone else gets asked.
      const leading = this.netWorth(q) > this.netWorth(p) * 1.2;
      this.botSay(p, leading ? 'nudge' : 'wantTile',
        { name: q.name, tile: this.tile(take[0]).name }, { delay: 900 });
    }
  }

  /**
   * A stable 0.85–1.15 aggression dial per bot, seeded from its id — the
   * whole table shouldn't bid, build and fold on identical numbers like
   * clones. It scales valuations, floors and offers alike, so every seat
   * plays the same doctrine at its own pitch.
   */
  botTemper(p) {
    let h = 0;
    for (const c of String(p.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return 0.85 + (h % 31) / 100;
  }

  /**
   * The colour race on one street, seen from this bot's chair: how many of
   * the group's OTHER pieces the bot already holds (a teammate's deed flies
   * the same flag), and the best rival's count. This is the threat model
   * every valuation reads from.
   */
  botGroupRace(p, index) {
    const group = this.map.groups[this.tile(index).group] || [];
    let mine = 0;
    const rivals = {};
    for (const i of group) {
      if (i === index) continue;
      const o = this.own(i);
      if (!o) continue;
      if (o.owner === p.id || this.sameTeam(p, this.player(o.owner))) mine++;
      else rivals[o.owner] = (rivals[o.owner] || 0) + 1;
    }
    return { k: group.length, mine, topRival: Math.max(0, ...Object.values(rivals)) };
  }

  /**
   * How stuck the table is, on a 0–1 ramp. Progress means a colour newly
   * completed or a chair emptied (see noteProgress) — a cheap set built on
   * turn 30 must not mark a thousand-turn blockade as a live board. Four
   * deniers can ring-deadlock each other into a permanent draw; a bot that
   * plays to WIN treats that certainty as worse than a priced risk, so its
   * premiums rise and its ransom bar eases as the deadlock ages, until the
   * board thaws in a wave of dear-bought completions and goes hot again.
   */
  botStaleness() {
    return Math.max(0, Math.min(1, (this.turnCount - (this.lastProgressAt || 0) - 60) / 80));
  }

  /**
   * The progress clock behind botStaleness: the count of completed colours
   * and of live chairs, checked once a turn. Either number moving — a set
   * finished or broken up, a bankruptcy, a walkout — restarts the clock.
   */
  noteProgress() {
    const sets = Object.keys(this.map.groups)
      .filter((g) => this.active.some((p) => this.ownsFullGroup(p.id, g))).length;
    const sig = `${sets}:${this.active.length}`;
    if (sig !== this.progressSig) {
      this.progressSig = sig;
      this.lastProgressAt = this.turnCount;
    }
  }

  /**
   * What it costs to make a deed earn again — nothing, unless it is in hock.
   *
   * A mortgaged street is not the same street. The bank has already paid half
   * its price out to whoever holds it, it collects no rent at all until that
   * is lifted, and lifting it costs ten per cent over the odds. Priced as if
   * it were clear, a pile of somebody else's debts reads to a bot as a pile of
   * bargains — which is how the trade search ended up going shopping for them.
   */
  botLiftCost(index) {
    return this.own(index)?.mortgaged ? Math.ceil((this.tile(index).price / 2) * 1.1) : 0;
  }

  /**
   * What a street is WORTH to this bot — not what the sticker says. The last
   * piece of anyone's colour is the whole game: finishing my own set tops the
   * list, denying a rival's imminent set is barely behind it ("400 for the
   * 220 street"), and every piece before those ripples down from there.
   * Airports and utilities are priced by how many siblings the bot holds.
   */
  botValueOf(p, index, temper = this.botTemper(p)) {
    const tile = this.tile(index);
    // Whatever it is worth standing there, it is worth that less the price of
    // getting it off the bank's books. Never below nothing: a deed in hock is
    // still a deed, and one that finishes a colour is still worth having.
    const lift = this.botLiftCost(index);
    if (tile.type !== 'property') {
      const same = this.tilesOf(p.id).filter((i) => this.tile(i).type === tile.type).length;
      return Math.max(0, Math.floor(tile.price * (0.9 + 0.25 * same) * temper) - lift);
    }
    const { k, mine, topRival } = this.botGroupRace(p, index);
    // How far along the colour each side already is, counted out of the pieces
    // that are not this one, and bent upward so a street is worth little until
    // it starts to matter and a great deal at the end. That bend is the shape
    // the old fixed ladder had on a three-street colour — one short is 2.2,
    // two short is 1.4 — and it now says something on the five- and six-street
    // colours some boards are built from, which the ladder could not: it knew
    // only "one short" and "two short", so on a six-street colour a bot holding
    // three of them saw no reason on earth to want a fourth. Those boards then
    // produced no monopoly, so no houses, so rent of twenty dollars, so no
    // loser — tables ran thousands of turns with everybody quietly getting
    // richer, which is not a game.
    const climb = (held) => (k > 1 ? (held / (k - 1)) ** 1.6 : 1);
    const mult = Math.max(1 + 1.2 * climb(mine), 1 + climb(topRival));
    return Math.max(0, Math.floor(tile.price * mult * temper) - lift);
  }

  /**
   * The cash a bot keeps back to survive the table as built TODAY: enough
   * for most of the worst rent it could walk into (a teammate's street
   * charges nothing, so it doesn't count). Denial spends almost everything —
   * comfort is worthless if a rival finishes their colour.
   */
  botFloor(p, { denial = false, temper = this.botTemper(p) } = {}) {
    if (denial) return Math.floor(40 * temper);
    let worst = 0;
    for (const [i, o] of Object.entries(this.ownership)) {
      if (o.owner === p.id || o.mortgaged) continue;
      if (this.sameTeam(p, this.player(o.owner))) continue;
      const t = this.tile(Number(i));
      if (t.type !== 'property' || !t.rent) continue;
      worst = Math.max(worst, t.rent[Math.min(o.houses || 0, t.rent.length - 1)]);
    }
    return Math.floor(Math.min(400, Math.max(120, worst * 0.75)) * temper);
  }

  /** True when this street decides a colour TODAY: the last piece of the
   *  bot's own set, or of a rival's. These are the buys that skip comfort. */
  botUrgent(p, index) {
    if (this.tile(index).type !== 'property') return false;
    const { k, mine, topRival } = this.botGroupRace(p, index);
    return mine === k - 1 || topRival === k - 1;
  }

  /** Whether the street moves any colour race — own progress, or any rival
   *  within two pieces of the set. The buys a winner never skips. */
  botSetRelevant(p, index) {
    if (this.tile(index).type !== 'property') return false;
    const { k, mine, topRival } = this.botGroupRace(p, index);
    return mine > 0 || (topRival >= 1 && topRival >= k - 2);
  }

  botWantsTile(p, index) {
    const tile = this.tile(index);
    if (tile.type !== 'property') return true;
    if (this.botSetRelevant(p, index)) return true;
    return p.money > tile.price * 2;
  }

  /**
   * What the next house on this street actually buys: the jump in rent it
   * pays for, per dollar it costs. Two streets that both want a house are
   * rarely worth the same — this is the number that says which.
   */
  botHouseYield(index) {
    const t = this.tile(index);
    const h = this.own(index)?.houses || 0;
    if (!t.rent || !t.houseCost || h >= 5) return 0;
    const next = t.rent[Math.min(h + 1, t.rent.length - 1)] || 0;
    const now = t.rent[Math.min(h, t.rent.length - 1)] || 0;
    return (next - now) / t.houseCost;
  }

  botBuild(p) {
    let guard = 0;
    while (guard++ < BOT_BUILD_STEPS) {
      const floor = this.botFloor(p);
      const candidates = this.tilesOf(p.id)
        .filter((i) => this.canBuild(p.id, i))
        // Getting a colour to three houses is the single best-paid thing on
        // the board — rent roughly quintuples at that step — so a bot digs
        // into its cushion to reach the knee and only builds out of spare
        // cash after that. Hoarding a survival float while sitting on a bare
        // monopoly is how a bot draws a game out for four hundred turns.
        .filter((i) => {
          const lean = (this.own(i).houses || 0) < 3 ? 0.35 : 1;
          return p.money - this.tile(i).houseCost >= Math.floor(floor * lean);
        })
        .sort((a, b) => {
          const ka = (this.own(a).houses || 0) < 3 ? 0 : 1;
          const kb = (this.own(b).houses || 0) < 3 ? 0 : 1;
          return ka - kb || this.botHouseYield(b) - this.botHouseYield(a)
            || this.tile(b).price - this.tile(a).price;
        });
      if (!candidates.length) break;
      if (this.build(p.id, candidates[0])?.error) break;
    }
  }

  /**
   * Buy mortgages back when flush — a full colour stays dead while any of
   * its streets is in hock, because canBuild refuses the whole group.
   */
  botUnmortgage(p) {
    let guard = 0;
    while (guard++ < BOT_UNMORTGAGE_STEPS) {
      const floor = this.botFloor(p);
      const pick = this.tilesOf(p.id)
        .filter((i) => this.own(i).mortgaged)
        .map((i) => {
          const t = this.tile(i);
          const inSet = t.type === 'property' && this.ownsFullGroup(p.id, t.group);
          return { i, cost: Math.ceil((t.price / 2) * 1.1), inSet };
        })
        // Set members come first and are worth dipping toward the floor for;
        // stragglers wait until the purse is fat.
        .filter((x) => p.money - x.cost >= (x.inSet ? Math.floor(floor / 2) : floor * 2))
        .sort((a, b) => (b.inSet - a.inSet) || (a.cost - b.cost))[0];
      if (!pick) break;
      if (this.unmortgage(p.id, pick.i)?.error) break;
    }
  }

  runBotAuction() {
    const a = this.auction;
    if (!a) return;
    const bots = a.inRace
      .map((id) => this.player(id))
      .filter((p) => this.autoPlayed(p) && p.id !== a.leader);
    if (!bots.length) return;
    const bot = bots[0];
    // Never bid a teammate up — their deed already serves the same flag.
    const leader = a.leader ? this.player(a.leader) : null;
    if (leader && this.sameTeam(bot, leader)) return void this.passBid(bot.id);
    // The ceiling is the fixed valuation; the purse is read fresh every
    // time — money can move mid-auction (a trade settling, say), and a bid
    // the engine would refuse is a pass, never a retry.
    const afford = bot.money - this.botFloor(bot, { denial: this.botUrgent(bot, a.tile) });
    const cap = Math.min(this.botAuctionCap(bot, a), afford);
    const next = a.bid === 0 ? 10 : a.bid + 10;
    if (next <= cap && !this.bid(bot.id, next)?.error) return;
    this.passBid(bot.id);
  }

  /**
   * The most this bot thinks the street is worth in THIS auction, decided
   * the first time it weighs in and never revisited: two sharks each bid to
   * a fixed ceiling and the war ends at the higher one, instead of both
   * re-arguing themselves upward forever. What it can actually AFFORD is
   * checked live by the caller — the engine already refuses bids from the
   * red, and the floor keeps a bot from bidding itself into rent-death for
   * anything short of a colour race.
   */
  botAuctionCap(bot, a) {
    this.auctionCaps ??= {};
    const key = `${a.tile}:${bot.id}`;
    if (key in this.auctionCaps) return this.auctionCaps[key];
    const tile = this.tile(a.tile);
    let worth;
    if (tile.type !== 'property' || this.botSetRelevant(bot, a.tile)) {
      // A street in anyone's colour race is priced off the threat model —
      // up to about double the sticker when it decides a set outright.
      worth = this.botValueOf(bot, a.tile);
    } else if (bot.money > tile.price * 2) {
      // An ordinary street is only ever a bargain: never chase it to list.
      worth = Math.min(tile.price - 5, Math.floor(tile.price * 0.9 * this.botTemper(bot)));
    } else {
      worth = Math.floor(tile.price * 0.55);
    }
    this.auctionCaps[key] = worth;
    return worth;
  }

  /** gg from the table once the game is decided. */
  botFarewell(winners) {
    const won = new Set((winners || []).map((w) => w.id));
    for (const p of this.players) {
      this.botSay(p, won.has(p.id) ? 'win' : 'lost', {},
        { always: Math.random() < 0.5, delay: 1200 });
    }
  }

  botTradeReply(tradeId) {
    const trade = this.trades.find((t) => t.id === tradeId);
    if (!trade) return;
    const bot = this.player(trade.to);
    const other = this.player(trade.from);
    if (!bot) return;
    // Whoever sent this has left the table. Answering still clears the offer
    // out of everybody's list — leaving it there would be an envelope nobody
    // can ever open.
    if (!other) return void this.respondTrade(bot.id, tradeId, false);
    // The same judge that builds this bot's own offers, pointed the other way:
    // `give` is what the sender parts with, so from this chair it is what
    // arrives. Nothing here is decided that the sender could not have worked
    // out from the board — which is why a bot can be asked to explain itself.
    const verdict = this.botJudgeTrade(bot, other, trade.give, trade.get);
    this.botSay(bot, verdict.accept ? 'accept' : 'decline', { name: other.name || '' },
      { always: true, delay: 500 });
    this.respondTrade(bot.id, tradeId, verdict.accept);
  }

  // ------------------------------------------------------------------- state --
  serialize() {
    return {
      id: this.id,
      status: this.status,
      hostId: this.hostId,
      settings: this.settings,
      mapId: this.map.id,
      map: {
        id: this.map.id,
        uid: this.map.uid,
        name: this.map.name,
        icon: this.map.icon,
        tiles: this.map.tiles,
        layout: this.map.layout,
        size: this.map.size,
        groups: this.map.groups, // group key -> tile indices, needed to spot full sets
      },
      groups: GROUPS,
      teamInfo: TEAMS,
      winningTeam: this.winningTeam ?? null,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, color: p.color, money: p.money, pos: p.pos,
        jail: p.jail, jailTurns: p.jailTurns, getOutCards: p.getOutCards,
        flag: p.flag, team: p.team,
        tokenSkin: p.tokenSkin || '', avatar: p.avatar || '',
        bankrupt: p.bankrupt,
        // Quick-match tables are seeded with house players so nobody waits
        // around; the lobby doesn't label who is who.
        isBot: this.quick ? false : p.isBot,
        connected: p.connected,
        botControlled: this.quick ? false : !!p.botControlled,
        timedOut: !!p.timedOut, removedFor: p.removedFor || null,
        blockedLaps: p.blockedLaps || 0,
        skipTurns: p.skipTurns, netWorth: this.netWorth(p),
      })),
      ownership: this.ownership,
      turn: this.turn,
      auction: this.auction,
      trades: this.trades,
      quick: !!this.quick,
      // Set from outside by whoever made this table for a cup match. The room
      // itself does not know what a cup is; it only carries the label so the
      // client can stop offering things a cup table does not allow.
      cup: !!this.cupMatch,
      reliefCard: this.reliefCard || null,
      awaiting: Object.entries(this.awaiting || {}).map(([id, a]) => ({
        id, until: a.until, grants: a.grants,
        granted: a.granted, needAll: a.grants >= GameRoom.FREE_GRANTS,
        voters: this.votersFor(id).length,
      })),
      quickStartAt: this.quickStartAt || null,
      // What a matchmade table dealt itself, for the lobby to show before the
      // dice start. The phrasing is rebuilt from the live settings on every
      // push rather than stored with the roll: if anything moved the board
      // afterwards — a rollover at midnight sending it back to Classic — this
      // says what is actually going to be played, not what was once promised.
      quickRoll: this.quickRoll
        ? { at: this.quickRoll.at, keys: this.quickRoll.keys, parts: quickRollParts(this.settings, this.map.name) }
        : null,
      log: this.log.slice(-60),
      chat: this.chat.slice(-50),
      vacationPot: this.vacationPot,
      winner: this.winner ? { id: this.winner.id, name: this.winner.name, color: this.winner.color } : null,
      // The chart is an end-of-game reveal; streaming it every push would bloat
      // the state for nothing.
      history: this.status === 'ended' ? this.history : [],
      stats: this.status === 'ended' ? this.stats : null,
      titles: this.status === 'ended' ? this.titles : null,
      lastCard: this.lastCard,
      lastMove: this.lastMove,
      moves: this.actionMoves,
      version: this.version,
    };
  }

  /**
   * A player's id doubles as their secret identity token — it opens their
   * wallet, mail and purchases on the HTTP API — so nobody else's may ever
   * reach a client. Each id gets a stable, room-scoped stand-in shaped like
   * any ordinary guest id (the quick-bot ids wear the same cut for the same
   * reason); the hash keeps it identical across pushes and reconnects, and
   * the maps remember both directions for the life of the room.
   */
  aliasFor(id) {
    const known = this.aliases.get(id);
    if (known) return known;
    const digest = createHash('sha1').update(`${this.id}:${id}`).digest();
    let alias = `u_${BigInt(`0x${digest.subarray(0, 12).toString('hex')}`).toString(36)}`;
    // Two ids hashing together is astronomically unlikely, but an alias must
    // never point at two people — or shadow a real seat at this table.
    while ((this.tokensByAlias.has(alias) && this.tokensByAlias.get(alias) !== id)
      || this.players.some((p) => p.id === alias)) alias += '0';
    this.aliases.set(id, alias);
    this.tokensByAlias.set(alias, id);
    return alias;
  }

  /** Inbound ids may arrive as an alias or as the caller's own real token. */
  resolveId(id) {
    if (id == null) return id;
    return this.tokensByAlias.get(id) || id;
  }

  /**
   * The state as one viewer may see it. The seats their socket claims stay
   * real — plus the rest of that pass & play family: `token_pN` guests ride
   * separate sockets but share a screen, and the base token could mint every
   * guest token anyway. Bots keep their ids (clients sniff the `bot:` prefix,
   * and quick-table ids are already fakes), and every other id is swapped for
   * its alias in every field it appears in.
   */
  serializeFor(viewerIds, base = this.serialize()) {
    const claimed = viewerIds instanceof Set ? viewerIds : new Set(viewerIds || []);
    const bases = new Set([...claimed].map((id) => String(id).replace(/_p\d+$/, '')));
    const owned = new Set(claimed);
    for (const p of this.players) {
      if (bases.has(p.id.replace(/_p\d+$/, ''))) owned.add(p.id);
    }
    const mapId = (id) => {
      if (id == null || owned.has(id)) return id;
      if (this.player(id)?.isBot) return id;
      return this.aliasFor(id);
    };
    const mapKeys = (obj) => Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [mapId(k), v]),
    );
    return {
      ...base,
      hostId: mapId(base.hostId),
      players: base.players.map((p) => ({ ...p, id: mapId(p.id) })),
      ownership: Object.fromEntries(Object.entries(base.ownership)
        .map(([i, o]) => [i, { ...o, owner: mapId(o.owner) }])),
      turn: base.turn && {
        ...base.turn,
        playerId: mapId(base.turn.playerId),
        debt: base.turn.debt && {
          ...base.turn.debt,
          debtor: mapId(base.turn.debt.debtor),
          creditor: mapId(base.turn.debt.creditor),
          owedTo: base.turn.debt.owedTo?.map(mapId),
        },
      },
      auction: base.auction && {
        ...base.auction,
        leader: mapId(base.auction.leader),
        inRace: base.auction.inRace.map(mapId),
      },
      trades: base.trades.map((t) => ({
        ...t,
        from: mapId(t.from),
        to: mapId(t.to),
        viewers: t.viewers?.map(mapId),
      })),
      awaiting: base.awaiting.map((a) => ({
        ...a, id: mapId(a.id), granted: (a.granted || []).map(mapId),
      })),
      winner: base.winner && { ...base.winner, id: mapId(base.winner.id) },
      history: base.history.map((h) => ({ ...h, w: mapKeys(h.w) })),
      stats: base.stats && mapKeys(base.stats),
      titles: base.titles && mapKeys(base.titles),
      lastMove: base.lastMove && { ...base.lastMove, playerId: mapId(base.lastMove.playerId) },
      moves: base.moves.map((m) => ({ ...m, playerId: mapId(m.playerId) })),
    };
  }

  dispose() {
    Object.values(this.timers).forEach(clearTimeout);
  }
}
