import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { AethericSweep, NodeHealthStatus } from './AethericSweep';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.(new Event('open')));
  }

  close() {
    this.onclose?.();
  }
}

type StateCase = {
  name: string;
  message: Record<string, unknown>;
  expectedCompact: string[];
  expectedExpanded: string[];
};

describe('AethericSweep state detail panel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      textAlign: 'center',
      globalAlpha: 1,
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const stateCases: StateCase[] = [
    {
      name: 'healthy',
      message: {
        node_id: 'healthy-node',
        status: NodeHealthStatus.HEALTHY,
        trust_score: 0.91,
        last_seen_ns: Date.now() * 1_000_000,
        payload_signature_valid: true,
        stale_payload: false,
        payload_freshness_ms: 100,
        metrics: { root_agreement_ratio: 0.98, chain_break_count: 0, signature_failure_count: 0 },
      },
      expectedCompact: ['Trusted: Trusted'],
      expectedExpanded: ['Trust Percent: 91%', 'Trust Level:', 'Mesh Integrity Status:', 'Healthy', 'Root Agreement: 98.0%'],
    },
    {
      name: 'degraded',
      message: {
        node_id: 'degraded-node',
        status: NodeHealthStatus.DEGRADED,
        trust_score: 0.62,
        last_seen_ns: Date.now() * 1_000_000,
        payload_signature_valid: true,
        stale_payload: false,
        payload_freshness_ms: 300,
        metrics: { root_agreement_ratio: 0.74, chain_break_count: 2, signature_failure_count: 0 },
      },
      expectedCompact: ['Trusted: Not Trusted'],
      expectedExpanded: ['Trust Percent: 62%', 'Mesh Integrity Status:', 'Degraded', 'Chain Breaks: 2'],
    },
    {
      name: 'compromised',
      message: {
        node_id: 'compromised-node',
        status: NodeHealthStatus.COMPROMISED,
        trust_score: 0.18,
        last_seen_ns: Date.now() * 1_000_000,
        payload_signature_valid: false,
        stale_payload: false,
        payload_freshness_ms: 500,
        metrics: { root_agreement_ratio: 0.4, chain_break_count: 7, signature_failure_count: 2 },
      },
      expectedCompact: ['Trusted: Not Trusted', 'Error: Invalid signature payload'],
      expectedExpanded: ['Mesh Integrity Status:', 'Invalid signature', 'Signature Failures: 2'],
    },
    {
      name: 'unknown',
      message: {
        node_id: 'unknown-node',
        status: NodeHealthStatus.UNKNOWN,
        trust_score: 0.47,
        last_seen_ns: Date.now() * 1_000_000,
        payload_signature_valid: true,
        stale_payload: false,
        payload_freshness_ms: 1000,
        metrics: { root_agreement_ratio: 0.52, chain_break_count: 1, signature_failure_count: 0 },
      },
      expectedCompact: ['Trusted: Not Trusted'],
      expectedExpanded: ['Trust Percent: 47%', 'Mesh Integrity Status:', 'Unknown'],
    },
    {
      name: 'stale',
      message: {
        node_id: 'stale-node',
        status: NodeHealthStatus.HEALTHY,
        trust_score: 0.88,
        last_seen_ns: Date.now() * 1_000_000,
        payload_signature_valid: true,
        stale_payload: true,
        payload_freshness_ms: 45_000,
        metrics: { root_agreement_ratio: 0.91, chain_break_count: 0, signature_failure_count: 0 },
      },
      expectedCompact: ['Trusted: Trusted', 'Warning: Stale payload window exceeded'],
      expectedExpanded: ['Mesh Integrity Status:', 'Stale payload', 'Freshness Indicator:', 'Stale'],
    },
  ];

  for (const item of stateCases) {
    it(`renders ${item.name} state details`, async () => {
      await act(async () => {
        root.render(<AethericSweep websocketUrl="ws://unit.test" width={300} height={220} />);
      });

      const ws = MockWebSocket.instances[0];
      expect(ws).toBeTruthy();

      await act(async () => {
        ws.onmessage?.({ data: JSON.stringify(item.message) } as MessageEvent<string>);
      });

      const canvas = container.querySelector('canvas') as HTMLCanvasElement;
      await act(async () => {
        canvas.dispatchEvent(new MouseEvent('click', { clientX: 50, clientY: 50, bubbles: true }));
      });

      const panel = container.querySelector('[data-testid="node-detail-panel"]');
      expect(panel).toBeTruthy();

      for (const text of item.expectedCompact) {
        expect(container.textContent).toContain(text);
      }

      expect(container.textContent).not.toContain('Trust Percent:');

      const toggle = Array.from(container.querySelectorAll('button')).find((btn) => btn.textContent?.includes('Show Details')) as HTMLButtonElement;
      expect(toggle).toBeTruthy();

      await act(async () => {
        toggle.click();
      });

      const expanded = container.querySelector('[data-testid="node-detail-expanded"]');
      expect(expanded).toBeTruthy();

      for (const text of item.expectedExpanded) {
        expect(container.textContent).toContain(text);
      }

      expect(expanded?.innerHTML).toMatchSnapshot();
    });
  }
});
