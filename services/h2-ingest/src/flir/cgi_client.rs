// FLIR CGI Client - HTTP Control Plane
// Handles authentication and UDP binding for Teledyne/FLIR cameras

use std::error::Error;
use tracing::{info, error};

const NEXUS_TIMEOUT_SECS: u64 = 10;

/// Authenticate with FLIR camera and retrieve session ID
pub async fn authenticate(
    flir_ip: &str,
    user: &str,
    pass: &str,
) -> Result<String, Box<dyn Error>> {
    let url = format!(
        "http://{}/Nexus.cgi?action=SERVERAuthInitialize&username={}&password={}",
        flir_ip, user, pass
    );

    info!("[FLIR] Authenticating to {} as user '{}'", flir_ip, user);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(NEXUS_TIMEOUT_SECS))
        .build()?;

    let response = client.get(&url).send().await?;

    if !response.status().is_success() {
        error!("[FLIR] Authentication failed: HTTP {}", response.status());
        return Err(format!("Authentication failed: HTTP {}", response.status()).into());
    }

    let body = response.text().await?;
    info!("[FLIR] Authentication response: {}", body);

    // Parse session_id from response
    // Expected format: session=<SESSION_ID>
    let session_id = body
        .split("session=")
        .nth(1)
        .and_then(|s| s.split('&').next())
        .or_else(|| {
            body.split("session=")
                .nth(1)
                .and_then(|s| s.split('\n').next())
        })
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "Failed to extract session_id from response".into())?;

    info!("[FLIR] Session established: {}", session_id);
    Ok(session_id)
}

/// Register UDP endpoint for telemetry streaming
pub async fn bind_udp_telemetry(
    flir_ip: &str,
    session_id: &str,
    edge_node_ip: &str,
    port: u16,
) -> Result<(), Box<dyn Error>> {
    let url = format!(
        "http://{}/Nexus.cgi?session={}&action=SERVERUDPClientRegister&ip={}&port={}&type=ALL",
        flir_ip, session_id, edge_node_ip, port
    );

    info!(
        "[FLIR] Registering UDP telemetry stream to {}:{}",
        edge_node_ip, port
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(NEXUS_TIMEOUT_SECS))
        .build()?;

    let response = client.get(&url).send().await?;

    if !response.status().is_success() {
        error!(
            "[FLIR] UDP registration failed: HTTP {}",
            response.status()
        );
        return Err(format!("UDP registration failed: HTTP {}", response.status()).into());
    }

    let body = response.text().await?;
    info!("[FLIR] UDP binding response: {}", body);

    Ok(())
}

/// Deauthenticate and close session
pub async fn deauthenticate(
    flir_ip: &str,
    session_id: &str,
) -> Result<(), Box<dyn Error>> {
    let url = format!(
        "http://{}/Nexus.cgi?session={}&action=SERVERAuthClose",
        flir_ip, session_id
    );

    info!("[FLIR] Closing session {}", session_id);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(NEXUS_TIMEOUT_SECS))
        .build()?;

    let response = client.get(&url).send().await?;

    if !response.status().is_success() {
        error!("[FLIR] Session close failed: HTTP {}", response.status());
        return Err(format!("Session close failed: HTTP {}", response.status()).into());
    }

    info!("[FLIR] Session closed successfully");
    Ok(())
}

