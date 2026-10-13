// Who has actually won the most games: ever, this week, and among friends.
//
// GET /api/leaderboard is public by construction — friend codes and totals,
// never tokens or emails — and house players can't appear on it at all. The
// token rides along only so the server can mark this player's own row and say
// where they stand below the fifty. The card shows the five that matter; the
// sheet shows the whole fifty. Any row opens that player's profile.

import SwiftUI

/// One line of GET /api/leaderboard. Every field is optional so a server that
/// grows a column later can't blank the board on an old client.
struct LeaderboardEntry: Decodable, Identifiable, Equatable {
    var code: String?
    var name: String?
    var flag: String?
    var level: Int?
    var wins: Int?
    var winnings: Int?
    /// True on the caller's own row only.
    var you: Bool?

    /// Stable across redraws — a fresh id every render would rebuild the whole
    /// list on every poll.
    var id: String { code ?? "?\(name ?? "player")" }
    var displayName: String { (name?.isEmpty == false) ? name! : "Player" }
}

/// The three boards. The raw value is what the server's `scope` reads.
enum LeaderboardScope: String, CaseIterable, Identifiable {
    case all, week, friends

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All time"
        case .week: "This week"
        case .friends: "Friends"
        }
    }

    /// What the winnings under a name were counted over.
    var span: String { self == .week ? "this week" : "all-time" }
}

/// One scope of GET /api/leaderboard. `you` is where this player stands in
/// the whole ordering — possibly far below the fifty that are sent.
struct LeaderboardBoard: Decodable, Equatable {
    struct You: Decodable, Equatable {
        var rank: Int?
        var wins: Int?
    }

    var scope: String?
    /// The ISO week and its next Monday, for the weekly board only.
    var week: String?
    var resetsAt: Double?
    var top: [LeaderboardEntry]?
    var you: You?

    var rows: [LeaderboardEntry] { top ?? [] }

    /// Asked more than once on purpose: a launch fires half a dozen reads at
    /// once, and one of them losing would otherwise hide the board until the
    /// app is restarted.
    @MainActor
    static func fetch(_ scope: LeaderboardScope, _ store: GameStore, attempts: Int = 4) async -> LeaderboardBoard? {
        for attempt in 1...max(1, attempts) {
            // A query string, so raw mode — fetchJSON's path builder would
            // percent-encode the "?".
            let board: LeaderboardBoard? = try? await store.fetchJSON(
                "/api/leaderboard?scope=\(scope.rawValue)&token=\(store.token)", raw: true)
            if let board, board.top != nil { return board }
            if Task.isCancelled || attempt == attempts { return nil }
            try? await Task.sleep(for: .seconds(Double(attempt) * 5))
        }
        return nil
    }
}

/// This player's own row, wherever it is: in the list the server sent, or —
/// below the fifty — made from the rank the server reports and what this
/// device knows about itself.
@MainActor
private func ownRow(in board: LeaderboardBoard, myCode: String?,
                    store: GameStore) -> (rank: Int, entry: LeaderboardEntry)? {
    let rows = board.rows
    if let i = rows.firstIndex(where: { isOwn($0, myCode) }) { return (i, rows[i]) }
    guard let rank = board.you?.rank, rank > 0 else { return nil }
    let me = LeaderboardEntry(code: myCode, name: store.nickname, flag: store.flag,
                              level: store.myLevel?.level, wins: board.you?.wins, winnings: nil, you: true)
    return (rank - 1, me)
}

private func isOwn(_ entry: LeaderboardEntry, _ myCode: String?) -> Bool {
    entry.you == true || (entry.code != nil && entry.code == myCode)
}

/// What opening a row hands the profile sheet: the row is enough to draw the
/// top of it while the profile itself is read.
private func profileSeat(_ entry: LeaderboardEntry) -> PlayerResult? {
    guard let code = entry.code, !code.isEmpty else { return nil }
    return PlayerResult.card(code: code, name: entry.displayName, flag: entry.flag,
                             avatar: nil, level: entry.level)
}

// MARK: - the card

struct LeaderboardCard: View {
    /// This device's friend code, from /api/me — the one row worth finding.
    let myCode: String?

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @State private var scope: LeaderboardScope = .all
    @State private var boards: [LeaderboardScope: LeaderboardBoard] = [:]
    /// A scope whose read gave up, so the card can offer a retry instead of a
    /// spinner that never stops.
    @State private var failed: Set<LeaderboardScope> = []
    @State private var showAll = false
    @State private var profileOf: PlayerResult?

