// Codable mirror of the state the game server broadcasts.
// The server (server/game.js serialize()) is the source of truth; everything
// here is optional-tolerant so one missing field never kills the whole decode.

import Foundation

struct GameState: Codable, Equatable {
    var id: String
    var status: String                      // "lobby" | "playing" | "ended"
    var hostId: String?
    /// This table came out of Quick Play matchmaking.
    var quick: Bool?
    /// Epoch ms the matchmade table deals itself in; nil once it has.
    var quickStartAt: Double?
    var settings: GameSettings
    var mapId: String?
    var map: MapData
    var groups: [String: GroupInfo]         // group key -> name/color/flag
    var teamInfo: [TeamInfo]?
    var winningTeam: Int?
    var players: [PlayerState]
    /// Seats whose player dropped out and whose chair the table is holding.
    var awaiting: [AwaitingSeat]?
    var ownership: [String: TileOwnership]  // tile index (stringified) -> owner
    var turn: TurnState?
    var auction: AuctionState?
    var trades: [TradeOffer]
    var log: [LogLine]
    var chat: [ChatMessage]
    var vacationPot: Int?
    var winner: WinnerInfo?
    var lastCard: LastCard?
    var lastMove: LastMove?
    /// The deadlock rule's one-time explainer, set the first time this table
    /// could ever hit it. It rides every push from then on, so it is the `at`
    /// stamp — not its presence — that says whether it is news.
    var reliefCard: ReliefCard?
    var history: [WorthPoint]?              // net-worth series, sent once the game ends
    /// Per-player match counters, revealed only on the ended state.
    var stats: [String: PlayerStats]?
    /// End-of-game badges: player id -> title with its one-line reason.
    var titles: [String: TitleInfo]?
    var version: Int

    func player(_ id: String?) -> PlayerState? {
        guard let id else { return nil }
        return players.first { $0.id == id }
    }

    func owner(of tile: Int) -> TileOwnership? { ownership[String(tile)] }

    var isLobby: Bool { status == "lobby" }
    /// A matchmade table still filling up: the seats and the clock are the
    /// whole story, so the host controls stay out of the way.
    var isQuickWaiting: Bool { isLobby && quick == true && quickStartAt != nil }
    var isPlaying: Bool { status == "playing" }
    var isEnded: Bool { status == "ended" }
}

struct GameSettings: Codable, Equatable {
    var maxPlayers: Int
    var isPrivate: Bool?
    var allowBots: Bool?
    var mapId: String?
    var x2rent: Bool?
    var vacationCash: Bool?
    var auction: Bool?
    var noRentInPrison: Bool?
    var mortgage: Bool?
    var evenBuild: Bool?
    var startingCash: Int
    var randomizeOrder: Bool?
    var teams: Int?
    /// Seconds a human gets per turn before the table moves on; 0 = clock off.
    var turnSeconds: Int?
}

struct MapData: Codable, Equatable {
    var id: String
    var uid: String?
    var name: String
    var icon: String?
    var tiles: [TileData]
    var layout: MapLayout
    var size: Int
    var groups: [String: [Int]]?            // group key -> tile indices
}

struct MapLayout: Codable, Equatable {
    var corners: [Int]                      // [start, prison, vacation, gotoprison]
    var top: [Int]
    var right: [Int]
    var bottom: [Int]
    var left: [Int]
}

struct TileData: Codable, Equatable, Identifiable {
    var type: String                        // property|airport|utility|tax|refund|treasure|surprise|start|prison|vacation|gotoprison
    var name: String
    var index: Int
    var price: Int?
    var group: String?
    var rent: [Int]?
    var houseCost: Int?
    var groupSize: Int?
    var icon: String?
    var amount: Int?
    var percent: Int?

    var id: Int { index }
    var isOwnable: Bool { ["property", "airport", "utility"].contains(type) }
}

struct GroupInfo: Codable, Equatable {
    var name: String
    var color: String
    var flag: String
}

