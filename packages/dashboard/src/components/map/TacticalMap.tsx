/**
 * TacticalMap
 * 3D tactical map using React Three Fiber with radar grid and nodes
 */

import React, { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useTacticalStore } from '../../store/useTacticalStore';
import { CoordinatesAdapter } from '../../map-engine/adapters/CoordinatesAdapter';

// Node Mesh Component
interface NodeMeshProps {
  nodeId: string;
  position: [number, number, number];
  trustScore: number;
  verified: boolean;
  onClick: () => void;
}

const NodeMesh: React.FC<NodeMeshProps> = ({
  nodeId,
  position,
  trustScore,
  verified,
  onClick,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);

  // Color based on trust score
  const color = trustScore >= 80 ? '#39FF14' : trustScore >= 50 ? '#FFAE00' : '#FF2A2A';

  return (
    <mesh ref={meshRef} position={position} onClick={onClick}>
      <sphereGeometry args={[2, 16, 16]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={verified ? 0.5 : 0.2}
      />
    </mesh>
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
