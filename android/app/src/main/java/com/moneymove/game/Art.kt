package com.moneymove.game

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

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

    /** Path data is parsed once per glyph and kept — sixty-two of them, tiny. */
    private val cache = HashMap<String, List<Pair<GlyphPart, Path>>>()

    private fun parts(name: String): List<Pair<GlyphPart, Path>> = cache.getOrPut(name) {
        (GLYPHS[name] ?: emptyList()).map { part ->
            val path = PathParser().parsePathString(part.d).toPath()
            path.fillType = if (part.evenOdd) PathFillType.EvenOdd else PathFillType.NonZero
            part to path
        }
    }

    fun has(name: String): Boolean = GLYPHS.containsKey(name)

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
    val shapes = remember(name) { GLYPHS[name] ?: emptyList() }
    if (shapes.isEmpty()) return
    Canvas(modifier.size(size)) {
        with(Art) { drawGlyph(name, this@Canvas.size.minDimension, tint, alpha) }
    }
}
