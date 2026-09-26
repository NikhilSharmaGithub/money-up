package com.moneymove.game

import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import android.provider.Settings
import androidx.annotation.RequiresApi
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.ClipOp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.addOutline
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalGraphicsContext
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlin.math.ceil
import kotlin.math.min

/**
 * The material.
 *
 * Glass goes on navigation and on controls — bars, docks, chips, field wells,
 * the shell of a sheet. It never goes on content. The forty-tile board, a
 * deed, the table log, a leaderboard are the things the glass is floating
 * *over*; a glassy board is not a bolder use of the material, it is a misread
 * of what the material is for, and the surface map in the spec says which is
 * which for all ninety-seven surfaces on this client.
 *
 * Compose has no backdrop blur and no equivalent of `UIVisualEffectView`.
 * `Modifier.blur` is a `graphicsLayer` render effect: it blurs the node's own
 * content, so on a glass bar it blurs that bar's icons and labels, and below
 * API 31 it silently drops the blur but keeps the hard clip it sets — a visual
 * change on old phones that is easy to miss. So the backdrop is obtained the
 * only way it can be: [MMBackdropHost] records the page *once* per frame into
 * a quarter-scale layer, blurs that one layer once, and every glass surface
 * samples it at its own position. One record and one blur per frame for the
 * whole screen, rather than one per bar.
 *
 * Three tiers, and the bottom one is not an apology:
 *
 * - **API 24–30** — film, brass rim, inner highlight, shadow. No blur, because
 *   `RenderEffect` does not exist. This is honestly Apple's *Clear* variant,
 *   and over the flat page it is pixel-exact rather than approximate.
 * - **API 31–32** — the shared blurred backdrop above. Apple's *Regular*.
 * - **API 33+** — plus the AGSL lens: real edge refraction in the rim band.
 *
 * Nothing about the geometry changes between them. Radii, padding, ink, rim
 * and layout are identical at every tier and at every quality level, so
 * stepping down never reflows a single pixel of text.
 */

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

/**
 * How much of the optics we are currently paying for. Geometry is the same at
 * all four; only the optics change, so a step down is invisible apart from
 * getting sharper.
 */
enum class GlassLevel {
    /** Film, blur and lens. */
    Full,

    /** Film and blur, no lens. Thermals, or more than two lenses on screen. */
    Frost,

    /** Film only. Low power, low RAM, or a surface with a flat page behind it. */
    Flat,

    /** [GlassTokens.solid]. Reduce Transparency, which this app has to ask for itself. */
    Opaque,
}

/** Which end of the shadow a surface is sitting at. */
enum class GlassShadow {
    None,
    Relaxed,
    Busy,

    /** Follow [LocalGlassBusy] — scroll offset, board-busy, or a sheet above. */
    Auto,
}

// ---------------------------------------------------------------------------
// What the shell hands down
// ---------------------------------------------------------------------------

/**
 * The one blurred copy of the page, and where it starts in root coordinates.
 *
 * Handed down by [MMBackdropHost]. Null means there is nothing to sample and
 * the material falls back to tier 0, which is also what every sheet gets:
 * `ModalBottomSheet` runs in its own window, so `positionInRoot()` there
 * cannot reach this layer. That is the right answer anyway — a sheet covers
 * its own backdrop.
 */
@Stable
class MMBackdrop internal constructor(internal val blurred: GraphicsLayer) {
    /** Where the recorded region's top-left sits in the root, in pixels. */
    internal var originInRoot: Offset = Offset.Zero

    internal val recorded: Boolean get() = blurred.size.width > 0
}

val LocalBackdrop: ProvidableCompositionLocal<MMBackdrop?> = compositionLocalOf { null }

val LocalGlassLevel: ProvidableCompositionLocal<GlassLevel> =
    compositionLocalOf { GlassLevel.Full }

/**
 * Something is moving beneath the glass — content scrolling under a bar, a
 * sheet rising, the board mid-turn. The shadow deepens; nothing else changes.
 */
val LocalGlassBusy: ProvidableCompositionLocal<Boolean> = compositionLocalOf { false }

/**
 * The board is mid-theatre: dice tumbling, a token walking, a deck riffling.
 *
 * This freezes what the glass *refracts*, never the glass itself. The film,
 * the rim and the shadow all keep working; the backdrop simply stops
 * re-recording for the second or two the animation runs, which nobody can see
 * because they are watching the dice. Freezing the material instead — flipping
 * it to an opaque fill — would flicker several times per turn on the one
 * screen players actually stare at.
 */
val LocalBoardBusy: ProvidableCompositionLocal<Boolean> = compositionLocalOf { false }

/**
 * Increase Contrast. Android has no OS signal for it that is worth trusting
 * below API 31, so this is fed by the third row in Settings ▸ Appearance,
 * seeded from the high-contrast-text setting.
 */
val LocalIncreaseContrast: ProvidableCompositionLocal<Boolean> = compositionLocalOf { false }

