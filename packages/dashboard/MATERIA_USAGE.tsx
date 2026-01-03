/**
 * Materia System - Usage Guide & Examples
 * Hardware-rooted modular GUI capabilities
 */

// ============================================================================
// 1. BASIC IMPORT
// ============================================================================

import {
  MateriaSlot,
  ISRSlot,
  BioSlot,
  LedgerSlot,
  IdentitySlot,
  type MateriaSlotConfig,
  type ISRSlotConfig,
  type BioSlotConfig,
  type BioMetrics,
  type LedgerSlotConfig,
  type MerkleVineLinkData,
  type IdentitySlotConfig,
  type CodeRalphieCredential,
} from '@/materia';

// ============================================================================
// 2. ISR SLOT EXAMPLE (Video Surveillance)
// ============================================================================

export function ISRExample() {
  const [isOpen, setIsOpen] = React.useState(true);

  const isrConfig: ISRSlotConfig = {
    id: 'isr-forward-cam',
    type: 'isr',
    title: 'Forward ISR Feed',
    description: 'Real-time video from node-alpha',
    peerId: 'node-alpha',
    streamSource: undefined, // Connect to WebRTC stream
    integrityHash: 'a7f3c2b1d4e6f8a9b3c5d7e9f1a3b5d7',
  };

  return (
    <>
      {isOpen && (
        <ISRSlot
          config={isrConfig}
          onClose={() => setIsOpen(false)}
          onMinimize={() => console.log('Minimized')}
        />
      )}
    </>
  );
}

// ============================================================================
// 3. BIO SLOT EXAMPLE (Biometrics & Health)
// ============================================================================

export function BioExample() {
  const bioMetrics: BioMetrics = {
    heartRate: 78,
    spO2: 98.5,
    temperature: 37.2,
    bloodPressure: { systolic: 120, diastolic: 80 },
    respRate: 16,
    tpmAttestation: {
      verified: true,
      hashAlgorithm: 'BLAKE3',
      chainLength: 42,
    },
    timestamp: Date.now(),
  };

  const bioConfig: BioSlotConfig = {
    id: 'bio-operator-001',
    type: 'bio',
    title: 'Operator Vitals',
    nodeId: 'operator-001',
    metrics: bioMetrics,
    history: [75, 76, 77, 78, 77, 78, 79, 78, 77], // Heart rate history
  };

  return (
    <BioSlot
      config={bioConfig}
      onClose={() => console.log('Closed')}
      onMetricsUpdate={(newMetrics) => {
        console.log('Metrics updated:', newMetrics);
      }}
    />
  );
}

// ============================================================================
// 4. LEDGER SLOT EXAMPLE (Audit Trail)
// ============================================================================

export function LedgerExample() {
  const entries: MerkleVineLinkData[] = [
    {
      sequence: 1,
      currentHash: 'a7f3c2b1d4e6f8a9b3c5d7e9f1a3b5d7e9f1a3b5d7e9f1a3b5d7e9f1a3b5d7',
      previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
      timestampNs: 1704307200000000000,
      dataDescription: 'Node initialization event',
      verified: true,
    },
    {
      sequence: 2,
      currentHash: 'b8e4d3c2f5g7h9i1j3k5l7m9n1o3p5r7s9t1u3v5w7x9y1z3a5b7c9d1e3f5',
      previousHash: 'a7f3c2b1d4e6f8a9b3c5d7e9f1a3b5d7e9f1a3b5d7e9f1a3b5d7e9f1a3b5d7',
      timestampNs: 1704307260000000000,
      dataDescription: 'Trust mesh bootstrap',
      verified: true,
    },
  ];

  const ledgerConfig: LedgerSlotConfig = {
    id: 'ledger-node-001',
    type: 'ledger',
    title: 'Merkle Vine Ledger',
    nodeId: 'node-001',
    entries: entries,
    totalLength: 2,
  };

  return (
    <LedgerSlot
      config={ledgerConfig}
      onClose={() => console.log('Closed')}
      onEntryClick={(entry) => {
        console.log('Entry clicked:', entry);
      }}
    />
  );
}

// ============================================================================
// 5. IDENTITY SLOT EXAMPLE (CodeRalphie)
// ============================================================================

export function IdentityExample() {
  const credentials: CodeRalphieCredential[] = [
    {
      type: 'endorsement_key',
      publicKey:
        '308201223030300d06092a864886f70d01010105000304112033a7f3c2b1d4e6f8a9b3c5d7e9f1a3b5d',
      createdAt: 1704307200000,
      lastUsed: 1704320800000,
      algorithm: 'RSA-2048',
      active: true,
    },
    {
      type: 'attestation_key',
      publicKey:
        '308201223030300d06092a864886f70d01010105000304112044b8e4d3c2f5g7h9i1j3k5l7m9n1o3p5',
      createdAt: 1704307200000,
      lastUsed: 1704320800000,
      algorithm: 'ECC-P256',
      curve: 'nistp256',
      active: true,
    },
  ];

  const identityConfig: IdentitySlotConfig = {
    id: 'identity-node-001',
    type: 'identity',
    title: 'Node Identity',
    nodeId: 'node-001',
    nodeName: 'Alpha Squadron Leader',
    publicIdentityKey:
      'a7f3c2b1d4e6f8a9b3c5d7e9f1a3b5d7e9f1a3b5d7e9f1a3b5d7e9f1a3b5d7',
    credentials: credentials,
    trustScore: 92,
    verified: true,
    organization: 'Tactical Operations Center',
    role: 'Command Node',
  };

  return (
    <IdentitySlot
      config={identityConfig}
      onClose={() => console.log('Closed')}
      onCopyKey={(key) => {
        console.log('Key copied:', key);
      }}
    />
  );
}

