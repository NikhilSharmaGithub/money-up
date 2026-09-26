package com.moneymove.game

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.AnimationVector2D
import androidx.compose.animation.core.EaseIn
import androidx.compose.animation.core.EaseInOut
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.hypot

/**
 * The board: forty tiles, their deeds, and the pieces standing on them.
 *
 * The tiles are drawn as one Canvas rather than forty composables. A board
 * re-renders on every push — thirty-odd times a minute — and forty
 * recomposing views that each read the store is how a phone starts dropping
 * frames in the middle of somebody's turn. The pieces get a Canvas of their
 * own on top (see [TokenLayer]), because they move every frame and the tiles
 * should not have to.
 *
 * Everything written or drawn on a tile is iOS's TileView, mark for mark:
 * the same words, the same glyphs, the same order, sized in iOS points and
 * scaled by the board (see [BoardGeometry.pt]).
 */
@Composable
fun BoardView(
    store: GameStore,
    modifier: Modifier = Modifier,
    // What sits in the middle of the ring, over the felt — iOS's BoardView
    // takes it the same way. A phone gets the dice and the line saying what
    // the table is waiting for; a tablet's tabletop puts the whole dock in
    // there, where everybody sitting round it can reach. The screen decides;
    // the board only knows where the hole is.
    center: @Composable (Modifier) -> Unit = { CenterWell(store, it) },
    onTapTile: (Int) -> Unit = {},
) {
    val p = P.current
    val state = store.state ?: return
    // A tile sets two to four runs of type, so one pass over the board is a
    // hundred-odd layouts. The default cache holds eight, which re-laid every
    // one of them on every frame of the deal and every beat of a set flash.
    val measurer = rememberTextMeasurer(cacheSize = 160)
    val walker = remember { TokenWalker() }
    val deck = LocalDeckIntro.current

    // A country just closed: every tile in it floods with the owner's colour
    // and breathes back, three times, ~3.3s — iOS's celebrateSet, on the same
    // curves and the same clock. One pulse per country, on a scope of the
    // board's own rather than the effect's, so a second set closing
    // mid-flash starts its own pulses instead of cutting the first one short.
    val pulses = remember { mutableStateMapOf<String, Animatable<Float, AnimationVector1D>>() }
    // The owner's band widening from 5pt to 9pt as the set closes, on iOS's
    // spring(duration: 0.4): critically damped, a stiffness of (2π / 0.4)².
    // Held only while it moves; a band at rest is read off the ownership.
    val bands = remember { mutableStateMapOf<String, Animatable<Float, AnimationVector1D>>() }
    val pulseScope = rememberCoroutineScope()
    val flash = store.setFlash
    LaunchedEffect(flash?.seq) {
        val fresh = flash ?: return@LaunchedEffect
        for (group in fresh.groups) {
            val band = Animatable(5f)
            bands[group] = band
            pulseScope.launch {
                band.animateTo(9f, spring(dampingRatio = 1f, stiffness = 247f))
                if (bands[group] === band) bands.remove(group)
            }
            val pulse = Animatable(0f)
            pulses[group] = pulse
            pulseScope.launch {
                repeat(3) {
                    pulse.animateTo(FLASH_PEAK, tween(400, easing = EaseIn))
                    delay(50)
                    pulse.animateTo(0f, tween(550, easing = EaseOut))
                    delay(100)
                }
                if (pulses[group] === pulse) pulses.remove(group)
            }
        }
    }

    // Where each piece is standing ON SCREEN, which is not always where the
    // server says it ended up: one push can carry a roll, the card the tile it
    // landed on drew, and wherever that card then sent the piece. Lighting the
    // server's tile lights the card's destination before the card has been
    // read — so the board follows the piece instead.
    //
    // The walks are the store's journeys, performed for as long as the board
    // is up: one long-lived effect, not one keyed on the newest leg, so a
    // double's re-roll queues behind the walk in progress instead of
    // relaunching over it — and each journey plays on the clock the store
    // holds its money to, so the rent lands a beat after the piece does and
    // never before. Every other piece is set down on each push by the cheap
    // effect below, which leaves the walking ones alone; it runs again when a
    // bankruptcy lands, so a fallen piece leaves the board on its release.
    LaunchedEffect(walker) {
        walker.perform(store) { journey -> store.revealCard(near = journey.key) }
    }
    LaunchedEffect(state.version, store.heldBusts) { walker.settle(store) }

    // The light moves a leg at a time, as iOS's TurnSpotlight moves it: it
    // stays on the tile the turn set off from while the piece walks, and
    // lands only when a leg finishes — on the tile that drew a card, then on
    // wherever the card sends it. The legs are followed in order, so a card
    // saying "go back three" does not light its destination as the first leg
    // walks past it on the way to the card. The holder is the tile lit and
    // the next leg to wait for; it is plain rather than state, because it is
    // only ever read in the same pass that writes it.
    val turn = store.currentPlayer
    val legs = state.moves.orEmpty().takeIf { it.firstOrNull()?.playerId == turn?.id }.orEmpty()
    val spotlight = remember(turn?.id, state.moves?.lastOrNull()?.seq) {
        intArrayOf(turn?.let { walker.shown[it.id] ?: it.pos } ?: -1, 0)
    }
    val lit = turn?.let { now ->
        val standing = walker.shown[now.id] ?: now.pos
        if (legs.isEmpty()) {
            if (standing == now.pos) spotlight[0] = standing
        } else {
            while (spotlight[1] < legs.size && standing == legs[spotlight[1]].to) {
                spotlight[0] = standing
                spotlight[1]++
            }
        }
        spotlight[0]
    }?.takeIf { state.isPlaying }

    // The square that fits, as iOS sizes it: the shorter of the two sides
    // it is given, centred in the rest. Sizing off the width alone was a
    // board as tall as a landscape tablet is wide — taller than the screen,
    // with the dock pushed off the bottom of it. Inside a scrolling column
    // there is no height to measure against, so the window's stands in: a
    // board is never taller than the screen it is shown on.
    val window = LocalConfiguration.current.screenHeightDp.dp
    BoxWithConstraints(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        val fits = minOf(maxWidth, if (constraints.hasBoundedHeight) maxHeight else window)
        val side = with(LocalDensity.current) { fits.toPx() }
        val dpPx = LocalDensity.current.density
        val geom = remember(state.map.id, side, dpPx) {
            BoardGeometry(state.map.layout, Size(side, side), maxPt = dpPx)
        }
        // iOS lifts the board off the page on a soft drop shadow — black at
        // 0.22, 16pt soft and 8pt down, and 0.5 on a night table, where a
        // light one would not show at all. Drawn in the board's own Canvas
        // rather than as an elevation: Android multiplies a shadow colour's
        // alpha by the theme's, which left iOS's figures all but invisible.
        val shade = if (p.boardBG.luminance() < 0.5f) 0.5f else 0.22f

        Box(Modifier.size(fits)) {
            Canvas(
                Modifier
                    .fillMaxSize()
                    .pointerInput(state.map.id, side) {
                        detectTapGestures { at ->
                            // Nothing to open while the board is still cards in the deck.
                            if (deck?.deck == DeckIntro.Deck.WAITING) return@detectTapGestures
                            state.map.tiles.firstOrNull { geom.frame(it.index).contains(at) }
                                ?.let { onTapTile(it.index) }
                        }
                    },
            ) {
                // The felt and its hairline go down first and the tiles over
                // them, as iOS layers its board. Nothing clips the ring, so a
                // corner tile keeps its own 6pt rounding at the board's corner
                // rather than being cut to the felt's 18.
                val felt = CornerRadius(18.dp.toPx())
                // Nothing clips the Canvas, so the shadow can spill past the
                // board's edge as iOS's does.
                softShadow(Offset.Zero, size, 18.dp.toPx(), Color.Black, shade, 16.dp.toPx(), 8.dp.toPx())
                drawRoundRect(p.boardBG, cornerRadius = felt)
                drawRoundRect(p.rule2, cornerRadius = felt, style = Stroke(1.dp.toPx()))

                val setter = TileSetter(measurer, geom.pt, density)
                val middle = Offset(size.width / 2f, size.height / 2f)
                for (tile in state.map.tiles) {
                    val pulse = tile.group?.let { pulses[it]?.value } ?: 0f
                    val band = tile.group?.let { bands[it]?.value }
                    // Each tile where the deal has it this frame: held in the
                    // deck, in the air, or home. Read inside the draw, so the
                    // deal's clock repaints the board and nothing recomposes.
                    val frame = geom.frame(tile.index)
                    val pose = deck?.pose(tile.index, frame, middle) ?: TilePose.Settled
                    if (pose.settled) {
                        drawTile(state, tile, geom, p, setter, lit == tile.index, pulse, band)
                    } else if (pose.alpha > 0f) {
                        dealt(pose, frame) { drawTile(state, tile, geom, p, setter, lit == tile.index, pulse, band) }
                    }
                }
            }

            // The middle, over the felt. A board with an empty middle reads
            // as one that has not loaded.
            val well = geom.centerWell
            val inWell = with(LocalDensity.current) {
                Modifier
                    .padding(start = well.left.toDp(), top = well.top.toDp())
                    .size(well.width.toDp(), well.height.toDp())
            }
            center(inWell)
            // Over the well, as iOS stacks its TokenLayer — a piece pushed in
            // off a corner stands on top of the dice, not under them. The
            // pieces are up the moment the game is playing, standing at START
            // over the felt while the tiles fly in, as on iOS: nothing there
            // waits for the deal.
            TokenLayer(store, state, walker, geom, modifier = Modifier.fillMaxSize())
            // The kick-off deck sits on the well the tiles fly out of — on
            // the board, as iOS overlays it, not the middle of the screen.
            deck?.let { DeckIntroOverlay(it, inWell) }
        }
    }
}

