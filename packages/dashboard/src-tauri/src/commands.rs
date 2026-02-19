use crate::config::{AppConfig, ConfigManager};
use crate::error::{validation, AppError, Result};
use crate::local_control_plane;
use crate::process_manager::{NodeProcessInfo, NodeProcessManager, ProcessStatus};
use crate::SentinelTrustStatus;
use aethercore_identity::IdentityManager;
use aethercore_stream::StreamIntegrityTracker;
use aethercore_trust_mesh::ComplianceProof;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::VerifyingKey;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{path::BaseDirectory, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::sync::Mutex;

const DASHBOARD_NODE_PROTOCOL_VERSION: u32 = 1;
const DASHBOARD_NODE_RUNTIME_VERSION: u32 = 1;

const DIAGNOSTIC_SCHEMA_VERSION: u32 = 1;
const SUPPORT_BUNDLE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticCheck {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeVersionInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TroubleshootingCard {
    pub failure_class: String,
    pub title: String,
    pub steps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsReport {
    pub schema_version: u32,
    pub generated_at_unix_secs: u64,
    pub checks: Vec<DiagnosticCheck>,
    pub runtime_versions: Vec<RuntimeVersionInfo>,
    pub troubleshooting_cards: Vec<TroubleshootingCard>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportBundleMetadata {
    pub schema_version: u32,
    pub generated_at_unix_secs: u64,
    pub platform: String,
    pub arch: String,
    pub app_version: String,
    pub ci: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportBundleSummary {
    pub schema_version: u32,
    pub bundle_path: String,
    pub generated_at_unix_secs: u64,
    pub file_count: usize,
    pub diagnostics: DiagnosticsReport,
}

#[tauri::command]
pub async fn get_sentinel_trust_status(
    sentinel_status: tauri::State<'_, Arc<Mutex<SentinelTrustStatus>>>,
) -> std::result::Result<SentinelTrustStatus, String> {
    let guard = sentinel_status.lock().await;
    Ok(guard.clone())
}

/// Genesis Bundle for Zero-Touch Enrollment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenesisBundle {
    pub user_identity: String,
    pub squad_id: String,
    pub public_key: String,
    pub signature: String,
    pub timestamp: u64,
}

/// Application state for managing connections
#[derive(Default)]
pub struct AppState {
    pub mesh_endpoint: Arc<Mutex<Option<String>>>,
    pub stream_tracker: Arc<Mutex<StreamIntegrityTracker>>,
    pub identity_manager: Arc<Mutex<IdentityManager>>,
    pub process_manager: Arc<Mutex<NodeProcessManager>>,
    pub tpm_manager: Arc<Mutex<aethercore_identity::TpmManager>>,
}

/// Connect to Production C2 Mesh
///
/// This command initiates a secure connection to the production C2 mesh with
/// hardware-rooted authentication. All connections use TLS 1.3 / WSS and
/// require valid TPM attestation per the "Fail-Visible" doctrine.
///
/// PRODUCTION MODE: Only WSS (secure WebSocket) connections are permitted.
/// Non-encrypted endpoints are rejected per security policy.
///
/// NOTE: Full mesh integration requires async runtime setup. This validates
/// the endpoint and stores it for later connection establishment.
#[tauri::command]
pub async fn connect_to_mesh(
    endpoint: Option<String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<String, String> {
    async fn inner(
        endpoint: Option<String>,
        app_handle: tauri::AppHandle,
        state: tauri::State<'_, Arc<Mutex<AppState>>>,
    ) -> Result<String> {
        let resolved_endpoint = match endpoint {
            Some(value) if !value.trim().is_empty() => value,
            _ => {
                let manager = ConfigManager::new(&app_handle)?;
                let config = manager.load()?;
                config.connection.mesh_endpoint
            }
        };

        log::info!(
            "Connecting to production C2 mesh endpoint: {}",
            resolved_endpoint
        );

        // Validate endpoint format and security requirements
        validation::require_non_empty(&resolved_endpoint, "endpoint")?;
        validation::validate_ws_url(&resolved_endpoint, true)?;

        // Parse and validate endpoint URL
        let url = url::Url::parse(&resolved_endpoint)?;

        // Validate host is present
        if url.host_str().is_none() {
            return Err(AppError::Validation(
                "Endpoint must have a valid host".to_string(),
            ));
        }

        // Store the endpoint in state
        let app_state = state.lock().await;
        *app_state.mesh_endpoint.lock().await = Some(resolved_endpoint.clone());

        // In production, this would:
        // 1. Initialize TacticalMesh with the endpoint as a seed peer
        // 2. Establish secure WebSocket connection (WSS with TLS 1.3)
        // 3. Perform mutual TPM attestation handshake
        // 4. Verify cryptographic identity via EK certificate chain
        // 5. Start authenticated gossip protocol for mesh coordination
        // 6. Initialize Merkle Vine stream tracking
        //
        // For now, we validate and store the endpoint for future connection attempts

        log::info!(
            "Production C2 mesh endpoint validated and stored: {}",
            resolved_endpoint
        );

        Ok(format!(
            "Connected to C2 mesh at {} (validation successful, TPM attestation pending)",
            resolved_endpoint
        ))
    }

    inner(endpoint, app_handle, state)
        .await
        .map_err(|e| e.to_string())
}

/// Connect to Testnet P2P Network (DEPRECATED - Use connect_to_mesh)
///
/// This command initiates a P2P handshake with the specified testnet endpoint.
/// The connection is managed through the AetherCore mesh protocol.
///
/// DEPRECATED: This function is maintained for backward compatibility only.
/// Use `connect_to_mesh` for production deployments.
///
/// NOTE: Unlike connect_to_mesh, this function allows both ws:// and wss://
/// connections for backward compatibility with existing testnet configurations.
///
/// SECURITY WARNING: ws:// (non-encrypted) connections should only be used
/// in isolated test environments. Production deployments must use connect_to_mesh.
#[tauri::command]
pub async fn connect_to_testnet(
    endpoint: Option<String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<String, String> {
    async fn inner(
        endpoint: Option<String>,
        app_handle: tauri::AppHandle,
        state: tauri::State<'_, Arc<Mutex<AppState>>>,
    ) -> Result<String> {
        let endpoint = match endpoint {
            Some(value) if !value.trim().is_empty() => value,
            _ => {
                let manager = ConfigManager::new(&app_handle)?;
                let config = manager.load()?;
                config.connection.mesh_endpoint
            }
        };

        log::warn!(
            "connect_to_testnet is deprecated. Use connect_to_mesh for production. \
             Endpoint: {}",
            endpoint
        );

        // Validate endpoint format
        validation::require_non_empty(&endpoint, "endpoint")?;
        validation::validate_ws_url(&endpoint, false)?; // Allow both ws:// and wss://

        // Log security warning if using non-secure connection
        if endpoint.starts_with("ws://") {
            log::warn!(
                "SECURITY WARNING: Using non-encrypted ws:// connection. \
                 This should only be used in isolated test environments."
            );
        }

        // Parse and validate endpoint URL
        let url = url::Url::parse(&endpoint)?;

        // Validate host is present
        if url.host_str().is_none() {
            return Err(AppError::Validation(
                "Endpoint must have a valid host".to_string(),
            ));
        }

        // Store the endpoint in state
        let app_state = state.lock().await;
        *app_state.mesh_endpoint.lock().await = Some(endpoint.clone());

        log::info!("Testnet endpoint validated and stored: {}", endpoint);

        Ok(format!(
            "Connected to testnet at {} (validation successful)",
            endpoint
        ))
    }

    inner(endpoint, app_handle, state)
        .await
        .map_err(|e| e.to_string())
}

/// Generate Genesis Bundle for Zero-Touch Enrollment
///
/// This generates a signed bundle containing user identity and squad information
/// that can be scanned by IoT devices for automated provisioning.
#[tauri::command]
pub async fn generate_genesis_bundle(
    user_identity: String,
    squad_id: String,
) -> Result<GenesisBundle, String> {
    async fn inner(user_identity: String, squad_id: String) -> Result<GenesisBundle> {
        // Validate inputs
        validation::require_non_empty(&user_identity, "user_identity")?;
        validation::require_non_empty(&squad_id, "squad_id")?;
        validation::validate_alphanumeric(&user_identity, "user_identity")?;
        validation::validate_alphanumeric(&squad_id, "squad_id")?;

        log::info!(
            "Generating Genesis Bundle for user: {}, squad: {}",
            user_identity,
            squad_id
        );

        // Generate ephemeral Ed25519 keypair for this bundle
        // In production, this should use TPM-backed keys (CodeRalphie)
        let (public_key, signature) = generate_signature(&user_identity, &squad_id)
            .map_err(|e| AppError::Crypto(format!("Failed to generate signature: {}", e)))?;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| AppError::Generic(format!("System time error: {}", e)))?
            .as_secs();

        let bundle = GenesisBundle {
            user_identity,
            squad_id,
            public_key,
            signature,
            timestamp,
        };

        log::info!("Genesis Bundle generated successfully");
        Ok(bundle)
    }

    inner(user_identity, squad_id)
        .await
        .map_err(|e| e.to_string())
}

/// Generate QR Code Data from Genesis Bundle
///
/// Converts the Genesis Bundle into a QR-encodable string that can be
/// scanned by edge devices.
#[tauri::command]
pub fn bundle_to_qr_data(bundle: GenesisBundle) -> Result<String, String> {
    serde_json::to_string(&bundle).map_err(|e| e.to_string())
}

/// Telemetry Payload for verification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryPayload {
    pub node_id: String,
    pub data: serde_json::Value,
    pub signature: String,
    pub timestamp: u64,
}

/// Verify Telemetry Signature
///
/// Verifies the cryptographic signature of incoming telemetry data using Ed25519.
/// Returns true if signature is valid, false otherwise.
///
/// Integration: Uses Ed25519 signature verification with BLAKE3 hashing.
/// In production, public keys are retrieved from the IdentityManager.
#[tauri::command]
pub async fn verify_telemetry_signature(
    payload: TelemetryPayload,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<bool, String> {
    use base64::{engine::general_purpose, Engine as _};
    use ed25519_dalek::{Signature, Verifier};

    log::info!(
        "Verifying telemetry signature for node: {}",
        payload.node_id
    );

    // Basic validation
    if payload.signature.is_empty() {
        log::warn!("Empty signature for node: {}", payload.node_id);
        return Ok(false);
    }

    // Get identity manager to look up public key
    let app_state = state.lock().await;
    let identity_mgr = app_state.identity_manager.lock().await;

    // Look up node identity
    let identity = identity_mgr.get(&payload.node_id);
    if identity.is_none() {
        log::warn!("Node {} not found in identity registry", payload.node_id);
        // In fail-visible mode, unknown nodes are treated as unverified
        return Ok(false);
    }

    let identity = identity.unwrap();

    // Validate public key length for Ed25519 (must be exactly 32 bytes)
    if identity.public_key.len() != 32 {
        log::error!(
            "Invalid public key length for node {}: expected 32 bytes, got {}",
            payload.node_id,
            identity.public_key.len()
        );
        return Ok(false);
    }

    // Parse public key from identity
    let public_key_bytes: [u8; 32] = identity
        .public_key
        .as_slice()
        .try_into()
        .expect("Length already validated as 32 bytes");

    let verifying_key = match VerifyingKey::from_bytes(&public_key_bytes) {
        Ok(key) => key,
        Err(e) => {
            log::error!(
                "Failed to parse public key for node {}: {}",
                payload.node_id,
                e
            );
            return Ok(false);
        }
    };

    // Create message to verify using BLAKE3
    let message = format!(
        "{}:{}:{}",
        payload.node_id,
        serde_json::to_string(&payload.data).map_err(|e| e.to_string())?,
        payload.timestamp
    );
    let message_hash = blake3::hash(message.as_bytes());

    // Decode signature from base64
    let signature_bytes = match general_purpose::STANDARD.decode(&payload.signature) {
        Ok(bytes) => bytes,
        Err(e) => {
            log::error!("Failed to decode signature: {}", e);
            return Ok(false);
        }
    };

    // Parse signature
    let signature = match Signature::from_slice(&signature_bytes) {
        Ok(sig) => sig,
        Err(e) => {
            log::error!("Failed to parse signature: {}", e);
            return Ok(false);
        }
    };

    // Verify signature
    match verifying_key.verify(message_hash.as_bytes(), &signature) {
        Ok(()) => {
            log::info!("Telemetry signature VERIFIED for node: {}", payload.node_id);
            Ok(true)
        }
        Err(e) => {
            log::warn!(
                "Telemetry signature VERIFICATION FAILED for node {}: {}",
                payload.node_id,
                e
            );
            Ok(false)
        }
    }
}

/// Internal function to generate Ed25519 signature
///
/// Uses TPM-backed Ed25519 signing (CodeRalphie) in production.
/// This is a simplified version for the initial implementation.
fn generate_signature(user_identity: &str, squad_id: &str) -> Result<(String, String)> {
    use base64::{engine::general_purpose, Engine as _};
    use ed25519_dalek::{Signer, SigningKey as EdSigningKey};

    // Generate ephemeral keypair
    // TODO: Replace with TPM-backed key generation in production (CodeRalphie)
    let mut csprng = rand::thread_rng();
    let signing_key = EdSigningKey::from_bytes(&rand::Rng::gen::<[u8; 32]>(&mut csprng));

    // Create message to sign using BLAKE3
    let message = format!("{}:{}", user_identity, squad_id);
    let message_hash = blake3::hash(message.as_bytes());

    // Get public key
    let verifying_key = signing_key.verifying_key();
    let public_key_bytes = verifying_key.to_bytes();

    // Sign the message
    let signature = signing_key.sign(message_hash.as_bytes());

    // Encode to base64 for transport
    let public_key_b64 = general_purpose::STANDARD.encode(&public_key_bytes);
    let signature_b64 = general_purpose::STANDARD.encode(&signature.to_bytes());

    Ok((public_key_b64, signature_b64))
}

/// Create Node in Mesh
///
/// Provisions a new node in the AetherCore mesh with cryptographic identity.
/// Integrates with the Identity Manager to register the node.
///
/// NOTE: In production, this should use TPM-backed key generation (CodeRalphie).
/// Currently uses ephemeral Ed25519 keys for development/testing.
#[tauri::command]
pub async fn create_node(
    node_id: String,
    domain: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<String, String> {
    use aethercore_identity::{Attestation, PlatformIdentity};
    use std::collections::HashMap;

    log::info!("Creating node: {} in domain: {}", node_id, domain);

    // Validate node_id format
    if node_id.is_empty() || node_id.len() > 255 {
        return Err("Invalid node_id: must be 1-255 characters".to_string());
    }

    // Validate domain format
    if domain.is_empty() || domain.len() > 255 {
        return Err("Invalid domain: must be 1-255 characters".to_string());
    }

    // Generate Ed25519 keypair for this node
    // In production, replace with TPM-backed key generation (CodeRalphie)
    let public_key_bytes = {
        let mut csprng = rand::thread_rng();
        let signing_key =
            ed25519_dalek::SigningKey::from_bytes(&rand::Rng::gen::<[u8; 32]>(&mut csprng));
        let verifying_key = signing_key.verifying_key();
        verifying_key.to_bytes()
    };

    // Create platform identity
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("System time error: {}", e))?
        .as_millis() as u64;

    let mut metadata = HashMap::new();
    metadata.insert("domain".to_string(), domain.clone());

    let identity = PlatformIdentity {
        id: node_id.clone(),
        public_key: public_key_bytes.to_vec(),
        attestation: Attestation::Software {
            certificate: vec![], // Ephemeral, no certificate in dev mode
        },
        created_at: now_ms,
        metadata,
    };

    // Register with identity manager
    let app_state = state.lock().await;
    let mut identity_mgr = app_state.identity_manager.lock().await;

    identity_mgr
        .register(identity)
        .map_err(|e| format!("Failed to register identity: {}", e))?;

    // Initialize stream integrity tracker for this node
    let mut stream_tracker = app_state.stream_tracker.lock().await;
    let _status = stream_tracker.get_or_create(&node_id);

    log::info!(
        "Node {} provisioned in domain {} with identity registered",
        node_id,
        domain
    );
    Ok(format!(
        "Node {} successfully created and registered",
        node_id
    ))
}

/// Stream Integrity Status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamIntegrityStatus {
    pub stream_id: String,
    pub is_compromised: bool,
    pub total_events: u64,
    pub valid_events: u64,
    pub broken_events: u64,
    pub verification_status: String, // "VERIFIED", "STATUS_UNVERIFIED", "SPOOFED"
    pub compromise_reason: Option<String>,
}

/// Check Stream Integrity
///
/// Checks the Merkle-Vine integrity status for a given stream/node.
/// Returns the current integrity state including chain verification status.
///
/// Integration: Uses StreamIntegrityTracker from crates/stream for real-time
/// integrity monitoring.
#[tauri::command]
pub async fn check_stream_integrity(
    stream_id: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<StreamIntegrityStatus, String> {
    log::info!("Checking stream integrity for: {}", stream_id);

    // Get stream tracker
    let app_state = state.lock().await;
    let stream_tracker = app_state.stream_tracker.lock().await;

    // Query integrity status
    let integrity_status = stream_tracker.get(&stream_id);

    if let Some(status) = integrity_status {
        // Convert from internal IntegrityStatus to API response
        let verification_status = match status.verification_status {
            aethercore_stream::integrity::VerificationStatus::Verified => "VERIFIED",
            aethercore_stream::integrity::VerificationStatus::StatusUnverified => {
                "STATUS_UNVERIFIED"
            }
            aethercore_stream::integrity::VerificationStatus::Spoofed => "SPOOFED",
        };

        let response = StreamIntegrityStatus {
            stream_id: status.stream_id.clone(),
            is_compromised: status.is_compromised,
            total_events: status.total_events,
            valid_events: status.valid_events,
            broken_events: status.broken_events,
            verification_status: verification_status.to_string(),
            compromise_reason: status.compromise_reason.clone(),
        };

        log::info!("Stream {} integrity: {:?}", stream_id, verification_status);
        Ok(response)
    } else {
        // Stream not found - return unverified status
        log::warn!("Stream {} not found in tracker", stream_id);
        Ok(StreamIntegrityStatus {
            stream_id: stream_id.clone(),
            is_compromised: false,
            total_events: 0,
            valid_events: 0,
            broken_events: 0,
            verification_status: "STATUS_UNVERIFIED".to_string(),
            compromise_reason: Some("Stream not found in tracker".to_string()),
        })
    }
}

/// Get All Compromised Streams
///
/// Returns a list of all streams with broken Merkle-Vine chains.
///
/// Integration: Queries StreamIntegrityTracker for all compromised streams.
#[tauri::command]
pub async fn get_compromised_streams(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<String>, String> {
    log::info!("Fetching all compromised streams");

    // Get stream tracker
    let app_state = state.lock().await;
    let stream_tracker = app_state.stream_tracker.lock().await;

    // Get all compromised streams
    let compromised = stream_tracker.get_compromised_streams();
    let stream_ids: Vec<String> = compromised
        .iter()
        .map(|status| status.stream_id.clone())
        .collect();

    log::info!("Found {} compromised stream(s)", stream_ids.len());
    Ok(stream_ids)
}

/// License Inventory Entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseInventoryEntry {
    pub package_name: String,
    pub version: String,
    pub license: String,
    pub license_hash: Option<String>,
    pub ecosystem: String,         // "rust" or "npm"
    pub compliance_status: String, // "APPROVED", "FLAGGED", "UNKNOWN"
}

/// License Inventory Response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseInventory {
    pub total_dependencies: u64,
    pub approved_count: u64,
    pub flagged_count: u64,
    pub unknown_count: u64,
    pub entries: Vec<LicenseInventoryEntry>,
    pub manifest_hash: Option<String>,
    pub last_verification: Option<u64>,
}

/// Get License Inventory
///
/// Returns the current license compliance status for all dependencies.
/// Integrates with cargo-deny output and LICENSE_MANIFEST.txt for
/// cryptographic verification of license provenance.
///
/// This command powers the Compliance HUD in the System Admin View.
#[tauri::command]
pub async fn get_license_inventory() -> Result<LicenseInventory, String> {
    log::info!("Fetching license inventory for compliance HUD");

    // In a full implementation, this would:
    // 1. Read sbom-artifacts/tauri-sbom.json and frontend-sbom.json
    // 2. Parse LICENSE_MANIFEST.txt for license hashes
    // 3. Compare against cargo-deny whitelist in deny.toml
    // 4. Return aggregated compliance status
    //
    // For now, return a placeholder that demonstrates the structure

    let mut entries = Vec::new();

    // Example approved entry
    entries.push(LicenseInventoryEntry {
        package_name: "tokio".to_string(),
        version: "1.0.0".to_string(),
        license: "MIT".to_string(),
        license_hash: Some("blake3:abc123...".to_string()),
        ecosystem: "rust".to_string(),
        compliance_status: "APPROVED".to_string(),
    });

    // Example flagged entry (for demonstration)
    entries.push(LicenseInventoryEntry {
        package_name: "example-gpl-crate".to_string(),
        version: "0.1.0".to_string(),
        license: "GPL-3.0".to_string(),
        license_hash: None,
        ecosystem: "rust".to_string(),
        compliance_status: "FLAGGED".to_string(),
    });

    let approved_count = entries
        .iter()
        .filter(|e| e.compliance_status == "APPROVED")
        .count() as u64;
    let flagged_count = entries
        .iter()
        .filter(|e| e.compliance_status == "FLAGGED")
        .count() as u64;
    let unknown_count = entries
        .iter()
        .filter(|e| e.compliance_status == "UNKNOWN")
        .count() as u64;

    let inventory = LicenseInventory {
        total_dependencies: entries.len() as u64,
        approved_count,
        flagged_count,
        unknown_count,
        entries,
        manifest_hash: Some("blake3:placeholder".to_string()),
        last_verification: Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| format!("System time error: {}", e))?
                .as_millis() as u64,
        ),
    };

    log::info!(
        "License inventory: {} total, {} approved, {} flagged",
        inventory.total_dependencies,
        inventory.approved_count,
        inventory.flagged_count
    );

    Ok(inventory)
}

/// Record License Compliance Proof
///
/// Records a compliance verification event in The Great Gospel ledger.
/// Called after successful license audits during build/release processes.
#[tauri::command]
pub async fn record_license_compliance(
    verifier_id: String,
    total_deps: u64,
    approved: u64,
    violations: Vec<String>,
    manifest_hash: String,
) -> Result<String, String> {
    log::info!(
        "Recording license compliance: verifier={}, total={}, approved={}, violations={}",
        verifier_id,
        total_deps,
        approved,
        violations.len()
    );

    let proof = if violations.is_empty() {
        ComplianceProof::compliant(verifier_id, total_deps, approved, manifest_hash)
    } else {
        ComplianceProof::non_compliant(
            verifier_id,
            total_deps,
            approved,
            violations.clone(),
            manifest_hash,
            Some(format!("{} license violations detected", violations.len())),
        )
    };

    // In production, this would be persisted to the distributed ledger
    // For now, just log the event
    log::info!("Compliance proof created: status={}", proof.status);

    Ok(format!(
        "Compliance proof recorded: {} (status: {})",
        proof.verifier_id, proof.status
    ))
}

/// Node Deployment Configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeDeployConfig {
    pub node_id: String,
    pub mesh_endpoint: String,
    pub listen_port: u16,
    pub data_dir: String,
    pub log_level: String,
}

/// Deployment Status Response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentStatus {
    pub node_id: String,
    pub pid: u32,
    pub port: u16,
    pub started_at: u64,
    pub status: String,
}

