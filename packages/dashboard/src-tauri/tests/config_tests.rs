//! Configuration Management Integration Tests

use tactical_glass_lib::config::{
    AppConfig, ConnectionProfile, ProductProfile, RetryConfig, CONFIG_SCHEMA_VERSION,
};

#[test]
fn test_default_config() {
    let config = AppConfig::default();

    assert_eq!(config.schema_version, CONFIG_SCHEMA_VERSION);
    assert_eq!(config.product_profile, ProductProfile::CommanderEdition);
    assert_eq!(config.profile, ConnectionProfile::CommanderLocal);
    assert!(!config.connection.api_endpoint.is_empty());
    assert!(!config.connection.mesh_endpoint.is_empty());
    assert_eq!(config.connection_retry.max_retries, 10);
}

#[test]
fn test_config_serialization() {
    let config = AppConfig::production_mesh();
    let json = serde_json::to_string_pretty(&config).unwrap();
    let deserialized: AppConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.schema_version, CONFIG_SCHEMA_VERSION);
    assert_eq!(
        deserialized.product_profile,
        ProductProfile::CommanderEdition
    );
    assert_eq!(deserialized.profile, ConnectionProfile::EnterpriseRemote);
    assert!(deserialized.connection.mesh_endpoint.starts_with("wss://"));
}

#[test]
fn test_retry_config_serialization() {
    let retry_config = RetryConfig {
        max_retries: 5,
        initial_delay_ms: 2000,
        max_delay_ms: 60000,
    };

    let json = serde_json::to_string(&retry_config).unwrap();
    let deserialized: RetryConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(retry_config.max_retries, deserialized.max_retries);
    assert_eq!(retry_config.initial_delay_ms, deserialized.initial_delay_ms);
    assert_eq!(retry_config.max_delay_ms, deserialized.max_delay_ms);
}
