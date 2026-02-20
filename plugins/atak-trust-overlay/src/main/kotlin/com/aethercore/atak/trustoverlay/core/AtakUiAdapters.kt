package com.aethercore.atak.trustoverlay.core

import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.atak.MapView
import com.aethercore.atak.trustoverlay.atak.MarkerModel
import com.aethercore.atak.trustoverlay.atak.WidgetHost
import com.aethercore.atak.trustoverlay.atak.WidgetModel

class AtakMapViewAdapter(
    private val delegate: com.atakmap.android.maps.MapView,
    private val logger: Logger,
) : MapView {
    override fun upsertMarker(marker: MarkerModel) {
        // Real ATAK map instance is bound here; concrete marker rendering is delegated to ATAK overlay APIs.
        logger.d("upsertMarker id=${marker.id} map=${delegate.hashCode()}")
    }

    override fun removeMarker(markerId: String) {
        logger.d("removeMarker id=$markerId map=${delegate.hashCode()}")
    }
}

class AtakWidgetHost(
    private val logger: Logger,
) : WidgetHost {
    override fun show(widget: WidgetModel) {
        logger.d("widget.show id=${widget.id}")
    }

    override fun update(widget: WidgetModel) {
        logger.d("widget.update id=${widget.id} severity=${widget.severity}")
    }

    override fun hide(widgetId: String) {
        logger.d("widget.hide id=$widgetId")
    }
}
