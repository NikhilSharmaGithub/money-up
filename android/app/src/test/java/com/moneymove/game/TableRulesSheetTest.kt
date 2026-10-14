package com.moneymove.game

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "This table's rules" (round 2, G4) says what `state.settings` says, in
 * words, for everybody at the table — and says the three new rules the way
 * the server plays them: at their defaults on a Play-now or a cup table,
 * whatever the fields hold (docs/API-1.0.6.md, "Three more lobby settings").
 */
class TableRulesSheetTest {

    private fun lines(state: GameState): Map<String, TableRuleLine> =
        tableRuleSections(state).flatMap { it.lines }.associateBy { it.title }

    /** A house player in a seat — what makes "Bot skill" mean anything (1.0.7, H4). */
    private val bot = PlayerState(id = "bot:1", name = "Robo", isBot = true)

    private fun state(
        settings: GameSettings,
        quick: Boolean? = null,
        cup: Boolean? = null,
        status: String = "playing",
        players: List<PlayerState> = emptyList(),
    ) = GameState(
        status = status, quick = quick, cup = cup, settings = settings,
        map = MapData(id = "classic", name = "Classic"), players = players,
    )

    @Test
    fun `every rule the contract lists is on the sheet`() {
        val titles = lines(state(GameSettings(), players = listOf(bot))).keys
        for (t in listOf(
            "Board", "Starting cash", "Double rent on full sets", "Vacation cash", "Auctions",
            "No rent while in prison", "Mortgages", "Even building", "Turn clock", "Bot skill",
            "Game length", "Bankrupt properties", "Auction-only", "Shuffled board", "Teams", "Table", "Prison",
        )) assertTrue(t, t in titles)
        // Every mark is one the app can draw.
        for (line in tableRuleSections(state(GameSettings(), players = listOf(bot))).flatMap { it.lines }) {
            assertTrue(line.glyph, Art.has(line.glyph) || line.glyph == "timer")
        }
    }

    @Test
    fun `a host's table reads its settings as set`() {
        val l = lines(
            state(
                GameSettings(
                    startingCash = 1500, x2rent = true, vacationCash = false, auction = true,
                    noRentInPrison = true, mortgage = false, evenBuild = true, turnSeconds = 60,
                    botLevel = "hard", timeLimit = 30, teams = 2, isPrivate = false,
                    bankruptProperties = "auction", auctionOnly = true, shuffleBoard = true,
                ),
                players = listOf(bot),
            ),
        )
        assertEquals("Classic", l.getValue("Board").value)
        assertEquals("$1,500", l.getValue("Starting cash").value)
        assertEquals("On", l.getValue("Double rent on full sets").value)
        assertEquals(false, l.getValue("Vacation cash").on)
        assertEquals("Off", l.getValue("Mortgages").value)
        assertEquals("60 seconds", l.getValue("Turn clock").value)
        assertEquals("Hard", l.getValue("Bot skill").value)
        assertEquals("30 min", l.getValue("Game length").value)
        assertEquals("2 teams", l.getValue("Teams").value)
        assertEquals("Public", l.getValue("Table").value)
        assertEquals("Auctioned", l.getValue("Bankrupt properties").value)
        assertEquals("On", l.getValue("Auction-only").value)
        assertEquals("On", l.getValue("Shuffled board").value)
    }

    @Test
    fun `defaults read as the settings sheet reads them`() {
        val l = lines(state(GameSettings(), players = listOf(bot)))
        assertEquals("Back to the bank", l.getValue("Bankrupt properties").value)
        assertEquals("Off", l.getValue("Auction-only").value)
        assertEquals("Off", l.getValue("Shuffled board").value)
        assertEquals("On", l.getValue("Auctions").value)
        assertEquals("Private", l.getValue("Table").value)
        assertEquals("90 seconds", l.getValue("Turn clock").value)
        assertEquals("Unlimited", l.getValue("Game length").value)
        assertEquals("Normal", l.getValue("Bot skill").value)
        assertEquals("Off", l.getValue("Teams").value)
    }

    @Test
    fun `auction-only reads auctions on, even from a push that says otherwise`() {
        val l = lines(state(GameSettings(auction = false, auctionOnly = true)))
        assertEquals("On", l.getValue("Auctions").value)
    }

    @Test
    fun `a play-now or cup table plays auction-only and the shuffle at their defaults and hides the house`() {
        val forced = GameSettings(bankruptProperties = "auction", auctionOnly = true, shuffleBoard = true, botLevel = "hard")
        for ((quick, cup, table) in listOf(Triple(true, null, "Play now"), Triple(null, true, "Cup match"))) {
            val l = lines(state(forced, quick = quick, cup = cup, players = listOf(bot)))
            assertEquals("Off", l.getValue("Auction-only").value)
            assertEquals("Off", l.getValue("Shuffled board").value)
            assertEquals(table, l.getValue("Table").value)
            assertNull(l["Bot skill"])
        }
        // From 1.0.7 a Play-now table rolls and plays its bankrupt rule; a cup table never does.
        assertEquals("Auctioned", lines(state(forced, quick = true)).getValue("Bankrupt properties").value)
        assertEquals("Back to the bank", lines(state(forced, cup = true)).getValue("Bankrupt properties").value)
    }

    @Test
    fun `a shuffled game says so on the board itself`() {
        val s = GameState(
            status = "playing", settings = GameSettings(shuffleBoard = true),
            map = MapData(id = "classic", name = "Classic", uid = "classic~1a2q0ns", shuffled = true),
        )
        val l = lines(s)
        assertTrue(l.getValue("Board").detail.isNotBlank())
        assertTrue(l.getValue("Shuffled board").detail.startsWith("The colour sets sit on new squares"))
        // The lobby shows the printed board, with the shuffle still to come.
        val lobby = lines(s.copy(status = "lobby", map = s.map.copy(uid = "classic", shuffled = false)))
        assertTrue(lobby.getValue("Board").detail.isBlank())
        assertTrue(lobby.getValue("Shuffled board").detail.startsWith("At the start"))
    }

    @Test
    fun `the prison rule says the third miss walks out free`() {
        val prison = lines(state(GameSettings())).getValue("Prison").detail
        assertTrue(prison.contains("\$50"))
        assertTrue(prison.contains("third roll still misses, you walk out free"))
        assertFalse(prison.contains("pay anyway"))
    }

    @Test
    fun `the subtitle says who set the rules and whether they can still move`() {
        assertEquals("Rolled by Play now.", tableRulesSubtitle(state(GameSettings(), quick = true)))
        assertEquals("Set by the cup.", tableRulesSubtitle(state(GameSettings(), cup = true)))
        assertEquals("The host can change these until the game starts.", tableRulesSubtitle(state(GameSettings(), status = "lobby")))
        assertEquals("Locked for this game.", tableRulesSubtitle(state(GameSettings())))
    }

    @Test
    fun `the three new settings decode, and an older server's absence reads as the defaults`() {
        val s = MMJson.decodeFromString(
            GameSettings.serializer(),
            """{"maxPlayers":4,"bankruptProperties":"auction","auctionOnly":true,"shuffleBoard":true}""",
        )
        assertTrue(s.auctionsEstates)
        assertEquals(true, s.auctionOnly)
        assertEquals(true, s.shuffleBoard)
        val old = MMJson.decodeFromString(GameSettings.serializer(), """{"maxPlayers":4}""")
        assertFalse(old.auctionsEstates)
        assertNull(old.auctionOnly)
        assertNull(old.shuffleBoard)
    }
}
