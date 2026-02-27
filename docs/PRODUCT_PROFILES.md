# Product Profiles

## Commander Edition (Default)

`Commander Edition` is the supported operator profile for Tactical Glass desktop deployments.

- First launch always enters guided bootstrap.
- Endpoint and local stack defaults are auto-applied.
- Target outcome: first deployment completes without terminal usage.

### Runtime Config Contract

Unified runtime config includes:

```json
{
  "product_profile": "commander_edition",
  "profile": "local_control_plane",
  "features": {
    "bootstrap_on_startup": true
  }
}
```

## Appendix A: Advanced/Engineering Paths

These are non-default and intended for engineering teams only:

- `cloud-internal` flows
- `dev-compose` flows
- CI/CD and source-build workflows
