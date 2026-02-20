package com.aethercore.atak.trustoverlay.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustStateStoreTest {
    @Test
    fun storesLatestStatePerUid() {
        var now = 1_000L
        val store = TrustStateStore(ttlSeconds = 300, nowEpochMs = { now })

        val oldEvent = trustEvent(uid = "node-1", score = 30, level = TrustLevel.LOW)
        val newEvent = trustEvent(uid = "node-1", score = 95, level = TrustLevel.HIGH)

        store.record(oldEvent)
        now = 2_000L
        store.record(newEvent)

        val resolved = store.resolve("node-1")
        assertEquals(95, resolved.event?.score)
        assertEquals(TrustLevel.HIGH, resolved.displayLevel)
        assertFalse(resolved.stale)
    }

    @Test
    fun marksExpiredEntriesUnknownStaleAndUntrusted() {
        var now = 10_000L
        val store = TrustStateStore(ttlSeconds = 5, nowEpochMs = { now })

        store.record(trustEvent(uid = "node-2", score = 92, level = TrustLevel.HIGH))
        now = 16_001L

        val resolved = store.resolve("node-2")
        assertTrue(resolved.stale)
        assertTrue(resolved.untrusted)
        assertEquals(TrustLevel.UNKNOWN, resolved.displayLevel)
        assertEquals("Unknown/Stale", resolved.statusLabel)
    }

    @Test
    fun reportsFeedHealthByLastSeenTime() {
        var now = 100L
        val store = TrustStateStore(ttlSeconds = 3, nowEpochMs = { now })

        assertEquals(TrustFeedStatus.DEGRADED, store.feedStatus())

        store.record(trustEvent(uid = "node-3", score = 80, level = TrustLevel.MEDIUM))
        assertEquals(TrustFeedStatus.HEALTHY, store.feedStatus())

        now = 3_101L
        assertEquals(TrustFeedStatus.DEGRADED, store.feedStatus())
    }

    private fun trustEvent(uid: String, score: Int, level: TrustLevel): TrustEvent = TrustEvent(
        uid = uid,
        callsign = uid,
        lat = 0.0,
        lon = 0.0,
        level = level,
        score = score,
        source = "test",
        observedAtEpochMs = 0L,
    )
}
