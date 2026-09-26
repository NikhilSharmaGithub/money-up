package com.moneymove.game

import android.app.Application
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.json.JSONObject
import kotlin.math.abs

/**
 * The one observable the whole app hangs off: identity, connection, the
 * latest server state, and every action a player can take.
 *
 * The server is authoritative. This store sends intents and renders whatever
 * comes back — exactly like the browser and the iOS app. Nothing here decides
 * a rule; the rules live in `server/game.js`, once, for all three clients.
 *
 * Every socket event is handed to the main thread before it touches anything
 * here. The socket library calls back on a thread of its own, and the store
 * is read by Compose on the main one; with a second connection for a pass &
 * play guest and timers clearing money badges, "usually fine" stopped being
 * good enough. iOS does the same thing with `@MainActor`.
 */
class GameStore(app: Application) : AndroidViewModel(app) {

    val prefs = Prefs(app)

    // ── identity ───────────────────────────────────────────────────────────

    /**
     * Stable per-install identity; the server keys the player's seat off it.
     * Only ever replaced by [startFresh], after the account is deleted.
     */
    var token: String = prefs.token
        private set

    private var nicknameState: String by mutableStateOf(prefs.nickname)
    private var flagState: String by mutableStateOf(prefs.flag)

    /**
     * What this player is called at the next table. Written straight through
     * to disk, the way iOS's `@AppStorage` is — a name typed and then lost on
     * the next launch was the old behaviour, and every caller had to remember
     * to save it by hand.
     */
    var nickname: String
        get() = nicknameState
        set(v) { nicknameState = v; prefs.nickname = v }

    /** The country flag this player wears into every seat. Written through, like [nickname]. */
    var flag: String
        get() = flagState
        set(v) { flagState = v; prefs.flag = v }

    /** This player's own public code, so their own lines get no Report button. */
    var myCode: String by mutableStateOf("")
        private set

    /**
     * Friend codes this player has blocked. Their chat lines are hidden and
     * the server refuses friend requests and messages across the block.
     */
    var blockedCodes: Set<String> by mutableStateOf(emptySet())
        private set

    /**
     * The blocked list, as the server now holds it.
     *
     * Every safety call answers with the whole list rather than a delta, so
     * this is a replace and not a merge — which is what makes blocking on one
     * screen show up on every other one without anybody plumbing it through.
     */
    fun applyBlocked(codes: Set<String>) { blockedCodes = codes }

    /**
     * This player's own public code.
     *
     * Without it their own chat lines are offered a Report button pointed at
     * themselves, which is the kind of thing nobody files a bug about and
     * everybody notices.
     */
    fun applyMyCode(code: String) { myCode = code }

    // ── table state ────────────────────────────────────────────────────────

    var state: GameState? by mutableStateOf(null)
        private set
    var meId: String by mutableStateOf(token)
        private set
    var roomId: String? by mutableStateOf(null)
        private set
    var connection: Connection by mutableStateOf(Connection.DISCONNECTED)
        private set
    var toast: Toast? by mutableStateOf(null)
        private set

    /**
     * Why the server would not seat us — banned, a cup table we were not
     * drawn for. Cleared by the next join and by leaving, so one refusal can
     * never follow a player into the next room they open.
     */
    var joinError: String? by mutableStateOf(null)
        private set

    /** The drawn card, once the piece that drew it is standing on its tile. */
    var cardPopup: LastCard? by mutableStateOf(null)
    /** The deadlock rule, raised as a card the one time it is news. */
    var reliefPopup: ReliefCard? by mutableStateOf(null)
    var turnBanner: PlayerState? by mutableStateOf(null)

    /**
     * The result sheet is up. The store raises it once when a game ends and
     * drops it the moment the room is anything but ended — a rematch must not
     * leave last game's standings over the new lobby. [openResults] brings it
     * back after it has been swiped away.
     */
    var showGameOver: Boolean by mutableStateOf(false)

    /**
     * This device's seat was taken out by the clock — drives the full-screen
     * explainer. Raised on the push that does it; cleared when the player
     * chooses to stay and watch, when the seat is back in play, or when the
     * game is over and the result needs a clean screen.
     */
    var timedOut: Boolean by mutableStateOf(false)

    /**
     * Lines said since the chat was last looked at, by anybody who is not on
     * this device. Uncapped — "99+" is the badge's business, not the count's.
     */
    var unreadChat: Int by mutableStateOf(0)
        private set

    /**
     * Until when the board is still telling the story of the last action.
     *
     * The server resolves a whole roll before the first die has settled, so
     * the push that starts a walk already carries its consequences — a buy
     * prompt, sometimes a whole auction. Those wait behind this curtain, or a
     * player is asked to decide about a street their piece has not reached.
     * See [theatreHolding] and [auctionCurtained] for who waits behind it.
     */
    var holdUntil: Long by mutableStateOf(0L)
        private set

    // ── the purse ledger ───────────────────────────────────────────────────
    //
    // One rule, the same on all three clients: MONEY IS SHOWN WHEN ITS CAUSE
    // IS. The server charges the rent in the very push that starts the walk
    // onto the hotel, so a seat that painted what it was sent would show the
    // money leave before the piece had taken a step — the surprise told
    // backwards. Money that belongs to a journey still on stage (a piece
    // walking, a card being read) is held here along with everything it would
    // say — the number, the badge, the coins, the count, its sound and knock,
    // any bankruptcy it caused and any game-over — and all of it is released
    // together on the journey's payday. Everything else shows the moment it
    // arrives: trades, auctions, other players' money, and anything that
    // comes while nothing is walking.
    //
    // What is held is shown, never decided on: seats, pods, ranks and pieces
    // read [shownPlayers]; the buy button, trade limits, the debt panel and
    // every purse sum keep reading the raw state.

    /** Money waiting on its journey: player id -> what has not been shown yet. */
    var held: Map<String, Int> by mutableStateOf(emptyMap())
        private set

    /** Seats already out on the server whose bankruptcy has not landed on screen. */
    var heldBusts: Set<String> by mutableStateOf(emptySet())
        private set

    /**
     * The game is over on the server but the push that ended it is waiting
     * on a piece still walking: the well and the dock keep playing until the
     * fanfare says otherwise.
     */
    var gameOverHeld: Boolean by mutableStateOf(false)
        private set

    /**
     * Bumped whenever a push is a position rather than news — the first paint
     * of a table, the first state after a reconnect. A counting balance keyed
     * on it snaps into place instead of counting up from what it said before.
     */
    var paintEpoch: Int by mutableIntStateOf(0)
        private set

    /**
     * The journeys the board has to perform, oldest first: the walker plays
     * each one on the journey's own clock, so a piece and the store's timers
     * agree about when it lands. Only journeys opened here are ever walked,
     * which is what makes a reconnect snap rather than replay.
     */
    var stage: List<Journey> by mutableStateOf(emptyList())
        private set

    private val journeys = ArrayList<Journey>()

    /**
     * A push has been seen on this connection since it (re)connected. Until
     * then everything is a position: numbers snap, nothing sounds, nothing
     * walks.
     */
    private var primed = false

    /** The newest leg `seq` a journey has been opened for. */
    private var journeySeq = 0

    /** The seat as the table shows it: money still on its way held back, a bankruptcy not landed yet undone. */
    fun shown(p: PlayerState): PlayerState {
        val h = held[p.id] ?: 0
        val bust = p.id in heldBusts
        if (h == 0 && !bust) return p
        return p.copy(
            money = p.money - h,
            netWorth = p.netWorth?.minus(h),
            bankrupt = if (bust) false else p.bankrupt,
        )
    }

    /** Every seat at the table as it is shown — see [shown]. */
    val shownPlayers: List<PlayerState> get() = state?.players.orEmpty().map { shown(it) }

    /** The journey keyed on this leg stamp, while it is still on stage. */
    fun journeyFor(key: Double): Journey? = journeys.lastOrNull { it.key == key && !it.cut }

    /**
     * Log lines at or before this stamp stay out of the at-a-glance feed. Set
     * at kick-off, so a game opens on a quiet table instead of a wall of lobby
     * chatter — the full log still keeps everything.
     */
    var logFloor: Double by mutableStateOf(0.0)
        private set

    /**
     * Every log line this device has seen at this table, oldest first.
     *
     * The server only ever sends its last sixty; a long game scrolls its
     * opening off that window within a few rounds. This keeps what arrived,
     * so the Log tab can answer "what did he pay for that?" about the first
     * lap as well as the last. It starts over with each table.
     */
    var gameLog: List<LogLine> by mutableStateOf(emptyList())
        private set

    /**
     * One seat's cash just moved: player id -> the change, for the floating
     * "+$200 / −$150" badge on that seat. Each entry clears itself after a
     * moment and only if it has not been replaced by a newer change since.
     */
    var moneyDeltas: Map<String, MoneyDelta> by mutableStateOf(emptyMap())
        private set

    /**
     * A country just became one player's whole set — the board flashes its
     * tiles. A fresh value per completion, so the board can key an animation
     * on it; it clears itself once the flash has had its run.
     */
    var setFlash: SetFlash? by mutableStateOf(null)
        private set

    /**
     * The table's one-line headline at kick-off — "Japan holds the priciest
     * streets this game!" — with the group whose flag goes beside it. The
     * sentence carries no emoji; the flag is the board's to draw.
     */
    var headline: TableHeadline? by mutableStateOf(null)
        private set

    /** A Quick Play request is in flight — dims the button, and nothing else. */
    var quickSearching: Boolean by mutableStateOf(false)
        private set

    /**
     * The open public tables, as [pollPublicRooms] last read them. Empty on a
     * failed read rather than frozen on stale rooms somebody would tap into.
     */
    var publicRooms: List<PublicRoom> by mutableStateOf(emptyList())
        private set

    enum class Connection { DISCONNECTED, CONNECTING, CONNECTED }

    /**
     * A line across the bottom of the screen. `glyph` names a drawn icon for
     * the toasts that have a subject of their own — the eye for a table you
     * are only watching — and is null for the plain ones.
     */
    data class Toast(
        val text: String,
        val isError: Boolean = false,
        val at: Long = System.currentTimeMillis(),
        val glyph: String? = null,
    )

    // ── what the table has open ───────────────────────────────────────────
    //
    // The screens that make up a table belong to different files, and they
    // hand each other work: a seat chip opens a trade aimed at that player, the
    // properties sheet opens the composer already asking for the street you
    // are missing, a deed sheet steps aside for the trade it started. So which
    // sheet is up — and what it was opened with — lives here rather than in
    // any one of them, the way iOS keeps one `ActiveSheet` for the whole
    // screen. One sheet at a time, because two bottom sheets fight.

    /** The sheet the table has open, or null for none. */
    var sheet: TableSheet? by mutableStateOf(null)
        private set

    /** A question the table is waiting on an answer to, or null. */
    var confirm: TableConfirm? by mutableStateOf(null)
        private set

    fun openSheet(next: TableSheet?) { sheet = next }
    fun closeSheet() { sheet = null }

    fun openDeed(tile: Int) = openSheet(TableSheet.Deed(tile))
    fun openProperties() = openSheet(TableSheet.Properties)
    fun openChat() = openSheet(TableSheet.ChatLog(TableSheet.ChatLog.CHAT))
    fun openLog() = openSheet(TableSheet.ChatLog(TableSheet.ChatLog.LOG))
    fun openRules() = openSheet(TableSheet.Rules)
    fun openLook() = openSheet(TableSheet.Look)

    /**
     * The trade composer, aimed and loaded. Everything defaults: a bare call
     * is the "Offer a trade" button, `to` is a seat chip, `give` is a street
     * offered from the properties list, `to` + `get` is "Ask for it". `from`
     * picks which of this device's seats proposes; the active one otherwise —
     * the one active now, written into the draft, so a pass & play turn
     * changing hands while the sheet is open cannot swap whose streets are
     * on the "You give" side.
     */
    fun openTrade(
        to: String? = null,
        give: Set<Int> = emptySet(),
        get: Set<Int> = emptySet(),
        from: String? = null,
    ) = openSheet(TableSheet.Trade(TradeDraft(from = localOr(from, activeId), to = to, give = give, get = get)))

    /**
     * The composer, answering an offer. The seats swap — what they asked of
     * us is what we now give — so the deal comes back pre-filled from our
     * side, cash and cards included, ready to nudge and send. Opened from the
     * offer's own sheet it simply takes that sheet's place: one slot, so the
     * two never fight.
     */
    fun openCounter(offer: TradeOffer) = openSheet(
        TableSheet.Trade(
            TradeDraft(
                from = offer.to, to = offer.from,
                give = offer.get.tiles.toSet(), get = offer.give.tiles.toSet(),
                countering = offer,
                giveCash = offer.get.money, getCash = offer.give.money,
                giveCards = offer.get.cards, getCards = offer.give.cards,
            )
        )
    )

    /** The final standings again — the result sheet can be swiped away. */
    fun openResults() {
        sheet = null
        showGameOver = true
    }

    fun ask(question: TableConfirm?) { confirm = question }
    fun dismissConfirm() { confirm = null }

    /**
     * The way out of a table. Mid-game, leaving deserves a second thought and
     * a way back, so it asks. A seat that has been removed has no game left to
     * leave, and a lobby or a finished game has nothing to lose — those just go.
     */
    fun requestLeave() {
        val removed = me?.wasRemoved == true || me == null
        if (state?.isPlaying == true && !removed) confirm = TableConfirm.LEAVE else leave()
    }

    /**
     * "Give up". On a phone with more than one player still in, the white
     * flag belongs to one of them, so it asks which; otherwise it concedes.
     */
    fun requestConcede() {
        if (aliveLocalSeats.size > 1) confirm = TableConfirm.CONCEDE else concede()
    }

    // ── pass & play ────────────────────────────────────────────────────────

    /**
     * Another person playing from this same device. Each guest keeps a
     * connection of its own because the server binds a seat to the connection
     * that joined it — an intent for Player 2 has to arrive on Player 2's line.
     * Their token is ours plus "_pN", which the server treats as one family:
     * it shows every seat of it to every socket of it under its real id.
     */
    class LocalGuest internal constructor(
        val token: String,
        val number: Int,
        internal val socket: GameSocket,
    ) {
        val id: String get() = token
    }

    /** The extra seats on this device, in the order they sat down. */
    var guests: List<LocalGuest> by mutableStateOf(emptyList())
        private set

    /**
     * Team-channel lines only a guest's own connection received. The server
     * strips other teams' chat per viewer, so a guest on another team hears
     * their channel on their socket and never on ours.
     */
    private var guestTeamChat: List<ChatMessage> by mutableStateOf(emptyList())

