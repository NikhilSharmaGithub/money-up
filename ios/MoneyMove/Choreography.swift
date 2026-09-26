// The cue sheet for one action's theatre. The server resolves a whole roll
// instantly — dice, walk, card, second walk — and ships every leg in
// state.moves. These timings decide when each part is ALLOWED on stage:
// the dice get their spring, the piece walks, the card is read, the piece
// obeys it. One source of truth so the walker and the popup agree.

import Foundation

enum Choreography {
    /// The dice spring runs ~0.45s; the walk holds back a beat longer so the
    /// number lands in the eye before the piece moves.
    static let diceLead = 0.65
    /// A card is read before it is obeyed.
    static let cardHold = 0.95
    /// Breath between legs.
    static let settle = 0.18

    static func pace(forDistance d: Int) -> Double {
        d > 12 ? 0.07 : d > 7 ? 0.095 : 0.13
    }

    static func distance(of leg: MoveLeg, boardSize: Int) -> Int {
        guard leg.steps != 0, boardSize > 0 else { return 0 }   // teleports glide
        let dir = leg.steps > 0 ? 1 : -1
        return dir > 0
            ? ((leg.to - leg.from + boardSize) % boardSize)
            : ((leg.from - leg.to + boardSize) % boardSize)
    }

    static func legDuration(_ leg: MoveLeg, boardSize: Int) -> Double {
        let d = distance(of: leg, boardSize: boardSize)
        return d == 0 ? 0.35 : Double(d) * pace(forDistance: d) + 0.15
    }

    /// A card that pays or charges without moving the piece is read before
    /// its money moves: the payment lands this long after it turns over.
    static let cardRead = 0.45
    /// However long the act, the money it carries is never kept off the
    /// table longer than this.
    static let moneyCap = 6.0
    /// The consequences of one landing arrive one beat apart — the rent, then
    /// a bot's scramble to raise it, then the bust — rather than as one chord.
    static let entryGap = 0.5

    /// Per-leg start offsets plus the card-reveal moment, all measured from
    /// the act's start. `cardAt` is nil when the action drew no card.
    ///
    /// `lead` is how long the piece waits before it sets off: the dice
    /// spring's worth for a fresh roll, one breath for a doubles re-roll
    /// queued behind the walk before it (those dice were seen while the first
    /// walk was still going).
    static func timeline(_ legs: [MoveLeg], boardSize: Int, hasCard: Bool,
                         lead: Double = diceLead)
        -> (starts: [Double], cardAt: Double?) {
        guard !legs.isEmpty else { return ([], hasCard ? 0.2 : nil) }
        var starts: [Double] = []
        var cardAt: Double? = nil
        var t = legs[0].cause == "card" ? 0.2 : lead
        for (i, leg) in legs.enumerated() {
            if i > 0 {
                t += settle
                // Whatever follows the first leg is the card's doing — the
                // popup must be on screen before the piece obeys it.
                if hasCard, cardAt == nil { cardAt = t; t += cardHold }
            }
            starts.append(t)
            t += legDuration(leg, boardSize: boardSize)
        }
        if cardAt == nil, hasCard { cardAt = t + 0.15 }   // money card: after the walk
        return (starts, cardAt)
    }

    /// When the whole act is off stage: the last leg has landed and, if a card
    /// rode along, it has had its read. The decision UI born of this action —
    /// the buy prompt, an auction the landing opened — waits for this moment
    /// (GameStore turns it into a holdUntil date the dock and the well share).
    static func curtain(_ legs: [MoveLeg], boardSize: Int, hasCard: Bool,
                        lead: Double = diceLead) -> Double {
        let (starts, cardAt) = timeline(legs, boardSize: boardSize, hasCard: hasCard, lead: lead)
        var end = zip(starts, legs)
            .map { $0 + legDuration($1, boardSize: boardSize) }
            .max() ?? 0
        if let cardAt { end = max(end, cardAt + cardHold) }
        return end
    }

    /// When the money this act carries is allowed to move: the moment the
    /// piece is standing on the square that caused it. That is the end of the
    /// last leg — a breath after the landing thump, so it reads as a thump
    /// and then a ka-ching — or, for a card that pays or charges without
    /// sending the piece anywhere, a read after the card has turned over.
    /// The rent on a hotel is the surprise; it must not beat the piece there.
    static func payday(_ legs: [MoveLeg], boardSize: Int, hasCard: Bool,
                       lead: Double = diceLead) -> Double {
        let (starts, cardAt) = timeline(legs, boardSize: boardSize, hasCard: hasCard, lead: lead)
        var lastEnd = 0.0
        if let start = starts.last, let leg = legs.last {
            lastEnd = start + legDuration(leg, boardSize: boardSize)
        }
        // A card with no leg of its own is revealed after the walk; its money
        // waits for the read. A card that moved the piece is already behind
        // the last leg, which is where its money lands.
        if hasCard, let cardAt, cardAt >= lastEnd {
            return min(cardAt + cardRead, moneyCap)
        }
        return min(lastEnd, moneyCap)
    }
}
