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
    /// Text color that sits ON the accent (dark on brass, white on purple…).
    let accentInk: Color
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

    /// Builds a full palette from the ~17 slots a table style actually swaps;
    /// the semantic greens/reds and special tile faces are shared per mode.
    static func themed(
        dark: Bool,
        page: UInt32, page2: UInt32, card: UInt32, sheet: UInt32, sunken: UInt32,
        boardBG: UInt32, tileCorner: UInt32,
        ink: UInt32, ink2: UInt32, ink3: UInt32, rule: UInt32, rule2: UInt32,
        red: UInt32, redDeep: UInt32, redSoft: UInt32, accentInk: UInt32,
        gold: UInt32, goldSoft: UInt32
    ) -> Palette {
        Palette(
            page: Color(hex: page), page2: Color(hex: page2),
            card: Color(hex: card), sheet: Color(hex: sheet), sunken: Color(hex: sunken), boardBG: Color(hex: boardBG),
            ink: Color(hex: ink), ink2: Color(hex: ink2), ink3: Color(hex: ink3),
            rule: Color(hex: rule), rule2: Color(hex: rule2),
            red: Color(hex: red), redDeep: Color(hex: redDeep), redSoft: Color(hex: redSoft),
            accentInk: Color(hex: accentInk),
            good: dark ? Color(hex: 0x4FD98B) : Color(hex: 0x177C4D),
            goodSoft: dark ? Color(hex: 0x14291E) : Color(hex: 0xE4F3EA),
            bad: dark ? Color(hex: 0xE25A6D) : Color(hex: 0xBF3A4E),
            gold: Color(hex: gold), goldSoft: Color(hex: goldSoft),
            tileTreasure: dark ? Color(hex: 0x2C2413) : Color(hex: 0xF7EDD8),
            tileSurprise: dark ? Color(hex: 0x2A1D2C) : Color(hex: 0xF3E4F1),
            tileTax: dark ? Color(hex: 0x2E1B1F) : Color(hex: 0xF6E3E5),
            tileRefund: dark ? Color(hex: 0x14291E) : Color(hex: 0xE4F3EA),
            tileStart: dark ? Color(hex: 0x153125) : Color(hex: 0xE2F2E8),
            tileGoto: dark ? Color(hex: 0x331B21) : Color(hex: 0xF6E3E7),
            tileVacation: dark ? Color(hex: 0x122C2A) : Color(hex: 0xE0F0EE),
            tileJail: dark ? Color(hex: 0x1C2433) : Color(hex: 0xE8EBF4),
            tileCorner: Color(hex: tileCorner)
        )
    }

    /// Which of the seven table styles is active. Set from the picker; the
    /// root view rebuilds the tree when it changes.
    static var themeID: String = UserDefaults.standard.string(forKey: "mm.theme") ?? "felt"

    static func current(_ scheme: ColorScheme) -> Palette {
        let theme = MMTheme(rawValue: themeID) ?? .felt
        return scheme == .light ? theme.light : theme.dark
    }
}

/// The seven table styles — every one has its own light AND dark.
enum MMTheme: String, CaseIterable {
    case felt, crimson, royale, blush, marine, sands, noir

    var title: String {
        switch self {
        case .felt: "Midnight Felt"
        case .crimson: "Crimson Classic"
        case .royale: "Purple Royale"
        case .blush: "Blush Pink"
        case .marine: "Deep Marine"
        case .sands: "Desert Sands"
        case .noir: "Silver Noir"
        }
    }

    /// The swatch dot shown in pickers.
    var dot: Color {
        switch self {
        case .felt: Color(hex: 0x2E7D5B)
        case .crimson: Color(hex: 0xD92037)
        case .royale: Color(hex: 0x8B5CF6)
        case .blush: Color(hex: 0xF472B6)
        case .marine: Color(hex: 0x38BDF8)
        case .sands: Color(hex: 0xF59E0B)
        case .noir: Color(hex: 0xC9A86A)
        }
    }

