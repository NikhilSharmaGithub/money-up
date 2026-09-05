// The cup, in full: the chart you can find yourself in, and the poster that
// says what a cup is before you enter one.
//
// Both are sheets rather than parts of the card, because both are things you
// go and look at rather than things that should sit on the home screen. The
// chart is asked for on demand — a two-hundred-entrant bracket is two hundred
// matches, and re-sending that on the card's four-second poll to draw a
// countdown would be silly.

import SwiftUI

// MARK: - what /api/cup/bracket answers with

struct CupBracketFeed: Decodable {
    var enabled: Bool?
    var bracket: Bracket?

    struct Bracket: Decodable {
        var id: String
        var name: String
        var state: String
        var prize: CupFeed.Prize
        var local: CupFeed.Local?
        var entrants: Int
        var you: You?
        var standings: CupFeed.Standings?
        var rounds: [Round]

        struct You: Decodable {
            var code: String?
            var name: String?
            var out: Bool?
            var placed: String?
        }

        struct Round: Decodable, Identifiable {
            var n: Int
            var kind: String?
            var label: String
            var players: Int
            var matches: [Match]
            var id: Int { n }
        }

        struct Match: Decodable, Identifiable {
            var a: String?
            var b: String?
            var aScore: Int?
            var bScore: Int?
            var state: String?
            var winner: String?
            var walkover: Bool?
            var void: Bool?
            /// The one match on this row that belongs to whoever is reading.
            var mine: Bool?
            var id: String { "\(a ?? "-")|\(b ?? "-")|\(state ?? "")" }
        }
    }
}

// MARK: - the chart

