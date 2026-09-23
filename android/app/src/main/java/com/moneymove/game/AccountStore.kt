package com.moneymove.game

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer

/**
 * The half of the app that is not a table: who this device is, what it owns,
 * who it knows, and how it has done.
 *
 * Kept apart from [GameStore] on purpose. A table is a socket that pushes
 * thirty times a minute; this is a handful of REST answers that change when
 * somebody taps something. Putting them in one object would mean every push
 * of a board re-rendering a shop.
 */
class AccountStore(app: Application) : AndroidViewModel(app) {

    private val prefs = Prefs(app)
    private val api get() = Api(prefs.server, prefs.token)

    var me: MeView? by mutableStateOf(null)
        private set
    var wallet: Wallet? by mutableStateOf(null)
        private set
    var store: StoreView? by mutableStateOf(null)
        private set
    var leaderboard: List<LeaderRow> by mutableStateOf(emptyList())
        private set
    var social: SocialView? by mutableStateOf(null)
        private set
    var daily: DailyView? by mutableStateOf(null)
        private set
    var achievements: Achievements? by mutableStateOf(null)
        private set
    var boards: BoardsView? by mutableStateOf(null)
        private set

    var auth: AuthConfig? by mutableStateOf(null)
        private set
    var ads: AdsConfig? by mutableStateOf(null)
        private set

    /** An ad is on screen. Nothing else may offer one while it is. */
    var adPlaying: String? by mutableStateOf(null)
        private set

    /**
     * Set while an ad should actually be showing.
     *
     * The screen watches this, draws the ad, and completes it with whether it
     * played. Doing it this way round is the whole point: the offer has to be
     * asked for BEFORE the ad, or the claim arrives milliseconds after the
     * ticket was cut and the server — rightly — refuses a view nobody could
     * have watched. Which is exactly what happened the first time.
     */
    var adRequest: kotlinx.coroutines.CompletableDeferred<Boolean>? by mutableStateOf(null)
        private set

    /** The last thing that went wrong, for the one line a screen shows. */
    var notice: String? by mutableStateOf(null)

    /** Signing in is in flight — the button says so rather than doing nothing. */
    var signingIn: Boolean by mutableStateOf(false)
        private set

    val coins: Int get() = wallet?.coins ?: me?.coins ?: 0

    /** Everything a fresh launch, or a pull-to-refresh, wants. */
    fun refresh() {
        if (auth == null) loadPublic("/api/auth/config", AuthConfig.serializer()) { auth = it }
        load("/api/me", MeView.serializer()) { me = it }
        load("/api/wallet", Wallet.serializer()) { wallet = it }
        load("/api/daily", DailyView.serializer()) { daily = it }
        // The shelf is not a shop thing. Which boards may be dealt is the
        // first question the lobby asks, and a player who taps Play and never
        // opens the Store used to arrive at a table with no answer to it.
        loadBoards(boardsRoom)
        // Platform matters: the owner can have ads on for phones and off in a
        // browser, and this client has to ask as the platform it actually is.
        viewModelScope.launch {
            val body = api.get("/api/ads/config", mapOf("platform" to "android")) ?: return@launch
            runCatching { MMJson.decodeFromString(AdsConfig.serializer(), body) }.getOrNull()
                ?.let { ads = it }
        }
    }

    fun refreshStore() {
        if (store == null) loadPublic("/api/store", StoreView.serializer()) { store = it }
        load("/api/wallet", Wallet.serializer()) { wallet = it }
        loadBoards(boardsRoom)
        rolloverIfDue()
    }

    /**
     * The social half — and the two things the chat quietly depends on.
     *
     * `onBlocked` carries the blocked list to GameStore, which is the only
     * place the chat's drop-a-blocked-line filter reads. Nothing populated it
     * before, so that filter was a no-op that looked exactly like a working
     * one. `myCode` is the other: without it a player's own lines are offered
     * a Report button pointed at themselves.
     */
    fun refreshSocial(onBlocked: (Set<String>) -> Unit = {}, onMyCode: (String) -> Unit = {}) {
        load("/api/social", SocialView.serializer()) {
            social = it
            onBlocked(it.blocked.toSet())
        }
        load("/api/me", MeView.serializer()) {
            me = it
            if (it.code.isNotBlank()) onMyCode(it.code)
        }
        loadPublic("/api/leaderboard", LeaderboardView.serializer()) { leaderboard = it.top }
    }

    fun refreshHistory() {
        load("/api/achievements", Achievements.serializer()) { achievements = it }
        loadPublic("/api/leaderboard", LeaderboardView.serializer()) { leaderboard = it.top }
    }

    // ── the board shelf ────────────────────────────────────────────────────
    //
    // One loader for the whole app, the way iOS keeps one BoardShelf. The
    // lobby and the shop want the same answer, the answer moves once a day,
    // and it costs a round trip — so it is fetched, kept, and re-fetched only
    // when the wallet moves or the clock rolls over.

