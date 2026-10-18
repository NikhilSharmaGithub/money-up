package com.moneymove.game

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
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

    /** Reads the kept set, then fetches (or revalidates) it once per launch that reaches the server. */
    suspend fun load(context: Context, api: Api) {
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
