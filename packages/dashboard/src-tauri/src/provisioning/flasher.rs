//! Serial Flasher for Tethered Assets
//!
//! Handles firmware flashing and enrollment for USB-connected devices (Arduino, ESP32).
//! Ported from legacy provisioning.rs with unified response format.
//!
//! Security: Implements challenge-response protocol with ECDSA P-256 signatures
//! for hardware-rooted identity attestation.

use crate::commands::resolve_required_component_path;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};

/// Genesis message from newly flashed device
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenesisMessage {
    pub r#type: String,  // Must be "GENESIS"
    pub root: String,    // BLAKE3 hash of device identity
    pub pub_key: String, // ECDSA P-256 public key (hex encoded, 64 bytes uncompressed)
}

/// Genesis identity in unified format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenesisIdentity {
    pub node_id: String,
    pub public_key: String,
    pub root_hash: String,
    pub timestamp: u64,
}

/// Progress event for firmware flashing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlashProgress {
    pub stage: String,
    pub message: String,
    pub progress: f32, // 0.0 to 1.0
}

const USB_SERIAL_HINTS: &[&str] = &[
    "ralphie",
    "heltec",
    "esp",
    "cp210",
    "ftdi",
    "ch340",
    "silicon labs",
    "arduino",
    "pico",
    "rp2040",
];

/// Flash firmware and provision USB device
///
/// This function performs the complete provisioning flow for tethered devices:
/// 1. Flash firmware using esptool
/// 2. Listen for GENESIS message containing device identity
/// 3. Perform challenge-response attestation
/// 4. Return Genesis identity
///
/// # Arguments
/// * `port` - Serial port name (e.g., "/dev/ttyUSB0" or "COM3")
/// * `firmware_path` - Absolute path to firmware binary file
/// * `window` - Tauri window handle for emitting progress events
///
/// # Returns
/// GenesisIdentity containing device identity information
///
/// # Errors
/// - "Device Busy" if port is already in use
/// - "Permission Denied" if insufficient permissions
/// - "Check Cable" if device not responding
/// - "Flash failed" if esptool returns error
/// - "Attestation failed" if cryptographic verification fails
///
/// # Fail-Visible Philosophy
/// All failures are explicit and reported immediately. No graceful degradation.
pub async fn flash_and_provision(
    port: String,
    firmware_path: String,
    window: tauri::Window,
) -> Result<GenesisIdentity, String> {
    log::info!(
        "Starting flash and provision: port={}, firmware={}",
        port,
        firmware_path
    );

    // STEP 1: Flash firmware
    flash_firmware(&port, &firmware_path, &window).await?;

    // STEP 2: Listen for GENESIS message
    let genesis = listen_for_genesis(&port).await?;

    // STEP 3: Perform attestation
    let identity = perform_attestation(&port, genesis).await?;

    log::info!("Flash and provision complete for {}", port);

    Ok(identity)
}

/// Flash UF2 firmware to a USB mass-storage boot drive and continue with serial attestation.
///
/// This flow supports bootloader-only onboarding devices (for example RP2040 UF2 mode):
/// 1. Copy UF2 artifact onto mass-storage mount
/// 2. Wait for device reboot and serial re-enumeration
/// 3. Listen for GENESIS and perform challenge-response attestation
pub async fn flash_mass_storage_and_provision(
    mount_point: String,
    firmware_path: String,
    window: tauri::Window,
) -> Result<GenesisIdentity, String> {
    log::info!(
        "Starting mass-storage flash and provision: mount_point={}, firmware={}",
        mount_point,
        firmware_path
    );

    let baseline_ports = serialport::available_ports()
        .map_err(|e| format!("FAIL-VISIBLE: Failed to enumerate serial ports: {}", e))?
        .into_iter()
        .map(|port| port.port_name)
        .collect::<HashSet<_>>();

    flash_uf2_mass_storage(&mount_point, &firmware_path, &window).await?;

    let attestation_port = await_attestation_port(&baseline_ports, &window).await?;
    let genesis = listen_for_genesis(&attestation_port).await?;
    let identity = perform_attestation(&attestation_port, genesis).await?;

    log::info!(
        "Mass-storage flash and provision complete via serial port {}",
        attestation_port
    );

    Ok(identity)
}

