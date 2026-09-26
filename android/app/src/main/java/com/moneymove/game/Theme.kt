package com.moneymove.game

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.pow

/**
 * The design system, ported whole from the iOS app so the two clients are the
 * same product rather than two products that share a server: the same seven
 * table styles, each with its own light and dark palette, the same slot names,
 * and the same hex values down to the digit.
 *
 * The slots are deliberately semantic — `card`, `ink2`, `rule` — rather than
 * named after a colour. A table style swaps seventeen of them and everything
 * built out of them follows, which is why switching from Midnight Felt to
 * Crimson Classic restyles the board, the sheets and the buttons at once
 * without a single view knowing a style exists.
 */
data class Palette(
    // surfaces
    val page: Color,        // screen background
    val page2: Color,       // deep edge of the page gradient
    val card: Color,        // panels / tiles
    val sheet: Color,       // background of presented sheets
    val sunken: Color,      // recessed areas inside a card
    val boardBG: Color,     // board frame fill

    // text
    val ink: Color,
    val ink2: Color,
    val ink3: Color,

    // hairlines
    val rule: Color,
    val rule2: Color,

    // brand + semantics
    val red: Color,
    val redDeep: Color,
    val redSoft: Color,
    /** Text that sits ON the accent (dark on brass, white on purple…). */
    val accentInk: Color,
    val good: Color,
    val goodSoft: Color,
    val bad: Color,
    val badSoft: Color,
    val gold: Color,
    val goldSoft: Color,

    // special tile faces
    val tileTreasure: Color,
    val tileSurprise: Color,
    val tileTax: Color,
    val tileRefund: Color,
    val tileStart: Color,
    val tileGoto: Color,
    val tileVacation: Color,
    val tileJail: Color,
    val tileCorner: Color,
)

private fun hex(v: Long): Color = Color(0xFF000000L or v)

/**
 * Builds a full palette from the ~17 slots a table style actually swaps; the
 * semantic greens and reds and the special tile faces are shared per mode, so
 * a Treasure tile looks like a Treasure tile on all seven tables.
 */
@Suppress("LongParameterList")
private fun themed(
    dark: Boolean,
    page: Long, page2: Long, card: Long, sheet: Long, sunken: Long,
    boardBG: Long, tileCorner: Long,
    ink: Long, ink2: Long, ink3: Long, rule: Long, rule2: Long,
    red: Long, redDeep: Long, redSoft: Long, accentInk: Long,
    gold: Long, goldSoft: Long,
): Palette = Palette(
    page = hex(page), page2 = hex(page2),
    card = hex(card), sheet = hex(sheet), sunken = hex(sunken), boardBG = hex(boardBG),
    ink = hex(ink), ink2 = hex(ink2), ink3 = hex(ink3),
    rule = hex(rule), rule2 = hex(rule2),
    red = hex(red), redDeep = hex(redDeep), redSoft = hex(redSoft),
    accentInk = hex(accentInk),
    good = if (dark) hex(0x4FD98B) else hex(0x177C4D),
    goodSoft = if (dark) hex(0x14291E) else hex(0xE4F3EA),
    bad = if (dark) hex(0xE25A6D) else hex(0xBF3A4E),
    badSoft = if (dark) hex(0x2D161B) else hex(0xFBE9EC),
    gold = hex(gold), goldSoft = hex(goldSoft),
    tileTreasure = if (dark) hex(0x2C2413) else hex(0xF7EDD8),
    tileSurprise = if (dark) hex(0x2A1D2C) else hex(0xF3E4F1),
    tileTax = if (dark) hex(0x2E1B1F) else hex(0xF6E3E5),
    tileRefund = if (dark) hex(0x14291E) else hex(0xE4F3EA),
    tileStart = if (dark) hex(0x153125) else hex(0xE2F2E8),
    tileGoto = if (dark) hex(0x331B21) else hex(0xF6E3E7),
    tileVacation = if (dark) hex(0x122C2A) else hex(0xE0F0EE),
    tileJail = if (dark) hex(0x1C2433) else hex(0xE8EBF4),
    tileCorner = hex(tileCorner),
)

