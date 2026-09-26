// The design system: the same red-and-white identity as the web client,
// dark-first, with a light palette that follows the system setting.

import SwiftUI

/// The raw slot numbers a table style was built from, kept alongside the
/// `Color`s made from them. The glass tokens are mixes, composites and
/// luminances of these slots, and none of that arithmetic can be done on a
/// `Color` — so rather than restate eighteen hexes in a second table and watch
/// the two drift, the palette carries the numbers it already had.
struct PaletteHex {
    let page, page2, card, sheet, sunken, boardBG, tileCorner: UInt32
    let ink, ink2, ink3, rule, rule2: UInt32
    let red, redDeep, redSoft, accentInk, gold, goldSoft: UInt32
}

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
    let badSoft: Color
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

    /// The slots above as the numbers they were authored as — see `PaletteHex`.
    let hex: PaletteHex

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
            badSoft: dark ? Color(hex: 0x2D161B) : Color(hex: 0xFBE9EC),
            gold: Color(hex: gold), goldSoft: Color(hex: goldSoft),
            tileTreasure: dark ? Color(hex: 0x2C2413) : Color(hex: 0xF7EDD8),
            tileSurprise: dark ? Color(hex: 0x2A1D2C) : Color(hex: 0xF3E4F1),
            tileTax: dark ? Color(hex: 0x2E1B1F) : Color(hex: 0xF6E3E5),
            tileRefund: dark ? Color(hex: 0x14291E) : Color(hex: 0xE4F3EA),
            tileStart: dark ? Color(hex: 0x153125) : Color(hex: 0xE2F2E8),
            tileGoto: dark ? Color(hex: 0x331B21) : Color(hex: 0xF6E3E7),
            tileVacation: dark ? Color(hex: 0x122C2A) : Color(hex: 0xE0F0EE),
            tileJail: dark ? Color(hex: 0x1C2433) : Color(hex: 0xE8EBF4),
            tileCorner: Color(hex: tileCorner),
            hex: PaletteHex(
                page: page, page2: page2, card: card, sheet: sheet, sunken: sunken,
                boardBG: boardBG, tileCorner: tileCorner,
                ink: ink, ink2: ink2, ink3: ink3, rule: rule, rule2: rule2,
                red: red, redDeep: redDeep, redSoft: redSoft, accentInk: accentInk,
                gold: gold, goldSoft: goldSoft)
        )
    }

    /// Which of the seven table styles is active. Set from the picker; the
    /// root view rebuilds the tree when it changes.
    static var themeID: String = UserDefaults.standard.string(forKey: "mm.theme") ?? "felt"

    static func current(_ scheme: ColorScheme) -> Palette {
        currentTheme.palette(scheme)
    }

    /// The table style itself. The glass tokens need it rather than a single
    /// `Palette`, because a piece of glass picks its appearance from what is
    /// behind it and may land on the *other* half of the pair — a bar over a
    /// dimmed video frame wears the light palette's ink while the app is dark.
    static var currentTheme: MMTheme { MMTheme(rawValue: themeID) ?? .felt }
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

    func palette(_ scheme: ColorScheme) -> Palette {
        scheme == .light ? light : dark
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

// MARK: - Glass tokens
//
// Nine glass colours per palette across fourteen palettes would be 126
// hand-authored hexes, and they would drift apart within a month. So none of
// them are authored: every value below is arithmetic on slots the table styles
// already carry. Android and the web run the same formulas on the same slots,
// which is the only reason the three clients cannot fall out of step.

/// Which way a piece of glass has resolved itself. It follows the luminance of
/// the backdrop we *placed* behind it, so it is not the same thing as the
/// colour scheme: a bar over a dimmed video frame goes light while the rest of
/// the app stays dark. That per-surface flip is what separates glass from a
/// blur — a frost looks the same over cream paper and over the night felt.
enum GlassAppearance: Hashable { case light, dark }

/// Regular is the material. Clear is the thin one, for chrome that must not
/// bury what it floats over — and it is banned over media, because it does not
/// adapt and measures 2.85:1 pinned dark over a dimmed bright frame. Opaque is
/// what Reduce Transparency collapses to, and what a caller asks for outright
/// when a surface has to be solid whatever the phone's settings say.
enum GlassVariant { case regular, clear, opaque }

/// Byte arithmetic on the palette slots. A `Color` cannot be taken apart again
/// without a trip through UIKit, so `Palette` keeps the hexes it was built from
/// and the mixes below run on those instead.
enum MMHex {
    typealias RGB = (r: Double, g: Double, b: Double)

    static func rgb(_ hex: UInt32) -> RGB {
        (Double((hex >> 16) & 0xFF), Double((hex >> 8) & 0xFF), Double(hex & 0xFF))
    }

    /// `a` moved `t` of the way to `b`, in sRGB byte space. Deliberately the
    /// naive mix and not a linear-light one, because it is the mix the Kotlin
    /// and CSS token files run and the three clients have to land on the same
    /// hex. Nothing is rounded until it becomes a `Color`.
    static func mix(_ a: RGB, _ b: RGB, _ t: Double) -> RGB {
        (a.r + t * (b.r - a.r), a.g + t * (b.g - a.g), a.b + t * (b.b - a.b))
    }

    static func color(_ c: RGB) -> Color {
        Color(.sRGB, red: c.r / 255, green: c.g / 255, blue: c.b / 255, opacity: 1)
    }

    /// WCAG relative luminance — the real one, linearised per channel. The
    /// adaptive flip compares this against 0.07, and the sweep that produced
    /// that threshold measured contrast, so a perceptual lightness here would
    /// quietly move every flip in the app.
    static func luminance(_ hex: UInt32) -> Double {
        func lin(_ v: Double) -> Double {
            let c = v / 255
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        let c = rgb(hex)
        return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
    }
}

/// The five derived colours, for one table style in one appearance.
struct GlassTokens {
    /// On a light table, white pulled 8% toward the palette's gold. On a dark
    /// one, the card lifted 14% toward the ink and then pulled the same 8% to
    /// the gold. That brass pull is the one deliberate deviation from Apple's
    /// model — their glass adapts purely to its backdrop, ours adapts *and*
    /// carries a fixed warm bias — and it is one constant in one formula, so
    /// it is also the first thing to cut if anyone disagrees.
    let film: Color
    /// What the film composites to over the page at the Regular alpha. This is
    /// the colour Reduce Transparency paints, so the surface keeps the hue it
    /// was designed to be instead of a translucency nudged up to 0.80.
    let solid: Color
    /// The appearance's own ink. It flips with the APPEARANCE, not the scheme,
    /// which is the whole point: a light-appearance bar in a dark app needs the
    /// light palette's ink or the label disappears.
    let ink: Color
    /// ink2 lifted 62% toward ink. Raw ink2 on glass floors at 4.95:1 across
    /// the sweep; this floors at 5.82:1. There is no `glassInk3` on purpose —
    /// ink3 on glass measures 1.53:1, so every use of it on a glass surface
    /// promotes to this one.
    let ink2: Color
    /// The specular rim, always the palette's gold, which sits between 35.5°
    /// and 43.3° on all fourteen palettes. The tint changes with the table; the
    /// brass does not, because it is the light in the room and not a property
    /// of the surface.
    let rimWarm: Color

    /// The ink a label sitting ON this glass should be drawn in. There are two
    /// levels and there is no third: Increase Contrast promotes the secondary
    /// one to the primary, and the slot below it does not exist here at all.
    func label(secondary: Bool = false, increaseContrast: Bool = false) -> Color {
        secondary && !increaseContrast ? ink2 : ink
    }
}

extension MMTheme {
    /// The glass colours for this table in a given appearance. Fourteen sets in
    /// total, built once on first use, because the material asks for them on
    /// every frame of a scroll.
    func glass(_ appearance: GlassAppearance) -> GlassTokens {
        MMTheme.glassTable[rawValue]?[appearance] ?? buildGlass(appearance)
    }

    private static let glassTable: [String: [GlassAppearance: GlassTokens]] =
        Dictionary(uniqueKeysWithValues: MMTheme.allCases.map {
            ($0.rawValue, [.light: $0.buildGlass(.light), .dark: $0.buildGlass(.dark)])
        })

    private func buildGlass(_ a: GlassAppearance) -> GlassTokens {
        let p = (a == .light ? light : dark).hex
        let gold = MMHex.rgb(p.gold)
        let film: MMHex.RGB = a == .light
            ? MMHex.mix(MMHex.rgb(0xFFFFFF), gold, 0.08)
            : MMHex.mix(MMHex.mix(MMHex.rgb(p.card), MMHex.rgb(p.ink), 0.14), gold, 0.08)
        // The solid is the film composited over the page at the Regular alpha —
        // literally what the eye sees through the glass with nothing else
        // underneath, which is why it is the right colour to fall back to.
        let solid = MMHex.mix(MMHex.rgb(p.page), film, a == .light ? 0.62 : 0.60)
        return GlassTokens(
            film: MMHex.color(film),
            solid: MMHex.color(solid),
            ink: Color(hex: p.ink),
            ink2: MMHex.color(MMHex.mix(MMHex.rgb(p.ink2), MMHex.rgb(p.ink), 0.62)),
            rimWarm: Color(hex: p.gold)
        )
    }
}

/// The four optical scalars. Geometry, rim, radii, ink and layout are identical
/// at every quality level and in every variant — only these change — so nothing
/// ever reflows when the governor steps the material down.
struct GlassScalars {
    let alpha: Double
    /// Gaussian radius for the backdrop, in points. Drops to 12 over the live
    /// board: a heavier blur there turns forty tiles into featureless mush,
    /// which is one of the ways a hand-built glass gives itself away.
    let blur: CGFloat
    let saturation: Double
    /// Stated as CSS states it, a multiplier, so the number can be read against
    /// the web client's token. See `brightnessShift` for what SwiftUI is handed.
    let brightness: Double

    /// SwiftUI's `.brightness` *adds* where CSS multiplies, and there is no
    /// multiplicative equivalent that can exceed 1. Additive is also the
    /// reading that matches the intent: on the night tables the backdrop is
    /// near black, where a 1.12 multiply is invisible and a +0.12 lift is
    /// exactly the amount of glow that makes the material read as a surface.
    var brightnessShift: Double { brightness - 1 }

    static func of(_ variant: GlassVariant,
                   _ appearance: GlassAppearance,
                   increaseContrast: Bool = false,
                   overLiveBoard: Bool = false) -> GlassScalars {
        let light = appearance == .light
        switch variant {
        case .opaque:
            return GlassScalars(alpha: 1, blur: 0, saturation: 1, brightness: 1)
        case .regular:
            return GlassScalars(
                alpha: increaseContrast ? (light ? 0.82 : 0.80) : (light ? 0.62 : 0.60),
                blur: overLiveBoard ? 12 : 20,
                saturation: light ? 1.80 : 1.70,
                brightness: light ? 1.04 : 1.12)
        case .clear:
            return GlassScalars(
                alpha: increaseContrast ? (light ? 0.82 : 0.80) : (light ? 0.30 : 0.26),
                blur: 10,
                saturation: light ? 1.45 : 1.40,
                brightness: light ? 1.02 : 1.06)
        }
    }
}

/// The radius ladder: arithmetic, step 4, with every padding a multiple of 4 so
/// concentricity falls out instead of having to be remembered. A 22 pt dock
/// with 8 pt padding holds 14 pt chips, and the gap does not pinch at the
/// corners. `pill` is a `Capsule`, which has no number.
enum MMRadius {
    static let xs: CGFloat = 6
    static let sm: CGFloat = 10
    static let md: CGFloat = 14
    static let lg: CGFloat = 18
    static let xl: CGFloat = 22
    static let xxl: CGFloat = 26

    /// The radius a child gets when it sits `inset` points inside `outer`.
    /// Floors at 4, below which a rounded corner reads as a square one anyway.
    static func inner(_ outer: CGFloat, inset: CGFloat) -> CGFloat {
        max(outer - inset, 4)
    }
}

/// The shadow under a glass surface, which has two states and must move between
/// them. A shadow that never deepens as content scrolls under the bar is one of
/// the twelve tells — it says the bar is pasted on rather than floating.
struct GlassShadow {
    let y: CGFloat
    /// Stated as CSS states a shadow blur, so the number matches the web token
    /// `--shadow` one for one. SwiftUI wants roughly half of it.
    let blur: CGFloat
    let alpha: Double

    /// SwiftUI's shadow radius is about a standard deviation where CSS's blur
    /// is about two of them, so a literal 32 here would be twice the shadow the
    /// other two clients cast.
    var radius: CGFloat { blur / 2 }

    /// The web's `--shadow` colour: a warm near-black, so the shadow under the
    /// brass reads as the same light source on all three clients.
    static let colour = Color(hex: 0x1E1C0E)

    var color: Color { GlassShadow.colour.opacity(alpha) }

    static func relaxed(height h: CGFloat, _ a: GlassAppearance) -> GlassShadow {
        GlassShadow(y: min(max(0.22 * h, 4), 12),
                    blur: min(max(1.9 * h, 12), 32),
                    alpha: a == .light ? 0.10 : 0.30)
    }

    static func busy(height h: CGFloat, _ a: GlassAppearance) -> GlassShadow {
        GlassShadow(y: min(max(0.30 * h, 6), 16),
                    blur: min(max(2.2 * h, 16), 44),
                    alpha: a == .light ? 0.22 : 0.52)
    }
}

/// Light, dark, or follow the phone — the one switch that decides which of a
/// table style's two palettes the whole app wears. The raw value is what
/// UserDefaults keeps under "mm.appearance"; the root view applies it.
enum MMAppearance: String, CaseIterable {
    case system, light, dark

    var title: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    /// The one-line caption under the picker for the current choice.
    var caption: String {
        switch self {
        case .system: "Follows your phone"
        case .light: "Always the daytime table"
        case .dark: "Always the night table"
        }
    }

    /// What .preferredColorScheme takes — nil means no preference.
    var scheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    /// The same choice in UIKit's words, for the window override that keeps
    /// already-presented sheets on the new scheme too.
    var uiStyle: UIUserInterfaceStyle {
        switch self {
        case .system: .unspecified
        case .light: .light
        case .dark: .dark
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
            // Whatever the card is sitting in, what is under its buttons is the
            // card. A sheet or the dock declares `.chrome` for the controls on
            // its own glass, and without this the cards in its body would hear
            // it too — and draw their buttons as wells in a material that is
            // not there, casting no shadow off solid paper.
            .mmControls(on: .paper)
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

// MARK: - Controls
//
// Nearly every button in the app is one of the two below, so this is the one
// edit that moves them onto the material — the thumb feels the difference
// before a single bar has changed.
//
// A control is glass that floats, and how much of the material it needs is
// decided by what it floats over. Most sit on a card or a sheet, and what is
// under them there travels with them: scroll the card and the button goes
// too, so nothing ever slides beneath it. A blur of a flat colour is the same
// flat colour, so over paper the glass runs at `flat` — film, rim, glow and
// shadow, no blur — which is not a saving passed off as a look, it is the
// exact picture. It is also what lets glass sit inside a scrolling card
// without paying for a backdrop pass per row.
//
// No control ever runs our lens. Three lensing surfaces is the whole budget
// on the oldest phone we support, and it belongs to the dock, the bars and
// the sheets; a small button skips the lens anyway, and a big one would spend
// a bar's allowance on a button. On iOS 26 a control over the page, the board
// or media is the system's own glass, which bends what is behind it by
// itself — that lens is the system's to pay for, not ours.

private struct ControlBackdropKey: EnvironmentKey {
    static let defaultValue: BackdropKind = .paper
}

extension EnvironmentValues {
    /// What the controls in this subtree are sitting on. A button can no more
    /// see its own backdrop than a bar can, so it is declared — once, by the
    /// surface, for everything inside it, rather than at every call site.
    /// Paper unless told otherwise, because paper is where most of them are.
    ///
    /// `.chrome` is the one that changes what a control *is*. Glass never
    /// stacks on glass — a pane on a pane is refracting the bar it sits on —
    /// so a button on the dock, or on a sheet's pinned bar, is drawn on that
    /// material instead of being a piece of glass of its own.
    var mmControlBackdrop: BackdropKind {
        get { self[ControlBackdropKey.self] } set { self[ControlBackdropKey.self] = newValue }
    }
}

extension View {
    /// Declares what every control inside this view is sitting on.
    func mmControls(on backdrop: BackdropKind) -> some View {
        environment(\.mmControlBackdrop, backdrop)
    }
}

/// The brand's primary/secondary buttons.
///
/// Ghost is the glass button: Regular, and interactive, so the light on its
/// rim moves when it is pressed. The four coloured kinds are the prominent
/// ones, and a prominent glass button *is* its tint — the system's own draws
/// a plate of the accent with the light on it, not a pale pane with a wash
/// across it. The material's tint is a fourteen-percent wash on purpose, the
/// one semantic hint a bar is allowed, and every Roll and Buy in the app put
/// through it comes out the same cream as the ghost beside it: the tell where
/// nothing is primary. So those keep their plate, and take from the glass
/// everything that is not the film — the shadow it casts, the gel of the
/// press, the light that blooms under the thumb.
struct MMButtonStyle: ButtonStyle {
    enum Kind { case primary, good, bad, gold, ghost }
    var kind: Kind = .primary
    var big = false

    func makeBody(configuration: Configuration) -> some View {
        MMButtonFace(label: configuration.label, pressed: configuration.isPressed,
                     kind: kind, big: big)
    }
}

extension MMButtonStyle.Kind {
    /// The colour a label on this button is drawn in. Drawn glyphs paint
    /// themselves rather than inheriting the style's foregroundStyle, so they
    /// have to be handed the same ink the text gets.
    func ink(_ P: Palette) -> Color { ink(P, on: .paper) }

    /// The same, for a button on a given backdrop. A ghost is glass, so its
    /// label wears the glass's own ink for whichever way that glass has
    /// leaned. That is the palette's ink whenever the lean matches the scheme,
    /// which over paper it always does — but a ghost over a video frame leans
    /// light in a dark app, and the palette's ink there would be pale on
    /// cream. The coloured kinds stand on their own plate and take its ink.
    func ink(_ P: Palette, on backdrop: BackdropKind) -> Color {
        switch self {
        case .ghost: MMButtonFace.glass(P, on: backdrop).ink
        case .primary, .gold: P.accentInk
        case .good, .bad: .white
        }
    }

    /// The plate a coloured kind stands on. A ghost has none — it is glass.
    fileprivate func plate(_ P: Palette) -> Color? {
        switch self {
        case .primary: P.red
        case .good: P.good
        case .bad: P.bad
        case .gold: P.gold
        case .ghost: nil
        }
    }
}

/// One button, at rest or held. A view of its own because the gel and the
/// shadow need things a style is never handed: what the button is sitting on,
/// how tall it came out, and whether the phone has asked for less motion.
private struct MMButtonFace: View {
    let label: ButtonStyleConfiguration.Label
    let pressed: Bool
    let kind: MMButtonStyle.Kind
    let big: Bool

    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.mmControlBackdrop) private var backdrop
    @Environment(\.mmGlassQuality) private var quality
    @Environment(\.mmBoardBusy) private var boardBusy
    @Environment(\.mmScrollOffset) private var scrollOffset

    /// Measured, because a plate's shadow scales with the height of what
    /// casts it exactly as a pane's does. Until the first layout, the height
    /// a one-line label comes out at.
    @State private var height: CGFloat?

    var body: some View {
        let P = Palette.current(scheme)
        // 14 and 10 off the ladder: what a 22 pt shell holds at 8 and at 12 pt
        // of padding, so a button hugging the corner of a dock sits concentric
        // with it instead of pinching the gap.
        let shape = RoundedRectangle(cornerRadius: big ? MMRadius.md : MMRadius.sm,
                                     style: .continuous)
        let face = label
            .font(.system(size: big ? 17 : 14, weight: .bold, design: .rounded))
            .foregroundStyle(kind.ink(P, on: backdrop))
            .padding(.vertical, big ? 14 : 9)
            .padding(.horizontal, big ? 22 : 14)
            .frame(maxWidth: big ? .infinity : nil)
            .background { bloom(P, shape) }
        surface(face, P, shape)
            .scaleEffect(x: squash.width, y: squash.height)
            .animation(pressCurve, value: pressed)
    }

    @ViewBuilder
    private func surface(_ face: some View, _ P: Palette, _ shape: RoundedRectangle) -> some View {
        if kind == .ghost && backdrop != .chrome {
            face
                .mmGlass(.regular, backdrop: backdrop, in: shape, interactive: true)
                // Environment flows inward, so these reach the `mmGlass` just
                // above them and nothing outside the button.
                .environment(\.mmGlassQuality, level)
                .environment(\.mmGlassPressed, pressed)
                // A bar deepens its shadow as content scrolls under it. Nothing
                // scrolls under a button on a card — the card scrolls, and takes
                // the button with it — so an offset from further up the tree
                // must not tell it otherwise.
                .environment(\.mmScrollOffset, travels ? 0 : scrollOffset)
        } else {
            face
                .background {
                    let sh = shadow(P)
                    shape.fill(fill(P))
                        .shadow(color: sh?.color ?? .clear, radius: sh?.radius ?? 0, y: sh?.y ?? 0)
                        // Information, not decoration, so it survives Reduce
                        // Motion — only slower.
                        .animation(.linear(duration: reduceMotion ? 0.3 : 0.2), value: busy)
                }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { h in height = h }
        }
    }

    // MARK: what it is sitting on

    /// The glass colours for a control on this backdrop, resolved the way the
    /// material resolves its own. A control cannot change backdrops while it
    /// is on screen, so the cold-start answer is the one the glass settles on.
    ///
    /// Nonisolated, because `Kind.ink` asks for it from outside any view, and
    /// a view's statics belong to the main actor: it is palette arithmetic and
    /// touches nothing a view owns.
    nonisolated static func glass(_ P: Palette, on backdrop: BackdropKind) -> GlassTokens {
        Palette.currentTheme.glass(appearance(P, on: backdrop))
    }

    private nonisolated static func appearance(_ P: Palette, on backdrop: BackdropKind) -> GlassAppearance {
        GlassAppearance.resolve(luminance: backdrop.luminance(P), previous: nil)
    }

    /// Whether what is under this control moves with it. Paper and a sheet
    /// do; the page, the live board and a video frame move on their own.
    private var travels: Bool { backdrop == .paper || backdrop == .sheet }

    /// The most the material may spend on a control — see the note above the
    /// controls. Never higher than the governor has settled on.
    private var level: GlassLevel { min(quality, travels ? .flat : .frost) }

    /// Whether the material is about to hand this button to the system's own
    /// glass, on exactly the terms `MMGlass` routes by. That glass is
    /// interactive and does its own press — a scale, a bounce, a shimmer —
    /// and a gel on top of it would be two presses fighting over one button.
    private var systemGlass: Bool {
        guard kind == .ghost, backdrop != .chrome, !reduceTransparency, !boardBusy,
              level >= .frost else { return false }
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
    }

    // MARK: the plate

    private func fill(_ P: Palette) -> Color {
        if let plate = kind.plate(P) { return plate }
        // A ghost on another piece of glass. It cannot be a pane, so it is a
        // well in the material instead: the glass's own ink at a tenth, which
        // is how iOS fills a grouped control on a bar. The ink and not a paper
        // colour, because it has to flip when the glass under it does.
        return Self.glass(P, on: backdrop).ink.opacity(contrast == .increased ? 0.18 : 0.10)
    }

    /// The shadow a plate casts: the same two states, off the same tokens, as
    /// a pane of the same height, so a coloured button and the ghost beside it
    /// float the same distance off the card. Nothing drawn on another piece of
    /// glass casts one — a chip on the dock is part of the dock.
    private func shadow(_ P: Palette) -> GlassShadow? {
        guard backdrop != .chrome else { return nil }
        let h = height ?? (big ? 48 : 35)
        let a = Self.appearance(P, on: backdrop)
        return busy ? .busy(height: h, a) : .relaxed(height: h, a)
    }

    /// Deepened while the board performs, and — for a control floating over
    /// something that moves on its own — once that something has moved.
    private var busy: Bool { boardBusy || (!travels && abs(scrollOffset) > 8) }

    // MARK: the press

    /// The gel. Down fast and flattening, the way a drop gives under a finger;
    /// back up on a spring that carries it just past its own size before it
    /// settles, which is the difference between a button that yields and one
    /// that merely shrinks. Reduce Motion keeps the press — it is how you know
    /// the tap landed — and loses the squash and the overshoot.
    private var squash: CGSize {
        guard pressed, !systemGlass else { return CGSize(width: 1, height: 1) }
        if reduceMotion { return CGSize(width: 0.965, height: 0.965) }
        return CGSize(width: 0.965 * 1.03, height: 0.965 * 0.94)
    }

    /// 110 ms down; 260 ms back, sprung so the axis that travels furthest
    /// crests at about 1.008. A flat 100 ms each way under Reduce Motion.
    private var pressCurve: Animation {
        if reduceMotion { return .easeOut(duration: 0.10) }
        return pressed ? .easeOut(duration: 0.11) : .spring(duration: 0.26, bounce: 0.38)
    }

    /// The light a press lets into the glass. It lives here rather than in
    /// the material because the style is what owns the touch — but a style is
    /// never told where the touch landed, and the one gesture that would say,
    /// a drag from zero distance, steals the scroll from the card the button
    /// sits in. So it blooms where a thumb lands on a button, which is the
    /// middle. Additive like the rim, and in the rim's hot colour: white by
    /// day, brass at night. Off under Reduce Motion.
    @ViewBuilder
    private func bloom(_ P: Palette, _ shape: RoundedRectangle) -> some View {
        if !reduceMotion && !systemGlass {
            let hot: Color = Self.appearance(P, on: backdrop) == .dark
                ? Self.glass(P, on: backdrop).rimWarm
                : .white
            RadialGradient(colors: [hot.opacity(0.10), hot.opacity(0)],
                           center: .center, startRadius: 0, endRadius: 40)
                .clipShape(shape)
                .blendMode(.plusLighter)
                .opacity(pressed ? 1 : 0)
        }
    }
}

/// A button that leads with a drawn glyph — the shape emoji used to make.
/// Wrapping it keeps the glyph's ink and the button's kind from drifting apart,
/// and — now that a ghost takes its ink from the glass — from what the button
/// is sitting on as well.
struct MMIconButton: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.mmControlBackdrop) private var backdrop
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
                Art.icon(glyph, size: big ? 19 : 15, tint: kind.ink(P, on: backdrop))
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
    /// Flags with the names people know them by. A grid of fifty unlabelled
    /// flags asks the reader to recognise every one of them; a named list can
    /// be read, and it fits behind one row instead of half a screen.
    static let countries: [(flag: String, name: String)] = [
        ("🇮🇳", "India"), ("🇬🇧", "United Kingdom"), ("🇺🇸", "United States"),
        ("🇧🇷", "Brazil"), ("🇩🇪", "Germany"), ("🇫🇷", "France"), ("🇮🇹", "Italy"),
        ("🇪🇸", "Spain"), ("🇵🇹", "Portugal"), ("🇳🇱", "Netherlands"),
        ("🇮🇪", "Ireland"), ("🇨🇭", "Switzerland"), ("🇸🇪", "Sweden"), ("🇳🇴", "Norway"),
        ("🇩🇰", "Denmark"), ("🇵🇱", "Poland"), ("🇺🇦", "Ukraine"), ("🇹🇷", "Türkiye"),
        ("🇷🇴", "Romania"), ("🇬🇷", "Greece"),
        ("🇮🇱", "Israel"), ("🇦🇪", "United Arab Emirates"), ("🇸🇦", "Saudi Arabia"),
        ("🇪🇬", "Egypt"), ("🇿🇦", "South Africa"), ("🇳🇬", "Nigeria"), ("🇰🇪", "Kenya"),
        ("🇨🇳", "China"), ("🇯🇵", "Japan"), ("🇰🇷", "South Korea"),
        ("🇹🇭", "Thailand"), ("🇻🇳", "Vietnam"), ("🇵🇭", "Philippines"),
        ("🇮🇩", "Indonesia"), ("🇵🇰", "Pakistan"), ("🇧🇩", "Bangladesh"),
        ("🇱🇰", "Sri Lanka"), ("🇳🇵", "Nepal"), ("🇦🇺", "Australia"), ("🇳🇿", "New Zealand"),
        ("🇨🇦", "Canada"), ("🇲🇽", "Mexico"), ("🇦🇷", "Argentina"), ("🇨🇱", "Chile"),
        ("🇨🇴", "Colombia"), ("🇷🇺", "Russia"), ("🇸🇬", "Singapore"), ("🇲🇾", "Malaysia"),
        ("🏴‍☠️", "No country — pirate"), ("🌍", "The whole world"),
    ]
    static let flags = countries.map(\.flag)
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

/// "$1,300" — and, now that an unpaid debt lives as a negative balance,
/// "−$1,300": a real minus sign out front, never the formatter's "$-1,300".
func money(_ n: Int) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    let grouped = f.string(from: NSNumber(value: abs(n))) ?? "\(abs(n))"
    return (n < 0 ? "−$" : "$") + grouped
}

/// The soft heartbeat on a balance below zero. The colour already carries the
/// alarm — this just keeps the number breathing until the seat is back in the
/// black, the same quiet cadence as the "… is viewing" line.
struct DebtPulse: ViewModifier {
    let active: Bool
    @State private var dim = false

    func body(content: Content) -> some View {
        content
            .opacity(active && dim ? 0.55 : 1)
            .animation(active
                       ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true)
                       : .easeOut(duration: 0.2),
                       value: dim)
            .onAppear { dim = active }
            .onChange(of: active) { _, on in dim = on }
    }
}

extension View {
    /// Gentle pulse while `active` — every money label bound to a balance
    /// wears this so a seat in the red reads as one thing everywhere.
    func debtPulse(_ active: Bool) -> some View { modifier(DebtPulse(active: active)) }
}
