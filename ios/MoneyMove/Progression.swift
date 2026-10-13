// Levels, daily missions, a career, and the two notification switches — the
// things that follow a player from one table to the next (1.0.6).
//
// The server owns every number here. XP is added once per counted game (the
// same anti-farm rule the win purse uses), missions are dealt from the friend
// code and the server's calendar day, and anything that pays coins is
// idempotent on its side — a retried claim answers `duplicate` and pays
// nothing. So this file only reads, asks, and celebrates; docs/API-1.0.6.md is
// the contract it is written against.

import SwiftUI
import UIKit
import UserNotifications

// MARK: - the wire

/// Where a player stands: total XP, the level it buys, and the XP at which this
/// level started and the next one starts. The bar is the distance between.
struct LevelInfo: Equatable {
    var xp: Int
    var level: Int
    var levelFloor: Int
    var levelNext: Int

    /// How far through this level, 0…1. A server that sends a flat span (it
    /// never should) reads as an empty bar rather than a division by zero.
    var fraction: Double {
        let span = levelNext - levelFloor
        guard span > 0 else { return 0 }
        return min(1, max(0, Double(xp - levelFloor) / Double(span)))
    }

    var intoLevel: Int { max(0, xp - levelFloor) }
    var span: Int { max(0, levelNext - levelFloor) }
    var toNext: Int { max(0, levelNext - xp) }

    /// Built from the four optional numbers every reply that carries a level
    /// sends side by side; nil unless the level itself is there.
    static func from(xp: Int?, level: Int?, levelFloor: Int?, levelNext: Int?) -> LevelInfo? {
        guard let level, level > 0 else { return nil }
        return LevelInfo(xp: xp ?? 0, level: level, levelFloor: levelFloor ?? 0, levelNext: levelNext ?? 0)
    }
}

/// A level crossed: from a game, or from the 10 XP a claimed mission pays.
/// `coins` is what was actually paid for it (5 a level); `at` only rides the
/// copy /api/me keeps, for the phone that was not there when it happened.
struct LevelUp: Decodable, Equatable {
    var from: Int?
    var to: Int?
    var coins: Int?
    var at: Double?
}

/// The `progress` socket event: what one counted game paid this player.
struct ProgressEvent: Decodable, Equatable {
    struct Parts: Decodable, Equatable {
        var played: Int?
        var win: Int?
        var runnerUp: Int?
        var turns: Int?
    }

    var roomId: String?
    /// The XP actually added. Less than the parts add up to once the day's
    /// ceiling cut it, and 0 after that.
    var xpGained: Int?
    /// What the game was worth before the ceiling, part by part.
    var xpParts: Parts?
    var xpCapped: Bool?
    var xp: Int?
    var level: Int?
    var levelFloor: Int?
    var levelNext: Int?
    var levelUp: LevelUp?
    /// The mission kinds this game pushed over their target.
    var missionsCompleted: [String]?

    var levelInfo: LevelInfo? {
        LevelInfo.from(xp: xp, level: level, levelFloor: levelFloor, levelNext: levelNext)
    }
}

/// Lifetime numbers from counted games, as anybody's profile card shows them.
/// Games before 1.0.6 were never counted, so a veteran's career starts at zero
/// while their wins do not — the grid says nothing it cannot back up.
struct CareerInfo: Decodable, Equatable {
    struct Board: Decodable, Equatable {
        var id: String?
        var name: String?
        var games: Int?
    }

    var streetsBought: Int?
    var housesBuilt: Int?
    var rentCollected: Int?
    /// The single largest rent ever collected — a record, not a sum.
    var biggestRent: Int?
    var auctionsWon: Int?
    var tradesCompleted: Int?
    var doubles: Int?
    var favoriteBoard: Board?

    /// Nothing counted yet: a career of zeros is a promise, not a record.
    var isEmpty: Bool {
        [streetsBought, housesBuilt, rentCollected, biggestRent, auctionsWon, tradesCompleted]
            .allSatisfy { ($0 ?? 0) == 0 } && favoriteBoard == nil
    }
}

/// GET/POST /api/prefs. Both default to on, on the server and here.
struct NotificationPrefs: Decodable, Equatable {
    var dailyReminder: Bool?
    var inviteAlerts: Bool?
    // POST only
    var ok: Bool?
    var error: String?
}

