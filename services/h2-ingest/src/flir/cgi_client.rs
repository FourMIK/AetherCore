//! FLIR Nexus CGI Control Plane Client
//!
//! This module implements the HTTP/CGI interface for FLIR Nexus camera control.
//! It handles authentication and UDP telemetry stream registration.
//!
//! # FLIR Nexus CGI API
//! The FLIR Nexus camera exposes a CGI-based control interface for:
//! - Session-based authentication
//! - UDP telemetry client registration
//! - Configuration management
//!
//! # Security Note
//! In production deployments, credentials must be retrieved from secure vaults
//! (AWS Secrets Manager, HashiCorp Vault, etc.) and transmitted only over TLS.

use std::time::Duration;
use tracing::{debug, error, info, warn};

/// Custom error type for FLIR CGI operations
#[derive(Debug)]
pub enum FlirCgiError {
    /// HTTP request failed
    RequestFailed(String),
    
    /// Authentication failed (invalid credentials or timeout)
    AuthenticationFailed(String),
    
    /// Failed to parse response from FLIR device
    ResponseParseError(String),
    
    /// UDP registration failed
    RegistrationFailed(String),
}

impl std::fmt::Display for FlirCgiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FlirCgiError::RequestFailed(msg) => write!(f, "HTTP request failed: {}", msg),
            FlirCgiError::AuthenticationFailed(msg) => write!(f, "Authentication failed: {}", msg),
            FlirCgiError::ResponseParseError(msg) => write!(f, "Response parse error: {}", msg),
            FlirCgiError::RegistrationFailed(msg) => write!(f, "UDP registration failed: {}", msg),
        }
    }
}

impl std::error::Error for FlirCgiError {}

/// Result type alias for FLIR CGI operations
pub type Result<T> = std::result::Result<T, FlirCgiError>;

/// Helper function to determine HTTP scheme based on TLS enforcement
///
/// Returns "https" if FLIR_ENFORCE_TLS environment variable is set to "true" or "1",
/// otherwise returns "http" with a fail-visible warning.
fn get_flir_scheme() -> &'static str {
    if matches!(std::env::var("FLIR_ENFORCE_TLS").as_deref(), Ok("true") | Ok("1")) {
        info!("[FLIR CGI] TLS enforcement enabled - using HTTPS");
        "https"
    } else {
        warn!("[FLIR CGI] TLS not enforced - using HTTP (insecure). Set FLIR_ENFORCE_TLS=true for production.");
        "http"
    }
}

/// Authenticate with a FLIR Nexus camera and obtain a session ID
///
/// This function initiates a session with the FLIR device using HTTP Basic Authentication.
/// The returned session ID must be used for all subsequent API calls.
///
/// # Arguments
/// * `flir_ip` - IP address of the FLIR Nexus camera (e.g., "192.168.1.100")
/// * `user` - Username for authentication
/// * `pass` - Password for authentication
///
/// # Returns
/// * `Ok(String)` - Session ID for subsequent API calls
/// * `Err(FlirCgiError)` - If authentication fails
///
/// # Security Considerations
/// - This function assumes a local trusted network (Contested/Disconnected environment)
/// - In production, enforce TLS and certificate pinning
/// - Credentials should be rotated regularly and stored in secure vaults
///
/// # Example
/// ```ignore
/// let session_id = authenticate("192.168.1.100", "admin", "password").await?;
/// ```
pub async fn authenticate(flir_ip: &str, user: &str, pass: &str) -> Result<String> {
    info!("[FLIR CGI] Initiating authentication to {}", flir_ip);
    
    // Construct authentication URL with TLS awareness
    let scheme = get_flir_scheme();
    
    let auth_url = format!(
        "{}://{}/Nexus.cgi?action=SERVERAuthInitialize&username={}&password={}",
        scheme, flir_ip, user, pass
    );
    
    // Create HTTP client with reasonable timeouts for tactical environments
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| FlirCgiError::RequestFailed(format!("Client build failed: {}", e)))?;
    
    // Execute authentication request
    debug!("[FLIR CGI] Sending auth request to: {}", auth_url);
    let response = client
        .get(&auth_url)
        .send()
        .await
        .map_err(|e| {
            error!("[FLIR CGI] Auth request failed: {}", e);
            FlirCgiError::AuthenticationFailed(format!("Network error: {}", e))
        })?;
    
    // Check HTTP status
    if !response.status().is_success() {
        let status = response.status();
        error!("[FLIR CGI] Auth failed with status: {}", status);
        return Err(FlirCgiError::AuthenticationFailed(format!(
            "HTTP {} - Invalid credentials or device unavailable",
            status
        )));
    }
    
    // Parse response body
    let body = response
        .text()
        .await
        .map_err(|e| FlirCgiError::ResponseParseError(format!("Body read failed: {}", e)))?;
    
    debug!("[FLIR CGI] Auth response: {}", body);
    
    // Extract session ID from response
    // Expected format: "session_id=<SESSION_ID>" or XML/JSON response
    let session_id = extract_session_id(&body)?;
    
    info!("[FLIR CGI] Authentication successful: session={}", session_id);
    Ok(session_id)
}

