use aethercore_identity::{
    AndroidSecuritySignals, Attestation, IdentityManager, PlatformIdentity, TrustPolicyTier,
};
use std::collections::HashMap;

fn android_identity(
    id: &str,
    security_level: &str,
    extra: HashMap<String, String>,
) -> PlatformIdentity {
    PlatformIdentity {
        id: id.to_string(),
        public_key: vec![1, 2, 3, 4],
        attestation: Attestation::Android {
            challenge: b"nonce-android".to_vec(),
            signature: vec![9, 9, 9],
            public_key: vec![7, 7, 7],
            cert_chain: vec![vec![1, 2, 3]],
            security_signals: AndroidSecuritySignals {
                api_level: 34,
                verified_boot_state: "green".to_string(),
                device_locked: true,
                os_patch_level: "2024-04".to_string(),
                security_level: security_level.to_string(),
                extra,
            },
        },
        created_at: 1000,
        metadata: HashMap::new(),
    }
}

#[test]
fn integration_android_device_path_with_strongbox() {
    let manager = IdentityManager::new();
    let mut extra = HashMap::new();
    extra.insert("bootloader_locked".to_string(), "true".to_string());

    let identity = android_identity("android-strongbox-device", "strongbox", extra);
    let verification = manager.verify(&identity);

    assert!(verification.verified);
    assert_eq!(verification.policy_tier, TrustPolicyTier::Highest);
    assert!((verification.trust_score - 1.0).abs() < f64::EPSILON);
}

#[test]
fn integration_android_fallback_path_without_strongbox() {
    let manager = IdentityManager::new();
    let mut extra = HashMap::new();
    extra.insert("bootloader_locked".to_string(), "true".to_string());

    let identity = android_identity("android-tee-device", "trusted_environment", extra);
    let verification = manager.verify(&identity);

    assert!(verification.verified);
    assert_eq!(verification.policy_tier, TrustPolicyTier::MediumHigh);
    assert!((verification.trust_score - 0.85).abs() < f64::EPSILON);
}
