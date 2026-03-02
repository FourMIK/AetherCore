package com.aethercore.atak.trustoverlay.core

enum class TrustLevel {
    HIGH,
    MEDIUM,
    LOW,
    UNKNOWN,
}

enum class SignatureStatus {
    VERIFIED,
    UNVERIFIED,
    INVALID_OR_UNKNOWN,
}

data class TrustEvent(
    val uid: String,
    val callsign: String,
    val lat: Double,
    val lon: Double,
    val level: TrustLevel,
    val score: Int,
    val trustScore: Double,
    val source: String,
    val sourceMetadata: Map<String, String>,
    val metrics: Map<String, Double>,
    val observedAtEpochMs: Long,
    val signatureHex: String? = null,
    val signerNodeId: String? = null,
    val payloadHash: String? = null,
    val signatureStatus: SignatureStatus = SignatureStatus.INVALID_OR_UNKNOWN,
    val signatureVerified: Boolean = signatureStatus == SignatureStatus.VERIFIED,
)
