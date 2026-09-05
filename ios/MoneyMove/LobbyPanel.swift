// The panel under the board while the room sits in the lobby: start/settings
// controls, the seat list with team + kick actions, empty seats the host can
// fill with bots, and the player's own appearance (name, colour, and the
// piece they play as).

import SwiftUI

struct LobbyPanel: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    let openSettings: () -> Void

    @State private var nameDraft = ""
    /// Single-nation boards for the Custom menu, loaded from /api/maps.
    @State var countryBoards: [MapSummary] = []
    @State var flagImages: [String: Image] = [:]

    var body: some View {
        let P = Palette.current(scheme)
        ScrollView {
            VStack(spacing: 10) {
                if store.isHost {
                    Button("▶  Start Game") { store.start() }
                        .buttonStyle(MMButtonStyle(kind: .primary, big: true))
                } else {
                    HStack(spacing: 8) {
                        ProgressView().tint(P.red).scaleEffect(0.8)
                        Text("waiting for the host…")
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink3)
                    }
                    .padding(.top, 2)
                }

                if isCup { cupBanner(P) }

                if store.isHost, !isCup { quickBoards(P) }

                // A cup table is set by the cup: two chairs, one board, no
                // house players, and a second seat on this device would be
                // sitting in your opponent's chair. The server refuses all of
                // it; this is so nobody is invited to try.
                if !isCup, store.state?.players.count ?? 0 < store.state?.settings.maxPlayers ?? 0 {
                    MMIconButton(.people, "Add player on this device", kind: .ghost, big: true) {
                        store.addLocalPlayer()
                    }
                }

                if !isCup {
                    MMIconButton(.toolbox, "Game settings", kind: .ghost, big: true) { openSettings() }
                }

                seatList(P)

                if store.isHost, teamCount > 0 {
                    Button("⇄  Balance teams") { store.balanceTeams() }
                        .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                }

                appearanceSection(P)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
        .scrollBounceBehavior(.basedOnSize)
        .onAppear { nameDraft = store.me?.name ?? store.nickname }
    }

    private var teamCount: Int { store.state?.settings.teams ?? 0 }

    /// A table the cup made, rather than one somebody opened.
    private var isCup: Bool { store.state?.cup == true }

    /// What this table is and what is riding on it. A cup match looks exactly
    /// like any other two-player game otherwise, and losing one costs more.
    private func cupBanner(_ P: Palette) -> some View {
        HStack(spacing: 9) {
            Art.icon(.trophy, size: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text("Cup match")
                    .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink)
                Text(emptySeats > 0
                     ? "Waiting for the player drawn against you"
                     : "Winner goes through. Loser is out of the cup.")
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
            Spacer(minLength: 4)
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(P.goldSoft, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(P.gold, lineWidth: 1))
    }

    private var emptySeats: Int {
        guard let state = store.state else { return 0 }
        return max(0, state.settings.maxPlayers - state.players.count)
    }

    // MARK: - seats

    @ViewBuilder private func seatList(_ P: Palette) -> some View {
        VStack(spacing: 8) {
            ForEach(store.state?.players ?? []) { p in
                playerRow(p, P)
            }
            ForEach(0..<emptySeats, id: \.self) { _ in
                emptySeatRow(P)
            }
        }
    }

    private func playerRow(_ p: PlayerState, _ P: Palette) -> some View {
        let team = p.team.flatMap { store.state?.teamInfo?[safe: $0] }
        let canCycleTeam = teamCount > 0 && (p.id == store.meId || (store.isHost && p.isBot == true))
        let canKick = store.isHost && p.id != store.meId && !isCup

        return HStack(spacing: 10) {
            AvatarView(name: p.name, colorCSS: p.color, flag: p.flag ?? "", size: 34, emoji: p.avatar ?? "")

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(p.name)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(P.ink)
                        .lineLimit(1)
                    if p.id == store.state?.hostId { tag("HOST", P.gold) }
                    if p.isBot == true { tag("BOT", P.ink3) }
                    if p.id == store.meId { tag("YOU", P.red) }
                }
                HStack(spacing: 6) {
                    Text(money(p.money))
                        .font(.system(size: 12.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.good)
                    if teamCount > 0, let team {
                        Text(team.name)
                            .font(.system(size: 10, weight: .black, design: .rounded))
                            .foregroundStyle(Color(css: team.color))
                            .padding(.vertical, 2)
                            .padding(.horizontal, 7)
                            .background(Color(css: team.color).opacity(0.16), in: Capsule())
                    }
                }
            }

            Spacer(minLength: 6)

            if canCycleTeam {
                Button("⇄") { store.setTeam(((p.team ?? -1) + 1) % teamCount, for: p.id) }
                    .buttonStyle(MMButtonStyle(kind: .ghost))
            }
            // The chair travels: a host can hand it to anyone at the table.
            if store.isHost, p.id != store.meId, !(p.isBot ?? false), p.connected != false,
               store.state?.quick != true {
                Button("Host") { store.makeHost(p.id); Haptics.tap() }
                    .buttonStyle(MMButtonStyle(kind: .ghost))
            }
            if canKick {
                Button("✕") { store.kick(p.id) }
                    .buttonStyle(MMButtonStyle(kind: .ghost))
            }
        }
        .padding(10)
        .background(P.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(P.rule, lineWidth: 1))
    }

    private func emptySeatRow(_ P: Palette) -> some View {
        HStack {
            Text("Empty seat")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink3)
            Spacer()
            if store.isHost, !isCup {
                Button("Add bot") { store.addBot() }
                    .buttonStyle(MMButtonStyle(kind: .ghost))
            }
        }
        .padding(10)
        .frame(minHeight: 44)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(P.rule2, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        )
    }

    private func tag(_ text: String, _ color: Color) -> some View {
        Text(text)
            .font(.system(size: 8, weight: .black))
            .foregroundStyle(color)
    }

    // MARK: - your look

    private func appearanceSection(_ P: Palette) -> some View {
        let taken = Set(
            (store.state?.players ?? [])
                .filter { $0.id != store.meId }
                .map { $0.color.lowercased() }
        )
        let myColor = store.me?.color.lowercased()
        let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 8)

        return VStack(alignment: .leading, spacing: 10) {
            PanelTitle("Your look")

            TextField("Nickname", text: $nameDraft)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit {
                    let trimmed = nameDraft.trimmingCharacters(in: .whitespaces)
                    guard !trimmed.isEmpty else { return }
                    store.setAppearance(name: trimmed)
                }
                .padding(.vertical, 9)
                .padding(.horizontal, 12)
                .background(P.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(MMStatic.playerColors, id: \.self) { css in
                    let isTaken = taken.contains(css.lowercased())
                    let isMine = css.lowercased() == myColor
                    Button {
                        store.setAppearance(color: css)
                    } label: {
                        Circle()
                            .fill(Color(css: css))
                            .frame(width: 26, height: 26)
                            .overlay(
                                Circle()
                                    .stroke(isMine ? P.ink : .clear, lineWidth: 2)
                                    .padding(-3.5)
                            )
                            .opacity(isTaken ? 0.25 : 1)
                    }
                    .disabled(isTaken)
                }
            }
            .padding(.top, 2)

            // The colour above is half of what a player sees of themselves on
            // the board; the piece sitting in it is the other half, so it gets
            // chosen here rather than two screens away in the Store.
            Rectangle()
                .fill(P.rule)
                .frame(height: 1)
                .padding(.top, 2)

            PiecePicker()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(P.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(P.rule, lineWidth: 1))
    }
}


