package com.moneymove.game

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

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
    /**
     * Epoch ms the matchmade table deals itself in; null once it has. A
     * server with a Play-now lobby keeps it equal to [QuickLobby.startBy],
     * so an older phone still counts down to the real kick-off.
     */
    val quickStartAt: Double? = null,
    /**
     * The Play-now lobby: the search, then Ready and Start. Null everywhere
     * else, and on a server too old to run one — which is how this client
     * knows to fall back to the waiting room with nothing to press.
     */
    val quickLobby: QuickLobby? = null,
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
    /**
     * A bankrupt player at a "player decides" table being asked what happens
     * to their streets (1.0.7, H2). Null whenever nobody is being asked —
     * always, at the other two tables and from an older server. While it is
     * up the game holds still: the turn's own buttons wait on the answer.
     */
    val bankruptChoice: BankruptChoice? = null,
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
    /**
     * When the game clock runs out, epoch ms — a timed table's, set at the
     * start. Not [TurnState.endsAt], which is still the per-turn shot clock:
     * this one is the whole game's. Null everywhere a game has no clock, and
     * from a server too old to run one.
     */
    val endsAt: Double? = null,
    /**
     * The clock has run out and the turn on the board is the last one. Stays
     * true on the ended state of a timed game.
     */
    val timeUp: Boolean? = null,
    /** Once ended: "time" when the clock decided it, "last" when everybody else went out. */
    val endReason: String? = null,
    /** When this game's dice started; null in the lobby. */
    val startedAt: Double? = null,
    /** Turns played so far — the number the Watch live list shows. */
    val turnCount: Int? = null,
    /**
     * People watching without a seat. Distinct people, not sockets, and
     * never a seated player — so a count of one is somebody else.
     */
    val spectators: Int? = null,
    val version: Int = 0,
) {
    fun player(id: String?): PlayerState? = id?.let { pid -> players.firstOrNull { it.id == pid } }

    fun owner(of: Int): TileOwnership? = ownership[of.toString()]

    val isLobby: Boolean get() = status == "lobby"

    /**
     * A matchmade table that has not dealt itself in: its own waiting room
     * (QuickMatchPanel.kt) rather than the private lobby's host controls. A
     * server with the Play-now lobby says so with [quickLobby]; an older one
     * only ever sent the fuse.
     */
    val isQuickWaiting: Boolean
        get() = isLobby && quick == true && (quickLobby != null || quickStartAt != null)
    val isPlaying: Boolean get() = status == "playing"
    val isEnded: Boolean get() = status == "ended"

    /**
     * A table whose host set its rules. A Play-now or a cup table plays
     * auction-only and the shuffle at their defaults whatever the fields say
     * (docs/API-1.0.6.md), so nothing here reads them off one of those. The
     * bankrupt-properties rule is the exception from 1.0.7: a Play-now table
     * rolls it and plays it — see [estateRule].
     */
    val hostSetsRules: Boolean get() = quick != true && cup != true

    /**
     * What this table does with a bankrupt player's streets, as the server
     * plays it: whatever the settings say — at a Play-now table too, which
     * rolls it from 1.0.7 — except at a cup table, which always gives them
     * back to the bank.
     */
    val estateRule: EstateRule get() = if (cup == true) EstateRule.RELEASE else settings.estateRule

    /**
     * Whether "Bot skill" means anything here: a table a host set up, with a
     * house player sitting at it — or, in the lobby, one with "Allow bots" on
     * and a chair still free, which the house fills at the start. A switch
     * with every chair taken by people deals nobody in. Nowhere else is the
     * control, its chip or its rules-sheet row shown: a table of people has
     * no house to set, and a Play-now table's house always plays normal while
     * it passes itself off as people. The iPhone's hasHouseBots and the web's
     * houseAtTable are the same rule.
     */
    val showsBotSkill: Boolean
        get() = hostSetsRules && (
            players.any { it.isHouse } ||
                (isLobby && settings.allowBots == true && players.size < settings.maxPlayers)
            )

    /**
     * Auction-only (1.0.6 round 2): every unowned street goes straight under
     * the hammer, so there is never a Buy to show — the auction is the panel.
     */
    val isAuctionOnly: Boolean get() = hostSetsRules && settings.auctionOnly == true

    /**
     * The game clock to count down, while there is a game for it to run on.
     * The server clears it in the lobby; the guard is for the beat between a
     * push that ends the game and one that has not caught up.
     */
    val gameClock: Double? get() = endsAt?.takeIf { isPlaying }

    /** The clock decided it — the result says "Time's up" rather than "last one standing". */
    val endedOnClock: Boolean get() = isEnded && endReason == "time"

    /** How many are watching from the rail. */
    val watcherCount: Int get() = maxOf(0, spectators ?: 0)

    /**
     * What the waiting room counts down to: the end of the search while it
     * runs, the table starting by itself once it has, and the old fuse on a
     * server that has no lobby.
     */
    val quickDeadline: Double?
        get() = quickLobby?.let { if (it.isGathering) it.gatherUntil else it.startBy } ?: quickStartAt

    /**
     * Whole seconds to [quickDeadline], measured against the server's own
     * clock — so somebody who walks in late sees what is really left rather
     * than a fresh twenty. Null once the table has dealt.
     */
    fun quickSecondsLeft(now: Long = System.currentTimeMillis()): Int? =
        quickDeadline?.let { clockSecondsLeft(it, now) }

    /** Chairs nobody is sitting in yet. */
    val openSeats: Int get() = maxOf(0, settings.maxPlayers - players.size)

    /** A team by its index into [teamInfo], or null for none or a stale index. */
    fun team(index: Int?): TeamInfo? = index?.let { teamInfo?.getOrNull(it) }

    /** The team a seat plays for, if it plays for one. */
    fun teamOf(player: PlayerState?): TeamInfo? = team(player?.team)

    /** The team that took the table, when it was a team game. */
    val winningTeamInfo: TeamInfo? get() = team(winningTeam)

    /**
     * Whoever took it, named the way the result headline names them: a team
     * by its team name, anyone else by theirs.
     */
    val winnerLabel: String
        get() = winningTeamInfo?.let { "Team ${it.name}" } ?: winner?.name ?: "Somebody"

    /** How many deeds a seat holds — the count its chip carries. */
    fun ownedCount(playerId: String): Int = ownership.values.count { it.owner == playerId }

    /**
     * Whether the streets the seats [going] leave behind could still be sold
     * were they to go out now — server/game.js estateSaleOpen, asked of the
     * table as it would be once they have gone: the game on, its clock not
     * run out, and at least two players still in to bid. With teams one team
     * left is a game over, so those players must also play for two teams at
     * least. When no sale can happen the deeds go back to the bank whatever
     * the table's rule, and a "player decides" table asks nothing.
     */
    fun estateSaleAfter(going: Set<String>): Boolean {
        if (!isPlaying || timeUp == true) return false
        val left = players.filter { !it.isBankrupt && it.id !in going }
        if (left.size < 2) return false
        return (settings.teams ?: 0) <= 0 || left.map { it.team }.toSet().size >= 2
    }

    /**
     * What going out now does with the streets of the seats [going]: the
     * table's rule while a sale can still happen, the bank's otherwise — so
     * a dialog never promises an auction, or a question, that the server
     * will not hold. Several at once is Leave for good from a pass & play
     * phone, where every seat on it walks out together.
     */
    fun estateRuleFor(going: Set<String>): EstateRule =
        if (estateRule == EstateRule.RELEASE || estateSaleAfter(going)) estateRule else EstateRule.RELEASE

    /** [estateRuleFor] for one seat going out on its own. */
    fun estateRuleFor(seat: String): EstateRule = estateRuleFor(setOf(seat))

    /**
     * Whether going out from [seat] asks where its streets go — in the same
     * dialog, so it is not asked a second time: a "player decides" table
     * where a sale could still happen, and at least one deed to decide about.
     */
    fun decidesEstate(seat: String): Boolean =
        estateRuleFor(seat) == EstateRule.CHOOSE && ownedCount(seat) > 0

    /**
     * How many of one kind of tile a seat holds — airports and utilities,
     * whose rent is priced by the set rather than by the street.
     */
    fun ownedOfType(playerId: String, type: String): Int = ownership.count { (key, own) ->
        own.owner == playerId && map.tiles.getOrNull(key.toIntOrNull() ?: -1)?.type == type
    }

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
    /**
     * The settings keys the host has since moved off what was rolled. A table
     * whose rules somebody changed says so, so nobody sits down to "the dice
     * picked this" when a person did.
     */
    val edited: List<String>? = null,
) {
    /**
     * Which setting each of [parts] describes, in its order. The server
     * writes the phrases in quickRollParts' fixed reading order — the board,
     * the bankroll, then its five labelled rules — and this is that order, so
     * a changed rule can be found among the chips without parsing the words.
     */
    fun partKey(index: Int): String? = PART_KEYS.getOrNull(index)

    /** The chip for this setting has been changed by the host. */
    fun isEdited(index: Int): Boolean = partKey(index)?.let { it in edited.orEmpty() } == true

    companion object {
        /**
         * quickRollParts() in server/game.js, phrase for phrase — 1.0.7 adds
         * what a bankrupt player's streets do, last ("bankrupt player decides").
         */
        val PART_KEYS = listOf(
            "mapId", "startingCash", "x2rent", "vacationCash", "auction", "noRentInPrison", "evenBuild",
            "bankruptProperties",
        )
    }
}

