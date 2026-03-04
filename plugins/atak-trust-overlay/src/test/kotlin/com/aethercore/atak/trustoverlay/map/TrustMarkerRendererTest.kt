package com.aethercore.atak.trustoverlay.map

import com.aethercore.atak.trustoverlay.atak.MapView
import com.aethercore.atak.trustoverlay.atak.MarkerModel
import com.aethercore.atak.trustoverlay.core.ResolvedTrustState
import com.aethercore.atak.trustoverlay.core.TrustEvent
import com.aethercore.atak.trustoverlay.core.TrustLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class TrustMarkerRendererTest {
    @Test
    fun `unsigned high trust events stay green`() {
        val fakeMapView = FakeMapView()
        val renderer = TrustMarkerRenderer(fakeMapView)

        val state = ResolvedTrustState(
            uid = "green-node",
            event = trustEvent(uid = "green-node", signatureHex = null, signatureVerified = false),
            displayLevel = TrustLevel.HIGH,
            stale = false,
            untrusted = false,
            ageMs = 0L,
            statusLabel = "Healthy",
        )

        renderer.render(state)
        val marker = fakeMapView.lastMarker
        assertNotNull(marker)
        assertEquals("trust_marker_green", marker?.iconKey)
    }

    @Test
    fun `signed but unverified events render as red`() {
        val fakeMapView = FakeMapView()
        val renderer = TrustMarkerRenderer(fakeMapView)

        val state = ResolvedTrustState(
            uid = "unverified-node",
            event = trustEvent(uid = "unverified-node", signatureHex = "a".repeat(128), signatureVerified = false),
            displayLevel = TrustLevel.HIGH,
            stale = false,
            untrusted = false,
            ageMs = 0L,
            statusLabel = "Healthy",
        )

        renderer.render(state)
        val marker = fakeMapView.lastMarker
        assertNotNull(marker)
        assertEquals("trust_marker_red", marker?.iconKey)
    }

    private fun trustEvent(
        uid: String,
        signatureHex: String?,
        signatureVerified: Boolean,
    ): TrustEvent = TrustEvent(
        uid = uid,
        callsign = uid.uppercase(),
        lat = 34.0,
        lon = -117.0,
        level = TrustLevel.HIGH,
        score = 95,
        trustScore = 0.95,
        source = "aethercore",
        sourceMetadata = emptyMap(),
        metrics = emptyMap(),
        observedAtEpochMs = 1_704_605_000_000L,
        signatureHex = signatureHex,
        signerNodeId = if (signatureHex != null) "signer-1" else null,
        payloadHash = if (signatureHex != null) "b".repeat(64) else null,
        signatureVerified = signatureVerified,
    )

    private class FakeMapView : MapView {
        var lastMarker: MarkerModel? = null

        override fun upsertMarker(marker: MarkerModel) {
            lastMarker = marker
        }

        override fun removeMarker(markerId: String) = Unit
    }
}

