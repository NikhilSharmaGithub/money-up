package com.moneymove.game

import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The profile a finished game opens is looked up by the code each seat
 * carries, so the code has to make it from the wire to the standings intact:
 * through a full state, through every patch that never mentions it, into the
 * result History files away — and a result filed before codes existed still
 * has to decode.
 */
class PlayerProfileTest {

    private fun obj(text: String): JsonObject = MMJson.parseToJsonElement(text) as JsonObject

    private val full = """
        {"id":"g3d5s","status":"ended","version":7,
         "players":[
           {"id":"me-token","name":"Nikhil","color":"#e3a93c","code":"MJ4X9U","netWorth":2400},
           {"id":"u_abc","name":"Zoe","color":"#3f6fae","code":"H0A1B2","netWorth":900},
           {"id":"me-token_p2","name":"Player 2","color":"#888888","code":"","netWorth":100}
         ],
         "turn":{"playerId":"me-token","phase":"roll"},
         "log":[],"chat":[]}
    """.trimIndent()

    @Test
    fun `a seat's code survives a patch that never mentions it`() {
        val mirror = StateMirror()
        mirror.adopt(obj(full))
        val step = mirror.apply(obj("""{"from":7,"v":8,"patch":{"p":{"turn":{"s":{"phase":"action"}}}}}"""))
        val json = (step as StateMirror.Step.State).json
        val state = MMJson.decodeFromJsonElement(GameState.serializer(), json)
        assertEquals("action", state.turn?.phase)
        assertEquals(listOf("MJ4X9U", "H0A1B2", ""), state.players.map { it.code })
    }

    @Test
    fun `the standings carry each seat's code`() {
        val state = MMJson.decodeFromJsonElement(GameState.serializer(), obj(full))
        val byId = PlayerResult.snapshot(state).associateBy { it.id }
        assertEquals("H0A1B2", byId.getValue("u_abc").code)
        assertEquals("", byId.getValue("me-token_p2").code)
    }

    @Test
    fun `a result filed before codes decodes with none`() {
        val old = MMJson.decodeFromString(PlayerResult.serializer(), """{"id":"u_abc","name":"Zoe","worth":900}""")
        assertEquals("", old.code)
    }

    @Test
    fun `a profile reads as the server writes it`() {
        val card = MMJson.decodeFromString(
            PlayerProfile.serializer(),
            """{"code":"H0A1B2","name":"Zoe","flag":"","avatar":"","wins":12,"games":40,"winnings":31,
               "titles":[{"title":"Landlord","count":3}],"since":1772323200000,"relation":"sent"}""",
        )
        assertEquals(30, card.winRate)
        assertEquals("sent", card.relation)
        assertEquals(TitleCount("Landlord", 3), card.titles.single())
        assertTrue(card.since > 0)
    }

    @Test
    fun `a win rate never divides by nothing or reads above a hundred`() {
        assertEquals(0, PlayerProfile().winRate)
        // A server that has counted the wins but not the games yet.
        assertEquals(100, PlayerProfile(wins = 3, games = 0).winRate)
        assertEquals(33, PlayerProfile(wins = 1, games = 3).winRate)
    }

    @Test
    fun `an invite carries the inviter's flag, and an older one none`() {
        val inv = MMJson.decodeFromString(
            InviteFeed.serializer(),
            """{"invite":{"from":"MJ4X9U","name":"Nikhil","flag":"🇮🇳","roomId":"g3d5s","at":1772323200000}}""",
        ).invite
        assertEquals("🇮🇳", inv?.flag)
        val older = MMJson.decodeFromString(
            InviteFeed.serializer(),
            """{"invite":{"from":"MJ4X9U","name":"Nikhil","roomId":"g3d5s","at":1772323200000}}""",
        ).invite
        assertEquals("", older?.flag)
    }
}
