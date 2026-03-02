package com.aethercore.atak.trustoverlay.map

import com.aethercore.atak.trustoverlay.atak.MapView
import com.aethercore.atak.trustoverlay.atak.MarkerModel
import com.aethercore.atak.trustoverlay.core.ResolvedTrustState
import com.aethercore.atak.trustoverlay.core.SignatureStatus
import com.aethercore.atak.trustoverlay.core.TrustEvent
import com.aethercore.atak.trustoverlay.core.TrustFeedStatus
import com.aethercore.atak.trustoverlay.core.TrustLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustMarkerRendererTest {
    @Test
    fun `maps trust levels to fixed base colors`() {
        val mapView = RecordingMapView()
        val renderer = TrustMarkerRenderer(mapView)

        renderer.render(resolved(level = TrustLevel.HIGH, uid = "high"))
        assertEquals("trust_marker_green", mapView.last()?.iconKey)

        renderer.render(resolved(level = TrustLevel.MEDIUM, uid = "medium"))
        assertEquals("trust_marker_yellow", mapView.last()?.iconKey)

        renderer.render(resolved(level = TrustLevel.LOW, uid = "low"))
        assertEquals("trust_marker_orange", mapView.last()?.iconKey)

        renderer.render(resolved(level = TrustLevel.UNKNOWN, uid = "unknown"))
        assertEquals("trust_marker_red", mapView.last()?.iconKey)
    }

    @Test
    fun `includes signature and freshness badges in subtitle`() {
        val mapView = RecordingMapView()
        val renderer = TrustMarkerRenderer(mapView)

        renderer.render(resolved(uid = "verified", signatureStatus = SignatureStatus.VERIFIED, stale = false))
        assertTrue(mapView.last()?.subtitle?.contains("[check-shield]") == true)

        renderer.render(resolved(uid = "unverified", signatureStatus = SignatureStatus.UNVERIFIED, stale = false))
        assertTrue(mapView.last()?.subtitle?.contains("[?-shield]") == true)

        renderer.render(resolved(uid = "stale", signatureStatus = SignatureStatus.INVALID_OR_UNKNOWN, stale = true))
        assertTrue(mapView.last()?.subtitle?.contains("[skull]") == true)
        assertTrue(mapView.last()?.subtitle?.contains("[clock]") == true)

        renderer.setFeedStatus(TrustFeedStatus.DEGRADED)
        renderer.render(resolved(uid = "degraded-feed", signatureStatus = SignatureStatus.VERIFIED, stale = false))
        assertTrue(mapView.last()?.subtitle?.contains("[antenna-warning]") == true)
    }

    private fun resolved(
        uid: String,
        level: TrustLevel = TrustLevel.HIGH,
        signatureStatus: SignatureStatus = SignatureStatus.VERIFIED,
        stale: Boolean = false,
    ): ResolvedTrustState {
        val event = TrustEvent(
            uid = uid,
            callsign = uid.uppercase(),
            lat = 0.0,
            lon = 0.0,
            level = level,
            score = 90,
            trustScore = 0.90,
            source = "aethercore",
            sourceMetadata = emptyMap(),
            metrics = emptyMap(),
            observedAtEpochMs = 0L,
            signatureStatus = signatureStatus,
            signatureVerified = signatureStatus == SignatureStatus.VERIFIED,
        )
        return ResolvedTrustState(
            uid = uid,
            event = event,
            displayLevel = level,
            stale = stale,
            untrusted = level == TrustLevel.LOW || level == TrustLevel.UNKNOWN,
            ageMs = if (stale) 1000 else 0,
            statusLabel = level.name,
        )
    }

    private class RecordingMapView : MapView {
        private val markers = linkedMapOf<String, MarkerModel>()

        override fun upsertMarker(marker: MarkerModel) {
            markers[marker.id] = marker
        }

        override fun removeMarker(markerId: String) {
            markers.remove(markerId)
        }

        fun last(): MarkerModel? = markers.values.lastOrNull()
    }
}
