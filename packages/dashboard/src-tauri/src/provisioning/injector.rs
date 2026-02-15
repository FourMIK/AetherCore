//! Remote Asset Injector (SSH-based Provisioning)
//!
//! Handles provisioning of remote network assets (Raspberry Pi) via SSH.
//! Implements SCP file transfer and remote command execution to install
//! the CodeRalphie hardware root of trust.
//!
//! Security: SSH connections use password authentication (for initial deployment).
//! Future enhancement: Use SSH key-based authentication for production.

use crate::commands::resolve_required_component_path;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::io::Read;
use std::net::TcpStream;
use std::path::Path;
use tauri::Manager;

/// Genesis message from provisioned remote device
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenesisIdentity {
    pub node_id: String,
    pub public_key: String,
    pub root_hash: String,
    pub timestamp: u64,
}

/// Inject CodeRalphie to Raspberry Pi via SSH
///
/// This function performs the following operations:
/// 1. Establishes SSH connection to target IP
/// 2. SCPs the coderalphie-linux-arm64 binary to /tmp/
/// 3. Makes the binary executable
/// 4. Executes the installation process
/// 5. Captures the Genesis JSON output
///
/// # Arguments
/// * `ip` - Target IP address (e.g., "192.168.1.50")
/// * `user` - SSH username (typically "pi")
/// * `pass` - SSH password
///
/// # Returns
/// GenesisIdentity containing device identity information
///
/// # Errors
/// - "Connection refused" if target is unreachable
/// - "Bad Password" if SSH authentication fails
/// - "SCP failed" if file transfer fails
/// - "Installation failed" if remote execution fails
/// - "Genesis not found" if device doesn't return identity
///
/// # Fail-Visible Philosophy
/// All SSH/SCP errors are explicit. Authentication failures are immediately
/// reported as "Bad Password" to guide operator troubleshooting.
pub async fn inject_pi(
    app_handle: &tauri::AppHandle,
    ip: String,
    user: String,
    pass: String,
) -> Result<GenesisIdentity, String> {
    log::info!("Starting SSH injection to {}@{}", user, ip);

    // STEP 1: Establish TCP connection
    let tcp = TcpStream::connect(format!("{}:22", ip)).map_err(|e| {
        if e.kind() == std::io::ErrorKind::ConnectionRefused {
            format!(
                "FAIL-VISIBLE: Connection refused to {}. \
                         Ensure SSH is enabled and device is on network.",
                ip
            )
        } else if e.kind() == std::io::ErrorKind::TimedOut {
            format!(
                "FAIL-VISIBLE: Connection timeout to {}. \
                         Check network connectivity and firewall.",
                ip
            )
        } else {
            format!("FAIL-VISIBLE: Network error connecting to {}: {}", ip, e)
        }
    })?;

    log::info!("TCP connection established to {}", ip);

    // STEP 2: Create SSH session
    let mut sess =
        Session::new().map_err(|e| format!("FAIL-VISIBLE: Failed to create SSH session: {}", e))?;

    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("FAIL-VISIBLE: SSH handshake failed: {}", e))?;

    log::info!("SSH handshake complete");

    // STEP 3: Authenticate with password
    sess.userauth_password(&user, &pass).map_err(|e| {
        // Check if it's an authentication failure
        if e.to_string().contains("Authentication failed")
            || e.to_string().contains("Access denied")
        {
            "FAIL-VISIBLE: Bad Password. Authentication failed.".to_string()
        } else {
            format!("FAIL-VISIBLE: SSH authentication error: {}", e)
        }
    })?;

    if !sess.authenticated() {
        return Err("FAIL-VISIBLE: Bad Password. Not authenticated after userauth.".to_string());
    }

    log::info!("SSH authentication successful");

    // STEP 4: Locate the payload binary
    let payload_path =
        find_payload_binary(app_handle).map_err(|e| format!("FAIL-VISIBLE: {}", e))?;

    log::info!("Using payload: {}", payload_path.display());

    // STEP 5: SCP the binary to remote /tmp/
    let remote_path = "/tmp/coderalphie";
    scp_file(&sess, &payload_path, remote_path)?;

    log::info!("Binary transferred successfully");

    // STEP 6: Make executable and run installation
    let genesis = execute_installation(&sess, remote_path).await?;

    log::info!("Installation complete, Genesis received");

    Ok(genesis)
}

/// Find the coderalphie-linux-arm64 binary in resources/payloads/
fn find_payload_binary(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let resource_path = resolve_required_component_path(app_handle, "coderalphie-linux-arm64")
        .map_err(|e| format!("Failed to resolve payload resource path: {e}"))?;

    if resource_path.exists() {
        return Ok(resource_path);
    }

    Err(
        "CodeRalphie binary not found in bundled resources/payloads/. Please ensure coderalphie-linux-arm64 is bundled before provisioning. This is a CRITICAL failure.".to_string(),
    )
}

