/**
 * Mock Data Service
 * Generates realistic test data for AetherCore tablet app
 * Simulates nodes, trust scores, and Byzantine faults
 */

import { v4 as uuidv4 } from 'uuid';
import { TacticalNode, ByzantineFaultEvent, useTacticalStore } from '../store/useTacticalStore';

// Domain definitions
const DOMAINS = [
  { id: 'alpha-squad', name: 'Alpha Squad', color: '#00ff9f' },
  { id: 'bravo-squad', name: 'Bravo Squad', color: '#00d9ff' },
];

// Base node locations (example - could be user's actual location)
const BASE_LOCATIONS = [
  { name: 'Forward Operating Base', lat: 34.0522, lng: -118.2437 },
  { name: 'Remote Outpost A', lat: 34.0632, lng: -118.2437 },
  { name: 'Remote Outpost B', lat: 34.0422, lng: -118.2537 },
  { name: 'Supply Cache', lat: 34.0522, lng: -118.2537 },
  { name: 'Communication Hub', lat: 34.0622, lng: -118.2337 },
  { name: 'Forward Sensor Array', lat: 34.0422, lng: -118.2337 },
  { name: 'Backup Command Center', lat: 34.0522, lng: -118.2237 },
  { name: 'Reconnaissance Unit 1', lat: 34.0722, lng: -118.2437 },
  { name: 'Reconnaissance Unit 2', lat: 34.0322, lng: -118.2437 },
  { name: 'Medical Station', lat: 34.0522, lng: -118.2637 },
];

const FAULT_TYPES: Array<'InvalidSignature' | 'BrokenHashChain' | 'DoubleVote' | 'ReplayDetected'> = [
  'InvalidSignature',
  'BrokenHashChain',
  'DoubleVote',
  'ReplayDetected',
];

// Random helpers
function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max));
}

function generateDeviceId(): string {
  return `ralphie-${randomInt(1000, 9999)}`;
}

function generatePublicKey(): string {
  return `0x${Math.random().toString(16).slice(2)}`;
}

/**
 * Generate a realistic trust score with occasional drops for Byzantine detection
 */
function generateTrustScore(): number {
  const baseScore = randomBetween(0.5, 1.0);

  // 10% chance of low trust (suspect/quarantined)
  if (Math.random() < 0.1) {
    return randomBetween(0.2, 0.5);
  }

  return Math.min(1.0, baseScore);
}

function getTrustStatus(score: number): 'healthy' | 'suspect' | 'quarantined' {
  if (score >= 0.9) return 'healthy';
  if (score >= 0.6) return 'suspect';
  return 'quarantined';
}

/**
 * Create a single mock node
 */
function createMockNode(index: number, domain: string): TacticalNode {
  const location = BASE_LOCATIONS[index % BASE_LOCATIONS.length];
  const trustScore = generateTrustScore();

  // Add small random variance to location
  const lat = location.lat + randomBetween(-0.01, 0.01);
  const lng = location.lng + randomBetween(-0.01, 0.01);

  return {
    id: uuidv4(),
    name: `${location.name} (${generateDeviceId()})`,
    latitude: lat,
    longitude: lng,
    trustScore,
    status: getTrustStatus(trustScore),
    domain,
    lastUpdate: Date.now(),
    isHardwareBacked: Math.random() > 0.3, // 70% hardware backed
    publicKey: generatePublicKey(),
    signatureFailRate: Math.random() * (trustScore > 0.8 ? 0.01 : 0.1),
    replayEventCount: Math.floor(Math.random() * (trustScore > 0.8 ? 1 : 5)),
    packetLossRate: randomBetween(0, trustScore > 0.8 ? 0.05 : 0.2),
    uptime: randomInt(50, 100),
  };
}

/**
 * Generate realistic Byzantine fault events
 */
