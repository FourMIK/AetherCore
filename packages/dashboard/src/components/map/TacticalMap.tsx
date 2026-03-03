/**
 * TacticalMap
 * 3D tactical map using React Three Fiber with radar grid and live node rendering.
 */

import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Grid, Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useCommStore } from '../../store/useCommStore';
import { useTacticalStore } from '../../store/useTacticalStore';
import { CoordinatesAdapter } from '../../map-engine/adapters/CoordinatesAdapter';

interface RenderedNode {
  id: string;
  domain: string;
  trustScore: number;
  verified: boolean;
  integrityCompromised?: boolean;
  status: 'online' | 'offline' | 'degraded' | 'compromised' | 'revoked';
  position: [number, number, number];
  phase: number;
}

interface NodeMeshProps {
  node: RenderedNode;
  selected: boolean;
  onClick: () => void;
}

const NODE_BASE_ALTITUDE = 2;
const NODE_FIT_RADIUS = 84;

const NodeMesh: React.FC<NodeMeshProps> = ({ node, selected, onClick }) => {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  const color = useMemo(() => {
    // Fail-Visible: Byzantine/compromised nodes are RED
    if (node.status === 'revoked') return '#808080'; // Ghost gray for revoked
    if (node.status === 'compromised' || node.integrityCompromised) return '#ff2a2a'; // Red for Byzantine
    if (node.status === 'offline') return '#64748b';
    if (node.trustScore >= 80) return '#39ff14';
    if (node.trustScore >= 50) return '#ffae00';
    return '#ff6b00';
  }, [node.status, node.integrityCompromised, node.trustScore]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + node.phase;
    const bob = Math.sin(t * 1.4) * 0.6;
    if (groupRef.current) {
      groupRef.current.position.y = node.position[1] + bob;
    }

    const coreMaterial = coreRef.current?.material;
    if (coreMaterial && coreMaterial instanceof THREE.MeshStandardMaterial) {
      if (node.integrityCompromised) {
        const strobe = Math.sin(t * Math.PI * 4) > 0 ? 2.4 : 0.15;
        coreMaterial.emissiveIntensity = strobe;
      } else {
        const pulse = 0.35 + Math.max(0, Math.sin(t * 2.2)) * 0.4;
        const selectedBoost = selected ? 0.45 : 0;
        coreMaterial.emissiveIntensity = pulse + selectedBoost;
      }
    }

    if (ringRef.current) {
      const wave = 1 + Math.max(0, Math.sin(t * 2.4)) * 0.35;
      ringRef.current.scale.setScalar(selected ? wave * 1.15 : wave);
    }
  });

  return (
    <group ref={groupRef} position={node.position}>
      <mesh ref={coreRef} onClick={onClick}>
        <sphereGeometry args={[2.2, 20, 20]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.6}
          roughness={0.32}
          metalness={0.08}
        />
      </mesh>

      <mesh ref={ringRef} position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.1, 3.6, 48]} />
        <meshBasicMaterial
          color={selected ? '#00f0ff' : color}
          transparent
          opacity={selected ? 0.9 : 0.5}
        />
      </mesh>

      <Html
        position={[0, 5.6, 0]}
        center
        distanceFactor={9}
        style={{
          minWidth: 118,
          background: 'rgba(6, 14, 24, 0.92)',
          border: `1px solid ${selected ? '#00d4ff' : '#1f3f5a'}`,
          borderRadius: 8,
          color: '#d8f3ff',
          padding: '6px 8px',
          fontSize: 11,
          lineHeight: 1.25,
          boxShadow: selected ? '0 0 18px rgba(0, 212, 255, 0.35)' : 'none',
        }}
      >
        <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700 }}>
          {node.id.slice(0, 16)}
          {node.id.length > 16 ? '...' : ''}
        </div>
        <div style={{ opacity: 0.85 }}>Trust {node.trustScore}%</div>
      </Html>
    </group>
  );
};

interface LinkBeamProps {
  from: [number, number, number];
  to: [number, number, number];
  active: boolean;
  phase: number;
}

const LinkBeam: React.FC<LinkBeamProps> = ({ from, to, active, phase }) => {
  const packetRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!packetRef.current || !active) return;
    const t = (clock.getElapsedTime() * 0.24 + phase) % 1;
    packetRef.current.position.set(
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t
    );
  });

  return (
    <group>
      <Line
        points={[from, to]}
        color={active ? '#00d4ff' : '#475569'}
        transparent
        opacity={active ? 0.78 : 0.35}
        lineWidth={1.2}
      />
      {active && (
        <mesh ref={packetRef} position={from}>
          <sphereGeometry args={[0.45, 12, 12]} />
          <meshBasicMaterial color="#39ff14" />
        </mesh>
      )}
    </group>
  );
};

const RadarGrid: React.FC = () => {
  const sweepRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (sweepRef.current) {
      sweepRef.current.rotation.z += delta * 0.48;
    }
    if (pulseRef.current) {
      const t = performance.now() / 1000;
      const wave = 1 + (Math.sin(t * 1.6) + 1) * 0.08;
      pulseRef.current.scale.set(wave, wave, wave);
    }
  });

  return (
    <>
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[190, 190]} />
        <meshBasicMaterial color="#02111f" transparent opacity={0.45} />
      </mesh>

      <Grid
        args={[200, 200]}
        cellSize={10}
        cellThickness={0.52}
        cellColor="#00c9ff"
        sectionSize={50}
        sectionThickness={1}
        sectionColor="#00e7ff"
        fadeDistance={320}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid={false}
      />

      <mesh ref={sweepRef} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3, 92, 64, 1, 0, Math.PI / 3]} />
        <meshBasicMaterial color="#0ea5e9" transparent opacity={0.22} side={THREE.DoubleSide} />
      </mesh>

      <mesh ref={pulseRef} position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[10, 11, 64]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.26} />
      </mesh>
    </>
  );
};

