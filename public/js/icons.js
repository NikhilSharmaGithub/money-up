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
