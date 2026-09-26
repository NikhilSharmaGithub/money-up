package com.moneymove.game

import android.app.Application
import android.content.Context
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

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
    /**
     * The catalogue — and, from the second launch on, the last one seen, read
     * back at once, as iOS's PieceCatalog does from "mm.shelf": the lobby's
     * piece row has to be its full height from the first frame, and prices
     * and emoji change about as often as the app ships.
     */
    var store: StoreView? by mutableStateOf(cachedShelf())
        private set

    /**
     * The last catalogue fetch came back empty-handed with nothing cached —
     * the lobby's piece row reads it to offer a retry the moment it is true,
     * rather than after a guess at how long is too long.
     */
    var storeFailed: Boolean by mutableStateOf(false)
        private set

    /** Asked and answered this run; one fetch serves every lobby, as on iOS. */
    private var shelfFetched = false
    private var shelfJob: kotlinx.coroutines.Job? = null
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
    /** What the break on screen is worth — the house ad's claim button says it. */
    var adRequestCoins: Int by mutableStateOf(0)
        private set

    /** The last thing that went wrong, for the one line a screen shows. */
    var notice: String? by mutableStateOf(null)

    /** Signing in is in flight — the button says so rather than doing nothing. */
    var signingIn: Boolean by mutableStateOf(false)
        private set

    /**
     * An account deletion is in flight. The row that started it disables
     * itself on this, because the one thing worse than deleting an account
     * by accident is sending the request twice and reading the second
     * answer — about an identity that no longer exists — as a failure.
     */
    var deleting: Boolean by mutableStateOf(false)
        private set

    /**
     * Friends already asked to a table, as "CODE|room".
     *
     * Kept here rather than in the row that sent it so the button stays
     * "Invited" when the list re-renders under a poll, and keyed on the room
     * so sitting down somewhere else makes them invitable again.
     */
    private var invited: Set<String> by mutableStateOf(emptySet())

    val coins: Int get() = wallet?.coins ?: me?.coins ?: 0

    /**
     * This player's friend code — the server's word for it once there is a
     * profile, and the same hash worked out here until then, so the screen
     * never shows a blank where a code belongs.
     *
     * [refreshSocial] is what makes the second case rare. meView answers a
     * token with no profile behind it with an empty code, and a code with no
     * profile behind it is one nobody can add: the server has never heard of
     * it. iOS mints the profile the moment Friends opens, and so does this.
     */
    val myFriendCode: String
        get() = me?.code?.takeIf { it.isNotBlank() } ?: friendCode(prefs.token)

    /**
     * The code as POST /api/profile answered it — the only one iOS shows. Its
     * friend screens print "······" and hold Copy and Share shut until that
     * answer has come back, and Settings says nothing about a code before
     * then; a code worked out on the phone can belong to a profile the server
     * has never heard of, which nobody could add.
     */
    var confirmedCode: String by mutableStateOf("")
        private set

    /**
     * What Share sends, word for word what iOS and the browser send, so the
     * same message arrives in somebody's chat whichever phone it came from.
     */
    val friendCodeShareText: String
        get() = "Add me on MoneyMove — my friend code is $myFriendCode. ${Prefs.SITE}"

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

    /**
     * The purse as a successful /api/store/buy reply states it — iOS writes
     * `reply.coins` into its wallet the moment the buy lands, rather than
     * after the equip and a wallet refetch, two round trips on a server that
     * may be waking up. The next wallet read takes over as usual.
     */
    fun noteBuyReply(body: String?) {
        val coins = body
            ?.let { runCatching { MMJson.parseToJsonElement(it) }.getOrNull() }
            .obj()?.get("coins").asInt() ?: return
        wallet = wallet?.copy(coins = coins)
    }

    fun refreshStore() {
        if (!shelfFetched) fetchShelf()
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
    fun refreshSocial(onBlocked: (Set<String>) -> Unit = {}, onMyCode: (String) -> Unit = {}) =
        viewModelScope.launch {
            // The profile first, and waited on. A player who has never sat at
            // a table has no profile yet, so the code this screen hands out
            // would be one the server cannot find — "No player with that
            // code" to the friend who types it in. iOS posts the profile the
            // moment Friends opens for exactly this reason, and the flag rides
            // along so the server's copy of it is never older than this one.
            postProfile(prefs.nickname, prefs.flag)?.let(onMyCode)
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

    /**
     * Keeps the friends list live for as long as the caller is — a friend
     * who sits down at a table should turn up joinable without anybody
     * pulling to refresh. Eight seconds, as on iOS.
     *
     * It runs in the caller's coroutine and never returns, so a screen's
     * LaunchedEffect is both its start and its stop. Only the list is asked
     * for; the profile, the leaderboard and the rest do not move on that
     * clock. A poll that fails keeps what is on screen, because blanking a
     * list on a blip tells somebody their friends are gone.
     */
    suspend fun watchSocial(onBlocked: (Set<String>) -> Unit = {}) {
        while (true) {
            delay(SOCIAL_POLL_MS)
            fetch("/api/social", SocialView.serializer())?.let {
                social = it
                onBlocked(it.blocked.toSet())
            }
        }
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

    /**
     * POST /api/daily/claim, answered the way iOS reads it. [onDone] is handed
     * what landed on success; on a refusal, the server's own sentence — a
     * sign-in or rate-limit refusal is shown in its words; and both null when
     * the day was already claimed, which is an eager client rather than a
     * broken one, so the card simply catches up and says nothing. Only a
     * request nothing answered is "Couldn't reach the server".
     */
    fun claimDaily(onDone: (paid: Int?, error: String?) -> Unit = { _, _ -> }) = viewModelScope.launch {
        val reply = api.postOrError("/api/daily/claim")
        val said = reply.said()
        val refused = said?.get("error").asString()
        val already = (said?.get("claimed") as? JsonPrimitive)?.booleanOrNull == true
        load("/api/wallet", Wallet.serializer()) { wallet = it }
        load("/api/daily", DailyView.serializer()) { daily = it }
        when {
            reply.offline || said == null -> onDone(null, "Couldn't reach the server — try again.")
            refused != null && already -> onDone(null, null)
            refused != null -> onDone(null, refused)
            !reply.ok -> onDone(null, "Couldn't reach the server — try again.")
            else -> onDone(said?.get("amount").asInt() ?: 0, null)
        }
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
     * over a token at all, or the server may refuse the token. They get
     * different sentences — iOS's two, word for word — because they need
     * different fixes. The detail of a device refusal (usually a build whose
     * signing fingerprint is not registered yet) goes to the log from
     * GoogleSignIn, which is where the person who can fix it will look.
     *
     * Closing Google's own sheet is an answer, not an error, and says
     * nothing — exactly as on iOS.
     *
     * [onDone] carries the play name the server settled on. iOS takes it as
     * the device's nickname, and so should the caller: this store does not
     * own the nickname, GameStore does. `quiet` is for a screen that says the
     * outcome itself, as it is on [buyBoard].
     */
    fun signInWithGoogle(
        context: Context,
        nickname: String,
        quiet: Boolean = false,
        onDone: (SignInOutcome) -> Unit = {},
    ) = viewModelScope.launch {
        fun refused(why: String) {
            if (!quiet) notice = why
            onDone(SignInOutcome(signedIn = false, error = why))
        }
        val clientId = auth?.googleClientId
        if (clientId.isNullOrBlank()) {
            refused("This server has Google sign-in switched off.")
            return@launch
        }
        signingIn = true
        try {
            val token = GoogleSignIn.idToken(context, clientId)
            if (token.isFailure) {
                if (token.exceptionOrNull() is GetCredentialCancellationException) {
                    onDone(SignInOutcome(signedIn = false))
                } else {
                    refused("Google sign-in did not complete")
                }
                return@launch
            }
            val reply = api.postOrError("/api/auth/google", mapOf(
                "credential" to token.getOrNull(),
                "nickname" to nickname,
            ))
            val said = reply.said()
            if (!reply.ok || said?.get("ok").asBool() != true) {
                refused("The server could not verify the sign-in")
                return@launch
            }
            if (!quiet) notice = null
            load("/api/me", MeView.serializer()) { me = it }
            load("/api/wallet", Wallet.serializer()) { wallet = it }
            load("/api/daily", DailyView.serializer()) { daily = it }
            onDone(SignInOutcome(
                signedIn = true,
                name = said?.get("name").asString()?.takeIf { it.isNotBlank() },
            ))
        } finally {
            signingIn = false
        }
    }

    /**
     * Signing out: the link to Google goes, the device identity, the wallet
     * and the friends all stay.
     *
     * A sign-out the server never heard changed nothing there, so on failure
     * [me] is left exactly as it was — re-reading it offline would blank the
     * card and look precisely like a sign-out that worked. [onDone] carries
     * iOS's sentence for that case, and null when it went.
     */
    fun signOut(onDone: (String?) -> Unit = {}) = viewModelScope.launch {
        val reply = api.postOrError("/api/auth/logout")
        if (!reply.ok) {
            onDone("Couldn't sign out — check your connection and try again.")
            return@launch
        }
        load("/api/me", MeView.serializer()) { me = it }
        load("/api/daily", DailyView.serializer()) { daily = it }
        onDone(null)
    }

    /**
     * Watching an ad for coins — offer, ad, reward, and the only route a coin
     * takes from a view into a wallet.
     *
     * The offer comes first and can be refused — a cap already hit, ads
     * switched off since this screen was drawn — and a refusal is the
     * freshest count there is, so the button takes itself off the screen
     * rather than asking again. It is read through postOrError, because every
     * refusal arrives with a non-2xx status and its reason in the body, and
     * the plain post hands both back as the same null a dead tunnel does.
     *
     * What plays in between is the gateway's choice, not this store's. When
     * the offer says `provider: admob` Google's ad goes up first, for the unit
     * the offer names; every other answer, and every way Google can fail to
     * fill the slot, ends at `show` — the house ad, which says whether it was
     * watched to the end. Closing either one early is always allowed and
     * never pays. [onDone] is null when coins moved, the closed-early
     * sentence PlayTab matches word for word, or the reason it didn't.
     */
    fun watchAd(
        slot: String,
        show: suspend (Int) -> Boolean = ::showThroughUi,
        onDone: (error: String?, paid: Int) -> Unit = { _, _ -> },
    ) =
        viewModelScope.launch {
            if (adPlaying != null) return@launch
            adPlaying = slot
            try {
                val asked = api.postOrError("/api/ads/offer", mapOf(
                    "placement" to slot, "platform" to "android",
                ))
                val offer = asked.body
                    ?.let { runCatching { MMJson.decodeFromString(AdOffer.serializer(), it) }.getOrNull() }
                offer?.let { note(it.remaining) }
                if (!asked.ok || offer == null || !offer.ok || offer.ticket.isBlank()) {
                    val error = offer?.error
                    notice = when {
                        asked.offline -> "Couldn't reach the server — try again."
                        error != null -> adRefusal(error, offer?.retryInSec)
                        // iOS's words for an offer that came back without a
                        // ticket: the break was asked for and simply did not
                        // happen, which is not the same as there being none.
                        else -> "That did not go through — try again."
                    }
                    refresh()
                    onDone(notice, 0)
                    return@launch
                }
                // What this break is being watched for — the figure the house
                // ad's claim button names. Only the server knows it.
                val worth = offer.reward.coins.takeIf { it > 0 }
                    ?: ads?.placement(slot)?.coins ?: 0

                // Google first, but only when the gateway itself said Google.
                // The server already falls back to the house adapter the
                // moment AdMob can't serve, so `provider` is the one answer
                // both halves obey.
                val network = if (offer.provider == "admob") {
                    AdMobNetwork.showRewarded(
                        getApplication<Application>(),
                        unitId = offer.unitId,
                        customData = offer.customData,
                        userId = offer.userId,
                        serverAppId = offer.appId,
                    )
                } else {
                    NetworkAdOutcome.UNAVAILABLE
                }

                val watched = when (network) {
                    NetworkAdOutcome.EARNED -> true
                    // A real ad, walked out of: the same answer as walking out
                    // of a house one, for the same reason.
                    NetworkAdOutcome.DISMISSED -> false
                    // No fill, a load that never landed, an id nobody has
                    // pasted in yet. The player was promised a break, so the
                    // house serves it and the ticket goes back exactly as it
                    // would have — the ticket is the only thing that
                    // authorises a coin, and while the desk has AdMob live the
                    // gateway wants Google's own callback before it pays. If
                    // it refuses, the refusal is shown in its own words.
                    NetworkAdOutcome.UNAVAILABLE -> show(worth)
                }
                if (!watched) {
                    // Closed early. Nothing was promised, so nothing is owed.
                    onDone("The ad was closed before it finished.", 0)
                    return@launch
                }

                val (claimed, reward) = redeem(offer.ticket)
                reward?.let { note(it.remaining) }
                val error = when {
                    claimed.offline || reward == null -> "Couldn't reach the server — try again."
                    claimed.ok && reward.error == null -> null
                    else -> adRefusal(reward.error ?: "That did not go through — try again.", reward.retryInSec)
                }
                notice = error
                load("/api/wallet", Wallet.serializer()) { wallet = it }
                refresh()
                // The server is the authority on the size of the payout: a
                // claim that disagrees with the offer's figure pays what the
                // claim says, and the thank-you names that.
                onDone(error, reward?.awarded?.takeIf { it > 0 } ?: worth)
            } finally {
                adPlaying = null
            }
        }

    /**
     * Redeems one ticket, and waits out a provider that hasn't finished
     * speaking yet.
     *
     * On AdMob a coin needs two things to arrive: this claim, and Google's own
     * server-side callback confirming the view. They travel separately and the
     * phone usually wins; the gateway holds the claim at the door for a few
     * seconds because of it, but a few seconds is a guess about somebody
     * else's infrastructure. So `pending` is not an answer — the ticket
     * survives it, and the same claim is made again until it is honoured or
     * the budget runs out. Every other refusal is final.
     *
     * Short on purpose, iOS's fifteen seconds: long enough for a late
     * callback, short enough to survive an SSV URL mistyped into the AdMob
     * console, which is a callback that is never coming.
     */
    private suspend fun redeem(ticket: String): Pair<Api.Reply, AdReward?> {
        val deadline = SystemClock.elapsedRealtime() + CLAIM_PATIENCE_MS
        while (true) {
            val reply = api.postOrError("/api/ads/reward", mapOf(
                "ticket" to ticket, "platform" to "android",
            ))
            val claim = reply.body
                ?.let { runCatching { MMJson.decodeFromString(AdReward.serializer(), it) }.getOrNull() }
            if (claim?.pending != true || SystemClock.elapsedRealtime() >= deadline) return reply to claim
            delay(((claim.retryInSec ?: 2.0).coerceIn(1.0, 4.0) * 1000).toLong())
        }
    }

    /** A fresh `remaining` from an offer or a claim, straight onto the buttons. */
    private fun note(fresh: Map<String, Int>) {
        ads = ads?.noting(fresh)
    }

    /**
     * The house ad: hand the screen a gate and wait on it. Whatever the screen
     * draws completes it with whether the break was watched to the end. It is
     * the fallback, not the plan — when the gateway says AdMob, Google's ad
     * has already had its turn by the time this is asked.
     */
    private suspend fun showThroughUi(coins: Int): Boolean {
        val gate = kotlinx.coroutines.CompletableDeferred<Boolean>()
        adRequestCoins = coins
        adRequest = gate
        return try {
            gate.await()
        } finally {
            adRequest = null
        }
    }

    // ── the profile ────────────────────────────────────────────────────────

    /**
     * The name and the flag, as the server should hold them.
     *
     * The flag is the half that matters away from a table. The server
     * otherwise only learns it at join time, so a player who picks a country
     * and opens the cup card before sitting down anywhere would read the
     * prize in dollars — the conversion keys off the flag on the profile,
     * not the one on the phone. Both default to what this device remembers,
     * which is where GameStore writes them.
     *
     * [onDone] is told the refusal, or null. The server trims a name to
     * sixteen characters and masks anything the chat filter would, so the
     * name it hands back is the one worth showing — it lands on [me].
     */
    fun saveProfile(
        name: String = prefs.nickname,
        flag: String = prefs.flag,
        onDone: (String?) -> Unit = {},
    ) = viewModelScope.launch {
        val reply = api.postOrError("/api/profile", mapOf("name" to name, "flag" to flag))
        val said = reply.said()
        val error = reply.refusal(said)
        if (error == null) {
            adopt(said)
            said?.get("code").asString()?.takeIf { it.isNotBlank() }?.let { confirmedCode = it }
        }
        onDone(error)
    }

    fun setName(name: String) = saveProfile(name = name)

    /** POST /api/profile, waited on; the code it answers with, or null. */
    private suspend fun postProfile(name: String, flag: String): String? {
        val reply = api.postOrError("/api/profile", mapOf("name" to name, "flag" to flag))
        if (!reply.ok) return null
        val said = reply.said()
        adopt(said)
        return said?.get("code").asString()?.takeIf { it.isNotBlank() }?.also { confirmedCode = it }
    }

    /**
     * What /api/profile answered — `{ code, name, flag }` — folded into [me].
     *
     * Only into one that has already loaded. Minting a MeView from three
     * fields would say "not signed in, no coins" about somebody who is both
     * until /api/me lands, and the account card would flash the wrong state.
     */
    private fun adopt(said: kotlinx.serialization.json.JsonObject?) {
        val now = me ?: return
        me = now.copy(
            code = said?.get("code").asString()?.takeIf { it.isNotBlank() } ?: now.code,
            name = said?.get("name").asString() ?: now.name,
            flag = said?.get("flag").asString() ?: now.flag,
        )
    }

    // ── friends ────────────────────────────────────────────────────────────
    //
    // Every call here reads Api.postOrError, because a friends list is where
    // the server says no most often and most usefully — "Your friends list is
    // full", "You can only invite friends" — and the plain post would hand
    // each of those back as the same null a tunnel does. Only [addFriend]
    // writes to [notice], and only because the Social tab's add box has
    // always drawn it; everything else hands its answer to [onDone] and lets
    // the screen that asked say it, so a refusal read at the table does not
    // surface again under a Settings button an hour later.

    /**
     * Ask somebody to be friends by code. `quiet` keeps the refusal out of
     * [notice] for a screen that says it itself.
     *
     * The server answers an add as an acceptance when they had already asked
     * this player, so the list is re-read either way: the row lands under
     * Friends or under Asked, whichever is now true.
     */
    fun addFriend(code: String, quiet: Boolean = false, onDone: (String?) -> Unit = {}) =
        viewModelScope.launch {
            val reply = api.postOrError("/api/friends", mapOf("code" to code.trim().uppercase()))
            val error = reply.refusal(reply.said())
            if (!quiet) notice = error
            load("/api/social", SocialView.serializer()) { social = it }
            onDone(error)
        }

    /**
     * Yes or no to somebody who asked.
     *
     * No is also how a request this player SENT is taken back — the server
     * treats a decline on an outgoing ask as exactly that — which is what
     * [cancelRequest] is. The row goes the moment the server agrees rather
     * than the moment of the tap: taken off first and then refused, it would
     * come back a second later and read as a glitch.
     */
    fun answerFriend(code: String, accept: Boolean, onDone: (String?) -> Unit = {}) =
        viewModelScope.launch {
            val reply = api.postOrError(
                if (accept) "/api/friends/accept" else "/api/friends/decline",
                mapOf("code" to code),
            )
            val error = reply.refusal(reply.said())
            if (error == null) {
                social = social?.let { s ->
                    s.copy(
                        requests = s.requests.filterNot { it.code == code },
                        sent = s.sent.filterNot { it.code == code },
                    )
                }
            }
            load("/api/social", SocialView.serializer()) { social = it }
            onDone(error)
        }

    /** Take back a friend request this player sent — the Asked row's Cancel. */
    fun cancelRequest(code: String, onDone: (String?) -> Unit = {}) =
        answerFriend(code, accept = false, onDone = onDone)

    /**
     * Unfriend. Both people drop off each other's list, and nothing is sent
     * to say so — which is the point of it being quiet.
     */
    fun removeFriend(code: String, onDone: (String?) -> Unit = {}) = viewModelScope.launch {
        val reply = api.postOrError("/api/friends/remove", mapOf("code" to code))
        val error = reply.refusal(reply.said())
        if (error == null) {
            social = social?.let { s -> s.copy(friends = s.friends.filterNot { it.code == code }) }
        }
        load("/api/social", SocialView.serializer()) { social = it }
        onDone(error)
    }

    /**
     * Ask a friend to the table this device is sitting at.
     *
     * Friends only, and the server says so in its own words when it is not —
     * "You can only invite friends", "That player is gone", "No table to
     * invite them to" — which [onDone] carries through verbatim, falling back
     * to iOS's own line when nothing answered. The server keeps one invite
     * per player for five minutes and a newer one replaces it, so asking
     * twice is harmless; [wasInvited] is only there so the button can say it
     * went.
     */
    fun invite(friend: Friend, roomId: String, onDone: (String?) -> Unit = {}) =
        viewModelScope.launch {
            val room = roomId.lowercase()
            val reply = api.postOrError("/api/invite", mapOf("code" to friend.code, "roomId" to room))
            val error = if (reply.ok) null
            else reply.said()?.get("error").asString() ?: "Could not invite them"
            if (error == null) invited = invited + "${friend.code}|$room"
            onDone(error)
        }

    /** Whether [invite] has already asked this friend to this table. */
    fun wasInvited(code: String, roomId: String?): Boolean =
        roomId != null && "$code|${roomId.lowercase()}" in invited

    // ── safety ─────────────────────────────────────────────────────────────

    /**
     * A POST that hands back what the server SAID, for the safety sheets.
     *
     * Shaped to be SafetySheets' SafetyPost — `Safety(account::postForReason)`
     * — and the difference from the plain post is the whole reason it
     * exists: a refusal's body comes back too, so "You have sent a lot of
     * reports today" reaches the player instead of a sentence that has to
     * guess at the network. Null still means nothing answered — and also a
     * refusal that carries no reason, such as a proxy's error page, because
     * handing that on would parse as no error at all and read as success.
     */
    suspend fun postForReason(path: String, body: Map<String, Any?> = emptyMap()): String? {
        val reply = api.postOrError(path, body)
        if (reply.ok) return reply.body
        return reply.body?.takeIf { reply.said()?.get("error").asString() != null }
    }

    /**
     * A block the server has just confirmed, reflected in the lists.
     *
     * Blocking takes the friendship, the request and the ask with it on both
     * sides, so the person comes off every list here at once — before the
     * re-read lands — and the fresh blocked list goes to [onBlocked], which is
     * GameStore.applyBlocked, so the chat stops showing them on the same tap.
     */
    fun noteBlocked(code: String, onBlocked: (Set<String>) -> Unit = {}) {
        val gone = code.trim().uppercase()
        social = social?.let { s ->
            s.copy(
                friends = s.friends.filterNot { it.code == gone },
                requests = s.requests.filterNot { it.code == gone },
                sent = s.sent.filterNot { it.code == gone },
                blocked = (s.blocked + gone).distinct(),
            )
        }
        load("/api/social", SocialView.serializer()) {
            social = it
            onBlocked(it.blocked.toSet())
        }
    }

    // ── leaving ────────────────────────────────────────────────────────────

    /**
     * Delete this account on the server, then become somebody new here.
     *
     * POST /api/account/delete with the token and nothing else — the
     * `appleCode` iOS may add exists for Sign in with Apple, which this app
     * does not have. The server takes the player out of any table and any
     * cup still taking entries, then removes the profile, the wallet and
     * everything bought with it, their place on every friends list, their
     * messages and the push tokens that could still reach this phone.
     *
     * [startFresh] is GameStore's, and it has to run before anything is
     * asked again: it mints the new token, and every call after it — this
     * store's included, since it reads the token from Prefs each time — must
     * be the new person. Pass MessagingStore.forgetIdentity in the same
     * lambda. [onDone] is null when it went and iOS's own sentence when it
     * did not; the success line — "Your account and everything in it has
     * been deleted." — is the caller's to show.
     */
    fun deleteAccount(startFresh: () -> Unit, onDone: (String?) -> Unit = {}) =
        viewModelScope.launch {
            if (deleting) return@launch
            deleting = true
            try {
                val reply = api.postOrError("/api/account/delete")
                if (!reply.ok || reply.said()?.get("ok").asBool() != true) {
                    onDone("Couldn't delete your account — check your connection and try again.")
                    return@launch
                }
                startFresh()
                forgetIdentity()
                refresh()
                onDone(null)
            } finally {
                deleting = false
            }
        }

    /**
     * Everything this store knew about the person who just went.
     *
     * The shelf is per-wallet — owned boards are the deleted wallet's — so it
     * is thrown away too, along with any answer still in the air about it.
     * The two cosmetics Prefs remembers were bought with that wallet.
     */
    private fun forgetIdentity() {
        me = null
        wallet = null
        social = null
        daily = null
        achievements = null
        notice = null
        invited = emptySet()
        boards = null
        boardsAsk++
        boardsAsking = null
        prefs.tokenSkin = ""
        prefs.avatar = ""
    }

    // ── plumbing ───────────────────────────────────────────────────────────

    private fun cachedShelf(): StoreView? =
        prefs.string(KEY_SHELF).takeIf { it.isNotBlank() }
            ?.let { runCatching { MMJson.decodeFromString(StoreView.serializer(), it) }.getOrNull() }
            ?.takeIf { it.items.isNotEmpty() }

    /**
     * GET /api/store, once a run. A miss leaves the cached shelf standing and
     * says so; a hit is written down for the next launch.
     */
    private fun fetchShelf() {
        if (shelfJob?.isActive == true) return
        storeFailed = false
        shelfJob = viewModelScope.launch {
            val body = api.getPublic("/api/store")
            val fresh = body
                ?.let { runCatching { MMJson.decodeFromString(StoreView.serializer(), it) }.getOrNull() }
                ?.takeIf { it.items.isNotEmpty() }
            if (fresh == null || body == null) {
                storeFailed = true
                return@launch
            }
            store = fresh
            shelfFetched = true
            prefs.putString(KEY_SHELF, body)
        }
    }

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

    /** [load], waited on, for the few places that need the answer in order. */
    private suspend fun <T> fetch(path: String, serializer: KSerializer<T>): T? {
        val body = api.get(path) ?: return null
        return runCatching { MMJson.decodeFromString(serializer, body) }.getOrNull()
    }

    private fun kotlinx.serialization.json.JsonElement?.asBool(): Boolean? =
        (this as? JsonPrimitive)?.booleanOrNull

    private companion object {
        /** Where the last catalogue seen is kept between launches — iOS's "mm.shelf". */
        const val KEY_SHELF = "mm.shelf"

        /** The friends list's refresh while it is on screen — iOS's number. */
        const val SOCIAL_POLL_MS = 8_000L

        /** How long a claim keeps asking while Google's callback is late. */
        const val CLAIM_PATIENCE_MS = 15_000L
    }
}

/**
 * How a sign-in ended.
 *
 * Three ways, not two: it worked, it was refused and there is a sentence to
 * show, or the player closed Google's sheet — which is an answer, and gets no
 * sentence at all. A bare error string cannot tell the third from the first.
 */
data class SignInOutcome(
    val signedIn: Boolean,
    val error: String? = null,
    /** The play name the server settled on, for GameStore.nickname. */
    val name: String? = null,
)
