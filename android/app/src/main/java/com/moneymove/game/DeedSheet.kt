package com.moneymove.game

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.DrawStyle
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlin.math.cos
import kotlin.math.sin

/**
 * One tile, and everything its owner may do with it — iOS's DeedSheet
 * (DeedSheets.swift), piece for piece.
 *
 * In iOS's order: the title deed itself, then the owner's build / sell /
 * mortgage bar, then the reference numbers, then who holds it. The bar rides
 * directly under the title because on a street you own those buttons are why
 * the sheet was opened — eight rows of rent figures should never be the thing
 * between them and a thumb.
 *
 * It opens at half the screen and pulls up to the rest, as iOS's medium and
 * large detents do: half a phone holds the title and the bar, and the figures
 * are there for whoever drags. The sheet is half a screen even for GO, which
 * has one card to show, because iOS's medium detent is. There is no Close
 * button — iOS draws none; the drag, the back gesture and the scrim close it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeedSheet(store: GameStore, index: Int, onDismiss: () -> Unit) {
    val p = P.current
    val state = store.state ?: return onDismiss()
    val tile = store.tile(index)
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    val half = (LocalConfiguration.current.screenHeightDp * 0.5f).dp

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.sheet,
        dragHandle = null,
    ) {
        Box(Modifier.fillMaxWidth().heightIn(min = half)) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 14.dp)
                    .padding(top = 14.dp, bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (tile == null) {
                    Text(
                        "Unknown tile",
                        modifier = Modifier.fillMaxWidth().padding(top = 26.dp),
                        color = p.ink3,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        textAlign = TextAlign.Center,
                    )
                } else {
                    val own = state.owner(index)
                    DeedHeader(tile, store.groupInfo(tile))

                    // GO, prison, tax, the card tiles: nobody owns them, so
                    // there is nobody to name and nothing to build — they say
                    // what they are and stop.
                    if (tile.isOwnable) Actions(store, index, tile, own)

                    val rows = detailRows(state, tile, own)
                    if (rows.isNotEmpty()) DeedRowsCard(rows)

                    if (tile.isOwnable) OwnerCard(state, own)
                }
            }
            DeedsGrabber(Modifier.align(Alignment.TopCenter))
        }
    }
}

// ── the title deed ─────────────────────────────────────────────────────────

/** Airports and utilities have no country, so they wear their own colours — iOS's. */
private val AIRPORT_BLUE = Color(0xFF5B8DEF)
private val UTILITY_CYAN = Color(0xFF22D3EE)

/**
 * The deed's face: painted in the country's colour (or airport blue, utility
 * cyan), flying the country's flag or the tile's own glyph, the name and,
 * big underneath, the price. A tile nobody can buy sits on the plain sunken
 * card instead, with no price to print.
 */