    /** Every seat played from this device: the main one plus the guests. */
    val localIds: Set<String> get() = if (guests.isEmpty()) setOf(meId) else setOf(meId) + guests.map { it.token }

    fun isLocal(id: String?): Boolean = id != null && (id == meId || guests.any { it.token == id })

    /**
     * Whose seat the controls act for right now: the local player whose turn
     * it is, falling back to the main player. This is what makes pass & play
     * comfortable — the same buttons serve whoever is holding the phone.
     */
    val activeId: String
        get() = state?.turn?.playerId?.takeIf { isLocal(it) } ?: meId

    /** Seats on this device still in the game — more than one makes "give up" ambiguous. */
    val aliveLocalSeats: List<PlayerState>
        get() = state?.players.orEmpty().filter { isLocal(it.id) && !it.isBankrupt }

    /**
     * Whether another seat can sit down on this device. Never at a cup table:
     * two chairs with names on them, and a second seat here would be sitting
     * in the opponent's. The server refuses it; this is so nobody is invited to.
     */
    val canAddLocalPlayer: Boolean
        get() {
            val s = state ?: return false
            return roomId != null && s.isLobby && s.cup != true && s.players.size < s.settings.maxPlayers
        }

    /** Seat another person at this table, from this device, as "Player N". */
    fun addLocalPlayer() {
        val room = roomId ?: return
        val number = guests.size + 2
        guests = guests + seatGuest("${token}_p$number", number, room)
        prefs.lastGuests = guests.size
        showToast("Player $number joined from this device")
    }

    // ── games left unfinished, and games played out ────────────────────────

    /**
     * Tables this device walked away from mid-game, newest first — the server
     * holds the seats and a bot plays them, so these stay rejoinable until the
     * game really ends. The Continue card is the first of them.
     */
    var unfinishedGames: List<UnfinishedGame> by mutableStateOf(prefs.unfinished)
        private set

    /** Finished games, newest first, fifty deep — History's list. */
    var matchHistory: List<MatchRecord> by mutableStateOf(prefs.history)
        private set

    /** Rejoin one of [unfinishedGames] — the same path the Continue card takes. */
    fun resume(game: UnfinishedGame) {
        prefs.lastRoom = game.roomId
        prefs.lastGuests = game.guests
        continueGame()
    }

    /**
     * Back to the last table, with every pass & play guest this device had
     * there — their tokens are derived from ours, so the server hands each
     * seat straight back.
     *
     * A join on a dead code does not fail: the server quietly opens a new room
     * under it. So the first state that comes back is checked — an empty lobby
     * where a game should be is exactly what gone looks like — and a gone
     * table is said out loud and dropped from the list.
     */
    fun continueGame() {
        val want = prefs.lastRoom
        if (want.isBlank()) return
        val restore = prefs.lastGuests
        if (!join(want)) return
        resumeCheck = roomId
        val room = roomId ?: return
        for (number in 2..(restore + 1)) {
            val guestToken = "${token}_p$number"
            if (guests.any { it.token == guestToken }) continue
            guests = guests + seatGuest(guestToken, number, room)
        }
        prefs.lastGuests = guests.size
    }

    /** That game is over, or the room no longer exists: stop offering it. */
    fun dropUnfinished(room: String) {
        if (unfinishedGames.none { it.roomId == room } && prefs.lastRoom != room) return
        unfinishedGames = unfinishedGames.filter { it.roomId != room }
        if (prefs.lastRoom == room) {
            prefs.lastRoom = ""
            prefs.lastGuests = 0
        }
        saveUnfinished()
    }

    // ── plumbing ───────────────────────────────────────────────────────────

    private var socket: GameSocket? = null

    /**
     * Which connection the store is listening to. Every event is handed to the
     * main thread; one that lands after a leave or a new join belongs to a
     * table we are no longer at, and this is how it knows.
     */
    private var session = 0

    private var toastJob: Job? = null
    private var holdJob: Job? = null
    private var cardJob: Job? = null
    private var bannerJob: Job? = null
    private var headlineJob: Job? = null
    private var gameOverJob: Job? = null

    private var lastCardAt: Double = 0.0
    private var heldActionAt: Double = 0.0
    private var lastTurnId: String? = null
    private var heardChatId: String? = null
    private var chatPrimed = false
    private var pendingCard: LastCard? = null

    /** Whose piece the current hold belongs to; only ever read beside [holdUntil]. */
    private var heldMover: String? = null

    /**
     * The auction on stage opened while its landing was still walking, so it
     * waits for the curtain — and so does its gavel. An auction that was
     * already running (a rebid) never sets it.
     */
    private var auctionUnderHold = false

    /** The table a resume is waiting to hear back from; see [continueGame]. */
    private var resumeCheck: String? = null

    /**
     * A table this device has just walked out of for good. The quit reaches
     * the server a beat before the socket closes, and a push in between must
     * not put the table straight back on the Continue list.
     */
    private var quitRoom: String? = null

    private var unfinishedSavedAt = 0L
    private var deltaSeq = 0L
    private var flashSeq = 0
    private var tableTalk: TableTalk? = null

    val api: Api get() = Api(prefs.server, token)

    /** Main thread, and only if [mine] is still the connection we are listening to. */
    private fun onTable(mine: Int, block: () -> Unit) {
        viewModelScope.launch { if (session == mine) block() }
    }

    // ── derived, the handful every screen asks for ─────────────────────────

    /** The seat the controls speak for — see [activeId]. The main seat whenever no guest holds the turn. */
    val me: PlayerState? get() = state?.player(activeId)
    val currentPlayer: PlayerState? get() = state?.let { it.player(it.turn?.playerId) }

    /** It is one of this device's seats' turn — pass & play hands the phone round. */
    val isMyTurn: Boolean get() = state?.isPlaying == true && isLocal(state?.turn?.playerId)
    val isHost: Boolean get() = state?.hostId == meId

    /** Whether the board is still mid-story, so decisions stay behind it. */
    val theatreLive: Boolean get() = holdUntil > System.currentTimeMillis()

    /**
     * The dock's decision controls for this seat wait while its own move is
     * still walking — my buy prompt must not beat my piece to the square.
     * Other seats, chat and every other control never wait.
     */
    fun theatreHolding(seat: String?): Boolean = theatreLive && seat != null && seat == heldMover

    /**
     * The auction born of the landing still on stage: every viewer watches
     * the walk finish before the box appears. Rebids mid-auction never hide.
     */
    val auctionCurtained: Boolean get() = theatreLive && auctionUnderHold

    fun tile(i: Int): TileData? = state?.map?.tiles?.getOrNull(i)

    fun groupInfo(of: TileData): GroupInfo? = of.group?.let { state?.groups?.get(it) }

    /**
     * Live standings by net worth, player id -> position. Ties fall back to
     * seat order, so two equal fortunes do not swap badges on every tick.
     * Read off the seats as shown, so the crown does not change hands before
     * the rent that moved it has landed.
     */
    val liveRanks: Map<String, Int>
        get() {
            val s = state ?: return emptyMap()
            if (!s.isPlaying) return emptyMap()
            return shownPlayers.withIndex()
                .filter { !it.value.isBankrupt }
                .sortedWith(compareByDescending<IndexedValue<PlayerState>> { it.value.netWorth ?: 0 }.thenBy { it.index })
                .withIndex()
                .associate { (rank, seat) -> seat.value.id to rank + 1 }
        }

    /**
     * Who plays after the current player — the server's own rotation, so
     * people can look up before the turn actually lands on them.
     */
    val nextUpId: String?
        get() {
            val s = state ?: return null
            if (!s.isPlaying || s.players.size < 2) return null
            val current = s.turn?.playerId ?: return null
            val idx = s.players.indexOfFirst { it.id == current }
            if (idx < 0) return null
            for (step in 1..s.players.size) {
                val cand = s.players[(idx + step) % s.players.size]
                if (cand.id == current || cand.isBankrupt || (cand.skipTurns ?: 0) != 0) continue
                return cand.id
            }
            return null
        }

    /**
     * Did a seat this device played take the game? On a team table the team
     * taking it counts — that seat won too.
     */
    fun localSeatWon(s: GameState): Boolean {
        s.winningTeam?.let { team -> return s.players.any { isLocal(it.id) && it.team == team } }
        return isLocal(s.winner?.id)
    }

    /** [localSeatWon] for the table on screen. */
    val iWon: Boolean get() = state?.let { localSeatWon(it) } == true

    /** Was this device at the table at all, or only in the stands? */
    val iPlayed: Boolean get() = state?.players.orEmpty().any { isLocal(it.id) }

    /**
     * What the win was worth: the best seat this device held. On a team table
     * it quotes your own fortune rather than your partner's, because "I won"
     * is a sentence about you.
     */
    val winningWorth: Int
        get() = state?.players.orEmpty().filter { isLocal(it.id) }.mapNotNull { it.netWorth }.maxOrNull() ?: 0

    /** The link that seats a friend at this table, or null with no table. */
    val inviteLink: String? get() = roomId?.let { Prefs.roomLink(it) }

    /**
     * What "Brag about it" / "Share the table" sends — the words iOS sends,
     * with the same link. Losing is worth sharing too, but never as a win.
     */
    val shareText: String
        get() {
            val link = Prefs.roomLink(roomId.orEmpty())
            val s = state
            return if (s != null && localSeatWon(s)) "I won ${money(winningWorth)} on MoneyMove — beat me: $link"
            else "${s?.winnerLabel ?: "Somebody"} just took me down on MoneyMove — get me back: $link"
        }

    /**
     * The friend code of somebody at this table, when this device can know it.
     *
     * Every seat but our own reaches us under a room-scoped alias — a player's
     * real id is their secret token, and the server never lets it out — so a
     * code computed from one of those ids names nobody. A player who has said
     * something here had their real code stamped on the line, and that is the
     * one honest source there is. Null for the house and for anyone quiet.
     */
    fun friendCodeOf(playerId: String, name: String): String? {
        if (playerId.startsWith("bot:")) return null
        if (playerId == meId) return myCode.ifBlank { friendCode(token) }
        if (isLocal(playerId)) return null
        return chatFeed.lastOrNull { it.name == name && !it.code.isNullOrBlank() }?.code
    }

    /** The shot clock's deadline for whoever holds the turn, or null when the table runs none. */
    val turnEndsAt: Double? get() = state?.takeIf { it.isPlaying }?.turn?.endsAt

    /** A seat chip opens a trade with that player — while there is a game and both of you are in it. */
    fun canTradeWith(player: PlayerState): Boolean {
        val s = state ?: return false
        return s.isPlaying && player.id != meId && player.id != activeId &&
            !player.isBankrupt && me?.isBankrupt != true
    }

    /**
     * Whether "Play again" belongs on this finished table. Not at a cup table:
     * a cup match is played once, and the bracket already has the result.
     */
    val canRematch: Boolean get() = state?.isEnded == true && state?.cup != true

    // Who may press what in a lobby — the server's own gates, so no button is
    // offered that would come back refused.

    /** The host may remove anybody but themselves, except at a cup table. */
    fun canKick(player: PlayerState): Boolean =
        isHost && player.id != meId && state?.cup != true

    /** The chair travels to a connected person, never to a bot, and never at a matchmade table. */
    fun canMakeHost(player: PlayerState): Boolean =
        isHost && player.id != meId && player.isBot != true && player.connected != false &&
            state?.quick != true

    /** You may move yourself between teams; the host may move the bots. */
    fun canCycleTeam(player: PlayerState): Boolean =
        (state?.settings?.teams ?: 0) > 0 && (player.id == meId || (isHost && player.isBot == true))

    /** The host fills an empty chair with a house player, except at a cup table. */
    val canAddBot: Boolean get() = isHost && state?.cup != true

    /** A name can still change: the server only listens in the lobby. */
    val canRename: Boolean get() = state?.isLobby == true

    // ── chat, as this device is entitled to read it ────────────────────────

    /**
     * Every chat line this device may read: the main push plus the team
     * channels only a guest's socket receives, deduplicated by the server's
     * id. Somebody this player blocked is not somebody they read, hear, or
     * get a badge for — so the filter sits here, at the source every chat
     * surface draws from.
     */
    val chatFeed: List<ChatMessage>
        get() {
            val blocked = blockedCodes
            val unblocked = { m: ChatMessage -> m.code == null || m.code !in blocked }
            val base = state?.chat.orEmpty().filter(unblocked)
            val extra = guestTeamChat
            if (extra.isEmpty()) return base
            val known = base.mapTo(HashSet()) { it.id }
            val add = extra.filter { it.id !in known && unblocked(it) }
            if (add.isEmpty()) return base
            return (base + add).sortedBy { it.at }
        }

    /**
     * Team chat exists when teams are on and that seat is actually on one.
     * Asked per seat because a pass & play guest can sit on a team the main
     * player is not.
     */
    fun hasTeamChat(seat: String = meId): Boolean =
        (state?.settings?.teams ?: 0) > 0 && state?.player(seat)?.team != null

    /**
     * One channel of [chatFeed] as `seat` would read it: "team" is that seat's
     * own team and nobody else's, and everything else is the public table.
     */
    fun chatFor(channel: String, seat: String = meId): List<ChatMessage> {
        val all = chatFeed
        if (channel != "team" || !hasTeamChat(seat)) return all.filter { !it.isTeam }
        val team = state?.player(seat)?.team
        return all.filter { it.isTeam && it.team == team }
    }

    /** The seats on this device that can still talk — two or more means the composer must say who. */
    val localSpeakers: List<PlayerState>
        get() = state?.players.orEmpty().filter { isLocal(it.id) && !it.isBankrupt }

    /**
     * The seat a composer speaks for: an explicit pick while that player is
     * still at the table, otherwise the main seat — unless it is out and a
     * guest still plays, in which case the player left standing talks rather
     * than a knocked-out name.
     */
    fun speakingSeat(chosen: String? = null): String {
        val speakers = localSpeakers
        if (chosen != null && speakers.any { it.id == chosen }) return chosen
        if (speakers.isEmpty() || speakers.any { it.id == meId }) return meId
        return speakers.first().id
    }

    // ── connection ─────────────────────────────────────────────────────────

    fun connect(room: String) {
        join(room)
    }

