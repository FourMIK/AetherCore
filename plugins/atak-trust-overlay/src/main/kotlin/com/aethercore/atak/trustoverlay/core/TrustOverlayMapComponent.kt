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
    private var daemon: RalphieNodeDaemon? = null

    override fun onCreate(context: PluginContext) {
        context.logger.d("TrustOverlayMapComponent.onCreate")

        // Store reference to daemon for identity and trust score management
        daemon = context.daemon

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
            onRawEnvelope = { envelope ->
                // Auto-register identities from CoT events
                daemon?.let { d ->
                    val extractionResult = com.aethercore.atak.trustoverlay.identity.TrustIdentityExtractor.extract(envelope)
                    when (extractionResult) {
                        is com.aethercore.atak.trustoverlay.identity.IdentityExtractionResult.IdentityExtracted -> {
                            context.logger.d("Extracted identity from CoT: node_id=${extractionResult.nodeId}")
                            val registrationResult = d.registerIdentity(extractionResult.nodeId, extractionResult.publicKey)
                            when (registrationResult) {
                                is IdentityRegistrationResult.Success -> {
                                    context.logger.d("Auto-registered identity: node_id=${extractionResult.nodeId}")
                                }
                                is IdentityRegistrationResult.AlreadyRegistered -> {
                                    // Already registered - this is fine
                                    context.logger.d("Identity already registered: node_id=${extractionResult.nodeId}")
                                }
                                is IdentityRegistrationResult.KeyMismatch -> {
                                    context.logger.w("Identity key mismatch for node_id=${extractionResult.nodeId} - possible security issue!")
                                }
                                is IdentityRegistrationResult.InvalidKey -> {
                                    context.logger.w("Invalid key in CoT for node_id=${extractionResult.nodeId}: ${registrationResult.reason}")
                                }
                                is IdentityRegistrationResult.InternalError -> {
                                    context.logger.e("Failed to register identity: ${registrationResult.details}")
                                }
                            }
                        }
                        is com.aethercore.atak.trustoverlay.identity.IdentityExtractionResult.IdentityMissing -> {
                            // No identity in CoT - this is acceptable (not all events have identity)
                            context.logger.d("No identity in CoT event: ${extractionResult.reason}")
                        }
                        is com.aethercore.atak.trustoverlay.identity.IdentityExtractionResult.IdentityInvalid -> {
                            context.logger.w("Invalid identity in CoT for node_id=${extractionResult.nodeId}: ${extractionResult.reason}")
                        }
                    }
                }
            },
            onTrustEvent = { trustEvent ->
                val markerId = "trust:${trustEvent.uid}"
                val store = stateStore ?: return@start
                store.record(trustEvent)
                val resolvedState = store.resolve(trustEvent.uid)

                // Integrate with RalphieNode daemon for identity and trust management
                daemon?.let { d ->
                    // Update trust score based on signature verification and trust level
                    val delta = calculateTrustDelta(trustEvent)
                    if (delta != 0.0) {
                        val updated = d.updateTrustScore(trustEvent.uid, delta)
                        if (updated) {
                            context.logger.d("Updated trust score for ${trustEvent.uid} by $delta (signature_verified=${trustEvent.signatureVerified})")
                        }
                    }

                    // Log current computed trust score
                    val currentScore = d.getComputedTrustScore(trustEvent.uid)
                    if (currentScore >= 0.0) {
                        context.logger.d("Computed trust score for ${trustEvent.uid}: $currentScore")
                    }

                    // Log identity status
                    val identityStatus = d.getIdentityStatus(trustEvent.uid)
                    context.logger.d("Identity status for ${trustEvent.uid}: $identityStatus")
                }

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
        daemon = null
    }

    /**
     * Calculate trust score delta based on event characteristics.
     * Positive delta increases trust, negative delta decreases trust.
     */
    private fun calculateTrustDelta(event: TrustEvent): Double {
        // Signature verification is critical for trust
        if (event.signatureVerified) {
            // Verified signature: boost trust
            return when (event.level) {
                TrustLevel.HIGH -> 0.05      // Small boost for already-high nodes
                TrustLevel.MEDIUM -> 0.1     // Medium boost for medium nodes
                TrustLevel.LOW -> 0.15       // Larger boost for low nodes recovering
                TrustLevel.UNKNOWN -> 0.0    // No change for unknown
            }
        } else if (event.signatureHex != null) {
            // Signature present but failed verification: penalize heavily
            return when (event.level) {
                TrustLevel.HIGH -> -0.2      // Heavy penalty even for high nodes
                TrustLevel.MEDIUM -> -0.3    // Severe penalty
                TrustLevel.LOW -> -0.4       // Critical penalty
                TrustLevel.UNKNOWN -> -0.1   // Moderate penalty
            }
        } else {
            // No signature: small penalty (unsigned data is suspicious)
            return -0.05
        }
    }

    companion object {
        const val SETTINGS_TTL_SECONDS = "trust.state.ttl.seconds"
    }
}