/**
 * The Play-now lobby, as the server runs it.
 *
 * Twenty seconds of search, when the table only looks for people and the
 * last five fill the empty chairs with the house; then the ready phase, when
 * everyone but the host says they are ready, the host starts, and a table
 * nobody starts starts itself at [startBy]. Every time here is the server's,
 * so two phones at one table count down to the same second.
 *
 * `waitingOn` is read loosely — a count, or the seats themselves — because
 * the only thing any screen says with it is how many.
 */
@Serializable
data class QuickLobby(
    /** "gathering" | "ready". */
    val phase: String = "gathering",
    /** Epoch ms the search ends. */
    val gatherUntil: Double? = null,
    /** Epoch ms the table starts by itself if nobody starts it first. */
    val startBy: Double? = null,
    /** Epoch ms the earliest empty chair is given to the house, or null. */
    val backfillAt: Double? = null,
    val waitingOn: JsonElement? = null,
    /** Everyone but the host is ready: the host's Start is live. */
    val canStart: Boolean? = null,
    /** The settings keys the host may change here — QUICK_HOST_KEYS. */
    val editable: List<String>? = null,
) {
    val isGathering: Boolean get() = phase != "ready"

    /** Seats other than the host that have not said they are ready. */
    val waitingCount: Int
        get() = when (val w = waitingOn) {
            is JsonArray -> w.size
            is JsonPrimitive -> w.content.toDoubleOrNull()?.toInt() ?: 0
            else -> 0
        }

    /** The host's Start would be taken: the search is over and nobody is still reading. */
    val startLive: Boolean get() = !isGathering && canStart == true

    fun mayEdit(key: String): Boolean = key in editable.orEmpty()
}

