package com.moneymove.game

import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 1.0.6 at the table: bot skill, quick chat, watching from the rail, the game
 * clock and the result card — read the way docs/API-1.0.6.md (part two)
 * writes them, and the way an older server writes them, which is not at all.
 */
class TablesTest {

    private fun obj(text: String): JsonObject = MMJson.parseToJsonElement(text) as JsonObject

    private fun state(text: String): GameState = MMJson.decodeFromString(GameState.serializer(), text)

    // ── F3 bot skill and F9 game length, as settings ────────────────────────

    @Test
    fun `settings carry the bot skill and the game length`() {
        val s = MMJson.decodeFromString(GameSettings.serializer(), """{"botLevel":"hard","timeLimit":30}""")
        assertEquals(BotSkill.HARD, s.botSkill)
        assertEquals(30, s.gameMinutes)
    }

    @Test
    fun `an older server's settings play normal bots with no clock`() {
        val s = MMJson.decodeFromString(GameSettings.serializer(), "{}")
        assertEquals(BotSkill.NORMAL, s.botSkill)
        assertEquals(0, s.gameMinutes)
        // A word this build has never heard, or a length the server would
        // never have stored, reads as the default rather than as a crash.
        assertEquals(BotSkill.NORMAL, BotSkill.of("impossible"))
        assertEquals(0, GameSettings(timeLimit = 25).gameMinutes)
    }

    @Test
    fun `the lobby offers exactly the server's lengths and skills`() {
        assertEquals(listOf(0, 20, 30, 45, 60), GameSettings.GAME_LENGTHS)
        assertEquals("Unlimited", GameSettings.gameLengthLabel(0))
        assertEquals("45 min", GameSettings.gameLengthLabel(45))
        assertEquals(listOf("easy", "normal", "hard"), BotSkill.entries.map { it.wire })
        assertEquals(listOf("Easy", "Normal", "Hard"), BotSkill.entries.map { it.label })
    }

    // ── F9 the game clock ───────────────────────────────────────────────────

    @Test
    fun `a timed table's clock is its own, apart from the turn's`() {
        val s = state(
            """{"id":"xtex8","status":"playing","endsAt":1791882600000,"timeUp":false,"endReason":null,
               "startedAt":1791880800000,"turnCount":37,"spectators":2,
               "turn":{"playerId":"a","phase":"roll","endsAt":1791880890000}}""",
        )
        assertEquals(1791882600000.0, s.gameClock!!, 0.0)
        assertEquals(1791880890000.0, s.turn?.endsAt!!, 0.0)
        assertEquals(37, s.turnCount)
        assertEquals(2, s.watcherCount)
        assertFalse(s.endedOnClock)
    }

    @Test
    fun `a game the clock decided says so, and its clock stops`() {
        val s = state("""{"status":"ended","endsAt":1791882600000,"timeUp":true,"endReason":"time"}""")
        assertTrue(s.endedOnClock)
        assertNull(s.gameClock)
        assertFalse(state("""{"status":"ended","endReason":"last"}""").endedOnClock)
    }

    @Test
    fun `an older server's state has no clock and nobody watching`() {
        val s = state("""{"status":"playing"}""")
        assertNull(s.gameClock)
        assertNull(s.timeUp)
        assertEquals(0, s.watcherCount)
        assertFalse(s.endedOnClock)
    }

    @Test
    fun `the clock reads minutes and seconds, then the last turn`() {
        assertEquals("02:05", gameClockLabel(125, timeUp = false))
        assertEquals("60:00", gameClockLabel(3600, timeUp = false))
        assertEquals("00:01", gameClockLabel(1, timeUp = false))
        assertEquals(LAST_TURN, gameClockLabel(0, timeUp = false))
        // The server's word beats this phone's arithmetic.
        assertEquals(LAST_TURN, gameClockLabel(300, timeUp = true))
        assertFalse(gameClockUrgent(121, timeUp = false))
        assertTrue(gameClockUrgent(120, timeUp = false))
        assertTrue(gameClockUrgent(900, timeUp = true))
    }

    @Test
    fun `the clock and the watchers survive a patch`() {
        val mirror = StateMirror()
        mirror.adopt(
            obj(
                """{"id":"xtex8","status":"playing","version":7,"endsAt":1791882600000,"timeUp":false,
                   "spectators":0,"players":[],"log":[],"chat":[]}""",
            ),
        )
        val step = mirror.apply(obj("""{"from":7,"v":8,"patch":{"s":{"timeUp":true,"spectators":3}}}"""))
        val s = MMJson.decodeFromJsonElement(GameState.serializer(), (step as StateMirror.Step.State).json)
        assertEquals(true, s.timeUp)
        assertEquals(3, s.watcherCount)
        assertEquals(1791882600000.0, s.endsAt!!, 0.0)
    }

    // ── F7 watch live ───────────────────────────────────────────────────────

