package com.moneymove.game

import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 1.0.6's levels, missions, boards and switches, read the way
 * docs/API-1.0.6.md writes them — and read the way an older server writes
 * them too, because a phone that updates before the server does must still
 * draw a sensible screen rather than a decoder's exception.
 */
class ProgressionTest {

    private fun obj(text: String): JsonObject = MMJson.parseToJsonElement(text) as JsonObject

    @Test
    fun `me carries the level, the career, the switches and the last level-up`() {
        val me = MMJson.decodeFromString(
            MeView.serializer(),
            """{"code":"G4S69R","name":"Asha","flag":"","coins":107,"karma":100,"provider":"google",
               "xp":142,"level":2,"levelFloor":100,"levelNext":300,
               "career":{"streetsBought":2,"housesBuilt":0,"rentCollected":0,"biggestRent":0,
                         "auctionsWon":0,"tradesCompleted":0,"doubles":0,
                         "favoriteBoard":{"id":"classic","name":"Classic","games":1}},
               "prefs":{"dailyReminder":false,"inviteAlerts":true},
               "lastLevelUp":{"from":1,"to":2,"coins":5,"at":1791877551072}}""",
        )
        assertEquals(2, me.level)
        assertEquals(0.21f, me.levelFraction, 0.001f)
        assertEquals(158, me.xpToNext)
        assertEquals("Classic", me.career?.favoriteBoard?.name)
        assertFalse(me.career!!.isEmpty)
        assertFalse(me.prefs!!.dailyReminder)
        assertEquals(LevelUp(1, 2, 5, 1791877551072.0), me.lastLevelUp)
    }

    @Test
    fun `an older server's me reads as a fresh level one`() {
        val me = MMJson.decodeFromString(MeView.serializer(), """{"code":"G4S69R","name":"Asha","coins":3}""")
        assertEquals(1, me.level)
        assertEquals(0f, me.levelFraction)
        assertNull(me.career)
        assertNull(me.lastLevelUp)
    }

    @Test
    fun `the bar never runs past either end`() {
        assertEquals(0f, levelProgress(50, 100, 300))
        assertEquals(1f, levelProgress(400, 100, 300))
        assertEquals(0.5f, levelProgress(200, 100, 300))
        // A floor and a next that disagree mid-deploy draw an empty bar, not a crash.
        assertEquals(0f, levelProgress(10, 100, 100))
    }

    @Test
    fun `the missions card reads as the server deals it`() {
        val view = MMJson.decodeFromString(
            MissionsView.serializer(),
            """{"day":"2026-10-13","resetsAt":1791961200000,"signedIn":true,
               "missions":[
                 {"id":"playGames","kind":"playGames","title":"Play 2 games","target":2,"progress":1,
                  "coins":3,"xp":10,"done":false,"claimed":false},
                 {"id":"winGame","kind":"winGame","title":"Win a game","target":1,"progress":1,
                  "coins":3,"xp":10,"done":true,"claimed":false},
                 {"id":"collectRent","kind":"collectRent","title":"Collect ${'$'}1,500 in rent","target":1500,
                  "progress":600,"coins":3,"xp":10,"done":false,"claimed":false}],
               "bonus":{"coins":5,"ready":false,"claimed":false}}""",
        )
        assertEquals(3, view.missions.size)
        assertEquals(1, view.doneCount)
        assertTrue(view.anythingToClaim)
        assertEquals(0.5f, view.missions[0].fraction)
        assertEquals(0.4f, view.missions[2].fraction, 0.0001f)
        assertEquals(5, view.bonus.coins)
        // Signed out, the same card has nothing to collect — only to show.
        assertFalse(view.copy(signedIn = false).anythingToClaim)
    }

    @Test
    fun `every mission in the pool has a drawn mark`() {
        val pool = listOf(
            "playGames", "winGame", "buyStreets", "buildHouses", "collectRent",
            "completeSet", "winAuction", "completeTrade", "rollDoubles", "lapsBoard",
        )
        for (kind in pool) assertTrue(kind, Art.has(missionGlyph(kind)))
        // A kind newer than this build still gets one.
        assertTrue(Art.has(missionGlyph("somethingNew")))
        assertTrue(Art.has("star"))
    }

    @Test
    fun `a claim's toast names what it paid`() {
        assertEquals("+3 coins · +10 XP", claimLine(3, 10))
        assertEquals("+5 coins", claimLine(5, 0))
        assertEquals("+1 coin", claimLine(1, 0))
    }

    @Test
    fun `the weekly board carries its week, its reset and the caller's place`() {
        val view = MMJson.decodeFromString(
            LeaderboardView.serializer(),
            """{"scope":"week","week":"2026-W42","resetsAt":1792368000000,
               "top":[{"code":"G4S69R","name":"Asha","flag":"","level":2,"wins":1,"winnings":2,"you":true},
                      {"code":"H0A1B2","name":"Zoe","flag":"","level":7,"wins":1,"winnings":1}],
               "you":{"rank":1,"wins":1}}""",
        )
        assertEquals("week", view.scope)
        assertEquals("2026-W42", view.week)
        assertTrue(view.top[0].you)
        assertFalse(view.top[1].you)
        assertEquals(7, view.top[1].level)
        assertEquals(LeaderYou(rank = 1, wins = 1), view.you)
    }

