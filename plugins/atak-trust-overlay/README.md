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
