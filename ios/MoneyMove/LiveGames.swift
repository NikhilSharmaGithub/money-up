// Watching other people's games (1.0.6): the "Watch live" list on the Play
// tab, the read-only door into a table, and the line the dock shows a
// watcher.
//
// GET /api/live is public by construction — board, names, flags, colours,
// levels, a turn count — and carries no token, seat id or friend code, so
// nothing here can be used to find anybody. A watcher joins with
// `spectate: true`: the server seats nobody, answers no joinFailed, aliases
// every id in the state it sends (this device's own included), and refuses
// every action from that socket. So the table on screen is read-only by
// construction; the client only has to not offer buttons that would be
// refused. docs/API-1.0.6.md is the contract.

import SwiftUI

// MARK: - the wire

/// One table on GET /api/live. Every field but the code is optional, so a
/// server that grows a column later can't empty the list on an old client.
struct LiveGame: Decodable, Identifiable, Equatable {
    struct Seat: Decodable, Equatable {
        var name: String?
        var flag: String?
        var color: String?
        /// The equipped store face, "" when there is none.
        var avatar: String?
        var level: Int?
        /// A house player. Always false at a Play-now table, where the house
        /// passes as people — exactly as that table's own state says.
        var bot: Bool?
        /// Bankrupt, or removed from play.
        var out: Bool?
    }

    var roomId: String
    var mapId: String?
    var mapName: String?
    var players: [Seat]?
    var turnCount: Int?
    var startedAt: Double?
    /// The game clock of a timed table, epoch ms; nil when it has none.
    var endsAt: Double?
    var watching: Int?

    var id: String { roomId }
    var seats: [Seat] { players ?? [] }
    var boardName: String { (mapName?.isEmpty == false) ? mapName! : "MoneyMove" }
    /// Who is still in it, for the line under the board's name.
    var standing: [Seat] { seats.filter { $0.out != true } }
}

private struct LiveList: Decodable {
    var games: [LiveGame]?
}

// MARK: - the store's half

extension GameStore {
    /// Watch a game from the rail.
    ///
    /// The same door as join(), with `spectate: true` on it, because the
    /// ordinary door seats anybody it can: a table that has gone back to its
    /// lobby for a rematch has empty chairs, and somebody who only meant to
    /// look would find themselves dealt into the next game. No break before
    /// it either — nobody sits through an ad to watch.
    func watch(roomId id: String) {
        join(roomId: id, spectate: true)
    }

    /// Nobody on this device holds a seat at the table on screen: one watched
    /// from the rail, or one the ordinary door could only offer a view of — a
    /// full table, a game already under way. The server refuses every action
    /// either way, so neither is offered anything to press. A seat that went
    /// bankrupt or walked out is still a seat: it stays in the roster, keeps
    /// its chat, and is not watching in this sense.
    var isWatching: Bool {
        if spectating { return true }
        guard let state else { return false }
        return !state.players.contains { localIds.contains($0.id) }
    }

    /// The list, or nil when the server could not be read — which is not the
    /// same as an empty list, and the card says so differently.
    func fetchLiveGames() async -> [LiveGame]? {
        let list: LiveList? = try? await fetchJSON("/api/live")
        return list.map { $0.games ?? [] }
    }
}

// MARK: - the card

/// "Watch live" on the Play tab: the busiest public games right now, a tap
/// from the rail. Shows the first few; the sheet shows all twenty.
///
/// A table this device still has a seat at — walked away from, the house
/// covering the chair — is offered back as a seat rather than as something
/// to watch: watching your own game from the rail while a bot plays your
/// hand would be a strange way to come back to it.
struct WatchLiveCard: View {
    /// Hands the landing the codes on the list, so the public rooms card can
    /// stop offering the same games in play a second time.
    var onList: (Set<String>) -> Void = { _ in }

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @State private var games: [LiveGame]?
    @State private var failed = false
    @State private var showAll = false

    private static let shown = 3

    var body: some View {
        let P = Palette.current(scheme)
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Art.icon(.eye, size: 13, tint: P.ink3)
                    PanelTitle("Watch live")
                    if let games, !games.isEmpty {
                        LiveDot()
                    }
                    Spacer(minLength: 6)
                    if (games?.count ?? 0) > Self.shown {
                        Button("See all \(games?.count ?? 0)") {
                            SoundKit.shared.click()
                            showAll = true
                        }
                        .buttonStyle(MMButtonStyle(kind: .ghost))
                    }
                }

