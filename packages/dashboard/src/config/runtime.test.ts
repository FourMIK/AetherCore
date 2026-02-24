import { afterEach, describe, expect, it, vi } from 'vitest';

const originalViteTpmEnabled = import.meta.env.VITE_TPM_ENABLED;

afterEach(() => {
  vi.resetModules();
  if (originalViteTpmEnabled === undefined) {
    delete import.meta.env.VITE_TPM_ENABLED;
  } else {
    import.meta.env.VITE_TPM_ENABLED = originalViteTpmEnabled;
  }
  delete (globalThis as typeof globalThis & { __ENV__?: Record<string, string> }).__ENV__;
});

describe('runtime TPM fallback behavior', () => {
  it('parseBooleanEnv defaults to false when value is missing', async () => {
    const { parseBooleanEnv } = await import('./runtime');

    expect(parseBooleanEnv(undefined, false)).toBe(false);
    expect(parseBooleanEnv('', false)).toBe(false);
    expect(parseBooleanEnv(undefined, true)).toBe(true);
  });

  it('parseBooleanEnv recognizes explicit boolean strings', async () => {
    const { parseBooleanEnv } = await import('./runtime');

    expect(parseBooleanEnv('true', false)).toBe(true);
    expect(parseBooleanEnv('on', false)).toBe(true);
    expect(parseBooleanEnv('false', true)).toBe(false);
    expect(parseBooleanEnv('off', true)).toBe(false);
    expect(parseBooleanEnv('invalid', false)).toBe(false);
  });

  it('buildEnvFallbackConfig keeps TPM optional and off by default', async () => {
    const { buildEnvFallbackConfig } = await import('./runtime');

    const config = buildEnvFallbackConfig();

    expect(config.tpm_policy.enforce_hardware).toBe(false);
    expect(config.tpm_policy.mode).toBe('optional');
  });

  it('buildEnvFallbackConfig enables required TPM policy when explicitly enabled', async () => {
    import.meta.env.VITE_TPM_ENABLED = 'true';
    const { buildEnvFallbackConfig } = await import('./runtime');

    const config = buildEnvFallbackConfig();

    expect(config.tpm_policy.enforce_hardware).toBe(true);
    expect(config.tpm_policy.mode).toBe('required');
  });

  it('getRuntimeConfig.tpmEnabled stays consistent with fallback TPM policy', async () => {
    const { getRuntimeConfig } = await import('./runtime');

    const runtime = getRuntimeConfig();

    expect(runtime.unified.tpm_policy.enforce_hardware).toBe(false);
    expect(runtime.unified.tpm_policy.mode).toBe('optional');
    expect(runtime.tpmEnabled).toBe(runtime.unified.tpm_policy.enforce_hardware);
    expect(runtime.tpmEnabled).toBe(false);
  });
});
