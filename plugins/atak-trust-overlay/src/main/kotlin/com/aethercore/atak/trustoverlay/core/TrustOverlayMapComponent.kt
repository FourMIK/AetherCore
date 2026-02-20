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
    private var stateStore: TrustStateStore? = null
    private var configuredTtlSeconds: Long = TrustStateStore.DEFAULT_TTL_SECONDS

    override fun onCreate(context: PluginContext) {
        context.logger.d("TrustOverlayMapComponent.onCreate")

        configuredTtlSeconds = context.settings.getLong(
            SETTINGS_TTL_SECONDS,
            TrustStateStore.DEFAULT_TTL_SECONDS,
        )
        stateStore = TrustStateStore(ttlSeconds = configuredTtlSeconds)

        markerRenderer = TrustMarkerRenderer(context.mapView)
        detailPanel = TrustDetailPanelController(context.logger)
        cotSubscriber = TrustCoTSubscriber(context.cotBus, context.logger)
        widgetController = TrustFeedHealthWidgetController(
            widgetHost = context.widgetHost,
            enabled = true,
        )

        widgetController?.start()
        widgetController?.onFeedStatus(
            status = stateStore?.feedStatus() ?: TrustFeedStatus.DEGRADED,
            ttlSeconds = configuredTtlSeconds,
        )

        markerTapSubscription = context.markerTapBus.subscribe { markerHandle ->
            detailPanel?.onMarkerTapped(markerHandle.id)
        }

        cotSubscriber?.start(
            onTrustEvent = { trustEvent ->
                val markerId = "trust:${trustEvent.uid}"
                val store = stateStore ?: return@start
                store.record(trustEvent)
                val resolvedState = store.resolve(trustEvent.uid)

                markerRenderer?.render(resolvedState)
                detailPanel?.onTrustEvent(markerId, resolvedState)
                widgetController?.onTrustEvent(trustEvent)

                for (state in store.allResolved()) {
                    if (state.stale) {
                        markerRenderer?.render(state)
                    }
                }

                widgetController?.onFeedStatus(
                    status = store.feedStatus(),
                    ttlSeconds = configuredTtlSeconds,
                )
            },
            onMalformedEvent = { count, reason ->
                context.logger.w("Trust feed malformed event count=$count reason=${reason ?: "unknown"}")
                widgetController?.onMalformedEvent(count, reason)
                widgetController?.onFeedStatus(
                    status = stateStore?.feedStatus() ?: TrustFeedStatus.DEGRADED,
                    ttlSeconds = configuredTtlSeconds,
                )
            },
        )
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
        stateStore = null
    }

    companion object {
        const val SETTINGS_TTL_SECONDS = "trust.state.ttl.seconds"
    }
}
