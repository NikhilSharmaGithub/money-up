package com.moneymove.game

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Everything the app asks the server about a person rather than a table.
 *
 * These are the REST half of the protocol — the wallet, the shop, the friends
 * list, the leaderboard, the daily coin — and they are shaped exactly as
 * `server/index.js` writes them, because the browser and the iOS app already
 * read them that way.
 */

@Serializable
data class MeView(
    /** This player's public friend code, hashed from their token. */
    val code: String = "",
    val name: String = "",
    val flag: String = "",
    val coins: Int = 0,
    val karma: Int = 100,
    /** "google" | "apple" | null — how they signed in, if they did. */
    val provider: String? = null,
    val email: String = "",
    val picture: String = "",
    val appleRevocable: Boolean = false,
)

@Serializable
data class AuthConfig(
    val google: Boolean = false,
    /** The audience the server accepts — the WEB client id, on every platform. */
    val googleClientId: String? = null,
    val appleRevoke: Boolean = false,
)

@Serializable
data class Wallet(
    val coins: Int = 0,
    /** Ids of everything bought. */
    val owned: List<String> = emptyList(),
    /** kind -> the id currently worn, e.g. {"token": "tok-car"}. */
    val equipped: Map<String, String> = emptyMap(),
    val karma: Int = 100,
    /**
     * Coins ever earned, only ever rising. The coin counter flies when this
     * moves and stays still when a poll merely repeats itself.
     */
    val earned: Int = 0,
)

@Serializable
data class StoreItem(
    val id: String = "",
    /** token | avatar | board */
    val kind: String = "",
    val name: String = "",
    val emoji: String = "",
    val mapId: String? = null,
    val price: Int = 0,
)

@Serializable
data class CoinPack(
    val id: String = "",
    val name: String = "",
    val coins: Int = 0,
    val price: String = "",
    val bonus: String? = null,
)

@Serializable
data class StoreView(
    val items: List<StoreItem> = emptyList(),
    val packs: List<CoinPack> = emptyList(),
)

@Serializable
data class LeaderRow(
    val code: String = "",
    val name: String = "",
    val flag: String = "",
    val wins: Int = 0,
    val winnings: Int = 0,
)

@Serializable
data class LeaderboardView(val top: List<LeaderRow> = emptyList())

/**
 * One person on the friends screen — a friend, someone who has asked, or
 * someone this player has asked.
 *
 * The names are the server's, and two of them were not. This used to read
 * `room` and `online`, which withPresence() in server/social.js has never
 * sent: it sends `roomId` and a three-way `status`. `ignoreUnknownKeys`
 * dropped both real fields without a word, so every friend read as offline
 * forever and the Join button — the one thing a friends list is for — could
 * never appear. `room` keeps its Kotlin name so nothing that reads it moves;
 * only the wire name is corrected.
 */
@Serializable
data class Friend(
    val code: String = "",
    val name: String = "",
    val flag: String = "",
    /** Their equipped store face, which publicView sends beside the flag. */
    val avatar: String = "",
    /** The table they are sitting at right now, if any. */
    @SerialName("roomId") val room: String? = null,
    /**
     * "lobby" | "playing" | "offline", and absent altogether on a request or
     * an ask — those rows are cards, not presence. Nullable rather than
     * defaulted so a screen can still tell "offline" from "not a friend yet",
     * which is the one place iOS draws differently.
     */
    val status: String? = null,
) {
    /** Somewhere in the app right now: a lobby or a game. */
    val online: Boolean get() = status == "lobby" || status == "playing"

    /**
     * Their game is under way, so the seats are shut. Walking in gets a
     * spectator's view, and a button that promises a seat and delivers that
     * reads as broken — so the button says Watch instead. The same test iOS
     * makes, null included.
     */
    val started: Boolean get() = status != "lobby"

    /** Their face if they wear one, their flag if not, nothing otherwise. */
    val face: String get() = avatar.ifBlank { flag }

    /**
     * Where they sort: a seat somebody can actually take first, then a game
     * to watch, then everybody else. An offline crowd should never bury a
     * live table.
     */
    val presenceRank: Int
        get() = when (status) {
            "lobby" -> 0
            "playing" -> 1
            else -> 2
        }
}

