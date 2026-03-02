//
// ContentView.swift
// AetherCoreMessenger
//
// AetherCore iOS Client - Minimal UI
// Purpose: Display device identity and Secure Enclave status
//
// Phase 1: No network connectivity - local identity only

import SwiftUI

struct ContentView: View {
    @State private var deviceIdentity: DeviceIdentity?
    @State private var errorMessage: String?
    @State private var isLoading = true
    
    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                // Header
                VStack(spacing: 8) {
                    Image(systemName: "lock.shield.fill")
                        .font(.system(size: 60))
                        .foregroundColor(.blue)
                    
                    Text("AetherCore Messenger")
                        .font(.title2)
                        .fontWeight(.bold)
                    
                    Text("Hardware-Rooted Trust Fabric")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.top, 40)
                
                Spacer()
                
                // Status Section
                if isLoading {
                    ProgressView("Initializing Secure Enclave...")
                        .padding()
                } else if let error = errorMessage {
                    // Fail-Visible error display
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.red)
                        
                        Text("Initialization Failed")
                            .font(.headline)
                            .foregroundColor(.red)
                        
                        Text(error)
                            .font(.caption)
                            .multilineTextAlignment(.center)
                            .foregroundColor(.secondary)
                            .padding(.horizontal)
                    }
                    .padding()
                } else if let identity = deviceIdentity {
                    // Success - display device identity
                    VStack(spacing: 16) {
                        // Status indicator
                        HStack {
                            Circle()
                                .fill(Color.green)
                                .frame(width: 12, height: 12)
                            Text("Secure Enclave Active")
                                .font(.subheadline)
                                .fontWeight(.medium)
                        }
                        
                        Divider()
                        
                        // Device fingerprint
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Device Fingerprint")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            Text(identity.deviceFingerprint)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundColor(.primary)
                                .padding(8)
                                .background(Color.secondary.opacity(0.1))
                                .cornerRadius(4)
                        }
                        
                        // Public key status
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Public Key Status")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            HStack {
                                Image(systemName: identity.hasKey ? "checkmark.circle.fill" : "xmark.circle.fill")
                                    .foregroundColor(identity.hasKey ? .green : .red)
                                Text(identity.hasKey ? "Key Present" : "Key Missing")
                                    .font(.subheadline)
                            }
                        }
                        
                        Divider()
                        
                        // Info notice
                        VStack(spacing: 8) {
                            Image(systemName: "info.circle")
                                .foregroundColor(.blue)
                            
                            Text("Network connectivity not yet implemented.\nKey generation and attestation ready.")
                                .font(.caption)
                                .multilineTextAlignment(.center)
                                .foregroundColor(.secondary)
                        }
                        .padding()
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(8)
                    }
                    .padding()
                }
                
                Spacer()
                
                // Version footer
                Text("Version 0.1.0 - Development Build")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .padding(.bottom, 20)
            }
            .navigationBarTitleDisplayMode(.inline)
            .padding()
        }
        .onAppear {
            initializeIdentity()
        }
    }
    
    private func initializeIdentity() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            do {
                // Initialize device identity with Secure Enclave key
                let identity = try DeviceIdentity()
                self.deviceIdentity = identity
                self.isLoading = false
                
                print("✅ Device initialized: \(identity.deviceFingerprint)")
            } catch {
                // Fail-Visible: Display error prominently
                self.errorMessage = error.localizedDescription
                self.isLoading = false
                
                print("❌ FAIL-VISIBLE: Device initialization failed: \(error)")
            }
        }
    }
}

#Preview {
    ContentView()
}
