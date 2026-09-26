package com.moneymove.game

import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Walks each piece to where the server says it is — leg by leg, in order.
 *
 * The server resolves a whole action before it pushes anything: the roll, the
 * tile it landed on, the card that tile drew, and wherever the card then sent
 * the piece. Playing only the final position tells the story backwards. The
 * walk onto Surprise never happens, and on a card that sends you back exactly
 * as far as you came, the piece does not move at all while the card's text is
 * already on screen.
 *
 * So the legs are replayed one at a time, with a pause between them — and
 * that pause is where the card turns over. [shown] is what the board draws
 * and what the highlight follows, which is the whole point: the tile that is
 * lit is the tile the player is standing on, not the one they are about to be
 * sent to.
 *
 * What it walks, and when, is the store's to say. Every journey the store
 * opens (GameStore.stage) carries its own clock — when it starts, after the
 * dice have had their moment or after the same piece's last walk, and the
 * store holds the money it carries until that same clock says the piece has
 * landed. The walker plays each leg at exactly the moment the clock gives it,
 * so the thump of the landing and the rent it costs can never drift apart.
 * A double's re-roll is a second journey queued behind the first, so the
 * piece walks twice instead of snapping. And since only journeys the store
 * opened are ever walked, a reconnect — which opens none — sets every piece
 * straight down where it is.
 */
class TokenWalker {

    /** Where each piece is standing on screen right now. */
    val shown = mutableStateMapOf<String, Int>()

    /** Whether a first state has been seen — the one that places, never replays. */
    private var seeded = false

    /** Journeys this board has already taken on, by key: walked, walking, or found under way. */
    private val taken = HashSet<Double>()

    /** Walks still to finish per piece — a double queues a second behind the first. */
    private val busy = HashMap<String, Int>()

    /** The journeys this board is walking or about to, by key. */
    private val playing = HashSet<Double>()

    /** The stage has been looked at once; see [perform]. */
    private var joined = false

    /**
     * Every piece that is not mid-journey, set down where the server has it.
     * Cheap and immediate, so the board can call it on every push without
     * touching a walk in progress: a piece walking, or with a journey on the
     * stage it has not started yet, is left alone.
     *
     * The seats are the store's shown ones: a piece whose bankruptcy has not
     * landed yet finishes its walk and leaves the board when it does.
     */
    fun settle(store: GameStore) {
        if (store.state == null) return
        val seats = store.shownPlayers
        val alive = seats.filter { !it.isBankrupt }.mapTo(HashSet()) { it.id }
        shown.keys.filter { it !in alive }.forEach { shown.remove(it) }

        // The first state of a table is a position, not a journey: opening a
        // game already in progress must not replay its last three moves. A
        // board drawn afresh while a walk it will still perform is waiting on
        // its dice — the table re-laid mid-game — sets that piece down where
        // the walk starts, not where the server already has it: standing on
        // the destination first would give the landing away.
        if (!seeded) {
            seeded = true
            for (p in seats) {
                if (p.id !in alive) continue
                val next = store.stage.filter { it.mover == p.id && it.key in playing }.minByOrNull { it.startAt }
                shown[p.id] = next?.legs?.firstOrNull()?.from ?: p.pos
            }
            return
        }

        val waiting = store.stage.filter { it.key !in taken }.mapTo(HashSet()) { it.mover }
        for (p in seats) {
            if (p.id !in alive || (busy[p.id] ?: 0) > 0 || p.id in waiting) continue
            if (shown[p.id] != p.pos) shown[p.id] = p.pos
        }
    }

