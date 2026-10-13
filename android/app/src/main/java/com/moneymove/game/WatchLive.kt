package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Watch live (1.0.6): the public games being played right now, and a tap to
 * stand at the rail of one — the board as the players see it, moving as they
 * move, with nothing to press.
 *
 * Unlike the public rooms card it stays on the tab when the list is empty and
 * says so, because "nobody is playing" is an answer somebody who came here to
 * watch is owed, and the card is where they will look for it again.
 *
 * The list itself is the store's, polled from the Play tab; this only draws
 * it. Four rows, and the rest behind "Show all", so a busy evening does not
 * push the leaderboard off the bottom of the phone.
 */
@Composable
fun WatchLiveCard(store: GameStore) {
    val p = P.current
    val games = store.liveGames
    var all by remember { mutableStateOf(false) }
    LandingCard(padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LiveDot()
            Spacer(Modifier.width(7.dp))
            Text(
                "WATCH LIVE",
                color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
            )
        }
        Spacer(Modifier.height(10.dp))
        when {
            games == null -> Row(
                Modifier.fillMaxWidth().padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LandingSpinner(p.ink3, 16.dp)
                Spacer(Modifier.width(8.dp))
                Text("Looking for games…", color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
            }

            games.isEmpty() -> Column(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Icon("eye", size = 24.dp, tint = p.ink3, alpha = 0.7f)
                Text(
                    "No public games right now",
                    color = p.ink2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center,
                )
                Text(
                    "A table opened to the public shows up here once its dice are rolling.",
                    color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center,
                )
            }

            else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val shown = if (all) games else games.take(SHOWN)
                for (game in shown) {
                    LiveRow(game) {
                        Haptics.tap()
                        store.watch(game.roomId)
                    }
                }
                if (games.size > SHOWN) {
                    Text(
                        if (all) "Show fewer" else "Show all ${games.size}",
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable(role = Role.Button) { all = !all }
                            .padding(vertical = 8.dp),
                        color = p.red, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

/** How many games the card lists before "Show all". */
private const val SHOWN = 4

/**
 * One game: the faces at it, the board, who is still in, and how far along
 * it is — the turn, the clock on a timed table, and how many are already
 * watching. The eye at the end says what a tap does, which is not "join".
 */
@Composable
private fun LiveRow(game: LiveGame, onWatch: () -> Unit) {
    val p = P.current
    val minutes = game.minutesLeft()
    val details = buildList {
        add("Turn ${game.turnCount}")
        minutes?.let { add(if (it <= 0) "last turn" else "$it min left") }
        if (game.watching > 0) add("${game.watching} watching")
    }.joinToString(" · ")
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(p.sunken)
            .clickable(role = Role.Button, onClickLabel = "Watch") { onWatch() }
            .semantics { contentDescription = "Watch ${game.mapName}: ${game.namesLine()}. $details" }
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Faces(game.standing.ifEmpty { game.players })
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(
                game.mapName.ifBlank { "MoneyMove" },
                color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                game.namesLine(),
                color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                details,
                color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.width(10.dp))
        Icon("eye", size = 18.dp, tint = p.ink2)
        Spacer(Modifier.width(6.dp))
        RowChevron(p.ink3, 12.dp)
    }
}

/**
 * Up to three faces, overlapping, the way a table looks from the door —
 * each ringed in the row's own fill so the overlap reads as a stack rather
 * than one smudge. The faces are the players' own chosen emoji, which is
 * their content and drawn as itself; a seat with none wears its initial.
 */
@Composable
private fun Faces(players: List<LivePlayer>) {
    val p = P.current
    val shown = players.take(3)
    val disc = 30.dp
    val step = 18.dp
    Box(Modifier.size(width = disc + step * (maxOf(1, shown.size) - 1), height = disc)) {
        shown.forEachIndexed { i, who ->
            Box(
                Modifier
                    .offset(x = step * i)
                    .size(disc)
                    .clip(CircleShape)
                    .background(p.sunken)
                    .padding(2.dp),
            ) {
                AvatarDisc(who.name, who.color, size = disc - 4.dp, avatar = who.avatar)
            }
        }
    }
}

/** The small "on air" dot by the title — the good colour, as a live connection is everywhere else. */
@Composable
private fun LiveDot() {
    Box(
        Modifier
            .size(7.dp)
            .clip(CircleShape)
            .background(P.current.good),
    )
}
