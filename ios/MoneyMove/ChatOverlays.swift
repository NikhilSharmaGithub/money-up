// Chat + game-log sheet, the in-board auction box, and the game-over sheet.
// All three read the live GameState from the injected GameStore and only
// ever send intents back — the server stays authoritative.

import SwiftUI
import Charts

// MARK: - chat / log sheet

struct ChatLogSheet: View {
    var initialTab: Int = 0                 // 0 = chat, 1 = log

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @State private var tab: Int
    @State private var draft = ""
    @State private var channel = "all"      // "all" | "team"
    /// Whoever picked up the composer by hand. Ignored the moment that seat
    /// leaves the game, so a message can never go out wearing a ghost's name.
    @State private var chosenSeat: String?

    init(initialTab: Int = 0) {
        self.initialTab = initialTab
        _tab = State(initialValue: initialTab)
    }

    /// Every seat on this device still at the table, in seat order. Two or
    /// more means a pass & play phone is talking, and the composer has to say
    /// who — a guest's message used to go out wearing Player 1's name.
    private var localSpeakers: [PlayerState] {
        (store.state?.players ?? []).filter { store.isLocal($0.id) && !$0.isBankrupt }
    }

    /// The seat the composer speaks for: an explicit pick while that player is
    /// still at the table, otherwise the device's own primary seat — unless
    /// that seat is out and a guest still plays, in which case the player left
    /// standing does the talking rather than a knocked-out name.
    private var speakingSeat: String {
        if let chosen = chosenSeat, localSpeakers.contains(where: { $0.id == chosen }) { return chosen }
        if localSpeakers.isEmpty || localSpeakers.contains(where: { $0.id == store.meId }) {
            return store.meId
        }
        return localSpeakers[0].id
    }

    private var visibleChat: [ChatMessage] {
        // chatFeed folds in team lines only guest seats' sockets received, so
        // the channels have to be cut per speaker here rather than trusting
        // the server's per-viewer filter the way a one-seat phone can.
        let all = store.chatFeed
        guard store.hasTeamChat(for: speakingSeat), channel == "team" else {
            return all.filter { !$0.isTeam }
        }
        let team = store.state?.player(speakingSeat)?.team
        return all.filter { $0.isTeam && $0.team == team }
    }

