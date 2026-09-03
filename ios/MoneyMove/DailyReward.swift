// The one reason to open the app on a day you weren't going to play: a small
// pile of coins that grows for as long as you keep coming back.
//
// The server owns the calendar and the ladder — GET /api/daily is a read-only
// peek that never mints a profile, POST /api/daily/claim is the action. This
// card only asks, celebrates, and then goes quiet until tomorrow.

import SwiftUI

/// GET /api/daily, and the shape a claim answers with too — one decoder covers
/// the peek, the payout, and the 409 an eager second tap earns.
struct DailyState: Decodable, Equatable {
    var claimable: Bool?
    var streak: Int?
    var amount: Int?
    /// Epoch milliseconds of the coming midnight; null while a claim is owed.
    var nextAt: Double?

    // claim only
    var ok: Bool?
    var coins: Int?
    var error: String?
    var claimed: Bool?

    var nextDate: Date? { nextAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
}

/// Coins arriving, on the Play tab.
///
/// Three faces, in this order of loudness: a gold button while there is
/// something to collect, a short celebration the moment it lands, and a single
/// muted line for the rest of the day. Nothing at all until the server has
/// answered — a reward you may not even be owed shouldn't flash a spinner at
/// the top of the screen.
struct DailyRewardCard: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    @State private var daily: DailyState?
    @State private var claiming = false
    /// What the celebration is counting toward, and how far it has got. Both
    /// nil/zero except for the couple of seconds after a successful claim.
    @State private var celebrating: Int?
    @State private var counted = 0
    /// The coin's one hop as the number starts running.
    @State private var pop = false
    /// Bumped to send the watcher below back to the start — after a claim, and
    /// after a spell in the background. `.task(id:)` cancels the old one.
    @State private var reloads = 0

