// Rules a hostile or unlucky client could bend, one check each.
//
// Every block below is a defect that was found by reading the engine or by
// driving it with odd input, and each check is written so that it fails on
// the code as it was. Engine-only, no server: the socket-level half of the
// same review is test/server-hardening.mjs.
//
//   node test/rules-hardening.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// social.js reads DATA_DIR once, at import, so the scratch store is set up
// before anything that could load it.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-rules-'));
process.env.DATA_DIR = DATA_DIR;

const { GameRoom } = await import('../server/game.js');
const { MAPS } = await import('../server/maps.js');

let failed = 0;
let passed = 0;
const PASS = (ok, label, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail !== '' ? `  — ${detail}` : ''}`);
};
const section = (t) => console.log(`\n── ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A started table of people (no bots unless asked), turn order as given. */
function table(ids, { seconds = 60, settings = {}, bots = 0 } = {}) {
  const room = new GameRoom(`r${Math.random().toString(36).slice(2, 7)}`, () => {});
  room.map = MAPS.classic;
  // The bot driver is timer-driven; these checks drive the table by hand.
  room.scheduleBot = () => {};
  for (const id of ids) room.addPlayer({ id, name: id.toUpperCase() });
  for (let i = 0; i < bots; i++) room.addBot();
  Object.assign(room.settings, { turnSeconds: seconds, randomizeOrder: false }, settings);
  room.start(ids[0]);
  return room;
}

section('trade offers: one player cannot flood the table');
{
  const room = table(['a', 'b']);
  const sent = [];
  for (let i = 0; i < 5; i++) sent.push(room.proposeTrade('a', { to: 'b', give: { money: 1 }, get: {} }));
  PASS(sent.every((r) => r.ok), 'five open offers are fine');
  const sixth = room.proposeTrade('a', { to: 'b', give: { money: 1 }, get: {} });
  PASS(!!sixth.error, 'a sixth waits for an answer', sixth.error || 'ACCEPTED');
  for (let i = 0; i < 2000; i++) room.proposeTrade('a', { to: 'b', give: { money: 1 }, get: {} });
  PASS(room.trades.length === 5, 'two thousand more change nothing', `${room.trades.length} open`);
  room.respondTrade('b', sent[0].trade.id, false);
  PASS(!!room.proposeTrade('a', { to: 'b', give: { money: 1 }, get: {} }).ok, 'an answer frees a slot');
  PASS(!!room.proposeTrade('b', { to: 'a', give: { money: 1 }, get: {} }).ok, 'and the other player has their own five');

  // The same deed named a hundred thousand times is one deed, not a flood.
  const solo = table(['c', 'd']);
  solo.ownership[1] = { owner: 'c', houses: 0, mortgaged: false };
  const fat = solo.proposeTrade('c', { to: 'd', give: { tiles: Array(100000).fill(1) }, get: {} });
  PASS(fat.ok && fat.trade.give.tiles.length === 1, 'a repeated deed is listed once', String(fat.trade?.give.tiles.length));
  room.dispose(); solo.dispose();
}

section('teams are picked in the lobby, and only there');
{
  const room = new GameRoom('teams', () => {});
  room.map = MAPS.classic;
  for (const id of ['a', 'b', 'c', 'd']) room.addPlayer({ id, name: id });
  room.settings.randomizeOrder = false;
  room.updateSettings('a', { teams: 2 });
  room.setTeam('a', 0); room.setTeam('b', 0); room.setTeam('c', 1); room.setTeam('d', 1);
  room.start('a');
  room.declareBankrupt('b');
  const before = room.players.map((p) => p.team).join('');
  room.balanceTeams();
  const after = room.players.map((p) => p.team).join('');
  PASS(before === after, 'a mid-game reshuffle does nothing', `${before} → ${after}`);
  PASS(!room.sameTeam(room.player('a'), room.player('c')), 'nobody has changed sides');
  room.dispose();
}

