// The brand mark, drawn in pure SwiftUI so it re-tints with every table
// style: an ivory die (showing five) on a gold ring, plus the wordmark.
// Also home of the cold-launch splash — the die rolls in, the pips land,
// the name slides up, then the whole thing hands over to the landing screen.

import SwiftUI

// MARK: - the mark

struct LogoMark: View {
    var size: CGFloat = 120
    /// Rolls in (rotation + pip cascade) when it first appears.
    var animated = false

    @Environment(\.colorScheme) private var scheme
    @State private var rolledIn = false
    @State private var pipsShown = 0

    private var settled: Bool { !animated || rolledIn }

    var body: some View {
        let P = Palette.current(scheme)

        ZStack {
            // gold ring behind the die
            Circle()
                .stroke(P.gold.opacity(0.55), lineWidth: size * 0.02)
                .frame(width: size * 1.24, height: size * 1.24)
                .offset(y: size * 0.02)
                .scaleEffect(settled ? 1 : 0.6)
                .opacity(settled ? 1 : 0)

            // the die
            RoundedRectangle(cornerRadius: size * 0.19, style: .continuous)
                .fill(
                    LinearGradient(colors: [Color(hex: 0xFFFCF4), Color(hex: 0xEFE7D8)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .frame(width: size, height: size)
                .overlay(pipGrid)
                .overlay(
                    RoundedRectangle(cornerRadius: size * 0.19, style: .continuous)
                        .stroke(Color.black.opacity(0.12), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.35), radius: size * 0.1, y: size * 0.06)
                .rotationEffect(.degrees(settled ? -11 : -200))
                .scaleEffect(settled ? 1 : 0.3)
        }
        .onAppear {
            guard animated, !rolledIn else { pipsShown = 5; return }
            withAnimation(.spring(duration: 0.85, bounce: 0.38)) { rolledIn = true }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(520))
                for n in 1...5 {
                    withAnimation(.spring(duration: 0.25, bounce: 0.55)) { pipsShown = n }
                    try? await Task.sleep(for: .milliseconds(90))
                }
            }
        }
    }

    /// Classic five, cascading in when animated.
    private var pipGrid: some View {
        let r = size * 0.105
        let off = size * 0.27
        let spots: [CGSize] = [
            CGSize(width: -off, height: -off), CGSize(width: off, height: -off),
            .zero,
            CGSize(width: -off, height: off), CGSize(width: off, height: off),
        ]
        return ZStack {
            ForEach(Array(spots.enumerated()), id: \.offset) { k, spot in
                Circle()
                    .fill(Color(hex: 0x1B5E3F))
                    .frame(width: r * 2, height: r * 2)
                    .offset(spot)
                    .scaleEffect(!animated || k < pipsShown ? 1 : 0.01)
            }
        }
    }
}

// MARK: - wordmark

struct Wordmark: View {
    var fontSize: CGFloat = 40

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        HStack(spacing: 0) {
            Text("MONEY").foregroundStyle(P.ink)
            Text("MOVE").foregroundStyle(P.red)
        }
        .font(.system(size: fontSize, weight: .heavy, design: .rounded))
        .kerning(1)
    }
}

// MARK: - splash

/// Cold-launch flourish: felt table, the die rolls in and lands its pips,
/// the wordmark rises, then everything fades into the landing screen.
struct SplashView: View {
    let done: () -> Void

    @Environment(\.colorScheme) private var scheme
    @State private var showWord = false
    @State private var showTag = false
    @State private var leaving = false

    var body: some View {
        let P = Palette.current(scheme)
        ZStack {
            LinearGradient(colors: [P.page, P.page2], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            // soft table sheen
            RadialGradient(colors: [P.card.opacity(scheme == .light ? 0.7 : 0.14), .clear],
                           center: .init(x: 0.5, y: 0.36), startRadius: 10, endRadius: 340)
                .ignoresSafeArea()

            VStack(spacing: 26) {
                LogoMark(size: 118, animated: true)
                    .padding(.bottom, 8)

                Wordmark(fontSize: 38)
                    .opacity(showWord ? 1 : 0)
                    .offset(y: showWord ? 0 : 16)

                Text("Buy streets. Build hotels. Bankrupt your friends.")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink2)
                    .opacity(showTag ? 1 : 0)
            }
            .offset(y: -20)
        }
        .opacity(leaving ? 0 : 1)
        .task {
            SoundKit.shared.warmUp()
            SoundKit.shared.dice()
            try? await Task.sleep(for: .milliseconds(650))
            withAnimation(.spring(duration: 0.5, bounce: 0.25)) { showWord = true }
            try? await Task.sleep(for: .milliseconds(320))
            withAnimation(.easeOut(duration: 0.4)) { showTag = true }
            try? await Task.sleep(for: .milliseconds(950))
            withAnimation(.easeInOut(duration: 0.45)) { leaving = true }
            try? await Task.sleep(for: .milliseconds(460))
            done()
        }
    }
}