/// One of today's three missions. Its id is its kind — unique within a day.
struct Mission: Decodable, Equatable, Identifiable {
    private var rawId: String?
    var kind: String?
    var title: String?
    var target: Int?
    var progress: Int?
    var coins: Int?
    var xp: Int?
    var done: Bool?
    var claimed: Bool?

    enum CodingKeys: String, CodingKey {
        case rawId = "id", kind, title, target, progress, coins, xp, done, claimed
    }

    var id: String { rawId ?? kind ?? title ?? "mission" }
    var isDone: Bool { done ?? ((progress ?? 0) >= (target ?? 1)) }
    var isClaimed: Bool { claimed ?? false }
    var label: String { title ?? Mission.titles[kind ?? ""] ?? "Mission" }

    /// The server's own titles, for a kind named somewhere a title is not —
    /// the `progress` event lists kinds only.
    static let titles: [String: String] = [
        "playGames": "Play 2 games",
        "winGame": "Win a game",
        "buyStreets": "Buy 6 streets",
        "buildHouses": "Build 4 houses",
        "collectRent": "Collect $1,500 in rent",
        "completeSet": "Complete a colour set",
        "winAuction": "Win an auction",
        "completeTrade": "Complete a trade",
        "rollDoubles": "Roll 3 doubles",
        "lapsBoard": "Lap the board 3 times",
    ]

    /// One drawing per kind, from the app's own set — the same family as the
    /// rest of the home screen, never an emoji.
    static func glyph(_ kind: String?) -> Glyph {
        switch kind {
        case "playGames": .dice
        case "winGame": .trophy
        case "buyStreets": .key
        case "buildHouses": .house
        case "collectRent": .cash
        case "completeSet": .crown
        case "winAuction": .gavel
        case "completeTrade": .trade
        case "rollDoubles": .replay
        case "lapsBoard": .globe
        default: .sparkle
        }
    }
}

/// GET /api/missions, and the `missions` a claim answers with.
struct MissionsBoard: Decodable, Equatable {
    struct Bonus: Decodable, Equatable {
        var coins: Int?
        var ready: Bool?
        var claimed: Bool?
    }

    var day: String?
    /// The server's next midnight, epoch ms — when today's three are gone.
    var resetsAt: Double?
    var signedIn: Bool?
    var missions: [Mission]?
    var bonus: Bonus?
    var error: String?

    var list: [Mission] { missions ?? [] }
    var doneCount: Int { list.filter(\.isDone).count }
    var resetDate: Date? { resetsAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
}

/// POST /api/missions/claim — success, a repeat, or a refusal, in one shape.
struct MissionClaimReply: Decodable {
    struct Awarded: Decodable {
        var coins: Int?
        var xp: Int?
    }

    var ok: Bool?
    var id: String?
    var awarded: Awarded?
    /// The wallet balance after the claim, not the amount it paid.
    var coins: Int?
    var earned: Int?
    var xp: Int?
    var level: Int?
    var levelFloor: Int?
    var levelNext: Int?
    var levelUp: LevelUp?
    /// A retry, a second tab, an old card: treated as success, paid nothing.
    var duplicate: Bool?
    var missions: MissionsBoard?
    var error: String?
    var needsLogin: Bool?

    var levelInfo: LevelInfo? {
        LevelInfo.from(xp: xp, level: level, levelFloor: levelFloor, levelNext: levelNext)
    }
}

/// The celebration in the toast window.
struct LevelUpNews: Identifiable, Equatable {
    let id = UUID()
    let level: Int
    let coins: Int
}

extension Notification.Name {
    /// A tapped daily-reminder push: the home screen goes to its Play tab,
    /// where the daily reward card is.
    static let mmOpenHome = Notification.Name("mm.openHome")
}

extension PlayerResult {
    /// Somebody met on a list rather than at a table — a leaderboard row, a
    /// friend. Enough of a seat for the profile sheet to draw its top while
    /// the profile itself is on its way. The colour is picked from the code,
    /// so the same person wears the same disc every time they are opened.
    static func card(code: String, name: String, flag: String?, avatar: String?,
                     level: Int?) -> PlayerResult {
        let colours = ["#e5484d", "#3b82f6", "#22a06b", "#f5a524", "#8b5cf6", "#0ea5b7", "#ec4899", "#f97316"]
        let pick = code.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFF } % colours.count
        return PlayerResult(id: "card:" + code, name: name, color: colours[pick], flag: flag,
                            avatar: avatar, code: code, worth: 0, bankrupt: false,
                            removedFor: nil, isBot: false, level: level)
    }
}