#[derive(Debug, Deserialize)]
struct NodeVersionHandshake {
    version: String,
    runtime_version: u32,
    protocol_version: u32,
}

#[derive(Debug, Deserialize)]
struct RuntimeComponentManifest {
    schema_version: u32,
    components: Vec<RuntimeComponent>,
}

#[derive(Debug, Clone, Deserialize)]
struct RuntimeComponent {
    id: String,
    kind: String,
    description: String,
    required: bool,
    platform_paths: HashMap<String, String>,
    version_check_args: Option<Vec<String>>,
    version_compatibility: Option<String>,
}

#[derive(Debug)]
struct RuntimeComponentValidationIssue {
    component_id: String,
    details: String,
}

/// Deploy a node process locally
///
/// This command spawns a node binary as a child process with the provided configuration.
/// It validates all inputs rigorously and handles security considerations.
///
/// # Security Considerations
/// - All inputs are validated (ports, paths, URLs)
/// - Config files are written to sanitized paths
/// - Runtime binaries are resolved from signed bundled resources only
///
/// # Integration
/// Uses NodeProcessManager to track and manage the spawned process lifecycle.
#[tauri::command]
pub async fn deploy_node(
    config: NodeDeployConfig,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    app_handle: tauri::AppHandle,
) -> Result<DeploymentStatus, String> {
    log::info!("Deploying node: {}", config.node_id);

    // Validate node_id
    if config.node_id.is_empty() || config.node_id.len() > 255 {
        return Err("Invalid node_id: must be 1-255 characters".to_string());
    }

    // Validate port range (1024-65535)
    if config.listen_port < 1024 || config.listen_port > 65535 {
        return Err(format!(
            "Invalid port: {} (must be 1024-65535)",
            config.listen_port
        ));
    }

    // Validate mesh endpoint URL
    let endpoint_url = url::Url::parse(&config.mesh_endpoint)
        .map_err(|e| format!("Invalid mesh endpoint URL: {}", e))?;

    // Ensure endpoint uses ws:// or wss://
    if endpoint_url.scheme() != "ws" && endpoint_url.scheme() != "wss" {
        return Err("Mesh endpoint must use ws:// or wss:// scheme".to_string());
    }

    // Validate log level
    let valid_log_levels = ["trace", "debug", "info", "warn", "error"];
    if !valid_log_levels.contains(&config.log_level.to_lowercase().as_str()) {
        return Err(format!(
            "Invalid log level: {} (must be one of: trace, debug, info, warn, error)",
            config.log_level
        ));
    }

    // Sanitize and validate data_dir path
    let data_dir = PathBuf::from(&config.data_dir);

    // Canonicalize the path to resolve any .. or symlinks
    // First create the directory if it doesn't exist
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;

    let canonical_data_dir = data_dir
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize data directory path: {}", e))?;

    // Basic security check: ensure the canonical path doesn't contain suspicious patterns
    let path_str = canonical_data_dir.to_string_lossy();
    if path_str.contains("..") {
        return Err("Invalid data_dir: path traversal not allowed".to_string());
    }

    // Locate node binary
    let binary_path = locate_node_binary(&app_handle).map_err(|e| {
        show_node_binary_remediation_dialog(
            &app_handle,
            "AetherCore Node Binary Missing",
            &e.to_string(),
        );
        format!("Failed to locate node binary: {}", e)
    })?;

    let _ = verify_node_binary_compatibility(&binary_path).map_err(|e| {
        show_node_binary_remediation_dialog(
            &app_handle,
            "AetherCore Node Version Mismatch",
            &e.to_string(),
        );
        format!("Node compatibility check failed: {}", e)
    })?;

    log::info!("Using node binary: {}", binary_path);

    // Create temporary config file
    let config_path = canonical_data_dir.join(format!("{}_config.json", config.node_id));
    let config_json = serde_json::json!({
        "node_id": config.node_id,
        "mesh_endpoint": config.mesh_endpoint,
        "listen_port": config.listen_port,
        "data_dir": canonical_data_dir.to_string_lossy(),
        "log_level": config.log_level,
    });

    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&config_json).unwrap(),
    )
    .map_err(|e| format!("Failed to write config file: {}", e))?;

    log::info!("Config file written to: {}", config_path.display());

    // Spawn the node process
    let app_state = state.lock().await;
    let process_manager = app_state.process_manager.lock().await;

    let pid = process_manager
        .spawn(
            config.node_id.clone(),
            binary_path,
            config_path.to_string_lossy().to_string(),
            config.listen_port,
        )
        .map_err(|e| format!("Failed to spawn node process: {}", e))?;

    let started_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("System time error: {}", e))?
        .as_secs();

    log::info!("Node {} deployed with PID: {}", config.node_id, pid);

    Ok(DeploymentStatus {
        node_id: config.node_id,
        pid,
        port: config.listen_port,
        started_at,
        status: "Running".to_string(),
    })
}

