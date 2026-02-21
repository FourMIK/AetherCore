package com.aethercore.atak.trustoverlay.core

import android.content.Context
import android.util.Log

internal object AtakCompatibilityContract {
    private const val TAG = "AtakCompatibility"
    private const val MIN_SUPPORTED_VERSION = "4.6.0.5"
    private const val COMPONENT_ROOT_LAYOUT_MIN_VERSION = "5.0.0"

    @Volatile
    private var resolvedRuntimeVersion: String? = null

    @Volatile
    private var versionChecked = false

    fun validateRuntimeOrNull(context: Context?): String? {
        val runtimeVersion = detectRuntimeVersion(context)
        resolvedRuntimeVersion = runtimeVersion
        versionChecked = true

        if (runtimeVersion == null) {
            Log.w(TAG, "Unable to detect ATAK runtime version; proceeding with reflective feature checks")
            return null
        }

        if (compareVersions(runtimeVersion, MIN_SUPPORTED_VERSION) < 0) {
            Log.e(TAG, "ATAK runtime version $runtimeVersion is below required minimum $MIN_SUPPORTED_VERSION")
            return null
        }

        Log.i(TAG, "ATAK runtime version $runtimeVersion satisfies minimum $MIN_SUPPORTED_VERSION")
        return runtimeVersion
    }

    fun minimumSupportedVersion(): String = MIN_SUPPORTED_VERSION

    fun supportsComponentRootLayoutApi(): Boolean {
        if (!versionChecked) {
            return false
        }
        val version = resolvedRuntimeVersion ?: return false
        return compareVersions(version, COMPONENT_ROOT_LAYOUT_MIN_VERSION) >= 0
    }

    private fun detectRuntimeVersion(context: Context?): String? {
        val candidates = listOfNotNull(
            readStaticString("com.atakmap.app.BuildConfig", "ATAK_VERSION"),
            readStaticString("com.atakmap.app.BuildConfig", "VERSION_NAME"),
            readStaticString("com.atakmap.android.util.ATAKConstants", "VERSION_NAME"),
            readStaticString("com.atakmap.android.util.ATAKConstants", "VERSION"),
            invokeNoArgString(context, "getVersionName"),
        )

        return candidates
            .asSequence()
            .mapNotNull(::extractVersion)
            .firstOrNull()
    }

    private fun invokeNoArgString(target: Any?, methodName: String): String? {
        if (target == null) return null
        val method = target.javaClass.methods.firstOrNull {
            it.name == methodName && it.parameterTypes.isEmpty() && it.returnType == String::class.java
        } ?: return null
        return runCatching { method.invoke(target) as? String }.getOrNull()
    }

    private fun readStaticString(className: String, fieldName: String): String? {
        val klass = runCatching { Class.forName(className) }.getOrNull() ?: return null
        val field = runCatching { klass.getDeclaredField(fieldName) }.getOrNull() ?: return null
        field.isAccessible = true
        return runCatching { field.get(null) as? String }.getOrNull()
    }

    private fun extractVersion(raw: String): String? {
        val match = Regex("(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?(?:\\.(\\d+))?")
            .find(raw)
            ?.value
            ?: return null
        return match.trim()
    }

    private fun compareVersions(left: String, right: String): Int {
        val leftParts = left.split('.').mapNotNull { it.toIntOrNull() }
        val rightParts = right.split('.').mapNotNull { it.toIntOrNull() }
        val maxSize = maxOf(leftParts.size, rightParts.size)
        for (index in 0 until maxSize) {
            val l = leftParts.getOrElse(index) { 0 }
            val r = rightParts.getOrElse(index) { 0 }
            if (l != r) {
                return l.compareTo(r)
            }
        }
        return 0
    }
}