// MARK: - the store's half

extension GameStore {
    /// The highest level this device has celebrated. A level only ever goes
    /// up, so this is what keeps the /api/me fallback from celebrating the
    /// same level twice after the table already did.
    static let levelSeenKey = "mm.levelSeen"

    private var levelSeen: Int {
        get { UserDefaults.standard.integer(forKey: Self.levelSeenKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.levelSeenKey) }
    }

    /// A counted game ended and this is what it paid. The result sheet reads
    /// it; the level-up waits for that sheet to be up before it says anything.
    func noteProgress(_ progress: ProgressEvent) {
        lastProgress = progress
        if let info = progress.levelInfo { myLevel = info }
        missionsStamp += 1
        if let up = progress.levelUp { celebrate(up, waitForResult: true) }
    }

    /// /api/me answered. It carries the level for the account card, and the
    /// last level-up for a phone that was somewhere else when it happened —
    /// celebrated once, and only while it is still recent enough to be news.
    func noteMe(_ me: MeInfo?) {
        guard let me else { return }
        if let info = me.levelInfo { myLevel = info }
        if let up = me.lastLevelUp, let to = up.to, let at = up.at, to > levelSeen,
           Date().timeIntervalSince1970 * 1000 - at < 48 * 3600 * 1000 {
            celebrate(up)
        }
        // A level reached before this phone was watching — the credit every
        // profile got for its old games, say — is where it starts counting.
        levelSeen = max(levelSeen, me.level ?? 0)
    }

    /// A mission claim answered. Its 10 XP may have crossed a level, whose
    /// coins are already in the balance the reply carries.
    func noteClaim(_ reply: MissionClaimReply) {
        if let info = reply.levelInfo { myLevel = info }
        if let up = reply.levelUp { celebrate(up) }
    }

    /// "Level 7!", once per level. At the end of a game it waits for the
    /// result sheet — a banner over a piece still walking would give the
    /// ending away — but not for ever: leaving the table early still gets it.
    func celebrate(_ up: LevelUp, waitForResult: Bool = false) {
        guard let to = up.to, to > levelSeen else { return }
        levelSeen = to
        levelUpTask?.cancel()
        levelUpTask = Task { [weak self] in
            if waitForResult {
                for _ in 0..<40 {
                    guard let self, !Task.isCancelled else { return }
                    if self.showGameOver || self.roomId == nil { break }
                    try? await Task.sleep(for: .milliseconds(300))
                }
                // The sheet's own entrance first.
                try? await Task.sleep(for: .milliseconds(650))
            }
            guard let self, !Task.isCancelled else { return }
            withAnimation(.spring(duration: 0.45, bounce: 0.35)) {
                self.levelUpNews = LevelUpNews(level: to, coins: up.coins ?? 0)
            }
            SoundKit.shared.setComplete()
            Haptics.turn()
            // The level's coins are already in the wallet; reading it is what
            // throws them at the counter.
            if (up.coins ?? 0) > 0 { self.refreshWallet() }
            try? await Task.sleep(for: .seconds(3.6))
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.3)) { self.levelUpNews = nil }
        }
    }
}

// MARK: - the level chip and the bar

/// "Lv 12", drawn: the brass star and the number on a gold-washed capsule.
/// Used wherever a person's level is shown — seats, rows, profiles.
struct LevelChip: View {
    enum Size { case small, medium }

    let level: Int
    var size: Size = .small
    /// Just the star and the number, for a seat too narrow for "Lv".
    var compact = false

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        let font: CGFloat = size == .medium ? 12 : 9.5
        HStack(spacing: size == .medium ? 3 : 2) {
            Art.icon(.level, size: size == .medium ? 14 : 11)
            Text(compact ? "\(level)" : "Lv \(level)")
                .font(.system(size: font, weight: .black, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(P.gold)
                .lineLimit(1)
                .fixedSize()
        }
        .padding(.vertical, size == .medium ? 3 : 1.5)
        .padding(.leading, size == .medium ? 5 : 3)
        .padding(.trailing, size == .medium ? 8 : 5)
        .background(P.goldSoft, in: Capsule())
        .overlay(Capsule().stroke(P.gold.opacity(0.5), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Level \(level)")
    }
}

/// How far through the level: a gold run on a sunken track.
struct XPBar: View {
    let fraction: Double
    var height: CGFloat = 6

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(P.sunken)
                    .overlay(Capsule().stroke(P.rule, lineWidth: 1))
                Capsule().fill(P.gold)
                    // A sliver even at zero, so the bar reads as a bar.
                    .frame(width: max(height, g.size.width * fraction))
            }
        }
        .frame(height: height)
        .animation(.spring(duration: 0.6), value: fraction)
    }
}

