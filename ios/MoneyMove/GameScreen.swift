// The in-room screen: player strip on top, the board in the middle with a
// live centre well, and a context panel underneath that changes with the
// phase — lobby controls, turn actions, debt rescue, trade offers.

import SwiftUI

enum ActiveSheet: Identifiable {
    case deed(Int)
    case properties
    case trade(from: String, to: String, give: Set<Int>, want: Set<Int>)  // proposing seat → target
    case tradePicker(from: String, give: Set<Int>)        // choose who to trade with first
    case counter(TradeOffer)                              // negotiate an incoming offer
    case chatLog(Int)       // initial tab: 0 chat, 1 log
    case settings
    case gameOver

    var id: String {
        switch self {
        case .deed(let i): "deed-\(i)"
        case .properties: "properties"
        case .trade(let f, let t, _, _): "trade-\(f)-\(t)"
        case .tradePicker(let f, _): "tradepicker-\(f)"
        case .counter(let t): "counter-\(t.id)"
        case .chatLog(let t): "chatlog-\(t)"
        case .settings: "settings"
        case .gameOver: "gameover"
        }
    }
}

struct GameScreen: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var sheet: ActiveSheet?
    @State private var confirmLeave = false

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 10) {
            topBar(P)

            if store.state != nil {
                if hSize == .regular, store.state?.isLobby == true {
                    // iPad lobby: the board previews left, setup lives right.
                    HStack(alignment: .top, spacing: 14) {
                        VStack(spacing: 0) {
                            BoardView(onTapTile: { sheet = .deed($0) }) {
                                CenterWell()
                            }
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                        VStack(spacing: 10) {
                            bottomPanel
                        }
                        .frame(width: 380)
                    }
                    .padding(.horizontal, 12)
                } else if hSize == .regular {
                    // iPad in play is a tabletop: the board sits huge in the
                    // middle with the whole dock INSIDE its centre well — the
                    // dice and buttons live where everyone around the table can
                    // see them — plus a roll control pinned to each corner of
                    // the screen so whoever sits on that side can reach one.
                    ZStack {
                        VStack(spacing: 10) {
                            // The strip stays out of the corners — those belong
                            // to the players' own pods.
                            PlayerStrip(sideInset: 196, onTapPlayer: { p in
                                if store.state?.isPlaying == true, p.id != store.meId, !p.isBankrupt,
                                   store.me?.isBankrupt != true {
                                    sheet = .trade(from: store.activeId, to: p.id, give: [], want: [])
                                }
                            })
                            .padding(.horizontal, 196)

                            AwaitingSeatsCard()
                                .padding(.horizontal, 196)

                            BoardView(onTapTile: { sheet = .deed($0) }) {
                                CenterWell(actionsInWell: true,
                                           openProperties: { sheet = .properties },
                                           openTrade: { sheet = .tradePicker(from: store.activeId, give: []) },
                                           openHistory: { sheet = .chatLog(1) },
                                           openCounter: { sheet = .counter($0) },
                                           openResults: { sheet = .gameOver })
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .padding(.horizontal, 12)

                            Spacer(minLength: 6)
                        }

                        CornerPods(openTrade: { from in
                            sheet = .tradePicker(from: from, give: [])
                        })
                    }
                } else if store.state?.isLobby == true {
                    PlayerStrip(onTapPlayer: { _ in })
                    BoardView(onTapTile: { sheet = .deed($0) }) {
                        CenterWell()
                    }
                    .padding(.horizontal, 6)
                    bottomPanel
                } else {
                    // Two zones: the board high, and one control cluster at the
                    // bottom — player strip directly above the action dock, no
                    // orphaned bands floating in between.
                    BoardView(onTapTile: { sheet = .deed($0) }) {
                        CenterWell(openHistory: { sheet = .chatLog(1) })
                    }
                    .padding(.horizontal, 6)
                    .padding(.top, 2)

                    Spacer(minLength: 10)

                    PlayerStrip(onTapPlayer: { p in
                        if store.state?.isPlaying == true, p.id != store.meId, !p.isBankrupt,
                           store.me?.isBankrupt != true {
                            sheet = .trade(from: store.activeId, to: p.id, give: [], want: [])
                        }
                    })

                    bottomPanel
                }
            } else {
                Spacer()
                ProgressView().tint(P.red)
                Text(connectionLabel)
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                if let err = store.joinError {
                    Text(err).font(.system(size: 13)).foregroundStyle(P.bad)
                }
                Spacer()
            }
        }
        .padding(.top, 4)
        .sheet(item: $sheet) { which in
            Group {
                switch which {
                case .deed(let i): DeedSheet(tileIndex: i)
                case .properties: PropertiesSheet(
                    openTrade: { give in
                        sheet = .tradePicker(from: store.activeId, give: give)
                    },
                    askFor: { target, want in
                        sheet = .trade(from: store.activeId, to: target, give: [], want: want)
                    })
                case .trade(let from, let target, let give, let want):
                    TradeSheet(fromId: from, targetId: target, preselectedGive: give, preselectedGet: want)
                case .counter(let trade):
                    TradeSheet(countering: trade)
                case .tradePicker(let from, let give):
                    TradePickerSheet(fromId: from, give: give,
                                     pick: { sheet = .trade(from: from, to: $0, give: give, want: []) })
                case .chatLog(let tab): ChatLogSheet(initialTab: tab)
                case .settings: SettingsSheet()
                case .gameOver: GameOverSheet()
                }
            }
            .environmentObject(store)
        }
        .onChange(of: store.showGameOver) { _, over in
            if over {
                // Whatever sheet was open when the last player fell, the result
                // is the thing to look at — and SwiftUI will not swap one sheet
                // for another in the same frame, so close first, present after.
                if sheet != nil {
                    sheet = nil
                    Task {
                        try? await Task.sleep(for: .milliseconds(350))
                        if store.showGameOver { sheet = .gameOver }
                    }
                } else {
                    sheet = .gameOver
                }
            } else if sheet?.id == ActiveSheet.gameOver.id {
                // A rematch puts the room back in the lobby; the old result
                // must not stay up over the new table.
                sheet = nil
            }
        }
        .onChange(of: store.timedOut) { _, out in
            // The overlay lives under presented sheets, so a deed sheet left
            // open would bury the only two buttons it offers.
            if out { sheet = nil }
        }
        .animateOverlays(store)
        .overlay {
            if store.timedOut {
                TimedOutOverlay(onHome: { store.leaveRoom() },
                                onStay: { store.timedOut = false })
            }
        }
        .animation(.spring(duration: 0.35), value: store.timedOut)
    }

    private var connectionLabel: String {
        switch store.connection {
        case .connected: "Joining room…"
        case .connecting: "Connecting to the server…"
        case .disconnected: "Reconnecting…"
        }
    }

    // MARK: - top bar

    private func topBar(_ P: Palette) -> some View {
        HStack(spacing: 12) {
            Button {
                // Mid-game, leaving deserves a second thought — and a way back.
                if store.state?.isPlaying == true {
                    confirmLeave = true
                } else {
                    store.leaveRoom()
                }
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(P.ink2)
                    .frame(width: 34, height: 34)
                    .background(P.card, in: Circle())
            }
            .confirmationDialog("Leave the game?", isPresented: $confirmLeave, titleVisibility: .visible) {
                Button("Leave — I'll come back") {
                    // Keep lastRoom so the landing screen offers Continue.
                    let room = store.roomId ?? ""
                    let guestCount = store.guests.count
                    store.leaveRoom()
                    store.lastRoom = room
                    store.lastGuests = guestCount
                }
                Button("Leave for good", role: .destructive) {
                    // The quit has to reach the server before the socket goes
                    // away — it's what hands the streets back to the bank.
                    store.quitGame()
                    Task {
                        try? await Task.sleep(for: .milliseconds(350))
                        store.leaveRoom()
                    }
                }
            } message: {
                Text("A bot holds your seat while you're away, so you can continue from the home screen. Leaving for good returns your streets to the bank and costs 1 karma.")
            }

            HStack(spacing: 6) {
                Circle()
                    .fill(store.connection == .connected ? P.good : P.gold)
                    .frame(width: 7, height: 7)
                Text(store.roomId ?? "")
                    .font(.system(size: 14, weight: .heavy, design: .monospaced))
                    .foregroundStyle(P.ink)
                    .kerning(1)
                    .lineLimit(1)
                    .fixedSize()
            }
            .padding(.vertical, 7)
            .padding(.horizontal, 13)
            .background(P.card, in: Capsule())

            Spacer()

            SoundToggle()
            iconButton("bubble.left.and.bubble.right.fill", P) { sheet = .chatLog(0) }
            if store.state?.isPlaying == true {
                iconButton("arrow.left.arrow.right", P) { sheet = .tradePicker(from: store.activeId, give: []) }
                iconButton("building.columns.fill", P) { sheet = .properties }
            }
            ShareLink(item: shareURL) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(P.red, in: Circle())
            }
        }
        .padding(.horizontal, 12)
    }

    /// The web client reads ?room= on load, so this link seats a friend at the
    /// same table straight from a browser — no app install in the way.
    private var shareURL: URL {
        let home = "https://money-up-nine.vercel.app/"
        return URL(string: "\(home)?room=\(store.roomId ?? "")") ?? URL(string: home)!
    }

    private func iconButton(_ system: String, _ P: Palette, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(P.ink2)
                .frame(width: 34, height: 34)
                .background(P.card, in: Circle())
        }
    }

    // MARK: - bottom context panel

    @ViewBuilder private var bottomPanel: some View {
        if let state = store.state {
            // Held chairs sit right above the dock: the decision belongs with
            // the buttons, not off in a corner of the board.
            AwaitingSeatsCard()
                .padding(.horizontal, 12)

            if state.isLobby {
                if state.isQuickWaiting {
                    QuickMatchPanel()
                        .frame(maxHeight: .infinity)
                } else {
                    LobbyPanel(openSettings: { sheet = .settings })
                        .frame(maxHeight: .infinity)
                }
            } else {
                // The live feed lives inside the board's centre well now, so the
                // board itself takes the full width and the dock stays at thumbs.
                // No spacer here on purpose: the one above the player strip owns
                // all the slack, so the strip and the dock stay a single cluster
                // instead of drifting apart with a dead band between them.
                ActionPanel(openProperties: { sheet = .properties },
                            openTrade: { sheet = .tradePicker(from: store.activeId, give: []) },
                            openCounter: { sheet = .counter($0) },
                            openResults: { sheet = .gameOver })
                    .padding(.bottom, 4)
            }
        }
    }
}

