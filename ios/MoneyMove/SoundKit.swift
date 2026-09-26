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
    /// When each voice finishes what it has already been handed, on the
    /// systemUptime clock. A node plays its buffers one after another, so a
    /// buffer handed to a busy node waits its turn — the next sound goes to
    /// whichever node falls quiet first, not simply the next one round.
    private var busyUntil: [TimeInterval] = []
    private var started = false
    fileprivate let sampleRate: Double = 44_100
    private lazy var format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!

    private init() {}

    /// Idempotent; call on the first user gesture so the engine is warm.
    func warmUp() {
        guard !started else { return }
        started = true
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        // Ten voices: a win used to be ten blips on six nodes, and the last
        // four queued behind the first ones and smeared the flourish. The big
        // moments are now mixed into one buffer each (see recipe), so ten is
        // headroom for a flourish landing on top of the footsteps and a coin.
        for _ in 0..<10 {
            let node = AVAudioPlayerNode()
            engine.attach(node)
            engine.connect(node, to: engine.mainMixerNode, format: format)
            players.append(node)
            busyUntil.append(0)
        }
        engine.mainMixerNode.outputVolume = 0.6
        try? engine.start()
        players.forEach { $0.play() }
    }

    // MARK: - synthesis

    fileprivate enum Wave { case sine, triangle, square }

    /// One decaying blip, optionally gliding between two pitches.
    private func tone(_ freq: Double, to: Double? = nil, dur: Double = 0.16,
                      wave: Wave = .sine, vol: Float = 0.22, after: Double = 0) {
        guard enabled, started else { return }
        let frames = AVAudioFrameCount(dur * sampleRate)
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return }
        buffer.frameLength = frames
        Self.renderTone(freq, to: to, frames: Int(frames), wave: wave, vol: vol, rate: sampleRate,
                        into: buffer.floatChannelData![0], adding: false)
        schedule(buffer, after: after)
    }

    /// A short filtered-noise burst (dice tumbles, card whooshes).
    private func noise(dur: Double = 0.2, vol: Float = 0.12, bright: Double = 0.5, after: Double = 0) {
        guard enabled, started else { return }
        let frames = AVAudioFrameCount(dur * sampleRate)
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return }
        buffer.frameLength = frames
        Self.renderNoise(frames: Int(frames), vol: vol, bright: bright,
                         into: buffer.floatChannelData![0], adding: false)
        schedule(buffer, after: after)
    }

    /// The mallet itself — shared by the one-blip path above and the mixdown
    /// below, so a recipe's voices are the very same sound as a lone tone().
    fileprivate static func renderTone(_ freq: Double, to: Double?, frames: Int, wave: Wave, vol: Float,
                                       rate: Double, into out: UnsafeMutablePointer<Float>, adding: Bool) {
        var phase = 0.0
        for i in 0..<frames {
            let t = Double(i) / Double(frames)
            let f = to.map { freq * pow($0 / freq, t) } ?? freq
            phase += 2 * .pi * f / rate
            let raw: Double = switch wave {
            case .sine: sin(phase)
            case .triangle: 2 / .pi * asin(sin(phase))
            case .square: sin(phase) > 0 ? 1 : -1
            }
            // fast attack, exponential decay — reads as a soft mallet, not a beep
            let env = min(t / 0.03, 1) * pow(1 - t, 1.6)
            let sample = Float(raw * env) * vol
            if adding { out[i] += sample } else { out[i] = sample }
        }
    }

    /// The noise burst, shared the same way.
    fileprivate static func renderNoise(frames: Int, vol: Float, bright: Double,
                                        into out: UnsafeMutablePointer<Float>, adding: Bool) {
        var last: Float = 0
        let mix = Float(bright) // 1 = white, 0 = heavily lowpassed
        for i in 0..<frames {
            let t = Double(i) / Double(frames)
            let white = Float.random(in: -1...1)
            last += (white - last) * (0.08 + mix * 0.6)   // one-pole lowpass
            let sample = last * Float(pow(1 - t, 2)) * vol * 2
            if adding { out[i] += sample } else { out[i] = sample }
        }
    }

    private func schedule(_ buffer: AVAudioPCMBuffer, after: Double) {
        if after <= 0 {
            enqueue(buffer)
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + after) { [weak self] in self?.enqueue(buffer) }
        }
    }

    /// Hands the buffer to the voice that falls quiet soonest — an idle one
    /// whenever there is one — so a sound only ever waits when all ten are
    /// genuinely busy.
    private func enqueue(_ buffer: AVAudioPCMBuffer) {
        guard !players.isEmpty else { return }
        let now = ProcessInfo.processInfo.systemUptime
        let i = busyUntil.indices.min { busyUntil[$0] < busyUntil[$1] } ?? 0
        busyUntil[i] = max(now, busyUntil[i]) + Double(buffer.frameLength) / sampleRate
        players[i].scheduleBuffer(buffer)
    }

    // MARK: - mixdown

    /// A whole flourish summed into one buffer before it plays.
    ///
    /// The big moments — the launch, a win, a bankruptcy — run to thirty or
    /// forty voices over two seconds. Scheduled one blip at a time they would
    /// queue behind each other on the pool and every late voice would arrive
    /// late; mixed down first, the recipe is one buffer on one voice, and every
    /// note lands exactly where it was written. Same tone() and noise(), same
    /// parameters, only added into place instead of played.
    fileprivate final class Mix {
        let rate: Double
        private(set) var data: [Float]
        private let kit: SoundKit

        init(kit: SoundKit, seconds: Double) {
            self.kit = kit
            rate = kit.sampleRate
            data = [Float](repeating: 0, count: max(0, Int(seconds * kit.sampleRate)))
        }

        func tone(_ freq: Double, to: Double? = nil, dur: Double = 0.16,
                  wave: Wave = .sine, vol: Float = 0.22, after: Double = 0) {
            let sr = rate
            let frames = Int(dur * sr)
            guard frames > 0 else { return }
            let start = room(after, frames)
            data.withUnsafeMutableBufferPointer { buf in
                SoundKit.renderTone(freq, to: to, frames: frames, wave: wave, vol: vol, rate: sr,
                                    into: buf.baseAddress! + start, adding: true)
            }
        }

        func noise(dur: Double = 0.2, vol: Float = 0.12, bright: Double = 0.5, after: Double = 0) {
            let frames = Int(dur * rate)
            guard frames > 0 else { return }
            let start = room(after, frames)
            data.withUnsafeMutableBufferPointer { buf in
                SoundKit.renderNoise(frames: frames, vol: vol, bright: bright,
                                     into: buf.baseAddress! + start, adding: true)
            }
        }

        /// One coin: a bright tick of metal, the ring, and an inharmonic
        /// partial at 2.41× — the partial is what makes it a coin, not a bell.
        func coin(at: Double, _ f: Double, _ v: Float) {
            noise(dur: 0.014, vol: v * 0.6, bright: 0.95, after: at)
            tone(kit.jitter(f, 0.01), dur: 0.11, wave: .sine, vol: v, after: at)
            tone(kit.jitter(f * 2.41, 0.01), dur: 0.07, wave: .sine, vol: v * 0.45, after: at + 0.003)
        }

        /// Where a voice starting `after` seconds in begins, growing the
        /// buffer when a ring-out runs past the length the recipe guessed.
        private func room(_ after: Double, _ frames: Int) -> Int {
            let start = max(0, Int(after * rate))
            if data.count < start + frames {
                data.append(contentsOf: [Float](repeating: 0, count: start + frames - data.count))
            }
            return start
        }
    }

    /// Where mixdowns are summed. A win is some twelve seconds of voices
    /// added up sample by sample — tens of milliseconds in a release build,
    /// several times that in a debug one — and on the main thread that stall
    /// landed on the very frames the sound is scored to: the die rolling in
    /// on the splash, the coins lifting off a bust. Serial, so two recipes
    /// asked for in order still start in order.
    private let mixQueue = DispatchQueue(label: "moneymove.sound.mixdown", qos: .userInteractive)

    /// Builds a recipe into one buffer and plays it once. Honours the sound
    /// switch exactly as a lone tone() does; the ambient session keeps the
    /// silent switch in charge. The recipe runs on mixQueue, so it may only
    /// touch the Mix and the pure helpers (jitter, slop); the finished buffer
    /// comes back to the main thread to be handed to a voice.
    private func recipe(seconds: Double, _ build: @escaping (Mix) -> Void) {
        guard enabled, started else { return }
        let format = self.format
        let mix = Mix(kit: self, seconds: seconds)
        // Strong on purpose: the kit is the app's one and only, never freed.
        mixQueue.async {
            build(mix)
            let frames = AVAudioFrameCount(mix.data.count)
            guard frames > 0,
                  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return }
            buffer.frameLength = frames
            mix.data.withUnsafeBufferPointer { src in
                buffer.floatChannelData![0].update(from: src.baseAddress!, count: Int(frames))
            }
            DispatchQueue.main.async { self.enqueue(buffer) }
        }
    }

    // MARK: - the effects
    //
    // Anti-robotic rule: every play is "humanized" — a few percent of random
    // detune and a few milliseconds of timing slop, like a real object would.

    fileprivate func jitter(_ f: Double, _ spread: Double = 0.02) -> Double {
        f * (1 + Double.random(in: -spread...spread))
    }
    private func slop(_ t: Double) -> Double { max(0, t + Double.random(in: -0.012...0.012)) }

    func click() {
        // soft woodblock: two quiet partials, no square-wave beep
        tone(jitter(1080), dur: 0.035, wave: .sine, vol: 0.05)
        tone(jitter(700), dur: 0.05, wave: .triangle, vol: 0.04, after: 0.004)
    }

    /// Somebody spoke. A bubble, not a notification: a short round rise with a
    /// breath of air on top and nothing metallic in it, quiet enough to hear
    /// twenty times a game and still not mind.
    func pop() {
        tone(jitter(430, 0.03), to: 880, dur: 0.06, wave: .sine, vol: 0.11)
        tone(jitter(1320, 0.02), dur: 0.035, wave: .sine, vol: 0.045, after: 0.028)
        noise(dur: 0.02, vol: 0.03, bright: 0.8, after: 0.006)
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

    /// A paddle shoots up: crisp tick, then a ding that climbs with the
    /// stakes — bigger bids literally ring higher.
    func bid(_ amount: Int = 0) {
        let lift = min(Double(max(amount, 0)), 1200) * 0.35
        noise(dur: 0.025, vol: 0.1, bright: 0.85)
        tone(jitter(620 + lift), to: 940 + lift, dur: 0.16, wave: .triangle, vol: 0.16, after: 0.012)
        tone(jitter(1240 + lift, 0.008), dur: 0.14, wave: .sine, vol: 0.07, after: 0.055)
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

    /// The cold launch, laid on the splash's own clock: the die clacks as it
    /// spins in, thumps as the spring settles (0.40), a warm G then C rise
    /// with the wordmark (0.66 / 0.86), and a slow shimmer arrives with the
    /// tagline — all rung out by ~1.8 s, before the splash fades at 1.92.
    func launch() {
        recipe(seconds: 1.9) { [self] m in
            // the tumble: three clacks, each a little softer
            for (i, at) in [0, 0.11, 0.21].enumerated() {
                let t = slop(at)
                let fade = 1 - 0.2 * Double(i)
                m.noise(dur: Double.random(in: 0.028...0.045), vol: Float(0.12 * fade),
                        bright: Double.random(in: 0.82...1.0), after: t)
                m.tone(jitter(Double.random(in: 900...2100)), dur: 0.03, wave: .triangle,
                       vol: Float(0.04 * fade), after: t + 0.002)
            }
            // the landing, with a low body under the rock-to-rest
            m.tone(jitter(260), to: 175, dur: 0.12, wave: .triangle, vol: 0.10, after: 0.40)
            m.tone(jitter(1500), dur: 0.03, wave: .sine, vol: 0.035, after: 0.412)
            m.tone(98, to: 92, dur: 0.30, wave: .sine, vol: 0.08, after: 0.40)
            m.noise(dur: 0.06, vol: 0.05, bright: 0.3, after: 0.40)
            // G as the wordmark rises…
            m.tone(jitter(392, 0.004), dur: 0.55, wave: .triangle, vol: 0.10, after: 0.66)
            m.tone(jitter(784, 0.004), dur: 0.40, wave: .sine, vol: 0.035, after: 0.67)
            m.tone(196, dur: 0.50, wave: .sine, vol: 0.05, after: 0.66)
            // …resolving to C
            m.tone(jitter(523.25, 0.004), dur: 0.95, wave: .triangle, vol: 0.11, after: 0.86)
            m.tone(jitter(659.25, 0.004), dur: 0.80, wave: .sine, vol: 0.04, after: 0.88)
            m.tone(261.6, dur: 0.95, wave: .sine, vol: 0.06, after: 0.86)
            m.tone(jitter(1046.5, 0.004), dur: 0.60, wave: .sine, vol: 0.03, after: 0.87)
            // the shimmer: two near-unison highs beating slowly, one above
            m.tone(2093, dur: 0.55, wave: .sine, vol: 0.02, after: 0.98)
            m.tone(2097, dur: 0.55, wave: .sine, vol: 0.012, after: 0.98)
            m.tone(3136, dur: 0.40, wave: .sine, vol: 0.014, after: 1.06)
        }
    }

    /// The game is over. `mine` is a seat on this phone taking it: a pickup
    /// arpeggio into a held C major with a shimmer run and the winnings
    /// pouring into the till. Everybody else hears the table cheer — the
    /// arpeggio and the chord, a little softer, and none of the coins,
    /// because it is not their till.
    func win(mine: Bool = true) {
        let k: Float = mine ? 1 : 0.75
        recipe(seconds: 1.8) { [self] m in
            for (i, f) in [392, 523.25, 659.25, 783.99].enumerated() {
                let at = slop(0.075 * Double(i))
                m.tone(jitter(f, 0.006), dur: 0.18, wave: .triangle, vol: 0.10 * k, after: at)
                m.tone(jitter(2 * f, 0.006), dur: 0.12, wave: .sine, vol: 0.03 * k, after: at + 0.01)
            }
            // the held chord, with a +5-cent twin on the top C for shimmer
            m.tone(130.8, dur: 1.2, wave: .sine, vol: 0.09 * k, after: 0.32)
            m.tone(jitter(523.25, 0.004), dur: 1.3, wave: .triangle, vol: 0.085 * k, after: 0.32)
            m.tone(jitter(659.25, 0.004), dur: 1.3, wave: .triangle, vol: 0.07 * k, after: 0.33)
            m.tone(jitter(783.99, 0.004), dur: 1.3, wave: .triangle, vol: 0.065 * k, after: 0.34)
            m.tone(1046.5, dur: 1.4, wave: .sine, vol: 0.055 * k, after: 0.32)
            m.tone(1049.5, dur: 1.4, wave: .sine, vol: 0.025 * k, after: 0.32)
            m.tone(jitter(1318.5, 0.004), dur: 0.9, wave: .sine, vol: 0.04 * k, after: 0.40)
            guard mine else { return }
            for (i, f) in [2093.0, 2637, 3136, 3520, 4186].enumerated() {
                m.tone(jitter(f, 0.01), dur: 0.16, wave: .sine, vol: 0.026, after: 0.46 + 0.065 * Double(i))
            }
            // the winnings pour, then slow
            for (i, t) in [0.62, 0.69, 0.75, 0.80, 0.85, 0.905, 0.97, 1.05, 1.15].enumerated() {
                m.coin(at: slop(t), Double.random(in: 1900...2800), Float(0.055 * (1 - 0.06 * Double(i))))
            }
            // and the pile settles
            m.noise(dur: 0.16, vol: 0.035, bright: 0.5, after: 1.24)
            m.coin(at: 1.30, 2200, 0.025)
        }
    }

    /// A seat on this phone has gone bankrupt: comic, not cruel. Three
    /// sad-trombone steps, each bending flat, the long detuned sag whose beat
    /// is the wah-wah, a thud on the floor, and the last few coins rolling
    /// away.
    func bankruptFall() {
        recipe(seconds: 2.2) { [self] m in
            for (t, f) in [(0.0, 392.0), (0.29, 370.0), (0.58, 349.2)] {
                m.tone(jitter(f, 0.005), to: f * 0.95, dur: 0.26, wave: .triangle, vol: 0.12, after: t)
                m.tone(f / 2, to: f * 0.475, dur: 0.26, wave: .sine, vol: 0.05, after: t)
            }
            m.tone(329.6, to: 207.7, dur: 0.9, wave: .triangle, vol: 0.13, after: 0.87)
            m.tone(333.4, to: 210, dur: 0.9, wave: .triangle, vol: 0.05, after: 0.87)
            m.tone(164.8, to: 103.8, dur: 0.9, wave: .sine, vol: 0.06, after: 0.87)
            m.tone(90, to: 48, dur: 0.32, wave: .sine, vol: 0.13, after: 1.62)
            m.noise(dur: 0.28, vol: 0.07, bright: 0.15, after: 1.62)
            m.coin(at: 1.70, 1760, 0.035)
            m.coin(at: 1.86, 1480, 0.028)
            m.coin(at: 2.06, 1250, 0.02)
        }
    }

    /// A seat on this phone is the one who bankrupted them: the register
    /// rings. Keys, the drawer sliding out, the bell, a rising sting into a
    /// bright chord, and the last of their money dropping into the till.
    func bankruptKaching() {
        recipe(seconds: 0.95) { [self] m in
            m.noise(dur: 0.03, vol: 0.12, bright: 0.85, after: 0)
            m.tone(jitter(210), to: 150, dur: 0.05, wave: .triangle, vol: 0.06, after: 0.002)
            m.noise(dur: 0.05, vol: 0.10, bright: 0.55, after: 0.07)
            m.tone(jitter(140), to: 95, dur: 0.08, wave: .triangle, vol: 0.07, after: 0.075)
            m.tone(2093, dur: 0.7, wave: .sine, vol: 0.10, after: 0.12)
            m.tone(2637, dur: 0.5, wave: .sine, vol: 0.05, after: 0.121)
            m.tone(4186, dur: 0.28, wave: .sine, vol: 0.025, after: 0.122)
            m.tone(1046.5, dur: 0.55, wave: .triangle, vol: 0.045, after: 0.12)
            m.tone(jitter(783.99, 0.004), to: 1046.5, dur: 0.14, wave: .triangle, vol: 0.09, after: 0.22)
            m.tone(1046.5, dur: 0.45, wave: .triangle, vol: 0.08, after: 0.34)
            m.tone(1318.5, dur: 0.45, wave: .triangle, vol: 0.065, after: 0.35)
            m.tone(1568, dur: 0.5, wave: .sine, vol: 0.045, after: 0.36)
            for (t, v) in zip([0.40, 0.46, 0.51, 0.58, 0.67, 0.79], [0.05, 0.047, 0.044, 0.04, 0.035, 0.03]) {
                m.coin(at: t, Double.random(in: 2000...2900), Float(v))
            }
        }
    }

    /// Somebody else's bankruptcy, heard from the table: a weight hitting
    /// the floor under the old fall, a crash, a fortune scattering in coins
    /// that spread out as they go, and one coin spinning down flat.
    func bankruptCrash() {
        recipe(seconds: 1.25) { [self] m in
            m.tone(jitter(130), to: 70, dur: 0.24, wave: .sine, vol: 0.10, after: 0)
            m.noise(dur: 0.20, vol: 0.08, bright: 0.5, after: 0)
            m.tone(jitter(400), to: 110, dur: 0.55, wave: .triangle, vol: 0.06, after: 0)
            m.noise(dur: 0.12, vol: 0.07, bright: 0.95, after: 0.015)
            let scatter = [0.030, 0.052, 0.078, 0.110, 0.148, 0.194, 0.249, 0.315, 0.394, 0.489, 0.602, 0.738]
            for (i, t) in scatter.enumerated() {
                m.coin(at: t, Double.random(in: 1600...3000), Float(0.05 * (1 - 0.055 * Double(i))))
            }
            for (j, t) in [0.86, 0.93, 0.99, 1.04, 1.08, 1.11].enumerated() {
                let fade = 1 - 0.1 * Double(j)
                m.noise(dur: 0.01, vol: Float(0.035 * fade), bright: 0.9, after: t)
                m.tone(jitter(2400, 0.02), dur: 0.02, wave: .sine, vol: 0.015, after: t)
            }
            m.tone(jitter(1900), dur: 0.06, wave: .sine, vol: 0.02, after: 1.15)
        }
    }
}
