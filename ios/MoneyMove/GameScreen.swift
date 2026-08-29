// The in-room screen: player strip on top, the board in the middle with a
// live centre well, and a context panel underneath that changes with the
// phase — lobby controls, turn actions, debt rescue, trade offers.

import SwiftUI

enum ActiveSheet: Identifiable {
    case deed(Int)
    case properties
    case trade(String)      // target player id
    case chatLog(Int)       // initial tab: 0 chat, 1 log
    case settings
    case gameOver

    var id: String {
        switch self {
        case .deed(let i): "deed-\(i)"
        case .properties: "properties"
        case .trade(let t): "trade-\(t)"
        case .chatLog(let t): "chatlog-\(t)"
        case .settings: "settings"
        case .gameOver: "gameover"
        }
    }
}

struct GameScreen: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @State private var sheet: ActiveSheet?

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 10) {
            topBar(P)

            if store.state != nil {
                PlayerStrip(onTapPlayer: { p in
                    if store.state?.isPlaying == true, p.id != store.meId, !p.isBankrupt,
                       store.me?.isBankrupt != true {
                        sheet = .trade(p.id)
                    }
                })

                // While playing, the board floats midway between the strip and
                // the dock instead of leaving one tall gap under itself.
                if store.state?.isLobby == false { Spacer(minLength: 0) }
                BoardView(onTapTile: { sheet = .deed($0) }) {
                    CenterWell()
                }
                .padding(.horizontal, 6)

                bottomPanel
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
                case .properties: PropertiesSheet()
                case .trade(let target): TradeSheet(targetId: target)
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
                store.leaveRoom()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(P.ink2)
                    .frame(width: 34, height: 34)
                    .background(P.card, in: Circle())
            }

            HStack(spacing: 6) {
                Circle()
                    .fill(store.connection == .connected ? P.good : P.gold)
                    .frame(width: 7, height: 7)
                Text(store.roomId ?? "")
                    .font(.system(size: 15, weight: .heavy, design: .monospaced))
                    .foregroundStyle(P.ink)
                    .kerning(2)
            }
            .padding(.vertical, 7)
            .padding(.horizontal, 13)
            .background(P.card, in: Capsule())

            Spacer()

            SoundToggle()
            iconButton("bubble.left.and.bubble.right.fill", P) { sheet = .chatLog(0) }
            iconButton("list.bullet.rectangle.fill", P) { sheet = .chatLog(1) }
            if store.state?.isPlaying == true {
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
                ActionPanel(openProperties: { sheet = .properties })
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
        }
        .frame(height: 54)
    }
}

// MARK: - centre well

struct CenterWell: View {
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
                    if let dice = state.turn?.dice, dice.count == 2 {
                        DiceView(values: dice)
                    }
                    ActivityFeed(embedded: true)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
            }
        }
        .padding(8)
        .minimumScaleFactor(0.7)
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