/**
 * One tile partway through the deal: moved toward the deck, tilted and shrunk
 * about its own centre, and faded, as iOS's TileView offsets, rotates, scales
 * and fades each one. The fade goes through a layer because a tile is several
 * shapes, and fading each on its own would show them through one another.
 */
private inline fun DrawScope.dealt(pose: TilePose, frame: Rect, draw: DrawScope.() -> Unit) {
    withTransform({
        translate(pose.dx, pose.dy)
        rotate(pose.rotation, pivot = frame.center)
        scale(pose.scale, pose.scale, pivot = frame.center)
    }) {
        if (pose.alpha >= 1f) {
            draw()
        } else {
            drawIntoCanvas { it.saveLayer(frame.inflate(frame.width), Paint().apply { alpha = pose.alpha }) }
            draw()
            drawIntoCanvas { it.restore() }
        }
    }
}

/** How far the set-complete flood rises over a tile — iOS's 0.88. */
private const val FLASH_PEAK = 0.88f

/** The airline blue iOS paints its plane in — the colour the web tile uses too. */
private val AIRLINE_BLUE = Color(0xFF3F6FAE)

/**
 * One tile, in iOS's layers: the card, the owner's band, what is written on
 * it, the owner's wash, the set flash, the mortgage, the rim — and the
 * country's coin on top of the lot.
 */
