package com.aethercore.atak.trustoverlay.core

import com.aethercore.atak.trustoverlay.atak.AtakMapComponent
import com.aethercore.atak.trustoverlay.atak.PluginContext
import com.aethercore.atak.trustoverlay.atak.Subscription
import com.aethercore.atak.trustoverlay.cot.TrustCoTSubscriber
import com.aethercore.atak.trustoverlay.map.TrustMarkerRenderer
import com.aethercore.atak.trustoverlay.ui.TrustDetailPanelController
import com.aethercore.atak.trustoverlay.widget.TrustFeedHealthWidgetController

class TrustOverlayMapComponent : AtakMapComponent {
    private var cotSubscriber: TrustCoTSubscriber? = null
    private var markerRenderer: TrustMarkerRenderer? = null
    private var detailPanel: TrustDetailPanelController? = null
    private var widgetController: TrustFeedHealthWidgetController? = null
    private var markerTapSubscription: Subscription? = null

    override fun onCreate(context: PluginContext) {
        context.logger.d("TrustOverlayMapComponent.onCreate")

        markerRenderer = TrustMarkerRenderer(context.mapView)
        detailPanel = TrustDetailPanelController(context.logger)
        cotSubscriber = TrustCoTSubscriber(context.cotBus, context.logger)
        widgetController = TrustFeedHealthWidgetController(
            widgetHost = context.widgetHost,
            enabled = true,
        )

        widgetController?.start()

        markerTapSubscription = context.markerTapBus.subscribe { markerHandle ->
            detailPanel?.onMarkerTapped(markerHandle.id)
        }

        cotSubscriber?.start { trustEvent ->
            val markerId = "trust:${trustEvent.uid}"
            markerRenderer?.render(trustEvent)
            detailPanel?.onTrustEvent(markerId, trustEvent)
            widgetController?.onTrustEvent(trustEvent)
        }
    }

    override fun onDestroy() {
        cotSubscriber?.stop()
        markerTapSubscription?.dispose()
        markerTapSubscription = null

        widgetController?.stop()
        detailPanel?.clear()

        cotSubscriber = null
        markerRenderer = null
        detailPanel = null
        widgetController = null
    }
}
