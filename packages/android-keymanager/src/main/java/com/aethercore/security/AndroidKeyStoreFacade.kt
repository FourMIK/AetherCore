package com.aethercore.security

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec

interface KeyStoreFacade {
    fun loadKeyReference(alias: String): KeyReference?
    fun generateKey(alias: String, useStrongBox: Boolean, challenge: ByteArray): KeyReference
    fun signWithPrivateKey(alias: String, challenge: ByteArray): ByteArray
    fun publicKeyDer(alias: String): ByteArray
}

class AndroidKeyStoreFacade : KeyStoreFacade {
    private val provider = "AndroidKeyStore"

    override fun loadKeyReference(alias: String): KeyReference? {
        val keyStore = KeyStore.getInstance(provider).apply { load(null) }
        val privateKey = keyStore.getKey(alias, null) ?: return null
        val chain = keyStore.getCertificateChain(alias) ?: return null
        val certs = chain.map { it.encoded }

        val keyInfo = KeyFactory.getInstance(privateKey.algorithm, provider)
            .getKeySpec(privateKey, KeyInfo::class.java)

        val level = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && keyInfo.isStrongBoxBacked) {
            SecurityLevel.STRONGBOX
        } else {
            SecurityLevel.TRUSTED_ENVIRONMENT
        }

        return KeyReference(alias = alias, securityLevel = level, attestationCertificateChainDer = certs)
    }

    override fun generateKey(alias: String, useStrongBox: Boolean, challenge: ByteArray): KeyReference {
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, provider)

        val builder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA512)
            .setAttestationChallenge(challenge)
            .setUserAuthenticationRequired(false)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            builder.setIsStrongBoxBacked(useStrongBox)
        }

        generator.initialize(builder.build())
        generator.generateKeyPair()

        return loadKeyReference(alias)
            ?: throw IllegalStateException("Failed to load generated key reference for alias=$alias")
    }

    override fun signWithPrivateKey(alias: String, challenge: ByteArray): ByteArray {
        val keyStore = KeyStore.getInstance(provider).apply { load(null) }
        val privateKey = keyStore.getKey(alias, null)
            ?: throw IllegalStateException("Private key not found for alias=$alias")

        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(privateKey as java.security.PrivateKey)
        signature.update(challenge)
        return signature.sign()
    }

    override fun publicKeyDer(alias: String): ByteArray {
        val keyStore = KeyStore.getInstance(provider).apply { load(null) }
        val certificate = keyStore.getCertificate(alias)
            ?: throw IllegalStateException("Certificate not found for alias=$alias")
        return certificate.publicKey.encoded
    }
}
