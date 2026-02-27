package com.aethercore.atak.trustoverlay.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TrustMarkerTapFilterTest {
    @Test
    fun passesThroughPrefixedTrustUid() {
        val markerId = TrustMarkerTapFilter.extractTrustMarkerId(item = FakeTarget(uid = "trust:alpha"), event = null)

        assertEquals("trust:alpha", markerId)
    }

    @Test
    fun passesThroughUnprefixedUidWhenTrustMetadataFlagPresent() {
        val markerId = TrustMarkerTapFilter.extractTrustMarkerId(
            item = FakeTarget(uid = "alpha", metaBooleans = mapOf("trust.present" to true)),
            event = null,
        )

        assertEquals("alpha", markerId)
    }

    @Test
    fun dropsUnprefixedUidWithoutTrustMetadataFlag() {
        val markerId = TrustMarkerTapFilter.extractTrustMarkerId(item = FakeTarget(uid = "alpha"), event = null)

        assertNull(markerId)
    }

    private class FakeTarget(
        private val uid: String? = null,
        private val metaBooleans: Map<String, Boolean> = emptyMap(),
        private val metaStrings: Map<String, String> = emptyMap(),
    ) {
        fun getUID(): String? = uid
        fun getMetaBoolean(key: String, defaultValue: Boolean): Boolean = metaBooleans[key] ?: defaultValue
        fun getMetaString(key: String, defaultValue: String): String = metaStrings[key] ?: defaultValue
    }
}
