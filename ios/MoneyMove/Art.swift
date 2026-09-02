// The shared glyph language, iOS half.
//
// The web client draws the same set in public/js/icons.js. Both platforms work
// on a 32×32 grid with the same coordinates, so a glyph can be eyeballed side
// by side and a change to one has an obvious counterpart in the other.
//
// Two kinds of glyph, and the difference decides how a call site uses one:
//
//   ink       — the drawing is ink and takes the theme's colour. Defaults to
//               Palette.current(scheme).ink; pass `tint:` for anything else
//               (a glyph sitting on the accent, a muted one beside ink2 text).
//   inherent  — the drawing owns its colour on every table, in both modes. A
//               coin is gold everywhere; a bronze medal that took the theme's
//               ink would just be a third silver one. `tint:` is ignored.
//
// SF Symbols are used only where Apple's drawing IS our drawing — a filled
// speaker, a filled heart, three z's. Anything with a house character (the
// dice, the coin, the medals, the buildings) is drawn here, so the set reads
// as one family rather than half ours and half Cupertino's. A few otherwise
// obvious symbols are drawn too, because even their `.fill` variants come out
// as line art next to these solid shapes: the door, the ticket, the banknote.

import SwiftUI

// MARK: - the set

enum Glyph: String, CaseIterable {
    // the turn
    case dice, coin, trade, bank, eye, gavel, police
    case soundOn, soundOff, replay, snooze
    // standing and stakes
    case crown, trophy, medalGold, medalSilver, medalBronze, heart, skull
    case people, crane, ticket
    // places and things
    case globe, question, plane, palette, moon, bag, key, shuffle, chart, island
    // money moving
    case cash, payment, chat, bulb
    // buildings
    case house, hotel, houses
    // the rest
    case bolt, warning, toolbox, shield, door, map, scales, sparkle, robot
    case sun, flame, droplet, turbine
}

extension Glyph {
    /// Glyphs that keep a colour of their own on every table, in both modes.
    var isInherentColour: Bool {
        switch self {
        case .coin, .crown, .trophy, .medalGold, .medalSilver, .medalBronze,
             .heart, .police, .moon, .island, .cash, .payment, .bulb, .warning,
             .toolbox, .sparkle, .house, .hotel,
             .bolt, .sun, .flame, .droplet, .turbine:
            return true
        default:
            return false
        }
    }

    /// The SF Symbol that IS this drawing, where one exists. `nil` means the
    /// glyph is drawn by hand below.
    var symbol: String? {
        switch self {
        case .eye: "eye.fill"
        case .soundOn: "speaker.wave.2.fill"
        case .soundOff: "speaker.slash.fill"
        case .replay: "arrow.counterclockwise"
        case .snooze: "zzz"
        case .shield: "shield.fill"
        case .map: "map.fill"
        case .chat: "ellipsis.bubble.fill"
        case .people: "person.2.fill"
        case .question: "questionmark.circle.fill"
        case .plane: "airplane"
        case .palette: "paintpalette.fill"
        case .bag: "bag.fill"
        case .key: "key.fill"
        case .shuffle: "shuffle"
        case .chart: "chart.bar.fill"
        case .bank: "building.columns.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .bulb: "lightbulb.fill"
        case .heart: "heart.fill"
        case .trophy: "trophy.fill"
        case .crown: "crown.fill"
        case .sun: "sun.max.fill"
        case .moon: "moon.fill"
        case .sparkle: "sparkles"
        case .bolt: "bolt.fill"
        case .flame: "flame.fill"
        case .droplet: "drop.fill"
        default: nil
        }
    }

    /// The colour an inherent glyph paints itself, matched to the web set.
    var inherentColour: Color {
        switch self {
        case .heart: Color(hex: 0xE0435C)
        case .warning: Color(hex: 0xF0A92C)
        case .bulb, .sun: Color(hex: 0xF5C542)
        case .cash: Color(hex: 0x2F8F5B)
        case .moon: Color(hex: 0x6F7FD4)
        case .bolt: Color(hex: 0xEAB308)
        case .flame: Color(hex: 0xFB923C)
        case .droplet: Color(hex: 0x5CC9F5)
        default: Color(hex: 0xE8B52E)   // the brass family: coin, crown, trophy, sparkle
        }
    }
}

// MARK: - entry point

/// `Art.icon(.coin, size: 20)` — the same call the web makes as `icon('coin', 20)`.
enum Art {
    static func icon(_ glyph: Glyph, size: CGFloat = 18, tint: Color? = nil) -> Icon {
        Icon(glyph: glyph, size: size, tint: tint)
    }

    /// The banner a board group flies instead of a flag emoji.
    ///
    /// Country-flag emoji don't render at all on Windows and look like a
    /// different vendor's artwork everywhere else, so a group's identity is
    /// carried by its own colour instead: one drawn pennant, tinted per group,
    /// the same shape on every platform. The player's own flag on their avatar
    /// stays an emoji — they chose it, so it is theirs.
    static func groupBanner(_ colour: Color, size: CGFloat = 18) -> GroupBanner {
        GroupBanner(colour: colour, size: size)
    }
}

struct Icon: View {
    @Environment(\.colorScheme) private var scheme
    let glyph: Glyph
    var size: CGFloat = 18
    var tint: Color?

    var body: some View {
        let colour = glyph.isInherentColour
            ? glyph.inherentColour
            : (tint ?? Palette.current(scheme).ink)
        Group {
            if let name = glyph.symbol {
                // Semibold holds Apple's strokes at the same optical weight as
                // the solid shapes drawn below, so a row of mixed glyphs reads
                // as one set.
                Image(systemName: name)
                    .font(.system(size: size * 0.86, weight: .semibold))
                    .symbolRenderingMode(.monochrome)
                    .foregroundStyle(colour)
            } else {
                Canvas { ctx, sz in
                    ctx.scaleBy(x: sz.width / 32, y: sz.height / 32)
                    ArtCanvas.draw(glyph, ctx, ink: colour)
                }
            }
        }
        .frame(width: size, height: size)
    }
}

struct GroupBanner: View {
    @Environment(\.colorScheme) private var scheme
    let colour: Color
    var size: CGFloat = 18

    var body: some View {
        let ink = Palette.current(scheme).ink
        Canvas { ctx, sz in
            ctx.scaleBy(x: sz.width / 32, y: sz.height / 32)
            var pole = ctx
            pole.opacity = 0.55
            pole.stroke(A.line([(7.4, 4.6), (7.4, 28.6)]),
                        with: .color(ink), style: .init(lineWidth: 2.4, lineCap: .round))
            pole.fill(A.circle(7.4, 3.2, 2), with: .color(ink))
            ctx.fill(A.poly([(8.6, 5.2), (28, 5.2), (28, 22.4), (18.3, 16.8), (8.6, 22.4)]),
                     with: .color(colour))
            // A black wash makes the fold a readable second tone out of any hue
            // the server happens to send for a group.
            var fold = ctx
            fold.opacity = 0.2
            fold.fill(A.poly([(18.3, 5.2), (28, 5.2), (28, 22.4), (18.3, 16.8)]), with: .color(.black))
        }
        .frame(width: size, height: size)
    }
}

// MARK: - path helpers, all in 32×32 space