                if let games {
                    if games.isEmpty {
                        LiveEmpty()
                    } else {
                        VStack(spacing: 8) {
                            ForEach(games.prefix(Self.shown)) { game in
                                LiveGameRow(game: game)
                            }
                        }
                    }
                } else if failed {
                    HStack(spacing: 8) {
                        Text("Couldn't load the live games.")
                            .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink3)
                        Spacer(minLength: 6)
                        Button("Try again") { Task { await load() } }
                            .buttonStyle(MMButtonStyle(kind: .ghost))
                    }
                } else {
                    ProgressView()
                        .tint(P.ink3)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
        }
        .sheet(isPresented: $showAll) {
            WatchLiveSheet(initial: games ?? []).environmentObject(store)
        }
        // Polled while the Play tab is on screen, and only then: a list of
        // games in play goes stale in seconds, and a tab nobody is looking at
        // has no business asking.
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(12))
            }
        }
    }

    private func load() async {
        failed = false
        if let fresh = await store.fetchLiveGames() {
            games = fresh
            onList(Set(fresh.map(\.roomId)))
        } else if games == nil, !Task.isCancelled {
            // A blip keeps whatever is already on screen.
            failed = true
        }
    }
}

// MARK: - all of them

struct WatchLiveSheet: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss
    @State private var games: [LiveGame]

    init(initial: [LiveGame]) {
        _games = State(initialValue: initial)
    }

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Public games being played right now. Watching is read-only — nobody at the table can see who you are, only how many are watching.")
                        .font(.system(size: 12.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .fixedSize(horizontal: false, vertical: true)

                    MMCard(padding: 14) {
                        if games.isEmpty {
                            LiveEmpty()
                        } else {
                            VStack(spacing: 8) {
                                ForEach(games) { game in
                                    // The sheet goes first: the table opens
                                    // under the home screen this sat on.
                                    LiveGameRow(game: game, willOpen: { dismiss() })
                                }
                            }
                        }
                    }
                }
                .padding(16)
            }
            .navigationTitle("Watch live")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .sheetBarItem(on: .sheet)
                }
            }
        }
        .mmControls(on: .platter(.sheet))
        .sheetPaper(P.sheet)
        .presentationDetents([.large, .medium])
        .presentationDragIndicator(.visible)
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(12))
                if let fresh = await store.fetchLiveGames() { games = fresh }
            }
        }
    }
}

// MARK: - one game

/// The board, who is at it, and how far in — with the way in.
struct LiveGameRow: View {
    let game: LiveGame
    /// Said just before the table opens, for a sheet that has to get out of
    /// the way first.
    var willOpen: () -> Void = {}

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    /// A table this device left mid-game and still has a seat at.
    private var ours: GameStore.UnfinishedGame? {
        store.unfinishedGames.first { $0.roomId == game.roomId }
    }

