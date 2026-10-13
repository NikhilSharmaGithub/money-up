// Every open offer at the table, in one place (1.0.6).
//
// An offer used to arrive as a card in the dock with "+2 more" beside it and a
// sheet of its own on top, so a player with two or three deals waiting saw one,
// a counter, and then another sheet the moment the first one closed. Now the
// dock keeps a single card while there is a single offer, and folds two or
// more into one "Offers (n)" row that opens this list: every offer as a
// compact card — who it is from, what you get and what you give as the deeds
// themselves, which way it leans by the printed prices — each with its own
// Accept, Decline and Counter.
//
// Below them, the offers this device has sent, and then everybody else's
// (round 2, G8): every open offer at the table is public, read-only to anybody
// it is not addressed to. The server enforces who may answer what; this list
// only offers the buttons the server would honour.

import SwiftUI

// MARK: - who an offer belongs to

extension GameStore {
    /// Offers to a seat on this device — pass & play means any of them —
    /// oldest first, the ones set aside included.
    var incomingOffers: [TradeOffer] {
        (state?.trades ?? []).filter { isLocal($0.to) }.sorted { $0.id < $1.id }
    }

    /// Offers a seat on this device has made and is waiting on.
    var sentOffers: [TradeOffer] {
        (state?.trades ?? []).filter { isLocal($0.from) && !isLocal($0.to) }.sorted { $0.id < $1.id }
    }

    /// Everybody else's open offers (G8): on the table for anyone to read,
    /// and for nobody here to answer.
    var tableTrades: [TradeOffer] {
        (state?.trades ?? []).filter { !isLocal($0.from) && !isLocal($0.to) }.sorted { $0.id < $1.id }
    }

    /// One side of a deal at face value: the price printed on each deed, $50
    /// a prison card. Nothing about how badly anyone needs the last street of
    /// a set — which is why every place that shows it says so.
    func tradeWorth(_ side: TradeSide) -> Int {
        side.money + side.cards * 50 + side.tiles.reduce(0) { $0 + (tile($1)?.price ?? 0) }
    }

    /// One side of a deal as a phrase: "$300 · Tel Aviv · 1× prison card".
    func tradeSummary(_ side: TradeSide) -> String {
        var bits: [String] = []
        if side.money > 0 { bits.append(money(side.money)) }
        bits.append(contentsOf: side.tiles.compactMap { tile($0)?.name })
        if side.cards > 0 { bits.append("\(side.cards)× prison card") }
        return bits.isEmpty ? "nothing" : bits.joined(separator: " · ")
    }

    /// A table trade in a line, the way the log would say it:
    /// "Ravi → Asha: Tel Aviv for $300". `give` is what the sender parts
    /// with, `get` what they ask for.
    func tablePhrase(_ trade: TradeOffer) -> String {
        let from = state?.player(trade.from)?.name ?? "Someone"
        let to = state?.player(trade.to)?.name ?? "someone"
        let give = trade.give.money > 0 || !trade.give.tiles.isEmpty || trade.give.cards > 0
        let get = trade.get.money > 0 || !trade.get.tiles.isEmpty || trade.get.cards > 0
        let deal: String
        switch (give, get) {
        case (true, true): deal = "\(tradeSummary(trade.give)) for \(tradeSummary(trade.get))"
        case (true, false): deal = "\(tradeSummary(trade.give)) for nothing"
        default: deal = "asks for \(tradeSummary(trade.get))"
        }
        return "\(from) → \(to): \(deal)"
    }
}

// MARK: - the inks an offer is printed in

/// The same card stands on the dock's glass and on a sheet's paper, and the
/// two take their ink from different places: the glass from its own tokens
/// (ink3 does not survive the material), the paper from the palette.
struct OfferInk {
    var ink: Color
    var ink2: Color
    var good: Color
    var bad: Color
    var gold: Color
    /// A chip pressed into whatever the card stands on.
    var chip: Color
    var chipEdge: Color
    /// What the card itself is drawn on, for the ring that lifts one face
    /// off another where two overlap.
    var ground: Color

