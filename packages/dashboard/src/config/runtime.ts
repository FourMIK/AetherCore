import { invoke } from '@tauri-apps/api/core';

export type UnifiedProfile = 'commander-local' | 'training-testnet' | 'enterprise-remote';
export type TpmMode = 'required' | 'optional' | 'disabled';
export type AttestationMode = TpmMode;
export type AndroidBackendCapability = 'strongbox_available' | 'tee_fallback' | 'unavailable';

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
  attestation_policy: {
    mode: AttestationMode;
    enforce_hardware: boolean;
    backends: {
      tpm: {
        mode: AttestationMode;
      };
      android_keystore: {
        mode: AttestationMode;
      };
    };
  };
  startup_probe?: {
    android_backend_available: boolean;
    android_backend_capability: AndroidBackendCapability;
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
  REACT_APP_TPM_ENABLED?: string;
}

const runtimeEnv = (globalThis as unknown as Window & { __ENV__?: RuntimeEnv }).__ENV__ ?? {};

let runtimeConfigCache: UnifiedRuntimeConfig | null = null;

export function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  const normalized = value.toLowerCase().trim();
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  return defaultValue;
}

export function validateUnifiedRuntimeConfig(input: UnifiedRuntimeConfig): UnifiedRuntimeConfig {
  if (![4, 3, 2].includes(input.schema_version)) throw new Error('Unsupported runtime config schema version');
  if (!['commander-local', 'training-testnet', 'enterprise-remote'].includes(input.profile)) {
    throw new Error('Invalid profile');
  }
  if (input.ports.api < 1 || input.ports.api > 65535 || input.ports.mesh < 1 || input.ports.mesh > 65535) {
    throw new Error('ports.api and ports.mesh must be in range 1-65535');
  }

  const validModes: AttestationMode[] = ['required', 'optional', 'disabled'];
  const normalizedAttestationPolicy =
    input.attestation_policy ?? {
      mode: input.tpm_policy.mode,
      enforce_hardware: input.tpm_policy.enforce_hardware,
      backends: {
        tpm: {
          mode: input.tpm_policy.mode,
        },
        android_keystore: {
          mode: 'optional' as AttestationMode,
        },
      },
    };

  const tpmMode = normalizedAttestationPolicy.backends?.tpm?.mode ?? input.tpm_policy.mode;
  const androidMode = normalizedAttestationPolicy.backends?.android_keystore?.mode ?? 'optional';

  if (!validModes.includes(normalizedAttestationPolicy.mode) || !validModes.includes(tpmMode) || !validModes.includes(androidMode)) {
    throw new Error('Invalid attestation policy mode');
  }

  if (normalizedAttestationPolicy.mode === 'required' && tpmMode === 'disabled' && androidMode === 'disabled') {
    throw new Error('attestation_policy.mode is required but all backends are disabled');
  }

  if (normalizedAttestationPolicy.mode === 'disabled' && (tpmMode === 'required' || androidMode === 'required')) {
    throw new Error('attestation_policy.backends.<backend>.mode cannot be required when attestation_policy.mode is disabled');
  }

  if (input.tpm_policy.enforce_hardware && input.tpm_policy.mode === 'disabled') {
    throw new Error('tpm_policy.enforce_hardware cannot be true when tpm_policy.mode is disabled');
  }

  input.attestation_policy = {
    mode: normalizedAttestationPolicy.mode,
    enforce_hardware: normalizedAttestationPolicy.enforce_hardware,
    backends: {
      tpm: { mode: tpmMode },
      android_keystore: { mode: androidMode },
    },
  };

  return input;
}


export function buildEnvFallbackConfig(): UnifiedRuntimeConfig {
  const apiEndpoint = runtimeEnv.REACT_APP_API_URL || import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000';
  const meshEndpoint = runtimeEnv.REACT_APP_WS_URL || import.meta.env.VITE_GATEWAY_URL || 'ws://127.0.0.1:8080';
  // TPM fallback policy is optional by default and only enforced when explicitly enabled.
  const enforceHardware = parseBooleanEnv(runtimeEnv.REACT_APP_TPM_ENABLED || import.meta.env.VITE_TPM_ENABLED, false);

  return {
    schema_version: 4,
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
    attestation_policy: {
      mode: enforceHardware ? 'required' : 'optional',
      enforce_hardware: enforceHardware,
      backends: {
        tpm: {
          mode: enforceHardware ? 'required' : 'optional',
        },
        android_keystore: {
          mode: 'optional',
        },
      },
    },
    ports: {
      api: 3000,
      mesh: 8080,
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

  return {
    unified,
    apiUrl: unified.connection.api_endpoint,
    wsUrl: unified.connection.mesh_endpoint,
    tpmEnabled: unified.tpm_policy.enforce_hardware,
    devAllowInsecureLocalhost: unified.features.allow_insecure_localhost,
  };
}
