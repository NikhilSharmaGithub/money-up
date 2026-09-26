package com.moneymove.game

import android.content.ContentResolver
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.SystemClock
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import androidx.annotation.RequiresApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.pow
import kotlin.math.sin
import kotlin.random.Random

/**
 * Synthesised sound kit — every effect is generated as PCM at play time, so
 * the app ships no audio assets. The web client does the same with the Web
 * Audio API and the iOS app with AVAudioEngine; this is the same set of
 * sounds, built from the same two primitives, so a table sounds like one game
 * whichever three devices are sitting at it.
 *
 * Anti-robotic rule, copied along with the sounds: every play is humanised —
 * a few percent of random detune and a few milliseconds of timing slop, the
 * way a real object never lands twice the same.
 */
object SoundKit {

    private const val RATE = 44_100
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    var enabled: Boolean = true

    /** Kept for the one question only [launch] asks: is the ringer on? */
    private var audio: AudioManager? = null

    fun attach(context: Context, on: Boolean) {
        enabled = on
        audio = (context.applicationContext ?: context).getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    }

    /**
     * Nothing to warm, on purpose.
     *
     * iOS has to start its AVAudioEngine on a user gesture or the first sound
     * of a session is swallowed, so GameStore.swift calls warmUp() on create,
     * quick play and join. Every sound here builds its own AudioTrack at play
     * time, so there is no engine to start. It exists so a line carried over
     * from the iOS source compiles and means the same thing: "about to make
     * noise".
     */
    fun warmUp() {}

    private enum class Wave { SINE, TRIANGLE, SQUARE }

    /**
     * One note. `to` bends the pitch across the note, which is what turns a
     * beep into something that has happened to an object.
     */
    private fun tone(
        freq: Double,
        to: Double? = null,
        dur: Double = 0.16,
        wave: Wave = Wave.SINE,
        vol: Float = 0.22f,
        after: Double = 0.0,
    ) {
        if (!enabled) return
        val frames = (dur * RATE).toInt()
        if (frames <= 0) return
        scope.launch {
            if (after > 0) delay((after * 1000).toLong())
            val data = ShortArray(frames)
            var phase = 0.0
            for (i in 0 until frames) {
                val t = i.toDouble() / frames
                val f = if (to != null) freq * (to / freq).pow(t) else freq
                phase += 2 * PI * f / RATE
                val raw = when (wave) {
                    Wave.SINE -> sin(phase)
                    Wave.TRIANGLE -> 2 / PI * asin(sin(phase))
                    Wave.SQUARE -> if (sin(phase) > 0) 1.0 else -1.0
                }
                // Fast attack, exponential decay — a soft mallet, not a beep.
                val env = minOf(t / 0.03, 1.0) * (1 - t).pow(1.6)
                data[i] = (raw * env * vol * Short.MAX_VALUE).toInt()
                    .coerceIn(-32768, 32767).toShort()
            }
            play(data)
        }
    }

    /** A short filtered-noise burst — dice tumbles, card whooshes. */
    private fun noise(
        dur: Double = 0.2,
        vol: Float = 0.12f,
        bright: Double = 0.5,
        after: Double = 0.0,
    ) {
        if (!enabled) return
        val frames = (dur * RATE).toInt()
        if (frames <= 0) return
        scope.launch {
            if (after > 0) delay((after * 1000).toLong())
            val data = ShortArray(frames)
            var last = 0.0
            val mix = bright                       // 1 = white, 0 = heavily lowpassed
            for (i in 0 until frames) {
                val t = i.toDouble() / frames
                val white = Random.nextDouble(-1.0, 1.0)
                last += (white - last) * (0.08 + mix * 0.6)   // one-pole lowpass
                val v = last * (1 - t).pow(2.0) * vol * 2
                data[i] = (v * Short.MAX_VALUE).toInt().coerceIn(-32768, 32767).toShort()
            }
            play(data)
        }
    }

    /**
     * A fresh track per sound.
     *
     * Wasteful in principle and right in practice: these are tens of
     * milliseconds each, several can overlap, and a pool of reused tracks
     * would need its own scheduler to stop one clack cutting off the next.
     */
    private fun play(data: ShortArray) {
        val track = runCatching {
            AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_GAME)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setBufferSizeInBytes(maxOf(data.size * 2, 1024))
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build()
        }.getOrNull() ?: return

