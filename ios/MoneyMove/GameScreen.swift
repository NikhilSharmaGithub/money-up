// The in-room screen: player strip on top, the board in the middle with a
// live centre well, and a context panel underneath that changes with the
// phase — lobby controls, turn actions, debt rescue, trade offers.

import SwiftUI

enum ActiveSheet: Identifiable {
    case deed(Int)
    case properties
    case trade(from: String, to: String, give: Set<Int>)  // proposing seat → target
    case tradePicker(from: String, give: Set<Int>)        // choose who to trade with first
    case chatLog(Int)       // initial tab: 0 chat, 1 log
    case settings
    case gameOver

    var id: String {
        switch self {
        case .deed(let i): "deed-\(i)"
        case .properties: "properties"
        case .trade(let f, let t, _): "trade-\(f)-\(t)"
        case .tradePicker(let f, _): "tradepicker-\(f)"
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
                                    sheet = .trade(from: store.activeId, to: p.id, give: [])
                                }
                            })
                            .padding(.horizontal, 196)

                            BoardView(onTapTile: { sheet = .deed($0) }) {
                                CenterWell(actionsInWell: true,
                                           openProperties: { sheet = .properties },
                                           openTrade: { sheet = .tradePicker(from: store.activeId, give: []) },
                                           openHistory: { sheet = .chatLog(1) })
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
                            sheet = .trade(from: store.activeId, to: p.id, give: [])
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
                case .properties: PropertiesSheet(openTrade: { give in
                    sheet = .tradePicker(from: store.activeId, give: give)
                })
                case .trade(let from, let target, let give):
                    TradeSheet(fromId: from, targetId: target, preselectedGive: give)
                case .tradePicker(let from, let give):
                    TradePickerSheet(fromId: from, give: give,
                                     pick: { sheet = .trade(from: from, to: $0, give: give) })
                case .chatLog(let tab): ChatLogSheet(initialTab: tab)
                case .settings: SettingsSheet()
                case .gameOver: GameOverSheet()
                }
            }
            .environmentObject(store)
        }
        .onChange(of: store.showGameOver) { _, over in
            if over { sheet = .gameOver }
        }
        .animateOverlays(store)
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
                Button("Leave for good", role: .destructive) { store.leaveRoom() }
            } message: {
                Text("A bot holds your seat while you're away. You can continue from the home screen.")
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

    private var shareURL: URL {
        let base = store.serverURLString
        return URL(string: "\(base)/room/\(store.roomId ?? "")") ?? URL(string: base)!
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
            if state.isLobby {
                LobbyPanel(openSettings: { sheet = .settings })
                    .frame(maxHeight: .infinity)
            } else {
                // The live feed lives inside the board's centre well now, so the
                // board itself takes the full width and the dock stays at thumbs.
                Spacer(minLength: 0)
                ActionPanel(openProperties: { sheet = .properties },
                            openTrade: { sheet = .tradePicker(from: store.activeId, give: []) })
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
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(store.state?.players ?? []) { p in
                    let isTurn = store.state?.isPlaying == true && store.state?.turn?.playerId == p.id
                    let team = p.team.flatMap { store.state?.teamInfo?[safe: $0] }
                    HStack(spacing: 7) {
                        AvatarView(name: p.name, colorCSS: p.color, flag: p.flag ?? "", size: 32)
                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 4) {
                                Text(p.name)
                                    .font(.system(size: 13.5, weight: .bold, design: .rounded))
                                    .foregroundStyle(P.ink)
                                    .lineLimit(1)
                                if p.id == store.state?.hostId {
                                    Text("HOST").font(.system(size: 7, weight: .black))
                                        .foregroundStyle(P.gold)
                                }
                                if p.isBot == true {
                                    Text("BOT").font(.system(size: 7, weight: .black))
                                        .foregroundStyle(P.ink3)
                                }
                            }
                            HStack(spacing: 4) {
                                Text(p.isBankrupt ? "bankrupt" : money(p.money))
                                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                                    .foregroundStyle(p.isBankrupt ? P.ink3 : P.good)
                                    .contentTransition(.numericText())
                                    .animation(.snappy(duration: 0.4), value: p.money)
                                    .overlay(alignment: .topTrailing) {
                                        MoneyDeltaBadge(playerId: p.id)
                                            .offset(x: 30, y: -16)
                                    }
                                let owned = store.state?.ownership.values.filter { $0.owner == p.id }.count ?? 0
                                if owned > 0, !p.isBankrupt {
                                    Text("·  \(owned) 🏠")
                                        .font(.system(size: 9.5, weight: .bold, design: .rounded))
                                        .foregroundStyle(P.ink3)
                                }
                            }
                        }
                    }
                    .padding(.vertical, 6)
                    .padding(.horizontal, 10)
                    .background(P.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(isTurn ? P.gold : (team.map { Color(css: $0.color) } ?? P.rule),
                                    lineWidth: isTurn ? 2 : 1)
                    )
                    .opacity(p.isBankrupt ? 0.5 : 1)
                    .onTapGesture { onTapPlayer(p) }
                }
            }
            .padding(.horizontal, 12)
            .frame(minWidth: max(0, UIScreen.main.bounds.width - sideInset * 2))
        }
        .frame(height: 54)
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

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 10) {
            if let state = store.state {
                if let auction = state.auction {
                    AuctionBox(auction: auction)
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
                                                openTrade: openTrade)
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

    /// Local seats in join order, dealt to corners: first two at the bottom,
    /// next two across the table.
    private var seats: [PlayerState] {
        (store.state?.players ?? []).filter { store.isLocal($0.id) && !$0.isBankrupt }
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
                AvatarView(name: player.name, colorCSS: player.color, flag: player.flag ?? "", size: 28)
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

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