/// SCP file to remote system
fn scp_file(sess: &Session, local_path: &Path, remote_path: &str) -> Result<(), String> {
    use std::fs::File;

    log::info!("Starting SCP: {} -> {}", local_path.display(), remote_path);

    // Read local file
    let mut local_file = File::open(local_path)
        .map_err(|e| format!("FAIL-VISIBLE: Failed to open local file: {}", e))?;

    let file_size = local_file
        .metadata()
        .map_err(|e| format!("FAIL-VISIBLE: Failed to get file metadata: {}", e))?
        .len();

    log::info!("File size: {} bytes", file_size);

    // Open remote file for writing with 0755 permissions
    let mut remote_file = sess
        .scp_send(Path::new(remote_path), 0o755, file_size, None)
        .map_err(|e| format!("FAIL-VISIBLE: SCP failed to open remote file: {}", e))?;

    // Transfer data in chunks
    let mut buffer = vec![0u8; 8192];
    let mut transferred = 0u64;

    loop {
        let n = local_file
            .read(&mut buffer)
            .map_err(|e| format!("FAIL-VISIBLE: Failed to read local file: {}", e))?;

        if n == 0 {
            break;
        }

        remote_file
            .write_all(&buffer[..n])
            .map_err(|e| format!("FAIL-VISIBLE: Failed to write to remote file: {}", e))?;

        transferred += n as u64;

        if transferred % (256 * 1024) == 0 {
            log::debug!("Transferred {} / {} bytes", transferred, file_size);
        }
    }

    // Ensure all data is sent
    remote_file
        .send_eof()
        .map_err(|e| format!("FAIL-VISIBLE: Failed to send EOF: {}", e))?;

    remote_file
        .wait_eof()
        .map_err(|e| format!("FAIL-VISIBLE: Failed to wait for EOF: {}", e))?;

    remote_file
        .close()
        .map_err(|e| format!("FAIL-VISIBLE: Failed to close remote file: {}", e))?;

    remote_file
        .wait_close()
        .map_err(|e| format!("FAIL-VISIBLE: Failed to wait for close: {}", e))?;

    log::info!("SCP complete: {} bytes transferred", transferred);

    Ok(())
}

/// Execute remote installation and capture Genesis JSON
async fn execute_installation(
    sess: &Session,
    binary_path: &str,
) -> Result<GenesisIdentity, String> {
    log::info!("Executing remote installation");

    // STEP 1: Execute the binary with --provision flag
    let command = format!("{} --provision", binary_path);

    let mut channel = sess
        .channel_session()
        .map_err(|e| format!("FAIL-VISIBLE: Failed to open SSH channel: {}", e))?;

    channel
        .exec(&command)
        .map_err(|e| format!("FAIL-VISIBLE: Failed to execute remote command: {}", e))?;

    // STEP 2: Read output
    let mut output = String::new();
    channel
        .read_to_string(&mut output)
        .map_err(|e| format!("FAIL-VISIBLE: Failed to read command output: {}", e))?;

    // Wait for command completion
    channel
        .wait_close()
        .map_err(|e| format!("FAIL-VISIBLE: Failed to wait for channel close: {}", e))?;

    let exit_status = channel
        .exit_status()
        .map_err(|e| format!("FAIL-VISIBLE: Failed to get exit status: {}", e))?;

    log::info!("Remote command completed with exit status: {}", exit_status);
    log::debug!("Command output:\n{}", output);

    if exit_status != 0 {
        return Err(format!(
            "FAIL-VISIBLE: Installation failed with exit code {}. Output:\n{}",
            exit_status, output
        ));
    }

    // STEP 3: Parse Genesis JSON from output
    parse_genesis_from_output(&output)
}

/// Parse Genesis identity from command output
fn parse_genesis_from_output(output: &str) -> Result<GenesisIdentity, String> {
    log::info!("Parsing Genesis JSON from output");

    // Look for JSON object in output
    for line in output.lines() {
        let trimmed = line.trim();

        // Try to parse as JSON
        if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            // Check if it looks like a Genesis message
            if json_value.get("type").and_then(|v| v.as_str()) == Some("GENESIS")
                || json_value.get("node_id").is_some()
            {
                // Attempt to parse as GenesisIdentity
                if let Ok(genesis) = serde_json::from_value::<GenesisIdentity>(json_value.clone()) {
                    log::info!("Genesis parsed: node_id={}", genesis.node_id);
                    return Ok(genesis);
                }

                // Fallback: construct from available fields
                let node_id = json_value
                    .get("node_id")
                    .or_else(|| json_value.get("root"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();

                let public_key = json_value
                    .get("pub_key")
                    .or_else(|| json_value.get("public_key"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let root_hash = json_value
                    .get("root")
                    .or_else(|| json_value.get("root_hash"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let timestamp = json_value
                    .get("timestamp")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);

                return Ok(GenesisIdentity {
                    node_id,
                    public_key,
                    root_hash,
                    timestamp,
                });
            }
        }
    }

    Err(format!(
        "FAIL-VISIBLE: Genesis not found in command output. \
         Device did not return valid identity information. \
         This is a CRITICAL failure. Output:\n{}",
        output
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_genesis_from_output() {
        let output = r#"
Starting provisioning...
{"type":"GENESIS","node_id":"node_abc123","pub_key":"aGVsbG8=","root":"blake3hash","timestamp":1234567890}
Provisioning complete.
        "#;

        let result = parse_genesis_from_output(output);
        assert!(result.is_ok());

        let genesis = result.unwrap();
        assert_eq!(genesis.node_id, "node_abc123");
        assert_eq!(genesis.public_key, "aGVsbG8=");
    }

    #[test]
    fn test_parse_genesis_from_output_no_genesis() {
        let output = "Some random output without JSON";

        let result = parse_genesis_from_output(output);
        assert!(result.is_err());
    }
}
