/**
 * VideoStream Types Tests
 * Validates the type definitions for video streaming functionality
 */

import { describe, it, expect } from 'vitest';
import { VideoStream, TacticalNode } from '../../types';

describe('VideoStream Types', () => {
  it('should create a valid VideoStream object', () => {
    const stream: VideoStream = {
      url: 'http://example.com/stream.m3u8',
      format: 'hls',
      status: 'live',
      resolution: '1920x1080',
      metadata: {
        fps: 30,
        bitrate: 5000,
        codec: 'h264',
      },
    };

    expect(stream.url).toBe('http://example.com/stream.m3u8');
    expect(stream.format).toBe('hls');
    expect(stream.status).toBe('live');
    expect(stream.resolution).toBe('1920x1080');
    expect(stream.metadata?.fps).toBe(30);
  });

  it('should support all video format types', () => {
    const formats: VideoStream['format'][] = ['hls', 'webrtc', 'mjpeg', 'mock-flir'];
    
    formats.forEach((format) => {
      const stream: VideoStream = {
        url: 'http://example.com/stream',
        format,
        status: 'live',
      };
      expect(stream.format).toBe(format);
    });
  });

  it('should support all status types', () => {
    const statuses: VideoStream['status'][] = ['live', 'offline', 'connecting'];
    
    statuses.forEach((status) => {
      const stream: VideoStream = {
        url: 'http://example.com/stream',
        format: 'hls',
        status,
      };
      expect(stream.status).toBe(status);
    });
  });

  it('should allow optional metadata fields', () => {
    const streamWithMetadata: VideoStream = {
      url: 'http://example.com/stream',
      format: 'hls',
      status: 'live',
      metadata: {
        fps: 60,
      },
    };

    const streamWithoutMetadata: VideoStream = {
      url: 'http://example.com/stream',
      format: 'mjpeg',
      status: 'live',
    };

    expect(streamWithMetadata.metadata).toBeDefined();
    expect(streamWithoutMetadata.metadata).toBeUndefined();
  });
});

describe('TacticalNode with VideoStream', () => {
  it('should support optional videoStream property', () => {
    const nodeWithVideo: TacticalNode = {
      id: 'node-001',
      domain: 'test-domain',
      position: { latitude: 40.7128, longitude: -74.0060 },
      trustScore: 0.95,
      verified: true,
      lastSeen: new Date(),
      status: 'online',
      videoStream: {
        url: 'http://flir.example.com/stream',
        format: 'mock-flir',
        status: 'live',
        resolution: '640x480',
      },
    };

    expect(nodeWithVideo.videoStream).toBeDefined();
    expect(nodeWithVideo.videoStream?.format).toBe('mock-flir');
  });

  it('should work without videoStream property', () => {
    const nodeWithoutVideo: TacticalNode = {
      id: 'node-002',
      domain: 'test-domain',
      position: { latitude: 40.7128, longitude: -74.0060 },
      trustScore: 0.95,
      verified: true,
      lastSeen: new Date(),
      status: 'online',
    };

    expect(nodeWithoutVideo.videoStream).toBeUndefined();
  });

  it('should support ISR-capable nodes with FLIR streams', () => {
    const isrNode: TacticalNode = {
      id: 'isr-001',
      domain: 'isr-domain',
      position: { latitude: 35.6762, longitude: 139.6503 },
      trustScore: 0.98,
      verified: true,
      lastSeen: new Date(),
      status: 'online',
      videoStream: {
        url: 'http://192.168.1.100:5000/stream',
        format: 'mock-flir',
        status: 'live',
        resolution: '640x480',
        metadata: {
          fps: 30,
          codec: 'h264',
        },
      },
    };

    expect(isrNode.videoStream?.format).toBe('mock-flir');
    expect(isrNode.videoStream?.status).toBe('live');
    expect(isrNode.videoStream?.metadata?.fps).toBe(30);
  });
});