/** The seven table styles — every one has its own light AND dark. */
enum class MMTheme(val id: String, val title: String, val dot: Color) {
    FELT("felt", "Midnight Felt", Color(0xFF2E7D5B)),
    CRIMSON("crimson", "Crimson Classic", Color(0xFFD92037)),
    ROYALE("royale", "Purple Royale", Color(0xFF8B5CF6)),
    BLUSH("blush", "Blush Pink", Color(0xFFF472B6)),
    MARINE("marine", "Deep Marine", Color(0xFF38BDF8)),
    SANDS("sands", "Desert Sands", Color(0xFFF59E0B)),
    NOIR("noir", "Silver Noir", Color(0xFFC9A86A));

    val dark: Palette
        get() = when (this) {
            FELT -> themed(true,
                page = 0x0C1310, page2 = 0x070B09, card = 0x16211C, sheet = 0x101915, sunken = 0x1D2B25,
                boardBG = 0x121D18, tileCorner = 0x223129,
                ink = 0xEFEDE2, ink2 = 0xADB6AC, ink3 = 0x78827A, rule = 0x24332C, rule2 = 0x31453C,
                red = 0xE3A93C, redDeep = 0xC08A25, redSoft = 0x2E2718, accentInk = 0x201607,
                gold = 0xD9A13A, goldSoft = 0x2C2413)
            CRIMSON -> themed(true,
                page = 0x150A0E, page2 = 0x0D0508, card = 0x211319, sheet = 0x1A0E13, sunken = 0x2B1A21,
                boardBG = 0x1A0E13, tileCorner = 0x33202A,
                ink = 0xF4EAED, ink2 = 0xBDA8B0, ink3 = 0x8D757E, rule = 0x382330, rule2 = 0x4A2F3C,
                red = 0xF04156, redDeep = 0xC4243A, redSoft = 0x3A1620, accentInk = 0xFFFFFF,
                gold = 0xFBBF24, goldSoft = 0x35240D)
            ROYALE -> themed(true,
                page = 0x14101F, page2 = 0x0B0814, card = 0x201A33, sheet = 0x191430, sunken = 0x2A2342,
                boardBG = 0x191430, tileCorner = 0x2E2647,
                ink = 0xEFECF7, ink2 = 0xB3ACCC, ink3 = 0x7D7699, rule = 0x322A4D, rule2 = 0x453A66,
                red = 0x8B5CF6, redDeep = 0x6D3FD6, redSoft = 0x251B3E, accentInk = 0xFFFFFF,
                gold = 0xD9A13A, goldSoft = 0x2C2413)
            BLUSH -> themed(true,
                page = 0x1D1016, page2 = 0x120A0E, card = 0x2B1A23, sheet = 0x241419, sunken = 0x37222D,
                boardBG = 0x241419, tileCorner = 0x3A2430,
                ink = 0xF7ECF1, ink2 = 0xCFACBD, ink3 = 0x97768A, rule = 0x43293A, rule2 = 0x58374B,
                red = 0xF472B6, redDeep = 0xD6479A, redSoft = 0x3A1E2F, accentInk = 0x2C0B1E,
                gold = 0xE3A93C, goldSoft = 0x2E2718)
            MARINE -> themed(true,
                page = 0x0B1220, page2 = 0x070B15, card = 0x14202F, sheet = 0x101B2B, sunken = 0x1C2B3F,
                boardBG = 0x101B2B, tileCorner = 0x1F2E40,
                ink = 0xE9EEF6, ink2 = 0xA9B8CC, ink3 = 0x74839A, rule = 0x24354B, rule2 = 0x314763,
                red = 0x38BDF8, redDeep = 0x1D94CF, redSoft = 0x14293A, accentInk = 0x06202E,
                gold = 0xD9A13A, goldSoft = 0x2C2413)
            SANDS -> themed(true,
                page = 0x191307, page2 = 0x100C04, card = 0x272013, sheet = 0x201A0E, sunken = 0x33291A,
                boardBG = 0x201A0E, tileCorner = 0x362C1C,
                ink = 0xF5EFE2, ink2 = 0xC8BBA0, ink3 = 0x93876E, rule = 0x3D321F, rule2 = 0x52432A,
                red = 0xF59E0B, redDeep = 0xCC7F06, redSoft = 0x332508, accentInk = 0x241700,
                gold = 0xF59E0B, goldSoft = 0x332508)
            NOIR -> themed(true,
                page = 0x101113, page2 = 0x0A0B0C, card = 0x1B1D20, sheet = 0x17181B, sunken = 0x25282C,
                boardBG = 0x17181B, tileCorner = 0x292C30,
                ink = 0xF0F1F2, ink2 = 0xB3B8BD, ink3 = 0x7D8288, rule = 0x2E3237, rule2 = 0x414750,
                red = 0xC9A86A, redDeep = 0xA8874A, redSoft = 0x2A2519, accentInk = 0x1E1809,
                gold = 0xC9A86A, goldSoft = 0x2A2519)
        }

