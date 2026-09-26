package com.moneymove.game

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

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
    private var lastRoom: String? = null
    private var dealtRoom: String? = null

    /** True while tiles are still in the air. */
    val dealing: Boolean get() = clock.value < 1f

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
        // under it, the screen went away — leaves a clock that nothing is
        // driving any more and every tile stranded wherever it had flown to.
        // Nobody else is coming to finish it, so an unfinished deal that has
        // stopped moving is put back.
        if (clock.value < 1f && !clock.isRunning) clock.snapTo(1f)

        // A quick match keeps its tiles in the deck while it hunts for
        // players, so kick-off has something to be — from the first push, as
        // iOS's heldInDeck does, since the well's idle deck is already there.
        // A private lobby keeps its full preview: the host picked that board
        // in order to look at it.
        deck = when {
            state.isLobby && state.quick == true -> Deck.WAITING
            dealing -> Deck.DEALING
            else -> Deck.HIDDEN
        }

        // Joining a table is not the same as watching it start, and the
        // status alone cannot tell them apart. Switching rooms leaves the old
        // table's state on screen until the new one's first push — the store
        // does a quiet leave that keeps it there — so a lobby seen at the old
        // table would read as this table's lobby, and anyone walking into a
        // friend's game already in progress would be shown the board dealing
        // itself in: the app saying the game is starting now when it started
        // ten minutes ago. Hence pinning the status to the room it was seen
        // in, which is what the web client's `lastStatus = null` on entering
        // a room amounts to.
        val sawLobby = lastStatus == "lobby" && lastRoom == state.id
        lastStatus = state.status
        lastRoom = state.id
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
        lastRoom = null
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
    LaunchedEffect(state?.id, state?.status, state?.map?.tiles?.size, state?.quick) { intro.sync(state) }
    return intro
}

/**
 * The table's deal, for whichever board is on screen. The screen holds it —
 * the lobby and the game are different layouts, so only something that
 * outlives both can watch one turn into the other — and the board reads it
 * from here rather than through every layout's parameters. Null draws an
 * ordinary board, which is what a board outside a table (the picker's
 * preview) wants.
 */
val LocalDeckIntro = staticCompositionLocalOf<DeckIntro?> { null }

/**
 * The deck at kick-off: one riffle, then it sinks away as the board deals
 * itself out of it.
 *
 * Place it over the board's centre well. Given no modifier it fills the box
 * it is dropped into and sits in the middle of it — left to wrap its cards it
 * would take their size and land in the corner of whatever is behind it,
 * which is a deck on the wall rather than on the table. It draws nothing at
 * all unless the table is being dealt right now.
 *
 * The deck a matchmade table waits on is not this one. That lives in the
 * centre well itself ([IdleDeck]), above the board's name and its empty
 * chairs, as it does on iOS — drawn here as well it would be two decks on one
 * table, one of them floating wherever this overlay happens to be placed.
 */
@Composable
fun DeckIntroOverlay(intro: DeckIntro, modifier: Modifier = Modifier) {
    if (intro.deck != DeckIntro.Deck.DEALING) return

    val split = remember { Animatable(0f) }
    val sink = remember { Animatable(0f) }

    LaunchedEffect(Unit) {
        riffle(split)
        // The deck gets out of the way of the board it just dealt.
        sink.animateTo(1f, tween(durationMillis = 450, easing = FastOutLinearInEasing))
    }

    // The cards are one fixed size on every board, as iOS's are: a deck is an
    // object on the table, not a proportion of it, and a deck that grew with
    // the board read as a different deck on a tablet than on a phone.
    //
    // The sink shrinks and fades the deck as one object, about its own centre,
    // as iOS scales its whole deck: the stack's offsets shrink with the cards,
    // so they do not drift apart as they go.
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Box(
            Modifier.graphicsLayer {
                val shrink = 1f - sink.value * 0.6f
                scaleX = shrink
                scaleY = shrink
                alpha = 1f - sink.value
            },
            contentAlignment = Alignment.Center,
        ) {
            for (i in 0 until CARDS) {
                CardBack(i, split.value)
            }
        }
    }
}

/**
 * The deck a matchmade table waits on: the undealt board, sitting in the
 * middle of the table and never sinking away — kick-off is what deals it out.
 *
 * A table that sits for a minute with a dead deck on it looks stuck, so it
 * shuffles to itself every few seconds while it waits. iOS draws this as the
 * kick-off deck scaled to 0.72 in a slot 92 high, so it is drawn the same
 * way here: the whole deck scaled, riffle and all, rather than smaller cards
 * that would riffle by the full-size distances.
 */
