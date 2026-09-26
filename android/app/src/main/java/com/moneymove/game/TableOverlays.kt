package com.moneymove.game

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.togetherWith
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Seats the table is holding.
 *
 * Somebody's connection went away and the server is keeping their chair. The
 * card carries the only two things the room needs: how long is left, and the
 * button that buys them another minute. The first couple of extensions are a
 * favour any one player can do alone; after that the server wants everybody's
 * click, so the button stops being a favour and becomes a vote — it says so,
 * and carries the tally and a pip per voter with it.
 *
 * Never shown to the seat being waited on, nor to any seat on this phone:
 * nobody votes themselves back in. And only while the game is on, with the
 * player still gone — the moment they reconnect, or the chair is released,
 * the row goes. iOS: AwaitingSeatsCard in GameScreen.swift.
 */
@Composable
fun AwaitingSeats(store: GameStore, modifier: Modifier = Modifier) {
    val state = store.state
    val seats = state?.takeIf { it.isPlaying }?.awaiting.orEmpty().filter { seat ->
        val who = state?.player(seat.id)
        !store.isLocal(seat.id) && who != null &&
            who.connected != true && !who.isBankrupt && !who.wasRemoved
    }
    // Held for the way out, so the card folds away with its words still on it.
    var last by remember { mutableStateOf<List<AwaitingSeat>>(emptyList()) }
    SideEffect { if (seats.isNotEmpty()) last = seats }
    val shown = seats.ifEmpty { last }

    AnimatedVisibility(
        visible = seats.isNotEmpty(),
        modifier = modifier,
        // iOS moves the card in from the top edge and fades it, rather than
        // unrolling it downward.
        enter = slideInVertically { -it } + fadeIn(),
        exit = slideOutVertically { -it } + fadeOut(),
    ) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (seat in shown) HeldSeat(store, seat)
        }
    }
}

@Composable
private fun HeldSeat(store: GameStore, seat: AwaitingSeat) {
    val p = P.current
    val player = store.state?.player(seat.id)
    // Agreed once every seat this phone holds has clicked for them.
    val mine = store.localIds - seat.id
    val agreed = mine.isNotEmpty() && mine.all { it in seat.grantedIds }
    val count = seat.grantedIds.size
    // A vote can't need fewer seats than have already clicked.
    val voters = maxOf(seat.voterCount, count)
    val shape = RoundedCornerShape(14.dp)

    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.goldSoft.copy(alpha = 0.7f))
            .border(1.dp, p.gold.copy(alpha = 0.6f), shape)
            .padding(11.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            player?.let { PlayerDisc(it, size = 30.dp) }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(
                    "${player?.name ?: "A player"} dropped out",
                    color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    if (seat.isVote) "Everyone still at the table has to agree now."
                    else "Any one of you can hand them another minute.",
                    color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
                )
            }
            // iOS parts the words from the clock with a flexible space of at
            // least six, so a long line wraps twenty-four short of the clock
            // rather than nine.
            Spacer(Modifier.width(6.dp))
            seat.until?.let { SeatCountdown(it) }
        }

        if (seat.isVote) VoteBar(count, voters)

        val tally = "$count of $voters agreed"
        MMButton(
            when {
                !seat.isVote -> if (agreed) "✓  Minute granted" else "Grant a minute"
                agreed -> "✓  You agreed — waiting on the rest ($tally)"
                else -> "Everyone must agree — $tally"
            },
            // Agreed, it is iOS's ghost — a sunken well, no outline — faded to
            // 0.75 and nothing more: MMButton keeps its colours when it stops
            // answering, as iOS's style does.
            modifier = Modifier.fillMaxWidth().alpha(if (agreed) 0.75f else 1f),
            kind = if (agreed) BtnKind.PLAIN else BtnKind.GOLD,
            big = true,
            // Only the two live states carry a mark: one player can hold the
            // chair, or the whole table has to. Once you have clicked, the ✓
            // in the label says so and a second mark would only crowd it.
            icon = if (agreed) null else if (seat.isVote) "people" else "shield",
            iconSize = 18.dp,
            // One line, shrinking to three quarters before it would wrap —
            // iOS's lineLimit(1).minimumScaleFactor(0.75).
            fitScale = 0.75f,
            enabled = !agreed,
        ) { store.grantTime(seat.id) }
    }
}

