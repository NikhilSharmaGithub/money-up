// Selling coin packs on the web through Stripe Checkout.
//
// The shape mirrors the App Store path exactly: the client never tells the
// server what it paid — it only starts a checkout, and coins are credited when
// STRIPE tells us the session completed, over a webhook whose signature we
// verify ourselves. No secret configured means the whole feature reports
// itself as unavailable rather than half-working.

import crypto from 'node:crypto';
import { COIN_PACKS } from './store.js';
import { creditPurchase } from './social.js';

const SECRET = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

export const stripeEnabled = () => !!SECRET;

/** Stripe's REST API takes form-encoded bodies; no SDK needed for two calls. */
const form = (obj) => {
  const params = new URLSearchParams();
  const walk = (value, prefix) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        walk(v, prefix ? `${prefix}[${k}]` : k);
      }
    } else {
      params.append(prefix, String(value));
    }
  };
  walk(obj, '');
  return params;
};

/**
 * Start a Checkout Session for one pack. The player's identity token rides in
 * the metadata so the webhook knows whose wallet to credit — the redirect back
 * to the site proves nothing and pays nothing.
 */
export async function createCheckout({ token, packId, origin }) {
  if (!SECRET) return { error: 'Card payments are not set up on this server' };
  const pack = COIN_PACKS.find((p) => p.id === packId);
  if (!pack) return { error: 'Unknown pack' };
  if (!token) return { error: 'Missing identity' };

  // Only send players back to a site we actually run.
  const OK_ORIGINS = [
    'https://www.moneymove.live', 'https://moneymove.live',
    'https://money-up-nine.vercel.app', 'https://moneymove-csk9.onrender.com',
  ];
  const back = OK_ORIGINS.includes(origin) ? origin : OK_ORIGINS[0];

  const body = form({
    mode: 'payment',
    'line_items[0]': {
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(Number(pack.price) * 100),
        product_data: { name: `${pack.name} — ${pack.coins.toLocaleString('en-US')} coins` },
      },
    },
    metadata: { token: String(token).slice(0, 64), packId: pack.id },
    success_url: `${back}/?coins=purchased`,
    cancel_url: `${back}/?coins=cancelled`,
  });

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const session = await res.json();
  if (!res.ok || !session.url) {
    console.warn('stripe: checkout failed —', session.error?.message || res.status);
    return { error: 'Could not start the payment' };
  }
  return { ok: true, url: session.url };
}

/**
 * The webhook. Signature first, always: the raw body is HMAC'd against the
 * endpoint's signing secret, and anything that doesn't match is dropped
 * without being parsed. Replays are harmless — creditPurchase dedupes on the
 * session id, the same ledger the App Store receipts use.
 */
export function handleWebhook(rawBody, signatureHeader) {
  if (!WEBHOOK_SECRET) return { error: 'Webhook secret not configured' };

  const parts = Object.fromEntries(
    String(signatureHeader || '').split(',').map((kv) => kv.split('=')),
  );
  const timestamp = Number(parts.t);
  if (!timestamp || !parts.v1) return { error: 'Malformed signature' };
  // Five minutes of clock skew, same tolerance Stripe's own SDK uses.
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return { error: 'Stale signature' };

  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET)
    .update(`${parts.t}.${rawBody}`)
    .digest('hex');
  const given = Buffer.from(parts.v1, 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return { error: 'Bad signature' };
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { error: 'Malformed payload' };
  }

  if (event.type !== 'checkout.session.completed') return { ok: true, ignored: true };
  const session = event.data?.object || {};
  if (session.payment_status !== 'paid') return { ok: true, ignored: true };

  const token = session.metadata?.token;
  const pack = COIN_PACKS.find((p) => p.id === session.metadata?.packId);
  if (!token || !pack) return { error: 'Session carries no wallet' };

  const credited = creditPurchase(token, `stripe:${session.id}`, pack.coins);
  if (credited.error) return credited;
  console.log(`stripe: credited ${pack.coins} coins to ${token.slice(0, 12)}… (${session.id})`);
  return { ok: true, coins: credited.coins };
}
