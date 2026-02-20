package com.aethercore.atak.trustoverlay.core

import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.atak.MapView
import com.aethercore.atak.trustoverlay.atak.MarkerModel
import com.aethercore.atak.trustoverlay.atak.WidgetHost
import com.aethercore.atak.trustoverlay.atak.WidgetModel
import java.lang.reflect.Method

interface UiArtifactCache {
    fun clearAllArtifacts()
}

class AtakMapViewAdapter(
    private val delegate: com.atakmap.android.maps.MapView,
    private val logger: Logger,
) : MapView, UiArtifactCache {
    private val markerCache: MutableMap<String, Any> = linkedMapOf()
    private val markerModels: MutableMap<String, MarkerModel> = linkedMapOf()

    override fun upsertMarker(marker: MarkerModel) {
        val existing = markerCache[marker.id]
        val mapMarker = existing ?: createMarker(marker.id) ?: return

        val previous = markerModels[marker.id]
        updateMarkerGeometry(mapMarker, marker)
        if (previous?.title != marker.title) {
            setString(mapMarker, marker.title, "setTitle")
        }
        if (previous?.subtitle != marker.subtitle) {
            setString(mapMarker, marker.subtitle, "setSummary", "setSubtitle")
        }
        if (previous?.iconKey != marker.iconKey || existing == null) {
            applyIcon(mapMarker, marker.iconKey)
        }

        if (existing == null) {
            addToRootGroup(mapMarker)
            markerCache[marker.id] = mapMarker
            logger.d("upsertMarker created id=${marker.id} map=${delegate.hashCode()}")
        } else {
            logger.d("upsertMarker updated id=${marker.id} map=${delegate.hashCode()}")
        }
        markerModels[marker.id] = marker
    }

    override fun removeMarker(markerId: String) {
        val marker = markerCache.remove(markerId)
        markerModels.remove(markerId)
        if (marker != null) {
            removeFromRootGroup(marker)
            invokeIfPresent(marker, "dispose")
            logger.d("removeMarker removed id=$markerId map=${delegate.hashCode()}")
        } else {
            logger.d("removeMarker ignored missing id=$markerId map=${delegate.hashCode()}")
        }
    }

    override fun clearAllArtifacts() {
        markerCache.keys.toList().forEach(::removeMarker)
    }

    private fun createMarker(markerId: String): Any? {
        val markerClass = runCatching { Class.forName("com.atakmap.android.maps.Marker") }.getOrNull()
        if (markerClass == null) {
            logger.w("Unable to resolve ATAK Marker class for id=$markerId")
            return null
        }

        return runCatching {
            markerClass.getConstructor(String::class.java).newInstance(markerId)
        }.recoverCatching {
            markerClass.getDeclaredConstructor().newInstance().also { marker ->
                setString(marker, markerId, "setUid", "setUID")
            }
        }.onFailure { throwable ->
            logger.e("Failed to instantiate ATAK Marker for id=$markerId", throwable)
        }.getOrNull()
    }

    private fun updateMarkerGeometry(marker: Any, model: MarkerModel) {
        val geoPoint = newGeoPoint(model.lat, model.lon) ?: return
        val setPointMethod = marker.javaClass.methods.firstOrNull {
            it.name == "setPoint" && it.parameterTypes.size == 1
        }

        if (setPointMethod != null) {
            runCatching { setPointMethod.invoke(marker, geoPoint) }
                .onFailure { logger.e("Failed to set marker point id=${model.id}", it) }
        }
    }

    private fun newGeoPoint(lat: Double, lon: Double): Any? {
        val pointClass = runCatching { Class.forName("com.atakmap.coremap.maps.coords.GeoPoint") }.getOrNull()
            ?: return null
        return runCatching {
            pointClass.getConstructor(Double::class.javaPrimitiveType, Double::class.javaPrimitiveType)
                .newInstance(lat, lon)
        }.onFailure { logger.e("Failed to create GeoPoint", it) }
            .getOrNull()
    }

    private fun applyIcon(marker: Any, iconKey: String) {
        val iconUri = iconUriFor(iconKey)
        val iconClass = runCatching { Class.forName("com.atakmap.coremap.maps.assets.Icon") }.getOrNull()
        val builderClass = runCatching { Class.forName("com.atakmap.coremap.maps.assets.Icon\$Builder") }.getOrNull()

        if (iconClass != null && builderClass != null) {
            val icon = runCatching {
                val builder = builderClass.getDeclaredConstructor().newInstance()
                invokeIfPresent(builder, "setImageUri", 0, iconUri)
                invokeIfPresent(builder, "setAnchor", 16, 16)
                invokeIfPresent(builder, "setSize", 32, 32)
                builderClass.methods.first { it.name == "build" && it.parameterTypes.isEmpty() }
                    .invoke(builder)
            }.getOrNull()

            if (icon != null) {
                val setIconMethod = marker.javaClass.methods.firstOrNull {
                    it.name == "setIcon" && it.parameterTypes.size == 1 && it.parameterTypes[0].isAssignableFrom(iconClass)
                }
                if (setIconMethod != null) {
                    runCatching { setIconMethod.invoke(marker, icon) }
                        .onFailure { logger.e("Failed to set marker icon", it) }
                    return
                }
            }
        }

        invokeIfPresent(marker, "setMetaString", "iconUri", iconUri)
        invokeIfPresent(marker, "setMetaString", "iconsetpath", iconUri)
    }

    private fun iconUriFor(iconKey: String): String = when (iconKey) {
        "trust_marker_green" -> "asset://icons/trust_marker_green.png"
        "trust_marker_amber" -> "asset://icons/trust_marker_amber.png"
        "trust_marker_red" -> "asset://icons/trust_marker_red.png"
        else -> "asset://icons/reference_point.png"
    }

    private fun addToRootGroup(item: Any) {
        val rootGroup = runCatching { delegate.javaClass.methods.first { it.name == "getRootGroup" }.invoke(delegate) }
            .getOrNull() ?: return
        invokeIfPresent(rootGroup, "addItem", item)
    }

    private fun removeFromRootGroup(item: Any) {
        val rootGroup = runCatching { delegate.javaClass.methods.first { it.name == "getRootGroup" }.invoke(delegate) }
            .getOrNull() ?: return
        invokeIfPresent(rootGroup, "removeItem", item)
    }

    private fun setString(target: Any, value: String, vararg methodNames: String) {
        methodNames.forEach { name ->
            val method = target.javaClass.methods.firstOrNull {
                it.name == name && it.parameterTypes.contentEquals(arrayOf(String::class.java))
            }
            if (method != null) {
                runCatching { method.invoke(target, value) }
                    .onFailure { logger.e("Failed invoking $name", it) }
                return
            }
        }
    }
}