// MARK: - live activity feed

/// The last few game-log lines, ticking live under the board — the game keeps
/// talking even when it isn't your turn.
struct ActivityFeed: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    /// Embedded = inside the board's centre well: transparent, tighter type.
    var embedded = false

    private static let icons: [String: (String, Color)] = [
        "dice": ("die.face.5.fill", Color(hex: 0x8B5CF6)),
        "money": ("dollarsign.circle.fill", Color(hex: 0x4ADE80)),
        "rent": ("house.fill", Color(hex: 0xFB7185)),
        "buy": ("cart.fill", Color(hex: 0x60A5FA)),
        "turn": ("play.fill", Color(hex: 0xFBBF24)),
        "jail": ("exclamationmark.triangle.fill", Color(hex: 0xFB923C)),
        "warn": ("exclamationmark.triangle.fill", Color(hex: 0xFB923C)),
        "bankrupt": ("xmark.octagon.fill", Color(hex: 0xFB7185)),
        "auction": ("hammer.fill", Color(hex: 0xFBBF24)),
        "trade": ("arrow.left.arrow.right", Color(hex: 0xFBBF24)),
        "system": ("sparkles", Color(hex: 0xF04156)),
        "treasure": ("gift.fill", Color(hex: 0xFB923C)),
        "surprise": ("questionmark.circle.fill", Color(hex: 0xF472B6)),
        "build": ("hammer.circle.fill", Color(hex: 0x60A5FA)),
        "mortgage": ("building.columns.fill", Color(hex: 0x94A3B8)),
        "join": ("person.fill.badge.plus", Color(hex: 0x94A3B8)),
        "leave": ("person.fill.badge.minus", Color(hex: 0x94A3B8)),
    ]

    var body: some View {
        let P = Palette.current(scheme)
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: embedded ? 4 : 5) {
                    ForEach(store.state?.log.suffix(30) ?? []) { line in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            let style = Self.icons[line.kind] ?? ("circle.fill", P.ink3)
                            Image(systemName: style.0)
                                .font(.system(size: embedded ? 8 : 9))
                                .foregroundStyle(style.1)
                                .frame(width: 12)
                            Text(line.text)
                                .font(.system(size: embedded ? 11.5 : 12.5,
                                              weight: line.kind == "turn" ? .bold : .medium, design: .rounded))
                                .foregroundStyle(line.kind == "turn" ? P.ink : P.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .id(line.id)
                    }
                }
                .padding(embedded ? 8 : 12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: store.state?.log.last?.at) {
                if let last = store.state?.log.last {
                    withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
            .onAppear {
                if let last = store.state?.log.last { proxy.scrollTo(last.id, anchor: .bottom) }
            }
        }
        .background(
            embedded ? Color.clear : P.card.opacity(scheme == .light ? 0.9 : 0.55),
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(embedded ? Color.clear : P.rule, lineWidth: 1)
        )
    }
}

