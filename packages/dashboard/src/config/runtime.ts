interface RuntimeEnv {
  REACT_APP_API_URL?: string;
  REACT_APP_WS_URL?: string;
  REACT_APP_TPM_ENABLED?: string;
}

const runtimeEnv = (globalThis as unknown as Window & { __ENV__?: RuntimeEnv }).__ENV__ ?? {};

/**
 * Parse boolean environment variable with standard rules:
 * - "false", "0", "no", "off" (case-insensitive) -> false
 * - "true", "1", "yes", "on" (case-insensitive) -> true
 * - undefined/empty -> defaultValue
 * - invalid value -> defaultValue (with console warning)
 */
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
  // Invalid value - log warning
  console.warn(`Invalid boolean environment variable value: "${value}". Valid values: true/false, 1/0, yes/no, on/off. Using default: ${defaultValue}`);
  return defaultValue;
}

export function getRuntimeConfig() {
  return {
    apiUrl: runtimeEnv.REACT_APP_API_URL || import.meta.env.VITE_API_URL || '',
    wsUrl: runtimeEnv.REACT_APP_WS_URL || import.meta.env.VITE_GATEWAY_URL || 'ws://localhost:8080',
    tpmEnabled: parseBooleanEnv(
      runtimeEnv.REACT_APP_TPM_ENABLED || import.meta.env.VITE_TPM_ENABLED,
      true // Default: TPM enabled
    ),
    devAllowInsecureLocalhost: parseBooleanEnv(
      import.meta.env.VITE_DEV_ALLOW_INSECURE_LOCALHOST,
      false // Default: disallow insecure localhost
    ),
  };
}
