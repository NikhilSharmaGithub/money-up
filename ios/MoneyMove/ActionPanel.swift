// The action dock under the live feed: whatever the current phase needs —
// roll, buy/auction, debt rescue, end turn — plus the topmost trade offer.
// It hugs the bottom of the screen, where thumbs actually are.

import SwiftUI

struct ActionPanel: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    let openProperties: () -> Void
    var openTrade: (() -> Void)? = nil
    @State private var confirmBankrupt = false

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 8) {
            firstIncomingTrade

            if store.isMyTurn, let turn = store.state?.turn {
                myTurnControls(turn: turn, P: P)
            } else if store.state?.isPlaying == true {
                waitingRow(P)
            } else if store.state?.isEnded == true, store.isHost {
                Button("🔁  Play again") { store.rematch() }
                    .buttonStyle(MMButtonStyle(kind: .primary, big: true))
            }
        }
        .padding(12)
        .background(P.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(store.isMyTurn ? P.red.opacity(0.55) : P.rule, lineWidth: store.isMyTurn ? 1.5 : 1)
        )
        .shadow(color: .black.opacity(scheme == .light ? 0.14 : 0.4), radius: 12, y: 5)
        .padding(.horizontal, 12)
        .confirmationDialog("Declare bankruptcy?", isPresented: $confirmBankrupt, titleVisibility: .visible) {
            Button("Go bankrupt", role: .destructive) { store.declareBankrupt() }
        } message: {
            Text("Everything you own goes to your creditor and you are out of the game.")
        }
    }

    // MARK: - my turn

    @ViewBuilder
    private func myTurnControls(turn: TurnState, P: Palette) -> some View {
        switch turn.phase {
        case "debt":
            debtControls(turn: turn, P: P)

        case "action":
            if let pending = turn.pending, pending.type == "buy",
               let tile = store.tile(pending.tile) {
                let price = pending.price ?? tile.price ?? 0
                let canAfford = (store.me?.money ?? 0) >= price
                VStack(spacing: 8) {
                    Button("Buy \(tile.name) — \(money(price))") { store.buy() }
                        .buttonStyle(MMButtonStyle(kind: .good, big: true))
                        .disabled(!canAfford)
                    Button(store.state?.settings.auction ?? true ? "🔨  Send to auction" : "Skip") {
                        store.skipBuy()
                    }
                    .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                    if !canAfford {
                        hint("Not enough cash for this one.", P)
                    }
                }
            }

        case "roll":
            if store.me?.inJail == true {
                VStack(spacing: 8) {
                    Button("🎲  Roll for a double") { store.roll() }
                        .buttonStyle(MMButtonStyle(kind: .primary, big: true))
                    HStack(spacing: 8) {
                        Button("Pay $50") { store.jailPay() }
                            .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                            .disabled((store.me?.money ?? 0) < 50)
                        if (store.me?.getOutCards ?? 0) > 0 {
                            Button("Use 🎟️ card") { store.jailCard() }
                                .buttonStyle(MMButtonStyle(kind: .gold, big: true))
                        }
                    }
                    hint("In prison · attempt \((store.me?.jailTurns ?? 0) + 1) of 3", P)
                }
            } else {
                Button("🎲  Roll dice") { store.roll() }
                    .buttonStyle(MMButtonStyle(kind: .primary, big: true))
                if (turn.doubles ?? 0) > 0 {
                    hint("Double! Free roll (\(turn.doubles ?? 0) of 2)", P)
                }
            }

        case "end":
            HStack(spacing: 8) {
                Button {
                    openProperties()
                } label: {
                    Image(systemName: "building.columns.fill")
                        .font(.system(size: 16, weight: .bold))
                        .frame(width: 30, height: 26)
                }
                .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                .fixedSize()
                if let openTrade {
                    Button {
                        openTrade()
                    } label: {
                        Image(systemName: "arrow.left.arrow.right")
                            .font(.system(size: 15, weight: .bold))
                            .frame(width: 30, height: 26)
                    }
                    .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                    .fixedSize()
                }
                Button("End turn →") { store.endTurn() }
                    .buttonStyle(MMButtonStyle(kind: .primary, big: true))
            }

        default:
            EmptyView()
        }
    }

    private func debtControls(turn: TurnState, P: Palette) -> some View {
        let debt = turn.debt
        let amount = debt?.amount ?? 0
        let creditor = store.state?.player(debt?.creditor)
        return VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(P.bad)
                Text("You owe \(money(amount))\(creditor.map { " to \($0.name)" } ?? " to the bank")")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(P.redSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            Button("Pay \(money(amount))") { store.payDebt() }
                .buttonStyle(MMButtonStyle(kind: .good, big: true))
                .disabled((store.me?.money ?? 0) < amount)
            HStack(spacing: 8) {
                Button("Raise cash") { openProperties() }
                    .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                Button("Bankrupt") { confirmBankrupt = true }
                    .buttonStyle(MMButtonStyle(kind: .bad, big: true))
            }
        }
    }

    // MARK: - waiting / trades

    private func waitingRow(_ P: Palette) -> some View {
        HStack(spacing: 10) {
            if let current = store.currentPlayer {
                AvatarView(name: current.name, colorCSS: current.color, flag: current.flag ?? "", size: 26, emoji: current.avatar ?? "")
                Text("\(current.name) is playing…")
                    .font(.system(size: 13.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink2)
            }
            Spacer()
            ProgressView().tint(P.red).scaleEffect(0.85)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
    }

    /// Only the topmost incoming offer lives in the dock; more stack behind a
    /// count. Pass & play: offers to ANY seat on this device show up here.
    @ViewBuilder private var firstIncomingTrade: some View {
        let P = Palette.current(scheme)
        let mine = (store.state?.trades ?? []).filter { store.isLocal($0.to) }
        let sent = (store.state?.trades ?? []).filter { store.isLocal($0.from) }

        if let trade = mine.first {
            let from = store.state?.player(trade.from)
            let forGuest = trade.to != store.meId ? store.state?.player(trade.to) : nil
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    PanelTitle("🤝 Offer from \(from?.name ?? "?")\(forGuest.map { " to \($0.name)" } ?? "")")
                    Spacer()
                    if mine.count > 1 {
                        Text("+\(mine.count - 1) more")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(P.ink3)
                    }
                }
                tradeLine(label: "You get", side: trade.give, color: P.good)
                tradeLine(label: "You give", side: trade.get, color: P.bad)
                HStack(spacing: 8) {
                    Button("Accept") { store.respondTrade(trade.id, accept: true) }
                        .buttonStyle(MMButtonStyle(kind: .good))
                    Button("Decline") { store.respondTrade(trade.id, accept: false) }
                        .buttonStyle(MMButtonStyle(kind: .bad))
                }
            }
            .padding(10)
            .background(P.goldSoft.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(P.gold.opacity(0.6), lineWidth: 1))
        }

        if let trade = sent.first {
            HStack {
                Text("Offer sent to \(store.state?.player(trade.to)?.name ?? "?")…")
                    .font(.system(size: 12.5, weight: .medium)).foregroundStyle(P.ink3)
                Spacer()
                Button("Cancel") { store.cancelTrade(trade.id) }
                    .buttonStyle(MMButtonStyle(kind: .ghost))
            }
        }
    }

    private func tradeLine(label: String, side: TradeSide, color: Color) -> some View {
        let P = Palette.current(scheme)
        var bits: [String] = []
        if side.money > 0 { bits.append(money(side.money)) }
        bits.append(contentsOf: side.tiles.compactMap { store.tile($0)?.name })
        if side.cards > 0 { bits.append("\(side.cards)× prison card") }
        return HStack(alignment: .top) {
            Text(label).font(.system(size: 12)).foregroundStyle(P.ink3)
            Spacer()
            Text(bits.isEmpty ? "nothing" : bits.joined(separator: " · "))
                .font(.system(size: 12.5, weight: .bold, design: .rounded))
                .foregroundStyle(color)
                .multilineTextAlignment(.trailing)
        }
    }

    private func hint(_ text: String, _ P: Palette) -> some View {
        Text(text)
            .font(.system(size: 12.5, weight: .medium, design: .rounded))
            .foregroundStyle(P.ink3)
    }
}
