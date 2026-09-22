// Coins landing in the counter.
//
// The app has no permanent coin counter: the Store tab keeps one, a table
// keeps none, and coins are paid in both places — a win settles at the board,
// the daily and the rewarded view are collected from cards on the home screen.
// So a payout would otherwise be a number that was one thing and is quietly
// another the next time somebody opens the Store.
//
// This is the counter for that moment. A pill in the top right, a handful of
// coins flying into it, the total climbing. It lives in the toast window, above
// every sheet and taking no touches, because coins land during sheets — the
// daily card, the ad offer, the game-over sheet — as often as they land
// outside them. Nothing here decides what a payout is: GameStore hands it one
// when the server's earned watermark moves, and only then.

import SwiftUI

struct CoinFlightLayer: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The credit being shown, held apart from the store's so the pill can
    /// outlive it by the second or so it takes to read.
    @State private var credit: GameStore.CoinCredit?
    /// What the pill is saying right now — it climbs to the credit's total.
    @State private var counted = 0
    @State private var arrived = false      // the discs, once they have flown
    @State private var showing = false      // the pill's own entrance
    @State private var run: Task<Void, Never>?

    /// A handful, not one per coin: a 400-coin pack is the same flight as a
    /// 2-coin win, because this is a payment landing, not a bar chart. Fixed
    /// scatter rather than random, so a repaint mid-flight cannot move a disc
    /// that is already on its way.
    private let spread: [CGFloat] = [-74, -30, 6, 42, 78]
    private let lift: [CGFloat] = [8, -16, 14, -10, 2]

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topTrailing) {
                Color.clear
                if credit != nil {
                    if !reduceMotion { discs(in: geo.size) }
                    pill
                }
            }
        }
        .allowsHitTesting(false)
        .onChange(of: store.coinCredit) { _, fresh in
            guard let fresh else { return }
            land(fresh)
        }
    }

    // MARK: - the counter

    private var pill: some View {
        let P = Palette.current(scheme)
        return HStack(spacing: 6) {
            Art.icon(.coin, size: 17)
            Text("\(counted)")
                .font(.system(size: 16, weight: .heavy, design: .rounded))
                .foregroundStyle(P.gold)
                .contentTransition(.numericText())
            if let credit {
                Text("+\(credit.amount)")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(P.good)
            }
        }
        .padding(.vertical, 7)
        .padding(.horizontal, 13)
        .background(P.card, in: Capsule())
        .overlay(Capsule().stroke(P.gold.opacity(0.65), lineWidth: 1))
        .shadow(color: .black.opacity(0.25), radius: 10, y: 4)
        .scaleEffect(arrived && !reduceMotion ? 1.12 : 1)
        .animation(.spring(duration: 0.34, bounce: 0.5), value: arrived)
        // Hard against the top of the safe area: the Store tab keeps a coin
        // chip of its own in this corner, and the two reading the same figure
        // on top of each other looks like a mistake. Up here they sit one
        // above the other for the second the pill is on screen.
        .padding(.top, 2)
        .padding(.trailing, 14)
        .opacity(showing ? 1 : 0)
        .offset(y: showing ? 0 : -10)
        .animation(.spring(duration: 0.3), value: showing)
    }

    // MARK: - the coins

    /// Five discs thrown from the middle of the screen at the pill. Each one
    /// animates the same single flag with a delay of its own, so the whole
    /// flight is five transforms and nothing else — a phone on its last bar of
    /// battery is moving the compositor, not laying out a view per frame.
    private func discs(in size: CGSize) -> some View {
        let target = CGPoint(x: max(40, size.width - 58), y: 24)
        let source = CGPoint(x: size.width / 2, y: size.height * 0.55)
        return ZStack {
            ForEach(spread.indices, id: \.self) { i in
                Art.icon(.coin, size: 22)
                    .shadow(color: .black.opacity(0.3), radius: 3, y: 2)
                    .scaleEffect(arrived ? 0.45 : 1)
                    .opacity(arrived ? 0.05 : 1)
                    .position(
                        x: arrived ? target.x : source.x + spread[i],
                        y: arrived ? target.y : source.y + lift[i]
                    )
                    .animation(.timingCurve(0.34, 0.16, 0.2, 1, duration: 0.55)
                        .delay(Double(i) * 0.05), value: arrived)
            }
        }
    }

    // MARK: - the sequence

    /// One credit, start to finish. A second credit landing mid-flight cancels
    /// this and starts again from whatever the pill is currently showing, so
    /// the number climbs past the figure in between instead of snapping back.
    private func land(_ fresh: GameStore.CoinCredit) {
        run?.cancel()
        let from = credit == nil ? max(0, fresh.total - fresh.amount) : counted
        credit = fresh
        counted = from
        arrived = false
        run = Task { @MainActor in
            showing = true
            guard !reduceMotion else {
                // No flight, no climb: the pill states what the wallet came to
                // and leaves. Less motion is the point of the setting.
                counted = fresh.total
                try? await Task.sleep(for: .milliseconds(1800))
                guard !Task.isCancelled else { return }
                showing = false
                try? await Task.sleep(for: .milliseconds(320))
                if !Task.isCancelled { credit = nil }
                return
            }
            // A frame on the start positions, or the discs animate from
            // wherever SwiftUI first drew them, which is the target.
            try? await Task.sleep(for: .milliseconds(30))
            guard !Task.isCancelled else { return }
            arrived = true
            // The total starts moving as the first disc arrives, not before.
            try? await Task.sleep(for: .milliseconds(320))
            await countUp(to: fresh.total, from: from)
            guard !Task.isCancelled else { return }
            try? await Task.sleep(for: .milliseconds(1100))
            guard !Task.isCancelled else { return }
            showing = false
            try? await Task.sleep(for: .milliseconds(320))
            if !Task.isCancelled { credit = nil }
        }
    }

    /// The number climbing to what it became. Capped at a couple of dozen
    /// steps: a 2,750-coin pack and a 2-coin win take the same half second.
    private func countUp(to total: Int, from: Int) async {
        guard total > from else { counted = total; return }
        let steps = min(18, total - from)
        for i in 1...steps {
            let t = Double(i) / Double(steps)
            let eased = 1 - pow(1 - t, 3)
            counted = from + Int((Double(total - from) * eased).rounded())
            try? await Task.sleep(for: .milliseconds(26))
            if Task.isCancelled { return }
        }
        counted = total
    }
}
