package com.moneymove.game

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The "Did you know?" lines under a deed (docs/API-1.0.6.md, "Place facts"):
 * the set GET /api/facts answers decodes, a street finds its own line by
 * "<name>|<group>" and its country's by the group, and anything that is not
 * a street — or a street the set has nothing for — shows no card at all.
 */
class PlaceFactsTest {

    private val sample = """
        {"version":"0a1b2c3d4e5f6789",
         "places":{"São Paulo|BR":"São Paulo line.","Jaipur|RJ":"Jaipur on Bharat."},
         "groups":{"BR":"Brazil line.","RJ":"Rajasthan line.","IN_RJ":"Rajasthan, India board."},
         "extra":"ignored"}
    """.trimIndent()

    private fun decode(json: String) = MMJson.decodeFromString(PlaceFacts.Payload.serializer(), json)

    private fun street(name: String, group: String?) = TileData(type = "property", name = name, group = group)

    @Test
    fun `the set decodes, unknown keys and all`() {
        val set = decode(sample)
        assertEquals("0a1b2c3d4e5f6789", set.version)
        assertEquals(2, set.places.size)
        assertEquals(3, set.groups.size)
    }

    @Test
    fun `a street reads its own line and its country's`() {
        val found = PlaceFacts.lookup(street("São Paulo", "BR"), decode(sample))
        assertEquals(PlaceFacts.Found("São Paulo line.", "Brazil line."), found)
    }

    @Test
    fun `the same city on another board has its own key`() {
        val set = decode(sample)
        assertEquals("Jaipur on Bharat.", PlaceFacts.lookup(street("Jaipur", "RJ"), set)?.place)
        val other = PlaceFacts.lookup(street("Jaipur", "IN_RJ"), set)
        assertNull(other?.place)
        assertEquals("Rajasthan, India board.", other?.group)
    }

    @Test
    fun `nothing for airports, utilities, a missing set or an unknown street`() {
        val set = decode(sample)
        assertNull(PlaceFacts.lookup(TileData(type = "airport", name = "JFK Airport"), set))
        assertNull(PlaceFacts.lookup(TileData(type = "utility", name = "Power Company"), set))
        assertNull(PlaceFacts.lookup(street("Nowhere", "ZZ"), set))
        assertNull(PlaceFacts.lookup(street("São Paulo", "BR"), null))
    }

    @Test
    fun `the server's own file decodes, and its lines are found`() {
        val file = File("../../server/facts.json")
        if (!file.exists()) return // a checkout without the server beside it
        val set = MMJson.decodeFromString(PlaceFacts.Payload.serializer(), file.readText())
        assertTrue(set.places.size > 400)
        assertNotNull(PlaceFacts.lookup(street("Mumbai", "IN"), set)?.place)
    }
}
