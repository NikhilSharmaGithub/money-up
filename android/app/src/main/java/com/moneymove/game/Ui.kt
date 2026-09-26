package com.moneymove.game

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.os.Build
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.EaseOutCubic
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.ScrollableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.addOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.PI

/**
 * The handful of pieces every screen is built out of.
 *
 * Deliberately small and unclever. Material's own components would each need
 * a colour scheme mapped onto the seven table styles and would still not look
 * like the iOS app, so the shared vocabulary is defined here once instead: a
 * button, a panel, a hint, a chip. The same four things the web client's CSS
 * defines, wearing the same palette slots.
 *
 * Further down are the pieces more than one screen needs to say the same
 * thing the same way — a balance in the red, the tags on a seat, an unread
 * count, your flag, an "are you sure", a link sent somewhere. Each is iOS's
 * version of that thing, so a screen that uses it is already at parity on
 * that detail instead of being one more place to get it slightly wrong.
 *
 * The controls here wear the glass (Glass.kt) and the content does not. A
 * button, a field and a dialog are the layer that floats; a panel and a chip
 * are the paper it floats over, and stay paper. Where a control is put
 * decides how it draws, and the place says so rather than every call site:
 * [Panel] says paper, a glass bar says [GlassHost], and a control reads
 * [LocalControlBackdrop] and [LocalGlassHost] for itself.
 */

// ── what a control is sitting on ───────────────────────────────────────────

/**
 * What the controls in this subtree have behind them.
 *
 * The material chooses its face from the backdrop it is told about and never
 * from pixels, so a control has to be told, and a button never knows where
 * it has been put while the surface around it always does. So the surface
 * says it once: [Panel] provides paper, a sheet provides sheet, the ad
 * overlay provides media. Nothing said is the page.
 */
val LocalControlBackdrop: ProvidableCompositionLocal<BackdropKind> =
    compositionLocalOf { BackdropKind.Page }

/**
 * The glass these controls are sitting on, when they are sitting on glass.
 *
 * Glass cannot sit on glass. A second film over the first is just a muddier
 * film, and at API 31+ a glass button on a glass bar samples a copy of the
 * page that has no bar in it and comes out as a hole cut through the bar. So
 * a bar that holds controls hands its surface down here, and every control
 * below it stops being a pane of its own: the coloured kinds become the solid
 * chip the tab bar already uses for its selection, the rest a quiet well in
 * the bar's own ink, and all of it takes its ink from the bar so the two
 * crossfade together when the bar flips. Null — which [Panel] puts back —
 * means paper.
 */
val LocalGlassHost: ProvidableCompositionLocal<GlassSurface?> = compositionLocalOf { null }

/**
 * Everything in [content] sits on [surface], a piece of glass the caller has
 * already drawn. See [LocalGlassHost]. The surface is the one the caller got
 * from [rememberGlassSurface] with the same backdrop it gave `mmGlass`, so
 * the ink on the controls and the film under them are one state machine's
 * answer, not two.
 */
@Composable
fun GlassHost(surface: GlassSurface, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalGlassHost provides surface, content = content)
}

/**
 * Ink for a label on this glass, crossfading with the film under it.
 *
 * Two ranks and no third: the palette's quietest ink measures 1.53:1 on the
 * material, so [quiet] is ink2 lifted 62% of the way to ink (5.82:1 at
 * worst), and under Increase Contrast it promotes again, to ink. Under
 * Reduce Transparency the glass is painted in the app's own solid, so its ink
 * comes from the app's own face rather than the backdrop's — the two only
 * part company over media, but there it is the difference between reading
 * the label and dark ink on a dark slab.
 */
@Composable
fun GlassSurface.labelInk(quiet: Boolean = false): Color {
    val secondary = quiet && !LocalIncreaseContrast.current
    if (LocalGlassLevel.current == GlassLevel.Opaque) {
        val own = LocalTheme.current.glass(
            if (LocalAppearanceDark.current) GlassAppearance.Dark else GlassAppearance.Light,
        )
        return if (secondary) own.ink2 else own.ink
    }
    return if (secondary) ink2 else ink
}

/**
 * The brass, for a number printed on glass: the table's gold taken half of
 * the way to the glass's own ink. The raw gold on a daylight film is the
 * pairing the spec measured at 3.22–4.36:1; halfway to the ink it clears
 * 5.8:1 on all fourteen tables and still reads as the coin's colour. It is
 * iOS's `glassGold` and the web's `--glass-gold-ink`, run on the same two
 * slots, so a purse prints the same colour on all three clients. Under
 * Reduce Transparency it follows the app's own face, as [labelInk] does.
 */
@Composable
fun GlassSurface.goldInk(): Color {
    if (LocalGlassLevel.current == GlassLevel.Opaque) {
        val own = LocalTheme.current.glass(
            if (LocalAppearanceDark.current) GlassAppearance.Dark else GlassAppearance.Light,
        )
        return mixSrgb(own.rimWarm, own.ink, 0.5f)
    }
    return mixSrgb(rimWarm, ink, 0.5f)
}

/**
 * Green, for money coming in printed on glass — a balance, what a deal hands
 * over. Raw, the day green on the film measures about 4.5:1 and the night red
 * [badInk] 3.5:1; taken 40% of the way to the glass's own ink they clear 7.4
 * and 5.4 over the page and over the board on all fourteen tables, and stay
 * plainly green and red. Increase Contrast thickens the film, which eats into
 * every coloured word on it, so there they go 55% of the way. iOS's
 * `glass.good` and the web's `--glass-good-ink`, on the same slots. Under
 * Reduce Transparency it follows the app's own face, as [labelInk] does.
 */
@Composable
fun GlassSurface.goodInk(): Color = moneyInk(bad = false)

/** Red, for money going out or owed, printed on glass. See [goodInk]. */
@Composable
fun GlassSurface.badInk(): Color = moneyInk(bad = true)

@Composable
private fun GlassSurface.moneyInk(bad: Boolean): Color {
    val theme = LocalTheme.current
    val pull = if (LocalIncreaseContrast.current) MONEY_PULL_CONTRAST else MONEY_PULL
    // The day and night hues, once per table rather than once per number.
    val (day, night) = remember(theme, bad) {
        val light = theme.palette(false)
        val dark = theme.palette(true)
        if (bad) light.bad to dark.bad else light.good to dark.good
    }
    // An opaque slab wears the app's own face, and so do its numbers.
    if (LocalGlassLevel.current == GlassLevel.Opaque) {
        val dark = LocalAppearanceDark.current
        val own = theme.glass(if (dark) GlassAppearance.Dark else GlassAppearance.Light)
        return mixSrgb(if (dark) night else day, own.ink, pull)
    }
    // Otherwise the hue of whichever face the glass is wearing, crossfading
    // with its ink when it flips.
    return mixSrgb(mixSrgb(day, night, flip), ink, pull)
}

private const val MONEY_PULL = 0.40f
private const val MONEY_PULL_CONTRAST = 0.55f

/**
 * A recess drawn on glass: the glass's own ink at a tenth, as iOS fills a
 * ghost on a bar. The palette's `sunken` is a paper colour and only matches a
 * glass that happens to be wearing the app's own face; the ink flips with the
 * glass, so this is a shade darker than a daylight bar and a shade lighter
 * than a night one on every table. Increase Contrast deepens it to the
 * strength iOS gives it there, the way it deepens the material's tint.
 */
@Composable
internal fun GlassSurface.well(): Color =
    labelInk().copy(alpha = if (LocalIncreaseContrast.current) WELL_ALPHA_CONTRAST else WELL_ALPHA)

private const val WELL_ALPHA = 0.10f
private const val WELL_ALPHA_CONTRAST = 0.18f

