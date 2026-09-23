package com.moneymove.game

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

@Serializable
data class Friend(
    val code: String = "",
    val name: String = "",
    val flag: String = "",
    /** Room id they are sitting at right now, if any. */
    val room: String? = null,
    val online: Boolean = false,
)

@Serializable
data class SocialView(
    val friends: List<Friend> = emptyList(),
    /** People who have asked to be your friend. */
    val requests: List<Friend> = emptyList(),
    /** People you have asked. */
    val sent: List<Friend> = emptyList(),
)

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

@Serializable
data class BoardSet(val name: String = "", val color: String = "", val cities: List<String> = emptyList())

@Serializable
data class BoardListing(
    val id: String = "",
    val name: String = "",
    val icon: String = "",
    val description: String = "",
    val country: Boolean = false,
    val size: Int = 40,
    val streets: Int = 0,
    val airports: Int = 0,
    val utilities: Int = 0,
    val countries: Int = 0,
    val sets: List<BoardSet> = emptyList(),
)

@Serializable
data class BoardsView(
    val boards: List<BoardListing> = emptyList(),
    /** Board ids everyone can play today. */
    val free: List<String> = emptyList(),
    /** Board ids on offer, and by how much. */
    val sale: List<String> = emptyList(),
    val saleOff: Int = 0,
    /** What one game on a paid board costs, in coins. */
    val rent: Int = 1,
    val coins: Int = 0,
)
