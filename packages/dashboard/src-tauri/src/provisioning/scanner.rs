//! Asset Discovery Scanner
//!
//! Unified scanning for both Tethered (USB/Arduino) and Remote (Network/Pi) assets.
//! Implements mDNS service discovery for network devices and USB enumeration for
//! tethered devices.
//!
//! Security: All discovered assets are candidates only - identity verification
//! occurs during the provisioning protocol.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
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
    /// Transport hint for provisioning router
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>, // "usb-serial" | "bluetooth-serial" | "usb-mass-storage" | "network"
    /// Detected hardware profile used for firmware auto-selection
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hardware_profile: Option<String>, // e.g. "esp32-generic" | "heltec-v3" | "rp2040-uf2"
}

/// Credentials for network device provisioning
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

/// Scan for all provisionable assets (USB Serial, USB Mass Storage, and Network)
///
/// This function performs parallel discovery of:
/// 1. USB serial devices (Arduino, Heltec, ESP32)
/// 2. Bluetooth serial endpoints exposed by the host OS
/// 3. USB mass-storage boot devices (UF2/RP2040 style)
/// 4. Network devices via mDNS (Raspberry Pi running aethercore service)
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

    // PHASE 1: Scan USB/Bluetooth Serial Devices
    match scan_usb_devices().await {
        Ok(usb_nodes) => {
            log::info!("Found {} tethered serial devices", usb_nodes.len());
            candidates.extend(usb_nodes);
        }
        Err(e) => {
            log::warn!("Tethered serial scan failed: {}", e);
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

    // PHASE 3: Scan USB Mass-Storage Devices (UF2 boot drives)
    match scan_usb_mass_storage_devices().await {
        Ok(storage_nodes) => {
            log::info!("Found {} USB mass-storage devices", storage_nodes.len());
            candidates.extend(storage_nodes);
        }
        Err(e) => {
            log::warn!("USB mass-storage scan failed: {}", e);
            // Non-fatal: return other results if available
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
        let (label, profile, transport) = match &port.port_type {
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
                        // Create label from manufacturer and product and derive hardware profile.
                        let product = info.product.as_deref().unwrap_or("Unknown");
                        (
                            format!("{} {}", mfr, product),
                            detect_usb_serial_profile(
                                info.manufacturer.as_deref(),
                                info.product.as_deref(),
                                &port.port_name,
                            ),
                            "usb-serial".to_string(),
                        )
                    } else {
                        continue; // Skip non-target devices
                    }
                } else {
                    // No manufacturer info, but include as potential candidate
                    (
                        "Unknown USB Device".to_string(),
                        detect_usb_serial_profile(None, None, &port.port_name),
                        "usb-serial".to_string(),
                    )
                }
            }
            SerialPortType::BluetoothPort => (
                format!("Bluetooth Serial ({})", port.port_name),
                detect_bluetooth_serial_profile(&port.port_name),
                "bluetooth-serial".to_string(),
            ),
            _ => continue, // Skip non-serial and unsupported ports
        };

        usb_nodes.push(CandidateNode {
            r#type: "USB".to_string(),
            id: port.port_name.clone(),
            label,
            transport: Some(transport),
            hardware_profile: profile,
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
                                transport: Some("network".to_string()),
                                hardware_profile: Some("raspberry-pi-aethercore".to_string()),
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
            Err(e) => {
                if e.to_string().to_lowercase().contains("timeout") {
                    // Continue waiting during scan window.
                    continue;
                }
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

/// Scan for USB mass-storage devices used by UF2 bootloaders.
///
/// Fail-visible behavior:
/// - Only drives that present explicit UF2/RP2040 markers are considered candidates.
/// - Generic drives are ignored to prevent accidental flashing to non-target media.
async fn scan_usb_mass_storage_devices() -> Result<Vec<CandidateNode>, String> {
    let mut nodes: Vec<CandidateNode> = Vec::new();
    let mut seen_mounts = HashSet::new();

    for mount in candidate_mount_points() {
        if !mount.is_dir() {
            continue;
        }

        let info_uf2_path = mount.join("INFO_UF2.TXT");
        let info_uf2_contents = fs::read_to_string(&info_uf2_path).ok();
        let mount_label = mount
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_string())
            .unwrap_or_else(|| mount.to_string_lossy().to_string());

        let profile = detect_mass_storage_profile(&mount_label, info_uf2_contents.as_deref());
        let Some(profile) = profile else {
            continue;
        };

        let mount_id = mount.to_string_lossy().to_string();
        if !seen_mounts.insert(mount_id.clone()) {
            continue;
        }

        nodes.push(CandidateNode {
            r#type: "USB".to_string(),
            id: mount_id,
            label: format!("UF2 Boot Drive ({})", mount_label),
            transport: Some("usb-mass-storage".to_string()),
            hardware_profile: Some(profile),
        });
    }

    Ok(nodes)
}

fn candidate_mount_points() -> Vec<PathBuf> {
    let mut mounts: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            let path = PathBuf::from(drive);
            if path.exists() {
                mounts.push(path);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        mounts.extend(list_directories(Path::new("/Volumes")));
    }

    #[cfg(target_os = "linux")]
    {
        mounts.extend(list_directories(Path::new("/media")));
        mounts.extend(list_directories(Path::new("/mnt")));

        // /run/media often contains /run/media/<user>/<volume>
        for user_mount in list_directories(Path::new("/run/media")) {
            mounts.push(user_mount.clone());
            mounts.extend(list_directories(&user_mount));
        }
    }

    mounts
}

fn list_directories(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };

    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect()
}

fn detect_usb_serial_profile(
    manufacturer: Option<&str>,
    product: Option<&str>,
    port_name: &str,
) -> Option<String> {
    let descriptor = format!(
        "{} {} {}",
        manufacturer.unwrap_or_default(),
        product.unwrap_or_default(),
        port_name
    )
    .to_lowercase();

    if descriptor.contains("heltec") {
        return Some("heltec-v3".to_string());
    }

    if descriptor.contains("rp2040")
        || descriptor.contains("pico")
        || descriptor.contains("raspberry pi pico")
    {
        return Some("rp2040-uf2".to_string());
    }

    if descriptor.contains("esp32")
        || descriptor.contains("cp210")
        || descriptor.contains("ftdi")
        || descriptor.contains("ch340")
        || descriptor.contains("silicon labs")
        || descriptor.contains("arduino")
    {
        return Some("esp32-generic".to_string());
    }

    None
}

fn detect_mass_storage_profile(volume_label: &str, info_uf2: Option<&str>) -> Option<String> {
    let descriptor = format!("{} {}", volume_label, info_uf2.unwrap_or_default()).to_lowercase();

    if descriptor.contains("uf2")
        || descriptor.contains("rp2040")
        || descriptor.contains("pico")
        || descriptor.contains("ralphie")
    {
        return Some("rp2040-uf2".to_string());
    }

    None
}

fn detect_bluetooth_serial_profile(port_name: &str) -> Option<String> {
    let descriptor = port_name.to_lowercase();

    if descriptor.contains("esp32") || descriptor.contains("heltec") || descriptor.contains("ralphie")
    {
        return Some("esp32-generic".to_string());
    }

    if descriptor.contains("rp2040") || descriptor.contains("pico") {
        return Some("rp2040-uf2".to_string());
    }

    None
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
            transport: Some("usb-serial".to_string()),
            hardware_profile: Some("heltec-v3".to_string()),
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
        assert_eq!(node.transport, None);
        assert_eq!(node.hardware_profile, None);
    }

    #[test]
    fn test_detect_usb_serial_profile() {
        let profile =
            detect_usb_serial_profile(Some("Silicon Labs"), Some("CP2102 USB to UART"), "COM7");
        assert_eq!(profile.as_deref(), Some("esp32-generic"));

        let heltec =
            detect_usb_serial_profile(Some("Heltec"), Some("WiFi LoRa 32"), "/dev/ttyUSB0");
        assert_eq!(heltec.as_deref(), Some("heltec-v3"));
    }

    #[test]
    fn test_detect_mass_storage_profile() {
        let profile = detect_mass_storage_profile("RPI-RP2", Some("UF2 Bootloader"));
        assert_eq!(profile.as_deref(), Some("rp2040-uf2"));

        let no_match = detect_mass_storage_profile("DATA_DRIVE", None);
        assert_eq!(no_match, None);
    }

    #[test]
    fn test_detect_bluetooth_serial_profile() {
        let esp32 = detect_bluetooth_serial_profile("ESP32-RALPHIE-BT");
        assert_eq!(esp32.as_deref(), Some("esp32-generic"));

        let unknown = detect_bluetooth_serial_profile("BT-COM5");
        assert_eq!(unknown, None);
    }
}
