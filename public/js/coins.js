// The coin counter, and the coins landing in it.
//
// Coins arrive from four places — a win, the daily, a rewarded view, a card
// payment — and the player is in a different part of the app for each one. So
// this module owns one question: has the server just paid this wallet, and
// where on screen should that be shown? Everything that reads the wallet hands
// its answer here instead of writing a number on the chip itself.
//
// Nothing here decides what a credit is. The server keeps an `earned` tally
// that only ever goes up, and coins fly only when that number moves. A poll
// reading the same wallet twice is silent; a purchase, which moves the balance
// the other way, is silent; and the first wallet a page ever reads just sets
// the mark, because arriving on the page is not a payout.

import { icon } from './icons.js';

const $ = (sel) => document.querySelector(sel);

/** The earned figure this page has already shown. Null until the first read. */
let mark = null;
/** The count-up in flight, so a second credit re-aims it instead of racing it. */
let counting = 0;

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The landing's chip — the real counter, when the player can see it. */
const chipEl = () => $('#coinChip');

/** On screen, or hidden behind a game: a display:none chip measures as zero. */
function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0;
}

const paint = (el, n) => { if (el) el.innerHTML = `${icon('coin')} ${n}`; };
const reading = (el) => Number(String(el?.textContent || '').replace(/\D+/g, '')) || 0;

/**
 * The wallet as the server just reported it — from a poll, a claim, a receipt.
 * `earned` is what decides whether anything moves; `coins` is what the counter
 * ends up saying either way.
 */
export function noteWallet(w) {
  const total = Number(w?.coins);
  if (!Number.isFinite(total)) return;
  const earned = Number(w?.earned);
  // A server too old to send the watermark still gets its number written down
  // correctly; it only misses the flourish, which is the safe way round.
  if (!Number.isFinite(earned)) return setCoins(total);
  const gained = mark === null ? 0 : earned - mark;
  mark = earned;
  if (gained <= 0) return setCoins(total);
  land(gained, total);
}

/** A spend, or a first sighting: the counter says what it says, quietly. */
export function setCoins(total) {
  if (!Number.isFinite(Number(total))) return;
  cancelAnimationFrame(counting);
  counting = 0;
  paint(chipEl(), Math.round(total));
}

/**
 * Coins arriving. The chip catches them when it is on screen; when the player
 * is at a table it is not, so a pill takes its place in the same corner —
 * either way the coins fly to the top right and the number climbs there.
 *
 * Three credits at once: when they land between two reads of the wallet the
 * watermark has already added them up, so that is one flight for the sum. When
 * they arrive as three separate answers inside the same second, each moves the
 * mark and calls in here — the coins already in the air are left to land (the
 * cap on how many fly is what keeps that cheap) and the count-up simply
 * re-aims at the newest total from whatever the counter is showing. The number
 * climbs past the figures in between rather than jumping backwards, and the
 * whole thing is still over in about a second.
 */
function land(gained, total) {
  const chip = chipEl();
  const target = visible(chip) ? chip : purse(total - gained);
  if (!still()) {
    throwCoins(target, gained);
    target.classList.add('minted');
    setTimeout(() => target.classList.remove('minted'), 900);
  }
  countUp(target, total);
}

/**
 * The stand-in counter: a pill in the top right for the moments the landing's
 * chip is not on screen — a win paid out at the table, an ad watched from the
 * game-over sheet. It says the same thing the chip would have, then leaves.
 */
let purseTimer = 0;
function purse(from) {
  let el = $('#coinPurse');
  if (!el) {
    el = document.createElement('div');
    el.id = 'coinPurse';
    el.className = 'coin-chip coin-purse';
    paint(el, Math.max(0, Math.round(from)));
    document.body.appendChild(el);
    // One frame on the start value, so the entrance is an entrance and not
    // the pill appearing mid-count.
    requestAnimationFrame(() => el.classList.add('in'));
  }
  clearTimeout(purseTimer);
  purseTimer = setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 400);
  }, 2200);
  return el;
}

/** The number climbing to what it became, rather than snapping to it. */
function countUp(el, to) {
  const from = reading(el);
  cancelAnimationFrame(counting);
  if (still() || to <= from) { paint(el, to); return; }
  const started = performance.now();
  const step = (now) => {
    // Held back a beat, so the first disc is on its way before the total
    // starts to move: the number climbing is the coins arriving, not a repaint.
    const t = Math.min(1, Math.max(0, now - started - 240) / 650);
    paint(el, Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
    counting = t < 1 ? requestAnimationFrame(step) : 0;
  };
  counting = requestAnimationFrame(step);
}

/**
 * The coins themselves: a few discs thrown from the middle of the screen to
 * the counter. A few, not one per coin — a 400-coin pack is the same handful
 * as a 2-coin win, because this is a payment landing, not a bar chart.
 */
function throwCoins(target, gained) {
  const stage = document.createElement('div');
  stage.className = 'coin-fly';
  document.body.appendChild(stage);

  const box = target.getBoundingClientRect();
  const to = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const from = { x: innerWidth / 2, y: Math.min(innerHeight * 0.58, innerHeight - 90) };
  const n = Math.max(3, Math.min(6, Math.round(Math.log10(gained + 1) * 3) + 2));

  for (let i = 0; i < n; i++) {
    const coin = document.createElement('i');
    coin.innerHTML = icon('coin', 22, 'solo');
    // Each disc gets its own scatter and its own moment; the CSS does the
    // travelling, so the browser can keep the whole flight on the compositor.
    coin.style.setProperty('--x0', `${from.x + (Math.random() - 0.5) * 120}px`);
    coin.style.setProperty('--y0', `${from.y + (Math.random() - 0.5) * 60}px`);
    coin.style.setProperty('--x1', `${to.x}px`);
    coin.style.setProperty('--y1', `${to.y}px`);
    coin.style.setProperty('--d', `${i * 55}ms`);
    stage.appendChild(coin);
  }
  // One timer for the lot: the last disc leaves at n×55ms and flies for 620.
  setTimeout(() => stage.remove(), n * 55 + 800);
}
