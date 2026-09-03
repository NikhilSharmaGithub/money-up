// Rewarded ads, the player's half.
//
// Everything here is dead weight until the server says otherwise. GET
// /api/ads/config is the whole switch: while it answers `enabled: false` no
// button is drawn, no card is mounted and no countdown exists, so a phone
// talking to a dark server shows the app exactly as it was yesterday. The day
// the owner flips the toggle on the desk, these two offers appear on their own.
//
// Coins are scarce on purpose — the daily ladder starts at one and tops out at
// seven, a win pays two, and the cheapest piece in the shop is 300. A view is
// therefore worth real money, so this file never mints anything. It asks for an
// offer, plays the ad, and hands the ticket back:
//
//   POST /api/ads/offer    the server agrees this view will be paid for, and
//                          issues a signed, single-use, short-lived ticket
//   POST /api/ads/reward   the ticket comes back and only then do coins move
//
// The offer is asked for BEFORE the ad plays, so nobody is ever shown five
// seconds of promo against a cap they had already hit.
//
// What plays in between is the gateway's choice, not this file's. When it
// answers `provider: admob` the offer also carries a unit id and a nonce, and
// RewardedAdNetwork.swift loads Google's rewarded ad for that unit; every
// other answer, and every way Google can fail to fill the slot, ends at the
// house ad below.

import SwiftUI

// MARK: - what the gateway answers

/// POST /api/ads/offer. A refusal arrives in the same shape, with `error` set.
struct AdOfferReply: Decodable {
    struct Reward: Decodable { var coins: Int? }
    var ok: Bool?
    var ticket: String?
    var placement: String?
    var provider: String?
    var expiresAt: Double?
    var reward: Reward?
    var remaining: [String: Int]?

    /// Present only when the gateway is serving AdMob: the unit to load, the
    /// nonce Google's server-side callback has to carry back so /api/ads/ssv
    /// can tell which ticket it just confirmed, and a short opaque tag it
    /// cross-checks that confirmation against. None of the three is the wallet
    /// token — nothing that spends coins is handed to an ad network.
    var unitId: String?
    var customData: String?
    var userId: String?

    var error: String?
    /// Seconds until the same request would be allowed, when the refusal was a
    /// cooldown rather than a cap.
    var retryInSec: Double?
}

/// POST /api/ads/reward — the only message in the app that moves coins.
struct AdRewardReply: Decodable {
    var ok: Bool?
    var placement: String?
    /// What this view paid.
    var awarded: Int?
    /// The wallet afterwards.
    var coins: Int?
    var remaining: [String: Int]?

    var error: String?
    var retryInSec: Double?
    /// Not "no" — "not yet". The gateway sets this when the only thing missing
    /// is Google's own confirmation of a view that has already happened, and it
    /// means the ticket was not burnt and the same claim is worth making again.
    var pending: Bool?
}

// MARK: - the desk

/// One shared read of the ad switchboard, and the loop that spends it.
///
/// GameStore already fetches /api/ads/config, but it asks anonymously — it has
/// nothing to say about who is asking at the point it asks — so the per-device
/// counts ("3 left today") are not in that answer. This re-reads the config as
/// this phone, and only ever when the anonymous answer already said ads are on.
/// A dark server is never asked twice.
@MainActor
final class AdDesk: ObservableObject {
    static let shared = AdDesk()

    /// The config as THIS device, or nil while ads are dark or unread.
    @Published private(set) var config: AdsConfig?
    /// True from the moment an offer is asked for until the reward lands, so a
    /// button can say what it is doing instead of going quiet.
    @Published private(set) var busy = false
    /// What a doubled win came to last time. Only the server knows what a win
    /// is worth, and asking costs a ticket, so the first offer of a session
    /// says it in words and every one after it can do the arithmetic.
    @Published private(set) var lastDouble: (from: Int, to: Int)?

    private var loading = false
    /// Set once a read has come back saying ads are off. A dark server gets
    /// asked once a launch and is then left alone — the whole point of this
    /// system is that it costs nothing until somebody switches it on.
    private var knownDark = false

