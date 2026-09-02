// Title-deed sheet for any board tile, plus the "Your properties" manager.
// Both are presented from GameScreen and read/write only through GameStore.

import SwiftUI

// MARK: - shared helpers

/// Server rule mirror: buying back a mortgage costs the mortgage value + 10%.
private func unmortgageCost(_ price: Int) -> Int {
    Int(ceil(Double(price) / 2 * 1.1))
}

private struct DeedRow {
    let label: String
    let value: String
    var highlight = false
}

private struct DeedRowView: View {
    @Environment(\.colorScheme) private var scheme
    let row: DeedRow

    var body: some View {
        let P = Palette.current(scheme)
        HStack(alignment: .firstTextBaseline) {
            Text(row.label)
                .font(.system(size: 13.5, weight: row.highlight ? .bold : .medium, design: .rounded))
                .foregroundStyle(row.highlight ? P.red : P.ink2)
            Spacer(minLength: 12)
            Text(row.value)
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(row.highlight ? P.red : P.ink)
        }
        .padding(.vertical, 9)
    }
}

private struct DeedRowsCard: View {
    @Environment(\.colorScheme) private var scheme
    let rows: [DeedRow]

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { i, row in
                if i > 0 {
                    Rectangle().fill(P.rule).frame(height: 1)
                }
                DeedRowView(row: row)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 3)
        .background(P.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(P.rule, lineWidth: 1))
    }
}

// MARK: - deed sheet

