//
// OverlayRuntime.swift
// AetherCoreMessenger
//
// Purpose: Limited-release iOS overlay runtime that continuously publishes
// telemetry and signed Ralphie presence while app is active.
//

import Foundation
import UIKit
import DeviceCheck
import LocalAuthentication

struct OverlayRuntimeStatus {
    let isRunning: Bool
    let isConnected: Bool
    let nodeID: String
    let gatewayURL: URL
    let lastTelemetryAt: Date?
    let lastPresenceAt: Date?
    let signatureReady: Bool
    let hardwareEvidenceState: String
    let hardwareBacked: Bool
    let lastError: String?

    static func idle(nodeID: String, gatewayURL: URL) -> OverlayRuntimeStatus {
        OverlayRuntimeStatus(
            isRunning: false,
            isConnected: false,
            nodeID: nodeID,
            gatewayURL: gatewayURL,
            lastTelemetryAt: nil,
            lastPresenceAt: nil,
            signatureReady: false,
            hardwareEvidenceState: "pending",
            hardwareBacked: false,
            lastError: nil
        )
    }
}

enum OverlayRuntimeError: Error, CustomStringConvertible {
    case invalidHTTPResponse
    case httpError(statusCode: Int, body: String)
    case serializationFailed

    var description: String {
        switch self {
        case .invalidHTTPResponse:
            return "Invalid HTTP response"
        case .httpError(let statusCode, let body):
            return "HTTP \(statusCode): \(body)"
        case .serializationFailed:
            return "Serialization failed"
        }
    }
}

@MainActor
final class OverlayRuntime {
    enum PresenceReason: String, Codable {
        case startup
        case heartbeat
    }

    enum HardwareEvidenceState: String {
        case pending
        case fresh
        case stale
        case unavailable
        case failed
    }

    var onStatusUpdate: ((OverlayRuntimeStatus) -> Void)?

    private let identity: DeviceIdentity
    private let gatewayURL: URL
    private let telemetryURL: URL
    private let presenceURL: URL
    private let overlaySigningKeyManager = OverlaySigningKeyManager()
    private let userDefaults: UserDefaults
    private let heartbeatIntervalSeconds: TimeInterval
    private let attestationFreshnessWindowMs: Int64
    private let appAttestSupported = DCAppAttestService.shared.isSupported

    private var runtimeTask: Task<Void, Never>?
    private var isRunning = false
    private var signatureReady = false
    private var lastTelemetryAt: Date?
    private var lastPresenceAt: Date?
    private var lastError: String?
    private var hardwareEvidenceState: HardwareEvidenceState = .pending
    private var hardwareBacked = false
    private var backendReachable = false
    private var lastDisconnectReason = "unknown"
    private let overlayFirstSeenMs: Int64

    private static let overlayFirstSeenDefaultsKey = "overlay_first_seen_ms"
    private static let attestationTimestampDefaultsKey = "overlay_attestation_timestamp_ms"
    private static let defaultHeartbeatIntervalSeconds: TimeInterval = 5
    private static let defaultAttestationFreshnessWindowMs: Int64 = 24 * 60 * 60 * 1000

    init(
        identity: DeviceIdentity,
        gatewayURL: URL,
        userDefaults: UserDefaults = .standard,
        heartbeatIntervalSeconds: TimeInterval = OverlayRuntime.defaultHeartbeatIntervalSeconds,
        attestationFreshnessWindowMs: Int64 = OverlayRuntime.defaultAttestationFreshnessWindowMs
    ) {
        self.identity = identity
        self.gatewayURL = gatewayURL
        self.telemetryURL = gatewayURL.appendingPathComponent("api/telemetry")
        self.presenceURL = gatewayURL.appendingPathComponent("ralphie/presence")
        self.userDefaults = userDefaults
        self.heartbeatIntervalSeconds = heartbeatIntervalSeconds
        self.attestationFreshnessWindowMs = attestationFreshnessWindowMs

        let existingFirstSeen = Self.int64FromDefaults(userDefaults, key: Self.overlayFirstSeenDefaultsKey)
        if let existingFirstSeen {
            self.overlayFirstSeenMs = existingFirstSeen
        } else {
            let now = Self.currentTimestampMs()
            self.overlayFirstSeenMs = now
            userDefaults.set(now, forKey: Self.overlayFirstSeenDefaultsKey)
        }

        self.signatureReady = (try? overlaySigningKeyManager.publicKeyPEM()) != nil
        hydrateAttestationStateFromCache()
        publishStatus()
    }

