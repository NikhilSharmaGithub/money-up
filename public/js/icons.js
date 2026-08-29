// Hand-drawn board art.
//
// Emoji were the single thing making the board look generic — they carry another
// vendor's style, change per platform, and can't take the board's palette. These
// are flat two-tone illustrations on a common 32×32 grid so they sit at the same
// optical weight next to each other.

const svg = (body, extra = '') =>
  `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" ${extra}>${body}</svg>`;

export const ART = {
  // ---- corners ----------------------------------------------------------
  start: svg(`
    <path d="M3 16 h13" stroke="#1c6b45" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="1.5 4"/>
    <path d="M13 6.5 21.5 16 13 25.5 Z" fill="#34d399"/>
    <path d="M20 6.5 28.5 16 20 25.5 Z" fill="#6ee7a0"/>
    <circle cx="6" cy="16" r="2.6" fill="#34d399"/>`),

  prison: svg(`
    <rect x="4.5" y="5.5" width="23" height="21" rx="3" fill="#1b2140"/>
    <circle cx="16" cy="13" r="4.2" fill="#aab6d8"/>
    <path d="M8.5 26.5c0-4.4 3.4-7.6 7.5-7.6s7.5 3.2 7.5 7.6z" fill="#aab6d8"/>
    <g stroke="#e6ecff" stroke-width="1.9" stroke-linecap="round">
      <path d="M11 6.6v18.8M16 6.6v18.8M21 6.6v18.8"/>
    </g>
    <rect x="4.5" y="5.5" width="23" height="21" rx="3" stroke="#8f9dc4" stroke-width="1.6"/>`),

  vacation: svg(`
    <circle cx="23" cy="9.5" r="5" fill="#fcd34d"/>
    <path d="M13.5 13c-3.6-2.4-8-1.6-9.6 1 3-.6 5.4.2 7 1.6z" fill="#22c55e"/>
    <path d="M13.5 13c-.8-4.2 1.6-7.8 4.8-8.2-2 2.2-2.6 4.8-2.4 7z" fill="#16a34a"/>
    <path d="M13.5 13c4-1.6 8 .4 9 3.4-2.6-1.6-5.2-1.8-7.4-1z" fill="#22c55e"/>
    <path d="M13.6 12.6 12 27" stroke="#a16207" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M2 24.5c2.6-2 5.2-2 7.8 0s5.2 2 7.8 0 5.2-2 7.8 0 4 1.4 5.6 0" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>`),

  gotoprison: svg(`
    <circle cx="10" cy="19" r="6.4" stroke="#54607a" stroke-width="3"/>
    <circle cx="22" cy="19" r="6.4" stroke="#54607a" stroke-width="3"/>
    <path d="M10 12.6V8.4M22 12.6V8.4" stroke="#54607a" stroke-width="3" stroke-linecap="round"/>
    <path d="M12.4 7.4h7.2" stroke="#d92037" stroke-width="3.4" stroke-linecap="round"/>`),

  // ---- card and cash tiles ---------------------------------------------
  treasure: svg(`
    <path d="M4 14.5A12 12 0 0 1 28 14.5V16H4z" fill="#f0a336"/>
    <rect x="4" y="15.5" width="24" height="11.5" rx="2.2" fill="#d97b0f"/>
    <rect x="4" y="15" width="24" height="3" fill="#fbbf24"/>
    <rect x="13.6" y="12.5" width="4.8" height="9" rx="1.6" fill="#7c3f06"/>
    <circle cx="16" cy="17.5" r="1.5" fill="#fde68a"/>`),

  surprise: svg(`
    <rect x="5" y="5" width="22" height="22" rx="7" fill="#be1a63"/>
    <path d="M12.4 12.6c0-2.2 1.7-3.7 3.9-3.7 2.1 0 3.8 1.4 3.8 3.4 0 1.7-1 2.5-2.2 3.3-1.1.8-1.6 1.4-1.6 2.6v.6"
      stroke="#ffd9ea" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="16.2" cy="23.4" r="1.8" fill="#ffd9ea"/>`),

  tax: svg(`
    <rect x="3.5" y="8" width="25" height="16" rx="2.4" fill="#3f2733" stroke="#f0728c" stroke-width="1.6"/>
    <circle cx="11" cy="13" r="2.2" fill="#f0728c"/>
    <circle cx="21" cy="19" r="2.2" fill="#f0728c"/>
    <path d="M22 11 10 21" stroke="#f0728c" stroke-width="2.2" stroke-linecap="round"/>`),

  refund: svg(`
    <rect x="3.5" y="8" width="25" height="16" rx="2.4" fill="#1e3a2b" stroke="#4ade80" stroke-width="1.6"/>
    <circle cx="16" cy="16" r="4.4" fill="#4ade80"/>
    <path d="M16 13.4v5.2M13.4 16h5.2" stroke="#12321f" stroke-width="2" stroke-linecap="round"/>`),

  // ---- ownables ---------------------------------------------------------
  airport: svg(`
    <path d="M16 2.6c1.5 0 2.4 1.6 2.4 3.6v5.4l10.2 5.6v3l-10.2-3v5.4l3 2.2v2.4L16 26l-5.4 1.2v-2.4l3-2.2v-5.4l-10.2 3v-3l10.2-5.6V6.2c0-2 .9-3.6 2.4-3.6z"
      fill="#3f6fae"/>`),

  bolt: svg(`<path d="M18.4 2.5 7 18h6.6l-1.4 11.5L25 13.4h-7l.4-10.9z" fill="#eab308"/>`),
  droplet: svg(`
    <path d="M16 3c5.4 6.6 8.4 10.9 8.4 14.7A8.4 8.4 0 0 1 16 26a8.4 8.4 0 0 1-8.4-8.3C7.6 13.9 10.6 9.6 16 3z" fill="#5cc9f5"/>
    <path d="M12.4 18.6c0 2.2 1.5 3.9 3.4 4.3" stroke="#e0f6ff" stroke-width="1.8" stroke-linecap="round"/>`),
  flame: svg(`
    <path d="M16 2.5c1.2 5.4-4 6.6-4 11.4 0-2.2-1.3-3.5-1.3-3.5-2 2.6-3.2 5.2-3.2 8A8.5 8.5 0 0 0 16 27a8.5 8.5 0 0 0 8.5-8.6c0-6.4-5.2-9.6-8.5-15.9z" fill="#fb923c"/>
    <path d="M16 27a4.2 4.2 0 0 0 4.2-4.3c0-3-2.6-4.4-4.2-7.4-1.6 3-4.2 4.4-4.2 7.4A4.2 4.2 0 0 0 16 27z" fill="#fde68a"/>`),
  sun: svg(`
    <circle cx="16" cy="16" r="6.4" fill="#fcd34d"/>
    <g stroke="#fcd34d" stroke-width="2.4" stroke-linecap="round">
      <path d="M16 3.4v3.6M16 25v3.6M3.4 16h3.6M25 16h3.6M7.2 7.2l2.5 2.5M22.3 22.3l2.5 2.5M24.8 7.2l-2.5 2.5M9.7 22.3l-2.5 2.5"/>
    </g>`),
  turbine: svg(`
    <path d="M15 15 6.5 8.4l1.8-2.6L16 13.6z" fill="#4a86bd"/>
    <path d="M17 15.6 27 12l.7 3.1-10 3.3z" fill="#4a86bd"/>
    <path d="M15.6 17.4 13 28.4h-3.2l3.5-11.4z" fill="#4a86bd"/>
    <circle cx="16" cy="16" r="2.4" fill="#2c5a85"/>`),
};

