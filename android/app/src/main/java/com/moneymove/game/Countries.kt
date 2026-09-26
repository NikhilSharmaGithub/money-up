package com.moneymove.game

/**
 * The short fixed lists every screen agrees on, ported from iOS's `MMStatic`
 * (Theme.swift) entry for entry and in the same order, so a picker on one
 * platform and a picker on the other list the same things the same way.
 *
 * They live here rather than in Theme.kt because none of them is a colour
 * or a style: they are content the player picks from.
 */
object MMStatic {
    /**
     * Flags with the names people know them by.
     *
     * The flag string is the wire value — it rides the join payload and the
     * profile, and the server keys its prize currency on it (server/fx.js,
     * BY_FLAG), so every mark has to match that table character for
     * character or a player in India silently reads their cup prize in
     * dollars. The last two are deliberately not countries and carry no
     * currency: the pirate for someone who would rather not say, the globe
     * for someone who belongs to all of it.
     *
     * A player's own flag is the one place a flag is drawn as the emoji
     * itself: it is theirs, picked from a list, and only fourteen of these
     * fifty have a drawn medallion in [FLAGS] — a picker that painted some
     * and typed the rest would look broken. Board groups keep their drawn
     * medallions; this list is for people.
     */
    val countries: List<Pair<String, String>> = listOf(
        "🇮🇳" to "India", "🇬🇧" to "United Kingdom", "🇺🇸" to "United States", "🇧🇷" to "Brazil",
        "🇩🇪" to "Germany", "🇫🇷" to "France", "🇮🇹" to "Italy", "🇪🇸" to "Spain", "🇵🇹" to "Portugal",
        "🇳🇱" to "Netherlands", "🇮🇪" to "Ireland", "🇨🇭" to "Switzerland", "🇸🇪" to "Sweden",
        "🇳🇴" to "Norway", "🇩🇰" to "Denmark", "🇵🇱" to "Poland", "🇺🇦" to "Ukraine",
        "🇹🇷" to "Türkiye", "🇷🇴" to "Romania", "🇬🇷" to "Greece", "🇮🇱" to "Israel",
        "🇦🇪" to "United Arab Emirates", "🇸🇦" to "Saudi Arabia", "🇪🇬" to "Egypt",
        "🇿🇦" to "South Africa", "🇳🇬" to "Nigeria", "🇰🇪" to "Kenya", "🇨🇳" to "China",
        "🇯🇵" to "Japan", "🇰🇷" to "South Korea", "🇹🇭" to "Thailand", "🇻🇳" to "Vietnam",
        "🇵🇭" to "Philippines", "🇮🇩" to "Indonesia", "🇵🇰" to "Pakistan", "🇧🇩" to "Bangladesh",
        "🇱🇰" to "Sri Lanka", "🇳🇵" to "Nepal", "🇦🇺" to "Australia", "🇳🇿" to "New Zealand",
        "🇨🇦" to "Canada", "🇲🇽" to "Mexico", "🇦🇷" to "Argentina", "🇨🇱" to "Chile",
        "🇨🇴" to "Colombia", "🇷🇺" to "Russia", "🇸🇬" to "Singapore", "🇲🇾" to "Malaysia",
        "🏴‍☠️" to "No country — pirate", "🌍" to "The whole world",
    )

    /** Just the marks, in the same order. */
    val flags: List<String> = countries.map { it.first }

    /** One-tap reactions: the five that answer almost anything at a table. */
    val reactions: List<String> = listOf("👍", "😂", "😱", "🤝", "🔥")

    /** The reactions, and five more for the second half of the chat row. */
    val emotes: List<String> = reactions + listOf("💸", "🎲", "😭", "🏠", "🤡")

    /**
     * The seat colours, exactly as `COLORS` in server/game.js lists them —
     * updateAppearance drops anything else on the floor.
     */
    val playerColors: List<String> = listOf(
        "#4ade80", "#60a5fa", "#f472b6", "#fbbf24",
        "#a78bfa", "#fb7185", "#22d3ee", "#f97316",
    )
}

/** "India" for "🇮🇳"; null for no flag, or a mark this list does not name. */
fun countryName(flag: String?): String? =
    flag?.takeIf { it.isNotBlank() }?.let { f -> MMStatic.countries.firstOrNull { it.first == f }?.second }
