import type pino from 'pino';
import type {
  AdapterHealth,
  AdapterPullResult,
  AethercoreVerificationOverlayV1,
  BridgeConfig,
  LatticeEntityProjectionV1,
  LatticeInboundEventV1,
  LatticeObjectRecordV1,
  LatticeScenarioPhaseDefinition,
  LatticeScenarioRuntimeState,
  LatticeTaskInboxItemV1,
  LatticeVerificationStatus,
} from './types';

type ScenarioPhaseId =
  | 'phase_0_baseline'
  | 'phase_1_contact'
  | 'phase_2_incursion'
  | 'phase_3_response'
  | 'phase_4_resolution';

type ScenarioFaultId = 'spoof_burst' | 'stale_feed' | 'comms_degradation';

type ScenarioDomain = 'air' | 'land' | 'maritime' | 'control';

type ScenarioUnit = {
  id: string;
  title: string;
  side: 'friendly' | 'adversary' | 'neutral';
  domain: ScenarioDomain;
  entityType: string;
  baseLat: number;
  baseLon: number;
  phaseOffset: Array<{
    lat: number;
    lon: number;
    heading: number;
    speedMps: number;
    altitudeM: number;
  }>;
  defaultVerification: LatticeVerificationStatus;
  signatureValid: boolean;
  trustPosture: 'trusted' | 'degraded' | 'unknown';
};

const SCENARIO_ID = 'sf_bay_maritime_incursion_v1';

const SCENARIO_PHASES: LatticeScenarioPhaseDefinition[] = [
  {
    phaseId: 'phase_0_baseline',
    phaseLabel: 'Phase 0 - Baseline Patrol',
    summary: 'Normal Bay traffic picture with coastal defense posture established.',
  },
  {
    phaseId: 'phase_1_contact',
    phaseLabel: 'Phase 1 - Anomalous Contact',
    summary: 'ISR assets classify high-speed contacts approaching from west approaches.',
  },
  {
    phaseId: 'phase_2_incursion',
    phaseLabel: 'Phase 2 - Confirmed Incursion',
    summary: 'Adversary vessels enter defended waters with spoofing indicators emerging.',
  },
  {
    phaseId: 'phase_3_response',
    phaseLabel: 'Phase 3 - Coastal Response',
    summary: 'Friendly tasking converges to contain and shadow adversary vessels.',
  },
  {
    phaseId: 'phase_4_resolution',
    phaseLabel: 'Phase 4 - Intercept Resolution',
    summary: 'Incursion stabilizes and confidence recovers with corroborated evidence trails.',
  },
];

