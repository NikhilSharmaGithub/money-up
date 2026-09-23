// Turns the web client's drawn glyph set into the Kotlin the Android app
// renders. One source of art for three platforms: change public/js/icons.js
// and re-run this, rather than redrawing sixty-two icons by eye.
import { ART, ICON_NAMES, INHERENT_COLOUR, circleFlag } from '../public/js/icons.js';
import { GROUPS } from '../server/maps.js';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const f = (v) => {
  const s = String(Number(v.toFixed(3)));
  return s.includes('.') ? `${s}f` : `${s}f`;
};

/** A circle as path data — two arcs, the same shape icons.js writes by hand. */
const circlePath = (cx, cy, r) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;

/** An ellipse as path data — two arcs, same shape as the circle helper. */
const ellipsePath = (cx, cy, rx, ry) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;

/** A line. Nothing fills it; it exists to be stroked. */
const linePath = (x1, y1, x2, y2) => `M${x1} ${y1}L${x2} ${y2}`;

const rectPath = (x, y, w, h, r) => {
  if (!r) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  const rr = Math.min(r, w / 2, h / 2);
  return `M${x + rr} ${y}h${w - 2 * rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}` +
    `v${h - 2 * rr}a${rr} ${rr} 0 0 1 ${-rr} ${rr}h${-(w - 2 * rr)}` +
    `a${rr} ${rr} 0 0 1 ${-rr} ${-rr}v${-(h - 2 * rr)}a${rr} ${rr} 0 0 1 ${rr} ${-rr}Z`;
};

const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

const colour = (v) => {
  if (!v || v === 'none') return null;
  if (v === 'currentColor') return 'INK';
  const hex = v.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  return `0xFF${full.toUpperCase()}`;
};

// SVG presentation attributes inherit. A <g stroke="currentColor"
// stroke-width="2"> around three shapes is how half this set is drawn, and a
// reader that ignores the group produces three invisible shapes — which is
// exactly what the globe, the key and the door came out as.
const INHERITED = [
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'fill', 'fill-rule',
];

function shapesOf(svg) {
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const out = [];
  // The root <svg> carries fill="none", which is the default every shape
  // without a fill of its own inherits.
  const stack = [{ opacity: 1, fill: 'none' }];
  const tokens = body.match(/<\/?[a-zA-Z]+[^>]*>/g) || [];
  for (const tok of tokens) {
    const name = tok.match(/^<\/?([a-zA-Z]+)/)[1];
    if (tok.startsWith('</')) { if (name === 'g' || name === 'clipPath') stack.pop(); continue; }
    const raw = attrs(tok);
    const parent = stack[stack.length - 1];
    // What this element ends up with: its own attributes over its parents'.
    const a = { ...raw };
    for (const key of INHERITED) if (a[key] === undefined && parent[key] !== undefined) a[key] = parent[key];

    // The clip is a circle the renderer applies itself, so the element that
    // declares it — and the shape inside it — are not drawings.
    if (name === 'clipPath') { stack.push({ ...parent, skip: true }); continue; }
    if (parent.skip) continue;

    if (name === 'g') {
      const next = { opacity: parent.opacity * (raw.opacity ? num(raw.opacity) : 1) };
      for (const key of INHERITED) {
        const v = raw[key] !== undefined ? raw[key] : parent[key];
        if (v !== undefined) next[key] = v;
      }
      stack.push(next);
      continue;
    }
    let d = null;
    if (name === 'path') d = a.d;
    else if (name === 'circle') d = circlePath(num(a.cx), num(a.cy), num(a.r));
    else if (name === 'rect') d = rectPath(num(a.x), num(a.y), num(a.width), num(a.height), num(a.rx));
    else if (name === 'ellipse') d = ellipsePath(num(a.cx), num(a.cy), num(a.rx), num(a.ry));
    else if (name === 'line') d = linePath(num(a.x1), num(a.y1), num(a.x2), num(a.y2));
    if (!d) continue;
    const group = parent.opacity;
    out.push({
      d: d.replace(/\s+/g, ' ').trim(),
      fill: colour(a.fill),
      stroke: colour(a.stroke),
      strokeWidth: a['stroke-width'] ? num(a['stroke-width']) : 1,
      cap: a['stroke-linecap'] || 'butt',
      join: a['stroke-linejoin'] || 'miter',
      dash: a['stroke-dasharray']
        ? a['stroke-dasharray'].split(/[\s,]+/).filter(Boolean).map(num) : null,
      alpha: group * (a.opacity ? num(a.opacity) : 1)
        * (a['stroke-opacity'] && !a.fill ? num(a['stroke-opacity']) : 1),
      evenOdd: a['fill-rule'] === 'evenodd',
    });
  }
  return out;
}

