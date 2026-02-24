/**
 * MDCA Telemetry Schema - Multi-Domain Collaborative Autonomy
 *
 * Extends C2 messaging with track origin, intent, and targeting data.
 * All telemetry events include cryptographic verification chains.
 *
 * Field Test Specific:
 * - Track origin validation under GNSS-denied conditions
 * - Spoof/replay detection and rejection metrics
 * - Verified intent coordination without persistent broadcast
 * - Latency measurement for decision cycle assessment
 */

import { z } from 'zod';

// ============================================================================
// TRACK ORIGIN - Position/ISR/Targeting Provenance
// ============================================================================

/**
 * Track Origin Verification
 *
 * Every unit position/targeting report must include cryptographic proof
 * of origin and an unbroken chain to hardware root of trust (CodeRalphie TPM).
 */
export const TrackOriginSchema = z.object({
  // Unique track identifier (persists across updates)
  track_id: z.string().uuid(),

  // Source unit (edge node) identity
  source_unit_id: z.string(),

  // Classification: ISR (intelligence/surveillance), FSO (fire support officer), C2
  classification: z.enum(['ISR', 'FSO', 'C2', 'SENSOR']),

  // Hardware root of trust attestation
  // Links position/targeting to TEE/TPM (CodeRalphie)
  attestation: z.object({
    // TPM quote (PCR values + signature)
    tpm_quote: z.string().regex(/^[0-9a-f]{64,}$/), // BLAKE3 hash
    // Attestation timestamp
    attestation_time_unix_ms: z.number().int().positive(),
    // Attestation freshness (max age seconds)
    max_freshness_seconds: z.number().int().min(30).max(3600),
  }),

  // Ancestry chain - cryptographic link to prior track state
  ancestor_hash: z.string().regex(/^[0-9a-f]{64}$/), // BLAKE3 hash of prior track

  // Verification signature
  // Signed by source_unit_id's private key (TPM-resident)
  signature: z.object({
    algorithm: z.literal('Ed25519'),
    value: z.string().regex(/^[0-9a-f]{128}$/), // Hex-encoded Ed25519 signature
    timestamp_signed_unix_ms: z.number().int().positive(),
  }),
});

export type TrackOrigin = z.infer<typeof TrackOriginSchema>;

// ============================================================================
// POSITION DATA - Enhanced with origin verification
// ============================================================================

export const PositionDataSchema = z.object({
  // Track origin verification
  origin: TrackOriginSchema,

  // Position (WGS84 or local grid)
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude_meters: z.number().optional(),

  // Confidence/accuracy metrics
  horizontal_accuracy_meters: z.number().min(0),
  vertical_accuracy_meters: z.number().min(0).optional(),
  // Confidence in position (0.0-1.0): 1.0 = high confidence, 0.0 = spoofed/untrustworthy
  confidence: z.number().min(0).max(1),

  // Position source (GNSS, INS, dead reckoning, etc.)
  source: z.enum(['GNSS', 'INS', 'DEAD_RECKONING', 'FUSION', 'CLAIMED', 'UNVERIFIED']),

  // If GNSS denied, indicate relative to last verified position
  gnss_available: z.boolean(),
  time_since_last_gnss_seconds: z.number().optional(),

  // Timestamp of position measurement
  position_time_unix_ms: z.number().int().positive(),

  // Velocity vector (optional, for track consistency checking)
  velocity: z
    .object({
      north_mps: z.number(),
      east_mps: z.number(),
      vertical_mps: z.number().optional(),
    })
    .optional(),
});

export type PositionData = z.infer<typeof PositionDataSchema>;

// ============================================================================
// INTENT DATA - Cryptographically signed unit intent
// ============================================================================

/**
 * Unit Intent - What this unit plans to do
 *
 * Used for collaborative autonomy coordination without persistent broadcast.
 * Must be cryptographically signed by operator (human) and accepted by destination unit.
 */
