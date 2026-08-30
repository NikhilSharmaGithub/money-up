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
    //
    // Anti-robotic rule: every play is "humanized" — a few percent of random
    // detune and a few milliseconds of timing slop, like a real object would.

    private func jitter(_ f: Double, _ spread: Double = 0.02) -> Double {
        f * (1 + Double.random(in: -spread...spread))
    }
    private func slop(_ t: Double) -> Double { max(0, t + Double.random(in: -0.012...0.012)) }

    func click() {
        // soft woodblock: two quiet partials, no square-wave beep
        tone(jitter(1080), dur: 0.035, wave: .sine, vol: 0.05)
        tone(jitter(700), dur: 0.05, wave: .triangle, vol: 0.04, after: 0.004)
    }

    /// Real dice: a handful of sharp little clacks with irregular gaps and a
    /// soft settle at the end — not three even whooshes.
    func dice() {
        var t = 0.0
        for i in 0..<5 {
            let fade = 1 - Double(i) * 0.13
            noise(dur: Double.random(in: 0.028...0.05), vol: Float(0.16 * fade),
                  bright: Double.random(in: 0.82...1.0), after: t)
            // a faint pitch inside each clack reads as bone-on-wood
            tone(jitter(Double.random(in: 900...2100)), dur: 0.03, wave: .triangle,
                 vol: Float(0.05 * fade), after: t + 0.002)
            t += Double.random(in: 0.045...0.095)
        }
        // the die rocks to rest
        tone(jitter(260), to: 175, dur: 0.1, wave: .triangle, vol: 0.09, after: t + 0.02)
    }

    /// One footstep of a token hop — alternates subtly so a run has texture.
    private var stepFlip = false
    func step() {
        stepFlip.toggle()
        tone(jitter(stepFlip ? 620 : 690, 0.03), dur: 0.04, wave: .sine, vol: 0.07)
    }

    func land() {
        tone(jitter(300), to: 235, dur: 0.1, wave: .triangle, vol: 0.13)
        tone(jitter(1500), dur: 0.03, wave: .sine, vol: 0.04, after: 0.012)
    }

    func buy() {
        // a warm strum, each note doubled an octave up very quietly
        for (i, f) in [523.0, 659, 784].enumerated() {
            let at = slop(Double(i) * 0.07)
            tone(jitter(f, 0.008), dur: 0.3, wave: .triangle, vol: 0.13, after: at)
            tone(jitter(f * 2, 0.008), dur: 0.22, wave: .sine, vol: 0.045, after: at + 0.01)
        }
    }

    func cash() {
        tone(880, to: 1320, dur: 0.14, wave: .triangle, vol: 0.16)
        tone(1320, dur: 0.14, wave: .sine, vol: 0.1, after: 0.1)
    }

    func rent() { tone(420, to: 200, dur: 0.26, wave: .triangle, vol: 0.15) }

    /// A whole country in one hand — a short triumphant flourish.
    func setComplete() {
        for (i, f) in [523.0, 659, 784, 1047].enumerated() {
            tone(jitter(f, 0.006), dur: 0.3, wave: .triangle, vol: 0.14, after: Double(i) * 0.07)
        }
        tone(jitter(1568), dur: 0.4, wave: .sine, vol: 0.08, after: 0.32)
    }

    /// Money arriving in YOUR pocket: a bright rising coin ding.
    func gain() {
        tone(988, to: 1319, dur: 0.12, wave: .triangle, vol: 0.17)
        tone(1568, dur: 0.18, wave: .sine, vol: 0.12, after: 0.1)
    }

    /// Money leaving YOUR pocket: a little hiss and a sagging "ishh…".
    func lose() {
        noise(dur: 0.2, vol: 0.1, bright: 0.7)
        tone(330, to: 165, dur: 0.34, wave: .triangle, vol: 0.16, after: 0.04)
    }

    func card() {
        // a paper slide, brightening as the card flips over
        noise(dur: 0.2, vol: 0.08, bright: 0.3)
        noise(dur: 0.16, vol: 0.09, bright: 0.6, after: 0.14)
        tone(jitter(880), dur: 0.06, wave: .sine, vol: 0.05, after: 0.26)
    }

    func turn() {
        // a doorbell third with a hint of shimmer, not two flat beeps
        tone(jitter(587, 0.006), dur: 0.14, wave: .sine, vol: 0.12)
        tone(jitter(589, 0.006), dur: 0.14, wave: .sine, vol: 0.05)
        tone(jitter(880, 0.006), dur: 0.2, wave: .sine, vol: 0.1, after: 0.11)
        tone(jitter(884, 0.006), dur: 0.2, wave: .sine, vol: 0.04, after: 0.11)
    }

    func jail() {
        // a cell door: metallic clank then a low slam
        noise(dur: 0.05, vol: 0.12, bright: 0.95)
        tone(jitter(520), to: 490, dur: 0.09, wave: .square, vol: 0.06, after: 0.01)
        tone(jitter(150), to: 110, dur: 0.3, wave: .triangle, vol: 0.15, after: 0.12)
        noise(dur: 0.12, vol: 0.08, bright: 0.2, after: 0.12)
    }

    func auction() {
        // gavel: two woody knocks
        noise(dur: 0.035, vol: 0.13, bright: 0.7)
        tone(jitter(820), dur: 0.05, wave: .triangle, vol: 0.09, after: 0.002)
        noise(dur: 0.035, vol: 0.11, bright: 0.7, after: 0.16)
        tone(jitter(760), dur: 0.05, wave: .triangle, vol: 0.08, after: 0.162)
    }

    func trade() {
        for (i, f) in [440.0, 587, 740].enumerated() {
            let at = slop(Double(i) * 0.08)
            tone(jitter(f, 0.008), dur: 0.26, wave: .triangle, vol: 0.11, after: at)
        }
        tone(jitter(1174), dur: 0.18, wave: .sine, vol: 0.05, after: 0.24)
    }

    func build() {
        // hammer taps with wood resonance
        for i in 0..<3 {
            let at = Double(i) * 0.11 + Double.random(in: -0.01...0.01)
            noise(dur: 0.03, vol: 0.1, bright: 0.75, after: at)
            tone(jitter(Double.random(in: 320...420)), dur: 0.06, wave: .triangle, vol: 0.08, after: at + 0.002)
        }
    }

    func bankrupt() {
        tone(jitter(400), to: 90, dur: 0.7, wave: .triangle, vol: 0.15)
        noise(dur: 0.4, vol: 0.06, bright: 0.15, after: 0.15)
    }

    /// The deck-shuffle board intro: an accelerating riffle of card snaps,
    /// then a rising run as the tiles deal out.
    func shuffleDeal() {
        var t = 0.0
        var gap = 0.085
        for i in 0..<9 {
            noise(dur: 0.03, vol: Float(0.07 + Double(i) * 0.006), bright: 0.65, after: t)
            t += gap
            gap = max(0.028, gap * 0.82)   // the riffle speeds up
        }
        noise(dur: 0.24, vol: 0.1, bright: 0.4, after: t)
        for (i, f) in [392.0, 494, 587, 784].enumerated() {
            tone(jitter(f, 0.006), dur: 0.18, wave: .triangle, vol: 0.1, after: t + 0.18 + Double(i) * 0.07)
        }
    }

    func win() {
        for (i, f) in [523.0, 659, 784, 1047, 1319].enumerated() {
            let at = slop(Double(i) * 0.09)
            tone(jitter(f, 0.006), dur: 0.5, wave: .triangle, vol: 0.14, after: at)
            tone(jitter(f * 2, 0.006), dur: 0.3, wave: .sine, vol: 0.04, after: at + 0.02)
        }
    }
}
