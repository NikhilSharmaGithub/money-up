package com.moneymove.game

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What 1.0.7 (round 3) adds to the room state, read the way the table reads
 * it (docs/API-1.0.6.md, "Round 3"): the third bankrupt-properties value and
 * its words, the question a bankrupt player is asked, the same rule at
 * Play-now tables, "Bot skill" only where there is a house, and what the
 * auction card works out for itself — where an estate sale has got to, and
 * the rent line on its little deed. An older server sends none of it, and
 * that reads as 1.0.6's game.
 */
class RoundThreeStateTest {

    private fun decode(json: String): GameState = MMJson.decodeFromString(GameState.serializer(), json)

    private fun tree(json: String): JsonObject = MMJson.parseToJsonElement(json).jsonObject

    // ── the setting ─────────────────────────────────────────────────────────

    @Test
    fun `the three values carry the contract's words`() {
        assertEquals(listOf("release", "auction", "choose"), EstateRule.entries.map { it.wire })
        assertEquals(listOf("Back to the bank", "Auction them", "Player decides"), EstateRule.entries.map { it.label })
        assertEquals(listOf("Back to the bank", "Auctioned", "Player decides"), EstateRule.entries.map { it.sheet })
        assertEquals(
            "The player who goes bankrupt picks: back to the bank, or auction.",
            EstateRule.CHOOSE.explain,
        )
        // Every mark is one the app can draw.
        for (rule in EstateRule.entries) assertTrue(rule.glyph, Art.has(rule.glyph))
    }

    @Test
    fun `anything else, and an older server's silence, is the bank's`() {
        assertEquals(EstateRule.CHOOSE, GameSettings(bankruptProperties = "choose").estateRule)
        assertEquals(EstateRule.RELEASE, GameSettings(bankruptProperties = "decide").estateRule)
        assertEquals(EstateRule.RELEASE, GameSettings().estateRule)
        assertFalse(GameSettings(bankruptProperties = "choose").auctionsEstates)
    }

    @Test
    fun `a play-now table plays what it rolled, a cup table always the bank`() {
        val choose = GameSettings(bankruptProperties = "choose")
        assertEquals(EstateRule.CHOOSE, GameState(status = "playing", settings = choose).estateRule)
        assertEquals(EstateRule.CHOOSE, GameState(status = "playing", settings = choose, quick = true).estateRule)
        assertEquals(EstateRule.RELEASE, GameState(status = "playing", settings = choose, cup = true).estateRule)
    }

    @Test
    fun `the rolled phrase for it is the last one, and a host's change rings it`() {
        assertEquals("bankruptProperties", QuickRoll.PART_KEYS.last())
        val roll = QuickRoll(
            parts = listOf(
                "Classic", "$1,500 to start", "x2 rent on full sets on", "vacation cash off", "auctions on",
                "no rent while jailed off", "even build on", "bankrupt player decides",
            ),
            edited = listOf("bankruptProperties"),
        )
        assertEquals("bankruptProperties", roll.partKey(7))
        assertTrue(roll.isEdited(7))
        assertFalse(roll.isEdited(6))
    }

    // ── the question ────────────────────────────────────────────────────────

    @Test
    fun `the question decodes, and reads as the table says it`() {
        val s = decode(
            """{"status":"playing","bankruptChoice":{"playerId":"u_2xw","name":"Ravi",
               "properties":[11,13,14,21],"endsAt":1792012201909}}""",
        )
        val c = s.bankruptChoice!!
        assertEquals("u_2xw", c.playerId)
        assertEquals(listOf(11, 13, 14, 21), c.properties)
        assertEquals(1792012201909.0, c.endsAt!!, 0.0)
        assertEquals("Ravi is deciding what happens to their streets…", c.decidingLine)
        assertEquals("Waiting for Ravi to decide about their properties", c.holdLine)
        assertEquals("their 4 properties", c.theirStreets)
        assertEquals("your 4 properties", c.yourStreets)
        assertEquals("their property", c.copy(properties = listOf(5)).theirStreets)
    }

    @Test
    fun `nobody being asked, or an older server, is no question`() {
        assertNull(decode("""{"status":"playing","bankruptChoice":null}""").bankruptChoice)
        assertNull(decode("""{"status":"playing"}""").bankruptChoice)
    }

    @Test
    fun `the question rides patches like any other field`() {
        val asked = """{"playerId":"u_2xw","name":"Ravi","properties":[6],"endsAt":1792012201909}"""
        val start = tree("""{"status":"playing","version":4,"bankruptChoice":null}""")
        val opened = StatePatch.apply(start, tree("""{"s":{"bankruptChoice":$asked,"version":5}}"""))!!
        assertNotNull(MMJson.decodeFromJsonElement(GameState.serializer(), opened).bankruptChoice)
        val answered = StatePatch.apply(opened, tree("""{"s":{"bankruptChoice":null,"version":6}}"""))!!
        assertNull(MMJson.decodeFromJsonElement(GameState.serializer(), answered).bankruptChoice)
    }

    // ── bot skill, only with bots ───────────────────────────────────────────

