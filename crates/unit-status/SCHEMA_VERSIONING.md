# Mesh Event Schema Versioning Strategy

This document defines compatibility expectations for the shared mesh event schema used by websocket feeds and TAK bridge emitters.

## Scope

Applies to payloads represented by:

- `type = "mesh_health"`
- `type = "revocation"`

and their fields as modeled in `src/schema.rs`.

## Compatibility Contract

- **Additive-only evolution for existing event types.**
  - Existing field names and meanings MUST remain stable.
  - Existing required fields (`node_id`, `status`, `trust_score`, `last_seen_ns`, `metrics` for mesh health) MUST NOT be removed or renamed.
  - New fields MAY be appended; consumers should ignore unknown fields.
- **No tag churn.**
  - Existing `type` discriminator values are stable and MUST NOT change.
- **Enum variant stability.**
  - Existing revocation reasons MUST remain available.
  - New reasons MAY be added only when consumers can treat unknown reasons safely.
- **Breaking changes require a new event type.**
  - If a change is not additive, introduce a new `type` value (or parallel payload) and keep legacy payload emission until migrations complete.

## Validation

- Serialization compatibility tests in `crates/tak-bridge/src/lib.rs` validate representative JSON fixtures for `mesh_health` and `revocation`.
- Any schema change should update fixture tests only when change is additive and intentional.
