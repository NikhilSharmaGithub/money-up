package com.moneymove.game

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Several offers at once (round 2, G9) and everybody else's on show (G8):
 * when an offer pops up on its own and when the list comes up instead, and
 * the words a table trade is read out in (docs/API-1.0.6.md, "G8 — Trades
 * are public at the table").
 */
class OffersTest {

    private fun offer(id: Int) = TradeOffer(id = id, from = "u_a", to = "u_me")

    @Test
    fun `nothing waiting, or nothing new, pops nothing`() {
        assertNull(offerPop(emptyList(), emptySet()))
        assertNull(offerPop(listOf(offer(4)), setOf(4)))
        assertNull(offerPop(listOf(offer(4), offer(5)), setOf(4, 5)))
    }

    @Test
    fun `one offer waiting comes up on its own sheet`() {
        val pop = offerPop(listOf(offer(4)), emptySet())
        assertEquals(OfferPop.One(offer(4)), pop)
    }

    @Test
    fun `two or more waiting come up as the one list, and all of them count as shown`() {
        // A second lands while the first was already shown: the list, not a
        // second sheet queued behind the first.
        val pop = offerPop(listOf(offer(4), offer(7)), setOf(4))
        assertTrue(pop is OfferPop.All)
        assertEquals(listOf(4, 7), (pop as OfferPop.All).ids)
        // Three arriving together: one list with all three.
        val three = offerPop(listOf(offer(1), offer(2), offer(3)), emptySet())
        assertEquals(OfferPop.All(listOf(1, 2, 3)), three)
    }

    @Test
    fun `a table trade reads as the contract's row`() {
        assertEquals("Ravi → Asha: Tel Aviv for $300", tableTradeWords("Ravi", "Asha", "Tel Aviv", "$300"))
        assertEquals("Ravi → Asha: $50 for nothing", tableTradeWords("Ravi", "Asha", "$50", null))
        assertEquals("Ravi → Asha: asks for Rio", tableTradeWords("Ravi", "Asha", null, "Rio"))
        assertEquals("Ravi → Asha: an empty offer", tableTradeWords("Ravi", "Asha", null, null))
    }

    @Test
    fun `the pile names who wants to trade`() {
        assertEquals("Offers (3)", offersTitle(3))
        assertEquals("Somebody", namesList(emptyList()))
        assertEquals("Ravi", namesList(listOf("Ravi")))
        assertEquals("Ravi and Asha", namesList(listOf("Ravi", "Asha")))
        assertEquals("Ravi, Asha and Bilal", namesList(listOf("Ravi", "Asha", "Bilal")))
    }

    @Test
    fun `a compact card leans the way the offer sheet's meter does`() {
        assertEquals("An even deal", dealLeanWords(300, 290))
        assertEquals("An even deal", dealLeanWords(290, 314))
        assertEquals("$120 your way", dealLeanWords(420, 300))
        assertEquals("$80 their way", dealLeanWords(220, 300))
    }

    @Test
    fun `a third player's view of the table's trades decodes with its aliased ids`() {
        val s = MMJson.decodeFromString(
            GameState.serializer(),
            """
            {"status":"playing","players":[{"id":"p1","name":"Ravi"},{"id":"p2","name":"Asha"}],
             "trades":[{"id":7,"from":"p1","to":"p2","give":{"money":300,"tiles":[6],"cards":0},
                        "get":{"money":0,"tiles":[],"cards":0},"at":1791891882281}]}
            """.trimIndent(),
        )
        val t = s.trades.single()
        assertEquals("Ravi", s.player(t.from)?.name)
        assertEquals("Asha", s.player(t.to)?.name)
        assertEquals(listOf(6), t.give.tiles)
        assertTrue(t.get.isEmpty)
    }
}
