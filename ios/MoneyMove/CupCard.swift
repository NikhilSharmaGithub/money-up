// The cup, on the Social tab.
//
// A tournament is a join window and a knockout: everyone who enters inside
// the window is paired off when the doors shut, winners play on, and the last
// three standing are paid. The server owns all of it — this card asks
// GET /api/cup every few seconds and draws whatever came back.
//
// It draws nothing at all unless the owner has switched cups on. That is the
// point of the switch: a feature can ship, be tested on the real server, and
// still not exist as far as any player is concerned.

import SwiftUI

// MARK: - the shapes /api/cup answers with

struct CupFeed: Decodable, Equatable {
    var enabled: Bool?
    var cup: Cup?

    struct Cup: Decodable, Equatable {
        var id: String
        var name: String
        /// "joining" | "running" | "done"
        var state: String
        var prize: Prize
        var local: Local?
        var openedAt: Double?
        var closesAt: Double?
        var entrants: Int
        var rounds: Int
        var round: Round?
        var standings: Standings?
        var you: You

        var closesDate: Date? { closesAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
        var openedDate: Date? { openedAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
    }

    struct Prize: Decodable, Equatable {
        var currency: String?
        var first: Int?
        var second: Int?
        var third: Int?
    }

    /// The same three prizes in the money the reader thinks in, when the
    /// server knows a rate for the country they fly. Null otherwise, and the
    /// owner's own figure is shown instead — nothing is ever invented.
    struct Local: Decodable, Equatable {
        var code: String?
        var symbol: String?
        var first: Int?
        var second: Int?
        var third: Int?
    }

    struct Round: Decodable, Equatable {
        var n: Int?
        /// "round" | "final" | "thirdPlace"
        var kind: String?
        var matches: [Match]?
    }

    struct Match: Decodable, Equatable {
        var a: String?
        var b: String?
        var state: String?
        var winner: String?
    }

    struct Standings: Decodable, Equatable {
        var first: Card?
        var second: Card?
        var third: Card?

        struct Card: Decodable, Equatable {
            var code: String?
            var name: String?
        }
    }

    struct You: Decodable, Equatable {
        var joined: Bool?
        var code: String?
        var out: Bool?
        var placed: String?
        /// The table drawn for you, the moment there is one.
        var roomId: String?
        var opponent: String?
    }
}

// MARK: - the watcher

/// One poll for the whole landing screen.
///
/// This used to live inside the card, which meant it only ran while the
/// Social tab had been opened at least once — a player waiting on the Play
/// tab was never taken to their table. The screen owns it now, the card only
/// draws what it holds, and being seated no longer depends on which tab
/// somebody happens to be looking at.
@MainActor
final class CupWatch: ObservableObject {
    @Published private(set) var feed: CupFeed?
    @Published var busy = false

    private weak var store: GameStore?
    private var task: Task<Void, Never>?
    /// The table this device has already been sent to. A player walks into
    /// their first table without hunting for it, but only once — coming back
    /// out of a game must not throw them straight back in.
    private var sentTo: String?

    /// The cup as it exists for a player: nothing at all while the owner has
    /// tournaments switched off.
    var live: CupFeed.Cup? { feed?.enabled == true ? feed?.cup : nil }