export const IntentDataSchema = z.object({
  origin: TrackOriginSchema,

  // Intent classification
  intent_type: z.enum([
    'MOVE', // Movement command
    'ENGAGE', // Fire/engage order
    'SUPPRESS', // Suppression of fire
    'DEFEND', // Defensive posture
    'HOLD_POSITION', // Stay in place
    'INVESTIGATE', // Investigate/scout
    'EXTRACT', // Extraction/evacuation
    'PROVIDE_SUPPORT', // Support other unit
  ]),

  // Primary waypoint (for MOVE, INVESTIGATE, EXTRACT)
  waypoint: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      tolerance_meters: z.number().min(1),
    })
    .optional(),

  // Target info (for ENGAGE, SUPPRESS, DEFEND, PROVIDE_SUPPORT)
  target: z
    .object({
      target_id: z.string(),
      // Target track origin (must be verified)
      target_origin: TrackOriginSchema.optional(),
      threat_level: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    })
    .optional(),

  // Commander intent (human-authored text)
  commander_intent: z.string().max(500),

  // Cryptographic authorization
  operator_authorization: z.object({
    // Operator identity (must be registered in Gateway auth service)
    operator_id: z.string(),
    // Operator signature (proves intent was authorized)
    operator_signature: z.string().regex(/^[0-9a-f]{128}$/), // Ed25519
    // When operator signed
    signed_time_unix_ms: z.number().int().positive(),
  }),

  // Destination unit must acknowledge receipt and acceptance
  unit_acceptance: z
    .object({
      destination_unit_id: z.string(),
      // Unit signature (proves unit received and understood)
      unit_signature: z.string().regex(/^[0-9a-f]{128}$/),
      // Acceptance timestamp
      accepted_time_unix_ms: z.number().int().positive(),
      // Unit acceptance status
      status: z.enum(['ACCEPTED', 'REJECTED_UNSAFE', 'REJECTED_INFEASIBLE']),
    })
    .optional(),

  // Intent window (valid from..to)
  valid_from_unix_ms: z.number().int().positive(),
  valid_until_unix_ms: z.number().int().positive(),

  // Replay/spoofing protection
  nonce: z.string().regex(/^[0-9a-f]{64}$/), // Random nonce
  sequence_number: z.number().int().min(0), // Monotonic counter
});

export type IntentData = z.infer<typeof IntentDataSchema>;

// ============================================================================
// TARGETING DATA - Fire control with provenance
// ============================================================================

export const TargetingDataSchema = z.object({
  origin: TrackOriginSchema,

  // Target ID (cross-reference to tracked entity)
  target_track_id: z.string().uuid(),

  // Targeting type
  targeting_type: z.enum(['FIRE_SOLUTION', 'TRACKING', 'ILLUMINATION']),

  // Fire solution parameters
  fire_solution: z
    .object({
      // Current target position (from latest track)
      target_position: PositionDataSchema.optional(),

      // Predicted future position (for engagement)
      predicted_position: z
        .object({
          latitude: z.number(),
          longitude: z.number(),
          time_ahead_seconds: z.number(),
        })
        .optional(),

      // Time to impact / Time to target
      time_to_impact_seconds: z.number().min(0),

      // Confidence weapon will hit (0.0-1.0)
      hit_probability: z.number().min(0).max(1),

      // Effects (blast radius, expected damage)
      effects: z
        .object({
          blast_radius_meters: z.number().optional(),
          expected_damage_assessment: z.string(),
        })
        .optional(),
    })
    .optional(),

  // Information source chain
  // Links back through ISR -> Fire support -> Targeting
  information_source_chain: z.array(
    z.object({
      source_unit_id: z.string(),
      data_type: z.enum(['POSITION', 'IDENTIFICATION', 'INTENT']),
      timestamp_unix_ms: z.number().int().positive(),
      verification_status: z.enum(['VERIFIED', 'UNVERIFIED', 'SPOOFED']),
    })
  ),

  // Cryptographic verification
  targeting_signature: z.object({
    algorithm: z.literal('Ed25519'),
    value: z.string().regex(/^[0-9a-f]{128}$/),
    signed_time_unix_ms: z.number().int().positive(),
  }),

  // Weapon authorization (must be from authorized operator)
  weapon_authorization: z
    .object({
      authorized_by_operator_id: z.string(),
      authorization_signature: z.string().regex(/^[0-9a-f]{128}$/),
      authorized_time_unix_ms: z.number().int().positive(),
    })
    .optional(),

  // Replay protection
  nonce: z.string().regex(/^[0-9a-f]{64}$/),
  sequence_number: z.number().int().min(0),
});

