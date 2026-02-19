//! Configuration Management Module
//!
//! Implements secure configuration management per Fail-Visible doctrine.
//! Configuration is stored in the user's app data directory and never
//! hardcoded in the application binary.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

pub const CONFIG_SCHEMA_VERSION: u32 = 3;
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
pub enum ConnectionProfile {
    #[serde(rename = "commander-local", alias = "local_control_plane")]
    CommanderLocal,
    #[serde(rename = "training-testnet", alias = "testnet")]
    TrainingTestnet,
    #[serde(rename = "enterprise-remote", alias = "production_mesh")]
    EnterpriseRemote,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProductProfile {
    CommanderEdition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConnection {
    #[serde(alias = "api_url")]
    pub api_endpoint: String,
    pub mesh_endpoint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimePorts {
    #[serde(default = "default_api_port")]
    pub api: u16,
    #[serde(default = "default_mesh_port")]
    pub mesh: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeTpmPolicy {
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
    #[serde(default = "default_product_profile")]
    pub product_profile: ProductProfile,
    #[serde(default = "default_profile")]
    pub profile: ConnectionProfile,
    pub connection: RuntimeConnection,
    #[serde(default, alias = "tpm")]
    pub tpm_policy: RuntimeTpmPolicy,
    #[serde(default)]
    pub ports: RuntimePorts,
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

fn default_product_profile() -> ProductProfile {
    ProductProfile::CommanderEdition
}

fn default_profile() -> ConnectionProfile {
    ConnectionProfile::CommanderLocal
}

fn default_api_port() -> u16 {
    3000
}

fn default_mesh_port() -> u16 {
    8080
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

impl Default for RuntimePorts {
    fn default() -> Self {
        Self {
            api: default_api_port(),
            mesh: default_mesh_port(),
        }
    }
}

impl Default for RuntimeTpmPolicy {
    fn default() -> Self {
        Self {
            mode: "optional".to_string(),
            enforce_hardware: false,
        }
    }
}

impl AppConfig {
    pub fn commander_local() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            product_profile: ProductProfile::CommanderEdition,
            profile: ConnectionProfile::CommanderLocal,
            connection: RuntimeConnection {
                api_endpoint: "http://127.0.0.1:3000".to_string(),
                mesh_endpoint: "ws://127.0.0.1:8080".to_string(),
            },
            tpm_policy: RuntimeTpmPolicy::default(),
            ports: RuntimePorts::default(),
            features: RuntimeFeatureFlags {
                allow_insecure_localhost: true,
                bootstrap_on_startup: true,
            },
            connection_retry: RetryConfig::default(),
        }
    }

    pub fn training_testnet() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            product_profile: ProductProfile::CommanderEdition,
            profile: ConnectionProfile::TrainingTestnet,
            connection: RuntimeConnection {
                api_endpoint: "https://api.testnet.aethercore.example".to_string(),
                mesh_endpoint: "wss://mesh.testnet.aethercore.example/c2".to_string(),
            },
            tpm_policy: RuntimeTpmPolicy {
                mode: "optional".to_string(),
                enforce_hardware: false,
            },
            ports: RuntimePorts {
                api: 443,
                mesh: 443,
            },
            features: RuntimeFeatureFlags {
                allow_insecure_localhost: false,
                bootstrap_on_startup: false,
            },
            connection_retry: RetryConfig::default(),
        }
    }

    pub fn enterprise_remote() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            product_profile: ProductProfile::CommanderEdition,
            profile: ConnectionProfile::EnterpriseRemote,
            connection: RuntimeConnection {
                api_endpoint: "https://api.aethercore.example".to_string(),
                mesh_endpoint: "wss://mesh.aethercore.example/c2".to_string(),
            },
            tpm_policy: RuntimeTpmPolicy {
                mode: "required".to_string(),
                enforce_hardware: true,
            },
            ports: RuntimePorts {
                api: 443,
                mesh: 443,
            },
            features: RuntimeFeatureFlags {
                allow_insecure_localhost: false,
                bootstrap_on_startup: false,
            },
            connection_retry: RetryConfig::default(),
        }
    }

