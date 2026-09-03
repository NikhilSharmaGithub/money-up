// The rules, on the Settings tab.
//
// Word for word the web client's help modal (openHelpModal in public/js/ui.js)
// down to the glyph on each row — a player who learns the game in a browser
// and finishes it on a phone should never be told two different things. Only
// the last line differs, because a phone has no keyboard to give shortcuts to.

import SwiftUI

struct HowToPlayCard: View {
    @Environment(\.colorScheme) private var scheme

    private struct Rule: Identifiable {
        let glyph: Glyph
        let title: String
        let body: String
        var id: String { title }
    }

    /// Mirrors RULES_HELP on the web, in the same order.
    private static let rules: [Rule] = [
        Rule(glyph: .dice, title: "Rolling",
             body: "Roll two dice and move. A double lets you roll again — but three doubles in a row sends you straight to prison."),
        Rule(glyph: .key, title: "Buying",
             body: "Land on an unowned street, airport or utility and you may buy it. Turn it down and it goes to auction, where everyone can bid."),
        Rule(glyph: .crane, title: "Building",
             body: "Own every street of one country and you can build houses, then a hotel. Rent climbs steeply with each one."),
        Rule(glyph: .payment, title: "Rent",
             body: "Land on someone else’s property and you pay their rent. Airports scale 25 / 50 / 100 / 200; utilities charge 4× or 10× your roll."),
        Rule(glyph: .bank, title: "Mortgage",
             body: "Short of cash? Mortgage a property for half its price. Mortgaged streets collect no rent until you buy them back at 10% interest."),
        Rule(glyph: .trade, title: "Trading",
             body: "Offer any mix of cash, properties and prison cards to any player, at any time. Streets with buildings can’t be traded."),
        Rule(glyph: .police, title: "Prison",
             body: "Roll a double to walk out, pay the $50 fine, or use a card. After three failed attempts you pay anyway."),
        Rule(glyph: .skull, title: "Bankruptcy",
             body: "Owe more than you can raise and you must sell, mortgage or trade. Give up and everything goes to your creditor. Last player standing wins."),
    ]

    var body: some View {
        let P = Palette.current(scheme)
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    PanelTitle("How to play")
                    Text("The classic property-trading rules, in one screen.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                }

                VStack(alignment: .leading, spacing: 11) {
                    ForEach(Self.rules) { rule in
                        row(rule, P)
                    }
                }

                Text("Tap any tile for its full deed — price, rent ladder and who owns it.")
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
    }

    private func row(_ rule: Rule, _ P: Palette) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Art.icon(rule.glyph, size: 20, tint: P.ink2)
                .frame(width: 22, height: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(rule.title)
                    .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink)
                Text(rule.body)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