/// The chip, the bar, and the numbers under it — the account card's and the
/// result sheet's line about where the player stands.
struct LevelStrip: View {
    let info: LevelInfo

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        HStack(spacing: 10) {
            LevelChip(level: info.level, size: .medium)
            VStack(alignment: .leading, spacing: 4) {
                XPBar(fraction: info.fraction)
                HStack(spacing: 6) {
                    Text("\(info.intoLevel.formatted()) / \(info.span.formatted()) XP")
                    Spacer(minLength: 4)
                    Text("\(info.toNext.formatted()) to Lv \(info.level + 1)")
                }
                .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(P.ink3)
                .lineLimit(1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Level \(info.level), \(info.toNext) XP to level \(info.level + 1)")
    }
}

// MARK: - the celebration

/// The banner the toast window raises when a level is crossed. It takes no
/// touches — the window it lives in never does — and leaves by itself.
struct LevelUpBanner: View {
    let news: LevelUpNews

    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pop = false

    var body: some View {
        let P = Palette.current(scheme)
        HStack(spacing: 12) {
            Art.icon(.level, size: 38)
                .scaleEffect(pop || reduceMotion ? 1 : 0.5)
                .rotationEffect(.degrees(pop || reduceMotion ? 0 : -40))
            VStack(alignment: .leading, spacing: 1) {
                Text("LEVEL UP")
                    .font(.system(size: 10, weight: .black))
                    .kerning(1.6)
                    .foregroundStyle(P.ink3)
                Text("Level \(news.level)!")
                    .font(.system(size: 22, weight: .black, design: .rounded))
                    .foregroundStyle(P.gold)
            }
            if news.coins > 0 {
                HStack(spacing: 4) {
                    Art.icon(.coin, size: 16)
                    Text("+\(news.coins)")
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.good)
                }
                .padding(.leading, 4)
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 18)
        .background(P.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(P.gold, lineWidth: 1.5))
        .shadow(color: .black.opacity(0.35), radius: 22, y: 10)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Level up — level \(news.level)" + (news.coins > 0 ? ", plus \(news.coins) coins" : ""))
        .onAppear {
            withAnimation(.spring(duration: 0.5, bounce: 0.5).delay(0.05)) { pop = true }
        }
    }
}

// MARK: - what the game paid

/// The result sheet's word on XP: what this game added, where that leaves
/// the bar, and any mission it finished. Draws nothing for a game that did
/// not count, or one this device only watched.
struct GameProgressCard: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        if let p = store.lastProgress, p.roomId == nil || p.roomId == store.state?.id,
           let info = p.levelInfo {
            MMCard(padding: 14) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 6) {
                        Art.icon(.level, size: 13)
                        PanelTitle("Experience")
                        Spacer(minLength: 6)
                        Text("+\((p.xpGained ?? 0).formatted()) XP")
                            .font(.system(size: 15, weight: .heavy, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(P.gold)
                    }
                    LevelStrip(info: info)
                    if let parts = partsLine(p) {
                        Text(parts)
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if p.xpCapped == true {
                        note(.warning, "Daily XP limit reached — missions still count today.", P)
                    }
                    if let up = p.levelUp, let to = up.to {
                        HStack(spacing: 8) {
                            Art.icon(.level, size: 20)
                            Text("Level \(to)!")
                                .font(.system(size: 15, weight: .black, design: .rounded))
                                .foregroundStyle(P.gold)
                            Spacer(minLength: 4)
                            if let coins = up.coins, coins > 0 {
                                Art.icon(.coin, size: 14)
                                Text("+\(coins) coins")
                                    .font(.system(size: 12.5, weight: .heavy, design: .rounded))
                                    .foregroundStyle(P.good)
                            }
                        }
                        .padding(9)
                        .background(P.goldSoft, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .stroke(P.gold.opacity(0.55), lineWidth: 1))
                    }
                    let finished = (p.missionsCompleted ?? []).map { Mission.titles[$0] ?? $0 }
                    if !finished.isEmpty {
                        note(.sparkle, "Mission done: \(finished.joined(separator: ", ")). Claim it on the home screen.", P)
                    }
                }
            }
        }
    }