        runCatching {
            track.write(data, 0, data.size)
            track.setVolume(0.6f)
            track.play()
        }
        // Let it finish, then give the hardware back.
        scope.launch {
            delay((data.size * 1000L / RATE) + 120)
            runCatching { track.stop(); track.release() }
        }
    }

    private fun jitter(f: Double, spread: Double = 0.02) = f * (1 + Random.nextDouble(-spread, spread))
    private fun slop(t: Double) = maxOf(0.0, t + Random.nextDouble(-0.012, 0.012))
    private fun rnd(a: Double, b: Double) = Random.nextDouble(a, b)

    /**
     * One buffer that many voices are summed into, for the flourishes.
     *
     * [tone] and [noise] above give every voice a coroutine and an AudioTrack
     * of its own, which is right for a clack and wrong for a fanfare: fifty
     * voices in two seconds is fifty tracks, past the thirty-two Android 7's
     * mixer will run at once, and every `delay` on the way adds its own few
     * milliseconds of drift to a chord that has to land together. So the
     * long recipes are mixed down here first — the same maths, voice for
     * voice, added into one float buffer at each voice's own offset — and
     * played as one track.
     */
    private class Mix(seconds: Double) {
        val data = FloatArray((seconds * RATE).toInt().coerceAtLeast(1))

        fun tone(
            freq: Double,
            to: Double? = null,
            dur: Double = 0.16,
            wave: Wave = Wave.SINE,
            vol: Double = 0.22,
            after: Double = 0.0,
        ) {
            val frames = (dur * RATE).toInt()
            if (frames <= 0) return
            val start = (after * RATE).toInt()
            var phase = 0.0
            for (i in 0 until frames) {
                val k = start + i
                if (k >= data.size) break
                val t = i.toDouble() / frames
                val f = if (to != null) freq * (to / freq).pow(t) else freq
                phase += 2 * PI * f / RATE
                val raw = when (wave) {
                    Wave.SINE -> sin(phase)
                    Wave.TRIANGLE -> 2 / PI * asin(sin(phase))
                    Wave.SQUARE -> if (sin(phase) > 0) 1.0 else -1.0
                }
                val env = minOf(t / 0.03, 1.0) * (1 - t).pow(1.6)
                data[k] += (raw * env * vol).toFloat()
            }
        }

        fun noise(dur: Double = 0.2, vol: Double = 0.12, bright: Double = 0.5, after: Double = 0.0) {
            val frames = (dur * RATE).toInt()
            if (frames <= 0) return
            val start = (after * RATE).toInt()
            var last = 0.0
            for (i in 0 until frames) {
                val k = start + i
                if (k >= data.size) break
                val t = i.toDouble() / frames
                val white = Random.nextDouble(-1.0, 1.0)
                last += (white - last) * (0.08 + bright * 0.6)
                data[k] += (last * (1 - t).pow(2.0) * vol * 2).toFloat()
            }
        }
    }

    /**
     * Mixes a recipe down and plays it as one track. Converted with the same
     * clamp every other sound uses; no voice in a recipe is louder than 0.13,
     * so at the worst instant the sum sits far under it and nothing clips.
     */
    private fun recipe(seconds: Double, build: Mix.() -> Unit) {
        if (!enabled) return
        scope.launch {
            val mix = Mix(seconds).apply(build)
            val out = ShortArray(mix.data.size) { i ->
                (mix.data[i] * Short.MAX_VALUE).toInt().coerceIn(-32768, 32767).toShort()
            }
            play(out)
        }
    }

    /**
     * One coin: a tick of bright metal, then the ring — with a partial at
     * 2.41 times the note, which is what makes it a coin and not a bell.
     */
    private fun Mix.coin(at: Double, f: Double, v: Double) {
        noise(dur = 0.014, vol = v * 0.6, bright = 0.95, after = at)
        tone(jitter(f, 0.01), dur = 0.11, wave = Wave.SINE, vol = v, after = at)
        tone(jitter(f * 2.41, 0.01), dur = 0.07, wave = Wave.SINE, vol = v * 0.45, after = at + 0.003)
    }

    // ── the effects ────────────────────────────────────────────────────────

    /** Soft woodblock: two quiet partials, no square-wave beep. */
    fun click() {
        tone(jitter(1080.0), dur = 0.035, wave = Wave.SINE, vol = 0.05f)
        tone(jitter(700.0), dur = 0.05, wave = Wave.TRIANGLE, vol = 0.04f, after = 0.004)
    }

    /**
     * Somebody spoke. A bubble, not a notification: a short round rise with a
     * breath of air on top and nothing metallic in it — quiet enough to hear
     * twenty times a game and still not mind.
     */
    fun pop() {
        tone(jitter(430.0, 0.03), to = 880.0, dur = 0.06, vol = 0.11f)
        tone(jitter(1320.0, 0.02), dur = 0.035, vol = 0.045f, after = 0.028)
        noise(dur = 0.02, vol = 0.03f, bright = 0.8, after = 0.006)
    }

    /**
     * Real dice: a handful of sharp little clacks with irregular gaps and a
     * soft settle at the end — not three even whooshes.
     */
    fun dice() {
        var t = 0.0
        for (i in 0 until 5) {
            val fade = 1 - i * 0.13
            noise(
                dur = Random.nextDouble(0.028, 0.05), vol = (0.16 * fade).toFloat(),
                bright = Random.nextDouble(0.82, 1.0), after = t,
            )
            // A faint pitch inside each clack reads as bone on wood.
            tone(
                jitter(Random.nextDouble(900.0, 2100.0)), dur = 0.03, wave = Wave.TRIANGLE,
                vol = (0.05 * fade).toFloat(), after = t + 0.002,
            )
            t += Random.nextDouble(0.045, 0.095)
        }
        // The die rocks to rest.
        tone(jitter(260.0), to = 175.0, dur = 0.1, wave = Wave.TRIANGLE, vol = 0.09f, after = t + 0.02)
    }

    /**
     * One footstep of a token hop — alternates so a run has texture.
     *
     * The hop is felt as well as heard: iOS knocks the phone once per tile
     * (BoardView.swift, a light impact at 0.55) right beside this call. The
     * walker that calls it is not this file's, so the knock rides along here
     * instead — and like iOS's, it is not silenced by the sound switch.
     */
    private var stepFlip = false
    fun step() {
        stepFlip = !stepFlip
        tone(jitter(if (stepFlip) 620.0 else 690.0, 0.03), dur = 0.04, vol = 0.07f)
        Haptics.step()
    }

    /** The last hop of a walk: the piece set down, and the same knock as a step. */
    fun land() {
        tone(jitter(300.0), to = 235.0, dur = 0.1, wave = Wave.TRIANGLE, vol = 0.13f)
        tone(jitter(1500.0), dur = 0.03, vol = 0.04f, after = 0.012)
        Haptics.step()
    }

    /** A warm strum, each note doubled an octave up very quietly. */
    fun buy() {
        for ((i, f) in listOf(523.0, 659.0, 784.0).withIndex()) {
            val at = slop(i * 0.07)
            tone(jitter(f, 0.008), dur = 0.3, wave = Wave.TRIANGLE, vol = 0.13f, after = at)
            tone(jitter(f * 2, 0.008), dur = 0.22, vol = 0.045f, after = at + 0.01)
        }
    }

    /** Somebody else's money moving — the till, not your pocket. */
    fun cash() {
        tone(880.0, to = 1320.0, dur = 0.14, wave = Wave.TRIANGLE, vol = 0.16f)
        tone(1320.0, dur = 0.14, vol = 0.1f, after = 0.1)
    }

    fun rent() = tone(420.0, to = 200.0, dur = 0.26, wave = Wave.TRIANGLE, vol = 0.15f)

    /**
     * A whole country in one hand — a short triumphant flourish.
     *
     * Sound only. iOS pairs it with Haptics.turn() at the call site
     * (GameStore.swift, the set-completion scan), and so should Android.
     */
    fun setComplete() {
        for ((i, f) in listOf(523.0, 659.0, 784.0, 1047.0).withIndex()) {
            tone(jitter(f, 0.006), dur = 0.3, wave = Wave.TRIANGLE, vol = 0.14f, after = i * 0.07)
        }
        tone(jitter(1568.0), dur = 0.4, vol = 0.08f, after = 0.32)
    }

    /** Money arriving in YOUR pocket: a bright rising coin ding. Pair with Haptics.tap(). */
    fun gain() {
        tone(988.0, to = 1319.0, dur = 0.12, wave = Wave.TRIANGLE, vol = 0.17f)
        tone(1568.0, dur = 0.18, vol = 0.12f, after = 0.1)
    }

    /** Money leaving YOUR pocket: a little hiss and a sagging "ishh…". Pair with Haptics.warn(). */
    fun lose() {
        noise(dur = 0.2, vol = 0.1f, bright = 0.7)
        tone(330.0, to = 165.0, dur = 0.34, wave = Wave.TRIANGLE, vol = 0.16f, after = 0.04)
    }

    /** A paper slide, brightening as the card flips over. */
    fun card() {
        noise(dur = 0.2, vol = 0.08f, bright = 0.3)
        noise(dur = 0.16, vol = 0.09f, bright = 0.6, after = 0.14)
        tone(jitter(880.0), dur = 0.06, vol = 0.05f, after = 0.26)
    }

    /**
     * A doorbell third with a hint of shimmer, not two flat beeps: each note
     * has a faint twin a few cents sharp, which is where the shimmer lives.
     *
     * It knocks as well, as it always has on Android. iOS makes the same two
     * calls side by side at its call site (GameStore.swift, the turn change),
     * and a Haptics.turn() added beside this one is folded into the same knock
     * rather than felt twice — see Haptics.
     */
    fun turn() {
        tone(jitter(587.0, 0.006), dur = 0.14, vol = 0.12f)
        tone(jitter(589.0, 0.006), dur = 0.14, vol = 0.05f)
        tone(jitter(880.0, 0.006), dur = 0.2, vol = 0.1f, after = 0.11)
        tone(jitter(884.0, 0.006), dur = 0.2, vol = 0.04f, after = 0.11)
        Haptics.turn()
    }

    /** A cell door: a metallic clank, then a low slam. */
    fun jail() {
        noise(dur = 0.05, vol = 0.12f, bright = 0.95)
        tone(jitter(520.0), to = 490.0, dur = 0.09, wave = Wave.SQUARE, vol = 0.06f, after = 0.01)
        tone(jitter(150.0), to = 110.0, dur = 0.3, wave = Wave.TRIANGLE, vol = 0.15f, after = 0.12)
        noise(dur = 0.12, vol = 0.08f, bright = 0.2, after = 0.12)
    }

    /** The gavel opening an auction: two woody knocks. Once per auction, not per bid. */
    fun auction() {
        noise(dur = 0.035, vol = 0.13f, bright = 0.7)
        tone(jitter(820.0), dur = 0.05, wave = Wave.TRIANGLE, vol = 0.09f, after = 0.002)
        noise(dur = 0.035, vol = 0.11f, bright = 0.7, after = 0.16)
        tone(jitter(760.0), dur = 0.05, wave = Wave.TRIANGLE, vol = 0.08f, after = 0.162)
    }

    /**
     * A paddle shoots up: a crisp tick, then a ding that climbs with the
     * stakes — bigger bids literally ring higher, so a bidding war audibly
     * climbs. Pass the new bid; pair with Haptics.tap() as iOS does.
     */
    fun bid(amount: Int = 0) {
        val lift = amount.coerceIn(0, 1200) * 0.35
        noise(dur = 0.025, vol = 0.1f, bright = 0.85)
        tone(jitter(620.0 + lift), to = 940.0 + lift, dur = 0.16, wave = Wave.TRIANGLE, vol = 0.16f, after = 0.012)
        tone(jitter(1240.0 + lift, 0.008), dur = 0.14, vol = 0.07f, after = 0.055)
    }

    /** A deal struck: a rising arpeggio with a soft bell on top. */
    fun trade() {
        for ((i, f) in listOf(440.0, 587.0, 740.0).withIndex()) {
            tone(jitter(f, 0.008), dur = 0.26, wave = Wave.TRIANGLE, vol = 0.11f, after = slop(i * 0.08))
        }
        tone(jitter(1174.0), dur = 0.18, vol = 0.05f, after = 0.24)
    }

    /** Hammer taps with a little wood resonance under each. */
    fun build() {
        for (i in 0 until 3) {
            val at = maxOf(0.0, i * 0.11 + Random.nextDouble(-0.01, 0.01))
            noise(dur = 0.03, vol = 0.1f, bright = 0.75, after = at)
            tone(
                jitter(Random.nextDouble(320.0, 420.0)), dur = 0.06, wave = Wave.TRIANGLE,
                vol = 0.08f, after = at + 0.002,
            )
        }
    }

    /**
     * The seat on THIS device just went bankrupt: comic, not cruel. Three
     * sad-trombone steps down, each bending a semitone flat as it goes, then
     * the long sag — a detuned twin under it, and the beat between the two is
     * the "wah-wah" wobble — onto a soft thud, and the last three coins
     * rolling away. About 2.1s. Pair with Haptics.warn() at the start.
     */
    fun bankruptFall() = recipe(2.25) {
        for ((t, f) in listOf(0.0 to 392.0, 0.29 to 370.0, 0.58 to 349.2)) {
            tone(jitter(f, 0.005), to = f * 0.95, dur = 0.26, wave = Wave.TRIANGLE, vol = 0.12, after = t)
            tone(f / 2, to = f * 0.475, dur = 0.26, wave = Wave.SINE, vol = 0.05, after = t)
        }
        tone(329.6, to = 207.7, dur = 0.9, wave = Wave.TRIANGLE, vol = 0.13, after = 0.87)
        tone(333.4, to = 210.0, dur = 0.9, wave = Wave.TRIANGLE, vol = 0.05, after = 0.87)
        tone(164.8, to = 103.8, dur = 0.9, wave = Wave.SINE, vol = 0.06, after = 0.87)
        // The floor.
        tone(90.0, to = 48.0, dur = 0.32, wave = Wave.SINE, vol = 0.13, after = 1.62)
        noise(dur = 0.28, vol = 0.07, bright = 0.15, after = 1.62)
        // The last money rolls away.
        coin(1.70, 1760.0, 0.035)
        coin(1.86, 1480.0, 0.028)
        coin(2.06, 1250.0, 0.02)
    }

    /**
     * A seat on THIS device is the one the bust paid: a cash register in a
     * triumphant register — the keys, the drawer, the bell, a rising sting
     * into a bright chord, and the takings dropping into the till. About
     * 0.95s. Pair with Haptics.turn() at 0.12s, on the bell.
     */
    fun bankruptKaching() = recipe(1.0) {
        // Keys.
        noise(dur = 0.03, vol = 0.12, bright = 0.85, after = 0.0)
        tone(jitter(210.0), to = 150.0, dur = 0.05, wave = Wave.TRIANGLE, vol = 0.06, after = 0.002)
        // Drawer.
        noise(dur = 0.05, vol = 0.10, bright = 0.55, after = 0.07)
        tone(jitter(140.0), to = 95.0, dur = 0.08, wave = Wave.TRIANGLE, vol = 0.07, after = 0.075)
        // Bell.
        tone(2093.0, dur = 0.7, wave = Wave.SINE, vol = 0.10, after = 0.12)
        tone(2637.0, dur = 0.5, wave = Wave.SINE, vol = 0.05, after = 0.121)
        tone(4186.0, dur = 0.28, wave = Wave.SINE, vol = 0.025, after = 0.122)
        tone(1046.5, dur = 0.55, wave = Wave.TRIANGLE, vol = 0.045, after = 0.12)
        // Sting, then the chord.
        tone(jitter(783.99, 0.004), to = 1046.5, dur = 0.14, wave = Wave.TRIANGLE, vol = 0.09, after = 0.22)
        tone(1046.5, dur = 0.45, wave = Wave.TRIANGLE, vol = 0.08, after = 0.34)
        tone(1318.5, dur = 0.45, wave = Wave.TRIANGLE, vol = 0.065, after = 0.35)
        tone(1568.0, dur = 0.5, wave = Wave.SINE, vol = 0.045, after = 0.36)
        // Into the till.
        for ((t, v) in listOf(0.40 to 0.05, 0.46 to 0.047, 0.51 to 0.044, 0.58 to 0.04, 0.67 to 0.035, 0.79 to 0.03)) {
            coin(t, rnd(2000.0, 2900.0), v)
        }
    }

    /**
     * Somebody at the table went bankrupt and it was nobody on this device,
     * on either side of it: a weight hitting the floor and a crash of coins
     * scattering across it, the gaps widening as they go, and one last coin
     * spinning down flat. About 1.2s, and no knock — it is not yours.
     */
    fun bankruptCrash() = recipe(1.25) {
        // Weight.
        tone(jitter(130.0), to = 70.0, dur = 0.24, wave = Wave.SINE, vol = 0.10, after = 0.0)
        noise(dur = 0.20, vol = 0.08, bright = 0.5, after = 0.0)
        // The old fall, quieter, underneath.
        tone(jitter(400.0), to = 110.0, dur = 0.55, wave = Wave.TRIANGLE, vol = 0.06, after = 0.0)
        // Crash.
        noise(dur = 0.12, vol = 0.07, bright = 0.95, after = 0.015)
        // Scatter: each gap 1.2x the last.
        val scatter = listOf(0.030, 0.052, 0.078, 0.110, 0.148, 0.194, 0.249, 0.315, 0.394, 0.489, 0.602, 0.738)
        for ((k, t) in scatter.withIndex()) coin(t, rnd(1600.0, 3000.0), 0.05 * (1 - 0.055 * k))
        // One coin spinning down.
        for ((j, t) in listOf(0.86, 0.93, 0.99, 1.04, 1.08, 1.11).withIndex()) {
            noise(dur = 0.01, vol = 0.035 * (1 - 0.1 * j), bright = 0.9, after = t)
            tone(jitter(2400.0, 0.02), dur = 0.02, wave = Wave.SINE, vol = 0.015, after = t)
        }
        // And falling flat.
        tone(jitter(1900.0), dur = 0.06, wave = Wave.SINE, vol = 0.02, after = 1.15)
    }

    /**
     * The deck dealing a board out: an accelerating riffle of card snaps, a
     * breath of the deck settling, then a rising run as the tiles land.
     */
    fun shuffleDeal() {
        var t = 0.0
        var gap = 0.085
        for (i in 0 until 9) {
            noise(dur = 0.03, vol = (0.07 + i * 0.006).toFloat(), bright = 0.65, after = t)
            t += gap
            gap = maxOf(0.028, gap * 0.82)   // the riffle speeds up
        }
        noise(dur = 0.24, vol = 0.1f, bright = 0.4, after = t)
        for ((i, f) in listOf(392.0, 494.0, 587.0, 784.0).withIndex()) {
            tone(jitter(f, 0.006), dur = 0.18, wave = Wave.TRIANGLE, vol = 0.1f, after = t + 0.18 + i * 0.07)
        }
    }

    /**
     * The game is over.
     *
     * A pickup arpeggio into a held C major — a low root under it, and a twin
     * five cents sharp on the top C, which is where the chord's shimmer lives
     * — with a bell on top. When a seat on THIS device took it ([mine]) a
     * shimmer climbs over the chord and nine coins pour into the pile, slowing
     * as they land, then the pile settles: about 1.9s. Everybody else hears
     * the table cheer, not their own till — the fanfare alone, a quarter
     * quieter. The winner's knock (Haptics.turn() at 0.32s, on the chord) is
     * the caller's.
     */
    fun win(mine: Boolean = true) = recipe(1.8) {
        val g = if (mine) 1.0 else 0.75
        for ((i, f) in listOf(392.0, 523.25, 659.25, 783.99).withIndex()) {
            val at = slop(0.075 * i)
            tone(jitter(f, 0.006), dur = 0.18, wave = Wave.TRIANGLE, vol = 0.10 * g, after = at)
            tone(jitter(2 * f, 0.006), dur = 0.12, wave = Wave.SINE, vol = 0.03 * g, after = at + 0.01)
        }
        // The held chord.
        tone(130.8, dur = 1.2, wave = Wave.SINE, vol = 0.09 * g, after = 0.32)
        tone(jitter(523.25, 0.004), dur = 1.3, wave = Wave.TRIANGLE, vol = 0.085 * g, after = 0.32)
        tone(jitter(659.25, 0.004), dur = 1.3, wave = Wave.TRIANGLE, vol = 0.07 * g, after = 0.33)
        tone(jitter(783.99, 0.004), dur = 1.3, wave = Wave.TRIANGLE, vol = 0.065 * g, after = 0.34)
        tone(1046.5, dur = 1.4, wave = Wave.SINE, vol = 0.055 * g, after = 0.32)
        tone(1049.5, dur = 1.4, wave = Wave.SINE, vol = 0.025 * g, after = 0.32)
        // Top bell.
        tone(jitter(1318.5, 0.004), dur = 0.9, wave = Wave.SINE, vol = 0.04 * g, after = 0.40)
        if (!mine) return@recipe

        // Shimmer run.
        for ((k, f) in listOf(2093.0, 2637.0, 3136.0, 3520.0, 4186.0).withIndex()) {
            tone(jitter(f, 0.01), dur = 0.16, wave = Wave.SINE, vol = 0.026, after = 0.46 + 0.065 * k)
        }
        // The coins pour, then slow.
        val pour = listOf(0.62, 0.69, 0.75, 0.80, 0.85, 0.905, 0.97, 1.05, 1.15)
        for ((k, t) in pour.withIndex()) coin(slop(t), rnd(1900.0, 2800.0), 0.055 * (1 - 0.06 * k))
        // The pile settles.
        noise(dur = 0.16, vol = 0.035, bright = 0.5, after = 1.24)
        coin(1.30, 2200.0, 0.025)
    }

    /**
     * The app opening, on the splash's own clock (SplashView): the die
     * tumbling in — three clacks while it spins — a knock as it lands at
     * 0.40, a warm G then C as the wordmark rises (0.66, 0.86), and a slow
     * shimmer with the tagline. Rung out by about 1.8s, before the splash
     * fades at 1.92.
     *
     * The one sound the player did not cause, so it is the one that minds
     * the ringer: on silent or vibrate it keeps quiet, which is what the
     * iPhone's silent switch does to it there. Every other sound plays on
     * the game stream as it always has.
     */
    fun launch() {
        if (audio?.ringerMode?.let { it != AudioManager.RINGER_MODE_NORMAL } == true) return
        recipe(1.85) {
            // The tumble.
            for ((i, at) in listOf(0.0, 0.11, 0.21).withIndex()) {
                val t = slop(at)
                val fade = 1 - 0.2 * i
                noise(dur = rnd(0.028, 0.045), vol = 0.12 * fade, bright = rnd(0.82, 1.0), after = t)
                tone(jitter(rnd(900.0, 2100.0)), dur = 0.03, wave = Wave.TRIANGLE, vol = 0.04 * fade, after = t + 0.002)
            }
            // It lands, on the spring's first settle.
            tone(jitter(260.0), to = 175.0, dur = 0.12, wave = Wave.TRIANGLE, vol = 0.10, after = 0.40)
            tone(jitter(1500.0), dur = 0.03, wave = Wave.SINE, vol = 0.035, after = 0.412)
            tone(98.0, to = 92.0, dur = 0.30, wave = Wave.SINE, vol = 0.08, after = 0.40)
            noise(dur = 0.06, vol = 0.05, bright = 0.3, after = 0.40)
            // G with the wordmark rising...
            tone(jitter(392.0, 0.004), dur = 0.55, wave = Wave.TRIANGLE, vol = 0.10, after = 0.66)
            tone(jitter(784.0, 0.004), dur = 0.40, wave = Wave.SINE, vol = 0.035, after = 0.67)
            tone(196.0, dur = 0.50, wave = Wave.SINE, vol = 0.05, after = 0.66)
            // ...and home to C.
            tone(jitter(523.25, 0.004), dur = 0.95, wave = Wave.TRIANGLE, vol = 0.11, after = 0.86)
            tone(jitter(659.25, 0.004), dur = 0.80, wave = Wave.SINE, vol = 0.04, after = 0.88)
            tone(261.6, dur = 0.95, wave = Wave.SINE, vol = 0.06, after = 0.86)
            tone(jitter(1046.5, 0.004), dur = 0.60, wave = Wave.SINE, vol = 0.03, after = 0.87)
            // Shimmer with the tagline: two notes 4Hz apart, a slow beat.
            tone(2093.0, dur = 0.55, wave = Wave.SINE, vol = 0.02, after = 0.98)
            tone(2097.0, dur = 0.55, wave = Wave.SINE, vol = 0.012, after = 0.98)
            tone(3136.0, dur = 0.40, wave = Wave.SINE, vol = 0.014, after = 1.06)
        }
    }
}