    @Test
    fun `the live list reads as the server writes it`() {
        val view = MMJson.decodeFromString(
            LiveGamesView.serializer(),
            """{"games":[{"roomId":"xtex8","mapId":"classic","mapName":"Classic",
                 "players":[
                   {"name":"Asha","flag":"🇮🇳","color":"#4ade80","avatar":"😎","level":4,"bot":false,"out":false},
                   {"name":"Ravi","flag":"","color":"#60a5fa","avatar":"","level":12,"bot":true,"out":false},
                   {"name":"Meera","flag":"","color":"#f472b6","avatar":"","level":2,"bot":false,"out":true},
                   {"name":"Kabir","flag":"","color":"#fbbf24","avatar":"","level":7,"bot":false,"out":false},
                   {"name":"Zoya","flag":"","color":"#a78bfa","avatar":"","level":9,"bot":false,"out":false}],
                 "turnCount":37,"startedAt":1791880800000,"endsAt":1791882600000,"watching":2}]}""",
        )
        val game = view.games.single()
        assertEquals("xtex8", game.roomId)
        assertEquals(4, game.standing.size)
        // The one who is out is left off; four still in is two names and the rest.
        assertEquals("Asha, Ravi and 2 more", game.namesLine())
        assertEquals(30, game.minutesLeft(now = 1791880800000L))
        assertEquals(0, game.minutesLeft(now = 1791882700000L))
        assertEquals(2, game.watching)
    }

    @Test
    fun `an untimed live game has no minutes, and nobody playing is an empty list`() {
        val game = LiveGame(roomId = "a", players = listOf(LivePlayer(name = "Asha"), LivePlayer(name = "Ravi")))
        assertNull(game.minutesLeft())
        assertEquals("Asha, Ravi", game.namesLine())
        assertTrue(MMJson.decodeFromString(LiveGamesView.serializer(), """{"games":[]}""").games.isEmpty())
        assertTrue(MMJson.decodeFromString(LiveGamesView.serializer(), "{}").games.isEmpty())
    }

    // ── F4 quick chat ───────────────────────────────────────────────────────

    @Test
    fun `quick chat says the eight phrases every client says`() {
        assertEquals(
            listOf("Good luck!", "Nice move!", "Want to trade?", "Ouch!", "So close!", "Hurry up!", "Thanks!", "GG"),
            QuickChat.PHRASES,
        )
        // Every phrase fits a chat line the server keeps whole.
        assertTrue(QuickChat.PHRASES.all { it.length <= 200 })
    }

    @Test
    fun `quick chat waits a breath between phrases`() {
        val sentAt = 10_000L
        val readyAt = sentAt + QuickChat.COOLDOWN_MS
        assertFalse(QuickChat.ready(readyAt, sentAt + 200))
        assertTrue(QuickChat.ready(readyAt, readyAt))
        assertTrue(QuickChat.ready(0L, sentAt))
    }

    // ── F10 the result card ─────────────────────────────────────────────────

    private val ended = """
        {"id":"r1","status":"ended","endReason":"time","timeUp":true,
         "map":{"name":"Classic"},
         "winner":{"id":"a1","name":"Asha","color":"#4ade80"},
         "players":[
           {"id":"me","name":"Nikhil","color":"#e3a93c","netWorth":3100,"flag":"🇮🇳","avatar":"😎"},
           {"id":"a1","name":"Asha","color":"#4ade80","netWorth":4200},
           {"id":"bot:1","name":"Ravi","color":"#60a5fa","netWorth":900,"isBot":true},
           {"id":"a2","name":"Meera","color":"#f472b6","netWorth":0,"bankrupt":true}
         ],"log":[],"chat":[]}
    """.trimIndent()

    @Test
    fun `the card puts the podium in the standings' order and finds your place`() {
        val card = ResultCardData.of(state(ended), isLocal = { it == "me" }, won = false, now = 0L)
        assertEquals("Classic", card.board)
        assertEquals("Asha", card.winner)
        assertEquals(listOf("Asha", "Nikhil", "Ravi"), card.podium.map { it.name })
        assertEquals(listOf(4200, 3100, 900), card.podium.map { it.worth })
        assertEquals(listOf(false, true, false), card.podium.map { it.mine })
        assertEquals("😎", card.podium[1].avatar)
        assertEquals(2, card.place)
        assertEquals(4, card.seats)
        assertTrue(card.timeUp)
        assertEquals("I finished 2nd of 4", card.placeLine)
    }

    @Test
    fun `the card says who won it, a team, or that you only watched`() {
        val s = state(ended)
        assertEquals("I won", ResultCardData.of(s, isLocal = { it == "a1" }, won = true).placeLine)
        val watched = ResultCardData.of(s, isLocal = { false }, won = false)
        assertNull(watched.place)
        assertEquals("Watched it live", watched.placeLine)
        // Somebody who watched cannot have won, whatever the caller thinks.
        assertFalse(ResultCardData.of(s, isLocal = { false }, won = true).won)
        val teams = s.copy(teamInfo = listOf(TeamInfo("Azure", "#60a5fa")), winningTeam = 0)
        val card = ResultCardData.of(teams, isLocal = { it == "me" }, won = true)
        assertEquals("Team Azure", card.winner)
        assertEquals("My team won", card.placeLine)
    }

    @Test
    fun `places read as places`() {
        assertEquals(
            listOf("1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "111th"),
            listOf(1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111).map { ordinal(it) },
        )
    }

    @Test
    fun `everything new on screen has a drawing, not an emoji`() {
        for (name in listOf("hourglass", "image", "eye", "robot", "medalGold", "medalSilver", "medalBronze", "trophy")) {
            assertTrue("no glyph called $name", Art.has(name))
        }
    }
}