    /** Sits down at `room`; false when we were already there and connected. */
    private fun join(room: String): Boolean {
        val id = room.trim().lowercase().take(12)
        if (id.isEmpty()) return false
        if (roomId == id && socket?.isConnected == true) return false
        val sameTable = roomId == id
        leave(quiet = true)
        // Guests sit at one particular table. A join to another one takes
        // them out with it; a reconnect to the same one keeps them seated,
        // along with the team lines only their connections heard.
        if (!sameTable) {
            closeGuests()
            offersShown = emptySet()
        }
        val heardByGuests = guestTeamChat
        resetTable()
        if (sameTable) guestTeamChat = heardByGuests
        roomId = id
        prefs.lastRoom = id
        prefs.lastGuests = guests.size
        joinError = null
        resumeCheck = null
        quitRoom = null
        connection = Connection.CONNECTING

        // A mirror per connection rather than one forgotten and reused: a push
        // still being stitched for the old connection can never land in the
        // copy the new one is building.
        val s = GameSocket(prefs.server)
        val m = StateMirror()
        socket = s
        val mine = ++session
        s.on("you") { d ->
            val pid = d?.get("playerId").asString() ?: return@on
            onTable(mine) { meId = pid }
        }
        s.on("state") { d ->
            if (d == null) return@on
            m.adopt(d)
            val next = decode(d) ?: return@on
            onTable(mine) { apply(next) }
        }
        s.on("statePatch") { d ->
            // Only what moved. Rebuilt against the last state this socket was
            // sent, and handed on as if the server had spelled the whole
            // thing out — nothing downstream can tell the difference.
            if (d == null) return@on
            when (val step = m.apply(d)) {
                is StateMirror.Step.State -> decode(step.json)?.let { next -> onTable(mine) { apply(next) } }
                StateMirror.Step.Resync -> s.emit("resync")
                StateMirror.Step.Feeds -> Unit
            }
        }
        s.on("toast") { d ->
            if (d == null) return@on
            val msg = d["message"].asString() ?: return@on
            val error = d["type"].asString() == "error"
            onTable(mine) {
                if (error) offerRefused(meId)
                showToast(msg, error)
            }
        }
        s.on("joinFailed") { d ->
            if (d == null) return@on
            val msg = d["message"].asString() ?: return@on
            // A table with no seat left still sends its state a beat later, so
            // the player lands on a board they cannot touch. Say out loud that
            // they are watching rather than leaving them to work it out.
            val spectating = (d["spectate"] as? JsonPrimitive)?.content?.toBoolean() == true
            onTable(mine) {
                showToast(
                    if (spectating) "$msg — you're watching this table" else msg,
                    isError = !spectating,
                    glyph = if (spectating) "eye" else null,
                )
                joinError = if (spectating) null else msg
            }
        }
        s.onConnect {
            // A reconnect is a new socket as far as the server is concerned,
            // so whatever it remembered sending us died with the old one.
            m.forget()
            onTable(mine) {
                connection = Connection.CONNECTED
                // Whatever arrives first on the new line is where the table
                // is, not something that just happened to it.
                primed = false
                sendJoin()
            }
        }
        s.onDisconnect { onTable(mine) { connection = Connection.DISCONNECTED } }
        s.onReconnecting { onTable(mine) { connection = Connection.CONNECTING } }
        s.onFailure { Log.w(TAG, "socket: $it") }
        s.connect()
        return true
    }

    private fun sendJoin() {
        val room = roomId ?: return
        socket?.emit("join", JSONObject(mapOf(
            "roomId" to room,
            "token" to token,
            "name" to nickname.ifBlank { "Player" },
            "flag" to flag,
            // Say we can stitch diffs and the table stops re-sending the board
            // thirty times a minute. Silence keeps the old contract.
            "proto" to StateMirror.PROTOCOL_VERSION,
        )))
    }

    /**
     * A pass & play guest's connection. It reclaims its seat on every
     * (re)connect, and it reads nothing off its pushes but the chat — the main
     * connection already carries the state everyone can see — and of that only
     * the team channel, which the main one cannot hear for it.
     */
    private fun seatGuest(guestToken: String, number: Int, room: String): LocalGuest {
        val s = GameSocket(prefs.server, forceNew = true)
        val m = StateMirror(feedsOnly = true)
        val guest = LocalGuest(guestToken, number, s)
        s.onConnect {
            m.forget()
            s.emit("join", JSONObject(mapOf(
                "roomId" to room,
                "token" to guestToken,
                "name" to "Player $number",
                "flag" to "",
                "proto" to StateMirror.PROTOCOL_VERSION,
            )))
        }
        s.on("state") { d ->
            if (d == null) return@on
            m.adopt(d)
            hearGuest(guest, m)
        }
        s.on("statePatch") { d ->
            if (d == null) return@on
            if (m.apply(d) == StateMirror.Step.Resync) s.emit("resync") else hearGuest(guest, m)
        }
        s.on("joinFailed") { d ->
            // A guest who could not sit down is not a player at this table.
            // iOS keeps the dead chair in its list; saying so and letting it
            // go is the honest version of the same thing.
            val msg = d?.get("message").asString() ?: return@on
            viewModelScope.launch {
                if (guests.none { it === guest }) return@launch
                s.disconnect()
                guests = guests.filter { it !== guest }
                prefs.lastGuests = guests.size
                showToast("Player $number couldn't sit down — $msg", isError = true)
            }
        }
        s.on("toast") { d ->
            // A refusal comes back on the connection that asked, and a guest's
            // offer goes out on the guest's own — so the reason it bounced
            // arrives here or nowhere. Only that one is said: the rest of what
            // a guest's line hears, the main one hears too, and iOS reads
            // nothing off a guest's line but its chat.
            if (d?.get("type").asString() != "error") return@on
            val msg = d?.get("message").asString() ?: return@on
            viewModelScope.launch {
                if (guests.none { it === guest } || pendingOffer?.from != guest.token) return@launch
                offerRefused(guest.token)
                showToast(msg, isError = true)
            }
        }
        s.onFailure { Log.w(TAG, "guest socket: $it") }
        s.connect()
        return guest
    }

    /** Folds a guest's team lines into the feed — only the ones its push actually brought. */
    private fun hearGuest(guest: LocalGuest, m: StateMirror) {
        val arrivals = m.chatArrivals
        if (arrivals.isEmpty()) return
        val lines = runCatching { MMJson.decodeFromJsonElement(CHAT_LINES, arrivals) }.getOrNull() ?: return
        viewModelScope.launch {
            if (guests.none { it === guest }) return@launch
            val held = guestTeamChat
            val fresh = lines.filter { line -> line.isTeam && held.none { it.id == line.id } }
            if (fresh.isEmpty()) return@launch
            // The server itself keeps a hundred; there is nothing older to show.
            guestTeamChat = (held + fresh).takeLast(100)
            noteChat()
        }
    }

    private fun closeGuests() {
        guests.forEach { it.socket.disconnect() }
        guests = emptyList()
        guestTeamChat = emptyList()
    }

    /**
     * Asks the server for a table, and hands back its id.
     *
     * A throwaway socket with an acknowledgement, exactly as the browser does
     * it: the table does not exist until the server says so, and opening the
     * long-lived game socket before there is a room to join would only give it
     * somewhere to reconnect to that is not a table.
     *
     * Null means nothing answered — a sleeping free tier, or no network — and
     * the caller says so out loud rather than leaving a dead button. An empty
     * id means matchmaking did answer, with no table in it, which iOS words
     * differently. Eight seconds, iOS's patience, before giving up: the
     * spinner on Play now never runs longer than the iPhone's.
     */
    suspend fun quickplay(): String? {
        quickSearching = true
        try {
            return askForRoom("quickplay", timeoutMs = 8_000, emptyAnswer = "")
        } finally {
            quickSearching = false
        }
    }

    suspend fun createRoom(settings: Map<String, Any?> = emptyMap()): String? =
        askForRoom("createRoom", settings)

