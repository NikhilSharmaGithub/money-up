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
    /// The one reconnect waiting to happen. A drop is reported more than once
    /// (the read fails, the task completes with an error, the watchdog gives
    /// up), and a timer per report used to stack up into a storm of opens
    /// that orphaned each other's handshakes.
    private var reconnectWork: DispatchWorkItem?

    override init() {
        super.init()
        // Every callback on the main queue, where emit(), connect() and the
        // rest are called from. With a private queue the reads mutated acks,
        // pendingEmits and status on one thread while the game mutated them
        // on another, and a Swift dictionary written from two threads at once
        // can crash.
        session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
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
        reconnectWork?.cancel()
        reconnectWork = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        // Whatever was waiting for this connection was meant for this table.
        // Left queued, it would go out on the next connect — which is usually
        // another table's, before that table's join.
        pendingEmits = []
        status = .disconnected
    }

    private func open() {
        guard let baseURL else { return }
        reconnectWork?.cancel()
        reconnectWork = nil
        generation += 1
        let gen = generation
        // The task being replaced is let go of properly; overwritten, it
        // stayed open on the server until the server timed it out.
        task?.cancel(with: .goingAway, reason: nil)
        // The watchdog measures silence from here, so a handshake that has
        // only just started is not killed for the quiet before it.
        lastHeard = Date()
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

    /// Once per connection. open() always moves to .connecting first, so the
    /// first report of a drop gets through and the echoes of the same drop
    /// find the status already .disconnected.
    private func dropped() {
        guard !manuallyClosed, status != .disconnected else { return }
        status = .disconnected
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        reconnectAttempt += 1
        let delay = min(10, 0.5 * pow(1.8, Double(reconnectAttempt)))
        reconnectWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, !self.manuallyClosed, self.status != .connected else { return }
            self.open()
        }
        reconnectWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
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
            // The status listeners run right here, on the main queue, before
            // the queue below is sent. That is what puts the game's "join"
            // ahead of a roll or a buy tapped during the reconnect — sent
            // first, those reach a socket with no room and are refused.
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
        guard let sent = task else { return }
        sent.send(.string(text)) { [weak self] error in
            // A frame that died with a connection already replaced says
            // nothing about the new one, which may be mid-handshake.
            guard let self, error != nil, sent === self.task else { return }
            self.dropped()
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
        // Only the connection in use. A task already replaced or closed has
        // nothing to say about the one that took its place.
        guard error != nil, task === self.task else { return }
        dropped()
    }
}
