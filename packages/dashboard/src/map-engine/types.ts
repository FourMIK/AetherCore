/**
 * Map Engine Types
 * Defines the core interfaces for the multi-strategy map system
 */

export interface GeoPosition {
  latitude: number;
  longitude: number;
  altitude?: number;
}

export type ViewMode = '2d' | '3d-local' | '3d-global';
export type MapProviderType = 'leaflet' | 'three' | 'cesium';

export interface MapController {
  setCenter(position: GeoPosition): void;
  setZoom(level: number): void;
  getCenter(): GeoPosition;
  getZoom(): number;
  addMarker(id: string, position: GeoPosition, options?: MarkerOptions): void;
  removeMarker(id: string): void;
  updateMarker(id: string, position: GeoPosition, options?: MarkerOptions): void;
  clearMarkers(): void;
  destroy(): void;
}

export interface MarkerOptions {
  label?: string;
  color?: string;
  icon?: string;
  onClick?: () => void;
}

export interface IMapController extends MapController {
  initialize(container: HTMLElement): Promise<void>;
  getViewMode(): ViewMode;
  setViewMode(mode: ViewMode): void;
}

export interface MapStrategy {
  initialize(container: HTMLElement): Promise<void>;
  setCenter(position: GeoPosition): void;
  setZoom(level: number): void;
  getCenter(): GeoPosition;
  getZoom(): number;
  addMarker(id: string, position: GeoPosition, options?: MarkerOptions): void;
  removeMarker(id: string): void;
  updateMarker(id: string, position: GeoPosition, options?: MarkerOptions): void;
  clearMarkers(): void;
  destroy(): void;
}
