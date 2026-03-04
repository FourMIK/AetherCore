package com.aethercore.atak.trustoverlay.core

import com.aethercore.atak.trustoverlay.atak.AtakMapComponent
import com.aethercore.atak.trustoverlay.atak.PluginContext
import com.aethercore.atak.trustoverlay.atak.Subscription
import com.aethercore.atak.trustoverlay.cot.TrustCoTSubscriber
import com.aethercore.atak.trustoverlay.map.TrustMarkerRenderer
import com.aethercore.atak.trustoverlay.ui.TrustDetailPanelController
import com.aethercore.atak.trustoverlay.widget.TrustFeedHealthWidgetController
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

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
    private val stateLock = Any()
    private var feedRefreshExecutor: ScheduledExecutorService? = null
    private var feedRefreshTask: ScheduledFuture<*>? = null

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
        markerRenderer?.setFeedStatus(stateStore?.feedStatus() ?: TrustFeedStatus.DEGRADED)

        markerTapSubscription = context.markerTapBus.subscribe { markerHandle ->
            detailPanel?.onMarkerTapped(markerHandle.id)
        }

        startFeedRefreshLoop(context)

        cotSubscriber?.start(
            onTrustEvent = { trustEvent ->
                val markerId = "trust:${trustEvent.uid}"
                val stateUpdate: StateUpdate = synchronized(stateLock) {
                    val store = stateStore ?: return@synchronized null
                    store.record(trustEvent)
                    StateUpdate(
                        feedStatus = store.feedStatus(),
                        resolvedState = store.resolve(trustEvent.uid),
                        staleStates = store.allResolved().filter { it.stale },
                    )
                } ?: return@start
                markerRenderer?.setFeedStatus(stateUpdate.feedStatus)

                markerRenderer?.render(stateUpdate.resolvedState)
                detailPanel?.onTrustEvent(markerId, stateUpdate.resolvedState)
                widgetController?.onTrustEvent(trustEvent)

                for (state in stateUpdate.staleStates) {
                    markerRenderer?.render(state)
                }

                widgetController?.onFeedStatus(
                    status = stateUpdate.feedStatus,
                    ttlSeconds = configuredTtlSeconds,
                )
            },
            onMalformedEvent = { count, reason ->
                context.logger.w("Trust feed malformed event count=$count reason=${reason ?: "unknown"}")
                widgetController?.onMalformedEvent(count, reason)
                val feedStatus = currentFeedStatus()
                markerRenderer?.setFeedStatus(feedStatus)
                widgetController?.onFeedStatus(
                    status = feedStatus,
                    ttlSeconds = configuredTtlSeconds,
                )
            },
        )
    }

    override fun onDestroy() {
        feedRefreshTask?.cancel(false)
        feedRefreshTask = null
        feedRefreshExecutor?.shutdownNow()
        feedRefreshExecutor = null

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
    }

    companion object {
        const val SETTINGS_TTL_SECONDS = "trust.state.ttl.seconds"
    }

    private fun startFeedRefreshLoop(context: PluginContext) {
        feedRefreshExecutor?.shutdownNow()
        feedRefreshExecutor = Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "trust-feed-refresh").apply { isDaemon = true }
        }
        val refreshIntervalSeconds = ((configuredTtlSeconds / 4L).coerceAtLeast(5L)).coerceAtMost(30L)
        feedRefreshTask = feedRefreshExecutor?.scheduleAtFixedRate(
            {
                refreshUiForCurrentState(context)
            },
            refreshIntervalSeconds,
            refreshIntervalSeconds,
            TimeUnit.SECONDS,
        )
    }

    private fun refreshUiForCurrentState(context: PluginContext) {
        val snapshot: List<ResolvedTrustState>
        val feedStatus: TrustFeedStatus
        synchronized(stateLock) {
            val store = stateStore ?: return
            feedStatus = store.feedStatus()
            snapshot = store.allResolved()
        }

        markerRenderer?.setFeedStatus(feedStatus)
        snapshot.forEach { markerRenderer?.render(it) }
        widgetController?.onFeedStatus(
            status = feedStatus,
            ttlSeconds = configuredTtlSeconds,
        )
        context.logger.d(
            "Trust feed refresh tick status=${feedStatus.name} nodes=${snapshot.size} ttl=${configuredTtlSeconds}s",
        )
    }

    private fun currentFeedStatus(): TrustFeedStatus = synchronized(stateLock) {
        stateStore?.feedStatus() ?: TrustFeedStatus.DEGRADED
    }

    private data class StateUpdate(
        val feedStatus: TrustFeedStatus,
        val resolvedState: ResolvedTrustState,
        val staleStates: List<ResolvedTrustState>,
    )
}