function generateFaultEvent(nodeId: string): ByzantineFaultEvent {
  const faultType = FAULT_TYPES[randomInt(0, FAULT_TYPES.length)];

  return {
    id: uuidv4(),
    timestamp: Date.now() - randomInt(0, 60000), // Within last minute
    faultType,
    nodeId,
    description: getFaultDescription(faultType),
    severity: getRandomSeverity(),
  };
}

function getFaultDescription(faultType: string): string {
  const descriptions: Record<string, string> = {
    InvalidSignature: 'Cryptographic signature verification failed',
    BrokenHashChain: 'Merkle Vine chain integrity broken',
    DoubleVote: 'Node submitted conflicting votes',
    ReplayDetected: 'Replay attack detected in event stream',
  };
  return descriptions[faultType] || 'Unknown fault';
}

function getRandomSeverity(): 'low' | 'medium' | 'high' | 'critical' {
  const r = Math.random();
  if (r < 0.5) return 'low';
  if (r < 0.75) return 'medium';
  if (r < 0.9) return 'high';
  return 'critical';
}

/**
 * Initialize mock data service
 */
export async function initializeMockData(): Promise<void> {
  const { addNode, addFaultEvent, setMeshConnected } = useTacticalStore.getState();

  // Create nodes for each domain
  let nodeIndex = 0;
  for (const domain of DOMAINS) {
    const nodesPerDomain = 5;
    for (let i = 0; i < nodesPerDomain; i++) {
      const node = createMockNode(nodeIndex++, domain.id);
      addNode(node);

      // 30% of nodes have Byzantine faults
      if (Math.random() < 0.3) {
        const eventCount = randomInt(1, 3);
        for (let j = 0; j < eventCount; j++) {
          const fault = generateFaultEvent(node.id);
          addFaultEvent(fault);
        }
      }
    }
  }

  // Start mesh as connected
  setMeshConnected(true);

  // Start background update loop
  startMockDataUpdates();
}

/**
 * Background loop that updates mock data periodically
 */
function startMockDataUpdates(): void {
  const store = useTacticalStore.getState();

  // Update nodes every 2-5 seconds
  setInterval(() => {
    const nodes = store.getAllNodes();

    nodes.forEach((node) => {
      // Slight random walk on trust score
      const delta = randomBetween(-0.05, 0.05);
      const newScore = Math.max(0, Math.min(1, node.trustScore + delta));

      store.updateNode(node.id, {
        trustScore: newScore,
        status: getTrustStatus(newScore),
        lastUpdate: Date.now(),
      });

      // Random Byzantine events (2% chance per node update)
      if (Math.random() < 0.02) {
        const fault = generateFaultEvent(node.id);
        store.addFaultEvent(fault);

        // Update node status if critical fault
        if (fault.severity === 'critical') {
          store.updateNode(node.id, {
            trustScore: randomBetween(0.2, 0.4),
            status: 'quarantined',
          });
        }
      }
    });
  }, randomInt(2000, 5000));
}

/**
 * Simulate a Byzantine attack
 */
export function simulateByzantineAttack(nodeId: string): void {
  const { updateNode, addFaultEvent } = useTacticalStore.getState();

  // Trigger multiple faults
  for (let i = 0; i < 3; i++) {
    addFaultEvent({
      id: uuidv4(),
      timestamp: Date.now(),
      faultType: FAULT_TYPES[i],
      nodeId,
      description: getFaultDescription(FAULT_TYPES[i]),
      severity: 'critical',
    });
  }

  // Drop node to quarantined
  updateNode(nodeId, {
    trustScore: 0.1,
    status: 'quarantined',
  });
}

/**
 * Simulate node recovery
 */
export function simulateNodeRecovery(nodeId: string): void {
  const { updateNode, clearFaultEvents } = useTacticalStore.getState();

  updateNode(nodeId, {
    trustScore: randomBetween(0.8, 1.0),
    status: 'healthy',
  });

  clearFaultEvents(nodeId);
}

