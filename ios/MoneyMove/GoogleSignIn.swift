// Sign in with Google, done by hand: an ASWebAuthenticationSession pointed at
// Google's OAuth endpoint, no SDK. The server verifies the returned ID token
// (/api/auth/google) exactly as it does for the web client, so this file only
// has to get the token and hand it over.
//
// It asks for a code, not a token. The obvious shape for a native app is the
// implicit flow — response_type=id_token, one round trip, nothing to exchange
// — and it is the shape this file had until Google answered a real sign-in
// with "Error 400: unsupported_response_type". Google closed the implicit
// flow to installed apps; the supported shape is an authorization code with
// PKCE, which is two round trips and a verifier but needs no client secret,
// which is exactly why it is the one they kept.
//
// The button that drives this lives on the Play tab and is gated behind
// GET /api/auth/config — a server with no Google client id shows no button,
// same as the web. NOTE: the flow can only complete end to end once the
// operator creates an iOS OAuth client id in Google Cloud; a web client id
// refuses custom-scheme redirects at Google's door.

import AuthenticationServices
import CryptoKit
import SwiftUI
import UIKit

/// What GET /api/auth/config answers; mirrors the web client's gate.
struct AuthConfig: Decodable {
    var google: Bool?
    var googleClientId: String?
    /// The native app's own OAuth client — a web client id refuses the
    /// custom-scheme redirect an app needs, so the server hands out both.
    var googleIosClientId: String?

    var googleReady: Bool { google == true && !(appClientId ?? "").isEmpty }
    /// What THIS platform should hand to Google.
    var appClientId: String? { googleIosClientId ?? googleClientId }
}

/// Who this device is (GET /api/me) — the profile card's whole content.
/// One rewarded slot's terms, as the server states them. Everything is
/// optional: a server older than this app answers with fewer fields, and a
/// missing number must read as "it didn't say", never as zero.
struct AdPlacement: Decodable, Equatable {
    var enabled: Bool?
    /// "grant" pays a flat purse; "multiplier" pays a win again.
    var kind: String?
    var coins: Int?
    var factor: Double?
    var dailyCap: Int?
    /// Views this device may still be PAID for today. Zero shuts the slot.
    var remaining: Int?
    var unitId: String?
}

/// Rewarded-ads switchboard, fetched from /api/ads/config. Ships dark —
/// while `enabled` is false no ad UI exists anywhere in the app.
///
/// The first two fields are the ones the first shipped build read, and they
/// still mean what they meant; the per-slot terms arrived alongside them.
struct AdsConfig: Decodable, Equatable {
    var enabled: Bool?
    var provider: String?
    var placements: [String: AdPlacement]?
    /// Breaks that pay nothing — see InterstitialAd.swift. Only ever named
    /// when ads are on, the slot is on and a unit exists to serve from.
    var interstitials: [String: Interstitial]?
    var remaining: [String: Int]?

    struct Interstitial: Decodable, Equatable {
        var enabled: Bool?
        var everyMinutes: Int?
        var unitId: String?
    }

    var live: Bool { enabled == true }

    /// The slot's terms, or nil when it must not be offered at all: ads off,
    /// this slot off, or nothing left in it today. Asking here is how a view
    /// decides both whether to draw a button and whether to let it be pressed.
    func slot(_ name: String) -> AdPlacement? {
        guard live, let p = placements?[name], p.enabled != false else { return nil }
        if let n = p.remaining ?? remaining?[name], n <= 0 { return nil }
        return p
    }
}

struct MeInfo: Decodable, Equatable {
    var code: String?
    var name: String?
    var flag: String?
    var coins: Int?
    var karma: Int?
    /// "google" | "apple" | nil — nil means not signed in.
    var provider: String?
    var email: String?
    var picture: String?

    var signedIn: Bool { provider != nil }
}

