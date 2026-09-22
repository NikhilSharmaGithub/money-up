package com.moneymove.game

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Serializable mirror of the state the game server broadcasts.
 *
 * `server/game.js serialize()` is the source of truth; everything here is
 * optional-tolerant, because one field a server has not shipped yet — or one
 * this client has not learned about — must never kill the whole decode and
 * leave a player staring at an empty table. The JSON reader is configured
 * with `ignoreUnknownKeys`, so the server can add a field on a Friday without
 * breaking every Android phone that has not updated.
 *
 * Field for field, this is the iOS app's `Models.swift`. Keeping them equal is
 * not tidiness: it is the reason one server can run a browser, a phone and a
 * tablet at the same table without a second dialect to keep in step.
 */
@Serializable
data class GameState(
    val id: String = "",
    val status: String = "lobby",           // "lobby" | "playing" | "ended"
    val hostId: String? = null,
    /** This table came out of Quick Play matchmaking. */
    val quick: Boolean? = null,
    /**
     * Made for a cup match. Two chairs with names on them: no bots, no
     * guests, no settings, and nobody to throw out.
     */
    val cup: Boolean? = null,
    /** Epoch ms the matchmade table deals itself in; null once it has. */
    val quickStartAt: Double? = null,
    /**
     * What a matchmade table dealt itself — board and house rules. Nobody at
     * one of these tables picked them, so they get shown before the dice.
     */
    val quickRoll: QuickRoll? = null,
    val settings: GameSettings = GameSettings(),
    val mapId: String? = null,
    val map: MapData = MapData(),
    val groups: Map<String, GroupInfo> = emptyMap(),
    val teamInfo: List<TeamInfo>? = null,
    val winningTeam: Int? = null,
    val players: List<PlayerState> = emptyList(),
    /** Seats whose player dropped out and whose chair the table is holding. */
    val awaiting: List<AwaitingSeat>? = null,
    val ownership: Map<String, TileOwnership> = emptyMap(),
    val turn: TurnState? = null,
    val auction: AuctionState? = null,
    val trades: List<TradeOffer> = emptyList(),
    val log: List<LogLine> = emptyList(),
    val chat: List<ChatMessage> = emptyList(),
    val vacationPot: Int? = null,
    val winner: WinnerInfo? = null,
    val lastCard: LastCard? = null,
    val lastMove: LastMove? = null,
    /**
     * Every leg of the current action, in execution order. One roll can move a
     * piece twice — walk onto Surprise, then the card sends it on — and the
     * theatre wants each leg on its own cue.
     */
    val moves: List<MoveLeg>? = null,
    /**
     * The deadlock rule's one-time explainer. It rides every push from the
     * moment the table could hit it, so the `at` stamp — not its presence —
     * is what says whether it is news.
     */
    val reliefCard: ReliefCard? = null,
    val history: List<WorthPoint>? = null,  // net-worth series, sent once the game ends
    /** Per-player match counters, revealed only on the ended state. */
    val stats: Map<String, PlayerStats>? = null,
    /** End-of-game badges: player id -> title with its one-line reason. */
    val titles: Map<String, TitleInfo>? = null,
    val version: Int = 0,
) {
    fun player(id: String?): PlayerState? = id?.let { pid -> players.firstOrNull { it.id == pid } }

    fun owner(of: Int): TileOwnership? = ownership[of.toString()]

    val isLobby: Boolean get() = status == "lobby"

    /**
     * A matchmade table still filling up: the seats and the clock are the
     * whole story, so the host controls stay out of the way.
     */
    val isQuickWaiting: Boolean get() = isLobby && quick == true && quickStartAt != null
    val isPlaying: Boolean get() = status == "playing"
    val isEnded: Boolean get() = status == "ended"

    /**
     * Where an open debt streams, written the way a sentence needs it: the
     * creditor's name, the still-owed players of a payEach split, or plain
     * "the bank" when the money simply leaves the game.
     */
    fun debtPayee(d: DebtState?): String {
        player(d?.creditor)?.let { return it.name }
        val names = (d?.owedTo ?: emptyList()).mapIndexedNotNull { k, id ->
            val p = player(id) ?: return@mapIndexedNotNull null
            if (p.isBankrupt) return@mapIndexedNotNull null
            val left = d?.owedLeft?.getOrNull(k)
            if (left != null && left <= 0) return@mapIndexedNotNull null
            p.name
        }
        return when {
            names.size > 1 -> names.dropLast(1).joinToString(", ") + " and " + names.last()
            names.size == 1 -> names.first()
            else -> "the bank"
        }
    }
}

