package com.aethercore.atak.trustoverlay.map

import com.aethercore.atak.trustoverlay.atak.MapView
import com.aethercore.atak.trustoverlay.atak.MarkerModel
import com.aethercore.atak.trustoverlay.core.ResolvedTrustState
import com.aethercore.atak.trustoverlay.core.TrustEvent
import com.aethercore.atak.trustoverlay.core.TrustLevel
import java.util.Locale

class TrustMarkerRenderer(
    private val mapView: MapView,
) {
    fun render(state: ResolvedTrustState) {
        val event = state.event ?: return
        
        val subtitle = when {
            state.stale -> "Trust ${formatTrustScore(event.trustScore)} (Stale)"
            event.signatureHex != null && !event.signatureVerified -> "Trust ${formatTrustScore(event.trustScore)} (UNVERIFIED)"
            else -> "Trust ${formatTrustScore(event.trustScore)} (${labelFor(state.displayLevel)})"
        }
        
        mapView.upsertMarker(
            MarkerModel(
                id = markerId(state.uid),
                lat = event.lat,
                lon = event.lon,
                title = event.callsign,
                subtitle = subtitle,
                iconKey = iconFor(state.displayLevel, state.stale, event.signatureVerified),
            ),
        )
    }

    fun render(event: TrustEvent) {
        render(
            ResolvedTrustState(
                uid = event.uid,
                event = event,
                displayLevel = event.level,
                stale = false,
                untrusted = event.level == TrustLevel.LOW || event.level == TrustLevel.UNKNOWN,
                ageMs = 0,
                statusLabel = event.level.name,
            ),
        )
    }

    fun remove(uid: String) {
        mapView.removeMarker(markerId(uid))
    }

    private fun iconFor(level: TrustLevel, stale: Boolean, signatureVerified: Boolean): String {
        if (stale || level == TrustLevel.LOW || level == TrustLevel.UNKNOWN || !signatureVerified) {
            return "trust_marker_red"
        }

        return when (level) {
            TrustLevel.HIGH -> "trust_marker_green"
            TrustLevel.MEDIUM -> "trust_marker_amber"
            TrustLevel.LOW -> "trust_marker_red"
            TrustLevel.UNKNOWN -> "trust_marker_red"
        }
    }

    private fun labelFor(level: TrustLevel): String = when (level) {
        TrustLevel.HIGH -> "Healthy"
        TrustLevel.MEDIUM -> "Suspect"
        TrustLevel.LOW -> "Quarantined"
        TrustLevel.UNKNOWN -> "Unknown"
    }

    private fun formatTrustScore(score: Double): String = String.format(Locale.US, "%.2f", score)

    private fun markerId(uid: String): String = "trust:$uid"
}
