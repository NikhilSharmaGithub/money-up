// Turns the web client's drawn flags into Swift for the iOS app — only the
// ones the app has no hand-drawn port of. Art.swift's CircleFlagArt and
// GroupFlag tables were ported by hand, flag by flag, and those stay: they
// were tuned against the web by eye and they keep winning. Everything else in
// public/js/icons.js arrives here as a table of drawing closures, so a new
// board's countries wear their flags on iOS the day the web draws them,
// instead of the day someone ports thirty-six flags twice.
//
//   node tools/gen-flags-swift.mjs     → writes ios/MoneyMove/FlagArtGenerated.swift
//
// The SVG is read by svg-shapes.mjs, the same reader gen-glyphs.mjs uses for
// Android, so the two apps see the same shapes in the same paint order. What
// this file adds is the one thing Android does not need: SwiftUI has no SVG
// path parser, so path data is resolved here into absolute moves, lines,
// cubics and quadratics — arcs become cubics — and written out as Path calls.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CIRCLE_FLAG_ART, FLAG_ART } from '../public/js/icons.js';
import { GROUPS } from '../server/maps.js';
import { shapesOf } from './svg-shapes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ART_SWIFT = `${ROOT}ios/MoneyMove/Art.swift`;
const OUT = `${ROOT}ios/MoneyMove/FlagArtGenerated.swift`;

// ── path data → absolute M / L / C / Q / Z ────────────────────────────────

/**
 * Reads SVG path data into absolute segments:
 * ['M', x, y] ['L', x, y] ['C', x1, y1, x2, y2, x, y] ['Q', x1, y1, x, y] ['Z'].
 * H/V become lines, S/T become their full forms with the reflected control
 * point, and every arc becomes one cubic per quarter turn or less.
 */
export function absolutePath(d) {
  let i = 0;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const number = () => {
    skip();
    const m = d.slice(i).match(/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/);
    if (!m) throw new Error(`path data: number expected at ${i} in "${d.slice(0, 60)}…"`);
    i += m[0].length;
    return Number(m[0]);
  };
  // Arc flags are a single 0 or 1 and may run straight into the next number.
  const flag = () => {
    skip();
    const c = d[i++];
    if (c !== '0' && c !== '1') throw new Error(`path data: arc flag expected at ${i - 1}`);
    return c === '1';
  };
  const more = () => { skip(); return i < d.length && /[-+.\d]/.test(d[i]); };

  const out = [];
  let x = 0; let y = 0; let sx = 0; let sy = 0;
  let prev = null; // last command letter, upper-cased, for S/T reflection
  let cx = 0; let cy = 0; // last control point
  let cmd = null;
  let closed = false;
  const move = (nx, ny) => { out.push(['M', nx, ny]); x = sx = nx; y = sy = ny; closed = false; };
  // A drawing command straight after Z starts a new subpath at the old start;
  // say so explicitly rather than leave it to each renderer's convention.
  const reopen = () => { if (closed) { out.push(['M', sx, sy]); closed = false; } };

  while (true) {
    skip();
    if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) cmd = d[i++];
    else if (!cmd) throw new Error(`path data: command expected in "${d.slice(0, 60)}…"`);
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0; const oy = rel ? y : 0;
    switch (C) {
      case 'M': {
        move(ox + number(), oy + number());
        prev = 'M';
        cmd = rel ? 'l' : 'L'; // pairs after a move are lines
        continue;
      }
      case 'Z':
        out.push(['Z']);
        x = sx; y = sy; closed = true; prev = 'Z';
        cmd = null; // Z takes no numbers, so none may follow it
        continue;
      case 'L': case 'H': case 'V': {
        reopen();
        const nx = C === 'V' ? x : ox + number();
        const ny = C === 'H' ? y : oy + number();
        out.push(['L', nx, ny]); x = nx; y = ny;
        break;
      }
      case 'C': case 'S': {
        reopen();
        let x1; let y1;
        if (C === 'C') { x1 = ox + number(); y1 = oy + number(); }
        else if (prev === 'C' || prev === 'S') { x1 = 2 * x - cx; y1 = 2 * y - cy; }
        else { x1 = x; y1 = y; }
        const x2 = ox + number(); const y2 = oy + number();
        const nx = ox + number(); const ny = oy + number();
        out.push(['C', x1, y1, x2, y2, nx, ny]);
        cx = x2; cy = y2; x = nx; y = ny;
        break;
      }
      case 'Q': case 'T': {
        reopen();
        let x1; let y1;
        if (C === 'Q') { x1 = ox + number(); y1 = oy + number(); }
        else if (prev === 'Q' || prev === 'T') { x1 = 2 * x - cx; y1 = 2 * y - cy; }
        else { x1 = x; y1 = y; }
        const nx = ox + number(); const ny = oy + number();
        out.push(['Q', x1, y1, nx, ny]);
        cx = x1; cy = y1; x = nx; y = ny;
        break;
      }
      case 'A': {
        reopen();
        const rx = number(); const ry = number(); const rot = number();
        const large = flag(); const sweep = flag();
        const nx = ox + number(); const ny = oy + number();
        for (const seg of arcToCubics(x, y, rx, ry, rot, large, sweep, nx, ny)) out.push(seg);
        x = nx; y = ny;
        break;
      }
      default:
        throw new Error(`path data: unknown command ${cmd}`);
    }
    prev = C;
    // Implicit repeats: the same command again while numbers keep coming.
    if (!more()) cmd = null;
  }
  return out;
}

