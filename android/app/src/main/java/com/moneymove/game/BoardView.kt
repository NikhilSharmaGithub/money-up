package com.moneymove.game

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * The board: forty tiles, their deeds, and the pieces standing on them.
 *
 * Drawn as one Canvas rather than forty composables. A board re-renders on
 * every push — thirty-odd times a minute — and a walking piece moves eight
 * times a second; forty recomposing views that each read the store is how a
 * phone starts dropping frames in the middle of somebody's turn.
 */
@Composable
fun BoardView(
    store: GameStore,
    modifier: Modifier = Modifier,
    onTapTile: (Int) -> Unit = {},
) {
    val p = P.current
    val state = store.state ?: return
    val measurer = rememberTextMeasurer()
    val walker = remember { TokenWalker() }

    // Where each piece is standing ON SCREEN, which is not always where the
    // server says it ended up: one push can carry a roll, the card the tile it
    // landed on drew, and wherever that card then sent the piece. Lighting the
    // server's tile lights the card's destination before the card has been
    // read — so the board follows the piece instead.
    LaunchedEffect(state.moves?.lastOrNull()?.seq, state.version) {
        walker.reconcile(state) { store.revealCard() }
    }

    BoxWithConstraints(modifier.fillMaxWidth().aspectRatio(1f)) {
        val side = with(LocalDensity.current) { maxWidth.toPx() }
        val geom = remember(state.map.id, side) {
            BoardGeometry(state.map.layout, Size(side, side))
        }
        val lit = store.currentPlayer?.let { walker.shown[it.id] ?: it.pos }

        Canvas(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(RoundedCornerShape(18.dp))
                .background(p.boardBG)
                .pointerInput(state.map.id) {
                    detectTapGestures { at ->
                        state.map.tiles.firstOrNull { geom.frame(it.index).contains(at) }
                            ?.let { onTapTile(it.index) }
                    }
                },
        ) {
            for (tile in state.map.tiles) {
                drawTile(state, tile, geom, p, measurer, lit == tile.index)
            }
            drawTokens(state, walker, geom, p)
        }

        // The middle, over the felt: the dice and what the table is waiting
        // for. A board with an empty middle reads as one that has not loaded.
        val well = geom.centerWell
        with(LocalDensity.current) {
            CenterWell(
                store,
                Modifier
                    .padding(start = well.left.toDp(), top = well.top.toDp())
                    .size(well.width.toDp(), well.height.toDp()),
            )
        }
    }
}