@Composable
private fun DeedHeader(tile: TileData, group: GroupInfo?) {
    val p = P.current
    val fill: Color
    val coloured: Boolean
    when {
        tile.type == "property" && group != null -> { fill = cssColor(group.color, Color(0xFF888888)); coloured = true }
        tile.type == "airport" -> { fill = AIRPORT_BLUE; coloured = true }
        tile.type == "utility" -> { fill = UTILITY_CYAN; coloured = true }
        else -> { fill = p.sunken; coloured = false }
    }
    val ink = if (coloured) Color.White else p.ink
    val shape = RoundedCornerShape(16.dp)

    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(fill)
            .border(1.dp, if (coloured) Color.White.copy(alpha = 0.18f) else p.rule, shape)
            .padding(vertical = 20.dp, horizontal = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            HeaderBadge(tile, group, ink)
            Text(
                tile.name,
                modifier = Modifier.weight(1f, fill = false),
                color = ink,
                fontSize = 20.sp,
                fontWeight = FontWeight.ExtraBold,
                textAlign = TextAlign.Center,
            )
        }
        tile.price?.let {
            Text(
                money(it),
                color = ink.copy(alpha = if (coloured) 0.95f else 1f),
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

/**
 * What the deed flies beside its name. The header is already painted in the
 * group's colour, so a country with no mark flies its pennant in the header's
 * ink rather than the group colour — a same-coloured pennant on a
 * same-coloured card is no pennant at all.
 */
@Composable
private fun HeaderBadge(tile: TileData, group: GroupInfo?, ink: Color) {
    when (tile.type) {
        "property" -> if (group != null) DeedGroupFlag(group.flag, ink, size = 24.dp)
        // SF's airplane flies nose to the right; the drawn plane climbs
        // straight up the tile, so it is turned a quarter.
        "airport" -> Icon("plane", size = 22.dp, tint = ink, modifier = Modifier.graphicsLayer { rotationZ = 90f })
        // A utility's glyph keeps its own colour — the water is blue on any card.
        "utility" -> Icon(utilityGlyph(tile.icon), size = 22.dp)
    }
}

// ── the country's flag, as iOS flies it on a deed ──────────────────────────

/**
 * A group's mark in the rectangular frame iOS gives it on a deed (Art.swift,
 * GroupFlag): the flag as a little 30×20 panel on the 32 grid, white ground,
 * bands, emblem and a faint edge. The drawn flags in Glyphs.kt are composed
 * for the board's round coin — cantons slid half out of frame — so they
 * cannot simply be cropped square; these are iOS's own panel drawings, carried
 * over coordinate for coordinate.
 *
 * A regional board's pictograph (a castle, a tiger) is shown as the mark
 * itself, as iOS does and as the board's medallion does. No mark at all flies
 * the plain pennant in `colour`.
 */
@Composable
private fun DeedGroupFlag(mark: String, colour: Color, size: Dp) {
    val art = DeedFlags.of(mark)
    when {
        art != null -> DeedFlagCanvas(art, Modifier.size(size))
        mark.isNotBlank() -> Text(mark, fontSize = (size.value * 0.82f).sp)
        else -> GroupPennant(colour, size)
    }
}

@Composable
private fun DeedFlagCanvas(art: DeedFlags.FlagArt, modifier: Modifier) {
    Canvas(modifier) {
        val k = size.minDimension / 32f
        translate((size.width - 32f * k) / 2f, (size.height - 32f * k) / 2f) {
            scale(k, k, pivot = Offset.Zero) { with(art) { draw() } }
        }
    }
}

private object DeedFlags {
    class Band(val colour: Color, val start: Float, val extent: Float)

    class FlagArt(
        val vertical: Boolean = false,
        val bands: List<Band> = emptyList(),
        val motif: DrawScope.() -> Unit = {},
    ) {
        /**
         * In iOS's order: the rounded white panel, the bands over it as plain
         * rectangles (so a full-bleed band squares the corners off, exactly as
         * it does there), the emblem, then the edge.
         */
        fun DrawScope.draw() {
            drawPath(rrect(1f, 6f, 30f, 20f, 2.5f), Color.White)
            for (b in bands) {
                if (vertical) drawRect(b.colour, Offset(b.start, 6f), Size(b.extent, 20f))
                else drawRect(b.colour, Offset(1f, b.start), Size(30f, b.extent))
            }
            motif()
            drawPath(rrect(1f, 6f, 30f, 20f, 2.5f), Color.Black.copy(alpha = 0.22f), style = Stroke(1f))
        }
    }

    fun of(mark: String?): FlagArt? = mark?.replace("\uFE0F", "")?.let { ART[it] }

    private fun c(v: Long) = Color(0xFF000000 or v)

    private fun rrect(x: Float, y: Float, w: Float, h: Float, r: Float) =
        Path().apply { addRoundRect(RoundRect(x, y, x + w, y + h, CornerRadius(r))) }

    private fun poly(vararg pts: Pair<Float, Float>) = Path().apply {
        pts.forEachIndexed { n, (x, y) -> if (n == 0) moveTo(x, y) else lineTo(x, y) }
        close()
    }

    /** Five points, the first straight up — A.star in Art.swift. */
    private fun star(cx: Float, cy: Float, outer: Float, inner: Float) = Path().apply {
        for (i in 0 until 10) {
            val r = if (i % 2 == 0) outer else inner
            val a = Math.toRadians(-90.0 + i * 36.0)
            val x = cx + r * cos(a).toFloat()
            val y = cy + r * sin(a).toFloat()
            if (i == 0) moveTo(x, y) else lineTo(x, y)
        }
        close()
    }

    private fun DrawScope.line(x1: Float, y1: Float, x2: Float, y2: Float, colour: Color, width: Float) =
        drawLine(colour, Offset(x1, y1), Offset(x2, y2), strokeWidth = width)

    private fun DrawScope.dot(cx: Float, cy: Float, r: Float, colour: Color) =
        drawCircle(colour, radius = r, center = Offset(cx, cy))

    /** The regional-indicator pair a flag emoji is made of, from its ISO code. */
    private fun ri(code: String) = code.map { String(Character.toChars(0x1F1E6 + (it - 'A'))) }.joinToString("")

    private val WHITE = Color.White
    private val UNION_RED = c(0xC8102E)

    private val ART: Map<String, FlagArt> = mapOf(
        ri("IN") to FlagArt(bands = listOf(Band(c(0xFF9933), 6f, 6.7f), Band(WHITE, 12.7f, 6.6f), Band(c(0x138808), 19.3f, 6.7f))) {
            drawCircle(c(0x004466), radius = 2.7f, center = Offset(16f, 16f), style = Stroke(1.1f))
        },
        ri("GB") to FlagArt(bands = listOf(Band(c(0x012169), 6f, 20f))) {
            line(1f, 6f, 31f, 26f, WHITE, 4.4f)
            line(31f, 6f, 1f, 26f, WHITE, 4.4f)
            line(1f, 6f, 31f, 26f, UNION_RED, 2f)
            line(31f, 6f, 1f, 26f, UNION_RED, 2f)
            line(16f, 6f, 16f, 26f, WHITE, 6.6f)
            line(1f, 16f, 31f, 16f, WHITE, 6.6f)
            line(16f, 6f, 16f, 26f, UNION_RED, 3.6f)
            line(1f, 16f, 31f, 16f, UNION_RED, 3.6f)
        },
        ri("US") to FlagArt(
            bands = listOf(
                Band(c(0xB31942), 6f, 2.85f), Band(c(0xB31942), 11.7f, 2.85f),
                Band(c(0xB31942), 17.4f, 2.85f), Band(c(0xB31942), 23.1f, 2.9f),
            ),
        ) {
            drawRect(c(0x0A3161), Offset(1f, 6f), Size(13f, 11.4f))
            for ((x, y) in listOf(4.5f to 9f, 8f to 9f, 11.5f to 9f, 6.2f to 12f, 9.8f to 12f, 4.5f to 15f, 8f to 15f, 11.5f to 15f)) {
                dot(x, y, 0.9f, WHITE)
            }
        },
        ri("BR") to FlagArt(bands = listOf(Band(c(0x009C3B), 6f, 20f))) {
            drawPath(poly(16f to 8f, 28.5f to 16f, 16f to 24f, 3.5f to 16f), c(0xFFDF00))
            dot(16f, 16f, 4.4f, c(0x002776))
        },
        ri("DE") to FlagArt(bands = listOf(Band(Color.Black, 6f, 6.7f), Band(c(0xDD0000), 12.7f, 6.6f), Band(c(0xFFCE00), 19.3f, 6.7f))),
        ri("FR") to FlagArt(vertical = true, bands = listOf(Band(c(0x0055A4), 1f, 10f), Band(WHITE, 11f, 10f), Band(c(0xEF4135), 21f, 10f))),
        ri("IT") to FlagArt(vertical = true, bands = listOf(Band(c(0x009246), 1f, 10f), Band(WHITE, 11f, 10f), Band(c(0xCE2B37), 21f, 10f))),
        ri("CN") to FlagArt(bands = listOf(Band(c(0xDE2910), 6f, 20f))) {
            drawPath(star(7.5f, 13.6f, 4.2f, 1.8f), c(0xFFDE00))
            for ((x, y) in listOf(14f to 9.4f, 16.6f to 11.6f, 16.6f to 14.8f, 14f to 17f)) dot(x, y, 1f, c(0xFFDE00))
        },
        ri("JP") to FlagArt {
            dot(16f, 16f, 6f, c(0xBC002D))
        },
        ri("IL") to FlagArt {
            val blue = c(0x0038B8)
            drawRect(blue, Offset(1f, 7.6f), Size(30f, 3f))
            drawRect(blue, Offset(1f, 21.4f), Size(30f, 3f))
            drawPath(poly(16f to 11.4f, 19.4f to 17.3f, 12.6f to 17.3f), blue, style = Stroke(1.1f))
            drawPath(poly(16f to 20.6f, 12.6f to 14.7f, 19.4f to 14.7f), blue, style = Stroke(1.1f))
        },
        ri("CA") to FlagArt(vertical = true, bands = listOf(Band(c(0xD80621), 1f, 8f), Band(c(0xD80621), 23f, 8f))) {
            drawPath(star(16f, 16f, 5.5f, 2.2f), c(0xD80621))
        },
        ri("TR") to FlagArt(bands = listOf(Band(c(0xE30A17), 6f, 20f))) {
            dot(14f, 16f, 5f, WHITE)
            dot(15.8f, 16f, 4f, c(0xE30A17))
            drawPath(star(21f, 16.2f, 3.2f, 1.4f), WHITE)
        },
        ri("RO") to FlagArt(vertical = true, bands = listOf(Band(c(0x002B7F), 1f, 10f), Band(c(0xFCD116), 11f, 10f), Band(c(0xCE1126), 21f, 10f))),
        ri("ES") to FlagArt(bands = listOf(Band(c(0xAA151B), 6f, 5f), Band(c(0xF1BF00), 11f, 10f), Band(c(0xAA151B), 21f, 5f))) {
            drawPath(rrect(7f, 13.4f, 4.6f, 5.2f, 1f), c(0xAA151B).copy(alpha = 0.85f))
        },
        ri("AU") to FlagArt(bands = listOf(Band(c(0x012169), 6f, 20f))) {
            line(1f, 6f, 14f, 15.6f, WHITE, 2.2f)
            line(14f, 6f, 1f, 15.6f, WHITE, 2.2f)
            line(7.5f, 6f, 7.5f, 15.6f, WHITE, 3f)
            line(1f, 10.8f, 14f, 10.8f, WHITE, 3f)
            line(7.5f, 6f, 7.5f, 15.6f, UNION_RED, 1.6f)
            line(1f, 10.8f, 14f, 10.8f, UNION_RED, 1.6f)
            dot(7.5f, 21f, 1.9f, WHITE)
            for ((x, y, r) in listOf(Triple(22f, 11f, 0.9f), Triple(25.5f, 14.5f, 0.9f), Triple(22f, 18.5f, 0.9f), Triple(19f, 15f, 0.9f), Triple(25f, 20.5f, 0.7f))) {
                dot(x, y, r, WHITE)
            }
        },
        ri("IE") to FlagArt(vertical = true, bands = listOf(Band(c(0x169B62), 1f, 10f), Band(WHITE, 11f, 10f), Band(c(0xFF883E), 21f, 10f))),
    )
}

// ── the reference numbers ──────────────────────────────────────────────────

private class DeedRow(val label: String, val value: String, val highlight: Boolean = false)

/**
 * The figures the tile carries, as iOS lists them. For a street: the rent at
 * each step with the step it is on marked, what a building costs and what
 * the bank lends against it — readable by anyone, owner or not. For an
 * airport: what one to four of them charge, with the owner's holding marked.
 * A utility's rent waits for the dice, so it says how many times. A tax says
 * what it takes.
 *
 * The airport and utility figures are rule constants the map never ships;
 * every client has always written them down.
 */
private fun detailRows(state: GameState, tile: TileData, own: TileOwnership?): List<DeedRow> {
    val rows = mutableListOf<DeedRow>()
    when (tile.type) {
        "property" -> {
            val rent = tile.rent.orEmpty()
            // Nothing is marked on a street nobody owns: the bank charges nothing.
            val houses = own?.houseCount
            rent.getOrNull(0)?.let { rows += DeedRow("Base rent", money(it), houses == 0) }
            for (n in 1..4) {
                rent.getOrNull(n)?.let {
                    rows += DeedRow("With $n house${if (n == 1) "" else "s"}", money(it), houses == n)
                }
            }
            rent.getOrNull(5)?.let { rows += DeedRow("With hotel", money(it), houses == 5) }
            tile.houseCost?.let { rows += DeedRow("House / hotel cost", money(it)) }
            tile.mortgageValue?.let { rows += DeedRow("Mortgage value", money(it)) }
        }
        "airport" -> {
            val held = own?.owner?.let { state.ownedOfType(it, "airport") } ?: 0
            for ((k, rent) in TileData.AIRPORT_RENTS.withIndex()) {
                val n = k + 1
                rows += DeedRow("$n airport${if (n == 1) "" else "s"} owned", money(rent), held == n)
            }
        }
        "utility" -> {
            val (one, two) = TileData.UTILITY_MULTIPLIERS
            rows += DeedRow("1 utility owned", "$one × dice")
            rows += DeedRow("2 utilities", "$two × dice")
        }
        "tax" -> {
            val due = tile.amount?.let { money(it) } ?: tile.percent?.let { "$it%" }
            if (due != null) rows += DeedRow("Pay", due)
        }
    }
    return rows
}

@Composable
private fun DeedRowsCard(rows: List<DeedRow>) {
    val p = P.current
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .padding(horizontal = 14.dp, vertical = 3.dp),
    ) {
        for ((k, row) in rows.withIndex()) {
            if (k > 0) Rule()
            Row(Modifier.fillMaxWidth().padding(vertical = 9.dp)) {
                Text(
                    row.label,
                    modifier = Modifier.alignByBaseline().weight(1f),
                    color = if (row.highlight) p.red else p.ink2,
                    fontSize = 13.5.sp,
                    fontWeight = if (row.highlight) FontWeight.Bold else FontWeight.Medium,
                )
                Spacer(Modifier.width(12.dp))
                Text(
                    row.value,
                    modifier = Modifier.alignByBaseline(),
                    color = if (row.highlight) p.red else p.ink,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

/** Who holds it, in their own colour — or the bank. */
@Composable
private fun OwnerCard(state: GameState, own: TileOwnership?) {
    val p = P.current
    val player = own?.let { state.player(it.owner) }
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Owner", color = p.ink2, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.weight(1f))
        if (own != null && player != null) {
            Text(
                player.name + if (own.isMortgaged) " (mortgaged)" else "",
                color = cssColor(player.color, p.ink),
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
            )
        } else {
            Text("Bank", color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
    }
}

// ── what the owner can do ──────────────────────────────────────────────────

/**
 * Whether Build is lit, by iOS's rule (GameStore.swift, canBuild): a seat on
 * this phone owns the street and it is that seat's turn, the whole country is
 * theirs and none of it is mortgaged, there is room for another building, and
 * even-build allows this street next. Money is not asked. The store's own
 * canBuild asks it too, and that greyed Build out on a short purse with no
 * reason printed beside it; iOS leaves the button lit and lets the server
 * answer "not enough money", so this does.
 *
 * The properties list lights its build buttons by the same rule.
 */
internal fun deedBuildLit(store: GameStore, i: Int): Boolean {
    val s = store.state ?: return false
    val t = store.tile(i) ?: return false
    val own = s.owner(i) ?: return false
    if (!store.isLocal(own.owner) || s.turn?.playerId != own.owner) return false
    if (t.type != "property" || own.isMortgaged) return false
    val group = t.group ?: return false
    val idxs = s.map.groups?.get(group) ?: return false
    if (!store.ownsFullGroup(own.owner, group)) return false
    if (idxs.any { s.owner(it)?.isMortgaged == true }) return false
    if (own.houseCount >= 5) return false
    if (s.settings.evenBuild != false) {
        val lowest = idxs.minOfOrNull { s.owner(it)?.houseCount ?: 0 } ?: 0
        if (own.houseCount > lowest) return false
    }
    return true
}

/**
 * The quick build bar, for a deed one of this phone's seats holds. Raising a
 * hotel is four taps in a row, so the buttons stay put and stay live: nothing
 * here dismisses the sheet, and a move the rules refuse greys out instead of
 * disappearing under a thumb. Each action speaks from the owning seat's own
 * connection and buzzes in the store, so a guest's streets work on a guest's
 * turn and every tap is felt.
 *
 * Anyone else's deed shows no bar at all, and nothing in its place: the
 * figures underneath are what a player opening someone else's street reads.
 */
@Composable
private fun Actions(store: GameStore, index: Int, tile: TileData, own: TileOwnership?) {
    if (own == null || !store.isLocal(own.owner)) return
    val state = store.state ?: return
    val houses = own.houseCount
    val houseCost = tile.houseCost ?: 0
    val price = tile.price ?: 0
    val street = tile.type == "property"
    // Build all earns its place only when it would do something Build does
    // not: one more building is one tap either way.
    val sweep = if (street) store.buildAllCount(index) else 0

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            Modifier.fillMaxWidth().height(IntrinsicSize.Min),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (street) {
                QuickButton(
                    DeedSymbol.HAMMER, if (houses == 4) "Hotel" else "Build", money(houseCost),
                    BtnKind.GOOD, deedBuildLit(store, index) && houseCost > 0,
                ) { store.build(index) }
                if (sweep > 1) {
                    QuickButton(DeedSymbol.BUILDINGS, "Build all", "$sweep up", BtnKind.PRIMARY, true) {
                        store.buildAll(index)
                    }
                }
                QuickButton(
                    DeedSymbol.MINUS_CIRCLE, if (houses == 5) "Sell hotel" else "Sell", "+${money(houseCost / 2)}",
                    BtnKind.GHOST, store.canSellHouse(index),
                ) { store.sellHouse(index) }
            }
            if (own.isMortgaged) {
                // Lit whenever the table plays with mortgages, as on iOS: off
                // turn or short of the loan plus ten percent, the server says
                // so rather than the button going dark without a word.
                QuickButton(
                    DeedSymbol.UTURN_CIRCLE, "Unmortgage", money(tile.unmortgageCost ?: 0),
                    BtnKind.PRIMARY, state.settings.mortgage != false && price > 0,
                ) { store.unmortgage(index) }
            } else {
                QuickButton(
                    DeedSymbol.BANKNOTE, "Mortgage", "+${money(price / 2)}",
                    BtnKind.GOLD, store.canMortgage(index),
                ) { store.mortgage(index) }
            }
        }

        if (street) {
            BuildingLine(houses, houseCost)
            buildBlocker(store, index, tile, own)?.let { BlockerLine(it) }
        }
    }
}

/**
 * One button of the bar: symbol, the move, and what it costs or brings in,
 * stacked so four of them fit across a phone. iOS's MMButtonStyle, measured:
 * 14 across and 9 down inside a 10-corner card, the four kinds in their
 * colours with a faint white edge, ghost on the sunken fill with none. A
 * blocked move drops to that ghost at half strength — a saturated green at a
 * third still reads as a live button, and people kept tapping it.
 */
@Composable
private fun RowScope.QuickButton(
    symbol: DeedSymbol,
    caption: String,
    detail: String,
    kind: BtnKind,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val p = P.current
    val shown = if (enabled) kind else BtnKind.GHOST
    val bg = when (shown) {
        BtnKind.PRIMARY -> p.red
        BtnKind.GOLD -> p.gold
        BtnKind.GOOD -> p.good
        BtnKind.DANGER -> p.bad
        BtnKind.GHOST, BtnKind.PLAIN -> p.sunken
    }
    val fg = when (shown) {
        BtnKind.PRIMARY, BtnKind.GOLD -> p.accentInk
        BtnKind.GOOD, BtnKind.DANGER -> Color.White
        else -> p.ink
    }
    val edge = if (shown == BtnKind.GHOST || shown == BtnKind.PLAIN) Color.Transparent else Color.White.copy(alpha = 0.18f)
    val shape = RoundedCornerShape(10.dp)
    Column(
        Modifier
            .weight(1f)
            .fillMaxHeight()
            .alpha(if (enabled) 1f else 0.5f)
            .clip(shape)
            .background(bg)
            .border(1.dp, edge, shape)
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 14.dp, vertical = 9.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterVertically),
    ) {
        DeedSymbolIcon(symbol, size = 19.dp, tint = fg)
        Text(
            caption,
            color = fg,
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            detail,
            modifier = Modifier.alpha(0.85f),
            color = fg,
            fontSize = 10.sp,
            fontWeight = FontWeight.ExtraBold,
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The five marks on the bar. iOS uses Apple's system symbols here — a hammer,
 * two buildings, a minus in a disc, a U-turn in a disc, a banknote — and the
 * drawn set has none of them, so they are redrawn by hand on the same 32 grid
 * in the button's own ink. The discs and the note are solid with their marks
 * cut clean through, the way the `.fill` symbols are, so the button's colour
 * shows through the minus and the arrow.
 */
private enum class DeedSymbol { HAMMER, BUILDINGS, MINUS_CIRCLE, UTURN_CIRCLE, BANKNOTE }

@Composable
private fun DeedSymbolIcon(symbol: DeedSymbol, size: Dp, tint: Color) {
    // Offscreen, so the cut-outs clear to the button underneath rather than
    // to black.
    Canvas(Modifier.size(size).graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }) {
        val k = this.size.minDimension / 32f
        scale(k, k, pivot = Offset.Zero) { drawDeedSymbol(symbol, tint) }
    }
}

private fun DrawScope.drawDeedSymbol(symbol: DeedSymbol, ink: Color) {
    fun cut(path: Path, style: DrawStyle = Fill) =
        drawPath(path, Color.Black, style = style, blendMode = BlendMode.Clear)
    fun rr(x: Float, y: Float, w: Float, h: Float, r: Float) =
        Path().apply { addRoundRect(RoundRect(x, y, x + w, y + h, CornerRadius(r))) }
    val pen = Stroke(width = 2.6f, cap = StrokeCap.Round, join = StrokeJoin.Round)
    val centre = Offset(16f, 16f)

    when (symbol) {
        DeedSymbol.HAMMER -> scale(1.15f, pivot = centre) {
            // The handle, up from the bottom left, and the head square across
            // its top: a claw end up the left, the striking face down the right.
            drawLine(ink, Offset(6f, 26.6f), Offset(18.6f, 14f), strokeWidth = 4.4f, cap = StrokeCap.Round)
            rotate(45f, pivot = Offset(20.4f, 11.6f)) {
                drawRoundRect(ink, Offset(12.4f, 8.1f), Size(15f, 7f), CornerRadius(1.8f))
                drawRoundRect(ink, Offset(24.2f, 7.4f), Size(3.6f, 8.4f), CornerRadius(1f))
            }
        }
        DeedSymbol.BUILDINGS -> {
            // The tall one in front: six windows and a door cut through.
            drawPath(rr(4.5f, 3f, 14f, 26f, 2.4f), ink)
            for (x in listOf(7.6f, 12.4f)) for (y in listOf(6.6f, 11.2f, 15.8f)) cut(rr(x, y, 3f, 3f, 0.6f))
            cut(rr(9.2f, 22.4f, 5.6f, 4.2f, 1.2f))
            // The shorter one beside it, with a strip of windows.
            drawPath(rr(20f, 10f, 8.5f, 19f, 2f), ink)
            for (y in listOf(13.4f, 17.4f, 21.4f)) cut(rr(21.8f, y, 3.2f, 1.8f, 0.6f))
        }
        DeedSymbol.MINUS_CIRCLE -> {
            drawCircle(ink, radius = 13.6f, center = centre)
            cut(rr(9f, 14.6f, 14f, 2.8f, 1.4f))
        }
        DeedSymbol.UTURN_CIRCLE -> {
            drawCircle(ink, radius = 13.6f, center = centre)
            // Out to the right along the top, round, and back along the
            // bottom; the arrowhead points back the way it came.
            cut(
                Path().apply {
                    moveTo(10.6f, 12.6f)
                    lineTo(17.6f, 12.6f)
                    arcTo(Rect(13.2f, 12.6f, 22f, 21.4f), -90f, 180f, false)
                    lineTo(13.6f, 21.4f)
                },
                pen,
            )
            cut(Path().apply { moveTo(14.2f, 9f); lineTo(10.6f, 12.6f); lineTo(14.2f, 16.2f) }, pen)
        }
        DeedSymbol.BANKNOTE -> {
            drawPath(rr(1f, 6.3f, 30f, 19.4f, 2.8f), ink)
            cut(rr(4.2f, 9.5f, 23.6f, 13f, 1f), Stroke(1.6f))
            cut(Path().apply { addOval(Rect(12.6f, 11.2f, 19.4f, 20.8f)) }, Stroke(1.6f))
        }
    }
}

/**
 * What is standing on the street right now, and what the next one costs —
 * the two numbers a repeat-tapper is actually watching. The rent row that
 * moves says the same thing, but only to someone doing the reading.
 */
@Composable
private fun BuildingLine(houses: Int, houseCost: Int) {
    val p = P.current
    val standing = when (houses) {
        5 -> "Hotel standing"
        0 -> "No buildings yet"
        else -> "$houses house${if (houses == 1) "" else "s"}"
    }
    val next = when {
        houses >= 5 -> "fully built"
        houseCost == 0 -> "—"
        else -> "next ${if (houses == 4) "hotel" else "house"} ${money(houseCost)}"
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(p.sunken)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when {
            houses == 5 -> Icon("hotel", size = 14.dp)
            houses > 0 -> Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                repeat(houses) { Icon("house", size = 13.dp) }
            }
            // Nothing standing yet — the crane says building is what this row
            // is for, without pretending a house is already there.
            else -> Icon("crane", size = 14.dp, tint = p.ink3)
        }
        Spacer(Modifier.width(7.dp))
        Text(standing, color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.weight(1f).widthIn(min = 6.dp))
        Text(next, color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * Why Build is greyed out. `mark` is the country's flag, set into the
 * sentence between `lead` and `rest`, since iOS writes the flag in front of
 * the country's name there.
 */
private class DeedBlocker(val lead: String, val mark: String? = null, val rest: String = "")

/**
 * Why Build is greyed out, or null when it is live. A dead button with no
 * explanation is the most common thing a first-timer taps twice and then
 * gives up on.
 *
 * iOS's reasons, in iOS's order and words, and only those: off turn, Build is
 * dark and nothing is said, exactly as there.
 */
private fun buildBlocker(store: GameStore, index: Int, tile: TileData, own: TileOwnership): DeedBlocker? {
    val state = store.state ?: return null
    if (tile.type != "property" || deedBuildLit(store, index)) return null
    if (own.isMortgaged) return DeedBlocker("Unmortgage this street before you can build.")
    if (own.houseCount >= 5) return DeedBlocker("A hotel is as far as this street goes.")
    val group = tile.group ?: return null
    val idxs = state.map.groups?.get(group) ?: return null
    // Counted for the deed's own seat — on a pass & play phone that can be a
    // guest, and the tally has to be THEIR holdings, not the turn's.
    if (!store.ownsFullGroup(own.owner, group)) {
        val held = idxs.count { state.owner(it)?.owner == own.owner }
        val tally = "to build — you hold $held of ${idxs.size}."
        val info = store.groupInfo(tile)
            ?: return DeedBlocker("Own all of this set $tally")
        return DeedBlocker("Own all of ", info.flag.takeIf { it.isNotBlank() }, "${info.name} $tally")
    }
    if (idxs.any { state.owner(it)?.isMortgaged == true }) {
        return DeedBlocker("Nothing can be built while a street in this set is mortgaged.")
    }
    if (state.settings.evenBuild != false) {
        val lowest = idxs.minOfOrNull { state.owner(it)?.houseCount ?: 0 } ?: 0
        if (own.houseCount > lowest) return DeedBlocker("Even build: raise the rest of the set to ${own.houseCount} first.")
    }
    return null
}

/**
 * The reason, in the quiet ink under the bar. A country whose flag is drawn
 * gets the drawing set into the line where iOS types the flag emoji, sized to
 * the text; a regional board's pictograph is written in as the mark it is.
 */
@Composable
private fun BlockerLine(b: DeedBlocker) {
    val p = P.current
    val art = DeedFlags.of(b.mark)
    val text = buildAnnotatedString {
        append(b.lead)
        when {
            art != null -> { appendInlineContent("flag", b.mark ?: ""); append(" ") }
            !b.mark.isNullOrBlank() -> append("${b.mark} ")
        }
        append(b.rest)
    }
    Text(
        text,
        modifier = Modifier.fillMaxWidth(),
        color = p.ink3,
        fontSize = 11.5.sp,
        lineHeight = 15.sp,
        fontWeight = FontWeight.SemiBold,
        inlineContent = if (art == null) emptyMap() else mapOf(
            "flag" to InlineTextContent(Placeholder(1.2.em, 1.2.em, PlaceholderVerticalAlign.TextCenter)) {
                DeedFlagCanvas(art, Modifier.fillMaxSize())
            },
        ),
    )
}