@Serializable
data class GameSettings(
    val maxPlayers: Int = 4,
    /**
     * Hidden from the public room list — true unless the host opens it up.
     * The server's own key, which is why it carries no rename: this used to
     * read "private", a key the server never writes, so the flag never
     * decoded at all and no screen could tell a private room from a public one.
     */
    val isPrivate: Boolean? = null,
    val allowBots: Boolean? = null,
    val mapId: String? = null,
    val x2rent: Boolean? = null,
    val vacationCash: Boolean? = null,
    val auction: Boolean? = null,
    val noRentInPrison: Boolean? = null,
    val mortgage: Boolean? = null,
    val evenBuild: Boolean? = null,
    /** DEFAULT_SETTINGS in server/game.js; only read if a push ever omits it. */
    val startingCash: Int = 2500,
    val randomizeOrder: Boolean? = null,
    val teams: Int? = null,
    /** Seconds a human gets per turn before the table moves on; 0 = clock off. */
    val turnSeconds: Int? = null,
    /**
     * How hard the house players the host added play: "easy", "normal" or
     * "hard". Absent from an older server, which only ever had normal.
     */
    val botLevel: String? = null,
    /** The game clock in minutes — 0, 20, 30, 45 or 60, where 0 is no clock. */
    val timeLimit: Int? = null,
    /**
     * What a bankrupt player's streets do: "release" — back to the bank,
     * unowned, as they always went — "auction", one lot at a time (1.0.6
     * round 2), or "choose", where the player who goes out picks (1.0.7).
     * Absent from an older server, which only ever released them.
     */
    val bankruptProperties: String? = null,
    /** Every unowned street goes straight to auction; nobody buys at the sticker. */
    val auctionOnly: Boolean? = null,
    /** The colour sets trade places on the board at the start of each game. */
    val shuffleBoard: Boolean? = null,
) {
    val botSkill: BotSkill get() = BotSkill.of(botLevel)

    /** A bankrupt player's streets always go under the hammer rather than back to the bank. */
    val auctionsEstates: Boolean get() = bankruptProperties == "auction"

    /** The bankrupt-properties rule as the lobby and the rules sheet name it. */
    val estateRule: EstateRule get() = EstateRule.of(bankruptProperties)

    /** Minutes on the game clock; 0 for an untimed table and an older server. */
    val gameMinutes: Int get() = timeLimit?.takeIf { it in GAME_LENGTHS } ?: 0

    companion object {
        /** The lengths the server accepts — anything else it refuses whole. */
        val GAME_LENGTHS = listOf(0, 20, 30, 45, 60)

        /** "Unlimited" or "30 min", as the lobby's menu and summary say it. */
        fun gameLengthLabel(minutes: Int): String = if (minutes <= 0) "Unlimited" else "$minutes min"

        /**
         * The three values `bankruptProperties` takes, as the lobby's control
         * offers them — the server refuses anything else, whole.
         */
        val BANKRUPT_CHOICES: List<Pair<String, String>> = EstateRule.entries.map { it.wire to it.label }
    }
}