/**
 * The phone's knock, in the four grades the iOS app uses and no others.
 *
 * iOS has exactly three feedback calls (GameStore.swift, `enum Haptics`) plus
 * the token's footstep, and every buzz in that app is one of them:
 *
 *  - [tap]  — UIImpactFeedbackGenerator(.light). Buttons that do something:
 *             build, sell, mortgage, a bid, money arriving, a street ticked
 *             into a trade.
 *  - [step] — the same light impact at 0.55 intensity, once per tile a token
 *             hops. Lighter than a tap because there are a dozen in a row.
 *  - [turn] — UINotificationFeedbackGenerator(.success). The moments that are
 *             an outcome: your turn, a country completed, a trade accepted,
 *             a friend added.
 *  - [warn] — UINotificationFeedbackGenerator(.warning). Money leaving you.
 *
 * There is no "medium" or "heavy" on purpose: iOS never uses one, and a
 * fifth grade here would be a feel the other platform does not have.
 *
 * Android has no feedback generator, so each grade is built from the nearest
 * thing each Android version offers: the tuned composition primitives on 11+
 * where the motor supports them, the system's own click and tick on 10, a
 * shaped one-shot or waveform on 8–9, and a bare pulse on 7. The two
 * notification grades are two knocks, as they are on iOS — rising for
 * success, falling for a warning — so they cannot be mistaken for a tap.
 *
 * Two switches are honoured. The system's touch-feedback setting is the
 * Android twin of the one iOS's generators obey (a player who turned System
 * Haptics off feels nothing from any app). [enabled] is the app's own, which
 * Settings sets.
 *
 * Callable from any thread: the vibrator service is.
 */
