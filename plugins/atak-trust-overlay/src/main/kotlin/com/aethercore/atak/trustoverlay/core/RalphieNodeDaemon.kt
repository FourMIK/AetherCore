package com.aethercore.atak.trustoverlay.core

import android.content.Context
import android.util.Log
import com.aethercore.security.AndroidEnrollmentKeyManager

/**
 * JNI boundary for the AetherCore Rust implementation.
 */
class RalphieNodeDaemon internal constructor(
    private val context: Context,
    private val libraryLoader: (String) -> Unit = { libraryName -> System.loadLibrary(libraryName) },
    private val nativeBindings: NativeBindings = NativeBindings(),
) {
    companion object {
        private const val TAG = "RalphieNodeDaemon"
    }

    private var cachedHardwareFingerprint: String? = null
    private val jniLoaded: Boolean
    private var startupIssue: RalphieDaemonStartupIssue? = null

    init {
        jniLoaded = try {
            libraryLoader("aethercore_jni")
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

    private val nativeBridge = object : NativeBridge {
        override fun initialize(storagePath: String, hardwareId: String): Boolean =
            nativeInitialize(storagePath, hardwareId)

        override fun startDaemon(): Boolean = nativeStartDaemon()

        override fun stopDaemon(): Boolean = nativeStopDaemon()

        override fun triggerSweep(): Boolean = nativeTriggerAethericSweep()
    }

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

        return if (nativeBindings.initialize(nativeBridge, storagePath, hardwareId)) {
            nativeBindings.start(nativeBridge)
        } else {
            false
        }
    }

    fun stop(): Boolean {
        if (!jniLoaded) {
            Log.w(TAG, "RalphieNode daemon stop skipped: JNI library is unavailable.")
            return false
        }

        return nativeBindings.stop(nativeBridge)
    }

    fun forceSweep(): Boolean {
        if (!jniLoaded) {
            Log.w(TAG, "RalphieNode daemon sweep skipped: JNI library is unavailable.")
            return false
        }

        return nativeBindings.forceSweep(nativeBridge)
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

internal interface NativeBridge {
    fun initialize(storagePath: String, hardwareId: String): Boolean
    fun startDaemon(): Boolean
    fun stopDaemon(): Boolean
    fun triggerSweep(): Boolean
}

internal open class NativeBindings {
    open fun initialize(nativeBridge: NativeBridge, storagePath: String, hardwareId: String): Boolean =
        nativeBridge.initialize(storagePath, hardwareId)

    open fun start(nativeBridge: NativeBridge): Boolean = nativeBridge.startDaemon()

    open fun stop(nativeBridge: NativeBridge): Boolean = nativeBridge.stopDaemon()

    open fun forceSweep(nativeBridge: NativeBridge): Boolean = nativeBridge.triggerSweep()
}

class HardwareBindingException(message: String, cause: Throwable? = null) : IllegalStateException(message, cause)

sealed interface RalphieDaemonStartupStatus {
    data object Ready : RalphieDaemonStartupStatus
    data class Unavailable(val issue: RalphieDaemonStartupIssue) : RalphieDaemonStartupStatus
}

sealed interface RalphieDaemonStartupIssue {
    val reason: String

    data class JniUnavailable(val cause: UnsatisfiedLinkError) : RalphieDaemonStartupIssue {
        override val reason: String = "JNI library unavailable"
    }
}