private fun DrawScope.drawTile(
    state: GameState,
    tile: TileData,
    geom: BoardGeometry,
    p: Palette,
    setter: TileSetter,
    lit: Boolean,
    flash: Float = 0f,
    /** The band's width in points while it springs wider, or null at rest. */
    bandPt: Float? = null,
) {
    val r = geom.frame(tile.index)
    if (r.width <= 0f) return
    val pt = geom.pt
    val own = state.owner(tile.index)
    val short = minOf(r.width, r.height)

    val face = when (tile.type) {
        "treasure" -> p.tileTreasure
        "surprise" -> p.tileSurprise
        "tax" -> p.tileTax
        "refund" -> p.tileRefund
        "start" -> p.tileStart
        "prison" -> p.tileJail
        "vacation" -> p.tileVacation
        "gotoprison" -> p.tileGoto
        else -> if (geom.isCorner(tile.index)) p.tileCorner else p.card
    }
    // A card with iOS's 6pt corners, not a cell in a grid: where four tiles
    // meet, the felt shows through in a small diamond, and that is most of
    // what makes the ring read as forty cards laid on a table.
    val round = CornerRadius(6f * pt)

    // The turn's tile glows gold round its edge, the way iOS shadows it in
    // gold — outside the card, so the card itself stays readable. Drawn
    // before the card, like a shadow is, so only the halo shows.
    if (lit) softShadow(r.topLeft, r.size, 6f * pt, p.gold, 0.5f, 6f * pt, 0f)

    drawRoundRect(face, topLeft = r.topLeft, size = r.size, cornerRadius = round)

    // The richup rule, and the one thing that made this board read wrong: a
    // bought tile wears its OWNER'S colour, not its country's. The medallion
    // already says which country a street belongs to, so an unowned tile
    // stays clean — a band on every street from the first frame is a board
    // that looks as though somebody already owns all of it.
    val group = tile.group?.let { state.groups[it] }
    // Only an owner who is at the table colours the tile, as iOS draws the
    // band, the wash and the flash only once it has found the player: a
    // record naming somebody who has left paints nothing, rather than grey.
    val ownerColour = own?.let { state.player(it.owner) }?.let { cssColor(it.color, p.ink3) }
    val whole = ownerColour != null && tile.group?.let { key ->
        val idxs = state.map.groups?.get(key).orEmpty()
        idxs.isNotEmpty() && idxs.all { state.owner(it)?.owner == own?.owner }
    } == true

    // iOS's 5pt band, 9pt for a whole country — the only visual difference
    // between "owns a street here" and "charges double" — cut to the card's
    // rounded corners.
    val thickness = (bandPt ?: if (whole) 9f else 5f) * pt
    if (ownerColour != null) {
        val band = when (geom.side(tile.index)) {
            BoardGeometry.Side.TOP -> Rect(r.left, r.bottom - thickness, r.right, r.bottom)
            BoardGeometry.Side.BOTTOM -> Rect(r.left, r.top, r.right, r.top + thickness)
            BoardGeometry.Side.LEFT -> Rect(r.right - thickness, r.top, r.right, r.bottom)
            BoardGeometry.Side.RIGHT -> Rect(r.left, r.top, r.left + thickness, r.bottom)
        }
        clipPath(Path().apply { addRoundRect(RoundRect(r, round)) }) {
            drawRect(ownerColour, topLeft = band.topLeft, size = band.size)
        }
    }

    drawWords(state, tile, own, geom, r, p, setter, face)

    if (ownerColour != null) {
        // The owner's wash goes OVER the words, as iOS lays it, so a glance at
        // the ring says who holds what without reading a single pip.
        drawRoundRect(ownerColour, topLeft = r.topLeft, size = r.size, cornerRadius = round,
            alpha = if (whole) 0.30f else 0.18f)
        // The set-complete flood, over the name and the buildings: for a
        // beat the whole country is simply the owner's colour. Only an owned
        // tile can flash — it is the owner's moment.
        if (flash > 0f) {
            drawRoundRect(ownerColour, topLeft = r.topLeft, size = r.size, cornerRadius = round, alpha = flash)
        }
    }

    // Mortgaged: iOS's bank in white on a dim wash the size of the tile —
    // white, because the tile underneath can be any colour.
    if (own?.isMortgaged == true) {
        drawRect(Color.Black, topLeft = r.topLeft, size = r.size, alpha = 0.25f)
        val bank = setter.glyph("bank", 13f, Color.White)
        bank.paint(this, Offset(r.center.x - bank.w / 2f, r.center.y - bank.h / 2f))
    }

    // The rim: a hairline, or the gold of the turn's tile.
    drawRoundRect(if (lit) p.gold else p.rule, topLeft = r.topLeft, size = r.size, cornerRadius = round,
        style = Stroke(width = if (lit) 2f * pt else 0.7f * pt))

    // The country's medallion, worn richup-style: centred on the inner edge,
    // half on the tile and half over the board. It stays there once building
    // starts — the houses live in the tile's body, so the street keeps its
    // nationality while it grows, as it does on iOS.
    if (tile.type == "property") {
        // iOS's coin: half the tile's short side, never under 13pt or over
        // 21pt — so Blitz's chunky tiles do not wear a dinner plate.
        val medal = minOf(21f, maxOf(13f, short / pt * 0.5f)) / 2f * pt
        val badge = when (geom.side(tile.index)) {
            BoardGeometry.Side.TOP -> Offset(r.center.x, r.bottom)
            BoardGeometry.Side.BOTTOM -> Offset(r.center.x, r.top)
            BoardGeometry.Side.LEFT -> Offset(r.right, r.center.y)
            BoardGeometry.Side.RIGHT -> Offset(r.left, r.center.y)
        }
        with(Art) {
            drawMedallion(
                group?.flag, group?.let { cssColor(it.color, p.ink3) } ?: p.ink3, badge, medal,
                wash = p.sunken, measurer = setter.measurer,
            )
        }
    }
}

/**
 * What is written and drawn on a tile, top to bottom — iOS's TileView content,
 * case by case: one centred column with 1pt between its rows and 2pt clear
 * of the edges, every size in iOS's points.
 *
 * The column has the whole tile, as iOS's VStack does: it is centred in the
 * tile less its 2pt padding, and the owner's band and the country's coin lie
 * over it rather than taking room from it. Taking their room first starved a
 * built street of height — its name fell to the floor size and the "3×"
 * beside the house shrank — where the iPhone beside it barely shrinks.
 */
