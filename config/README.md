# Configuration File Format

AetherCore supports both JSON and TOML configuration files with hierarchical priority:

1. **Environment Variables** (highest priority)
2. **Configuration File** (config.json or config.toml)
3. **Default Values** (lowest priority)

## Example Configuration

See `config.json` for a complete example.

## Environment Variables

- `AETHER_BUNKER_ENDPOINT`: Backend endpoint URL (default: `localhost:50051`)
- `RUST_LOG`: Log level (default: `info`)
  - Possible values: `error`, `warn`, `info`, `debug`, `trace`
- `AETHER_LOG_JSON`: Enable JSON log output (`1` or `true`)
- `AETHER_DATA_DIR`: Base directory for data files (default: `./data`)
- `AETHER_NODE_ID`: Node identifier (default: `node-001`)
- `AETHER_MESH_ID`: Mesh identifier (default: `mesh-001`)

## Usage

```rust
use aethercore_core::Config;

// Load with defaults
let config = Config::load_with_defaults(None);

// Load from specific file
let config = Config::load_with_defaults(Some("config.json"));

// Environment variables override file settings
std::env::set_var("RUST_LOG", "debug");
let config = Config::load_with_defaults(Some("config.json"));
assert_eq!(config.logging.level, "debug");
```

## JSON Format

```json
{
  "network": {
    "node_id": "node-001",
    "mesh_id": "mesh-001",
    "max_hops": 10
  },
  "logging": {
    "level": "info",
    "json_output": false
  },
  "storage": {
    "ledger_path": "data/ledger.db",
    "trust_mesh_path": "data/trust_mesh.db"
  }
}
```

## TOML Format

```toml
[network]
node_id = "node-001"
mesh_id = "mesh-001"
max_hops = 10

[logging]
level = "info"
json_output = false

[storage]
ledger_path = "data/ledger.db"
trust_mesh_path = "data/trust_mesh.db"
```
