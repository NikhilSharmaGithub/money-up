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

                BoardView(onTapTile: { sheet = .deed($0) }) {
                    CenterWell()
                }
                .padding(.horizontal, 6)

                bottomPanel
                    .frame(maxHeight: .infinity)
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
            } else {
                ActionPanel(openProperties: { sheet = .properties })
            }
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
                        AvatarView(name: p.name, colorCSS: p.color, flag: p.flag ?? "", size: 28)
                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 4) {
                                Text(p.name)
                                    .font(.system(size: 12, weight: .bold, design: .rounded))
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
                            Text(p.isBankrupt ? "bankrupt" : money(p.money))
                                .font(.system(size: 11.5, weight: .heavy, design: .rounded))
                                .foregroundStyle(p.isBankrupt ? P.ink3 : P.good)
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
        .frame(height: 48)
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
                    VStack(spacing: 6) {
                        Text(state.map.icon ?? "🌐").font(.system(size: 26))
                        Text(state.map.name)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
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
                    if let current = store.currentPlayer, store.state?.turn?.playerId != store.meId {
                        VStack(spacing: 3) {
                            AvatarView(name: current.name, colorCSS: current.color,
                                       flag: current.flag ?? "", size: 30)
                            Text("\(current.name)'s turn")
                                .font(.system(size: 12, weight: .bold, design: .rounded))
                                .foregroundStyle(Color(css: current.color))
                        }
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
