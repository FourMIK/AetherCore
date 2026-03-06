/**
 * Tauri Command Error Handling Utilities
 * 
 * Provides type-safe wrappers for Tauri commands with proper error handling.
 * All errors are caught, logged, and presented to the user with actionable feedback.
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';

/**
 * Error toast notification function type
 * 
 * This function is called whenever a Tauri command fails with an error.
 * Implement this to integrate with your UI library's notification/toast system.
 * 
 * @param title - The error title (e.g., "Configuration Error", "Connection Failed")
 * @param message - The detailed error message from the backend
 * 
 * @example
 * ```typescript
 * import { setErrorNotifier } from './api/tauri-commands';
 * import { toast } from 'your-toast-library';
 * 
 * setErrorNotifier((title, message) => {
 *   toast.error(message, { title });
 * });
 * ```
 */
type ErrorNotifier = (title: string, message: string) => void;

let errorNotifier: ErrorNotifier = (title, message) => {
  console.error(`[${title}]`, message);
  // Default implementation - replace with your toast library
  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(`${title}\n\n${message}`);
  }
};

function isTauriRuntimeAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Set the error notification handler
 * Call this during app initialization with your preferred toast/notification system
 */
export function setErrorNotifier(notifier: ErrorNotifier) {
  errorNotifier = notifier;
}

/**
 * Wrapped invoke function with automatic error handling
 * 
 * @param command - The Tauri command to invoke
 * @param args - Arguments to pass to the command
 * @param options - Optional configuration
 * @returns Promise with the command result
 * 
 * @example
 * ```typescript
 * const result = await safeInvoke<string>('connect_to_mesh', {
 *   endpoint: 'wss://mesh.example.com'
 * });
 * 
 * if (result.success) {
 *   console.log('Connected:', result.data);
 * } else {
 *   // Error already shown to user
 *   console.error('Connection failed');
 * }
 * ```
 */
export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
  options?: {
    silent?: boolean; // Don't show error notification
    errorTitle?: string; // Custom error title
  }
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  if (!isTauriRuntimeAvailable()) {
    const errorMessage = 'Tauri runtime not available. This feature requires the desktop app.';
    if (!options?.silent) {
      errorNotifier(options?.errorTitle || `Command Failed: ${command}`, errorMessage);
    }
    return { success: false, error: errorMessage };
  }
  try {
    const data = await tauriInvoke<T>(command, args);
    return { success: true, data };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    console.error(`[Tauri Command Error: ${command}]`, errorMessage);
    
    if (!options?.silent) {
      errorNotifier(
        options?.errorTitle || `Command Failed: ${command}`,
        errorMessage
      );
    }
    
    return { success: false, error: errorMessage };
  }
}

/**
 * Invoke a Tauri command and throw on error
 * Use this when you want to handle errors in a try/catch block
 * 
 * @example
 * ```typescript
 * try {
 *   const config = await invokeOrThrow<AppConfig>('get_config');
 *   console.log('Config:', config);
 * } catch (err) {
 *   // Handle error
 * }
 * ```
 */
