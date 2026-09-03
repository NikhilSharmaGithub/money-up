// Google's half of the rewarded break.
//
// AdOffer.swift owns the loop that matters — offer, watch, claim — and this
// file is only ever the middle of it: the thirty seconds in which a real
// network gets to fill a slot the house would otherwise fill itself. Nothing
// here decides what a view is worth and nothing here moves a coin. The ticket
// does that, at the gateway, and on AdMob the gateway waits for Google's own
// server-side callback before it believes anybody.
//
// Three rules the rest of the app leans on:
//
//   Nothing reaches Google until something is about to be shown. `start` runs
//   once per process and only from inside `show`, one line before the ad it
//   was asked for, so a player who never taps an offer resolves no ad server
//   and appears in nobody's logs — verified with a socket log, not by reading:
//   a launch on a dark server opens connections to this game's own host and to
//   nothing else. What linking the SDK does cost, unconditionally, is a few
//   empty directories under Application Support at launch. That is the honest
//   line: dormant on the network, not absent from the process.
//
//   No tracking prompt, ever. Every request carries npa=1 — Google's own
//   extra for "serve a contextual ad, not a profiled one" — so there is no
//   App Tracking Transparency sheet and no consent flow to build or to
//   explain to review. Not one line of this app reads an advertising id; the
//   SDK links AdSupport and will ask the system for one, and without an ATT
//   prompt the system hands it a zeroed id, which is the point. It pays less
//   than a personalised ad. It also costs the player nothing and the
//   submission one fewer argument — but the SDK's own privacy manifest still
//   declares an advertising identifier, so the App Privacy answers have to be
//   redone the first build this ships in. See the go-live checklist.
//
//   A break that cannot be filled is still a break that was promised. Every
//   way this file can fail — no id, no fill, a load that hangs, a
//   presentation the system refuses — comes back as `.unavailable`, and the
//   caller puts the house ad up in its place. That mirrors the server, which
//   picks the house adapter by exactly the same reasoning the moment AdMob
//   cannot serve.

import SwiftUI
#if canImport(GoogleMobileAds)
import GoogleMobileAds
#endif

// MARK: - how a network break ended

/// The three answers a network ad can give. There is deliberately no "paid"
/// case: what a view was worth is the gateway's ruling, never this file's.
enum NetworkAdOutcome {
    /// Google's SDK reported the reward earned. The claim is worth making.
    case earned
    /// A real ad played and was closed before it earned anything.
    case dismissed
    /// Nothing played. The caller still owes the player their break.
    case unavailable
}

// MARK: - the SDK, held at arm's length

@MainActor
final class RewardedAdNetwork {
    static let shared = RewardedAdNetwork()
    private init() {}

    /// How long a fill is worth waiting for before the slot goes back to the
    /// house. Google's own load times out eventually; this is the number that
    /// decides how long a player stares at a spinner if it doesn't.
    private static let loadTimeout: Double = 12

    /// How long a presentation that has gone up gets to report coming down.
    /// Not a fill timeout — the ad is on screen and the player is watching it,
    /// so this is only ever the answer to "the SDK has stopped talking to us".
    /// Matched to the gateway's five-minute ticket: past that there is nothing
    /// left to redeem, so there is nothing left to wait for.
    private static let stuckTimeout: Double = 300

    /// Whether the SDK has been started this process. Set before the await, so
    /// two offers tapped together cannot both start it.
    private var started = false

    /// The ad and its delegate, held only for the length of one break — the
    /// SDK keeps the delegate weakly, and the function that installed it has
    /// already returned by the time the ad is on screen.
    #if canImport(GoogleMobileAds)
    private var showing: RewardedAd?
    private var watcher: BreakWatcher?
    #endif

