package com.moneymove.game

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The small pieces of table arithmetic the Android dock now does for itself,
 * each checked against the rule it is copying.
 *
 * None of these is hard, and that is the danger: a paddle that offers a bid
 * the server then refuses, or a clock that reads 0 while the turn is still
 * live, looks fine in every screenshot and is only ever caught by a player
 * with money on the line. The expectations are the server's own
 * (server/game.js `bid()`) and iOS's (ChatOverlays.swift), not this file's
 * opinion of them.
 */
class TableRulesTest {

    // ── auctions ────────────────────────────────────────────────────────────

    @Test
    fun `an opening bid starts at ten and every raise is ten more`() {
        // server/game.js: `const min = a.bid === 0 ? 10 : a.bid + 10`
        assertEquals(10, AuctionState(bid = 0).nextBid)
        assertEquals(130, AuctionState(bid = 120, leader = "a").nextBid)
    }

    @Test
    fun `the leader can spend the bid already sitting in escrow`() {
        // server/game.js: `available = p.money + (a.leader === id ? a.bid : 0)`
        val a = AuctionState(bid = 200, leader = "lead", inRace = listOf("lead", "other"))
        assertEquals(250, a.purse("lead", cash = 50))
        assertEquals(50, a.purse("other", cash = 50))
    }

    @Test
    fun `the paddles never offer a bid the server would refuse`() {
        // iOS and the web both offer [next, next+40, next+90] and drop what
        // the purse cannot cover — a paddle that comes back "Not enough
        // money" is a tap wasted while the clock runs.
        val a = AuctionState(bid = 100, leader = "x")
        assertEquals(listOf(110, 150, 200), a.steps(purse = 500))
        assertEquals(listOf(110, 150), a.steps(purse = 199))
        assertEquals(listOf(110), a.steps(purse = 110))
        assertEquals(emptyList<Int>(), a.steps(purse = 109))
    }

    @Test
    fun `a bid resets the countdown window to twelve seconds`() {
        assertEquals(20.0, AuctionState(bid = 0).windowSeconds, 0.0)
        assertEquals(12.0, AuctionState(bid = 10, leader = "a").windowSeconds, 0.0)
    }

    // ── the turn clock ──────────────────────────────────────────────────────

    @Test
    fun `the clock rounds up so the last second reads one`() {
        val now = 1_000_000L
        assertEquals(1, clockSecondsLeft(now + 200.0, now))
        assertEquals(60, clockSecondsLeft(now + 59_001.0, now))
    }

    @Test
    fun `no deadline draws no clock, and a passed one reads zero`() {
        assertNull(clockSecondsLeft(null))
        assertEquals(0, clockSecondsLeft(900.0, now = 1_000L))
    }

    @Test
    fun `a phone clock running behind is capped at the turn length`() {
        // Four minutes behind the server on a ninety-second turn would
        // otherwise read 5:30 left.
        val now = 1_000_000L
        assertEquals(90, clockSecondsLeft(now + 330_000.0, now, cap = 90))
        assertEquals(330, clockSecondsLeft(now + 330_000.0, now))
    }

    // ── the net-worth chart ─────────────────────────────────────────────────

    @Test
    fun `the turning point is where the winner took the lead for good`() {
        val history = listOf(
            WorthPoint(1, mapOf("w" to 100, "l" to 200)),
            WorthPoint(2, mapOf("w" to 300, "l" to 200)),
            WorthPoint(3, mapOf("w" to 150, "l" to 250)),
            WorthPoint(4, mapOf("w" to 400, "l" to 250)),
            WorthPoint(5, mapOf("w" to 600, "l" to 100)),
        )
        // Turn 2's lead was lost again at 3, so the game turned at 4.
        assertEquals(4, turningPoint(history, "w"))
    }

    @Test
    fun `leading from the first turn is not a turning point`() {
        val history = listOf(
            WorthPoint(1, mapOf("w" to 300, "l" to 200)),
            WorthPoint(2, mapOf("w" to 400, "l" to 200)),
            WorthPoint(3, mapOf("w" to 500, "l" to 100)),
        )
        assertNull(turningPoint(history, "w"))
    }

    @Test
    fun `too little history or no winner says nothing`() {
        val two = listOf(WorthPoint(1, mapOf("w" to 1)), WorthPoint(2, mapOf("w" to 2)))
        assertNull(turningPoint(two, "w"))
        assertNull(turningPoint(two + WorthPoint(3, mapOf("w" to 3)), null))
    }
}