    var body: some View {
        let P = Palette.current(scheme)
        // Wrapped rather than hidden behind a bare `if`: an empty view never
        // runs its task, and the card could then never arrive at all. It
        // arrives once anybody has won anything — a server where nobody has
        // is not a leaderboard yet, whichever tab you would open it on.
        VStack(spacing: 0) {
            if !(boards[.all]?.rows.isEmpty ?? true) {
                MMCard(padding: 16) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 6) {
                            Art.icon(.trophy, size: 13)
                            PanelTitle("Leaderboard")
                            Spacer(minLength: 6)
                            if (boards[scope]?.rows.count ?? 0) > 5 {
                                Button("See all") {
                                    SoundKit.shared.click()
                                    showAll = true
                                }
                                .buttonStyle(MMButtonStyle(kind: .ghost))
                            }
                        }

                        LeaderboardScopeSwitch(scope: $scope)

                        LeaderboardRows(scope: scope, board: boards[scope], failed: failed.contains(scope),
                                        myCode: myCode, limit: 5,
                                        retry: { Task { await load(scope) } },
                                        open: { profileOf = $0 })
                    }
                }
                .sheet(item: $profileOf) { seat in
                    PlayerProfileSheet(seat: seat).environmentObject(store)
                }
            }
        }
        .animation(.spring(duration: 0.3), value: scope)
        .sheet(isPresented: $showAll) {
            LeaderboardSheet(initial: scope, boards: boards, myCode: myCode)
                .environmentObject(store)
        }
        .task { await load(.all) }
        // Each scope is read the first time it is looked at; the all-time
        // board above is the one read without being asked for.
        .task(id: scope) {
            if scope != .all, boards[scope] == nil { await load(scope) }
        }
    }

    private func load(_ which: LeaderboardScope) async {
        failed.remove(which)
        // A failed read keeps whatever is on screen — blanking the board on a
        // blip reads as everybody's wins having been wiped.
        if let fresh = await LeaderboardBoard.fetch(which, store) {
            boards[which] = fresh
        } else if boards[which] == nil, !Task.isCancelled {
            failed.insert(which)
        }
    }
}

// MARK: - the tabs

/// All time / This week / Friends: one track with a well that travels to the
/// choice, the way the Appearance switch on the Settings tab is drawn — one
/// control, not three chips that happen to sit in a row.
struct LeaderboardScopeSwitch: View {
    @Binding var scope: LeaderboardScope

    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var lit

