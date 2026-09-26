// App entry: routes between the landing screen and the game, and hosts the
// overlays (toasts, card popups, turn banner) that float above everything.

import SwiftUI

@main
struct MoneyMoveApp: App {
    @StateObject private var store = GameStore()
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
        }
    }
}

/// SwiftUI has no hook for the APNs callbacks, so the app keeps a delegate for
/// exactly one job: catching the device token and handing it on. Nothing sends
/// notifications yet — this only collects.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in PushRegistrar.shared.received(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Nothing is waiting on this token, so a failure is not the player's
        // problem to hear about — the next launch simply asks again.
    }
}

/// Toasts get a window of their own, above every sheet.
///
/// A toast hung on the root view is drawn underneath any sheet, and the things
/// a player does inside sheets — report, block, buy — are exactly the ones that
/// need a word back. A report that says nothing reads as a Report button that
/// does nothing. So toasts live in a window over everything that never takes
/// a touch: whatever is underneath stays fully usable while one is showing.
@MainActor
final class ToastWindow {
    static let shared = ToastWindow()
    private var window: UIWindow?

    func install(_ store: GameStore) {
        guard window == nil else { return }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
        else { return }
        let host = UIHostingController(rootView: ToastLayer().environmentObject(store))
        host.view.backgroundColor = .clear
        let w = UIWindow(windowScene: scene)
        w.rootViewController = host
        w.backgroundColor = .clear
        w.windowLevel = .alert + 1
        // Hit-testing skips a window that ignores touches, so taps fall
        // straight through to the app below.
        w.isUserInteractionEnabled = false
        w.isHidden = false
        window = w
    }
}

private struct ToastLayer: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    /// This window is its own hosting controller, so nothing the app's tree
    /// sets reaches it — the quality the governor has settled on included.
    /// It listens for itself.
    @ObservedObject private var governor = MMGlassGovernor.shared

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.clear
            // Coins land in this window too, and for the same reason toasts
            // do: a payout is collected from inside a sheet as often as
            // outside one, and a counter drawn under the sheet is a counter
            // nobody sees move.
            CoinFlightLayer()
            toast
        }
        .animation(.spring(duration: 0.35), value: store.toast)
        .environment(\.mmGlassQuality, governor.level)
    }

    @ViewBuilder private var toast: some View {
        let P = Palette.current(scheme)
        if let toast = store.toast {
            let ink = toast.isError ? Color.white : glass(P).label(increaseContrast: contrast == .increased)
            HStack(spacing: 8) {
                // A toast with a subject of its own draws it; the rest keep
                // the plain info/warning mark.
                if let glyph = toast.glyph {
                    Art.icon(glyph, size: 17, tint: ink)
                } else {
                    Image(systemName: toast.isError ? "exclamationmark.triangle.fill" : "info.circle.fill")
                }
                Text(toast.text).lineLimit(2)
            }
            .font(.system(size: 14, weight: .semibold, design: .rounded))
            .foregroundStyle(ink)
            .padding(.vertical, 11)
            .padding(.horizontal, 17)
            .modifier(ToastSurface(error: toast.isError, plate: P.bad))
            // The hub's floating tab bar sits about 45pt above the safe area,
            // and a toast landing behind it is a message nobody reads.
            .padding(.bottom, store.roomId == nil ? 78 : 24)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .id(toast.id)
        }
    }

    /// The glass a toast is made of, and so the ink its words are printed in.
    ///
    /// This window floats over anything at all, so what is behind a toast
    /// cannot be named the way a bar's backdrop can. It can be bounded,
    /// though: everything the app draws — page, card, sheet, board — sits on
    /// the same side of the crossover as the scheme, so a toast lands on
    /// paper-dark glass in a dark app and paper-light glass in a light one,
    /// and that is what it declares. Paper also keeps the live blur on, for
    /// the real pixels underneath. `.media` would have been the other name for
    /// "anything", and it is the wrong one: it pins the glass light and lays
    /// the ad dim under it, so every toast in a dark app would come up as a
    /// pale grey slab.
    private func glass(_ P: Palette) -> GlassTokens {
        BackdropKind.paper.settledGlass(P)
    }
}

