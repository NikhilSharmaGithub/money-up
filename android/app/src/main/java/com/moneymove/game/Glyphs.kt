package com.moneymove.game

// GENERATED — do not edit by hand.
//
// The board's illustrations and the app's UI glyphs, taken straight from the
// web client's public/js/icons.js so all three platforms draw the same art on
// the same 32x32 grid. Emoji were the one thing making the board look generic:
// they carry another vendor's style, change per platform, and cannot take the
// table's palette. These are flat two-tone drawings that can.
//
// Regenerate with tools/gen-glyphs.mjs after changing icons.js.

/** One filled or stroked subpath of a glyph. `fill == INK` takes the tint. */
data class GlyphPart(
    val d: String,
    val fill: Long? = INK,
    val stroke: Long? = null,
    val strokeWidth: Float = 1f,
    val cap: Int = 0,          // 0 butt, 1 round, 2 square
    val join: Int = 0,         // 0 miter, 1 round, 2 bevel
    val dash: FloatArray? = null,
    val alpha: Float = 1f,
    val evenOdd: Boolean = false,
)

/** The sentinel that means "this stroke is ink, paint it in the tint". */
const val INK: Long = -1L

/**
 * Glyphs that keep a colour of their own on every table, in both modes: a
 * coin is gold everywhere, and a bronze medal that took the theme's ink would
 * just be a third silver one. Everything else is ink and takes the tint.
 */
val INHERENT_COLOUR: Set<String> = setOf(
    "airport", "bolt", "bulb", "cash", "coin", "crown",
    "droplet", "flame", "gotoprison", "heart", "hotel", "house",
    "island", "medalBronze", "medalGold", "medalSilver", "moon", "payment",
    "police", "prison", "refund", "sparkle", "start", "sun",
    "surprise", "tax", "toolbox", "treasure", "trophy", "turbine",
    "vacation", "warning",
)