/**
 * An SVG arc as cubic Béziers, one per quarter turn or less — the endpoint
 * parameterisation of the SVG spec (appendix B.2.4) converted to centre form,
 * then each slice approximated with the 4/3·tan(θ/4) handle length.
 */
function arcToCubics(x1, y1, rx, ry, rotDeg, large, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [['L', x2, y2]];
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi); const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2; const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (x1p - cxp) / rx; const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx; const vy = (-y1p - cyp) / ry;
  const theta = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const n = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (a) => [
    cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin,
    cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos,
  ];
  const tangent = (a) => [
    -rx * Math.sin(a) * cos - ry * Math.cos(a) * sin,
    -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos,
  ];
  const segs = [];
  for (let s = 0; s < n; s++) {
    const a1 = theta + s * step; const a2 = a1 + step;
    const [px, py] = at(a1); const [qx, qy] = s === n - 1 ? [x2, y2] : at(a2);
    const [tx1, ty1] = tangent(a1); const [tx2, ty2] = tangent(a2);
    segs.push(['C', px + k * tx1, py + k * ty1, qx - k * tx2, qy - k * ty2, qx, qy]);
  }
  return segs;
}

// ── Swift ─────────────────────────────────────────────────────────────────

/** A CGFloat literal: three decimals, no exponent, no negative zero. */
const lit = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
};

const hex = (argb) => {
  if (argb === 'INK') throw new Error('a flag cannot be drawn in ink — it has colours of its own');
  return `0x${argb.slice(4)}`;
};

/** Regional-indicator pair → its ISO letters, for readable function names. */
const isoOf = (mark) => {
  const cps = [...mark].map((c) => c.codePointAt(0));
  if (cps.length === 2 && cps.every((c) => c >= 0x1F1E6 && c <= 0x1F1FF)) {
    return cps.map((c) => String.fromCharCode(c - 0x1F1E6 + 65)).join('');
  }
  return cps.map((c) => c.toString(16).toUpperCase()).join('_');
};

const swiftKey = (mark) =>
  `"${[...mark].map((c) => `\\u{${c.codePointAt(0).toString(16).toUpperCase()}}`).join('')}"`;

/** The keys of one hand-written `static let art … = [ … ]` table in Art.swift. */
function handDrawnKeys(swift, owner, decl) {
  const from = swift.indexOf(owner);
  if (from < 0) throw new Error(`Art.swift: ${owner} not found`);
  const start = swift.indexOf(decl, from);
  if (start < 0) throw new Error(`Art.swift: ${decl} not found after ${owner}`);
  const end = swift.indexOf('\n    ]\n', start);
  const block = swift.slice(start, end);
  const keys = new Set();
  for (const m of block.matchAll(/^ {8}"((?:\\u\{[0-9A-Fa-f]+\})+)":/gm)) {
    keys.add(String.fromCodePoint(...[...m[1].matchAll(/\\u\{([0-9A-Fa-f]+)\}/g)].map((x) => parseInt(x[1], 16))));
  }
  if (!keys.size) throw new Error(`Art.swift: no keys read from ${owner}`);
  return keys;
}

const CAP = { butt: '.butt', round: '.round', square: '.square' };
const JOIN = { miter: '.miter', round: '.round', bevel: '.bevel' };

/** Statements packed onto lines of at most `width`, each line indented. */
const packLines = (stmts, indent, width = 108) => {
  const lines = [];
  let cur = '';
  for (const s of stmts) {
    if (cur && indent.length + cur.length + 2 + s.length > width) { lines.push(indent + cur); cur = s; }
    else cur = cur ? `${cur}; ${s}` : s;
  }
  if (cur) lines.push(indent + cur);
  return lines;
};

