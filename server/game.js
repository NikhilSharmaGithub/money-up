// Server-authoritative game engine.
// Every rule lives here; clients only send intents and render what comes back.

import { getMap, GROUPS } from './maps.js';
import { TREASURE, SURPRISE, shuffled } from './cards.js';
import { banter, cleanText, isAllMasked } from './banter.js';

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
};

const AUCTION_SECONDS = 20;
const JAIL_FINE = 50;
const SALARY = 200;
/** Landing dead on START pays this instead of the passing salary. */
const START_BONUS = 300;
const MAX_JAIL_TURNS = 3;
/** How long a disconnected player keeps their seat before a bot steps in. */
const RECONNECT_GRACE_MS = 30000;

let tradeSeq = 1;

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
    this.turnCount = 0;
    this.lastCard = null;
    this.lastMove = null;
    this.timers = {};
    /** Set by the server so the room can report karma-worthy exits. */
    this.hooks = {};
    this.createdAt = Date.now();
    this.version = 0;
  }

  // ---------------------------------------------------------------- logging --
  say(text, kind = 'info') {
    this.log.push({ text, kind, at: Date.now() });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  push() {
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

  addPlayer({ id, name, isBot = false, flag = '' }) {
    if (this.players.length >= this.settings.maxPlayers) return { error: 'Room is full' };
    if (this.status !== 'lobby') return { error: 'Game already started' };
    const clean = cleanText((name || 'Player').slice(0, 16));
    const player = {
      id,
      name: isAllMasked(clean) ? 'Player' : clean,
      color: this.freeColor(),
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
    } else {
      // Keep the seat warm: a refresh or a flaky network shouldn't instantly
      // hand your turn to a bot. Only after the grace period does one step in.
      p.connected = false;
      // A gone player can't be "viewing" any offer.
      for (const t of this.trades) {
        if (t.viewers?.includes(id)) t.viewers = t.viewers.filter((v) => v !== id);
      }
      this.say(`${p.name} lost connection — holding their seat`, 'leave');
      clearTimeout(this.timers[`grace:${id}`]);
      this.timers[`grace:${id}`] = setTimeout(() => {
        const still = this.player(id);
        if (!still || still.connected || still.bankrupt) return;
        still.botControlled = true;
        this.say(`${still.name} didn't come back — a bot is taking over`, 'leave');
        this.push();
        if (this.turn?.playerId === id) this.scheduleBot(600);
      }, RECONNECT_GRACE_MS);
    }
    this.push();
  }

  reconnect(id) {
    const p = this.player(id);
    if (!p) return false;
    clearTimeout(this.timers[`grace:${id}`]);
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
    this.push();
  }

  /** The fuse burnt down (or the table filled) — deal everyone in. */
  startQuickMatch() {
    clearTimeout(this.timers.quick);
    this.quickStartAt = null;
    if (this.status !== 'lobby' || !this.players.length) return;
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
    if (this.status !== 'playing' || !seconds || !p || this.autoPlayed(p)) {
      if (this.turn) this.turn.endsAt = null;
      return;
    }
    const id = p.id;
    this.turn.endsAt = Date.now() + seconds * 1000;
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
    if (this.status !== 'playing') return this.leave(id) ?? { ok: true };
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
    p.bankrupt = true;      // the turn loop already skips these
    p.timedOut = true;      // …but the client shows a different story
    p.removedFor = reason;
    for (const i of this.tilesOf(p.id)) delete this.ownership[i];
    p.money = 0;
    if (this.turn?.debt?.debtor === p.id) this.turn.debt = null;
    this.trades = this.trades.filter((t) => t.from !== p.id && t.to !== p.id);
    if (this.auction) {
      this.auction.inRace = this.auction.inRace.filter((x) => x !== p.id);
      if (this.auction.leader === p.id) this.auction.leader = null;
    }
    this.hooks.karma?.(p.id, -1, reason);
    if (this.checkGameEnd()) return;
    if (this.turn?.playerId === p.id) this.nextTurn();
    else this.push();
  }

  // ------------------------------------------------------------ turn helpers --
  get current() {
    return this.turn ? this.player(this.turn.playerId) : null;
  }

  isCurrent(id) {
    return this.status === 'playing' && this.turn?.playerId === id;
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

  // ------------------------------------------------------------------- money --
  credit(p, amount, reason = '') {
    p.money += amount;
    if (reason) this.say(`${p.name} received $${amount} ${reason}`, 'money');
  }

  /**
   * Charge the *current* player. If they cannot pay, a debt is opened and the
   * turn stalls in the "debt" phase until they liquidate or go bankrupt.
   */
  charge(p, amount, creditor = null, reason = '') {
    if (amount <= 0) return true;
    if (p.money >= amount) {
      p.money -= amount;
      if (creditor) creditor.money += amount;
      else if (this.settings.vacationCash) this.vacationPot += amount;
      if (reason) this.say(`${p.name} paid $${amount} ${reason}`, 'money');
      return true;
    }
    this.turn.debt = { debtor: p.id, creditor: creditor?.id || null, amount, reason };
    this.turn.phase = 'debt';
    this.say(`${p.name} owes $${amount} ${reason} and must raise funds`, 'warn');
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
      if (creditor) creditor.money += amount;
      else if (this.settings.vacationCash) this.vacationPot += amount;
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

    const d1 = forced?.[0] ?? 1 + Math.floor(Math.random() * 6);
    const d2 = forced?.[1] ?? 1 + Math.floor(Math.random() * 6);
    this.turn.dice = [d1, d2];
    this.turn.rolledThisTurn = true;
    const isDouble = d1 === d2;

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
          this.turn.phase = this.turn.pending ? this.turn.phase : 'end';
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
      this.turn.phase = isDouble && !p.jail ? 'roll' : 'end';
      if (isDouble && !p.jail) this.say(`${p.name} rolls again`, 'info');
    }
    this.push();
    this.maybeBot();
    return { ok: true };
  }

  movePlayer(p, steps, { collectSalary = true, animate = true } = {}) {
    const size = this.map.size;
    const from = p.pos;
    let to = (p.pos + steps) % size;
    if (to < 0) to += size;
    // Landing dead on START is its own (bigger) payday — see landOn.
    const landsOnStart = this.tile(to)?.type === 'start';
    const passedStart = steps > 0 && to < from && !landsOnStart;
    p.pos = to;
    this.lastMove = animate ? { playerId: p.id, from, to, steps, at: Date.now() } : null;
    if (passedStart && collectSalary) {
      p.money += SALARY;
      this.say(`${p.name} passed START and collected $${SALARY}`, 'money');
    }
    this.landOn(p, to);
  }

  teleport(p, to, { collectSalary = true } = {}) {
    const from = p.pos;
    const landsOnStart = this.tile(to)?.type === 'start';
    const passedStart = to < from && !landsOnStart;
    p.pos = to;
    this.lastMove = { playerId: p.id, from, to, steps: 0, at: Date.now() };
    if (passedStart && collectSalary) {
      p.money += SALARY;
      this.say(`${p.name} passed START and collected $${SALARY}`, 'money');
    }
    this.landOn(p, to);
  }

  // ------------------------------------------------------------------ landing --
  landOn(p, index, opts = {}) {
    const t = this.tile(index);
    switch (t.type) {
      case 'start':
        p.money += START_BONUS;
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
          p.money += this.vacationPot;
          this.vacationPot = 0;
        }
        p.skipTurns = 1;
        this.say(`${p.name} is on vacation and will miss the next turn`, 'info');
        break;
      }

      case 'tax': {
        const due = t.amount ?? Math.floor((p.money * t.percent) / 100);
        this.charge(p, due, null, `for ${t.name}`);
        break;
      }

      case 'refund':
        p.money += t.amount;
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
    p.pos = this.cornerIndex('prison');
    p.jail = true;
    p.jailTurns = 0;
    this.turn.doubles = 0;
    this.lastMove = { playerId: p.id, from: p.pos, to: p.pos, steps: 0, at: Date.now() };
  }

  // -------------------------------------------------------------------- cards --
  /** The map's own localized deck when it has one, the classic deck otherwise. */
  freshDecks() {
    return {
      treasure: shuffled(this.map.deck?.treasure || TREASURE),
      surprise: shuffled(this.map.deck?.surprise || SURPRISE),
    };
  }

  drawCard(p, deckName) {
    const deck = this.decks[deckName];
    if (!deck.length) this.decks[deckName] = shuffled(this.map.deck?.[deckName] || (deckName === 'treasure' ? TREASURE : SURPRISE));
    const card = this.decks[deckName].shift();
    this.decks[deckName].push(card);
    this.lastCard = { deck: deckName, text: card.text, at: Date.now() };
    this.say(`${p.name} drew ${deckName === 'treasure' ? 'a Treasure' : 'a Surprise'}: ${card.text}`, deckName);
    this.applyCard(p, card.act);
  }

  applyCard(p, act) {
    switch (act.kind) {
      case 'money':
        if (act.amount >= 0) p.money += act.amount;
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
        const size = this.map.size;
        let to = (p.pos + act.n) % size;
        if (to < 0) to += size;
        p.pos = to;
        this.lastMove = { playerId: p.id, from: p.pos, to, steps: act.n, at: Date.now() };
        this.landOn(p, to);
        break;
      }

      case 'nearest': {
        const size = this.map.size;
        for (let step = 1; step <= size; step++) {
          const idx = (p.pos + step) % size;
          if (this.tile(idx).type === act.target) {
            const passedStart = idx < p.pos;
            p.pos = idx;
            if (passedStart) { p.money += SALARY; this.say(`${p.name} passed START (+$${SALARY})`, 'money'); }
            this.lastMove = { playerId: p.id, from: p.pos, to: idx, steps: step, at: Date.now() };
            this.landOn(p, idx, { payMultiplier: act.payMultiplier });
            break;
          }
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
          for (const other of others) other.money += act.amount;
          this.say(`${p.name} paid $${act.amount} to every player`, 'money');
        } else {
          this.turn.debt = { debtor: p.id, creditor: null, amount: total, reason: 'to the other players', each: act.amount };
          this.turn.phase = 'debt';
          this.say(`${p.name} owes $${total} to the other players and must raise funds`, 'warn');
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
    this.say(`${p.name} bought ${t.name} for $${t.price}`, 'buy');
    this.turn.pending = null;
    this.turn.phase = this.turn.dice && this.turn.dice[0] === this.turn.dice[1] && !p.jail && !this.turn.noReroll ? 'roll' : 'end';
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
      this.turn.phase = this.turn.dice && this.turn.dice[0] === this.turn.dice[1] && !p.jail && !this.turn.noReroll ? 'roll' : 'end';
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
    const t = this.tile(a.tile);
    if (a.leader && !this.player(a.leader)?.bankrupt) {
      // The bid is already escrowed by bid(); just hand over the deed.
      const winner = this.player(a.leader);
      this.ownership[a.tile] = { owner: winner.id, houses: 0, mortgaged: false };
      this.say(`${winner.name} won ${t.name} at auction for $${a.bid}`, 'auction');
    } else {
      this.say(`Nobody bid on ${t.name} — it stays with the bank`, 'auction');
    }
    this.auction = null;
    const p = this.current;
    this.turn.phase = this.turn.debt ? 'debt'
      : (this.turn.dice && this.turn.dice[0] === this.turn.dice[1] && !p.jail && !this.turn.noReroll ? 'roll' : 'end');
    this.push();
    this.maybeBot();
    return { ok: true };
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
    p.money += refund;
    this.say(`${p.name} sold a building on ${t.name} for $${refund}`, 'build');
    this.settleDebtIfPossible();
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
    p.money += value;
    this.say(`${p.name} mortgaged ${t.name} for $${value}`, 'mortgage');
    this.settleDebtIfPossible();
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
  settleDebtIfPossible() {
    const d = this.turn?.debt;
    if (!d) return;
    const p = this.player(d.debtor);
    if (p.money >= d.amount) {
      // stays in debt phase until the player confirms, but bots settle instantly
      if (this.autoPlayed(p)) this.payDebt(p.id);
    }
  }

  payDebt(id) {
    const d = this.turn?.debt;
    if (!d || d.debtor !== id) return { error: 'No debt' };
    const p = this.player(id);
    if (p.money < d.amount) return { error: 'Still not enough money' };
    p.money -= d.amount;
    const creditor = d.creditor ? this.player(d.creditor) : null;
    if (creditor) {
      creditor.money += d.amount;
    } else if (d.each) {
      // "pay every player" card settled late: the money goes to the players,
      // never to the vacation pot.
      for (const other of this.active) {
        if (other.id !== p.id) other.money += d.each;
      }
    } else if (this.settings.vacationCash) {
      this.vacationPot += d.amount;
    }
    this.say(`${p.name} settled a debt of $${d.amount}`, 'money');
    this.turn.debt = null;

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
      this.turn.phase = this.turn.pending ? 'action' : 'end';
    }
    this.push();
    this.maybeBot();
    return { ok: true };
  }

  declareBankrupt(id) {
    const d = this.turn?.debt;
    const p = this.player(id);
    if (!p) return { error: 'No player' };
    if (!d || d.debtor !== id) {
      if (!this.isCurrent(id)) return { error: 'Not allowed' };
    }
    const creditor = d?.creditor ? this.player(d.creditor) : null;
    this.bankrupt(p, creditor);
    return { ok: true };
  }

  /**
   * Ends the game when only one side is left standing. In team games that
   * means one team, not one player — a team survives while any member does.
   */
  checkGameEnd() {
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
    this.push();
    return true;
  }

  bankrupt(p, creditor) {
    p.bankrupt = true;
    const tiles = this.tilesOf(p.id);
    if (creditor && !creditor.bankrupt) {
      creditor.money += Math.max(0, p.money);
      for (const i of tiles) {
        const o = this.own(i);
        o.owner = creditor.id;
        o.houses = 0;
      }
      this.say(`${p.name} went bankrupt — everything goes to ${creditor.name}`, 'bankrupt');
    } else {
      for (const i of tiles) delete this.ownership[i];
      this.say(`${p.name} went bankrupt — assets return to the bank`, 'bankrupt');
    }
    p.money = 0;
    for (const other of this.players) {
      if (other.id !== p.id) this.botSay(other, 'bust', { name: p.name });
    }
    if (this.turn?.debt?.debtor === p.id) this.turn.debt = null;
    this.trades = this.trades.filter((t) => t.from !== p.id && t.to !== p.id);
    // Drop them from any running auction so it can't stall on their bid.
    if (this.auction) {
      this.auction.inRace = this.auction.inRace.filter((x) => x !== p.id);
      if (this.auction.leader === p.id) this.auction.leader = null;
    }

    if (this.checkGameEnd()) return;
    if (this.turn?.playerId === p.id) this.nextTurn();
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
      this.say(`${to.name} declined the trade from ${from.name}`, 'trade');
      this.push();
      return { ok: true };
    }
    if (from.money < trade.give.money || to.money < trade.get.money) {
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
    to.money += trade.give.money;
    to.money -= trade.get.money;
    from.money += trade.get.money;
    from.getOutCards -= trade.give.cards;
    to.getOutCards += trade.give.cards;
    to.getOutCards -= trade.get.cards;
    from.getOutCards += trade.get.cards;
    for (const i of trade.give.tiles) if (this.own(i)) this.own(i).owner = to.id;
    for (const i of trade.get.tiles) if (this.own(i)) this.own(i).owner = from.id;
    this.say(`${from.name} and ${to.name} completed a trade`, 'trade');
    this.settleDebtIfPossible();
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
      cand.doublesInARow = 0;
      this.turnCount++;
      this.recordWorth();
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
      const d = t.debt;
      if (p.money >= d.amount) return this.payDebt(p.id);
      if (this.autoLiquidate(p)) {
        this.push();
        return this.scheduleBot(500);
      }
      return this.declareBankrupt(p.id);
    }

    if (t.phase === 'action' && t.pending?.type === 'buy') {
      const tile = this.tile(t.pending.tile);
      const wants = this.botWantsTile(p, t.pending.tile);
      if (wants && p.money - tile.price > 150) return this.buy(p.id);
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
    this.chatter ??= { table: 0, per: {} };
    const now = Date.now();
    if (!always) {
      if (Math.random() < 0.45) return;
      if (now - this.chatter.table < 6000) return;
      if (now - (this.chatter.per[p.id] || 0) < 25000) return;
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
      this.proposeTrade(p.id, {
        to: holder.id,
        give: { money: 0, tiles: [theirs.missing], cards: 0 },
        get: { money: 0, tiles: [want.missing], cards: 0 },
      });
      this.botSay(p, 'swap', {
        name: holder.name,
        mine: this.tile(want.missing).name,
        yours: this.tile(theirs.missing).name,
      }, { always: true, delay: 700 });
      return;
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
      this.proposeTrade(p.id, {
        to: holder.id,
        give: { money: offer, tiles: [], cards: 0 },
        get: { money: 0, tiles: [want.missing], cards: 0 },
      });
      // Ahead-of-me players get the friendly pressure; everyone else gets asked.
      const leading = this.netWorth(holder) > this.netWorth(p) * 1.2;
      this.botSay(p, leading ? 'nudge' : 'wantTile',
        { name: holder.name, tile: tile.name }, { always: true, delay: 900 });
      return;
    }
  }

  botWantsTile(p, index) {
    const tile = this.tile(index);
    if (tile.type !== 'property') return true;
    const group = this.map.groups[tile.group] || [];
    const mine = group.filter((i) => this.own(i)?.owner === p.id).length;
    const theirs = group.filter((i) => this.own(i) && this.own(i).owner !== p.id).length;
    if (theirs === group.length - 1 && mine === 0) return p.money > tile.price * 3;
    return mine > 0 || p.money > tile.price * 2;
  }

  botBuild(p) {
    let guard = 0;
    while (guard++ < 12) {
      const candidates = this.tilesOf(p.id)
        .filter((i) => this.canBuild(p.id, i) && p.money - this.tile(i).houseCost > 120)
        .sort((a, b) => this.tile(b).price - this.tile(a).price);
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
      const cap = Math.min(bot.money - 100, Math.floor(tile.price * (this.botWantsTile(bot, a.tile) ? 1.15 : 0.6)));
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
        const t = this.tile(i);
        v += t.price * (this.botWantsTile(forPlayer, i) ? 1.3 : 0.9);
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
    if (completesForThem) bar = Math.max(bar, 1.6); // arming a rival costs extra
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
        skipTurns: p.skipTurns, netWorth: this.netWorth(p),
      })),
      ownership: this.ownership,
      turn: this.turn,
      auction: this.auction,
      trades: this.trades,
      quick: !!this.quick,
      quickStartAt: this.quickStartAt || null,
      log: this.log.slice(-60),
      chat: this.chat.slice(-50),
      vacationPot: this.vacationPot,
      winner: this.winner ? { id: this.winner.id, name: this.winner.name, color: this.winner.color } : null,
      // The chart is an end-of-game reveal; streaming it every push would bloat
      // the state for nothing.
      history: this.status === 'ended' ? this.history : [],
      lastCard: this.lastCard,
      lastMove: this.lastMove,
      version: this.version,
    };
  }

  dispose() {
    Object.values(this.timers).forEach(clearTimeout);
  }
}