    val light: Palette
        get() = when (this) {
            FELT -> themed(false,
                page = 0xEFE9DC, page2 = 0xE2DAC9, card = 0xFFFFFF, sheet = 0xF7F3EA, sunken = 0xEFE9DE,
                boardBG = 0xFDFBF4, tileCorner = 0xFFFEF9,
                ink = 0x201F1A, ink2 = 0x5C5B50, ink3 = 0x92917F, rule = 0xE4DECE, rule2 = 0xD2CAB6,
                red = 0xB58223, redDeep = 0x93690F, redSoft = 0xF7EDD8, accentInk = 0x201607,
                gold = 0xA97B1D, goldSoft = 0xF7EDD8)
            CRIMSON -> themed(false,
                page = 0xF6E7E9, page2 = 0xEFD6DA, card = 0xFFFFFF, sheet = 0xFAF1F2, sunken = 0xF4EEEA,
                boardBG = 0xFFFAF7, tileCorner = 0xFFFDFB,
                ink = 0x1E1A1C, ink2 = 0x5F5359, ink3 = 0x948890, rule = 0xE9E0DB, rule2 = 0xD8CAC3,
                red = 0xD92037, redDeep = 0xA4142A, redSoft = 0xFDECEE, accentInk = 0xFFFFFF,
                gold = 0xB7791F, goldSoft = 0xFDF3E0)
            ROYALE -> themed(false,
                page = 0xEAE6F4, page2 = 0xDCD5EC, card = 0xFFFFFF, sheet = 0xF3F0FA, sunken = 0xEFECF7,
                boardBG = 0xFCFBFF, tileCorner = 0xFDFCFF,
                ink = 0x1D1A26, ink2 = 0x575168, ink3 = 0x8F89A3, rule = 0xE2DDEF, rule2 = 0xCEC6E3,
                red = 0x6D3FD6, redDeep = 0x5530AB, redSoft = 0xEFE8FD, accentInk = 0xFFFFFF,
                gold = 0xA97B1D, goldSoft = 0xF4EDD8)
            BLUSH -> themed(false,
                page = 0xF7E8EE, page2 = 0xEFD8E2, card = 0xFFFFFF, sheet = 0xFBF2F6, sunken = 0xF7EDF2,
                boardBG = 0xFFFBFD, tileCorner = 0xFFFDFE,
                ink = 0x241A20, ink2 = 0x67535D, ink3 = 0xA08892, rule = 0xF0DDE6, rule2 = 0xE2C7D4,
                red = 0xD6479A, redDeep = 0xB02C7A, redSoft = 0xFBE7F2, accentInk = 0xFFFFFF,
                gold = 0xB7791F, goldSoft = 0xFDF3E0)
            MARINE -> themed(false,
                page = 0xE2EBF2, page2 = 0xD2DFE9, card = 0xFFFFFF, sheet = 0xEFF4F8, sunken = 0xEBF1F6,
                boardBG = 0xFBFDFF, tileCorner = 0xFCFEFF,
                ink = 0x16202A, ink2 = 0x4E5F6E, ink3 = 0x84939F, rule = 0xDDE7EE, rule2 = 0xC6D6E2,
                red = 0x1D94CF, redDeep = 0x14719F, redSoft = 0xE2F3FC, accentInk = 0xFFFFFF,
                gold = 0xA97B1D, goldSoft = 0xF4EDD8)
            SANDS -> themed(false,
                page = 0xF2E9D8, page2 = 0xE7DAC2, card = 0xFFFDF8, sheet = 0xF8F1E4, sunken = 0xF4EDDE,
                boardBG = 0xFFFCF3, tileCorner = 0xFFFEF9,
                ink = 0x241E12, ink2 = 0x665C46, ink3 = 0x998C70, rule = 0xEADFC9, rule2 = 0xD9C9A9,
                red = 0xB97509, redDeep = 0x935C05, redSoft = 0xFAEED6, accentInk = 0xFFFFFF,
                gold = 0xB97509, goldSoft = 0xFAEED6)
            NOIR -> themed(false,
                page = 0xE8E8E6, page2 = 0xD9D9D6, card = 0xFFFFFF, sheet = 0xF3F3F1, sunken = 0xF0F0EE,
                boardBG = 0xFCFCFB, tileCorner = 0xFDFDFC,
                ink = 0x1B1B1A, ink2 = 0x56565A, ink3 = 0x8E8E91, rule = 0xE2E2DF, rule2 = 0xCCCCC8,
                red = 0x8A6A2F, redDeep = 0x6D5325, redSoft = 0xF2EAD9, accentInk = 0xFFFFFF,
                gold = 0x8A6A2F, goldSoft = 0xF2EAD9)
        }

