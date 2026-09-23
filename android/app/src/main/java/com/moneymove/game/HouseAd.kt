package com.moneymove.game

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
 * The house ad.
 *
 * When the server says the provider is "house" there is no network selling
 * anything — the app shows one of its own cards for a few seconds and the
 * server pays the coins anyway. It exists so the whole rewarded path is real
 * and tested long before a real network is wired in: the offer, the ticket,
 * the reward and the caps are the same code either way.
 *
 * It is deliberately honest about being an ad for this game. A fake
 * third-party ad would be the one dishonest screen in the app.
 */
private data class HousePitch(val icon: String, val line: String, val sub: String)

private val PITCHES = listOf(
    HousePitch("people", "Play with your friends", "Make a private table and send them the code."),
    HousePitch("map", "Nineteen boards", "Two are free every day — a different pair each time."),
    HousePitch("trophy", "Win and get paid", "Every game you win pays coins into your wallet."),
    HousePitch("palette", "Seven table styles", "Midnight felt, crimson, marine — light and dark each."),
)

@Composable
fun HouseAdOverlay(seconds: Int = 5, onFinished: (Boolean) -> Unit) {
    val p = P.current
    val pitch = remember { PITCHES.random() }
    var left by remember { mutableIntStateOf(seconds) }

    LaunchedEffect(Unit) {
        while (left > 0) { delay(1000); left-- }
        onFinished(true)
    }
    val progress by animateFloatAsState(
        targetValue = 1f - (left.toFloat() / seconds),
        animationSpec = tween(1000, easing = LinearEasing),
        label = "adProgress",
    )

    Box(
        Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.86f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .padding(horizontal = 28.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(p.sheet)
                .border(1.dp, p.rule2, RoundedCornerShape(20.dp))
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Chip("MoneyMove", tint = p.ink3)
                Spacer(Modifier.weight(1f))
                // Closing early is allowed and costs the coins, which is the
                // honest version of a skip button.
                Text(
                    if (left > 0) "Close · ${left}s" else "Close",
                    color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .padding(6.dp),
                )
            }
            Spacer(Modifier.height(18.dp))
            Box(
                Modifier.size(72.dp).clip(RoundedCornerShape(99.dp)).background(p.sunken),
                contentAlignment = Alignment.Center,
            ) {
                Icon(pitch.icon, size = 34.dp, tint = p.red)
            }
            Spacer(Modifier.height(16.dp))
            Text(
                pitch.line,
                color = p.ink, fontSize = 20.sp, fontWeight = FontWeight.Black,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                pitch.sub,
                color = p.ink2, fontSize = 14.sp, lineHeight = 20.sp,
                fontWeight = FontWeight.Medium, textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(20.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(5.dp)
                    .clip(RoundedCornerShape(99.dp))
                    .background(p.sunken),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(progress.coerceIn(0f, 1f))
                        .height(5.dp)
                        .clip(RoundedCornerShape(99.dp))
                        .background(p.red),
                )
            }
            Spacer(Modifier.height(10.dp))
            Hint(if (left > 0) "Your coins land when it finishes." else "Paying out…")
        }
    }
}

/**
 * The offer itself, as it appears in the shop and on the landing screen.
 *
 * It draws nothing at all when the server says there is nothing here — no
 * greyed button, no "come back tomorrow" — because an affordance that cannot
 * be used is worse than no affordance.
 */
@Composable
fun AdOfferRow(account: AccountStore, slot: String, onWatch: () -> Unit) {
    val p = P.current
    val placement = account.ads?.placement(slot) ?: return
    if (placement.remaining <= 0) return

    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(p.card)
            .border(1.dp, p.rule, RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("ticket", size = 20.dp, tint = p.red)
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Text(
                when (placement.kind) {
                    "multiplier" -> "Double your win"
                    else -> "Watch an ad for ${placement.coins} coin" +
                        if (placement.coins == 1) "" else "s"
                },
                color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.Bold,
            )
            Hint("${placement.remaining} left today")
        }
        MMButton(
            "Watch", kind = BtnKind.GOLD,
            enabled = account.adPlaying == null,
        ) { onWatch() }
    }
}
