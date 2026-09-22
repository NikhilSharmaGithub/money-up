package com.moneymove.game

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color

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

object P {
    val current: Palette
        @Composable get() = LocalPalette.current
}

@Composable
fun MoneyMoveTheme(theme: MMTheme, dark: Boolean, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalPalette provides if (dark) theme.dark else theme.light) {
        content()
    }
}
