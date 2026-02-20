package com.aethercore.atak.trustoverlay.core

import android.content.Context
import android.util.Log

/**
 * JNI boundary for the AetherCore Rust implementation.
 */
class RalphieNodeDaemon(private val context: Context) {
    companion object {
        private const val TAG = "RalphieNodeDaemon"

        init {
            try {
                System.loadLibrary("aethercore_jni")
                Log.i(TAG, "AetherCore JNI loaded successfully.")
            } catch (e: UnsatisfiedLinkError) {
                Log.e(TAG, "Failed to load AetherCore JNI library.", e)
            }
        }
    }

    private external fun nativeInitialize(storagePath: String, hardwareId: String): Boolean
    private external fun nativeStartDaemon(): Boolean
    private external fun nativeStopDaemon(): Boolean
    private external fun nativeTriggerAethericSweep(): Boolean

    fun start(): Boolean {
        val storagePath = context.filesDir.absolutePath
        val hardwareId = getHardwareIdBinding()

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

    private fun getHardwareIdBinding(): String {
        return "ATAK-TPM-BINDING-STUB"
    }
}