section('the shot clock');
{
  // B's phone drops as A's turn begins. With nobody else there the turn gets
  // no clock — there is nobody to keep waiting. When B comes back there is.
  const room = table(['a', 'b']);
  room.removePlayer('b');
  room.nextTurn();                 // B's turn, played by the house
  room.nextTurn();                 // A's again, begun with B away
  PASS(room.current?.id === 'a' && room.turn.endsAt == null, 'a turn begun alone has no clock',
    `${room.current?.id} ${room.turn.endsAt}`);
  room.reconnect('b');
  PASS(room.turn.endsAt != null, 'B coming back puts A on the clock',
    room.turn.endsAt ? `${Math.round((room.turn.endsAt - Date.now()) / 1000)}s` : 'NO CLOCK');
  PASS(!Object.hasOwn(room.timers, 'grace:b'), 'and B\'s held-seat timer is gone, key and all',
    Object.keys(room.timers).join(', '));
  room.dispose();
}
{
  // A refresh on your own turn is not a fresh clock.
  const room = table(['a', 'b']);
  const endsAt = room.turn.endsAt;
  await sleep(25);
  room.removePlayer('a');
  room.reconnect('a');
  PASS(room.turn.endsAt === endsAt, 'reloading on your own turn keeps the clock you had',
    `${endsAt} → ${room.turn.endsAt}`);
  // Coming back from house cover does start a fresh one.
  room.player('a').botControlled = true;
  room.removePlayer('a');
  await sleep(5);
  room.reconnect('a');
  PASS(room.turn.endsAt > endsAt, 'taking a seat back from the house does');
  room.dispose();
}
{
  // The roller's connection drops during their own auction. When the hammer
  // falls the turn comes back to an empty chair — which is covered by the
  // house, exactly as a turn arriving at an empty chair is.
  const room = table(['a', 'b'], { seconds: 30, settings: { auction: true } });
  let botAsked = 0;
  room.scheduleBot = () => { botAsked++; };
  room.turn.pending = { type: 'buy', tile: 1 };
  room.turn.phase = 'action';
  room.skipBuy('a');
  PASS(!!room.auction, 'setup: the declined street is at auction');
  room.removePlayer('a');
  room.finishAuction();
  PASS(room.player('a').botControlled === true, 'the absent roller is covered by the house');
  PASS(botAsked > 0, 'and the house is asked to play the turn');
  room.reconnect('a');
  PASS(room.player('a').botControlled === false, 'coming back takes it straight back');
  room.dispose();
}

section('is anything due to happen? (the stall watchdog\'s question)');
{
  const room = table(['a', 'b'], { seconds: 0 });
  PASS(Object.values(room.timers).every((t) => !t), 'setup: clock off, nothing on a timer');
  PASS(room.workPending() === true, 'a person on their turn with the clock off is not a stall');
  room.player('a').connected = false;
  PASS(room.workPending() === false, 'an empty chair with nothing scheduled is');
  room.timers.bot = setTimeout(() => {}, 0);
  await sleep(10);
  PASS(room.workPending() === false, 'a timer that already fired is not work still due');
  room.timers.grace = setTimeout(() => {}, 60_000);
  PASS(room.workPending() === true, 'one still pending is');
  room.dispose();
}

section('somebody already out, leaving');
{
  const room = table(['a', 'b', 'c', 'd']);
  room.declareBankrupt('c');
  room.removePlayer('c');
  PASS(!room.serialize().awaiting.some((s) => s.id === 'c'), 'no "waiting for" card for a player who is out');
  PASS(!room.timers['grace:c'], 'and no seat held for them');
  // Away, then bankrupted while the house minded the seat.
  room.removePlayer('b');
  PASS(room.serialize().awaiting.some((s) => s.id === 'b'), 'setup: B\'s seat is being held');
  room.bankrupt(room.player('b'), null);
  PASS(!room.serialize().awaiting.some((s) => s.id === 'b'), 'going out clears the card at once');
  room.dispose();
}

section('the prison fine and the vacation pot');
{
  const room = table(['a', 'b'], { settings: { vacationCash: true } });
  room.player('a').jail = true;
  const pot = room.vacationPot;
  const res = room.jailPay('a');
  PASS(res.ok && room.vacationPot === pot + 50, 'paying the $50 to walk out feeds the pot', `${pot} → ${room.vacationPot}`);
  room.dispose();
}

section('a game that ends with a bill still open');
{
  const room = table(['a', 'b']);
  const a = room.player('a');
  a.money = 12;
  room.charge(a, 50, null, 'for a card');
  PASS(room.turn.phase === 'debt' && a.money === -38, 'setup: A owes the bank', `${a.money}`);
  room.quit('b');
  PASS(room.status === 'ended' && room.winner?.id === 'a', 'B leaves and A wins');
  PASS(a.money >= 0, 'the winner does not finish in the red', `${a.money}`);
  PASS(!room.turn.debt && room.turn.phase !== 'debt', 'and no debt is left open on a finished game');
  const last = room.history[room.history.length - 1];
  PASS((last?.w?.a ?? 0) >= 0, 'the final net-worth snapshot agrees', `${last?.w?.a}`);
  room.dispose();
}

