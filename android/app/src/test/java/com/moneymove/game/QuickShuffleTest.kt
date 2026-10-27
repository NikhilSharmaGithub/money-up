package com.moneymove.game

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 1.0.8: a Play-now table rolls the shuffled board — about one table in
 * three — and its host may change it (docs/API-1.0.6.md). The roll's phrases
 * gain a ninth, last, so the 1.0.7 apps already in the stores keep every
 * chip they know on the right rule; this build reads a ninth, and still
 * reads a 1.0.7 server's eight. The rule is played and shown at a Play-now
 * table that has it on, and never at a cup.
 */
class QuickShuffleTest {

    private fun decode(json: String): GameState = MMJson.decodeFromString(GameState.serializer(), json)

    /** quickRollParts() on a 1.0.8 server, phrase for phrase. */
    private val nine = listOf(
        "Japan", "$1,500 to start", "x2 rent on full sets on", "vacation cash off", "auctions on",
        "no rent while jailed off", "even build on", "bankrupt streets back to the bank", "shuffled board on",
    )

    /** The same table on a 1.0.7 server, which has no shuffle to roll. */
    private val eight = nine.dropLast(1)

    // ── the roll ────────────────────────────────────────────────────────────

    @Test
    fun `the shuffle is the ninth phrase, after every key a 1_0_7 app knows`() {
        assertEquals(9, QuickRoll.PART_KEYS.size)
        assertEquals("shuffleBoard", QuickRoll.PART_KEYS.last())
        // The eight before it stay exactly where 1.0.7 put them.
        assertEquals(
            listOf(
                "mapId", "startingCash", "x2rent", "vacationCash", "auction", "noRentInPrison", "evenBuild",
                "bankruptProperties",
            ),
            QuickRoll.PART_KEYS.take(8),
        )
        val roll = QuickRoll(parts = nine, edited = listOf("shuffleBoard"))
        assertEquals("shuffleBoard", roll.partKey(8))
        assertTrue(roll.isEdited(8))
        assertFalse(roll.isEdited(7))
    }

    @Test
    fun `an older server's eight phrases still ring the right chips, and a tenth is safe`() {
        val roll = QuickRoll(parts = eight, edited = listOf("bankruptProperties", "evenBuild"))
        assertEquals(8, roll.parts!!.size)
        assertEquals("bankruptProperties", roll.partKey(7))
        assertTrue(roll.isEdited(7))
        assertTrue(roll.isEdited(6))
        assertFalse(roll.isEdited(8))
        // Whatever a newer server adds after the shuffle has no key here:
        // a chip without a ring, never a crash.
        assertNull(QuickRoll(parts = nine + "something new").partKey(9))
        assertFalse(QuickRoll(parts = nine + "something new", edited = listOf("x")).isEdited(9))
        assertNull(roll.partKey(-1))
    }

    @Test
    fun `a 1_0_8 play-now lobby decodes with the shuffle rolled and offered to its host`() {
        val s = decode(
            """{"id":"QK1","status":"lobby","quick":true,"settings":{"maxPlayers":4,"shuffleBoard":true},
               "quickLobby":{"phase":"ready","editable":["startingCash","x2rent","vacationCash","auction",
                 "noRentInPrison","evenBuild","bankruptProperties","shuffleBoard","mapId"]},
               "quickRoll":{"at":1792012201909,"keys":["startingCash","shuffleBoard","mapId"],
                 "parts":${nine.joinToString(",", "[", "]") { "\"$it\"" }},"edited":[]}}""",
        )
        assertTrue(s.quickLobby!!.mayEdit("shuffleBoard"))
        assertTrue(s.hasShuffleRule)
        assertTrue(s.shufflesBoard)
        assertEquals("shuffled board on", s.quickRoll!!.parts!!.last())
        // Switched off by the host, it is still the table's rule to have.
        val off = s.copy(settings = s.settings.copy(shuffleBoard = false))
        assertTrue(off.hasShuffleRule)
        assertFalse(off.shufflesBoard)
    }

