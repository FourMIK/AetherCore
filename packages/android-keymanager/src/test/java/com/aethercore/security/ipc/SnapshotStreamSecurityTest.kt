package com.aethercore.security.ipc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.charset.StandardCharsets
import java.security.KeyPairGenerator
import java.security.Signature

class SnapshotStreamSecurityTest {
    @Test
    fun `rejects unauthorized bind attempts with stable error code`() {
        val logger = RecordingLogger()
        val identity = FakeIdentityProvider(
            uid = 2001,
            packages = arrayOf("com.unauthorized.client"),
            packageDigests = mapOf("com.unauthorized.client" to setOf("deadbeef"))
        )
        val controller = BindAccessController(
            allowedCallerDigests = setOf("cafebabe"),
            identityProvider = identity,
            logger = logger
        )

        assertFalse(controller.authorizeCaller())
        assertEquals(SecurityErrorCodes.UNAUTHORIZED_CALLER, logger.lastCode)
    }

    @Test
    fun `rejects malformed payload freshness window`() {
        val logger = RecordingLogger()
        val verifier = SnapshotPayloadVerifier(
            keyResolver = { null },
            logger = logger
        )

        val payload = SnapshotIpcPayload(
            streamId = "status-stream",
            payload = "hello".toByteArray(),
            signature = byteArrayOf(1),
            keyId = "key-1",
            issuedAtEpochMs = 10_000,
            expiresAtEpochMs = 9_000,
            nonce = "n-1"
        )

        assertFalse(verifier.verify(payload, nowEpochMs = 10_500))
        assertEquals(SecurityErrorCodes.MALFORMED_PAYLOAD, logger.lastCode)
    }

    @Test
    fun `accepts valid payload signature and freshness`() {
        val logger = RecordingLogger()
        val keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val verifier = SnapshotPayloadVerifier(
            keyResolver = { keyId -> if (keyId == "key-1") keyPair.public else null },
            logger = logger
        )

        val unsigned = SnapshotIpcPayload(
            streamId = "snapshot-stream",
            payload = "snapshot-v1".toByteArray(StandardCharsets.UTF_8),
            signature = byteArrayOf(),
            keyId = "key-1",
            issuedAtEpochMs = 20_000,
            expiresAtEpochMs = 40_000,
            nonce = "nonce-42"
        )

        val signature = Signature.getInstance("Ed25519").apply {
            initSign(keyPair.private)
            update(verifier.buildSignedMaterial(unsigned))
        }.sign()

        val signed = unsigned.copy(signature = signature)

        assertTrue(verifier.verify(signed, nowEpochMs = 30_000))
    }
}

private class RecordingLogger : SecurityEventLogger {
    var lastCode: String? = null

    override fun warn(errorCode: String, message: String) {
        lastCode = errorCode
    }
}

private class FakeIdentityProvider(
    private val uid: Int,
    private val packages: Array<String>,
    private val packageDigests: Map<String, Set<String>>
) : CallerIdentityProvider {
    override fun uid(): Int = uid

    override fun packagesForUid(uid: Int): Array<String> = packages

    override fun signingDigestsSha256(packageName: String): Set<String> =
        packageDigests[packageName] ?: emptySet()
}
