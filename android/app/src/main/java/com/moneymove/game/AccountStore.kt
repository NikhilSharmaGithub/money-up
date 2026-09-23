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
        load("/api/boards", BoardsView.serializer()) { boards = it }
    }

    fun refreshSocial() {
        load("/api/social", SocialView.serializer()) { social = it }
        loadPublic("/api/leaderboard", LeaderboardView.serializer()) { leaderboard = it.top }
    }

    fun refreshHistory() {
        load("/api/achievements", Achievements.serializer()) { achievements = it }
        loadPublic("/api/leaderboard", LeaderboardView.serializer()) { leaderboard = it.top }
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
        val body = api.post("/api/store/buy", mapOf("id" to item.id))
        val reply = body?.let { runCatching { MMJson.parseToJsonElement(it) }.getOrNull() }
        val error = reply?.obj()?.get("error").asString()
        if (error == null) {
            load("/api/wallet", Wallet.serializer()) { wallet = it }
            // Wearing what you just bought is what buying it meant.
            equip(item)
        } else {
            notice = error
        }
        onDone(error)
    }

    fun equip(item: StoreItem) = viewModelScope.launch {
        api.post("/api/store/equip", mapOf("id" to item.id, "kind" to item.kind))
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
        val body = api.post("/api/friends", mapOf("code" to code.trim().uppercase()))
        val error = body?.let { runCatching { MMJson.parseToJsonElement(it) }.getOrNull() }
            ?.obj()?.get("error").asString()
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

    fun block(code: String) = viewModelScope.launch {
        api.post("/api/block", mapOf("code" to code))
        load("/api/social", SocialView.serializer()) { social = it }
    }

    fun report(code: String, reason: String) = viewModelScope.launch {
        api.post("/api/report", mapOf("code" to code, "reason" to reason))
        notice = "Reported. Thanks — we read every one of these."
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
