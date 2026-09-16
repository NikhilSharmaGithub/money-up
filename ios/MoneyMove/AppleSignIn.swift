// Sign in with Apple, the parts the system button does not do on its own.
//
// The button on the Play tab used to hand the server nothing but Apple's user
// id, and the server believed it. That was two problems at once. Anyone who
// could type a string could mark a profile "signed in" — which is what unlocks
// the daily coins and a seat in a cup — and the server never held anything it
// could hand back to Apple when a player left. Apple asks (guideline 5.1.1(v))
// that deleting an account also revokes the app's access to the Apple ID, and
// revoking needs a token only Apple's token endpoint gives out, in exchange for
// the one-time authorization code the sheet returns.
//
// So a sign-in now carries the signed identity token, that authorization code,
// and the raw nonce whose hash rode into the token — the server checks Apple's
// signature, trades the code for a refresh token and keeps it for exactly one
// job. Everything here is the phone's half of that: minting the nonce, running
// the sheet when there is no button to press (deleting an account whose token
// never made it to the server), and noticing when the player pulls MoneyMove's
// access from the Settings app, so this device stops claiming a sign-in Apple
// no longer stands behind.

import AuthenticationServices
import CryptoKit
import SwiftUI
import UIKit

// MARK: - nonce

/// A fresh secret per sheet. The raw value stays on the phone until the
/// sign-in is posted; only its SHA-256 goes to Apple, which signs it into the
/// identity token. The server hashes what it is sent and compares — so a token
/// lifted from some other sign-in, without the raw value that goes with it, is
/// worth nothing.
enum AppleNonce {
    /// The base64url alphabet: 64 symbols, so a byte modulo the count lands on
    /// every one of them equally often and nothing needs escaping in JSON.
    private static let charset = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")

    static func make() -> (raw: String, hashed: String) {
        let raw = random(length: 32)
        return (raw, sha256hex(raw))
    }

    /// 32 symbols of 6 bits each. SecRandomCopyBytes essentially never fails;
    /// if it ever does, the system generator (also cryptographically secure on
    /// Apple platforms) fills in rather than handing Apple a predictable nonce.
    private static func random(length: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: length)
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
            var system = SystemRandomNumberGenerator()
            bytes = bytes.map { _ in UInt8.random(in: .min ... .max, using: &system) }
        }
        return String(bytes.map { charset[Int($0) % charset.count] })
    }

    /// Lowercase hex, the exact spelling the server recomputes and compares.
    static func sha256hex(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - the sheet, without a button

/// Runs Apple's sign-in sheet from code and answers with the credential.
///
/// The SwiftUI button covers signing in. Deleting an account needs the same
/// sheet with no button in sight: when the server holds no token for this
/// player (they signed in on an older build, or Apple's token endpoint was
/// down at the time) the only way to revoke anything is a fresh authorization
/// code, and the only way to get one is to ask Apple again. The controller is
/// a delegate dance; this turns it into one `await`.
@MainActor
final class AppleAuthorizer: NSObject, ASAuthorizationControllerDelegate,
                             ASAuthorizationControllerPresentationContextProviding {
    enum Failure: Error {
        /// The player closed the sheet — an answer, not an error to report.
        case cancelled
        /// Apple answered with something that is not an Apple ID credential.
        case noCredential
    }

    private var continuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>?
    /// The controller only holds its delegate weakly, and nothing else holds
    /// the controller, so both have to be kept somewhere while the sheet is up.
    private var controller: ASAuthorizationController?
    /// This object, kept alive by itself until Apple has answered. Cleared in
    /// `finish`, which is what lets it go.
    private var keepAlive: AppleAuthorizer?

    /// Shows the sheet and waits for it. Throws `Failure.cancelled` when the
    /// player backs out, or whatever Apple reported when it could not finish.
    static func authorize(hashedNonce: String) async throws -> ASAuthorizationAppleIDCredential {
        try await AppleAuthorizer().run(hashedNonce: hashedNonce)
    }

    private func run(hashedNonce: String) async throws -> ASAuthorizationAppleIDCredential {
        try await withCheckedThrowingContinuation { cont in
            continuation = cont
            let request = ASAuthorizationAppleIDProvider().createRequest()
            // Same as the button: nothing is used but the stable user id, so
            // nothing else is asked for.
            request.requestedScopes = []
            request.nonce = hashedNonce
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            keepAlive = self
            controller.performRequests()
        }
    }

    /// The single exit. A continuation resumed twice is a crash and one never
    /// resumed is a deletion that hangs forever, so every path comes through
    /// here and only the first one counts.
    private func finish(_ result: Result<ASAuthorizationAppleIDCredential, Error>) {
        guard let cont = continuation else { return }
        continuation = nil
        controller = nil
        keepAlive = nil
        cont.resume(with: result)
    }

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithAuthorization authorization: ASAuthorization) {
        if let cred = authorization.credential as? ASAuthorizationAppleIDCredential {
            finish(.success(cred))
        } else {
            finish(.failure(Failure.noCredential))
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        if (error as? ASAuthorizationError)?.code == .canceled {
            finish(.failure(Failure.cancelled))
        } else {
            finish(.failure(error))
        }
    }

    /// The window the sheet hangs off: the key window of whichever scene is
    /// in front. Toasts live in a window of their own above everything (see
    /// ToastWindow) that never takes a touch, so the fallbacks skip anything
    /// that is not an ordinary window rather than presenting from that one.
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        return scene?.keyWindow
            ?? scene?.windows.first { $0.windowLevel == .normal }
            ?? scene?.windows.first
            ?? ASPresentationAnchor()
    }
}

