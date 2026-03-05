package com.aethercore.atak.trustoverlay.network

import android.util.Log
import com.aethercore.atak.trustoverlay.identity.DeviceIdentityManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

class C2SocketClient(
    private val identityManager: DeviceIdentityManager,
    private val scope: CoroutineScope,
    private val onStatus: (C2Status) -> Unit,
    private val onInbound: (JSONObject) -> Unit,
) {
    private val client = OkHttpClient()
    private var socket: WebSocket? = null
    private var heartbeatJob: Job? = null
    private var sequence = 0
    private var previousMessageId: String? = null

    fun connect(wsUrl: String) {
        disconnect()
        onStatus(C2Status.Connecting)
        val request = Request.Builder().url(wsUrl).build()
        socket = client.newWebSocket(request, listener)
    }

    fun disconnect() {
        heartbeatJob?.cancel()
        heartbeatJob = null
        socket?.close(1000, "client_shutdown")
        socket = null
        onStatus(C2Status.Disconnected)
    }

    fun sendPresence(status: String, trustScore: Double) {
        val payload = linkedMapOf<String, Any?>(
            "status" to status,
            "trustScore" to trustScore,
            "public_key" to identityManager.publicKeyPem(),
        )
        sendEnvelope("presence", payload)
    }

    fun sendControl(command: String, parameters: Map<String, Any?> = emptyMap()) {
        val payload = linkedMapOf<String, Any?>(
            "command" to command,
            "parameters" to parameters,
        )
        sendEnvelope("control", payload)
    }

    private fun sendEnvelope(type: String, payload: Map<String, Any?>) {
        val socket = socket ?: return
        val senderId = identityManager.deviceId()
        sequence += 1
        val envelope = C2MessageCodec.createEnvelope(type, senderId, payload, previousMessageId, sequence)
        val signingPayload = C2MessageCodec.serializeForSigning(envelope)
        runCatching {
            val signatureHex = identityManager.sign(signingPayload.toByteArray(Charsets.UTF_8))
            previousMessageId = envelope["message_id"] as? String
            val json = C2MessageCodec.finalizeEnvelope(envelope, signatureHex)
            socket.send(json)
        }.onFailure { error ->
            Log.e(TAG, "Failed to sign/send envelope", error)
            onStatus(C2Status.Error(error.message ?: "signing failed"))
        }
    }

    private fun startPresenceHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch(Dispatchers.IO) {
            while (isActive) {
                sendPresence("online", 0.95)
                delay(HEARTBEAT_INTERVAL_MS)
            }
        }
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            onStatus(C2Status.Connected)
            startPresenceHeartbeat()
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            runCatching {
                val json = JSONObject(text)
                onInbound(json)
            }.onFailure { error ->
                Log.w(TAG, "Failed to parse inbound C2 message", error)
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.e(TAG, "C2 socket error", t)
            onStatus(C2Status.Error(t.message ?: "socket error"))
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            onStatus(C2Status.Disconnected)
        }
    }

    sealed class C2Status {
        data object Connecting : C2Status()
        data object Connected : C2Status()
        data object Disconnected : C2Status()
        data class Error(val reason: String) : C2Status()
    }

    companion object {
        private const val TAG = "AetherCore.C2"
        private const val HEARTBEAT_INTERVAL_MS = 5_000L
    }
}
