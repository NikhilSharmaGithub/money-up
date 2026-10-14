// The bankrupt player's question (1.0.7, H2): at a table where the player
// decides, whoever goes out picks what happens to their properties — back to
// the bank, or auctioned to everyone left, one by one.
//
// Three views of the one question:
//
//   - the prompt, for the seat being asked: the whole screen, because the
//     whole table is waiting on it and it has twenty seconds;
//   - the give-up card, for a seat going out of its own accord (Give up, or
//     Declare bankruptcy in the red): the same two answers inside the
//     confirmation, so the player decides once and is never asked again;
//   - the card in the centre well, for everybody else: who is deciding, about
//     what, and how long the house will wait before it decides for them.
//
// The server holds the game still while the question is open and answers for
// anybody who is not there to — this side only ever asks and draws.
// docs/API-1.0.6.md, "Round 3", is the contract.

import SwiftUI

// MARK: - the prompt

/// "You're bankrupt — what happens to your 4 properties?" The seat being asked
/// is one of this device's (on a pass & play phone, perhaps not the main
/// player's, and then the card says whose turn with the phone it is).
struct BankruptChoicePrompt: View {
    let choice: BankruptChoice

    @EnvironmentObject var store: GameStore

    var body: some View {
        let mine = choice.playerId == store.meId
        let whose = mine ? "your" : "their"
        EstateChoiceCard(
            tiles: choice.properties,
            endsAt: choice.endsAt,
            title: mine ? "You’re bankrupt" : "\(choice.name) is bankrupt",
            question: "What happens to \(whose) \(Self.count(choice.properties.count))?",
            note: mine ? nil : "Pass the phone to \(choice.name).",
            footnote: "Nobody waits for ever — if the time runs out, the house decides.",
            pick: { store.answerBankruptChoice(auction: $0) })
    }

    /// "property", "4 properties".
    static func count(_ n: Int) -> String {
        n == 1 ? "property" : "\(n) properties"
    }
}

/// Going out of one's own accord at a table where the player decides: the
/// confirmation and the question in one card. Keep playing takes it all back.
struct GiveUpCard: View {
    let ask: GiveUpAsk

    @EnvironmentObject var store: GameStore

    var body: some View {
        let tiles = store.deeds(of: ask.seat)
        let mine = ask.seat == store.meId
        let name = store.state?.player(ask.seat)?.name ?? "This player"
        let whose = mine ? "your" : "their"
        // In the red, the creditor keeps what was already paid — said here
        // because it is the one thing the two answers below do not change.
        let debt = store.state?.turn?.debt
        let payee = debt?.debtor == ask.seat ? store.state?.debtPayee(debt) : nil
        let paid = payee.map { "Whatever \(mine ? "you have" : "they have") paid stays with \($0). " } ?? ""
        EstateChoiceCard(
            tiles: tiles,
            title: ask.kind == .declare
                ? (mine ? "Declare bankruptcy?" : "\(name) goes bankrupt?")
                : (mine ? "Give up the game?" : "\(name) gives up?"),
            question: "\(paid)\(mine ? "You’ll" : "They’ll") be out of the game. What happens to \(whose) \(BankruptChoicePrompt.count(tiles.count))?",
            glyph: ask.kind == .declare ? .payment : .door,
            pick: { store.giveUp(ask, auction: $0) },
            cancel: { store.giveUpAsk = nil })
    }
}

/// The shell both of the above wear, the way the timed-out card does: a scrim
/// over the table and one piece of glass in its opaque form — there is
/// nothing to see through it to — holding the question, the deeds it is
/// about, the two answers and, where there is one, the clock.
struct EstateChoiceCard: View {
    let tiles: [Int]
    /// The house answers at this moment; nil when nobody is waiting.
    var endsAt: Double? = nil
    let title: String
    let question: String
    /// A word for whoever holds the phone, under the question.
    var note: String? = nil
    var footnote: String? = nil
    /// The header's mark when there is no clock to show instead.
    var glyph: Glyph = .skull
    let pick: (_ auction: Bool) -> Void
    /// Nil for a question that must be answered; otherwise the way back.
    var cancel: (() -> Void)? = nil

    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    /// Twenty seconds: BANKRUPT_CHOICE.ms in server/game.js.
    static let window: Double = 20