/** One flag's parts as the body of a Swift function returning [Part]. */
function emitFunction(name, svgBody, comment) {
  const parts = shapesOf(`<svg viewBox="0 0 32 32" fill="none">${svgBody}</svg>`);
  if (!parts.length) throw new Error(`${name}: no shapes`);
  const L = [];
  L.push(`    /// ${comment}`);
  L.push(`    private static func ${name}() -> [Part] {`);
  L.push('        var parts: [Part] = []');
  parts.forEach((pt, idx) => {
    L.push(`        ${idx ? 'p' : 'var p'} = Path()`);
    const stmts = absolutePath(pt.d).map((s) => {
      switch (s[0]) {
        case 'M': return `p.m(${lit(s[1])}, ${lit(s[2])})`;
        case 'L': return `p.l(${lit(s[1])}, ${lit(s[2])})`;
        case 'C': return `p.c(${s.slice(1).map(lit).join(', ')})`;
        case 'Q': return `p.q(${s.slice(1).map(lit).join(', ')})`;
        default: return 'p.z()';
      }
    });
    L.push(...packLines(stmts, '        '));
    const args = ['p'];
    if (pt.fill !== null) args.push(`fill: ${hex(pt.fill)}`);
    if (pt.stroke !== null) {
      args.push(`stroke: ${hex(pt.stroke)}`);
      if (pt.strokeWidth !== 1) args.push(`width: ${lit(pt.strokeWidth)}`);
      if (pt.cap !== 'butt') args.push(`cap: ${CAP[pt.cap]}`);
      if (pt.join !== 'miter') args.push(`join: ${JOIN[pt.join]}`);
      if (pt.dash) args.push(`dash: [${pt.dash.map(lit).join(', ')}]`);
    }
    if (pt.alpha !== 1) args.push(`alpha: ${lit(pt.alpha)}`);
    if (pt.evenOdd) args.push('evenOdd: true');
    L.push(`        parts.append(part(${args.join(', ')}))`);
  });
  L.push('        return parts');
  L.push('    }');
  return L.join('\n');
}

