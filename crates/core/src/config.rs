//! Configuration management for Fourmik.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub network: NetworkConfig,
    pub radio: RadioConfig,
    pub edge: EdgeConfig,
    #[serde(default)]
    pub backend: BackendConfig,
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

impl Default for BackendConfig {
    fn default() -> Self {
        Self {
            endpoint: std::env::var("AETHER_BUNKER_ENDPOINT")
                .unwrap_or_else(|_| "http://localhost:50051".to_string()),
        }
    }
}

impl Config {
    /// Load configuration from a file with environment variable overrides.
    ///
    /// The AETHER_BUNKER_ENDPOINT environment variable will override any
    /// file-based configuration for the backend endpoint.
    #[cfg(feature = "toml")]
    pub fn from_file<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let mut config: Config = toml::from_str(&content)?;
        
        // Override backend endpoint from environment if present
        if let Ok(endpoint) = std::env::var("AETHER_BUNKER_ENDPOINT") {
            config.backend.endpoint = endpoint;
        }
        
        Ok(config)
    }

    /// Load configuration with environment variable support and defaults.
    ///
    /// Attempts to load from file if path exists, otherwise returns default
    /// configuration with environment variable overrides applied.
    pub fn load_with_defaults<P: AsRef<Path>>(path: Option<P>) -> Self {
        if let Some(p) = path {
            if p.as_ref().exists() {
                #[cfg(feature = "toml")]
                if let Ok(config) = Self::from_file(p) {
                    return config;
                }
            }
        }
        
        Self::default_config()
    }

    pub fn default_config() -> Self {
        Self {
            network: NetworkConfig {
                node_id: "node-001".to_string(),
                mesh_id: "mesh-001".to_string(),
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
    fn test_default_config() {
        let config = Config::default_config();
        assert_eq!(config.network.node_id, "node-001");
        assert!(!config.backend.endpoint.is_empty());
    }
}