    private suspend fun askForRoom(
        event: String,
        payload: Map<String, Any?> = emptyMap(),
        timeoutMs: Long = 12_000,
        emptyAnswer: String? = null,
    ): String? =
        withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine { cont ->
                val probe = GameSocket(prefs.server)
                var settled = false
                val finish = { id: String? ->
                    if (!settled) {
                        settled = true
                        probe.disconnect()
                        cont.resume(id) {}
                    }
                }
                probe.on("roomCreated") { d -> finish(d?.get("roomId").asString()) }
                probe.onConnect {
                    probe.emitAck(event, JSONObject(payload + ("token" to token))) { reply ->
                        finish(reply?.get("roomId").asString() ?: emptyAnswer)
                    }
                }
                probe.onFailure { finish(null) }
                cont.invokeOnCancellation { probe.disconnect() }
                probe.connect()
            }
        }

    /**
     * Off the table and back to the tabs.
     *
     * Walking out mid-game still deserves a History line, and the table goes
     * on the Continue list with the moment we left on it — the server holds
     * the seat and a bot plays it. `quiet` is the half a new join needs: drop
     * the connection, keep everything else.
     */
    fun leave(quiet: Boolean = false) {
        if (!quiet) {
            state?.takeIf { it.isPlaying }?.let { s ->
                recordMatch(s, outcome = "left")
                noteUnfinished(s, force = true)
            }
        }
        socket?.disconnect()
        socket = null
        session++
        holdJob?.cancel(); cardJob?.cancel(); gameOverJob?.cancel()
        dropJourneys()
        if (!quiet) {
            val room = roomId
            closeGuests()
            resetTable()
            offersShown = emptySet()
            readingScreens.clear()
            roomId = null
            joinError = null
            resumeCheck = null
            quitRoom = null
            // Continue points at this table only while it is still one to
            // continue; a lobby, a finished game, or a table left for good
            // leaves nothing behind.
            val kept = unfinishedGames.firstOrNull { it.roomId == room }
            prefs.lastRoom = kept?.roomId.orEmpty()
            prefs.lastGuests = kept?.guests ?: 0
        }
        connection = Connection.DISCONNECTED
    }

    /**
     * "Leave — I'll come back." The seat stays held, a bot plays it, and the
     * landing screen offers the way back — guests and all.
     */
    fun stepAway() {
        val room = roomId
        val seated = guests.size
        leave()
        if (room != null) {
            prefs.lastRoom = room
            prefs.lastGuests = seated
        }
    }

    /**
     * "Leave for good": the streets go back to the bank, every seat on this
     * device walks out together, and it costs a point of karma. The quit has
     * to reach the server before the socket goes — it is what hands the
     * streets back — hence the beat before leaving.
     */
    fun quitAndLeave() {
        confirm = null
        quitGame()
        viewModelScope.launch {
            delay(350)
            leave()
        }
    }

    /** Everything a table leaves on screen, back to nothing — for a new join and for leaving. */
    private fun resetTable() {
        state = null
        cardPopup = null
        reliefPopup = null
        turnBanner = null
        showGameOver = false
        timedOut = false
        unreadChat = 0
        holdUntil = 0L
        logFloor = 0.0
        gameLog = emptyList()
        moneyDeltas = emptyMap()
        setFlash = null
        headline = null
        sheet = null
        confirm = null
        lastTurnId = null
        chatPrimed = false
        heardChatId = null
        heardLogAt = 0.0
        lastCardAt = 0.0
        heldActionAt = 0.0
        heldMover = null
        auctionUnderHold = false
        pendingCard = null
        dropJourneys()
        primed = false
        journeySeq = 0
        guestTeamChat = emptyList()
        pendingOffer = null
        pendingOfferJob?.cancel()
    }

    override fun onCleared() {
        super.onCleared()
        state?.takeIf { it.isPlaying }?.let { noteUnfinished(it, force = true) }
        guests.forEach { it.socket.disconnect() }
        leave(quiet = true)
    }

    // ── the landing screen's questions ─────────────────────────────────────

    /**
     * The open public tables, once. A failed read is an empty list: a list
     * that froze on stale rooms would offer tables that are no longer there.
     */
    suspend fun loadPublicRooms(): List<PublicRoom> {
        val body = api.getPublic("/api/rooms") ?: return emptyList()
        return runCatching { MMJson.decodeFromString(PUBLIC_ROOMS, body) }.getOrElse { emptyList() }
    }

    /**
     * Keeps [publicRooms] fresh every eight seconds, for as long as the caller
     * keeps it running — `LaunchedEffect(Unit) { store.pollPublicRooms() }`,
     * hung somewhere that composes whether or not the list is empty, or it
     * will never start and the card can never appear.
     */
    suspend fun pollPublicRooms() {
        while (true) {
            publicRooms = loadPublicRooms()
            delay(8_000)
        }
    }

    /**
     * A name for anyone who would rather not think of one. The server owns the
     * word lists; if it cannot be reached, this device still has something to
     * put in the field. Becomes [nickname] and is handed back.
     */
    suspend fun rollNickname(): String {
        val body = api.getPublic("/api/name")
        val picked = body?.let { raw ->
            runCatching { (MMJson.parseToJsonElement(raw) as? JsonObject)?.get("name").asString() }.getOrNull()
        }?.trim().orEmpty()
        val name = picked.ifBlank { offlineName() }.take(20)
        nickname = name
        return name
    }

    /**
     * Rename this player at the table. The server keeps sixteen characters
     * and only listens in the lobby (see [canRename]); the name is also kept
     * for the next table either way. False when there was nothing to send.
     */
    fun rename(raw: String): Boolean {
        val name = raw.trim().take(16)
        if (name.isEmpty()) return false
        setAppearance(name = name)
        return true
    }

    /**
     * The quick-match waiting room's tips and facts, fetched once and kept for
     * the life of the app. A miss is not kept, so the next lobby tries again.
     */
    suspend fun loadTableTalk(): TableTalk? {
        tableTalk?.let { return it }
        val body = api.getPublic("/data/tips.json") ?: return null
        val talk = runCatching { MMJson.decodeFromString(TableTalk.serializer(), body) }.getOrNull() ?: return null
        tableTalk = talk
        return talk
    }

    // ── state ──────────────────────────────────────────────────────────────

    private fun decode(json: JsonObject): GameState? =
        runCatching { MMJson.decodeFromJsonElement(GameState.serializer(), json) }
            .getOrElse {
                // One malformed push must not kill the session; keep the last
                // state. The mirror keeps the raw tree either way, so the next
                // patch still has something true to sit on.
                Log.w(TAG, "state decode failed: ${it.message}")
                null
            }

    private fun apply(next: GameState) {
        val old = state
        state = next

        // Coming back to a table the server has already forgotten: a join on a
        // dead code opens a NEW room under it, so the game never "fails" to
        // load — it just isn't there. An empty lobby where a game in progress
        // should be is exactly what gone looks like.
        resumeCheck?.let { want ->
            if (next.id == want) {
                resumeCheck = null
                if (next.isLobby && next.players.size <= guests.size + 1) {
                    dropUnfinished(want)
                    showToast("That table is gone — the game finished without you", isError = true)
                    leave()
                    return
                }
            }
        }

        mergeLog(next.log)
        noteChat()

        // Keep the list of tables still waiting for this device honest.
        noteUnfinished(next)
        if (next.isEnded) dropUnfinished(next.id)

        // The lines this push brought, read once: the ledger files most of
        // their sounds with the journey they belong to, and the dice are
        // sounded below the moment they are thrown.
        val freshLog = next.log.filter { it.at > heardLogAt }
        heardLogAt = next.log.lastOrNull()?.at ?: heardLogAt

        // The journey first, the money second: whether this push's money
        // shows now or waits for a piece to land depends on what it opens.
        val news = noteJourney(old, next, freshLog)
        // A position — the first state after a reconnect — is not news to
        // these either: no gavel for an auction already running, no fanfare
        // for a set closed while the line was down, no card turned over that
        // was drawn out of sight. The iPhone keeps the same quiet.
        if (news) {
            noteAuction(old, next)
            noteSets(old, next)
        }
        noteCard(old, next, news)

        // The deadlock rule explains itself the one time it becomes possible.
        // The server keeps the card in every push from then on, so the `at`
        // stamp — not its presence — is what makes it news, and the stamp is
        // remembered on disk so rejoining the same table does not re-teach it.
        next.reliefCard?.let { card ->
            if (card.at != prefs.reliefSeenAt) {
                prefs.reliefSeenAt = card.at
                reliefPopup = card
                SoundKit.card()
                Haptics.tap()
            }
        }

        // The turn banner, once per change of hands — and the doorbell for any
        // seat on this phone, because pass & play hands the buzz to whoever is
        // being passed the phone, not just the main player.
        next.turn?.playerId?.let { pid ->
            if (next.isPlaying && pid != lastTurnId) {
                lastTurnId = pid
                if (old?.isPlaying == true) {
                    next.player(pid)?.let { who ->
                        bannerJob?.cancel()
                        turnBanner = who
                        bannerJob = viewModelScope.launch {
                            delay(1800)
                            turnBanner = null
                        }
                    }
                }
                if (isLocal(pid)) {
                    Haptics.turn()
                    SoundKit.turn()
                }
            }
        }

        // A fresh game. Everything said before this moment is history, not
        // news: lobby joins while the table filled, or a whole backlog of bot
        // turns when this device walks in on a game already going — no old
        // state then, and the incoming push carries the backlog itself. A
        // rematch runs back through lobby -> playing, so it re-floors here.
        if (next.isPlaying && old?.isPlaying != true) {
            logFloor = (old ?: next).log.lastOrNull()?.at ?: 0.0
            timedOut = false
            announceTopCountry(next)
        }

        noteTimeout(old, next)

        // The result, once. History files it now; the fanfare and the sheet
        // are the ledger's, because the push that ended the game can arrive
        // while the last piece is still walking to the square that ended it
        // — see [voice]. A table that was already over when this device
        // first saw it gets its sheet without the fanfare: that is a
        // position, not news.
        if (next.isEnded && old?.isEnded != true) {
            recordMatch(next)
            sheet = null
            confirm = null
            if (!news) {
                gameOverJob?.cancel()
                gameOverJob = viewModelScope.launch {
                    delay(700)
                    if (state?.isEnded == true) showGameOver = true
                }
            }
        }
        if (!next.isEnded) {
            gameOverJob?.cancel()
            showGameOver = false
        }

        noteOffers(old, next)
        if (news) soundsFor(freshLog)
    }

    /**
     * Folds this push's log window into [gameLog]. The server's window slides,
     * so the newest line we already hold is found in it and only what follows
     * is added. A window with no overlap either jumped more than sixty lines
     * at once (kept, gap and all) or started over (a rematch, another table).
     */
    private fun mergeLog(window: List<LogLine>) {
        val held = gameLog
        if (held.isEmpty() || window.isEmpty()) {
            if (held != window) gameLog = window
            return
        }
        val last = held.last()
        val k = window.indexOfLast { it.key == last.key }
        gameLog = when {
            k == window.lastIndex -> return
            k >= 0 -> (held + window.subList(k + 1, window.size)).takeLast(MAX_LOG)
            window.first().at >= last.at -> (held + window).takeLast(MAX_LOG)
            else -> window
        }
    }

    /**
     * A new line arrived, or several. Sound the ones this device did not say
     * and count them until somebody opens the chat.
     *
     * A chat line carries a name, not a player id, and a table cannot hold two
     * of the same name — so the name is what tells your own voice from
     * everyone else's, pass & play seats included.
     */
    private fun noteChat() {
        val feed = chatFeed
        if (!chatPrimed) {
            // First state of this table: whatever was already said is
            // history, including nothing at all.
            chatPrimed = true
            heardChatId = feed.lastOrNull()?.id
            return
        }
        val last = feed.lastOrNull() ?: return
        if (last.id == heardChatId) return
        // No anchor, or an anchor that has scrolled off the server's window:
        // everything in hand is news.
        val from = heardChatId?.let { h -> feed.indexOfFirst { it.id == h }.takeIf { it >= 0 } }
        val fresh = if (from != null) feed.subList(from + 1, feed.size) else feed
        heardChatId = last.id
        val ownVoices = state?.players.orEmpty().filter { isLocal(it.id) }.mapTo(HashSet()) { it.name }
        val fromOthers = fresh.count { it.name !in ownVoices }
        if (fromOthers == 0) return
        SoundKit.pop()
        unreadChat += fromOthers
    }

    /** Remember the table we are sitting at, so the landing screen can offer it back. */
    private fun noteUnfinished(s: GameState, force: Boolean = false) {
        if (!s.isPlaying || s.id.isBlank() || s.id == quitRoom) return
        if (s.players.none { isLocal(it.id) }) return
        val now = System.currentTimeMillis()
        val entry = UnfinishedGame(
            roomId = s.id,
            mapName = s.map.name,
            mapIcon = s.map.icon.orEmpty(),
            players = s.players.map { it.name },
            leftAt = now,
            guests = guests.size,
        )
        val known = unfinishedGames.firstOrNull { it.roomId == s.id }
        val same = known != null && known.players == entry.players &&
            known.mapName == entry.mapName && known.guests == entry.guests
        // Only the timestamp moves on most pushes, and rewriting the list once
        // per dice roll buys nothing.
        if (same && !force && now - unfinishedSavedAt < 20_000) return
        unfinishedGames = (listOf(entry) + unfinishedGames.filter { it.roomId != s.id }).take(MAX_UNFINISHED)
        saveUnfinished()
    }

    private fun saveUnfinished() {
        unfinishedSavedAt = System.currentTimeMillis()
        prefs.unfinished = unfinishedGames
    }

    /**
     * A finished — or walked-out-of — game, filed for History.
     *
     * A table with no seat of ours was only ever watched; filing it as a loss
     * would put games this device never played into History. And the same
     * ending reported twice (a reconnect onto a table that has already ended)
     * is filed once.
     */
    private fun recordMatch(s: GameState, outcome: String? = null) {
        if (s.players.none { isLocal(it.id) }) return
        val won = localSeatWon(s)
        val mine = s.player(meId)
        val record = MatchRecord(
            date = System.currentTimeMillis(),
            mapName = s.map.name,
            mapIcon = s.map.icon.orEmpty(),
            players = s.players.map { it.name },
            winner = s.winningTeamInfo?.let { "Team ${it.name}" } ?: s.winner?.name ?: "Nobody",
            won = won,
            myWorth = if (mine?.isBankrupt == true) 0 else (mine?.netWorth ?: 0),
            turns = if (s.turn != null) maxOf(s.history?.lastOrNull()?.t ?: 0, 0) else 0,
            outcome = outcome ?: if (won) "won" else "lost",
            results = PlayerResult.snapshot(s),
            roomId = s.id,
        )
        val top = matchHistory.firstOrNull()
        if (top != null && top.roomId == record.roomId && top.outcome == record.outcome &&
            top.winner == record.winner && top.turns == record.turns && top.myWorth == record.myWorth
        ) return
        matchHistory = (listOf(record) + matchHistory).take(MAX_HISTORY)
        prefs.history = matchHistory
    }

    /**
     * The purse ledger, run on every push before anything else looks at the
     * money: opens a journey when a piece has somewhere new to walk, raises
     * the curtain the decision UI waits behind, and decides for each change of
     * cash whether it shows now or waits for the piece it belongs to. Returns
     * whether this push was news at all — false for the first paint of a
     * table and the first state after a reconnect, which are positions.
     */
    private fun noteJourney(old: GameState?, next: GameState, freshLog: List<LogLine>): Boolean {
        val legs = next.moves.orEmpty()
        val newest = legs.lastOrNull()?.at
        val freshLeg = newest != null && newest != heldActionAt
        if (freshLeg) {
            heldActionAt = newest!!
            holdJob?.cancel()
            auctionUnderHold = false
        }

        // A position, not news: the first paint, the first push after a
        // reconnect, a game being dealt, a rematch going back to its lobby.
        // Numbers snap into place, nothing sounds and nothing walks — the
        // legs already on the table are marked seen so they never replay. A
        // game that has just ended is still news: the push that ended it may
        // be waiting on a piece still walking, and a chat line arriving
        // behind it must not wipe the fanfare off the ledger.
        val inGame = { s: GameState -> s.isPlaying || s.isEnded }
        if (old == null || !primed || !inGame(old) || !inGame(next)) {
            primed = true
            // A game-over that was still waiting on its walk when the line
            // dropped is owed its result sheet. The push that ended the game
            // has come and gone, so nothing after this position would ever
            // raise it — the fanfare is lost with the walk, the sheet is not.
            val owed = gameOverHeld && next.isEnded
            dropJourneys()
            journeySeq = maxOf(journeySeq, legs.mapNotNull { it.seq }.maxOrNull() ?: 0)
            if (freshLeg) {
                heldMover = null
                holdUntil = 0L
            }
            if (owed) {
                gameOverJob?.cancel()
                gameOverJob = viewModelScope.launch {
                    delay(700)
                    if (state?.isEnded == true) showGameOver = true
                }
            }
            paintEpoch++
            return false
        }

        val now = System.currentTimeMillis()
        val delta = HashMap<String, Int>()
        for (p in next.players) {
            val was = old.player(p.id)?.money ?: continue
            if (p.money != was) delta[p.id] = p.money - was
        }
        val busts = next.players
            .filter { it.isBankrupt && old.player(it.id)?.isBankrupt == false }
            .mapTo(HashSet()) { it.id }
        val ended = next.isEnded && !old.isEnded
        val kinds = freshLog.mapTo(HashSet()) { it.kind }.apply { remove("dice"); remove("auction") }
        // The walker clangs the gate itself on the walk to prison.
        val walkedToJail = legs.any { it.cause == "jail" }

        // A fresh leg opens a journey. A piece still walking its last one —
        // a double's re-roll landing while the first walk is under way —
        // queues behind it rather than cutting it off.
        var opening: Journey? = null
        if (freshLeg) {
            val playable = legs.filter { (it.seq ?: Int.MAX_VALUE) > journeySeq }.ifEmpty { legs }
            journeySeq = maxOf(journeySeq, legs.mapNotNull { it.seq }.maxOrNull() ?: 0)
            val mover = playable.first().playerId
            val size = next.map.size
            val hasCard = next.lastCard?.let { abs(it.at - newest!!) < 2500 } == true
            // Only a walk still to land is queued behind — one whose payday
            // is already due is over, and the new roll's dice get their full
            // spring rather than the breath a queued walk takes.
            var ahead = journeys.filter { it.mover == mover && !it.landed && it.landAt > now }
            var startAt = maxOf(now, ahead.maxOfOrNull { it.landAt } ?: now)
            if (startAt - now > QUEUE_LIMIT_MS) {
                // Too far behind to be worth waiting for: the older walk is
                // cut and everything it was holding shows now.
                ahead.forEach { flush(it) }
                ahead = emptyList()
                startAt = now
            }
            val lead = if (ahead.isEmpty()) Choreography.DICE_LEAD else Choreography.SETTLE
            val landAt = startAt + seconds(Choreography.payday(playable, size, hasCard, lead))
            val cast = HashSet<String>().apply {
                add(mover)
                addAll(delta.keys)
                addAll(busts)
                // Rent owed by a debtor who paid nothing yet moves nobody's
                // money in this push, and it is still this journey's news.
                next.turn?.debt?.let { d ->
                    d.creditor?.let { add(it) }
                    d.owedTo?.let { addAll(it) }
                }
            }
            val journey = Journey(newest!!, mover, playable, size, hasCard, lead, cast, startAt, landAt)
            journeys += journey
            journey.job = viewModelScope.launch {
                delay(landAt - System.currentTimeMillis())
                release(journey)
            }
            stage = journeys.filter { !it.cut }
            opening = journey

            // The curtain: the decision UI born of this walk — the buy prompt,
            // an auction the landing opened — waits for the piece. Cosmetic,
            // since the shot clock runs on the server, so never more than four
            // seconds of the journey.
            if (next.isPlaying) {
                val run = minOf(Choreography.curtain(playable, size, hasCard, lead) + 0.3, 4.0)
                heldMover = mover
                holdUntil = startAt + seconds(run)
                holdJob = viewModelScope.launch {
                    delay(holdUntil - System.currentTimeMillis())
                    holdUntil = 0L
                    // The gavel waited behind the curtain with its auction.
                    if (auctionUnderHold && state?.auction != null) SoundKit.auction()
                    auctionUnderHold = false
                }
            } else {
                heldMover = null
                holdUntil = 0L
            }
        }

        val opened = opening

        // Money that is never held: a trade, and an auction — escrow moves
        // cash on every bid, and the box is on screen for all to watch. An
        // auction still waiting behind its landing's curtain is the landing's.
        val exempt = opened == null && (
            freshLog.any { it.kind == "trade" } ||
                ((old.auction != null || next.auction != null) && !auctionCurtained)
            )
        val live = journeys.filter { !it.landed }
        val target = when {
            opened != null -> opened
            exempt -> null
            else -> live.lastOrNull { it.mover == old.turn?.playerId }
                ?: live.lastOrNull { j -> delta.keys.any { it in j.cast } || busts.any { it in j.cast } }
        }

        // Who each bankruptcy paid: whoever the debt named, or — for a card
        // that collected from everyone and broke somebody — the player who
        // drew it. Nobody when it went to the bank.
        val creditors = busts.associateWith { bust ->
            val debt = old.turn?.debt?.takeIf { it.debtor == bust } ?: next.turn?.debt?.takeIf { it.debtor == bust }
            when {
                debt != null -> (listOfNotNull(debt.creditor) + debt.owedTo.orEmpty()).toSet()
                opened != null && opened.hasCard && opened.mover != bust -> setOf(opened.mover)
                else -> emptySet()
            }
        }

        val mine = target?.let { t -> delta.filterKeys { it in t.cast } }.orEmpty()
        val bustIn = target?.let { t -> busts.filterTo(HashSet()) { it in t.cast } }.orEmpty()
        // Only what a journey is about waits for it. A later push that moved
        // nobody in its cast, bankrupted nobody in it and did not end the
        // game is not its news — it is said now, log lines and all, as the
        // web and the iPhone say it.
        if (target == null || (opened == null && !ended && mine.isEmpty() && bustIn.isEmpty())) {
            voice(Entry(delta, kinds, busts, creditors, ended, walkedToJail))
            return true
        }
        val rest = delta - mine.keys
        val bustOut = busts - bustIn
        val entry = Entry(mine, kinds, bustIn, creditors, ended, walkedToJail)
        if (!entry.isEmpty) {
            target.entries += entry
            if (mine.isNotEmpty()) held = held.plusDelta(mine)
            if (bustIn.isNotEmpty()) heldBusts = heldBusts + bustIn
            if (ended) gameOverHeld = true
        }
        if (rest.isNotEmpty() || bustOut.isNotEmpty()) {
            voice(Entry(rest, emptySet(), bustOut, creditors, false, walkedToJail))
        }
        return true
    }

    /**
     * A journey's payday: its entries land one after another — the rent, a
     * bot's scramble to raise the cash, the bust — [Choreography.ENTRY_GAP]
     * apart, four at most, anything after the fourth folded into it.
     */
    private suspend fun release(journey: Journey) {
        journey.landed = true
        val entries = journey.entries.toList()
        val queue = if (entries.size <= MAX_ENTRIES) entries
        else entries.take(MAX_ENTRIES - 1) + entries.drop(MAX_ENTRIES - 1).reduce(Entry::plus)
        for ((k, entry) in queue.withIndex()) {
            if (k > 0) delay(seconds(Choreography.ENTRY_GAP))
            land(entry)
        }
        journeys.remove(journey)
        stage = journeys.filter { !it.cut }
    }

    /** One entry off the ledger and onto the table. */
    private fun land(entry: Entry) {
        if (entry.delta.isNotEmpty()) held = held.plusDelta(entry.delta.mapValues { -it.value })
        if (entry.busts.isNotEmpty()) heldBusts = heldBusts - entry.busts
        voice(entry)
    }

    /** A journey cut short: its walk stops and everything it held shows at once. */
    private fun flush(journey: Journey) {
        journey.job?.cancel()
        journey.cut = true
        journey.landed = true
        journeys.remove(journey)
        stage = journeys.filter { !it.cut }
        if (journey.entries.isNotEmpty()) land(journey.entries.reduce(Entry::plus))
    }

    /** Off the stage, every journey, with nothing said: a reconnect, a new table, a rematch. */
    private fun dropJourneys() {
        for (j in journeys) {
            j.job?.cancel()
            j.cut = true
            j.landed = true
        }
        journeys.clear()
        if (stage.isNotEmpty()) stage = emptyList()
        if (held.isNotEmpty()) held = emptyMap()
        if (heldBusts.isNotEmpty()) heldBusts = emptySet()
        gameOverHeld = false
    }

    /**
     * Everything one change of cash says, said together: the badge and its
     * coins on every seat that moved, and one sound for this device.
     *
     * A seat here that paid hears its "ishh" and feels the warning; a seat
     * here that was paid hears the till a quarter second later, as the first
     * coin drops into it and its count starts; anybody else's money is the
     * rent's sag when it was rent, and the quiet till otherwise. A bankruptcy
     * outranks all of it: the seat that fell hears the fall, the seat it paid
     * the register, and everyone else the crash of coins — and the fallen
     * seat gets no "+$300" for the debt the bankruptcy wiped. Then the log's
     * own voices, and last the game-over, after the bust has had its say.
     */
    private fun voice(entry: Entry) {
        val moved = entry.delta.filterKeys { it !in entry.busts }
        if (moved.isNotEmpty()) {
            var deltas = moneyDeltas
            for ((pid, amount) in moved) {
                val badge = MoneyDelta(amount = amount, id = ++deltaSeq)
                deltas = deltas + (pid to badge)
                viewModelScope.launch {
                    delay(1_600)
                    if (moneyDeltas[pid]?.id == badge.id) moneyDeltas = moneyDeltas - pid
                }
            }
            moneyDeltas = deltas
        }

        var winAfter = 0L
        if (entry.busts.isNotEmpty()) {
            val paid = entry.busts.flatMap { entry.creditors[it].orEmpty() }
            when {
                entry.busts.any { isLocal(it) } -> {
                    SoundKit.bankruptFall()
                    Haptics.warn()
                    winAfter = 2_100
                }
                paid.any { isLocal(it) } -> {
                    SoundKit.bankruptKaching()
                    viewModelScope.launch {
                        delay(120)
                        Haptics.turn()
                    }
                    winAfter = 1_200
                }
                else -> {
                    SoundKit.bankruptCrash()
                    winAfter = 1_200
                }
            }
        } else {
            when {
                moved.any { (pid, d) -> d < 0 && isLocal(pid) } -> {
                    SoundKit.lose()
                    Haptics.warn()
                }
                moved.any { (pid, d) -> d > 0 && isLocal(pid) } -> viewModelScope.launch {
                    delay(250)
                    SoundKit.gain()
                    Haptics.tap()
                }
                moved.isNotEmpty() -> if ("rent" in entry.kinds) SoundKit.rent() else SoundKit.cash()
            }
            val kinds = entry.kinds
            when {
                "buy" in kinds -> {
                    SoundKit.buy()
                    Haptics.tap()
                }
                "jail" in kinds && !entry.walkedToJail -> SoundKit.jail()
                "build" in kinds -> SoundKit.build()
                "trade" in kinds -> SoundKit.trade()
            }
        }

        if (entry.ended) {
            gameOverJob?.cancel()
            gameOverJob = viewModelScope.launch {
                if (winAfter > 0) delay(winAfter)
                gameOverHeld = false
                val s = state?.takeIf { it.isEnded } ?: return@launch
                val mine = localSeatWon(s)
                SoundKit.win(mine)
                // The winner's knock lands on the chord, not the pickup.
                if (mine) {
                    delay(320)
                    Haptics.turn()
                    delay(380)
                } else {
                    delay(700)
                }
                if (state?.isEnded == true) showGameOver = true
            }
        }
    }

    /**
     * The auction's own voice: the gavel when it opens — held back with the
     * box if the landing that opened it is still walking — and a rising
     * paddle tick for every new bid, pitched by how high the bid is.
     */
    private fun noteAuction(old: GameState?, next: GameState) {
        if (old == null) return
        val now = next.auction
        val was = old.auction
        if (now != null && was == null) {
            if (theatreLive) auctionUnderHold = true else SoundKit.auction()
        } else if (now != null && was != null && now.bid > was.bid) {
            SoundKit.bid(now.bid)
            Haptics.tap()
        }
    }

    /**
     * A country becoming one player's whole set is a moment: the fanfare once
     * per push however many closed at the same time, and a flash for every
     * one of them. Both states have to be mid-game, so joining a table or a
     * resync does not replay completions that happened long ago.
     */
    private fun noteSets(old: GameState?, next: GameState) {
        if (old == null || !old.isPlaying || !next.isPlaying) return
        val closed = next.map.groups.orEmpty().filter { (_, idxs) ->
            if (idxs.size < 2) return@filter false
            val owner = next.owner(idxs[0])?.owner ?: return@filter false
            idxs.all { next.owner(it)?.owner == owner } && !idxs.all { old.owner(it)?.owner == owner }
        }.keys
        if (closed.isEmpty()) return
        SoundKit.setComplete()
        Haptics.turn()
        val flash = SetFlash(groups = closed.toList(), seq = ++flashSeq)
        setFlash = flash
        viewModelScope.launch {
            delay(3_400)
            if (setFlash === flash) setFlash = null
        }
    }

    /**
     * A drawn card waits for the piece it belongs to. The board releases it
     * (BoardView calls [revealCard] as a leg lands); this is only the floor
     * under it, for a card whose walk the board is not performing. It is
     * measured on the journey's own clock, so a card drawn on a double's
     * re-roll waits for the walk it is queued behind as well as its own. A
     * position — the first state of a table, or after a reconnect — only
     * marks the card seen: it was drawn out of sight, and turning it over
     * now would replay a moment nobody walked to.
     */
    private fun noteCard(old: GameState?, next: GameState, news: Boolean) {
        val card = next.lastCard ?: return
        if (card.at == lastCardAt) return
        lastCardAt = card.at
        cardJob?.cancel()
        if (old == null || !news) return
        val journey = journeys.lastOrNull { !it.cut && abs(card.at - it.key) < 2500 }
        val legs = journey?.legs ?: next.moves.orEmpty()
        val lead = journey?.lead ?: Choreography.DICE_LEAD
        val cardAt = Choreography.timeline(legs, next.map.size, hasCard = true, lead = lead).cardAt ?: 0.0
        val reveal = (journey?.startAt ?: System.currentTimeMillis()) + seconds(cardAt + 0.35)
        pendingCard = card
        cardJob = viewModelScope.launch {
            delay(reveal - System.currentTimeMillis())
            revealCard()
        }
    }

    /**
     * Losing a chair to the clock is not something to discover by scrolling
     * the log — the overlay goes up on the push that does it. It comes down
     * again once the seat is back in play, or once the game is over: "stay
     * and watch how it ends" is a dead offer then, and the result sheet has to
     * sit on a clean screen.
     */
    private fun noteTimeout(old: GameState?, next: GameState) {
        if (old != null) {
            val hit = next.players.any { p ->
                p.removedFor == "timeout" && isLocal(p.id) && old.player(p.id)?.removedFor != "timeout"
            }
            if (hit) {
                timedOut = true
                // The overlay sits under any open sheet, which would bury the
                // only two buttons it offers.
                sheet = null
                SoundKit.lose()
                Haptics.warn()
            }
        }
        if (timedOut && (next.isEnded || next.players.none { it.removedFor == "timeout" && isLocal(it.id) })) {
            timedOut = false
        }
    }

    /** "Japan holds the priciest streets this game!" — once the deal has landed. */
    private fun announceTopCountry(s: GameState) {
        val top = s.map.tiles.filter { it.type == "property" }.maxByOrNull { it.price ?: 0 } ?: return
        val group = top.group ?: return
        val info = s.groups[group] ?: return
        headlineJob?.cancel()
        headlineJob = viewModelScope.launch {
            delay(900)
            headline = TableHeadline("${info.name} holds the priciest streets this game!", group)
            delay(3_400)
            headline = null
        }
    }

    /** The last log line this device has already sounded. */
    private var heardLogAt: Double = 0.0

    /**
     * The one log line that is never held: the dice, heard the moment they
     * are thrown, before the walk they start.
     *
     * Every other line's voice — the buy, the build, the trade, the prison
     * door — is filed by the ledger with the money it came with, and heard
     * when that lands (see [voice]). A first state never gets here: joining a
     * game in progress must not play the last sixty lines.
     */
    private fun soundsFor(freshLog: List<LogLine>) {
        if (freshLog.any { it.kind == "dice" }) SoundKit.dice()
    }

    /**
     * Turns the held card over, once.
     *
     * Called by the board the moment the piece that drew it lands on the tile
     * that drew it, and by the floor timer above for the states where nothing
     * is animating. Idempotent on purpose: whichever gets there first wins and
     * the other is a no-op.
     *
     * `near` is the walker saying which journey it has just landed: a card
     * drawn by the double queued behind it is not this landing's to turn.
     */
    fun revealCard(near: Double? = null) {
        val card = pendingCard ?: return
        if (near != null && abs(card.at - near) >= 2500) return
        pendingCard = null
        if (state?.lastCard?.at != card.at) return
        cardPopup = card
        SoundKit.card()
        viewModelScope.launch {
            delay(3200)
            if (cardPopup?.at == card.at) cardPopup = null
        }
    }

    /** The chat is on screen — everything in it counts as read. */
    fun markChatRead() {
        heardChatId = chatFeed.lastOrNull()?.id ?: heardChatId
        if (unreadChat != 0) unreadChat = 0
    }

    fun showToast(text: String, isError: Boolean = false, glyph: String? = null) {
        toast = Toast(text, isError, glyph = glyph)
        toastJob?.cancel()
        toastJob = viewModelScope.launch {
            // iOS's 2.6 seconds.
            delay(2600)
            toast = null
        }
    }

    // ── actions ────────────────────────────────────────────────────────────
    //
    // Every one of these is an intent, not a decision: the server answers with
    // a new state or a toast saying why not.
    //
    // Room-level intents go out on the main connection. Turn intents go out on
    // the acting seat's own connection, because the server trusts the socket's
    // seat and nothing else — on a phone with one player the two are the same
    // connection and none of this is visible.

    private fun socketFor(seat: String): GameSocket? =
        guests.firstOrNull { it.token == seat }?.socket ?: socket

    private fun emit(event: String, vararg args: Any?) { socket?.emit(event, *args) }
    private fun emitAs(seat: String, event: String, vararg args: Any?) { socketFor(seat)?.emit(event, *args) }
    private fun emitAsActive(event: String, vararg args: Any?) = emitAs(activeId, event, *args)

    /** A seat of this device, if `seat` names one; the main seat otherwise. */
    private fun localOr(seat: String?, fallback: String = meId): String = seat?.takeIf { isLocal(it) } ?: fallback

    fun start() = emit("start")
    fun addBot() = emit("addBot")
    fun kick(playerId: String) = emit("kick", playerId)
    fun makeHost(playerId: String) = emit("makeHost", JSONObject(mapOf("id" to playerId)))
    fun updateSettings(patch: Map<String, Any?>) = emit("settings", JSONObject(patch))
    fun balanceTeams() = emit("balanceTeams")
    fun setTeam(team: Int, playerId: String? = null) =
        if (playerId != null) emit("team", team, playerId) else emit("team", team)

    /**
     * The player's look at this table. A name and a flag are also who they are
     * at the next one, so both are kept on this device as well as sent.
     */
    fun setAppearance(name: String? = null, color: String? = null, flagCode: String? = null) {
        val d = mutableMapOf<String, Any?>()
        name?.let { d["name"] = it; nickname = it }
        color?.let { d["color"] = it }
        flagCode?.let { d["flag"] = it; flag = it }
        emit("appearance", JSONObject(d))
    }

    fun roll() {
        Haptics.tap()
        emitAsActive("roll")
    }
    fun buy() = emitAsActive("buy")
    fun skipBuy() = emitAsActive("skipBuy")
    fun endTurn() = emitAsActive("endTurn")

    /** `seat` picks which of this device's racers holds the paddle; the active seat otherwise. */
    fun bid(amount: Int, seat: String? = null) = emitAs(localOr(seat, activeId), "bid", amount)
    fun passBid(seat: String? = null) = emitAs(localOr(seat, activeId), "passBid")

    fun jailPay() = emitAsActive("jailPay")
    fun jailCard() = emitAsActive("jailCard")

    /**
     * Deeds answer to the seat that owns them. On a phone with one player
     * that is always the main seat; on a pass & play phone a guest's street
     * speaks from the guest's own connection.
     */
    private fun deedSeat(tile: Int): String = localOr(state?.owner(tile)?.owner, activeId)

    // Raising a hotel is four taps in a row, and each one is felt.
    fun build(tile: Int) { Haptics.tap(); emitAs(deedSeat(tile), "build", tile) }

    /** Everything this street's country will take, in one press. */
    fun buildAll(tile: Int) {
        val group = tile(tile)?.group ?: return
        Haptics.tap()
        emitAs(deedSeat(tile), "buildAll", group)
    }
    fun sellHouse(tile: Int) { Haptics.tap(); emitAs(deedSeat(tile), "sellHouse", tile) }
    fun mortgage(tile: Int) { Haptics.tap(); emitAs(deedSeat(tile), "mortgage", tile) }
    fun unmortgage(tile: Int) { Haptics.tap(); emitAs(deedSeat(tile), "unmortgage", tile) }

    /** Kept for the debt panel's "Back in the black"; the server settles a paid debt by itself. */
    fun payDebt() = emitAsActive("payDebt")
    fun declareBankrupt() {
        confirm = null
        emitAsActive("bankrupt")
    }

    /**
     * The white flag, thrown by one of this device's own seats. Off-turn is
     * fine — conceding is a right, not a turn action — and the seat stays at
     * the table as a spectator. `seat` says which local player is giving up;
     * the main seat when nobody says otherwise.
     */
    fun concede(seat: String? = null) {
        confirm = null
        emitAs(localOr(seat), "bankrupt")
    }

    /**
     * Walk out of a live game for good: the deeds go back to the bank, the
     * seat stays as a spectator, and it costs a point of karma. Every seat this
     * device holds walks out together — the guests are people at this table,
     * not chairs to leave behind for bots to play until the clock takes them.
     * Leaving for good leaves nothing to come back to, so the table drops off
     * the Continue list with it. See [quitAndLeave] for the button.
     */
    fun quitGame() {
        roomId?.let { room ->
            quitRoom = room
            dropUnfinished(room)
        }
        for (seat in localIds) emitAs(seat, "quit")
    }

    fun rematch() = emit("rematch")

    /**
     * "Play again" at a matchmade table. It does not reconvene — offering the
     * same players would tell the room the seats were never strangers — so it
     * leaves and asks matchmaking for a fresh table.
     */
    fun playAgainQuick() {
        Haptics.tap()
        leave()
        viewModelScope.launch {
            delay(350)
            val room = quickplay()
            when {
                room.isNullOrEmpty() -> showToast(
                    if (room == null) "Couldn't reach matchmaking — create or join a room instead"
                    else "Matchmaking didn't answer — create or join a room instead",
                    isError = true,
                )
                else -> connect(room)
            }
        }
    }

    /**
     * Hand a dropped player another minute. The server counts one vote per
     * seat, so a pass & play device speaks for every seat it holds — otherwise
     * the vote could never complete on a phone with two players on it.
     */
    fun grantTime(playerId: String) {
        for (seat in localIds) {
            if (seat != playerId) emitAs(seat, "grantTime", JSONObject(mapOf("id" to playerId)))
        }
        Haptics.tap()
    }

    /**
     * `seat` picks which of this device's players is talking — the server
     * stamps a line with the socket's own seat, so Player 2's words must not
     * ride the main connection wearing Player 1's name.
     */
    fun sendChat(text: String, channel: String = "all", seat: String? = null) =
        emitAs(localOr(seat), "chat", text, channel)

    /** `from` picks which of this device's seats proposes; the active one otherwise. */
    fun proposeTrade(to: String, give: TradeSide, get: TradeSide, from: String? = null) =
        emitAs(localOr(from, activeId), "trade:propose", JSONObject(mapOf(
            "to" to to,
            "give" to JSONObject(mapOf("money" to give.money, "tiles" to give.tiles, "cards" to give.cards)),
            "get" to JSONObject(mapOf("money" to get.money, "tiles" to get.tiles, "cards" to get.cards)),
        )))

    /** Only the offer's target may answer it — from their own connection when they are on this device. */
    fun respondTrade(id: Int, accept: Boolean) =
        emitAs(localOr(state?.trades?.firstOrNull { it.id == id }?.to),
            "trade:respond", JSONObject(mapOf("id" to id, "accept" to accept)))

    /** Only the proposer or the target may cancel. */
    fun cancelTrade(id: Int) =
        emitAs(localOr(state?.trades?.firstOrNull { it.id == id }?.from),
            "trade:cancel", JSONObject(mapOf("id" to id)))

    /** Set an offer aside: it leaves the dock but stays in the trade list. */
    fun ignoreTrade(id: Int, ignored: Boolean = true) =
        emitAs(localOr(state?.trades?.firstOrNull { it.id == id }?.to),
            "trade:ignore", JSONObject(mapOf("id" to id, "ignored" to ignored)))

    /**
     * Live "is reading this" presence on an offer. Guarded, so a sheet closing
     * after the trade already resolved never emits against a dead offer.
     */
    fun setTradeViewing(id: Int, viewing: Boolean, seat: String? = null) {
        if (state?.trades?.none { it.id == id } != false) return
        emitAs(localOr(seat), "trade:viewing", JSONObject(mapOf("id" to id, "viewing" to viewing)))
    }

    // ── trading ────────────────────────────────────────────────────────────
    //
    // An offer is the one thing in this game that happens on somebody else's
    // clock, and on a pass & play phone it can be addressed to any seat here.
    // So every list below asks "one of ours?", never "me?" — and the composer
    // helpers take the proposing seat rather than assuming it.

    /** Offers waiting on an answer from a seat on this device, oldest first. The dock shows the first. */
    val incomingOffers: List<TradeOffer>
        get() = state?.trades.orEmpty().filter { isLocal(it.to) && !it.isSetAside }

    /** Offers a seat here set aside for later — the "N offers set aside · Review" chip. */
    val setAsideOffers: List<TradeOffer>
        get() = state?.trades.orEmpty().filter { isLocal(it.to) && it.isSetAside }

    /**
     * Offers this device sent that are still on the table, oldest first.
     * Sending a deal and seeing nothing change is how the same deal gets sent
     * twice, and a deal nobody can see is one nobody can take back.
     */
    val sentOffers: List<TradeOffer>
        get() = state?.trades.orEmpty().filter { isLocal(it.from) }

    /** The offer as the table has it now — readers and all — or null once it is answered or withdrawn. */
    fun liveOffer(id: Int): TradeOffer? = state?.trades?.firstOrNull { it.id == id }

    /** "Later": out of the dock, still on the table, and the sender sees it is waiting. */
    fun setAside(offer: TradeOffer) {
        ignoreTrade(offer.id)
        Haptics.tap()
    }

    /** "Review": the oldest offer set aside goes back into the dock. */
    fun reviewSetAside() {
        setAsideOffers.firstOrNull()?.let { ignoreTrade(it.id, ignored = false) }
        Haptics.tap()
    }

    /**
     * What the seat an offer is addressed to would be short by if it said
     * yes. Accept waits while this is above zero, under "Short $X — sell or
     * mortgage first.", because accepting a deal you can't fund just bounces
     * off the server with a toast.
     *
     * Asked the way the server asks it rather than the way iOS does: a deal
     * that wants no cash from you is always affordable, so a seat in the red
     * can still trade streets to climb out. iOS measures a debtor's negative
     * balance against a cash-free deal and greys out an Accept the server
     * would have taken.
     */
    fun offerShortfall(offer: TradeOffer): Int {
        val ask = offer.get.money
        if (ask <= 0) return 0
        return maxOf(0, ask - (state?.player(offer.to)?.money ?: 0))
    }

    /** Whether Accept is live: the offer is ours to answer and we can pay what it asks. */
    fun canAccept(offer: TradeOffer): Boolean = isLocal(offer.to) && offerShortfall(offer) == 0

    /**
     * Everyone reading this offer right now, bar this device's own seats. Their
     * colours sit beside the eye, so the line says who without a list of
     * names that would not fit anyway.
     */
    fun offerReaders(offer: TradeOffer): List<PlayerState> {
        val s = state ?: return emptyList()
        return offer.viewerIds.filter { !isLocal(it) }.mapNotNull { s.player(it) }
    }

    /** "Ravi is reading this" — under an offer, both the one you sent and the one you were sent. Null when nobody is. */
    fun readingLine(offer: TradeOffer): String? {
        val who = offerReaders(offer)
        if (who.isEmpty()) return null
        return who.joinToString(", ") { it.name } + " is reading this"
    }

    /**
     * Screens that have an offer up, per offer and seat. The dock line, the
     * offer's own sheet and a counter being written can all be showing the
     * same deal, and the sender hears about it once: the eye opens with the
     * first of them and shuts with the last. iOS lets each speak for itself,
     * so closing the sheet over a dock still showing the deal tells the
     * sender nobody is reading it.
     */
    private val readingScreens = HashMap<Pair<Int, String>, Int>()

    /**
     * An offer went up on screen for `seat` — the main seat when unsaid. Every
     * call is paired with [endReading], which is what a DisposableEffect is for.
     */
    fun beginReading(id: Int, seat: String? = null) {
        val key = id to localOr(seat)
        val open = readingScreens[key] ?: 0
        readingScreens[key] = open + 1
        if (open == 0) setTradeViewing(id, true, key.second)
    }

    /** The screen showing it went away. Harmless after the offer is gone: dead offers are never pinged. */
    fun endReading(id: Int, seat: String? = null) {
        val key = id to localOr(seat)
        val open = readingScreens[key] ?: return
        if (open > 1) {
            readingScreens[key] = open - 1
            return
        }
        readingScreens.remove(key)
        setTradeViewing(id, false, key.second)
    }

    /** One side of a deal as a single phrase — "$420 · Venice · 1× prison card", or "nothing". */
    fun tradeSummary(side: TradeSide): String {
        val bits = buildList {
            if (side.money > 0) add(money(side.money))
            addAll(side.tiles.mapNotNull { tile(it)?.name })
            if (side.cards > 0) add("${side.cards}× prison card")
        }
        return if (bits.isEmpty()) "nothing" else bits.joinToString(" · ")
    }

    /**
     * Face value of one side: the cash, fifty for each prison card, and the
     * price printed on each deed. Only face value — it cannot know how badly
     * somebody needs that last street, and the meters that use it say so.
     */
    fun sideWorth(side: TradeSide): Int =
        side.money + side.cards * CARD_WORTH + side.tiles.sumOf { tile(it)?.price ?: 0 }

    /** The seat a composer opened with `draft` proposes from: the one it names if it is ours, else the active one. */
    fun tradeSeat(draft: TradeDraft): String = localOr(draft.from, activeId)

    /**
     * Who `from` could deal with: everyone still in the game but them. A seat
     * that is out holds nothing and an offer to it comes back "Invalid
     * player", so it is never offered. Other seats on this phone count — two
     * people passing it round can trade with each other.
     */
    fun tradePartners(from: String = activeId): List<PlayerState> =
        state?.players.orEmpty().filter { !it.isBankrupt && it.id != from }

    /**
     * Who the composer opens aimed at. The player the draft names while they
     * are still in, else the first who is — a seat chip tapped a moment before
     * its player went bankrupt must not open a sheet aimed at nobody. A
     * counter-offer keeps its sender whatever happened to them: its streets
     * are theirs, and [tradeTargetGone] is what the sheet shows instead.
     */
    fun tradeTarget(draft: TradeDraft): String? {
        if (draft.countering != null) return draft.to
        val partners = tradePartners(tradeSeat(draft))
        return draft.to?.takeIf { id -> partners.any { it.id == id } } ?: partners.firstOrNull()?.id
    }

    /** The player a composer is aimed at has left or gone bankrupt — "This player is no longer in the game." */
    fun tradeTargetGone(to: String?): Boolean {
        val p = state?.player(to) ?: return true
        return p.isBankrupt
    }

    /**
     * Whether "Offer a trade" belongs on screen: a game on, the seat the
     * controls act for still in it, and somebody left to deal with. A seat
     * that is out is watching, and a composer the server will refuse is no
     * use to it.
     */
    val canOfferTrade: Boolean
        get() {
            val s = state ?: return false
            val seat = me ?: return false
            return s.isPlaying && !seat.isBankrupt && tradePartners(seat.id).isNotEmpty()
        }

    /** The deeds `playerId` holds, in board order — either side of the composer. */
    fun tilesOf(playerId: String): List<Int> = state?.ownership.orEmpty()
        .filter { it.value.owner == playerId }
        .keys.mapNotNull { it.toIntOrNull() }
        .sorted()

    /**
     * A deed that cannot change hands — tradeBlocked() in server/game.js:
     * buildings on it, or anywhere in its colour. iOS locks only a deed with
     * houses of its own, so it lets the bare street of a built colour into an
     * offer and the server refuses the whole deal with "Sell the buildings
     * first". The row is shown but locked, the same as a built one.
     */
    fun tradeLocked(i: Int): Boolean {
        val s = state ?: return false
        val own = s.owner(i) ?: return false
        if (own.houseCount > 0) return true
        val t = tile(i) ?: return false
        if (t.type != "property") return false
        val group = t.group ?: return false
        return s.map.groups?.get(group).orEmpty().any { (s.owner(it)?.houseCount ?: 0) > 0 }
    }

    /**
     * The most cash `seat` can put into a deal: what it holds, and nothing
     * at all while it is in the red — a negative balance is a debt, not a
     * wallet, and the slider for it is off rather than dragging through "-$120".
     */
    fun tradeCash(seat: String): Int = maxOf(0, state?.player(seat)?.money ?: 0)

    /** The prison cards `seat` holds. The composer only shows a cards row when this is above zero. */
    fun tradeCards(seat: String): Int = maxOf(0, state?.player(seat)?.getOutCards ?: 0)

    /** How far a deal being written leans, and what evening it out with cash takes — see [TradeBalance]. */
    fun tradeBalance(from: String, to: String, give: TradeSide, get: TradeSide): TradeBalance {
        val gap = sideWorth(get) - sideWorth(give)
        val room = if (gap > 0) maxOf(0, tradeCash(from) - give.money)
        else maxOf(0, tradeCash(to) - get.money)
        return TradeBalance(gap, room)
    }

    /**
     * The one street of a country `seat` does not hold, when it is exactly
     * one. Holding three of four is the moment a trade is worth making.
     */
    fun missingTile(group: String, seat: String = activeId): Int? {
        val s = state ?: return null
        val idxs = s.map.groups?.get(group) ?: return null
        return idxs.filter { s.owner(it)?.owner != seat }.singleOrNull()
    }

    /** Whether "Ask for it" can go to whoever holds `tile`: somebody still in the game, and not `seat` itself. */
    fun canAskFor(tile: Int, seat: String = activeId): Boolean {
        val s = state ?: return false
        if (!s.isPlaying || s.player(seat)?.isBankrupt != false) return false
        val holder = s.player(s.owner(tile)?.owner) ?: return false
        return holder.id != seat && !holder.isBankrupt
    }

    /** "Ask for it": the composer, aimed at whoever holds `tile` and already asking for it. */
    fun askFor(tile: Int, seat: String = activeId) {
        if (!canAskFor(tile, seat)) return
        openTrade(to = state?.owner(tile)?.owner, get = setOf(tile), from = seat)
    }

    /**
     * Whether `tile` can be put into an offer from here: a seat on this phone
     * holds it, the street is free to change hands, and there is somebody to
     * give it to.
     */
    fun canOfferInTrade(tile: Int): Boolean {
        val s = state ?: return false
        if (!s.isPlaying) return false
        val owner = s.owner(tile)?.owner ?: return false
        if (!isLocal(owner) || s.player(owner)?.isBankrupt != false) return false
        return !tradeLocked(tile) && tradePartners(owner).isNotEmpty()
    }

    /** A street offered from the properties list or its deed: the composer opens with it already on our side. */
    fun offerInTrade(tile: Int) {
        if (!canOfferInTrade(tile)) return
        openTrade(give = setOf(tile), from = state?.owner(tile)?.owner)
    }

    /**
     * Sends what the composer holds, checked against the board as it is now
     * rather than as it was when the sheet opened. A street that changed hands
     * or went under a building meanwhile is quietly left out, and cash and
     * cards are cut to what each side still holds — one moved piece does not
     * sink the whole offer with a refusal. A counter-offer declines the deal
     * it answers first, or both would sit live and the old one could still
     * be taken.
     *
     * True when the composer is done with. False when it should stay open,
     * with a toast saying why: nothing left on either side, nobody to send it
     * to, or no connection to send it on — an emit made while the line is
     * down would reach the server ahead of the rejoin and be dropped, so it is
     * not made.
     *
     * "Offer sent" waits for the table to show the offer rather than being
     * said as the button is pressed. A refusal is the server's own toast, and
     * the two never both appear.
     */
    fun sendTrade(
        to: String,
        give: TradeSide,
        get: TradeSide,
        from: String? = null,
        countering: TradeOffer? = null,
    ): Boolean {
        val s = state ?: return true
        if (!s.isPlaying) return true
        val seat = localOr(from, activeId)
        if (s.player(seat)?.isBankrupt != false) {
            showToast("You're out of this game — watching how it ends.", isError = true)
            return false
        }
        val target = s.player(to)
        if (target == null || target.isBankrupt || to == seat) {
            showToast("This player is no longer in the game.", isError = true)
            return false
        }
        val keep = { owner: String, tiles: List<Int> ->
            tiles.distinct().filter { s.owner(it)?.owner == owner && !tradeLocked(it) }.sorted()
        }
        val giving = TradeSide(
            money = give.money.coerceIn(0, tradeCash(seat)),
            tiles = keep(seat, give.tiles),
            cards = give.cards.coerceIn(0, tradeCards(seat)),
        )
        val getting = TradeSide(
            money = get.money.coerceIn(0, tradeCash(to)),
            tiles = keep(to, get.tiles),
            cards = get.cards.coerceIn(0, tradeCards(to)),
        )
        if (giving.isEmpty && getting.isEmpty) {
            showToast("Add something to the trade", isError = true)
            return false
        }
        if (socketFor(seat)?.isConnected != true) {
            showToast("Not connected — the offer didn't go. Try again in a moment.", isError = true)
            return false
        }
        countering?.let { answered -> if (liveOffer(answered.id) != null) respondTrade(answered.id, false) }
        awaitOffer(seat, to, counter = countering != null, known = s.trades)
        proposeTrade(to, giving, getting, seat)
        return true
    }

    /** An offer on its way, until the table shows it or the server says no — see [sendTrade]. */
    private class PendingOffer(val from: String, val to: String, val counter: Boolean, val known: Set<Int>)

    private var pendingOffer: PendingOffer? = null
    private var pendingOfferJob: Job? = null

    private fun awaitOffer(from: String, to: String, counter: Boolean, known: List<TradeOffer>) {
        pendingOffer = PendingOffer(from, to, counter, known.mapTo(HashSet()) { it.id })
        pendingOfferJob?.cancel()
        // A table that never answers either way has nothing true to say, so
        // after a while this stops listening rather than guessing.
        pendingOfferJob = viewModelScope.launch {
            delay(10_000)
            pendingOffer = null
        }
    }

    /** The server refused something `seat` asked for. If that was an offer, the refusal is the answer. */
    private fun offerRefused(seat: String) {
        if (pendingOffer?.from != seat) return
        pendingOffer = null
        pendingOfferJob?.cancel()
    }

    /**
     * Offers already put in front of their reader, by id. Answering one or
     * closing its sheet does not bring it back: a push a second later must
     * not throw the same deal up again, and neither must a reconnect — so
     * this outlives a rejoin of the same table and is only dropped for another.
     */
    private var offersShown: Set<Int> = emptySet()

    /**
     * What a push means for trading. The offer we sent is on the table, so
     * now it is true to say so. An offer sheet whose deal was withdrawn or
     * answered elsewhere comes down — Accept on it could only ever say "Trade
     * not found". And a fresh offer to a seat here comes to the front of the
     * screen, once: it lands while you are looking at the board, and the
     * person who sent it is waiting.
     *
     * One at a time and oldest first, and never over something already open —
     * a sheet, a question, the result, the timed-out screen. An offer held
     * back that way waits for the next change to the offers, as on iOS. The
     * sound is the log's: the "sent a trade offer" line rings for everyone.
     */
    private fun noteOffers(old: GameState?, next: GameState) {
        val live = next.trades.mapTo(HashSet()) { it.id }
        offersShown = offersShown.filterTo(HashSet()) { it in live }
        readingScreens.keys.removeAll { it.first !in live }

        pendingOffer?.let { p ->
            if (next.trades.any { it.from == p.from && it.to == p.to && it.id !in p.known }) {
                pendingOffer = null
                pendingOfferJob?.cancel()
                showToast(if (p.counter) "Counter-offer sent" else "Offer sent")
            }
        }

        (sheet as? TableSheet.Offer)?.let { up -> if (up.offer.id !in live) sheet = null }

        val moved = old == null ||
            old.trades.map { it.id to it.isSetAside } != next.trades.map { it.id to it.isSetAside }
        if (!moved || !next.isPlaying) return
        if (sheet != null || confirm != null || showGameOver || timedOut) return
        val fresh = next.trades
            .filter { isLocal(it.to) && !it.isSetAside && it.id !in offersShown }
            .minByOrNull { it.id } ?: return
        offersShown = offersShown + fresh.id
        sheet = TableSheet.Offer(fresh, fresh.to)
    }

    // ── rules the UI needs to ask about before it offers a button ──────────
    //
    // Mirrors of the server's own checks. The server still decides; these only
    // stop the app from offering a button that would come back refused. They
    // key on "a seat of OURS owns it", so on a pass & play phone a guest's
    // deeds work on the guest's turn — and on the owner's turn only, because
    // the server builds, sells and mortgages on your own clock and nobody
    // else's (game.js: isCurrent in build, sellHouse, mortgage, unmortgage).

    /** The active seat's deeds, in board order. */
    fun myTiles(): List<Int> = tilesOf(activeId)

    fun ownsFullGroup(playerId: String, group: String): Boolean {
        val s = state ?: return false
        val idxs = s.map.groups?.get(group) ?: return false
        return idxs.isNotEmpty() && idxs.all { s.owner(it)?.owner == playerId }
    }

    /**
     * Whether Build is live. One thing more than iOS asks: the owner can pay
     * for the house. iOS leaves the button lit and lets the server say "Not
     * enough money"; here it greys out and the deed sheet says why.
     */
    fun canBuild(i: Int): Boolean {
        val s = state ?: return false
        if (!s.isPlaying) return false
        val t = tile(i) ?: return false
        val own = s.owner(i) ?: return false
        if (t.type != "property" || !isLocal(own.owner) || own.isMortgaged) return false
        if (s.turn?.playerId != own.owner) return false
        val group = t.group ?: return false
        val idxs = s.map.groups?.get(group) ?: return false
        if (!ownsFullGroup(own.owner, group)) return false
        if (idxs.any { s.owner(it)?.isMortgaged == true }) return false
        if (own.houseCount >= 5) return false
        if (s.settings.evenBuild != false) {
            val lowest = idxs.minOfOrNull { s.owner(it)?.houseCount ?: 0 } ?: 0
            if (own.houseCount > lowest) return false
        }
        return (s.player(own.owner)?.money ?: 0) >= (t.houseCost ?: 0)
    }

    /**
     * How many buildings one press of Build all would actually put up.
     *
     * The server decides; this only decides whether to offer the button and
     * what number to print on it. It walks the same loop `GameRoom.buildAll`
     * does — always the shortest street in the country next, cheapest first
     * when they are level — so the number on the button is the number in the
     * log a moment later rather than an optimistic guess the player then has
     * to reconcile.
     *
     * Zero means don't offer it; one means Build already says everything this
     * button would.
     */
    fun buildAllCount(i: Int): Int {
        val s = state ?: return 0
        val group = tile(i)?.group ?: return 0
        val idxs = s.map.groups?.get(group) ?: return 0
        val own = s.owner(i) ?: return 0
        if (!isLocal(own.owner)) return 0
        // Ownership, mortgages, whose turn it is: canBuild already says all of
        // it. If no street in the country may take a house, neither may this.
        if (idxs.size < 2 || idxs.none { canBuild(it) }) return 0

        val houses = idxs.associateWith { (s.owner(it)?.houseCount ?: 0) }.toMutableMap()
        var purse = s.player(own.owner)?.money ?: 0
        val even = s.settings.evenBuild != false
        var built = 0

        // At most five to a street, so this cannot run away.
        repeat(idxs.size * 5) {
            val lowest = houses.values.minOrNull() ?: 0
            val next = idxs
                .filter { idx ->
                    val standing = houses[idx] ?: 0
                    val cost = tile(idx)?.houseCost ?: 0
                    standing < 5 && cost > 0 && cost <= purse && (!even || standing == lowest)
                }
                // The shortest street next, cheapest first when they are level.
                .minWithOrNull(
                    compareBy({ houses[it] ?: 0 }, { tile(it)?.houseCost ?: 0 })
                ) ?: return built
            purse -= tile(next)?.houseCost ?: 0
            houses[next] = (houses[next] ?: 0) + 1
            built++
        }
        return built
    }

    fun canSellHouse(i: Int): Boolean {
        val s = state ?: return false
        val own = s.owner(i) ?: return false
        if (!isLocal(own.owner) || own.houseCount <= 0) return false
        if (s.turn?.playerId != own.owner) return false
        if (s.settings.evenBuild != false) {
            val group = tile(i)?.group ?: return true
            val idxs = s.map.groups?.get(group).orEmpty()
            val highest = idxs.maxOfOrNull { s.owner(it)?.houseCount ?: 0 } ?: 0
            if (own.houseCount < highest) return false
        }
        return true
    }

    fun canMortgage(i: Int): Boolean {
        val s = state ?: return false
        if (s.settings.mortgage == false) return false
        val own = s.owner(i) ?: return false
        if (!isLocal(own.owner) || own.isMortgaged) return false
        if (s.turn?.playerId != own.owner) return false
        // A street with buildings anywhere in its colour cannot be mortgaged.
        val t = tile(i)
        if (t?.type == "property") {
            val group = t.group
            if (group != null) {
                val idxs = s.map.groups?.get(group).orEmpty()
                if (idxs.any { (s.owner(it)?.houseCount ?: 0) > 0 }) return false
            }
        }
        return true
    }

    /**
     * Whether lifting a mortgage would be taken: our street, our turn, and the
     * loan plus ten percent in hand. iOS lights this button whenever mortgages
     * are on and lets the server refuse; the server refuses both off-turn and
     * short, so this says so first.
     */
    fun canUnmortgage(i: Int): Boolean {
        val s = state ?: return false
        if (s.settings.mortgage == false) return false
        val own = s.owner(i) ?: return false
        if (!isLocal(own.owner) || !own.isMortgaged) return false
        if (s.turn?.playerId != own.owner) return false
        val cost = tile(i)?.unmortgageCost ?: return false
        return (s.player(own.owner)?.money ?: 0) >= cost
    }

    /**
     * What this street earns per landing right now — rentFor() in
     * server/game.js: the rent for the houses standing, doubled on a bare
     * full set when that rule is on, and 25 doubling per airport held. Null
     * for a street nobody owns, a mortgaged one, and a utility, whose rent
     * waits for the dice.
     */
    fun rentNow(i: Int): Int? {
        val s = state ?: return null
        val t = tile(i) ?: return null
        val own = s.owner(i) ?: return null
        if (own.isMortgaged) return null
        return when (t.type) {
            "property" -> {
                val base = t.rent?.getOrNull(own.houseCount) ?: return null
                val full = t.group?.let { ownsFullGroup(own.owner, it) } == true
                if (full && own.houseCount == 0 && s.settings.x2rent != false) base * 2 else base
            }
            "airport" -> 25 * (1 shl maxOf(0, s.ownedOfType(own.owner, "airport") - 1))
            else -> null
        }
    }

    // ── owing money ────────────────────────────────────────────────────────

    /** The debt the active seat is paying off right now, or null. */
    val myDebt: DebtState?
        get() {
            val t = state?.turn ?: return null
            val d = t.debt ?: return null
            return if (t.phase == "debt" && d.debtor == activeId) d else null
        }

    /**
     * What is still owed. The balance below zero IS the debt — every sale
     * streams straight to whoever it names — so this climbs to zero as the
     * rescue rows get tapped.
     */
    val debtRemaining: Int get() = maxOf(0, -(me?.money ?: 0))

    /**
     * Every legal way the active seat can turn property into cash right now,
     * biggest first. Mortgaging waits while buildings stand, so the list
     * simply re-reads itself after each tap and the mortgages appear once the
     * houses are gone.
     */
    fun raiseOptions(): List<RaiseOption> {
        val out = mutableListOf<RaiseOption>()
        for (i in myTiles()) {
            val t = tile(i) ?: continue
            val houses = state?.owner(i)?.houseCount ?: 0
            val cost = t.houseCost ?: 0
            if (canSellHouse(i) && cost > 0) {
                out += RaiseOption(
                    id = "sell-$i", tile = i, amount = cost / 2,
                    label = if (houses == 5) "Sell the hotel on ${t.name}" else "Sell a house on ${t.name}",
                    kind = RaiseOption.Kind.SELL,
                )
            }
            val price = t.price ?: 0
            if (canMortgage(i) && price > 0) {
                out += RaiseOption(
                    id = "mortgage-$i", tile = i, amount = price / 2,
                    label = "Mortgage ${t.name}",
                    kind = RaiseOption.Kind.MORTGAGE,
                )
            }
        }
        return out.sortedWith(compareByDescending<RaiseOption> { it.amount }.thenBy { it.id })
    }

    /** Take one of [raiseOptions]. */
    fun raise(option: RaiseOption) = when (option.kind) {
        RaiseOption.Kind.SELL -> sellHouse(option.tile)
        RaiseOption.Kind.MORTGAGE -> mortgage(option.tile)
    }

    // ── auctions, which everyone at the table is in ────────────────────────

    /** Whoever holds the leading bid, or null before the first one. */
    val auctionLeader: PlayerState? get() = state?.let { s -> s.player(s.auction?.leader) }

    /** This device's seats still in the race, in auction order. */
    val auctionRacers: List<String>
        get() {
            val s = state ?: return emptyList()
            val a = s.auction ?: return emptyList()
            return a.inRace.filter { isLocal(it) && s.player(it)?.isBankrupt != true }
        }

    /**
     * The seat the paddle acts for: an explicit pick while it still races,
     * otherwise the richest local seat that is not already leading — the
     * leader's bid is the one on the table, so the phone offers the paddle to
     * whoever might still want to answer it. Null means "you're out".
     */
    fun biddingSeat(chosen: String? = null): String? {
        val a = state?.auction ?: return null
        val racers = auctionRacers
        if (chosen != null && chosen in racers) return chosen
        val pool = racers.filter { it != a.leader }.ifEmpty { racers }
        return pool.maxByOrNull { state?.player(it)?.money ?: 0 }
    }

    /** What `seat` can put up — cash in hand plus its own escrowed leading bid. */
    fun auctionPurse(seat: String): Int {
        val s = state ?: return 0
        val a = s.auction ?: return 0
        return a.purse(seat, s.player(seat)?.money ?: 0)
    }

    /**
     * The paddle amounts `seat` can actually afford, absolute rather than
     * "+$10" — empty means the next bid is out of reach and all that is left
     * is to pass.
     */
    fun bidSteps(seat: String): List<Int> {
        val a = state?.auction ?: return emptyList()
        return a.steps(auctionPurse(seat))
    }

    // ── starting over ──────────────────────────────────────────────────────

    /**
     * The account is gone on the server; become somebody new on this device.
     *
     * Keeping the old token would quietly mint a fresh profile under it on the
     * very next request — the same identity the player just asked to delete.
     * The tables the old identity sat at go too: their seats belong to an
     * account that no longer exists.
     */
    fun startFresh() {
        // Settings, where deleting happens, is not on screen at a table, so
        // normally there is nothing to drop. If there is, it belonged to the
        // identity that just went, and nobody can play it any more.
        if (roomId != null) {
            leave(quiet = true)
            roomId = null
            resetTable()
            closeGuests()
        }
        prefs.putString("mm.token", "u_and_" + java.util.UUID.randomUUID().toString().replace("-", ""))
        token = prefs.token
        meId = token
        nickname = ""
        prefs.lastRoom = ""
        prefs.lastGuests = 0
        unfinishedGames = emptyList()
        prefs.unfinished = emptyList()
        blockedCodes = emptySet()
        myCode = ""
    }

    companion object {
        private const val TAG = "MMStore"

        /** Five is as far back as a room code is worth keeping. */
        const val MAX_UNFINISHED = 5
        const val MAX_HISTORY = 50
        private const val MAX_LOG = 1_000

        /** What a prison card weighs on the deal meters — the price iOS and the web both put on it. */
        const val CARD_WORTH = 50

        /** Same shape as server/names.js — two short words that fit a player chip. */
        fun offlineName(): String {
            val adjectives = listOf("Lucky", "Bold", "Sneaky", "Royal", "Swift", "Golden",
                "Silent", "Cheeky", "Grand", "Wild", "Clever", "Turbo")
            val nouns = listOf("Tycoon", "Baron", "Mogul", "Trader", "Broker", "Hustler",
                "Duke", "Tiger", "Rocket", "Ninja", "Seth", "Boss")
            return "${adjectives.random()} ${nouns.random()}"
        }

        private val PUBLIC_ROOMS = ListSerializer(PublicRoom.serializer())
        private val CHAT_LINES = ListSerializer(ChatMessage.serializer())

        /**
         * A journey that would have to wait longer than this behind its
         * piece's last one is not queued: the older walk is cut and its money
         * shown, as a cut walk always was.
         */
        private const val QUEUE_LIMIT_MS = 6_000L

        /** A journey lands at most this many entries; anything after folds into the last. */
        private const val MAX_ENTRIES = 4

    }

    /**
     * One piece's walk on stage — every leg one push shipped, and the card it
     * drew — with the money that belongs to it.
     *
     * [key] is the newest leg's stamp. [cast] is who the journey is about:
     * the mover, everybody whose money moved in the push that opened it, and
     * whoever a debt it left names — rent owed by a debtor who paid nothing
     * yet moves no money and is still this journey's news. [startAt] and
     * [landAt] are wall-clock ms: when the walk begins (after the one ahead
     * of it, for a double's re-roll) and its payday. The walker plays the
     * legs on exactly this clock.
     */
    class Journey internal constructor(
        val key: Double,
        val mover: String,
        val legs: List<MoveLeg>,
        val boardSize: Int,
        val hasCard: Boolean,
        val lead: Double,
        val cast: Set<String>,
        val startAt: Long,
        val landAt: Long,
    ) {
        internal val entries = ArrayList<Entry>()
        internal var job: Job? = null

        /** Payday has come: nothing more is filed with it. */
        internal var landed = false

        /** Cut short — a reconnect, a new table, a walk too far behind — and not to be walked any further. */
        var cut = false
            internal set
    }

    /**
     * One push's worth of a journey's money and what it would say: the change
     * per seat, the log's kinds (less the dice and the gavel, which are never
     * held), who went bankrupt, who each bankruptcy paid, and whether it
     * ended the game.
     */
    data class Entry(
        val delta: Map<String, Int>,
        val kinds: Set<String>,
        val busts: Set<String>,
        val creditors: Map<String, Set<String>>,
        val ended: Boolean,
        val walkedToJail: Boolean,
    ) {
        val isEmpty: Boolean get() = delta.isEmpty() && kinds.isEmpty() && busts.isEmpty() && !ended

        /** Two entries said as one — the tail of a journey that filed more than four. */
        operator fun plus(o: Entry) = Entry(
            delta = delta.plusDelta(o.delta),
            kinds = kinds + o.kinds,
            busts = busts + o.busts,
            creditors = (creditors.keys + o.creditors.keys).associateWith {
                creditors[it].orEmpty() + o.creditors[it].orEmpty()
            },
            ended = ended || o.ended,
            walkedToJail = walkedToJail || o.walkedToJail,
        )
    }
}