    /// The ladder tops out after a week of days, so seven pips is the whole
    /// climb — not an arbitrary strip of dots.
    private static let ladder = 7

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 0) {
            if let daily {
                if let amount = celebrating {
                    celebration(amount, daily, P)
                } else if daily.claimable == true {
                    claimFace(daily, P)
                } else {
                    quietFace(daily, P)
                }
            }
        }
        .animation(.spring(duration: 0.35), value: celebrating)
        .animation(.spring(duration: 0.3), value: daily)
        .task(id: reloads) { await watch() }
        // A day can turn over while the app sits in a pocket; coming back to
        // yesterday's "back tomorrow" line would be a lie.
        .onReceive(NotificationCenter.default.publisher(
            for: UIApplication.willEnterForegroundNotification)) { _ in
            reloads += 1
        }
    }

    // MARK: - faces

    /// Coins on the table. The button is the loudest thing on the tab for as
    /// long as it takes to tap it, and never a second longer.
    private func claimFace(_ d: DailyState, _ P: Palette) -> some View {
        let day = (d.streak ?? 0) + 1
        let amount = d.amount ?? 0
        return MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 11) {
                HStack(spacing: 10) {
                    Art.icon(.coin, size: 26)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Daily reward")
                            .font(.system(size: 15, weight: .heavy, design: .rounded))
                            .foregroundStyle(P.ink)
                        Text(day > 1 ? "Day \(day) of your streak" : "Waiting for you")
                            .font(.system(size: 11.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                    }
                    Spacer(minLength: 6)
                }

                // Days already banked, not counting today's — today's pip is
                // the one the button lights, and the celebration is the only
                // place it does.
                ladderStrip(day - 1, P)

                Button {
                    Task { await claim() }
                } label: {
                    HStack(spacing: 8) {
                        if claiming {
                            ProgressView().tint(P.accentInk)
                        } else {
                            Art.icon(.coin, size: 19)
                        }
                        Text(claiming ? "Collecting…" : "Collect \(amount) coins")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(MMButtonStyle(kind: .gold, big: true))
                .disabled(claiming)

                Text(day >= Self.ladder
                     ? "Your streak is paying the most it ever will — just don't break it."
                     : "Come back tomorrow and it pays a little more.")
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
        }
    }

    /// The few seconds the coins actually land in: the card goes gold, the
    /// number runs up from nothing, and the streak pip for today lights.
    private func celebration(_ amount: Int, _ d: DailyState, _ P: Palette) -> some View {
        let day = d.streak ?? 1
        return MMCard(padding: 16) {
            VStack(spacing: 9) {
                Art.icon(.coin, size: 40)
                    .scaleEffect(pop ? 1 : 0.6)
                    .rotationEffect(.degrees(pop ? 0 : -25))

                HStack(spacing: 5) {
                    Text("+\(counted)")
                        .font(.system(size: 34, weight: .black, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(P.gold)
                        .contentTransition(.numericText())
                    Text("coins")
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.gold.opacity(0.85))
                }

                Text(day > 1 ? "Day \(day) in a row" : "Day one — see you tomorrow")
                    .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink2)

                ladderStrip(day, P)
                    .padding(.horizontal, 20)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
        }
        .background(P.goldSoft, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(P.gold.opacity(0.7), lineWidth: 1.5))
        .transition(.scale(scale: 0.94).combined(with: .opacity))
    }

    /// The other twenty-three hours: one line, no button, no colour. The
    /// reward is already collected, so it has nothing left to ask for.
    private func quietFace(_ d: DailyState, _ P: Palette) -> some View {
        let day = d.streak ?? 0
        return MMCard(padding: 13) {
            HStack(spacing: 11) {
                Art.icon(.coin, size: 20)
                    .opacity(0.7)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Back tomorrow")
                        .font(.system(size: 13.5, weight: .bold, design: .rounded))
                        .foregroundStyle(P.ink2)
                    // The countdown is the only moving part, and it only moves
                    // twice a minute — a clock, not an animation.
                    TimelineView(.periodic(from: .now, by: 30)) { _ in
                        Text(waitLine(d, day: day))
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                    }
                }
                Spacer(minLength: 6)
                if let next = d.amount, next > 0 {
                    Text("+\(next)")
                        .font(.system(size: 12.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .padding(.vertical, 4)
                        .padding(.horizontal, 9)
                        .background(P.sunken, in: Capsule())
                }
            }
        }
    }

    /// Seven pips: the whole climb from day one to the top of the ladder.
    private func ladderStrip(_ day: Int, _ P: Palette) -> some View {
        let lit = min(max(day, 0), Self.ladder)
        return HStack(spacing: 5) {
            ForEach(0..<Self.ladder, id: \.self) { i in
                Capsule()
                    .fill(i < lit ? AnyShapeStyle(P.gold) : AnyShapeStyle(P.sunken))
                    .frame(height: 5)
                    .overlay(Capsule().stroke(P.rule, lineWidth: i < lit ? 0 : 1))
            }
        }
    }

    private func waitLine(_ d: DailyState, day: Int) -> String {
        let head = day > 0 ? "Day \(day) collected" : "Collected"
        guard let next = d.nextDate else { return head }
        return head + " · next in " + Self.until(next)
    }

    /// "7h 12m", then "12m", then "40s" — coarse until it matters.
    static func until(_ date: Date) -> String {
        let secs = max(0, Int(date.timeIntervalSinceNow))
        let hours = secs / 3600
        let mins = (secs % 3600) / 60
        if hours > 0 { return "\(hours)h \(mins)m" }
        if mins > 0 { return "\(mins)m" }
        return "\(secs)s"
    }

    // MARK: - the server

    /// Read once, then again the moment the day actually turns over. A phone
    /// left awake past midnight would otherwise sit on a countdown that has
    /// run out — the coins are waiting and the card is the last to know.
    private func watch() async {
        var misses = 0
        while !Task.isCancelled {
            guard await load() else {
                // Launch fires half a dozen requests at once and one of them
                // losing is ordinary. Staying silent is right; staying silent
                // all evening over a single dropped read is not — so ask again
                // a few times, then stop rather than pester a server that is
                // plainly down. Coming back from the background asks afresh.
                misses += 1
                guard misses <= 4 else { return }
                try? await Task.sleep(for: .seconds(Double(misses) * 5))
                continue
            }
            misses = 0
            // Only a spent day has a deadline. A claimable one has a button on
            // it already and nothing left to wait for.
            guard daily?.claimable == false, let next = daily?.nextDate else { return }
            // A second the far side of the boundary, so the server has turned
            // the page before we ask it anything.
            let wait = next.timeIntervalSinceNow + 1
            // Already past it — a clock that disagrees with the server's isn't
            // worth spinning over; the next foreground picks it up.
            guard wait > 0 else { return }
            try? await Task.sleep(for: .seconds(wait))
        }
    }

    /// Answers whether the server actually said anything, so the caller above
    /// can tell "nothing to show" from "nobody picked up".
    @discardableResult
    private func load() async -> Bool {
        // The GET carries a query string, and fetchJSON's normal path builder
        // percent-encodes the "?" — raw mode glues it on instead.
        let fresh: DailyState? = try? await store.fetchJSON(
            "/api/daily?token=\(store.token)", raw: true)
        guard let fresh else { return false }
        // A celebration on screen owns the card until it has finished playing;
        // a background refresh must not yank it away mid-count.
        if celebrating == nil { daily = fresh }
        return true
    }

    private func claim() async {
        guard !claiming else { return }
        claiming = true
        defer { claiming = false }
        Haptics.tap()
        SoundKit.shared.click()

        let reply: DailyState? = try? await store.fetchJSON(
            "/api/daily/claim", method: "POST", body: ["token": store.token])

        guard let reply else {
            store.showToast("Couldn't reach the server — try again.", isError: true)
            return
        }
        // Already claimed is the client being eager, not broken: take the
        // server's word for the day and fall through to the quiet face. Any
        // other refusal is a refusal — going quiet on one would pocket the
        // coins on the server's behalf and tell the player it went fine.
        if let error = reply.error {
            guard reply.claimed == true else {
                store.showToast(error, isError: true)
                return
            }
            daily = DailyState(claimable: false, streak: reply.streak,
                               amount: daily?.amount, nextAt: reply.nextAt)
            // The pill on the quiet face is tomorrow's payout, and this reply
            // never carried one — only the peek knows it.
            reloads += 1
            return
        }

        let amount = reply.amount ?? 0
        daily = DailyState(claimable: false, streak: reply.streak,
                           amount: daily?.amount, nextAt: reply.nextAt)
        counted = 0
        celebrating = amount
        Haptics.turn()
        SoundKit.shared.gain()
        withAnimation(.spring(duration: 0.45, bounce: 0.45)) { pop = true }
        // The wallet is the number the player will look at next; re-read it
        // rather than trusting the copy this reply happened to carry.
        store.refreshWallet()

        await countUp(to: amount)
        try? await Task.sleep(for: .milliseconds(1400))
        pop = false
        celebrating = nil
        // Whatever the ladder pays tomorrow, the server knows it — ask again
        // now that today is spent, and put the watcher back on the clock so
        // this evening's card is still honest at one minute past midnight.
        reloads += 1
    }

    /// Coins land one after another rather than all at once — the number
    /// arriving is the whole point of tapping the button.
    private func countUp(to amount: Int) async {
        guard amount > 0 else { return }
        let steps = min(22, amount)
        for i in 1...steps {
            let t = Double(i) / Double(steps)
            let eased = 1 - pow(1 - t, 3)
            withAnimation(.linear(duration: 0.03)) {
                counted = Int((Double(amount) * eased).rounded())
            }
            try? await Task.sleep(for: .milliseconds(28))
        }
        counted = amount
    }
}
