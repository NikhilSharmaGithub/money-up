// Share your result (1.0.6): the game-over sheet's picture of how it ended —
// the wordmark, the board and the day, the winner, the podium with what each
// was worth, and where this player finished — at 1080 × 1350, the portrait
// size every feed and chat shows whole. The phones draw the same card with
// their own renderers; this one paints it onto a canvas.
//
// Nothing private goes into it: names, faces and flags are what everybody at
// the table already saw, and there is no room code — a picture travels
// further than its sender meant it to, and a code in it would be an open door.
// The text-and-link share on the sheet stays beside it, because a link is
// what turns a friend into an opponent.

import { ART } from './icons.js';

const W = 1080;
const H = 1350;

// Always the midnight felt, whatever the reader's own theme: the picture is
// seen on other people's screens, in other people's light, and the night
// table is the one that reads as the game on every one of them. These are
// the dark palette's own values, the same ones the social card is drawn in.
const C = {
  page: '#0c1310', page2: '#070b09', card: '#16211c', rule: '#31453c',
  ink: '#efede2', ink2: '#adb6ac', ink3: '#78827a',
  gold: '#d9a13a', brassTop: '#e8c069', brassFoot: '#b58223',
  good: '#4fd98b', bad: '#e25a6d', onGold: '#201607',
  ivory: '#f4f1e4', felt: '#1c6b45',
};

const FONT = 'Outfit, "Helvetica Neue", Helvetica, Arial, sans-serif';
// Avatars and flags are emoji people chose, so they are drawn by whatever
// colour-emoji face the system has rather than in the wordmark's font.
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

// A colour arrives from the room's state, so only the shapes that can be
// nothing but a colour are painted; anything else falls back to the ink.
const SAFE_COLOUR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\)|hsla?\([\d.,\s%deg]+\))$/i;
const colour = (c, fallback = C.ink) => (SAFE_COLOUR.test(String(c || '').trim()) ? String(c).trim() : fallback);

const money = (n) => {
  const v = Number(n || 0);
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}`;
};

export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

/** One of the app's drawings as an image the canvas can paint, inked in `ink`. */
function glyph(name, ink = C.ink) {
  const art = ART[name];
  if (!art) return Promise.resolve(null);
  // currentColor in a standalone SVG resolves against the root's own colour.
  const svg = art.replace('<svg ', `<svg width="256" height="256" style="color:${ink}" `);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (img.decode ? img.decode() : new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; }))
    .then(() => img).catch(() => null);
}

/** The webfont, if it can be had in time — a fallback face beats no picture. */
async function fontsReady() {
  if (!document.fonts?.load) return;
  const wait = Promise.all(['900', '800', '700', '600'].map((w) => document.fonts.load(`${w} 40px Outfit`)));
  await Promise.race([wait, new Promise((ok) => setTimeout(ok, 1500))]).catch(() => {});
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Sets the font to the largest size up to `size` (and down to half of it) at
 * which `text` fits `max` pixels, and returns the text — cut with an ellipsis
 * if even the smallest size will not hold it.
 */
function fit(ctx, text, max, size, weight = 700, family = FONT) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > max && s > size / 2) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** The die from the favicon: ivory, rounded, five green pips. */
function logoMark(ctx, x, y, s) {
  ctx.save();
  ctx.fillStyle = C.ivory;
  roundRect(ctx, x, y, s, s, s * 0.22);
  ctx.fill();
  ctx.fillStyle = C.felt;
  const pip = s * 0.11;
  [[0.3, 0.3], [0.7, 0.3], [0.5, 0.5], [0.3, 0.7], [0.7, 0.7]].forEach(([px, py]) => {
    ctx.beginPath();
    ctx.arc(x + s * px, y + s * py, pip, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

/** A seat's face: its colour, and the avatar it wore or its initial; the flag in the corner. */
function avatar(ctx, p, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = colour(p.color, C.ink3);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (p.avatar) {
    ctx.font = `${Math.round(r * 1.1)}px ${EMOJI}`;
    ctx.fillText(String(p.avatar), cx, cy + r * 0.06);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${Math.round(r * 0.95)}px ${FONT}`;
    ctx.fillText(String(p.name || '?').trim().charAt(0).toUpperCase() || '?', cx, cy + r * 0.04);
  }
  if (p.flag) {
    ctx.font = `${Math.round(r * 0.62)}px ${EMOJI}`;
    ctx.fillText(String(p.flag), cx + r * 0.78, cy + r * 0.72);
  }
  ctx.restore();
}

