//
// NodeTelemetryDaemon.swift
// AetherCoreMessenger
//
// AetherCore iOS Client - C2 Telemetry & Heartbeat
// Classification: CRITICAL
// Purpose: Continuous telemetry reporting to C2 router with cryptographic signatures
//
// Telemetry Flow:
// 1. Background loop every 30 seconds
// 2. Build payload: ISO8601 timestamp + deviceFingerprint + signature
// 3. Sign payload (timestamp || fingerprint) using DeviceIdentity.sign()
// 4. POST to C2 router endpoint with access token authentication
// 5. Fail-Visible on signature failures or HTTP errors
//
// Security Policy:
// - Signature mandatory for all telemetry (fail-visible on signature errors)
// - Access token required for authentication
// - ISO 8601 timestamps for replay attack detection
// - Success logs prefixed with ✅, errors with ❌

import Foundation

enum TelemetryError: Error, CustomStringConvertible {
    case notEnrolled
    case signatureGenerationFailed(Error)
    case networkError(Error)
    case httpError(statusCode: Int, message: String?)
    case serializationFailed(Error)
    case invalidResponse
    
    var description: String {
        switch self {
        case .notEnrolled:
            return "Device not enrolled - access token missing"
        case .signatureGenerationFailed(let error):
            return "❌ FAIL-VISIBLE: Signature generation failed: \(error.localizedDescription)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .httpError(let statusCode, let message):
            if let message = message {
                return "HTTP error \(statusCode): \(message)"
            } else {
                return "HTTP error \(statusCode)"
            }
        case .serializationFailed(let error):
            return "Serialization error: \(error.localizedDescription)"
        case .invalidResponse:
            return "Invalid response from C2 router"
        }
    }
}

/// Telemetry payload structure
struct TelemetryPayload: Codable {
    /// ISO 8601 timestamp
    let timestamp: String
    
    /// Device fingerprint (SHA-256 of public key)
    let deviceFingerprint: String
    
    /// Base64-encoded signature over (timestamp || fingerprint)
    let signature: String
    
    /// Node ID (if assigned during enrollment)
    let nodeID: String?
    
    /// Payload version
    let version: String
}

/// Node telemetry daemon for continuous C2 communication
class NodeTelemetryDaemon {
    
    // MARK: - Properties
    
    /// Device identity for signing operations
    private let identity: DeviceIdentity
    
    /// Gateway client for access token retrieval
    private let gatewayClient: GatewayClient
    
    /// C2 router base URL
    private let c2RouterURL: URL
    
    /// Telemetry interval (30 seconds)
    private let telemetryInterval: TimeInterval = 30.0
    
    /// Background task handle
    private var telemetryTask: Task<Void, Never>?
    
    /// Daemon running state
    private(set) var isRunning: Bool = false
    
    /// Node ID (assigned during enrollment, optional)
    private var nodeID: String?
    
    // MARK: - Initialization
    
    /// Initialize telemetry daemon
    /// - Parameters:
    ///   - identity: Device identity for signing
    ///   - gatewayClient: Gateway client for token retrieval
    ///   - c2RouterURL: C2 router endpoint (default: production)
    init(
        identity: DeviceIdentity,
        gatewayClient: GatewayClient,
        c2RouterURL: URL = URL(string: "https://c2.aethercore.mil")!
    ) {
        self.identity = identity
        self.gatewayClient = gatewayClient
        self.c2RouterURL = c2RouterURL
        print("✅ NodeTelemetryDaemon initialized - endpoint: \(c2RouterURL)")
    }
    
    // MARK: - Daemon Control
    
    /// Start telemetry daemon
    /// - Parameter nodeID: Optional node ID from enrollment
    func start(nodeID: String? = nil) {
        guard !isRunning else {
            print("ℹ️ Telemetry daemon already running")
            return
        }
        
        self.nodeID = nodeID
        isRunning = true
        
        print("✅ Starting telemetry daemon - interval: \(telemetryInterval)s")
        
        // Start background task
        telemetryTask = Task {
            await runTelemetryLoop()
        }
    }
    
