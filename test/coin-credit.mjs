// The earned watermark: what tells a client that coins actually arrived.
//
// Both clients animate their counter off one number — `earned` on the wallet,
// the total this profile has ever been PAID. Everything the animation promises
// rests on three properties of that number, and each of them is a way to get
// it wrong: it has to move by exactly the amount credited (or the count-up
// lies), it must never move on a spend or a repeated read (or coins fly at a
// player who has just bought something), and it has to survive a restart (or
// every Render deploy throws a phantom payout at everyone who was online).
//
//   node test/coin-credit.mjs
//
// The data directory is temporary and removed afterwards; nothing here needs
// the network, a port, or a real receipt.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failed = 0;
let passed = 0;
const PASS = (ok, label, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  return ok;
};
const section = (t) => console.log(`\n── ${t}`);

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-coins-'));
process.env.DATA_DIR = DATA_DIR;

// social.js reads DATA_DIR once, at import, and debounces its writes — so the
// module is loaded only after the environment is set, and the run waits out
// the debounce before reading the file back.
const social = await import('../server/social.js');
const {
  profileFor, walletOf, awardWin, buyItem, claimDaily, creditAdReward, creditPurchase, adsRewardId,
} = social;
const { itemById } = await import('../server/store.js');

const TOKEN = 'u_coinflight_test';
const earnedOf = (t) => walletOf(t).earned;
const coinsOf = (t) => walletOf(t).coins;

section('a wallet nobody has touched');
{
  PASS(walletOf('u_nobody_at_all').earned === 0, 'an unknown token reads as nothing earned');
  PASS(walletOf('u_nobody_at_all').coins === 0, 'and nothing banked');
  // Reading must not mint a profile — the animation hangs off this number and
  // a crawler executing our JS must not be handed one.
  PASS(profileFor(TOKEN) !== null, 'a real player gets a profile when they do something');
  PASS(earnedOf(TOKEN) === 0, 'a fresh wallet starts at nought earned');
}

section('a win');
{
  const before = earnedOf(TOKEN);
  awardWin(TOKEN, 2, 'won a test table');
  PASS(earnedOf(TOKEN) === before + 2, 'a 2-coin win moves the watermark by 2');
  PASS(coinsOf(TOKEN) === 2, 'and the balance with it');
  // Reading it again is not a second win, which is the whole point: the client
  // polls this on a timer and after every game.
  PASS(earnedOf(TOKEN) === earnedOf(TOKEN), 'reading twice reports the same figure');
}

section('a spend');
{
  // Enough to afford the cheapest thing on the shelf, granted the way an
  // operator grant does it, then spent.
  awardWin(TOKEN, 1000, 'test float');
  const earned = earnedOf(TOKEN);
  const coins = coinsOf(TOKEN);
  const item = itemById('tok-car');
  const out = buyItem(TOKEN, item);
  PASS(!out.error, 'the piece is bought', out.error || '');
  PASS(coinsOf(TOKEN) === coins - item.price, 'the balance drops by the price');
  PASS(earnedOf(TOKEN) === earned, 'the watermark does not move on a spend');
  PASS(out.earned === earned, 'and the reply says so, so the counter can repaint quietly');
}

section('the daily');
{
  // The daily refuses anyone who has never signed in, which is a rule of its
  // own; this profile is given a login so the claim can be tested at all.
  social.attachLogin(TOKEN, 'google', 'sub-coinflight', 'Tester', { email: 'test@example.com' });
  const earned = earnedOf(TOKEN);
  const out = claimDaily(TOKEN);
  PASS(out.ok === true, 'the first claim of the day pays', out.error || '');
  PASS(out.earned === earned + out.amount, 'the reply carries the new watermark');
  PASS(earnedOf(TOKEN) === earned + out.amount, 'the wallet agrees with the reply');

  const again = claimDaily(TOKEN);
  PASS(!!again.error, 'a second claim the same day is refused');
  PASS(earnedOf(TOKEN) === out.earned, 'and moves nothing');
}

section('a rewarded view, and the replay of one');
{
  const earned = earnedOf(TOKEN);
  const id = adsRewardId('freeCoins', 'nonce-test-1');
  const out = creditAdReward(TOKEN, id, 5, { placement: 'freeCoins' });
  PASS(out.ok === true, 'a finished view pays', out.error || '');
  PASS(out.earned === earned + 5, 'the claim reports the watermark it moved to');

  // The client retries a pending claim — AdMob's callback races the phone —
  // so the same id arriving twice has to be one payout and one animation.
  const replay = creditAdReward(TOKEN, id, 5, { placement: 'freeCoins' });
  PASS(!!replay.error, 'the same view claimed again is refused');
  PASS(earnedOf(TOKEN) === out.earned, 'and the watermark stands still');
}

section('a coin pack');
{
  const earned = earnedOf(TOKEN);
  const first = creditPurchase(TOKEN, 'txn-test-1', 500, { provider: 'apple', packId: 'coins.small', usd: 4.99 });
  PASS(first.earned === earned + 500, 'a verified receipt moves the watermark by the pack');
  const dupe = creditPurchase(TOKEN, 'txn-test-1', 500, { provider: 'apple', packId: 'coins.small', usd: 4.99 });
  PASS(dupe.duplicate === true, 'the same receipt is recognised');
  PASS(dupe.earned === first.earned, 'and reports the watermark unmoved');
  PASS(earnedOf(TOKEN) === first.earned, 'a replayed receipt pays nothing');
}

section('a restart');
{
  const earned = earnedOf(TOKEN);
  const coins = coinsOf(TOKEN);
  // The store is written 1.5s after the last change; a deploy that restarts
  // the process is exactly this, so the test waits it out rather than poking
  // at the writer.
  await new Promise((r) => setTimeout(r, 1900));
  const onDisk = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'social.json'), 'utf8'));
  const stored = (onDisk.profiles || []).find((p) => p.token === TOKEN);
  PASS(stored?.earned === earned, 'the watermark is on disk');

  // A second instance of the module is a second process, as far as the data
  // is concerned: it loads the same file and must read the same number, or
  // every deploy would look like a payout to everyone holding a page open.
  const restarted = await import('../server/social.js?restart=1');
  PASS(restarted.walletOf(TOKEN).earned === earned, 'a restarted server reads the same watermark');
  PASS(restarted.walletOf(TOKEN).coins === coins, 'and the same balance');
}

fs.rmSync(DATA_DIR, { recursive: true, force: true });
console.log(`\n${failed ? 'FAIL' : 'PASS'} — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
