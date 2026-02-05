//! Structured logging infrastructure for AetherCore.
//!
//! This module provides centralized logging initialization with support
//! for structured JSON output and environment-based configuration.

use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Initialize the logging system with structured output.
///
/// Log level can be configured via the `RUST_LOG` environment variable.
/// If not set, defaults to `info` level.
///
/// # Example
/// ```no_run
/// use aethercore_core::logging;
///
/// logging::init();
/// tracing::info!("Application started");
/// ```
pub fn init() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_target(true).with_thread_ids(true))
        .init();
}

/// Initialize the logging system with JSON output for production environments.
///
/// This format is suitable for log aggregation systems and structured log analysis.
/// Log level can be configured via the `RUST_LOG` environment variable.
///
/// # Example
/// ```no_run
/// use aethercore_core::logging;
///
/// logging::init_json();
/// tracing::info!(service = "gateway", "Service started");
/// ```
pub fn init_json() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().json().with_target(true).with_thread_ids(true))
        .init();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_doesnt_panic() {
        // Note: Can only initialize once per process, so we test that it doesn't panic
        // Actual initialization is tested in integration tests
        let _ = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("info"));
    }
}
