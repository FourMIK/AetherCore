//! Unified Error Handling Module
//!
//! Consolidates all application errors with clear, descriptive messages
//! per the Fail-Visible doctrine. All errors are logged and provide
//! actionable information for remediation.

use thiserror::Error;

/// Unified Application Error
///
/// All Tauri commands must return Result<T, AppError> to ensure
/// consistent error handling and proper error propagation to the frontend.
#[derive(Error, Debug)]
pub enum AppError {
    /// Configuration-related errors
    #[error("Configuration error: {0}")]
    Config(#[from] crate::config::ConfigError),

    /// Command validation errors
    #[error("Invalid command input: {0}")]
    Validation(String),

    /// WebSocket/Connection errors
    #[error("Connection error: {0}")]
    Connection(String),

    /// TPM/Hardware errors
    #[error("Hardware security error: {0}")]
    Hardware(String),

    /// Identity/Cryptography errors
    #[error("Cryptographic operation failed: {0}")]
    Crypto(String),

    /// Stream integrity errors
    #[error("Stream integrity violation: {0}")]
    StreamIntegrity(String),

    /// Process management errors
    #[error("Process management error: {0}")]
    Process(String),

    /// Provisioning errors
    #[error("Provisioning error: {0}")]
    Provisioning(String),

    /// Generic I/O errors
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// JSON serialization errors
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// URL parsing errors
    #[error("Invalid URL: {0}")]
    UrlParse(#[from] url::ParseError),

    /// Generic error for backward compatibility
    #[error("Application error: {0}")]
    Generic(String),
}

/// Result type alias for application operations
pub type Result<T> = std::result::Result<T, AppError>;

/// Convert AppError to String for Tauri command responses
///
/// This implementation ensures that errors are properly serialized
/// and sent to the frontend with descriptive messages.
impl From<AppError> for String {
    fn from(error: AppError) -> Self {
        error.to_string()
    }
}

/// Convert anyhow::Error to AppError
impl From<anyhow::Error> for AppError {
    fn from(error: anyhow::Error) -> Self {
        AppError::Generic(error.to_string())
    }
}

/// Convert base64 decode errors
impl From<base64::DecodeError> for AppError {
    fn from(error: base64::DecodeError) -> Self {
        AppError::Crypto(format!("Base64 decode error: {}", error))
    }
}

/// Convert ed25519 signature errors
impl From<ed25519_dalek::SignatureError> for AppError {
    fn from(error: ed25519_dalek::SignatureError) -> Self {
        AppError::Crypto(format!("Signature verification failed: {}", error))
    }
}

/// Validation helper functions
pub mod validation {
    use super::AppError;

    /// Validate a non-empty string
    pub fn require_non_empty(value: &str, field: &str) -> Result<(), AppError> {
        if value.trim().is_empty() {
            return Err(AppError::Validation(format!("{} cannot be empty", field)));
        }
        Ok(())
    }

    /// Validate a WebSocket URL (ws:// or wss://)
    pub fn validate_ws_url(url: &str, require_secure: bool) -> Result<(), AppError> {
        if !url.starts_with("ws://") && !url.starts_with("wss://") {
            return Err(AppError::Validation(
                "URL must start with ws:// or wss://".to_string(),
            ));
        }

        if require_secure && !url.starts_with("wss://") {
            return Err(AppError::Validation(
                "Production mode requires secure WebSocket (wss://)".to_string(),
            ));
        }

        // Parse URL to ensure it's well-formed
        url::Url::parse(url)
            .map_err(|e| AppError::Validation(format!("Invalid WebSocket URL format: {}", e)))?;

        Ok(())
    }

    /// Validate string length
    pub fn validate_length(
        value: &str,
        field: &str,
        min: usize,
        max: usize,
    ) -> Result<(), AppError> {
        let len = value.len();
        if len < min || len > max {
            return Err(AppError::Validation(format!(
                "{} length must be between {} and {} characters (got {})",
                field, min, max, len
            )));
        }
        Ok(())
    }

    /// Validate alphanumeric string with hyphens and underscores
    pub fn validate_alphanumeric(value: &str, field: &str) -> Result<(), AppError> {
        if !value
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
        {
            return Err(AppError::Validation(format!(
                "{} must contain only alphanumeric characters, hyphens, and underscores",
                field
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = AppError::Validation("test error".to_string());
        assert_eq!(err.to_string(), "Invalid command input: test error");
    }

    #[test]
    fn test_validation_non_empty() {
        assert!(validation::require_non_empty("test", "field").is_ok());
        assert!(validation::require_non_empty("", "field").is_err());
        assert!(validation::require_non_empty("   ", "field").is_err());
    }

    #[test]
    fn test_validation_ws_url() {
        assert!(validation::validate_ws_url("wss://example.com", true).is_ok());
        assert!(validation::validate_ws_url("ws://example.com", false).is_ok());
        assert!(validation::validate_ws_url("ws://example.com", true).is_err());
        assert!(validation::validate_ws_url("https://example.com", false).is_err());
    }

    #[test]
    fn test_validation_length() {
        assert!(validation::validate_length("test", "field", 1, 10).is_ok());
        assert!(validation::validate_length("", "field", 1, 10).is_err());
        assert!(validation::validate_length("too long string", "field", 1, 10).is_err());
    }

    #[test]
    fn test_validation_alphanumeric() {
        assert!(validation::validate_alphanumeric("test-123_ABC", "field").is_ok());
        assert!(validation::validate_alphanumeric("test@123", "field").is_err());
        assert!(validation::validate_alphanumeric("test 123", "field").is_err());
    }
}
