package com.aethercore.atak.trustoverlay.core

import android.content.Context
import android.content.res.Configuration
import android.util.Log
import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.atak.MarkerTapBus
import com.aethercore.atak.trustoverlay.atak.PluginContext
import com.aethercore.atak.trustoverlay.atak.PluginSettings
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
    private var cotBus: AtakCotBus? = null

    override fun onCreate(delegate: IServiceController?) {
        Log.i(TAG, "Bootstrapping AetherCore trust overlay")

        ralphieDaemon = RalphieNodeDaemon(pluginContext).apply {
            when (val status = startupStatus()) {
                is RalphieDaemonStartupStatus.Unavailable -> {
                    when (val issue = status.issue) {
                        is RalphieDaemonStartupIssue.JniUnavailable -> {
                            Log.w(
                                TAG,
                                "RalphieNode daemon disabled: JNI library missing.",
                                issue.cause,
                            )
                            return
                        }
                    }
                }

                RalphieDaemonStartupStatus.Ready -> Unit
            }

            val success = runCatching { start() }
                .onFailure { Log.e(TAG, "RalphieNode daemon startup failed", it) }
                .getOrDefault(false)
            if (!success) {
                return
            }
        }

        val atakCotBus = AtakCotBus(
            context = pluginContext,
            logger = AndroidLogger,
            onFeedDegraded = { reason ->
                AndroidLogger.w("CoT feed degraded: $reason")
            },
        )

        val context = object : PluginContext {
            override val mapView = AtakMapViewAdapter(mapView, AndroidLogger)
            override val cotBus = atakCotBus
            override val markerTapBus: MarkerTapBus = AtakMarkerTapBus(mapView, AndroidLogger)
            override val widgetHost = AtakWidgetHost(mapView, AndroidLogger)
            override val logger: Logger = AndroidLogger
            override val settings: PluginSettings = DefaultPluginSettings
        }

        mapComponent = TrustOverlayMapComponent().apply {
            onCreate(context)
        }

        cotBus = atakCotBus
    }

    override fun onDestroy() {
        Log.w(TAG, "Executing trust overlay shutdown")

        cotBus?.stop()
        cotBus = null

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

    private object AndroidLogger : Logger {
        override fun d(message: String) = Log.d(TAG, message)
        override fun w(message: String) = Log.w(TAG, message)
        override fun e(message: String, throwable: Throwable?) = Log.e(TAG, message, throwable)
    }

    private object DefaultPluginSettings : PluginSettings {
        override fun getLong(key: String, defaultValue: Long): Long = defaultValue
    }

    companion object {
        private const val TAG = "TrustOverlayLifecycle"
    }
}