/**
 * The sheet a table has open. One at a time — see [GameStore.sheet].
 *
 * Written the way iOS writes its `ActiveSheet`: each case carries what the
 * sheet was opened with, so whoever opens it and whoever draws it never have
 * to reach into each other.
 */
sealed interface TableSheet {
    /** The deed for one tile. */
    data class Deed(val tile: Int) : TableSheet

    /** The active seat's streets — and, while in debt, the rescue plan. */
    data object Properties : TableSheet

    /** The trade composer, aimed and loaded. */
    data class Trade(val draft: TradeDraft) : TableSheet

    /** An incoming offer put in front of the seat it is for. */
    data class Offer(val offer: TradeOffer, val seat: String) : TableSheet

    /** Chat and the game log, opening on one or the other. */
    data class ChatLog(val tab: Int = CHAT) : TableSheet {
        companion object {
            const val CHAT = 0
            const val LOG = 1
        }
    }

    /** The house rules sheet. */
    data object Rules : TableSheet

    /** The player's own look — piece, colour, name. */
    data object Look : TableSheet
}

/**
 * What the trade composer opens with. Every field defaults, so the bare
 * "Offer a trade" button is `TradeDraft()` and each entry point fills in only
 * what it knows. The trade half of the data layer adds to this; nothing here
 * will be taken away.
 */
