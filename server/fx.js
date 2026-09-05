// Prizes in the reader's own money.
//
// The owner writes one number — "first: 200", in dollars — and everybody who
// looks at it should see what that is worth to them. A player in Delhi
// reading "$200" has to go and look it up; the same player reading "₹17,600"
// does not.
//
// Two rules this file holds to.
//
// It never invents a rate. If the day's rates have not been fetched, or the
// reader's currency is not among them, the answer is the original amount in
// the original currency — a made-up conversion is worse than none, because a
// prize is a promise and somebody has to pay it.
//
// And it never converts the amount that gets paid. The owner's number stays
// the record; this is a reading aid, which is why every converted figure is
// shown with a "≈" on it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'fx.json');

/** Free, no key, one call a day. */
const SOURCE = 'https://open.er-api.com/v6/latest/USD';
const REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * The flag a player picked, and the money they think in. Several countries
 * share a currency; several currencies have no symbol anybody would
 * recognise, and those fall back to the code.
 */
const BY_FLAG = {
  '🇮🇳': ['INR', '₹'],   '🇬🇧': ['GBP', '£'],   '🇺🇸': ['USD', '$'],
  '🇧🇷': ['BRL', 'R$'],  '🇩🇪': ['EUR', '€'],   '🇫🇷': ['EUR', '€'],
  '🇮🇹': ['EUR', '€'],   '🇪🇸': ['EUR', '€'],   '🇵🇹': ['EUR', '€'],
  '🇳🇱': ['EUR', '€'],   '🇮🇪': ['EUR', '€'],   '🇨🇭': ['CHF', ''],
  '🇸🇪': ['SEK', ''],    '🇳🇴': ['NOK', ''],    '🇩🇰': ['DKK', ''],
  '🇵🇱': ['PLN', 'zł'],  '🇺🇦': ['UAH', '₴'],   '🇹🇷': ['TRY', '₺'],
  '🇷🇴': ['RON', ''],    '🇬🇷': ['EUR', '€'],   '🇮🇱': ['ILS', '₪'],
  '🇦🇪': ['AED', ''],    '🇸🇦': ['SAR', ''],    '🇪🇬': ['EGP', ''],
  '🇿🇦': ['ZAR', 'R'],   '🇳🇬': ['NGN', '₦'],   '🇰🇪': ['KES', ''],
  '🇨🇳': ['CNY', '¥'],   '🇯🇵': ['JPY', '¥'],   '🇰🇷': ['KRW', '₩'],
  '🇹🇭': ['THB', '฿'],   '🇻🇳': ['VND', '₫'],   '🇵🇭': ['PHP', '₱'],
  '🇮🇩': ['IDR', 'Rp'],  '🇵🇰': ['PKR', ''],    '🇧🇩': ['BDT', '৳'],
  '🇱🇰': ['LKR', ''],    '🇳🇵': ['NPR', ''],    '🇦🇺': ['AUD', 'A$'],
  '🇳🇿': ['NZD', 'NZ$'], '🇨🇦': ['CAD', 'C$'],  '🇲🇽': ['MXN', 'MX$'],
  '🇦🇷': ['ARS', ''],    '🇨🇱': ['CLP', ''],    '🇨🇴': ['COP', ''],
  '🇷🇺': ['RUB', '₽'],   '🇸🇬': ['SGD', 'S$'],  '🇲🇾': ['MYR', 'RM'],
};

/** Symbols for currencies an owner might set the prize in themselves. */
const SYMBOLS = Object.fromEntries(Object.values(BY_FLAG));
SYMBOLS.USD = '$';

let table = { base: 'USD', rates: {}, at: 0 };

(function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (raw?.rates && typeof raw.rates === 'object') {
      table = { base: 'USD', rates: raw.rates, at: Number(raw.at) || 0 };
      console.log(`  fx: ${Object.keys(table.rates).length} rates restored`);
    }
  } catch { /* first run, or nothing cached yet */ }
})();

/**
 * Ask for today's rates. Fire and forget: a failure leaves whatever we had,
 * and having nothing simply means everybody reads the owner's own currency.
 */
export async function refreshRates() {
  if (Date.now() - table.at < REFRESH_MS) return;
  try {
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(8000) });
    const body = await res.json();
    if (body?.result !== 'success' || !body?.rates?.INR) throw new Error('unexpected shape');
    table = { base: 'USD', rates: body.rates, at: Date.now() };
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify({ at: table.at, rates: table.rates }));
    } catch { /* the cache is a nicety; the rates are in memory either way */ }
    console.log(`  fx: ${Object.keys(table.rates).length} rates fetched`);
  } catch (e) {
    console.warn('fx: could not refresh rates —', e.message);
  }
}

/** What one unit of `code` is worth in dollars, or null if we do not know. */
const perDollar = (code) => (code === 'USD' ? 1 : Number(table.rates[code]) || null);

/**
 * The money a player reads, given the flag they fly.
 *
 * Returns null whenever the honest answer is "show them the original": no
 * flag, a country whose currency we have no rate for, or a reader whose
 * money is the same as the prize's.
 */
export function localiseFor(flag, amounts, baseCurrency = 'USD') {
  const pair = BY_FLAG[String(flag || '')];
  if (!pair) return null;
  const [code, symbol] = pair;
  if (code === baseCurrency) return null;
  const from = perDollar(baseCurrency);
  const to = perDollar(code);
  if (!from || !to) return null;

  // Through dollars, because that is the axis the table is built on.
  const convert = (n) => {
    const usd = Number(n || 0) / from;
    const out = usd * to;
    // Nobody quotes a prize to the rupee. Round to something a person would
    // actually say: tens under a thousand, hundreds under a hundred thousand,
    // thousands above that.
    const step = out >= 100000 ? 1000 : out >= 1000 ? 100 : out >= 100 ? 10 : 1;
    return Math.round(out / step) * step;
  };

  const out = { code, symbol: symbol || '', approximate: true };
  for (const [key, value] of Object.entries(amounts)) out[key] = convert(value);
  return out;
}

/** The symbol for a currency the owner set, for clients that need one. */
export const symbolFor = (code) => SYMBOLS[code] || '';

/** Whether any rates are known at all — the admin desk says so. */
export const ratesReady = () => Object.keys(table.rates).length > 0;
export const ratesAge = () => (table.at ? Date.now() - table.at : null);
