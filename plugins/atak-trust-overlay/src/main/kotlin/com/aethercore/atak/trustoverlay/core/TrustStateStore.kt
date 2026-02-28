package com.aethercore.atak.trustoverlay.core

import kotlin.math.max

class TrustStateStore(
    ttlSeconds: Long = DEFAULT_TTL_SECONDS,
    private val nowEpochMs: () -> Long = { System.currentTimeMillis() },
) {
    private val ttlMs: Long = max(1L, ttlSeconds) * 1_000L
    private val latestByUid: MutableMap<String, StoredTrustState> = linkedMapOf()
    private var lastSeenEventEpochMs: Long? = null

    fun record(event: TrustEvent) {
        val receivedAtEpochMs = nowEpochMs()
        latestByUid[event.uid] = StoredTrustState(
            event = event,
            receivedAtEpochMs = receivedAtEpochMs,
        )
        lastSeenEventEpochMs = receivedAtEpochMs
    }

    fun resolve(uid: String): ResolvedTrustState {
        val state = latestByUid[uid] ?: return ResolvedTrustState.unknown(uid)
        return resolve(state)
    }

    fun allResolved(): List<ResolvedTrustState> = latestByUid.values.map(::resolve)

    fun feedStatus(): TrustFeedStatus {
        val lastSeen = lastSeenEventEpochMs ?: return TrustFeedStatus.DEGRADED
        val ageMs = nowEpochMs() - lastSeen
        return if (ageMs > ttlMs) TrustFeedStatus.DEGRADED else TrustFeedStatus.HEALTHY
    }

    fun ttlMs(): Long = ttlMs

    private fun resolve(state: StoredTrustState): ResolvedTrustState {
        val ageMs = nowEpochMs() - state.receivedAtEpochMs
        val stale = ageMs > ttlMs
        return if (stale) {
            ResolvedTrustState(
                uid = state.event.uid,
                event = state.event,
                displayLevel = TrustLevel.UNKNOWN,
                stale = true,
                untrusted = true,
                ageMs = ageMs,
                statusLabel = "Unknown/Stale",
            )
        } else {
            ResolvedTrustState(
                uid = state.event.uid,
                event = state.event,
                displayLevel = state.event.level,
                stale = false,
                untrusted = state.event.level == TrustLevel.LOW || state.event.level == TrustLevel.UNKNOWN,
                ageMs = ageMs,
                statusLabel = state.event.level.name,
            )
        }
    }

    companion object {
        const val DEFAULT_TTL_SECONDS: Long = 300L
    }
}

enum class TrustFeedStatus {
    HEALTHY,
    DEGRADED,
}

data class StoredTrustState(
    val event: TrustEvent,
    val receivedAtEpochMs: Long,
)

data class ResolvedTrustState(
    val uid: String,
    val event: TrustEvent?,
    val displayLevel: TrustLevel,
    val stale: Boolean,
    val untrusted: Boolean,
    val ageMs: Long,
    val statusLabel: String,
) {
    companion object {
        fun unknown(uid: String): ResolvedTrustState = ResolvedTrustState(
            uid = uid,
            event = null,
            displayLevel = TrustLevel.UNKNOWN,
            stale = true,
            untrusted = true,
            ageMs = Long.MAX_VALUE,
            statusLabel = "Unknown/Stale",
        )
    }
}