    static func glass(_ g: GlassTokens, increaseContrast ic: Bool) -> OfferInk {
        OfferInk(ink: g.label(increaseContrast: ic),
                 ink2: g.label(secondary: true, increaseContrast: ic),
                 good: g.good(increaseContrast: ic),
                 bad: g.bad(increaseContrast: ic),
                 gold: g.goldInk,
                 chip: g.ink.opacity(ic ? 0.16 : 0.08),
                 chipEdge: g.ink.opacity(ic ? 0.30 : 0.14),
                 ground: g.solid)
    }

    static func paper(_ P: Palette) -> OfferInk {
        OfferInk(ink: P.ink, ink2: P.ink3, good: P.good, bad: P.bad,
                 // The raw gold on paper is a rim colour, not a text one; the
                 // glass's brass is the gold taken halfway to the ink.
                 gold: BackdropKind.paper.settledGlass(P).goldInk,
                 chip: P.sunken, chipEdge: P.rule, ground: P.card)
    }
}

// MARK: - one side of a deal, as things

/// Cash as a coin, a street as its flag and name, a prison card as a key —
/// wrapping onto a second line when a deal is big, never cut off.
struct OfferChips: View {
    let side: TradeSide
    let ink: OfferInk
    @EnvironmentObject var store: GameStore

    var body: some View {
        let tiles = side.tiles.compactMap { store.tile($0) }
        if side.money == 0 && tiles.isEmpty && side.cards == 0 {
            Text("nothing")
                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                .italic()
                .foregroundStyle(ink.ink2)
                .padding(.vertical, 3)
        } else {
            FlowRow(spacing: 5) {
                if side.money > 0 {
                    chip {
                        Art.icon(.coin, size: 13)
                        Text(money(side.money))
                    }
                }
                ForEach(tiles, id: \.index) { t in
                    let g = t.group.flatMap { store.state?.groups[$0] }
                    chip(band: t.type == "property" ? Color(css: g?.color ?? "#7c6bb0") : nil) {
                        TileMark(tile: t, size: 14)
                        Text(t.name).lineLimit(1)
                    }
                }
                if side.cards > 0 {
                    chip {
                        Art.icon(.key, size: 12, tint: ink.ink2)
                        Text("\(side.cards)× prison card")
                    }
                }
            }
        }
    }

    private func chip<C: View>(band: Color? = nil, @ViewBuilder _ content: () -> C) -> some View {
        HStack(spacing: 4) { content() }
            .font(.system(size: 11.5, weight: .bold, design: .rounded))
            .foregroundStyle(ink.ink)
            .padding(.leading, band == nil ? 7 : 8)
            .padding(.trailing, 8)
            .padding(.vertical, 3.5)
            .background(ink.chip, in: Capsule())
            // The set's colour down the leading edge, the way the deed
            // card wears it, so a street reads as its country at a glance.
            .overlay(alignment: .leading) {
                if let band { Rectangle().fill(band).frame(width: 3) }
            }
            .clipShape(Capsule())
            .overlay(Capsule().stroke(ink.chipEdge, lineWidth: 1))
    }
}

/// Which way a deal leans for whoever receives it, by the deeds' printed
/// prices: "$120 your way", "$80 their way", or "Even".
struct OfferBalance: View {
    /// What the receiver gets and gives, at face value.
    let gets: Int
    let gives: Int
    let ink: OfferInk

    var body: some View {
        let diff = gets - gives
        let even = abs(diff) < 25
        let tone = even ? ink.ink2 : (diff > 0 ? ink.good : ink.bad)
        HStack(spacing: 4) {
            Art.icon(.scales, size: 11, tint: tone)
            Text(even ? "Even" : diff > 0 ? "\(money(diff)) your way" : "\(money(-diff)) their way")
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(tone)
                .lineLimit(1)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(tone.opacity(0.12), in: Capsule())
        .fixedSize()
        .accessibilityElement(children: .combine)
        .accessibilityHint("By the prices printed on the deeds")
    }
}

// MARK: - an incoming offer, compact

/// One offer to a seat on this device, small enough that three of them fit a
/// phone's half sheet: who sent it, the two sides as things, the lean, and the
/// three answers. The dock wears the same card while it holds a single offer.
struct OfferCard: View {
    let trade: TradeOffer
    let ink: OfferInk
    /// The dock's card can be set aside; the list's cannot — it is already
    /// the place set-aside offers come back to.
    var onLater: (() -> Void)? = nil
    var onCounter: ((TradeOffer) -> Void)? = nil
    /// The dock's cut: who it is from on one line, and the rows a little
    /// closer. The dock shares the screen with the board, and every point it
    /// grows is taken off the board above it.
    var compact = false

