// The trade composer: pick tiles, cash and prison cards on both sides of the
// deal, then send the offer. Mirrors the web client's trade builder — tiles
// with houses on them are shown but locked, because the server refuses them.

import SwiftUI

struct TradeSheet: View {
    /// The seat making the offer — a corner pod trades as its own player.
    let fromId: String
    let targetId: String
    /// When negotiating, the incoming offer this one replaces — it gets
    /// declined the moment the counter-offer goes out.
    let counterOf: Int?

    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var giveTiles: Set<Int>
    @State private var getTiles: Set<Int>
    @State private var giveCash: Int
    @State private var getCash: Int
    @State private var giveCards: Int
    @State private var getCards: Int

    init(fromId: String, targetId: String, preselectedGive: Set<Int> = [], preselectedGet: Set<Int> = []) {
        self.fromId = fromId
        self.targetId = targetId
        self.counterOf = nil
        _giveTiles = State(initialValue: preselectedGive)
        _getTiles = State(initialValue: preselectedGet)
        _giveCash = State(initialValue: 0)
        _getCash = State(initialValue: 0)
        _giveCards = State(initialValue: 0)
        _getCards = State(initialValue: 0)
    }

    /// Negotiate an incoming offer: open the composer pre-filled with the
    /// same deal seen from this seat's side, ready to be nudged and returned.
    init(countering trade: TradeOffer) {
        self.fromId = trade.to
        self.targetId = trade.from
        self.counterOf = trade.id
        _giveTiles = State(initialValue: Set(trade.get.tiles))
        _getTiles = State(initialValue: Set(trade.give.tiles))
        _giveCash = State(initialValue: trade.get.money)
        _getCash = State(initialValue: trade.give.money)
        _giveCards = State(initialValue: trade.get.cards)
        _getCards = State(initialValue: trade.give.cards)
    }

