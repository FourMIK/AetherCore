package com.aethercore.security

import android.content.Context
import android.os.Build
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import java.security.ProviderException
import java.util.UUID

interface StrongBoxSupport {
    fun isStrongBoxSupported(): Boolean
}

class DeviceStrongBoxSupport : StrongBoxSupport {
    override fun isStrongBoxSupported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
}

class AndroidEnrollmentKeyManager(
    private val keyStore: KeyStoreFacade,
    private val aliasStore: KeyAliasStore,
    private val strongBoxSupport: StrongBoxSupport,
    private val aliasFactory: () -> String = { "aether_enroll_${UUID.randomUUID()}" }
) {
    companion object {
        fun create(context: Context): AndroidEnrollmentKeyManager {
            return AndroidEnrollmentKeyManager(
                keyStore = AndroidKeyStoreFacade(),
                aliasStore = SharedPreferencesKeyAliasStore(context),
                strongBoxSupport = DeviceStrongBoxSupport()
            )
        }
    }
    fun ensureEnrollmentKey(challenge: ByteArray): KeyReference {
        val persistedAlias = aliasStore.readAlias()
        if (persistedAlias != null) {
            val existing = keyStore.loadKeyReference(persistedAlias)
            if (existing != null) {
                return existing
            }
        }

        val alias = persistedAlias ?: aliasFactory()

        val generated = if (strongBoxSupport.isStrongBoxSupported()) {
            try {
                keyStore.generateKey(alias, useStrongBox = true, challenge = challenge)
            } catch (ex: Exception) {
                if (!ex.isStrongBoxUnavailable()) throw ex
                keyStore.generateKey(alias, useStrongBox = false, challenge = challenge)
            }
        } else {
            keyStore.generateKey(alias, useStrongBox = false, challenge = challenge)
        }

        aliasStore.writeReference(generated.alias, generated.securityLevel)
        return generated
    }

    fun securityLevel(): SecurityLevel? {
        val alias = aliasStore.readAlias() ?: return null
        return keyStore.loadKeyReference(alias)?.securityLevel ?: aliasStore.readSecurityLevel()
    }

    fun collectAttestation(challenge: ByteArray): AttestationArtifact {
        val key = ensureEnrollmentKey(challenge)
        return AttestationArtifact(
            alias = key.alias,
            securityLevel = key.securityLevel,
            securityProvenance = key.securityLevel.toSecurityProvenance(),
            challenge = challenge,
            challengeSignatureDer = keyStore.signWithPrivateKey(key.alias, challenge),
            publicKeyDer = keyStore.publicKeyDer(key.alias),
            certificateChainDer = key.attestationCertificateChainDer
        )
    }

    fun buildEnrollmentProvePayload(challenge: ByteArray): EnrollmentProvePayload {
        val artifact = collectAttestation(challenge)
        return EnrollmentProvePayload(
            keyAlias = artifact.alias,
            keySecurityLevel = artifact.securityLevel.name,
            keySecurityProvenance = artifact.securityProvenance.name,
            challengeB64 = challenge.toB64(),
            challengeSignatureB64 = artifact.challengeSignatureDer.toB64(),
            publicKeyDerB64 = artifact.publicKeyDer.toB64(),
            attestationChainB64 = artifact.certificateChainDer.map { it.toB64() }
        )
    }

    fun getHardwareFingerprint(): String {
        val persistedAlias = aliasStore.readAlias()
        val securityLevel = securityLevel()
        
        val components = listOf(
            Build.MANUFACTURER,
            Build.MODEL,
            Build.SERIAL,
            persistedAlias ?: "unbound",
            securityLevel?.name ?: "unknown"
        )
        
        return components.joinToString("-")
    }
}

private fun ByteArray.toB64(): String = Base64.encodeToString(this, Base64.NO_WRAP)

private fun Exception.isStrongBoxUnavailable(): Boolean {
    return this is StrongBoxUnavailableException || this is ProviderException
}
