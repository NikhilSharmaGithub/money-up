package com.moneymove.game

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Corners, and the one rule that keeps them honest.
 *
 * Two things live here. The first is the radius ladder — 6 / 10 / 14 / 18 /
 * 22 / 26, then a pill. It is arithmetic, step 4, and every padding in the app
 * is a multiple of 4, so a bar and the chips inside it come out concentric
 * without anybody having to remember a pairing: a 22dp dock with 8dp of
 * padding holds 14dp chips, and the gap around them stays the same width all
 * the way into the corner. Between them the three clients were using
 * twenty-five different corner literals before this.
 *
 * The second is the corner itself. Compose has only [RoundedCornerShape], and
 * a rounded rectangle joins its straight edge to a circular arc with a kink in
 * the curvature — invisible on a 6dp chip, perfectly visible on a 26dp sheet.
 * iOS has drawn continuous corners since 2013 and all 202 of the app's
 * `RoundedRectangle`s over there are already `.continuous`, so here the shape
 * has to be emitted as a real path or the two clients part company at exactly
 * the detail this material is judged on: the specular rim's hot spot lives in
 * the corner, and on a plain arc it lands somewhere else.
 */
object MMShapes {

    /**
     * How far past a plain arc a corner reaches. 0 is a rounded rectangle, 1
     * is as smooth as the construction goes. Apple's sits near 0.6 and that
     * is what the rest of the app is drawn against.
     */
    const val SMOOTHING = 0.6f

    val r6: Shape = continuous(6.dp)
    val r10: Shape = continuous(10.dp)
    val r14: Shape = continuous(14.dp)
    val r18: Shape = continuous(18.dp)
    val r22: Shape = continuous(22.dp)
    val r26: Shape = continuous(26.dp)

    /**
     * A capsule. Deliberately not a squircle: at a radius of half the short
     * side the smoothing has nowhere left to spend itself and the
     * construction collapses back onto an arc anyway, so this is the cheap
     * shape that says what it means.
     */
    val pill: Shape = MMPillShape

    /** The rungs, low to high, for anything that wants to walk them. */
    val ladder: List<Dp> = listOf(6.dp, 10.dp, 14.dp, 18.dp, 22.dp, 26.dp)

    /** A continuous-corner rounded rectangle at an arbitrary radius. */
    fun continuous(radius: Dp, smoothing: Float = SMOOTHING): Shape =
        ContinuousCornerShape(radius, smoothing)

    /**
     * The concentric rule. A child inset by [inset] inside a container of
     * radius [outer] wants this radius, and then the gap around it is a
     * constant width instead of pinching at the corners. It floors at 4dp,
     * because below that a corner reads as square and the pinch stops being
     * something anyone can see.
     */
    fun inner(outer: Dp, inset: Dp): Dp = maxOf(outer - inset, 4.dp)

    /** [inner], already a shape. */
    fun innerShape(outer: Dp, inset: Dp): Shape = continuous(inner(outer, inset))
}

/**
 * A shape that can hand back the corner radius it was built with.
 *
 * The lens in `Glass.kt` runs a signed-distance field over a rounded
 * rectangle, and an SDF needs a number, not a [Shape]. Rather than make every
 * call site state its radius twice, the two shapes this app draws glass in
 * answer for themselves; anything else simply does not get lensed.
 */
internal interface MMCornerShape : Shape {
    fun radiusPx(size: Size, density: Density): Float
}

private object MMPillShape : MMCornerShape {
    private val delegate = RoundedCornerShape(percent = 50)

    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline =
        delegate.createOutline(size, layoutDirection, density)

    override fun radiusPx(size: Size, density: Density): Float = min(size.width, size.height) / 2f

    override fun toString(): String = "MMShapes.pill"
}

private class ContinuousCornerShape(
    val radius: Dp,
    val smoothing: Float,
) : MMCornerShape {

    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline =
        Outline.Generic(continuousCornerPath(size, with(density) { radius.toPx() }, smoothing))

    override fun radiusPx(size: Size, density: Density): Float =
        with(density) { radius.toPx() }.coerceAtMost(min(size.width, size.height) / 2f)

    override fun equals(other: Any?): Boolean =
        other is ContinuousCornerShape && other.radius == radius && other.smoothing == smoothing

    override fun hashCode(): Int = radius.hashCode() * 31 + smoothing.hashCode()

    override fun toString(): String = "MMShapes.continuous(${radius.value}dp, $smoothing)"
}