/**
 * Where the light is coming from, in degrees.
 *
 * Driven by scroll offset and by presses — never by the gyroscope. Nobody can
 * tell a highlight that moved because they scrolled from one that moved
 * because they tilted the phone, and a 20 Hz sensor poll through a
 * forty-minute game is a real battery cost for a difference nobody can name.
 */
val LocalGlassLightAngle: ProvidableCompositionLocal<Float> =
    compositionLocalOf { GlassSpec.LIGHT_ANGLE }

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/**
 * The material's timings, shared with the other two clients.
 *
 * Two of these survive Reduce Motion unchanged, and deliberately: the tint
 * flip and the shadow's busy/relaxed change are both *information* — one says
 * what is behind the bar, the other says something is moving under it — and
 * turning information off is not an accessibility feature.
 */
object GlassMotion {

    /** The adaptive tint crossfade. Information; never reduced. */
    const val TINT_FLIP_MS = 280

    /** Shadow, relaxed ↔ busy. Information; reduced only to a slower linear ramp. */
    const val SHADOW_MS = 200

    /** A control becoming a sheet, or a dock changing phase. */
    const val MORPH_MS = 380

    const val PRESS_DOWN_MS = 110
    const val PRESS_UP_MS = 260
    const val APPEAR_MS = 340
    const val INDICATOR_MS = 320
    const val SHEET_IN_MS = 420
    const val SHEET_OUT_MS = 300
    const val SCROLL_EDGE_MS = 160

    /** Quality steps crossfade, so a tier change is not a visible event. */
    const val LEVEL_CHANGE_MS = 240

    /** The one-shot rim sweep on a turn change. Off entirely under Reduce Motion. */
    const val RIM_SWEEP_MS = 900

    /** What every morph and gel collapses to under Reduce Motion. */
    const val REDUCED_MS = 160

    /**
     * Surface tension, not a slide: damping 0.38 at a 0.78 s response, which
     * is a stiffness of (2π / 0.78)² ≈ 65. It lands in ~380 ms, which fits
     * inside [Choreography.CARD_HOLD] and clears [Choreography.SETTLE] — so a
     * glass morph can never race a board settle.
     */
    val morph: FiniteAnimationSpec<Float> = spring(dampingRatio = 0.38f, stiffness = 64.9f)

    /** The press gel: down hard, up past 1.0 and back. */
    const val PRESS_SCALE = 0.965f
    const val PRESS_SQUASH_X = 0.94f
    const val PRESS_SQUASH_Y = 1.03f
    const val PRESS_OVERSHOOT = 1.008f
}

/**
 * Whether the phone has asked for less movement. Android expresses this as a
 * zeroed animation scale rather than as an accessibility flag.
 */
@Composable
fun rememberReduceMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) {
        runCatching {
            Settings.Global.getFloat(resolver, Settings.Global.TRANSITION_ANIMATION_SCALE, 1f) == 0f
        }.getOrDefault(false)
    }
}

/**
 * The quality level this device starts at, before the shell's own governor
 * has anything to say. A low-RAM phone or Battery Saver goes flat; the user's
 * own Reduce Transparency row wins outright.
 */
@Composable
fun rememberBaseGlassLevel(reduceTransparency: Boolean = false): GlassLevel {
    val context = LocalContext.current
    return remember(context, reduceTransparency) {
        if (reduceTransparency) return@remember GlassLevel.Opaque
        val activity = context.getSystemService(android.app.ActivityManager::class.java)
        val power = context.getSystemService(android.os.PowerManager::class.java)
        val lowRam = activity?.isLowRamDevice == true
        val saving = power?.isPowerSaveMode == true
        when {
            lowRam || saving -> GlassLevel.Flat
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> GlassLevel.Full
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> GlassLevel.Frost
            else -> GlassLevel.Flat
        }
    }
}

// ---------------------------------------------------------------------------
// The shared backdrop
// ---------------------------------------------------------------------------

/** Quarter scale: 16x fewer pixels through the blur, and a 4x smaller kernel. */
private const val BACKDROP_SCALE = 0.25f
private const val BACKDROP_UPSCALE = 1f / BACKDROP_SCALE

/** The same trick for the drop shadow, which tolerates it even better. */
private const val SHADOW_SCALE = 0.25f

/**
 * Hosts the one blurred copy of the page that every glass surface samples.
 *
 * [backdrop] is everything the glass floats over — the page gradient and the
 * scrolling content. [content] is the glass chrome, and it is a *sibling*
 * drawn above, never part of the recording. That separation is the whole
 * design: record the root instead and the blurred copy each bar samples
 * contains last frame's glass, which is video feedback on exactly the surfaces
 * this material is about, and the entire app draws twice per recorded frame
 * into the bargain.
 *
 * Below API 31 this is a plain [Box] and costs nothing: there is no
 * `RenderEffect` to blur with, so there is no point recording anything.
 */
