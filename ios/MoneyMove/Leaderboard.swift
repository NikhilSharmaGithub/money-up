// The lifetime table: who has actually won the most games, ever.
//
// GET /api/leaderboard is public by construction — friend codes and totals,
// never tokens or emails — and house players can't appear on it at all. The
// card shows the five that matter; the sheet shows the whole fifty.

import SwiftUI

/// One line of GET /api/leaderboard. Every field is optional so a server that
/// grows a column later can't blank the board on an old client.
struct LeaderboardEntry: Decodable, Identifiable, Equatable {
    var code: String?
    var name: String?
    var flag: String?
    var wins: Int?
    var winnings: Int?

    /// Stable across redraws — a fresh id every render would rebuild the whole
    /// list on every poll.
    var id: String { code ?? "?\(name ?? "player")" }
    var displayName: String { (name?.isEmpty == false) ? name! : "Player" }
}

// MARK: - the card

struct LeaderboardCard: View {
    /// This device's friend code, from /api/me — the one row worth finding.
    let myCode: String?

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @State private var top: [LeaderboardEntry] = []
    @State private var showAll = false

    var body: some View {
        let P = Palette.current(scheme)
        // Wrapped rather than hidden behind a bare `if`: an empty view never
        // runs its task, and the card could then never arrive at all.
        VStack(spacing: 0) {
            if !top.isEmpty {
                MMCard(padding: 16) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 6) {
                            Art.icon(.trophy, size: 13)
                            PanelTitle("Leaderboard")
                            Spacer(minLength: 6)
                            if top.count > 5 {
                                Button("See all") {
                                    SoundKit.shared.click()
                                    showAll = true
                                }
                                .buttonStyle(MMButtonStyle(kind: .ghost))
                            }
                        }

                        VStack(spacing: 7) {
                            ForEach(Array(top.prefix(5).enumerated()), id: \.element.id) { rank, entry in
                                LeaderboardRow(rank: rank, entry: entry,
                                               isMe: entry.code != nil && entry.code == myCode)
                            }
                            // Standing 31st is still a standing — if the
                            // player isn't in the five above, their own row
                            // comes along underneath rather than being news
                            // they have to go looking for.
                            if let mine, mine.rank >= 5 {
                                Rectangle()
                                    .fill(P.rule)
                                    .frame(height: 1)
                                    .padding(.vertical, 1)
                                LeaderboardRow(rank: mine.rank, entry: mine.entry, isMe: true)
                            }
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $showAll) {
            LeaderboardSheet(entries: top, myCode: myCode)
        }
        .task { await load() }
    }

    /// Where this device sits in the fifty, if it sits there at all.
    private var mine: (rank: Int, entry: LeaderboardEntry)? {
        guard let myCode else { return nil }
        guard let i = top.firstIndex(where: { $0.code == myCode }) else { return nil }
        return (i, top[i])
    }

    private func load() async {
        struct Board: Decodable { var top: [LeaderboardEntry]? }
        let board: Board? = try? await store.fetchJSON("/api/leaderboard")
        // A failed read keeps whatever is on screen — blanking the board on a
        // blip reads as everybody's wins having been wiped.
        if let fresh = board?.top { top = fresh }
    }
}

// MARK: - the whole fifty

struct LeaderboardSheet: View {
    let entries: [LeaderboardEntry]
    let myCode: String?

    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Every game these players have ever won. Only wins get you on the board.")
                            .font(.system(size: 12.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)

                        MMCard(padding: 14) {
                            VStack(spacing: 7) {
                                ForEach(Array(entries.enumerated()), id: \.element.id) { rank, entry in
                                    LeaderboardRow(rank: rank, entry: entry,
                                                   isMe: entry.code != nil && entry.code == myCode)
                                        .id(entry.id)
                                }
                            }
                        }
                    }
                    .padding(16)
                }
                .onAppear {
                    // Deep down the list, your own row is the one you opened
                    // this for — put it on screen instead of making them scroll.
                    guard let myCode,
                          let i = entries.firstIndex(where: { $0.code == myCode }), i >= 8 else { return }
                    proxy.scrollTo(entries[i].id, anchor: .center)
                }
            }
            .background(P.sheet)
            .navigationTitle("Leaderboard")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.large, .medium])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - one row

struct LeaderboardRow: View {
    let rank: Int
    let entry: LeaderboardEntry
    let isMe: Bool

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        HStack(spacing: 10) {
            medal(P)
                .frame(width: 26)

            if let flag = entry.flag, !flag.isEmpty {
                Text(flag).font(.system(size: 18))
            }

            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(entry.displayName)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(P.ink)
                        .lineLimit(1)
                    if isMe {
                        Text("YOU")
                            .font(.system(size: 8, weight: .black))
                            .kerning(0.8)
                            .foregroundStyle(P.accentInk)
                            .padding(.vertical, 2)
                            .padding(.horizontal, 5)
                            .background(P.gold, in: Capsule())
                    }
                }
                Text(money(entry.winnings ?? 0) + " won, all-time")
                    .font(.system(size: 10.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .lineLimit(1)
            }

            Spacer(minLength: 6)

            VStack(spacing: 0) {
                Text("\(entry.wins ?? 0)")
                    .font(.system(size: 15, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(P.gold)
                Text(entry.wins == 1 ? "WIN" : "WINS")
                    .font(.system(size: 7.5, weight: .black))
                    .kerning(0.8)
                    .foregroundStyle(P.ink3)
            }
        }
        .padding(.vertical, 7)
        .padding(.horizontal, 9)
        .background(isMe ? AnyShapeStyle(P.goldSoft) : AnyShapeStyle(P.sunken),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(isMe ? P.gold : P.rule, lineWidth: isMe ? 1.5 : 1)
        )
    }

    /// The podium gets its metal, exactly as the report card does; everyone
    /// below it gets their number.
    @ViewBuilder private func medal(_ P: Palette) -> some View {
        switch rank {
        case 0: Art.icon(.medalGold, size: 22)
        case 1: Art.icon(.medalSilver, size: 22)
        case 2: Art.icon(.medalBronze, size: 22)
        default:
            Text("\(rank + 1)")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(P.ink3)
        }
    }
}