/// Everything below is written in the same coordinates as the web file, so a
/// path can be carried between the two by hand without rescaling anything.
private enum A {
    static func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }

    static func poly(_ pts: [(CGFloat, CGFloat)]) -> Path {
        var path = line(pts)
        path.closeSubpath()
        return path
    }

    static func line(_ pts: [(CGFloat, CGFloat)]) -> Path {
        var path = Path()
        for (i, q) in pts.enumerated() {
            if i == 0 { path.move(to: p(q.0, q.1)) } else { path.addLine(to: p(q.0, q.1)) }
        }
        return path
    }

    static func circle(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
    }

    static func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> Path {
        Path(CGRect(x: x, y: y, width: w, height: h))
    }

    static func rrect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> Path {
        Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: r, style: .continuous)
    }

    /// Five-pointed star, point up — the police badge, the medals, the ticket.
    static func star(_ cx: CGFloat, _ cy: CGFloat, _ outer: CGFloat, _ inner: CGFloat) -> Path {
        var path = Path()
        for i in 0..<10 {
            let r = i.isMultiple(of: 2) ? outer : inner
            let a = (-90 + Double(i) * 36) * .pi / 180
            let q = p(cx + r * CGFloat(cos(a)), cy + r * CGFloat(sin(a)))
            if i == 0 { path.move(to: q) } else { path.addLine(to: q) }
        }
        path.closeSubpath()
        return path
    }

    /// Roof and walls in one pentagon — the building glyphs share it.
    static func hut(_ cx: CGFloat, _ apexY: CGFloat, _ halfW: CGFloat, _ baseY: CGFloat) -> Path {
        poly([(cx, apexY), (cx + halfW, apexY + halfW * 0.8), (cx + halfW, baseY),
              (cx - halfW, baseY), (cx - halfW, apexY + halfW * 0.8)])
    }

    /// A banknote, drawn once for `cash` and again with wings for `payment`.
    static func note(_ ctx: GraphicsContext, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) {
        ctx.fill(rrect(x, y, w, h, 2.2), with: .color(Color(hex: 0x2F8F5B)))
        ctx.fill(rrect(x + 2.4, y + 2.2, w - 4.8, h - 4.4, 1.4), with: .color(Color(hex: 0x4FBB80)))
        ctx.fill(circle(x + w / 2, y + h / 2, min(w, h) * 0.22), with: .color(Color(hex: 0xEAF9F0)))
    }

    /// Ribbon, rim, face, star — one recipe, three metals.
    static func medal(_ ctx: GraphicsContext, ribbonA: UInt32, ribbonB: UInt32, rim: UInt32, face: UInt32) {
        ctx.fill(poly([(9.6, 2.4), (15.2, 12.6), (10.2, 15.5), (4, 5.4)]), with: .color(Color(hex: ribbonA)))
        ctx.fill(poly([(22.4, 2.4), (16.8, 12.6), (21.8, 15.5), (28, 5.4)]), with: .color(Color(hex: ribbonB)))
        ctx.fill(circle(16, 21.6, 8.6), with: .color(Color(hex: rim)))
        ctx.fill(circle(16, 21.6, 6.3), with: .color(Color(hex: face)))
        ctx.fill(star(16, 21.6, 4.3, 1.9), with: .color(Color(hex: rim)))
    }

    /// Fills at a reduced opacity without disturbing the caller's context.
    static func wash(_ ctx: GraphicsContext, _ path: Path, _ colour: Color,
                     _ opacity: Double, eoFill: Bool = false) {
        var c = ctx
        c.opacity = opacity
        c.fill(path, with: .color(colour), style: FillStyle(eoFill: eoFill))
    }
}

// MARK: - the drawings