export async function invokeOrThrow<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(`${command}: Tauri runtime not available. This feature requires the desktop app.`);
  }
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Tauri Command Error: ${command}]`, errorMessage);
    throw new Error(`${command}: ${errorMessage}`);
  }
}

/**
 * Type-safe Tauri command definitions
 * Add your commands here for type safety and IDE autocomplete
 */
export interface StackStatus {
  ready: boolean;
  required_services: number;
  healthy_required_services: number;
  services: Array<{ name: string; required: boolean; healthy: boolean; remediation_hint: string }>;
}

export interface ConnectivityCheck {
  api_healthy: boolean;
  websocket_reachable: boolean;
  details: string[];
}

export interface DeploymentStatus {
  node_id: string;
  pid: number;
  port: number;
  started_at: number;
  status: string;
}

export interface CandidateNode {
  type: 'USB' | 'NET';
  id: string;
  label: string;
  transport?: 'usb-serial' | 'usb-mass-storage' | 'network' | 'bluetooth-serial';
  hardware_profile?: string;
}

export interface SerialDeviceInfo {
  port_name: string;
  port_type: string;
  manufacturer: string | null;
  product: string | null;
  serial_number: string | null;
}

export interface GenesisMessage {
  type: string;
  root: string;
  pub_key: string;
}

export interface ProvisioningIdentity {
  node_id: string;
  public_key: string;
  root_hash: string;
  timestamp: number;
  device_type: string;
  callsign?: string;
}

export interface ProvisioningResult {
  status: 'SUCCESS' | 'FAILURE';
  identity: ProvisioningIdentity;
}

export interface LicenseInventoryEntry {
  package_name: string;
  version: string;
  license: string;
  license_hash: string | null;
  ecosystem: string;
  compliance_status: 'APPROVED' | 'FLAGGED' | 'UNKNOWN';
}

export interface LicenseInventory {
  total_dependencies: number;
  approved_count: number;
  flagged_count: number;
  unknown_count: number;
  entries: LicenseInventoryEntry[];
  manifest_hash: string | null;
  last_verification: number | null;
}

export const TauriCommands = {
  // Runtime and bootstrap
  getStackStatus: () => safeInvoke<StackStatus>('stack_status', undefined, {
    errorTitle: 'Stack Status Error',
    silent: true,
  }),
  startStack: () => safeInvoke<StackStatus>('start_stack', undefined, {
    errorTitle: 'Stack Startup Error',
  }),
  initializeLocalDataDirs: () => safeInvoke<string[]>('initialize_local_data_dirs', undefined, {
    errorTitle: 'Bootstrap Failure',
  }),
  verifyDashboardConnectivity: (
    apiHealthEndpoint?: string,
    websocketEndpoint?: string
  ) => safeInvoke<ConnectivityCheck>(
    'verify_dashboard_connectivity',
    {
      apiHealthEndpoint,
      websocketEndpoint,
    },
    {
      errorTitle: 'Connectivity Error',
    }
  ),
  setBootstrapState: (completed: boolean) => safeInvoke<unknown>('set_bootstrap_state', { completed }, {
    errorTitle: 'Bootstrap State Error',
  }),
  getBootstrapState: () => safeInvoke<{ completed: boolean }>('get_bootstrap_state', undefined, {
    errorTitle: 'Bootstrap State Error',
    silent: true,
  }),
  repairStack: () => safeInvoke<unknown>('repair_stack', undefined, {
    errorTitle: 'Repair Failed',
  }),
  installerBootstrapRequested: () => safeInvoke<boolean>('installer_bootstrap_requested', undefined, {
    silent: true,
  }),

  // Configuration commands
  getConfig: () => safeInvoke<AppConfig>('get_config', undefined, {
    errorTitle: 'Configuration Error',
  }),
  
  updateConfig: (config: AppConfig) => safeInvoke<string>('update_config', { config }, {
    errorTitle: 'Configuration Error',
  }),
  
  getConfigPath: () => safeInvoke<string>('get_config_path', undefined, {
    silent: true,
  }),

  getSentinelTrustStatus: () => safeInvoke<SentinelTrustStatus>('get_sentinel_trust_status', undefined, {
    silent: true,
  }),
  
  // Connection commands
  connectToMesh: (endpoint: string) => safeInvoke<string>('connect_to_mesh', { endpoint }, {
    errorTitle: 'Connection Error',
  }),
  
  connectToTestnet: (endpoint?: string) => safeInvoke<string>('connect_to_testnet', { endpoint }, {
    errorTitle: 'Connection Error',
  }),
  
  // Genesis bundle commands
  generateGenesisBundle: (userIdentity: string, squadId: string) =>
    safeInvoke<GenesisBundle>('generate_genesis_bundle', 
      { userIdentity, squadId },
      { errorTitle: 'Genesis Bundle Error' }
    ),
  
  bundleToQrData: (bundle: GenesisBundle) => safeInvoke<string>('bundle_to_qr_data', { bundle }),

  // Identity registry + telemetry verification
  createNode: (nodeId: string, domain: string) => safeInvoke<string>('create_node', { nodeId, domain }, {
    errorTitle: 'Node Provisioning Error',
  }),
  verifyTelemetrySignature: (payload: TelemetryPayload) => safeInvoke<boolean>('verify_telemetry_signature', { payload }, {
    errorTitle: 'Telemetry Verification Error',
    silent: true,
  }),
  
  // Heartbeat signing
  signHeartbeatPayload: (nonce: string) => safeInvoke<string>('sign_heartbeat_payload', { nonce }, {
    errorTitle: 'TPM Signing Error',
  }),
  getHeartbeatDeviceId: () => safeInvoke<string>('get_heartbeat_device_id', undefined, {
    errorTitle: 'Heartbeat Identity Error',
    silent: true,
  }),

  // Diagnostics and supportability
  diagnosticsReport: () => safeInvoke<DiagnosticsReport>('diagnostics_report', undefined, {
    errorTitle: 'Diagnostics Error',
  }),

  collectSupportBundle: () => safeInvoke<SupportBundleSummary>('collect_support_bundle', undefined, {
    errorTitle: 'Support Bundle Error',
  }),

  repairInstallation: () => safeInvoke<unknown>('repair_installation', undefined, {
    errorTitle: 'Repair Failed',
  }),

  resetLocalStack: () => safeInvoke<unknown>('reset_local_stack', undefined, {
    errorTitle: 'Reset Failed',
  }),

  // Onboarding / provisioning
  scanForAssets: () => safeInvoke<CandidateNode[]>('scan_for_assets', undefined, {
    errorTitle: 'Asset Scan Error',
  }),
  listSerialPorts: () => safeInvoke<SerialDeviceInfo[]>('list_serial_ports', undefined, {
    errorTitle: 'Serial Port Error',
  }),
  flashFirmware: (port: string, firmwarePath: string) => safeInvoke<string>(
    'flash_firmware',
    { port, firmwarePath },
    { errorTitle: 'Firmware Flash Error' }
  ),
  listenForGenesis: (port: string) => safeInvoke<GenesisMessage>('listen_for_genesis', { port }, {
    errorTitle: 'Genesis Discovery Error',
  }),
  provisionTarget: (target: CandidateNode, credentials: Record<string, string> | null, firmwarePath: string | null) =>
    safeInvoke<ProvisioningResult>(
      'provision_target',
      { target, credentials, firmwarePath },
      { errorTitle: 'Provisioning Error' }
    ),

  // Deployment management
  getDeploymentStatus: () => safeInvoke<DeploymentStatus[]>('get_deployment_status', undefined, {
    errorTitle: 'Deployment Status Error',
    silent: true,
  }),
  deployNode: (config: {
    node_id: string;
    mesh_endpoint: string;
    listen_port: number;
    data_dir: string;
    log_level: string;
  }) => safeInvoke<DeploymentStatus>('deploy_node', { config }, {
    errorTitle: 'Node Deployment Error',
  }),
  stopNode: (nodeId: string) => safeInvoke<unknown>('stop_node', { nodeId }, {
    errorTitle: 'Node Stop Error',
  }),
  getNodeLogs: (nodeId: string, tail = 500) => safeInvoke<string[]>('get_node_logs', { nodeId, tail }, {
    errorTitle: 'Node Logs Error',
  }),
  getLicenseInventory: () => safeInvoke<LicenseInventory>('get_license_inventory', undefined, {
    errorTitle: 'Compliance Error',
  }),
};



export interface DiagnosticCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | string;
  detail: string;
}

export interface RuntimeVersionInfo {
  name: string;
  version: string;
}

export interface TroubleshootingCard {
  failure_class: string;
  title: string;
  steps: string[];
}

export interface DiagnosticsReport {
  schema_version: number;
  generated_at_unix_secs: number;
  checks: DiagnosticCheck[];
  runtime_versions: RuntimeVersionInfo[];
  troubleshooting_cards: TroubleshootingCard[];
}

export interface SupportBundleSummary {
  schema_version: number;
  bundle_path: string;
  generated_at_unix_secs: number;
  file_count: number;
  diagnostics: DiagnosticsReport;
}

/**
 * Type definitions matching Rust structs
 */
export interface AppConfig {
  schema_version: number;
  product_profile: 'commander_edition' | string;
  profile: 'commander-local' | 'training-testnet' | 'enterprise-remote';
  connection: {
    api_endpoint: string;
    mesh_endpoint: string;
  };
  tpm_policy: {
    mode: 'required' | 'optional' | 'disabled';
    enforce_hardware: boolean;
  };
  ports: {
    api: number;
    mesh: number;
  };
  features: {
    allow_insecure_localhost: boolean;
    bootstrap_on_startup: boolean;
  };
  connection_retry: {
    max_retries: number;
    initial_delay_ms: number;
    max_delay_ms: number;
  };
}

export interface StartupProbe {
  policy_mode: 'required' | 'optional' | 'disabled';
  selected_backend: string;
  security_level: string;
  status: 'healthy' | 'degraded' | 'error';
  failure_reason: string | null;
}

export interface SentinelTrustStatus {
  trust_level: string;
  reduced_trust: boolean;
  headline: string;
  detail: string;
  startup_probe?: StartupProbe;
}

export interface GenesisBundle {
  user_identity: string;
  squad_id: string;
  public_key: string;
  signature: string;
  timestamp: number;
  signature_alg?: 'ed25519' | 'ecdsa_p256';
  signature_encoding?: 'base64' | 'hex';
  public_key_format?: 'ed25519_raw' | 'sec1' | 'spki';
}

export interface TelemetryPayload {
  node_id: string;
  data: unknown;
  signature: string;
  timestamp: number;
}
