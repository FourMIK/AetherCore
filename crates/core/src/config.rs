//! Configuration management for Fourmik.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub network: NetworkConfig,
    pub radio: RadioConfig,
    pub edge: EdgeConfig,
    #[serde(default)]
    pub backend: BackendConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
    #[serde(default)]
    pub storage: StorageConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    pub node_id: String,
    pub mesh_id: String,
    pub max_hops: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadioConfig {
    pub frequency: f64,
    pub power: u8,
    pub bandwidth: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeConfig {
    pub enabled: bool,
    pub processing_threads: usize,
}

/// Backend configuration for AetherBunker connectivity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendConfig {
    /// AetherBunker backend endpoint URL
    pub endpoint: String,
}

/// Logging configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    /// Log level (error, warn, info, debug, trace)
    pub level: String,
    /// Enable JSON output format
    pub json_output: bool,
}

/// Storage configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    /// Path to the event ledger database
    pub ledger_path: PathBuf,
    /// Path to the trust mesh database
    pub trust_mesh_path: PathBuf,
}

impl Default for BackendConfig {
    fn default() -> Self {
        Self {
            endpoint: std::env::var("AETHER_BUNKER_ENDPOINT")
                .unwrap_or_else(|_| get_default_bunker_endpoint()),
        }
    }
}

/// Detect if running in a container environment
fn is_running_in_container() -> bool {
    // Check for explicit environment variables
    let running_in_container = std::env::var("RUNNING_IN_CONTAINER")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    let container_var = std::env::var("CONTAINER")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    
    // Check for Docker marker file
    let dockerenv_exists = std::path::Path::new("/.dockerenv").exists();
    
    running_in_container || container_var || dockerenv_exists
}

/// Get default bunker endpoint based on environment
fn get_default_bunker_endpoint() -> String {
    // In containerized environments, default to service DNS name
    // Outside containers, use localhost for local development
    if is_running_in_container() {
        "c2-router:50051".to_string()
    } else {
        "localhost:50051".to_string()
    }
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()),
            json_output: std::env::var("AETHER_LOG_JSON")
                .map(|v| v == "1" || v.to_lowercase() == "true")
                .unwrap_or(false),
        }
    }
}

impl Default for StorageConfig {
    fn default() -> Self {
        let base_path = std::env::var("AETHER_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                let mut path = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
                path.push("data");
                path
            });

        Self {
            ledger_path: base_path.join("ledger.db"),
            trust_mesh_path: base_path.join("trust_mesh.db"),
        }
    }
}

impl Config {
    /// Load configuration from a TOML file with environment variable overrides.
    ///
    /// Note: This function is explicitly named to indicate the expected format.
    /// The `load_with_defaults` function provides automatic format detection
    /// based on file extension.
    ///
    /// Environment variables take precedence over file configuration:
    /// - AETHER_BUNKER_ENDPOINT: Backend endpoint
    /// - RUST_LOG: Log level
    /// - AETHER_LOG_JSON: JSON log output (1/true)
    /// - AETHER_DATA_DIR: Base directory for data files
    #[cfg(feature = "toml")]
    pub fn from_toml_file<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let mut config: Config = toml::from_str(&content)?;

        // Apply environment variable overrides
        config.apply_env_overrides();

