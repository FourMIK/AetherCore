package com.aethercore.security

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidEnrollmentClientIntegrationTest {

    @Test
    fun enroll_callsHelloThenProve_andPersistsArtifacts() {
        val keyStore = FakeKeyStoreFacade(strongBoxRequestThrows = false)
        val aliasStore = InMemoryAliasStore()
        val keyManager = AndroidEnrollmentKeyManager(
            keyStore = keyStore,
            aliasStore = aliasStore,
            strongBoxSupport = AlwaysStrongBoxSupport(false),
            aliasFactory = { "android-alias-1" }
        )
        val artifactStore = InMemoryEnrollmentArtifactStore()
        val http = SequenceHttpClient(
            responses = listOf(
                JSONObject("""{"session_id":"s-1","challenge_b64":"AQID"}"""),
                JSONObject("""{"client_certificate":"cert-pem","trust_bundle":"bundle-pem"}""")
            )
        )

        val client = AndroidEnrollmentClient(
            baseUrl = "https://enroll.test",
            keyManager = keyManager,
            artifacts = artifactStore,
            httpClient = http
        )

        val outputs = client.enroll("android-device-01")

        assertEquals("cert-pem", outputs.clientCertificatePem)
        assertEquals("bundle-pem", outputs.trustBundlePem)
        assertEquals("android-alias-1", outputs.keyAlias)
        assertEquals(listOf("https://enroll.test/api/v1/enroll/hello", "https://enroll.test/api/v1/enroll/prove"), http.urls)

        val provePayload = http.payloads[1]
        assertEquals("s-1", provePayload.getString("session_id"))
        assertEquals("android-device-01", provePayload.getString("device_id"))
        assertEquals("android-alias-1", provePayload.getString("key_alias"))
        assertEquals(SecurityLevel.TRUSTED_ENVIRONMENT.name, provePayload.getString("key_security_level"))
        assertEquals("AQID", provePayload.getString("challenge_b64"))
        assertEquals(1, provePayload.getJSONArray("attestation_chain_b64").length())
        assertTrue(artifactStore.hasValidArtifacts())
    }

    @Test(expected = IllegalStateException::class)
    fun enroll_failsWhenHelloResponseMissingChallenge() {
        val client = AndroidEnrollmentClient(
            baseUrl = "https://enroll.test",
            keyManager = buildKeyManager(),
            artifacts = InMemoryEnrollmentArtifactStore(),
            httpClient = SequenceHttpClient(
                responses = listOf(JSONObject("""{"session_id":"broken"}"""))
            )
        )

        client.enroll("android-device-01")
    }

    @Test(expected = IllegalStateException::class)
    fun startupGate_blocksActivationWhenArtifactsMissing() {
        val aliasStore = InMemoryAliasStore()
        val keyStore = FakeKeyStoreFacade(strongBoxRequestThrows = false)
        val gate = EnrollmentStartupGate(
            artifactStore = InMemoryEnrollmentArtifactStore(),
            keyAliasStore = aliasStore,
            keyStore = keyStore
        )

        gate.assertServiceActivationAllowed()
    }

    private fun buildKeyManager(): AndroidEnrollmentKeyManager = AndroidEnrollmentKeyManager(
        keyStore = FakeKeyStoreFacade(strongBoxRequestThrows = false),
        aliasStore = InMemoryAliasStore(),
        strongBoxSupport = AlwaysStrongBoxSupport(false),
        aliasFactory = { "android-alias" }
    )
}

private class InMemoryEnrollmentArtifactStore : EnrollmentArtifactStore {
    private var outputs: EnrollmentOutputs? = null

    override fun readArtifacts(): EnrollmentOutputs? = outputs

    override fun writeArtifacts(outputs: EnrollmentOutputs) {
        this.outputs = outputs
    }

    override fun hasValidArtifacts(): Boolean {
        val value = outputs ?: return false
        return value.clientCertificatePem.isNotBlank() && value.trustBundlePem.isNotBlank() && value.keyAlias.isNotBlank()
    }
}

private class SequenceHttpClient(private val responses: List<JSONObject>) : EnrollmentHttpClient {
    val urls = mutableListOf<String>()
    val payloads = mutableListOf<JSONObject>()
    private var idx = 0

    override fun postJson(url: String, payload: JSONObject): JSONObject {
        urls += url
        payloads += payload
        if (idx >= responses.size) {
            throw IllegalStateException("No mocked response for call index=$idx")
        }
        return responses[idx++]
    }
}

private class AlwaysStrongBoxSupport(private val supported: Boolean) : StrongBoxSupport {
    override fun isStrongBoxSupported(): Boolean = supported
}

private class InMemoryAliasStore : KeyAliasStore {
    private var alias: String? = null
    private var level: SecurityLevel? = null

    override fun readAlias(): String? = alias

    override fun readSecurityLevel(): SecurityLevel? = level

    override fun writeReference(alias: String, securityLevel: SecurityLevel) {
        this.alias = alias
        this.level = securityLevel
    }
}

private class FakeKeyStoreFacade(private val strongBoxRequestThrows: Boolean) : KeyStoreFacade {
    private val keys = mutableMapOf<String, KeyReference>()

    override fun loadKeyReference(alias: String): KeyReference? = keys[alias]

    override fun generateKey(alias: String, useStrongBox: Boolean, challenge: ByteArray): KeyReference {
        if (useStrongBox && strongBoxRequestThrows) {
            throw IllegalStateException("StrongBox unavailable")
        }

        val reference = KeyReference(
            alias = alias,
            securityLevel = if (useStrongBox) SecurityLevel.STRONGBOX else SecurityLevel.TRUSTED_ENVIRONMENT,
            attestationCertificateChainDer = listOf("cert-$alias".toByteArray())
        )
        keys[alias] = reference
        return reference
    }
}