private enum ArtCanvas {
    // Long by nature: one flat illustration per case, with no shared
    // abstraction to hide behind. Read it beside public/js/icons.js — the
    // numbers are the same ones.
    static func draw(_ glyph: Glyph, _ ctx: GraphicsContext, ink: Color) {
        switch glyph {

        case .dice:
            // Pips are holes rather than dots, so whatever is behind shows
            // through and the die reads on a chip of any colour.
            var back = A.rrect(13, 3.2, 15.8, 15.8, 3.4)
            back.addPath(A.circle(17.6, 7.8, 1.5))
            back.addPath(A.circle(24.2, 14.4, 1.5))
            A.wash(ctx, back, ink, 0.3, eoFill: true)
            var front = A.rrect(3.2, 13, 15.8, 15.8, 3.4)
            for c in [(7.8, 17.6), (14.4, 17.6), (7.8, 24.2), (14.4, 24.2)] {
                front.addPath(A.circle(c.0, c.1, 1.6))
            }
            ctx.fill(front, with: .color(ink), style: FillStyle(eoFill: true))

        case .coin:
            ctx.fill(A.circle(16, 16, 13), with: .color(Color(hex: 0xDC9C1C)))
            ctx.fill(A.circle(16, 16, 10), with: .color(Color(hex: 0xF7C948)))
            let mark = Color(hex: 0xA9761A)
            ctx.stroke(A.line([(16, 8.6), (16, 23.4)]),
                       with: .color(mark), style: .init(lineWidth: 2, lineCap: .round))
            var s = Path()
            s.move(to: A.p(19.8, 12.6))
            s.addCurve(to: A.p(15.8, 10.5), control1: A.p(18.9, 11.2), control2: A.p(17.5, 10.5))
            s.addCurve(to: A.p(11.9, 13.5), control1: A.p(13.5, 10.5), control2: A.p(11.9, 11.7))
            s.addCurve(to: A.p(19.9, 19.7), control1: A.p(11.9, 17.7), control2: A.p(19.9, 15.5))
            s.addCurve(to: A.p(15.8, 22.8), control1: A.p(19.9, 21.6), control2: A.p(18.2, 22.8))
            s.addCurve(to: A.p(11.5, 20.6), control1: A.p(13.9, 22.8), control2: A.p(12.4, 22.0))
            ctx.stroke(s, with: .color(mark), style: .init(lineWidth: 2, lineCap: .round))

        case .trade:
            // A deal: two arms reaching in from opposite sides, hands gripping
            // in the middle. One is a wash and one is solid, so the eye reads
            // two hands rather than one blob. The second hand is the first
            // turned half a turn about the centre of the grid.
            var left = Path()
            left.move(to: A.p(3, 12.8))
            left.addLine(to: A.p(9.4, 12.8))
            left.addLine(to: A.p(17, 16.3))
            left.addLine(to: A.p(14.4, 21.7))
            left.addLine(to: A.p(8.8, 19.1))
            left.addLine(to: A.p(8.8, 24.8))
            left.addLine(to: A.p(3, 24.8))
            left.addQuadCurve(to: A.p(0.8, 22.6), control: A.p(0.8, 24.8))
            left.addLine(to: A.p(0.8, 15))
            left.addQuadCurve(to: A.p(3, 12.8), control: A.p(0.8, 12.8))
            left.closeSubpath()

            var right = Path()
            right.move(to: A.p(29, 19.2))
            right.addLine(to: A.p(22.6, 19.2))
            right.addLine(to: A.p(15, 15.7))
            right.addLine(to: A.p(17.6, 10.3))
            right.addLine(to: A.p(23.2, 12.9))
            right.addLine(to: A.p(23.2, 7.2))
            right.addLine(to: A.p(29, 7.2))
            right.addQuadCurve(to: A.p(31.2, 9.4), control: A.p(31.2, 7.2))
            right.addLine(to: A.p(31.2, 17))
            right.addQuadCurve(to: A.p(29, 19.2), control: A.p(31.2, 19.2))
            right.closeSubpath()

            // Stroking each shape in its own fill rounds the corners without
            // introducing a second tone.
            var back = ctx
            back.opacity = 0.33
            back.fill(left, with: .color(ink))
            back.stroke(left, with: .color(ink), style: .init(lineWidth: 1.5, lineJoin: .round))
            ctx.fill(right, with: .color(ink))
            ctx.stroke(right, with: .color(ink), style: .init(lineWidth: 1.5, lineJoin: .round))

        case .gavel:
            ctx.fill(A.poly([(24.6, 16.4), (29.2, 9.9), (17.4, 1.6), (12.8, 8.1)]), with: .color(ink))
            ctx.stroke(A.line([(19.6, 12.1), (12.7, 21.9)]),
                       with: .color(ink), style: .init(lineWidth: 3.6, lineCap: .round))
            A.wash(ctx, A.rrect(3.4, 23.6, 17.6, 5, 2.2), ink, 0.34)

        case .police:
            // Jail, drawn as the cap rather than the cell — the cell is a tile.
            var crown = Path()
            crown.move(to: A.p(6, 17.4))
            crown.addCurve(to: A.p(16, 7.2), control1: A.p(6, 11.7), control2: A.p(10.5, 7.2))
            crown.addCurve(to: A.p(26, 17.4), control1: A.p(21.5, 7.2), control2: A.p(26, 11.7))
            crown.closeSubpath()
            ctx.fill(crown, with: .color(Color(hex: 0x41508A)))
            ctx.fill(A.rrect(3.4, 17, 25.2, 5.6, 2.2), with: .color(Color(hex: 0x2B3663)))
            ctx.fill(A.star(16, 13.6, 4.4, 2), with: .color(Color(hex: 0xF5C542)))

        case .skull:
            var s = Path()
            s.move(to: A.p(16, 2.6))
            s.addCurve(to: A.p(3.7, 14.6), control1: A.p(9.2, 2.6), control2: A.p(3.7, 8))
            s.addCurve(to: A.p(8.6, 24.1), control1: A.p(3.7, 18.5), control2: A.p(5.6, 22))
            s.addLine(to: A.p(8.6, 27.2))
            s.addCurve(to: A.p(10.9, 29.5), control1: A.p(8.6, 28.5), control2: A.p(9.6, 29.5))
            s.addLine(to: A.p(21.1, 29.5))
            s.addCurve(to: A.p(23.4, 27.2), control1: A.p(22.4, 29.5), control2: A.p(23.4, 28.5))
            s.addLine(to: A.p(23.4, 24.1))
            s.addCurve(to: A.p(28.3, 14.6), control1: A.p(26.4, 22), control2: A.p(28.3, 18.5))
            s.addCurve(to: A.p(16, 2.6), control1: A.p(28.3, 8), control2: A.p(22.8, 2.6))
            s.closeSubpath()
            s.addPath(A.circle(11.1, 14.2, 3.3))
            s.addPath(A.circle(20.9, 14.2, 3.3))
            s.addPath(A.poly([(16, 16.4), (17.7, 20.6), (14.3, 20.6)]))
            s.addPath(A.rect(12.9, 25.1, 1.9, 4.4))
            s.addPath(A.rect(17.2, 25.1, 1.9, 4.4))
            ctx.fill(s, with: .color(ink), style: FillStyle(eoFill: true))

        case .crane:
            ctx.fill(A.rect(2.8, 4.6, 26.4, 3.4), with: .color(ink))
            A.wash(ctx, A.rect(25.4, 8, 3.8, 3.6), ink, 0.5)
            A.wash(ctx, A.rect(13.4, 8, 5.2, 17.2), ink, 0.32)
            ctx.stroke(A.line([(8.4, 8), (8.4, 14.2)]), with: .color(ink), style: .init(lineWidth: 1.8))
            ctx.fill(A.rrect(4.9, 14.2, 7, 5.6, 1.3), with: .color(ink))
            ctx.fill(A.poly([(8.6, 28.6), (12.2, 25), (19.8, 25), (23.4, 28.6)]), with: .color(ink))

        case .globe:
            A.wash(ctx, A.circle(16, 16, 12.9), ink, 0.26)
            ctx.stroke(A.circle(16, 16, 12.9), with: .color(ink), style: .init(lineWidth: 2))
            ctx.stroke(A.line([(3.1, 16), (28.9, 16)]), with: .color(ink), style: .init(lineWidth: 2))
            var m = Path()
            m.move(to: A.p(16, 3.1))
            m.addCurve(to: A.p(21.7, 16), control1: A.p(19.6, 6.6), control2: A.p(21.7, 11.1))
            m.addCurve(to: A.p(16, 28.9), control1: A.p(21.7, 20.9), control2: A.p(19.6, 25.4))
            m.addCurve(to: A.p(10.3, 16), control1: A.p(12.4, 25.4), control2: A.p(10.3, 20.9))
            m.addCurve(to: A.p(16, 3.1), control1: A.p(10.3, 11.1), control2: A.p(12.4, 6.6))
            ctx.stroke(m, with: .color(ink), style: .init(lineWidth: 2))

        case .cash:
            A.note(ctx, 2, 7.5, 28, 17)

        case .door:
            var leaf = Path()
            leaf.move(to: A.p(3.4, 4.4))
            leaf.addLine(to: A.p(13.4, 4.4))
            leaf.addQuadCurve(to: A.p(15.4, 6.4), control: A.p(15.4, 4.4))
            leaf.addLine(to: A.p(15.4, 25.6))
            leaf.addQuadCurve(to: A.p(13.4, 27.6), control: A.p(15.4, 27.6))
            leaf.addLine(to: A.p(3.4, 27.6))
            leaf.closeSubpath()
            A.wash(ctx, leaf, ink, 0.32)
            ctx.fill(A.circle(11.8, 16, 1.5), with: .color(ink))
            let out = StrokeStyle(lineWidth: 2.8, lineCap: .round, lineJoin: .round)
            ctx.stroke(A.line([(18, 16), (28.4, 16)]), with: .color(ink), style: out)
            ctx.stroke(A.line([(23.6, 11), (28.6, 16), (23.6, 21)]), with: .color(ink), style: out)

        case .ticket:
            // The get-out-of-prison card: a stub with a star and a perforation.
            var stub = A.rrect(2.4, 8.4, 27.2, 15.2, 3)
            stub.addPath(A.star(10.6, 16, 4.7, 2.1))
            for y in [12.2, 16.0, 19.8] { stub.addPath(A.circle(21.2, y, 1.1)) }
            ctx.fill(stub, with: .color(ink), style: FillStyle(eoFill: true))

        case .payment:
            // The same note as `cash`, leaving.
            let feather = Color(hex: 0xA3D6BD)
            var leftWing = Path()
            leftWing.move(to: A.p(10.4, 14.2))
            leftWing.addCurve(to: A.p(0.2, 5.6), control1: A.p(7.6, 8.8), control2: A.p(4, 5.8))
            leftWing.addCurve(to: A.p(8.8, 16.2), control1: A.p(0, 10.6), control2: A.p(3.1, 14.6))
            leftWing.closeSubpath()
            var rightWing = Path()
            rightWing.move(to: A.p(21.6, 14.2))
            rightWing.addCurve(to: A.p(31.8, 5.6), control1: A.p(24.4, 8.8), control2: A.p(28, 5.8))
            rightWing.addCurve(to: A.p(23.2, 16.2), control1: A.p(32, 10.6), control2: A.p(28.9, 14.6))
            rightWing.closeSubpath()
            ctx.fill(leftWing, with: .color(feather))
            ctx.fill(rightWing, with: .color(feather))
            A.note(ctx, 7, 11, 18, 12.4)

        case .toolbox:
            ctx.stroke(A.line([(11.6, 9), (11.6, 7.4), (20.4, 7.4), (20.4, 9)]),
                       with: .color(Color(hex: 0x8A5A12)),
                       style: .init(lineWidth: 2.4, lineCap: .round, lineJoin: .round))
            ctx.fill(A.rrect(2.4, 9, 27.2, 17.6, 2.6), with: .color(Color(hex: 0xD97B0F)))
            ctx.fill(A.rect(2.4, 14.4, 27.2, 4), with: .color(Color(hex: 0xF0A336)))
            ctx.fill(A.rrect(13.4, 12.4, 5.2, 8.4, 1.4), with: .color(Color(hex: 0x7C3F06)))

        case .house:
            ctx.fill(A.poly([(16, 4), (30, 15.5), (26, 15.5), (26, 28), (6, 28), (6, 15.5), (2, 15.5)]),
                     with: .color(Color(hex: 0x3DDC84)))
            ctx.fill(A.rrect(13, 19, 6, 9, 1), with: .color(Color(hex: 0x0F5132)))

        case .hotel:
            ctx.fill(A.rrect(5, 7, 22, 21, 2), with: .color(Color(hex: 0xF43F5E)))
            ctx.fill(A.rrect(5, 4, 22, 4, 1.6), with: .color(Color(hex: 0xFB7185)))
            let pane = Color(hex: 0xFFE4E6)
            for w in [(8.5, 11.0), (14.0, 11.0), (19.5, 11.0), (8.5, 17.0), (19.5, 17.0)] {
                ctx.fill(A.rrect(w.0, w.1, 4, 4, 0.8), with: .color(pane))
            }
            ctx.fill(A.rrect(13.6, 21, 4.8, 7, 1), with: .color(Color(hex: 0x7F1D3A)))

        case .houses:
            // "The properties you hold", not a building you can buy.
            A.wash(ctx, A.hut(21.5, 5, 8, 26), ink, 0.32)
            var front = A.hut(11.5, 10.6, 9, 27.6)
            front.addPath(A.rect(9.4, 21.4, 4.2, 6.2))
            ctx.fill(front, with: .color(ink), style: FillStyle(eoFill: true))

        case .island:
            var sand = Path()
            sand.move(to: A.p(5.6, 23.6))
            sand.addCurve(to: A.p(16, 18), control1: A.p(5.6, 20.5), control2: A.p(10.2, 18))
            sand.addCurve(to: A.p(26.4, 23.6), control1: A.p(21.8, 18), control2: A.p(26.4, 20.5))
            sand.closeSubpath()
            ctx.fill(sand, with: .color(Color(hex: 0xF0CD88)))
            ctx.stroke(A.line([(15.2, 19.4), (14.2, 10)]),
                       with: .color(Color(hex: 0xA16207)), style: .init(lineWidth: 2.3, lineCap: .round))
            var fronds = Path()
            fronds.move(to: A.p(14.2, 9.6))
            fronds.addCurve(to: A.p(5.5, 10.6), control1: A.p(10.8, 7.4), control2: A.p(6.9, 8.2))
            fronds.addCurve(to: A.p(11.9, 12.2), control1: A.p(8.3, 10), control2: A.p(10.5, 10.8))
            fronds.closeSubpath()
            fronds.move(to: A.p(14.2, 9.6))
            fronds.addCurve(to: A.p(22.4, 12.6), control1: A.p(17.8, 8.2), control2: A.p(21.4, 10))
            fronds.addCurve(to: A.p(15.6, 11.7), control1: A.p(20, 11.2), control2: A.p(17.6, 11))
            fronds.closeSubpath()
            ctx.fill(fronds, with: .color(Color(hex: 0x22C55E)))
            var top = Path()
            top.move(to: A.p(14.2, 9.6))
            top.addCurve(to: A.p(18.6, 2.1), control1: A.p(13.5, 5.8), control2: A.p(15.7, 2.5))
            top.addCurve(to: A.p(16.4, 8.5), control1: A.p(16.8, 4.1), control2: A.p(16.2, 6.5))
            top.closeSubpath()
            ctx.fill(top, with: .color(Color(hex: 0x16A34A)))
            var sea = Path()
            sea.move(to: A.p(2, 27))
            sea.addCurve(to: A.p(9, 27), control1: A.p(4.3, 25.2), control2: A.p(6.7, 25.2))
            sea.addCurve(to: A.p(16, 27), control1: A.p(11.3, 28.8), control2: A.p(13.7, 28.8))
            sea.addCurve(to: A.p(23, 27), control1: A.p(18.3, 25.2), control2: A.p(20.7, 25.2))
            sea.addCurve(to: A.p(30, 27), control1: A.p(25.3, 28.8), control2: A.p(27.7, 28.8))
            ctx.stroke(sea, with: .color(Color(hex: 0x38BDF8)), style: .init(lineWidth: 2.2, lineCap: .round))

        case .scales:
            let bar = StrokeStyle(lineWidth: 2.6, lineCap: .round)
            ctx.stroke(A.line([(16, 6.6), (16, 27.6)]), with: .color(ink), style: bar)
            ctx.stroke(A.line([(6.6, 28.4), (25.4, 28.4)]), with: .color(ink), style: bar)
            ctx.stroke(A.line([(3.4, 9.2), (28.6, 9.2)]), with: .color(ink), style: bar)
            ctx.fill(A.circle(16, 9.2, 2.6), with: .color(ink))
            A.wash(ctx, A.poly([(1.4, 13.6), (12.8, 13.6), (7.1, 21)]), ink, 0.4)
            A.wash(ctx, A.poly([(19.2, 13.6), (30.6, 13.6), (24.9, 21)]), ink, 0.4)

        case .medalGold:
            A.medal(ctx, ribbonA: 0xD1495B, ribbonB: 0xA9394A, rim: 0xD99A1E, face: 0xF7C948)
        case .medalSilver:
            A.medal(ctx, ribbonA: 0x5B6A86, ribbonB: 0x46536C, rim: 0x8B96A4, face: 0xCCD4DC)
        case .medalBronze:
            A.medal(ctx, ribbonA: 0x7A5A3C, ribbonB: 0x5F4530, rim: 0xA4652B, face: 0xCF8B4A)

        case .robot:
            ctx.fill(A.circle(16, 3, 2), with: .color(ink))
            ctx.stroke(A.line([(16, 3.4), (16, 7.8)]),
                       with: .color(ink), style: .init(lineWidth: 2.2, lineCap: .round))
            var head = A.rrect(4.2, 7.6, 23.6, 19, 5)
            head.addPath(A.circle(11.4, 15.2, 2.5))
            head.addPath(A.circle(20.6, 15.2, 2.5))
            head.addPath(A.rect(11.2, 20.4, 9.6, 2.7))
            ctx.fill(head, with: .color(ink), style: FillStyle(eoFill: true))
            A.wash(ctx, A.rrect(0.8, 12.8, 2.8, 7, 1.4), ink, 0.5)
            A.wash(ctx, A.rrect(28.4, 12.8, 2.8, 7, 1.4), ink, 0.5)

        case .turbine:
            let blade = Color(hex: 0x4A86BD)
            ctx.fill(A.poly([(15, 15), (6.5, 8.4), (8.3, 5.8), (16, 13.6)]), with: .color(blade))
            ctx.fill(A.poly([(17, 15.6), (27, 12), (27.7, 15.1), (17.7, 18.4)]), with: .color(blade))
            ctx.fill(A.poly([(15.6, 17.4), (13, 28.4), (9.8, 28.4), (13.3, 17)]), with: .color(blade))
            ctx.fill(A.circle(16, 16, 2.4), with: .color(Color(hex: 0x2C5A85)))

        default:
            // Every remaining case is an SF Symbol and never reaches the canvas.
            break
        }
    }
}

