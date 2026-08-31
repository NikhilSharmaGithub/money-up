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
    var history: [WorthPoint]?              // net-worth series, sent once the game ends
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

    var isBankrupt: Bool { bankrupt ?? false }
    var inJail: Bool { jail ?? false }
    var wasRemoved: Bool { timedOut ?? false }
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

struct WinnerInfo: Codable, Equatable {
    var id: String
    var name: String
    var color: String
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
