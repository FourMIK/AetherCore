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

## SDK prerequisites

Compatible ATAK baseline for this module: **ATAK-CIV 5.2.x** (or an org-equivalent TAK distribution with matching plugin APIs).

Provide ATAK SDK dependencies using **one** of the following approaches:

1. Local binaries in `libs/` (default path):
   - `plugins/atak-trust-overlay/libs/atak-sdk.jar`
   - `plugins/atak-trust-overlay/libs/atak-plugin-sdk.aar`
2. Private Maven repo (optional): define the following in `local.properties`:
   - `atak.maven.url=https://<your-private-repo>`
   - `atak.maven.artifacts=group:artifact:version,group:artifact:version`

You can override local artifact names (comma-separated) with:

- `atak.required.artifacts=atak-sdk.jar,atak-plugin-sdk.aar`

Gradle preflight now fails early when required ATAK artifacts are not available from either `libs/` or the configured private Maven repo.

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
