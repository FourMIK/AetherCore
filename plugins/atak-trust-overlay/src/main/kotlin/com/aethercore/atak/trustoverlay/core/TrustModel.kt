package com.aethercore.atak.trustoverlay.core

enum class TrustLevel {
    HIGH,
    MEDIUM,
    LOW,
    UNKNOWN,
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
)
