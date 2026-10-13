package com.moneymove.game

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.roundToInt

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

    // ── 1.0.6: who this player is becoming ────────────────────────────────
    //
    // An older server sends none of these, so every one has the default an
    // unknown token gets from a new server: level one, nothing earned yet,
    // both switches on. The account card then simply draws a fresh player.

    /** Total experience, only ever rising. */
    val xp: Int = 0,
    val level: Int = 1,
    /** The XP at which this level started. */
    val levelFloor: Int = 0,
    /** The XP at which the next one starts. */
    val levelNext: Int = 100,
    /** Their own career, exactly as somebody else would read it on their card. */
    val career: Career? = null,
    /** The two switches Settings shows, as the server holds them. */
    val prefs: PlayerPrefs? = null,
    /**
     * The newest level-up, from a game or a mission claim, for a phone that
     * was not at the table when it happened. Celebrated once, by its level.
     */
    val lastLevelUp: LevelUp? = null,
) {
    /** How far through this level the XP bar is, nought to one. */
    val levelFraction: Float get() = levelProgress(xp, levelFloor, levelNext)

    /** XP still to earn before the next level, never below nought. */
    val xpToNext: Int get() = maxOf(0, levelNext - xp)
}

/**
 * The XP bar's fill: `(xp − floor) / (next − floor)`, as the server's doc
 * puts it — clamped, because a bar drawn past its end or before its start
 * is a bar that looks broken, and a server mid-deploy can send a floor and
 * a next that briefly disagree with the XP between them.
 */
fun levelProgress(xp: Int, floor: Int, next: Int): Float {
    val span = next - floor
    if (span <= 0) return 0f
    return ((xp - floor).toFloat() / span).coerceIn(0f, 1f)
}

/** One level crossed: `{ from, to, coins }`, and when, on the copy /api/me keeps. */
@Serializable
data class LevelUp(
    val from: Int = 0,
    val to: Int = 0,
    /** What was actually paid — five a level. */
    val coins: Int = 0,
    /** Epoch ms. Absent on the copy a game or a claim answers with. */
    val at: Double = 0.0,
)

/**
 * The `progress` socket event: what the game that just ended was worth to
 * this player. Sent to their own sockets only, right after the final state,
 * and only for a game that counted — so its absence is not an error, it is a
 * game that ended too soon to move anything.
 */
@Serializable
data class ProgressNote(
    val roomId: String = "",
    /** What was actually added, after the daily ceiling. */
    val xpGained: Int = 0,
    /** What the game was worth part by part, before the ceiling. */
    val xpParts: XpParts = XpParts(),
    /** The day's 600 cut this game short (or to nothing). */
    val xpCapped: Boolean = false,
    val xp: Int = 0,
    val level: Int = 1,
    val levelFloor: Int = 0,
    val levelNext: Int = 100,
    /** Null when no level was crossed. */
    val levelUp: LevelUp? = null,
    /** Mission kinds this game pushed over the line — the card is worth a fresh look. */
    val missionsCompleted: List<String> = emptyList(),
) {
    val levelFraction: Float get() = levelProgress(xp, levelFloor, levelNext)
}

@Serializable
data class XpParts(val played: Int = 0, val win: Int = 0, val runnerUp: Int = 0, val turns: Int = 0)

/**
 * A player's lifetime numbers from 1.0.6 on — the career grid on a profile.
 * `biggestRent` is a record, not a sum; everything else adds up game by game.
 */
@Serializable
data class Career(
    val streetsBought: Int = 0,
    val housesBuilt: Int = 0,
    val rentCollected: Int = 0,
    val biggestRent: Int = 0,
    val auctionsWon: Int = 0,
    val tradesCompleted: Int = 0,
    val doubles: Int = 0,
    /** The board they have played most, or null before their first counted game. */
    val favoriteBoard: FavoriteBoard? = null,
) {
    /** Nothing counted yet — the grid says so rather than drawing a wall of noughts. */
    val isEmpty: Boolean
        get() = streetsBought == 0 && housesBuilt == 0 && rentCollected == 0 && biggestRent == 0 &&
            auctionsWon == 0 && tradesCompleted == 0 && favoriteBoard == null
}