/// What a toast stands on.
///
/// A note is glass: it is chrome, floating over everything, and the material
/// used to be here already — under an opaque fill that hid it completely in
/// daylight. The fill was there because the words were white; the words now
/// take the glass's own ink, so the fill can go.
///
/// An error keeps its plate. A colour that means something is a solid plate in
/// that colour on this app's glass, never a tint: tinted glass is a wash on
/// the film, and an error washed onto a note is a note — and on iOS 26 the
/// system's tint runs strong enough that ink printed on it stops being
/// readable. So it is a plate of the palette's bad with white on it — the
/// pairing every coloured control in the app uses for bad, and the plate
/// Android's error toast stands on. It was the accent's deep shade, which is
/// red on crimson but brass on the night felt and amber in the sands — an
/// error that did not look like one, with white on it at about 3:1. It takes
/// from the material what a plate takes: the same shadow, off the same token,
/// as the glass beside it.
private struct ToastSurface: ViewModifier {
    let error: Bool
    let plate: Color

    @Environment(\.colorScheme) private var scheme

    @ViewBuilder func body(content: Content) -> some View {
        if error {
            // A one-line toast's height. A second line would add a couple of
            // points of drop and nothing else — the blur is at its ceiling.
            let sh = GlassShadow.relaxed(height: 42, scheme == .dark ? .dark : .light)
            content
                .background(plate, in: Capsule())
                .shadow(color: sh.color, radius: sh.radius, y: sh.y)
        } else {
            content.mmGlass(.regular, backdrop: .paper, in: Capsule())
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @AppStorage("mm.theme") private var themeID = "felt"
    /// System / Light / Dark, chosen on the Settings tab; "system" hands the
    /// choice back to the phone.
    @AppStorage("mm.appearance") private var appearanceID = "system"
    /// Cold-launch flourish; shown exactly once per process (the theme
    /// switcher rebuilds this view's identity, which must not replay it).
    static var didSplash = false
    @State private var splashing = !RootView.didSplash
    /// One invite poll for the whole app: a friend's "come and play" has to
    /// find the player in a game as readily as on the home screen.
    @StateObject private var inviteWatch = InviteWatch()
    /// Which version of the intro this phone has been through. Zero is a phone
    /// that has never opened the app, which is the whole point of it.
    @AppStorage("mm.intro.seen") private var introSeen = 0
    /// Low Power Mode, a small phone and a hot one step the material down.
    /// Held here at the root, so the table's glass hears it as well as the
    /// hub's, and so does every sheet either of them opens. The toast window
    /// is a hosting controller of its own and listens for itself.
    @ObservedObject private var governor = MMGlassGovernor.shared

    var body: some View {
        // Feed the static before anything below reads a palette, then key the
        // whole tree on the theme so a change repaints every screen at once.
        let _: Void = { Palette.themeID = themeID }()
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

            // First run: six cards before anything else, and only once the
            // splash is out of the way — two flourishes at once is neither.
            if !splashing && introSeen < INTRO_VERSION {
                WelcomeIntro { withAnimation { introSeen = INTRO_VERSION } }
                    .zIndex(9)
            }

            if splashing {
                SplashView {
                    RootView.didSplash = true
                    splashing = false
                }
                .zIndex(10)
            }
        }
        .id(themeID)   // full repaint when the table style changes
        .onAppear {
            // A coin pack approved after the app closed still has to pay out —
            // the listener lives up here so it outlasts every screen.
            CoinShop.shared.watchTransactions(store)
            // Gives the APNs callback somewhere to deliver a device token, and
            // refreshes it for anyone who has already granted permission.
            PushRegistrar.shared.adopt(store)
            inviteWatch.start(store)
            // Access to the Apple ID can be taken away from the Settings app
            // with the game closed; this notices, at launch and on every
            // return to the front, and signs this device out of Apple.
            AppleCredentialWatch.shared.start(store)
            // Registers this install with SKAdNetwork, so a paid install can
            // be attributed to the ad that bought it. Nothing identifying
            // leaves the device — see AdSignal.swift for why that is the whole
            // measurement stack.
            AdSignal.start()
        }
        .animation(.easeInOut(duration: 0.25), value: store.roomId == nil)
        .overlay { cardPopupOverlay }
        .overlay { reliefOverlay }
        .overlay(alignment: .top) { turnBannerOverlay }
        .overlay(alignment: .top) {
            InviteBanner(watch: inviteWatch).environmentObject(store)
        }
        .animation(.spring(duration: 0.35), value: inviteWatch.invite)
        .overlay { revealOverlay }
        // The transitions above only play if the animation lives on a view
        // that CONTAINS them — hung any deeper and they simply pop in.
        .animateOverlays(store)
        // Appearance from Settings: nil hands the choice back to the system.
        .preferredColorScheme(appearance.scheme)
        // Sheets are their own presentations and on some iOS versions keep
        // following the system despite the preference above — the UIKit
        // override underneath moves every layer, open sheets included.
        .onAppear {
            ToastWindow.shared.install(store)
            applyAppearance()
        }
        .onChange(of: appearanceID) { applyAppearance() }
        // Last in the chain, outside every overlay and every sheet hung on
        // anything below, so there is nothing glass this does not reach.
        .environment(\.mmGlassQuality, governor.level)
    }

    private var appearance: MMAppearance { MMAppearance(rawValue: appearanceID) ?? .system }

    private func applyAppearance() {
        let style = appearance.uiStyle
        for scene in UIApplication.shared.connectedScenes {
            (scene as? UIWindowScene)?.windows.forEach { $0.overrideUserInterfaceStyle = style }
        }
    }

    // MARK: - overlays

    @ViewBuilder private var cardPopupOverlay: some View {
        let P = Palette.current(scheme)
        if let card = store.cardPopup {
            let isTreasure = card.deck == "treasure"
            // What the card is worth, before a word of it has been read.
            //
            // The deck's colour says which pile it came off; it says nothing
            // about whether the next three seconds are good ones. So a card
            // that pays or frees arrives green and one that charges or jails
            // arrives red, and the handful that genuinely cut both ways —
            // advance to the priciest street, which is a windfall if you own
            // it and a rent bill if you do not — keep the deck's own colours
            // rather than promise something the card cannot know.
            let accent = card.tone == "good" ? P.good
                : card.tone == "bad" ? P.bad
                : (isTreasure ? P.gold : P.red)
            let face = card.tone == "good" ? P.goodSoft
                : card.tone == "bad" ? P.badSoft
                : (isTreasure ? P.tileTreasure : P.tileSurprise)
            VStack(spacing: 10) {
                Art.icon(isTreasure ? .toolbox : .question, size: 46, tint: accent)
                Text(isTreasure ? "TREASURE" : "SURPRISE")
                    .font(.system(size: 11, weight: .bold)).kerning(2)
                    .foregroundStyle(card.tone == "good" || card.tone == "bad" ? accent : P.ink3)
                Text(card.text)
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(P.ink)
            }
            .padding(26)
            .frame(maxWidth: 320)
            .background(face, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(accent, lineWidth: 2)
            )
            .shadow(color: .black.opacity(0.35), radius: 24, y: 10)
            .transition(.scale(scale: 0.7).combined(with: .opacity))
            // Good news settles; bad news flinches. One beat, felt as well as
            // seen — it is a card, not an alarm.
            .modifier(CardFlinch(active: card.tone == "bad"))
            .onTapGesture { store.cardPopup = nil }
            .task {
                try? await Task.sleep(for: .seconds(3.2))
                withAnimation { store.cardPopup = nil }
            }
        }
    }

    /// The deadlock rule, the one time it becomes possible. Same card
    /// treatment as a Treasure draw, but it waits to be dismissed instead of
    /// timing out — it is a rule to read, not a result to glance at.
    @ViewBuilder private var reliefOverlay: some View {
        let P = Palette.current(scheme)
        if let relief = store.reliefPopup {
            ZStack {
                Color.black.opacity(0.45)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation { store.reliefPopup = nil } }

                VStack(spacing: 12) {
                    Art.icon(.scales, size: 44, tint: P.gold)
                    Text(relief.title.uppercased())
                        .font(.system(size: 11, weight: .bold)).kerning(2)
                        .foregroundStyle(P.ink3)
                    Text(relief.text)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(P.ink)
                    Text("Trading the street yourselves settles it first — the board only steps in if nobody does.")
                        .font(.system(size: 12.5, weight: .medium, design: .rounded))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(P.ink3)
                    Button("Got it") { withAnimation { store.reliefPopup = nil } }
                        .buttonStyle(MMButtonStyle(kind: .gold, big: true))
                        .padding(.top, 2)
                }
                .padding(24)
                .frame(maxWidth: 340)
                .background(P.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(P.gold, lineWidth: 2))
                .shadow(color: .black.opacity(0.4), radius: 26, y: 12)
                .padding(.horizontal, 24)
            }
            .transition(.opacity)
        }
    }