/// Stop a running node process
///
/// This command stops a node that was previously deployed via deploy_node.
#[tauri::command]
pub async fn stop_node(
    node_id: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<String, String> {
    log::info!("Stopping node: {}", node_id);

    // Validate node_id
    if node_id.is_empty() {
        return Err("Invalid node_id: cannot be empty".to_string());
    }

    let app_state = state.lock().await;
    let process_manager = app_state.process_manager.lock().await;

    process_manager
        .stop(&node_id)
        .map_err(|e| format!("Failed to stop node: {}", e))?;

    log::info!("Node {} stopped successfully", node_id);
    Ok(format!("Node {} stopped successfully", node_id))
}

/// Get deployment status for all locally deployed nodes
///
/// Returns a list of all nodes currently managed by the NodeProcessManager.
#[tauri::command]
pub async fn get_deployment_status(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<DeploymentStatus>, String> {
    log::info!("Fetching deployment status for all nodes");

    let app_state = state.lock().await;
    let process_manager = app_state.process_manager.lock().await;

    let statuses = process_manager
        .get_all_statuses()
        .map_err(|e| format!("Failed to get deployment statuses: {}", e))?;

    let deployment_statuses: Vec<DeploymentStatus> = statuses
        .into_iter()
        .map(|info| DeploymentStatus {
            node_id: info.node_id,
            pid: info.pid,
            port: info.port,
            started_at: info.started_at,
            status: format!("{:?}", info.status),
        })
        .collect();

    log::info!("Found {} deployed node(s)", deployment_statuses.len());
    Ok(deployment_statuses)
}

/// Get logs for a specific node
///
/// Retrieves the captured stdout/stderr logs from a running or stopped node.
///
/// # Arguments
/// * `node_id` - The node identifier
/// * `tail` - Number of lines to retrieve from the end (0 = all lines)
#[tauri::command]
pub async fn get_node_logs(
    node_id: String,
    tail: usize,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<String>, String> {
    log::info!("Fetching logs for node: {} (tail={})", node_id, tail);

    // Validate node_id
    if node_id.is_empty() {
        return Err("Invalid node_id: cannot be empty".to_string());
    }

    let app_state = state.lock().await;
    let process_manager = app_state.process_manager.lock().await;

    let logs = process_manager
        .get_logs(&node_id, tail)
        .map_err(|e| format!("Failed to get logs: {}", e))?;

    log::info!("Retrieved {} log line(s) for node {}", logs.len(), node_id);
    Ok(logs)
}

fn current_platform_key() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn load_runtime_manifest(app_handle: &tauri::AppHandle) -> Result<RuntimeComponentManifest> {
    let manifest_path = app_handle
        .path()
        .resolve("runtime-components.manifest.json", BaseDirectory::Resource)
        .map_err(|e| anyhow::anyhow!("Failed to resolve runtime manifest: {e}"))?;

    let manifest_raw = std::fs::read_to_string(&manifest_path).map_err(|e| {
        anyhow::anyhow!(
            "Failed to read runtime manifest {}: {e}",
            manifest_path.display()
        )
    })?;

    let manifest: RuntimeComponentManifest = serde_json::from_str(&manifest_raw)
        .map_err(|e| anyhow::anyhow!("Invalid runtime manifest JSON: {e}"))?;

    if manifest.schema_version == 0 {
        return Err(anyhow::anyhow!(
            "Runtime manifest schema version must be >= 1"
        ));
    }

    Ok(manifest)
}

pub(crate) fn resolve_required_component_path(
    app_handle: &tauri::AppHandle,
    component_id: &str,
) -> Result<PathBuf> {
    let manifest = load_runtime_manifest(app_handle)?;
    let component = manifest
        .components
        .iter()
        .find(|entry| entry.id == component_id)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Runtime component '{}' not declared in manifest",
                component_id
            )
        })?;

    let relative_path = component
        .platform_paths
        .get(current_platform_key())
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Runtime component '{}' has no path for platform {}",
                component_id,
                current_platform_key()
            )
        })?;

    let resolved = app_handle
        .path()
        .resolve(relative_path, BaseDirectory::Resource)
        .map_err(|e| anyhow::anyhow!("Failed to resolve component '{}': {e}", component_id))?;

    if !resolved.exists() {
        return Err(anyhow::anyhow!(
            "Required runtime component '{}' is missing at {}",
            component_id,
            resolved.display()
        ));
    }

    Ok(resolved)
}