    var body: some View {
        let P = Palette.current(scheme)
        let glass = BackdropKind.page.settledGlass(P)
        let ic = contrast == .increased
        let second = glass.label(secondary: true, increaseContrast: ic)
        ZStack {
            Color.black.opacity(0.6)
                .ignoresSafeArea()
                // A give-up can be taken back by tapping away from it; a
                // question the table is waiting on cannot.
                .onTapGesture { cancel?() }

            VStack(spacing: 14) {
                HStack(alignment: .center, spacing: 13) {
                    badge(glass, P)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title)
                            .font(.system(size: 20, weight: .heavy, design: .rounded))
                            .foregroundStyle(glass.ink)
                            .lineLimit(2)
                            .minimumScaleFactor(0.8)
                        Text(question)
                            .font(.system(size: 13.5, weight: .medium, design: .rounded))
                            .foregroundStyle(second)
                            .fixedSize(horizontal: false, vertical: true)
                        if let note {
                            Text(note)
                                .font(.system(size: 12, weight: .bold, design: .rounded))
                                .foregroundStyle(glass.goldInk)
                        }
                    }
                    Spacer(minLength: 0)
                }

                EstateDeedList(tiles: tiles, glass: glass)

                VStack(spacing: 8) {
                    EstateOption(glyph: .bank, title: "Give them back to the bank",
                                 caption: "Unowned again, for whoever lands on them next.",
                                 accent: glass.ink, glass: glass) { pick(false) }
                    EstateOption(glyph: .gavel, title: "Auction them to everyone",
                                 caption: "Sold one by one to the players still in.",
                                 accent: P.gold, glass: glass) { pick(true) }
                }

                if let cancel {
                    Button("Keep playing") {
                        cancel()
                        Haptics.tap()
                    }
                    .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                }

                if let footnote {
                    Text(footnote)
                        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(second)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(20)
            .frame(maxWidth: 390)
            // The buttons stand on the shell, so they are drawn into it.
            .mmControls(on: .chrome)
            .mmGlass(.opaque, backdrop: .page,
                     in: RoundedRectangle(cornerRadius: MMRadius.xl, style: .continuous))
            .padding(.horizontal, 16)
            .transition(.scale(scale: 0.9).combined(with: .opacity))
        }
        .accessibilityAddTraits(.isModal)
    }

    /// The clock while the house is waiting on the answer; otherwise the
    /// card's own mark in a disc of the glass.
    @ViewBuilder
    private func badge(_ glass: GlassTokens, _ P: Palette) -> some View {
        if let endsAt {
            CountdownRing(endsAt: endsAt, window: Self.window, size: 54, lineWidth: 5,
                          track: glass.ink.opacity(0.12), ink: glass.ink)
        } else {
            Art.icon(glyph, size: 26, tint: glass.ink)
                .frame(width: 54, height: 54)
                .background(P.bad.opacity(0.16), in: Circle())
                .overlay(Circle().stroke(P.bad.opacity(0.4), lineWidth: 1))
        }
    }
}

