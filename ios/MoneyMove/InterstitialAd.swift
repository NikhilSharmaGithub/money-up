// The one ad that pays the player nothing.
//
// Everything else in this app trades: watch thirty seconds, take the purse
// twice, or a couple of coins. This does not. It is a full-screen break shown
// as the player sits down at a NEW table by their own tap — Play now, a
// private game of their own, a code (typed, off a friend's row, or from an
// invite), a public lobby with a seat in it — and the only thing on the other
// side of it is the table they just asked for.
//
// Which is exactly why it is held to tighter rules than the rewarded ads:
//
//   It never delays a game. It goes up after the request is already on its
//   way, the search or the lobby carries on behind it, and nothing here is
//   awaited by anything that matters. The doors back into a table that
//   already exists — Continue, a cup match, a private rematch, a push or a
//   link — never show one at all.
//
//   It is shown at the START of the wait, not the end. A break that lands in
//   the last three seconds is a break the player is still closing while their
//   first turn runs — which is the difference between an ad somebody shrugs at
//   and an ad that loses you the player.
//
//   It obeys a gap the owner sets, and refuses itself if the server has not
//   named a unit. No unit, no house fallback: a house interstitial would be a
//   full-screen advert for the game to somebody already playing it.
//
//   No tracking prompt, ever — npa=1, exactly as the rewarded path does, so
//   there is no App Tracking Transparency sheet to justify to review.

import SwiftUI
#if canImport(GoogleMobileAds)
import GoogleMobileAds
#endif

@MainActor
final class InterstitialAd: NSObject {
    static let shared = InterstitialAd()

    /// When the last one was shown on this device, so the owner's gap means
    /// something across launches rather than only within one.
    @AppStorage("mm.ads.lastInterstitial") private var lastShownAt: Double = 0

    #if canImport(GoogleMobileAds)
    private var loaded: InterstitialAd_Google?
    private var loading = false
    #endif
    private static var started = false

    /// Whether a break is due: ads on, this slot on, a unit to serve from, and
    /// the owner's gap elapsed. Asked before anything is loaded, so a player
    /// who is not due one costs Google no request and appears in no log.
    func isDue(_ config: AdsConfig?) -> Bool {
        guard let slot = config?.interstitials?["preGame"], slot.enabled == true,
              let unit = slot.unitId, !unit.isEmpty else { return false }
        let gap = Double(slot.everyMinutes ?? 0) * 60
        return Date().timeIntervalSince1970 - lastShownAt >= gap
    }

    /// Load one, quietly, so it is ready the moment it is wanted. Safe to call
    /// when nothing is due: it returns without touching the network.
    func preload(_ config: AdsConfig?) {
        #if canImport(GoogleMobileAds)
        guard isDue(config), !loading, loaded == nil,
              let unit = config?.interstitials?["preGame"]?.unitId, !unit.isEmpty else { return }
        loading = true
        Self.startOnce()
        let request = Request()
        // Contextual, never profiled — the same extra the rewarded path sends.
        let extras = Extras()
        extras.additionalParameters = ["npa": "1"]
        request.register(extras)
        InterstitialAd_Google.load(with: unit, request: request) { [weak self] ad, _ in
            Task { @MainActor in
                self?.loading = false
                self?.loaded = ad
            }
        }
        #endif
    }

    /// The one door every new table goes through, called at the tap and after
    /// the request is on its way: Play now, "Create a private game", a code
    /// typed or handed over by a friend, and a public lobby with a seat in it.
    ///
    /// The doors that lead back to a table that already exists never call it —
    /// Continue and the History list, every way into a cup match (a cup table
    /// is never late), the private rematch (everyone waits on whoever pressed
    /// it) and anything opened from a push or a link, which usually lands in a
    /// live game and finds nothing loaded at a cold start anyway.
    static func beforeGame() {
        shared.showIfReady(AdDesk.shared.config)
    }

    /// Show it if one is ready. Returns immediately either way — nothing about
    /// the game waits on this.
    func showIfReady(_ config: AdsConfig?) {
        #if canImport(GoogleMobileAds)
        guard isDue(config), let ad = loaded else { return }
        // Taken at the tap, so two taps in one breath cannot spend it twice.
        loaded = nil
        Task { await presentWhenSettled(ad) }
        #endif
    }

    #if canImport(GoogleMobileAds)
    /// The tap that asks for a break has often just closed something too — the
    /// friends list on "Join their table", the results on "Play again" — and
    /// UIKit will not present over a screen on its way out. The break would be
    /// spent and the owner's gap restarted with nobody having seen a thing. So
    /// the tap's own changes get a beat to begin, anything still sliding is
    /// waited out, and it goes up over whatever is left standing. Two seconds
    /// with nowhere steady to stand and it is kept for the next table instead.
    private func presentWhenSettled(_ ad: InterstitialAd_Google) async {
        try? await Task.sleep(for: .milliseconds(150))
        for _ in 0..<20 {
            if let top = Self.topViewController(), !top.isBeingDismissed,
               !top.isBeingPresented, top.transitionCoordinator == nil {
                lastShownAt = Date().timeIntervalSince1970
                ad.present(from: top)
                return
            }
            try? await Task.sleep(for: .milliseconds(100))
        }
        if loaded == nil { loaded = ad }
    }

    /// Nothing reaches Google until something is about to be shown — the same
    /// rule the rewarded network keeps, for the same reason.
    private static func startOnce() {
        guard !started else { return }
        started = true
        MobileAds.shared.start()
    }

    private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }
    #endif
}

#if canImport(GoogleMobileAds)
/// The SDK's own type, renamed at the door so this file's class can keep the
/// name that describes what it is to the rest of the app.
private typealias InterstitialAd_Google = GoogleMobileAds.InterstitialAd
#endif