    var dark: Palette {
        switch self {
        case .felt: .themed(dark: true,
            page: 0x0C1310, page2: 0x070B09, card: 0x16211C, sheet: 0x101915, sunken: 0x1D2B25,
            boardBG: 0x121D18, tileCorner: 0x223129,
            ink: 0xEFEDE2, ink2: 0xADB6AC, ink3: 0x78827A, rule: 0x24332C, rule2: 0x31453C,
            red: 0xE3A93C, redDeep: 0xC08A25, redSoft: 0x2E2718, accentInk: 0x201607,
            gold: 0xD9A13A, goldSoft: 0x2C2413)
        case .crimson: .themed(dark: true,
            page: 0x150A0E, page2: 0x0D0508, card: 0x211319, sheet: 0x1A0E13, sunken: 0x2B1A21,
            boardBG: 0x1A0E13, tileCorner: 0x33202A,
            ink: 0xF4EAED, ink2: 0xBDA8B0, ink3: 0x8D757E, rule: 0x382330, rule2: 0x4A2F3C,
            red: 0xF04156, redDeep: 0xC4243A, redSoft: 0x3A1620, accentInk: 0xFFFFFF,
            gold: 0xFBBF24, goldSoft: 0x35240D)
        case .royale: .themed(dark: true,
            page: 0x14101F, page2: 0x0B0814, card: 0x201A33, sheet: 0x191430, sunken: 0x2A2342,
            boardBG: 0x191430, tileCorner: 0x2E2647,
            ink: 0xEFECF7, ink2: 0xB3ACCC, ink3: 0x7D7699, rule: 0x322A4D, rule2: 0x453A66,
            red: 0x8B5CF6, redDeep: 0x6D3FD6, redSoft: 0x251B3E, accentInk: 0xFFFFFF,
            gold: 0xD9A13A, goldSoft: 0x2C2413)
        case .blush: .themed(dark: true,
            page: 0x1D1016, page2: 0x120A0E, card: 0x2B1A23, sheet: 0x241419, sunken: 0x37222D,
            boardBG: 0x241419, tileCorner: 0x3A2430,
            ink: 0xF7ECF1, ink2: 0xCFACBD, ink3: 0x97768A, rule: 0x43293A, rule2: 0x58374B,
            red: 0xF472B6, redDeep: 0xD6479A, redSoft: 0x3A1E2F, accentInk: 0x2C0B1E,
            gold: 0xE3A93C, goldSoft: 0x2E2718)
        case .marine: .themed(dark: true,
            page: 0x0B1220, page2: 0x070B15, card: 0x14202F, sheet: 0x101B2B, sunken: 0x1C2B3F,
            boardBG: 0x101B2B, tileCorner: 0x1F2E40,
            ink: 0xE9EEF6, ink2: 0xA9B8CC, ink3: 0x74839A, rule: 0x24354B, rule2: 0x314763,
            red: 0x38BDF8, redDeep: 0x1D94CF, redSoft: 0x14293A, accentInk: 0x06202E,
            gold: 0xD9A13A, goldSoft: 0x2C2413)
        case .sands: .themed(dark: true,
            page: 0x191307, page2: 0x100C04, card: 0x272013, sheet: 0x201A0E, sunken: 0x33291A,
            boardBG: 0x201A0E, tileCorner: 0x362C1C,
            ink: 0xF5EFE2, ink2: 0xC8BBA0, ink3: 0x93876E, rule: 0x3D321F, rule2: 0x52432A,
            red: 0xF59E0B, redDeep: 0xCC7F06, redSoft: 0x332508, accentInk: 0x241700,
            gold: 0xF59E0B, goldSoft: 0x332508)
        case .noir: .themed(dark: true,
            page: 0x101113, page2: 0x0A0B0C, card: 0x1B1D20, sheet: 0x17181B, sunken: 0x25282C,
            boardBG: 0x17181B, tileCorner: 0x292C30,
            ink: 0xF0F1F2, ink2: 0xB3B8BD, ink3: 0x7D8288, rule: 0x2E3237, rule2: 0x414750,
            red: 0xC9A86A, redDeep: 0xA8874A, redSoft: 0x2A2519, accentInk: 0x1E1809,
            gold: 0xC9A86A, goldSoft: 0x2A2519)
        }
    }

