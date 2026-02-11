/**
 * Communications Store
 * Manages operator messaging, video calls, and presence
 * All communications authenticated via Trust Mesh
 */

import { create } from 'zustand';
import { C2Client, C2State, type C2ClientConfig } from '../services/c2/C2Client';
import type { MessageEnvelope } from '../../../../shared/src/c2-message-schema';

export type OperatorRole = 'operator' | 'commander' | 'admin';
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'unverified'
  | 'severed';
export type ConnectionState = 'connected' | 'intermittent' | 'disconnected';

export interface Operator {
  id: string;
  name: string;
  role: OperatorRole;
  callsign?: string;
  status: 'online' | 'offline' | 'busy' | 'away';
  verified: boolean;
  trustScore: number;
  lastSeen: Date;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: Date;
  signature?: string; // Ed25519 signature
  verified: boolean;
  encrypted: boolean;
}

export interface VideoCall {
  id: string;
  participants: string[];
  initiator: string;
  status: 'ringing' | 'active' | 'ended';
  startTime?: Date;
  endTime?: Date;
}

interface CommState {
  currentOperator: Operator | null;
  operators: Map<string, Operator>;
  conversations: Map<string, Message[]>;
  activeCall: VideoCall | null;
  incomingCall: VideoCall | null;
  connectionStatus: ConnectionStatus;
  connectionState: ConnectionState; // For UI degradation (Heartbeat Sentinel)
  c2State: C2State; // C2 client state
  c2Client: C2Client | null; // C2 client instance

  // Actions
  setCurrentOperator: (operator: Operator) => void;
  addOperator: (operator: Operator) => void;
  updateOperatorStatus: (operatorId: string, status: Operator['status']) => void;
  sendMessage: (to: string, content: string) => Promise<void>;
  receiveMessage: (message: Message) => void;
  initiateCall: (operatorId: string) => Promise<void>;
  acceptCall: (callId: string) => void;
  rejectCall: (callId: string) => void;
  endCall: () => void;
  getConversation: (operatorId: string) => Message[];
  setConnectionStatus: (status: ConnectionStatus) => void;
  setConnectionState: (state: ConnectionState) => void;
  // C2 actions
  initC2Client: (endpoint: string, clientId: string) => void;
  connectC2: () => Promise<void>;
  disconnectC2: () => void;
  getC2Status: () => { state: C2State; endpoint?: string } | null;
}

