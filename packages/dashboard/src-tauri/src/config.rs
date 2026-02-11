//! Configuration Management Module
//!
//! Implements secure configuration management per Fail-Visible doctrine.
//! Configuration is stored in the user's app data directory and never
//! hardcoded in the application binary.
//!
//! SECURITY POLICY:
//! - Configuration files are loaded from user data directory only
//! - Invalid configurations default to safe, non-functional states
//! - Frontend NEVER performs direct file I/O - all config operations via Tauri commands

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

/// Configuration errors
#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("Failed to locate app data directory")]
    AppDataDirNotFound,

    #[error("Failed to read configuration file: {0}")]
    ReadError(#[from] std::io::Error),

    #[error("Failed to parse configuration: {0}")]
    ParseError(#[from] serde_json::Error),

    #[error("Failed to write configuration: {0}")]
    WriteError(String),

    #[error("Invalid configuration: {0}")]
    ValidationError(String),
}

/// Application Configuration
///
/// This structure defines all user-configurable parameters.
/// Per the Fail-Visible doctrine, sensitive endpoints like mesh connections
/// are NEVER hardcoded and must be explicitly configured.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Production C2 mesh endpoint (WSS required)
    /// Default: None (must be explicitly configured)
    #[serde(default)]
    pub mesh_endpoint: Option<String>,

    /// Testnet endpoint (backward compatibility)
    /// DEPRECATED: Use mesh_endpoint for production
    #[serde(default)]
    pub testnet_endpoint: Option<String>,

    /// Enable TPM hardware enforcement
    /// When true, application will not start without valid TPM attestation
    #[serde(default = "default_tpm_enforcement")]
    pub enforce_tpm: bool,

    /// Connection retry configuration
    #[serde(default)]
    pub connection_retry: RetryConfig,
}

fn default_tpm_enforcement() -> bool {
    true // Always enforce TPM by default per security policy
}

/// Connection retry configuration for automatic reconnection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryConfig {
    /// Maximum number of retry attempts before giving up
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,

    /// Initial retry delay in milliseconds
    #[serde(default = "default_initial_delay")]
    pub initial_delay_ms: u64,

    /// Maximum retry delay in milliseconds (for exponential backoff)
    #[serde(default = "default_max_delay")]
    pub max_delay_ms: u64,
}

fn default_max_retries() -> u32 {
    10
}

fn default_initial_delay() -> u64 {
    1000
}

fn default_max_delay() -> u64 {
    30000
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: default_max_retries(),
            initial_delay_ms: default_initial_delay(),
            max_delay_ms: default_max_delay(),
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            mesh_endpoint: None,
            testnet_endpoint: None,
            enforce_tpm: default_tpm_enforcement(),
            connection_retry: RetryConfig::default(),
        }
    }
}

/// Configuration Manager
///
/// Handles loading and saving application configuration from/to the user's
/// app data directory. This ensures configuration is persistent and
/// user-specific.
pub struct ConfigManager {
    config_path: PathBuf,
}

impl ConfigManager {
    /// Create a new ConfigManager instance
    ///
    /// # Errors
    /// Returns ConfigError::AppDataDirNotFound if the app data directory cannot be determined
    pub fn new(app_handle: &tauri::AppHandle) -> Result<Self, ConfigError> {
        let config_dir = app_handle
            .path()
            .app_config_dir()
            .map_err(|_| ConfigError::AppDataDirNotFound)?;

        // Ensure config directory exists
        std::fs::create_dir_all(&config_dir)?;

        let config_path = config_dir.join("config.json");

        Ok(Self { config_path })
    }

    /// Load configuration from disk
    ///
    /// If the configuration file doesn't exist, returns default configuration.
    /// If the file exists but is invalid, returns an error.
    pub fn load(&self) -> Result<AppConfig, ConfigError> {
        if !self.config_path.exists() {
            log::info!(
                "Configuration file not found at {:?}, using defaults",
                self.config_path
            );
            return Ok(AppConfig::default());
        }

        let contents = std::fs::read_to_string(&self.config_path)?;
        let config: AppConfig = serde_json::from_str(&contents)?;

        log::info!("Configuration loaded from {:?}", self.config_path);
        Ok(config)
    }

    /// Save configuration to disk
    ///
    /// # Errors
    /// Returns ConfigError::WriteError if the file cannot be written
    pub fn save(&self, config: &AppConfig) -> Result<(), ConfigError> {
        // Validate configuration before saving
        self.validate(config)?;

        let contents = serde_json::to_string_pretty(config)?;
        std::fs::write(&self.config_path, contents)
            .map_err(|e| ConfigError::WriteError(e.to_string()))?;

        log::info!("Configuration saved to {:?}", self.config_path);
        Ok(())
    }

    /// Validate configuration per security policy
    ///
    /// # Errors
    /// Returns ConfigError::ValidationError if configuration violates security policy
    fn validate(&self, config: &AppConfig) -> Result<(), ConfigError> {
        // Validate mesh endpoint if provided
        if let Some(endpoint) = &config.mesh_endpoint {
            // Parse URL first to validate structure
            let url = url::Url::parse(endpoint).map_err(|e| {
                ConfigError::ValidationError(format!("Invalid mesh endpoint URL: {}", e))
            })?;

            // Check scheme is wss
            if url.scheme() != "wss" {
                return Err(ConfigError::ValidationError(
                    "Production mesh endpoint must use WSS (secure WebSocket) protocol".to_string(),
                ));
            }
        }

        // Validate testnet endpoint if provided
        if let Some(endpoint) = &config.testnet_endpoint {
            // Parse URL first to validate structure
            let url = url::Url::parse(endpoint).map_err(|e| {
                ConfigError::ValidationError(format!("Invalid testnet endpoint URL: {}", e))
            })?;

            // Check scheme is ws or wss
            if url.scheme() != "ws" && url.scheme() != "wss" {
                return Err(ConfigError::ValidationError(
                    "Testnet endpoint must use ws:// or wss:// protocol".to_string(),
                ));
            }
        }

        // Validate retry configuration
        if config.connection_retry.max_retries == 0 {
            return Err(ConfigError::ValidationError(
                "max_retries must be greater than 0".to_string(),
            ));
        }

        if config.connection_retry.initial_delay_ms == 0 {
            return Err(ConfigError::ValidationError(
                "initial_delay_ms must be greater than 0".to_string(),
            ));
        }

        if config.connection_retry.max_delay_ms < config.connection_retry.initial_delay_ms {
            return Err(ConfigError::ValidationError(
                "max_delay_ms must be greater than or equal to initial_delay_ms".to_string(),
            ));
        }

        Ok(())
    }

    /// Get the configuration file path
    pub fn get_config_path(&self) -> &PathBuf {
        &self.config_path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert!(config.mesh_endpoint.is_none());
        assert!(config.testnet_endpoint.is_none());
        assert!(config.enforce_tpm);
        assert_eq!(config.connection_retry.max_retries, 10);
    }

    #[test]
    fn test_config_serialization() {
        let config = AppConfig {
            mesh_endpoint: Some("wss://mesh.example.com/c2".to_string()),
            testnet_endpoint: None,
            enforce_tpm: true,
            connection_retry: RetryConfig::default(),
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: AppConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(
            config.mesh_endpoint.as_ref().unwrap(),
            deserialized.mesh_endpoint.as_ref().unwrap()
        );
        assert_eq!(config.enforce_tpm, deserialized.enforce_tpm);
    }
}