// MARK: - the calls

extension Notification.Name {
    /// This device's sign-in changed somewhere other than the screen showing
    /// it — Apple access pulled from Settings, say — and the account card
    /// should ask the server again rather than keep drawing a stale name.
    static let mmAccountChanged = Notification.Name("mm.accountChanged")
}

extension GameStore {
    /// The Apple user id this device last signed in with. Only ever used to
    /// ask Apple whether that sign-in still stands; the server has its own,
    /// verified copy.
    static let appleUserKey = "mm.appleUser"

    /// Hand a fresh Apple credential to the server, which checks it before it
    /// believes a word of it. Everything is sent as the strings Apple issued;
    /// a missing token or code is left out rather than sent empty, so the
    /// server can tell "not given" from "given and wrong".
    func linkApple(_ cred: ASAuthorizationAppleIDCredential, rawNonce: String) async -> Bool {
        var body: [String: Any] = [
            "token": token,
            "userId": cred.user,
            "nonce": rawNonce,
            // What this device already calls itself — the sheet asks Apple
            // for no name, and the server would not take one from it anyway.
            "nickname": nickname,
        ]
        if let data = cred.identityToken, let jwt = String(data: data, encoding: .utf8) {
            body["identityToken"] = jwt
        }
        if let data = cred.authorizationCode, let code = String(data: data, encoding: .utf8) {
            body["authorizationCode"] = code
        }
        struct Reply: Decodable { var ok: Bool?; var name: String?; var code: String? }
        let reply: Reply? = try? await fetchJSON("/api/auth/apple", method: "POST", body: body)
        guard reply?.ok == true else {
            showToast("Couldn't sign in with Apple — try again.", isError: true)
            return false
        }
        if let n = reply?.name, !n.isEmpty { nickname = n }
        UserDefaults.standard.set(cred.user, forKey: Self.appleUserKey)
        return true
    }

    /// Whether Apple still stands behind the sign-in this device remembers.
    ///
    /// A player can stop MoneyMove using their Apple ID from the Settings app
    /// without ever opening the game. Nothing tells the app at the time, so it
    /// asks — at launch and whenever it comes back to the front. Only a clear
    /// "revoked" or "not found" signs the device out; an error, or Apple being
    /// unreachable, says nothing about the sign-in and changes nothing.
    func checkAppleCredential() async {
        guard let user = UserDefaults.standard.string(forKey: Self.appleUserKey), !user.isEmpty else { return }
        guard let state = try? await ASAuthorizationAppleIDProvider().credentialState(forUserID: user) else { return }
        switch state {
        case .revoked, .notFound:
            await appleAccessRemoved(user: user)
        default:
            // .authorized and .transferred both mean the sign-in stands.
            return
        }
    }

