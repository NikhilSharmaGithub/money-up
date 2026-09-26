package com.moneymove.game

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * A matchmade table that has not dealt itself in yet.
 *
 * There is nothing to press here — the server starts this table by itself
 * when the fuse runs out — so there are no host controls and no room code to
 * hand round. The panel says the only things that matter: whether the table
 * is still looking for people, how long it waits, who has landed so far, and
 * what the table rolled for itself. iOS's QuickMatchPanel, in its order and
 * in its words.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun QuickMatchPanel(store: GameStore, state: GameState, modifier: Modifier = Modifier) {
    val p = P.current
    val players = state.players
    val seats = maxOf(players.size, state.settings.maxPlayers)

    // One tick serves the whole panel. The deadline is the server's, so
    // somebody who walks in late sees what is really left rather than a
    // fresh fifteen.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(state.quickStartAt) {
        while (true) {
            now = System.currentTimeMillis()
            delay(250)
        }
    }
    val left = state.quickSecondsLeft(now)

    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // The table spends most of its fuse actually looking for people and
        // only the last few seconds filling the chairs nobody took. Saying
        // which is the difference between "nobody came" and a table that
        // quietly padded itself out while claiming to search. Five seconds is
        // the server's own bot window.
        Row(
            Modifier.padding(top = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            CircularProgressIndicator(Modifier.size(18.dp), color = p.red, strokeWidth = 2.dp)
            Text(
                if ((left ?: 99) > 5) "Finding players…" else "Filling the table…",
                color = p.ink, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold,
            )
        }

        if (left != null) Countdown(left)

        SeatRow(store, players, seats)

        Text(
            "${players.size} of $seats seated",
            color = p.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
        )

        RolledRules(state.quickRoll?.parts.orEmpty())

        TableTalkTicker(store)
    }
}

/**
 * The seconds to kick-off, big and gold — the one element that says the
 * table needs nobody to press anything.
 */
@Composable
private fun Countdown(left: Int) {
    val p = P.current
    val shape = RoundedCornerShape(16.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .background(p.card, shape)
            .border(1.dp, p.gold.copy(alpha = 0.5f), shape)
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        // Counting down, so each number drops in from above as the last one
        // falls away.
        AnimatedContent(
            targetState = left,
            transitionSpec = {
                val roll = tween<IntOffset>(200)
                (slideInVertically(roll) { h -> -h / 2 } + fadeIn(tween(200))) togetherWith
                    (slideOutVertically(roll) { h -> h / 2 } + fadeOut(tween(120))) using
                    SizeTransform(clip = false)
            },
            label = "kickoff",
        ) { n ->
            Text(
                if (n > 0) "$n" else "…",
                color = p.gold, fontSize = 42.sp, fontWeight = FontWeight.ExtraBold,
                style = LocalTextStyle.current.merge(TextStyle(fontFeatureSettings = "tnum")),
            )
        }
        Text(
            if (left > 0) "seconds to kick-off" else "dealing you in",
            color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
        )
    }
}

/**
 * Who has landed, and the chairs still open. Faces arrive with a small pop,
 * so a table filling up looks like people sitting down — but the ones already
 * here when the panel opened simply are here.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SeatRow(store: GameStore, players: List<PlayerState>, seats: Int) {
    val p = P.current
    val present = remember { players.mapTo(HashSet()) { it.id } }
    // Wraps rather than running off the side: a six- or eight-seat table is
    // wider than a phone at this size.
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (player in players) {
            key(player.id) {
                val pop = remember { Animatable(if (player.id in present) 1f else 0f) }
                LaunchedEffect(Unit) {
                    pop.animateTo(1f, spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMediumLow))
                }
                SeatCell(
                    Modifier.graphicsLayer {
                        scaleX = pop.value
                        scaleY = pop.value
                        alpha = pop.value.coerceIn(0f, 1f)
                    },
                    label = if (store.isLocal(player.id)) "You" else player.name,
                ) { PlayerDisc(player, size = 38.dp) }
            }
        }
        repeat(maxOf(0, seats - players.size)) {
            SeatCell(label = "open", faint = true) {
                Box(Modifier.size(38.dp).dashedBorder(p.rule2, width = 1.5.dp, cornerRadius = 19.dp, dash = 4.dp, gap = 3.dp))
            }
        }
    }
}

@Composable
private fun SeatCell(
    modifier: Modifier = Modifier,
    label: String,
    faint: Boolean = false,
    face: @Composable () -> Unit,
) {
    val p = P.current
    Column(
        modifier.width(54.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        face()
        Text(
            label,
            color = if (faint) p.ink3 else p.ink2,
            fontSize = 10.sp,
            fontWeight = if (faint) FontWeight.SemiBold else FontWeight.Bold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * What this table dealt itself: the board, the bankroll, and every house rule
 * that was rolled rather than assumed.
 *
 * Nobody at a matchmade table picked any of it, so it belongs on screen
 * before the dice start — not left to be worked out from the log once
 * somebody is already paying rent they did not expect. The phrases come
 * written from the server, the same words the web lobby and iOS show.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RolledRules(parts: List<String>) {
    if (parts.isEmpty()) return
    val p = P.current
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 2.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon("dice", size = 14.dp, tint = p.ink3)
            Text("THIS TABLE ROLLED", color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
        }
        // However many rules there are, on as many lines as they need.
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            parts.forEachIndexed { i, part ->
                // The board leads, and reads like it.
                val lead = i == 0
                val shape = RoundedCornerShape(99.dp)
                Text(
                    part,
                    modifier = Modifier
                        .background(p.card, shape)
                        .border(1.dp, if (lead) p.gold.copy(alpha = 0.5f) else p.rule, shape)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    color = if (lead) p.gold else p.ink2,
                    fontSize = 11.5.sp, fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

/**
 * The waiting room's small talk: gameplay tips and city facts, dealt in turn
 * every eight seconds while the clock runs. The file is fetched once for the
 * app's life and shared by every lobby (the store holds it); a miss keeps the
 * old static sentence for this sitting and is not remembered as the answer.
 */
@Composable
private fun TableTalkTicker(store: GameStore) {
    val p = P.current
    var tips by remember { mutableStateOf(emptyList<String>()) }
    var facts by remember { mutableStateOf(emptyList<String>()) }
    var beat by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) {
        store.loadTableTalk()?.let { talk ->
            tips = talk.tips.shuffled()
            facts = talk.factLines.shuffled()
        }
        // Nothing arrived — the fallback line needs no rotation.
        if (tips.isEmpty() && facts.isEmpty()) return@LaunchedEffect
        while (true) {
            delay(8_000)
            beat++
        }
    }

    // Even beats deal a tip, odd beats a fact; either pile alone still cycles.
    val line = when {
        tips.isEmpty() && facts.isEmpty() -> TableTalk.FALLBACK
        facts.isEmpty() || (beat % 2 == 0 && tips.isNotEmpty()) -> tips[(beat / 2) % tips.size]
        else -> facts[(beat / 2) % facts.size]
    }
    Crossfade(targetState = line, animationSpec = tween(450), label = "tableTalk") { shown ->
        Text(
            shown,
            modifier = Modifier.fillMaxWidth(),
            color = p.ink3, fontSize = 12.5.sp, lineHeight = 17.sp, fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
    }
}
