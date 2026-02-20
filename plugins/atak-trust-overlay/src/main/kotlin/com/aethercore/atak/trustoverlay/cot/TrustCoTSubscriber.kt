package com.aethercore.atak.trustoverlay.cot

import com.aethercore.atak.trustoverlay.atak.CotBus
import com.aethercore.atak.trustoverlay.atak.CotEventEnvelope
import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.atak.Subscription
import com.aethercore.atak.trustoverlay.core.TrustEvent
import com.aethercore.atak.trustoverlay.core.TrustLevel

class TrustCoTSubscriber(
    private val cotBus: CotBus,
    private val logger: Logger,
) {
    private var subscription: Subscription? = null

    fun start(onTrustEvent: (TrustEvent) -> Unit) {
        if (subscription != null) {
            logger.w("Trust CoT subscriber already active")
            return
        }

        subscription = cotBus.subscribe(TRUST_COT_TYPE) { envelope ->
            parseTrustEvent(envelope)?.let(onTrustEvent)
        }

        logger.d("Subscribed to CoT type=$TRUST_COT_TYPE")
    }

    fun stop() {
        subscription?.dispose()
        subscription = null
        logger.d("Trust CoT subscriber stopped")
    }

    private fun parseTrustEvent(envelope: CotEventEnvelope): TrustEvent? {
        val score = envelope.detail[KEY_SCORE]?.toIntOrNull() ?: return null
        val callsign = envelope.detail[KEY_CALLSIGN] ?: envelope.uid
        val source = envelope.detail[KEY_SOURCE] ?: "unknown"
        val observedAt = envelope.detail[KEY_OBSERVED_AT]?.toLongOrNull() ?: System.currentTimeMillis()

        return TrustEvent(
            uid = envelope.uid,
            callsign = callsign,
            lat = envelope.lat,
            lon = envelope.lon,
            level = scoreToLevel(score),
            score = score,
            source = source,
            observedAtEpochMs = observedAt,
        )
    }

    private fun scoreToLevel(score: Int): TrustLevel = when {
        score >= 80 -> TrustLevel.HIGH
        score >= 50 -> TrustLevel.MEDIUM
        score >= 1 -> TrustLevel.LOW
        else -> TrustLevel.UNKNOWN
    }

    companion object {
        const val TRUST_COT_TYPE = "a-f-AETHERCORE-TRUST"

        private const val KEY_CALLSIGN = "trust.callsign"
        private const val KEY_SCORE = "trust.score"
        private const val KEY_SOURCE = "trust.source"
        private const val KEY_OBSERVED_AT = "trust.observedAtEpochMs"
    }
}
