package com.moneymove.game

import androidx.compose.runtime.mutableStateMapOf
import kotlinx.coroutines.delay

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
 */
class TokenWalker {

    /** Where each piece is standing on screen right now. */
    val shown = mutableStateMapOf<String, Int>()

    /** The highest leg `seq` already played out on this board. */
    private var playedTo = 0

    /** Whether a first state has been seen — the one that places, never replays. */
    private var seeded = false

    private var lastVersion = -1

    /**
     * Brings the board up to date with [state], playing anything new.
     *
     * [onLanded] is called the moment a piece finishes a leg with another leg
     * still to come — the beat the caller turns a drawn card over in.
     */
    suspend fun reconcile(state: GameState, onLanded: () -> Unit) {
        if (state.version == lastVersion) return
        lastVersion = state.version

        val alive = state.players.filter { !it.isBankrupt }.map { it.id }.toSet()
        shown.keys.filter { it !in alive }.forEach { shown.remove(it) }

        val legs = state.moves.orEmpty().filter { (it.seq ?: 0) > playedTo }
        legs.lastOrNull()?.seq?.let { playedTo = it }

        // The first state of a table is a position, not a journey: opening a
        // game already in progress must not replay its last three moves.
        if (!seeded) {
            seeded = true
            for (p in state.players) shown[p.id] = p.pos
            return
        }

        for (p in state.players) {
            if (p.isBankrupt) continue
            if (legs.none { it.playerId == p.id } && shown[p.id] != p.pos) shown[p.id] = p.pos
        }
        if (legs.isEmpty()) return

        val size = state.map.size.coerceAtLeast(1)
        val mover = legs.first().playerId
        for ((i, leg) in legs.withIndex()) {
            // A board that has drifted from the server — a reconnect part-way
            // through a journey — starts the leg where the server started it.
            if (shown[mover] != leg.from && shown[mover] != leg.to) shown[mover] = leg.from

            val distance = Choreography.distance(leg, size)
            if (distance == 0) {
                // A card or a jailing: the piece is carried rather than walked.
                delay(240)
                shown[mover] = leg.to
                // The clank belongs to the door closing, not to the server
                // saying so — it waits for the piece to be set down inside.
                if (leg.cause == "jail") SoundKit.jail() else SoundKit.land()
            } else {
                val dir = if (leg.steps > 0) 1 else -1
                val pace = (Choreography.pace(distance) * 1000).toLong()
                var at = shown[mover] ?: leg.from
                repeat(distance) {
                    at = ((at + dir) % size + size) % size
                    shown[mover] = at
                    if (at == leg.to) SoundKit.land() else SoundKit.step()
                    delay(pace)
                }
                shown[mover] = leg.to
            }

            if (i < legs.lastIndex) {
                // Standing on the tile that drew the card, with the card's own
                // move still to come. This is the only moment it may be read.
                onLanded()
                delay((Choreography.CARD_HOLD * 1000).toLong())
            }
        }
        // Nothing left to walk: a card with no move of its own turns over here.
        onLanded()
    }

    fun forget() {
        shown.clear()
        playedTo = 0
        seeded = false
        lastVersion = -1
    }
}
