// GENERATED — do not edit by hand.
//
// The flags public/js/icons.js draws that Art.swift has no hand-drawn port
// of, as SwiftUI drawing closures on the same 32×32 grid. GroupMedallion
// asks CircleFlagArt first and only then `coins`; GroupFlag asks its own
// table first and only then `panels` — so a flag someone ports by hand
// replaces its generated twin, and the next run of the generator drops it
// from here.
//
// Regenerate with tools/gen-flags-swift.mjs after changing icons.js.

import SwiftUI

enum GeneratedFlagArt {
    /// Disc art for GroupMedallion, keyed by the group's flag emoji: composed
    /// for the circle at (16, 16) r15, drawn under the medallion's clip and
    /// before its enamel finish, exactly like CircleFlagArt.art.
    static let coins: [String: (GraphicsContext) -> Void] = coinParts.mapValues(drawing)

    /// Panel art for GroupFlag: the whole 30×20 cloth at (1, 6), its white
    /// ground and faint outline included.
    static let panels: [String: (GraphicsContext) -> Void] = panelParts.mapValues(drawing)

    /// One filled and/or stroked subpath, in the web's paint order.
    private struct Part {
        let path: Path
        let fill: Color?
        let stroke: Color?
        let style: StrokeStyle
        let evenOdd: Bool
    }

    private static func drawing(_ parts: [Part]) -> (GraphicsContext) -> Void {
        { ctx in
            for part in parts {
                if let fill = part.fill {
                    ctx.fill(part.path, with: .color(fill), style: FillStyle(eoFill: part.evenOdd))
                }
                if let stroke = part.stroke {
                    ctx.stroke(part.path, with: .color(stroke), style: part.style)
                }
            }
        }
    }

    /// sRGB, as Art.swift's own hex colours are. Opacity folds into the
    /// colour, which is how the web's opacity lands on a single shape.
    private static func rgb(_ v: UInt32, _ alpha: Double) -> Color {
        Color(.sRGB, red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255,
              blue: Double(v & 0xFF) / 255, opacity: alpha)
    }

    /// SVG's stroke defaults: width 1, butt caps, mitre joins limited at 4.
    private static func part(_ path: Path, fill: UInt32? = nil, stroke: UInt32? = nil,
                             width: CGFloat = 1, cap: CGLineCap = .butt, join: CGLineJoin = .miter,
                             dash: [CGFloat] = [], alpha: Double = 1, evenOdd: Bool = false) -> Part {
        Part(path: path,
             fill: fill.map { rgb($0, alpha) },
             stroke: stroke.map { rgb($0, alpha) },
             style: StrokeStyle(lineWidth: width, lineCap: cap, lineJoin: join, miterLimit: 4, dash: dash),
             evenOdd: evenOdd)
    }

    private static let coinParts: [String: [Part]] = [
        "\u{1F1EA}\u{1F1F9}": coinET(),   // Ethiopia
        "\u{1F1EC}\u{1F1ED}": coinGH(),   // Ghana
        "\u{1F1F9}\u{1F1FF}": coinTZ(),   // Tanzania
        "\u{1F1F0}\u{1F1EA}": coinKE(),   // Kenya
        "\u{1F1F2}\u{1F1E6}": coinMA(),   // Morocco
        "\u{1F1F3}\u{1F1EC}": coinNG(),   // Nigeria
        "\u{1F1EA}\u{1F1EC}": coinEG(),   // Egypt
        "\u{1F1FF}\u{1F1E6}": coinZA(),   // South Africa
        "\u{1F1FB}\u{1F1F3}": coinVN(),   // Vietnam
        "\u{1F1EE}\u{1F1E9}": coinID(),   // Indonesia
        "\u{1F1F9}\u{1F1ED}": coinTH(),   // Thailand
        "\u{1F1F0}\u{1F1F7}": coinKR(),   // South Korea
        "\u{1F1E6}\u{1F1EA}": coinAE(),   // United Arab Emirates
        "\u{1F1F5}\u{1F1F9}": coinPT(),   // Portugal
        "\u{1F1EC}\u{1F1F7}": coinGR(),   // Greece
        "\u{1F1F3}\u{1F1F1}": coinNL(),   // Netherlands
        "\u{1F1EF}\u{1F1F2}": coinJM(),   // Jamaica
        "\u{1F1E8}\u{1F1FA}": coinCU(),   // Cuba
        "\u{1F1E9}\u{1F1F4}": coinDO(),   // Dominican Republic
        "\u{1F1E8}\u{1F1F7}": coinCR(),   // Costa Rica
        "\u{1F1F5}\u{1F1E6}": coinPA(),   // Panama
        "\u{1F1F2}\u{1F1FD}": coinMX(),   // Mexico
        "\u{1F1E7}\u{1F1F4}": coinBO(),   // Bolivia
        "\u{1F1EA}\u{1F1E8}": coinEC(),   // Ecuador
        "\u{1F1FA}\u{1F1FE}": coinUY(),   // Uruguay
        "\u{1F1F5}\u{1F1EA}": coinPE(),   // Peru
        "\u{1F1E8}\u{1F1F4}": coinCO(),   // Colombia
        "\u{1F1E8}\u{1F1F1}": coinCL(),   // Chile
        "\u{1F1E6}\u{1F1F7}": coinAR(),   // Argentina
        "\u{1F1FC}\u{1F1F8}": coinWS(),   // Samoa
        "\u{1F1F9}\u{1F1F4}": coinTO(),   // Tonga
        "\u{1F1F8}\u{1F1E7}": coinSB(),   // Solomon Islands
        "\u{1F1FB}\u{1F1FA}": coinVU(),   // Vanuatu
        "\u{1F1F5}\u{1F1EC}": coinPG(),   // Papua New Guinea
        "\u{1F1EB}\u{1F1EF}": coinFJ(),   // Fiji
        "\u{1F1F3}\u{1F1FF}": coinNZ(),   // New Zealand
    ]

    private static let panelParts: [String: [Part]] = [
        "\u{1F1EA}\u{1F1F9}": panelET(),   // Ethiopia
        "\u{1F1EC}\u{1F1ED}": panelGH(),   // Ghana
        "\u{1F1F9}\u{1F1FF}": panelTZ(),   // Tanzania
        "\u{1F1F0}\u{1F1EA}": panelKE(),   // Kenya
        "\u{1F1F2}\u{1F1E6}": panelMA(),   // Morocco
        "\u{1F1F3}\u{1F1EC}": panelNG(),   // Nigeria
        "\u{1F1EA}\u{1F1EC}": panelEG(),   // Egypt
        "\u{1F1FF}\u{1F1E6}": panelZA(),   // South Africa
        "\u{1F1FB}\u{1F1F3}": panelVN(),   // Vietnam
        "\u{1F1EE}\u{1F1E9}": panelID(),   // Indonesia
        "\u{1F1F9}\u{1F1ED}": panelTH(),   // Thailand
        "\u{1F1F0}\u{1F1F7}": panelKR(),   // South Korea
        "\u{1F1E6}\u{1F1EA}": panelAE(),   // United Arab Emirates
        "\u{1F1F5}\u{1F1F9}": panelPT(),   // Portugal
        "\u{1F1EC}\u{1F1F7}": panelGR(),   // Greece
        "\u{1F1F3}\u{1F1F1}": panelNL(),   // Netherlands
        "\u{1F1EF}\u{1F1F2}": panelJM(),   // Jamaica
        "\u{1F1E8}\u{1F1FA}": panelCU(),   // Cuba
        "\u{1F1E9}\u{1F1F4}": panelDO(),   // Dominican Republic
        "\u{1F1E8}\u{1F1F7}": panelCR(),   // Costa Rica
        "\u{1F1F5}\u{1F1E6}": panelPA(),   // Panama
        "\u{1F1F2}\u{1F1FD}": panelMX(),   // Mexico
        "\u{1F1E7}\u{1F1F4}": panelBO(),   // Bolivia
        "\u{1F1EA}\u{1F1E8}": panelEC(),   // Ecuador
        "\u{1F1FA}\u{1F1FE}": panelUY(),   // Uruguay
        "\u{1F1F5}\u{1F1EA}": panelPE(),   // Peru
        "\u{1F1E8}\u{1F1F4}": panelCO(),   // Colombia
        "\u{1F1E8}\u{1F1F1}": panelCL(),   // Chile
        "\u{1F1E6}\u{1F1F7}": panelAR(),   // Argentina
        "\u{1F1FC}\u{1F1F8}": panelWS(),   // Samoa
        "\u{1F1F9}\u{1F1F4}": panelTO(),   // Tonga
        "\u{1F1F8}\u{1F1E7}": panelSB(),   // Solomon Islands
        "\u{1F1FB}\u{1F1FA}": panelVU(),   // Vanuatu
        "\u{1F1F5}\u{1F1EC}": panelPG(),   // Papua New Guinea
        "\u{1F1EB}\u{1F1EF}": panelFJ(),   // Fiji
        "\u{1F1F3}\u{1F1FF}": panelNZ(),   // New Zealand
    ]

    // MARK: - Coins