section('what a join may put on a seat');
{
  const room = new GameRoom('flags', () => {});
  room.settings.maxPlayers = 8;
  room.addPlayer({ id: 'n', name: 12345, flag: 12345 });
  room.addPlayer({ id: 'o', name: 'Obj', flag: { x: 1 } });
  room.addPlayer({ id: 'l', name: 'Long', flag: '🇮'.repeat(50000) });
  room.addPlayer({ id: 'w', name: 'Word', flag: 'badword' });
  room.addPlayer({ id: 'g', name: 'Good', flag: '🇮🇳' });
  room.addPlayer({ id: 'p', name: 'Pirate', flag: '🏴‍☠️' });
  const flags = Object.fromEntries(room.serialize().players.map((p) => [p.id, p.flag]));
  PASS(flags.n === '' && flags.o === '', 'a number or an object is no flag', JSON.stringify([flags.n, flags.o]));
  PASS(flags.l === '' && flags.w === '', 'nor is a wall of text, or a word', JSON.stringify([flags.l.length, flags.w]));
  PASS(flags.g === '🇮🇳' && flags.p === '🏴‍☠️', 'a real flag, and the pirate, are kept');
  PASS(room.player('n').name === '12345', 'a number for a name is read as text', JSON.stringify(room.player('n').name));
  room.updateAppearance('g', { flag: 99 });
  PASS(room.player('g').flag === '', 'changing it later follows the same rule');
  room.dispose();
}

section('table settings are what the apps can read');
{
  const room = new GameRoom('settings', () => {});
  room.addPlayer({ id: 'h', name: 'Host' });
  room.updateSettings('h', { auction: 'x', x2rent: 0, maxPlayers: 3.5, teams: 2.5, isPrivate: false });
  PASS(room.settings.auction === true && room.settings.x2rent === false, 'a switch is stored as a switch',
    JSON.stringify([room.settings.auction, room.settings.x2rent]));
  PASS(room.settings.maxPlayers === 3 && room.settings.teams === 2, 'seats and teams are whole numbers',
    JSON.stringify([room.settings.maxPlayers, room.settings.teams]));
  room.dispose();
}

section('the host chair goes to a person');
{
  const room = new GameRoom('host', () => {});
  room.addPlayer({ id: 'host', name: 'Host' });
  room.addBot();
  room.addBot();
  room.removePlayer('host');      // the app went to the background to share the link
  PASS(room.hostId === null, 'with only bots left, nobody holds the chair', String(room.hostId));
  room.addPlayer({ id: 'host', name: 'Host' });
  PASS(room.hostId === 'host', 'the host who comes back has it again', String(room.hostId));
  PASS(!room.start('host').error, 'and can start the game');
  room.dispose();

  const second = new GameRoom('host2', () => {});
  second.addPlayer({ id: 'host', name: 'Host' });
  second.addBot();
  second.addPlayer({ id: 'friend', name: 'Friend' });
  second.removePlayer('host');
  PASS(second.hostId === 'friend', 'with a friend still seated, the friend gets it', String(second.hostId));
  second.dispose();
}

// ------------------------------------------------------------ social.js --
const social = await import('../server/social.js');
const { emojiFor, itemById } = await import('../server/store.js');

section('a friend\'s face');
{
  const A = 'tok-rules-ann';
  const B = 'tok-rules-ben';
  const a = social.profileFor(A, { name: 'Ann' });
  const b = social.profileFor(B, { name: 'Ben', flag: 12345 });
  PASS(b.flag === '', 'a profile flag follows the seat rule', JSON.stringify(b.flag));
  social.awardWin(B, 1000, 'test float');
  PASS(!social.buyItem(B, itemById('av-cool')).error, 'setup: Ben buys a face');
  PASS(!social.equipItem(B, 'avatar', 'av-cool').error, 'and wears it');
  social.addFriend(A, b.code);
  social.acceptFriend(B, a.code);
  const friend = social.friendsOf(A).find?.((f) => f.code === b.code)
    || social.socialOf(A).friends?.find((f) => f.code === b.code);
  PASS(friend?.avatar === emojiFor('av-cool'), 'Ann sees the face itself, not its shop id', JSON.stringify(friend?.avatar));
}

section('what a finished table may pay in a day');
{
  const T = 'tok-rules-farm';
  social.profileFor(T, { name: 'Farm' });
  let paid = 0;
  for (let i = 0; i < 40; i++) if (social.awardWin(T, 2, 'won a table', { daily: true }) != null) paid += 2;
  PASS(paid === social.TABLE_COINS_PER_DAY, `table payouts stop at ${social.TABLE_COINS_PER_DAY} coins a day`, `${paid}`);
  PASS(social.walletOf(T).coins === social.TABLE_COINS_PER_DAY, 'and the wallet agrees', `${social.walletOf(T).coins}`);
  PASS(social.awardWin(T, 5, 'operator float') != null, 'a payout that is not a table\'s is not capped');
}

