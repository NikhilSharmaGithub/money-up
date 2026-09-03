// The trophy shelf: every title this device has ever been handed, and how
// often. The room awards at most one per player per game, so a count of three
// means three separate games ended with that badge on your seat.
//
// GET /api/achievements is your own shelf and nobody else's — the token is a
// secret, so that is all it opens.

import SwiftUI

/// GET /api/achievements. Optional throughout: an account that has never
/// finished a game answers with zeroes, and so does an unknown token.
struct AchievementsInfo: Decodable, Equatable {
    var titles: [String: Int]?
    var wins: Int?
    var winnings: Int?
    var turnsPlayed: Int?

    /// Most-earned first, then alphabetical so a tie doesn't shuffle itself
    /// about between refreshes.
    var shelf: [(title: String, count: Int)] {
        (titles ?? [:])
            .map { (title: $0.key, count: $0.value) }
            .sorted { $0.count != $1.count ? $0.count > $1.count : $0.title < $1.title }
    }

    var isEmpty: Bool {
        (titles?.isEmpty ?? true) && (wins ?? 0) == 0 && (turnsPlayed ?? 0) == 0
    }
}

/// The shelf, on the History tab. Quiet until there is something on it — a
/// wall of zeroes is not an achievement.
struct AchievementsShelf: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @State private var info: AchievementsInfo?

    var body: some View {
        // The task has to hang off something that survives an empty shelf, or
        // the card could never learn it has anything to show.
        VStack(spacing: 0) {
            if let info, !info.isEmpty || !store.matchHistory.isEmpty {
                card(info)
            }
        }
        .task { await load() }
    }

    private func card(_ info: AchievementsInfo) -> some View {
        let P = Palette.current(scheme)
        let shelf = info.shelf
        return MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 6) {
                    Art.icon(.medalGold, size: 13)
                    PanelTitle("Your shelf")
                }

                // Lifetime, and kept by the server — the four numbers behind
                // every title below.
                HStack(alignment: .top, spacing: 0) {
                    tally("\(info.wins ?? 0)", "WINS", P)
                    tally("\(gamesPlayed(info))", "GAMES", P)
                    tally(compact(info.winnings ?? 0), "WON", P)
                    tally("\(info.turnsPlayed ?? 0)", "TURNS", P)
                }

                if shelf.isEmpty {
                    Text("No titles yet. Every game hands them out at the end — collect rent, close trades, build the most, and one lands on your seat.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 8)],
                              alignment: .leading, spacing: 8) {
                        ForEach(shelf, id: \.title) { badge in
                            titleChip(badge.title, badge.count, P)
                        }
                    }
                }
            }
        }
    }

    /// The report card's title styling, worn again: gold, heavy, rounded — a
    /// badge should read the same on the shelf as it did the night it landed.
    private func titleChip(_ title: String, _ count: Int, _ P: Palette) -> some View {
        HStack(spacing: 6) {
            Art.icon(.trophy, size: 13)
            Text(title)
                .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                .foregroundStyle(P.gold)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 2)
            if count > 1 {
                Text("×\(count)")
                    .font(.system(size: 11, weight: .black, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(P.accentInk)
                    .padding(.vertical, 2)
                    .padding(.horizontal, 6)
                    .background(P.gold, in: Capsule())
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 10)
        .background(P.goldSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(P.gold.opacity(0.55), lineWidth: 1))
    }

    /// The server counts wins, not games — only this phone remembers the games
    /// themselves. On a fresh install that would read "12 wins, 0 games", so
    /// the wins act as the floor they actually are: nobody has ever won a game
    /// they didn't play.
    private func gamesPlayed(_ info: AchievementsInfo) -> Int {
        max(store.matchHistory.count, info.wins ?? 0)
    }

    private func tally(_ value: String, _ label: String, _ P: Palette) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 19, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(P.gold)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(label)
                .font(.system(size: 8.5, weight: .bold))
                .kerning(0.9)
                .foregroundStyle(P.ink3)
        }
        .frame(maxWidth: .infinity)
    }

    /// A lifetime of winnings runs to seven figures — four columns have room
    /// for "$1.4M", never for "$1,412,900".
    private func compact(_ n: Int) -> String {
        switch abs(n) {
        case 1_000_000...: return "$\((Double(n) / 1_000_000).formatted(.number.precision(.fractionLength(0...1))))M"
        case 10_000...: return "$\(n / 1000)k"
        default: return money(n)
        }
    }

    private func load() async {
        // Asked more than once on purpose: this is the only read the shelf ever
        // makes, so one dropped request would empty it until the app restarts.
        for attempt in 1...4 {
            // The query string means raw mode — fetchJSON's normal path builder
            // percent-encodes the "?".
            let fresh: AchievementsInfo? = try? await store.fetchJSON(
                "/api/achievements?token=\(store.token)", raw: true)
            if let fresh { info = fresh; return }
            if Task.isCancelled { return }
            try? await Task.sleep(for: .seconds(Double(attempt) * 5))
        }
    }
}