    companion object {
        fun from(id: String?): MMTheme = entries.firstOrNull { it.id == id } ?: FELT
    }
}

/**
 * Light, dark, or follow the phone — the one switch that decides which of a
 * table style's two palettes the whole app wears.
 */
enum class MMAppearance(val id: String, val title: String, val caption: String) {
    SYSTEM("system", "System", "Follows your phone"),
    LIGHT("light", "Light", "Always the daytime table"),
    DARK("dark", "Dark", "Always the night table");

    companion object {
        fun from(id: String?): MMAppearance = entries.firstOrNull { it.id == id } ?: SYSTEM
    }
}

/**
 * The palette in scope. Read it with `P.current` inside any composable; the
 * root provides it and rebuilds the tree when the style or appearance
 * changes, exactly as the iOS root does.
 */
val LocalPalette: ProvidableCompositionLocal<Palette> =
    compositionLocalOf { MMTheme.FELT.dark }

/**
 * The ring a medallion wears so a pale flag does not dissolve into a pale
 * tile. Light tables get a white rim, dark tables the board's own felt.
 */
fun Palette.tileFace(): Color = tileCorner

object P {
    val current: Palette
        @Composable get() = LocalPalette.current
}

@Composable
fun MoneyMoveTheme(theme: MMTheme, dark: Boolean, content: @Composable () -> Unit) {
    CompositionLocalProvider(
        LocalPalette provides theme.palette(dark),
        // The glass needs the table itself, not just the palette it is wearing:
        // a bar over a bright ad frame inside a Midnight Felt night table wears
        // the LIGHT face, and its ink has to come from the light palette of the
        // same table. Handing down only one of the two would make that
        // impossible to express.
        LocalTheme provides theme,
        LocalAppearanceDark provides dark,
    ) {
        content()
    }
}

// ---------------------------------------------------------------------------
// Liquid Glass — the token set
//
// Nine colours and a dozen scalars per palette, and not one of them is typed
// out by hand. Seven tables times light and dark is fourteen palettes; hand
// authoring the glass would have been 126 hexes on this client alone and 378
// across the three, and they would have drifted inside a month. Everything
// below is derived, by the same six formulas the iOS and web clients use, from
// slots the palettes already carry — so the three clients cannot disagree
// unless somebody edits the formula.
// ---------------------------------------------------------------------------

/**
 * Which of the material's two faces a piece of glass is wearing.
 *
 * This is not the app's light/dark setting. A bar floating over a rewarded
 * video wears the light face while the rest of a Midnight Felt night table
 * stays dark, because the material takes its cue from whatever is behind *it*,
 * one surface at a time. That per-surface flip is the single property that
 * separates glass from a blur: photograph a bar over the cream paper and the
 * same bar over the dark felt board, and if the two look the same, what got
 * built is a frost.
 */
enum class GlassAppearance { Light, Dark }

