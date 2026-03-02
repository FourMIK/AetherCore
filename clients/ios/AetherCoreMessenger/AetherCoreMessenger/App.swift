//
// App.swift
// AetherCoreMessenger
//
// AetherCore iOS Client - Hardware-Rooted Trust Fabric
// Classification: CRITICAL
// Purpose: SwiftUI App entry point with Secure Enclave availability enforcement
//
// Fail-Visible: Fatal error if Secure Enclave is unavailable
// No simulator support - device-only deployment

import SwiftUI
import Security

@main
struct AetherCoreMessengerApp: App {
    
    init() {
        // Fail-Visible: Enforce Secure Enclave availability at launch
        // Per AetherCore doctrine: Trust by Policy is replaced with Cryptographic Certainty
        #if targetEnvironment(simulator)
        fatalError("""
            ❌ FAIL-VISIBLE: Simulator detected
            
            AetherCore requires hardware-rooted trust via Secure Enclave.
            Simulator deployment is explicitly unsupported.
            
            Deploy to a physical iOS device with Secure Enclave capability.
            """)
        #endif
        
        // Verify Secure Enclave availability on device
        guard SecureEnclaveKeyManager.isSecureEnclaveAvailable() else {
            fatalError("""
                ❌ FAIL-VISIBLE: Secure Enclave unavailable
                
                This device does not support Secure Enclave or the capability is disabled.
                AetherCore cannot operate without hardware-rooted key storage.
                
                Requirements:
                - iOS device with Secure Enclave (iPhone 5s+, iPad Air 2+)
                - Device passcode must be set
                - Biometric authentication enabled (recommended)
                """)
        }
        
        print("✅ AetherCore initialized - Secure Enclave available")
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