    func start() {
        guard !isRunning else {
            return
        }
        isRunning = true
        publishStatus()

        runtimeTask = Task { [weak self] in
            guard let self else { return }
            await self.refreshAttestationEvidence()
            await self.sendPresence(reason: .startup)
            await self.sendTelemetry()

            while !Task.isCancelled && self.isRunning {
                do {
                    try await Task.sleep(nanoseconds: UInt64(self.heartbeatIntervalSeconds * 1_000_000_000))
                } catch {
                    break
                }
                if !self.isRunning {
                    break
                }
                await self.sendTelemetry()
                await self.sendPresence(reason: .heartbeat)
            }
        }
    }

    func stop() {
        isRunning = false
        runtimeTask?.cancel()
        runtimeTask = nil
        publishStatus()
    }

    private func sendTelemetry() async {
        let payload = OverlayTelemetryPayload(
            node_id: identity.deviceFingerprint,
            timestamp: Self.currentTimestampMs(),
            node_type: "tactical_edge",
            platform: "ios",
            hardware: OverlayHardwareInfo(
                manufacturer: "Apple",
                model: UIDevice.current.model,
                android_version: UIDevice.current.systemVersion,
                api_level: nil,
                security_patch: nil
            ),
            security: OverlaySecurityInfo(
                keystore_type: "ios_keychain_ed25519",
                hardware_backed: hardwareBacked,
                attestation_available: appAttestSupported,
                biometric_available: Self.biometricAvailable()
            ),
            trust: OverlayTrustInfo(
                self_score: hardwareBacked ? 100 : 65,
                peers_visible: 0,
                byzantine_detected: 0,
                merkle_vine_synced: true
            ),
            network: OverlayNetworkInfo(
                wifi_connected: backendReachable,
                backend_reachable: backendReachable,
                mesh_discovery_active: false
            ),
            atak: OverlayAtakInfo(
                installed: false,
                cot_listener_active: false,
                cot_messages_processed: 0
            ),
            native: OverlayNativeInfo(
                jni_loaded: false,
                architecture: Self.architecture()
            )
        )

        do {
            let data = try JSONEncoder().encode(payload)
            _ = try await postJSON(
                data: data,
                url: telemetryURL,
                headers: [
                    "X-Node-ID": identity.deviceFingerprint,
                    "X-Platform": "ios",
                    "X-AetherCore-Overlay": "ios"
                ]
            )
            backendReachable = true
            lastTelemetryAt = Date()
            lastError = nil
        } catch {
            let errorMessage = describe(error)
            backendReachable = false
            lastDisconnectReason = errorMessage
            lastError = "Telemetry failed: \(errorMessage)"
        }
        publishStatus()
    }

    private func sendPresence(reason: PresenceReason) async {
        let trustScore = hardwareBacked ? 1.0 : 0.65
        let telemetry = OverlayPresenceTelemetry(
            gps: nil,
            power: nil,
            radio: nil,
            device: OverlayPresenceDeviceTelemetry(
                model: UIDevice.current.model,
                firmware: UIDevice.current.systemVersion,
                transport: gatewayURL.scheme ?? "https",
                role: "ios-overlay"
            )
        )

        do {
            let publicKeyPem = try overlaySigningKeyManager.publicKeyPEM()
            signatureReady = true
            let unsignedPayload = OverlayPresenceUnsignedPayload(
                type: "RALPHIE_PRESENCE",
                reason: reason.rawValue,
                timestamp: Self.currentTimestampMs(),
                endpoint: websocketEndpoint(from: gatewayURL),
                last_disconnect_reason: lastDisconnectReason,
                identity: OverlayPresenceIdentity(
                    device_id: identity.deviceFingerprint,
                    public_key: publicKeyPem,
                    chat_public_key: nil,
                    hardware_serial: identity.deviceFingerprint,
                    certificate_serial: try overlaySigningKeyManager.certificateSerial(),
                    trust_score: trustScore,
                    enrolled_at: overlayFirstSeenMs,
                    tpm_backed: hardwareBacked
                ),
                telemetry: telemetry
            )

            let canonical = try stableJSONString(unsignedPayload)
            let signatureHex = try overlaySigningKeyManager.signHex(data: Data(canonical.utf8))
            let signedPayload = OverlayPresenceSignedPayload(unsignedPayload: unsignedPayload, signature: signatureHex)
            let body = try JSONEncoder().encode(signedPayload)

            _ = try await postJSON(
                data: body,
                url: presenceURL,
                headers: [
                    "X-Node-ID": identity.deviceFingerprint,
                    "X-Platform": "ios",
                    "X-AetherCore-Overlay": "ios"
                ]
            )
            backendReachable = true
            lastPresenceAt = Date()
            lastError = nil
        } catch {
            signatureReady = (try? overlaySigningKeyManager.publicKeyPEM()) != nil
            let errorMessage = describe(error)
            backendReachable = false
            lastDisconnectReason = errorMessage
            lastError = "Presence failed: \(errorMessage)"
        }
        publishStatus()
    }