/**
 * The house rules a Quick Play table rolled for itself.
 *
 * `parts` arrives already written — "Japan", "$1,500 to start", "auctions on"
 * — because the server phrases it once and a phone and a browser at the same
 * table then cannot describe it differently.
 */
@Serializable
data class QuickRoll(
    val at: Double? = null,
    val keys: List<String>? = null,
    val parts: List<String>? = null,
)

@Serializable
data class GameSettings(
    val maxPlayers: Int = 4,
    @SerialName("private") val isPrivate: Boolean? = null,
    val allowBots: Boolean? = null,
    val mapId: String? = null,
    val x2rent: Boolean? = null,
    val vacationCash: Boolean? = null,
    val auction: Boolean? = null,
    val noRentInPrison: Boolean? = null,
    val mortgage: Boolean? = null,
    val evenBuild: Boolean? = null,
    val startingCash: Int = 1500,
    val randomizeOrder: Boolean? = null,
    val teams: Int? = null,
    /** Seconds a human gets per turn before the table moves on; 0 = clock off. */
    val turnSeconds: Int? = null,
)

@Serializable
data class MapData(
    val id: String = "",
    val uid: String? = null,
    val name: String = "",
    val icon: String? = null,
    val tiles: List<TileData> = emptyList(),
    val layout: MapLayout = MapLayout(),
    val size: Int = 0,
    val groups: Map<String, List<Int>>? = null,
)

@Serializable
data class MapLayout(
    /** [start, prison, vacation, gotoprison] */
    val corners: List<Int> = emptyList(),
    val top: List<Int> = emptyList(),
    val right: List<Int> = emptyList(),
    val bottom: List<Int> = emptyList(),
    val left: List<Int> = emptyList(),
)

@Serializable
data class TileData(
    /** property|airport|utility|tax|refund|treasure|surprise|start|prison|vacation|gotoprison */
    val type: String = "",
    val name: String = "",
    val index: Int = 0,
    val price: Int? = null,
    val group: String? = null,
    val rent: List<Int>? = null,
    val houseCost: Int? = null,
    val groupSize: Int? = null,
    val icon: String? = null,
    val amount: Int? = null,
    val percent: Int? = null,
) {
    val isOwnable: Boolean get() = type == "property" || type == "airport" || type == "utility"
}

@Serializable
data class GroupInfo(val name: String = "", val color: String = "", val flag: String = "")

@Serializable
data class TeamInfo(val name: String = "", val color: String = "", val icon: String = "")

@Serializable
data class PlayerState(
    val id: String = "",
    val name: String = "",
    val color: String = "#888888",
    val flag: String? = null,
    val team: Int? = null,
    /** Store cosmetics: the piece on the board / the face in the chip. */
    val tokenSkin: String? = null,
    val avatar: String? = null,
    val money: Int = 0,
    val pos: Int = 0,
    val jail: Boolean? = null,
    val jailTurns: Int? = null,
    val getOutCards: Int? = null,
    val bankrupt: Boolean? = null,
    val isBot: Boolean? = null,
    val connected: Boolean? = null,
    val skipTurns: Int? = null,
    val netWorth: Int? = null,
    /**
     * Removed from play rather than beaten: the seat stays in the roster as a
     * spectator, and the deeds went back to the bank.
     */
    val timedOut: Boolean? = null,
    val removedFor: String? = null,         // "timeout" | "quit"
    /** Laps walked while the deadlock rule was counting for this seat, 0...4. */
    val blockedLaps: Int? = null,
) {
    val isBankrupt: Boolean get() = bankrupt == true
    val inJail: Boolean get() = jail == true
    val wasRemoved: Boolean get() = timedOut == true

    /**
     * Below zero and still at the table: the debt phase, where the negative
     * balance IS the amount left to pay and every gain streams to whoever is
     * owed until it climbs back to zero.
     */
    val inDebt: Boolean get() = money < 0 && !isBankrupt

    val lapsBlocked: Int get() = blockedLaps ?: 0
    val lapsToRelief: Int get() = maxOf(0, RELIEF_LAPS - lapsBlocked)

    companion object {
        /** RELIEF_LAPS in server/game.js. */
        const val RELIEF_LAPS = 4
    }
}

/**
 * A seat the table is waiting on. The first couple of extensions are a favour
 * any one player can do alone; after that the server wants everybody's click,
 * which is why `granted` and `voters` travel with it.
 */
