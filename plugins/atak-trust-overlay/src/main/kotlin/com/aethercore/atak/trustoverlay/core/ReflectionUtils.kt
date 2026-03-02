package com.aethercore.atak.trustoverlay.core

import java.lang.reflect.Method

/**
 * Shared reflection utilities for ATAK integration
 */

internal fun invokeIfPresent(target: Any, methodName: String, vararg args: Any): Any? {
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

