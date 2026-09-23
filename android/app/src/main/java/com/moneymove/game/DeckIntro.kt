package com.moneymove.game

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * The board dealing itself out at kick-off.
 *
 * A deck of card backs sits in the middle of the table, riffles once, and
 * sinks away while every tile flies out of it to its place, one after the
 * other. Ported from the web client's `dealBoardIn` so a kick-off looks the
 * same in a browser and on a phone, down to the stagger.
 *
 * The one rule that shapes everything here: the deal only ever runs on a
 * lobby→playing edge this client actually watched happen. Walk in on a table
 * that has been played on for ten minutes and there is no flourish at all,
 * because a board dealing itself in front of somebody who just joined a game
 * in progress is the app telling them a lie about what they are looking at.
 * That is why [DeckIntro] keeps the last status it saw rather than reading
 * `status == "playing"` and guessing.
 *
 * It is split into a holder and an overlay on purpose. The tiles are painted
 * by BoardView's single Canvas, so the deal cannot be a composable wrapped
 * round them: the board asks [DeckIntro.pose] where each tile is this frame
 * and draws it there, and [DeckIntroOverlay] is only the deck itself.
 */

/** Where one tile is partway through the deal, relative to its seat. */
data class TilePose(
    val dx: Float,
    val dy: Float,
    val rotation: Float,
    val scale: Float,
    val alpha: Float,
) {
    /**
     * Nothing to apply: draw the tile exactly as every other frame draws it.
     *
     * Identity against [Settled] rather than a comparison of the five numbers,
     * because a tile in flight passes through poses that look like rest on any
     * one of them — the landing curve overshoots scale past 1 — and a tile that
     * drops out of the deal a frame early snaps into place.
     */
    val settled: Boolean get() = this === Settled

    companion object {
        val Settled = TilePose(0f, 0f, 0f, 1f, 1f)
    }
}

/**
 * The deal's state, driven by the board and read by the board.
 *
 * Hold one per table with [rememberDeckIntro] and hand it to both BoardView
 * and [DeckIntroOverlay].
 */
class DeckIntro {

    /** What the deck in the middle of the table is doing. */
    enum class Deck {
        /** No deck: an ordinary board, dealt long ago or never held back. */
        HIDDEN,

        /** A matchmade table still finding players — the board stays in the deck. */
        WAITING,

        /** Kick-off: one riffle, then the deck sinks as the tiles fly out. */
        DEALING,
    }

    var deck: Deck by mutableStateOf(Deck.HIDDEN)
        private set

    /**
     * The deal's own clock, 0 at the moment the deck starts riffling and 1
     * once the last tile has landed. Linear: the per-tile curve is applied in
     * [pose], because each tile is at a different point of the same flight.
     */
    private val clock = Animatable(1f)

    private var tiles = 0
    private var lastStatus: String? = null
    private var dealtRoom: String? = null

    /** True while tiles are still in the air. */
    val dealing: Boolean get() = clock.value < 1f

    /**
     * Whether the pieces should stay off the board for now. A token placed
     * against a tile that is mid-flight is measured against a moving target,
     * and lands in the felt.
     */
    val tokensHeld: Boolean get() = dealing || deck == Deck.WAITING

    /**
     * Every push, from the board. Decides whether this one is a kick-off.
     *
     * Suspends because it owns the deal's animation; call it from a
     * LaunchedEffect keyed on the room and its status, never from a draw.
     */
    suspend fun sync(state: GameState?) {
        if (state == null) return forget()
        tiles = state.map.tiles.size
        // A deal whose coroutine was cancelled halfway — the room changed
        // under it, or the host swapped the board — would otherwise leave the
        // next table's tiles stranded wherever they had flown to.
        if (dealing && dealtRoom != state.id) clock.snapTo(1f)

        // A quick match keeps its tiles in the deck while it hunts for
        // players, so kick-off has something to be. A private lobby keeps its
        // full preview: the host picked that board in order to look at it.
        deck = when {
            state.isLobby && state.quick == true && state.quickStartAt != null -> Deck.WAITING
            dealing -> Deck.DEALING
            else -> Deck.HIDDEN
        }

        val sawLobby = lastStatus == "lobby"
        lastStatus = state.status
        // Passing back through a lobby re-arms it: a rematch is a fresh game
        // at the same table, and it gets its own deal.
        if (state.isLobby) dealtRoom = null
        if (!sawLobby || state.status != "playing" || dealtRoom == state.id) return
        dealtRoom = state.id
        deal()
    }

    /**
     * Where tile [index] is this frame, given its seat and the middle of the
     * board. [TilePose.Settled] means there is nothing to do.
     */
    fun pose(index: Int, frame: Rect, centre: Offset): TilePose {
        val toCentre = centre - frame.center
        // Held in the deck: the resting pose is exactly the one the deal
        // flies out of, so kick-off is a release rather than a jump.
        if (deck == Deck.WAITING) return TilePose(toCentre.x, toCentre.y, STACK_TILT, STACK_SCALE, 0f)
        val t = clock.value
        if (t >= 1f) return TilePose.Settled

        val elapsed = t * total()
        val local = ((elapsed - RIFFLE - index * STAGGER) / FLIGHT).coerceIn(0f, 1f)
        val flown = FLY.transform(local)
        return TilePose(
            dx = toCentre.x * (1f - flown),
            dy = toCentre.y * (1f - flown),
            rotation = STACK_TILT * (1f - flown),
            scale = STACK_SCALE + (1f - STACK_SCALE) * flown,
            // The fade is over well before the flight is: a tile that is
            // still translucent as it lands reads as a rendering fault.
            alpha = (local * FLIGHT / FADE).coerceIn(0f, 1f),
        )
    }

