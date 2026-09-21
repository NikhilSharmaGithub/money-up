// What an ad network is allowed to learn from this app, and how little that is.
//
// Buying installs on Meta only pays if something can tell which ad led to
// which install, and which of those installs became a player worth paying
// for. Apple's SKAdNetwork does that job and nothing else: the app posts a
// small number, Apple holds it for the measurement window, and then Apple —
// not us — sends Meta a postback saying one of its ads led to an install that
// reached step N. Meta learns that a campaign works. It never learns who.
//
// Nothing identifying leaves the device here. No advertiser id, no device id,
// no nickname, no room code, no price. So there is no permission sheet to
// show, nothing to add to the App Privacy label, and nothing in the build for
// a reviewer to catch us on.
//
// Meta's own SDK was wired in first and then taken out again, on evidence:
// FacebookCore ships a PrivacyInfo.xcprivacy that declares
// NSPrivacyTracking = true and a Device ID that is linked, tracked and used
// for third-party advertising, and Xcode merges its NSPrivacyTrackingDomains
// (ep1.facebook.com) into the app's own Info.plist. Two things follow, and the
// second is the one that settles it:
//
//   1. App Store Connect builds the privacy report from those manifests, so a
//      build carrying the SDK reports that it tracks — while the declared
//      label says it does not and no ATT prompt exists. That is the standard
//      5.1.2(i) rejection, and it lands whether or not the SDK is configured.
//   2. iOS blocks requests to a declared tracking domain unless the player has
//      granted App Tracking Transparency. With no prompt, permission is never
//      granted, so the SDK's events to ep1.facebook.com never arrive. The
//      tracking declaration is paid for and nothing is bought with it.
//
// Taking the SDK route means showing an ATT prompt in a 4+ board game and
// declaring that the app tracks you. That is a decision about what the app
// tells its players, not a technical detail, so it is left to the owner —
// APPSTORE.md records exactly what would change.

import Foundation
import StoreKit

@MainActor
enum AdSignal {
    /// How far this install has climbed. One rung is posted as SKAdNetwork's
    /// fine conversion value, so the whole funnel has to fit in the 0...63
    /// Apple allows and has to read the same way in Meta's conversion-value
    /// schema — the mapping lives in docs/META-ADS.md and the two must agree
    /// or the campaign optimises towards the wrong number.
    ///
    /// The order matters more than the names: the value only ever goes up, so
    /// each rung has to be worth strictly more to us than the one below it.
    private enum Step: Int {
        case installed = 0
        /// A game that actually dealt in, alone with the bots.
        case played = 1
        /// The same, with at least one other person at the table. Worth more:
        /// people who play with people come back.
        case playedWithPeople = 2
        /// The first win — the moment a stranger turns into a player.
        case won = 3
        case boughtSmallPack = 4
        case boughtMidPack = 5
        case boughtLargePack = 6
        /// A second pack, whichever packs they were. Repeat buyers are the
        /// only population worth paying a premium for.
        case boughtAgain = 7

        /// Apple's coarse value is what Meta receives when this install is one
        /// of too few to report precisely — it has to stay readable on its own.
        var coarse: SKAdNetwork.CoarseConversionValue {
            switch self {
            case .installed, .played, .playedWithPeople: return .low
            case .won: return .medium
            default: return .high
            }
        }
    }

    /// The highest rung posted so far. Kept on the device because Apple keeps
    /// no history we can read back, and because a value that went down would
    /// tell Meta a player got worse.
    private static let reachedKey = "mm.skan.step"
    private static let registeredKey = "mm.skan.registered"

    // MARK: - launch

    /// Registers the install with SKAdNetwork, once.
    ///
    /// Posting a conversion value is what registers an app for attribution —
    /// the old registerAppForAdNetworkAttribution() is gone — so the first
    /// launch has to post something even though nothing has happened yet.
    /// Without this call there is no postback at all and a campaign reports
    /// zero installs however well it is doing.
    static func start() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: registeredKey) else { return }
        defaults.set(true, forKey: registeredKey)
        post(.installed)
    }

    // MARK: - the rungs

    /// A game that has actually dealt in — not a lobby somebody opened and
    /// left. `withPeople` means somebody at the table is neither on this phone
    /// nor a bot: one person alone with the app reads differently.
    static func playedGame(withPeople: Bool) {
        climb(to: withPeople ? .playedWithPeople : .played)
    }

    /// Won a game. Only the first one moves the value; every win after that is
    /// somebody enjoying themselves, which is not new information for a bid.
    static func wonGame() {
        climb(to: .won)
    }

    /// A coin pack Apple signed and our own server then verified and paid out.
    /// The pack is named by its rung rather than by its price: SKAdNetwork
    /// carries a number, not a currency, and a rupee figure and a dollar
    /// figure cannot share one scale.
    static func boughtCoins(productId: String) {
        let defaults = UserDefaults.standard
        // Any purchase once we are already at or past the first pack is a
        // repeat, whichever pack it was.
        if defaults.integer(forKey: reachedKey) >= Step.boughtSmallPack.rawValue {
            return climb(to: .boughtAgain)
        }
        switch productId {
        case "com.moneymove.game.coins.large": climb(to: .boughtLargePack)
        case "com.moneymove.game.coins.mid": climb(to: .boughtMidPack)
        default: climb(to: .boughtSmallPack)
        }
    }

    // MARK: - posting

    /// Raises the value, or does nothing. Every rung above is safe to call as
    /// often as the game likes — this is the only place that decides whether
    /// anything is actually reported, which is why the call sites can stay
    /// plain statements of what just happened.
    private static func climb(to step: Step) {
        let defaults = UserDefaults.standard
        guard step.rawValue > defaults.integer(forKey: reachedKey) else { return }
        defaults.set(step.rawValue, forKey: reachedKey)
        defaults.set(true, forKey: registeredKey)
        post(step)
    }

    private static func post(_ step: Step) {
        SKAdNetwork.updatePostbackConversionValue(step.rawValue, coarseValue: step.coarse) { error in
            #if DEBUG
            if let error {
                print("SKAdNetwork refused step \(step.rawValue): \(error.localizedDescription)")
            } else {
                print("SKAdNetwork: step \(step.rawValue)")
            }
            #endif
        }
    }
}
