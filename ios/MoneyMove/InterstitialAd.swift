// The one ad that pays the player nothing.
//
// Everything else in this app trades: watch thirty seconds, take the purse
// twice, or a couple of coins. This does not. It is a full-screen break shown
// while a quick match is being found, and the only thing on the other side of
// it is the game the player was already waiting for.
//
// Which is exactly why it is held to tighter rules than the rewarded ads:
//
//   It never delays the game. The search runs behind it and the table opens on
//   its own schedule whether or not an ad is still on screen. Nothing here is
//   awaited by anything that matters.
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

    /// Show it if one is ready. Returns immediately either way — nothing about
    /// the game waits on this.
    func showIfReady(_ config: AdsConfig?) {
        #if canImport(GoogleMobileAds)
        guard isDue(config), let ad = loaded, let root = Self.topViewController() else { return }
        loaded = nil
        lastShownAt = Date().timeIntervalSince1970
        ad.present(from: root)
        #endif
    }

    #if canImport(GoogleMobileAds)
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