/** One tile: its face, its colour band, its name, and whatever it owns. */
private fun DrawScope.drawTile(
    state: GameState,
    tile: TileData,
    geom: BoardGeometry,
    p: Palette,
    measurer: TextMeasurer,
    lit: Boolean,
) {
    val r = geom.frame(tile.index)
    if (r.width <= 0f) return
    val own = state.owner(tile.index)

    val face = when (tile.type) {
        "treasure" -> p.tileTreasure
        "surprise" -> p.tileSurprise
        "tax" -> p.tileTax
        "refund" -> p.tileRefund
        "start" -> p.tileStart
        "prison" -> p.tileJail
        "vacation" -> p.tileVacation
        "gotoprison" -> p.tileGoto
        else -> if (r.width >= geom.corner - 0.5f && r.height >= geom.corner - 0.5f) p.tileCorner else p.card
    }
    drawRect(face, topLeft = r.topLeft, size = r.size)
    drawRect(p.rule, topLeft = r.topLeft, size = r.size, style = Stroke(width = 1f))

    // The richup rule, and the one thing that made this board read wrong: a
    // bought tile wears its OWNER'S colour, not its country's. The medallion
    // already says which country a street belongs to, so an unowned tile
    // stays clean — a band on every street from the first frame is a board
    // that looks as though somebody already owns all of it.
    val short = minOf(r.width, r.height)
    val group = tile.group?.let { state.groups[it] }
    val ownerColour = own?.let { cssColor(state.player(it.owner)?.color, p.ink3) }
    val whole = tile.group?.let { key ->
        val idxs = state.map.groups?.get(key).orEmpty()
        own != null && idxs.isNotEmpty() && idxs.all { state.owner(it)?.owner == own.owner }
    } == true

    // Thicker for a whole country, which is the only visual difference
    // between "owns a street here" and "charges double".
    val thickness = if (whole) short * 0.28f else short * 0.16f
    val bandEdge = when (geom.side(tile.index)) {
        BoardGeometry.Side.TOP -> Offset(r.left, r.bottom - thickness) to Size(r.width, thickness)
        BoardGeometry.Side.BOTTOM -> r.topLeft to Size(r.width, thickness)
        BoardGeometry.Side.LEFT -> Offset(r.right - thickness, r.top) to Size(thickness, r.height)
        BoardGeometry.Side.RIGHT -> r.topLeft to Size(thickness, r.height)
    }
    if (ownerColour != null) {
        drawRect(ownerColour, topLeft = bandEdge.first, size = bandEdge.second)
        // A wash over the whole face, so a glance at the ring says who holds
        // what without reading a single pip.
        drawRect(ownerColour, topLeft = r.topLeft, size = r.size,
            alpha = if (whole) 0.30f else 0.18f)
    }

    // The special tiles carry their own drawing rather than their name.
    val glyph = when (tile.type) {
        "treasure" -> "treasure"
        "surprise" -> "surprise"
        "tax" -> "tax"
        "refund" -> "refund"
        "start" -> "start"
        "prison" -> "prison"
        "vacation" -> "vacation"
        "gotoprison" -> "gotoprison"
        "airport" -> "airport"
        "utility" -> "bolt"
        else -> null
    }
    if (glyph != null && Art.has(glyph)) {
        val g = minOf(r.width, r.height) * 0.52f
        translate(r.center.x - g / 2f, r.center.y - g / 2f) {
            with(Art) { drawGlyph(glyph, g, p.ink) }
        }
    } else if (r.width > 10f) {
        // The short side is what a name has to fit across, whichever run the
        // tile is on; sizing off the width alone made every street on the left
        // and right edges wrap in the middle of a word.
        val side = geom.side(tile.index)
        // The name gets the tile MINUS whatever is already on the inner edge,
        // not the whole tile. On the left and right runs that edge carries
        // the band and the half of the medallion that rides onto the tile,
        // and a name centred over the lot comes out printed under a flag.
        val medallion = if (tile.type == "property" && group != null && (own?.houseCount ?: 0) == 0) {
            short * 0.23f
        } else 0f
        val band = maxOf(if (ownerColour != null) thickness else 0f, medallion)
        val room = when (side) {
            BoardGeometry.Side.LEFT, BoardGeometry.Side.RIGHT -> r.width - band
            else -> r.width
        }
        val label = measurer.measure(
            tile.name,
            style = TextStyle(
                color = p.ink2,
                fontSize = (short * 0.30f).coerceIn(6f, 9.5f).sp,
                lineHeight = (short * 0.34f).coerceIn(7f, 11f).sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            ),
            constraints = Constraints(maxWidth = (room * 0.94f).toInt().coerceAtLeast(1)),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        // Centred in the space the band leaves, not in the whole tile.
        val shift = when (side) {
            BoardGeometry.Side.TOP -> Offset(0f, -band / 2f)
            BoardGeometry.Side.BOTTOM -> Offset(0f, band / 2f)
            BoardGeometry.Side.LEFT -> Offset(-band / 2f, 0f)
            BoardGeometry.Side.RIGHT -> Offset(band / 2f, 0f)
        }
        val nameAt = Offset(
            r.center.x - label.size.width / 2f + shift.x,
            r.center.y - label.size.height / 2f + shift.y - (if (tile.price != null) short * 0.10f else 0f),
        )
        drawText(label, topLeft = nameAt)

        // The price never leaves the card. It is the one number a street is
        // read for before anybody owns it, and the buildings stack above it.
        tile.price?.takeIf { it > 0 && short > 20f }?.let { price ->
            val tag = measurer.measure(
                money(price),
                style = TextStyle(
                    color = p.ink3,
                    fontSize = (short * 0.23f).coerceIn(5.5f, 8f).sp,
                    fontWeight = FontWeight.Bold,
                ),
            )
            drawText(tag, topLeft = Offset(
                r.center.x - tag.size.width / 2f + shift.x,
                nameAt.y + label.size.height + short * 0.02f,
            ))
        }
    }

    // What is standing on it. A hotel gets a marquee rather than a sixth dot,
    // because five houses and a hotel are different things and a counter that
    // just keeps climbing says they are the same.
    if (own != null && own.houseCount > 0) {
        val hs = short * 0.21f
        val name = if (own.houseCount >= 5) "hotel" else "house"
        translate(r.center.x - hs / 2f, r.top + short * 0.10f) {
            with(Art) { drawGlyph(name, hs, if (own.houseCount >= 5) p.red else p.good) }
        }
        if (own.houseCount in 2..4) {
            val chip = measurer.measure(
                "${own.houseCount}×",
                style = TextStyle(color = p.good, fontSize = (short * 0.24f).coerceIn(6f, 9f).sp,
                    fontWeight = FontWeight.Black),
            )
            drawText(chip, topLeft = Offset(
                r.center.x + hs * 0.55f, r.top + short * 0.12f,
            ))
        }
    }

    // Mortgaged: the tile underneath can be any colour, so the mark sits on
    // its own dark wash rather than trusting the one below it.
    if (own?.isMortgaged == true) {
        drawRect(Color.Black, topLeft = r.topLeft, size = r.size, alpha = 0.28f)
        val ms = short * 0.28f
        translate(r.center.x - ms / 2f, r.center.y - ms / 2f) {
            with(Art) { drawGlyph("bank", ms, Color.White) }
        }
    }

    // The country's medallion, worn richup-style: centred on the inner edge,
    // half on the tile and half over the board. Houses take the face over
    // once building starts, so the coin steps aside rather than jostle them.
    if (tile.type == "property" && group != null && short > 16f && (own?.houseCount ?: 0) == 0) {
        val medal = short * 0.23f
        val badge = when (geom.side(tile.index)) {
            BoardGeometry.Side.TOP -> Offset(r.center.x, r.bottom)
            BoardGeometry.Side.BOTTOM -> Offset(r.center.x, r.top)
            BoardGeometry.Side.LEFT -> Offset(r.right, r.center.y)
            BoardGeometry.Side.RIGHT -> Offset(r.left, r.center.y)
        }
        with(Art) {
            drawMedallion(group.flag, cssColor(group.color, p.ink3), badge, medal, p.tileCorner)
        }
    }

    // The turn's tile, lit — but only once the piece has actually arrived.
    if (lit) {
        drawRect(p.gold, topLeft = r.topLeft, size = r.size, style = Stroke(width = 2.5f))
        drawRect(p.gold, topLeft = r.topLeft, size = r.size, alpha = 0.10f)
    }
}

/** The pieces, at whatever tile the walker currently has them standing on. */
private fun DrawScope.drawTokens(
    state: GameState,
    walker: TokenWalker,
    geom: BoardGeometry,
    p: Palette,
) {
    val alive = state.players.filter { !it.isBankrupt }
    for (player in alive) {
        val at = walker.shown[player.id] ?: player.pos
        val r = geom.frame(at)
        if (r.width <= 0f) continue
        val cohort = alive.filter { (walker.shown[it.id] ?: it.pos) == at }
        val k = cohort.indexOfFirst { it.id == player.id }.coerceAtLeast(0)
        val (ox, oy) = SLOTS[k % SLOTS.size]
        val unit = minOf(r.width, r.height)
        val centre = Offset(r.center.x + ox * unit, r.center.y + oy * unit)
        // Small enough that four of them on one tile still read as four
        // pieces, and that the street underneath is still legible.
        val radius = unit * 0.19f
        val colour = cssColor(player.color, p.red)

        if (state.turn?.playerId == player.id && state.isPlaying) {
            drawCircle(colour, radius = radius * 1.55f, center = centre, alpha = 0.28f)
        }
        drawCircle(Color.Black, radius = radius * 1.08f, center = centre, alpha = 0.30f)
        drawCircle(colour, radius = radius, center = centre)
    }
}

private val SLOTS = listOf(
    -0.20f to -0.18f, 0.20f to -0.18f, -0.20f to 0.18f, 0.20f to 0.18f,
    0f to -0.30f, 0f to 0.30f, -0.34f to 0f, 0.34f to 0f,
)
