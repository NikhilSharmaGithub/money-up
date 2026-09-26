// Hand-drawn art: the board's illustrations and the app's UI glyphs.
//
// Emoji were the single thing making the board look generic — they carry another
// vendor's style, change per platform, and can't take the board's palette. These
// are flat two-tone illustrations on a common 32×32 grid so they sit at the same
// optical weight next to each other.
//
// Two kinds of glyph live here, and the difference decides how a call site uses one:
//
//   currentColor — the drawing is ink, so it takes the colour of whatever it sits
//                  in (a chip's text colour, a button's label, a panel's --ink).
//                  Set a colour on the parent and the glyph follows.
//   inherent     — the drawing has a colour of its own that is part of what it
//                  means. A coin is gold on every table; a bronze medal that took
//                  the theme's ink would just be a third silver one.
//
// INHERENT_COLOUR below is the authoritative list. Everything not in it is ink.

const n = (v) => +(+v).toFixed(2);

const svg = (body, extra = '') =>
  `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" ${extra}>${body}</svg>`;

// ── path helpers ───────────────────────────────────────────────────────────
// Holes (dice pips, a skull's eyes, a ticket's perforation) are cut with
// fill-rule="evenodd" rather than a <mask>: these SVGs are inlined many times
// on one page, and any id inside them would collide with its own copies.

/** A full circle as path data, so it can be a subpath — and therefore a hole. */
const dot = (cx, cy, r) =>
  `M${n(cx - r)} ${n(cy)}a${r} ${r} 0 1 0 ${n(r * 2)} 0a${r} ${r} 0 1 0 ${n(-r * 2)} 0Z`;

/** A rounded rectangle as path data, same reason. */
const rr = (x, y, w, h, r) =>
  `M${n(x + r)} ${n(y)}h${n(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}` +
  `v${n(h - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${r}h${n(-(w - 2 * r))}` +
  `a${r} ${r} 0 0 1 ${-r} ${-r}v${n(-(h - 2 * r))}a${r} ${r} 0 0 1 ${r} ${-r}Z`;

/** A five-pointed star, point up. Used by the badge, the medals and the ticket. */
const star5 = (cx, cy, R, r) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r : R;
    const a = ((-90 + i * 36) * Math.PI) / 180;
    pts.push(`${n(cx + rad * Math.cos(a))} ${n(cy + rad * Math.sin(a))}`);
  }
  return `M${pts.join('L')}Z`;
};

/** A house/hut silhouette — roof and walls in one pentagon. */
const hut = (cx, apexY, halfW, baseY) =>
  `M${n(cx)} ${n(apexY)}L${n(cx + halfW)} ${n(apexY + halfW * 0.8)}V${n(baseY)}` +
  `H${n(cx - halfW)}V${n(apexY + halfW * 0.8)}Z`;

// A plane is a plane whether it is a board tile or a button, so both draw the
// same silhouette — the tile paints it airline blue, the glyph paints it ink.
const PLANE = 'M16 2.6c1.5 0 2.4 1.6 2.4 3.6v5.4l10.2 5.6v3l-10.2-3v5.4l3 2.2v2.4L16 26l-5.4 1.2v-2.4l3-2.2v-5.4l-10.2 3v-3l10.2-5.6V6.2c0-2 .9-3.6 2.4-3.6z';

// Medals differ only in their metal, so one recipe makes all three.
const medal = (ribbonA, ribbonB, rim, face) => `
  <path d="M9.6 2.4 15.2 12.6l-5 2.9L4 5.4z" fill="${ribbonA}"/>
  <path d="M22.4 2.4 16.8 12.6l5 2.9L28 5.4z" fill="${ribbonB}"/>
  <circle cx="16" cy="21.6" r="8.6" fill="${rim}"/>
  <circle cx="16" cy="21.6" r="6.3" fill="${face}"/>
  <path d="${star5(16, 21.6, 4.3, 1.9)}" fill="${rim}"/>`;

// A banknote, drawn once for the plain "cash" glyph and again with wings for
// "payment" — the same note so a payment reads as cash that is leaving.
const note = (x, y, w, h) => `
  <rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2.2" fill="#2f8f5b"/>
  <rect x="${n(x + 2.4)}" y="${n(y + 2.2)}" width="${n(w - 4.8)}" height="${n(h - 4.4)}" rx="1.4" fill="#4fbb80"/>
  <circle cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" r="${n(Math.min(w, h) * 0.22)}" fill="#eaf9f0"/>`;