/**
 * The glass's own contour, as a divider: its ink at the strength of the
 * material's hairline, black at 10% by day and white at 8% by night, which is
 * what the rim draws round every pane for the same job — and 30% under
 * Increase Contrast, where the material's own hairline goes to 30% too.
 */
@Composable
private fun GlassSurface.hairline(): Color {
    if (LocalIncreaseContrast.current) return labelInk().copy(alpha = HAIRLINE_ALPHA_CONTRAST)
    val day = GlassSpec.hairline(GlassAppearance.Light).alpha
    val night = GlassSpec.hairline(GlassAppearance.Dark).alpha
    return labelInk().copy(alpha = day + (night - day) * flip)
}

private const val HAIRLINE_ALPHA_CONTRAST = 0.30f

/**
 * The quietest ink the spot allows: ink3 on paper, the lifted ink2 on glass.
 * A sheet's platter is glass too (MMSheet.kt). It says so through
 * [LocalControlBackdrop] rather than [LocalGlassHost], because its controls
 * stay panes of their own; a [Panel] on it puts paper back.
 *
 * Not only for the pieces here. A sheet's own small print — an empty state,
 * a footnote, a caption set straight on the platter — asks this rather than
 * naming ink3, which on the platter's night face falls from the 4.5:1 it had
 * on the old paper to about 3:1. A card of a sheet's own that is not a
 * [Panel] says it is paper the way a panel does, or its captions would lift
 * with the platter's.
 */
@Composable
internal fun quietInk(): Color {
    LocalGlassHost.current?.let { return it.labelInk(quiet = true) }
    if (LocalControlBackdrop.current == BackdropKind.Sheet) {
        return rememberGlassSurface(BackdropKind.Sheet).labelInk(quiet = true)
    }
    return P.current.ink3
}

/**
 * The semantic tint, for a mark drawn ON glass rather than a pane of it: the
 * strength `mmGlass` gives its own tint, and the 0.26 Increase Contrast asks
 * for. The dock washes its debt and deadlock blocks through the material at
 * this strength too (ActionPanel.kt).
 */
@Composable
internal fun tintAlpha(): Float = if (LocalIncreaseContrast.current) 0.26f else 0.14f

/**
 * A control lives inside whatever it was put in — a card, a sheet, a row on
 * a bar — so nothing ever slides underneath one. What is behind it is a flat
 * colour we painted ourselves, and that is the spec's own case for the flat
 * level: film, rim, glow and shadow, no blur, no lens. On a flat colour it is
 * not an approximation, because a blur of one colour is that colour.
 *
 * It matters more than it looks. The page's blurred copy is recorded from
 * the content the glass floats over, which is exactly where a button lives,
 * so a button that sampled it would be sampling last frame's picture of
 * itself; and a sheet or a dialog is a window of its own, where the copy is
 * somewhere else entirely. Reduce Transparency passes straight through.
 *
 * Not only for the controls here: any glass that scrolls with the page — the
 * Store's purse — is in the same place for the same reason, and says so
 * through this rather than repeating it.
 */
@Composable
internal fun Embedded(lightAngle: Float, content: @Composable () -> Unit) {
    val level = LocalGlassLevel.current
    CompositionLocalProvider(
        LocalGlassLevel provides (if (level == GlassLevel.Opaque) level else GlassLevel.Flat),
        LocalGlassLightAngle provides lightAngle,
        content = content,
    )
}

// ── the press ──────────────────────────────────────────────────────────────

/**
 * One control's press, as a gel rather than a dim: 0 at rest, 1 held all the
 * way down, and a little below 0 for a moment on the way back, where it
 * springs out past where it started before it settles.
 */
@Stable
class GlassPress internal constructor(internal val reduceMotion: Boolean) {
    internal val progress = Animatable(0f)

    /** How far down it is, for the things that must not overshoot — the light, the bloom. */
    val held: Float get() = progress.value.coerceIn(0f, 1f)

    /** Where the finger came down, in the pressed node's own coordinates. */
    var touch: Offset by mutableStateOf(Offset.Unspecified)
        internal set

    internal val down: AnimationSpec<Float> =
        if (reduceMotion) {
            tween(REDUCED_PRESS_MS)
        } else {
            tween(GlassMotion.PRESS_DOWN_MS, easing = EASE_OUT)
        }

    internal val up: AnimationSpec<Float> =
        if (reduceMotion) {
            tween(REDUCED_PRESS_MS)
        } else {
            spring(dampingRatio = GEL_DAMPING, stiffness = GEL_STIFFNESS)
        }
}

/**
 * The press on [touches], animated. Pair it with [glassPress] on the same
 * node; a glass control also reads [GlassPress.held] to swing its light.
 *
 * A tap is over long before its squash would be, so a release waits for the
 * way down to land before it starts back up — otherwise a quick tap, which
 * is most of them, would be a flinch rather than a press.
 */
@Composable
fun rememberGlassPress(touches: MutableInteractionSource): GlassPress {
    val reduceMotion = rememberReduceMotion()
    val press = remember(reduceMotion) { GlassPress(reduceMotion) }
    LaunchedEffect(touches, press) {
        var moving: Job? = null
        touches.interactions.collect { interaction ->
            when (interaction) {
                is PressInteraction.Press -> {
                    press.touch = interaction.pressPosition
                    moving?.cancel()
                    moving = launch { press.progress.animateTo(1f, press.down) }
                }
                is PressInteraction.Release, is PressInteraction.Cancel -> {
                    val landing = moving
                    moving = launch {
                        landing?.join()
                        press.progress.animateTo(0f, press.up)
                    }
                }
            }
        }
    }
    return press
}

/**
 * The gel itself: down to 0.965 with the squash, and back out past 1.0 on
 * the rebound. A layer transform, so a press never recomposes or redraws
 * anything under it. Under Reduce Motion the squash and the overshoot go and
 * a plain scale is what is left.
 */
fun Modifier.glassPress(press: GlassPress): Modifier = graphicsLayer {
    val t = press.progress.value
    val s = 1f - (1f - GlassMotion.PRESS_SCALE) * t
    if (press.reduceMotion) {
        scaleX = s
        scaleY = s
    } else {
        scaleX = s * (1f + (GlassMotion.PRESS_SQUASH_X - 1f) * t)
        scaleY = s * (1f + (GlassMotion.PRESS_SQUASH_Y - 1f) * t)
    }
}

/**
 * Where the finger landed, lit: a small bloom in the rim's hot colour —
 * white by day, brass by night — added rather than painted, inside the
 * shape and under the label. Only when [lit]; Reduce Motion and an opaque
 * slab have no light in them to bloom. The table's chat button, a plate that
 * is not an [MMButton], blooms through this too (GameScreen.kt).
 */
internal fun Modifier.pressBloom(
    press: GlassPress,
    glass: GlassSurface,
    shape: Shape,
    lit: Boolean,
): Modifier =
    if (!lit) this else drawWithCache {
        val clip = Path().apply { addOutline(shape.createOutline(size, layoutDirection, this@drawWithCache)) }
        val reach = BLOOM_RADIUS.toPx()
        onDrawWithContent {
            val t = press.held
            val at = press.touch
            if (t > 0f && at.isSpecified) {
                val hot = mixSrgb(Color.White, glass.rimWarm, glass.flip)
                clipPath(clip) {
                    drawCircle(
                        brush = Brush.radialGradient(
                            0f to hot.copy(alpha = BLOOM_ALPHA * t),
                            1f to hot.copy(alpha = 0f),
                            center = at,
                            radius = reach,
                        ),
                        radius = reach,
                        center = at,
                        blendMode = BlendMode.Plus,
                    )
                }
            }
            drawContent()
        }
    }

/** Under Reduce Motion a press is a plain scale, this long each way. */
private const val REDUCED_PRESS_MS = 100

