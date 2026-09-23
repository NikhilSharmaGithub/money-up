package com.moneymove.game

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
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
    private var vibrator: Vibrator? = null

    var enabled: Boolean = true

    fun attach(context: Context, on: Boolean) {
        enabled = on
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }

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

    /** One footstep of a token hop — alternates so a run has texture. */
    private var stepFlip = false
    fun step() {
        stepFlip = !stepFlip
        tone(jitter(if (stepFlip) 620.0 else 690.0, 0.03), dur = 0.04, vol = 0.07f)
    }

    fun land() {
        tone(jitter(300.0), to = 235.0, dur = 0.1, wave = Wave.TRIANGLE, vol = 0.13f)
        tone(jitter(1500.0), dur = 0.03, vol = 0.04f, after = 0.012)
    }

    /** A warm strum, each note doubled an octave up very quietly. */
    fun buy() {
        for ((i, f) in listOf(523.0, 659.0, 784.0).withIndex()) {
            val at = slop(i * 0.07)
            tone(jitter(f, 0.008), dur = 0.3, wave = Wave.TRIANGLE, vol = 0.13f, after = at)
            tone(jitter(f * 2, 0.008), dur = 0.22, vol = 0.045f, after = at + 0.01)
        }
    }

    fun cash() {
        tone(880.0, to = 1320.0, dur = 0.14, wave = Wave.TRIANGLE, vol = 0.16f)
        tone(1320.0, dur = 0.14, vol = 0.1f, after = 0.1)
    }

    fun rent() = tone(420.0, to = 200.0, dur = 0.26, wave = Wave.TRIANGLE, vol = 0.15f)

    /** A whole country in one hand — a short triumphant flourish. */
    fun setComplete() {
        for ((i, f) in listOf(523.0, 659.0, 784.0, 1047.0).withIndex()) {
            tone(jitter(f, 0.006), dur = 0.3, wave = Wave.TRIANGLE, vol = 0.14f, after = i * 0.07)
        }
        tone(jitter(1568.0), dur = 0.4, vol = 0.08f, after = 0.32)
    }

    /** Money arriving in YOUR pocket: a bright rising coin ding. */
    fun gain() {
        tone(988.0, to = 1319.0, dur = 0.12, wave = Wave.TRIANGLE, vol = 0.17f)
        tone(1568.0, dur = 0.18, vol = 0.12f, after = 0.1)
    }

    /** Money leaving YOUR pocket: a little hiss and a sagging "ishh…". */
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

    /** A doorbell third with a hint of shimmer, not two flat beeps. */
    fun turn() {
        tone(jitter(587.0, 0.006), dur = 0.14, vol = 0.12f)
        tone(jitter(589.0, 0.006), dur = 0.14, vol = 0.05f)
        tone(jitter(880.0, 0.006), dur = 0.2, vol = 0.1f, after = 0.11)
        Haptics.turn()
    }

    /** A door, and then the bolt. */
    fun jail() {
        noise(dur = 0.1, vol = 0.18f, bright = 0.25)
        tone(jitter(150.0), to = 90.0, dur = 0.22, wave = Wave.SQUARE, vol = 0.1f, after = 0.02)
        tone(jitter(1200.0), dur = 0.05, vol = 0.06f, after = 0.16)
    }

    fun auction() {
        tone(jitter(700.0), dur = 0.07, wave = Wave.TRIANGLE, vol = 0.16f)
        tone(jitter(520.0), dur = 0.12, wave = Wave.TRIANGLE, vol = 0.14f, after = 0.09)
    }

    /** Pitched by how high the bid is, so a bidding war audibly climbs. */
    fun bid(amount: Int = 0) {
        val lift = (amount.coerceIn(0, 2000) / 2000.0) * 500
        tone(jitter(640.0 + lift), dur = 0.06, wave = Wave.TRIANGLE, vol = 0.12f)
    }

    fun trade() {
        tone(jitter(600.0), to = 800.0, dur = 0.1, wave = Wave.TRIANGLE, vol = 0.13f)
        tone(jitter(800.0), to = 600.0, dur = 0.1, wave = Wave.TRIANGLE, vol = 0.1f, after = 0.1)
    }

    fun build() {
        noise(dur = 0.06, vol = 0.12f, bright = 0.4)
        tone(jitter(420.0), dur = 0.08, wave = Wave.TRIANGLE, vol = 0.12f, after = 0.03)
    }

    fun bankrupt() {
        tone(400.0, to = 120.0, dur = 0.7, wave = Wave.TRIANGLE, vol = 0.17f)
        noise(dur = 0.4, vol = 0.08f, bright = 0.3, after = 0.1)
    }

    /** The deck dealing a board out. */
    fun shuffleDeal() {
        for (i in 0 until 7) {
            noise(dur = 0.05, vol = 0.07f, bright = 0.55, after = i * 0.045)
        }
    }

    fun win() {
        for ((i, f) in listOf(523.0, 659.0, 784.0, 1047.0, 1319.0).withIndex()) {
            tone(jitter(f, 0.004), dur = 0.45, wave = Wave.TRIANGLE, vol = 0.16f, after = i * 0.1)
        }
    }
}

/** The three taps the app uses, and nothing else. */
object Haptics {
    private var vibrator: Vibrator? = null
    var enabled: Boolean = true

    fun attach(context: Context) {
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }

    private fun buzz(ms: Long, amplitude: Int) {
        if (!enabled) return
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        runCatching { v.vibrate(VibrationEffect.createOneShot(ms, amplitude)) }
    }

    fun tap() = buzz(12, 60)
    fun warn() = buzz(30, 150)
    fun turn() = buzz(22, 110)
}