    private var myTeam: TeamInfo? {
        store.state?.player(speakingSeat)?.team.flatMap { store.state?.teamInfo?[safe: $0] }
    }

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Section", selection: $tab) {
                    Text("Chat").tag(0)
                    Text("Log").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 14)
                .padding(.top, 10)
                .padding(.bottom, 6)

                if tab == 0 {
                    chatTab(P)
                } else {
                    logTab(P)
                }
            }
            .background(P.sheet)
            .navigationTitle(tab == 0 ? "Chat" : "Game log")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    // MARK: chat

    private func chatTab(_ P: Palette) -> some View {
        VStack(spacing: 0) {
            if store.hasTeamChat(for: speakingSeat) {
                channelSwitch(P)
            }

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        ForEach(visibleChat) { msg in
                            chatRow(msg, P).id(msg.id)
                        }
                        if visibleChat.isEmpty {
                            // An empty column of nothing reads as broken; say
                            // what the channel is for instead.
                            Text(channel == "team"
                                 ? "Only your team can read this channel. Plan away."
                                 : "Nothing said yet — tap a reaction below or type to start.")
                                .font(.system(size: 12.5, weight: .medium, design: .rounded))
                                .foregroundStyle(P.ink3)
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 26)
                        }
                    }
                    .padding(12)
                }
                .onAppear {
                    if let last = visibleChat.last?.id {
                        proxy.scrollTo(last, anchor: .bottom)
                    }
                }
                .onChange(of: visibleChat.last?.id) { _, new in
                    guard let new else { return }
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(new, anchor: .bottom)
                    }
                }
            }

            emoteRow(P)
            seatSwitcher(P)
            inputBar(P)
        }
        // A pick can't outlive its team channel: handing the composer to a
        // seat with no team while "Team only" is up would show an empty room.
        .onChange(of: speakingSeat) { _, seat in
            if channel == "team", !store.hasTeamChat(for: seat) { channel = "all" }
        }
    }

    /// One chip per local seat, shown only when the phone holds more than
    /// one — tap a chip and everything below it (reactions, text, send) speaks
    /// as that player. The same row the auction paddle wears.
    @ViewBuilder
    private func seatSwitcher(_ P: Palette) -> some View {
        let speakers = localSpeakers
        if speakers.count > 1 {
            HStack(spacing: 4) {
                SeatChipRow(seats: speakers, selected: speakingSeat) { chosenSeat = $0 }
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.top, 4)
        }
    }

    /// Everyone ↔ Team, coloured by the player's own team.
    private func channelSwitch(_ P: Palette) -> some View {
        let teamColor = myTeam.map { Color(css: $0.color) } ?? P.gold
        return HStack(spacing: 6) {
            channelChip(.globe, "Everyone", value: "all", tint: P.ink2, P: P)
            // The team's own colour carries which side you're on; the server's
            // coloured-circle emoji did the same job in someone else's artwork.
            channelChip(.shield, "Team only", value: "team", tint: teamColor, P: P)
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
    }

    private func channelChip(_ glyph: Glyph, _ label: String, value: String,
                             tint: Color, P: Palette) -> some View {
        let on = channel == value
        return Button {
            withAnimation(.snappy(duration: 0.2)) { channel = value }
            Haptics.tap()
        } label: {
            HStack(spacing: 5) {
                Art.icon(glyph, size: 13, tint: on ? tint : P.ink3)
                Text(label)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(on ? tint : P.ink3)
            }
                .padding(.vertical, 6)
                .padding(.horizontal, 11)
                .background(on ? tint.opacity(0.16) : P.sunken, in: Capsule())
                .overlay(Capsule().stroke(on ? tint.opacity(0.55) : .clear, lineWidth: 1))
        }
    }

    private func chatRow(_ msg: ChatMessage, _ P: Palette) -> some View {
        let teamColor = msg.team.flatMap { store.state?.teamInfo?[safe: $0] }.map { Color(css: $0.color) }
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 5) {
                if let flag = msg.flag, !flag.isEmpty {
                    Text(flag).font(.system(size: 12))
                }
                Text(msg.name)
                    .font(.system(size: 12.5, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(css: msg.color))
                    .lineLimit(1)
                if msg.isTeam {
                    Text("TEAM")
                        .font(.system(size: 7.5, weight: .black))
                        .kerning(0.5)
                        .fixedSize()
                        .foregroundStyle(teamColor ?? P.gold)
                        .padding(.vertical, 2)
                        .padding(.horizontal, 5)
                        .background((teamColor ?? P.gold).opacity(0.15), in: Capsule())
                }
            }
            Text(msg.text)
                .font(.system(size: 14.5, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(P.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(P.rule, lineWidth: 1)
        )
    }

    /// Quick reactions first — one tap sends the emoji as a normal message, so
    /// you can answer the table without ever leaving the board for long. The
    /// rest of the palette follows in the same scroll.
    private func emoteRow(_ P: Palette) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(MMStatic.reactions, id: \.self) { reaction in
                    emoteButton(reaction, size: 20, tint: P.goldSoft)
                }
                Rectangle()
                    .fill(P.rule)
                    .frame(width: 1, height: 20)
                    .padding(.horizontal, 2)
                ForEach(Array(MMStatic.emotes.dropFirst(MMStatic.reactions.count)), id: \.self) { emote in
                    emoteButton(emote, size: 18, tint: P.sunken)
                }
            }
            .padding(.horizontal, 12)
        }
        .padding(.vertical, 4)
    }

    private func emoteButton(_ emote: String, size: CGFloat, tint: Color) -> some View {
        Button {
            store.sendChat(emote, channel: channel, as: speakingSeat)
            Haptics.tap()
        } label: {
            Text(emote)
                .font(.system(size: size))
                .frame(width: 36, height: 36)
                .background(tint, in: Circle())
        }
    }

    private func inputBar(_ P: Palette) -> some View {
        HStack(spacing: 8) {
            TextField("Say something…", text: $draft)
                .font(.system(size: 15, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink)
                .padding(.vertical, 9)
                .padding(.horizontal, 14)
                .background(P.sunken, in: Capsule())
                .submitLabel(.send)
                .onSubmit(send)

            Button(action: send) {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(P.red, in: Circle())
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .padding(.bottom, 10)
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        store.sendChat(text, channel: channel, as: speakingSeat)
        draft = ""
    }

    // MARK: log

    private func logTab(_ P: Palette) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 9) {
                    ForEach(store.state?.log ?? []) { line in
                        logRow(line, P).id(line.id)
                    }
                }
                .padding(12)
            }
            .onAppear {
                if let last = store.state?.log.last?.id {
                    proxy.scrollTo(last, anchor: .bottom)
                }
            }
            .onChange(of: store.state?.log.last?.id) { _, new in
                guard let new else { return }
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(new, anchor: .bottom)
                }
            }
        }
    }

    private func logRow(_ line: LogLine, _ P: Palette) -> some View {
        let style = logStyle(line.kind, P)
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: style.symbol)
                .font(.system(size: style.size, weight: .semibold))
                .foregroundStyle(style.tint)
                .frame(width: 18)
            Text(line.text)
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func logStyle(_ kind: String, _ P: Palette) -> (symbol: String, tint: Color, size: CGFloat) {
        switch kind {
        case "dice":              ("die.face.5", .purple, 13)
        case "money":             ("dollarsign.circle", P.good, 13)
        case "rent":              ("house", P.bad, 13)
        case "buy":               ("cart", .blue, 13)
        case "turn":              ("play.fill", P.gold, 13)
        case "jail", "warn":      ("exclamationmark.triangle", .orange, 13)
        case "bankrupt":          ("xmark.octagon", P.bad, 13)
        case "auction", "trade":  ("hammer", P.gold, 13)
        case "system":            ("sparkles", P.red, 13)
        case "treasure":          ("gift", .orange, 13)
        case "surprise":          ("questionmark.circle", .pink, 13)
        case "build":             ("hammer.circle", .blue, 13)
        case "mortgage":          ("building.columns", P.ink3, 13)
        case "join", "leave":     ("person", P.ink3, 13)
        default:                  ("circle.fill", P.ink3, 6)
        }
    }
}

