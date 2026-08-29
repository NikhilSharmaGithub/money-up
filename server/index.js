import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { GameRoom, COLORS } from './game.js';
import { mapList } from './maps.js';
import { profileFor, addFriend, removeFriend, friendsOf, setPresence, clearPresence } from './social.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// The front end may be hosted elsewhere (e.g. Vercel) while this process runs
// the game, so the read-only API has to be reachable cross-origin.
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
  // A JSON POST from another origin is preflighted; answer it here or the
  // browser never sends the real request.
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '8kb' }));
app.use(express.static(PUBLIC_DIR));
app.get('/api/maps', (_req, res) => res.json(mapList()));
app.get('/api/rooms', (_req, res) => {
  res.json(
    [...rooms.values()]
      .filter((r) => !r.settings.isPrivate && r.status === 'lobby')
      .map((r) => ({
        id: r.id,
        players: r.players.length,
        maxPlayers: r.settings.maxPlayers,
        map: r.map.name,
      })),
  );
});
// ---- friends -------------------------------------------------------------
// The identity token is the caller's own secret, so it only ever grants access
// to their own profile; friends are exchanged as short codes instead.
app.post('/api/profile', (req, res) => {
  const { token, name, flag } = req.body || {};
  const profile = profileFor(String(token || '').slice(0, 64), { name, flag });
  if (!profile) return res.status(400).json({ error: 'Missing identity' });
  res.json({ code: profile.code, name: profile.name, flag: profile.flag });
});

app.get('/api/friends', (req, res) => {
  res.json(friendsOf(String(req.query.token || '').slice(0, 64)));
});

app.post('/api/friends', (req, res) => {
  const { token, code } = req.body || {};
  const result = addFriend(String(token || '').slice(0, 64), code);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/friends/remove', (req, res) => {
  const { token, code } = req.body || {};
  res.json(removeFriend(String(token || '').slice(0, 64), code));
});

