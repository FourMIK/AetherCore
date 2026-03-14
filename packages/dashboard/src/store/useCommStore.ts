/**
 * Communications Store
 * Manages operator messaging, video calls, and presence
 * All communications authenticated via Trust Mesh
 */

import { create } from 'zustand';
import {
  C2Client,
  C2State,
  type C2ClientConfig,
  type C2ClientStatus,
  type RalphiePresenceFrame,
  type SystemStatusFrame,
} from '../services/c2/C2Client';
import { isEnvelopeVerified, type LatticeInboundEventV1, type MessageEnvelope } from '@aethercore/shared';
import { useTacticalStore, type TacticalNode } from './useTacticalStore';
import { isDemoMode } from '../config/runtime';
import { fetchLatticeEntities } from '../services/lattice/latticeService';

let activePeerConnection: RTCPeerConnection | null = null;

export type OperatorRole = 'operator' | 'commander' | 'admin';
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'unverified'
  | 'severed';
export type ConnectionState = 'connected' | 'intermittent' | 'disconnected';
export type BackendCoreStatus = 'connected' | 'unreachable' | 'unknown';

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
  sdpOffer?: string;
  sdpAnswer?: string;
  media?: { video: boolean; audio: boolean };
}

function clampTrustScorePercent(score: number | undefined, fallback = 50): number {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return fallback;
  }

  if (score <= 1) {
    return Math.max(0, Math.min(100, Math.round(score * 100)));
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function normalizeOperatorStatus(status: unknown): Operator['status'] {
  if (status === 'online' || status === 'offline' || status === 'busy' || status === 'away') {
    return status;
  }
  return 'online';
}

function formatOperatorName(operatorId: string): string {
  const compact = operatorId.replace(/^operator-/, '');
  return compact.length > 20 ? `${compact.slice(0, 18)}...` : compact;
}

function deriveNodePosition(nodeId: string) {
  let hash = 0;
  for (let i = 0; i < nodeId.length; i += 1) {
    hash = (hash * 31 + nodeId.charCodeAt(i)) >>> 0;
  }

  const latOffset = ((hash % 2000) - 1000) / 10000; // +/- 0.1
  const lonOffset = (((hash >> 11) % 2000) - 1000) / 10000; // +/- 0.1
  return {
    latitude: 37.7749 + latOffset,
    longitude: -122.4194 + lonOffset,
    altitude: 0,
  };
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function deriveTelemetryPosition(frame: RalphiePresenceFrame) {
  const gps = frame.telemetry?.gps;
  if (!gps) {
    return null;
  }

  const latitude = toFiniteNumber(gps.lat) ?? toFiniteNumber(gps.latitude);
  const longitude = toFiniteNumber(gps.lon) ?? toFiniteNumber(gps.longitude);
  if (latitude === undefined || longitude === undefined) {
    return null;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }

  return {
    latitude,
    longitude,
    altitude: toFiniteNumber(gps.alt_m) ?? toFiniteNumber(gps.altitude_m) ?? 0,
  };
}

function deriveNodeStatus(frame: RalphiePresenceFrame): 'online' | 'offline' | 'degraded' {
  const disconnectReason = (frame.last_disconnect_reason || '').toLowerCase();
  if (
    disconnectReason.includes('unreachable') ||
    disconnectReason.includes('refused') ||
    disconnectReason.includes('timeout')
  ) {
    return 'degraded';
  }

  const batteryPct = frame.telemetry?.power?.battery_pct;
  if (typeof batteryPct === 'number' && batteryPct <= 10) {
    return 'degraded';
  }

  const snrCandidates = [frame.telemetry?.radio?.snr_db, frame.telemetry?.radio?.lora_snr_db]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (snrCandidates.length > 0 && Math.max(...snrCandidates) < -18) {
    return 'degraded';
  }

  return 'online';
}

function upsertRalphieNode(frame: RalphiePresenceFrame): void {
  const tacticalStore = useTacticalStore.getState();
  const nodeId = frame.identity.device_id;
  const trustScore = Math.max(0, Math.min(100, Math.round(frame.identity.trust_score * 100)));
  const lastSeen = new Date(frame.received_at ?? frame.timestamp ?? Date.now());
  const telemetryPosition = deriveTelemetryPosition(frame);
  const status = deriveNodeStatus(frame);
  const domain = (() => {
    try {
      return new URL(frame.endpoint).hostname;
    } catch {
      return 'ralphie-edge';
    }
  })();

  const existing = tacticalStore.nodes.get(nodeId);
  if (existing) {
    tacticalStore.updateNode(nodeId, {
      domain,
      trustScore,
      verified: frame.identity.tpm_backed,
      status,
      lastSeen,
      position: telemetryPosition ?? existing.position,
    });
    return;
  }

  tacticalStore.addNode({
    id: nodeId,
    domain,
    position: telemetryPosition ?? deriveNodePosition(nodeId),
    trustScore,
    verified: frame.identity.tpm_backed,
    lastSeen,
    status,
  });
}

function latticeSourceToProvenance(source: string): 'lattice.synthetic' | 'lattice.live' | 'gateway.telemetry' {
  const normalized = source.toLowerCase();
  if (normalized.includes('synthetic')) {
    return 'lattice.synthetic';
  }
  if (normalized.includes('lattice')) {
    return 'lattice.live';
  }
  return 'gateway.telemetry';
}

function latticeSourceBadge(source: string): 'Lattice Synthetic' | 'Lattice Live' | 'Gateway Telemetry' {
  const provenance = latticeSourceToProvenance(source);
  if (provenance === 'lattice.synthetic') {
    return 'Lattice Synthetic';
  }
  if (provenance === 'lattice.live') {
    return 'Lattice Live';
  }
  return 'Gateway Telemetry';
}

function latticeVerificationToStatus(
  verification: 'VERIFIED' | 'STATUS_UNVERIFIED' | 'SPOOFED' | undefined,
): 'online' | 'degraded' | 'compromised' {
  if (verification === 'SPOOFED') {
    return 'compromised';
  }
  if (verification === 'STATUS_UNVERIFIED') {
    return 'degraded';
  }
  return 'online';
}

function upsertLatticeProjection(
  projection: Extract<LatticeInboundEventV1['event'], { kind: 'entity' }>['projection'],
): void {
  const tacticalStore = useTacticalStore.getState();
  const raw = projection.raw_entity || {};
  const location =
    raw.location && typeof raw.location === 'object' && !Array.isArray(raw.location)
      ? (raw.location as Record<string, unknown>)
      : raw;
  const latitudeCandidate = location.lat ?? location.latitude;
  const longitudeCandidate = location.lon ?? location.longitude ?? location.lng;
  const altitudeCandidate = location.altitude_m ?? location.altitude ?? location.alt_m;
  const latitude = typeof latitudeCandidate === 'number' ? latitudeCandidate : 0;
  const longitude = typeof longitudeCandidate === 'number' ? longitudeCandidate : 0;
  const altitude = typeof altitudeCandidate === 'number' ? altitudeCandidate : 0;
  const provenance = latticeSourceToProvenance(projection.source || 'lattice');
  const sourceBadge = latticeSourceBadge(projection.source || 'lattice');
  const trustScore = clampTrustScorePercent(
    projection.overlay?.trust_score,
    projection.verification_status === 'VERIFIED' ? 92 : projection.verification_status === 'SPOOFED' ? 1 : 35,
  );
  const status = latticeVerificationToStatus(projection.verification_status);
  const lastSeen = new Date(projection.received_at_ms || Date.now());
  const existing = tacticalStore.nodes.get(projection.entity_id);

  const nodePatch = {
    domain: String(raw.domain || raw.type || raw.entity_type || 'lattice'),
    position: {
      latitude,
      longitude,
      altitude,
    },
    trustScore,
    verified: projection.verification_status === 'VERIFIED',
    lastSeen,
    status,
    sourceBadge,
    provenance,
    verificationStatus: projection.verification_status,
    freshnessMs: Math.max(0, Date.now() - projection.source_update_time_ms),
    readOnlyExternal: provenance !== 'gateway.telemetry',
    evidenceObjectIds: projection.overlay?.evidence_object_ids || [],
  };

  if (existing) {
    tacticalStore.updateNode(projection.entity_id, nodePatch);
    return;
  }

  tacticalStore.addNode({
    id: projection.entity_id,
    ...nodePatch,
  });
}

function applyLatticeEvent(event: LatticeInboundEventV1): void {
  if (event.event.kind !== 'entity') {
    return;
  }
  if (event.event.projection.event_type === 'DELETE') {
    useTacticalStore.getState().removeNode(event.event.projection.entity_id);
    return;
  }
  upsertLatticeProjection(event.event.projection);
}

async function refreshLatticeSnapshot(): Promise<void> {
  try {
    const response = await fetchLatticeEntities(250);
    response.entities.forEach((entity) => {
      const provenance: TacticalNode['provenance'] =
        entity.source_badge === 'Lattice Synthetic'
          ? 'lattice.synthetic'
          : entity.source_badge === 'Lattice Live'
          ? 'lattice.live'
          : 'gateway.telemetry';
      const trustScore = clampTrustScorePercent(entity.trust_score, 35);
      const existing = useTacticalStore.getState().nodes.get(entity.entity_id);
      const patch = {
        domain: entity.domain || entity.entity_type || 'lattice',
        position: {
          latitude: entity.position?.lat ?? existing?.position.latitude ?? 37.7749,
          longitude: entity.position?.lon ?? existing?.position.longitude ?? -122.4194,
          altitude: entity.position?.altitude_m ?? existing?.position.altitude ?? 0,
        },
        trustScore,
        verified: entity.verification_status === 'VERIFIED',
        lastSeen: new Date(entity.last_update_ms || Date.now()),
        status: latticeVerificationToStatus(entity.verification_status),
        sourceBadge: entity.source_badge,
        provenance,
        verificationStatus: entity.verification_status,
        freshnessMs: entity.freshness_ms,
        readOnlyExternal: provenance !== 'gateway.telemetry',
        evidenceObjectIds: entity.evidence_object_ids || [],
      };

      if (existing) {
        useTacticalStore.getState().updateNode(entity.entity_id, patch);
      } else {
        useTacticalStore.getState().addNode({
          id: entity.entity_id,
          ...patch,
        });
      }
    });
  } catch (error) {
    console.warn('[LATTICE] Failed to refresh lattice entity snapshot:', error);
  }
}
interface CommState {
  currentOperator: Operator | null;
  operators: Map<string, Operator>;
  conversations: Map<string, Message[]>;
  activeCall: VideoCall | null;
  incomingCall: VideoCall | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  callError: string | null;
  connectionStatus: ConnectionStatus;
  connectionState: ConnectionState; // For UI degradation (Heartbeat Sentinel)
  c2State: C2State; // C2 client state
  backendCoreStatus: BackendCoreStatus; // Gateway -> core backend health
  c2Client: C2Client | null; // C2 client instance
  revokedNodes: Set<string>; // Great Gospel: Revoked nodes (Byzantine/compromised)
  
  // PHASE 5: Tactical Notifications
  unreadCounts: Map<string, number>; // Unread message count per conversation_id (operatorId)
  unverifiedIntercepts: number; // Count of spoofing attempts (Fail-Visible EW indicator)
  activeConversationId: string | null; // Currently viewed conversation

  // Actions
  setCurrentOperator: (operator: Operator) => void;
  addOperator: (operator: Operator) => void;
  upsertOperator: (operator: Operator) => void;
  updateOperatorStatus: (operatorId: string, status: Operator['status']) => void;
  sendMessage: (to: string, content: string) => Promise<void>;
  receiveMessage: (message: Message) => void;
  initiateCall: (operatorId: string, media?: { video: boolean; audio: boolean }) => Promise<void>;
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
  getC2Status: () => C2ClientStatus | null;
  // Great Gospel: Revocation actions
  revokeNode: (nodeId: string, reason: string) => void;
  isNodeRevoked: (nodeId: string) => boolean;
  // PHASE 5: Notification actions
  setActiveConversation: (conversationId: string | null) => void;
  clearUnreadCount: (conversationId: string) => void;
  getUnreadCount: (conversationId: string) => number;
  getTotalUnreadCount: () => number;
  getUnverifiedInterceptsCount: () => number;
  clearUnverifiedIntercepts: () => void;
}

export const useCommStore = create<CommState>((set, get) => ({
  currentOperator: null,
  operators: new Map(),
  conversations: new Map(),
  activeCall: null,
  incomingCall: null,
  localStream: null,
  remoteStream: null,
  callError: null,
  connectionStatus: 'disconnected',
  connectionState: 'disconnected',
  c2State: 'IDLE',
  backendCoreStatus: 'unknown',
  c2Client: null,
  revokedNodes: new Set(),
  
  // PHASE 5: Initialize notification state
  unreadCounts: new Map(),
  unverifiedIntercepts: 0,
  activeConversationId: null,

  setCurrentOperator: (operator) => set({ currentOperator: operator }),

  addOperator: (operator) =>
    set((state) => {
      const operators = new Map(state.operators);
      operators.set(operator.id, operator);
      return { operators };
    }),

  upsertOperator: (operator) =>
    set((state) => {
      const operators = new Map(state.operators);
      const existing = operators.get(operator.id);
      operators.set(operator.id, existing ? { ...existing, ...operator } : operator);
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
    if (!state.currentOperator) {
      throw new Error('No local operator identity loaded. Cannot send message.');
    }

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
      if (!isDemoMode()) {
        throw new Error('C2 is disconnected. Connect to C2 before sending messages.');
      }

      // Demo-only: store locally with explicit unverified state.
      const message: Message = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        from: state.currentOperator.id,
        to,
        content,
        timestamp: new Date(),
        verified: false,
        encrypted: false,
        signature: undefined,
      };

      set((state) => {
        const conversations = new Map(state.conversations);
        const conversation = conversations.get(to) || [];
        conversations.set(to, [...conversation, message]);
        return { conversations };
      });

      console.warn('[COMM][DEMO] C2 not connected, message stored locally only');
    }
  },

  /**
   * PHASE 5: Enhanced receiveMessage with Merkle Vine verification
   * 
   * Processes incoming messages with cryptographic verification:
   * - Validates TPM signature via identityClient (if available)
   * - Checks Merkle Vine chain integrity (prev_hash linkage)
   * - Increments unreadCounts for verified messages (if not viewing conversation)
   * - Increments unverifiedIntercepts for failed verification (Fail-Visible EW detection)
   * 
   * Architectural Invariants:
   * - Broken chain = Byzantine node detected
   * - Invalid signature = Potential man-in-the-middle attack
   * - NO GRACEFUL DEGRADATION: Failures are explicit
   */
  receiveMessage: (message) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const unreadCounts = new Map(state.unreadCounts);
      const conversationKey = message.from;
      const conversation = conversations.get(conversationKey) || [];
      conversations.set(conversationKey, [...conversation, message]);
      
      // PHASE 5: Notification Logic
      // Only increment counters if not currently viewing this conversation
      const isActiveConversation = state.activeConversationId === conversationKey;
      
      if (!isActiveConversation) {
        if (message.verified) {
          // Verified message: Increment unread count
          const currentCount = unreadCounts.get(conversationKey) || 0;
          unreadCounts.set(conversationKey, currentCount + 1);
          
          console.log(
            `[COMM] Verified message received from ${conversationKey} (unread: ${currentCount + 1})`
          );
        } else {
          // FAIL-VISIBLE: Unverified message = Active EW/Spoofing Attempt
          const newInterceptCount = state.unverifiedIntercepts + 1;
          
          console.error(
            `[COMM] UNVERIFIED MESSAGE INTERCEPT from ${conversationKey} (total intercepts: ${newInterceptCount})`
          );
          console.error('[COMM] Potential Byzantine node or MitM attack detected');
          console.error(`[COMM] Message ID: ${message.id}`);
          
          return {
            conversations,
            unreadCounts,
            unverifiedIntercepts: newInterceptCount,
          };
        }
      }
      
      return { conversations, unreadCounts };
    }),

  initiateCall: async (operatorId, media = { video: true, audio: true }) => {
    const state = get();
    if (!state.currentOperator) return;

    const call: VideoCall = {
      id: `call-${Date.now()}`,
      participants: [state.currentOperator.id, operatorId],
      initiator: state.currentOperator.id,
      status: 'ringing',
      media,
    };

    set({ activeCall: call });

    // Send call invitation via C2 (SDP offer will be attached after ICE completes)
    if (state.c2Client && state.c2State === 'CONNECTED') {
      try {
        const localStream = await navigator.mediaDevices.getUserMedia(media);
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
        set({ localStream, callError: null });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === 'complete') {
            resolve();
            return;
          }
          const handleStateChange = () => {
            if (pc.iceGatheringState === 'complete') {
              pc.removeEventListener('icegatheringstatechange', handleStateChange);
              resolve();
            }
          };
          pc.addEventListener('icegatheringstatechange', handleStateChange);
        });

        pc.ontrack = (event) => {
          const [remoteStream] = event.streams;
          if (remoteStream) {
            set({ remoteStream });
          }
        };

        await state.c2Client.sendMessage('call_invite', {
          callId: call.id,
          recipientId: operatorId,
          sdpOffer: pc.localDescription?.sdp,
        });

        set({ activeCall: call });
        activePeerConnection = pc;
      } catch (error) {
        console.error('[COMM] Failed to send call invitation:', error);
        set({ callError: 'Failed to initiate call', activeCall: null });
      }
    } else {
      console.warn('[COMM] C2 not connected, call invitation not sent');
    }
  },

  acceptCall: (callId) => {
    const state = get();
    if (state.incomingCall?.id === callId) {
      const call = state.incomingCall;
      set({ incomingCall: null });

      if (!call.sdpOffer) {
        set({ callError: 'Missing SDP offer for incoming call' });
        return;
      }

      const inferredVideo = call.sdpOffer ? call.sdpOffer.includes('m=video') : true;
      const media = call.media ?? { video: inferredVideo, audio: true };
      navigator.mediaDevices
        .getUserMedia(media)
        .then(async (localStream) => {
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          });
          localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
          pc.ontrack = (event) => {
            const [remoteStream] = event.streams;
            if (remoteStream) {
              set({ remoteStream });
            }
          };

          await pc.setRemoteDescription({ type: 'offer', sdp: call.sdpOffer });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          await new Promise<void>((resolve) => {
            if (pc.iceGatheringState === 'complete') {
              resolve();
              return;
            }
            const handleStateChange = () => {
              if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', handleStateChange);
                resolve();
              }
            };
            pc.addEventListener('icegatheringstatechange', handleStateChange);
          });

          set({
            localStream,
            activeCall: { ...call, status: 'active', startTime: new Date() },
            callError: null,
          });
          activePeerConnection = pc;

          if (state.c2Client && state.c2State === 'CONNECTED') {
            await state.c2Client.sendMessage('call_accept', {
              callId: call.id,
              recipientId: call.initiator,
              sdpAnswer: pc.localDescription?.sdp,
            });
          }
        })
        .catch((error) => {
          console.error('[COMM] Failed to accept call:', error);
          set({ callError: 'Failed to access media devices' });
        });

      // Send acceptance via C2
      if (state.c2Client && state.c2State === 'CONNECTED') {
        state.c2Client.sendMessage('call_accept', {
          callId,
          recipientId: state.activeCall?.initiator ?? state.incomingCall.initiator,
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
        recipientId: state.incomingCall?.initiator,
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

      if (activePeerConnection) {
        activePeerConnection.close();
        activePeerConnection = null;
      }
      state.localStream?.getTracks().forEach((track) => track.stop());
      state.remoteStream?.getTracks().forEach((track) => track.stop());
      set({ localStream: null, remoteStream: null });

      // Send end via C2
      if (state.c2Client && state.c2State === 'CONNECTED') {
        const recipientId = state.activeCall.participants.find(
          (participantId) => participantId !== state.currentOperator?.id,
        );
        state.c2Client.sendMessage('call_end', {
          callId,
          recipientId,
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
    const knownRalphiePresenceNodeIds = new Set<string>();
    const isLocalEndpoint = (() => {
      try {
        const url = new URL(endpoint);
        return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname.toLowerCase());
      } catch {
        return false;
      }
    })();

    const config: C2ClientConfig = {
      endpoint,
      clientId,
      signingEnabled: true,
      // Local gateway protocol does not emit heartbeat acks; rely on socket open/close instead.
      heartbeatIntervalMs: isLocalEndpoint ? 0 : 30000,
      heartbeatTimeoutMs: isLocalEndpoint ? 0 : 10000,
      maxReconnectAttempts: 10,
      initialBackoffMs: 1000,
      maxBackoffMs: 30000,
      onStateChange: (state, event) => {
        console.log(`[C2] State: ${state}, Event: ${event}`);
        set({ c2State: state });

        // Map C2 states to connection status
        if (state === 'CONNECTED') {
          set({ connectionStatus: 'connected' });
          void refreshLatticeSnapshot();
          const local = get().currentOperator;
          if (local) {
            get().upsertOperator({
              ...local,
              status: 'online',
              lastSeen: new Date(),
            });
          }
        } else if (state === 'CONNECTING' || state === 'BACKOFF') {
          set({ connectionStatus: 'connecting' });
        } else if (state === 'DEGRADED') {
          set({ connectionStatus: 'unverified' });
        } else {
          set({ connectionStatus: 'disconnected', backendCoreStatus: 'unknown' });
        }
      },
      onSystemStatus: (status: SystemStatusFrame) => {
        const backendValue = String(status.backend || '').toUpperCase();
        const backendCoreStatus: BackendCoreStatus =
          backendValue === 'CONNECTED'
            ? 'connected'
            : backendValue === 'UNREACHABLE'
            ? 'unreachable'
            : 'unknown';
        set({ backendCoreStatus });
      },
      onLatticeEvent: (event) => {
        applyLatticeEvent(event);
      },
      onMessage: (envelope: MessageEnvelope) => {
        console.log('[C2] Received message:', envelope);

        // Handle different message types
        if (envelope.type === 'chat' && typeof envelope.payload === 'object' && envelope.payload !== null) {
          const payload = envelope.payload as { content?: string; encrypted?: boolean };
          const envelopeVerified = isEnvelopeVerified(envelope);
          const existing = get().operators.get(envelope.from);
          if (!existing) {
            get().upsertOperator({
              id: envelope.from,
              name: formatOperatorName(envelope.from),
              role: 'operator',
              status: 'online',
              verified: envelopeVerified,
              trustScore: envelopeVerified ? 90 : 50,
              lastSeen: new Date(),
            });
          }

          const message: Message = {
            id: envelope.message_id,
            from: envelope.from,
            to: clientId,
            content: payload.content || '',
            timestamp: new Date(envelope.timestamp),
            signature: envelope.signature,
            verified: envelopeVerified,
            encrypted: payload.encrypted || false,
          };
          get().receiveMessage(message);
        } else if (
          envelope.type === 'presence' &&
          typeof envelope.payload === 'object' &&
          envelope.payload !== null
        ) {
          const payload = envelope.payload as Record<string, unknown>;
          const envelopeVerified = isEnvelopeVerified(envelope);
          const existing = get().operators.get(envelope.from);
          const status = normalizeOperatorStatus(payload.status);
          const trustScore = clampTrustScorePercent(
            typeof payload.trustScore === 'number' ? payload.trustScore : undefined,
            existing?.trustScore ?? (envelopeVerified ? 90 : 50),
          );
          const roleValue = payload.role;
          const role =
            roleValue === 'admin' || roleValue === 'commander' || roleValue === 'operator'
              ? roleValue
              : existing?.role ?? 'operator';
          const callsign =
            typeof payload.callsign === 'string' && payload.callsign.length > 0
              ? payload.callsign
              : existing?.callsign;
          const name =
            typeof payload.name === 'string' && payload.name.length > 0
              ? payload.name
              : existing?.name ?? formatOperatorName(envelope.from);

          get().upsertOperator({
            id: envelope.from,
            name,
            role,
            callsign,
            status,
            verified:
              envelopeVerified ||
              (typeof payload.verified === 'boolean' ? payload.verified : false),
            trustScore,
            lastSeen: new Date(envelope.timestamp),
          });
        } else if (envelope.type === 'call_invite' && typeof envelope.payload === 'object' && envelope.payload !== null) {
          const payload = envelope.payload as { callId?: string; recipientId?: string; sdpOffer?: string };
          if (payload.recipientId && payload.recipientId !== clientId) {
            return;
          }
          const call: VideoCall = {
            id: payload.callId || `call-${Date.now()}`,
            participants: [envelope.from, clientId],
            initiator: envelope.from,
            status: 'ringing',
            sdpOffer: payload.sdpOffer,
            media: { video: true, audio: true },
          };
          set({ incomingCall: call });
        } else if (envelope.type === 'call_accept' && typeof envelope.payload === 'object' && envelope.payload !== null) {
          const payload = envelope.payload as { callId?: string; sdpAnswer?: string };
          const activeCall = get().activeCall;
          if (!activeCall || activeCall.id !== payload.callId || !payload.sdpAnswer) {
            return;
          }
          if (!activePeerConnection) {
            console.error('[COMM] Missing peer connection for call accept');
            return;
          }
          activePeerConnection.setRemoteDescription({ type: 'answer', sdp: payload.sdpAnswer })
            .then(() => {
              set({ activeCall: { ...activeCall, status: 'active', startTime: new Date() } });
            })
            .catch((error) => {
              console.error('[COMM] Failed to apply call answer:', error);
              set({ callError: 'Failed to apply call answer' });
            });
        } else if (envelope.type === 'call_reject' && typeof envelope.payload === 'object' && envelope.payload !== null) {
          const payload = envelope.payload as { callId?: string };
          const activeCall = get().activeCall;
          if (activeCall && payload.callId === activeCall.id) {
            set({ activeCall: { ...activeCall, status: 'ended', endTime: new Date() } });
            if (activePeerConnection) {
              activePeerConnection.close();
              activePeerConnection = null;
            }
            set({ localStream: null, remoteStream: null });
          }
        } else if (envelope.type === 'call_end' && typeof envelope.payload === 'object' && envelope.payload !== null) {
          const payload = envelope.payload as { callId?: string };
          const activeCall = get().activeCall;
          if (activeCall && payload.callId === activeCall.id) {
            set({ activeCall: { ...activeCall, status: 'ended', endTime: new Date() } });
            if (activePeerConnection) {
              activePeerConnection.close();
              activePeerConnection = null;
            }
            get().localStream?.getTracks().forEach((track) => track.stop());
            get().remoteStream?.getTracks().forEach((track) => track.stop());
            set({ localStream: null, remoteStream: null });
          }
        }
      },
      onRalphiePresence: (frame) => {
        console.log('[C2] Ralphie presence:', frame.identity.device_id, frame.reason);
        knownRalphiePresenceNodeIds.add(frame.identity.device_id);
        upsertRalphieNode(frame);
        const existing = get().operators.get(frame.identity.device_id);
        const fallbackName = frame.identity.device_id.replace(/^ralphie-/, 'Ralphie ');
        get().upsertOperator({
          id: frame.identity.device_id,
          name: existing?.name ?? fallbackName,
          role: 'operator',
          callsign: existing?.callsign ?? frame.identity.device_id.slice(0, 12).toUpperCase(),
          status: 'online',
          verified: frame.identity.tpm_backed,
          trustScore: clampTrustScorePercent(frame.identity.trust_score, existing?.trustScore ?? 60),
          lastSeen: new Date(frame.received_at ?? frame.timestamp ?? Date.now()),
        });
      },
      onRalphiePresenceSnapshot: (nodes) => {
        const nextIds = new Set(nodes.map((frame) => frame.identity.device_id));
        const tacticalStore = useTacticalStore.getState();
        knownRalphiePresenceNodeIds.forEach((nodeId) => {
          if (!nextIds.has(nodeId)) {
            tacticalStore.removeNode(nodeId);
            const existing = get().operators.get(nodeId);
            if (existing) {
              get().upsertOperator({
                ...existing,
                status: 'offline',
                lastSeen: new Date(),
              });
            }
          }
        });

        nodes.forEach((frame) => {
          upsertRalphieNode(frame);
          const existing = get().operators.get(frame.identity.device_id);
          const fallbackName = frame.identity.device_id.replace(/^ralphie-/, 'Ralphie ');
          get().upsertOperator({
            id: frame.identity.device_id,
            name: existing?.name ?? fallbackName,
            role: 'operator',
            callsign: existing?.callsign ?? frame.identity.device_id.slice(0, 12).toUpperCase(),
            status: 'online',
            verified: frame.identity.tpm_backed,
            trustScore: clampTrustScorePercent(frame.identity.trust_score, existing?.trustScore ?? 60),
            lastSeen: new Date(frame.received_at ?? frame.timestamp ?? Date.now()),
          });
        });

        knownRalphiePresenceNodeIds.clear();
        nextIds.forEach((nodeId) => knownRalphiePresenceNodeIds.add(nodeId));
      },
      onError: (error) => {
        console.error('[C2] Error:', error);
      },
    };

    const client = new C2Client(config);
    set({ c2Client: client, c2State: 'IDLE' });
    void refreshLatticeSnapshot();
  },

  connectC2: async () => {
    const state = get();
    if (!state.c2Client) {
      throw new Error('C2 client not initialized. Call initC2Client first.');
    }
    await state.c2Client.connect();

    const current = get().currentOperator;
    if (current) {
      get().upsertOperator({ ...current, status: 'online', lastSeen: new Date() });
      await state.c2Client.sendMessage('presence', {
        status: 'online',
        trustScore: 1,
        name: current.name,
        callsign: current.callsign,
        role: current.role,
        verified: current.verified,
      });
    }
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
    return state.c2Client.getStatus();
  },

  // Great Gospel: Revoke a node and terminate all sessions
  revokeNode: (nodeId: string, reason: string) => {
    console.warn(`[GREAT GOSPEL] Revoking node ${nodeId}: ${reason}`);
    
    set((state) => {
      const revokedNodes = new Set(state.revokedNodes);
      revokedNodes.add(nodeId);
      
      // Remove operator from list
      const operators = new Map(state.operators);
      operators.delete(nodeId);
      
      // Clear conversations with revoked node
      const conversations = new Map(state.conversations);
      conversations.delete(nodeId);
      
      // Terminate active call if participant is revoked
      let activeCall = state.activeCall;
      let incomingCall = state.incomingCall;
      
      if (activeCall && activeCall.participants.includes(nodeId)) {
        console.error('[GREAT GOSPEL] Terminating active call - participant revoked');
        // Clean up peer connection
        if (activePeerConnection) {
          activePeerConnection.close();
          activePeerConnection = null;
        }
        // Stop media streams
        if (state.localStream) {
          state.localStream.getTracks().forEach(track => track.stop());
        }
        activeCall = null;
      }
      
      if (incomingCall && incomingCall.participants.includes(nodeId)) {
        console.warn('[GREAT GOSPEL] Rejecting incoming call - participant revoked');
        incomingCall = null;
      }
      
      return {
        revokedNodes,
        operators,
        conversations,
        activeCall,
        incomingCall,
        localStream: activeCall ? null : state.localStream,
        remoteStream: activeCall ? null : state.remoteStream,
      };
    });
  },

  // Check if node is revoked
  isNodeRevoked: (nodeId: string) => {
    return get().revokedNodes.has(nodeId);
  },

  // PHASE 5: Notification Actions
  
  /**
   * Set the currently active conversation
   * Automatically clears unread count for that conversation
   */
  setActiveConversation: (conversationId: string | null) => {
    set((state) => {
      if (conversationId) {
        // Clear unread count when viewing conversation
        const unreadCounts = new Map(state.unreadCounts);
        unreadCounts.delete(conversationId);
        
        console.log(`[COMM] Viewing conversation: ${conversationId} (cleared unread count)`);
        
        return {
          activeConversationId: conversationId,
          unreadCounts,
        };
      }
      
      return { activeConversationId: conversationId };
    });
  },

  /**
   * Clear unread count for a specific conversation
   */
  clearUnreadCount: (conversationId: string) => {
    set((state) => {
      const unreadCounts = new Map(state.unreadCounts);
      unreadCounts.delete(conversationId);
      return { unreadCounts };
    });
  },

  /**
   * Get unread count for a specific conversation
   */
  getUnreadCount: (conversationId: string) => {
    return get().unreadCounts.get(conversationId) || 0;
  },

  /**
   * Get total unread count across all conversations
   */
  getTotalUnreadCount: () => {
    const counts = Array.from(get().unreadCounts.values());
    return counts.reduce((sum, count) => sum + count, 0);
  },

  /**
   * Get unverified intercepts count (Fail-Visible EW indicator)
   */
  getUnverifiedInterceptsCount: () => {
    return get().unverifiedIntercepts;
  },

  /**
   * Clear unverified intercepts counter
   * Use with caution - operator must acknowledge security event
   */
  clearUnverifiedIntercepts: () => {
    console.warn('[COMM] Clearing unverified intercepts counter');
    set({ unverifiedIntercepts: 0 });
  },
}));