export type TargetingData = z.infer<typeof TargetingDataSchema>;

// ============================================================================
// FIELD TEST VERIFICATION EVENTS
// ============================================================================

/**
 * Spoof Detection Event
 *
 * Logged when a spoofed/invalid track or intent is detected and rejected.
 * Used to measure field test KPI: "Spoof/replay rejection rate"
 */
export const SpoofDetectionEventSchema = z.object({
  event_type: z.literal('SPOOF_DETECTION'),

  // What was spoofed
  spoofed_data_type: z.enum(['POSITION', 'INTENT', 'TARGETING']),

  // Why it was rejected
  rejection_reason: z.enum([
    'INVALID_SIGNATURE', // Signature didn't verify
    'REVOKED_UNIT', // Unit has been revoked (Great Gospel)
    'REPLAY_DETECTED', // Nonce/sequence number indicates replay
    'ANCESTOR_HASH_MISMATCH', // Merkle Vine chain broken
    'TIMESTAMP_TOO_OLD', // Freshness check failed
    'IMPOSSIBLE_KINEMATICS', // Track violates physics
    'CONFLICTING_ATTESTATION', // TPM quote doesn't match position
  ]),

  // Event source
  detector_unit_id: z.string(),
  detected_source_unit_id: z.string(),

  // Timestamp
  detected_time_unix_ms: z.number().int().positive(),

  // Event signature
  event_signature: z.string().regex(/^[0-9a-f]{128}$/),
});

export type SpoofDetectionEvent = z.infer<typeof SpoofDetectionEventSchema>;

/**
 * Verification Success Event
 *
 * Logged when a track/intent/targeting passes all verification checks.
 * Used to measure: "Track origin validation success rate"
 */
export const VerificationSuccessEventSchema = z.object({
  event_type: z.literal('VERIFICATION_SUCCESS'),

  // What was verified
  verified_data_type: z.enum(['POSITION', 'INTENT', 'TARGETING']),

  // Verification checks passed
  checks_passed: z.array(
    z.enum([
      'SIGNATURE_VALID',
      'UNIT_NOT_REVOKED',
      'FRESHNESS_OK',
      'ANCESTOR_HASH_OK',
      'ATTESTATION_VALID',
      'KINEMATICS_PLAUSIBLE',
    ])
  ),

  // Verification latency (time to verify)
  verification_latency_ms: z.number().int().min(0),

  // Trust score after verification (0.0-1.0)
  trust_score: z.number().min(0).max(1),

  // Verifying unit
  verifying_unit_id: z.string(),
  verified_source_unit_id: z.string(),

  // Timestamp
  verified_time_unix_ms: z.number().int().positive(),

  // Event signature
  event_signature: z.string().regex(/^[0-9a-f]{128}$/),
});

export type VerificationSuccessEvent = z.infer<typeof VerificationSuccessEventSchema>;

/**
 * Coordination Decision Event
 *
 * Logged when units coordinate an action (without persistent broadcast).
 * KPI: "Verified intent acceptance and coordination continuity"
 */
