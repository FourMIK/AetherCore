/**
 * LeafletStrategy
 * 2D Minimal fallback mapping using Leaflet
 */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapStrategy, GeoPosition, MarkerOptions } from '../types';

export class LeafletStrategy implements MapStrategy {
  private map: L.Map | null = null;
  private markers: Map<string, L.Marker> = new Map();
  private center: GeoPosition = { latitude: 0, longitude: 0 };
  private zoom: number = 10;

  async initialize(container: HTMLElement): Promise<void> {
    this.map = L.map(container, {
      center: [this.center.latitude, this.center.longitude],
      zoom: this.zoom,
      zoomControl: true,
    });

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);
  }

  setCenter(position: GeoPosition): void {
    this.center = position;
    if (this.map) {
      this.map.setView([position.latitude, position.longitude], this.zoom);
    }
  }

  setZoom(level: number): void {
    this.zoom = level;
    if (this.map) {
      this.map.setZoom(level);
    }
  }

  getCenter(): GeoPosition {
    if (this.map) {
      const center = this.map.getCenter();
      return { latitude: center.lat, longitude: center.lng };
    }
    return this.center;
  }

  getZoom(): number {
    if (this.map) {
      return this.map.getZoom();
    }
    return this.zoom;
  }

  addMarker(id: string, position: GeoPosition, options?: MarkerOptions): void {
    if (!this.map) return;

    const marker = L.marker([position.latitude, position.longitude], {
      title: options?.label,
    });

    if (options?.onClick) {
      marker.on('click', options.onClick);
    }

    marker.addTo(this.map);
    this.markers.set(id, marker);
  }

  removeMarker(id: string): void {
    const marker = this.markers.get(id);
    if (marker && this.map) {
      this.map.removeLayer(marker);
      this.markers.delete(id);
    }
  }

  updateMarker(id: string, position: GeoPosition, options?: MarkerOptions): void {
    const marker = this.markers.get(id);
    if (marker) {
      marker.setLatLng([position.latitude, position.longitude]);
      if (options?.label) {
        marker.setTooltipContent(options.label);
      }
    }
  }

  clearMarkers(): void {
    this.markers.forEach((marker) => {
      if (this.map) {
        this.map.removeLayer(marker);
      }
    });
    this.markers.clear();
  }

  destroy(): void {
    this.clearMarkers();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
