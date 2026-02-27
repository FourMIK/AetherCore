use jni::objects::{JByteArray, JClass, JString};
use jni::sys::{jboolean, jstring, JNI_FALSE, JNI_TRUE};
use jni::JNIEnv;
use once_cell::sync::Lazy;
use std::sync::{Arc, Mutex};
use tracing::{error, info, warn};

use aethercore_identity::IdentityManager;

static DAEMON_STATE: Lazy<Arc<Mutex<DaemonState>>> =
    Lazy::new(|| Arc::new(Mutex::new(DaemonState::new())));

struct DaemonState {
    initialized: bool,
    running: bool,
    storage_path: Option<String>,
    hardware_id: Option<String>,
    identity_manager: Option<Arc<Mutex<IdentityManager>>>,
    #[allow(dead_code)]
    grpc_endpoint: String,
}

impl DaemonState {
    fn new() -> Self {
        let default_endpoint = std::env::var("IDENTITY_REGISTRY_ENDPOINT")
            .unwrap_or_else(|_| "http://localhost:50051".to_string());
        
        Self {
            initialized: false,
            running: false,
            storage_path: None,
            hardware_id: None,
            identity_manager: None,
            grpc_endpoint: default_endpoint,
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_aethercore_atak_trustoverlay_NativeBridge_nativeHealthcheck(
    env: JNIEnv,
    _class: JClass,
) -> jstring {
    env.new_string("aethercore-jni-ok")
        .expect("JNI string allocation failed")
        .into_raw()
}

#[no_mangle]
pub extern "system" fn Java_com_aethercore_atak_trustoverlay_core_RalphieNodeDaemon_nativeInitialize(
    mut env: JNIEnv,
    _class: JClass,
    storage_path: JString,
    hardware_id: JString,
) -> jboolean {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init();

    let storage_path_str: String = match env.get_string(&storage_path) {
        Ok(s) => s.into(),
        Err(e) => {
            error!("Failed to convert storage_path from JString: {}", e);
            return JNI_FALSE;
        }
    };

    let hardware_id_str: String = match env.get_string(&hardware_id) {
        Ok(s) => s.into(),
        Err(e) => {
            error!("Failed to convert hardware_id from JString: {}", e);
            return JNI_FALSE;
        }
    };

    info!(
        "Initializing RalphieNode daemon: storage_path={}, hardware_id={}",
        storage_path_str, hardware_id_str
    );

    let mut state = match DAEMON_STATE.lock() {
        Ok(s) => s,
        Err(e) => {
            error!("Failed to acquire daemon state lock: {}", e);
            return JNI_FALSE;
        }
    };

    if state.initialized {
        warn!("RalphieNode daemon already initialized");
        return JNI_TRUE;
    }

    let identity_manager = Arc::new(Mutex::new(IdentityManager::new()));

    state.storage_path = Some(storage_path_str.clone());
    state.hardware_id = Some(hardware_id_str);
    state.identity_manager = Some(identity_manager);
    state.initialized = true;

    info!("RalphieNode daemon initialized successfully");
    JNI_TRUE
}

#[no_mangle]
pub extern "system" fn Java_com_aethercore_atak_trustoverlay_core_RalphieNodeDaemon_nativeStartDaemon(
    _env: JNIEnv,
    _class: JClass,
) -> jboolean {
    info!("Starting RalphieNode daemon");

    let mut state = match DAEMON_STATE.lock() {
        Ok(s) => s,
        Err(e) => {
            error!("Failed to acquire daemon state lock: {}", e);
            return JNI_FALSE;
        }
    };

    if !state.initialized {
        error!("Cannot start daemon: not initialized");
        return JNI_FALSE;
    }

    if state.running {
        warn!("RalphieNode daemon already running");
        return JNI_TRUE;
    }

    state.running = true;
    info!("RalphieNode daemon started successfully");
    JNI_TRUE
}

#[no_mangle]
pub extern "system" fn Java_com_aethercore_atak_trustoverlay_core_RalphieNodeDaemon_nativeStopDaemon(
    _env: JNIEnv,
    _class: JClass,
) -> jboolean {
    info!("Stopping RalphieNode daemon");

    let mut state = match DAEMON_STATE.lock() {
        Ok(s) => s,
        Err(e) => {
            error!("Failed to acquire daemon state lock: {}", e);
            return JNI_FALSE;
        }
    };

    if !state.running {
        warn!("RalphieNode daemon not running");
        return JNI_TRUE;
    }

    state.running = false;
    info!("RalphieNode daemon stopped successfully");
    JNI_TRUE
}

#[no_mangle]
pub extern "system" fn Java_com_aethercore_atak_trustoverlay_core_RalphieNodeDaemon_nativeTriggerAethericSweep(
    _env: JNIEnv,
    _class: JClass,
) -> jboolean {
    info!("Triggering Aetheric Sweep");

    let state = match DAEMON_STATE.lock() {
        Ok(s) => s,
        Err(e) => {
            error!("Failed to acquire daemon state lock: {}", e);
            return JNI_FALSE;
        }
    };

    if !state.running {
        error!("Cannot trigger sweep: daemon not running");
        return JNI_FALSE;
    }

    info!("Aetheric Sweep triggered successfully");
    JNI_TRUE
}

#[no_mangle]
pub extern "system" fn Java_com_aethercore_atak_trustoverlay_cot_TrustEventParser_nativeVerifySignature(
    mut env: JNIEnv,
    _class: JClass,
    node_id: JString,
    payload: JByteArray,
    signature_hex: JString,
) -> jboolean {
    let node_id_str: String = match env.get_string(&node_id) {
        Ok(s) => s.into(),
        Err(e) => {
            error!("Failed to convert node_id from JString: {}", e);
            return JNI_FALSE;
        }
    };

    let payload_bytes = match env.convert_byte_array(&payload) {
        Ok(bytes) => bytes,
        Err(e) => {
            error!("Failed to convert payload from JByteArray: {}", e);
            return JNI_FALSE;
        }
    };

    let signature_hex_str: String = match env.get_string(&signature_hex) {
        Ok(s) => s.into(),
        Err(e) => {
            error!("Failed to convert signature_hex from JString: {}", e);
            return JNI_FALSE;
        }
    };

    let state = match DAEMON_STATE.lock() {
        Ok(s) => s,
        Err(e) => {
            error!("Failed to acquire daemon state lock: {}", e);
            return JNI_FALSE;
        }
    };

    if !state.running {
        warn!("Signature verification attempted but daemon not running");
        return JNI_FALSE;
    }

    info!(
        "Signature verification requested: node_id={}, payload_len={}, signature_len={}",
        node_id_str,
        payload_bytes.len(),
        signature_hex_str.len()
    );

    // TODO: Implement signature verification via one of these approaches:
    //
    // Option 1: Local verification with cached public keys
    // 1. Lookup public key for node_id from identity_manager
    // 2. Decode signature_hex to bytes
    // 3. Verify signature using ed25519-dalek
    //
    // Option 2: Remote verification via gRPC (recommended for consistency)
    // 1. Create gRPC client to Identity Registry service
    // 2. Call VerifySignature RPC with node_id, payload, signature_hex
    // 3. Return verification result
    //
    // For now, returning false until verification is implemented.
    // This ensures fail-visible behavior per agent instructions.

    JNI_FALSE
}
