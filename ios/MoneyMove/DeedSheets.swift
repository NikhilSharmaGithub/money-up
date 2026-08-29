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
                    VStack(spacing: 12) {
                        header(tile, P)

                        let rows = detailRows(tile)
                        if !rows.isEmpty {
                            DeedRowsCard(rows: rows)
                        }

                        if tile.isOwnable {
                            ownerCard(tile, P)
                            actionButtons(tile, P)
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
        let badge = group?.flag ?? tile.icon ?? ""
        let ink: Color = colored ? .white : P.ink

        return VStack(spacing: 6) {
            HStack(spacing: 8) {
                if !badge.isEmpty { Text(badge).font(.system(size: 22)) }
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

    @ViewBuilder
    private func actionButtons(_ tile: TileData, _ P: Palette) -> some View {
        if let own = store.state?.owner(of: tileIndex), own.owner == store.meId {
            VStack(spacing: 8) {
                if store.canBuild(tileIndex), let hc = tile.houseCost {
                    Button("🏗 Build (\(money(hc)))") { store.build(tileIndex) }
                        .buttonStyle(MMButtonStyle(kind: .good, big: true))
                }
                if store.canSellHouse(tileIndex), let hc = tile.houseCost {
                    Button("Sell building (+\(money(hc / 2)))") { store.sellHouse(tileIndex) }
                        .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                }
                if store.canMortgage(tileIndex), let price = tile.price {
                    Button("Mortgage (+\(money(price / 2)))") { store.mortgage(tileIndex) }
                        .buttonStyle(MMButtonStyle(kind: .gold, big: true))
                }
                if own.isMortgaged, store.state?.settings.mortgage != false, let price = tile.price {
                    Button("Unmortgage (\(money(unmortgageCost(price))))") { store.unmortgage(tileIndex) }
                        .buttonStyle(MMButtonStyle(kind: .primary, big: true))
                }
            }
        }
    }
}

// MARK: - properties sheet

struct PropertiesSheet: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

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
        let mine = store.myTiles().compactMap { store.tile($0) }

        if mine.isEmpty {
            VStack(spacing: 8) {
                Text("🏝️").font(.system(size: 34))
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
                    section(title: sectionTitle(for: entry.key), tiles: entry.tiles, P: P)
                }
                if !airports.isEmpty {
                    section(title: "✈️ Airports", tiles: airports, P: P)
                }
                if !utilities.isEmpty {
                    section(title: "💡 Utilities", tiles: utilities, P: P)
                }
            }
        }
    }

    private func sectionTitle(for groupKey: String) -> String {
        if let info = store.state?.groups[groupKey] {
            return "\(info.flag) \(info.name)"
        }
        return groupKey
    }

    private func section(title: String, tiles: [TileData], P: Palette) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            PanelTitle(title)
            VStack(spacing: 8) {
                ForEach(tiles) { tile in
                    tileRow(tile, P)
                }
            }
        }
    }

    private func tileRow(_ tile: TileData, _ P: Palette) -> some View {
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
                    Text("🏨").font(.system(size: 13))
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
                        .foregroundStyle(P.bad)
                        .padding(.vertical, 3)
                        .padding(.horizontal, 6)
                        .background(P.redSoft, in: Capsule())
                }
            }

            let buttons = rowButtons(for: tile, own: own)
            if !buttons.isEmpty {
                HStack(spacing: 6) {
                    ForEach(Array(buttons.enumerated()), id: \.offset) { _, b in
                        Button(b.label, action: b.action)
                            .buttonStyle(MMButtonStyle(kind: b.kind))
                    }
                }
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(P.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(P.rule, lineWidth: 1))
    }

    private struct RowButton {
        let label: String
        let kind: MMButtonStyle.Kind
        let action: () -> Void
    }

    private func rowButtons(for tile: TileData, own: TileOwnership?) -> [RowButton] {
        let i = tile.index
        var buttons: [RowButton] = []
        if store.canBuild(i), let hc = tile.houseCost {
            buttons.append(RowButton(label: "🏗 \(money(hc))", kind: .good) { store.build(i) })
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
