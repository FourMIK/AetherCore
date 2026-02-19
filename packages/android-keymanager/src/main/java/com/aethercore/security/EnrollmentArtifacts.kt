package com.aethercore.security

import android.content.Context

interface EnrollmentArtifactStore {
    fun readArtifacts(): EnrollmentOutputs?
    fun writeArtifacts(outputs: EnrollmentOutputs)
    fun hasValidArtifacts(): Boolean
}

class SharedPreferencesEnrollmentArtifactStore(
    context: Context,
    prefName: String = "aethercore_enrollment_artifacts"
) : EnrollmentArtifactStore {
    private val prefs = context.getSharedPreferences(prefName, Context.MODE_PRIVATE)

    override fun readArtifacts(): EnrollmentOutputs? {
        val cert = prefs.getString(KEY_CLIENT_CERT, null) ?: return null
        val bundle = prefs.getString(KEY_TRUST_BUNDLE, null) ?: return null
        val alias = prefs.getString(KEY_ALIAS, null) ?: return null
        val level = prefs.getString(KEY_LEVEL, null)?.let { SecurityLevel.valueOf(it) } ?: return null

        return EnrollmentOutputs(
            clientCertificatePem = cert,
            trustBundlePem = bundle,
            keyAlias = alias,
            keySecurityLevel = level
        )
    }

    override fun writeArtifacts(outputs: EnrollmentOutputs) {
        prefs.edit()
            .putString(KEY_CLIENT_CERT, outputs.clientCertificatePem)
            .putString(KEY_TRUST_BUNDLE, outputs.trustBundlePem)
            .putString(KEY_ALIAS, outputs.keyAlias)
            .putString(KEY_LEVEL, outputs.keySecurityLevel.name)
            .apply()
    }

    override fun hasValidArtifacts(): Boolean {
        val artifacts = readArtifacts() ?: return false
        return artifacts.clientCertificatePem.isNotBlank() &&
            artifacts.trustBundlePem.isNotBlank() &&
            artifacts.keyAlias.isNotBlank()
    }

    private companion object {
        const val KEY_CLIENT_CERT = "client_certificate_pem"
        const val KEY_TRUST_BUNDLE = "trust_bundle_pem"
        const val KEY_ALIAS = "key_alias"
        const val KEY_LEVEL = "key_security_level"
    }
}

class EnrollmentStartupGate(
    private val artifactStore: EnrollmentArtifactStore,
    private val keyAliasStore: KeyAliasStore,
    private val keyStore: KeyStoreFacade
) {
    fun assertServiceActivationAllowed() {
        val artifacts = artifactStore.readArtifacts()
            ?: throw IllegalStateException("Enrollment artifacts missing: run enrollment first")

        if (!artifactStore.hasValidArtifacts()) {
            throw IllegalStateException("Enrollment artifacts invalid: certificate/trust bundle/key reference required")
        }

        val persistedAlias = keyAliasStore.readAlias()
            ?: throw IllegalStateException("Enrollment key alias missing")

        if (persistedAlias != artifacts.keyAlias) {
            throw IllegalStateException("Enrollment key alias mismatch: expected ${artifacts.keyAlias}, found $persistedAlias")
        }

        keyStore.loadKeyReference(persistedAlias)
            ?: throw IllegalStateException("Enrollment key not present in Android Keystore for alias=$persistedAlias")
    }
}