        Ok(config)
    }

    /// Load configuration from a JSON file with environment variable overrides.
    ///
    /// Note: This function is explicitly named to indicate the expected format.
    /// The `load_with_defaults` function provides automatic format detection
    /// based on file extension.
    ///
    /// Environment variables take precedence over file configuration.
    pub fn from_json_file<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let mut config: Config = serde_json::from_str(&content)?;

        // Apply environment variable overrides
        config.apply_env_overrides();

        Ok(config)
    }

    /// Load configuration with hierarchical priority:
    /// 1. Environment variables (highest)
    /// 2. Config file (if exists)
    /// 3. Defaults (lowest)
    ///
    /// Supports both TOML and JSON config files.
    pub fn load_with_defaults<P: AsRef<Path>>(path: Option<P>) -> Self {
        if let Some(p) = path {
            let path_ref = p.as_ref();
            if path_ref.exists() {
                // Try JSON first if extension is .json
                if path_ref.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(config) = Self::from_json_file(path_ref) {
                        return config;
                    }
                }

                // Try TOML
                #[cfg(feature = "toml")]
                if let Ok(config) = Self::from_toml_file(path_ref) {
                    return config;
                }
            }
        }

        let mut config = Self::default_config();
        config.apply_env_overrides();
        config
    }

    /// Apply environment variable overrides to this configuration
    fn apply_env_overrides(&mut self) {
        // Backend endpoint
        if let Ok(endpoint) = std::env::var("AETHER_BUNKER_ENDPOINT") {
            self.backend.endpoint = endpoint;
        }

        // Logging level
        if let Ok(level) = std::env::var("RUST_LOG") {
            self.logging.level = level;
        }

        // JSON output
        if let Ok(json) = std::env::var("AETHER_LOG_JSON") {
            self.logging.json_output = json == "1" || json.to_lowercase() == "true";
        }

        // Data directory (updates paths)
        if let Ok(data_dir) = std::env::var("AETHER_DATA_DIR") {
            let base = PathBuf::from(data_dir);
            self.storage.ledger_path = base.join("ledger.db");
            self.storage.trust_mesh_path = base.join("trust_mesh.db");
        }
    }

    pub fn default_config() -> Self {
        Self {
            network: NetworkConfig {
                node_id: std::env::var("AETHER_NODE_ID").unwrap_or_else(|_| "node-001".to_string()),
                mesh_id: std::env::var("AETHER_MESH_ID").unwrap_or_else(|_| "mesh-001".to_string()),
                max_hops: 10,
            },
            radio: RadioConfig {
                frequency: 915.0,
                power: 20,
                bandwidth: 125000,
            },
            edge: EdgeConfig {
                enabled: true,
                processing_threads: 4,
            },
            backend: BackendConfig::default(),
            logging: LoggingConfig::default(),
            storage: StorageConfig::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_backend_config() {
        let config = BackendConfig::default();
        // Should have a default value
        assert!(!config.endpoint.is_empty());
    }

    #[test]
    fn test_default_logging_config() {
        let config = LoggingConfig::default();
        assert!(!config.level.is_empty());
    }

    #[test]
    fn test_default_storage_config() {
        let config = StorageConfig::default();
        assert!(config.ledger_path.to_string_lossy().contains("ledger.db"));
        assert!(config
            .trust_mesh_path
            .to_string_lossy()
            .contains("trust_mesh.db"));
    }

    #[test]
    fn test_default_config() {
        // Clear environment variables that affect defaults
        std::env::remove_var("AETHER_NODE_ID");
        std::env::remove_var("AETHER_MESH_ID");

        let config = Config::default_config();
        assert_eq!(config.network.node_id, "node-001");
        assert_eq!(config.network.mesh_id, "mesh-001");
        assert!(!config.backend.endpoint.is_empty());
        assert!(!config.logging.level.is_empty());
    }

    #[test]
    fn test_json_config_deserialization() {
        let json = r#"{
            "network": {
                "node_id": "test-node",
                "mesh_id": "test-mesh",
                "max_hops": 5
            },
            "radio": {
                "frequency": 915.0,
                "power": 20,
                "bandwidth": 125000
            },
            "edge": {
                "enabled": true,
                "processing_threads": 4
            },
            "backend": {
                "endpoint": "test:50051"
            },
            "logging": {
                "level": "debug",
                "json_output": true
            },
            "storage": {
                "ledger_path": "/tmp/test_ledger.db",
                "trust_mesh_path": "/tmp/test_trust.db"
            }
        }"#;

        let config: Config = serde_json::from_str(json).unwrap();
        assert_eq!(config.network.node_id, "test-node");
        assert_eq!(config.logging.level, "debug");
        assert!(config.logging.json_output);
        assert_eq!(
            config.storage.ledger_path,
            PathBuf::from("/tmp/test_ledger.db")
        );
    }
}