    // Backward-compatible constructors
    pub fn local_control_plane() -> Self {
        Self::commander_local()
    }
    pub fn testnet() -> Self {
        Self::training_testnet()
    }
    pub fn production_mesh() -> Self {
        Self::enterprise_remote()
    }

    pub fn profile_defaults(profile: ConnectionProfile) -> Self {
        match profile {
            ConnectionProfile::CommanderLocal => Self::commander_local(),
            ConnectionProfile::TrainingTestnet => Self::training_testnet(),
            ConnectionProfile::EnterpriseRemote => Self::enterprise_remote(),
        }
    }

    pub fn with_runtime_overrides(mut self) -> Self {
        if let Ok(api_url) = std::env::var("VITE_API_URL") {
            if !api_url.trim().is_empty() {
                self.connection.api_endpoint = api_url;
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
            self.tpm_policy.enforce_hardware = enabled;
            self.tpm_policy.mode = if enabled {
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

        if let Ok(port) = std::env::var("VITE_API_PORT") {
            if let Ok(parsed) = port.parse::<u16>() {
                self.ports.api = parsed;
            }
        }

        if let Ok(port) = std::env::var("VITE_MESH_PORT") {
            if let Ok(parsed) = port.parse::<u16>() {
                self.ports.mesh = parsed;
            }
        }

        self
    }

    pub fn migrate_legacy(mut self) -> Self {
        if self.schema_version < CONFIG_SCHEMA_VERSION {
            self.schema_version = CONFIG_SCHEMA_VERSION;
        }

        if self.connection.api_endpoint.trim().is_empty() {
            self.connection.api_endpoint = AppConfig::commander_local().connection.api_endpoint;
        }

        if self.connection.mesh_endpoint.trim().is_empty() {
            self.connection.mesh_endpoint = AppConfig::commander_local().connection.mesh_endpoint;
        }

        if self.ports.api == 0 {
            self.ports.api = url::Url::parse(&self.connection.api_endpoint)
                .ok()
                .and_then(|url| url.port_or_known_default())
                .unwrap_or(default_api_port());
        }

        if self.ports.mesh == 0 {
            self.ports.mesh = url::Url::parse(&self.connection.mesh_endpoint)
                .ok()
                .and_then(|url| url.port_or_known_default())
                .unwrap_or(default_mesh_port());
        }

        self
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig::commander_local().with_runtime_overrides()
    }
}

impl From<LegacyConfig> for AppConfig {
    fn from(legacy: LegacyConfig) -> Self {
        if let Some(testnet) = legacy.testnet_endpoint {
            let mut config = AppConfig::training_testnet();
            config.connection.mesh_endpoint = testnet;
            config.tpm_policy.enforce_hardware = legacy.enforce_tpm;
            config.tpm_policy.mode = if legacy.enforce_tpm {
                "required".to_string()
            } else {
                "optional".to_string()
            };
            config.connection_retry = legacy.connection_retry;
            return config.migrate_legacy();
        }

        if let Some(mesh) = legacy.mesh_endpoint {
            let profile = if mesh.starts_with("wss://") {
                ConnectionProfile::EnterpriseRemote
            } else {
                ConnectionProfile::CommanderLocal
            };

            let mut config = AppConfig::profile_defaults(profile);
            config.connection.mesh_endpoint = mesh;
            config.tpm_policy.enforce_hardware = legacy.enforce_tpm;
            config.tpm_policy.mode = if legacy.enforce_tpm {
                "required".to_string()
            } else {
                "optional".to_string()
            };
            config.connection_retry = legacy.connection_retry;
            return config.migrate_legacy();
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
            let parsed: AppConfig = serde_json::from_str(&contents)?;
            let config = parsed.migrate_legacy();
            self.validate(&config)?;
            if config.schema_version != parsed.schema_version {
                self.save(&config)?;
            }
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
        let migrated = config.clone().migrate_legacy();
        self.validate(&migrated)?;
        let contents = serde_json::to_string_pretty(&migrated)?;
        std::fs::write(&self.config_path, contents)
            .map_err(|e| ConfigError::WriteError(e.to_string()))?;
        Ok(())
    }

    fn validate(&self, config: &AppConfig) -> Result<(), ConfigError> {
        if config.schema_version > CONFIG_SCHEMA_VERSION {
            return Err(ConfigError::ValidationError(format!(
                "Unsupported future schema version {} (max {})",
                config.schema_version, CONFIG_SCHEMA_VERSION
            )));
        }

        let api = url::Url::parse(&config.connection.api_endpoint).map_err(|e| {
            ConfigError::ValidationError(format!("Invalid connection.api_endpoint: {}", e))
        })?;

        if api.scheme() != "http" && api.scheme() != "https" {
            return Err(ConfigError::ValidationError(
                "connection.api_endpoint must use http:// or https:// protocol".to_string(),
            ));
        }

        let mesh = url::Url::parse(&config.connection.mesh_endpoint)
            .map_err(|e| ConfigError::ValidationError(format!("Invalid mesh_endpoint: {}", e)))?;

        if mesh.scheme() != "ws" && mesh.scheme() != "wss" {
            return Err(ConfigError::ValidationError(
                "mesh_endpoint must use ws:// or wss:// protocol".to_string(),
            ));
        }

        if config.profile == ConnectionProfile::EnterpriseRemote && mesh.scheme() != "wss" {
            return Err(ConfigError::ValidationError(
                "enterprise-remote profile requires wss:// mesh endpoint".to_string(),
            ));
        }

        let api_port = api.port_or_known_default().unwrap_or(config.ports.api);
        if api_port != config.ports.api {
            return Err(ConfigError::ValidationError(format!(
                "ports.api ({}) does not match api endpoint port ({})",
                config.ports.api, api_port
            )));
        }

        let mesh_port = mesh.port_or_known_default().unwrap_or(config.ports.mesh);
        if mesh_port != config.ports.mesh {
            return Err(ConfigError::ValidationError(format!(
                "ports.mesh ({}) does not match mesh endpoint port ({})",
                config.ports.mesh, mesh_port
            )));
        }

        let mode = config.tpm_policy.mode.to_ascii_lowercase();
        if mode != "required" && mode != "optional" && mode != "disabled" {
            return Err(ConfigError::ValidationError(
                "tpm_policy.mode must be one of: required, optional, disabled".to_string(),
            ));
        }

        if config.tpm_policy.enforce_hardware && mode == "disabled" {
            return Err(ConfigError::ValidationError(
                "tpm_policy.enforce_hardware cannot be true when mode is disabled".to_string(),
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
    Ok(config.migrate_legacy())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config_profile() {
        let config = AppConfig::default();
        assert_eq!(config.schema_version, CONFIG_SCHEMA_VERSION);
        assert_eq!(config.profile, ConnectionProfile::CommanderLocal);
        assert!(config.connection.api_endpoint.starts_with("http"));
        assert_eq!(config.ports.api, 3000);
        assert_eq!(config.ports.mesh, 8080);
    }

    #[test]
    fn test_profile_defaults() {
        let testnet = AppConfig::training_testnet();
        assert_eq!(testnet.profile, ConnectionProfile::TrainingTestnet);
        assert!(testnet.connection.mesh_endpoint.starts_with("wss://"));

        let enterprise = AppConfig::enterprise_remote();
        assert_eq!(enterprise.profile, ConnectionProfile::EnterpriseRemote);
        assert!(enterprise.tpm_policy.enforce_hardware);
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
        assert_eq!(migrated.profile, ConnectionProfile::EnterpriseRemote);
        assert_eq!(
            migrated.connection.mesh_endpoint,
            "wss://mesh.legacy.example/c2"
        );
        assert_eq!(migrated.schema_version, CONFIG_SCHEMA_VERSION);
    }
}