// MARK: - sound toggle

struct SoundToggle: View {
    @Environment(\.colorScheme) private var scheme
    @State private var on = SoundKit.shared.enabled

    var body: some View {
        let P = Palette.current(scheme)
        Button {
            on.toggle()
            SoundKit.shared.enabled = on
            if on { SoundKit.shared.warmUp(); SoundKit.shared.click() }
        } label: {
            Image(systemName: on ? "speaker.wave.2.fill" : "speaker.slash.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(on ? P.ink2 : P.ink3)
                .frame(width: 34, height: 34)
                .background(P.card, in: Circle())
        }
    }
}

// MARK: - player strip

struct PlayerStrip: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    /// Horizontal space the parent has shaved off each side (iPad corner pods).
    var sideInset: CGFloat = 0
    let onTapPlayer: (PlayerState) -> Void

    var body: some View {
        let P = Palette.current(scheme)
        // Both fall straight out of the freshest state, so the standings and
        // the heads-up re-read themselves on every push.
        let ranks = store.liveRanks
        let nextUp = store.nextUpId
        // The chip on the clock is the one worth reading, so the strip drives
        // itself there; a four-player table is wider than any phone and the
        // seat that matters used to end up off the right edge.
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(store.state?.players ?? []) { p in
                        let isTurn = store.state?.isPlaying == true && store.state?.turn?.playerId == p.id
                        let team = p.team.flatMap { store.state?.teamInfo?[safe: $0] }
                        HStack(spacing: 7) {
                            AvatarView(name: p.name, colorCSS: p.color, flag: p.flag ?? "", size: 32, emoji: p.avatar ?? "")
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 4) {
                                    Text(p.name)
                                        .font(.system(size: 13.5, weight: .bold, design: .rounded))
                                        .foregroundStyle(P.ink)
                                        .lineLimit(1)
                                        .frame(maxWidth: 118, alignment: .leading)
                                    if p.id == store.state?.hostId {
                                        Text("HOST").font(.system(size: 7, weight: .black))
                                            .foregroundStyle(P.gold)
                                    }
                                    if p.isBot == true {
                                        Text("BOT").font(.system(size: 7, weight: .black))
                                            .foregroundStyle(P.ink3)
                                    }
                                    if let rank = ranks[p.id] {
                                        rankBadge(rank, P)
                                    }
                                    if nextUp == p.id, !isTurn {
                                        nextTag(store.isLocal(p.id), P)
                                    }
                                }
                                HStack(spacing: 4) {
                                    Text(standingLabel(p))
                                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                                        .foregroundStyle(p.isBankrupt ? P.ink3 : P.good)
                                        .contentTransition(.numericText())
                                        .animation(.snappy(duration: 0.4), value: p.money)
                                    let owned = store.state?.ownership.values.filter { $0.owner == p.id }.count ?? 0
                                    if owned > 0, !p.isBankrupt {
                                        Text("·  \(owned) 🏠")
                                            .font(.system(size: 9.5, weight: .bold, design: .rounded))
                                            .foregroundStyle(P.ink3)
                                    }
                                    if isTurn, let endsAt = store.state?.turn?.endsAt {
                                        TurnClock(endsAt: endsAt, compact: true)
                                    }
                                }
                            }
                        }
                        // Badges and the clock get their natural width — squeezed
                        // into a screen-wide row they used to truncate to "NE…".
                        .fixedSize(horizontal: true, vertical: false)
                        .padding(.vertical, 6)
                        .padding(.horizontal, 10)
                        .background(P.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(isTurn ? P.gold : (team.map { Color(css: $0.color) } ?? P.rule),
                                        lineWidth: isTurn ? 2 : 1)
                        )
                        // The floating +/- rides the chip's own top edge, where
                        // it can't sit on top of the player's name.
                        .overlay(alignment: .top) {
                            MoneyDeltaBadge(playerId: p.id)
                                .offset(y: -13)
                        }
                        .opacity(p.isBankrupt ? 0.5 : 1)
                        .id(p.id)
                        .onTapGesture { onTapPlayer(p) }
                    }
                }
                .padding(.horizontal, 12)
                .frame(minWidth: max(0, contentWidth - sideInset * 2))
            }
            .onAppear { scroll(proxy, animated: false) }
            .onChange(of: store.state?.turn?.playerId) { _, _ in scroll(proxy, animated: true) }
            .onChange(of: store.state?.players.count) { _, _ in scroll(proxy, animated: true) }
        }
        .frame(height: 54)
    }

    /// The width the strip should try to fill. Taken from the window rather
    /// than the screen so a Split View iPad doesn't get a phantom scroll run.
    private var contentWidth: CGFloat {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive } ?? UIApplication.shared.connectedScenes.first as? UIWindowScene
        return scene?.keyWindow?.bounds.width ?? UIScreen.main.bounds.width
    }

    /// "bankrupt" is only true for players the game actually beat — a seat the
    /// clock took, or one that walked out, reads as what really happened.
    private func standingLabel(_ p: PlayerState) -> String {
        guard p.isBankrupt else { return money(p.money) }
        if p.wasRemoved { return p.removedFor == "quit" ? "left" : "timed out" }
        return "bankrupt"
    }

    /// Keep the seat on the clock — or this device's own seat between turns —
    /// inside the visible run of the strip.
    private func scroll(_ proxy: ScrollViewProxy, animated: Bool) {
        guard let state = store.state else { return }
        let target = (state.isPlaying ? state.turn?.playerId : nil) ?? store.meId
        guard state.players.contains(where: { $0.id == target }) else { return }
        if animated {
            withAnimation(.easeOut(duration: 0.3)) { proxy.scrollTo(target, anchor: .center) }
        } else {
            proxy.scrollTo(target, anchor: .center)
        }
    }

    /// Live position by net worth, crown on whoever is actually ahead.
    /// Crown and number are one text run: as two views the emoji reported a
    /// narrower width than it drew, and squeezed the "#1" out to "…".
    private func rankBadge(_ rank: Int, _ P: Palette) -> some View {
        Text(rank == 1 ? "👑 #1" : "#\(rank)")
            .font(.system(size: 8.5, weight: .black, design: .rounded))
            .fixedSize()
            .foregroundStyle(rank == 1 ? P.gold : P.ink3)
            .padding(.vertical, 1.5)
            .padding(.horizontal, 5)
            .background(rank == 1 ? P.goldSoft : P.sunken, in: Capsule())
    }

    /// Enough warning to look up before the turn lands — no more than that.
    private func nextTag(_ mine: Bool, _ P: Palette) -> some View {
        Text(mine ? "YOU'RE NEXT" : "NEXT")
            .font(.system(size: 7, weight: .black))
            .kerning(0.5)
            // Kerning adds a trailing gap that Text does not count in its own
            // ideal width, so without this the tag truncates itself to "NE…".
            .fixedSize()
            .foregroundStyle(mine ? P.gold : P.ink3)
            .padding(.vertical, 1.5)
            .padding(.horizontal, 5)
            .background(mine ? P.goldSoft : P.sunken, in: Capsule())
    }
}

