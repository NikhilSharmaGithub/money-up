// The sheet an incoming offer arrives on.
//
// The dock at the bottom of the game screen lists offers too, and on a wide
// screen that is where a deal gets read. But an offer is the one thing in the
// game that happens on somebody else's clock: it lands while you are looking
// at the board, and the person who sent it is sitting there waiting for an
// answer. So it comes to the front of the screen once, on its own.
//
// What is on the table is drawn as things rather than described in a line of
// text — a coin for the cash, a street in its own colour with its own flag, a
// card for a card. A line reading "$420 · Venice · 1× prison card" is a
// receipt; this is an offer. The meter underneath leans whichever way the
// deal does and says out loud that it is only weighing the price printed on
// the deeds, which is not what a street is worth to whoever needs that last
// one.
//
// Closing it touches nothing. The offer stays live in the dock, the sender is
// still waiting, and this sheet will not open twice for the same deal.

import SwiftUI

struct TradeOfferSheet: View {
    let trade: TradeOffer
    /// Which of this device's seats the offer is addressed to — pass & play
    /// means that is not always the main player.
    var seat: String
    var onNegotiate: (TradeOffer) -> Void

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    /// A sheet nobody asked for arrives under whatever finger was already on
    /// its way somewhere else — and the button it lands on accepts a trade.
    /// Found the hard way: a tap meant for "Start Game" gave away a street.
    /// So the three answers do nothing at all for a moment after it appears.
    @State private var armed = false

    private var from: PlayerState? { store.state?.player(trade.from) }
    private var mine: PlayerState? { store.state?.player(seat) }

    // Face value only: the price on the deed, nothing about how badly anyone
    // needs it. The meter says as much underneath itself.
    private func worth(_ side: TradeSide) -> Int {
        side.money + side.cards * 50
            + side.tiles.reduce(0) { $0 + (store.tile($1)?.price ?? 0) }
    }