    /// Apple access is gone: take the Apple sign-in off this profile.
    ///
    /// The server is asked first what this device is signed in with, because
    /// the remembered Apple id can be older than the sign-in — Apple may
    /// already have told the server, and the player may have signed in with
    /// Google since. Signing out then would take away a sign-in that has
    /// nothing to do with Apple. Coins and friends stay either way: they
    /// belong to the device, not the sign-in.
    ///
    /// The launch check and Apple's revoked notification can both land here
    /// at once. Whichever gets past the second key check first takes the key,
    /// and the other finds it gone and stands down — one sign-out, one toast.
    func appleAccessRemoved(user: String) async {
        let defaults = UserDefaults.standard
        guard defaults.string(forKey: Self.appleUserKey) == user else { return }
        guard let me: MeInfo = try? await fetchJSON("/api/me?token=\(token)", raw: true) else { return }
        guard defaults.string(forKey: Self.appleUserKey) == user else { return }
        defaults.removeObject(forKey: Self.appleUserKey)

        if me.provider == "apple" {
            struct Reply: Decodable { var ok: Bool? }
            let reply: Reply? = try? await fetchJSON(
                "/api/auth/logout", method: "POST", body: ["token": token])
            guard reply?.ok == true else {
                // Unreachable server: remember the id again so the next time
                // the app comes to the front tries once more.
                if defaults.string(forKey: Self.appleUserKey) == nil {
                    defaults.set(user, forKey: Self.appleUserKey)
                }
                return
            }
            showToast("Signed out — Apple ID access was removed")
        }
        NotificationCenter.default.post(name: .mmAccountChanged, object: nil)
    }

    /// A fresh authorization code for deleting this account, or nil when none
    /// is needed or none could be had.
    ///
    /// Only an Apple sign-in the server holds no token for needs one — for
    /// everybody else this is a single GET and no sheet. When it is needed,
    /// the player sees Apple's sheet once more; backing out of it, or Apple
    /// failing, still deletes the account. Leaving must always be possible,
    /// and the server is simply unable to revoke what it was never given.
    func appleCodeForDeletion() async -> String? {
        guard let me: MeInfo = try? await fetchJSON("/api/me?token=\(token)", raw: true),
              me.provider == "apple", me.appleRevocable != true else { return nil }
        // A server with no Apple signing key says so, and could do nothing
        // with a code but throw it away — so the player is not shown a sheet
        // for it. Only an explicit "no" counts; a server that does not answer
        // gets the code anyway.
        struct Config: Decodable { var appleRevoke: Bool? }
        if let config: Config = try? await fetchJSON("/api/auth/config", raw: true),
           config.appleRevoke == false { return nil }
        let nonce = AppleNonce.make()
        guard let cred = try? await AppleAuthorizer.authorize(hashedNonce: nonce.hashed),
              let data = cred.authorizationCode,
              let code = String(data: data, encoding: .utf8), !code.isEmpty else { return nil }
        return code
    }
}

// MARK: - watching for revocation

/// One watcher for the whole app, started from the root view.
///
/// Apple posts a notification when a credential is revoked while the app is
/// running, and the app asks Apple directly whenever it becomes active — which
/// covers launch and every return from the Settings app, where revoking
/// actually happens. Starting twice (the root view is rebuilt when the table
/// style changes) only refreshes which store it talks to.
///
/// Both roads lead to the same question put to Apple. The notification
/// carries no user id and no time, so on its own it cannot say WHICH sign-in
/// was revoked — and it can arrive late. A player who signs out (which revokes
/// on the server) and signs straight back in with the same Apple ID would
/// otherwise have the new sign-in taken down by the notice about the old one.
/// Asking Apple about the id this device remembers gets "authorized" for the
/// new sign-in and "revoked" only for one that really is gone.
@MainActor
final class AppleCredentialWatch {
    static let shared = AppleCredentialWatch()
    private init() {}

    private weak var store: GameStore?
    private var observers: [NSObjectProtocol] = []

    func start(_ store: GameStore) {
        self.store = store
        guard observers.isEmpty else { return }
        let centre = NotificationCenter.default
        observers.append(centre.addObserver(
            forName: ASAuthorizationAppleIDProvider.credentialRevokedNotification,
            object: nil, queue: .main) { _ in
                Task { @MainActor in await AppleCredentialWatch.shared.check() }
            })
        observers.append(centre.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil, queue: .main) { _ in
                Task { @MainActor in await AppleCredentialWatch.shared.check() }
            })
        Task { await check() }
    }

    private func check() async {
        await store?.checkAppleCredential()
    }
}