@MainActor
final class GoogleSignInFlow: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = GoogleSignInFlow()

    enum Failure: Error {
        case badClientId
        case cancelled
        case noToken
    }

    /// Held so the sheet isn't torn down while the user is mid-consent.
    private var session: ASWebAuthenticationSession?

    /// The custom scheme Google assigns an iOS OAuth client: the client id
    /// reversed. "123-abc.apps.googleusercontent.com" becomes
    /// "com.googleusercontent.apps.123-abc". Derived at runtime so a new
    /// client id on the server needs no app update to be honoured here.
    static func callbackScheme(for clientId: String) -> String? {
        let suffix = ".apps.googleusercontent.com"
        guard clientId.hasSuffix(suffix) else { return nil }
        let bare = String(clientId.dropLast(suffix.count))
        guard !bare.isEmpty else { return nil }
        return "com.googleusercontent.apps." + bare
    }

    /// Runs the whole browser dance and returns Google's ID token (the
    /// "credential" the server verifies). Throws .cancelled when the player
    /// closes the sheet.
    func signIn(clientId: String) async throws -> String {
        guard let scheme = Self.callbackScheme(for: clientId) else { throw Failure.badClientId }
        let redirect = scheme + ":/oauth2redirect"
        // The proof this app is the one that asked. The verifier stays here;
        // only its hash goes to Google, so a code stolen out of the callback
        // is worth nothing without this process.
        let verifier = Self.randomVerifier()
        let challenge = Self.challenge(for: verifier)
        // The nonce rides into the signed token; generating a fresh one per
        // attempt keeps a replayed token from ever looking new.
        let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "")

        var comps = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        comps.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "prompt", value: "select_account"),
        ]
        guard let url = comps.url else { throw Failure.badClientId }

        let code: String = try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callback, error in
                if let callback, let code = Self.value("code", in: callback) {
                    cont.resume(returning: code)
                } else if let error, (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                    cont.resume(throwing: Failure.cancelled)
                } else {
                    cont.resume(throwing: Failure.noToken)
                }
            }
            session.presentationContextProvider = self
            self.session = session
            if !session.start() {
                // start() failing means the completion above never runs.
                cont.resume(throwing: Failure.cancelled)
            }
        }
        return try await Self.exchange(code: code, verifier: verifier, clientId: clientId, redirect: redirect)
    }

    /// Trade the code for the tokens. An installed app has no client secret —
    /// the verifier is what stands in for one, which is the whole point of
    /// PKCE — so this call carries no credential worth stealing.
    private static func exchange(code: String, verifier: String,
                                 clientId: String, redirect: String) async throws -> String {
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "code_verifier", value: verifier),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "redirect_uri", value: redirect),
        ]
        req.httpBody = form.percentEncodedQuery?.data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: req)
        struct Reply: Decodable { var id_token: String? }
        guard let token = (try? JSONDecoder().decode(Reply.self, from: data))?.id_token, !token.isEmpty else {
            throw Failure.noToken
        }
        return token
    }

    /// 64 random bytes, base64url — comfortably inside the 43–128 characters
    /// the spec allows, and nothing in it needs escaping in a form body.
    private static func randomVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 64)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return base64url(Data(bytes))
    }

    private static func challenge(for verifier: String) -> String {
        base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    private static func base64url(_ d: Data) -> String {
        d.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// The code comes back in the query ("scheme:/oauth2redirect?code=…");
    /// the fragment is read too, since it cost nothing to keep.
    private static func value(_ name: String, in url: URL) -> String? {
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        for raw in [comps?.query, comps?.fragment].compactMap({ $0 }) {
            for pair in raw.split(separator: "&") {
                let parts = pair.split(separator: "=", maxSplits: 1)
                if parts.count == 2, parts[0] == name {
                    return String(parts[1]).removingPercentEncoding ?? String(parts[1])
                }
            }
        }
        return nil
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }
                ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            return scene?.keyWindow ?? scene?.windows.first ?? ASPresentationAnchor()
        }
    }
}
