// App entry: routes between the landing screen and the game, and hosts the
// overlays (toasts, card popups, turn banner) that float above everything.

import SwiftUI

@main
struct MoneyMoveApp: App {
    @StateObject private var store = GameStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        ZStack {
            LinearGradient(colors: [P.page, P.page2], startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()

            if store.roomId == nil {
                LandingView()
                    .transition(.opacity)
            } else {
                GameScreen()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: store.roomId == nil)
        .overlay(alignment: .bottom) { toastOverlay }
        .overlay { cardPopupOverlay }
        .overlay(alignment: .top) { turnBannerOverlay }
        .preferredColorScheme(nil) // follow the system; dark is the house default at night
    }

    // MARK: - overlays

    @ViewBuilder private var toastOverlay: some View {
        let P = Palette.current(scheme)
        if let toast = store.toast {
            HStack(spacing: 8) {
                Image(systemName: toast.isError ? "exclamationmark.triangle.fill" : "info.circle.fill")
                Text(toast.text).lineLimit(2)
            }
            .font(.system(size: 14, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .padding(.vertical, 11)
            .padding(.horizontal, 17)
            .background(toast.isError ? P.redDeep : P.ink.opacity(scheme == .light ? 1 : 0.25), in: Capsule())
            .background(.ultraThinMaterial, in: Capsule())
            .padding(.bottom, 24)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .id(toast.id)
        }
    }

    @ViewBuilder private var cardPopupOverlay: some View {
        let P = Palette.current(scheme)
        if let card = store.cardPopup {
            let isTreasure = card.deck == "treasure"
            VStack(spacing: 10) {
                Text(isTreasure ? "🧰" : "❓").font(.system(size: 44))
                Text(isTreasure ? "TREASURE" : "SURPRISE")
                    .font(.system(size: 11, weight: .bold)).kerning(2)
                    .foregroundStyle(P.ink3)
                Text(card.text)
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(P.ink)
            }
            .padding(26)
            .frame(maxWidth: 320)
            .background(isTreasure ? P.tileTreasure : P.tileSurprise,
                        in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(isTreasure ? P.gold : P.red, lineWidth: 2)
            )
            .shadow(color: .black.opacity(0.35), radius: 24, y: 10)
            .transition(.scale(scale: 0.7).combined(with: .opacity))
            .onTapGesture { store.cardPopup = nil }
            .task {
                try? await Task.sleep(for: .seconds(3.2))
                withAnimation { store.cardPopup = nil }
            }
        }
    }

    @ViewBuilder private var turnBannerOverlay: some View {
        let P = Palette.current(scheme)
        if let p = store.turnBanner {
            HStack(spacing: 10) {
                AvatarView(name: p.name, colorCSS: p.color, flag: p.flag ?? "", size: 30)
                Text(p.id == store.meId ? "Your turn!" : "\(p.name)'s turn")
                    .font(.system(size: 16, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink)
            }
            .padding(.vertical, 9)
            .padding(.leading, 9)
            .padding(.trailing, 20)
            .background(P.card, in: Capsule())
            .overlay(Capsule().stroke(Color(css: p.color), lineWidth: 2))
            .shadow(color: .black.opacity(0.3), radius: 14, y: 6)
            // Below the top bar and player strip, floating over the board.
            .padding(.top, 116)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}

extension View {
    /// Animates the standard overlay transitions driven by the store.
    func animateOverlays(_ store: GameStore) -> some View {
        self
            .animation(.spring(duration: 0.35), value: store.toast)
            .animation(.spring(duration: 0.4), value: store.cardPopup)
            .animation(.spring(duration: 0.4), value: store.turnBanner)
    }
}
