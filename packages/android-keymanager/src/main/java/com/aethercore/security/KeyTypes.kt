package com.aethercore.security

data class KeyReference(
    val alias: String,
    val securityLevel: SecurityLevel,
    val attestationCertificateChainDer: List<ByteArray>
)

data class AttestationArtifact(
    val alias: String,
    val securityLevel: SecurityLevel,
    val challenge: ByteArray,
    val certificateChainDer: List<ByteArray>
)

data class EnrollmentProvePayload(
    val keyAlias: String,
    val keySecurityLevel: String,
    val challengeB64: String,
    val attestationChainB64: List<String>
)
