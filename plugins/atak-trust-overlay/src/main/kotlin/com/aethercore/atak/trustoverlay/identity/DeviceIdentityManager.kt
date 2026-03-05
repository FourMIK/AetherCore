package com.aethercore.atak.trustoverlay.identity

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.aethercore.security.AndroidEnrollmentKeyManager
import net.i2p.crypto.eddsa.EdDSASecurityProvider
import net.i2p.crypto.eddsa.spec.EdDSANamedCurveTable
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator as JcaKeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.Security
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class DeviceIdentityManager(private val context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val enrollmentKeyManager = AndroidEnrollmentKeyManager.create(context)

    fun hardwareFingerprint(): String = enrollmentKeyManager.getHardwareFingerprint()

    fun deviceId(): String {
        val fingerprint = hardwareFingerprint()
        val sanitized = fingerprint.lowercase()
            .replace(Regex("[^a-z0-9]+"), "-")
            .trim('-')
        return "android-$sanitized"
    }

    fun publicKeyPem(): String {
        val keyPair = getOrCreateKeyPair()
        return toPem(keyPair.public)
    }

    fun publicKeyHex(): String {
        val keyPair = getOrCreateKeyPair()
        val encoded = keyPair.public.encoded
        return encoded.joinToString("") { byte -> "%02x".format(byte) }
    }

    fun sign(payload: ByteArray): String {
        val keyPair = getOrCreateKeyPair()
        val signature = Signature.getInstance("NONEwithEdDSA")
        signature.initSign(keyPair.private)
        signature.update(payload)
        val sigBytes = signature.sign()
        return sigBytes.joinToString("") { byte -> "%02x".format(byte) }
    }

    private fun getOrCreateKeyPair(): KeyPair {
        ensureEdDsaProvider()
        val existingPrivate = prefs.getString(PREF_PRIVATE_KEY, null)
        val existingIv = prefs.getString(PREF_PRIVATE_IV, null)
        val existingPublic = prefs.getString(PREF_PUBLIC_KEY, null)

        if (!existingPrivate.isNullOrBlank() && !existingIv.isNullOrBlank() && !existingPublic.isNullOrBlank()) {
            val privateBytes = decrypt(Base64.decode(existingPrivate, Base64.NO_WRAP), Base64.decode(existingIv, Base64.NO_WRAP))
            val publicBytes = Base64.decode(existingPublic, Base64.NO_WRAP)
            return KeyPair(
                restorePublicKey(publicBytes),
                restorePrivateKey(privateBytes)
            )
        }

        val generated = generateEd25519KeyPair()
        val encrypted = encrypt(generated.private.encoded)
        prefs.edit()
            .putString(PREF_PRIVATE_KEY, Base64.encodeToString(encrypted.ciphertext, Base64.NO_WRAP))
            .putString(PREF_PRIVATE_IV, Base64.encodeToString(encrypted.iv, Base64.NO_WRAP))
            .putString(PREF_PUBLIC_KEY, Base64.encodeToString(generated.public.encoded, Base64.NO_WRAP))
            .apply()
        return generated
    }

    private fun generateEd25519KeyPair(): KeyPair {
        val spec = EdDSANamedCurveTable.getByName("Ed25519")
            ?: throw IllegalStateException("Ed25519 curve unavailable")
        val keyPairGenerator = JcaKeyPairGenerator.getInstance("EdDSA", EdDSASecurityProvider.PROVIDER_NAME)
        keyPairGenerator.initialize(spec, SecureRandom())
        return keyPairGenerator.generateKeyPair()
    }

    private fun restorePrivateKey(encoded: ByteArray): PrivateKey {
        val factory = KeyFactory.getInstance("EdDSA", EdDSASecurityProvider.PROVIDER_NAME)
        return factory.generatePrivate(PKCS8EncodedKeySpec(encoded))
    }

    private fun restorePublicKey(encoded: ByteArray): PublicKey {
        val factory = KeyFactory.getInstance("EdDSA", EdDSASecurityProvider.PROVIDER_NAME)
        return factory.generatePublic(X509EncodedKeySpec(encoded))
    }

    private fun ensureEdDsaProvider() {
        if (Security.getProvider(EdDSASecurityProvider.PROVIDER_NAME) == null) {
            Security.addProvider(EdDSASecurityProvider())
        }
    }

    private fun toPem(publicKey: PublicKey): String {
        val base64 = Base64.encodeToString(publicKey.encoded, Base64.NO_WRAP)
        val chunked = base64.chunked(64).joinToString("\n")
        return "-----BEGIN PUBLIC KEY-----\n$chunked\n-----END PUBLIC KEY-----"
    }

    private fun encrypt(plaintext: ByteArray): EncryptedPayload {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateAesKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext)
        return EncryptedPayload(ciphertext, iv)
    }

    private fun decrypt(ciphertext: ByteArray, iv: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateAesKey(), GCMParameterSpec(128, iv))
        return cipher.doFinal(ciphertext)
    }

    private fun getOrCreateAesKey(): SecretKey {
        val keyStore = java.security.KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = keyStore.getKey(KEYSTORE_ALIAS, null) as? SecretKey
        if (existing != null) {
            return existing
        }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(
            KEYSTORE_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(false)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    private data class EncryptedPayload(
        val ciphertext: ByteArray,
        val iv: ByteArray,
    )

    companion object {
        private const val PREFS_NAME = "aethercore.identity"
        private const val PREF_PRIVATE_KEY = "ed25519.private.enc"
        private const val PREF_PRIVATE_IV = "ed25519.private.iv"
        private const val PREF_PUBLIC_KEY = "ed25519.public"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEYSTORE_ALIAS = "aethercore_ed25519_wrap"
    }
}
