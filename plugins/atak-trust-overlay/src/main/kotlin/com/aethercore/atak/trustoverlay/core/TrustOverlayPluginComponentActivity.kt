package com.aethercore.atak.trustoverlay.core

import android.app.Activity
import android.os.Bundle

/**
 * ATAK component-discovery activity.
 *
 * ATAK discovers plugins via an exported activity that advertises
 * `com.atakmap.app.component`; this class intentionally shows no UI.
 */
class TrustOverlayPluginComponentActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        finish()
    }
}

