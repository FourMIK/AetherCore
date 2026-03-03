/**
 * AgnosticVideoPlayer Component
 * Handles multiple video stream formats with Trust Mesh verification overlay
 */

import React, { useEffect, useRef, useState } from 'react';
import { VideoStream } from '../../types/VideoStream';

interface AgnosticVideoPlayerProps {
  stream: VideoStream;
  title?: string;
  showOverlay?: boolean;
}

/**
 * SVG Crosshair component for tactical overlay
 */
const TacticalCrosshair: React.FC = () => (
  <svg
    className="absolute inset-0 w-full h-full pointer-events-none"
    viewBox="0 0 1080 720"
  >
    {/* Center circle */}
    <circle cx="540" cy="360" r="30" fill="none" stroke="#22c55e" strokeWidth="2" />

    {/* Horizontal line */}
    <line x1="400" y1="360" x2="680" y2="360" stroke="#22c55e" strokeWidth="1" opacity="0.6" />

    {/* Vertical line */}
    <line x1="540" y1="200" x2="540" y2="520" stroke="#22c55e" strokeWidth="1" opacity="0.6" />

    {/* Corner markers */}
    <line x1="380" y1="340" x2="380" y2="380" stroke="#22c55e" strokeWidth="2" opacity="0.8" />
    <line x1="360" y1="360" x2="400" y2="360" stroke="#22c55e" strokeWidth="2" opacity="0.8" />

    <line x1="700" y1="340" x2="700" y2="380" stroke="#22c55e" strokeWidth="2" opacity="0.8" />
    <line x1="680" y1="360" x2="720" y2="360" stroke="#22c55e" strokeWidth="2" opacity="0.8" />

    <line x1="540" y1="220" x2="560" y2="220" stroke="#22c55e" strokeWidth="2" opacity="0.8" />
    <line x1="540" y1="200" x2="540" y2="240" stroke="#22c55e" strokeWidth="2" opacity="0.8" />

    <line x1="540" y1="500" x2="560" y2="500" stroke="#22c55e" strokeWidth="2" opacity="0.8" />
    <line x1="540" y1="480" x2="540" y2="520" stroke="#22c55e" strokeWidth="2" opacity="0.8" />
  </svg>
);

/**
 * Mock FLIR scanline effect generator
 */
const MockFLIROverlay: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = () => {
      // Fill with dark background
      ctx.fillStyle = '#0f0f0f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Add random scanlines for thermal camera effect
      for (let y = 0; y < canvas.height; y += 2) {
        ctx.fillStyle = `rgba(50, 200, 100, ${Math.random() * 0.1})`;
        ctx.fillRect(0, y, canvas.width, 1);
      }

      // Add some noise
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 30;
        data[i] += noise;
        data[i + 1] += noise;
        data[i + 2] += noise;
      }
      ctx.putImageData(imageData, 0, 0);

      requestAnimationFrame(animate);
    };

    animate();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={1080}
      height={720}
      className="absolute inset-0 w-full h-full"
    />
  );
};

/**
 * Trust Mesh Verification Badge
 */
const VerificationBadge: React.FC<{ verified: boolean; trustScore?: number }> = ({
  verified,
  trustScore = 95,
}) => (
  <div className="absolute bottom-4 right-4 z-30 font-mono text-xs">
    {verified ? (
      <div className="bg-emerald-950/80 border border-emerald-500 px-3 py-2 rounded">
        <div className="text-emerald-400 font-bold flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          AETHERCORE TRUST MESH VERIFIED [SECURE]
        </div>
        <div className="text-emerald-400/70 text-xs mt-1">Trust Score: {trustScore}%</div>
      </div>
    ) : (
      <div className="bg-red-950/80 border border-red-500 px-3 py-2 rounded">
        <div className="text-red-400 font-bold flex items-center gap-2">
          <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
          VERIFICATION FAILED
        </div>
      </div>
    )}
  </div>
);

/**
 * Live Indicator with blinking animation
 */
const LiveIndicator: React.FC = () => (
  <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
    <span className="text-red-500 font-mono font-bold text-sm">LIVE</span>
  </div>
);

/**
 * Main Video Player Component
 */
export const AgnosticVideoPlayer: React.FC<AgnosticVideoPlayerProps> = ({
  stream,
  title = 'Video Feed',
  showOverlay = true,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(stream.status === 'connecting');

  useEffect(() => {
    setIsLoading(stream.status === 'connecting');
  }, [stream.status]);

  // Render Mock FLIR feed
  if (stream.format === 'mock-flir') {
    return (
      <div className="relative w-full h-full bg-gray-950 overflow-hidden rounded-lg border border-tungsten/20">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-b from-gray-900 via-gray-950 to-black" />

        {/* Scanline effect */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(50,200,100,0.03) 0px, rgba(50,200,100,0.03) 1px, transparent 1px, transparent 2px)',
            zIndex: 10,
          }}
        />

        {/* Content */}
        <div className="relative w-full h-full flex flex-col items-center justify-center">
          {/* FLIR Canvas Overlay */}
          <MockFLIROverlay />

          {/* Tactical Crosshair */}
          <TacticalCrosshair />

          {/* Title */}
          <div className="absolute top-4 left-4 z-20">
            <h3 className="text-emerald-400 font-mono font-bold text-sm">{title}</h3>
            <p className="text-emerald-400/70 text-xs">Teledyne Ranger HD - Thermal</p>
          </div>

          {/* Live Indicator */}
          <LiveIndicator />

          {/* Verification Badge */}
          <VerificationBadge verified={true} trustScore={95} />

          {/* Resolution/Codec Info */}
          <div className="absolute bottom-4 left-4 z-20 font-mono text-xs text-emerald-400/70">
            <div>{stream.resolution || '1080p'} • {stream.codec || 'H.264'}</div>
            <div>AETHERCORE INGEST</div>
          </div>
        </div>
      </div>
    );
  }

  // Render MJPEG feed
  if (stream.format === 'mjpeg') {
    return (
      <div className="relative w-full h-full bg-black rounded-lg overflow-hidden border border-tungsten/20">
        <img
          src={stream.url}
          alt={title}
          className="w-full h-full object-cover"
          onLoadStart={() => setIsLoading(true)}
          onLoadedData={() => setIsLoading(false)}
          onError={() => setIsLoading(false)}
        />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="animate-spin">
              <div className="w-8 h-8 border-2 border-tungsten/30 border-t-tungsten rounded-full" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Render HLS or WebRTC feed
  return (
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden border border-tungsten/20">
      <video
        ref={videoRef}
        src={stream.format === 'hls' ? stream.url : undefined}
        className="w-full h-full object-cover"
        autoPlay
        muted
        playsInline
        onLoadStart={() => setIsLoading(true)}
        onCanPlay={() => setIsLoading(false)}
        onError={() => setIsLoading(false)}
      />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="animate-spin">
            <div className="w-8 h-8 border-2 border-tungsten/30 border-t-tungsten rounded-full" />
          </div>
        </div>
      )}
      <LiveIndicator />
    </div>
  );
};

export default AgnosticVideoPlayer;

