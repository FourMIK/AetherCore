# ATAK Trust Overlay Plugin Module

This module scaffolds a standalone Android ATAK plugin at `plugins/atak-trust-overlay/` with explicit entry points for:

1. CoT event subscription for trust CoT types.
2. Marker rendering and updates by trust level.
3. Marker tap detail-panel behavior.
4. Optional global widget for trust feed health.

## Entry points

- `TrustOverlayLifecycle`: ATAK SDK lifecycle entry that starts/stops plugin runtime with ATAK lifecycle callbacks.
- `TrustOverlayMapComponent`: internal map-layer component that wires overlay subsystems.
- `TrustCoTSubscriber`: subscribes to trust CoT events and normalizes to `TrustEvent`.
- `TrustMarkerRenderer`: translates trust level -> marker style/icon and updates map overlays.
- `TrustDetailPanelController`: shows detail panel when a trust marker is tapped.
- `TrustFeedHealthWidgetController`: (optional) global widget lifecycle and refresh loop.

## ATAK registration artifacts

- `src/main/AndroidManifest.xml`: plugin package metadata and ATAK plugin XML registration.
- `src/main/res/xml/trust_overlay_plugin.xml`: ATAK plugin metadata pointing to the lifecycle component.
- `src/main/assets/plugin.xml`: ATAK plugin descriptor with lifecycle entry-point binding.

## Notes

This scaffold is intentionally API-light and framework-agnostic so you can replace adapter interfaces in `atak/AtakContracts.kt` with your concrete ATAK SDK classes (`MapView`, `MapComponent`, CoT dispatch interfaces, widget APIs) used by your environment.

## Integration runtime flow

ATAK loads this plugin through metadata in `AndroidManifest.xml`, then resolves `@xml/trust_overlay_plugin` and `assets/plugin.xml`, both of which point to `TrustOverlayLifecycle` as the single startup authority. `TrustOverlayLifecycle.onCreate` initializes the Ralphie daemon, CoT bus adapters, and `TrustOverlayMapComponent`; ATAK lifecycle callbacks then control teardown via `onDestroy`. No broadcast bootstrap path is used, preventing duplicate startup paths.

## Native JNI build setup (required)

This plugin expects the Rust JNI crate that produces `libaethercore_jni.so` to exist **outside** the ATAK plugin module at:

- `external/aethercore-jni` (relative to the AetherCore repository root)

### 1) Checkout the JNI crate

If the JNI crate is private/external, clone it into the expected directory:

```bash
git clone <your-jni-repo-url> external/aethercore-jni
```

Alternatively, keep it elsewhere and set one of:

- CMake override: `-DAETHERCORE_JNI_DIR=/absolute/path/to/aethercore-jni`
- Gradle local override in `plugins/atak-trust-overlay/local.properties`:
  - `aethercore.jni.dir=/absolute/path/to/aethercore-jni`

### 2) Install required native toolchain

Required tools for JNI builds:

- Rust + Cargo (`rustup`)
- `cargo-ndk` (`cargo install cargo-ndk`)
- Android SDK + NDK (for your Android Gradle Plugin setup)

### 3) Preflight guards

Both CMake and Gradle fail fast with clear errors when the JNI crate path is missing or invalid (`Cargo.toml` not found), so broken local setup is detected before long native builds run.


## Troubleshooting JNI setup

Common fail-fast errors and fixes:

- **"AetherCore JNI crate not found" (Gradle/CMake)**
  - Confirm the crate exists at `external/aethercore-jni`, or set `aethercore.jni.dir=/abs/path` in `plugins/atak-trust-overlay/local.properties`.
  - If building from CMake directly, pass `-DAETHERCORE_JNI_DIR=/abs/path`.
- **"missing Cargo.toml"**
  - Ensure `Cargo.toml` is at the crate root and that it defines a library target named `aethercore_jni` with `crate-type = ["cdylib"]`.
- **"cargo was not found on PATH"**
  - Install Rust via `rustup` and restart Android Studio so its integrated terminal inherits the updated `PATH`.
- **"cargo-ndk is required but was not found"**
  - Install with `cargo install cargo-ndk` and verify with `cargo ndk --version`.
- **Android NDK/CMake toolchain errors**
  - Install the Android NDK from Android Studio SDK Manager and ensure your project points to that SDK/NDK installation.