/// Register this edge node to receive UDP telemetry from the FLIR camera
///
/// This function configures the FLIR device to stream telemetry data to the specified
/// IP address and port. The FLIR will continuously send NMEA-0183 formatted track data.
///
/// # Arguments
/// * `flir_ip` - IP address of the FLIR Nexus camera
/// * `session_id` - Session ID obtained from `authenticate()`
/// * `edge_node_ip` - IP address of this edge node (where UDP listener is running)
/// * `port` - UDP port number for receiving telemetry (typically 5000)
///
/// # Returns
/// * `Ok(())` - Registration successful
/// * `Err(FlirCgiError)` - If registration fails
///
/// # Network Considerations
/// - The FLIR device must be able to route packets to `edge_node_ip`
/// - Firewall rules must permit UDP traffic on the specified port
/// - In multi-interface scenarios, ensure the correct interface is bound
///
/// # Example
/// ```ignore
/// bind_udp_telemetry("192.168.1.100", &session_id, "192.168.1.50", 5000).await?;
/// ```
pub async fn bind_udp_telemetry(
    flir_ip: &str,
    session_id: &str,
    edge_node_ip: &str,
    port: u16,
) -> Result<()> {
    info!(
        "[FLIR CGI] Registering UDP client: {}:{} for FLIR at {}",
        edge_node_ip, port, flir_ip
    );
    
    // Construct UDP registration URL with TLS awareness
    let scheme = get_flir_scheme();
    
    let register_url = format!(
        "{}://{}/Nexus.cgi?session={}&action=SERVERUDPClientRegister&ip={}&port={}&type=ALL",
        scheme, flir_ip, session_id, edge_node_ip, port
    );
    
    // Create HTTP client
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| FlirCgiError::RequestFailed(format!("Client build failed: {}", e)))?;
    
    // Execute registration request
    debug!("[FLIR CGI] Sending UDP registration request");
    let response = client
        .get(&register_url)
        .send()
        .await
        .map_err(|e| {
            error!("[FLIR CGI] UDP registration request failed: {}", e);
            FlirCgiError::RegistrationFailed(format!("Network error: {}", e))
        })?;
    
    // Check HTTP status
    if !response.status().is_success() {
        let status = response.status();
        error!("[FLIR CGI] UDP registration failed with status: {}", status);
        return Err(FlirCgiError::RegistrationFailed(format!(
            "HTTP {} - Registration rejected by device",
            status
        )));
    }
    
    let body = response
        .text()
        .await
        .map_err(|e| FlirCgiError::ResponseParseError(format!("Body read failed: {}", e)))?;
    
    debug!("[FLIR CGI] Registration response: {}", body);
    
    // Verify registration success
    if body.contains("ERROR") || body.contains("FAIL") {
        warn!("[FLIR CGI] Registration response indicates failure: {}", body);
        return Err(FlirCgiError::RegistrationFailed(
            "Device rejected registration".to_string(),
        ));
    }
    
    info!("[FLIR CGI] UDP telemetry registration successful");
    Ok(())
}

/// Extract session ID from FLIR authentication response
///
/// Supports multiple response formats:
/// - Key-value format: "session_id=ABC123"
/// - XML format: "<session_id>ABC123</session_id>"
/// - JSON format: {"session_id": "ABC123"}
fn extract_session_id(response_body: &str) -> Result<String> {
    // Try key-value format first (most common)
    if let Some(kv_pair) = response_body.split('&').find(|s| s.starts_with("session_id=")) {
        if let Some(id) = kv_pair.strip_prefix("session_id=") {
            return Ok(id.trim().to_string());
        }
    }
    
    // Try XML format
    if response_body.contains("<session_id>") {
        if let Some(start) = response_body.find("<session_id>") {
            if let Some(end) = response_body[start..].find("</session_id>") {
                let id = &response_body[start + 12..start + end];
                return Ok(id.trim().to_string());
            }
        }
    }
    
    // Try JSON format (basic extraction without full JSON parser)
    if response_body.contains("\"session_id\"") {
        if let Some(start) = response_body.find("\"session_id\"") {
            let after_key = &response_body[start + 12..]; // Skip past "session_id"
            if let Some(colon_pos) = after_key.find(':') {
                let after_colon = after_key[colon_pos + 1..].trim_start();
                if let Some(quote_start) = after_colon.find('"') {
                    let after_quote = &after_colon[quote_start + 1..];
                    if let Some(quote_end) = after_quote.find('"') {
                        let id = &after_quote[..quote_end];
                        return Ok(id.trim().to_string());
                    }
                }
            }
        }
    }
    
    error!(
        "[FLIR CGI] Failed to extract session_id from response: {}",
        response_body
    );
    Err(FlirCgiError::ResponseParseError(
        "Could not extract session_id from response".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_extract_session_id_keyvalue() {
        let response = "status=OK&session_id=ABC123DEF&timeout=300";
        let id = extract_session_id(response).unwrap();
        assert_eq!(id, "ABC123DEF");
    }
    
    #[test]
    fn test_extract_session_id_xml() {
        let response = "<response><status>OK</status><session_id>XYZ789</session_id></response>";
        let id = extract_session_id(response).unwrap();
        assert_eq!(id, "XYZ789");
    }
    
    #[test]
    fn test_extract_session_id_json() {
        let response = r#"{"status": "OK", "session_id": "JSON123"}"#;
        let id = extract_session_id(response).unwrap();
        assert_eq!(id, "JSON123");
    }
    
    #[test]
    fn test_extract_session_id_invalid() {
        let response = "status=ERROR&message=Auth failed";
        let result = extract_session_id(response);
        assert!(result.is_err());
    }
}
