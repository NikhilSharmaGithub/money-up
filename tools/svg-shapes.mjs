// Reads the web client's SVG strings into flat, drawable parts: one subpath,
// its fill, its stroke, and the opacity it ends up with once its groups have
// had their say. Both native generators — gen-glyphs.mjs for Android and
// gen-flags-swift.mjs for iOS — read the art through this one reader, so a
// shape one platform understands is a shape the other does too, and a fix
// here reaches both.
//
// It understands exactly what icons.js writes: rect, circle, ellipse, line and
// path, inside nested <g>s that pass their paint down, hex colours or
// currentColor, and a <clipPath> that the renderer supplies itself.

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

// Attribute names may carry digits after the first letter. A reader that
// only took letters never saw a <line>'s x1/y1/x2/y2, drew every one as
// "M0 0L0 0", and left India's chakra on Android as a ring with no spokes.
const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

/** A paint as 0xAARRGGBB text, 'INK' for currentColor, null for no paint. */
export const colour = (v) => {
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

/**
 * Every drawable shape in an SVG string, in paint order, as
 * { d, fill, stroke, strokeWidth, cap, join, dash, alpha, evenOdd }.
 * A part carries one alpha for its fill and its stroke together, so a
 * stroke-opacity is honoured when the shape has no fill (the coin's faint
 * inner rim) and a fill-opacity when it has no stroke.
 */
export function shapesOf(svg) {
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
    const fill = colour(a.fill);
    const stroke = colour(a.stroke);
    // A fill="none" is still a fill attribute; what matters is whether any
    // paint lands. Keying this on the attribute's presence dropped the rim's
    // .1 and drew every Android coin with a solid black ring.
    const strokeOnly = a['stroke-opacity'] && fill === null ? num(a['stroke-opacity']) : 1;
    const fillOnly = a['fill-opacity'] && stroke === null ? num(a['fill-opacity']) : 1;
    out.push({
      d: d.replace(/\s+/g, ' ').trim(),
      fill,
      stroke,
      strokeWidth: a['stroke-width'] ? num(a['stroke-width']) : 1,
      cap: a['stroke-linecap'] || 'butt',
      join: a['stroke-linejoin'] || 'miter',
      dash: a['stroke-dasharray']
        ? a['stroke-dasharray'].split(/[\s,]+/).filter(Boolean).map(num) : null,
      alpha: parent.opacity * (a.opacity ? num(a.opacity) : 1) * strokeOnly * fillOnly,
      evenOdd: a['fill-rule'] === 'evenodd',
    });
  }
  return out;
}