    var light: Palette {
        switch self {
        case .felt: .themed(dark: false,
            page: 0xEFE9DC, page2: 0xE2DAC9, card: 0xFFFFFF, sheet: 0xF7F3EA, sunken: 0xEFE9DE,
            boardBG: 0xFDFBF4, tileCorner: 0xFFFEF9,
            ink: 0x201F1A, ink2: 0x5C5B50, ink3: 0x92917F, rule: 0xE4DECE, rule2: 0xD2CAB6,
            red: 0xB58223, redDeep: 0x93690F, redSoft: 0xF7EDD8, accentInk: 0x201607,
            gold: 0xA97B1D, goldSoft: 0xF7EDD8)
        case .crimson: .themed(dark: false,
            page: 0xF6E7E9, page2: 0xEFD6DA, card: 0xFFFFFF, sheet: 0xFAF1F2, sunken: 0xF4EEEA,
            boardBG: 0xFFFAF7, tileCorner: 0xFFFDFB,
            ink: 0x1E1A1C, ink2: 0x5F5359, ink3: 0x948890, rule: 0xE9E0DB, rule2: 0xD8CAC3,
            red: 0xD92037, redDeep: 0xA4142A, redSoft: 0xFDECEE, accentInk: 0xFFFFFF,
            gold: 0xB7791F, goldSoft: 0xFDF3E0)
        case .royale: .themed(dark: false,
            page: 0xEAE6F4, page2: 0xDCD5EC, card: 0xFFFFFF, sheet: 0xF3F0FA, sunken: 0xEFECF7,
            boardBG: 0xFCFBFF, tileCorner: 0xFDFCFF,
            ink: 0x1D1A26, ink2: 0x575168, ink3: 0x8F89A3, rule: 0xE2DDEF, rule2: 0xCEC6E3,
            red: 0x6D3FD6, redDeep: 0x5530AB, redSoft: 0xEFE8FD, accentInk: 0xFFFFFF,
            gold: 0xA97B1D, goldSoft: 0xF4EDD8)
        case .blush: .themed(dark: false,
            page: 0xF7E8EE, page2: 0xEFD8E2, card: 0xFFFFFF, sheet: 0xFBF2F6, sunken: 0xF7EDF2,
            boardBG: 0xFFFBFD, tileCorner: 0xFFFDFE,
            ink: 0x241A20, ink2: 0x67535D, ink3: 0xA08892, rule: 0xF0DDE6, rule2: 0xE2C7D4,
            red: 0xD6479A, redDeep: 0xB02C7A, redSoft: 0xFBE7F2, accentInk: 0xFFFFFF,
            gold: 0xB7791F, goldSoft: 0xFDF3E0)
        case .marine: .themed(dark: false,
            page: 0xE2EBF2, page2: 0xD2DFE9, card: 0xFFFFFF, sheet: 0xEFF4F8, sunken: 0xEBF1F6,
            boardBG: 0xFBFDFF, tileCorner: 0xFCFEFF,
            ink: 0x16202A, ink2: 0x4E5F6E, ink3: 0x84939F, rule: 0xDDE7EE, rule2: 0xC6D6E2,
            red: 0x1D94CF, redDeep: 0x14719F, redSoft: 0xE2F3FC, accentInk: 0xFFFFFF,
            gold: 0xA97B1D, goldSoft: 0xF4EDD8)
        case .sands: .themed(dark: false,
            page: 0xF2E9D8, page2: 0xE7DAC2, card: 0xFFFDF8, sheet: 0xF8F1E4, sunken: 0xF4EDDE,
            boardBG: 0xFFFCF3, tileCorner: 0xFFFEF9,
            ink: 0x241E12, ink2: 0x665C46, ink3: 0x998C70, rule: 0xEADFC9, rule2: 0xD9C9A9,
            red: 0xB97509, redDeep: 0x935C05, redSoft: 0xFAEED6, accentInk: 0xFFFFFF,
            gold: 0xB97509, goldSoft: 0xFAEED6)
        case .noir: .themed(dark: false,
            page: 0xE8E8E6, page2: 0xD9D9D6, card: 0xFFFFFF, sheet: 0xF3F3F1, sunken: 0xF0F0EE,
            boardBG: 0xFCFCFB, tileCorner: 0xFDFDFC,
            ink: 0x1B1B1A, ink2: 0x56565A, ink3: 0x8E8E91, rule: 0xE2E2DF, rule2: 0xCCCCC8,
            red: 0x8A6A2F, redDeep: 0x6D5325, redSoft: 0xF2EAD9, accentInk: 0xFFFFFF,
            gold: 0x8A6A2F, goldSoft: 0xF2EAD9)
        }
    }
}