    /**
     * Which table the kept shelf was asked about.
     *
     * A pass is good at exactly one table, so the same wallet gets a different
     * answer in a different lobby: a rented board only reads as playable when
     * the server is told which table is asking. An answer fetched with no
     * table in hand must therefore never be handed to a lobby as though it
     * knew about this one.
     */
    private var boardsRoom: String? = null

    /**
     * The table the fetch in the air is asking about, or null when none is.
     *
     * Not a bare "a fetch is in flight" flag, and the difference is the whole
     * reason it holds a room. Opening a lobby asks twice in one frame — the
     * sheet warms the shop, the board row asks about this table — and a flag
     * swallowed the second of those, so the lobby spent its whole life holding
     * a shelf fetched with no table in it. A shelf with no table in it cannot
     * know about a rented board, which is the one thing the room is for.
     */
    private var boardsAsking: String? = null

    /**
     * Which question the answer being waited on came from.
     *
     * Two can be in the air at once — the lobby's, and a forced reload the
     * clock just asked for — and they can land in either order. Only the
     * newest one may be kept, or a slow reply about a table nobody is at any
     * more settles on top of a fresh one.
     */
    private var boardsAsk = 0

    /**
     * The shelf, as this wallet sees it at this table.
     *
     * Cache-first: the same room asked twice is free. `force` is somebody
     * asking for the truth — after a purchase, or after midnight — and it is
     * deliberately not swallowed by an ordinary poll already in flight, or a
     * board someone just bought stays drawn as locked until the app restarts.
     */
    fun loadBoards(room: String? = null, force: Boolean = false) {
        val at = room.orEmpty()
        if (boards != null && !force && boardsRoom == at) return
        // The same question, already asked and not yet answered. A different
        // table is a different question and is never dropped.
        if (boardsAsking == at && !force) return
        boardsAsking = at
        val ask = ++boardsAsk
        viewModelScope.launch {
            try {
                val asking = if (at.isBlank()) emptyMap() else mapOf("room" to at)
                val body = api.get("/api/boards", asking) ?: return@launch
                val fresh = runCatching { MMJson.decodeFromString(BoardsView.serializer(), body) }
                    .getOrNull() ?: return@launch
                if (ask != boardsAsk) return@launch
                boards = fresh
                boardsRoom = at
            } finally {
                if (ask == boardsAsk) boardsAsking = null
            }
        }
    }

    /**
     * Midnight came round while somebody was looking at it.
     *
     * `until` is the server's own midnight and the server is the only honest
     * clock in the building — but reading a number the server sent against
     * this phone's clock is the one comparison a client may safely make, and
     * it is how the free pair changes under an app nobody closed.
     *
     * It asks about whatever table is in question right now rather than the
     * one yesterday's answer came from: a lobby that opens a second before
     * midnight would otherwise have its own question overtaken by a forced
     * reload about nowhere.
     */
    fun rolloverIfDue() {
        val until = boards?.until ?: return
        if (until > 0 && System.currentTimeMillis() >= until) {
            loadBoards(boardsAsking ?: boardsRoom, force = true)
        }
    }

    fun board(id: String): BoardListing? = boards?.boards?.firstOrNull { it.id == id }

    /**
     * The three the lobby shows: both boards the day is giving away, then the
     * one this table is actually on — falling back to the house board so the
     * row never repeats itself and never comes up short.
     */
    fun trio(current: String): List<BoardListing> {
        val feed = boards ?: return emptyList()
        val out = mutableListOf<BoardListing>()
        fun add(id: String) {
            val b = board(id) ?: return
            if (out.none { it.id == b.id }) out += b
        }
        feed.free.forEach(::add)
        add(current)
        add(feed.house)
        return out.take(3)
    }

    /**
     * Buying a board outright, where it was found.
     *
     * Not [buy]: that one wears what it just bought, and a board is not worn —
     * it is dealt, by whoever is hosting. `expect` is the price-agreement the
     * shop keeps both ends of; a client showing yesterday's number is refused
     * with today's rather than quietly charged it.
     *
     * Either way the shelf is re-fetched. A refusal means the numbers on
     * screen are no longer to be trusted, which is the whole reason it was
     * refused.
     *
     * `quiet` is for the screens that say the refusal themselves. [notice] is
     * drawn only under the Store, Settings and Social tabs, nothing clears it
     * but the next thing to go wrong, and nothing at the table draws it at
     * all — so "Only the host picks the board", read and understood in the
     * lobby sheet where the shop already prints it, would surface again in
     * red under a Settings button an hour later.
     */
    fun buyBoard(
        board: BoardListing,
        quiet: Boolean = false,
        onDone: (String?) -> Unit = {},
    ) = viewModelScope.launch {
        val reply = api.postOrError(
            "/api/store/buy",
            mapOf("itemId" to board.storeId, "expect" to board.price),
        )
        val error = reply.refusal(reply.said())
        if (error == null) load("/api/wallet", Wallet.serializer()) { wallet = it }
        loadBoards(boardsRoom, force = true)
        if (!quiet) notice = error
        onDone(error)
    }