/**
 * Regular carries its own film and adapts. Clear is mostly backdrop and does
 * not — which is why it is banned over [BackdropKind.Media], where it measured
 * 2.85:1 against a dimmed bright frame.
 */
enum class GlassVariant { Regular, Clear }

/**
 * What we *placed* behind a piece of glass.
 *
 * Nothing here reads pixels. The app owns every pixel behind every bar, so the
 * backdrop is declared at the call site and its luminance comes straight out
 * of the palette. That is why the adaptive flip behaves identically on an
 * API 24 phone that has no blur at all and on an API 34 one running the whole
 * lens — the flip is information, not an optical effect, and it survives every
 * tier.
 */
enum class BackdropKind {
    /** The page gradient, `page` → `page2`. A linear ramp; its luminance is exact. */
    Page,

    /** Scrolling content cards — a `Panel` over the page. */
    Paper,

    /** The live board. */
    Felt,

    /** A sheet platter. */
    Sheet,

    /** Ads, rewarded video, avatar photos. Unpredictable pixels; see [luminance]. */
    Media,

    /** Over another bar. Rare, and never stack glass on glass — this is for the exceptions. */
    Chrome,
}

/** The palette this table wears in the given mode. */
fun MMTheme.palette(dark: Boolean): Palette = if (dark) this.dark else this.light

/**
 * WCAG relative luminance — the same number the 1,225-backdrop contrast sweep
 * was run against, so a value measured there means the same thing here.
 */
fun Color.relativeLuminance(): Float {
    fun channel(v: Float): Float =
        if (v <= 0.03928f) v / 12.92f else ((v + 0.055f) / 1.055f).pow(2.4f)
    return 0.2126f * channel(red) + 0.7152f * channel(green) + 0.0722f * channel(blue)
}

/**
 * A straight component mix in sRGB.
 *
 * Compose's own `lerp(Color, Color, Float)` interpolates through Oklab, which
 * is the better answer for a gradient and the wrong answer here: the published
 * token table was computed as a plain component mix, and a perceptual path
 * between the same two endpoints lands somewhere else. Every glass colour in
 * this file goes through this function so the three clients agree to the digit.
 */
internal fun mixSrgb(a: Color, b: Color, t: Float): Color = Color(
    red = a.red + (b.red - a.red) * t,
    green = a.green + (b.green - a.green) * t,
    blue = a.blue + (b.blue - a.blue) * t,
    alpha = 1f,
)

/**
 * The nine derived colours, for one table in one of the material's two faces.
 *
 * There is deliberately no `ink3` here. The quietest ink in the palette
 * measures 1.53:1 on the material — it is not quiet on glass, it is illegible
 * — so every hint and caption that lands on a bar promotes to [ink2], which
 * is itself lifted 62% of the way towards [ink] for the same reason.
 */
@Immutable
data class GlassTokens(
    val appearance: GlassAppearance,

    /**
     * The material's own colour, mixed 8% towards the table's brass.
     *
     * The brass is the one thing the fourteen palettes agree on: `gold` spans
     * 35.5°–43.3° of hue across all of them, while the accent slot spans 316°
     * (cyan on Deep Marine, violet on Purple Royale). Deriving the film from
     * the accent would give a different-coloured material on every table,
     * which is another way of saying no material at all.
     */
    val film: Color,

    /**
     * What the film composites to over the page at Regular's alpha — the
     * colour Reduce Transparency paints, designed rather than nudged.
     */
    val solid: Color,

    /** Body ink on the material. Worst case anywhere in the app: 8.00:1. */
    val ink: Color,

    /** Secondary ink, lifted 62% towards [ink]. Worst case: 5.82:1. */
    val ink2: Color,

    /**
     * The warm stop of the specular rim. Hue 39° on all fourteen tables: the
     * tint changes with the table, the brass reflection does not, because it
     * is a property of the light in the room and not of the surface.
     */
    val rimWarm: Color,
)