export const useCommStore = create<CommState>((set, get) => ({
  currentOperator: null,
  operators: new Map(),
  conversations: new Map(),
  activeCall: null,
  incomingCall: null,
  connectionStatus: 'disconnected',
  connectionState: 'disconnected',
  c2State: 'IDLE',
  c2Client: null,

  setCurrentOperator: (operator) => set({ currentOperator: operator }),

  addOperator: (operator) =>
    set((state) => {
      const operators = new Map(state.operators);
      operators.set(operator.id, operator);
      return { operators };
    }),

  updateOperatorStatus: (operatorId, status) =>
    set((state) => {
      const operators = new Map(state.operators);
      const operator = operators.get(operatorId);
      if (operator) {
        operators.set(operatorId, { ...operator, status });
      }
      return { operators };
    }),

  sendMessage: async (to, content) => {
    const state = get();
    if (!state.currentOperator) return;

    // Use C2Client if available
    if (state.c2Client && state.c2State === 'CONNECTED') {
      try {
        await state.c2Client.sendMessage('chat', {
          content,
          recipientId: to,
          encrypted: true,
        });

        // Add to local conversation
        const message: Message = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          from: state.currentOperator.id,
          to,
          content,
          timestamp: new Date(),
          verified: true,
          encrypted: true,
        };

        set((state) => {
          const conversations = new Map(state.conversations);
          const conversation = conversations.get(to) || [];
          conversations.set(to, [...conversation, message]);
          return { conversations };
        });
      } catch (error) {
        console.error('[COMM] Failed to send message via C2:', error);
        throw error;
      }
    } else {
      // Fallback: local only (for testing)
      const message: Message = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        from: state.currentOperator.id,
        to,
        content,
        timestamp: new Date(),
        verified: false,
        encrypted: false,
        signature: 'placeholder:local-only',
      };

      set((state) => {
        const conversations = new Map(state.conversations);
        const conversation = conversations.get(to) || [];
        conversations.set(to, [...conversation, message]);
        return { conversations };
      });

      console.warn('[COMM] C2 not connected, message stored locally only');
    }
  },

  receiveMessage: (message) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conversationKey = message.from;
      const conversation = conversations.get(conversationKey) || [];
      conversations.set(conversationKey, [...conversation, message]);
      return { conversations };
    }),

  initiateCall: async (operatorId) => {
    const state = get();
    if (!state.currentOperator) return;

    const call: VideoCall = {
      id: `call-${Date.now()}`,
      participants: [state.currentOperator.id, operatorId],
      initiator: state.currentOperator.id,
      status: 'ringing',
    };

    set({ activeCall: call });

    // Send call invitation via C2
    if (state.c2Client && state.c2State === 'CONNECTED') {
      try {
        await state.c2Client.sendMessage('call_invite', {
          callId: call.id,
          recipientId: operatorId,
        });
      } catch (error) {
        console.error('[COMM] Failed to send call invitation:', error);
      }
    } else {
      console.warn('[COMM] C2 not connected, call invitation not sent');
    }
  },

  acceptCall: (callId) => {
    const state = get();
    if (state.incomingCall?.id === callId) {
      set({
        activeCall: { ...state.incomingCall, status: 'active', startTime: new Date() },
        incomingCall: null,
      });

      // Send acceptance via C2
      if (state.c2Client && state.c2State === 'CONNECTED') {
        state.c2Client.sendMessage('call_accept', {
          callId,
        }).catch((error) => {
          console.error('[COMM] Failed to send call acceptance:', error);
        });
      }
    }
  },

  rejectCall: (callId) => {
    const state = get();
    set({ incomingCall: null });

    // Send rejection via C2
    if (state.c2Client && state.c2State === 'CONNECTED') {
      state.c2Client.sendMessage('call_reject', {
        callId,
      }).catch((error) => {
        console.error('[COMM] Failed to send call rejection:', error);
      });
    }
  },

  endCall: () => {
    const state = get();
    if (state.activeCall) {
      const callId = state.activeCall.id;
      
      set({
        activeCall: { ...state.activeCall, status: 'ended', endTime: new Date() },
      });

      // Send end via C2
      if (state.c2Client && state.c2State === 'CONNECTED') {
        state.c2Client.sendMessage('call_end', {
          callId,
        }).catch((error) => {
          console.error('[COMM] Failed to send call end:', error);
        });
      }

      // Clear after a moment
      setTimeout(() => set({ activeCall: null }), 1000);
    }
  },

  getConversation: (operatorId) => {
    const state = get();
    return state.conversations.get(operatorId) || [];
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  setConnectionState: (state) => set({ connectionState: state }),

  // C2 Client Management
  initC2Client: (endpoint, clientId) => {
    const config: C2ClientConfig = {
      endpoint,
      clientId,
      signingEnabled: false, // Disabled for Sprint 1
      heartbeatIntervalMs: 30000, // 30 seconds
      heartbeatTimeoutMs: 10000, // 10 seconds
      maxReconnectAttempts: 10,
      initialBackoffMs: 1000,
      maxBackoffMs: 30000,
      onStateChange: (state, event) => {
        console.log(`[C2] State: ${state}, Event: ${event}`);
        set({ c2State: state });

        // Map C2 states to connection status
        if (state === 'CONNECTED') {
          set({ connectionStatus: 'connected' });
        } else if (state === 'CONNECTING' || state === 'BACKOFF') {
          set({ connectionStatus: 'connecting' });
        } else if (state === 'DEGRADED') {
          set({ connectionStatus: 'unverified' });
        } else {
          set({ connectionStatus: 'disconnected' });
        }
      },
      onMessage: (envelope: MessageEnvelope) => {
        console.log('[C2] Received message:', envelope);

        // Handle different message types
        if (envelope.type === 'chat' && typeof envelope.payload === 'object' && envelope.payload !== null) {
          const payload = envelope.payload as { content?: string; encrypted?: boolean };
          const message: Message = {
            id: envelope.message_id,
            from: envelope.from,
            to: clientId,
            content: payload.content || '',
            timestamp: new Date(envelope.timestamp),
            signature: envelope.signature,
            verified: envelope.trust_status === 'verified',
            encrypted: payload.encrypted || false,
          };
          get().receiveMessage(message);
        } else if (envelope.type === 'call_invite' && typeof envelope.payload === 'object' && envelope.payload !== null) {
          const payload = envelope.payload as { callId?: string; recipientId?: string };
          const call: VideoCall = {
            id: payload.callId || `call-${Date.now()}`,
            participants: [envelope.from, clientId],
            initiator: envelope.from,
            status: 'ringing',
          };
          set({ incomingCall: call });
        }
      },
      onError: (error) => {
        console.error('[C2] Error:', error);
      },
    };

    const client = new C2Client(config);
    set({ c2Client: client, c2State: 'IDLE' });
  },

  connectC2: async () => {
    const state = get();
    if (!state.c2Client) {
      throw new Error('C2 client not initialized. Call initC2Client first.');
    }
    await state.c2Client.connect();
  },

  disconnectC2: () => {
    const state = get();
    if (state.c2Client) {
      state.c2Client.disconnect();
    }
  },

  getC2Status: () => {
    const state = get();
    if (!state.c2Client) return null;
    const status = state.c2Client.getStatus();
    return {
      state: status.state,
      endpoint: status.endpoint,
    };
  },
}));