private fun DrawScope.drawWords(
    state: GameState,
    tile: TileData,
    own: TileOwnership?,
    geom: BoardGeometry,
    r: Rect,
    p: Palette,
    setter: TileSetter,
    face: Color,
) {
    val pt = geom.pt
    val side = geom.side(tile.index)
    val across = side == BoardGeometry.Side.LEFT || side == BoardGeometry.Side.RIGHT
    val pad = 2f * pt
    val maxW = r.width - 2f * pad
    val maxH = r.height - 2f * pad
    val nameMaxW = maxW.toInt().coerceAtLeast(1)
    val gap = 1f * pt

    // [s] shrinks every run of type at once, the way SwiftUI's
    // minimumScaleFactor gives a column that is too tall for its tile —
    // a street with houses on a side tile is the one that needs it.
    fun stack(s: Float, nameLines: Int): List<TileLine> = buildList<TileLine> {
        fun name() = add(setter.name(tile.name, nameMaxW, s, nameLines, p.ink))
        fun price(value: Int) {
            setter.words(setter.line("${value}\$", 8.5f, FontWeight.Bold, p.ink2, maxW, 0.6f, s))?.let { add(it) }
        }
        when (tile.type) {
            "property" -> {
                // The flag left the face for the medallion on the inner edge,
                // so the name leads the card.
                name()
                own?.houseCount?.takeIf { it > 0 }?.let { add(setter.buildings(it, maxW, p, if (across) 1 else 2)) }
                // The price never leaves — the buildings stack above it.
                tile.price?.let { price(it) }
            }
            "airport" -> {
                // The airliner in flight, nose to the right, as Apple draws
                // it; the web's plane climbs straight up the tile.
                add(setter.glyph("plane", 12f, AIRLINE_BLUE, turn = 90f))
                name()
                tile.price?.let { price(it) }
            }
            "utility" -> {
                // Water, oil, sun or wind, read off the server's mark. The
                // sun, the flame and the drop are Apple's single-colour
                // symbols on iOS, so they are drawn in one colour here too.
                val mark = utilityGlyph(tile.icon)
                val mono = SF_MONO[mark]
                add(if (mono != null) setter.mono(mark, 12f, mono) else setter.glyph(mark, 12f, p.ink))
                name()
                tile.price?.let { price(it) }
            }
            "treasure" -> add(setter.glyph("toolbox", 18f, p.ink))
            "surprise" -> add(setter.knockout("question", 18f, p.red, face))
            "tax" -> {
                // The one special tile with a number worth reading before you
                // land on it: what it will cost. The dollar leads here, as
                // iOS writes it, where a deed's price carries it behind.
                add(setter.glyph("payment", 15f, p.ink))
                val cost = tile.amount?.let { "\$$it" } ?: "${tile.percent ?: 10}%"
                setter.words(setter.line(cost, 7f, FontWeight.Bold, p.ink2, maxW, 0.6f, s))?.let { add(it) }
            }
            "refund" -> {
                add(setter.glyph("cash", 15f, p.ink))
                tile.amount?.let { price(it) }
            }
            "start" -> {
                add(setter.play(16f, p.good))
                setter.words(setter.line("START", 9.5f, FontWeight.ExtraBold, p.good, maxW, 0.6f, s))?.let { add(it) }
            }
            "prison" -> {
                // Jail, drawn as the cap rather than the cell — the cell is the tile.
                add(setter.glyph("police", 21f, p.ink))
                setter.words(setter.line("PRISON", 8.5f, FontWeight.ExtraBold, p.ink3, maxW, 0.6f, s))?.let { add(it) }
            }
            "vacation" -> {
                add(setter.glyph("island", 21f, p.ink))
                // What is waiting there, on the tile that pays it out.
                val pot = state.vacationPot ?: 0
                if (state.settings.vacationCash == true && pot > 0) {
                    setter.words(setter.line(money(pot), 8.5f, FontWeight.Black, p.good, maxW, 0.7f, s))?.let { add(it) }
                }
            }
            // The sentence, not the cell — the cell is the prison corner, and
            // two police caps on one board would read as the same tile.
            "gotoprison" -> add(setter.glyph("gavel", 20f, p.bad))
        }
    }

    fun heightOf(rows: List<TileLine>): Float =
        rows.sumOf { it.h.toDouble() }.toFloat() + gap * (rows.size - 1).coerceAtLeast(0)

    var rows = stack(1f, 2)
    var total = heightOf(rows)
    if (total > maxH) {
        val words = rows.filter { it.words }.sumOf { it.h.toDouble() }.toFloat()
        if (words > 0f) {
            val s = ((maxH - (total - words)) / words).coerceIn(0.6f, 1f)
            rows = stack(s, 2)
            total = heightOf(rows)
            // Still too tall: the name gives up its second line before the
            // column leaves the tile. A column a hair into its 2pt margin is
            // still on the tile, and worth that more than a clipped name.
            if (total > maxH + pad) {
                rows = stack(s, 1)
                total = heightOf(rows)
            }
        }
    }

    var y = r.center.y - total / 2f
    for (row in rows) {
        row.paint(this, Offset(r.center.x - row.w / 2f, y))
        y += row.h + gap
    }
}

/** One row of a tile's column: its size, and how to draw it from its top-left. */
private class TileLine(
    val w: Float,
    val h: Float,
    /** Type rather than a drawing — the rows that shrink when the column is too tall. */
    val words: Boolean = false,
    val paint: DrawScope.(Offset) -> Unit,
)

/**
 * Sets the type and the marks on a tile the way iOS sets them: sizes in iOS
 * points, turned into pixels by the board's own scale.
 *
 * The phone's font-size setting is left out on purpose. iOS draws the board
 * in fixed sizes (`.system(size:)`, which Dynamic Type does not touch), so a
 * larger system font here would only make words overflow tiles that the
 * iPhone beside it fits — and every name on the board is already shrunk to
 * its tile before it is drawn.
 */
private class TileSetter(val measurer: TextMeasurer, val pt: Float, density: Float) {
    private val fixed = Density(density, 1f)