@Composable
fun MMBackdropHost(
    modifier: Modifier = Modifier,
    backdrop: @Composable BoxScope.() -> Unit,
    content: @Composable BoxScope.() -> Unit,
) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        RecordingBackdropHost(modifier, backdrop, content)
    } else {
        Box(modifier) {
            backdrop()
            content()
        }
    }
}

@RequiresApi(Build.VERSION_CODES.S)
@Composable
private fun RecordingBackdropHost(
    modifier: Modifier,
    backdrop: @Composable BoxScope.() -> Unit,
    content: @Composable BoxScope.() -> Unit,
) {
    val graphics = LocalGraphicsContext.current
    val source = remember(graphics) { graphics.createGraphicsLayer() }
    val blurred = remember(graphics) { graphics.createGraphicsLayer() }
    val handle = remember(blurred) { MMBackdrop(blurred) }
    DisposableEffect(graphics) {
        onDispose {
            graphics.releaseGraphicsLayer(source)
            graphics.releaseGraphicsLayer(blurred)
        }
    }

    val level = LocalGlassLevel.current
    val boardBusy = LocalBoardBusy.current
    val appDark = LocalAppearanceDark.current
    val appearance = if (appDark) GlassAppearance.Dark else GlassAppearance.Light
    val density = LocalDensity.current

    // The 20dp blur, taken at quarter scale: on a 2.6x screen that is a radius
    // of 13 against the 52 it would have cost at full size. A 20dp Gaussian
    // has already destroyed everything finer than that, so nothing is lost.
    val radius = with(density) { GlassSpec.blur(GlassVariant.Regular).toPx() } * BACKDROP_SCALE
    val effect = remember(radius, appearance) {
        BackdropOptics.effect(
            blurRadiusPx = radius.coerceAtLeast(0.5f),
            saturation = GlassSpec.saturation(GlassVariant.Regular, appearance),
            brightness = GlassSpec.brightness(GlassVariant.Regular, appearance),
        )
    }

    val recording = level == GlassLevel.Full || level == GlassLevel.Frost

    Box(modifier) {
        val outer = this
        Box(
            Modifier
                .fillMaxSize()
                .onGloballyPositioned { handle.originInRoot = it.positionInRoot() }
                .drawWithCache {
                    onDrawWithContent {
                        val w = size.width
                        val h = size.height
                        if (recording && !boardBusy && w >= 4f && h >= 4f) {
                            val target = IntSize(
                                ceil(w * BACKDROP_SCALE).toInt().coerceAtLeast(1),
                                ceil(h * BACKDROP_SCALE).toInt().coerceAtLeast(1),
                            )
                            source.record(target) {
                                scale(BACKDROP_SCALE, BACKDROP_SCALE, Offset.Zero) {
                                    this@onDrawWithContent.drawContent()
                                }
                            }
                            blurred.renderEffect = effect
                            blurred.record(target) { drawLayer(source) }
                        }
                        // The live, unblurred page. The glass samples the copy.
                        drawContent()
                    }
                },
            content = backdrop,
        )
        CompositionLocalProvider(LocalBackdrop provides handle) { outer.content() }
    }
}

// ---------------------------------------------------------------------------
// A surface's resolved face
// ---------------------------------------------------------------------------

/**
 * One glass surface's two faces and where it currently sits between them.
 *
 * Read [film], [ink], [ink2] and [rimWarm] off this for anything that has to
 * match the surface — a label on a bar, a glyph tint — and it will crossfade
 * in step with the material underneath it instead of snapping a frame early.
 * There is no `ink3`: the quietest ink measures 1.53:1 on the material, so
 * every caption that lands on glass promotes to [ink2].
 */
@Stable
class GlassSurface internal constructor(
    /** The face being crossfaded *to*. */
    val target: GlassAppearance,
    private val flipState: State<Float>,
    private val light: GlassTokens,
    private val dark: GlassTokens,
    private val appDark: Boolean,
) {
    /** 0 = fully light, 1 = fully dark, in between for 280 ms after a flip. */
    val flip: Float get() = flipState.value

    val film: Color get() = mixSrgb(light.film, dark.film, flip)
    val ink: Color get() = mixSrgb(light.ink, dark.ink, flip)
    val ink2: Color get() = mixSrgb(light.ink2, dark.ink2, flip)
    val rimWarm: Color get() = mixSrgb(light.rimWarm, dark.rimWarm, flip)

    /**
     * What Reduce Transparency paints. It follows the *app's* appearance, not
     * the backdrop's: an opaque surface has no backdrop left to adapt to, and
     * a cream slab on a night table would be the wrong answer twice.
     */
    val solid: Color get() = if (appDark) dark.solid else light.solid
}