    private var theirs: Int { worth(trade.give) }
    private var ours: Int { worth(trade.get) }
    private var diff: Int { theirs - ours }

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 0) {
            header(P)
            Divider().overlay(P.rule)
            ScrollView {
                VStack(spacing: 0) {
                    ZStack {
                        VStack(spacing: 10) {
                            side(label: "You get", side: trade.give, total: theirs,
                                 who: from, tone: P.good, P: P)
                            side(label: "You give", side: trade.get, total: ours,
                                 who: mine, tone: P.bad, P: P)
                        }
                        swapMedallion(P)
                    }
                    meter(P)
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
            }
            actions(P)
        }
        .background(P.sheet.ignoresSafeArea())
        // Sized for the deal rather than the screen: two piles, the meter and
        // the answers, with no gap under them and nothing cut off. A deal with
        // half a colour group in it can be dragged up to the full screen.
        .presentationDetents([.height(540), .large])
        .presentationDragIndicator(.hidden)
        .onAppear {
            // The sender's card lights while this is open.
            store.setTradeViewing(trade.id, true, as: seat)
        }
        .task {
            try? await Task.sleep(for: .milliseconds(450))
            armed = true
        }
        .onDisappear {
            store.setTradeViewing(trade.id, false, as: seat)
        }
    }

    // MARK: - header

    private func header(_ P: Palette) -> some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color(css: from?.color ?? "#888"))
                .frame(width: 44, height: 44)
                .overlay(
                    Text(String((from?.name.prefix(1) ?? "?")).uppercased())
                        .font(.system(size: 18, weight: .black, design: .rounded))
                        .foregroundStyle(.white))
                .overlay(Circle().stroke(Color(css: from?.color ?? "#888").opacity(0.28), lineWidth: 3)
                    .padding(-3))
            VStack(alignment: .leading, spacing: 2) {
                Text("\(from?.name ?? "Someone") wants to trade")
                    .font(.system(size: 17, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink)
                Text("Their offer is on the table.")
                    .font(.system(size: 12.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
            Spacer(minLength: 4)
            Button {
                Haptics.tap()
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(P.ink3)
                    .frame(width: 32, height: 32)
                    .background(P.sunken, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, 16)
        .padding(.top, 18)
        .padding(.bottom, 14)
    }

    // MARK: - the two piles

    private func side(label: String, side: TradeSide, total: Int,
                      who: PlayerState?, tone: Color, P: Palette) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline) {
                Text(label.uppercased())
                    .font(.system(size: 10.5, weight: .heavy, design: .rounded))
                    .kerning(0.8)
                    .foregroundStyle(tone)
                Spacer()
                Text(money(total))
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(P.ink2)
            }
            chips(side, P: P)
            HStack(spacing: 6) {
                Circle()
                    .fill(Color(css: who?.color ?? "#888"))
                    .frame(width: 18, height: 18)
                    .overlay(Text(String((who?.name.prefix(1) ?? "?")).uppercased())
                        .font(.system(size: 10, weight: .black, design: .rounded))
                        .foregroundStyle(.white))
                Text(store.isLocal(who?.id) ? "from you" : "from \(who?.name ?? "?")")
                    .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(P.sunken, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .stroke(tone.opacity(0.42), lineWidth: 1))
    }

    /// Everything on one side of the deal, each thing drawn as itself.
    @ViewBuilder private func chips(_ side: TradeSide, P: Palette) -> some View {
        let tiles = side.tiles.compactMap { store.tile($0) }
        if side.money == 0 && tiles.isEmpty && side.cards == 0 {
            Text("nothing")
                .font(.system(size: 12.5, weight: .medium, design: .rounded))
                .italic()
                .foregroundStyle(P.ink3)
                .padding(.horizontal, 9).padding(.vertical, 5)
                .overlay(Capsule().stroke(P.rule, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        } else {
            FlowRow(spacing: 6) {
                if side.money > 0 {
                    chip(P: P, border: P.gold.opacity(0.55), fill: P.goldSoft) {
                        Art.icon(.coin, size: 15)
                        Text(money(side.money))
                            .font(.system(size: 12.5, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                    }
                }
                ForEach(tiles, id: \.index) { t in
                    let g = t.group.flatMap { store.state?.groups[$0] }
                    chip(P: P, border: P.rule, fill: P.card,
                         leading: Color(css: g?.color ?? "#7c6bb0")) {
                        if let g, !g.flag.isEmpty {
                            GroupMedallion(mark: g.flag, colour: Color(css: g.color), size: 16)
                        } else {
                            Circle().fill(Color(css: g?.color ?? "#7c6bb0")).frame(width: 9, height: 9)
                        }
                        Text(t.name)
                            .font(.system(size: 12.5, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                            .lineLimit(1)
                        Text("$\(t.price ?? 0)")
                            .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(P.ink3)
                    }
                }
                if side.cards > 0 {
                    chip(P: P, border: P.rule, fill: P.card) {
                        Art.icon(.key, size: 14)
                        Text("\(side.cards)× out of prison")
                            .font(.system(size: 12.5, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                    }
                }
            }
        }
    }

    private func chip<C: View>(P: Palette, border: Color, fill: Color,
                               leading: Color? = nil,
                               @ViewBuilder content: () -> C) -> some View {
        HStack(spacing: 6) { content() }
            .padding(.leading, leading == nil ? 9 : 7)
            .padding(.trailing, 9)
            .padding(.vertical, 5)
            .background(fill, in: Capsule())
            .overlay(alignment: .leading) {
                if let leading {
                    Capsule().fill(leading).frame(width: 4)
                }
            }
            .overlay(Capsule().stroke(border, lineWidth: 1))
            .clipShape(Capsule())
    }

    /// The badge that straddles the seam between the two piles.
    private func swapMedallion(_ P: Palette) -> some View {
        Image(systemName: "arrow.up.arrow.down")
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(P.ink2)
            .frame(width: 34, height: 34)
            .background(P.card, in: Circle())
            .overlay(Circle().stroke(P.rule2, lineWidth: 1))
            .shadow(color: .black.opacity(0.18), radius: 4, y: 2)
    }

    // MARK: - which way it leans

    private func meter(_ P: Palette) -> some View {
        let span = max(theirs, ours, 1)
        let lean = max(-1.0, min(1.0, Double(diff) / Double(span)))
        let even = abs(diff) < 25
        let tone: Color = even ? P.ink3 : (diff > 0 ? P.good : P.bad)
        return VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(P.sunken)
                    Capsule().fill(tone)
                        .frame(width: w / 2 * abs(lean))
                        .offset(x: lean >= 0 ? w / 2 : w / 2 - w / 2 * abs(lean))
                    Rectangle().fill(P.rule2).frame(width: 2).offset(x: w / 2 - 1)
                }
            }
            .frame(height: 6)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(even ? "An even deal"
                     : diff > 0 ? "\(money(diff)) your way" : "\(money(-diff)) their way")
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundStyle(tone)
                Text("by the price on the deeds")
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
        }
        .padding(.top, 14)
    }

    // MARK: - the three answers

    private func actions(_ P: Palette) -> some View {
        VStack(spacing: 8) {
            Button {
                Haptics.turn()
                store.respondTrade(trade.id, accept: true)
                dismiss()
            } label: {
                Text("Accept the deal").frame(maxWidth: .infinity)
            }
            .buttonStyle(MMButtonStyle(kind: .good, big: true))
            .disabled(!armed)

            HStack(spacing: 8) {
                Button {
                    Haptics.tap()
                    let t = trade
                    dismiss()
                    // SwiftUI will not swap one sheet for another in the same
                    // frame, so the composer opens after this one is gone.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onNegotiate(t) }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.up.arrow.down").font(.system(size: 13, weight: .bold))
                        Text("Negotiate")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(MMButtonStyle(kind: .ghost))
                .disabled(!armed)

                Button {
                    Haptics.tap()
                    store.respondTrade(trade.id, accept: false)
                    dismiss()
                } label: {
                    Text("Decline").frame(maxWidth: .infinity)
                }
                .buttonStyle(MMButtonStyle(kind: .ghost))
                .disabled(!armed)
            }

            Text("Closing this leaves the offer on the table — the dock keeps it.")
                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink3)
                .multilineTextAlignment(.center)
                .padding(.top, 2)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 18)
        .background(P.sheet)
    }
}

/// A row of chips that wraps — the streets on one side of a deal are however
/// many they are, and SwiftUI has no flow layout of its own before iOS 16's
/// Layout protocol, which this is.
struct FlowRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for v in subviews {
            let size = v.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0; y += rowHeight + spacing; rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize,
                       subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for v in subviews {
            let size = v.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX; y += rowHeight + spacing; rowHeight = 0
            }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
