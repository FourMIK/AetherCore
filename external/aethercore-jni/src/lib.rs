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

    // Signature verification implementation
    // 1. Lookup public key from identity manager
    let identity_manager = match &state.identity_manager {
        Some(mgr) => mgr,
        None => {
            error!("Identity manager not initialized");
            return JNI_FALSE;
        }
    };

    let mgr = match identity_manager.lock() {
        Ok(m) => m,
        Err(e) => {
            error!("Failed to acquire identity manager lock: {}", e);
            return JNI_FALSE;
        }
    };

    let identity = match mgr.get(&node_id_str) {
        Some(id) => id,
        None => {
            warn!(
                "Signature verification failed: unknown node_id={}",
                node_id_str
            );
            return JNI_FALSE;
        }
    };

    // 2. Decode signature from hex
    let signature_bytes = match hex::decode(&signature_hex_str) {
        Ok(bytes) => bytes,
        Err(e) => {
            error!("Failed to decode signature hex: {}", e);
            return JNI_FALSE;
        }
    };

    if signature_bytes.len() != 64 {
        error!(
            "Invalid signature length: expected 64, got {}",
            signature_bytes.len()
        );
        return JNI_FALSE;
    }

    // 3. Parse public key as Ed25519 verifying key
    // Assuming public_key is stored as raw 32-byte Ed25519 public key
    use ed25519_dalek::{Signature, VerifyingKey, Verifier};

    if identity.public_key.len() != 32 {
        error!(
            "Invalid public key length: expected 32, got {}",
            identity.public_key.len()
        );
        return JNI_FALSE;
    }

    let verifying_key = match VerifyingKey::from_bytes(
        identity.public_key.as_slice().try_into().unwrap(),
    ) {
        Ok(key) => key,
        Err(e) => {
            error!("Failed to parse public key: {}", e);
            return JNI_FALSE;
        }
    };

    // 4. Parse signature
    let signature_array: [u8; 64] = match signature_bytes.as_slice().try_into() {
        Ok(arr) => arr,
        Err(_) => {
            error!("Failed to convert signature to array");
            return JNI_FALSE;
        }
    };
    let signature = Signature::from_bytes(&signature_array);

    // 5. Verify signature
    match verifying_key.verify(&payload_bytes, &signature) {
        Ok(()) => {
            info!("Signature verification successful for node_id={}", node_id_str);
            JNI_TRUE
        }
        Err(e) => {
            warn!(
                "Signature verification failed for node_id={}: {}",
                node_id_str, e
            );
            JNI_FALSE
        }
    }
}
