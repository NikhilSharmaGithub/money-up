// The tournament, opened.
//
// The card on the Social tab is a summary: a countdown, three prizes and one
// button. This is the room behind it, and it exists to answer the question a
// player in a cup actually has at nine in the evening — not "what round am I
// in" but "who do I play, when does the door open, and what happens if I miss
// it". That question goes at the top; everything else is history.

import SwiftUI

struct CupDetailSheet: View {
    let cup: CupFeed.Cup
    @ObservedObject var watch: CupWatch

    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var showChart = false
    @State private var asked: Set<String> = []

    /// Always the freshest copy: the poll keeps running while this is open, so
    /// a door that opens while somebody is reading opens on screen too.
    private var live: CupFeed.Cup { watch.live?.id == cup.id ? (watch.live ?? cup) : cup }

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    banner(P)
                    tiles(P)
                    if let next = live.you.next { nextMatch(next, P) }
                    if live.you.joined != true { joinPrompt(P) }
                    if !run.isEmpty {
                        label("Your run", P)
                        runList(P)
                    }
                    if let s = live.standings, s.first != nil {
                        label("Final standings", P)
                        podium(s, P)
                    }
                    if !live.plan.isEmpty {
                        label("The whole plan", P)
                        planList(P)
                    }
                    chartButton(P)
                    rules(P)
                }
                .padding(16)
            }
            .background(P.page.ignoresSafeArea())
            .navigationTitle(live.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
        .sheet(isPresented: $showChart) { CupChartSheet().environmentObject(store) }
    }

    // MARK: - the top

    private func banner(_ P: Palette) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 15, style: .continuous).fill(P.goldSoft)
                RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(P.gold, lineWidth: 1)
                Art.icon(.trophy, size: 26)
            }
            .frame(width: 54, height: 54)

            VStack(alignment: .leading, spacing: 3) {
                Text(live.needsCode ? "Invite only" : "Open to everyone")
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .kerning(0.8)
                    .foregroundStyle(P.ink3)
                Text("Knockout — last one standing takes \(money(.first))")
                    .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                if let line = scheduleLine {
                    HStack(spacing: 5) {
                        Art.icon(.snooze, size: 12)
                        Text(line)
                            .font(.system(size: 11.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }

    /// "Rounds at 20:00 and 22:00 · 10 minutes to turn up"
    private var scheduleLine: String? {
        guard let times = live.schedule?.times, !times.isEmpty else { return nil }
        let pad = { (n: Int) in n < 10 ? "0\(n)" : "\(n)" }
        let clock = times.map { "\(pad($0 / 60)):\(pad($0 % 60))" }
        let joined = clock.count == 1 ? clock[0]
            : clock.dropLast().joined(separator: ", ") + " and " + (clock.last ?? "")
        let window = live.schedule?.windowMinutes ?? 10
        return "Rounds at \(joined) · \(window) minutes to turn up"
    }

    private func tiles(_ P: Palette) -> some View {
        HStack(spacing: 8) {
            tile("Prize pool", money(.pool), P)
            tile(live.state == "done" ? "Finished" : "Round",
                 live.state == "done" ? "—" : "\(live.you.round ?? live.rounds) of \(depth)", P)
            tile("Still in", "\(live.you.left ?? live.entrants)", P)
        }
    }

    private func tile(_ label: String, _ value: String, _ P: Palette) -> some View {
        VStack(spacing: 3) {
            Text(label)
                .font(.system(size: 10.5, weight: .heavy, design: .rounded))
                .kerning(0.7)
                .foregroundStyle(P.ink3)
            Text(value)
                .font(.system(size: 17, weight: .black, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(P.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 11)
        .background(P.sunken, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(P.rule, lineWidth: 1))
    }

    /// How many rounds a field this size takes, so "round 3 of 8" means
    /// something before the bracket has been drawn that far.
    private var depth: Int {
        var n = max(2, live.entrants), rounds = 0
        while n > 1 { n = Int(ceil(Double(n) / 2)); rounds += 1 }
        return rounds
    }

    // MARK: - what happens next

    private func nextMatch(_ next: CupFeed.NextMatch, _ P: Palette) -> some View {
        let open = next.open == true
        return VStack(alignment: .leading, spacing: 11) {
            Text(open ? "YOUR MATCH IS OPEN" : "YOUR NEXT MATCH")
                .font(.system(size: 10.5, weight: .heavy, design: .rounded))
                .kerning(0.9)
                .foregroundStyle(open ? P.good : P.ink3)

            HStack(spacing: 10) {
                side(live.you.name ?? "You", mine: true, P)
                Text("v")
                    .font(.system(size: 13, weight: .black, design: .rounded))
                    .foregroundStyle(P.ink3)
                side(next.opponent ?? "a bye", mine: false, P)
            }

            if let opens = next.opensDate, !open {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    HStack(spacing: 6) {
                        Art.icon(.snooze, size: 13)
                        Text("Opens in \(countdown(opens.timeIntervalSinceNow)) · \(opens.formatted(.dateTime.hour().minute()))")
                            .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink2)
                    }
                }
            } else if let closes = next.closesDate, open {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    HStack(spacing: 6) {
                        Art.icon(.warning, size: 13)
                        Text("Door shuts in \(countdown(closes.timeIntervalSinceNow)) — miss it and you are out")
                            .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.bad)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            if let room = next.roomId {
                Button {
                    Haptics.turn()
                    dismiss()
                    store.join(roomId: room)
                } label: {
                    HStack(spacing: 8) {
                        Art.icon(.dice, size: 18)
                        Text("Play your match")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(MMButtonStyle(kind: .primary, big: true))
            } else if open {
                HStack(spacing: 7) {
                    ProgressView().tint(P.gold).scaleEffect(0.8)
                    Text("Making your table…")
                        .font(.system(size: 12.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(open ? P.goldSoft : P.sunken,
                    in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous)
            .stroke(open ? P.gold : P.rule, lineWidth: open ? 1.5 : 1))
    }

    private func side(_ name: String, mine: Bool, _ P: Palette) -> some View {
        Text(name)
            .font(.system(size: 14, weight: .heavy, design: .rounded))
            .foregroundStyle(mine ? P.ink : P.ink2)
            .lineLimit(1)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(mine ? P.card : P.card.opacity(0.6),
                        in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
                .stroke(mine ? P.gold : P.rule, lineWidth: 1))
    }

    @ViewBuilder private func joinPrompt(_ P: Palette) -> some View {
        if live.state == "joining" {
            Text("You have not joined this one. Close this and tap Join on the card.")
                .font(.system(size: 12.5, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink3)
                .fixedSize(horizontal: false, vertical: true)
        } else if live.you.out == true {
            HStack(spacing: 7) {
                Art.icon(.skull, size: 15)
                Text("You are out of this one. The chart below shows how it finished.")
                    .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(11)
            .background(P.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    // MARK: - your run

    private struct Rung: Identifiable {
        var id: Int
        var label: String
        var line: String
        var kind: Int      // 0 lost, 1 won, 2 still going
    }

    /// Built from the round the card already carries — the whole bracket is a
    /// separate fetch and this screen must open instantly.
    private var run: [Rung] {
        guard let me = live.you.name, let r = live.round, let matches = r.matches else { return [] }
        var out: [Rung] = []
        for (i, m) in matches.enumerated() where m.a == me || m.b == me {
            let other = m.a == me ? m.b : m.a
            let won = m.winner == me
            out.append(Rung(id: i, label: r.kind == "final" ? "The final" : "Round \(r.n ?? 1)",
                            line: m.state != "done" ? "playing \(other ?? "…")"
                                : won ? "beat \(other ?? "a walkover")" : "lost to \(m.winner ?? "the other side")",
                            kind: m.state != "done" ? 2 : (won ? 1 : 0)))
        }
        return out
    }

    private func runList(_ P: Palette) -> some View {
        VStack(spacing: 6) {
            ForEach(run) { rung in
                HStack(spacing: 10) {
                    Circle()
                        .fill(rung.kind == 2 ? P.gold : rung.kind == 1 ? P.good : P.bad)
                        .frame(width: 9, height: 9)
                    Text(rung.label)
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                    Text(rung.line)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink2)
                    Spacer(minLength: 4)
                }
                .padding(.vertical, 9)
                .padding(.horizontal, 12)
                .background(P.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(P.rule, lineWidth: 1))
            }
        }
    }

    // MARK: - who won, and adding them

    private func podium(_ s: CupFeed.Standings, _ P: Palette) -> some View {
        VStack(spacing: 6) {
            place("1st", s.first, .first, gold: true, P)
            place("2nd", s.second, .second, gold: false, P)
            place("3rd", s.third, .third, gold: false, P)
        }
    }

    private func place(_ label: String, _ who: CupFeed.Standings.Card?, _ slot: CupPlace,
                       gold: Bool, _ P: Palette) -> some View {
        let code = who?.code ?? ""
        let mine = !code.isEmpty && code == live.you.code
        return HStack(spacing: 10) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .heavy, design: .rounded))
                .foregroundStyle(gold ? P.gold : P.ink3)
                .frame(width: 26, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                Text(who?.name ?? "—")
                    .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                if !code.isEmpty {
                    Text(code)
                        .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                        .foregroundStyle(P.ink3)
                }
            }
            Spacer(minLength: 6)
            Text(money(slot))
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(gold ? P.gold : P.ink2)
            // Playing somebody is the best introduction there is, so the
            // people you just played are one tap from being friends.
            if !code.isEmpty && !mine {
                Button {
                    Task { await ask(code) }
                } label: {
                    Image(systemName: asked.contains(code) ? "checkmark" : "person.badge.plus")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(asked.contains(code) ? P.good : P.ink2)
                        .frame(width: 30, height: 30)
                        .background(P.card, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Add \(who?.name ?? "them") as a friend")
            }
        }
        .padding(.vertical, 9)
        .padding(.horizontal, 12)
        .background(gold ? P.goldSoft : P.sunken,
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(mine ? P.good : (gold ? P.gold : P.rule), lineWidth: mine ? 2 : 1))
    }

    private func ask(_ code: String) async {
        struct Reply: Decodable { var ok: Bool?; var error: String? }
        let reply: Reply? = try? await store.fetchJSON(
            "/api/friends", method: "POST", body: ["token": store.token, "code": code])
        if reply?.ok == true {
            asked.insert(code)
            Haptics.tap()
            store.showToast("Request sent")
        } else {
            store.showToast(reply?.error ?? "Could not send that", isError: true)
        }
    }

    // MARK: - the plan

    /// Every round, with the night it falls on. A knockout is completely
    /// predictable — each round halves the field and takes the next slot on
    /// the clock — so there is no reason to make anybody guess how many
    /// evenings they have signed up to, or which one they can miss.
    private func planList(_ P: Palette) -> some View {
        VStack(spacing: 6) {
            ForEach(live.plan) { r in
                HStack(spacing: 11) {
                    Text("\(r.n)")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(r.done ? P.ink3 : P.ink2)
                        .frame(width: 22, height: 22)
                        .background(r.yours ? P.goldSoft : P.card, in: Circle())
                        .overlay(Circle().stroke(r.yours ? P.gold : P.rule, lineWidth: 1))

                    VStack(alignment: .leading, spacing: 1) {
                        Text(r.label)
                            .font(.system(size: 13, weight: .heavy, design: .rounded))
                            .foregroundStyle(r.done ? P.ink3 : P.ink)
                        Text("\(r.players) players → \(r.through) through")
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                    }
                    Spacer(minLength: 6)
                    VStack(alignment: .trailing, spacing: 1) {
                        if let d = r.opensDate {
                            Text(d.formatted(.dateTime.weekday(.abbreviated).hour().minute()))
                                .font(.system(size: 12, weight: .heavy, design: .rounded))
                                .foregroundStyle(r.done ? P.ink3 : P.ink2)
                        }
                        if r.done {
                            Text("played")
                                .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                                .foregroundStyle(P.ink3)
                        } else if r.projected {
                            Text("planned")
                                .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                                .foregroundStyle(P.ink3)
                        }
                    }
                }
                .padding(.vertical, 8)
                .padding(.horizontal, 11)
                .opacity(r.done ? 0.6 : 1)
                .background(r.yours && !r.done ? P.goldSoft : P.sunken,
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(r.yours && !r.done ? P.gold : P.rule, lineWidth: 1))
            }
        }
    }

    // MARK: - the rest

    private func chartButton(_ P: Palette) -> some View {
        Button {
            Haptics.tap()
            showChart = true
        } label: {
            HStack(spacing: 8) {
                Art.icon(.chart, size: 16)
                Text("See the whole chart")
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
    }

    private func rules(_ P: Palette) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            label("How it works", P)
            ForEach(Array(ruleLines.enumerated()), id: \.offset) { _, line in
                HStack(alignment: .top, spacing: 8) {
                    Circle().fill(P.ink3).frame(width: 4, height: 4).padding(.top, 6)
                    Text(line)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var ruleLines: [String] {
        var out = ["Win your match and you go through. Lose it and you are out."]
        if live.schedule?.times?.isEmpty == false {
            let w = live.schedule?.windowMinutes ?? 10
            out.append("Each round opens at its time and stays open \(w) minutes. Turn up inside that window or you are out — even if you would have won.")
        }
        if live.schedule?.times?.isEmpty == false {
            out.append("A game still running when the next round is due is decided on net worth — whoever is ahead goes through, so one long game never holds up everybody else's evening.")
        }
        out.append("Prizes are paid by hand by whoever set the cup up. Keep your friend code.")
        return out
    }

    private func label(_ text: String, _ P: Palette) -> some View {
        Text(text.uppercased())
            .font(.system(size: 10.5, weight: .heavy, design: .rounded))
            .kerning(1)
            .foregroundStyle(P.ink3)
    }

    private enum Pool { case pool }

    private func money(_ place: CupPlace) -> String {
        cupMoney(prize: live.prize, local: live.local, place: place)
    }

    /// First, second and third added up — what the cup is worth in total.
    private func money(_: Pool) -> String {
        let local = live.local
        if let l = local, let a = l.first, let b = l.second, let c = l.third {
            let unit = (l.symbol?.isEmpty == false) ? l.symbol! : "\(l.code ?? "") "
            return "≈\(unit)\((a + b + c).formatted(.number))"
        }
        let total = (live.prize.first ?? 0) + (live.prize.second ?? 0) + (live.prize.third ?? 0)
        let cur = live.prize.currency ?? "USD"
        return cur == "USD" ? "$\(total.formatted(.number))" : "\(cur) \(total.formatted(.number))"
    }

    private func countdown(_ seconds: TimeInterval) -> String {
        let left = Int(max(0, seconds).rounded())
        if left >= 86400 { return "\(left / 86400)d \(left % 86400 / 3600)h" }
        if left >= 3600 { return "\(left / 3600)h \(left % 3600 / 60)m" }
        return String(format: "%d:%02d", left / 60, left % 60)
    }
}
