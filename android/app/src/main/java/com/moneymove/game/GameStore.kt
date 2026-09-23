package com.moneymove.game

import android.app.Application
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import org.json.JSONObject

/**
 * The one observable the whole app hangs off: identity, connection, the
 * latest server state, and every action a player can take.
 *
 * The server is authoritative. This store sends intents and renders whatever
 * comes back — exactly like the browser and the iOS app. Nothing here decides
 * a rule; the rules live in `server/game.js`, once, for all three clients.
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

    var nickname: String by mutableStateOf(prefs.nickname)
    var flag: String by mutableStateOf(prefs.flag)

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
    var joinError: String? by mutableStateOf(null)
        private set

    /** The drawn card, once the piece that drew it is standing on its tile. */
    var cardPopup: LastCard? by mutableStateOf(null)
    /** The deadlock rule, raised as a card the one time it is news. */
    var reliefPopup: ReliefCard? by mutableStateOf(null)
    var turnBanner: PlayerState? by mutableStateOf(null)
    var showGameOver: Boolean by mutableStateOf(false)

    /**
     * This device's seat was taken out by the clock — drives the full-screen
     * explainer. Cleared when the player chooses to stay and watch.
     */
    var timedOut: Boolean by mutableStateOf(false)

    /** Lines said since the chat was last looked at. */
    var unreadChat: Int by mutableStateOf(0)
        private set

    /**
     * Until when the board is still telling the story of the last action.
     *
     * The server resolves a whole roll before the first die has settled, so
     * the push that starts a walk already carries its consequences — a buy
     * prompt, sometimes a whole auction. Those wait behind this curtain, or a
     * player is asked to decide about a street their piece has not reached.
     */
    var holdUntil: Long by mutableStateOf(0L)
        private set

    enum class Connection { DISCONNECTED, CONNECTING, CONNECTED }

    data class Toast(val text: String, val isError: Boolean = false, val at: Long = System.currentTimeMillis())

    // ── plumbing ───────────────────────────────────────────────────────────

    private var socket: GameSocket? = null
    private val mirror = StateMirror()
    private var toastJob: Job? = null
    private var holdJob: Job? = null
    private var cardJob: Job? = null

    private var lastCardAt: Double = 0.0
    private var heldActionAt: Double = 0.0
    private var lastTurnId: String? = null
    private var heardChatId: String? = null
    private var chatPrimed = false

    val api: Api get() = Api(prefs.server, token)

    // ── derived, the handful every screen asks for ─────────────────────────

    val me: PlayerState? get() = state?.player(meId)
    val currentPlayer: PlayerState? get() = state?.let { it.player(it.turn?.playerId) }
    val isMyTurn: Boolean get() = state?.turn?.playerId == meId && state?.isPlaying == true
    val isHost: Boolean get() = state?.hostId == meId

    /** Whether the board is still mid-story, so decisions stay behind it. */
    val theatreLive: Boolean get() = holdUntil > System.currentTimeMillis()

    fun tile(i: Int): TileData? = state?.map?.tiles?.getOrNull(i)

    fun groupInfo(of: TileData): GroupInfo? = of.group?.let { state?.groups?.get(it) }

    // ── connection ─────────────────────────────────────────────────────────

    fun connect(room: String) {
        val id = room.lowercase().take(12)
        if (roomId == id && socket?.isConnected == true) return
        leave(quiet = true)
        roomId = id
        prefs.lastRoom = id
        mirror.forget()
        connection = Connection.CONNECTING

        val s = GameSocket(prefs.server)
        socket = s
        s.on("you") { d -> d?.get("playerId").asString()?.let { meId = it } }
        s.on("state") { d -> d?.let { mirror.adopt(it); decode(it) } }
        s.on("statePatch") { d ->
            // Only what moved. Rebuilt against the last state this socket was
            // sent, and handed on as if the server had spelled the whole
            // thing out — nothing downstream can tell the difference.
            if (d == null) return@on
            when (val step = mirror.apply(d)) {
                is StateMirror.Step.State -> decode(step.json)
                StateMirror.Step.Resync -> s.emit("resync")
            }
        }
        s.on("toast") { d ->
            if (d == null) return@on
            val msg = d["message"].asString() ?: return@on
            showToast(msg, d["type"].asString() == "error")
        }
        s.on("joinFailed") { d ->
            if (d == null) return@on
            val msg = d["message"].asString() ?: return@on
            // A table with no seat left still sends its state a beat later, so
            // the player lands on a board they cannot touch. Say out loud that
            // they are watching rather than leaving them to work it out.
            val spectating = (d["spectate"] as? kotlinx.serialization.json.JsonPrimitive)
                ?.content?.toBoolean() == true
            showToast(if (spectating) "$msg — you're watching this table" else msg, !spectating)
            joinError = if (spectating) null else msg
        }
        s.onConnect {
            connection = Connection.CONNECTED
            // A reconnect is a new socket as far as the server is concerned,
            // so whatever it remembered sending us died with the old one.
            mirror.forget()
            sendJoin()
        }
        s.onDisconnect { connection = Connection.DISCONNECTED }
        s.onFailure { Log.w(TAG, "socket: $it") }
        s.connect()
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
     * Asks the server for a table, and hands back its id.
     *
     * A throwaway socket with an acknowledgement, exactly as the browser does
     * it: the table does not exist until the server says so, and opening the
     * long-lived game socket before there is a room to join would only give it
     * somewhere to reconnect to that is not a table.
     *
     * Null means nothing answered — a sleeping free tier, or no network — and
     * the caller says so out loud rather than leaving a dead button.
     */
    suspend fun quickplay(): String? = askForRoom("quickplay")

    suspend fun createRoom(settings: Map<String, Any?> = emptyMap()): String? =
        askForRoom("createRoom", settings)

    private suspend fun askForRoom(event: String, payload: Map<String, Any?> = emptyMap()): String? =
        withTimeoutOrNull(12_000) {
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
                        finish(reply?.get("roomId").asString())
                    }
                }
                probe.onFailure { finish(null) }
                cont.invokeOnCancellation { probe.disconnect() }
                probe.connect()
            }
        }

    fun leave(quiet: Boolean = false) {
        socket?.disconnect()
        socket = null
        mirror.forget()
        holdJob?.cancel(); cardJob?.cancel()
        if (!quiet) {
            state = null
            roomId = null
            cardPopup = null
            reliefPopup = null
            showGameOver = false
            timedOut = false
            lastTurnId = null
            chatPrimed = false
            heardChatId = null
            lastCardAt = 0.0
            heldActionAt = 0.0
        }
        connection = Connection.DISCONNECTED
    }

    override fun onCleared() {
        super.onCleared()
        leave(quiet = true)
    }

    // ── state ──────────────────────────────────────────────────────────────

    private fun decode(json: JsonObject) {
        val next = runCatching { MMJson.decodeFromJsonElement(GameState.serializer(), json) }
            .getOrElse {
                Log.w(TAG, "state decode failed: ${it.message}")
                return
            }
        apply(next)
    }

    private fun apply(next: GameState) {
        val old = state
        state = next

        // The curtain: how long the board is still busy telling the story of
        // the action that just arrived. Decisions born of it wait behind this.
        val legs = next.moves.orEmpty()
        val newest = legs.lastOrNull()?.at
        if (newest != null && newest != heldActionAt) {
            heldActionAt = newest
            holdJob?.cancel()
            if (old != null && next.isPlaying) {
                val hasCard = next.lastCard?.let { kotlin.math.abs(it.at - newest) < 2500 } == true
                // Capped hard: the hold is cosmetic, and the shot clock runs
                // on the server whether or not the piece has finished walking.
                val run = minOf(Choreography.curtain(legs, next.map.size, hasCard) + 0.3, 4.0)
                holdUntil = System.currentTimeMillis() + (run * 1000).toLong()
                holdJob = viewModelScope.launch {
                    delay((run * 1000).toLong())
                    holdUntil = 0L
                }
            } else {
                holdUntil = 0L
            }
        }

        // A drawn card waits for the piece it belongs to. The board releases
        // it (BoardView calls revealCard as a leg lands); this is only the
        // floor under states with nothing to animate — a spectator opening the
        // table mid-action, or a reconnect.
        next.lastCard?.let { card ->
            if (card.at != lastCardAt) {
                lastCardAt = card.at
                cardJob?.cancel()
                if (old != null) {
                    val delayMs = Choreography
                        .timeline(legs, next.map.size, hasCard = true).cardAt ?: 0.0
                    cardJob = viewModelScope.launch {
                        delay(((delayMs + 0.35) * 1000).toLong())
                        revealCard()
                    }
                    pendingCard = card
                }
            }
        }

        // The deadlock rule explains itself the one time it becomes possible.
        // The server keeps the card in every push from then on, so the `at`
        // stamp — not its presence — is what makes it news, and the stamp is
        // remembered on disk so rejoining the same table does not re-teach it.
        next.reliefCard?.let { card ->
            if (card.at > prefs.reliefSeenAt) {
                prefs.reliefSeenAt = card.at
                if (old != null) reliefPopup = card
            }
        }

        // The turn banner, once per change of hands.
        next.turn?.playerId?.let { pid ->
            if (next.isPlaying && pid != lastTurnId) {
                lastTurnId = pid
                turnBanner = next.player(pid)
                // Only your own turn is worth a doorbell; everyone else's is
                // just the game going round.
                if (pid == meId && old != null) SoundKit.turn()
                viewModelScope.launch { delay(2200); if (turnBanner?.id == pid) turnBanner = null }
            }
        }

        // Unread chat: only lines that arrived after this device was looking.
        val lastChat = next.chat.lastOrNull()
        if (!chatPrimed) {
            chatPrimed = true
            heardChatId = lastChat?.id
        } else if (lastChat != null && lastChat.id != heardChatId) {
            val heard = heardChatId
            val fresh = if (heard == null) next.chat.size
            else next.chat.indexOfLast { it.id == heard }.let { if (it < 0) next.chat.size else next.chat.size - 1 - it }
            unreadChat += fresh
            heardChatId = lastChat.id
        }

        soundsFor(old, next)

        timedOut = next.player(meId)?.wasRemoved == true && next.player(meId)?.removedFor != "quit"
        if (next.isEnded && old?.isEnded != true) {
            if (next.winner?.id == meId) SoundKit.win()
            viewModelScope.launch { delay(700); showGameOver = true }
        }
    }

    /** The last log line this device has already sounded. */
    private var heardLogAt: Double = 0.0

    /**
     * Turns fresh log lines into sound.
     *
     * The log is the one feed that says what actually happened rather than
     * what the board now looks like, which is why the web client drives its
     * sounds from it too. Only lines newer than the last one heard play, so a
     * resync does not replay a whole turn's worth of noise at once.
     */
    private fun soundsFor(old: GameState?, next: GameState) {
        val fresh = next.log.filter { it.at > heardLogAt }
        heardLogAt = next.log.lastOrNull()?.at ?: heardLogAt
        // A first state is a position, not a journey: joining a game in
        // progress must not play the last sixty lines.
        if (old == null || fresh.isEmpty()) return

        val kinds = fresh.map { it.kind }.toSet()
        when {
            "bankrupt" in kinds -> SoundKit.bankrupt()
            "jail" in kinds -> SoundKit.jail()
            "auction" in kinds -> SoundKit.auction()
            "trade" in kinds -> SoundKit.trade()
            "build" in kinds -> SoundKit.build()
        }

        // Money is only news when it is YOUR money, and which way it went is
        // the whole difference between the two sounds.
        val mine = next.player(meId)?.money
        val before = old.player(meId)?.money
        if (mine != null && before != null && mine != before) {
            if (mine > before) SoundKit.gain() else SoundKit.lose()
        }

        // Somebody spoke. Not the lines this device sent itself.
        val said = next.chat.lastOrNull()
        if (said != null && said.id != old.chat.lastOrNull()?.id && said.name != nickname) {
            SoundKit.pop()
        }
    }

    private var pendingCard: LastCard? = null

    /**
     * Turns the held card over, once.
     *
     * Called by the board the moment the piece that drew it lands on the tile
     * that drew it, and by the floor timer above for the states where nothing
     * is animating. Idempotent on purpose: whichever gets there first wins and
     * the other is a no-op.
     */
    fun revealCard() {
        val card = pendingCard ?: return
        pendingCard = null
        if (state?.lastCard?.at != card.at) return
        cardPopup = card
        SoundKit.card()
        viewModelScope.launch {
            delay(3200)
            if (cardPopup?.at == card.at) cardPopup = null
        }
    }

    fun markChatRead() { unreadChat = 0 }

    fun showToast(text: String, isError: Boolean = false) {
        toast = Toast(text, isError)
        toastJob?.cancel()
        toastJob = viewModelScope.launch {
            delay(3000)
            toast = null
        }
    }

    // ── actions ────────────────────────────────────────────────────────────
    //
    // Every one of these is an intent, not a decision: the server answers with
    // a new state or a toast saying why not.

    private fun emit(event: String, vararg args: Any?) { socket?.emit(event, *args) }

    fun start() = emit("start")
    fun addBot() = emit("addBot")
    fun kick(playerId: String) = emit("kick", playerId)
    fun makeHost(playerId: String) = emit("makeHost", JSONObject(mapOf("id" to playerId)))
    fun updateSettings(patch: Map<String, Any?>) = emit("settings", JSONObject(patch))
    fun balanceTeams() = emit("balanceTeams")
    fun setTeam(team: Int, playerId: String? = null) =
        if (playerId != null) emit("team", team, playerId) else emit("team", team)

    fun setAppearance(name: String? = null, color: String? = null, flagCode: String? = null) {
        val d = mutableMapOf<String, Any?>()
        name?.let { d["name"] = it }
        color?.let { d["color"] = it }
        flagCode?.let { d["flag"] = it }
        emit("appearance", JSONObject(d))
    }

    fun roll() {
        SoundKit.dice()
        Haptics.tap()
        emit("roll")
    }
    fun buy() {
        SoundKit.buy()
        emit("buy")
    }
    fun skipBuy() = emit("skipBuy")
    fun endTurn() = emit("endTurn")
    fun bid(amount: Int) = emit("bid", amount)
    fun passBid() = emit("passBid")
    fun jailPay() = emit("jailPay")
    fun jailCard() = emit("jailCard")
    fun build(tile: Int) = emit("build", tile)

    /** Everything this street's country will take, in one press. */
    fun buildAll(tile: Int) {
        val group = tile(tile)?.group ?: return
        emit("buildAll", group)
    }
    fun sellHouse(tile: Int) = emit("sellHouse", tile)
    fun mortgage(tile: Int) = emit("mortgage", tile)
    fun unmortgage(tile: Int) = emit("unmortgage", tile)
    fun payDebt() = emit("payDebt")
    fun declareBankrupt() = emit("bankrupt")
    fun quitGame() = emit("quit")
    fun rematch() = emit("rematch")
    fun grantTime(playerId: String) = emit("grantTime", JSONObject(mapOf("id" to playerId)))
    fun sendChat(text: String, channel: String = "all") = emit("chat", text, channel)

    fun proposeTrade(to: String, give: TradeSide, get: TradeSide) = emit("trade:propose", JSONObject(mapOf(
        "to" to to,
        "give" to JSONObject(mapOf("money" to give.money, "tiles" to give.tiles, "cards" to give.cards)),
        "get" to JSONObject(mapOf("money" to get.money, "tiles" to get.tiles, "cards" to get.cards)),
    )))
    fun respondTrade(id: Int, accept: Boolean) =
        emit("trade:respond", JSONObject(mapOf("id" to id, "accept" to accept)))
    fun cancelTrade(id: Int) = emit("trade:cancel", JSONObject(mapOf("id" to id)))
    fun ignoreTrade(id: Int, ignored: Boolean = true) =
        emit("trade:ignore", JSONObject(mapOf("id" to id, "ignored" to ignored)))
    fun setTradeViewing(id: Int, viewing: Boolean) =
        emit("trade:viewing", JSONObject(mapOf("id" to id, "viewing" to viewing)))

    // ── rules the UI needs to ask about before it offers a button ──────────
    //
    // Mirrors of the server's own checks. The server still decides; these only
    // stop the app from offering a button that would come back refused.

    fun myTiles(): List<Int> = state?.ownership.orEmpty()
        .filter { it.value.owner == meId }
        .keys.mapNotNull { it.toIntOrNull() }
        .sorted()

    fun ownsFullGroup(playerId: String, group: String): Boolean {
        val s = state ?: return false
        val idxs = s.map.groups?.get(group) ?: return false
        return idxs.isNotEmpty() && idxs.all { s.owner(it)?.owner == playerId }
    }

    fun canBuild(i: Int): Boolean {
        val s = state ?: return false
        val t = tile(i) ?: return false
        val own = s.owner(i) ?: return false
        if (t.type != "property" || own.owner != meId || own.isMortgaged) return false
        val group = t.group ?: return false
        if (!ownsFullGroup(meId, group)) return false
        if (own.houseCount >= 5) return false
        if (s.settings.evenBuild == true) {
            val group_ = s.map.groups?.get(group).orEmpty()
            val lowest = group_.minOfOrNull { s.owner(it)?.houseCount ?: 0 } ?: 0
            if (own.houseCount > lowest) return false
        }
        return (me?.money ?: 0) >= (t.houseCost ?: 0)
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
        // Ownership, mortgages, whose turn it is: canBuild already says all of
        // it. If no street in the country may take a house, neither may this.
        if (idxs.size < 2 || idxs.none { canBuild(it) }) return 0

        val houses = idxs.associateWith { (s.owner(it)?.houseCount ?: 0) }.toMutableMap()
        var purse = me?.money ?: 0
        val even = s.settings.evenBuild == true
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
        if (own.owner != meId || own.houseCount <= 0) return false
        if (s.settings.evenBuild == true) {
            val group = tile(i)?.group ?: return true
            val idxs = s.map.groups?.get(group).orEmpty()
            val highest = idxs.maxOfOrNull { s.owner(it)?.houseCount ?: 0 } ?: 0
            if (own.houseCount < highest) return false
        }
        return true
    }

    fun canMortgage(i: Int): Boolean {
        val s = state ?: return false
        val own = s.owner(i) ?: return false
        if (own.owner != meId || own.isMortgaged) return false
        if (s.settings.mortgage == false) return false
        val group = tile(i)?.group
        // A street with buildings anywhere in its colour cannot be mortgaged.
        if (group != null) {
            val idxs = s.map.groups?.get(group).orEmpty()
            if (idxs.any { (s.owner(it)?.houseCount ?: 0) > 0 }) return false
        }
        return true
    }

    /**
     * The account is gone on the server; become somebody new on this device.
     *
     * Keeping the old token would quietly mint a fresh profile under it on the
     * very next request — the same identity the player just asked to delete.
     */
    fun startFresh() {
        prefs.putString("mm.token", "u_and_" + java.util.UUID.randomUUID().toString().replace("-", ""))
        token = prefs.token
        meId = token
        nickname = ""
        prefs.nickname = ""
        prefs.lastRoom = ""
        blockedCodes = emptySet()
        myCode = ""
    }

    private companion object {
        const val TAG = "MMStore"
    }
}
