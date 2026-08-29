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
                Text(group?.flag ?? "🏳️").font(.system(size: 13))
                if houses > 0 {
                    Text(houses == 5 ? "🏨" : String(repeating: "▪︎", count: houses))
                        .font(.system(size: 7, weight: .black))
                        .foregroundStyle(P.good)
                } else if let price = tile.price {
                    priceText(price, P)
                }
            case "airport":
                Text("✈️").font(.system(size: 12))
                if let price = tile.price { priceText(price, P) }
            case "utility":
                Text(tile.icon ?? "💡").font(.system(size: 12))
                if let price = tile.price { priceText(price, P) }
            case "treasure": Text("🧰").font(.system(size: 14))
            case "surprise": Text("❓").font(.system(size: 14))
            case "tax":
                Text("💸").font(.system(size: 11))
                Text(tile.amount.map { "$\($0)" } ?? "\(tile.percent ?? 10)%")
                    .font(.system(size: 7, weight: .bold)).foregroundStyle(P.ink2)
            case "refund":
                Text("💵").font(.system(size: 11))
                if let amount = tile.amount { priceText(amount, P) }
            case "start":
                Text("▶▶").font(.system(size: 13, weight: .black)).foregroundStyle(P.good)
                Text("START").font(.system(size: 8, weight: .heavy)).foregroundStyle(P.good)
            case "prison":
                Text("🚔").font(.system(size: 16))
                Text("PRISON").font(.system(size: 7, weight: .heavy)).foregroundStyle(P.ink3)
            case "vacation":
                Text("🏝️").font(.system(size: 16))
            case "gotoprison":
                Text("🚨").font(.system(size: 16))
            default:
                EmptyView()
            }
        }
        .minimumScaleFactor(0.6)
        .padding(2)
    }

    private func priceText(_ value: Int, _ P: Palette) -> some View {
        Text("\(value)$")
            .font(.system(size: 7.5, weight: .bold, design: .rounded))
            .foregroundStyle(P.ink2)
    }

    private func ownerDot(_ owner: PlayerState) -> some View {
        VStack {
            HStack {
                Circle().fill(Color(css: owner.color))
                    .frame(width: 8, height: 8)
                    .overlay(Circle().stroke(.white, lineWidth: 1))
                Spacer(minLength: 0)
            }
            Spacer(minLength: 0)
        }
        .padding(2)
    }
}

// MARK: - tokens

struct TokenLayer: View {
    @EnvironmentObject var store: GameStore
    let geom: BoardGeometry

    private static let slots: [(CGFloat, CGFloat)] = [
        (-0.20, -0.18), (0.20, -0.18), (-0.20, 0.18), (0.20, 0.18),
        (0, -0.30), (0, 0.30), (-0.34, 0), (0.34, 0),
    ]

    var body: some View {
        if let state = store.state, state.isPlaying || state.isEnded {
            let alive = state.players.filter { !$0.isBankrupt }
            ForEach(alive) { p in
                let frame = geom.frame(of: p.pos)
                let cohort = alive.filter { $0.pos == p.pos }
                let slot = cohort.count > 1
                    ? Self.slots[(cohort.firstIndex(where: { $0.id == p.id }) ?? 0) % Self.slots.count]
                    : (0, 0)
                let isTurn = state.turn?.playerId == p.id

                TokenDisc(player: p, highlighted: isTurn)
                    .position(
                        x: frame.midX + slot.0 * frame.width,
                        y: frame.midY + slot.1 * frame.height
                    )
                    .animation(.spring(duration: 0.55, bounce: 0.25), value: p.pos)
                    .zIndex(isTurn ? 10 : 5)
            }
        }
    }
}

struct TokenDisc: View {
    let player: PlayerState
    let highlighted: Bool
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(Color(css: player.color))
            .frame(width: 17, height: 17)
            .overlay(
                Text(String(player.name.prefix(1)).uppercased())
                    .font(.system(size: 8, weight: .black, design: .rounded))
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
    @State private var spin = false

    var body: some View {
        HStack(spacing: 12) {
            ForEach(Array(values.enumerated()), id: \.offset) { _, v in
                DieFace(value: v)
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

    private static let pips: [Int: [Int]] = [
        1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
    ]

    var body: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(LinearGradient(colors: [.white, Color(hex: 0xEFE7E2)], startPoint: .top, endPoint: .bottom))
            .frame(width: 42, height: 42)
            .overlay(
                Grid(horizontalSpacing: 4, verticalSpacing: 4) {
                    ForEach(0..<3) { row in
                        GridRow {
                            ForEach(0..<3) { col in
                                Circle()
                                    .fill(Color(hex: 0xD92037))
                                    .frame(width: 7, height: 7)
                                    .opacity(Self.pips[value]?.contains(row * 3 + col) == true ? 1 : 0)
                            }
                        }
                    }
                }
                .padding(7)
            )
            .shadow(color: .black.opacity(0.35), radius: 5, y: 3)
    }
}