/** One pip per player who still has to click, filled as they do. */
@Composable
private fun VoteBar(count: Int, voters: Int) {
    val p = P.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        repeat(maxOf(voters, 1)) { i ->
            val lit by animateFloatAsState(if (i < count) 1f else 0f, tween(250), label = "votePip")
            Box(
                Modifier
                    .weight(1f)
                    .height(5.dp)
                    .clip(RoundedCornerShape(99.dp))
                    .background(if (lit > 0.5f) p.gold else p.rule2),
            )
        }
    }
}

/**
 * Seconds until a held chair goes back to the board, ticked on this device so
 * it keeps moving between state pushes. Red for the last fifteen.
 */
@Composable
private fun SeatCountdown(until: Double) {
    val p = P.current
    val left = rememberSecondsLeft(until)
    Column(
        Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(p.card.copy(alpha = 0.85f))
            .padding(horizontal = 9.dp, vertical = 5.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "${left}s",
            color = if (left <= 15) p.bad else p.ink,
            style = TextStyle(fontFeatureSettings = "tnum"),
            fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1,
        )
        Text("left", color = p.ink3, fontSize = 8.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
    }
}

/**
 * This device's seat was taken out by the clock.
 *
 * It takes over the screen because it changes what the player can do next —
 * but the game is still worth watching, so staying is offered as plainly as
 * leaving, and the cost of having gone is said where it was paid: leaving or
 * timing out is a point of karma, and a number that drops with no reason
 * given reads as the app taking it. Staying puts the store's flag down; the
 * dock then says, for as long as the game lasts, that this seat is watching.
 */
@Composable
fun TimedOutOverlay(store: GameStore, modifier: Modifier = Modifier) {
    val p = P.current
    val shape = RoundedCornerShape(22.dp)
    // The card arrives the way iOS's does, from 86% on a 0.35-second spring,
    // while the scrim behind it only fades in.
    val grow = remember { Animatable(0.86f) }
    LaunchedEffect(Unit) { grow.animateTo(1f, spring(dampingRatio = 1f, stiffness = 320f)) }
    Box(
        modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.6f))
            // The scrim keeps the table behind it out of reach, not just out of sight.
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .padding(horizontal = 26.dp)
                .widthIn(max = 340.dp)
                .graphicsLayer {
                    scaleX = grow.value
                    scaleY = grow.value
                }
                .shadow(30.dp, shape)
                .clip(shape)
                .background(p.card)
                .border(1.dp, p.rule, shape)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // iOS puts an hourglass here. The drawn set has none, and chrome
            // is never an emoji, so this file draws one in the set's own hand
            // ([HOURGLASS]) — wood, glass and sand, in the toolbox's colours.
            DrawnMark(HOURGLASS, size = 46.dp, tint = p.ink2)
            Text(
                "Your time ran out",
                color = p.ink, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold,
                textAlign = TextAlign.Center,
            )
            Text(
                "You were removed to keep the game moving. You can head back or stay and watch how it ends.",
                color = p.ink2, fontSize = 14.sp,
                fontWeight = FontWeight.Medium, textAlign = TextAlign.Center,
            )
            Column(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                MMButton("Back to home", Modifier.fillMaxWidth(), kind = BtnKind.PRIMARY, big = true) {
                    store.leave()
                    Haptics.tap()
                }
                MMButton("Stay and watch", Modifier.fillMaxWidth(), kind = BtnKind.GHOST, big = true) {
                    store.timedOut = false
                    Haptics.tap()
                }
            }
            Text(
                "Leaving or timing out costs 1 karma.",
                color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * The deadlock rule, the one time it becomes possible.
 *
 * The same card treatment as a Treasure draw, but it waits to be dismissed
 * instead of timing out — it is a rule to read, not a result to glance at —
 * and it says the one thing that makes the rule fair: the players can settle
 * it themselves before the board ever steps in.
 */
@Composable
fun ReliefCardOverlay(store: GameStore, modifier: Modifier = Modifier) {
    val shown = store.reliefPopup
    // Held for the way out, so the card fades with its words still on it.
    var last by remember { mutableStateOf<ReliefCard?>(null) }
    SideEffect { if (shown != null) last = shown }
    val card = shown ?: last
    AnimatedVisibility(visible = shown != null, modifier = modifier, enter = fadeIn(), exit = fadeOut()) {
        card?.let { ReliefPanel(store, it) }
    }
}

@Composable
private fun ReliefPanel(store: GameStore, card: ReliefCard) {
    val p = P.current
    val shape = RoundedCornerShape(20.dp)
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.45f))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                store.reliefPopup = null
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .padding(horizontal = 24.dp)
                .widthIn(max = 340.dp)
                .shadow(26.dp, shape)
                .clip(shape)
                .background(p.card)
                .border(2.dp, p.gold, shape)
                // A tap on the card itself is not a tap on the scrim.
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon("scales", size = 44.dp, tint = p.gold)
            Text(
                card.title.uppercase(),
                color = p.ink3, fontSize = 11.sp, letterSpacing = 2.sp,
                fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
            )
            Text(
                card.text,
                color = p.ink, fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
            )
            Text(
                "Trading the street yourselves settles it first — the board only steps in if nobody does.",
                color = p.ink3, fontSize = 12.5.sp,
                fontWeight = FontWeight.Medium, textAlign = TextAlign.Center,
            )
            MMButton(
                "Got it",
                Modifier.fillMaxWidth().padding(top = 2.dp),
                kind = BtnKind.GOLD,
                big = true,
            ) {
                store.reliefPopup = null
            }
        }
    }
}