/// A row of the seven table-style swatches — used on the landing screen and
/// in game settings. Changing it restyles the whole app live.
struct ThemePicker: View {
    @AppStorage("mm.theme") private var themeID = "felt"
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                ForEach(MMTheme.allCases, id: \.rawValue) { theme in
                    let on = themeID == theme.rawValue
                    Circle()
                        .fill(theme.dot)
                        .frame(width: 30, height: 30)
                        .overlay(Circle().stroke(on ? P.ink : .clear, lineWidth: 2.5).padding(-3))
                        .scaleEffect(on ? 1.08 : 1)
                        .onTapGesture {
                            themeID = theme.rawValue
                            Haptics.tap()
                            SoundKit.shared.click()
                        }
                }
            }
            Text((MMTheme(rawValue: themeID) ?? .felt).title)
                .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink3)
        }
        .animation(.spring(duration: 0.25), value: themeID)
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
        case .primary, .gold: P.accentInk
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

extension MMButtonStyle.Kind {
    /// The colour a label on this button is drawn in. Drawn glyphs paint
    /// themselves rather than inheriting the style's foregroundStyle, so they
    /// have to be handed the same ink the text gets.
    func ink(_ P: Palette) -> Color {
        switch self {
        case .ghost: P.ink
        case .primary, .gold: P.accentInk
        case .good, .bad: .white
        }
    }
}

/// A button that leads with a drawn glyph — the shape emoji used to make.
/// Wrapping it keeps the glyph's ink and the button's kind from drifting apart.
struct MMIconButton: View {
    @Environment(\.colorScheme) private var scheme
    let glyph: Glyph
    let title: String
    var kind: MMButtonStyle.Kind = .primary
    var big = false
    let action: () -> Void

    init(_ glyph: Glyph, _ title: String, kind: MMButtonStyle.Kind = .primary,
         big: Bool = false, action: @escaping () -> Void) {
        self.glyph = glyph
        self.title = title
        self.kind = kind
        self.big = big
        self.action = action
    }

    var body: some View {
        let P = Palette.current(scheme)
        Button(action: action) {
            HStack(spacing: 8) {
                Art.icon(glyph, size: big ? 19 : 15, tint: kind.ink(P))
                Text(title)
            }
        }
        .buttonStyle(MMButtonStyle(kind: kind, big: big))
    }
}

/// Player avatar disc with initial, colour and country flag badge.
struct AvatarView: View {
    let name: String
    let colorCSS: String
    let flag: String
    var size: CGFloat = 36
    /// Store avatar emoji — replaces the initial when equipped.
    var emoji: String = ""

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Circle()
                .fill(Color(css: colorCSS))
                .frame(width: size, height: size)
                .overlay(
                    Group {
                        if !emoji.isEmpty {
                            Text(emoji).font(.system(size: size * 0.58))
                        } else {
                            Text(String(name.prefix(1)).uppercased())
                                .font(.system(size: size * 0.42, weight: .black, design: .rounded))
                                .foregroundStyle(.white)
                        }
                    }
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
    /// One-tap reactions: the five that answer almost anything at a table.
    static let reactions = ["👍", "😂", "😱", "🤝", "🔥"]
    static let emotes = reactions + ["💸", "🎲", "😭", "🏠", "🤡"]
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