private fun computeGlass(p: Palette, appearance: GlassAppearance): GlassTokens {
    val film = if (appearance == GlassAppearance.Light) {
        // Light tables land between #F6F3EE and #F9F4ED — the warm cream paper
        // that is this app's identity, come back as the material itself.
        mixSrgb(Color.White, p.gold, 0.08f)
    } else {
        // Dark tables keep their own character: marine stays at 207°, royale at
        // 284°, while sands and noir land at 38–43° because those tables
        // already are brass.
        mixSrgb(mixSrgb(p.card, p.ink, 0.14f), p.gold, 0.08f)
    }
    return GlassTokens(
        appearance = appearance,
        film = film,
        solid = mixSrgb(p.page, film, GlassSpec.alpha(GlassVariant.Regular, appearance)),
        ink = p.ink,
        ink2 = mixSrgb(p.ink2, p.ink, 0.62f),
        rimWarm = p.gold,
    )
}

/**
 * This table's glass, in one of the two faces. Cached per table because it is
 * read once per glass surface per frame and the arithmetic, while cheap, is
 * not free.
 */
fun MMTheme.glass(appearance: GlassAppearance): GlassTokens =
    if (appearance == GlassAppearance.Dark) glassDarkTokens else glassLightTokens

private val MMTheme.glassLightTokens: GlassTokens
    get() = GlassCache.light.getOrPut(this) { computeGlass(light, GlassAppearance.Light) }

private val MMTheme.glassDarkTokens: GlassTokens
    get() = GlassCache.dark.getOrPut(this) { computeGlass(dark, GlassAppearance.Dark) }

private object GlassCache {
    val light = java.util.EnumMap<MMTheme, GlassTokens>(MMTheme::class.java)
    val dark = java.util.EnumMap<MMTheme, GlassTokens>(MMTheme::class.java)
}

/**
 * The luminance of what sits behind this backdrop, for this table in this mode.
 *
 * [BackdropKind.Media] is the one case we cannot know, so it is declared rather
 * than guessed: media always arrives under the mandatory 35% dim, and 35%
 * black over white lands at 0.38 — clear of the crossover in both directions,
 * so a bar over a video pins to the light face and stays there. That is the
 * safe pin: over a dimmed white frame the light face measures 11.43:1 and the
 * dark face only 4.4:1, and a bright frame is the case that actually turns up.
 */
fun BackdropKind.luminance(theme: MMTheme, dark: Boolean): Float {
    val p = theme.palette(dark)
    return when (this) {
        // The midpoint of the ramp. A Gaussian convolved with a linear ramp
        // returns the ramp, so for the page family this is not an approximation.
        BackdropKind.Page -> mixSrgb(p.page, p.page2, 0.5f).relativeLuminance()
        BackdropKind.Paper -> p.card.relativeLuminance()
        BackdropKind.Felt -> p.boardBG.relativeLuminance()
        BackdropKind.Sheet -> p.sheet.relativeLuminance()
        BackdropKind.Media -> GlassSpec.DIMMED_MEDIA_LUMINANCE
        BackdropKind.Chrome -> theme.glass(
            if (dark) GlassAppearance.Dark else GlassAppearance.Light
        ).solid.relativeLuminance()
    }
}

/**
 * The scalars: how opaque, how blurred, how bright the rim, how deep the
 * shadow — and the crossover that decides which face the material wears.
 *
 * These are shared with `Glass.swift` and `style.css` value for value. Change
 * one here and it has to change in all three, which is the point.
 */
object GlassSpec {

    // -- The adaptive crossover ---------------------------------------------
    //
    // At the film's alpha the light film dominates the composite, so the
    // break-even where dark glass stops beating light glass sits at L ≈ 0.068,
    // nowhere near mid-grey. Swept over 1,225 backdrops: at a 0.42 threshold
    // the worst case in the app is 4.38:1 and fails AA; at 0.07 it is 8.00:1
    // and clears AAA. The band between the two numbers below is hysteresis, so
    // a card drifting under a bar cannot make it stutter.

    /** Coming from the light face, go dark below this. */
    const val ENTER_DARK_BELOW = 0.062f

    /** Coming from the dark face, go light at or above this. */
    const val LEAVE_DARK_ABOVE = 0.078f

    /** First frame, no history. */
    const val COLD_START = 0.070f

    /** 35% black over a white frame. See [BackdropKind.luminance]. */
    const val DIMMED_MEDIA_LUMINANCE = 0.38f