@Serializable
data class FavoriteBoard(val id: String = "", val name: String = "", val games: Int = 0)

/**
 * The player's own switches on the server — GET and POST /api/prefs. Both
 * default to on, which is also what the server answers for a token it has
 * never seen.
 */
@Serializable
data class PlayerPrefs(
    /** The once-a-day push when the daily coins are ready. */
    val dailyReminder: Boolean = true,
    /** A friend's invite pushes to this phone. Off, the invite still shows in the app. */
    val inviteAlerts: Boolean = true,
)

// ── daily missions ──────────────────────────────────────────────────────────

/**
 * One of today's three — GET /api/missions. `id` is the kind (a day never
 * deals two of one kind), and `progress` never runs past `target`.
 */
@Serializable
data class Mission(
    val id: String = "",
    val kind: String = "",
    val title: String = "",
    val target: Int = 1,
    val progress: Int = 0,
    val coins: Int = 0,
    val xp: Int = 0,
    val done: Boolean = false,
    val claimed: Boolean = false,
) {
    /** How full the mission's bar is, nought to one. */
    val fraction: Float get() = if (target <= 0) 1f else (progress.toFloat() / target).coerceIn(0f, 1f)
}

/**
 * The fourth reward: all three done, a few coins and no XP. Since 1.0.6's
 * round 2 it is the only coin on the card — each mission pays XP alone.
 */
@Serializable
data class MissionBonus(val coins: Int = 0, val ready: Boolean = false, val claimed: Boolean = false)

@Serializable
data class MissionsView(
    /** The server's calendar day these were dealt for. */
    val day: String = "",
    /** Server midnight in epoch ms, when the three are dealt again. */
    val resetsAt: Double = 0.0,
    /** Claiming needs an account; progress does not. */
    val signedIn: Boolean = false,
    val missions: List<Mission> = emptyList(),
    val bonus: MissionBonus = MissionBonus(),
) {
    /** How many of the three are done, for the card's header. */
    val doneCount: Int get() = missions.count { it.done }

    /** Something on the card is waiting to be collected. */
    val anythingToClaim: Boolean
        get() = signedIn && (missions.any { it.done && !it.claimed } || bonus.ready)
}

/**
 * What a claim came to, read from POST /api/missions/claim. `paid` and `xp`
 * are what THIS claim moved — both nought on a repeat, which is a success
 * that plays no coins. `error` is the server's own sentence when it said no.
 */
data class MissionClaim(
    val paid: Int = 0,
    val xp: Int = 0,
    val levelUp: LevelUp? = null,
    val error: String? = null,
    val needsLogin: Boolean = false,
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
    /** Their level, or nought from a server too old to send one — no chip then. */
    val level: Int = 0,
    val wins: Int = 0,
    val winnings: Int = 0,
    /** Only ever on the caller's own row, and only when the board was asked with a token. */
    val you: Boolean = false,
)

/**
 * One board — GET /api/leaderboard?scope=all|week|friends. An old server
 * answers every scope with the all-time `top` and nothing else, which reads
 * here as an all-time board whatever was asked; the tabs then show the same
 * fifty three times rather than nothing.
 */
@Serializable
data class LeaderboardView(
    val top: List<LeaderRow> = emptyList(),
    val scope: String = "all",
    /** "2026-W42", on the weekly board only. */
    val week: String? = null,
    /** Next Monday 00:00 UTC in epoch ms, on the weekly board only. */
    val resetsAt: Double? = null,
    /** Where the caller stands on this board, or null when they were not asked about. */
    val you: LeaderYou? = null,
)

/**
 * The caller's place on a board. `rank` is in the whole ordering, so it can
 * be well below the fifty that are listed, and null when they are not on this
 * board at all; `wins` is for this board's scope.
 */