// MARK: - quick match waiting room

/// A matchmade table that hasn't dealt itself in yet. There are no host
/// controls to offer here, so the panel says the only two things that matter:
/// who has landed so far, and how long the table waits.
struct QuickMatchPanel: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        let players = store.state?.players ?? []
        let seats = max(players.count, store.state?.settings.maxPlayers ?? players.count)

        VStack(spacing: 12) {
            // The table spends most of its fuse actually looking for people
            // and only the last few seconds filling the chairs nobody took.
            // Saying which is happening is the difference between "nobody
            // came" and a table that quietly padded itself out while claiming
            // to search.
            TimelineView(.periodic(from: .now, by: 0.5)) { context in
                let left = store.state?.quickStartAt.map {
                    TurnClock.secondsLeft($0, at: context.date)
                } ?? 99
                HStack(spacing: 9) {
                    ProgressView().tint(P.red).scaleEffect(0.9)
                    Text(left > 5 ? "Finding players…" : "Filling the table…")
                        .font(.system(size: 18, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                }
            }
            .padding(.top, 4)

            if let startAt = store.state?.quickStartAt {
                countdown(startAt, P)
            }

            seatRow(players: players, seats: seats, P)

            Text("\(players.count) of \(seats) seated")
                .font(.system(size: 12.5, weight: .bold, design: .rounded))
                .foregroundStyle(P.ink2)

            TableTalkTicker()

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 18)
    }

    /// Counts down to the server's deadline the same way the turn clock does,
    /// so a late join sees the real number rather than a fresh 20.
    private func countdown(_ startAt: Double, _ P: Palette) -> some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { context in
            let left = TurnClock.secondsLeft(startAt, at: context.date)
            VStack(spacing: 1) {
                Text(left > 0 ? "\(left)" : "…")
                    .font(.system(size: 42, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(P.gold)
                    .contentTransition(.numericText(countsDown: true))
                    .animation(.snappy(duration: 0.2), value: left)
                Text(left > 0 ? "seconds to kick-off" : "dealing you in")
                    .font(.system(size: 10.5, weight: .bold))
                    .kerning(1)
                    .foregroundStyle(P.ink3)
            }
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
            .background(P.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(P.gold.opacity(0.5), lineWidth: 1))
        }
    }

    private func seatRow(players: [PlayerState], seats: Int, _ P: Palette) -> some View {
        HStack(spacing: 8) {
            ForEach(players) { p in
                VStack(spacing: 3) {
                    AvatarView(name: p.name, colorCSS: p.color, flag: p.flag ?? "", size: 38, emoji: p.avatar ?? "")
                    Text(store.isLocal(p.id) ? "You" : p.name)
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(P.ink2)
                        .lineLimit(1)
                }
                .frame(width: 54)
                .transition(.scale.combined(with: .opacity))
            }
            ForEach(0..<max(0, seats - players.count), id: \.self) { _ in
                VStack(spacing: 3) {
                    Circle()
                        .stroke(P.rule2, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                        .frame(width: 38, height: 38)
                    Text("open")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                }
                .frame(width: 54)
            }
        }
        .animation(.spring(duration: 0.35), value: players.count)
    }
}

/// The waiting room's small talk: gameplay tips and city facts dealt
/// alternately while the clock runs. One fetch serves the whole app run —
/// every lobby appearance shares it — and a table that can't reach the
/// server keeps the old static sentence.
private struct TableTalkTicker: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @State private var tips: [String] = []
    @State private var facts: [String] = []
    @State private var index = 0

    private static let fallback =
        "The table deals itself in when the clock runs out — every seat gets filled either way."

    private struct TipsFile: Decodable {
        struct Fact: Decodable { var city: String; var text: String }
        var facts: [Fact]
        var tips: [String]
    }

    /// Concurrent appearances await the same fetch instead of racing it.
    @MainActor private static var fetch: Task<TipsFile?, Never>?

    var body: some View {
        let P = Palette.current(scheme)
        // The task hangs on the stack, not the text — the .id swap that
        // drives the fade tears the text down each beat, and would take the
        // timer (and the shuffle) with it. The stack also keeps the outgoing
        // line layered under the incoming one instead of beside it.
        ZStack {
            Text(line)
                .font(.system(size: 12.5, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink3)
                .multilineTextAlignment(.center)
                .id(index)
                .transition(.opacity)
        }
        .task { await deal() }
    }

    /// Even beats deal a tip, odd beats a fact; either pile alone still cycles.
    private var line: String {
        if tips.isEmpty && facts.isEmpty { return Self.fallback }
        if facts.isEmpty || (index.isMultiple(of: 2) && !tips.isEmpty) {
            return tips[(index / 2) % tips.count]
        }
        return facts[(index / 2) % facts.count]
    }

    @MainActor private func deal() async {
        if Self.fetch == nil {
            let store = store
            Self.fetch = Task { try? await store.fetchJSON("/data/tips.json") }
        }
        if let file = await Self.fetch?.value {
            tips = file.tips.shuffled()
            facts = file.facts.shuffled().map { "\($0.city) — \($0.text)" }
        } else {
            // A miss stays the fallback for this sitting, but shouldn't be
            // cached as the answer for the whole app run.
            Self.fetch = nil
        }
        // Nothing arrived — the fallback line needs no rotation.
        guard !tips.isEmpty || !facts.isEmpty else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled else { break }
            withAnimation(.easeInOut(duration: 0.45)) { index += 1 }
        }
    }
}

// MARK: - lobby extras

extension LobbyPanel {
    /// One-tap boards in the lobby: Classic, Worldwide, Death Valley — and
    /// last, Custom: a menu of the single-nation boards (each with its own
    /// regions and localized Treasure & Surprise deck) plus Shuffle, which
    /// deals a brand new board every game.
    @ViewBuilder func quickBoards(_ P: Palette) -> some View {
        let picks: [(String, Glyph, String)] = [
            ("classic", .globe, "Classic"),
            ("worldwide", .plane, "Worldwide"),
            ("deathvalley", .skull, "Death Valley"),
        ]
        HStack(spacing: 8) {
            ForEach(picks, id: \.0) { id, icon, name in
                let selected = store.state?.settings.mapId == id || store.state?.mapId == id
                Button {
                    SoundKit.shared.click()
                    store.updateSettings(["mapId": id])
                } label: {
                    quickChip(icon: icon, name: name, selected: selected, P: P)
                }
            }
            customBoardMenu(P)
        }
        .task { await loadCountryBoards() }
    }

    /// Everything that isn't a one-tap board: the single-nation boards, each
    /// under its own flag, and Shuffle at the bottom.
    @ViewBuilder private func customBoardMenu(_ P: Palette) -> some View {
        let currentId = store.state?.mapId ?? store.state?.settings.mapId ?? ""
        let selected = currentId.hasPrefix("country-") || currentId == "random"
        let current = countryBoards.first { $0.id == currentId }

        Menu {
            ForEach(countryBoards) { map in
                Button {
                    SoundKit.shared.click()
                    store.updateSettings(["mapId": map.id])
                } label: {
                    // A menu row takes an Image but not an arbitrary view, so
                    // each flag is rendered once and handed over as one.
                    Label {
                        Text(map.name)
                    } icon: {
                        if map.id == currentId {
                            Image(systemName: "checkmark")
                        } else if let flag = flagImages[map.id] {
                            flag
                        }
                    }
                }
            }
            if countryBoards.isEmpty {
                Text("Loading countries…")
            }
            Divider()
            Button {
                SoundKit.shared.click()
                store.updateSettings(["mapId": "random"])
            } label: {
                Label("Shuffle — a new board every game",
                      systemImage: currentId == "random" ? "checkmark" : "dice")
            }
        } label: {
            quickChip(icon: currentId == "random" ? .dice : mapGlyph(current?.icon),
                      name: selected ? (currentId == "random" ? "Shuffle" : (current?.name ?? "Custom")) : "Custom",
                      selected: selected, P: P)
        }
    }

    /// The drawn flags, rasterised once so SwiftUI's menu can carry them.
    @MainActor private func renderFlags() {
        for map in countryBoards where flagImages[map.id] == nil {
            let renderer = ImageRenderer(content:
                GroupFlag(mark: map.icon ?? "", colour: .clear, size: 22))
            renderer.scale = 3
            if let ui = renderer.uiImage {
                flagImages[map.id] = Image(uiImage: ui).renderingMode(.original)
            }
        }
    }

    private func quickChip(icon: Glyph, name: String, selected: Bool, P: Palette) -> some View {
        VStack(spacing: 3) {
            Art.icon(icon, size: 22, tint: selected ? P.red : P.ink2)
            Text(name)
                .font(.system(size: 10.5, weight: .bold, design: .rounded))
                .foregroundStyle(selected ? P.red : P.ink2)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 9)
        .background(selected ? P.redSoft : P.sunken,
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(selected ? P.red : Color.clear, lineWidth: 1.5)
        )
    }

    private func loadCountryBoards() async {
        guard countryBoards.isEmpty else { return }
        let maps: [MapSummary]? = try? await store.fetchJSON("/api/maps")
        countryBoards = (maps ?? []).filter { $0.country == true }
        renderFlags()
    }
}
