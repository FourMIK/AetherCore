package com.aethercore.atak.trustoverlay.core

import android.content.Context
import android.content.res.Configuration
import android.util.Log
import com.aethercore.atak.trustoverlay.atak.CotBus
import com.aethercore.atak.trustoverlay.atak.CotEventEnvelope
import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.atak.MapView as TrustOverlayMapView
import com.aethercore.atak.trustoverlay.atak.MarkerHandle
import com.aethercore.atak.trustoverlay.atak.MarkerModel
import com.aethercore.atak.trustoverlay.atak.MarkerTapBus
import com.aethercore.atak.trustoverlay.atak.PluginContext
import com.aethercore.atak.trustoverlay.atak.PluginSettings
import com.aethercore.atak.trustoverlay.atak.Subscription
import com.aethercore.atak.trustoverlay.atak.WidgetHost
import com.aethercore.atak.trustoverlay.atak.WidgetModel
import com.atakmap.android.maps.MapView
import gov.tak.api.plugin.ILifecycle
import gov.tak.api.plugin.IServiceController

/**
 * ATAK lifecycle manager for trust overlay startup and teardown.
 */
class TrustOverlayLifecycle(
    private val pluginContext: Context,
    private val mapView: MapView,
) : ILifecycle {

    private var ralphieDaemon: RalphieNodeDaemon? = null
    private var mapComponent: TrustOverlayMapComponent? = null

    override fun onCreate(delegate: IServiceController?) {
        Log.i(TAG, "Bootstrapping AetherCore trust overlay")

        ralphieDaemon = RalphieNodeDaemon(pluginContext).apply {
            val success = start()
            if (!success) {
                Log.e(TAG, "RalphieNode daemon startup failed")
                return
            }
        }

        val context = object : PluginContext {
            override val mapView: TrustOverlayMapView = NoOpMapView(mapView)
            override val cotBus: CotBus = NoOpCotBus
            override val markerTapBus: MarkerTapBus = NoOpMarkerTapBus
            override val widgetHost: WidgetHost = NoOpWidgetHost
            override val logger: Logger = AndroidLogger
            override val settings: PluginSettings = DefaultPluginSettings
        }

        mapComponent = TrustOverlayMapComponent().apply {
            onCreate(context)
        }
    }

    override fun onDestroy() {
        Log.w(TAG, "Executing trust overlay shutdown")

        mapComponent?.onDestroy()
        mapComponent = null

        ralphieDaemon?.stop()
        ralphieDaemon = null
    }

    override fun onStart() = Unit

    override fun onPause() = Unit

    override fun onResume() = Unit

    override fun onStop() = Unit

    override fun onConfigurationChanged(newConfig: Configuration?) = Unit

    private class NoOpMapView(
        @Suppress("unused")
        private val delegate: MapView,
    ) : TrustOverlayMapView {
        override fun upsertMarker(marker: MarkerModel) = Unit

        override fun removeMarker(markerId: String) = Unit
    }

    private object AndroidLogger : Logger {
        override fun d(message: String) {
            Log.d(TAG, message)
        }

        override fun w(message: String) {
            Log.w(TAG, message)
        }

        override fun e(message: String, throwable: Throwable?) {
            Log.e(TAG, message, throwable)
        }
    }

    private object NoOpCotBus : CotBus {
        override fun subscribe(cotType: String, handler: (CotEventEnvelope) -> Unit): Subscription {
            return NoOpSubscription
        }
    }

    private object NoOpMarkerTapBus : MarkerTapBus {
        override fun subscribe(handler: (MarkerHandle) -> Unit): Subscription {
            return NoOpSubscription
        }
    }

    private object NoOpWidgetHost : WidgetHost {
        override fun show(widget: WidgetModel) = Unit

        override fun update(widget: WidgetModel) = Unit

        override fun hide(widgetId: String) = Unit
    }

    private object NoOpSubscription : Subscription {
        override fun dispose() = Unit
    }

    private object DefaultPluginSettings : PluginSettings {
        override fun getLong(key: String, defaultValue: Long): Long = defaultValue
    }

    companion object {
        private const val TAG = "TrustOverlayLifecycle"
    }
}