// ------------------------------------------------------------------ flags --
// Country flags, drawn rather than typed — matching public/js/icons.js so the
// board reads the same on every platform. Simplified to stay legible at 13pt:
// right colours, right layout, no detail nobody can see.

private struct FlagArt {
    let bands: [(Color, CGFloat, CGFloat)]      // colour, x or y start, extent
    let vertical: Bool
    let motif: (GraphicsContext) -> Void

    init(vertical: Bool = false,
         bands: [(Color, CGFloat, CGFloat)] = [],
         motif: @escaping (GraphicsContext) -> Void = { _ in }) {
        self.vertical = vertical
        self.bands = bands
        self.motif = motif
    }
}

private let hex = { (v: UInt32) in Color(
    red: Double((v >> 16) & 0xFF) / 255,
    green: Double((v >> 8) & 0xFF) / 255,
    blue: Double(v & 0xFF) / 255) }

/// A board group's mark. Countries get their flag drawn; the regional boards
/// keep their pictograph, which every platform has a glyph for.
struct GroupFlag: View {
    @Environment(\.colorScheme) private var scheme
    let mark: String
    let colour: Color
    var size: CGFloat = 18

    var body: some View {
        let key = mark.replacingOccurrences(of: "\u{FE0F}", with: "")
        if let art = GroupFlag.art[key] {
            Canvas { ctx, sz in
                ctx.scaleBy(x: sz.width / 32, y: sz.height / 32)
                ctx.fill(A.rrect(1, 6, 30, 20, 2.5), with: .color(.white))
                for (c, start, extent) in art.bands {
                    ctx.fill(art.vertical ? A.rect(start, 6, extent, 20) : A.rect(1, start, 30, extent),
                             with: .color(c))
                }
                art.motif(ctx)
                ctx.stroke(A.rrect(1, 6, 30, 20, 2.5), with: .color(.black.opacity(0.22)), lineWidth: 1)
            }
            .frame(width: size, height: size)
        } else if !mark.isEmpty {
            Text(mark).font(.system(size: size * 0.82))
        } else {
            GroupBanner(colour: colour, size: size)
        }
    }

