#[cfg(feature = "hardware-tpm-tests")]
use std::path::Path;

#[cfg(feature = "hardware-tpm-tests")]
use aethercore_identity::TpmManager;

#[cfg(feature = "hardware-tpm-tests")]
#[test]
fn test_hardware_tpm_quote_flow() {
    if !Path::new("/dev/tpm0").exists() && !Path::new("/dev/tpmrm0").exists() {
        eprintln!("Skipping hardware TPM integration test: no TPM device found.");
        return;
    }

    let mut manager = TpmManager::new(true);
    let ak = manager
        .generate_attestation_key("integration-ak".to_string())
        .expect("Failed to create hardware AK");

    let nonce = vec![0x42; 32];
    let quote = manager
        .generate_quote(nonce.clone(), &[0, 1, 2])
        .expect("Failed to generate hardware quote");

    assert!(manager.verify_quote(&quote, &ak));
}