    var body: some View {
        let P = Palette.current(scheme)
        Button {
            Haptics.tap()
            willOpen()
            if let ours {
                store.resume(ours)
            } else {
                store.watch(roomId: game.roomId)
            }
        } label: {
            HStack(spacing: 11) {
                faces(P)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(game.boardName)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                            .lineLimit(1)
                        if ours != nil {
                            Text("YOUR TABLE")
                                .font(.system(size: 7.5, weight: .black))
                                .kerning(0.8)
                                .foregroundStyle(P.accentInk)
                                .padding(.vertical, 2)
                                .padding(.horizontal, 5)
                                .background(P.gold, in: Capsule())
                        }
                    }
                    Text(names)
                        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink2)
                        .lineLimit(1)
                    details(P)
                }
                Spacer(minLength: 6)
                HStack(spacing: 4) {
                    Art.icon(ours != nil ? .door : .eye, size: 14, tint: P.red)
                    Text(ours != nil ? "Continue" : "Watch")
                        .font(.system(size: 12.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.red)
                }
            }
            .padding(10)
            .background(P.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(P.rule, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint(ours != nil ? "Goes back to your seat" : "Opens the game to watch")
    }

    /// Up to four faces, overlapped like a hand of cards: the players' own
    /// colours, faces and flags — the same disc their seat wears at the table.
    private func faces(_ P: Palette) -> some View {
        let seats = Array(game.seats.prefix(4))
        return ZStack(alignment: .leading) {
            ForEach(Array(seats.enumerated()), id: \.offset) { k, seat in
                AvatarView(name: seat.name ?? "?", colorCSS: seat.color ?? "#94a3b8",
                           flag: "", size: 26, emoji: seat.avatar ?? "")
                    .overlay(Circle().stroke(P.sunken, lineWidth: 2))
                    .opacity(seat.out == true ? 0.4 : 1)
                    .offset(x: CGFloat(k) * 13)
            }
        }
        .frame(width: 26 + CGFloat(max(0, seats.count - 1)) * 13, height: 28, alignment: .leading)
    }

    /// Everybody still in it, by name — and how many have gone out.
    private var names: String {
        let standing = game.standing.compactMap(\.name)
        let out = game.seats.count - game.standing.count
        let list = standing.isEmpty ? "Nobody left standing" : ListFormatter.localizedString(byJoining: standing)
        return out > 0 ? "\(list) · \(out) out" : list
    }

    @ViewBuilder
    private func details(_ P: Palette) -> some View {
        HStack(spacing: 8) {
            if let turns = game.turnCount {
                Text("Turn \(turns)")
            }
            if let watching = game.watching, watching > 0 {
                HStack(spacing: 3) {
                    Art.icon(.eye, size: 10, tint: P.ink3)
                    Text("\(watching)")
                }
            }
            if let ends = game.endsAt {
                // The game clock, at a glance; it only ever counts down, so a
                // minute's grain is all a list needs.
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    let left = max(0, Int(ceil((ends / 1000 - context.date.timeIntervalSince1970) / 60)))
                    HStack(spacing: 3) {
                        Art.icon(.clock, size: 10, tint: P.ink3)
                        Text(left > 0 ? "\(left) min left" : "Last turn")
                    }
                }
            }
        }
        .font(.system(size: 10.5, weight: .semibold, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(P.ink3)
        .lineLimit(1)
    }
}

/// Nothing to watch. Said plainly — an empty card reads as a broken one.
private struct LiveEmpty: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 6) {
            Art.icon(.eye, size: 24, tint: P.ink3)
            Text("No public games right now")
                .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                .foregroundStyle(P.ink2)
            Text("Start one with Play now and somebody may be watching you.")
                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink3)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
    }
}

/// The small red "on air" light beside the title, breathing while there is
/// something live to watch. Still under Reduce Motion.
private struct LiveDot: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    var body: some View {
        Circle()
            .fill(Palette.current(scheme).bad)
            .frame(width: 7, height: 7)
            .opacity(dim ? 0.35 : 1)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.9).repeatForever(autoreverses: true),
                       value: dim)
            .onAppear { if !reduceMotion { dim = true } }
            .accessibilityHidden(true)
    }
}

// MARK: - at the table

/// What the dock says to somebody watching: that they are, and that nothing
/// here will answer them. The rest of the dock — whose turn it is, their
/// clock — is the same one every seat reads.
struct WatchingLine: View {
    /// The dock's own glass, so the words take its ink.
    let glass: GlassTokens

    @EnvironmentObject var store: GameStore
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        let ic = contrast == .increased
        let others = max(0, (store.state?.spectators ?? 0) - 1)
        HStack(spacing: 7) {
            Art.icon(.eye, size: 15, tint: glass.label(increaseContrast: ic))
            Text("You're watching")
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .foregroundStyle(glass.label(increaseContrast: ic))
            Text(others > 0 ? "with \(others) other\(others == 1 ? "" : "s")" : "read-only")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(glass.label(secondary: true, increaseContrast: ic))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
    }
}

/// How many are watching, floated in the board's well opposite the History
/// chip. Everybody at the table sees it — the count, never who. Just the eye
/// and the number: the well's centre carries the vacation pot at the same
/// height, and on the narrowest phone a worded chip would run into it.
struct WatchersChip: View {
    let count: Int

    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        let glass = BackdropKind.felt.settledGlass(Palette.current(scheme))
        let ink = glass.label(secondary: true, increaseContrast: contrast == .increased)
        HStack(spacing: 4) {
            Art.icon(.eye, size: 12, tint: ink)
            Text("\(count)")
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(ink)
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 10)
        // Over the felt, with the log sliding under it: Regular glass, as the
        // vacation pot and the History chip are.
        .mmGlass(.regular, backdrop: .felt, in: Capsule())
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(count) \(count == 1 ? "person" : "people") watching")
    }
}
