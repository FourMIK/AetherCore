package com.aethercore.atak.trustoverlay.network

data class NodeSummary(
    val nodeId: String,
    val trustScore: Int,
    val status: String,
    val lastSeen: Long,
    val latitude: Double?,
    val longitude: Double?,
    val hardwareBacked: Boolean,
    val verified: Boolean,
)
