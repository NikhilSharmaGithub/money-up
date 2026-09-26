package com.moneymove.game

import android.app.ActivityManager
import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The messaging half: one conversation with one friend, the owner's notes,
 * and a friend's "come and play".
 *
 * None of these rides the socket. The socket is a table — it exists while
 * four people are sitting at one — and a message has to survive everybody
 * standing up and putting the phone away, so all three are REST and all
 * three are polled: the thread every two and a half seconds while its sheet
 * is up, the notices every thirty and invites every ten for as long as the
 * app is open. The long-lived polls are the ones that matter. The bell needs
 * a count whether or not anybody has opened the list, and a badge that only
 * appears after you have already looked is not a badge; an invite has to
 * find somebody mid-game, where no screen of theirs is asking.
 *
 * Kept out of [AccountStore] so the wallet, the shop and the friends list are
 * not re-rendered by a poll that has nothing to do with them. The caller owns
 * the instance — `by viewModels()` in MainActivity beside GameStore and
 * AccountStore, passed to whatever opens the sheets — and does the wiring;
 * nothing in this file wires itself into a screen.
 */
class MessagingStore(app: Application) : AndroidViewModel(app) {

    private val prefs = Prefs(app)

    private var held: Api? = null
    private var heldFor = ""

    /**
     * One [Api], kept until the identity behind it changes.
     *
     * [AccountStore] builds a fresh one per call, which costs nothing when a
     * tap is what asks for it. This store asks every two and a half seconds
     * for as long as a thread is open, and a new Api is a new OkHttpClient
     * with a connection pool of its own — so one per poll is a fresh TCP and
     * TLS handshake per poll, on somebody's battery, all afternoon.
     */
    private val api: Api
        get() {
            val id = prefs.server + "|" + prefs.token
            held?.takeIf { heldFor == id }?.let { return it }
            heldFor = id
            return Api(prefs.server, prefs.token).also { held = it }
        }

    // ── the owner's notes ──────────────────────────────────────────────────

    var notices: List<Notice> by mutableStateOf(emptyList())
        private set

    /** How many have been written since this player last opened the list. */
    var unread: Int by mutableStateOf(0)
        private set

    // ── one conversation ───────────────────────────────────────────────────

    var thread: List<DMessage> by mutableStateOf(emptyList())
        private set

    /** This player's own code, as the thread endpoint reports it. */
    var myCode: String by mutableStateOf("")
        private set

    /** The friend code whose thread is open, if one is. */
    var openWith: String? by mutableStateOf(null)
        private set

    var sending: Boolean by mutableStateOf(false)
        private set

    /** The one line the composer shows when a message did not get through. */
    var sendError: String? by mutableStateOf(null)

    /**
     * When the list was last marked read. A poll that left before that moment
     * is answering a question which has since been settled, and letting its
     * count through would light the bell again over notes somebody has just
     * finished reading.
     */
    private var markedReadAt = 0L

    private var noticeJob: Job? = null
    private var threadJob: Job? = null

    // ── a friend's invite ──────────────────────────────────────────────────

    /**
     * The invite to announce right now, or null.
     *
     * Null as well when there is one on the server that is not worth a
     * banner: it is for the table this device is already sitting at, or this
     * device has already answered it.
     */
    var invite: Invite? by mutableStateOf(null)
        private set

    private var inviteJob: Job? = null

    /** Where this device is sitting, asked fresh on every poll. */
    private var sittingAt: () -> String? = { null }

    /**
     * Invites this device has shown and had answered or waved away, by
     * [Invite.key]. The server holds one for five minutes, and without this
     * a dismissed invite would be announced again by the very next poll.
     */
    private val answered = mutableSetOf<String>()

    // ── notices ────────────────────────────────────────────────────────────

    /**
     * Start the notice poll, once. Calling this from every screen that draws a
     * bell is meant to be safe; a second poll would only double the traffic
     * and race the first one into the same two fields.
     */
    fun watchNotices() {
        if (noticeJob?.isActive == true) return
        noticeJob = viewModelScope.launch {
            while (isActive) {
                loadNotices()
                delay(NOTICE_POLL_MS)
            }
        }
    }

    fun refreshNotices() = viewModelScope.launch { loadNotices() }