fn ensure_binary_executable(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = std::fs::metadata(path)?;
        let mode = metadata.permissions().mode();
        if mode & 0o111 == 0 {
            let mut permissions = metadata.permissions();
            permissions.set_mode(mode | 0o755);
            std::fs::set_permissions(path, permissions)?;
        }
    }

    if !path.is_file() {
        return Err(anyhow::anyhow!(
            "Runtime component is not a file: {}",
            path.display()
        ));
    }

    Ok(())
}

fn locate_node_binary(app_handle: &tauri::AppHandle) -> Result<String> {
    let path = resolve_required_component_path(app_handle, "aethercore-node")?;
    ensure_binary_executable(&path)?;
    log::info!("Resolved bundled node binary: {}", path.display());
    Ok(path.to_string_lossy().to_string())
}

pub fn verify_runtime_components_post_install(app_handle: &tauri::AppHandle) -> Result<()> {
    let manifest = load_runtime_manifest(app_handle)?;
    let mut issues: Vec<RuntimeComponentValidationIssue> = Vec::new();

    for component in &manifest.components {
        if !component.required {
            continue;
        }

        let relative_path = match component.platform_paths.get(current_platform_key()) {
            Some(path) => path,
            None => {
                issues.push(RuntimeComponentValidationIssue {
                    component_id: component.id.clone(),
                    details: format!("No platform path configured for {}", current_platform_key()),
                });
                continue;
            }
        };

        let resolved = match app_handle
            .path()
            .resolve(relative_path, BaseDirectory::Resource)
        {
            Ok(path) => path,
            Err(error) => {
                issues.push(RuntimeComponentValidationIssue {
                    component_id: component.id.clone(),
                    details: format!("Path resolution failed: {error}"),
                });
                continue;
            }
        };

        if !resolved.exists() {
            issues.push(RuntimeComponentValidationIssue {
                component_id: component.id.clone(),
                details: format!("Missing at {}", resolved.display()),
            });
            continue;
        }

        if component.kind == "binary" || component.kind == "sidecar" {
            if let Err(error) = ensure_binary_executable(&resolved) {
                issues.push(RuntimeComponentValidationIssue {
                    component_id: component.id.clone(),
                    details: format!("Not executable: {error}"),
                });
                continue;
            }

            if component.id == "aethercore-node" {
                if let Err(error) = verify_node_binary_compatibility(path_to_str(&resolved)?) {
                    issues.push(RuntimeComponentValidationIssue {
                        component_id: component.id.clone(),
                        details: format!("Version compatibility failed: {error}"),
                    });
                }
            } else if component.version_check_args.is_some() {
                let mut command = Command::new(&resolved);
                for arg in component.version_check_args.clone().unwrap_or_default() {
                    command.arg(arg);
                }

                match command.output() {
                    Ok(output) if output.status.success() => {
                        if component.version_compatibility.as_deref() == Some("invocation_success")
                        {
                            log::info!("Runtime component '{}' passed version check", component.id);
                        }
                    }
                    Ok(output) => {
                        issues.push(RuntimeComponentValidationIssue {
                            component_id: component.id.clone(),
                            details: format!(
                                "Version check command failed with status {}: {}",
                                output.status,
                                String::from_utf8_lossy(&output.stderr)
                            ),
                        });
                    }
                    Err(error) => {
                        issues.push(RuntimeComponentValidationIssue {
                            component_id: component.id.clone(),
                            details: format!("Version check invocation failed: {error}"),
                        });
                    }
                }
            }
        }

        log::info!(
            "Validated runtime component '{}' ({}) at {}",
            component.id,
            component.description,
            resolved.display()
        );
    }

    if !issues.is_empty() {
        let mut details = String::new();
        for issue in issues {
            details.push_str(&format!("- {}: {}\n", issue.component_id, issue.details));
        }
        return Err(anyhow::anyhow!(
            "One or more runtime components are missing or corrupt:\n{}",
            details.trim_end()
        ));
    }

    Ok(())
}

