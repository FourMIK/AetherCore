/**
 * AgnosticVideoPlayer
 * Format-agnostic video player component for ISR Console
 * Supports HLS, MJPEG, WebRTC, and Mock FLIR streams
 */

import React, { useRef, useEffect, useState } from 'react';
import { VideoStream } from '../../types';
import { Video, VideoOff, Wifi, WifiOff, Loader2 } from 'lucide-react';

interface AgnosticVideoPlayerProps {
  stream: VideoStream;
  className?: string;
  onError?: (error: Error) => void;
}

export const AgnosticVideoPlayer: React.FC<AgnosticVideoPlayerProps> = ({
  stream,
  className = '',
  onError,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Handle MJPEG stream
  const renderMJPEG = () => {
    return (
      <img
        ref={imgRef}
        src={stream.url}
        alt="MJPEG Stream"
        className={`w-full h-full object-contain ${className}`}
        onLoad={() => setIsLoading(false)}
        onError={(e) => {
          const err = new Error('Failed to load MJPEG stream');
          setError(err.message);
          setIsLoading(false);
          onError?.(err);
        }}
      />
    );
  };

  // Handle HLS stream
  const renderHLS = () => {
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      setIsLoading(true);

      // Check if HLS.js is needed (not natively supported)
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        video.src = stream.url;
        video.play().catch((err) => {
          setError('Failed to play HLS stream');
          setIsLoading(false);
          onError?.(err);
        });
      } else if (typeof window !== 'undefined' && 'Hls' in window) {
        // Use HLS.js for browsers without native support
        const Hls = (window as any).Hls;
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
          });
          
          hls.loadSource(stream.url);
          hls.attachMedia(video);
          
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch((err) => {
              setError('Failed to play HLS stream');
              setIsLoading(false);
              onError?.(err);
            });
          });

          hls.on(Hls.Events.ERROR, (event: any, data: any) => {
            if (data.fatal) {
              setError(`HLS Error: ${data.type}`);
              setIsLoading(false);
              onError?.(new Error(data.type));
            }
          });

          return () => {
            hls.destroy();
          };
        }
      } else {
        const err = new Error('HLS not supported in this browser');
        setError(err.message);
        setIsLoading(false);
        onError?.(err);
      }
    }, [stream.url]);

    return (
      <video
        ref={videoRef}
        className={`w-full h-full object-contain bg-carbon ${className}`}
        controls
        autoPlay
        muted
        playsInline
        onLoadedData={() => setIsLoading(false)}
        onError={(e) => {
          setError('Video playback error');
          setIsLoading(false);
        }}
      />
    );
  };

  // Handle WebRTC stream
  const renderWebRTC = () => {
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      setIsLoading(true);

      // WebRTC implementation would require signaling server
      // For now, show a placeholder
      const err = new Error('WebRTC support coming soon');
      setError(err.message);
      setIsLoading(false);
      onError?.(err);

      // Future implementation:
      // 1. Connect to signaling server
      // 2. Exchange SDP offers/answers
      // 3. Establish peer connection
      // 4. Attach media stream to video element

    }, [stream.url]);

    return (
      <video
        ref={videoRef}
        className={`w-full h-full object-contain bg-carbon ${className}`}
        controls
        autoPlay
        muted
        playsInline
      />
    );
  };

  // Handle Mock FLIR stream
  const renderMockFLIR = () => {
    return (
      <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br from-carbon via-carbon/90 to-slate-900 ${className}`}>
        <div className="text-center space-y-4">
          <div className="relative w-64 h-48 mx-auto border-2 border-overmatch/50 rounded-lg overflow-hidden">
            {/* Mock FLIR thermal visualization */}
            <div className="absolute inset-0 bg-gradient-to-br from-amber-600/20 via-red-600/30 to-orange-800/20 animate-pulse" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-32 h-32 bg-red-500/30 rounded-full blur-3xl animate-pulse" />
            </div>
            <div className="absolute inset-0 bg-[linear-gradient(0deg,transparent_49%,rgba(255,100,0,0.1)_50%,transparent_51%)] bg-[length:100%_4px]" />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_49%,rgba(255,100,0,0.1)_50%,transparent_51%)] bg-[length:4px_100%]" />
            
            {/* FLIR overlay UI */}
            <div className="absolute top-2 left-2 text-xs font-mono text-overmatch">
              <div>FLIR NEXUS</div>
              <div>THERMAL</div>
            </div>
            <div className="absolute top-2 right-2 text-xs font-mono text-overmatch">
              <div>25.3°C</div>
              <div>REC</div>
            </div>
            <div className="absolute bottom-2 left-2 text-xs font-mono text-overmatch">
              {stream.resolution || '640x480'}
            </div>
            <div className="absolute bottom-2 right-2 text-xs font-mono text-overmatch">
              {new Date().toLocaleTimeString()}
            </div>
            
            {/* Crosshair */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border border-overmatch/70 rounded-full" />
              <div className="absolute w-12 h-px bg-overmatch/70" />
              <div className="absolute w-px h-12 bg-overmatch/70" />
            </div>
          </div>
          
          <div className="text-tungsten/70 text-sm">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Video className="text-overmatch" size={16} />
              <span className="font-mono">Mock FLIR Thermal Feed</span>
            </div>
            <div className="text-xs text-tungsten/50">
              Simulated thermal imaging for demonstration
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render stream status overlay
  const renderStatusOverlay = () => {
    if (stream.status === 'connecting' || isLoading) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-carbon/80 backdrop-blur-sm z-10">
          <div className="text-center">
            <Loader2 className="mx-auto mb-2 text-overmatch animate-spin" size={32} />
            <div className="text-tungsten/70 text-sm font-mono">Connecting...</div>
          </div>
        </div>
      );
    }

    if (stream.status === 'offline' || error) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-carbon/80 backdrop-blur-sm z-10">
          <div className="text-center">
            <VideoOff className="mx-auto mb-2 text-red-500" size={32} />
            <div className="text-tungsten/70 text-sm font-mono">
              {error || 'Stream Offline'}
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  // Main render logic
  return (
    <div className={`relative w-full h-full ${className}`}>
      {stream.format === 'mjpeg' && renderMJPEG()}
      {stream.format === 'hls' && renderHLS()}
      {stream.format === 'webrtc' && renderWebRTC()}
      {stream.format === 'mock-flir' && renderMockFLIR()}
      
      {renderStatusOverlay()}

      {/* Stream info overlay (bottom-left) */}
      {stream.status === 'live' && !isLoading && !error && (
        <div className="absolute bottom-2 left-2 px-2 py-1 bg-carbon/80 backdrop-blur-sm rounded text-xs font-mono text-tungsten/70 flex items-center gap-1 z-20">
          <Wifi className="text-overmatch" size={12} />
          <span className="uppercase">{stream.format}</span>
          {stream.resolution && <span className="text-tungsten/50">• {stream.resolution}</span>}
          {stream.metadata?.fps && <span className="text-tungsten/50">• {stream.metadata.fps}fps</span>}
        </div>
      )}
    </div>
  );
};
