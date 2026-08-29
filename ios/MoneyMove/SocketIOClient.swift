// A minimal Socket.IO v4 client over URLSessionWebSocketTask.
//
// The game only needs the websocket transport, text frames, the default
// namespace, and client-initiated acks — so rather than pulling in a
// dependency, the relevant slice of the Engine.IO/Socket.IO framing is
// implemented here (~200 lines, no binary support, no rooms/multiplexing).
//
// Frames on the wire (all text):
//   Engine.IO: "0{json}" open · "2" ping (server→client) · "3" pong · "4…" message
//   Socket.IO inside a message: "0" connect · "2[…]" event · "3<id>[…]" ack
// So a game event arrives as the websocket text "42[\"state\",{…}]".

import Foundation

final class SocketIOClient: NSObject, URLSessionWebSocketDelegate {
    enum Status: Equatable { case disconnected, connecting, connected }

    var onStatus: ((Status) -> Void)?
    var onEvent: ((String, [Any]) -> Void)?

    private(set) var status: Status = .disconnected {
        didSet { if oldValue != status { deliver { self.onStatus?(self.status) } } }
    }

    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var baseURL: URL?
    private var manuallyClosed = false
    private var generation = 0                    // invalidates callbacks from dead sockets
    private var reconnectAttempt = 0
    private var acks: [Int: ([Any]) -> Void] = [:]
    private var ackSeq = 0
    private var pendingEmits: [String] = []
    private var pingInterval: TimeInterval = 25
    private var pingTimeout: TimeInterval = 20
    private var lastHeard = Date()
    private var watchdog: Timer?

    override init() {
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    }

    // MARK: - lifecycle

    func connect(to base: URL) {
        baseURL = base
        manuallyClosed = false
        reconnectAttempt = 0
        open()
    }

    func close() {
        manuallyClosed = true
        generation += 1
        watchdog?.invalidate()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        status = .disconnected
    }

    private func open() {
        guard let baseURL else { return }
        generation += 1
        let gen = generation
        status = .connecting

        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        comps.scheme = comps.scheme == "https" ? "wss" : "ws"
        comps.path = "/socket.io/"
        comps.queryItems = [.init(name: "EIO", value: "4"), .init(name: "transport", value: "websocket")]

        let t = session.webSocketTask(with: comps.url!)
        task = t
        t.resume()
        listen(gen: gen)
    }

    private func listen(gen: Int) {
        task?.receive { [weak self] result in
            guard let self, gen == self.generation else { return }
            switch result {
            case .success(let message):
                self.lastHeard = Date()
                if case .string(let text) = message { self.handle(text) }
                self.listen(gen: gen)
            case .failure:
                self.dropped()
            }
        }
    }

    private func dropped() {
        guard !manuallyClosed else { return }
        status = .disconnected
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        reconnectAttempt += 1
        let delay = min(10, 0.5 * pow(1.8, Double(reconnectAttempt)))
        deliver { [weak self] in
            guard let self, !self.manuallyClosed else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self, !self.manuallyClosed, self.status != .connected else { return }
                self.open()
            }
        }
    }

    // MARK: - frames

    private func handle(_ text: String) {
        guard let first = text.first else { return }
        switch first {
        case "0": // engine.io open — carries ping settings
            if let data = text.dropFirst().data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                pingInterval = (json["pingInterval"] as? Double ?? 25000) / 1000
                pingTimeout = (json["pingTimeout"] as? Double ?? 20000) / 1000
            }
            armWatchdog()
            send("40") // connect to the default namespace
        case "2": // ping
            send("3")
        case "4": // socket.io packet
            handleSocketPacket(String(text.dropFirst()))
        default:
            break
        }
    }

    private func handleSocketPacket(_ body: String) {
        guard let kind = body.first else { return }
        let rest = String(body.dropFirst())
        switch kind {
        case "0": // connected to namespace
            reconnectAttempt = 0
            status = .connected
            let queued = pendingEmits
            pendingEmits = []
            queued.forEach(send)
        case "1": // server closed the namespace
            dropped()
        case "2": // event: [optional ack id digits][json array]
            let (_, json) = splitAckID(rest)
            guard let arr = parseArray(json), let name = arr.first as? String else { return }
            let args = Array(arr.dropFirst())
            deliver { self.onEvent?(name, args) }
        case "3": // ack response
            let (idDigits, json) = splitAckID(rest)
            guard let id = Int(idDigits), let cb = acks.removeValue(forKey: id) else { return }
            let args = parseArray(json) ?? []
            deliver { cb(args) }
        default:
            break
        }
    }

    private func splitAckID(_ s: String) -> (String, String) {
        let digits = s.prefix { $0.isNumber }
        return (String(digits), String(s.dropFirst(digits.count)))
    }

    private func parseArray(_ json: String) -> [Any]? {
        guard let data = json.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [Any]
    }

    // MARK: - emitting

    /// Emits an event. Arguments must be JSON-encodable (String/Int/Bool/Dictionary/Array/NSNull).
    func emit(_ event: String, _ args: [Any] = [], ack: (([Any]) -> Void)? = nil) {
        var payload: [Any] = [event]
        payload.append(contentsOf: args)
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }

        var frame = "42"
        if let ack {
            ackSeq += 1
            acks[ackSeq] = ack
            frame += "\(ackSeq)"
        }
        frame += json

        if status == .connected { send(frame) }
        else { pendingEmits.append(frame) }
    }

    private func send(_ text: String) {
        task?.send(.string(text)) { [weak self] error in
            if error != nil { self?.dropped() }
        }
    }

    // MARK: - liveness

    private func armWatchdog() {
        deliver { [weak self] in
            guard let self else { return }
            self.watchdog?.invalidate()
            let limit = self.pingInterval + self.pingTimeout + 5
            self.watchdog = Timer.scheduledTimer(withTimeInterval: limit / 2, repeats: true) { [weak self] _ in
                guard let self, !self.manuallyClosed else { return }
                if Date().timeIntervalSince(self.lastHeard) > limit {
                    self.task?.cancel(with: .abnormalClosure, reason: nil)
                    self.dropped()
                }
            }
        }
    }

    private func deliver(_ block: @escaping () -> Void) {
        if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
    }

    // MARK: - URLSessionWebSocketDelegate

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if error != nil { dropped() }
    }
}
