package com.aethercore.atak.trustoverlay.core

import android.content.Context
import android.util.Log
import com.atakmap.android.maps.MapView

object TrustOverlayRuntime {
    private const val TAG = "TrustOverlayRuntime"

    @Volatile
    private var lifecycle: TrustOverlayLifecycle? = null

    @Synchronized
    fun startIfNeeded(appContext: Context, mapView: MapView) {
        if (lifecycle != null) {
            return
        }

        lifecycle = TrustOverlayLifecycle(appContext, mapView).also {
            Log.i(TAG, "Starting trust overlay runtime")
            it.onCreate(null)
            it.onStart()
        }
    }

    @Synchronized
    fun stopIfRunning() {
        lifecycle?.let {
            it.onStop()
            it.onDestroy()
        }
        lifecycle = null
    }
}