@Serializable
data class LeaderYou(val rank: Int? = null, val wins: Int = 0)

/** The three boards the leaderboard has tabs for, in the tabs' order. */
enum class LeaderScope(val wire: String, val label: String) {
    ALL("all", "All time"),
    WEEK("week", "This week"),
    FRIENDS("friends", "Friends"),
}

/**
 * Somebody else's public card — GET /api/player, which a finished game's
 * standings open by the code each seat carries.
 *
 * Only what the server is willing to show a stranger: the name, the flag and
 * the face they picked, and how they have done. `relation` is where this
 * player stands with them — "self", "friend", "sent" (asked, not yet
 * answered), "asked" (they are waiting on us) or "none" — and decides the one
 * button the card offers.
 */
@Serializable
data class PlayerProfile(
    val code: String = "",
    val name: String = "",
    val flag: String = "",
    /** Their store face as an emoji, or blank for none. */
    val avatar: String = "",
    val wins: Int = 0,
    val games: Int = 0,
    /** Coins their wins have paid, all-time. */
    val winnings: Int = 0,
    /** Up to three, most earned first. */
    val titles: List<TitleCount> = emptyList(),
    /** Epoch ms of their first game. A Double because that is what arrives. */
    val since: Double = 0.0,
    val relation: String = "none",
    /** Their level; nought from an older server, which draws no chip. */
    val level: Int = 0,
    /** Their career from 1.0.6 on, or null from an older server. */
    val career: Career? = null,
) {
    /**
     * Games played, never fewer than the wins. The server promises as much,
     * and a card reading "12 wins, 9 games" would be the one thing on it
     * nobody believed.
     */
    val played: Int get() = maxOf(games, wins)

    /** Wins as a whole percentage of games, nought before the first game. */
    val winRate: Int get() = if (played == 0) 0 else (wins * 100.0 / played).roundToInt()
}

/** One title on a profile, and how many times it has landed on that player's seat. */
@Serializable
data class TitleCount(val title: String = "", val count: Int = 0)

/** A profile, or the sentence saying why there isn't one. */
data class PlayerLookup(val profile: PlayerProfile? = null, val error: String? = null)

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
    /** Their flag, which the banner flies beside the name. Blank from an older server. */
    val flag: String = "",
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
    /** The whole run of days in a row — 9, 16, 40. Never what the bar is drawn from. */
    val streak: Int = 0,
    /** Today's coins while [claimable]; tomorrow's once today's are in. */
    val amount: Int = 1,
    /** Epoch ms the next one unlocks. */
    val nextAt: Double? = null,
    /**
     * The step of this week's climb the card is about, 1 to 7: today's,
     * before it is collected, and the one collected today after. The day
     * after a seven pays one again. Absent from an older server — see [step].
     */
    val cycleDay: Int? = null,
    /** How many steps a climb has: seven. */
    val cycleLength: Int? = null,
    /** Today's coins are in. Absent from an older server — see [collectedToday]. */
    val claimedToday: Boolean? = null,
) {
    /** The steps on the bar — the server's seven, and seven from an older one. */
    val steps: Int get() = cycleLength?.takeIf { it in 1..31 } ?: 7

    /**
     * Today has been collected. An older server only says so by having a
     * next unlock and nothing to claim, which is the same moment.
     */
    val collectedToday: Boolean get() = claimedToday ?: (signedIn && !claimable && nextAt != null)

    /**
     * Where on the climb the card stands, 1 to [steps]. An older server's
     * ladder never came back down: it paid one more each day up to the top
     * and stayed there, so its step is today's amount before the claim and
     * the streak, held at the top, after it.
     */
    val step: Int
        get() = (cycleDay ?: if (collectedToday) minOf(streak, steps) else amount).coerceIn(1, steps)

    /** Steps already collected on this climb, not counting one waiting today. */
    val collectedSteps: Int get() = if (collectedToday) step else step - 1
}

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
