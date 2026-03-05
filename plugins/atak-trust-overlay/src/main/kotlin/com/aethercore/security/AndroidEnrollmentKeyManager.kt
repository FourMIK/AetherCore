package com.aethercore.security

import android.content.Context
import android.os.Build
import android.provider.Settings
import java.security.MessageDigest
import java.util.Locale

/**
 * Hardware enrollment key manager for ATAK trust-overlay identity binding.
 */
class AndroidEnrollmentKeyManager private constructor(
    private val context: Context,
) {
    companion object {
        fun create(context: Context): AndroidEnrollmentKeyManager = AndroidEnrollmentKeyManager(context)
    }

    /**
     * Returns a stable, device-scoped fingerprint suitable for node identity binding.
     * The raw hardware attributes are hashed to avoid exposing device PII directly.
     */
    fun getHardwareFingerprint(): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID).orEmpty()
        val components = listOf(
            Build.MANUFACTURER,
            Build.BRAND,
            Build.MODEL,
            Build.DEVICE,
            Build.BOARD,
            Build.HARDWARE,
            Build.FINGERPRINT,
            androidId,
        ).map { token ->
            token.trim().ifEmpty { "unknown" }
        }
        val canonical = components.joinToString(separator = "|")
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray())
        return digest.joinToString(separator = "") { byte -> String.format(Locale.US, "%02x", byte) }
    }
}

