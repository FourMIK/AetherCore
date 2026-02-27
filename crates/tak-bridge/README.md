# aethercore-tak-bridge

`aethercore-tak-bridge` maps internal trust mesh/unit-status models to signed TAK-oriented payloads, and then to a deterministic external transport contract.

## External payload integration contract

`src/transport.rs` exposes a stable JSON contract (`tak-bridge.external.v1`) for two event kinds:

- `node_snapshot`: mapped from `SignedTakPayload<TakNodeSnapshot>`
- `revocation`: mapped from `RevocationPayload`

Each external message includes:

- `envelope.key_id`
- `envelope.signature`
- `envelope.freshness.timestamp_ns`
- `envelope.freshness.timestamp_ms`

Trust/integrity labels are mapped into explicit external values:

- trust: `trusted | degraded | quarantined`
- integrity: `integrity_ok | integrity_degraded | integrity_compromised | integrity_unknown`

## Downstream integration points

The JSON payload is transport-agnostic and can be sent to:

1. **Plugin adapters** (e.g. ATAK/WinTAK plugin bridge)
2. **Socket outputs** (TCP/UDP/WebSocket stream)
3. **gRPC relays** that expose external schema to partner systems

Use `transport::to_external_json(...)` to generate deterministic output before publishing.

## Consumer example

See `crates/c2-router/examples/tak_bridge_publish.rs` for a minimal publisher that emits both event kinds to topic-like channels.
