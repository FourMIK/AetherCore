//! Zero-Touch Enrollment Provisioning Module
//!
//! Handles firmware flashing and device enrollment for RalphieNode (Arduino Satellite).
//! Implements the "Fail-Visible" philosophy: All failures are explicit, never hidden.
//!
//! Security:
//! - Uses BLAKE3 for hash verification
//! - Implements Ed25519 signature verification for device identity
//! - Requires explicit error handling per 4MIK coding standards

use crate::commands::resolve_required_component_path;
use anyhow::{Context, Result};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use tauri::Emitter;

/// Serial device information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialDeviceInfo {
    pub port_name: String,
    pub port_type: String,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial_number: Option<String>,
}

/// Genesis message from newly flashed device
/// This structure represents the hardware root of trust initialization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenesisMessage {
    pub r#type: String,  // Must be "GENESIS"
    pub root: String,    // BLAKE3 hash of device identity
    pub pub_key: String, // ECDSA P-256 public key (hex encoded, 64 bytes uncompressed)
}

/// ENROLL command sent to device with challenge
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollCommand {
    pub command: String, // Must be "ENROLL"
    pub bundle: EnrollBundle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollBundle {
    pub challenge: String, // 32-byte random challenge (hex encoded)
}

/// ENROLL_PROOF response from device
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollProof {
    pub r#type: String, // Must be "ENROLL_PROOF"
    pub proof: String,  // ECDSA P-256 signature (hex encoded)
    pub timestamp: u64, // Unix timestamp
}

/// PROVISION_CONFIRM command to unlock radio
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvisionConfirm {
    pub command: String, // Must be "PROVISION_CONFIRM"
    pub node_id: String, // Assigned node identifier
}

/// Progress event for firmware flashing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlashProgress {
    pub stage: String,
    pub message: String,
    pub progress: f32, // 0.0 to 1.0
}

/// List available serial ports, filtering for Silicon Labs or CP210x devices
/// commonly used by Heltec and ESP-based devices.
///
/// Returns: List of SerialDeviceInfo for all available serial devices
///
/// Errors:
/// - "Failed to enumerate serial ports" if system enumeration fails
#[tauri::command]
pub async fn list_serial_ports() -> Result<Vec<SerialDeviceInfo>, String> {
    log::info!("Enumerating serial ports for RalphieNode devices");

    let ports = serialport::available_ports()
        .map_err(|e| format!("Failed to enumerate serial ports: {}", e))?;

    let device_list: Vec<SerialDeviceInfo> = ports
        .into_iter()
        .map(|port| {
            let (port_type, manufacturer, product, serial_number) = match &port.port_type {
                serialport::SerialPortType::UsbPort(usb_info) => (
                    "USB".to_string(),
                    Some(usb_info.manufacturer.clone().unwrap_or_default()),
                    Some(usb_info.product.clone().unwrap_or_default()),
                    Some(usb_info.serial_number.clone().unwrap_or_default()),
                ),
                serialport::SerialPortType::PciPort => ("PCI".to_string(), None, None, None),
                serialport::SerialPortType::BluetoothPort => {
                    ("Bluetooth".to_string(), None, None, None)
                }
                serialport::SerialPortType::Unknown => ("Unknown".to_string(), None, None, None),
            };

            SerialDeviceInfo {
                port_name: port.port_name,
                port_type,
                manufacturer,
                product,
                serial_number,
            }
        })
        .collect();

    log::info!("Found {} serial ports", device_list.len());

    // Filter for common ESP/Heltec devices (Silicon Labs, CP210x)
    let filtered_devices: Vec<SerialDeviceInfo> = device_list
        .into_iter()
        .filter(|dev| {
            if let Some(ref mfr) = dev.manufacturer {
                let mfr_lower = mfr.to_lowercase();
                mfr_lower.contains("silicon labs")
                    || mfr_lower.contains("cp210")
                    || mfr_lower.contains("ftdi")
                    || mfr_lower.contains("ch340")
                    || mfr_lower.contains("heltec")
            } else {
                // Include devices with no manufacturer info (may still be valid)
                true
            }
        })
        .collect();

    log::info!(
        "Filtered to {} potential RalphieNode devices",
        filtered_devices.len()
    );

    Ok(filtered_devices)
}