    func start(_ store: GameStore) {
        self.store = store
        guard task == nil else { return }
        task = Task { [weak self] in await self?.watch() }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    func reload() { Task { await load() } }

    private func watch() async {
        var misses = 0
        while !Task.isCancelled {
            guard await load() else {
                misses += 1
                guard misses <= 4 else { return }
                try? await Task.sleep(for: .seconds(Double(misses) * 5))
                continue
            }
            misses = 0
            // A closing door and a live bracket are worth watching closely; a
            // server with tournaments switched off is worth barely asking.
            let gap: Double = feed?.enabled != true ? 60
                : live?.state == "joining" ? 3
                : live?.state == "running" ? 4 : 20
            try? await Task.sleep(for: .seconds(gap))
        }
    }

    @discardableResult private func load() async -> Bool {
        guard let store else { return false }
        guard let fresh: CupFeed = try? await store.fetchJSON(
            "/api/cup?token=\(store.token)", raw: true) else { return false }
        feed = fresh
        openTable(fresh.enabled == true ? fresh.cup?.you.roomId : nil)
        return true
    }

    func enter() async {
        guard let store else { return }
        busy = true
        defer { busy = false }
        struct Reply: Decodable { var ok: Bool?; var error: String?; var needsLogin: Bool? }
        let reply: Reply? = try? await store.fetchJSON(
            "/api/cup/join", method: "POST", body: ["token": store.token])
        if reply?.ok == true {
            Haptics.turn()
            store.showToast("You are in the cup")
            await load()
        } else {
            store.showToast(reply?.error ?? "Could not enter the cup", isError: true)
        }
    }

    func leave() async {
        guard let store else { return }
        busy = true
        defer { busy = false }
        struct Reply: Decodable { var ok: Bool? }
        let _: Reply? = try? await store.fetchJSON(
            "/api/cup/leave", method: "POST", body: ["token": store.token])
        await load()
    }

    /// Your table is ready: walk in, once. Every later visit is the player's
    /// own tap on the button, which is still sitting there.
    private func openTable(_ room: String?) {
        guard let store, let room, room != sentTo, store.roomId == nil else { return }
        sentTo = room
        store.showToast("Your cup table is ready")
        Haptics.turn()
        Task {
            try? await Task.sleep(for: .milliseconds(900))
            // Still on the landing screen a beat later — the player may have
            // opened something else in the meantime, and yanking them out of
            // it would be worse than making them tap.
            if store.roomId == nil { store.join(roomId: room) }
        }
    }
}

/// Which of the three prizes a caller means.
enum CupPlace: String { case first, second, third }

/// A cup prize written the way the reader reads money.
///
/// The owner sets one number in one currency; the server converts it for
/// whoever asked, and only when it actually knows today's rate — see fx.js.
/// A converted figure carries "≈" so nobody reads it as the sum they will be
/// handed.
func cupMoney(prize: CupFeed.Prize, local: CupFeed.Local?, place: CupPlace) -> String {
    let localAmount: Int? = {
        switch place {
        case .first:  return local?.first
        case .second: return local?.second
        case .third:  return local?.third
        }
    }()
    if let local, let amount = localAmount {
        let unit = (local.symbol?.isEmpty == false) ? local.symbol! : "\(local.code ?? "") "
        return "≈\(unit)\(amount.formatted(.number))"
    }
    let usd: Int? = {
        switch place {
        case .first:  return prize.first
        case .second: return prize.second
        case .third:  return prize.third
        }
    }()
    let cur = prize.currency ?? "USD"
    let amount = (usd ?? 0).formatted(.number)
    return cur == "USD" ? "$\(amount)" : "\(cur) \(amount)"
}

// MARK: - the card

struct CupCard: View {
    /// Whether this device is attached to an account. Entering needs one —
    /// a prize needs somebody it can be paid to — so the card says so rather
    /// than letting the tap fail. The two sign-in buttons sit directly above
    /// this card on the same tab, which is why there is no third one here.
    var signedIn: Bool
    @ObservedObject var watch: CupWatch

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    @State private var showChart = false
    @State private var showPoster = false

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 0) {
            if let cup = live {
                switch cup.state {
                case "joining":  joiningFace(cup, P)
                case "running":  runningFace(cup, P)
                case "done":     doneFace(cup, P)
                default:        EmptyView()
                }
            }
        }
        .animation(.spring(duration: 0.32), value: live)
        .sheet(isPresented: $showChart) { CupChartSheet().environmentObject(store) }
        .sheet(isPresented: $showPoster) {
            if let cup = live { CupPosterSheet(cup: cup) }
        }
    }