    /**
     * Plays every journey the store puts on its stage, for as long as the
     * board is on screen: one coroutine each, sleeping until its own start,
     * so a queued double walks after the first rather than over it.
     *
     * [onLanded] is called at the journey's card moment — standing on the tile
     * that drew it, before any move the card orders, or after the walk for a
     * card that only pays or charges — which is when the card may turn over.
     *
     * A board that has only just been drawn (the screen turned, the layout
     * changed) can find a journey already under way. That one is not walked
     * from a tile the piece has already left: it is set down where it is going.
     */
    suspend fun perform(store: GameStore, onLanded: (GameStore.Journey) -> Unit) = coroutineScope {
        snapshotFlow { store.stage }.collect { stage ->
            val now = System.currentTimeMillis()
            for (j in stage) {
                if (!taken.add(j.key)) continue
                val underWay = !joined &&
                    now >= j.startAt + ms(Choreography.timeline(j.legs, j.boardSize, j.hasCard, j.lead).starts.firstOrNull() ?: 0.0)
                if (underWay || j.cut) continue
                busy[j.mover] = (busy[j.mover] ?: 0) + 1
                playing += j.key
                launch {
                    try {
                        play(j, onLanded)
                    } finally {
                        playing -= j.key
                        val left = (busy[j.mover] ?: 1) - 1
                        if (left <= 0) busy.remove(j.mover) else busy[j.mover] = left
                        settle(store)
                    }
                }
            }
            joined = true
            val onStage = stage.mapTo(HashSet()) { it.key }
            taken.retainAll(onStage)
            settle(store)
        }
    }

    /** One journey, on its own clock. Stops the moment the store cuts it. */
    private suspend fun play(j: GameStore.Journey, onLanded: (GameStore.Journey) -> Unit) {
        val size = j.boardSize.coerceAtLeast(1)
        val (starts, cardAt) = Choreography.timeline(j.legs, size, j.hasCard, j.lead)
        val mover = j.mover
        for ((i, leg) in j.legs.withIndex()) {
            sleepUntil(j.startAt + ms(starts[i]))
            if (j.cut) return
            // Every leg starts where the server started it. A piece already
            // standing on the leg's end — a board drawn afresh and set down
            // on the server's tile before this walk began — would otherwise
            // count its hops on from there, overshoot, and snap back.
            if (shown[mover] != leg.from) shown[mover] = leg.from

            val distance = Choreography.distance(leg, size)
            if (distance == 0) {
                // A card or a jailing: the piece is carried rather than walked.
                delay(240)
                if (j.cut) return
                shown[mover] = leg.to
                // The clank belongs to the door closing, not to the server
                // saying so — it waits for the piece to be set down inside.
                if (leg.cause == "jail") SoundKit.jail() else SoundKit.land()
            } else {
                val dir = if (leg.steps > 0) 1 else -1
                val pace = ms(Choreography.pace(distance))
                var at = leg.from
                repeat(distance) {
                    if (j.cut) return
                    at = ((at + dir) % size + size) % size
                    shown[mover] = at
                    // Each hop is heard and felt: step() and land() carry
                    // iOS's light knock at 0.55 along with the sound.
                    if (at == leg.to) SoundKit.land() else SoundKit.step()
                    delay(pace)
                }
                shown[mover] = leg.to
            }

            // Standing on the tile that drew the card, with the card's own
            // move still to come. This is the only moment it may be read.
            val next = starts.getOrNull(i + 1)
            if (next != null && cardAt != null && cardAt >= starts[i] && cardAt < next) {
                sleepUntil(j.startAt + ms(cardAt))
                if (j.cut) return
                onLanded(j)
            }
        }
        // Nothing left to walk: a card with no move of its own turns over
        // here, a beat after the landing.
        val lastEnd = (starts.lastOrNull() ?: 0.0) + (j.legs.lastOrNull()?.let { Choreography.legDuration(it, size) } ?: 0.0)
        if (cardAt != null && cardAt >= lastEnd) {
            sleepUntil(j.startAt + ms(cardAt))
            if (!j.cut) onLanded(j)
        }
    }

    fun forget() {
        shown.clear()
        seeded = false
        taken.clear()
        busy.clear()
        playing.clear()
        joined = false
    }

    private companion object {
        fun ms(seconds: Double): Long = (seconds * 1000).toLong()

        /** Sleeps until a wall-clock moment on the journey's clock; at once if it has passed. */
        suspend fun sleepUntil(at: Long) {
            val wait = at - System.currentTimeMillis()
            if (wait > 0) delay(wait)
        }
    }
}
