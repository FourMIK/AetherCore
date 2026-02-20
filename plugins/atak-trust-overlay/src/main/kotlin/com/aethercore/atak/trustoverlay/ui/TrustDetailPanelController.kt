package com.aethercore.atak.trustoverlay.ui

import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.core.TrustEvent

class TrustDetailPanelController(
    private val logger: Logger,
) {
    private val latestByMarkerId: MutableMap<String, TrustEvent> = linkedMapOf()

    fun onTrustEvent(markerId: String, event: TrustEvent) {
        latestByMarkerId[markerId] = event
    }

    fun onMarkerTapped(markerId: String) {
        val event = latestByMarkerId[markerId]
        if (event == null) {
            logger.w("No trust detail available for marker=$markerId")
            return
        }

        // Replace this block with ATAK DropDown/Fragment presentation code.
        logger.d(
            "Open trust detail panel: callsign=${event.callsign}, score=${event.score}, level=${event.level}, source=${event.source}",
        )
    }

    fun clear() {
        latestByMarkerId.clear()
    }
}