    @ViewBuilder private var revealOverlay: some View {
        let P = Palette.current(scheme)
        if let reveal = store.reveal {
            VStack(spacing: 6) {
                Text("THIS GAME")
                    .font(.system(size: 11, weight: .black)).kerning(2.5)
                    .foregroundStyle(P.gold)
                Text(reveal)
                    .font(.system(size: 18, weight: .heavy, design: .rounded))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(P.ink)
            }
            .padding(.vertical, 18)
            .padding(.horizontal, 26)
            .background(P.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(P.gold, lineWidth: 1.5))
            .shadow(color: .black.opacity(0.45), radius: 28, y: 12)
            .padding(.horizontal, 40)
            .transition(.scale(scale: 0.8).combined(with: .opacity))
        }
    }

    @ViewBuilder private var turnBannerOverlay: some View {
        let P = Palette.current(scheme)
        if let p = store.turnBanner {
            HStack(spacing: 10) {
                AvatarView(name: p.name, colorCSS: p.color, flag: p.flag ?? "", size: 30, emoji: p.avatar ?? "")
                Text(p.id == store.meId ? "Your turn!"
                     : store.isLocal(p.id) ? "Pass to \(p.name)!"
                     : "\(p.name)'s turn")
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
    /// Where a presented sheet gets its paper from.
    ///
    /// iOS 26 gives a sheet the system's own glass for nothing — but only a
    /// sheet that has not already painted over it, and until now every sheet
    /// here did, with a flat `P.sheet` or `P.page` fill inside its own body.
    /// So the fill moves out to the one place the system asks for it: below 26
    /// this lays the same colour on the sheet's platter, which is pixel for
    /// pixel what the fill used to draw, and on 26 it stands back and lets the
    /// glass through. The sheet's body paints nothing either way.
    func sheetPaper(_ paper: Color) -> some View {
        modifier(SheetPaper(paper: paper))
    }

    /// Animates the standard overlay transitions driven by the store.
    func animateOverlays(_ store: GameStore) -> some View {
        self
            .animation(.spring(duration: 0.35), value: store.toast)
            .animation(.spring(duration: 0.4), value: store.cardPopup)
            .animation(.spring(duration: 0.4), value: store.reliefPopup)
            .animation(.spring(duration: 0.4), value: store.turnBanner)
            .animation(.spring(duration: 0.45, bounce: 0.3), value: store.reveal)
    }
}

private struct SheetPaper: ViewModifier {
    let paper: Color

    /// Asked the material's way and not with a bare `#available`: an app built
    /// on an SDK older than 26 runs even a 26 phone in the old design, with no
    /// glass for the sheet to stand back for. And every control that declares
    /// `.platter` on this sheet asks the same question, so the paper and what
    /// the controls on it think they are standing on cannot disagree.
    @ViewBuilder func body(content: Content) -> some View {
        if MMSystemGlass.isOn {
            content
        } else {
            content.presentationBackground(paper)
        }
    }
}

/// The one-beat shake a bad card arrives with.
///
/// Colour alone is read by whoever is looking at the middle of the screen at
/// that second; a card that flinches is caught out of the corner of an eye
/// too, and it carries a knock of haptics with it so a player watching their
/// own money feels it without looking up at all. Good news does nothing —
/// half of every deck moving would be noise, not news.
struct CardFlinch: ViewModifier {
    let active: Bool
    @State private var shove: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .offset(x: shove)
            .task(id: active) {
                guard active else { shove = 0; return }
                try? await Task.sleep(for: .milliseconds(240))
                Haptics.warn()
                for step in [-7.0, 7.0, -4.0, 0.0] {
                    withAnimation(.easeOut(duration: 0.085)) { shove = step }
                    try? await Task.sleep(for: .milliseconds(85))
                }
            }
    }
}