@Serializable
data class AwaitingSeat(
    val id: String = "",
    /** Epoch ms the chair is released if nobody grants more time. */
    val until: Double? = null,
    val grants: Int? = null,
    val granted: List<String>? = null,
    val needAll: Boolean? = null,
    val voters: Int? = null,
) {
    val grantedIds: List<String> get() = granted ?: emptyList()
    val voterCount: Int get() = voters ?: 0
    /** One click is no longer enough — everyone still at the table must agree. */
    val isVote: Boolean get() = needAll == true
}

@Serializable
data class TileOwnership(
    val owner: String = "",
    val houses: Int? = null,
    val mortgaged: Boolean? = null,
) {
    val houseCount: Int get() = houses ?: 0
    val isMortgaged: Boolean get() = mortgaged == true
}

@Serializable
data class TurnState(
    val playerId: String = "",
    val phase: String = "roll",             // roll | action | auction | debt | end
    val dice: List<Int>? = null,
    val doubles: Int? = null,
    val pending: PendingAction? = null,
    val debt: DebtState? = null,
    val rolledThisTurn: Boolean? = null,
    /** Epoch milliseconds this player's turn expires; null when no clock. */
    val endsAt: Double? = null,
)

@Serializable
data class PendingAction(val type: String = "", val tile: Int = 0, val price: Int? = null)

@Serializable
data class DebtState(
    val debtor: String = "",
    val creditor: String? = null,
    val amount: Int = 0,
    val reason: String? = null,
    /**
     * A payEach charge is owed to several players at once; the server names
     * them here (creditor stays null) so the panel can say who the money is
     * streaming to.
     */
    val owedTo: List<String>? = null,
    /**
     * What each of `owedTo` is still owed, same order — a paid-off or departed
     * recipient drops out of the debt copy.
     */
    val owedLeft: List<Int>? = null,
)

@Serializable
data class AuctionState(
    val tile: Int = 0,
    val bid: Int = 0,
    val leader: String? = null,
    val inRace: List<String> = emptyList(),
    val endsAt: Double? = null,
)

@Serializable
data class TradeSide(
    val money: Int = 0,
    val tiles: List<Int> = emptyList(),
    val cards: Int = 0,
)

@Serializable
data class TradeOffer(
    val id: Int = 0,
    val from: String = "",
    val to: String = "",
    val give: TradeSide = TradeSide(),
    val get: TradeSide = TradeSide(),
    val at: Double? = null,
    /** Recipient parked it — out of the dock, still in the list. */
    val ignored: Boolean? = null,
    /** Player ids currently looking at this offer. */
    val viewers: List<String>? = null,
)

@Serializable
data class LogLine(val text: String = "", val kind: String = "", val at: Double = 0.0) {
    val key: String get() = "$at:${text.hashCode()}"
}

@Serializable
data class ChatMessage(
    val id: String = "",
    val name: String = "",
    val color: String = "#888888",
    val flag: String? = null,
    /**
     * The sender's public friend code, so the line can be reported or its
     * author blocked. Absent for house players.
     */
    val code: String? = null,
    val text: String = "",
    val at: Double = 0.0,
    val channel: String? = null,            // "all" | "team"
    val team: Int? = null,
) {
    val isTeam: Boolean get() = channel == "team"
}

/** One point of the end-of-game chart: turn number -> player id -> net worth. */
@Serializable
data class WorthPoint(val t: Int = 0, val w: Map<String, Int> = emptyMap())

/**
 * A player's report card, mirroring statFor() in server/game.js. Every field
 * defaults so a stat the server has not counted yet reads as zero rather than
 * as a decode failure.
 */
@Serializable
data class PlayerStats(
    val doubles: Int? = null,
    val jailed: Int? = null,
    val streetsBought: Int? = null,
    val auctionsWon: Int? = null,
    val tradesCompleted: Int? = null,
    val housesBuilt: Int? = null,
    val rentCollected: Int? = null,
    val rentPaid: Int? = null,
    val biggestRent: Int? = null,
    val biggestRentTile: String? = null,
    val laps: Int? = null,
    val leadShare: Int? = null,
)

/** One end-of-game badge: "Landlord — collected $4,320 in rent". */
@Serializable
data class TitleInfo(val title: String = "", val reason: String = "")

@Serializable
data class WinnerInfo(val id: String = "", val name: String = "", val color: String = "#888888")

/**
 * The house explaining a rule rather than the deck dealing a card: shown once
 * to both players the first time a two-player table could deadlock.
 */
@Serializable
data class ReliefCard(
    val title: String = "",
    val text: String = "",
    val at: Double = 0.0,
)

