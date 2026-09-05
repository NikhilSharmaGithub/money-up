// The pieces of a match result — standings, titles, the report-card table —
// shared between the live game-over sheet and History's replay of an old
// game. Both render the same [PlayerResult] snapshot, so the result a player
// reopens next week is exactly the one they saw at the table.

import SwiftUI

// MARK: - standings

struct ResultStandingsCard: View {
    let results: [PlayerResult]
    /// Offer the add-friend action on human seats that aren't this device's.
    var showAddFriend = true

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    /// Seats already added this sitting, so the button can settle into a tick.
    @State private var added: Set<String> = []

    var body: some View {
        let P = Palette.current(scheme)
        MMCard {
            VStack(alignment: .leading, spacing: 10) {
                PanelTitle("Final standings")
                ForEach(Array(results.enumerated()), id: \.element.id) { rank, r in
                    HStack(spacing: 10) {
                        medal(rank, P)
                            .frame(width: 26)
                        AvatarView(name: r.name, colorCSS: r.color, flag: r.flag ?? "",
                                   size: 30, emoji: r.avatar ?? "")
                        Text(r.name)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                            .lineLimit(1)
                        if showAddFriend, canBefriend(r) {
                            addFriendButton(r, P)
                        }
                        Spacer()
                        // A game can end while a seat is still in the red —
                        // the worth prints in the danger colour, never green.
                        Text(r.outcomeLabel ?? money(r.worth))
                            .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                            .foregroundStyle(r.bankrupt ? P.ink3 : (r.worth < 0 ? P.bad : P.good))
                    }
                    .opacity(r.bankrupt ? 0.6 : 1)
                }
            }
        }
    }

    /// Podium finishes get their metal; everyone else gets their number.
    @ViewBuilder private func medal(_ rank: Int, _ P: Palette) -> some View {
        switch rank {
        case 0: Art.icon(.medalGold, size: 22)
        case 1: Art.icon(.medalSilver, size: 22)
        case 2: Art.icon(.medalBronze, size: 22)
        default:
            Text("\(rank + 1)")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(P.ink3)
        }
    }

    /// Humans only, and never a seat this device itself played (guest seats
    /// share the device's token as a prefix).
    private func canBefriend(_ r: PlayerResult) -> Bool {
        !r.isBot && !r.id.hasPrefix(store.token) && !store.localIds.contains(r.id)
    }