object Haptics {
    private var vibrator: Vibrator? = null
    private var resolver: ContentResolver? = null

    /**
     * The app's own switch. Settings ties it to the sound switch today; iOS
     * has no such tie — its haptics fire with sound off, which is how a player
     * with a muted phone still feels the rent go — so leaving this true is
     * the iOS behaviour.
     */
    var enabled: Boolean = true

    fun attach(context: Context) {
        val app = context.applicationContext ?: context
        resolver = app.contentResolver
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (app.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            app.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }

    private enum class Grade { TAP, STEP, SUCCESS, WARNING }

    fun tap() = knock(Grade.TAP)
    fun step() = knock(Grade.STEP)
    fun turn() = knock(Grade.SUCCESS)
    fun warn() = knock(Grade.WARNING)

    /**
     * The same grade twice inside this window is one knock. A port that
     * mirrors iOS line for line ends up calling Haptics.turn() beside a
     * SoundKit.turn() that already knocks, and two success patterns on top of
     * each other feel like an error, not a success.
     */
    private const val COALESCE_MS = 50L
    @Volatile private var lastGrade: Grade? = null
    @Volatile private var lastAt = 0L

    private fun knock(grade: Grade) {
        if (!enabled) return
        val v = vibrator ?: return
        if (!v.hasVibrator() || !systemAllows()) return
        val now = SystemClock.uptimeMillis()
        if (grade == lastGrade && now - lastAt < COALESCE_MS) return
        lastGrade = grade
        lastAt = now
        runCatching { vibrate(v, grade) }
    }

    /**
     * The system's touch-feedback switch — on unless the player turned it off.
     *
     * From Android 13 the vibrator applies it itself: every knock is sent with
     * the touch usage, and a touch intensity of "off" swallows it. Before 13
     * an app's vibration ignores that switch entirely, so it is read here, on
     * every knock, because a player can flip it with the app open.
     */
    private fun systemAllows(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return true
        val r = resolver ?: return true
        return runCatching {
            @Suppress("DEPRECATION")
            Settings.System.getInt(r, Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) != 0
        }.getOrDefault(true)
    }

    private fun vibrate(v: Vibrator, grade: Grade) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // Android 7 has on and off and nothing between: the grades differ
            // only in length and in the number of knocks.
            @Suppress("DEPRECATION")
            when (grade) {
                Grade.TAP -> v.vibrate(12)
                Grade.STEP -> v.vibrate(8)
                Grade.SUCCESS -> v.vibrate(longArrayOf(0, 14, 70, 22), -1)
                Grade.WARNING -> v.vibrate(longArrayOf(0, 22, 90, 14), -1)
            }
            return
        }
        val effect = effectFor(v, grade)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Touch usage puts every grade under the player's touch-feedback
            // intensity, which is the slider these belong to.
            v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH))
        } else {
            @Suppress("DEPRECATION")
            v.vibrate(effect, SONIFICATION)
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun effectFor(v: Vibrator, grade: Grade): VibrationEffect {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            v.areAllPrimitivesSupported(VibrationEffect.Composition.PRIMITIVE_CLICK)
        ) {
            val c = VibrationEffect.startComposition()
            when (grade) {
                Grade.TAP -> c.addPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.8f)
                Grade.STEP -> c.addPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.55f)
                Grade.SUCCESS -> c
                    .addPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.5f)
                    .addPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK, 1f, 80)
                Grade.WARNING -> c
                    .addPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK, 1f)
                    .addPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.5f, 100)
            }
            return c.compose()
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            when (grade) {
                Grade.TAP -> return VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)
                Grade.STEP -> return VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)
                else -> Unit   // no predefined success or warning: shaped below
            }
        }
        val amp = v.hasAmplitudeControl()
        fun a(level: Int) = if (amp) level else VibrationEffect.DEFAULT_AMPLITUDE
        return when (grade) {
            Grade.TAP -> VibrationEffect.createOneShot(12, a(70))
            Grade.STEP -> VibrationEffect.createOneShot(8, a(45))
            Grade.SUCCESS -> VibrationEffect.createWaveform(
                longArrayOf(0, 14, 70, 22), intArrayOf(0, a(90), 0, a(200)), -1,
            )
            Grade.WARNING -> VibrationEffect.createWaveform(
                longArrayOf(0, 22, 90, 14), intArrayOf(0, a(200), 0, a(110)), -1,
            )
        }
    }

    /** Below Android 13, sonification is the usage the touch-feedback intensity governs. */
    private val SONIFICATION: AudioAttributes by lazy {
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
    }
}