    private suspend fun deal() {
        deck = Deck.DEALING
        SoundKit.shuffleDeal()
        clock.snapTo(0f)
        clock.animateTo(1f, tween(durationMillis = total().toInt(), easing = LinearEasing))
        deck = Deck.HIDDEN
    }

    /**
     * Leaving the table. Left alone, a deal cancelled halfway would strand
     * every tile mid-air on whatever board is drawn next.
     */
    private suspend fun forget() {
        deck = Deck.HIDDEN
        lastStatus = null
        dealtRoom = null
        if (clock.value < 1f) clock.snapTo(1f)
    }

    private fun total(): Float = RIFFLE + (tiles - 1).coerceAtLeast(0) * STAGGER + FLIGHT

    internal companion object {
        /** The deck's one riffle, before the first card leaves it. */
        const val RIFFLE = 620f

        /** Per-tile delay — the same 25ms the web client and iOS deal on. */
        const val STAGGER = 25f
        const val FLIGHT = 520f
        const val FADE = 300f

        /** The pose a tile holds while it is still a card on the deck. */
        const val STACK_SCALE = 0.22f
        const val STACK_TILT = -24f

        /** The web client's `cubic-bezier(.22, 1.35, .36, 1)` — it lands with a nudge. */
        val FLY = CubicBezierEasing(0.22f, 1.35f, 0.36f, 1f)
    }
}

/**
 * One [DeckIntro] per table, fed every push.
 *
 * Keyed on the room and its status rather than on the state object: a board
 * gets thirty pushes a minute and restarting the deal's coroutine on every
 * one of them would cancel the deal halfway through itself.
 */
@Composable
fun rememberDeckIntro(store: GameStore): DeckIntro {
    val intro = remember { DeckIntro() }
    val state = store.state
    LaunchedEffect(state?.id, state?.status, state?.map?.tiles?.size) { intro.sync(state) }
    return intro
}

/**
 * The deck itself: a stack of card backs in the middle of the table.
 *
 * Place it over the board's centre well. It draws nothing at all unless the
 * table is either waiting to be dealt or being dealt right now.
 */
@Composable
fun DeckIntroOverlay(intro: DeckIntro, modifier: Modifier = Modifier) {
    val deck = intro.deck
    if (deck == DeckIntro.Deck.HIDDEN) return

    val split = remember { Animatable(0f) }
    val sink = remember { Animatable(0f) }

    LaunchedEffect(deck) {
        sink.snapTo(0f)
        if (deck == DeckIntro.Deck.DEALING) {
            riffle(split)
            // The deck gets out of the way of the board it just dealt.
            sink.animateTo(1f, tween(durationMillis = 450, easing = FastOutLinearInEasing))
        } else {
            // A table that sits here for two minutes with a dead deck on it
            // looks stuck, so it shuffles to itself while it waits.
            while (true) {
                delay(4_500)
                riffle(split)
            }
        }
    }

    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val height = (minOf(maxWidth, maxHeight) * 0.42f).coerceIn(64.dp, 132.dp)
        val width = height * 0.71f
        for (i in 0 until CARDS) {
            CardBack(i, split.value, sink.value, width, height)
        }
    }
}

/** One split-and-merge pass of the stack, a little under a second. */
private suspend fun riffle(split: Animatable<Float, AnimationVector1D>) {
    split.animateTo(1f, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMedium))
    delay(90)
    split.animateTo(0f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMediumLow))
}

/**
 * A single card back, at its place in the stack.
 *
 * Everything that moves is a graphicsLayer — eight cards riffling is eight
 * transforms on the compositor, not eight re-layouts a frame.
 */
@Composable
private fun CardBack(index: Int, split: Float, sink: Float, width: Dp, height: Dp) {
    val p = P.current
    // Alternating halves, so the stack splits into two rather than fanning.
    val half = if (index % 2 == 0) -1f else 1f
    Box(
        Modifier
            .size(width, height)
            .graphicsLayer {
                translationX = split * half * width.toPx() * 0.62f
                translationY = index * -2.4f * density +
                    split * (index % 3) * 5f * density
                rotationZ = split * half * 9f + (1f - split) * (index * 1.4f - 6f)
                alpha = 1f - sink
                val shrink = 1f - sink * 0.6f
                scaleX = shrink
                scaleY = shrink
            }
            .clip(RoundedCornerShape(9.dp))
            .background(Brush.linearGradient(listOf(p.red, p.redDeep)))
            .border(1.5.dp, p.accentInk.copy(alpha = 0.35f), RoundedCornerShape(9.dp))
            .padding(6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "MM",
            color = p.accentInk.copy(alpha = 0.75f),
            fontSize = (height.value * 0.19f).sp,
            fontWeight = FontWeight.Black,
        )
    }
}

/** Enough cards to read as a deck, few enough to stay one draw call each. */
private const val CARDS = 8