data class TradeDraft(
    /**
     * Which of this device's seats proposes. [GameStore.openTrade] always
     * fills it in; null only ever means the active seat.
     */
    val from: String? = null,
    /** Who it is aimed at; null lets the composer pick. */
    val to: String? = null,
    /** Our streets already on the table. */
    val give: Set<Int> = emptySet(),
    /** Their streets already asked for. */
    val get: Set<Int> = emptySet(),
    /**
     * The offer this answers. Sending a counter declines the original first,
     * or both would sit live and the other side could still take the old one.
     */
    val countering: TradeOffer? = null,
    /**
     * Cash and prison cards already on the table — only a counter-offer opens
     * with any, because it opens on the whole deal it answers. Streets alone
     * would lose the money and the cards the other side put in, and a counter
     * that quietly drops a card is worse than no counter at all.
     */
    val giveCash: Int = 0,
    val getCash: Int = 0,
    val giveCards: Int = 0,
    val getCards: Int = 0,
)

/** A question the table is holding open. */
enum class TableConfirm {
    /**
     * "Leave the game?" — Leave, I'll come back ([GameStore.stepAway]); Give
     * up — declare bankruptcy ([GameStore.requestConcede]); Leave for good
     * ([GameStore.quitAndLeave]). Copy: "A bot holds your seat while you're
     * away, so you can continue from the home screen. Leaving for good returns
     * your streets to the bank and costs 1 karma."
     */
    LEAVE,

