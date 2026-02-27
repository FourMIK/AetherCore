package com.aethercore.security.ipc

import android.app.Service
import android.content.Intent
import android.os.Bundle
import android.os.IBinder
import android.os.RemoteCallbackList
import android.os.RemoteException

class SnapshotStreamService : Service() {
    private val callbacks = RemoteCallbackList<IStatusEventListener>()

    internal var accessControllerFactory: ((SnapshotStreamService) -> BindAccessController)? = null
    internal var verifierFactory: ((SnapshotStreamService) -> SnapshotPayloadVerifier)? = null

    private val logger: SecurityEventLogger = AndroidSecurityEventLogger()

    private val binder = object : ISnapshotStreamService.Stub() {
        override fun registerListener(listener: IStatusEventListener?) {
            if (listener == null || !authorizeCaller()) {
                return
            }
            callbacks.register(listener)
        }

        override fun unregisterListener(listener: IStatusEventListener?) {
            if (listener == null || !authorizeCaller()) {
                return
            }
            callbacks.unregister(listener)
        }

        override fun publishSnapshot(snapshotPayload: Bundle?) {
            if (!authorizeCaller()) {
                return
            }
            val parsed = snapshotPayload?.toPayload()
            if (parsed == null) {
                logger.warn(SecurityErrorCodes.MALFORMED_PAYLOAD, "Snapshot payload missing required fields")
                return
            }

            val verifier = getVerifier()
            if (!verifier.verify(parsed, System.currentTimeMillis())) {
                return
            }

            broadcastSnapshot(snapshotPayload)
            broadcastStatus(bundleOfStatus("snapshot.accepted", parsed.streamId, parsed.issuedAtEpochMs))
        }
    }

    override fun onBind(intent: Intent?): IBinder? {
        return if (authorizeCaller()) binder else null
    }

    private fun authorizeCaller(): Boolean = getAccessController().authorizeCaller()

    private fun getAccessController(): BindAccessController {
        return accessControllerFactory?.invoke(this)
            ?: BindAccessController(emptySet(), AndroidCallerIdentityProvider(this), logger)
    }

    private fun getVerifier(): SnapshotPayloadVerifier {
        return verifierFactory?.invoke(this)
            ?: SnapshotPayloadVerifier(
                keyResolver = { _ -> null },
                logger = logger
            )
    }

    private fun broadcastSnapshot(bundle: Bundle) {
        val count = callbacks.beginBroadcast()
        try {
            for (i in 0 until count) {
                try {
                    callbacks.getBroadcastItem(i).onSnapshotEvent(bundle)
                } catch (_: RemoteException) {
                }
            }
        } finally {
            callbacks.finishBroadcast()
        }
    }

    private fun broadcastStatus(bundle: Bundle) {
        val count = callbacks.beginBroadcast()
        try {
            for (i in 0 until count) {
                try {
                    callbacks.getBroadcastItem(i).onStatusEvent(bundle)
                } catch (_: RemoteException) {
                }
            }
        } finally {
            callbacks.finishBroadcast()
        }
    }
}

private fun Bundle.toPayload(): SnapshotIpcPayload? {
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

private fun bundleOfStatus(code: String, streamId: String, timestampMs: Long): Bundle = Bundle().apply {
    putString(SnapshotIpcContract.KEY_STATUS_CODE, code)
    putString(SnapshotIpcContract.KEY_STREAM_ID, streamId)
    putLong(SnapshotIpcContract.KEY_ISSUED_AT_MS, timestampMs)
}

object SnapshotIpcContract {
    const val BIND_PERMISSION = "com.aethercore.security.permission.SNAPSHOT_STREAM_BIND"
    const val KEY_STREAM_ID = "stream_id"
    const val KEY_PAYLOAD_BYTES = "payload"
    const val KEY_SIGNATURE_BYTES = "signature"
    const val KEY_KEY_ID = "key_id"
    const val KEY_ISSUED_AT_MS = "issued_at_ms"
    const val KEY_EXPIRES_AT_MS = "expires_at_ms"
    const val KEY_NONCE = "nonce"
    const val KEY_STATUS_CODE = "status_code"
}
