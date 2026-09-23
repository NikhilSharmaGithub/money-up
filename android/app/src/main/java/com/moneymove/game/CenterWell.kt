package com.moneymove.game

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The middle of the board: the dice, and one line saying what the table is
 * waiting for.
 *
 * A board with an empty middle reads as a board that has not loaded. The dice
 * live here because that is where everyone at a real table looks when they
 * are thrown, and because the number has to land in the eye before the piece
 * starts walking — `Choreography.DICE_LEAD` is the pause that buys it.
 */
@Composable
fun CenterWell(store: GameStore, modifier: Modifier = Modifier) {
    val p = P.current
    val state = store.state ?: return
    val turn = state.turn
    val dice = turn?.dice

    Column(
        modifier.padding(horizontal = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        if (state.isLobby) {
            Icon("dice", size = 34.dp, tint = p.ink3)
            Spacer(Modifier.height(8.dp))
            Text(
                state.map.name,
                color = p.ink2, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            return@Column
        }

        if (dice != null && dice.size >= 2) {
            DicePair(dice[0], dice[1], rollId = turn.rolledThisTurn == true)
            Spacer(Modifier.height(10.dp))
            Text(
                "${dice[0] + dice[1]}${if (dice[0] == dice[1]) " · double" else ""}",
                color = if (dice[0] == dice[1]) p.red else p.ink2,
                fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp,
            )
        } else {
            Icon("dice", size = 30.dp, tint = p.ink3, alpha = 0.55f)
        }

        Spacer(Modifier.height(10.dp))
        val who = store.currentPlayer
        Text(
            when {
                state.isEnded -> state.winner?.let { "${it.name} wins" } ?: "Game over"
                store.isMyTurn -> "Your turn"
                who != null -> "${who.name}'s turn"
                else -> ""
            },
            color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Black,
            textAlign = TextAlign.Center,
        )
        // The shot clock, as a number rather than a bar: a bar on a board this
        // size is a smear, and the last twenty seconds are the only ones
        // anybody reads.
        turn?.endsAt?.let { endsAt ->
            val left = ((endsAt - System.currentTimeMillis()) / 1000).toInt()
            if (left in 1..20) {
                Spacer(Modifier.height(4.dp))
                Text(
                    "${left}s",
                    color = p.bad, fontSize = 12.sp, fontWeight = FontWeight.Black,
                )
            }
        }
    }
}

/**
 * Two dice, thrown.
 *
 * They tumble rather than appear: a number that simply replaces the last one
 * is a label, and this is supposed to be a throw. The tumble is short — the
 * walk is already waiting on it.
 */
@Composable
private fun DicePair(a: Int, b: Int, rollId: Boolean, size: Dp = 34.dp) {
    val spin = remember { Animatable(0f) }
    LaunchedEffect(a, b, rollId) {
        spin.snapTo(0f)
        spin.animateTo(1f, tween(durationMillis = 420))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Die(a, size, (1f - spin.value) * -26f)
        Die(b, size, (1f - spin.value) * 22f)
    }
}

@Composable
private fun Die(value: Int, size: Dp, tilt: Float) {
    val p = P.current
    Box(
        Modifier
            .size(size)
            .rotate(tilt)
            .clip(RoundedCornerShape(size * 0.24f))
            .background(Color.White),
    ) {
        Canvas(Modifier.size(size)) {
            val s = this.size.minDimension
            val r = s * 0.088f
            // The pip grid a die actually has: thirds of the face.
            val lo = s * 0.29f
            val mid = s * 0.5f
            val hi = s * 0.71f
            val pips: List<Pair<Float, Float>> = when (value) {
                1 -> listOf(mid to mid)
                2 -> listOf(lo to lo, hi to hi)
                3 -> listOf(lo to lo, mid to mid, hi to hi)
                4 -> listOf(lo to lo, hi to lo, lo to hi, hi to hi)
                5 -> listOf(lo to lo, hi to lo, mid to mid, lo to hi, hi to hi)
                6 -> listOf(lo to lo, hi to lo, lo to mid, hi to mid, lo to hi, hi to hi)
                else -> emptyList()
            }
            for ((x, y) in pips) {
                drawCircle(Color(0xFF1B2A20), radius = r, center = Offset(x, y))
            }
        }
    }
}