    // Shared with GroupMedallion below — same drawings, two frames.
    fileprivate static let art: [String: FlagArt] = [
        "\u{1F1EE}\u{1F1F3}": FlagArt(bands: [(hex(0xFF9933), 6, 6.7), (.white, 12.7, 6.6), (hex(0x138808), 19.3, 6.7)]) { ctx in
            ctx.stroke(A.circle(16, 16, 2.7), with: .color(hex(0x004466)), lineWidth: 1.1)
        },
        "\u{1F1EC}\u{1F1E7}": FlagArt(bands: [(hex(0x012169), 6, 20)]) { ctx in
            ctx.stroke(A.line([(1, 6), (31, 26)]), with: .color(.white), lineWidth: 4.4)
            ctx.stroke(A.line([(31, 6), (1, 26)]), with: .color(.white), lineWidth: 4.4)
            ctx.stroke(A.line([(1, 6), (31, 26)]), with: .color(hex(0xC8102E)), lineWidth: 2)
            ctx.stroke(A.line([(31, 6), (1, 26)]), with: .color(hex(0xC8102E)), lineWidth: 2)
            ctx.stroke(A.line([(16, 6), (16, 26)]), with: .color(.white), lineWidth: 6.6)
            ctx.stroke(A.line([(1, 16), (31, 16)]), with: .color(.white), lineWidth: 6.6)
            ctx.stroke(A.line([(16, 6), (16, 26)]), with: .color(hex(0xC8102E)), lineWidth: 3.6)
            ctx.stroke(A.line([(1, 16), (31, 16)]), with: .color(hex(0xC8102E)), lineWidth: 3.6)
        },
        "\u{1F1FA}\u{1F1F8}": FlagArt(bands: [(hex(0xB31942), 6, 2.85), (hex(0xB31942), 11.7, 2.85),
                                             (hex(0xB31942), 17.4, 2.85), (hex(0xB31942), 23.1, 2.9)]) { ctx in
            ctx.fill(A.rect(1, 6, 13, 11.4), with: .color(hex(0x0A3161)))
            for (x, y) in [(4.5, 9.0), (8.0, 9.0), (11.5, 9.0), (6.2, 12.0), (9.8, 12.0), (4.5, 15.0), (8.0, 15.0), (11.5, 15.0)] {
                ctx.fill(A.circle(x, y, 0.9), with: .color(.white))
            }
        },
        "\u{1F1E7}\u{1F1F7}": FlagArt(bands: [(hex(0x009C3B), 6, 20)]) { ctx in
            ctx.fill(A.poly([(16, 8), (28.5, 16), (16, 24), (3.5, 16)]), with: .color(hex(0xFFDF00)))
            ctx.fill(A.circle(16, 16, 4.4), with: .color(hex(0x002776)))
        },
        "\u{1F1E9}\u{1F1EA}": FlagArt(bands: [(.black, 6, 6.7), (hex(0xDD0000), 12.7, 6.6), (hex(0xFFCE00), 19.3, 6.7)]),
        "\u{1F1EB}\u{1F1F7}": FlagArt(vertical: true, bands: [(hex(0x0055A4), 1, 10), (.white, 11, 10), (hex(0xEF4135), 21, 10)]),
        "\u{1F1EE}\u{1F1F9}": FlagArt(vertical: true, bands: [(hex(0x009246), 1, 10), (.white, 11, 10), (hex(0xCE2B37), 21, 10)]),
        "\u{1F1E8}\u{1F1F3}": FlagArt(bands: [(hex(0xDE2910), 6, 20)]) { ctx in
            ctx.fill(A.star(7.5, 13.6, 4.2, 1.8), with: .color(hex(0xFFDE00)))
            for (x, y) in [(14.0, 9.4), (16.6, 11.6), (16.6, 14.8), (14.0, 17.0)] {
                ctx.fill(A.circle(x, y, 1), with: .color(hex(0xFFDE00)))
            }
        },
        "\u{1F1EF}\u{1F1F5}": FlagArt { ctx in
            ctx.fill(A.circle(16, 16, 6), with: .color(hex(0xBC002D)))
        },
        "\u{1F1EE}\u{1F1F1}": FlagArt { ctx in
            ctx.fill(A.rect(1, 7.6, 30, 3), with: .color(hex(0x0038B8)))
            ctx.fill(A.rect(1, 21.4, 30, 3), with: .color(hex(0x0038B8)))
            ctx.stroke(A.poly([(16, 11.4), (19.4, 17.3), (12.6, 17.3)]), with: .color(hex(0x0038B8)), lineWidth: 1.1)
            ctx.stroke(A.poly([(16, 20.6), (12.6, 14.7), (19.4, 14.7)]), with: .color(hex(0x0038B8)), lineWidth: 1.1)
        },
        "\u{1F1E8}\u{1F1E6}": FlagArt(vertical: true, bands: [(hex(0xD80621), 1, 8), (hex(0xD80621), 23, 8)]) { ctx in
            ctx.fill(A.star(16, 16, 5.5, 2.2), with: .color(hex(0xD80621)))
        },
        "\u{1F1F9}\u{1F1F7}": FlagArt(bands: [(hex(0xE30A17), 6, 20)]) { ctx in
            ctx.fill(A.circle(14, 16, 5), with: .color(.white))
            ctx.fill(A.circle(15.8, 16, 4), with: .color(hex(0xE30A17)))
            ctx.fill(A.star(21, 16.2, 3.2, 1.4), with: .color(.white))
        },
        "\u{1F1F7}\u{1F1F4}": FlagArt(vertical: true, bands: [(hex(0x002B7F), 1, 10), (hex(0xFCD116), 11, 10), (hex(0xCE1126), 21, 10)]),
        "\u{1F1EA}\u{1F1F8}": FlagArt(bands: [(hex(0xAA151B), 6, 5), (hex(0xF1BF00), 11, 10), (hex(0xAA151B), 21, 5)]) { ctx in
            ctx.fill(A.rrect(7, 13.4, 4.6, 5.2, 1), with: .color(hex(0xAA151B).opacity(0.85)))
        },
        "\u{1F1E6}\u{1F1FA}": FlagArt(bands: [(hex(0x012169), 6, 20)]) { ctx in
            ctx.stroke(A.line([(1, 6), (14, 15.6)]), with: .color(.white), lineWidth: 2.2)
            ctx.stroke(A.line([(14, 6), (1, 15.6)]), with: .color(.white), lineWidth: 2.2)
            ctx.stroke(A.line([(7.5, 6), (7.5, 15.6)]), with: .color(.white), lineWidth: 3)
            ctx.stroke(A.line([(1, 10.8), (14, 10.8)]), with: .color(.white), lineWidth: 3)
            ctx.stroke(A.line([(7.5, 6), (7.5, 15.6)]), with: .color(hex(0xC8102E)), lineWidth: 1.6)
            ctx.stroke(A.line([(1, 10.8), (14, 10.8)]), with: .color(hex(0xC8102E)), lineWidth: 1.6)
            ctx.fill(A.circle(7.5, 21, 1.9), with: .color(.white))
            for (x, y, r) in [(22.0, 11.0, 0.9), (25.5, 14.5, 0.9), (22.0, 18.5, 0.9), (19.0, 15.0, 0.9), (25.0, 20.5, 0.7)] {
                ctx.fill(A.circle(x, y, r), with: .color(.white))
            }
        },
        "\u{1F1EE}\u{1F1EA}": FlagArt(vertical: true, bands: [(hex(0x169B62), 1, 10), (.white, 11, 10), (hex(0xFF883E), 21, 10)]),
    ]
}