/**
 * The rebound, and it is iOS's own `.spring(duration: 0.26, bounce: 0.38)`:
 * a bounce of b is a damping ratio of 1 − b, and a duration of T a stiffness
 * of (2π / T)². At that damping a spring overshoots by e^(−πζ/√(1−ζ²)), about
 * 8% of its travel, and it is the axis that travels furthest that has to
 * crest at 1.008 — the one the squash pulls in, down at 0.965 × 0.94, which
 * comes back out past 1.0 to about 1.008 while the other barely crosses it.
 * A looser spring tuned so that a plain 0.965 crests at 1.008 overshoots by
 * 23%, and carries the squashed axis out to 1.022: a wobble, not a gel.
 */
private const val GEL_DAMPING = 0.62f
private val GEL_STIFFNESS: Float =
    (2f * PI.toFloat() / (GlassMotion.PRESS_UP_MS / 1000f)).let { it * it }

private val EASE_OUT = CubicBezierEasing(0f, 0f, 0.58f, 1f)

private val BLOOM_RADIUS: Dp = 40.dp
private const val BLOOM_ALPHA = 0.10f

// ── the controls ───────────────────────────────────────────────────────────

enum class BtnKind { PRIMARY, GOLD, GHOST, GOOD, DANGER, PLAIN }

/**
 * iOS's MMButtonStyle, point for point: seventeen bold on a big button and
 * fourteen on a small one, 14/22 and 9/14 padding, and fourteen- and
 * ten-point corners — the ladder's r14 and r10, drawn as the squircle iOS
 * draws every rounded rectangle as.
 *
 * GHOST and PLAIN are the glass button — Regular, its label in the glass's own
 * ink — and both names stay because both are called. The four coloured kinds
 * are the prominent ones, and a prominent glass button is its colour: the
 * system's own is a plate of the accent with the light on it, not a pale pane
 * with a wash across it. Put through the material's fourteen-percent tint,
 * Accept, Negotiate and Decline come out as three creams beside the ghost —
 * a row with no primary in it, and a Bankrupt that reads like Raise cash. So
 * they keep their plate and the ink each palette designed for it, as iOS's
 * MMButtonStyle does, and take from the glass everything that is not the
 * film: the shadow it casts, so a plate and the ghost beside it float the
 * same distance off the card, the gel of the press, and the light that
 * blooms under the thumb.
 *
 * On a glass bar ([LocalGlassHost]) it is not glass at all. The coloured
 * kinds are the same plate without a shadow of their own, as the tab bar's
 * selection is, and GHOST becomes a well in the bar's own ink.
 *
 * Disabled changes nothing about how it looks. iOS's style never reads the
 * disabled state and its labels carry explicit colours, so a disabled iPhone
 * button stays solid and simply stops answering; the one place iOS wants it
 * faded (the trade dock's Accept) adds its own opacity, and a caller here does
 * the same with Modifier.alpha.
 *
 * Pressing is the gel ([glassPress]) instead of a ripple, and on glass the
 * rim's light swings 40° with it and blooms where the finger landed.
 *
 * [iconSize] overrides the glyph's size where iOS sets the symbol's own font
 * (a 15-point share arrow on a big button). [fitScale] keeps the label on one
 * line and lets it shrink to that fraction first, iOS's
 * lineLimit(1).minimumScaleFactor.
 *
 * An empty [label] is a button that is only its glyph — the dock's doors
 * beside End turn, a seat's kick — and then there is no gap left for words
 * that are not coming, so the glyph sits dead centre. Name it for a screen
 * reader through [modifier]; a drawing has no name of its own.
 */