/**
 * Where a bankrupt player's streets go — `settings.bankruptProperties` —
 * with the words every client uses for it (docs/API-1.0.6.md, "Round 3"):
 * [label] on the lobby's segmented control, [explain] the line under it,
 * [sheet] the value on the rules sheet's "Bankrupt properties" row. [glyph]
 * leads the segment and the lobby's summary chip.
 */
enum class EstateRule(
    val wire: String,
    val label: String,
    val explain: String,
    val sheet: String,
    val glyph: String,
) {
    RELEASE(
        "release", "Back to the bank",
        "A bankrupt player's properties go back to the bank, unowned.",
        "Back to the bank", "bank",
    ),
    AUCTION(
        "auction", "Auction them",
        "A bankrupt player's properties are auctioned to everyone, one by one.",
        "Auctioned", "gavel",
    ),
    CHOOSE(
        "choose", "Player decides",
        "The player who goes bankrupt picks: back to the bank, or auction.",
        "Player decides", "scales",
    );

    companion object {
        /** Anything the server did not send, or this build has not heard of, is the bank's — its default. */
        fun of(wire: String?): EstateRule = entries.firstOrNull { it.wire == wire } ?: RELEASE
    }
}

/**
 * "What happens to your streets?" — the question a bankrupt player is asked
 * at a "player decides" table (1.0.7, H2). [playerId] is aliased like every
 * other id: the bankrupt player's own phone sees its own id, everybody else
 * the one they see on the seat. [properties] are board indices in board
 * order, already the bank's; [endsAt] is when the house answers for them.
 */
@Serializable
data class BankruptChoice(
    val playerId: String = "",
    val name: String = "",
    val properties: List<Int> = emptyList(),
    val endsAt: Double? = null,
) {
    /** "their 3 properties", "their property" — the server's own phrasing. */
    val theirStreets: String
        get() = if (properties.size == 1) "their property" else "their ${properties.size} properties"

    /** "your 3 properties", "your property". */
    val yourStreets: String
        get() = if (properties.size == 1) "your property" else "your ${properties.size} properties"

    /** What everybody else at the table reads while the question is open. */
    val decidingLine: String get() = "${name.ifBlank { "A player" }} is deciding what happens to their streets…"

    /** The server's own refusal for every turn move while this is open — said before anybody presses. */
    val holdLine: String get() = "Waiting for ${name.ifBlank { "a player" }} to decide about their properties"
}

/**
 * How hard the house players the host added play. The server reads the
 * setting for those seats only — never a person's seat it is covering, and
 * never a Play-now table's house players, which always play normal.
 */
enum class BotSkill(val wire: String, val label: String, val blurb: String) {
    EASY("easy", "Easy", "Bots buy carefully, bid low and never start a trade."),
    NORMAL("normal", "Normal", "Bots play the way they always have."),
    HARD("hard", "Hard", "Bots buy nearly everything, build fast and trade often.");

