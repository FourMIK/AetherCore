package com.aethercore.atak.trustoverlay

import android.content.Context

object GatewayConfig {
    private const val PREFERENCES_NAME = "atak_trust_overlay"
    private const val PREFERENCE_GATEWAY_BASE_URL = "gateway.base.url"

    fun resolveGatewayBaseUrl(context: Context): String {
        val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        val configuredValue = preferences.getString(PREFERENCE_GATEWAY_BASE_URL, null)
        val candidate = configuredValue?.trim().takeUnless { it.isNullOrEmpty() } ?: BuildConfig.AETHERCORE_GATEWAY_URL
        return candidate.trimEnd('/')
    }
}

