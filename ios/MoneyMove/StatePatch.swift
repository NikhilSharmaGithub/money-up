// The client half of server/delta.js, in Swift.
//
// The server re-sends the whole board to every viewer on every action — about
// thirteen kilobytes, thirty-odd times a minute — and almost none of it has
// moved since the lobby. The map is the same map. The group table is the same
// table. A socket that says `proto: 2` at the door gets one full state and
// then only what changed; putting those back together is all this file does.
//
// It decodes nothing. It keeps the last state as the JSON the socket parsed,
// patches that, and gives the rebuilt state back for exactly the JSONDecoder
// pass a full push has always taken. The GameState that reaches the store is
// the same GameState a full state would have made, so the choreography, the
// walker and every view never learn anything changed.
//
// ---------------------------------------------------------------- the shape
//
// A patch for an object is an object with up to three members, all optional:
//
//   { s: { key: value },    set: this key is now exactly this value
//     p: { key: patch },    patch: recurse, both sides are objects
//     d: [ key ] }          drop: this key is gone
//
// and `{ $: value }` at the root for a wholesale replacement. Real state keys
// only ever live inside `s`, `p` or `d`, so a key called "s" can never be
// mistaken for the envelope.
//
// Every function here answers nil for a patch it cannot honestly apply. There
// is no half-applied state anywhere in this file: the caller either gets a
// state it can trust or an admission that only a fresh full one will do.
//
// --------------------------------------------------------------- and NSDict
//
// The containers are Objective-C ones on purpose, and it is worth saying why,
// because `[String: Any]` would read better. JSONSerialization hands back
// NSDictionary and NSArray, and a Swift dictionary made from one is a view
// onto it until something writes — at which point the whole thing is copied
// into native storage and then bridged back again on the way to
// `data(withJSONObject:)`. Measured on a real push, carrying just the log and
// chat feeds through `[[String: Any]]` and back cost 0.47 ms of the 0.99 ms a
// full state takes to parse and re-serialize: half again, every push, to
// launder a hundred and ten lines nobody read. Staying in NSDictionary keeps
// the untouched branches as the very objects the parser made, and a patch
// then costs a shallow copy of the top level and nothing else.

import Foundation

enum StatePatch {

    /// `next` again, from `prev` and the patch — or nil if the patch does not
    /// describe a change to this shape, in which case the thread is lost and
    /// the only honest answer is to ask for the whole state again.
    static func apply(_ prev: NSDictionary, _ patch: NSDictionary) -> NSDictionary? {
        // The root was replaced outright. Only an object can be a state; a
        // scalar arriving here means we and the server disagree about what a
        // state is, and stitching it in would be worse than starting over.
        if let whole = patch["$"] { return whole as? NSDictionary }

        // Shallow on purpose: every branch the patch never mentions stays the
        // very object it already was. Most of a state is furniture.
        let out = NSMutableDictionary(dictionary: prev)
        // Drop, set, then recurse — the same order applyPatch() uses, so a key
        // that somehow appeared in two members would land the same way at both
        // ends of the wire.
        if let drop = patch["d"] {
            guard let keys = drop as? [Any] else { return nil }
            for key in keys {
                guard let name = key as? String else { return nil }
                out.removeObject(forKey: name)
            }
        }
        if let set = patch["s"] {
            guard let values = set as? NSDictionary else { return nil }
            for (key, value) in values {
                guard let name = key as? String else { return nil }
                out[name] = value
            }
        }
        if let sub = patch["p"] {
            guard let branches = sub as? NSDictionary else { return nil }
            for (key, branch) in branches {
                // The server only ever recurses where both sides were objects.
                // If ours isn't one, our copy is not the copy it diffed.
                guard let name = key as? String,
                      let inner = branch as? NSDictionary,
                      let mine = out[name] as? NSDictionary,
                      let merged = apply(mine, inner) else { return nil }
                out[name] = merged
            }
        }
        return out
    }
}

// ------------------------------------------------------------------- feeds --
/**
 The log and the chat are the two worst offenders in a full push: sixty log
 lines and fifty chat lines re-sent for the sake of the one that is new. They
 ride as tails instead — keep the last `keep` entries you already hold, then
 append these.

 `keep` is what makes it exact rather than approximate. The server's window
 slides, and a viewer with another team's chat filtered out holds a slightly
 different slice again; trimming to sixty and fifty ourselves is how the two
 ends drift apart. Told how many of our own entries survive, we land on
 precisely the array a full state would have given us.

 `after` is the anchor — the `at` of the last log line, the `id` of the last
 chat line, whichever we are meant to be holding. If ours disagrees we have
 gapped, and stitching a hole into the scrollback is not a repair.
 */
enum StateFeed {

