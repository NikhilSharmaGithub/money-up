// The board: a square grid computed from the map's layout (sides can be any
// length — Blitz is 6 a side, Worldwide 11), tokens animating between tiles,
// and a centre well the game screen drops its dice/actions into.
//
// Phone tiles are deliberately compact — flag, price, colour band — with the
// full deed one tap away. Cramming street names into 34pt tiles is how boards
// become unreadable.

import SwiftUI

// MARK: - geometry

struct BoardGeometry {
    let layout: MapLayout
    let size: CGSize
    let cornerScale: CGFloat = 1.42

    private var across: Int { layout.top.count + 2 }
    private var unit: CGFloat { size.width / (CGFloat(layout.top.count) + 2 * cornerScale) }
    private var corner: CGFloat { unit * cornerScale }

    /// Frame for any tile index, in board-local coordinates.
    func frame(of index: Int) -> CGRect {
        let u = unit, c = corner
        let W = size.width, H = size.height

        let corners = layout.corners
        if index == corners[0] { return CGRect(x: 0, y: 0, width: c, height: c) }
        if index == corners[1] { return CGRect(x: W - c, y: 0, width: c, height: c) }
        if index == corners[2] { return CGRect(x: W - c, y: H - c, width: c, height: c) }
        if index == corners[3] { return CGRect(x: 0, y: H - c, width: c, height: c) }

        if let i = layout.top.firstIndex(of: index) {
            return CGRect(x: c + CGFloat(i) * u, y: 0, width: u, height: c)
        }
        if let i = layout.right.firstIndex(of: index) {
            return CGRect(x: W - c, y: c + CGFloat(i) * u, width: c, height: u)
        }
        if let i = layout.bottom.firstIndex(of: index) {
            return CGRect(x: W - c - CGFloat(i + 1) * u, y: H - c, width: u, height: c)
        }
        if let i = layout.left.firstIndex(of: index) {
            return CGRect(x: 0, y: H - c - CGFloat(i + 1) * u, width: c, height: u)
        }
        return .zero
    }

    /// Which edge the tile sits on — bands face the middle of the board.
    func side(of index: Int) -> Edge {
        if layout.corners.contains(index) { return .top }
        if layout.top.contains(index) { return .top }
        if layout.right.contains(index) { return .trailing }
        if layout.bottom.contains(index) { return .bottom }
        return .leading
    }

    /// The open middle of the board, inset from the tile ring.
    var centerWell: CGRect {
        CGRect(x: corner + 4, y: corner + 4,
               width: size.width - 2 * corner - 8, height: size.height - 2 * corner - 8)
    }
}

// MARK: - board

