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
class BoardGeometry(private val layout: MapLayout, val size: Size) {

    /** A corner is this much wider than a tile. */
    private val cornerScale = 1.42f

    /** The width of one ordinary tile. */
    private val unit: Float
        get() = size.width / (layout.top.size + 2 * cornerScale)

    val corner: Float get() = unit * cornerScale

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

    /** The open middle of the board, inset from the tile ring. */
    val centerWell: Rect
        get() = Rect(corner + 4f, corner + 4f, size.width - corner - 4f, size.height - corner - 4f)
}
