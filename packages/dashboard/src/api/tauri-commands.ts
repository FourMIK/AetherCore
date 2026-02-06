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
  if (typeof window !== 'undefined') {
    alert(`${title}\n\n${message}`);
  }
};

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
export const TauriCommands = {
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
  
  // Connection commands
  connectToMesh: (endpoint: string) => safeInvoke<string>('connect_to_mesh', { endpoint }, {
    errorTitle: 'Connection Error',
  }),
  
  connectToTestnet: (endpoint: string) => safeInvoke<string>('connect_to_testnet', { endpoint }, {
    errorTitle: 'Connection Error',
  }),
  
  // Genesis bundle commands
  generateGenesisBundle: (userIdentity: string, squadId: string) =>
    safeInvoke<GenesisBundle>('generate_genesis_bundle', 
      { userIdentity, squadId },
      { errorTitle: 'Genesis Bundle Error' }
    ),
  
  bundleToQrData: (bundle: GenesisBundle) => safeInvoke<string>('bundle_to_qr_data', { bundle }),
  
  // Heartbeat signing
  signHeartbeatPayload: (nonce: string) => safeInvoke<string>('sign_heartbeat_payload', { nonce }, {
    errorTitle: 'TPM Signing Error',
  }),
};

/**
 * Type definitions matching Rust structs
 */
export interface AppConfig {
  mesh_endpoint: string | null;
  testnet_endpoint: string | null;
  enforce_tpm: boolean;
  connection_retry: {
    max_retries: number;
    initial_delay_ms: number;
    max_delay_ms: number;
  };
}

export interface GenesisBundle {
  user_identity: string;
  squad_id: string;
  public_key: string;
  signature: string;
  timestamp: number;
}
