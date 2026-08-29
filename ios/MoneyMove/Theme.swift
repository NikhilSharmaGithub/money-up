// The design system: the same red-and-white identity as the web client,
// dark-first, with a light palette that follows the system setting.

import SwiftUI

struct Palette {
    // surfaces
    let page: Color        // screen background
    let page2: Color       // deep edge of the page gradient
    let card: Color        // panels / tiles
    let sheet: Color       // background of presented sheets
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

    /// Midnight felt: a deep green card-table, warm ivory ink, brass accents.
    static let dark = Palette(
        page: Color(hex: 0x0C1310), page2: Color(hex: 0x070B09),
        card: Color(hex: 0x16211C), sheet: Color(hex: 0x101915), sunken: Color(hex: 0x1D2B25), boardBG: Color(hex: 0x121D18),
        ink: Color(hex: 0xEFEDE2), ink2: Color(hex: 0xADB6AC), ink3: Color(hex: 0x78827A),
        rule: Color(hex: 0x24332C), rule2: Color(hex: 0x31453C),
        red: Color(hex: 0xE3A93C), redDeep: Color(hex: 0xC08A25), redSoft: Color(hex: 0x2E2718),
        good: Color(hex: 0x4FD98B), goodSoft: Color(hex: 0x14291E),
        bad: Color(hex: 0xE25A6D),
        gold: Color(hex: 0xD9A13A), goldSoft: Color(hex: 0x2C2413),
        tileTreasure: Color(hex: 0x2C2413), tileSurprise: Color(hex: 0x2A1D2C),
        tileTax: Color(hex: 0x2E1B1F), tileRefund: Color(hex: 0x14291E),
        tileStart: Color(hex: 0x153125), tileGoto: Color(hex: 0x331B21),
        tileVacation: Color(hex: 0x122C2A), tileJail: Color(hex: 0x1C2433),
        tileCorner: Color(hex: 0x223129)
    )

    /// Daylight table: warm ivory linen, white cards, forest-and-brass accents.
    static let light = Palette(
        page: Color(hex: 0xEFE9DC), page2: Color(hex: 0xE2DAC9),
        card: .white, sheet: Color(hex: 0xF7F3EA), sunken: Color(hex: 0xEFE9DE), boardBG: Color(hex: 0xFDFBF4),
        ink: Color(hex: 0x201F1A), ink2: Color(hex: 0x5C5B50), ink3: Color(hex: 0x92917F),
        rule: Color(hex: 0xE4DECE), rule2: Color(hex: 0xD2CAB6),
        red: Color(hex: 0xB58223), redDeep: Color(hex: 0x93690F), redSoft: Color(hex: 0xF7EDD8),
        good: Color(hex: 0x177C4D), goodSoft: Color(hex: 0xE4F3EA),
        bad: Color(hex: 0xBF3A4E),
        gold: Color(hex: 0xA97B1D), goldSoft: Color(hex: 0xF7EDD8),
        tileTreasure: Color(hex: 0xF7EDD8), tileSurprise: Color(hex: 0xF3E4F1),
        tileTax: Color(hex: 0xF6E3E5), tileRefund: Color(hex: 0xE4F3EA),
        tileStart: Color(hex: 0xE2F2E8), tileGoto: Color(hex: 0xF6E3E7),
        tileVacation: Color(hex: 0xE0F0EE), tileJail: Color(hex: 0xE8EBF4),
        tileCorner: Color(hex: 0xFFFEF9)
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
        let fg: Color = switch kind {
        case .ghost: P.ink
        case .primary, .gold: Color(hex: 0x201607)
        case .good, .bad: .white
        }
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