    static func apply(_ prev: NSArray, _ tail: NSDictionary, key: String) -> NSArray? {
        guard let keep = tail["keep"] as? Int, keep >= 0, keep <= prev.count else { return nil }
        guard same((prev.lastObject as? NSDictionary)?[key], tail["after"]) else { return nil }
        let out = NSMutableArray(array: prev.subarray(with: NSRange(location: prev.count - keep, length: keep)))
        if let arriving = tail["add"] {
            guard let lines = arriving as? NSArray else { return nil }
            for line in lines { out.add(line) }
        }
        return out
    }

    /// The one comparison the anchor needs. A log line's `at` arrives as a
    /// number and a chat line's `id` as a string; an empty feed has no last
    /// entry at all, which the server writes as null. All three are already
    /// objects, so one `isEqual` speaks for the lot.
    private static func same(_ mine: Any?, _ theirs: Any?) -> Bool {
        let a = (mine ?? NSNull()) as AnyObject
        let b = (theirs ?? NSNull()) as AnyObject
        return a.isEqual(b)
    }
}

// ------------------------------------------------------------------ mirror --
/**
 One socket's copy of what the server thinks it has been sent: the state minus
 its two feeds (the half the server actually diffs), the feeds themselves, and
 the version every patch is measured from.

 Nothing is committed until the whole patch has landed. A patch that fails
 halfway leaves the mirror exactly where it was, still holding the last state
 it can vouch for, and asks for a resync — which is the difference between a
 client that recovers and one that quietly renders a board that never existed.
 */
@MainActor
final class StateMirror {

    /// The one word a client says to get patches instead of whole states. It
    /// rides the `join` payload rather than a handshake of its own, so it goes
    /// out again on every reconnect for free — and so saying nothing keeps its
    /// old meaning for the build sitting in review.
    static let protocolVersion = 2

    /// What a `statePatch` came to.
    enum Step {
        /// Rebuilt and whole — decode it exactly like a full push.
        case state(NSDictionary)
        /// A feeds-only mirror moved; read `chatArrivals`.
        case feeds
        /// The thread is lost. Only a fresh full state picks it back up.
        case resync
    }

    /// The state without `log` and `chat` — precisely what the server diffs.
    private var lean: NSDictionary = [:]
    private var log: NSArray = []
    private var chat: NSArray = []
    /// nil until the first full state; a patch before that has nothing to sit on.
    private var version: Int?

    /// A pass & play guest's socket is only ever read for its team chat — the
    /// main connection carries the state everyone can see. So a guest's mirror
    /// keeps the feeds and the version and lets the rest of the patch go by
    /// unapplied: it would cost a rebuild a push to hold a state nobody reads.
    private let feedsOnly: Bool

    init(feedsOnly: Bool = false) { self.feedsOnly = feedsOnly }

    /// The chat lines this step actually brought in — the whole feed after a
    /// full state, and just the new tail after a patch. Saves the guest seats
    /// re-decoding fifty unchanged messages to find the one that is news.
    private(set) var chatArrivals: NSArray = []

    /// Leaving a table, or joining another. Versions count per room, so a
    /// patch still in flight for the room we walked out of must never be
    /// allowed to line up against the one we walked into.
    func forget() {
        lean = [:]
        log = []
        chat = []
        chatArrivals = []
        version = nil
    }

    /// The fixed point every later patch is measured from.
    func adopt(_ state: NSDictionary) {
        version = state["version"] as? Int
        log = state["log"] as? NSArray ?? []
        chat = state["chat"] as? NSArray ?? []
        chatArrivals = chat
        guard !feedsOnly else { return }
        let rest = NSMutableDictionary(dictionary: state)
        rest.removeObject(forKey: "log")
        rest.removeObject(forKey: "chat")
        lean = rest
    }

    func apply(_ message: NSDictionary) -> Step {
        // Every patch names the version it applies to. Anything else and we
        // would be rebuilding a state that was never ours.
        guard let held = version,
              let from = message["from"] as? Int, from == held,
              let next = message["v"] as? Int else { return .resync }

        var arrivals: NSArray = []
        var nextLog = log
        if let tail = message["log"] as? NSDictionary {
            guard let merged = StateFeed.apply(log, tail, key: "at") else { return .resync }
            nextLog = merged
        }
        var nextChat = chat
        if let tail = message["chat"] as? NSDictionary {
            guard let merged = StateFeed.apply(chat, tail, key: "id") else { return .resync }
            nextChat = merged
            arrivals = (tail["add"] as? NSArray) ?? []
        }
        var nextLean = lean
        if !feedsOnly, let patch = message["patch"] as? NSDictionary {
            guard let merged = StatePatch.apply(lean, patch) else { return .resync }
            nextLean = merged
        }

        // Every half landed, so now it is safe to be the new truth.
        lean = nextLean
        log = nextLog
        chat = nextChat
        version = next
        chatArrivals = arrivals
        guard !feedsOnly else { return .feeds }

        // `patch` carries `version` itself, so what we hand back is whole —
        // the same shape a full push arrives in, feeds and all.
        let full = NSMutableDictionary(dictionary: nextLean)
        full["log"] = nextLog
        full["chat"] = nextChat
        return .state(full)
    }
}
