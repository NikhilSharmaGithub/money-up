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
    /// This table was made for a cup match. Two chairs with names on them:
    /// no bots, no guests, no settings, and nobody to throw out.
    var cup: Bool?
    /// Epoch ms the matchmade table deals itself in; nil once it has.
    var quickStartAt: Double?
    /// A Play-now table's lobby — the search, then the Ready round the host
    /// starts from. Nil everywhere else, and from a server that predates it,
    /// which leaves the table on quickStartAt and the old waiting room.
    var quickLobby: QuickLobby?
    /// What a matchmade table dealt itself — board and house rules. Nobody at
    /// one of these tables picked them, so they get shown before the dice.
    var quickRoll: QuickRoll?
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
    /// A bankrupt player being asked what happens to their properties (1.0.7,
    /// H2) — only at a table where the player decides. Nil whenever nobody is
    /// being asked, and from an older server, which never asks.
    var bankruptChoice: BankruptChoice?
    var trades: [TradeOffer]
    var log: [LogLine]
    var chat: [ChatMessage]
    var vacationPot: Int?
    var winner: WinnerInfo?
    var lastCard: LastCard?
    var lastMove: LastMove?
    /// Every leg of the current action, in execution order — one roll can
    /// move a piece twice (walk onto Surprise, then the card sends it on),
    /// and the theatre wants each leg on its own cue. Optional: old servers
    /// send nothing and the client falls back to lastMove pacing.
    var moves: [MoveLeg]?
    /// The deadlock rule's one-time explainer, set the first time this table
    /// could ever hit it. It rides every push from then on, so it is the `at`
    /// stamp — not its presence — that says whether it is news.
    var reliefCard: ReliefCard?
    var history: [WorthPoint]?              // net-worth series, sent once the game ends
    /// Per-player match counters, revealed only on the ended state.
    var stats: [String: PlayerStats]?
    /// End-of-game badges: player id -> title with its one-line reason.
    var titles: [String: TitleInfo]?
    /// The game clock of a timed table (1.0.6), epoch ms. Nil for an untimed
    /// table, in the lobby, at Play-now and cup tables — and from an older
    /// server. Not `turn.endsAt`, which is still each turn's own shot clock.
    var endsAt: Double?
    /// The clock has run out and the turn on the board is the last one. Stays
    /// true on the ended state of a timed game.
    var timeUp: Bool?
    /// Only once the game has ended: "time" when it was decided on the clock,
    /// "last" when everybody else went out.
    var endReason: String?
    /// When this game's dice started; nil in the lobby.
    var startedAt: Double?
    /// Turns played so far — the number the Watch live list shows.
    var turnCount: Int?
    /// How many people are watching without a seat: distinct identities, never
    /// a seated player. 0 or absent when nobody is.
    var spectators: Int?
    var version: Int

    func player(_ id: String?) -> PlayerState? {
        guard let id else { return nil }
        return players.first { $0.id == id }
    }

    /// Where an open debt streams, written the way a sentence needs it: the
    /// creditor's name, the still-owed players of a payEach split, or plain
    /// "the bank" when the money simply leaves the game.
    func debtPayee(_ d: DebtState?) -> String {
        if let c = player(d?.creditor) { return c.name }
        let names = (d?.owedTo ?? []).enumerated().compactMap { k, id -> String? in
            guard let p = player(id), !p.isBankrupt else { return nil }
            if let left = d?.owedLeft?[safe: k], left <= 0 { return nil }
            return p.name
        }
        if names.count > 1 {
            return names.dropLast().joined(separator: ", ") + " and " + names.last!
        }
        return names.first ?? "the bank"
    }

    func owner(of tile: Int) -> TileOwnership? { ownership[String(tile)] }

    var isLobby: Bool { status == "lobby" }
    /// A matchmade table that has not dealt itself in: the Play-now lobby, or
    /// on an older server the plain countdown. Either way the private lobby's
    /// host controls — seats, kicks, bots — have no place here.
    var isQuickWaiting: Bool {
        isLobby && quick == true && (quickLobby != nil || quickStartAt != nil)
    }
    var isPlaying: Bool { status == "playing" }
    var isEnded: Bool { status == "ended" }
    /// The game was settled by the clock rather than by everybody else going
    /// out — a timed table, or a cup match decided at its whistle.
    var endedOnTime: Bool { isEnded && endReason == "time" }
}

/// The house rules a Quick Play table rolled for itself.
///
/// `parts` arrives already written — "Japan", "$1,500 to start", "auctions on"
/// — because the server phrases it once and a phone and a browser at the same
/// table then cannot describe it differently. `keys` names which settings were
/// rolled rather than defaulted — which is how a phone tells a 1.0.8 server,
/// whose Play-now tables roll the shuffled board, from an older one whose
/// tables never shuffle (GameState.rollsShuffle).
struct QuickRoll: Codable, Equatable {
    var at: Double?
    var keys: [String]?
    var parts: [String]?
    /// The settings the host has moved off what the table rolled. The lobby
    /// rings those chips, so a stranger can see which rules a person chose.
    var edited: [String]?