    companion object {
        /** Anything the server did not send, or sent and this build has not heard of, is normal. */
        fun of(wire: String?): BotSkill = entries.firstOrNull { it.wire == wire } ?: NORMAL
    }
}

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
    /**
     * This game's layout is a shuffle of the printed board (round 2): the
     * colour sets sit on new squares, carrying their own deeds. False in the
     * lobby, which always shows the printed board, and absent from an older
     * server. [uid] says which layout exactly.
     */
    val shuffled: Boolean? = null,
) {
    /**
     * What anything cached per board is keyed on: the exact layout, which a
     * shuffle changes while the id stays "classic". An older server sends
     * no uid, and its id was the layout.
     */
    val layoutKey: String get() = uid?.takeIf { it.isNotBlank() } ?: id

    /** This game's layout is a shuffle — false in the lobby and from an older server. */
    val isShuffled: Boolean get() = shuffled == true
}

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

    /** What the bank lends against it: half the price, rounded down, as the server pays it. */
    val mortgageValue: Int? get() = price?.let { it / 2 }

    /** What lifting the mortgage costs — the loan plus ten percent, rounded up like the server. */
    val unmortgageCost: Int? get() = price?.let { kotlin.math.ceil(it / 2.0 * 1.1).toInt() }

    /**
     * The rent that makes a deed worth bidding on, in one short line for the
     * auction card: a street's bare rent and its hotel, an airport's range
     * from one to four held, a utility's dice multiples. Null for anything
     * that charges no rent.
     */
    val rentLine: String?
        get() = when (type) {
            "property" -> rent?.takeIf { it.isNotEmpty() }?.let { r ->
                if (r.size >= 6) "Rent ${money(r[0])} · hotel ${money(r.last())}" else "Rent ${money(r[0])}"
            }
            "airport" -> "Rent ${money(AIRPORT_RENTS.first())}–${money(AIRPORT_RENTS.last())}"
            "utility" -> "Rent ${UTILITY_MULTIPLIERS.first()}× or ${UTILITY_MULTIPLIERS.last()}× the dice"
            else -> null
        }

    companion object {
        /**
         * Airport rent by how many the owner holds, one to four — rentFor() in
         * server/game.js, 25 doubling per airport. The map never ships these;
         * both clients have always written them down.
         */
        val AIRPORT_RENTS = listOf(25, 50, 100, 200)

        /** Utility rent as a multiple of the dice: one held, then two. */
        val UTILITY_MULTIPLIERS = listOf(4, 10)
    }
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
    /**
     * The seat's public friend code — the one its chat lines already carry —
     * which is what a profile is looked up by. A house player has the table's
     * own code for it, and a pass & play guest an empty one: there is nobody
     * behind that seat to look up. Its own key on the wire, so a patch that
     * never mentions it leaves the decoded copy exactly as the last full
     * state had it.
     */
    val code: String? = null,
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
    /**
     * Said "I'm ready" in a Play-now lobby. False everywhere else, and never
     * asked of the host, whose Start is their answer.
     */
    val ready: Boolean? = null,
    /**
     * The seat's level: a person's own (one and up), a house player's steady
     * made-up one, and nought for a pass & play guest. Absent from an older
     * server. Either way below one means no chip — see [shownLevel].
     */
    val level: Int? = null,
) {
    /** The level worth a chip, or null for a guest and for an older server. */
    val shownLevel: Int? get() = level?.takeIf { it > 0 }

    val isBankrupt: Boolean get() = bankrupt == true
    val isReady: Boolean get() = ready == true
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

    /**
     * A house player. Quick tables mask `isBot` so strangers cannot tell who
     * is who, but the house still carries the server's "bot:" id prefix —
     * which only matters for the things a person can be, like a friend.
     */
    val isHouse: Boolean get() = isBot == true || id.startsWith("bot:")

    /**
     * What happened to a seat that is out, in the words its chip uses: only a
     * seat the game actually beat is "bankrupt" — one the clock took, or one
     * that walked out, reads as what really happened. Null while still in.
     */
    val outcomeWord: String?
        get() = when {
            !isBankrupt -> null
            wasRemoved -> if (removedFor == "quit") "left" else "timed out"
            else -> "bankrupt"
        }

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
    /**
     * A lot from a bankrupt player's estate (1.0.6 round 2), sold off one
     * street at a time at a table that auctions estates. Null for an ordinary
     * auction — a declined deed, an auction-only landing — and from an older
     * server, which never sold an estate.
     */
    val estate: EstateLot? = null,
) {
    /**
     * "Ravi's estate — 2 more after this": whose streets are under the
     * hammer and how many of theirs are still to come. Null for an ordinary
     * auction.
     */
    val estateLine: String?
        get() = estate?.let { lot ->
            val whose = lot.from.ifBlank { "A bankrupt player" } + "'s"
            when {
                lot.left <= 0 -> "$whose estate — the last lot"
                lot.left == 1 -> "$whose estate — 1 more after this"
                else -> "$whose estate — ${lot.left} more after this"
            }
        }

    /**
     * The window the countdown is measured against. The room opens on twenty
     * seconds and every bid resets it to twelve; measuring both against twenty
     * made the bar jump back after a bid and read as nearly out of time.
     */
    val windowSeconds: Double get() = if (leader == null) 20.0 else 12.0

    /** The smallest bid the server will take next. */
    val nextBid: Int get() = if (bid == 0) 10 else bid + 10

    /**
     * What a seat can actually put up. The leading bid is held in escrow — it
     * already left the leader's wallet — so their ceiling is cash in hand plus
     * the money sitting on the table.
     */
    fun purse(seat: String, cash: Int): Int = cash + if (leader == seat) bid else 0

    /** The three paddle amounts the dock offers, minus any this purse cannot cover. */
    fun steps(purse: Int): List<Int> = listOf(nextBid, nextBid + 40, nextBid + 90).filter { it <= purse }
}

