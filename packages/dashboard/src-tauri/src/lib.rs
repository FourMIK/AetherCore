mod commands;
pub mod config;
mod error;
mod local_control_plane;
mod process_manager;
mod provisioning;
mod provisioning_legacy;

use aethercore_core::Error;
use aethercore_identity::{SecureEnclaveAttestor, TpmManager};
use commands::AppState;
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::process::Command;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

const SENTINEL_SE_PROBE_ARG: &str = "--sentinel-se-probe";
const SENTINEL_SE_PROBE_ENV: &str = "AETHERCORE_SEP_PROBE_CHILD";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SentinelHardwareBackend {
    Tpm,
    SecureEnclave,
}

impl SentinelHardwareBackend {
    fn name(self) -> &'static str {
        match self {
            SentinelHardwareBackend::Tpm => "TPM",
            SentinelHardwareBackend::SecureEnclave => "Secure Enclave",
        }
    }
}

fn sentinel_hardware_backend() -> SentinelHardwareBackend {
    if cfg!(any(target_os = "macos", target_os = "ios")) {
        SentinelHardwareBackend::SecureEnclave
    } else {
        SentinelHardwareBackend::Tpm
    }
}

fn perform_sentinel_attestation(backend: SentinelHardwareBackend) -> Result<(), Error> {
    use rand::RngCore;
    let mut sentinel_nonce = vec![0_u8; 32];
    rand::thread_rng().fill_bytes(&mut sentinel_nonce);

    match backend {
        SentinelHardwareBackend::Tpm => {
            let tpm = TpmManager::new(true);
            // Request quote for PCRs 0-7 (boot sequence integrity)
            let pcr_selection: Vec<u8> = (0..8).collect();
            tpm.generate_quote(sentinel_nonce, &pcr_selection)
                .map(|_| ())
        }
        SentinelHardwareBackend::SecureEnclave => {
            perform_secure_enclave_attestation_isolated(&sentinel_nonce)
        }
    }
}

fn perform_secure_enclave_attestation_in_process(nonce: &[u8]) -> Result<(), Error> {
    let attestor = SecureEnclaveAttestor::new("com.4mik.aethercore.sentinel.boot");
    let quote = attestor.sign_nonce(nonce)?;
    let valid = SecureEnclaveAttestor::verify_quote(&quote)?;
    if !valid {
        return Err(Error::Identity(
            "Secure Enclave quote verification failed".to_string(),
        ));
    }
    Ok(())
}

fn perform_secure_enclave_attestation_isolated(nonce: &[u8]) -> Result<(), Error> {
    if std::env::var(SENTINEL_SE_PROBE_ENV)
        .map(|value| value == "1")
        .unwrap_or(false)
    {
        return perform_secure_enclave_attestation_in_process(nonce);
    }

    let executable = std::env::current_exe().map_err(|error| {
        Error::Identity(format!(
            "Secure Enclave probe failed to resolve current executable: {}",
            error
        ))
    })?;
    let nonce_hex = hex::encode(nonce);

    let output = Command::new(executable)
        .arg(SENTINEL_SE_PROBE_ARG)
        .arg(nonce_hex)
        .env(SENTINEL_SE_PROBE_ENV, "1")
        .output()
        .map_err(|error| {
            Error::Identity(format!(
                "Secure Enclave probe process launch failed: {}",
                error
            ))
        })?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let status = output
        .status
        .code()
        .map(|code| format!("exit code {code}"))
        .unwrap_or_else(|| "terminated by signal".to_string());
    let diagnostics = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "probe exited without diagnostics".to_string()
    };

    Err(Error::Identity(format!(
        "Secure Enclave probe failed ({status}): {diagnostics}"
    )))
}

fn run_secure_enclave_probe_child(args: &[String]) -> i32 {
    if args.len() < 3 {
        eprintln!("[SENTINEL] probe missing nonce argument");
        return 2;
    }

    let nonce = match hex::decode(args[2].trim()) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("[SENTINEL] probe invalid nonce encoding: {error}");
            return 2;
        }
    };

    match perform_secure_enclave_attestation_in_process(&nonce) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("[SENTINEL] probe attestation failed: {error}");
            1
        }
    }
}

