// The action dock under the live feed: whatever the current phase needs —
// roll, buy/auction, debt rescue, end turn — plus the topmost trade offer.
// It hugs the bottom of the screen, where thumbs actually are.

import SwiftUI

struct ActionPanel: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    let openProperties: () -> Void
    var openTrade: (() -> Void)? = nil
    var openCounter: ((TradeOffer) -> Void)? = nil
    /// Reopens the final standings — the result sheet can be swiped away.
    var openResults: (() -> Void)? = nil
    @State private var confirmBankrupt = false

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 8) {
            firstIncomingTrade

            if store.isMyTurn, let turn = store.state?.turn {
                turnHeader(P)
                deadlockLine(P)
                // The server answers a roll before the piece has taken a
                // step, so the buy prompt (and whatever else the landing
                // decides) arrives while the token is mid-walk. While the
                // theatre for THIS seat's move is still on stage, the dock
                // stays neutral; the controls take over when it lands. Other
                // seats' turns, trades and chat never wait.
                if store.theatreHolding(for: turn.playerId) {
                    walkingRow(P)
                } else {
                    myTurnControls(turn: turn, P: P)
                }
            } else if store.state?.isPlaying == true {
                waitingRow(P)
            } else if store.state?.isEnded == true {
                VStack(spacing: 8) {
                    // Anyone can call the next game — the chair goes to
                    // whoever asks for it first.
                    MMIconButton(.replay, "Play again",
                                 kind: .primary, big: true) { store.rematch() }
                    if !store.isHost {
                        Text("Whoever presses first hosts the next one.")
                            .font(.system(size: 12.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                    }
                    if let openResults {
                        MMIconButton(.trophy, "Final standings", kind: .ghost, big: true) {
                            openResults()
                            Haptics.tap()
                        }
                    }
                }
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
            Text("Everything you own goes to whoever you owe, and you are out of the game.")
        }
    }

    // MARK: - my turn

    /// Whose hands these buttons are in, and how long they have. On a pass &
    /// play device the dock serves several seats and looked identical for all
    /// of them; and the clock only ever showed on OTHER people's turns, which
    /// is the one turn where the countdown actually costs you something.
    @ViewBuilder
    private func turnHeader(_ P: Palette) -> some View {
        let seat = store.state?.turn?.playerId
        let mine = seat == store.meId
        HStack(spacing: 7) {
            if let p = store.state?.player(seat), !mine {
                AvatarView(name: p.name, colorCSS: p.color, flag: p.flag ?? "", size: 20, emoji: p.avatar ?? "")
                Text("\(p.name)'s turn — pass the phone")
                    .font(.system(size: 12.5, weight: .bold, design: .rounded))
                    .foregroundStyle(P.gold)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            } else {
                Text("Your turn")
                    .font(.system(size: 12.5, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
            Spacer(minLength: 6)
            TurnClock(endsAt: store.state?.turn?.endsAt, compact: true)
        }
        .padding(.horizontal, 2)
    }

    /// The deadlock rule is counting for this seat. It says the number and the
    /// way out, once per turn, and then gets out of the way — the rule already
    /// introduced itself as a card the first time it could ever apply.
    @ViewBuilder
    private func deadlockLine(_ P: Palette) -> some View {
        if let me = store.me, me.lapsBlocked > 0, !me.isBankrupt {
            HStack(spacing: 6) {
                Art.icon(.scales, size: 13, tint: P.gold)
                Text("\(me.lapsToRelief) lap\(me.lapsToRelief == 1 ? "" : "s") until the street you're missing changes hands — or trade for it first.")
                    .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
            .padding(.horizontal, 9)
            .background(P.goldSoft, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }

    /// The piece is still on its way — same quiet voice as the waiting row,
    /// gone the moment GameStore's holdUntil clears and the landing's
    /// controls take the stage.
    private func walkingRow(_ P: Palette) -> some View {
        HStack(spacing: 10) {
            Art.icon(.dice, size: 17, tint: P.ink3)
            Text("Moving…")
                .font(.system(size: 13.5, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink2)
            Spacer()
            ProgressView().tint(P.red).scaleEffect(0.85)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
    }

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
                    if store.state?.settings.auction ?? true {
                        MMIconButton(.gavel, "Send to auction", kind: .ghost, big: true) {
                            store.skipBuy()
                        }
                    } else {
                        Button("Skip") { store.skipBuy() }
                            .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                    }
                    if !canAfford {
                        hint("Not enough cash for this one.", P)
                    }
                }
            }

        case "roll":
            if store.me?.inJail == true {
                VStack(spacing: 8) {
                    MMIconButton(.dice, "Roll for a double", kind: .primary, big: true) { store.roll() }
                    HStack(spacing: 8) {
                        Button("Pay $50") { store.jailPay() }
                            .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                            .disabled((store.me?.money ?? 0) < 50)
                        if (store.me?.getOutCards ?? 0) > 0 {
                            MMIconButton(.ticket, "Use card", kind: .gold, big: true) { store.jailCard() }
                        }
                    }
                    hint("In prison · attempt \((store.me?.jailTurns ?? 0) + 1) of 3", P)
                }
            } else {
                MMIconButton(.dice, "Roll dice", kind: .primary, big: true) { store.roll() }
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

    /// The climb out of the red. The server already took every rupee the
    /// debtor had, so the balance below zero IS what's still owed — and every
    /// rupee raised streams straight to whoever the debt names, the number
    /// climbing toward zero on its own. This panel just shows the climb and
    /// opens the doors that raise cash; nothing here "pays" anything.
    private func debtControls(turn: TurnState, P: Palette) -> some View {
        let debt = turn.debt
        let debtor = store.state?.player(debt?.debtor)
        // Live off the balance itself — debt.amount is the same number, but
        // the climb should read straight from the figure that moves.
        let remaining = max(0, -(debtor?.money ?? 0))
        let mine = debtor?.id == store.meId
        // Rent streams to a named creditor; a payEach card to the players it
        // still owes, by name; taxes, repairs and fines to the bank.
        let payee = store.state?.debtPayee(debt) ?? "the bank"
        return VStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(P.bad)
                    Text("\(money(remaining)) in the red")
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.bad)
                        .contentTransition(.numericText())
                        .animation(.snappy(duration: 0.4), value: remaining)
                        .debtPulse(remaining > 0)
                }
                // Pass & play: name whose hole this is when the phone is
                // speaking for a seat that isn't the primary player's.
                Text(mine
                     ? "Everything you raise goes to \(payee) until you're square."
                     : "\(debtor?.name ?? "This player") is in the red — everything they raise goes to \(payee) until they're square.")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(P.redSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            // The gate, not a payment: it only opens once the balance has
            // climbed back to zero (the server usually closes the debt itself
            // the instant it does).
            Button("Back in the black") { store.payDebt() }
                .buttonStyle(MMButtonStyle(kind: .good, big: true))
                .disabled(remaining > 0)
            HStack(spacing: 8) {
                Button("Raise cash") { openProperties() }
                    .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                Button("Bankrupt") { confirmBankrupt = true }
                    .buttonStyle(MMButtonStyle(kind: .bad, big: true))
            }
        }
    }

    // MARK: - waiting / trades

    @ViewBuilder
    private func waitingRow(_ P: Palette) -> some View {
        // Out of the running: the dock would otherwise sit there saying
        // "…is playing" forever with no hint that your seat is done. On a
        // pass & play phone "you" means every seat this device holds — while
        // any of them still plays, the dock is theirs, not a spectator's.
        let locals = (store.state?.players ?? []).filter { store.isLocal($0.id) }
        if !locals.isEmpty, locals.allSatisfy(\.isBankrupt),
           let me = locals.first(where: { $0.id == store.meId }) ?? locals.first {
            HStack(spacing: 8) {
                // Walked out, dozed off past the clock, or spent everything —
                // three different endings, so three different marks.
                Art.icon(me.wasRemoved ? (me.removedFor == "quit" ? .door : .snooze) : .payment,
                         size: 17, tint: P.ink3)
                Text(me.wasRemoved
                     ? "You're out of this game — watching how it ends."
                     : "You went bankrupt — watching how it ends.")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
        } else {
            liveWaitingRow(P)
        }
    }

    private func liveWaitingRow(_ P: Palette) -> some View {
        HStack(spacing: 10) {
            if let current = store.currentPlayer {
                AvatarView(name: current.name, colorCSS: current.color, flag: current.flag ?? "", size: 26, emoji: current.avatar ?? "")
                Text("\(current.name) is playing…")
                    .font(.system(size: 13.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink2)
            }
            Spacer()
            // The clock runs on every turn, not just yours — watching someone
            // else's tick down is what makes the wait readable. A table with
            // only one person at it has no clock, and then it shows nothing.
            TurnClock(endsAt: store.state?.turn?.endsAt, compact: true)
            ProgressView().tint(P.red).scaleEffect(0.85)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
    }

    /// Only the topmost live incoming offer takes over the dock; offers set
    /// aside for later collapse into a one-line chip until picked back up.
    /// Pass & play: offers to ANY seat on this device show up here.
    @ViewBuilder private var firstIncomingTrade: some View {
        let P = Palette.current(scheme)
        let mine = (store.state?.trades ?? []).filter { store.isLocal($0.to) }
        let active = mine.filter { $0.ignored != true }
        let parked = mine.filter { $0.ignored == true }
        let sent = (store.state?.trades ?? []).filter { store.isLocal($0.from) }

        if let trade = active.first {
            let from = store.state?.player(trade.from)
            let forGuest = trade.to != store.meId ? store.state?.player(trade.to) : nil
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Art.icon(.trade, size: 13, tint: P.ink3)
                    PanelTitle("Offer from \(from?.name ?? "?")\(forGuest.map { " to \($0.name)" } ?? "")")
                    Spacer()
                    if active.count > 1 {
                        Text("+\(active.count - 1) more")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(P.ink3)
                    }
                }
                tradeLine(label: "You get", side: trade.give, color: P.good)
                tradeLine(label: "You give", side: trade.get, color: P.bad)
                if let watching = viewerNames(trade) {
                    ViewingLine(text: "\(watching) is viewing…", color: P.gold)
                }
                // Accepting a deal you can't fund just bounces off the server
                // with a toast; say so before the tap instead.
                let short = trade.get.money - (store.state?.player(trade.to)?.money ?? 0)
                if short > 0 {
                    Text("Short \(money(short)) — sell or mortgage first.")
                        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.bad)
                }
                HStack(spacing: 8) {
                    Button("Accept") { store.respondTrade(trade.id, accept: true) }
                        .buttonStyle(MMButtonStyle(kind: .good))
                        .disabled(short > 0)
                        .opacity(short > 0 ? 0.45 : 1)
                    if let openCounter {
                        Button("Negotiate") { openCounter(trade) }
                            .buttonStyle(MMButtonStyle(kind: .gold))
                    }
                    Button("Decline") { store.respondTrade(trade.id, accept: false) }
                        .buttonStyle(MMButtonStyle(kind: .bad))
                    Button {
                        store.ignoreTrade(trade.id)
                        Haptics.tap()
                    } label: {
                        HStack(spacing: 5) {
                            Art.icon(.snooze, size: 13, tint: P.ink)
                            Text("Later")
                                .font(.system(size: 11.5, weight: .bold, design: .rounded))
                        }
                        .fixedSize()
                    }
                    .buttonStyle(MMButtonStyle(kind: .ghost))
                    .fixedSize()
                }
            }
            .padding(10)
            .background(P.goldSoft.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(P.gold.opacity(0.6), lineWidth: 1))
            .id(trade.id)
            .onAppear { store.setTradeViewing(trade.id, true, as: trade.to) }
            .onDisappear { store.setTradeViewing(trade.id, false, as: trade.to) }
        }

        if !parked.isEmpty {
            Button {
                if let t = parked.first { store.ignoreTrade(t.id, ignored: false) }
                Haptics.tap()
            } label: {
                HStack(spacing: 6) {
                    Art.icon(.snooze, size: 14, tint: P.ink3)
                    Text("\(parked.count == 1 ? "1 offer" : "\(parked.count) offers") set aside")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                    Spacer()
                    Text("Review")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(P.gold)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(P.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
        }

        if let trade = sent.first {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    // Name the deal, not just the recipient — you can't take
                    // back what you offered if you can't remember it.
                    Text("Offer sent to \(store.state?.player(trade.to)?.name ?? "?"): \(summary(trade.give)) ⇄ \(summary(trade.get))")
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(P.ink3)
                        .lineLimit(2)
                    if let watching = viewerNames(trade) {
                        ViewingLine(text: "\(watching) is viewing…", color: P.gold)
                    } else if trade.ignored == true {
                        HStack(spacing: 5) {
                            Art.icon(.snooze, size: 13, tint: P.ink3)
                            Text("Set aside for later")
                                .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                                .foregroundStyle(P.ink3)
                        }
                    }
                }
                Spacer()
                Button("Cancel") { store.cancelTrade(trade.id) }
                    .buttonStyle(MMButtonStyle(kind: .ghost))
            }
        }
    }

    /// Everyone looking at the offer right now, minus this device's own seats.
    private func viewerNames(_ trade: TradeOffer) -> String? {
        let names = (trade.viewers ?? [])
            .filter { !store.isLocal($0) }
            .compactMap { store.state?.player($0)?.name }
        return names.isEmpty ? nil : names.joined(separator: ", ")
    }

    /// One side of a deal as a single readable phrase.
    private func summary(_ side: TradeSide) -> String {
        var bits: [String] = []
        if side.money > 0 { bits.append(money(side.money)) }
        bits.append(contentsOf: side.tiles.compactMap { store.tile($0)?.name })
        if side.cards > 0 { bits.append("\(side.cards)× prison card") }
        return bits.isEmpty ? "nothing" : bits.joined(separator: " · ")
    }

    private func tradeLine(label: String, side: TradeSide, color: Color) -> some View {
        let P = Palette.current(scheme)
        return HStack(alignment: .top) {
            Text(label).font(.system(size: 12)).foregroundStyle(P.ink3)
            Spacer()
            Text(summary(side))
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

/// The gently pulsing "… is viewing" presence line, under a drawn eye.
struct ViewingLine: View {
    let text: String
    let color: Color
    @State private var dim = false

    var body: some View {
        HStack(spacing: 5) {
            Art.icon(.eye, size: 13, tint: color)
            Text(text)
                .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                .foregroundStyle(color)
        }
        .opacity(dim ? 0.4 : 1)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.85).repeatForever(autoreverses: true)) {
                dim = true
            }
        }
    }
}
