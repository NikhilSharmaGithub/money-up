package com.moneymove.game

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size

/**
 * Where every tile sits on a square board, in pixels.
 *
 * The server's layout names four corners and the four runs between them; this
 * turns that into rectangles. Sides can be any length — Blitz is six a side,
 * Worldwide eleven — so nothing here counts to forty.
 *
 * Corner order is the server's, and it is a clockwise walk from the top-left:
 * START, prison, vacation, go-to-prison. The runs are laid out the way a
 * piece actually travels — the top run left to right, the bottom run right to
 * left — which is why the bottom and left are measured backwards from their
 * far corner. Getting that wrong puts START in the wrong corner and sends
 * every piece round the board the wrong way, which is exactly what it looks
 * like: a board that is almost right.
 *
 * The numbers match `BoardGeometry` in the iOS app and the web client's grid,
 * so a tile is the same shape and in the same place on all three.
 */
class BoardGeometry(
    private val layout: MapLayout,
    val size: Size,
    /**
     * The most one iOS point may be, in pixels — the screen's density, so a
     * point is never bigger than a dp. See [pt].
     */
    private val maxPt: Float = Float.MAX_VALUE,
) {

    /** A corner is this much wider than a tile. */
    private val cornerScale = 1.42f

    /** The width of one ordinary tile. */
    private val unit: Float
        get() = size.width / (layout.top.size + 2 * cornerScale)

    val corner: Float get() = unit * cornerScale

    /**
     * One iOS point, in this board's pixels.
     *
     * iOS draws its board the width of the phone less 12pt, whatever the map
     * — about 390pt, where an ordinary tile of the forty-tile board is 33pt
     * across — and sets every word and mark on a tile in fixed points. So a
     * size read off BoardView.swift scales by the board, not by the tile it
     * sits on: a Blitz tile is bigger than a Worldwide one on both phones,
     * and the words on it are the same size on both. Measuring against the
     * tile instead drew every mark on a corner 1.42 times the size of iOS's,
     * because a corner is 1.42 tiles across.
     *
     * Capped at one point per dp. A phone's board is about the iPhone's, so
     * the scale only ever trims the words down on a smaller screen; but an
     * iPad keeps its 6.8pt names and 20pt pieces on a tabletop board twice
     * the size, and growing with the board drew them twice as big on a tablet.
     */
    val pt: Float get() = minOf(size.width / IPHONE_BOARD_PT, maxPt)

    /** Whether this index is one of the four corners. */
    fun isCorner(index: Int): Boolean = layout.corners.contains(index)

    /**
     * The tile's rectangle, or an empty one for an index this board has no
     * place for — a state from a board this client has not caught up with
     * must not crash the screen it is drawn on.
     */
    fun frame(index: Int): Rect {
        val u = unit
        val c = corner
        val w = size.width
        val h = size.height

        layout.corners.getOrNull(0)?.let { if (it == index) return Rect(0f, 0f, c, c) }
        layout.corners.getOrNull(1)?.let { if (it == index) return Rect(w - c, 0f, w, c) }
        layout.corners.getOrNull(2)?.let { if (it == index) return Rect(w - c, h - c, w, h) }
        layout.corners.getOrNull(3)?.let { if (it == index) return Rect(0f, h - c, c, h) }

        layout.top.indexOf(index).takeIf { it >= 0 }?.let { i ->
            return Rect(c + i * u, 0f, c + (i + 1) * u, c)
        }
        layout.right.indexOf(index).takeIf { it >= 0 }?.let { i ->
            return Rect(w - c, c + i * u, w, c + (i + 1) * u)
        }
        layout.bottom.indexOf(index).takeIf { it >= 0 }?.let { i ->
            return Rect(w - c - (i + 1) * u, h - c, w - c - i * u, h)
        }
        layout.left.indexOf(index).takeIf { it >= 0 }?.let { i ->
            return Rect(0f, h - c - (i + 1) * u, c, h - c - i * u)
        }
        return Rect.Zero
    }

    fun center(index: Int): Offset = frame(index).center

    /** Which edge a tile sits on — its colour band faces the middle. */
    fun side(index: Int): Side = when {
        layout.corners.contains(index) -> Side.TOP
        layout.top.contains(index) -> Side.TOP
        layout.right.contains(index) -> Side.RIGHT
        layout.bottom.contains(index) -> Side.BOTTOM
        else -> Side.LEFT
    }

    enum class Side { TOP, RIGHT, BOTTOM, LEFT }

    /**
     * The open middle of the board, inset from the tile ring by iOS's 4pt —
     * points, not pixels, or the well comes out a hair from the tiles on one
     * phone and a clear gap on the other.
     */
    val centerWell: Rect
        get() {
            val inset = corner + 4f * pt
            return Rect(inset, inset, size.width - inset, size.height - inset)
        }
}

/**
 * The iPhone's board, in points: thirty-three for each of the nine ordinary
 * tiles of a side plus two corners of 1.42 tiles each. See [BoardGeometry.pt].
 */
private const val IPHONE_BOARD_PT = 33f * (9f + 2f * 1.42f)
