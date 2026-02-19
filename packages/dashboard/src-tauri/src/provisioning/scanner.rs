//! Asset Discovery Scanner
//!
//! Unified scanning for both Tethered (USB/Arduino) and Remote (Network/Pi) assets.
//! Implements mDNS service discovery for network devices and USB enumeration for
//! tethered devices.
//!
//! Security: All discovered assets are candidates only - identity verification
//! occurs during the provisioning protocol.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Unified candidate node representation
/// Represents discovered hardware that may be provisioned
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandidateNode {
    /// Type of node: "USB" for tethered, "NET" for network
    pub r#type: String,
    /// Identifier: port name (e.g., "COM3", "/dev/ttyUSB0") or IP address
    pub id: String,
    /// Human-readable label for UI display
    pub label: String,
}

/// Credentials for network device provisioning
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

/// Scan for all provisionable assets (USB and Network)
///
/// This function performs parallel discovery of:
/// 1. USB serial devices (Arduino, Heltec, ESP32)
/// 2. Network devices via mDNS (Raspberry Pi running aethercore service)
///
/// # Returns
/// Unified list of CandidateNode objects representing all discovered assets
///
/// # Errors
/// - "Failed to scan USB devices" if serial port enumeration fails
/// - "Failed to scan network" if mDNS discovery fails (non-fatal)
///
/// # Fail-Visible Philosophy
/// Discovery failures are logged but don't prevent returning partial results.
/// However, provisioning failures must be explicit.
#[tauri::command]
pub async fn scan_for_assets() -> Result<Vec<CandidateNode>, String> {
    log::info!("Starting unified asset discovery scan");

    let mut candidates = Vec::new();

    // PHASE 1: Scan USB Serial Devices
    match scan_usb_devices().await {
        Ok(usb_nodes) => {
            log::info!("Found {} USB devices", usb_nodes.len());
            candidates.extend(usb_nodes);
        }
        Err(e) => {
            log::warn!("USB scan failed: {}", e);
            // Non-fatal: continue to network scan
        }
    }

    // PHASE 2: Scan Network Devices via mDNS
    match scan_network_devices().await {
        Ok(net_nodes) => {
            log::info!("Found {} network devices", net_nodes.len());
            candidates.extend(net_nodes);
        }
        Err(e) => {
            log::warn!("Network scan failed: {}", e);
            // Non-fatal: return USB results if available
        }
    }

    log::info!("Asset scan complete: {} total candidates", candidates.len());

    Ok(candidates)
}

/// Scan for USB serial devices
async fn scan_usb_devices() -> Result<Vec<CandidateNode>, String> {
    use serialport::SerialPortType;

    let ports = serialport::available_ports()
        .map_err(|e| format!("Failed to enumerate serial ports: {}", e))?;

    let mut usb_nodes = Vec::new();

    for port in ports {
        let label = match &port.port_type {
            SerialPortType::UsbPort(info) => {
                // Check if it's a likely candidate (ESP, Heltec, Arduino)
                if let Some(ref mfr) = info.manufacturer {
                    let mfr_lower = mfr.to_lowercase();
                    if mfr_lower.contains("silicon labs")
                        || mfr_lower.contains("cp210")
                        || mfr_lower.contains("ftdi")
                        || mfr_lower.contains("ch340")
                        || mfr_lower.contains("heltec")
                        || mfr_lower.contains("arduino")
                    {
                        // Create label from manufacturer and product
                        let product = info.product.as_deref().unwrap_or("Unknown");
                        format!("{} {}", mfr, product)
                    } else {
                        continue; // Skip non-target devices
                    }
                } else {
                    // No manufacturer info, but include as potential candidate
                    "Unknown USB Device".to_string()
                }
            }
            _ => continue, // Skip non-USB ports
        };

        usb_nodes.push(CandidateNode {
            r#type: "USB".to_string(),
            id: port.port_name.clone(),
            label,
        });
    }

    Ok(usb_nodes)
}

/// Scan for network devices via mDNS
async fn scan_network_devices() -> Result<Vec<CandidateNode>, String> {
    use mdns_sd::{ServiceDaemon, ServiceEvent};

    log::info!("Starting mDNS discovery for _aethercore._tcp.local");

    // Create mDNS daemon
    let mdns = ServiceDaemon::new().map_err(|e| format!("Failed to create mDNS daemon: {}", e))?;

    // Browse for AetherCore services
    let service_type = "_aethercore._tcp.local.";
    let receiver = mdns
        .browse(service_type)
        .map_err(|e| format!("Failed to start mDNS browse: {}", e))?;

    let mut net_nodes = Vec::new();
    let timeout = Duration::from_secs(3); // 3 second scan window
    let start = std::time::Instant::now();

    // Collect discovered services within timeout
    while start.elapsed() < timeout {
        match receiver.recv_timeout(Duration::from_millis(500)) {
            Ok(event) => {
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        log::info!(
                            "Discovered service: {} at {:?}",
                            info.get_fullname(),
                            info.get_addresses()
                        );

                        // Extract IP address
                        if let Some(addr) = info.get_addresses().iter().next() {
                            let ip = addr.to_string();
                            let label = format!("Raspberry Pi ({})", info.get_hostname());

                            net_nodes.push(CandidateNode {
                                r#type: "NET".to_string(),
                                id: ip,
                                label,
                            });
                        }
                    }
                    ServiceEvent::SearchStarted(_) => {
                        log::debug!("mDNS search started");
                    }
                    ServiceEvent::SearchStopped(_) => {
                        log::debug!("mDNS search stopped");
                        break;
                    }
                    _ => {}
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // Continue waiting
            }
            Err(e) => {
                log::warn!("mDNS receive error: {}", e);
                break;
            }
        }
    }

    // Shutdown mDNS daemon
    if let Err(e) = mdns.shutdown() {
        log::warn!("Failed to shutdown mDNS daemon: {}", e);
    }

    log::info!("mDNS scan complete: {} devices found", net_nodes.len());

    Ok(net_nodes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_candidate_node_serialization() {
        let node = CandidateNode {
            r#type: "USB".to_string(),
            id: "COM3".to_string(),
            label: "Heltec V3".to_string(),
        };

        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("USB"));
        assert!(json.contains("COM3"));
        assert!(json.contains("Heltec"));
    }

    #[test]
    fn test_candidate_node_deserialization() {
        let json = r#"{"type":"NET","id":"192.168.1.50","label":"Raspberry Pi"}"#;
        let node: CandidateNode = serde_json::from_str(json).unwrap();

        assert_eq!(node.r#type, "NET");
        assert_eq!(node.id, "192.168.1.50");
        assert!(node.label.contains("Pi"));
    }
}
