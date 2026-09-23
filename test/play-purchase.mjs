// Verifying a Google Play purchase, without Google.
//
// The verifier's whole job is to be the thing that says no. It has one
// dangerous failure mode — saying yes when it cannot actually check — and one
// expensive one: refusing a purchase somebody paid for. Both are worth a test
// that does not need a service account, a network, or a real purchase.
//
// Google is stubbed at the fetch boundary, which is the only place playstore.js
// talks to the outside world.
import { verifyPlayPurchase, playVerifyReady } from '../server/playstore.js';

let failed = 0;
const P = (ok, l, d = '') => { if (!ok) failed++; console.log(`${ok ? '  PASS' : '  X FAIL'}  ${l.padEnd(58)} ${d}`); };
const rule = (t) => console.log(`\n${'─'.repeat(80)}\n  ${t}\n${'─'.repeat(80)}`);

const realFetch = globalThis.fetch;
const restore = () => { globalThis.fetch = realFetch; };

/** Answers the token endpoint and then whatever `purchase` says. */
function stubGoogle({ token = 'ya29.test', purchase }) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(String(url));
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: token, expires_in: 3600 }) };
    }
    return purchase();
  };
  return seen;
}

// ───────────────────────────────────────────────── no credentials at all ──
rule('WITH NO SERVICE ACCOUNT IT REFUSES, AND SAYS WHY');
{
  delete process.env.PLAY_SERVICE_ACCOUNT;
  P(playVerifyReady() === false, 'it admits it cannot verify');
  const verdict = await verifyPlayPurchase('com.moneymove.game.coins.small', 'tok');
  P(!!verdict.error, 'and refuses the purchase', verdict.error || '');
  P(verdict.ok !== true, 'never ok');
  // The refusal has to read as a configuration gap, not a bad purchase:
  // somebody has paid, and "your purchase is invalid" would be a lie.
  P(/verified/i.test(verdict.error || ''), 'the message blames the server, not the player',
    verdict.error || '');
}

// A key that is present but unusable must behave exactly like no key at all.
{
  process.env.PLAY_SERVICE_ACCOUNT = JSON.stringify({
    client_email: 'x@y.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----\n',
  });
  const verdict = await verifyPlayPurchase('com.moneymove.game.coins.small', 'tok');
  P(!!verdict.error, 'a key that will not sign refuses too', verdict.error || '');
  delete process.env.PLAY_SERVICE_ACCOUNT;
}

// ─────────────────────────────────────────────── with Google answering ──
rule('WITH GOOGLE ANSWERING');
{
  // A real-shaped RSA key, so the JWT actually signs and the only thing being
  // tested is what the verifier does with Google's answer.
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.PLAY_SERVICE_ACCOUNT = JSON.stringify({
    client_email: 'x@y.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  P(playVerifyReady() === true, 'it now says it can verify');

  {
    const seen = stubGoogle({
      purchase: () => ({ ok: true, json: async () => ({ purchaseState: 0, orderId: 'GPA.1' }) }),
    });
    const verdict = await verifyPlayPurchase('com.moneymove.game.coins.small', 'tok-1');
    P(verdict.ok === true, 'a completed purchase is accepted');
    P(verdict.orderId === 'GPA.1', 'and carries the order id the ledger remembers', verdict.orderId);
    // The order id is the idempotency key; without it a lost reply would pay
    // twice, so it is required rather than defaulted.
    P(seen.some((u) => u.includes('/purchases/products/')), 'it actually asked Google');
    P(seen.some((u) => u.includes(encodeURIComponent('com.moneymove.game'))),
      'about this package');
    restore();
  }

  {
    stubGoogle({
      purchase: () => ({ ok: true, json: async () => ({ purchaseState: 1, orderId: 'GPA.2' }) }),
    });
    const verdict = await verifyPlayPurchase('com.moneymove.game.coins.small', 'tok-2');
    P(!!verdict.error, 'a cancelled purchase is refused', verdict.error || '');
    restore();
  }

  {
    stubGoogle({
      purchase: () => ({ ok: true, json: async () => ({ purchaseState: 2, orderId: 'GPA.3' }) }),
    });
    const verdict = await verifyPlayPurchase('com.moneymove.game.coins.small', 'tok-3');
    P(!!verdict.error, 'a pending purchase is refused — pending is not money');
    restore();
  }

  {
    stubGoogle({
      purchase: () => ({ ok: true, json: async () => ({ purchaseState: 0 }) }),
    });
    const verdict = await verifyPlayPurchase('com.moneymove.game.coins.small', 'tok-4');
    P(!!verdict.error, 'no order id, no payout', verdict.error || '');
    restore();
  }

  {
    stubGoogle({
      purchase: () => ({
        ok: false,
        json: async () => ({ error: { message: 'The purchase token was not found.' } }),
      }),
    });
    const verdict = await verifyPlayPurchase('com.moneymove.game.coins.small', 'made-up');
    P(!!verdict.error, 'a token Google does not know is refused');
    P(/not found/i.test(verdict.error || ''), "and Google's own words are passed through",
      verdict.error || '');
    restore();
  }

  {
    // A tunnel, not a refusal. It must still fail closed.
    globalThis.fetch = async () => { throw new Error('ENETDOWN'); };
    const verdict = await verifyPlayPurchase('com.moneymove.game.coins.small', 'tok-5');
    P(!!verdict.error, 'an unreachable Google refuses rather than assumes');
    restore();
  }

  {
    const verdict = await verifyPlayPurchase('', 'tok');
    P(!!verdict.error, 'a purchase with no product is refused before Google is asked');
    const other = await verifyPlayPurchase('com.moneymove.game.coins.small', '');
    P(!!other.error, 'and so is one with no token');
  }

  delete process.env.PLAY_SERVICE_ACCOUNT;
}

restore();
console.log(`\n${failed ? '  X FAIL' : '  PASS'} — ${failed} failed\n`);
process.exit(failed ? 1 : 0);
