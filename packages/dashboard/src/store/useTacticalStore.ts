/**
 * useTacticalStore
 * Zustand store for Tactical Glass state management with Tauri bridge
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { GeoPosition, ViewMode, MapProviderType } from '../map-engine/types';
import { getRuntimeConfig } from '../config/runtime';
import type { NodeAttestationState, RevocationCertificate } from '../services/identity/identityClient';
import { VideoStream } from '../types/VideoStream';

// Node Types
export interface TacticalNode {
  id: string;
  domain: string;
  position: GeoPosition;
  trustScore: number;
  verified: boolean;
  attestationHash?: string;
  lastSeen: Date;
  status: 'online' | 'offline' | 'degraded' | 'compromised' | 'revoked';
  firmwareVersion?: string;
  integrityCompromised?: boolean; // Merkle-Vine chain integrity status
  byzantineDetected?: boolean; // Byzantine fault detection flag
  revoked?: boolean; // Great Gospel revocation flag
  revocationReason?: string; // Human-readable revocation reason
  tpmAttestationValid?: boolean; // TPM 2.0 hardware attestation status
  deployedLocally?: boolean; // Whether this node is deployed locally
  deploymentPid?: number; // Process ID if deployed locally
  deploymentStatus?: string; // Deployment status: Running, Stopped, Failed
  deploymentPort?: number; // Listen port if deployed locally
  videoStream?: VideoStream; // Optional video feed from ISR sensors
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

  // Fleet Attestation State (Admin Module)
  fleetAttestationState: NodeAttestationState[];
  lastAttestationUpdate: number;
  revocationHistory: RevocationCertificate[];

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

  // Fleet Attestation & Revocation Actions (Admin)
  updateFleetAttestationState: (states: NodeAttestationState[]) => void;
  recordRevocation: (certificate: RevocationCertificate) => void;
  markNodeAsRevoked: (nodeId: string, reason: string) => void;
  markNodeAsCompromised: (nodeId: string, reason: string) => void;

  // Tauri Bridge Actions
  connectToMesh: () => Promise<{ success: boolean; nodeId: string }>;
  generateGenesisBundle: () => Promise<{ bundleHash: string; timestamp: number }>;
  verifyTelemetrySignature: (payload: TelemetryPayload) => Promise<boolean>;
}

export const useTacticalStore = create<TacticalStore>()(
  persist(
    (set, get) => {
      // Initialize with mock FLIR nodes
      const initialNodes = new Map<string, TacticalNode>();
      initialNodes.set('flir-alpha-01', {
        id: 'flir-alpha-01',
        domain: 'sensor',
        position: {
          latitude: 40.7128,
          longitude: -74.0060,
          altitude: 50,
        },
        trustScore: 95,
        verified: true,
        attestationHash: 'blake3:flir-alpha-01-genesis',
        lastSeen: new Date(),
        status: 'online',
        firmwareVersion: 'Teledyne Ranger HD v2.1',
        integrityCompromised: false,
        videoStream: {
          url: 'mock://teledyne-flir-alpha-01',
          format: 'mock-flir' as const,
          status: 'live' as const,
          resolution: '1080p',
          codec: 'H.264',
        },
      });

      initialNodes.set('thermal-demo-03', {
        id: 'thermal-demo-03',
        domain: 'sensor',
        position: {
          latitude: 40.7580,
          longitude: -73.9855,
          altitude: 65,
        },
        trustScore: 90,
        verified: true,
        attestationHash: 'blake3:thermal-demo-03-genesis',
        lastSeen: new Date(),
        status: 'online',
        firmwareVersion: 'Teledyne Ranger HD v2.0',
        integrityCompromised: false,
        videoStream: {
          url: 'mock://teledyne-flir-thermal-03',
          format: 'mock-flir' as const,
          status: 'live' as const,
          resolution: '1080p',
          codec: 'H.264',
        },
      });

      return {
        // Initial UI State
        theme: 'dark',
        viewMode: '3d-local',
        mapProvider: 'three',
        workspaceMode: 'commander',
        sidebarOpen: true,
        rightPanelWidth: 400,

        // Initial Operational Data
        nodes: initialNodes,
        tracks: [],
        events: [],
        selectedNodeId: 'thermal-demo-03',
        byzantineAlert: null,
        verificationFailure: null,

        // Fleet Attestation State (Admin Module)
        fleetAttestationState: [],
        lastAttestationUpdate: 0,
        revocationHistory: [],

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

        // Fleet Attestation & Revocation Actions (Admin)
        updateFleetAttestationState: (fleetAttestationState) => {
          set({
            fleetAttestationState,
            lastAttestationUpdate: Date.now(),
          });

          // Sync attestation state to nodes map
          const nodes = new Map(get().nodes);
          fleetAttestationState.forEach((attestation) => {
            const node = nodes.get(attestation.node_id);
            if (node) {
              nodes.set(attestation.node_id, {
                ...node,
                tpmAttestationValid: attestation.tpm_attestation_valid,
                trustScore: attestation.trust_score,
                verified: attestation.hardware_backed && attestation.tpm_attestation_valid,
                integrityCompromised: !attestation.merkle_vine_synced,
                byzantineDetected: attestation.byzantine_detected,
                revoked: attestation.revoked,
                revocationReason: attestation.revocation_reason,
                status: attestation.revoked
                  ? 'revoked'
                  : attestation.byzantine_detected
                  ? 'compromised'
                  : node.status,
              });
            }
          });

          set({ nodes });
        },

        recordRevocation: (certificate) =>
          set((state) => ({
            revocationHistory: [certificate, ...state.revocationHistory],
          })),

        markNodeAsRevoked: (nodeId, reason) => {
          const nodes = new Map(get().nodes);
          const node = nodes.get(nodeId);
          if (node) {
            nodes.set(nodeId, {
              ...node,
              revoked: true,
              revocationReason: reason,
              status: 'revoked',
              trustScore: 0,
            });
            set({ nodes });

            // Add security event
            get().addEvent({
              id: `revoke-${nodeId}-${Date.now()}`,
              nodeId,
              type: 'verification_failed',
              timestamp: new Date(),
              details: `Node revoked: ${reason}`,
            });
          }
        },

        markNodeAsCompromised: (nodeId, reason) => {
          const nodes = new Map(get().nodes);
          const node = nodes.get(nodeId);
          if (node) {
            nodes.set(nodeId, {
              ...node,
              byzantineDetected: true,
              integrityCompromised: true,
              status: 'compromised',
            });
            set({ nodes });

            // Trigger Byzantine alert
            get().triggerByzantineAlert({
              nodeId,
              reason,
              timestamp: Date.now(),
            });

            // Add security event
            get().addEvent({
              id: `byzantine-${nodeId}-${Date.now()}`,
              nodeId,
              type: 'byzantine_detected',
              timestamp: new Date(),
              details: reason,
            });
          }
        },

        // Tauri Bridge Actions
        // PRODUCTION: Connect to authenticated C2 mesh with hardware-rooted trust
        // This replaces the previous testnet connection with production-grade
        // WebSocket connection using TLS 1.3 and mutual TPM attestation.
        connectToMesh: async () => {
          try {
            const { wsUrl } = getRuntimeConfig();
            const result = await invoke<string>('connect_to_mesh', { endpoint: wsUrl });
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
                  reason: `Verification failed for node ${payload.nodeId}`,
                  timestamp: Date.now(),
                },
              });
              return false;
            }
            return true;
          } catch (error) {
            console.error('Failed to verify telemetry signature:', error);
            set({
              verificationFailure: {
                nodeId: payload.nodeId,
                reason: `Verification error: ${error instanceof Error ? error.message : String(error)}`,
                timestamp: Date.now(),
              },
            });
            return false;
          }
        },
      };
    },
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
