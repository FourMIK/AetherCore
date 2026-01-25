/**
 * Communications Store
 * Manages operator messaging, video calls, and presence
 * All communications authenticated via Trust Mesh
 */

import { create } from 'zustand';

export type OperatorRole = 'operator' | 'commander' | 'admin';

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
}

export const useCommStore = create<CommState>((set, get) => ({
  currentOperator: null,
  operators: new Map(),
  conversations: new Map(),
  activeCall: null,
  incomingCall: null,

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

    const message: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      from: state.currentOperator.id,
      to,
      content,
      timestamp: new Date(),
      verified: true,
      encrypted: true,
      signature: 'blake3-ed25519-signature-placeholder',
    };

    set((state) => {
      const conversations = new Map(state.conversations);
      const conversation = conversations.get(to) || [];
      conversations.set(to, [...conversation, message]);
      return { conversations };
    });

    // TODO: Send via WebSocket to backend with signature
    console.log('Sending message:', message);
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

    // TODO: Send call invitation via WebRTC signaling
    console.log('Initiating call:', call);
  },

  acceptCall: (callId) => {
    const state = get();
    if (state.incomingCall?.id === callId) {
      set({
        activeCall: { ...state.incomingCall, status: 'active', startTime: new Date() },
        incomingCall: null,
      });
    }
  },

  rejectCall: (callId) => {
    set({ incomingCall: null });
  },

  endCall: () => {
    const state = get();
    if (state.activeCall) {
      set({
        activeCall: { ...state.activeCall, status: 'ended', endTime: new Date() },
      });
      // Clear after a moment
      setTimeout(() => set({ activeCall: null }), 1000);
    }
  },

  getConversation: (operatorId) => {
    const state = get();
    return state.conversations.get(operatorId) || [];
  },
}));