/// One of the two answers: its drawing in a tile of its colour, what it does
/// in a line, and the chevron that says it goes.
private struct EstateOption: View {
    let glyph: Glyph
    let title: String
    let caption: String
    let accent: Color
    let glass: GlassTokens
    let action: () -> Void

    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        let ic = contrast == .increased
        Button(action: action) {
            HStack(spacing: 12) {
                Art.icon(glyph, size: 21, tint: accent)
                    .frame(width: 40, height: 40)
                    .background(accent.opacity(0.16),
                                in: RoundedRectangle(cornerRadius: MMRadius.sm, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundStyle(glass.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(caption)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(glass.label(secondary: true, increaseContrast: ic))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(glass.label(secondary: true, increaseContrast: ic))
            }
            .padding(11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: MMRadius.md, style: .continuous))
        }
        .buttonStyle(EstateOptionStyle(ink: glass.ink, rim: accent, increaseContrast: ic))
    }
}

/// A well pressed into the card that deepens under the thumb.
private struct EstateOptionStyle: ButtonStyle {
    /// The glass's own ink: the well is a tenth of it, as every ghost on a
    /// pane of glass is, and nearly a fifth under the thumb.
    let ink: Color
    let rim: Color
    let increaseContrast: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: MMRadius.md, style: .continuous)
        let depth = (increaseContrast ? 0.18 : 0.10) + (configuration.isPressed ? 0.08 : 0)
        return configuration.label
            .background(ink.opacity(depth), in: shape)
            .overlay(shape.stroke(rim.opacity(configuration.isPressed ? 0.6 : 0.25), lineWidth: 1))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .animation(.spring(duration: 0.22), value: configuration.isPressed)
    }
}

/// The deeds in question, one row each: colour, mark, name, printed price.
/// Long estates scroll inside the card rather than pushing the answers off a
/// small phone.
struct EstateDeedList: View {
    let tiles: [Int]
    let glass: GlassTokens

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    private static let rowHeight: CGFloat = 36

    var body: some View {
        let P = Palette.current(scheme)
        let ic = contrast == .increased
        let second = glass.label(secondary: true, increaseContrast: ic)
        let worth = tiles.compactMap { store.tile($0)?.price }.reduce(0, +)
        let rows = VStack(spacing: 0) {
            ForEach(Array(tiles.enumerated()), id: \.element) { k, i in
                if k > 0 {
                    Rectangle().fill(glass.ink.opacity(0.08)).frame(height: 1).padding(.leading, 44)
                }
                row(i, second, P)
            }
        }
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(BankruptChoicePrompt.count(tiles.count).uppercased())
                    .font(.system(size: 10.5, weight: .bold))
                    .kerning(1)
                Spacer()
                if worth > 0 {
                    Text("\(money(worth)) printed")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .monospacedDigit()
                }
            }
            .foregroundStyle(second)
            .padding(.horizontal, 4)