/// Flash firmware to serial device using esptool
async fn flash_firmware(
    port: &str,
    firmware_path: &str,
    window: &tauri::Window,
) -> Result<(), String> {
    log::info!("Flashing firmware to {}", port);

    // Validate firmware file exists
    if !Path::new(firmware_path).exists() {
        let err = format!("FAIL-VISIBLE: Firmware file not found: {}", firmware_path);
        log::error!("{}", err);
        return Err(err);
    }

    // Emit initial progress
    let _ = window.emit(
        "flash_progress",
        FlashProgress {
            stage: "initializing".to_string(),
            message: "Preparing to flash firmware...".to_string(),
            progress: 0.0,
        },
    );

    // Resolve bundled esptool from Tauri resources (no PATH dependency)
    let esptool_cmd = resolve_required_component_path(window.app_handle(), "esptool")
        .map_err(|e| format!("FAIL-VISIBLE: Bundled esptool missing/corrupt: {e}"))?;

    log::info!("Using esptool at: {:?}", esptool_cmd);

    // Emit connection progress
    let _ = window.emit(
        "flash_progress",
        FlashProgress {
            stage: "connecting".to_string(),
            message: format!("Connecting to device on {}...", port),
            progress: 0.2,
        },
    );

    // Build esptool command for ESP32/ESP8266
    let mut child = Command::new(esptool_cmd)
        .arg("--port")
        .arg(port)
        .arg("write_flash")
        .arg("0x0")
        .arg(firmware_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                format!(
                    "FAIL-VISIBLE: Permission Denied accessing {}. \
                         Add user to dialout group or run with appropriate permissions.",
                    port
                )
            } else {
                format!(
                    "FAIL-VISIBLE: Check Cable. Failed to connect to device: {}",
                    e
                )
            }
        })?;

    // Capture stdout for progress monitoring
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "FAIL-VISIBLE: Failed to capture esptool stdout".to_string())?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "FAIL-VISIBLE: Failed to capture esptool stderr".to_string())?;

    let window_clone = window.clone();

    // Spawn thread to read stdout and emit progress
    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(std::result::Result::ok) {
            log::debug!("esptool: {}", line);

            // Parse progress from esptool output
            let progress = if line.contains("Connecting") {
                0.3
            } else if line.contains("Writing") || line.contains("Wrote") {
                0.7
            } else if line.contains("Leaving") {
                0.9
            } else if line.contains("Hash of data verified") {
                1.0
            } else {
                0.5
            };

            let _ = window_clone.emit(
                "flash_progress",
                FlashProgress {
                    stage: "flashing".to_string(),
                    message: line,
                    progress,
                },
            );
        }
    });

    // Capture stderr for error reporting
    let mut stderr_output = Vec::new();
    let stderr_reader = BufReader::new(stderr);
    for line in stderr_reader.lines().map_while(Result::ok) {
        log::warn!("esptool stderr: {}", line);
        stderr_output.push(line);
    }

    // Wait for process completion
    let status = child
        .wait()
        .map_err(|e| format!("FAIL-VISIBLE: Failed to wait for esptool: {}", e))?;

    stdout_handle
        .join()
        .map_err(|_| "FAIL-VISIBLE: Failed to join stdout thread".to_string())?;

    if !status.success() {
        let err = format!(
            "FAIL-VISIBLE: Flash failed with exit code: {:?}. \
             Check Cable. Errors: {}",
            status.code(),
            stderr_output.join("\n")
        );
        log::error!("{}", err);

        let _ = window.emit(
            "flash_progress",
            FlashProgress {
                stage: "failed".to_string(),
                message: err.clone(),
                progress: 0.0,
            },
        );

        return Err(err);
    }

    // Emit completion
    let _ = window.emit(
        "flash_progress",
        FlashProgress {
            stage: "complete".to_string(),
            message: "Firmware flashed successfully".to_string(),
            progress: 1.0,
        },
    );

    log::info!("Firmware flash completed successfully for port: {}", port);

    Ok(())
}