    private func refreshAttestationEvidence() async {
        guard appAttestSupported else {
            hardwareEvidenceState = .unavailable
            hardwareBacked = false
            publishStatus()
            return
        }

        do {
            let manager = AttestationManager()
            _ = try await manager.generateAttestation(deviceFingerprint: identity.deviceFingerprint)
            let now = Self.currentTimestampMs()
            userDefaults.set(now, forKey: Self.attestationTimestampDefaultsKey)
            hardwareEvidenceState = .fresh
            hardwareBacked = true
            publishStatus()
        } catch {
            let now = Self.currentTimestampMs()
            if let timestamp = cachedAttestationTimestampMs(), now - timestamp <= attestationFreshnessWindowMs {
                hardwareEvidenceState = .fresh
                hardwareBacked = true
            } else {
                hardwareEvidenceState = .failed
                hardwareBacked = false
                lastError = "Attestation refresh failed: \(describe(error))"
            }
            publishStatus()
        }
    }

    private func hydrateAttestationStateFromCache() {
        let now = Self.currentTimestampMs()
        guard let timestamp = cachedAttestationTimestampMs() else {
            hardwareEvidenceState = appAttestSupported ? .pending : .unavailable
            hardwareBacked = false
            return
        }
        if now - timestamp <= attestationFreshnessWindowMs {
            hardwareEvidenceState = .fresh
            hardwareBacked = true
        } else {
            hardwareEvidenceState = .stale
            hardwareBacked = false
        }
    }

    private func cachedAttestationTimestampMs() -> Int64? {
        Self.int64FromDefaults(userDefaults, key: Self.attestationTimestampDefaultsKey)
    }

    private func publishStatus() {
        let now = Date()
        let telemetryFresh = lastTelemetryAt.map { now.timeIntervalSince($0) <= heartbeatIntervalSeconds * 3 } ?? false
        let presenceFresh = lastPresenceAt.map { now.timeIntervalSince($0) <= heartbeatIntervalSeconds * 3 } ?? false
        let status = OverlayRuntimeStatus(
            isRunning: isRunning,
            isConnected: isRunning && telemetryFresh && presenceFresh,
            nodeID: identity.deviceFingerprint,
            gatewayURL: gatewayURL,
            lastTelemetryAt: lastTelemetryAt,
            lastPresenceAt: lastPresenceAt,
            signatureReady: signatureReady,
            hardwareEvidenceState: hardwareEvidenceState.rawValue,
            hardwareBacked: hardwareBacked,
            lastError: lastError
        )
        onStatusUpdate?(status)
    }

    private func postJSON(data: Data, url: URL, headers: [String: String]) async throws -> Int {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = data
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }

        let (responseData, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw OverlayRuntimeError.invalidHTTPResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            let body = String(data: responseData, encoding: .utf8) ?? "<non-utf8>"
            throw OverlayRuntimeError.httpError(statusCode: httpResponse.statusCode, body: body)
        }
        return httpResponse.statusCode
    }

    private func stableJSONString<T: Encodable>(_ value: T) throws -> String {
        let encoded = try JSONEncoder().encode(value)
        let object = try JSONSerialization.jsonObject(with: encoded)
        let stableData = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard let json = String(data: stableData, encoding: .utf8) else {
            throw OverlayRuntimeError.serializationFailed
        }
        return json
    }

    private func websocketEndpoint(from url: URL) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url.absoluteString
        }
        if components.scheme == "https" {
            components.scheme = "wss"
        } else if components.scheme == "http" {
            components.scheme = "ws"
        }
        return components.string ?? url.absoluteString
    }

    private static func currentTimestampMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    private static func biometricAvailable() -> Bool {
        let context = LAContext()
        var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    }

    private static func architecture() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let machineMirror = Mirror(reflecting: systemInfo.machine)
        let identifier = machineMirror.children.reduce(into: "") { partialResult, element in
            guard let value = element.value as? Int8, value != 0 else { return }
            partialResult.append(String(UnicodeScalar(UInt8(value))))
        }
        return identifier.isEmpty ? "unknown" : identifier
    }

    private static func int64FromDefaults(_ defaults: UserDefaults, key: String) -> Int64? {
        guard let value = defaults.object(forKey: key) else {
            return nil
        }
        if let int64 = value as? Int64 {
            return int64
        }
        if let intValue = value as? Int {
            return Int64(intValue)
        }
        if let number = value as? NSNumber {
            return number.int64Value
        }
        return nil
    }

    private func describe(_ error: Error) -> String {
        if let custom = error as? CustomStringConvertible {
            return custom.description
        }
        return error.localizedDescription
    }
}

