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

pub mod scanner;
pub mod injector;
pub mod flasher;

use serde::{Deserialize, Serialize};
pub use scanner::{CandidateNode, Credentials};
pub use injector::GenesisIdentity;

/// Unified provisioning response
/// This structure is returned regardless of hardware type (USB or Network)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvisioningResult {
    pub status: String,           // "SUCCESS" or "FAILURE"
    pub identity: IdentityBlock,
}

/// Identity block containing device identity information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityBlock {
    pub node_id: String,
    pub public_key: String,
    pub root_hash: String,
    pub timestamp: u64,
    pub device_type: String,      // "USB" or "NET"
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
) -> Result<ProvisioningResult, String> {
    log::info!("Starting unified provisioning for target: {:?}", target);
    
    match target.r#type.as_str() {
        "USB" => {
            // USB device: requires firmware_path
            let fw_path = firmware_path.ok_or_else(|| {
                "FAIL-VISIBLE: Missing firmware_path for USB device provisioning".to_string()
            })?;
            
            provision_usb_device(&target, &fw_path, window).await
        }
        "NET" => {
            // Network device: requires credentials
            let creds = credentials.ok_or_else(|| {
                "FAIL-VISIBLE: Missing credentials for network device provisioning".to_string()
            })?;
            
            provision_network_device(&target, creds).await
        }
        _ => {
            Err(format!(
                "FAIL-VISIBLE: Unsupported device type: {}. \
                 Expected 'USB' or 'NET'.",
                target.r#type
            ))
        }
    }
}

/// Provision USB device (tethered)
async fn provision_usb_device(
    target: &CandidateNode,
    firmware_path: &str,
    window: tauri::Window,
) -> Result<ProvisioningResult, String> {
    log::info!("Provisioning USB device: {} ({})", target.label, target.id);
    
    // Use flasher module to flash and provision
    let identity = flasher::flash_and_provision(
        target.id.clone(),
        firmware_path.to_string(),
        window,
    ).await?;
    
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

/// Provision network device (remote)
async fn provision_network_device(
    target: &CandidateNode,
    credentials: Credentials,
) -> Result<ProvisioningResult, String> {
    log::info!("Provisioning network device: {} ({})", target.label, target.id);
    
    // Use injector module to SSH and provision
    let identity = injector::inject_pi(
        target.id.clone(),
        credentials.username,
        credentials.password,
    ).await?;
    
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

// Re-export scanner command for backwards compatibility
pub use scanner::scan_for_assets;

// Re-export legacy commands for backwards compatibility
// These will be deprecated in favor of unified provision_target
pub use crate::provisioning_legacy::{
    list_serial_ports,
    flash_firmware,
    listen_for_genesis,
    inject_genesis_bundle,
};

// Also export legacy types that may be used by frontend
pub use crate::provisioning_legacy::{
    SerialDeviceInfo,
    GenesisMessage,
    FlashProgress,
};

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
}