@Composable
fun IdleDeck(modifier: Modifier = Modifier) {
    val split = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(4_500)
            riffle(split)
        }
    }
    Box(modifier.height(92.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier.graphicsLayer {
                scaleX = IDLE_SCALE
                scaleY = IDLE_SCALE
            },
            contentAlignment = Alignment.Center,
        ) {
            for (i in 0 until CARDS) {
                CardBack(i, split.value)
            }
        }
    }
}

/** The idle deck's size against the kick-off deck's — iOS's scaleEffect. */
private const val IDLE_SCALE = 0.72f

/**
 * One split-and-merge pass of the stack, on iOS's beat: the halves fly apart
 * on a quick, lively spring, and 330ms later they are sent back on a bouncier
 * one whether or not the first has settled — then 520ms for the merge before
 * whatever comes next. iOS's springs are given as a duration and a bounce;
 * these are the same springs, as a stiffness and a damping ratio.
 *
 * The merge is launched rather than awaited, because iOS does not wait for it
 * either: the kick-off deck starts sinking while the halves are still
 * settling into each other, and that overlap is what makes it one movement.
 */
private suspend fun CoroutineScope.riffle(split: Animatable<Float, AnimationVector1D>) {
    // Launched on the caller's scope, not a scope of this function's own: a
    // local scope would sit here until the merge had settled, which is the
    // wait this is avoiding. The second animation takes the value over from
    // the first, as iOS's second withAnimation does.
    launch { split.animateTo(1f, spring(dampingRatio = 0.6f, stiffness = 504f)) }
    delay(330)
    launch { split.animateTo(0f, spring(dampingRatio = 0.5f, stiffness = 439f)) }
    delay(520)
}

/**
 * A single card back, at its place in the stack.
 *
 * iOS's card, measure for measure: 74 by 104 on a nine-point corner, the
 * accent running into its deep shade corner to corner, a keyline inset six
 * points in, "MM" in the middle, and a soft shadow under each card so the
 * stack reads as cards rather than as one slab. The type is set in points
 * rather than scaled with the reader's font size, as iOS's fixed size is —
 * a large system font would push the monogram off the card.
 *
 * Everything that moves is a graphicsLayer — ten cards riffling is ten
 * transforms on the compositor, not ten re-layouts a frame.
 */
@Composable
private fun CardBack(index: Int, split: Float) {
    val p = P.current
    val monogram = with(LocalDensity.current) { 20.dp.toSp() }
    // Alternating halves, so the stack splits into two rather than fanning.
    val half = if (index % 2 == 0) -1f else 1f
    Box(
        Modifier
            // Required, not merely preferred: the idle deck's slot is shorter
            // than a card, and iOS lets the card overhang it rather than
            // squashing it to fit.
            .requiredSize(CARD_WIDTH, CARD_HEIGHT)
            .graphicsLayer {
                translationX = split * half * SPLIT_X.toPx()
                translationY = index * -2.4f * density +
                    split * (index % 3) * 5f * density
                rotationZ = split * half * 9f + (1f - split) * (index * 1.4f - 6f)
            }
            .shadow(6.dp, CARD_SHAPE, clip = false, ambientColor = CARD_SHADOW, spotColor = CARD_SHADOW)
            .clip(CARD_SHAPE)
            .background(Brush.linearGradient(listOf(p.red, p.redDeep)))
            .padding(6.dp)
            .border(1.5.dp, p.accentInk.copy(alpha = 0.4f), RoundedCornerShape(6.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "MM",
            color = p.accentInk.copy(alpha = 0.75f),
            fontSize = monogram,
            fontWeight = FontWeight.Black,
            maxLines = 1,
            softWrap = false,
        )
    }
}

private val CARD_WIDTH = 74.dp
private val CARD_HEIGHT = 104.dp
private val CARD_SHAPE = RoundedCornerShape(9.dp)
private val CARD_SHADOW = Color.Black.copy(alpha = 0.3f)

/** How far each half travels sideways at the top of a riffle. */
private val SPLIT_X = 46.dp

/** iOS's ten: enough to read as a deck, few enough to stay one draw call each. */
private const val CARDS = 10
