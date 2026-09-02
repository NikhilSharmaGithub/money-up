// The board: a square grid computed from the map's layout (sides can be any
// length — Blitz is 6 a side, Worldwide 11), tokens animating between tiles,
// and a centre well the game screen drops its dice/actions into.
//
// Tiles read like richup's: a round flag medallion riding the inner edge,
// tiny street name, price — and once a tile is bought its colour band turns
// into the owner's colour, so a glance at the ring tells you who holds
// what. A full country gets a thicker band. Every mark on a tile is drawn
// (see Art.swift): emoji were another vendor's artwork and made the same
// board look different on every device.

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
    /// Drives the "whole set completed" celebration: the tile floods with the
    /// owner's colour and pulses back three times.
    @State private var setFlash = false

    private var ownership: TileOwnership? { store.state?.owner(of: tile.index) }
    private var ownerPlayer: PlayerState? { store.state?.player(ownership?.owner) }
    private var isActive: Bool {
        guard let state = store.state, state.isPlaying else { return false }
        return store.currentPlayer?.pos == tile.index
    }

    /// The whole country (or airport/utility family) in one player's hands.
    private var isFullSet: Bool {
        guard let state = store.state, let ownerId = ownership?.owner,
              let g = tile.group, let idxs = state.map.groups?[g], !idxs.isEmpty else { return false }
        return idxs.allSatisfy { state.owner(of: $0)?.owner == ownerId }
    }

    /// Where this tile flies in from when the deck deals the board out —
    /// every card starts at the middle of the table.
    private var dealOffset: CGSize {
        let frame = geom.frame(of: tile.index)
        return CGSize(width: geom.size.width / 2 - frame.midX,
                      height: geom.size.height / 2 - frame.midY)
    }

    /// A matchmade table waiting for players keeps every tile in the deck —
    /// the board doesn't exist until kick-off deals it out (an idle DeckIntro
    /// sits in the well meanwhile). Private lobbies keep their preview: the
    /// host picked that map to look at it. Anything already playing — a
    /// reconnect, a join mid-game — is never held back here.
    private var heldInDeck: Bool {
        guard let state = store.state else { return false }
        return state.isLobby && state.quick == true
    }

    var body: some View {
        let P = Palette.current(scheme)
        let group = store.groupInfo(for: tile)
        // richup rule: a bought tile wears its owner's colour, not the group's.
        // The medallion already says which country a street belongs to — an
        // unowned tile stays clean. The band appears only once somebody owns
        // it, wearing the owner's colour (thicker for a full set).
        let bandColor = ownerPlayer.map { Color(css: $0.color) }

        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(faceColor(P))

            // colour band on the edge facing the middle
            if let bandColor {
                band(color: bandColor, thickness: isFullSet ? 9 : 5)
            }

            content(P: P, group: group)

            // owner wash over the face
            if let owner = ownerPlayer {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color(css: owner.color).opacity(isFullSet ? 0.30 : 0.18))

                // set-completed celebration: flood with the owner's colour,
                // then breathe back to the resting wash
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color(css: owner.color))
                    .opacity(setFlash ? 0.88 : 0)
                    .allowsHitTesting(false)
            }

            if ownership?.isMortgaged == true {
                // White on the dim wash: the tile underneath can be any colour.
                Art.icon(.bank, size: 13, tint: .white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.black.opacity(0.25))
            }

            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(isActive ? P.gold : P.rule, lineWidth: isActive ? 2 : 0.7)
        }
        // The country's medallion, worn richup-style: half on the tile, half
        // over the board, centred on the inner edge — the same edge the band
        // hugs, so the flag sits in its group's colour. Houses and the hotel
        // marquee take over the face once building starts, so the coin steps
        // aside rather than jostle them.
        .overlay(alignment: medallionAlignment) {
            // The house signs live in the tile body, so the street keeps its
            // nationality while it grows — the coin never leaves the edge.
            if tile.type == "property" {
                Art.groupMedallion(group?.flag,
                                   group.map { Color(css: $0.color) } ?? P.ink3,
                                   size: medallionSize)
                    .offset(medallionOffset)
                    .allowsHitTesting(false)
            }
        }
        .shadow(color: isActive ? P.gold.opacity(0.5) : .clear, radius: 6)
        // On the table only once dealt AND out of the quick-match deck — the
        // undealt pose is exactly the one the deal animation flies out of.
        .scaleEffect(dealt && !heldInDeck ? 1 : 0.22)
        .rotationEffect(.degrees(dealt && !heldInDeck ? 0 : -24))
        .offset(dealt && !heldInDeck ? .zero : dealOffset)
        .opacity(dealt && !heldInDeck ? 1 : 0)
        // An invisible tile must not answer taps: opacity 0 doesn't stop hit
        // testing, and the held pose piles every tile's touch area onto the
        // middle of the table — right under the waiting deck.
        .allowsHitTesting(!heldInDeck)
        .onAppear { runDealIfFresh() }
        .onChange(of: store.boardIntroAt) { runDealIfFresh() }
        .onChange(of: isFullSet) { was, now in
            guard now, !was else { return }
            celebrateSet()
        }
    }

    /// Three deep pulses of the owner's colour, ~3.3s in all.
    private func celebrateSet() {
        Task { @MainActor in
            for _ in 0..<3 {
                withAnimation(.easeIn(duration: 0.4)) { setFlash = true }
                try? await Task.sleep(for: .milliseconds(450))
                withAnimation(.easeOut(duration: 0.55)) { setFlash = false }
                try? await Task.sleep(for: .milliseconds(650))
            }
        }
    }

    /// The deal-in: every tile starts as a card on the deck in the middle of
    /// the table, then flies to its place one after another — the deck in the
    /// centre riffle-shuffles first (see DeckIntro), so the deal waits for it.
    private func runDealIfFresh() {
        guard let at = store.boardIntroAt, Date().timeIntervalSince(at) < 3 else { return }
        dealt = false
        withAnimation(.spring(duration: 0.55, bounce: 0.32).delay(0.9 + Double(tile.index) * 0.028)) {
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

    /// Medallion diameter, cut to the tile: Blitz's chunky tiles and
    /// Worldwide's slim ones both get a coin that looks deliberate.
    private var medallionSize: CGFloat {
        let f = geom.frame(of: tile.index)
        return min(21, max(13, min(f.width, f.height) * 0.5))
    }

    /// Which edge of the frame the medallion clings to — always the inner
    /// one, mirroring band(): bottom row wears it up top, top row down low,
    /// the columns on whichever side faces the middle.
    private var medallionAlignment: Alignment {
        switch geom.side(of: tile.index) {
        case .top: .bottom
        case .bottom: .top
        case .trailing: .leading
        default: .trailing
        }
    }

    /// The half-out nudge: pushed one radius past the inner edge so the coin
    /// straddles it — half on the tile, half over the table.
    private var medallionOffset: CGSize {
        let r = medallionSize / 2
        return switch geom.side(of: tile.index) {
        case .top: CGSize(width: 0, height: r)
        case .bottom: CGSize(width: 0, height: -r)
        case .trailing: CGSize(width: -r, height: 0)
        default: CGSize(width: r, height: 0)
        }
    }

    @ViewBuilder private func band(color: Color, thickness: CGFloat = 5) -> some View {
        let edge = geom.side(of: tile.index)
        // The band hugs the edge that faces the centre of the board.
        VStack(spacing: 0) {
            if edge == .bottom { color.frame(height: thickness); Spacer(minLength: 0) }
            else if edge == .top { Spacer(minLength: 0); color.frame(height: thickness) }
            else {
                HStack(spacing: 0) {
                    if edge == .trailing { color.frame(width: thickness); Spacer(minLength: 0) }
                    else { Spacer(minLength: 0); color.frame(width: thickness) }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .animation(.spring(duration: 0.4), value: thickness)
    }

    @ViewBuilder private func content(P: Palette, group: GroupInfo?) -> some View {
        let houses = ownership?.houseCount ?? 0
        VStack(spacing: 1) {
            switch tile.type {
            case "property":
                // The flag left the face for the medallion on the inner edge
                // (see the overlay in body), so the name leads the card now.
                nameText(P)
                if houses == 5 {
                    // The hotel gets a marquee, not a dot.
                    HStack(spacing: 2) {
                        Art.icon(.hotel, size: 10, tint: .white)
                        Text("HOTEL")
                            .font(.system(size: 6.5, weight: .black, design: .rounded))
                            .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 4).padding(.vertical, 1.5)
                    .background(LinearGradient(colors: [P.red, P.redDeep],
                                               startPoint: .top, endPoint: .bottom),
                                in: Capsule())
                } else if houses > 0 {
                    HStack(spacing: 2) {
                        Art.icon(.house, size: 10, tint: P.good)
                        if houses > 1 {
                            Text("\(houses)×")
                                .font(.system(size: 8.5, weight: .black, design: .rounded))
                                .foregroundStyle(P.good)
                        }
                    }
                }
                // The price never leaves — the buildings stack above it.
                if let price = tile.price {
                    priceText(price, P)
                }
            case "airport":
                // Airline blue, the colour the web tile paints the same plane.
                Art.icon(.plane, size: 12, tint: Color(hex: 0x3F6FAE))
                nameText(P)
                if let price = tile.price { priceText(price, P) }
            case "utility":
                Art.icon(utilityGlyph(tile.icon), size: 12)
                nameText(P)
                if let price = tile.price { priceText(price, P) }
            case "treasure": Art.icon(.toolbox, size: 18)
            case "surprise": Art.icon(.question, size: 18, tint: P.red)
            case "tax":
                Art.icon(.payment, size: 15)
                Text(tile.amount.map { "$\($0)" } ?? "\(tile.percent ?? 10)%")
                    .font(.system(size: 7, weight: .bold)).foregroundStyle(P.ink2)
            case "refund":
                Art.icon(.cash, size: 15)
                if let amount = tile.amount { priceText(amount, P) }
            case "start":
                Text("▶▶").font(.system(size: 16, weight: .black)).foregroundStyle(P.good)
                Text("START").font(.system(size: 9.5, weight: .heavy)).foregroundStyle(P.good)
            case "prison":
                Art.icon(.police, size: 21)
                Text("PRISON").font(.system(size: 8.5, weight: .heavy)).foregroundStyle(P.ink3)
            case "vacation":
                Art.icon(.island, size: 21)
            case "gotoprison":
                // The sentence, not the cell — the cell is the prison corner,
                // and two police caps on one board would read as the same tile.
                Art.icon(.gavel, size: 20, tint: P.bad)
            default:
                EmptyView()
            }
        }
        .minimumScaleFactor(0.6)
        .padding(2)
    }

    private func priceText(_ value: Int, _ P: Palette) -> some View {
        Text("\(value)$")
            .font(.system(size: 8.5, weight: .bold, design: .rounded))
            .foregroundStyle(P.ink2)
    }

    /// Tiny street name — two lines max, shrinking before it ever clips.
    private func nameText(_ P: Palette) -> some View {
        Text(tile.name)
            .font(.system(size: 6.8, weight: .bold, design: .rounded))
            .foregroundStyle(P.ink)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.7)
            .frame(maxWidth: .infinity)
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

    private var seenActionAt: Double = 0

    func reconcile(_ state: GameState) {
        let alive = state.players.filter { !$0.isBankrupt }
        for gone in shown.keys where !alive.contains(where: { $0.id == gone }) {
            shown.removeValue(forKey: gone)
            tasks[gone]?.cancel()
        }

        // A scripted action plays leg by leg; the legacy single-move path
        // below stays for old servers and for everyone the script skips.
        let legs = state.moves ?? []
        var scripted: String? = nil
        if let newest = legs.last?.at, newest != seenActionAt, let pid = legs.first?.playerId {
            seenActionAt = newest
            if shown[pid] != nil { playLegs(legs, state: state); scripted = pid }
        }

        let move = state.lastMove
        let fresh = move != nil && move!.at != lastMoveAt
        if fresh { lastMoveAt = move!.at }

        for p in alive where p.id != scripted {
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

    /// Walks one action's legs on their cues: dice lead-in first, the card's
    /// leg only after the popup has had its read, teleport legs as one glide.
    private func playLegs(_ legs: [MoveLeg], state: GameState) {
        guard let pid = legs.first?.playerId, let finalTo = legs.last?.to else { return }
        tasks[pid]?.cancel()
        targets[pid] = finalTo
        let size = state.map.size
        let hasCard = state.lastCard.map { abs($0.at - (legs.last?.at ?? 0)) < 2500 } ?? false
        let (starts, _) = Choreography.timeline(legs, boardSize: size, hasCard: hasCard)
        let t0 = Date()

        tasks[pid] = Task { [weak self] in
            for (i, leg) in legs.enumerated() {
                let wait = starts[i] - Date().timeIntervalSince(t0)
                if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
                guard !Task.isCancelled else { return }
                let d = Choreography.distance(of: leg, boardSize: size)
                guard d > 0 else {
                    self?.shown[pid] = leg.to
                    SoundKit.shared.land()
                    continue
                }
                let dir = leg.steps > 0 ? 1 : -1
                let pace = Choreography.pace(forDistance: d)
                var at = leg.from
                for _ in 0..<d {
                    guard !Task.isCancelled else { return }
                    at = (at + dir + size) % size
                    self?.shown[pid] = at
                    if at == leg.to { SoundKit.shared.land() } else { SoundKit.shared.step() }
                    UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.55)
                    try? await Task.sleep(for: .seconds(pace))
                }
            }
            self?.tasks.removeValue(forKey: pid)
            self?.targets.removeValue(forKey: pid)
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
            .onChange(of: state.moves?.last?.at) { walker.reconcile(state) }
            .onChange(of: state.version) { walker.reconcile(state) }
            .onAppear { walker.reconcile(state) }
        }
    }
}

/// One token, standing at its tile's inner edge (pushed toward the middle of
/// the board, clear of the name and price — it stands over the flag medallion
/// there, the way a piece sits on a coin, and the token layer draws on top).
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
                // a store token skin replaces the initial on the piece
                Group {
                    if let skin = player.tokenSkin, !skin.isEmpty {
                        Text(skin).font(.system(size: 12.5))
                    } else {
                        Text(String(player.name.prefix(1)).uppercased())
                            .font(.system(size: 9.5, weight: .black, design: .rounded))
                            .foregroundStyle(.white)
                    }
                }
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
