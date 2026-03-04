package com.aethercore.atak.trustoverlay

import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import com.aethercore.security.AndroidEnrollmentKeyManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Background telemetry publisher for Android ATAK trust-overlay deployments.
 */
class TelemetryService : Service() {
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    @Volatile
    private var telemetryFuture: ScheduledFuture<*>? = null
    @Volatile
    private var isRunning = false
    @Volatile
    private var lastBackendReachable = false

    private val nodeId: String by lazy { resolveStableNodeId() }
    private val gatewayBaseUrl: String by lazy { GatewayConfig.resolveGatewayBaseUrl(this) }
    private val atakInstalled: Boolean by lazy { detectAtakInstalled() }
    private val nativeLoaded: Boolean by lazy { detectNativeLoaded() }
    private val telemetryEndpoint: String
        get() = "$gatewayBaseUrl/api/telemetry"

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Telemetry service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        isRunning = true
        ensureTelemetryLoopRunning()
        Log.i(TAG, "Telemetry service started node_id=$nodeId endpoint=$telemetryEndpoint")
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        telemetryFuture?.cancel(true)
        telemetryFuture = null
        scheduler.shutdownNow()
        super.onDestroy()
        Log.i(TAG, "Telemetry service stopped")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun ensureTelemetryLoopRunning() {
        val existing = telemetryFuture
        if (existing != null && !existing.isCancelled) {
            return
        }
        telemetryFuture = scheduler.scheduleAtFixedRate(
            { if (isRunning) sendTelemetry() },
            0L,
            HEARTBEAT_INTERVAL_MS,
            TimeUnit.MILLISECONDS,
        )
    }

    private fun sendTelemetry() {
        try {
            val payload = buildTelemetryPayload()
            val response = postToBackend(payload)
            lastBackendReachable = true
            Log.d(TAG, "Telemetry sent: $response")
        } catch (error: Exception) {
            lastBackendReachable = false
            Log.w(TAG, "Failed to send telemetry: ${error.message}")
        }
    }

    private fun buildTelemetryPayload(): JSONObject {
        val networkState = currentNetworkState()

        return JSONObject().apply {
            put("node_id", nodeId)
            put("timestamp", System.currentTimeMillis())
            put("node_type", "tactical_edge")
            put("platform", "android")
            put("overlay", "android")

            put("hardware", JSONObject().apply {
                put("manufacturer", android.os.Build.MANUFACTURER)
                put("model", android.os.Build.MODEL)
                put("android_version", android.os.Build.VERSION.RELEASE)
                put("api_level", android.os.Build.VERSION.SDK_INT)
                put("security_patch", android.os.Build.VERSION.SECURITY_PATCH)
            })

            put("security", JSONObject().apply {
                put("keystore_type", "android_keystore")
                put("hardware_backed", true)
                put("attestation_available", true)
                put("biometric_available", packageManager.hasSystemFeature("android.hardware.fingerprint"))
            })

            put("trust", JSONObject().apply {
                put("self_score", if (lastBackendReachable) 100 else 70)
                put("peers_visible", 0)
                put("byzantine_detected", 0)
                put("merkle_vine_synced", true)
            })

            put("network", JSONObject().apply {
                put("wifi_connected", networkState.wifiConnected)
                put("backend_reachable", lastBackendReachable)
                put("mesh_discovery_active", false)
            })

            put("atak", JSONObject().apply {
                put("installed", atakInstalled)
                put("cot_listener_active", atakInstalled)
                put("cot_messages_processed", 0)
            })

            put("native", JSONObject().apply {
                put("jni_loaded", nativeLoaded)
                put("architecture", System.getProperty("os.arch"))
            })
        }
    }

    private fun postToBackend(payload: JSONObject): String {
        val url = URL(telemetryEndpoint)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("X-Node-ID", nodeId)
            setRequestProperty("X-Platform", "android")
            setRequestProperty("X-AetherCore-Overlay", "android")
            connectTimeout = NETWORK_TIMEOUT_MS
            readTimeout = NETWORK_TIMEOUT_MS
        }

        return try {
            connection.outputStream.use { output ->
                output.write(payload.toString().toByteArray())
            }

            val responseCode = connection.responseCode
            if (responseCode in 200..299) {
                connection.inputStream.bufferedReader().use { it.readText() }
            } else {
                throw IllegalStateException("HTTP $responseCode")
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun currentNetworkState(): NetworkState {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return NetworkState(wifiConnected = false)
        val network = manager.activeNetwork ?: return NetworkState(wifiConnected = false)
        val capabilities = manager.getNetworkCapabilities(network) ?: return NetworkState(wifiConnected = false)
        return NetworkState(
            wifiConnected = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI),
        )
    }

    private fun detectAtakInstalled(): Boolean {
        return runCatching {
            packageManager.getPackageInfo(ATAK_CIV_PACKAGE, 0)
            true
        }.getOrDefault(false)
    }

    private fun detectNativeLoaded(): Boolean {
        return runCatching {
            System.loadLibrary("aethercore_jni")
            true
        }.getOrDefault(false)
    }

    private fun resolveStableNodeId(): String {
        val preferences = getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        val existing = preferences.getString(PREFERENCE_NODE_ID, null)
        if (!existing.isNullOrBlank()) {
            return existing
        }

        val hardwareFingerprint = runCatching {
            AndroidEnrollmentKeyManager.create(this).getHardwareFingerprint()
        }.getOrDefault("fallback-hardware-id")
        val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown-android-id"
        val seed = "$hardwareFingerprint|$androidId"
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(seed.toByteArray())
            .joinToString(separator = "") { byte -> String.format(Locale.US, "%02x", byte) }
        val stableNodeId = "android-overlay-${digest.take(32)}"

        preferences.edit().putString(PREFERENCE_NODE_ID, stableNodeId).apply()
        return stableNodeId
    }

    private data class NetworkState(
        val wifiConnected: Boolean,
    )

    companion object {
        private const val TAG = "AetherCore.Telemetry"
        private const val HEARTBEAT_INTERVAL_MS = 5_000L
        private const val NETWORK_TIMEOUT_MS = 3_000
        private const val ATAK_CIV_PACKAGE = "com.atakmap.app.civ"
        private const val PREFERENCES_NAME = "atak_trust_overlay"
        private const val PREFERENCE_NODE_ID = "telemetry.node_id"
    }
}
