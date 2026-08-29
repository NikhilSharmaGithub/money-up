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
    @Published var joinError: String?

    struct ToastMessage: Identifiable, Equatable {
        let id = UUID()
        let text: String
        let isError: Bool
    }

    private let socket = SocketIOClient()
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

        // card popup — fires once per draw
        if let card = new.lastCard, card.at != lastCardAt {
            lastCardAt = card.at
            if old != nil { cardPopup = card; SoundKit.shared.card() }
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

        // game over sheet, once
        if new.isEnded && old?.isEnded != true { showGameOver = true; SoundKit.shared.win() }
        if !new.isEnded { showGameOver = false }

        // sounds + haptics on fresh log lines (mirrors the web client's mapping)
        if let last = new.log.last, last.at > lastLogAt {
            lastLogAt = last.at
            if old != nil {
                switch last.kind {
                case "dice": SoundKit.shared.dice()
                case "money": SoundKit.shared.cash(); Haptics.tap()
                case "buy": SoundKit.shared.buy(); Haptics.tap()
                case "rent": SoundKit.shared.rent(); Haptics.warn()
                case "bankrupt": SoundKit.shared.bankrupt(); Haptics.warn()
                case "jail": SoundKit.shared.jail()
                case "build": SoundKit.shared.build()
                case "trade": SoundKit.shared.trade()
                case "auction": SoundKit.shared.auction()
                default: break
                }
            }
        }
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

    func join(roomId id: String) {
        SoundKit.shared.warmUp()
        guard let url = serverURL else { return showToast("Set a valid server URL", isError: true) }
        joinError = nil
        roomId = id.lowercased().trimmingCharacters(in: .whitespaces)
        state = nil
        lastTurnPlayer = nil
        if connection == .connected {
            onSocketStatus(.connected) // emit join now
        } else {
            socket.connect(to: url)
        }
    }

    func leaveRoom() {
        socket.close()
        roomId = nil
        state = nil
        joinError = nil
        lastTurnPlayer = nil
        lastCardAt = 0
    }

    // MARK: - intents (mirror public/js actions)

    private func emit(_ event: String, _ args: [Any] = []) { socket.emit(event, args) }

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

    func roll() { emit("roll"); Haptics.tap() }
    func buy() { emit("buy") }
    func skipBuy() { emit("skipBuy") }
    func endTurn() { emit("endTurn") }
    func bid(_ amount: Int) { emit("bid", [amount]) }
    func passBid() { emit("passBid") }
    func jailPay() { emit("jailPay") }
    func jailCard() { emit("jailCard") }
    func build(_ tile: Int) { emit("build", [tile]) }
    func sellHouse(_ tile: Int) { emit("sellHouse", [tile]) }
    func mortgage(_ tile: Int) { emit("mortgage", [tile]) }
    func unmortgage(_ tile: Int) { emit("unmortgage", [tile]) }
    func payDebt() { emit("payDebt") }
    func declareBankrupt() { emit("bankrupt") }
    func sendChat(_ text: String) { emit("chat", [text]) }
    func rematch() { emit("rematch") }

    func proposeTrade(to: String, give: TradeSide, get: TradeSide) {
        emit("trade:propose", [[
            "to": to,
            "give": ["money": give.money, "tiles": give.tiles, "cards": give.cards],
            "get": ["money": get.money, "tiles": get.tiles, "cards": get.cards],
        ]])
    }
    func respondTrade(_ id: Int, accept: Bool) { emit("trade:respond", [["id": id, "accept": accept]]) }
    func cancelTrade(_ id: Int) { emit("trade:cancel", [["id": id]]) }

    // MARK: - derived helpers (mirror the web client's rule mirrors)

    var me: PlayerState? { state?.player(meId) }
    var isHost: Bool { state?.hostId == meId }
    var isMyTurn: Bool { state?.isPlaying == true && state?.turn?.playerId == meId }
    var currentPlayer: PlayerState? { state?.player(state?.turn?.playerId) }

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
            own.owner == meId ? Int(key) : nil
        }.sorted()
    }

    func ownsFullGroup(_ playerId: String, group: String) -> Bool {
        guard let state, let idxs = state.map.groups?[group], !idxs.isEmpty else { return false }
        return idxs.allSatisfy { state.owner(of: $0)?.owner == playerId }
    }

    func canBuild(_ i: Int) -> Bool {
        guard let state, let t = tile(i), let own = state.owner(of: i),
              own.owner == meId, t.type == "property", !own.isMortgaged,
              let group = t.group, let idxs = state.map.groups?[group] else { return false }
        guard ownsFullGroup(meId, group: group) else { return false }
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
              own.owner == meId, own.houseCount > 0 else { return false }
        if state.settings.evenBuild ?? true, let group = t.group, let idxs = state.map.groups?[group] {
            let maxHouses = idxs.map { state.owner(of: $0)?.houseCount ?? 0 }.max() ?? 0
            if own.houseCount < maxHouses { return false }
        }
        return true
    }

    func canMortgage(_ i: Int) -> Bool {
        guard let state, state.settings.mortgage ?? true,
              let t = tile(i), let own = state.owner(of: i),
              own.owner == meId, !own.isMortgaged else { return false }
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
