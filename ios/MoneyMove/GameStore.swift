// The one observable object the whole app hangs off: identity, connection,
// the latest server state, and every action a player can take.
//
// The server is authoritative — this store only sends intents and renders
// whatever comes back, exactly like the web client.

import SwiftUI
import Combine

@MainActor
final class GameStore: ObservableObject {

    // MARK: - identity & config

    /// Stable per-install identity; the server keys the player's seat off it.
    /// Only ever replaced by `startFresh()`, after the account is deleted.
    private(set) var token: String = {
        let key = "mm.token"
        if let existing = UserDefaults.standard.string(forKey: key) { return existing }
        let fresh = "u_ios_" + UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "")
        UserDefaults.standard.set(fresh, forKey: key)
        return fresh
    }()

    @AppStorage("mm.name") var nickname: String = ""

    /// Friend codes this player has blocked. Their chat lines are hidden and
    /// the server refuses friend requests and messages across the block.
    @Published var blockedCodes: Set<String> = []
    /// This player's own public code, so their own chat lines are not offered
    /// a Report button.
    @Published var myCode: String = ""

    /// The account is gone on the server; become somebody new on this device.
    ///
    /// Keeping the old token would quietly mint a fresh profile under it on the
    /// very next request — the same identity the player just asked to delete.
    func startFresh() {
        let fresh = "u_ios_" + UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "")
        UserDefaults.standard.set(fresh, forKey: "mm.token")
        token = fresh
        nickname = ""
        lastRoom = ""
        lastGuests = 0
        blockedCodes = []
        myCode = ""
        // Tables the old identity was sitting at. The seats belong to an
        // account that no longer exists, so "Continue game" would only lead
        // somewhere this device can no longer sit down.
        unfinishedGames = []
        UserDefaults.standard.removeObject(forKey: "mm.unfinished")
        // The Apple sign-in belonged to the deleted account too. Left behind,
        // the next launch would ask Apple about it, find it revoked by the
        // deletion, and go asking the server to sign the brand-new identity
        // out of something it never signed in to.
        UserDefaults.standard.removeObject(forKey: GameStore.appleUserKey)
        refreshWallet()
    }
    @AppStorage("mm.flag") var flag: String = ""
    /// Where the app looks for games. There is no longer a way to change
    /// this from inside the app — it was a workbench control that could only
    /// break things on a real phone. It stays stored so a development machine
    /// can still point a simulator somewhere else by writing the default
    /// directly, and so anybody carrying an old override is not stranded on it
    /// — see the reset below.
    @AppStorage("mm.server") var serverURLString: String = GameStore.defaultServer
    /// Last room this device sat in — powers "Continue game" on the landing
    /// screen. The server holds seats (bots fill in) so rejoining just works.
    @AppStorage("mm.lastRoom") var lastRoom: String = ""
    @AppStorage("mm.lastGuests") var lastGuests: Int = 0

    /// The real server, on every build including the simulator.
    ///
    /// The simulator used to default to a machine on localhost, which is
    /// convenient for exactly one person and baffling for everyone else: a
    /// simulator with no server running looks like a broken app — matchmaking
    /// fails, Google sign-in vanishes (the local server has no client id) and
    /// the daily reward never arrives. Pointing somewhere else is now a
    /// deliberate act, through the override in Settings, which only a
    /// development build carries.
    static var defaultServer: String { "https://moneymove-csk9.onrender.com" }

    var serverURL: URL? { URL(string: serverURLString.trimmingCharacters(in: .whitespaces)) }

    // MARK: - published state

    @Published var state: GameState?
    /// Lines said since the chat was last looked at. The badge reads it, and
    /// it is the whole point of the badge: a game where nobody notices the
    /// chat is a game where nobody uses it.
    @Published private(set) var unreadChat = 0
    /// The last line this device has already heard. A push that redelivers the
    /// same window — a reconnect, a resync — must not pop again for lines it
    /// already sounded.
    private var heardChatId: String?
    /// Whether the first state of this table has been seen. Without it the
    /// very first line said at a table is swallowed: an empty feed leaves
    /// nothing to anchor on, so the line that breaks the silence looks like
    /// the anchor rather than news. Caught on a simulator — three lines sent,
    /// two counted.
    private var chatPrimed = false
    @Published var meId: String = ""
    @Published var roomId: String?
    @Published var connection: SocketIOClient.Status = .disconnected
    @Published var toast: ToastMessage?
    @Published var cardPopup: LastCard?
    /// nil until fetched; every ad affordance hides unless enabled == true.
    @Published var adsConfig: AdsConfig?
    /// The deadlock rule, raised as a card the one time it is news.
    @Published var reliefPopup: ReliefCard?
    /// Which explainer this device has already read. Kept on disk against its
    /// server timestamp so rejoining the same table doesn't re-teach the rule.
    @AppStorage("mm.reliefSeen") private var reliefSeenAt: Double = 0
    @Published var turnBanner: PlayerState?
    @Published var showGameOver = false
    /// This device's seat was taken out by the clock — drives the full-screen
    /// explainer. Cleared when the player chooses to stay and watch.
    @Published var timedOut = false
    /// Set when a game begins — drives the board's deal-in animation.
    @Published var boardIntroAt: Date?
    /// Log lines at or before this stamp stay out of the ghosted centre-well
    /// feed. Set at kick-off, so the game opens on a quiet table instead of a
    /// wall of lobby chatter — the full History sheet still keeps everything.
    @Published var logFloor: Double = 0
    /// The server's one-line headline for the table — "India holds the
    /// priciest streets this game!" — shown as it arrives.
    @Published var reveal: String?
    private var revealTask: Task<Void, Never>?
    /// Rooms this run of the app has walked in on with the board still
    /// untouched. Only AdSignal cares: it is what stops a reconnect loop in
    /// the opening seconds of a game from reporting the same game twice.
    private var walkedInto: Set<String> = []
    @Published var joinError: String?
    /// A Quick Play match request is in flight. It only ever dims the Play now
    /// button — create and join stay usable, so a slow server is never a wall.
    @Published var quickSearching = false
    private var quickTask: Task<Void, Never>?

    struct ToastMessage: Identifiable, Equatable {
        let id = UUID()
        let text: String
        let isError: Bool
        /// Replaces the default info/warning mark when a toast has a subject
        /// of its own — coins landing, a table you're only watching.
        let glyph: Glyph?
    }

    /// One player's cash just moved — drives the floating "+$200 / −$150"
    /// badge next to their money and the gain/loss sounds.
    struct MoneyDelta: Equatable {
        let id = UUID()
        let amount: Int
    }
    @Published var moneyDeltas: [String: MoneyDelta] = [:]

    // MARK: - the purse ledger
    //
    // MONEY IS SHOWN WHEN ITS CAUSE IS. The server resolves a whole roll
    // before the first die settles, so the push that starts a walk onto
    // somebody's hotel already carries the rent — and painting it on arrival
    // showed the purse falling before the piece had even set off. So a money
    // change that belongs to an act still on stage is held, along with
    // everything it would say — the figure, the badge, the coins, its sound,
    // a bankruptcy it caused, a game it ended — and all of it is released
    // together at the act's payday (Choreography.payday). Trades, auction
    // escrow, anybody outside the act's cast, and anything that arrives with
    // nothing on stage show the moment they arrive.
    //
    // Seats, pods, ranks and pieces read the presented player (shown(_:));
    // decisions — the buy button, trade limits, the debt panel — keep reading
    // the raw state, because on the server the money has genuinely moved.

    /// One walk on stage and the money it carries.
    struct Journey {
        /// The newest leg's stamp: what the walker asks for.
        let key: Double
        let mover: String
        /// Whose money this act may hold: the mover, everyone paid or charged
        /// by the push that started it, and whoever a debt the landing opened
        /// is owed to — rent owed by a debtor who could pay $0 moved nobody.
        let cast: Set<String>
        let startAt: Date
        let landAt: Date
        /// How long the piece waits before it sets off (Choreography.timeline).
        let lead: Double
        /// Waiting behind this mover's walk still on stage — a doubles re-roll
        /// — rather than cutting it short.
        let queued: Bool
        let hasCard: Bool
        /// What is still waiting for the landing, oldest first.
        var entries: [Entry] = []
        /// How many entries have already landed.
        var landed = 0
        var task: Task<Void, Never>?
    }

    /// One push's worth of what an act holds back.
    struct Entry {
        var delta: [String: Int] = [:]
        /// The push's fresh log kinds, less the dice and the auction — those
        /// are never held.
        var kinds: [String] = []
        var busts: [String] = []
        /// Who put each bust out, as far as this device can tell.
        var creditors: [String: [String]] = [:]
        var ended = false

        var isEmpty: Bool { delta.isEmpty && kinds.isEmpty && busts.isEmpty && !ended }

        mutating func merge(_ other: Entry) {
            for (pid, d) in other.delta { delta[pid, default: 0] += d }
            for k in other.kinds where !kinds.contains(k) { kinds.append(k) }
            for b in other.busts where !busts.contains(b) { busts.append(b) }
            creditors.merge(other.creditors) { mine, _ in mine }
            ended = ended || other.ended
        }
    }

    /// Money that has moved on the server but not yet on screen, per player.
    @Published private(set) var held: [String: Int] = [:]
    /// Bankruptcies waiting for their act to land. Published because a bust
    /// can land with no money of its own left to move.
    @Published private var heldBusts: Set<String> = []
    private var journeys: [Journey] = []
    /// False until this connection's first state has been taken as a
    /// position. A (re)connect is not news: numbers snap, nothing sounds.
    private var primed = false
    /// The version of the push last taken as a position, so the walker can
    /// snap the pieces on it instead of replaying legs it never saw start.
    private(set) var positionVersion: Int?
    /// The fanfare and then the result sheet, once the last act has landed.
    private var finaleTask: Task<Void, Never>?
    private var finalePending = false
    /// The server has called the game, but the act that ended it is still on
    /// stage, or its bust is still having its say. The well's trophy and the
    /// dock's "Play again" wait for the fanfare with everything else — a
    /// "wins!" over a piece still walking onto the hotel gives the ending away.
    @Published private(set) var endOnStage = false

    /// The state on screen is a position — the first of a table, or the first
    /// after a (re)connect — so its figures snap into place instead of counting.
    var isPosition: Bool { state.map { $0.version == positionVersion } ?? true }

    /// A finished (or abandoned) game, kept on this device for History.
    struct MatchRecord: Codable, Identifiable {
        var id = UUID()
        var date: Date
        var mapName: String
        var mapIcon: String
        var players: [String]
        var winner: String
        var won: Bool
        var myWorth: Int
        var turns: Int
        /// "won" | "lost" | "left" — optional so older saved records decode.
        var outcome: String?
        /// Full report card — standings, stats, titles — for games that ended
        /// after the report card shipped. Optional so older records decode.
        var results: [PlayerResult]?
    }
    @Published var matchHistory: [MatchRecord] = {
        guard let data = UserDefaults.standard.data(forKey: "mm.history"),
              let list = try? JSONDecoder().decode([MatchRecord].self, from: data) else { return [] }
        return list
    }()

    private func recordMatch(_ state: GameState, outcome: String? = nil) {
        // A table with no seat of ours on it was only ever watched. Filing it
        // as a loss would put games this device never played into History.
        guard state.players.contains(where: { localIds.contains($0.id) }) else { return }
        let winnerName: String
        if let teamIdx = state.winningTeam, let team = state.teamInfo?[safe: teamIdx] {
            winnerName = "Team \(team.name)"
        } else {
            winnerName = state.winner?.name ?? "Nobody"
        }
        let wonByLocalSeat = state.winner.map { localIds.contains($0.id) } ?? false
        let me = state.player(meId)
        let record = MatchRecord(
            date: Date(),
            mapName: state.map.name,
            // Stored as the server's own mark; mapGlyph() draws it at render.
            mapIcon: state.map.icon ?? "",
            players: state.players.map(\.name),
            winner: winnerName,
            won: wonByLocalSeat,
            myWorth: me?.isBankrupt == true ? 0 : (me?.netWorth ?? 0),
            turns: state.turn != nil ? max(state.history?.last?.t ?? 0, 0) : 0,
            outcome: outcome ?? (wonByLocalSeat ? "won" : "lost"),
            results: PlayerResult.snapshot(of: state)
        )
        matchHistory.insert(record, at: 0)
        matchHistory = Array(matchHistory.prefix(50))
        if let data = try? JSONEncoder().encode(matchHistory) {
            UserDefaults.standard.set(data, forKey: "mm.history")
        }
    }

    // MARK: - games left unfinished

    /// A table this device walked away from mid-game. The server holds the
    /// seat (a bot plays it), so these stay rejoinable until the game actually
    /// ends — unlike MatchRecord, which is the story of a game already over.
    struct UnfinishedGame: Codable, Identifiable, Equatable {
        var roomId: String
        var mapName: String
        var mapIcon: String
        var players: [String]
        /// Last moment this device saw the table live.
        var leftAt: Date
        /// Pass & play seats this device also held there, so a resume can put
        /// every one of them back at the table.
        var guests: Int

        var id: String { roomId }
    }

    /// Newest first; five is as far back as a room code is worth keeping.
    @Published var unfinishedGames: [UnfinishedGame] = {
        guard let data = UserDefaults.standard.data(forKey: "mm.unfinished"),
              let list = try? JSONDecoder().decode([UnfinishedGame].self, from: data) else { return [] }
        return list
    }()
    static let maxUnfinished = 5
    /// The table a resume is waiting to hear back from — see the check in
    /// apply(), which is the only way to tell a live game from a dead code.
    private var resumeCheck: String?
    private var unfinishedSavedAt = Date.distantPast

    private func saveUnfinished() {
        unfinishedSavedAt = Date()
        if let data = try? JSONEncoder().encode(unfinishedGames) {
            UserDefaults.standard.set(data, forKey: "mm.unfinished")
        }
    }

    /// Remember the table we are sitting at, so History can offer it back.
    private func noteUnfinished(_ state: GameState) {
        guard state.isPlaying, !state.id.isEmpty,
              state.players.contains(where: { localIds.contains($0.id) }) else { return }
        let entry = UnfinishedGame(roomId: state.id,
                                   mapName: state.map.name,
                                   mapIcon: state.map.icon ?? "",
                                   players: state.players.map(\.name),
                                   leftAt: Date(),
                                   guests: guests.count)
        let known = unfinishedGames.first { $0.roomId == state.id }
        unfinishedGames.removeAll { $0.roomId == state.id }
        unfinishedGames.insert(entry, at: 0)
        unfinishedGames = Array(unfinishedGames.prefix(Self.maxUnfinished))
        // Only the timestamp moves on most pushes, and writing the defaults
        // once per dice roll buys nothing.
        let sameTable = known?.players == entry.players && known?.mapName == entry.mapName
            && known?.guests == entry.guests
        if !sameTable || Date().timeIntervalSince(unfinishedSavedAt) > 20 { saveUnfinished() }
    }

    /// That game is over, or the room no longer exists: stop offering it.
    func dropUnfinished(_ room: String) {
        guard unfinishedGames.contains(where: { $0.roomId == room }) || lastRoom == room else { return }
        unfinishedGames.removeAll { $0.roomId == room }
        if lastRoom == room { lastRoom = ""; lastGuests = 0 }
        saveUnfinished()
    }

    /// Rejoin one of them. The newest entry is the same table the landing
    /// screen's Continue card points at, so both go down the same path.
    func resume(_ game: UnfinishedGame) {
        lastRoom = game.roomId
        lastGuests = game.guests
        continueGame()
    }

    // MARK: - wallet & store

    @Published var wallet: Wallet?

    /// Coins that have just been paid, for the counter in the top right to
    /// catch. Set only when the server's earned watermark actually moved.
    struct CoinCredit: Identifiable, Equatable {
        let id = UUID()
        /// What just landed, and what the wallet came to once it had.
        let amount: Int
        let total: Int
    }
    @Published var coinCredit: CoinCredit?

    /// The watermark this session has already shown. Nil until the first read,
    /// which is what keeps the app from throwing coins at the screen for a
    /// wallet it is merely seeing for the first time.
    private var shownEarned: Int?

    /// Re-reads the wallet and, when the reading is a payout rather than the
    /// same number again, hands it to the counter.
    ///
    /// Every credit in the app comes back through here — a win, the daily, a
    /// rewarded view, a coin pack — because each of those already re-reads the
    /// wallet rather than trusting its own reply. So this is the only place
    /// that has to know what a payout looks like.
    func refreshWallet() {
        Task { [weak self] in
            guard let self else { return }
            guard let base = serverURL,
                  var comps = URLComponents(url: base.appending(path: "/api/wallet"), resolvingAgainstBaseURL: false)
            else { return }
            comps.queryItems = [URLQueryItem(name: "token", value: token)]
            guard let url = comps.url,
                  let (data, _) = try? await URLSession.shared.data(from: url),
                  let fresh = try? JSONDecoder().decode(Wallet.self, from: data) else { return }
            note(fresh)
        }
    }

    /// The wallet as the server just reported it. A spend leaves the watermark
    /// where it was and passes quietly; a payout moves it and is announced.
    ///
    /// Three credits at once: two that land between two reads arrive here as
    /// one jump and are announced as their sum. Three that arrive as three
    /// separate reads each set a fresh credit, and the counter re-aims at the
    /// newest total from whatever it is showing — it never counts backwards.
    private func note(_ fresh: Wallet) {
        defer { wallet = fresh }
        guard let earned = fresh.earned else { return }
        guard let seen = shownEarned else { shownEarned = earned; return }
        shownEarned = earned
        guard earned > seen else { return }
        coinCredit = CoinCredit(amount: earned - seen, total: fresh.coins)
    }

    private let socket = SocketIOClient()

    /// What the server believes it has sent this connection, kept as raw JSON
    /// so a `statePatch` has something to be applied to. Untouched — and
    /// unused — by a server that only ever speaks in whole states.
    private let mirror = StateMirror()

    /// Extra seats played from this same device (pass & play). Each guest keeps
    /// its own socket because the server binds a seat to the connection that
    /// joined it — intents must come from the right one.
    struct LocalGuest: Identifiable {
        let token: String
        let number: Int
        let socket: SocketIOClient
        var id: String { token }
    }
    @Published var guests: [LocalGuest] = []
    /// Team-channel lines only a guest seat's socket ever received. The server
    /// strips other teams' chat per viewer, so a guest on another team gets
    /// their channel on THEIR socket — the main push never carries it.
    @Published private var guestTeamChat: [ChatMessage] = []
    private var lastCardAt: Double = 0
    /// The theatre's curtain: until this moment the dock and the centre well
    /// hold back decision UI born of the action still walking — the mover's
    /// buy prompt, an auction the landing opened. Nil whenever nothing is
    /// held; its own task clears it, so views re-render exactly on cue.
    @Published var holdUntil: Date?
    /// Whose piece the current hold belongs to. Only ever read alongside
    /// holdUntil, so it changes when the published date does.
    private var heldMover: String?
    /// The auction on stage opened while that walk was still going, so it
    /// waits for the curtain. A pre-existing auction (rebids) never sets it.
    private var auctionUnderHold = false
    private var heldActionAt: Double = 0
    private var holdTask: Task<Void, Never>?
    private var lastTurnPlayer: String?
    private var lastLogAt: Double = 0
    private var bannerTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?

    init() {
        // Anybody who typed an address into the old Server row has no way to
        // undo it now that the row is gone. On a phone, "localhost" means the
        // phone itself, where nothing is listening — it can only ever be a
        // leftover, so it goes back to the real server on the next launch.
        // The simulator is left alone: there, localhost is a Mac with a
        // development server on it, which is the whole point.
        #if !targetEnvironment(simulator)
        let stored = serverURLString.lowercased()
        if stored.contains("localhost") || stored.contains("127.0.0.1") || stored.contains("[::1]") {
            serverURLString = GameStore.defaultServer
        }
        #endif
        meId = token
        socket.onStatus = { [weak self] s in
            Task { @MainActor in self?.connection = s; self?.onSocketStatus(s) }
        }
        socket.onEvent = { [weak self] name, args in
            Task { @MainActor in self?.onSocketEvent(name, args) }
        }
    }

    // MARK: - connection flow

    private func onSocketStatus(_ s: SocketIOClient.Status) {
        // After any (re)connect, reclaim the seat — the server holds it during
        // the grace period, so a flaky network doesn't cost the player a turn.
        if s == .connected, let roomId {
            // A reconnect is a new socket as far as the server is concerned, so
            // whatever it remembered sending us died with the old one.
            mirror.forget()
            // …and the first state it sends is where everything stands, not
            // a replay of what happened while we were away.
            primed = false
            socket.emit("join", [[
                "roomId": roomId,
                "token": token,
                "name": nickname.isEmpty ? "Player" : nickname,
                "flag": flag,
                // Say we can stitch diffs and the table stops re-sending the
                // board thirty times a minute. Silence keeps the old contract.
                "proto": StateMirror.protocolVersion,
            ] as [String: Any]])
        }
    }

    private func onSocketEvent(_ name: String, _ args: [Any]) {
        switch name {
        case "you":
            if let dict = args.first as? [String: Any], let pid = dict["playerId"] as? String {
                meId = pid
            }
        case "state":
            guard let dict = args.first as? NSDictionary else { return }
            mirror.adopt(dict)
            decodeState(dict)
        case "statePatch":
            // Only what moved. Rebuilt against the last state this socket was
            // sent, and handed on as if the server had spelled the whole thing
            // out — nothing downstream can tell the difference.
            guard let message = args.first as? NSDictionary else { return }
            switch mirror.apply(message) {
            case .state(let dict): decodeState(dict)
            case .feeds: break
            case .resync: socket.emit("resync")
            }
        case "toast":
            if let dict = args.first as? [String: Any], let msg = dict["message"] as? String {
                showToast(msg, isError: (dict["type"] as? String) == "error")
            }
        case "joinFailed":
            if let dict = args.first as? [String: Any], let msg = dict["message"] as? String {
                // A table with no seat left still sends its state a beat later,
                // so the player lands on a board they simply cannot touch. Say
                // out loud that they are watching — the same line the web
                // shows — instead of leaving them to work it out.
                let spectating = dict["spectate"] as? Bool ?? false
                showToast(spectating ? "\(msg) — you're watching this table" : msg,
                          isError: !spectating, glyph: spectating ? .eye : nil)
                joinError = spectating ? nil : msg
            }
        default:
            break
        }
    }

    /// The one way a state becomes a GameState, whether the server spelled it
    /// out or we rebuilt it from a patch.
    private func decodeState(_ dict: NSDictionary) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return }
        do {
            apply(try JSONDecoder().decode(GameState.self, from: data))
        } catch {
            // One malformed push must not kill the session; keep the last
            // state. The mirror keeps the raw dictionary either way, so the
            // next patch still has something true to sit on.
            print("state decode failed:", error)
        }
    }

    private func apply(_ new: GameState) {
        let old = state
        state = new

        // Coming back to a table the server has already forgotten: a join on a
        // dead code quietly opens a NEW room under it, so the game never
        // "fails" to load — it just isn't there. An empty lobby where a game
        // in progress should be is exactly what gone looks like.
        if let want = resumeCheck, new.id == want {
            resumeCheck = nil
            if new.isLobby, new.players.count <= guests.count + 1 {
                dropUnfinished(want)
                showToast("That table is gone — the game finished without you", isError: true)
                leaveRoom()
                return
            }
        }

        noteChat()

        // Keep History's list of tables still waiting for this device honest.
        noteUnfinished(new)
        if new.isEnded { dropUnfinished(new.id) }

        // A rematch puts the table back in the lobby: whatever the last game
        // still had on stage is over with it.
        if new.isLobby { resetLedger() }
        // The first state of a table, the first after a (re)connect, and the
        // first of a game just dealt are a position, not news: every number
        // snaps into place, nothing sounds and no walk starts. A game that
        // has only just ended is still news — its last act may be on stage.
        let priming = old.map { !primed || !($0.isPlaying || $0.isEnded) } ?? true
        if priming {
            resetLedger()
            primed = true
            positionVersion = new.version
        }
        let freshLines = new.log.filter { $0.at > lastLogAt }
        if let last = new.log.last, last.at > lastLogAt { lastLogAt = last.at }

        // Open the act this push starts, and its curtain, before any money is
        // looked at: a push that starts a walk is exactly the push whose rent
        // must wait for it.
        let opened = noteJourney(old, new, priming: priming)
        if !priming, let old {
            ledger(old, new, opened: opened, lines: freshLines)
        }
        // The dice are the one thing a roll says out loud on arrival — they
        // are what everybody is watching while the piece waits to set off.
        if !priming, freshLines.contains(where: { $0.kind == "dice" }) {
            SoundKit.shared.dice()
        }

        // Auction has its own voice: the gavel when it opens, and a rising
        // paddle-tick for every new bid — pitched by how high the bid is.
        // Never held; only a position (a reconnect into a running auction)
        // keeps it quiet.
        if let old, !priming {
            if new.auction != nil, old.auction == nil {
                // Born of a landing whose walk is still on stage: the box
                // waits for the curtain (auctionCurtained hides it for every
                // viewer — spectators watch the same walk) and the gavel
                // waits with it. Auctions already running never hide.
                if theatreLive {
                    auctionUnderHold = true
                } else {
                    SoundKit.shared.auction()
                }
            } else if let a = new.auction, let b = old.auction, a.bid > b.bid {
                SoundKit.shared.bid(a.bid)
                Haptics.tap()
            }
        }

        // A completed country set is a moment — the tiles flash (TileView),
        // the fanfare plays exactly once from here.
        if let old, !priming, new.isPlaying, old.isPlaying, let groups = new.map.groups {
            for (_, idxs) in groups where idxs.count > 1 {
                guard let firstOwner = new.owner(of: idxs[0])?.owner,
                      idxs.allSatisfy({ new.owner(of: $0)?.owner == firstOwner }) else { continue }
                let wasComplete = idxs.allSatisfy { old.owner(of: $0)?.owner == firstOwner }
                if !wasComplete {
                    SoundKit.shared.setComplete()
                    Haptics.turn()
                    break
                }
            }
        }

        // card popup — fires once per draw, but only AFTER the token has
        // actually walked onto the Treasure/Surprise tile. The server resolves
        // instantly; the reveal must not beat the piece to the square.
        if let card = new.lastCard, card.at != lastCardAt {
            lastCardAt = card.at
            if !priming {
                // Servers that ship the moves script give the exact reveal
                // cue; the walk-length heuristic covers the older ones.
                let legs = new.moves ?? []
                let delay: Double
                if let newest = legs.last?.at, abs(newest - card.at) < 2500 {
                    // On the act's own clock: a doubles re-roll queued behind
                    // the walk before it has not set off yet, and sets off
                    // after a breath rather than the dice spring.
                    let act = journey(for: newest)
                    let wait = act.map { max(0, $0.startAt.timeIntervalSinceNow) } ?? 0
                    delay = wait + (Choreography.timeline(legs, boardSize: new.map.size, hasCard: true,
                                                          lead: act?.lead ?? Choreography.diceLead).cardAt ?? 0)
                } else {
                    delay = walkDelay(in: new, eventAt: card.at)
                }
                if delay > 0 {
                    Task { [weak self] in
                        try? await Task.sleep(for: .milliseconds(Int(delay * 1000)))
                        guard let self, self.state?.lastCard?.at == card.at else { return }
                        withAnimation { self.cardPopup = card }
                        SoundKit.shared.card()
                    }
                } else {
                    cardPopup = card
                    SoundKit.shared.card()
                }
            }
        }

        // The deadlock rule explains itself the one time it becomes possible.
        // The server keeps the card in every push from then on, so the `at`
        // stamp — not its presence — is what makes it news, and the stamp is
        // remembered on disk so a rejoin doesn't teach the rule twice.
        if let relief = new.reliefCard, relief.at != reliefSeenAt {
            reliefSeenAt = relief.at
            withAnimation { reliefPopup = relief }
            SoundKit.shared.card()
            Haptics.tap()
        }

        // turn banner — when the turn passes to someone new
        if new.isPlaying, let turnId = new.turn?.playerId, turnId != lastTurnPlayer {
            lastTurnPlayer = turnId
            if let p = new.player(turnId), old?.isPlaying == true {
                bannerTask?.cancel()
                turnBanner = p
                bannerTask = Task {
                    try? await Task.sleep(for: .seconds(1.8))
                    if !Task.isCancelled { turnBanner = nil }
                }
            }
            // ANY seat on this phone: pass & play hands the buzz to whoever
            // is being passed the phone, not just the primary player.
            if localIds.contains(turnId) { Haptics.turn(); SoundKit.shared.turn() }
        }

        // A fresh game: deal the board in and announce this game's top country.
        if new.isPlaying && old?.isPlaying != true {
            boardIntroAt = Date()
            // Everything said before this moment is history, not news: lobby
            // joins when we watched the table fill, or a whole backlog of bot
            // turns when this device walks in on a game already going (no old
            // state then — the incoming push carries the backlog itself). A
            // rematch runs back through lobby → playing, so it re-floors here.
            logFloor = (old ?? new).log.last?.at ?? 0
            timedOut = false
            SoundKit.shared.shuffleDeal()
            // A game this device is playing, counted once. Guarded on a seat
            // of ours being at the table: a game this device is only watching
            // is not this device playing.
            //
            // This transition on its own would count too many. `old` is nil
            // whenever state was cleared, which is every join — including the
            // one behind the Continue card — so a match walked back into is
            // indistinguishable from a match dealt in, and somebody whose
            // connection drops four times would look like four players. With
            // no previous state to compare against the board has to vouch for
            // itself: a table that has genuinely just been dealt owns nothing
            // and has nobody off START. A rematch keeps its room id, so id
            // alone cannot tell the two apart — but a rematch does go back
            // through its lobby with us watching, which is why the plain
            // transition still counts.
            if new.players.contains(where: { localIds.contains($0.id) }) {
                let dealtInHere: Bool
                if old != nil {
                    dealtInHere = true
                } else {
                    let untouched = new.ownership.isEmpty && new.players.allSatisfy { $0.pos == 0 }
                    dealtInHere = untouched && walkedInto.insert(new.id).inserted
                }
                if dealtInHere {
                    // "With people" means somebody at this table is not on this
                    // phone and is not the house — pass & play against bots is
                    // still one person alone with the app, and reads differently.
                    let withPeople = new.players.contains {
                        !localIds.contains($0.id) && !($0.isBot ?? false) && !$0.id.hasPrefix("bot:")
                    }
                    AdSignal.playedGame(withPeople: withPeople)
                }
            }
            if let top = new.map.tiles.filter({ $0.type == "property" }).max(by: { ($0.price ?? 0) < ($1.price ?? 0) }),
               let g = top.group, let info = new.groups[g] {
                revealTask?.cancel()
                revealTask = Task { [weak self] in
                    try? await Task.sleep(for: .milliseconds(900))   // let the deal land first
                    guard !Task.isCancelled else { return }
                    self?.reveal = "\(info.flag) \(info.name) holds the priciest streets this game!"
                    try? await Task.sleep(for: .seconds(3.4))
                    if !Task.isCancelled { self?.reveal = nil }
                }
            }
        }

        // Losing your chair to the clock is not something to discover by
        // scrolling the log — raise the overlay the moment it lands.
        if let old {
            for p in new.players where p.removedFor == "timeout" && localIds.contains(p.id) {
                guard old.player(p.id)?.removedFor != "timeout" else { continue }
                timedOut = true
                SoundKit.shared.lose()
                Haptics.warn()
                break
            }
        }
        // …and it comes down again the moment the seat is back in play. A
        // rematch resets everyone, and the explainer used to sit there over
        // the fresh lobby blocking the whole screen.
        // …and it comes down again once the seat is back in play, or once the
        // game is over — "stay and watch how it ends" is a dead offer then,
        // and the result sheet has to sit on a clean screen.
        if timedOut, new.isEnded
            || !new.players.contains(where: { $0.removedFor == "timeout" && localIds.contains($0.id) }) {
            timedOut = false
        }

        // game over, once — the result lands in History and the win may have
        // paid out coins, so the wallet is worth another look. The fanfare and
        // the sheet belong to the ledger: the push that ends a game is usually
        // the push that bankrupts somebody, and both wait for the act on
        // stage (see finale). A table first seen already over has no act: its
        // sheet goes straight up, and quietly — that is a position, not news.
        if new.isEnded && old?.isEnded != true {
            if priming {
                showGameOver = true
                settleWallet(after: 1)
            }
            recordMatch(new)
            // Two quiet counters, kept here because this is the one place a
            // game is certain to have actually ended with this device at the
            // table. They decide when the app has earned the right to ask for
            // a review, and for permission to notify — the result sheet does
            // the asking, this only keeps the score.
            if localSeatWon(new) {
                ReviewPrompt.noteWin()
                // …and the same moment is the one a paid install is bought
                // towards. Only the first win moves anything — a stranger
                // turning into a player is news, the tenth win is not — and
                // AdSignal is where that is decided.
                AdSignal.wonGame()
            }
            if new.players.contains(where: { localIds.contains($0.id) }) {
                PushRegistrar.noteFinishedGame()
            }
            // The wallet is read once the sheet is up (see finale): coins
            // flying into the counter before the fanfare would give the win
            // away while the last piece is still walking.
        }
        if !new.isEnded { showGameOver = false }
        // The log's own sounds — buy, jail, build, trade, the bankruptcy —
        // ride the ledger's entries now (see voice), so they land with the
        // money they describe; only the dice are said on arrival, above.
    }

    // MARK: - acts and paydays

    /// A fresh leg stamp opens an act: the walk's timeline, the curtain that
    /// holds the decision UI it causes, and the journey its money will wait
    /// for. Returns the new journey's key when one opened.
    ///
    /// The curtain is cosmetic — the shot clock runs on the server — so it
    /// is never allowed to eat more than 4 s of the act; the money may wait
    /// up to Choreography.moneyCap.
    private func noteJourney(_ old: GameState?, _ new: GameState, priming: Bool) -> Double? {
        guard let legs = new.moves, let newest = legs.last?.at, newest != heldActionAt else { return nil }
        heldActionAt = newest
        holdTask?.cancel()
        auctionUnderHold = false
        guard !priming, let old, old.isPlaying, new.isPlaying || new.isEnded,
              let mover = legs.first?.playerId else {
            heldMover = nil
            holdUntil = nil
            return nil
        }

        let now = Date()
        let size = new.map.size
        let hasCard = new.lastCard.map { abs($0.at - newest) < 2500 } ?? false
        // A bot's doubles re-roll lands while its first walk is still going.
        // Cutting that walk short to start the next one threw its landing —
        // and the rent it carried — away, so the second act waits its turn,
        // unless the queue has grown so long the table would be watching a
        // replay; then the older act is shown at once and cut, as before.
        var startAt = now
        var queued = false
        if let ahead = journeys.last(where: { $0.mover == mover && $0.landAt > now }) {
            if ahead.landAt.timeIntervalSince(now) > 6 {
                for key in journeys.filter({ $0.mover == mover }).map(\.key) { flush(key) }
            } else {
                startAt = ahead.landAt
                queued = true
            }
        }
        let lead = queued ? Choreography.settle : Choreography.diceLead
        let landAt = startAt.addingTimeInterval(
            Choreography.payday(legs, boardSize: size, hasCard: hasCard, lead: lead))

        var cast: Set<String> = [mover]
        for p in new.players where old.player(p.id).map({ $0.money != p.money }) ?? false {
            cast.insert(p.id)
        }
        // …and anybody this push put out of the game. A collect-from-everyone
        // card bankrupts through forcePay, and a seat that already stood at $0
        // moves no money at all — its bust is still this act's doing, and must
        // not be heard while the dice are still in the air.
        for p in new.players where p.isBankrupt && old.player(p.id)?.isBankrupt == false {
            cast.insert(p.id)
        }
        if let debt = new.turn?.debt {
            if let creditor = debt.creditor { cast.insert(creditor) }
            cast.formUnion(debt.owedTo ?? [])
        }

        if new.isPlaying {
            // A small beat after the landing thump, capped hard.
            let run = min(Choreography.curtain(legs, boardSize: size, hasCard: hasCard, lead: lead) + 0.3, 4.0)
            let until = startAt.addingTimeInterval(run)
            heldMover = mover
            holdUntil = until
            holdTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(max(0, until.timeIntervalSinceNow)))
                guard let self, !Task.isCancelled else { return }
                withAnimation { self.holdUntil = nil }
                // The gavel waited behind the curtain with its auction.
                if self.auctionUnderHold, self.state?.auction != nil {
                    SoundKit.shared.auction()
                }
                self.auctionUnderHold = false
            }
        } else {
            heldMover = nil
            holdUntil = nil
        }

        var act = Journey(key: newest, mover: mover, cast: cast, startAt: startAt, landAt: landAt,
                          lead: lead, queued: queued, hasCard: hasCard)
        act.task = stage(newest, landAt: landAt)
        journeys.append(act)
        return newest
    }

    /// Splits one push's money between what its act holds and what shows now.
    private func ledger(_ old: GameState, _ new: GameState, opened: Double?, lines: [LogLine]) {
        guard old.isPlaying, new.isPlaying || new.isEnded else { return }

        var moved: [String: Int] = [:]
        for p in new.players {
            guard let was = old.player(p.id)?.money, was != p.money else { continue }
            moved[p.id] = p.money - was
        }
        // Beaten, not removed: a seat the clock took or that walked out has
        // its own story (the timeout overlay, "left"), not a bankruptcy.
        let busts = new.players
            .filter { $0.isBankrupt && !$0.wasRemoved && old.player($0.id)?.isBankrupt == false }
            .map(\.id)
        let ended = new.isEnded && !old.isEnded
        var kinds: [String] = []
        for line in lines where line.kind != "dice" && line.kind != "auction" && !kinds.contains(line.kind) {
            kinds.append(line.kind)
        }
        guard !moved.isEmpty || !busts.isEmpty || !kinds.isEmpty || ended else { return }

        var creditors: [String: [String]] = [:]
        for b in busts {
            guard let debt = old.turn?.debt, debt.debtor == b else { continue }
            creditors[b] = debt.creditor.map { [$0] } ?? (debt.owedTo ?? [])
        }

        // Trades and auctions settle in front of everybody — escrow moves on
        // every bid — so they are never held, unless the auction itself is
        // still behind the curtain of the landing that opened it.
        let exempt = opened == nil
            && (kinds.contains("trade") || ((old.auction != nil || new.auction != nil) && !auctionCurtained))

        var target: Int?
        if let opened {
            target = journeys.lastIndex { $0.key == opened }
        } else if !exempt {
            let touched = Set(moved.keys).union(busts)
            target = journeys.lastIndex { $0.mover == old.turn?.playerId }
                ?? journeys.lastIndex { !$0.cast.isDisjoint(with: touched) }
        }
        // An act that has already landed four entries is done taking more.
        if let t = target, journeys[t].landed >= 4, journeys[t].entries.isEmpty { target = nil }

        guard let t = target else {
            voice(Entry(delta: moved, kinds: kinds, busts: busts, creditors: creditors, ended: ended))
            return
        }

        let act = journeys[t]
        var onStage = Entry(), atOnce = Entry()
        for (pid, d) in moved {
            if act.cast.contains(pid) { onStage.delta[pid] = d } else { atOnce.delta[pid] = d }
        }
        for b in busts {
            // A collect-from-everyone card bankrupts somebody through forcePay,
            // with no debt ever opened: the card's drawer is who took them out.
            var by = creditors[b]
            if by == nil, b != act.mover, act.hasCard { by = [act.mover] }
            if act.cast.contains(b) {
                onStage.busts.append(b)
                if let by { onStage.creditors[b] = by }
            } else {
                atOnce.busts.append(b)
                if let by { atOnce.creditors[b] = by }
            }
        }
        // The log lines describe the money: they go where it goes. A fresh act
        // keeps its lines even when nobody paid anything (a walked jailing
        // clanks when the piece reaches the cell, not as it sets off).
        if opened != nil || !onStage.delta.isEmpty || !onStage.busts.isEmpty {
            onStage.kinds = kinds
        } else {
            atOnce.kinds = kinds
        }
        // The finale waits for the act on stage, unless the bust that ended
        // the game is being voiced right now — then it follows that.
        if atOnce.busts.isEmpty { onStage.ended = ended } else { atOnce.ended = ended }

        if !onStage.isEmpty {
            if journeys[t].landed + journeys[t].entries.count >= 4, !journeys[t].entries.isEmpty {
                journeys[t].entries[journeys[t].entries.count - 1].merge(onStage)
            } else {
                journeys[t].entries.append(onStage)
            }
            for (pid, d) in onStage.delta { held[pid, default: 0] += d }
            heldBusts.formUnion(onStage.busts)
            if onStage.ended { endOnStage = true }
        }
        if !atOnce.isEmpty { voice(atOnce) }
    }

    /// The act's release: its first entry lands on payday, each later one a
    /// beat after the last — rent, then a bot's scramble to raise it, then the
    /// bust. An entry arriving while the act is still releasing takes the next
    /// beat, and the act lingers one beat after its last entry for exactly
    /// that reason, so a late bust never lands on top of the rent.
    private func stage(_ key: Double, landAt: Date) -> Task<Void, Never> {
        Task { [weak self] in
            let wait = landAt.timeIntervalSinceNow
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            while !Task.isCancelled {
                guard let self, let i = self.journeys.firstIndex(where: { $0.key == key }) else { return }
                guard !self.journeys[i].entries.isEmpty else {
                    self.journeys.remove(at: i)
                    return
                }
                let entry = self.journeys[i].entries.removeFirst()
                self.journeys[i].landed += 1
                self.land(entry)
                try? await Task.sleep(for: .seconds(Choreography.entryGap))
            }
        }
    }

    /// Everything an act was still holding, shown now and in one breath —
    /// the act is being cut short.
    private func flush(_ key: Double) {
        guard let i = journeys.firstIndex(where: { $0.key == key }) else { return }
        let act = journeys.remove(at: i)
        act.task?.cancel()
        guard var all = act.entries.first else { return }
        for e in act.entries.dropFirst() { all.merge(e) }
        land(all)
    }

    /// An entry's money comes out of the held purse and says its piece.
    private func land(_ e: Entry) {
        for (pid, d) in e.delta {
            let left = (held[pid] ?? 0) - d
            if left == 0 { held.removeValue(forKey: pid) } else { held[pid] = left }
        }
        if !e.busts.isEmpty { heldBusts.subtract(e.busts) }
        voice(e)
    }

    /// One change, one event: the badge, the coins, the count, its sound and
    /// its haptic — whether it shows on arrival or at its payday.
    private func voice(_ e: Entry) {
        let sound = SoundKit.shared
        // The bust's own "+$X" — its debt written off to zero — is not a
        // payment anybody made, and its bankruptcy says everything already.
        for (pid, d) in e.delta where d != 0 && !e.busts.contains(pid) {
            flashDelta(pid, d)
        }

        var bustVoice: Double = 0
        if !e.busts.isEmpty {
            // Whose bankruptcy it is decides how it sounds on this phone. A
            // pass & play phone holding both sides hears the fall.
            let creditors = Set(e.busts.flatMap { e.creditors[$0] ?? [] })
            if e.busts.contains(where: { isLocal($0) }) {
                sound.bankruptFall()
                Haptics.warn()
                bustVoice = 2.1
            } else if creditors.contains(where: { isLocal($0) }) {
                sound.bankruptKaching()
                after(0.12) { Haptics.turn() }
                bustVoice = 1.2
            } else {
                sound.bankruptCrash()
                bustVoice = 1.2
            }
        } else {
            var localGain = false, localLoss = false, remote = false
            for (pid, d) in e.delta where d != 0 {
                if isLocal(pid) {
                    if d < 0 { localLoss = true } else { localGain = true }
                } else {
                    remote = true
                }
            }
            // Your own purse gets its own voice — losing money makes that
            // little "ishh", gaining rings as the payee's first coin lands and
            // its count starts. Everybody else's is the room's sound.
            if localLoss {
                sound.lose()
                Haptics.warn()
            } else if localGain {
                after(0.25) { SoundKit.shared.gain(); Haptics.tap() }
            } else if remote {
                if e.kinds.contains("rent") { sound.rent() } else { sound.cash() }
            }
            if e.kinds.contains("buy") { sound.buy(); Haptics.tap() }
            else if e.kinds.contains("jail") { sound.jail() }
            else if e.kinds.contains("build") { sound.build() }
            else if e.kinds.contains("trade") { sound.trade() }
        }

        if e.ended { finale(after: bustVoice) }
    }

    /// The game is over and its last act has landed: the fanfare once the
    /// bust has had its say, then the result sheet 0.7 s later.
    private func finale(after delay: Double) {
        finaleTask?.cancel()
        finalePending = true
        endOnStage = true
        finaleTask = Task { [weak self] in
            if delay > 0 { try? await Task.sleep(for: .seconds(delay)) }
            guard let self, !Task.isCancelled else { return }
            guard let over = self.state, over.isEnded else {
                // The table moved on before the fanfare's turn came.
                self.finalePending = false
                self.endOnStage = false
                return
            }
            let mine = self.localSeatWon(over)
            SoundKit.shared.win(mine: mine)
            // The trophy goes up in the well as the fanfare starts.
            withAnimation { self.endOnStage = false }
            try? await Task.sleep(for: .seconds(0.32))
            guard !Task.isCancelled else { return }
            // The chord lands at 0.32 — the phone of the seat that won feels it.
            if mine { Haptics.turn() }
            try? await Task.sleep(for: .seconds(0.38))
            guard !Task.isCancelled, self.state?.isEnded == true else { return }
            self.finalePending = false
            self.showGameOver = true
            self.settleWallet(after: 0.3)
        }
    }

    /// A win pays out on the server a beat after the table settles; whatever
    /// it came to, the counter catches it — landing on the result sheet, as
    /// the coin counter was made to.
    private func settleWallet(after seconds: Double) {
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            self?.refreshWallet()
        }
    }

    /// Puts every figure back on what the server says, silently: nothing on
    /// stage survives a position. A result sheet the dropped act still owed
    /// goes up anyway — the game is over whether or not its fanfare played.
    private func resetLedger() {
        let owedSheet = finalePending || journeys.contains { $0.entries.contains(where: \.ended) }
        journeys.forEach { $0.task?.cancel() }
        journeys = []
        if !held.isEmpty { held = [:] }
        if !heldBusts.isEmpty { heldBusts = [] }
        finaleTask?.cancel()
        finaleTask = nil
        finalePending = false
        if endOnStage { endOnStage = false }
        if owedSheet, state?.isEnded == true {
            showGameOver = true
            settleWallet(after: 0.3)
        }
    }

    /// The floating "+$200 / −$150" for one seat, cleared after a beat unless
    /// a newer one has replaced it.
    private func flashDelta(_ pid: String, _ amount: Int) {
        let delta = MoneyDelta(amount: amount)
        moneyDeltas[pid] = delta
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.6))
            if self?.moneyDeltas[pid]?.id == delta.id {
                _ = withAnimation { self?.moneyDeltas.removeValue(forKey: pid) }
            }
        }
    }

    private func after(_ seconds: Double, _ run: @escaping @MainActor () -> Void) {
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(seconds))
            run()
        }
    }

    /// A player as the table should see them right now: the money their act
    /// is still holding not yet spent or received, and a bust that has not
    /// landed not yet out. Seats, pods, ranks and pieces read this; every
    /// decision reads the raw state.
    func shown(_ p: PlayerState) -> PlayerState {
        let pending = held[p.id] ?? 0
        let bustHeld = heldBusts.contains(p.id)
        guard pending != 0 || bustHeld else { return p }
        var q = p
        q.money -= pending
        if let worth = q.netWorth { q.netWorth = worth - pending }
        if bustHeld { q.bankrupt = false }
        return q
    }

    var shownPlayers: [PlayerState] { (state?.players ?? []).map(shown) }

    /// The act a leg stamp belongs to, while it is still on stage. The walker
    /// plays only these, on their clock — anything else is a position.
    func journey(for stamp: Double) -> Journey? {
        journeys.first { $0.key == stamp }
    }

    /// A walk is on stage right now. The date check is belt and braces — the
    /// hold's own task publishes nil the moment the act ends.
    private var theatreLive: Bool { holdUntil.map { $0 > Date() } ?? false }

    /// The dock's decision controls for this seat wait while its own move is
    /// still walking — my buy prompt must not beat my piece to the square.
    /// Unrelated seats, chat and every other control never wait.
    func theatreHolding(for seat: String?) -> Bool {
        theatreLive && seat != nil && seat == heldMover
    }

    /// The auction born of the landing still on stage: every viewer watches
    /// the walk finish before the box appears. Rebids mid-auction never hide.
    var auctionCurtained: Bool { theatreLive && auctionUnderHold }

    /// How long the token on screen still needs to finish its walk for the
    /// move that caused this event — mirrors TokenWalker's pacing.
    private func walkDelay(in state: GameState, eventAt: Double) -> Double {
        guard let move = state.lastMove, move.steps != 0,
              abs(move.at - eventAt) < 2500 else { return 0 }
        let distance = abs(move.steps)
        let pace: Double = distance > 12 ? 0.07 : distance > 7 ? 0.095 : 0.13
        return Double(distance) * pace + 0.35
    }

    func showToast(_ text: String, isError: Bool = false, glyph: Glyph? = nil) {
        toastTask?.cancel()
        toast = ToastMessage(text: text, isError: isError, glyph: glyph)
        toastTask = Task {
            try? await Task.sleep(for: .seconds(2.6))
            if !Task.isCancelled { toast = nil }
        }
    }

    // MARK: - room lifecycle

    func createRoom() {
        SoundKit.shared.warmUp()
        guard let url = serverURL else { return showToast("Set a valid server URL", isError: true) }
        joinError = nil
        socket.connect(to: url)
        socket.emit("createRoom", [[String: String]()]) { [weak self] args in
            Task { @MainActor in
                guard let self else { return }
                if let dict = args.first as? [String: Any], let id = dict["roomId"] as? String {
                    self.join(roomId: id)
                } else {
                    self.showToast("Could not create a room", isError: true)
                }
            }
        }
    }

    /// Matchmaking: the server answers with a public table that is already
    /// filling up (or opens a fresh one), and we join it like any other room.
    func quickPlay() {
        SoundKit.shared.warmUp()
        guard let url = serverURL else { return showToast("Set a valid server URL", isError: true) }
        joinError = nil
        quickSearching = true
        socket.connect(to: url)
        socket.emit("quickplay", [[String: String]()]) { [weak self] args in
            Task { @MainActor in
                guard let self else { return }
                self.quickTask?.cancel()
                self.quickSearching = false
                if let dict = args.first as? [String: Any], let id = dict["roomId"] as? String {
                    self.join(roomId: id)
                } else {
                    self.showToast("Matchmaking didn't answer — create or join a room instead", isError: true)
                }
            }
        }
        // A tap must never dead-end: if the ack never lands, say so out loud
        // and hand the player back the normal ways in.
        quickTask?.cancel()
        quickTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(8))
            guard let self, !Task.isCancelled, self.quickSearching else { return }
            self.quickSearching = false
            // Drop the socket too: a retry loop left running would keep the
            // landing screen looking busy long after we gave up.
            self.socket.close()
            self.showToast("Couldn't reach matchmaking — create or join a room instead", isError: true)
        }
    }

    func join(roomId id: String) {
        SoundKit.shared.warmUp()
        guard let url = serverURL else { return showToast("Set a valid server URL", isError: true) }
        joinError = nil
        quickSearching = false
        roomId = id.lowercased().trimmingCharacters(in: .whitespaces)
        lastRoom = roomId ?? ""
        resumeCheck = nil
        // A new table starts with only this seat on the device; continueGame()
        // reads the old count before calling in, so it keeps its guests.
        lastGuests = 0
        state = nil
        // The old table's acts end here; the new table's first state is a
        // position.
        resetLedger()
        primed = false
        // Versions count per room, so the copy we hold of the old table must
        // not be left lying around for a patch from it to line up against.
        mirror.forget()
        guestTeamChat = []
        lastTurnPlayer = nil
        if connection == .connected {
            onSocketStatus(.connected) // emit join now
        } else {
            socket.connect(to: url)
        }
    }

    /// Rejoins the last room and quietly re-seats every pass & play guest this
    /// device had — their tokens are deterministic, so the server hands each
    /// seat straight back.
    func continueGame() {
        guard !lastRoom.isEmpty else { return }
        let guestsToRestore = lastGuests
        let want = lastRoom
        join(roomId: want)
        // join() clears this for a plain join; a resume is the one case where
        // the room is expected to already hold a game of ours.
        resumeCheck = want
        guard let url = serverURL, let roomId else { return }
        for number in 2...(max(2, guestsToRestore + 1)) where guestsToRestore > 0 {
            let guestToken = "\(token)_p\(number)"
            guard !guests.contains(where: { $0.token == guestToken }) else { continue }
            let s = makeGuestSocket(token: guestToken, number: number, roomId: roomId)
            s.connect(to: url)
            guests.append(LocalGuest(token: guestToken, number: number, socket: s))
        }
    }

    /// The socket a pass & play guest rides on. It reclaims the seat on every
    /// (re)connect, and it listens to its own state pushes: the server strips
    /// other teams' chat per viewer, so a guest's team channel only ever
    /// arrives here — the main socket cannot hear it for them.
    private func makeGuestSocket(token guestToken: String, number: Int, roomId: String) -> SocketIOClient {
        let s = SocketIOClient()
        // A guest reads nothing but the chat off its push, so its mirror keeps
        // the feeds and the version and lets the rest of every patch go by.
        let mirror = StateMirror(feedsOnly: true)
        s.onStatus = { status in
            Task { @MainActor in
                guard status == .connected else { return }
                mirror.forget()
                s.emit("join", [[
                    "roomId": roomId,
                    "token": guestToken,
                    "name": "Player \(number)",
                    "flag": "",
                    "proto": StateMirror.protocolVersion,
                ] as [String: Any]])
            }
        }
        s.onEvent = { [weak self] name, args in
            Task { @MainActor in self?.onGuestSocketEvent(name, args, mirror: mirror, socket: s) }
        }
        return s
    }

    /// Only the chat is worth reading off a guest's push — the main socket
    /// already applies the full state — and only the team channel of it: the
    /// public channel arrives on the main connection for everyone.
    private func onGuestSocketEvent(_ name: String, _ args: [Any],
                                    mirror: StateMirror, socket s: SocketIOClient) {
        switch name {
        case "state":
            guard let dict = args.first as? NSDictionary else { return }
            mirror.adopt(dict)
        case "statePatch":
            guard let message = args.first as? NSDictionary else { return }
            if case .resync = mirror.apply(message) { s.emit("resync"); return }
        default:
            return
        }
        // Only the lines this push actually brought: after a patch that is the
        // tail alone, so a guest seat stops decoding fifty unchanged messages
        // to find the one that is news.
        let arrivals = mirror.chatArrivals
        guard arrivals.count > 0,
              let data = try? JSONSerialization.data(withJSONObject: arrivals),
              let chat = try? JSONDecoder().decode([ChatMessage].self, from: data) else { return }
        let fresh = chat.filter { msg in
            msg.isTeam && !guestTeamChat.contains(where: { $0.id == msg.id })
        }
        guard !fresh.isEmpty else { return }
        guestTeamChat.append(contentsOf: fresh)
        // The server itself keeps 100 lines; there is nothing older to show.
        guestTeamChat = Array(guestTeamChat.suffix(100))
        // Team lines reach a guest seat on its own socket rather than the main
        // push, so they would otherwise arrive without a sound or a count.
        noteChat()
    }

    /// A new line arrived, or several. Sound the ones this device did not say
    /// and count them until somebody opens the chat.
    ///
    /// A chat line carries a name, not a player id, and a table cannot hold
    /// two of the same name — so the name is what distinguishes your own voice
    /// from everyone else's, pass & play seats included.
    private func noteChat() {
        let feed = chatFeed
        guard chatPrimed else {
            // First state of this table: whatever was already said is history,
            // including nothing at all.
            chatPrimed = true
            heardChatId = feed.last?.id
            return
        }
        guard let last = feed.last, last.id != heardChatId else { return }
        // No anchor, or an anchor that has scrolled off the server's window:
        // everything in hand is news.
        let from = heardChatId.flatMap { h in feed.firstIndex { $0.id == h } }
        let fresh = from.map { Array(feed[($0 + 1)...]) } ?? feed
        heardChatId = last.id
        let ownVoices = Set((state?.players ?? []).filter { isLocal($0.id) }.map(\.name))
        let fromOthers = fresh.filter { !ownVoices.contains($0.name) }
        guard !fromOthers.isEmpty else { return }
        SoundKit.shared.pop()
        unreadChat += fromOthers.count
    }

    /// The chat is on screen — everything in it counts as read.
    func markChatRead() {
        heardChatId = chatFeed.last?.id ?? heardChatId
        if unreadChat != 0 { unreadChat = 0 }
    }

    /// Every chat line this device is entitled to read: the main push plus the
    /// team channels only guest seats' sockets receive. Deduped by the server's
    /// message id — a guest on the primary's own team hears those lines twice.
    var chatFeed: [ChatMessage] {
        // Somebody this player blocked is not somebody they read, hear, or get
        // an unread badge for — so the filter sits at the source every chat
        // surface draws from, not in one of them.
        let unblocked: (ChatMessage) -> Bool = { msg in
            guard let code = msg.code else { return true }
            return !self.blockedCodes.contains(code)
        }
        let base = (state?.chat ?? []).filter(unblocked)
        guard !guestTeamChat.isEmpty else { return base }
        let known = Set(base.map(\.id))
        let extras = guestTeamChat.filter { !known.contains($0.id) }.filter(unblocked)
        guard !extras.isEmpty else { return base }
        return (base + extras).sorted { $0.at < $1.at }
    }

    func leaveRoom() {
        // Walking out mid-game still deserves a History line — and the table
        // itself goes on the "still open" list with the time we left on it.
        if let state, state.isPlaying {
            recordMatch(state, outcome: "left")
            noteUnfinished(state)
            saveUnfinished()
        }
        guests.forEach { $0.socket.close() }
        guests = []
        guestTeamChat = []
        chatPrimed = false
        heardChatId = nil
        unreadChat = 0
        socket.close()
        mirror.forget()
        quickTask?.cancel()
        quickSearching = false
        roomId = nil
        state = nil
        joinError = nil
        timedOut = false
        lastTurnPlayer = nil
        lastCardAt = 0
        holdTask?.cancel()
        holdUntil = nil
        heldMover = nil
        auctionUnderHold = false
        heldActionAt = 0
        // Nothing held at a table this device has left is owed to anybody.
        resetLedger()
        primed = false
        positionVersion = nil
        logFloor = 0
        lastRoom = ""
        lastGuests = 0
        resumeCheck = nil
    }

    // MARK: - intents (mirror public/js actions)

    /// Room-level intents go out on the main connection; turn intents go out on
    /// the acting player's own connection (the server trusts the socket's seat).
    private func emit(_ event: String, _ args: [Any] = []) { socket.emit(event, args) }
    private func emitAsActive(_ event: String, _ args: [Any] = []) {
        socket(for: activeId).emit(event, args)
    }
    private func emitAs(_ playerId: String, _ event: String, _ args: [Any] = []) {
        socket(for: playerId).emit(event, args)
    }

    func start() { emit("start") }
    func addBot() { emit("addBot") }
    func kick(_ playerId: String) { emit("kick", [playerId]) }
    /// Hand the host chair to someone else at the table.
    func makeHost(_ playerId: String) { emit("makeHost", [["id": playerId]]) }
    func updateSettings(_ patch: [String: Any]) { emit("settings", [patch]) }
    func setAppearance(name: String? = nil, color: String? = nil, flag: String? = nil) {
        var d: [String: Any] = [:]
        if let name { d["name"] = name; nickname = name }
        if let color { d["color"] = color }
        if let flag { d["flag"] = flag; self.flag = flag }
        emit("appearance", [d])
    }
    func setTeam(_ team: Int, for playerId: String? = nil) {
        emit("team", [team, playerId ?? meId])
    }
    func balanceTeams() { emit("balanceTeams") }

    func roll() { emitAsActive("roll"); Haptics.tap() }
    func buy() { emitAsActive("buy") }
    func skipBuy() { emitAsActive("skipBuy") }
    func endTurn() { emitAsActive("endTurn") }
    func bid(_ amount: Int, as playerId: String? = nil) { emitAs(playerId ?? activeId, "bid", [amount]) }
    func passBid(as playerId: String? = nil) { emitAs(playerId ?? activeId, "passBid") }
    func jailPay() { emitAsActive("jailPay") }
    func jailCard() { emitAsActive("jailCard") }
    /// Deeds answer to the seat that owns them, whoever holds the turn — the
    /// server allows off-turn management and trusts the socket's own seat, so
    /// a locally owned street always speaks from its owner's connection.
    private func deedSeat(for tile: Int) -> String {
        let owner = state?.owner(of: tile)?.owner
        return owner.flatMap { localIds.contains($0) ? $0 : nil } ?? activeId
    }
    func build(_ tile: Int) { emitAs(deedSeat(for: tile), "build", [tile]) }
    /// Everything this street's country will take, in one press.
    func buildAll(_ tile: Int) {
        guard let group = self.tile(tile)?.group else { return }
        emitAs(deedSeat(for: tile), "buildAll", [group])
    }
    func sellHouse(_ tile: Int) { emitAs(deedSeat(for: tile), "sellHouse", [tile]) }
    func mortgage(_ tile: Int) { emitAs(deedSeat(for: tile), "mortgage", [tile]) }
    func unmortgage(_ tile: Int) { emitAs(deedSeat(for: tile), "unmortgage", [tile]) }
    func payDebt() { emitAsActive("payDebt") }
    func declareBankrupt() { emitAsActive("bankrupt") }
    /// The white flag, thrown by one of THIS device's own seats — off-turn is
    /// fine, conceding is a right, not a turn action. `seat` says which local
    /// player is giving up; the main seat when nobody says otherwise.
    func concede(as seat: String? = nil) {
        emitAs(seat.flatMap { localIds.contains($0) ? $0 : nil } ?? meId, "bankrupt")
    }
    /// Walk out of a live game for good: the deeds go back to the bank, the
    /// seat stays as a spectator, and it costs a point of karma.
    func quitGame() {
        // Leaving for good: there is nothing here to come back to, so the
        // table drops off History's "still open" list with it.
        if let roomId { dropUnfinished(roomId) }
        // Every seat this device holds walks out together — the guests are
        // people at this table, not chairs to leave behind for bots to play
        // until the clock times each one out.
        for seat in localIds { emitAs(seat, "quit") }
    }

    /// Hand a dropped player another minute. The server counts one vote per
    /// seat, so a pass & play device speaks for every seat it holds — otherwise
    /// the vote could never complete on a phone with two players on it.
    func grantTime(_ playerId: String) {
        for seat in localIds where seat != playerId {
            emitAs(seat, "grantTime", [["id": playerId]])
        }
        Haptics.tap()
    }

    /// `as` picks which local seat is talking — the server stamps the message
    /// with the socket's own seat, so on a pass & play phone Player 2's words
    /// must not ride the main connection wearing Player 1's name.
    func sendChat(_ text: String, channel: String = "all", as seat: String? = nil) {
        emitAs(seat.flatMap { localIds.contains($0) ? $0 : nil } ?? meId, "chat", [text, channel])
    }

    /// Team chat exists when teams are on and that seat is actually on one.
    /// Asked per seat because a pass & play guest can sit on a team the
    /// primary player is not.
    func hasTeamChat(for seat: String) -> Bool {
        (state?.settings.teams ?? 0) > 0 && state?.player(seat)?.team != nil
    }
    func rematch() { emit("rematch") }
    func refreshAdsConfig() {
        Task { [weak self] in
            let cfg: AdsConfig? = try? await self?.fetchJSON("/api/ads/config")
            await MainActor.run { self?.adsConfig = cfg }
        }
    }

    /// `from` picks which local seat proposes — a corner pod trades as its own
    /// player, not as whoever happens to hold the turn.
    func proposeTrade(from: String? = nil, to: String, give: TradeSide, get: TradeSide) {
        let seat = from.flatMap { localIds.contains($0) ? $0 : nil } ?? activeId
        emitAs(seat, "trade:propose", [[
            "to": to,
            "give": ["money": give.money, "tiles": give.tiles, "cards": give.cards],
            "get": ["money": get.money, "tiles": get.tiles, "cards": get.cards],
        ]])
    }
    func respondTrade(_ id: Int, accept: Bool) {
        // The responder must be the offer's target — route from their socket
        // when that target is one of our local seats.
        let target = state?.trades.first { $0.id == id }?.to ?? meId
        emitAs(localIds.contains(target) ? target : meId, "trade:respond", [["id": id, "accept": accept]])
    }
    func cancelTrade(_ id: Int) {
        // Only the proposer or target may cancel — route from the right seat.
        let from = state?.trades.first { $0.id == id }?.from ?? meId
        emitAs(localIds.contains(from) ? from : meId, "trade:cancel", [["id": id]])
    }
    /// Set an offer aside: it leaves the dock but stays in the trade list.
    func ignoreTrade(_ id: Int, ignored: Bool = true) {
        let target = state?.trades.first { $0.id == id }?.to ?? meId
        emitAs(localIds.contains(target) ? target : meId, "trade:ignore", [["id": id, "ignored": ignored]])
    }
    /// Live "is viewing" presence on an offer. Guarded so a sheet closing
    /// after the trade already resolved never emits against a dead offer.
    func setTradeViewing(_ id: Int, _ viewing: Bool, as seat: String? = nil) {
        guard state?.trades.contains(where: { $0.id == id }) == true else { return }
        let who = seat.flatMap { localIds.contains($0) ? $0 : nil } ?? meId
        emitAs(who, "trade:viewing", [["id": id, "viewing": viewing]])
    }

    // MARK: - derived helpers (mirror the web client's rule mirrors)

    /// Every seat controlled from this device: the main player plus local guests.
    var localIds: Set<String> { Set([meId] + guests.map(\.token)) }

    /// Did a seat this device played take the game? On a team table the team
    /// taking it counts — that seat won too, and the phone that held it has
    /// every right to feel like it. Takes the state rather than reading the
    /// published one so the socket can ask about a result it hasn't stored yet.
    func localSeatWon(_ state: GameState) -> Bool {
        if let team = state.winningTeam {
            return state.players.contains { localIds.contains($0.id) && $0.team == team }
        }
        return state.winner.map { localIds.contains($0.id) } ?? false
    }

    /// Whose seat the controls act for right now: the local player whose turn
    /// it is, falling back to the main player. This is what makes pass & play
    /// comfortable — the same buttons just serve whoever holds the phone.
    var activeId: String {
        if let turnId = state?.turn?.playerId, localIds.contains(turnId) { return turnId }
        return meId
    }

    var me: PlayerState? { state?.player(activeId) }
    var isHost: Bool { state?.hostId == meId }
    var isMyTurn: Bool { state?.isPlaying == true && localIds.contains(state?.turn?.playerId ?? "") }
    var currentPlayer: PlayerState? { state?.player(state?.turn?.playerId) }

    /// Live standings by net worth, player id -> position. Recomputed from
    /// the presented players, so the crown does not change hands before the
    /// rent that moves it has landed; ties fall back to seat order so two
    /// equal fortunes don't swap badges on every tick.
    var liveRanks: [String: Int] {
        guard let state, state.isPlaying else { return [:] }
        let ordered = shownPlayers.enumerated()
            .filter { !$0.element.isBankrupt }
            .sorted { a, b in
                let wa = a.element.netWorth ?? 0
                let wb = b.element.netWorth ?? 0
                return wa == wb ? a.offset < b.offset : wa > wb
            }
        var ranks: [String: Int] = [:]
        for (i, entry) in ordered.enumerated() { ranks[entry.element.id] = i + 1 }
        return ranks
    }

    /// Who plays after the current player — mirrors the server's rotation so
    /// people can look up before the turn actually lands on them.
    var nextUpId: String? {
        guard let state, state.isPlaying, let currentId = state.turn?.playerId,
              let idx = state.players.firstIndex(where: { $0.id == currentId }),
              state.players.count > 1 else { return nil }
        for step in 1...state.players.count {
            let cand = state.players[(idx + step) % state.players.count]
            guard cand.id != currentId, !cand.isBankrupt, (cand.skipTurns ?? 0) == 0 else { continue }
            return cand.id
        }
        return nil
    }

    func isLocal(_ id: String?) -> Bool { id.map { localIds.contains($0) } ?? false }

    /// Seats the table is being asked to wait for. Never one of this device's
    /// own — the card is a decision about somebody else, and the player who
    /// dropped is not the one who gets to vote themselves back in.
    var awaitingSeats: [AwaitingSeat] {
        guard let state, state.isPlaying else { return [] }
        return (state.awaiting ?? []).filter { seat in
            guard !isLocal(seat.id), let p = state.player(seat.id) else { return false }
            // The moment they reconnect (or the chair is released) the row goes.
            return p.connected != true && !p.isBankrupt && !p.wasRemoved
        }
    }

    /// True once every seat this device holds has clicked for that player.
    func hasGrantedTime(_ seat: AwaitingSeat) -> Bool {
        let mine = localIds.subtracting([seat.id])
        return !mine.isEmpty && mine.allSatisfy { seat.grantedIds.contains($0) }
    }

    private func socket(for playerId: String) -> SocketIOClient {
        guests.first { $0.token == playerId }?.socket ?? socket
    }

    /// Adds another human on this device. They join the room with their own
    /// derived identity and show up as a normal player to everyone else.
    func addLocalPlayer() {
        guard let url = serverURL, let roomId else { return }
        let number = guests.count + 2
        let guestToken = "\(token)_p\(number)"
        let s = makeGuestSocket(token: guestToken, number: number, roomId: roomId)
        s.connect(to: url)
        guests.append(LocalGuest(token: guestToken, number: number, socket: s))
        lastGuests = guests.count
        showToast("Player \(number) joined from this device")
    }

    func tile(_ i: Int) -> TileData? {
        guard let tiles = state?.map.tiles, tiles.indices.contains(i) else { return nil }
        return tiles[i]
    }

    func groupInfo(for tile: TileData) -> GroupInfo? {
        guard let g = tile.group else { return nil }
        return state?.groups[g]
    }

    func myTiles() -> [Int] {
        guard let state else { return [] }
        return state.ownership.compactMap { key, own in
            own.owner == activeId ? Int(key) : nil
        }.sorted()
    }

    func ownsFullGroup(_ playerId: String, group: String) -> Bool {
        guard let state, let idxs = state.map.groups?[group], !idxs.isEmpty else { return false }
        return idxs.allSatisfy { state.owner(of: $0)?.owner == playerId }
    }

    // The three rule mirrors below key on "a seat of OURS owns it", not on
    // whose turn it is: the server allows off-turn management, and on a pass &
    // play phone a guest's deeds must not go dumb whenever the dice move on.

    func canBuild(_ i: Int) -> Bool {
        guard let state, let t = tile(i), let own = state.owner(of: i),
              localIds.contains(own.owner), state.turn?.playerId == own.owner, t.type == "property", !own.isMortgaged,
              let group = t.group, let idxs = state.map.groups?[group] else { return false }
        guard ownsFullGroup(own.owner, group: group) else { return false }
        guard !idxs.contains(where: { state.owner(of: $0)?.isMortgaged == true }) else { return false }
        guard own.houseCount < 5 else { return false }
        if state.settings.evenBuild ?? true {
            let minHouses = idxs.map { state.owner(of: $0)?.houseCount ?? 0 }.min() ?? 0
            if own.houseCount > minHouses { return false }
        }
        return true
    }

    /**
     How many buildings one press of Build all would actually put up.

     The server decides — this only decides whether to offer the button, and
     with what on it. It walks the same loop `GameRoom.buildAll` does, always
     taking the shortest street in the country next, so the number on the
     button is the number that appears in the log a moment later rather than
     an optimistic guess the player then has to reconcile.

     Zero means don't offer it at all; one means Build already says everything
     this button would.
     */
    func buildAllCount(_ i: Int) -> Int {
        guard let state, let group = tile(i)?.group,
              let idxs = state.map.groups?[group], idxs.count > 1,
              let own = state.owner(of: i), localIds.contains(own.owner),
              // Whatever the rules say about owning the country, mortgages in
              // it and whose turn it is, canBuild already says it. If no
              // street in the country may take a house right now, neither may
              // this button put one up.
              idxs.contains(where: { canBuild($0) }) else { return 0 }

        var houses = Dictionary(uniqueKeysWithValues: idxs.map {
            ($0, state.owner(of: $0)?.houseCount ?? 0)
        })
        var purse = state.player(own.owner)?.money ?? 0
        let even = state.settings.evenBuild ?? true
        var built = 0

        // At most five to a street, so this cannot run away.
        for _ in 0..<(idxs.count * 5) {
            let lowest = houses.values.min() ?? 0
            let next = idxs
                .filter { idx in
                    guard let standing = houses[idx], standing < 5 else { return false }
                    guard let cost = tile(idx)?.houseCost, cost > 0, cost <= purse else { return false }
                    return even ? standing == lowest : true
                }
                // The shortest street next, cheapest first when they are
                // level — the same order the server builds in.
                .min { a, b in
                    (houses[a] ?? 0, tile(a)?.houseCost ?? 0) < (houses[b] ?? 0, tile(b)?.houseCost ?? 0)
                }
            guard let next, let cost = tile(next)?.houseCost else { break }
            houses[next] = (houses[next] ?? 0) + 1
            purse -= cost
            built += 1
        }
        return built
    }

    func canSellHouse(_ i: Int) -> Bool {
        guard let state, let t = tile(i), let own = state.owner(of: i),
              localIds.contains(own.owner), state.turn?.playerId == own.owner, own.houseCount > 0 else { return false }
        if state.settings.evenBuild ?? true, let group = t.group, let idxs = state.map.groups?[group] {
            let maxHouses = idxs.map { state.owner(of: $0)?.houseCount ?? 0 }.max() ?? 0
            if own.houseCount < maxHouses { return false }
        }
        return true
    }

    func canMortgage(_ i: Int) -> Bool {
        guard let state, state.settings.mortgage ?? true,
              let t = tile(i), let own = state.owner(of: i),
              localIds.contains(own.owner), state.turn?.playerId == own.owner, !own.isMortgaged else { return false }
        if t.type == "property", let group = t.group, let idxs = state.map.groups?[group] {
            if idxs.contains(where: { (state.owner(of: $0)?.houseCount ?? 0) > 0 }) { return false }
        }
        return true
    }

    // MARK: - friends (REST)

    func fetchJSON<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil,
                                 raw: Bool = false) async throws -> T {
        guard let base = serverURL else { throw URLError(.badURL) }
        // appending(path:) percent-encodes "?", so a query-string path has to
        // be glued on as a plain string instead.
        let url = raw ? URL(string: base.absoluteString + path) : base.appending(path: path)
        guard let url else { throw URLError(.badURL) }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, _) = try await URLSession.shared.data(for: req)
        return try JSONDecoder().decode(T.self, from: data)
    }
}

// MARK: - haptics

enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func warn() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    static func turn() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
}

