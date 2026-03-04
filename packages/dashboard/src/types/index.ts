/**
 * Type Exports
 * Central export for all TypeScript types
 */

export * from '../map-engine/types';
export * from '../store/useTacticalStore';
export * from '../components/command/CommandStatusBadge';

/**
 * Platform Types for Unified Materia Doctrine
 */
export type PlatformType = 'satellite' | 'gateway';

/**
 * Video Stream Types for ISR Console
 */
export interface VideoStream {
  url: string;
  format: 'hls' | 'webrtc' | 'mjpeg' | 'mock-flir';
  status: 'live' | 'offline' | 'connecting';
  resolution?: string;
  metadata?: {
    fps?: number;
    bitrate?: number;
    codec?: string;
  };
}
