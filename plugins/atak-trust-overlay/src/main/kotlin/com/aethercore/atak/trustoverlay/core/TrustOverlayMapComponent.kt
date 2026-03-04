package com.aethercore.atak.trustoverlay.core

import android.content.Context
import android.content.Intent
import com.aethercore.atak.trustoverlay.atak.AtakMapComponent
import com.aethercore.atak.trustoverlay.atak.PluginContext
import com.aethercore.atak.trustoverlay.atak.Subscription
import com.aethercore.atak.trustoverlay.cot.TrustCoTSubscriber
import com.aethercore.atak.trustoverlay.map.TrustMarkerRenderer
import com.aethercore.atak.trustoverlay.ui.TrustDetailPanelController
import com.aethercore.atak.trustoverlay.widget.TrustFeedHealthWidgetController
import com.atakmap.android.maps.MapView

class TrustOverlayMapComponent : AtakMapComponent {
    private var cotSubscriber: TrustCoTSubscriber? = null
    private var markerRenderer: TrustMarkerRenderer? = null
    private var detailPanel: TrustDetailPanelController? = null
    private var widgetController: TrustFeedHealthWidgetController? = null
    private var markerTapSubscription: Subscription? = null
    private var stateStore: TrustStateStore? = null
    private var mapArtifacts: UiArtifactCache? = null
    private var widgetArtifacts: UiArtifactCache? = null
    private var configuredTtlSeconds: Long = TrustStateStore.DEFAULT_TTL_SECONDS
    private val lastKnownStaleByUid: MutableMap<String, Boolean> = linkedMapOf()
    private var lastStaleSweepEpochMs: Long = 0L

    override fun onCreate(context: PluginContext) {
        context.logger.d("TrustOverlayMapComponent.onCreate")

        configuredTtlSeconds = context.settings.getLong(
            SETTINGS_TTL_SECONDS,
            TrustStateStore.DEFAULT_TTL_SECONDS,
        )
        stateStore = TrustStateStore(ttlSeconds = configuredTtlSeconds)

        markerRenderer = TrustMarkerRenderer(context.mapView)
        mapArtifacts = context.mapView as? UiArtifactCache
        detailPanel = TrustDetailPanelController(context.logger)
        cotSubscriber = TrustCoTSubscriber(context.cotBus, context.logger)
        widgetController = TrustFeedHealthWidgetController(
            widgetHost = context.widgetHost,
            enabled = true,
        )
        widgetArtifacts = context.widgetHost as? UiArtifactCache

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
                lastKnownStaleByUid[resolvedState.uid] = resolvedState.stale

                markerRenderer?.render(resolvedState)
                detailPanel?.onTrustEvent(markerId, resolvedState)
                widgetController?.onTrustEvent(trustEvent)

                maybeSweepStaleStates(store)

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
        widgetArtifacts?.clearAllArtifacts()
        mapArtifacts?.clearAllArtifacts()
        detailPanel?.clear()

        cotSubscriber = null
        markerRenderer = null
        detailPanel = null
        widgetController = null
        stateStore = null
        mapArtifacts = null
        widgetArtifacts = null
        lastKnownStaleByUid.clear()
        lastStaleSweepEpochMs = 0L
    }

    private fun maybeSweepStaleStates(store: TrustStateStore) {
        val nowEpochMs = System.currentTimeMillis()
        if (nowEpochMs - lastStaleSweepEpochMs < STALE_SWEEP_INTERVAL_MS) {
            return
        }
        lastStaleSweepEpochMs = nowEpochMs

        for (state in store.allResolved()) {
            val previousStale = lastKnownStaleByUid[state.uid]
            if (previousStale == null || previousStale != state.stale) {
                markerRenderer?.render(state)
                lastKnownStaleByUid[state.uid] = state.stale
            }
        }
    }

    companion object {
        const val SETTINGS_TTL_SECONDS = "trust.state.ttl.seconds"
        private const val STALE_SWEEP_INTERVAL_MS = 30_000L
    }
}
