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
) : ILifecycle {

    private var pluginContext: Context? = null
    private var mapView: MapView? = null

    private var ralphieDaemon: RalphieNodeDaemon? = null
    private var mapComponent: TrustOverlayMapComponent? = null
    private var cotBus: AtakCotBus? = null

    override fun onCreate(delegate: IServiceController?) {
        Log.i(TAG, "Bootstrapping AetherCore trust overlay")

        val resolvedContext = LifecycleBootstrapResolver.resolvePluginContext(delegate)
        val resolvedMapCandidate = LifecycleBootstrapResolver.resolveMapView(delegate)
        val resolvedMapView = resolvedMapCandidate as? MapView

        if (resolvedContext == null || resolvedMapView == null) {
            val missing = buildList {
                if (resolvedContext == null) add("Context")
                if (resolvedMapView == null) add("MapView")
            }.joinToString(separator = ", ")
            Log.e(TAG, "Aborting trust overlay initialization: unable to resolve $missing from ATAK lifecycle delegate")
            return
        }

        val runtimeVersion = AtakCompatibilityContract.validateRuntimeOrNull(resolvedContext)
        if (runtimeVersion == null) {
            Log.e(
                TAG,
                "Aborting trust overlay initialization: ATAK runtime does not satisfy minimum ${AtakCompatibilityContract.minimumSupportedVersion()}",
            )
            return
        }

        pluginContext = resolvedContext
        mapView = resolvedMapView

        val daemon = RalphieNodeDaemon(resolvedContext)
        val daemonStarted = when (val status = daemon.startupStatus()) {
            is RalphieDaemonStartupStatus.Unavailable -> {
                when (val issue = status.issue) {
                    is RalphieDaemonStartupIssue.JniUnavailable -> {
                        Log.w(
                            TAG,
                            "RalphieNode daemon disabled: ${issue.reason}.",
                            issue.cause,
                        )
                    }
                }
                false
            }

            RalphieDaemonStartupStatus.Ready -> {
                runCatching { daemon.start() }
                    .onFailure { Log.e(TAG, "RalphieNode daemon startup failed", it) }
                    .getOrDefault(false)
            }
        }
        ralphieDaemon = daemon.takeIf { daemonStarted }
        if (!daemonStarted) {
            return
        }

        val atakCotBus = AtakCotBus(
            context = resolvedContext,
            logger = AndroidLogger,
            onFeedDegraded = { reason ->
                AndroidLogger.w("CoT feed degraded: $reason")
            },
        )

        val context = object : PluginContext {
            override val mapView = AtakMapViewAdapter(resolvedMapView, AndroidLogger)
            override val cotBus = atakCotBus
            override val markerTapBus: MarkerTapBus = AtakMarkerTapBus(resolvedMapView, AndroidLogger)
            override val widgetHost = AtakWidgetHost(resolvedMapView, AndroidLogger)
            override val logger: Logger = AndroidLogger
            override val settings: PluginSettings = SharedPreferencesPluginSettings(resolvedContext)
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

    private class SharedPreferencesPluginSettings(
        private val context: Context
    ) : PluginSettings {
        private val prefs = context.getSharedPreferences("atak_trust_overlay", Context.MODE_PRIVATE)
        
        override fun getLong(key: String, defaultValue: Long): Long {
            return prefs.getLong(key, defaultValue)
        }
    }

    companion object {
        private const val TAG = "TrustOverlayLifecycle"
    }
}

internal object LifecycleBootstrapResolver {
    private val delegateContextMethods = listOf("getPluginContext", "getContext", "getApplicationContext")
    private val delegateMapMethods = listOf("getMapView", "getMapview")
    private val delegateContextFields = listOf("pluginContext", "context", "mContext")
    private val delegateMapFields = listOf("mapView", "mMapView")

    fun resolvePluginContext(delegate: Any?): Context? {
        val direct = invokeNoArg(delegate, delegateContextMethods) as? Context
            ?: readField(delegate, delegateContextFields) as? Context
        if (direct != null) {
            return direct
        }

        val mapContext = resolveMapView(delegate)?.let { mapView ->
            invokeNoArg(mapView, listOf("getContext", "getAndroidContext")) as? Context
        }
        if (mapContext != null) {
            return mapContext
        }

        val atakActivity = invokeStaticNoArg("com.atakmap.app.ATAKActivity", listOf("getInstance", "currentActivity"))
        val activityContext = invokeNoArg(atakActivity, listOf("getApplicationContext", "getBaseContext")) as? Context
        if (activityContext != null) {
            return activityContext
        }

        return invokeStaticNoArg("android.app.ActivityThread", listOf("currentApplication")) as? Context
    }

    fun resolveMapView(delegate: Any?): Any? {
        val direct = invokeNoArg(delegate, delegateMapMethods)
            ?: readField(delegate, delegateMapFields)
        if (direct != null) {
            return direct
        }

        return invokeStaticNoArg("com.atakmap.android.maps.MapView", listOf("getMapView", "getMapview"))
            ?: readStaticField("com.atakmap.android.maps.MapView", listOf("_mapView", "mapView", "instance"))
    }

    private fun invokeNoArg(target: Any?, methodNames: List<String>): Any? {
        if (target == null) return null
        val methods = target.javaClass.methods
        methodNames.forEach { methodName ->
            val method = methods.firstOrNull { it.name == methodName && it.parameterTypes.isEmpty() } ?: return@forEach
            return runCatching { method.invoke(target) }.getOrNull()
        }
        return null
    }

    private fun invokeStaticNoArg(className: String, methodNames: List<String>): Any? {
        val klass = runCatching { Class.forName(className) }.getOrNull() ?: return null
        val methods = klass.methods
        methodNames.forEach { methodName ->
            val method = methods.firstOrNull {
                it.name == methodName && it.parameterTypes.isEmpty() && java.lang.reflect.Modifier.isStatic(it.modifiers)
            } ?: return@forEach
            return runCatching { method.invoke(null) }.getOrNull()
        }
        return null
    }

    private fun readField(target: Any?, fieldNames: List<String>): Any? {
        if (target == null) return null
        fieldNames.forEach { fieldName ->
            val field = runCatching { target.javaClass.getDeclaredField(fieldName) }.getOrNull() ?: return@forEach
            field.isAccessible = true
            return runCatching { field.get(target) }.getOrNull()
        }
        return null
    }

    private fun readStaticField(className: String, fieldNames: List<String>): Any? {
        val klass = runCatching { Class.forName(className) }.getOrNull() ?: return null
        fieldNames.forEach { fieldName ->
            val field = runCatching { klass.getDeclaredField(fieldName) }.getOrNull() ?: return@forEach
            field.isAccessible = true
            return runCatching { field.get(null) }.getOrNull()
        }
        return null
    }
}