@Composable
fun MMButton(
    label: String,
    modifier: Modifier = Modifier,
    kind: BtnKind = BtnKind.PLAIN,
    big: Boolean = false,
    icon: String? = null,
    // The price this used to be, struck through in front of the label. It is a
    // parameter rather than part of the label because it is not the same text:
    // a different size, a different weight, and a line through it. Only the
    // buttons that actually charge somebody pass it, and only while the sale
    // is real — the shelves elsewhere draw their own.
    was: Int? = null,
    enabled: Boolean = true,
    iconSize: Dp? = null,
    fitScale: Float? = null,
    // Something in front of the label that is not one glyph — a spinner while
    // a request is out, a coin, a die — handed the ink the label is drawn in,
    // so it matches the words on a plate and flips with them on glass. It
    // takes the icon's place. This is the slot the landing screens kept their own button for
    // (PlayTab.kt's LandingButton), so with it they can wear this one.
    lead: (@Composable (ink: Color) -> Unit)? = null,
    // The space between what leads and the words. Eight, as iOS's Label
    // sets it; the two landing buttons that set their own keep theirs.
    gap: Dp = 8.dp,
    onClick: () -> Unit,
) {
    val p = P.current
    val host = LocalGlassHost.current
    // GOLD is its own colour, not a second name for the accent. In Felt the
    // two happen to sit close, but in Crimson and the violet, pink and blue
    // themes p.red is a true red, and Negotiate painted with it read as a
    // second Decline right beside the real one.
    val plate = when (kind) {
        BtnKind.PRIMARY -> p.red
        BtnKind.GOLD -> p.gold
        BtnKind.GOOD -> p.good
        BtnKind.DANGER -> p.bad
        BtnKind.GHOST, BtnKind.PLAIN -> null
    }
    // The ink stays accentInk on both the accent and the brass, as iOS's
    // MMButtonStyle has it: it is the one pairing each palette designed for
    // its own accent, so it never has to be re-measured per table.
    val plateInk = when (kind) {
        BtnKind.PRIMARY, BtnKind.GOLD -> p.accentInk
        BtnKind.GOOD, BtnKind.DANGER -> Color.White
        BtnKind.GHOST, BtnKind.PLAIN -> null
    }
    val shape = if (big) MMShapes.r14 else MMShapes.r10
    val touches = remember { MutableInteractionSource() }
    val press = rememberGlassPress(touches)
    val light = LocalGlassLightAngle.current

    val face: Modifier
    val fg: Color
    val quiet: Color
    val angle: Float
    if (host == null) {
        val backdrop = LocalControlBackdrop.current
        val glass = rememberGlassSurface(backdrop)
        angle = light + GlassSpec.LIGHT_ANGLE_PRESS * press.held
        // Relaxed and staying relaxed: nothing ever moves under a button, so
        // there is nothing for its shadow to answer to. Lens off, as for
        // anything that is neither navigation nor the focus.
        val pane = Modifier.mmGlass(
            backdrop = backdrop,
            shape = shape,
            lens = false,
            shadow = GlassShadow.Relaxed,
        )
        val lit = !press.reduceMotion && LocalGlassLevel.current != GlassLevel.Opaque
        if (plate == null || plateInk == null) {
            fg = glass.labelInk()
            quiet = glass.labelInk(quiet = true)
            face = pane.pressBloom(press, glass, shape, lit)
        } else {
            // The plate is laid over the pane rather than instead of it, so
            // that its shadow is the pane's own, off the same tokens at the
            // same height as the ghost beside it. It covers the film, the
            // glow and the inner half of the rim; the outer half is left on
            // the plate's edge, the light catching it.
            fg = plateInk
            quiet = fg.copy(alpha = 0.55f)
            face = pane.background(plate, shape).pressBloom(press, glass, shape, lit)
        }
    } else {
        fg = plateInk ?: host.labelInk()
        quiet = if (plateInk == null) host.labelInk(quiet = true) else fg.copy(alpha = 0.55f)
        angle = light
        face = Modifier.background(plate ?: host.well(), shape)
    }

    Embedded(angle) {
        Row(
            modifier
                .glassPress(press)
                .then(face)
                .clickable(
                    interactionSource = touches,
                    indication = null,
                    enabled = enabled,
                    role = Role.Button,
                ) { onClick() }
                .padding(horizontal = if (big) 22.dp else 14.dp, vertical = if (big) 14.dp else 9.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val worded = label.isNotEmpty()
            if (lead != null) {
                lead(fg)
                if (worded) Spacer(Modifier.width(gap))
            } else if (icon != null) {
                Icon(icon, size = iconSize ?: if (big) 19.dp else 15.dp, tint = fg)
                if (worded) Spacer(Modifier.width(gap))
            }
            if (worded && was != null) {
                Text(
                    "$was",
                    color = quiet,
                    fontSize = if (big) 14.sp else 13.sp,
                    fontWeight = FontWeight.Bold,
                    textDecoration = TextDecoration.LineThrough,
                )
                Spacer(Modifier.width(7.dp))
            }
            if (!worded) {
                // Only the glyph: nothing to set beside it.
            } else if (fitScale != null) {
                FitText(
                    label,
                    Modifier.weight(1f, fill = false),
                    color = fg,
                    fontSize = if (big) 17.sp else 14.sp,
                    fontWeight = FontWeight.Bold,
                    minScale = fitScale,
                    textAlign = TextAlign.Center,
                )
            } else {
                Text(
                    label,
                    color = fg,
                    fontSize = if (big) 17.sp else 14.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/**
 * A panel: the card surface everything on a screen sits inside — iOS's MMCard,
 * with its sixteen-point corners, hairline, and the soft drop that lifts it
 * off the page. The shadow is the platform's default black at the landing
 * cards' elevation: Android multiplies a shadow colour's own alpha by the
 * theme's, so iOS's 0.10 black handed over as a colour would all but vanish.
 *
 * It is paper, and it stays paper. A panel is what people came to read, and
 * glass is for the layer that floats over what they came to read; iOS left
 * MMCard alone for the same reason, which is also why the corner stays at
 * sixteen rather than moving to the ladder — the two clients' cards have to
 * be the same card. What changes is that the corner is now the squircle
 * iOS's continuous rectangle is, and that everything inside knows it is on
 * paper: a button in here declares a card behind it, and a panel that sits
 * on a glass bar puts paper back between the bar and what it holds.
 */
@Composable
fun Panel(
    modifier: Modifier = Modifier,
    padding: Dp = 16.dp,
    content: @Composable ColumnScopeAlias.() -> Unit,
) {
    val p = P.current
    CompositionLocalProvider(
        LocalGlassHost provides null,
        LocalControlBackdrop provides BackdropKind.Paper,
    ) {
        Column(
            modifier
                .fillMaxWidth()
                .shadow(6.dp, PANEL_SHAPE, clip = false)
                .background(p.card, PANEL_SHAPE)
                .border(1.dp, p.rule, PANEL_SHAPE)
                .padding(padding),
            content = content,
        )
    }
}

/**
 * MMCard's corner, continuous. Off the ladder on purpose; see [Panel]. It
 * paints the card in its shape rather than clipping to it: a squircle is a
 * path, and a path clip is not anti-aliased on every phone this runs on,
 * while a path fill always is — and nothing in a panel reaches its corners
 * past the padding anyway.
 */
private val PANEL_SHAPE: Shape = MMShapes.continuous(16.dp)

typealias ColumnScopeAlias = androidx.compose.foundation.layout.ColumnScope

/**
 * The one-line note under a control, in the quietest ink the place allows:
 * the palette's ink3 on paper, and on glass the lifted ink2, because ink3 on
 * the material measures 1.53:1 and is not quiet there but gone.
 */
@Composable
fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier,
        color = quietInk(),
        fontSize = 12.5.sp,
        lineHeight = 17.sp,
        fontWeight = FontWeight.Medium,
    )
}

/**
 * A section label: small, wide-tracked, the same one the web client uses.
 * On glass the glyph gives up the accent for the glass's own ink, as every
 * drawn glyph on the material does, so it flips when the glass does.
 */
@Composable
fun SectionLabel(text: String, icon: String? = null, modifier: Modifier = Modifier) {
    val p = P.current
    val host = LocalGlassHost.current
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) {
            Icon(icon, size = 14.dp, tint = host?.labelInk(quiet = true) ?: p.red)
            Spacer(Modifier.width(6.dp))
        }
        Text(
            text.uppercase(),
            color = quietInk(),
            fontSize = 11.sp,
            // iOS's PanelTitle kerns a single point.
            letterSpacing = 1.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

/**
 * A small rounded chip — a tag, a count, a state.
 *
 * Content, not glass: a chip says something about the thing beside it, so on
 * paper it is the sunken capsule it always was. On a glass bar it is a mark
 * drawn on the material rather than a pane of it — a well in the bar's own
 * ink, or the chip's colour at the material's tint strength — and its words
 * take the bar's ink so they flip with the bar. The colour stays on the
 * glyph, where 3:1 is the bar a mark has to clear.
 */
@Composable
fun Chip(
    label: String,
    modifier: Modifier = Modifier,
    icon: String? = null,
    tint: Color? = null,
) {
    val p = P.current
    val host = LocalGlassHost.current
    val fill: Color
    val words: Color
    val glyph: Color
    if (host == null) {
        fill = p.sunken
        words = tint ?: p.ink2
        glyph = words
    } else {
        fill = tint?.copy(alpha = tintAlpha()) ?: host.well()
        words = host.labelInk(quiet = tint == null)
        glyph = tint ?: words
    }
    Row(
        modifier
            .clip(MMShapes.pill)
            .background(fill)
            .padding(horizontal = 9.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, size = 12.dp, tint = glyph)
            if (label.isNotEmpty()) Spacer(Modifier.width(5.dp))
        }
        if (label.isNotEmpty()) {
            Text(label, color = words, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
        }
    }
}

/**
 * A hairline the width of its parent. On glass a paper rule would stop
 * matching the moment the glass flipped, so there it is the glass's own
 * contour instead.
 */
@Composable
fun Rule(modifier: Modifier = Modifier) {
    val host = LocalGlassHost.current
    val colour = host?.hairline() ?: P.current.rule
    Box(modifier.fillMaxWidth().height(1.dp).background(colour))
}

/**
 * The scroll edge under a sheet's bar: lines leaving the top of a scrolling
 * column fade out over the last [SHEET_SCROLL_EDGE] instead of slicing off in
 * a hard line where the bar ends — the edge iOS draws under a sheet's
 * navigation bar, and the one the shell's page already draws above the tab
 * bar (AppScaffold.kt). It is there only while something has gone up past
 * the top: at rest the column opens on its own padding, and nothing is drawn,
 * not even the layer. It comes in over the spec's 160 ms and is not reduced
 * for Reduce Motion, because "there is more above" is information.
 *
 * Put it before the scroll — or on a lazy list's own modifier — so the mask
 * lies on the viewport and not on the content. A mask reads alpha alone, so
 * the two colours below are opacities, not paint; the layer is what keeps
 * the cut to this column rather than the sheet's glass under it.
 */
fun Modifier.scrollEdge(state: ScrollableState): Modifier = composed {
    val shown = animateFloatAsState(
        targetValue = if (state.canScrollBackward) 1f else 0f,
        animationSpec = tween(GlassMotion.SCROLL_EDGE_MS),
        label = "mm.edge",
    )
    Modifier
        .graphicsLayer {
            compositingStrategy =
                if (shown.value > 0f) CompositingStrategy.Offscreen else CompositingStrategy.Auto
        }
        .drawWithContent {
            drawContent()
            val t = shown.value
            if (t > 0f) {
                val band = SHEET_SCROLL_EDGE.toPx().coerceAtMost(size.height)
                drawRect(
                    Brush.verticalGradient(
                        0f to Color.Black.copy(alpha = 1f - t),
                        1f to Color.Black,
                        startY = 0f,
                        endY = band,
                    ),
                    size = Size(size.width, band),
                    blendMode = BlendMode.DstIn,
                )
            }
        }
}

/** How much of a sheet's column fades under its bar — the tab bar's 28, the spec's. */
private val SHEET_SCROLL_EDGE: Dp = 28.dp

/**
 * Money, written the way every client writes it: no cents, thousands split —
 * and, now that an unpaid debt lives as a negative balance, "−$1,300" with a
 * real minus sign out front, exactly as iOS writes it (Theme.swift, money()).
 * A hyphen is narrower than the digits and reads as a dash beside them.
 */
fun money(v: Int): String {
    val sign = if (v < 0) "\u2212" else ""
    val digits = kotlin.math.abs(v.toLong()).toString()
    val grouped = digits.reversed().chunked(3).joinToString(",").reversed()
    return "$sign$$grouped"
}

/**
 * The locale the iPhone formats numbers and dates in: English, in the phone's
 * own region.
 *
 * The iOS app is written in English alone, and an English-only app's
 * Locale.current is English in the phone's region — "en_IN" on a phone set to
 * Hindi in India — so its numbers group the Indian way and its weekdays are
 * still English words. Android hands every app the phone's whole locale, so
 * taking Locale.getDefault() as it is would print Hindi weekday names, or
 * Arabic-Indic digits, in the middle of an English sentence. The region is
 * kept, so "1,26,000", "1.500" and "20:00" still come out as each phone
 * writes them.
 */
internal fun readerLocale(): java.util.Locale {
    val region = java.util.Locale.getDefault().country
    return if (region.isBlank()) java.util.Locale.ENGLISH else java.util.Locale("en", region)
}

/**
 * An instant as iOS's Date.formatted writes it: the fields a date [skeleton]
 * names, laid out in the order [readerLocale] lays them out. 'j' in the
 * skeleton is the hour, and [twentyFour] — the phone's own 24-hour switch,
 * which outranks the locale's habit on both platforms — decides whether it
 * becomes 'H' or 'h' before the locale sees it.
 */
internal fun clockText(epochMs: Double, skeleton: String, twentyFour: Boolean): String {
    val locale = readerLocale()
    val fields = skeleton.replace('j', if (twentyFour) 'H' else 'h')
    val pattern = android.text.format.DateFormat.getBestDateTimePattern(locale, fields)
    return java.text.SimpleDateFormat(pattern, locale).format(java.util.Date(epochMs.toLong()))
}

/** A player's colour, as the server writes it ("#e3a93c"). */
fun cssColor(raw: String?, fallback: Color): Color {
    val hex = raw?.trim()?.removePrefix("#") ?: return fallback
    return runCatching {
        when (hex.length) {
            6 -> Color(0xFF000000L.or(hex.toLong(16)).toInt())
            8 -> Color(hex.toLong(16).toInt())
            3 -> Color(0xFF000000L.or(hex.map { "$it$it" }.joinToString("").toLong(16)).toInt())
            else -> fallback
        }
    }.getOrDefault(fallback)
}

/**
 * A player's disc, from the seat they are sitting in. See [AvatarDisc], which
 * draws it: this only reads the three things a seat carries.
 */
@Composable
fun PlayerDisc(player: PlayerState, size: Dp = 28.dp, modifier: Modifier = Modifier) {
    AvatarDisc(
        name = player.name,
        color = player.color,
        modifier = modifier,
        size = size,
        flag = player.flag,
        avatar = player.avatar,
    )
}

/**
 * A round avatar disc: the player's colour, their bought face or else their
 * initial, and their country's flag tucked on the bottom-right shoulder.
 *
 * iOS's AvatarView (Theme.swift) at the same proportions — the face at 0.58
 * of the disc, the initial at 0.42, the flag at 0.36 pushed a little past the
 * rim — so a seat reads as the same person on both phones. The flag and the
 * face are the player's own picks and are drawn as they picked them; the
 * sizes go through the density rather than `.sp` so a large system font does
 * not push the initial out of its circle, which iOS's fixed sizes never do.
 *
 * For people who are not in a seat — a friend, a leaderboard row — pass the
 * fields directly.
 */
@Composable
fun AvatarDisc(
    name: String,
    color: String?,
    modifier: Modifier = Modifier,
    size: Dp = 36.dp,
    flag: String? = null,
    avatar: String? = null,
) {
    val p = P.current
    val density = LocalDensity.current
    fun at(k: Float) = with(density) { (size * k).toSp() }
    Box(modifier, contentAlignment = Alignment.BottomEnd) {
        Box(
            Modifier
                .size(size)
                .shadow(3.dp, CircleShape, clip = false, ambientColor = DISC_SHADOW, spotColor = DISC_SHADOW)
                .clip(CircleShape)
                .background(cssColor(color, p.red)),
            contentAlignment = Alignment.Center,
        ) {
            val face = avatar?.takeIf { it.isNotBlank() }
            if (face != null) {
                Text(face, fontSize = at(0.58f), maxLines = 1, softWrap = false)
            } else {
                Text(
                    (name.firstOrNull() ?: '?').uppercase(),
                    color = Color.White,
                    fontSize = at(0.42f),
                    fontWeight = FontWeight.Black,
                    maxLines = 1,
                    softWrap = false,
                )
            }
        }
        flag?.takeIf { it.isNotBlank() }?.let {
            Text(
                it,
                fontSize = at(0.36f),
                maxLines = 1,
                softWrap = false,
                modifier = Modifier.offset(x = size * 0.12f, y = size * 0.10f),
            )
        }
    }
}

private val DISC_SHADOW = Color.Black.copy(alpha = 0.3f)

/** Standard page padding, so every screen's gutter is the same gutter. */
val PagePadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)

// ── money that owes ────────────────────────────────────────────────────────

/**
 * A balance, in the colour of what it means.
 *
 * Positive money is the good green (or whatever `positive` a row prefers —
 * a lobby seat's cash, a muted list line); below zero it wears the danger
 * colour and breathes ([debtPulse]); a bankrupt seat's number goes quiet in
 * the faintest ink the spot allows — ink3 on paper, the lifted ink2 on glass,
 * where ink3 cannot be read. iOS does these three cases at every balance it
 * prints (GameScreen.swift seat chips, TradeSheet.swift partners,
 * ResultsViews.swift standings), and a seat in the red has to read as one
 * thing everywhere.
 *
 * The change itself rolls, up for a gain and down for a loss, which is the
 * nearest Compose has to iOS's `.contentTransition(.numericText())`.
 *
 * `text` is for the rows that say more than the number — the debt panel's
 * "$300 in the red" is `MoneyText(balance, text = "${money(-balance)} in the
 * red")` — and the colour and the pulse still follow `amount`.
 *
 * `count` is for the seats money lands on: rather than rolling, the number
 * counts to what it became over 0.6s — straight away for a seat that paid,
 * a quarter second later for one that was paid, as the first coin drops into
 * it. A change of `snapKey` (the store's paint epoch: a first paint, a
 * reconnect) sets it down without counting, because that is a position, not
 * news. Under Reduce Motion it steps, as the plain roll does. A swap to
 * words — "bankrupt" — still rolls.
 */
@Composable
fun MoneyText(
    amount: Int,
    modifier: Modifier = Modifier,
    fontSize: TextUnit = 13.sp,
    fontWeight: FontWeight = FontWeight.ExtraBold,
    positive: Color = P.current.good,
    bankrupt: Boolean = false,
    text: String = money(amount),
    count: Boolean = false,
    snapKey: Any? = null,
) {
    val p = P.current
    val inDebt = amount < 0 && !bankrupt
    val colour = when {
        bankrupt -> quietInk()
        inDebt -> p.bad
        else -> positive
    }
    if (count && !rememberReduceMotion()) {
        val counted = remember { Animatable(amount, Int.VectorConverter) }
        var epoch by remember { mutableStateOf(snapKey) }
        LaunchedEffect(amount, snapKey) {
            if (snapKey != epoch) {
                epoch = snapKey
                counted.snapTo(amount)
                return@LaunchedEffect
            }
            val paid = amount > counted.value
            counted.animateTo(amount, tween(600, delayMillis = if (paid) 250 else 0, easing = EaseOutCubic))
        }
        // Words replace the number rather than count to it.
        val words = text.takeIf { it != money(amount) }
        AnimatedContent(
            targetState = words,
            modifier = modifier.debtPulse(inDebt),
            transitionSpec = {
                val roll = tween<IntOffset>(400, easing = FastOutSlowInEasing)
                (slideInVertically(roll) { h -> -h / 2 } + fadeIn(tween(400))) togetherWith
                    (slideOutVertically(roll) { h -> h / 2 } + fadeOut(tween(200))) using
                    SizeTransform(clip = false)
            },
            label = "moneyCount",
        ) { said ->
            Text(
                said ?: money(counted.value),
                color = colour, fontSize = fontSize, fontWeight = fontWeight, maxLines = 1, softWrap = false,
            )
        }
        return
    }
    AnimatedContent(
        targetState = amount to text,
        modifier = modifier.debtPulse(inDebt),
        transitionSpec = {
            val up = targetState.first >= initialState.first
            val roll = tween<IntOffset>(400, easing = FastOutSlowInEasing)
            (slideInVertically(roll) { h -> if (up) h / 2 else -h / 2 } + fadeIn(tween(400))) togetherWith
                (slideOutVertically(roll) { h -> if (up) -h / 2 else h / 2 } + fadeOut(tween(200))) using
                SizeTransform(clip = false)
        },
        label = "money",
    ) { (_, shown) ->
        Text(shown, color = colour, fontSize = fontSize, fontWeight = fontWeight, maxLines = 1, softWrap = false)
    }
}

/**
 * The soft heartbeat on a balance below zero. The colour already carries the
 * alarm — this just keeps the number breathing until the seat is back in the
 * black. iOS's DebtPulse, at its timing: down to 55% and back over 0.9s each
 * way while in debt, and a 0.2s settle when the debt clears.
 */
fun Modifier.debtPulse(active: Boolean): Modifier = composed {
    val breathing = if (active) {
        rememberInfiniteTransition(label = "debtPulse").animateFloat(
            initialValue = 1f,
            targetValue = 0.55f,
            animationSpec = infiniteRepeatable(tween(900, easing = EASE_IN_OUT), RepeatMode.Reverse),
            label = "debtPulse",
        ).value
    } else {
        1f
    }
    val shown by animateFloatAsState(
        breathing,
        animationSpec = if (active) snap<Float>() else tween<Float>(200, easing = LinearOutSlowInEasing),
        label = "debtSettle",
    )
    alpha(shown)
}

private val EASE_IN_OUT = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)

// ── who is who ─────────────────────────────────────────────────────────────

/**
 * One of the little words after a name: HOST, BOT, YOU. Black weight, tiny,
 * coloured and nothing else — iOS draws them bare, no capsule, so they sit on
 * the name's baseline rather than competing with it. (NEXT is the exception:
 * iOS gives it a capsule, so it is a [MiniPill].)
 */
@Composable
fun SeatTag(text: String, colour: Color, modifier: Modifier = Modifier, fontSize: TextUnit = 8.sp) {
    Text(
        text,
        modifier = modifier,
        color = colour,
        fontSize = fontSize,
        fontWeight = FontWeight.Black,
        maxLines = 1,
        softWrap = false,
    )
}

/**
 * The tags a seat wears, in iOS's order: HOST in gold, BOT in the faint ink
 * (the lifted ink2 when the seat is drawn on glass), YOU in the accent
 * (LobbyPanel.swift). Emits them side by side, so call it
 * inside the Row that holds the name and let that Row's spacing part them.
 *
 * The lobby shows all three at 8sp. The seat chip at the table shows HOST and
 * BOT at 7sp and no YOU (GameScreen.swift) — pass `fontSize = 7.sp,
 * showYou = false` there.
 */
@Composable
fun SeatTags(
    player: PlayerState,
    hostId: String?,
    meId: String?,
    fontSize: TextUnit = 8.sp,
    showYou: Boolean = true,
) {
    val p = P.current
    if (hostId != null && player.id == hostId) SeatTag("HOST", p.gold, fontSize = fontSize)
    if (player.isBot == true) SeatTag("BOT", quietInk(), fontSize = fontSize)
    if (showYou && meId != null && player.id == meId) SeatTag("YOU", p.red, fontSize = fontSize)
}

/**
 * A capsule small enough to ride a seat chip: the live rank with its crown,
 * NEXT / YOU'RE NEXT, the deadlock laps. iOS's rankBadge, nextTag and
 * DeadlockLaps are all this one shape — black type on a soft fill, 1.5 by 5
 * of padding — differing only in words and colour. The rank and the laps are
 * 8.5pt; NEXT is 7pt with half a point of tracking (`fontSize = 7.sp,
 * letterSpacing = 0.5.sp`).
 *
 * An inherent-colour glyph (the crown) keeps its own colour whatever
 * `iconTint` says, which is what iOS's crown does too.
 */
@Composable
fun MiniPill(
    text: String,
    colour: Color,
    background: Color,
    modifier: Modifier = Modifier,
    icon: String? = null,
    iconSize: Dp = 10.dp,
    iconTint: Color = colour,
    fontSize: TextUnit = 8.5.sp,
    letterSpacing: TextUnit = TextUnit.Unspecified,
) {
    Row(
        modifier
            .clip(MMShapes.pill)
            .background(background)
            .padding(horizontal = 5.dp, vertical = 1.5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        if (icon != null) Icon(icon, size = iconSize, tint = iconTint)
        Text(
            text,
            color = colour,
            fontSize = fontSize,
            fontWeight = FontWeight.Black,
            letterSpacing = letterSpacing,
            maxLines = 1,
            softWrap = false,
        )
    }
}

/**
 * How many things are waiting, as a number rather than a dot: "3" is an
 * invitation to go and read three things, a dot is a smudge on a button.
 *
 * iOS's unreadBadge (GameScreen.swift): up to "99+", a pill that widens for
 * two digits, a ring in the page colour so it reads over the board, and a
 * spring on the way in and on every new message. It draws nothing at zero,
 * so a caller can always place it; while it fades out it keeps showing the
 * last count rather than flashing a "0".
 *
 * Hang it off the corner of whatever it counts — `Modifier.align(TopEnd)`
 * and a small offset, as iOS does (x 5, y −4 on the chat button).
 */
@Composable
fun UnreadBadge(count: Int, modifier: Modifier = Modifier) {
    val p = P.current
    var lastShown by remember { mutableIntStateOf(count) }
    val bump = remember { Animatable(1f) }
    LaunchedEffect(count) {
        if (count > 0) {
            lastShown = count
            bump.snapTo(1.2f)
            bump.animateTo(1f, spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessMediumLow))
        }
    }
    val n = if (count > 0) count else lastShown
    AnimatedVisibility(
        visible = count > 0,
        modifier = modifier,
        enter = scaleIn(spring(dampingRatio = 0.5f)) + fadeIn(),
        exit = scaleOut() + fadeOut(),
    ) {
        Box(
            Modifier
                .graphicsLayer { scaleX = bump.value; scaleY = bump.value }
                .defaultMinSize(minWidth = 19.dp, minHeight = 19.dp)
                .clip(MMShapes.pill)
                .background(p.red)
                .border(2.dp, p.page, MMShapes.pill)
                .padding(horizontal = if (n > 9) 5.dp else 0.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (n > 99) "99+" else "$n",
                color = Color.White,
                fontSize = 11.sp,
                fontWeight = FontWeight.ExtraBold,
                maxLines = 1,
                softWrap = false,
            )
        }
    }
}

/**
 * A dashed outline — an empty chair, a slot waiting to be filled. iOS's
 * empty seat row strokes its rounded rectangle 1pt in `rule2` with a 5-on,
 * 4-off dash (LobbyPanel.swift); those are the defaults. It is drawn over
 * the content, as iOS's overlay is, and inset by half the stroke so none of
 * it is clipped.
 */
fun Modifier.dashedBorder(
    color: Color,
    width: Dp = 1.dp,
    cornerRadius: Dp = 14.dp,
    dash: Dp = 5.dp,
    gap: Dp = 4.dp,
): Modifier = drawWithContent {
    drawContent()
    val w = width.toPx()
    drawRoundRect(
        color = color,
        topLeft = Offset(w / 2, w / 2),
        size = Size(size.width - w, size.height - w),
        cornerRadius = CornerRadius(cornerRadius.toPx()),
        style = Stroke(width = w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash.toPx(), gap.toPx()))),
    )
}

// ── your flag ──────────────────────────────────────────────────────────────

/**
 * Your flag, as one row.
 *
 * iOS's flagPicker (LandingView.swift, in the profile card under the
 * nickname): a row showing the flag you wear, "Country flag", the country's
 * name on the right and an up-down mark; tap it for a named list with "No
 * flag" first and a tick on the one you picked. A grid of fifty unlabelled
 * flags asks the reader to recognise every one of them; a named list can be
 * read.
 *
 * `selected` is the flag string ("" for none). `onPick` gets the new one —
 * the caller sends it (GameStore.setAppearance(flagCode = …)) and keeps it.
 * Picking a country clicks, as on iOS; clearing the flag does not.
 *
 * The flags are the emoji themselves, as iOS draws them: a player's own flag
 * is theirs, and only fourteen of the fifty have drawn art. With no flag the
 * row shows iOS's white flag, which is the answer to "which flag" rather than
 * a piece of chrome. The up-down mark and the menu's tick and struck flag are
 * iOS's own symbols (SafetySheets.kt's SfMark).
 *
 * The row is a field, and fields are glass: the well you tap is a control
 * floating on the card, not part of what the card says. Its words take the
 * glass's ink — the caption and the mark the lifted ink2, since ink3 cannot
 * be read on the material — and on a glass bar it is a well in the bar's own
 * ink instead, as every control is there.
 *
 * The menu it opens stays paper. It is a popup, its own window, where the
 * page's blurred copy cannot reach; a film with nothing blurred behind it
 * would lay a list of fifty countries over the words of the card beneath at
 * 38%, and a list is content anyway.
 */
@Composable
fun FlagPicker(selected: String, onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    val density = LocalDensity.current
    var open by remember { mutableStateOf(false) }
    val current = countryName(selected)
    val shape = MMShapes.r14
    val host = LocalGlassHost.current
    val backdrop = LocalControlBackdrop.current
    val glass = host ?: rememberGlassSurface(backdrop)
    val face = if (host == null) {
        Modifier.mmGlass(backdrop = backdrop, shape = shape, lens = false, shadow = GlassShadow.Relaxed)
    } else {
        Modifier.background(host.well(), shape)
    }
    Box(modifier.fillMaxWidth()) {
        Embedded(LocalGlassLightAngle.current) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 46.dp)
                    .then(face)
                    .clip(shape)
                    .clickable { open = true }
                    .padding(horizontal = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    selected.ifBlank { "\uD83C\uDFF3\uFE0F" },
                    fontSize = with(density) { 19.dp.toSp() }, maxLines = 1, softWrap = false,
                )
                Text(
                    "Country flag",
                    color = glass.labelInk(quiet = true),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    softWrap = false,
                )
                // The name takes whatever width is left and sits flush right in
                // it, so a long one ("United Arab Emirates") ellipsizes instead of
                // pushing the up-down mark off the row.
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                    Text(
                        current ?: "None",
                        color = glass.labelInk(),
                        fontSize = 14.sp,
                        fontWeight = FontWeight.ExtraBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                // iOS's chevron.up.chevron.down at eleven bold: two small stacked
                // chevrons, no stems.
                SfMark("chevron.up.chevron.down", 20.dp, glass.labelInk(quiet = true))
            }
        }
        CompositionLocalProvider(LocalGlassHost provides null) {
            FlagMenu(open, selected, onClose = { open = false }, onPick = onPick)
        }
    }
}