/**
 * Resolve a declared backdrop into a face, with hysteresis and the 280 ms
 * crossfade.
 *
 * [Modifier.mmGlass] calls this for itself, so a label that calls it with the
 * same [backdrop] gets the same answer: the input is a pure function of the
 * table, the mode and the backdrop, and the hysteresis is idempotent, so two
 * copies of the state machine fed the same sequence cannot come apart.
 */
@Composable
fun rememberGlassSurface(backdrop: BackdropKind): GlassSurface {
    val theme = LocalTheme.current
    val appDark = LocalAppearanceDark.current
    val luminance = backdrop.luminance(theme, appDark)

    // Deliberately not snapshot state. The previous face is an input to a pure,
    // idempotent function of the luminance; writing it during composition
    // cannot invalidate anything, and holding it in a MutableState would
    // schedule a recomposition on every flip for no benefit.
    val history = remember { arrayOfNulls<GlassAppearance>(1) }
    val target = GlassSpec.appearanceFor(luminance, history[0])
    history[0] = target

    val flip = animateFloatAsState(
        targetValue = if (target == GlassAppearance.Dark) 1f else 0f,
        animationSpec = tween(GlassMotion.TINT_FLIP_MS),
        label = "mm.tint",
    )
    return remember(theme, appDark, target, flip) {
        GlassSurface(
            target = target,
            flipState = flip,
            light = theme.glass(GlassAppearance.Light),
            dark = theme.glass(GlassAppearance.Dark),
            appDark = appDark,
        )
    }
}

// ---------------------------------------------------------------------------
// The material
// ---------------------------------------------------------------------------

/**
 * Put glass behind this composable.
 *
 * Everything is drawn in `drawWithCache`, behind the content, and never as a
 * layer wrapping it: `Art.Icon()` is a `Canvas` per glyph and the tab bar
 * holds five of them, so wrapping content in a layer would re-render every one
 * of those offscreen on every frame the bar redraws.
 *
 * @param variant Regular carries its own film and adapts; Clear is mostly
 *   backdrop. Clear over [BackdropKind.Media] is silently promoted to Regular,
 *   because Clear does not adapt and measures 2.85:1 against a dimmed bright
 *   frame. The same applies to any glass carrying one of the thirty-two
 *   fixed-colour glyphs in `Art.kt` — pass Regular there.
 * @param backdrop What was *placed* behind this rect. This is the adaptive
 *   flip's only input, and getting it wrong is the one mistake that makes the
 *   material look like a blur.
 * @param shape Use the ladder in [MMShapes]; a child inset inside another
 *   glass surface wants [MMShapes.inner].
 * @param tint One semantic colour, at 14%. One per surface, and not on
 *   everything, or nothing on screen is primary any more.
 * @param lens Edge refraction. Costs a small layer and a shader per surface at
 *   API 33+, so turn it off on anything that is neither navigation nor the
 *   focus of the screen.
 */
