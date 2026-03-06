import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockInvoke } from '../../__tests__/setup';
import { useTacticalStore } from '../../store/useTacticalStore';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => undefined),
}));

import { AddNodeWizard } from './AddNodeWizard';

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('AddNodeWizard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useRealTimers();
    localStorage.clear();
    useTacticalStore.getState().clearNodes();
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockInvoke.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.useRealTimers();
  });

  it('shows only RalphieNode-compatible candidates and surfaces fail-visible notice for ignored assets', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'scan_for_assets') {
        return [
          { type: 'NET', id: '192.168.1.44', label: 'Raspberry Pi (ralphie-node-a)' },
          { type: 'NET', id: '192.168.1.55', label: 'Generic Router' },
        ];
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await act(async () => {
      root.render(<AddNodeWizard onClose={vi.fn()} />);
      await flush();
    });

    expect(container.querySelector('[data-testid="add-node-wizard"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="activate-asset-"]')).toHaveLength(1);

    const notice = container.querySelector('[data-testid="asset-eligibility-notice"]');
    expect(notice?.textContent).toContain('FAIL-VISIBLE');
    expect(notice?.textContent).toContain('ignored because identity could not be confirmed as RalphieNode compatible');
  });

  it('completes network activation, registers node, and closes wizard automatically', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'scan_for_assets') {
        return [{ type: 'NET', id: '192.168.1.44', label: 'Raspberry Pi (ralphie-node-a)' }];
      }
      if (command === 'provision_target') {
        return {
          status: 'SUCCESS',
          identity: {
            node_id: 'ralphie-node-a',
            public_key: 'pub_key_1',
            root_hash: 'ABCDEF0123456789',
            timestamp: Math.floor(Date.now() / 1000),
            device_type: 'NET',
            callsign: 'Ralphie Alpha',
          },
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await act(async () => {
      root.render(<AddNodeWizard onClose={onClose} />);
      await flush();
    });

    const activateButton = container.querySelector('[data-testid="activate-asset-0"]') as HTMLButtonElement;
    expect(activateButton).toBeTruthy();

    await act(async () => {
      activateButton.click();
      await flush();
    });

    const startButton = container.querySelector(
      '[data-testid="initiate-activation-button"]',
    ) as HTMLButtonElement;
    expect(startButton).toBeTruthy();

    await act(async () => {
      startButton.click();
      await flush();
    });

    expect(container.querySelector('[data-testid="activation-success"]')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(4000);
      await flush();
    });

    expect(onClose).toHaveBeenCalledTimes(1);

    const addedNode = Array.from(useTacticalStore.getState().nodes.values()).find(
      (node) => node.attestationHash === 'ABCDEF0123456789',
    );
    expect(addedNode).toBeDefined();
    expect(addedNode?.domain).toBe('ralphienode');
    expect(addedNode?.status).toBe('offline');
  });

  it('surfaces explicit activation failures and allows returning to scan view', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'scan_for_assets') {
        return [{ type: 'NET', id: '192.168.1.44', label: 'Raspberry Pi (ralphie-node-a)' }];
      }
      if (command === 'provision_target') {
        throw new Error('FAIL-VISIBLE: Bad Password. Authentication failed.');
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await act(async () => {
      root.render(<AddNodeWizard onClose={vi.fn()} />);
      await flush();
    });

    const activateButton = container.querySelector('[data-testid="activate-asset-0"]') as HTMLButtonElement;

    await act(async () => {
      activateButton.click();
      await flush();
    });

    const startButton = container.querySelector(
      '[data-testid="initiate-activation-button"]',
    ) as HTMLButtonElement;

    await act(async () => {
      startButton.click();
      await flush();
    });

    const errorBox = container.querySelector('[data-testid="activation-error"]');
    expect(errorBox?.textContent).toContain('Activation Failed');
    expect(errorBox?.textContent).toContain('FAIL-VISIBLE: Bad Password');

    const backButton = container.querySelector(
      '[data-testid="activation-back-to-assets"]',
    ) as HTMLButtonElement;

    await act(async () => {
      backButton.click();
      await flush();
    });

    expect(container.querySelector('[data-testid="asset-radar"]')).not.toBeNull();
  });

  it('uses automatic firmware selection for USB profiles without requiring manual path input', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'scan_for_assets') {
        return [
          {
            type: 'USB',
            id: 'COM9',
            label: 'Heltec WiFi LoRa 32',
            transport: 'usb-serial',
            hardware_profile: 'heltec-v3',
          },
        ];
      }
      if (command === 'provision_target') {
        return {
          status: 'SUCCESS',
          identity: {
            node_id: 'ralphie-usb-01',
            public_key: 'pub_key_usb',
            root_hash: 'FIRMWAREAUTO1234',
            timestamp: Math.floor(Date.now() / 1000),
            device_type: 'USB',
            callsign: 'Ralphie USB',
          },
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await act(async () => {
      root.render(<AddNodeWizard onClose={vi.fn()} />);
      await flush();
    });

    const activateButton = container.querySelector('[data-testid="activate-asset-0"]') as HTMLButtonElement;

    await act(async () => {
      activateButton.click();
      await flush();
    });

    const startButton = container.querySelector(
      '[data-testid="initiate-activation-button"]',
    ) as HTMLButtonElement;

    await act(async () => {
      startButton.click();
      await flush();
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      'provision_target',
      expect.objectContaining({
        firmwarePath: null,
      }),
    );
    expect(container.querySelector('[data-testid="activation-success"]')).not.toBeNull();
  });
});