    /// "Played +20 · Win +30 · Turns +6" — only the parts that paid.
    private func partsLine(_ p: ProgressEvent) -> String? {
        guard let parts = p.xpParts else { return nil }
        let bits: [(String, Int?)] = [("Played", parts.played), ("Win", parts.win),
                                      ("Runner-up", parts.runnerUp), ("Turns", parts.turns)]
        let paid = bits.compactMap { name, xp -> String? in
            guard let xp, xp > 0 else { return nil }
            return "\(name) +\(xp)"
        }
        return paid.isEmpty ? nil : paid.joined(separator: " · ")
    }

    private func note(_ glyph: Glyph, _ text: String, _ P: Palette) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Art.icon(glyph, size: 13, tint: P.ink2)
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
            Text(text)
                .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - daily missions

/// Three small jobs a day, on the Play tab under the daily reward.
///
/// Progress is counted for everybody — a guest's games move it as much as
/// anyone's — but only a signed-in account can collect, the same rule as the
/// daily reward, because coins for turning up are exactly what a fresh install
/// would farm. So a signed-out player sees the bars fill and is told where the
/// rewards are rather than shown a button that can only refuse.
struct MissionsCard: View {
    /// The landing screen owns the sign-in flow and its spinner.
    var onSignIn: (() -> Void)? = nil
    var signingIn: Bool = false

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    @State private var board: MissionsBoard?
    /// The mission (or "bonus") whose claim is on the wire.
    @State private var claiming: String?
    /// Bumped to start the watcher over — after a spell in the background.
    @State private var reloads = 0

    var body: some View {
        let P = Palette.current(scheme)
        // Wrapped rather than hidden behind a bare `if`: an empty view never
        // runs its task, and the card could then never arrive at all.
        VStack(spacing: 0) {
            if let board, !board.list.isEmpty {
                card(board, P)
            }
        }
        .animation(.spring(duration: 0.3), value: board)
        .task(id: "\(reloads):\(store.missionsStamp)") { await watch() }
        .onReceive(NotificationCenter.default.publisher(
            for: UIApplication.willEnterForegroundNotification)) { _ in
            reloads += 1
        }
    }

