package com.moneymove.game

import android.util.Log
import io.socket.client.IO
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
class GameSocket(private val serverUrl: String) {

    private var socket: Socket? = null
    private val listeners = mutableMapOf<String, (JsonObject?) -> Unit>()
    private var onConnected: (() -> Unit)? = null
    private var onDisconnected: (() -> Unit)? = null
    private var onError: ((String) -> Unit)? = null

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

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

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

    private fun request(builder: Request.Builder): String? = try {
        http.newCall(builder.build()).execute().use { res ->
            if (res.isSuccessful) res.body?.string() else null
        }
    } catch (e: Exception) {
        Log.w("MMApi", "request failed: ${e.message}")
        null
    }
}
