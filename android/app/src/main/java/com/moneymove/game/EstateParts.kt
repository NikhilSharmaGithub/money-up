package com.moneymove.game

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// The pieces 1.0.7's estate screens share (round 3, H1/H2/H5): the countdown
// ring the auction card and the bankruptcy question both run on, a deed's
// mark and its little row, the two big answers to "what happens to your
// streets?", the state pill, and the segmented control the lobby's three-way
// rules use. Kept together so the auction card, the prompt, the give-up
// dialog and the lobby are drawn from one set of parts — the reason they
// read as one family rather than four screens that each had a go.

// ── the ring ───────────────────────────────────────────────────────────────

/**
 * A countdown drawn as a ring that empties clockwise from twelve, the whole
 * seconds left in the middle.
 *
 * Gold while there is time, warming through to the palette's red over the
 * last five seconds, with a small beat on each of them — the moment a
 * bidder or a bankrupt player has to be told without being shouted at. It
 * moves every frame, because a ring that steps once a second looks broken,
 * and stops asking for frames the moment it is out.
 *
 * [window] is the length the ring measures against — twenty seconds for a
 * question or a fresh lot, twelve once an auction has a bid (see
 * [AuctionState.windowSeconds]). A null [endsAt] is no clock at all, and
 * then the ring draws its empty track and no number: nothing to count down
 * is not "0". [centre], when given, sits in the ring instead of the number —
 * the face of whoever the clock is running on.
 */
@Composable
internal fun CountdownRing(
    endsAt: Double?,
    window: Double,
    size: Dp,
    modifier: Modifier = Modifier,
    stroke: Dp = 4.dp,
    track: Color = P.current.sunken,
    centre: (@Composable () -> Unit)? = null,
) {
    val p = P.current
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(endsAt) {
        val end = endsAt ?: return@LaunchedEffect
        while (now < end) withFrameMillis { now = System.currentTimeMillis() }
    }
    val remaining = endsAt?.let { maxOf(0.0, (it - now) / 1000.0) }
    val fraction = remaining?.let { minOf(1.0, it / window.coerceAtLeast(1.0)).toFloat() } ?: 0f
    // 0 with five or more seconds to go, 1 at the buzzer.
    val warm = remaining?.let { (1.0 - it / WARM_SECONDS).coerceIn(0.0, 1.0).toFloat() } ?: 0f
    val ink = lerp(p.gold, p.bad, warm)
    val whole = remaining?.let { kotlin.math.ceil(it).toInt() }
    val beat by animateFloatAsState(
        if (whole != null && whole in 1..WARM_SECONDS.toInt() && whole % 2 == 1) 1.08f else 1f,
        tween(180),
        label = "ring.beat",
    )
    val density = LocalDensity.current
    Box(
        modifier
            .size(size)
            .graphicsLayer { scaleX = beat; scaleY = beat }
            .semantics { if (whole != null) contentDescription = "$whole seconds left" }
            .drawBehind {
                val w = stroke.toPx()
                val inset = w / 2f
                val arc = Size(this.size.width - w, this.size.height - w)
                drawArc(track, 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(w))
                if (fraction > 0f) {
                    drawArc(ink, -90f, 360f * fraction, false, Offset(inset, inset), arc, style = Stroke(w, cap = StrokeCap.Round))
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        if (centre != null) {
            centre()
        } else if (whole != null) {
            Text(
                "$whole",
                color = if (warm > 0f) ink else p.ink,
                // Through the density, so a large system font does not push
                // the number out of its ring — the ring does not grow with it.
                fontSize = with(density) { (size * 0.36f).toSp() },
                fontWeight = FontWeight.ExtraBold,
                style = TextStyle(fontFeatureSettings = "tnum"),
                maxLines = 1,
                softWrap = false,
            )
        }
    }
}

/** The last stretch of a countdown, where the ring warms and beats. */
private const val WARM_SECONDS = 5.0

// ── a deed, small ──────────────────────────────────────────────────────────

/** Airports and utilities have no country, so they wear their own colours — the deed card's. */
private val LOT_AIRPORT_BLUE = Color(0xFF5B8DEF)
private val LOT_UTILITY_CYAN = Color(0xFF22D3EE)

/** The colour a deed is printed in: its country's, or the airport blue and utility cyan. */
@Composable
internal fun deedColour(tile: TileData?, group: GroupInfo?): Color = when (tile?.type) {
    "airport" -> LOT_AIRPORT_BLUE
    "utility" -> LOT_UTILITY_CYAN
    else -> cssColor(group?.color, P.current.ink3)
}

/**
 * What leads a deed in a list: the mark the board gives the same square. A
 * street flies its country's medallion, an airport its plane and a utility
 * its water, oil, sun or wind, as on the tile; a street from a board with no
 * marks keeps its colour dot. One square for all, so the names line up.
 */
@Composable
internal fun LotBadge(tile: TileData?, group: GroupInfo?, size: Dp, modifier: Modifier = Modifier) {
    val p = P.current
    val colour = deedColour(tile, group)
    val flag = group?.flag?.takeIf { tile?.type == "property" && it.isNotBlank() }
    val measurer = rememberTextMeasurer()
    val wash = p.sunken
    val ink = p.ink
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        when {
            flag != null -> Canvas(Modifier.size(size).shadow(1.5.dp, CircleShape, clip = false)) {
                with(Art) { drawMedallion(flag, colour, center, this@Canvas.size.minDimension / 2f, wash = wash, measurer = measurer) }
            }
            tile != null && (tile.type == "airport" || tile.type == "utility") -> Canvas(Modifier.size(size * 0.86f)) {
                drawTileMark(tile, center, this.size.minDimension, ink)
            }
            else -> Box(Modifier.size(size * 0.56f).clip(CircleShape).background(colour))
        }
    }
}

/**
 * One deed of a bankrupt player's estate: its mark and a stripe of its
 * colour, its name over its country (or "Airport", "Utility"), and the
 * printed price — what the bank paid for it, and what an auction will be
 * measured against.
 */
@Composable
internal fun EstateRow(store: GameStore, index: Int) {
    val p = P.current
    val tile = store.tile(index)
    val group = tile?.let { store.groupInfo(it) }
    val colour = deedColour(tile, group)
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(width = 3.dp, height = 26.dp).clip(MMShapes.pill).background(colour))
        LotBadge(tile, group, 22.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(
                tile?.name ?: "Property",
                color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                when (tile?.type) {
                    "airport" -> "Airport"
                    "utility" -> "Utility"
                    else -> group?.name?.takeIf { it.isNotBlank() } ?: "Street"
                },
                color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        tile?.price?.let {
            Text(money(it), color = p.ink2, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1)
        }
    }
}

/**
 * A bankrupt player's deeds as a card of [EstateRow]s, in board order. A
 * long estate scrolls inside the card past [maxHeight] rather than pushing
 * the answers below it off a small phone.
 */
@Composable
internal fun EstateList(store: GameStore, tiles: List<Int>, modifier: Modifier = Modifier, maxHeight: Dp = 196.dp) {
    val p = P.current
    val shape = MMShapes.r14
    Column(
        modifier
            .fillMaxWidth()
            .background(p.card, shape)
            .border(1.dp, p.rule, shape)
            .heightIn(max = maxHeight)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 3.dp),
    ) {
        tiles.forEachIndexed { i, index ->
            if (i > 0) Rule()
            EstateRow(store, index)
        }
    }
}