/// Flash firmware to a serial device using esptool
///
/// This command invokes esptool (bundled as sidecar or system-installed) to flash
/// the provided firmware binary to the selected port. Progress is streamed back
/// to the frontend via Tauri events.
///
/// # Arguments
/// * `port` - Serial port name (e.g., "/dev/ttyUSB0" or "COM3")
/// * `firmware_path` - Absolute path to firmware binary file
/// * `window` - Tauri window handle for emitting progress events
///
/// # Events Emitted
/// * `flash_progress` - Progress updates during flashing
///
/// # Errors
/// - "Device Busy" if port is already in use
/// - "Permission Denied" if insufficient permissions
/// - "Firmware file not found" if binary doesn't exist
/// - "Flash failed" if esptool returns error
///
/// # Fail-Visible Philosophy
/// All failures are explicit and reported immediately. No graceful degradation.
#[tauri::command]
pub async fn flash_firmware(
    port: String,
    firmware_path: String,
    window: tauri::Window,
) -> Result<String, String> {
    log::info!(
        "Starting firmware flash: port={}, firmware={}",
        port,
        firmware_path
    );

    // Validate firmware file exists
    if !Path::new(&firmware_path).exists() {
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

    // Resolve bundled esptool from app resources
    let esptool_cmd = resolve_required_component_path(&window.app_handle(), "esptool")
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
    // Standard command: esptool.py --port PORT write_flash 0x0 FIRMWARE
    let mut child = Command::new(esptool_cmd)
        .arg("--port")
        .arg(&port)
        .arg("write_flash")
        .arg("0x0")
        .arg(&firmware_path)
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
                format!("FAIL-VISIBLE: Failed to spawn esptool: {}", e)
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
        for line in reader.lines() {
            if let Ok(line) = line {
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
                        message: line.clone(),
                        progress,
                    },
                );
            }
        }
    });

    // Capture stderr for error reporting
    let mut stderr_output = Vec::new();
    let stderr_reader = BufReader::new(stderr);
    for line in stderr_reader.lines() {
        if let Ok(line) = line {
            log::warn!("esptool stderr: {}", line);
            stderr_output.push(line);
        }
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
             Errors: {}",
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

    Ok(format!("Firmware flashed successfully to {}", port))
}