    private suspend fun loadNotices() {
        val startedAt = System.currentTimeMillis()
        // GET /api/notices, token on the query string — Api puts it there.
        val body = api.get("/api/notices") ?: return
        val feed = runCatching { MMJson.decodeFromString(NoticeFeed.serializer(), body) }
            .getOrNull() ?: return
        notices = feed.notices
        unread = if (markedReadAt > startedAt) 0 else feed.unread
    }

    /**
     * Opening the list is reading it — the server's own rule, and it stamps
     * "seen" with the time of the call rather than anything the app sends.
     *
     * The count goes to zero here instead of at the next poll so the bell is
     * quiet the moment somebody opens the list. The dots beside each line are
     * deliberately left where they are: they are the only thing that says
     * which notes were new, and clearing them while somebody is still reading
     * the first one throws that away.
     */
    fun markNoticesRead() {
        markedReadAt = System.currentTimeMillis()
        if (unread == 0) return
        unread = 0
        viewModelScope.launch { api.post("/api/notices/read") }
    }

    // ── invites ────────────────────────────────────────────────────────────

    /**
     * Start the invite poll, once, for the life of the app.
     *
     * One poll for everything, as on iOS, because an invite has to find the
     * player in the middle of a game as readily as on the home screen — so
     * this is started beside [watchNotices], not by any one screen. Every ten
     * seconds, iOS's number: an invite is a table filling up, and thirty
     * seconds late is a seat somebody else took.
     *
     * [sittingAt] answers which table this device is at — GameStore.roomId —
     * and a second call only updates it.
     *
     * The poll skips its turn while the app is off screen. iOS gets the same
     * thing for free, by being suspended, and wakes to the invite by push;
     * Android has no push to wake to (see PushRegistration), so the next poll
     * after the app comes back — within ten seconds — is what finds it. The
     * server keeps an invite for five minutes, which covers that easily.
     */
    fun watchInvites(sittingAt: () -> String?) {
        this.sittingAt = sittingAt
        if (inviteJob?.isActive == true) return
        inviteJob = viewModelScope.launch {
            while (isActive) {
                if (onScreen()) loadInvite()
                delay(INVITE_POLL_MS)
            }
        }
    }

    /** Ask now rather than at the next tick — coming back to the app, say. */
    fun refreshInvite() = viewModelScope.launch { loadInvite() }

    /**
     * GET /api/invite answers `{ invite }` — one, or null.
     *
     * A poll that fails changes nothing, so a dropped connection never wipes
     * a banner somebody is about to tap. A new invite buzzes once, on arrival,
     * and never again for the same one however many polls repeat it.
     */
    private suspend fun loadInvite() {
        val body = api.get("/api/invite") ?: return
        val feed = runCatching { MMJson.decodeFromString(InviteFeed.serializer(), body) }
            .getOrNull() ?: return
        val fresh = feed.invite?.takeIf { it.roomId.isNotBlank() }
        if (fresh == null) {
            invite = null
            return
        }
        // Already sitting at the table they are asking about, or already
        // answered this one: nothing to announce.
        val here = sittingAt()?.lowercase()
        if (here == fresh.roomId.lowercase() || fresh.key in answered) {
            invite = null
            return
        }
        if (invite?.key != fresh.key) Haptics.tap()
        invite = fresh
    }

    /**
     * Accepted or waved away — either way it is finished with.
     *
     * The banner goes at once and the server is told to drop it. Joining is
     * the caller's half — `game.connect(inv.roomId)` straight after this —
     * because a store about messages has no business opening a socket.
     * Keyed, so a banner timing out late cannot take a newer invite with it.
     */
    fun clearInvite(inv: Invite) {
        answered += inv.key
        if (invite?.key == inv.key) invite = null
        viewModelScope.launch { api.post("/api/invite/clear") }
    }

    /**
     * Is the app actually on screen?
     *
     * Read from the process's own importance rather than from a lifecycle
     * observer, because the one that would say it — ProcessLifecycleOwner —
     * is a dependency this build does not carry, and this answer costs one
     * call with no permissions.
     */
    private fun onScreen(): Boolean = runCatching {
        val me = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(me)
        me.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE
    }.getOrDefault(true)

    // ── a new identity ─────────────────────────────────────────────────────

