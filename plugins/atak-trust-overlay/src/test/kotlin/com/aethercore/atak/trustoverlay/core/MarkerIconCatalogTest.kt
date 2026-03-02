package com.aethercore.atak.trustoverlay.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkerIconCatalogTest {
    @Test
    fun mapsSeverityKeysToExpectedUris() {
        val green = MarkerIconCatalog.forKey("trust_marker_green")
        val yellow = MarkerIconCatalog.forKey("trust_marker_yellow")
        val orange = MarkerIconCatalog.forKey("trust_marker_orange")
        val red = MarkerIconCatalog.forKey("trust_marker_red")
        val amber = MarkerIconCatalog.forKey("trust_marker_amber")

        assertEquals(
            "android.resource://com.aethercore.atak.trustoverlay/drawable/trust_marker_green",
            green.resourceUri,
        )
        assertEquals(
            "android.resource://com.aethercore.atak.trustoverlay/drawable/trust_marker_yellow",
            yellow.resourceUri,
        )
        assertEquals(
            "android.resource://com.aethercore.atak.trustoverlay/drawable/trust_marker_orange",
            orange.resourceUri,
        )
        assertEquals(
            "android.resource://com.aethercore.atak.trustoverlay/drawable/trust_marker_red",
            red.resourceUri,
        )
        assertEquals(
            "android.resource://com.aethercore.atak.trustoverlay/drawable/trust_marker_amber",
            amber.resourceUri,
        )
    }

    @Test
    fun unknownKeyFallsBackToReferencePoint() {
        val fallback = MarkerIconCatalog.forKey("not-a-real-icon")

        assertEquals("reference_point", fallback.key)
        assertEquals(
            "android.resource://com.aethercore.atak.trustoverlay/drawable/reference_point",
            fallback.resourceUri,
        )
        assertTrue(
            MarkerIconCatalog.severityKeys().containsAll(
                listOf(
                    "trust_marker_green",
                    "trust_marker_yellow",
                    "trust_marker_orange",
                    "trust_marker_red",
                ),
            ),
        )
    }
}
