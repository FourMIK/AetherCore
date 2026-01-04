mod commands;

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
      commands::connect_to_testnet,
      commands::generate_genesis_bundle,
      commands::bundle_to_qr_data,
      commands::verify_telemetry_signature,
      commands::create_node,
      commands::check_stream_integrity,
      commands::get_compromised_streams,
      commands::get_license_inventory,
      commands::record_license_compliance,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
