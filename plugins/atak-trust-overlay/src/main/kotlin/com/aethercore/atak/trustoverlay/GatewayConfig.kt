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

    fun resolveGatewayWebSocketUrl(context: Context): String {
        val baseUrl = resolveGatewayBaseUrl(context)
        return when {
            baseUrl.startsWith("https://") -> baseUrl.replaceFirst("https://", "wss://")
            baseUrl.startsWith("http://") -> baseUrl.replaceFirst("http://", "ws://")
            else -> "ws://$baseUrl"
        }
    }

    fun persistGatewayBaseUrl(context: Context, url: String) {
        val sanitized = url.trim().trimEnd('/')
        val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        preferences.edit().putString(PREFERENCE_GATEWAY_BASE_URL, sanitized).apply()
    }
}
