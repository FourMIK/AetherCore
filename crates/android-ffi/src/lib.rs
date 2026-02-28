//! AetherCore Android JNI Bridge
//!
//! This crate provides the native bridge between Android (Kotlin/Java) and the AetherCore
//! Rust cryptographic core. It implements the RalphieNodeDaemon interface for ATAK integration.
//!
//! ## Architectural Invariants
//! - All JNI functions must be `unsafe` and handle errors explicitly
//! - Private keys never leave the Rust boundary (Fail-Visible)
//! - All cryptographic operations use BLAKE3 and Ed25519
//! - The daemon runs on a separate Tokio runtime thread

use jni::objects::{JClass, JString};
use jni::sys::{jboolean, jstring};
use jni::JNIEnv;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::runtime::Runtime;
use tracing::{error, info, warn};

mod daemon;
mod identity;
mod sweep;

use daemon::AetherCoreDaemon;

/// Global Tokio runtime for async operations
static RUNTIME: OnceLock<Runtime> = OnceLock::new();

/// Global daemon instance
static DAEMON: OnceLock<Arc<Mutex<Option<AetherCoreDaemon>>>> = OnceLock::new();

/// Initialize the AetherCore daemon
///
/// # Parameters
/// - `storage_path`: Android app files directory
/// - `hardware_id`: Device hardware fingerprint from AndroidEnrollmentKeyManager
///
/// # Returns
/// `true` if initialization succeeded, `false` otherwise
#[no_mangle]
pub unsafe extern "C" fn Java_com_aethercore_atak_trustoverlay_core_RalphieNodeDaemon_nativeInitialize(
    mut env: JNIEnv,
    _class: JClass,
    storage_path: JString,
    hardware_id: JString,
) -> jboolean {
    // Initialize tracing subscriber (once)
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init();

    info!("AetherCore JNI: nativeInitialize called");

    // Extract Java strings
    let storage_path_str = match env.get_string(&storage_path) {
        Ok(s) => s.to_string_lossy().to_string(),
        Err(e) => {
            error!("Failed to extract storage_path: {:?}", e);
            return jni::sys::JNI_FALSE;
        }
    };

    let hardware_id_str = match env.get_string(&hardware_id) {
        Ok(s) => s.to_string_lossy().to_string(),
        Err(e) => {
            error!("Failed to extract hardware_id: {:?}", e);
            return jni::sys::JNI_FALSE;
        }
    };

    info!(
        "Initializing AetherCore daemon: storage={}, hardware_id={}",
        storage_path_str,
        &hardware_id_str[..8.min(hardware_id_str.len())]
    );

    // Initialize Tokio runtime
    let runtime = RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("aethercore-jni")
            .enable_all()
            .build()
            .expect("Failed to create Tokio runtime")
    });

    // Initialize daemon
    let daemon_result = runtime.block_on(async {
        AetherCoreDaemon::new(storage_path_str, hardware_id_str).await
    });

    match daemon_result {
        Ok(daemon) => {
            let daemon_lock = DAEMON.get_or_init(|| Arc::new(Mutex::new(None)));
            *daemon_lock.lock().unwrap() = Some(daemon);
            info!("AetherCore daemon initialized successfully");
            jni::sys::JNI_TRUE
        }
        Err(e) => {
            error!("Failed to initialize daemon: {:?}", e);
            jni::sys::JNI_FALSE
        }
    }
}

/// Start the AetherCore daemon
#[no_mangle]
pub unsafe extern "C" fn Java_com_aethercore_atak_trustoverlay_core_RalphieNodeDaemon_nativeStartDaemon(
    _env: JNIEnv,
    _class: JClass,
) -> jboolean {
    info!("AetherCore JNI: nativeStartDaemon called");

    let daemon_lock = match DAEMON.get() {
        Some(lock) => lock,
        None => {
            error!("Daemon not initialized");
            return jni::sys::JNI_FALSE;
        }
    };

    let mut daemon_guard = daemon_lock.lock().unwrap();
    match daemon_guard.as_mut() {
        Some(daemon) => {
            if let Err(e) = daemon.start() {
                error!("Failed to start daemon: {:?}", e);
                jni::sys::JNI_FALSE
            } else {
                info!("AetherCore daemon started");
                jni::sys::JNI_TRUE
            }
        }
        None => {
            error!("Daemon not initialized");
            jni::sys::JNI_FALSE
        }
    }
}

/// Stop the AetherCore daemon
#[no_mangle]
pub unsafe extern "C" fn Java_com_aethercore_atak_trustoverlay_core_RalphieNodeDaemon_nativeStopDaemon(
    _env: JNIEnv,
    _class: JClass,
) -> jboolean {
    info!("AetherCore JNI: nativeStopDaemon called");

    let daemon_lock = match DAEMON.get() {
        Some(lock) => lock,
        None => {
            warn!("Daemon not initialized");
            return jni::sys::JNI_TRUE; // Already stopped
        }
    };

    let mut daemon_guard = daemon_lock.lock().unwrap();
    match daemon_guard.as_mut() {
        Some(daemon) => {
            daemon.stop();
            info!("AetherCore daemon stopped");
            jni::sys::JNI_TRUE
        }
        None => {
            warn!("Daemon not initialized");
            jni::sys::JNI_TRUE
        }
    }
}

/// Trigger an Aetheric Sweep (Byzantine node quarantine protocol)
#[no_mangle]
pub unsafe extern "C" fn Java_com_aethercore_atak_trustoverlay_core_RalphieNodeDaemon_nativeTriggerAethericSweep(
    _env: JNIEnv,
    _class: JClass,
) -> jboolean {
    info!("AetherCore JNI: nativeTriggerAethericSweep called");

    let daemon_lock = match DAEMON.get() {
        Some(lock) => lock,
        None => {
            error!("Daemon not initialized");
            return jni::sys::JNI_FALSE;
        }
    };

    let daemon_guard = daemon_lock.lock().unwrap();
    match daemon_guard.as_ref() {
        Some(daemon) => {
            if let Err(e) = daemon.trigger_aetheric_sweep() {
                error!("Failed to trigger Aetheric Sweep: {:?}", e);
                jni::sys::JNI_FALSE
            } else {
                info!("Aetheric Sweep triggered");
                jni::sys::JNI_TRUE
            }
        }
        None => {
            error!("Daemon not initialized");
            jni::sys::JNI_FALSE
        }
    }
}

