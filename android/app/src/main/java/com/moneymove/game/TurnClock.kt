package com.moneymove.game

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * The seconds left on the current turn, counted down on this device from the
 * server's deadline.
 *
 * The server only ever hands over a deadline — it does not push once a
 * second — so the count runs here, five times a second, and a quiet turn
 * still ticks down while somebody thinks. It used to be read once per push,
 * which froze the number on whatever it said when the last thing happened
 * and then jumped it; a clock that stands still is worse than no clock.
 *
 * `endsAt` is the turn's epoch-millisecond deadline, handed over as it came.
 * Null means the table runs no clock at all — a game against bots you added
 * yourself has nobody waiting on it — and then nothing is drawn, not "0s".
 * Every caller passes the field straight through so that decision is made in
 * one place rather than five.
 *
 * `compact` is the small one that rides a seat chip, a corner pod or the
 * dock's header; the full one hangs over the board's centre well. The last
 * ten seconds go red and get a heartbeat. iOS: TurnClock in GameScreen.swift,
 * number for number.
 */
@Composable
fun TurnClock(endsAt: Double?, modifier: Modifier = Modifier, compact: Boolean = false) {
    if (endsAt == null) return
    // A fresh deadline restarts the ticker, so the number can never be left
    // stranded on the last turn's final second — iOS's `.id(endsAt)`.
    key(endsAt) {
        val left = rememberSecondsLeft(endsAt)
        ClockFace(left, compact, modifier)
    }
}

/**
 * Seconds until an epoch-millisecond deadline, ticking on this device. Shared
 * by the turn clock and the held-chair countdown so both count the same way:
 * rounded up, never below zero.
 */
@Composable
internal fun rememberSecondsLeft(until: Double): Int {
    var now by remember(until) { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(until) {
        while (true) {
            now = System.currentTimeMillis()
            delay(200)
        }
    }
    return clockSecondsLeft(until, now) ?: 0
}

@Composable
private fun ClockFace(left: Int, compact: Boolean, modifier: Modifier) {
    val p = P.current
    val urgent = left <= 10
    val ink = if (urgent) p.bad else p.ink2
    // The heartbeat: on the odd seconds of the last ten, a beat larger.
    val beat by animateFloatAsState(
        if (urgent && left % 2 != 0) 1.07f else 1f,
        animationSpec = tween(180),
        label = "clockBeat",
    )
    val shape = RoundedCornerShape(99.dp)
    Row(
        modifier
            .graphicsLayer { scaleX = beat; scaleY = beat }
            .background(if (urgent) p.redSoft else p.sunken, shape)
            .border(1.dp, if (urgent) p.bad.copy(alpha = 0.55f) else p.rule, shape)
            .padding(
                horizontal = if (compact) 6.dp else 11.dp,
                vertical = if (compact) 2.5.dp else 5.dp,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        // iOS's timer symbol — a dial open at twelve, with its hand — drawn
        // in SafetySheets' set of system marks. At eleven points iOS's is
        // eleven points of ink; the drawing keeps a hair of margin inside its
        // grid, so its box is a size up to come out the same on the capsule.
        if (!compact) SfMark("timer", 13.dp, ink)
        Text(
            "${left}s",
            color = ink,
            // Tabular figures, so "10s" becoming "9s" does not make the
            // capsule twitch on every tick.
            style = TextStyle(fontFeatureSettings = "tnum"),
            fontSize = if (compact) 10.5.sp else 13.sp,
            fontWeight = FontWeight.ExtraBold,
            fontFamily = FontFamily.Default,
            maxLines = 1,
            softWrap = false,
        )
    }
}