/// Perform Sentinel Boot: Verify hardware presence and attestation.
///
/// This function enforces hardware-rooted trust by requiring a valid hardware
/// attestation before allowing the application to launch. If this check fails,
/// it displays a "Marine-Proof" error dialog with specific remediation steps
/// and terminates the process.
///
/// # Fail-Visible Doctrine
///
/// If hardware cannot be attested, the application MUST refuse to run.
/// This prevents degraded security postures in contested environments.
fn sentinel_boot() -> Result<(), String> {
    let backend = sentinel_hardware_backend();
    // Wrap hardware initialization in catch_unwind to prevent unwinding across FFI boundary
    let boot_result =
        std::panic::catch_unwind(|| -> Result<(), Error> { perform_sentinel_attestation(backend) });

    match boot_result {
        Ok(Ok(())) => {
            // Success: hardware attestation confirmed
            // Note: Logging happens after logger initialization in setup()
            Ok(())
        }
        Ok(Err(e)) => {
            // Hardware attestation failed - determine specific error
            let error_msg = format!("{}", e);

            // Match against specific error patterns
            let (title, message, fix) = match backend {
                SentinelHardwareBackend::Tpm => {
                    if error_msg.contains("not found")
                        || error_msg.contains("device")
                        || error_msg.contains("/dev/tpm0")
                    {
                        (
                            "HARDWARE LOCKOUT",
                            "TPM 2.0 chip missing or inaccessible.",
                            "STEP 1: Restart and enter BIOS/UEFI settings.\n\
                             STEP 2: Enable Intel PTT (Intel) or AMD fTPM (AMD).\n\
                             STEP 3: Save changes and reboot.\n\
                             STEP 4: Verify /dev/tpm0 exists on Linux or TBS service is running on Windows.",
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
                    }
                }
                SentinelHardwareBackend::SecureEnclave => {
                    if error_msg.contains("secure enclave key")
                        || error_msg.contains("Secure Enclave")
                        || error_msg.contains("failed key lookup")
                    {
                        (
                            "HARDWARE LOCKOUT",
                            "Secure Enclave is unavailable or inaccessible.",
                            "STEP 1: Restart the device and unlock the login keychain.\n\
                             STEP 2: Verify this device supports Secure Enclave and is not restricted by policy.\n\
                             STEP 3: Ensure the OS is up to date.\n\
                             STEP 4: Retry startup and capture logs if it fails again.",
                        )
                    } else if error_msg.contains("quote verification failed")
                        || error_msg.contains("Invalid DER signature")
                        || error_msg.contains("Invalid SEC1 public key")
                    {
                        (
                            "INTEGRITY ALERT",
                            "Secure Enclave attestation payload failed integrity checks.",
                            "STEP 1: Treat this as potential tamper or keychain corruption.\n\
                             STEP 2: Rotate the Secure Enclave key and retry startup.\n\
                             STEP 3: Escalate to security operations if it persists.",
                        )
                    } else {
                        (
                            "SENTINEL ERROR",
                            "Cryptographic handshake with Secure Enclave failed.",
                            "STEP 1: Restart the device and try again.\n\
                             STEP 2: If the error persists, rotate local attestation key material.\n\
                             STEP 3: Contact technical support with error details.",
                        )
                    }
                }
            };

            Err(format!(
                "{}\n\n{}\n\nREMEDIATION:\n{}\n\nDIAGNOSTICS:\n{}",
                title, message, fix, error_msg
            ))
        }
        Err(_panic) => {
            // Panic occurred during hardware initialization
            Err(format!(
                "SENTINEL ERROR\n\n\
                 Critical failure during {} initialization. The process panicked.\n\n\
                 REMEDIATION:\n\
                 STEP 1: Restart the device.\n\
                 STEP 2: Check system logs for details.\n\
                 STEP 3: Contact technical support if issue persists.",
                backend.name()
            ))
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
pub struct StartupProbe {
    pub policy_mode: String,
    pub selected_backend: String,
    pub security_level: String,
    pub status: String,
    pub failure_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SentinelTrustStatus {
    pub trust_level: String,
    pub reduced_trust: bool,
    pub headline: String,
    pub detail: String,
    pub startup_probe: Option<StartupProbe>,
}

impl Default for SentinelTrustStatus {
    fn default() -> Self {
        Self {
            trust_level: "full".to_string(),
            reduced_trust: false,
            headline: "Hardware trust attested".to_string(),
            detail: "Hardware attestation verified at startup.".to_string(),
            startup_probe: None,
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
                headline: "Hardware Optional Mode Active".to_string(),
                detail: format!(
                    "Startup continued without hardware attestation. Reduced-trust posture is active. {}",
                    error_details
                ),
                startup_probe: None,
            })
        }
        (SentinelBootPolicy::Disabled, Err(error_details)) => {
            SentinelStartupDecision::Continue(SentinelTrustStatus {
                trust_level: "reduced".to_string(),
                reduced_trust: true,
                headline: "Hardware Disabled Mode Active".to_string(),
                detail: format!(
                    "Hardware verification is disabled by policy. Startup bypassed attestation. {}",
                    error_details
                ),
                startup_probe: None,
            })
        }
    }
}

fn should_skip_sentinel_boot(policy: SentinelBootPolicy) -> bool {
    // On Apple platforms (macOS/iOS), allow skipping Sentinel boot when not required
    if !cfg!(any(target_os = "macos", target_os = "ios")) {
        return false;
    }

    if matches!(policy, SentinelBootPolicy::Required) {
        return false;
    }

    std::env::var("AETHERCORE_MACOS_OPTIONAL_SENTINEL_SKIP")
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            !(normalized == "0" || normalized == "false" || normalized == "no")
        })
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some(SENTINEL_SE_PROBE_ARG) {
        std::process::exit(run_secure_enclave_probe_child(&args));
    }

    install_panic_hook();

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

            let config_manager = crate::config::ConfigManager::new(app.handle())?;
            let config_exists_before_boot = config_manager.get_config_path().exists();
            let config = config_manager.load()?;
            let sentinel_policy = sentinel_policy_from_config(&config);

            let decision = if ci_bootstrap_override {
                log::warn!(
                    "[SENTINEL] CI bootstrap validation mode enabled; skipping hardware attestation"
                );
                SentinelStartupDecision::Continue(SentinelTrustStatus {
                    trust_level: "ci_override".to_string(),
                    reduced_trust: true,
                    headline: "CI Sentinel Override Active".to_string(),
                    detail: "Sentinel boot attestation skipped for CI bootstrap validation."
                        .to_string(),
                    startup_probe: None,
                })
            } else {
                let sentinel_result = if should_skip_sentinel_boot(sentinel_policy) {
                    Err(
                        "Secure Enclave startup attestation skipped on macOS in non-required mode"
                            .to_string(),
                    )
                } else {
                    sentinel_boot()
                };
                evaluate_sentinel_startup(sentinel_policy, sentinel_result)
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
                let show_reduced_trust_dialog =
                    std::env::var("AETHERCORE_SHOW_REDUCED_TRUST_DIALOG")
                        .map(|value| {
                            let value = value.trim().to_ascii_lowercase();
                            value == "1" || value == "true" || value == "yes"
                        })
                        // Default OFF to avoid modal-dialog reentrancy risks during app bootstrap.
                        .unwrap_or(false);

                if show_reduced_trust_dialog {
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
            }

            if let Some(shared_status) = app.try_state::<Arc<Mutex<SentinelTrustStatus>>>() {
                let shared_status = Arc::clone(&*shared_status);
                tauri::async_runtime::block_on(async move {
                    let mut guard = shared_status.lock().await;
                    *guard = status;
                });
            }

            local_control_plane::initialize_managed_runtime();
            {
                let app_handle = app.handle().clone();
                let bootstrap_on_startup = config.features.bootstrap_on_startup;
                std::thread::spawn(move || {
                    if let Err(error) = commands::attempt_stack_auto_recover(&app_handle) {
                        log::warn!("Local stack auto-recovery skipped: {}", error);
                    }

                    if !bootstrap_on_startup {
                        return;
                    }

                    let should_start = match local_control_plane::evaluate_stack_readiness() {
                        Ok(readiness) => !readiness.ready,
                        Err(error) => {
                            log::warn!(
                                "Unable to evaluate local stack readiness during bootstrap: {}",
                                error
                            );
                            true
                        }
                    };

                    if should_start {
                        if let Err(error) = local_control_plane::start_managed_services() {
                            log::warn!("Local stack bootstrap start failed: {}", error);
                        }
                    }
                });
            }

            if !config_exists_before_boot {
                log::info!(
                    "Created first-run runtime config at {:?}",
                    config_manager.get_config_path()
                );

                // Commander Edition is the only first-launch path.
                // Force bootstrap to run with local control plane defaults on initial install with no endpoint/manual technical prompts.
                let mut first_launch_config = config_manager.load()?;
                first_launch_config.profile = crate::config::ConnectionProfile::CommanderLocal;
                first_launch_config.features.bootstrap_on_startup = true;
                config_manager.save(&first_launch_config)?;
                log::info!("First launch pinned to Commander Edition bootstrap defaults");
            }

            if let Err(error) = commands::verify_runtime_components_post_install(app.handle()) {
                if cfg!(debug_assertions) {
                    log::warn!(
                        "Skipping strict runtime component verification in dev mode: {}",
                        error
                    );
                } else {
                    commands::show_node_binary_remediation_dialog(
                        app.handle(),
                        "AetherCore Runtime Asset Verification Failed",
                        &error.to_string(),
                    );
                    return Err(error.into());
                }
            }

            if let Err(error) = commands::verify_node_runtime_startup(app.handle()) {
                if cfg!(debug_assertions) {
                    log::warn!(
                        "Skipping strict runtime startup compatibility in dev mode: {}",
                        error
                    );
                } else {
                    commands::show_node_binary_remediation_dialog(
                        app.handle(),
                        "AetherCore Runtime Compatibility Check Failed",
                        &error.to_string(),
                    );
                    return Err(error.into());
                }
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
            } else if let Some(status) = app.try_state::<Arc<Mutex<SentinelTrustStatus>>>() {
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
            } else {
                log::warn!("[SENTINEL] trust status state unavailable during bootstrap");
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
            commands::get_heartbeat_device_id,
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
            provisioning::scanner::scan_for_assets,
            provisioning::provision_target,
            // Legacy provisioning commands (backwards compatibility)
            provisioning_legacy::list_serial_ports,
            provisioning_legacy::flash_firmware,
            provisioning_legacy::listen_for_genesis,
            provisioning_legacy::inject_genesis_bundle,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Shutdown all node processes when the window is closed
                if let Some(app_state) = window.try_state::<Arc<Mutex<AppState>>>() {
                    let app_state_clone: Arc<Mutex<AppState>> = app_state.inner().clone();
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

fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let message = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic payload".to_string()
        };

        let location = panic_info
            .location()
            .map(|loc| format!("{}:{}", loc.file(), loc.line()))
            .unwrap_or_else(|| "unknown location".to_string());

        let backtrace = std::backtrace::Backtrace::force_capture();
        let log_line =
            format!("[PANIC] {message}\n[LOCATION] {location}\n[BACKTRACE]\n{backtrace}\n\n");

        let panic_log_path = std::env::temp_dir().join("aethercore-panic.log");
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&panic_log_path)
        {
            let _ = file.write_all(log_line.as_bytes());
        }

        eprintln!("{log_line}");
        default_hook(panic_info);
    }));
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
                assert_eq!(status.headline, "Hardware Optional Mode Active");
                assert!(status.detail.contains("TPM device unavailable"));
            }
            SentinelStartupDecision::FailClosed { .. } => {
                panic!("optional policy should not fail closed")
            }
        }
    }
}
