package com.moneymove.game

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * How it ended.
 *
 * Three things, in the order people want them: who won, where everybody came,
 * and then the part that makes a game worth having played — the badges and
 * the numbers behind them. A result screen that only says "you lost" is a
 * result screen nobody reads twice.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GameOverSheet(store: GameStore, onDismiss: () -> Unit) {
    val p = P.current
    val state = store.state ?: return onDismiss()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val standings = PlayerResult.snapshot(state)
    val meWon = state.winner?.id == store.meId

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.sheet,
        dragHandle = null,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp)
                .padding(bottom = 28.dp),
        ) {
            Spacer(Modifier.height(18.dp))
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(if (meWon) "trophy" else "medalSilver", size = 46.dp)
                Spacer(Modifier.height(10.dp))
                Text(
                    when {
                        meWon -> "You win"
                        state.winner != null -> "${state.winner.name} wins"
                        else -> "That's the game"
                    },
                    color = p.ink, fontSize = 26.sp, fontWeight = FontWeight.Black,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(4.dp))
                Hint("${state.map.name} · ${standings.size} players")
            }

            Spacer(Modifier.height(20.dp))
            SectionLabel("Standings", icon = "chart")
            Spacer(Modifier.height(8.dp))
            for ((i, row) in standings.withIndex()) {
                StandingRow(i, row, isMe = row.id == store.meId)
            }

            // The chart is the story of the game in one line each: who was in
            // front, and when that stopped being true.
            state.history?.takeIf { it.size > 2 }?.let { series ->
                Spacer(Modifier.height(20.dp))
                SectionLabel("Net worth, turn by turn")
                Spacer(Modifier.height(10.dp))
                WorthChart(series, standings)
            }

            val titled = standings.filter { it.title != null }
            if (titled.isNotEmpty()) {
                Spacer(Modifier.height(20.dp))
                SectionLabel("Badges", icon = "medalGold")
                Spacer(Modifier.height(8.dp))
                for (row in titled) {
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 6.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Icon("medalGold", size = 18.dp)
                        Spacer(Modifier.width(9.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                "${row.name} — ${row.title}",
                                color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                            )
                            row.titleReason?.let { Hint(it) }
                        }
                    }
                }
            }

            standings.firstOrNull { it.id == store.meId }?.stats?.let { s ->
                Spacer(Modifier.height(20.dp))
                SectionLabel("Your game")
                Spacer(Modifier.height(8.dp))
                StatGrid(s)
            }

            Spacer(Modifier.height(22.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MMButton(
                    "Rematch", kind = BtnKind.PRIMARY, big = true,
                    modifier = Modifier.weight(1f),
                ) { store.rematch(); onDismiss() }
                MMButton(
                    "Leave", kind = BtnKind.GHOST, big = true,
                    modifier = Modifier.weight(1f),
                ) { onDismiss(); store.leave() }
            }
        }
    }
}

@Composable
private fun StandingRow(place: Int, row: PlayerResult, isMe: Boolean) {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (isMe) p.sunken else Color.Transparent)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when (place) {
            0 -> Icon("medalGold", size = 20.dp)
            1 -> Icon("medalSilver", size = 20.dp)
            2 -> Icon("medalBronze", size = 20.dp)
            else -> Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
                Text("${place + 1}", color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
        Spacer(Modifier.width(10.dp))
        Box(
            Modifier.size(26.dp).clip(RoundedCornerShape(99.dp)).background(cssColor(row.color, p.red)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                (row.name.firstOrNull() ?: '?').uppercase(),
                color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Black,
            )
        }
        Spacer(Modifier.width(9.dp))
        Column(Modifier.weight(1f)) {
            Text(
                row.name + if (isMe) " (you)" else "",
                color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
            )
            // A removed seat was never actually bankrupted — don't say it was.
            row.outcomeLabel?.let { Hint(it) }
        }
        Text(
            money(row.worth),
            color = if (row.bankrupt) p.ink3 else p.ink,
            fontSize = 14.sp, fontWeight = FontWeight.Black,
        )
    }
}

@Composable
private fun StatGrid(s: PlayerStats) {
    val rows = listOfNotNull(
        s.streetsBought?.takeIf { it > 0 }?.let { "Streets bought" to "$it" },
        s.housesBuilt?.takeIf { it > 0 }?.let { "Buildings put up" to "$it" },
        s.rentCollected?.takeIf { it > 0 }?.let { "Rent collected" to money(it) },
        s.rentPaid?.takeIf { it > 0 }?.let { "Rent paid" to money(it) },
        s.biggestRent?.takeIf { it > 0 }?.let {
            "Biggest single rent" to (money(it) + (s.biggestRentTile?.let { t -> " · $t" } ?: ""))
        },
        s.doubles?.takeIf { it > 0 }?.let { "Doubles rolled" to "$it" },
        s.jailed?.takeIf { it > 0 }?.let { "Times in prison" to "$it" },
        s.auctionsWon?.takeIf { it > 0 }?.let { "Auctions won" to "$it" },
        s.tradesCompleted?.takeIf { it > 0 }?.let { "Trades done" to "$it" },
        s.laps?.takeIf { it > 0 }?.let { "Laps of the board" to "$it" },
    )
    val p = P.current
    if (rows.isEmpty()) {
        Hint("Nothing much happened, which is its own kind of game.")
        return
    }
    Column {
        for ((label, value) in rows) {
            Row(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                Text(label, color = p.ink2, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.weight(1f))
                Text(value, color = p.ink, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/**
 * The game as a line each.
 *
 * No axes and no numbers: this is not a chart anybody reads a value off, it
 * is the shape of who was winning and when that changed, which is the one
 * thing the table argues about afterwards.
 */
@Composable
private fun WorthChart(series: List<WorthPoint>, standings: List<PlayerResult>) {
    val p = P.current
    val ids = standings.map { it.id }
    val peak = series.flatMap { it.w.values }.maxOrNull()?.coerceAtLeast(1) ?: 1

    Box(
        Modifier
            .fillMaxWidth()
            .height(140.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(p.card)
            .border(1.dp, p.rule, RoundedCornerShape(14.dp))
            .padding(10.dp),
    ) {
        Canvas(Modifier.fillMaxWidth().height(120.dp)) {
            val w = size.width
            val h = size.height
            for (id in ids) {
                val colour = cssColor(standings.first { it.id == id }.color, p.red)
                val path = Path()
                var started = false
                for ((i, point) in series.withIndex()) {
                    val v = point.w[id] ?: continue
                    val x = if (series.size <= 1) 0f else w * i / (series.size - 1)
                    val y = h - (h * v / peak).coerceIn(0f, h)
                    if (!started) { path.moveTo(x, y); started = true } else path.lineTo(x, y)
                }
                if (started) drawPath(path, colour, style = Stroke(width = 2.4f))
            }
        }
    }
}
