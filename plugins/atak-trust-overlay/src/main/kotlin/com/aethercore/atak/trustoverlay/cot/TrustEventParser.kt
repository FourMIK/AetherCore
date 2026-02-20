package com.aethercore.atak.trustoverlay.cot

import com.aethercore.atak.trustoverlay.atak.CotEventEnvelope
import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.core.TrustEvent
import com.aethercore.atak.trustoverlay.core.TrustLevel
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.concurrent.atomic.AtomicLong

class TrustEventParser(
    private val logger: Logger,
    private val allowedSources: Set<String> = DEFAULT_ALLOWED_SOURCES,
) {
    @Volatile
    private var mostRecentRejectReason: String? = null

    fun parse(envelope: CotEventEnvelope): TrustEvent? {
        val uid = envelope.uid.trim()
        if (uid.isEmpty()) {
            return reject("missing_uid", envelope)
        }

        val eventTime = envelope.time ?: extractRequired(envelope, EVENT_TIME_KEYS) ?: return reject("missing_time", envelope)
        if (!isParseableInstant(eventTime)) {
            return reject("invalid_time", envelope, "time=$eventTime")
        }

        val stale = envelope.stale ?: extractRequired(envelope, EVENT_STALE_KEYS) ?: return reject("missing_stale", envelope)
        if (!isParseableInstant(stale)) {
            return reject("invalid_stale", envelope, "stale=$stale")
        }

        if (extractRequired(envelope, DETAIL_MARKER_KEYS) == null && envelope.detail.isEmpty()) {
            return reject("missing_detail", envelope)
        }

        val source = extractRequired(envelope, SOURCE_KEYS)?.trim().orEmpty().ifEmpty { "unknown" }
        if (allowedSources.isNotEmpty() && !allowedSources.contains(source)) {
            return reject("blocked_source", envelope, "source=$source")
        }

        val detailUid = extractRequired(envelope, DETAIL_UID_KEYS)?.trim()
        if (!detailUid.isNullOrEmpty() && detailUid != uid) {
            return reject("uid_mismatch", envelope, "event_uid=$uid detail_uid=$detailUid")
        }

        val scoreRaw = extractRequired(envelope, SCORE_KEYS) ?: return reject("missing_trust_score", envelope)
        val score = scoreRaw.toDoubleOrNull() ?: return reject("invalid_trust_score", envelope, "trust_score=$scoreRaw")
        if (score < 0.0 || score > 1.0) {
            return reject("trust_score_out_of_bounds", envelope, "trust_score=$score")
        }

        val lastUpdated = extractRequired(envelope, LAST_UPDATED_KEYS) ?: return reject("missing_last_updated", envelope)
        if (!isParseableInstant(lastUpdated)) {
            return reject("invalid_last_updated", envelope, "last_updated=$lastUpdated")
        }

        val invalidMetric = envelope.detail.entries.firstOrNull { (key, value) ->
            key.startsWith(METRIC_PREFIX) && (value.toDoubleOrNull() == null || value.toDouble() < 0.0)
        }
        if (invalidMetric != null) {
            return reject(
                "invalid_metric_counter",
                envelope,
                "metric=${invalidMetric.key} value=${invalidMetric.value}",
            )
        }

        val callsign = extractRequired(envelope, CALLSIGN_KEYS)?.trim().orEmpty().ifEmpty { uid }
        val observedAtEpochMs = Instant.parse(lastUpdated).toEpochMilli()
        val level = derivedTrustLevel(score)
        val scorePercent = (score * 100.0).toInt()
        val lat = envelope.lat ?: extractRequired(envelope, POINT_LAT_KEYS)?.toDoubleOrNull() ?: 0.0
        val lon = envelope.lon ?: extractRequired(envelope, POINT_LON_KEYS)?.toDoubleOrNull() ?: 0.0
        val metrics = envelope.detail.entries
            .filter { (key, value) -> key.startsWith(METRIC_PREFIX) && value.toDoubleOrNull() != null }
            .associate { (key, value) -> key.removePrefix(METRIC_PREFIX) to value.toDouble() }
        val sourceMetadata = envelope.detail.entries
            .mapNotNull { (key, value) ->
                val prefix = SOURCE_METADATA_PREFIXES.firstOrNull { key.startsWith(it) } ?: return@mapNotNull null
                key.removePrefix(prefix) to value
            }
            .toMap()

        return TrustEvent(
            uid = uid,
            callsign = callsign,
            lat = lat,
            lon = lon,
            level = level,
            score = scorePercent,
            trustScore = score,
            source = source,
            sourceMetadata = sourceMetadata,
            metrics = metrics,
            observedAtEpochMs = observedAtEpochMs,
        )
    }

    fun badEventCount(): Long = badEvents.get()

    fun mostRecentBadEventReason(): String? = mostRecentRejectReason

    private fun reject(reason: String, envelope: CotEventEnvelope, details: String = ""): TrustEvent? {
        val count = badEvents.incrementAndGet()
        mostRecentRejectReason = reason
        logger.w(
            "trust_event_rejected reason=$reason uid=${envelope.uid} type=${envelope.type} bad_event_count=$count $details"
                .trim(),
        )
        return null
    }

    private fun extractRequired(envelope: CotEventEnvelope, keys: List<String>): String? =
        keys.firstNotNullOfOrNull { key -> envelope.detail[key] }

    private fun derivedTrustLevel(score: Double): TrustLevel = when {
        score >= 0.9 -> TrustLevel.HIGH
        score >= 0.6 -> TrustLevel.MEDIUM
        else -> TrustLevel.LOW
    }

    private fun isParseableInstant(value: String): Boolean = try {
        Instant.parse(value)
        true
    } catch (_: DateTimeParseException) {
        false
    }

    companion object {
        private const val METRIC_PREFIX = "integrity_"
        private val badEvents = AtomicLong(0)

        private val EVENT_TIME_KEYS = listOf("time", "event.time")
        private val EVENT_STALE_KEYS = listOf("stale", "event.stale")
        private val DETAIL_MARKER_KEYS = listOf("detail", "event.detail", "trust.present")
        private val DETAIL_UID_KEYS = listOf("trust.uid", "uid")
        private val SCORE_KEYS = listOf("trust_score", "trust.score")
        private val LAST_UPDATED_KEYS = listOf("last_updated", "trust.last_updated", "trust.observedAt")
        private val SOURCE_KEYS = listOf("source", "trust.source")
        private val CALLSIGN_KEYS = listOf("callsign", "trust.callsign")
        private val POINT_LAT_KEYS = listOf("point.lat", "lat")
        private val POINT_LON_KEYS = listOf("point.lon", "lon")
        private val SOURCE_METADATA_PREFIXES = listOf("source_meta.", "source.meta.", "event.source.")

        private val DEFAULT_ALLOWED_SOURCES = setOf("aethercore", "trust-mesh", "trusted-gateway", "unknown")
    }
}
