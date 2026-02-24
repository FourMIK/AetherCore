# Local Control Plane (Canonical Desktop Mode)

This document defines the **canonical desktop runtime path** for Tactical Glass.

## Mode taxonomy (authoritative)

### 1) Desktop local mode (**default for desktop operators**)
- Tactical Glass desktop app starts local dependencies before UI readiness.
- Source of truth manifest: `config/local-control-plane.toml`.
- Startup is ordered and health-gated.
- Intended for operator laptops/workstations running mission UI and local services together.

### 2) Cloud/internal mode
- Tactical Glass connects to pre-existing remote/internal services.
- Local dependency bootstrap is skipped.
- Select by setting `AETHERCORE_MODE` to a non-`desktop-local` value.

### 3) Dev-only compose mode
- Uses `infra/docker/docker-compose.yml` for developer integration environments.
- Not the default desktop operator path.
- Intended for development and CI smoke workflows, not field desktop operation.

## Desktop local mode startup contract

On launch, Tactical Glass:
1. Loads `config/local-control-plane.toml`.
2. Sorts services by `startup_order`.
3. For each required service:
   - checks `health_endpoint`,
   - starts service by invoking `start_executable` + `start_args` in `working_dir` if needed,
   - blocks until healthy or timeout.
4. Fails visible and exits if a required service does not become healthy.

## Manifest schema

`config/local-control-plane.toml` fields:

- Top-level:
  - `mode` (string)
  - `version` (integer)
- `[startup]`
  - `health_poll_interval_ms`
  - `service_start_grace_period_ms`
  - `service_health_timeout_secs`
- `[[services]]`
  - `name`
  - `startup_order`
  - `required`
  - `port`
  - `health_endpoint`
  - `working_dir`
  - `start_executable`
  - `start_args`

## Deprecation notice

Any prior desktop docs that implied parallel, equivalent startup paths are superseded by this document.

- **Default desktop path**: Local Control Plane mode.
- **Cloud/internal path**: explicit scope only.
- **Dev compose path**: explicit dev-only scope only.
