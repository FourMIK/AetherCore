import { invoke } from '@tauri-apps/api/core';

export interface UnifiedRuntimeConfig {
  schema_version: number;
  product_profile: 'commander_edition' | string;
  profile: 'local_control_plane' | 'testnet' | 'production_mesh';
  connection: {
    api_url: string;
    mesh_endpoint: string;
  };
  tpm: {
    mode: 'required' | 'optional' | 'disabled' | string;
    enforce_hardware: boolean;
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

interface RuntimeEnv {
  REACT_APP_API_URL?: string;
  REACT_APP_WS_URL?: string;
  REACT_APP_TPM_ENABLED?: string;
}

const runtimeEnv = (globalThis as unknown as Window & { __ENV__?: RuntimeEnv }).__ENV__ ?? {};

let runtimeConfigCache: UnifiedRuntimeConfig | null = null;

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const normalized = value.toLowerCase().trim();
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  console.warn(`Invalid boolean environment variable value: "${value}". Using default: ${defaultValue}`);
  return defaultValue;
}

function buildEnvFallbackConfig(): UnifiedRuntimeConfig {
  const apiUrl = runtimeEnv.REACT_APP_API_URL || import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000';
  const meshEndpoint = runtimeEnv.REACT_APP_WS_URL || import.meta.env.VITE_GATEWAY_URL || 'ws://127.0.0.1:8080';
  const enforceHardware = parseBooleanEnv(
    runtimeEnv.REACT_APP_TPM_ENABLED || import.meta.env.VITE_TPM_ENABLED,
    true
  );

  return {
    schema_version: 2,
    product_profile: 'commander_edition',
    profile: 'local_control_plane',
    connection: {
      api_url: apiUrl,
      mesh_endpoint: meshEndpoint,
    },
    tpm: {
      mode: enforceHardware ? 'required' : 'optional',
      enforce_hardware: enforceHardware,
    },
    features: {
      allow_insecure_localhost: parseBooleanEnv(import.meta.env.VITE_DEV_ALLOW_INSECURE_LOCALHOST, false),
      bootstrap_on_startup: true,
    },
    connection_retry: {
      max_retries: 10,
      initial_delay_ms: 1000,
      max_delay_ms: 30000,
    },
  };
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function loadUnifiedRuntimeConfig(): Promise<UnifiedRuntimeConfig> {
  if (runtimeConfigCache) {
    return runtimeConfigCache;
  }

  if (!isTauriRuntime()) {
    runtimeConfigCache = buildEnvFallbackConfig();
    return runtimeConfigCache;
  }

  try {
    runtimeConfigCache = await invoke<UnifiedRuntimeConfig>('get_config');
  } catch (error) {
    console.warn('Failed to load unified runtime config from Tauri, using env fallback:', error);
    runtimeConfigCache = buildEnvFallbackConfig();
  }

  return runtimeConfigCache;
}

export function setRuntimeConfig(config: UnifiedRuntimeConfig): void {
  runtimeConfigCache = config;
}

export function getRuntimeConfig() {
  const unified = runtimeConfigCache ?? buildEnvFallbackConfig();

  return {
    unified,
    apiUrl: unified.connection.api_url,
    wsUrl: unified.connection.mesh_endpoint,
    tpmEnabled: unified.tpm.enforce_hardware,
    devAllowInsecureLocalhost: unified.features.allow_insecure_localhost,
  };
}