// ============================================================================
// 6. COMPOSITE DASHBOARD LAYOUT
// ============================================================================

export function TacticalGlassDashboard() {
  const [slots, setSlots] = React.useState<MateriaSlotConfig[]>([
    {
      id: 'isr-1',
      type: 'isr',
      title: 'Forward Cam',
      minimized: false,
    },
    {
      id: 'bio-1',
      type: 'bio',
      title: 'Operator Vitals',
      minimized: false,
    },
    {
      id: 'ledger-1',
      type: 'ledger',
      title: 'Audit Trail',
      minimized: false,
    },
    {
      id: 'identity-1',
      type: 'identity',
      title: 'Node ID',
      minimized: false,
    },
  ]);

  const removeSlot = (id: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  const minimizeSlot = (id: string) => {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, minimized: !s.minimized } : s))
    );
  };

  return (
    <div className="grid grid-cols-2 gap-4 p-4">
      {slots.map((slot) => {
        if (slot.type === 'isr') {
          return (
            <ISRSlot
              key={slot.id}
              config={slot as ISRSlotConfig}
              onClose={() => removeSlot(slot.id)}
              onMinimize={() => minimizeSlot(slot.id)}
            />
          );
        } else if (slot.type === 'bio') {
          return (
            <BioSlot
              key={slot.id}
              config={slot as BioSlotConfig}
              onClose={() => removeSlot(slot.id)}
              onMinimize={() => minimizeSlot(slot.id)}
            />
          );
        } else if (slot.type === 'ledger') {
          return (
            <LedgerSlot
              key={slot.id}
              config={slot as LedgerSlotConfig}
              onClose={() => removeSlot(slot.id)}
              onMinimize={() => minimizeSlot(slot.id)}
            />
          );
        } else if (slot.type === 'identity') {
          return (
            <IdentitySlot
              key={slot.id}
              config={slot as IdentitySlotConfig}
              onClose={() => removeSlot(slot.id)}
              onMinimize={() => minimizeSlot(slot.id)}
            />
          );
        }
      })}
    </div>
  );
}

// ============================================================================
// 7. REAL-TIME DATA STREAMING EXAMPLE
// ============================================================================

export function RealTimeBioSlot() {
  const [metrics, setMetrics] = React.useState<BioMetrics>({
    heartRate: 72,
    spO2: 98.0,
    temperature: 36.8,
    bloodPressure: { systolic: 118, diastolic: 78 },
    respRate: 15,
    tpmAttestation: {
      verified: true,
      hashAlgorithm: 'BLAKE3',
      chainLength: 1234,
    },
    timestamp: Date.now(),
  });

  // Simulate WebSocket or real-time data
  React.useEffect(() => {
    const interval = setInterval(() => {
      setMetrics((prev) => ({
        ...prev,
        heartRate: Math.max(60, Math.min(100, prev.heartRate! + (Math.random() - 0.5) * 4)),
        spO2: Math.max(95, Math.min(100, prev.spO2! + (Math.random() - 0.5) * 0.5)),
        timestamp: Date.now(),
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <BioSlot
      config={{
        id: 'bio-realtime',
        type: 'bio',
        title: 'Real-Time Vitals',
        nodeId: 'monitor-001',
        metrics,
      }}
    />
  );
}

// ============================================================================
// 8. USAGE NOTES
// ============================================================================

/*
KEY PATTERNS:

1. COMPOSITION
   - Use Materia slots as building blocks in larger dashboards
   - Combine with map engine for geospatial + local data

2. STATE MANAGEMENT
   - Slots are controlled components (config-driven)
   - Parent manages visibility and data
   - Use Zustand or Context for shared state

3. TYPE SAFETY
   - All configs are strongly typed
   - Use 'as' operator for type switching if needed
   - Props are optional where sensible (description, data, etc)

4. REAL-TIME UPDATES
   - Pass fresh metrics/entries on each render
   - Use callbacks (onMetricsUpdate, onEntryClick) for events
   - Connect to WebSocket/NATS streams for live data

5. TACTICAL STYLING
   - All slots inherit glassmorphic styling
   - Borders and glows are automatic
   - Add custom className for layout adjustments

6. ACCESSIBILITY
   - All components are keyboard navigable
   - Color-coded status indicators
   - Font sizes optimized for Rajdhani/JetBrains Mono

EXAMPLE: Connect to Tauri:

import { invoke } from '@tauri-apps/api/core';

async function loadNodeMetrics(nodeId: string) {
  try {
    const metrics = await invoke('get_node_metrics', { nodeId });
    return metrics as BioMetrics;
  } catch (error) {
    console.error('Failed to load metrics:', error);
  }
}

EXAMPLE: Map Integration:

<div className="grid grid-cols-3 gap-4">
  <div className="col-span-2">
    <TacticalMap />
  </div>
  <div className="space-y-4">
    <BioSlot config={...} />
    <IdentitySlot config={...} />
  </div>
</div>
*/

export default TacticalGlassDashboard;
