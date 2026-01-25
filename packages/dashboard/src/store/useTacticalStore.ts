/**
 * useTacticalStore
 * Zustand store for Tactical Glass state management with Tauri bridge
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { GeoPosition, ViewMode, MapProviderType } from '../map-engine/types';

// Node Types
export interface TacticalNode {
  id: string;
  domain: string;
  position: GeoPosition;
  trustScore: number;
  verified: boolean;
  attestationHash?: string;
  lastSeen: Date;
  status: 'online' | 'offline' | 'degraded';
  firmwareVersion?: string;
  integrityCompromised?: boolean; // Merkle-Vine chain integrity status
  deployedLocally?: boolean; // Whether this node is deployed locally
  deploymentPid?: number; // Process ID if deployed locally
  deploymentStatus?: string; // Deployment status: Running, Stopped, Failed
  deploymentPort?: number; // Listen port if deployed locally
}

// Track Types
export interface Track {
  id: string;
  nodeId: string;
  timestamp: Date;
  position: GeoPosition;
  velocity?: number;
  heading?: number;
}

// Event Types
export interface SecurityEvent {
  id: string;
  nodeId: string;
  type: 'verification_failed' | 'byzantine_detected' | 'attestation_expired';
  timestamp: Date;
  details: string;
}

// Byzantine Alert
export interface ByzantineAlert {
  nodeId: string;
  reason: string;
  timestamp: number;
}

// Verification Failure
export interface VerificationFailure {
  nodeId: string;
  reason: string;
  timestamp: number;
}

// Telemetry Payload
export interface TelemetryPayload {
  nodeId: string;
  data: any;
  signature: string;
  timestamp: number;
}

// Workspace Mode
export type WorkspaceMode = 'commander' | 'operator' | 'admin' | 'fleet';

interface TacticalStore {
  // UI State
  theme: 'light' | 'dark';
  viewMode: ViewMode;
  mapProvider: MapProviderType;
  workspaceMode: WorkspaceMode;
  sidebarOpen: boolean;
  rightPanelWidth: number;

  // Operational Data (NOT persisted)
  nodes: Map<string, TacticalNode>;
  tracks: Track[];
  events: SecurityEvent[];
  selectedNodeId: string | null;
  byzantineAlert: ByzantineAlert | null;
  verificationFailure: VerificationFailure | null;

  // UI Actions
  setTheme: (theme: 'light' | 'dark') => void;
  setViewMode: (mode: ViewMode) => void;
  setMapProvider: (provider: MapProviderType) => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setSidebarOpen: (open: boolean) => void;
  setRightPanelWidth: (width: number) => void;

  // Node Actions
  addNode: (node: TacticalNode) => void;
  updateNode: (id: string, updates: Partial<TacticalNode>) => void;
  removeNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  clearNodes: () => void;
  updateDeploymentStatus: (id: string, status: { pid?: number; port?: number; status?: string }) => void;

  // Track Actions
  addTrack: (track: Track) => void;
  clearTracks: () => void;

  // Event Actions
  addEvent: (event: SecurityEvent) => void;
  clearEvents: () => void;

  // Security Actions
  triggerByzantineAlert: (alert: ByzantineAlert) => void;
  clearByzantineAlert: () => void;
  triggerVerificationFailure: (failure: VerificationFailure) => void;
  clearVerificationFailure: () => void;

  // Tauri Bridge Actions
  connectToMesh: () => Promise<{ success: boolean; nodeId: string }>;
  generateGenesisBundle: () => Promise<{ bundleHash: string; timestamp: number }>;
  verifyTelemetrySignature: (payload: TelemetryPayload) => Promise<boolean>;
}

export const useTacticalStore = create<TacticalStore>()(
  persist(
    (set, get) => ({
      // Initial UI State
      theme: 'dark',
      viewMode: '3d-local',
      mapProvider: 'three',
      workspaceMode: 'commander',
      sidebarOpen: true,
      rightPanelWidth: 400,

      // Initial Operational Data
      nodes: new Map(),
      tracks: [],
      events: [],
      selectedNodeId: null,
      byzantineAlert: null,
      verificationFailure: null,

      // UI Actions
      setTheme: (theme) => set({ theme }),
      setViewMode: (viewMode) => set({ viewMode }),
      setMapProvider: (mapProvider) => set({ mapProvider }),
      setWorkspaceMode: (workspaceMode) => set({ workspaceMode }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setRightPanelWidth: (rightPanelWidth) => set({ rightPanelWidth }),

      // Node Actions
      addNode: (node) =>
        set((state) => {
          const nodes = new Map(state.nodes);
          nodes.set(node.id, node);
          return { nodes };
        }),

      updateNode: (id, updates) =>
        set((state) => {
          const nodes = new Map(state.nodes);
          const node = nodes.get(id);
          if (node) {
            nodes.set(id, { ...node, ...updates });
          }
          return { nodes };
        }),

      removeNode: (id) =>
        set((state) => {
          const nodes = new Map(state.nodes);
          nodes.delete(id);
          return { nodes };
        }),

      selectNode: (selectedNodeId) => set({ selectedNodeId }),

      clearNodes: () => set({ nodes: new Map() }),

      updateDeploymentStatus: (id, status) =>
        set((state) => {
          const nodes = new Map(state.nodes);
          const node = nodes.get(id);
          if (node) {
            nodes.set(id, {
              ...node,
              deploymentPid: status.pid ?? node.deploymentPid,
              deploymentPort: status.port ?? node.deploymentPort,
              deploymentStatus: status.status ?? node.deploymentStatus,
            });
          }
          return { nodes };
        }),

      // Track Actions
      addTrack: (track) =>
        set((state) => ({
          tracks: [...state.tracks, track],
        })),

      clearTracks: () => set({ tracks: [] }),

      // Event Actions
      addEvent: (event) =>
        set((state) => ({
          events: [...state.events, event],
        })),

      clearEvents: () => set({ events: [] }),

      // Security Actions
      triggerByzantineAlert: (byzantineAlert) => set({ byzantineAlert }),
      clearByzantineAlert: () => set({ byzantineAlert: null }),
      triggerVerificationFailure: (verificationFailure) => set({ verificationFailure }),
      clearVerificationFailure: () => set({ verificationFailure: null }),

      // Tauri Bridge Actions
      // PRODUCTION: Connect to authenticated C2 mesh with hardware-rooted trust
      // This replaces the previous testnet connection with production-grade
      // WebSocket connection using TLS 1.3 and mutual TPM attestation.
      connectToMesh: async () => {
        try {
          // Production endpoint from config/production.yaml
          const endpoint = import.meta.env.VITE_C2_ENDPOINT || 'wss://c2.aethercore.local:8443';
          const result = await invoke<string>('connect_to_mesh', { endpoint });
          return { success: true, nodeId: result };
        } catch (error) {
          console.error('Failed to connect to C2 mesh:', error);
          return { success: false, nodeId: '' };
        }
      },

      generateGenesisBundle: async () => {
        try {
          const result = await invoke<any>('generate_genesis_bundle', {
            userIdentity: 'operator',
            squadId: 'alpha',
          });
          return { bundleHash: result.signature, timestamp: result.timestamp };
        } catch (error) {
          console.error('Failed to generate genesis bundle:', error);
          return { bundleHash: '', timestamp: 0 };
        }
      },

      verifyTelemetrySignature: async (payload: TelemetryPayload) => {
        try {
          const verified = await invoke<boolean>('verify_telemetry_signature', { payload });
          if (!verified) {
            // Trigger verification failure
            set({
              verificationFailure: {
                nodeId: payload.nodeId,
                reason: 'Signature verification failed',
                timestamp: Date.now(),
              },
            });
          }
          return verified;
        } catch (error) {
          console.error('Failed to verify telemetry signature:', error);
          set({
            verificationFailure: {
              nodeId: payload.nodeId,
              reason: `Verification error: ${error}`,
              timestamp: Date.now(),
            },
          });
          return false;
        }
      },
    }),
    {
      name: 'tactical-store',
      // Only persist UI preferences, not operational data
      partialize: (state) => ({
        theme: state.theme,
        viewMode: state.viewMode,
        mapProvider: state.mapProvider,
        workspaceMode: state.workspaceMode,
        sidebarOpen: state.sidebarOpen,
        rightPanelWidth: state.rightPanelWidth,
      }),
    }
  )
);