    /**
     * One coin, one game, on a board nobody here owns.
     *
     * The table is named because that is what makes the pass readable: it is
     * good at one table, and only the host's wallet is ever asked. The server
     * either sells a game or moves an unplayed one here for nothing, and says
     * which by what it charged — so [onDone] carries that rather than making
     * the screen guess.
     *
     * `quiet` means the same here as it does in [buyBoard]: the only caller
     * is the shop, which prints the refusal in the body of the sheet the tap
     * happened in, and a second copy parked in [notice] would only reappear
     * somewhere else later.
     */
    fun rentBoard(
        mapId: String,
        roomId: String,
        quiet: Boolean = false,
        onDone: (String?, Int) -> Unit = { _, _ -> },
    ) = viewModelScope.launch {
        val reply = api.postOrError(
            "/api/boards/rent",
            mapOf("mapId" to mapId, "roomId" to roomId, "expect" to (boards?.rent?.price ?: 1)),
        )
        val said = reply.said()
        val error = reply.refusal(said)
        if (error == null) load("/api/wallet", Wallet.serializer()) { wallet = it }
        loadBoards(roomId, force = true)
        if (!quiet) notice = error
        onDone(error, said?.get("charged").asInt() ?: 0)
    }

    /**
     * What the server actually said, or nothing if it did not answer at all.
     *
     * Every refusal on this side of the app carries its reason in the body,
     * which is why these read [Api.postOrError] and not the plain post — that
     * one throws the body away and hands back the same null a dead tunnel
     * does, and read that way "Not enough coins" looks exactly like a purchase
     * that worked. That bug has been fixed here once already.
     */
    private fun Api.Reply.said(): kotlinx.serialization.json.JsonObject? =
        body?.let { runCatching { MMJson.parseToJsonElement(it) }.getOrNull() }?.obj()

    private fun Api.Reply.refusal(said: kotlinx.serialization.json.JsonObject?): String? = when {
        ok -> null
        offline -> "That didn't go through, and nothing has changed. Try again."
        else -> said?.get("error").asString()
            ?: "That didn't go through, and nothing has changed. Try again."
    }

    // ── the things a tap does ──────────────────────────────────────────────

    fun claimDaily(onDone: (Boolean) -> Unit = {}) = viewModelScope.launch {
        val body = api.post("/api/daily/claim")
        // A 409 is an eager client, not a broken one: the card just catches up.
        val ok = body != null
        load("/api/wallet", Wallet.serializer()) { wallet = it }
        load("/api/daily", DailyView.serializer()) { daily = it }
        onDone(ok)
    }

    fun buy(item: StoreItem, onDone: (String?) -> Unit = {}) = viewModelScope.launch {
        // `itemId`, not `id`. The server reads req.body.itemId and answers
        // "Unknown item" to anything else — which is what it had been doing.
        val reply = api.postOrError(
            "/api/store/buy",
            mapOf("itemId" to item.id, "expect" to item.price),
        )
        val error = reply.refusal(reply.said())
        if (error == null) {
            load("/api/wallet", Wallet.serializer()) { wallet = it }
            // Wearing what you just bought is what buying it meant.
            equip(item)
        }
        notice = error
        onDone(error)
    }

    fun equip(item: StoreItem) = viewModelScope.launch {
        // `slot` and `itemId` are the names equipItem() reads.
        api.post("/api/store/equip", mapOf("slot" to item.kind, "itemId" to item.id))
        load("/api/wallet", Wallet.serializer()) { wallet = it }
        when (item.kind) {
            "token" -> prefs.tokenSkin = item.emoji
            "avatar" -> prefs.avatar = item.emoji
        }
    }

