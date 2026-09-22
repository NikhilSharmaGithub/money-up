package com.moneymove.game

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The client half of `server/delta.js`, in Kotlin.
 *
 * The server re-sends the whole board to every viewer on every action — about
 * thirteen kilobytes, thirty-odd times a minute — and almost none of it has
 * moved since the lobby. The map is the same map. The group table is the same
 * table. A socket that says `proto: 2` at the door gets one full state and
 * then only what changed; putting those back together is all this file does.
 *
 * It deserializes nothing. It keeps the last state as the parsed JSON tree,
 * patches that, and hands the rebuilt tree back for exactly the decode a full
 * push has always taken. The [GameState] that reaches the store is the same
 * one a full state would have made, so the walker, the choreography and every
 * screen never learn that anything changed.
 *
 * ---------------------------------------------------------------- the shape
 *
 * A patch for an object is an object with up to three members, all optional:
 *
 *     { s: { key: value },    set: this key is now exactly this value
 *       p: { key: patch },    patch: recurse, both sides are objects
 *       d: [ key ] }          drop: this key is gone
 *
 * and `{ $: value }` at the root for a wholesale replacement. Real state keys
 * only ever live inside `s`, `p` or `d`, so a key called "s" can never be
 * mistaken for the envelope.
 *
 * Every function here answers null for a patch it cannot honestly apply.
 * There is no half-applied state anywhere in this file: the caller either
 * gets a state it can trust or an admission that only a fresh full one will
 * do. A client that renders a board which never existed is worse than one
 * that asks the question again.
 */
object StatePatch {

    /**
     * `next` again, from `prev` and the patch — or null if the patch does not
     * describe a change to this shape, in which case the thread is lost.
     */
    fun apply(prev: JsonObject, patch: JsonObject): JsonObject? {
        // The root was replaced outright. Only an object can be a state; a
        // scalar arriving here means we and the server disagree about what a
        // state is, and stitching it in would be worse than starting over.
        patch["\$"]?.let { return it as? JsonObject }

        // Shallow on purpose: every branch the patch never mentions stays the
        // very element it already was. Most of a state is furniture.
        val out = LinkedHashMap(prev)

        // Drop, set, then recurse — the same order applyPatch() uses, so a key
        // that somehow appeared in two members lands the same way at both ends
        // of the wire.
        patch["d"]?.let { drop ->
            val keys = drop as? JsonArray ?: return null
            for (key in keys) {
                val name = (key as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
                out.remove(name)
            }
        }
        patch["s"]?.let { set ->
            val values = set as? JsonObject ?: return null
            for ((name, value) in values) out[name] = value
        }
        patch["p"]?.let { sub ->
            val branches = sub as? JsonObject ?: return null
            for ((name, branch) in branches) {
                // The server only ever recurses where both sides were objects.
                // If ours is not one, our copy is not the copy it diffed.
                val inner = branch as? JsonObject ?: return null
                val mine = out[name] as? JsonObject ?: return null
                out[name] = apply(mine, inner) ?: return null
            }
        }
        return JsonObject(out)
    }
}

/**
 * The log and the chat are the two worst offenders in a full push: sixty log
 * lines and fifty chat lines re-sent for the sake of the one that is new.
 * They ride as tails instead — keep the last `keep` entries you already hold,
 * then append these.
 *
 * `keep` is what makes it exact rather than approximate. The server's window
 * slides, and a viewer with another team's chat filtered out holds a slightly
 * different slice again; trimming to sixty and fifty ourselves is how the two
 * ends drift apart. Told how many of our own entries survive, we land on
 * precisely the array a full state would have given us.
 *
 * `after` is the anchor — the `at` of the last log line, the `id` of the last
 * chat line, whichever we are meant to be holding. If ours disagrees we have
 * gapped, and stitching a hole into the scrollback is not a repair.
 */
object StateFeed {

