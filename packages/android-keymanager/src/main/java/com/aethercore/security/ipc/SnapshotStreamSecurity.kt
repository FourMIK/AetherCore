package com.aethercore.security.ipc

import android.content.Context
import android.content.pm.PackageManager
import android.os.Binder
import android.util.Log
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.PublicKey
import java.security.Signature

object SecurityErrorCodes {
    const val UNAUTHORIZED_CALLER = "IPC-401"
    const val MALFORMED_PAYLOAD = "IPC-400"
    const val STALE_PAYLOAD = "IPC-408"
    const val INVALID_SIGNATURE = "IPC-498"
}

data class SnapshotIpcPayload(
    val streamId: String,
    val payload: ByteArray,
    val signature: ByteArray,
    val keyId: String,
    val issuedAtEpochMs: Long,
    val expiresAtEpochMs: Long,
    val nonce: String
)

interface SecurityEventLogger {
    fun warn(errorCode: String, message: String)
}

class AndroidSecurityEventLogger(private val tag: String = "AetherSnapshotIpc") : SecurityEventLogger {
    override fun warn(errorCode: String, message: String) {
        Log.w(tag, "[$errorCode] $message")
    }
}

interface CallerIdentityProvider {
    fun uid(): Int
    fun packagesForUid(uid: Int): Array<String>
    fun signingDigestsSha256(packageName: String): Set<String>
}

class AndroidCallerIdentityProvider(private val context: Context) : CallerIdentityProvider {
    override fun uid(): Int = Binder.getCallingUid()

    override fun packagesForUid(uid: Int): Array<String> =
        context.packageManager.getPackagesForUid(uid) ?: emptyArray()

    override fun signingDigestsSha256(packageName: String): Set<String> {
        val pkgInfo = context.packageManager.getPackageInfo(
            packageName,
            PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())
        )
        val signers = pkgInfo.signingInfo.apkContentsSigners ?: return emptySet()
        return signers.map { sig ->
            MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).toHex()
        }.toSet()
    }
}

class BindAccessController(
    private val allowedCallerDigests: Set<String>,
    private val identityProvider: CallerIdentityProvider,
    private val logger: SecurityEventLogger
) {
    fun authorizeCaller(): Boolean {
        val uid = identityProvider.uid()
        val packages = identityProvider.packagesForUid(uid)
        if (packages.isEmpty()) {
            logger.warn(SecurityErrorCodes.UNAUTHORIZED_CALLER, "Reject bind: uid=$uid has no packages")
            return false
        }

        val authorized = packages.any { pkg ->
            identityProvider.signingDigestsSha256(pkg).any { digest ->
                allowedCallerDigests.contains(digest)
            }
        }

        if (!authorized) {
            logger.warn(
                SecurityErrorCodes.UNAUTHORIZED_CALLER,
                "Reject bind: uid=$uid packages=${packages.joinToString()}")
        }
        return authorized
    }
}

class SnapshotPayloadVerifier(
    private val keyResolver: (String) -> PublicKey?,
    private val logger: SecurityEventLogger,
    private val maxClockSkewMs: Long = 30_000L
) {
    fun verify(payload: SnapshotIpcPayload, nowEpochMs: Long): Boolean {
        if (payload.streamId.isBlank() || payload.keyId.isBlank() || payload.nonce.isBlank()) {
            logger.warn(SecurityErrorCodes.MALFORMED_PAYLOAD, "Missing required payload fields")
            return false
        }
        if (payload.payload.isEmpty() || payload.signature.isEmpty()) {
            logger.warn(SecurityErrorCodes.MALFORMED_PAYLOAD, "Payload bytes/signature missing")
            return false
        }
        if (payload.expiresAtEpochMs <= payload.issuedAtEpochMs) {
            logger.warn(SecurityErrorCodes.MALFORMED_PAYLOAD, "Invalid freshness window")
            return false
        }
        if (nowEpochMs + maxClockSkewMs < payload.issuedAtEpochMs || nowEpochMs > payload.expiresAtEpochMs) {
            logger.warn(SecurityErrorCodes.STALE_PAYLOAD, "Payload outside freshness window")
            return false
        }

        val publicKey = keyResolver(payload.keyId)
        if (publicKey == null) {
            logger.warn(SecurityErrorCodes.INVALID_SIGNATURE, "No key for keyId=${payload.keyId}")
            return false
        }

        val signedMaterial = buildSignedMaterial(payload)
        val verifier = Signature.getInstance("Ed25519")
        verifier.initVerify(publicKey)
        verifier.update(signedMaterial)
        val valid = verifier.verify(payload.signature)
        if (!valid) {
            logger.warn(SecurityErrorCodes.INVALID_SIGNATURE, "Signature verification failed for keyId=${payload.keyId}")
        }
        return valid
    }

    fun buildSignedMaterial(payload: SnapshotIpcPayload): ByteArray {
        val meta = "${payload.streamId}|${payload.keyId}|${payload.issuedAtEpochMs}|${payload.expiresAtEpochMs}|${payload.nonce}|"
            .toByteArray(StandardCharsets.UTF_8)
        return meta + payload.payload
    }
}

private fun ByteArray.toHex(): String = joinToString(separator = "") { "%02x".format(it) }
