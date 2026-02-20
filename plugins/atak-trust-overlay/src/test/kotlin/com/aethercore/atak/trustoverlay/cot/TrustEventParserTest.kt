package com.aethercore.atak.trustoverlay.cot

import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.core.TrustLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustEventParserTest {
    private val logger = TestLogger()

    @Test
    fun `parses valid CoT fixtures at trust threshold edges`() {
        val parser = parser()

        val healthy = parser.parse(CotFixtureLoader.load("healthy"))
        val suspect = parser.parse(CotFixtureLoader.load("suspect"))
        val quarantined = parser.parse(CotFixtureLoader.load("quarantined"))

        assertEquals(TrustLevel.HIGH, healthy?.level)
        assertEquals(TrustLevel.MEDIUM, suspect?.level)
        assertEquals(TrustLevel.LOW, quarantined?.level)
        assertEquals(90, healthy?.score)
        assertEquals(60, suspect?.score)
        assertEquals(59, quarantined?.score)
    }

    @Test
    fun `maps trust_score deterministically to derived trust level`() {
        val parser = parser()

        val cases = listOf(
            1.0 to TrustLevel.HIGH,
            0.9 to TrustLevel.HIGH,
            0.899999 to TrustLevel.MEDIUM,
            0.6 to TrustLevel.MEDIUM,
            0.599999 to TrustLevel.LOW,
            0.0 to TrustLevel.LOW,
        )

        cases.forEachIndexed { idx, (score, expectedLevel) ->
            val healthyFixture = CotFixtureLoader.load("healthy")
            val event = parser.parse(
                healthyFixture.copy(
                    uid = "node-$idx",
                    detail = healthyFixture.detail + mapOf(
                        "trust.uid" to "node-$idx",
                        "trust_score" to score.toString(),
                    ),
                ),
            )
            assertEquals("score=$score", expectedLevel, event?.level)
        }
    }

    @Test
    fun `rejects malformed fixture and validation failures`() {
        val parser = parser()

        assertNull(parser.parse(CotFixtureLoader.load("malformed")))
        assertEquals("invalid_time", parser.mostRecentBadEventReason())

        val healthyFixture = CotFixtureLoader.load("healthy")

        assertNull(parser.parse(healthyFixture.copy(uid = "")))
        assertEquals("missing_uid", parser.mostRecentBadEventReason())

        val missingLastUpdated = healthyFixture.copy(detail = healthyFixture.detail - "last_updated")
        assertNull(parser.parse(missingLastUpdated))
        assertEquals("missing_last_updated", parser.mostRecentBadEventReason())

        val outOfBoundsScore = healthyFixture.copy(detail = healthyFixture.detail + ("trust_score" to "1.1"))
        assertNull(parser.parse(outOfBoundsScore))
        assertEquals("trust_score_out_of_bounds", parser.mostRecentBadEventReason())

        val malformedTimestamp = healthyFixture.copy(detail = healthyFixture.detail + ("last_updated" to "bad-timestamp"))
        assertNull(parser.parse(malformedTimestamp))
        assertEquals("invalid_last_updated", parser.mostRecentBadEventReason())
    }

    @Test
    fun `extracts metrics and source metadata when present`() {
        val parser = parser()
        val event = parser.parse(CotFixtureLoader.load("healthy"))

        assertEquals(0.02, event?.metrics?.get("packet_loss"))
        assertEquals("mesh-gw-1", event?.sourceMetadata?.get("gateway"))
        assertTrue(event?.sourceMetadata?.containsKey("cluster") == true)
    }

    private fun parser(): TrustEventParser = TrustEventParser(logger, allowedSources = setOf("aethercore"))

    private class TestLogger : Logger {
        override fun d(message: String) = Unit
        override fun w(message: String) = Unit
        override fun e(message: String, throwable: Throwable?) = Unit
    }
}
