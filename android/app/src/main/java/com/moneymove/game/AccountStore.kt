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

    /** The last thing that went wrong, for the one line a screen shows. */
    var notice: String? by mutableStateOf(null)

    val coins: Int get() = wallet?.coins ?: me?.coins ?: 0

    /** Everything a fresh launch, or a pull-to-refresh, wants. */
    fun refresh() {
        load("/api/me", MeView.serializer()) { me = it }
        load("/api/wallet", Wallet.serializer()) { wallet = it }
        load("/api/daily", DailyView.serializer()) { daily = it }
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
