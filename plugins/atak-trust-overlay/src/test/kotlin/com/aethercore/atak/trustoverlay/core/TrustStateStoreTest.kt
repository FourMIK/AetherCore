package com.aethercore.atak.trustoverlay.core

import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.cot.CotFixtureLoader
import com.aethercore.atak.trustoverlay.cot.TrustEventParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustStateStoreTest {
    private val parser = TrustEventParser(TestLogger(), allowedSources = setOf("aethercore"))

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
    fun transitionsToUnknownStaleAfterTtlThreshold() {
        var now = 10_000L
        val store = TrustStateStore(ttlSeconds = 5, nowEpochMs = { now })
        val event = requireNotNull(parser.parse(CotFixtureLoader.load("stale")))

        store.record(event)

        now = 15_000L
        val atBoundary = store.resolve("stale-node")
        assertFalse(atBoundary.stale)
        assertEquals(TrustLevel.HIGH, atBoundary.displayLevel)

        now = 15_001L
        val stale = store.resolve("stale-node")
        assertTrue(stale.stale)
        assertTrue(stale.untrusted)
        assertEquals(TrustLevel.UNKNOWN, stale.displayLevel)
        assertEquals("Unknown/Stale", stale.statusLabel)
    }

    @Test
    fun feedDegradesWhenEventsStopArriving() {
        var now = 100L
        val store = TrustStateStore(ttlSeconds = 3, nowEpochMs = { now })

        assertEquals(TrustFeedStatus.DEGRADED, store.feedStatus())

        store.record(trustEvent(uid = "node-3", score = 80, level = TrustLevel.MEDIUM))
        assertEquals(TrustFeedStatus.HEALTHY, store.feedStatus())

        now = 3_100L
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
        trustScore = score / 100.0,
        source = "test",
        sourceMetadata = emptyMap(),
        metrics = emptyMap(),
        observedAtEpochMs = 0L,
    )

    private class TestLogger : Logger {
        override fun d(message: String) = Unit
        override fun w(message: String) = Unit
        override fun e(message: String, throwable: Throwable?) = Unit
    }
}