    /// Loads one rewarded ad for `unitId` and puts it on screen.
    ///
    /// `customData` is the gateway's nonce, handed to Google so that its
    /// server-side callback can name the ticket it is confirming. Without it a
    /// confirmed view would arrive at /api/ads/ssv pointing at nothing and the
    /// claim would never be paid — so a break with no nonce is still shown,
    /// but it is Google's own SSV setting that ties it to a coin.
    ///
    /// `userId` is the tag the gateway derived from that same nonce and will
    /// check the callback against. It is deliberately not the identity token:
    /// a value that ends up in an ad network's logs must not be one that can
    /// spend coins.
    func show(unitId: String, customData: String, userId: String = "") async -> NetworkAdOutcome {
        #if canImport(GoogleMobileAds)
        let unit = unitId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !unit.isEmpty, Self.appIdUsable, let host = Self.topViewController() else {
            return .unavailable
        }
        await startOnce()
        guard let ad = await load(unit) else { return .unavailable }

        if !customData.isEmpty || !userId.isEmpty {
            let options = ServerSideVerificationOptions()
            // Objective-C calls this customRewardString; it arrives at our
            // callback as `custom_data`, which is what /api/ads/ssv reads to
            // find the ticket. `userIdentifier` arrives beside it as
            // `user_id`, and the gateway refuses a callback whose tag does not
            // match the ticket it claims to confirm.
            if !customData.isEmpty { options.customRewardText = customData }
            if !userId.isEmpty { options.userIdentifier = userId }
            ad.serverSideVerificationOptions = options
        }
        return await present(ad, from: host)
        #else
        // The package isn't in this build. Every offer is a house ad, and the
        // app is exactly what it was before Google was ever mentioned.
        return .unavailable
        #endif
    }
}

// MARK: - the application id

extension RewardedAdNetwork {
    /// The AdMob application id, as this build carries it.
    ///
    /// It is not a secret — it ships inside every app that serves AdMob and
    /// anyone can read it out of the binary — but the SDK treats a missing or
    /// malformed one as a programming error and raises an Objective-C
    /// exception, which would turn "the owner hasn't pasted his id in yet"
    /// into a crash the first time somebody taps an offer. So it is never
    /// written in source: it lives in the ADMOB_APP_ID build setting and
    /// Info.plist names it as $(ADMOB_APP_ID). Changing which account this
    /// build belongs to is therefore one line of build settings and no source
    /// change at all — and because the plist always carries a syntactically
    /// valid value, a misconfigured build degrades to the house ad by the
    /// check below rather than raising an exception nobody can catch.
    private static var appId: String {
        let raw = Bundle.main.object(forInfoDictionaryKey: "GADApplicationIdentifier") as? String
        return (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Whether that id is one the SDK will accept. Checked before anything is
    /// started, because the alternative to checking is an exception Swift
    /// cannot catch, in front of a player who wanted two coins. An unexpanded
    /// "$(ADMOB_APP_ID)" fails this the same way an empty string does.
    private static var appIdUsable: Bool {
        appId.hasPrefix("ca-app-pub-") && appId.contains("~")
    }
}

#if canImport(GoogleMobileAds)

// MARK: - starting, loading, presenting

extension RewardedAdNetwork {
    /// Starts the SDK once, and never a moment before an ad is wanted.
    private func startOnce() async {
        guard !started else { return }
        started = true
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            let answer = OneAnswer(cont)
            // Google's start reports back when every mediation adapter is up
            // *or* set-up times out, so this normally answers itself. The
            // stopwatch is here because an ad that never loads is a house ad,
            // while a start that never returns is a spinner for ever.
            let clock = Task {
                try? await Task.sleep(for: .seconds(Self.loadTimeout))
                answer.settle(())
            }
            MobileAds.shared.start { _ in
                clock.cancel()
                answer.settle(())
            }
        }
    }

    /// One ad request, non-personalised.
    ///
    /// npa=1 is the documented Google extra for a contextual ad. It is the
    /// whole reason this app asks for no IDFA and shows no ATT prompt: there
    /// is nothing about the player being used, so there is nothing to get
    /// consent for. Personalised ads pay better — that switch is Google's UMP
    /// SDK plus an ATT sheet, and a decision for the day the revenue is worth
    /// the extra screen.
    private static func request() -> Request {
        let request = Request()
        let extras = Extras()
        extras.additionalParameters = ["npa": "1"]
        request.register(extras)
        return request
    }

    /// A fill, or nil and the house takes the slot back.
    private func load(_ unit: String) async -> RewardedAd? {
        await withCheckedContinuation { cont in
            let answer = OneAnswer<RewardedAd?>(cont)
            let clock = Task {
                try? await Task.sleep(for: .seconds(Self.loadTimeout))
                answer.settle(nil)
            }
            Task {
                // Every load failure is the same failure from here: no fill,
                // a bad unit id, an account that isn't approved yet, no
                // network. All of them mean the house shows the break.
                let ad = try? await RewardedAd.load(with: unit, request: Self.request())
                clock.cancel()
                answer.settle(ad)
            }
        }
    }

    /// Puts the ad up and waits out the break.
    private func present(_ ad: RewardedAd, from host: UIViewController) async -> NetworkAdOutcome {
        let outcome: NetworkAdOutcome = await withCheckedContinuation { cont in
            let answer = OneAnswer(cont)
            let watcher = BreakWatcher(answer)
            // Both held on self: the SDK keeps the delegate weakly, and this
            // function returns while the ad is still on screen — which is the
            // entire point of the continuation.
            self.watcher = watcher
            self.showing = ad
            ad.fullScreenContentDelegate = watcher
            // The last await in this file without a stopwatch beside it, and
            // the worst one to leave without: a presentation that goes up and
            // never reports coming down parks the whole offer loop, and the
            // button that started it spins for the rest of the session. The
            // bound is the ticket's own lifetime rather than a fill timeout —
            // a rewarded ad plus its end card is a minute, and a player who
            // has genuinely sat through five is past anything the gateway
            // would still redeem.
            //
            // It answers `.unavailable` even if the reward had already fired,
            // and that is the generous answer rather than the mean one: the
            // caller shows the house break instead, and the claim that follows
            // still carries the same ticket — which, on AdMob, Google's
            // callback has by then already confirmed. A wedged SDK costs the
            // player five seconds of house ad, not their coin.
            let clock = Task {
                try? await Task.sleep(for: .seconds(Self.stuckTimeout))
                answer.settle(.unavailable)
            }
            watcher.onSettled = { clock.cancel() }
            ad.present(from: host) { [weak watcher] in
                // userDidEarnReward. Google's server-side callback is already
                // on its way to /api/ads/ssv carrying the nonce; this only
                // records that the claim is now worth making.
                watcher?.earned = true
            }
        }
        self.watcher = nil
        self.showing = nil
        return outcome
    }

    /// The controller Google's full-screen ad is put in front of. SwiftUI has
    /// no view controller to hand over, so the foreground window's root is
    /// found and walked up through whatever is presented on top of it — a
    /// sheet, a cover, the game over screen the offer was tapped on.
    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        var top = scene?.keyWindow?.rootViewController ?? scene?.windows.first?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }
}

