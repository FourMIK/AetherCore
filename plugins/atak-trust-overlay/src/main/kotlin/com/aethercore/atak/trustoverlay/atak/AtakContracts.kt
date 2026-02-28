package com.aethercore.atak.trustoverlay.atak

/**
 * Minimal ATAK-facing contracts to keep this scaffold testable and decoupled.
 * Replace these interfaces with concrete ATAK SDK types in integration.
 */
interface AtakMapComponent {
    fun onCreate(context: PluginContext)
    fun onDestroy()
}

interface PluginContext {
    val mapView: MapView
    val cotBus: CotBus
    val markerTapBus: MarkerTapBus
    val widgetHost: WidgetHost
    val logger: Logger
    val settings: PluginSettings
}

interface PluginSettings {
    fun getLong(key: String, defaultValue: Long): Long
}

interface Logger {
    fun d(message: String)
    fun w(message: String)
    fun e(message: String, throwable: Throwable? = null)
}

interface CotBus {
    fun subscribe(cotType: String, handler: (CotEventEnvelope) -> Unit): Subscription
}

interface MarkerTapBus {
    fun subscribe(handler: (MarkerHandle) -> Unit): Subscription
}

interface MapView {
    fun upsertMarker(marker: MarkerModel)
    fun removeMarker(markerId: String)
}

interface WidgetHost {
    fun show(widget: WidgetModel)
    fun update(widget: WidgetModel)
    fun hide(widgetId: String)
}

interface Subscription {
    fun dispose()
}

data class CotEventEnvelope(
    val uid: String,
    val type: String,
    val lat: Double? = null,
    val lon: Double? = null,
    val time: String? = null,
    val stale: String? = null,
    val detail: Map<String, String>,
)

data class MarkerModel(
    val id: String,
    val lat: Double,
    val lon: Double,
    val title: String,
    val subtitle: String,
    val iconKey: String,
)

data class MarkerHandle(
    val id: String,
)

data class WidgetModel(
    val id: String,
    val title: String,
    val value: String,
    val severity: String,
)