    var body: some View {
        let P = Palette.current(scheme)
        let glass = BackdropKind.paper.settledGlass(P)
        let well = glass.ink.opacity(contrast == .increased ? 0.18 : 0.10)
        HStack(spacing: 0) {
            ForEach(LeaderboardScope.allCases) { option in
                let on = option == scope
                Button {
                    guard option != scope else { return }
                    // 320 ms, the travel every segmented indicator in the app
                    // makes; none at all under Reduce Motion.
                    withAnimation(reduceMotion ? nil : .snappy(duration: 0.32)) { scope = option }
                    Haptics.tap()
                } label: {
                    Text(option.title)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(glass.label(secondary: !on, increaseContrast: contrast == .increased))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .background {
                            if on {
                                RoundedRectangle(cornerRadius: MMRadius.inner(MMRadius.sm + 4, inset: 3),
                                                 style: .continuous)
                                    .fill(well)
                                    .matchedGeometryEffect(id: "lit", in: lit)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        // Glass printed on a card: what is under it is the card and travels
        // with it, so it runs at `flat` — as the card's own buttons do.
        .mmGlass(.regular, backdrop: .paper,
                 in: RoundedRectangle(cornerRadius: MMRadius.sm + 4, style: .continuous))
        .transformEnvironment(\.mmGlassQuality) { $0 = min($0, .flat) }
    }
}

// MARK: - the rows of one scope

/// One scope's rows, or the word on why there are none. Shared by the card
/// (five rows, then your own) and the sheet (all fifty).
private struct LeaderboardRows: View {
    let scope: LeaderboardScope
    let board: LeaderboardBoard?
    let failed: Bool
    let myCode: String?
    /// Nil for every row the server sent.
    let limit: Int?
    let retry: () -> Void
    let open: (PlayerResult) -> Void

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        VStack(alignment: .leading, spacing: 7) {
            if scope == .week {
                HStack(spacing: 5) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 9.5, weight: .bold))
                    Text("Resets Monday" + resetSuffix)
                }
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink3)
            }
            if let board {
                let rows = limit.map { Array(board.rows.prefix($0)) } ?? board.rows
                if rows.isEmpty {
                    empty(P)
                } else {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { rank, entry in
                        row(rank, entry)
                            .id(entry.id)
                    }
                    // Standing 31st is still a standing — if the player isn't
                    // in the rows above, their own row comes along underneath
                    // rather than being news they have to go looking for.
                    if let mine = ownRow(in: board, myCode: myCode, store: store), mine.rank >= rows.count {
                        Rectangle()
                            .fill(P.rule)
                            .frame(height: 1)
                            .padding(.vertical, 1)
                        row(mine.rank, mine.entry)
                    }
                    // A friends board with nobody on it but you is a board
                    // waiting for friends — say how to get some.
                    if scope == .friends, board.rows.allSatisfy({ isOwn($0, myCode) }) {
                        Text("Add friends on the Social tab to see how you stack up.")
                            .font(.system(size: 11.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 4)
                    }
                }
            } else if failed {
                HStack(spacing: 8) {
                    Text("Couldn't load this board.")
                        .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                    Spacer(minLength: 6)
                    Button("Try again", action: retry)
                        .buttonStyle(MMButtonStyle(kind: .ghost))
                }
                .padding(.vertical, 6)
            } else {
                ProgressView()
                    .tint(P.ink3)
                    .frame(maxWidth: .infinity, minHeight: 60)
            }
        }
    }

    private var resetSuffix: String {
        guard let at = board?.resetsAt else { return "" }
        let secs = Int(Date(timeIntervalSince1970: at / 1000).timeIntervalSinceNow)
        guard secs > 0 else { return "" }
        let days = secs / 86_400
        if days >= 1 { return " · in \(days) day\(days == 1 ? "" : "s")" }
        return " · in " + DailyRewardCard.until(Date(timeIntervalSince1970: at / 1000))
    }

    @ViewBuilder
    private func row(_ rank: Int, _ entry: LeaderboardEntry) -> some View {
        let mine = isOwn(entry, myCode)
        if let seat = profileSeat(entry) {
            Button {
                Haptics.tap()
                open(seat)
            } label: {
                LeaderboardRow(rank: rank, entry: entry, isMe: mine, span: scope.span, opens: true)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens \(entry.displayName)'s profile")
        } else {
            LeaderboardRow(rank: rank, entry: entry, isMe: mine, span: scope.span)
        }
    }

    private func empty(_ P: Palette) -> some View {
        let (title, line): (String, String) = switch scope {
        case .all: ("Nobody yet", "Win a game and the board is yours.")
        case .week: ("No wins yet this week", "The first one takes the top spot.")
        case .friends: ("Just you so far", "Add friends on the Social tab to see how you stack up.")
        }
        return VStack(spacing: 6) {
            Art.icon(scope == .friends ? .people : .trophy, size: 26, tint: P.ink3)
            Text(title)
                .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                .foregroundStyle(P.ink2)
            Text(line)
                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink3)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }
}

// MARK: - the whole fifty

struct LeaderboardSheet: View {
    let initial: LeaderboardScope
    let myCode: String?

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss
    @State private var scope: LeaderboardScope
    @State private var boards: [LeaderboardScope: LeaderboardBoard]
    @State private var failed: Set<LeaderboardScope> = []
    @State private var profileOf: PlayerResult?

    init(initial: LeaderboardScope, boards: [LeaderboardScope: LeaderboardBoard], myCode: String?) {
        self.initial = initial
        self.myCode = myCode
        _scope = State(initialValue: initial)
        _boards = State(initialValue: boards)
    }

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(blurb)
                            .font(.system(size: 12.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .fixedSize(horizontal: false, vertical: true)

                        MMCard(padding: 14) {
                            VStack(alignment: .leading, spacing: 10) {
                                LeaderboardScopeSwitch(scope: $scope)
                                LeaderboardRows(scope: scope, board: boards[scope],
                                                failed: failed.contains(scope), myCode: myCode, limit: nil,
                                                retry: { Task { await load(scope) } },
                                                open: { profileOf = $0 })
                            }
                        }
                    }
                    .padding(16)
                }
                .onAppear { scrollToMine(proxy) }
                .onChange(of: boards[scope]) { scrollToMine(proxy) }
            }
            .navigationTitle("Leaderboard")
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
        .sheet(item: $profileOf) { seat in
            PlayerProfileSheet(seat: seat).environmentObject(store)
        }
        .task(id: scope) {
            if boards[scope] == nil { await load(scope) }
        }
    }

    private var blurb: String {
        switch scope {
        case .all: "Every game these players have ever won. Only wins get you on the board."
        case .week: "Wins since Monday — everybody starts again at zero every week."
        case .friends: "You and your friends, by games won. Tap anyone to see their career."
        }
    }

    /// Deep down the list, your own row is the one you opened this for — put
    /// it on screen instead of making them scroll.
    private func scrollToMine(_ proxy: ScrollViewProxy) {
        let rows = boards[scope]?.rows ?? []
        guard let i = rows.firstIndex(where: { isOwn($0, myCode) }), i >= 8 else { return }
        proxy.scrollTo(rows[i].id, anchor: .center)
    }

    private func load(_ which: LeaderboardScope) async {
        failed.remove(which)
        if let fresh = await LeaderboardBoard.fetch(which, store, attempts: 2) {
            boards[which] = fresh
        } else if boards[which] == nil, !Task.isCancelled {
            failed.insert(which)
        }
    }
}

// MARK: - one row

struct LeaderboardRow: View {
    let rank: Int
    let entry: LeaderboardEntry
    let isMe: Bool
    /// "all-time" or "this week" — what the winnings were counted over.
    var span: String = "all-time"
    /// The row opens a profile, and says so with a chevron.
    var opens = false

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
                    if let level = entry.level, level > 0 {
                        LevelChip(level: level)
                    }
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
                // A row made from a rank below the fifty knows no winnings;
                // it says where it stands instead.
                Text(entry.winnings.map { money($0) + " won, " + span } ?? "Rank \(rank + 1)")
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
            if opens {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .bold))
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
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
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
