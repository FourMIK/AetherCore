/**
 * Mock Video Stream Examples
 * Demonstrates how to add video streams to tactical nodes
 */

import { TacticalNode, VideoStream } from '../types';

/**
 * Create a mock FLIR thermal imaging stream
 */
export const createMockFLIRStream = (): VideoStream => ({
  url: '#',  // Mock streams don't need a real URL
  format: 'mock-flir',
  status: 'live',
  resolution: '640x480',
  metadata: {
    fps: 30,
    codec: 'h264',
  },
});

/**
 * Create a mock HLS stream
 */
export const createMockHLSStream = (url: string): VideoStream => ({
  url,
  format: 'hls',
  status: 'live',
  resolution: '1920x1080',
  metadata: {
    fps: 30,
    bitrate: 5000,
    codec: 'h264',
  },
});

/**
 * Create a mock MJPEG stream
 */
export const createMockMJPEGStream = (url: string): VideoStream => ({
  url,
  format: 'mjpeg',
  status: 'live',
  resolution: '640x480',
  metadata: {
    fps: 15,
  },
});

/**
 * Create an ISR-capable node with FLIR thermal imaging
 */
export const createFLIRNode = (
  id: string,
  position: { latitude: number; longitude: number }
): TacticalNode => ({
  id,
  domain: 'isr-domain',
  position,
  trustScore: 0.98,
  verified: true,
  lastSeen: new Date(),
  status: 'online',
  firmwareVersion: '1.2.3',
  videoStream: createMockFLIRStream(),
});

/**
 * Create a surveillance node with HLS stream
 */
export const createSurveillanceNode = (
  id: string,
  position: { latitude: number; longitude: number },
  streamUrl: string
): TacticalNode => ({
  id,
  domain: 'surveillance-domain',
  position,
  trustScore: 0.95,
  verified: true,
  lastSeen: new Date(),
  status: 'online',
  videoStream: createMockHLSStream(streamUrl),
});

/**
 * Example usage: Create a fleet of ISR-capable nodes
 */
export const createISRFleet = (): TacticalNode[] => [
  // FLIR-equipped drone
  createFLIRNode('flir-drone-001', {
    latitude: 40.7128,
    longitude: -74.0060,
  }),
  
  // Ground surveillance unit
  createSurveillanceNode(
    'surveillance-001',
    { latitude: 40.7589, longitude: -73.9851 },
    'http://example.com/stream1.m3u8'
  ),
  
  // Another FLIR unit
  createFLIRNode('flir-rover-001', {
    latitude: 40.7480,
    longitude: -73.9687,
  }),
];

/**
 * Example: Add video stream to existing node
 */
export const addVideoStreamToNode = (
  node: TacticalNode,
  stream: VideoStream
): TacticalNode => ({
  ...node,
  videoStream: stream,
});

/**
 * Example: Update video stream status
 */
export const updateStreamStatus = (
  stream: VideoStream,
  status: VideoStream['status']
): VideoStream => ({
  ...stream,
  status,
});

/**
 * Example: Create a node with offline video stream
 */
export const createOfflineVideoNode = (
  id: string,
  position: { latitude: number; longitude: number }
): TacticalNode => ({
  id,
  domain: 'test-domain',
  position,
  trustScore: 0.85,
  verified: true,
  lastSeen: new Date(),
  status: 'degraded',
  videoStream: {
    url: 'http://example.com/stream',
    format: 'hls',
    status: 'offline',
    resolution: '1920x1080',
  },
});

/**
 * Example: Node without video (standard tactical node)
 */
export const createStandardNode = (
  id: string,
  position: { latitude: number; longitude: number }
): TacticalNode => ({
  id,
  domain: 'standard-domain',
  position,
  trustScore: 0.92,
  verified: true,
  lastSeen: new Date(),
  status: 'online',
  // No videoStream property - this node has no ISR capability
});