    @EnvironmentObject var store: GameStore
    /// A card that arrives on its own arrives under whatever finger was
    /// already on its way somewhere else — the reason the offer sheet holds
    /// its answers back for a moment. Every card does the same now.
    @State private var armed = false

    var body: some View {
        let from = store.state?.player(trade.from)
        let forGuest = trade.to != store.meId ? store.state?.player(trade.to) : nil
        // Accepting a deal you can't fund just bounces off the server with a
        // toast; say so before the tap instead. A deal that asks for no cash
        // is always affordable — a debtor's negative balance must not grey
        // out the very offer that would pay the debt off.
        let short = trade.get.money > 0
            ? trade.get.money - (store.state?.player(trade.to)?.money ?? 0) : 0

        VStack(alignment: .leading, spacing: compact ? 6 : 8) {
            HStack(spacing: 8) {
                AvatarView(name: from?.name ?? "?", colorCSS: from?.color ?? "#888",
                           flag: from?.flag ?? "", size: compact ? 22 : 26, emoji: from?.avatar ?? "")
                let offers = forGuest.map { "offers \($0.name)" } ?? "offers you"
                if compact {
                    (Text(from?.name ?? "Someone")
                        .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(ink.ink)
                     + Text(" " + offers)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(ink.ink2))
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(from?.name ?? "Someone")
                            .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                            .foregroundStyle(ink.ink)
                            .lineLimit(1)
                        Text(offers)
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(ink.ink2)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 6)
                OfferBalance(gets: store.tradeWorth(trade.give), gives: store.tradeWorth(trade.get), ink: ink)
            }

            side("You get", trade.give, tone: ink.good)
            side("You give", trade.get, tone: ink.bad)

            if let watching = viewerNames {
                ViewingLine(text: "\(watching) is reading this", color: ink.gold, faces: viewerColours)
            }
            if trade.ignored == true {
                HStack(spacing: 5) {
                    Art.icon(.snooze, size: 12, tint: ink.ink2)
                    Text("Set aside — still waiting on your answer")
                        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(ink.ink2)
                }
            }
            if short > 0 {
                Text("Short \(money(short)) — sell or mortgage first.")
                    .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(ink.bad)
            }

            answers(short: short)
        }
        .task {
            try? await Task.sleep(for: .milliseconds(450))
            armed = true
        }
        // The sender's "is reading this" lights while the card is on screen.
        .onAppear { store.setTradeViewing(trade.id, true, as: trade.to) }
        .onDisappear { store.setTradeViewing(trade.id, false, as: trade.to) }
    }

    private func side(_ label: String, _ side: TradeSide, tone: Color) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label.uppercased())
                .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                .kerning(0.6)
                .foregroundStyle(tone)
                .frame(width: 54, alignment: .leading)
                .padding(.top, 5)
            OfferChips(side: side, ink: ink)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(store.tradeSummary(side))")
    }

    private func answers(short: Int) -> some View {
        HStack(spacing: 7) {
            Button {
                Haptics.turn()
                store.respondTrade(trade.id, accept: true)
            } label: {
                answer("Accept")
            }
            .buttonStyle(MMButtonStyle(kind: .good))
            .disabled(!armed || short > 0)
            .opacity(short > 0 ? 0.45 : 1)

            if let onCounter {
                Button {
                    Haptics.tap()
                    onCounter(trade)
                } label: {
                    answer("Counter")
                }
                .buttonStyle(MMButtonStyle(kind: .gold))
                .disabled(!armed)
            }

            Button {
                Haptics.tap()
                store.respondTrade(trade.id, accept: false)
            } label: {
                answer("Decline")
            }
            .buttonStyle(MMButtonStyle(kind: .bad))
            .disabled(!armed)

            if let onLater {
                Button {
                    onLater()
                    Haptics.tap()
                } label: {
                    Art.icon(.snooze, size: 15, tint: ink.ink)
                        .frame(width: 22)
                }
                .buttonStyle(MMButtonStyle(kind: .ghost))
                .fixedSize()
                .accessibilityLabel("Later")
                .accessibilityHint("Sets the offer aside without answering it")
            }
        }
    }

    /// One answer's word. On a 375-point phone the dock's card hands each of
    /// the three about 79 points beside the snooze key, and "Counter" and
    /// "Decline" are a few points wider than what is left of that inside
    /// the button — so the word tightens and gives up a little size before
    /// it would ever give up its last letters.
    private func answer(_ word: String) -> some View {
        Text(word)
            .lineLimit(1)
            .allowsTightening(true)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity)
    }

    /// Everyone looking at the offer right now, minus this device's own seats.
    private var viewerNames: String? {
        let names = (trade.viewers ?? [])
            .filter { !store.isLocal($0) }
            .compactMap { store.state?.player($0)?.name }
        return names.isEmpty ? nil : names.joined(separator: ", ")
    }

    private var viewerColours: [Color] {
        (trade.viewers ?? [])
            .filter { !store.isLocal($0) }
            .compactMap { store.state?.player($0) }
            .map { Color(css: $0.color) }
    }
}