fun Modifier.mmGlass(
    variant: GlassVariant = GlassVariant.Regular,
    backdrop: BackdropKind = BackdropKind.Page,
    shape: Shape = MMShapes.pill,
    tint: Color? = null,
    lens: Boolean = true,
    shadow: GlassShadow = GlassShadow.Auto,
): Modifier = composed {
    val surface = rememberGlassSurface(backdrop)
    val level = LocalGlassLevel.current
    val increaseContrast = LocalIncreaseContrast.current
    val handle = LocalBackdrop.current
    val lightAngle = LocalGlassLightAngle.current
    val busyNow = LocalGlassBusy.current
    val density = LocalDensity.current

    // Clear does not adapt, so it never goes over pixels we did not choose.
    val resolved = if (backdrop == BackdropKind.Media) GlassVariant.Regular else variant

    val busy = when (shadow) {
        GlassShadow.Busy -> true
        GlassShadow.Relaxed -> false
        GlassShadow.None -> false
        GlassShadow.Auto -> busyNow
    }
    val casting = shadow != GlassShadow.None

    val alphaLight = GlassSpec.alpha(resolved, GlassAppearance.Light, increaseContrast)
    val alphaDark = GlassSpec.alpha(resolved, GlassAppearance.Dark, increaseContrast)

    // A sheet lives in its own window and cannot reach the shared layer, so it
    // is permanently tier 0 — correct anyway, since a sheet covers its backdrop.
    val canSample = handle != null &&
        backdrop != BackdropKind.Sheet &&
        level != GlassLevel.Flat &&
        level != GlassLevel.Opaque &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val sampled = if (canSample) handle else null

    val lensing = lens &&
        canSample &&
        level == GlassLevel.Full &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    val shader = remember(lensing) {
        if (lensing && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            runCatching { GlassLens.shader() }.getOrNull()
        } else {
            null
        }
    }

    // Below API 31 there is no RenderEffect to build a shadow out of, so the
    // platform's own elevation shadow stands in. It couples its offset and its
    // blur together where the spec separates them, which on a tier-0 phone is
    // the smaller of the two compromises already being made.
    val legacyShadow = casting && Build.VERSION.SDK_INT < Build.VERSION_CODES.S
    val elevation = animateDpAsState(
        targetValue = if (busy) 14.dp else 8.dp,
        animationSpec = tween(GlassMotion.SHADOW_MS),
        label = "mm.shadow",
    ).value

    // Snapshot state rather than a plain field, so that a bar which moves
    // without otherwise changing still redraws and samples the backdrop at its
    // new position. Only the draw lambda reads it, so a move costs a redraw
    // and not a recomposition.
    val positionInRoot = remember { mutableStateOf(Offset.Zero) }

    Modifier
        .then(
            if (legacyShadow) {
                // Doubled because the platform multiplies its own ambient and
                // spot factors on top of whatever colour it is handed — and
                // below API 28 it ignores the colour entirely and only the
                // elevation above says anything at all.
                val shadowColour = Color.Black.copy(
                    alpha = (GlassSpec.shadowAlpha(surface.target, busy) * 2f).coerceAtMost(1f)
                )
                Modifier.shadow(
                    elevation = elevation,
                    shape = shape,
                    clip = false,
                    ambientColor = shadowColour,
                    spotColor = shadowColour,
                )
            } else Modifier
        )
        .onGloballyPositioned { positionInRoot.value = it.positionInRoot() }
        .drawWithCache {
            val outline = shape.createOutline(size, layoutDirection, this)
            val path = Path().apply { addOutline(outline) }
            val radiusPx = (shape as? MMCornerShape)?.radiusPx(size, this)
            val lensLayer = if (shader != null && radiusPx != null) obtainGraphicsLayer() else null
            val shadowLayer = if (casting && !legacyShadow) obtainGraphicsLayer() else null

            val heightDp = size.height / density.density
            val minDimDp = min(size.width, size.height) / density.density
            val bigEnough = size.width >= GlassSpec.LENS_MIN_WIDTH.toPx() &&
                size.height >= GlassSpec.LENS_MIN_HEIGHT.toPx()

            onDrawBehind {
                val flip = surface.flip
                val opaque = level == GlassLevel.Opaque

                if (shadowLayer != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    drawGlassShadow(shadowLayer, path, heightDp, busy, flip)
                }

                if (opaque) {
                    // Identical geometry, radius, shadow and layout: zero pixel
                    // shift, and the rim survives because on an opaque surface
                    // it is now legitimately a border.
                    drawPath(path, surface.solid)
                    drawPath(
                        path,
                        surface.rimWarm.copy(alpha = 0.30f),
                        style = Stroke(GlassSpec.rimWidth(surface.target).toPx()),
                    )
                    return@onDrawBehind
                }

                if (sampled != null && sampled.recorded) {
                    clipPath(path) {
                        if (lensLayer != null && shader != null && radiusPx != null && bigEnough &&
                            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                        ) {
                            drawLensedBackdrop(
                                layer = lensLayer,
                                shader = shader,
                                handle = sampled,
                                origin = positionInRoot.value,
                                radiusPx = radiusPx,
                                bandDp = GlassSpec.lensBand(radiusPx / density.density),
                                minDimDp = minDimDp,
                                density = density.density,
                            )
                        } else {
                            drawSharedBackdrop(sampled, positionInRoot.value)
                        }
                    }
                }

                drawPath(path, surface.film, alpha = lerpF(alphaLight, alphaDark, flip))
                tint?.let { drawPath(path, it, alpha = 0.14f) }
                drawGlassRim(path, surface, flip, lightAngle, increaseContrast)
                drawGlassGlow(path, surface, flip)
            }
        }
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

/** Sample the shared blurred page at this surface's own position. */
private fun DrawScope.drawSharedBackdrop(handle: MMBackdrop, origin: Offset) {
    val x = origin.x - handle.originInRoot.x
    val y = origin.y - handle.originInRoot.y
    // Both halves are load-bearing. The scale puts the quarter-size recording
    // back at screen size — which is also what turns its 13px kernel into the
    // 52px one the design asks for. Without the translate every surface on
    // screen samples the top-left corner of the page.
    scale(BACKDROP_UPSCALE, BACKDROP_UPSCALE, Offset.Zero) {
        translate(-x * BACKDROP_SCALE, -y * BACKDROP_SCALE) {
            drawLayer(handle.blurred)
        }
    }
}

/**
 * The same sample, run through the lens.
 *
 * The displacement is zero everywhere more than one band in from the edge, and
 * the shader returns early there — which is what makes this a perimeter cost
 * rather than an area one. A 390x700 sheet is 26,160 rim pixels against
 * 273,000 area pixels, and that tenfold is what pays for the lens inside the
 * frame budget.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private fun DrawScope.drawLensedBackdrop(
    layer: GraphicsLayer,
    shader: RuntimeShader,
    handle: MMBackdrop,
    origin: Offset,
    radiusPx: Float,
    bandDp: Float,
    minDimDp: Float,
    density: Float,
) {
    val target = IntSize(size.width.toInt().coerceAtLeast(1), size.height.toInt().coerceAtLeast(1))
    layer.record(target) { drawSharedBackdrop(handle, origin) }
    layer.renderEffect = GlassLens.effect(
        shader = shader,
        width = size.width,
        height = size.height,
        radiusPx = radiusPx,
        bandPx = bandDp * density,
        peakPx = GlassSpec.lensPeak(bandDp, minDimDp) * density,
    )
    drawLayer(layer)
}

/**
 * The specular rim: two additive strokes and a hairline.
 *
 * Additive because brighter-than-white is the whole difference between a rim
 * and a sticker outline, and angular because a rim that is the same opacity
 * all the way round is not reflecting anything. The hot corner is brass on a
 * dark table and white on a light one — brass on glass measures 5.73–8.40
 * against a night table but only 3.22–4.36 in daylight, where a literal gold
 * line turns to mush, so in the light the brass steps back to the far-edge
 * bounce and keeps its hue. The inset second stroke is what reads as
 * *thickness*; leaving it out is the commonest way a hand-built glass comes
 * out flat.
 */
private fun DrawScope.drawGlassRim(
    path: Path,
    surface: GlassSurface,
    flip: Float,
    lightAngle: Float,
    increaseContrast: Boolean,
) {
    val warm = surface.rimWarm
    val hot = mixSrgb(Color.White, warm, flip)
    val hotAlpha = if (flip > 0.5f) {
        GlassSpec.RIM_HOT.coerceAtLeast(GlassSpec.RIM_HOT_FLOOR_DARK)
    } else {
        GlassSpec.RIM_HOT
    }
    val bounce = lerpF(
        GlassSpec.rimBounce(GlassAppearance.Light),
        GlassSpec.rimBounce(GlassAppearance.Dark),
        flip,
    )
    val width = lerpF(
        GlassSpec.rimWidth(GlassAppearance.Light).toPx(),
        GlassSpec.rimWidth(GlassAppearance.Dark).toPx(),
        flip,
    ) * if (increaseContrast) 1.5f else 1f

    val brush = rimBrush(hot, warm, hotAlpha, bounce, lightAngle, center)
    drawPath(path, brush, style = Stroke(width), blendMode = BlendMode.Plus)

    // Scaling the path about its own centre rather than rebuilding it one dp
    // smaller: on a shape that is not square this stretches the corner radius
    // very slightly differently on the two axes, which at one dp against a
    // twenty-two dp corner is far below anything visible, and it saves
    // re-emitting the squircle every frame.
    val inset = GlassSpec.RIM_INNER_INSET.toPx()
    scale(
        scaleX = (size.width - inset * 2f) / size.width,
        scaleY = (size.height - inset * 2f) / size.height,
        pivot = center,
    ) {
        drawPath(
            path,
            rimBrush(hot, warm, hotAlpha * GlassSpec.RIM_INNER, bounce * GlassSpec.RIM_INNER, lightAngle, center),
            style = Stroke(GlassSpec.RIM_INNER_WIDTH.toPx()),
            blendMode = BlendMode.Plus,
        )
    }

    // For when the film and the backdrop happen to land on the same colour and
    // the rim alone has nothing to separate them.
    val hairAlpha = if (increaseContrast) 0.30f else 1f
    val hairWidth = if (increaseContrast) 1f else GlassSpec.HAIRLINE.toPx()
    val hair = mixColor(
        GlassSpec.hairline(GlassAppearance.Light),
        GlassSpec.hairline(GlassAppearance.Dark),
        flip,
    )
    drawPath(
        path,
        if (increaseContrast) hair.copy(alpha = hairAlpha) else hair,
        style = Stroke(hairWidth),
    )
}

/** A top-weighted inner glow, which is what reads as convexity. */
private fun DrawScope.drawGlassGlow(path: Path, surface: GlassSurface, flip: Float) {
    val alpha = lerpF(
        GlassSpec.glowAlpha(GlassAppearance.Light),
        GlassSpec.glowAlpha(GlassAppearance.Dark),
        flip,
    )
    val span = min(GlassSpec.GLOW_SPAN.toPx(), size.height * 0.5f)
    if (span <= 0f) return
    drawPath(
        path,
        Brush.verticalGradient(
            0f to mixSrgb(Color.White, surface.rimWarm, flip).copy(alpha = alpha),
            1f to Color.Transparent,
            startY = 0f,
            endY = span,
        ),
        blendMode = BlendMode.Plus,
    )
}

/**
 * The shadow, at API 31+, as a real Gaussian of the shape itself.
 *
 * Clipped to outside the silhouette, because the glass above it is translucent
 * and a shadow visible *through* its own caster is a thing no physical object
 * does. It has to move between its two states — a shadow that never deepens as
 * content scrolls beneath the bar is the giveaway that the bar is a pasted
 * card rather than a floating one.
 *
 * Taken at quarter scale, for the same reason the backdrop is: the busy end of
 * the scale is a 44dp blur, which on a 3x screen is a 113px kernel over a
 * full-width bar, and that is several times the entire glass frame budget on
 * its own. A shadow is the single most blur-tolerant thing on the screen, so
 * sixteen times fewer pixels through a four times smaller kernel costs
 * nothing anybody can see.
 */
@RequiresApi(Build.VERSION_CODES.S)
private fun DrawScope.drawGlassShadow(
    layer: GraphicsLayer,
    path: Path,
    heightDp: Float,
    busy: Boolean,
    flip: Float,
) {
    val offsetY = GlassSpec.shadowY(heightDp, busy).toPx()
    val alpha = lerpF(
        GlassSpec.shadowAlpha(GlassAppearance.Light, busy),
        GlassSpec.shadowAlpha(GlassAppearance.Dark, busy),
        flip,
    )
    // The spec's blur numbers are CSS box-shadow radii, i.e. twice the
    // Gaussian's sigma; Android's RenderEffect wants a radius that converts to
    // sigma as 0.577r, so the two conventions meet at 0.86x.
    val radius = (GlassSpec.shadowBlur(heightDp, busy).toPx() * 0.86f).coerceIn(0.5f, 140f)
    val pad = ceil(radius * 2f)
    val target = IntSize(
        ceil((size.width + pad * 2f) * SHADOW_SCALE).toInt().coerceAtLeast(1),
        ceil((size.height + pad * 2f) * SHADOW_SCALE).toInt().coerceAtLeast(1),
    )

    layer.record(target) {
        scale(SHADOW_SCALE, SHADOW_SCALE, Offset.Zero) {
            translate(pad, pad) { drawPath(path, Color.Black) }
        }
    }
    layer.renderEffect = BackdropOptics.blur(radius * SHADOW_SCALE)
    layer.alpha = alpha

    clipPath(path, ClipOp.Difference) {
        scale(1f / SHADOW_SCALE, 1f / SHADOW_SCALE, Offset.Zero) {
            translate(-pad * SHADOW_SCALE, (-pad + offsetY) * SHADOW_SCALE) {
                drawLayer(layer)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Rim maths
// ---------------------------------------------------------------------------

/**
 * The angular gradient, rotated to [angleDeg].
 *
 * Compose's sweep gradient has no angle, and rotating the canvas would rotate
 * the shape with it, so the rotation goes into the stop positions instead:
 * the pattern is cyclic, so shifting every stop by the same fraction of a turn
 * and re-closing the ends at whatever colour lands there is exact rather than
 * an approximation.
 */
private fun rimBrush(
    hot: Color,
    warm: Color,
    hotAlpha: Float,
    bounceAlpha: Float,
    angleDeg: Float,
    center: Offset,
): Brush {
    val phase = wrap01(angleDeg / 360f)
    val edge = rimColourAt(wrap01(-phase), hot, warm, hotAlpha, bounceAlpha)
    val stops = ArrayList<Pair<Float, Color>>(6)
    stops.add(0f to edge)
    listOf(0f, 0.25f, 0.5f, 0.75f)
        .map { wrap01(it + phase) to rimColourAt(it, hot, warm, hotAlpha, bounceAlpha) }
        .filter { it.first > 0.0005f && it.first < 0.9995f }
        .sortedBy { it.first }
        .forEach { stops.add(it) }
    stops.add(1f to edge)
    return Brush.sweepGradient(*stops.toTypedArray(), center = center)
}

/** Hot corner, quiet quarter, far-edge bounce, quiet quarter, back to hot. */
private fun rimColourAt(
    t: Float,
    hot: Color,
    warm: Color,
    hotAlpha: Float,
    bounceAlpha: Float,
): Color {
    val dim = GlassSpec.RIM_DIM
    val u = wrap01(t)
    val a = hot.copy(alpha = hotAlpha)
    val b = hot.copy(alpha = dim)
    val c = warm.copy(alpha = bounceAlpha)
    return when {
        u < 0.25f -> mixColor(a, b, u / 0.25f)
        u < 0.50f -> mixColor(b, c, (u - 0.25f) / 0.25f)
        u < 0.75f -> mixColor(c, b, (u - 0.50f) / 0.25f)
        else -> mixColor(b, a, (u - 0.75f) / 0.25f)
    }
}

private fun wrap01(v: Float): Float = ((v % 1f) + 1f) % 1f

private fun lerpF(a: Float, b: Float, t: Float): Float = a + (b - a) * t

/** [mixSrgb], but carrying alpha, which the rim needs and the film does not. */
private fun mixColor(a: Color, b: Color, t: Float): Color = Color(
    red = a.red + (b.red - a.red) * t,
    green = a.green + (b.green - a.green) * t,
    blue = a.blue + (b.blue - a.blue) * t,
    alpha = a.alpha + (b.alpha - a.alpha) * t,
)

// ---------------------------------------------------------------------------
// The API-gated pieces
//
// Both of these are separate objects touching framework classes that do not
// exist on older phones. Keeping them out of the enclosing class is what stops
// the verifier walking into a missing type while it loads `Glass.kt` on an
// API 24 device — the same shape `RenderEffectVerificationHelper` uses inside
// Compose itself.
// ---------------------------------------------------------------------------

@RequiresApi(Build.VERSION_CODES.S)
private object BackdropOptics {

    fun blur(radiusPx: Float): androidx.compose.ui.graphics.RenderEffect =
        android.graphics.RenderEffect
            .createBlurEffect(radiusPx, radiusPx, Shader.TileMode.DECAL)
            .asComposeRenderEffect()

    /**
     * Blur, then vibrancy. The backdrop reads more saturated and a little
     * brighter through the material — which is the one shared layer, so this
     * is Regular's column for the app's own appearance. Clear's slightly
     * gentler numbers are not worth a second full-screen record for a variant
     * whose lower alpha is already showing more of the true backdrop.
     */
    fun effect(
        blurRadiusPx: Float,
        saturation: Float,
        brightness: Float,
    ): androidx.compose.ui.graphics.RenderEffect {
        val blur = android.graphics.RenderEffect
            .createBlurEffect(blurRadiusPx, blurRadiusPx, Shader.TileMode.CLAMP)
        val matrix = ColorMatrix().apply { setSaturation(saturation) }
        matrix.postConcat(
            ColorMatrix(
                floatArrayOf(
                    brightness, 0f, 0f, 0f, 0f,
                    0f, brightness, 0f, 0f, 0f,
                    0f, 0f, brightness, 0f, 0f,
                    0f, 0f, 0f, 1f, 0f,
                )
            )
        )
        return android.graphics.RenderEffect
            .createColorFilterEffect(ColorMatrixColorFilter(matrix), blur)
            .asComposeRenderEffect()
    }
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private object GlassLens {

    /**
     * Edge-weighted displacement along the outward normal of a rounded-rect
     * signed distance field.
     *
     * The normal comes from analytic central differences on the SDF and not
     * from `dFdx`/`dFdy`: a screen-space derivative taken after the early
     * return above it is undefined in non-uniform control flow, and the
     * artefacts land exactly on the band boundary, which is the one place
     * anybody is looking. The displacement ramps as smoothstep squared, so it
     * is flat at the centre and steep at the rim — that shape is why a
     * straight line underneath bows near the edge and snaps straight in the
     * middle, which is the test that separates this from a blur.
     */
    private const val SOURCE = """
        uniform shader content;
        uniform float2 uSize;
        uniform float2 uBandPeak;
        uniform float uRadius;
        uniform float uSplit;

        float sdRoundRect(float2 p, float2 halfSize, float r) {
            float2 q = abs(p) - halfSize + r;
            return min(max(q.x, q.y), 0.0) + length(max(q, float2(0.0, 0.0))) - r;
        }

        half4 main(float2 pos) {
            float band = uBandPeak.x;
            float peak = uBandPeak.y;
            float2 halfSize = uSize * 0.5;
            float2 p = pos - halfSize;
            float sd = sdRoundRect(p, halfSize, uRadius);

            if (sd < -band) { return content.eval(pos); }

            float e = 1.0;
            float2 grad = float2(
                sdRoundRect(p + float2(e, 0.0), halfSize, uRadius) -
                sdRoundRect(p - float2(e, 0.0), halfSize, uRadius),
                sdRoundRect(p + float2(0.0, e), halfSize, uRadius) -
                sdRoundRect(p - float2(0.0, e), halfSize, uRadius)
            );
            float2 n = normalize(grad + float2(0.000001, 0.000001));

            float t = clamp((sd + band) / band, 0.0, 1.0);
            t = t * t * (3.0 - 2.0 * t);
            float off = peak * t * t;

            half4 c  = content.eval(pos - n * off);
            half4 cr = content.eval(pos - n * (off + uSplit));
            half4 cb = content.eval(pos - n * (off - uSplit));
            return half4(cr.r, c.g, cb.b, c.a);
        }
    """

    fun shader(): RuntimeShader = RuntimeShader(SOURCE)

    fun effect(
        shader: RuntimeShader,
        width: Float,
        height: Float,
        radiusPx: Float,
        bandPx: Float,
        peakPx: Float,
    ): androidx.compose.ui.graphics.RenderEffect {
        shader.setFloatUniform("uSize", width, height)
        shader.setFloatUniform("uBandPeak", bandPx, peakPx)
        shader.setFloatUniform("uRadius", radiusPx)
        shader.setFloatUniform("uSplit", GlassSpec.CHROMA_SPLIT_PX)
        return android.graphics.RenderEffect
            .createRuntimeShaderEffect(shader, "content")
            .asComposeRenderEffect()
    }
}
