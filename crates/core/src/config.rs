//! Configuration management for Fourmik.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub network: NetworkConfig,
    pub radio: RadioConfig,
    pub edge: EdgeConfig,
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

impl Config {
    #[cfg(feature = "toml")]
    pub fn from_file<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let config = toml::from_str(&content)?;
        Ok(config)
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
        }
    }
}
