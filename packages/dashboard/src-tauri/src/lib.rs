mod commands;
mod process_manager;

use std::sync::Arc;
use tokio::sync::Mutex;
use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Initialize application state
  let app_state = Arc::new(Mutex::new(AppState::default()));
  
  tauri::Builder::default()
    .manage(app_state)
    .setup(|app| {
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
