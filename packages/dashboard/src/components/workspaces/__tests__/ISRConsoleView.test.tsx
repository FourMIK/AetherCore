/**
 * ISRConsoleView Tests
 *
 * Ensures non-demo mode does not run simulated telemetry intervals.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ISRConsoleView } from '../ISRConsoleView';
import { useTacticalStore } from '../../../store/useTacticalStore';

describe('ISRConsoleView', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    // Ensure deterministic store state.
    const tactical = useTacticalStore.getState();
    tactical.clearNodes();
    tactical.selectNode(null);

    // Stub health check fetch.
    (globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it('does not schedule a 1s simulated telemetry interval', () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');

    const root = createRoot(container);
    act(() => {
      root.render(<ISRConsoleView />);
    });

    const intervals = intervalSpy.mock.calls.map((call) => call[1]);
    expect(intervals).not.toContain(1000);
    expect(intervals).toContain(15000);
    expect(container.textContent).toContain('Unavailable');
  });
});

