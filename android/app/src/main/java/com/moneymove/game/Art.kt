package com.moneymove.game

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The shared glyph language, Android half.
 *
 * The drawings themselves live in [GLYPHS], generated from the web client's
 * `public/js/icons.js` so the browser, the phone and the tablet paint the
 * same art on the same 32×32 grid. All this file does is turn that data into
 * something a Canvas can draw — and decide, per glyph, whether it takes the
 * caller's colour or keeps its own.
 *
 * Two kinds of glyph, and the difference is the whole reason for the split:
 *
 *  - **ink** — the drawing is ink, and takes the colour it is given. A glyph
 *    on a gold button is gold; the same glyph beside dim text is dim.
 *  - **inherent** — the drawing owns its colour on every table, in both
 *    modes. A coin is gold everywhere, and a bronze medal that took the
 *    theme's ink would just be a third silver one.
 */
object Art {

    /** Path data is parsed once per glyph and kept — sixty-odd of them, tiny. */
    private val cache = HashMap<String, List<Pair<GlyphPart, Path>>>()

    private fun parts(name: String): List<Pair<GlyphPart, Path>> = cache.getOrPut(name) {
        shapesOf(name).map { part ->
            val path = PathParser().parsePathString(part.d).toPath()
            path.fillType = if (part.evenOdd) PathFillType.EvenOdd else PathFillType.NonZero
            part to path
        }
    }

    /** The generated set first; the couple drawn here only fill its gaps. */
    internal fun shapesOf(name: String): List<GlyphPart> =
        GLYPHS[name] ?: DRAWN_HERE[name] ?: emptyList()

    fun has(name: String): Boolean = GLYPHS.containsKey(name) || DRAWN_HERE.containsKey(name)

    /**
     * The two glyphs icons.js has no drawing for, because the web makes do
     * with a stand-in (people for Share, a key for Copy). iOS uses its system
     * symbols — square.and.arrow.up on the table bar, the result sheet and
     * the friend code, doc.on.doc beside it — and Android's own share mark is
     * a different drawing altogether, three joined dots. So these are iOS's
     * two shapes redrawn in this set's own hand: the same 32×32 grid, a pale
     * body and a solid mark, like `door`.
     *
     * Kept out of Glyphs.kt on purpose, since that file is regenerated from
     * icons.js and would drop them. If the web ever grows its own, the
     * generated one wins (see [shapesOf]) and these can go.
     */
    private val DRAWN_HERE: Map<String, List<GlyphPart>> = mapOf(
        "share" to listOf(
            // The tray, pale so the arrow reads over it.
            GlyphPart("M8 12.4h16a2.4 2.4 0 0 1 2.4 2.4v10.8a2.4 2.4 0 0 1-2.4 2.4H8a2.4 2.4 0 0 1-2.4-2.4V14.8A2.4 2.4 0 0 1 8 12.4z", fill = INK, alpha = 0.32f),
            GlyphPart("M16 20.2V4.2", fill = null, stroke = INK, strokeWidth = 2.8f, cap = 1, join = 1),
            GlyphPart("M10.8 9.4 16 4.2l5.2 5.2", fill = null, stroke = INK, strokeWidth = 2.8f, cap = 1, join = 1),
        ),
        "copy" to listOf(
            // The sheet behind, only where the front one does not cover it.
            GlyphPart("M6.4 4h11.2a2.4 2.4 0 0 1 2.4 2.4V8H10v14H6.4A2.4 2.4 0 0 1 4 19.6V6.4A2.4 2.4 0 0 1 6.4 4z", fill = INK, alpha = 0.32f),
            // The sheet in front, with two lines of text cut out of it.
            GlyphPart("M14.4 10h11.2a2.4 2.4 0 0 1 2.4 2.4v13.2a2.4 2.4 0 0 1-2.4 2.4H14.4a2.4 2.4 0 0 1-2.4-2.4V12.4a2.4 2.4 0 0 1 2.4-2.4zM15.8 15.4v2.2h8.4v-2.2zM15.8 20.4v2.2h8.4v-2.2z", fill = INK, evenOdd = true),
        ),
    )

