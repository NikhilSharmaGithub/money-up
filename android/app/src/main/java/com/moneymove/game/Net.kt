package com.moneymove.game

import android.util.Log
import io.socket.client.IO
import io.socket.client.Manager
import io.socket.client.Socket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * The one JSON reader the whole app uses.
 *
 * `ignoreUnknownKeys` is not laziness — it is the contract that lets the
 * server ship a field on a Friday without bricking every phone that has not
 * updated, and it is the same tolerance the iOS decoder and the browser have.
 * `isLenient` covers the handful of places the server writes a number where a
 * string would do.
 */
val MMJson: Json = Json {
    ignoreUnknownKeys = true
    isLenient = true
    coerceInputValues = true
    explicitNulls = false
}

/**
 * The socket the game runs on — the same transport, the same event names and
 * the same payloads the browser and the iOS app use, because one server
 * speaking one protocol to three clients is the only way the three of them
 * stay the same game.
 *
 * Everything here is deliberately thin. It connects, it forwards events to a
 * listener, and it emits. Deciding what an event *means* belongs to the
 * store; a transport that starts interpreting is a transport that has to be
 * kept in step with the rules.
 */
class GameSocket(
    private val serverUrl: String,
    /**
     * A connection of its own rather than a share of one already open to the
     * same server. Only a pass & play guest asks for it: the server binds a
     * seat to the connection that joined it, so two players on one phone need
     * two real connections, and multiplexing would quietly hand the second one
     * the first one's line.
     */
    private val forceNew: Boolean = false,
) {

    private var socket: Socket? = null
    private val listeners = mutableMapOf<String, (JsonObject?) -> Unit>()
    private var onConnected: (() -> Unit)? = null
    private var onDisconnected: (() -> Unit)? = null
    private var onError: ((String) -> Unit)? = null
    private var onRetrying: (() -> Unit)? = null

    val isConnected: Boolean get() = socket?.connected() == true

    /**
     * Registers a handler for one server event. Called before [connect] so no
     * push can arrive before anybody is listening for it — the first `state`
     * lands within a frame or two of the handshake.
     */
    fun on(event: String, handler: (JsonObject?) -> Unit) {
        listeners[event] = handler
    }

    fun onConnect(block: () -> Unit) { onConnected = block }
    fun onDisconnect(block: () -> Unit) { onDisconnected = block }
    fun onFailure(block: (String) -> Unit) { onError = block }

    /**
     * The line dropped and the client is dialling again. Distinct from a plain
     * disconnect so a table can say "reconnecting" while it is actually
     * trying, rather than looking dead between one attempt and the next.
     */
    fun onReconnecting(block: () -> Unit) { onRetrying = block }

    fun connect() {
        if (socket != null) return
        val opts = IO.Options.builder()
            // Long-polling first and then an upgrade costs a round trip on a
            // phone that is about to sit on a websocket for half an hour.
            .setTransports(arrayOf("websocket"))
            .setReconnection(true)
            .setReconnectionDelay(500)
            .setReconnectionDelayMax(4_000)
            .setTimeout(20_000)
            .setForceNew(forceNew)
            .build()
        val s = IO.socket(URI.create(serverUrl), opts)
        socket = s

        for ((event, handler) in listeners) {
            s.on(event) { args -> handler(args.firstOrNull().toJsonObject()) }
        }
        s.on(Socket.EVENT_CONNECT) { onConnected?.invoke() }
        s.on(Socket.EVENT_DISCONNECT) { onDisconnected?.invoke() }
        s.on(Socket.EVENT_CONNECT_ERROR) { args ->
            onError?.invoke(args.firstOrNull()?.toString() ?: "connection failed")
        }
        // Retries are the manager's business, not the socket's, so the hook
        // hangs off the manager — and comes off it again in [disconnect].
        onRetrying?.let { retry -> s.io().on(Manager.EVENT_RECONNECT_ATTEMPT) { retry() } }
        s.connect()
    }

    fun emit(event: String, vararg args: Any?) {
        socket?.emit(event, *args)
    }

    /**
     * An emit that expects an answer.
     *
     * The room handlers reply through an acknowledgement rather than an event,
     * so a client can ask for a table without first subscribing to one.
     */
    fun emitAck(event: String, payload: Any?, ack: (JsonObject?) -> Unit) {
        socket?.emit(event, arrayOf(payload)) { args -> ack(args.firstOrNull().toJsonObject()) }
    }

    /** Emits a map as the single object argument most handlers expect. */
    fun emitMap(event: String, payload: Map<String, Any?>) {
        socket?.emit(event, JSONObject(payload.filterValues { it != null }))
    }

    fun disconnect() {
        socket?.io()?.off(Manager.EVENT_RECONNECT_ATTEMPT)
        socket?.off()
        socket?.disconnect()
        socket?.close()
        socket = null
    }

    private companion object {
        const val TAG = "MMSocket"
    }

    init {
        Log.d(TAG, "socket for $serverUrl")
    }
}

