package com.aethercore.security

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

interface EnrollmentHttpClient {
    fun postJson(url: String, payload: JSONObject): JSONObject
}

class UrlConnectionEnrollmentHttpClient : EnrollmentHttpClient {
    override fun postJson(url: String, payload: JSONObject): JSONObject {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10_000
            readTimeout = 10_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
        }

        OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
            writer.write(payload.toString())
        }

        val body = try {
            BufferedReader(connection.inputStream.reader()).use { it.readText() }
        } catch (ignored: Exception) {
            val error = connection.errorStream?.bufferedReader()?.use { it.readText() }
            throw IllegalStateException(
                "Enrollment request failed status=${connection.responseCode} body=${error ?: "<empty>"}"
            )
        } finally {
            connection.disconnect()
        }

        return JSONObject(body)
    }
}

data class EnrollmentHelloResponse(
    val sessionId: String,
    val challenge: ByteArray
)

data class EnrollmentOutputs(
    val clientCertificatePem: String,
    val trustBundlePem: String,
    val keyAlias: String,
    val keySecurityLevel: SecurityLevel
)

data class AndroidAttestationEvidence(
    val alias: String,
    val securityLevel: SecurityLevel,
    val securityProvenance: SecurityProvenance,
    val challenge: ByteArray,
    val challengeSignatureDer: ByteArray,
    val publicKeyDer: ByteArray,
    val certificateChainDer: List<ByteArray>
)

class AndroidEnrollmentClient(
    private val baseUrl: String,
    private val keyManager: AndroidEnrollmentKeyManager,
    private val artifacts: EnrollmentArtifactStore,
    private val httpClient: EnrollmentHttpClient = UrlConnectionEnrollmentHttpClient()
) {
    fun enroll(deviceId: String): EnrollmentOutputs {
        val hello = hello(deviceId)
        val provePayload = buildProvePayload(deviceId, hello)
        val proveResponse = httpClient.postJson(
            "$baseUrl/api/v1/enroll/prove",
            provePayload
        )

        val outputs = EnrollmentOutputs(
            clientCertificatePem = proveResponse.getString("client_certificate"),
            trustBundlePem = proveResponse.getString("trust_bundle"),
            keyAlias = proveResponse.optString("key_alias", provePayload.getString("key_alias")),
            keySecurityLevel = SecurityLevel.valueOf(
                proveResponse.optString("key_security_level", provePayload.getString("key_security_level"))
            )
        )

        artifacts.writeArtifacts(outputs)
        return outputs
    }

    private fun hello(deviceId: String): EnrollmentHelloResponse {
        val response = httpClient.postJson(
            "$baseUrl/api/v1/enroll/hello",
            JSONObject().put("device_id", deviceId)
        )

        val challenge = Base64.decode(response.getString("challenge_b64"), Base64.DEFAULT)
        return EnrollmentHelloResponse(
            sessionId = response.getString("session_id"),
            challenge = challenge
        )
    }

    private fun buildProvePayload(deviceId: String, hello: EnrollmentHelloResponse): JSONObject {
        val evidence = keyManager.collectAttestation(hello.challenge).toEvidence()
        val certChain = JSONArray().apply {
            evidence.certificateChainDer.forEach { put(it.toB64()) }
        }

        return JSONObject()
            .put("session_id", hello.sessionId)
            .put("device_id", deviceId)
            .put("key_alias", evidence.alias)
            .put("key_security_level", evidence.securityLevel.name)
            .put("key_security_provenance", evidence.securityProvenance.name)
            .put("challenge_b64", evidence.challenge.toB64())
            .put("challenge_signature_b64", evidence.challengeSignatureDer.toB64())
            .put("public_key_der_b64", evidence.publicKeyDer.toB64())
            .put("attestation_chain_b64", certChain)
    }

    private fun AttestationArtifact.toEvidence(): AndroidAttestationEvidence = AndroidAttestationEvidence(
        alias = alias,
        securityLevel = securityLevel,
        securityProvenance = securityProvenance,
        challenge = challenge,
        challengeSignatureDer = challengeSignatureDer,
        publicKeyDer = publicKeyDer,
        certificateChainDer = certificateChainDer
    )
}

private fun ByteArray.toB64(): String = Base64.encodeToString(this, Base64.NO_WRAP)
