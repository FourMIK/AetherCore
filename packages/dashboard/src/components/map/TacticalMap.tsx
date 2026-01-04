/**
 * TacticalMap
 * 3D tactical map using React Three Fiber with radar grid and nodes
 * Enhanced with Merkle-Vine integrity indicators
 */

import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useTacticalStore } from '../../store/useTacticalStore';
import { CoordinatesAdapter } from '../../map-engine/adapters/CoordinatesAdapter';

// Node Mesh Component
interface NodeMeshProps {
  nodeId: string;
  position: [number, number, number];
  trustScore: number;
  verified: boolean;
  integrityCompromised?: boolean;
  onClick: () => void;
}

const NodeMesh: React.FC<NodeMeshProps> = ({
  nodeId,
  position,
  trustScore,
  verified,
  integrityCompromised = false,
  onClick,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);

  // Strobe effect for compromised nodes
  useFrame((state, delta) => {
    if (integrityCompromised && meshRef.current) {
      timeRef.current += delta;
      // High-contrast strobe: 2Hz (500ms period)
      const strobeValue = Math.sin(timeRef.current * Math.PI * 4) > 0 ? 1 : 0.1;
      meshRef.current.material.emissiveIntensity = strobeValue * 2;
    }
  });

  // Color based on integrity and trust score
  const color = useMemo(() => {
    if (integrityCompromised) return '#FF2A2A'; // Red for compromised
    if (trustScore >= 80) return '#39FF14'; // Green for healthy
    if (trustScore >= 50) return '#FFAE00'; // Yellow for suspect
    return '#FF6B00'; // Orange for degraded
  }, [integrityCompromised, trustScore]);

  return (
    <group position={position}>
      <mesh ref={meshRef} onClick={onClick}>
        <sphereGeometry args={[2, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={verified ? 0.5 : 0.2}
        />
      </mesh>
      
      {/* Broken Vine indicator for compromised nodes */}
      {integrityCompromised && (
        <>
          {/* Pulsing warning ring */}
          <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[3, 3.5, 32]} />
            <meshBasicMaterial color="#FF2A2A" transparent opacity={0.6} />
          </mesh>
          
          {/* Label */}
          <Html
            position={[0, 5, 0]}
            center
            distanceFactor={10}
            style={{
              background: 'rgba(255, 42, 42, 0.95)',
              color: 'white',
              padding: '0.5rem 1rem',
              borderRadius: '0.25rem',
              fontWeight: 'bold',
              fontSize: '0.875rem',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              border: '2px solid white',
              boxShadow: '0 0 20px rgba(255, 42, 42, 0.8)',
              animation: 'pulse 1s ease-in-out infinite',
            }}
          >
            ⚠ BROKEN VINE
          </Html>
        </>
      )}
    </group>
  );
};

// Radar Grid Component
const RadarGrid: React.FC = () => {
  return (
    <>
      {/* Ground grid */}
      <Grid
        args={[200, 200]}
        cellSize={10}
        cellThickness={0.5}
        cellColor="#00D4FF"
        sectionSize={50}
        sectionThickness={1}
        sectionColor="#00D4FF"
        fadeDistance={300}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid={false}
      />

      {/* Polar grid overlay */}
      <primitive object={new THREE.GridHelper(200, 20, '#00D4FF', '#00D4FF')} />
    </>
  );
};

// Main TacticalMap Component
export const TacticalMap: React.FC = () => {
  const nodes = useTacticalStore((s) => s.nodes);
  const selectNode = useTacticalStore((s) => s.selectNode);
  const viewMode = useTacticalStore((s) => s.viewMode);

  const origin = { latitude: 0, longitude: 0, altitude: 0 };

  return (
    <div className="w-full h-full bg-carbon">
      <Canvas
        camera={{
          position: [50, 100, 50],
          fov: 75,
          near: 0.1,
          far: 10000,
        }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.3} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <pointLight position={[0, 50, 0]} intensity={0.5} color="#00D4FF" />

        {/* Radar Grid */}
        <RadarGrid />

        {/* Nodes */}
        {Array.from(nodes.entries()).map(([id, node]) => {
          const localPos = CoordinatesAdapter.geoToThree(node.position, origin);
          return (
            <NodeMesh
              key={id}
              nodeId={id}
              position={[localPos.x, localPos.y, localPos.z]}
              trustScore={node.trustScore}
              verified={node.verified}
              integrityCompromised={node.integrityCompromised}
              onClick={() => selectNode(id)}
            />
          );
        })}

        {/* Controls */}
        <OrbitControls
          enablePan={viewMode === '3d-local'}
          enableZoom={true}
          enableRotate={true}
          maxDistance={500}
          minDistance={10}
        />
      </Canvas>
    </div>
  );
};
