// The two things the app is ever allowed to ask a player for — a review, and
// permission to notify them — and the rules about when.
//
// Both are one-shot, both are earned rather than sprung on a stranger, and
// both wait until the player has just had a good time: the result is already
// on screen and the game is over. Apple hands an app a handful of review
// prompts a year, so the one we spend goes on a win, never a loss.

import Foundation
import StoreKit
import UIKit
import UserNotifications

// MARK: - the App Store review prompt

enum ReviewPrompt {
    private static let winsKey = "mm.lifetimeWins"
    private static let askedKey = "mm.reviewAskedVersion"

    /// Wins this device has ever taken. Counted here rather than read off the
    /// server so a player who has never signed in still gets asked at the
    /// right moment.
    static var lifetimeWins: Int { UserDefaults.standard.integer(forKey: winsKey) }

    static func noteWin() {
        UserDefaults.standard.set(lifetimeWins + 1, forKey: winsKey)
    }

    private static var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }

    /// The second win, and only once per shipped version — the same budget
    /// Apple itself enforces, kept honest on our side so a player who has
    /// already answered is never asked twice by the same build.
    static func shouldAsk(won: Bool) -> Bool {
        guard won, lifetimeWins >= 2 else { return false }
        return UserDefaults.standard.string(forKey: askedKey) != appVersion
    }

    /// Marks the version spent whether or not the system actually draws the
    /// sheet — Apple silently swallows most requests, and asking again on the
    /// next win would be the app nagging without knowing it.
    @MainActor static func ask() {
        UserDefaults.standard.set(appVersion, forKey: askedKey)
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive })
        else { return }

        if #available(iOS 18.0, *) {
            AppStore.requestReview(in: scene)
        } else {
            SKStoreReviewController.requestReview(in: scene)
        }
    }
}

// MARK: - push registration

/// Collects device tokens and hands them to POST /api/push/register.
///
/// Nothing sends yet — the server's sender is dark — so this is purely the
/// groundwork: ask once, after the player has actually finished a game, and
/// keep the token fresh for whenever the lights come on.
@MainActor
final class PushRegistrar {
    static let shared = PushRegistrar()
    private init() {}

    private static let gamesKey = "mm.gamesFinished"
    private static let askedKey = "mm.pushAsked"

    /// Somewhere to send the token. Weak because the store outlives every
    /// screen anyway — this must never be the thing keeping it alive.
    private weak var store: GameStore?
    /// A token that arrived before the store did, held for one handover.
    private var pending: String?

    /// A game this device saw through to its ending. Walking out early is not
    /// one — the ask is a reward for finishing, not for leaving.
    static func noteFinishedGame() {
        let defaults = UserDefaults.standard
        defaults.set(defaults.integer(forKey: gamesKey) + 1, forKey: gamesKey)
    }

    /// Called once from the root view. Also re-registers for anyone who has
    /// already said yes: APNs can rotate a device token at any time, and a
    /// stale one on the server is a notification nobody receives.
    func adopt(_ store: GameStore) {
        self.store = store
        if let pending { send(pending) }
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            if settings.authorizationStatus == .authorized {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// The permission sheet, at most once in this app's life on this device.
    /// A player who says no is never asked again by us — the Settings app is
    /// the only way back, exactly as it should be.
    func askAfterFirstGame() async {
        let defaults = UserDefaults.standard
        guard defaults.integer(forKey: Self.gamesKey) >= 1,
              !defaults.bool(forKey: Self.askedKey) else { return }

        let centre = UNUserNotificationCenter.current()
        let settings = await centre.notificationSettings()
        // Already answered — in either direction — on some earlier install.
        guard settings.authorizationStatus == .notDetermined else {
            defaults.set(true, forKey: Self.askedKey)
            if settings.authorizationStatus == .authorized {
                UIApplication.shared.registerForRemoteNotifications()
            }
            return
        }

        defaults.set(true, forKey: Self.askedKey)
        let granted = (try? await centre.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// APNs answered. The token is bytes; the server wants the hex.
    func received(deviceToken: Data) {
        send(deviceToken.map { String(format: "%02x", $0) }.joined())
    }

    private func send(_ hex: String) {
        guard let store else { pending = hex; return }
        pending = nil
        Task {
            struct Reply: Decodable { var ok: Bool? }
            let _: Reply? = try? await store.fetchJSON(
                "/api/push/register", method: "POST",
                body: ["token": store.token, "deviceToken": hex, "platform": "ios"])
        }
    }
}
