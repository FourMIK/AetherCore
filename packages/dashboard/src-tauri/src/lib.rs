mod commands;
mod config;
mod error;
mod local_control_plane;
mod process_manager;
mod provisioning;
mod provisioning_legacy;

use aethercore_core::Error;
use aethercore_identity::tpm::{TpmManager, TpmQuote};
use commands::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Perform Sentinel Boot: Verify TPM hardware presence and attestation.
///
/// This function enforces hardware-rooted trust by requiring a valid TPM 2.0
/// attestation before allowing the application to launch. If the TPM check fails,
/// it displays a "Marine-Proof" error dialog with specific remediation steps
/// and terminates the process.
///
/// # Fail-Visible Doctrine
///
/// If hardware cannot be attested, the application MUST refuse to run.
/// This prevents degraded security postures in contested environments.
fn sentinel_boot() -> Result<(), String> {
    // Wrap TPM initialization in catch_unwind to prevent unwinding across FFI boundary
    let boot_result = std::panic::catch_unwind(|| -> Result<TpmQuote, Error> {
        // Initialize TPM Manager in hardware mode (enforces real TPM)
        let tpm = TpmManager::new(true);

        // Generate a cryptographically secure sentinel nonce for this boot sequence
        use rand::RngCore;
        let mut sentinel_nonce = vec![0u8; 32];
        rand::thread_rng().fill_bytes(&mut sentinel_nonce);

        // Request quote for PCRs 0-7 (boot sequence integrity)
        let pcr_selection: Vec<u8> = (0..8).collect();

        tpm.generate_quote(sentinel_nonce, &pcr_selection)
    });

    match boot_result {
        Ok(Ok(_quote)) => {
            // Success: TPM hardware confirmed
            // Note: Logging happens after logger initialization in setup()
            Ok(())
        }
        Ok(Err(e)) => {
            // TPM operation failed - determine specific error
            let error_msg = format!("{}", e);

            // Match against specific error patterns
            let (title, message, fix) = if error_msg.contains("not found")
                || error_msg.contains("device")
                || error_msg.contains("/dev/tpm0")
            {
                (
                    "HARDWARE LOCKOUT",
                    "TPM 2.0 chip missing or inaccessible.",
                    "STEP 1: Restart and enter BIOS/UEFI settings.\n\
                     STEP 2: Enable Intel PTT (Intel) or AMD fTPM (AMD).\n\
                     STEP 3: Save changes and reboot.\n\
                     STEP 4: Verify /dev/tpm0 exists on Linux or TBS service is running on Windows."
                )
            } else if error_msg.contains("PCR") || error_msg.contains("mismatch") {
                (
                    "INTEGRITY ALERT",
                    "Boot sequence integrity check failed. PCR values do not match expected state.",
                    "STEP 1: This may indicate tampering or unauthorized boot modifications.\n\
                     STEP 2: Contact your Watch Officer immediately.\n\
                     STEP 3: Do not proceed without clearance from security team.",
                )
            } else {
                (
                    "SENTINEL ERROR",
                    "Cryptographic handshake with TPM failed.",
                    "STEP 1: Restart the device and try again.\n\
                     STEP 2: If the error persists, check TPM firmware is up to date.\n\
                     STEP 3: Contact technical support with error details.",
                )
            };

            Err(format!("{}\n\n{}\n\nREMEDIATION:\n{}", title, message, fix))
        }
        Err(_panic) => {
            // Panic occurred during TPM initialization
            Err("SENTINEL ERROR\n\n\
                 Critical failure during TPM initialization. The process panicked.\n\n\
                 REMEDIATION:\n\
                 STEP 1: Restart the device.\n\
                 STEP 2: Check system logs for details.\n\
                 STEP 3: Contact technical support if issue persists."
                .to_string())
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SentinelBootPolicy {
    Required,
    Optional,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SentinelTrustStatus {
    pub trust_level: String,
    pub reduced_trust: bool,
    pub headline: String,
    pub detail: String,
}

impl Default for SentinelTrustStatus {
    fn default() -> Self {
        Self {
            trust_level: "full".to_string(),
            reduced_trust: false,
            headline: "Hardware trust attested".to_string(),
            detail: "TPM attestation verified at startup.".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SentinelStartupDecision {
    Continue(SentinelTrustStatus),
    FailClosed { error_details: String },
}

fn sentinel_policy_from_config(config: &crate::config::AppConfig) -> SentinelBootPolicy {
    let mode = config.tpm_policy.mode.to_ascii_lowercase();
    if config.tpm_policy.enforce_hardware
        || mode == "required"
        || config.profile == crate::config::ConnectionProfile::EnterpriseRemote
    {
        SentinelBootPolicy::Required
    } else if mode == "disabled" {
        SentinelBootPolicy::Disabled
    } else {
        SentinelBootPolicy::Optional
    }
}

fn evaluate_sentinel_startup(
    policy: SentinelBootPolicy,
    sentinel_result: Result<(), String>,
) -> SentinelStartupDecision {
    match (policy, sentinel_result) {
        (_, Ok(())) => SentinelStartupDecision::Continue(SentinelTrustStatus::default()),
        (SentinelBootPolicy::Required, Err(error_details)) => {
            SentinelStartupDecision::FailClosed { error_details }
        }
        (SentinelBootPolicy::Optional, Err(error_details)) => {
            SentinelStartupDecision::Continue(SentinelTrustStatus {
                trust_level: "reduced".to_string(),
                reduced_trust: true,
                headline: "TPM Optional Mode Active".to_string(),
                detail: format!(
                    "Startup continued without TPM attestation. Reduced-trust posture is active. {}",
                    error_details
                ),
            })
        }
        (SentinelBootPolicy::Disabled, Err(error_details)) => {
            SentinelStartupDecision::Continue(SentinelTrustStatus {
                trust_level: "reduced".to_string(),
                reduced_trust: true,
                headline: "TPM Disabled Mode Active".to_string(),
                detail: format!(
                    "TPM verification is disabled by policy. Startup bypassed attestation. {}",
                    error_details
                ),
            })
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize application state
    let app_state = Arc::new(Mutex::new(AppState::default()));
    let sentinel_status = Arc::new(Mutex::new(SentinelTrustStatus::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .manage(sentinel_status)
        .setup(|app| {
            // ============================================================
            // SENTINEL BOOT: Hardware-Rooted Trust Verification
            // ============================================================
            // Perform TPM attestation before allowing app to launch.
            // If this check fails, the application MUST NOT proceed.
            let ci_bootstrap_override = std::env::var("CI").is_ok()
                && std::env::var("AETHERCORE_SKIP_SENTINEL_FOR_CI")
                    .map(|value| value == "1")
                    .unwrap_or(false)
                && std::env::args().any(|arg| arg == "--bootstrap");

            let config_manager = crate::config::ConfigManager::new(&app.handle())
                .map_err(|e| tauri::Error::Setup(e.to_string()))?;
            let config_exists_before_boot = config_manager.get_config_path().exists();
            let config = config_manager
                .load()
                .map_err(|e| tauri::Error::Setup(e.to_string()))?;
            let sentinel_policy = sentinel_policy_from_config(&config);

            let decision = if ci_bootstrap_override {
                log::warn!(
                    "[SENTINEL] CI bootstrap validation mode enabled; skipping TPM attestation"
                );
                SentinelStartupDecision::Continue(SentinelTrustStatus {
                    trust_level: "ci_override".to_string(),
                    reduced_trust: true,
                    headline: "CI Sentinel Override Active".to_string(),
                    detail: "Sentinel boot attestation skipped for CI bootstrap validation."
                        .to_string(),
                })
            } else {
                evaluate_sentinel_startup(sentinel_policy, sentinel_boot())
            };

            if let SentinelStartupDecision::FailClosed { error_details } = decision {
                // Display error dialog with remediation steps
                let dialog_handle = app.handle().clone();

                // Use blocking message dialog to prevent app from continuing
                tauri::async_runtime::block_on(async move {
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

                    dialog_handle
                        .dialog()
                        .message(error_details)
                        .kind(MessageDialogKind::Error)
                        .title("AetherCore Sentinel Boot Failure")
                        .blocking_show();
                });

                // Terminate the application - do not allow WebView to render
                std::process::exit(1);
            }

            let status = match decision {
                SentinelStartupDecision::Continue(status) => status,
                SentinelStartupDecision::FailClosed { .. } => unreachable!(),
            };

            if status.reduced_trust {
                let dialog_handle = app.handle().clone();
                let warning_text = format!("{}\n\n{}", status.headline, status.detail);

                tauri::async_runtime::block_on(async move {
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

                    dialog_handle
                        .dialog()
                        .message(warning_text)
                        .kind(MessageDialogKind::Warning)
                        .title("AetherCore Reduced-Trust Startup")
                        .blocking_show();
                });
            }

            if let Some(shared_status) = app.try_state::<Arc<Mutex<SentinelTrustStatus>>>() {
                let shared_status = Arc::clone(&*shared_status);
                tauri::async_runtime::block_on(async move {
                    let mut guard = shared_status.lock().await;
                    *guard = status;
                });
            }

            local_control_plane::initialize_managed_runtime();
            local_control_plane::initialize_manifest_paths(&app.handle())
                .map_err(|error| tauri::Error::Setup(error.to_string()))?;
            if let Err(error) = commands::attempt_stack_auto_recover(&app.handle()) {
                log::warn!("Local stack auto-recovery skipped: {}", error);
            }

            if !config_exists_before_boot {
                log::info!(
                    "Created first-run runtime config at {:?}",
                    config_manager.get_config_path()
                );

                // Commander Edition is the only first-launch path.
                // Force bootstrap to run with local control plane defaults on initial install with no endpoint/manual technical prompts.
                let mut first_launch_config = config_manager
                    .load()
                    .map_err(|e| tauri::Error::Setup(e.to_string()))?;
                first_launch_config.profile = crate::config::ConnectionProfile::CommanderLocal;
                first_launch_config.features.bootstrap_on_startup = true;
                config_manager
                    .save(&first_launch_config)
                    .map_err(|e| tauri::Error::Setup(e.to_string()))?;
                log::info!("First launch pinned to Commander Edition bootstrap defaults");
            }

            if let Err(error) = commands::verify_runtime_components_post_install(&app.handle()) {
                commands::show_node_binary_remediation_dialog(
                    &app.handle(),
                    "AetherCore Runtime Asset Verification Failed",
                    &error.to_string(),
                );
                return Err(tauri::Error::Setup(error.to_string()));
            }

            if let Err(error) = commands::verify_node_runtime_startup(&app.handle()) {
                commands::show_node_binary_remediation_dialog(
                    &app.handle(),
                    "AetherCore Runtime Compatibility Check Failed",
                    &error.to_string(),
                );
                return Err(tauri::Error::Setup(error.to_string()));
            }

            // TPM verification successful - continue with normal initialization
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Log sentinel status after logger is initialized
            if ci_bootstrap_override {
                log::warn!("[SENTINEL] CI override active for bootstrap validation run");
            } else {
                let status = app
                    .try_state::<Arc<Mutex<SentinelTrustStatus>>>()
                    .expect("Sentinel trust status state should be managed");
                let status = tauri::async_runtime::block_on(async {
                    let guard = status.lock().await;
                    guard.clone()
                });

                if status.reduced_trust {
                    log::warn!("[SENTINEL] {} - {}", status.headline, status.detail);
                } else {
                    log::info!(
                        "[SENTINEL] Boot verification successful - Hardware identity confirmed"
                    );
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connect_to_mesh,
            commands::connect_to_testnet,
            commands::generate_genesis_bundle,
            commands::bundle_to_qr_data,
            commands::verify_telemetry_signature,
            commands::create_node,
            commands::check_stream_integrity,
            commands::get_compromised_streams,
            commands::get_license_inventory,
            commands::record_license_compliance,
            commands::deploy_node,
            commands::stop_node,
            commands::get_deployment_status,
            commands::get_node_logs,
            commands::sign_heartbeat_payload,
            // Configuration management commands
            commands::get_config,
            commands::update_config,
            commands::get_config_path,
            commands::check_local_service_status,
            commands::initialize_local_data_dirs,
            commands::start_managed_services,
            commands::stop_managed_services,
            commands::start_stack,
            commands::stop_stack,
            commands::stack_status,
            commands::repair_stack,
            commands::repair_installation,
            commands::reset_local_stack,
            commands::diagnostics_report,
            commands::collect_support_bundle,
            commands::start_dependency,
            commands::stop_dependency,
            commands::retry_dependency,
            commands::verify_dashboard_connectivity,
            commands::get_bootstrap_state,
            commands::set_bootstrap_state,
            commands::installer_bootstrap_requested,
            commands::get_sentinel_trust_status,
            // New unified provisioning commands
            provisioning::scan_for_assets,
            provisioning::provision_target,
            // Legacy provisioning commands (backwards compatibility)
            provisioning::list_serial_ports,
            provisioning::flash_firmware,
            provisioning::listen_for_genesis,
            provisioning::inject_genesis_bundle,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Shutdown all node processes when the window is closed
                if let Some(app_state) = window.try_state::<Arc<Mutex<AppState>>>() {
                    let app_state_clone = Arc::clone(app_state);
                    tauri::async_runtime::spawn(async move {
                        let state = app_state_clone.lock().await;
                        let process_manager = state.process_manager.lock().await;
                        if let Err(e) = process_manager.shutdown_all() {
                            log::error!("Error shutting down node processes: {}", e);
                        }
                    });
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_policy_fails_closed_when_tpm_boot_fails() {
        let decision = evaluate_sentinel_startup(
            SentinelBootPolicy::Required,
            Err("TPM 2.0 chip missing".to_string()),
        );

        assert!(matches!(
            decision,
            SentinelStartupDecision::FailClosed { .. }
        ));
    }

    #[test]
    fn optional_policy_continues_with_reduced_trust_when_tpm_boot_fails() {
        let decision = evaluate_sentinel_startup(
            SentinelBootPolicy::Optional,
            Err("TPM device unavailable".to_string()),
        );

        match decision {
            SentinelStartupDecision::Continue(status) => {
                assert!(status.reduced_trust);
                assert_eq!(status.headline, "TPM Optional Mode Active");
                assert!(status.detail.contains("TPM device unavailable"));
            }
            SentinelStartupDecision::FailClosed { .. } => {
                panic!("optional policy should not fail closed")
            }
        }
    }
}