    private fun sp(points: Float) = (points * pt / fixed.density).sp

    fun style(
        points: Float,
        weight: FontWeight,
        colour: Color,
        tracking: Float = 0f,
        align: TextAlign = TextAlign.Start,
        leading: Float = 0f,
    ) = TextStyle(
        color = colour,
        fontSize = sp(points),
        fontWeight = weight,
        letterSpacing = if (tracking != 0f) sp(tracking) else TextUnit.Unspecified,
        textAlign = align,
        lineHeight = if (leading != 0f) sp(points * leading) else TextUnit.Unspecified,
    )

    fun measure(
        text: String,
        style: TextStyle,
        maxWidth: Int = Constraints.Infinity,
        maxLines: Int = 1,
    ): TextLayoutResult = measurer.measure(
        text = text,
        style = style,
        overflow = TextOverflow.Ellipsis,
        maxLines = maxLines,
        constraints = Constraints(maxWidth = maxWidth.coerceAtLeast(0)),
        density = fixed,
    )

    /**
     * One line at [points], shrinking toward [floor] of that size before it
     * will leave [maxW] — SwiftUI's minimumScaleFactor — and what SwiftUI
     * does after that: cut short with an ellipsis where there is height for
     * one line only, or, given [lines] of room, broken over them wherever it
     * has to, a character at a time if that is what fits, and clipped to the
     * width. Null when one line would not hold even the ellipsis.
     */
    fun line(
        text: String,
        points: Float,
        weight: FontWeight,
        colour: Color,
        maxW: Float,
        floor: Float,
        s: Float = 1f,
        tracking: Float = 0f,
        lines: Int = 1,
    ): TextLayoutResult? {
        if (maxW < 1f && lines == 1) return null
        val start = maxOf(s, floor)
        val whole = measure(text, style(points * start, weight, colour, tracking * start))
        if (whole.size.width <= maxW) return whole
        val fit = maxOf(floor, start * maxW / whole.size.width * 0.97f)
        val shrunk = measure(text, style(points * fit, weight, colour, tracking * fit))
        if (shrunk.size.width <= maxW) return shrunk
        val least = style(points * floor, weight, colour, tracking * floor)
        if (lines > 1) return measure(text, least, maxWidth = maxOf(1, maxW.toInt()), maxLines = lines)
        if (measure("…", least).size.width > maxW) return null
        return measure(text, least, maxWidth = maxW.toInt())
    }

    fun words(layout: TextLayoutResult?): TileLine? = layout?.let { l ->
        TileLine(l.size.width.toFloat(), l.size.height.toFloat(), words = true) { at -> drawText(l, topLeft = at) }
    }

    /**
     * The tiny street name — iOS's 6.8pt, two lines at most, shrinking before
     * it ever breaks a word. A name is wrapped between its words long before
     * it is wrapped inside one, so the thing that actually has to fit across
     * the tile is the longest single word: let that set the size and
     * Salvador stops coming out as "Salvad / or". The floor is iOS's own 0.7;
     * below that a name is better clipped than unreadable.
     */
    fun name(text: String, maxW: Int, s: Float, lines: Int, colour: Color): TileLine {
        val base = 6.8f
        fun styled(points: Float) = style(points, FontWeight.Bold, colour, align = TextAlign.Center, leading = 1.13f)
        val longest = text.split(' ').maxByOrNull { it.length } ?: text
        val wide = measure(longest, styled(base)).size.width
        // The ratio alone lands the word at exactly the width it is allowed,
        // and a glyph's advance is not perfectly linear in its size, so it
        // can come back a fraction over and break anyway — which is how
        // Jerusalem came out as "Jerusale / m" while every other name on the
        // board fitted. The hair of headroom is what makes it land, and one
        // correcting pass catches the rest. Not a loop: this runs for forty
        // tiles every time the board repaints.
        val slack = 0.97f
        var fitted = if (wide > maxW) base * maxW / wide * slack else base
        if (fitted < base) {
            val again = measure(longest, styled(fitted)).size.width
            if (again > maxW) fitted = fitted * maxW / again * slack
        }
        fitted = minOf(fitted, base * s).coerceAtLeast(base * 0.7f)
        val label = measure(text, styled(fitted), maxWidth = maxW, maxLines = lines)
        return TileLine(label.size.width.toFloat(), label.size.height.toFloat(), words = true) { at ->
            drawText(label, topLeft = at)
        }
    }

    /**
     * A glyph in an iOS frame of [points]. Where iOS paints the mark from an
     * SF Symbol the ink is grown to the symbol's (see [APPLE_INK]); the frame,
     * which is what the column lays out, stays iOS's.
     */
    fun glyph(name: String, points: Float, tint: Color, turn: Float = 0f): TileLine {
        val box = points * pt
        val ink = box * (APPLE_INK[name] ?: 1f)
        return TileLine(box, box) { at ->
            val c = Offset(at.x + box / 2f, at.y + box / 2f)
            rotate(turn, pivot = c) {
                translate(c.x - ink / 2f, c.y - ink / 2f) { with(Art) { drawGlyph(name, ink, tint) } }
            }
        }
    }

    /**
     * A glyph as SF Symbols' monochrome rendering paints one: every part of
     * the drawing in the one [colour], at full strength — the flame's pale
     * inner flame and the drop's highlight merge into a single silhouette.
     * Grown to Apple's ink like [glyph].
     */
    fun mono(name: String, points: Float, colour: Color): TileLine {
        val box = points * pt
        val ink = box * (APPLE_INK[name] ?: 1f)
        return TileLine(box, box) { at ->
            translate(at.x + (box - ink) / 2f, at.y + (box - ink) / 2f) { drawMonochrome(name, ink, colour) }
        }
    }