@Serializable
data class SocialView(
    val friends: List<Friend> = emptyList(),
    /** People who have asked to be your friend. */
    val requests: List<Friend> = emptyList(),
    /**
     * People you have asked, still waiting on an answer. A request that has
     * nowhere to be seen is indistinguishable from one that failed, which is
     * how people end up adding the same code five times.
     */
    val sent: List<Friend> = emptyList(),
    /**
     * Friend codes this player has blocked, as socialOf() sends them.
     *
     * Without this field the list was being quietly swallowed by
     * `ignoreUnknownKeys`, so nothing ever populated GameStore.blockedCodes
     * and the chat's drop-a-blocked-line filter was a no-op that looked
     * exactly like a working one.
     */
    val blocked: List<String> = emptyList(),
) {
    /** The list in the order the friends screen shows it, as iOS sorts it. */
    val friendsByPresence: List<Friend>
        get() = friends.sortedWith(
            compareBy<Friend> { it.presenceRank }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name },
        )

    /** How many of them are in the app right now, for "3 on right now". */
    val onlineCount: Int get() = friends.count { it.online }
}

/**
 * A friend asking this player to their table — the answer to GET /api/invite,
 * as inviteFor() in server/social.js writes it.
 *
 * The server keeps only the newest one per player and lets it go after five
 * minutes, so there is never a list: one invite, or none.
 */
@Serializable
data class Invite(
    /** The friend code of whoever sent it. */
    val from: String = "",
    val name: String = "",
    val roomId: String = "",
    /** Epoch ms it was sent. A Double because that is what arrives. */
    val at: Double = 0.0,
) {
    /**
     * Enough to tell one invite from the next, so the same one is not
     * announced twice by two polls in a row — and so one this device has
     * already answered stays answered. The same key iOS builds.
     */
    val key: String get() = "$from:$roomId:${at.toLong()}"
}

@Serializable
data class InviteFeed(val invite: Invite? = null)

@Serializable
data class DailyView(
    val signedIn: Boolean = false,
    val claimable: Boolean = false,
    val streak: Int = 0,
    val amount: Int = 1,
    /** Epoch ms the next one unlocks. */
    val nextAt: Double? = null,
)

@Serializable
data class Achievements(
    /** Badge id -> how many times it has been earned. */
    val titles: Map<String, Int> = emptyMap(),
    val wins: Int = 0,
    val winnings: Int = 0,
    val turnsPlayed: Int = 0,
)

// ── the board shelf ───────────────────────────────────────────────────────
//
// /api/boards is one answer to one question — which of the nineteen may this
// wallet deal, and what would the rest cost — and it is the only endpoint
// whose answer depends on the server's calendar, so the client never works
// any of it out for itself.
//
// Every field below is shaped the way `summarise()` in server/maps.js and the
// handler in server/index.js write it, and named the way iOS's BoardSummary
// reads it. That is not tidiness: this model was wrong in two places and a
// wrong TYPE is fatal where an unknown key is harmless. `ignoreUnknownKeys`
// forgives a field nobody expected; nothing forgives an Int declared where an
// object arrives, so the decode threw, the shelf stayed null, and the picker
// drew an empty row on every phone.

@Serializable
data class BoardSides(
    val top: Int = 0,
    val right: Int = 0,
    val bottom: Int = 0,
    val left: Int = 0,
)

/**
 * Enough to draw the board small: one colour per tile, and how many tiles sit
 * on each side so they can be walked back round the rim in order.
 *
 * A board is a picture, not a word. Nineteen of them answer to the same
 * handful of glyphs, so a card without this is a card that cannot tell Bharat
 * from Canada — which is exactly what Android was shipping.
 */