    fun apply(prev: JsonArray, tail: JsonObject, key: String): JsonArray? {
        val keep = (tail["keep"] as? JsonPrimitive)?.intOrNull ?: return null
        if (keep < 0 || keep > prev.size) return null
        val mine = (prev.lastOrNull() as? JsonObject)?.get(key) ?: JsonNull
        val theirs = tail["after"] ?: JsonNull
        if (mine != theirs) return null

        val out = ArrayList<JsonElement>(prev.subList(prev.size - keep, prev.size))
        tail["add"]?.let { arriving ->
            val lines = arriving as? JsonArray ?: return null
            out.addAll(lines)
        }
        return JsonArray(out)
    }
}

/**
 * One socket's copy of what the server thinks it has been sent: the state
 * minus its two feeds (the half the server actually diffs), the feeds
 * themselves, and the version every patch is measured from.
 *
 * Nothing is committed until the whole patch has landed. A patch that fails
 * halfway leaves the mirror exactly where it was, still holding the last
 * state it can vouch for, and asks for a resync — which is the difference
 * between a client that recovers and one that quietly renders a board that
 * never existed.
 */
class StateMirror {

    /** What a `statePatch` came to. */
    sealed interface Step {
        /** Rebuilt and whole — decode it exactly like a full push. */
        data class State(val json: JsonObject) : Step
        /** The thread is lost. Only a fresh full state picks it back up. */
        data object Resync : Step
    }

    /** The state without `log` and `chat` — precisely what the server diffs. */
    private var lean: JsonObject = JsonObject(emptyMap())
    private var log: JsonArray = JsonArray(emptyList())
    private var chat: JsonArray = JsonArray(emptyList())

    /** Null until the first full state; a patch before that has nothing to sit on. */
    private var version: Int? = null

    /**
     * Leaving a table, or joining another. Versions count per room, so a patch
     * still in flight for the room we walked out of must never be allowed to
     * line up against the one we walked into.
     */
    fun forget() {
        lean = JsonObject(emptyMap())
        log = JsonArray(emptyList())
        chat = JsonArray(emptyList())
        version = null
    }

    /** The fixed point every later patch is measured from. */
    fun adopt(state: JsonObject) {
        version = (state["version"] as? JsonPrimitive)?.intOrNull
        log = state["log"] as? JsonArray ?: JsonArray(emptyList())
        chat = state["chat"] as? JsonArray ?: JsonArray(emptyList())
        val rest = LinkedHashMap(state)
        rest.remove("log")
        rest.remove("chat")
        lean = JsonObject(rest)
    }

    fun apply(message: JsonObject): Step {
        // Every patch names the version it applies to. Anything else and we
        // would be rebuilding a state that was never ours.
        val held = version ?: return Step.Resync
        val from = (message["from"] as? JsonPrimitive)?.intOrNull ?: return Step.Resync
        if (from != held) return Step.Resync
        val next = (message["v"] as? JsonPrimitive)?.intOrNull ?: return Step.Resync

        var nextLog = log
        (message["log"] as? JsonObject)?.let { tail ->
            nextLog = StateFeed.apply(log, tail, "at") ?: return Step.Resync
        }
        var nextChat = chat
        (message["chat"] as? JsonObject)?.let { tail ->
            nextChat = StateFeed.apply(chat, tail, "id") ?: return Step.Resync
        }
        var nextLean = lean
        (message["patch"] as? JsonObject)?.let { patch ->
            nextLean = StatePatch.apply(lean, patch) ?: return Step.Resync
        }

        // Every half landed, so now it is safe to be the new truth.
        lean = nextLean
        log = nextLog
        chat = nextChat
        version = next

        // `patch` carries `version` itself, so what we hand back is whole —
        // the same shape a full push arrives in, feeds and all.
        val full = LinkedHashMap(nextLean)
        full["log"] = nextLog
        full["chat"] = nextChat
        return Step.State(JsonObject(full))
    }

    companion object {
        /**
         * The one word a client says to get patches instead of whole states.
         * It rides the `join` payload rather than a handshake of its own, so
         * it goes out again on every reconnect for free — and so saying
         * nothing keeps its old meaning for the builds already out there.
         */
        const val PROTOCOL_VERSION = 2
    }
}

/** Convenience for the places that only want a number or a string out. */
internal fun JsonElement?.asString(): String? =
    (this as? JsonPrimitive)?.takeIf { it.isString }?.content

internal fun JsonElement?.asInt(): Int? = (this as? JsonPrimitive)?.intOrNull

internal fun JsonElement?.obj(): JsonObject? = (this as? JsonObject)

@Suppress("unused")
private fun JsonElement.debugKeys(): String = runCatching { jsonObject.keys.joinToString() }
    .getOrElse { runCatching { jsonPrimitive.content }.getOrElse { "?" } }
