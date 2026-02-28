package com.aethercore.atak.trustoverlay.core

import android.content.Context
import android.test.mock.MockContext
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class LifecycleBootstrapResolverTest {
    @Test
    fun resolveDependenciesFromDelegateMethods() {
        val context = MockContext()
        val mapView = FakeMapView(context)
        val delegate = DelegateWithMethods(context, mapView)

        val resolvedContext = LifecycleBootstrapResolver.resolvePluginContext(delegate)
        val resolvedMapView = LifecycleBootstrapResolver.resolveMapView(delegate)

        assertSame(context, resolvedContext)
        assertSame(mapView, resolvedMapView)
    }

    @Test
    fun resolveContextFromMapViewWhenDelegateContextMissing() {
        val context = MockContext()
        val mapView = FakeMapView(context)
        val delegate = DelegateWithMapOnly(mapView)

        val resolvedContext = LifecycleBootstrapResolver.resolvePluginContext(delegate)

        assertSame(context, resolvedContext)
    }

    @Test
    fun unresolvedDelegateReturnsNulls() {
        val delegate = EmptyDelegate()

        val resolvedContext = LifecycleBootstrapResolver.resolvePluginContext(delegate)
        val resolvedMapView = LifecycleBootstrapResolver.resolveMapView(delegate)

        assertNull(resolvedContext)
        assertNull(resolvedMapView)
    }

    @Test
    fun lifecycleOnCreateReturnsWhenDependenciesCannotBeResolved() {
        TrustOverlayLifecycle().onCreate(delegate = null)
    }

    private class DelegateWithMethods(
        private val context: Context,
        private val mapView: Any,
    ) {
        fun getPluginContext(): Context = context
        fun getMapView(): Any = mapView
    }

    private class DelegateWithMapOnly(
        private val mapView: Any,
    ) {
        fun getMapView(): Any = mapView
    }

    private class EmptyDelegate

    private class FakeMapView(
        private val context: Context,
    ) {
        fun getContext(): Context = context
    }
}
