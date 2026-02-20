package com.aethercore.atak.trustoverlay.widget

import com.aethercore.atak.trustoverlay.atak.WidgetHost
import com.aethercore.atak.trustoverlay.atak.WidgetModel
import com.aethercore.atak.trustoverlay.core.TrustEvent

class TrustFeedHealthWidgetController(
    private val widgetHost: WidgetHost,
    private val enabled: Boolean,
) {
    private var totalEvents: Long = 0
    private var unhealthyEvents: Long = 0

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

        val unhealthyRatio = if (totalEvents == 0L) 0.0 else unhealthyEvents.toDouble() / totalEvents.toDouble()
        val severity = when {
            unhealthyRatio > 0.50 -> "high"
            unhealthyRatio > 0.20 -> "medium"
            else -> "low"
        }

        widgetHost.update(
            WidgetModel(
                id = WIDGET_ID,
                title = "Trust Feed",
                value = "events=$totalEvents, unhealthy=$unhealthyEvents",
                severity = severity,
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
