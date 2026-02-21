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
    private val jniLoaded: Boolean
    private var startupIssue: RalphieDaemonStartupIssue? = null

    init {
        jniLoaded = try {
            System.loadLibrary("aethercore_jni")
            Log.i(TAG, "AetherCore JNI loaded successfully.")
            true
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "Failed to load AetherCore JNI library.", e)
            startupIssue = RalphieDaemonStartupIssue.JniUnavailable(e)
            false
        }
    }

    private external fun nativeInitialize(storagePath: String, hardwareId: String): Boolean
    private external fun nativeStartDaemon(): Boolean
    private external fun nativeStopDaemon(): Boolean
    private external fun nativeTriggerAethericSweep(): Boolean

    fun startupStatus(): RalphieDaemonStartupStatus {
        return startupIssue?.let { RalphieDaemonStartupStatus.Unavailable(it) }
            ?: RalphieDaemonStartupStatus.Ready
    }

    fun start(): Boolean {
        if (!jniLoaded) {
            Log.e(TAG, "RalphieNode daemon start aborted: JNI library is unavailable.")
            return false
        }

        val storagePath = context.filesDir.absolutePath
        val hardwareId = getHardwareIdBinding(context)

        return if (nativeInitialize(storagePath, hardwareId)) {
            nativeStartDaemon()
        } else {
            false
        }
    }

    fun stop() {
        if (!jniLoaded) {
            Log.w(TAG, "RalphieNode daemon stop skipped: JNI library is unavailable.")
            return
        }

        nativeStopDaemon()
    }

    fun forceSweep() {
        if (!jniLoaded) {
            Log.w(TAG, "RalphieNode daemon sweep skipped: JNI library is unavailable.")
            return
        }

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

sealed interface RalphieDaemonStartupStatus {
    data object Ready : RalphieDaemonStartupStatus
    data class Unavailable(val issue: RalphieDaemonStartupIssue) : RalphieDaemonStartupStatus
}

sealed interface RalphieDaemonStartupIssue {
    data class JniUnavailable(val cause: UnsatisfiedLinkError) : RalphieDaemonStartupIssue
}
