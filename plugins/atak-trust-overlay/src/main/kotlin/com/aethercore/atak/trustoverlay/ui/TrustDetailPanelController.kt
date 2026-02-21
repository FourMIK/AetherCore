package com.aethercore.atak.trustoverlay.ui

import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.app.DialogFragment
import android.app.FragmentManager
import android.os.Bundle
import com.aethercore.atak.trustoverlay.BuildConfig
import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.core.ResolvedTrustState
import com.aethercore.atak.trustoverlay.core.TrustLevel
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

class TrustDetailPanelController(
    private val logger: Logger,
) {
    private val latestByMarkerId: MutableMap<String, ResolvedTrustState> = linkedMapOf()
    private var activeMarkerId: String? = null

    fun onTrustEvent(markerId: String, state: ResolvedTrustState) {
        latestByMarkerId[markerId] = state
        if (markerId == activeMarkerId && state.event != null) {
            presentOrRefresh(markerId, state)
        }
    }

    fun onMarkerTapped(markerId: String) {
        val state = latestByMarkerId[markerId]
        if (state == null || state.event == null) {
            logger.w("No trust detail available for marker=$markerId")
            return
        }

        presentOrRefresh(markerId, state)
    }

    fun clear() {
        dismissPanel()
        latestByMarkerId.clear()
        activeMarkerId = null
    }

    private fun presentOrRefresh(markerId: String, state: ResolvedTrustState) {
        val event = state.event ?: return
        val details = buildDetailText(state)

        val fragmentManager = resolveFragmentManager()
        if (fragmentManager != null) {
            val existing = fragmentManager.findFragmentByTag(PANEL_TAG) as? TrustDetailDialogFragment
            if (existing != null) {
                if (activeMarkerId == markerId) {
                    existing.updateContent(event.callsign, details)
                    logger.d("Refreshed trust detail panel marker=$markerId")
                } else {
                    existing.dismissAllowingStateLoss()
                    val newFragment = TrustDetailDialogFragment.newInstance(event.callsign, details)
                    newFragment.onDismissCallback = { handlePanelDismissed() }
                    newFragment.show(fragmentManager, PANEL_TAG)
                    logger.d("Replaced trust detail panel marker=$markerId")
                }
            } else {
                val newFragment = TrustDetailDialogFragment.newInstance(event.callsign, details)
                newFragment.onDismissCallback = { handlePanelDismissed() }
                newFragment.show(fragmentManager, PANEL_TAG)
                logger.d("Opened trust detail panel marker=$markerId")
            }
            activeMarkerId = markerId
            return
        }

        logger.w("Unable to resolve ATAK FragmentManager; falling back to debug logging")
        if (BuildConfig.DEBUG) {
            logger.d(debugSummary(state))
        }
    }

    private fun handlePanelDismissed() {
        activeMarkerId = null
        logger.d("Trust detail panel dismissed, cleared active marker")
    }

    private fun dismissPanel() {
        val fragmentManager = resolveFragmentManager() ?: return
        val existing = fragmentManager.findFragmentByTag(PANEL_TAG) as? TrustDetailDialogFragment
        existing?.dismissAllowingStateLoss()
    }

    private fun resolveFragmentManager(): FragmentManager? {
        val mapViewClass = runCatching { Class.forName("com.atakmap.android.maps.MapView") }.getOrNull() ?: return null
        val mapView = runCatching {
            mapViewClass.methods.firstOrNull {
                it.name == "getMapView" && it.parameterTypes.isEmpty()
            }?.invoke(null)
        }.getOrNull() ?: return null

        val context = runCatching {
            mapView.javaClass.methods.firstOrNull {
                it.name == "getContext" && it.parameterTypes.isEmpty()
            }?.invoke(mapView)
        }.getOrNull()

        val activity = context as? Activity ?: return null
        return activity.fragmentManager
    }

    private fun buildDetailText(state: ResolvedTrustState): String {
        val event = state.event ?: return "No trust event available"
        val metricsSummary = if (event.metrics.isEmpty()) {
            "none"
        } else {
            event.metrics.entries.joinToString("\n") { (name, value) ->
                "• $name = ${String.format(Locale.US, "%.2f", value)}"
            }
        }

        val sourceMetadataSummary = if (event.sourceMetadata.isEmpty()) {
            "none"
        } else {
            event.sourceMetadata.entries.joinToString("\n") { (key, value) -> "• $key = $value" }
        }

        val timestamp = Instant.ofEpochMilli(event.observedAtEpochMs)
        val freshness = if (state.stale) "STALE" else "FRESH"
        
        val signatureStatus = when {
            event.signatureHex == null -> "Not Signed"
            event.signatureVerified -> "VERIFIED"
            else -> "UNVERIFIED (Security Alert)"
        }

        return """
            Callsign: ${event.callsign}
            Trust Score: ${String.format(Locale.US, "%.2f", event.trustScore)}
            Trust Level: ${derivedLevelLabel(state.displayLevel, state.stale)}
            Freshness: $freshness
            Signature Status: $signatureStatus
            Last Updated: ${DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(timestamp.atOffset(ZoneOffset.UTC))}

            Source: ${event.source}
            Source Metadata:
            $sourceMetadataSummary

            Integrity Metrics:
            $metricsSummary
        """.trimIndent()
    }

    private fun debugSummary(state: ResolvedTrustState): String {
        val event = state.event ?: return "No trust event available"
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

        return """
            Open trust detail panel:
              callsign=${event.callsign}
              trust_score=${String.format(Locale.US, "%.2f", event.trustScore)}
              trust_level=${derivedLevelLabel(state.displayLevel, state.stale)}
              last_updated=${Instant.ofEpochMilli(event.observedAtEpochMs)}
              stale=${state.stale}
              source=${event.source}
              source_metadata=$sourceMetadataSummary
              metrics=$metricsSummary
        """.trimIndent()
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

    private class TrustDetailDialogFragment : DialogFragment() {
        var onDismissCallback: (() -> Unit)? = null

        override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
            val title = requireArguments().getString(ARG_TITLE).orEmpty()
            val body = requireArguments().getString(ARG_BODY).orEmpty()
            isCancelable = true
            return AlertDialog.Builder(activity)
                .setTitle("Trust Detail • $title")
                .setMessage(body)
                .setPositiveButton("Close") { _, _ -> dismissAllowingStateLoss() }
                .create()
        }

        override fun onDismiss(dialog: android.content.DialogInterface?) {
            super.onDismiss(dialog)
            onDismissCallback?.invoke()
        }

        fun updateContent(title: String, body: String) {
            arguments = Bundle().apply {
                putString(ARG_TITLE, title)
                putString(ARG_BODY, body)
            }
            (dialog as? AlertDialog)?.apply {
                setTitle("Trust Detail • $title")
                setMessage(body)
            }
        }

        companion object {
            private const val ARG_TITLE = "title"
            private const val ARG_BODY = "body"

            fun newInstance(title: String, body: String): TrustDetailDialogFragment {
                return TrustDetailDialogFragment().apply {
                    arguments = Bundle().apply {
                        putString(ARG_TITLE, title)
                        putString(ARG_BODY, body)
                    }
                }
            }
        }
    }

    companion object {
        private const val PANEL_TAG = "aethercore.trust.detail.panel"
    }
}