/**
 * Paints the card and hands back its PNG.
 *
 * `data` is the result as the sheet tells it — ui.js builds it from the very
 * standings the sheet prints, so the picture can never disagree with them:
 * { mapName, winner: { name, color }, podium: [{ name, color, avatar, flag,
 *   worth, bankrupt }], placing: { rank, of } | null, won, onTime, date }.
 */
export async function drawResultCard(data) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');

  const [medals, trophy, map, clock] = await Promise.all([
    Promise.all(['medalGold', 'medalSilver', 'medalBronze'].map((m) => glyph(m))),
    glyph('trophy'),
    glyph('map', C.ink2),
    glyph('clock', C.gold),
    fontsReady(),
  ]);

  // The felt, lit from a little above the middle, and the brass edge of the
  // table around it.
  const ground = ctx.createLinearGradient(0, 0, 0, H);
  ground.addColorStop(0, C.page);
  ground.addColorStop(1, C.page2);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.38, 20, W / 2, H * 0.38, 720);
  glow.addColorStop(0, 'rgba(22, 33, 28, .9)');
  glow.addColorStop(1, 'rgba(22, 33, 28, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const warm = ctx.createRadialGradient(W * 0.86, H * 0.92, 10, W * 0.86, H * 0.92, 520);
  warm.addColorStop(0, 'rgba(181, 130, 35, .22)');
  warm.addColorStop(1, 'rgba(181, 130, 35, 0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 4;
  roundRect(ctx, 34, 34, W - 68, H - 68, 54);
  ctx.stroke();
  ctx.restore();

  ctx.textBaseline = 'alphabetic';

  // The wordmark: the die, then MONEY in ivory and MOVE in brass.
  ctx.font = `900 70px ${FONT}`;
  const moneyW = ctx.measureText('MONEY').width;
  const moveW = ctx.measureText('MOVE').width;
  const markS = 92;
  const rowW = markS + 26 + moneyW + moveW;
  let x = (W - rowW) / 2;
  logoMark(ctx, x, 96, markS);
  x += markS + 26;
  ctx.textAlign = 'left';
  ctx.fillStyle = C.ink;
  ctx.fillText('MONEY', x, 96 + 70);
  const brass = ctx.createLinearGradient(0, 96 + 14, 0, 96 + 72);
  brass.addColorStop(0, C.brassTop);
  brass.addColorStop(1, C.brassFoot);
  ctx.fillStyle = brass;
  ctx.fillText('MOVE', x + moneyW, 96 + 70);

  // The board and the day.
  const day = (data.date || new Date()).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const line = fit(ctx, `${data.mapName || 'MoneyMove'} · ${day}`, W - 180 - 42, 32, 600);
  const lineW = ctx.measureText(line).width + (map ? 42 : 0);
  x = (W - lineW) / 2;
  if (map) ctx.drawImage(map, x, 236, 30, 30);
  ctx.fillStyle = C.ink2;
  ctx.textAlign = 'left';
  ctx.fillText(line, x + (map ? 42 : 0), 262);

  // Everything between the header and the footer, measured first so it can
  // sit in the middle of the room it has.
  const podium = (data.podium || []).slice(0, 3);
  const rowH = 78;
  const podH = podium.length ? podium.length * rowH + (podium.length - 1) * 18 + 68 : 0;
  const blocks = 132 + 14 + 100 + (data.onTime ? 56 : 0) + (podH ? 44 + podH : 0) + (data.placing ? 40 + 80 : 0);
  const top = 300;
  const bottom = H - 92 - 30 - 40;
  let y = top + Math.max(0, (bottom - top - blocks) / 2);

  if (trophy) ctx.drawImage(trophy, (W - 132) / 2, y, 132, 132);
  y += 132 + 14;
  ctx.textAlign = 'center';
  ctx.fillStyle = colour(data.winner?.color, C.gold);
  const headline = fit(ctx, `${data.winner?.name || 'Nobody'} wins!`, W - 180, 86, 900);
  ctx.fillText(headline, W / 2, y + 80);
  y += 100;

  if (data.onTime) {
    ctx.font = `700 30px ${FONT}`;
    const say = "Time's up — the richest player won";
    const w = ctx.measureText(say).width + (clock ? 44 : 0);
    const sx = (W - w) / 2;
    if (clock) ctx.drawImage(clock, sx, y + 14, 32, 32);
    ctx.fillStyle = C.ink2;
    ctx.textAlign = 'left';
    ctx.fillText(say, sx + (clock ? 44 : 0), y + 41);
    y += 56;
  }

  if (podH) {
    y += 44;
    const px = 90;
    const pw = W - 180;
    ctx.save();
    ctx.fillStyle = C.card;
    roundRect(ctx, px, y, pw, podH, 44);
    ctx.fill();
    ctx.strokeStyle = C.rule;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    let ry = y + 34;
    podium.forEach((p, k) => {
      ctx.save();
      if (p.bankrupt) ctx.globalAlpha = 0.6;
      const left = px + 38;
      if (medals[k]) ctx.drawImage(medals[k], left, ry + 4, 70, 70);
      avatar(ctx, p, left + 70 + 24 + 39, ry + 39, 39);
      const worth = p.bankrupt ? 'Bankrupt' : money(p.worth);
      ctx.font = `800 42px ${FONT}`;
      const worthW = ctx.measureText(worth).width;
      ctx.textAlign = 'right';
      ctx.fillStyle = p.bankrupt ? C.ink3 : Number(p.worth) < 0 ? C.bad : C.good;
      ctx.fillText(worth, px + pw - 38, ry + 54);
      const nameX = left + 70 + 24 + 78 + 24;
      ctx.textAlign = 'left';
      ctx.fillStyle = C.ink;
      ctx.fillText(fit(ctx, String(p.name || ''), px + pw - 38 - worthW - 24 - nameX, 44, 700), nameX, ry + 54);
      ctx.restore();
      ry += rowH + 18;
    });
    y += podH;
  }

  // Where this player came — a pill in brass for a win, on paper otherwise.
  // A table only watched has no placing, and no pill.
  if (data.placing) {
    y += 40;
    const say = data.won
      ? (data.placing.rank === 1 ? 'I won!' : 'My team won!')
      : `I finished ${ordinal(data.placing.rank)} of ${data.placing.of}`;
    ctx.font = `800 44px ${FONT}`;
    const w = ctx.measureText(say).width + 88;
    const sx = (W - w) / 2;
    ctx.save();
    ctx.fillStyle = data.won ? C.gold : C.card;
    roundRect(ctx, sx, y, w, 80, 40);
    ctx.fill();
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.fillStyle = data.won ? C.onGold : C.ink;
    ctx.fillText(say, W / 2, y + 55);
  }

  ctx.textAlign = 'center';
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = C.ink3;
  ctx.fillText('Play free at moneymove.live', W / 2, H - 92);

  return new Promise((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('no picture'))), 'image/png'));
}

const FILE_NAME = 'MoneyMove result.png';

/** Whether this browser can hand a picture to the system share sheet at all. */
export function canSharePicture() {
  try {
    return !!navigator.canShare?.({ files: [new File([''], FILE_NAME, { type: 'image/png' })] });
  } catch {
    return false;
  }
}

/**
 * Hands the picture to the share sheet where there is one, and saves it as a
 * download everywhere else. Resolves to what happened: 'shared', 'cancelled'
 * (the player backed out, which is not a failure) or 'saved'.
 */
export async function sharePicture(blob) {
  const file = new File([blob], FILE_NAME, { type: 'image/png' });
  if (canSharePicture()) {
    try {
      await navigator.share({ files: [file], title: 'MoneyMove' });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // NotAllowedError — the tap went stale while the picture was being
      // drawn — or a share target that refused it: the file is still worth
      // having, so it is saved instead of lost.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = FILE_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'saved';
}
