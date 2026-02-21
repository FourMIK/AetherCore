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


## ATAK compatibility baseline

Canonical ATAK baseline for this plugin is **4.6.0.5**.

- Gradle default: `atak.compatible.version=4.6.0.5` (override with `-Patak.compatible.version=<version>`).
- The plugin remains compile-compatible with this baseline because direct ATAK API usage is intentionally minimized to stable types (`gov.tak.api.plugin.ILifecycle`, `gov.tak.api.plugin.IServiceController`, `com.atakmap.android.maps.MapView`) and all volatile map/UI/event hooks are resolved via reflection with method/field fallbacks.
- Validation outcome for 4.6.0.5 API surface: **no source changes required**; current adapters already gate optional APIs and degrade gracefully when a symbol is unavailable.

## ATAK registration artifacts

- `src/main/AndroidManifest.xml`: plugin package metadata and ATAK plugin XML registration.
- `src/main/res/xml/trust_overlay_plugin.xml`: ATAK plugin metadata pointing to the lifecycle component.
- `src/main/assets/plugin.xml`: ATAK plugin descriptor with lifecycle entry-point binding.

## Notes

This scaffold is intentionally API-light and framework-agnostic so you can replace adapter interfaces in `atak/AtakContracts.kt` with your concrete ATAK SDK classes (`MapView`, `MapComponent`, CoT dispatch interfaces, widget APIs) used by your environment.

## Integration runtime flow

ATAK loads this plugin through metadata in `AndroidManifest.xml`, then resolves `@xml/trust_overlay_plugin` and `assets/plugin.xml`, both of which point to `TrustOverlayLifecycle` as the single startup authority. `TrustOverlayLifecycle.onCreate` initializes the Ralphie daemon, CoT bus adapters, and `TrustOverlayMapComponent`; ATAK lifecycle callbacks then control teardown via `onDestroy`. No broadcast bootstrap path is used, preventing duplicate startup paths.

## SDK prerequisites (required)

This plugin compiles against ATAK SDK jar artifacts in `plugins/atak-trust-overlay/libs`.

- Default required set: `main.jar`
- Gradle property: `atak.required.artifacts` (comma-separated filenames)
- Default contract: `atak.required.artifacts=main.jar`

### 1) Copy ATAK SDK artifacts into `libs/`

```bash
mkdir -p plugins/atak-trust-overlay/libs
cp atak/ATAK/app/build/libs/main.jar plugins/atak-trust-overlay/libs/main.jar
```

If your environment uses different names, either rename files in `libs/` or override the required set with Gradle:

```bash
./gradlew -Patak.required.artifacts=main.jar,<additional>.jar :plugins:atak-trust-overlay:preBuild
```

### 2) Preflight guards

`preBuild` runs `verifyAtakSdkArtifacts` and fails fast when any required SDK filename from `atak.required.artifacts` is missing from `libs/`.

See `plugins/atak-trust-overlay/libs/README.md` for the offline contract and examples.

## Open in Android Studio

Import path:

- Open **`plugins/atak-trust-overlay`** as the project root in Android Studio.

Toolchain requirements (pin these in your host project if not already pinned):

- **JDK:** 17 (required by `sourceCompatibility/targetCompatibility` and Kotlin `jvmTarget=17`).
- **AGP:** 8.2.x (recommended baseline for `compileSdk 34` + Java 17 module setup).
- **Kotlin Gradle plugin:** 1.9.22 (or compatible 1.9.x line).
- **Gradle:** 8.2.x (if you add a wrapper externally, align it with AGP 8.2.x).

Required local files/properties before sync/build:

- `local.properties` at project root with standard Android SDK path:
  - `sdk.dir=/absolute/path/to/Android/Sdk`
- JNI override (if JNI crate is not at `../../external/aethercore-jni` relative to this module root):
  - `aethercore.jni.dir=/absolute/path/to/aethercore-jni`
- Release signing (only needed for `release` builds/signing):
  - `keystore.path=/absolute/path/to/keystore.jks`
  - `keystore.password=...`
  - `key.alias=...`
  - `key.password=...`

Expected successful outcomes:

- Gradle Sync completes without `verifyAethercoreJniCrate`/`verifyAtakSdkArtifacts` task errors.
- `:preBuild` passes after SDK jars exist under `plugins/atak-trust-overlay/libs` (default requires `main.jar`).
- `:assembleDebug` produces a debug APK with JNI targets for `armeabi-v7a` and `arm64-v8a`.

Common failure signatures:

- `AetherCore JNI crate not found at '...'` → set `aethercore.jni.dir` or checkout `external/aethercore-jni`.
- `AetherCore JNI crate is missing Cargo.toml at '...'` → point `aethercore.jni.dir` at the crate root.
- `Missing ATAK SDK artifacts in '.../libs': ...` → copy `main.jar` (and any configured `atak.required.artifacts`) into `libs/`.
- Java/Kotlin compatibility errors during sync/compile (class file target mismatch) → confirm Android Studio/Gradle is running on JDK 17.

> Note: this module currently does **not** ship a committed Gradle wrapper. To reduce environment drift, use the AGP/Kotlin/Gradle versions above when importing into an existing Android workspace.

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