// MARK: - the break, while it is on screen

/// Watches one presentation and reports how it ended, exactly once.
private final class BreakWatcher: NSObject, FullScreenContentDelegate {
    /// Set by the reward handler, read when the ad comes down. The order is
    /// the SDK's own: the reward fires while the ad is still up, the dismissal
    /// after, and a break that never earned anything only ever dismisses.
    var earned = false
    /// Called on whichever answer arrives first, so the watchdog behind this
    /// break can stand down instead of sleeping out its five minutes.
    var onSettled: (() -> Void)?
    private let answer: OneAnswer<NetworkAdOutcome>

    init(_ answer: OneAnswer<NetworkAdOutcome>) { self.answer = answer }

    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        answer.settle(earned ? .earned : .dismissed)
        onSettled?()
    }

    func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        // Nothing reached the screen, so nothing was spent: the house takes it
        // and the player still gets the break they were offered.
        answer.settle(.unavailable)
        onSettled?()
    }
}

#endif

// MARK: - answering once

/// A continuation that can only ever be answered once, whichever racer gets
/// there first.
///
/// Every await in this file has a stopwatch beside it. An SDK callback that
/// never arrives would otherwise park the whole offer loop for the rest of the
/// session and leave the button that started it spinning for good — and this
/// file's one promise to the rest of the app is that it can always be replaced
/// by the house ad the moment it stops answering. Resuming twice traps, so the
/// swap is done under a lock rather than trusted to arrive on one thread.
private final class OneAnswer<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var cont: CheckedContinuation<T, Never>?

    init(_ cont: CheckedContinuation<T, Never>) { self.cont = cont }

    func settle(_ value: T) {
        lock.lock()
        let waiting = cont
        cont = nil
        lock.unlock()
        waiting?.resume(returning: value)
    }
}
