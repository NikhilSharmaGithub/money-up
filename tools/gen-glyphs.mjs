// Turns the web client's drawn glyph set into the Kotlin the Android app
// renders. One source of art for three platforms: change public/js/icons.js
// and re-run this, rather than redrawing sixty-two icons by eye.
import { ART, ICON_NAMES, INHERENT_COLOUR } from '../public/js/icons.js';

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
    if (tok.startsWith('</')) { if (name === 'g') stack.pop(); continue; }
    const raw = attrs(tok);
    const parent = stack[stack.length - 1];
    // What this element ends up with: its own attributes over its parents'.
    const a = { ...raw };
    for (const key of INHERITED) if (a[key] === undefined && parent[key] !== undefined) a[key] = parent[key];

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
      alpha: group * (a.opacity ? num(a.opacity) : 1),
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
process.stdout.write(lines.join('\n'));