    private var fromPlayer: PlayerState? { store.state?.player(fromId) }

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            Group {
                if let target = store.state?.player(targetId) {
                    content(target: target, P: P)
                } else {
                    missingTarget(P)
                }
            }
            .background(P.sheet.ignoresSafeArea())
            .navigationTitle(counterOf == nil ? "Trade" : "Negotiate")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(counterOf == nil ? "Send" : "Counter") { send() }
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .disabled(store.state?.player(targetId) == nil)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear {
            // Negotiating: the other side sees you're reading their offer.
            if let counterOf { store.setTradeViewing(counterOf, true, as: fromId) }
        }
        .onDisappear {
            // Harmless after a counter was sent — the store skips dead offers.
            if let counterOf { store.setTradeViewing(counterOf, false, as: fromId) }
        }
    }

    // MARK: - main content

    private func content(target: PlayerState, P: Palette) -> some View {
        ScrollView {
            VStack(spacing: 12) {
                header(target: target, P: P)

                dealMeter(P)

                balanceRow(P)

                sideCard(
                    title: "You give",
                    tileIndexes: myTileIndexes,
                    selection: $giveTiles,
                    cash: $giveCash, cashLimit: fromPlayer?.money ?? 0,
                    cards: $giveCards, cardLimit: fromPlayer?.getOutCards ?? 0,
                    P: P
                )

                sideCard(
                    title: "You get",
                    tileIndexes: targetTileIndexes,
                    selection: $getTiles,
                    cash: $getCash, cashLimit: target.money,
                    cards: $getCards, cardLimit: target.getOutCards ?? 0,
                    P: P
                )
            }
            .padding(12)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func header(target: PlayerState, P: Palette) -> some View {
        HStack(spacing: 18) {
            VStack(spacing: 4) {
                AvatarView(
                    name: fromPlayer?.name ?? "You",
                    colorCSS: fromPlayer?.color ?? "#888888",
                    flag: fromPlayer?.flag ?? "",
                    size: 44,
                    emoji: fromPlayer?.avatar ?? ""
                )
                Text(store.isLocal(fromId) && fromId == store.meId ? "You" : (fromPlayer?.name ?? "You"))
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink2)
                    .lineLimit(1)
            }
            Image(systemName: "arrow.left.arrow.right")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(P.red)
            VStack(spacing: 4) {
                AvatarView(
                    name: target.name,
                    colorCSS: target.color,
                    flag: target.flag ?? "",
                    size: 44,
                    emoji: target.avatar ?? ""
                )
                Text(target.name)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink2)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
    }

    // MARK: - deal meter

    /// Face value of one side of the deal — cash + card value + sticker prices.
    /// Face value only; it can't know how badly you need that last street.
    private func sideWorth(tiles: Set<Int>, cash: Int, cards: Int) -> Int {
        cash + cards * 50 + tiles.reduce(0) { $0 + (store.tile($1)?.price ?? 0) }
    }

    /// Live "You give $X ⇄ You get $Y — verdict" strip, mirroring the web
    /// composer, so a lopsided deal announces itself before it's sent.
    private func dealMeter(_ P: Palette) -> some View {
        let give = sideWorth(tiles: giveTiles, cash: giveCash, cards: giveCards)
        let get = sideWorth(tiles: getTiles, cash: getCash, cards: getCards)
        let diff = get - give
        let verdict: (String, Color) = (give == 0 && get == 0) ? ("build a deal below", P.ink3)
            : abs(diff) < 25 ? ("even trade", P.ink3)
            : diff > 0 ? ("+\(money(diff)) your way", P.good)
            : ("\(money(-diff)) in their favour", P.bad)

        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text("You give").font(.system(size: 10, weight: .semibold)).foregroundStyle(P.ink3)
                Text(money(give))
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.bad)
            }
            Spacer()
            Text(verdict.0)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(verdict.1)
                .multilineTextAlignment(.center)
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text("You get").font(.system(size: 10, weight: .semibold)).foregroundStyle(P.ink3)
                Text(money(get))
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.good)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(P.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(P.rule, lineWidth: 1))
    }

    // MARK: - balance it

    /// What the deal is short by, from the proposer's point of view: positive
    /// means this side is getting the better end and owes the difference.
    private var dealGap: Int {
        sideWorth(tiles: getTiles, cash: getCash, cards: getCards)
            - sideWorth(tiles: giveTiles, cash: giveCash, cards: giveCards)
    }

    /// The most cash the side that owes the difference can still put in.
    private var balanceRoom: Int {
        dealGap > 0
            ? max(0, (fromPlayer?.money ?? 0) - giveCash)
            : max(0, (store.state?.player(targetId)?.money ?? 0) - getCash)
    }

    /// Tops up the lighter side with cash until the meter reads even — but
    /// only with money that side actually has. A deal that can't be paid isn't
    /// a fair deal, so a short side stays visibly short.
    @ViewBuilder private func balanceRow(_ P: Palette) -> some View {
        let gap = dealGap
        let needed = abs(gap)
        let room = balanceRoom
        if needed >= 25 {
            HStack(spacing: 10) {
                // "your side" read as "in your favour" right under a meter
                // saying the deal already tilts your way. Say who pays.
                Text(room == 0
                     ? (gap > 0 ? "You have no cash left to even this out." : "They have no cash left to even this out.")
                     : room >= needed
                        ? (gap > 0 ? "You'd put in \(money(needed)) to make it even"
                                   : "They'd put in \(money(needed)) to make it even")
                        : "Only \(money(room)) spare — this gets as close as it can")
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 6)
                if room > 0 {
                    MMIconButton(.scales, "Balance it", kind: .gold) { balance() }
                }
            }
            .padding(.horizontal, 2)
        }
    }

    private func balance() {
        let gap = dealGap
        guard gap != 0 else { return }
        if gap > 0 {
            giveCash = min(giveCash + gap, max(0, fromPlayer?.money ?? 0))
        } else {
            getCash = min(getCash - gap, max(0, store.state?.player(targetId)?.money ?? 0))
        }
        Haptics.tap()
    }

    // MARK: - one side of the deal

    private func sideCard(
        title: String,
        tileIndexes: [Int],
        selection: Binding<Set<Int>>,
        cash: Binding<Int>, cashLimit: Int,
        cards: Binding<Int>, cardLimit: Int,
        P: Palette
    ) -> some View {
        MMCard {
            VStack(alignment: .leading, spacing: 10) {
                PanelTitle(title)

                if tileIndexes.isEmpty {
                    Text("No properties to trade")
                        .font(.system(size: 12.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                } else {
                    VStack(spacing: 6) {
                        ForEach(tileIndexes, id: \.self) { i in
                            tileRow(i, selection: selection, P: P)
                        }
                    }
                }

                Divider().overlay(P.rule)

                cashRow(value: cash, limit: cashLimit, P: P)

                if cardLimit > 0 {
                    cardsRow(value: cards, limit: cardLimit, P: P)
                }
            }
        }
    }

    private func tileRow(_ i: Int, selection: Binding<Set<Int>>, P: Palette) -> some View {
        let tile = store.tile(i)
        let own = store.state?.owner(of: i)
        let hasHouses = own?.houseCount ?? 0 > 0
        let selected = selection.wrappedValue.contains(i)

        return Button {
            if selected {
                selection.wrappedValue.remove(i)
            } else {
                selection.wrappedValue.insert(i)
            }
            Haptics.tap()
        } label: {
            HStack(spacing: 9) {
                Circle()
                    .fill(groupColor(for: tile, P: P))
                    .frame(width: 10, height: 10)
                Text(tile?.name ?? "Tile \(i)")
                    .font(.system(size: 13.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                if own?.isMortgaged == true {
                    Text("MORTGAGED")
                        .font(.system(size: 7.5, weight: .black))
                        .foregroundStyle(P.ink3)
                }
                if hasHouses {
                    Art.icon(.house, size: 13)
                }
                Spacer(minLength: 6)
                if let price = tile?.price {
                    Text(money(price))
                        .font(.system(size: 12.5, weight: .bold, design: .rounded))
                        .foregroundStyle(P.ink2)
                }
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 17))
                    .foregroundStyle(selected ? P.good : P.ink3)
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 10)
            .background(
                selected ? P.goodSoft : P.sunken,
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(selected ? P.good.opacity(0.5) : .clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(hasHouses)
        .opacity(hasHouses ? 0.45 : 1)
    }

    /// A slider instead of a keypad: the track ends at the player's own cash,
    /// so an amount they don't have can't be dragged to, and the deal meter
    /// above re-totals with every pixel of the thumb.
    private func cashRow(value: Binding<Int>, limit: Int, P: Palette) -> some View {
        let cap = max(0, limit)
        let shown = min(max(0, value.wrappedValue), cap)
        return VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Text("Cash")
                    .font(.system(size: 13.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink)
                Spacer()
                Text(money(shown))
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                    .foregroundStyle(shown > 0 ? P.ink : P.ink3)
                    .contentTransition(.numericText())
                    .animation(.snappy(duration: 0.2), value: shown)
                    .padding(.vertical, 4)
                    .padding(.horizontal, 11)
                    .background(P.sunken, in: Capsule())
                    .overlay(Capsule().stroke(P.rule, lineWidth: 1))
            }
            Slider(value: cashSlider(value, limit: cap), in: 0...Double(max(cap, 1)), step: 1)
                .tint(P.red)
                .disabled(cap == 0)
                .opacity(cap == 0 ? 0.45 : 1)
            Text(cap == 0 ? "no cash to offer" : "up to \(money(cap))")
                .font(.system(size: 10.5, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink3)
        }
    }

    private func cardsRow(value: Binding<Int>, limit: Int, P: Palette) -> some View {
        HStack(spacing: 8) {
            Art.icon(.ticket, size: 15, tint: P.ink)
            Text("Prison cards")
                .font(.system(size: 13.5, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink)
            Spacer()
            Text("\(value.wrappedValue)")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(P.ink)
                .frame(minWidth: 22, alignment: .trailing)
            Stepper("", value: clampedValue(value, limit: limit), in: 0...max(0, limit))
                .labelsHidden()
        }
    }

    // MARK: - empty state

    private func missingTarget(_ P: Palette) -> some View {
        VStack(spacing: 12) {
            Art.icon(.door, size: 42, tint: P.ink3)
            Text("This player is no longer in the game.")
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink2)
            Button("Close") { dismiss() }
                .buttonStyle(MMButtonStyle(kind: .ghost))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - data helpers

    private var myTileIndexes: [Int] {
        guard let state = store.state else { return [] }
        return state.ownership.compactMap { key, own in
            own.owner == fromId ? Int(key) : nil
        }.sorted()
    }

    private var targetTileIndexes: [Int] {
        guard let state = store.state else { return [] }
        return state.ownership.compactMap { key, own in
            own.owner == targetId ? Int(key) : nil
        }.sorted()
    }

    private func groupColor(for tile: TileData?, P: Palette) -> Color {
        guard let tile else { return P.ink3 }
        if let info = store.groupInfo(for: tile) { return Color(css: info.color) }
        return P.ink3
    }

    /// Slider binding onto the Int cash amount, re-clamped on the way in as
    /// well as out — the limit can shrink while the sheet is open.
    private func cashSlider(_ value: Binding<Int>, limit: Int) -> Binding<Double> {
        Binding(
            get: { Double(min(max(0, value.wrappedValue), max(0, limit))) },
            set: { value.wrappedValue = min(max(0, Int($0.rounded())), max(0, limit)) }
        )
    }

    /// Stepper binding that re-clamps in case the limit shrank mid-edit.
    private func clampedValue(_ value: Binding<Int>, limit: Int) -> Binding<Int> {
        Binding(
            get: { min(max(0, value.wrappedValue), max(0, limit)) },
            set: { value.wrappedValue = min(max(0, $0), max(0, limit)) }
        )
    }

    // MARK: - send

    private func send() {
        guard let state = store.state, let target = state.player(targetId) else {
            dismiss()
            return
        }

        // Re-validate against the freshest state: ownership or houses may
        // have changed while the sheet was open.
        let give = TradeSide(
            money: min(max(0, giveCash), max(0, fromPlayer?.money ?? 0)),
            tiles: giveTiles.filter {
                let own = state.owner(of: $0)
                return own?.owner == fromId && own?.houseCount ?? 0 == 0
            }.sorted(),
            cards: min(max(0, giveCards), max(0, fromPlayer?.getOutCards ?? 0))
        )
        let get = TradeSide(
            money: min(max(0, getCash), max(0, target.money)),
            tiles: getTiles.filter {
                let own = state.owner(of: $0)
                return own?.owner == targetId && own?.houseCount ?? 0 == 0
            }.sorted(),
            cards: min(max(0, getCards), max(0, target.getOutCards ?? 0))
        )

        let giveEmpty = give.money == 0 && give.tiles.isEmpty && give.cards == 0
        let getEmpty = get.money == 0 && get.tiles.isEmpty && get.cards == 0
        guard !(giveEmpty && getEmpty) else {
            store.showToast("Add something to the trade", isError: true)
            return
        }

        // A counter-offer replaces the deal on the table: decline theirs,
        // then send ours back the other way.
        if let counterOf, store.state?.trades.contains(where: { $0.id == counterOf }) == true {
            store.respondTrade(counterOf, accept: false)
        }
        store.proposeTrade(from: fromId, to: targetId, give: give, get: get)
        store.showToast(counterOf == nil ? "Offer sent" : "Counter-offer sent")
        dismiss()
    }
}

// MARK: - trade partner picker

/// "Who do you want to trade with?" — one tap on a player opens the composer.
/// This is the discoverable front door for trading on the phone.
struct TradePickerSheet: View {
    /// The seat making the offer — everyone except them is a possible partner.
    var fromId: String
    var give: Set<Int> = []
    let pick: (String) -> Void

    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        let partners = (store.state?.players ?? []).filter { !$0.isBankrupt && $0.id != fromId }

        NavigationStack {
            ScrollView {
                VStack(spacing: 8) {
                    if let i = give.first, give.count == 1, let tile = store.tile(i) {
                        Text("Offering \(tile.name)")
                            .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .padding(.top, 2)
                    }
                    ForEach(partners) { p in
                        partnerRow(p, P)
                    }
                    if partners.isEmpty {
                        Text("Nobody left to trade with.")
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .padding(.top, 40)
                    }
                }
                .padding(14)
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(P.sheet.ignoresSafeArea())
            .navigationTitle("Trade with…")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func partnerRow(_ p: PlayerState, _ P: Palette) -> some View {
        let owned = store.state?.ownership.values.filter { $0.owner == p.id }.count ?? 0
        let team = p.team.flatMap { store.state?.teamInfo?[safe: $0] }

        return Button {
            pick(p.id)
            Haptics.tap()
        } label: {
            HStack(spacing: 11) {
                AvatarView(name: p.name, colorCSS: p.color, flag: p.flag ?? "", size: 38, emoji: p.avatar ?? "")
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 5) {
                        Text(p.name)
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                            .lineLimit(1)
                        if p.isBot == true {
                            Text("BOT").font(.system(size: 8, weight: .black)).foregroundStyle(P.ink3)
                        }
                        if let team {
                            // The team's colour is the team's identity; the
                            // server's coloured-circle emoji only redrew it.
                            Circle().fill(Color(css: team.color)).frame(width: 9, height: 9)
                        }
                    }
                    Text("\(money(p.money))  ·  \(owned) propert\(owned == 1 ? "y" : "ies")")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                }
                Spacer()
                Image(systemName: "arrow.left.arrow.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(P.gold)
            }
            .padding(.vertical, 11)
            .padding(.horizontal, 13)
            .background(P.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(P.rule, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
