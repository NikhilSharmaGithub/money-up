package com.moneymove.game

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.File

/**
 * "Did you know?" — the place facts under a street's deed (GET /api/facts),
 * iOS's PlaceFacts.
 *
 * The last set is kept in the cache directory with its version and read from
 * at once, then revalidated once per launch with If-None-Match, so an
 * unchanged set costs a 304. No route (an older server), no network, a set
 * that will not decode: all the same to the deed — it shows no fact, never an
 * error.
 */
object PlaceFacts {
    @Serializable
    data class Payload(
        val version: String = "",
        val places: Map<String, String> = emptyMap(),
        val groups: Map<String, String> = emptyMap(),
    )

    /** The street's own line and its country's; either may be missing. */
    data class Found(val place: String?, val group: String?)

    var facts by mutableStateOf<Payload?>(null)
        private set
    private var read = false
    private var checked = false

    /**
     * The fetch runs here, not in the deed sheet's own effect: a sheet swiped
     * away before the reply landed cancelled the request with it, after
     * [checked] had already been set, and no street showed a fact again until
     * the app was killed. Lazy, so a unit test that only looks lines up never
     * touches the main dispatcher.
     */
    private val scope by lazy { CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate) }
    private var job: Job? = null

    private fun file(context: Context) = File(context.cacheDir, "place-facts.json")

    /**
     * Looked up by "<name>|<group>" exactly as the board sends them. Null for
     * anything that is not a street, or when there is neither line. [all] is
     * the set held now unless a test hands it one.
     */
    fun lookup(tile: TileData, all: Payload? = facts): Found? {
        val group = tile.group ?: return null
        if (all == null) return null
        if (tile.type != "property") return null
        val place = all.places["${tile.name}|$group"]
        val about = all.groups[group]
        return if (place == null && about == null) null else Found(place, about)
    }

    /** Starts [load] unless it is already running; it outlives whichever sheet asked. */
    fun ensureLoaded(context: Context, api: Api) {
        if (job?.isActive == true) return
        val app = context.applicationContext
        job = scope.launch { load(app, api) }
    }

    /** Reads the kept set, then fetches (or revalidates) it once per launch that reaches the server. */
    private suspend fun load(context: Context, api: Api) {
        if (!read) {
            read = true
            facts = withContext(Dispatchers.IO) {
                runCatching { MMJson.decodeFromString(Payload.serializer(), file(context).readText()) }.getOrNull()
            } ?: facts
        }
        if (checked) return
        checked = true
        val reply = api.getIfChanged("/api/facts", facts?.version?.let { "\"$it\"" })
        if (reply.offline) { checked = false; return } // the next deed opened asks again
        if (reply.code != 200) return
        val raw = reply.body ?: return
        val fresh = runCatching { MMJson.decodeFromString(Payload.serializer(), raw) }.getOrNull()
            ?.takeIf { it.version.isNotBlank() } ?: return
        facts = fresh
        withContext(Dispatchers.IO) { runCatching { file(context).writeText(raw) } }
    }
}