struct TeamInfo: Codable, Equatable {
    var name: String
    var color: String
    var icon: String
}

struct PlayerState: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var color: String
    var flag: String?
    var team: Int?
    /// Store cosmetics: emoji piece on the board / emoji face in the chip.
    var tokenSkin: String?
    var avatar: String?
    var money: Int
    var pos: Int
    var jail: Bool?
    var jailTurns: Int?
    var getOutCards: Int?
    var bankrupt: Bool?
    var isBot: Bool?
    var connected: Bool?
    var skipTurns: Int?
    var netWorth: Int?
    /// Removed from play rather than beaten: the seat stays in the roster as a
    /// spectator, and the deeds went back to the bank.
    var timedOut: Bool?
    var removedFor: String?                 // "timeout" | "quit"
    /// Laps walked while the deadlock rule was counting for this seat, 0...4.
    var blockedLaps: Int?

    var isBankrupt: Bool { bankrupt ?? false }
    var inJail: Bool { jail ?? false }
    var wasRemoved: Bool { timedOut ?? false }

    /// Laps the server has counted, and the same number the way a player wants
    /// to read it — how many are LEFT. RELIEF_LAPS in server/game.js.
    static let reliefLaps = 4
    var lapsBlocked: Int { blockedLaps ?? 0 }
    var lapsToRelief: Int { max(0, PlayerState.reliefLaps - lapsBlocked) }
}

/// A seat the table is waiting on. The first couple of extensions are a favour
/// any one player can do alone; after that the server wants everybody's click,
/// which is why `granted` and `voters` travel with it.
struct AwaitingSeat: Codable, Equatable, Identifiable {
    var id: String
    /// Epoch ms the chair is released if nobody grants more time.
    var until: Double?
    var grants: Int?
    var granted: [String]?
    var needAll: Bool?
    var voters: Int?

    var grantedIds: [String] { granted ?? [] }
    var voterCount: Int { voters ?? 0 }
    /// One click is no longer enough — everyone still at the table must agree.
    var isVote: Bool { needAll ?? false }
}

struct TileOwnership: Codable, Equatable {
    var owner: String
    var houses: Int?
    var mortgaged: Bool?

    var houseCount: Int { houses ?? 0 }
    var isMortgaged: Bool { mortgaged ?? false }
}

struct TurnState: Codable, Equatable {
    var playerId: String
    var phase: String                       // roll | action | auction | debt | end
    var dice: [Int]?
    var doubles: Int?
    var pending: PendingAction?
    var debt: DebtState?
    var rolledThisTurn: Bool?
    /// Epoch milliseconds this player's turn expires; null when no clock.
    var endsAt: Double?
}

struct PendingAction: Codable, Equatable {
    var type: String                        // "buy"
    var tile: Int
    var price: Int?
}

struct DebtState: Codable, Equatable {
    var debtor: String
    var creditor: String?
    var amount: Int
    var reason: String?
}

struct AuctionState: Codable, Equatable {
    var tile: Int
    var bid: Int
    var leader: String?
    var inRace: [String]
    var endsAt: Double?
}

struct TradeSide: Codable, Equatable {
    var money: Int
    var tiles: [Int]
    var cards: Int
}

struct TradeOffer: Codable, Equatable, Identifiable {
    var id: Int
    var from: String
    var to: String
    var give: TradeSide
    var get: TradeSide
    var at: Double?
    /// Recipient parked it — out of the dock, still in the list.
    var ignored: Bool?
    /// Player ids currently looking at this offer.
    var viewers: [String]?
}

struct LogLine: Codable, Equatable, Identifiable {
    var text: String
    var kind: String
    var at: Double

    var id: String { "\(at):\(text.hashValue)" }
}

struct ChatMessage: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var color: String
    var flag: String?
    var text: String
    var at: Double
    var channel: String?                    // "all" | "team"
    var team: Int?

    var isTeam: Bool { channel == "team" }
}

