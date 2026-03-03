/**
 * Video Stream Types
 * Support for HLS, WebRTC, MJPEG, and mock video feeds
 */

export interface VideoStream {
  url: string;
  format: 'hls' | 'webrtc' | 'mjpeg' | 'mock-flir';
  status: 'live' | 'offline' | 'connecting';
  resolution?: string;
  bitrate?: string;
  codec?: string;
}

export interface VideoStreamMetadata {
  source: string;
  ingestionTime: Date;
  verificationHash?: string;
  verified: boolean;
  trustScore: number;
}

