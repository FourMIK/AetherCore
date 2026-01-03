/**
 * CoordinatesAdapter
 * Transforms coordinates between different mapping systems:
 * - Geographic (lat/lon)
 * - Three.js (local tactical)
 * - Cesium (3D global)
 * - Leaflet (2D)
 */

import * as THREE from 'three';
import { GeoPosition } from '../types';

export class CoordinatesAdapter {
  private static readonly EARTH_RADIUS = 6371000; // meters

  /**
   * Convert geographic coordinates to Three.js local coordinates
   * Uses a local tangent plane projection
   */
  static geoToThree(position: GeoPosition, origin: GeoPosition): THREE.Vector3 {
    const lat1 = (origin.latitude * Math.PI) / 180;
    const lon1 = (origin.longitude * Math.PI) / 180;
    const lat2 = (position.latitude * Math.PI) / 180;
    const lon2 = (position.longitude * Math.PI) / 180;

    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;

    // Local tangent plane approximation
    const x = this.EARTH_RADIUS * dLon * Math.cos((lat1 + lat2) / 2);
    const z = this.EARTH_RADIUS * dLat;
    const y = position.altitude || 0;

    return new THREE.Vector3(x, y, -z); // -z for correct orientation
  }

  /**
   * Convert Three.js local coordinates to geographic
   */
  static threeToGeo(vector: THREE.Vector3, origin: GeoPosition): GeoPosition {
    const lat1 = (origin.latitude * Math.PI) / 180;
    const lon1 = (origin.longitude * Math.PI) / 180;

    const dLat = -vector.z / this.EARTH_RADIUS;
    const dLon = vector.x / (this.EARTH_RADIUS * Math.cos(lat1));

    const lat2 = lat1 + dLat;
    const lon2 = lon1 + dLon;

    return {
      latitude: (lat2 * 180) / Math.PI,
      longitude: (lon2 * 180) / Math.PI,
      altitude: vector.y,
    };
  }

  /**
   * Convert geographic to Cesium Cartesian3
   */
  static geoToCesium(position: GeoPosition): any {
    // This will be used with Cesium.Cartesian3.fromDegrees
    return {
      longitude: position.longitude,
      latitude: position.latitude,
      height: position.altitude || 0,
    };
  }

  /**
   * Calculate distance between two geographic positions (Haversine formula)
   */
  static distance(pos1: GeoPosition, pos2: GeoPosition): number {
    const lat1 = (pos1.latitude * Math.PI) / 180;
    const lat2 = (pos2.latitude * Math.PI) / 180;
    const dLat = lat2 - lat1;
    const dLon = ((pos2.longitude - pos1.longitude) * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return this.EARTH_RADIUS * c;
  }

  /**
   * Calculate bearing between two geographic positions
   */
  static bearing(pos1: GeoPosition, pos2: GeoPosition): number {
    const lat1 = (pos1.latitude * Math.PI) / 180;
    const lat2 = (pos2.latitude * Math.PI) / 180;
    const dLon = ((pos2.longitude - pos1.longitude) * Math.PI) / 180;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    const bearing = Math.atan2(y, x);
    return ((bearing * 180) / Math.PI + 360) % 360;
  }
}