const lines = [];
lines.push(`package com.moneymove.game`);
lines.push('');
lines.push('// GENERATED — do not edit by hand.');
lines.push('//');
lines.push('// The board\'s illustrations and the app\'s UI glyphs, taken straight from the');
lines.push('// web client\'s public/js/icons.js so all three platforms draw the same art on');
lines.push('// the same 32x32 grid. Emoji were the one thing making the board look generic:');
lines.push('// they carry another vendor\'s style, change per platform, and cannot take the');
lines.push('// table\'s palette. These are flat two-tone drawings that can.');
lines.push('//');
lines.push('// Regenerate with tools/gen-glyphs.mjs after changing icons.js.');
lines.push('');
lines.push('/** One filled or stroked subpath of a glyph. `fill == INK` takes the tint. */');
lines.push('data class GlyphPart(');
lines.push('    val d: String,');
lines.push('    val fill: Long? = INK,');
lines.push('    val stroke: Long? = null,');
lines.push('    val strokeWidth: Float = 1f,');
lines.push('    val cap: Int = 0,          // 0 butt, 1 round, 2 square');
lines.push('    val join: Int = 0,         // 0 miter, 1 round, 2 bevel');
lines.push('    val dash: FloatArray? = null,');
lines.push('    val alpha: Float = 1f,');
lines.push('    val evenOdd: Boolean = false,');
lines.push(')');
lines.push('');
lines.push('/** The sentinel that means "this stroke is ink, paint it in the tint". */');
lines.push('const val INK: Long = -1L');
lines.push('');
lines.push('/**');
lines.push(' * Glyphs that keep a colour of their own on every table, in both modes: a');
lines.push(' * coin is gold everywhere, and a bronze medal that took the theme\'s ink would');
lines.push(' * just be a third silver one. Everything else is ink and takes the tint.');
lines.push(' */');
lines.push('val INHERENT_COLOUR: Set<String> = setOf(');
const inherent = [...INHERENT_COLOUR].sort();
for (let i = 0; i < inherent.length; i += 6) {
  lines.push('    ' + inherent.slice(i, i + 6).map((k) => `"${k}"`).join(', ') + ',');
}
lines.push(')');
lines.push('');
lines.push('val GLYPHS: Map<String, List<GlyphPart>> = mapOf(');
const capId = { butt: 0, round: 1, square: 2 };
const joinId = { miter: 0, round: 1, bevel: 2 };
for (const name of ICON_NAMES.slice().sort()) {
  lines.push(`    "${name}" to listOf(`);
  for (const s of shapesOf(ART[name])) {
    const bits = [`"${s.d}"`];
    bits.push(`fill = ${s.fill === null ? 'null' : s.fill}`);
    if (s.stroke !== null) {
      bits.push(`stroke = ${s.stroke}`);
      bits.push(`strokeWidth = ${f(s.strokeWidth)}`);
      if (capId[s.cap]) bits.push(`cap = ${capId[s.cap]}`);
      if (joinId[s.join]) bits.push(`join = ${joinId[s.join]}`);
      if (s.dash) bits.push(`dash = floatArrayOf(${s.dash.map(f).join(', ')})`);
    }
    if (s.alpha !== 1) bits.push(`alpha = ${f(s.alpha)}`);
    if (s.evenOdd) bits.push('evenOdd = true');
    lines.push(`        GlyphPart(${bits.join(', ')}),`);
  }
  lines.push('    ),');
}
lines.push(')');
lines.push('');
// ── the country medallions ────────────────────────────────────────────────
// The disc a street wears on the board: its country's flag, laid out for a
// circle rather than cropped out of a rectangle. Keyed by the same emoji mark
// the server sends in GROUPS[].flag, so a board naming a country gets its
// flag and one naming a landmark gets nothing and falls back to the colour.
lines.push('/**');
lines.push(' * Country flags, drawn for the disc a street wears on the board.');
lines.push(' *');
lines.push(" * Keyed by the emoji mark the server sends as a group's `flag`. A mark");
lines.push(' * with no entry here has no drawn flag, and the medallion falls back to');
lines.push(' * the country colour — which is exactly what the web client does. The');
lines.push(' * emoji itself is never drawn: it is another vendor’s artwork, it');
lines.push(' * changes per platform, and it cannot take the table’s palette.');
lines.push(' *');
lines.push(' * Already composed for a circle, so the renderer only clips to one.');
lines.push(' */');
lines.push('val FLAGS: Map<String, List<GlyphPart>> = mapOf(');
const flagMarks = [...new Set(Object.values(GROUPS).map((g) => g.flag))].filter(Boolean).sort();
let drawnFlags = 0;
for (const mark of flagMarks) {
  const svg = circleFlag(mark, '#888888', 20);
  if (!svg.includes('flag-coin')) continue;   // no circle art for this mark
  drawnFlags++;
  // UTF-16 code UNITS, not code points: Kotlin's \u escape takes exactly four
  // hex digits, and a flag emoji is a surrogate pair well above the BMP. One
  // \u1f1e7 is not a long escape, it is a syntax error.
  const escaped = Array.from({ length: mark.length }, (_, i) =>
    '\\u' + mark.charCodeAt(i).toString(16).padStart(4, '0')).join('');
  lines.push(`    "${escaped}" to listOf(`);
  for (const sh of shapesOf(svg)) {
    const bits = [`"${sh.d}"`];
    bits.push(`fill = ${sh.fill === null ? 'null' : sh.fill}`);
    if (sh.stroke !== null) {
      bits.push(`stroke = ${sh.stroke}`);
      bits.push(`strokeWidth = ${f(sh.strokeWidth)}`);
      if (capId[sh.cap]) bits.push(`cap = ${capId[sh.cap]}`);
      if (joinId[sh.join]) bits.push(`join = ${joinId[sh.join]}`);
    }
    if (sh.alpha !== 1) bits.push(`alpha = ${f(sh.alpha)}`);
    if (sh.evenOdd) bits.push('evenOdd = true');
    lines.push(`        GlyphPart(${bits.join(', ')}),`);
  }
  lines.push('    ),');
}
lines.push(')');
lines.push('');
process.stderr.write(`flags drawn: ${drawnFlags} of ${flagMarks.length} marks\n`);

process.stdout.write(lines.join('\n'));