    /**
     * The flip, with hysteresis. [previous] is null on the surface's first
     * frame.
     */
    fun appearanceFor(luminance: Float, previous: GlassAppearance?): GlassAppearance = when (previous) {
        GlassAppearance.Dark -> if (luminance < LEAVE_DARK_ABOVE) GlassAppearance.Dark else GlassAppearance.Light
        GlassAppearance.Light -> if (luminance < ENTER_DARK_BELOW) GlassAppearance.Dark else GlassAppearance.Light
        null -> if (luminance < COLD_START) GlassAppearance.Dark else GlassAppearance.Light
    }

    // -- Film ---------------------------------------------------------------

    /**
     * How much of the film, and so how little of the backdrop.
     *
     * Increase Contrast pushes it to 0.82/0.80 rather than turning the glass
     * off; Reduce Transparency is the setting that turns it off, and it does
     * so completely, with [GlassTokens.solid].
     */
    fun alpha(
        variant: GlassVariant,
        appearance: GlassAppearance,
        increaseContrast: Boolean = false,
    ): Float {
        val dark = appearance == GlassAppearance.Dark
        if (increaseContrast) return if (dark) 0.80f else 0.82f
        return when (variant) {
            GlassVariant.Regular -> if (dark) 0.60f else 0.62f
            GlassVariant.Clear -> if (dark) 0.26f else 0.30f
        }
    }

    // -- Backdrop optics ----------------------------------------------------

    /** Regular's blur. Over a live board it drops to [BLUR_OVER_BOARD]. */
    val BLUR: Dp = 20.dp

    /** The board is already busy; 20dp there is mush and costs more. */
    val BLUR_OVER_BOARD: Dp = 12.dp

    /** Clear barely blurs — it is mostly the backdrop, on purpose. */
    val BLUR_CLEAR: Dp = 10.dp

    fun blur(variant: GlassVariant, overLiveBoard: Boolean = false): Dp = when {
        variant == GlassVariant.Clear -> BLUR_CLEAR
        overLiveBoard -> BLUR_OVER_BOARD
        else -> BLUR
    }

    /** Vibrancy: the backdrop reads more saturated through the material. */
    fun saturation(variant: GlassVariant, appearance: GlassAppearance): Float {
        val dark = appearance == GlassAppearance.Dark
        return when (variant) {
            GlassVariant.Regular -> if (dark) 1.70f else 1.80f
            GlassVariant.Clear -> if (dark) 1.40f else 1.45f
        }
    }

    /** …and slightly lifted, more so on a dark table where there is less to lift. */
    fun brightness(variant: GlassVariant, appearance: GlassAppearance): Float {
        val dark = appearance == GlassAppearance.Dark
        return when (variant) {
            GlassVariant.Regular -> if (dark) 1.12f else 1.04f
            GlassVariant.Clear -> if (dark) 1.06f else 1.02f
        }
    }

    // -- The specular rim ---------------------------------------------------
    //
    // Additive, angular, and asymmetric. A constant-opacity 1dp border is a
    // sticker outline; what makes a rim read as a rim is that it is brighter
    // than the white behind it and hottest in two opposite corners.

    fun rimWidth(appearance: GlassAppearance): Dp =
        if (appearance == GlassAppearance.Dark) 1.25.dp else 1.0.dp

    /** The hot corner. On dark tables this is brass; on light ones, white. */
    const val RIM_HOT = 0.85f

    /** Below this the hot stop vanishes on noir and felt. */
    const val RIM_HOT_FLOOR_DARK = 0.35f

    /** The quarter turns between the hot corner and the bounce. */
    const val RIM_DIM = 0.10f

    /**
     * The far-edge bounce, always brass. Brass on glass measures 5.73–8.40 on
     * dark tables but only 3.22–4.36 on light ones, so in daylight the brass
     * steps back from the hot corner to here and white takes the hot stop.
     */
    fun rimBounce(appearance: GlassAppearance): Float =
        if (appearance == GlassAppearance.Dark) 0.53f else 0.30f