// MARK: - centre well

struct CenterWell: View {
    /// iPad tabletop: the action dock renders inside the well, dead-centre.
    var actionsInWell = false
    var openProperties: (() -> Void)? = nil
    var openTrade: (() -> Void)? = nil
    /// Opens the full game log — the ghosted feed behind the dice is a teaser,
    /// this is the whole story.
    var openHistory: (() -> Void)? = nil
    var openCounter: ((TradeOffer) -> Void)? = nil
    /// Reopens the final standings once the game has ended.
    var openResults: (() -> Void)? = nil

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 10) {
            if let state = store.state {
                if let auction = state.auction {
                    AuctionBox(auction: auction)
                        // Room for the turn clock, which now rides above every
                        // phase of the well rather than vanishing under a bid.
                        .padding(.top, state.turn?.endsAt == nil ? 0 : 26)
                } else if state.isLobby {
                    VStack(spacing: 8) {
                        Text(state.map.icon ?? "🌐").font(.system(size: 26))
                        Text(state.map.name)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                        // one dot per seat, filled with each player's colour
                        HStack(spacing: 6) {
                            ForEach(0..<state.settings.maxPlayers, id: \.self) { i in
                                if let p = state.players[safe: i] {
                                    Circle().fill(Color(css: p.color)).frame(width: 11, height: 11)
                                        .overlay(Circle().stroke(.white.opacity(0.6), lineWidth: 1))
                                } else {
                                    Circle().stroke(P.rule2, style: StrokeStyle(lineWidth: 1.5, dash: [3]))
                                        .frame(width: 11, height: 11)
                                }
                            }
                        }
                        Text("\(state.players.count) of \(state.settings.maxPlayers) seats")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(P.ink3)
                    }
                } else if state.isEnded {
                    VStack(spacing: 6) {
                        Text("🏆").font(.system(size: 34))
                        Text("\(store.state?.winner?.name ?? "Nobody") wins!")
                            .font(.system(size: 15, weight: .heavy, design: .rounded))
                            .foregroundStyle(P.ink)
                        // The result sheet is dismissable, so the well keeps a
                        // way back to it — otherwise the standings are gone.
                        if let openResults {
                            Button("🏆  Final standings") {
                                openResults()
                                Haptics.tap()
                            }
                            .buttonStyle(MMButtonStyle(kind: .ghost))
                            .padding(.top, 2)
                        }
                    }
                } else {
                    // The log runs quietly across the whole well; the dice sit
                    // on top, dead-centre of the board, the way a table reads.
                    // The feed is deliberately ghosted — background murmur, not
                    // a wall of text competing with the board.
                    GeometryReader { geo in
                        ZStack {
                            ActivityFeed(embedded: true)
                                .opacity(0.5)
                                .mask(
                                    LinearGradient(
                                        stops: [
                                            .init(color: .clear, location: 0),
                                            .init(color: .black.opacity(0.55), location: 0.3),
                                            .init(color: .black, location: 1),
                                        ],
                                        startPoint: .top, endPoint: .bottom
                                    )
                                )
                                .frame(maxWidth: .infinity, maxHeight: .infinity)

                            VStack(spacing: 12) {
                                Group {
                                    if let dice = state.turn?.dice, dice.count == 2 {
                                        let dieSize = min(max(geo.size.width * 0.17, 44), 76)
                                        DiceView(values: dice, size: dieSize)
                                            .padding(.vertical, dieSize * 0.30)
                                            .padding(.horizontal, dieSize * 0.42)
                                            .background(
                                                P.boardBG.opacity(0.92),
                                                in: RoundedRectangle(cornerRadius: 24, style: .continuous)
                                            )
                                            .shadow(color: .black.opacity(0.35), radius: 18, y: 8)
                                    }
                                    if state.settings.vacationCash == true, let pot = state.vacationPot, pot > 0 {
                                        HStack(spacing: 4) {
                                            Text("🏝️").font(.system(size: 11))
                                            Text(money(pot))
                                                .font(.system(size: 12, weight: .heavy, design: .rounded))
                                                .foregroundStyle(P.gold)
                                        }
                                        .padding(.vertical, 4)
                                        .padding(.horizontal, 10)
                                        .background(P.goldSoft, in: Capsule())
                                    }
                                }
                                .allowsHitTesting(false)

                                // iPad tabletop: roll/buy/end-turn live right
                                // here, in the middle of the table.
                                if actionsInWell {
                                    ActionPanel(openProperties: { openProperties?() },
                                                openTrade: openTrade,
                                                openCounter: openCounter,
                                                openResults: openResults)
                                        .frame(maxWidth: min(geo.size.width * 0.74, 470))
                                }
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                        .overlay(alignment: .bottomTrailing) {
                            if let openHistory {
                                historyChip(openHistory, P)
                            }
                        }
                        .overlay { DeckIntro(at: store.boardIntroAt) }
                    }
                }
            }
        }
        // The server puts a deadline on every turn now — the house's seats
        // included — so the well's clock is a fixture of the table. It hangs
        // off the whole well rather than the dice layer, because an auction
        // replaces that layer and the clock must not blink out with it.
        .overlay(alignment: .top) {
            if let endsAt = store.state?.turn?.endsAt, store.state?.isPlaying == true {
                TurnClock(endsAt: endsAt)
                    .padding(.top, 6)
            }
        }
        .padding(8)
        .minimumScaleFactor(0.7)
    }

    private func historyChip(_ open: @escaping () -> Void, _ P: Palette) -> some View {
        Button {
            open()
            Haptics.tap()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 11, weight: .bold))
                Text("History")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
            }
            .foregroundStyle(P.ink2)
            .padding(.vertical, 7)
            .padding(.horizontal, 12)
            .background(P.card.opacity(0.92), in: Capsule())
            .overlay(Capsule().stroke(P.rule, lineWidth: 1))
        }
        .padding(10)
    }
}