const C2Hub: React.FC<{ nodeCount: number }> = ({ nodeCount }) => {
  const hubRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!hubRef.current) return;
    const t = clock.getElapsedTime();
    const material = hubRef.current.material;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.emissiveIntensity = 0.4 + Math.max(0, Math.sin(t * 2)) * 0.5;
    }
  });

  return (
    <group position={[0, NODE_BASE_ALTITUDE, 0]}>
      <mesh ref={hubRef}>
        <sphereGeometry args={[3.1, 22, 22]} />
        <meshStandardMaterial
          color="#22d3ee"
          emissive="#22d3ee"
          emissiveIntensity={0.6}
          roughness={0.24}
          metalness={0.1}
        />
      </mesh>
      <Html
        position={[0, 6.6, 0]}
        center
        distanceFactor={8}
        style={{
          background: 'rgba(6, 18, 30, 0.92)',
          border: '1px solid #1e90b8',
          borderRadius: 8,
          color: '#cffafe',
          padding: '6px 8px',
          fontSize: 11,
          lineHeight: 1.25,
        }}
      >
        <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700 }}>
          C2 GATEWAY
        </div>
        <div style={{ opacity: 0.88 }}>{nodeCount} active link{nodeCount === 1 ? '' : 's'}</div>
      </Html>
    </group>
  );
};

export const TacticalMap: React.FC = () => {
  const nodesMap = useTacticalStore((s) => s.nodes) || new Map();
  const selectedNodeId = useTacticalStore((s) => s.selectedNodeId);
  const selectNode = useTacticalStore((s) => s.selectNode);
  const viewMode = useTacticalStore((s) => s.viewMode);
  const connectionStatus = useCommStore((s) => s.connectionStatus);

  const nodes = useMemo(
    () => Array.from(nodesMap.values()).sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime()),
    [nodesMap]
  );

  const origin = useMemo(() => {
    if (nodes.length === 0) {
      return { latitude: 37.7749, longitude: -122.4194, altitude: 0 };
    }
    const sums = nodes.reduce(
      (acc, node) => {
        acc.lat += node.position.latitude;
        acc.lon += node.position.longitude;
        acc.alt += node.position.altitude || 0;
        return acc;
      },
      { lat: 0, lon: 0, alt: 0 }
    );
    return {
      latitude: sums.lat / nodes.length,
      longitude: sums.lon / nodes.length,
      altitude: sums.alt / nodes.length,
    };
  }, [nodes]);

  const renderedNodes = useMemo<RenderedNode[]>(() => {
    if (nodes.length === 0) return [];

    const projected = nodes.map((node, index) => {
      const raw = CoordinatesAdapter.geoToThree(node.position, origin);
      return { node, index, raw };
    });

    const maxDistance = projected.reduce((max, entry) => {
      const distance = Math.hypot(entry.raw.x, entry.raw.z);
      return Math.max(max, distance);
    }, 1);
    const fitScale = maxDistance > NODE_FIT_RADIUS ? NODE_FIT_RADIUS / maxDistance : 1;

    return projected.map(({ node, index, raw }) => ({
      id: node.id,
      domain: node.domain,
      trustScore: node.trustScore,
      verified: node.verified,
      integrityCompromised: node.integrityCompromised,
      status: node.status,
      position: [
        raw.x * fitScale,
        NODE_BASE_ALTITUDE + Math.max(0, (raw.y || 0) * 0.015),
        raw.z * fitScale,
      ],
      phase: index * 0.37,
    }));
  }, [nodes, origin]);

  const activeNodes = renderedNodes.filter((node) => node.status !== 'offline');

  return (
    <div className="w-full h-full bg-carbon relative">
      <Canvas
        camera={{
          position: [0, 100, 112],
          fov: 62,
          near: 0.1,
          far: 4000,
        }}
      >
        <ambientLight intensity={0.35} />
        <directionalLight position={[12, 26, 12]} intensity={1.05} />
        <pointLight position={[0, 38, 0]} intensity={0.55} color="#00d4ff" />

        <RadarGrid />
        <C2Hub nodeCount={activeNodes.length} />

        {activeNodes.map((node) => (
          <LinkBeam
            key={`link-${node.id}`}
            from={[0, NODE_BASE_ALTITUDE, 0]}
            to={node.position}
            active={node.status === 'online'}
            phase={node.phase}
          />
        ))}

        {renderedNodes.map((node) => (
          <NodeMesh
            key={node.id}
            node={node}
            selected={selectedNodeId === node.id}
            onClick={() => selectNode(node.id)}
          />
        ))}

        <OrbitControls
          enablePan={viewMode === '3d-local'}
          enableZoom
          enableRotate
          maxDistance={420}
          minDistance={35}
          target={[0, NODE_BASE_ALTITUDE, 0]}
        />
      </Canvas>

      {renderedNodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-overmatch/30 bg-carbon/80 px-4 py-3 text-center text-tungsten/80 shadow-[0_0_24px_rgba(0,212,255,0.12)]">
            <p className="font-display text-sm tracking-wide text-overmatch">TACTICAL FEED STANDBY</p>
            <p className="mt-1 text-xs">
              {connectionStatus === 'connected'
                ? 'Connected. Waiting for node telemetry heartbeat...'
                : 'Establishing mesh link and awaiting node telemetry...'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