/** The named list [FlagPicker] opens: "No flag", a rule, then every country. */
@Composable
private fun FlagMenu(open: Boolean, selected: String, onClose: () -> Unit, onPick: (String) -> Unit) {
    val p = P.current
    DropdownMenu(
        expanded = open,
        onDismissRequest = onClose,
        modifier = Modifier.heightIn(max = 440.dp),
        shape = MMShapes.r14,
        containerColor = p.card,
        border = BorderStroke(1.dp, p.rule),
    ) {
        // iOS's Label: the words, then a tick when it is the choice and a
        // struck-through flag when it is not.
        DropdownMenuItem(
            text = {
                Text("No flag", color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.Normal, maxLines = 1)
            },
            trailingIcon = {
                SfMark(if (selected.isBlank()) "checkmark" else "flag.slash", 18.dp, p.ink)
            },
            onClick = {
                onClose()
                if (selected.isNotBlank()) onPick("")
            },
        )
        Rule(Modifier.padding(vertical = 4.dp))
        MMStatic.countries.forEach { (flag, name) ->
            FlagMenuItem("$flag  $name", ticked = flag == selected) {
                onClose()
                SoundKit.click()
                onPick(flag)
            }
        }
    }
}

/** A country in the menu: iOS's plain Text, seventeen regular, with the tick typed after the chosen one. */
@Composable
private fun FlagMenuItem(label: String, ticked: Boolean, onClick: () -> Unit) {
    val p = P.current
    DropdownMenuItem(
        text = {
            Text(
                if (ticked) "$label  ✓" else label,
                color = p.ink,
                fontSize = 17.sp,
                fontWeight = FontWeight.Normal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        onClick = onClick,
    )
}

// ── are you sure ───────────────────────────────────────────────────────────

/** One answer in a [ConfirmDialog]. DANGER is the destructive one, as iOS's role. */
class ConfirmAction(
    val label: String,
    val kind: BtnKind = BtnKind.GHOST,
    val icon: String? = null,
    val onClick: () -> Unit,
)

/**
 * "Are you sure", over the whole screen: iOS's confirmationDialog in the
 * house style. A title, the sentence that says what is at stake, the answers
 * one per line in the order given, and Cancel last — iOS adds its Cancel
 * itself, so this does too unless `cancelLabel` is null.
 *
 * Choosing any answer dismisses first and acts second, so an answer that
 * raises something else is not closed by its own dismissal.
 *
 * Only from a screen, never from inside a ModalBottomSheet: a dialog raised
 * there fights the sheet for the window (see SafetySheets.kt). Inside a sheet
 * use [ConfirmRow].
 *
 * It is glass, as iOS's is — an alert floats over the table, it is not part
 * of it — and it is the one piece of glass here drawn over a colour it puts
 * down itself. A dialog is a window of its own, so there is no blurred copy
 * of the table for it to sample, and a film with nothing blurred behind it
 * would show the table's own words through the question at 38%. So it lays
 * the sheet colour down first and declares exactly that: the material over a
 * flat backdrop, which is the flat level's own case. The answers sit on it
 * as a glass bar's controls do ([GlassHost]) — glass cannot sit on glass —
 * and at twelve in from a 22 corner they are the ladder's r10, concentric.
 * The words keep their twenty.
 */
@Composable
fun ConfirmDialog(
    title: String,
    actions: List<ConfirmAction>,
    onDismiss: () -> Unit,
    message: String? = null,
    icon: String? = null,
    cancelLabel: String? = "Cancel",
) {
    val p = P.current
    val shape = MMShapes.r22
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val glass = rememberGlassSurface(BackdropKind.Sheet)
        Embedded(LocalGlassLightAngle.current) {
            Column(
                Modifier
                    .padding(horizontal = 24.dp)
                    .widthIn(max = 420.dp)
                    .fillMaxWidth()
                    .background(p.sheet, shape)
                    .mmGlass(
                        backdrop = BackdropKind.Sheet,
                        shape = shape,
                        lens = false,
                        shadow = GlassShadow.Relaxed,
                    )
                    .padding(12.dp),
            ) {
                GlassHost(glass) {
                    Column(Modifier.padding(start = 8.dp, top = 8.dp, end = 8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (icon != null) {
                                val danger = actions.any { it.kind == BtnKind.DANGER }
                                Icon(icon, size = 18.dp, tint = if (danger) p.bad else p.red)
                                Spacer(Modifier.width(8.dp))
                            }
                            Text(title, color = glass.labelInk(), fontSize = 17.sp, fontWeight = FontWeight.Black)
                        }
                        if (message != null) {
                            Spacer(Modifier.height(6.dp))
                            Text(
                                message,
                                color = glass.labelInk(quiet = true),
                                fontSize = 13.5.sp,
                                lineHeight = 19.sp,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (a in actions) {
                            MMButton(a.label, Modifier.fillMaxWidth(), kind = a.kind, icon = a.icon) {
                                onDismiss()
                                a.onClick()
                            }
                        }
                        if (cancelLabel != null) {
                            MMButton(cancelLabel, Modifier.fillMaxWidth(), kind = BtnKind.GHOST) { onDismiss() }
                        }
                    }
                }
            }
        }
    }
}

/**
 * "Are you sure", as a row that replaces the button it guards — the form a
 * confirmation takes inside a sheet, where a dialog cannot be trusted to
 * appear. SafetySheets' Block confirm, made general: a soft danger panel, the
 * warning glyph and the question, the sentence that says what is at stake,
 * and the two answers side by side with the irreversible one first.
 *
 * `busy` greys both answers and swaps in `busyLabel` while the request is out,
 * so a second tap cannot send it twice.
 *
 * The soft panel is paper — a notice drawn on whatever it is in, the way the
 * iPhone's dock carries its deadlock strip — so the answers on it are glass
 * over paper. Its corner is 22 at twelve in so that their r10 is concentric
 * with it; the old 14 at fourteen in asked for a corner of 4.
 */
@Composable
fun ConfirmRow(
    title: String,
    message: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    cancelLabel: String = "Cancel",
    busy: Boolean = false,
    busyLabel: String? = null,
    icon: String = "warning",
    destructive: Boolean = true,
) {
    val p = P.current
    CompositionLocalProvider(
        LocalGlassHost provides null,
        LocalControlBackdrop provides BackdropKind.Paper,
    ) {
        Column(
            modifier
                .fillMaxWidth()
                .background(if (destructive) p.badSoft else p.goldSoft, MMShapes.r22)
                .padding(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, size = 16.dp, tint = if (destructive) p.bad else p.gold)
                Spacer(Modifier.width(7.dp))
                Text(title, color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Black)
            }
            Spacer(Modifier.height(6.dp))
            Hint(message)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // MMButton keeps its colours when disabled, as iOS's style does, so
                // the wait is shown here the way iOS shows one: by fading the pair.
                MMButton(
                    if (busy && busyLabel != null) busyLabel else confirmLabel,
                    kind = if (destructive) BtnKind.DANGER else BtnKind.PRIMARY,
                    modifier = Modifier.weight(1f).alpha(if (busy) 0.45f else 1f),
                    enabled = !busy,
                ) { onConfirm() }
                MMButton(
                    cancelLabel,
                    kind = BtnKind.GHOST,
                    modifier = Modifier.weight(1f).alpha(if (busy) 0.45f else 1f),
                    enabled = !busy,
                ) { onCancel() }
            }
        }
    }
}

// ── sending it somewhere ───────────────────────────────────────────────────

/**
 * The iOS symbols the drawn set has no drawing for, and the glyph that stands
 * in for each.
 *
 * iOS leans on SF Symbols for these; public/js/icons.js — the one source of
 * art for all three clients — never drew them, and Glyphs.kt is generated
 * from it. Where the web client already had to choose a stand-in, this makes
 * the same choice, so the three clients at least agree with each other. Name
 * the stand-in through here rather than by its glyph, so that the day
 * icons.js draws a real share arrow it is one line to change.
 */
object GlyphFor {
    /** square.and.arrow.up for an invite, drawn in Art.kt since icons.js has none. */
    const val SHARE = "share"
    /** square.and.arrow.up for a result — the same mark iOS puts on its result sheet. */
    const val SHARE_RESULT = "share"
    /** doc.on.doc, drawn in Art.kt beside the share mark. */
    const val COPY = "copy"
    /** clock.arrow.circlepath, the game log's history. */
    const val HISTORY = "replay"
    /** timer, on the full-size turn clock. A sweep round a dial is the nearest. */
    const val TIMER = "replay"
}

/**
 * The result sheet's share button: a win is bragged about, a loss still
 * shares the table. What it sends is [GameStore.shareText]; the link in it is
 * [Prefs.roomLink], and a friend code's invite is
 * [AccountStore.friendCodeShareText] — one copy of each sentence.
 */
fun resultShareLabel(iWon: Boolean): String = if (iWon) "Brag about it" else "Share the table"

/**
 * Hands `text` to Android's share sheet — iOS's ShareLink. No sound and no
 * knock, as on iOS: the sheet opening is the feedback.
 *
 * A phone with nothing that can take text (rare, but a locked-down device
 * exists) gets it on the clipboard instead, and `onCopiedInstead` is where
 * the caller says so — the web's words for it are "Invite copied".
 */
fun shareText(context: Context, text: String, onCopiedInstead: () -> Unit = {}) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    val chooser = Intent.createChooser(send, null)
    if (context.findActivity() == null) chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val opened = runCatching { context.startActivity(chooser) }.isSuccess
    if (!opened && putOnClipboard(context, text)) onCopiedInstead()
}