/**
 * The store's toast, drawn the way iOS's ToastLayer draws it.
 *
 * White words on a pill that is the ink in light mode — opaque, or the label
 * would be white on near-white — and a veil of the ink over the card in the
 * dark, where iOS lets its material show through; an error stays red either
 * way. It leads with a mark: the toast's own glyph when it has a subject,
 * otherwise iOS's info circle, or its warning triangle for an error, both
 * redrawn in white since the drawn set's warning keeps its own amber. At most
 * two lines, fourteen semibold, 24 above the bottom edge at a table and 78 on
 * the tabs, where the floating tab bar would otherwise sit on top of it. It
 * rises in from the bottom rather than fading in place.
 *
 * Not placed by anything in this file: the toast layer that sits over every
 * screen is AppScaffold's, and the one inside the result sheet is
 * GameOverSheet's. Either draws iOS's toast by calling this where it now
 * draws its own.
 */
@Composable
fun ToastPill(store: GameStore, modifier: Modifier = Modifier) {
    val p = P.current
    val dark = p.page.luminance() < 0.5f
    val shown = store.toast
    // Held for the way out, so the pill leaves with its words still on it.
    var last by remember { mutableStateOf<GameStore.Toast?>(null) }
    SideEffect { if (shown != null) last = shown }
    val toast = shown ?: last
    val inset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    AnimatedVisibility(
        visible = shown != null,
        modifier = modifier.padding(bottom = inset + if (store.roomId == null) 78.dp else 24.dp),
        enter = slideInVertically { it } + fadeIn(),
        exit = slideOutVertically { it } + fadeOut(),
    ) {
        // A toast that replaces another goes as iOS's does — keyed by its
        // own id, the old pill leaves and a new one comes in — rather than
        // the words changing inside a pill that stays put.
        AnimatedContent(
            targetState = toast,
            contentKey = { it?.at },
            transitionSpec = {
                (slideInVertically { it } + fadeIn()) togetherWith
                    (slideOutVertically { it } + fadeOut()) using SizeTransform(clip = false)
            },
            label = "toast",
        ) { t ->
            t ?: return@AnimatedContent
            val shape = RoundedCornerShape(99.dp)
            val fill = when {
                t.isError -> Modifier.background(p.redDeep, shape)
                dark -> Modifier.background(p.card, shape).background(p.ink.copy(alpha = 0.25f), shape)
                else -> Modifier.background(p.ink, shape)
            }
            // No margin of its own at the sides: the screen's edge is the
            // only limit iOS's pill has.
            Row(
                Modifier
                    .then(fill)
                    .padding(horizontal = 17.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val glyph = t.glyph
                if (glyph != null) {
                    Icon(glyph, size = 17.dp, tint = Color.White)
                } else {
                    DrawnMark(if (t.isError) ALERT_MARK else INFO_MARK, size = 17.dp, tint = Color.White)
                }
                Text(
                    t.text,
                    color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

// ── the few marks this file draws itself ────────────────────────────────────
//
// Glyphs.kt is generated from icons.js and has no hourglass, no plain info
// circle and no warning triangle that takes a tint, so these three are drawn
// here on the same 32-point grid and with the same parts the generated set
// uses. Kept private to this file, and meant to give way the day icons.js
// draws its own.

/** Parts on the 32 grid, parsed once. */
private fun marks(vararg parts: GlyphPart): List<Pair<GlyphPart, Path>> = parts.map { part ->
    part to PathParser().parsePathString(part.d).toPath().apply {
        fillType = if (part.evenOdd) PathFillType.EvenOdd else PathFillType.NonZero
    }
}

/** Draws a mark as Art draws a glyph: INK takes `tint`, anything else keeps its own colour. */
@Composable
private fun DrawnMark(parts: List<Pair<GlyphPart, Path>>, size: Dp, tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.size(size)) {
        val k = this.size.minDimension / Art.GRID
        scale(k, k, pivot = Offset.Zero) {
            for ((part, path) in parts) {
                part.fill?.let { drawPath(path, markColour(it, tint), alpha = part.alpha, style = Fill) }
                part.stroke?.let {
                    drawPath(
                        path, markColour(it, tint), alpha = part.alpha,
                        style = Stroke(
                            width = part.strokeWidth,
                            cap = if (part.cap == 1) StrokeCap.Round else StrokeCap.Butt,
                            join = if (part.join == 1) StrokeJoin.Round else StrokeJoin.Miter,
                        ),
                    )
                }
            }
        }
    }
}

private fun markColour(raw: Long, tint: Color): Color = if (raw == INK) tint else Color(raw.toInt())

/**
 * An hourglass partway run: wooden caps and posts, pale glass, the sand still
 * falling in a thread from the top bulb into a heap at the bottom. It keeps
 * its own colours, as iOS's does.
 */
private val HOURGLASS by lazy {
    marks(
        GlyphPart("M7.6 7.4v17.2M24.4 7.4v17.2", fill = null, stroke = 0xFF8A5A12, strokeWidth = 1.8f, cap = 1),
        GlyphPart(
            "M9.6 7.4h12.8c0 4.4-2.6 6.9-5 8.6 2.4 1.7 5 4.2 5 8.6H9.6c0-4.4 2.6-6.9 5-8.6-2.4-1.7-5-4.2-5-8.6z",
            fill = 0xFFCFE8F7, alpha = 0.55f,
        ),
        GlyphPart(
            "M9.6 7.4h12.8c0 4.4-2.6 6.9-5 8.6 2.4 1.7 5 4.2 5 8.6H9.6c0-4.4 2.6-6.9 5-8.6-2.4-1.7-5-4.2-5-8.6z",
            fill = null, stroke = 0xFF9CC7E0, strokeWidth = 1.2f, join = 1,
        ),
        GlyphPart("M10.8 11h10.4c-.7 1.9-2.2 3.3-3.8 4.4h-2.8c-1.6-1.1-3.1-2.5-3.8-4.4z", fill = 0xFFF0A336),
        GlyphPart("M15.4 15.2h1.2v6.6h-1.2z", fill = 0xFFF0A336),
        GlyphPart("M10.4 24.6c.8-2.6 3-4 5.6-4s4.8 1.4 5.6 4z", fill = 0xFFD97B0F),
        GlyphPart(
            "M6.4 3h19.2a1.6 1.6 0 0 1 1.6 1.6v1.2a1.6 1.6 0 0 1-1.6 1.6H6.4a1.6 1.6 0 0 1-1.6-1.6V4.6A1.6 1.6 0 0 1 6.4 3z",
            fill = 0xFFC08A3E,
        ),
        GlyphPart(
            "M6.4 24.6h19.2a1.6 1.6 0 0 1 1.6 1.6v1.2a1.6 1.6 0 0 1-1.6 1.6H6.4a1.6 1.6 0 0 1-1.6-1.6v-1.2a1.6 1.6 0 0 1 1.6-1.6z",
            fill = 0xFFC08A3E,
        ),
    )
}

/** info.circle.fill: a disc with the "i" cut out of it. */
private val INFO_MARK by lazy {
    marks(
        GlyphPart(
            "M16 2.6a13.4 13.4 0 1 0 0 26.8a13.4 13.4 0 1 0 0-26.8zM14.3 13.4h3.4v9.8h-3.4zM14.1 9.4a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0z",
            evenOdd = true,
        ),
    )
}

/** exclamationmark.triangle.fill: the drawn warning's outline with the mark cut out, so it takes a tint. */
private val ALERT_MARK by lazy {
    marks(
        GlyphPart(
            "M14.1 4.5 2.5 24.3a2.2 2.2 0 0 0 1.9 3.3h23.2a2.2 2.2 0 0 0 1.9-3.3L17.9 4.5a2.2 2.2 0 0 0-3.8 0zM14.6 11h2.8v8h-2.8zM14.2 23.2a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0z",
            evenOdd = true,
        ),
    )
}