/// One point of the end-of-game chart: turn number -> player id -> net worth.
struct WorthPoint: Codable, Equatable {
    var t: Int
    var w: [String: Int]
}

/// A player's report card, mirroring statFor() in server/game.js. Every field
/// defaults so a stat the server hasn't counted yet reads as zero, not a
/// decode failure.
struct PlayerStats: Codable, Equatable {
    var doubles: Int? = nil
    var jailed: Int? = nil
    var streetsBought: Int? = nil
    var auctionsWon: Int? = nil
    var tradesCompleted: Int? = nil
    var housesBuilt: Int? = nil
    var rentCollected: Int? = nil
    var rentPaid: Int? = nil
    var biggestRent: Int? = nil
    var biggestRentTile: String? = nil
    var laps: Int? = nil
    var leadShare: Int? = nil
}

/// One end-of-game badge: "Landlord — collected $4,320 in rent".
struct TitleInfo: Codable, Equatable {
    var title: String
    var reason: String
}

/// One player's line of a finished game, frozen so History can reopen the
/// result long after the room itself is gone.
struct PlayerResult: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var color: String
    var flag: String?
    var avatar: String?
    var worth: Int
    var bankrupt: Bool
    var removedFor: String?
    var isBot: Bool
    var title: String?
    var titleReason: String?
    var stats: PlayerStats?

    /// What the standings column says for this seat. A removed seat was never
    /// actually bankrupted — don't say it was.
    var outcomeLabel: String? {
        guard bankrupt else { return nil }
        switch removedFor {
        case "quit": return "left the game"
        case "timeout": return "timed out"
        default: return "bankrupt"
        }
    }

    /// Standings order — solvent seats by net worth, then the fallen — with
    /// each seat's title and stats stapled on. This is both what the game-over
    /// sheet renders and what History files away.
    static func snapshot(of state: GameState?) -> [PlayerResult] {
        guard let state else { return [] }
        let ordered = state.players.filter { !$0.isBankrupt }
            .sorted { ($0.netWorth ?? 0) > ($1.netWorth ?? 0) }
            + state.players.filter { $0.isBankrupt }
        return ordered.map { p in
            PlayerResult(id: p.id, name: p.name, color: p.color, flag: p.flag,
                         avatar: p.avatar,
                         worth: p.isBankrupt ? 0 : (p.netWorth ?? 0),
                         bankrupt: p.isBankrupt, removedFor: p.removedFor,
                         // Quick tables mask isBot, but the house players still
                         // carry the server's "bot:" id prefix.
                         isBot: (p.isBot ?? false) || p.id.hasPrefix("bot:"),
                         title: state.titles?[p.id]?.title,
                         titleReason: state.titles?[p.id]?.reason,
                         stats: state.stats?[p.id])
        }
    }
}

/// Mirrors codeFor() in server/social.js: a friend code is a pure hash of the
/// player's token, so the code of anyone at the table can be computed from
/// their player id and fed to the normal add-by-code flow. (The server keeps a
/// collision salt for the vanishingly unlikely clash — if that ever fires the
/// add simply fails with "no player with that code".)
func friendCode(for token: String) -> String {
    let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
    var h1: UInt32 = 0x811c9dc5
    var h2: UInt32 = 0x01000193
    for (i, unit) in token.utf16.enumerated() {
        let c = UInt32(unit)
        h1 = (h1 ^ c) &* 16777619
        h2 = (h2 &+ c &* UInt32(i + 7)) &* 2654435761
    }
    var out = ""
    for i in 0..<6 {
        let source = i < 3 ? h1 : h2
        out.append(alphabet[Int((source >> UInt32((i % 3) * 5)) % 32)])
        // The server rolls h1 after the third character; the value feeds
        // nothing afterwards, but the roll is kept so the codes stay equal.
        if i == 2 { h1 = h1 &* 2246822519 }
    }
    return out
}