const UNITS: ScenarioUnit[] = [
  {
    id: 'C2-SFBAY',
    title: 'Sector Command Bay',
    side: 'friendly',
    domain: 'control',
    entityType: 'COMMAND_CENTER',
    baseLat: 37.8062,
    baseLon: -122.4653,
    phaseOffset: [
      { lat: 0.0, lon: 0.0, heading: 0, speedMps: 0, altitudeM: 20 },
      { lat: 0.0001, lon: 0.0001, heading: 0, speedMps: 0, altitudeM: 20 },
      { lat: 0.0001, lon: 0.0002, heading: 0, speedMps: 0, altitudeM: 20 },
      { lat: 0.0002, lon: 0.0003, heading: 0, speedMps: 0, altitudeM: 20 },
      { lat: 0.0002, lon: 0.0002, heading: 0, speedMps: 0, altitudeM: 20 },
    ],
    defaultVerification: 'VERIFIED',
    signatureValid: true,
    trustPosture: 'trusted',
  },
  {
    id: 'USCG-CUTTER-17',
    title: 'USCG Cutter 17',
    side: 'friendly',
    domain: 'maritime',
    entityType: 'SURFACE_VESSEL',
    baseLat: 37.8245,
    baseLon: -122.4498,
    phaseOffset: [
      { lat: 0.0, lon: 0.0, heading: 95, speedMps: 7.5, altitudeM: 0 },
      { lat: -0.006, lon: 0.012, heading: 120, speedMps: 10.0, altitudeM: 0 },
      { lat: -0.018, lon: 0.028, heading: 132, speedMps: 11.2, altitudeM: 0 },
      { lat: -0.024, lon: 0.036, heading: 145, speedMps: 13.4, altitudeM: 0 },
      { lat: -0.014, lon: 0.020, heading: 112, speedMps: 8.1, altitudeM: 0 },
    ],
    defaultVerification: 'VERIFIED',
    signatureValid: true,
    trustPosture: 'trusted',
  },
  {
    id: 'USN-LCS-2',
    title: 'USN Littoral Combat Ship 2',
    side: 'friendly',
    domain: 'maritime',
    entityType: 'SURFACE_VESSEL',
    baseLat: 37.8018,
    baseLon: -122.3784,
    phaseOffset: [
      { lat: 0.0, lon: 0.0, heading: 250, speedMps: 6.4, altitudeM: 0 },
      { lat: -0.004, lon: -0.010, heading: 242, speedMps: 8.0, altitudeM: 0 },
      { lat: -0.012, lon: -0.022, heading: 236, speedMps: 9.1, altitudeM: 0 },
      { lat: -0.017, lon: -0.032, heading: 224, speedMps: 11.5, altitudeM: 0 },
      { lat: -0.009, lon: -0.018, heading: 238, speedMps: 7.0, altitudeM: 0 },
    ],
    defaultVerification: 'VERIFIED',
    signatureValid: true,
    trustPosture: 'trusted',
  },
  {
    id: 'ISR-MQ9-01',
    title: 'ISR MQ-9 Overwatch',
    side: 'friendly',
    domain: 'air',
    entityType: 'UAS',
    baseLat: 37.8714,
    baseLon: -122.5392,
    phaseOffset: [
      { lat: 0.0, lon: 0.0, heading: 132, speedMps: 61.0, altitudeM: 4800 },
      { lat: -0.010, lon: 0.022, heading: 139, speedMps: 66.0, altitudeM: 4950 },
      { lat: -0.020, lon: 0.041, heading: 151, speedMps: 70.0, altitudeM: 5100 },
      { lat: -0.028, lon: 0.056, heading: 164, speedMps: 72.5, altitudeM: 5200 },
      { lat: -0.015, lon: 0.032, heading: 145, speedMps: 63.0, altitudeM: 4900 },
    ],
    defaultVerification: 'VERIFIED',
    signatureValid: true,
    trustPosture: 'trusted',
  },
  {
    id: 'ISR-HELO-07',
    title: 'ISR Helo 07',
    side: 'friendly',
    domain: 'air',
    entityType: 'HELICOPTER',
    baseLat: 37.7463,
    baseLon: -122.3897,
    phaseOffset: [
      { lat: 0.0, lon: 0.0, heading: 315, speedMps: 42.0, altitudeM: 850 },
      { lat: 0.009, lon: -0.018, heading: 302, speedMps: 44.0, altitudeM: 900 },
      { lat: 0.016, lon: -0.030, heading: 288, speedMps: 47.0, altitudeM: 950 },
      { lat: 0.020, lon: -0.041, heading: 270, speedMps: 49.0, altitudeM: 980 },
      { lat: 0.012, lon: -0.024, heading: 300, speedMps: 43.0, altitudeM: 880 },
    ],
    defaultVerification: 'STATUS_UNVERIFIED',
    signatureValid: true,
    trustPosture: 'unknown',
  },
  {
    id: 'COASTAL-BATTERY-01',
    title: 'Coastal Defense Battery 01',
    side: 'friendly',
    domain: 'land',
    entityType: 'FIRE_CONTROL',
    baseLat: 37.8082,
    baseLon: -122.5279,
    phaseOffset: [
      { lat: 0.0, lon: 0.0, heading: 80, speedMps: 0, altitudeM: 35 },
      { lat: 0.0002, lon: 0.0001, heading: 85, speedMps: 0, altitudeM: 35 },
      { lat: 0.0002, lon: 0.0002, heading: 92, speedMps: 0, altitudeM: 35 },
      { lat: 0.0002, lon: 0.0002, heading: 105, speedMps: 0, altitudeM: 35 },
      { lat: 0.0001, lon: 0.0001, heading: 84, speedMps: 0, altitudeM: 35 },
    ],
    defaultVerification: 'VERIFIED',
    signatureValid: true,
    trustPosture: 'trusted',
  },
  {
    id: 'ADV-FAC-RED-11',
    title: 'Red Fast Attack Craft 11',
    side: 'adversary',
    domain: 'maritime',
    entityType: 'FAST_ATTACK_CRAFT',
    baseLat: 37.9221,
    baseLon: -122.6474,
    phaseOffset: [
      { lat: 0.0, lon: 0.0, heading: 120, speedMps: 5.0, altitudeM: 0 },
      { lat: -0.018, lon: 0.031, heading: 131, speedMps: 12.0, altitudeM: 0 },
      { lat: -0.042, lon: 0.068, heading: 142, speedMps: 18.4, altitudeM: 0 },
      { lat: -0.056, lon: 0.091, heading: 151, speedMps: 21.0, altitudeM: 0 },
      { lat: -0.036, lon: 0.064, heading: 138, speedMps: 14.0, altitudeM: 0 },
    ],
    defaultVerification: 'STATUS_UNVERIFIED',
    signatureValid: true,
    trustPosture: 'degraded',
  },
  {
    id: 'ADV-UUV-RED-02',
    title: 'Red Subsurface UUV 02',
    side: 'adversary',
    domain: 'maritime',
    entityType: 'UUV',
    baseLat: 37.8632,
    baseLon: -122.6115,
    phaseOffset: [
      { lat: 0.0, lon: 0.0, heading: 110, speedMps: 2.0, altitudeM: -14 },
      { lat: -0.012, lon: 0.022, heading: 123, speedMps: 4.0, altitudeM: -18 },
      { lat: -0.024, lon: 0.040, heading: 129, speedMps: 6.4, altitudeM: -20 },
      { lat: -0.032, lon: 0.058, heading: 137, speedMps: 7.2, altitudeM: -22 },
      { lat: -0.016, lon: 0.027, heading: 124, speedMps: 3.8, altitudeM: -15 },
    ],
    defaultVerification: 'SPOOFED',
    signatureValid: false,
    trustPosture: 'degraded',
  },
];