    func slot(_ name: String) -> AdPlacement? { config?.slot(name) }

    /// Reads the switchboard as this device.
    ///
    /// Called from the SCREENS that host an offer rather than from the offers
    /// themselves: an offer with nothing to show renders no view at all, and a
    /// .task on nothing never runs — it would spend the whole session waiting
    /// for a config it was the one thing responsible for fetching.
    func refresh(_ store: GameStore, force: Bool = false) async {
        guard !loading, force || (config == nil && !knownDark) else { return }
        loading = true
        defer { loading = false }
        let token = store.token
        // fetchJSON's normal path builder percent-encodes the "?", so a query
        // string has to be glued on in raw mode.
        //
        // `platform` is said out loud rather than left to the server's
        // User-Agent sniff: the gateway serves a different network to a phone
        // than to a browser, and a guess is a poor thing to hang that on. An
        // older server has never heard of the field and ignores it.
        let fresh: AdsConfig? = try? await store.fetchJSON(
            "/api/ads/config?token=\(token)&platform=ios", raw: true)
        // A read that didn't land leaves whatever we had — and leaves the door
        // open to ask again. A read that landed saying "off" takes every
        // affordance off the screen and closes it.
        guard let fresh else { return }
        config = fresh.live ? fresh : nil
        knownDark = !fresh.live
    }

    /// Offer, ad, reward — the whole loop, and the only route a coin takes from
    /// a view into a wallet. Returns what was paid, or nil for every other
    /// outcome; each one of those has already been said out loud.
    ///
    /// `house` is handed what the break is worth and answers whether it was
    /// watched to the end. It is the fallback, not the plan: when the gateway
    /// says AdMob, Google's ad goes in front of it. Closing either one early
    /// is always allowed and never pays.
    func watch(_ name: String, store: GameStore,
               house: @escaping (Int) async -> Bool) async -> (paid: Int, coins: Int)? {
        guard !busy, slot(name) != nil else { return nil }
        busy = true
        defer { busy = false }

        let offer: AdOfferReply? = try? await store.fetchJSON(
            "/api/ads/offer", method: "POST",
            body: ["token": store.token, "placement": name, "platform": "ios"])

        guard let offer else {
            store.showToast("Couldn't reach the server — try again.", isError: true)
            return nil
        }
        note(offer.remaining)
        if let error = offer.error {
            store.showToast(Self.refusal(error, offer.retryInSec), isError: true)
            return nil
        }
        guard let ticket = offer.ticket else {
            store.showToast("That did not go through — try again.", isError: true)
            return nil
        }

        // What this break is being watched FOR. Only the server knows the
        // figure — a doubled win pays whatever that win paid.
        let worth = offer.reward?.coins ?? slot(name)?.coins ?? 0

        // Google first, but only when the gateway itself said Google. The
        // server already falls back to the house adapter the moment AdMob
        // can't serve, so `provider` is the one answer both halves obey.
        let network = offer.provider == "admob"
            ? await RewardedAdNetwork.shared.show(unitId: offer.unitId ?? "",
                                                  customData: offer.customData ?? "",
                                                  userId: offer.userId ?? "")
            : NetworkAdOutcome.unavailable

        let watched: Bool
        switch network {
        case .earned:
            watched = true
        case .dismissed:
            // A real ad, walked out of. The same answer as walking out of a
            // house one, for the same reason: the break wasn't watched.
            watched = false
        case .unavailable:
            // No fill, a load that never landed, an id nobody has pasted in
            // yet. The player was promised a break and a reward, so the house
            // serves the break and the ticket goes back to the gateway exactly
            // as it would have — because the ticket is the only thing in this
            // conversation that authorises a coin. This app has never decided
            // a payout and does not start now; it carries the one thing the
            // server signed and lets the server rule on it. Which is also why
            // the gateway is free to disagree: while the desk has AdMob live
            // it wants Google's own callback before it pays, and if it refuses
            // this claim the refusal is printed in the server's own words.
            watched = await house(worth)
        }
        guard watched else {
            store.showToast("Closed early — nothing was paid for that one.")
            return nil
        }

        let claim = await redeem(ticket, store: store)

        guard let claim else {
            store.showToast("Couldn't reach the server — try again.", isError: true)
            return nil
        }
        note(claim.remaining)
        if let error = claim.error {
            store.showToast(Self.refusal(error, claim.retryInSec), isError: true)
            return nil
        }

        // The server is the authority on the size of the payout: an offer
        // quoting a figure the claim then disagrees with pays what the claim
        // says. The wallet is re-read rather than trusting the copy that rode
        // back with it.
        let paid = claim.awarded ?? worth
        store.refreshWallet()
        SoundKit.shared.gain()
        Haptics.turn()
        return (paid: paid, coins: claim.coins ?? 0)
    }