section('a deploy does not lose the last second and a half');
{
  const T = 'tok-rules-flush';
  social.profileFor(T, { name: 'Flush' });
  social.flushSocial();
  const onDisk = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'social.json'), 'utf8'));
  PASS(onDisk.profiles.some((p) => p.token === T), 'flushSocial writes a pending save at once');
  PASS(!fs.existsSync(path.join(DATA_DIR, 'social.json.tmp')), 'through a file renamed into place');
}

section('a store that will not parse');
{
  const { readJsonStore } = await import('../server/storage.js');
  const { runBackup } = await import('../server/ops.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-store-'));
  const file = path.join(dir, 'social.json');
  PASS(readJsonStore(file) === null, 'a missing file is a first run');
  fs.writeFileSync(file, JSON.stringify({ profiles: [{ token: 'kept', coins: 99 }] }));
  runBackup(dir);
  fs.writeFileSync(file, '{"profiles":[{"tok');          // killed mid-write
  runBackup(dir);
  const day = fs.readdirSync(path.join(dir, 'backup'))[0];
  const snap = JSON.parse(fs.readFileSync(path.join(dir, 'backup', day, 'social.json'), 'utf8'));
  PASS(snap.profiles?.[0]?.token === 'kept', 'a broken file is never copied over a good backup');
  const read = readJsonStore(file);
  PASS(read?.profiles?.[0]?.coins === 99, 'reading it falls back to the newest good backup');
  PASS(fs.readdirSync(dir).some((f) => f.startsWith('social.json.corrupt-')),
    'and the broken file is set aside, not left for the next save to overwrite');
  // A restart before the first save used to find no file at all, read that as
  // a first run, and start every wallet at nothing.
  PASS(JSON.parse(fs.readFileSync(file, 'utf8')).profiles?.[0]?.coins === 99,
    'the restore is written back at once, not held only in memory');
  PASS(readJsonStore(file)?.profiles?.[0]?.coins === 99, 'so a restart before any save still has the wallets');

  // A file that is there but will not open may be good, and newer than any
  // backup: it is set aside like a broken one, never renamed over.
  const bans = path.join(dir, 'bans.json');
  fs.writeFileSync(bans, JSON.stringify([{ token: 'newer' }]));
  fs.writeFileSync(path.join(dir, 'backup', day, 'bans.json'), JSON.stringify([{ token: 'older' }]));
  fs.chmodSync(bans, 0o000);
  if (process.getuid?.() === 0) {
    PASS(true, 'a file that will not open (skipped: root opens anything)');
  } else {
    PASS(readJsonStore(bans)?.[0]?.token === 'older', 'a file that will not open falls back to the backup');
    const kept = fs.readdirSync(dir).find((f) => f.startsWith('bans.json.unreadable-'));
    if (kept) fs.chmodSync(path.join(dir, kept), 0o600);
    PASS(!!kept && JSON.parse(fs.readFileSync(path.join(dir, kept), 'utf8'))[0]?.token === 'newer',
      'and the newer file it could not open is kept aside, not saved over', kept || 'nothing kept');
  }

  // The cups are a store like the wallets: a broken one has a snapshot to
  // come back from, not an empty start.
  fs.writeFileSync(path.join(dir, 'tournaments.json'), JSON.stringify({ enabled: true, cups: [{ id: 'c1' }] }));
  runBackup(dir);
  PASS(fs.existsSync(path.join(dir, 'backup', day, 'tournaments.json')), 'the daily backup keeps tournaments.json too');
  fs.writeFileSync(path.join(dir, 'tournaments.json'), '{"enabled":true,"cu');
  PASS(readJsonStore(path.join(dir, 'tournaments.json'))?.cups?.[0]?.id === 'c1', 'and a broken one comes back from it');
  fs.rmSync(dir, { recursive: true, force: true });
}

section('a payment provider that falls over');
{
  process.env.STRIPE_SECRET_KEY = 'sk_test_rules';
  const { createCheckout } = await import('../server/stripe.js');
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const down = await createCheckout({ token: 'tok', packId: 'coins.small', origin: '' });
    PASS(!!down.error, 'a network error is a failed checkout, not a crash', down.error || '');
    globalThis.fetch = async () => new Response('<html>Bad gateway</html>', { status: 502 });
    const html = await createCheckout({ token: 'tok', packId: 'coins.small', origin: '' });
    PASS(!!html.error, 'so is a 5xx page that is not JSON', html.error || '');
  } catch (err) {
    PASS(false, 'createCheckout must not throw', err.message);
  } finally {
    globalThis.fetch = realFetch;
  }
}

fs.rmSync(DATA_DIR, { recursive: true, force: true });
console.log(`\n${failed ? 'FAILED' : 'OK'} — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