// MARK: - somebody else's offer, read-only

/// "Ravi → Asha: Tel Aviv for $300" — an offer between two other people
/// (G8). Everybody at the table can read it, watchers included; only Asha can
/// answer it and only Ravi can take it back, so there is nothing to press.
struct TableTradeRow: View {
    let trade: TradeOffer
    let ink: OfferInk
    @EnvironmentObject var store: GameStore

    var body: some View {
        let from = store.state?.player(trade.from)
        let to = store.state?.player(trade.to)
        let asks = trade.give.money == 0 && trade.give.tiles.isEmpty && trade.give.cards == 0
        HStack(alignment: .top, spacing: 10) {
            ZStack(alignment: .bottomTrailing) {
                AvatarView(name: from?.name ?? "?", colorCSS: from?.color ?? "#888",
                           flag: "", size: 24, emoji: from?.avatar ?? "")
                AvatarView(name: to?.name ?? "?", colorCSS: to?.color ?? "#888",
                           flag: "", size: 16, emoji: to?.avatar ?? "")
                    .overlay(Circle().stroke(ink.ground, lineWidth: 1.5))
                    .offset(x: 6, y: 5)
            }
            .frame(width: 30, height: 30, alignment: .topLeading)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 5) {
                    Text(from?.name ?? "Someone")
                    Image(systemName: "arrow.right")
                        .font(.system(size: 10, weight: .heavy))
                        .foregroundStyle(ink.ink2)
                    Text(to?.name ?? "someone")
                }
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(ink.ink)
                .lineLimit(1)

                if asks {
                    HStack(alignment: .top, spacing: 6) {
                        word("asks for")
                        OfferChips(side: trade.get, ink: ink)
                    }
                } else {
                    OfferChips(side: trade.give, ink: ink)
                    HStack(alignment: .top, spacing: 6) {
                        word("for")
                        OfferChips(side: trade.get, ink: ink)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(store.tablePhrase(trade))
    }

    private func word(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11.5, weight: .semibold, design: .rounded))
            .foregroundStyle(ink.ink2)
            .padding(.top, 4)
    }
}

// MARK: - one of ours, sent

/// An offer a seat on this device made: to whom, the deal in a line, whether
/// they have it open, and the way to take it back.
struct SentOfferRow: View {
    let trade: TradeOffer
    let ink: OfferInk
    @EnvironmentObject var store: GameStore

    var body: some View {
        let to = store.state?.player(trade.to)
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text("To \(to?.name ?? "?")")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(ink.ink)
                // Name the deal, not just the recipient — you can't take back
                // what you offered if you can't remember it.
                Text("\(store.tradeSummary(trade.give)) ⇄ \(store.tradeSummary(trade.get))")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(ink.ink2)
                    .lineLimit(2)
                if let watching = viewerNames {
                    ViewingLine(text: "\(watching) is reading this", color: ink.gold, faces: [])
                } else if trade.ignored == true {
                    HStack(spacing: 5) {
                        Art.icon(.snooze, size: 12, tint: ink.ink2)
                        Text("Set aside for later")
                            .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(ink.ink2)
                    }
                }
            }
            Spacer(minLength: 6)
            Button("Cancel") { store.cancelTrade(trade.id) }
                .buttonStyle(MMButtonStyle(kind: .ghost))
                .fixedSize()
        }
    }

    private var viewerNames: String? {
        let names = (trade.viewers ?? [])
            .filter { !store.isLocal($0) }
            .compactMap { store.state?.player($0)?.name }
        return names.isEmpty ? nil : names.joined(separator: ", ")
    }
}