// MARK: - auction box (lives inside the board's centre well, ≈240pt square)

struct AuctionBox: View {
    let auction: AuctionState

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    /// Mirrors the server: the room opens on a 20s window, and every bid
    /// resets it to 12s. Measuring both against 20 made the bar jump back to
    /// two-thirds after a bid and read as "nearly out of time".
    private var windowSeconds: Double { auction.leader == nil ? 20 : 12 }

    /// Whoever picked up a paddle by hand. Cleared (or ignored) the moment
    /// that seat leaves the race, so it can never bid for a ghost.
    @State private var chosenSeat: String?

    /// Every seat on this device still in the race, in auction order. Two or
    /// more means a pass & play table is bidding from a single phone.
    private var localRacers: [String] {
        auction.inRace.filter { store.isLocal($0) && store.state?.player($0)?.isBankrupt != true }
    }

    /// The seat the paddle acts for: an explicit pick while it still races,
    /// otherwise the richest local seat that isn't already leading — the
    /// leader's bid is the one on the table, so the phone offers the paddle
    /// to whoever might still want to answer it. Pass & play used to speak
    /// only for the FIRST local seat, so the second human at the same phone
    /// had no way to bid or pass at all.
    private var biddingSeat: String? {
        let racers = localRacers
        if let chosen = chosenSeat, racers.contains(chosen) { return chosen }
        let trailing = racers.filter { $0 != auction.leader }
        let pool = trailing.isEmpty ? racers : trailing
        return pool.max {
            (store.state?.player($0)?.money ?? 0) < (store.state?.player($1)?.money ?? 0)
        }
    }

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 5) {
            HStack(spacing: 5) {
                Art.icon(.gavel, size: 12, tint: P.gold)
                Text("AUCTION")
                    .font(.system(size: 10, weight: .black, design: .rounded))
                    .kerning(1.5)
                    .foregroundStyle(P.gold)
            }

            Text(store.tile(auction.tile)?.name ?? "Property")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(P.ink)
                .lineLimit(1)

            Text(money(auction.bid))
                .font(.system(size: 26, weight: .heavy, design: .rounded))
                .foregroundStyle(P.gold)

            if let leader = store.state?.player(auction.leader) {
                Text("leading: \(leader.name)")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(css: leader.color))
                    .lineLimit(1)
            } else {
                Text("no bids yet")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            }

            countdownBar(P)

            seatSwitcher(P)

            bidControls(P)
        }
        .padding(.horizontal, 6)
        // A pick outlives its seat otherwise: drop it when the race changes
        // so the paddle falls back to a seat that is actually still bidding.
        .onChange(of: auction.inRace) { _, race in
            if let chosen = chosenSeat, !race.contains(chosen) { chosenSeat = nil }
        }
    }

    /// One chip per local seat still racing, shown only when the phone holds
    /// more than one. Tap a chip and the bid buttons below speak for that
    /// player. Compact on purpose — the whole row shares a 240pt well.
    @ViewBuilder
    private func seatSwitcher(_ P: Palette) -> some View {
        let racers = localRacers
        if racers.count > 1 {
            SeatChipRow(seats: racers.compactMap { store.state?.player($0) },
                        selected: biddingSeat) { chosenSeat = $0 }
        }
    }

    /// No deadline, no countdown: an auction at a table with nobody to wait
    /// for runs until it is settled, and a bar pinned at 0s would be a lie.
    @ViewBuilder
    private func countdownBar(_ P: Palette) -> some View {
        if let endsAt = auction.endsAt {
            TimelineView(.animation) { context in
                let now = context.date.timeIntervalSince1970
                let remaining = max(0, endsAt / 1000 - now)
                let fraction = min(1, remaining / windowSeconds)
                HStack(spacing: 7) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(P.sunken)
                            Capsule().fill(remaining <= 5 ? P.bad : P.gold)
                                .frame(width: max(0, geo.size.width * fraction))
                        }
                    }
                    .frame(height: 5)
                    // Every other clock in the game shows a number; this one used
                    // to be a bar you had to guess at.
                    Text("\(Int(ceil(remaining)))s")
                        .font(.system(size: 10.5, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(remaining <= 5 ? P.bad : P.ink3)
                        .fixedSize()
                }
            }
            .frame(height: 14)
            .padding(.vertical, 2)
        }
    }

    @ViewBuilder
    private func bidControls(_ P: Palette) -> some View {
        if let seat = biddingSeat {
            let next = auction.bid == 0 ? 10 : auction.bid + 10
            // Mirrors the server's escrow rule: the leading bid already left
            // the leader's wallet, so their real ceiling is cash in hand plus
            // the money sitting on the table.
            let cash = store.state?.player(seat)?.money ?? 0
            let purse = cash + (auction.leader == seat ? auction.bid : 0)
            let amounts = [next, next + 40, next + 90].filter { $0 <= purse }

            VStack(spacing: 5) {
                // Say whose paddle this is when it isn't the primary seat's.
                // With two racers the chips above already name the bidder.
                if localRacers.count < 2, seat != store.meId, let p = store.state?.player(seat) {
                    Text("bidding as \(p.name)")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(css: p.color))
                        .lineLimit(1)
                }
                if amounts.isEmpty {
                    Text("\(money(next)) is out of reach — you can only pass.")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .multilineTextAlignment(.center)
                } else {
                    HStack(spacing: 6) {
                        ForEach(amounts, id: \.self) { amount in
                            Button(money(amount)) {
                                store.bid(amount, as: seat)
                                Haptics.tap()
                            }
                            .buttonStyle(CompactAuctionButtonStyle(bg: P.gold))
                        }
                    }
                }
                Button("Pass") { store.passBid(as: seat) }
                    .buttonStyle(CompactAuctionButtonStyle(bg: P.bad))
            }
        } else {
            Text("you're out")
                .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink3)
        }
    }
}

