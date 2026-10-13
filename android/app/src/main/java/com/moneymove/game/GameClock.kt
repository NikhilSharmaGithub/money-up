package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The game clock of a timed table (1.0.6): what is left of the whole game,
 * counted down on this device from the server's `endsAt`, beside the turn
 * clock over the board's centre well.
 *
 * It is a different clock from [TurnClock] and is drawn as one — an hourglass
 * where the turn clock has its dial, minutes and seconds where the turn clock
 * has seconds — because a player glancing at the well has to tell at once
 * which of the two is about to run out.
 *
 * The server is the clock. The game ends when it says so, whatever this
 * reads; at nought, or the moment the server says the time is up, the chip
 * says "Last turn", which is what the table is then playing.
 */
@Composable
fun GameClock(endsAt: Double?, timeUp: Boolean, modifier: Modifier = Modifier) {
    if (endsAt == null) return
    // A fresh deadline (a rematch arms a new one) restarts the ticker rather
    // than leaving it counting toward the last game's.
    key(endsAt) {
        val left = rememberSecondsLeft(endsAt)
        GameClockFace(left, timeUp, modifier)
    }
}

@Composable
private fun GameClockFace(left: Int, timeUp: Boolean, modifier: Modifier) {
    val p = P.current
    val urgent = gameClockUrgent(left, timeUp)
    val ink = if (urgent) p.bad else p.ink2
    val label = gameClockLabel(left, timeUp)
    Row(
        modifier
            .background(if (urgent) p.redSoft else p.sunken, MMShapes.pill)
            .border(1.dp, if (urgent) p.bad.copy(alpha = 0.55f) else p.rule, MMShapes.pill)
            .padding(horizontal = 10.dp, vertical = 5.dp)
            .clearAndSetSemantics {
                contentDescription = if (label == LAST_TURN) "Game clock: last turn"
                else "Game clock: ${left / 60} minutes ${left % 60} seconds left"
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon("hourglass", size = 13.dp, tint = ink)
        Text(
            label,
            color = ink,
            // Tabular figures, so the chip holds its width while it counts.
            style = TextStyle(fontFeatureSettings = "tnum"),
            fontSize = 13.sp,
            fontWeight = FontWeight.ExtraBold,
            maxLines = 1,
            softWrap = false,
        )
    }
}

/**
 * How many are watching from the rail, as an eye and a number, beside the
 * clocks — so a table knows it has an audience without anybody announcing
 * it. Nothing at all while nobody is.
 */
@Composable
fun WatchersChip(count: Int, modifier: Modifier = Modifier) {
    if (count <= 0) return
    val p = P.current
    Row(
        modifier
            .background(p.sunken, MMShapes.pill)
            .border(1.dp, p.rule, MMShapes.pill)
            .padding(horizontal = 9.dp, vertical = 5.dp)
            .clearAndSetSemantics { contentDescription = "$count watching" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon("eye", size = 13.dp, tint = p.ink2)
        Text(
            "$count",
            color = p.ink2,
            style = TextStyle(fontFeatureSettings = "tnum"),
            fontSize = 13.sp,
            fontWeight = FontWeight.ExtraBold,
            maxLines = 1,
            softWrap = false,
        )
    }
}

/** What the chip says once the clock has run out. */
const val LAST_TURN = "Last turn"

/** The last two minutes of a timed game, when the chip turns red. */
const val GAME_CLOCK_URGENT_SECONDS = 120

/**
 * "mm:ss" of what is left, or "Last turn" once the clock is out — at nought
 * on this device, or as soon as the server says the time is up, whichever
 * comes first.
 */
fun gameClockLabel(secondsLeft: Int, timeUp: Boolean): String {
    if (timeUp || secondsLeft <= 0) return LAST_TURN
    return "%02d:%02d".format(java.util.Locale.ROOT, secondsLeft / 60, secondsLeft % 60)
}

/** Red for the last two minutes and for the last turn itself. */
fun gameClockUrgent(secondsLeft: Int, timeUp: Boolean): Boolean =
    timeUp || secondsLeft <= GAME_CLOCK_URGENT_SECONDS

/**
 * "Time's up", on a game the clock decided — on the board's well and at the
 * head of the result. `explained` adds what it means, for the result sheet,
 * where somebody who was not watching the clock reads why the game ended
 * with everybody still solvent.
 */
@Composable
fun TimesUpTag(modifier: Modifier = Modifier, explained: Boolean = false) {
    val p = P.current
    Row(
        modifier
            .background(p.goldSoft, MMShapes.pill)
            .border(1.dp, p.gold.copy(alpha = 0.55f), MMShapes.pill)
            .padding(horizontal = 11.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon("hourglass", size = 13.dp, tint = p.gold)
        Text(
            if (explained) "Time's up — the richest player wins" else "Time's up",
            color = p.gold, fontSize = 12.5.sp, fontWeight = FontWeight.ExtraBold,
            maxLines = 1, softWrap = false,
        )
    }
}