// ----------------------------------------------------------- circle coins --
// Circle-native flag art for the board medallion, ported 1:1 from
// public/js/icons.js CIRCLE_FLAG_ART. Same 32×32 canvas; the visible world is
// the circle at (16,16), radius 15. Stripes run edge to edge of the circle,
// cantons and emblems sit re-composed for the round frame — nothing looks
// amputated — and the shared enamel finish (a top-light gloss crescent plus a
// faint shade just inside the rim) is stamped over every flag inside the same
// clip, so the disc reads as a struck coin rather than a flat sticker.

private enum CircleFlagArt {
    /// toFixed(2), as the web applies to computed star/spoke vertices.
    static func f2(_ v: CGFloat) -> CGFloat { (v * 100).rounded() / 100 }

    /// n-point star as one closed path; `rot` −90 aims the first point up;
    /// `inner` is a ratio of R. Mirrors icons.js star() vertex for vertex.
    static func star(_ cx: CGFloat, _ cy: CGFloat, _ points: Int, _ R: CGFloat,
                     _ rot: CGFloat = -90, _ inner: CGFloat = 0.45) -> Path {
        let step = 180 / CGFloat(points)
        var path = Path()
        for i in 0..<(points * 2) {
            let a = (rot + CGFloat(i) * step) * .pi / 180
            let r = i.isMultiple(of: 2) ? R : R * inner
            let q = CGPoint(x: f2(cx + r * cos(a)), y: f2(cy + r * sin(a)))
            if i == 0 { path.move(to: q) } else { path.addLine(to: q) }
        }
        path.closeSubpath()
        return path
    }

    /// Horizontal / vertical thirds that fill the whole square (the clip
    /// rounds them off). First colour paints the full disc so band seams
    /// cannot show; bands 2 and 3 start at 10.67 and 21.33 and run to 32.
    static func discH3(_ ctx: GraphicsContext, _ a: Color, _ b: Color, _ c: Color) {
        ctx.fill(A.rect(0, 0, 32, 32), with: .color(a))
        ctx.fill(A.rect(0, 10.67, 32, 21.33), with: .color(b))
        ctx.fill(A.rect(0, 21.33, 32, 10.67), with: .color(c))
    }

    static func discV3(_ ctx: GraphicsContext, _ a: Color, _ b: Color, _ c: Color) {
        ctx.fill(A.rect(0, 0, 32, 32), with: .color(a))
        ctx.fill(A.rect(10.67, 0, 21.33, 32), with: .color(b))
        ctx.fill(A.rect(21.33, 0, 10.67, 32), with: .color(c))
    }

    /// The Union cross layout, reused at full disc size by GB and at canton
    /// size by AU: corner-to-corner diagonals white dw over red dr, then the
    /// centred cross white cw over red cr. Butt caps, as SVG strokes default.
    static func unionJack(_ ctx: GraphicsContext, _ w: CGFloat, _ h: CGFloat,
                          _ dw: CGFloat, _ dr: CGFloat, _ cw: CGFloat, _ cr: CGFloat) {
        var diag = Path()
        diag.move(to: A.p(0, 0)); diag.addLine(to: A.p(w, h))
        diag.move(to: A.p(w, 0)); diag.addLine(to: A.p(0, h))
        var cross = Path()
        cross.move(to: A.p(w / 2, 0)); cross.addLine(to: A.p(w / 2, h))
        cross.move(to: A.p(0, h / 2)); cross.addLine(to: A.p(w, h / 2))
        ctx.stroke(diag, with: .color(.white), lineWidth: dw)
        ctx.stroke(diag, with: .color(hex(0xC8102E)), lineWidth: dr)
        ctx.stroke(cross, with: .color(.white), lineWidth: cw)
        ctx.stroke(cross, with: .color(hex(0xC8102E)), lineWidth: cr)
    }

    /// India's chakra: a real 24-spoke wheel, stroke-weighted so the spokes
    /// fuse into a ring texture at 22px and separate into spokes at 64px.
    static func chakra(_ ctx: GraphicsContext) {
        let navy = hex(0x000080)
        ctx.stroke(A.circle(16, 16, 4), with: .color(navy), lineWidth: 1.1)
        var spokes = Path()
        for i in 0..<24 {
            let a = CGFloat(i) * .pi / 12
            spokes.move(to: A.p(f2(16 + 1.2 * cos(a)), f2(16 + 1.2 * sin(a))))
            spokes.addLine(to: A.p(f2(16 + 3.5 * cos(a)), f2(16 + 3.5 * sin(a))))
        }
        ctx.stroke(spokes, with: .color(navy), lineWidth: 0.72)
        ctx.fill(A.circle(16, 16, 1), with: .color(navy))
    }

    /// Canada's maple leaf: the right half declared once and mirrored across
    /// x=16, exactly as the web builds its path.
    static let mapleLeaf: Path = {
        let half: [(CGFloat, CGFloat)] = [
            (16, 7.8), (17.1, 10.4), (19.2, 9.6), (18.6, 12.1), (21.4, 11.4),
            (20.3, 13.8), (22.9, 13.9), (21.2, 16.1), (22.6, 18.3), (19.3, 17.9),
            (19.8, 20.3), (16.7, 19.4), (16.7, 23.2),
        ]
        return A.poly(half + half.dropFirst().reversed().map { (f2(32 - $0.0), $0.1) })
    }()

