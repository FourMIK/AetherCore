/**
 * Comm Store Tests - Fail-visible send behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useCommStore } from '../useCommStore';

describe('useCommStore - sendMessage', () => {
  beforeEach(() => {
    // Reset only the fields relevant to sendMessage while preserving actions.
    useCommStore.setState({
      currentOperator: {
        id: 'operator-test',
        name: 'Test Operator',
        role: 'operator',
        status: 'online',
        verified: true,
        trustScore: 100,
        lastSeen: new Date(),
      },
      conversations: new Map(),
      c2Client: null,
      c2State: 'IDLE',
    } as any);
  });

  it('fails visibly when disconnected and does not append a sent message (non-demo)', async () => {
    const store = useCommStore.getState();

    await expect(store.sendMessage('peer-1', 'hello')).rejects.toThrow('C2 is disconnected');

    const state = useCommStore.getState();
    expect(state.conversations.has('peer-1')).toBe(false);
  });
});