app.get(/^\/room\/.*/, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

/** @type {Map<string, GameRoom>} */
const rooms = new Map();
const socketsOf = new Map();  // roomId -> Set(socketId)
const seatsOf = new Map();    // roomId -> Map(playerId -> Set(socketId))

/** A player is only dropped once their last tab/device goes away. */
function claimSeat(roomId, playerId, socketId) {
  const seats = seatsOf.get(roomId) || seatsOf.set(roomId, new Map()).get(roomId);
  const set = seats.get(playerId) || seats.set(playerId, new Set()).get(playerId);
  set.add(socketId);
  return set.size;
}

function releaseSeat(roomId, playerId, socketId) {
  const seats = seatsOf.get(roomId);
  const set = seats?.get(playerId);
  if (!set) return 0;
  set.delete(socketId);
  if (!set.size) seats.delete(playerId);
  return set.size;
}

const ROOM_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';
function newRoomId() {
  let id;
  do {
    id = Array.from({ length: 5 }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join('');
  } while (rooms.has(id));
  return id;
}

function getRoom(id) {
  if (rooms.has(id)) return rooms.get(id);
  const room = new GameRoom(id, broadcast);
  rooms.set(id, room);
  socketsOf.set(id, new Set());
  return room;
}

/** Team chat stays inside the team: strip other teams' messages per viewer. */
function stateFor(base, room, viewerId) {
  if (!base.chat.some((m) => m.channel === 'team')) return base;
  const team = viewerId != null ? room.player(viewerId)?.team : null;
  return { ...base, chat: base.chat.filter((m) => m.channel !== 'team' || (team != null && m.team === team)) };
}

function broadcast(room) {
  const base = room.serialize();
  const delivered = new Set();
  for (const [playerId, socketIds] of seatsOf.get(room.id) || []) {
    const state = stateFor(base, room, playerId);
    for (const sid of socketIds) {
      io.to(sid).emit('state', state);
      delivered.add(sid);
    }
  }
  // Spectators (sockets without a seat) see everything but team chat.
  for (const sid of socketsOf.get(room.id) || []) {
    if (!delivered.has(sid)) io.to(sid).emit('state', stateFor(base, room, null));
  }
  // Keep each seated player's presence in step with what the room is doing,
  // so a friends list can say "in a lobby" vs "in a game".
  for (const playerId of seatsOf.get(room.id)?.keys() || []) {
    setPresence(playerId, room.id, room.status);
  }
}

// Reap idle rooms every 10 minutes.
setInterval(() => {
  for (const [id, room] of rooms) {
    const live = socketsOf.get(id)?.size || 0;
    const idleFor = Date.now() - (room.lastSeen || room.createdAt);
    if (live === 0 && idleFor > 30 * 60 * 1000) {
      room.dispose();
      rooms.delete(id);
      socketsOf.delete(id);
      seatsOf.delete(id);
    }
  }
}, 10 * 60 * 1000);

io.on('connection', (socket) => {
  let room = null;
  let playerId = null;

  const fail = (message) => socket.emit('toast', { type: 'error', message });
  const ok = (res) => {
    if (res?.error) fail(res.error);
    return !res?.error;
  };

  socket.on('createRoom', (payload = {}, cb) => {
    const id = newRoomId();
    getRoom(id);
    if (typeof cb === 'function') cb({ roomId: id });
    else socket.emit('roomCreated', { roomId: id });
  });

  socket.on('join', ({ roomId, token, name, flag } = {}) => {
    if (!roomId || !token) return fail('Missing room or identity');
    roomId = String(roomId).toLowerCase().slice(0, 12);
    room = getRoom(roomId);
    playerId = String(token).slice(0, 64);
    socket.join(roomId);
    socketsOf.get(roomId).add(socket.id);
    claimSeat(roomId, playerId, socket.id);
    setPresence(playerId, roomId, room.status);
    profileFor(playerId, { name, flag });
    room.lastSeen = Date.now();

    if (room.player(playerId)) {
      room.reconnect(playerId);
    } else {
      const res = room.addPlayer({ id: playerId, name, flag });
      if (res.error) {
        socket.emit('joinFailed', { message: res.error, spectate: true });
      }
    }
    socket.emit('you', { playerId, roomId });
    socket.emit('state', stateFor(room.serialize(), room, playerId));
  });

  const guard = (fn) => (...args) => {
    if (!room || !playerId) return fail('Join a room first');
    room.lastSeen = Date.now();
    return fn(...args);
  };

  socket.on('appearance', guard((d = {}) => room.updateAppearance(playerId, d)));
  socket.on('settings', guard((d = {}) => room.updateSettings(playerId, d)));
  socket.on('addBot', guard(() => {
    if (playerId !== room.hostId) return fail('Only the host can add bots');
    ok(room.addBot());
  }));
  socket.on('kick', guard((targetId) => {
    if (playerId !== room.hostId) return fail('Only the host can remove players');
    if (targetId === room.hostId) return;
    room.removePlayer(targetId);
  }));
  socket.on('team', guard((team, targetId) => {
    const target = targetId && targetId !== playerId ? targetId : playerId;
    if (target !== playerId) {
      // You can move yourself, and the host can shuffle the bots — nobody else.
      if (playerId !== room.hostId) return fail('Only the host can move other players');
      if (!room.player(target)?.isBot) return fail('You can only move bots');
    }
    ok(room.setTeam(target, team));
  }));
  socket.on('balanceTeams', guard(() => {
    if (playerId !== room.hostId) return fail('Only the host can shuffle the teams');
    room.balanceTeams();
  }));
  socket.on('start', guard(() => ok(room.start(playerId))));

  socket.on('roll', guard(() => ok(room.roll(playerId))));
  socket.on('buy', guard(() => ok(room.buy(playerId))));
  socket.on('skipBuy', guard(() => ok(room.skipBuy(playerId))));
  socket.on('bid', guard((amount) => ok(room.bid(playerId, amount))));
  socket.on('passBid', guard(() => ok(room.passBid(playerId))));
  socket.on('endTurn', guard(() => ok(room.endTurn(playerId))));
  socket.on('jailPay', guard(() => ok(room.jailPay(playerId))));
  socket.on('jailCard', guard(() => ok(room.jailCard(playerId))));

  socket.on('build', guard((tile) => ok(room.build(playerId, Number(tile)))));
  socket.on('sellHouse', guard((tile) => {
    if (!room.sellHouse(playerId, Number(tile))) fail('Cannot sell that building');
  }));
  socket.on('mortgage', guard((tile) => {
    if (!room.mortgage(playerId, Number(tile))) fail('Cannot mortgage that property');
  }));
  socket.on('unmortgage', guard((tile) => ok(room.unmortgage(playerId, Number(tile)))));

  socket.on('trade:propose', guard((d = {}) => ok(room.proposeTrade(playerId, d))));
  socket.on('trade:respond', guard(({ id, accept } = {}) => ok(room.respondTrade(playerId, id, !!accept))));
  socket.on('trade:cancel', guard(({ id } = {}) => ok(room.cancelTrade(playerId, id))));

  socket.on('payDebt', guard(() => ok(room.payDebt(playerId))));
  socket.on('bankrupt', guard(() => ok(room.declareBankrupt(playerId))));
  socket.on('chat', guard((text, channel) => room.sendChat(playerId, text, channel)));

  socket.on('rematch', guard(() => {
    if (playerId !== room.hostId) return fail('Only the host can restart');
    room.status = 'lobby';
    room.winner = null;
    room.winningTeam = null;
    room.ownership = {};
    room.turn = null;
    room.auction = null;
    room.trades = [];
    room.vacationPot = 0;
    room.log = [];
    room.players.forEach((p) => {
      p.money = room.settings.startingCash;
      p.pos = 0; p.jail = false; p.jailTurns = 0; p.getOutCards = 0;
      p.bankrupt = false; p.skipTurns = 0;
    });
    room.say('Back to the lobby — set up the next game', 'system');
    room.push();
  }));

  socket.on('disconnect', () => {
    if (!room) return;
    socketsOf.get(room.id)?.delete(socket.id);
    // Other tabs of the same player keep the seat alive.
    if (releaseSeat(room.id, playerId, socket.id) > 0) return;
    clearPresence(playerId);
    room.removePlayer(playerId);
    if ((socketsOf.get(room.id)?.size || 0) === 0 && room.players.length === 0) {
      room.dispose();
      rooms.delete(room.id);
      socketsOf.delete(room.id);
      seatsOf.delete(room.id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  🎲  MoneyMove running at http://localhost:${PORT}\n`);
});

export { app, server, io, rooms, COLORS };
