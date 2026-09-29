package com.moneymove.game

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What goes in the code box is whatever the player was sent: the code, the
 * whole invite link, or a message with one of them in it. Every client has
 * to pull the same code out of the same paste, or a friend on a phone and a
 * friend in a browser sit down at two different tables.
 *
 * The expectations below came out of roomCodeFrom() in public/js/app.js.
 */
class RoomCodeTest {
    @Test
    fun `a bare code is only tidied`() {
        assertEquals("abcde", roomCodeFrom("abcde"))
        assertEquals("abcde", roomCodeFrom("  ABCDE \n"))
        assertEquals("abc2e", roomCodeFrom("ab c-2e"))
        assertEquals("", roomCodeFrom(""))
        assertEquals("", roomCodeFrom(null))
    }

    @Test
    fun `a pasted invite link collapses to its code`() {
        assertEquals("g3d5s", roomCodeFrom("https://www.moneymove.live/?room=g3d5s"))
        assertEquals("g3d5s", roomCodeFrom("https://www.moneymove.live/?room=G3D5S"))
        assertEquals("g3d5s", roomCodeFrom("https://money-up-nine.vercel.app/?lang=en&room=g3d5s#top"))
        assertEquals("g3d5s", roomCodeFrom("https://www.moneymove.live/room/g3d5s"))
        assertEquals("g3d5s", roomCodeFrom("Join my table! https://www.moneymove.live/?room=g3d5s"))
    }

    @Test
    fun `nothing longer than the server keeps`() {
        assertEquals("abcdefghijkm", roomCodeFrom("abcdefghijkmnopq"))
    }
}
