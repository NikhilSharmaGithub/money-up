package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * Quick chat (1.0.6): the eight things people say at a board most, one tap
 * each, sent as an ordinary chat line — so the server, the other clients
 * and the chat history see nothing new, and a player who has not reached
 * for the keyboard all game can still say "GG".
 *
 * The phrases are the same, in the same order, on the web, iOS and here, so
 * a table of mixed phones reads one vocabulary.
 */
object QuickChat {
    val PHRASES = listOf(
        "Good luck!", "Nice move!", "Want to trade?", "Ouch!",
        "So close!", "Hurry up!", "Thanks!", "GG",
    )

    /**
     * The breath between two phrases. The server keeps no chat limit of its
     * own, and a row of one-tap lines under a resting thumb is the easiest
     * way there is to flood a table, so the row itself waits.
     */
    const val COOLDOWN_MS = 1_500L

    /** Whether a phrase may go now, given when the row said it would be ready. */
    fun ready(readyAt: Long, now: Long): Boolean = now >= readyAt
}

/**
 * The phrases as a row of chips, scrolling sideways under the reactions. A
 * fixed set of friendly words is nothing anybody can be abusive with, so —
 * like the reactions — the row is live before the community rules have been
 * agreed to; it is free text that waits on them.
 *
 * While the row is cooling down it dims rather than vanishing, so the thumb
 * that just tapped it can see it will be back.
 */
@Composable
fun QuickChatRow(store: GameStore, onSend: (String) -> Unit, modifier: Modifier = Modifier) {
    val p = P.current
    val readyAt = store.quickChatReadyAt
    var cooling by remember { mutableStateOf(false) }
    LaunchedEffect(readyAt) {
        val wait = readyAt - System.currentTimeMillis()
        cooling = wait > 0
        if (wait > 0) {
            delay(wait)
            cooling = false
        }
    }
    Row(
        modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp)
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp)
            .alpha(if (cooling) 0.5f else 1f),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (phrase in QuickChat.PHRASES) {
            Box(
                Modifier
                    .clip(MMShapes.pill)
                    .background(p.sunken)
                    .border(1.dp, p.rule, MMShapes.pill)
                    .clickable(enabled = !cooling, role = Role.Button, onClickLabel = "Say \"$phrase\"") {
                        onSend(phrase)
                    }
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    phrase,
                    color = p.ink, fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, softWrap = false,
                )
            }
        }
    }
}