// ── the two answers ────────────────────────────────────────────────────────

/** "Give them back to the bank" and "Auction them to everyone": the words every screen asks with. */
internal object EstateAnswers {
    const val BANK = "Give them back to the bank"
    const val BANK_DETAIL = "Nobody gets them — they're unowned again, free to buy."
    const val AUCTION = "Auction them to everyone"
    const val AUCTION_DETAIL = "One at a time, from \$10 — anyone still playing can bid."
}

/**
 * One of the two big answers to "what happens to your streets?": a mark in
 * a well of its colour, the answer, and the line that says what it does at
 * the board. The whole tile is the button, and it gives under the thumb.
 *
 * Paper, wherever it is put — the prompt's tray and the give-up dialog are
 * glass, and an answer is content laid on them, not another pane.
 */
@Composable
internal fun ChoiceTile(
    glyph: String,
    title: String,
    detail: String,
    accent: Color,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val p = P.current
    val press = remember { MutableInteractionSource() }
    val down by press.collectIsPressedAsState()
    val give by animateFloatAsState(if (down) 0.97f else 1f, spring(dampingRatio = 0.7f), label = "choice")
    val shape = MMShapes.r14
    Row(
        modifier
            .fillMaxWidth()
            .graphicsLayer { scaleX = give; scaleY = give }
            .alpha(if (enabled) 1f else 0.5f)
            .shadow(if (down) 1.dp else 3.dp, shape, clip = false)
            .background(p.card, shape)
            .background(accent.copy(alpha = if (down) 0.16f else 0.08f), shape)
            .border(1.5.dp, accent.copy(alpha = 0.55f), shape)
            .clickable(interactionSource = press, indication = null, enabled = enabled, role = Role.Button) { onClick() }
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(40.dp).clip(CircleShape).background(accent.copy(alpha = 0.18f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(glyph, size = 22.dp, tint = accent)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 19.sp)
            Text(detail, color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium, lineHeight = 16.sp)
        }
        RowChevron(p.ink3, 11.dp)
    }
}

/**
 * The pair, bank first — the table's default, and the gentler of the two —
 * then the auction in the brass every auction wears.
 */