val GLYPHS: Map<String, List<GlyphPart>> = mapOf(
    "airport" to listOf(
        GlyphPart("M16 2.6c1.5 0 2.4 1.6 2.4 3.6v5.4l10.2 5.6v3l-10.2-3v5.4l3 2.2v2.4L16 26l-5.4 1.2v-2.4l3-2.2v-5.4l-10.2 3v-3l10.2-5.6V6.2c0-2 .9-3.6 2.4-3.6z", fill = 0xFF3F6FAE),
    ),
    "bag" to listOf(
        GlyphPart("M11 11.4V9.6a5 5 0 0 1 10 0v1.8", fill = null, stroke = INK, strokeWidth = 2.4f, cap = 1),
        GlyphPart("M4.4 10.6h23.2l1.6 16a2.4 2.4 0 0 1-2.4 2.6H5.2a2.4 2.4 0 0 1-2.4-2.6z", fill = INK),
    ),
    "bank" to listOf(
        GlyphPart("M16 3.2 30.2 10.4v3H1.8v-3z", fill = INK),
        GlyphPart("M5.6 14.8h3.8v9.6h-3.8Z", fill = null, alpha = 0.34f),
        GlyphPart("M14.1 14.8h3.8v9.6h-3.8Z", fill = null, alpha = 0.34f),
        GlyphPart("M22.6 14.8h3.8v9.6h-3.8Z", fill = null, alpha = 0.34f),
        GlyphPart("M3.2 25.4h25.599999999999998a1.4 1.4 0 0 1 1.4 1.4v0.8000000000000003a1.4 1.4 0 0 1 -1.4 1.4h-25.599999999999998a1.4 1.4 0 0 1 -1.4 -1.4v-0.8000000000000003a1.4 1.4 0 0 1 1.4 -1.4Z", fill = INK),
    ),
    "bolt" to listOf(
        GlyphPart("M18.4 2.5 7 18h6.6l-1.4 11.5L25 13.4h-7l.4-10.9z", fill = 0xFFEAB308),
    ),
    "bulb" to listOf(
        GlyphPart("M16 2.8c-5.3 0-9.4 4-9.4 9 0 3.4 1.9 5.7 3.5 7.4 1 1.1 1.6 2 1.8 3.2h8.2c.2-1.2.8-2.1 1.8-3.2 1.6-1.7 3.5-4 3.5-7.4 0-5-4.1-9-9.4-9z", fill = 0xFFF5C542),
        GlyphPart("M13 23.6h6.000000000000001a1.4 1.4 0 0 1 1.4 1.4v0a1.4 1.4 0 0 1 -1.4 1.4h-6.000000000000001a1.4 1.4 0 0 1 -1.4 -1.4v0a1.4 1.4 0 0 1 1.4 -1.4Z", fill = 0xFF9A8149),
        GlyphPart("M14.100000000000001 26.8h3.8000000000000003a1.3 1.3 0 0 1 1.3 1.3v0a1.3 1.3 0 0 1 -1.3 1.3h-3.8000000000000003a1.3 1.3 0 0 1 -1.3 -1.3v0a1.3 1.3 0 0 1 1.3 -1.3Z", fill = 0xFF9A8149),
        GlyphPart("M13.4 11.8 16 16.2l2.6-4.4", fill = null, stroke = 0xFFFDF0C4, strokeWidth = 1.9f, cap = 1, join = 1),
    ),
    "cash" to listOf(
        GlyphPart("M4.2 7.5h23.6a2.2 2.2 0 0 1 2.2 2.2v12.6a2.2 2.2 0 0 1 -2.2 2.2h-23.6a2.2 2.2 0 0 1 -2.2 -2.2v-12.6a2.2 2.2 0 0 1 2.2 -2.2Z", fill = 0xFF2F8F5B),
        GlyphPart("M5.800000000000001 9.7h20.4a1.4 1.4 0 0 1 1.4 1.4v9.8a1.4 1.4 0 0 1 -1.4 1.4h-20.4a1.4 1.4 0 0 1 -1.4 -1.4v-9.8a1.4 1.4 0 0 1 1.4 -1.4Z", fill = 0xFF4FBB80),
        GlyphPart("M12.26 16a3.74 3.74 0 1 0 7.48 0a3.74 3.74 0 1 0 -7.48 0Z", fill = 0xFFEAF9F0),
    ),
    "chart" to listOf(
        GlyphPart("M4.6 17.2h3.2a1.6 1.6 0 0 1 1.6 1.6v8.399999999999999a1.6 1.6 0 0 1 -1.6 1.6h-3.2a1.6 1.6 0 0 1 -1.6 -1.6v-8.399999999999999a1.6 1.6 0 0 1 1.6 -1.6Z", fill = INK, alpha = 0.34f),
        GlyphPart("M14.4 11h3.2a1.6 1.6 0 0 1 1.6 1.6v14.600000000000001a1.6 1.6 0 0 1 -1.6 1.6h-3.2a1.6 1.6 0 0 1 -1.6 -1.6v-14.600000000000001a1.6 1.6 0 0 1 1.6 -1.6Z", fill = INK, alpha = 0.62f),
        GlyphPart("M24.200000000000003 4.4h3.2a1.6 1.6 0 0 1 1.6 1.6v21.2a1.6 1.6 0 0 1 -1.6 1.6h-3.2a1.6 1.6 0 0 1 -1.6 -1.6v-21.2a1.6 1.6 0 0 1 1.6 -1.6Z", fill = INK),
    ),
    "chat" to listOf(
        GlyphPart("M7.4 4.6h17.2a5 5 0 0 1 5 5v8.6a5 5 0 0 1 -5 5h-17.2a5 5 0 0 1 -5 -5v-8.6a5 5 0 0 1 5 -5ZM8 13.9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0ZM14 13.9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0ZM20 13.9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z", fill = INK, evenOdd = true),
        GlyphPart("M9.6 21.4h6.6l-4 7.4z", fill = INK),
    ),
    "close" to listOf(
        GlyphPart("M8.6 8.6 23.4 23.4M23.4 8.6 8.6 23.4", fill = null, stroke = INK, strokeWidth = 3.1f, cap = 1),
    ),
    "coin" to listOf(
        GlyphPart("M3 16a13 13 0 1 0 26 0a13 13 0 1 0 -26 0Z", fill = 0xFFDC9C1C),
        GlyphPart("M6 16a10 10 0 1 0 20 0a10 10 0 1 0 -20 0Z", fill = 0xFFF7C948),
        GlyphPart("M16 8.6v14.8", fill = null, stroke = 0xFFA9761A, strokeWidth = 2f, cap = 1),
        GlyphPart("M19.8 12.6c-.9-1.4-2.3-2.1-4-2.1-2.3 0-3.9 1.2-3.9 3 0 4.2 8 2 8 6.2 0 1.9-1.7 3.1-4.1 3.1-1.9 0-3.4-.8-4.3-2.2", fill = null, stroke = 0xFFA9761A, strokeWidth = 2f, cap = 1),
    ),
    "crane" to listOf(
        GlyphPart("M2.8 4.6h26.4V8H2.8z", fill = INK),
        GlyphPart("M25.4 8h3.8v3.6h-3.8Z", fill = INK, alpha = 0.5f),
        GlyphPart("M13.4 8h5.2v17.2h-5.2Z", fill = INK, alpha = 0.32f),
        GlyphPart("M8.4 8v6.2", fill = null, stroke = INK, strokeWidth = 1.8f),
        GlyphPart("M6.2 14.2h4.4a1.3 1.3 0 0 1 1.3 1.3v2.9999999999999996a1.3 1.3 0 0 1 -1.3 1.3h-4.4a1.3 1.3 0 0 1 -1.3 -1.3v-2.9999999999999996a1.3 1.3 0 0 1 1.3 -1.3Z", fill = INK),
        GlyphPart("M8.6 28.6 12.2 25h7.6l3.6 3.6z", fill = INK),
    ),
    "crown" to listOf(
        GlyphPart("M2.6 24 5.4 8.8l6.4 5.4L16 5.2l4.2 9 6.4-5.4L29.4 24z", fill = 0xFFE8B52E),
        GlyphPart("M4.3 23.2h23.400000000000002a1.7 1.7 0 0 1 1.7 1.7v1.1999999999999997a1.7 1.7 0 0 1 -1.7 1.7h-23.400000000000002a1.7 1.7 0 0 1 -1.7 -1.7v-1.1999999999999997a1.7 1.7 0 0 1 1.7 -1.7Z", fill = 0xFFC98F16),
        GlyphPart("M14.1 18.4a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0 -3.8 0Z", fill = 0xFFFDE68A),
    ),
    "dice" to listOf(
        GlyphPart("M16.4 3.2h9a3.4 3.4 0 0 1 3.4 3.4v9a3.4 3.4 0 0 1 -3.4 3.4h-9a3.4 3.4 0 0 1 -3.4 -3.4v-9a3.4 3.4 0 0 1 3.4 -3.4ZM16.1 7.8a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0ZM22.7 14.4a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z", fill = INK, alpha = 0.3f, evenOdd = true),
        GlyphPart("M6.6 13h9a3.4 3.4 0 0 1 3.4 3.4v9a3.4 3.4 0 0 1 -3.4 3.4h-9a3.4 3.4 0 0 1 -3.4 -3.4v-9a3.4 3.4 0 0 1 3.4 -3.4ZM6.2 17.6a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0ZM12.8 17.6a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0ZM6.2 24.2a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0ZM12.8 24.2a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0Z", fill = INK, evenOdd = true),
    ),
    "door" to listOf(
        GlyphPart("M3.4 4.4h10a2 2 0 0 1 2 2v19.2a2 2 0 0 1-2 2h-10z", fill = INK, alpha = 0.32f),
        GlyphPart("M10.3 16a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z", fill = INK),
        GlyphPart("M18 16h10.4", fill = null),
        GlyphPart("M23.6 11 28.6 16l-5 5", fill = null),
    ),
    "droplet" to listOf(
        GlyphPart("M16 3c5.4 6.6 8.4 10.9 8.4 14.7A8.4 8.4 0 0 1 16 26a8.4 8.4 0 0 1-8.4-8.3C7.6 13.9 10.6 9.6 16 3z", fill = 0xFF5CC9F5),
        GlyphPart("M12.4 18.6c0 2.2 1.5 3.9 3.4 4.3", fill = null, stroke = 0xFFE0F6FF, strokeWidth = 1.8f, cap = 1),
    ),
    "eye" to listOf(
        GlyphPart("M16 6.8c6.7 0 12 4.3 14.2 9.2C28 20.9 22.7 25.2 16 25.2S4 20.9 1.8 16C4 11.1 9.3 6.8 16 6.8z", fill = INK, alpha = 0.3f),
        GlyphPart("M10.8 16a5.2 5.2 0 1 0 10.4 0a5.2 5.2 0 1 0 -10.4 0Z", fill = INK),
    ),
    "flame" to listOf(
        GlyphPart("M16 2.5c1.2 5.4-4 6.6-4 11.4 0-2.2-1.3-3.5-1.3-3.5-2 2.6-3.2 5.2-3.2 8A8.5 8.5 0 0 0 16 27a8.5 8.5 0 0 0 8.5-8.6c0-6.4-5.2-9.6-8.5-15.9z", fill = 0xFFFB923C),
        GlyphPart("M16 27a4.2 4.2 0 0 0 4.2-4.3c0-3-2.6-4.4-4.2-7.4-1.6 3-4.2 4.4-4.2 7.4A4.2 4.2 0 0 0 16 27z", fill = 0xFFFDE68A),
    ),
    "gavel" to listOf(
        GlyphPart("M24.6 16.4 29.2 9.9 17.4 1.6 12.8 8.1Z", fill = INK),
        GlyphPart("M19.6 12.1 12.7 21.9", fill = null, stroke = INK, strokeWidth = 3.6f, cap = 1),
        GlyphPart("M5.6 23.6h13.200000000000001a2.2 2.2 0 0 1 2.2 2.2v0.5999999999999996a2.2 2.2 0 0 1 -2.2 2.2h-13.200000000000001a2.2 2.2 0 0 1 -2.2 -2.2v-0.5999999999999996a2.2 2.2 0 0 1 2.2 -2.2Z", fill = INK, alpha = 0.34f),
    ),
    "globe" to listOf(
        GlyphPart("M3.0999999999999996 16a12.9 12.9 0 1 0 25.8 0a12.9 12.9 0 1 0 -25.8 0Z", fill = INK, alpha = 0.26f),
        GlyphPart("M3.0999999999999996 16a12.9 12.9 0 1 0 25.8 0a12.9 12.9 0 1 0 -25.8 0Z", fill = null),
        GlyphPart("M3.1 16h25.8", fill = null),
        GlyphPart("M16 3.1c3.6 3.5 5.7 8 5.7 12.9S19.6 25.4 16 28.9c-3.6-3.5-5.7-8-5.7-12.9S12.4 6.6 16 3.1z", fill = null),
    ),
    "gotoprison" to listOf(
        GlyphPart("M3.5999999999999996 19a6.4 6.4 0 1 0 12.8 0a6.4 6.4 0 1 0 -12.8 0Z", fill = null, stroke = 0xFF54607A, strokeWidth = 3f),
        GlyphPart("M15.6 19a6.4 6.4 0 1 0 12.8 0a6.4 6.4 0 1 0 -12.8 0Z", fill = null, stroke = 0xFF54607A, strokeWidth = 3f),
        GlyphPart("M10 12.6V8.4M22 12.6V8.4", fill = null, stroke = 0xFF54607A, strokeWidth = 3f, cap = 1),
        GlyphPart("M12.4 7.4h7.2", fill = null, stroke = 0xFFD92037, strokeWidth = 3.4f, cap = 1),
    ),
    "heart" to listOf(
        GlyphPart("M16 28 4.8 17.2C1.7 14.2 1.7 9.4 4.8 6.5a7.9 7.9 0 0 1 10.6 0l.6.6.6-.6a7.9 7.9 0 0 1 10.6 0c3.1 2.9 3.1 7.7 0 10.7z", fill = 0xFFE0435C),
        GlyphPart("M9.2 8.6c-2 .4-3.3 1.8-3.7 3.9", fill = null, stroke = 0xFFFF9DAB, strokeWidth = 2.2f, cap = 1),
    ),
    "hotel" to listOf(
        GlyphPart("M7 7h18a2 2 0 0 1 2 2v17a2 2 0 0 1 -2 2h-18a2 2 0 0 1 -2 -2v-17a2 2 0 0 1 2 -2Z", fill = 0xFFF43F5E),
        GlyphPart("M6.6 4h18.8a1.6 1.6 0 0 1 1.6 1.6v0.7999999999999998a1.6 1.6 0 0 1 -1.6 1.6h-18.8a1.6 1.6 0 0 1 -1.6 -1.6v-0.7999999999999998a1.6 1.6 0 0 1 1.6 -1.6Z", fill = 0xFFFB7185),
        GlyphPart("M9.3 11h2.4a0.8 0.8 0 0 1 0.8 0.8v2.4a0.8 0.8 0 0 1 -0.8 0.8h-2.4a0.8 0.8 0 0 1 -0.8 -0.8v-2.4a0.8 0.8 0 0 1 0.8 -0.8Z", fill = null),
        GlyphPart("M14.8 11h2.4a0.8 0.8 0 0 1 0.8 0.8v2.4a0.8 0.8 0 0 1 -0.8 0.8h-2.4a0.8 0.8 0 0 1 -0.8 -0.8v-2.4a0.8 0.8 0 0 1 0.8 -0.8Z", fill = null),
        GlyphPart("M20.3 11h2.4a0.8 0.8 0 0 1 0.8 0.8v2.4a0.8 0.8 0 0 1 -0.8 0.8h-2.4a0.8 0.8 0 0 1 -0.8 -0.8v-2.4a0.8 0.8 0 0 1 0.8 -0.8Z", fill = null),
        GlyphPart("M9.3 17h2.4a0.8 0.8 0 0 1 0.8 0.8v2.4a0.8 0.8 0 0 1 -0.8 0.8h-2.4a0.8 0.8 0 0 1 -0.8 -0.8v-2.4a0.8 0.8 0 0 1 0.8 -0.8Z", fill = null),
        GlyphPart("M20.3 17h2.4a0.8 0.8 0 0 1 0.8 0.8v2.4a0.8 0.8 0 0 1 -0.8 0.8h-2.4a0.8 0.8 0 0 1 -0.8 -0.8v-2.4a0.8 0.8 0 0 1 0.8 -0.8Z", fill = null),
        GlyphPart("M14.6 21h2.8a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-2.8a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1Z", fill = 0xFF7F1D3A),
    ),
    "house" to listOf(
        GlyphPart("M16 4 30 15.5h-4V28H6V15.5H2z", fill = 0xFF3DDC84),
        GlyphPart("M14 19h4a1 1 0 0 1 1 1v7a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1Z", fill = 0xFF0F5132),
    ),
    "houses" to listOf(
        GlyphPart("M21.5 5L29.5 11.4V26H13.5V11.4Z", fill = INK, alpha = 0.32f),
        GlyphPart("M11.5 10.6L20.5 17.8V27.6H2.5V17.8ZM9.4 21.4h4.2v6.2H9.4Z", fill = INK, evenOdd = true),
    ),
    "island" to listOf(
        GlyphPart("M5.6 23.6c0-3.1 4.6-5.6 10.4-5.6s10.4 2.5 10.4 5.6z", fill = 0xFFF0CD88),
        GlyphPart("M15.2 19.4 14.2 10", fill = null, stroke = 0xFFA16207, strokeWidth = 2.3f, cap = 1),
        GlyphPart("M14.2 9.6c-3.4-2.2-7.3-1.4-8.7 1 2.8-.6 5 .2 6.4 1.6z", fill = 0xFF22C55E),
        GlyphPart("M14.2 9.6c-.7-3.8 1.5-7.1 4.4-7.5-1.8 2-2.4 4.4-2.2 6.4z", fill = 0xFF16A34A),
        GlyphPart("M14.2 9.6c3.6-1.4 7.2.4 8.2 3-2.4-1.4-4.8-1.6-6.8-.9z", fill = 0xFF22C55E),
        GlyphPart("M2 27c2.3-1.8 4.7-1.8 7 0s4.7 1.8 7 0 4.7-1.8 7 0 3.5 1.2 5 0", fill = null, stroke = 0xFF38BDF8, strokeWidth = 2.2f, cap = 1),
    ),
    "key" to listOf(
        GlyphPart("M4 11.2a7.2 7.2 0 1 0 14.4 0a7.2 7.2 0 1 0 -14.4 0ZM8.4 11.2a2.8 2.8 0 1 0 5.6 0a2.8 2.8 0 1 0 -5.6 0Z", fill = INK, evenOdd = true),
        GlyphPart("M15.8 15.8 27.6 27.6", fill = null),
        GlyphPart("M20.6 22.2 23.9 18.9M23.8 25.4 26.6 22.6", fill = null),
    ),
    "map" to listOf(
        GlyphPart("M11 4.4 2.4 7.6v20l8.6-3.2z", fill = INK, alpha = 0.32f),
        GlyphPart("M11 4.4 21 7.9v20L11 24.4z", fill = INK),
        GlyphPart("M21 7.9 29.6 4.6v20L21 27.9z", fill = INK, alpha = 0.32f),
    ),
    "medalBronze" to listOf(
        GlyphPart("M9.6 2.4 15.2 12.6l-5 2.9L4 5.4z", fill = 0xFF7A5A3C),
        GlyphPart("M22.4 2.4 16.8 12.6l5 2.9L28 5.4z", fill = 0xFF5F4530),
        GlyphPart("M7.4 21.6a8.6 8.6 0 1 0 17.2 0a8.6 8.6 0 1 0 -17.2 0Z", fill = 0xFFA4652B),
        GlyphPart("M9.7 21.6a6.3 6.3 0 1 0 12.6 0a6.3 6.3 0 1 0 -12.6 0Z", fill = 0xFFCF8B4A),
        GlyphPart("M16 17.3L17.12 20.06L20.09 20.27L17.81 22.19L18.53 25.08L16 23.5L13.47 25.08L14.19 22.19L11.91 20.27L14.88 20.06Z", fill = 0xFFA4652B),
    ),
    "medalGold" to listOf(
        GlyphPart("M9.6 2.4 15.2 12.6l-5 2.9L4 5.4z", fill = 0xFFD1495B),
        GlyphPart("M22.4 2.4 16.8 12.6l5 2.9L28 5.4z", fill = 0xFFA9394A),
        GlyphPart("M7.4 21.6a8.6 8.6 0 1 0 17.2 0a8.6 8.6 0 1 0 -17.2 0Z", fill = 0xFFD99A1E),
        GlyphPart("M9.7 21.6a6.3 6.3 0 1 0 12.6 0a6.3 6.3 0 1 0 -12.6 0Z", fill = 0xFFF7C948),
        GlyphPart("M16 17.3L17.12 20.06L20.09 20.27L17.81 22.19L18.53 25.08L16 23.5L13.47 25.08L14.19 22.19L11.91 20.27L14.88 20.06Z", fill = 0xFFD99A1E),
    ),
    "medalSilver" to listOf(
        GlyphPart("M9.6 2.4 15.2 12.6l-5 2.9L4 5.4z", fill = 0xFF5B6A86),
        GlyphPart("M22.4 2.4 16.8 12.6l5 2.9L28 5.4z", fill = 0xFF46536C),
        GlyphPart("M7.4 21.6a8.6 8.6 0 1 0 17.2 0a8.6 8.6 0 1 0 -17.2 0Z", fill = 0xFF8B96A4),
        GlyphPart("M9.7 21.6a6.3 6.3 0 1 0 12.6 0a6.3 6.3 0 1 0 -12.6 0Z", fill = 0xFFCCD4DC),
        GlyphPart("M16 17.3L17.12 20.06L20.09 20.27L17.81 22.19L18.53 25.08L16 23.5L13.47 25.08L14.19 22.19L11.91 20.27L14.88 20.06Z", fill = 0xFF8B96A4),
    ),
    "moon" to listOf(
        GlyphPart("M13.6 3.2a12.9 12.9 0 1 0 15.2 15.2A11.3 11.3 0 0 1 13.6 3.2z", fill = 0xFF6F7FD4),
        GlyphPart("M8.2 19.6a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0Z", fill = 0xFFA8B4EE),
        GlyphPart("M14.4 24.4a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0Z", fill = 0xFFA8B4EE),
    ),
    "palette" to listOf(
        GlyphPart("M16 2.8C8.2 2.8 1.9 8.7 1.9 16S8.2 29.2 16 29.2c2 0 3.4-1.4 3.4-3.2 0-.9-.4-1.7-1-2.3-.5-.6-.8-1.3-.8-2.1 0-1.8 1.5-3.2 3.3-3.2h1.6c4.2 0 7.6-3.1 7.6-7.3 0-4.9-6.3-8.3-15.1-8.3z", fill = INK, alpha = 0.24f),
        GlyphPart("M6.6 12.6a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0Z", fill = 0xFFE0435C),
        GlyphPart("M13 8.4a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0Z", fill = 0xFFF5C542),
        GlyphPart("M19.599999999999998 11a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0Z", fill = 0xFF4FBB80),
        GlyphPart("M4.800000000000001 20.2a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0Z", fill = 0xFF5AA2E8),
    ),
    "payment" to listOf(
        GlyphPart("M10.4 14.2C7.6 8.8 4 5.8.2 5.6c-.2 5 2.9 9 8.6 10.6z", fill = 0xFFA3D6BD),
        GlyphPart("M21.6 14.2c2.8-5.4 6.4-8.4 10.2-8.6.2 5-2.9 9-8.6 10.6z", fill = 0xFFA3D6BD),
        GlyphPart("M9.2 11h13.6a2.2 2.2 0 0 1 2.2 2.2v8a2.2 2.2 0 0 1 -2.2 2.2h-13.6a2.2 2.2 0 0 1 -2.2 -2.2v-8a2.2 2.2 0 0 1 2.2 -2.2Z", fill = 0xFF2F8F5B),
        GlyphPart("M10.8 13.2h10.399999999999999a1.4 1.4 0 0 1 1.4 1.4v5.2a1.4 1.4 0 0 1 -1.4 1.4h-10.399999999999999a1.4 1.4 0 0 1 -1.4 -1.4v-5.2a1.4 1.4 0 0 1 1.4 -1.4Z", fill = 0xFF4FBB80),
        GlyphPart("M13.27 17.2a2.73 2.73 0 1 0 5.46 0a2.73 2.73 0 1 0 -5.46 0Z", fill = 0xFFEAF9F0),
    ),
    "people" to listOf(
        GlyphPart("M16.5 10.8a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0Z", fill = INK, alpha = 0.34f),
        GlyphPart("M13.6 25.8c0-4.2 3.3-7.5 7.4-7.5s7.4 3.3 7.4 7.5z", fill = INK, alpha = 0.34f),
        GlyphPart("M6.9 10.2a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0Z", fill = INK),
        GlyphPart("M2.8 27.4c0-5.3 4.3-9.4 9.6-9.4s9.6 4.1 9.6 9.4z", fill = INK),
    ),
    "plane" to listOf(
        GlyphPart("M16 2.6c1.5 0 2.4 1.6 2.4 3.6v5.4l10.2 5.6v3l-10.2-3v5.4l3 2.2v2.4L16 26l-5.4 1.2v-2.4l3-2.2v-5.4l-10.2 3v-3l10.2-5.6V6.2c0-2 .9-3.6 2.4-3.6z", fill = INK),
    ),
    "police" to listOf(
        GlyphPart("M6 17.4c0-5.7 4.5-10.2 10-10.2s10 4.5 10 10.2z", fill = 0xFF41508A),
        GlyphPart("M5.6 17h20.799999999999997a2.2 2.2 0 0 1 2.2 2.2v1.1999999999999993a2.2 2.2 0 0 1 -2.2 2.2h-20.799999999999997a2.2 2.2 0 0 1 -2.2 -2.2v-1.1999999999999993a2.2 2.2 0 0 1 2.2 -2.2Z", fill = 0xFF2B3663),
        GlyphPart("M16 9.2L17.18 11.98L20.18 12.24L17.9 14.22L18.59 17.16L16 15.6L13.41 17.16L14.1 14.22L11.82 12.24L14.82 11.98Z", fill = 0xFFF5C542),
    ),
    "prison" to listOf(
        GlyphPart("M7.5 5.5h17a3 3 0 0 1 3 3v15a3 3 0 0 1 -3 3h-17a3 3 0 0 1 -3 -3v-15a3 3 0 0 1 3 -3Z", fill = 0xFF1B2140),
        GlyphPart("M11.8 13a4.2 4.2 0 1 0 8.4 0a4.2 4.2 0 1 0 -8.4 0Z", fill = 0xFFAAB6D8),
        GlyphPart("M8.5 26.5c0-4.4 3.4-7.6 7.5-7.6s7.5 3.2 7.5 7.6z", fill = 0xFFAAB6D8),
        GlyphPart("M11 6.6v18.8M16 6.6v18.8M21 6.6v18.8", fill = null),
        GlyphPart("M7.5 5.5h17a3 3 0 0 1 3 3v15a3 3 0 0 1 -3 3h-17a3 3 0 0 1 -3 -3v-15a3 3 0 0 1 3 -3Z", fill = null, stroke = 0xFF8F9DC4, strokeWidth = 1.6f),
    ),
    "question" to listOf(
        GlyphPart("M3 16a13 13 0 1 0 26 0a13 13 0 1 0 -26 0Z", fill = INK, alpha = 0.26f),
        GlyphPart("M12.2 12.4c0-2.2 1.7-3.7 3.9-3.7 2.1 0 3.8 1.4 3.8 3.4 0 1.7-1 2.5-2.2 3.3-1.1.8-1.6 1.4-1.6 2.6v.6", fill = null, stroke = INK, strokeWidth = 2.6f, cap = 1),
        GlyphPart("M14.200000000000001 23.2a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0 -3.8 0Z", fill = INK),
    ),
    "refund" to listOf(
        GlyphPart("M5.9 8h20.2a2.4 2.4 0 0 1 2.4 2.4v11.2a2.4 2.4 0 0 1 -2.4 2.4h-20.2a2.4 2.4 0 0 1 -2.4 -2.4v-11.2a2.4 2.4 0 0 1 2.4 -2.4Z", fill = 0xFF1E3A2B, stroke = 0xFF4ADE80, strokeWidth = 1.6f),
        GlyphPart("M11.6 16a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0 -8.8 0Z", fill = 0xFF4ADE80),
        GlyphPart("M16 13.4v5.2M13.4 16h5.2", fill = null, stroke = 0xFF12321F, strokeWidth = 2f, cap = 1),
    ),
    "replay" to listOf(
        GlyphPart("M16 6.4A9.6 9.6 0 1 1 8.1 10.5", fill = null, stroke = INK, strokeWidth = 3.2f, cap = 1),
        GlyphPart("M13.2 2.2 19.8 6.4 13.2 10.6z", fill = INK),
    ),
    "robot" to listOf(
        GlyphPart("M14 3a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z", fill = INK),
        GlyphPart("M16 3.4v4.4", fill = null, stroke = INK, strokeWidth = 2.2f, cap = 1),
        GlyphPart("M9.2 7.6h13.6a5 5 0 0 1 5 5v9a5 5 0 0 1 -5 5h-13.6a5 5 0 0 1 -5 -5v-9a5 5 0 0 1 5 -5ZM8.9 15.2a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0ZM18.1 15.2a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0ZM11.2 20.4h9.6v2.7h-9.6Z", fill = INK, evenOdd = true),
        GlyphPart("M2.2 12.8h0a1.4 1.4 0 0 1 1.4 1.4v4.2a1.4 1.4 0 0 1 -1.4 1.4h0a1.4 1.4 0 0 1 -1.4 -1.4v-4.2a1.4 1.4 0 0 1 1.4 -1.4Z", fill = INK, alpha = 0.5f),
        GlyphPart("M29.799999999999997 12.8h0a1.4 1.4 0 0 1 1.4 1.4v4.2a1.4 1.4 0 0 1 -1.4 1.4h0a1.4 1.4 0 0 1 -1.4 -1.4v-4.2a1.4 1.4 0 0 1 1.4 -1.4Z", fill = INK, alpha = 0.5f),
    ),
    "scales" to listOf(
        GlyphPart("M16 6.6v21M6.6 28.4h18.8M3.4 9.2h25.2", fill = null),
        GlyphPart("M13.4 9.2a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0Z", fill = INK),
        GlyphPart("M1.4 13.6h11.4L7.1 21z", fill = INK, alpha = 0.4f),
        GlyphPart("M19.2 13.6h11.4L24.9 21z", fill = INK, alpha = 0.4f),
    ),
    "shield" to listOf(
        GlyphPart("M16 2.6 28.4 7v9.5c0 6.3-4.7 11.1-12.4 13.2C8.3 27.6 3.6 22.8 3.6 16.5V7z", fill = INK, alpha = 0.3f),
        GlyphPart("M16 7.4 23.9 10.2v5.9c0 4.3-3.1 7.5-7.9 9-4.8-1.5-7.9-4.7-7.9-9v-5.9z", fill = INK),
    ),
    "shuffle" to listOf(
        GlyphPart("M2.6 8.6h4.8l12.8 14.8h5", fill = null),
        GlyphPart("M2.6 23.4h4.8l4.4-5.1M17.6 13.2l2.6-4.6h5", fill = null),
        GlyphPart("M23.4 3.8 30 8.6l-6.6 4.8z", fill = INK),
        GlyphPart("M23.4 18.6 30 23.4l-6.6 4.8z", fill = INK),
    ),
    "skull" to listOf(
        GlyphPart("M16 2.6C9.2 2.6 3.7 8 3.7 14.6c0 3.9 1.9 7.4 4.9 9.5v3.1c0 1.3 1 2.3 2.3 2.3h10.2c1.3 0 2.3-1 2.3-2.3v-3.1c3-2.1 4.9-5.6 4.9-9.5C28.3 8 22.8 2.6 16 2.6ZM7.8 14.2a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0 -6.6 0ZM17.6 14.2a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0 -6.6 0ZM16 16.4l1.7 4.2h-3.4ZM12.9 25.1h1.9v4.4h-1.9ZM17.2 25.1h1.9v4.4h-1.9Z", fill = INK, evenOdd = true),
    ),
    "snooze" to listOf(
        GlyphPart("M18.4 3.6h9.8l-9.8 9.4h9.8", fill = null),
        GlyphPart("M10.2 16h7.2l-7.2 6.8h7.2", fill = null, alpha = 0.72f),
        GlyphPart("M3.4 24.4h5.2l-5.2 4.6h5.2", fill = null, alpha = 0.5f),
    ),
    "soundOff" to listOf(
        GlyphPart("M3.6 12.2h5.2L16.2 5.6v20.8l-7.4-6.6H3.6z", fill = INK),
        GlyphPart("M20.8 12.4 27.8 19.4M27.8 12.4 20.8 19.4", fill = null, stroke = INK, strokeWidth = 2.6f, cap = 1),
    ),
    "soundOn" to listOf(
        GlyphPart("M3.6 12.2h5.2L16.2 5.6v20.8l-7.4-6.6H3.6z", fill = INK),
        GlyphPart("M20.4 12.2a5.4 5.4 0 0 1 0 7.6", fill = null),
        GlyphPart("M24.6 8.6a10.4 10.4 0 0 1 0 14.8", fill = null),
    ),
    "sparkle" to listOf(
        GlyphPart("M14.4 2.4c1 6.4 3.1 8.5 9.5 9.5-6.4 1-8.5 3.1-9.5 9.5-1-6.4-3.1-8.5-9.5-9.5 6.4-1 8.5-3.1 9.5-9.5z", fill = 0xFFF5C542),
        GlyphPart("M24.2 19.2c.5 3.3 1.6 4.4 4.9 4.9-3.3.5-4.4 1.6-4.9 4.9-.5-3.3-1.6-4.4-4.9-4.9 3.3-.5 4.4-1.6 4.9-4.9z", fill = 0xFFFBE08A),
    ),
    "start" to listOf(
        GlyphPart("M3 16 h13", fill = null, stroke = 0xFF1C6B45, strokeWidth = 3.4f, cap = 1, dash = floatArrayOf(1.5f, 4f)),
        GlyphPart("M13 6.5 21.5 16 13 25.5 Z", fill = 0xFF34D399),
        GlyphPart("M20 6.5 28.5 16 20 25.5 Z", fill = 0xFF6EE7A0),
        GlyphPart("M3.4 16a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0Z", fill = 0xFF34D399),
    ),
    "sun" to listOf(
        GlyphPart("M9.6 16a6.4 6.4 0 1 0 12.8 0a6.4 6.4 0 1 0 -12.8 0Z", fill = 0xFFFCD34D),
        GlyphPart("M16 3.4v3.6M16 25v3.6M3.4 16h3.6M25 16h3.6M7.2 7.2l2.5 2.5M22.3 22.3l2.5 2.5M24.8 7.2l-2.5 2.5M9.7 22.3l-2.5 2.5", fill = null),
    ),
    "surprise" to listOf(
        GlyphPart("M12 5h8a7 7 0 0 1 7 7v8a7 7 0 0 1 -7 7h-8a7 7 0 0 1 -7 -7v-8a7 7 0 0 1 7 -7Z", fill = 0xFFBE1A63),
        GlyphPart("M12.4 12.6c0-2.2 1.7-3.7 3.9-3.7 2.1 0 3.8 1.4 3.8 3.4 0 1.7-1 2.5-2.2 3.3-1.1.8-1.6 1.4-1.6 2.6v.6", fill = null, stroke = 0xFFFFD9EA, strokeWidth = 2.6f, cap = 1),
        GlyphPart("M14.399999999999999 23.4a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0Z", fill = 0xFFFFD9EA),
    ),
    "swap" to listOf(
        GlyphPart("M11.4 26.4V9.2", fill = null, stroke = INK, strokeWidth = 2.9f, cap = 1),
        GlyphPart("M6.3 14 11.4 8.2 16.5 14", fill = null, stroke = INK, strokeWidth = 2.9f, cap = 1, join = 1),
        GlyphPart("M20.6 5.6v17.2", fill = null, stroke = INK, strokeWidth = 2.9f, cap = 1),
        GlyphPart("M15.5 18 20.6 23.8 25.7 18", fill = null, stroke = INK, strokeWidth = 2.9f, cap = 1, join = 1),
    ),
    "tax" to listOf(
        GlyphPart("M5.9 8h20.2a2.4 2.4 0 0 1 2.4 2.4v11.2a2.4 2.4 0 0 1 -2.4 2.4h-20.2a2.4 2.4 0 0 1 -2.4 -2.4v-11.2a2.4 2.4 0 0 1 2.4 -2.4Z", fill = 0xFF3F2733, stroke = 0xFFF0728C, strokeWidth = 1.6f),
        GlyphPart("M8.8 13a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0Z", fill = 0xFFF0728C),
        GlyphPart("M18.8 19a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0Z", fill = 0xFFF0728C),
        GlyphPart("M22 11 10 21", fill = null, stroke = 0xFFF0728C, strokeWidth = 2.2f, cap = 1),
    ),
    "ticket" to listOf(
        GlyphPart("M5.4 8.4h21.2a3 3 0 0 1 3 3v9.2a3 3 0 0 1 -3 3h-21.2a3 3 0 0 1 -3 -3v-9.2a3 3 0 0 1 3 -3ZM10.6 11.3L11.83 14.3L15.07 14.55L12.6 16.65L13.36 19.8L10.6 18.1L7.84 19.8L8.6 16.65L6.13 14.55L9.37 14.3ZM20.1 12.2a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0ZM20.1 16a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0ZM20.1 19.8a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0Z", fill = INK, evenOdd = true),
    ),
    "toolbox" to listOf(
        GlyphPart("M11.6 9V7.4c0-1.2 1-2.2 2.2-2.2h4.4c1.2 0 2.2 1 2.2 2.2V9", fill = null, stroke = 0xFF8A5A12, strokeWidth = 2.4f, cap = 1),
        GlyphPart("M5 9h22a2.6 2.6 0 0 1 2.6 2.6v12.400000000000002a2.6 2.6 0 0 1 -2.6 2.6h-22a2.6 2.6 0 0 1 -2.6 -2.6v-12.400000000000002a2.6 2.6 0 0 1 2.6 -2.6Z", fill = 0xFFD97B0F),
        GlyphPart("M2.4 14.4h27.2v4h-27.2Z", fill = 0xFFF0A336),
        GlyphPart("M14.8 12.4h2.4000000000000004a1.4 1.4 0 0 1 1.4 1.4v5.6000000000000005a1.4 1.4 0 0 1 -1.4 1.4h-2.4000000000000004a1.4 1.4 0 0 1 -1.4 -1.4v-5.6000000000000005a1.4 1.4 0 0 1 1.4 -1.4Z", fill = 0xFF7C3F06),
    ),
    "trade" to listOf(
        GlyphPart("M3 12.8h6.4l7.6 3.5-2.6 5.4-5.6-2.6v5.7H3a2.2 2.2 0 0 1-2.2-2.2V15A2.2 2.2 0 0 1 3 12.8Z", fill = INK, stroke = INK, strokeWidth = 1.5f, join = 1, alpha = 0.33f),
        GlyphPart("M29 19.2h-6.4L15 15.7l2.6-5.4 5.6 2.6V7.2H29a2.2 2.2 0 0 1 2.2 2.2V17a2.2 2.2 0 0 1-2.2 2.2Z", fill = INK, stroke = INK, strokeWidth = 1.5f, join = 1),
    ),
    "treasure" to listOf(
        GlyphPart("M4 14.5A12 12 0 0 1 28 14.5V16H4z", fill = 0xFFF0A336),
        GlyphPart("M6.2 15.5h19.6a2.2 2.2 0 0 1 2.2 2.2v7.1a2.2 2.2 0 0 1 -2.2 2.2h-19.6a2.2 2.2 0 0 1 -2.2 -2.2v-7.1a2.2 2.2 0 0 1 2.2 -2.2Z", fill = 0xFFD97B0F),
        GlyphPart("M4 15h24v3h-24Z", fill = 0xFFFBBF24),
        GlyphPart("M15.2 12.5h1.5999999999999996a1.6 1.6 0 0 1 1.6 1.6v5.8a1.6 1.6 0 0 1 -1.6 1.6h-1.5999999999999996a1.6 1.6 0 0 1 -1.6 -1.6v-5.8a1.6 1.6 0 0 1 1.6 -1.6Z", fill = 0xFF7C3F06),
        GlyphPart("M14.5 17.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z", fill = 0xFFFDE68A),
    ),
    "trophy" to listOf(
        GlyphPart("M9 3.6h14v8.8c0 3.9-3.1 7-7 7s-7-3.1-7-7z", fill = 0xFFE8B52E),
        GlyphPart("M9 6.6H5.2c0 4.6 1.9 7.1 4.8 7.7M23 6.6h3.8c0 4.6-1.9 7.1-4.8 7.7", fill = null, stroke = 0xFFE8B52E, strokeWidth = 2.4f, cap = 1),
        GlyphPart("M13.6 18.8h4.8v4.6h-4.8Z", fill = 0xFFC98F16),
        GlyphPart("M10.200000000000001 23h11.6a1.8 1.8 0 0 1 1.8 1.8v1.1999999999999997a1.8 1.8 0 0 1 -1.8 1.8h-11.6a1.8 1.8 0 0 1 -1.8 -1.8v-1.1999999999999997a1.8 1.8 0 0 1 1.8 -1.8Z", fill = 0xFFC98F16),
    ),
    "turbine" to listOf(
        GlyphPart("M15 15 6.5 8.4l1.8-2.6L16 13.6z", fill = 0xFF4A86BD),
        GlyphPart("M17 15.6 27 12l.7 3.1-10 3.3z", fill = 0xFF4A86BD),
        GlyphPart("M15.6 17.4 13 28.4h-3.2l3.5-11.4z", fill = 0xFF4A86BD),
        GlyphPart("M13.6 16a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0Z", fill = 0xFF2C5A85),
    ),
    "vacation" to listOf(
        GlyphPart("M18 9.5a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z", fill = 0xFFFCD34D),
        GlyphPart("M13.5 13c-3.6-2.4-8-1.6-9.6 1 3-.6 5.4.2 7 1.6z", fill = 0xFF22C55E),
        GlyphPart("M13.5 13c-.8-4.2 1.6-7.8 4.8-8.2-2 2.2-2.6 4.8-2.4 7z", fill = 0xFF16A34A),
        GlyphPart("M13.5 13c4-1.6 8 .4 9 3.4-2.6-1.6-5.2-1.8-7.4-1z", fill = 0xFF22C55E),
        GlyphPart("M13.6 12.6 12 27", fill = null, stroke = 0xFFA16207, strokeWidth = 2.4f, cap = 1),
        GlyphPart("M2 24.5c2.6-2 5.2-2 7.8 0s5.2 2 7.8 0 5.2-2 7.8 0 4 1.4 5.6 0", fill = null, stroke = 0xFF38BDF8, strokeWidth = 2.2f, cap = 1),
    ),
    "warning" to listOf(
        GlyphPart("M14.1 4.5 2.5 24.3a2.2 2.2 0 0 0 1.9 3.3h23.2a2.2 2.2 0 0 0 1.9-3.3L17.9 4.5a2.2 2.2 0 0 0-3.8 0z", fill = 0xFFF0A92C),
        GlyphPart("M16 11.4v7.4", fill = null, stroke = 0xFF3D2A05, strokeWidth = 2.8f, cap = 1),
        GlyphPart("M14.2 23.2a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0Z", fill = 0xFF3D2A05),
    ),
)
