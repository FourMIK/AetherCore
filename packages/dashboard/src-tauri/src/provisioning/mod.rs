//! Unified Provisioning Module
//!
//! Provides a single entry point for provisioning both Tethered (USB/Arduino)
//! and Remote (Network/Pi) assets with consistent interface and response format.
//!
//! This module implements the "provision_node" command that handles:
//! - Device discovery (USB and network)
//! - Firmware flashing (USB devices)
//! - Remote installation (Network devices via SSH)
//! - Hardware-rooted identity attestation
//!
//! # Fail-Visible Philosophy
//! All failures are explicit with operator-friendly error messages:
//! - "Bad Password" for SSH authentication failures
//! - "Check Cable" for serial connection failures
//! - "Device Busy" for port contention
//! - "Attestation Failed" for cryptographic verification failures

pub mod flasher;
pub mod injector;
pub mod scanner;

use crate::commands::resolve_required_component_path;
pub use scanner::{CandidateNode, Credentials};
use serde::{Deserialize, Serialize};
use std::path::Path;

const SUPPORTED_FIRMWARE_COMPONENTS: &[(&str, &str)] = &[
    ("heltec-v3", "firmware-heltec-v3-bin"),
    ("esp32-generic", "firmware-esp32-generic-bin"),
    ("rp2040-uf2", "firmware-rp2040-uf2"),
];

/// Unified provisioning response
/// This structure is returned regardless of hardware type (USB or Network)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvisioningResult {
    pub status: String, // "SUCCESS" or "FAILURE"
    pub identity: IdentityBlock,
}

/// Identity block containing device identity information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityBlock {
    pub node_id: String,
    pub public_key: String,
    pub root_hash: String,
    pub timestamp: u64,
    pub device_type: String, // "USB" or "NET"
}

/// Provision a target device (unified command)
///
/// This is the primary entry point for provisioning any device type.
/// Routes to appropriate handler based on target.type:
/// - "USB" -> Serial flashing with flasher module
/// - "NET" -> SSH injection with injector module
///
/// # Arguments
/// * `target` - CandidateNode from scan_for_assets
/// * `credentials` - Optional credentials for network devices (required for NET type)
/// * `firmware_path` - Optional firmware path for USB devices (required for USB type)
/// * `window` - Tauri window for progress events
///
/// # Returns
/// ProvisioningResult with consistent format regardless of device type
///
/// # Errors
/// - "Missing credentials" if NET device without credentials
/// - "Missing firmware_path" if USB device without firmware
/// - "Unsupported device type" if type is neither USB nor NET
/// - Device-specific errors (see flasher and injector modules)
///
/// # Fail-Visible Philosophy
/// Routing errors are explicit. Provisioning errors bubble up from
/// underlying modules with clear failure reasons.
#[tauri::command]
pub async fn provision_target(
    target: CandidateNode,
    credentials: Option<Credentials>,
    firmware_path: Option<String>,
    window: tauri::Window,
    app_handle: tauri::AppHandle,
) -> Result<ProvisioningResult, String> {
    log::info!("Starting unified provisioning for target: {:?}", target);

    match target.r#type.as_str() {
        "USB" => {
            // USB device: firmware path is optional when hardware profile can be auto-resolved.
            provision_usb_device(&app_handle, &target, firmware_path, window).await
        }
        "NET" => {
            // Network device: requires credentials
            let creds = credentials.ok_or_else(|| {
                "FAIL-VISIBLE: Missing credentials for network device provisioning".to_string()
            })?;

            provision_network_device(&app_handle, &target, creds).await
        }
        _ => Err(format!(
            "FAIL-VISIBLE: Unsupported device type: {}. \
                 Expected 'USB' or 'NET'.",
            target.r#type
        )),
    }
}

/// Provision USB device (tethered)
async fn provision_usb_device(
    app_handle: &tauri::AppHandle,
    target: &CandidateNode,
    firmware_path: Option<String>,
    window: tauri::Window,
) -> Result<ProvisioningResult, String> {
    log::info!("Provisioning USB device: {} ({})", target.label, target.id);

    let resolved_firmware_path = resolve_firmware_for_target(app_handle, target, firmware_path)?;
    let transport = target.transport.as_deref().unwrap_or("usb-serial");

    // Use flasher module to flash and provision
    let identity = match transport {
        "usb-serial" | "bluetooth-serial" => {
            flasher::flash_and_provision(target.id.clone(), resolved_firmware_path, window).await?
        }
        "usb-mass-storage" => {
            flasher::flash_mass_storage_and_provision(
                target.id.clone(),
                resolved_firmware_path,
                window,
            )
            .await?
        }
        unsupported => {
            return Err(format!(
                "FAIL-VISIBLE: Unsupported USB transport '{}'. Expected 'usb-serial' or \
                 'bluetooth-serial' or 'usb-mass-storage'.",
                unsupported
            ));
        }
    };

    // Convert to unified response format
    Ok(ProvisioningResult {
        status: "SUCCESS".to_string(),
        identity: IdentityBlock {
            node_id: identity.node_id,
            public_key: identity.public_key,
            root_hash: identity.root_hash,
            timestamp: identity.timestamp,
            device_type: "USB".to_string(),
        },
    })
}

