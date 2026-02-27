package com.aethercore.security.ipc


import android.content.pm.PackageManager
import android.os.Build
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

    @Test
    fun `uses api33 signer lookup and returns deterministic lowercase sha256 digests`() {
        val digestSet = signingDigestsSha256(
            packageName = "com.aether.client",
            sdkInt = Build.VERSION_CODES.TIRAMISU,
            getSignersApi33 = { arrayOf(byteArrayOf(1, 2, 3), byteArrayOf(1, 2, 3)) },
            getSignersLegacy = { error("legacy path should not be called") },
            onWarning = { _, _ -> error("warning should not be emitted") }
        )

        assertEquals(
            setOf("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"),
            digestSet
        )
    }

    @Test
    fun `uses legacy signer lookup below api33`() {
        var legacyCalled = false
        val digestSet = signingDigestsSha256(
            packageName = "com.aether.legacy",
            sdkInt = Build.VERSION_CODES.S_V2,
            getSignersApi33 = { error("api33 path should not be called") },
            getSignersLegacy = {
                legacyCalled = true
                arrayOf(byteArrayOf(9))
            },
            onWarning = { _, _ -> error("warning should not be emitted") }
        )

        assertTrue(legacyCalled)
        assertEquals(setOf("2b4c342f5433ebe591a1da77e013d1b72475562d48578c95cd7e8f5e278e5022"), digestSet)
    }

    @Test
    fun `returns empty set and warns when package does not exist`() {
        var warned = false

        val digestSet = signingDigestsSha256(
            packageName = "missing.package",
            sdkInt = Build.VERSION_CODES.TIRAMISU,
            getSignersApi33 = { throw PackageManager.NameNotFoundException("missing") },
            getSignersLegacy = { emptyArray() },
            onWarning = { message, error ->
                warned = true
                assertTrue(message.contains("missing.package"))
                assertTrue(error is PackageManager.NameNotFoundException)
            }
        )

        assertTrue(warned)
        assertTrue(digestSet.isEmpty())
    }

    @Test
    fun `returns empty set and warns when signature access is denied`() {
        var warned = false

        val digestSet = signingDigestsSha256(
            packageName = "restricted.package",
            sdkInt = Build.VERSION_CODES.S,
            getSignersApi33 = { emptyArray() },
            getSignersLegacy = { throw SecurityException("denied") },
            onWarning = { message, error ->
                warned = true
                assertTrue(message.contains("restricted.package"))
                assertTrue(error is SecurityException)
            }
        )

        assertTrue(warned)
        assertTrue(digestSet.isEmpty())
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
