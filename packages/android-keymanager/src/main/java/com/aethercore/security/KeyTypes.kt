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
    val alias: String,
    val securityLevel: String,
    val challengeB64: String,
    val certificateChainB64: List<String>
)