    /**
     * "Who gives up?" — one "<name> gives up" per [GameStore.aliveLocalSeats],
     * each calling [GameStore.concede] with that seat. Copy: "That player
     * declares bankruptcy and stays as a spectator. Everyone else on this
     * phone plays on."
     */
    CONCEDE,

    /**
     * "Declare bankruptcy?" from the properties list, on your own turn — "Go
     * bankrupt" calls [GameStore.declareBankrupt]. Copy: "Everything you own
     * returns to the bank and you are out of the game."
     */
    BANKRUPT,

    /**
     * The same question from the debt panel, where the money has somewhere to
     * go. Copy: "Everything you own goes to whoever you owe, and you are out
     * of the game."
     */
    DEBT_BANKRUPT,
}

/** Seconds on the choreography's clock, as the milliseconds a timer waits. */
private fun seconds(s: Double): Long = (s * 1000).toLong()

/** Adds one change of cash to another, forgetting any seat it brings back to zero. */
private fun Map<String, Int>.plusDelta(d: Map<String, Int>): Map<String, Int> {
    val out = HashMap(this)
    for ((pid, amount) in d) {
        val sum = (out[pid] ?: 0) + amount
        if (sum == 0) out.remove(pid) else out[pid] = sum
    }
    return out
}

/** One seat's cash just moved by [amount]; [id] tells two moves on the same seat apart. */
data class MoneyDelta(val amount: Int, val id: Long)

