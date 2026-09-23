package com.moneymove.game

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Coins landing in the wallet.
 *
 * There is no permanent coin counter in this app: the Store tab keeps one, a
 * table keeps none, and coins are paid in both places — a win settles at the
 * board, the daily and the rewarded view are collected from cards on the home
 * screen. Without this, a payout is a number that was one thing and is quietly
 * another the next time somebody opens the shop.
 *
 * The rule this file exists for, and the only rule in it: coins fly when the
 * server's EARNED watermark rises, never when the balance merely changes.
 * `earned` only ever goes up, so two polls that read the same wallet are
 * silent, spending — which moves the balance the other way — is silent, and
 * the first wallet the app ever reads only sets the mark, because opening the
 * app is not a payout. Flying coins at a balance that changed would mean
 * buying a piece pays you for it.
 */

/**
 * The watermark, and the credit waiting to be shown.
 *
 * Hand every wallet the app reads to [note], wherever it came from — a poll, a
 * daily claim, an ad reward, the wallet refresh after a win. It decides on its
 * own whether that was a payment.
 */
class CoinFlight {

    /** One payment: what arrived, and what the wallet came to afterwards. */
    data class Credit(val amount: Int, val total: Int, val at: Long = System.currentTimeMillis())

    var credit: Credit? by mutableStateOf(null)
        private set

    /** The earned figure already accounted for. Null until the first wallet. */
    private var mark: Int? = null

    /**
     * The wallet as the server just reported it.
     *
     * A server too old to send `earned` reads as a flat zero here, which marks
     * once and never moves again — the counter stays correct and simply misses
     * the flourish, which is the safe way round for a wrong guess to fail.
     */
    fun note(wallet: Wallet?) {
        val fresh = wallet ?: return
        val seen = mark
        mark = fresh.earned
        if (seen == null) return
        val gained = fresh.earned - seen
        if (gained <= 0) return
        credit = Credit(gained, fresh.coins)
    }

    /** The layer, once it has finished showing one. */
    internal fun done(shown: Credit) {
        if (credit == shown) credit = null
    }

    /**
     * Signing out, or deleting the account: the next wallet belongs to
     * somebody else and is a first sighting, not a windfall.
     */
    fun forget() {
        mark = null
        credit = null
    }
}

/**
 * The coins, and the counter they land in.
 *
 * Lives above everything — coins arrive during sheets (the daily card, the ad
 * offer, the game-over sheet) as often as they arrive outside them — and takes
 * no touches, because nothing here is a control.
 */
@Composable
fun CoinFlightLayer(flight: CoinFlight, modifier: Modifier = Modifier) {
    val credit = flight.credit
    val still = reducedMotion()

    var counted by remember { mutableIntStateOf(0) }
    var showing by remember { mutableStateOf(false) }
    val arrival = remember { Animatable(0f) }
    val entrance by animateFloatAsState(if (showing) 1f else 0f, tween(280), label = "coinPill")
    val discs = credit?.let { discsFor(it.amount) } ?: MAX_DISCS
    val span = FLIGHT + (discs - 1) * STEP

    LaunchedEffect(credit) {
        val fresh = credit ?: return@LaunchedEffect
        // A second credit landing mid-flight re-aims from whatever the pill is
        // currently saying, so the number climbs past the figure in between
        // instead of snapping backwards to it.
        val from = if (showing) counted else (fresh.total - fresh.amount).coerceAtLeast(0)
        counted = from
        showing = true
        if (still) {
            // No flight and no climb: the pill states what the wallet came to
            // and leaves. Less motion is the whole point of the setting.
            counted = fresh.total
            delay(1_800)
        } else {
            arrival.snapTo(0f)
            arrival.animateTo(1f, tween(durationMillis = span, easing = LinearEasing))
            countUp(from, fresh.total) { counted = it }
            delay(1_100)
        }
        showing = false
        delay(320)
        flight.done(fresh)
    }

    BoxWithConstraints(modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars)) {
        if (credit == null && entrance <= 0f) return@BoxWithConstraints
        val density = LocalDensity.current
        val wide = with(density) { maxWidth.toPx() }
        val tall = with(density) { maxHeight.toPx() }
        // Roughly the middle of the pill, which is as exact as this needs to
        // be: the discs shrink to nothing as they reach it.
        val target = Offset(wide - with(density) { 58.dp.toPx() }, with(density) { 26.dp.toPx() })
        val source = Offset(wide / 2f, tall * 0.55f)

        if (credit != null && !still) {
            for (i in 0 until discs) {
                Disc(i, arrival.value, span, source, target, density.density)
            }
        }
        CoinPill(
            counted = counted,
            gained = credit?.amount ?: 0,
            entrance = entrance,
            modifier = Modifier.align(Alignment.TopEnd).padding(top = 2.dp, end = 14.dp),
        )
    }
}