async fn flash_uf2_mass_storage(
    mount_point: &str,
    firmware_path: &str,
    window: &tauri::Window,
) -> Result<(), String> {
    let mount_path = Path::new(mount_point);
    if !mount_path.is_dir() {
        return Err(format!(
            "FAIL-VISIBLE: USB mass-storage mount point not available: {}",
            mount_point
        ));
    }

    let firmware = Path::new(firmware_path);
    if !firmware.exists() {
        return Err(format!(
            "FAIL-VISIBLE: Firmware file not found: {}",
            firmware_path
        ));
    }

    let extension = firmware
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    if extension != "uf2" {
        return Err(format!(
            "FAIL-VISIBLE: Mass-storage provisioning requires a .uf2 artifact, got: {}",
            firmware_path
        ));
    }

    let metadata = fs::metadata(firmware).map_err(|e| {
        format!(
            "FAIL-VISIBLE: Unable to read firmware metadata ({}): {}",
            firmware_path, e
        )
    })?;
    if metadata.len() == 0 {
        return Err(format!(
            "FAIL-VISIBLE: Firmware artifact is empty: {}",
            firmware_path
        ));
    }

    let _ = window.emit(
        "flash_progress",
        FlashProgress {
            stage: "initializing".to_string(),
            message: "Preparing UF2 copy to USB boot drive...".to_string(),
            progress: 0.0,
        },
    );

    let filename = firmware
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("firmware.uf2");
    let destination = mount_path.join(filename);

    let _ = window.emit(
        "flash_progress",
        FlashProgress {
            stage: "flashing".to_string(),
            message: format!(
                "Copying {} to boot drive {}",
                filename,
                mount_path.to_string_lossy()
            ),
            progress: 0.45,
        },
    );

    fs::copy(firmware, &destination).map_err(|e| {
        format!(
            "FAIL-VISIBLE: Failed to copy UF2 to boot drive ({}): {}",
            destination.display(),
            e
        )
    })?;

    let _ = window.emit(
        "flash_progress",
        FlashProgress {
            stage: "flashing".to_string(),
            message: "UF2 copied successfully. Waiting for reboot and identity handshake..."
                .to_string(),
            progress: 0.65,
        },
    );

    Ok(())
}

async fn await_attestation_port(
    baseline_ports: &HashSet<String>,
    window: &tauri::Window,
) -> Result<String, String> {
    let timeout = Duration::from_secs(45);
    let interval = Duration::from_millis(1000);
    let start = std::time::Instant::now();

    loop {
        if start.elapsed() > timeout {
            return Err(
                "FAIL-VISIBLE: Device flashed, but no compatible serial endpoint appeared for \
                 GENESIS/attestation within 45 seconds. Reconnect device and rescan."
                    .to_string(),
            );
        }

        let ports = serialport::available_ports().map_err(|e| {
            format!(
                "FAIL-VISIBLE: Failed to enumerate serial ports after UF2 flash: {}",
                e
            )
        })?;

        if let Some(port_name) = select_attestation_port(baseline_ports, &ports) {
            let _ = window.emit(
                "flash_progress",
                FlashProgress {
                    stage: "connecting".to_string(),
                    message: format!(
                        "Detected provisioned serial endpoint on {}. Establishing trust handshake...",
                        port_name
                    ),
                    progress: 0.8,
                },
            );
            return Ok(port_name);
        }

        tokio::time::sleep(interval).await;
    }
}

fn select_attestation_port(
    baseline_ports: &HashSet<String>,
    ports: &[serialport::SerialPortInfo],
) -> Option<String> {
    for port in ports {
        if !baseline_ports.contains(&port.port_name) {
            return Some(port.port_name.clone());
        }
    }

    for port in ports {
        if is_likely_ralphie_serial_port(port) {
            return Some(port.port_name.clone());
        }
    }

    None
}