/**
 * Socket.IO hands payloads over as org.json values; the rest of the app reads
 * kotlinx trees. Going through the text is the honest conversion: the two
 * libraries disagree about nulls and about integral doubles, and re-parsing
 * costs a fraction of a millisecond on a payload this size while a hand-rolled
 * walk between them would be one more thing to keep correct.
 */
internal fun Any?.toJsonObject(): JsonObject? = when (this) {
    null -> null
    is JSONObject -> runCatching { MMJson.parseToJsonElement(toString()) as? JsonObject }.getOrNull()
    is JSONArray -> null
    else -> null
}

/**
 * The REST half: wallets, boards, leaderboards, friends, history — everything
 * that is a question rather than a table. Small on purpose; the socket is
 * where the game lives.
 *
 * The player's token rides the query string on a GET and the body on a POST,
 * because that is what `server/index.js` reads (`req.query.token`) and what
 * the browser and the iOS app already send. It is this client's job to speak
 * the protocol that exists, not a tidier one only it would understand.
 */
class Api(private val baseUrl: String, private val token: String) {

    /**
     * One client for the whole app. An Api is cheap and made on every access
     * (`store.api`), and the public room list asks every eight seconds; an
     * OkHttpClient each time would be a connection pool and a thread pool each
     * time, and none of them ever reused.
     */
    private val http: OkHttpClient get() = SHARED

    /** A GET whose query already carries the token, plus anything extra. */
    suspend fun get(path: String, query: Map<String, String> = emptyMap()): String? =
        withContext(Dispatchers.IO) {
            request(Request.Builder().url(url(path, query + ("token" to token))).get())
        }

    /** A GET for the handful of endpoints that are nobody's in particular. */
    suspend fun getPublic(path: String, query: Map<String, String> = emptyMap()): String? =
        withContext(Dispatchers.IO) {
            request(Request.Builder().url(url(path, query)).get())
        }

    /**
     * [get], but with the status and the body whatever the answer was — for a
     * question whose refusal is something the player should be told, the way
     * [postOrError] is for an action.
     */
    suspend fun getOrError(path: String, query: Map<String, String> = emptyMap()): Reply =
        withContext(Dispatchers.IO) {
            call(Request.Builder().url(url(path, query + ("token" to token))).get())
        }

    suspend fun post(path: String, body: Map<String, Any?> = emptyMap()): String? =
        withContext(Dispatchers.IO) {
            val payload = JSONObject((body + ("token" to token)).filterValues { it != null })
            request(
                Request.Builder().url(url(path))
                    .post(payload.toString().toRequestBody("application/json".toMediaType()))
            )
        }

    private fun url(path: String, query: Map<String, String> = emptyMap()): String {
        val base = baseUrl.trimEnd('/') + (if (path.startsWith("/")) path else "/$path")
        if (query.isEmpty()) return base
        val sep = if (base.contains('?')) "&" else "?"
        val q = query.entries.joinToString("&") {
            "${URLEncoder.encode(it.key, "UTF-8")}=${URLEncoder.encode(it.value, "UTF-8")}"
        }
        return base + sep + q
    }

    /**
     * A call that answers with the body whatever the status was.
     *
     * The plain [get]/[post] hand back null for anything that is not a 2xx,
     * which throws away the only useful thing a refusal carries: the server's
     * own sentence saying why. Everything that shows a player a reason —
     * buying, adding a friend, blocking — reads this instead, or it ends up
     * treating "You already own that" as a purchase that worked.
     */
    suspend fun postOrError(path: String, body: Map<String, Any?> = emptyMap()): Reply =
        withContext(Dispatchers.IO) {
            val payload = JSONObject((body + ("token" to token)).filterValues { it != null })
            call(
                Request.Builder().url(url(path))
                    .post(payload.toString().toRequestBody("application/json".toMediaType()))
            )
        }

    /** A status and a body, or neither when nothing answered at all. */
    data class Reply(val code: Int, val body: String?) {
        val ok: Boolean get() = code in 200..299
        /** True when nothing answered — a tunnel, not a refusal. */
        val offline: Boolean get() = code == 0

        /**
         * The server's own sentence for a refusal — every endpoint answers
         * `{ error: "…" }` — or null when there is none to show.
         */
        val error: String?
            get() = if (ok) null else body?.let { raw ->
                runCatching {
                    (MMJson.parseToJsonElement(raw) as? JsonObject)?.get("error").asString()
                }.getOrNull()
            }
    }

    private fun call(builder: Request.Builder): Reply = try {
        http.newCall(builder.build()).execute().use { res ->
            Reply(res.code, res.body?.string())
        }
    } catch (e: Exception) {
        Log.w("MMApi", "request failed: ${e.message}")
        Reply(0, null)
    }

    private fun request(builder: Request.Builder): String? =
        call(builder).let { if (it.ok) it.body else null }

    private companion object {
        val SHARED: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build()
    }
}
