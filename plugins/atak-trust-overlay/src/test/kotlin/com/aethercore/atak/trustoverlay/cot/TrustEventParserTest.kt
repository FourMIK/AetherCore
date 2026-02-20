package com.aethercore.atak.trustoverlay.cot

import com.aethercore.atak.trustoverlay.atak.CotEventEnvelope
import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.core.TrustLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TrustEventParserTest {
    private val logger = TestLogger()

    @Test
    fun `derives trust level from score thresholds`() {
        val parser = TrustEventParser(logger, allowedSources = setOf("aethercore"))

        val healthy = parser.parse(baseEnvelope(score = "0.95"))
        val suspect = parser.parse(baseEnvelope(uid = "node-2", score = "0.6"))
        val quarantined = parser.parse(baseEnvelope(uid = "node-3", score = "0.2"))

        assertEquals(TrustLevel.HIGH, healthy?.level)
        assertEquals(95, healthy?.score)
        assertEquals(TrustLevel.MEDIUM, suspect?.level)
        assertEquals(TrustLevel.LOW, quarantined?.level)
    }

    @Test
    fun `rejects malformed payload and increments bad-event counter`() {
        val parser = TrustEventParser(logger, allowedSources = setOf("aethercore"))

        val before = parser.badEventCount()
        val malformed = baseEnvelope(score = "1.3")
        assertNull(parser.parse(malformed))
        assertEquals(before + 1L, parser.badEventCount())
    }

    @Test
    fun `rejects blocked source and uid mismatch`() {
        val parser = TrustEventParser(logger, allowedSources = setOf("trusted-gateway"))
        val blocked = baseEnvelope(source = "rogue")
        assertNull(parser.parse(blocked))

        val parser2 = TrustEventParser(logger, allowedSources = setOf("aethercore"))
        val mismatch = baseEnvelope(detailUid = "other-node")
        assertNull(parser2.parse(mismatch))
    }

    private fun baseEnvelope(
        uid: String = "node-1",
        score: String = "0.9",
        source: String = "aethercore",
        detailUid: String = uid,
    ): CotEventEnvelope = CotEventEnvelope(
        uid = uid,
        type = TrustCoTSubscriber.TRUST_COT_TYPE,
        lat = 34.0,
        lon = -117.0,
        time = "2026-01-14T10:15:00Z",
        stale = "2026-01-14T10:20:00Z",
        detail = mapOf(
            "trust_score" to score,
            "last_updated" to "2026-01-14T10:14:55Z",
            "source" to source,
            "trust.uid" to detailUid,
            "detail" to "present",
            "integrity_packet_loss" to "0.02",
        ),
    )

    private class TestLogger : Logger {
        override fun d(message: String) = Unit
        override fun w(message: String) = Unit
        override fun e(message: String, throwable: Throwable?) = Unit
    }
}
