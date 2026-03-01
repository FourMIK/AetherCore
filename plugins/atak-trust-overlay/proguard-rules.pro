# Keep plugin entry points if minification is enabled.
-keep class com.aethercore.atak.trustoverlay.core.TrustOverlayMapComponent { *; }
-keep class com.aethercore.atak.trustoverlay.core.TrustOverlayPluginReceiver { *; }
-keep class com.aethercore.atak.trustoverlay.core.TrustOverlayLifecycle { *; }

# Keep JNI bridge classes and native methods
-keep class com.aethercore.atak.trustoverlay.cot.TrustEventParser {
    native <methods>;
}
-keep class com.aethercore.atak.trustoverlay.core.RalphieNodeDaemon {
    native <methods>;
}

# Keep classes referenced from native code
-keep class com.aethercore.atak.trustoverlay.core.TrustEvent { *; }
-keep class com.aethercore.atak.trustoverlay.core.TrustLevel { *; }

# Prevent stripping of @Throws annotations on native methods
-keepattributes Exceptions
