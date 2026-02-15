//! Configuration Management Module
//!
//! Implements secure configuration management per Fail-Visible doctrine.
//! Configuration is stored in the user's app data directory and never
//! hardcoded in the application binary.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

pub const CONFIG_SCHEMA_VERSION: u32 = 2;
const LEGACY_CONFIG_FILE: &str = "config.json";
const RUNTIME_CONFIG_FILE: &str = "runtime-config.json";

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionProfile {
    LocalControlPlane,
    Testnet,
    ProductionMesh,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConnection {
    pub api_url: String,
    pub mesh_endpoint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeTpm {
    pub mode: String,
    pub enforce_hardware: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeFeatureFlags {
    pub allow_insecure_localhost: bool,
    pub bootstrap_on_startup: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryConfig {
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    #[serde(default = "default_initial_delay")]
    pub initial_delay_ms: u64,
    #[serde(default = "default_max_delay")]
    pub max_delay_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_profile")]
    pub profile: ConnectionProfile,
    pub connection: RuntimeConnection,
    pub tpm: RuntimeTpm,
    pub features: RuntimeFeatureFlags,
    #[serde(default)]
    pub connection_retry: RetryConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct LegacyConfig {
    #[serde(default)]
    mesh_endpoint: Option<String>,
    #[serde(default)]
    testnet_endpoint: Option<String>,
    #[serde(default = "default_tpm_enforcement")]
    enforce_tpm: bool,
    #[serde(default)]
    connection_retry: RetryConfig,
}

fn default_schema_version() -> u32 {
    CONFIG_SCHEMA_VERSION
}

fn default_profile() -> ConnectionProfile {
    ConnectionProfile::LocalControlPlane
}

fn default_tpm_enforcement() -> bool {
    true
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

impl AppConfig {
    pub fn local_control_plane() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            profile: ConnectionProfile::LocalControlPlane,
            connection: RuntimeConnection {
                api_url: "http://127.0.0.1:3000".to_string(),
                mesh_endpoint: "ws://127.0.0.1:8080".to_string(),
            },
            tpm: RuntimeTpm {
                mode: "optional".to_string(),
                enforce_hardware: false,
            },
            features: RuntimeFeatureFlags {
                allow_insecure_localhost: true,
                bootstrap_on_startup: true,
            },
            connection_retry: RetryConfig::default(),
        }
    }

    pub fn testnet() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            profile: ConnectionProfile::Testnet,
            connection: RuntimeConnection {
                api_url: "https://api.testnet.aethercore.example".to_string(),
                mesh_endpoint: "wss://mesh.testnet.aethercore.example/c2".to_string(),
            },
            tpm: RuntimeTpm {
                mode: "optional".to_string(),
                enforce_hardware: false,
            },
            features: RuntimeFeatureFlags {
                allow_insecure_localhost: false,
                bootstrap_on_startup: false,
            },
            connection_retry: RetryConfig::default(),
        }
    }

    pub fn production_mesh() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            profile: ConnectionProfile::ProductionMesh,
            connection: RuntimeConnection {
                api_url: "https://api.aethercore.example".to_string(),
                mesh_endpoint: "wss://mesh.aethercore.example/c2".to_string(),
            },
            tpm: RuntimeTpm {
                mode: "required".to_string(),
                enforce_hardware: true,
            },
            features: RuntimeFeatureFlags {
                allow_insecure_localhost: false,
                bootstrap_on_startup: false,
            },
            connection_retry: RetryConfig::default(),
        }
    }

    pub fn profile_defaults(profile: ConnectionProfile) -> Self {
        match profile {
            ConnectionProfile::LocalControlPlane => Self::local_control_plane(),
            ConnectionProfile::Testnet => Self::testnet(),
            ConnectionProfile::ProductionMesh => Self::production_mesh(),
        }
    }

    pub fn with_runtime_overrides(mut self) -> Self {
        if let Ok(api_url) = std::env::var("VITE_API_URL") {
            if !api_url.trim().is_empty() {
                self.connection.api_url = api_url;
            }
        }

        if let Ok(ws_url) = std::env::var("VITE_GATEWAY_URL") {
            if !ws_url.trim().is_empty() {
                self.connection.mesh_endpoint = ws_url;
            }
        }

        if let Ok(tpm_enabled) = std::env::var("VITE_TPM_ENABLED") {
            let lowered = tpm_enabled.to_ascii_lowercase();
            let enabled = matches!(lowered.as_str(), "1" | "true" | "yes" | "on");
            self.tpm.enforce_hardware = enabled;
            self.tpm.mode = if enabled {
                "required".to_string()
            } else {
                "optional".to_string()
            };
        }

        if let Ok(allow_insecure) = std::env::var("VITE_DEV_ALLOW_INSECURE_LOCALHOST") {
            let lowered = allow_insecure.to_ascii_lowercase();
            self.features.allow_insecure_localhost =
                matches!(lowered.as_str(), "1" | "true" | "yes" | "on");
        }

        self
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig::local_control_plane().with_runtime_overrides()
    }
}

