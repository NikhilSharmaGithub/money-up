// The action dock under the live feed: whatever the current phase needs —
// roll, buy/auction, debt rescue, end turn — plus the topmost trade offer.
// It hugs the bottom of the screen, where thumbs actually are.
//
// It is also the table's main piece of glass, and the one of its lensing
// surfaces a thumb is always on. A phone hangs it under the board, on the page
// ramp; an iPad plays the table flat and puts it inside the board's own centre
// well, on the felt. The same dock over two different backdrops is exactly the
// thing the material is judged on — if those two look alike it is a frost and
// not a lens — so the backdrop is declared rather than assumed, and
// everything inside takes its ink from the glass.
//
// Nothing inside it is glass of its own. Glass does not stack: a pane on a pane
// is refracting the bar it sits on, and on 26 the system cannot draw one glass
// sampling another at all. So the buttons are told they stand on `.chrome` —
// a ghost becomes a well pressed into the dock, a coloured button a plate that
// casts nothing — and every block the phases bring in is a well or a wash of
// its colour in the material, never a sheet of paper laid on top of it.

import SwiftUI

struct ActionPanel: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Which layout `GameScreen` is in, and therefore what is behind the dock.
    @Environment(\.horizontalSizeClass) private var hSize
    let openProperties: () -> Void
    var openTrade: (() -> Void)? = nil
    var openCounter: ((TradeOffer) -> Void)? = nil
    /// Reopens the final standings — the result sheet can be swiped away.
    var openResults: (() -> Void)? = nil
    /// The list of every open offer at the table (1.0.6).
    var openOffers: (() -> Void)? = nil
    @State private var confirmBankrupt = false

    /// What we put behind the dock. `GameScreen` only ever renders it inside
    /// the board's centre well at a regular width — every compact layout hangs
    /// it below the board on the page gradient — so the size class is the
    /// honest answer to what is underneath, and no pixel gets read to find out.
    private var backdrop: BackdropKind { hSize == .regular ? .felt : .page }

    /// The dock's glass colours, off the one resolver the material and every
    /// control standing on it use, so a label and the pane under it cannot
    /// disagree about which way the glass has leaned.
    private var glass: GlassTokens { backdrop.settledGlass(Palette.current(scheme)) }

    private var increaseContrast: Bool { contrast == .increased }

    /// The ink for a label on the dock. Two levels and no third: `ink3` on this
    /// material measures 1.53:1, so every quiet line up here promotes to the
    /// secondary glass ink — `ink2` carried 62% of the way to `ink`, which
    /// floors at 5.82:1 — and under Increase Contrast that promotes again.
    private func ink(_ secondary: Bool = false) -> Color {
        glass.label(secondary: secondary, increaseContrast: increaseContrast)
    }

    /// A block pressed into the dock rather than laid on it: the glass's own
    /// ink at a tenth, the well a ghost button on the dock already is. It
    /// flips with the glass, where a paper colour would sit on the material as
    /// a small opaque card.
    private var well: Color { glass.ink.opacity(increaseContrast ? 0.18 : 0.10) }

    /// A block that carries a meaning — a debt, an offer, the deadlock rule —
    /// as a wash of its colour through the material, at the strength the
    /// material gives its own one semantic tint.
    private func wash(_ hue: Color) -> Color { hue.opacity(increaseContrast ? 0.26 : 0.14) }

    /// The dock's padding, and the corner every child drawn on it wears: r22
    /// less the padding.
    private static let inset: CGFloat = 12
    private static let corner = MMRadius.inner(MMRadius.xl, inset: inset)

    /// The outline of a block drawn on the dock.
    private var block: RoundedRectangle {
        RoundedRectangle(cornerRadius: Self.corner, style: .continuous)
    }

    var body: some View {
        let P = Palette.current(scheme)
        // One container, because the dock is one surface: glass cannot sample
        // glass, and the phase blocks inside it are chips drawn ON the material
        // rather than little panes of their own.
        //
        // No tint. The old dock ringed itself in the accent on your turn, and
        // the obvious translation was to hand that colour to the material —
        // but a tint is a property of the whole pane, so the dock came out as
        // a solid slab of brand gold with the buttons lost inside it. Your
        // turn is already said twice in here, by the header and by the primary
        // button; a bar that shouts it a third time is the surface that stops
        // being glass.
        return MMGlassContainer(spacing: 12) {
            phases(P)
                .padding(Self.inset)
                // Every control in here stands on the dock's glass, not on a
                // glass of its own, and is cut concentric with the shell —
                // the big ones included, which elsewhere wear 14. Declared
                // inside the pane and so reaching nothing outside it.
                .mmControls(on: .chrome, corner: Self.corner)
                // r22 with 12 pt of padding puts every child at 10, so the gap
                // does not pinch at the corners. Regular and never Clear: the
                // dock carries live numbers and Clear does not adapt.
                .mmGlass(.regular,
                         backdrop: backdrop,
                         in: RoundedRectangle(cornerRadius: MMRadius.xl, style: .continuous))
        }
        // The phase changing is the dock changing shape, so the shell
        // stretches to its new size on the morph curve instead of cutting to
        // it. Keyed on the stage alone: a balance ticking or a clock counting
        // down inside an unchanged dock keeps its own animation.
        .animation(.mmMorph(reduceMotion: reduceMotion), value: Self.stage(of: store))
        .padding(.horizontal, 12)
        .confirmationDialog("Declare bankruptcy?", isPresented: $confirmBankrupt, titleVisibility: .visible) {
            Button("Go bankrupt", role: .destructive) { store.declareBankrupt() }
        } message: {
            Text(bankruptcyTerms)
        }
    }

    /// What giving up actually does, at this table. The creditor has only
    /// ever kept the cash already paid over; the streets go back to the bank
    /// — or under the hammer, one at a time, where the host chose that
    /// (1.0.6, G5). A Play-now or cup table always releases them.
    private var bankruptcyTerms: String {
        let state = store.state
        let auctioned = state?.hasTableRules == true && EstateRule.of(state?.settings) == .auction
        return auctioned
            ? "Whatever you have paid stays with whoever you owe, your properties are auctioned to the other players, and you are out of the game."
            : "Whatever you have paid stays with whoever you owe, your properties go back to the bank, and you are out of the game."
    }

    // MARK: - the morph

    /// The shape the dock is in, as a word. Two docks at the same stage hold
    /// the same rows, so a change of stage is exactly a change of shape — the
    /// thing the shell stretches for. `GameScreen` keys the player strip above
    /// on the same word, so the strip rides up and down with the dock as one
    /// cluster instead of jumping while the shell below it glides.
    static func stage(of store: GameStore) -> String {
        guard store.state != nil else { return "" }
        // The same three rows tradeRows draws, in words: one offer's card, the
        // offers row (whose count can tick without the dock changing shape),
        // what was sent, and the table's line.
        let incoming = store.incomingOffers
        let sent = store.sentOffers
        var parts: [String] = []
        if incoming.count == 1, let offer = incoming.first, offer.ignored != true {
            parts.append("offer \(offer.id)")
        } else if !incoming.isEmpty {
            parts.append("offers")
        }
        if sent.count == 1, let one = sent.first { parts.append("sent \(one.id)") }
        else if sent.count > 1 { parts.append("sent") }
        if incoming.isEmpty, !store.tableTrades.isEmpty { parts.append("table") }
        parts.append(controls(of: store))
        return parts.joined(separator: " · ")
    }

    /// The same, for the controls alone: the rows that swap when it changes.
    private static func controls(of store: GameStore) -> String {
        guard let state = store.state else { return "" }
        if store.isMyTurn, let turn = state.turn {
            if store.theatreHolding(for: turn.playerId) { return "walking \(turn.playerId)" }
            var key = "\(turn.phase) \(turn.playerId)"
            if turn.phase == "roll", store.me?.inJail == true { key += " prison" }
            if let pending = turn.pending { key += " \(pending.type) \(pending.tile)" }
            if (store.me?.lapsBlocked ?? 0) > 0 { key += " deadlock" }
            return key
        }
        if state.isPlaying || store.endOnStage { return "waiting \(state.turn?.playerId ?? "")" }
        return state.isEnded ? "ended" : ""
    }

    /// How rows change places while the shell stretches: the old ones go
    /// quickly and the new ones arrive 100 ms behind them, so the eye reads
    /// the shape changing first and the words second. Under Reduce Motion a
    /// plain cross-fade, on the shell's own 160 ms.
    private var rowSwap: AnyTransition {
        if reduceMotion { return .opacity }
        return .asymmetric(
            insertion: .opacity.animation(.easeOut(duration: 0.24).delay(0.1)),
            removal: .opacity.animation(.easeOut(duration: 0.12)))
    }

    /// Whatever this moment of the game needs. The dock's own size follows it,
    /// which is why the shell is measured from the outside and not fixed.
    @ViewBuilder
    private func phases(_ P: Palette) -> some View {
        VStack(spacing: 8) {
            // Somebody on the rail: said once, at the top of the dock, so the
            // rows under it read as the table's news rather than as buttons
            // that have stopped working.
            if store.isWatching, store.state?.isLobby == false {
                WatchingLine(glass: glass)
            }

            tradeRows

            // The header stays put across a change of phase — it is the same
            // seat's turn — so it sits outside the block that swaps, and only
            // comes and goes with the turn itself.
            if store.isMyTurn {
                turnHeader(P)
                    .transition(rowSwap)
                deadlockLine(P)
            }

            // One view, so it can carry one identity: a new stage is a new
            // block, which is what lets the old rows fade out while the new
            // ones fade in behind them instead of the same view being rewritten
            // in place.
            if hasControls {
                VStack(spacing: 8) {
                    controlRows(P)
                }
                .id(Self.controls(of: store))
                .transition(rowSwap)
            }
        }
    }

    /// Whether this moment has any rows at all. On your own turn during an
    /// auction the dock has nothing to offer — the paddle is in the well —
    /// and an empty block would still be handed the stack's spacing, a gap
    /// the dock never used to have.
    private var hasControls: Bool {
        guard store.isMyTurn, let turn = store.state?.turn,
              !store.theatreHolding(for: turn.playerId) else { return true }
        switch turn.phase {
        case "debt", "roll", "end": return true
        case "action": return turn.pending?.type == "buy"
        default: return false
        }
    }

    @ViewBuilder
    private func controlRows(_ P: Palette) -> some View {
        if store.isMyTurn, let turn = store.state?.turn {
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
        } else if store.state?.isPlaying == true || store.endOnStage {
            // The game is over on the server, but the act that ended it is
            // still on stage: "Play again" would give the ending away.
            waitingRow(P)
        } else if store.state?.isEnded == true {
            // Anyone can call the next game — the chair goes to whoever asks
            // for it first. Except a cup match, which is played once and is
            // already recorded in the bracket.
            // …and nobody watching from the rail: the server refuses a
            // watcher's rematch, and the result sheet offers them a table of
            // their own instead.
            if store.state?.cup != true, !store.isWatching {
                MMIconButton(.replay, "Play again",
                             kind: .primary, big: true) { store.rematch() }
            }
            if !store.isHost, store.state?.cup != true, !store.isWatching {
                Text("Whoever presses first hosts the next one.")
                    .font(.system(size: 12.5, weight: .medium, design: .rounded))
                    .foregroundStyle(ink(true))
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
                // The glass's brass: raw gold on the daylight film is 3.2:1.
                Text("\(p.name)'s turn — pass the phone")
                    .font(.system(size: 12.5, weight: .bold, design: .rounded))
                    .foregroundStyle(glass.goldInk)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            } else {
                Text("Your turn")
                    .font(.system(size: 12.5, weight: .bold, design: .rounded))
                    .foregroundStyle(ink(true))
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
                    .foregroundStyle(ink(true))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
            .padding(.horizontal, 9)
            // Concentric with the r22 shell at 12 pt of padding. The strip is
            // a notice drawn on the dock, not a second pane — glass on glass
            // would have it sampling the bar it is sitting on — and the brass
            // goes through the material as a wash rather than sitting on it
            // as a slip of gold paper.
            .background(wash(P.gold), in: block)
            .transition(rowSwap)
        }
    }

    /// The piece is still on its way — same quiet voice as the waiting row,
    /// gone the moment GameStore's holdUntil clears and the landing's
    /// controls take the stage.
    private func walkingRow(_ P: Palette) -> some View {
        HStack(spacing: 10) {
            Art.icon(.dice, size: 17, tint: ink(true))
            Text("Moving…")
                .font(.system(size: 13.5, weight: .semibold, design: .rounded))
                .foregroundStyle(ink(true))
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
            // Auction-only (1.0.6, G6): a landing goes straight to the hammer
            // and the server never offers a deed to buy, so there is no Buy
            // here at all. Should one ever arrive at such a table anyway, the
            // only door is the auction it would have gone to.
            if store.state?.settings.auctionOnly == true {
                if let pending = turn.pending, pending.type == "buy" {
                    MMIconButton(.gavel, "Send to auction", kind: .primary, big: true) {
                        store.skipBuy()
                    }
                }
            } else if let pending = turn.pending, pending.type == "buy",
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
                        hint("Not enough cash for this one.")
                    }
                }
            }

        case "roll":
            if store.me?.inJail == true {
                VStack(spacing: 8) {
                    MMIconButton(.dice, "Roll for a double", kind: .primary, big: true) { store.roll() }
                    HStack(spacing: 8) {
                        Button("Pay $50 & wait") { store.jailPay() }
                            .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                            .disabled((store.me?.money ?? 0) < 50)
                        if (store.me?.getOutCards ?? 0) > 0 {
                            MMIconButton(.ticket, "Use card", kind: .gold, big: true) { store.jailCard() }
                        }
                    }
                    // The fine buys the door and nothing else, so the panel has
                    // to say so before it is pressed — a player who expects to
                    // roll afterwards has spent $50 on a turn they were losing
                    // anyway.
                    // The third try cannot keep anybody in: a miss walks out
                    // free and moves by the roll (1.0.6). Paying then would be
                    // $50 for a turn spent standing still, so the panel says
                    // which roll this is before anybody reaches for the fine.
                    let attempt = (store.me?.jailTurns ?? 0) + 1
                    if attempt >= 3 {
                        hint("In prison · last try — double or not, this roll walks you out free")
                    } else {
                        hint("In prison · attempt \(attempt) of 3")
                    }
                    hint("Paying the fine ends your turn — the card lets you roll.")
                }
            } else {
                MMIconButton(.dice, "Roll dice", kind: .primary, big: true) { store.roll() }
                if (turn.doubles ?? 0) > 0 {
                    hint("Double! Free roll (\(turn.doubles ?? 0) of 2)")
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
                    // The glyph keeps the raw red; the words take the glass's.
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(P.bad)
                    Text("\(money(remaining)) in the red")
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundStyle(glass.bad(increaseContrast: increaseContrast))
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
                    .foregroundStyle(ink(true))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(wash(P.bad), in: block)

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
        // As presented, so the dock never announces a bust the board has not
        // shown yet.
        let locals = store.shownPlayers.filter { store.isLocal($0.id) }
        if !locals.isEmpty, locals.allSatisfy(\.isBankrupt),
           let me = locals.first(where: { $0.id == store.meId }) ?? locals.first {
            HStack(spacing: 8) {
                // Walked out, dozed off past the clock, or spent everything —
                // three different endings, so three different marks.
                Art.icon(me.wasRemoved ? (me.removedFor == "quit" ? .door : .snooze) : .payment,
                         size: 17, tint: ink(true))
                Text(me.wasRemoved
                     ? "You're out of this game — watching how it ends."
                     : "You went bankrupt — watching how it ends.")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(ink(true))
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
                // A seat that went bankrupt keeps the turn while its estate
                // sells (G5), and "is playing…" would be a player who is out
                // playing on. As presented, like the rest of the dock.
                let selling = store.state?.auction?.estate != nil && store.shown(current).isBankrupt
                AvatarView(name: current.name, colorCSS: current.color, flag: current.flag ?? "", size: 26, emoji: current.avatar ?? "")
                Text(selling ? "\(current.name)’s estate is up for auction…" : "\(current.name) is playing…")
                    .font(.system(size: 13.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(ink(true))
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

    /// The dock's trade rows (1.0.6, G9): never more than one card, however
    /// many deals are open.
    ///
    /// A single offer waiting on an answer is the card itself, answered right
    /// here. Two or more — or any set aside for later — fold into one "Offers
    /// (n)" row that opens the list, where each is a compact card of its own:
    /// the old dock showed the first with "+2 more" beside it and nowhere to
    /// see the other two. What this device sent is a line with its Cancel, or
    /// a count once there are several. And while nobody has offered this
    /// device anything, other people's open offers (G8) are one quiet line —
    /// the table's news, read-only, opening the same list.
    /// Pass & play: offers to ANY seat on this device show up here.
    @ViewBuilder private var tradeRows: some View {
        let P = Palette.current(scheme)
        let incoming = store.incomingOffers
        let active = incoming.filter { $0.ignored != true }
        let sent = store.sentOffers
        let table = store.tableTrades
        let ink = OfferInk.glass(glass, increaseContrast: increaseContrast)

        if incoming.count == 1, let trade = active.first {
            OfferCard(trade: trade, ink: ink,
                      onLater: { store.ignoreTrade(trade.id) },
                      onCounter: openCounter,
                      compact: true)
                .padding(10)
                // The offer is the one block on the dock with an edge of its
                // own: it is something to answer, not a line of status.
                .background(wash(P.gold), in: block)
                .overlay(block.stroke(P.gold.opacity(0.6), lineWidth: 1))
                .id(trade.id)
                .transition(rowSwap)
        } else if !incoming.isEmpty {
            offersRow(incoming, active: active, P)
                .transition(rowSwap)
        }

        if sent.count == 1, let trade = sent.first {
            SentOfferRow(trade: trade, ink: ink)
                .transition(rowSwap)
        } else if sent.count > 1 {
            listRow(glyph: .trade,
                    title: "\(sent.count) offers sent",
                    detail: "waiting on \(names(sent.map(\.to)))",
                    action: "Review", P)
                .transition(rowSwap)
        }

        if incoming.isEmpty, let first = table.first {
            listRow(glyph: .eye,
                    title: table.count == 1 ? "Table trade" : "Table trades (\(table.count))",
                    detail: store.tablePhrase(first),
                    action: nil, P)
                .transition(rowSwap)
        }
    }

    /// "Offers (3)": the senders' faces, who they are, and the way into the
    /// list. A wash of brass with an edge while any of them is waiting on an
    /// answer; a plain well when every one has been set aside.
    private func offersRow(_ incoming: [TradeOffer], active: [TradeOffer], _ P: Palette) -> some View {
        var senders: [PlayerState] = []
        for t in incoming {
            if let p = store.state?.player(t.from), !senders.contains(where: { $0.id == p.id }) {
                senders.append(p)
            }
        }
        let parked = incoming.count - active.count
        let who = "From " + names(incoming.map(\.from))
        let detail = active.isEmpty
            ? (parked == 1 ? "Set aside for later" : "All \(parked) set aside for later")
            : parked > 0 ? "\(who) · \(parked) set aside" : who
        return Button {
            openOffers?()
            Haptics.tap()
        } label: {
            HStack(spacing: 10) {
                HStack(spacing: -8) {
                    ForEach(senders.prefix(3)) { p in
                        AvatarView(name: p.name, colorCSS: p.color, flag: "", size: 26, emoji: p.avatar ?? "")
                            .overlay(Circle().stroke(glass.solid, lineWidth: 2))
                    }
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text("Offers (\(incoming.count))")
                        .font(.system(size: 14, weight: .heavy, design: .rounded))
                        .foregroundStyle(ink())
                        .contentTransition(.numericText())
                    Text(detail)
                        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(ink(true))
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
                Text("Review")
                    .font(.system(size: 12.5, weight: .bold, design: .rounded))
                    .foregroundStyle(glass.goldInk)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(glass.goldInk)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(active.isEmpty ? well : wash(P.gold), in: block)
            .overlay(block.stroke(active.isEmpty ? .clear : P.gold.opacity(0.6), lineWidth: 1))
            .contentShape(block)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Offers, \(incoming.count). \(detail)")
        .accessibilityHint("Opens the list of offers")
    }

    /// A one-line way into the offers list: what it is, a word on it, and —
    /// where there is something to do there — the word for doing it.
    private func listRow(glyph: Glyph, title: String, detail: String, action: String?, _ P: Palette) -> some View {
        Button {
            openOffers?()
            Haptics.tap()
        } label: {
            HStack(spacing: 7) {
                Art.icon(glyph, size: 13, tint: ink(true))
                Text(title)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(ink())
                    .fixedSize()
                Text(detail)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(ink(true))
                    .lineLimit(1)
                Spacer(minLength: 4)
                if let action {
                    Text(action)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(glass.goldInk)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .heavy))
                    .foregroundStyle(action == nil ? ink(true) : glass.goldInk)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(well, in: block)
            .contentShape(block)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the list of offers")
    }

    /// "Ravi", "Ravi and Asha", "Ravi, Asha and Kabeer" — each seat once.
    private func names(_ ids: [String]) -> String {
        var seen: [String] = []
        for id in ids {
            let name = store.state?.player(id)?.name ?? "?"
            if !seen.contains(name) { seen.append(name) }
        }
        if seen.count > 1 { return seen.dropLast().joined(separator: ", ") + " and " + seen.last! }
        return seen.first ?? "?"
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12.5, weight: .medium, design: .rounded))
            .foregroundStyle(ink(true))
    }
}

/// The gently pulsing "… is viewing" presence line, under a drawn eye.
/// Somebody has your offer open in front of them.
///
/// The seconds between sending a deal and hearing back are the only part of a
/// trade with nothing in them, and they are exactly when a player decides the
/// other side is ignoring them. A pulsing word says "loading"; an eye that
/// blinks on its own says a person is looking at this. So the lid closes
/// twice, quickly, and then holds open for a long moment — a human rhythm
/// rather than a spinner's — and the watchers' own colours sit beside it.
struct ViewingLine: View {
    let text: String
    let color: Color
    /// The colours of whoever is looking, in seat order.
    var faces: [Color] = []
    @Environment(\.colorScheme) private var scheme
    @Environment(\.mmControlBackdrop) private var backdrop
    @State private var lid: CGFloat = 1

    var body: some View {
        HStack(spacing: 7) {
            Art.icon(.eye, size: 14, tint: color)
                .scaleEffect(y: lid, anchor: .center)
            if !faces.isEmpty {
                HStack(spacing: -4) {
                    ForEach(Array(faces.enumerated()), id: \.offset) { _, c in
                        Circle()
                            .fill(c)
                            .frame(width: 12, height: 12)
                            .overlay(Circle().stroke(separator, lineWidth: 1.5))
                    }
                }
            }
            Text(text)
                .font(.system(size: 11.5, weight: .bold, design: .rounded))
                .foregroundStyle(color)
                .lineLimit(1)
        }
        .padding(.leading, 7).padding(.trailing, 9)
        .padding(.vertical, 5)
        .background(color.opacity(0.12), in: Capsule())
        .overlay(Capsule().stroke(color.opacity(0.34), lineWidth: 1))
        .task { await blink() }
    }

    /// The faces overlap, so each one needs a ring in the colour of whatever is
    /// behind them or they read as one smear. This line only ever appears on
    /// the dock, and what is behind it there is the material — a ring in the
    /// old card colour would be a small opaque blob sitting on the glass. So
    /// it is the colour the glass under it composites to, for whichever way
    /// that glass has leaned, rather than the film taken from the scheme.
    private var separator: Color {
        backdrop.settledGlass(Palette.current(scheme)).solid
    }

    /// Two blinks, then a pause long enough that it never reads as a flicker.
    private func blink() async {
        while !Task.isCancelled {
            for _ in 0..<2 {
                withAnimation(.easeInOut(duration: 0.07)) { lid = 0.1 }
                try? await Task.sleep(for: .milliseconds(80))
                withAnimation(.easeInOut(duration: 0.09)) { lid = 1 }
                try? await Task.sleep(for: .milliseconds(150))
            }
            try? await Task.sleep(for: .milliseconds(3600))
        }
    }
}
