package com.aethercore.atak.trustoverlay.cot

import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.core.TrustLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
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
    fun `maps trust_score deterministically to derived trust level using canonical thresholds`() {
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
    fun `honors trust_level when present and normalized`() {
        val parser = parser()
        val base = CotFixtureLoader.load("healthy")

        val explicitHealthy = parser.parse(base)
        assertEquals(TrustLevel.HIGH, explicitHealthy?.level)

        val aliasMedium = parser.parse(
            base.copy(
                uid = "medium-alias",
                detail = base.detail + mapOf(
                    "trust.uid" to "medium-alias",
                    "trust_score" to "0.60",
                    "trust_level" to "MEDIUM",
                ),
            ),
        )
        assertEquals(TrustLevel.MEDIUM, aliasMedium?.level)

        val aliasLow = parser.parse(
            base.copy(
                uid = "low-alias",
                detail = base.detail + mapOf(
                    "trust.uid" to "low-alias",
                    "trust_score" to "0.59",
                    "trust_level" to " low ",
                ),
            ),
        )
        assertEquals(TrustLevel.LOW, aliasLow?.level)
    }

    @Test
    fun `rejects invalid or conflicting trust_level values`() {
        val parser = parser()
        val base = CotFixtureLoader.load("healthy")

        val invalidLevel = parser.parse(
            base.copy(
                uid = "invalid-level",
                detail = base.detail + mapOf(
                    "trust.uid" to "invalid-level",
                    "trust_level" to "definitely-fine",
                ),
            ),
        )
        assertNull(invalidLevel)
        assertEquals("invalid_trust_level", parser.mostRecentBadEventReason())

        val conflictLevel = parser.parse(
            base.copy(
                uid = "conflict-level",
                detail = base.detail + mapOf(
                    "trust.uid" to "conflict-level",
                    "trust_score" to "0.90",
                    "trust_level" to "suspect",
                ),
            ),
        )
        assertNull(conflictLevel)
        assertEquals("trust_level_conflict", parser.mostRecentBadEventReason())
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
    fun `rejects event when trust fields are missing`() {
        val parser = parser()
        val healthyFixture = CotFixtureLoader.load("healthy")

        val missingTrustScore = healthyFixture.copy(detail = healthyFixture.detail - "trust_score")
        assertNull(parser.parse(missingTrustScore))
        assertEquals("missing_trust_score", parser.mostRecentBadEventReason())

        val missingStale = healthyFixture.copy(stale = null, detail = healthyFixture.detail - "stale")
        assertNull(parser.parse(missingStale))
        assertEquals("missing_stale", parser.mostRecentBadEventReason())
    }

    @Test
    fun `tracks malformed counts and reject reasons per parser instance`() {
        val firstParser = parser()
        val secondParser = parser()
        val malformed = CotFixtureLoader.load("malformed")

        assertNull(firstParser.parse(malformed))
        assertEquals(1L, firstParser.badEventCount())
        assertEquals("invalid_time", firstParser.mostRecentBadEventReason())

        assertEquals(0L, secondParser.badEventCount())
        assertNull(secondParser.mostRecentBadEventReason())

        assertNull(secondParser.parse(malformed))
        assertEquals(1L, secondParser.badEventCount())
        assertEquals("invalid_time", secondParser.mostRecentBadEventReason())
        assertEquals(1L, firstParser.badEventCount())
    }

    @Test
    fun `extracts metrics and source metadata when present`() {
        val parser = parser()
        val event = parser.parse(CotFixtureLoader.load("healthy"))

        assertEquals(0.02, event?.metrics?.get("packet_loss"))
        assertEquals("mesh-gw-1", event?.sourceMetadata?.get("gateway"))
        assertTrue(event?.sourceMetadata?.containsKey("cluster") == true)
    }

    @Test
    fun `fixtures follow cot trust conventions`() {
        listOf("healthy", "suspect", "quarantined", "stale", "malformed").forEach { fixture ->
            val envelope = CotFixtureLoader.load(fixture)
            assertNotNull("$fixture: trust_score", envelope.detail["trust_score"])
            assertNotNull("$fixture: last_updated", envelope.detail["last_updated"])
            assertNotNull("$fixture: trust.uid", envelope.detail["trust.uid"])
        }
    }

    private fun parser(): TrustEventParser = TrustEventParser(logger, allowedSources = setOf("aethercore"))

    private class TestLogger : Logger {
        override fun d(message: String) = Unit
        override fun w(message: String) = Unit
        override fun e(message: String, throwable: Throwable?) = Unit
    }
}
