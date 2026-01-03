/**
 * VideoCallPanel
 * Secure video conferencing component
 * WebRTC-based with TPM-secured signaling
 */

import React, { useEffect, useRef, useState } from 'react';
import { GlassPanel } from '../hud/GlassPanel';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  Maximize2,
  Minimize2,
  Shield
} from 'lucide-react';
import { useCommStore, type VideoCall } from '../../store/useCommStore';

interface VideoCallPanelProps {
  call: VideoCall;
}

export const VideoCallPanel: React.FC<VideoCallPanelProps> = ({ call }) => {
  const { operators, endCall } = useCommStore();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const remoteParticipant = operators.get(
    call.participants.find(p => p !== call.initiator) || ''
  );

  useEffect(() => {
    if (call.status === 'active' && call.startTime) {
      const interval = setInterval(() => {
        const duration = Math.floor((Date.now() - call.startTime!.getTime()) / 1000);
        setCallDuration(duration);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [call.status, call.startTime]);

  useEffect(() => {
    // Initialize local media stream
    const initMediaStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Failed to access media devices:', err);
      }
    };

    initMediaStream();

    return () => {
      // Cleanup streams
      if (localVideoRef.current?.srcObject) {
        const stream = localVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const toggleVideo = () => {
    if (localVideoRef.current?.srcObject) {
      const stream = localVideoRef.current.srcObject as MediaStream;
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const toggleAudio = () => {
    if (localVideoRef.current?.srcObject) {
      const stream = localVideoRef.current.srcObject as MediaStream;
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  };

  const handleEndCall = () => {
    if (localVideoRef.current?.srcObject) {
      const stream = localVideoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    endCall();
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`fixed inset-0 z-50 bg-carbon/95 backdrop-blur-sm ${isFullscreen ? '' : 'p-8'
      }`}>
      <GlassPanel variant="heavy" className={`${isFullscreen ? 'h-full' : 'h-full max-w-6xl mx-auto'
        } flex flex-col`}>
        {/* Header */}
        <div className="p-4 border-b border-tungsten/10 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Video className="text-overmatch" size={20} />
              <span className="font-display font-semibold text-tungsten">
                Secure Video Call
              </span>
            </div>
            {call.status === 'active' && (
              <>
                <div className="h-4 w-px bg-tungsten/20" />
                <span className="font-mono text-sm text-tungsten/70">
                  {formatDuration(callDuration)}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-verified-green flex items-center gap-1">
              <Shield size={12} />
              Encrypted
            </span>
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 rounded-lg bg-tungsten/10 hover:bg-tungsten/20 text-tungsten transition-colors"
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </div>

        {/* Video Area */}
        <div className="flex-1 min-h-0 p-4 relative">
          {call.status === 'ringing' ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-24 h-24 rounded-full bg-overmatch/20 flex items-center justify-center mx-auto mb-4 animate-pulse">
                  <Video size={48} className="text-overmatch" />
                </div>
                <p className="text-xl font-display text-tungsten mb-2">
                  Calling {remoteParticipant?.name}...
                </p>
                <p className="text-sm text-tungsten/50">
                  Establishing secure connection
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Remote Video - Main */}
              <div className="w-full h-full bg-carbon rounded-lg overflow-hidden border border-tungsten/20">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                {!remoteVideoRef.current?.srcObject && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-24 h-24 rounded-full bg-tungsten/20 flex items-center justify-center mx-auto mb-3">
                        <span className="text-3xl font-display text-tungsten">
                          {remoteParticipant?.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <p className="text-tungsten/70">{remoteParticipant?.name}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Local Video - Picture in Picture */}
              <div className="absolute bottom-4 right-4 w-64 h-48 bg-carbon rounded-lg overflow-hidden border-2 border-tungsten/30 shadow-lg">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover mirror"
                />
                {!isVideoEnabled && (
                  <div className="absolute inset-0 bg-carbon flex items-center justify-center">
                    <VideoOff size={32} className="text-tungsten/50" />
                  </div>
                )}
                <div className="absolute top-2 left-2 text-xs text-tungsten/70 font-mono">
                  You
                </div>
              </div>
            </>
          )}
        </div>

        {/* Controls */}
        <div className="p-4 border-t border-tungsten/10 flex justify-center gap-3 flex-shrink-0">
          <button
            onClick={toggleVideo}
            className={`p-4 rounded-full transition-colors ${isVideoEnabled
                ? 'bg-tungsten/10 hover:bg-tungsten/20 text-tungsten'
                : 'bg-jamming/20 hover:bg-jamming/30 text-jamming'
              }`}
            title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            {isVideoEnabled ? <Video size={24} /> : <VideoOff size={24} />}
          </button>

          <button
            onClick={toggleAudio}
            className={`p-4 rounded-full transition-colors ${isAudioEnabled
                ? 'bg-tungsten/10 hover:bg-tungsten/20 text-tungsten'
                : 'bg-jamming/20 hover:bg-jamming/30 text-jamming'
              }`}
            title={isAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
          >
            {isAudioEnabled ? <Mic size={24} /> : <MicOff size={24} />}
          </button>

          <button
            onClick={handleEndCall}
            className="p-4 rounded-full bg-jamming/20 hover:bg-jamming/30 text-jamming transition-colors"
            title="End call"
          >
            <PhoneOff size={24} />
          </button>
        </div>
      </GlassPanel>

      <style>{`
        .mirror {
          transform: scaleX(-1);
        }
      `}</style>
    </div>
  );
};