    /// China's constellation: big star plus four minors, each minor rotated so
    /// one point aims at the big star's centre, as the real sheet demands.
    static func cnStars(_ ctx: GraphicsContext) {
        let yellow = hex(0xFFFF00)
        ctx.fill(star(10, 11, 5, 4.6, -90, 0.382), with: .color(yellow))
        for (x, y) in [(17.5, 6.3), (20.6, 9.4), (20.6, 13.6), (17.5, 16.7)] as [(CGFloat, CGFloat)] {
            ctx.fill(star(x, y, 5, 1.7, atan2(11 - y, 10 - x) * 180 / .pi, 0.5),
                     with: .color(yellow))
        }
    }

    /// Brazil's white band — the web's `M10.9 14.5 A12.5 12.5 0 0 1 21.2 16.9`
    /// resolved (centre 13.4797, 26.731; −101.914° → −51.855°) and sampled, so
    /// no arc-direction API ambiguity can flip it between platforms.
    static let brBand: Path = {
        var path = Path()
        let cx: CGFloat = 13.4797, cy: CGFloat = 26.731
        for i in 0...32 {
            let a = (-101.914 + (101.914 - 51.855) * CGFloat(i) / 32) * .pi / 180
            let q = CGPoint(x: cx + 12.5 * cos(a), y: cy + 12.5 * sin(a))
            if i == 0 { path.move(to: q) } else { path.addLine(to: q) }
        }
        return path
    }()

    /// Spain's shield: `M7.5 13.4h4.8v3.4` then the bottom semicircle
    /// (centre 9.9, 16.8, r 2.4, 0° → 180° through the bottom), closed.
    static let esShield: Path = {
        var path = Path()
        path.move(to: A.p(7.5, 13.4))
        path.addLine(to: A.p(12.3, 13.4))
        path.addLine(to: A.p(12.3, 16.8))
        for i in 0...16 {
            let a = CGFloat(i) / 16 * .pi
            path.addLine(to: A.p(9.9 + 2.4 * cos(a), 16.8 + 2.4 * sin(a)))
        }
        path.closeSubpath()
        return path
    }()

    /// The coin finish, stamped once over every flag inside the same clip:
    /// gloss ellipse (16, 4.5) rx15 ry10.5 white .12, inner rim r14.25 black
    /// .10 at width 1.5 — same numbers as the web's COIN_FINISH.
    static func finish(_ ctx: GraphicsContext) {
        ctx.fill(Path(ellipseIn: CGRect(x: 1, y: -6, width: 30, height: 21)),
                 with: .color(.white.opacity(0.12)))
        ctx.stroke(A.circle(16, 16, 14.25), with: .color(.black.opacity(0.10)), lineWidth: 1.5)
    }

    static let art: [String: (GraphicsContext) -> Void] = [
        // India — saffron/white/green thirds, navy chakra.
        "\u{1F1EE}\u{1F1F3}": { ctx in
            discH3(ctx, hex(0xFF9933), .white, hex(0x138808))
            chakra(ctx)
        },
        // United Kingdom — the full Union flag composed for the disc.
        "\u{1F1EC}\u{1F1E7}": { ctx in
            ctx.fill(A.rect(0, 0, 32, 32), with: .color(hex(0x012169)))
            unionJack(ctx, 32, 32, 6, 2, 10, 6)
        },
        // United States — seven explicit stripes (whites drawn as the ground,
        // reds at the web's exact rows), navy canton three stripes deep with
        // the dot-grid star field; a white stripe runs under the canton edge.
        "\u{1F1FA}\u{1F1F8}": { ctx in
            ctx.fill(A.rect(0, 0, 32, 32), with: .color(.white))
            for y in [0, 9.14, 18.29, 27.43] as [CGFloat] {
                ctx.fill(A.rect(0, y, 32, 4.57), with: .color(hex(0xB31942)))
            }
            ctx.fill(A.rect(0, 0, 14.5, 13.71), with: .color(hex(0x0A3161)))
            let rows: [(CGFloat, [CGFloat])] = [
                (2.4, [2.5, 5.7, 8.9, 12.1]), (5.2, [4.1, 7.3, 10.5]),
                (8, [2.5, 5.7, 8.9, 12.1]), (10.8, [4.1, 7.3, 10.5]),
            ]
            for (y, xs) in rows {
                for x in xs { ctx.fill(A.circle(x, y, 0.8), with: .color(.white)) }
            }
        },
        // Brazil — rhombus points near the rim, globe with the white band.
        "\u{1F1E7}\u{1F1F7}": { ctx in
            ctx.fill(A.rect(0, 0, 32, 32), with: .color(hex(0x009C3B)))
            ctx.fill(A.poly([(16, 3.6), (28.4, 16), (16, 28.4), (3.6, 16)]),
                     with: .color(hex(0xFFDF00)))
            ctx.fill(A.circle(16, 16, 5.5), with: .color(hex(0x012169)))
            ctx.stroke(brBand, with: .color(.white), lineWidth: 1.4)
        },
        // Germany.
        "\u{1F1E9}\u{1F1EA}": { ctx in discH3(ctx, .black, hex(0xDD0000), hex(0xFFCE00)) },
        // France.
        "\u{1F1EB}\u{1F1F7}": { ctx in discV3(ctx, hex(0x002654), .white, hex(0xCE1126)) },
        // Italy.
        "\u{1F1EE}\u{1F1F9}": { ctx in discV3(ctx, hex(0x008C45), hex(0xF4F5F0), hex(0xCD212A)) },
        // China — constellation shifted toward centre so it sits whole.
        "\u{1F1E8}\u{1F1F3}": { ctx in
            ctx.fill(A.rect(0, 0, 32, 32), with: .color(hex(0xEE1C25)))
            cnStars(ctx)
        },
        // Japan — the sun, centred.
        "\u{1F1EF}\u{1F1F5}": { ctx in
            ctx.fill(A.rect(0, 0, 32, 32), with: .color(.white))
            ctx.fill(A.circle(16, 16, 8.4), with: .color(hex(0xBC002D)))
        },
        // Israel — stripes edge to edge, Magen David as two stroked triangles.
        "\u{1F1EE}\u{1F1F1}": { ctx in
            ctx.fill(A.rect(0, 0, 32, 32), with: .color(.white))
            let blue = hex(0x0038B8)
            ctx.fill(A.rect(0, 5.2, 32, 3.8), with: .color(blue))
            ctx.fill(A.rect(0, 23, 32, 3.8), with: .color(blue))
            ctx.stroke(A.poly([(16, 10.9), (20.42, 18.55), (11.58, 18.55)]),
                       with: .color(blue), lineWidth: 1.25)
            ctx.stroke(A.poly([(16, 21.1), (11.58, 13.45), (20.42, 13.45)]),
                       with: .color(blue), lineWidth: 1.25)
        },
        // Canada — red bars to the rim, the mirrored maple leaf on the pale.
        "\u{1F1E8}\u{1F1E6}": { ctx in
            ctx.fill(A.rect(0, 0, 32, 32), with: .color(.white))
            let red = hex(0xD80621)
            ctx.fill(A.rect(0, 0, 8, 32), with: .color(red))
            ctx.fill(A.rect(24, 0, 8, 32), with: .color(red))
            ctx.fill(mapleLeaf, with: .color(red))
        },
        // Turkey — crescent from two offset circles, star pointing at it.
        "\u{1F1F9}\u{1F1F7}": { ctx in
            let red = hex(0xE30A17)
            ctx.fill(A.rect(0, 0, 32, 32), with: .color(red))
            ctx.fill(A.circle(12.5, 16, 7), with: .color(.white))
            ctx.fill(A.circle(14.4, 16, 5.7), with: .color(red))
            ctx.fill(star(22.5, 16, 5, 3.2, 180, 0.382), with: .color(.white))
        },
        // Romania.
        "\u{1F1F7}\u{1F1F4}": { ctx in discV3(ctx, hex(0x002B7F), hex(0xFCD116), hex(0xCE1126)) },
        // Spain — 1:2:1 bands, the crest hinted toward the hoist.
        "\u{1F1EA}\u{1F1F8}": { ctx in
            ctx.fill(A.rect(0, 0, 32, 32), with: .color(hex(0xF1BF00)))
            let red = hex(0xAA151B)
            ctx.fill(A.rect(0, 0, 32, 8), with: .color(red))
            ctx.fill(A.rect(0, 24, 32, 8), with: .color(red))
            // The web draws both crest pieces in one .9-opacity group; the
            // shapes never overlap, so per-shape opacity is identical.
            ctx.fill(A.rrect(8.3, 11.9, 3.2, 1, 0.4), with: .color(red.opacity(0.9)))
            ctx.fill(esShield, with: .color(red.opacity(0.9)))
        },
        // Australia — Union canton upper-left, Commonwealth star below it,
        // the Southern Cross (four 7-point majors + 5-point ε) on the fly.
        "\u{1F1E6}\u{1F1FA}": { ctx in
            ctx.fill(A.rect(0, 0, 32, 32), with: .color(hex(0x012169)))
            unionJack(ctx, 16, 14, 2.6, 1.1, 4.6, 2.6)
            ctx.fill(star(8, 22, 7, 3.4, -90, 0.5), with: .color(.white))
            for (x, y) in [(24.0, 4.5), (24.0, 27.0), (20.0, 12.5), (27.5, 10.5)] {
                ctx.fill(star(x, y, 7, 1.9, -90, 0.5), with: .color(.white))
            }
            ctx.fill(star(25, 17.5, 5, 1.2, -90, 0.5), with: .color(.white))
        },
        // Ireland.
        "\u{1F1EE}\u{1F1EA}": { ctx in discV3(ctx, hex(0x169B62), .white, hex(0xFF883E)) },
    ]
}

