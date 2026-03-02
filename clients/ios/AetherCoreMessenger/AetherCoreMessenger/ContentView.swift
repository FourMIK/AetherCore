//
// ContentView.swift
// AetherCoreMessenger
//
// AetherCore iOS Client - Minimal UI with Enrollment & Telemetry
// Purpose: Display device identity, enrollment status, and telemetry daemon control
//
// Features:
// - Device identity display
// - Gateway enrollment integration
// - Telemetry daemon control
// - Fail-visible error handling

import SwiftUI

struct ContentView: View {
    @State private var deviceIdentity: DeviceIdentity?
    @State private var errorMessage: String?
    @State private var isLoading = true
    @State private var isEnrolling = false
    @State private var enrollmentResult: EnrollmentResult?
    @State private var telemetryDaemon: NodeTelemetryDaemon?
    @State private var telemetryRunning = false
    
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
                    ScrollView {
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
                            
                            // Enrollment Section
                            VStack(spacing: 12) {
                                HStack {
                                    Image(systemName: enrollmentResult != nil ? "checkmark.shield.fill" : "shield")
                                        .foregroundColor(enrollmentResult != nil ? .green : .orange)
                                    Text(enrollmentResult != nil ? "Enrolled" : "Not Enrolled")
                                        .font(.subheadline)
                                        .fontWeight(.medium)
                                }
                                
                                if let enrollment = enrollmentResult {
                                    VStack(alignment: .leading, spacing: 8) {
                                        HStack {
                                            Text("Node ID:")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                            Text(enrollment.nodeID)
                                                .font(.caption)
                                                .fontWeight(.medium)
                                        }
                                        HStack {
                                            Text("Trust Score:")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                            Text(String(format: "%.2f", enrollment.trustScore))
                                                .font(.caption)
                                                .fontWeight(.medium)
                                        }
                                    }
                                } else {
                                    Button(action: {
                                        enrollDevice(identity: identity)
                                    }) {
                                        HStack {
                                            if isEnrolling {
                                                ProgressView()
                                                    .progressViewStyle(CircularProgressViewStyle())
                                                    .scaleEffect(0.8)
                                            }
                                            Text(isEnrolling ? "Enrolling..." : "Enroll with Gateway")
                                                .fontWeight(.medium)
                                        }
                                        .frame(maxWidth: .infinity)
                                        .padding()
                                        .background(Color.blue)
                                        .foregroundColor(.white)
                                        .cornerRadius(8)
                                    }
                                    .disabled(isEnrolling)
                                }
                            }
                            .padding()
                            .background(Color.secondary.opacity(0.1))
                            .cornerRadius(8)
                            
                            // Telemetry Section
                            if enrollmentResult != nil {
                                VStack(spacing: 12) {
                                    HStack {
                                        Image(systemName: telemetryRunning ? "antenna.radiowaves.left.and.right" : "antenna.radiowaves.left.and.right.slash")
                                            .foregroundColor(telemetryRunning ? .green : .gray)
                                        Text("Telemetry Daemon")
                                            .font(.subheadline)
                                            .fontWeight(.medium)
                                    }
                                    
                                    Text(telemetryRunning ? "Broadcasting heartbeat every 30s" : "Idle")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                    
                                    Button(action: {
                                        toggleTelemetry(identity: identity)
                                    }) {
                                        Text(telemetryRunning ? "Stop Telemetry" : "Start Telemetry")
                                            .fontWeight(.medium)
                                            .frame(maxWidth: .infinity)
                                            .padding()
                                            .background(telemetryRunning ? Color.red : Color.green)
                                            .foregroundColor(.white)
                                            .cornerRadius(8)
                                    }
                                }
                                .padding()
                                .background(Color.secondary.opacity(0.1))
                                .cornerRadius(8)
                            }
                        }
                        .padding()
                    }
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
                
                // Check if already enrolled
                let gatewayClient = GatewayClient()
                if gatewayClient.getAccessToken() != nil {
                    print("ℹ️ Device already enrolled - access token found")
                    // Note: Would need to fetch enrollment details from server
                }
            } catch {
                // Fail-Visible: Display error prominently
                self.errorMessage = error.localizedDescription
                self.isLoading = false
                
                print("❌ FAIL-VISIBLE: Device initialization failed: \(error)")
            }
        }
    }
    
    private func enrollDevice(identity: DeviceIdentity) {
        guard !isEnrolling else { return }
        
        isEnrolling = true
        
        Task {
            do {
                let gatewayClient = GatewayClient()
                let result = try await gatewayClient.enrollNode(identity: identity)
                
                await MainActor.run {
                    self.enrollmentResult = result
                    self.isEnrolling = false
                    print("✅ Enrollment successful: \(result.nodeID)")
                }
            } catch {
                await MainActor.run {
                    self.isEnrolling = false
                    self.errorMessage = "Enrollment failed: \(error.localizedDescription)"
                    print("❌ Enrollment error: \(error)")
                }
            }
        }
    }
    
    private func toggleTelemetry(identity: DeviceIdentity) {
        if telemetryRunning {
            // Stop telemetry
            telemetryDaemon?.stop()
            telemetryRunning = false
            print("✅ Telemetry stopped")
        } else {
            // Start telemetry
            let gatewayClient = GatewayClient()
            let daemon = NodeTelemetryDaemon(identity: identity, gatewayClient: gatewayClient)
            daemon.start(nodeID: enrollmentResult?.nodeID)
            
            self.telemetryDaemon = daemon
            self.telemetryRunning = true
            print("✅ Telemetry started")
        }
    }
}

#Preview {
    ContentView()
}
