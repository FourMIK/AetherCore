package com.aethercore.atak.trustoverlay.core

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.util.Log
import com.atakmap.android.ipc.AtakBroadcast
import com.atakmap.android.maps.MapView

class TrustOverlayPluginReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val mapView = MapView.getMapView()
        if (mapView != null) {
            TrustOverlayRuntime.startIfNeeded(context.applicationContext, mapView)
            return
        }

        val delayedReceiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, i: Intent) {
                runCatching {
                    AtakBroadcast.getInstance().unregisterReceiver(this)
                }

                val readyMapView = MapView.getMapView() ?: return
                TrustOverlayRuntime.startIfNeeded(ctx.applicationContext, readyMapView)
            }
        }

        try {
            val filter = AtakBroadcast.DocumentedIntentFilter(COMPONENTS_CREATED_ACTION)
            AtakBroadcast.getInstance().registerReceiver(delayedReceiver, filter)
        } catch (t: Throwable) {
            Log.w(TAG, "AtakBroadcast unavailable; using Android receiver fallback", t)
            context.registerReceiver(delayedReceiver, IntentFilter(COMPONENTS_CREATED_ACTION))
        }
    }

    companion object {
        private const val TAG = "TrustOverlayPluginReceiver"
        private const val COMPONENTS_CREATED_ACTION = "com.atakmap.app.COMPONENTS_CREATED"
    }
}
