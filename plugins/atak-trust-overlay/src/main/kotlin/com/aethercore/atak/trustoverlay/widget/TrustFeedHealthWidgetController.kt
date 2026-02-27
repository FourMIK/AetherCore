package com.aethercore.atak.trustoverlay.widget

import com.aethercore.atak.trustoverlay.atak.WidgetHost
import com.aethercore.atak.trustoverlay.atak.WidgetModel
import com.aethercore.atak.trustoverlay.core.TrustEvent
import com.aethercore.atak.trustoverlay.core.TrustFeedStatus

class TrustFeedHealthWidgetController(
    private val widgetHost: WidgetHost,
    private val enabled: Boolean,
) {
    private var totalEvents: Long = 0
    private var unhealthyEvents: Long = 0
    private var malformedEvents: Long = 0
    private var latestMalformedReason: String? = null

    fun start() {
        if (!enabled) {
            return
        }

        widgetHost.show(
            WidgetModel(
                id = WIDGET_ID,
                title = "Trust Feed",
                value = "Initializing",
                severity = "info",
            ),
        )
    }

    fun onTrustEvent(event: TrustEvent) {
        if (!enabled) {
            return
        }

        totalEvents += 1
        if (event.level.name == "LOW" || event.level.name == "UNKNOWN") {
            unhealthyEvents += 1
        }
    }

    fun onMalformedEvent(totalMalformedEvents: Long, reason: String?) {
        if (!enabled) {
            return
        }

        malformedEvents = totalMalformedEvents
        latestMalformedReason = reason
    }

    fun onFeedStatus(status: TrustFeedStatus, ttlSeconds: Long) {
        if (!enabled) {
            return
        }

        val unhealthyRatio = if (totalEvents == 0L) 0.0 else unhealthyEvents.toDouble() / totalEvents.toDouble()
        val statusSeverity = if (status == TrustFeedStatus.DEGRADED) "high" else "low"
        val severity = if (status == TrustFeedStatus.DEGRADED || malformedEvents > 0L) {
            "high"
        } else {
            when {
                unhealthyRatio > 0.50 -> "high"
                unhealthyRatio > 0.20 -> "medium"
                else -> "low"
            }
        }

        val malformedSummary = if (malformedEvents == 0L) {
            "0"
        } else {
            "$malformedEvents(${latestMalformedReason ?: "unknown"})"
        }

        widgetHost.update(
            WidgetModel(
                id = WIDGET_ID,
                title = "Trust Feed",
                value = "status=${status.name.lowercase()}, ttl=${ttlSeconds}s, events=$totalEvents, unhealthy=$unhealthyEvents, malformed=$malformedSummary",
                severity = if (severity == "low") statusSeverity else severity,
            ),
        )
    }

    fun stop() {
        if (enabled) {
            widgetHost.hide(WIDGET_ID)
        }
    }

    companion object {
        private const val WIDGET_ID = "aethercore.trust.feed.health"
    }
}