struct DeedSheet: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    let tileIndex: Int

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                if let tile = store.tile(tileIndex) {
                    // Build / sell / mortgage ride directly under the title,
                    // above the rent table: on a street you own those buttons
                    // are why the sheet was opened, and eight rows of rent
                    // figures should never be the thing between them and a
                    // thumb. Reference numbers read fine underneath.
                    VStack(spacing: 12) {
                        header(tile, P)

                        if tile.isOwnable {
                            actionButtons(tile, P)
                        }

                        let rows = detailRows(tile)
                        if !rows.isEmpty {
                            DeedRowsCard(rows: rows)
                        }

                        if tile.isOwnable {
                            ownerCard(tile, P)
                        }
                    }
                    .padding(14)
                } else {
                    Text("Unknown tile")
                        .font(.system(size: 14, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .padding(.top, 40)
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(P.sheet.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    // MARK: header strip

    /// What the deed flies above its name. The header is already painted in
    /// the group's colour, so the banner flies in the header's ink instead —
    /// a same-coloured pennant on a same-coloured card is no pennant at all.
    @ViewBuilder
    private func headerBadge(_ tile: TileData, group: GroupInfo?, ink: Color) -> some View {
        switch tile.type {
        case "property":
            if let group { Art.groupFlag(group.flag, ink, size: 24) }
        case "airport":
            Art.icon(.plane, size: 22, tint: ink)
        case "utility":
            Art.icon(utilityGlyph(tile.icon), size: 22)
        default:
            EmptyView()
        }
    }

    private func header(_ tile: TileData, _ P: Palette) -> some View {
        let group = store.groupInfo(for: tile)
        let fill: Color
        let colored: Bool
        switch tile.type {
        case "property" where group != nil:
            fill = Color(css: group?.color ?? "#888888"); colored = true
        case "airport":
            fill = Color(hex: 0x5B8DEF); colored = true
        case "utility":
            fill = Color(hex: 0x22D3EE); colored = true
        default:
            fill = P.sunken; colored = false
        }
        let ink: Color = colored ? .white : P.ink

        return VStack(spacing: 6) {
            HStack(spacing: 8) {
                headerBadge(tile, group: group, ink: ink)
                Text(tile.name)
                    .font(.system(size: 20, weight: .heavy, design: .rounded))
                    .foregroundStyle(ink)
                    .multilineTextAlignment(.center)
            }
            if let price = tile.price {
                Text(money(price))
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(ink.opacity(colored ? 0.95 : 1))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .padding(.horizontal, 14)
        .background(fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(colored ? Color.white.opacity(0.18) : P.rule, lineWidth: 1)
        )
    }

    // MARK: rows

    private func detailRows(_ tile: TileData) -> [DeedRow] {
        let own = store.state?.owner(of: tileIndex)
        var rows: [DeedRow] = []

        switch tile.type {
        case "property":
            let rent = tile.rent ?? []
            let houses = own?.houseCount
            if let base = rent[safe: 0] {
                rows.append(DeedRow(label: "Base rent", value: money(base), highlight: houses == 0))
            }
            for n in 1...4 {
                if let r = rent[safe: n] {
                    rows.append(DeedRow(label: "With \(n) house\(n == 1 ? "" : "s")",
                                        value: money(r), highlight: houses == n))
                }
            }
            if let hotel = rent[safe: 5] {
                rows.append(DeedRow(label: "With hotel", value: money(hotel), highlight: houses == 5))
            }
            if let hc = tile.houseCost {
                rows.append(DeedRow(label: "House / hotel cost", value: money(hc)))
            }
            if let price = tile.price {
                rows.append(DeedRow(label: "Mortgage value", value: money(price / 2)))
            }

        case "airport":
            let rents = [25, 50, 100, 200]
            let held = ownerAirportCount
            for n in 1...4 {
                rows.append(DeedRow(label: "\(n) airport\(n == 1 ? "" : "s") owned",
                                    value: money(rents[n - 1]), highlight: held == n))
            }

        case "utility":
            rows.append(DeedRow(label: "1 utility owned", value: "4 × dice"))
            rows.append(DeedRow(label: "2 utilities", value: "10 × dice"))

        case "tax":
            if let amount = tile.amount {
                rows.append(DeedRow(label: "Pay", value: money(amount)))
            } else if let percent = tile.percent {
                rows.append(DeedRow(label: "Pay", value: "\(percent)%"))
            }

        default:
            break
        }
        return rows
    }

    /// How many airports the current owner of this tile holds.
    private var ownerAirportCount: Int {
        guard let state = store.state, let ownerId = state.owner(of: tileIndex)?.owner else { return 0 }
        return state.ownership.reduce(0) { acc, entry in
            guard entry.value.owner == ownerId,
                  let i = Int(entry.key),
                  state.map.tiles[safe: i]?.type == "airport" else { return acc }
            return acc + 1
        }
    }

    // MARK: owner + actions

    private func ownerCard(_ tile: TileData, _ P: Palette) -> some View {
        let own = store.state?.owner(of: tileIndex)
        let player = store.state?.player(own?.owner)
        return HStack {
            Text("Owner")
                .font(.system(size: 13.5, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink2)
            Spacer()
            if let own, let player {
                Text(player.name + (own.isMortgaged ? " (mortgaged)" : ""))
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(css: player.color))
            } else {
                Text("Bank")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(P.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(P.rule, lineWidth: 1))
    }

    /// The quick build bar. Raising a hotel is four taps in a row, so the
    /// buttons stay put and stay live: nothing here dismisses the sheet, and a
    /// move the rules refuse greys out instead of disappearing under a thumb.
    @ViewBuilder
    private func actionButtons(_ tile: TileData, _ P: Palette) -> some View {
        // Keyed to "a seat of OURS owns it", not to the turn: the server lets
        // deeds be managed off-turn, and on a pass & play phone a guest's
        // streets used to go dumb whenever the dice moved on. GameStore emits
        // each action from the owning seat's own socket.
        if let own = store.state?.owner(of: tileIndex), store.isLocal(own.owner) {
            let houses = own.houseCount
            let houseCost = tile.houseCost ?? 0
            let price = tile.price ?? 0
            VStack(spacing: 10) {
                HStack(spacing: 8) {
                    if tile.type == "property" {
                        quickButton(icon: "hammer.fill",
                                    caption: houses == 4 ? "Hotel" : "Build",
                                    detail: money(houseCost),
                                    kind: .good,
                                    enabled: store.canBuild(tileIndex) && houseCost > 0) {
                            store.build(tileIndex)
                        }
                        quickButton(icon: "minus.circle.fill",
                                    caption: houses == 5 ? "Sell hotel" : "Sell",
                                    detail: "+\(money(houseCost / 2))",
                                    kind: .ghost,
                                    enabled: store.canSellHouse(tileIndex)) {
                            store.sellHouse(tileIndex)
                        }
                    }
                    if own.isMortgaged {
                        quickButton(icon: "arrow.uturn.backward.circle.fill",
                                    caption: "Unmortgage",
                                    detail: money(unmortgageCost(price)),
                                    kind: .primary,
                                    enabled: store.state?.settings.mortgage != false && price > 0) {
                            store.unmortgage(tileIndex)
                        }
                    } else {
                        quickButton(icon: "banknote.fill",
                                    caption: "Mortgage",
                                    detail: "+\(money(price / 2))",
                                    kind: .gold,
                                    enabled: store.canMortgage(tileIndex)) {
                            store.mortgage(tileIndex)
                        }
                    }
                }

                if tile.type == "property" {
                    buildingLine(houses: houses, houseCost: houseCost, P)
                    if let why = buildBlocker(tile, own: own) {
                        Text(why)
                            .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    /// Why Build is greyed out. A dead button with no explanation is the most
    /// common thing a first-timer taps twice and then gives up on.
    private func buildBlocker(_ tile: TileData, own: TileOwnership) -> String? {
        guard tile.type == "property", !store.canBuild(tileIndex) else { return nil }
        if own.isMortgaged { return "Unmortgage this street before you can build." }
        if own.houseCount >= 5 { return "A hotel is as far as this street goes." }
        guard let group = tile.group, let idxs = store.state?.map.groups?[group] else { return nil }
        // Counted for the deed's own seat — on a pass & play phone that can be
        // a guest, and the tally has to be THEIR holdings, not the turn's.
        if !store.ownsFullGroup(own.owner, group: group) {
            let name = store.groupInfo(for: tile).map { "\($0.flag) \($0.name)" } ?? "this set"
            let held = idxs.filter { store.state?.owner(of: $0)?.owner == own.owner }.count
            return "Own all of \(name) to build — you hold \(held) of \(idxs.count)."
        }
        if idxs.contains(where: { store.state?.owner(of: $0)?.isMortgaged == true }) {
            return "Nothing can be built while a street in this set is mortgaged."
        }
        if store.state?.settings.evenBuild ?? true {
            let minHouses = idxs.map { store.state?.owner(of: $0)?.houseCount ?? 0 }.min() ?? 0
            if own.houseCount > minHouses {
                return "Even build: raise the rest of the set to \(own.houseCount) first."
            }
        }
        return nil
    }

    /// What's standing on the street right now, and what the next one costs —
    /// the two numbers a repeat-tapper is actually watching.
    private func buildingLine(houses: Int, houseCost: Int, _ P: Palette) -> some View {
        let standing = houses == 5 ? "Hotel standing"
            : houses == 0 ? "No buildings yet"
            : "\(houses) house\(houses == 1 ? "" : "s")"
        let next = houses >= 5 ? "fully built"
            : houseCost == 0 ? "—"
            : "next \(houses == 4 ? "hotel" : "house") \(money(houseCost))"

        return HStack(spacing: 7) {
            if houses == 5 {
                Art.icon(.hotel, size: 14)
            } else if houses > 0 {
                HStack(spacing: 2) {
                    ForEach(0..<houses, id: \.self) { _ in Art.icon(.house, size: 13) }
                }
            } else {
                // Nothing standing yet — the crane says building is what this
                // row is for, without pretending a house is already there.
                Art.icon(.crane, size: 14, tint: P.ink3)
            }
            Text(standing)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(P.ink2)
            Spacer(minLength: 6)
            Text(next)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink3)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(P.sunken, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
    }

    private func quickButton(
        icon: String, caption: String, detail: String,
        kind: MMButtonStyle.Kind, enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            action()
            Haptics.tap()
        } label: {
            VStack(spacing: 3) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .bold))
                Text(caption)
                    .font(.system(size: 10.5, weight: .bold, design: .rounded))
                    .lineLimit(1)
                Text(detail)
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .opacity(0.85)
            }
            .frame(maxWidth: .infinity)
        }
        // A blocked move drops to the neutral chip: a saturated green at 40%
        // still reads as a live button, and people kept tapping it.
        .buttonStyle(MMButtonStyle(kind: enabled ? kind : .ghost))
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
    }
}

// MARK: - properties sheet

struct PropertiesSheet: View {
    /// Hands a preselected tile set to the trade flow (picker → composer).
    var openTrade: ((Set<Int>) -> Void)? = nil
    /// Skips the picker: opens the composer at one player, already asking for
    /// the tiles handed over here.
    var askFor: ((String, Set<Int>) -> Void)? = nil

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss
    @State private var confirmBankrupt = false

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                content(P)
                    .padding(14)
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(P.sheet.ignoresSafeArea())
            .navigationTitle("Your properties")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if openTrade != nil, !store.myTiles().isEmpty {
                        Button {
                            openTrade?([])
                        } label: {
                            Label("Trade", systemImage: "arrow.left.arrow.right")
                                .font(.system(size: 13.5, weight: .bold, design: .rounded))
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                }
            }
        }
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private func content(_ P: Palette) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            raiseCashCard(P)
            propertyList(P)
        }
    }

    // MARK: - raising cash

    /// Owing money turns this sheet into a rescue plan: the balance below zero
    /// is exactly what is still owed — every sale streams straight through to
    /// whoever the debt names, so the number here climbs to zero as the rows
    /// below get tapped, biggest sources of cash first.
    @ViewBuilder
    private func raiseCashCard(_ P: Palette) -> some View {
        if let turn = store.state?.turn, turn.phase == "debt",
           let debt = turn.debt, debt.debtor == store.activeId {
            let remaining = max(0, -(store.me?.money ?? 0))
            let options = raiseOptions
            let raisable = options.reduce(0) { $0 + $1.amount }
            let payee = store.state?.debtPayee(debt) ?? "the bank"

            MMCard {
                VStack(alignment: .leading, spacing: 10) {
                    PanelTitle(remaining > 0 ? "Still in the red" : "Back in the black")
                    Text(money(remaining))
                        .font(.system(size: 30, weight: .heavy, design: .rounded))
                        .foregroundStyle(remaining > 0 ? P.bad : P.good)
                        .contentTransition(.numericText())
                        .animation(.snappy(duration: 0.4), value: remaining)
                        .debtPulse(remaining > 0)
                    Text(remaining > 0
                         ? "Everything you raise goes straight to \(payee) — watch this climb to zero."
                         : "You're square — the debt has settled itself.")
                        .font(.system(size: 12.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)

                    if remaining > 0 {
                        if options.isEmpty {
                            Text("Nothing left to sell or mortgage.")
                                .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                                .foregroundStyle(P.ink2)
                        } else {
                            VStack(spacing: 6) {
                                ForEach(options.prefix(6)) { option in
                                    raiseRow(option, P)
                                }
                            }
                            Text(raisable >= remaining
                                 ? "Biggest first — these add up to \(money(raisable))."
                                 : "These add up to \(money(raisable)); selling buildings first can unlock more.")
                                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                                .foregroundStyle(P.ink3)
                        }
                    }
                }
            }
        }
    }

    private struct RaiseOption: Identifiable {
        let id: String
        let amount: Int
        let label: String
        let action: () -> Void
    }

    /// Every legal way this seat can turn property into cash right now, worth
    /// first. Mortgaging is blocked while buildings stand, so the list simply
    /// re-reads itself after each tap.
    private var raiseOptions: [RaiseOption] {
        var out: [RaiseOption] = []
        for tile in store.myTiles().compactMap({ store.tile($0) }) {
            let i = tile.index
            let houses = store.state?.owner(of: i)?.houseCount ?? 0
            if store.canSellHouse(i), let cost = tile.houseCost, cost > 0 {
                out.append(RaiseOption(
                    id: "sell-\(i)",
                    amount: cost / 2,
                    label: houses == 5 ? "Sell the hotel on \(tile.name)" : "Sell a house on \(tile.name)",
                    action: { store.sellHouse(i) }
                ))
            }
            if store.canMortgage(i), let price = tile.price, price > 0 {
                out.append(RaiseOption(
                    id: "mortgage-\(i)",
                    amount: price / 2,
                    label: "Mortgage \(tile.name)",
                    action: { store.mortgage(i) }
                ))
            }
        }
        return out.sorted { $0.amount == $1.amount ? $0.id < $1.id : $0.amount > $1.amount }
    }

    private func raiseRow(_ option: RaiseOption, _ P: Palette) -> some View {
        Button {
            option.action()
            Haptics.tap()
        } label: {
            HStack(spacing: 8) {
                Text(option.label)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                Spacer(minLength: 6)
                Text("+\(money(option.amount))")
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.good)
            }
            .padding(.vertical, 9)
            .padding(.horizontal, 11)
            .background(P.sunken, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - the list

    @ViewBuilder
    private func propertyList(_ P: Palette) -> some View {
        let mine = store.myTiles().compactMap { store.tile($0) }

        if mine.isEmpty {
            VStack(spacing: 8) {
                Art.icon(.island, size: 36)
                Text("Nothing owned yet — land on a street and buy it.")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 48)
        } else {
            let streets = mine.filter { $0.type == "property" }
            let airports = mine.filter { $0.type == "airport" }
            let utilities = mine.filter { $0.type == "utility" }

            // Street groups, ordered by the index of each group's first owned tile.
            let grouped: [(key: String, tiles: [TileData])] = {
                var order: [String] = []
                var byGroup: [String: [TileData]] = [:]
                for t in streets {
                    let g = t.group ?? "?"
                    if byGroup[g] == nil { order.append(g) }
                    byGroup[g, default: []].append(t)
                }
                return order.map { (key: $0, tiles: byGroup[$0] ?? []) }
            }()

            VStack(alignment: .leading, spacing: 16) {
                ForEach(grouped, id: \.key) { entry in
                    section(title: sectionTitle(for: entry.key),
                            mark: sectionMark(for: entry.key),
                            tiles: entry.tiles, P: P, groupKey: entry.key)
                }
                if !airports.isEmpty {
                    section(title: "Airports", mark: .glyph(.plane), tiles: airports, P: P)
                }
                if !utilities.isEmpty {
                    section(title: "Utilities", mark: .glyph(.bolt), tiles: utilities, P: P)
                }
                bankruptRow(P)
            }
        }
    }

    private func sectionTitle(for groupKey: String) -> String {
        store.state?.groups[groupKey]?.name ?? groupKey
    }

    /// A country section flies that country's banner; a family without a group
    /// colour (airports, utilities) gets a glyph instead.
    private func sectionMark(for groupKey: String) -> SectionMark {
        guard let info = store.state?.groups[groupKey] else { return .none }
        return .banner(Color(css: info.color))
    }

    /// The web's always-there escape hatch, mirrored: give up on your own turn.
    @ViewBuilder
    private func bankruptRow(_ P: Palette) -> some View {
        if store.isMyTurn {
            MMIconButton(.skull, "Declare bankruptcy", kind: .ghost, big: true) {
                confirmBankrupt = true
            }
                .padding(.top, 6)
                .confirmationDialog("Declare bankruptcy?", isPresented: $confirmBankrupt, titleVisibility: .visible) {
                    Button("Go bankrupt", role: .destructive) {
                        store.declareBankrupt()
                        dismiss()
                    }
                } message: {
                    Text("Everything you own returns to the bank and you are out of the game.")
                }
        }
    }

    /// "how many of this country do I hold" — drives the set-progress badge.
    private func setProgress(for groupKey: String) -> (owned: Int, total: Int)? {
        guard let idxs = store.state?.map.groups?[groupKey], !idxs.isEmpty else { return nil }
        let owned = idxs.filter { store.state?.owner(of: $0)?.owner == store.activeId }.count
        return (owned, idxs.count)
    }

    /// What a section flies beside its name.
    private enum SectionMark { case banner(Color), glyph(Glyph), none }

    @ViewBuilder
    private func sectionMarkView(_ mark: SectionMark, _ P: Palette) -> some View {
        switch mark {
        case .banner(let colour): Art.groupBanner(colour, size: 15)
        case .glyph(let g): Art.icon(g, size: 14, tint: P.ink3)
        case .none: EmptyView()
        }
    }

    private func section(title: String, mark: SectionMark = .none, tiles: [TileData],
                         P: Palette, groupKey: String? = nil) -> some View {
        let progress = groupKey.flatMap { setProgress(for: $0) }
        let fullSet = progress.map { $0.owned == $0.total } ?? false

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                sectionMarkView(mark, P)
                PanelTitle(title)
                Spacer()
                if let progress {
                    Text(fullSet ? "FULL SET" : "\(progress.owned) of \(progress.total)")
                        .font(.system(size: 8.5, weight: .black))
                        .kerning(0.6)
                        // Kerned text under-reports its own width and truncates.
                        .fixedSize()
                        .foregroundStyle(fullSet ? P.accentInk : P.ink3)
                        .padding(.vertical, 3)
                        .padding(.horizontal, 7)
                        .background(fullSet ? AnyShapeStyle(P.gold) : AnyShapeStyle(P.sunken), in: Capsule())
                }
            }
            if let groupKey, let progress, progress.owned == progress.total - 1 {
                oneAwayLine(groupKey, P)
            }
            VStack(spacing: 8) {
                ForEach(tiles) { tile in
                    tileRow(tile, fullSet: fullSet, P: P)
                }
            }
        }
    }

    /// The last street of a set, and who is sitting on it — with the ask ready
    /// to send. Holding three of four is the moment a trade is worth making.
    @ViewBuilder
    private func oneAwayLine(_ groupKey: String, _ P: Palette) -> some View {
        if let missing = missingTile(in: groupKey), let tile = store.tile(missing) {
            let holder = store.state?.owner(of: missing)?.owner
            let holderName = holder.flatMap { store.state?.player($0)?.name }
            HStack(spacing: 8) {
                // The one street that unlocks the set — the key to it.
                Art.icon(.key, size: 15, tint: P.ink2)
                Text(holderName.map { "1 away — \(tile.name) is with \($0)" }
                     ?? "1 away — \(tile.name) is still with the bank")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 6)
                if let askFor, let holder, holder != store.activeId {
                    Button("Ask for it") { askFor(holder, [missing]) }
                        .buttonStyle(MMButtonStyle(kind: .gold))
                }
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 10)
            .background(P.goldSoft.opacity(0.6), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(P.gold.opacity(0.5), lineWidth: 1))
        }
    }

    /// The one tile of this group the player doesn't hold.
    private func missingTile(in groupKey: String) -> Int? {
        guard let idxs = store.state?.map.groups?[groupKey] else { return nil }
        let missing = idxs.filter { store.state?.owner(of: $0)?.owner != store.activeId }
        return missing.count == 1 ? missing.first : nil
    }

    /// What this tile earns per landing right now — mirrors server rentFor().
    private func rentNow(_ tile: TileData, own: TileOwnership?) -> Int? {
        guard let own, !own.isMortgaged else { return nil }
        switch tile.type {
        case "property":
            guard let rent = tile.rent, let base = rent[safe: own.houseCount] else { return nil }
            let full = tile.group.map { store.ownsFullGroup(store.activeId, group: $0) } ?? false
            let doubled = full && own.houseCount == 0 && store.state?.settings.x2rent == true
            return doubled ? base * 2 : base
        case "airport":
            guard let state = store.state else { return nil }
            let count = state.ownership.reduce(0) { acc, e in
                guard e.value.owner == own.owner, let i = Int(e.key),
                      state.map.tiles[safe: i]?.type == "airport" else { return acc }
                return acc + 1
            }
            return 25 * Int(pow(2.0, Double(max(0, count - 1))))
        default:
            return nil
        }
    }

    private func tileRow(_ tile: TileData, fullSet: Bool, P: Palette) -> some View {
        let own = store.state?.owner(of: tile.index)
        let houses = own?.houseCount ?? 0
        let mortgaged = own?.isMortgaged ?? false

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if let g = store.groupInfo(for: tile) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(Color(css: g.color))
                        .frame(width: 4, height: 16)
                }
                Text(tile.name)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                if houses == 5 {
                    Art.icon(.hotel, size: 15)
                } else if houses > 0 {
                    Text(String(repeating: "▪︎", count: houses))
                        .font(.system(size: 13, weight: .black))
                        .foregroundStyle(P.good)
                }
                Spacer()
                if mortgaged {
                    Text("MORTGAGED")
                        .font(.system(size: 8, weight: .black))
                        .kerning(0.5)
                        .fixedSize()
                        .foregroundStyle(P.bad)
                        .padding(.vertical, 3)
                        .padding(.horizontal, 6)
                        .background(P.redSoft, in: Capsule())
                } else if let rent = rentNow(tile, own: own) {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text("rent")
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundStyle(P.ink3)
                        Text(money(rent))
                            .font(.system(size: 13, weight: .heavy, design: .rounded))
                            .foregroundStyle(P.good)
                    }
                }
            }

            let buttons = rowButtons(for: tile, own: own)
            let canOfferInTrade = openTrade != nil && houses == 0
            if !buttons.isEmpty || canOfferInTrade {
                HStack(spacing: 6) {
                    ForEach(Array(buttons.enumerated()), id: \.offset) { _, b in
                        if let glyph = b.glyph {
                            MMIconButton(glyph, b.label, kind: b.kind, action: b.action)
                        } else {
                            Button(b.label, action: b.action)
                                .buttonStyle(MMButtonStyle(kind: b.kind))
                        }
                    }
                    Spacer(minLength: 0)
                    if canOfferInTrade {
                        Button {
                            openTrade?([tile.index])
                        } label: {
                            Image(systemName: "arrow.left.arrow.right")
                                .font(.system(size: 11, weight: .bold))
                        }
                        .buttonStyle(MMButtonStyle(kind: .ghost))
                    }
                }
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(P.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(fullSet ? P.gold.opacity(0.55) : P.rule, lineWidth: 1)
        )
    }

    private struct RowButton {
        let label: String
        let kind: MMButtonStyle.Kind
        var glyph: Glyph? = nil
        let action: () -> Void
    }

    private func rowButtons(for tile: TileData, own: TileOwnership?) -> [RowButton] {
        let i = tile.index
        var buttons: [RowButton] = []
        if store.canBuild(i), let hc = tile.houseCost {
            buttons.append(RowButton(label: money(hc), kind: .good, glyph: .crane) { store.build(i) })
        }
        if store.canSellHouse(i), let hc = tile.houseCost {
            buttons.append(RowButton(label: "Sell +\(money(hc / 2))", kind: .ghost) { store.sellHouse(i) })
        }
        if store.canMortgage(i), let price = tile.price {
            buttons.append(RowButton(label: "Mortgage +\(money(price / 2))", kind: .gold) { store.mortgage(i) })
        }
        if own?.isMortgaged == true, store.state?.settings.mortgage != false, let price = tile.price {
            buttons.append(RowButton(label: "Unmortgage \(money(unmortgageCost(price)))", kind: .primary) { store.unmortgage(i) })
        }
        return buttons
    }
}