/**
 * The squircle itself.
 *
 * Each corner is a short cubic peeling off the straight edge, a shortened
 * circular arc, and a mirrored cubic landing on the next edge. The cubics are
 * what remove the curvature kink: at `smoothing` 0 they have zero length and
 * the whole thing is an ordinary rounded rectangle, and as it rises they grow
 * while the arc between them shrinks, so the corner spreads further along the
 * edges without ever becoming rounder. The lengths a, b, c and d come out of
 * the construction Apple's corners and Figma's "corner smoothing" share.
 *
 * A corner can never spend more than half the short side, and when it is
 * asked to, the smoothing is what gives: the radius is the design, the
 * smoothing is the polish.
 */
fun continuousCornerPath(
    size: Size,
    radiusPx: Float,
    smoothing: Float = MMShapes.SMOOTHING,
): Path {
    val path = Path()
    val w = size.width
    val h = size.height
    if (w <= 0f || h <= 0f) return path

    val budget = min(w, h) / 2f
    val r = radiusPx.coerceIn(0f, budget)
    if (r <= 0.05f) {
        path.addRect(Rect(0f, 0f, w, h))
        return path
    }

    val s = smoothing.coerceIn(0f, 1f).coerceAtMost((budget / r - 1f).coerceAtLeast(0f))
    val p = (1f + s) * r

    // The arc keeps the radius and gives up its outer degrees to the cubics.
    val arcMeasure = 90f * (1f - s)
    val arcSection = sin(rad(arcMeasure / 2f)) * r * SQRT2
    val alpha = (90f - arcMeasure) / 2f
    val p3ToP4 = r * tan(rad(alpha / 2f))
    val beta = 45f * s
    val c = p3ToP4 * cos(rad(beta))
    val d = c * tan(rad(beta))
    val b = (p - arcSection - c - d) / 3f
    val a = 2f * b
    val edge = a + b + c            // by construction edge + d + arcSection == p

    var x = w - p
    var y = 0f
    path.moveTo(x, y)

    path.relativeCubicTo(a, 0f, a + b, 0f, edge, d)
    x += edge; y += d
    arc(path, x, y, x + arcSection, y + arcSection, r, arcMeasure)
    x += arcSection; y += arcSection
    path.relativeCubicTo(d, c, d, b + c, d, edge)
    x += d; y += edge

    path.lineTo(w, h - p)
    x = w; y = h - p

    path.relativeCubicTo(0f, a, 0f, a + b, -d, edge)
    x -= d; y += edge
    arc(path, x, y, x - arcSection, y + arcSection, r, arcMeasure)
    x -= arcSection; y += arcSection
    path.relativeCubicTo(-c, d, -(b + c), d, -edge, d)
    x -= edge; y += d

    path.lineTo(p, h)
    x = p; y = h

    path.relativeCubicTo(-a, 0f, -(a + b), 0f, -edge, -d)
    x -= edge; y -= d
    arc(path, x, y, x - arcSection, y - arcSection, r, arcMeasure)
    x -= arcSection; y -= arcSection
    path.relativeCubicTo(-d, -c, -d, -(b + c), -d, -edge)
    x -= d; y -= edge

    path.lineTo(0f, p)
    x = 0f; y = p

    path.relativeCubicTo(0f, -a, 0f, -(a + b), d, -edge)
    x += d; y -= edge
    arc(path, x, y, x + arcSection, y - arcSection, r, arcMeasure)
    x += arcSection; y -= arcSection
    path.relativeCubicTo(c, -d, b + c, -d, edge, -d)

    path.close()
    return path
}

/**
 * The shortened corner arc, from (sx, sy) to (ex, ey), radius [r], sweeping
 * [sweepDeg] clockwise. Compose wants the circle's bounding box rather than a
 * chord, so the centre is reconstructed: it sits off the chord's midpoint
 * along the chord normal, on the inside of the turn, which with y pointing
 * down is (-dy, dx).
 */
private fun arc(
    path: Path,
    sx: Float, sy: Float,
    ex: Float, ey: Float,
    r: Float,
    sweepDeg: Float,
) {
    val dx = ex - sx
    val dy = ey - sy
    val dist = sqrt(dx * dx + dy * dy)
    if (dist < 1e-4f || sweepDeg < 1e-3f) {
        path.lineTo(ex, ey)
        return
    }
    val half = dist / 2f
    val drop = sqrt((r * r - half * half).coerceAtLeast(0f))
    val cx = (sx + ex) / 2f - dy / dist * drop
    val cy = (sy + ey) / 2f + dx / dist * drop
    val start = deg(atan2(sy - cy, sx - cx))
    path.arcTo(Rect(cx - r, cy - r, cx + r, cy + r), start, sweepDeg, false)
}

private const val SQRT2 = 1.4142135f

private fun rad(degrees: Float): Float = (degrees * PI / 180.0).toFloat()

private fun deg(radians: Float): Float = (radians * 180.0 / PI).toFloat()