    @Test
    fun `an older server's board is the all-time one, with no levels and no place`() {
        val view = MMJson.decodeFromString(
            LeaderboardView.serializer(),
            """{"top":[{"code":"G4S69R","name":"Asha","flag":"","wins":4,"winnings":9}]}""",
        )
        assertEquals("all", view.scope)
        assertEquals(0, view.top.single().level)
        assertNull(view.you)
        assertNull(view.resetsAt)
    }

    @Test
    fun `a player off the board is ranked but unlisted`() {
        val view = MMJson.decodeFromString(
            LeaderboardView.serializer(),
            """{"scope":"all","top":[],"you":{"rank":null,"wins":0}}""",
        )
        assertNull(view.you?.rank)
    }

    @Test
    fun `a profile carries the level and the career`() {
        val card = MMJson.decodeFromString(
            PlayerProfile.serializer(),
            """{"code":"G4S69R","name":"Asha","flag":"🇮🇳","avatar":"😎","wins":7,"games":13,"winnings":15,
               "titles":[{"title":"Dealmaker","count":5}],"since":1786000000000,"relation":"friend",
               "level":4,
               "career":{"streetsBought":52,"housesBuilt":18,"rentCollected":23450,"biggestRent":1800,
                         "auctionsWon":6,"tradesCompleted":9,"doubles":31,
                         "favoriteBoard":{"id":"classic","name":"Classic","games":8}}}""",
        )
        assertEquals(4, card.level)
        assertEquals(23450, card.career?.rentCollected)
        assertEquals(8, card.career?.favoriteBoard?.games)
        assertEquals("$23.4k", careerMoney(card.career!!.rentCollected))
        assertEquals("$1,800", careerMoney(card.career!!.biggestRent))
    }

    @Test
    fun `an empty career says so, a null favourite board included`() {
        val empty = MMJson.decodeFromString(
            Career.serializer(),
            """{"streetsBought":0,"housesBuilt":0,"rentCollected":0,"biggestRent":0,
               "auctionsWon":0,"tradesCompleted":0,"doubles":0,"favoriteBoard":null}""",
        )
        assertTrue(empty.isEmpty)
    }

    @Test
    fun `the progress event reads as the doc writes it`() {
        val note = MMJson.decodeFromJsonElement(
            ProgressNote.serializer(),
            obj(
                """{"roomId":"vxhoc","xpGained":52,
                   "xpParts":{"played":20,"win":30,"runnerUp":0,"turns":2},
                   "xpCapped":false,"xp":142,"level":2,"levelFloor":100,"levelNext":300,
                   "levelUp":{"from":1,"to":2,"coins":5},"missionsCompleted":["winGame"]}""",
            ),
        )
        assertEquals(52, note.xpGained)
        assertEquals(XpParts(20, 30, 0, 2), note.xpParts)
        assertEquals(2, note.levelUp?.to)
        assertEquals(listOf("winGame"), note.missionsCompleted)
        val quiet = MMJson.decodeFromJsonElement(
            ProgressNote.serializer(),
            obj("""{"roomId":"vxhoc","xpGained":0,"xpCapped":true,"xp":700,"level":4,"levelFloor":600,"levelNext":1000,"levelUp":null,"missionsCompleted":[]}"""),
        )
        assertNull(quiet.levelUp)
        assertTrue(quiet.xpCapped)
    }

    @Test
    fun `a seat's level survives a patch, and a guest's nought draws no chip`() {
        val full = """
            {"id":"g3d5s","status":"lobby","version":3,
             "players":[
               {"id":"me-token","name":"Nikhil","color":"#e3a93c","code":"MJ4X9U","level":12},
               {"id":"bot:1","name":"Ravi","color":"#3f6fae","code":"H0A1B2","isBot":true,"level":27},
               {"id":"me-token_p2","name":"Player 2","color":"#888888","code":"","level":0}
             ],
             "log":[],"chat":[]}
        """.trimIndent()
        val mirror = StateMirror()
        mirror.adopt(obj(full))
        val step = mirror.apply(obj("""{"from":3,"v":4,"patch":{"s":{"status":"lobby"}}}"""))
        val state = MMJson.decodeFromJsonElement(GameState.serializer(), (step as StateMirror.Step.State).json)
        assertEquals(listOf(12, 27, null), state.players.map { it.shownLevel })
        assertEquals(27, PlayerResult.snapshot(state).first { it.id == "bot:1" }.level)
        // An older server sends no level at all.
        assertNull(PlayerState(id = "x").shownLevel)
    }

    @Test
    fun `the daily reminder is a push this build knows, on the social channel`() {
        val about = PushAbout.from(mapOf("kind" to "daily", "collapseId" to "daily"))
        assertEquals(PushAbout.Kind.DAILY, about?.kind)
        assertEquals("daily", about?.tag)
        assertEquals(PushChannels.SOCIAL, PushChannels.of(about))
    }

    @Test
    fun `the switches default to on`() {
        val prefs = MMJson.decodeFromString(PlayerPrefs.serializer(), "{}")
        assertTrue(prefs.dailyReminder)
        assertTrue(prefs.inviteAlerts)
    }
}
