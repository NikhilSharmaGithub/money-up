package com.moneymove.game

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A friend code is a pure hash of a player's token, computed independently by
 * the server (server/social.js), the browser, iOS and here. Three of those
 * four are a port of the first, and a port of 32-bit hash arithmetic into a
 * language with signed integers is exactly the kind of thing that works for
 * most inputs and quietly disagrees on some of them — at which point a player
 * reads their friend a code that belongs to nobody.
 *
 * The expectations below came out of the server's own function.
 */
class FriendCodeTest {
    @Test
    fun `matches the server for the same tokens`() {
        assertEquals("MJ4X9U", friendCode("abc"))
        assertEquals("YULD87", friendCode("nikhil"))
        assertEquals("F8G36M", friendCode("mm:9f3a2c7d81b4"))
        assertEquals("FQHVNA", friendCode(""))
        assertEquals("PLJ33C", friendCode("Z"))
        assertEquals("GVBJH3", friendCode("a-very-long-player-token-0123456789"))
    }
}
