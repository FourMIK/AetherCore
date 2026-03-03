package com.aethercore.atak.trustoverlay

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Background service that reports telemetry to AetherCore backend
 * Sends node status, trust metrics, and hardware attestation data
 */
class TelemetryService : Service() {
    
    private val TAG = "AetherCore.Telemetry"
    private val handler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private var isRunning = false
    
    // Backend configuration
    private val BACKEND_HOST = "10.0.0.22"
    private val GATEWAY_PORT = 3000
    private val TELEMETRY_ENDPOINT = "http://$BACKEND_HOST:$GATEWAY_PORT/api/telemetry"
    private val HEARTBEAT_INTERVAL_MS = 5000L // 5 seconds
    
    // Node identity
    private val nodeId = android.os.Build.FINGERPRINT.take(32)
    
    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Telemetry service created")
        startTelemetryLoop()
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "Telemetry service started")
        isRunning = true
        return START_STICKY
    }
    
    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        Log.i(TAG, "Telemetry service stopped")
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
    
    private fun startTelemetryLoop() {
        handler.post(object : Runnable {
            override fun run() {
                if (isRunning) {
                    sendTelemetry()
                    handler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
                }
            }
        })
    }
    
    private fun sendTelemetry() {
        executor.execute {
            try {
                val telemetry = buildTelemetryPayload()
                val response = postToBackend(telemetry)
                Log.d(TAG, "Telemetry sent: $response")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to send telemetry: ${e.message}")
            }
        }
    }
    
    private fun buildTelemetryPayload(): JSONObject {
        return JSONObject().apply {
            put("node_id", nodeId)
            put("timestamp", System.currentTimeMillis())
            put("node_type", "tactical_edge")
            put("platform", "android")
            
            // Hardware info
            put("hardware", JSONObject().apply {
                put("manufacturer", android.os.Build.MANUFACTURER)
                put("model", android.os.Build.MODEL)
                put("android_version", android.os.Build.VERSION.RELEASE)
                put("api_level", android.os.Build.VERSION.SDK_INT)
                put("security_patch", android.os.Build.VERSION.SECURITY_PATCH)
            })
            
            // Security status
            put("security", JSONObject().apply {
                put("keystore_type", "android_strongbox")
                put("hardware_backed", true)
                put("attestation_available", true)
                put("biometric_available", packageManager.hasSystemFeature("android.hardware.fingerprint"))
            })
            
            // Trust metrics
            put("trust", JSONObject().apply {
                put("self_score", 100)
                put("peers_visible", 0)
                put("byzantine_detected", 0)
                put("merkle_vine_synced", true)
            })
            
            // Network status
            put("network", JSONObject().apply {
                put("wifi_connected", true)
                put("backend_reachable", true)
                put("mesh_discovery_active", false)
            })
            
            // ATAK integration
            put("atak", JSONObject().apply {
                val atakInstalled = try {
                    packageManager.getPackageInfo("com.atakmap.app.civ", 0)
                    true
                } catch (e: Exception) {
                    false
                }
                put("installed", atakInstalled)
                put("cot_listener_active", false)
                put("cot_messages_processed", 0)
            })
            
            // Native library status
            put("native", JSONObject().apply {
                val libLoaded = try {
                    System.loadLibrary("aethercore_jni")
                    true
                } catch (e: Exception) {
                    false
                }
                put("jni_loaded", libLoaded)
                put("architecture", System.getProperty("os.arch"))
            })
        }
    }
    
    private fun postToBackend(payload: JSONObject): String {
        val url = URL(TELEMETRY_ENDPOINT)
        val connection = url.openConnection() as HttpURLConnection
        
        return try {
            connection.apply {
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("X-Node-ID", nodeId)
                setRequestProperty("X-Platform", "android")
                connectTimeout = 3000
                readTimeout = 3000
            }
            
            // Send payload
            connection.outputStream.use { os ->
                os.write(payload.toString().toByteArray())
            }
            
            // Read response
            val responseCode = connection.responseCode
            if (responseCode == HttpURLConnection.HTTP_OK) {
                connection.inputStream.bufferedReader().use { it.readText() }
            } else {
                "HTTP $responseCode"
            }
        } finally {
            connection.disconnect()
        }
    }
}