    @Test
    fun `a 1_0_7 server's play-now table has no shuffle to show, a host's table always does`() {
        val old = decode(
            """{"id":"QK2","status":"lobby","quick":true,"settings":{"maxPlayers":4},
               "quickLobby":{"phase":"ready","editable":["startingCash","x2rent","vacationCash","auction",
                 "noRentInPrison","evenBuild","bankruptProperties","mapId"]},
               "quickRoll":{"keys":["startingCash","bankruptProperties"],
                 "parts":${eight.joinToString(",", "[", "]") { "\"$it\"" }}}}""",
        )
        assertFalse(old.hasShuffleRule)
        assertFalse(old.shufflesBoard)
        assertTrue(GameState(status = "lobby").hasShuffleRule)
        assertTrue(GameState(status = "lobby", settings = GameSettings(shuffleBoard = true)).shufflesBoard)
    }

    @Test
    fun `a cup table never shuffles and never offers it, whatever the field says`() {
        val cup = GameState(status = "lobby", cup = true, settings = GameSettings(shuffleBoard = true))
        assertFalse(cup.shufflesBoard)
        assertFalse(cup.hasShuffleRule)
    }

    // ── the rules sheet ─────────────────────────────────────────────────────

    private fun lines(state: GameState): Map<String, TableRuleLine> =
        tableRuleSections(state).flatMap { it.lines }.associateBy { it.title }

    @Test
    fun `the rules sheet lists the shuffle at a play-now table that rolled it on`() {
        val lobby = GameState(
            status = "lobby", quick = true, settings = GameSettings(shuffleBoard = true),
            map = MapData(id = "japan", name = "Japan", uid = "japan"),
        )
        val before = lines(lobby).getValue("Shuffled board")
        assertEquals("On", before.value)
        assertEquals(true, before.on)
        assertTrue(before.detail.startsWith("At the start"))
        // Dealt: the board itself says what happened.
        val dealt = lines(lobby.copy(status = "playing", map = lobby.map.copy(uid = "japan~7f3k", shuffled = true)))
        assertEquals("On", dealt.getValue("Shuffled board").value)
        assertTrue(dealt.getValue("Shuffled board").detail.startsWith("The colour sets sit on new squares"))
        assertTrue(dealt.getValue("Board").detail.isNotBlank())
        // Rolled off, it reads off, as at any table.
        val off = lines(lobby.copy(settings = GameSettings(shuffleBoard = false)))
        assertEquals("Off", off.getValue("Shuffled board").value)
    }

    @Test
    fun `the rules sheet never says a cup table shuffles`() {
        val cup = GameState(
            status = "playing", cup = true, settings = GameSettings(shuffleBoard = true),
            map = MapData(id = "classic", name = "Classic"),
        )
        val l = lines(cup).getValue("Shuffled board")
        assertEquals("Off", l.value)
        assertEquals(false, l.on)
    }

    // ── the deal ────────────────────────────────────────────────────────────

    @Test
    fun `the shuffled-board word is for the deal this phone watched, and only that`() {
        val lobby = GameState(id = "QK1", status = "lobby", quick = true, settings = GameSettings(shuffleBoard = true))
        val dealt = lobby.copy(status = "playing", map = MapData(id = "japan", uid = "japan~7f3k", shuffled = true))
        assertTrue(dealt.dealtShuffledAfter(lobby))
        // Walking in on a game already going, or coming back to one.
        assertFalse(dealt.dealtShuffledAfter(null))
        assertFalse(dealt.dealtShuffledAfter(dealt))
        // Another table's lobby is not this deal.
        assertFalse(dealt.dealtShuffledAfter(lobby.copy(id = "QK9")))
        // A board dealt as printed has nothing to say.
        assertFalse(dealt.copy(map = dealt.map.copy(shuffled = false)).dealtShuffledAfter(lobby))
    }
}