fn is_likely_ralphie_serial_port(port: &serialport::SerialPortInfo) -> bool {
    let serialport::SerialPortType::UsbPort(info) = &port.port_type else {
        return false;
    };

    let descriptor = format!(
        "{} {} {}",
        info.manufacturer.as_deref().unwrap_or_default(),
        info.product.as_deref().unwrap_or_default(),
        port.port_name
    )
    .to_lowercase();

    USB_SERIAL_HINTS
        .iter()
        .any(|hint| descriptor.contains(hint))
}

/// Listen for GENESIS message from newly flashed device
async fn listen_for_genesis(port: &str) -> Result<GenesisMessage, String> {
    log::info!("Listening for GENESIS message on port: {}", port);

    // Small delay to allow device to reset after flashing
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Open serial port
    let serial = serialport::new(port, 115200)
        .timeout(Duration::from_secs(30))
        .open()
        .map_err(|e| {
            if e.to_string().contains("Permission denied") {
                format!(
                    "FAIL-VISIBLE: Permission Denied accessing {}. \
                         Add user to dialout group or run with appropriate permissions.",
                    port
                )
            } else if e.to_string().contains("Device or resource busy") {
                format!(
                    "FAIL-VISIBLE: Device Busy. Port {} is already in use. \
                         Close other applications using this port.",
                    port
                )
            } else {
                format!(
                    "FAIL-VISIBLE: Check Cable. Failed to open serial port {}: {}",
                    port, e
                )
            }
        })?;

    log::info!("Serial port opened successfully: {}", port);

    // Read lines until we find a GENESIS message or timeout
    let mut buffer = String::new();
    let mut reader = BufReader::new(
        serial
            .try_clone()
            .map_err(|e| format!("FAIL-VISIBLE: Failed to clone serial port: {}", e))?,
    );

    let start_time = std::time::Instant::now();
    let timeout = Duration::from_secs(30);

    loop {
        if start_time.elapsed() > timeout {
            let err = format!(
                "FAIL-VISIBLE: Timeout waiting for GENESIS message from {}. \
                 Device did not establish cryptographic identity within 30 seconds. \
                 Check Cable or reflash firmware.",
                port
            );
            log::error!("{}", err);
            return Err(err);
        }

        buffer.clear();
        match reader.read_line(&mut buffer) {
            Ok(0) => {
                // EOF reached
                thread::sleep(Duration::from_millis(100));
                continue;
            }
            Ok(_) => {
                let line = buffer.trim();
                log::debug!("Received line: {}", line);

                // Try to parse as JSON
                if let Ok(genesis) = serde_json::from_str::<GenesisMessage>(line) {
                    // Validate message type
                    if genesis.r#type != "GENESIS" {
                        log::warn!("Received JSON but type is not GENESIS: {}", genesis.r#type);
                        continue;
                    }

                    // Validate required fields are non-empty
                    if genesis.root.is_empty() || genesis.pub_key.is_empty() {
                        let err = format!(
                            "FAIL-VISIBLE: Invalid GENESIS message - empty fields. \
                             root: '{}', pub_key: '{}'. \
                             This is a CRITICAL failure.",
                            genesis.root, genesis.pub_key
                        );
                        log::error!("{}", err);
                        return Err(err);
                    }

                    // Validate root is a valid BLAKE3 hash (should be hex string)
                    if !genesis.root.chars().all(|c| c.is_ascii_hexdigit()) {
                        let err = format!(
                            "FAIL-VISIBLE: Invalid GENESIS root hash format. \
                             Expected hex string, got: {}. \
                             This is a CRITICAL failure.",
                            genesis.root
                        );
                        log::error!("{}", err);
                        return Err(err);
                    }

                    log::info!("GENESIS message received and validated from {}", port);
                    log::info!("  Root: {}", genesis.root);
                    log::info!(
                        "  PubKey: {}...",
                        &genesis.pub_key[..20.min(genesis.pub_key.len())]
                    );

                    return Ok(genesis);
                }
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::TimedOut {
                    // Timeout on read, continue waiting
                    continue;
                } else {
                    let err = format!("FAIL-VISIBLE: Error reading from serial port: {}", e);
                    log::error!("{}", err);
                    return Err(err);
                }
            }
        }
    }
}

