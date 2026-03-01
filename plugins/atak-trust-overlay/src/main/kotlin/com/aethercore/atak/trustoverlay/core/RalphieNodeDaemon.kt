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
    private external fun nativeRegisterIdentity(nodeId: String, publicKeyBytes: ByteArray): Boolean
    private external fun nativeGetTrustScore(nodeId: String): Double
    private external fun nativeUpdateTrustScore(nodeId: String, delta: Double): Boolean
    private external fun nativeGetIdentityCount(): Int
    private external fun nativeHasIdentity(nodeId: String): Boolean

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

    /**
     * Register a node identity with the identity manager.
     * 
     * @param nodeId The unique identifier for the node
     * @param publicKey The Ed25519 public key (32 bytes)
     * @return true if registration succeeded, false otherwise
     */
    fun registerIdentity(nodeId: String, publicKey: ByteArray): Boolean {
        if (!jniLoaded) {
            Log.w(TAG, "Identity registration skipped: JNI library is unavailable.")
            return false
        }

        if (publicKey.size != 32) {
            Log.e(TAG, "Invalid public key length: expected 32 bytes, got ${publicKey.size}")
            return false
        }

        return try {
            nativeRegisterIdentity(nodeId, publicKey)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register identity for node_id=$nodeId", e)
            false
        }
    }

    /**
     * Get the current trust score for a node.
     * 
     * @param nodeId The unique identifier for the node
     * @return The trust score (0.0 to 1.0), or -1.0 if not found
     */
    fun getTrustScore(nodeId: String): Double {
        if (!jniLoaded) {
            Log.w(TAG, "Trust score query skipped: JNI library is unavailable.")
            return -1.0
        }

        return try {
            nativeGetTrustScore(nodeId)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get trust score for node_id=$nodeId", e)
            -1.0
        }
    }

    /**
     * Update the trust score for a node by applying a delta.
     * 
     * @param nodeId The unique identifier for the node
     * @param delta The change to apply to the trust score (-1.0 to +1.0)
     * @return true if update succeeded, false otherwise
     */
    fun updateTrustScore(nodeId: String, delta: Double): Boolean {
        if (!jniLoaded) {
            Log.w(TAG, "Trust score update skipped: JNI library is unavailable.")
            return false
        }

        if (delta !in -1.0..1.0) {
            Log.e(TAG, "Invalid trust score delta: must be between -1.0 and 1.0, got $delta")
            return false
        }

        return try {
            nativeUpdateTrustScore(nodeId, delta)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update trust score for node_id=$nodeId", e)
            false
        }
    }

    /**
     * Get the count of registered identities.
     * 
     * @return The number of registered identities, or -1 on error
     */
    fun getIdentityCount(): Int {
        if (!jniLoaded) {
            Log.w(TAG, "Identity count query skipped: JNI library is unavailable.")
            return -1
        }

        return try {
            nativeGetIdentityCount()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get identity count", e)
            -1
        }
    }

    /**
     * Check if an identity is registered.
     * 
     * @param nodeId The unique identifier for the node
     * @return true if identity is registered, false otherwise
     */
    fun hasIdentity(nodeId: String): Boolean {
        if (!jniLoaded) {
            Log.w(TAG, "Identity check skipped: JNI library is unavailable.")
            return false
        }

        return try {
            nativeHasIdentity(nodeId)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to check identity for node_id=$nodeId", e)
            false
        }
    }

    private fun getHardwareIdBinding(context: Context): String {
        cachedHardwareFingerprint?.let { return it }

        val fingerprint = runCatching {
            AndroidEnrollmentKeyManager.create(context).getHardwareFingerprint().trim()
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