    /**
     * Signing in with Google.
     *
     * Two steps and both can fail differently: the phone may refuse to hand
     * over a token at all (no account, or this build's fingerprint is not
     * registered with the project yet), or the server may refuse the token.
     * They get different messages, because they need different fixes.
     */
    fun signInWithGoogle(context: android.content.Context, nickname: String) =
        viewModelScope.launch {
            val clientId = auth?.googleClientId
            if (clientId.isNullOrBlank()) {
                notice = "This server has Google sign-in switched off."
                return@launch
            }
            signingIn = true
            val token = GoogleSignIn.idToken(context, clientId)
            if (token.isFailure) {
                notice = "Google would not sign you in on this device. " +
                    "If this is a test build, its signing fingerprint has to be registered first."
                signingIn = false
                return@launch
            }
            val body = api.post("/api/auth/google", mapOf(
                "credential" to token.getOrNull(),
                "nickname" to nickname,
            ))
            val reply = body?.let { runCatching { MMJson.parseToJsonElement(it) }.getOrNull() }?.obj()
            val error = reply?.get("error").asString()
            notice = error
            if (error == null) {
                load("/api/me", MeView.serializer()) { me = it }
                load("/api/wallet", Wallet.serializer()) { wallet = it }
                load("/api/daily", DailyView.serializer()) { daily = it }
            }
            signingIn = false
        }

    fun signOut() = viewModelScope.launch {
        api.post("/api/auth/logout")
        load("/api/me", MeView.serializer()) { me = it }
        load("/api/daily", DailyView.serializer()) { daily = it }
    }

    /**
     * Watching an ad for coins.
     *
     * The offer comes first and can be refused — a cap already hit, ads
     * switched off since this screen was drawn — and a refusal is the
     * freshest count there is, so the button takes itself off the screen
     * rather than asking again.
     *
     * `show` is the ad itself, and it returns whether it actually played. The
     * house ad is a screen this app draws; a real network would be its SDK.
     * Either way the reward is only claimed if it says yes, and the server
     * still has the last word.
     */
    fun watchAd(
        slot: String,
        show: suspend () -> Boolean = ::showThroughUi,
        onDone: (String?) -> Unit = {},
    ) =
        viewModelScope.launch {
            if (adPlaying != null) return@launch
            adPlaying = slot
            try {
                val offerBody = api.post("/api/ads/offer", mapOf(
                    "placement" to slot, "platform" to "android",
                ))
                val offer = offerBody
                    ?.let { runCatching { MMJson.decodeFromString(AdOffer.serializer(), it) }.getOrNull() }
                if (offer == null || !offer.ok || offer.ticket.isBlank()) {
                    notice = offer?.error ?: "No ad available right now."
                    refresh()
                    onDone(notice)
                    return@launch
                }

                if (!show()) {
                    // Closed early. Nothing was promised, so nothing is owed.
                    onDone("The ad was closed before it finished.")
                    return@launch
                }

                val rewardBody = api.post("/api/ads/reward", mapOf(
                    "ticket" to offer.ticket, "platform" to "android",
                ))
                val reward = rewardBody
                    ?.let { runCatching { MMJson.decodeFromString(AdReward.serializer(), it) }.getOrNull() }
                notice = reward?.error
                load("/api/wallet", Wallet.serializer()) { wallet = it }
                refresh()
                onDone(reward?.error)
            } finally {
                adPlaying = null
            }
        }

    /**
     * The default way an ad is shown: hand the screen a gate and wait on it.
     * Whatever the screen draws — the house card today, a network's SDK
     * tomorrow — completes it with whether the ad actually played.
     */
    private suspend fun showThroughUi(): Boolean {
        val gate = kotlinx.coroutines.CompletableDeferred<Boolean>()
        adRequest = gate
        return try {
            gate.await()
        } finally {
            adRequest = null
        }
    }

    fun setName(name: String) = viewModelScope.launch {
        api.post("/api/profile", mapOf("name" to name))
        load("/api/me", MeView.serializer()) { me = it }
    }

    fun addFriend(code: String, onDone: (String?) -> Unit = {}) = viewModelScope.launch {
        val reply = api.postOrError("/api/friends", mapOf("code" to code.trim().uppercase()))
        val error = reply.refusal(reply.said())
        notice = error
        load("/api/social", SocialView.serializer()) { social = it }
        onDone(error)
    }

    fun answerFriend(code: String, accept: Boolean) = viewModelScope.launch {
        api.post(if (accept) "/api/friends/accept" else "/api/friends/decline", mapOf("code" to code))
        load("/api/social", SocialView.serializer()) { social = it }
    }

    fun removeFriend(code: String) = viewModelScope.launch {
        api.post("/api/friends/remove", mapOf("code" to code))
        load("/api/social", SocialView.serializer()) { social = it }
    }

    // ── plumbing ───────────────────────────────────────────────────────────

    private fun <T> load(path: String, serializer: KSerializer<T>, into: (T) -> Unit) =
        viewModelScope.launch {
            val body = api.get(path) ?: return@launch
            runCatching { MMJson.decodeFromString(serializer, body) }.getOrNull()?.let(into)
        }

    private fun <T> loadPublic(path: String, serializer: KSerializer<T>, into: (T) -> Unit) =
        viewModelScope.launch {
            val body = api.getPublic(path) ?: return@launch
            runCatching { MMJson.decodeFromString(serializer, body) }.getOrNull()?.let(into)
        }
}
