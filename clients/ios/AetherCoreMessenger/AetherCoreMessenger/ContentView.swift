//
// ContentView.swift
// AetherCoreMessenger
//
// AetherCore iOS Client - Limited Release Overlay UI
// Purpose: Display runtime overlay status and connection health while active.

import SwiftUI

@MainActor
final class OverlayViewModel: ObservableObject {
    @Published var deviceIdentity: DeviceIdentity?
    @Published var runtimeStatus: OverlayRuntimeStatus?
    @Published var errorMessage: String?
    @Published var isInitializing = true

    private var overlayRuntime: OverlayRuntime?

    func initializeIfNeeded() {
        guard overlayRuntime == nil else { return }

        do {
            let identity = try DeviceIdentity()
            let gatewayURL = resolveGatewayURL()
            let runtime = OverlayRuntime(identity: identity, gatewayURL: gatewayURL)
            runtime.onStatusUpdate = { [weak self] status in
                self?.runtimeStatus = status
            }

            deviceIdentity = identity
            overlayRuntime = runtime
            runtimeStatus = .idle(nodeID: identity.deviceFingerprint, gatewayURL: gatewayURL)
            isInitializing = false

            runtime.start()
            print("✅ Overlay runtime started for node \(identity.deviceFingerprint)")
        } catch {
            errorMessage = String(describing: error)
            isInitializing = false
            print("❌ FAIL-VISIBLE: Overlay initialization failed: \(error)")
        }
    }

    func handleScenePhaseChange(_ phase: ScenePhase) {
        guard let runtime = overlayRuntime else { return }
        switch phase {
        case .active:
            runtime.start()
        case .inactive, .background:
            runtime.stop()
        @unknown default:
            runtime.stop()
        }
    }

    func toggleRuntime() {
        guard let runtime = overlayRuntime else { return }
        if runtimeStatus?.isRunning == true {
            runtime.stop()
        } else {
            runtime.start()
        }
    }

    private func resolveGatewayURL() -> URL {
        if let configured = Bundle.main.object(forInfoDictionaryKey: "AETHERCORE_GATEWAY_URL") as? String,
           let parsed = URL(string: configured),
           let scheme = parsed.scheme,
           (scheme == "http" || scheme == "https") {
            return parsed
        }
        guard let fallback = URL(string: "https://gateway.aethercore.mil") else {
            fatalError("Invalid fallback gateway URL")
        }
        return fallback
    }
}

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var viewModel = OverlayViewModel()

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                VStack(spacing: 8) {
                    Image(systemName: "antenna.radiowaves.left.and.right.circle.fill")
                        .font(.system(size: 54))
                        .foregroundColor(.blue)

                    Text("AetherCore iOS Overlay")
                        .font(.title2)
                        .fontWeight(.bold)

                    Text("Limited Release - Ralphie Presence Mode")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.top, 28)

                if viewModel.isInitializing {
                    ProgressView("Initializing overlay runtime...")
                        .padding()
                } else if let errorMessage = viewModel.errorMessage {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.red)
                        Text("Overlay Initialization Failed")
                            .font(.headline)
                            .foregroundColor(.red)
                        Text(errorMessage)
                            .font(.caption)
                            .multilineTextAlignment(.center)
                            .foregroundColor(.secondary)
                    }
                    .padding()
                } else if let identity = viewModel.deviceIdentity, let runtimeStatus = viewModel.runtimeStatus {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            statusRow(
                                label: "Runtime",
                                value: runtimeStatus.isRunning ? "Running" : "Stopped",
                                color: runtimeStatus.isRunning ? .green : .gray
                            )
                            statusRow(
                                label: "Gateway Link",
                                value: runtimeStatus.isConnected ? "Connected" : "Disconnected",
                                color: runtimeStatus.isConnected ? .green : .orange
                            )
                            statusRow(
                                label: "Signature State",
                                value: runtimeStatus.signatureReady ? "Ready" : "Unavailable",
                                color: runtimeStatus.signatureReady ? .green : .red
                            )
                            statusRow(
                                label: "Hardware Evidence",
                                value: "\(runtimeStatus.hardwareEvidenceState) (\(runtimeStatus.hardwareBacked ? "backed" : "unbacked"))",
                                color: runtimeStatus.hardwareBacked ? .green : .orange
                            )

                            Divider()

                            infoBlock(label: "Node ID", value: runtimeStatus.nodeID)
                            infoBlock(label: "Device Fingerprint", value: identity.deviceFingerprint)
                            infoBlock(label: "Gateway URL", value: runtimeStatus.gatewayURL.absoluteString)
                            infoBlock(label: "Last Telemetry", value: formattedDate(runtimeStatus.lastTelemetryAt))
                            infoBlock(label: "Last Presence", value: formattedDate(runtimeStatus.lastPresenceAt))

                            if let lastError = runtimeStatus.lastError {
                                infoBlock(label: "Last Error", value: lastError, valueColor: .red)
                            }

                            Button(action: {
                                viewModel.toggleRuntime()
                            }) {
                                Text(runtimeStatus.isRunning ? "Stop Overlay Runtime" : "Start Overlay Runtime")
                                    .fontWeight(.medium)
                                    .frame(maxWidth: .infinity)
                                    .padding()
                                    .background(runtimeStatus.isRunning ? Color.red : Color.green)
                                    .foregroundColor(.white)
                                    .cornerRadius(8)
                            }
                        }
                        .padding()
                    }
                } else {
                    Text("Runtime unavailable")
                        .foregroundColor(.secondary)
                }

                Spacer()

                Text("Version 0.2.0 - TestFlight External")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .padding(.bottom, 16)
            }
        }
        .onAppear {
            viewModel.initializeIfNeeded()
        }
        .onChange(of: scenePhase) { _, newPhase in
            viewModel.handleScenePhaseChange(newPhase)
        }
    }

    private func statusRow(label: String, value: String, color: Color) -> some View {
        HStack {
            Circle()
                .fill(color)
                .frame(width: 10, height: 10)
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline)
                .fontWeight(.medium)
        }
    }

    private func infoBlock(label: String, value: String, valueColor: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
            Text(value)
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(valueColor)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.secondary.opacity(0.1))
                .cornerRadius(4)
        }
    }

    private func formattedDate(_ date: Date?) -> String {
        guard let date else { return "never" }
        let formatter = ISO8601DateFormatter()
        return formatter.string(from: date)
    }
}

#Preview {
    ContentView()
}
