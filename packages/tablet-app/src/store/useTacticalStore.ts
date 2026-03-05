/**
 * Tactical Store
 * Manages tactical nodes, trust scores, and mesh network state
 */

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

export interface TacticalNode {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  trustScore: number;
  status: 'healthy' | 'suspect' | 'quarantined' | 'unknown';
  domain: string;
  lastUpdate: number;
  isHardwareBacked: boolean;
  publicKey: string;
  signatureFailRate: number;
  replayEventCount: number;
  packetLossRate: number;
  uptime: number;
}

export interface ByzantineFaultEvent {
  id: string;
  timestamp: number;
  faultType: 'InvalidSignature' | 'BrokenHashChain' | 'DoubleVote' | 'ReplayDetected';
  nodeId: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface TacticalState {
  nodes: Map<string, TacticalNode>;
  faultEvents: ByzantineFaultEvent[];
  selectedNodeId: string | null;
  meshConnected: boolean;

  // Node operations
  addNode: (node: TacticalNode) => void;
  updateNode: (id: string, partial: Partial<TacticalNode>) => void;
  removeNode: (id: string) => void;
  getNode: (id: string) => TacticalNode | undefined;
  getAllNodes: () => TacticalNode[];

  // Fault operations
  addFaultEvent: (event: ByzantineFaultEvent) => void;
  getFaultEvents: (nodeid?: string) => ByzantineFaultEvent[];
  clearFaultEvents: (nodeId?: string) => void;

  // Selection
  selectNode: (id: string | null) => void;

  // Mesh state
  setMeshConnected: (connected: boolean) => void;
}

export const useTacticalStore = create<TacticalState>((set, get) => ({
  nodes: new Map(),
  faultEvents: [],
  selectedNodeId: null,
  meshConnected: false,

  addNode: (node) => {
    set((state) => {
      const newNodes = new Map(state.nodes);
      newNodes.set(node.id, node);
      return { nodes: newNodes };
    });
  },

  updateNode: (id, partial) => {
    set((state) => {
      const node = state.nodes.get(id);
      if (!node) return state;

      const newNodes = new Map(state.nodes);
      newNodes.set(id, { ...node, ...partial });
      return { nodes: newNodes };
    });
  },

  removeNode: (id) => {
    set((state) => {
      const newNodes = new Map(state.nodes);
      newNodes.delete(id);
      return { nodes: newNodes };
    });
  },

  getNode: (id) => {
    return get().nodes.get(id);
  },

  getAllNodes: () => {
    return Array.from(get().nodes.values());
  },

  addFaultEvent: (event) => {
    set((state) => ({
      faultEvents: [event, ...state.faultEvents].slice(0, 100), // Keep last 100
    }));
  },

  getFaultEvents: (nodeId) => {
    const events = get().faultEvents;
    return nodeId ? events.filter((e) => e.nodeId === nodeId) : events;
  },

  clearFaultEvents: (nodeId) => {
    set((state) => ({
      faultEvents: nodeId
        ? state.faultEvents.filter((e) => e.nodeId !== nodeId)
        : [],
    }));
  },

  selectNode: (id) => {
    set({ selectedNodeId: id });
  },

  setMeshConnected: (connected) => {
    set({ meshConnected: connected });
  },
}));