    /// Ethiopia.
    private static func coinET() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x078930))
        p = Path()
        p.m(0, 10.67); p.l(32, 10.67); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xFCDD09))
        p = Path()
        p.m(0, 21.33); p.l(32, 21.33); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xDA121A))
        p = Path()
        p.m(7.2, 16); p.c(7.2, 20.86, 11.14, 24.8, 16, 24.8); p.c(20.86, 24.8, 24.8, 20.86, 24.8, 16)
        p.c(24.8, 11.14, 20.86, 7.2, 16, 7.2); p.c(11.14, 7.2, 7.2, 11.14, 7.2, 16); p.z()
        parts.append(part(p, fill: 0x0F47AF))
        p = Path()
        p.m(17.53, 14.15); p.l(20.23, 10.43); p.m(18.47, 17.05); p.l(22.85, 18.47); p.m(16, 18.85)
        p.l(16, 23.45); p.m(13.53, 17.05); p.l(9.15, 18.47); p.m(14.47, 14.15); p.l(11.77, 10.43)
        parts.append(part(p, stroke: 0xFCDD09, width: 0.9))
        p = Path()
        p.m(16, 9.55); p.l(19.94, 21.67); p.l(9.63, 14.18); p.l(22.37, 14.18); p.l(12.06, 21.67); p.z()
        parts.append(part(p, stroke: 0xFCDD09, width: 1.3))
        return parts
    }

    /// Ghana.
    private static func coinGH() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(0, 10.67); p.l(32, 10.67); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xFCD116))
        p = Path()
        p.m(0, 21.33); p.l(32, 21.33); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x006B3F))
        p = Path()
        p.m(16, 10.9); p.l(17.26, 14.77); p.l(21.33, 14.77); p.l(18.03, 17.16); p.l(19.29, 21.03)
        p.l(16, 18.64); p.l(12.71, 21.03); p.l(13.97, 17.16); p.l(10.67, 14.77); p.l(14.74, 14.77); p.z()
        parts.append(part(p, fill: 0x000000))
        return parts
    }

    /// Tanzania.
    private static func coinTZ() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x1EB53A))
        p = Path()
        p.m(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x00A3DD))
        p = Path()
        p.m(-4, 36); p.l(36, -4)
        parts.append(part(p, stroke: 0xFCD116, width: 12))
        p = Path()
        p.m(-4, 36); p.l(36, -4)
        parts.append(part(p, stroke: 0x000000, width: 8.2))
        return parts
    }

    /// Kenya.
    private static func coinKE() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(0, 9.6); p.l(32, 9.6); p.l(32, 22.4); p.l(0, 22.4); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(0, 11.2); p.l(32, 11.2); p.l(32, 20.8); p.l(0, 20.8); p.z()
        parts.append(part(p, fill: 0xBB0000))
        p = Path()
        p.m(0, 22.4); p.l(32, 22.4); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x006600))
        p = Path()
        p.m(10.55, 26.69); p.l(19.72, 8.69); p.m(21.45, 26.69); p.l(12.28, 8.69)
        parts.append(part(p, stroke: 0xFFFFFF, width: 0.95))
        p = Path()
        p.m(19.72, 8.69); p.q(22.64, 7.15, 22.17, 3.88); p.q(19.26, 5.43, 19.72, 8.69); p.z()
        p.m(12.28, 8.69); p.q(12.74, 5.43, 9.83, 3.88); p.q(9.36, 7.15, 12.28, 8.69); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(16, 6.6); p.q(24.6, 16, 16, 25.4); p.q(7.4, 16, 16, 6.6); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(16, 7.1); p.q(21.4, 16, 16, 24.9); p.q(10.6, 16, 16, 7.1); p.z()
        parts.append(part(p, fill: 0xBB0000))
        p = Path()
        p.m(16, 8.8); p.q(16.9, 16, 16, 23.2); p.q(15.1, 16, 16, 8.8); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(14.85, 16); p.c(14.85, 16.75, 15.069, 17.444, 15.425, 17.819)
        p.c(15.781, 18.194, 16.219, 18.194, 16.575, 17.819); p.c(16.931, 17.444, 17.15, 16.75, 17.15, 16)
        p.c(17.15, 15.25, 16.931, 14.556, 16.575, 14.181)
        p.c(16.219, 13.806, 15.781, 13.806, 15.425, 14.181); p.c(15.069, 14.556, 14.85, 15.25, 14.85, 16)
        p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        return parts
    }

    /// Morocco.
    private static func coinMA() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xC1272D))
        p = Path()
        p.m(16, 8.4); p.l(20.82, 23.23); p.l(8.2, 14.07); p.l(23.8, 14.07); p.l(11.18, 23.23); p.z()
        parts.append(part(p, stroke: 0x006233, width: 1.45))
        return parts
    }

    /// Nigeria.
    private static func coinNG() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x008751))
        p = Path()
        p.m(10.67, 0); p.l(32, 0); p.l(32, 32); p.l(10.67, 32); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(21.33, 0); p.l(32, 0); p.l(32, 32); p.l(21.33, 32); p.z()
        parts.append(part(p, fill: 0x008751))
        return parts
    }

    /// Egypt.
    private static func coinEG() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(0, 10.67); p.l(32, 10.67); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(0, 21.33); p.l(32, 21.33); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(16, 13.09); p.l(18.09, 11.96); p.q(20.37, 11.48, 21.7, 13.57); p.l(21.98, 19.55)
        p.l(20.94, 18.7); p.l(20.18, 19.74); p.l(19.23, 18.79); p.l(18.38, 19.74); p.l(17.52, 18.79)
        p.l(16, 18.89); p.l(14.48, 18.79); p.l(13.63, 19.74); p.l(12.77, 18.79); p.l(11.82, 19.74)
        p.l(11.06, 18.7); p.l(10.02, 19.55); p.l(10.3, 13.57); p.q(11.63, 11.48, 13.91, 11.96); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(14.43, 11.67); p.c(14.43, 12.095, 14.657, 12.488, 15.025, 12.701)
        p.c(15.393, 12.913, 15.847, 12.913, 16.215, 12.701)
        p.c(16.583, 12.488, 16.81, 12.095, 16.81, 11.67); p.c(16.81, 11.245, 16.583, 10.852, 16.215, 10.639)
        p.c(15.847, 10.427, 15.393, 10.427, 15.025, 10.639)
        p.c(14.657, 10.852, 14.43, 11.245, 14.43, 11.67); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(14.57, 11.2); p.l(13.15, 11.96); p.l(14.67, 12.43); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(14.77, 12.24); p.l(16.86, 12.24); p.l(16.95, 13.38); p.l(14.86, 13.38); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(14.38, 18.98); p.l(15.04, 18.98); p.l(15.04, 20.31); p.l(14.38, 20.31); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(16.95, 18.98); p.l(17.61, 18.98); p.l(17.61, 20.31); p.l(16.95, 20.31); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(12.58, 20.13); p.l(19.42, 20.13); p.l(19.42, 21.17); p.l(12.58, 21.17); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(14.01, 13.47); p.l(18, 13.47); p.l(18, 16.89); p.q(18, 18.8, 16, 19.55)
        p.q(14.01, 18.8, 14.01, 16.89); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(14.53, 14); p.l(17.47, 14); p.l(17.47, 16.89); p.q(17.47, 18.43, 16, 18.82)
        p.q(14.53, 18.43, 14.53, 16.89); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(14.53, 14); p.l(15.51, 14); p.l(15.51, 18.7); p.l(14.53, 17.66); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(16.49, 14); p.l(17.47, 14); p.l(17.47, 17.66); p.l(16.49, 18.7); p.z()
        parts.append(part(p, fill: 0x000000))
        return parts
    }

    /// South Africa.
    private static func coinZA() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 16); p.l(0, 16); p.z()
        parts.append(part(p, fill: 0xE03C31))
        p = Path()
        p.m(0, 16); p.l(32, 16); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x001489))
        p = Path()
        p.m(-13, -14); p.l(17, 16); p.l(-13, 46); p.m(17, 16); p.l(34, 16)
        parts.append(part(p, stroke: 0xFFFFFF, width: 10.67))
        p = Path()
        p.m(-17.53, -14); p.l(12.47, 16); p.l(-17.53, 46); p.z()
        parts.append(part(p, fill: 0xFFB81C))
        p = Path()
        p.m(-20.54, -14); p.l(9.46, 16); p.l(-20.54, 46); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(-13, -14); p.l(17, 16); p.l(-13, 46); p.m(17, 16); p.l(34, 16)
        parts.append(part(p, stroke: 0x007749, width: 6.4))
        return parts
    }

    /// Vietnam.
    private static func coinVN() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xDA251D))
        p = Path()
        p.m(16, 7.6); p.l(18.07, 13.96); p.l(24.75, 13.96); p.l(19.34, 17.89); p.l(21.41, 24.24)
        p.l(16, 20.31); p.l(10.59, 24.24); p.l(12.66, 17.89); p.l(7.25, 13.96); p.l(13.93, 13.96); p.z()
        parts.append(part(p, fill: 0xFFFF00))
        return parts
    }

    /// Indonesia.
    private static func coinID() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 16); p.l(0, 16); p.z()
        parts.append(part(p, fill: 0xFF0000))
        return parts
    }

    /// Thailand.
    private static func coinTH() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xA51931))
        p = Path()
        p.m(0, 5.33); p.l(32, 5.33); p.l(32, 26.67); p.l(0, 26.67); p.z()
        parts.append(part(p, fill: 0xF4F5F8))
        p = Path()
        p.m(0, 10.67); p.l(32, 10.67); p.l(32, 21.33); p.l(0, 21.33); p.z()
        parts.append(part(p, fill: 0x2D2A4A))
        return parts
    }

    /// South Korea.
    private static func coinKR() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(10.67, 12.45); p.c(12.631, 9.506, 16.606, 8.709, 19.55, 10.67)
        p.c(22.494, 12.631, 23.291, 16.606, 21.33, 19.55); p.z()
        parts.append(part(p, fill: 0xCD2E3A))
        p = Path()
        p.m(21.33, 19.55); p.c(19.369, 22.494, 15.394, 23.291, 12.45, 21.33)
        p.c(9.506, 19.369, 8.709, 15.394, 10.67, 12.45); p.z()
        parts.append(part(p, fill: 0x0047A0))
        p = Path()
        p.m(10.14, 14.22); p.c(10.14, 15.363, 10.75, 16.42, 11.74, 16.991)
        p.c(12.73, 17.563, 13.95, 17.563, 14.94, 16.991); p.c(15.93, 16.42, 16.54, 15.363, 16.54, 14.22)
        p.c(16.54, 12.453, 15.107, 11.02, 13.34, 11.02); p.c(11.573, 11.02, 10.14, 12.453, 10.14, 14.22)
        p.z()
        parts.append(part(p, fill: 0xCD2E3A))
        p = Path()
        p.m(15.46, 17.78); p.c(15.46, 18.923, 16.07, 19.98, 17.06, 20.551)
        p.c(18.05, 21.123, 19.27, 21.123, 20.26, 20.551); p.c(21.25, 19.98, 21.86, 18.923, 21.86, 17.78)
        p.c(21.86, 16.013, 20.427, 14.58, 18.66, 14.58); p.c(16.893, 14.58, 15.46, 16.013, 15.46, 17.78)
        p.z()
        parts.append(part(p, fill: 0x0047A0))
        p = Path()
        p.m(7.56, 13.74); p.l(10.67, 9.08); p.l(9.71, 8.44); p.l(6.6, 13.1); p.z(); p.m(6.11, 12.77)
        p.l(9.21, 8.11); p.l(8.25, 7.47); p.l(5.15, 12.13); p.z(); p.m(4.65, 11.8); p.l(7.76, 7.14)
        p.l(6.8, 6.5); p.l(3.69, 11.16); p.z(); p.m(21.33, 9.08); p.l(22.65, 11.06); p.l(23.61, 10.42)
        p.l(22.29, 8.44); p.z(); p.m(23.12, 11.76); p.l(24.44, 13.74); p.l(25.4, 13.1); p.l(24.08, 11.13)
        p.z(); p.m(22.79, 8.11); p.l(25.89, 12.77); p.l(26.85, 12.13); p.l(23.75, 7.47); p.z()
        p.m(24.24, 7.14); p.l(25.56, 9.11); p.l(26.52, 8.48); p.l(25.2, 6.5); p.z(); p.m(26.03, 9.82)
        p.l(27.35, 11.8); p.l(28.31, 11.16); p.l(26.99, 9.18); p.z(); p.m(10.67, 22.92); p.l(7.56, 18.26)
        p.l(6.6, 18.9); p.l(9.71, 23.56); p.z(); p.m(9.21, 23.89); p.l(7.89, 21.91); p.l(6.94, 22.55)
        p.l(8.25, 24.53); p.z(); p.m(7.42, 21.21); p.l(6.11, 19.23); p.l(5.15, 19.87); p.l(6.47, 21.85)
        p.z(); p.m(7.76, 24.86); p.l(4.65, 20.2); p.l(3.69, 20.84); p.l(6.8, 25.5); p.z(); p.m(24.44, 18.26)
        p.l(23.12, 20.24); p.l(24.08, 20.87); p.l(25.4, 18.9); p.z(); p.m(22.65, 20.94); p.l(21.33, 22.92)
        p.l(22.29, 23.56); p.l(23.61, 21.58); p.z(); p.m(25.89, 19.23); p.l(24.58, 21.21); p.l(25.53, 21.85)
        p.l(26.85, 19.87); p.z(); p.m(24.11, 21.91); p.l(22.79, 23.89); p.l(23.75, 24.53); p.l(25.06, 22.55)
        p.z(); p.m(27.35, 20.2); p.l(26.03, 22.18); p.l(26.99, 22.82); p.l(28.31, 20.84); p.z()
        p.m(25.56, 22.89); p.l(24.24, 24.86); p.l(25.2, 25.5); p.l(26.52, 23.52); p.z()
        parts.append(part(p, fill: 0x000000))
        return parts
    }

    /// United Arab Emirates.
    private static func coinAE() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x00843D))
        p = Path()
        p.m(0, 10.67); p.l(32, 10.67); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(0, 21.33); p.l(32, 21.33); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(0, 0); p.l(9, 0); p.l(9, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xC8102E))
        return parts
    }

    /// Portugal.
    private static func coinPT() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xDA291C))
        p = Path()
        p.m(0, 0); p.l(12.8, 0); p.l(12.8, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x046A38))
        p = Path()
        p.m(5.7, 16); p.c(5.7, 18.537, 7.053, 20.88, 9.25, 22.149)
        p.c(11.447, 23.417, 14.153, 23.417, 16.35, 22.149); p.c(18.547, 20.88, 19.9, 18.537, 19.9, 16)
        p.c(19.9, 12.079, 16.721, 8.9, 12.8, 8.9); p.c(8.879, 8.9, 5.7, 12.079, 5.7, 16); p.z()
        parts.append(part(p, stroke: 0xFFE900, width: 1.4))
        p = Path()
        p.m(5.7, 16.6); p.c(5.7, 17.422, 7.053, 18.181, 9.25, 18.592)
        p.c(11.447, 19.003, 14.153, 19.003, 16.35, 18.592); p.c(18.547, 18.181, 19.9, 17.422, 19.9, 16.6)
        p.c(19.9, 15.778, 18.547, 15.019, 16.35, 14.608); p.c(14.153, 14.197, 11.447, 14.197, 9.25, 14.608)
        p.c(7.053, 15.019, 5.7, 15.778, 5.7, 16.6); p.z()
        parts.append(part(p, stroke: 0xFFE900, width: 1.1))
        p = Path()
        p.m(9.2, 11.8); p.l(16.4, 11.8); p.l(16.4, 17.2); p.c(16.4, 19.188, 14.788, 20.8, 12.8, 20.8)
        p.c(10.812, 20.8, 9.2, 19.188, 9.2, 17.2); p.z()
        parts.append(part(p, fill: 0xDA291C))
        p = Path()
        p.m(9.5, 12.3); p.l(10.3, 12.3); p.l(10.3, 13.1); p.l(9.5, 13.1); p.z()
        parts.append(part(p, fill: 0xFFE900))
        p = Path()
        p.m(12.4, 12.3); p.l(13.2, 12.3); p.l(13.2, 13.1); p.l(12.4, 13.1); p.z()
        parts.append(part(p, fill: 0xFFE900))
        p = Path()
        p.m(15.3, 12.3); p.l(16.1, 12.3); p.l(16.1, 13.1); p.l(15.3, 13.1); p.z()
        parts.append(part(p, fill: 0xFFE900))
        p = Path()
        p.m(9.5, 15.9); p.l(10.3, 15.9); p.l(10.3, 16.7); p.l(9.5, 16.7); p.z()
        parts.append(part(p, fill: 0xFFE900))
        p = Path()
        p.m(15.3, 15.9); p.l(16.1, 15.9); p.l(16.1, 16.7); p.l(15.3, 16.7); p.z()
        parts.append(part(p, fill: 0xFFE900))
        p = Path()
        p.m(10.3, 18.9); p.l(11.1, 18.9); p.l(11.1, 19.7); p.l(10.3, 19.7); p.z()
        parts.append(part(p, fill: 0xFFE900))
        p = Path()
        p.m(14.5, 18.9); p.l(15.3, 18.9); p.l(15.3, 19.7); p.l(14.5, 19.7); p.z()
        parts.append(part(p, fill: 0xFFE900))
        p = Path()
        p.m(10.4, 13); p.l(15.2, 13); p.l(15.2, 17.2); p.c(15.2, 18.525, 14.125, 19.6, 12.8, 19.6)
        p.c(11.475, 19.6, 10.4, 18.525, 10.4, 17.2); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(12.65, 13.55); p.l(12.95, 13.55); p.c(13.116, 13.55, 13.25, 13.684, 13.25, 13.85)
        p.l(13.25, 14.35); p.c(13.25, 14.516, 13.116, 14.65, 12.95, 14.65); p.l(12.65, 14.65)
        p.c(12.484, 14.65, 12.35, 14.516, 12.35, 14.35); p.l(12.35, 13.85)
        p.c(12.35, 13.684, 12.484, 13.55, 12.65, 13.55); p.z()
        parts.append(part(p, fill: 0x002D72))
        p = Path()
        p.m(11.2, 15.45); p.l(11.5, 15.45); p.c(11.666, 15.45, 11.8, 15.584, 11.8, 15.75); p.l(11.8, 16.25)
        p.c(11.8, 16.416, 11.666, 16.55, 11.5, 16.55); p.l(11.2, 16.55)
        p.c(11.034, 16.55, 10.9, 16.416, 10.9, 16.25); p.l(10.9, 15.75)
        p.c(10.9, 15.584, 11.034, 15.45, 11.2, 15.45); p.z()
        parts.append(part(p, fill: 0x002D72))
        p = Path()
        p.m(12.65, 15.45); p.l(12.95, 15.45); p.c(13.116, 15.45, 13.25, 15.584, 13.25, 15.75)
        p.l(13.25, 16.25); p.c(13.25, 16.416, 13.116, 16.55, 12.95, 16.55); p.l(12.65, 16.55)
        p.c(12.484, 16.55, 12.35, 16.416, 12.35, 16.25); p.l(12.35, 15.75)
        p.c(12.35, 15.584, 12.484, 15.45, 12.65, 15.45); p.z()
        parts.append(part(p, fill: 0x002D72))
        p = Path()
        p.m(14.1, 15.45); p.l(14.4, 15.45); p.c(14.566, 15.45, 14.7, 15.584, 14.7, 15.75); p.l(14.7, 16.25)
        p.c(14.7, 16.416, 14.566, 16.55, 14.4, 16.55); p.l(14.1, 16.55)
        p.c(13.934, 16.55, 13.8, 16.416, 13.8, 16.25); p.l(13.8, 15.75)
        p.c(13.8, 15.584, 13.934, 15.45, 14.1, 15.45); p.z()
        parts.append(part(p, fill: 0x002D72))
        p = Path()
        p.m(12.65, 17.35); p.l(12.95, 17.35); p.c(13.116, 17.35, 13.25, 17.484, 13.25, 17.65)
        p.l(13.25, 18.15); p.c(13.25, 18.316, 13.116, 18.45, 12.95, 18.45); p.l(12.65, 18.45)
        p.c(12.484, 18.45, 12.35, 18.316, 12.35, 18.15); p.l(12.35, 17.65)
        p.c(12.35, 17.484, 12.484, 17.35, 12.65, 17.35); p.z()
        parts.append(part(p, fill: 0x002D72))
        return parts
    }

    /// Greece.
    private static func coinGR() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x0D5EAF))
        p = Path()
        p.m(17.78, 3.56); p.l(32, 3.56); p.l(32, 7.11); p.l(17.78, 7.11); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(17.78, 10.67); p.l(32, 10.67); p.l(32, 14.22); p.l(17.78, 14.22); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(0, 17.78); p.l(32, 17.78); p.l(32, 21.33); p.l(0, 21.33); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(0, 24.89); p.l(32, 24.89); p.l(32, 28.44); p.l(0, 28.44); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(7.11, 0); p.l(10.67, 0); p.l(10.67, 17.78); p.l(7.11, 17.78); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(0, 7.11); p.l(17.78, 7.11); p.l(17.78, 10.67); p.l(0, 10.67); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        return parts
    }

    /// Netherlands.
    private static func coinNL() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xAE1C28))
        p = Path()
        p.m(0, 10.67); p.l(32, 10.67); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(0, 21.33); p.l(32, 21.33); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x21468B))
        return parts
    }

    /// Jamaica.
    private static func coinJM() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xFED100))
        p = Path()
        p.m(3.54, 0); p.l(28.46, 0); p.l(16, 12.46); p.z(); p.m(3.54, 32); p.l(28.46, 32); p.l(16, 19.54)
        p.z()
        parts.append(part(p, fill: 0x009B3A))
        p = Path()
        p.m(0, 3.54); p.l(0, 28.46); p.l(12.46, 16); p.z(); p.m(32, 3.54); p.l(32, 28.46); p.l(19.54, 16)
        p.z()
        parts.append(part(p, fill: 0x000000))
        return parts
    }

    /// Cuba.
    private static func coinCU() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x002A8F))
        p = Path()
        p.m(0, 6.4); p.l(32, 6.4); p.l(32, 12.8); p.l(0, 12.8); p.z(); p.m(0, 19.2); p.l(32, 19.2)
        p.l(32, 25.6); p.l(0, 25.6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(0, 0); p.l(20.5, 16); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xCF142B))
        p = Path()
        p.m(7.8, 12); p.l(8.7, 14.76); p.l(11.6, 14.76); p.l(9.25, 16.47); p.l(10.15, 19.24)
        p.l(7.8, 17.53); p.l(5.45, 19.24); p.l(6.35, 16.47); p.l(4, 14.76); p.l(6.9, 14.76); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        return parts
    }

    /// Dominican Republic.
    private static func coinDO() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x002D62))
        p = Path()
        p.m(19, 0); p.l(32, 0); p.l(32, 13); p.l(19, 13); p.z(); p.m(0, 19); p.l(13, 19); p.l(13, 32)
        p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(13, 0); p.l(19, 0); p.l(19, 32); p.l(13, 32); p.z(); p.m(0, 13); p.l(32, 13); p.l(32, 19)
        p.l(0, 19); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(15.2, 18.9); p.c(13.599, 17.784, 12.978, 15.713, 13.7, 13.9)
        parts.append(part(p, stroke: 0x2E7D32, width: 0.75, cap: .round))
        p = Path()
        p.m(16.8, 18.9); p.c(18.401, 17.784, 19.022, 15.713, 18.3, 13.9)
        parts.append(part(p, stroke: 0x2E7D32, width: 0.75, cap: .round))
        p = Path()
        p.m(14.5, 14.3); p.l(17.5, 14.3); p.l(17.5, 16.3); p.c(17.5, 17.294, 16.828, 18.1, 16, 18.1)
        p.c(15.172, 18.1, 14.5, 17.294, 14.5, 16.3); p.z()
        parts.append(part(p, fill: 0x002D62))
        p = Path()
        p.m(16, 14.3); p.l(17.5, 14.3); p.l(17.5, 16.1); p.l(16, 16.1); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(14.5, 16.1); p.l(16, 16.1); p.l(16, 18.1); p.c(15.172, 18.1, 14.5, 17.294, 14.5, 16.3); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(16, 14.3); p.l(16, 18.1)
        parts.append(part(p, stroke: 0xFFFFFF, width: 0.45))
        p = Path()
        p.m(14.5, 16.1); p.l(17.5, 16.1)
        parts.append(part(p, stroke: 0xFFFFFF, width: 0.45))
        p = Path()
        p.m(14.1, 13.5); p.l(17.9, 13.5)
        parts.append(part(p, stroke: 0x002D62, width: 0.6, cap: .round))
        p = Path()
        p.m(14.4, 19.2); p.l(17.6, 19.2)
        parts.append(part(p, stroke: 0xCE1126, width: 0.6, cap: .round))
        return parts
    }

    /// Costa Rica.
    private static func coinCR() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x002B7F))
        p = Path()
        p.m(0, 5.33); p.l(32, 5.33); p.l(32, 26.67); p.l(0, 26.67); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(0, 10.67); p.l(32, 10.67); p.l(32, 21.33); p.l(0, 21.33); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(8.3, 16); p.c(8.3, 17.465, 8.891, 18.818, 9.85, 19.551)
        p.c(10.809, 20.283, 11.991, 20.283, 12.95, 19.551); p.c(13.909, 18.818, 14.5, 17.465, 14.5, 16)
        p.c(14.5, 14.535, 13.909, 13.182, 12.95, 12.449); p.c(11.991, 11.717, 10.809, 11.717, 9.85, 12.449)
        p.c(8.891, 13.182, 8.3, 14.535, 8.3, 16); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(9.8, 13.3); p.l(13, 13.3)
        parts.append(part(p, stroke: 0x002B7F, width: 0.7, cap: .round))
        p = Path()
        p.m(9.1, 17.6); p.l(10.1, 15.8); p.l(10.8, 16.8); p.l(11.4, 14.8); p.l(12, 16.8); p.l(12.7, 15.8)
        p.l(13.7, 17.6); p.z()
        parts.append(part(p, fill: 0x3A8A2E))
        p = Path()
        p.m(9.1, 17.6); p.l(13.7, 17.6); p.l(13.3, 18.6); p.l(9.5, 18.6); p.z()
        parts.append(part(p, fill: 0x1F5FAF))
        return parts
    }

    /// Panama.
    private static func coinPA() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(16, 0); p.l(32, 0); p.l(32, 16); p.l(16, 16); p.z()
        parts.append(part(p, fill: 0xD21034))
        p = Path()
        p.m(0, 16); p.l(16, 16); p.l(16, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x005293))
        p = Path()
        p.m(9.6, 5.8); p.l(10.5, 8.56); p.l(13.4, 8.56); p.l(11.05, 10.27); p.l(11.95, 13.04)
        p.l(9.6, 11.33); p.l(7.25, 13.04); p.l(8.15, 10.27); p.l(5.8, 8.56); p.l(8.7, 8.56); p.z()
        parts.append(part(p, fill: 0x005293))
        p = Path()
        p.m(22.4, 18.6); p.l(23.3, 21.36); p.l(26.2, 21.36); p.l(23.85, 23.07); p.l(24.75, 25.84)
        p.l(22.4, 24.13); p.l(20.05, 25.84); p.l(20.95, 23.07); p.l(18.6, 21.36); p.l(21.5, 21.36); p.z()
        parts.append(part(p, fill: 0xD21034))
        return parts
    }

    /// Mexico.
    private static func coinMX() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x006847))
        p = Path()
        p.m(10.67, 0); p.l(32, 0); p.l(32, 32); p.l(10.67, 32); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(21.33, 0); p.l(32, 0); p.l(32, 32); p.l(21.33, 32); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(11.7, 16.9); p.c(11.7, 19.275, 13.625, 21.2, 16, 21.2)
        p.c(18.375, 21.2, 20.3, 19.275, 20.3, 16.9)
        parts.append(part(p, stroke: 0x2E6B2A, width: 1.2, cap: .round))
        p = Path()
        p.m(14.75, 19.5); p.c(14.75, 19.969, 15.354, 20.35, 16.1, 20.35)
        p.c(16.846, 20.35, 17.45, 19.969, 17.45, 19.5); p.c(17.45, 19.196, 17.193, 18.916, 16.775, 18.764)
        p.c(16.357, 18.612, 15.843, 18.612, 15.425, 18.764); p.c(15.007, 18.916, 14.75, 19.196, 14.75, 19.5)
        p.z()
        parts.append(part(p, fill: 0x4C8C2B))
        p = Path()
        p.m(13.9, 18.5); p.c(13.9, 18.914, 14.348, 19.25, 14.9, 19.25)
        p.c(15.452, 19.25, 15.9, 18.914, 15.9, 18.5); p.c(15.9, 18.086, 15.452, 17.75, 14.9, 17.75)
        p.c(14.348, 17.75, 13.9, 18.086, 13.9, 18.5); p.z()
        parts.append(part(p, fill: 0x4C8C2B))
        p = Path()
        p.m(16.35, 18.4); p.c(16.35, 18.65, 16.531, 18.881, 16.825, 19.006)
        p.c(17.119, 19.131, 17.481, 19.131, 17.775, 19.006); p.c(18.069, 18.881, 18.25, 18.65, 18.25, 18.4)
        p.c(18.25, 18.15, 18.069, 17.919, 17.775, 17.794)
        p.c(17.481, 17.669, 17.119, 17.669, 16.825, 17.794); p.c(16.531, 17.919, 16.35, 18.15, 16.35, 18.4)
        p.z()
        parts.append(part(p, fill: 0x4C8C2B))
        p = Path()
        p.m(11.9, 12.3); p.l(12.3, 11.3); p.l(13.2, 10.6); p.l(14.3, 10.6); p.l(15, 11.2); p.l(15.3, 11.9)
        p.l(15.9, 10.1); p.l(16.9, 8.7); p.l(17.4, 7.8); p.l(17.9, 8.9); p.l(18.8, 8.2); p.l(19, 9.5)
        p.l(20.1, 9.1); p.l(19.9, 10.5); p.l(21, 10.5); p.l(20.5, 11.6); p.l(21.2, 12.1); p.l(19.3, 13.8)
        p.l(18.9, 15.1); p.l(20.2, 16.6); p.l(19.3, 17.2); p.l(18.2, 16.7); p.l(17.1, 16.6); p.l(17.2, 17.6)
        p.l(15.2, 17.6); p.l(15.7, 16.3); p.l(14.5, 15.3); p.l(13.8, 13.8); p.l(13.2, 12.8); p.l(12.6, 12.6)
        p.l(12.3, 13.1); p.z()
        parts.append(part(p, fill: 0x7B4A20))
        p = Path()
        p.m(12.4, 12.4); p.l(11.7, 13.3); p.l(12.3, 14); p.l(11.8, 14.9)
        parts.append(part(p, stroke: 0x2E6B2A, width: 0.55, cap: .round, join: .round))
        return parts
    }

    /// Bolivia.
    private static func coinBO() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xD52B1E))
        p = Path()
        p.m(0, 10.67); p.l(32, 10.67); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xF9E300))
        p = Path()
        p.m(0, 21.33); p.l(32, 21.33); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x007934))
        p = Path()
        p.m(14.2, 15.6); p.l(10.9, 14.3)
        parts.append(part(p, stroke: 0xD52B1E, width: 0.95))
        p = Path()
        p.m(14.2, 17.5); p.l(10.9, 16.2)
        parts.append(part(p, stroke: 0x007934, width: 0.95))
        p = Path()
        p.m(17.8, 15.6); p.l(21.1, 14.3)
        parts.append(part(p, stroke: 0xD52B1E, width: 0.95))
        p = Path()
        p.m(17.8, 17.5); p.l(21.1, 16.2)
        parts.append(part(p, stroke: 0x007934, width: 0.95))
        p = Path()
        p.m(13.2, 17.2); p.c(13.2, 18.415, 13.734, 19.537, 14.6, 20.144)
        p.c(15.466, 20.752, 16.534, 20.752, 17.4, 20.144); p.c(18.266, 19.537, 18.8, 18.415, 18.8, 17.2)
        p.c(18.8, 15.322, 17.546, 13.8, 16, 13.8); p.c(14.454, 13.8, 13.2, 15.322, 13.2, 17.2); p.z()
        parts.append(part(p, fill: 0x8BCDEF, stroke: 0x1D4F9F, width: 0.8))
        p = Path()
        p.m(13.9, 20); p.l(16, 15.6); p.l(18.1, 20); p.z()
        parts.append(part(p, fill: 0xA86F32))
        p = Path()
        p.m(16.7, 15.5); p.c(16.7, 15.714, 16.814, 15.912, 17, 16.02)
        p.c(17.186, 16.127, 17.414, 16.127, 17.6, 16.02); p.c(17.786, 15.912, 17.9, 15.714, 17.9, 15.5)
        p.c(17.9, 15.286, 17.786, 15.088, 17.6, 14.98); p.c(17.414, 14.873, 17.186, 14.873, 17, 14.98)
        p.c(16.814, 15.088, 16.7, 15.286, 16.7, 15.5); p.z()
        parts.append(part(p, fill: 0xF9E300))
        p = Path()
        p.m(11.6, 12.9); p.l(13.2, 12.4); p.l(14.8, 12.8); p.l(15.5, 12); p.l(15.8, 11.3); p.l(16.2, 11.3)
        p.l(16.5, 12); p.l(17.2, 12.8); p.l(18.8, 12.4); p.l(20.4, 12.9); p.l(19.2, 13.5); p.l(17.4, 13.8)
        p.l(16.6, 14.6); p.l(15.4, 14.6); p.l(14.6, 13.8); p.l(12.8, 13.5); p.z()
        parts.append(part(p, fill: 0x262626))
        return parts
    }

    /// Ecuador.
    private static func coinEC() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xFFDD00))
        p = Path()
        p.m(0, 16); p.l(32, 16); p.l(32, 24); p.l(0, 24); p.z()
        parts.append(part(p, fill: 0x034EA2))
        p = Path()
        p.m(0, 24); p.l(32, 24); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xED1C24))
        p = Path()
        p.m(13, 17.6); p.c(13, 19.699, 14.343, 21.4, 16, 21.4); p.c(17.657, 21.4, 19, 19.699, 19, 17.6)
        p.c(19, 15.501, 17.657, 13.8, 16, 13.8); p.c(14.343, 13.8, 13, 15.501, 13, 17.6); p.z()
        parts.append(part(p, fill: 0x8BCDEF, stroke: 0xC9971C, width: 0.8))
        p = Path()
        p.m(13.3, 20.3); p.l(15.9, 15.9); p.l(18.7, 20.3); p.z()
        parts.append(part(p, fill: 0x5F7F45))
        p = Path()
        p.m(15.2, 17.1); p.l(15.9, 15.9); p.l(16.6, 17.1); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(16.85, 15.6); p.c(16.85, 16.014, 17.186, 16.35, 17.6, 16.35)
        p.c(18.014, 16.35, 18.35, 16.014, 18.35, 15.6); p.c(18.35, 15.186, 18.014, 14.85, 17.6, 14.85)
        p.c(17.186, 14.85, 16.85, 15.186, 16.85, 15.6); p.z()
        parts.append(part(p, fill: 0xFFDD00))
        p = Path()
        p.m(10.2, 11.6); p.l(12.2, 11); p.l(14.3, 11.4); p.l(15.2, 10.5); p.l(15.6, 9.7); p.l(16.4, 9.7)
        p.l(16.8, 10.5); p.l(17.7, 11.4); p.l(19.8, 11); p.l(21.8, 11.6); p.l(20.8, 12.1); p.l(21.2, 12.5)
        p.l(19.6, 12.7); p.l(19.8, 13.2); p.l(17.5, 13.2); p.l(16.7, 14.4); p.l(15.3, 14.4); p.l(14.5, 13.2)
        p.l(12.2, 13.2); p.l(12.4, 12.7); p.l(10.8, 12.5); p.l(11.2, 12.1); p.z()
        parts.append(part(p, fill: 0x262626))
        return parts
    }

    /// Uruguay.
    private static func coinUY() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(17.78, 3.56); p.l(32, 3.56); p.l(32, 7.11); p.l(17.78, 7.11); p.z(); p.m(17.78, 10.67)
        p.l(32, 10.67); p.l(32, 14.22); p.l(17.78, 14.22); p.z(); p.m(0, 17.78); p.l(32, 17.78)
        p.l(32, 21.33); p.l(0, 21.33); p.z(); p.m(0, 24.89); p.l(32, 24.89); p.l(32, 28.44); p.l(0, 28.44)
        p.z()
        parts.append(part(p, fill: 0x0038A8))
        p = Path()
        p.m(9.8, 4.2); p.l(10.4, 6.78); p.l(11.94, 4.63); p.l(11.51, 7.24); p.l(13.76, 5.84)
        p.l(12.36, 8.09); p.l(14.97, 7.66); p.l(12.82, 9.2); p.l(15.4, 9.8); p.l(12.82, 10.4)
        p.l(14.97, 11.94); p.l(12.36, 11.51); p.l(13.76, 13.76); p.l(11.51, 12.36); p.l(11.94, 14.97)
        p.l(10.4, 12.82); p.l(9.8, 15.4); p.l(9.2, 12.82); p.l(7.66, 14.97); p.l(8.09, 12.36)
        p.l(5.84, 13.76); p.l(7.24, 11.51); p.l(4.63, 11.94); p.l(6.78, 10.4); p.l(4.2, 9.8); p.l(6.78, 9.2)
        p.l(4.63, 7.66); p.l(7.24, 8.09); p.l(5.84, 5.84); p.l(8.09, 7.24); p.l(7.66, 4.63); p.l(9.2, 6.78)
        p.z()
        parts.append(part(p, fill: 0xFCD116, stroke: 0x7B3F00, width: 0.35, join: .round))
        p = Path()
        p.m(7.2, 9.8); p.c(7.2, 11.236, 8.364, 12.4, 9.8, 12.4); p.c(11.236, 12.4, 12.4, 11.236, 12.4, 9.8)
        p.c(12.4, 8.364, 11.236, 7.2, 9.8, 7.2); p.c(8.364, 7.2, 7.2, 8.364, 7.2, 9.8); p.z()
        parts.append(part(p, fill: 0xFCD116, stroke: 0x7B3F00, width: 0.35, join: .round))
        return parts
    }

    /// Peru.
    private static func coinPE() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xD91023))
        p = Path()
        p.m(10.67, 0); p.l(32, 0); p.l(32, 32); p.l(10.67, 32); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(21.33, 0); p.l(32, 0); p.l(32, 32); p.l(21.33, 32); p.z()
        parts.append(part(p, fill: 0xD91023))
        return parts
    }

    /// Colombia.
    private static func coinCO() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xFCD116))
        p = Path()
        p.m(0, 16); p.l(32, 16); p.l(32, 24); p.l(0, 24); p.z()
        parts.append(part(p, fill: 0x003893))
        p = Path()
        p.m(0, 24); p.l(32, 24); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xCE1126))
        return parts
    }

    /// Chile.
    private static func coinCL() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xD52B1E))
        p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 16); p.l(0, 16); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(0, 0); p.l(16, 0); p.l(16, 16); p.l(0, 16); p.z()
        parts.append(part(p, fill: 0x0039A6))
        p = Path()
        p.m(9.6, 5.6); p.l(10.54, 8.5); p.l(13.59, 8.5); p.l(11.13, 10.3); p.l(12.07, 13.2); p.l(9.6, 11.4)
        p.l(7.13, 13.2); p.l(8.07, 10.3); p.l(5.61, 8.5); p.l(8.66, 8.5); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        return parts
    }

    /// Argentina.
    private static func coinAR() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x74ACDF))
        p = Path()
        p.m(0, 10.67); p.l(32, 10.67); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(0, 21.33); p.l(32, 21.33); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x74ACDF))
        p = Path()
        p.m(16, 11.1); p.l(16.57, 13.12); p.l(17.88, 11.47); p.l(17.63, 13.56); p.l(19.46, 12.54)
        p.l(18.44, 14.37); p.l(20.53, 14.12); p.l(18.88, 15.43); p.l(20.9, 16); p.l(18.88, 16.57)
        p.l(20.53, 17.88); p.l(18.44, 17.63); p.l(19.46, 19.46); p.l(17.63, 18.44); p.l(17.88, 20.53)
        p.l(16.57, 18.88); p.l(16, 20.9); p.l(15.43, 18.88); p.l(14.12, 20.53); p.l(14.37, 18.44)
        p.l(12.54, 19.46); p.l(13.56, 17.63); p.l(11.47, 17.88); p.l(13.12, 16.57); p.l(11.1, 16)
        p.l(13.12, 15.43); p.l(11.47, 14.12); p.l(13.56, 14.37); p.l(12.54, 12.54); p.l(14.37, 13.56)
        p.l(14.12, 11.47); p.l(15.43, 13.12); p.z()
        parts.append(part(p, fill: 0xF6B40E, stroke: 0x85340A, width: 0.35, join: .round))
        p = Path()
        p.m(13.7, 16); p.c(13.7, 16.822, 14.138, 17.581, 14.85, 17.992)
        p.c(15.562, 18.403, 16.438, 18.403, 17.15, 17.992); p.c(17.862, 17.581, 18.3, 16.822, 18.3, 16)
        p.c(18.3, 14.73, 17.27, 13.7, 16, 13.7); p.c(14.73, 13.7, 13.7, 14.73, 13.7, 16); p.z()
        parts.append(part(p, fill: 0xF6B40E, stroke: 0x85340A, width: 0.35, join: .round))
        return parts
    }

    /// Samoa.
    private static func coinWS() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(0, 0); p.l(17.5, 0); p.l(17.5, 17.5); p.l(0, 17.5); p.z()
        parts.append(part(p, fill: 0x002B7F))
        p = Path()
        p.m(10.6, 3.7); p.l(11.03, 5.01); p.l(12.41, 5.01); p.l(11.29, 5.82); p.l(11.72, 7.14)
        p.l(10.6, 6.33); p.l(9.48, 7.14); p.l(9.91, 5.82); p.l(8.79, 5.01); p.l(10.17, 5.01); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(6.6, 8.8); p.l(7.03, 10.11); p.l(8.41, 10.11); p.l(7.29, 10.92); p.l(7.72, 12.24)
        p.l(6.6, 11.43); p.l(5.48, 12.24); p.l(5.91, 10.92); p.l(4.79, 10.11); p.l(6.17, 10.11); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(14.2, 6.9); p.l(14.63, 8.21); p.l(16.01, 8.21); p.l(14.89, 9.02); p.l(15.32, 10.34)
        p.l(14.2, 9.53); p.l(13.08, 10.34); p.l(13.51, 9.02); p.l(12.39, 8.21); p.l(13.77, 8.21); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(12.3, 10.7); p.l(12.57, 11.53); p.l(13.44, 11.53); p.l(12.74, 12.04); p.l(13.01, 12.87)
        p.l(12.3, 12.36); p.l(11.59, 12.87); p.l(11.86, 12.04); p.l(11.16, 11.53); p.l(12.03, 11.53); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(10.6, 12.7); p.l(11.03, 14.01); p.l(12.41, 14.01); p.l(11.29, 14.82); p.l(11.72, 16.14)
        p.l(10.6, 15.33); p.l(9.48, 16.14); p.l(9.91, 14.82); p.l(8.79, 14.01); p.l(10.17, 14.01); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        return parts
    }

    /// Tonga.
    private static func coinTO() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0xC10000))
        p = Path()
        p.m(0, 0); p.l(17, 0); p.l(17, 16.5); p.l(0, 16.5); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(8.9, 6); p.l(11.9, 6); p.l(11.9, 14.4); p.l(8.9, 14.4); p.z()
        parts.append(part(p, fill: 0xC10000))
        p = Path()
        p.m(6.2, 8.7); p.l(14.6, 8.7); p.l(14.6, 11.7); p.l(6.2, 11.7); p.z()
        parts.append(part(p, fill: 0xC10000))
        return parts
    }

    /// Solomon Islands.
    private static func coinSB() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x215B33))
        p = Path()
        p.m(0, 0); p.l(32, 0); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x0051BA))
        p = Path()
        p.m(33.15, -2.85); p.l(-2.85, 33.15); p.l(-1.15, 34.85); p.l(34.85, -1.15); p.z()
        parts.append(part(p, fill: 0xFCD116))
        p = Path()
        p.m(7.1, 5.45); p.l(7.47, 6.59); p.l(8.67, 6.59); p.l(7.7, 7.29); p.l(8.07, 8.43); p.l(7.1, 7.73)
        p.l(6.13, 8.43); p.l(6.5, 7.29); p.l(5.53, 6.59); p.l(6.73, 6.59); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(13.1, 5.45); p.l(13.47, 6.59); p.l(14.67, 6.59); p.l(13.7, 7.29); p.l(14.07, 8.43)
        p.l(13.1, 7.73); p.l(12.13, 8.43); p.l(12.5, 7.29); p.l(11.53, 6.59); p.l(12.73, 6.59); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(10.1, 8.45); p.l(10.47, 9.59); p.l(11.67, 9.59); p.l(10.7, 10.29); p.l(11.07, 11.43)
        p.l(10.1, 10.73); p.l(9.13, 11.43); p.l(9.5, 10.29); p.l(8.53, 9.59); p.l(9.73, 9.59); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(7.1, 11.45); p.l(7.47, 12.59); p.l(8.67, 12.59); p.l(7.7, 13.29); p.l(8.07, 14.43)
        p.l(7.1, 13.73); p.l(6.13, 14.43); p.l(6.5, 13.29); p.l(5.53, 12.59); p.l(6.73, 12.59); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(13.1, 11.45); p.l(13.47, 12.59); p.l(14.67, 12.59); p.l(13.7, 13.29); p.l(14.07, 14.43)
        p.l(13.1, 13.73); p.l(12.13, 14.43); p.l(12.5, 13.29); p.l(11.53, 12.59); p.l(12.73, 12.59); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        return parts
    }

    /// Vanuatu.
    private static func coinVU() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x009543))
        p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 16); p.l(0, 16); p.z()
        parts.append(part(p, fill: 0xD21034))
        p = Path()
        p.m(-18.9, -22.91); p.l(15.59, 13.7); p.l(40, 13.7); p.l(40, 18.3); p.l(15.59, 18.3)
        p.l(-18.9, 54.91); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(-19.95, -21.92); p.l(14.97, 15.15); p.l(40, 15.15); p.l(40, 16.85); p.l(14.97, 16.85)
        p.l(-19.95, 53.92); p.z()
        parts.append(part(p, fill: 0xFDCE12))
        p = Path()
        p.m(-21.19, -20.75); p.l(13.43, 16); p.l(-21.19, 52.75); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(5.95, 18.8); p.c(4.728, 18.472, 3.86, 17.389, 3.805, 16.125)
        p.c(3.75, 14.861, 4.521, 13.707, 5.71, 13.274); p.c(6.899, 12.841, 8.231, 13.229, 9.002, 14.232)
        p.c(9.773, 15.236, 9.804, 16.623, 9.08, 17.66); p.q(7.71, 18.78, 7.28, 17.22)
        parts.append(part(p, stroke: 0xFDCE12, width: 1.15, cap: .round))
        p = Path()
        p.m(5.25, 14.55); p.l(7.86, 17.16); p.m(8.15, 14.55); p.l(5.54, 17.16)
        parts.append(part(p, stroke: 0xFDCE12, width: 0.7, cap: .round))
        return parts
    }

    /// Papua New Guinea.
    private static func coinPG() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(9.5, 12.2); p.l(9.93, 13.51); p.l(11.31, 13.51); p.l(10.19, 14.32); p.l(10.62, 15.64)
        p.l(9.5, 14.83); p.l(8.38, 15.64); p.l(8.81, 14.32); p.l(7.69, 13.51); p.l(9.07, 13.51); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(5.3, 17.8); p.l(5.73, 19.11); p.l(7.11, 19.11); p.l(5.99, 19.92); p.l(6.42, 21.24)
        p.l(5.3, 20.43); p.l(4.18, 21.24); p.l(4.61, 19.92); p.l(3.49, 19.11); p.l(4.87, 19.11); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(13.9, 17.8); p.l(14.33, 19.11); p.l(15.71, 19.11); p.l(14.59, 19.92); p.l(15.02, 21.24)
        p.l(13.9, 20.43); p.l(12.78, 21.24); p.l(13.21, 19.92); p.l(12.09, 19.11); p.l(13.47, 19.11); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(11.6, 22.2); p.l(11.85, 22.96); p.l(12.65, 22.96); p.l(12, 23.43); p.l(12.25, 24.19)
        p.l(11.6, 23.72); p.l(10.95, 24.19); p.l(11.2, 23.43); p.l(10.55, 22.96); p.l(11.35, 22.96); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(9.5, 23.8); p.l(9.93, 25.11); p.l(11.31, 25.11); p.l(10.19, 25.92); p.l(10.62, 27.24)
        p.l(9.5, 26.43); p.l(8.38, 27.24); p.l(8.81, 25.92); p.l(7.69, 25.11); p.l(9.07, 25.11); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(17.13, 7.92); p.l(17.85, 7.36); p.q(18.46, 6.9, 19.07, 7.41); p.q(19.58, 7.92, 19.99, 8.03)
        p.q(20.09, 5.83, 21.62, 4.2); p.l(21.77, 5.38); p.l(22.59, 4.86); p.l(22.49, 6.14); p.l(23.41, 5.88)
        p.l(23, 7.16); p.l(23.86, 7.26); p.l(22.89, 8.59); p.q(22.44, 9.51, 21.93, 10.22)
        p.q(21.31, 11.24, 20.4, 11.24); p.l(19.89, 12.97); p.l(19.12, 11.9); p.l(18.2, 13.23)
        p.l(17.95, 11.9); p.l(16.57, 12.72); p.l(17.08, 11.5); p.l(15.6, 11.44); p.l(17.34, 10.53)
        p.q(18.76, 9.81, 19.12, 8.89); p.q(18.56, 8.28, 17.95, 8.28); p.z()
        parts.append(part(p, fill: 0xFCD116))
        p = Path()
        p.m(21.82, 10.32); p.q(26.01, 12.36, 25.39, 15.52); p.q(24.99, 16.95, 23.86, 16.34)
        p.m(21.31, 10.93); p.q(24.37, 12.97, 24.02, 14.91); p.q(23.71, 15.93, 23.05, 15.42)
        parts.append(part(p, stroke: 0xFCD116, width: 0.48, cap: .round))
        return parts
    }

    /// Fiji.
    private static func coinFJ() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x68BFE5))
        p = Path()
        p.m(0, 0); p.l(16, 0); p.l(16, 14); p.l(0, 14); p.z()
        parts.append(part(p, fill: 0x012169))
        p = Path()
        p.m(0, 0); p.l(16, 14); p.m(16, 0); p.l(0, 14)
        parts.append(part(p, stroke: 0xFFFFFF, width: 2.6))
        p = Path()
        p.m(0, 0); p.l(16, 14); p.m(16, 0); p.l(0, 14)
        parts.append(part(p, stroke: 0xC8102E, width: 1.1))
        p = Path()
        p.m(8, 0); p.l(8, 14); p.m(0, 7); p.l(16, 7)
        parts.append(part(p, stroke: 0xFFFFFF, width: 4.6))
        p = Path()
        p.m(8, 0); p.l(8, 14); p.m(0, 7); p.l(16, 7)
        parts.append(part(p, stroke: 0xC8102E, width: 2.6))
        p = Path()
        p.m(16, 0); p.l(17.2, 0); p.l(17.2, 1.8); p.l(16, 1.8); p.z(); p.m(16, 12); p.l(17.2, 12)
        p.l(17.2, 15.2); p.l(14, 15.2); p.l(14, 14); p.l(16, 14); p.z()
        parts.append(part(p, fill: 0x68BFE5))
        p = Path()
        p.m(18.9, 11.4); p.l(27.5, 11.4); p.l(27.5, 18.29); p.q(27.5, 22.84, 23.2, 24.4)
        p.q(18.9, 22.84, 18.9, 18.29); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(18.9, 11.4); p.l(27.5, 11.4); p.l(27.5, 14.6); p.l(18.9, 14.6); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(21.14, 13); p.c(21.14, 13.297, 21.533, 13.571, 22.17, 13.719)
        p.c(22.807, 13.867, 23.593, 13.867, 24.23, 13.719); p.c(24.867, 13.571, 25.26, 13.297, 25.26, 13)
        p.c(25.26, 12.703, 24.867, 12.429, 24.23, 12.281)
        p.c(23.593, 12.133, 22.807, 12.133, 22.17, 12.281); p.c(21.533, 12.429, 21.14, 12.703, 21.14, 13)
        p.z()
        parts.append(part(p, fill: 0xFCD116))
        p = Path()
        p.m(22.5, 14.6); p.l(23.9, 14.6); p.l(23.9, 23.5); p.l(22.5, 23.5); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(18.9, 17.82); p.l(27.5, 17.82); p.l(27.5, 19.22); p.l(18.9, 19.22); p.z()
        parts.append(part(p, fill: 0xCE1126))
        return parts
    }

    /// New Zealand.
    private static func coinNZ() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(0, 0); p.l(32, 0); p.l(32, 32); p.l(0, 32); p.z()
        parts.append(part(p, fill: 0x012169))
        p = Path()
        p.m(0, 0); p.l(16, 14); p.m(16, 0); p.l(0, 14)
        parts.append(part(p, stroke: 0xFFFFFF, width: 2.6))
        p = Path()
        p.m(0, 0); p.l(16, 14); p.m(16, 0); p.l(0, 14)
        parts.append(part(p, stroke: 0xC8102E, width: 1.1))
        p = Path()
        p.m(8, 0); p.l(8, 14); p.m(0, 7); p.l(16, 7)
        parts.append(part(p, stroke: 0xFFFFFF, width: 4.6))
        p = Path()
        p.m(8, 0); p.l(8, 14); p.m(0, 7); p.l(16, 7)
        parts.append(part(p, stroke: 0xC8102E, width: 2.6))
        p = Path()
        p.m(16, 0); p.l(17.2, 0); p.l(17.2, 1.8); p.l(16, 1.8); p.z(); p.m(16, 12); p.l(17.2, 12)
        p.l(17.2, 15.2); p.l(14, 15.2); p.l(14, 14); p.l(16, 14); p.z()
        parts.append(part(p, fill: 0x012169))
        p = Path()
        p.m(23.6, 4.89); p.l(24.25, 6.9); p.l(26.37, 6.9); p.l(24.66, 8.14); p.l(25.31, 10.15)
        p.l(23.6, 8.91); p.l(21.89, 10.15); p.l(22.54, 8.14); p.l(20.83, 6.9); p.l(22.95, 6.9); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(19.6, 14.29); p.l(20.25, 16.3); p.l(22.37, 16.3); p.l(20.66, 17.54); p.l(21.31, 19.55)
        p.l(19.6, 18.31); p.l(17.89, 19.55); p.l(18.54, 17.54); p.l(16.83, 16.3); p.l(18.95, 16.3); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(27.1, 11.79); p.l(27.69, 13.59); p.l(29.58, 13.59); p.l(28.05, 14.71); p.l(28.63, 16.51)
        p.l(27.1, 15.4); p.l(25.57, 16.51); p.l(26.15, 14.71); p.l(24.62, 13.59); p.l(26.51, 13.59); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(23.6, 20.49); p.l(24.3, 22.64); p.l(26.56, 22.64); p.l(24.73, 23.97); p.l(25.43, 26.12)
        p.l(23.6, 24.79); p.l(21.77, 26.12); p.l(22.47, 23.97); p.l(20.64, 22.64); p.l(22.9, 22.64); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(23.6, 5.8); p.l(24.05, 7.18); p.l(25.5, 7.18); p.l(24.33, 8.04); p.l(24.78, 9.42)
        p.l(23.6, 8.56); p.l(22.42, 9.42); p.l(22.87, 8.04); p.l(21.7, 7.18); p.l(23.15, 7.18); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(19.6, 15.2); p.l(20.05, 16.58); p.l(21.5, 16.58); p.l(20.33, 17.44); p.l(20.78, 18.82)
        p.l(19.6, 17.96); p.l(18.42, 18.82); p.l(18.87, 17.44); p.l(17.7, 16.58); p.l(19.15, 16.58); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(27.1, 12.7); p.l(27.48, 13.87); p.l(28.72, 13.87); p.l(27.72, 14.6); p.l(28.1, 15.78)
        p.l(27.1, 15.05); p.l(26.1, 15.78); p.l(26.48, 14.6); p.l(25.48, 13.87); p.l(26.72, 13.87); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(23.6, 21.4); p.l(24.09, 22.92); p.l(25.69, 22.92); p.l(24.4, 23.86); p.l(24.89, 25.38)
        p.l(23.6, 24.44); p.l(22.31, 25.38); p.l(22.8, 23.86); p.l(21.51, 22.92); p.l(23.11, 22.92); p.z()
        parts.append(part(p, fill: 0xC8102E))
        return parts
    }

    // MARK: - Panels

    /// Ethiopia.
    private static func panelET() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x078930))
        p = Path()
        p.m(3.5, 12.67); p.l(28.5, 12.67); p.c(29.881, 12.67, 31, 13.789, 31, 15.17); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5)
        p.l(1, 15.17); p.c(1, 13.789, 2.119, 12.67, 3.5, 12.67); p.z()
        parts.append(part(p, fill: 0xDA121A))
        p = Path()
        p.m(1, 12.67); p.l(31, 12.67); p.l(31, 19.33); p.l(1, 19.33); p.z()
        parts.append(part(p, fill: 0xFCDD09))
        p = Path()
        p.m(10.4, 16); p.c(10.4, 19.093, 12.907, 21.6, 16, 21.6); p.c(19.093, 21.6, 21.6, 19.093, 21.6, 16)
        p.c(21.6, 12.907, 19.093, 10.4, 16, 10.4); p.c(12.907, 10.4, 10.4, 12.907, 10.4, 16); p.z()
        parts.append(part(p, fill: 0x0F47AF))
        p = Path()
        p.m(17, 14.77); p.l(18.7, 12.43); p.m(17.62, 16.68); p.l(20.37, 17.57); p.m(16, 17.85)
        p.l(16, 20.75); p.m(14.38, 16.68); p.l(11.63, 17.57); p.m(15, 14.77); p.l(13.3, 12.43)
        parts.append(part(p, stroke: 0xFCDD09, width: 0.6))
        p = Path()
        p.m(16, 11.95); p.l(18.47, 19.55); p.l(12.01, 14.85); p.l(19.99, 14.85); p.l(13.53, 19.55); p.z()
        parts.append(part(p, stroke: 0xFCDD09, width: 0.85))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Ghana.
    private static func panelGH() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(3.5, 12.67); p.l(28.5, 12.67); p.c(29.881, 12.67, 31, 13.789, 31, 15.17); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5)
        p.l(1, 15.17); p.c(1, 13.789, 2.119, 12.67, 3.5, 12.67); p.z()
        parts.append(part(p, fill: 0x006B3F))
        p = Path()
        p.m(1, 12.67); p.l(31, 12.67); p.l(31, 19.33); p.l(1, 19.33); p.z()
        parts.append(part(p, fill: 0xFCD116))
        p = Path()
        p.m(16, 12.75); p.l(16.81, 15.23); p.l(19.42, 15.24); p.l(17.31, 16.78); p.l(18.12, 19.26)
        p.l(16, 17.73); p.l(13.88, 19.26); p.l(14.69, 16.78); p.l(12.58, 15.24); p.l(15.19, 15.23); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Tanzania.
    private static func panelTZ() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFCD116))
        p = Path()
        p.m(1, 21.24); p.l(1, 8.5); p.c(1, 7.119, 2.119, 6, 3.5, 6); p.l(23.86, 6); p.z()
        parts.append(part(p, fill: 0x1EB53A))
        p = Path()
        p.m(8.14, 26); p.l(28.5, 26); p.c(29.881, 26, 31, 24.881, 31, 23.5); p.l(31, 10.76); p.z()
        parts.append(part(p, fill: 0x00A3DD))
        p = Path()
        p.m(1, 22.74); p.l(1, 23.5); p.c(1, 24.881, 2.119, 26, 3.5, 26); p.l(5.88, 26); p.l(31, 9.26)
        p.l(31, 8.5); p.c(31, 7.119, 29.881, 6, 28.5, 6); p.l(26.12, 6); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Kenya.
    private static func panelKE() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(3.5, 12); p.l(28.5, 12); p.c(29.881, 12, 31, 13.119, 31, 14.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5)
        p.l(1, 14.5); p.c(1, 13.119, 2.119, 12, 3.5, 12); p.z()
        parts.append(part(p, fill: 0x006600))
        p = Path()
        p.m(1, 12); p.l(31, 12); p.l(31, 20); p.l(1, 20); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(1, 13); p.l(31, 13); p.l(31, 19); p.l(1, 19); p.z()
        parts.append(part(p, fill: 0xBB0000))
        p = Path()
        p.m(12.4, 23.06); p.l(18.46, 11.18); p.m(19.6, 23.06); p.l(13.54, 11.18)
        parts.append(part(p, stroke: 0xFFFFFF, width: 0.53))
        p = Path()
        p.m(18.46, 11.18); p.q(20.38, 10.16, 20.08, 8); p.q(18.15, 9.02, 18.46, 11.18); p.z()
        p.m(13.54, 11.18); p.q(13.85, 9.02, 11.92, 8); p.q(11.62, 10.16, 13.54, 11.18); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(16, 9.8); p.q(21.68, 16, 16, 22.2); p.q(10.32, 16, 16, 9.8); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(16, 10.13); p.q(19.56, 16, 16, 21.87); p.q(12.44, 16, 16, 10.13); p.z()
        parts.append(part(p, fill: 0xBB0000))
        p = Path()
        p.m(16, 11.25); p.q(16.59, 16, 16, 20.75); p.q(15.41, 16, 16, 11.25); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(15.24, 16); p.c(15.24, 16.768, 15.58, 17.39, 16, 17.39)
        p.c(16.42, 17.39, 16.76, 16.768, 16.76, 16); p.c(16.76, 15.503, 16.615, 15.045, 16.38, 14.796)
        p.c(16.145, 14.548, 15.855, 14.548, 15.62, 14.796); p.c(15.385, 15.045, 15.24, 15.503, 15.24, 16)
        p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Morocco.
    private static func panelMA() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xC1272D))
        p = Path()
        p.m(16, 11.4); p.l(18.94, 20.45); p.l(11.24, 14.85); p.l(20.76, 14.85); p.l(13.06, 20.45); p.z()
        parts.append(part(p, stroke: 0x006233, width: 0.95))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Nigeria.
    private static func panelNG() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x008751))
        p = Path()
        p.m(11, 6); p.l(21, 6); p.l(21, 26); p.l(11, 26); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Egypt.
    private static func panelEG() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(3.5, 12.67); p.l(28.5, 12.67); p.c(29.881, 12.67, 31, 13.789, 31, 15.17); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5)
        p.l(1, 15.17); p.c(1, 13.789, 2.119, 12.67, 3.5, 12.67); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(1, 12.67); p.l(31, 12.67); p.l(31, 19.33); p.l(1, 19.33); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(16, 14.3); p.l(17.25, 13.61); p.q(18.62, 13.33, 19.42, 14.58); p.l(19.59, 18.17)
        p.l(18.96, 17.66); p.l(18.51, 18.29); p.l(17.94, 17.72); p.l(17.43, 18.29); p.l(16.91, 17.72)
        p.l(16, 17.77); p.l(15.09, 17.72); p.l(14.57, 18.29); p.l(14.06, 17.72); p.l(13.49, 18.29)
        p.l(13.04, 17.66); p.l(12.41, 18.17); p.l(12.58, 14.58); p.q(13.38, 13.33, 14.75, 13.61); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(15.06, 13.44); p.c(15.06, 13.694, 15.195, 13.928, 15.415, 14.055)
        p.c(15.635, 14.182, 15.905, 14.182, 16.125, 14.055)
        p.c(16.345, 13.928, 16.48, 13.694, 16.48, 13.44); p.c(16.48, 13.048, 16.162, 12.73, 15.77, 12.73)
        p.c(15.378, 12.73, 15.06, 13.048, 15.06, 13.44); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(15.14, 13.16); p.l(14.29, 13.61); p.l(15.2, 13.9); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(15.26, 13.78); p.l(16.51, 13.78); p.l(16.57, 14.47); p.l(15.32, 14.47); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(15.03, 17.83); p.l(15.43, 17.83); p.l(15.43, 18.63); p.l(15.03, 18.63); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(16.57, 17.83); p.l(16.97, 17.83); p.l(16.97, 18.63); p.l(16.57, 18.63); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(13.95, 18.52); p.l(18.05, 18.52); p.l(18.05, 19.15); p.l(13.95, 19.15); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(14.8, 14.52); p.l(17.2, 14.52); p.l(17.2, 16.58); p.q(17.2, 17.72, 16, 18.17)
        p.q(14.8, 17.72, 14.8, 16.58); p.z()
        parts.append(part(p, fill: 0xC09300))
        p = Path()
        p.m(15.12, 14.84); p.l(16.88, 14.84); p.l(16.88, 16.58); p.q(16.88, 17.5, 16, 17.73)
        p.q(15.12, 17.5, 15.12, 16.58); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(15.12, 14.84); p.l(15.7, 14.84); p.l(15.7, 17.66); p.l(15.12, 17.03); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(16.3, 14.84); p.l(16.88, 14.84); p.l(16.88, 17.03); p.l(16.3, 17.66); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// South Africa.
    private static func panelZA() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(7.01, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 12.67); p.l(17.01, 12.67)
        p.z()
        parts.append(part(p, fill: 0xE03C31))
        p = Path()
        p.m(7.01, 26); p.l(28.5, 26); p.c(29.881, 26, 31, 24.881, 31, 23.5); p.l(31, 19.33)
        p.l(17.01, 19.33); p.z()
        parts.append(part(p, fill: 0x001489))
        p = Path()
        p.m(1, 8.5); p.c(1, 7.119, 2.119, 6, 3.5, 6); p.l(4.61, 6); p.l(16.61, 14); p.l(31, 14); p.l(31, 18)
        p.l(16.61, 18); p.l(4.61, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.z()
        parts.append(part(p, fill: 0x007749))
        p = Path()
        p.m(1, 8.4); p.l(12.39, 16); p.l(1, 23.6); p.z()
        parts.append(part(p, fill: 0xFFB81C))
        p = Path()
        p.m(1, 10.01); p.l(9.99, 16); p.l(1, 21.99); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Vietnam.
    private static func panelVN() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xDA251D))
        p = Path()
        p.m(16, 10); p.l(17.35, 14.15); p.l(21.71, 14.15); p.l(18.18, 16.71); p.l(19.53, 20.85)
        p.l(16, 18.29); p.l(12.47, 20.85); p.l(13.82, 16.71); p.l(10.29, 14.15); p.l(14.65, 14.15); p.z()
        parts.append(part(p, fill: 0xFFFF00))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Indonesia.
    private static func panelID() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 16)
        p.c(31, 17.381, 29.881, 18.5, 28.5, 18.5); p.l(3.5, 18.5); p.c(2.119, 18.5, 1, 17.381, 1, 16)
        p.l(1, 8.5); p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFF0000))
        p = Path()
        p.m(1, 16); p.l(31, 16); p.l(31, 19); p.l(1, 19); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Thailand.
    private static func panelTH() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xA51931))
        p = Path()
        p.m(1, 9.33); p.l(31, 9.33); p.l(31, 22.67); p.l(1, 22.67); p.z()
        parts.append(part(p, fill: 0xF4F5F8))
        p = Path()
        p.m(1, 12.67); p.l(31, 12.67); p.l(31, 19.33); p.l(1, 19.33); p.z()
        parts.append(part(p, fill: 0x2D2A4A))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// South Korea.
    private static func panelKR() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(11.84, 13.23); p.c(13.404, 11.024, 16.439, 10.461, 18.69, 11.96)
        p.c(20.941, 13.459, 21.592, 16.476, 20.16, 18.77); p.z()
        parts.append(part(p, fill: 0xCD2E3A))
        p = Path()
        p.m(20.16, 18.77); p.c(18.596, 20.976, 15.561, 21.539, 13.31, 20.04)
        p.c(11.059, 18.541, 10.408, 15.524, 11.84, 13.23); p.z()
        parts.append(part(p, fill: 0x0047A0))
        p = Path()
        p.m(11.42, 14.61); p.c(11.42, 15.991, 12.539, 17.11, 13.92, 17.11)
        p.c(15.301, 17.11, 16.42, 15.991, 16.42, 14.61); p.c(16.42, 13.229, 15.301, 12.11, 13.92, 12.11)
        p.c(12.539, 12.11, 11.42, 13.229, 11.42, 14.61); p.z()
        parts.append(part(p, fill: 0xCD2E3A))
        p = Path()
        p.m(15.58, 17.39); p.c(15.58, 18.771, 16.699, 19.89, 18.08, 19.89)
        p.c(19.461, 19.89, 20.58, 18.771, 20.58, 17.39); p.c(20.58, 16.009, 19.461, 14.89, 18.08, 14.89)
        p.c(16.699, 14.89, 15.58, 16.009, 15.58, 17.39); p.z()
        parts.append(part(p, fill: 0x0047A0))
        p = Path()
        p.m(8.56, 14.04); p.l(11.33, 9.88); p.l(10.54, 9.36); p.l(7.77, 13.52); p.z(); p.m(7.35, 13.24)
        p.l(10.13, 9.08); p.l(9.34, 8.55); p.l(6.56, 12.71); p.z(); p.m(6.15, 12.44); p.l(8.92, 8.28)
        p.l(8.13, 7.75); p.l(5.36, 11.91); p.z(); p.m(20.67, 9.88); p.l(21.85, 11.65); p.l(22.64, 11.13)
        p.l(21.46, 9.36); p.z(); p.m(22.26, 12.28); p.l(23.44, 14.04); p.l(24.23, 13.52); p.l(23.05, 11.75)
        p.z(); p.m(21.87, 9.08); p.l(24.65, 13.24); p.l(25.44, 12.71); p.l(22.66, 8.55); p.z()
        p.m(23.08, 8.28); p.l(24.26, 10.04); p.l(25.05, 9.52); p.l(23.87, 7.75); p.z(); p.m(24.67, 10.67)
        p.l(25.85, 12.44); p.l(26.64, 11.91); p.l(25.46, 10.14); p.z(); p.m(11.33, 22.12); p.l(8.56, 17.96)
        p.l(7.77, 18.48); p.l(10.54, 22.64); p.z(); p.m(10.13, 22.92); p.l(8.95, 21.15); p.l(8.16, 21.68)
        p.l(9.34, 23.45); p.z(); p.m(8.53, 20.53); p.l(7.35, 18.76); p.l(6.56, 19.29); p.l(7.74, 21.05)
        p.z(); p.m(8.92, 23.72); p.l(6.15, 19.56); p.l(5.36, 20.09); p.l(8.13, 24.25); p.z()
        p.m(23.44, 17.96); p.l(22.26, 19.72); p.l(23.05, 20.25); p.l(24.23, 18.48); p.z(); p.m(21.85, 20.35)
        p.l(20.67, 22.12); p.l(21.46, 22.64); p.l(22.64, 20.87); p.z(); p.m(24.65, 18.76); p.l(23.47, 20.53)
        p.l(24.26, 21.05); p.l(25.44, 19.29); p.z(); p.m(23.05, 21.15); p.l(21.87, 22.92); p.l(22.66, 23.45)
        p.l(23.84, 21.68); p.z(); p.m(25.85, 19.56); p.l(24.67, 21.33); p.l(25.46, 21.86); p.l(26.64, 20.09)
        p.z(); p.m(24.26, 21.96); p.l(23.08, 23.72); p.l(23.87, 24.25); p.l(25.05, 22.48); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// United Arab Emirates.
    private static func panelAE() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 13.5)
        p.c(31, 14.881, 29.881, 16, 28.5, 16); p.l(3.5, 16); p.c(2.119, 16, 1, 14.881, 1, 13.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x00843D))
        p = Path()
        p.m(1, 12.67); p.l(31, 12.67); p.l(31, 19.33); p.l(1, 19.33); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(6, 6); p.c(7.381, 6, 8.5, 7.119, 8.5, 8.5); p.l(8.5, 23.5)
        p.c(8.5, 24.881, 7.381, 26, 6, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(4, 6); p.l(8.5, 6); p.l(8.5, 26); p.l(4, 26); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Portugal.
    private static func panelPT() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xDA291C))
        p = Path()
        p.m(3.5, 6); p.l(10.5, 6); p.c(11.881, 6, 13, 7.119, 13, 8.5); p.l(13, 23.5)
        p.c(13, 24.881, 11.881, 26, 10.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x046A38))
        p = Path()
        p.m(10, 6); p.l(13, 6); p.l(13, 26); p.l(10, 26); p.z()
        parts.append(part(p, fill: 0x046A38))
        p = Path()
        p.m(8.6, 16); p.c(8.6, 17.572, 9.439, 19.025, 10.8, 19.811)
        p.c(12.161, 20.596, 13.839, 20.596, 15.2, 19.811); p.c(16.561, 19.025, 17.4, 17.572, 17.4, 16)
        p.c(17.4, 13.57, 15.43, 11.6, 13, 11.6); p.c(10.57, 11.6, 8.6, 13.57, 8.6, 16); p.z()
        parts.append(part(p, stroke: 0xFFE900, width: 0.87))
        p = Path()
        p.m(8.6, 16.37); p.c(8.6, 16.881, 9.439, 17.353, 10.8, 17.608)
        p.c(12.161, 17.864, 13.839, 17.864, 15.2, 17.608); p.c(16.561, 17.353, 17.4, 16.881, 17.4, 16.37)
        p.c(17.4, 15.58, 15.43, 14.94, 13, 14.94); p.c(10.57, 14.94, 8.6, 15.58, 8.6, 16.37); p.z()
        parts.append(part(p, stroke: 0xFFE900, width: 0.68))
        p = Path()
        p.m(10.77, 13.4); p.l(15.23, 13.4); p.l(15.23, 16.74); p.c(15.23, 17.972, 14.232, 18.97, 13, 18.97)
        p.c(11.768, 18.97, 10.77, 17.972, 10.77, 16.74); p.z()
        parts.append(part(p, fill: 0xDA291C))
        p = Path()
        p.m(11.51, 14.14); p.l(14.49, 14.14); p.l(14.49, 16.74)
        p.c(14.49, 17.563, 13.823, 18.23, 13, 18.23); p.c(12.177, 18.23, 11.51, 17.563, 11.51, 16.74); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(12.91, 14.48); p.l(13.09, 14.48); p.c(13.195, 14.48, 13.28, 14.565, 13.28, 14.67)
        p.l(13.28, 14.97); p.c(13.28, 15.075, 13.195, 15.16, 13.09, 15.16); p.l(12.91, 15.16)
        p.c(12.805, 15.16, 12.72, 15.075, 12.72, 14.97); p.l(12.72, 14.67)
        p.c(12.72, 14.565, 12.805, 14.48, 12.91, 14.48); p.z()
        parts.append(part(p, fill: 0x002D72))
        p = Path()
        p.m(12.01, 15.66); p.l(12.19, 15.66); p.c(12.295, 15.66, 12.38, 15.745, 12.38, 15.85)
        p.l(12.38, 16.15); p.c(12.38, 16.255, 12.295, 16.34, 12.19, 16.34); p.l(12.01, 16.34)
        p.c(11.905, 16.34, 11.82, 16.255, 11.82, 16.15); p.l(11.82, 15.85)
        p.c(11.82, 15.745, 11.905, 15.66, 12.01, 15.66); p.z()
        parts.append(part(p, fill: 0x002D72))
        p = Path()
        p.m(12.91, 15.66); p.l(13.09, 15.66); p.c(13.195, 15.66, 13.28, 15.745, 13.28, 15.85)
        p.l(13.28, 16.15); p.c(13.28, 16.255, 13.195, 16.34, 13.09, 16.34); p.l(12.91, 16.34)
        p.c(12.805, 16.34, 12.72, 16.255, 12.72, 16.15); p.l(12.72, 15.85)
        p.c(12.72, 15.745, 12.805, 15.66, 12.91, 15.66); p.z()
        parts.append(part(p, fill: 0x002D72))
        p = Path()
        p.m(13.81, 15.66); p.l(13.99, 15.66); p.c(14.095, 15.66, 14.18, 15.745, 14.18, 15.85)
        p.l(14.18, 16.15); p.c(14.18, 16.255, 14.095, 16.34, 13.99, 16.34); p.l(13.81, 16.34)
        p.c(13.705, 16.34, 13.62, 16.255, 13.62, 16.15); p.l(13.62, 15.85)
        p.c(13.62, 15.745, 13.705, 15.66, 13.81, 15.66); p.z()
        parts.append(part(p, fill: 0x002D72))
        p = Path()
        p.m(12.91, 16.84); p.l(13.09, 16.84); p.c(13.195, 16.84, 13.28, 16.925, 13.28, 17.03)
        p.l(13.28, 17.33); p.c(13.28, 17.435, 13.195, 17.52, 13.09, 17.52); p.l(12.91, 17.52)
        p.c(12.805, 17.52, 12.72, 17.435, 12.72, 17.33); p.l(12.72, 17.03)
        p.c(12.72, 16.925, 12.805, 16.84, 12.91, 16.84); p.z()
        parts.append(part(p, fill: 0x002D72))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Greece.
    private static func panelGR() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x0D5EAF))
        p = Path()
        p.m(12.11, 8.22); p.l(31, 8.22); p.l(31, 10.44); p.l(12.11, 10.44); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(12.11, 12.67); p.l(31, 12.67); p.l(31, 14.89); p.l(12.11, 14.89); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(1, 17.11); p.l(31, 17.11); p.l(31, 19.33); p.l(1, 19.33); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(1, 21.56); p.l(31, 21.56); p.l(31, 23.78); p.l(1, 23.78); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(5.44, 6); p.l(7.66, 6); p.l(7.66, 17.11); p.l(5.44, 17.11); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(1, 10.44); p.l(12.11, 10.44); p.l(12.11, 12.66); p.l(1, 12.66); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Netherlands.
    private static func panelNL() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xAE1C28))
        p = Path()
        p.m(3.5, 12.67); p.l(28.5, 12.67); p.c(29.881, 12.67, 31, 13.789, 31, 15.17); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5)
        p.l(1, 15.17); p.c(1, 13.789, 2.119, 12.67, 3.5, 12.67); p.z()
        parts.append(part(p, fill: 0x21468B))
        p = Path()
        p.m(1, 12.67); p.l(31, 12.67); p.l(31, 19.33); p.l(1, 19.33); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Jamaica.
    private static func panelJM() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFED100))
        p = Path()
        p.m(3.7, 6); p.l(28.3, 6); p.l(16, 14.2); p.z(); p.m(3.7, 26); p.l(28.3, 26); p.l(16, 17.8); p.z()
        parts.append(part(p, fill: 0x009B3A))
        p = Path()
        p.m(1, 7.8); p.l(1, 24.2); p.l(13.3, 16); p.z(); p.m(31, 7.8); p.l(31, 24.2); p.l(18.7, 16); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Cuba.
    private static func panelCU() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x002A8F))
        p = Path()
        p.m(1, 10); p.l(31, 10); p.l(31, 14); p.l(1, 14); p.z(); p.m(1, 18); p.l(31, 18); p.l(31, 22)
        p.l(1, 22); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(1, 8.5); p.c(0.998, 7.738, 1.344, 7.016, 1.94, 6.54); p.l(18.32, 16); p.l(1.94, 25.46)
        p.c(1.344, 24.984, 0.998, 24.262, 1, 23.5); p.z()
        parts.append(part(p, fill: 0xCF142B))
        p = Path()
        p.m(6.77, 12.9); p.l(7.46, 15.05); p.l(9.72, 15.04); p.l(7.89, 16.36); p.l(8.59, 18.51)
        p.l(6.77, 17.18); p.l(4.95, 18.51); p.l(5.65, 16.36); p.l(3.82, 15.04); p.l(6.08, 15.05); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Dominican Republic.
    private static func panelDO() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x002D62))
        p = Path()
        p.m(18, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 14); p.l(18, 14); p.z()
        p.m(1, 18); p.l(14, 18); p.l(14, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(14, 6); p.l(18, 6); p.l(18, 26); p.l(14, 26); p.z(); p.m(1, 14); p.l(31, 14); p.l(31, 18)
        p.l(1, 18); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(15.5, 17.67); p.c(14.506, 16.979, 14.121, 15.694, 14.57, 14.57)
        parts.append(part(p, stroke: 0x2E7D32, width: 0.46, cap: .round))
        p = Path()
        p.m(16.5, 17.67); p.c(17.494, 16.979, 17.879, 15.694, 17.43, 14.57)
        parts.append(part(p, stroke: 0x2E7D32, width: 0.46, cap: .round))
        p = Path()
        p.m(15.07, 14.82); p.l(16.93, 14.82); p.l(16.93, 16.06)
        p.c(16.93, 16.679, 16.514, 17.18, 16, 17.18); p.c(15.486, 17.18, 15.07, 16.679, 15.07, 16.06); p.z()
        parts.append(part(p, fill: 0x002D62))
        p = Path()
        p.m(16, 14.82); p.l(16.93, 14.82); p.l(16.93, 15.94); p.l(16, 15.94); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(15.07, 15.94); p.l(16, 15.94); p.l(16, 17.18); p.c(15.486, 17.18, 15.07, 16.679, 15.07, 16.06)
        p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(16, 14.82); p.l(16, 17.18)
        parts.append(part(p, stroke: 0xFFFFFF, width: 0.28))
        p = Path()
        p.m(15.07, 15.94); p.l(16.93, 15.94)
        parts.append(part(p, stroke: 0xFFFFFF, width: 0.28))
        p = Path()
        p.m(14.82, 14.33); p.l(17.18, 14.33)
        parts.append(part(p, stroke: 0x002D62, width: 0.37, cap: .round))
        p = Path()
        p.m(15.01, 17.86); p.l(16.99, 17.86)
        parts.append(part(p, stroke: 0xCE1126, width: 0.37, cap: .round))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Costa Rica.
    private static func panelCR() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x002B7F))
        p = Path()
        p.m(1, 9.33); p.l(31, 9.33); p.l(31, 22.67); p.l(1, 22.67); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(1, 12.67); p.l(31, 12.67); p.l(31, 19.33); p.l(1, 19.33); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(7.49, 16); p.c(7.49, 17.541, 8.435, 18.79, 9.6, 18.79)
        p.c(10.765, 18.79, 11.71, 17.541, 11.71, 16); p.c(11.71, 14.459, 10.765, 13.21, 9.6, 13.21)
        p.c(8.435, 13.21, 7.49, 14.459, 7.49, 16); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(8.51, 14.16); p.l(10.69, 14.16)
        parts.append(part(p, stroke: 0x002B7F, width: 0.48, cap: .round))
        p = Path()
        p.m(8.04, 17.09); p.l(8.72, 15.86); p.l(9.19, 16.54); p.l(9.6, 15.18); p.l(10.01, 16.54)
        p.l(10.48, 15.86); p.l(11.16, 17.09); p.z()
        parts.append(part(p, fill: 0x3A8A2E))
        p = Path()
        p.m(8.04, 17.09); p.l(11.16, 17.09); p.l(10.89, 17.77); p.l(8.31, 17.77); p.z()
        parts.append(part(p, fill: 0x1F5FAF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Panama.
    private static func panelPA() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(16, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 16); p.l(16, 16); p.z()
        parts.append(part(p, fill: 0xD21034))
        p = Path()
        p.m(1, 16); p.l(16, 16); p.l(16, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.z()
        parts.append(part(p, fill: 0x005293))
        p = Path()
        p.m(8.5, 8.3); p.l(9.11, 10.17); p.l(11.07, 10.17); p.l(9.48, 11.32); p.l(10.09, 13.18)
        p.l(8.5, 12.03); p.l(6.91, 13.18); p.l(7.52, 11.32); p.l(5.93, 10.17); p.l(7.89, 10.17); p.z()
        parts.append(part(p, fill: 0x005293))
        p = Path()
        p.m(23.5, 18.3); p.l(24.11, 20.17); p.l(26.07, 20.17); p.l(24.48, 21.32); p.l(25.09, 23.18)
        p.l(23.5, 22.03); p.l(21.91, 23.18); p.l(22.52, 21.32); p.l(20.93, 20.17); p.l(22.89, 20.17); p.z()
        parts.append(part(p, fill: 0xD21034))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Mexico.
    private static func panelMX() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(11, 6); p.l(3.5, 6); p.c(2.119, 6, 1, 7.119, 1, 8.5); p.l(1, 23.5)
        p.c(1, 24.881, 2.119, 26, 3.5, 26); p.l(11, 26); p.z()
        parts.append(part(p, fill: 0x006847))
        p = Path()
        p.m(21, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(21, 26); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(12.9, 17.27); p.c(12.9, 18.982, 14.288, 20.37, 16, 20.37)
        p.c(17.712, 20.37, 19.1, 18.982, 19.1, 17.27)
        parts.append(part(p, stroke: 0x2E6B2A, width: 0.86, cap: .round))
        p = Path()
        p.m(15.1, 19.14); p.c(15.1, 19.358, 15.285, 19.559, 15.585, 19.668)
        p.c(15.885, 19.777, 16.255, 19.777, 16.555, 19.668)
        p.c(16.855, 19.559, 17.04, 19.358, 17.04, 19.14); p.c(17.04, 18.922, 16.855, 18.721, 16.555, 18.612)
        p.c(16.255, 18.503, 15.885, 18.503, 15.585, 18.612); p.c(15.285, 18.721, 15.1, 18.922, 15.1, 19.14)
        p.z()
        parts.append(part(p, fill: 0x4C8C2B))
        p = Path()
        p.m(14.49, 18.42); p.c(14.49, 18.613, 14.627, 18.791, 14.85, 18.888)
        p.c(15.073, 18.984, 15.347, 18.984, 15.57, 18.888); p.c(15.793, 18.791, 15.93, 18.613, 15.93, 18.42)
        p.c(15.93, 18.227, 15.793, 18.049, 15.57, 17.952)
        p.c(15.347, 17.856, 15.073, 17.856, 14.85, 17.952); p.c(14.627, 18.049, 14.49, 18.227, 14.49, 18.42)
        p.z()
        parts.append(part(p, fill: 0x4C8C2B))
        p = Path()
        p.m(16.26, 18.35); p.c(16.26, 18.529, 16.39, 18.694, 16.6, 18.783)
        p.c(16.81, 18.872, 17.07, 18.872, 17.28, 18.783); p.c(17.49, 18.694, 17.62, 18.529, 17.62, 18.35)
        p.c(17.62, 18.171, 17.49, 18.006, 17.28, 17.917); p.c(17.07, 17.828, 16.81, 17.828, 16.6, 17.917)
        p.c(16.39, 18.006, 16.26, 18.171, 16.26, 18.35); p.z()
        parts.append(part(p, fill: 0x4C8C2B))
        p = Path()
        p.m(13.05, 13.96); p.l(13.34, 13.24); p.l(13.98, 12.73); p.l(14.78, 12.73); p.l(15.28, 13.16)
        p.l(15.5, 13.67); p.l(15.93, 12.37); p.l(16.65, 11.36); p.l(17.01, 10.72); p.l(17.37, 11.51)
        p.l(18.02, 11); p.l(18.16, 11.94); p.l(18.95, 11.65); p.l(18.81, 12.66); p.l(19.6, 12.66)
        p.l(19.24, 13.45); p.l(19.74, 13.81); p.l(18.38, 15.04); p.l(18.09, 15.97); p.l(19.02, 17.05)
        p.l(18.38, 17.48); p.l(17.58, 17.12); p.l(16.79, 17.05); p.l(16.86, 17.77); p.l(15.42, 17.77)
        p.l(15.78, 16.84); p.l(14.92, 16.12); p.l(14.42, 15.04); p.l(13.98, 14.32); p.l(13.55, 14.17)
        p.l(13.34, 14.53); p.z()
        parts.append(part(p, fill: 0x7B4A20))
        p = Path()
        p.m(13.41, 14.03); p.l(12.9, 14.68); p.l(13.34, 15.18); p.l(12.98, 15.83)
        parts.append(part(p, stroke: 0x2E6B2A, width: 0.4, cap: .round, join: .round))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Bolivia.
    private static func panelBO() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xF9E300))
        p = Path()
        p.m(1, 12.67); p.l(1, 8.5); p.c(1, 7.119, 2.119, 6, 3.5, 6); p.l(28.5, 6)
        p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 12.67); p.z()
        parts.append(part(p, fill: 0xD52B1E))
        p = Path()
        p.m(1, 19.33); p.l(31, 19.33); p.l(31, 23.5); p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26)
        p.c(2.119, 26, 1, 24.881, 1, 23.5); p.z()
        parts.append(part(p, fill: 0x007934))
        p = Path()
        p.m(14.74, 15.72); p.l(12.43, 14.81)
        parts.append(part(p, stroke: 0xD52B1E, width: 0.66))
        p = Path()
        p.m(14.74, 17.05); p.l(12.43, 16.14)
        parts.append(part(p, stroke: 0x007934, width: 0.66))
        p = Path()
        p.m(17.26, 15.72); p.l(19.57, 14.81)
        parts.append(part(p, stroke: 0xD52B1E, width: 0.66))
        p = Path()
        p.m(17.26, 17.05); p.l(19.57, 16.14)
        parts.append(part(p, stroke: 0x007934, width: 0.66))
        p = Path()
        p.m(14.04, 16.84); p.c(14.04, 18.154, 14.918, 19.22, 16, 19.22)
        p.c(17.082, 19.22, 17.96, 18.154, 17.96, 16.84); p.c(17.96, 15.526, 17.082, 14.46, 16, 14.46)
        p.c(14.918, 14.46, 14.04, 15.526, 14.04, 16.84); p.z()
        parts.append(part(p, fill: 0x8BCDEF, stroke: 0x1D4F9F, width: 0.56))
        p = Path()
        p.m(14.53, 18.8); p.l(16, 15.72); p.l(17.47, 18.8); p.z()
        parts.append(part(p, fill: 0xA86F32))
        p = Path()
        p.m(16.49, 15.65); p.c(16.49, 15.8, 16.57, 15.939, 16.7, 16.014)
        p.c(16.83, 16.089, 16.99, 16.089, 17.12, 16.014); p.c(17.25, 15.939, 17.33, 15.8, 17.33, 15.65)
        p.c(17.33, 15.5, 17.25, 15.361, 17.12, 15.286); p.c(16.99, 15.211, 16.83, 15.211, 16.7, 15.286)
        p.c(16.57, 15.361, 16.49, 15.5, 16.49, 15.65); p.z()
        parts.append(part(p, fill: 0xF9E300))
        p = Path()
        p.m(12.92, 13.83); p.l(14.04, 13.48); p.l(15.16, 13.76); p.l(15.65, 13.2); p.l(15.86, 12.71)
        p.l(16.14, 12.71); p.l(16.35, 13.2); p.l(16.84, 13.76); p.l(17.96, 13.48); p.l(19.08, 13.83)
        p.l(18.24, 14.25); p.l(16.98, 14.46); p.l(16.42, 15.02); p.l(15.58, 15.02); p.l(15.02, 14.46)
        p.l(13.76, 14.25); p.z()
        parts.append(part(p, fill: 0x262626))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Ecuador.
    private static func panelEC() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x034EA2))
        p = Path()
        p.m(1, 16); p.l(1, 8.5); p.c(1, 7.119, 2.119, 6, 3.5, 6); p.l(28.5, 6)
        p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 16); p.z()
        parts.append(part(p, fill: 0xFFDD00))
        p = Path()
        p.m(1, 21); p.l(31, 21); p.l(31, 23.5); p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26)
        p.c(2.119, 26, 1, 24.881, 1, 23.5); p.z()
        parts.append(part(p, fill: 0xED1C24))
        p = Path()
        p.m(13.84, 17.41); p.c(13.84, 18.923, 14.807, 20.15, 16, 20.15)
        p.c(17.193, 20.15, 18.16, 18.923, 18.16, 17.41); p.c(18.16, 15.897, 17.193, 14.67, 16, 14.67)
        p.c(14.807, 14.67, 13.84, 15.897, 13.84, 17.41); p.z()
        parts.append(part(p, fill: 0x8BCDEF, stroke: 0xC9971C, width: 0.58))
        p = Path()
        p.m(14.06, 19.36); p.l(15.93, 16.19); p.l(17.94, 19.36); p.z()
        parts.append(part(p, fill: 0x5F7F45))
        p = Path()
        p.m(15.42, 17.05); p.l(15.93, 16.19); p.l(16.43, 17.05); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(16.61, 15.97); p.c(16.61, 16.163, 16.713, 16.341, 16.88, 16.438)
        p.c(17.047, 16.534, 17.253, 16.534, 17.42, 16.438); p.c(17.587, 16.341, 17.69, 16.163, 17.69, 15.97)
        p.c(17.69, 15.777, 17.587, 15.599, 17.42, 15.502)
        p.c(17.253, 15.406, 17.047, 15.406, 16.88, 15.502); p.c(16.713, 15.599, 16.61, 15.777, 16.61, 15.97)
        p.z()
        parts.append(part(p, fill: 0xFFDD00))
        p = Path()
        p.m(11.82, 13.09); p.l(13.26, 12.66); p.l(14.78, 12.95); p.l(15.42, 12.3); p.l(15.71, 11.72)
        p.l(16.29, 11.72); p.l(16.58, 12.3); p.l(17.22, 12.95); p.l(18.74, 12.66); p.l(20.18, 13.09)
        p.l(19.46, 13.45); p.l(19.74, 13.74); p.l(18.59, 13.88); p.l(18.74, 14.24); p.l(17.08, 14.24)
        p.l(16.5, 15.11); p.l(15.5, 15.11); p.l(14.92, 14.24); p.l(13.26, 14.24); p.l(13.41, 13.88)
        p.l(12.26, 13.74); p.l(12.54, 13.45); p.z()
        parts.append(part(p, fill: 0x262626))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Uruguay.
    private static func panelUY() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(12.11, 8.22); p.l(31, 8.22); p.l(31, 10.44); p.l(12.11, 10.44); p.z(); p.m(12.11, 12.67)
        p.l(31, 12.67); p.l(31, 14.89); p.l(12.11, 14.89); p.z(); p.m(1, 17.11); p.l(31, 17.11)
        p.l(31, 19.33); p.l(1, 19.33); p.z(); p.m(1, 21.56); p.l(31, 21.56); p.l(31, 23.78); p.l(1, 23.78)
        p.z()
        parts.append(part(p, fill: 0x0038A8))
        p = Path()
        p.m(6.56, 7.46); p.l(7, 9.35); p.l(8.13, 7.77); p.l(7.81, 9.69); p.l(9.46, 8.66); p.l(8.43, 10.31)
        p.l(10.35, 9.99); p.l(8.77, 11.12); p.l(10.66, 11.56); p.l(8.77, 12); p.l(10.35, 13.13)
        p.l(8.43, 12.81); p.l(9.46, 14.46); p.l(7.81, 13.43); p.l(8.13, 15.35); p.l(7, 13.77)
        p.l(6.56, 15.66); p.l(6.12, 13.77); p.l(4.99, 15.35); p.l(5.31, 13.43); p.l(3.66, 14.46)
        p.l(4.69, 12.81); p.l(2.77, 13.13); p.l(4.35, 12); p.l(2.46, 11.56); p.l(4.35, 11.12)
        p.l(2.77, 9.99); p.l(4.69, 10.31); p.l(3.66, 8.66); p.l(5.31, 9.69); p.l(4.99, 7.77)
        p.l(6.12, 9.35); p.z()
        parts.append(part(p, fill: 0xFCD116, stroke: 0x7B3F00, width: 0.25, join: .round))
        p = Path()
        p.m(4.76, 11.56); p.c(4.76, 12.203, 5.103, 12.797, 5.66, 13.119)
        p.c(6.217, 13.44, 6.903, 13.44, 7.46, 13.119); p.c(8.017, 12.797, 8.36, 12.203, 8.36, 11.56)
        p.c(8.36, 10.917, 8.017, 10.323, 7.46, 10.001); p.c(6.903, 9.68, 6.217, 9.68, 5.66, 10.001)
        p.c(5.103, 10.323, 4.76, 10.917, 4.76, 11.56); p.z()
        parts.append(part(p, fill: 0xFCD116, stroke: 0x7B3F00, width: 0.3))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Peru.
    private static func panelPE() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(11, 6); p.l(3.5, 6); p.c(2.119, 6, 1, 7.119, 1, 8.5); p.l(1, 23.5)
        p.c(1, 24.881, 2.119, 26, 3.5, 26); p.l(11, 26); p.z(); p.m(21, 6); p.l(28.5, 6)
        p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5); p.c(31, 24.881, 29.881, 26, 28.5, 26)
        p.l(21, 26); p.z()
        parts.append(part(p, fill: 0xD91023))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Colombia.
    private static func panelCO() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x003893))
        p = Path()
        p.m(1, 16); p.l(1, 8.5); p.c(1, 7.119, 2.119, 6, 3.5, 6); p.l(28.5, 6)
        p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 16); p.z()
        parts.append(part(p, fill: 0xFCD116))
        p = Path()
        p.m(1, 21); p.l(31, 21); p.l(31, 23.5); p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26)
        p.c(2.119, 26, 1, 24.881, 1, 23.5); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Chile.
    private static func panelCL() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xD52B1E))
        p = Path()
        p.m(1, 16); p.l(1, 8.5); p.c(1, 7.119, 2.119, 6, 3.5, 6); p.l(28.5, 6)
        p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 16); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(1, 8.5); p.c(1, 7.119, 2.119, 6, 3.5, 6); p.l(11, 6); p.l(11, 16); p.l(1, 16); p.z()
        parts.append(part(p, fill: 0x0039A6))
        p = Path()
        p.m(6, 8.7); p.l(6.56, 10.42); p.l(8.38, 10.43); p.l(6.91, 11.5); p.l(7.47, 13.22); p.l(6, 12.16)
        p.l(4.53, 13.22); p.l(5.09, 11.5); p.l(3.62, 10.43); p.l(5.44, 10.42); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Argentina.
    private static func panelAR() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x74ACDF))
        p = Path()
        p.m(1, 12.67); p.l(31, 12.67); p.l(31, 19.33); p.l(1, 19.33); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(16, 12.8); p.l(16.37, 14.12); p.l(17.22, 13.04); p.l(17.07, 14.4); p.l(18.26, 13.74)
        p.l(17.6, 14.93); p.l(18.96, 14.78); p.l(17.88, 15.63); p.l(19.2, 16); p.l(17.88, 16.37)
        p.l(18.96, 17.22); p.l(17.6, 17.07); p.l(18.26, 18.26); p.l(17.07, 17.6); p.l(17.22, 18.96)
        p.l(16.37, 17.88); p.l(16, 19.2); p.l(15.63, 17.88); p.l(14.78, 18.96); p.l(14.93, 17.6)
        p.l(13.74, 18.26); p.l(14.4, 17.07); p.l(13.04, 17.22); p.l(14.12, 16.37); p.l(12.8, 16)
        p.l(14.12, 15.63); p.l(13.04, 14.78); p.l(14.4, 14.93); p.l(13.74, 13.74); p.l(14.93, 14.4)
        p.l(14.78, 13.04); p.l(15.63, 14.12); p.z()
        parts.append(part(p, fill: 0xF6B40E, stroke: 0x85340A, width: 0.2, join: .round))
        p = Path()
        p.m(14.6, 16); p.c(14.6, 16.5, 14.867, 16.962, 15.3, 17.212)
        p.c(15.733, 17.463, 16.267, 17.463, 16.7, 17.212); p.c(17.133, 16.962, 17.4, 16.5, 17.4, 16)
        p.c(17.4, 15.227, 16.773, 14.6, 16, 14.6); p.c(15.227, 14.6, 14.6, 15.227, 14.6, 16); p.z()
        parts.append(part(p, fill: 0xF6B40E, stroke: 0x85340A, width: 0.25))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Samoa.
    private static func panelWS() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(1, 8.5); p.c(1, 7.119, 2.119, 6, 3.5, 6); p.l(16, 6); p.l(16, 16); p.l(1, 16); p.z()
        parts.append(part(p, fill: 0x002B7F))
        p = Path()
        p.m(8.1, 7.45); p.l(8.36, 8.24); p.l(9.19, 8.24); p.l(8.52, 8.74); p.l(8.78, 9.53); p.l(8.1, 9.04)
        p.l(7.42, 9.53); p.l(7.68, 8.74); p.l(7.01, 8.24); p.l(7.84, 8.24); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(5.6, 9.85); p.l(5.86, 10.64); p.l(6.69, 10.64); p.l(6.02, 11.14); p.l(6.28, 11.93)
        p.l(5.6, 11.44); p.l(4.92, 11.93); p.l(5.18, 11.14); p.l(4.51, 10.64); p.l(5.34, 10.64); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(10.8, 8.85); p.l(11.06, 9.64); p.l(11.89, 9.64); p.l(11.22, 10.14); p.l(11.48, 10.93)
        p.l(10.8, 10.44); p.l(10.12, 10.93); p.l(10.38, 10.14); p.l(9.71, 9.64); p.l(10.54, 9.64); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(9.5, 11.48); p.l(9.66, 11.97); p.l(10.18, 11.98); p.l(9.77, 12.29); p.l(9.92, 12.78)
        p.l(9.5, 12.48); p.l(9.08, 12.78); p.l(9.23, 12.29); p.l(8.82, 11.98); p.l(9.34, 11.97); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(8.1, 13.25); p.l(8.36, 14.04); p.l(9.19, 14.04); p.l(8.52, 14.54); p.l(8.78, 15.33)
        p.l(8.1, 14.84); p.l(7.42, 15.33); p.l(7.68, 14.54); p.l(7.01, 14.04); p.l(7.84, 14.04); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Tonga.
    private static func panelTO() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xC10000))
        p = Path()
        p.m(1, 8.5); p.c(1, 7.119, 2.119, 6, 3.5, 6); p.l(15, 6); p.l(15, 16); p.l(1, 16); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(6.85, 7.5); p.l(9.15, 7.5); p.l(9.15, 14.5); p.l(6.85, 14.5); p.z()
        parts.append(part(p, fill: 0xC10000))
        p = Path()
        p.m(4.5, 9.85); p.l(11.5, 9.85); p.l(11.5, 12.15); p.l(4.5, 12.15); p.z()
        parts.append(part(p, fill: 0xC10000))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Solomon Islands.
    private static func panelSB() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x215B33))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.l(28.99, 6.05); p.l(29.46, 6.19); p.l(29.89, 6.42); p.l(30.1, 6.6)
        p.l(1.9, 25.4); p.l(1.73, 25.27); p.l(1.42, 24.89); p.l(1.19, 24.46); p.l(1.05, 23.99); p.l(1, 23.5)
        p.l(1, 8.5); p.l(1.05, 8.01); p.l(1.19, 7.54); p.l(1.42, 7.11); p.l(1.73, 6.73); p.l(2.11, 6.42)
        p.l(2.54, 6.19); p.l(3.01, 6.05); p.z()
        parts.append(part(p, fill: 0x0051BA))
        p = Path()
        p.m(2.73, 25.87); p.l(30.65, 7.25); p.l(30.58, 7.11); p.l(30.27, 6.73); p.l(29.89, 6.42)
        p.l(29.46, 6.19); p.l(29.27, 6.13); p.l(1.35, 24.75); p.l(1.42, 24.89); p.l(1.73, 25.27)
        p.l(2.11, 25.58); p.l(2.54, 25.81); p.z()
        parts.append(part(p, fill: 0xFCD116))
        p = Path()
        p.m(3.4, 7.8); p.l(3.69, 8.7); p.l(4.64, 8.7); p.l(3.88, 9.25); p.l(4.16, 10.15); p.l(3.4, 9.6)
        p.l(2.64, 10.15); p.l(2.92, 9.25); p.l(2.16, 8.7); p.l(3.11, 8.7); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(9.8, 7.8); p.l(10.09, 8.7); p.l(11.04, 8.7); p.l(10.28, 9.25); p.l(10.56, 10.15); p.l(9.8, 9.6)
        p.l(9.04, 10.15); p.l(9.32, 9.25); p.l(8.56, 8.7); p.l(9.51, 8.7); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(6.6, 11.1); p.l(6.89, 12); p.l(7.84, 12); p.l(7.08, 12.55); p.l(7.36, 13.45); p.l(6.6, 12.9)
        p.l(5.84, 13.45); p.l(6.12, 12.55); p.l(5.36, 12); p.l(6.31, 12); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.4, 14.4); p.l(3.69, 15.3); p.l(4.64, 15.3); p.l(3.88, 15.85); p.l(4.16, 16.75); p.l(3.4, 16.2)
        p.l(2.64, 16.75); p.l(2.92, 15.85); p.l(2.16, 15.3); p.l(3.11, 15.3); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(9.8, 14.4); p.l(10.09, 15.3); p.l(11.04, 15.3); p.l(10.28, 15.85); p.l(10.56, 16.75)
        p.l(9.8, 16.2); p.l(9.04, 16.75); p.l(9.32, 15.85); p.l(8.56, 15.3); p.l(9.51, 15.3); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Vanuatu.
    private static func panelVU() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x009543))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 16)
        p.c(31, 17.381, 29.881, 18.5, 28.5, 18.5); p.l(3.5, 18.5); p.c(2.119, 18.5, 1, 17.381, 1, 16)
        p.l(1, 8.5); p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xD21034))
        p = Path()
        p.m(1, 16); p.l(31, 16); p.l(31, 19); p.l(1, 19); p.z()
        parts.append(part(p, fill: 0x009543))
        p = Path()
        p.m(3.6, 6); p.l(13.79, 14.35); p.l(31, 14.35); p.l(31, 17.65); p.l(13.79, 17.65); p.l(3.6, 26)
        p.l(3.5, 26); p.l(3.01, 25.95); p.l(2.54, 25.81); p.l(2.11, 25.58); p.l(1.73, 25.27)
        p.l(1.42, 24.89); p.l(1.19, 24.46); p.l(1.05, 23.99); p.l(1, 23.5); p.l(1, 8.5); p.l(1.05, 8.01)
        p.l(1.19, 7.54); p.l(1.42, 7.11); p.l(1.73, 6.73); p.l(2.11, 6.42); p.l(2.54, 6.19); p.l(3.01, 6.05)
        p.l(3.5, 6); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(2.32, 6.31); p.l(13.41, 15.4); p.l(31, 15.4); p.l(31, 16.6); p.l(13.41, 16.6); p.l(2.32, 25.69)
        p.l(2.11, 25.58); p.l(1.73, 25.27); p.l(1.42, 24.89); p.l(1.19, 24.46); p.l(1.05, 23.99)
        p.l(1, 23.5); p.l(1, 8.5); p.l(1.05, 8.01); p.l(1.19, 7.54); p.l(1.42, 7.11); p.l(1.73, 6.73)
        p.l(2.11, 6.42); p.z()
        parts.append(part(p, fill: 0xFDCE12))
        p = Path()
        p.m(1.42, 7.12); p.l(12.25, 16); p.l(1.42, 24.88); p.l(1.19, 24.46); p.l(1.05, 23.99); p.l(1, 23.5)
        p.l(1, 8.5); p.l(1.05, 8.01); p.l(1.19, 7.54); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(4.67, 17.98); p.c(3.806, 17.747, 3.193, 16.981, 3.155, 16.087)
        p.c(3.117, 15.193, 3.664, 14.378, 4.505, 14.073); p.c(5.347, 13.768, 6.289, 14.045, 6.832, 14.756)
        p.c(7.375, 15.467, 7.395, 16.448, 6.88, 17.18); p.q(5.92, 17.96, 5.61, 16.86)
        parts.append(part(p, stroke: 0xFDCE12, width: 0.8, cap: .round))
        p = Path()
        p.m(4.18, 14.97); p.l(6.02, 16.82); p.m(6.22, 14.97); p.l(4.38, 16.82)
        parts.append(part(p, stroke: 0xFDCE12, width: 0.5, cap: .round))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Papua New Guinea.
    private static func panelPG() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x000000))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.l(28.99, 6.05); p.l(29.46, 6.19); p.l(29.89, 6.42); p.l(30.27, 6.73)
        p.l(30.58, 7.11); p.l(30.81, 7.54); p.l(30.95, 8.01); p.l(31, 8.5); p.l(31, 23.5); p.l(30.95, 23.99)
        p.l(30.81, 24.46); p.l(30.58, 24.89); p.l(30.27, 25.27); p.l(30.1, 25.4); p.l(1.9, 6.6)
        p.l(2.11, 6.42); p.l(2.54, 6.19); p.l(3.01, 6.05); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(7, 12.1); p.l(7.29, 13); p.l(8.24, 13); p.l(7.48, 13.55); p.l(7.76, 14.45); p.l(7, 13.9)
        p.l(6.24, 14.45); p.l(6.52, 13.55); p.l(5.76, 13); p.l(6.71, 13); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.9, 16.3); p.l(4.19, 17.2); p.l(5.14, 17.2); p.l(4.38, 17.75); p.l(4.66, 18.65); p.l(3.9, 18.1)
        p.l(3.14, 18.65); p.l(3.42, 17.75); p.l(2.66, 17.2); p.l(3.61, 17.2); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(10.4, 16.3); p.l(10.69, 17.2); p.l(11.64, 17.2); p.l(10.88, 17.75); p.l(11.16, 18.65)
        p.l(10.4, 18.1); p.l(9.64, 18.65); p.l(9.92, 17.75); p.l(9.16, 17.2); p.l(10.11, 17.2); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(8.7, 19.75); p.l(8.87, 20.27); p.l(9.41, 20.27); p.l(8.98, 20.59); p.l(9.14, 21.11)
        p.l(8.7, 20.79); p.l(8.26, 21.11); p.l(8.42, 20.59); p.l(7.99, 20.27); p.l(8.53, 20.27); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(7, 21.7); p.l(7.29, 22.6); p.l(8.24, 22.6); p.l(7.48, 23.15); p.l(7.76, 24.05); p.l(7, 23.5)
        p.l(6.24, 24.05); p.l(6.52, 23.15); p.l(5.76, 22.6); p.l(6.71, 22.6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(19.74, 9.93); p.l(20.37, 9.43); p.q(20.91, 9.03, 21.45, 9.47); p.q(21.9, 9.93, 22.26, 10.02)
        p.q(22.35, 8.08, 23.7, 6.64); p.l(23.84, 7.67); p.l(24.55, 7.22); p.l(24.46, 8.35); p.l(25.28, 8.13)
        p.l(24.91, 9.25); p.l(25.68, 9.34); p.l(24.83, 10.51); p.q(24.42, 11.32, 23.97, 11.95)
        p.q(23.43, 12.85, 22.62, 12.85); p.l(22.17, 14.38); p.l(21.5, 13.44); p.l(20.69, 14.61)
        p.l(20.46, 13.44); p.l(19.25, 14.15); p.l(19.7, 13.07); p.l(18.39, 13.03); p.l(19.92, 12.22)
        p.q(21.18, 11.59, 21.5, 10.78); p.q(21, 10.24, 20.46, 10.24); p.z()
        parts.append(part(p, fill: 0xFCD116))
        p = Path()
        p.m(23.88, 12.04); p.q(27.57, 13.84, 27.03, 16.63); p.q(26.67, 17.89, 25.68, 17.35)
        p.m(23.43, 12.58); p.q(26.13, 14.38, 25.82, 16.09); p.q(25.55, 16.99, 24.96, 16.54)
        parts.append(part(p, stroke: 0xFCD116, width: 0.42, cap: .round))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// Fiji.
    private static func panelFJ() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x68BFE5))
        p = Path()
        p.m(1, 8.5); p.c(1, 7.119, 2.119, 6, 3.5, 6); p.l(14, 6); p.l(14, 15.6); p.l(1, 15.6); p.z()
        parts.append(part(p, fill: 0x012169))
        p = Path()
        p.m(1.2, 7.52); p.l(12.15, 15.6); p.l(14, 15.6); p.l(14, 14.23); p.l(2.94, 6.07); p.l(2.54, 6.19)
        p.l(2.11, 6.42); p.l(1.73, 6.73); p.l(1.42, 7.11); p.z(); p.m(12.15, 6); p.l(1, 14.23); p.l(1, 15.6)
        p.l(2.85, 15.6); p.l(14, 7.37); p.l(14, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(2.23, 6.35); p.l(14, 15.04); p.l(14, 15.6); p.l(13.24, 15.6); p.l(1.54, 6.95); p.z()
        p.m(13.24, 6); p.l(14, 6); p.l(14, 6.56); p.l(1.76, 15.6); p.l(1, 15.6); p.l(1, 15.04); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(6, 6); p.l(9, 6); p.l(9, 15.6); p.l(6, 15.6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(1, 9.3); p.l(14, 9.3); p.l(14, 12.3); p.l(1, 12.3); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(6.7, 6); p.l(8.3, 6); p.l(8.3, 15.6); p.l(6.7, 15.6); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(1, 10); p.l(14, 10); p.l(14, 11.6); p.l(1, 11.6); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(19.9, 10.6); p.l(27.1, 10.6); p.l(27.1, 16.43); p.q(27.1, 20.28, 23.5, 21.6)
        p.q(19.9, 20.28, 19.9, 16.43); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(19.9, 10.6); p.l(27.1, 10.6); p.l(27.1, 13.3); p.l(19.9, 13.3); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(21.77, 11.95); p.c(21.77, 12.2, 22.1, 12.431, 22.635, 12.556)
        p.c(23.17, 12.681, 23.83, 12.681, 24.365, 12.556); p.c(24.9, 12.431, 25.23, 12.2, 25.23, 11.95)
        p.c(25.23, 11.7, 24.9, 11.469, 24.365, 11.344); p.c(23.83, 11.219, 23.17, 11.219, 22.635, 11.344)
        p.c(22.1, 11.469, 21.77, 11.7, 21.77, 11.95); p.z()
        parts.append(part(p, fill: 0xFCD116))
        p = Path()
        p.m(22.95, 13.3); p.l(24.05, 13.3); p.l(24.05, 20.7); p.l(22.95, 20.7); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(19.9, 16.07); p.l(27.1, 16.07); p.l(27.1, 17.17); p.l(19.9, 17.17); p.z()
        parts.append(part(p, fill: 0xCE1126))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }

    /// New Zealand.
    private static func panelNZ() -> [Part] {
        var parts: [Part] = []
        var p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, fill: 0x012169))
        p = Path()
        p.m(1.2, 7.52); p.l(12.15, 15.6); p.l(14, 15.6); p.l(14, 14.23); p.l(2.94, 6.07); p.l(2.54, 6.19)
        p.l(2.11, 6.42); p.l(1.73, 6.73); p.l(1.42, 7.11); p.z(); p.m(12.15, 6); p.l(1, 14.23); p.l(1, 15.6)
        p.l(2.85, 15.6); p.l(14, 7.37); p.l(14, 6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(2.23, 6.35); p.l(14, 15.04); p.l(14, 15.6); p.l(13.24, 15.6); p.l(1.54, 6.95); p.z()
        p.m(13.24, 6); p.l(14, 6); p.l(14, 6.56); p.l(1.76, 15.6); p.l(1, 15.6); p.l(1, 15.04); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(6, 6); p.l(9, 6); p.l(9, 15.6); p.l(6, 15.6); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(1, 9.3); p.l(14, 9.3); p.l(14, 12.3); p.l(1, 12.3); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(6.7, 6); p.l(8.3, 6); p.l(8.3, 15.6); p.l(6.7, 15.6); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(1, 10); p.l(14, 10); p.l(14, 11.6); p.l(1, 11.6); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(23.5, 7.2); p.l(23.99, 8.72); p.l(25.59, 8.72); p.l(24.3, 9.66); p.l(24.79, 11.18)
        p.l(23.5, 10.24); p.l(22.21, 11.18); p.l(22.7, 9.66); p.l(21.41, 8.72); p.l(23.01, 8.72); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(19.9, 13.2); p.l(20.39, 14.72); p.l(21.99, 14.72); p.l(20.7, 15.66); p.l(21.19, 17.18)
        p.l(19.9, 16.24); p.l(18.61, 17.18); p.l(19.1, 15.66); p.l(17.81, 14.72); p.l(19.41, 14.72); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(27, 11.6); p.l(27.45, 12.99); p.l(28.9, 12.98); p.l(27.72, 13.83); p.l(28.18, 15.22)
        p.l(27, 14.36); p.l(25.82, 15.22); p.l(26.28, 13.83); p.l(25.1, 12.98); p.l(26.55, 12.99); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(23.5, 19.45); p.l(24.03, 21.07); p.l(25.73, 21.07); p.l(24.36, 22.08); p.l(24.88, 23.7)
        p.l(23.5, 22.7); p.l(22.12, 23.7); p.l(22.64, 22.08); p.l(21.27, 21.07); p.l(22.97, 21.07); p.z()
        parts.append(part(p, fill: 0xFFFFFF))
        p = Path()
        p.m(23.5, 7.85); p.l(23.85, 8.92); p.l(24.97, 8.92); p.l(24.06, 9.58); p.l(24.41, 10.65)
        p.l(23.5, 9.99); p.l(22.59, 10.65); p.l(22.94, 9.58); p.l(22.03, 8.92); p.l(23.15, 8.92); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(19.9, 13.85); p.l(20.25, 14.92); p.l(21.37, 14.92); p.l(20.46, 15.58); p.l(20.81, 16.65)
        p.l(19.9, 15.99); p.l(18.99, 16.65); p.l(19.34, 15.58); p.l(18.43, 14.92); p.l(19.55, 14.92); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(27, 12.25); p.l(27.31, 13.18); p.l(28.28, 13.18); p.l(27.49, 13.76); p.l(27.79, 14.69)
        p.l(27, 14.12); p.l(26.21, 14.69); p.l(26.51, 13.76); p.l(25.72, 13.18); p.l(26.69, 13.18); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(23.5, 20.1); p.l(23.88, 21.27); p.l(25.12, 21.27); p.l(24.12, 22); p.l(24.5, 23.18)
        p.l(23.5, 22.45); p.l(22.5, 23.18); p.l(22.88, 22); p.l(21.88, 21.27); p.l(23.12, 21.27); p.z()
        parts.append(part(p, fill: 0xC8102E))
        p = Path()
        p.m(3.5, 6); p.l(28.5, 6); p.c(29.881, 6, 31, 7.119, 31, 8.5); p.l(31, 23.5)
        p.c(31, 24.881, 29.881, 26, 28.5, 26); p.l(3.5, 26); p.c(2.119, 26, 1, 24.881, 1, 23.5); p.l(1, 8.5)
        p.c(1, 7.119, 2.119, 6, 3.5, 6); p.z()
        parts.append(part(p, stroke: 0x000000, alpha: 0.22))
        return parts
    }
}

// Short names for the four moves path data resolves into, so a flag reads
// as its outline rather than as a wall of CGPoint(x:y:).
private extension Path {
    mutating func m(_ x: CGFloat, _ y: CGFloat) { move(to: CGPoint(x: x, y: y)) }
    mutating func l(_ x: CGFloat, _ y: CGFloat) { addLine(to: CGPoint(x: x, y: y)) }
    mutating func c(_ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat, _ x: CGFloat, _ y: CGFloat) {
        addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: x1, y: y1), control2: CGPoint(x: x2, y: y2))
    }
    mutating func q(_ x1: CGFloat, _ y1: CGFloat, _ x: CGFloat, _ y: CGFloat) {
        addQuadCurve(to: CGPoint(x: x, y: y), control: CGPoint(x: x1, y: y1))
    }
    mutating func z() { closeSubpath() }
}