fn resolve_firmware_for_target(
    app_handle: &tauri::AppHandle,
    target: &CandidateNode,
    firmware_path: Option<String>,
) -> Result<String, String> {
    if let Some(manual_path) = firmware_path {
        let trimmed = manual_path.trim();
        if !trimmed.is_empty() {
            if !Path::new(trimmed).exists() {
                return Err(format!(
                    "FAIL-VISIBLE: Supplied firmware path does not exist: {}",
                    trimmed
                ));
            }
            return Ok(trimmed.to_string());
        }
    }

    let profile = target.hardware_profile.as_deref().ok_or_else(|| {
        "FAIL-VISIBLE: Cannot auto-select firmware because device hardware profile is unknown. \
         Provide firmware path manually or reconnect supported hardware."
            .to_string()
    })?;

    let component_id = firmware_component_for_profile(profile).ok_or_else(|| {
        format!(
            "FAIL-VISIBLE: No bundled firmware profile for '{}'. Supported profiles: {}",
            profile,
            supported_profiles_list()
        )
    })?;

    let resolved = resolve_required_component_path(app_handle, component_id).map_err(|e| {
        format!(
            "FAIL-VISIBLE: Bundled firmware component '{}' missing or corrupt: {}",
            component_id, e
        )
    })?;

    if !resolved.is_file() {
        return Err(format!(
            "FAIL-VISIBLE: Firmware component '{}' is not a file: {}",
            component_id,
            resolved.display()
        ));
    }

    Ok(resolved.to_string_lossy().to_string())
}

fn firmware_component_for_profile(profile: &str) -> Option<&'static str> {
    SUPPORTED_FIRMWARE_COMPONENTS
        .iter()
        .find(|(supported_profile, _)| *supported_profile == profile)
        .map(|(_, component_id)| *component_id)
}

fn supported_profiles_list() -> String {
    SUPPORTED_FIRMWARE_COMPONENTS
        .iter()
        .map(|(profile, _)| *profile)
        .collect::<Vec<_>>()
        .join(", ")
}

/// Provision network device (remote)
async fn provision_network_device(
    app_handle: &tauri::AppHandle,
    target: &CandidateNode,
    credentials: Credentials,
) -> Result<ProvisioningResult, String> {
    log::info!(
        "Provisioning network device: {} ({})",
        target.label,
        target.id
    );

    // Use injector module to SSH and provision
    let identity = injector::inject_pi(
        app_handle,
        target.id.clone(),
        credentials.username,
        credentials.password,
    )
    .await?;

    // Convert to unified response format
    Ok(ProvisioningResult {
        status: "SUCCESS".to_string(),
        identity: IdentityBlock {
            node_id: identity.node_id,
            public_key: identity.public_key,
            root_hash: identity.root_hash,
            timestamp: identity.timestamp,
            device_type: "NET".to_string(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provisioning_result_serialization() {
        let result = ProvisioningResult {
            status: "SUCCESS".to_string(),
            identity: IdentityBlock {
                node_id: "node_abc123".to_string(),
                public_key: "test_key".to_string(),
                root_hash: "blake3_hash".to_string(),
                timestamp: 1234567890,
                device_type: "USB".to_string(),
            },
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("SUCCESS"));
        assert!(json.contains("node_abc123"));
        assert!(json.contains("USB"));
    }

    #[test]
    fn test_identity_block_deserialization() {
        let json = r#"{
            "node_id": "node_xyz789",
            "public_key": "key123",
            "root_hash": "hash456",
            "timestamp": 9876543210,
            "device_type": "NET"
        }"#;

        let identity: IdentityBlock = serde_json::from_str(json).unwrap();
        assert_eq!(identity.node_id, "node_xyz789");
        assert_eq!(identity.device_type, "NET");
    }

    #[test]
    fn test_firmware_component_for_profile() {
        assert_eq!(
            firmware_component_for_profile("heltec-v3"),
            Some("firmware-heltec-v3-bin")
        );
        assert_eq!(
            firmware_component_for_profile("esp32-generic"),
            Some("firmware-esp32-generic-bin")
        );
        assert_eq!(
            firmware_component_for_profile("rp2040-uf2"),
            Some("firmware-rp2040-uf2")
        );
        assert_eq!(firmware_component_for_profile("unknown-profile"), None);
    }
}