function generate() {
  const swift = readFileSync(ART_SWIFT, 'utf8');
  const handCoins = handDrawnKeys(swift, 'private enum CircleFlagArt', 'static let art:');
  const handPanels = handDrawnKeys(swift, 'struct GroupFlag: View', 'fileprivate static let art:');

  const names = new Map();
  for (const g of Object.values(GROUPS)) if (g.flag && !names.has(g.flag)) names.set(g.flag, g.name);
  const label = (mark) => names.get(mark) || isoOf(mark);

  const coins = Object.keys(CIRCLE_FLAG_ART).filter((k) => !handCoins.has(k));
  const panels = Object.keys(FLAG_ART).filter((k) => !handPanels.has(k));

  const table = (list, prefix) => list.map((k) =>
    `        ${swiftKey(k)}: ${prefix}${isoOf(k)}(),   // ${label(k)}`).join('\n');

  const out = [];
  out.push('// GENERATED — do not edit by hand.');
  out.push('//');
  out.push('// The flags public/js/icons.js draws that Art.swift has no hand-drawn port');
  out.push('// of, as SwiftUI drawing closures on the same 32×32 grid. GroupMedallion');
  out.push('// asks CircleFlagArt first and only then `coins`; GroupFlag asks its own');
  out.push('// table first and only then `panels` — so a flag someone ports by hand');
  out.push('// replaces its generated twin, and the next run of the generator drops it');
  out.push('// from here.');
  out.push('//');
  out.push('// Regenerate with tools/gen-flags-swift.mjs after changing icons.js.');
  out.push('');
  out.push('import SwiftUI');
  out.push('');
  out.push('enum GeneratedFlagArt {');
  out.push('    /// Disc art for GroupMedallion, keyed by the group\'s flag emoji: composed');
  out.push('    /// for the circle at (16, 16) r15, drawn under the medallion\'s clip and');
  out.push('    /// before its enamel finish, exactly like CircleFlagArt.art.');
  out.push('    static let coins: [String: (GraphicsContext) -> Void] = coinParts.mapValues(drawing)');
  out.push('');
  out.push('    /// Panel art for GroupFlag: the whole 30×20 cloth at (1, 6), its white');
  out.push('    /// ground and faint outline included.');
  out.push('    static let panels: [String: (GraphicsContext) -> Void] = panelParts.mapValues(drawing)');
  out.push('');
  out.push('    /// One filled and/or stroked subpath, in the web\'s paint order.');
  out.push('    private struct Part {');
  out.push('        let path: Path');
  out.push('        let fill: Color?');
  out.push('        let stroke: Color?');
  out.push('        let style: StrokeStyle');
  out.push('        let evenOdd: Bool');
  out.push('    }');
  out.push('');
  out.push('    private static func drawing(_ parts: [Part]) -> (GraphicsContext) -> Void {');
  out.push('        { ctx in');
  out.push('            for part in parts {');
  out.push('                if let fill = part.fill {');
  out.push('                    ctx.fill(part.path, with: .color(fill), style: FillStyle(eoFill: part.evenOdd))');
  out.push('                }');
  out.push('                if let stroke = part.stroke {');
  out.push('                    ctx.stroke(part.path, with: .color(stroke), style: part.style)');
  out.push('                }');
  out.push('            }');
  out.push('        }');
  out.push('    }');
  out.push('');
  out.push('    /// sRGB, as Art.swift\'s own hex colours are. Opacity folds into the');
  out.push('    /// colour, which is how the web\'s opacity lands on a single shape.');
  out.push('    private static func rgb(_ v: UInt32, _ alpha: Double) -> Color {');
  out.push('        Color(.sRGB, red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255,');
  out.push('              blue: Double(v & 0xFF) / 255, opacity: alpha)');
  out.push('    }');
  out.push('');
  out.push('    /// SVG\'s stroke defaults: width 1, butt caps, mitre joins limited at 4.');
  out.push('    private static func part(_ path: Path, fill: UInt32? = nil, stroke: UInt32? = nil,');
  out.push('                             width: CGFloat = 1, cap: CGLineCap = .butt, join: CGLineJoin = .miter,');
  out.push('                             dash: [CGFloat] = [], alpha: Double = 1, evenOdd: Bool = false) -> Part {');
  out.push('        Part(path: path,');
  out.push('             fill: fill.map { rgb($0, alpha) },');
  out.push('             stroke: stroke.map { rgb($0, alpha) },');
  out.push('             style: StrokeStyle(lineWidth: width, lineCap: cap, lineJoin: join, miterLimit: 4, dash: dash),');
  out.push('             evenOdd: evenOdd)');
  out.push('    }');
  out.push('');
  out.push('    private static let coinParts: [String: [Part]] = [');
  out.push(coins.length ? table(coins, 'coin') : '        :');
  out.push('    ]');
  out.push('');
  out.push('    private static let panelParts: [String: [Part]] = [');
  out.push(panels.length ? table(panels, 'panel') : '        :');
  out.push('    ]');
  out.push('');
  out.push('    // MARK: - Coins');
  for (const k of coins) {
    out.push('');
    out.push(emitFunction(`coin${isoOf(k)}`, CIRCLE_FLAG_ART[k], `${label(k)}.`));
  }
  out.push('');
  out.push('    // MARK: - Panels');
  for (const k of panels) {
    out.push('');
    out.push(emitFunction(`panel${isoOf(k)}`, FLAG_ART[k], `${label(k)}.`));
  }
  out.push('}');
  out.push('');
  out.push('// Short names for the four moves path data resolves into, so a flag reads');
  out.push('// as its outline rather than as a wall of CGPoint(x:y:).');
  out.push('private extension Path {');
  out.push('    mutating func m(_ x: CGFloat, _ y: CGFloat) { move(to: CGPoint(x: x, y: y)) }');
  out.push('    mutating func l(_ x: CGFloat, _ y: CGFloat) { addLine(to: CGPoint(x: x, y: y)) }');
  out.push('    mutating func c(_ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat, _ x: CGFloat, _ y: CGFloat) {');
  out.push('        addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: x1, y: y1), control2: CGPoint(x: x2, y: y2))');
  out.push('    }');
  out.push('    mutating func q(_ x1: CGFloat, _ y1: CGFloat, _ x: CGFloat, _ y: CGFloat) {');
  out.push('        addQuadCurve(to: CGPoint(x: x, y: y), control: CGPoint(x: x1, y: y1))');
  out.push('    }');
  out.push('    mutating func z() { closeSubpath() }');
  out.push('}');
  out.push('');

  writeFileSync(OUT, out.join('\n'));
  process.stderr.write(`coins generated: ${coins.length} (hand-drawn: ${handCoins.size}); ` +
    `panels generated: ${panels.length} (hand-drawn: ${handPanels.size})\n`);
}

// Run when invoked; stay quiet when imported (the proof page borrows
// absolutePath to check the arcs came out where the browser puts them).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) generate();