    /// Which setting each of `parts` describes, in the order quickRollParts()
    /// in server/game.js writes them: the board, the bankroll, the five house
    /// rules, what a bankrupt player's streets do, then the shuffled board.
    /// The phrases arrive finished, so this is the only way to tell which chip
    /// an edited key belongs to.
    ///
    /// Every new rule goes on the end, never in the middle: a 1.0.7 app reads
    /// a 1.0.8 table's nine phrases with its eight keys, and only an appended
    /// ninth leaves the first eight on the chips they belong to — the extra one
    /// just shows without a ring. The other way round, an older server's eight
    /// phrases simply never reach the ninth key; look it up with `[safe:]`.
    static let partKeys = ["mapId", "startingCash", "x2rent", "vacationCash",
                           "auction", "noRentInPrison", "evenBuild",
                           // 1.0.7 (H3): what a bankrupt player's streets do.
                           "bankruptProperties",
                           // 1.0.8: "shuffled board on/off", the ninth and
                           // last phrase.
                           "shuffleBoard"]
}

/// A Play-now table between the tap and the deal: first the search, then a
/// Ready round the host starts from — or that starts by itself at `startBy`.
///
/// Every time is the server's epoch ms, counted down against this phone's
/// clock the way the turn clock is, so a late arrival sees the real number
/// rather than a fresh one.
struct QuickLobby: Codable, Equatable {
    /// "gathering" while the search runs, "ready" once it has ended.
    var phase: String?
    var gatherUntil: Double?
    /// When the table deals itself in if the host never presses Start.
    var startBy: Double?
    /// The soonest a house player takes a chair somebody left; nil when no
    /// chair is waiting on one.
    var backfillAt: Double?
    /// The seats other than the host still to press Ready.
    var waitingOn: SeatTally?
    /// Everybody but the host is ready and the search is over.
    var canStart: Bool?
    /// The setting keys a host may change at this table.
    var editable: [String]?

    /// Still searching. The server's phase decides it, so a phone whose clock
    /// runs a few seconds fast never offers Start early; only a lobby that
    /// arrives without one is read off the clock.
    var isGathering: Bool {
        if let phase { return phase != "ready" }
        return (gatherUntil ?? 0) > Date().timeIntervalSince1970 * 1000
    }
}

/// A head count the server may send either as the number or as the list of
/// who it counts. Either decodes; anything else counts as nobody rather than
/// failing the whole state.
struct SeatTally: Codable, Equatable {
    var count: Int
    var ids: [String]?

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Int.self) {
            count = n
        } else if let list = try? c.decode([String].self) {
            ids = list
            count = list.count
        } else if let any = try? c.decode([Anything].self) {
            count = any.count
        } else {
            count = 0
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        if let ids { try c.encode(ids) } else { try c.encode(count) }
    }

    /// Takes any one JSON value and keeps nothing of it — for counting.
    private struct Anything: Decodable {
        init(from decoder: Decoder) throws {}
    }
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
    /// How the house players the host added play (1.0.6): "easy", "normal" or
    /// "hard". Absent from an older server, which only ever plays normal.
    var botLevel: String?
    /// Minutes on the whole game's clock (1.0.6): 0 for no limit, else 20, 30,
    /// 45 or 60. The richest player still in wins when it runs out.
    var timeLimit: Int?
    /// What a bankrupt player's properties do (1.0.6, round 2): "release" —
    /// back to the bank, unowned, as always — or "auction", one lot at a time;
    /// and since 1.0.7 "choose", where the player who goes out decides.
    /// Absent from an older server, which only ever releases them.
    var bankruptProperties: String?
    /// Every unowned property goes straight to auction when landed on; there
    /// is no Buy step at all. The server keeps `auction` on whenever this is.
    var auctionOnly: Bool?
    /// The colour sets are dealt to new places on the board at each start.
    /// The board itself arrives already shuffled in `map`; this is the rule.
    /// A private table's host sets it (1.0.6); from 1.0.8 a Play-now table
    /// rolls it too, about one table in three, and its host may change it.
    var shuffleBoard: Bool?
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
    /// This layout is a shuffle of the printed board (round 2): true while a
    /// shuffled game is on and on its ended state, false in the lobby. Older
    /// servers never send it.
    var shuffled: Bool?
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
    /// The seat's public friend code — the one its chat lines already carry —
    /// which is what a profile is looked up by. The id cannot be: everybody
    /// else's id arrives as an alias for this table only. A house player has
    /// a code of its own; a pass & play guest has none, and sends it empty.
    var code: String?
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
    /// Pressed Ready in a Play-now lobby. False everywhere else; older
    /// servers never send it.
    var ready: Bool?
    /// The seat's level (1.0.6): a person's own, a house player's stable one
    /// from its code, 0 for a pass & play guest. Absent from an older server,
    /// and both absent and 0 mean the same thing — no chip.
    var level: Int?

    var isBankrupt: Bool { bankrupt ?? false }
    var inJail: Bool { jail ?? false }
    var wasRemoved: Bool { timedOut ?? false }
    /// Below zero and still at the table: the debt phase, where the negative
    /// balance IS the amount left to pay and every gain streams to whoever is
    /// owed until it climbs back to zero.
    var inDebt: Bool { money < 0 && !isBankrupt }

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
    /// A payEach charge is owed to several players at once; the server names
    /// them here (creditor stays nil) so the panel can say who the money is
    /// streaming to. Old servers never send it.
    var owedTo: [String]?
    /// What each of `owedTo` is still owed, same order — a paid-off or
    /// departed recipient drops out of the debt copy. Old servers omit it.
    var owedLeft: [Int]?
}

