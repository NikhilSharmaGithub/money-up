import Foundation
import SwiftUI

/// "Did you know?" — the place facts under a street's deed (GET /api/facts).
///
/// The last set is kept in Caches with its version and read from at once, then
/// revalidated once per launch with If-None-Match, so an unchanged set costs a
/// 304. No route (an older server), no network, a set that will not decode:
/// all the same to the deed — it shows no fact, never an error.
@MainActor
final class PlaceFacts: ObservableObject {
    static let shared = PlaceFacts()

    struct Payload: Codable {
        var version: String
        var places: [String: String]
        var groups: [String: String]
    }

    @Published private(set) var facts: Payload?
    private var checked = false

    private static var file: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appending(path: "place-facts.json")
    }

    private init() {
        if let file = Self.file, let data = try? Data(contentsOf: file) {
            facts = try? JSONDecoder().decode(Payload.self, from: data)
        }
    }

    /// The street's own fact and its country's, by "<name>|<group>" exactly as
    /// the board sends them. Nil for anything that is not a street, or when
    /// there is neither.
    func lookup(_ tile: TileData) -> (place: String?, group: String?)? {
        guard tile.type == "property", let group = tile.group, let facts else { return nil }
        let place = facts.places["\(tile.name)|\(group)"]
        let about = facts.groups[group]
        return place == nil && about == nil ? nil : (place, about)
    }

    /// Fetches (or revalidates) the set, once per launch that reaches the server.
    func load(from server: URL?) async {
        guard !checked, let server else { return }
        checked = true
        var req = URLRequest(url: server.appending(path: "/api/facts"))
        if let version = facts?.version { req.setValue("\"\(version)\"", forHTTPHeaderField: "If-None-Match") }
        // Our own cache is the one that counts; URLSession's would answer the
        // revalidation itself and hide a 304 behind a stale 200.
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, res) = try? await URLSession.shared.data(for: req) else {
            checked = false // offline: the next deed opened asks again
            return
        }
        guard (res as? HTTPURLResponse)?.statusCode == 200,
              let fresh = try? JSONDecoder().decode(Payload.self, from: data) else { return }
        facts = fresh
        if let file = Self.file { try? data.write(to: file, options: .atomic) }
    }
}