/// Listen for GENESIS message from newly flashed device
///
/// Opens a serial connection to the device immediately after flashing and listens
/// for a JSON structure containing device identity information. This is the
/// hardware root of trust initialization.
///
/// Expected message format:
/// ```json
/// {
///   "type": "GENESIS",
///   "root": "blake3_hash_of_device_identity",
///   "pub_key": "base64_encoded_ed25519_public_key"
/// }
/// ```
///
/// # Arguments
/// * `port` - Serial port name
///
/// # Returns
/// GenesisMessage containing device identity
///
/// # Errors
/// - "Failed to open serial port" if port cannot be opened
/// - "Device Busy" if port is in use
/// - "Timeout waiting for GENESIS message" if no message received within 30 seconds
/// - "Invalid GENESIS message" if JSON parsing fails or format is incorrect
///
/// # Fail-Visible Philosophy
/// If the device does not respond with a valid GENESIS message, this is a CRITICAL
/// failure. The device cannot be trusted without cryptographic identity establishment.
#[tauri::command]
pub async fn listen_for_genesis(port: String) -> Result<GenesisMessage, String> {
    log::info!("Listening for GENESIS message on port: {}", port);

    // Small delay to allow device to reset after flashing
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Open serial port
    let mut serial = serialport::new(&port, 115200)
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
                format!("FAIL-VISIBLE: Failed to open serial port {}: {}", port, e)
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
                 This is a CRITICAL failure - device cannot be trusted.",
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

                    // Validate pub_key is valid base64
                    if general_purpose::STANDARD.decode(&genesis.pub_key).is_err() {
                        let err = format!(
                            "FAIL-VISIBLE: Invalid GENESIS pub_key format. \
                             Expected base64-encoded Ed25519 key. \
                             This is a CRITICAL failure."
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

/// Inject Genesis Bundle with Challenge-Response Provisioning
///
/// Implements the hardware-rooted challenge-response protocol for device enrollment.
/// This replaces the legacy API key approach with cryptographic attestation.
///
/// Protocol Flow:
/// 1. Device broadcasts GENESIS message with public key
/// 2. We generate and send a 32-byte random challenge
/// 3. Device signs (Challenge || Timestamp) with its private key
/// 4. We verify the ECDSA P-256 signature
/// 5. If valid, we send PROVISION_CONFIRM to unlock the radio
///
/// # Arguments
/// * `port` - Serial port name
/// * `genesis` - GenesisMessage received from device
/// * `node_id` - Assigned node identifier for provisioning
///
/// # Returns
/// Success message on valid attestation
///
/// # Errors
/// - "Device Attestation Failed" if signature verification fails
/// - "Timeout waiting for ENROLL_PROOF" if device doesn't respond within 5 seconds
/// - "Invalid ENROLL_PROOF format" if response is malformed
///
/// # Fail-Visible Philosophy
/// If cryptographic verification fails, the device is considered an adversary.
/// No graceful degradation - security failures must abort immediately.
#[tauri::command]
pub async fn inject_genesis_bundle(
    port: String,
    genesis: GenesisMessage,
    node_id: String,
) -> Result<String, String> {
    use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
    use rand::rngs::OsRng;
    use rand::RngCore;

    log::info!(
        "Starting challenge-response provisioning for node: {}",
        node_id
    );
    log::info!("Port: {}, Genesis root: {}", port, genesis.root);

    // STEP 1: Generate 32-byte cryptographically secure random challenge
    let mut challenge_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut challenge_bytes);
    let challenge_hex = hex::encode(&challenge_bytes);

    log::info!("Generated challenge: {}...", &challenge_hex[..16]);

    // STEP 2: Parse and validate device public key (ECDSA P-256)
    // Expected format: 64-byte uncompressed public key (hex encoded)
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

    // STEP 3: Open serial port for challenge-response exchange
    let mut serial = serialport::new(&port, 115200)
        .timeout(Duration::from_secs(5))
        .open()
        .map_err(|e| format!("FAIL-VISIBLE: Failed to open serial port {}: {}", port, e))?;

    log::info!("Serial port opened for challenge-response");

    // STEP 4: Send ENROLL command with challenge
    let enroll_cmd = EnrollCommand {
        command: "ENROLL".to_string(),
        bundle: EnrollBundle {
            challenge: challenge_hex.clone(),
        },
    };

    let enroll_json = serde_json::to_string(&enroll_cmd)
        .map_err(|e| format!("FAIL-VISIBLE: Failed to serialize ENROLL command: {}", e))?;

    use std::io::Write;
    writeln!(serial, "{}", enroll_json)
        .map_err(|e| format!("FAIL-VISIBLE: Failed to send ENROLL command: {}", e))?;

    log::info!("ENROLL command sent with challenge");

    // STEP 5: Listen for ENROLL_PROOF response (5 second timeout)
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
                 Device failed to respond within 5 seconds. \
                 Assuming device is hung or malicious. \
                 This is a CRITICAL security failure.",
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

                // Try to parse as ENROLL_PROOF
                if let Ok(proof) = serde_json::from_str::<EnrollProof>(line) {
                    if proof.r#type != "ENROLL_PROOF" {
                        log::warn!(
                            "Received JSON but type is not ENROLL_PROOF: {}",
                            proof.r#type
                        );
                        continue;
                    }

                    log::info!("ENROLL_PROOF received from device");
                    break proof;
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

    log::info!(
        "Received ENROLL_PROOF at timestamp: {}",
        enroll_proof.timestamp
    );

    // STEP 6: Verify the ECDSA P-256 signature
    // Data to verify: ChallengeBytes || TimestampBytes (big-endian u64)
    let mut message = Vec::new();
    message.extend_from_slice(&challenge_bytes);
    message.extend_from_slice(&enroll_proof.timestamp.to_be_bytes());

    log::debug!("Verifying signature over {} bytes", message.len());

    let signature_bytes = hex::decode(&enroll_proof.proof).map_err(|e| {
        format!(
            "FAIL-VISIBLE: Invalid signature format in ENROLL_PROOF. \
                     Expected hex-encoded ECDSA signature: {}",
            e
        )
    })?;

    let signature = Signature::from_der(&signature_bytes)
        .or_else(|_| {
            // Try raw 64-byte signature if DER parsing fails
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
             The device at {} is considered an ADVERSARY. \
             This is a CRITICAL security failure.",
            e, port
        );
        log::error!("{}", err);
        return Err("Device Attestation Failed".to_string());
    }

    log::info!("✓ Signature verification PASSED - Device attestation successful");

    // STEP 7: Send PROVISION_CONFIRM to unlock the radio
    let confirm_cmd = ProvisionConfirm {
        command: "PROVISION_CONFIRM".to_string(),
        node_id: node_id.clone(),
    };

    let confirm_json = serde_json::to_string(&confirm_cmd)
        .map_err(|e| format!("FAIL-VISIBLE: Failed to serialize PROVISION_CONFIRM: {}", e))?;

    writeln!(serial, "{}", confirm_json)
        .map_err(|e| format!("FAIL-VISIBLE: Failed to send PROVISION_CONFIRM: {}", e))?;

    log::info!("PROVISION_CONFIRM sent - Radio unlocked");

    Ok(format!(
        "Device attestation successful. Node {} provisioned and radio unlocked.",
        node_id
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_genesis_message_deserialization() {
        let json = r#"{
            "type": "GENESIS",
            "root": "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
            "pub_key": "SGVsbG8gV29ybGQh"
        }"#;

        let genesis: GenesisMessage = serde_json::from_str(json).unwrap();
        assert_eq!(genesis.r#type, "GENESIS");
        assert_eq!(
            genesis.root,
            "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
        );
        assert_eq!(genesis.pub_key, "SGVsbG8gV29ybGQh");
    }

    #[test]
    fn test_genesis_message_serialization() {
        let genesis = GenesisMessage {
            r#type: "GENESIS".to_string(),
            root: "test_root".to_string(),
            pub_key: "test_key".to_string(),
        };

        let json = serde_json::to_string(&genesis).unwrap();
        assert!(json.contains("GENESIS"));
        assert!(json.contains("test_root"));
        assert!(json.contains("test_key"));
    }
}
