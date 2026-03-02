package com.aethercore.atak.trustoverlay.cot

import com.aethercore.atak.trustoverlay.atak.CotEventEnvelope
import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.core.SignatureStatus
import com.aethercore.atak.trustoverlay.core.TrustEvent
import com.aethercore.atak.trustoverlay.core.TrustLevel
import java.io.StringReader
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.concurrent.atomic.AtomicLong
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element
import org.xml.sax.InputSource

class TrustEventParser(
    private val logger: Logger,
    private val allowedSources: Set<String> = DEFAULT_ALLOWED_SOURCES,
) {
    private val badEvents = AtomicLong(0)

    @Volatile
    private var mostRecentRejectReason: String? = null

    fun parse(envelope: CotEventEnvelope): TrustEvent? {
        val detail = canonicalDetailWithLegacyFallback(envelope)

        val uid = envelope.uid.trim()
        if (uid.isEmpty()) {
            return reject("missing_uid", envelope)
        }

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
        val signerNodeId = extractOptional(detail, SIGNER_NODE_ID_KEYS)
        val payloadHash = extractOptional(detail, PAYLOAD_HASH_KEYS)
        val signatureStatus = resolveSignatureStatus(detail, signatureHex)

        val signatureVerified = signatureStatus == SignatureStatus.VERIFIED

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
            signatureStatus = signatureStatus,
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

    private fun extractRequired(detail: Map<String, String>, keys: List<String>): String? =
        keys.firstNotNullOfOrNull { key -> detail[key]?.trim()?.takeIf(String::isNotEmpty) }

    private fun extractOptional(detail: Map<String, String>, keys: List<String>): String? =
        keys.firstNotNullOfOrNull { key -> detail[key]?.trim()?.takeIf(String::isNotEmpty) }

    private fun canonicalDetailWithLegacyFallback(envelope: CotEventEnvelope): Map<String, String> {
        val canonical = envelope.detail.entries
            .mapNotNull { (key, value) ->
                val normalizedKey = key.trim()
                val normalizedValue = value.trim()
                if (normalizedKey.isEmpty() || normalizedValue.isEmpty()) {
                    null
                } else {
                    normalizedKey to normalizedValue
                }
            }
            .toMap(LinkedHashMap())

        val detailXml = canonical["detail"] ?: return canonical
        if (!detailXml.contains('<') || !detailXml.contains('>')) {
            return canonical
        }

        val legacy = parseLegacyDetailXml(detailXml)
        if (legacy.isEmpty()) {
            return canonical
        }

        // Canonical payload is authoritative; legacy keys only fill gaps.
        return (legacy + canonical).toMap(LinkedHashMap())
    }

    private fun parseLegacyDetailXml(detailXml: String): Map<String, String> {
        val xml = detailXml.trim().let { raw ->
            if (raw.startsWith("<detail")) raw else "<detail>$raw</detail>"
        }

        val detailElement = runCatching {
            val factory = DocumentBuilderFactory.newInstance().apply {
                isNamespaceAware = false
                setFeatureSafely("http://apache.org/xml/features/disallow-doctype-decl", true)
                setFeatureSafely("http://xml.org/sax/features/external-general-entities", false)
                setFeatureSafely("http://xml.org/sax/features/external-parameter-entities", false)
                setFeatureSafely("http://apache.org/xml/features/nonvalidating/load-external-dtd", false)
            }
            val builder = factory.newDocumentBuilder()
            val document = builder.parse(InputSource(StringReader(xml)))
            val root = document.documentElement
            when {
                root == null -> null
                root.tagName == "detail" -> root
                else -> document.getElementsByTagName("detail").item(0) as? Element
            }
        }.getOrNull() ?: return emptyMap()

        val parsed = linkedMapOf<String, String>()
        parsed["detail"] = "present"

        val trust = detailElement.getElementsByTagName("trust").item(0) as? Element
        trust?.let {
            attr(it, "trust_score", "score")?.let { value -> parsed["trust_score"] = value }
            attr(it, "trust_level", "level")?.let { value -> parsed["trust_level"] = value }
            attr(it, "last_updated", "updated")?.let { value -> parsed["last_updated"] = value }
            attr(it, "source")?.let { value -> parsed["source"] = value }
            attr(it, "uid", "device_id")?.let { value -> parsed["trust.uid"] = value }
            attr(it, "signature", "signature_hex", "sig")?.let { value -> parsed["signature_hex"] = value }
            attr(it, "signer_node_id", "signer", "from")?.let { value -> parsed["signer_node_id"] = value }
            attr(it, "payload_hash", "hash")?.let { value -> parsed["payload_hash"] = value }
            attr(it, "signature_status", "verification_status")?.let { value -> parsed["signature_status"] = value }
            attr(it, "signature_verified")?.let { value -> parsed["signature_verified"] = value }
        }

        val signature = detailElement.getElementsByTagName("signature").item(0) as? Element
        signature?.let {
            attr(it, "hex", "signature", "signature_hex", "sig")?.let { value -> parsed["signature_hex"] = value }
            attr(it, "signer_node_id", "signer")?.let { value -> parsed["signer_node_id"] = value }
            attr(it, "payload_hash", "hash")?.let { value -> parsed["payload_hash"] = value }
            attr(it, "status", "verification_status")?.let { value -> parsed["signature_status"] = value }
            attr(it, "verified")?.let { value -> parsed["signature_verified"] = value }
        }

        val contact = detailElement.getElementsByTagName("contact").item(0) as? Element
        contact?.let { attr(it, "callsign", "name")?.let { value -> parsed["callsign"] = value } }

        val metrics = detailElement.getElementsByTagName("metrics").item(0) as? Element
        metrics?.attributes?.let { attributes ->
            for (index in 0 until attributes.length) {
                val node = attributes.item(index) ?: continue
                val name = node.nodeName?.trim().orEmpty()
                val value = node.nodeValue?.trim().orEmpty()
                if (name.isNotEmpty() && value.isNotEmpty()) {
                    parsed["integrity_$name"] = value
                }
            }
        }

        val sourceMeta = detailElement.getElementsByTagName("sourceMeta").item(0) as? Element
        sourceMeta?.attributes?.let { attributes ->
            for (index in 0 until attributes.length) {
                val node = attributes.item(index) ?: continue
                val name = node.nodeName?.trim().orEmpty()
                val value = node.nodeValue?.trim().orEmpty()
                if (name.isNotEmpty() && value.isNotEmpty()) {
                    parsed["source_meta.$name"] = value
                }
            }
        }

        return parsed
    }

    private fun attr(element: Element, vararg names: String): String? {
        names.forEach { name ->
            val value = element.getAttribute(name)?.trim().orEmpty()
            if (value.isNotEmpty()) {
                return value
            }
        }
        return null
    }

    private fun resolveSignatureStatus(detail: Map<String, String>, signatureHex: String?): SignatureStatus {
        val explicitStatus = extractOptional(detail, SIGNATURE_STATUS_KEYS)?.let(::normalizeSignatureStatus)
        if (explicitStatus != null) {
            return explicitStatus
        }

        val explicitVerified = extractOptional(detail, SIGNATURE_VERIFIED_KEYS)?.let(::normalizeBoolean)
        if (explicitVerified != null) {
            return if (explicitVerified) SignatureStatus.VERIFIED else SignatureStatus.UNVERIFIED
        }

        return if (signatureHex.isNullOrBlank()) {
            SignatureStatus.INVALID_OR_UNKNOWN
        } else {
            SignatureStatus.UNVERIFIED
        }
    }

    private fun normalizeSignatureStatus(value: String): SignatureStatus? = when (value.trim().lowercase()) {
        "verified", "valid", "ok", "passed", "true" -> SignatureStatus.VERIFIED
        "unverified", "untrusted", "status_unverified", "false" -> SignatureStatus.UNVERIFIED
        "invalid", "unknown", "invalid_or_unknown", "failed", "error" -> SignatureStatus.INVALID_OR_UNKNOWN
        else -> null
    }

    private fun normalizeBoolean(value: String): Boolean? = when (value.trim().lowercase()) {
        "1", "true", "yes" -> true
        "0", "false", "no" -> false
        else -> null
    }

    private fun DocumentBuilderFactory.setFeatureSafely(name: String, value: Boolean) {
        runCatching { setFeature(name, value) }
    }

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

        private val EVENT_TIME_KEYS = listOf("time", "event.time")
        private val EVENT_STALE_KEYS = listOf("stale", "event.stale")
        private val DETAIL_MARKER_KEYS = listOf("detail", "event.detail", "trust.present")
        private val DETAIL_UID_KEYS = listOf("trust.uid", "uid")
        private val SCORE_KEYS = listOf("trust_score", "trust.score")
        private val TRUST_LEVEL_KEYS = listOf("trust_level", "trust.level")
        private val LAST_UPDATED_KEYS = listOf("last_updated", "trust.last_updated", "trust.observedAt")
        private val SOURCE_KEYS = listOf("trust.source", "source")
        private val CALLSIGN_KEYS = listOf("callsign", "trust.callsign")
        private val POINT_LAT_KEYS = listOf("point.lat", "lat")
        private val POINT_LON_KEYS = listOf("point.lon", "lon")
        private val SOURCE_METADATA_PREFIXES = listOf("source_meta.", "source.meta.", "event.source.")
        private val SIGNATURE_KEYS = listOf("trust.signature_hex", "signature_hex", "sig")
        private val SIGNER_NODE_ID_KEYS = listOf("trust.signer_node_id", "signer_node_id", "signer")
        private val PAYLOAD_HASH_KEYS = listOf("trust.payload_hash", "payload_hash")
        private val SIGNATURE_STATUS_KEYS = listOf(
            "trust.signature_status",
            "signature_status",
            "verification_status",
            "trust.verification_status",
            "trust_status",
        )
        private val SIGNATURE_VERIFIED_KEYS = listOf(
            "trust.signature_verified",
            "signature_verified",
            "verification.signature_verified",
        )

        private const val HIGH_TRUST_THRESHOLD = 0.9
        private const val MEDIUM_TRUST_THRESHOLD = 0.6

        private val DEFAULT_ALLOWED_SOURCES = setOf("aethercore", "trust-mesh", "trusted-gateway", "unknown")
    }
}