// MARK: - deck-shuffle intro

/// The opening flourish: a deck of face-down cards sits in the middle of the
/// table, riffle-shuffles in two halves, then sinks away as the board deals
/// itself out of it (each tile flies from the centre — see TileView).
struct DeckIntro: View {
    let at: Date?

    @Environment(\.colorScheme) private var scheme
    @State private var split = false      // halves apart
    @State private var merged = false     // riffled back together
    @State private var gone = false       // deck sinks as tiles fly

    var body: some View {
        let P = Palette.current(scheme)
        if let at, Date().timeIntervalSince(at) < 3, !gone {
            ZStack {
                ForEach(0..<10, id: \.self) { i in
                    let half: CGFloat = i.isMultiple(of: 2) ? -1 : 1
                    cardBack(P)
                        .offset(x: split ? half * 46 : 0,
                                y: CGFloat(i) * -2.4 + (merged ? 0 : (split ? CGFloat(i % 3) * 5 : 0)))
                        .rotationEffect(.degrees(split ? Double(half) * 9 : Double(i) * 1.4 - 6))
                }
            }
            .scaleEffect(gone ? 0.4 : 1)
            .opacity(gone ? 0 : 1)
            .allowsHitTesting(false)
            .task {
                // Matches SoundKit.shuffleDeal: riffle ~0.55s, then the deal.
                withAnimation(.spring(duration: 0.28, bounce: 0.4)) { split = true }
                try? await Task.sleep(for: .milliseconds(330))
                withAnimation(.spring(duration: 0.3, bounce: 0.5)) { split = false; merged = true }
                try? await Task.sleep(for: .milliseconds(520))
                withAnimation(.easeIn(duration: 0.45)) { gone = true }
            }
        }
    }