    /** Whether this country's flag is one of the ones actually drawn. */
    fun hasFlag(mark: String?): Boolean = !mark.isNullOrBlank() && FLAGS.containsKey(mark)

    /**
     * A street's country medallion.
     *
     * Three cases, and the middle one is why this is not just a flag drawer.
     *
     * A country whose flag is drawn gets the flag, already composed for a
     * circle rather than cropped out of a rectangle, so this only has to clip.
     *
     * A regional board — every single-country board, where the groups are
     * cities and their marks are castles, tigers and mosques rather than
     * flags — keeps its pictograph, centred on a recessed wash. That is the
     * one place an emoji is drawn on purpose: as a badge that is plainly a
     * badge, rather than a thing pretending to be a flag. Thirteen of the
     * nineteen boards are in this case, so without it most of the game's
     * boards wear a blank disc.
     *
     * No mark at all falls back to the group's colour.
     *
     * The rim is a fixed near-white rather than a palette ink, because it has
     * to read as the same coin rim on a cream board and a midnight one.
     */
    fun DrawScope.drawMedallion(
        mark: String?,
        colour: Color,
        centre: Offset,
        radius: Float,
        wash: Color,
        measurer: TextMeasurer? = null,
    ) {
        val rim = Color(0xFFF7F4EC).copy(alpha = 0.95f)
        val parts = mark?.let { FLAGS[it] }
        if (parts == null) {
            drawCircle(wash, radius = radius, center = centre)
            val pictograph = mark?.replace("\uFE0F", "")?.takeIf { it.isNotBlank() }
            if (pictograph != null && measurer != null) {
                // iOS sets the mark at 0.56 of the disc's DIAMETER \u2014 the same
                // 1.12 of the radius \u2014 but it says that in points. `radius`
                // here is pixels, and `.sp` multiplies by the density again
                // on the way out, so asking for it directly drew a crown
                // nearly three times the coin it sits in, hanging off the
                // tile and over the street's name.
                // Measured at the screen's density with the font scale held
                // at one: iOS's coin ignores Dynamic Type, and a pictograph
                // grown by the phone's font-size setting is just cropped.
                val laid = measurer.measure(
                    pictograph,
                    style = TextStyle(fontSize = (radius * 1.12f / density).sp),
                    density = Density(density, 1f),
                )
                // Clipped to the disc, exactly as iOS clips the whole
                // medallion: a glyph with a long descender is cropped by the
                // coin rather than allowed to leave it.
                clipPath(
                    Path().apply {
                        addOval(Rect(centre - Offset(radius, radius), Size(radius * 2, radius * 2)))
                    },
                ) {
                    drawText(laid, topLeft = Offset(
                        centre.x - laid.size.width / 2f,
                        centre.y - laid.size.height / 2f,
                    ))
                }
            } else if (pictograph == null) {
                drawCircle(colour, radius = radius * 0.62f, center = centre)
            }
        } else {
            // Clip first, then draw the flag over the whole 32×32 grid: the
            // art runs to the edges and the disc is what makes it a coin.
            clipPath(Path().apply { addOval(Rect(centre - Offset(radius, radius), Size(radius * 2, radius * 2))) }) {
                val k = radius * 2 / GRID
                translate(centre.x - radius, centre.y - radius) {
                    scale(k, k, pivot = Offset.Zero) {
                        for (part in parts) {
                            val path = flagPath(mark, part)
                            part.fill?.let { drawPath(path, colourOf(it, colour), alpha = part.alpha, style = Fill) }
                            part.stroke?.let {
                                drawPath(
                                    path, colourOf(it, colour), alpha = part.alpha,
                                    style = Stroke(
                                        width = part.strokeWidth,
                                        cap = capOf(part.cap),
                                        join = joinOf(part.join),
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
        // The rim is what stops a pale flag dissolving into a pale tile.
        drawCircle(rim, radius = radius, center = centre, style = Stroke(width = radius * 0.13f))
    }

    private val flagCache = HashMap<String, Path>()

    private fun flagPath(mark: String, part: GlyphPart): Path =
        flagCache.getOrPut("$mark:${part.d}") {
            PathParser().parsePathString(part.d).toPath().apply {
                fillType = if (part.evenOdd) PathFillType.EvenOdd else PathFillType.NonZero
            }
        }

    /** Whether this glyph keeps a colour of its own whatever it is drawn on. */
    fun isInherent(name: String): Boolean = name in INHERENT_COLOUR

    /**
     * Draws a glyph inside a square of [size], in the current DrawScope.
     * Handy for the board, where a tile draws its own art rather than nesting
     * another composable per tile.
     */
    fun DrawScope.drawGlyph(name: String, size: Float, tint: Color, alpha: Float = 1f) {
        val shapes = parts(name)
        if (shapes.isEmpty()) return
        val k = size / GRID
        scale(k, k, pivot = androidx.compose.ui.geometry.Offset.Zero) {
            for ((part, path) in shapes) {
                part.fill?.let { fill ->
                    drawPath(path, colourOf(fill, tint), alpha = part.alpha * alpha, style = Fill)
                }
                part.stroke?.let { stroke ->
                    drawPath(
                        path, colourOf(stroke, tint), alpha = part.alpha * alpha,
                        style = Stroke(
                            width = part.strokeWidth,
                            cap = capOf(part.cap),
                            join = joinOf(part.join),
                            pathEffect = part.dash?.let { PathEffect.dashPathEffect(it, 0f) },
                        ),
                    )
                }
            }
        }
    }

    /**
     * A glyph drawn the way Apple draws its `.circle.fill` symbols: the pale
     * disc the web art sits on comes out solid in [disc], and the mark is cut
     * out of it — painted in [hole], the colour of whatever the coin sits on,
     * which reads as the same hole.
     *
     * The Surprise tile is why. iOS draws it as `questionmark.circle.fill`
     * in the table's red: a red coin with the tile showing through the
     * question mark. The web glyph tinted red is the opposite picture, a pink
     * wash with a red mark on it, and the two tiles side by side read as two
     * different games.
     */
    fun DrawScope.drawKnockout(name: String, size: Float, disc: Color, hole: Color) {
        val shapes = parts(name)
        if (shapes.isEmpty()) return
        val k = size / GRID
        scale(k, k, pivot = Offset.Zero) {
            shapes.forEachIndexed { i, (part, path) ->
                val ink = if (i == 0) disc else hole
                part.fill?.let { drawPath(path, colourOf(it, ink), style = Fill) }
                part.stroke?.let {
                    drawPath(
                        path, colourOf(it, ink),
                        style = Stroke(width = part.strokeWidth, cap = capOf(part.cap), join = joinOf(part.join)),
                    )
                }
            }
        }
    }

    /** The generator writes colours as 0xAARRGGBB; INK means "use the tint". */
    private fun colourOf(raw: Long, tint: Color): Color =
        if (raw == INK) tint else Color(raw.toInt())

    private fun capOf(v: Int) = when (v) {
        1 -> StrokeCap.Round
        2 -> StrokeCap.Square
        else -> StrokeCap.Butt
    }

    private fun joinOf(v: Int) = when (v) {
        1 -> StrokeJoin.Round
        2 -> StrokeJoin.Bevel
        else -> StrokeJoin.Miter
    }

    /** The grid every glyph is drawn on. */
    const val GRID = 32f
}

/**
 * One glyph, as a composable.
 *
 * `tint` is ignored by an inherent glyph, which is the point of the list: a
 * caller can pass its own ink everywhere and the coin still comes out gold.
 */
@Composable
fun Icon(
    name: String,
    size: Dp = 18.dp,
    tint: Color = P.current.ink,
    alpha: Float = 1f,
    modifier: Modifier = Modifier,
) {
    val shapes = remember(name) { Art.shapesOf(name) }
    if (shapes.isEmpty()) return
    Canvas(modifier.size(size)) {
        with(Art) { drawGlyph(name, this@Canvas.size.minDimension, tint, alpha) }
    }
}
