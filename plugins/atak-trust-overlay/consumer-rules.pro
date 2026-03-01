# Consumer rules for downstream apps embedding this plugin.
# Keep plugin entry points if minification is enabled.
-keep class com.aethercore.atak.trustoverlay.core.TrustOverlayMapComponent { *; }
-keep class com.aethercore.atak.trustoverlay.core.TrustOverlayPluginReceiver { *; }
-keep class com.aethercore.atak.trustoverlay.core.TrustOverlayLifecycle { *; }

# Keep JNI bridge classes to prevent UnsatisfiedLinkError at runtime
-keep class com.aethercore.atak.trustoverlay.cot.TrustEventParser {
    native <methods>;
}
-keep class com.aethercore.atak.trustoverlay.core.RalphieNodeDaemon {
    native <methods>;
}