    private func cardBack(_ P: Palette) -> some View {
        RoundedRectangle(cornerRadius: 9, style: .continuous)
            .fill(LinearGradient(colors: [P.red, P.redDeep], startPoint: .topLeading, endPoint: .bottomTrailing))
            .frame(width: 74, height: 104)
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(P.accentInk.opacity(0.4), lineWidth: 1.5)
                    .padding(6)
            )
            .overlay(
                Text("MM")
                    .font(.system(size: 20, weight: .black, design: .rounded))
                    .foregroundStyle(P.accentInk.opacity(0.75))
            )
            .shadow(color: .black.opacity(0.3), radius: 6, y: 3)
    }
}

// MARK: - floating money delta

/// "+$200" / "−$150" floating up beside a player's money for a beat.
struct MoneyDeltaBadge: View {
    let playerId: String
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        ZStack {
            if let d = store.moneyDeltas[playerId] {
                Text("\(d.amount > 0 ? "+" : "−")$\(abs(d.amount))")
                    .font(.system(size: 12, weight: .black, design: .rounded))
                    .foregroundStyle(d.amount > 0 ? P.good : P.bad)
                    // The badge floats in an overlay that proposes the tiny
                    // size of the money label — never let the amount truncate
                    // into "−$…".
                    .fixedSize()
                    .padding(.vertical, 2)
                    .padding(.horizontal, 7)
                    .background(P.card.opacity(0.94), in: Capsule())
                    .overlay(Capsule().stroke((d.amount > 0 ? P.good : P.bad).opacity(0.4), lineWidth: 1))
                    .shadow(color: .black.opacity(0.25), radius: 4, y: 2)
                    .id(d.id)
                    .transition(.asymmetric(
                        insertion: .offset(y: 8).combined(with: .opacity).combined(with: .scale(scale: 0.7)),
                        removal: .offset(y: -12).combined(with: .opacity)
                    ))
            }
        }
        .animation(.spring(duration: 0.4, bounce: 0.4), value: store.moneyDeltas[playerId])
        .allowsHitTesting(false)
    }
}

// MARK: - corner player pods (iPad tabletop)

/// Every player seated at THIS device gets their own little dashboard pinned
/// to a corner of the screen — name, live cash with the +/- flash, and their
/// dice / end-turn / trade controls. The top pair renders upside down, facing
/// the people sitting across the table.
struct CornerPods: View {
    let openTrade: (String) -> Void

    @EnvironmentObject var store: GameStore

    /// Local seats dealt to corners: first two at the bottom, next two across
    /// the table. This device's own player always leads, so the person holding
    /// the iPad never finds their own pod printed upside down — the server is
    /// free to shuffle turn order, and it does.
    private var seats: [PlayerState] {
        let mine = (store.state?.players ?? []).filter { store.isLocal($0.id) && !$0.isBankrupt }
        guard let i = mine.firstIndex(where: { $0.id == store.meId }) else { return mine }
        var ordered = mine
        ordered.insert(ordered.remove(at: i), at: 0)
        return ordered
    }

