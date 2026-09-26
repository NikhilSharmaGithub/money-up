package com.moneymove.game

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * "Come and play" — from a friend, wherever this player is.
 *
 * Walking into a friend's lobby only ever worked one way round. This is the
 * other direction: a friend asks this player to their table and it turns up
 * on screen whether they are on the home screen or in the middle of a game.
 * It is a strip at the top rather than a sheet, because taking the board away
 * from somebody mid-turn to ask them a question is rude.
 *
 * iOS's InviteBanner, hung from the root the same way so it sits over the
 * board as readily as over the tabs. The poll that feeds it is
 * [MessagingStore.watchInvites], started once with the app; this only draws
 * what that found, and answers it.
 */
@Composable
fun InviteBanner(messaging: MessagingStore, store: GameStore, modifier: Modifier = Modifier) {
    val current = messaging.invite
    // The strip slides out after the invite is gone, so it has to remember
    // what it was showing or it would empty itself on the way out.
    var held by remember { mutableStateOf<Invite?>(null) }
    LaunchedEffect(current) { if (current != null) held = current }
    val shown = current ?: held

    // A table will have started by the time somebody looks up from whatever
    // else they were doing, so an unanswered invite shows itself out. Keyed on
    // the invite: clearing is keyed too, so a timer that fires late cannot
    // take a newer invite down with it.
    LaunchedEffect(current?.key) {
        val inv = current ?: return@LaunchedEffect
        delay(INVITE_SHOWN_MS)
        messaging.clearInvite(inv)
    }

    AnimatedVisibility(
        visible = current != null,
        enter = slideInVertically { -it } + fadeIn(),
        exit = slideOutVertically { -it } + fadeOut(),
        modifier = modifier
            .padding(top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()),
    ) {
        shown?.let { inv ->
            InviteStrip(
                inv,
                onJoin = {
                    Haptics.turn()
                    messaging.clearInvite(inv)
                    store.connect(inv.roomId)
                },
                onDismiss = { messaging.clearInvite(inv) },
            )
        }
    }
}

@Composable
private fun InviteStrip(inv: Invite, onJoin: () -> Unit, onDismiss: () -> Unit) {
    val p = P.current
    val shape = RoundedCornerShape(16.dp)
    Row(
        Modifier
            .padding(horizontal = 14.dp)
            .padding(top = 6.dp)
            .widthIn(max = 560.dp)
            .fillMaxWidth()
            .shadow(14.dp, shape, ambientColor = STRIP_SHADOW, spotColor = STRIP_SHADOW)
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.gold, shape)
            .padding(11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(p.goldSoft)
                .border(1.dp, p.gold, RoundedCornerShape(11.dp)),
            contentAlignment = Alignment.Center,
        ) {
            SfMark("person.2.fill", 17.dp, P.current.ink)
        }
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            // The name exactly as the server sent it, as iOS prints it.
            Text(
                inv.name,
                color = p.ink, fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                "wants you at their table",
                color = p.ink2, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
            )
        }
        // iOS's HStack spacing of eleven either side of a Spacer that never
        // shrinks below four: twenty-six before Join, eleven after it.
        Spacer(Modifier.width(26.dp))
        LandingButton("Join", LandingKind.PRIMARY) { onJoin() }
        Spacer(Modifier.width(11.dp))
        // Waving it away is a quiet answer: no sound, and nothing is sent to
        // the friend — the server just stops holding it. The drawn cross fills
        // under half its box, so a twenty-point box inks the nine points of
        // iOS's twelve-point xmark.
        Box(
            Modifier
                .size(28.dp)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) { onDismiss() },
            contentAlignment = Alignment.Center,
        ) {
            Icon("close", size = 20.dp, tint = p.ink3)
        }
    }
}

/** How long an unanswered invite stays up — iOS's forty-five seconds. */
private const val INVITE_SHOWN_MS = 45_000L

private val STRIP_SHADOW = Color.Black.copy(alpha = 0.35f)
