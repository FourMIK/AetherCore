/**
 * ThreeStrategy
 * 3D Local Tactical mapping using React Three Fiber
 */

import * as THREE from 'three';
import { MapStrategy, GeoPosition, MarkerOptions } from '../types';
import { CoordinatesAdapter } from '../adapters/CoordinatesAdapter';

export class ThreeStrategy implements MapStrategy {
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private markers: Map<string, THREE.Object3D> = new Map();
  private center: GeoPosition = { latitude: 0, longitude: 0, altitude: 0 };
  private origin: GeoPosition = { latitude: 0, longitude: 0, altitude: 0 };
  private zoom: number = 10;

  async initialize(container: HTMLElement): Promise<void> {
    // React Three Fiber handles scene creation
    // This is a minimal implementation for the strategy pattern
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      10000
    );
    this.camera.position.set(0, 100, 100);
    this.camera.lookAt(0, 0, 0);
  }

  setCenter(position: GeoPosition): void {
    this.center = position;
    if (this.camera) {
      const localPos = CoordinatesAdapter.geoToThree(position, this.origin);
      this.camera.position.set(localPos.x, localPos.y + 100, localPos.z + 100);
      this.camera.lookAt(localPos.x, 0, localPos.z);
    }
  }

  setZoom(level: number): void {
    this.zoom = level;
    if (this.camera) {
      const distance = 1000 / level;
      this.camera.position.y = distance;
      this.camera.position.z = distance;
    }
  }

  getCenter(): GeoPosition {
    return this.center;
  }

  getZoom(): number {
    return this.zoom;
  }

  addMarker(id: string, position: GeoPosition, options?: MarkerOptions): void {
    const localPos = CoordinatesAdapter.geoToThree(position, this.origin);
    
    // Create a simple marker mesh
    const geometry = new THREE.SphereGeometry(2, 16, 16);
    const material = new THREE.MeshBasicMaterial({ 
      color: options?.color || '#00D4FF' 
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.copy(localPos);
    
    this.markers.set(id, marker);
    if (this.scene) {
      this.scene.add(marker);
    }
  }

  removeMarker(id: string): void {
    const marker = this.markers.get(id);
    if (marker && this.scene) {
      this.scene.remove(marker);
      this.markers.delete(id);
    }
  }

  updateMarker(id: string, position: GeoPosition, options?: MarkerOptions): void {
    this.removeMarker(id);
    this.addMarker(id, position, options);
  }

  clearMarkers(): void {
    this.markers.forEach((marker) => {
      if (this.scene) {
        this.scene.remove(marker);
      }
    });
    this.markers.clear();
  }

  destroy(): void {
    this.clearMarkers();
    this.scene = null;
    this.camera = null;
  }
}
