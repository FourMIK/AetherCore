import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SentinelTrustBanner } from './SentinelTrustBanner';
import type { SentinelTrustStatus } from '../../api/tauri-commands';

describe('SentinelTrustBanner', () => {
  let container: HTMLDivElement;
  let root: Root;

  const baseStatus: SentinelTrustStatus = {
    trust_level: 'full',
    reduced_trust: false,
    headline: 'Hardware trust attested',
    detail: 'TPM attestation verified at startup.',
    startup_probe: {
      policy_mode: 'required',
      selected_backend: 'android_keystore',
      security_level: 'strongbox',
      status: 'healthy',
      failure_reason: null,
    },
  };

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders backend, security level, and policy labels', async () => {
    await act(async () => {
      root.render(<SentinelTrustBanner status={baseStatus} />);
    });

    expect(container.textContent).toContain('Mode: required');
    expect(container.textContent).toContain('Backend: android_keystore');
    expect(container.textContent).toContain('Security: strongbox');
    expect(container.textContent).toContain('Status: healthy');
    expect(container.textContent).toContain('Reason: None');
  });

  it('transitions from healthy to degraded with explicit failure reason', async () => {
    await act(async () => {
      root.render(<SentinelTrustBanner status={baseStatus} />);
    });

    const degraded: SentinelTrustStatus = {
      ...baseStatus,
      reduced_trust: true,
      headline: 'TPM Optional Mode Active',
      detail: 'Startup continued without TPM attestation.',
      startup_probe: {
        ...baseStatus.startup_probe!,
        policy_mode: 'optional',
        status: 'degraded',
        security_level: 'software',
        failure_reason: 'chain_unverifiable',
      },
    };

    await act(async () => {
      root.render(<SentinelTrustBanner status={degraded} />);
    });

    expect(container.textContent).toContain('Mode: optional');
    expect(container.textContent).toContain('Status: degraded');
    expect(container.textContent).toContain('Security: software');
    expect(container.textContent).toContain('Reason: Chain unverifiable');
  });

  it('shows explicit error status in required mode', async () => {
    const errorStatus: SentinelTrustStatus = {
      ...baseStatus,
      reduced_trust: true,
      startup_probe: {
        ...baseStatus.startup_probe!,
        policy_mode: 'required',
        status: 'error',
        failure_reason: 'challenge_mismatch',
      },
    };

    await act(async () => {
      root.render(<SentinelTrustBanner status={errorStatus} />);
    });

    expect(container.textContent).toContain('Mode: required');
    expect(container.textContent).toContain('Status: error');
    expect(container.textContent).toContain('Reason: Challenge mismatch');
  });
});