    /** A solid coin with the mark cut out of it — Apple's `.circle.fill`, see [Art.drawKnockout]. */
    fun knockout(name: String, points: Float, disc: Color, hole: Color): TileLine {
        val box = points * pt
        val ink = box * (APPLE_INK[name] ?: 1f)
        return TileLine(box, box) { at ->
            translate(at.x + (box - ink) / 2f, at.y + (box - ink) / 2f) {
                with(Art) { drawKnockout(name, ink, disc, hole) }
            }
        }
    }

    /**
     * iOS's "▶▶" on START, set at [points] in the system font's black weight.
     * Drawn rather than typed: the triangle is a character Android's fonts
     * leave to a fallback, and the fallback is a sharp, thin symbol or, on
     * some phones, an emoji in a blue box. These are the system font's own
     * triangles, measured off it — rounded, 0.66em by 0.64em, 0.83em apart,
     * sitting on a 1.18em line.
     */
    fun play(points: Float, colour: Color): TileLine {
        val em = points * pt
        return TileLine(em * 1.66f, em * 1.18f) { at ->
            for (i in 0..1) {
                drawPlay(Offset(at.x + em * (0.094f + 0.83f * i), at.y + em * 0.328f), em * 0.664f, em * 0.64f, colour)
            }
        }
    }

    /**
     * What is standing on a street: iOS's hotel marquee, or its house chip.
     * [lines] is how many lines the word beside the building may break over
     * when it cannot have one — two on the tall tiles of the top and bottom
     * runs, one on the short tiles of the sides, which is what the height of
     * the column leaves it on iOS.
     */
    fun buildings(count: Int, maxW: Float, p: Palette, lines: Int): TileLine =
        if (count >= 5) hotel(maxW, p, lines) else houses(count, maxW, p, lines)

    /**
     * The hotel gets a marquee, not a fifth house: the hotel in a red capsule
     * with HOTEL beside it. The capsule keeps to the tile and the word gives
     * way — shrinking, then "HO…" on a side tile, and on the narrow tiles of
     * the top and bottom runs broken down to a sliver, which is what iOS
     * draws there too.
     */
    private fun hotel(maxW: Float, p: Palette, lines: Int): TileLine {
        val icon = 12f * pt
        val padX = 6f * pt
        val padY = 2f * pt
        val gap = 3f * pt
        val label = line("HOTEL", 8f, FontWeight.Black, Color.White, maxW - 2f * padX - icon - gap, 0.6f,
            tracking = 0.5f, lines = lines)
        val w = 2f * padX + icon + (label?.let { gap + it.size.width } ?: 0f)
        val h = 2f * padY + maxOf(icon, label?.size?.height?.toFloat() ?: 0f)
        return TileLine(w, h) { at ->
            val chip = Size(w, h)
            val round = CornerRadius(h / 2f)
            softShadow(at, chip, h / 2f, Color.Black, 0.25f, 2f * pt, 1f * pt)
            drawRoundRect(Brush.verticalGradient(listOf(p.red, p.redDeep), at.y, at.y + h),
                topLeft = at, size = chip, cornerRadius = round)
            drawRoundRect(Color.White, topLeft = at, size = chip, cornerRadius = round,
                alpha = 0.55f, style = Stroke(1f * pt))
            translate(at.x + padX, at.y + (h - icon) / 2f) { with(Art) { drawGlyph("hotel", icon, Color.White) } }
            label?.let { drawText(it, topLeft = Offset(at.x + padX + icon + gap, at.y + (h - it.size.height) / 2f)) }
        }
    }

    /**
     * The house count as one clean chip, in the card's own cloth: the house,
     * and "3×" beside it once there is more than one. On the narrow tiles of
     * the top and bottom runs there is no width left for "3×", and iOS
     * stands the count on end instead — "3" over "×", the chip grown tall to
     * hold it — so this does too.
     */
    private fun houses(count: Int, maxW: Float, p: Palette, lines: Int): TileLine {
        val icon = 13f * pt
        val padX = 5f * pt
        val padY = 1.5f * pt
        val gap = 2.5f * pt
        val label = if (count > 1) {
            line("$count×", 10.5f, FontWeight.Black, p.good, maxW - 2f * padX - icon - gap, 0.6f, lines = lines)
        } else null
        val w = 2f * padX + icon + (label?.let { gap + it.size.width } ?: 0f)
        val h = 2f * padY + maxOf(icon, label?.size?.height?.toFloat() ?: 0f)
        return TileLine(w, h) { at ->
            val chip = Size(w, h)
            val round = CornerRadius(h / 2f)
            softShadow(at, chip, h / 2f, Color.Black, 0.18f, 1.5f * pt, 1f * pt)
            drawRoundRect(p.card, topLeft = at, size = chip, cornerRadius = round)
            drawRoundRect(p.rule, topLeft = at, size = chip, cornerRadius = round, style = Stroke(1f * pt))
            translate(at.x + padX, at.y + (h - icon) / 2f) { with(Art) { drawGlyph("house", icon, p.good) } }
            label?.let { drawText(it, topLeft = Offset(at.x + padX + icon + gap, at.y + (h - it.size.height) / 2f)) }
        }
    }
}

/**
 * How much bigger Apple's own symbol draws than the web glyph standing in for
 * it, in the same frame. iOS paints these from SF Symbols — the airliner, the
 * bank's columns, the circled question mark, and four of the utility marks —
 * and a symbol's ink runs to the edge of its frame and past it, where the web
 * art keeps a margin inside its 32-unit grid. Measured off the symbols at the
 * weight and size iOS draws them (semibold, at 0.86 of the frame).
 */
private val APPLE_INK = mapOf(
    "plane" to 1.25f,
    "bank" to 1.2f,
    "question" to 1.16f,
    "bolt" to 1.22f,
    "sun" to 1.16f,
    "droplet" to 1.26f,
    "flame" to 1.3f,
)

/**
 * The colours iOS gives the three utility marks it draws from SF Symbols
 * (Art.swift's inherentColour): sun.max.fill, flame.fill and drop.fill, each
 * one solid colour. The bolt already matches, and the turbine is drawn by
 * hand on iOS too, so both keep their own art.
 */