struct WinnerInfo: Codable, Equatable {
    var id: String
    var name: String
    var color: String
}

/// The house explaining a rule rather than the deck dealing a card: shown once
/// to both players the first time a two-player table could deadlock.
struct ReliefCard: Codable, Equatable {
    var title: String
    var text: String
    var at: Double
}

struct LastCard: Codable, Equatable {
    var deck: String                        // treasure | surprise
    var text: String
    var at: Double
}

struct LastMove: Codable, Equatable {
    var playerId: String
    var from: Int
    var to: Int
    var steps: Int
    var at: Double
}

// MARK: - REST payloads

struct MapSummary: Codable, Identifiable {
    var id: String
    var name: String
    var icon: String?
    var description: String?
    var size: Int
    var streets: Int?
    var countries: Int?
    /// True for the single-nation "custom" boards with their own card decks.
    var country: Bool?
}

struct FriendEntry: Codable, Identifiable {
    var code: String
    var name: String
    var flag: String?
    /// Their equipped store face, sent alongside the flag.
    var avatar: String?
    var roomId: String?
    var status: String?

    var id: String { code }
}

struct ProfileInfo: Codable {
    var code: String
    var name: String?
    var flag: String?
}

// MARK: - store

struct StoreItem: Codable, Identifiable {
    var id: String
    var kind: String                        // "token" | "avatar"
    var name: String
    var emoji: String
    var price: Int
}

struct Wallet: Codable {
    var coins: Int
    var owned: [String]
    var equipped: [String: String]          // slot -> item id
    /// 0...100, docked when someone walks out on a live table.
    var karma: Int?
}

/// One paid top-up from GET /api/store. `productId` is what StoreKit sells.
struct CoinPack: Codable, Identifiable {
    var id: String
    var productId: String
    var coins: Int
    var price: String                       // "4.99" — the fallback display price
    var emoji: String
    var name: String
    var bonus: Int                          // extra %, 0 for the plain pack
}

struct DMessage: Codable, Identifiable {
    var from: String
    var text: String
    var at: Double

    var id: String { "\(at):\(from)" }
}

// MARK: - server marks → drawn glyphs

/// The server labels utilities, maps and coin packs with an emoji. Emoji are
/// another vendor's artwork — they change shape per platform and country flags
/// don't draw at all on Windows — so nothing here is ever shown as typed. The
/// mark is treated as an identifier and answered with one of our own drawings.

/// Strips the variation selector so "☠️" and "☠" are the same key.
private func plainMark(_ mark: String?) -> String {
    String(String.UnicodeScalarView((mark ?? "").unicodeScalars.filter { $0.value != 0xFE0F }))
}

/// A utility tile's power source. Mirrors `utilityName()` in public/js/icons.js
/// so a board reads the same on the web, on Android and here.
func utilityGlyph(_ mark: String?) -> Glyph {
    switch plainMark(mark) {
    case "🚰", "💧": .droplet
    case "🛢": .flame
    case "☀": .sun
    case "🌬": .turbine
    default: .bolt
    }
}

/// A board's badge in pickers and history. Country boards carry their nation's
/// flag, which is exactly the mark that can't be drawn everywhere — they all
/// fall through to the folded map instead.
func mapGlyph(_ mark: String?) -> Glyph {
    switch plainMark(mark) {
    case "🌐": .globe
    case "🌍": .plane      // "Mr. Worldwide" — the board that travels
    case "☠": .skull
    case "⚡": .bolt
    case "🍀": .sparkle
    case "🎲": .dice
    default: .map
    }
}

/// A coin pack's shelf mark, biggest purse for the biggest pack.
func packGlyph(_ mark: String?) -> Glyph {
    switch plainMark(mark) {
    case "💰": .bag
    case "🏦": .toolbox    // the "Tycoon chest" pack — a chest, not a bank
    default: .coin
    }
}