struct CupChartSheet: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var bracket: CupBracketFeed.Bracket?
    @State private var failed = false

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                if let b = bracket {
                    VStack(alignment: .leading, spacing: 16) {
                        if b.standings?.first != nil { podium(b, P) }
                        if !run(b).isEmpty {
                            section("Your run", P)
                            ladder(b, P)
                        }
                        section("The chart", P)
                        tree(b, P)
                    }
                    .padding(16)
                } else if failed {
                    Text("Could not load the chart.")
                        .font(.system(size: 13, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .padding(40)
                } else {
                    ProgressView().tint(P.gold).padding(60)
                }
            }
            .background(P.page.ignoresSafeArea())
            .navigationTitle(bracket?.name ?? "The chart")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task { await load() }
    }

    // MARK: - pieces

    private func section(_ title: String, _ P: Palette) -> some View {
        Text(title.uppercased())
            .font(.system(size: 10.5, weight: .heavy, design: .rounded))
            .kerning(1)
            .foregroundStyle(P.ink3)
    }

    private func podium(_ b: CupBracketFeed.Bracket, _ P: Palette) -> some View {
        VStack(spacing: 6) {
            row("1st", b.standings?.first, .first, gold: true, b, P)
            row("2nd", b.standings?.second, .second, gold: false, b, P)
            row("3rd", b.standings?.third, .third, gold: false, b, P)
        }
    }

    private func row(_ label: String, _ who: CupFeed.Standings.Card?, _ place: CupPlace,
                     gold: Bool, _ b: CupBracketFeed.Bracket, _ P: Palette) -> some View {
        let mine = who?.code != nil && who?.code == b.you?.code
        return HStack(spacing: 9) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .heavy, design: .rounded))
                .foregroundStyle(gold ? P.gold : P.ink3)
                .frame(width: 26, alignment: .leading)
            Text(who?.name ?? "—")
                .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                .foregroundStyle(P.ink)
                .lineLimit(1)
            Spacer(minLength: 6)
            Text(money(b, place))
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(gold ? P.gold : P.ink2)
        }
        .padding(.vertical, 9)
        .padding(.horizontal, 12)
        .background(gold ? P.goldSoft : P.sunken,
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(mine ? P.good : (gold ? P.gold : P.rule), lineWidth: mine ? 2 : 1))
    }

    /// One row per round this player played, in order. The short answer to
    /// "where am I", and the only part of a chart that stays readable when a
    /// hundred people entered.
    private struct Rung {
        var label: String
        var players: Int
        var line: String
        var kind: Int   // 0 lost, 1 won, 2 still going
    }

    private func run(_ b: CupBracketFeed.Bracket) -> [Rung] {
        guard let me = b.you?.name else { return [] }
        var out: [Rung] = []
        for r in b.rounds {
            guard let m = r.matches.first(where: { $0.mine == true }) else { continue }
            let other = m.a == me ? m.b : m.a
            let won = m.winner == me
            let line: String
            if m.state != "done" {
                line = other.map { "playing \($0)" } ?? "waiting for a table"
            } else if m.void == true {
                line = "nobody came"
            } else if won {
                line = "beat \(other ?? "a walkover")"
            } else {
                line = "lost to \(m.winner ?? "the other side")"
            }
            out.append(Rung(label: r.label, players: r.players, line: line,
                            kind: m.state != "done" ? 2 : (won ? 1 : 0)))
        }
        return out
    }

    private func ladder(_ b: CupBracketFeed.Bracket, _ P: Palette) -> some View {
        VStack(spacing: 6) {
            ForEach(Array(run(b).enumerated()), id: \.offset) { _, rung in
                HStack(spacing: 10) {
                    Circle()
                        .fill(rung.kind == 2 ? P.gold : rung.kind == 1 ? P.good : P.bad)
                        .frame(width: 9, height: 9)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(rung.label)
                            .font(.system(size: 13, weight: .heavy, design: .rounded))
                            .foregroundStyle(P.ink)
                        Text(rung.line)
                            .font(.system(size: 11.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink2)
                    }
                    Spacer(minLength: 6)
                    Text("\(rung.players)")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(P.ink3)
                        .padding(.vertical, 2)
                        .padding(.horizontal, 8)
                        .background(P.card, in: Capsule())
                        .overlay(Capsule().stroke(P.rule, lineWidth: 1))
                }
                .padding(.vertical, 9)
                .padding(.horizontal, 12)
                .background(rung.kind == 2 ? P.goldSoft : P.sunken,
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(rung.kind == 2 ? P.gold
                            : rung.kind == 1 ? P.good.opacity(0.45) : P.rule, lineWidth: 1))
            }
        }
    }

    /// The bracket itself: a column per round, scrolled sideways. It opens on
    /// the reader's own match rather than at the top of somebody else's.
    private func tree(_ b: CupBracketFeed.Bracket, _ P: Palette) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(b.rounds) { r in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 6) {
                                Text(r.label)
                                    .font(.system(size: 12, weight: .heavy, design: .rounded))
                                    .foregroundStyle(P.ink)
                                Text("\(r.players)")
                                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                                    .monospacedDigit()
                                    .foregroundStyle(P.ink3)
                            }
                            ForEach(Array(r.matches.enumerated()), id: \.offset) { i, m in
                                matchCard(m, b, P).id("\(r.n)-\(i)")
                            }
                        }
                        .frame(width: 186, alignment: .leading)
                    }
                }
                .padding(.vertical, 2)
            }
            .onAppear {
                // The last round this player appears in — where the chart opens.
                var target: String?
                for r in b.rounds {
                    for (i, m) in r.matches.enumerated() where m.mine == true { target = "\(r.n)-\(i)" }
                }
                if let target {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        withAnimation(.easeOut(duration: 0.4)) { proxy.scrollTo(target, anchor: .center) }
                    }
                }
            }
        }
    }

    private func matchCard(_ m: CupBracketFeed.Bracket.Match,
                           _ b: CupBracketFeed.Bracket, _ P: Palette) -> some View {
        let mine = m.mine == true
        return VStack(spacing: 0) {
            side(m.a, m.aScore, won: m.winner != nil && m.winner == m.a, done: m.state == "done", P)
            Rectangle().fill(P.rule).frame(height: 1)
            side(m.b, m.bScore, won: m.winner != nil && m.winner == m.b, done: m.state == "done", P)
            if m.walkover == true || m.void == true {
                Text(m.void == true ? "VOID" : "WALKOVER")
                    .font(.system(size: 8.5, weight: .heavy, design: .rounded))
                    .kerning(0.7)
                    .foregroundStyle(P.ink3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 3)
            }
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 9)
        .background(mine ? P.goldSoft : P.sunken,
                    in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
            .stroke(mine ? P.gold : P.rule, lineWidth: mine ? 1.5 : 1))
        .opacity(m.state == "pending" ? 0.6 : 1)
        .overlay(alignment: .topTrailing) {
            if mine {
                Text("YOU")
                    .font(.system(size: 8, weight: .black, design: .rounded))
                    .kerning(0.6)
                    .foregroundStyle(P.card)
                    .padding(.vertical, 1.5)
                    .padding(.horizontal, 6)
                    .background(P.gold, in: Capsule())
                    .offset(x: -6, y: -7)
            }
        }
    }

    private func side(_ name: String?, _ score: Int?, won: Bool, done: Bool, _ P: Palette) -> some View {
        HStack(spacing: 8) {
            Text(name ?? "—")
                .font(.system(size: 12.5, weight: won ? .heavy : .medium, design: .rounded))
                .foregroundStyle(name == nil ? P.ink3 : (won ? P.ink : P.ink2))
                .lineLimit(1)
            Spacer(minLength: 4)
            if done, let score {
                Text(score.formatted(.number))
                    .font(.system(size: 11, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(won ? P.good : P.ink3)
            }
        }
        .padding(.vertical, 4)
    }

    private func money(_ b: CupBracketFeed.Bracket, _ place: CupPlace) -> String {
        cupMoney(prize: b.prize, local: b.local, place: place)
    }

    private func load() async {
        guard let feed: CupBracketFeed = try? await store.fetchJSON(
            "/api/cup/bracket?token=\(store.token)", raw: true) else { failed = true; return }
        guard let b = feed.bracket else { failed = true; return }
        bracket = b
    }
}

// MARK: - the poster

/// What a cup is, in the order somebody deciding whether to enter wants it:
/// the prize, the shape of the thing, and the rules that catch people out.
struct CupPosterSheet: View {
    let cup: CupFeed.Cup

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 20, style: .continuous).fill(P.goldSoft)
                        RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(P.gold, lineWidth: 1)
                        Art.icon(.trophy, size: 30)
                    }
                    .frame(width: 62, height: 62)

                    VStack(spacing: 3) {
                        Text(cup.name)
                            .font(.system(size: 23, weight: .black, design: .rounded))
                            .foregroundStyle(P.ink)
                            .multilineTextAlignment(.center)
                        Text("Knockout · winner takes \(money(.first))")
                            .font(.system(size: 12.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink2)
                    }

                    HStack(spacing: 8) {
                        prize("1st", money(.first), gold: true, P)
                        prize("2nd", money(.second), gold: false, P)
                        prize("3rd", money(.third), gold: false, P)
                    }

                    rungs(P)

                    VStack(spacing: 7) {
                        rule("Everyone enters at once.",
                             "When the doors close the whole field is paired off — a hundred players make fifty tables.", P)
                        rule("Win and you go through.",
                             "Lose and you are out. Your table opens by itself and takes you straight to it.", P)
                        rule("Two seats, no bots.",
                             "A cup table cannot be filled with house players, and the link cannot seat a third.", P)
                        rule("Come back for it.",
                             "A table nobody opens is given away after eight minutes.", P)
                    }

                    Text(cup.local == nil
                         ? "Entering needs an account, because a prize needs somebody to pay. Prizes are paid by hand — keep your friend code."
                         : "Prizes are set in \(cup.prize.currency ?? "USD") and shown here in your own money at today\u{2019}s rate. Entering needs an account, because a prize needs somebody to pay.")
                        .font(.system(size: 11.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .multilineTextAlignment(.center)
                        .padding(.top, 2)
                }
                .padding(18)
            }
            .background(P.page.ignoresSafeArea())
            .navigationTitle("The cup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
    }

    /// The ladder a cup of this size actually runs: 100 → 50 → 25 → … → 🏆
    private func rungs(_ P: Palette) -> some View {
        var steps: [String] = []
        var left = max(2, cup.entrants)
        var i = 0
        while left > 1 && i < 9 { steps.append("\(left)"); left = Int(ceil(Double(left) / 2)); i += 1 }
        return HStack(spacing: 5) {
            ForEach(Array(steps.enumerated()), id: \.offset) { _, n in
                Text(n)
                    .font(.system(size: 12, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(P.ink2)
                    .padding(.vertical, 4).padding(.horizontal, 8)
                    .background(P.sunken, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(P.rule, lineWidth: 1))
                Text("→")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(P.ink3)
            }
            Art.icon(.trophy, size: 15)
                .padding(.vertical, 4).padding(.horizontal, 8)
                .background(P.goldSoft, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(P.gold, lineWidth: 1))
        }
    }

    private func prize(_ place: String, _ amount: String, gold: Bool, _ P: Palette) -> some View {
        VStack(spacing: 2) {
            Text(place.uppercased())
                .font(.system(size: 10, weight: .heavy, design: .rounded))
                .kerning(0.9)
                .foregroundStyle(gold ? P.gold : P.ink3)
            Text(amount)
                .font(.system(size: gold ? 17 : 14, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(gold ? P.gold : P.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 9)
        .background(gold ? P.goldSoft : P.sunken,
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(gold ? P.gold : P.rule, lineWidth: 1))
    }

    private func rule(_ head: String, _ body: String, _ P: Palette) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(head)
                .font(.system(size: 12.5, weight: .heavy, design: .rounded))
                .foregroundStyle(P.ink)
            Text(body)
                .font(.system(size: 12.5, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(11)
        .background(P.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(P.rule, lineWidth: 1))
    }

    private func money(_ place: CupPlace) -> String {
        cupMoney(prize: cup.prize, local: cup.local, place: place)
    }
}