struct AuctionState: Codable, Equatable {
    var tile: Int
    var bid: Int
    var leader: String?
    var inRace: [String]
    var endsAt: Double?
    /// A lot from a bankrupt player's estate (1.0.6, round 2) — nil for an
    /// ordinary auction, and from an older server, which has no other kind.
    var estate: EstateLot?
}

/// The question a bankrupt player is asked at a table where the player
/// decides (1.0.7, H2): back to the bank, or auction to everyone.
struct BankruptChoice: Codable, Equatable {
    /// Who is being asked — aliased like every other id, so it is this
    /// device's own id only when the question is this device's to answer.
    var playerId: String
    var name: String
    /// The deeds in question, as board indices in board order. They already
    /// belong to the bank while the question is open.
    var properties: [Int]
    /// Epoch ms the house answers for them.
    var endsAt: Double?
}

/// Whose estate is under the hammer, and how much more of it is to come.
struct EstateLot: Codable, Equatable {
    /// The bankrupt player's name — not an id; the seat may be gone.
    var from: String
    /// Lots of this estate still to follow this one; 0 on its last.
    var left: Int?
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
    /// The sender's public friend code, so the line can be reported or its
    /// author blocked. Absent for house players and older servers.
    var code: String?
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
    /// This seat's own turns, and the colour sets it completed — the two
    /// counters the daily missions read off a finished game (1.0.6).
    var turns: Int? = nil
    var setsCompleted: Int? = nil
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
    /// Kept with the result so History can still open a player's profile long
    /// after the table that aliased their id has gone. Nil on games saved
    /// before codes rode the state, and empty for a seat with no profile.
    var code: String?
    var worth: Int
    var bankrupt: Bool
    var removedFor: String?
    var isBot: Bool
    var title: String?
    var titleReason: String?
    var stats: PlayerStats?
    /// The level the seat wore when the game ended. Optional, so results
    /// saved before levels existed still decode.
    var level: Int?

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
                         avatar: p.avatar, code: p.code,
                         worth: p.isBankrupt ? 0 : (p.netWorth ?? 0),
                         bankrupt: p.isBankrupt, removedFor: p.removedFor,
                         // Quick tables mask isBot, but the house players still
                         // carry the server's "bot:" id prefix.
                         isBot: (p.isBot ?? false) || p.id.hasPrefix("bot:"),
                         title: state.titles?[p.id]?.title,
                         titleReason: state.titles?[p.id]?.reason,
                         stats: state.stats?[p.id],
                         level: p.level)
        }
    }
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
    /// good | bad | plain — decided on the server so every client paints the
    /// same card the same colour, rather than three of them guessing from the
    /// wording. Absent on older servers, which get the deck's own colours.
    var tone: String?
    /// Who drew it. The board reveals a card the moment *that* player's piece
    /// reaches the tile that drew it, so it has to know whose piece to watch.
    var playerId: String?
    var at: Double
}

struct LastMove: Codable, Equatable {
    var playerId: String
    var from: Int
    var to: Int
    var steps: Int
    var at: Double
}

/// One scripted move of the current action. `cause` is the cue sheet:
/// "roll" waits for the dice, "card" waits for the card to be read,
/// "jail" is the long walk nobody narrates twice.
struct MoveLeg: Codable, Equatable {
    var playerId: String
    var from: Int
    var to: Int
    var steps: Int
    var cause: String?
    /// A number that only goes up. Two legs of one journey — the roll and the
    /// card its tile drew — are resolved inside the same millisecond, so the
    /// clock cannot tell them apart and this can.
    var seq: Int?
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
    /// Every coin this wallet has ever been paid, spends never taken off. The
    /// balance alone cannot say whether a number just read is news — a poll
    /// repeats it, a purchase moves it the other way — and this only ever goes
    /// up, so a credit is exactly the moments it moves. Optional: a server
    /// that predates the field simply never moves the counter.
    var earned: Int?
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
