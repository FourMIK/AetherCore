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
    val source: String,
    val observedAtEpochMs: Long,
)
