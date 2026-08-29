// The design system: the same red-and-white identity as the web client,
// dark-first, with a light palette that follows the system setting.

import SwiftUI

struct Palette {
    // surfaces
    let page: Color        // screen background
    let page2: Color       // deep edge of the page gradient
    let card: Color        // panels / tiles
    let sunken: Color      // recessed areas inside a card
    let boardBG: Color     // board frame fill

    // text
    let ink: Color
    let ink2: Color
    let ink3: Color

    // hairlines
    let rule: Color
    let rule2: Color

    // brand + semantics
    let red: Color
    let redDeep: Color
    let redSoft: Color
    let good: Color
    let goodSoft: Color
    let bad: Color
    let gold: Color
    let goldSoft: Color

    // special tile faces
    let tileTreasure: Color
    let tileSurprise: Color
    let tileTax: Color
    let tileRefund: Color
    let tileStart: Color
    let tileGoto: Color
    let tileVacation: Color
    let tileJail: Color
    let tileCorner: Color

    static let dark = Palette(
        page: Color(hex: 0x150A0E), page2: Color(hex: 0x0D0508),
        card: Color(hex: 0x211319), sunken: Color(hex: 0x2B1A21), boardBG: Color(hex: 0x1A0E13),
        ink: Color(hex: 0xF4EAED), ink2: Color(hex: 0xBDA8B0), ink3: Color(hex: 0x8D757E),
        rule: Color(hex: 0x382330), rule2: Color(hex: 0x4A2F3C),
        red: Color(hex: 0xF04156), redDeep: Color(hex: 0xC4243A), redSoft: Color(hex: 0x3A1620),
        good: Color(hex: 0x4ADE80), goodSoft: Color(hex: 0x16301F),
        bad: Color(hex: 0xFB7185),
        gold: Color(hex: 0xFBBF24), goldSoft: Color(hex: 0x35240D),
        tileTreasure: Color(hex: 0x33250F), tileSurprise: Color(hex: 0x351327),
        tileTax: Color(hex: 0x3A1620), tileRefund: Color(hex: 0x16301F),
        tileStart: Color(hex: 0x12331F), tileGoto: Color(hex: 0x3D1720),
        tileVacation: Color(hex: 0x12312F), tileJail: Color(hex: 0x1F2338),
        tileCorner: Color(hex: 0x33202A)
    )

    static let light = Palette(
        page: Color(hex: 0xB31527), page2: Color(hex: 0x8E0F1E),
        card: .white, sunken: Color(hex: 0xF4EEEA), boardBG: Color(hex: 0xFFFAF7),
        ink: Color(hex: 0x1E1A1C), ink2: Color(hex: 0x5F5359), ink3: Color(hex: 0x948890),
        rule: Color(hex: 0xE9E0DB), rule2: Color(hex: 0xD8CAC3),
        red: Color(hex: 0xD92037), redDeep: Color(hex: 0xA4142A), redSoft: Color(hex: 0xFDECEE),
        good: Color(hex: 0x157F4A), goodSoft: Color(hex: 0xE6F5EC),
        bad: Color(hex: 0xC3283C),
        gold: Color(hex: 0xB7791F), goldSoft: Color(hex: 0xFDF3E0),
        tileTreasure: Color(hex: 0xFDF3E0), tileSurprise: Color(hex: 0xFDEAF3),
        tileTax: Color(hex: 0xFDECEE), tileRefund: Color(hex: 0xE6F5EC),
        tileStart: Color(hex: 0xE9F7EF), tileGoto: Color(hex: 0xFDEAEC),
        tileVacation: Color(hex: 0xE6F6F6), tileJail: Color(hex: 0xEEF0F7),
        tileCorner: Color(hex: 0xFFFDFB)
    )

    static func current(_ scheme: ColorScheme) -> Palette {
        scheme == .light ? .light : .dark
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }

    /// Parses the "#4ade80" strings the server sends for player colours.
    init(css: String) {
        var s = css.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        self.init(hex: UInt32(s, radix: 16) ?? 0x888888)
    }
}