@Serializable
data class LastCard(
    val deck: String = "",                  // treasure | surprise
    val text: String = "",
    /**
     * good | bad | plain — decided on the server so every client paints the
     * same card the same colour, rather than three of them guessing from the
     * wording. Absent on older servers, which get the deck's own colours.
     */
    val tone: String? = null,
    /**
     * Who drew it. The board reveals a card the moment *that* player's piece
     * reaches the tile that drew it, so it has to know whose piece to watch.
     */
    val playerId: String? = null,
    val at: Double = 0.0,
)

@Serializable
data class LastMove(
    val playerId: String = "",
    val from: Int = 0,
    val to: Int = 0,
    val steps: Int = 0,
    val at: Double = 0.0,
)

/**
 * One scripted move of the current action. `cause` is the cue sheet: "roll"
 * waits for the dice, "card" waits for the card to be read, "jail" is the long
 * walk nobody narrates twice.
 */
@Serializable
data class MoveLeg(
    val playerId: String = "",
    val from: Int = 0,
    val to: Int = 0,
    val steps: Int = 0,
    val cause: String? = null,
    /**
     * A number that only goes up. Two legs of one journey — the roll and the
     * card its tile drew — are resolved inside the same millisecond, so the
     * clock cannot tell them apart and this can.
     */
    val seq: Int? = null,
    val at: Double = 0.0,
)

/**
 * One player's line of a finished game, frozen so History can reopen the
 * result long after the room itself is gone.
 */
@Serializable
data class PlayerResult(
    val id: String = "",
    val name: String = "",
    val color: String = "#888888",
    val flag: String? = null,
    val avatar: String? = null,
    val worth: Int = 0,
    val bankrupt: Boolean = false,
    val removedFor: String? = null,
    val isBot: Boolean = false,
    val title: String? = null,
    val titleReason: String? = null,
    val stats: PlayerStats? = null,
) {
    /**
     * What the standings column says for this seat. A removed seat was never
     * actually bankrupted — don't say it was.
     */
    val outcomeLabel: String?
        get() = if (!bankrupt) null else when (removedFor) {
            "quit" -> "left the game"
            "timeout" -> "timed out"
            else -> "bankrupt"
        }

    companion object {
        /**
         * Standings order — solvent seats by net worth, then the fallen — with
         * each seat's title and stats stapled on. This is both what the
         * game-over sheet renders and what History files away.
         */
        fun snapshot(state: GameState?): List<PlayerResult> {
            if (state == null) return emptyList()
            val ordered = state.players.filter { !it.isBankrupt }
                .sortedByDescending { it.netWorth ?: 0 } + state.players.filter { it.isBankrupt }
            return ordered.map { p ->
                PlayerResult(
                    id = p.id, name = p.name, color = p.color, flag = p.flag, avatar = p.avatar,
                    worth = if (p.isBankrupt) 0 else (p.netWorth ?: 0),
                    bankrupt = p.isBankrupt, removedFor = p.removedFor,
                    // Quick tables mask isBot, but the house players still
                    // carry the server's "bot:" id prefix.
                    isBot = (p.isBot == true) || p.id.startsWith("bot:"),
                    title = state.titles?.get(p.id)?.title,
                    titleReason = state.titles?.get(p.id)?.reason,
                    stats = state.stats?.get(p.id),
                )
            }
        }
    }
}

/**
 * Mirrors codeFor() in server/social.js: a friend code is a pure hash of the
 * player's token, so the code of anyone at the table can be computed from
 * their id and fed to the normal add-by-code flow.
 *
 * Ported arithmetic, not ported style — the multiplications must overflow and
 * wrap exactly as they do in JavaScript's 32-bit integer maths, or two clients
 * would print two different codes for the same person.
 */
fun friendCode(token: String): String {
    val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    var h1 = 0x811c9dc5.toInt()
    var h2 = 0x01000193
    token.forEachIndexed { i, ch ->
        val c = ch.code
        h1 = (h1 xor c) * 16777619
        h2 = (h2 + c * (i + 7)) * -1640531535      // 2654435761 as a signed Int
    }
    val out = StringBuilder()
    for (i in 0 until 6) {
        val source = if (i < 3) h1 else h2
        val shifted = (source ushr ((i % 3) * 5))
        out.append(alphabet[(shifted.toLong() and 0xFFFFFFFFL).mod(32L).toInt()])
        // The server rolls h1 after the third character; the value feeds
        // nothing afterwards, but the roll is kept so the codes stay equal.
        if (i == 2) h1 *= -2048144777               // 2246822519 as a signed Int
    }
    return out.toString()
}
