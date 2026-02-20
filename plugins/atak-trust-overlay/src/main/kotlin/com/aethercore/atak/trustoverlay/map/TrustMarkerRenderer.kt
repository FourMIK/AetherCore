package com.aethercore.atak.trustoverlay.map

import com.aethercore.atak.trustoverlay.atak.MapView
import com.aethercore.atak.trustoverlay.atak.MarkerModel
import com.aethercore.atak.trustoverlay.core.ResolvedTrustState
import com.aethercore.atak.trustoverlay.core.TrustEvent
import com.aethercore.atak.trustoverlay.core.TrustLevel

class TrustMarkerRenderer(
    private val mapView: MapView,
) {
    fun render(state: ResolvedTrustState) {
        val event = state.event ?: return
        mapView.upsertMarker(
            MarkerModel(
                id = markerId(state.uid),
                lat = event.lat,
                lon = event.lon,
                title = event.callsign,
                subtitle = if (state.stale) {
                    "Trust ${event.score} (Unknown/Stale)"
                } else {
                    "Trust ${event.score} (${state.displayLevel.name})"
                },
                iconKey = iconFor(state.displayLevel),
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

    private fun iconFor(level: TrustLevel): String = when (level) {
        TrustLevel.HIGH -> "trust_marker_green"
        TrustLevel.MEDIUM -> "trust_marker_yellow"
        TrustLevel.LOW -> "trust_marker_red"
        TrustLevel.UNKNOWN -> "trust_marker_gray"
    }

    private fun markerId(uid: String): String = "trust:$uid"
}
