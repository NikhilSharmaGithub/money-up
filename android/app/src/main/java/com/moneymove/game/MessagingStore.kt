package com.moneymove.game

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
 * The messaging half: one conversation with one friend, and the owner's
 * notes.
 *
 * Neither of these rides the socket. The socket is a table — it exists while
 * four people are sitting at one — and a message has to survive everybody
 * standing up and putting the phone away, so both are REST and both are
 * polled: the thread every two and a half seconds while its sheet is up, the
 * notices every thirty for as long as the app is open. The second interval is
 * the one that matters. The bell needs a count whether or not anybody has
 * opened the list, and a badge that only appears after you have already
 * looked is not a badge.
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
     * [onDone] is told whether it landed. The screen uses that to go and check
     * the friends list, because the two reasons a send is refused that a
     * player can do anything about — the friendship is gone, or one of them
     * blocked the other, which takes the friendship with it — both show up
     * there, and the 400's own sentence never reaches this client.
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
        val body = api.post("/api/dm", mapOf("code" to code, "text" to clean))
        val ok = body != null
        if (ok) loadThread(code) else sendError = "That message did not send."
        sending = false
        onDone(ok)
    }

    private companion object {
        const val NOTICE_POLL_MS = 30_000L
        const val THREAD_POLL_MS = 2_500L
        const val MAX_MESSAGE = 300
    }
}
