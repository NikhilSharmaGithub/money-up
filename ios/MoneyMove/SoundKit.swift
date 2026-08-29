// Synthesised sound kit — every effect is generated as a PCM buffer at play
// time, so the app ships no audio assets (the web client does the same with
// the Web Audio API). Plays through the ambient session: mixes with the
// player's music and respects the silent switch.

import AVFoundation

final class SoundKit {
    static let shared = SoundKit()

    var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "mm.sound") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "mm.sound") }
    }

    private let engine = AVAudioEngine()
    private var players: [AVAudioPlayerNode] = []
    private var nextPlayer = 0
    private var started = false
    private let sampleRate: Double = 44_100
    private lazy var format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!

    private init() {}

    /// Idempotent; call on the first user gesture so the engine is warm.
    func warmUp() {
        guard !started else { return }
        started = true
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        for _ in 0..<6 {
            let node = AVAudioPlayerNode()
            engine.attach(node)
            engine.connect(node, to: engine.mainMixerNode, format: format)
            players.append(node)
        }
        engine.mainMixerNode.outputVolume = 0.6
        try? engine.start()
        players.forEach { $0.play() }
    }

    // MARK: - synthesis

    private enum Wave { case sine, triangle, square }

    /// One decaying blip, optionally gliding between two pitches.
    private func tone(_ freq: Double, to: Double? = nil, dur: Double = 0.16,
                      wave: Wave = .sine, vol: Float = 0.22, after: Double = 0) {
        guard enabled, started else { return }
        let frames = AVAudioFrameCount(dur * sampleRate)
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return }
        buffer.frameLength = frames
        let data = buffer.floatChannelData![0]
        var phase = 0.0
        for i in 0..<Int(frames) {
            let t = Double(i) / Double(frames)
            let f = to.map { freq * pow($0 / freq, t) } ?? freq
            phase += 2 * .pi * f / sampleRate
            let raw: Double = switch wave {
            case .sine: sin(phase)
            case .triangle: 2 / .pi * asin(sin(phase))
            case .square: sin(phase) > 0 ? 1 : -1
            }
            // fast attack, exponential decay — reads as a soft mallet, not a beep
            let env = min(t / 0.03, 1) * pow(1 - t, 1.6)
            data[i] = Float(raw * env) * vol
        }
        schedule(buffer, after: after)
    }

    /// A short filtered-noise burst (dice tumbles, card whooshes).
    private func noise(dur: Double = 0.2, vol: Float = 0.12, bright: Double = 0.5, after: Double = 0) {
        guard enabled, started else { return }
        let frames = AVAudioFrameCount(dur * sampleRate)
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return }
        buffer.frameLength = frames
        let data = buffer.floatChannelData![0]
        var last: Float = 0
        let mix = Float(bright) // 1 = white, 0 = heavily lowpassed
        for i in 0..<Int(frames) {
            let t = Double(i) / Double(frames)
            let white = Float.random(in: -1...1)
            last += (white - last) * (0.08 + mix * 0.6)   // one-pole lowpass
            data[i] = last * Float(pow(1 - t, 2)) * vol * 2
        }
        schedule(buffer, after: after)
    }

    private func schedule(_ buffer: AVAudioPCMBuffer, after: Double) {
        let node = players[nextPlayer]
        nextPlayer = (nextPlayer + 1) % players.count
        if after <= 0 {
            node.scheduleBuffer(buffer)
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + after) { node.scheduleBuffer(buffer) }
        }
    }

    // MARK: - the effects

    func click() { tone(520, dur: 0.05, wave: .square, vol: 0.07) }

    func dice() {
        noise(dur: 0.12, vol: 0.14, bright: 0.8)
        noise(dur: 0.1, vol: 0.12, bright: 0.7, after: 0.12)
        noise(dur: 0.09, vol: 0.1, bright: 0.6, after: 0.23)
    }

    /// One footstep of a token hop — alternates subtly so a run has texture.
    private var stepFlip = false
    func step() {
        stepFlip.toggle()
        tone(stepFlip ? 640 : 700, dur: 0.045, wave: .sine, vol: 0.08)
    }

    func land() { tone(520, to: 390, dur: 0.12, wave: .triangle, vol: 0.14) }

    func buy() {
        tone(523, dur: 0.28, wave: .triangle, vol: 0.14)
        tone(659, dur: 0.28, wave: .triangle, vol: 0.14, after: 0.06)
        tone(784, dur: 0.3, wave: .triangle, vol: 0.14, after: 0.12)
    }

    func cash() {
        tone(880, to: 1320, dur: 0.14, wave: .triangle, vol: 0.16)
        tone(1320, dur: 0.14, wave: .sine, vol: 0.1, after: 0.1)
    }

    func rent() { tone(420, to: 200, dur: 0.26, wave: .triangle, vol: 0.15) }

    func card() { noise(dur: 0.32, vol: 0.1, bright: 0.35) }

    func turn() {
        tone(587, dur: 0.12, wave: .sine, vol: 0.13)
        tone(880, dur: 0.16, wave: .sine, vol: 0.11, after: 0.1)
    }

    func jail() {
        tone(200, dur: 0.16, wave: .square, vol: 0.12)
        tone(150, dur: 0.24, wave: .square, vol: 0.12, after: 0.15)
    }

    func auction() {
        tone(700, dur: 0.08, wave: .triangle, vol: 0.14)
        tone(1000, dur: 0.11, wave: .triangle, vol: 0.12, after: 0.09)
    }

    func trade() {
        tone(440, dur: 0.24, wave: .triangle, vol: 0.12)
        tone(587, dur: 0.24, wave: .triangle, vol: 0.12, after: 0.07)
        tone(740, dur: 0.26, wave: .triangle, vol: 0.12, after: 0.14)
    }

    func build() {
        tone(300, dur: 0.07, wave: .square, vol: 0.12)
        tone(460, dur: 0.09, wave: .square, vol: 0.1, after: 0.08)
    }

    func bankrupt() { tone(400, to: 90, dur: 0.65, wave: .triangle, vol: 0.16) }

    /// The board dealing in at game start: a riffle plus a rising run.
    func shuffleDeal() {
        noise(dur: 0.30, vol: 0.11, bright: 0.55)
        noise(dur: 0.22, vol: 0.09, bright: 0.7, after: 0.16)
        for (i, f) in [392.0, 494, 587, 784].enumerated() {
            tone(f, dur: 0.16, wave: .triangle, vol: 0.11, after: 0.34 + Double(i) * 0.07)
        }
    }

    func win() {
        for (i, f) in [523.0, 659, 784, 1047, 1319].enumerated() {
            tone(f, dur: 0.45, wave: .triangle, vol: 0.15, after: Double(i) * 0.09)
        }
    }
}