/// Rounded-card container used by every panel in the app.
struct MMCard<Content: View>: View {
    @Environment(\.colorScheme) private var scheme
    var padding: CGFloat = 14
    @ViewBuilder var content: Content

    var body: some View {
        let P = Palette.current(scheme)
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(P.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(P.rule, lineWidth: 1))
            .shadow(color: .black.opacity(scheme == .light ? 0.10 : 0.35), radius: 8, y: 3)
    }
}

/// Section label, matching the web's small-caps panel titles.
struct PanelTitle: View {
    @Environment(\.colorScheme) private var scheme
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .bold))
            .kerning(1)
            .foregroundStyle(Palette.current(scheme).ink3)
    }
}

/// The brand's primary/secondary buttons.
struct MMButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var scheme
    enum Kind { case primary, good, bad, gold, ghost }
    var kind: Kind = .primary
    var big = false

    func makeBody(configuration: Configuration) -> some View {
        let P = Palette.current(scheme)
        let bg: Color = switch kind {
        case .primary: P.red
        case .good: P.good
        case .bad: P.bad
        case .gold: P.gold
        case .ghost: P.sunken
        }
        let fg: Color = kind == .ghost ? P.ink : .white
        configuration.label
            .font(.system(size: big ? 17 : 14, weight: .bold, design: .rounded))
            .foregroundStyle(fg)
            .padding(.vertical, big ? 14 : 9)
            .padding(.horizontal, big ? 22 : 14)
            .frame(maxWidth: big ? .infinity : nil)
            .background(bg, in: RoundedRectangle(cornerRadius: big ? 14 : 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: big ? 14 : 10, style: .continuous)
                    .stroke(.white.opacity(kind == .ghost ? 0 : 0.18), lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.82 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(duration: 0.2), value: configuration.isPressed)
    }
}

/// Player avatar disc with initial, colour and country flag badge.
struct AvatarView: View {
    let name: String
    let colorCSS: String
    let flag: String
    var size: CGFloat = 36

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Circle()
                .fill(Color(css: colorCSS))
                .frame(width: size, height: size)
                .overlay(
                    Text(String(name.prefix(1)).uppercased())
                        .font(.system(size: size * 0.42, weight: .black, design: .rounded))
                        .foregroundStyle(.white)
                )
                .shadow(color: .black.opacity(0.3), radius: 3, y: 2)
            if !flag.isEmpty {
                Text(flag)
                    .font(.system(size: size * 0.36))
                    .offset(x: size * 0.12, y: size * 0.10)
            }
        }
    }
}

enum MMStatic {
    static let flags = [
        "🇮🇳", "🇬🇧", "🇺🇸", "🇧🇷", "🇩🇪", "🇫🇷", "🇮🇹", "🇪🇸", "🇵🇹", "🇳🇱",
        "🇮🇪", "🇨🇭", "🇸🇪", "🇳🇴", "🇩🇰", "🇵🇱", "🇺🇦", "🇹🇷", "🇷🇴", "🇬🇷",
        "🇮🇱", "🇦🇪", "🇸🇦", "🇪🇬", "🇿🇦", "🇳🇬", "🇰🇪", "🇨🇳", "🇯🇵", "🇰🇷",
        "🇹🇭", "🇻🇳", "🇵🇭", "🇮🇩", "🇵🇰", "🇧🇩", "🇱🇰", "🇳🇵", "🇦🇺", "🇳🇿",
        "🇨🇦", "🇲🇽", "🇦🇷", "🇨🇱", "🇨🇴", "🇷🇺", "🇸🇬", "🇲🇾", "🏴‍☠️", "🌍",
    ]
    static let emotes = ["👍", "😂", "😱", "🔥", "💸", "🎲", "😭", "🤝", "🏠", "🤡"]
    static let playerColors = [
        "#4ade80", "#60a5fa", "#f472b6", "#fbbf24",
        "#a78bfa", "#fb7185", "#22d3ee", "#f97316",
    ]
}

extension String {
    var moneyFormatted: String { self }
}

func money(_ n: Int) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    return "$" + (f.string(from: NSNumber(value: n)) ?? "\(n)")
}
