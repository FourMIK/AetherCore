/**
 * Initialize dummy data for screenshots and demos
 */

import { useTacticalStore } from "./useTacticalStore";
import type { TacticalNode, Track, SecurityEvent } from "./useTacticalStore";

export const initDummyData = () => {
  const store = useTacticalStore.getState();

  console.log("🎬 Initializing dummy data for screenshots...");

  // Clear existing data
  store.clearNodes();
  store.clearTracks();
  store.clearEvents();

  // Sample tactical nodes with realistic positions (US-based coordinates)
  const dummyNodes: TacticalNode[] = [
    {
      id: "node-alpha-01",
      domain: "alpha.squad",
      position: { latitude: 37.7749, longitude: -122.4194, altitude: 50 }, // San Francisco
      trustScore: 98,
      verified: true,
      attestationHash: "0xabc123def456...",
      lastSeen: new Date(),
      status: "online",
      firmwareVersion: "v2.1.4",
      integrityCompromised: false,
    },
    {
      id: "node-alpha-02",
      domain: "alpha.squad",
      position: { latitude: 37.8044, longitude: -122.2712, altitude: 45 }, // Oakland
      trustScore: 95,
      verified: true,
      attestationHash: "0xdef789abc012...",
      lastSeen: new Date(Date.now() - 30000),
      status: "online",
      firmwareVersion: "v2.1.4",
      integrityCompromised: false,
    },
    {
      id: "node-bravo-01",
      domain: "bravo.squad",
      position: { latitude: 37.3382, longitude: -121.8863, altitude: 60 }, // San Jose
      trustScore: 92,
      verified: true,
      attestationHash: "0x456def789abc...",
      lastSeen: new Date(Date.now() - 120000),
      status: "online",
      firmwareVersion: "v2.1.3",
      integrityCompromised: false,
    },
    {
      id: "node-bravo-02",
      domain: "bravo.squad",
      position: { latitude: 37.5485, longitude: -121.9886, altitude: 55 }, // Fremont
      trustScore: 88,
      verified: true,
      attestationHash: "0x789abc123def...",
      lastSeen: new Date(Date.now() - 180000),
      status: "degraded",
      firmwareVersion: "v2.1.2",
      integrityCompromised: false,
    },
    {
      id: "node-charlie-01",
      domain: "charlie.squad",
      position: { latitude: 37.9577, longitude: -122.3477, altitude: 40 }, // Richmond
      trustScore: 75,
      verified: false,
      lastSeen: new Date(Date.now() - 300000),
      status: "offline",
      firmwareVersion: "v2.0.9",
      integrityCompromised: true,
    },
    {
      id: "node-delta-01",
      domain: "delta.squad",
      position: { latitude: 37.6879, longitude: -122.4702, altitude: 70 }, // Daly City
      trustScore: 100,
      verified: true,
      attestationHash: "0x321fed654cba...",
      lastSeen: new Date(),
      status: "online",
      firmwareVersion: "v2.1.4",
      integrityCompromised: false,
    },
    {
      id: "node-echo-01",
      domain: "echo.squad",
      position: { latitude: 38.5816, longitude: -121.4944, altitude: 35 }, // Sacramento
      trustScore: 94,
      verified: true,
      attestationHash: "0xfed987cba654...",
      lastSeen: new Date(Date.now() - 60000),
      status: "online",
      firmwareVersion: "v2.1.4",
      integrityCompromised: false,
    },
    {
      id: "node-echo-02",
      domain: "echo.squad",
      position: { latitude: 38.2975, longitude: -122.2869, altitude: 42 }, // Vallejo
      trustScore: 90,
      verified: true,
      attestationHash: "0xcba654fed987...",
      lastSeen: new Date(Date.now() - 90000),
      status: "online",
      firmwareVersion: "v2.1.3",
      integrityCompromised: false,
    },
  ];

  // Add nodes to store
  dummyNodes.forEach((node) => store.addNode(node));

  // Sample tracks for movement visualization
  const now = Date.now();
  const dummyTracks: Track[] = [
    {
      id: "track-001",
      nodeId: "node-alpha-01",
      timestamp: new Date(now - 300000),
      position: { latitude: 37.7649, longitude: -122.4294, altitude: 48 },
      velocity: 15,
      heading: 45,
    },
    {
      id: "track-002",
      nodeId: "node-alpha-01",
      timestamp: new Date(now - 240000),
      position: { latitude: 37.7699, longitude: -122.4244, altitude: 49 },
      velocity: 18,
      heading: 42,
    },
    {
      id: "track-003",
      nodeId: "node-alpha-01",
      timestamp: new Date(now - 180000),
      position: { latitude: 37.7729, longitude: -122.4214, altitude: 50 },
      velocity: 16,
      heading: 38,
    },
    {
      id: "track-004",
      nodeId: "node-bravo-01",
      timestamp: new Date(now - 600000),
      position: { latitude: 37.3282, longitude: -121.8963, altitude: 58 },
      velocity: 22,
      heading: 120,
    },
    {
      id: "track-005",
      nodeId: "node-bravo-01",
      timestamp: new Date(now - 480000),
      position: { latitude: 37.3332, longitude: -121.8913, altitude: 59 },
      velocity: 20,
      heading: 115,
    },
  ];

  dummyTracks.forEach((track) => store.addTrack(track));

  // Sample security events
  const dummyEvents: SecurityEvent[] = [
    {
      id: "evt-001",
      nodeId: "node-charlie-01",
      type: "verification_failed",
      timestamp: new Date(Date.now() - 600000),
      details: "Failed to verify attestation signature",
    },
    {
      id: "evt-002",
      nodeId: "node-bravo-02",
      type: "attestation_expired",
      timestamp: new Date(Date.now() - 300000),
      details: "Attestation certificate expired, renewal required",
    },
    {
      id: "evt-003",
      nodeId: "node-charlie-01",
      type: "byzantine_detected",
      timestamp: new Date(Date.now() - 180000),
      details: "Byzantine behavior detected: conflicting reports",
    },
  ];

  dummyEvents.forEach((event) => store.addEvent(event));

  // Select an interesting node for details panel
  store.selectNode("node-alpha-01");

  console.log("✅ Dummy data initialized:", {
    nodes: dummyNodes.length,
    tracks: dummyTracks.length,
    events: dummyEvents.length,
  });

  // Optional: Trigger a simulated Byzantine alert for dramatic effect
  setTimeout(() => {
    store.triggerByzantineAlert({
      nodeId: "node-charlie-01",
      reason: "Integrity check failed - Merkle-Vine chain broken",
      timestamp: Date.now(),
    });
  }, 2000);
};

// Auto-initialize if running in demo mode
if (import.meta.env.VITE_DEMO_MODE === "true") {
  initDummyData();
}