/**
 * One disc in flight.
 *
 * A handful of them, not one per coin: a 2,750-coin pack is the same flight as
 * a 2-coin win, because this is a payment landing, not a bar chart. The
 * scatter is fixed rather than random so a repaint mid-flight cannot move a
 * disc that is already on its way.
 */
@Composable
private fun Disc(index: Int, clock: Float, span: Int, from: Offset, to: Offset, density: Float) {
    val local = ((clock * span - index * STEP) / FLIGHT).coerceIn(0f, 1f)
    val eased = 1f - (1f - local).pow(3)
    val x0 = from.x + SPREAD[index] * density
    val y0 = from.y + LIFT[index] * density
    Box(
        Modifier.graphicsLayer {
            translationX = x0 + (to.x - x0) * eased - size.width / 2f
            translationY = y0 + (to.y - y0) * eased - size.height / 2f
            val shrink = 1f - 0.55f * local
            scaleX = shrink
            scaleY = shrink
            // Out of sight just as it reaches the pill, so no disc is ever
            // seen sitting on top of the number it just added to.
            alpha = ((1f - local) / 0.15f).coerceIn(0f, 1f)
        },
    ) {
        Icon("coin", size = 22.dp)
    }
}

/** The counter itself: a pill in the top corner, climbing to the new total. */
@Composable
private fun CoinPill(counted: Int, gained: Int, entrance: Float, modifier: Modifier = Modifier) {
    val p = P.current
    Row(
        modifier
            .graphicsLayer {
                alpha = entrance
                translationY = (entrance - 1f) * 10f * density
            }
            .clip(RoundedCornerShape(99.dp))
            .background(p.card)
            .border(1.dp, p.gold.copy(alpha = 0.65f), RoundedCornerShape(99.dp))
            .padding(horizontal = 13.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("coin", size = 17.dp)
        Spacer(Modifier.width(6.dp))
        Text("$counted", color = p.gold, fontSize = 16.sp, fontWeight = FontWeight.Black)
        if (gained > 0) {
            Spacer(Modifier.width(6.dp))
            Text("+$gained", color = p.good, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
    }
}

/**
 * The number climbing to what it became, rather than snapping to it.
 *
 * Capped at a couple of dozen steps, so a 2,750-coin pack and a 2-coin win
 * take the same half second.
 */
private suspend fun countUp(from: Int, to: Int, onStep: (Int) -> Unit) {
    if (to <= from) return onStep(to)
    val steps = minOf(18, to - from)
    for (i in 1..steps) {
        val t = i.toFloat() / steps
        val eased = 1f - (1f - t).pow(3)
        onStep(from + ((to - from) * eased).roundToInt())
        delay(26)
    }
    onStep(to)
}

/**
 * Whether this phone has been asked to hold still.
 *
 * Android says so by zeroing the animator duration scale — the same switch
 * that turns off the system's own transitions — and a player who has turned
 * that on has not asked for coins thrown across their screen.
 */
@Composable
private fun reducedMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) {
        runCatching {
            Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        }.getOrDefault(false)
    }
}

/** How many discs a credit of this size throws — three at least, six at most. */
private fun discsFor(gained: Int): Int =
    ((log10(gained + 1.0) * 3).roundToInt() + 2).coerceIn(3, 6)

private const val MAX_DISCS = 6
private const val FLIGHT = 560
private const val STEP = 55

/** Fixed scatter, in dp, around the point the coins are thrown from. */
private val SPREAD = floatArrayOf(-74f, -30f, 6f, 42f, 78f, -52f)
private val LIFT = floatArrayOf(8f, -16f, 14f, -10f, 2f, -22f)
