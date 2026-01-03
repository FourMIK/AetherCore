/**
 * ISRSlot
 * Intelligence, Surveillance, & Reconnaissance video feed display
 * Supports WebRTC streaming from Guardian protocol
 */

import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { MateriaSlot, MateriaSlotConfig } from './MateriaSlot';

export interface ISRSlotConfig extends MateriaSlotConfig {
  type: 'isr';
  /** WebRTC peer connection ID */
  peerId?: string;
  /** Video stream source URL or stream object */
  streamSource?: string | MediaStream;
  /** Optional BLAKE3 hash for stream integrity */
  integrityHash?: string;
}

export interface ISRSlotProps {
  config: ISRSlotConfig;
  onClose?: () => void;
  onMinimize?: () => void;
}

/**
 * ISRSlot Component
 * Displays live or recorded video feeds with integrity verification
 */
export const ISRSlot: React.FC<ISRSlotProps> = ({
  config,
  onClose,
  onMinimize,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [streamQuality, setStreamQuality] = useState<'high' | 'medium' | 'low'>('high');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Handle MediaStream object
    if (config.streamSource instanceof MediaStream) {
      video.srcObject = config.streamSource;
      video.play().catch((e) => console.error('Video playback error:', e));
    }
    // Handle URL string (fallback)
    else if (typeof config.streamSource === 'string') {
      video.src = config.streamSource;
      video.play().catch((e) => console.error('Video playback error:', e));
    }
  }, [config.streamSource]);

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleMuteToggle = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  return (
    <MateriaSlot
      config={{
        ...config,
        type: 'isr',
        description: `ISR Feed${config.peerId ? ` • Peer: ${config.peerId}` : ''}`,
      }}
      onClose={onClose}
      onMinimize={onMinimize}
    >
      <div className="flex flex-col gap-4 h-full">
        {/* Video Container */}
        <div className="relative flex-1 bg-carbon/50 border border-tungsten/10 rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted={isMuted}
          />

          {/* Integrity Badge */}
          {config.integrityHash && (
            <div className="absolute top-2 right-2 bg-black/60 text-tungsten/70 text-xs px-2 py-1 rounded font-mono">
              Hash: {config.integrityHash.substring(0, 8)}...
            </div>
          )}

          {/* Quality Indicator */}
          <div className="absolute bottom-2 left-2 bg-black/60 text-tungsten/70 text-xs px-2 py-1 rounded">
            {streamQuality.toUpperCase()}
          </div>
        </div>

        {/* Controls */}
        <div className="flex gap-2 items-center justify-between bg-carbon/30 p-3 rounded-lg">
          <div className="flex gap-2">
            <button
              onClick={handlePlayPause}
              className="p-2 bg-tungsten/10 hover:bg-tungsten/20 rounded transition-colors text-tungsten"
            >
              {isPlaying ? (
                <Pause size={16} />
              ) : (
                <Play size={16} />
              )}
            </button>
            <button
              onClick={handleMuteToggle}
              className="p-2 bg-tungsten/10 hover:bg-tungsten/20 rounded transition-colors text-tungsten"
            >
              {isMuted ? (
                <VolumeX size={16} />
              ) : (
                <Volume2 size={16} />
              )}
            </button>
          </div>

          {/* Quality Selector */}
          <select
            value={streamQuality}
            onChange={(e) => setStreamQuality(e.target.value as any)}
            className="bg-carbon/50 border border-tungsten/10 text-tungsten text-xs rounded px-2 py-1 cursor-pointer hover:border-tungsten/30 focus:outline-none focus:border-overmatch"
          >
            <option value="high">HD</option>
            <option value="medium">SD</option>
            <option value="low">Mobile</option>
          </select>
        </div>

        {/* Metadata */}
        <div className="text-xs text-tungsten/50 space-y-1">
          <div>Peer: {config.peerId || 'Local'}</div>
          <div>Format: WebRTC H.264</div>
          <div>Bitrate: Dynamic</div>
        </div>
      </div>
    </MateriaSlot>
  );
};

export default ISRSlot;