impl From<LegacyConfig> for AppConfig {
    fn from(legacy: LegacyConfig) -> Self {
        if let Some(testnet) = legacy.testnet_endpoint {
            let mut config = AppConfig::testnet();
            config.connection.mesh_endpoint = testnet;
            config.tpm.enforce_hardware = legacy.enforce_tpm;
            config.tpm.mode = if legacy.enforce_tpm {
                "required".to_string()
            } else {
                "optional".to_string()
            };
            config.connection_retry = legacy.connection_retry;
            return config;
        }

        if let Some(mesh) = legacy.mesh_endpoint {
            let profile = if mesh.starts_with("wss://") {
                ConnectionProfile::ProductionMesh
            } else {
                ConnectionProfile::LocalControlPlane
            };

            let mut config = AppConfig::profile_defaults(profile);
            config.connection.mesh_endpoint = mesh;
            config.tpm.enforce_hardware = legacy.enforce_tpm;
            config.tpm.mode = if legacy.enforce_tpm {
                "required".to_string()
            } else {
                "optional".to_string()
            };
            config.connection_retry = legacy.connection_retry;
            return config;
        }

        AppConfig::default()
    }
}

pub struct ConfigManager {
    config_path: PathBuf,
    legacy_path: PathBuf,
}

impl ConfigManager {
    pub fn new(app_handle: &tauri::AppHandle) -> Result<Self, ConfigError> {
        let config_dir = app_handle
            .path()
            .app_config_dir()
            .map_err(|_| ConfigError::AppDataDirNotFound)?;

        std::fs::create_dir_all(&config_dir)?;

        Ok(Self {
            config_path: config_dir.join(RUNTIME_CONFIG_FILE),
            legacy_path: config_dir.join(LEGACY_CONFIG_FILE),
        })
    }

    pub fn load(&self) -> Result<AppConfig, ConfigError> {
        if self.config_path.exists() {
            let contents = std::fs::read_to_string(&self.config_path)?;
            let config: AppConfig = serde_json::from_str(&contents)?;
            self.validate(&config)?;
            return Ok(config);
        }

        if self.legacy_path.exists() {
            let contents = std::fs::read_to_string(&self.legacy_path)?;
            let legacy: LegacyConfig = serde_json::from_str(&contents)?;
            let migrated = AppConfig::from(legacy);
            self.validate(&migrated)?;
            self.save(&migrated)?;
            return Ok(migrated);
        }

        let default = AppConfig::default();
        self.save(&default)?;
        Ok(default)
    }

    pub fn save(&self, config: &AppConfig) -> Result<(), ConfigError> {
        self.validate(config)?;
        let contents = serde_json::to_string_pretty(config)?;
        std::fs::write(&self.config_path, contents)
            .map_err(|e| ConfigError::WriteError(e.to_string()))?;
        Ok(())
    }

