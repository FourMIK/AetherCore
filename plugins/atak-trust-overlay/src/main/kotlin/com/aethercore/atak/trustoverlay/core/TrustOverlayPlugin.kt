package com.aethercore.atak.trustoverlay.core

import android.util.Log
import gov.tak.api.plugin.IPlugin
import gov.tak.api.plugin.IServiceController

/**
 * ATAK plugin entrypoint aligned with the official IPlugin extension contract.
 */
class TrustOverlayPlugin(
    private val serviceController: IServiceController,
) : IPlugin {
    private val lifecycle = TrustOverlayLifecycle()
    private var started = false

    override fun onStart() {
        if (started) {
            return
        }
        Log.i(TAG, "Starting TrustOverlayPlugin")
        lifecycle.onCreate(serviceController)
        lifecycle.onStart()
        started = true
    }

    override fun onStop() {
        if (!started) {
            return
        }
        Log.i(TAG, "Stopping TrustOverlayPlugin")
        lifecycle.onStop()
        lifecycle.onDestroy()
        started = false
    }

    companion object {
        private const val TAG = "TrustOverlayPlugin"
    }
}