function nowMs(): number {
  return Date.now();
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function parseCursor(cursor: string | null): number {
  const parsed = Number.parseInt(cursor || '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function trustScoreForStatus(status: LatticeVerificationStatus): number {
  if (status === 'VERIFIED') {
    return 0.95;
  }
  if (status === 'SPOOFED') {
    return 0.02;
  }
  return 0.42;
}

function byzantineFaultsForStatus(status: LatticeVerificationStatus): string[] {
  if (status === 'SPOOFED') {
    return ['InvalidSignature', 'SourceMismatch'];
  }
  if (status === 'STATUS_UNVERIFIED') {
    return ['PendingCrossSensorConfirmation'];
  }
  return [];
}

function clampPhaseIndex(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(SCENARIO_PHASES.length - 1, Math.floor(value)));
}

function timelineOffset(seedHash: number, sequence: number, index: number, scale: number): number {
  const mix = Math.imul(seedHash, 31) + Math.imul(sequence + 17, 97) + Math.imul(index + 13, 53);
  const normalized = ((mix % 2000) / 1000) - 1;
  return normalized * scale;
}

function modeFromFaults(faults: Set<string>, key: ScenarioFaultId): boolean {
  return faults.has(key);
}

function resolveTaskType(phaseIndex: number, unit: ScenarioUnit): 'move' | 'recon' | 'hold' | 'support' {
  if (unit.side === 'adversary') {
    return phaseIndex >= 2 ? 'move' : 'hold';
  }
  if (phaseIndex === 0) {
    return 'hold';
  }
  if (phaseIndex === 1) {
    return 'recon';
  }
  if (phaseIndex === 2) {
    return 'support';
  }
  return 'move';
}

export class LatticeSyntheticAdapter {
  private readonly healthState: AdapterHealth = {
    healthy: false,
    lastSuccessAtMs: null,
    lastFailureAtMs: null,
  };
  private readonly seedHash: number;
  private readonly replayWindowMs: number;
  private readonly replayTickCount = 288;
  private readonly replayStepMs: number;
  private readonly anchorNowMs: number;
  private runtimeState: LatticeScenarioRuntimeState;

  constructor(
    private readonly config: BridgeConfig,
    private readonly logger: pino.Logger,
    initialState?: LatticeScenarioRuntimeState,
  ) {
    this.seedHash = hashSeed(config.syntheticSeed || 'AETHERCORE-STABLE-SEED-001');
    this.replayWindowMs = Math.max(1, config.syntheticReplayHours) * 60 * 60 * 1000;
    this.replayStepMs = Math.max(30_000, Math.floor(this.replayWindowMs / this.replayTickCount));
    this.anchorNowMs = nowMs();

    const phaseIndex = clampPhaseIndex(initialState?.phaseIndex ?? 0);
    const phase = SCENARIO_PHASES[phaseIndex];
    this.runtimeState = {
      scenarioId: SCENARIO_ID,
      phaseId: phase.phaseId,
      phaseIndex,
      runState: initialState?.runState === 'active' ? 'active' : 'ready',
      activeFaults: Array.from(new Set(initialState?.activeFaults || [])),
      lastTransitionAtMs: initialState?.lastTransitionAtMs || null,
      runStartedAtMs: initialState?.runStartedAtMs || null,
      lastEventAtMs: initialState?.lastEventAtMs || null,
    };

    this.logger.info(
      {
        scenario: SCENARIO_ID,
        seed: config.syntheticSeed,
        timeline: config.syntheticTimeline,
        replay_hours: config.syntheticReplayHours,
        phase_id: this.runtimeState.phaseId,
      },
      'Synthetic lattice scenario adapter initialized',
    );
  }

  get health(): AdapterHealth {
    return { ...this.healthState };
  }

  get scenarioId(): string {
    return SCENARIO_ID;
  }

  get phases(): LatticeScenarioPhaseDefinition[] {
    return SCENARIO_PHASES.map((phase) => ({ ...phase }));
  }

  get state(): LatticeScenarioRuntimeState {
    return {
      ...this.runtimeState,
      activeFaults: [...this.runtimeState.activeFaults],
    };
  }

  setState(next: LatticeScenarioRuntimeState): void {
    const phaseIndex = clampPhaseIndex(next.phaseIndex);
    const phase = SCENARIO_PHASES[phaseIndex];
    this.runtimeState = {
      scenarioId: SCENARIO_ID,
      phaseId: phase.phaseId,
      phaseIndex,
      runState: next.runState === 'active' ? 'active' : 'ready',
      activeFaults: Array.from(new Set(next.activeFaults || [])),
      lastTransitionAtMs: next.lastTransitionAtMs || null,
      runStartedAtMs: next.runStartedAtMs || null,
      lastEventAtMs: next.lastEventAtMs || null,
    };
  }

  setPhase(phaseId: string): { ok: boolean; code?: string; message?: string } {
    const index = SCENARIO_PHASES.findIndex((phase) => phase.phaseId === phaseId);
    if (index < 0) {
      return {
        ok: false,
        code: 'INVALID_PHASE',
        message: `Unknown scenario phase: ${phaseId}`,
      };
    }
    this.runtimeState = {
      ...this.runtimeState,
      phaseId,
      phaseIndex: index,
      runState: 'active',
      runStartedAtMs: this.runtimeState.runStartedAtMs || nowMs(),
      lastTransitionAtMs: nowMs(),
    };
    return { ok: true };
  }

  advancePhase(): { ok: boolean; code?: string; message?: string } {
    if (this.runtimeState.phaseIndex >= SCENARIO_PHASES.length - 1) {
      return {
        ok: false,
        code: 'PHASE_AT_MAX',
        message: 'Scenario is already at the final phase',
      };
    }
    return this.setPhase(SCENARIO_PHASES[this.runtimeState.phaseIndex + 1].phaseId);
  }

  revertPhase(): { ok: boolean; code?: string; message?: string } {
    if (this.runtimeState.phaseIndex <= 0) {
      return {
        ok: false,
        code: 'PHASE_AT_MIN',
        message: 'Scenario is already at baseline phase',
      };
    }
    return this.setPhase(SCENARIO_PHASES[this.runtimeState.phaseIndex - 1].phaseId);
  }

  resetScenario(): void {
    this.runtimeState = {
      scenarioId: SCENARIO_ID,
      phaseId: SCENARIO_PHASES[0].phaseId,
      phaseIndex: 0,
      runState: 'ready',
      activeFaults: [],
      lastTransitionAtMs: nowMs(),
      runStartedAtMs: null,
      lastEventAtMs: null,
    };
  }

  injectFault(faultId: string): { ok: boolean; code?: string; message?: string } {
    const normalized = faultId.trim().toLowerCase() as ScenarioFaultId;
    if (!['spoof_burst', 'stale_feed', 'comms_degradation'].includes(normalized)) {
      return {
        ok: false,
        code: 'INVALID_FAULT',
        message: `Unsupported scenario fault: ${faultId}`,
      };
    }

    if (!this.runtimeState.activeFaults.includes(normalized)) {
      this.runtimeState.activeFaults = [...this.runtimeState.activeFaults, normalized];
      this.runtimeState.lastTransitionAtMs = nowMs();
    }

    return { ok: true };
  }

  clearFault(faultId?: string): { ok: boolean; code?: string; message?: string } {
    if (!faultId) {
      this.runtimeState.activeFaults = [];
      this.runtimeState.lastTransitionAtMs = nowMs();
      return { ok: true };
    }

    const normalized = faultId.trim().toLowerCase() as ScenarioFaultId;
    if (!this.runtimeState.activeFaults.includes(normalized)) {
      return {
        ok: false,
        code: 'FAULT_NOT_ACTIVE',
        message: `Fault is not active: ${faultId}`,
      };
    }

    this.runtimeState.activeFaults = this.runtimeState.activeFaults.filter((fault) => fault !== normalized);
    this.runtimeState.lastTransitionAtMs = nowMs();
    return { ok: true };
  }

  private markSuccess(): void {
    this.healthState.healthy = true;
    this.healthState.lastSuccessAtMs = nowMs();
    this.healthState.lastError = undefined;
  }

  private markFailure(error: unknown): void {
    this.healthState.healthy = false;
    this.healthState.lastFailureAtMs = nowMs();
    this.healthState.lastError = error instanceof Error ? error.message : String(error);
  }

  private timeline(sequence: number): { syntheticNowMs: number; phase: 'replay' | 'realtime' } {
    if (this.config.syntheticTimeline !== 'dual') {
      return { syntheticNowMs: nowMs(), phase: 'realtime' };
    }

    const replayStartMs = this.anchorNowMs - this.replayWindowMs;
    if (sequence <= this.replayTickCount) {
      return {
        syntheticNowMs: replayStartMs + sequence * this.replayStepMs,
        phase: 'replay',
      };
    }

    const postReplaySequence = sequence - this.replayTickCount;
    return {
      syntheticNowMs: this.anchorNowMs + postReplaySequence * this.config.pollIntervalMs,
      phase: 'realtime',
    };
  }

  private resolveVerificationStatus(unit: ScenarioUnit): {
    status: LatticeVerificationStatus;
    signatureValid: boolean;
    trustPosture: 'trusted' | 'degraded' | 'unknown';
  } {
    const faults = new Set(this.runtimeState.activeFaults);
    let status = unit.defaultVerification;
    let signatureValid = unit.signatureValid;
    let trustPosture = unit.trustPosture;

    if (this.runtimeState.phaseIndex >= 2 && unit.side === 'adversary' && status === 'STATUS_UNVERIFIED') {
      status = 'SPOOFED';
      signatureValid = false;
      trustPosture = 'degraded';
    }

    if (modeFromFaults(faults, 'spoof_burst') && (unit.side === 'adversary' || unit.id === 'ISR-HELO-07')) {
      status = 'SPOOFED';
      signatureValid = false;
      trustPosture = 'degraded';
    }

    if (modeFromFaults(faults, 'comms_degradation') && unit.side === 'friendly' && unit.id !== 'C2-SFBAY') {
      if (status === 'VERIFIED') {
        status = 'STATUS_UNVERIFIED';
      }
      trustPosture = 'unknown';
    }

    return {
      status,
      signatureValid,
      trustPosture,
    };
  }

  private buildEntityProjection(unit: ScenarioUnit, sequence: number, index: number): LatticeEntityProjectionV1 {
    const phaseOffset = unit.phaseOffset[this.runtimeState.phaseIndex] || unit.phaseOffset[0];
    const timeline = this.timeline(sequence);
    const faults = new Set(this.runtimeState.activeFaults);
    const verification = this.resolveVerificationStatus(unit);

    const driftLat = timelineOffset(this.seedHash, sequence, index, 0.0018);
    const driftLon = timelineOffset(this.seedHash ^ 0x4f3c, sequence, index, 0.0018);
    const motionScale = unit.side === 'adversary' ? 1.35 : 1.0;
    const sequenceMotion = Math.max(0, sequence % 24) / 24;

    const lat = unit.baseLat + phaseOffset.lat + driftLat + sequenceMotion * 0.004 * motionScale;
    const lon = unit.baseLon + phaseOffset.lon + driftLon + sequenceMotion * 0.005 * motionScale;

    const headingBase = (phaseOffset.heading + sequence * 3 + index * 17) % 360;
    const headingDeg = modeFromFaults(faults, 'spoof_burst') && unit.side === 'adversary'
      ? (headingBase + 67) % 360
      : headingBase;

    const speedMps = modeFromFaults(faults, 'spoof_burst') && unit.side === 'adversary'
      ? phaseOffset.speedMps + 8
      : phaseOffset.speedMps;

    const sourceUpdateTimeMs = (() => {
      if (modeFromFaults(faults, 'stale_feed') && unit.id === 'USCG-CUTTER-17') {
        return timeline.syntheticNowMs - 6 * 60 * 1000;
      }
      if (modeFromFaults(faults, 'stale_feed') && unit.id === 'ADV-UUV-RED-02') {
        return timeline.syntheticNowMs - 3 * 60 * 1000;
      }
      return timeline.syntheticNowMs + index * 101 + (this.seedHash % 89);
    })();

    const evidenceObjectIds = [
      `${SCENARIO_ID}:${unit.id}:thumbnail`,
      `${SCENARIO_ID}:${unit.id}:proof:phase-${this.runtimeState.phaseIndex}`,
    ];

    const overlay: AethercoreVerificationOverlayV1 = {
      schema: 'aethercore.verification.v1',
      entity_id: unit.id,
      verification_status: verification.status,
      trust_score: trustScoreForStatus(verification.status),
      byzantine_faults: byzantineFaultsForStatus(verification.status),
      merkle_event_hash: `synthetic-${SCENARIO_ID}-${unit.id}-${sequence}-hash`,
      merkle_prev_hash: `synthetic-${SCENARIO_ID}-${unit.id}-${Math.max(0, sequence - 1)}-hash`,
      signature_valid: verification.signatureValid,
      evaluated_at_ms: sourceUpdateTimeMs,
      evidence_object_ids: evidenceObjectIds,
      aethercore_version: '0.2.0',
      source: 'aethercore',
    };

    return {
      schema_version: 'lattice.entity.projection.v1',
      entity_id: unit.id,
      source: 'lattice.synthetic',
      source_update_time_ms: sourceUpdateTimeMs,
      event_type: 'UPSERT',
      verification_status: verification.status,
      received_at_ms: nowMs(),
      raw_entity: {
        entity_id: unit.id,
        title: unit.title,
        side: unit.side,
        domain: unit.domain,
        type: unit.entityType,
        location: {
          lat: Number(lat.toFixed(6)),
          lon: Number(lon.toFixed(6)),
          altitude_m: phaseOffset.altitudeM,
        },
        speed_mps: Number(speedMps.toFixed(2)),
        heading_deg: Number(headingDeg.toFixed(2)),
        signature_valid: verification.signatureValid,
        verification_status: verification.status,
        scenario_id: SCENARIO_ID,
        scenario_phase_id: this.runtimeState.phaseId,
        scenario_phase_index: this.runtimeState.phaseIndex,
        timeline_phase: timeline.phase,
        active_faults: [...this.runtimeState.activeFaults],
      },
      overlay,
    };
  }

  private toEntityEvent(unit: ScenarioUnit, sequence: number, index: number): LatticeInboundEventV1 {
    const projection = this.buildEntityProjection(unit, sequence, index);

    return {
      schema_version: 'lattice.inbound.event.v1',
      source_protocol: 'rest',
      event_id: `synthetic:entity:${projection.entity_id}:${projection.source_update_time_ms}`,
      stream_id: `lattice:entity:${projection.entity_id}`,
      received_at_ms: projection.received_at_ms,
      event: {
        kind: 'entity',
        projection,
      },
    };
  }

  private toTaskEvent(unit: ScenarioUnit, sequence: number, index: number): LatticeInboundEventV1 {
    const timeline = this.timeline(sequence);
    const verification = this.resolveVerificationStatus(unit);
    const taskType = resolveTaskType(this.runtimeState.phaseIndex, unit);
    const taskId = `${SCENARIO_ID}:${unit.id.toLowerCase()}:${taskType}`;
    const statusVersion = this.runtimeState.phaseIndex * 1000 + sequence * 10 + index;

    const task: LatticeTaskInboxItemV1 = {
      schema_version: 'lattice.task.inbox.v1',
      task_id: taskId,
      assigned_agent_id: unit.id,
      status: this.runtimeState.phaseIndex >= 3 ? 'IN_PROGRESS' : this.runtimeState.phaseIndex >= 1 ? 'ACKNOWLEDGED' : 'QUEUED',
      status_version: statusVersion,
      freshness_ms: Math.max(0, nowMs() - timeline.syntheticNowMs),
      trust_posture: verification.trustPosture,
      title: `${unit.title} ${taskType.toUpperCase()} Directive`,
      description: `${SCENARIO_PHASES[this.runtimeState.phaseIndex].summary} (${this.runtimeState.phaseId}).`,
      read_only: true,
      raw_task: {
        task_type: taskType,
        source: 'lattice.synthetic',
        scenario_id: SCENARIO_ID,
        scenario_phase_id: this.runtimeState.phaseId,
        verification_status: verification.status,
      },
      received_at_ms: nowMs(),
    };

    return {
      schema_version: 'lattice.inbound.event.v1',
      source_protocol: 'rest',
      event_id: `synthetic:task:${task.task_id}:${task.status_version}`,
      stream_id: `lattice:task:${task.assigned_agent_id}`,
      received_at_ms: task.received_at_ms,
      event: {
        kind: 'task',
        task,
      },
    };
  }

  private toObjectEvents(unit: ScenarioUnit, sequence: number, index: number): LatticeInboundEventV1[] {
    const timeline = this.timeline(sequence);

    const thumbnail: LatticeObjectRecordV1 = {
      schema_version: 'lattice.object.record.v1',
      object_id: `${SCENARIO_ID}:${unit.id}:thumbnail`,
      entity_id: unit.id,
      object_key: `synthetic/${SCENARIO_ID}/${unit.id.toLowerCase()}/thumbnail/latest.png`,
      media_type: 'image/png',
      ttl_seconds: 86400,
      metadata: {
        source: 'lattice.synthetic',
        scenario_id: SCENARIO_ID,
        class: 'thumbnail',
        phase_id: this.runtimeState.phaseId,
      },
      created_at_ms: timeline.syntheticNowMs - 45_000 + index * 33,
    };

    const evidence: LatticeObjectRecordV1 = {
      schema_version: 'lattice.object.record.v1',
      object_id: `${SCENARIO_ID}:${unit.id}:proof:phase-${this.runtimeState.phaseIndex}`,
      entity_id: unit.id,
      object_key: `synthetic/${SCENARIO_ID}/${unit.id.toLowerCase()}/proof/phase-${this.runtimeState.phaseIndex}.json`,
      media_type: 'application/json',
      ttl_seconds: 172800,
      metadata: {
        source: 'lattice.synthetic',
        scenario_id: SCENARIO_ID,
        class: 'proof_bundle',
        phase_id: this.runtimeState.phaseId,
        active_faults: [...this.runtimeState.activeFaults],
      },
      created_at_ms: timeline.syntheticNowMs - 15_000 + index * 41,
    };

    return [thumbnail, evidence].map((record) => ({
      schema_version: 'lattice.inbound.event.v1',
      source_protocol: 'rest',
      event_id: `synthetic:object:${record.object_id}:${record.created_at_ms}`,
      stream_id: `lattice:object:${record.entity_id}`,
      received_at_ms: nowMs(),
      event: {
        kind: 'object',
        object: record,
      },
    }));
  }

  async pullEntities(cursor: string | null): Promise<AdapterPullResult> {
    try {
      const sequence = parseCursor(cursor) + 1;
      const events = UNITS.map((unit, index) => this.toEntityEvent(unit, sequence, index));
      this.runtimeState.lastEventAtMs = nowMs();
      if (this.runtimeState.runState !== 'active') {
        this.runtimeState.runState = 'active';
        this.runtimeState.runStartedAtMs = this.runtimeState.runStartedAtMs || nowMs();
      }
      this.markSuccess();
      return {
        events,
        cursorHint: String(sequence),
        serverTimestampMs: nowMs(),
      };
    } catch (error) {
      this.markFailure(error);
      throw error;
    }
  }

  async pullTasks(cursor: string | null): Promise<AdapterPullResult> {
    try {
      const sequence = parseCursor(cursor) + 1;
      const events = UNITS.filter((unit) => unit.side === 'friendly' && unit.id !== 'C2-SFBAY').map((unit, index) =>
        this.toTaskEvent(unit, sequence, index),
      );
      this.markSuccess();
      return {
        events,
        cursorHint: String(sequence),
        serverTimestampMs: nowMs(),
      };
    } catch (error) {
      this.markFailure(error);
      throw error;
    }
  }

  async pullObjects(cursor: string | null): Promise<AdapterPullResult> {
    try {
      const sequence = parseCursor(cursor) + 1;
      const events = UNITS.flatMap((unit, index) => this.toObjectEvents(unit, sequence, index));
      this.markSuccess();
      return {
        events,
        cursorHint: String(sequence),
        serverTimestampMs: nowMs(),
      };
    } catch (error) {
      this.markFailure(error);
      throw error;
    }
  }
}