// ── the glyphs ─────────────────────────────────────────────────────────────
// Stored as the inside of the 32×32 canvas so `icon()` can wrap a body in its
// own size and class; ART re-wraps the very same bodies as standalone SVG.
const BODY = {
  // ---- board corners ----------------------------------------------------
  start: `
    <path d="M3 16 h13" stroke="#1c6b45" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="1.5 4"/>
    <path d="M13 6.5 21.5 16 13 25.5 Z" fill="#34d399"/>
    <path d="M20 6.5 28.5 16 20 25.5 Z" fill="#6ee7a0"/>
    <circle cx="6" cy="16" r="2.6" fill="#34d399"/>`,

  prison: `
    <rect x="4.5" y="5.5" width="23" height="21" rx="3" fill="#1b2140"/>
    <circle cx="16" cy="13" r="4.2" fill="#aab6d8"/>
    <path d="M8.5 26.5c0-4.4 3.4-7.6 7.5-7.6s7.5 3.2 7.5 7.6z" fill="#aab6d8"/>
    <g stroke="#e6ecff" stroke-width="1.9" stroke-linecap="round">
      <path d="M11 6.6v18.8M16 6.6v18.8M21 6.6v18.8"/>
    </g>
    <rect x="4.5" y="5.5" width="23" height="21" rx="3" stroke="#8f9dc4" stroke-width="1.6"/>`,

  vacation: `
    <circle cx="23" cy="9.5" r="5" fill="#fcd34d"/>
    <path d="M13.5 13c-3.6-2.4-8-1.6-9.6 1 3-.6 5.4.2 7 1.6z" fill="#22c55e"/>
    <path d="M13.5 13c-.8-4.2 1.6-7.8 4.8-8.2-2 2.2-2.6 4.8-2.4 7z" fill="#16a34a"/>
    <path d="M13.5 13c4-1.6 8 .4 9 3.4-2.6-1.6-5.2-1.8-7.4-1z" fill="#22c55e"/>
    <path d="M13.6 12.6 12 27" stroke="#a16207" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M2 24.5c2.6-2 5.2-2 7.8 0s5.2 2 7.8 0 5.2-2 7.8 0 4 1.4 5.6 0" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>`,

  gotoprison: `
    <circle cx="10" cy="19" r="6.4" stroke="#54607a" stroke-width="3"/>
    <circle cx="22" cy="19" r="6.4" stroke="#54607a" stroke-width="3"/>
    <path d="M10 12.6V8.4M22 12.6V8.4" stroke="#54607a" stroke-width="3" stroke-linecap="round"/>
    <path d="M12.4 7.4h7.2" stroke="#d92037" stroke-width="3.4" stroke-linecap="round"/>`,

  // ---- card and cash tiles ---------------------------------------------
  treasure: `
    <path d="M4 14.5A12 12 0 0 1 28 14.5V16H4z" fill="#f0a336"/>
    <rect x="4" y="15.5" width="24" height="11.5" rx="2.2" fill="#d97b0f"/>
    <rect x="4" y="15" width="24" height="3" fill="#fbbf24"/>
    <rect x="13.6" y="12.5" width="4.8" height="9" rx="1.6" fill="#7c3f06"/>
    <circle cx="16" cy="17.5" r="1.5" fill="#fde68a"/>`,

  surprise: `
    <rect x="5" y="5" width="22" height="22" rx="7" fill="#be1a63"/>
    <path d="M12.4 12.6c0-2.2 1.7-3.7 3.9-3.7 2.1 0 3.8 1.4 3.8 3.4 0 1.7-1 2.5-2.2 3.3-1.1.8-1.6 1.4-1.6 2.6v.6"
      stroke="#ffd9ea" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="16.2" cy="23.4" r="1.8" fill="#ffd9ea"/>`,

  tax: `
    <rect x="3.5" y="8" width="25" height="16" rx="2.4" fill="#3f2733" stroke="#f0728c" stroke-width="1.6"/>
    <circle cx="11" cy="13" r="2.2" fill="#f0728c"/>
    <circle cx="21" cy="19" r="2.2" fill="#f0728c"/>
    <path d="M22 11 10 21" stroke="#f0728c" stroke-width="2.2" stroke-linecap="round"/>`,

  refund: `
    <rect x="3.5" y="8" width="25" height="16" rx="2.4" fill="#1e3a2b" stroke="#4ade80" stroke-width="1.6"/>
    <circle cx="16" cy="16" r="4.4" fill="#4ade80"/>
    <path d="M16 13.4v5.2M13.4 16h5.2" stroke="#12321f" stroke-width="2" stroke-linecap="round"/>`,

  // ---- ownables ---------------------------------------------------------
  airport: `<path d="${PLANE}" fill="#3f6fae"/>`,

  bolt: `<path d="M18.4 2.5 7 18h6.6l-1.4 11.5L25 13.4h-7l.4-10.9z" fill="#eab308"/>`,

  droplet: `
    <path d="M16 3c5.4 6.6 8.4 10.9 8.4 14.7A8.4 8.4 0 0 1 16 26a8.4 8.4 0 0 1-8.4-8.3C7.6 13.9 10.6 9.6 16 3z" fill="#5cc9f5"/>
    <path d="M12.4 18.6c0 2.2 1.5 3.9 3.4 4.3" stroke="#e0f6ff" stroke-width="1.8" stroke-linecap="round"/>`,

  flame: `
    <path d="M16 2.5c1.2 5.4-4 6.6-4 11.4 0-2.2-1.3-3.5-1.3-3.5-2 2.6-3.2 5.2-3.2 8A8.5 8.5 0 0 0 16 27a8.5 8.5 0 0 0 8.5-8.6c0-6.4-5.2-9.6-8.5-15.9z" fill="#fb923c"/>
    <path d="M16 27a4.2 4.2 0 0 0 4.2-4.3c0-3-2.6-4.4-4.2-7.4-1.6 3-4.2 4.4-4.2 7.4A4.2 4.2 0 0 0 16 27z" fill="#fde68a"/>`,

  sun: `
    <circle cx="16" cy="16" r="6.4" fill="#fcd34d"/>
    <g stroke="#fcd34d" stroke-width="2.4" stroke-linecap="round">
      <path d="M16 3.4v3.6M16 25v3.6M3.4 16h3.6M25 16h3.6M7.2 7.2l2.5 2.5M22.3 22.3l2.5 2.5M24.8 7.2l-2.5 2.5M9.7 22.3l-2.5 2.5"/>
    </g>`,

  turbine: `
    <path d="M15 15 6.5 8.4l1.8-2.6L16 13.6z" fill="#4a86bd"/>
    <path d="M17 15.6 27 12l.7 3.1-10 3.3z" fill="#4a86bd"/>
    <path d="M15.6 17.4 13 28.4h-3.2l3.5-11.4z" fill="#4a86bd"/>
    <circle cx="16" cy="16" r="2.4" fill="#2c5a85"/>`,

  // ---- buildings --------------------------------------------------------
  // Small enough to stay legible at a few pixels wide on a tile's edge.
  house: `
    <path d="M16 4 30 15.5h-4V28H6V15.5H2z" fill="#3ddc84"/>
    <rect x="13" y="19" width="6" height="9" rx="1" fill="#0f5132"/>`,

  hotel: `
    <rect x="5" y="7" width="22" height="21" rx="2" fill="#f43f5e"/>
    <rect x="5" y="4" width="22" height="4" rx="1.6" fill="#fb7185"/>
    <g fill="#ffe4e6">
      <rect x="8.5" y="11" width="4" height="4" rx=".8"/><rect x="14" y="11" width="4" height="4" rx=".8"/>
      <rect x="19.5" y="11" width="4" height="4" rx=".8"/><rect x="8.5" y="17" width="4" height="4" rx=".8"/>
      <rect x="19.5" y="17" width="4" height="4" rx=".8"/>
    </g>
    <rect x="13.6" y="21" width="4.8" height="7" rx="1" fill="#7f1d3a"/>`,

  /** Two roofs — "the properties you hold", not a building you can buy. */
  houses: `
    <path d="${hut(21.5, 5, 8, 26)}" fill="currentColor" opacity=".32"/>
    <path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor"
      d="${hut(11.5, 10.6, 9, 27.6)}M9.4 21.4h4.2v6.2H9.4Z"/>`,

  // ---- the turn ---------------------------------------------------------
  /** Two dice, pips knocked clean through so the surface shows. */
  dice: `
    <path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" opacity=".3"
      d="${rr(13, 3.2, 15.8, 15.8, 3.4)}${dot(17.6, 7.8, 1.5)}${dot(24.2, 14.4, 1.5)}"/>
    <path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor"
      d="${rr(3.2, 13, 15.8, 15.8, 3.4)}${dot(7.8, 17.6, 1.6)}${dot(14.4, 17.6, 1.6)}${dot(7.8, 24.2, 1.6)}${dot(14.4, 24.2, 1.6)}"/>`,

  /** The house currency: a gold coin with a struck $. */
  coin: `
    <circle cx="16" cy="16" r="13" fill="#dc9c1c"/>
    <circle cx="16" cy="16" r="10" fill="#f7c948"/>
    <path d="M16 8.6v14.8" stroke="#a9761a" stroke-width="2" stroke-linecap="round"/>
    <path d="M19.8 12.6c-.9-1.4-2.3-2.1-4-2.1-2.3 0-3.9 1.2-3.9 3 0 4.2 8 2 8 6.2 0 1.9-1.7 3.1-4.1 3.1-1.9 0-3.4-.8-4.3-2.2"
      stroke="#a9761a" stroke-width="2" stroke-linecap="round"/>`,

  /** A deal: two arms reaching in from opposite sides, hands gripping in the
      middle. One is a wash and one is solid so the eye reads two hands rather
      than one blob — the same trick the map and the dice use. Each shape is
      stroked in its own fill to round the corners without a second tone. */
  trade: `
    <path fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" opacity=".33"
      d="M3 12.8h6.4l7.6 3.5-2.6 5.4-5.6-2.6v5.7H3a2.2 2.2 0 0 1-2.2-2.2V15A2.2 2.2 0 0 1 3 12.8Z"/>
    <path fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"
      d="M29 19.2h-6.4L15 15.7l2.6-5.4 5.6 2.6V7.2H29a2.2 2.2 0 0 1 2.2 2.2V17a2.2 2.2 0 0 1-2.2 2.2Z"/>`,

  /** The bank: a portico, columns and a step. Mortgage and payout both use it. */
  bank: `
    <path d="M16 3.2 30.2 10.4v3H1.8v-3z" fill="currentColor"/>
    <g fill="currentColor" opacity=".34">
      <rect x="5.6" y="14.8" width="3.8" height="9.6"/>
      <rect x="14.1" y="14.8" width="3.8" height="9.6"/>
      <rect x="22.6" y="14.8" width="3.8" height="9.6"/>
    </g>
    <rect x="1.8" y="25.4" width="28.4" height="3.6" rx="1.4" fill="currentColor"/>`,

  /** Someone is watching this table. */
  eye: `
    <path d="M16 6.8c6.7 0 12 4.3 14.2 9.2C28 20.9 22.7 25.2 16 25.2S4 20.9 1.8 16C4 11.1 9.3 6.8 16 6.8z" fill="currentColor" opacity=".3"/>
    <circle cx="16" cy="16" r="5.2" fill="currentColor"/>`,

  /** Auction: head cocked up-right, handle down-left, block underneath. */
  gavel: `
    <path d="M24.6 16.4 29.2 9.9 17.4 1.6 12.8 8.1Z" fill="currentColor"/>
    <path d="M19.6 12.1 12.7 21.9" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>
    <rect x="3.4" y="23.6" width="17.6" height="5" rx="2.2" fill="currentColor" opacity=".34"/>`,

  /** Jail, drawn as the cap rather than the cell — the cell is the board tile. */
  police: `
    <path d="M6 17.4c0-5.7 4.5-10.2 10-10.2s10 4.5 10 10.2z" fill="#41508a"/>
    <rect x="3.4" y="17" width="25.2" height="5.6" rx="2.2" fill="#2b3663"/>
    <path d="${star5(16, 13.6, 4.4, 2)}" fill="#f5c542"/>`,

  soundOn: `
    <path d="M3.6 12.2h5.2L16.2 5.6v20.8l-7.4-6.6H3.6z" fill="currentColor"/>
    <g stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <path d="M20.4 12.2a5.4 5.4 0 0 1 0 7.6"/>
      <path d="M24.6 8.6a10.4 10.4 0 0 1 0 14.8"/>
    </g>`,

  soundOff: `
    <path d="M3.6 12.2h5.2L16.2 5.6v20.8l-7.4-6.6H3.6z" fill="currentColor"/>
    <path d="M20.8 12.4 27.8 19.4M27.8 12.4 20.8 19.4" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`,

  /** Play the same table again. */
  replay: `
    <path d="M16 6.4A9.6 9.6 0 1 1 8.1 10.5" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M13.2 2.2 19.8 6.4 13.2 10.6z" fill="currentColor"/>`,

  /** An offer set aside for later — three z's, smallest last. */
  snooze: `
    <g stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M18.4 3.6h9.8l-9.8 9.4h9.8" stroke-width="2.8"/>
      <path d="M10.2 16h7.2l-7.2 6.8h7.2" stroke-width="2.4" opacity=".72"/>
      <path d="M3.4 24.4h5.2l-5.2 4.6h5.2" stroke-width="2.1" opacity=".5"/>
    </g>`,

  // ---- standing and stakes ----------------------------------------------
  crown: `
    <path d="M2.6 24 5.4 8.8l6.4 5.4L16 5.2l4.2 9 6.4-5.4L29.4 24z" fill="#e8b52e"/>
    <rect x="2.6" y="23.2" width="26.8" height="4.6" rx="1.7" fill="#c98f16"/>
    <circle cx="16" cy="18.4" r="1.9" fill="#fde68a"/>`,

  trophy: `
    <path d="M9 3.6h14v8.8c0 3.9-3.1 7-7 7s-7-3.1-7-7z" fill="#e8b52e"/>
    <path d="M9 6.6H5.2c0 4.6 1.9 7.1 4.8 7.7M23 6.6h3.8c0 4.6-1.9 7.1-4.8 7.7"
      stroke="#e8b52e" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="13.6" y="18.8" width="4.8" height="4.6" fill="#c98f16"/>
    <rect x="8.4" y="23" width="15.2" height="4.8" rx="1.8" fill="#c98f16"/>`,

  medalGold: medal('#d1495b', '#a9394a', '#d99a1e', '#f7c948'),
  medalSilver: medal('#5b6a86', '#46536c', '#8b96a4', '#ccd4dc'),
  medalBronze: medal('#7a5a3c', '#5f4530', '#a4652b', '#cf8b4a'),

  /** Karma. */
  heart: `
    <path d="M16 28 4.8 17.2C1.7 14.2 1.7 9.4 4.8 6.5a7.9 7.9 0 0 1 10.6 0l.6.6.6-.6a7.9 7.9 0 0 1 10.6 0c3.1 2.9 3.1 7.7 0 10.7z" fill="#e0435c"/>
    <path d="M9.2 8.6c-2 .4-3.3 1.8-3.7 3.9" stroke="#ff9dab" stroke-width="2.2" stroke-linecap="round"/>`,

  /** Out of the game. Eyes and teeth are holes, so it works on any surface. */
  skull: `
    <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"
      d="M16 2.6C9.2 2.6 3.7 8 3.7 14.6c0 3.9 1.9 7.4 4.9 9.5v3.1c0 1.3 1 2.3 2.3 2.3h10.2c1.3 0 2.3-1 2.3-2.3v-3.1c3-2.1 4.9-5.6 4.9-9.5C28.3 8 22.8 2.6 16 2.6Z${dot(11.1, 14.2, 3.3)}${dot(20.9, 14.2, 3.3)}M16 16.4l1.7 4.2h-3.4ZM12.9 25.1h1.9v4.4h-1.9ZM17.2 25.1h1.9v4.4h-1.9Z"/>`,

  /** Add a player. */
  people: `
    <circle cx="21" cy="10.8" r="4.5" fill="currentColor" opacity=".34"/>
    <path d="M13.6 25.8c0-4.2 3.3-7.5 7.4-7.5s7.4 3.3 7.4 7.5z" fill="currentColor" opacity=".34"/>
    <circle cx="12.4" cy="10.2" r="5.5" fill="currentColor"/>
    <path d="M2.8 27.4c0-5.3 4.3-9.4 9.6-9.4s9.6 4.1 9.6 9.4z" fill="currentColor"/>`,

  /** Build: a tower crane with its load swinging. */
  crane: `
    <path d="M2.8 4.6h26.4V8H2.8z" fill="currentColor"/>
    <rect x="25.4" y="8" width="3.8" height="3.6" fill="currentColor" opacity=".5"/>
    <rect x="13.4" y="8" width="5.2" height="17.2" fill="currentColor" opacity=".32"/>
    <path d="M8.4 8v6.2" stroke="currentColor" stroke-width="1.8"/>
    <rect x="4.9" y="14.2" width="7" height="5.6" rx="1.3" fill="currentColor"/>
    <path d="M8.6 28.6 12.2 25h7.6l3.6 3.6z" fill="currentColor"/>`,

  /** The get-out-of-prison card: a stub with a star and a perforation. */
  ticket: `
    <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"
      d="${rr(2.4, 8.4, 27.2, 15.2, 3)}${star5(10.6, 16, 4.7, 2.1)}${dot(21.2, 12.2, 1.1)}${dot(21.2, 16, 1.1)}${dot(21.2, 19.8, 1.1)}"/>`,

  // ---- places and things -------------------------------------------------
  globe: `
    <circle cx="16" cy="16" r="12.9" fill="currentColor" opacity=".26"/>
    <g stroke="currentColor" stroke-width="2">
      <circle cx="16" cy="16" r="12.9"/>
      <path d="M3.1 16h25.8"/>
      <path d="M16 3.1c3.6 3.5 5.7 8 5.7 12.9S19.6 25.4 16 28.9c-3.6-3.5-5.7-8-5.7-12.9S12.4 6.6 16 3.1z"/>
    </g>`,

  /** Same mark as the Surprise tile, so help reads as part of the same deck. */
  question: `
    <circle cx="16" cy="16" r="13" fill="currentColor" opacity=".26"/>
    <path d="M12.2 12.4c0-2.2 1.7-3.7 3.9-3.7 2.1 0 3.8 1.4 3.8 3.4 0 1.7-1 2.5-2.2 3.3-1.1.8-1.6 1.4-1.6 2.6v.6"
      stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="16.1" cy="23.2" r="1.9" fill="currentColor"/>`,

  /** The airport tile's plane, in ink, for buttons and chips. */
  plane: `<path d="${PLANE}" fill="currentColor"/>`,

  /** Table style. The board takes the theme's ink; the paints keep their own. */
  palette: `
    <path d="M16 2.8C8.2 2.8 1.9 8.7 1.9 16S8.2 29.2 16 29.2c2 0 3.4-1.4 3.4-3.2 0-.9-.4-1.7-1-2.3-.5-.6-.8-1.3-.8-2.1 0-1.8 1.5-3.2 3.3-3.2h1.6c4.2 0 7.6-3.1 7.6-7.3 0-4.9-6.3-8.3-15.1-8.3z"
      fill="currentColor" opacity=".24"/>
    <circle cx="9.2" cy="12.6" r="2.6" fill="#e0435c"/>
    <circle cx="15.6" cy="8.4" r="2.6" fill="#f5c542"/>
    <circle cx="22.2" cy="11" r="2.6" fill="#4fbb80"/>
    <circle cx="7.4" cy="20.2" r="2.6" fill="#5aa2e8"/>`,

  moon: `
    <path d="M13.6 3.2a12.9 12.9 0 1 0 15.2 15.2A11.3 11.3 0 0 1 13.6 3.2z" fill="#6f7fd4"/>
    <circle cx="10.4" cy="19.6" r="2.2" fill="#a8b4ee"/>
    <circle cx="15.8" cy="24.4" r="1.4" fill="#a8b4ee"/>`,

  /** The store. */
  bag: `
    <path d="M11 11.4V9.6a5 5 0 0 1 10 0v1.8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M4.4 10.6h23.2l1.6 16a2.4 2.4 0 0 1-2.4 2.6H5.2a2.4 2.4 0 0 1-2.4-2.6z" fill="currentColor"/>`,

  key: `
    <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"
      d="${dot(11.2, 11.2, 7.2)}${dot(11.2, 11.2, 2.8)}"/>
    <g stroke="currentColor" stroke-width="3" stroke-linecap="round">
      <path d="M15.8 15.8 27.6 27.6"/>
      <path d="M20.6 22.2 23.9 18.9M23.8 25.4 26.6 22.6"/>
    </g>`,

  shuffle: `
    <g stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2.6 8.6h4.8l12.8 14.8h5"/>
      <path d="M2.6 23.4h4.8l4.4-5.1M17.6 13.2l2.6-4.6h5"/>
    </g>
    <path d="M23.4 3.8 30 8.6l-6.6 4.8z" fill="currentColor"/>
    <path d="M23.4 18.6 30 23.4l-6.6 4.8z" fill="currentColor"/>`,

  /** Standings, net worth, anything counted. */
  chart: `
    <rect x="3" y="17.2" width="6.4" height="11.6" rx="1.6" fill="currentColor" opacity=".34"/>
    <rect x="12.8" y="11" width="6.4" height="17.8" rx="1.6" fill="currentColor" opacity=".62"/>
    <rect x="22.6" y="4.4" width="6.4" height="24.4" rx="1.6" fill="currentColor"/>`,

  /** Vacation, chip-sized: the corner tile's palm on a sandbar. */
  island: `
    <path d="M5.6 23.6c0-3.1 4.6-5.6 10.4-5.6s10.4 2.5 10.4 5.6z" fill="#f0cd88"/>
    <path d="M15.2 19.4 14.2 10" stroke="#a16207" stroke-width="2.3" stroke-linecap="round"/>
    <path d="M14.2 9.6c-3.4-2.2-7.3-1.4-8.7 1 2.8-.6 5 .2 6.4 1.6z" fill="#22c55e"/>
    <path d="M14.2 9.6c-.7-3.8 1.5-7.1 4.4-7.5-1.8 2-2.4 4.4-2.2 6.4z" fill="#16a34a"/>
    <path d="M14.2 9.6c3.6-1.4 7.2.4 8.2 3-2.4-1.4-4.8-1.6-6.8-.9z" fill="#22c55e"/>
    <path d="M2 27c2.3-1.8 4.7-1.8 7 0s4.7 1.8 7 0 4.7-1.8 7 0 3.5 1.2 5 0"
      stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>`,

  // ---- money moving ------------------------------------------------------
  cash: note(2, 7.5, 28, 17),

  /** A payment: the same note, leaving. */
  payment: `
    <path d="M10.4 14.2C7.6 8.8 4 5.8.2 5.6c-.2 5 2.9 9 8.6 10.6z" fill="#a3d6bd"/>
    <path d="M21.6 14.2c2.8-5.4 6.4-8.4 10.2-8.6.2 5-2.9 9-8.6 10.6z" fill="#a3d6bd"/>
    ${note(7, 11, 18, 12.4)}`,

  chat: `
    <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"
      d="${rr(2.4, 4.6, 27.2, 18.6, 5)}${dot(10, 13.9, 2)}${dot(16, 13.9, 2)}${dot(22, 13.9, 2)}"/>
    <path d="M9.6 21.4h6.6l-4 7.4z" fill="currentColor"/>`,

  /** Two arrows passing each other: one pile goes up, the other comes down.
      The handshake glyph reads as "trading" but not as "these two swap", and
      turned on its side it read as neither. */
  swap: `
    <path d="M11.4 26.4V9.2" stroke="currentColor" stroke-width="2.9" stroke-linecap="round"/>
    <path d="M6.3 14 11.4 8.2 16.5 14" stroke="currentColor" stroke-width="2.9"
      stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M20.6 5.6v17.2" stroke="currentColor" stroke-width="2.9" stroke-linecap="round"/>
    <path d="M15.5 18 20.6 23.8 25.7 18" stroke="currentColor" stroke-width="2.9"
      stroke-linecap="round" stroke-linejoin="round"/>`,

  /** Two strokes, drawn rather than typed — the multiplication sign is not
      a glyph this app owns, and an emoji cross is not one either. */
  close: `
    <path d="M8.6 8.6 23.4 23.4M23.4 8.6 8.6 23.4" stroke="currentColor"
      stroke-width="3.1" stroke-linecap="round"/>`,

  /** A utility, and a hint — the same bulb serves both. */
  bulb: `
    <path d="M16 2.8c-5.3 0-9.4 4-9.4 9 0 3.4 1.9 5.7 3.5 7.4 1 1.1 1.6 2 1.8 3.2h8.2c.2-1.2.8-2.1 1.8-3.2 1.6-1.7 3.5-4 3.5-7.4 0-5-4.1-9-9.4-9z" fill="#f5c542"/>
    <rect x="11.6" y="23.6" width="8.8" height="2.8" rx="1.4" fill="#9a8149"/>
    <rect x="12.8" y="26.8" width="6.4" height="2.6" rx="1.3" fill="#9a8149"/>
    <path d="M13.4 11.8 16 16.2l2.6-4.4" stroke="#fdf0c4" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,

  // ---- the rest ----------------------------------------------------------
  warning: `
    <path d="M14.1 4.5 2.5 24.3a2.2 2.2 0 0 0 1.9 3.3h23.2a2.2 2.2 0 0 0 1.9-3.3L17.9 4.5a2.2 2.2 0 0 0-3.8 0z" fill="#f0a92c"/>
    <path d="M16 11.4v7.4" stroke="#3d2a05" stroke-width="2.8" stroke-linecap="round"/>
    <circle cx="16" cy="23.2" r="1.8" fill="#3d2a05"/>`,

  /** Treasure, chip-sized: the corner tile's chest with a carry handle. */
  toolbox: `
    <path d="M11.6 9V7.4c0-1.2 1-2.2 2.2-2.2h4.4c1.2 0 2.2 1 2.2 2.2V9" stroke="#8a5a12" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="2.4" y="9" width="27.2" height="17.6" rx="2.6" fill="#d97b0f"/>
    <rect x="2.4" y="14.4" width="27.2" height="4" fill="#f0a336"/>
    <rect x="13.4" y="12.4" width="5.2" height="8.4" rx="1.4" fill="#7c3f06"/>`,

  /** A team. */
  shield: `
    <path d="M16 2.6 28.4 7v9.5c0 6.3-4.7 11.1-12.4 13.2C8.3 27.6 3.6 22.8 3.6 16.5V7z" fill="currentColor" opacity=".3"/>
    <path d="M16 7.4 23.9 10.2v5.9c0 4.3-3.1 7.5-7.9 9-4.8-1.5-7.9-4.7-7.9-9v-5.9z" fill="currentColor"/>`,

  /** Leave the table. */
  door: `
    <path d="M3.4 4.4h10a2 2 0 0 1 2 2v19.2a2 2 0 0 1-2 2h-10z" fill="currentColor" opacity=".32"/>
    <circle cx="11.8" cy="16" r="1.5" fill="currentColor"/>
    <g stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 16h10.4"/>
      <path d="M23.6 11 28.6 16l-5 5"/>
    </g>`,

  /** A folded paper map — pick a country, pick a board. */
  map: `
    <path d="M11 4.4 2.4 7.6v20l8.6-3.2z" fill="currentColor" opacity=".32"/>
    <path d="M11 4.4 21 7.9v20L11 24.4z" fill="currentColor"/>
    <path d="M21 7.9 29.6 4.6v20L21 27.9z" fill="currentColor" opacity=".32"/>`,

  /** Balance: a fair trade, a fair split. */
  scales: `
    <g stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
      <path d="M16 6.6v21M6.6 28.4h18.8M3.4 9.2h25.2"/>
    </g>
    <circle cx="16" cy="9.2" r="2.6" fill="currentColor"/>
    <path d="M1.4 13.6h11.4L7.1 21z" fill="currentColor" opacity=".4"/>
    <path d="M19.2 13.6h11.4L24.9 21z" fill="currentColor" opacity=".4"/>`,

  /** Something new, something lucky. */
  sparkle: `
    <path d="M14.4 2.4c1 6.4 3.1 8.5 9.5 9.5-6.4 1-8.5 3.1-9.5 9.5-1-6.4-3.1-8.5-9.5-9.5 6.4-1 8.5-3.1 9.5-9.5z" fill="#f5c542"/>
    <path d="M24.2 19.2c.5 3.3 1.6 4.4 4.9 4.9-3.3.5-4.4 1.6-4.9 4.9-.5-3.3-1.6-4.4-4.9-4.9 3.3-.5 4.4-1.6 4.9-4.9z" fill="#fbe08a"/>`,

  /** The bot badge. Eyes and mouth are holes so it reads on any chip colour. */
  robot: `
    <circle cx="16" cy="3" r="2" fill="currentColor"/>
    <path d="M16 3.4v4.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"
      d="${rr(4.2, 7.6, 23.6, 19, 5)}${dot(11.4, 15.2, 2.5)}${dot(20.6, 15.2, 2.5)}M11.2 20.4h9.6v2.7h-9.6Z"/>
    <rect x="0.8" y="12.8" width="2.8" height="7" rx="1.4" fill="currentColor" opacity=".5"/>
    <rect x="28.4" y="12.8" width="2.8" height="7" rx="1.4" fill="currentColor" opacity=".5"/>`,
};

/**
 * Glyphs that keep a colour of their own on every table, in every mode.
 * Everything else paints with currentColor and inherits its parent's ink.
 * `palette` is the one hybrid: the board is ink, the paints are paint.
 */
export const INHERENT_COLOUR = new Set([
  'start', 'prison', 'vacation', 'gotoprison', 'treasure', 'surprise', 'tax', 'refund',
  'airport', 'bolt', 'droplet', 'flame', 'sun', 'turbine', 'house', 'hotel',
  'coin', 'crown', 'trophy', 'medalGold', 'medalSilver', 'medalBronze', 'heart',
  'police', 'moon', 'island', 'cash', 'payment', 'bulb', 'warning', 'toolbox', 'sparkle',
]);

/** Every glyph name, for anyone building a picker or a sanity page. */
export const ICON_NAMES = Object.keys(BODY);

/** The drawings as standalone SVG strings — what board.js has always consumed. */
export const ART = Object.fromEntries(Object.entries(BODY).map(([k, v]) => [k, svg(v)]));

/** Utility tiles carry an emoji in the map data — map it onto the drawn set. */
const UTILITY_ART = { '⚡': 'bolt', '🚰': 'droplet', '💧': 'droplet', '🛢️': 'flame', '☀️': 'sun', '🌬️': 'turbine' };

/** The glyph name behind a utility tile's emoji, for use with `icon()`. */
export const utilityName = (mark) => (UTILITY_ART[mark] ? UTILITY_ART[mark] : 'bolt');
export const utilityArt = (mark) => ART[utilityName(mark)];

const warned = new Set();
const px = (size) => (typeof size === 'number' ? `${size}px` : size);

/**
 * One glyph, ready to drop into markup: `icon('coin')`, `icon('coin', 22)`,
 * `icon('trade', '1.4em', 'accent')`.
 *
 * Size is optional — without it the CSS `.ico` class sizes the glyph to the
 * text beside it, which is what most call sites want. Pass a number for pixels
 * or any CSS length as a string.
 *
 * The glyph is marked aria-hidden because it is decoration next to a label; a
 * button whose only content is a glyph needs its own aria-label.
 */
export function icon(name, size, cls = '') {
  const body = BODY[name];
  if (!body) {
    // Loud once, so a typo in a call site shows up without flooding the console.
    if (!warned.has(name)) { warned.add(name); console.warn(`icons: no glyph named "${name}"`); }
    return '';
  }
  const dim = size == null ? '' : ` style="width:${px(size)};height:${px(size)}"`;
  return `<svg viewBox="0 0 32 32" fill="none" class="ico${cls ? ` ${cls}` : ''}"${dim}` +
    ` aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

// A colour arrives from server data, so only shapes that can't escape the
// attribute are allowed through; anything else falls back to the theme's ink.
const SAFE_COLOUR = /^(#[0-9a-f]{3,8}|currentColor|var\(--[\w-]+\)|rgba?\([\d.,\s%]+\))$/i;

/**
 * The banner a board group flies instead of a flag emoji.
 *
 * Country-flag emoji don't render at all on Windows and look like a different
 * vendor's artwork everywhere else, so a group's identity is carried by its own
 * colour instead: one drawn pennant, tinted per group, the same on every OS.
 * The pole is ink; the cloth is the group's colour with a darker fold, which
 * gives two readable tones out of any hue the server sends.
 */
export function groupBanner(colour, size, cls = '') {
  const cloth = SAFE_COLOUR.test(String(colour || '')) ? colour : 'currentColor';
  const body = `
    <g opacity=".55">
      <path d="M7.4 4.6v24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="7.4" cy="3.2" r="2" fill="currentColor"/>
    </g>
    <path d="M8.6 5.2h19.4v17.2l-9.7-5.6-9.7 5.6z" fill="${cloth}"/>
    <path d="M18.3 5.2H28v17.2l-9.7-5.6z" fill="#000" opacity=".2"/>`;
  const dim = size == null ? '' : ` style="width:${px(size)};height:${px(size)}"`;
  return `<svg viewBox="0 0 32 32" fill="none" class="ico${cls ? ` ${cls}` : ''}"${dim}` +
    ` aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

// ------------------------------------------------------------------ flags --
// Country flags, drawn rather than typed. Flag emoji are a pair of regional
// indicator letters, and Windows ships no glyph for them at all — those players
// saw two empty boxes where the board's flag belonged. These are simplified to
// read at 13px: the right colours, the right layout, no fine detail nobody can
// see anyway.

const flag = (body) =>
  `<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#fff"/>${body}` +
  `<rect x="1" y="6" width="30" height="20" rx="2.5" fill="none" stroke="#000" stroke-opacity=".22"/>`;

// Exported, like CIRCLE_FLAG_ART below, only so tools/gen-flags-swift.mjs can
// turn the flags the iOS app has no hand-drawn port of into Swift. The page
// itself goes through groupFlag() and circleFlag().
export const FLAG_ART = {
  '\u{1F1EE}\u{1F1F3}': flag(`<rect x="1" y="6" width="30" height="6.7" rx="2.5" fill="#f93"/>
    <rect x="1" y="12.7" width="30" height="6.6" fill="#fff"/>
    <rect x="1" y="19.3" width="30" height="6.7" rx="2.5" fill="#138808"/>
    <circle cx="16" cy="16" r="2.7" fill="none" stroke="#046" stroke-width="1.1"/>`),
  '\u{1F1EC}\u{1F1E7}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#012169"/>
    <path d="M1 6 31 26M31 6 1 26" stroke="#fff" stroke-width="4.4"/>
    <path d="M1 6 31 26M31 6 1 26" stroke="#c8102e" stroke-width="2"/>
    <path d="M16 6v20M1 16h30" stroke="#fff" stroke-width="6.6"/>
    <path d="M16 6v20M1 16h30" stroke="#c8102e" stroke-width="3.6"/>`),
  '\u{1F1FA}\u{1F1F8}': flag(`<g fill="#b31942">
      <rect x="1" y="6" width="30" height="2.85"/><rect x="1" y="11.7" width="30" height="2.85"/>
      <rect x="1" y="17.4" width="30" height="2.85"/><rect x="1" y="23.1" width="30" height="2.9"/></g>
    <rect x="1" y="6" width="13" height="11.4" fill="#0a3161"/>
    <g fill="#fff"><circle cx="4.5" cy="9" r=".9"/><circle cx="8" cy="9" r=".9"/><circle cx="11.5" cy="9" r=".9"/>
      <circle cx="6.2" cy="12" r=".9"/><circle cx="9.8" cy="12" r=".9"/>
      <circle cx="4.5" cy="15" r=".9"/><circle cx="8" cy="15" r=".9"/><circle cx="11.5" cy="15" r=".9"/></g>`),
  '\u{1F1E7}\u{1F1F7}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#009c3b"/>
    <path d="M16 8 28.5 16 16 24 3.5 16z" fill="#ffdf00"/>
    <circle cx="16" cy="16" r="4.4" fill="#002776"/>
    <path d="M11.9 14.6a12 12 0 0 1 8.3 2.2" stroke="#fff" stroke-width="1.1" fill="none"/>`),
  '\u{1F1E9}\u{1F1EA}': flag(`<rect x="1" y="6" width="30" height="6.7" rx="2.5" fill="#000"/>
    <rect x="1" y="12.7" width="30" height="6.6" fill="#d00"/>
    <rect x="1" y="19.3" width="30" height="6.7" rx="2.5" fill="#ffce00"/>`),
  '\u{1F1EB}\u{1F1F7}': flag(`<rect x="1" y="6" width="10" height="20" rx="2.5" fill="#0055a4"/>
    <rect x="11" y="6" width="10" height="20" fill="#fff"/>
    <rect x="21" y="6" width="10" height="20" rx="2.5" fill="#ef4135"/>`),
  '\u{1F1EE}\u{1F1F9}': flag(`<rect x="1" y="6" width="10" height="20" rx="2.5" fill="#009246"/>
    <rect x="11" y="6" width="10" height="20" fill="#fff"/>
    <rect x="21" y="6" width="10" height="20" rx="2.5" fill="#ce2b37"/>`),
  '\u{1F1E8}\u{1F1F3}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#de2910"/>
    <path d="M7.5 9.4 8.6 12.6 11.9 12.6 9.2 14.6 10.3 17.8 7.5 15.8 4.7 17.8 5.8 14.6 3.1 12.6 6.4 12.6z" fill="#ffde00"/>
    <g fill="#ffde00"><circle cx="14" cy="9.4" r="1"/><circle cx="16.6" cy="11.6" r="1"/>
      <circle cx="16.6" cy="14.8" r="1"/><circle cx="14" cy="17" r="1"/></g>`),
  '\u{1F1EF}\u{1F1F5}': flag(`<circle cx="16" cy="16" r="6" fill="#bc002d"/>`),
  '\u{1F1EE}\u{1F1F1}': flag(`<rect x="1" y="7.6" width="30" height="3" fill="#0038b8"/>
    <rect x="1" y="21.4" width="30" height="3" fill="#0038b8"/>
    <path d="M16 11.4 19.4 17.3 12.6 17.3z" fill="none" stroke="#0038b8" stroke-width="1.1"/>
    <path d="M16 20.6 12.6 14.7 19.4 14.7z" fill="none" stroke="#0038b8" stroke-width="1.1"/>`),
  '\u{1F1E8}\u{1F1E6}': flag(`<rect x="1" y="6" width="8" height="20" rx="2.5" fill="#d80621"/>
    <rect x="23" y="6" width="8" height="20" rx="2.5" fill="#d80621"/>
    <path d="M16 10.5 17.5 14 20 13 18.8 16.5 21 17.2 16.8 19.4 17.2 21.5 16 21 14.8 21.5 15.2 19.4 11 17.2 13.2 16.5 12 13 14.5 14z" fill="#d80621"/>`),
  '\u{1F1F9}\u{1F1F7}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#e30a17"/>
    <circle cx="14" cy="16" r="5" fill="#fff"/><circle cx="15.8" cy="16" r="4" fill="#e30a17"/>
    <path d="M21 13.2 22 15.4 24.3 15.4 22.5 16.9 23.2 19.1 21 17.8 18.8 19.1 19.5 16.9 17.7 15.4 20 15.4z" fill="#fff"/>`),
  '\u{1F1F7}\u{1F1F4}': flag(`<rect x="1" y="6" width="10" height="20" rx="2.5" fill="#002b7f"/>
    <rect x="11" y="6" width="10" height="20" fill="#fcd116"/>
    <rect x="21" y="6" width="10" height="20" rx="2.5" fill="#ce1126"/>`),
  '\u{1F1EA}\u{1F1F8}': flag(`<rect x="1" y="6" width="30" height="5" rx="2.5" fill="#aa151b"/>
    <rect x="1" y="11" width="30" height="10" fill="#f1bf00"/>
    <rect x="1" y="21" width="30" height="5" rx="2.5" fill="#aa151b"/>
    <rect x="7" y="13.4" width="4.6" height="5.2" rx="1" fill="#aa151b" opacity=".85"/>`),
  '\u{1F1E6}\u{1F1FA}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#012169"/>
    <rect x="1" y="6" width="13" height="9.6" fill="#012169"/>
    <path d="M1 6 14 15.6M14 6 1 15.6" stroke="#fff" stroke-width="2.2"/>
    <path d="M7.5 6v9.6M1 10.8h13" stroke="#fff" stroke-width="3"/>
    <path d="M7.5 6v9.6M1 10.8h13" stroke="#c8102e" stroke-width="1.6"/>
    <g fill="#fff"><circle cx="7.5" cy="21" r="1.9"/><circle cx="22" cy="11" r=".9"/>
      <circle cx="25.5" cy="14.5" r=".9"/><circle cx="22" cy="18.5" r=".9"/>
      <circle cx="19" cy="15" r=".9"/><circle cx="25" cy="20.5" r=".7"/></g>`),
  '\u{1F1EE}\u{1F1EA}': flag(`<rect x="1" y="6" width="10" height="20" rx="2.5" fill="#169b62"/>
    <rect x="11" y="6" width="10" height="20" fill="#fff"/>
    <rect x="21" y="6" width="10" height="20" rx="2.5" fill="#ff883e"/>`),
  // The continent boards' countries. Each is laid out the same way as the
  // flags above; where an emblem is too fine for 13px it is reduced to its
  // silhouette, never dropped, because the emblem is often all that tells two
  // tricolours apart.

  // Africa.
  // Ethiopia — green, yellow, red, and the blue disc with its gold pentagram
  // and five rays.
  '\u{1F1EA}\u{1F1F9}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#078930"/>
    <rect x="1" y="12.67" width="30" height="13.33" rx="2.5" fill="#da121a"/>
    <rect x="1" y="12.67" width="30" height="6.66" fill="#fcdd09"/>
    <circle cx="16" cy="16" r="5.6" fill="#0f47af"/>
    <path d="M17 14.77L18.7 12.43M17.62 16.68L20.37 17.57M16 17.85L16 20.75M14.38 16.68L11.63 17.57M15 14.77L13.3 12.43" stroke="#fcdd09" stroke-width=".6" fill="none"/>
    <path d="M16 11.95L18.47 19.55L12.01 14.85L19.99 14.85L13.53 19.55Z" stroke="#fcdd09" stroke-width=".85" fill="none"/>`),
  // Ghana — red, gold, green, with the black star filling the gold band.
  '\u{1F1EC}\u{1F1ED}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#ce1126"/>
    <rect x="1" y="12.67" width="30" height="13.33" rx="2.5" fill="#006b3f"/>
    <rect x="1" y="12.67" width="30" height="6.66" fill="#fcd116"/>
    <path d="${star5(16, 16.35, 3.6, 1.38)}" fill="#000"/>`),
  // Tanzania — the gold-edged black diagonal as polygons, so the rounded
  // corners it runs into stay round.
  '\u{1F1F9}\u{1F1FF}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#fcd116"/>
    <path d="M1 21.24V8.5A2.5 2.5 0 0 1 3.5 6H23.86Z" fill="#1eb53a"/>
    <path d="M8.14 26H28.5A2.5 2.5 0 0 0 31 23.5V10.76Z" fill="#00a3dd"/>
    <path d="M1 22.74V23.5A2.5 2.5 0 0 0 3.5 26H5.88L31 9.26V8.5A2.5 2.5 0 0 0 28.5 6H26.12Z" fill="#000"/>`),
  // Kenya — black, red, green with white fimbriation (6:1:6:1:6), the Maasai
  // shield on crossed spears.
  '\u{1F1F0}\u{1F1EA}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#000"/>
    <rect x="1" y="12" width="30" height="14" rx="2.5" fill="#060"/>
    <rect x="1" y="12" width="30" height="8" fill="#fff"/>
    <rect x="1" y="13" width="30" height="6" fill="#b00"/>
    <path d="M12.4 23.06L18.46 11.18M19.6 23.06L13.54 11.18" stroke="#fff" stroke-width="0.53" fill="none"/>
    <path d="M18.46 11.18Q20.38 10.16 20.08 8Q18.15 9.02 18.46 11.18ZM13.54 11.18Q13.85 9.02 11.92 8Q11.62 10.16 13.54 11.18Z" fill="#fff"/>
    <path d="M16 9.8Q21.68 16 16 22.2Q10.32 16 16 9.8Z" fill="#000"/>
    <path d="M16 10.13Q19.56 16 16 21.87Q12.44 16 16 10.13Z" fill="#b00"/>
    <path d="M16 11.25Q16.59 16 16 20.75Q15.41 16 16 11.25Z" fill="#fff"/>
    <ellipse cx="16" cy="16" rx="0.76" ry="1.39" fill="#fff"/>`),
  // Morocco — red, with the green interlaced pentagram, thickened so the line
  // survives at 20px.
  '\u{1F1F2}\u{1F1E6}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#c1272d"/>
    <path d="M16 11.4L18.94 20.45L11.24 14.85L20.76 14.85L13.06 20.45Z" stroke="#006233" stroke-width=".95" fill="none"/>`),
  // Nigeria — green, white, green.
  '\u{1F1F3}\u{1F1EC}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#008751"/>
    <rect x="11" y="6" width="10" height="20" fill="#fff"/>`),
  // Egypt — red, white, black, and the gold Eagle of Saladin in the white band.
  '\u{1F1EA}\u{1F1EC}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#ce1126"/>
    <rect x="1" y="12.67" width="30" height="13.33" rx="2.5" fill="#000"/>
    <rect x="1" y="12.67" width="30" height="6.66" fill="#fff"/>
    <g fill="#c09300"><path d="M16 14.3L17.25 13.61Q18.62 13.33 19.42 14.58L19.59 18.17L18.96 17.66L18.51 18.29L17.94 17.72L17.43 18.29L16.91 17.72L16 17.77L15.09 17.72L14.57 18.29L14.06 17.72L13.49 18.29L13.04 17.66L12.41 18.17L12.58 14.58Q13.38 13.33 14.75 13.61Z"/>
    <circle cx="15.77" cy="13.44" r="0.71"/><path d="M15.14 13.16L14.29 13.61L15.2 13.9Z"/>
    <path d="M15.26 13.78L16.51 13.78L16.57 14.47L15.32 14.47Z"/>
    <rect x="15.03" y="17.83" width="0.4" height="0.8"/>
    <rect x="16.57" y="17.83" width="0.4" height="0.8"/>
    <rect x="13.95" y="18.52" width="4.1" height="0.63"/>
    <path d="M14.8 14.52H17.2V16.58Q17.2 17.72 16 18.17Q14.8 17.72 14.8 16.58Z"/></g>
    <path d="M15.12 14.84H16.88V16.58Q16.88 17.5 16 17.73Q15.12 17.5 15.12 16.58Z" fill="#fff"/>
    <path d="M15.12 14.84H15.7V17.66L15.12 17.03Z" fill="#ce1126"/>
    <path d="M16.3 14.84H16.88V17.03L16.3 17.66Z" fill="#000"/>`),
  // South Africa — the pall drawn as regions; white is the cloth itself showing
  // between them.
  '\u{1F1FF}\u{1F1E6}': flag(`<path d="M7.01 6H28.5A2.5 2.5 0 0 1 31 8.5V12.67H17.01Z" fill="#e03c31"/>
    <path d="M7.01 26H28.5A2.5 2.5 0 0 0 31 23.5V19.33H17.01Z" fill="#001489"/>
    <path d="M1 8.5A2.5 2.5 0 0 1 3.5 6H4.61L16.61 14H31V18H16.61L4.61 26H3.5A2.5 2.5 0 0 1 1 23.5Z" fill="#007749"/>
    <path d="M1 8.4L12.39 16L1 23.6Z" fill="#ffb81c"/><path d="M1 10.01L9.99 16L1 21.99Z" fill="#000"/>`),

  // Asia.
  // Vietnam — the gold star on red.
  '\u{1F1FB}\u{1F1F3}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#da251d"/>
    <path d="${star5(16, 16, 6, 2.29)}" fill="#ff0"/>`),
  // Indonesia — red over white.
  '\u{1F1EE}\u{1F1E9}': flag(`<rect x="1" y="6" width="30" height="12.5" rx="2.5" fill="#f00"/>
    <rect x="1" y="16" width="30" height="3" fill="#fff"/>`),
  // Thailand — red, white, a double-width blue, white, red.
  '\u{1F1F9}\u{1F1ED}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#a51931"/>
    <rect x="1" y="9.33" width="30" height="13.34" fill="#f4f5f8"/>
    <rect x="1" y="12.67" width="30" height="6.66" fill="#2d2a4a"/>`),
  // South Korea — the taeguk and its four trigrams, bars broken where the real
  // ones break.
  '\u{1F1F0}\u{1F1F7}': flag(`<path d="M11.84 13.23A5 5 0 0 1 20.16 18.77z" fill="#cd2e3a"/>
    <path d="M20.16 18.77A5 5 0 0 1 11.84 13.23z" fill="#0047a0"/>
    <circle cx="13.92" cy="14.61" r="2.5" fill="#cd2e3a"/>
    <circle cx="18.08" cy="17.39" r="2.5" fill="#0047a0"/>
    <path d="M8.56 14.04 11.33 9.88 10.54 9.36 7.77 13.52zM7.35 13.24 10.13 9.08 9.34 8.55 6.56 12.71zM6.15 12.44 8.92 8.28 8.13 7.75 5.36 11.91zM20.67 9.88 21.85 11.65 22.64 11.13 21.46 9.36zM22.26 12.28 23.44 14.04 24.23 13.52 23.05 11.75zM21.87 9.08 24.65 13.24 25.44 12.71 22.66 8.55zM23.08 8.28 24.26 10.04 25.05 9.52 23.87 7.75zM24.67 10.67 25.85 12.44 26.64 11.91 25.46 10.14zM11.33 22.12 8.56 17.96 7.77 18.48 10.54 22.64zM10.13 22.92 8.95 21.15 8.16 21.68 9.34 23.45zM8.53 20.53 7.35 18.76 6.56 19.29 7.74 21.05zM8.92 23.72 6.15 19.56 5.36 20.09 8.13 24.25zM23.44 17.96 22.26 19.72 23.05 20.25 24.23 18.48zM21.85 20.35 20.67 22.12 21.46 22.64 22.64 20.87zM24.65 18.76 23.47 20.53 24.26 21.05 25.44 19.29zM23.05 21.15 21.87 22.92 22.66 23.45 23.84 21.68zM25.85 19.56 24.67 21.33 25.46 21.86 26.64 20.09zM24.26 21.96 23.08 23.72 23.87 24.25 25.05 22.48z" fill="#000"/>`),
  // United Arab Emirates — green, white, black, and the red bar at the hoist.
  '\u{1F1E6}\u{1F1EA}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#000"/>
    <rect x="1" y="6" width="30" height="10" rx="2.5" fill="#00843d"/>
    <rect x="1" y="12.67" width="30" height="6.66" fill="#fff"/>
    <rect x="1" y="6" width="7.5" height="20" rx="2.5" fill="#c8102e"/>
    <rect x="4" y="6" width="4.5" height="20" fill="#c8102e"/>`),

  // Europe.
  // Portugal — green two-fifths, red three, the armillary sphere and shield on
  // the seam.
  '\u{1F1F5}\u{1F1F9}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#da291c"/>
    <rect x="1" y="6" width="12" height="20" rx="2.5" fill="#046a38"/>
    <rect x="10" y="6" width="3" height="20" fill="#046a38"/>
    <g stroke="#ffe900" fill="none"><circle cx="13" cy="16" r="4.4" stroke-width="0.87"/>
    <ellipse cx="13" cy="16.37" rx="4.4" ry="1.43" stroke-width="0.68"/></g>
    <path d="M10.77 13.4H15.23V16.74A2.23 2.23 0 0 1 10.77 16.74Z" fill="#da291c"/>
    <path d="M11.51 14.14H14.49V16.74A1.49 1.49 0 0 1 11.51 16.74Z" fill="#fff"/>
    <g fill="#002d72"><rect x="12.72" y="14.48" width="0.56" height="0.68" rx="0.19"/>
    <rect x="11.82" y="15.66" width="0.56" height="0.68" rx="0.19"/>
    <rect x="12.72" y="15.66" width="0.56" height="0.68" rx="0.19"/>
    <rect x="13.62" y="15.66" width="0.56" height="0.68" rx="0.19"/>
    <rect x="12.72" y="16.84" width="0.56" height="0.68" rx="0.19"/></g>`),
  // Greece — nine stripes; the white cross in a canton five stripes square.
  '\u{1F1EC}\u{1F1F7}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#0d5eaf"/>
    <g fill="#fff"><rect x="12.11" y="8.22" width="18.89" height="2.22"/>
    <rect x="12.11" y="12.67" width="18.89" height="2.22"/>
    <rect x="1" y="17.11" width="30" height="2.22"/><rect x="1" y="21.56" width="30" height="2.22"/>
    <rect x="5.44" y="6" width="2.22" height="11.11"/>
    <rect x="1" y="10.44" width="11.11" height="2.22"/></g>`),
  // Netherlands — red, white, blue.
  '\u{1F1F3}\u{1F1F1}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#ae1c28"/>
    <rect x="1" y="12.67" width="30" height="13.33" rx="2.5" fill="#21468b"/>
    <rect x="1" y="12.67" width="30" height="6.66" fill="#fff"/>`),

  // North America.
  // Jamaica — the gold saltire, green above and below, black at the sides.
  '\u{1F1EF}\u{1F1F2}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#fed100"/>
    <path d="M3.7 6h24.6L16 14.2zM3.7 26h24.6L16 17.8z" fill="#009b3a"/>
    <path d="M1 7.8v16.4L13.3 16zM31 7.8v16.4L18.7 16z" fill="#000"/>`),
  // Cuba — five stripes and the red triangle with its white star.
  '\u{1F1E8}\u{1F1FA}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#002a8f"/>
    <path d="M1 10h30v4H1zM1 18h30v4H1z" fill="#fff"/>
    <path d="M1 8.5A2.5 2.5 0 0 1 1.94 6.54L18.32 16 1.94 25.46A2.5 2.5 0 0 1 1 23.5z" fill="#cf142b"/>
    <path d="${star5(6.77, 16, 3.1, 1.18)}" fill="#fff"/>`),
  // Dominican Republic — the white cross; the arms shrink to shield, branches
  // and ribbons.
  '\u{1F1E9}\u{1F1F4}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#002d62"/>
    <path d="M18 6h10.5a2.5 2.5 0 0 1 2.5 2.5V14H18zM1 18h13v8H3.5A2.5 2.5 0 0 1 1 23.5z" fill="#ce1126"/>
    <path d="M14 6h4v20h-4zM1 14h30v4H1z" fill="#fff"/>
    <path d="M15.5 17.67A2.6 2.6 0 0 1 14.57 14.57" fill="none" stroke="#2E7D32" stroke-width=".46" stroke-linecap="round"/>
    <path d="M16.5 17.67A2.6 2.6 0 0 0 17.43 14.57" fill="none" stroke="#2E7D32" stroke-width=".46" stroke-linecap="round"/>
    <path d="M15.07 14.82H16.93V16.06A.93 1.12 0 0 1 15.07 16.06z" fill="#002D62"/>
    <path d="M16 14.82H16.93V15.94H16z" fill="#CE1126"/>
    <path d="M15.07 15.94H16V17.18A.93 1.12 0 0 1 15.07 16.06z" fill="#CE1126"/>
    <path d="M16 14.82 16 17.18" fill="none" stroke="#FFFFFF" stroke-width=".28"/>
    <path d="M15.07 15.94 16.93 15.94" fill="none" stroke="#FFFFFF" stroke-width=".28"/>
    <path d="M14.82 14.33 17.18 14.33" fill="none" stroke="#002D62" stroke-width=".37" stroke-linecap="round"/>
    <path d="M15.01 17.86 16.99 17.86" fill="none" stroke="#CE1126" stroke-width=".37" stroke-linecap="round"/>`),
  // Costa Rica — 1:1:2:1:1 stripes, the arms in a white oval toward the hoist.
  '\u{1F1E8}\u{1F1F7}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#002b7f"/>
    <rect x="1" y="9.33" width="30" height="13.34" fill="#fff"/>
    <rect x="1" y="12.67" width="30" height="6.66" fill="#ce1126"/>
    <ellipse cx="9.6" cy="16" rx="2.11" ry="2.79" fill="#FFFFFF"/>
    <path d="M8.51 14.16 10.69 14.16" fill="none" stroke="#002B7F" stroke-width=".48" stroke-linecap="round"/>
    <path d="M8.04 17.09 8.72 15.86 9.19 16.54 9.6 15.18 10.01 16.54 10.48 15.86 11.16 17.09z" fill="#3A8A2E"/>
    <path d="M8.04 17.09 11.16 17.09 10.89 17.77 8.31 17.77z" fill="#1F5FAF"/>`),
  // Panama — quarters with a blue star and a red one.
  '\u{1F1F5}\u{1F1E6}': flag(`<path d="M16 6h12.5a2.5 2.5 0 0 1 2.5 2.5V16H16z" fill="#d21034"/>
    <path d="M1 16h15v10H3.5A2.5 2.5 0 0 1 1 23.5z" fill="#005293"/>
    <path d="${star5(8.5, 11, 2.7, 1.03)}" fill="#005293"/>
    <path d="${star5(23.5, 21, 2.7, 1.03)}" fill="#d21034"/>`),
  // Mexico — the eagle on its nopal as one silhouette, inside the wreath.
  '\u{1F1F2}\u{1F1FD}': flag(`<path d="M11 6H3.5A2.5 2.5 0 0 0 1 8.5v15A2.5 2.5 0 0 0 3.5 26H11z" fill="#006847"/>
    <path d="M21 6h7.5a2.5 2.5 0 0 1 2.5 2.5v15a2.5 2.5 0 0 1-2.5 2.5H21z" fill="#ce1126"/>
    <path d="M12.9 17.27A3.1 3.1 0 0 0 19.1 17.27" fill="none" stroke="#2E6B2A" stroke-width=".86" stroke-linecap="round"/>
    <ellipse cx="16.07" cy="19.14" rx=".97" ry=".61" fill="#4C8C2B"/>
    <ellipse cx="15.21" cy="18.42" rx=".72" ry=".54" fill="#4C8C2B"/>
    <ellipse cx="16.94" cy="18.35" rx=".68" ry=".5" fill="#4C8C2B"/>
    <path d="M13.05 13.96 13.34 13.24 13.98 12.73 14.78 12.73 15.28 13.16 15.5 13.67 15.93 12.37 16.65 11.36 17.01 10.72 17.37 11.51 18.02 11 18.16 11.94 18.95 11.65 18.81 12.66 19.6 12.66 19.24 13.45 19.74 13.81 18.38 15.04 18.09 15.97 19.02 17.05 18.38 17.48 17.58 17.12 16.79 17.05 16.86 17.77 15.42 17.77 15.78 16.84 14.92 16.12 14.42 15.04 13.98 14.32 13.55 14.17 13.34 14.53z" fill="#7B4A20"/>
    <path d="M13.41 14.03 12.9 14.68 13.34 15.18 12.98 15.83" fill="none" stroke="#2E6B2A" stroke-width=".4" stroke-linecap="round" stroke-linejoin="round"/>`),

  // South America.
  // Bolivia — red, yellow, green, and the condor over the oval of Cerro Rico.
  '\u{1F1E7}\u{1F1F4}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#f9e300"/>
    <path d="M1 12.67V8.5a2.5 2.5 0 0 1 2.5-2.5h25a2.5 2.5 0 0 1 2.5 2.5V12.67z" fill="#d52b1e"/>
    <path d="M1 19.33h30v4.17a2.5 2.5 0 0 1-2.5 2.5h-25A2.5 2.5 0 0 1 1 23.5z" fill="#007934"/>
    <path d="M14.74 15.72 12.43 14.81" fill="none" stroke="#D52B1E" stroke-width=".66"/>
    <path d="M14.74 17.05 12.43 16.14" fill="none" stroke="#007934" stroke-width=".66"/>
    <path d="M17.26 15.72 19.57 14.81" fill="none" stroke="#D52B1E" stroke-width=".66"/>
    <path d="M17.26 17.05 19.57 16.14" fill="none" stroke="#007934" stroke-width=".66"/>
    <ellipse cx="16" cy="16.84" rx="1.96" ry="2.38" fill="#8BCDEF" stroke="#1D4F9F" stroke-width=".56"/>
    <path d="M14.53 18.8 16 15.72 17.47 18.8z" fill="#A86F32"/>
    <circle cx="16.91" cy="15.65" r=".42" fill="#F9E300"/>
    <path d="M12.92 13.83 14.04 13.48 15.16 13.76 15.65 13.2 15.86 12.71 16.14 12.71 16.35 13.2 16.84 13.76 17.96 13.48 19.08 13.83 18.24 14.25 16.98 14.46 16.42 15.02 15.58 15.02 15.02 14.46 13.76 14.25z" fill="#262626"/>`),
  // Ecuador — the yellow half over blue and red, the condor over Chimborazo.
  '\u{1F1EA}\u{1F1E8}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#034ea2"/>
    <path d="M1 16V8.5a2.5 2.5 0 0 1 2.5-2.5h25a2.5 2.5 0 0 1 2.5 2.5V16z" fill="#ffdd00"/>
    <path d="M1 21h30v2.5a2.5 2.5 0 0 1-2.5 2.5h-25A2.5 2.5 0 0 1 1 23.5z" fill="#ed1c24"/>
    <ellipse cx="16" cy="17.41" rx="2.16" ry="2.74" fill="#8BCDEF" stroke="#C9971C" stroke-width=".58"/>
    <path d="M14.06 19.36 15.93 16.19 17.94 19.36z" fill="#5F7F45"/>
    <path d="M15.42 17.05 15.93 16.19 16.43 17.05z" fill="#FFFFFF"/>
    <circle cx="17.15" cy="15.97" r=".54" fill="#FFDD00"/>
    <path d="M11.82 13.09 13.26 12.66 14.78 12.95 15.42 12.3 15.71 11.72 16.29 11.72 16.58 12.3 17.22 12.95 18.74 12.66 20.18 13.09 19.46 13.45 19.74 13.74 18.59 13.88 18.74 14.24 17.08 14.24 16.5 15.11 15.5 15.11 14.92 14.24 13.26 14.24 13.41 13.88 12.26 13.74 12.54 13.45z" fill="#262626"/>`),
  // Uruguay — nine stripes and the Sun of May in the canton.
  '\u{1F1FA}\u{1F1FE}': flag(`<path d="M12.11 8.22H31v2.22H12.11zM12.11 12.67H31v2.22H12.11zM1 17.11h30v2.22H1zM1 21.56h30v2.22H1z" fill="#0038a8"/>
    <path d="M6.56 7.46 7 9.35 8.13 7.77 7.81 9.69 9.46 8.66 8.43 10.31 10.35 9.99 8.77 11.12 10.66 11.56 8.77 12 10.35 13.13 8.43 12.81 9.46 14.46 7.81 13.43 8.13 15.35 7 13.77 6.56 15.66 6.12 13.77 4.99 15.35 5.31 13.43 3.66 14.46 4.69 12.81 2.77 13.13 4.35 12 2.46 11.56 4.35 11.12 2.77 9.99 4.69 10.31 3.66 8.66 5.31 9.69 4.99 7.77 6.12 9.35z" fill="#fcd116" stroke="#7b3f00" stroke-width=".25" stroke-linejoin="round"/>
    <circle cx="6.56" cy="11.56" r="1.8" fill="#fcd116" stroke="#7b3f00" stroke-width=".3"/>`),
  // Peru — red, white, red: the civil flag, which is what the emoji shows.
  '\u{1F1F5}\u{1F1EA}': flag(`<path d="M11 6H3.5A2.5 2.5 0 0 0 1 8.5v15A2.5 2.5 0 0 0 3.5 26H11zM21 6h7.5a2.5 2.5 0 0 1 2.5 2.5v15a2.5 2.5 0 0 1-2.5 2.5H21z" fill="#d91023"/>`),
  // Colombia — yellow the top half, blue and red a quarter each.
  '\u{1F1E8}\u{1F1F4}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#003893"/>
    <path d="M1 16V8.5a2.5 2.5 0 0 1 2.5-2.5h25a2.5 2.5 0 0 1 2.5 2.5V16z" fill="#fcd116"/>
    <path d="M1 21h30v2.5a2.5 2.5 0 0 1-2.5 2.5h-25A2.5 2.5 0 0 1 1 23.5z" fill="#ce1126"/>`),
  // Chile — white over red, the blue canton with its star.
  '\u{1F1E8}\u{1F1F1}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#d52b1e"/>
    <path d="M1 16V8.5a2.5 2.5 0 0 1 2.5-2.5h25a2.5 2.5 0 0 1 2.5 2.5V16z" fill="#fff"/>
    <path d="M1 8.5a2.5 2.5 0 0 1 2.5-2.5H11v10H1z" fill="#0039a6"/>
    <path d="${star5(6, 11.2, 2.5, .96)}" fill="#fff"/>`),
  // Argentina — celeste, white, celeste, and the Sun of May.
  '\u{1F1E6}\u{1F1F7}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#74acdf"/>
    <rect x="1" y="12.67" width="30" height="6.66" fill="#fff"/>
    <path d="M16 12.8 16.37 14.12 17.22 13.04 17.07 14.4 18.26 13.74 17.6 14.93 18.96 14.78 17.88 15.63 19.2 16 17.88 16.37 18.96 17.22 17.6 17.07 18.26 18.26 17.07 17.6 17.22 18.96 16.37 17.88 16 19.2 15.63 17.88 14.78 18.96 14.93 17.6 13.74 18.26 14.4 17.07 13.04 17.22 14.12 16.37 12.8 16 14.12 15.63 13.04 14.78 14.4 14.93 13.74 13.74 14.93 14.4 14.78 13.04 15.63 14.12z" fill="#f6b40e" stroke="#85340a" stroke-width=".2" stroke-linejoin="round"/>
    <circle cx="16" cy="16" r="1.4" fill="#f6b40e" stroke="#85340a" stroke-width=".25"/>`),

  // Oceania.
  // Samoa — red, the Southern Cross in a blue canton.
  '\u{1F1FC}\u{1F1F8}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#ce1126"/>
    <path d="M1 8.5a2.5 2.5 0 0 1 2.5-2.5H16v10H1z" fill="#002b7f"/>
    <g fill="#fff"><path d="${star5(8.1, 8.6, 1.15, 0.44)}"/><path d="${star5(5.6, 11, 1.15, 0.44)}"/>
    <path d="${star5(10.8, 10, 1.15, 0.44)}"/><path d="${star5(9.5, 12.2, 0.72, 0.28)}"/>
    <path d="${star5(8.1, 14.4, 1.15, 0.44)}"/></g>`),
  // Tonga — red, the red cross in a white canton.
  '\u{1F1F9}\u{1F1F4}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#c10000"/>
    <path d="M1 8.5a2.5 2.5 0 0 1 2.5-2.5H15v10H1z" fill="#fff"/>
    <rect x="6.85" y="7.5" width="2.3" height="7" fill="#c10000"/>
    <rect x="4.5" y="9.85" width="7" height="2.3" fill="#c10000"/>`),
  // Solomon Islands — blue and green split by the gold diagonal, five stars in
  // the blue.
  '\u{1F1F8}\u{1F1E7}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#215b33"/>
    <path d="M3.5 6 28.5 6 28.99 6.05 29.46 6.19 29.89 6.42 30.1 6.6 1.9 25.4 1.73 25.27 1.42 24.89 1.19 24.46 1.05 23.99 1 23.5 1 8.5 1.05 8.01 1.19 7.54 1.42 7.11 1.73 6.73 2.11 6.42 2.54 6.19 3.01 6.05z" fill="#0051ba"/>
    <path d="M2.73 25.87 30.65 7.25 30.58 7.11 30.27 6.73 29.89 6.42 29.46 6.19 29.27 6.13 1.35 24.75 1.42 24.89 1.73 25.27 2.11 25.58 2.54 25.81z" fill="#fcd116"/>
    <g fill="#fff"><path d="${star5(3.4, 9.1, 1.3, 0.5)}"/><path d="${star5(9.8, 9.1, 1.3, 0.5)}"/>
    <path d="${star5(6.6, 12.4, 1.3, 0.5)}"/><path d="${star5(3.4, 15.7, 1.3, 0.5)}"/>
    <path d="${star5(9.8, 15.7, 1.3, 0.5)}"/></g>`),
  // Vanuatu — red over green, the black-edged gold Y, the tusk in the black
  // triangle.
  '\u{1F1FB}\u{1F1FA}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#009543"/>
    <rect x="1" y="6" width="30" height="12.5" rx="2.5" fill="#d21034"/>
    <rect x="1" y="16" width="30" height="3" fill="#009543"/>
    <path d="M3.6 6 13.79 14.35 31 14.35 31 17.65 13.79 17.65 3.6 26 3.5 26 3.01 25.95 2.54 25.81 2.11 25.58 1.73 25.27 1.42 24.89 1.19 24.46 1.05 23.99 1 23.5 1 8.5 1.05 8.01 1.19 7.54 1.42 7.11 1.73 6.73 2.11 6.42 2.54 6.19 3.01 6.05 3.5 6z" fill="#000"/>
    <path d="M2.32 6.31 13.41 15.4 31 15.4 31 16.6 13.41 16.6 2.32 25.69 2.11 25.58 1.73 25.27 1.42 24.89 1.19 24.46 1.05 23.99 1 23.5 1 8.5 1.05 8.01 1.19 7.54 1.42 7.11 1.73 6.73 2.11 6.42z" fill="#fdce12"/>
    <path d="M1.42 7.12 12.25 16 1.42 24.88 1.19 24.46 1.05 23.99 1 23.5 1 8.5 1.05 8.01 1.19 7.54z" fill="#000"/>
    <path d="M4.67 17.98A2.05 2.05 0 1 1 6.88 17.18Q5.92 17.96 5.61 16.86" fill="none" stroke="#fdce12" stroke-width="0.8" stroke-linecap="round"/>
    <path d="M4.18 14.97 6.02 16.82M6.22 14.97 4.38 16.82" fill="none" stroke="#fdce12" stroke-width="0.5" stroke-linecap="round"/>`),
  // Papua New Guinea — the Southern Cross on the black, the bird of paradise on
  // the red.
  '\u{1F1F5}\u{1F1EC}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#000"/>
    <path d="M3.5 6 28.5 6 28.99 6.05 29.46 6.19 29.89 6.42 30.27 6.73 30.58 7.11 30.81 7.54 30.95 8.01 31 8.5 31 23.5 30.95 23.99 30.81 24.46 30.58 24.89 30.27 25.27 30.1 25.4 1.9 6.6 2.11 6.42 2.54 6.19 3.01 6.05z" fill="#ce1126"/>
    <g fill="#fff"><path d="${star5(7, 13.4, 1.3, 0.5)}"/><path d="${star5(3.9, 17.6, 1.3, 0.5)}"/>
    <path d="${star5(10.4, 17.6, 1.3, 0.5)}"/><path d="${star5(8.7, 20.5, 0.75, 0.29)}"/>
    <path d="${star5(7, 23, 1.3, 0.5)}"/></g>
    <path d="M19.74 9.93L20.37 9.43Q20.91 9.03 21.45 9.47Q21.9 9.93 22.26 10.02Q22.35 8.08 23.7 6.64L23.84 7.67L24.55 7.22L24.46 8.35L25.28 8.13L24.91 9.25L25.68 9.34L24.83 10.51Q24.42 11.32 23.97 11.95Q23.43 12.85 22.62 12.85L22.17 14.38L21.5 13.44L20.69 14.61L20.46 13.44L19.25 14.15L19.7 13.07L18.39 13.03L19.92 12.22Q21.18 11.59 21.5 10.78Q21 10.24 20.46 10.24z" fill="#fcd116"/>
    <path d="M23.88 12.04Q27.57 13.84 27.03 16.63Q26.67 17.89 25.68 17.35M23.43 12.58Q26.13 14.38 25.82 16.09Q25.55 16.99 24.96 16.54" fill="none" stroke="#fcd116" stroke-width=".42" stroke-linecap="round"/>`),
  // Fiji — light blue, the Union canton, and the shield in the fly.
  '\u{1F1EB}\u{1F1EF}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#68bfe5"/>
    <path d="M1 8.5a2.5 2.5 0 0 1 2.5-2.5H14v9.6H1z" fill="#012169"/>
    <path d="M1.2 7.52 12.15 15.6 14 15.6 14 14.23 2.94 6.07 2.54 6.19 2.11 6.42 1.73 6.73 1.42 7.11zM12.15 6 1 14.23 1 15.6 2.85 15.6 14 7.37 14 6z" fill="#fff"/>
    <path d="M2.23 6.35 14 15.04 14 15.6 13.24 15.6 1.54 6.95zM13.24 6 14 6 14 6.56 1.76 15.6 1 15.6 1 15.04z" fill="#c8102e"/>
    <rect x="6" y="6" width="3" height="9.6" fill="#fff"/>
    <rect x="1" y="9.3" width="13" height="3" fill="#fff"/>
    <rect x="6.7" y="6" width="1.6" height="9.6" fill="#c8102e"/>
    <rect x="1" y="10" width="13" height="1.6" fill="#c8102e"/>
    <path d="M19.9 10.6H27.1V16.43Q27.1 20.28 23.5 21.6Q19.9 20.28 19.9 16.43z" fill="#fff"/>
    <rect x="19.9" y="10.6" width="7.2" height="2.7" fill="#ce1126"/>
    <ellipse cx="23.5" cy="11.95" rx="1.73" ry="0.7" fill="#fcd116"/>
    <rect x="22.95" y="13.3" width="1.1" height="7.4" fill="#ce1126"/>
    <rect x="19.9" y="16.07" width="7.2" height="1.1" fill="#ce1126"/>`),
  // New Zealand — the Union canton and four red stars edged in white.
  '\u{1F1F3}\u{1F1FF}': flag(`<rect x="1" y="6" width="30" height="20" rx="2.5" fill="#012169"/>
    <path d="M1.2 7.52 12.15 15.6 14 15.6 14 14.23 2.94 6.07 2.54 6.19 2.11 6.42 1.73 6.73 1.42 7.11zM12.15 6 1 14.23 1 15.6 2.85 15.6 14 7.37 14 6z" fill="#fff"/>
    <path d="M2.23 6.35 14 15.04 14 15.6 13.24 15.6 1.54 6.95zM13.24 6 14 6 14 6.56 1.76 15.6 1 15.6 1 15.04z" fill="#c8102e"/>
    <rect x="6" y="6" width="3" height="9.6" fill="#fff"/>
    <rect x="1" y="9.3" width="13" height="3" fill="#fff"/>
    <rect x="6.7" y="6" width="1.6" height="9.6" fill="#c8102e"/>
    <rect x="1" y="10" width="13" height="1.6" fill="#c8102e"/>
    <path d="${star5(23.5, 9.4, 2.2, 0.84)}" fill="#fff"/>
    <path d="${star5(19.9, 15.4, 2.2, 0.84)}" fill="#fff"/>
    <path d="${star5(27, 13.6, 2, 0.76)}" fill="#fff"/>
    <path d="${star5(23.5, 21.8, 2.35, 0.9)}" fill="#fff"/>
    <path d="${star5(23.5, 9.4, 1.55, 0.59)}" fill="#c8102e"/>
    <path d="${star5(19.9, 15.4, 1.55, 0.59)}" fill="#c8102e"/>
    <path d="${star5(27, 13.6, 1.35, 0.52)}" fill="#c8102e"/>
    <path d="${star5(23.5, 21.8, 1.7, 0.65)}" fill="#c8102e"/>`),
};

// ---------------------------------------------------------- circle flags --
// The medallion used to take the rectangular cloth above and blow it up to
// 170% so the disc cropped it — and a cropped rectangle never reads as a
// coin: cantons slide half out of frame, diagonals lose their corners,
// everything looks amputated. So every flag above is laid out AGAIN,
// natively for a disc, the way circle-flag icon sets do it: stripes run edge
// to edge of the circle, cantons and emblems are re-composed for the round
// frame, and a shared enamel finish — a top-light gloss and a faint inner rim
// — makes the disc read as a struck coin rather than a flat sticker. Same
// 32x32 canvas; the visible world is the circle at (16,16), radius 15.

const f2 = (n) => +n.toFixed(2);

/** An n-point star as one filled path. rot -90 aims the first point up. */
const star = (cx, cy, points, R, rot = -90, inner = .45) => {
  const step = 180 / points;
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const a = ((rot + i * step) * Math.PI) / 180;
    const r = i % 2 ? R * inner : R;
    d += `${i ? 'L' : 'M'}${f2(cx + r * Math.cos(a))} ${f2(cy + r * Math.sin(a))}`;
  }
  return `<path d="${d}z"/>`;
};

// Horizontal / vertical thirds that fill the whole square (the clip rounds
// them off). First colour paints the full disc so band seams cannot show.
const discH3 = (a, b, c) => `<rect width="32" height="32" fill="${a}"/>` +
  `<rect y="10.67" width="32" height="21.33" fill="${b}"/>` +
  `<rect y="21.33" width="32" height="10.67" fill="${c}"/>`;
const discV3 = (a, b, c) => `<rect width="32" height="32" fill="${a}"/>` +
  `<rect x="10.67" width="21.33" height="32" fill="${b}"/>` +
  `<rect x="21.33" width="10.67" height="32" fill="${c}"/>`;

// The Union cross layout, reused at full disc size by GB and at canton size
// by AU. Widths follow the real sheet: St George red = 1/5 of height with a
// fimbriation of 1/15 each side; the saltire white band 1/5, red 1/15.
const unionJack = (w, h, dw, dr, cw, cr) =>
  `<path d="M0 0 ${w} ${h}M${w} 0 0 ${h}" stroke="#fff" stroke-width="${dw}"/>` +
  `<path d="M0 0 ${w} ${h}M${w} 0 0 ${h}" stroke="#C8102E" stroke-width="${dr}"/>` +
  `<path d="M${w / 2} 0V${h}M0 ${h / 2}H${w}" stroke="#fff" stroke-width="${cw}"/>` +
  `<path d="M${w / 2} 0V${h}M0 ${h / 2}H${w}" stroke="#C8102E" stroke-width="${cr}"/>`;

// India's chakra: a real 24-spoke wheel, stroke-weighted so the spokes fuse
// into a legible ring texture at 22px and separate into spokes at 64px.
const chakra = (() => {
  let spokes = '';
  for (let i = 0; i < 24; i++) {
    const a = (i * Math.PI) / 12;
    spokes += `<line x1="${f2(16 + 1.2 * Math.cos(a))}" y1="${f2(16 + 1.2 * Math.sin(a))}"` +
      ` x2="${f2(16 + 3.5 * Math.cos(a))}" y2="${f2(16 + 3.5 * Math.sin(a))}"/>`;
  }
  return `<g stroke="#000080" fill="none"><circle cx="16" cy="16" r="4" stroke-width="1.1"/>` +
    `<g stroke-width=".72">${spokes}</g></g><circle cx="16" cy="16" r="1" fill="#000080"/>`;
})();

// Canada's maple leaf: the right half is declared once — top spike, two upper
// spikes, side point, lower spike, base point, stem — and mirrored across
// x=16, which keeps the leaf symmetric however much the points get tuned.
const mapleLeaf = (() => {
  const half = [
    [16, 7.8], [17.1, 10.4], [19.2, 9.6], [18.6, 12.1], [21.4, 11.4],
    [20.3, 13.8], [22.9, 13.9], [21.2, 16.1], [22.6, 18.3], [19.3, 17.9],
    [19.8, 20.3], [16.7, 19.4], [16.7, 23.2],
  ];
  const right = half.map(([x, y]) => `${x} ${y}`);
  const left = half.slice(1).reverse().map(([x, y]) => `${f2(32 - x)} ${y}`);
  return `<path d="M${right.join(' L')} L${left.join(' L')}z" fill="#D80621"/>`;
})();

// China's constellation: the big star plus four minors, each minor rotated so
// one point aims at the big star's centre, as the real sheet demands.
const cnStars = (() => {
  const minors = [[17.5, 6.3], [20.6, 9.4], [20.6, 13.6], [17.5, 16.7]]
    .map(([x, y]) => star(x, y, 5, 1.7, (Math.atan2(11 - y, 10 - x) * 180) / Math.PI, .5))
    .join('');
  return `<g fill="#FFFF00">${star(10, 11, 5, 4.6, -90, .382)}${minors}</g>`;
})();

export const CIRCLE_FLAG_ART = {
  // India — saffron/white/green thirds, navy chakra sized 3/4 of the band.
  '\u{1F1EE}\u{1F1F3}': discH3('#FF9933', '#FFFFFF', '#138808') + chakra,
  // United Kingdom — the full Union flag composed for the disc.
  '\u{1F1EC}\u{1F1E7}': `<rect width="32" height="32" fill="#012169"/>` +
    unionJack(32, 32, 6, 2, 10, 6),
  // United States — seven explicit stripes (red AND white drawn), navy canton
  // three stripes deep with a dot-grid star field; a white stripe runs under
  // the canton's lower edge exactly as on the real flag.
  '\u{1F1FA}\u{1F1F8}': `<g fill="#B31942"><rect width="32" height="4.57"/>` +
    `<rect y="9.14" width="32" height="4.57"/><rect y="18.29" width="32" height="4.57"/>` +
    `<rect y="27.43" width="32" height="4.57"/></g>` +
    `<g fill="#FFFFFF"><rect y="4.57" width="32" height="4.57"/>` +
    `<rect y="13.71" width="32" height="4.58"/><rect y="22.86" width="32" height="4.57"/></g>` +
    `<rect width="14.5" height="13.71" fill="#0A3161"/>` +
    `<g fill="#FFFFFF"><circle cx="2.5" cy="2.4" r=".8"/><circle cx="5.7" cy="2.4" r=".8"/>` +
    `<circle cx="8.9" cy="2.4" r=".8"/><circle cx="12.1" cy="2.4" r=".8"/>` +
    `<circle cx="4.1" cy="5.2" r=".8"/><circle cx="7.3" cy="5.2" r=".8"/><circle cx="10.5" cy="5.2" r=".8"/>` +
    `<circle cx="2.5" cy="8" r=".8"/><circle cx="5.7" cy="8" r=".8"/>` +
    `<circle cx="8.9" cy="8" r=".8"/><circle cx="12.1" cy="8" r=".8"/>` +
    `<circle cx="4.1" cy="10.8" r=".8"/><circle cx="7.3" cy="10.8" r=".8"/><circle cx="10.5" cy="10.8" r=".8"/></g>`,
  // Brazil — rhombus points reach near the rim; globe with the white band.
  '\u{1F1E7}\u{1F1F7}': `<rect width="32" height="32" fill="#009C3B"/>` +
    `<path d="M16 3.6 28.4 16 16 28.4 3.6 16z" fill="#FFDF00"/>` +
    `<circle cx="16" cy="16" r="5.5" fill="#012169"/>` +
    `<path d="M10.9 14.5 A 12.5 12.5 0 0 1 21.2 16.9" stroke="#fff" stroke-width="1.4" fill="none"/>`,
  // Germany.
  '\u{1F1E9}\u{1F1EA}': discH3('#000000', '#DD0000', '#FFCE00'),
  // France.
  '\u{1F1EB}\u{1F1F7}': discV3('#002654', '#FFFFFF', '#CE1126'),
  // Italy.
  '\u{1F1EE}\u{1F1F9}': discV3('#008C45', '#F4F5F0', '#CD212A'),
  // China — constellation shifted toward centre so it sits whole in the disc.
  '\u{1F1E8}\u{1F1F3}': `<rect width="32" height="32" fill="#EE1C25"/>` + cnStars,
  // Japan — the sun, centred.
  '\u{1F1EF}\u{1F1F5}': `<rect width="32" height="32" fill="#FFFFFF"/>` +
    `<circle cx="16" cy="16" r="8.4" fill="#BC002D"/>`,
  // Israel — two stripes edge to edge, Magen David as two stroked triangles.
  '\u{1F1EE}\u{1F1F1}': `<rect width="32" height="32" fill="#FFFFFF"/>` +
    `<rect y="5.2" width="32" height="3.8" fill="#0038B8"/>` +
    `<rect y="23" width="32" height="3.8" fill="#0038B8"/>` +
    `<g stroke="#0038B8" stroke-width="1.25" fill="none">` +
    `<path d="M16 10.9 20.42 18.55 11.58 18.55z"/>` +
    `<path d="M16 21.1 11.58 13.45 20.42 13.45z"/></g>`,
  // Canada — red bars to the rim, the mirrored maple leaf on the pale.
  '\u{1F1E8}\u{1F1E6}': `<rect width="32" height="32" fill="#FFFFFF"/>` +
    `<rect width="8" height="32" fill="#D80621"/>` +
    `<rect x="24" width="8" height="32" fill="#D80621"/>` + mapleLeaf,
  // Turkey — crescent from two offset circles, star with a point toward it.
  '\u{1F1F9}\u{1F1F7}': `<rect width="32" height="32" fill="#E30A17"/>` +
    `<circle cx="12.5" cy="16" r="7" fill="#FFFFFF"/>` +
    `<circle cx="14.4" cy="16" r="5.7" fill="#E30A17"/>` +
    `<g fill="#FFFFFF">${star(22.5, 16, 5, 3.2, 180, .382)}</g>`,
  // Romania.
  '\u{1F1F7}\u{1F1F4}': discV3('#002B7F', '#FCD116', '#CE1126'),
  // Spain — 1:2:1 bands, the crest hinted toward the hoist.
  '\u{1F1EA}\u{1F1F8}': `<rect width="32" height="32" fill="#F1BF00"/>` +
    `<rect width="32" height="8" fill="#AA151B"/>` +
    `<rect y="24" width="32" height="8" fill="#AA151B"/>` +
    `<g fill="#AA151B" opacity=".9"><rect x="8.3" y="11.9" width="3.2" height="1" rx=".4"/>` +
    `<path d="M7.5 13.4h4.8v3.4a2.4 2.4 0 0 1-4.8 0z"/></g>`,
  // Australia — Union canton upper-left, Commonwealth star below it, the
  // Southern Cross (four 7-point majors + 5-point epsilon) on the fly half.
  '\u{1F1E6}\u{1F1FA}': `<rect width="32" height="32" fill="#012169"/>` +
    unionJack(16, 14, 2.6, 1.1, 4.6, 2.6) +
    `<g fill="#FFFFFF">${star(8, 22, 7, 3.4, -90, .5)}` +
    `${star(24, 4.5, 7, 1.9, -90, .5)}${star(24, 27, 7, 1.9, -90, .5)}` +
    `${star(20, 12.5, 7, 1.9, -90, .5)}${star(27.5, 10.5, 7, 1.9, -90, .5)}` +
    `${star(25, 17.5, 5, 1.2, -90, .5)}</g>`,
  // Ireland.
  '\u{1F1EE}\u{1F1EA}': discV3('#169B62', '#FFFFFF', '#FF883E'),
  // The continent boards' countries, re-composed for the disc like the
  // flags above: bands to the rim, cantons grown into a quarter, emblems
  // pulled in far enough that the rim never shaves them.

  // Africa.
  // Ethiopia — thirds edge to edge, the blue disc reaching well into green and
  // red.
  '\u{1F1EA}\u{1F1F9}': discH3('#078930', '#FCDD09', '#DA121A') +
    `<circle cx="16" cy="16" r="8.8" fill="#0F47AF"/>` +
    `<path d="M17.53 14.15L20.23 10.43M18.47 17.05L22.85 18.47M16 18.85L16 23.45M13.53 17.05L9.15 18.47M14.47 14.15L11.77 10.43" stroke="#FCDD09" stroke-width=".9" fill="none"/>` +
    `<path d="M16 9.55L19.94 21.67L9.63 14.18L22.37 14.18L12.06 21.67Z" stroke="#FCDD09" stroke-width="1.3" fill="none"/>`,
  // Ghana — the black star sized to the gold band, dropped a hair so it sits
  // optically centred.
  '\u{1F1EC}\u{1F1ED}': discH3('#CE1126', '#FCD116', '#006B3F') +
    `<g fill="#000000">${star(16, 16.5, 5, 5.6, -90, .382)}</g>`,
  // Tanzania — the diagonal laid corner to corner through the centre; the clip
  // trims the band ends.
  '\u{1F1F9}\u{1F1FF}': `<rect width="32" height="32" fill="#1EB53A"/>` +
    `<path d="M32 0V32H0z" fill="#00A3DD"/>` +
    `<path d="M-4 36 36 -4" stroke="#FCD116" stroke-width="12"/>` +
    `<path d="M-4 36 36 -4" stroke="#000000" stroke-width="8.2"/>`,
  // Kenya — the shield stands the full height of the red band and beyond,
  // spears crossing behind it.
  '\u{1F1F0}\u{1F1EA}': `<rect width="32" height="32" fill="#000000"/>` +
    `<rect y="9.6" width="32" height="12.8" fill="#FFFFFF"/>` +
    `<rect y="11.2" width="32" height="9.6" fill="#BB0000"/>` +
    `<rect y="22.4" width="32" height="9.6" fill="#006600"/>` +
    `<path d="M10.55 26.69L19.72 8.69M21.45 26.69L12.28 8.69" stroke="#FFFFFF" stroke-width="0.95" fill="none"/>` +
    `<path d="M19.72 8.69Q22.64 7.15 22.17 3.88Q19.26 5.43 19.72 8.69ZM12.28 8.69Q12.74 5.43 9.83 3.88Q9.36 7.15 12.28 8.69Z" fill="#FFFFFF"/>` +
    `<path d="M16 6.6Q24.6 16 16 25.4Q7.4 16 16 6.6Z" fill="#000000"/>` +
    `<path d="M16 7.1Q21.4 16 16 24.9Q10.6 16 16 7.1Z" fill="#BB0000"/>` +
    `<path d="M16 8.8Q16.9 16 16 23.2Q15.1 16 16 8.8Z" fill="#FFFFFF"/>` +
    `<ellipse cx="16" cy="16" rx="1.15" ry="2.1" fill="#FFFFFF"/>`,
  // Morocco — the seal of Solomon, centred on the disc.
  '\u{1F1F2}\u{1F1E6}': `<rect width="32" height="32" fill="#C1272D"/>` +
    `<path d="M16 8.4L20.82 23.23L8.2 14.07L23.8 14.07L11.18 23.23Z" stroke="#006233" stroke-width="1.45" fill="none"/>`,
  // Nigeria.
  '\u{1F1F3}\u{1F1EC}': discV3('#008751', '#FFFFFF', '#008751'),
  // Egypt — the eagle, wings spread over its breast shield, standing on the
  // plinth.
  '\u{1F1EA}\u{1F1EC}': discH3('#CE1126', '#FFFFFF', '#000000') +
    `<g fill="#C09300"><path d="M16 13.09L18.09 11.96Q20.37 11.48 21.7 13.57L21.98 19.55L20.94 18.7L20.18 19.74L19.23 18.79L18.38 19.74L17.52 18.79L16 18.89L14.48 18.79L13.63 19.74L12.77 18.79L11.82 19.74L11.06 18.7L10.02 19.55L10.3 13.57Q11.63 11.48 13.91 11.96Z"/>` +
    `<circle cx="15.62" cy="11.67" r="1.19"/><path d="M14.57 11.2L13.15 11.96L14.67 12.43Z"/>` +
    `<path d="M14.77 12.24L16.86 12.24L16.95 13.38L14.86 13.38Z"/>` +
    `<rect x="14.38" y="18.98" width="0.66" height="1.33"/>` +
    `<rect x="16.95" y="18.98" width="0.66" height="1.33"/>` +
    `<rect x="12.58" y="20.13" width="6.84" height="1.04"/>` +
    `<path d="M14.01 13.47H18V16.89Q18 18.8 16 19.55Q14.01 18.8 14.01 16.89Z"/></g>` +
    `<path d="M14.53 14H17.47V16.89Q17.47 18.43 16 18.82Q14.53 18.43 14.53 16.89Z" fill="#FFFFFF"/>` +
    `<path d="M14.53 14H15.51V18.7L14.53 17.66Z" fill="#CE1126"/>` +
    `<path d="M16.49 14H17.47V17.66L16.49 18.7Z" fill="#000"/>`,
  // South Africa — the pall re-laid at 45° so the black triangle and its gold
  // edge sit inside the disc.
  '\u{1F1FF}\u{1F1E6}': `<rect width="32" height="16" fill="#E03C31"/>` +
    `<rect y="16" width="32" height="16" fill="#001489"/>` +
    `<path d="M-13 -14L17 16L-13 46M17 16H34" stroke="#FFFFFF" stroke-width="10.67" fill="none"/>` +
    `<path d="M-17.53 -14L12.47 16L-17.53 46Z" fill="#FFB81C"/>` +
    `<path d="M-20.54 -14L9.46 16L-20.54 46Z" fill="#000000"/>` +
    `<path d="M-13 -14L17 16L-13 46M17 16H34" stroke="#007749" stroke-width="6.4" fill="none"/>`,

  // Asia.
  // Vietnam — the gold star, dropped a little so its outline rather than its
  // centre point sits in the middle of the disc.
  '\u{1F1FB}\u{1F1F3}': `<rect width="32" height="32" fill="#DA251D"/>` +
    `<g fill="#FFFF00">${star(16, 16.8, 5, 9.2, -90, .382)}</g>`,
  // Indonesia — red over white, halved at the centre line.
  '\u{1F1EE}\u{1F1E9}': `<rect width="32" height="32" fill="#FFFFFF"/>` +
    `<rect width="32" height="16" fill="#FF0000"/>`,
  // Thailand — the 1:1:2:1:1 stripes over the full square, like discH3's
  // thirds.
  '\u{1F1F9}\u{1F1ED}': `<rect width="32" height="32" fill="#A51931"/>` +
    `<rect y="5.33" width="32" height="21.34" fill="#F4F5F8"/>` +
    `<rect y="10.67" width="32" height="10.66" fill="#2D2A4A"/>`,
  // South Korea — taeguk split along the flag's own diagonal (red bulging down
  // at the hoist, blue up at the fly), the four trigrams on the same diagonals:
  // ☰ upper hoist, ☵ upper fly, ☲ lower hoist, ☷ lower fly.
  '\u{1F1F0}\u{1F1F7}': `<rect width="32" height="32" fill="#FFFFFF"/>` +
    `<path d="M10.67 12.45A6.4 6.4 0 0 1 21.33 19.55z" fill="#CD2E3A"/>` +
    `<path d="M21.33 19.55A6.4 6.4 0 0 1 10.67 12.45z" fill="#0047A0"/>` +
    `<circle cx="13.34" cy="14.22" r="3.2" fill="#CD2E3A"/>` +
    `<circle cx="18.66" cy="17.78" r="3.2" fill="#0047A0"/>` +
    `<path d="M7.56 13.74 10.67 9.08 9.71 8.44 6.6 13.1zM6.11 12.77 9.21 8.11 8.25 7.47 5.15 12.13zM4.65 11.8 7.76 7.14 6.8 6.5 3.69 11.16zM21.33 9.08 22.65 11.06 23.61 10.42 22.29 8.44zM23.12 11.76 24.44 13.74 25.4 13.1 24.08 11.13zM22.79 8.11 25.89 12.77 26.85 12.13 23.75 7.47zM24.24 7.14 25.56 9.11 26.52 8.48 25.2 6.5zM26.03 9.82 27.35 11.8 28.31 11.16 26.99 9.18zM10.67 22.92 7.56 18.26 6.6 18.9 9.71 23.56zM9.21 23.89 7.89 21.91 6.94 22.55 8.25 24.53zM7.42 21.21 6.11 19.23 5.15 19.87 6.47 21.85zM7.76 24.86 4.65 20.2 3.69 20.84 6.8 25.5zM24.44 18.26 23.12 20.24 24.08 20.87 25.4 18.9zM22.65 20.94 21.33 22.92 22.29 23.56 23.61 21.58zM25.89 19.23 24.58 21.21 25.53 21.85 26.85 19.87zM24.11 21.91 22.79 23.89 23.75 24.53 25.06 22.55zM27.35 20.2 26.03 22.18 26.99 22.82 28.31 20.84zM25.56 22.89 24.24 24.86 25.2 25.5 26.52 23.52z" fill="#000000"/>`,
  // United Arab Emirates — green/white/black thirds, the red hoist bar widened
  // a touch past a quarter so the rim does not shave it to a sliver.
  '\u{1F1E6}\u{1F1EA}': discH3('#00843D', '#FFFFFF', '#000000') +
    `<rect width="9" height="32" fill="#C8102E"/>`,

  // Europe.
  // Portugal — the seam at two-fifths, the sphere and quinas centred on it.
  '\u{1F1F5}\u{1F1F9}': `<rect width="32" height="32" fill="#DA291C"/>` +
    `<rect width="12.8" height="32" fill="#046A38"/>` +
    `<g stroke="#FFE900" fill="none"><circle cx="12.8" cy="16" r="7.1" stroke-width="1.4"/>` +
    `<ellipse cx="12.8" cy="16.6" rx="7.1" ry="2.3" stroke-width="1.1"/></g>` +
    `<path d="M9.2 11.8H16.4V17.2A3.6 3.6 0 0 1 9.2 17.2Z" fill="#DA291C"/>` +
    `<g fill="#FFE900"><rect x="9.5" y="12.3" width="0.8" height="0.8"/>` +
    `<rect x="12.4" y="12.3" width="0.8" height="0.8"/>` +
    `<rect x="15.3" y="12.3" width="0.8" height="0.8"/>` +
    `<rect x="9.5" y="15.9" width="0.8" height="0.8"/>` +
    `<rect x="15.3" y="15.9" width="0.8" height="0.8"/>` +
    `<rect x="10.3" y="18.9" width="0.8" height="0.8"/>` +
    `<rect x="14.5" y="18.9" width="0.8" height="0.8"/></g>` +
    `<path d="M10.4 13H15.2V17.2A2.4 2.4 0 0 1 10.4 17.2Z" fill="#FFFFFF"/>` +
    `<g fill="#002D72"><rect x="12.35" y="13.55" width="0.9" height="1.1" rx="0.3"/>` +
    `<rect x="10.9" y="15.45" width="0.9" height="1.1" rx="0.3"/>` +
    `<rect x="12.35" y="15.45" width="0.9" height="1.1" rx="0.3"/>` +
    `<rect x="13.8" y="15.45" width="0.9" height="1.1" rx="0.3"/>` +
    `<rect x="12.35" y="17.35" width="0.9" height="1.1" rx="0.3"/></g>`,
  // Greece — stripes at their true ninths; the canton keeps its square so the
  // cross stays whole.
  '\u{1F1EC}\u{1F1F7}': `<rect width="32" height="32" fill="#0D5EAF"/>` +
    `<g fill="#FFFFFF"><rect x="17.78" y="3.56" width="14.22" height="3.55"/>` +
    `<rect x="17.78" y="10.67" width="14.22" height="3.55"/>` +
    `<rect y="17.78" width="32" height="3.55"/><rect y="24.89" width="32" height="3.55"/>` +
    `<rect x="7.11" width="3.56" height="17.78"/><rect y="7.11" width="17.78" height="3.56"/></g>`,
  // Netherlands.
  '\u{1F1F3}\u{1F1F1}': discH3('#AE1C28', '#FFFFFF', '#21468B'),

  // North America.
  // Jamaica — the gold saltire runs corner to corner of the square, so on the
  // disc it crosses at right angles; green above and below, black at the sides.
  '\u{1F1EF}\u{1F1F2}': `<rect width="32" height="32" fill="#FED100"/>` +
    `<path d="M3.54 0H28.46L16 12.46zM3.54 32H28.46L16 19.54z" fill="#009B3A"/>` +
    `<path d="M0 3.54V28.46L12.46 16zM32 3.54V28.46L19.54 16z" fill="#000000"/>`,
  // Cuba — five stripes to the rim, the red triangle cut short so its star
  // lands inside the disc rather than on the rim.
  '\u{1F1E8}\u{1F1FA}': `<rect width="32" height="32" fill="#002A8F"/>` +
    `<path d="M0 6.4h32v6.4H0zM0 19.2h32v6.4H0z" fill="#FFFFFF"/>` +
    `<path d="M0 0 20.5 16 0 32z" fill="#CF142B"/>` +
    `<g fill="#FFFFFF">${star(7.8, 16, 5, 4, -90, .382)}</g>`,
  // Dominican Republic — the white cross splits the disc into its four
  // quarters; the arms shrink to shield, branches and the two ribbons.
  '\u{1F1E9}\u{1F1F4}': `<rect width="32" height="32" fill="#002D62"/>` +
    `<path d="M19 0h13v13H19zM0 19h13v13H0z" fill="#CE1126"/>` +
    `<path d="M13 0h6v32h-6zM0 13h32v6H0z" fill="#FFFFFF"/>` +
    `<path d="M15.2 18.9A4.2 4.2 0 0 1 13.7 13.9" fill="none" stroke="#2E7D32" stroke-width=".75" stroke-linecap="round"/>` +
    `<path d="M16.8 18.9A4.2 4.2 0 0 0 18.3 13.9" fill="none" stroke="#2E7D32" stroke-width=".75" stroke-linecap="round"/>` +
    `<path d="M14.5 14.3H17.5V16.3A1.5 1.8 0 0 1 14.5 16.3z" fill="#002D62"/>` +
    `<path d="M16 14.3H17.5V16.1H16z" fill="#CE1126"/>` +
    `<path d="M14.5 16.1H16V18.1A1.5 1.8 0 0 1 14.5 16.3z" fill="#CE1126"/>` +
    `<path d="M16 14.3 16 18.1" fill="none" stroke="#FFFFFF" stroke-width=".45"/>` +
    `<path d="M14.5 16.1 17.5 16.1" fill="none" stroke="#FFFFFF" stroke-width=".45"/>` +
    `<path d="M14.1 13.5 17.9 13.5" fill="none" stroke="#002D62" stroke-width=".6" stroke-linecap="round"/>` +
    `<path d="M14.4 19.2 17.6 19.2" fill="none" stroke="#CE1126" stroke-width=".6" stroke-linecap="round"/>`,
  // Costa Rica — 1:1:2:1:1 stripes, the arms in their white oval on the red
  // band toward the hoist.
  '\u{1F1E8}\u{1F1F7}': `<rect width="32" height="32" fill="#002B7F"/>` +
    `<rect y="5.33" width="32" height="21.34" fill="#FFFFFF"/>` +
    `<rect y="10.67" width="32" height="10.66" fill="#CE1126"/>` +
    `<ellipse cx="11.4" cy="16" rx="3.1" ry="4.1" fill="#FFFFFF"/>` +
    `<path d="M9.8 13.3 13 13.3" fill="none" stroke="#002B7F" stroke-width=".7" stroke-linecap="round"/>` +
    `<path d="M9.1 17.6 10.1 15.8 10.8 16.8 11.4 14.8 12 16.8 12.7 15.8 13.7 17.6z" fill="#3A8A2E"/>` +
    `<path d="M9.1 17.6 13.7 17.6 13.3 18.6 9.5 18.6z" fill="#1F5FAF"/>`,
  // Panama — quarters meeting at the centre; each star sits at the centroid of
  // its visible quarter of the disc, not of the square.
  '\u{1F1F5}\u{1F1E6}': `<rect width="32" height="32" fill="#FFFFFF"/>` +
    `<rect x="16" width="16" height="16" fill="#D21034"/>` +
    `<rect y="16" width="16" height="16" fill="#005293"/>` +
    `<g fill="#005293">${star(9.6, 9.8, 5, 4, -90, .382)}</g>` +
    `<g fill="#D21034">${star(22.4, 22.6, 5, 4, -90, .382)}</g>`,
  // Mexico — green/white/red thirds; the eagle on its nopal inside the wreath,
  // drawn as one silhouette because the feathers are too fine to survive.
  '\u{1F1F2}\u{1F1FD}': discV3('#006847', '#FFFFFF', '#CE1126') +
    `<path d="M11.7 16.9A4.3 4.3 0 0 0 20.3 16.9" fill="none" stroke="#2E6B2A" stroke-width="1.2" stroke-linecap="round"/>` +
    `<ellipse cx="16.1" cy="19.5" rx="1.35" ry=".85" fill="#4C8C2B"/>` +
    `<ellipse cx="14.9" cy="18.5" rx="1" ry=".75" fill="#4C8C2B"/>` +
    `<ellipse cx="17.3" cy="18.4" rx=".95" ry=".7" fill="#4C8C2B"/>` +
    `<path d="M11.9 12.3 12.3 11.3 13.2 10.6 14.3 10.6 15 11.2 15.3 11.9 15.9 10.1 16.9 8.7 17.4 7.8 17.9 8.9 18.8 8.2 19 9.5 20.1 9.1 19.9 10.5 21 10.5 20.5 11.6 21.2 12.1 19.3 13.8 18.9 15.1 20.2 16.6 19.3 17.2 18.2 16.7 17.1 16.6 17.2 17.6 15.2 17.6 15.7 16.3 14.5 15.3 13.8 13.8 13.2 12.8 12.6 12.6 12.3 13.1z" fill="#7B4A20"/>` +
    `<path d="M12.4 12.4 11.7 13.3 12.3 14 11.8 14.9" fill="none" stroke="#2E6B2A" stroke-width=".55" stroke-linecap="round" stroke-linejoin="round"/>`,

  // South America.
  // Bolivia — red/yellow/green thirds with the arms: condor over the oval of
  // Cerro Rico.
  '\u{1F1E7}\u{1F1F4}': discH3('#D52B1E', '#F9E300', '#007934') +
    `<path d="M14.2 15.6 10.9 14.3" fill="none" stroke="#D52B1E" stroke-width=".95"/>` +
    `<path d="M14.2 17.5 10.9 16.2" fill="none" stroke="#007934" stroke-width=".95"/>` +
    `<path d="M17.8 15.6 21.1 14.3" fill="none" stroke="#D52B1E" stroke-width=".95"/>` +
    `<path d="M17.8 17.5 21.1 16.2" fill="none" stroke="#007934" stroke-width=".95"/>` +
    `<ellipse cx="16" cy="17.2" rx="2.8" ry="3.4" fill="#8BCDEF" stroke="#1D4F9F" stroke-width=".8"/>` +
    `<path d="M13.9 20 16 15.6 18.1 20z" fill="#A86F32"/>` +
    `<circle cx="17.3" cy="15.5" r=".6" fill="#F9E300"/>` +
    `<path d="M11.6 12.9 13.2 12.4 14.8 12.8 15.5 12 15.8 11.3 16.2 11.3 16.5 12 17.2 12.8 18.8 12.4 20.4 12.9 19.2 13.5 17.4 13.8 16.6 14.6 15.4 14.6 14.6 13.8 12.8 13.5z" fill="#262626"/>`,
  // Ecuador — yellow takes the top half; the condor spreads its wings over the
  // oval with Chimborazo, which is all that tells it from Colombia.
  '\u{1F1EA}\u{1F1E8}': `<rect width="32" height="32" fill="#FFDD00"/>` +
    `<rect y="16" width="32" height="8" fill="#034EA2"/>` +
    `<rect y="24" width="32" height="8" fill="#ED1C24"/>` +
    `<ellipse cx="16" cy="17.6" rx="3" ry="3.8" fill="#8BCDEF" stroke="#C9971C" stroke-width=".8"/>` +
    `<path d="M13.3 20.3 15.9 15.9 18.7 20.3z" fill="#5F7F45"/>` +
    `<path d="M15.2 17.1 15.9 15.9 16.6 17.1z" fill="#FFFFFF"/>` +
    `<circle cx="17.6" cy="15.6" r=".75" fill="#FFDD00"/>` +
    `<path d="M10.2 11.6 12.2 11 14.3 11.4 15.2 10.5 15.6 9.7 16.4 9.7 16.8 10.5 17.7 11.4 19.8 11 21.8 11.6 20.8 12.1 21.2 12.5 19.6 12.7 19.8 13.2 17.5 13.2 16.7 14.4 15.3 14.4 14.5 13.2 12.2 13.2 12.4 12.7 10.8 12.5 11.2 12.1z" fill="#262626"/>`,
  // Uruguay — nine stripes to the rim, the canton five stripes deep with the
  // Sun of May pulled in far enough that no ray touches the rim.
  '\u{1F1FA}\u{1F1FE}': `<rect width="32" height="32" fill="#FFFFFF"/>` +
    `<path d="M17.78 3.56H32v3.55H17.78zM17.78 10.67H32v3.55H17.78zM0 17.78h32v3.55H0zM0 24.89h32v3.55H0z" fill="#0038A8"/>` +
    `<g fill="#FCD116" stroke="#7B3F00" stroke-width=".35" stroke-linejoin="round">${star(9.8, 9.8, 16, 5.6, -90, .55)}` +
    `<circle cx="9.8" cy="9.8" r="2.6"/></g>`,
  // Peru.
  '\u{1F1F5}\u{1F1EA}': discV3('#D91023', '#FFFFFF', '#D91023'),
  // Colombia — yellow the top half, blue and red a quarter each.
  '\u{1F1E8}\u{1F1F4}': `<rect width="32" height="32" fill="#FCD116"/>` +
    `<rect y="16" width="32" height="8" fill="#003893"/>` +
    `<rect y="24" width="32" height="8" fill="#CE1126"/>`,
  // Chile — white over red, the blue canton a full quarter with its star at the
  // centroid of the quarter the disc shows.
  '\u{1F1E8}\u{1F1F1}': `<rect width="32" height="32" fill="#D52B1E"/>` +
    `<rect width="32" height="16" fill="#FFFFFF"/><rect width="16" height="16" fill="#0039A6"/>` +
    `<g fill="#FFFFFF">${star(9.6, 9.8, 5, 4.2, -90, .382)}</g>`,
  // Argentina — celeste/white/celeste thirds and the Sun of May on the white.
  '\u{1F1E6}\u{1F1F7}': discH3('#74ACDF', '#FFFFFF', '#74ACDF') +
    `<g fill="#F6B40E" stroke="#85340A" stroke-width=".35" stroke-linejoin="round">${star(16, 16, 16, 4.9, -90, .6)}` +
    `<circle cx="16" cy="16" r="2.3"/></g>`,

  // Oceania.
  // Samoa — the canton enlarged into the upper-hoist quarter of the disc, the
  // Southern Cross as five white stars: four large, epsilon small.
  '\u{1F1FC}\u{1F1F8}': `<rect width="32" height="32" fill="#CE1126"/>` +
    `<rect width="17.5" height="17.5" fill="#002B7F"/>` +
    `<g fill="#FFFFFF">${star(10.6, 5.6, 5, 1.9, -90, .382)}${star(6.6, 10.7, 5, 1.9, -90, .382)}` +
    `${star(14.2, 8.8, 5, 1.9, -90, .382)}${star(12.3, 11.9, 5, 1.2, -90, .382)}` +
    `${star(10.6, 14.6, 5, 1.9, -90, .382)}</g>`,
  // Tonga — the white canton grown into the upper-hoist quarter, its couped red
  // cross centred on what the rim leaves visible.
  '\u{1F1F9}\u{1F1F4}': `<rect width="32" height="32" fill="#C10000"/>` +
    `<rect width="17" height="16.5" fill="#FFFFFF"/>` +
    `<g fill="#C10000"><rect x="8.9" y="6" width="3" height="8.4"/>` +
    `<rect x="6.2" y="8.7" width="8.4" height="3"/></g>`,
  // Solomon Islands — the diagonal laid at 45° so it crosses the disc corner to
  // corner, the five stars (two, one, two) kept clear of the band.
  '\u{1F1F8}\u{1F1E7}': `<rect width="32" height="32" fill="#215B33"/>` +
    `<path d="M0 0H32L0 32z" fill="#0051BA"/>` +
    `<path d="M33.15 -2.85 -2.85 33.15 -1.15 34.85 34.85 -1.15z" fill="#FCD116"/>` +
    `<g fill="#FFFFFF">${star(7.1, 7.1, 5, 1.65, -90, .382)}${star(13.1, 7.1, 5, 1.65, -90, .382)}` +
    `${star(10.1, 10.1, 5, 1.65, -90, .382)}${star(7.1, 13.1, 5, 1.65, -90, .382)}` +
    `${star(13.1, 13.1, 5, 1.65, -90, .382)}</g>`,
  // Vanuatu — red over green, the black-edged yellow Y forking a little left of
  // centre, the tusk ring with its crossed namele leaves in the black triangle.
  '\u{1F1FB}\u{1F1FA}': `<rect width="32" height="32" fill="#009543"/>` +
    `<rect width="32" height="16" fill="#D21034"/>` +
    `<path d="M-18.9 -22.91 15.59 13.7 40 13.7 40 18.3 15.59 18.3 -18.9 54.91z" fill="#000000"/>` +
    `<path d="M-19.95 -21.92 14.97 15.15 40 15.15 40 16.85 14.97 16.85 -19.95 53.92z" fill="#FDCE12"/>` +
    `<path d="M-21.19 -20.75 13.43 16 -21.19 52.75z" fill="#000000"/>` +
    `<path d="M5.95 18.8A2.9 2.9 0 1 1 9.08 17.66Q7.71 18.78 7.28 17.22" fill="none" stroke="#FDCE12" stroke-width="1.15" stroke-linecap="round"/>` +
    `<path d="M5.25 14.55 7.86 17.16M8.15 14.55 5.54 17.16" fill="none" stroke="#FDCE12" stroke-width="0.7" stroke-linecap="round"/>`,
  // Papua New Guinea — split corner to corner, the Southern Cross on the black
  // hoist, the bird of paradise rising on the red fly, plumes trailing. The
  // cross is lifted up the hoist until it sits as far from the rim as from
  // the diagonal, so the curve of the disc never clips its lowest star.
  '\u{1F1F5}\u{1F1EC}': `<rect width="32" height="32" fill="#000000"/>` +
    `<path d="M0 0H32V32z" fill="#CE1126"/><g fill="#FFFFFF">${star(9.5, 14.1, 5, 1.9, -90, .382)}` +
    `${star(5.3, 19.7, 5, 1.9, -90, .382)}${star(13.9, 19.7, 5, 1.9, -90, .382)}` +
    `${star(11.6, 23.3, 5, 1.1, -90, .382)}${star(9.5, 25.7, 5, 1.9, -90, .382)}</g>` +
    `<path d="M17.13 7.92L17.85 7.36Q18.46 6.9 19.07 7.41Q19.58 7.92 19.99 8.03Q20.09 5.83 21.62 4.2L21.77 5.38L22.59 4.86L22.49 6.14L23.41 5.88L23 7.16L23.86 7.26L22.89 8.59Q22.44 9.51 21.93 10.22Q21.31 11.24 20.4 11.24L19.89 12.97L19.12 11.9L18.2 13.23L17.95 11.9L16.57 12.72L17.08 11.5L15.6 11.44L17.34 10.53Q18.76 9.81 19.12 8.89Q18.56 8.28 17.95 8.28z" fill="#FCD116"/>` +
    `<path d="M21.82 10.32Q26.01 12.36 25.39 15.52Q24.99 16.95 23.86 16.34M21.31 10.93Q24.37 12.97 24.02 14.91Q23.71 15.93 23.05 15.42" fill="none" stroke="#FCD116" stroke-width=".48" stroke-linecap="round"/>`,
  // Fiji — light-blue ensign: Australia's Union canton, its saltire ends
  // trimmed back to the canton corner with a patch of the field, and the shield
  // (red chief with the gold lion, red cross on white) centred in the fly.
  '\u{1F1EB}\u{1F1EF}': `<rect width="32" height="32" fill="#68BFE5"/>` +
    `<rect width="16" height="14" fill="#012169"/>` + unionJack(16, 14, 2.6, 1.1, 4.6, 2.6) +
    `<path d="M16 0H17.2V1.8H16zM16 12H17.2V15.2H14V14H16z" fill="#68BFE5"/>` +
    `<path d="M18.9 11.4H27.5V18.29Q27.5 22.84 23.2 24.4Q18.9 22.84 18.9 18.29z" fill="#FFFFFF"/>` +
    `<rect x="18.9" y="11.4" width="8.6" height="3.2" fill="#CE1126"/>` +
    `<ellipse cx="23.2" cy="13" rx="2.06" ry="0.83" fill="#FCD116"/>` +
    `<rect x="22.5" y="14.6" width="1.4" height="8.9" fill="#CE1126"/>` +
    `<rect x="18.9" y="17.82" width="8.6" height="1.4" fill="#CE1126"/>`,
  // New Zealand — Australia's canton (saltire ends trimmed at the corner), and
  // the four red stars of the Southern Cross, each on a white star grown by an
  // even border. The big bottom star is lifted until its white edge sits as
  // far from the rim as the other three do.
  '\u{1F1F3}\u{1F1FF}': `<rect width="32" height="32" fill="#012169"/>` +
    unionJack(16, 14, 2.6, 1.1, 4.6, 2.6) +
    `<path d="M16 0H17.2V1.8H16zM16 12H17.2V15.2H14V14H16z" fill="#012169"/>` +
    `<g fill="#FFFFFF">${star(23.6, 7.8, 5, 2.91, -90, .382)}${star(19.6, 17.2, 5, 2.91, -90, .382)}` +
    `${star(27.1, 14.4, 5, 2.61, -90, .382)}${star(23.6, 23.6, 5, 3.11, -90, .382)}</g>` +
    `<g fill="#C8102E">${star(23.6, 7.8, 5, 2, -90, .382)}${star(19.6, 17.2, 5, 2, -90, .382)}` +
    `${star(27.1, 14.4, 5, 1.7, -90, .382)}${star(23.6, 23.6, 5, 2.2, -90, .382)}</g>`,
};

// The coin finish, written once and stamped over every flag inside the same
// clip: a top-light gloss crescent and a faint shade just inside the rim, so
// the disc reads as enamel with a curved face rather than a printed dot.
const COIN_FINISH = `<ellipse cx="16" cy="4.5" rx="15" ry="10.5" fill="#fff" opacity=".12"/>` +
  `<circle cx="16" cy="16" r="14.25" fill="none" stroke="#000" stroke-opacity=".1" stroke-width="1.5"/>`;

/**
 * A board group's mark. Real countries get their flag drawn; the regional
 * boards use pictograph emoji (a castle for Rajasthan, a lion for Gujarat)
 * which every platform does have a glyph for, so those pass straight through.
 * Anything unrecognised falls back to a pennant in the group's own colour.
 */
export function groupFlag(mark, colour, size, cls = '') {
  const art = FLAG_ART[String(mark || '').replace(/\uFE0F/g, '')];
  if (art) {
    const dim = size == null ? '' : ` style="width:${px(size)};height:${px(size)}"`;
    // `flag-art` marks this as cloth that can be cropped: the board's
    // medallion blows it up past its circle so the flag fills the disc edge
    // to edge — which must never happen to a pictograph or the pennant.
    return `<svg viewBox="0 0 32 32" fill="none" class="ico flag-art${cls ? ` ${cls}` : ''}"${dim}` +
      ` aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${art}</svg>`;
  }
  if (mark) return `<span class="group-mark" aria-hidden="true">${mark}</span>`;
  return groupBanner(colour, size, cls);
}

// Each rendered coin gets its own clipPath id: the same flag appears on two
// or three tiles of a group, and a url(#…) reference to a twin inside a
// hidden tile (has-buildings hides its medallion) is not worth trusting.
let coinSeq = 0;

/**
 * The medallion's mark: circle-native art where a flag has been re-laid-out
 * for the disc, clipped to the circle at (16,16) r15 with the shared coin
 * finish stamped on top. Any mark without circle art falls back to
 * groupFlag() unchanged — the cropped rectangle for a rect-only flag, the
 * pictograph pass-through, the pennant. Deed sheets and everything else keep
 * calling groupFlag() and never see this.
 */
export function circleFlag(mark, colour, size, cls = '') {
  const art = CIRCLE_FLAG_ART[String(mark || '').replace(/\uFE0F/g, '')];
  if (!art) return groupFlag(mark, colour, size, cls);
  const dim = size == null ? '' : ` style="width:${px(size)};height:${px(size)}"`;
  const id = `coinclip-${++coinSeq}`;
  // `flag-coin` tells the CSS this art is already circular: it sits at 100%
  // of the medallion, never the 170% blow-up the rectangles need.
  return `<svg viewBox="0 0 32 32" fill="none" class="ico flag-coin${cls ? ` ${cls}` : ''}"${dim}` +
    ` aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">` +
    `<clipPath id="${id}"><circle cx="16" cy="16" r="15"/></clipPath>` +
    `<g clip-path="url(#${id})">${art}${COIN_FINISH}</g></svg>`;
}