    /**
     * The account behind all this was deleted and the device is somebody new.
     *
     * The notes, the open thread and the invite all belonged to the person
     * who left. The polls keep running — [api] already rebuilds itself for
     * the new token — they just start from nothing, which is the truth.
     */
    fun forgetIdentity() {
        closeThread()
        thread = emptyList()
        myCode = ""
        notices = emptyList()
        unread = 0
        markedReadAt = 0L
        invite = null
        answered.clear()
    }

    // ── friend chat ────────────────────────────────────────────────────────

    /**
     * Open a thread and keep it fresh until [closeThread].
     *
     * The old thread is emptied on the way in. Re-using the list would flash
     * one friend's words under another friend's name for the half second
     * before the first poll lands, which is the one mistake a messaging
     * screen is never forgiven.
     */
    fun openThread(code: String) {
        if (openWith != code) {
            openWith = code
            thread = emptyList()
            sendError = null
        }
        threadJob?.cancel()
        threadJob = viewModelScope.launch {
            while (isActive) {
                loadThread(code)
                delay(THREAD_POLL_MS)
            }
        }
    }

    fun closeThread() {
        threadJob?.cancel()
        threadJob = null
        openWith = null
        sendError = null
    }

    /**
     * GET /api/dm?token=…&code=… answers `{ messages, me }`.
     *
     * It answers 400 to a code that is not on this player's friends list, and
     * [Api] turns every non-2xx into null, so a refusal here looks exactly
     * like a dropped connection. Holding on to what is already on screen is
     * the honest answer to both. Whether messaging is allowed at all is
     * decided from the friends list instead — the same list the server checks
     * — so the screen never has to guess at it from a silence.
     */
    private suspend fun loadThread(code: String) {
        val body = api.get("/api/dm", mapOf("code" to code)) ?: return
        val reply = runCatching { MMJson.decodeFromString(DMThread.serializer(), body) }
            .getOrNull() ?: return
        // The sheet may have been closed, or swapped to another friend, while
        // this was in flight.
        if (openWith != code) return
        // The poll and a send's own reload are in flight at the same time and
        // nothing makes them land in the order they left. A thread only ever
        // grows — the server appends and keeps the last two hundred — so an
        // answer holding fewer lines than the screen already shows is an older
        // one, and letting it through takes a message somebody has just sent
        // back off the screen for a couple of seconds. Which reads as "that
        // didn't send", and is answered by sending it again.
        if (reply.messages.size < thread.size) return
        thread = reply.messages
        if (reply.me.isNotBlank()) myCode = reply.me
    }

    /**
     * POST /api/dm with `{ token, code, text }` — the three names the server
     * destructures out of the body, and no others.
     *
     * [onDone] is told whether it landed. A refusal puts the server's own
     * sentence in [sendError] — "You can only message friends" is what a
     * dropped friendship or a block reads as, and it is what iOS shows — and
     * only a send nothing answered gets the generic line. The screen still
     * goes and re-reads the friends list on a refusal, because that is where
     * the reason shows up for good.
     */
    fun send(code: String, text: String, onDone: (Boolean) -> Unit = {}) = viewModelScope.launch {
        // The server slices at 300 characters and then trims. Sending more
        // than that quietly loses the end of a sentence.
        val clean = text.trim().take(MAX_MESSAGE)
        // Two taps land on one message far more often than they land on two,
        // so the second is refused rather than queued — and refused out loud,
        // because a caller that cleared its box on the way in has to be told
        // to put the words back.
        if (clean.isEmpty() || sending) {
            onDone(false)
            return@launch
        }
        sending = true
        sendError = null
        val reply = api.postOrError("/api/dm", mapOf("code" to code, "text" to clean))
        val ok = reply.ok
        if (ok) {
            loadThread(code)
        } else {
            val said = reply.body
                ?.let { runCatching { MMJson.parseToJsonElement(it) }.getOrNull() }
                .obj()?.get("error").asString()
            sendError = said ?: "That message did not send."
        }
        sending = false
        onDone(ok)
    }

    private companion object {
        const val NOTICE_POLL_MS = 30_000L
        const val INVITE_POLL_MS = 10_000L
        const val THREAD_POLL_MS = 2_500L
        const val MAX_MESSAGE = 300
    }
}