    private func card(_ b: MissionsBoard, _ P: Palette) -> some View {
        let signedIn = b.signedIn == true
        return MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 11) {
                HStack(spacing: 10) {
                    Art.icon(.sparkle, size: 24)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Daily missions")
                            .font(.system(size: 15, weight: .heavy, design: .rounded))
                            .foregroundStyle(P.ink)
                        // A clock, not an animation: twice a minute is plenty.
                        TimelineView(.periodic(from: .now, by: 30)) { _ in
                            Text(resetLine(b))
                                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                                .foregroundStyle(P.ink3)
                        }
                    }
                    Spacer(minLength: 6)
                    Text("\(b.doneCount)/\(b.list.count)")
                        .font(.system(size: 12.5, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(b.doneCount == b.list.count ? P.good : P.ink3)
                        .padding(.vertical, 4)
                        .padding(.horizontal, 9)
                        .background(P.sunken, in: Capsule())
                }

                VStack(spacing: 8) {
                    ForEach(b.list) { m in
                        missionRow(m, signedIn: signedIn, P)
                    }
                    bonusRow(b, signedIn: signedIn, P)
                }

                if !signedIn {
                    HStack(spacing: 8) {
                        Text("Sign in to claim the rewards — progress counts either way.")
                            .font(.system(size: 11.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        if let onSignIn {
                            Button {
                                onSignIn()
                            } label: {
                                HStack(spacing: 6) {
                                    if signingIn { ProgressView().tint(P.ink2) }
                                    else { Art.icon(.key, size: 14, tint: MMButtonStyle.Kind.ghost.ink(P)) }
                                    Text("Sign in")
                                }
                            }
                            .buttonStyle(MMButtonStyle(kind: .ghost))
                            .disabled(signingIn)
                        }
                    }
                }
            }
        }
    }

    private func missionRow(_ m: Mission, signedIn: Bool, _ P: Palette) -> some View {
        let target = max(1, m.target ?? 1)
        let progress = min(target, max(0, m.progress ?? 0))
        let done = m.isDone
        return HStack(spacing: 11) {
            ZStack {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(done ? P.goldSoft : P.sunken)
                Art.icon(Mission.glyph(m.kind), size: 19, tint: done ? P.gold : P.ink2)
            }
            .frame(width: 38, height: 38)
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
                .stroke(done ? P.gold.opacity(0.6) : P.rule, lineWidth: 1))

            // The figure rides beside the bar rather than beside the title: on
            // a phone the rent mission's title and "$1,200 / $1,500" together
            // are wider than the row, and one of them would truncate or wrap.
            VStack(alignment: .leading, spacing: 5) {
                Text(m.label)
                    .font(.system(size: 13.5, weight: .bold, design: .rounded))
                    .foregroundStyle(m.isClaimed ? P.ink3 : P.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                HStack(spacing: 8) {
                    XPBar(fraction: Double(progress) / Double(target), height: 5)
                    Text(progressText(m.kind, progress, target))
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(done ? P.good : P.ink3)
                        .lineLimit(1)
                        .fixedSize()
                }
            }

            trailing(m, signedIn: signedIn, P)
                .frame(minWidth: 64, alignment: .trailing)
        }
        .opacity(m.isClaimed ? 0.7 : 1)
        .accessibilityElement(children: .combine)
    }

    /// The reward while it is being worked for, the button once it is earned,
    /// and a tick once it has been collected.
    @ViewBuilder
    private func trailing(_ m: Mission, signedIn: Bool, _ P: Palette) -> some View {
        if m.isClaimed {
            claimedMark(P)
        } else if m.isDone && signedIn {
            claimButton(m.id, label: "Claim", P)
        } else if m.isDone {
            // Earned, and waiting behind an account rather than gone.
            Text("Sign in\nto claim")
                .font(.system(size: 10.5, weight: .heavy, design: .rounded))
                .multilineTextAlignment(.trailing)
                .foregroundStyle(P.gold)
        } else {
            VStack(alignment: .trailing, spacing: 1) {
                HStack(spacing: 3) {
                    Art.icon(.coin, size: 12)
                    Text("\(m.coins ?? 3)")
                        .font(.system(size: 12, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink2)
                }
                Text("+\(m.xp ?? 10) XP")
                    .font(.system(size: 9.5, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
        }
    }

    private func bonusRow(_ b: MissionsBoard, signedIn: Bool, _ P: Palette) -> some View {
        let bonus = b.bonus
        let coins = bonus?.coins ?? 5
        let claimed = bonus?.claimed ?? false
        let ready = (bonus?.ready ?? false) && !claimed
        return HStack(spacing: 11) {
            ZStack {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(ready || claimed ? P.goldSoft : P.sunken)
                Art.icon(.coin, size: 20)
            }
            .frame(width: 38, height: 38)
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
                .stroke(ready ? P.gold.opacity(0.6) : P.rule,
                        style: StrokeStyle(lineWidth: 1, dash: ready || claimed ? [] : [4, 3])))

            VStack(alignment: .leading, spacing: 2) {
                Text("All three done")
                    .font(.system(size: 13.5, weight: .bold, design: .rounded))
                    .foregroundStyle(claimed ? P.ink3 : P.ink)
                Text("Bonus \(coins) coins")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
            Spacer(minLength: 4)
            Group {
                if claimed {
                    claimedMark(P)
                } else if ready && signedIn {
                    claimButton("bonus", label: "Claim", P)
                } else {
                    Text("\(b.doneCount)/\(b.list.count)")
                        .font(.system(size: 12, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(P.ink3)
                }
            }
            .frame(minWidth: 64, alignment: .trailing)
        }
        .opacity(claimed ? 0.7 : 1)
        .accessibilityElement(children: .combine)
    }

    private func claimButton(_ id: String, label: String, _ P: Palette) -> some View {
        Button {
            Task { await claim(id) }
        } label: {
            HStack(spacing: 5) {
                if claiming == id { ProgressView().tint(P.accentInk) }
                else { Art.icon(.coin, size: 14) }
                Text(label)
            }
        }
        .buttonStyle(MMButtonStyle(kind: .gold))
        .disabled(claiming != nil)
    }

    private func claimedMark(_ P: Palette) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "checkmark")
                .font(.system(size: 10, weight: .black))
            Text("Claimed")
                .font(.system(size: 11.5, weight: .heavy, design: .rounded))
        }
        .foregroundStyle(P.good)
    }

    /// "1/2", and for rent the money it counts: "$600 / $1,500".
    private func progressText(_ kind: String?, _ progress: Int, _ target: Int) -> String {
        kind == "collectRent" ? "\(money(progress)) / \(money(target))" : "\(progress)/\(target)"
    }

    private func resetLine(_ b: MissionsBoard) -> String {
        guard let next = b.resetDate else { return "Three new ones every day" }
        return "New missions in " + DailyRewardCard.until(next)
    }

    // MARK: the server

    /// Read once, then again just after midnight — a phone left awake past the
    /// turn of the day would otherwise sit on yesterday's three.
    private func watch() async {
        var misses = 0
        while !Task.isCancelled {
            guard await load() else {
                // One dropped read at launch is ordinary; a few more tries,
                // then quiet until the next foreground.
                misses += 1
                guard misses <= 4 else { return }
                try? await Task.sleep(for: .seconds(Double(misses) * 5))
                continue
            }
            misses = 0
            guard let next = board?.resetDate else { return }
            let wait = next.timeIntervalSinceNow + 1
            guard wait > 0 else { return }
            try? await Task.sleep(for: .seconds(wait))
        }
    }

    @discardableResult
    private func load() async -> Bool {
        // A query string, so raw mode — fetchJSON's path builder would
        // percent-encode the "?".
        guard let fresh: MissionsBoard = try? await store.fetchJSON(
            "/api/missions?token=\(store.token)", raw: true), fresh.missions != nil else { return false }
        // A claim on the wire owns the card until it answers.
        if claiming == nil { board = fresh }
        return true
    }

    private func claim(_ id: String) async {
        guard claiming == nil else { return }
        claiming = id
        defer { claiming = nil }
        Haptics.tap()
        SoundKit.shared.click()

        let reply: MissionClaimReply? = try? await store.fetchJSON(
            "/api/missions/claim", method: "POST", body: ["token": store.token, "id": id])
        guard let reply else {
            store.showToast("Couldn't reach the server — try again.", isError: true)
            return
        }
        // Every answer that carries the day's board — success, repeat, or a
        // card gone stale across midnight — is the truth to redraw from.
        if let fresh = reply.missions, fresh.missions != nil { board = fresh }

        guard reply.ok == true else {
            store.showToast(reply.error ?? "Couldn't claim that — try again.", isError: true)
            if reply.missions == nil { reloads += 1 }
            return
        }
        if reply.missions == nil { reloads += 1 }
        store.noteClaim(reply)
        // A repeat paid nothing, so it plays nothing: the coins it would be
        // celebrating were celebrated wherever they were first claimed.
        guard reply.duplicate != true, (reply.awarded?.coins ?? 0) > 0 else { return }
        Haptics.turn()
        SoundKit.shared.gain()
        // The counter in the corner catches the coins — the same flight every
        // other payout in the app takes.
        store.refreshWallet()
    }
}

// MARK: - career

/// Seven lifetime numbers, as the profile sheet and the History tab show them.
struct CareerGrid: View {
    let career: CareerInfo

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        VStack(alignment: .leading, spacing: 12) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3),
                      spacing: 12) {
                TallyCell(value: (career.streetsBought ?? 0).formatted(), label: "STREETS BOUGHT")
                TallyCell(value: (career.housesBuilt ?? 0).formatted(), label: "HOUSES BUILT")
                TallyCell(value: money(career.rentCollected ?? 0), label: "RENT COLLECTED")
                TallyCell(value: money(career.biggestRent ?? 0), label: "BIGGEST RENT")
                TallyCell(value: (career.auctionsWon ?? 0).formatted(), label: "AUCTIONS WON")
                TallyCell(value: (career.tradesCompleted ?? 0).formatted(), label: "TRADES")
            }
            HStack(spacing: 8) {
                Art.icon(.map, size: 15, tint: P.ink2)
                Text("Favourite board")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink3)
                Spacer(minLength: 6)
                if let board = career.favoriteBoard, let name = board.name {
                    Text(name)
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                        .lineLimit(1)
                    if let games = board.games, games > 0 {
                        Text("\(games) game\(games == 1 ? "" : "s")")
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink3)
                    }
                } else {
                    Text("Not yet")
                        .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                }
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 10)
            .background(P.sunken, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
    }
}

// MARK: - notification switches

/// Settings: the daily reminder and friend invites, each one a switch the
/// server keeps (GET/POST /api/prefs), so turning one off here turns it off
/// for every phone signed in to the account.
///
/// The server's switch is only half of it. If notifications are off for the
/// app in the Settings app nothing arrives whatever these say, and a switch
/// that sits there "on" while nothing comes is a switch that lies — so that
/// case is said out loud, with the way back.
struct NotificationPrefsCard: View {
    /// The reminder only ever goes to a signed-in account; the caption says so.
    let signedIn: Bool

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    @State private var daily = true
    @State private var invites = true
    @State private var loaded = false
    @State private var saving: Set<String> = []
    @State private var system: UNAuthorizationStatus?