@Serializable
data class BoardPreview(
    /** One CSS colour per tile, in board order, starting at Go. */
    val colors: List<String> = emptyList(),
    val sides: BoardSides = BoardSides(),
)

/**
 * One colour set on a board, and the places on it. This is the part people
 * actually read — nobody ever bought a board because it had 22 streets.
 */
@Serializable
data class BoardSet(val name: String = "", val color: String = "", val cities: List<String> = emptyList())

@Serializable
data class BoardListing(
    val id: String = "",
    val name: String = "",
    /**
     * The board's own emoji, from the map itself. Not UI chrome — iOS draws
     * it in the one place a board has no preview to draw instead.
     */
    val icon: String = "",
    val description: String = "",
    val country: Boolean = false,
    val size: Int = 40,
    val streets: Int = 0,
    val airports: Int = 0,
    val utilities: Int = 0,
    val countries: Int = 0,
    val sets: List<BoardSet> = emptyList(),
    /**
     * Absent only from a server too old to send it, and nullable for the one
     * reason that matters: a card with no preview draws the glyph instead of
     * a blank square.
     */
    val preview: BoardPreview? = null,
    /** The three dearest streets — the recognisable end of the board. */
    val headline: List<String> = emptyList(),

    /**
     * Playable right now — free forever, free today, bought, or rented for
     * this one game at this one table.
     */
    val playable: Boolean = true,
    /** Why: "house" | "today" | "owned" | "rented" | "locked". */
    val how: String = "house",
    /** Locked, but the kind of board one coin can borrow for a single game. */
    val rentable: Boolean = false,
    /** Always what it would cost right now, sale included. */
    val price: Int = 0,
    /**
     * The sticker price, present only while this board is discounted. A "was"
     * that equals the price is the oldest lie in retail, so the server sends
     * it only when it is true.
     */
    val was: Int? = null,
    /**
     * Where today's shelf puts it. The list arrives already sorted by this,
     * so it is only worth reading to a screen that regroups the boards and
     * wants the shop's order back afterwards.
     */
    val shelf: Int = 0,
) {
    /**
     * A few of the places on it, for a card too small to list them all.
     *
     * The server picks the dearest three rather than the first three: a board
     * is laid out cheapest-first, so the top of that list sells Canada on
     * Corner Brook and Whitehorse. The fallback is only for a server too old
     * to know that.
     */
    val teaser: String
        get() = headline.ifEmpty { sets.flatMap { it.cities } }.take(3).joinToString(" · ")

    /**
     * What the shop calls this board. A purchase is for an item id, never a
     * map id, and the two are not the same string.
     */
    val storeId: String get() = "brd-$id"
}

/**
 * What one game on a locked board costs, and whether this wallet is already
 * holding one it paid for and never played.
 *
 * An object, and always was. Reading it as a bare Int is half of why the
 * shelf never decoded.
 */
@Serializable
data class BoardRentInfo(
    val price: Int = 1,
    val holding: BoardRentHold? = null,
)

/** The unplayed pass this wallet holds, and where it is currently pointed. */
@Serializable
data class BoardRentHold(val mapId: String = "", val roomId: String = "")

@Serializable
data class BoardsView(
    val boards: List<BoardListing> = emptyList(),
    /** Board ids everyone can play today. */
    val free: List<String> = emptyList(),
    /** Board ids on offer. */
    val sale: List<String> = emptyList(),
    /**
     * How much off, as a fraction: 0.3 is thirty percent. A Double on the
     * wire, and the other half of why the shelf never decoded.
     */
    val saleOff: Double = 0.3,
    /**
     * Server-local midnight in milliseconds — when the free pair changes.
     * Double because it is long past anything an Int holds.
     */
    val until: Double = 0.0,
    /** How many boards the calendar gives away each day. */
    val perDay: Int = 2,
    /** How long it takes every board to come round once. */
    val cycleDays: Int = 12,
    /** The board that is free forever, and where every fallback lands. */
    val house: String = "classic",
    val rent: BoardRentInfo = BoardRentInfo(),
    val coins: Int = 0,
)