    /// Stop telemetry daemon
    func stop() {
        guard isRunning else {
            print("ℹ️ Telemetry daemon not running")
            return
        }
        
        isRunning = false
        telemetryTask?.cancel()
        telemetryTask = nil
        
        print("✅ Telemetry daemon stopped")
    }
    
    // MARK: - Telemetry Loop
    
    /// Background telemetry loop (runs every 30 seconds)
    private func runTelemetryLoop() async {
        print("✅ Telemetry loop started")
        
        while isRunning && !Task.isCancelled {
            do {
                // Send telemetry heartbeat
                try await sendTelemetry()
                
                // Wait for next interval
                try await Task.sleep(nanoseconds: UInt64(telemetryInterval * 1_000_000_000))
            } catch is CancellationError {
                print("ℹ️ Telemetry loop cancelled")
                break
            } catch {
                print("⚠️ Telemetry error: \(error.localizedDescription)")
                // Continue running despite errors (retry on next interval)
                
                // Wait before retry
                do {
                    try await Task.sleep(nanoseconds: UInt64(telemetryInterval * 1_000_000_000))
                } catch {
                    break
                }
            }
        }
        
        print("ℹ️ Telemetry loop ended")
    }
    
    // MARK: - Telemetry Transmission
    
    /// Send telemetry heartbeat to C2 router
    /// - Throws: TelemetryError if transmission fails
    private func sendTelemetry() async throws {
        // Step 1: Verify enrollment (access token present)
        guard let accessToken = gatewayClient.getAccessToken() else {
            throw TelemetryError.notEnrolled
        }
        
        // Step 2: Build telemetry payload
        let formatter = ISO8601DateFormatter()
        let timestamp = formatter.string(from: Date())
        let deviceFingerprint = identity.deviceFingerprint
        
        // Step 3: Create signature over (timestamp || fingerprint)
        // Concatenate timestamp and fingerprint for signing
        let signatureData = "\(timestamp)||\(deviceFingerprint)".data(using: .utf8)!
        
        let signature: Data
        do {
            signature = try identity.sign(data: signatureData)
        } catch {
            // Fail-Visible: Signature failures are critical
            fatalError("""
                ❌ FAIL-VISIBLE: Telemetry signature generation failed
                
                Failed to sign telemetry payload with Secure Enclave key.
                Error: \(error.localizedDescription)
                
                This indicates a critical security failure.
                Telemetry cannot be trusted without valid signatures.
                """)
        }
        
        // Step 4: Build telemetry payload
        let payload = TelemetryPayload(
            timestamp: timestamp,
            deviceFingerprint: deviceFingerprint,
            signature: signature.base64EncodedString(),
            nodeID: nodeID,
            version: "0.1.0"
        )
        
        // Step 5: POST to C2 router
        let telemetryURL = c2RouterURL.appendingPathComponent("telemetry/heartbeat")
        var request = URLRequest(url: telemetryURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        
        do {
            let encoder = JSONEncoder()
            request.httpBody = try encoder.encode(payload)
        } catch {
            throw TelemetryError.serializationFailed(error)
        }
        
        // Send telemetry request
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw TelemetryError.networkError(error)
        }
        
        // Validate HTTP response
        guard let httpResponse = response as? HTTPURLResponse else {
            throw TelemetryError.invalidResponse
        }
        
        // Fail-Visible: HTTP errors are logged but don't crash (allow retry)
        guard httpResponse.statusCode == 200 else {
            let errorMessage = String(data: data, encoding: .utf8)
            throw TelemetryError.httpError(statusCode: httpResponse.statusCode, message: errorMessage)
        }
        
        // Success log
        print("✅ Telemetry heartbeat sent successfully - timestamp: \(timestamp)")
    }
    
    // MARK: - Manual Telemetry
    
    /// Send telemetry immediately (outside of automatic loop)
    /// - Throws: TelemetryError if transmission fails
    func sendTelemetryNow() async throws {
        try await sendTelemetry()
    }
}
