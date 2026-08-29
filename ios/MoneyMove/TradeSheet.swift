// The trade composer: pick tiles, cash and prison cards on both sides of the
// deal, then send the offer. Mirrors the web client's trade builder — tiles
// with houses on them are shown but locked, because the server refuses them.

import SwiftUI

struct TradeSheet: View {
    let targetId: String

    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var giveTiles: Set<Int> = []
    @State private var getTiles: Set<Int> = []
    @State private var giveCash = 0
    @State private var getCash = 0
    @State private var giveCards = 0
    @State private var getCards = 0

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
            .background(P.page.ignoresSafeArea())
            .navigationTitle("Trade")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") { send() }
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .disabled(store.state?.player(targetId) == nil)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - main content

    private func content(target: PlayerState, P: Palette) -> some View {
        ScrollView {
            VStack(spacing: 12) {
                header(target: target, P: P)

                sideCard(
                    title: "You give",
                    tileIndexes: myTileIndexes,
                    selection: $giveTiles,
                    cash: $giveCash, cashLimit: store.me?.money ?? 0,
                    cards: $giveCards, cardLimit: store.me?.getOutCards ?? 0,
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
                    name: store.me?.name ?? "You",
                    colorCSS: store.me?.color ?? "#888888",
                    flag: store.me?.flag ?? "",
                    size: 44
                )
                Text("You")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink2)
            }
            Image(systemName: "arrow.left.arrow.right")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(P.red)
            VStack(spacing: 4) {
                AvatarView(
                    name: target.name,
                    colorCSS: target.color,
                    flag: target.flag ?? "",
                    size: 44
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
                    Text("🏠").font(.system(size: 11))
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

    private func cashRow(value: Binding<Int>, limit: Int, P: Palette) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Cash")
                    .font(.system(size: 13.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink)
                Text("up to \(money(max(0, limit)))")
                    .font(.system(size: 10.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
            Spacer()
            TextField("0", text: clampedText(value, limit: limit))
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(P.ink)
                .frame(width: 76)
                .padding(.vertical, 6)
                .padding(.horizontal, 8)
                .background(P.sunken, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            Stepper("", value: clampedValue(value, limit: limit), in: 0...max(0, limit), step: 10)
                .labelsHidden()
        }
    }

    private func cardsRow(value: Binding<Int>, limit: Int, P: Palette) -> some View {
        HStack(spacing: 8) {
            Text("Prison cards 🎟️")
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
            Text("🫥").font(.system(size: 40))
            Text("This player is no longer in the game.")
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink2)
            Button("Close") { dismiss() }
                .buttonStyle(MMButtonStyle(kind: .ghost))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - data helpers

    private var myTileIndexes: [Int] { store.myTiles() }

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

    /// TextField binding that only accepts digits and clamps into 0...limit.
    private func clampedText(_ value: Binding<Int>, limit: Int) -> Binding<String> {
        Binding(
            get: { String(value.wrappedValue) },
            set: { s in
                let n = Int(s.filter(\.isNumber)) ?? 0
                value.wrappedValue = min(max(0, n), max(0, limit))
            }
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
            money: min(max(0, giveCash), max(0, store.me?.money ?? 0)),
            tiles: giveTiles.filter {
                let own = state.owner(of: $0)
                return own?.owner == store.meId && own?.houseCount ?? 0 == 0
            }.sorted(),
            cards: min(max(0, giveCards), max(0, store.me?.getOutCards ?? 0))
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

        store.proposeTrade(to: targetId, give: give, get: get)
        store.showToast("Offer sent")
        dismiss()
    }
}
