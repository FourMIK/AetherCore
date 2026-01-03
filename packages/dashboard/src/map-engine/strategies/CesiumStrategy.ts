/**
 * CesiumStrategy
 * 3D Global Earth mapping using Cesium
 */

import { MapStrategy, GeoPosition, MarkerOptions } from '../types';

// Type definitions for Cesium (to avoid full import in strategy)
type CesiumViewer = any;
type CesiumEntity = any;

export class CesiumStrategy implements MapStrategy {
  private viewer: CesiumViewer | null = null;
  private markers: Map<string, CesiumEntity> = new Map();
  private center: GeoPosition = { latitude: 0, longitude: 0 };
  private zoom: number = 10;
  private Cesium: any = null;

  async initialize(container: HTMLElement): Promise<void> {
    // Dynamically import Cesium to avoid loading it unless needed
    const cesiumModule = await import('cesium');
    this.Cesium = cesiumModule;

    // Set Cesium Ion default access token (should be configured in env)
    if (this.Cesium.Ion && this.Cesium.Ion.defaultAccessToken === undefined) {
      // Placeholder - should be set from config
      this.Cesium.Ion.defaultAccessToken = 'YOUR_CESIUM_ION_TOKEN';
    }

    this.viewer = new this.Cesium.Viewer(container, {
      terrainProvider: this.Cesium.createWorldTerrain(),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
    });

    this.setCenter(this.center);
  }

  setCenter(position: GeoPosition): void {
    this.center = position;
    if (this.viewer && this.Cesium) {
      const destination = this.Cesium.Cartesian3.fromDegrees(
        position.longitude,
        position.latitude,
        position.altitude || 10000
      );
      this.viewer.camera.flyTo({
        destination,
        duration: 2,
      });
    }
  }

  setZoom(level: number): void {
    this.zoom = level;
    if (this.viewer && this.Cesium) {
      const height = 100000 / level;
      const destination = this.Cesium.Cartesian3.fromDegrees(
        this.center.longitude,
        this.center.latitude,
        height
      );
      this.viewer.camera.flyTo({
        destination,
        duration: 1,
      });
    }
  }

  getCenter(): GeoPosition {
    if (this.viewer && this.Cesium) {
      const cameraPosition = this.viewer.camera.positionCartographic;
      return {
        latitude: this.Cesium.Math.toDegrees(cameraPosition.latitude),
        longitude: this.Cesium.Math.toDegrees(cameraPosition.longitude),
        altitude: cameraPosition.height,
      };
    }
    return this.center;
  }

  getZoom(): number {
    return this.zoom;
  }

  addMarker(id: string, position: GeoPosition, options?: MarkerOptions): void {
    if (!this.viewer || !this.Cesium) return;

    const entity = this.viewer.entities.add({
      position: this.Cesium.Cartesian3.fromDegrees(
        position.longitude,
        position.latitude,
        position.altitude || 0
      ),
      point: {
        pixelSize: 10,
        color: this.Cesium.Color.fromCssColorString(options?.color || '#00D4FF'),
        outlineColor: this.Cesium.Color.WHITE,
        outlineWidth: 2,
      },
      label: options?.label
        ? {
            text: options.label,
            font: '14px sans-serif',
            fillColor: this.Cesium.Color.WHITE,
            outlineColor: this.Cesium.Color.BLACK,
            outlineWidth: 2,
            verticalOrigin: this.Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new this.Cesium.Cartesian2(0, -10),
          }
        : undefined,
    });

    this.markers.set(id, entity);
  }

  removeMarker(id: string): void {
    const entity = this.markers.get(id);
    if (entity && this.viewer) {
      this.viewer.entities.remove(entity);
      this.markers.delete(id);
    }
  }

  updateMarker(id: string, position: GeoPosition, options?: MarkerOptions): void {
    this.removeMarker(id);
    this.addMarker(id, position, options);
  }

  clearMarkers(): void {
    this.markers.forEach((entity) => {
      if (this.viewer) {
        this.viewer.entities.remove(entity);
      }
    });
    this.markers.clear();
  }

  destroy(): void {
    this.clearMarkers();
    if (this.viewer) {
      this.viewer.destroy();
      this.viewer = null;
    }
  }
}