struct BoardView<Center: View>: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    let onTapTile: (Int) -> Void
    @ViewBuilder var center: Center

    var body: some View {
        let P = Palette.current(scheme)
        GeometryReader { geo in
            if let state = store.state {
                let side = min(geo.size.width, geo.size.height)
                let geom = BoardGeometry(layout: state.map.layout, size: CGSize(width: side, height: side))

                ZStack(alignment: .topLeading) {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(P.boardBG)
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(P.rule2, lineWidth: 1))
                        .shadow(color: .black.opacity(scheme == .light ? 0.22 : 0.5), radius: 16, y: 8)

                    ForEach(state.map.tiles) { tile in
                        TileView(tile: tile, geom: geom)
                            .frame(width: geom.frame(of: tile.index).width,
                                   height: geom.frame(of: tile.index).height)
                            .position(x: geom.frame(of: tile.index).midX,
                                      y: geom.frame(of: tile.index).midY)
                            .onTapGesture { onTapTile(tile.index) }
                    }

                    // centre well content (dice, status, actions)
                    center
                        .frame(width: geom.centerWell.width, height: geom.centerWell.height)
                        .position(x: geom.centerWell.midX, y: geom.centerWell.midY)

                    TokenLayer(geom: geom)
                }
                .frame(width: side, height: side)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

// MARK: - single tile

struct TileView: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    let tile: TileData
    let geom: BoardGeometry
    @State private var dealt = true

    private var ownership: TileOwnership? { store.state?.owner(of: tile.index) }
    private var ownerPlayer: PlayerState? { store.state?.player(ownership?.owner) }
    private var isActive: Bool {
        guard let state = store.state, state.isPlaying else { return false }
        return store.currentPlayer?.pos == tile.index
    }

    var body: some View {
        let P = Palette.current(scheme)
        let group = store.groupInfo(for: tile)
        let bandColor = bandColorFor(tile: tile, group: group)

        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(faceColor(P))

            // colour band on the edge facing the middle
            if let bandColor {
                band(color: bandColor)
            }

            content(P: P, group: group)

            // owner tint + dot
            if let owner = ownerPlayer {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color(css: owner.color).opacity(0.20))
                ownerDot(owner)
            }

            if ownership?.isMortgaged == true {
                Text("🏦").font(.system(size: 11))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.black.opacity(0.25))
            }

            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(isActive ? P.gold : P.rule, lineWidth: isActive ? 2 : 0.7)
        }
        .shadow(color: isActive ? P.gold.opacity(0.5) : .clear, radius: 6)
        .scaleEffect(dealt ? 1 : 0.01)
        .rotationEffect(.degrees(dealt ? 0 : -18))
        .opacity(dealt ? 1 : 0)
        .onAppear { runDealIfFresh() }
        .onChange(of: store.boardIntroAt) { runDealIfFresh() }
    }

    /// The deal-in: tiles snap out and spring back one after another, sweeping
    /// around the board from START.
    private func runDealIfFresh() {
        guard let at = store.boardIntroAt, Date().timeIntervalSince(at) < 3 else { return }
        dealt = false
        withAnimation(.spring(duration: 0.5, bounce: 0.45).delay(Double(tile.index) * 0.022)) {
            dealt = true
        }
    }

    private func faceColor(_ P: Palette) -> Color {
        switch tile.type {
        case "treasure": P.tileTreasure
        case "surprise": P.tileSurprise
        case "tax": P.tileTax
        case "refund": P.tileRefund
        case "start": P.tileStart
        case "gotoprison": P.tileGoto
        case "vacation": P.tileVacation
        case "prison": P.tileJail
        default: geom.layout.corners.contains(tile.index) ? P.tileCorner : P.card
        }
    }

    private func bandColorFor(tile: TileData, group: GroupInfo?) -> Color? {
        if let group { return Color(css: group.color) }
        switch tile.type {
        case "airport": return Color(hex: 0x5B8DEF)
        case "utility": return Color(hex: 0x22D3EE)
        default: return nil
        }
    }

    @ViewBuilder private func band(color: Color) -> some View {
        let edge = geom.side(of: tile.index)
        // The band hugs the edge that faces the centre of the board.
        VStack(spacing: 0) {
            if edge == .bottom { color.frame(height: 5); Spacer(minLength: 0) }
            else if edge == .top { Spacer(minLength: 0); color.frame(height: 5) }
            else {
                HStack(spacing: 0) {
                    if edge == .trailing { color.frame(width: 5); Spacer(minLength: 0) }
                    else { Spacer(minLength: 0); color.frame(width: 5) }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    @ViewBuilder private func content(P: Palette, group: GroupInfo?) -> some View {
        let houses = ownership?.houseCount ?? 0
        VStack(spacing: 1) {
            switch tile.type {
            case "property":
                Text(group?.flag ?? "🏳️").font(.system(size: 16))
                if houses > 0 {
                    Text(houses == 5 ? "🏨" : String(repeating: "▪︎", count: houses))
                        .font(.system(size: 8.5, weight: .black))
                        .foregroundStyle(P.good)
                } else if let price = tile.price {
                    priceText(price, P)
                }
            case "airport":
                Text("✈️").font(.system(size: 14))
                if let price = tile.price { priceText(price, P) }
            case "utility":
                Text(tile.icon ?? "💡").font(.system(size: 14))
                if let price = tile.price { priceText(price, P) }
            case "treasure": Text("🧰").font(.system(size: 17))
            case "surprise": Text("❓").font(.system(size: 17))
            case "tax":
                Text("💸").font(.system(size: 13))
                Text(tile.amount.map { "$\($0)" } ?? "\(tile.percent ?? 10)%")
                    .font(.system(size: 7, weight: .bold)).foregroundStyle(P.ink2)
            case "refund":
                Text("💵").font(.system(size: 13))
                if let amount = tile.amount { priceText(amount, P) }
            case "start":
                Text("▶▶").font(.system(size: 16, weight: .black)).foregroundStyle(P.good)
                Text("START").font(.system(size: 9.5, weight: .heavy)).foregroundStyle(P.good)
            case "prison":
                Text("🚔").font(.system(size: 20))
                Text("PRISON").font(.system(size: 8.5, weight: .heavy)).foregroundStyle(P.ink3)
            case "vacation":
                Text("🏝️").font(.system(size: 20))
            case "gotoprison":
                Text("🚨").font(.system(size: 20))
            default:
                EmptyView()
            }
        }
        .minimumScaleFactor(0.6)
        .padding(2)
    }

    private func priceText(_ value: Int, _ P: Palette) -> some View {
        Text("\(value)$")
            .font(.system(size: 9, weight: .bold, design: .rounded))
            .foregroundStyle(P.ink2)
    }

    private func ownerDot(_ owner: PlayerState) -> some View {
        VStack {
            HStack {
                Circle().fill(Color(css: owner.color))
                    .frame(width: 10, height: 10)
                    .overlay(Circle().stroke(.white, lineWidth: 1))
                Spacer(minLength: 0)
            }
            Spacer(minLength: 0)
        }
        .padding(2)
    }
}

// MARK: - tokens

/// Walks each token tile-by-tile when its player moved by dice — with a tick
/// per step and a soft thump on arrival — and glides it when teleported.
@MainActor
final class TokenWalker: ObservableObject {
    @Published var shown: [String: Int] = [:]
    private var tasks: [String: Task<Void, Never>] = [:]
    private var targets: [String: Int] = [:]
    private var lastMoveAt: Double = 0

    func reconcile(_ state: GameState) {
        let alive = state.players.filter { !$0.isBankrupt }
        for gone in shown.keys where !alive.contains(where: { $0.id == gone }) {
            shown.removeValue(forKey: gone)
            tasks[gone]?.cancel()
        }

        let move = state.lastMove
        let fresh = move != nil && move!.at != lastMoveAt
        if fresh { lastMoveAt = move!.at }

        for p in alive {
            let current = shown[p.id]
            guard current != p.pos else { targets.removeValue(forKey: p.id); continue }
            // A walk already heading to this exact tile keeps going — state
            // pushes mid-walk (rent, cards) must not snap the token forward.
            if targets[p.id] == p.pos, tasks[p.id] != nil { continue }
            tasks[p.id]?.cancel()

            // First sight of a player, or a teleport: glide straight there.
            guard let from = current, fresh, let move, move.playerId == p.id, move.steps != 0 else {
                shown[p.id] = p.pos
                if current != nil { SoundKit.shared.land() }
                continue
            }

            let size = state.map.size
            let dir = move.steps > 0 ? 1 : -1
            let distance = dir > 0 ? (p.pos - from + size) % size : (from - p.pos + size) % size
            let pace: Duration = .milliseconds(distance > 12 ? 70 : distance > 7 ? 95 : 130)
            let target = p.pos
            targets[p.id] = target

            tasks[p.id] = Task { [weak self] in
                var at = from
                for _ in 0..<distance {
                    guard !Task.isCancelled else { return }
                    at = (at + dir + size) % size
                    self?.shown[p.id] = at
                    if at == target { SoundKit.shared.land() } else { SoundKit.shared.step() }
                    UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.55)
                    try? await Task.sleep(for: pace)
                }
                self?.tasks.removeValue(forKey: p.id)
                self?.targets.removeValue(forKey: p.id)
            }
        }
    }
}

struct TokenLayer: View {
    @EnvironmentObject var store: GameStore
    @StateObject private var walker = TokenWalker()
    let geom: BoardGeometry

    var body: some View {
        if let state = store.state, state.isPlaying || state.isEnded {
            let alive = state.players.filter { !$0.isBankrupt }
            ZStack(alignment: .topLeading) {
                ForEach(alive) { p in
                    PlacedToken(player: p, alive: alive, walker: walker, geom: geom,
                                isTurn: state.turn?.playerId == p.id)
                }
            }
            .onChange(of: state.lastMove?.at) { walker.reconcile(state) }
            .onChange(of: state.version) { walker.reconcile(state) }
            .onAppear { walker.reconcile(state) }
        }
    }
}

/// One token, standing at its tile's inner edge (pushed toward the middle of
/// the board so it never covers the flag or the price).
private struct PlacedToken: View {
    let player: PlayerState
    let alive: [PlayerState]
    @ObservedObject var walker: TokenWalker
    let geom: BoardGeometry
    let isTurn: Bool

    private static let slots: [(CGFloat, CGFloat)] = [
        (-0.20, -0.18), (0.20, -0.18), (-0.20, 0.18), (0.20, 0.18),
        (0, -0.30), (0, 0.30), (-0.34, 0), (0.34, 0),
    ]

    private var position: CGPoint {
        let pos = walker.shown[player.id] ?? player.pos
        let frame = geom.frame(of: pos)
        let cohort = alive.filter { (walker.shown[$0.id] ?? $0.pos) == pos }
        var slot: (CGFloat, CGFloat) = (0, 0)
        if cohort.count > 1, let k = cohort.firstIndex(where: { $0.id == player.id }) {
            slot = Self.slots[k % Self.slots.count]
        }
        let mid = CGPoint(x: geom.size.width / 2, y: geom.size.height / 2)
        let v = CGVector(dx: mid.x - frame.midX, dy: mid.y - frame.midY)
        let len = max(1, (v.dx * v.dx + v.dy * v.dy).squareRoot())
        // Corners hold big art plus a label, so pieces stand further in there.
        let isCorner = geom.layout.corners.contains(pos)
        let push = min(frame.width, frame.height) * (isCorner ? 0.58 : 0.42)
        return CGPoint(
            x: frame.midX + v.dx / len * push + slot.0 * frame.width * 0.45,
            y: frame.midY + v.dy / len * push + slot.1 * frame.height * 0.45
        )
    }

    var body: some View {
        let pos = walker.shown[player.id] ?? player.pos
        TokenDisc(player: player, highlighted: isTurn)
            .position(position)
            .animation(.spring(duration: 0.26, bounce: 0.42), value: pos)
            .zIndex(isTurn ? 10 : 5)
    }
}

struct TokenDisc: View {
    let player: PlayerState
    let highlighted: Bool
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(Color(css: player.color))
            .frame(width: 20, height: 20)
            .overlay(
                Text(String(player.name.prefix(1)).uppercased())
                    .font(.system(size: 9.5, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
            )
            .overlay(Circle().stroke(.white, lineWidth: highlighted ? 2 : 1.2))
            .shadow(color: .black.opacity(0.45), radius: 3, y: 2)
            .scaleEffect(highlighted && pulse ? 1.18 : 1)
            .animation(highlighted ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true) : .default, value: pulse)
            .onAppear { pulse = true }
    }
}

// MARK: - dice

struct DiceView: View {
    let values: [Int]
    var size: CGFloat = 42
    @State private var spin = false

    var body: some View {
        HStack(spacing: size * 0.28) {
            ForEach(Array(values.enumerated()), id: \.offset) { _, v in
                DieFace(value: v, size: size)
            }
        }
        .rotationEffect(.degrees(spin ? 0 : -18))
        .scaleEffect(spin ? 1 : 0.6)
        .animation(.spring(duration: 0.45, bounce: 0.45), value: spin)
        .onAppear { spin = true }
        .onChange(of: values) { spin = false; DispatchQueue.main.async { spin = true } }
    }
}

struct DieFace: View {
    let value: Int
    var size: CGFloat = 42

    private static let pips: [Int: [Int]] = [
        1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
    ]

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
            .fill(LinearGradient(colors: [.white, Color(hex: 0xEFE7E2)], startPoint: .top, endPoint: .bottom))
            .frame(width: size, height: size)
            .overlay(
                Grid(horizontalSpacing: size * 0.095, verticalSpacing: size * 0.095) {
                    ForEach(0..<3) { row in
                        GridRow {
                            ForEach(0..<3) { col in
                                Circle()
                                    .fill(Color(hex: 0x1B5E3F))
                                    .frame(width: size * 0.167, height: size * 0.167)
                                    .opacity(Self.pips[value]?.contains(row * 3 + col) == true ? 1 : 0)
                            }
                        }
                    }
                }
                .padding(size * 0.167)
            )
            .shadow(color: .black.opacity(0.35), radius: size * 0.12, y: size * 0.07)
    }
}
