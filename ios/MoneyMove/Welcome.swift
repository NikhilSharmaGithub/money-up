// The first two minutes.
//
// Somebody who has never played this opens the app and sees a board, a Play
// button and five tabs. They can work it out — property games are old and most
// people half-know the rules — but "half-know" is where a new player loses
// their first game to somebody who owns a full set, and losing your first game
// without understanding why is how you stop playing.
//
// So: six cards, once, before anything else. The turn, why full sets decide
// games, why deals matter, and then the three things the app does that a board
// game cannot — play anyone, tournaments, and a shelf of boards.
//
// Rules for this screen, learned the hard way from every onboarding anybody
// has ever skipped:
//
//   It is skippable from the first frame. A player who wants to play now is
//   the best kind of player and must never be held.
//
//   It is re-openable from Settings, so skipping costs nothing.
//
//   It says only what changes how somebody plays. No tour of the tab bar.
//
//   It is versioned, not a boolean — when there is genuinely something new
//   worth two minutes, the number goes up and it shows once more.

import SwiftUI

/// Bump this when the intro gains something existing players should see.
let INTRO_VERSION = 1

struct IntroPage: Identifiable {
    let glyph: Glyph
    let title: String
    let line: String
    /// Two or three things, each its own drawing. The body of the card.
    let points: [(Glyph, String)]

    var id: String { title }
}

let INTRO_PAGES: [IntroPage] = [
    IntroPage(
        glyph: .globe,
        title: "Welcome to MoneyMove",
        line: "Buy streets. Build hotels. Bankrupt your friends.",
        points: [
            (.people, "Two to eight players, on one phone or across the world"),
            (.map, "Nineteen boards — a world tour, single countries, and a few odd ones"),
            (.dice, "A game runs about half an hour"),
        ]),
    IntroPage(
        glyph: .dice,
        title: "A turn is three things",
        line: "Roll, move, and deal with wherever you land.",
        points: [
            (.dice, "Roll two dice and move. A double lets you roll again — three in a row and you are in prison"),
            (.key, "Land on a street nobody owns and you may buy it. Turn it down and everyone bids for it"),
            (.payment, "Land on somebody else's and you pay their rent"),
        ]),
    IntroPage(
        glyph: .houses,
        title: "Whole sets win games",
        line: "One street collects pennies. A country collects the game.",
        points: [
            (.crane, "Own every street of one colour and you can build — houses first, then a hotel"),
            (.cash, "Rent climbs steeply with each one. A hotel on a good set ends most games"),
            (.warning, "This is the rule new players lose to. Chase sets, not bargains"),
        ]),
    IntroPage(
        glyph: .trade,
        title: "Deals decide it",
        line: "Nobody completes a set by luck alone.",
        points: [
            (.trade, "Offer cash, streets and prison cards to anyone, any time"),
            (.gavel, "A street somebody refuses goes to auction — that is where sets get finished"),
            (.bank, "Short of money? Mortgage a street for half, and buy it back later"),
        ]),
    IntroPage(
        glyph: .people,
        title: "Play with anyone",
        line: "One tap and you are at a table.",
        points: [
            (.bolt, "Play now drops you in with whoever else is online"),
            (.door, "Or make a private room and send the link to your friends"),
            (.ticket, "Nobody around? Pass one phone around the table instead"),
        ]),
    IntroPage(
        glyph: .trophy,
        title: "Cups, coins and boards",
        line: "There is more here than one game.",
        points: [
            (.trophy, "Tournaments run to a clock, with real prizes for the last few standing"),
            (.coin, "Win games and turn up daily to earn coins"),
            (.map, "Two boards are free every day. Spend the coins to keep the ones you love"),
        ]),
]

/// The intro itself: six cards, a dot for each, and a way out of every one.
struct WelcomeIntro: View {
    /// Called when they finish it or skip it — either way it is done.
    var onDone: () -> Void

    @Environment(\.colorScheme) private var scheme
    @State private var page = 0

    var body: some View {
        let P = Palette.current(scheme)
        let last = page == INTRO_PAGES.count - 1

        ZStack {
            LinearGradient(colors: [P.page, P.page2], startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Out, from the first frame. Somebody who wants to play now is
                // the best kind of player and must never be held here.
                HStack {
                    Spacer()
                    Button("Skip") { finish() }
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                }

                TabView(selection: $page) {
                    ForEach(Array(INTRO_PAGES.enumerated()), id: \.element.id) { i, p in
                        card(p, P).tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(.easeInOut(duration: 0.25), value: page)

                // The dots, drawn rather than borrowed, so they sit where the
                // rest of the app's chrome sits.
                HStack(spacing: 7) {
                    ForEach(0..<INTRO_PAGES.count, id: \.self) { i in
                        Capsule()
                            .fill(i == page ? P.gold : P.rule)
                            .frame(width: i == page ? 20 : 7, height: 7)
                            .animation(.spring(duration: 0.3), value: page)
                    }
                }
                .padding(.bottom, 18)

                Button {
                    SoundKit.shared.click()
                    if last { finish() }
                    else { withAnimation { page += 1 } }
                } label: {
                    Text(last ? "Let's play" : "Next")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(MMButtonStyle(kind: last ? .gold : .primary, big: true))
                .padding(.horizontal, 22)
                .padding(.bottom, 10)

                Text("You can read all this again in Settings.")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .padding(.bottom, 18)
            }
        }
        .transition(.opacity)
    }

    private func finish() {
        SoundKit.shared.click()
        onDone()
    }

    private func card(_ p: IntroPage, _ P: Palette) -> some View {
        VStack(spacing: 16) {
            Spacer(minLength: 0)

            // The hero: one drawing, big, in a ring — the same medallion the
            // rest of the app uses for something worth looking at.
            ZStack {
                Circle().fill(P.goldSoft)
                Circle().stroke(P.gold.opacity(0.55), lineWidth: 1.5)
                Art.icon(p.glyph, size: 54, tint: P.gold)
            }
            .frame(width: 116, height: 116)

            VStack(spacing: 7) {
                Text(p.title)
                    .font(.system(size: 25, weight: .black, design: .rounded))
                    .foregroundStyle(P.ink)
                    .multilineTextAlignment(.center)
                Text(p.line)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 8)

            VStack(alignment: .leading, spacing: 13) {
                ForEach(Array(p.points.enumerated()), id: \.offset) { _, point in
                    HStack(alignment: .top, spacing: 12) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(P.sunken)
                            Art.icon(point.0, size: 17, tint: P.ink2)
                        }
                        .frame(width: 36, height: 36)
                        Text(point.1)
                            .font(.system(size: 13.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(16)
            .background(P.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(P.rule, lineWidth: 1))

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 22)
    }
}

/// The Settings row that opens it again. Skipping the intro must cost nothing,
/// which means it has to be findable afterwards.
struct IntroAgainRow: View {
    @Environment(\.colorScheme) private var scheme
    @State private var showing = false

    var body: some View {
        let P = Palette.current(scheme)
        Button {
            SoundKit.shared.click()
            showing = true
        } label: {
            HStack(spacing: 10) {
                Art.icon(.bulb, size: 17, tint: P.ink2)
                VStack(alignment: .leading, spacing: 1) {
                    Text("How MoneyMove works")
                        .font(.system(size: 14.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                    Text("The six cards you saw when you first opened it")
                        .font(.system(size: 11.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(P.ink3)
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
        .fullScreenCover(isPresented: $showing) {
            WelcomeIntro { showing = false }
        }
    }
}
