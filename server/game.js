// Server-authoritative game engine.
// Every rule lives here; clients only send intents and render what comes back.

import { createHash } from 'node:crypto';
import { getMap, GROUPS } from './maps.js';
import { buildDecks, shuffled } from './cards.js';
import { banter, cleanText, isAllMasked } from './banter.js';
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
  x2rent: false,
  vacationCash: false,
  auction: true,
  noRentInPrison: false,
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

/** Laps a blocked player walks before the board hands them a way out. */
const RELIEF_LAPS = 4;
/** What that way out costs — well over the odds, because it is a forced sale. */
const RELIEF_MULTIPLIER = 1.7;

const AUCTION_SECONDS = 20;
const JAIL_FINE = 50;
const SALARY = 200;
/** Landing dead on START pays this instead of the passing salary. */
const START_BONUS = 300;
const MAX_JAIL_TURNS = 3;
/** How long a disconnected player keeps their seat before a bot steps in. */
const RECONNECT_GRACE_MS = 30000;

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
      if (!this.quickStartAt) this.armQuickStart(20);
      else this.planQuickFill();
    }
    this.push();
    return { player };
  }

  removePlayer(id) {
    const p = this.player(id);
    if (!p) return;
    if (this.status === 'lobby') {
      this.players = this.players.filter((x) => x.id !== id);
      if (this.hostId === id) this.hostId = this.players[0]?.id || null;
      this.say(`${p.name} left the room`, 'leave');
      if (this.quick) {
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

  reconnect(id) {
    const p = this.player(id);
    if (!p) return false;
    clearTimeout(this.timers[`grace:${id}`]);
    if (this.awaiting) delete this.awaiting[id];
    const wasBot = p.botControlled;
    p.connected = true;
    p.botControlled = false;
    this.say(wasBot ? `${p.name} is back and takes over from the bot` : `${p.name} reconnected`, 'join');
    this.push();
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
    const allowed = Object.keys(DEFAULT_SETTINGS);
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.includes(k)) continue;
      this.settings[k] = v;
    }
    this.settings.maxPlayers = Math.max(2, Math.min(8, Number(this.settings.maxPlayers) || 4));
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
    // Bots you invited yourself carry no disguise — short, friendly, familiar.
    const names = ['Ravi', 'Zoe', 'Kabir', 'Nina', 'Otto', 'Maya', 'Leo', 'Ira'];
    const used = new Set(this.players.map((p) => p.name));
    const name = names.find((n) => !used.has(n)) || `Bot${this.players.length}`;
    return this.addPlayer({ id: `bot:${name}:${Math.random().toString(36).slice(2, 7)}`, name, isBot: true });
  }

  // ------------------------------------------------------------------ start --
  start(id) {
    if (id !== this.hostId || this.status !== 'lobby') return { error: 'Not allowed' };
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
    });
    this.status = 'playing';
    this.ownership = {};
    this.vacationPot = 0;
    this.history = [];
    this.stats = {};
    this.titles = null;
    this.turnCount = 0;
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
    seat.until = Date.now() + ms;
    seat.granted = [];
    clearTimeout(this.timers[`grace:${p.id}`]);
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
  makeQuickMatch(seconds = 20) {
    this.quick = true;
    this.settings.isPrivate = false;
    this.settings.allowBots = true;
    this.settings.maxPlayers = 4;
    this.armQuickStart(seconds);
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
   * Seat the house players one at a time, the way a real lobby fills: each
   * arrival lands 1.5–7 seconds after the last, squeezed tighter when the
   * fuse is nearly burnt, and always ahead of kick-off. Called whenever the
   * picture changes — fuse armed, person in, person out — and reschedules
   * every pending arrival from scratch.
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
    // any seat still empty — the margin just keeps the joins visibly ahead.
    const window = Math.max(0, this.quickStartAt - Date.now() - 1200);
    let at = 0;
    for (let i = 0; i < seats; i++) {
      const cap = Math.min(7000, Math.max(1500, (window - at) / (seats - i)));
      at = Math.min(at + 1500 + Math.random() * Math.max(0, cap - 1500), window);
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
    const seconds = Math.max(0, Math.floor(Number(this.settings.turnSeconds) || 0));
    const p = this.player(this.turn.playerId);
    if (this.status !== 'playing' || !seconds || !p) {
      if (this.turn) this.turn.endsAt = null;
      return;
    }
    // A shot clock exists so nobody is left waiting on an empty chair. Playing
    // against bots you added yourself, there is nobody to keep waiting — and
    // being hurried by your own bots would just be rude.
    if (!this.quick && this.humans.length < 2) { this.turn.endsAt = null; return; }

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
    this.say(`${p.name} ran out of time and was removed`, 'leave');
    this.removeFromPlay(p, 'timeout');
  }

  /** Any deliberate move by the player on the clock buys them a fresh one. */
  touchTurnClock(id) {
    if (this.status !== 'playing' || this.turn?.playerId !== id) return;
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
      if (!this.autoLiquidate(p)) break;
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

  /** Sell one house, or mortgage one property. Returns true if cash was raised. */
  autoLiquidate(p) {
    const mine = this.tilesOf(p.id);
    const withHouses = mine.filter((i) => (this.own(i).houses || 0) > 0)
      .sort((a, b) => this.own(b).houses - this.own(a).houses);
    if (withHouses.length) return this.sellHouse(p.id, withHouses[0], true);
    const unmortgaged = mine.filter((i) => !this.own(i).mortgaged)
      .sort((a, b) => this.tile(a).price - this.tile(b).price);
    if (unmortgaged.length) return this.mortgage(p.id, unmortgaged[0], true);
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
    this.actionMoves.push({ playerId: p.id, from, to, steps, cause, at: Date.now() });
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
    this.lastCard = { deck: deckName, text: card.text, at: Date.now() };
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
    // A game that ended mid-countdown has nothing left to award.
    if (this.status !== 'playing') return { ok: true };
    const t = this.tile(a.tile);
    if (a.leader && !this.player(a.leader)?.bankrupt) {
      // The bid is already escrowed by bid(); just hand over the deed.
      const winner = this.player(a.leader);
      this.ownership[a.tile] = { owner: winner.id, houses: 0, mortgaged: false };
      this.statFor(winner).auctionsWon++;
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
    if (p.money < JAIL_FINE) return { error: 'Not enough money' };
    p.money -= JAIL_FINE;
    p.jail = false;
    p.jailTurns = 0;
    this.say(`${p.name} paid $${JAIL_FINE} and left prison`, 'jail');
    this.push();
    this.maybeBot();
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

  sellHouse(id, index, silent = false) {
    const p = this.player(id);
    const o = this.own(index);
    if (!p || !o || o.owner !== id || !(o.houses > 0)) return false;
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
    // A property with buildings cannot be traded.
    const blocked = [...offer.give.tiles, ...offer.get.tiles].some((i) => (this.own(i).houses || 0) > 0);
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
      || trade.give.tiles.some((i) => this.own(i)?.owner !== from.id || (this.own(i)?.houses || 0) > 0)
      || trade.get.tiles.some((i) => this.own(i)?.owner !== to.id || (this.own(i)?.houses || 0) > 0)
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
    this.log = [];
    this.reliefCard = null;
    this.reliefExplained = false;
    this.players.forEach((p) => {
      p.money = this.settings.startingCash;
      p.pos = 0; p.jail = false; p.jailTurns = 0; p.getOutCards = 0;
      p.bankrupt = false; p.skipTurns = 0;
      p.timedOut = false; p.removedFor = null; p.botControlled = false;
      p.blockedLaps = 0; p.refused = [];
    });
    this.say('Back to the lobby — set up the next game', 'system');
    this.push();
    return { ok: true };
  }

  // ------------------------------------------------------------------- chat --
  sendChat(id, text, channel) {
    const p = this.player(id);
    if (!p || !text) return;
    // The team channel only exists when teams do; anything else lands in 'all'.
    const ch = channel === 'team' && this.teamsOn && p.team != null ? 'team' : 'all';
    const msg = {
      id: Math.random().toString(36).slice(2), name: p.name, color: p.color, flag: p.flag || '',
      text: cleanText(String(text).slice(0, 200)), at: Date.now(),
      channel: ch, team: ch === 'team' ? p.team : null,
    };
    this.chat.push(msg);
    if (this.chat.length > 100) this.chat.shift();
    this.push();
  }

  // -------------------------------------------------------------------- bots --
  scheduleBot(delay = 800) {
    clearTimeout(this.timers.bot);
    this.timers.bot = setTimeout(() => this.runBot(), delay);
  }

  maybeBot() {
    const p = this.current;
    if (!p) return;
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
    const p = this.current;
    if (!this.autoPlayed(p)) return;
    const t = this.turn;

    if (t.phase === 'debt') {
      // Raise cash one piece at a time — the pause reads like a person doing
      // it. The stream forwards each piece and closes the debt on its own;
      // out of road means out of the game.
      if (this.autoLiquidate(p)) {
        this.push();
        return this.scheduleBot(500);
      }
      return this.declareBankrupt(p.id);
    }

    if (t.phase === 'action' && t.pending?.type === 'buy') {
      const tile = this.tile(t.pending.tile);
      const denial = this.botSetRelevant(p, t.pending.tile);
      const wants = this.botWantsTile(p, t.pending.tile);
      if (wants && p.money - tile.price >= this.botFloor(p, { denial })) return this.buy(p.id);
      return this.skipBuy(p.id);
    }

    if (t.phase === 'roll') {
      if (p.jail) {
        if (p.getOutCards > 0) { this.jailCard(p.id); return this.scheduleBot(600); }
        if (p.money > 350 && p.jailTurns >= 1) { this.jailPay(p.id); return this.scheduleBot(600); }
      }
      return this.roll(p.id);
    }

    if (t.phase === 'end') {
      this.botBuild(p);
      this.botMaybeTrade(p);
      return this.endTurn(p.id);
    }
  }

  /**
   * Once per turn a bot will try to buy the one street it still needs to
   * complete a set, paying well over the odds for it.
   */
  /**
   * A bot types something. Kept deliberately thin: one line at a time across
   * the whole table, a long cooldown per bot, and most optional lines dropped
   * on the floor — a bot that comments on everything reads as a machine.
   */
  botSay(p, kind, vars = {}, { delay = 1400, always = false } = {}) {
    if (!p || !this.autoPlayed(p)) return;
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
      if (this.player(p.id)) this.sendChat(p.id, line, 'all');
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

  botMaybeTrade(p) {
    if (this.trades.some((t) => t.from === p.id)) return;
    // Asking again the moment you were turned down is how two bots end up
    // pestering each other every turn for the rest of the game. Give it a
    // few turns, and never re-send an offer that was just refused.
    if (this.turnCount - (p.lastAskedAt ?? -99) < 6) return;
    const wants = this.nearSets(p.id);
    if (!wants.length) return;

    // Best case: they hold the street I need and I hold the street they need.
    // A straight swap costs neither of us cash and hands us both a colour, so
    // it's the offer most likely to actually be taken.
    for (const want of wants) {
      const holder = this.player(want.holder);
      if (!holder || holder.bankrupt) continue;
      // The street I hand over has to come from a different colour — and one
      // I'm not myself one short in. Swapping inside the group we're both
      // chasing just passes the same problem back and forth.
      const theirs = this.nearSets(holder.id).find((n) => (
        this.own(n.missing)?.owner === p.id
        && n.group !== want.group
        && !wants.some((w) => w.group === n.group)
      ));
      if (!theirs) continue;
      if ((this.own(want.missing).houses || 0) > 0 || (this.own(theirs.missing).houses || 0) > 0) continue;
      if (p.refused?.includes(want.missing)) continue;
      p.lastAskedAt = this.turnCount;
      this.proposeTrade(p.id, {
        to: holder.id,
        give: { money: 0, tiles: [theirs.missing], cards: 0 },
        get: { money: 0, tiles: [want.missing], cards: 0 },
      });
      this.botSay(p, 'swap', {
        name: holder.name,
        mine: this.tile(want.missing).name,
        yours: this.tile(theirs.missing).name,
      }, { delay: 700 });
      return;
    }

    // No set within one street of done? Consolidate: in a long game where
    // every colour is scattered one piece apiece, somebody has to start
    // collecting or the table circles forever. Offer cash over the odds for
    // a stray piece of the colour we lead — the step that unlocks the
    // endgame swaps above.
    if (!wants.length && this.turnCount > 30) {
      for (const [group, idxs] of Object.entries(this.map.groups)) {
        const mine = idxs.filter((i) => this.own(i)?.owner === p.id).length;
        if (!mine || mine >= idxs.length - 1) continue;
        const target = idxs.find((i) => {
          const o = this.own(i);
          return o && o.owner !== p.id && !(o.houses > 0)
            && !this.player(o.owner)?.bankrupt && !p.refused?.includes(i);
        });
        if (target === undefined) continue;
        const holder = this.player(this.own(target).owner);
        const price = Math.floor(this.tile(target).price * 1.5 * this.botTemper(p));
        if (p.money - price < this.botFloor(p)) continue;
        p.lastAskedAt = this.turnCount;
        this.proposeTrade(p.id, {
          to: holder.id,
          give: { money: price, tiles: [], cards: 0 },
          get: { money: 0, tiles: [target], cards: 0 },
        });
        this.botSay(p, 'nudge', { name: holder.name }, { delay: 700 });
        return;
      }
    }

    // Otherwise buy it, and pay over the odds — a colour is worth more than
    // the sticker price of the street that completes it.
    if (p.money < 600) return;
    for (const want of wants) {
      const holder = this.player(want.holder);
      if (!holder || holder.bankrupt) continue;
      if (this.ownsFullGroup(holder.id, want.group)) continue;
      if ((this.own(want.missing).houses || 0) > 0) continue;
      const tile = this.tile(want.missing);
      const offer = Math.min(p.money - 300, Math.round(tile.price * 1.9));
      if (offer < tile.price) continue;
      if (p.refused?.includes(want.missing)) continue;
      p.lastAskedAt = this.turnCount;
      this.proposeTrade(p.id, {
        to: holder.id,
        give: { money: offer, tiles: [], cards: 0 },
        get: { money: 0, tiles: [want.missing], cards: 0 },
      });
      // Ahead-of-me players get the friendly pressure; everyone else gets asked.
      const leading = this.netWorth(holder) > this.netWorth(p) * 1.2;
      this.botSay(p, leading ? 'nudge' : 'wantTile',
        { name: holder.name, tile: tile.name }, { delay: 900 });
      return;
    }
  }

  /**
   * A stable 0.9–1.1 temperament per bot, seeded from its id — the whole
   * table shouldn't bid, build and fold on identical numbers like clones.
   */
  botTemper(p) {
    let h = 0;
    for (const c of String(p.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return 0.9 + (h % 21) / 100;
  }

  /**
   * What a street is WORTH to this bot — not what the sticker says. The last
   * piece of anyone's colour is the whole game: finishing my own set tops the
   * list, denying a rival's imminent set is barely behind it, and the
   * second-to-last pieces ripple down from there.
   */
  botValueOf(p, index) {
    const tile = this.tile(index);
    if (tile.type !== 'property') return Math.floor(tile.price * 1.1);
    const group = this.map.groups[tile.group] || [];
    const k = group.length;
    let mine = 0;
    const rival = {};
    for (const i of group) {
      if (i === index) continue;
      const o = this.own(i);
      if (!o) continue;
      if (o.owner === p.id) mine++;
      else rival[o.owner] = (rival[o.owner] || 0) + 1;
    }
    const topRival = Math.max(0, ...Object.values(rival), 0);
    let mult = 1;
    if (mine === k - 1) mult = 2.2;             // finishes my set
    else if (topRival === k - 1) mult = 2.0;    // denies an imminent set
    else if (mine === k - 2 && k >= 3) mult = 1.4;
    else if (topRival === k - 2 && k >= 3) mult = 1.25;
    return Math.floor(tile.price * mult * this.botTemper(p));
  }

  /**
   * The cash a bot keeps back to survive the table as built TODAY: enough
   * for most of the worst rent it could walk into. Denial spends almost
   * everything — comfort is worthless if a rival finishes their colour.
   */
  botFloor(p, { denial = false } = {}) {
    if (denial) return Math.floor(40 * this.botTemper(p));
    let worst = 0;
    for (const [i, o] of Object.entries(this.ownership)) {
      if (o.owner === p.id || o.mortgaged) continue;
      const t = this.tile(Number(i));
      if (t.type !== 'property' || !t.rent) continue;
      worst = Math.max(worst, t.rent[Math.min(o.houses || 0, t.rent.length - 1)]);
    }
    return Math.floor(Math.min(400, Math.max(120, worst * 0.75)) * this.botTemper(p));
  }

  /** Whether the street moves any set race — the buys a winner never skips. */
  botSetRelevant(p, index) {
    return this.tile(index).type === 'property' && this.botValueOf(p, index) > this.tile(index).price * 1.2;
  }

  botWantsTile(p, index) {
    const tile = this.tile(index);
    if (tile.type !== 'property') return true;
    if (this.botSetRelevant(p, index)) return true;
    const group = this.map.groups[tile.group] || [];
    const mine = group.filter((i) => this.own(i)?.owner === p.id).length;
    return mine > 0 || p.money > tile.price * 2;
  }

  botBuild(p) {
    let guard = 0;
    while (guard++ < 24) {
      const floor = this.botFloor(p);
      const candidates = this.tilesOf(p.id)
        .filter((i) => this.canBuild(p.id, i) && p.money - this.tile(i).houseCost >= floor)
        .sort((a, b) => {
          // Three houses is where rent bends — carpet every set to the knee
          // before anyone gets a hotel, dearest streets first within a tier.
          const ka = (this.own(a).houses || 0) < 3 ? 0 : 1;
          const kb = (this.own(b).houses || 0) < 3 ? 0 : 1;
          return ka - kb || this.tile(b).price - this.tile(a).price;
        });
      if (!candidates.length) break;
      this.build(p.id, candidates[0]);
    }
  }

  runBotAuction() {
    const a = this.auction;
    if (!a) return;
    const bots = a.inRace
      .map((id) => this.player(id))
      .filter((p) => this.autoPlayed(p) && p.id !== a.leader);
    if (!bots.length) return;
    const tile = this.tile(a.tile);
    for (const bot of bots) {
      // Each bot bids to ITS valuation of the street and not a dollar past —
      // static ceilings are what make two sharks stop short of the moon.
      const denial = this.botSetRelevant(bot, a.tile);
      const worth = denial ? this.botValueOf(bot, a.tile)
        : Math.floor(tile.price * (this.botWantsTile(bot, a.tile) ? 1.05 : 0.6));
      const cap = Math.min(bot.money - this.botFloor(bot, { denial }), worth);
      const next = a.bid === 0 ? 10 : a.bid + 10;
      if (next <= cap) return this.bid(bot.id, next);
      this.passBid(bot.id);
      return;
    }
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
    if (!bot) return;
    const valueOf = (side, forPlayer) => {
      let v = side.money + side.cards * 40;
      for (const i of side.tiles) {
        v += Math.max(this.botValueOf(forPlayer, i), Math.floor(this.tile(i).price * 0.9));
      }
      return v;
    };
    const incoming = valueOf(trade.give, bot);
    const outgoing = valueOf(trade.get, bot);

    // What a street is worth depends entirely on what it finishes. Taking the
    // deal that completes my colour is worth overpaying for; handing over the
    // one that completes someone else's is worth being difficult about.
    const completesForMe = this.nearSets(bot.id)
      .some((n) => trade.give.tiles.includes(n.missing));
    const completesForThem = this.nearSets(trade.from)
      .some((n) => trade.get.tiles.includes(n.missing));

    let bar = 1.15;
    if (completesForMe) bar = 0.7;        // happily pay a premium for the set
    if (completesForThem) bar = Math.max(bar, 2.0); // arming a rival costs dearly
    if (completesForMe && completesForThem) bar = 1.0; // an even swap suits us both

    const accept = incoming >= outgoing * bar && bot.money >= trade.get.money;
    const other = this.player(trade.from);
    this.botSay(bot, accept ? 'accept' : 'decline', { name: other?.name || '' },
      { always: true, delay: 500 });
    this.respondTrade(bot.id, tradeId, accept);
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
      reliefCard: this.reliefCard || null,
      awaiting: Object.entries(this.awaiting || {}).map(([id, a]) => ({
        id, until: a.until, grants: a.grants,
        granted: a.granted, needAll: a.grants >= GameRoom.FREE_GRANTS,
        voters: this.votersFor(id).length,
      })),
      quickStartAt: this.quickStartAt || null,
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