    /// Redeems one ticket, and waits out a provider that hasn't finished
    /// speaking yet.
    ///
    /// On AdMob a coin needs two things to arrive: this claim, and Google's own
    /// server-side callback confirming the view. They travel separately and the
    /// phone usually wins the race — the gateway already holds the claim at the
    /// door for a few seconds because of it, but a few seconds is a guess about
    /// somebody else's infrastructure, and the cost of guessing low is a player
    /// who sat through thirty seconds of video and gets a red error for it.
    ///
    /// So `pending` is not treated as an answer. The ticket survives a pending
    /// refusal — the gateway only burns one when it pays — and the same claim
    /// is made again until it is honoured or the budget runs out. Every other
    /// refusal is final and is shown as it arrives: a cap, a cooldown or an
    /// expired ticket does not change its mind because it was asked twice.
    ///
    /// The budget is short on purpose, because of the other failure this sits
    /// on top of. A callback a few seconds late is worth waiting for; an SSV
    /// URL typed with a typo into the AdMob console is a callback that is
    /// never coming, and every view under it would spend the whole budget
    /// before admitting it. Fifteen seconds on top of the gateway's own five
    /// is long enough for the first and short enough to survive the second.
    private func redeem(_ ticket: String, store: GameStore) async -> AdRewardReply? {
        let deadline = Date.now.addingTimeInterval(15)
        while true {
            let claim: AdRewardReply? = try? await store.fetchJSON(
                "/api/ads/reward", method: "POST",
                body: ["token": store.token, "ticket": ticket])
            guard let claim, claim.pending == true, Date.now < deadline else { return claim }
            let wait = min(4, max(1, claim.retryInSec ?? 2))
            try? await Task.sleep(for: .seconds(wait))
        }
    }

    /// Remembers what a doubled win came to, so the next offer can print it.
    func noteDouble(from: Int, to: Int) { lastDouble = (from, to) }

    /// Folds a fresh `remaining` map from an offer or a claim into the config.
    private func note(_ remaining: [String: Int]?) {
        guard let remaining, var cfg = config else { return }
        for (slot, n) in remaining {
            cfg.placements?[slot]?.remaining = n
            cfg.remaining?[slot] = n
        }
        config = cfg
    }

    /// The server's own wording, with its "try again in" attached. Anything
    /// longer than an hour is a cap rather than a cooldown, and the sentence
    /// already says so better than a countdown would.
    static func refusal(_ error: String, _ retryInSec: Double?) -> String {
        let wait = Int((retryInSec ?? 0).rounded(.up))
        if wait <= 0 || wait > 3600 { return error }
        if wait < 60 { return "\(error) — try again in \(wait)s." }
        let mins = Int((Double(wait) / 60).rounded(.up))
        return "\(error) — try again in \(mins) minute\(mins == 1 ? "" : "s")."
    }
}

// MARK: - the house ad

/// What runs today, and what runs forever whenever a network has nothing to
/// fill the slot with. An unfilled break is still five seconds somebody was
/// promised a reward for, so it is never allowed to be a blank screen.
///
/// `onFinish(true)` means the countdown ran out and the button was pressed;
/// `false` means it was closed early, which pays nothing.
struct HouseAdView: View {
    /// What the claim button says once it lights.
    let rewardCoins: Int
    let onFinish: (Bool) -> Void

