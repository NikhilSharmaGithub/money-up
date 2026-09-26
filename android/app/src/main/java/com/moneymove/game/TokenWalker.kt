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

    /**
     * The piece whose legs are being played right now, if any. A push that
     * lands mid-walk — rent, a card, anybody's chat — must leave it walking:
     * iOS's walker keeps a walk "already heading to this exact tile" going,
     * and snapping it to the end would give the card's destination away.
     */
    var walking: String? = null
        private set

    /**
     * Every piece that is not mid-journey, set down where the server has it.
     * Cheap and immediate, so the board can call it on every push without
     * touching a walk in progress: the piece being walked, and any piece with
     * legs still waiting to be played, are left alone.
     */
    fun settle(state: GameState) {
        val alive = state.players.filter { !it.isBankrupt }.map { it.id }.toSet()
        shown.keys.filter { it !in alive }.forEach { shown.remove(it) }

        // The first state of a table is a position, not a journey: opening a
        // game already in progress must not replay its last three moves.
        if (!seeded) {
            seeded = true
            for (p in state.players) shown[p.id] = p.pos
            state.moves.orEmpty().mapNotNull { it.seq }.maxOrNull()?.let { playedTo = maxOf(playedTo, it) }
            return
        }

        val pending = state.moves.orEmpty().filter { (it.seq ?: 0) > playedTo }.mapTo(HashSet()) { it.playerId }
        for (p in state.players) {
            if (p.isBankrupt || p.id == walking || p.id in pending) continue
            if (shown[p.id] != p.pos) shown[p.id] = p.pos
        }
    }

    /**
     * Plays anything new in [state]'s legs, then settles on [latest] — the
     * freshest state there is by the time the walk ends, since pushes that
     * arrived during it were deliberately not allowed to move the walker.
     *
     * [onLanded] is called the moment a piece finishes a leg with another leg
     * still to come — the beat the caller turns a drawn card over in.
     */
    suspend fun reconcile(state: GameState, latest: () -> GameState = { state }, onLanded: () -> Unit) {
        settle(state)
        val legs = state.moves.orEmpty().filter { (it.seq ?: 0) > playedTo }
        if (legs.isEmpty()) return
        legs.lastOrNull()?.seq?.let { playedTo = it }

        val size = state.map.size.coerceAtLeast(1)
        val mover = legs.first().playerId
        walking = mover
        try {
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
                        // Each hop is heard and felt: step() and land() carry
                        // iOS's light knock at 0.55 along with the sound.
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
        } finally {
            if (walking == mover) walking = null
        }
        // Nothing left to walk: a card with no move of its own turns over here.
        onLanded()
        settle(latest())
    }

    fun forget() {
        shown.clear()
        playedTo = 0
        seeded = false
        walking = null
    }
}