class AtakWidgetHost(
    private val mapView: com.atakmap.android.maps.MapView,
    private val logger: Logger,
) : WidgetHost, UiArtifactCache {
    private val widgetCache: MutableMap<String, Any> = linkedMapOf()
    private val widgetModels: MutableMap<String, WidgetModel> = linkedMapOf()

    override fun show(widget: WidgetModel) {
        val existing = widgetCache[widget.id]
        val atakWidget = existing ?: createTextWidget(widget) ?: return

        if (existing == null) {
            addWidget(atakWidget)
            widgetCache[widget.id] = atakWidget
            logger.d("widget.show created id=${widget.id}")
        }

        applyWidgetModel(atakWidget, widget)
        widgetModels[widget.id] = widget
    }

    override fun update(widget: WidgetModel) {
        val atakWidget = widgetCache[widget.id]
        if (atakWidget == null) {
            show(widget)
            return
        }

        applyWidgetModel(atakWidget, widget)
        widgetModels[widget.id] = widget
        logger.d("widget.update id=${widget.id} severity=${widget.severity}")
    }

    override fun hide(widgetId: String) {
        val widget = widgetCache.remove(widgetId)
        widgetModels.remove(widgetId)
        if (widget != null) {
            removeWidget(widget)
            invokeIfPresent(widget, "setVisible", false)
            logger.d("widget.hide id=$widgetId")
        }
    }

    override fun clearAllArtifacts() {
        widgetCache.keys.toList().forEach(::hide)
    }

    private fun createTextWidget(widget: WidgetModel): Any? {
        val widgetClass = runCatching { Class.forName("com.atakmap.android.widgets.TextWidget") }.getOrNull()
        if (widgetClass == null) {
            logger.w("Unable to resolve ATAK TextWidget class for id=${widget.id}")
            return null
        }

        return runCatching {
            widgetClass.getConstructor(String::class.java).newInstance(widget.title)
        }.recoverCatching {
            widgetClass.getDeclaredConstructor().newInstance()
        }.onFailure {
            logger.e("Failed to create ATAK widget id=${widget.id}", it)
        }.getOrNull()
    }

    private fun applyWidgetModel(widget: Any, model: WidgetModel) {
        val text = "${model.title}: ${model.value}"
        invokeIfPresent(widget, "setName", model.id)
        invokeIfPresent(widget, "setText", text)
        invokeIfPresent(widget, "setVisible", true)
        invokeIfPresent(widget, "setColor", colorFor(model.severity))
    }

    private fun addWidget(widget: Any) {
        val rootLayout = resolveRootLayoutWidget() ?: return
        invokeIfPresent(rootLayout, "addWidget", widget)
    }

    private fun removeWidget(widget: Any) {
        val rootLayout = resolveRootLayoutWidget() ?: return
        invokeIfPresent(rootLayout, "removeWidget", widget)
    }

    private fun resolveRootLayoutWidget(): Any? {
        val candidates = listOf("getRootLayoutWidget", "getComponentRootLayoutWidget")
        for (methodName in candidates) {
            val method = mapView.javaClass.methods.firstOrNull {
                it.name == methodName && it.parameterTypes.isEmpty()
            }
            if (method != null) {
                return runCatching { method.invoke(mapView) }.getOrNull()
            }
        }
        return null
    }

    private fun colorFor(severity: String): Int = when (severity.lowercase()) {
        "high" -> 0xFFFF5555.toInt()
        "medium" -> 0xFFFFC107.toInt()
        else -> 0xFF9CCC65.toInt()
    }
}

private fun invokeIfPresent(target: Any, methodName: String, vararg args: Any): Any? {
    val argTypes = args.map { arg ->
        when (arg) {
            is Int -> Int::class.javaPrimitiveType
            is Boolean -> Boolean::class.javaPrimitiveType
            else -> arg.javaClass
        }
    }

    val method: Method = target.javaClass.methods.firstOrNull { candidate ->
        candidate.name == methodName && candidate.parameterTypes.size == args.size &&
            candidate.parameterTypes.zip(argTypes).all { (declared, provided) ->
                provided != null && (declared == provided || declared.isAssignableFrom(provided))
            }
    } ?: return null

    return runCatching { method.invoke(target, *args) }.getOrNull()
}
