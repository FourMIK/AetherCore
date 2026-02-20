package com.aethercore.atak.trustoverlay.map

import com.aethercore.atak.trustoverlay.atak.MapView
import com.aethercore.atak.trustoverlay.atak.MarkerModel
import com.aethercore.atak.trustoverlay.core.TrustEvent
import com.aethercore.atak.trustoverlay.core.TrustLevel

class TrustMarkerRenderer(
    private val mapView: MapView,
) {
    fun render(event: TrustEvent) {
        mapView.upsertMarker(
            MarkerModel(
                id = markerId(event.uid),
                lat = event.lat,
                lon = event.lon,
                title = event.callsign,
                subtitle = "Trust ${event.score} (${event.level.name})",
                iconKey = iconFor(event.level),
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