/// The round medallion a property tile pins to its inner edge — richup's
/// look. Flags with circle-native art (CircleFlagArt, ported from the web's
/// CIRCLE_FLAG_ART) are drawn composed for the disc — stripes to the rim,
/// nothing cropped — with the shared enamel finish inside the clip. A flag
/// without coin art keeps the old treatment: the 30×20 GroupFlag panel blown
/// up until its short side spans the disc, centred, overflow cropped. A thin
/// light ring and a soft shadow lift it off the tile in both palettes.
///
/// Regional boards keep their pictograph: the mark sits centred in the same
/// circle on a recessed wash, so a castle reads as a badge rather than
/// pretending to be a flag. No mark at all falls back to the group pennant.
struct GroupMedallion: View {
    @Environment(\.colorScheme) private var scheme
    let mark: String
    let colour: Color
    var size: CGFloat = 18

    var body: some View {
        let key = mark.replacingOccurrences(of: "\u{FE0F}", with: "")
        Group {
            if let coin = CircleFlagArt.art[key] {
                // Circle-native: web coordinates (32×32 grid, visible world =
                // circle (16,16) r15) scaled by size/32. The card ground shows
                // through the 1-unit margin outside r15, exactly as the web
                // medal's background does around its coin SVG.
                Canvas { ctx, sz in
                    ctx.fill(Path(ellipseIn: CGRect(origin: .zero, size: sz)),
                             with: .color(Palette.current(scheme).card))
                    var face = ctx
                    face.scaleBy(x: sz.width / 32, y: sz.height / 32)
                    face.clip(to: A.circle(16, 16, 15))
                    coin(face)
                    CircleFlagArt.finish(face)
                }
            } else if let art = GroupFlag.art[key] {
                Canvas { ctx, sz in
                    var face = ctx
                    face.clip(to: Path(ellipseIn: CGRect(origin: .zero, size: sz)))
                    // Cover, not contain: scale so 20 grid units (the panel's
                    // height) fill the diameter, and put the panel's centre —
                    // (16, 16) in grid space — at the centre of the disc.
                    let s = sz.height / 20
                    face.translateBy(x: sz.width / 2 - 16 * s, y: sz.height / 2 - 16 * s)
                    face.scaleBy(x: s, y: s)
                    face.fill(A.rect(1, 6, 30, 20), with: .color(.white))
                    for (c, start, extent) in art.bands {
                        face.fill(art.vertical ? A.rect(start, 6, extent, 20) : A.rect(1, start, 30, extent),
                                  with: .color(c))
                    }
                    art.motif(face)
                }
            } else {
                Circle().fill(Palette.current(scheme).sunken)
                    .overlay {
                        if mark.isEmpty {
                            GroupBanner(colour: colour, size: size * 0.6)
                        } else {
                            Text(mark).font(.system(size: size * 0.56))
                        }
                    }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        // A fixed near-white, not a palette ink: the ring has to read as the
        // same coin rim on a cream board and a midnight one.
        .overlay(Circle().stroke(Color(hex: 0xF7F4EC).opacity(0.95), lineWidth: 1.5))
        .shadow(color: .black.opacity(0.35), radius: 2.5, y: 1)
    }
}

extension Art {
    static func groupFlag(_ mark: String?, _ colour: Color, size: CGFloat = 18) -> GroupFlag {
        GroupFlag(mark: mark ?? "", colour: colour, size: size)
    }

    /// The board-tile badge — see GroupMedallion. Deed sheets and pickers keep
    /// the rectangular groupFlag; only tiles wear the coin.
    static func groupMedallion(_ mark: String?, _ colour: Color, size: CGFloat = 18) -> GroupMedallion {
        GroupMedallion(mark: mark ?? "", colour: colour, size: size)
    }
}


// MARK: - Google G

/// The four-colour Google "G", drawn in code — no asset, no borrowed image.
/// Quarter arcs land each colour where the real mark puts it: blue on the
/// right running into the crossbar, green along the bottom, yellow up the
/// left, red across the top.
struct GoogleG: View {
    var size: CGFloat = 16

    var body: some View {
        ZStack {
            seg(0.03, 0.25, Color(red: 0.26, green: 0.52, blue: 0.96))  // right: blue
            seg(0.25, 0.50, Color(red: 0.20, green: 0.66, blue: 0.33))  // bottom: green
            seg(0.50, 0.75, Color(red: 0.98, green: 0.74, blue: 0.02))  // left: yellow
            seg(0.75, 0.97, Color(red: 0.92, green: 0.26, blue: 0.21))  // top: red
            Rectangle()  // the crossbar that makes it a G, not an O
                .fill(Color(red: 0.26, green: 0.52, blue: 0.96))
                .frame(width: size * 0.42, height: size * 0.21)
                .offset(x: size * 0.19, y: 0)
        }
        .frame(width: size, height: size)
    }

    private func seg(_ from: CGFloat, _ to: CGFloat, _ colour: Color) -> some View {
        Circle().trim(from: from, to: to)
            .stroke(colour, style: StrokeStyle(lineWidth: size * 0.21, lineCap: .butt))
            .padding(size * 0.105)
    }
}
