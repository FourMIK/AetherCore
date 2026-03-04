package com.aethercore.atak.trustoverlay.cot

import com.aethercore.atak.trustoverlay.atak.CotEventEnvelope
import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.core.TrustEvent
import com.aethercore.atak.trustoverlay.core.TrustLevel
import org.w3c.dom.Element
import org.xml.sax.InputSource
import java.io.StringReader
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.concurrent.atomic.AtomicLong
import javax.xml.parsers.DocumentBuilderFactory

class TrustEventParser(
    private val logger: Logger,
    private val allowedSources: Set<String> = DEFAULT_ALLOWED_SOURCES,
) {
    private val badEvents = AtomicLong(0)

    @Volatile
    private var mostRecentRejectReason: String? = null

    fun parse(envelope: CotEventEnvelope): TrustEvent? {
        val uid = envelope.uid.trim()
        if (uid.isEmpty()) {
            return reject("missing_uid", envelope)
        }

        val detail = normalizeDetail(envelope)

        val eventTime = envelope.time ?: extractRequired(detail, EVENT_TIME_KEYS) ?: return reject("missing_time", envelope)
        if (!isParseableInstant(eventTime)) {
            return reject("invalid_time", envelope, "time=$eventTime")
        }

        val stale = envelope.stale ?: extractRequired(detail, EVENT_STALE_KEYS) ?: return reject("missing_stale", envelope)
        if (!isParseableInstant(stale)) {
            return reject("invalid_stale", envelope, "stale=$stale")
        }

        if (extractRequired(detail, DETAIL_MARKER_KEYS) == null && detail.isEmpty()) {
            return reject("missing_detail", envelope)
        }

        val source = extractRequired(detail, SOURCE_KEYS)?.trim().orEmpty().ifEmpty { "unknown" }
        if (allowedSources.isNotEmpty() && !allowedSources.contains(source)) {
            return reject("blocked_source", envelope, "source=$source")
        }

        val detailUid = extractRequired(detail, DETAIL_UID_KEYS)?.trim()
        if (!detailUid.isNullOrEmpty() && detailUid != uid) {
            return reject("uid_mismatch", envelope, "event_uid=$uid detail_uid=$detailUid")
        }

        val scoreRaw = extractRequired(detail, SCORE_KEYS) ?: return reject("missing_trust_score", envelope)
        val score = scoreRaw.toDoubleOrNull() ?: return reject("invalid_trust_score", envelope, "trust_score=$scoreRaw")
        if (score < 0.0 || score > 1.0) {
            return reject("trust_score_out_of_bounds", envelope, "trust_score=$score")
        }

        val lastUpdated = extractRequired(detail, LAST_UPDATED_KEYS) ?: return reject("missing_last_updated", envelope)
        if (!isParseableInstant(lastUpdated)) {
            return reject("invalid_last_updated", envelope, "last_updated=$lastUpdated")
        }

        val derivedLevel = derivedTrustLevel(score)
        val providedLevelRaw = extractOptional(detail, TRUST_LEVEL_KEYS)
        val level = when {
            providedLevelRaw == null -> derivedLevel
            else -> {
                val normalizedLevel = normalizeTrustLevel(providedLevelRaw)
                    ?: return reject("invalid_trust_level", envelope, "trust_level=$providedLevelRaw")
                if (normalizedLevel != derivedLevel) {
                    return reject(
                        "trust_level_conflict",
                        envelope,
                        "trust_level=$providedLevelRaw derived_level=${derivedLevel.name.lowercase()}",
                    )
                }
                normalizedLevel
            }
        }

        val invalidMetric = detail.entries.firstOrNull { (key, value) ->
            key.startsWith(METRIC_PREFIX) && (value.toDoubleOrNull() == null || value.toDouble() < 0.0)
        }
        if (invalidMetric != null) {
            return reject(
                "invalid_metric_counter",
                envelope,
                "metric=${invalidMetric.key} value=${invalidMetric.value}",
            )
        }

        val callsign = extractRequired(detail, CALLSIGN_KEYS)?.trim().orEmpty().ifEmpty { uid }
        val observedAtEpochMs = Instant.parse(lastUpdated).toEpochMilli()
        val scorePercent = (score * 100.0).toInt()
        val lat = envelope.lat ?: extractRequired(detail, POINT_LAT_KEYS)?.toDoubleOrNull() ?: 0.0
        val lon = envelope.lon ?: extractRequired(detail, POINT_LON_KEYS)?.toDoubleOrNull() ?: 0.0
        val metrics = detail.entries
            .filter { (key, value) -> key.startsWith(METRIC_PREFIX) && value.toDoubleOrNull() != null }
            .associate { (key, value) -> key.removePrefix(METRIC_PREFIX) to value.toDouble() }
        val sourceMetadata = detail.entries
            .mapNotNull { (key, value) ->
                val prefix = SOURCE_METADATA_PREFIXES.firstOrNull { key.startsWith(it) } ?: return@mapNotNull null
                key.removePrefix(prefix) to value
            }
            .toMap()

        val signatureHex = extractOptional(detail, SIGNATURE_KEYS)
        if (signatureHex != null && !SIGNATURE_HEX_PATTERN.matches(signatureHex)) {
            return reject("invalid_signature_hex", envelope)
        }
        val signerNodeId = extractOptional(detail, SIGNER_NODE_ID_KEYS)
        val payloadHash = extractOptional(detail, PAYLOAD_HASH_KEYS)
        val signatureVerified = when (val rawValue = extractOptional(detail, SIGNATURE_VERIFIED_KEYS)) {
            null -> false
            else -> parseBoolean(rawValue)
                ?: return reject("invalid_signature_verified", envelope, "signature_verified=$rawValue")
        }

        if (signatureVerified && signatureHex == null) {
            return reject("signature_verification_without_signature", envelope)
        }

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
            signatureHex = signatureHex,
            signerNodeId = signerNodeId,
            payloadHash = payloadHash,
            signatureVerified = signatureVerified,
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

    private fun normalizeDetail(envelope: CotEventEnvelope): Map<String, String> {
        val trimmed = envelope.detail.mapNotNull { (key, value) ->
            val normalized = value.trim()
            if (normalized.isEmpty()) {
                null
            } else {
                key to normalized
            }
        }.toMap(linkedMapOf())

        val detailXml = trimmed["detail"] ?: return trimmed
        if (!detailXml.startsWith("<")) {
            return trimmed
        }

        val parsed = parseDetailXml(detailXml)
        if (parsed.isEmpty()) {
            return trimmed
        }

        // Incoming envelope detail keys take precedence over XML fallback extraction.
        return linkedMapOf<String, String>().apply {
            putAll(parsed)
            putAll(trimmed)
        }
    }

    private fun parseDetailXml(detailXml: String): Map<String, String> {
        val result = linkedMapOf<String, String>()
        val builderFactory = DocumentBuilderFactory.newInstance()
        runCatching {
            builderFactory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
            builderFactory.setFeature("http://xml.org/sax/features/external-general-entities", false)
            builderFactory.setFeature("http://xml.org/sax/features/external-parameter-entities", false)
            builderFactory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false)
            builderFactory.isXIncludeAware = false
            builderFactory.isExpandEntityReferences = false

            val builder = builderFactory.newDocumentBuilder()
            val document = builder.parse(InputSource(StringReader(detailXml)))
            val root = document.documentElement ?: return result

            val detailElement = when {
                root.tagName.equals("detail", ignoreCase = true) -> root
                else -> root.getElementsByTagName("detail").item(0) as? Element
            } ?: return result

            val trustElement = detailElement.getElementsByTagName("trust").item(0) as? Element
            trustElement?.let { trust ->
                putAttributeIfPresent(result, trust, "trust_score", "trust_score")
                putAttributeIfPresent(result, trust, "score", "trust_score")
                putAttributeIfPresent(result, trust, "trust_level", "trust_level")
                putAttributeIfPresent(result, trust, "last_updated", "last_updated")
                putAttributeIfPresent(result, trust, "source", "source")
                putAttributeIfPresent(result, trust, "uid", "trust.uid")
                putAttributeIfPresent(result, trust, "signature_hex", "trust.signature_hex")
                putAttributeIfPresent(result, trust, "signer_node_id", "trust.signer_node_id")
                putAttributeIfPresent(result, trust, "payload_hash", "trust.payload_hash")
                putAttributeIfPresent(result, trust, "signature_verified", "trust.signature_verified")
            }

            val contactElement = detailElement.getElementsByTagName("contact").item(0) as? Element
            contactElement?.let { contact ->
                putAttributeIfPresent(result, contact, "callsign", "callsign")
            }

            val metricsElement = detailElement.getElementsByTagName("metrics").item(0) as? Element
            metricsElement?.attributes?.let { attributes ->
                for (index in 0 until attributes.length) {
                    val node = attributes.item(index) ?: continue
                    val key = node.nodeName.trim()
                    val value = node.nodeValue?.trim().orEmpty()
                    if (key.isNotEmpty() && value.isNotEmpty()) {
                        result["$METRIC_PREFIX$key"] = value
                    }
                }
            }

            val sourceMetaElement = detailElement.getElementsByTagName("sourceMeta").item(0) as? Element
            sourceMetaElement?.attributes?.let { attributes ->
                for (index in 0 until attributes.length) {
                    val node = attributes.item(index) ?: continue
                    val key = node.nodeName.trim()
                    val value = node.nodeValue?.trim().orEmpty()
                    if (key.isNotEmpty() && value.isNotEmpty()) {
                        result["source_meta.$key"] = value
                    }
                }
            }
        }.onFailure { throwable ->
            logger.w("trust_detail_xml_parse_failed reason=${throwable.message}")
        }
        return result
    }

    private fun putAttributeIfPresent(
        target: MutableMap<String, String>,
        element: Element,
        attributeName: String,
        detailKey: String,
    ) {
        val value = element.getAttribute(attributeName).trim()
        if (value.isNotEmpty()) {
            target[detailKey] = value
        }
    }

    private fun parseBoolean(value: String): Boolean? = when (value.trim().lowercase()) {
        "1", "true", "yes", "on" -> true
        "0", "false", "no", "off" -> false
        else -> null
    }

    private fun extractRequired(detail: Map<String, String>, keys: List<String>): String? =
        keys.firstNotNullOfOrNull { key -> detail[key]?.trim()?.takeIf(String::isNotEmpty) }

    private fun extractOptional(detail: Map<String, String>, keys: List<String>): String? =
        keys.firstNotNullOfOrNull { key -> detail[key]?.trim()?.takeIf(String::isNotEmpty) }

    private fun derivedTrustLevel(score: Double): TrustLevel = when {
        score >= HIGH_TRUST_THRESHOLD -> TrustLevel.HIGH
        score >= MEDIUM_TRUST_THRESHOLD -> TrustLevel.MEDIUM
        else -> TrustLevel.LOW
    }

    private fun normalizeTrustLevel(value: String): TrustLevel? = when (value.trim().lowercase()) {
        "healthy", "high" -> TrustLevel.HIGH
        "suspect", "medium" -> TrustLevel.MEDIUM
        "quarantined", "low" -> TrustLevel.LOW
        else -> null
    }

    private fun isParseableInstant(value: String): Boolean = try {
        Instant.parse(value)
        true
    } catch (_: DateTimeParseException) {
        false
    }

    companion object {
        private const val METRIC_PREFIX = "integrity_"
        private val SIGNATURE_HEX_PATTERN = Regex("^[0-9a-fA-F]{128}$")

        private val EVENT_TIME_KEYS = listOf("time", "event.time")
        private val EVENT_STALE_KEYS = listOf("stale", "event.stale")
        private val DETAIL_MARKER_KEYS = listOf("detail", "event.detail", "trust.present")
        private val DETAIL_UID_KEYS = listOf("trust.uid", "uid")
        private val SCORE_KEYS = listOf("trust_score", "trust.score")
        private val TRUST_LEVEL_KEYS = listOf("trust_level", "trust.level")
        private val LAST_UPDATED_KEYS = listOf("last_updated", "trust.last_updated", "trust.observedAt")
        private val SOURCE_KEYS = listOf("source", "trust.source")
        private val CALLSIGN_KEYS = listOf("callsign", "trust.callsign")
        private val POINT_LAT_KEYS = listOf("point.lat", "lat")
        private val POINT_LON_KEYS = listOf("point.lon", "lon")
        private val SOURCE_METADATA_PREFIXES = listOf("source_meta.", "source.meta.", "event.source.")
        private val SIGNATURE_KEYS = listOf("trust.signature_hex", "signature_hex", "sig")
        private val SIGNER_NODE_ID_KEYS = listOf("trust.signer_node_id", "signer_node_id", "signer")
        private val PAYLOAD_HASH_KEYS = listOf("trust.payload_hash", "payload_hash")
        private val SIGNATURE_VERIFIED_KEYS = listOf(
            "trust.signature_verified",
            "signature_verified",
            "verification.signature_verified",
        )

        private const val HIGH_TRUST_THRESHOLD = 0.9
        private const val MEDIUM_TRUST_THRESHOLD = 0.6

        private val DEFAULT_ALLOWED_SOURCES = setOf("aethercore", "trust-mesh", "trusted-gateway")
    }
}

