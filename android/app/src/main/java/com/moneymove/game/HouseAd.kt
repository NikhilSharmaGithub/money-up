package com.moneymove.game

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay
import kotlin.math.ceil

/**
 * The house ad — iOS's HouseAdView, raised over the whole window the way its
 * full-screen cover is.
 *
 * When the server says the provider is "house" there is no network selling
 * anything — the app shows its own screen for five seconds and the server
 * pays the coins anyway. When it says "admob" this is still here, as the
 * answer to every way Google can fail to fill the slot: no fill, no app id
 * yet, a load that hangs. An unfilled break is still five seconds somebody
 * was promised a reward for, so it is never allowed to be a blank screen.
 *
 * A window of its own, not a layer inside a tab: it covers the tab bar and the
 * status bar and takes every touch, so nothing underneath answers through it,
 * and switching away cannot leave the gate waiting behind a hidden screen.
 * The back gesture is iOS's X — leaving early is always allowed, and pays
 * nothing.
 *
 * [onFinished] is told true only when the countdown ran out and the claim
 * button was pressed; false means it was closed early.
 */
@Composable
fun HouseAdBreak(rewardCoins: Int, onFinished: (Boolean) -> Unit) {
    // Answers once: the back gesture and a tap can arrive together.
    var answered by remember { mutableStateOf(false) }
    val finish: (Boolean) -> Unit = { watched ->
        if (!answered) {
            answered = true
            onFinished(watched)
        }
    }
    // Taken off screen with no answer given — the screen underneath went
    // away — counts as walked out of, as iOS's AdBreak does on deinit, so the
    // flow waiting on it is never left parked for good.
    DisposableEffect(Unit) { onDispose { finish(false) } }
    Dialog(
        onDismissRequest = { finish(false) },
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
            dismissOnClickOutside = false,
        ),
    ) {
        HouseAdOverlay(rewardCoins, finish)
    }
}

/**
 * Honest about what the screen is, because a house ad pretending to be a real
 * one is just a worse real one. iOS's four lines, word for word.
 */
private val HOUSE_LINES = listOf(
    "Nobody has bought this slot yet, so the house took it.",
    "This break is brought to you by the table you are already at.",
    "Five seconds of nothing, and then some coins. Fair trade.",
    "An advert for the game you are currently playing. We know.",
)

/** Five seconds, and the claim button is dead for every one of them. */
private const val HOUSE_SECONDS = 5f

/**
 * The screen itself: the page's gradient and sheen, the ADVERT label and the
 * way out, the brand, one honest line, a ring that empties while the number
 * inside it falls, and then a claim button the player has to press — the
 * countdown running out pays nothing by itself, as on the iPhone.
 */