            Group {
                if tiles.count > 4 {
                    ScrollView { rows }
                        .frame(maxHeight: Self.rowHeight * 4.5)
                        .scrollIndicators(.visible)
                } else {
                    rows
                }
            }
            .background(glass.ink.opacity(ic ? 0.18 : 0.10),
                        in: RoundedRectangle(cornerRadius: MMRadius.md, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: MMRadius.md, style: .continuous))
        }
    }

    private func row(_ i: Int, _ second: Color, _ P: Palette) -> some View {
        let tile = store.tile(i)
        return HStack(spacing: 10) {
            TileMark(tile: tile, size: 20)
            VStack(alignment: .leading, spacing: 0) {
                Text(tile?.name ?? "Property")
                    .font(.system(size: 13.5, weight: .bold, design: .rounded))
                    .foregroundStyle(glass.ink)
                    .lineLimit(1)
                if let group = tile.flatMap({ store.groupInfo(for: $0) }) {
                    Text(group.name)
                        .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(second)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            if let price = tile?.price {
                Text(money(price))
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(second)
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: Self.rowHeight)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - everybody else

/// The centre well while somebody else decides: who, about what, and how long
/// the table waits before the house decides for them. The game holds still
/// meanwhile — no dice, no clock on the turn — so this takes the dice's place.
struct EstateDecisionBox: View {
    let choice: BankruptChoice

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        let brass = BackdropKind.paper.settledGlass(P).goldInk
        let card = RoundedRectangle(cornerRadius: MMRadius.lg, style: .continuous)
        let player = store.state?.player(choice.playerId)
        let mine = store.isLocal(choice.playerId)
        let shown = Array(choice.properties.prefix(6))
        let extra = choice.properties.count - shown.count
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 6) {
                Art.icon(.fork, size: 13, tint: brass)
                Text("BANKRUPT")
                    .font(.system(size: 10.5, weight: .black, design: .rounded))
                    .kerning(1.4)
                    .foregroundStyle(brass)
                Spacer(minLength: 6)
                if let endsAt = choice.endsAt {
                    CountdownRing(endsAt: endsAt, window: EstateChoiceCard.window, size: 34, lineWidth: 4,
                                  track: P.sunken, ink: P.ink)
                }
            }
            HStack(alignment: .center, spacing: 10) {
                if let player {
                    AvatarView(name: player.name, colorCSS: player.color, flag: player.flag ?? "",
                               size: 34, emoji: player.avatar ?? "")
                }
                Text(mine ? "You’re deciding what happens to your streets…"
                          : "\(choice.name) is deciding what happens to their streets…")
                    .font(.system(size: 13.5, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(3)
                    .minimumScaleFactor(0.85)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 4) {
                ForEach(shown, id: \.self) { i in
                    TileMark(tile: store.tile(i), size: 20)
                }
                if extra > 0 {
                    Text("+\(extra)")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink3)
                }
                Spacer(minLength: 4)
                Text("Bank or auction")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .fixedSize()
            }
        }
        .padding(12)
        .frame(maxWidth: 330)
        .background(P.card, in: card)
        .overlay(card.stroke(P.gold.opacity(0.55), lineWidth: 1))
        .shadow(color: .black.opacity(scheme == .light ? 0.16 : 0.45), radius: 14, y: 6)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - the clock

/// Seconds left as a ring around the number, counted down on this device from
/// the server's deadline. It warms from brass to red over the last five and
/// beats once a second while it does — the turn clock's last-moments
/// heartbeat. The auction card and the bankruptcy question both wear it.
struct CountdownRing: View {
    let endsAt: Double
    /// The whole span the ring stands for, in seconds: a full ring is this.
    let window: Double
    var size: CGFloat = 42
    var lineWidth: CGFloat = 4.5
    /// What the empty part of the ring is drawn in, and the number.
    var track: Color? = nil
    var ink: Color? = nil

    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let P = Palette.current(scheme)
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
            let remaining = max(0, endsAt / 1000 - context.date.timeIntervalSince1970)
            let fraction = min(1, remaining / max(window, 1))
            let heat = min(1, max(0, (5 - remaining) / 5))
            let beat = remaining.truncatingRemainder(dividingBy: 1)
            let pulse = heat > 0 && !reduceMotion && remaining > 0
                ? 1 + 0.07 * max(0, (beat - 0.72) / 0.28) : 1
            let style = StrokeStyle(lineWidth: lineWidth, lineCap: .round)
            let seconds = Int(ceil(remaining))
            ZStack {
                Circle().stroke(track ?? P.sunken, lineWidth: lineWidth)
                Circle().trim(from: 0, to: fraction)
                    .stroke(P.gold, style: style)
                    .rotationEffect(.degrees(-90))
                    .opacity(1 - heat)
                Circle().trim(from: 0, to: fraction)
                    .stroke(P.bad, style: style)
                    .rotationEffect(.degrees(-90))
                    .opacity(heat)
                Text("\(seconds)")
                    .font(.system(size: size * 0.36, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(heat > 0 ? P.bad : (ink ?? P.ink))
            }
            .padding(lineWidth / 2)
            .frame(width: size, height: size)
            .scaleEffect(pulse)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(seconds) seconds left")
        }
        // A fresh deadline restarts the schedule, so the number can never be
        // left frozen on the last one's final second.
        .id(endsAt)
    }
}