private val SF_MONO = mapOf(
    "sun" to Color(0xFFF5C542),
    "flame" to Color(0xFFFB923C),
    "droplet" to Color(0xFF5CC9F5),
)

private val monoPaths = HashMap<String, List<Pair<GlyphPart, Path>>>()

/** Every part of a glyph in one colour, at full strength, in a square of [size]. */
private fun DrawScope.drawMonochrome(name: String, size: Float, colour: Color) {
    val parts = monoPaths.getOrPut(name) {
        Art.shapesOf(name).map { part ->
            part to PathParser().parsePathString(part.d).toPath().apply {
                fillType = if (part.evenOdd) PathFillType.EvenOdd else PathFillType.NonZero
            }
        }
    }
    val k = size / Art.GRID
    scale(k, k, pivot = Offset.Zero) {
        for ((part, path) in parts) {
            if (part.fill != null) drawPath(path, colour)
            if (part.stroke != null) {
                drawPath(
                    path, colour,
                    style = Stroke(
                        width = part.strokeWidth,
                        cap = when (part.cap) { 1 -> StrokeCap.Round; 2 -> StrokeCap.Square; else -> StrokeCap.Butt },
                        join = when (part.join) { 1 -> StrokeJoin.Round; 2 -> StrokeJoin.Bevel; else -> StrokeJoin.Miter },
                    ),
                )
            }
        }
    }
}

/**
 * One of START's triangles, filling the box at [o] of [w] by [h] and
 * pointing right, its corners rounded as the system font rounds them. The
 * triangle is drawn a corner-radius smaller all round and then stroked back
 * out with round joins, which is the whole trick of a rounded triangle.
 */
private fun DrawScope.drawPlay(o: Offset, w: Float, h: Float, colour: Color) {
    val corner = h * 0.11f
    // The incircle's radius and centre: shrinking about the incentre moves
    // every edge in by the same distance.
    val inner = w * h / (h + 2f * hypot(w, h / 2f))
    val f = (1f - corner / inner).coerceAtLeast(0.2f)
    val ic = Offset(o.x + inner, o.y + h / 2f)
    fun at(x: Float, y: Float) = Offset(ic.x + (x - ic.x) * f, ic.y + (y - ic.y) * f)
    val a = at(o.x, o.y)
    val b = at(o.x, o.y + h)
    val c = at(o.x + w, o.y + h / 2f)
    val path = Path().apply {
        moveTo(a.x, a.y)
        lineTo(b.x, b.y)
        lineTo(c.x, c.y)
        close()
    }
    drawPath(path, colour)
    drawPath(path, colour, style = Stroke(width = 2f * corner, join = StrokeJoin.Round))
}

/**
 * SwiftUI's `.shadow(color:radius:y:)`, near enough for a chip or a tile: the
 * shape again, dropped by [dy] and spread over [blur] in a few thin layers.
 * A Canvas has no blur that works on every phone this app ships to — the
 * mask filter needs Android 9 under hardware drawing, the render effect 12.
 */
private fun DrawScope.softShadow(
    topLeft: Offset,
    size: Size,
    radius: Float,
    colour: Color,
    alpha: Float,
    blur: Float,
    dy: Float,
) {
    val layers = 4
    for (i in 1..layers) {
        val spread = blur * i / layers
        drawRoundRect(
            colour,
            topLeft = Offset(topLeft.x - spread, topLeft.y - spread + dy),
            size = Size(size.width + 2f * spread, size.height + 2f * spread),
            cornerRadius = CornerRadius(radius + spread),
            alpha = alpha / layers,
        )
    }
}

// MARK: - the pieces

/** A piece on the board, and where it is gliding. */
private class PlacedPiece(
    val player: PlayerState,
    val spot: Animatable<Offset, AnimationVector2D>,
    /** This device's own piece — on a pass & play table, any of its seats. */
    val mine: Boolean,
)

/**
 * iOS's step from tile to tile: `.spring(duration: 0.26, bounce: 0.42)`,
 * which is a damping ratio of 1 − 0.42 and a stiffness of (2π / 0.26)².
 */
private val PIECE_STEP = spring<Offset>(dampingRatio = 0.58f, stiffness = 584f)

/**
 * The board draws outside any palette (the felt is its own thing), so your
 * own piece's mark carries the app's gold directly, as iOS's does.
 */
private val MARK_GOLD = Color(0xFFE3B24A)

/**
 * The pieces, over the middle of the table as iOS's TokenLayer sits over its
 * centre well. A layer of its own because a piece breathes and hops on its
 * turn and springs from tile to tile: forty tiles of type repainting sixty
 * times a second for the sake of one disc is the stutter the board's single
 * Canvas exists to avoid.
 */
@Composable
private fun TokenLayer(
    store: GameStore,
    state: GameState,
    walker: TokenWalker,
    geom: BoardGeometry,
    modifier: Modifier = Modifier,
) {
    // Only a table in play has pieces on it; a lobby shows the board bare.
    if (!state.isPlaying && !state.isEnded) return
    val measurer = rememberTextMeasurer(cacheSize = 16)
    // The seats as shown: a piece whose bankruptcy is still waiting on its
    // walk finishes that walk before it leaves the board.
    val alive = store.shownPlayers.filter { !it.isBankrupt }
    val breathe = rememberInfiniteTransition(label = "piece")
    val pulse = breathe.animateFloat(
        0f, 1f, infiniteRepeatable(tween(900, easing = EaseInOut), RepeatMode.Reverse), label = "pulse",
    )
    val hop = breathe.animateFloat(
        0f, 1f, infiniteRepeatable(tween(420, easing = EaseInOut), RepeatMode.Reverse, StartOffset(350)), label = "hop",
    )
    val placed = alive.mapNotNull { player ->
        val target = tokenSpot(player, alive, walker, geom) ?: return@mapNotNull null
        key(player.id) {
            // A new board size is a new place to stand, not a journey: the
            // piece is set down there rather than sprung across the table.
            val spot = remember(geom) { Animatable(target, Offset.VectorConverter) }
            LaunchedEffect(spot, target) { spot.animateTo(target, PIECE_STEP) }
            PlacedPiece(player, spot, store.isLocal(player.id))
        }
    }
    val turnId = state.turn?.playerId
    Canvas(modifier) {
        val fixed = Density(density, 1f)
        // Whoever's turn it is stands on top of anyone sharing the tile.
        for (piece in placed.sortedBy { it.player.id == turnId }) {
            drawPiece(piece, piece.player.id == turnId, pulse.value, hop.value, geom.pt, measurer, fixed)
        }
    }
}