@Composable
internal fun EstateAnswerTiles(enabled: Boolean = true, onAnswer: (auction: Boolean) -> Unit) {
    val p = P.current
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ChoiceTile("bank", EstateAnswers.BANK, EstateAnswers.BANK_DETAIL, p.ink2, enabled = enabled) { onAnswer(false) }
        ChoiceTile("gavel", EstateAnswers.AUCTION, EstateAnswers.AUCTION_DETAIL, p.gold, enabled = enabled) { onAnswer(true) }
    }
}

// ── the pill ───────────────────────────────────────────────────────────────

/** How a [StatePill] reads: good news, or plain fact. */
internal enum class PillTone { GOOD, QUIET }

/**
 * A seat's own state, said as a capsule rather than a stray grey word:
 * "You lead", "You passed", "You're out".
 */
@Composable
internal fun StatePill(text: String, tone: PillTone, modifier: Modifier = Modifier, glyph: String? = null) {
    val p = P.current
    val ink = if (tone == PillTone.GOOD) p.good else p.ink2
    val fill = if (tone == PillTone.GOOD) p.goodSoft else p.sunken
    Row(
        modifier
            .clip(MMShapes.pill)
            .background(fill)
            .border(1.dp, if (tone == PillTone.QUIET) p.rule else ink.copy(alpha = 0.45f), MMShapes.pill)
            .padding(horizontal = 11.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        when {
            glyph == "check" -> SfMark("checkmark", 12.dp, ink)
            glyph != null -> Icon(glyph, size = 12.dp, tint = ink)
        }
        Text(text, color = ink, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, softWrap = false)
    }
}

// ── the segmented control ──────────────────────────────────────────────────

/** One segment: its value, its words, and optionally a mark over them. */
internal class Segment<T>(val value: T, val label: String, val glyph: String? = null)

/**
 * iOS's segmented control in the house's hand: a sunken track, and a card
 * lozenge under the chosen segment that slides to the next one on a spring
 * rather than jumping. A segment with a [Segment.glyph] stands its mark over
 * its words, which may then take two lines — "Back to the bank" is a phrase,
 * and a narrow phone has a third of its width for it.
 *
 * The track is the radio group and each segment a radio button, so a screen
 * reader says which is chosen. Locked, the whole control fades and nothing
 * answers — the host's to change, and everybody else's to read.
 */
@Composable
internal fun <T> SegmentedControl(
    segments: List<Segment<T>>,
    selected: T,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onPick: (T) -> Unit,
) {
    val p = P.current
    val track = MMShapes.continuous(12.dp)
    val lozenge = MMShapes.continuous(9.dp)
    val count = segments.size.coerceAtLeast(1)
    val at = segments.indexOfFirst { it.value == selected }.coerceAtLeast(0)
    val reduceMotion = rememberReduceMotion()
    Box(
        modifier
            .fillMaxWidth()
            .alpha(if (enabled) 1f else 0.6f)
            .clip(track)
            .background(p.sunken)
            .border(1.dp, p.rule, track)
            .padding(3.dp),
    ) {
        // The lozenge sits under the row, sized by it, and slides.
        BoxWithConstraints(Modifier.matchParentSize()) {
            val slot = maxWidth / count
            val x by animateDpAsState(
                slot * at,
                if (reduceMotion) tween(GlassMotion.REDUCED_MS) else spring(dampingRatio = 0.82f, stiffness = 520f),
                label = "segment",
            )
            Box(
                Modifier
                    .offset(x = x)
                    .width(slot)
                    .fillMaxHeight()
                    .shadow(2.dp, lozenge, clip = false)
                    .background(p.card, lozenge)
                    .border(1.dp, p.rule, lozenge),
            )
        }
        Row(Modifier.fillMaxWidth().selectableGroup()) {
            for (segment in segments) {
                val on = segment.value == selected
                Column(
                    Modifier
                        .weight(1f)
                        .clip(lozenge)
                        .selectable(selected = on, enabled = enabled, role = Role.RadioButton) {
                            if (!on) {
                                Haptics.tap()
                                onPick(segment.value)
                            }
                        }
                        .padding(horizontal = 4.dp, vertical = if (segment.glyph != null) 7.dp else 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterVertically),
                ) {
                    segment.glyph?.let { Icon(it, size = 17.dp, tint = if (on) p.ink else p.ink3) }
                    Text(
                        segment.label,
                        color = if (on) p.ink else p.ink3,
                        fontSize = if (segment.glyph != null) 12.sp else 13.sp,
                        lineHeight = 15.sp,
                        fontWeight = if (on) FontWeight.ExtraBold else FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                        maxLines = if (segment.glyph != null) 2 else 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/** The edge-to-edge band of a deed's colour, down the left of a card. */
internal fun Modifier.deedBand(colour: Color, width: Dp = 5.dp): Modifier = drawBehind {
    drawRect(colour, size = Size(width.toPx(), size.height))
}