/**
 * Copies `text` with iOS's feedback: a light knock, then the confirmation.
 *
 * `confirm` is the caller's toast in iOS's words ("Friend code copied"). It
 * runs below Android 13 only: from 13 on the system shows its own copied
 * confirmation for every clipboard write, and Android's guidance is that an
 * app does not add a second one. That is the one place this differs from
 * iOS, and it is the platform's difference, not the app's.
 */
fun copyText(context: Context, text: String, confirm: () -> Unit) {
    if (!putOnClipboard(context, text)) return
    Haptics.tap()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) confirm()
}

private fun putOnClipboard(context: Context, text: String): Boolean {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
    return runCatching { clipboard.setPrimaryClip(ClipData.newPlainText("MoneyMove", text)) }.isSuccess
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/**
 * The small arrow on a row that goes somewhere — iOS's chevron.right. The
 * drawn set has no arrow in it, so this is two strokes in whatever ink the
 * row asks for rather than a character standing in for one. `size` is its
 * height; it is a little over half as wide.
 */
@Composable
fun RowChevron(tint: Color, size: Dp = 12.dp) {
    Canvas(Modifier.size(width = size * 0.62f, height = size)) {
        val w = this.size.width
        val h = this.size.height
        val stroke = h * 0.17f
        val half = stroke / 2
        val path = Path().apply {
            moveTo(half, half)
            lineTo(w - half, h / 2)
            lineTo(half, h - half)
        }
        drawPath(path, tint, style = Stroke(width = stroke, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}