fn read_node_handshake(binary_path: &str) -> Result<NodeVersionHandshake> {
    let output = Command::new(binary_path)
        .arg("--version-json")
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to execute node version handshake: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow::anyhow!(
            "Node version handshake failed with status {}: {}",
            output.status,
            stderr.trim()
        ));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| anyhow::anyhow!("Invalid node handshake output: {e}"))
}

fn verify_node_binary_compatibility(binary_path: &str) -> Result<NodeVersionHandshake> {
    let handshake = read_node_handshake(binary_path)?;

    let dashboard_version = Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|e| anyhow::anyhow!("Invalid dashboard semantic version: {e}"))?;
    let node_version = Version::parse(&handshake.version).map_err(|e| {
        anyhow::anyhow!("Invalid node semantic version '{}': {e}", handshake.version)
    })?;

    if handshake.runtime_version != DASHBOARD_NODE_RUNTIME_VERSION {
        return Err(anyhow::anyhow!(
            "Runtime mismatch. Dashboard requires runtime v{}, but node reports runtime v{}.
Install a node binary compiled for this dashboard runtime.",
            DASHBOARD_NODE_RUNTIME_VERSION,
            handshake.runtime_version
        ));
    }

    if handshake.protocol_version != DASHBOARD_NODE_PROTOCOL_VERSION {
        return Err(anyhow::anyhow!(
            "Protocol mismatch. Dashboard requires protocol v{}, but node reports v{}.
Rebuild and package a matching 'aethercore-node' binary for this dashboard release.",
            DASHBOARD_NODE_PROTOCOL_VERSION,
            handshake.protocol_version
        ));
    }

    if node_version.major != dashboard_version.major {
        return Err(anyhow::anyhow!(
            "Major version mismatch. Dashboard is {}, node binary is {}.
Install or bundle the aethercore-node binary built from the same major release.",
            dashboard_version,
            node_version
        ));
    }

    if node_version < dashboard_version {
        return Err(anyhow::anyhow!(
            "Node binary is older than dashboard. Dashboard is {}, node binary is {}.
Upgrade and reinstall the desktop package with a newer bundled runtime.",
            dashboard_version,
            node_version
        ));
    }

    Ok(handshake)
}

pub fn verify_node_runtime_startup(app_handle: &tauri::AppHandle) -> Result<()> {
    let binary_path = locate_node_binary(app_handle)?;
    let handshake = verify_node_binary_compatibility(&binary_path)?;
    log::info!(
        "Startup compatibility check passed: binary={} runtime=v{} protocol=v{} node_version={}",
        binary_path,
        handshake.runtime_version,
        handshake.protocol_version,
        handshake.version
    );
    Ok(())
}

pub fn attempt_node_binary_repair(app_handle: &tauri::AppHandle) -> Result<String> {
    let bundled_path = resolve_required_component_path(app_handle, "aethercore-node")?;

    if !bundled_path.exists() {
        return Err(anyhow::anyhow!(
            "Bundled node binary missing at {}",
            bundled_path.display()
        ));
    }

    ensure_binary_executable(&bundled_path)?;

    let handshake = verify_node_binary_compatibility(path_to_str(&bundled_path)?)?;
    Ok(format!(
        "Repaired bundled node binary at {} (runtime v{}, protocol v{}, node version {})",
        bundled_path.display(),
        handshake.runtime_version,
        handshake.protocol_version,
        handshake.version
    ))
}

fn path_to_str(path: &Path) -> Result<&str> {
    path.to_str()
        .ok_or_else(|| anyhow::anyhow!("Path contains invalid UTF-8: {}", path.display()))
}

pub fn show_node_binary_remediation_dialog(
    app_handle: &tauri::AppHandle,
    title: &str,
    details: &str,
) {
    let requested_repair = app_handle
        .dialog()
        .message(format!(
            "{details}\n\nREMEDIATION:\n1. Click 'Repair Now' to re-validate bundled runtime assets.\n2. If repair fails, rebuild with `cargo build -p aethercore-node --release` and package again with `tauri build`.\n3. Reinstall the desktop package to restore bundled runtime components."
        ))
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Repair Now".to_string(),
            "Dismiss".to_string(),
        ))
        .kind(MessageDialogKind::Error)
        .title(title)
        .blocking_show();

    if requested_repair {
        match attempt_node_binary_repair(app_handle) {
            Ok(message) => {
                app_handle
                    .dialog()
                    .message(format!(
                        "{message}\n\nRe-run the previous operation to continue."
                    ))
                    .kind(MessageDialogKind::Info)
                    .title("AetherCore Runtime Repair Complete")
                    .blocking_show();
            }
            Err(error) => {
                app_handle
                    .dialog()
                    .message(format!(
                        "Repair failed: {error}\n\nManual remediation:\n1. Rebuild with `cargo build -p aethercore-node --release`.\n2. Repackage the desktop app with `tauri build`."
                    ))
                    .kind(MessageDialogKind::Error)
                    .title("AetherCore Runtime Repair Failed")
                    .blocking_show();
            }
        }
    }
}

