// Sign in with Google, done by hand: an ASWebAuthenticationSession pointed at
// Google's OAuth endpoint with response_type=id_token, no SDK. The server
// verifies the returned ID token (/api/auth/google) exactly as it does for the
// web client, so this file only has to get the token and hand it over.
//
// The button that drives this lives on the Play tab and is gated behind
// GET /api/auth/config — a server with no Google client id shows no button,
// same as the web. NOTE: the flow can only complete end to end once the
// operator creates an iOS OAuth client id in Google Cloud; a web client id
// refuses custom-scheme redirects at Google's door.

import AuthenticationServices
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
        // The nonce rides into the signed token; generating a fresh one per
        // attempt keeps a replayed token from ever looking new.
        let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "")

        var comps = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        comps.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: scheme + ":/oauth2redirect"),
            URLQueryItem(name: "response_type", value: "id_token"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "prompt", value: "select_account"),
        ]
        guard let url = comps.url else { throw Failure.badClientId }

        return try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callback, error in
                if let callback, let token = Self.tokenValue(in: callback) {
                    cont.resume(returning: token)
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
    }

    /// The implicit flow returns the token in the URL fragment
    /// ("scheme:/oauth2redirect#id_token=…"); tolerate the query too.
    private static func tokenValue(in url: URL) -> String? {
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        for raw in [comps?.fragment, comps?.query].compactMap({ $0 }) {
            for pair in raw.split(separator: "&") {
                let parts = pair.split(separator: "=", maxSplits: 1)
                if parts.count == 2, parts[0] == "id_token" {
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