    @Environment(\.colorScheme) private var scheme

    /// Five seconds, and the button is dead for every one of them.
    private static let seconds: Double = 5
    @State private var left: Double = HouseAdView.seconds
    @State private var line = HouseAdView.lines.randomElement() ?? HouseAdView.lines[0]
    @State private var lit = false
    /// Guards against the countdown and a tap both reporting a result.
    @State private var done = false

    // Honest about what the screen is, because a house ad pretending to be a
    // real one is just a worse real one.
    private static let lines = [
        "Nobody has bought this slot yet, so the house took it.",
        "This break is brought to you by the table you are already at.",
        "Five seconds of nothing, and then some coins. Fair trade.",
        "An advert for the game you are currently playing. We know.",
    ]

    var body: some View {
        let P = Palette.current(scheme)
        ZStack {
            LinearGradient(colors: [P.page, P.page2], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            // Soft table sheen, the same one the splash lays down.
            RadialGradient(colors: [P.card.opacity(scheme == .light ? 0.7 : 0.14), .clear],
                           center: .init(x: 0.5, y: 0.34), startRadius: 10, endRadius: 340)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                header(P)
                Spacer(minLength: 8)

                LogoMark(size: 104)
                    .padding(.bottom, 22)
                Wordmark(fontSize: 34)
                Text(line)
                    .font(.system(size: 14.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink2)
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
                    .padding(.horizontal, 34)

                Spacer(minLength: 12)
                countdown(P)
                claimButton(P)

                Text("Close it early and the reward does not count.")
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .padding(.top, 11)
                    .padding(.bottom, 26)
            }
            .frame(maxWidth: 460)
        }
        .task { await runClock() }
    }

    /// The label an ad is required to wear, and the way out of it. Leaving is
    /// always allowed — it just isn't paid, and the button says so.
    private func header(_ P: Palette) -> some View {
        HStack {
            Text("ADVERT")
                .font(.system(size: 9.5, weight: .heavy))
                .kerning(1.4)
                .foregroundStyle(P.ink3)
            Spacer()
            Button {
                SoundKit.shared.click()
                finish(false)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(P.ink3)
                    .frame(width: 32, height: 32)
                    .background(P.sunken, in: Circle())
                    .overlay(Circle().stroke(P.rule, lineWidth: 1))
            }
            .accessibilityLabel("Close without the reward")
        }
        .padding(.horizontal, 18)
        .padding(.top, 14)
    }

    /// A ring that empties while the number inside it falls. Both are drawn —
    /// no spinner, no third-party frame.
    @ViewBuilder
    private func countdown(_ P: Palette) -> some View {
        if !lit {
            ZStack {
                Circle().stroke(P.rule2, lineWidth: 3.5)
                Circle()
                    .trim(from: 0, to: 1 - left / Self.seconds)
                    .stroke(P.gold, style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text("\(max(1, Int(left.rounded(.up))))")
                    .font(.system(size: 15, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(P.ink2)
            }
            .frame(width: 46, height: 46)
            .padding(.bottom, 14)
            .transition(.opacity)
        }
    }

    private func claimButton(_ P: Palette) -> some View {
        Button {
            SoundKit.shared.click()
            finish(true)
        } label: {
            HStack(spacing: 8) {
                Art.icon(.coin, size: 19)
                Text(rewardCoins > 0
                     ? "Claim your \(rewardCoins) coin\(rewardCoins == 1 ? "" : "s")"
                     : "Claim your reward")
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(MMButtonStyle(kind: .primary, big: true))
        .disabled(!lit)
        .opacity(lit ? 1 : 0.45)
        .scaleEffect(lit ? 1 : 0.97)
        .padding(.horizontal, 26)
    }

    /// The countdown is the contract: nothing is claimable before it runs out.
    private func runClock() async {
        let step = 0.05
        while left > 0, !done, !Task.isCancelled {
            try? await Task.sleep(for: .seconds(step))
            left = max(0, left - step)
        }
        guard !done, !Task.isCancelled else { return }
        SoundKit.shared.click()
        withAnimation(.spring(duration: 0.35, bounce: 0.4)) { lit = true }
    }

    private func finish(_ watched: Bool) {
        guard !done else { return }
        done = true
        onFinish(watched)
    }
}

// MARK: - doubleWin, on the game-over sheet

/// The one moment a rewarded ad is worth showing anybody: they have just won,
/// the purse is on screen, and the offer is to make it bigger. It appears for
/// the winner and nobody else, and only while the server still has a view to
/// pay for.
struct DoubleWinOffer: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @ObservedObject private var desk = AdDesk.shared

    /// The purse before and after, once the server has said what it was.
    @State private var doubled: (from: Int, to: Int)?
    @State private var counted = 0
    /// Held while the house ad is up; the continuation the flow is waiting on.
    @State private var playing: AdBreak?

    var body: some View {
        let P = Palette.current(scheme)
        Group {
            if let doubled {
                paidFace(doubled, P)
            } else if let spec = desk.slot("doubleWin"), iWon {
                offerFace(spec, P)
            }
        }
        .animation(.spring(duration: 0.35), value: doubled?.to)
        .fullScreenCover(item: $playing) { break_ in
            HouseAdView(rewardCoins: break_.coins) { watched in
                playing = nil
                break_.finish(watched)
            }
        }
    }

    private var iWon: Bool { store.state?.winner?.id == store.meId }

    private func offerFace(_ spec: AdPlacement, _ P: Palette) -> some View {
        let factor = max(2, Int((spec.factor ?? 2).rounded()))
        let sum = desk.lastDouble.map { " (\($0.from) → \($0.to) coins)" } ?? ""
        return VStack(spacing: 5) {
            Button {
                Task { await run(factor: factor) }
            } label: {
                HStack(spacing: 8) {
                    if desk.busy {
                        ProgressView().tint(P.accentInk)
                    } else {
                        Art.icon(.coin, size: 19)
                    }
                    Text(desk.busy ? "Loading the ad…" : "Watch an ad — double your winnings\(sum)")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(MMButtonStyle(kind: .primary, big: true))
            .disabled(desk.busy)

            Text(waitLine(factor: factor, spec: spec))
                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink3)
                .multilineTextAlignment(.center)
        }
    }

    private func waitLine(factor: Int, spec: AdPlacement) -> String {
        var line = "Five seconds, and the win pays \(factor == 2 ? "twice" : "\(factor) times")."
        if let left = spec.remaining, left > 0 { line += " \(left) left today." }
        return line
    }

    /// What the offer bought, in place of the offer — an offer already taken
    /// must not still look pressable.
    private func paidFace(_ sums: (from: Int, to: Int), _ P: Palette) -> some View {
        HStack(spacing: 12) {
            Art.icon(.coin, size: 24)
                .frame(width: 40, height: 40)
                .background(P.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(P.gold, lineWidth: 1))
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text("\(counted)")
                        .font(.system(size: 20, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(P.gold)
                        .contentTransition(.numericText())
                    Text("coins")
                        .font(.system(size: 20, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                }
                Text("Doubled — that win paid \(sums.to) instead of \(sums.from).")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink2)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 13)
        .background(P.goldSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(P.gold, lineWidth: 1))
        .transition(.scale(scale: 0.94).combined(with: .opacity))
    }

    private func run(factor: Int) async {
        Haptics.tap()
        SoundKit.shared.click()
        let out = await desk.watch("doubleWin", store: store, house: { coins in
            await AdBreak.play(coins: coins, into: $playing)
        })
        guard let out else { return }
        // The claim pays the bonus, so the purse it was added to is the bonus
        // divided by the extra share, and the total is the two together.
        let from = max(1, Int((Double(out.paid) / Double(factor - 1)).rounded()))
        let to = from + out.paid
        desk.noteDouble(from: from, to: to)
        counted = from
        doubled = (from: from, to: to)

        // The purse the win paid, and then the purse it became. Two coins is a
        // short journey, so it rolls once rather than being counted out — the
        // numeric transition on the label does the arithmetic in front of you.
        // A hop, not a repaint: the figure must be seen to change.
        try? await Task.sleep(for: .milliseconds(260))
        withAnimation(.snappy(duration: 0.5)) { counted = to }
    }
}

// MARK: - freeCoins, on the Play tab

/// A quiet offer under the daily reward, and deliberately the plainest card on
/// the tab: a gift you have to work five seconds for should never outshout the
/// one that costs nothing.
///
/// It never nags. Nothing auto-plays, nothing appears before a game, and once
/// today's views are spent the card is gone rather than greyed out.
struct FreeCoinsOffer: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @ObservedObject private var desk = AdDesk.shared

    @State private var playing: AdBreak?

    var body: some View {
        let P = Palette.current(scheme)
        Group {
            if let spec = desk.slot("freeCoins") {
                card(spec, P)
            }
        }
        .animation(.spring(duration: 0.3), value: desk.slot("freeCoins")?.remaining)
        .fullScreenCover(item: $playing) { break_ in
            HouseAdView(rewardCoins: break_.coins) { watched in
                playing = nil
                break_.finish(watched)
            }
        }
    }

    private func card(_ spec: AdPlacement, _ P: Palette) -> some View {
        let worth = spec.coins ?? 0
        return MMCard(padding: 13) {
            HStack(spacing: 11) {
                Art.icon(.ticket, size: 18, tint: P.ink2)
                    .frame(width: 34, height: 34)
                    .background(P.sunken, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .stroke(P.rule, lineWidth: 1))
                VStack(alignment: .leading, spacing: 1) {
                    Text("Watch an ad for \(worth) coin\(worth == 1 ? "" : "s")")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(P.ink)
                    Text(spec.remaining.map { "\($0) left today" }
                         ?? "Five seconds, then the coins are yours")
                        .font(.system(size: 11.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                }
                Spacer(minLength: 6)
                Button {
                    Task { await run() }
                } label: {
                    if desk.busy {
                        ProgressView().tint(P.ink)
                    } else {
                        Text("Watch")
                    }
                }
                .buttonStyle(MMButtonStyle(kind: .ghost))
                .disabled(desk.busy)
            }
        }
    }

    private func run() async {
        Haptics.tap()
        SoundKit.shared.click()
        let out = await desk.watch("freeCoins", store: store, house: { coins in
            await AdBreak.play(coins: coins, into: $playing)
        })
        guard let out else { return }
        store.showToast("+\(out.paid) coin\(out.paid == 1 ? "" : "s") — thanks for watching.",
                        glyph: .coin)
    }
}

// MARK: - putting an ad on screen

/// One ad break, in flight. SwiftUI presents by binding rather than by calling,
/// so this carries the continuation the flow is parked on: the cover is raised
/// by setting it, and the flow resumes when the cover reports how it ended.
final class AdBreak: Identifiable {
    let id = UUID()
    let coins: Int
    private var resume: ((Bool) -> Void)?

    private init(coins: Int, resume: @escaping (Bool) -> Void) {
        self.coins = coins
        self.resume = resume
    }

    /// Answers once, whatever happens — a cover dismissed twice, or torn down
    /// with the screen behind it, must not leave the flow parked for good.
    func finish(_ watched: Bool) {
        let go = resume
        resume = nil
        go?(watched)
    }

    /// The screen underneath can go away mid-break — a table left, a tab
    /// switched — taking the cover with it and calling nothing. An unanswered
    /// continuation would park the flow for the rest of the session and leave
    /// the button that started it disabled forever, so a break that is simply
    /// let go of counts as one walked out of.
    deinit { resume?(false) }

    /// Raises the cover and waits for it. Google's ad goes in front of this,
    /// one level up in AdDesk.watch — and the house ad stays as the no-fill
    /// answer, because a slot nobody bought still owes the player their five
    /// seconds.
    @MainActor
    static func play(coins: Int, into binding: Binding<AdBreak?>) async -> Bool {
        await withCheckedContinuation { cont in
            let ad = AdBreak(coins: coins) { cont.resume(returning: $0) }
            binding.wrappedValue = ad
        }
    }
}