    @Test
    fun `bot skill shows only where there is a house to set`() {
        val person = PlayerState(id = "u_a", name = "Asha")
        val bot = PlayerState(id = "bot:1", name = "Robo", isBot = true)
        // A private lobby of people: nothing for it to set.
        assertFalse(GameState(status = "lobby", players = listOf(person)).showsBotSkill)
        // "Add bot" seats one: there it is — and gone again with it.
        assertTrue(GameState(status = "lobby", players = listOf(person, bot)).showsBotSkill)
        // "Allow bots" will fill the empty chairs at the start.
        assertTrue(GameState(status = "lobby", players = listOf(person), settings = GameSettings(allowBots = true)).showsBotSkill)
        // Mid-game it is the seats that count.
        assertFalse(GameState(status = "playing", players = listOf(person), settings = GameSettings(allowBots = true)).showsBotSkill)
        assertTrue(GameState(status = "playing", players = listOf(person, bot)).showsBotSkill)
        // Never at a Play-now table, whose house passes for people, nor a cup's.
        assertFalse(GameState(status = "lobby", quick = true, players = listOf(person, bot)).showsBotSkill)
        assertFalse(GameState(status = "lobby", cup = true, players = listOf(person, bot)).showsBotSkill)
    }

    @Test
    fun `the rules sheet says the player decides, and hides the house when there is none`() {
        val choose = GameSettings(bankruptProperties = "choose", botLevel = "hard")
        val people = GameState(status = "playing", settings = choose, map = MapData(id = "classic", name = "Classic"))
        val lines = tableRuleSections(people).flatMap { it.lines }.associateBy { it.title }
        assertEquals("Player decides", lines.getValue("Bankrupt properties").value)
        assertTrue(lines.getValue("Bankrupt properties").detail.startsWith("The player who goes bankrupt picks"))
        assertNull(lines["Bot skill"])
        val withBot = people.copy(players = listOf(PlayerState(id = "bot:1", isBot = true)))
        assertEquals("Hard", tableRuleSections(withBot).flatMap { it.lines }.first { it.title == "Bot skill" }.value)
    }

    // ── the auction card's own arithmetic ───────────────────────────────────

    @Test
    fun `an estate seen going says which lot this is and what follows`() {
        val known = listOf(21, 6, 14, 11)
        val first = EstateProgress.of(tile = 6, left = 3, known = known, announced = null)
        assertEquals(EstateProgress(1, 4, listOf(11, 14, 21)), first)
        assertEquals("Lot 1 of 4", first.label)
        val second = EstateProgress.of(tile = 11, left = 2, known = known, announced = 4)
        assertEquals(EstateProgress(2, 4, listOf(14, 21)), second)
        assertEquals("Lot 4 of 4", EstateProgress.of(21, 0, known, null).label)
        assertEquals(emptyList<Int>(), EstateProgress.of(21, 0, known, null).upNext)
    }

    @Test
    fun `a phone that walked in mid-sale counts from the log, or not at all`() {
        assertEquals(EstateProgress(3, 4, emptyList()), EstateProgress.of(14, 1, known = null, announced = 4))
        val blind = EstateProgress.of(14, 1, known = null, announced = null)
        assertNull(blind.lot)
        assertNull(blind.label)
        // A lot this phone never saw in the estate falls back the same way.
        assertEquals(EstateProgress(2, 3, emptyList()), EstateProgress.of(9, 1, known = listOf(1, 3), announced = 3))
    }

    @Test
    fun `the sale's size is read off its announcement`() {
        val log = listOf(
            LogLine("Asha's 2 properties go to auction, one at a time", "auction", 1.0),
            LogLine("Ravi went bankrupt", "bankrupt", 2.0),
            LogLine("Ravi chose to auction their properties", "bankrupt", 3.0),
            LogLine("Ravi's 5 properties go to auction, one at a time", "auction", 4.0),
            LogLine("Rome goes to auction! Starting bid \$10", "auction", 5.0),
            LogLine("Dev's 1 property goes to auction, one at a time", "auction", 6.0),
        )
        assertEquals(5, EstateProgress.announced(log, "Ravi"))
        assertEquals(2, EstateProgress.announced(log, "Asha"))
        assertEquals(1, EstateProgress.announced(log, "Dev"))
        assertNull(EstateProgress.announced(log, "Hana"))
        assertNull(EstateProgress.announced(log, ""))
    }

    @Test
    fun `a plain bankruptcy says where the streets go only when there are some`() {
        assertEquals(
            "You'll be asked what happens to your properties. You are out of the game.",
            bankruptOutLine(EstateRule.CHOOSE, owned = 3),
        )
        assertEquals("Your properties go back to the bank. You are out of the game.", bankruptOutLine(EstateRule.RELEASE, 1))
        // Nothing owned: nothing is asked and nothing goes anywhere.
        for (rule in EstateRule.entries) assertEquals("You are out of the game.", bankruptOutLine(rule, owned = 0))
    }

    @Test
    fun `the deed's rent line says what the lot is worth`() {
        val street = TileData(type = "property", name = "Milan", price = 220, rent = listOf(18, 90, 250, 700, 875, 1050))
        assertEquals("Rent \$18 · hotel \$1,050", street.rentLine)
        assertEquals("Rent \$25–\$200", TileData(type = "airport", name = "JFK", price = 200).rentLine)
        assertEquals("Rent 4× or 10× the dice", TileData(type = "utility", name = "Water", price = 150).rentLine)
        assertNull(TileData(type = "tax", name = "Income tax").rentLine)
    }
}
