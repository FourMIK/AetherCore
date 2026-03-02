package com.aethercore.atak.trustoverlay.map

import com.aethercore.atak.trustoverlay.atak.MapView
import com.aethercore.atak.trustoverlay.atak.MarkerModel
import com.aethercore.atak.trustoverlay.core.ResolvedTrustState
import com.aethercore.atak.trustoverlay.core.SignatureStatus
import com.aethercore.atak.trustoverlay.core.TrustFeedStatus
import com.aethercore.atak.trustoverlay.core.TrustEvent
import com.aethercore.atak.trustoverlay.core.TrustLevel
import java.util.Locale

class TrustMarkerRenderer(
    private val mapView: MapView,
) {
    @Volatile
    private var feedStatus: TrustFeedStatus = TrustFeedStatus.HEALTHY

    fun setFeedStatus(status: TrustFeedStatus) {
        feedStatus = status
    }

    fun render(state: ResolvedTrustState) {
        val event = state.event ?: return
        val subtitle = buildSubtitle(event, state)

        mapView.upsertMarker(
            MarkerModel(
                id = markerId(state.uid),
                lat = event.lat,
                lon = event.lon,
                title = event.callsign,
                subtitle = subtitle,
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

    private fun iconFor(level: TrustLevel): String {
        return when (level) {
            TrustLevel.HIGH -> "trust_marker_green"
            TrustLevel.MEDIUM -> "trust_marker_yellow"
            TrustLevel.LOW -> "trust_marker_orange"
            TrustLevel.UNKNOWN -> "trust_marker_red"
        }
    }

    private fun buildSubtitle(event: TrustEvent, state: ResolvedTrustState): String {
        val badges = mutableListOf(signatureBadge(event))
        freshnessBadge(state)?.let { badges.add(it) }
        val badgeSuffix = badges.joinToString(prefix = " [", separator = "] [", postfix = "]")
        return "Trust ${formatTrustScore(event.trustScore)} (${labelFor(state.displayLevel)})$badgeSuffix"
    }

    private fun signatureBadge(event: TrustEvent): String = when (event.signatureStatus) {
        SignatureStatus.VERIFIED -> "check-shield"
        SignatureStatus.UNVERIFIED -> "?-shield"
        SignatureStatus.INVALID_OR_UNKNOWN -> "skull"
    }

    private fun freshnessBadge(state: ResolvedTrustState): String? = when {
        state.stale -> "clock"
        feedStatus == TrustFeedStatus.DEGRADED -> "antenna-warning"
        else -> null
    }

    private fun labelFor(level: TrustLevel): String = when (level) {
        TrustLevel.HIGH -> "High"
        TrustLevel.MEDIUM -> "Medium"
        TrustLevel.LOW -> "Low"
        TrustLevel.UNKNOWN -> "Unknown"
    }

    private fun formatTrustScore(score: Double): String = String.format(Locale.US, "%.2f", score)

    private fun markerId(uid: String): String = "trust:$uid"
}
