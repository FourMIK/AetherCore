package com.aethercore.security.ipc

import android.os.Bundle

class PluginSnapshotConsumer(
    private val verifier: SnapshotPayloadVerifier
) {
    fun acceptInboundPayload(payloadBundle: Bundle, nowEpochMs: Long): Boolean {
        val payload = payloadBundle.toPluginPayload() ?: return false
        return verifier.verify(payload, nowEpochMs)
    }
}

private fun Bundle.toPluginPayload(): SnapshotIpcPayload? {
    val streamId = getString(SnapshotIpcContract.KEY_STREAM_ID) ?: return null
    val payload = getByteArray(SnapshotIpcContract.KEY_PAYLOAD_BYTES) ?: return null
    val signature = getByteArray(SnapshotIpcContract.KEY_SIGNATURE_BYTES) ?: return null
    val keyId = getString(SnapshotIpcContract.KEY_KEY_ID) ?: return null
    val nonce = getString(SnapshotIpcContract.KEY_NONCE) ?: return null
    val issuedAt = getLong(SnapshotIpcContract.KEY_ISSUED_AT_MS, -1)
    val expiresAt = getLong(SnapshotIpcContract.KEY_EXPIRES_AT_MS, -1)
    if (issuedAt < 0 || expiresAt < 0) return null

    return SnapshotIpcPayload(
        streamId = streamId,
        payload = payload,
        signature = signature,
        keyId = keyId,
        issuedAtEpochMs = issuedAt,
        expiresAtEpochMs = expiresAt,
        nonce = nonce
    )
}
