package com.moneymove.game

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What round 2 adds to the room state, read the way the table reads it
 * (docs/API-1.0.6.md, "Round 2"): an estate lot under the hammer (G5), an
 * auction-only table (G6) and a shuffled board that is drawn from the room's
 * own map and nothing else (G7). An older server sends none of it, and that
 * reads as today's game.
 */
class RoundTwoStateTest {

    private fun decode(json: String): GameState = MMJson.decodeFromString(GameState.serializer(), json)

    @Test
    fun `an estate lot says whose it is and how many follow`() {
        val s = decode(
            """{"status":"playing","auction":{"tile":6,"bid":0,"leader":null,"inRace":["a","b"],
               "endsAt":1791891901400,"estate":{"from":"Ravi","left":2}}}""",
        )
        val lot = s.auction!!
        assertEquals(EstateLot("Ravi", 2), lot.estate)
        assertEquals("Ravi's estate — 2 more after this", lot.estateLine)
        assertEquals("Ravi's estate — 1 more after this", lot.copy(estate = EstateLot("Ravi", 1)).estateLine)
        assertEquals("Ravi's estate — the last lot", lot.copy(estate = EstateLot("Ravi", 0)).estateLine)
    }

    @Test
    fun `an ordinary auction, or one from an older server, is no estate`() {
        val now = decode("""{"status":"playing","auction":{"tile":6,"bid":0,"inRace":[],"estate":null}}""")
        assertNull(now.auction!!.estate)
        assertNull(now.auction!!.estateLine)
        val old = decode("""{"status":"playing","auction":{"tile":6,"bid":0,"inRace":[]}}""")
        assertNull(old.auction!!.estateLine)
    }

    @Test
    fun `auction-only is a host's rule, never a Play-now or a cup table's`() {
        val on = GameSettings(auctionOnly = true, auction = true)
        assertTrue(GameState(status = "playing", settings = on).isAuctionOnly)
        assertFalse(GameState(status = "playing", settings = on, quick = true).isAuctionOnly)
        assertFalse(GameState(status = "playing", settings = on, cup = true).isAuctionOnly)
        assertFalse(GameState(status = "playing", settings = GameSettings()).isAuctionOnly)
        assertTrue(GameState().hostSetsRules)
    }

    @Test
    fun `the bankrupt-properties menu offers exactly the two values the server takes`() {
        assertEquals(listOf("release", "auction"), GameSettings.BANKRUPT_CHOICES.map { it.first })
        assertTrue(GameSettings(bankruptProperties = "auction").auctionsEstates)
        assertFalse(GameSettings(bankruptProperties = "release").auctionsEstates)
        assertFalse(GameSettings().auctionsEstates)
    }

    @Test
    fun `a shuffled board is keyed on its layout, not its id`() {
        val s = decode(
            """{"status":"playing","mapId":"classic",
               "map":{"id":"classic","uid":"classic~1a2q0ns","name":"Classic","size":40,"shuffled":true,
                      "tiles":[{"type":"start","name":"START","index":0},
                               {"type":"property","name":"San Francisco","group":"US","price":360,"index":1}],
                      "groups":{"US":[1,3]}}}""",
        )
        assertEquals("classic", s.map.id)
        assertEquals("classic~1a2q0ns", s.map.layoutKey)
        assertTrue(s.map.isShuffled)
        // The deed on square 1 is the one the room says is there.
        assertEquals("San Francisco", s.map.tiles[1].name)
        assertEquals(360, s.map.tiles[1].price)
        assertEquals(listOf(1, 3), s.map.groups?.get("US"))
    }

    @Test
    fun `the printed board, and an older server's, read as unshuffled`() {
        val lobby = decode("""{"status":"lobby","map":{"id":"classic","uid":"classic","shuffled":false}}""")
        assertEquals("classic", lobby.map.layoutKey)
        assertFalse(lobby.map.isShuffled)
        val old = decode("""{"status":"playing","map":{"id":"europe"}}""")
        assertEquals("europe", old.map.layoutKey)
        assertFalse(old.map.isShuffled)
        // A new shuffle is a new key, so nothing cached for the last one survives it.
        val again = decode("""{"status":"playing","map":{"id":"classic","uid":"classic~9z","shuffled":true}}""")
        assertTrue(again.map.layoutKey != decode("""{"map":{"id":"classic","uid":"classic~1a2q0ns"}}""").map.layoutKey)
    }
}