// MARK: - pass & play seat chips

/// One compact chip per local seat. The auction paddle and the chat composer
/// wear this exact row, so picking who a pass & play phone speaks for reads
/// the same everywhere it comes up.
private struct SeatChipRow: View {
    let seats: [PlayerState]
    /// The seat currently being spoken for — its chip draws filled.
    let selected: String?
    let choose: (String) -> Void

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        HStack(spacing: 4) {
            ForEach(seats) { p in
                chip(p, selected: p.id == selected, P)
            }
        }
    }

    private func chip(_ p: PlayerState, selected: Bool, _ P: Palette) -> some View {
        Button {
            choose(p.id)
            Haptics.tap()
        } label: {
            HStack(spacing: 3) {
                ZStack {
                    Circle().fill(Color(css: p.color))
                    Text(String(p.name.prefix(1)).uppercased())
                        .font(.system(size: 8, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                }
                .frame(width: 13, height: 13)
                Text(p.name)
                    .font(.system(size: 9.5, weight: .bold, design: .rounded))
                    .foregroundStyle(selected ? P.ink : P.ink3)
                    .lineLimit(1)
            }
            .padding(.vertical, 3)
            .padding(.horizontal, 6)
            .background(selected ? P.sunken : .clear, in: Capsule())
            .overlay(
                Capsule().stroke(selected ? Color(css: p.color) : P.rule, lineWidth: selected ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
    }
}

/// Tighter sibling of MMButtonStyle so three bid buttons + pass fit the well.
private struct CompactAuctionButtonStyle: ButtonStyle {
    let bg: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .padding(.vertical, 6)
            .padding(.horizontal, 11)
            .background(bg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(.white.opacity(0.18), lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.82 : 1)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(duration: 0.2), value: configuration.isPressed)
    }
}

// MARK: - game over sheet

struct GameOverSheet: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    Art.icon(.trophy, size: 46)
                        .padding(.top, 8)

                    winnerHeadline(P)

                    rematchAction(P)

                    shareAction()

                    worthChartCard(P)

                    // The same report card History shows later — standings,
                    // titles, stats — so nobody's result changes in the retelling.
                    let results = PlayerResult.snapshot(of: store.state)
                    ResultStandingsCard(results: results)
                    ResultTitlesCard(results: results)
                    ResultStatsCard(results: results)

                    Button("Leave room") {
                        store.leaveRoom()   // RootView switches screens on roomId = nil
                    }
                    .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                }
                .padding(16)
            }
            .background(P.sheet)
            .navigationTitle("Game over")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await askForSomething() }
    }

    // MARK: - the two things the app asks for

    /// A win is the one honest moment to ask for a review, and the end of a
    /// finished game the one honest moment to ask about notifications. Both
    /// wait for the result to be on screen first — a system sheet that lands
    /// before the standings do reads as an ambush.
    private func askForSomething() async {
        if ReviewPrompt.shouldAsk(won: iWon) {
            try? await Task.sleep(for: .milliseconds(700))
            ReviewPrompt.ask()
            return
        }
        // A table we only watched is nobody's good moment — the ask is a
        // reward for finishing a game, and this device didn't play one.
        guard iPlayed else { return }
        // Never in the same breath as the review prompt — and by construction
        // it can't be: the second win is at least the second finished game,
        // and this ask is spent on the first.
        try? await Task.sleep(for: .milliseconds(1200))
        await PushRegistrar.shared.askAfterFirstGame()
    }

    // MARK: - sharing the result

    /// A seat this device actually played took the game — on a team table,
    /// the team taking it counts, because that seat won too. The same rule
    /// GameStore counts lifetime wins by, asked once and answered once.
    private var iWon: Bool {
        store.state.map(store.localSeatWon) ?? false
    }

    /// Was this device at the table at all, or only in the stands?
    private var iPlayed: Bool {
        store.state?.players.contains { store.localIds.contains($0.id) } ?? false
    }

    /// What the win was worth: the best seat this device actually held. Only
    /// ever read on a win, where that seat is a winning one — and on a team
    /// table it quotes your own fortune rather than your partner's, because
    /// "I won" is a sentence about you.
    private var winningWorth: Int {
        guard let state = store.state else { return 0 }
        return state.players.filter { store.localIds.contains($0.id) }
            .compactMap(\.netWorth).max() ?? 0
    }

    /// Whoever it was that took it, named the way the headline above names
    /// them — a team by its team name, anyone else by theirs.
    private var winnerLabel: String {
        if let idx = store.state?.winningTeam,
           let team = store.state?.teamInfo?[safe: idx] { return "Team \(team.name)" }
        return store.state?.winner?.name ?? "Somebody"
    }

    /// The same link the web client reads `?room=` off, so a friend who taps
    /// it lands at this table in a browser with no install in the way. The
    /// room code is public by design; no token ever rides along.
    private var shareText: String {
        let room = store.roomId ?? ""
        let link = "https://www.moneymove.live/?room=\(room)"
        guard iWon else {
            // Losing is worth sharing too — but never as a win we didn't take.
            return "\(winnerLabel) just took me down on MoneyMove — get me back: \(link)"
        }
        return "I won \(money(winningWorth)) on MoneyMove — beat me: \(link)"
    }

    /// One tap out of the app with the room code attached — the fastest way a
    /// finished game turns into the next one.
    private func shareAction() -> some View {
        ShareLink(item: shareText) {
            HStack(spacing: 8) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 15, weight: .bold))
                Text(iWon ? "Brag about it" : "Share the table")
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
    }

    /// The table is already assembled — running it back is one tap, and it
    /// sits directly under the result where everyone is still looking.
    @ViewBuilder
    private func rematchAction(_ P: Palette) -> some View {
        // Anyone can call the next game — whoever presses first takes the
        // host chair, and the server hands them the lobby.
        VStack(spacing: 5) {
            // Dark until the server turns ads on — then a win can double up.
            if store.adsConfig?.enabled == true, store.state?.winner?.id == store.meId {
                MMIconButton(.coin, "Watch an ad — double your winnings", kind: .primary, big: true) {
                    store.showToast("Rewarded ads are not live yet")
                }
            }
            if store.state?.quick == true {
                // A matchmade table doesn't reconvene: offering "the same
                // players" would tell the room the seats were never strangers.
                MMIconButton(.replay, "Play again", kind: .primary, big: true) {
                    Haptics.tap()
                    dismiss()
                    store.leaveRoom()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { store.quickPlay() }
                }
                Text("Finds you a fresh table.")
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            } else {
                MMIconButton(.replay, "Play again with the same players", kind: .primary, big: true) {
                    store.rematch()
                    Haptics.tap()
                    dismiss()
                }
                if !store.isHost {
                    Text("First to press it hosts the next one.")
                        .font(.system(size: 11.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                }
            }
        }
    }

    @ViewBuilder
    private func winnerHeadline(_ P: Palette) -> some View {
        if let teamIdx = store.state?.winningTeam,
           let team = store.state?.teamInfo?[safe: teamIdx] {
            Text("Team \(team.name) wins!")
                .font(.system(size: 22, weight: .heavy, design: .rounded))
                .foregroundStyle(Color(css: team.color))
                .multilineTextAlignment(.center)
        } else if let winner = store.state?.winner {
            Text("\(winner.name) wins!")
                .font(.system(size: 22, weight: .heavy, design: .rounded))
                .foregroundStyle(Color(css: winner.color))
                .multilineTextAlignment(.center)
        } else {
            Text("Game over")
                .font(.system(size: 22, weight: .heavy, design: .rounded))
                .foregroundStyle(P.ink)
        }
    }

    // MARK: net worth over time

    /// richup-style step chart of everyone's net worth, plus a marker on the
    /// turn where the winner grabbed the lead for good — where the game turned.
    @ViewBuilder
    private func worthChartCard(_ P: Palette) -> some View {
        let history = store.state?.history ?? []
        let players = store.state?.players ?? []

        if history.count >= 3, !players.isEmpty {
            MMCard {
                VStack(alignment: .leading, spacing: 10) {
                    PanelTitle("Net worth over time")

                    Chart {
                        ForEach(players) { p in
                            ForEach(history, id: \.t) { pt in
                                LineMark(
                                    x: .value("Turn", pt.t),
                                    y: .value("Net worth", pt.w[p.id] ?? 0),
                                    series: .value("Player", p.id)
                                )
                                .foregroundStyle(Color(css: p.color).opacity(p.id == winnerId ? 1 : 0.75))
                                .interpolationMethod(.stepEnd)
                                .lineStyle(StrokeStyle(lineWidth: p.id == winnerId ? 2.5 : 1.8, lineCap: .round))
                            }
                        }

                        if let flip = turningPoint {
                            RuleMark(x: .value("Turn", flip))
                                .foregroundStyle(P.gold.opacity(0.7))
                                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                                .annotation(position: .top, alignment: .leading) {
                                    HStack(spacing: 3) {
                                        Art.icon(.crown, size: 10)
                                        Text("game turned here")
                                            .font(.system(size: 9, weight: .bold, design: .rounded))
                                            .foregroundStyle(P.gold)
                                    }
                                }
                        }
                    }
                    .chartXAxis {
                        AxisMarks(values: .automatic(desiredCount: 5)) { _ in
                            AxisGridLine().foregroundStyle(P.rule)
                            AxisValueLabel()
                                .font(.system(size: 9, weight: .medium))
                                .foregroundStyle(P.ink3)
                        }
                    }
                    .chartYAxis {
                        AxisMarks(values: .automatic(desiredCount: 4)) { value in
                            AxisGridLine().foregroundStyle(P.rule)
                            AxisValueLabel {
                                if let v = value.as(Int.self) {
                                    Text("$\(v >= 1000 ? "\(v / 1000)k" : "\(v)")")
                                        .font(.system(size: 9, weight: .medium))
                                        .foregroundStyle(P.ink3)
                                }
                            }
                        }
                    }
                    .chartXAxisLabel(alignment: .trailing) {
                        Text("turn")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(P.ink3)
                    }
                    .frame(height: 190)

                    // legend
                    HStack(spacing: 12) {
                        ForEach(players) { p in
                            HStack(spacing: 4) {
                                Circle().fill(Color(css: p.color)).frame(width: 7, height: 7)
                                Text(p.name)
                                    .font(.system(size: 10.5, weight: .bold, design: .rounded))
                                    .foregroundStyle(P.ink2)
                                    .lineLimit(1)
                                if p.id == winnerId {
                                    Art.icon(.crown, size: 10)
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private var winnerId: String? { store.state?.winner?.id }

    /// First turn of the winner's final, unbroken stretch on top.
    private var turningPoint: Int? {
        guard let winnerId, let history = store.state?.history, history.count >= 3 else { return nil }
        var flip: Int? = nil
        for pt in history {
            let winnerWorth = pt.w[winnerId] ?? 0
            let best = pt.w.values.max() ?? 0
            if winnerWorth >= best {
                if flip == nil { flip = pt.t }
            } else {
                flip = nil
            }
        }
        // Leading from turn one isn't a turning point — no marker then.
        return flip == history.first?.t ? nil : flip
    }

}
