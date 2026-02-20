package com.aethercore.atak.trustoverlay.core

import android.content.Context
import android.util.Log
import com.aethercore.security.AndroidEnrollmentKeyManager

/**
 * JNI boundary for the AetherCore Rust implementation.
 */
class RalphieNodeDaemon(private val context: Context) {
    companion object {
        private const val TAG = "RalphieNodeDaemon"
    }

    private var cachedHardwareFingerprint: String? = null

    init {
        try {
            System.loadLibrary("aethercore_jni")
            Log.i(TAG, "AetherCore JNI loaded successfully.")
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "Failed to load AetherCore JNI library.", e)
        }
    }

    private external fun nativeInitialize(storagePath: String, hardwareId: String): Boolean
    private external fun nativeStartDaemon(): Boolean
    private external fun nativeStopDaemon(): Boolean
    private external fun nativeTriggerAethericSweep(): Boolean

    fun start(): Boolean {
        val storagePath = context.filesDir.absolutePath
        val hardwareId = getHardwareIdBinding(context)

        return if (nativeInitialize(storagePath, hardwareId)) {
            nativeStartDaemon()
        } else {
            false
        }
    }

    fun stop() {
        nativeStopDaemon()
    }

    fun forceSweep() {
        nativeTriggerAethericSweep()
    }

    private fun getHardwareIdBinding(context: Context): String {
        cachedHardwareFingerprint?.let { return it }

        val fingerprint = runCatching {
            AndroidEnrollmentKeyManager(context).getHardwareFingerprint().trim()
        }.getOrElse { throwable ->
            throw HardwareBindingException("Hardware fingerprint acquisition failed", throwable)
        }

        if (fingerprint.isBlank()) {
            throw HardwareBindingException("Hardware fingerprint acquisition returned blank result")
        }

        cachedHardwareFingerprint = fingerprint
        return fingerprint
    }
}

class HardwareBindingException(message: String, cause: Throwable? = null) : IllegalStateException(message, cause)
