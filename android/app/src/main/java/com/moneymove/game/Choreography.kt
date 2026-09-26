package com.moneymove.game

/**
 * The cue sheet for one action's theatre.
 *
 * The server resolves a whole roll instantly — dice, walk, card, second walk
 * — and ships every leg in `state.moves`. These timings decide when each part
 * is ALLOWED on stage: the dice get their spring, the piece walks, the card is
 * read, the piece obeys it — and only then does the money move ([payday]).
 * One source of truth so the walker, the popup and the purse agree, ported
 * beat for beat from the iOS app so a player on a phone and a player on a
 * browser watch the same thing happen at the same speed.
 */
object Choreography {

    /**
     * The dice spring runs ~0.45s; the walk holds back a beat longer so the
     * number lands in the eye before the piece moves.
     */
    const val DICE_LEAD = 0.65

    /** A card is read before it is obeyed. */
    const val CARD_HOLD = 0.95

    /** Breath between legs. */
    const val SETTLE = 0.18

    /**
     * A card that pays or charges without moving the piece is read before the
     * money moves: this long after it turns over, the purse follows it.
     */
    const val CARD_READ = 0.45

    /**
     * The longest any money may wait on its journey. The walk is theatre and
     * the shot clock is not, so a balance is never more than this far behind
     * the server, however long the story.
     */
    const val MONEY_CAP = 6.0

    /**
     * Between the entries one journey releases: the rent, then a bot's
     * scramble to raise cash, then the bust — heard as three things that
     * happened, not one chord.
     */
    const val ENTRY_GAP = 0.5

    fun pace(distance: Int): Double = when {
        distance > 12 -> 0.07
        distance > 7 -> 0.095
        else -> 0.13
    }

    fun distance(leg: MoveLeg, boardSize: Int): Int {
        if (leg.steps == 0 || boardSize <= 0) return 0      // teleports glide
        return if (leg.steps > 0) ((leg.to - leg.from + boardSize) % boardSize)
        else ((leg.from - leg.to + boardSize) % boardSize)
    }

    fun legDuration(leg: MoveLeg, boardSize: Int): Double {
        val d = distance(leg, boardSize)
        return if (d == 0) 0.35 else d * pace(d) + 0.15
    }

    data class Timeline(val starts: List<Double>, val cardAt: Double?)

    /**
     * Per-leg start offsets plus the card-reveal moment, all measured from the
     * journey's start. `cardAt` is null when the action drew no card.
     *
     * `lead` is the pause before a rolled first leg: [DICE_LEAD] while the dice
     * are still landing, or [SETTLE] for a journey queued behind the same
     * piece's last one — a double's re-roll, whose dice were already watched
     * landing while the first walk was still going.
     */
    fun timeline(legs: List<MoveLeg>, boardSize: Int, hasCard: Boolean, lead: Double = DICE_LEAD): Timeline {
        if (legs.isEmpty()) return Timeline(emptyList(), if (hasCard) 0.2 else null)
        val starts = ArrayList<Double>(legs.size)
        var cardAt: Double? = null
        var t = if (legs[0].cause == "card") 0.2 else lead
        for ((i, leg) in legs.withIndex()) {
            if (i > 0) {
                t += SETTLE
                // Whatever follows the first leg is the card's doing — the
                // card must be on screen before the piece obeys it.
                if (hasCard && cardAt == null) {
                    cardAt = t
                    t += CARD_HOLD
                }
            }
            starts.add(t)
            t += legDuration(leg, boardSize)
        }
        if (cardAt == null && hasCard) cardAt = t + 0.15   // money card: after the walk
        return Timeline(starts, cardAt)
    }

    /**
     * When the whole act is off stage: the last leg has landed and, if a card
     * rode along, it has had its read. The decision UI born of this action —
     * the buy prompt, an auction the landing opened — waits for this moment.
     */
    fun curtain(legs: List<MoveLeg>, boardSize: Int, hasCard: Boolean, lead: Double = DICE_LEAD): Double {
        val (starts, cardAt) = timeline(legs, boardSize, hasCard, lead)
        var end = starts.zip(legs) { s, leg -> s + legDuration(leg, boardSize) }.maxOrNull() ?: 0.0
        if (cardAt != null) end = maxOf(end, cardAt + CARD_HOLD)
        return end
    }

    /**
     * When the money a journey carries may show: its payday.
     *
     * The end of the last leg — a beat after the landing thump, so the rent
     * reads as knock, then ka-ching. A card that pays or charges without a leg
     * of its own turns over after the walk, and the purse waits [CARD_READ]
     * more for it to be read. Never later than [MONEY_CAP].
     */
    fun payday(legs: List<MoveLeg>, boardSize: Int, hasCard: Boolean, lead: Double = DICE_LEAD): Double {
        val (starts, cardAt) = timeline(legs, boardSize, hasCard, lead)
        val lastEnd = starts.lastOrNull()?.let { it + legDuration(legs.last(), boardSize) } ?: 0.0
        val pay = if (hasCard && cardAt != null && cardAt >= lastEnd) cardAt + CARD_READ else lastEnd
        return minOf(pay, MONEY_CAP)
    }
}