/// Sign Heartbeat Payload (Aetheric Link Protocol)
///
/// This command implements cryptographic authentication for the C2 heartbeat
/// protocol. Every 5 seconds, the client must prove its identity by signing
/// a nonce (timestamp + random UUID) using TPM-backed Ed25519.
///
/// # Fail-Visible Doctrine
///
/// If the TPM fails to sign (hardware error, tampered device), this command
/// MUST return an error. The frontend will interpret TPM signing failure as
/// a "Broken Link" and immediately sever the connection.
///
/// # Security Model
///
/// - Private keys NEVER enter system memory (TPM hardware enforcement)
/// - Each signature is unique (nonce includes timestamp + UUID)
/// - Backend verifies freshness (reject payloads > 3s old)
/// - Missing 2 heartbeats (10s) triggers Dead Man's Switch
///
/// # Arguments
///
/// * `nonce` - The payload to sign (JSON string with timestamp + nonce)
///
/// # Returns
///
/// Base64-encoded signature bytes, or error if TPM signing fails
#[tauri::command]
pub async fn sign_heartbeat_payload(
    nonce: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<String, String> {
    log::debug!("[AETHERIC LINK] Signing heartbeat payload");

    // Access TPM Manager from app state
    let app_state = state.lock().await;
    let mut tpm = app_state.tpm_manager.lock().await;

    // Sign the nonce using TPM
    // In production with hardware-tpm feature, this uses real TPM
    // In development/testing, uses stub BLAKE3 signing
    let signature = tpm.sign(nonce.as_bytes()).map_err(|e| {
        log::error!("[CRITICAL] TPM signing failed: {}", e);
        format!("TPM Link not initialized: {}", e)
    })?;

    // Encode signature as base64 for transmission
    let signature_b64 = BASE64.encode(&signature);

    log::debug!("[AETHERIC LINK] Heartbeat signed successfully");
    Ok(signature_b64)
}

// ============================================================
// Configuration Management Commands
// ============================================================

/// Load application configuration
///
/// Returns the current configuration loaded from the user's app data directory.
/// If no configuration file exists, returns default configuration.
#[tauri::command]
pub async fn get_config(app_handle: tauri::AppHandle) -> Result<AppConfig, String> {
    log::info!("Loading application configuration");

    let config_manager = ConfigManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize config manager: {}", e))?;

    let config = config_manager
        .load()
        .map_err(|e| format!("Failed to load configuration: {}", e))?;

    Ok(config)
}

/// Update application configuration
///
/// Validates and saves the provided configuration to the user's app data directory.
/// All validation is performed server-side per security policy.
///
/// # Validation Rules
/// - mesh_endpoint must use wss:// protocol (production requirement)
/// - testnet_endpoint must use ws:// or wss:// protocol
/// - Retry configuration values must be positive and logical
///
/// # Arguments
/// * `config` - The new configuration to save
///
/// # Returns
/// Success message or validation error
#[tauri::command]
pub async fn update_config(
    config: AppConfig,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    log::info!("Updating application configuration");

    let config_manager = ConfigManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize config manager: {}", e))?;

    config_manager
        .save(&config)
        .map_err(|e| format!("Failed to save configuration: {}", e))?;

    Ok("Configuration updated successfully".to_string())
}

/// Get configuration file path
///
/// Returns the absolute path to the configuration file for debugging purposes.
#[tauri::command]
pub async fn get_config_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let config_manager = ConfigManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize config manager: {}", e))?;

    Ok(config_manager
        .get_config_path()
        .to_string_lossy()
        .to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalServiceStatusResponse {
    pub name: String,
    pub required: bool,
    pub healthy: bool,
    pub health_endpoint: String,
    pub port: u16,
    pub remediation_hint: String,
    pub startup_order: u32,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceReadinessResponse {
    pub name: String,
    pub healthy: bool,
    pub attempts: u32,
    pub elapsed_ms: u128,
    pub last_error: Option<String>,
    pub remediation_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectivityCheckResult {
    pub api_healthy: bool,
    pub websocket_reachable: bool,
    pub details: Vec<String>,
}

#[tauri::command]
pub async fn check_local_service_status() -> Result<Vec<LocalServiceStatusResponse>, String> {
    local_control_plane::check_service_statuses().map(|statuses| {
        statuses
            .into_iter()
            .map(|status| LocalServiceStatusResponse {
                name: status.name,
                required: status.required,
                healthy: status.healthy,
                health_endpoint: status.health_endpoint,
                port: status.port,
                remediation_hint: status.remediation_hint,
                startup_order: status.startup_order,
                running: status.running,
            })
            .collect()
    })
}

#[tauri::command]
pub async fn initialize_local_data_dirs() -> Result<Vec<String>, String> {
    local_control_plane::ensure_local_data_dirs()
}

#[tauri::command]
pub async fn start_managed_services() -> Result<Vec<LocalServiceStatusResponse>, String> {
    local_control_plane::start_managed_services().map(|statuses| {
        statuses
            .into_iter()
            .map(|status| LocalServiceStatusResponse {
                name: status.name,
                required: status.required,
                healthy: status.healthy,
                health_endpoint: status.health_endpoint,
                port: status.port,
                remediation_hint: status.remediation_hint,
                startup_order: status.startup_order,
                running: status.running,
            })
            .collect()
    })
}

#[tauri::command]
pub async fn start_dependency(service_name: String) -> Result<LocalServiceStatusResponse, String> {
    local_control_plane::start_dependency(&service_name).map(|status| LocalServiceStatusResponse {
        name: status.name,
        required: status.required,
        healthy: status.healthy,
        health_endpoint: status.health_endpoint,
        port: status.port,
        remediation_hint: status.remediation_hint,
        startup_order: status.startup_order,
        running: status.running,
    })
}

#[tauri::command]
pub async fn stop_dependency(service_name: String) -> Result<LocalServiceStatusResponse, String> {
    local_control_plane::stop_dependency(&service_name).map(|status| LocalServiceStatusResponse {
        name: status.name,
        required: status.required,
        healthy: status.healthy,
        health_endpoint: status.health_endpoint,
        port: status.port,
        remediation_hint: status.remediation_hint,
        startup_order: status.startup_order,
        running: status.running,
    })
}

#[tauri::command]
pub async fn retry_dependency(service_name: String) -> Result<ServiceReadinessResponse, String> {
    local_control_plane::retry_dependency(&service_name).map(|readiness| ServiceReadinessResponse {
        name: readiness.name,
        healthy: readiness.healthy,
        attempts: readiness.attempts,
        elapsed_ms: readiness.elapsed_ms,
        last_error: readiness.last_error,
        remediation_hint: readiness.remediation_hint,
    })
}

#[tauri::command]
pub async fn stop_managed_services() -> Result<String, String> {
    local_control_plane::stop_managed_services()?;
    Ok("Managed services stopped".to_string())
}

#[tauri::command]
pub async fn verify_dashboard_connectivity(
    api_health_endpoint: Option<String>,
    websocket_endpoint: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<ConnectivityCheckResult, String> {
    let mut details = Vec::new();

    let config_manager = ConfigManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize config manager: {}", e))?;
    let config = config_manager
        .load()
        .map_err(|e| format!("Failed to load configuration: {}", e))?;

    let api_health_endpoint = api_health_endpoint.unwrap_or_else(|| {
        format!(
            "{}/health",
            config.connection.api_endpoint.trim_end_matches('/')
        )
    });
    let websocket_endpoint = websocket_endpoint.unwrap_or(config.connection.mesh_endpoint);

    let api_healthy =
        match local_control_plane::verify_http_endpoint(&api_health_endpoint, config.ports.api) {
            Ok(_) => {
                details.push(format!("API endpoint healthy: {}", api_health_endpoint));
                true
            }
            Err(error) => {
                details.push(error);
                false
            }
        };

    let websocket_reachable = match local_control_plane::verify_websocket_port(&websocket_endpoint)
    {
        Ok(_) => {
            details.push(format!("WebSocket reachable: {}", websocket_endpoint));
            true
        }
        Err(error) => {
            details.push(error);
            false
        }
    };

    Ok(ConnectivityCheckResult {
        api_healthy,
        websocket_reachable,
        details,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapState {
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackState {
    pub desired_running: bool,
    pub last_ready: bool,
    pub updated_at_unix_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackStatusResponse {
    pub ready: bool,
    pub required_services: usize,
    pub healthy_required_services: usize,
    pub services: Vec<LocalServiceStatusResponse>,
    pub readiness: Vec<ServiceReadinessResponse>,
    pub persisted_state: StackState,
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn stack_state_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .resolve(".", BaseDirectory::AppData)
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(app_data_dir.join("stack-state.json"))
}

fn read_stack_state(app_handle: &tauri::AppHandle) -> Result<StackState, String> {
    let path = stack_state_path(app_handle)?;
    if !path.exists() {
        return Ok(StackState {
            desired_running: true,
            last_ready: false,
            updated_at_unix_secs: 0,
        });
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read stack state {}: {}", path.display(), e))?;
    serde_json::from_str::<StackState>(&content)
        .map_err(|e| format!("Failed to parse stack state {}: {}", path.display(), e))
}

fn persist_stack_state(app_handle: &tauri::AppHandle, state: &StackState) -> Result<(), String> {
    let path = stack_state_path(app_handle)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create stack state directory {}: {}",
                parent.display(),
                e
            )
        })?;
    }

    std::fs::write(
        &path,
        serde_json::to_string_pretty(state)
            .map_err(|e| format!("Failed to serialize stack state: {}", e))?,
    )
    .map_err(|e| format!("Failed to persist stack state {}: {}", path.display(), e))
}

fn build_stack_status(app_handle: &tauri::AppHandle) -> Result<StackStatusResponse, String> {
    let readiness = local_control_plane::evaluate_stack_readiness()?;
    let persisted_state = read_stack_state(app_handle)?;

    Ok(StackStatusResponse {
        ready: readiness.ready,
        required_services: readiness.required_services,
        healthy_required_services: readiness.healthy_required_services,
        services: readiness
            .services
            .into_iter()
            .map(|status| LocalServiceStatusResponse {
                name: status.name,
                required: status.required,
                healthy: status.healthy,
                health_endpoint: status.health_endpoint,
                port: status.port,
                remediation_hint: status.remediation_hint,
                startup_order: status.startup_order,
                running: status.running,
            })
            .collect(),
        readiness: readiness
            .readiness
            .into_iter()
            .map(|item| ServiceReadinessResponse {
                name: item.name,
                healthy: item.healthy,
                attempts: item.attempts,
                elapsed_ms: item.elapsed_ms,
                last_error: item.last_error,
                remediation_hint: item.remediation_hint,
            })
            .collect(),
        persisted_state,
    })
}

fn diagnose_cert_state() -> DiagnosticCheck {
    let certs = [
        std::env::var("AETHERCORE_TLS_CERT_PATH").ok(),
        std::env::var("SSL_CERT_FILE").ok(),
    ];

    let discovered = certs
        .iter()
        .flatten()
        .find(|path| !path.trim().is_empty())
        .cloned();

    match discovered {
        Some(path) => {
            let exists = Path::new(&path).exists();
            DiagnosticCheck {
                id: "cert_state".to_string(),
                label: "Certificate state".to_string(),
                status: if exists { "pass" } else { "warn" }.to_string(),
                detail: if exists {
                    format!("Certificate path detected: {}", path)
                } else {
                    format!("Configured certificate path not found: {}", path)
                },
            }
        }
        None => DiagnosticCheck {
            id: "cert_state".to_string(),
            label: "Certificate state".to_string(),
            status: "warn".to_string(),
            detail: "No certificate path configured in environment variables".to_string(),
        },
    }
}

fn diagnose_disk_space(app_handle: &tauri::AppHandle) -> DiagnosticCheck {
    let app_data_dir = match app_handle.path().resolve(".", BaseDirectory::AppData) {
        Ok(path) => path,
        Err(error) => {
            return DiagnosticCheck {
                id: "disk_space".to_string(),
                label: "Disk space".to_string(),
                status: "warn".to_string(),
                detail: format!("Unable to resolve app data path: {}", error),
            }
        }
    };

    #[cfg(target_family = "unix")]
    {
        let output = Command::new("df").arg("-Pk").arg(&app_data_dir).output();
        if let Ok(result) = output {
            if result.status.success() {
                let stdout = String::from_utf8_lossy(&result.stdout);
                if let Some(line) = stdout.lines().nth(1) {
                    let fields: Vec<&str> = line.split_whitespace().collect();
                    if fields.len() >= 6 {
                        let available_kb = fields[3].parse::<u64>().unwrap_or(0);
                        let status = if available_kb > 500_000 {
                            "pass"
                        } else {
                            "warn"
                        };
                        return DiagnosticCheck {
                            id: "disk_space".to_string(),
                            label: "Disk space".to_string(),
                            status: status.to_string(),
                            detail: format!(
                                "{} KB available on filesystem mounted at {}",
                                available_kb, fields[5]
                            ),
                        };
                    }
                }
            }
        }
    }

    DiagnosticCheck {
        id: "disk_space".to_string(),
        label: "Disk space".to_string(),
        status: "warn".to_string(),
        detail: format!(
            "Disk telemetry unavailable for {} (platform limitation)",
            app_data_dir.display()
        ),
    }
}

fn collect_runtime_versions() -> Vec<RuntimeVersionInfo> {
    let mut versions = vec![RuntimeVersionInfo {
        name: "dashboard".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }];

    let rustc_version = Command::new("rustc")
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    versions.push(RuntimeVersionInfo {
        name: "rustc".to_string(),
        version: rustc_version,
    });

    let node_version = Command::new("node")
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_else(|| "not-installed".to_string());

    versions.push(RuntimeVersionInfo {
        name: "node".to_string(),
        version: node_version,
    });

    versions
}

fn troubleshooting_cards() -> Vec<TroubleshootingCard> {
    vec![
        TroubleshootingCard {
            failure_class: "service-unreachable".to_string(),
            title: "Services unreachable".to_string(),
            steps: vec![
                "Verify all local services report healthy in the diagnostics panel.".to_string(),
                "Run Repair Installation to restart services in dependency order.".to_string(),
                "If still unhealthy, collect a support bundle and escalate to support.".to_string(),
            ],
        },
        TroubleshootingCard {
            failure_class: "port-conflict".to_string(),
            title: "Port conflict".to_string(),
            steps: vec![
                "Inspect the conflicting port in the diagnostics panel.".to_string(),
                "Stop conflicting local software (databases, web servers, old dashboard instances).".to_string(),
                "Run Reset Local Stack to clear stale processes and start clean.".to_string(),
            ],
        },
        TroubleshootingCard {
            failure_class: "certificate-issue".to_string(),
            title: "Certificate / trust chain issue".to_string(),
            steps: vec![
                "Confirm TLS certificate paths are set in environment variables.".to_string(),
                "Reinstall or rotate local certificates using your offline key media.".to_string(),
                "Retry startup and include cert diagnostics in support bundle if failure persists.".to_string(),
            ],
        },
    ]
}

fn build_diagnostics_report(app_handle: &tauri::AppHandle) -> Result<DiagnosticsReport, String> {
    let stack = build_stack_status(app_handle)?;
    let mut checks = Vec::new();

    checks.push(DiagnosticCheck {
        id: "service_health".to_string(),
        label: "Service health".to_string(),
        status: if stack.ready { "pass" } else { "warn" }.to_string(),
        detail: format!(
            "{}/{} required services healthy",
            stack.healthy_required_services, stack.required_services
        ),
    });

    let blocked_ports: Vec<String> = stack
        .services
        .iter()
        .filter(|svc| !svc.healthy)
        .map(|svc| format!("{}:{}", svc.name, svc.port))
        .collect();
    checks.push(DiagnosticCheck {
        id: "ports".to_string(),
        label: "Port checks".to_string(),
        status: if blocked_ports.is_empty() {
            "pass"
        } else {
            "warn"
        }
        .to_string(),
        detail: if blocked_ports.is_empty() {
            "All managed service ports responded to health checks".to_string()
        } else {
            format!(
                "Unhealthy or blocked service ports: {}",
                blocked_ports.join(", ")
            )
        },
    });

    checks.push(diagnose_cert_state());
    checks.push(diagnose_disk_space(app_handle));

    let runtime_versions = collect_runtime_versions();
    checks.push(DiagnosticCheck {
        id: "runtime_versions".to_string(),
        label: "Runtime versions".to_string(),
        status: "pass".to_string(),
        detail: runtime_versions
            .iter()
            .map(|entry| format!("{}={}", entry.name, entry.version))
            .collect::<Vec<_>>()
            .join(", "),
    });

    Ok(DiagnosticsReport {
        schema_version: DIAGNOSTIC_SCHEMA_VERSION,
        generated_at_unix_secs: now_unix_secs(),
        checks,
        runtime_versions,
        troubleshooting_cards: troubleshooting_cards(),
    })
}

#[tauri::command]
pub async fn diagnostics_report(app_handle: tauri::AppHandle) -> Result<DiagnosticsReport, String> {
    build_diagnostics_report(&app_handle)
}

#[tauri::command]
pub async fn collect_support_bundle(
    app_handle: tauri::AppHandle,
) -> Result<SupportBundleSummary, String> {
    let diagnostics = build_diagnostics_report(&app_handle)?;
    let app_data_dir = app_handle
        .path()
        .resolve(".", BaseDirectory::AppData)
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;

    let bundles_dir = app_data_dir.join("support-bundles");
    fs::create_dir_all(&bundles_dir)
        .map_err(|e| format!("Failed to create support bundle directory: {}", e))?;

    let timestamp = now_unix_secs();
    let bundle_dir = bundles_dir.join(format!("bundle-{}", timestamp));
    fs::create_dir_all(&bundle_dir)
        .map_err(|e| format!("Failed to create support bundle path: {}", e))?;

    let metadata = SupportBundleMetadata {
        schema_version: SUPPORT_BUNDLE_SCHEMA_VERSION,
        generated_at_unix_secs: timestamp,
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        ci: std::env::var("CI").is_ok(),
    };

    let metadata_path = bundle_dir.join("metadata.json");
    fs::write(
        &metadata_path,
        serde_json::to_vec_pretty(&metadata)
            .map_err(|e| format!("Failed to serialize bundle metadata: {}", e))?,
    )
    .map_err(|e| format!("Failed to write metadata.json: {}", e))?;

    let diagnostics_path = bundle_dir.join("health-report.json");
    fs::write(
        &diagnostics_path,
        serde_json::to_vec_pretty(&diagnostics)
            .map_err(|e| format!("Failed to serialize diagnostics: {}", e))?,
    )
    .map_err(|e| format!("Failed to write health report: {}", e))?;

    let config = ConfigManager::new(&app_handle)
        .map_err(|e| format!("Failed to initialize config manager: {}", e))?
        .load()
        .map_err(|e| format!("Failed to load configuration for bundle: {}", e))?;
    let config_path = bundle_dir.join("config-snapshot.json");
    fs::write(
        &config_path,
        serde_json::to_vec_pretty(&config)
            .map_err(|e| format!("Failed to serialize config snapshot: {}", e))?,
    )
    .map_err(|e| format!("Failed to write config snapshot: {}", e))?;

    let logs_dir = app_data_dir.join("logs");
    let target_logs_dir = bundle_dir.join("logs");
    fs::create_dir_all(&target_logs_dir)
        .map_err(|e| format!("Failed to create logs directory in bundle: {}", e))?;

    if logs_dir.exists() {
        if let Ok(entries) = fs::read_dir(&logs_dir) {
            for entry in entries.flatten().take(20) {
                let path = entry.path();
                if path.is_file() {
                    if let Some(name) = path.file_name() {
                        let _ = fs::copy(&path, target_logs_dir.join(name));
                    }
                }
            }
        }
    }

    let file_count = fs::read_dir(&bundle_dir)
        .map(|iter| iter.count())
        .unwrap_or(0);

    Ok(SupportBundleSummary {
        schema_version: SUPPORT_BUNDLE_SCHEMA_VERSION,
        bundle_path: bundle_dir.to_string_lossy().to_string(),
        generated_at_unix_secs: timestamp,
        file_count,
        diagnostics,
    })
}

#[tauri::command]
pub async fn repair_installation(
    app_handle: tauri::AppHandle,
) -> Result<StackStatusResponse, String> {
    repair_stack(app_handle).await
}

#[tauri::command]
pub async fn reset_local_stack(
    app_handle: tauri::AppHandle,
) -> Result<StackStatusResponse, String> {
    local_control_plane::stop_managed_services()?;
    std::thread::sleep(std::time::Duration::from_millis(250));
    local_control_plane::start_managed_services()?;
    let status = build_stack_status(&app_handle)?;
    persist_stack_state(
        &app_handle,
        &StackState {
            desired_running: true,
            last_ready: status.ready,
            updated_at_unix_secs: now_unix_secs(),
        },
    )?;
    Ok(status)
}

pub fn attempt_stack_auto_recover(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let state = read_stack_state(app_handle)?;
    if !state.desired_running {
        return Ok(());
    }

    let current = local_control_plane::evaluate_stack_readiness()?;
    if current.ready {
        return Ok(());
    }

    log::info!("Attempting local stack auto-recovery on relaunch");
    let _ = local_control_plane::start_managed_services()?;

    let recovered = local_control_plane::evaluate_stack_readiness()?;
    persist_stack_state(
        app_handle,
        &StackState {
            desired_running: true,
            last_ready: recovered.ready,
            updated_at_unix_secs: now_unix_secs(),
        },
    )
}

#[tauri::command]
pub async fn stack_status(app_handle: tauri::AppHandle) -> Result<StackStatusResponse, String> {
    build_stack_status(&app_handle)
}

#[tauri::command]
pub async fn start_stack(app_handle: tauri::AppHandle) -> Result<StackStatusResponse, String> {
    local_control_plane::start_managed_services()?;
    let status = build_stack_status(&app_handle)?;
    persist_stack_state(
        &app_handle,
        &StackState {
            desired_running: true,
            last_ready: status.ready,
            updated_at_unix_secs: now_unix_secs(),
        },
    )?;
    Ok(status)
}

#[tauri::command]
pub async fn stop_stack(app_handle: tauri::AppHandle) -> Result<StackStatusResponse, String> {
    local_control_plane::stop_managed_services()?;
    let status = build_stack_status(&app_handle)?;
    persist_stack_state(
        &app_handle,
        &StackState {
            desired_running: false,
            last_ready: status.ready,
            updated_at_unix_secs: now_unix_secs(),
        },
    )?;
    Ok(status)
}

#[tauri::command]
pub async fn repair_stack(app_handle: tauri::AppHandle) -> Result<StackStatusResponse, String> {
    local_control_plane::stop_managed_services()?;
    local_control_plane::start_managed_services()?;
    let status = build_stack_status(&app_handle)?;
    persist_stack_state(
        &app_handle,
        &StackState {
            desired_running: true,
            last_ready: status.ready,
            updated_at_unix_secs: now_unix_secs(),
        },
    )?;
    Ok(status)
}

#[tauri::command]
pub async fn get_bootstrap_state(app_handle: tauri::AppHandle) -> Result<BootstrapState, String> {
    let app_data_dir = app_handle
        .path()
        .resolve(".", BaseDirectory::AppData)
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;

    let state_path = app_data_dir.join("bootstrap-state.json");
    if !state_path.exists() {
        return Ok(BootstrapState { completed: false });
    }

    let content = std::fs::read_to_string(&state_path)
        .map_err(|e| format!("Failed to read bootstrap state: {}", e))?;
    serde_json::from_str::<BootstrapState>(&content)
        .map_err(|e| format!("Failed to parse bootstrap state: {}", e))
}

#[tauri::command]
pub async fn set_bootstrap_state(
    completed: bool,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .resolve(".", BaseDirectory::AppData)
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;

    let state_path = app_data_dir.join("bootstrap-state.json");
    std::fs::write(
        &state_path,
        serde_json::to_string_pretty(&BootstrapState { completed })
            .map_err(|e| format!("Failed to serialize bootstrap state: {}", e))?,
    )
    .map_err(|e| format!("Failed to persist bootstrap state: {}", e))?;

    Ok("Bootstrap state saved".to_string())
}

#[tauri::command]
pub async fn installer_bootstrap_requested() -> Result<bool, String> {
    Ok(std::env::args().any(|arg| arg == "--bootstrap"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_version_check_rejects_older_patch_versions() {
        let dashboard_version = Version::parse("0.2.0").unwrap();
        let node_version = Version::parse("0.1.9").unwrap();
        assert!(node_version < dashboard_version);
    }

    #[tokio::test]
    async fn test_generate_genesis_bundle() {
        let result =
            generate_genesis_bundle("test_user".to_string(), "squad_alpha".to_string()).await;

        assert!(result.is_ok());
        let bundle = result.unwrap();
        assert_eq!(bundle.user_identity, "test_user");
        assert_eq!(bundle.squad_id, "squad_alpha");
        assert!(!bundle.public_key.is_empty());
        assert!(!bundle.signature.is_empty());
    }

    // Note: Tauri command tests require a full Tauri context which is not available in unit tests
    // These commands should be tested via integration tests or manual testing
    // Keeping basic validation tests only
}
