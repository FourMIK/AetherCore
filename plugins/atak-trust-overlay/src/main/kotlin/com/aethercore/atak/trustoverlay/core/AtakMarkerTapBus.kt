package com.aethercore.atak.trustoverlay.core

import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.atak.MarkerHandle
import com.aethercore.atak.trustoverlay.atak.MarkerTapBus
import com.aethercore.atak.trustoverlay.atak.Subscription
import java.lang.reflect.Proxy
import java.util.concurrent.atomic.AtomicBoolean

class AtakMarkerTapBus(
    private val mapView: com.atakmap.android.maps.MapView,
    private val logger: Logger,
) : MarkerTapBus {

    override fun subscribe(handler: (MarkerHandle) -> Unit): Subscription {
        val eventTypes = resolveTapEventTypes()
        val dispatcher = resolveMapEventDispatcher()
        if (dispatcher == null) {
            logger.w("Unable to resolve ATAK MapEventDispatcher for marker tap subscription")
            return NoopSubscription
        }

        val addMethod = dispatcher.javaClass.methods.firstOrNull { method ->
            method.name == "addMapEventListener" &&
                method.parameterTypes.size == 2 &&
                method.parameterTypes[0] == String::class.java
        }
        val removeMethod = dispatcher.javaClass.methods.firstOrNull { method ->
            method.name == "removeMapEventListener" &&
                method.parameterTypes.size == 2 &&
                method.parameterTypes[0] == String::class.java
        }

        if (addMethod == null || removeMethod == null) {
            logger.w("ATAK MapEventDispatcher listener methods unavailable")
            return NoopSubscription
        }

        val listenerType = addMethod.parameterTypes[1]
        val listener = Proxy.newProxyInstance(
            listenerType.classLoader,
            arrayOf(listenerType),
        ) { _, _, args ->
            val event = args?.firstOrNull() ?: return@newProxyInstance null
            val item = invokeIfPresent(event, "getItem") ?: invokeIfPresent(event, "getMapItem")
            val rawUid = extractUid(item) ?: extractUid(event) ?: return@newProxyInstance null
            val markerId = if (rawUid.startsWith(TRUST_MARKER_PREFIX)) rawUid else "$TRUST_MARKER_PREFIX$rawUid"
            handler(MarkerHandle(markerId))
            null
        }

        val registered = runCatching {
            eventTypes.forEach { eventType ->
                addMethod.invoke(dispatcher, eventType, listener)
            }
            true
        }.onFailure {
            logger.e("Failed to register ATAK marker tap listener", it)
        }.getOrDefault(false)

        if (!registered) {
            return NoopSubscription
        }

        return object : Subscription {
            private val disposed = AtomicBoolean(false)

            override fun dispose() {
                if (!disposed.compareAndSet(false, true)) {
                    return
                }

                runCatching {
                    eventTypes.forEach { eventType ->
                        removeMethod.invoke(dispatcher, eventType, listener)
                    }
                }.onFailure {
                    logger.e("Failed to unregister ATAK marker tap listener", it)
                }
            }
        }
    }

    private fun resolveMapEventDispatcher(): Any? {
        val method = mapView.javaClass.methods.firstOrNull {
            it.name == "getMapEventDispatcher" && it.parameterTypes.isEmpty()
        } ?: return null

        return runCatching { method.invoke(mapView) }
            .onFailure { logger.e("Failed to resolve map event dispatcher", it) }
            .getOrNull()
    }

    private fun extractUid(target: Any?): String? {
        if (target == null) {
            return null
        }

        val uid = invokeIfPresent(target, "getUID") as? String
            ?: invokeIfPresent(target, "getUid") as? String
            ?: invokeIfPresent(target, "getMetaString", "uid", "") as? String
            ?: invokeIfPresent(target, "getMetaString", "UID", "") as? String

        return uid?.takeIf { it.isNotBlank() }
    }

    private fun resolveTapEventTypes(): List<String> {
        val mapEventClass = runCatching { Class.forName("com.atakmap.android.maps.MapEvent") }.getOrNull()
        if (mapEventClass == null) {
            return DEFAULT_TAP_EVENT_TYPES
        }

        val eventTypes = listOfNotNull(
            runCatching { mapEventClass.getField("ITEM_CLICK").get(null) as? String }.getOrNull(),
            runCatching { mapEventClass.getField("ITEM_TAP").get(null) as? String }.getOrNull(),
        )

        return eventTypes.ifEmpty { DEFAULT_TAP_EVENT_TYPES }
    }

    private object NoopSubscription : Subscription {
        override fun dispose() = Unit
    }

    private companion object {
        val DEFAULT_TAP_EVENT_TYPES = listOf("ITEM_CLICK", "ITEM_TAP")
        const val TRUST_MARKER_PREFIX = "trust:"
    }
}
