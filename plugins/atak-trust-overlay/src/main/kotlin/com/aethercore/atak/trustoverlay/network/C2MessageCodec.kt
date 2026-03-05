package com.aethercore.atak.trustoverlay.network

import java.security.SecureRandom
import java.util.UUID

object C2MessageCodec {
    private val random = SecureRandom()

    fun createEnvelope(
        type: String,
        from: String,
        payload: Map<String, Any?>,
        previousMessageId: String?,
        sequence: Int,
    ): LinkedHashMap<String, Any?> {
        val envelope = linkedMapOf<String, Any?>()
        envelope["schema_version"] = "1.0"
        envelope["message_id"] = UUID.randomUUID().toString()
        envelope["timestamp"] = System.currentTimeMillis()
        envelope["type"] = type
        envelope["from"] = from
        envelope["payload"] = normalizePayload(type, payload)
        envelope["nonce"] = generateNonceHex()
        envelope["sequence"] = sequence
        if (previousMessageId != null) {
            envelope["previous_message_id"] = previousMessageId
        }
        envelope["transport"] = defaultTransport(type)
        return envelope
    }

    fun serializeForSigning(envelope: Map<String, Any?>): String {
        val filtered = linkedMapOf<String, Any?>()
        filtered["schema_version"] = envelope["schema_version"]
        filtered["message_id"] = envelope["message_id"]
        filtered["timestamp"] = envelope["timestamp"]
        filtered["type"] = envelope["type"]
        filtered["from"] = envelope["from"]
        filtered["payload"] = envelope["payload"]
        filtered["nonce"] = envelope["nonce"]
        filtered["sequence"] = envelope["sequence"]
        if (envelope.containsKey("previous_message_id")) {
            filtered["previous_message_id"] = envelope["previous_message_id"]
        }
        filtered["transport"] = envelope["transport"]
        return CanonicalJson.stringify(filtered)
    }

    fun finalizeEnvelope(envelope: LinkedHashMap<String, Any?>, signatureHex: String): String {
        envelope["signature"] = signatureHex
        return CanonicalJson.stringify(envelope)
    }

    fun estimateSmsSegments(content: String): Map<String, Any> {
        val hasNonAscii = content.any { it.code < 32 || it.code > 126 }
        val maxChars = if (hasNonAscii) 70 else 160
        val segmentCount = kotlin.math.max(1, kotlin.math.ceil(content.length / maxChars.toDouble()).toInt())
        return linkedMapOf(
            "segment_count" to segmentCount,
            "segment_index" to 0,
            "encoding" to if (hasNonAscii) "utf-8" else "gsm-7",
            "max_chars_per_segment" to maxChars,
        )
    }

    private fun normalizePayload(type: String, payload: Map<String, Any?>): Map<String, Any?> {
        if (type == "chat") {
            val content = payload["content"] as? String
            if (content != null && !payload.containsKey("sms_fallback")) {
                val withSms = linkedMapOf<String, Any?>()
                withSms.putAll(payload)
                withSms["sms_fallback"] = estimateSmsSegments(content)
                return withSms
            }
        }
        return payload
    }

    private fun defaultTransport(type: String): Map<String, Any> {
        return when (type) {
            "call_invite", "call_accept", "call_reject", "call_end" -> linkedMapOf(
                "mode" to "gossip",
                "ttl_ms" to 15_000,
                "hop_count" to 0,
                "qos" to "at_least_once",
                "topic" to "guardian.call",
            )
            "chat" -> linkedMapOf(
                "mode" to "direct",
                "ttl_ms" to 4 * 60 * 60 * 1000,
                "hop_count" to 0,
                "qos" to "at_least_once",
                "topic" to "guardian.chat",
            )
            else -> linkedMapOf(
                "mode" to "direct",
                "ttl_ms" to 60_000,
                "hop_count" to 0,
                "qos" to "best_effort",
            )
        }
    }

    private fun generateNonceHex(): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}

private object CanonicalJson {
    fun stringify(value: Any?): String {
        return when (value) {
            null -> "null"
            is String -> "\"${escape(value)}\""
            is Number -> value.toString()
            is Boolean -> if (value) "true" else "false"
            is Map<*, *> -> mapToJson(value)
            is List<*> -> listToJson(value)
            else -> "\"${escape(value.toString())}\""
        }
    }

    private fun mapToJson(map: Map<*, *>): String {
        val builder = StringBuilder()
        builder.append('{')
        var first = true
        for ((key, rawValue) in map) {
            if (key !is String) continue
            if (!first) builder.append(',')
            first = false
            builder.append('"').append(escape(key)).append('"').append(':')
            builder.append(stringify(rawValue))
        }
        builder.append('}')
        return builder.toString()
    }

    private fun listToJson(list: List<*>): String {
        val builder = StringBuilder()
        builder.append('[')
        var first = true
        for (value in list) {
            if (!first) builder.append(',')
            first = false
            builder.append(stringify(value))
        }
        builder.append(']')
        return builder.toString()
    }

    private fun escape(value: String): String {
        val builder = StringBuilder()
        for (char in value) {
            when (char) {
                '\"' -> builder.append("\\\"")
                '\\' -> builder.append("\\\\")
                '\b' -> builder.append("\\b")
                '\u000C' -> builder.append("\\f")
                '\n' -> builder.append("\\n")
                '\r' -> builder.append("\\r")
                '\t' -> builder.append("\\t")
                else -> {
                    if (char < ' ') {
                        builder.append(String.format("\\u%04x", char.code))
                    } else {
                        builder.append(char)
                    }
                }
            }
        }
        return builder.toString()
    }
}