    /// "What is a cup?" before you enter one, "See the chart" once one is
    /// running. Both are sheets — things you go and look at.
    private func moreButton(_ title: String, _ glyph: Glyph, chart: Bool, _ P: Palette) -> some View {
        Button {
            Haptics.tap()
            if chart { showChart = true } else { showPoster = true }
        } label: {
            HStack(spacing: 7) {
                Art.icon(glyph, size: 14)
                Text(title)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(MMButtonStyle(kind: .ghost))
    }

    private var live: CupFeed.Cup? { watch.live }
    private var busy: Bool { watch.busy }

    // MARK: - faces

    private func joiningFace(_ cup: CupFeed.Cup, _ P: Palette) -> some View {
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                head(cup, subtitle: "Knockout — last one standing takes \(money(cup, .first))", P)
                doorClock(cup, P)
                prizes(cup, P)

                if !signedIn {
                    HStack(spacing: 7) {
                        Art.icon(.key, size: 14)
                        Text("Sign in above to enter — a prize needs somebody to pay")
                            .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(P.sunken, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                } else if cup.you.joined == true {
                    note("You are in. Your first table opens when the doors close.", tone: P.good, P)
                    HStack(spacing: 8) {
                        moreButton("How it works", .question, chart: false, P)
                        Button("Withdraw") { Task { await watch.leave() } }
                            .buttonStyle(MMButtonStyle(kind: .ghost))
                            .frame(maxWidth: .infinity)
                            .disabled(busy)
                    }
                } else {
                    Button {
                        Task { await watch.enter() }
                    } label: {
                        HStack(spacing: 8) {
                            if busy { ProgressView().tint(P.accentInk) }
                            else { Art.icon(.trophy, size: 18) }
                            Text(busy ? "Entering…" : "Enter the cup")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(MMButtonStyle(kind: .gold))
                    .disabled(busy)
                    moreButton("What is a cup?", .question, chart: false, P)
                }
            }
        }
    }

    private func runningFace(_ cup: CupFeed.Cup, _ P: Palette) -> some View {
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                head(cup, subtitle: roundName(cup.round), P)
                if let matches = cup.round?.matches, !matches.isEmpty {
                    tableLights(matches, P)
                }
                prizes(cup, P)
                note(standingLine(cup), tone: cup.you.roomId != nil ? P.good : P.ink3, P)

                if let room = cup.you.roomId {
                    Button {
                        Haptics.tap()
                        store.join(roomId: room)
                    } label: {
                        HStack(spacing: 8) {
                            Art.icon(.dice, size: 18)
                            Text("Go to your table")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(MMButtonStyle(kind: .primary))
                }
                moreButton("See the chart", .chart, chart: true, P)
            }
        }
    }

    /// Over. The server keeps a finished cup in front of everyone for a few
    /// minutes, because one that vanishes the moment it is won never tells
    /// the winner they won it.
    @ViewBuilder private func doneFace(_ cup: CupFeed.Cup, _ P: Palette) -> some View {
        if let s = cup.standings {
            MMCard(padding: 16) {
                VStack(alignment: .leading, spacing: 12) {
                    head(cup, subtitle: s.first.map { "\($0.name ?? "Somebody") takes it" }
                         ?? "Nobody finished this one", P)
                    VStack(spacing: 6) {
                        step("1st", s.first, money(cup, .first),
                             gold: true, mine: cup.you.placed == "first", P)
                        step("2nd", s.second, money(cup, .second),
                             gold: false, mine: cup.you.placed == "second", P)
                        step("3rd", s.third, money(cup, .third),
                             gold: false, mine: cup.you.placed == "third", P)
                    }
                    if cup.you.placed != nil {
                        note("You finished \(cup.you.placed ?? ""). The prize is paid by hand — hold on to your friend code.",
                             tone: P.good, P)
                    }
                    moreButton("See the chart", .chart, chart: true, P)
                }
            }
        }
    }

    private func step(_ place: String, _ who: CupFeed.Standings.Card?, _ amount: String,
                      gold: Bool, mine: Bool, _ P: Palette) -> some View {
        HStack(spacing: 9) {
            Text(place.uppercased())
                .font(.system(size: 10, weight: .heavy, design: .rounded))
                .kerning(0.9)
                .foregroundStyle(gold ? P.gold : P.ink3)
                .frame(width: 26, alignment: .leading)
            Text(who?.name ?? "—")
                .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                .foregroundStyle(P.ink)
                .lineLimit(1)
            Spacer(minLength: 6)
            Text(amount)
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(gold ? P.gold : P.ink2)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 11)
        .background(gold ? P.goldSoft : P.sunken,
                    in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
            .stroke(mine ? P.good : (gold ? P.gold : P.rule), lineWidth: mine ? 2 : 1))
    }

    // MARK: - pieces

    private func head(_ cup: CupFeed.Cup, subtitle: String, _ P: Palette) -> some View {
        HStack(spacing: 11) {
            ZStack {
                RoundedRectangle(cornerRadius: 13, style: .continuous).fill(P.goldSoft)
                RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(P.gold, lineWidth: 1)
                Art.icon(.trophy, size: 20)
            }
            .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 2) {
                Text(cup.name)
                    .font(.system(size: 15, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .lineLimit(2)
            }
            Spacer(minLength: 6)

            Text("\(cup.entrants) in")
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(P.ink2)
                .padding(.vertical, 4)
                .padding(.horizontal, 9)
                .background(P.sunken, in: Capsule())
                .overlay(Capsule().stroke(P.rule, lineWidth: 1))
        }
    }

    /// The door, drawn as a bar that empties. A number on its own makes you do
    /// the arithmetic; a bar says at a glance whether there is time to think.
    @ViewBuilder private func doorClock(_ cup: CupFeed.Cup, _ P: Palette) -> some View {
        if let closes = cup.closesDate {
            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                let left = max(0, closes.timeIntervalSinceNow)
                let opened = cup.openedDate ?? closes.addingTimeInterval(-300)
                let span = max(1, closes.timeIntervalSince(opened))
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Doors close in")
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                        Spacer()
                        Text(clock(left))
                            .font(.system(size: 15, weight: .heavy, design: .rounded))
                            .monospacedDigit()
                            // Under half a minute the clock stops being
                            // information and starts being a nudge.
                            .foregroundStyle(left <= 30 ? P.bad : P.ink)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(P.sunken)
                            Capsule()
                                .fill(LinearGradient(colors: [P.gold, P.red],
                                                     startPoint: .leading, endPoint: .trailing))
                                .frame(width: max(0, min(1, left / span)) * geo.size.width)
                        }
                    }
                    .frame(height: 5)
                    .overlay(Capsule().stroke(P.rule, lineWidth: 1))
                }
            }
        }
    }

    /// Three places, three metals, first among them wider — it is the thing
    /// everybody is actually here for.
    private func prizes(_ cup: CupFeed.Cup, _ P: Palette) -> some View {
        HStack(spacing: 8) {
            prizePill("1st", money(cup, .first), tint: P.gold,
                      fill: P.goldSoft, big: true, P)
            prizePill("2nd", money(cup, .second), tint: P.ink3,
                      fill: P.sunken, big: false, P)
            prizePill("3rd", money(cup, .third), tint: Color(hex: 0xA2662A),
                      fill: P.sunken, big: false, P)
        }
    }

    /// All three share the row evenly — an earlier version gave the first a
    /// higher layout priority, and SwiftUI read that as "give it everything",
    /// which left second and third at zero width. It leads on weight instead.
    private func prizePill(_ place: String, _ amount: String,
                           tint: Color, fill: Color, big: Bool, _ P: Palette) -> some View {
        VStack(spacing: 2) {
            Text(place.uppercased())
                .font(.system(size: 10, weight: .heavy, design: .rounded))
                .kerning(0.9)
                .foregroundStyle(big ? tint : P.ink3)
            Text(amount)
                .font(.system(size: big ? 17 : 14, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(big ? P.gold : P.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(fill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(big ? tint : P.rule, lineWidth: 1))
    }

    /// One light per table in the round being played: lit while it is still
    /// being fought over, dim once it is decided.
    private func tableLights(_ matches: [CupFeed.Match], _ P: Palette) -> some View {
        // A big cup has fifty of these; a wrapping row of dots is the only
        // honest way to show "how much of this round is left" at a glance.
        FlowDots(count: min(matches.count, 60),
                 live: matches.prefix(60).map { $0.state != "done" },
                 onColor: P.gold, offColor: P.rule2)
    }

    private func note(_ text: String, tone: Color, _ P: Palette) -> some View {
        Text(text)
            .font(.system(size: 12.5, weight: .medium, design: .rounded))
            .foregroundStyle(tone)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - words

    /// A converted figure always carries its "≈": the prize is the owner's
    /// number, and this is a reading aid rather than a promise.
    private func money(_ cup: CupFeed.Cup, _ place: CupPlace) -> String {
        cupMoney(prize: cup.prize, local: cup.local, place: place)
    }

    private func clock(_ seconds: TimeInterval) -> String {
        let s = Int(seconds.rounded(.up))
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    private func roundName(_ round: CupFeed.Round?) -> String {
        guard let round else { return "Drawing the bracket…" }
        if round.kind == "final" { return "The final" }
        if round.kind == "thirdPlace" { return "Third place" }
        let matches = round.matches ?? []
        let live = matches.filter { $0.state != "done" }.count
        return "Round \(round.n ?? 1) — \(live) of \(matches.count) still playing"
    }

    private func standingLine(_ cup: CupFeed.Cup) -> String {
        guard cup.you.joined == true else { return "Running now — the doors are shut." }
        if cup.you.out == true { return "You are out of this one." }
        if let opponent = cup.you.opponent, cup.you.roomId != nil {
            return "Your table is open — you are playing \(opponent)."
        }
        if cup.you.roomId != nil { return "Your table is open — good luck." }
        return "Waiting for your next table."
    }

}

// MARK: - a wrapping row of small lights

/// SwiftUI has no wrapping stack before iOS 16's Layout, and a cup with fifty
/// tables needs one. This is the smallest thing that does the job.
private struct FlowDots: View {
    var count: Int
    var live: [Bool]
    var onColor: Color
    var offColor: Color

    @State private var pulse = false

    var body: some View {
        // 8pt dots on a 5pt gutter: a phone fits about two dozen per row, and
        // the rows wrap on their own.
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 13, maximum: 13), spacing: 5)],
                  alignment: .leading, spacing: 5) {
            ForEach(0..<count, id: \.self) { i in
                Circle()
                    .fill(live.indices.contains(i) && live[i] ? onColor : offColor)
                    .frame(width: 8, height: 8)
                    .opacity(live.indices.contains(i) && live[i] ? (pulse ? 0.4 : 1) : 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}