private struct OverlayTelemetryPayload: Codable {
    let node_id: String
    let timestamp: Int64
    let node_type: String
    let platform: String
    let hardware: OverlayHardwareInfo
    let security: OverlaySecurityInfo
    let trust: OverlayTrustInfo
    let network: OverlayNetworkInfo
    let atak: OverlayAtakInfo
    let native: OverlayNativeInfo
}

private struct OverlayHardwareInfo: Codable {
    let manufacturer: String
    let model: String
    let android_version: String?
    let api_level: Int?
    let security_patch: String?
}

private struct OverlaySecurityInfo: Codable {
    let keystore_type: String
    let hardware_backed: Bool
    let attestation_available: Bool
    let biometric_available: Bool
}

private struct OverlayTrustInfo: Codable {
    let self_score: Int
    let peers_visible: Int
    let byzantine_detected: Int
    let merkle_vine_synced: Bool
}

private struct OverlayNetworkInfo: Codable {
    let wifi_connected: Bool
    let backend_reachable: Bool
    let mesh_discovery_active: Bool
}

private struct OverlayAtakInfo: Codable {
    let installed: Bool
    let cot_listener_active: Bool
    let cot_messages_processed: Int
}

private struct OverlayNativeInfo: Codable {
    let jni_loaded: Bool
    let architecture: String
}

private struct OverlayPresenceUnsignedPayload: Codable {
    let type: String
    let reason: String
    let timestamp: Int64
    let endpoint: String
    let last_disconnect_reason: String
    let identity: OverlayPresenceIdentity
    let telemetry: OverlayPresenceTelemetry?
}

private struct OverlayPresenceSignedPayload: Codable {
    let type: String
    let reason: String
    let timestamp: Int64
    let endpoint: String
    let last_disconnect_reason: String
    let signature: String
    let identity: OverlayPresenceIdentity
    let telemetry: OverlayPresenceTelemetry?

    init(unsignedPayload: OverlayPresenceUnsignedPayload, signature: String) {
        self.type = unsignedPayload.type
        self.reason = unsignedPayload.reason
        self.timestamp = unsignedPayload.timestamp
        self.endpoint = unsignedPayload.endpoint
        self.last_disconnect_reason = unsignedPayload.last_disconnect_reason
        self.signature = signature
        self.identity = unsignedPayload.identity
        self.telemetry = unsignedPayload.telemetry
    }
}

private struct OverlayPresenceIdentity: Codable {
    let device_id: String
    let public_key: String?
    let chat_public_key: String?
    let hardware_serial: String
    let certificate_serial: String
    let trust_score: Double
    let enrolled_at: Int64
    let tpm_backed: Bool
}

private struct OverlayPresenceTelemetry: Codable {
    let gps: OverlayPresenceGpsTelemetry?
    let power: OverlayPresencePowerTelemetry?
    let radio: OverlayPresenceRadioTelemetry?
    let device: OverlayPresenceDeviceTelemetry?
}

private struct OverlayPresenceGpsTelemetry: Codable {
    let lat: Double?
    let lon: Double?
    let altitude_m: Double?
}

private struct OverlayPresencePowerTelemetry: Codable {
    let battery_pct: Double?
}

private struct OverlayPresenceRadioTelemetry: Codable {
    let snr_db: Double?
}

private struct OverlayPresenceDeviceTelemetry: Codable {
    let model: String?
    let firmware: String?
    let transport: String?
    let role: String?
}