    fn validate(&self, config: &AppConfig) -> Result<(), ConfigError> {
        if config.schema_version != CONFIG_SCHEMA_VERSION {
            return Err(ConfigError::ValidationError(format!(
                "Unsupported schema version {} (expected {})",
                config.schema_version, CONFIG_SCHEMA_VERSION
            )));
        }

        let api = url::Url::parse(&config.connection.api_url)
            .map_err(|e| ConfigError::ValidationError(format!("Invalid api_url: {}", e)))?;

        if api.scheme() != "http" && api.scheme() != "https" {
            return Err(ConfigError::ValidationError(
                "api_url must use http:// or https:// protocol".to_string(),
            ));
        }

        let mesh = url::Url::parse(&config.connection.mesh_endpoint)
            .map_err(|e| ConfigError::ValidationError(format!("Invalid mesh_endpoint: {}", e)))?;

        if mesh.scheme() != "ws" && mesh.scheme() != "wss" {
            return Err(ConfigError::ValidationError(
                "mesh_endpoint must use ws:// or wss:// protocol".to_string(),
            ));
        }

        if config.profile == ConnectionProfile::ProductionMesh && mesh.scheme() != "wss" {
            return Err(ConfigError::ValidationError(
                "Production profile requires wss:// mesh endpoint".to_string(),
            ));
        }

        let mode = config.tpm.mode.to_ascii_lowercase();
        if mode != "required" && mode != "optional" && mode != "disabled" {
            return Err(ConfigError::ValidationError(
                "tpm.mode must be one of: required, optional, disabled".to_string(),
            ));
        }

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

    pub fn get_config_path(&self) -> &PathBuf {
        &self.config_path
    }

    pub fn ensure_install_time_config(&self) -> Result<bool, ConfigError> {
        if self.config_path.exists() {
            return Ok(false);
        }

        let config = AppConfig::default();
        self.save(&config)?;
        Ok(true)
    }

    pub fn config_path_for_app(app_handle: &tauri::AppHandle) -> Result<PathBuf, ConfigError> {
        let config_dir = app_handle
            .path()
            .app_config_dir()
            .map_err(|_| ConfigError::AppDataDirNotFound)?;

        Ok(config_dir.join(RUNTIME_CONFIG_FILE))
    }

    pub fn legacy_path_for_app(app_handle: &tauri::AppHandle) -> Result<PathBuf, ConfigError> {
        let config_dir = app_handle
            .path()
            .app_config_dir()
            .map_err(|_| ConfigError::AppDataDirNotFound)?;

        Ok(config_dir.join(LEGACY_CONFIG_FILE))
    }
}

pub fn load_from_path(path: &Path) -> Result<AppConfig, ConfigError> {
    let contents = std::fs::read_to_string(path)?;
    let config: AppConfig = serde_json::from_str(&contents)?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config_profile() {
        let config = AppConfig::default();
        assert_eq!(config.schema_version, CONFIG_SCHEMA_VERSION);
        assert_eq!(config.profile, ConnectionProfile::LocalControlPlane);
        assert!(config.connection.api_url.starts_with("http"));
    }

    #[test]
    fn test_profile_defaults() {
        let testnet = AppConfig::testnet();
        assert_eq!(testnet.profile, ConnectionProfile::Testnet);
        assert!(testnet.connection.mesh_endpoint.starts_with("wss://"));

        let prod = AppConfig::production_mesh();
        assert_eq!(prod.profile, ConnectionProfile::ProductionMesh);
        assert!(prod.tpm.enforce_hardware);
    }

    #[test]
    fn test_legacy_migration() {
        let legacy = LegacyConfig {
            mesh_endpoint: Some("wss://mesh.legacy.example/c2".to_string()),
            testnet_endpoint: None,
            enforce_tpm: true,
            connection_retry: RetryConfig::default(),
        };

        let migrated = AppConfig::from(legacy);
        assert_eq!(migrated.profile, ConnectionProfile::ProductionMesh);
        assert_eq!(
            migrated.connection.mesh_endpoint,
            "wss://mesh.legacy.example/c2"
        );
        assert_eq!(migrated.schema_version, CONFIG_SCHEMA_VERSION);
    }
}