    private func addFriendButton(_ r: PlayerResult, _ P: Palette) -> some View {
        let done = added.contains(r.id)
        return Button {
            guard !done else { return }
            Task { await befriend(r) }
        } label: {
            Image(systemName: done ? "checkmark" : "person.badge.plus")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(done ? P.good : P.ink2)
                .frame(width: 26, height: 26)
                .background(done ? P.goodSoft : P.sunken, in: Circle())
                .overlay(Circle().stroke(done ? P.good.opacity(0.5) : P.rule, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(done ? "\(r.name) added" : "Add \(r.name) as a friend")
    }

    /// A player id IS their profile token, and friend codes are a pure hash of
    /// it — so this rides the normal add-by-code flow with a computed code.
    private func befriend(_ r: PlayerResult) async {
        Haptics.tap()
        struct Reply: Decodable { var ok: Bool?; var error: String? }
        let reply: Reply? = try? await store.fetchJSON(
            "/api/friends", method: "POST",
            body: ["token": store.token, "code": friendCode(for: r.id)])
        if reply?.ok == true || (reply != nil && reply?.error == nil) {
            added.insert(r.id)
            store.showToast("You and \(r.name) are now friends")
        } else {
            store.showToast(reply?.error ?? "Couldn't reach the server — try again.", isError: true)
        }
    }
}

// MARK: - titles

struct ResultTitlesCard: View {
    let results: [PlayerResult]

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        let titled = results.filter { $0.title != nil }
        if !titled.isEmpty {
            MMCard {
                VStack(alignment: .leading, spacing: 10) {
                    PanelTitle("Titles")
                    ForEach(titled) { r in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Circle()
                                .fill(Color(css: r.color))
                                .frame(width: 8, height: 8)
                                .offset(y: -1)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(r.title ?? "")
                                        .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                                        .foregroundStyle(P.gold)
                                    Text(r.name)
                                        .font(.system(size: 12.5, weight: .bold, design: .rounded))
                                        .foregroundStyle(P.ink)
                                        .lineLimit(1)
                                }
                                if let reason = r.titleReason {
                                    Text(reason)
                                        .font(.system(size: 12, weight: .medium, design: .rounded))
                                        .foregroundStyle(P.ink3)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - report card

struct ResultStatsCard: View {
    let results: [PlayerResult]

    @Environment(\.colorScheme) private var scheme

    /// The seven numbers worth reading out — the rest live on in the titles.
    private static let rows: [(label: String, value: (PlayerStats) -> String)] = [
        ("Rent collected", { money($0.rentCollected ?? 0) }),
        ("Rent paid", { money($0.rentPaid ?? 0) }),
        ("Streets bought", { "\($0.streetsBought ?? 0)" }),
        ("Houses built", { "\($0.housesBuilt ?? 0)" }),
        ("Doubles rolled", { "\($0.doubles ?? 0)" }),
        ("Times jailed", { "\($0.jailed ?? 0)" }),
        ("Laps of the board", { "\($0.laps ?? 0)" }),
    ]

    var body: some View {
        let P = Palette.current(scheme)
        // Older History records were saved before the report card existed.
        if results.contains(where: { $0.stats != nil }) {
            MMCard {
                VStack(alignment: .leading, spacing: 10) {
                    PanelTitle("Match stats")
                    ScrollView(.horizontal, showsIndicators: false) {
                        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
                            GridRow {
                                Color.clear.frame(width: 1, height: 1)
                                ForEach(results) { r in
                                    VStack(spacing: 3) {
                                        AvatarView(name: r.name, colorCSS: r.color, flag: "",
                                                   size: 24, emoji: r.avatar ?? "")
                                        Text(r.name)
                                            .font(.system(size: 9.5, weight: .bold, design: .rounded))
                                            .foregroundStyle(P.ink2)
                                            .lineLimit(1)
                                            .frame(maxWidth: 64)
                                    }
                                    .gridColumnAlignment(.trailing)
                                }
                            }
                            ForEach(Self.rows, id: \.label) { row in
                                GridRow {
                                    Text(row.label)
                                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                                        .foregroundStyle(P.ink3)
                                        .fixedSize()
                                    ForEach(results) { r in
                                        Text(row.value(r.stats ?? PlayerStats()))
                                            .font(.system(size: 12.5, weight: .heavy, design: .rounded))
                                            .monospacedDigit()
                                            .foregroundStyle(P.ink)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - a finished game reopened from History

struct MatchDetailSheet: View {
    /// The record tapped in the History list; paging moves through the rest.
    let initialId: UUID

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @State private var index: Int = 0

    private var record: GameStore.MatchRecord? {
        store.matchHistory.indices.contains(index) ? store.matchHistory[index] : nil
    }

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                if let record {
                    VStack(spacing: 14) {
                        headerCard(record, P)
                        if let results = record.results, !results.isEmpty {
                            ResultStandingsCard(results: results)
                            ResultTitlesCard(results: results)
                            ResultStatsCard(results: results)
                        } else {
                            MMCard {
                                Text("This game finished before the report card existed — newer games keep their full stats and titles.")
                                    .font(.system(size: 12.5, weight: .medium, design: .rounded))
                                    .foregroundStyle(P.ink3)
                            }
                        }
                    }
                    .padding(16)
                }
            }
            .background(P.sheet)
            .navigationTitle("Result")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) { pager(P) }
        }
        .presentationDetents([.large, .medium])
        .presentationDragIndicator(.visible)
        .onAppear {
            index = store.matchHistory.firstIndex { $0.id == initialId } ?? 0
        }
    }

    private func headerCard(_ record: GameStore.MatchRecord, _ P: Palette) -> some View {
        let unfinished = (record.outcome ?? (record.won ? "won" : "lost")) == "left"
        return MMCard(padding: 16) {
            HStack(spacing: 12) {
                Art.icon(mapGlyph(record.mapIcon), size: 30, tint: P.gold)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(record.mapName)
                            .font(.system(size: 16, weight: .heavy, design: .rounded))
                            .foregroundStyle(P.ink)
                            .lineLimit(1)
                        Text(unfinished ? "LEFT" : record.won ? "WON" : "LOST")
                            .font(.system(size: 8, weight: .black))
                            .kerning(0.8)
                            .foregroundStyle(record.won ? P.accentInk : P.ink3)
                            .padding(.vertical, 2.5)
                            .padding(.horizontal, 6)
                            .background(record.won ? AnyShapeStyle(P.gold) : AnyShapeStyle(P.sunken), in: Capsule())
                    }
                    Text(unfinished
                         ? "Left before the end · \(record.players.count) player\(record.players.count == 1 ? "" : "s")"
                         : "\(record.winner) won · \(record.players.count) player\(record.players.count == 1 ? "" : "s")"
                            + (record.turns > 0 ? " · \(record.turns) turn\(record.turns == 1 ? "" : "s")" : ""))
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink2)
                    Text(record.date.formatted(date: .abbreviated, time: .shortened))
                        .font(.system(size: 10.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                }
                Spacer(minLength: 0)
            }
        }
    }

    /// Newest first, so "older" walks down the list and "newer" back up.
    private func pager(_ P: Palette) -> some View {
        HStack {
            Button {
                withAnimation(.snappy(duration: 0.2)) { index += 1 }
                Haptics.tap()
            } label: {
                Label("Older", systemImage: "chevron.left")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
            }
            .buttonStyle(MMButtonStyle(kind: .ghost))
            .disabled(index >= store.matchHistory.count - 1)

            Spacer()
            Text("\(index + 1) of \(store.matchHistory.count)")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink3)
            Spacer()

            Button {
                withAnimation(.snappy(duration: 0.2)) { index -= 1 }
                Haptics.tap()
            } label: {
                HStack(spacing: 4) {
                    Text("Newer")
                    Image(systemName: "chevron.right")
                }
                .font(.system(size: 13, weight: .bold, design: .rounded))
            }
            .buttonStyle(MMButtonStyle(kind: .ghost))
            .disabled(index <= 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.thinMaterial)
    }
}