/** Utility tiles carry an emoji in the map data — map it onto the drawn set. */
const UTILITY_ART = { '⚡': 'bolt', '🚰': 'droplet', '💧': 'droplet', '🛢️': 'flame', '☀️': 'sun', '🌬️': 'turbine' };
export const utilityArt = (icon) => ART[UTILITY_ART[icon] || 'bolt'];

// Buildings, drawn small enough to stay legible at a few pixels wide.
ART.house = svg(`
  <path d="M16 4 30 15.5h-4V28H6V15.5H2z" fill="#3ddc84"/>
  <rect x="13" y="19" width="6" height="9" rx="1" fill="#0f5132"/>`);
ART.hotel = svg(`
  <rect x="5" y="7" width="22" height="21" rx="2" fill="#f43f5e"/>
  <rect x="5" y="4" width="22" height="4" rx="1.6" fill="#fb7185"/>
  <g fill="#ffe4e6">
    <rect x="8.5" y="11" width="4" height="4" rx=".8"/><rect x="14" y="11" width="4" height="4" rx=".8"/>
    <rect x="19.5" y="11" width="4" height="4" rx=".8"/><rect x="8.5" y="17" width="4" height="4" rx=".8"/>
    <rect x="19.5" y="17" width="4" height="4" rx=".8"/>
  </g>
  <rect x="13.6" y="21" width="4.8" height="7" rx="1" fill="#7f1d3a"/>`);