/**
 * Where a piece stands on its tile, as iOS stands it: pushed from the tile's
 * middle toward the middle of the board — clear of the name and the price,
 * over the flag medallion, the way a piece sits on a coin — and further in
 * on a corner, which holds big art and a word. Pieces sharing a tile spread
 * over the same eight slots iOS uses.
 */
private fun tokenSpot(
    player: PlayerState,
    alive: List<PlayerState>,
    walker: TokenWalker,
    geom: BoardGeometry,
): Offset? {
    val at = walker.shown[player.id] ?: player.pos
    val frame = geom.frame(at)
    if (frame.width <= 0f) return null
    val cohort = alive.filter { (walker.shown[it.id] ?: it.pos) == at }
    val slot = if (cohort.size > 1) {
        SLOTS[cohort.indexOfFirst { it.id == player.id }.coerceAtLeast(0) % SLOTS.size]
    } else 0f to 0f
    val middle = Offset(geom.size.width / 2f, geom.size.height / 2f)
    val v = middle - frame.center
    val len = maxOf(geom.pt, v.getDistance())
    val push = minOf(frame.width, frame.height) * (if (geom.isCorner(at)) 0.58f else 0.42f)
    return Offset(
        frame.center.x + v.x / len * push + slot.first * frame.width * 0.45f,
        frame.center.y + v.y / len * push + slot.second * frame.height * 0.45f,
    )
}

private val SLOTS = listOf(
    -0.20f to -0.18f, 0.20f to -0.18f, -0.20f to 0.18f, 0.20f to 0.18f,
    0f to -0.30f, 0f to 0.30f, -0.34f to 0f, 0.34f to 0f,
)

/**
 * iOS's TokenDisc: a 20pt disc in the player's colour with their initial —
 * or the piece they bought in the store — on a white rim, dropped on a soft
 * shadow.
 *
 * Whose turn it is and which piece is yours are two different things, and
 * on somebody else's turn they are two different pieces. The turn's piece
 * breathes (a slow swell to 1.18 and back) on a heavier rim. Yours wears a
 * quiet ring outside the rim at all times, and on your own turn that ring
 * goes gold, glows, and the disc gives a small hop — eight pieces of one
 * size go round the same loop, and finding yourself among them is the whole
 * job of the ring.
 */
private fun DrawScope.drawPiece(
    piece: PlacedPiece,
    turn: Boolean,
    pulse: Float,
    hop: Float,
    pt: Float,
    measurer: TextMeasurer,
    fixed: Density,
) {
    val r = 10f * pt
    val lift = if (piece.mine && turn) -3f * pt * hop else 0f
    val centre = piece.spot.value + Offset(0f, lift)
    val grow = if (turn) 1f + 0.18f * pulse else 1f
    scale(grow, pivot = centre) {
        // iOS's black shadow at 0.45, 3pt soft and 2pt down, in layers.
        val drop = centre + Offset(0f, 2f * pt)
        for (i in 0..3) {
            drawCircle(Color.Black, radius = r + 3f * pt * i / 3f, center = drop, alpha = 0.45f / 4f)
        }
        drawCircle(cssColor(piece.player.color, Color.Gray), radius = r, center = centre)

        val skin = piece.player.tokenSkin?.takeIf { it.isNotEmpty() }
        val mark = measurer.measure(
            skin ?: initial(piece.player.name),
            TextStyle(
                color = Color.White,
                fontSize = ((if (skin != null) 12.5f else 9.5f) * pt / fixed.density).sp,
                fontWeight = if (skin != null) FontWeight.Normal else FontWeight.Black,
            ),
            density = fixed,
        )
        drawText(mark, topLeft = Offset(centre.x - mark.size.width / 2f, centre.y - mark.size.height / 2f))
        drawCircle(Color.White, radius = r, center = centre, style = Stroke(if (turn) 2f * pt else 1.2f * pt))

        // Your own piece, marked outside the white rim so it reads as a mark
        // on the board rather than a change to the piece.
        if (piece.mine) {
            val ring = (r + (if (turn) 3.5f else 2.5f) * pt) * (if (turn) 1f + 0.1f * pulse else 1f)
            if (turn) {
                drawCircle(MARK_GOLD, radius = ring, center = centre, alpha = 0.18f, style = Stroke(8f * pt))
                drawCircle(MARK_GOLD, radius = ring, center = centre, alpha = 0.3f, style = Stroke(4.5f * pt))
            }
            drawCircle(
                if (turn) MARK_GOLD else Color.White.copy(alpha = 0.62f),
                radius = ring, center = centre,
                style = Stroke(if (turn) 2f * pt else 1.4f * pt),
            )
        }
    }
}

/**
 * The first character of a name as a reader sees it, capitalised — iOS's
 * prefix(1), a grapheme cluster: a flag is both its letters and a thumbs-up
 * keeps its skin tone, where the first code point would be half of either.
 */
private fun initial(name: String): String {
    if (name.isEmpty()) return ""
    val it = java.text.BreakIterator.getCharacterInstance()
    it.setText(name)
    val end = it.next().takeIf { e -> e != java.text.BreakIterator.DONE } ?: name.length
    return name.substring(0, end).uppercase()
}