/**
 * Where an estate lot comes from: the bankrupt player's NAME (never an id),
 * and how many more lots of that same estate follow this one — 0 on its
 * last. A second estate queued behind it is not counted.
 */
@Serializable
data class EstateLot(val from: String = "", val left: Int = 0)

/**
 * How far an estate sale has got, for the auction card's header: this lot's
 * place in the sale, how many lots there are, and the streets still to come
 * after it — what the server does not send, worked out from what this phone
 * saw. [lot] and [total] are null when it cannot know; [upNext] is empty.
 */
data class EstateProgress(val lot: Int?, val total: Int?, val upNext: List<Int>) {
    /** "Lot 2 of 4", or null when the count is not known. */
    val label: String? get() = if (lot != null && total != null) "Lot $lot of $total" else null

    companion object {
        /**
         * The sale's place from its lot. [known] is the bankrupt player's
         * deeds as this phone saw them go — the question's own list at a
         * "player decides" table, otherwise what the seat held the push
         * before it went out — or null when this phone did not see it (it
         * walked in mid-sale). The lots go in board order, so a lot found in
         * it is that far into the sale, and the server's own [left] is the
         * rest. [announced] is the size the log announced the sale at, the
         * fallback for a phone that only has the log.
         */
        fun of(tile: Int, left: Int, known: List<Int>?, announced: Int?): EstateProgress {
            val rest = maxOf(0, left)
            val lots = known?.distinct()?.sorted()
            val at = lots?.indexOf(tile) ?: -1
            if (lots != null && at >= 0) {
                return EstateProgress(at + 1, at + 1 + rest, lots.drop(at + 1).take(rest))
            }
            if (announced != null && announced > rest) return EstateProgress(announced - rest, announced, emptyList())
            return EstateProgress(null, null, emptyList())
        }

        /**
         * The size an estate sale was announced at — "Ravi's 3 properties go
         * to auction, one at a time" — from the latest such line for [from]
         * in the log, or null if the log no longer holds it.
         */
        fun announced(log: List<LogLine>, from: String): Int? {
            if (from.isBlank()) return null
            val many = "$from's "
            for (line in log.asReversed()) {
                val t = line.text
                if (!t.startsWith(many) || !t.endsWith(" to auction, one at a time")) continue
                val what = t.removePrefix(many)
                if (what.startsWith("1 property goes")) return 1
                return what.substringBefore(' ').toIntOrNull() ?: continue
            }
            return null
        }
    }
}

@Serializable
data class TradeSide(
    val money: Int = 0,
    val tiles: List<Int> = emptyList(),
    /** Get-out-of-prison cards. The server values them, and so does the meter. */
    val cards: Int = 0,
) {
    /** Nothing on this side at all — the server refuses a deal that is empty on both. */
    val isEmpty: Boolean get() = money <= 0 && tiles.isEmpty() && cards <= 0
}

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
) {
    /** Set aside for later: it waits behind the "N offers set aside" chip, not in the dock. */
    val isSetAside: Boolean get() = ignored == true

    val viewerIds: List<String> get() = viewers ?: emptyList()
}

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
    /** This seat's own turns this game (1.0.6). */
    val turns: Int? = null,
    /** Colour sets this seat completed this game, each counted once (1.0.6). */
    val setsCompleted: Int? = null,
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
    /**
     * The seat's public code, for opening their profile from the standings.
     * Empty for a seat with nobody to look up, and for every result History
     * filed before codes were sent — which is why it defaults rather than
     * being required.
     */
    val code: String = "",
    /** The seat's level as the final state had it — nought for a guest and for older results. */
    val level: Int = 0,
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
                    code = p.code.orEmpty(),
                    level = p.level ?: 0,
                )
            }
        }
    }
}