@Composable
fun HouseAdOverlay(rewardCoins: Int, onFinished: (Boolean) -> Unit) {
    val p = P.current
    val dark = p.page.luminance() < 0.5f
    val line = remember { HOUSE_LINES.random() }
    var left by remember { mutableFloatStateOf(HOUSE_SECONDS) }
    var lit by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }
    fun finish(watched: Boolean) {
        if (done) return
        done = true
        onFinished(watched)
    }

    // The countdown is the contract: nothing is claimable before it runs out.
    LaunchedEffect(Unit) {
        while (left > 0f && !done) {
            delay(50)
            left = (left - 0.05f).coerceAtLeast(0f)
        }
        if (done) return@LaunchedEffect
        SoundKit.click()
        lit = true
    }
    val light by animateFloatAsState(
        if (lit) 1f else 0f,
        spring(dampingRatio = 0.6f, stiffness = 320f),
        label = "claimLit",
    )

    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(p.page, p.page2)))
            // Every touch stops here: the screen underneath must not answer
            // through the break.
            .pointerInput(Unit) { detectTapGestures { } },
        contentAlignment = Alignment.TopCenter,
    ) {
        // Soft table sheen, the same one the splash lays down.
        val sheen = p.card.copy(alpha = if (dark) 0.14f else 0.7f)
        Canvas(Modifier.fillMaxSize()) {
            val r = 340.dp.toPx()
            val c = Offset(size.width * 0.5f, size.height * 0.34f)
            drawRect(
                Brush.radialGradient(
                    0f to sheen,
                    (10.dp.toPx() / r) to sheen,
                    1f to Color.Transparent,
                    center = c,
                    radius = r,
                ),
            )
        }
        Column(
            Modifier
                .widthIn(max = 460.dp)
                .fillMaxSize()
                .systemBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // The label an ad is required to wear, and the way out of it.
            // Leaving is always allowed — it just isn't paid, and the footer
            // says so.
            Row(
                Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "ADVERT",
                    color = p.ink3, fontSize = 9.5.sp, fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 1.4.sp,
                )
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(p.sunken)
                        .border(1.dp, p.rule, CircleShape)
                        .clickable(role = Role.Button) {
                            SoundKit.click()
                            finish(false)
                        }
                        .semantics { contentDescription = "Close without the reward" },
                    contentAlignment = Alignment.Center,
                ) {
                    XMark(p.ink3, 9.5.dp)
                }
            }
            Spacer(Modifier.weight(1f).heightIn(min = 8.dp))

            LogoMark(104.dp, Modifier.padding(bottom = 22.dp))
            Wordmark(34.sp)
            Text(
                line,
                color = p.ink2, fontSize = 14.5.sp, fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp).padding(horizontal = 34.dp),
            )

            Spacer(Modifier.weight(1f).heightIn(min = 12.dp))
            AnimatedVisibility(visible = !lit, enter = fadeIn(), exit = fadeOut()) {
                CountdownRing(left, Modifier.padding(bottom = 14.dp))
            }
            LandingButton(
                if (rewardCoins > 0) "Claim your $rewardCoins coin${if (rewardCoins == 1) "" else "s"}"
                else "Claim your reward",
                LandingKind.PRIMARY,
                modifier = Modifier
                    .padding(horizontal = 26.dp)
                    .graphicsLayer {
                        alpha = 0.45f + 0.55f * light
                        val s = 0.97f + 0.03f * light
                        scaleX = s
                        scaleY = s
                    },
                big = true,
                enabled = lit,
                lead = { Icon("coin", size = 19.dp) },
            ) {
                SoundKit.click()
                finish(true)
            }
            Text(
                "Close it early and the reward does not count.",
                color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(top = 11.dp, bottom = 26.dp),
            )
        }
    }
}

/** A ring that empties while the number inside it falls — both drawn, no spinner. */
@Composable
private fun CountdownRing(left: Float, modifier: Modifier = Modifier) {
    val p = P.current
    Box(modifier.size(46.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val w = 3.5.dp.toPx()
            val inset = w / 2
            val arc = Size(size.width - w, size.height - w)
            drawCircle(p.rule2, radius = (size.minDimension - w) / 2, style = Stroke(w))
            drawArc(
                p.gold,
                startAngle = -90f,
                sweepAngle = 360f * (1f - left / HOUSE_SECONDS),
                useCenter = false,
                topLeft = Offset(inset, inset),
                size = arc,
                style = Stroke(w, cap = StrokeCap.Round),
            )
        }
        Text(
            "${maxOf(1, ceil(left).toInt())}",
            color = p.ink2, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold,
            style = TextStyle(fontFeatureSettings = "tnum"),
        )
    }
}

/** SF's xmark at the close button's weight: two strokes corner to corner. */
@Composable
private fun XMark(tint: Color, span: Dp) {
    Canvas(Modifier.size(span)) {
        val w = 2.2.dp.toPx()
        drawLine(tint, Offset.Zero, Offset(size.width, size.height), w, StrokeCap.Round)
        drawLine(tint, Offset(size.width, 0f), Offset(0f, size.height), w, StrokeCap.Round)
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