export const CoordinationDecisionEventSchema = z.object({
  event_type: z.literal('COORDINATION_DECISION'),

  // Coordination type
  coordination_type: z.enum([
    'JOINT_MOVE',
    'JOINT_ENGAGE',
    'FALLBACK',
    'MEDEVAC',
    'SUPPORT_REQUEST',
  ]),

  // Units involved
  coordinating_units: z.array(z.string()),

  // Decision authority (operator or autonomous consensus)
  decision_authority: z.enum(['OPERATOR_COMMANDED', 'AUTONOMOUS_CONSENSUS', 'C2_AUTHORIZED']),

  // If operator commanded, who authorized
  operator_id: z.string().optional(),

  // Intent that was coordinated
  coordinated_intent_id: z.string().uuid(),

  // All units accepted the intent
  all_units_accepted: z.boolean(),

  // Execution started timestamp
  execution_start_unix_ms: z.number().int().positive(),

  // Expected mission duration
  estimated_duration_seconds: z.number().min(0),

  // Broadcast messaging used (should be minimized in field test)
  broadcast_messages_sent: z.number().min(0),

  // Decision signature
  decision_signature: z.string().regex(/^[0-9a-f]{128}$/),
});

export type CoordinationDecisionEvent = z.infer<typeof CoordinationDecisionEventSchema>;

// ============================================================================
// FIELD TEST TELEMETRY SUMMARY
// ============================================================================

/**
 * Field Test Metrics Summary
 *
 * Aggregated metrics for post-test analysis.
 */
export const FieldTestMetricsSummarySchema = z.object({
  test_identifier: z.string(),
  test_start_unix_ms: z.number().int().positive(),
  test_end_unix_ms: z.number().int().positive(),

  // MDCA KPIs
  metrics: z.object({
    // KPI 1: Spoof/replay rejection rates
    total_spoofed_detections: z.number().int().min(0),
    spoof_rejection_rate_percent: z.number().min(0).max(100),

    // KPI 2: Track origin validation under degraded RF
    total_position_verifications: z.number().int().min(0),
    position_verification_success_rate_percent: z.number().min(0).max(100),
    average_verification_latency_ms: z.number().min(0),

    // KPI 3: Verified intent acceptance without persistent broadcast
    total_coordinations: z.number().int().min(0),
    consensus_coordination_success_percent: z.number().min(0).max(100),
    average_broadcast_messages_per_coordination: z.number().min(0),

    // KPI 4: Latency impact on decision cycles
    average_command_latency_ms: z.number().min(0),
    average_decision_cycle_time_seconds: z.number().min(0),
    command_latency_p99_ms: z.number().min(0),

    // KPI 5: Offline operation capability
    offline_operation_duration_seconds: z.number().min(0),
    offline_coordination_success_percent: z.number().min(0).max(100),

    // Network conditions during test
    rf_contested_percent: z.number().min(0).max(100),
    gnss_availability_percent: z.number().min(0).max(100),
    average_packet_loss_percent: z.number().min(0).max(100),
  }),

  // Participating units
  participating_units: z.array(z.string()),

  // Test verdict
  verdict: z.enum(['PASS', 'CONDITIONAL_PASS', 'FAIL']),

  // Operator notes
  operator_notes: z.string().optional(),
});

export type FieldTestMetricsSummary = z.infer<typeof FieldTestMetricsSummarySchema>;

// ============================================================================
// EXPORTS
// ============================================================================

export const MDCAMessageType = z.enum([
  'position',
  'intent',
  'targeting',
  'spoof_detection',
  'verification_success',
  'coordination_decision',
]);

export type MDCAMessageType = z.infer<typeof MDCAMessageType>;

/**
 * MDCA Telemetry Event (polymorphic)
 */
export const MDCAEventSchema = z.discriminatedUnion('event_type', [
  z.object({ event_type: z.literal('POSITION'), data: PositionDataSchema }),
  z.object({ event_type: z.literal('INTENT'), data: IntentDataSchema }),
  z.object({ event_type: z.literal('TARGETING'), data: TargetingDataSchema }),
  z.object({ event_type: z.literal('SPOOF_DETECTION'), data: SpoofDetectionEventSchema }),
  z.object({ event_type: z.literal('VERIFICATION_SUCCESS'), data: VerificationSuccessEventSchema }),
  z.object({
    event_type: z.literal('COORDINATION_DECISION'),
    data: CoordinationDecisionEventSchema,
  }),
]);

export type MDCAEvent = z.infer<typeof MDCAEventSchema>;
