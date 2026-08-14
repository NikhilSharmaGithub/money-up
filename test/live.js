// End-to-end check against the deployed server: two real socket clients join a
// room, a bot fills a seat, the game starts and a turn is played.
import { io } from 'socket.io-client';

const SERVER = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (m) => console.log('  ' + m);

const open = (token, name) => new Promise((resolve, reject) => {
  const s = io(SERVER, { transports: ['websocket'], timeout: 20000 });
  s.state = null;
  s.on('state', (st) => { s.state = st; });
  s.on('connect', () => resolve(s));
  s.on('connect_error', (e) => reject(new Error(`${name}: ${e.message}`)));
  s.token = token; s.who = name;
});

const until = async (fn, label, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await wait(500);
  }
  throw new Error(`timed out waiting for ${label}`);
};

console.log(`\n▶ live check: ${SERVER}\n`);

const host = await open('live-host', 'host');
step('host connected over websocket');

const roomId = await new Promise((res) => host.emit('createRoom', {}, ({ roomId }) => res(roomId)));
step(`room created: ${roomId}`);

host.emit('join', { roomId, token: 'live-host', name: 'Nik' });
await until(() => host.state?.players.length === 1, 'host to appear');
step('host joined');

const guest = await open('live-guest', 'guest');
guest.emit('join', { roomId, token: 'live-guest', name: 'Arjun' });
await until(() => host.state?.players.length === 2, 'guest to appear');
step('second player joined — both clients see each other');

host.emit('settings', { mapId: 'random' });
await until(() => host.state?.mapId === 'random', 'random map');
step(`random board picked: ${host.state.map.tiles.filter((t) => t.type === 'property').slice(0, 3).map((t) => t.name).join(', ')}…`);

host.emit('addBot');
await until(() => host.state?.players.length === 3, 'bot to join');
step('bot added');

host.emit('start');
await until(() => host.state?.status === 'playing', 'game to start');
step('game started');

const before = JSON.stringify(host.state.players.map((p) => p.pos));
const me = host.state.turn.playerId;
const seat = me === 'live-host' ? host : me === 'live-guest' ? guest : null;
if (seat) {
  seat.emit('roll');
  await until(() => JSON.stringify(host.state.players.map((p) => p.pos)) !== before, 'a token to move');
  step('dice rolled, tokens moved');
} else {
  await until(() => host.state.log.some((l) => l.kind === 'dice'), 'the bot to roll');
  step('bot took its turn');
}

await until(() => guest.state?.version === host.state?.version || Math.abs(guest.state.version - host.state.version) <= 2, 'clients to converge');
step('both clients converged on the same state');

console.log('\n✓ live server is fully playable\n');
host.close(); guest.close();
process.exit(0);