/**
 * A finished game as this device remembers it, for History.
 *
 * iOS's `MatchRecord`, field for field, plus the room it was played in so the
 * same result reported twice — a reconnect onto a table that has already
 * ended — is filed once. `outcome` and `results` are optional for the same
 * reason they are there: records written before them still have to decode.
 */
@Serializable
data class MatchRecord(
    val id: String = java.util.UUID.randomUUID().toString(),
    /** Epoch milliseconds the result was filed. */
    val date: Long = 0L,
    val mapName: String = "",
    /** The server's own mark for the board; drawn through mapGlyph() at render. */
    val mapIcon: String = "",
    val players: List<String> = emptyList(),
    /** "Team Crimson", a player's name, or "Nobody". */
    val winner: String = "",
    val won: Boolean = false,
    val myWorth: Int = 0,
    val turns: Int = 0,
    /** "won" | "lost" | "left". */
    val outcome: String? = null,
    /** The full report card — standings, stats, titles — as the live sheet showed it. */
    val results: List<PlayerResult>? = null,
    val roomId: String? = null,
)

/**
 * A table this device walked away from mid-game. The server holds the seat —
 * a bot plays it — so these stay rejoinable until the game actually ends,
 * unlike [MatchRecord], which is the story of a game already over.
 */
@Serializable
data class UnfinishedGame(
    val roomId: String = "",
    val mapName: String = "",
    val mapIcon: String = "",
    val players: List<String> = emptyList(),
    /** Epoch milliseconds this device last saw the table live. */
    val leftAt: Long = 0L,
    /** Pass & play seats this device also held there, so a resume re-seats every one. */
    val guests: Int = 0,
)

/**
 * One open table from `GET /api/rooms`. The list carries games already under
 * way too, and those are a different offer: a seat to sit in, or a table to
 * watch — which is what [canSit] says before anybody taps.
 */
@Serializable
data class PublicRoom(
    val id: String = "",
    val players: Int = 0,
    val maxPlayers: Int = 0,
    /** The board's name. */
    val map: String = "",
    /** "lobby" | "playing". */
    val status: String? = null,
    /** A lobby with a seat still free. Anything else you can only watch. */
    val joinable: Boolean? = null,
    /** Came out of Quick Play matchmaking. */
    val quick: Boolean? = null,
) {
    val canSit: Boolean get() = joinable ?: (status != "playing" && players < maxPlayers)
    val isPlaying: Boolean get() = status == "playing"
}

/**
 * `GET /api/live`: the public games being played right now, people first.
 * Nothing in it leads back to anybody — no tokens, no seat ids, no codes —
 * and `roomId` is only ever used to watch.
 */
@Serializable
data class LiveGamesView(val games: List<LiveGame> = emptyList())

@Serializable
data class LiveGame(
    val roomId: String = "",
    val mapId: String? = null,
    val mapName: String = "",
    /** Every seat in turn order. */
    val players: List<LivePlayer> = emptyList(),
    val turnCount: Int = 0,
    val startedAt: Double? = null,
    /** The game clock, for a timed table. */
    val endsAt: Double? = null,
    /** How many are already watching. */
    val watching: Int = 0,
) {
    /** The seats still playing, which is who the row is about. */
    val standing: List<LivePlayer> get() = players.filter { !it.out }

    /**
     * "Asha, Ravi and 2 more" — the names a row has room for. Seats that are
     * out are left off: a row is a reason to watch, and they are done.
     */
    fun namesLine(room: Int = 2): String {
        val names = standing.ifEmpty { players }.map { it.name }
        return when {
            names.size <= room + 1 -> names.joinToString(", ").ifEmpty { "Players" }
            else -> names.take(room).joinToString(", ") + " and ${names.size - room} more"
        }
    }

    /** Whole minutes left on a timed table's clock, or null for an untimed one. */
    fun minutesLeft(now: Long = System.currentTimeMillis()): Int? =
        endsAt?.let { maxOf(0, kotlin.math.ceil((it - now) / 60_000.0).toInt()) }
}

