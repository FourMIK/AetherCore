package com.aethercore.atak.trustoverlay.core

import android.test.mock.MockContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RalphieNodeDaemonTest {
    @Test
    fun startReturnsFalseWhenJniFailsToLoad() {
        val bindings = RecordingBindings()
        val daemon = RalphieNodeDaemon(
            context = MockContext(),
            libraryLoader = { throw UnsatisfiedLinkError("missing aethercore_jni") },
            nativeBindings = bindings,
        )

        assertFalse(daemon.start())
        val status = daemon.startupStatus()
        assertTrue(status is RalphieDaemonStartupStatus.Unavailable)
        assertEquals(0, bindings.initializeCalls)
        assertEquals(0, bindings.startCalls)
    }

    @Test
    fun stopAndSweepAreNoopsWhenJniFailsToLoad() {
        val bindings = RecordingBindings()
        val daemon = RalphieNodeDaemon(
            context = MockContext(),
            libraryLoader = { throw UnsatisfiedLinkError("missing aethercore_jni") },
            nativeBindings = bindings,
        )

        assertFalse(daemon.stop())
        assertFalse(daemon.forceSweep())
        assertEquals(0, bindings.stopCalls)
        assertEquals(0, bindings.sweepCalls)
    }

    private class RecordingBindings : NativeBindings() {
        var initializeCalls = 0
        var startCalls = 0
        var stopCalls = 0
        var sweepCalls = 0

        override fun initialize(nativeBridge: NativeBridge, storagePath: String, hardwareId: String): Boolean {
            initializeCalls += 1
            return true
        }

        override fun start(nativeBridge: NativeBridge): Boolean {
            startCalls += 1
            return true
        }

        override fun stop(nativeBridge: NativeBridge): Boolean {
            stopCalls += 1
            return true
        }

        override fun forceSweep(nativeBridge: NativeBridge): Boolean {
            sweepCalls += 1
            return true
        }
    }
}
