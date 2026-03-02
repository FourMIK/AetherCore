package com.aethercore.security

import android.content.Context
import android.os.Build
import android.util.Base64

/**
 * Hardware enrollment key manager for ATAK plugin
 * Provides device-specific identity binding
 */
class AndroidEnrollmentKeyManager private constructor(
    private val context: Context
) {
    companion object {
        fun create(context: Context): AndroidEnrollmentKeyManager {
            return AndroidEnrollmentKeyManager(context)
        }
    }

    /**
     * Get hardware fingerprint for device binding
     * Combines manufacturer, model, and serial into a stable identifier
     */
    fun getHardwareFingerprint(): String {
        val components = listOf(
            Build.MANUFACTURER,
            Build.MODEL,
            Build.SERIAL ?: "unknown",
            Build.FINGERPRINT
        )
        
        return components.joinToString("-")
            .replace(Regex("[^a-zA-Z0-9\\-_]"), "_")
            .take(256)
    }
}