    /**
     * A second stroke, one dp in from the first, at this fraction of the hot
     * stop. This is what reads as *thickness*, and leaving it out is the
     * commonest way a hand-built glass comes out flat.
     */
    const val RIM_INNER = 0.35f
    val RIM_INNER_INSET: Dp = 1.dp
    val RIM_INNER_WIDTH: Dp = 1.dp

    /** For when the film and the backdrop happen to match and the rim alone is not enough. */
    val HAIRLINE: Dp = 0.5.dp

    fun hairline(appearance: GlassAppearance): Color =
        if (appearance == GlassAppearance.Dark) Color.White.copy(alpha = 0.08f)
        else Color.Black.copy(alpha = 0.10f)

    /** A top-weighted inner glow, for convexity. */
    fun glowAlpha(appearance: GlassAppearance): Float =
        if (appearance == GlassAppearance.Dark) 0.10f else 0.12f

    /**
     * How far down the glow reaches before it is gone. The spec draws a 4dp
     * band and blurs it by 4; a soft gradient over twice that span is the same
     * picture without an offscreen pass, which matters because tier 0 has no
     * blur to spend.
     */
    val GLOW_SPAN: Dp = 12.dp

    // -- Where the light is coming from -------------------------------------
    //
    // No gyroscope. Nobody can tell "the light moved because I scrolled" from
    // "because I tilted the phone", and this is a game people play for forty
    // minutes at a time; a 20 Hz sensor poll buys nothing.

    const val LIGHT_ANGLE = 135f

    /** Scroll swings the highlight this far and no further. */
    const val LIGHT_ANGLE_SWING = 22f

    /** A press throws it this far, and the rim catches up on the way back. */
    const val LIGHT_ANGLE_PRESS = 40f

    // -- The shadow ---------------------------------------------------------
    //
    // Two states, and it has to move between them: a shadow that never
    // deepens as content scrolls under the bar is a pasted card, and it is on
    // the reject list. Driven by scroll offset, board-busy or a sheet above —
    // never by a timer.

    fun shadowY(heightDp: Float, busy: Boolean): Dp =
        if (busy) (0.30f * heightDp).coerceIn(6f, 16f).dp
        else (0.22f * heightDp).coerceIn(4f, 12f).dp

    fun shadowBlur(heightDp: Float, busy: Boolean): Dp =
        if (busy) (2.2f * heightDp).coerceIn(16f, 44f).dp
        else (1.9f * heightDp).coerceIn(12f, 32f).dp

    fun shadowAlpha(appearance: GlassAppearance, busy: Boolean): Float {
        val dark = appearance == GlassAppearance.Dark
        return if (busy) (if (dark) 0.52f else 0.22f) else (if (dark) 0.30f else 0.10f)
    }

    // -- The lens -----------------------------------------------------------
    //
    // Edge refraction: the property that makes this a lens and not a 2013
    // frost. Displacement is exactly zero outside the rim band, which is what
    // turns it from an area cost into a perimeter one — a 390x700 sheet is
    // 26,160 rim pixels against 273,000 area pixels, and that tenfold is what
    // pays for the lens inside the frame budget.

    /** The band, in dp, measured inward from the edge. */
    fun lensBand(radiusDp: Float): Float = (0.50f * radiusDp).coerceIn(8f, 20f)

    /** Peak displacement, in dp. Thicker glass bends more. */
    fun lensPeak(bandDp: Float, minDimensionDp: Float): Float =
        (0.55f * bandDp).coerceIn(4f, 14f) * (minDimensionDp / 88f).coerceIn(0.70f, 1.35f)

    /** Below the size at which anybody could name it as fringing. */
    const val CHROMA_SPLIT_PX = 0.6f

    /** Smaller than this and the lens is invisible at the same cost per pixel. */
    val LENS_MIN_WIDTH: Dp = 20.dp
    val LENS_MIN_HEIGHT: Dp = 44.dp
}

/**
 * The table in scope, as opposed to the palette it happens to be wearing.
 * Glass needs both — see [MoneyMoveTheme].
 */
val LocalTheme: ProvidableCompositionLocal<MMTheme> = staticCompositionLocalOf { MMTheme.FELT }

/** Whether the app is currently on the night side of the table in scope. */
val LocalAppearanceDark: ProvidableCompositionLocal<Boolean> = staticCompositionLocalOf { true }
