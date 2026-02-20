package com.aethercore.atak.trustoverlay.core

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * ATAK plugin loader receiver entry point.
 *
 * In a concrete ATAK integration, this receiver should translate the ATAK bootstrap intent into
 * a [PluginContext] instance and pass it into [TrustOverlayMapComponent].
 */
class TrustOverlayPluginReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Hook for ATAK map component startup.
        // Left intentionally minimal as runtime object wiring differs by ATAK SDK variant.
    }
}