/** Countries that just became somebody's whole set. [seq] makes each completion a new value. */
data class SetFlash(val groups: List<String>, val seq: Int)

/** The kick-off headline, and the country whose flag goes beside it. */
data class TableHeadline(val text: String, val group: String?)

/** One way out of the red — see [GameStore.raiseOptions]. */
data class RaiseOption(
    val id: String,
    val tile: Int,
    /** What it brings in: half the house cost, or half the price. */
    val amount: Int,
    /** "Sell the hotel on Kyoto", "Sell a house on Osaka", "Mortgage Nara". */
    val label: String,
    val kind: Kind,
) {
    enum class Kind { SELL, MORTGAGE }
}

/**
 * How far a deal being written leans, and what evening it out would take —
 * see [GameStore.tradeBalance]. `gap` is from the proposer's side: above zero
 * they get the better end and would be the one to put cash in, below zero the
 * other side would. `room` is how much of it the paying wallet can cover. A
 * deal that can't be paid isn't a fair one, so a short side stays visibly
 * short rather than promising cash it does not have.
 */
data class TradeBalance(val gap: Int, val room: Int) {
    val needed: Int get() = kotlin.math.abs(gap)

    /** Worth a line under the meter at all. Closer than $25 is an even trade. */
    val worthSaying: Boolean get() = needed >= 25

    /** The proposer is the side that would pay. */
    val proposerPays: Boolean get() = gap > 0

    /** "Balance it" is only offered when the paying side has cash to put in. */
    val canBalance: Boolean get() = room > 0 && gap != 0

    /** What "Balance it" adds to the paying side's cash: all of the gap, or as much as that wallet holds. */
    val topUp: Int get() = minOf(needed, room)

    /** The line beside the button. It names who pays — "your side" read as "in your favour". */
    val line: String
        get() = when {
            room == 0 ->
                if (proposerPays) "You have no cash left to even this out."
                else "They have no cash left to even this out."
            room >= needed ->
                if (proposerPays) "You'd put in ${money(needed)} to make it even"
                else "They'd put in ${money(needed)} to make it even"
            else -> "Only ${money(room)} spare — this gets as close as it can"
        }
}