    var body: some View {
        let P = Palette.current(scheme)
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                PanelTitle("Notifications")
                row(title: "Daily reward reminder",
                    caption: signedIn ? "A nudge when your daily coins are ready, about when you usually collect them."
                        : "Sign in to collect daily coins — the reminder comes with them.",
                    key: "dailyReminder", isOn: daily, P)
                Rectangle().fill(P.rule).frame(height: 1)
                row(title: "Friend invites",
                    caption: "When a friend asks you to their table. The invite still waits in the app either way.",
                    key: "inviteAlerts", isOn: invites, P)
                if system == .denied {
                    HStack(spacing: 8) {
                        Art.icon(.warning, size: 14)
                        Text("Notifications are off for MoneyMove in the Settings app.")
                            .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        Button("Open") {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                        .buttonStyle(MMButtonStyle(kind: .ghost))
                    }
                }
            }
        }
        .task {
            await readSystem()
            await load()
        }
        .onReceive(NotificationCenter.default.publisher(
            for: UIApplication.willEnterForegroundNotification)) { _ in
            Task { await readSystem() }
        }
    }

    private func row(title: String, caption: String, key: String, isOn: Bool, _ P: Palette) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink)
                Text(caption)
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 6)
            // Flipped on the spot — a switch that waits for the network
            // before it moves feels broken — and put back if the server says no.
            Toggle("", isOn: Binding(get: { isOn }, set: { on in
                apply(key, on)
                Task { await change(key, on, was: !on) }
            }))
                .labelsHidden()
                .tint(P.red)
                // Nothing to flip until the server has said where it stands,
                // and nothing to flip twice while the first is on the wire.
                .disabled(!loaded || saving.contains(key))
                .accessibilityLabel(title)
        }
    }

    private func readSystem() async {
        system = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    private func load() async {
        for attempt in 1...3 {
            if let prefs: NotificationPrefs = try? await store.fetchJSON(
                "/api/prefs?token=\(store.token)", raw: true), prefs.error == nil {
                daily = prefs.dailyReminder ?? true
                invites = prefs.inviteAlerts ?? true
                loaded = true
                return
            }
            if Task.isCancelled { return }
            try? await Task.sleep(for: .seconds(Double(attempt) * 3))
        }
        // The server never answered. Both default to on there too, so showing
        // them on and letting a flip try its luck is the honest fallback.
        loaded = true
    }

    /// Saves a flip the switch has already shown, and undoes it on a refusal.
    private func change(_ key: String, _ on: Bool, was before: Bool) async {
        saving.insert(key)
        defer { saving.remove(key) }
        Haptics.tap()
        // Turning one on is the player's own say-so to be notified, so it is
        // the right moment for the system's one permission sheet if it has
        // never been shown — rather than a switch that is on and silent.
        if on, system == .notDetermined {
            system = await PushRegistrar.shared.askFromSettings()
        }
        let reply: NotificationPrefs? = try? await store.fetchJSON(
            "/api/prefs", method: "POST", body: ["token": store.token, key: on])
        guard let reply, reply.ok == true else {
            apply(key, before)
            store.showToast(reply?.error ?? "Couldn't save that — try again.", isError: true)
            return
        }
        daily = reply.dailyReminder ?? daily
        invites = reply.inviteAlerts ?? invites
    }

    private func apply(_ key: String, _ on: Bool) {
        if key == "dailyReminder" { daily = on } else { invites = on }
    }
}
