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

    /// Mirrors RULES_HELP on the web, in the same order. The prison row is the
    /// paragraph docs/API-1.0.6.md gives every client (round 2: the third miss
    /// walks out free), and the bankruptcy row says what the server has always
    /// done — the creditor keeps the cash raised, never the streets.
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
             body: "Offer any mix of cash, properties and prison cards to any player, at any time. Streets with buildings can’t be traded. Every open offer is shown to the whole table; only the player it is sent to can answer it."),
        Rule(glyph: .police, title: "Prison",
             body: "Land on Go to Prison, draw the card, or roll three doubles in a row, and you are locked up. On each turn inside you can roll for a double, which walks you out and moves you by that roll. You can also pay the $50 fine before rolling, which opens the door but ends that turn, or use a get-out card. If your third roll still is not a double, you walk out for free and move by that roll anyway."),
        Rule(glyph: .skull, title: "Bankruptcy",
             body: "Owe more than you can raise and you must sell, mortgage or trade. Give up and you are out: what you raised stays with whoever you owed, and your properties go back to the bank — or to auction, if the table says so. At a table where the bankrupt player decides, you pick which. Last player standing wins."),
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
