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
    let token: String = {
        let key = "mm.token"
        if let existing = UserDefaults.standard.string(forKey: key) { return existing }
        let fresh = "u_ios_" + UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "")
        UserDefaults.standard.set(fresh, forKey: key)
        return fresh
    }()

    @AppStorage("mm.name") var nickname: String = ""
    @AppStorage("mm.flag") var flag: String = ""
    @AppStorage("mm.server") var serverURLString: String = GameStore.defaultServer
    /// Last room this device sat in — powers "Continue game" on the landing
    /// screen. The server holds seats (bots fill in) so rejoining just works.
    @AppStorage("mm.lastRoom") var lastRoom: String = ""
    @AppStorage("mm.lastGuests") var lastGuests: Int = 0

    static var defaultServer: String {
        #if targetEnvironment(simulator)
        "http://localhost:3000"
        #else
        "https://moneymove-csk9.onrender.com"
        #endif
    }

    var serverURL: URL? { URL(string: serverURLString.trimmingCharacters(in: .whitespaces)) }

    // MARK: - published state

    @Published var state: GameState?
    @Published var meId: String = ""
    @Published var roomId: String?
    @Published var connection: SocketIOClient.Status = .disconnected
    @Published var toast: ToastMessage?
    @Published var cardPopup: LastCard?
    @Published var turnBanner: PlayerState?
    @Published var showGameOver = false
    /// This device's seat was taken out by the clock — drives the full-screen
    /// explainer. Cleared when the player chooses to stay and watch.
    @Published var timedOut = false
    /// Set when a game begins — drives the board's deal-in animation.
    @Published var boardIntroAt: Date?
    /// "🇮🇳 India holds the priciest streets this game!"
    @Published var reveal: String?
    private var revealTask: Task<Void, Never>?
    @Published var joinError: String?
    /// A Quick Play match request is in flight. It only ever dims the Play now
    /// button — create and join stay usable, so a slow server is never a wall.
    @Published var quickSearching = false
    private var quickTask: Task<Void, Never>?

    struct ToastMessage: Identifiable, Equatable {
        let id = UUID()
        let text: String
        let isError: Bool
    }

    /// One player's cash just moved — drives the floating "+$200 / −$150"
    /// badge next to their money and the gain/loss sounds.
    struct MoneyDelta: Equatable {
        let id = UUID()
        let amount: Int
    }
    @Published var moneyDeltas: [String: MoneyDelta] = [:]

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
    }
    @Published var matchHistory: [MatchRecord] = {
        guard let data = UserDefaults.standard.data(forKey: "mm.history"),
              let list = try? JSONDecoder().decode([MatchRecord].self, from: data) else { return [] }
        return list
    }()

    private func recordMatch(_ state: GameState, outcome: String? = nil) {
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
            mapIcon: state.map.icon ?? "🌐",
            players: state.players.map(\.name),
            winner: winnerName,
            won: wonByLocalSeat,
            myWorth: me?.isBankrupt == true ? 0 : (me?.netWorth ?? 0),
            turns: state.turn != nil ? max(state.history?.last?.t ?? 0, 0) : 0,
            outcome: outcome ?? (wonByLocalSeat ? "won" : "lost")
        )
        matchHistory.insert(record, at: 0)
        matchHistory = Array(matchHistory.prefix(50))
        if let data = try? JSONEncoder().encode(matchHistory) {
            UserDefaults.standard.set(data, forKey: "mm.history")
        }
    }

    // MARK: - wallet & store

    @Published var wallet: Wallet?

    func refreshWallet(celebrate: Bool = false) {
        Task { [weak self] in
            guard let self else { return }
            guard let base = serverURL,
                  var comps = URLComponents(url: base.appending(path: "/api/wallet"), resolvingAgainstBaseURL: false)
            else { return }
            comps.queryItems = [URLQueryItem(name: "token", value: token)]
            guard let url = comps.url,
                  let (data, _) = try? await URLSession.shared.data(from: url),
                  let fresh = try? JSONDecoder().decode(Wallet.self, from: data) else { return }
            if celebrate, let old = wallet?.coins, fresh.coins > old {
                let earned = fresh.coins - old
                showToast("🪙 +\(earned) coin\(earned > 1 ? "s" : "") earned — spend them in the Store!")
            }
            wallet = fresh
        }
    }

    private let socket = SocketIOClient()

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
    private var lastCardAt: Double = 0
    private var lastTurnPlayer: String?
    private var lastLogAt: Double = 0
    private var bannerTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?

    init() {
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
            socket.emit("join", [[
                "roomId": roomId,
                "token": token,
                "name": nickname.isEmpty ? "Player" : nickname,
                "flag": flag,
            ]])
        }
    }

    private func onSocketEvent(_ name: String, _ args: [Any]) {
        switch name {
        case "you":
            if let dict = args.first as? [String: Any], let pid = dict["playerId"] as? String {
                meId = pid
            }
        case "state":
            guard let dict = args.first as? [String: Any],
                  let data = try? JSONSerialization.data(withJSONObject: dict) else { return }
            do {
                let decoded = try JSONDecoder().decode(GameState.self, from: data)
                apply(decoded)
            } catch {
                // One malformed push must not kill the session; keep the last state.
                print("state decode failed:", error)
            }
        case "toast":
            if let dict = args.first as? [String: Any], let msg = dict["message"] as? String {
                showToast(msg, isError: (dict["type"] as? String) == "error")
            }
        case "joinFailed":
            if let dict = args.first as? [String: Any], let msg = dict["message"] as? String {
                joinError = msg
            }
        default:
            break
        }
    }

    private func apply(_ new: GameState) {
        let old = state
        state = new

        // Money moved: float a +/- badge on everyone whose cash changed, and
        // give the seats on THIS device their own gain/loss sound — losing
        // money makes that little "ishh", gaining rings like a till.
        if let old, new.isPlaying, old.isPlaying {
            var localGain = false, localLoss = false, remoteChange = false
            for p in new.players {
                guard let was = old.player(p.id)?.money, was != p.money else { continue }
                let delta = MoneyDelta(amount: p.money - was)
                moneyDeltas[p.id] = delta
                let pid = p.id
                Task { [weak self] in
                    try? await Task.sleep(for: .seconds(1.6))
                    if self?.moneyDeltas[pid]?.id == delta.id {
                        _ = withAnimation { self?.moneyDeltas.removeValue(forKey: pid) }
                    }
                }
                if localIds.contains(pid) {
                    if delta.amount < 0 { localLoss = true } else { localGain = true }
                } else {
                    remoteChange = true
                }
            }
            if localLoss { SoundKit.shared.lose(); Haptics.warn() }
            else if localGain { SoundKit.shared.gain(); Haptics.tap() }
            else if remoteChange { SoundKit.shared.cash() }
        }

        // Auction has its own voice: the gavel when it opens, and a rising
        // paddle-tick for every new bid — pitched by how high the bid is.
        if let old {
            if new.auction != nil, old.auction == nil {
                SoundKit.shared.auction()
            } else if let a = new.auction, let b = old.auction, a.bid > b.bid {
                SoundKit.shared.bid(a.bid)
                Haptics.tap()
            }
        }

        // A completed country set is a moment — the tiles flash (TileView),
        // the fanfare plays exactly once from here.
        if let old, new.isPlaying, old.isPlaying, let groups = new.map.groups {
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
            if old != nil {
                let delay = walkDelay(in: new, eventAt: card.at)
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
            if turnId == meId { Haptics.turn(); SoundKit.shared.turn() }
        }

        // A fresh game: deal the board in and announce this game's top country.
        if new.isPlaying && old?.isPlaying != true {
            boardIntroAt = Date()
            timedOut = false
            SoundKit.shared.shuffleDeal()
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

        // game over sheet, once — the result lands in History and the win
        // may have paid out coins, so check the wallet with a celebration
        if new.isEnded && old?.isEnded != true {
            showGameOver = true
            SoundKit.shared.win()
            recordMatch(new)
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(1))
                self?.refreshWallet(celebrate: true)
            }
        }
        if !new.isEnded { showGameOver = false }

        // sounds + haptics on fresh log lines (mirrors the web client's mapping)
        if let last = new.log.last, last.at > lastLogAt {
            lastLogAt = last.at
            if old != nil {
                switch last.kind {
                // "money" and "rent" are covered by the per-player delta
                // sounds above — mapping them here would double-fire.
                case "dice": SoundKit.shared.dice()
                case "buy": SoundKit.shared.buy(); Haptics.tap()
                case "bankrupt": SoundKit.shared.bankrupt(); Haptics.warn()
                case "jail": SoundKit.shared.jail()
                case "build": SoundKit.shared.build()
                case "trade": SoundKit.shared.trade()
                // "auction" lines are handled by the state diff above — the
                // log kind covers both openings and bids and would double-fire.
                default: break
                }
            }
        }
    }

    /// How long the token on screen still needs to finish its walk for the
    /// move that caused this event — mirrors TokenWalker's pacing.
    private func walkDelay(in state: GameState, eventAt: Double) -> Double {
        guard let move = state.lastMove, move.steps != 0,
              abs(move.at - eventAt) < 2500 else { return 0 }
        let distance = abs(move.steps)
        let pace: Double = distance > 12 ? 0.07 : distance > 7 ? 0.095 : 0.13
        return Double(distance) * pace + 0.35
    }

    func showToast(_ text: String, isError: Bool = false) {
        toastTask?.cancel()
        toast = ToastMessage(text: text, isError: isError)
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
        state = nil
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
        join(roomId: lastRoom)
        guard let url = serverURL, let roomId else { return }
        for number in 2...(max(2, guestsToRestore + 1)) where guestsToRestore > 0 {
            let guestToken = "\(token)_p\(number)"
            guard !guests.contains(where: { $0.token == guestToken }) else { continue }
            let s = SocketIOClient()
            s.onStatus = { status in
                Task { @MainActor in
                    guard status == .connected else { return }
                    s.emit("join", [[
                        "roomId": roomId,
                        "token": guestToken,
                        "name": "Player \(number)",
                        "flag": "",
                    ]])
                }
            }
            s.connect(to: url)
            guests.append(LocalGuest(token: guestToken, number: number, socket: s))
        }
    }

    func leaveRoom() {
        // Walking out mid-game still deserves a History line.
        if let state, state.isPlaying {
            recordMatch(state, outcome: "left")
        }
        guests.forEach { $0.socket.close() }
        guests = []
        socket.close()
        quickTask?.cancel()
        quickSearching = false
        roomId = nil
        state = nil
        joinError = nil
        timedOut = false
        lastTurnPlayer = nil
        lastCardAt = 0
        lastRoom = ""
        lastGuests = 0
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
    func build(_ tile: Int) { emitAsActive("build", [tile]) }
    func sellHouse(_ tile: Int) { emitAsActive("sellHouse", [tile]) }
    func mortgage(_ tile: Int) { emitAsActive("mortgage", [tile]) }
    func unmortgage(_ tile: Int) { emitAsActive("unmortgage", [tile]) }
    func payDebt() { emitAsActive("payDebt") }
    func declareBankrupt() { emitAsActive("bankrupt") }
    /// Walk out of a live game for good: the deeds go back to the bank, the
    /// seat stays as a spectator, and it costs a point of karma.
    func quitGame() { emit("quit") }
    func sendChat(_ text: String, channel: String = "all") { emit("chat", [text, channel]) }

    /// Team chat exists when teams are on and this player is actually on one.
    var hasTeamChat: Bool {
        (state?.settings.teams ?? 0) > 0 && state?.player(meId)?.team != nil
    }
    func rematch() { emit("rematch") }

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
    /// Live "👀 is viewing" presence on an offer. Guarded so a sheet closing
    /// after the trade already resolved never emits against a dead offer.
    func setTradeViewing(_ id: Int, _ viewing: Bool, as seat: String? = nil) {
        guard state?.trades.contains(where: { $0.id == id }) == true else { return }
        let who = seat.flatMap { localIds.contains($0) ? $0 : nil } ?? meId
        emitAs(who, "trade:viewing", [["id": id, "viewing": viewing]])
    }

    // MARK: - derived helpers (mirror the web client's rule mirrors)

    /// Every seat controlled from this device: the main player plus local guests.
    var localIds: Set<String> { Set([meId] + guests.map(\.token)) }

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
    /// whatever the last push said; ties fall back to seat order so two equal
    /// fortunes don't swap badges on every tick.
    var liveRanks: [String: Int] {
        guard let state, state.isPlaying else { return [:] }
        let ordered = state.players.enumerated()
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

    private func socket(for playerId: String) -> SocketIOClient {
        guests.first { $0.token == playerId }?.socket ?? socket
    }

    /// Adds another human on this device. They join the room with their own
    /// derived identity and show up as a normal player to everyone else.
    func addLocalPlayer() {
        guard let url = serverURL, let roomId else { return }
        let number = guests.count + 2
        let guestToken = "\(token)_p\(number)"
        let s = SocketIOClient()
        s.onStatus = { [weak self] status in
            Task { @MainActor in
                guard status == .connected, let self else { return }
                s.emit("join", [[
                    "roomId": roomId,
                    "token": guestToken,
                    "name": "Player \(number)",
                    "flag": "",
                ]])
            }
        }
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

    func canBuild(_ i: Int) -> Bool {
        guard let state, let t = tile(i), let own = state.owner(of: i),
              own.owner == activeId, t.type == "property", !own.isMortgaged,
              let group = t.group, let idxs = state.map.groups?[group] else { return false }
        guard ownsFullGroup(activeId, group: group) else { return false }
        guard !idxs.contains(where: { state.owner(of: $0)?.isMortgaged == true }) else { return false }
        guard own.houseCount < 5 else { return false }
        if state.settings.evenBuild ?? true {
            let minHouses = idxs.map { state.owner(of: $0)?.houseCount ?? 0 }.min() ?? 0
            if own.houseCount > minHouses { return false }
        }
        return true
    }

    func canSellHouse(_ i: Int) -> Bool {
        guard let state, let t = tile(i), let own = state.owner(of: i),
              own.owner == activeId, own.houseCount > 0 else { return false }
        if state.settings.evenBuild ?? true, let group = t.group, let idxs = state.map.groups?[group] {
            let maxHouses = idxs.map { state.owner(of: $0)?.houseCount ?? 0 }.max() ?? 0
            if own.houseCount < maxHouses { return false }
        }
        return true
    }

    func canMortgage(_ i: Int) -> Bool {
        guard let state, state.settings.mortgage ?? true,
              let t = tile(i), let own = state.owner(of: i),
              own.owner == activeId, !own.isMortgaged else { return false }
        if t.type == "property", let group = t.group, let idxs = state.map.groups?[group] {
            if idxs.contains(where: { (state.owner(of: $0)?.houseCount ?? 0) > 0 }) { return false }
        }
        return true
    }

    // MARK: - friends (REST)

    func fetchJSON<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        guard let base = serverURL else { throw URLError(.badURL) }
        var req = URLRequest(url: base.appending(path: path))
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
