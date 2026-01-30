mod commands;
mod process_manager;
mod provisioning;
mod provisioning_legacy;

use std::sync::Arc;
use tokio::sync::Mutex;
use commands::AppState;
use aethercore_identity::tpm::{TpmManager, TpmQuote};
use aethercore_core::Error;

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
        
        // Generate a sentinel nonce for this boot sequence
        let sentinel_nonce: Vec<u8> = (0..32)
            .map(|_| rand::random::<u8>())
            .collect();
        
        // Request quote for PCRs 0-7 (boot sequence integrity)
        let pcr_selection: Vec<u8> = (0..8).collect();
        
        tpm.generate_quote(sentinel_nonce, &pcr_selection)
    });
    
    match boot_result {
        Ok(Ok(quote)) => {
            // Success: TPM hardware confirmed
            let digest_hex = quote.pcrs.iter()
                .map(|pcr| format!("PCR{}: {}", pcr.index, hex::encode(&pcr.value)))
                .collect::<Vec<_>>()
                .join(", ");
            log::info!("[SENTINEL] Identity Confirmed - Hardware Digest: {}", digest_hex);
            Ok(())
        }
        Ok(Err(e)) => {
            // TPM operation failed - determine specific error
            let error_msg = format!("{}", e);
            
            // Match against specific error patterns
            let (title, message, fix) = if error_msg.contains("not found") 
                || error_msg.contains("device") 
                || error_msg.contains("/dev/tpm0") {
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
                     STEP 3: Do not proceed without clearance from security team."
                )
            } else {
                (
                    "SENTINEL ERROR",
                    "Cryptographic handshake with TPM failed.",
                    "STEP 1: Restart the device and try again.\n\
                     STEP 2: If the error persists, check TPM firmware is up to date.\n\
                     STEP 3: Contact technical support with error details."
                )
            };
            
            Err(format!("{}\n\n{}\n\nREMEDIATION:\n{}", title, message, fix))
        }
        Err(_panic) => {
            // Panic occurred during TPM initialization
            Err(
                "SENTINEL ERROR\n\n\
                 Critical failure during TPM initialization. The process panicked.\n\n\
                 REMEDIATION:\n\
                 STEP 1: Restart the device.\n\
                 STEP 2: Check system logs for details.\n\
                 STEP 3: Contact technical support if issue persists.".to_string()
            )
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Initialize application state
  let app_state = Arc::new(Mutex::new(AppState::default()));
  
  tauri::Builder::default()
    .manage(app_state)
    .setup(|app| {
      // ============================================================
      // SENTINEL BOOT: Hardware-Rooted Trust Verification
      // ============================================================
      // Perform TPM attestation before allowing app to launch.
      // If this check fails, the application MUST NOT proceed.
      if let Err(error_details) = sentinel_boot() {
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
        log::error!("[SENTINEL] Boot verification failed. Terminating application.");
        std::process::exit(1);
      }
      
      // TPM verification successful - continue with normal initialization
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
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
