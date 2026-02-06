//! Configuration Management Integration Tests
//!
//! Tests for the secure configuration system.

use tactical_glass_lib::config::{AppConfig, RetryConfig};
use tactical_glass_lib::error::validation;

#[test]
fn test_default_config() {
    let config = AppConfig::default();
    
    assert!(config.mesh_endpoint.is_none());
    assert!(config.testnet_endpoint.is_none());
    assert!(config.enforce_tpm);
    assert_eq!(config.connection_retry.max_retries, 10);
    assert_eq!(config.connection_retry.initial_delay_ms, 1000);
    assert_eq!(config.connection_retry.max_delay_ms, 30000);
}

#[test]
fn test_config_serialization() {
    let config = AppConfig {
        mesh_endpoint: Some("wss://mesh.example.com/c2".to_string()),
        testnet_endpoint: None,
        enforce_tpm: true,
        connection_retry: RetryConfig::default(),
    };

    // Serialize to JSON
    let json = serde_json::to_string_pretty(&config).unwrap();
    
    // Deserialize back
    let deserialized: AppConfig = serde_json::from_str(&json).unwrap();
    
    assert_eq!(
        config.mesh_endpoint.as_ref().unwrap(),
        deserialized.mesh_endpoint.as_ref().unwrap()
    );
    assert_eq!(config.enforce_tpm, deserialized.enforce_tpm);
    assert_eq!(
        config.connection_retry.max_retries,
        deserialized.connection_retry.max_retries
    );
}

#[test]
fn test_retry_config_defaults() {
    let retry_config = RetryConfig::default();
    
    assert_eq!(retry_config.max_retries, 10);
    assert_eq!(retry_config.initial_delay_ms, 1000);
    assert_eq!(retry_config.max_delay_ms, 30000);
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

#[test]
fn test_require_non_empty() {
    assert!(validation::require_non_empty("test", "field").is_ok());
    assert!(validation::require_non_empty("", "field").is_err());
    assert!(validation::require_non_empty("   ", "field").is_err());
}

#[test]
fn test_validate_ws_url_secure_mode() {
    // Valid secure URLs
    assert!(validation::validate_ws_url("wss://example.com", true).is_ok());
    assert!(validation::validate_ws_url("wss://mesh.example.com:8443/c2", true).is_ok());
    
    // Invalid for secure mode
    assert!(validation::validate_ws_url("ws://example.com", true).is_err());
}

#[test]
fn test_validate_ws_url_non_secure_mode() {
    // Valid for non-secure mode
    assert!(validation::validate_ws_url("ws://localhost:8080", false).is_ok());
    assert!(validation::validate_ws_url("wss://example.com", false).is_ok());
    
    // Invalid protocols
    assert!(validation::validate_ws_url("https://example.com", false).is_err());
    assert!(validation::validate_ws_url("http://example.com", false).is_err());
}

#[test]
fn test_validate_length() {
    assert!(validation::validate_length("test", "field", 1, 10).is_ok());
    assert!(validation::validate_length("", "field", 1, 10).is_err());
    assert!(validation::validate_length("toolongstring", "field", 1, 10).is_err());
    assert!(validation::validate_length("ok", "field", 2, 5).is_ok());
}

#[test]
fn test_validate_alphanumeric() {
    assert!(validation::validate_alphanumeric("test123", "field").is_ok());
    assert!(validation::validate_alphanumeric("test-123_ABC", "field").is_ok());
    assert!(validation::validate_alphanumeric("test@123", "field").is_err());
    assert!(validation::validate_alphanumeric("test 123", "field").is_err());
    assert!(validation::validate_alphanumeric("test!123", "field").is_err());
}
