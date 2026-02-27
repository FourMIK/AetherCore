package com.aethercore.atak.trustoverlay.cot

import com.aethercore.atak.trustoverlay.atak.CotBus
import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.atak.Subscription
import com.aethercore.atak.trustoverlay.core.TrustEvent

class TrustCoTSubscriber(
    private val cotBus: CotBus,
    private val logger: Logger,
) {
    private var subscription: Subscription? = null
    private val parser = TrustEventParser(logger)

    fun start(
        onTrustEvent: (TrustEvent) -> Unit,
        onMalformedEvent: (Long, String?) -> Unit = { _, _ -> },
    ) {
        if (subscription != null) {
            logger.w("Trust CoT subscriber already active")
            return
        }

        subscription = cotBus.subscribe(TRUST_COT_TYPE) { envelope ->
            val parsedEvent = parser.parse(envelope)
            if (parsedEvent != null) {
                onTrustEvent(parsedEvent)
            } else {
                onMalformedEvent(parser.badEventCount(), parser.mostRecentBadEventReason())
            }
        }

        logger.d("Subscribed to CoT type=$TRUST_COT_TYPE")
    }

    fun stop() {
        subscription?.dispose()
        subscription = null
        logger.d("Trust CoT subscriber stopped")
    }

    companion object {
        const val TRUST_COT_TYPE = "a-f-AETHERCORE-TRUST"
    }
}