/// Perform challenge-response attestation
async fn perform_attestation(
    port: &str,
    genesis: GenesisMessage,
) -> Result<GenesisIdentity, String> {
    use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
    use rand::rngs::OsRng;
    use rand::RngCore;

    log::info!("Starting challenge-response attestation for port: {}", port);

    // Generate 32-byte cryptographically secure random challenge
    let mut challenge_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut challenge_bytes);
    let challenge_hex = hex::encode(challenge_bytes);

    log::info!("Generated challenge: {}...", &challenge_hex[..16]);

    // Parse and validate device public key (ECDSA P-256)
    let pub_key_bytes = hex::decode(&genesis.pub_key).map_err(|e| {
        format!(
            "FAIL-VISIBLE: Invalid public key format in GENESIS message. \
                     Expected hex-encoded P-256 key: {}",
            e
        )
    })?;

    if pub_key_bytes.len() != 64 {
        return Err(format!(
            "FAIL-VISIBLE: Invalid P-256 public key length. \
             Expected 64 bytes (uncompressed), got {}. \
             This is a CRITICAL security failure.",
            pub_key_bytes.len()
        ));
    }

    // Construct uncompressed P-256 point (0x04 prefix + 64 bytes)
    let mut pub_key_point = vec![0x04];
    pub_key_point.extend_from_slice(&pub_key_bytes);

    let verifying_key = VerifyingKey::from_sec1_bytes(&pub_key_point).map_err(|e| {
        format!(
            "FAIL-VISIBLE: Failed to parse P-256 public key from GENESIS message: {}. \
                     This is a CRITICAL security failure.",
            e
        )
    })?;

    log::info!("Device public key validated");

    // Open serial port for challenge-response exchange
    let mut serial = serialport::new(port, 115200)
        .timeout(Duration::from_secs(5))
        .open()
        .map_err(|e| format!("FAIL-VISIBLE: Failed to open serial port {}: {}", port, e))?;

    // Send ENROLL command with challenge
    let enroll_cmd = serde_json::json!({
        "command": "ENROLL",
        "bundle": {
            "challenge": challenge_hex
        }
    });

    let enroll_json = serde_json::to_string(&enroll_cmd)
        .map_err(|e| format!("FAIL-VISIBLE: Failed to serialize ENROLL command: {}", e))?;

    writeln!(serial, "{}", enroll_json)
        .map_err(|e| format!("FAIL-VISIBLE: Failed to send ENROLL command: {}", e))?;

    log::info!("ENROLL command sent with challenge");

    // Listen for ENROLL_PROOF response
    let mut buffer = String::new();
    let mut reader = BufReader::new(
        serial
            .try_clone()
            .map_err(|e| format!("FAIL-VISIBLE: Failed to clone serial port: {}", e))?,
    );

    let start_time = std::time::Instant::now();
    let timeout = Duration::from_secs(5);

    let enroll_proof = loop {
        if start_time.elapsed() > timeout {
            let err = format!(
                "FAIL-VISIBLE: Timeout waiting for ENROLL_PROOF from {}. \
                 Device failed to respond. Check Cable.",
                port
            );
            log::error!("{}", err);
            return Err(err);
        }

        buffer.clear();
        match reader.read_line(&mut buffer) {
            Ok(0) => {
                thread::sleep(Duration::from_millis(100));
                continue;
            }
            Ok(_) => {
                let line = buffer.trim();
                log::debug!("Received line: {}", line);

                if let Ok(proof_value) = serde_json::from_str::<serde_json::Value>(line) {
                    if proof_value.get("type").and_then(|v| v.as_str()) == Some("ENROLL_PROOF") {
                        log::info!("ENROLL_PROOF received from device");
                        break proof_value;
                    }
                }
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::TimedOut {
                    continue;
                } else {
                    let err = format!("FAIL-VISIBLE: Error reading from serial port: {}", e);
                    log::error!("{}", err);
                    return Err(err);
                }
            }
        }
    };

    // Extract signature and timestamp
    let signature_hex = enroll_proof
        .get("proof")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "FAIL-VISIBLE: Missing 'proof' field in ENROLL_PROOF".to_string())?;

    let timestamp = enroll_proof
        .get("timestamp")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    log::info!("Received ENROLL_PROOF at timestamp: {}", timestamp);

    // Verify the ECDSA P-256 signature
    let mut message = Vec::new();
    message.extend_from_slice(&challenge_bytes);
    message.extend_from_slice(&timestamp.to_be_bytes());

    let signature_bytes = hex::decode(signature_hex).map_err(|e| {
        format!(
            "FAIL-VISIBLE: Invalid signature format in ENROLL_PROOF. \
                     Expected hex-encoded ECDSA signature: {}",
            e
        )
    })?;

    let signature = Signature::from_der(&signature_bytes)
        .or_else(|_| {
            if signature_bytes.len() == 64 {
                Signature::from_slice(&signature_bytes)
            } else {
                Err(p256::ecdsa::Error::new())
            }
        })
        .map_err(|e| {
            format!(
                "FAIL-VISIBLE: Failed to parse ECDSA signature from ENROLL_PROOF: {}. \
                     This is a CRITICAL security failure.",
                e
            )
        })?;

    // CRITICAL: Verify the signature
    if let Err(e) = verifying_key.verify(&message, &signature) {
        let err = format!(
            "FAIL-VISIBLE: Device Attestation Failed. \
             Signature verification failed: {}. \
             The device at {} is considered an ADVERSARY.",
            e, port
        );
        log::error!("{}", err);
        return Err("Device Attestation Failed".to_string());
    }

    log::info!("✓ Signature verification PASSED - Device attestation successful");

    // Send PROVISION_CONFIRM
    let node_id = format!("node_{}", &genesis.root[..8]);
    let confirm_cmd = serde_json::json!({
        "command": "PROVISION_CONFIRM",
        "node_id": node_id
    });

    let confirm_json = serde_json::to_string(&confirm_cmd)
        .map_err(|e| format!("FAIL-VISIBLE: Failed to serialize PROVISION_CONFIRM: {}", e))?;

    writeln!(serial, "{}", confirm_json)
        .map_err(|e| format!("FAIL-VISIBLE: Failed to send PROVISION_CONFIRM: {}", e))?;

    log::info!("PROVISION_CONFIRM sent - Radio unlocked");

    // Return GenesisIdentity
    Ok(GenesisIdentity {
        node_id,
        public_key: genesis.pub_key.clone(),
        root_hash: genesis.root.clone(),
        timestamp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_genesis_message_deserialization() {
        let json = r#"{
            "type": "GENESIS",
            "root": "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
            "pub_key": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }"#;

        let genesis: GenesisMessage = serde_json::from_str(json).unwrap();
        assert_eq!(genesis.r#type, "GENESIS");
        assert_eq!(genesis.root.len(), 64);
    }

    #[test]
    fn test_select_attestation_port_prefers_new_port() {
        use serialport::{SerialPortInfo, SerialPortType, UsbPortInfo};

        let baseline = HashSet::from([String::from("COM3")]);
        let ports = vec![
            SerialPortInfo {
                port_name: "COM3".to_string(),
                port_type: SerialPortType::UsbPort(UsbPortInfo {
                    vid: 0x10c4,
                    pid: 0xea60,
                    serial_number: None,
                    manufacturer: Some("Silicon Labs".to_string()),
                    product: Some("CP2102".to_string()),
                }),
            },
            SerialPortInfo {
                port_name: "COM7".to_string(),
                port_type: SerialPortType::UsbPort(UsbPortInfo {
                    vid: 0x10c4,
                    pid: 0xea60,
                    serial_number: None,
                    manufacturer: Some("Silicon Labs".to_string()),
                    product: Some("CP2102".to_string()),
                }),
            },
        ];

        let selected = select_attestation_port(&baseline, &ports);
        assert_eq!(selected.as_deref(), Some("COM7"));
    }
}
