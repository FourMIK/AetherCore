package com.aethercore.atak.trustoverlay.ui

import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.core.ResolvedTrustState
import com.aethercore.atak.trustoverlay.core.TrustLevel
import java.time.Instant
import java.util.Locale

class TrustDetailPanelController(
    private val logger: Logger,
) {
    private val latestByMarkerId: MutableMap<String, ResolvedTrustState> = linkedMapOf()

    fun onTrustEvent(markerId: String, state: ResolvedTrustState) {
        latestByMarkerId[markerId] = state
    }

    fun onMarkerTapped(markerId: String) {
        val state = latestByMarkerId[markerId]
        if (state == null || state.event == null) {
            logger.w("No trust detail available for marker=$markerId")
            return
        }
        val event = state.event

        val metricsSummary = if (event.metrics.isEmpty()) {
            "none"
        } else {
            event.metrics.entries.joinToString(", ") { (name, value) -> "$name=${String.format(Locale.US, "%.2f", value)}" }
        }

        val sourceMetadataSummary = if (event.sourceMetadata.isEmpty()) {
            "none"
        } else {
            event.sourceMetadata.entries.joinToString(", ") { (key, value) -> "$key=$value" }
        }

        // Replace this block with ATAK DropDown/Fragment presentation code.
        logger.d(
            """
            Open trust detail panel:
              callsign=${event.callsign}
              trust_score=${String.format(Locale.US, "%.2f", event.trustScore)}
              trust_level=${derivedLevelLabel(state.displayLevel, state.stale)}
              last_updated=${Instant.ofEpochMilli(event.observedAtEpochMs)}
              stale=${state.stale}
              source=${event.source}
              source_metadata=$sourceMetadataSummary
              metrics=$metricsSummary
            """.trimIndent(),
        )
    }

    fun clear() {
        latestByMarkerId.clear()
    }

    private fun derivedLevelLabel(level: TrustLevel, stale: Boolean): String {
        if (stale) {
            return "Stale"
        }

        return when (level) {
            TrustLevel.HIGH -> "Healthy"
            TrustLevel.MEDIUM -> "Suspect"
            TrustLevel.LOW -> "Quarantined"
            TrustLevel.UNKNOWN -> "Unknown"
        }
    }
}
