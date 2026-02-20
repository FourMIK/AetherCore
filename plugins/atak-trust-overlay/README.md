# ATAK Trust Overlay Plugin Module

This module scaffolds a standalone Android ATAK plugin at `plugins/atak-trust-overlay/` with explicit entry points for:

1. CoT event subscription for trust CoT types.
2. Marker rendering and updates by trust level.
3. Marker tap detail-panel behavior.
4. Optional global widget for trust feed health.

## Entry points

- `TrustOverlayMapComponent`: ATAK lifecycle bridge that wires all plugin subsystems.
- `TrustCoTSubscriber`: subscribes to trust CoT events and normalizes to `TrustEvent`.
- `TrustMarkerRenderer`: translates trust level -> marker style/icon and updates map overlays.
- `TrustDetailPanelController`: shows detail panel when a trust marker is tapped.
- `TrustFeedHealthWidgetController`: (optional) global widget lifecycle and refresh loop.

## ATAK registration artifacts

- `src/main/AndroidManifest.xml`: plugin package metadata + map component registration.
- `src/main/assets/plugin.xml`: ATAK plugin descriptor with component binding.

## Notes

This scaffold is intentionally API-light and framework-agnostic so you can replace adapter interfaces in `atak/AtakContracts.kt` with your concrete ATAK SDK classes (`MapView`, `MapComponent`, CoT dispatch interfaces, widget APIs) used by your environment.