// MARK: - the list

/// "Offers (3)": every offer to this device, then the ones it sent, then the
/// rest of the table's. Opened from the dock's offers row, or by itself when a
/// second offer lands while the first is still open.
struct OffersSheet: View {
    /// Opens the composer on a counter-offer once this sheet has gone —
    /// SwiftUI will not swap one sheet for another in the same frame.
    var onCounter: (TradeOffer) -> Void

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let P = Palette.current(scheme)
        let ink = OfferInk.paper(P)
        let incoming = store.incomingOffers
        let sent = store.sentOffers
        let table = store.tableTrades
        // Offers waiting on an answer first; the ones set aside after them.
        let ordered = incoming.filter { $0.ignored != true } + incoming.filter { $0.ignored == true }

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if !ordered.isEmpty {
                        PanelTitle(ordered.count == 1 ? "For you" : "For you · \(ordered.count)")
                        ForEach(ordered) { t in
                            MMCard(padding: 12) {
                                OfferCard(trade: t, ink: ink, onCounter: counter)
                            }
                            // Something to answer wears an edge of brass, the
                            // way the dock's card does; a set-aside one keeps
                            // the card's own rule.
                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(t.ignored == true ? .clear : P.gold.opacity(0.55), lineWidth: 1))
                            .transition(.opacity.combined(with: .scale(scale: 0.97)))
                        }
                    }

                    if !sent.isEmpty {
                        PanelTitle("You sent")
                            .padding(.top, ordered.isEmpty ? 0 : 8)
                        MMCard(padding: 12) {
                            VStack(alignment: .leading, spacing: 10) {
                                ForEach(Array(sent.enumerated()), id: \.element.id) { k, t in
                                    if k > 0 { Rectangle().fill(P.rule).frame(height: 1) }
                                    SentOfferRow(trade: t, ink: ink)
                                }
                            }
                        }
                    }

                    if !table.isEmpty {
                        PanelTitle("Table trades")
                            .padding(.top, ordered.isEmpty && sent.isEmpty ? 0 : 8)
                        MMCard(padding: 12) {
                            VStack(alignment: .leading, spacing: 10) {
                                ForEach(Array(table.enumerated()), id: \.element.id) { k, t in
                                    if k > 0 { Rectangle().fill(P.rule).frame(height: 1) }
                                    TableTradeRow(trade: t, ink: ink)
                                }
                            }
                        }
                        Text("Every open offer is on the table for everyone to see. Only the player it is for can answer it.")
                            .font(.system(size: 11.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 4)
                    }

                    if ordered.isEmpty && sent.isEmpty && table.isEmpty {
                        VStack(spacing: 8) {
                            Art.icon(.trade, size: 30, tint: P.ink3)
                            Text("No open offers at the table.")
                                .font(.system(size: 14, weight: .medium, design: .rounded))
                                .foregroundStyle(P.ink3)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .animation(.snappy(duration: 0.28), value: store.state?.trades.map(\.id) ?? [])
            }
            .scrollBounceBehavior(.basedOnSize)
            .navigationTitle(incoming.isEmpty ? "Trades" : "Offers (\(incoming.count))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .sheetBarItem(on: .sheet)
                }
            }
        }
        .mmControls(on: .platter(.sheet))
        .sheetPaper(P.sheet)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        // The last offer answered or withdrawn, and nothing left to read: the
        // list has done its job. A beat first, so the answer is seen to land.
        .task(id: store.state?.trades.isEmpty ?? true) {
            guard store.state?.trades.isEmpty ?? true else { return }
            try? await Task.sleep(for: .milliseconds(600))
            if !Task.isCancelled, store.state?.trades.isEmpty ?? true { dismiss() }
        }
    }

    private func counter(_ trade: TradeOffer) {
        dismiss()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onCounter(trade) }
    }
}