@Serializable
data class LivePlayer(
    val name: String = "",
    val flag: String = "",
    val color: String = "#888888",
    /** The equipped face, an emoji the player chose — user content, so it is drawn as itself. */
    val avatar: String = "",
    val level: Int = 0,
    val bot: Boolean = false,
    /** Bankrupt or removed. */
    val out: Boolean = false,
)

/**
 * The quick-match waiting room's small talk, `/data/tips.json`: gameplay
 * tips and city facts, dealt alternately while the clock runs.
 */
@Serializable
data class TableTalk(
    val facts: List<TableFact> = emptyList(),
    val tips: List<String> = emptyList(),
) {
    /** The facts the way the ticker reads them out: "City — fact". */
    val factLines: List<String> get() = facts.map { "${it.city} — ${it.text}" }

    companion object {
        /** What the ticker says when the file cannot be reached. */
        const val FALLBACK =
            "The table deals itself in when the clock runs out — every seat gets filled either way."
    }
}

@Serializable
data class TableFact(val city: String = "", val text: String = "")

/**
 * Whole seconds left before a deadline stamped in epoch milliseconds, or null
 * when there is no deadline — which is how the server says a table runs no
 * shot clock, and must draw nothing rather than "0s".
 *
 * Rounded up, as iOS rounds it, so the last second reads 1 and not 0. `cap`
 * is the turn length: a phone whose own clock sits minutes behind the
 * server's would otherwise show 9:58 on a sixty-second turn, and the turn
 * length is the honest ceiling. Leave it null to match iOS exactly.
 */
fun clockSecondsLeft(endsAt: Double?, now: Long = System.currentTimeMillis(), cap: Int? = null): Int? {
    if (endsAt == null) return null
    val left = kotlin.math.ceil((endsAt - now) / 1000.0).toInt()
    val capped = if (cap != null && cap > 0) minOf(left, cap) else left
    return maxOf(0, capped)
}

/**
 * The first turn of the winner's final, unbroken stretch on top — where the
 * game turned. Null when there is no winner, too little history to say, or
 * the winner led from the very first point: leading from turn one is not a
 * turning point. Ported from the net-worth chart on iOS.
 */
fun turningPoint(history: List<WorthPoint>?, winnerId: String?): Int? {
    if (winnerId == null || history == null || history.size < 3) return null
    var flip: Int? = null
    for (point in history) {
        val mine = point.w[winnerId] ?: 0
        val best = point.w.values.maxOrNull() ?: 0
        if (mine >= best) {
            if (flip == null) flip = point.t
        } else {
            flip = null
        }
    }
    return if (flip == history.first().t) null else flip
}

/**
 * A utility tile's power source, as a glyph name. The server marks utilities
 * with an emoji, which is another vendor's artwork and draws differently on
 * every phone, so the mark is only ever read as an identifier. Mirrors
 * `utilityGlyph` on iOS and `utilityName()` in public/js/icons.js.
 */
fun utilityGlyph(mark: String?): String =
    // U+FE0F off first: half the marks on the wire carry the variation
    // selector and half do not, and a `when` sees two different strings.
    when (mark.orEmpty().filter { it.code != 0xFE0F }) {
        "🚰", "💧" -> "droplet"
        "🛢" -> "flame"
        "☀" -> "sun"
        "🌬" -> "turbine"
        else -> "bolt"
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

/**
 * Mirrors roomCodeFrom() in public/js/app.js: what people actually put in the
 * code box is the code, or the whole invite link they were sent, pasted with
 * whatever the message wrapped round it. A link used to be taken literally —
 * lower-cased, its spaces dropped, and cut to twelve characters — which
 * seated the player alone in a brand-new empty room named after the front of
 * the link. So the code is pulled out of either link shape, /?room=CODE or
 * the older /room/CODE, and whatever is left is kept to the letters and
 * digits a room id is made of, at the length the server keeps.
 *
 * The same function tidies the field as it is typed, so what the box shows
 * is what will be joined, and reads the code off a link that opens the app.
 */
fun roomCodeFrom(raw: String?): String {
    val text = raw.orEmpty().trim()
    val linked = QUERY_ROOM.find(text) ?: PATH_ROOM.find(text)
    return (linked?.groupValues?.get(1) ?: text)
        .lowercase()
        .filter { it in 'a'..'z' || it in '0'..'9' }
        .take(12)
}

private val QUERY_ROOM = Regex("[?&]room=([a-z0-9]+)", RegexOption.IGNORE_CASE)
private val PATH_ROOM = Regex("/room/([a-z0-9]+)", RegexOption.IGNORE_CASE)
