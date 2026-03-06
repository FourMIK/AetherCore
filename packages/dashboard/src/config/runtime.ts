import { invoke } from '@tauri-apps/api/core';

export type UnifiedProfile = 'commander-local' | 'training-testnet' | 'enterprise-remote';
export type TpmMode = 'required' | 'optional' | 'disabled';

export interface UnifiedRuntimeConfig {
  schema_version: number;
  product_profile: 'commander_edition' | string;
  profile: UnifiedProfile;
  connection: {
    api_endpoint: string;
    mesh_endpoint: string;
  };
  tpm_policy: {
    mode: TpmMode;
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

interface RuntimeEnv {
  REACT_APP_API_URL?: string;
  REACT_APP_WS_URL?: string;
  REACT_APP_GATEWAY_WS_URL?: string;
  REACT_APP_TPM_ENABLED?: string;
  REACT_APP_DEMO_MODE?: string;
  REACT_APP_TELEMETRY_WS_URL?: string;
}

const runtimeEnv = (globalThis as unknown as Window & { __ENV__?: RuntimeEnv }).__ENV__ ?? {};

let runtimeConfigCache: UnifiedRuntimeConfig | null = null;

export type RuntimeMode = 'desktop' | 'web';

export interface RuntimeEndpointConfig {
  apiUrl: string;
  wsUrl: string;
  telemetryWebsocketUrl: string;
}

export type RuntimeModeConfig = {
  mode: RuntimeMode;
  isTauri: boolean;
};

const TELEMETRY_WS_FALLBACK = 'ws://localhost:8080';

export function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  const normalized = value.toLowerCase().trim();
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  return defaultValue;
}

export function validateUnifiedRuntimeConfig(input: UnifiedRuntimeConfig): UnifiedRuntimeConfig {
  if (![3, 2].includes(input.schema_version)) throw new Error('Unsupported runtime config schema version');
  if (!['commander-local', 'training-testnet', 'enterprise-remote'].includes(input.profile)) {
    throw new Error('Invalid profile');
  }
  if (input.ports.api < 1 || input.ports.api > 65535 || input.ports.mesh < 1 || input.ports.mesh > 65535) {
    throw new Error('ports.api and ports.mesh must be in range 1-65535');
  }
  return input;
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isDemoModeEnabled(): boolean {
  const demoFlag =
    runtimeEnv.REACT_APP_DEMO_MODE ||
    import.meta.env.VITE_DEMO_MODE ||
    import.meta.env.VITE_TACTICAL_DASHBOARD_DEMO;
  return parseBooleanEnv(demoFlag, false);
}

export function buildEnvFallbackConfig(): UnifiedRuntimeConfig {
  const apiEndpoint = runtimeEnv.REACT_APP_API_URL || import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const meshEndpoint =
    runtimeEnv.REACT_APP_WS_URL ||
    runtimeEnv.REACT_APP_GATEWAY_WS_URL ||
    import.meta.env.VITE_GATEWAY_URL ||
    'ws://localhost:3000';
  // TPM fallback policy is optional by default and only enforced when explicitly enabled.
  const enforceHardware = parseBooleanEnv(runtimeEnv.REACT_APP_TPM_ENABLED || import.meta.env.VITE_TPM_ENABLED, false);

  return {
    schema_version: 3,
    product_profile: 'commander_edition',
    profile: 'commander-local',
    connection: {
      api_endpoint: apiEndpoint,
      mesh_endpoint: meshEndpoint,
    },
    tpm_policy: {
      mode: enforceHardware ? 'required' : 'optional',
      enforce_hardware: enforceHardware,
    },
    ports: {
      api: 3000,
      mesh: 3000,
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

function normalizeWebSocketUrl(rawEndpoint: string): string {
  const trimmed = rawEndpoint.trim();
  if (!trimmed) {
    return TELEMETRY_WS_FALLBACK;
  }

  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
  const endpoint = hasProtocol ? trimmed : `ws://${trimmed}`;

  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'ws:';
    } else if (parsed.protocol === 'https:') {
      parsed.protocol = 'wss:';
    }
    return parsed.toString();
  } catch (error) {
    console.warn('[RUNTIME] Failed to normalize websocket endpoint, using fallback', { endpoint: rawEndpoint, error });
    return TELEMETRY_WS_FALLBACK;
  }
}

export async function loadUnifiedRuntimeConfig(): Promise<UnifiedRuntimeConfig> {
  if (runtimeConfigCache) return runtimeConfigCache;

  if (!isTauriRuntime()) {
    runtimeConfigCache = buildEnvFallbackConfig();
    return runtimeConfigCache;
  }

  try {
    runtimeConfigCache = validateUnifiedRuntimeConfig(await invoke<UnifiedRuntimeConfig>('get_config'));
  } catch (error) {
    console.warn('Failed to load unified runtime config from Tauri, using env fallback:', error);
    runtimeConfigCache = buildEnvFallbackConfig();
  }

  return runtimeConfigCache;
}

export function setRuntimeConfig(config: UnifiedRuntimeConfig): void {
  runtimeConfigCache = validateUnifiedRuntimeConfig(config);
}

export function getRuntimeConfig() {
  const unified = runtimeConfigCache ?? buildEnvFallbackConfig();
  const wsUrl = normalizeWebSocketUrl(unified.connection.mesh_endpoint);
  const telemetryWebsocketUrl = normalizeWebSocketUrl(
    runtimeEnv.REACT_APP_TELEMETRY_WS_URL ||
      import.meta.env.VITE_TELEMETRY_WS_URL ||
      wsUrl
  );

  return {
    unified,
    apiUrl: unified.connection.api_endpoint,
    wsUrl,
    telemetryWebsocketUrl,
    tpmEnabled: unified.tpm_policy.enforce_hardware,
    devAllowInsecureLocalhost: unified.features.allow_insecure_localhost,
    demoEnabled: isDemoModeEnabled(),
    transportMode: (isTauriRuntime() ? 'desktop' : 'web') as RuntimeMode,
    runtimeEndpoints: {
      apiUrl: unified.connection.api_endpoint,
      wsUrl,
      telemetryWebsocketUrl,
    } satisfies RuntimeEndpointConfig,
  };
}

export function getRuntimeEndpoints(): RuntimeEndpointConfig {
  return getRuntimeConfig().runtimeEndpoints;
}

export function getTelemetryWebsocketUrl(): string {
  return getRuntimeConfig().telemetryWebsocketUrl;
}

export function isDemoMode(): boolean {
  return isDemoModeEnabled();
}

export function getRuntimeMode(): RuntimeModeConfig {
  const isTauri = isTauriRuntime();
  return {
    mode: (isTauri ? 'desktop' : 'web') as RuntimeMode,
    isTauri,
  };
}
