package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * A seat the table is holding.
 *
 * Somebody's connection dropped. Their chair is kept for a while, and anybody
 * still here can hand them more time — the first couple of extensions are a
 * favour one person can do alone, after which the server wants everybody's
 * click, which is why the card counts votes rather than just offering a
 * button.
 */
@Composable
fun AwaitingSeats(store: GameStore, modifier: Modifier = Modifier) {
    val p = P.current
    val state = store.state ?: return
    val seats = state.awaiting.orEmpty().filter { it.id != store.meId }
    if (seats.isEmpty()) return

    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(seats.size) {
        while (true) { now = System.currentTimeMillis(); delay(1000) }
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (seat in seats) {
            val who = state.player(seat.id) ?: continue
            val left = seat.until?.let { ((it - now) / 1000).toInt() } ?: 0
            val granted = store.meId in seat.grantedIds
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(p.card)
                    .border(1.dp, p.rule2, RoundedCornerShape(14.dp))
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon("snooze", size = 18.dp, tint = p.ink3)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        "${who.name} dropped out",
                        color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                    )
                    Hint(
                        if (left > 0) {
                            "Their seat is held for ${left}s" +
                                if (seat.isVote) " · everyone must agree to extend" else ""
                        } else "Their seat is going"
                    )
                }
                Spacer(Modifier.width(8.dp))
                if (granted) {
                    Chip(
                        if (seat.isVote) "${seat.grantedIds.size}/${seat.voterCount}" else "waiting",
                        tint = p.good,
                    )
                } else {
                    MMButton("Hold it", kind = BtnKind.GHOST) { store.grantTime(seat.id) }
                }
            }
        }
    }
}

/**
 * This device's seat was taken out by the clock.
 *
 * Full screen, because it is the one thing that has happened, and it offers
 * the two things left: go home, or stay and watch how it ends. Being knocked
 * out does not make somebody furniture — they are still at the table.
 */
@Composable
fun TimedOutOverlay(store: GameStore, onWatch: () -> Unit, modifier: Modifier = Modifier) {
    val p = P.current
    Box(
        modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.72f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .padding(horizontal = 32.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(p.sheet)
                .border(1.dp, p.rule2, RoundedCornerShape(20.dp))
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon("door", size = 38.dp, tint = p.ink2)
            Spacer(Modifier.height(12.dp))
            Text(
                "Your time ran out",
                color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.Black,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "You missed two turns in a row, so the table carried on without you. "
                    + "You can head back or stay and watch how it ends.",
                color = p.ink2, fontSize = 13.5.sp, lineHeight = 20.sp,
                fontWeight = FontWeight.Medium, textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MMButton("Back to home", kind = BtnKind.GHOST, modifier = Modifier.weight(1f)) {
                    store.leave()
                }
                MMButton("Stay and watch", kind = BtnKind.PRIMARY, modifier = Modifier.weight(1f)) {
                    onWatch()
                }
            }
        }
    }
}

/**
 * The deadlock rule, the one time it becomes possible.
 *
 * A rule to read rather than a result to glance at, so it waits to be
 * dismissed instead of timing out.
 */
@Composable
fun ReliefCardOverlay(store: GameStore, modifier: Modifier = Modifier) {
    val p = P.current
    val card = store.reliefPopup ?: return
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            Modifier
                .padding(horizontal = 34.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(p.goldSoft)
                .border(2.dp, p.gold, RoundedCornerShape(20.dp))
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon("scales", size = 38.dp, tint = p.gold)
            Spacer(Modifier.height(10.dp))
            Text(
                card.title,
                color = p.gold, fontSize = 11.sp, letterSpacing = 2.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(9.dp))
            Text(
                card.text,
                color = p.ink, fontSize = 14.5.sp, lineHeight = 21.sp,
                fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(16.dp))
            MMButton("Got it", kind = BtnKind.GOLD, modifier = Modifier.fillMaxWidth()) {
                store.reliefPopup = null
            }
        }
    }
}