    var body: some View {
        let s = seats
        VStack {
            HStack(alignment: .top) {
                pod(s[safe: 2], flipped: true)
                Spacer()
                pod(s[safe: 3], flipped: true)
            }
            Spacer()
            HStack(alignment: .bottom) {
                pod(s[safe: 0], flipped: false)
                Spacer()
                pod(s[safe: 1], flipped: false)
            }
        }
        .padding(12)
    }

    @ViewBuilder private func pod(_ p: PlayerState?, flipped: Bool) -> some View {
        if let p {
            PlayerPod(player: p, flipped: flipped, openTrade: openTrade)
        } else {
            Color.clear.frame(width: 1, height: 1)
        }
    }
}

/// One corner dashboard: identity, cash, and this seat's controls.
private struct PlayerPod: View {
    let player: PlayerState
    let flipped: Bool
    let openTrade: (String) -> Void

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    private var isTurn: Bool {
        store.state?.isPlaying == true && store.state?.turn?.playerId == player.id
    }

    var body: some View {
        let P = Palette.current(scheme)
        let color = Color(css: player.color)

        VStack(spacing: 8) {
            HStack(spacing: 8) {
                AvatarView(name: player.name, colorCSS: player.color, flag: player.flag ?? "", size: 28, emoji: player.avatar ?? "")
                VStack(alignment: .leading, spacing: 0) {
                    Text(player.name)
                        .font(.system(size: 12.5, weight: .bold, design: .rounded))
                        .foregroundStyle(P.ink)
                        .lineLimit(1)
                    Text(money(player.money))
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.good)
                        .contentTransition(.numericText())
                        .animation(.snappy(duration: 0.4), value: player.money)
                }
                Spacer(minLength: 0)
                if isTurn, let endsAt = store.state?.turn?.endsAt {
                    TurnClock(endsAt: endsAt, compact: true)
                }
            }
            .overlay(alignment: .topTrailing) {
                MoneyDeltaBadge(playerId: player.id)
                    .offset(x: 6, y: -4)
            }

            HStack(spacing: 6) {
                if isTurn, let phase = store.state?.turn?.phase {
                    switch phase {
                    case "roll":
                        podButton("🎲 Roll", prominent: true) { store.roll() }
                    case "end":
                        podButton("End ➜", prominent: true) { store.endTurn() }
                    default:
                        Text(phase == "action" ? "your call…" : "…")
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .frame(maxWidth: .infinity)
                    }
                }
                podButton("⇄", prominent: false) { openTrade(player.id) }
                    .frame(width: 44)
            }
        }
        .padding(10)
        .frame(width: 172)
        .background(P.card.opacity(0.96), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(isTurn ? color : P.rule, lineWidth: isTurn ? 2 : 1)
        )
        .shadow(color: isTurn ? color.opacity(0.35) : .black.opacity(0.2),
                radius: isTurn ? 12 : 6, y: 4)
        .rotationEffect(.degrees(flipped ? 180 : 0))
        .animation(.spring(duration: 0.35), value: isTurn)
    }

    private func podButton(_ label: String, prominent: Bool, action: @escaping () -> Void) -> some View {
        let P = Palette.current(scheme)
        return Button {
            action()
            Haptics.tap()
        } label: {
            Text(label)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(prominent ? P.accentInk : P.ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(prominent ? AnyShapeStyle(P.red) : AnyShapeStyle(P.sunken),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }
}

// MARK: - turn clock

/// The seconds left on the current turn, counted down on this device from the
/// server's deadline. It leans on TimelineView rather than a Timer so every
/// copy on screen — well, chip, corner pod — ticks off the same clock.
struct TurnClock: View {
    /// Epoch milliseconds the turn expires (turn.endsAt).
    let endsAt: Double
    /// Compact = the small countdown riding a player chip or pod.
    var compact = false

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        // Driven entirely on this device: the state push only ever hands over a
        // new deadline, so a quiet turn still counts down second by second.
        TimelineView(.periodic(from: .now, by: 0.2)) { context in
            let left = Self.secondsLeft(endsAt, at: context.date)
            let urgent = left <= 10
            HStack(spacing: 4) {
                if !compact {
                    Image(systemName: "timer")
                        .font(.system(size: 11, weight: .bold))
                }
                Text("\(left)s")
                    .font(.system(size: compact ? 10.5 : 13, weight: .heavy, design: .rounded))
                    .monospacedDigit()
            }
            .foregroundStyle(urgent ? P.bad : P.ink2)
            .padding(.vertical, compact ? 2.5 : 5)
            .padding(.horizontal, compact ? 6 : 11)
            .background(urgent ? P.redSoft : P.sunken, in: Capsule())
            .overlay(Capsule().stroke(urgent ? P.bad.opacity(0.55) : P.rule, lineWidth: 1))
            // The last ten seconds get a heartbeat, once a second.
            .scaleEffect(urgent && !left.isMultiple(of: 2) ? 1.07 : 1)
            .animation(.snappy(duration: 0.18), value: left)
        }
        .fixedSize()
        // A fresh deadline restarts the tick schedule, so the number can never
        // be left frozen on the last turn's final second.
        .id(endsAt)
    }

    static func secondsLeft(_ endsAt: Double, at now: Date) -> Int {
        max(0, Int(ceil(endsAt / 1000 - now.timeIntervalSince1970)))
    }
}

// MARK: - waiting on a dropped seat

/// Somebody's connection went away and the table is holding their chair. The
/// card carries the only two things the room needs: how long is left, and the
/// button that buys them another minute. Never shown to the seat being waited
/// on — that player is not the one who gets to vote themselves back in.
struct AwaitingSeatsCard: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    @ViewBuilder var body: some View {
        let seats = store.awaitingSeats
        if !seats.isEmpty {
            VStack(spacing: 8) {
                ForEach(seats) { seat in
                    row(seat, Palette.current(scheme))
                }
            }
            .transition(.move(edge: .top).combined(with: .opacity))
            .animation(.spring(duration: 0.35), value: seats.map(\.id))
        }
    }

    private func row(_ seat: AwaitingSeat, _ P: Palette) -> some View {
        let player = store.state?.player(seat.id)
        let agreed = store.hasGrantedTime(seat)
        let count = seat.grantedIds.count
        // A vote can't need fewer seats than have already clicked.
        let voters = max(seat.voterCount, count)

        return VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 9) {
                if let player {
                    AvatarView(name: player.name, colorCSS: player.color,
                               flag: player.flag ?? "", size: 30, emoji: player.avatar ?? "")
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(player?.name ?? "A player") dropped out")
                        .font(.system(size: 14, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                        .lineLimit(1)
                    Text(seat.isVote
                         ? "Everyone still at the table has to agree now."
                         : "Any one of you can hand them another minute.")
                        .font(.system(size: 11.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 6)
                if let until = seat.until {
                    SeatCountdown(until: until)
                }
            }

            if seat.isVote {
                voteBar(count: count, voters: voters, P)
            }

            Button {
                store.grantTime(seat.id)
            } label: {
                Text(buttonLabel(seat, agreed: agreed, count: count, voters: voters))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .buttonStyle(MMButtonStyle(kind: agreed ? .ghost : .gold, big: true))
            .disabled(agreed)
            .opacity(agreed ? 0.75 : 1)
        }
        .padding(11)
        .background(P.goldSoft.opacity(0.7), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(P.gold.opacity(0.6), lineWidth: 1)
        )
    }

    /// After the free favours the button stops being a favour and starts being
    /// a vote, so it says so and carries the tally with it.
    private func buttonLabel(_ seat: AwaitingSeat, agreed: Bool, count: Int, voters: Int) -> String {
        guard seat.isVote else {
            return agreed ? "✓  Minute granted" : "⏳  Grant a minute"
        }
        let tally = "\(count) of \(voters) agreed"
        return agreed
            ? "✓  You agreed — waiting on the rest (\(tally))"
            : "🗳  Everyone must agree — \(tally)"
    }

    /// One pip per player who still has to click, filled as they do.
    private func voteBar(count: Int, voters: Int, _ P: Palette) -> some View {
        HStack(spacing: 4) {
            ForEach(0..<max(voters, 1), id: \.self) { i in
                Capsule()
                    .fill(i < count ? AnyShapeStyle(P.gold) : AnyShapeStyle(P.rule2))
                    .frame(height: 5)
            }
        }
        .animation(.snappy(duration: 0.25), value: count)
    }
}

/// Seconds until a held chair goes back to the board, ticked on this device so
/// it keeps moving between state pushes.
private struct SeatCountdown: View {
    let until: Double

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        TimelineView(.periodic(from: .now, by: 0.2)) { context in
            let left = TurnClock.secondsLeft(until, at: context.date)
            VStack(spacing: 0) {
                Text("\(left)s")
                    .font(.system(size: 15, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(left <= 15 ? P.bad : P.ink)
                Text("left")
                    .font(.system(size: 8.5, weight: .bold))
                    .kerning(0.5)
                    .foregroundStyle(P.ink3)
            }
            .padding(.vertical, 5)
            .padding(.horizontal, 9)
            .background(P.card.opacity(0.85), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .fixedSize()
        .id(until)
    }
}

// MARK: - timed-out overlay

/// The clock ran out on this device's seat. It takes over the screen because
/// it changes what the player can do next — but the game is still worth
/// watching, so staying is offered as loudly as leaving.
struct TimedOutOverlay: View {
    let onHome: () -> Void
    let onStay: () -> Void

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        ZStack {
            Color.black.opacity(0.6).ignoresSafeArea()

            VStack(spacing: 12) {
                Text("⏳").font(.system(size: 46))
                Text("Your time ran out")
                    .font(.system(size: 22, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink)
                Text("You were removed to keep the game moving. You can head back or stay and watch how it ends.")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink2)
                    .multilineTextAlignment(.center)

                VStack(spacing: 8) {
                    Button("Back to home") {
                        onHome()
                        Haptics.tap()
                    }
                    .buttonStyle(MMButtonStyle(kind: .primary, big: true))

                    Button("Stay and watch") {
                        onStay()
                        Haptics.tap()
                    }
                    .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                }
                .padding(.top, 4)

                Text("Leaving or timing out costs 1 karma.")
                    .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
            .padding(24)
            .frame(maxWidth: 340)
            .background(P.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(P.rule, lineWidth: 1))
            .shadow(color: .black.opacity(0.45), radius: 30, y: 14)
            .padding(.horizontal, 26)
            .transition(.scale(scale: 0.86).combined(with: .opacity))
        }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
