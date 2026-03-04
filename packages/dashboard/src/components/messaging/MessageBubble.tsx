/**
 * MessageBubble - Cryptographically-Verified Message Display
 * 
 * Displays a single message with Merkle Vine verification status.
 * 
 * FAIL-VISIBLE DESIGN:
 * - VERIFIED: Green "Verified" shield, normal display
 * - UNVERIFIED/SPOOFED: Red hatched background, "UNVERIFIED: Potential MitM" warning
 * - Broken Merkle chain = disabled interaction
 * 
 * PHASE 4: Ingress Boundary
 * - Receives CanonicalEvent of type MESSAGE
 * - Validates Merkle ancestry via prev_hash
 * - Verifies TPM signature via identityClient
 * - Renders with appropriate verification badge
 */

import React from 'react';
import { Shield, ShieldAlert, ShieldOff, AlertTriangle } from 'lucide-react';
import type { VerificationStatus } from '@aethercore/shared';
import { MerkleChainIndicator } from './MerkleChainIndicator';

/**
 * Canonical Event type for messages
 */
export interface CanonicalEvent {
  id?: string;
  event_id?: string;
  timestamp: number;
  event_type: string;
  sender_id?: string;
  device_id?: string;
  node_id?: string;
  payload: any;
  prev_hash?: string;
  signature?: string;
  chain_height?: number;
  sequence?: number;
  hash?: string;
  public_key?: string;
  metadata?: any;
}

/**
 * Message Payload type
 */
export interface MessagePayload {
  text: string;
  conversation_id: string;
  recipient_ids: string[];
}

/**
 * MessageBubble Props
 */
export interface MessageBubbleProps {
  /** The canonical event containing the message */
  event: CanonicalEvent;
  
  /** Whether this message is from the current user */
  isOwn: boolean;
  
  /** Verification status from Trust Fabric */
  verificationStatus: VerificationStatus;
  
  /** Whether the Merkle chain is valid */
  chainValid: boolean;
  
  /** Failure reason if verification failed */
  failureReason?: string;
  
  /** Callback when message is clicked (disabled for unverified) */
  onClick?: () => void;
}

/**
 * Type guard to ensure payload is MessagePayload
 */
function isMessagePayload(payload: any): payload is MessagePayload {
  return (
    payload &&
    typeof payload.text === 'string' &&
    typeof payload.conversation_id === 'string' &&
    Array.isArray(payload.recipient_ids)
  );
}

/**
 * MessageBubble Component
 * 
 * Renders a single message with cryptographic verification status.
 * Implements Fail-Visible design for untrusted messages.
 */
export const MessageBubble: React.FC<MessageBubbleProps> = ({
  event,
  isOwn,
  verificationStatus,
  chainValid,
  failureReason,
  onClick,
}) => {
  // Validate payload is MessagePayload
  if (!isMessagePayload(event.payload)) {
    console.error('[MessageBubble] Invalid payload type:', event.payload);
    return null;
  }

  const message = event.payload;
  const isVerified = verificationStatus === 'VERIFIED' && chainValid;
  const isSpoofed = verificationStatus === 'SPOOFED' || !chainValid;

  // Format timestamp
  const timestamp = new Date(event.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  /**
   * Get bubble style based on verification status
   */
  const getBubbleStyle = () => {
    if (isSpoofed) {
      // FAIL-VISIBLE: Red hatched background for spoofed messages
      return {
        base: 'bg-jamming/20 border-2 border-jamming',
        pattern: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(220, 38, 38, 0.1) 10px, rgba(220, 38, 38, 0.1) 20px)',
      };
    }

    if (!isVerified) {
      // STATUS_UNVERIFIED: Yellow/tungsten warning
      return {
        base: 'bg-tungsten/10 border border-tungsten/30',
        pattern: null,
      };
    }

    // VERIFIED: Normal display
    if (isOwn) {
      return {
        base: 'bg-overmatch/20 border border-overmatch/30',
        pattern: null,
      };
    }

    return {
      base: 'bg-tungsten/10 border border-tungsten/20',
      pattern: null,
    };
  };

  const bubbleStyle = getBubbleStyle();

  return (
    <div
      className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
      onClick={!isSpoofed ? onClick : undefined}
    >
      <div
        className={`max-w-[70%] rounded-lg p-3 ${bubbleStyle.base} ${
          isSpoofed ? 'opacity-90' : ''
        }`}
        style={
          bubbleStyle.pattern
            ? { backgroundImage: bubbleStyle.pattern }
            : undefined
        }
      >
        {/* Header: Timestamp + Verification Badge */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className="text-xs text-tungsten/50 font-mono">{timestamp}</span>
          <MerkleChainIndicator
            verificationStatus={verificationStatus}
            chainValid={chainValid}
            failureReason={failureReason}
            chainHeight={event.chain_height}
            showDetails={true}
            size="sm"
          />
        </div>

        {/* FAIL-VISIBLE: Unverified/Spoofed Warning */}
        {isSpoofed && (
          <div className="mb-3 p-2 bg-jamming/30 rounded border border-jamming flex items-start gap-2">
            <ShieldOff size={16} className="text-white flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-xs font-bold text-white uppercase tracking-wider mb-1">
                UNVERIFIED: Potential MitM
              </div>
              <div className="text-[10px] text-white/80 leading-relaxed">
                {failureReason || 'Invalid signature or broken Merkle chain. This message cannot be trusted.'}
              </div>
            </div>
          </div>
        )}

        {!isVerified && !isSpoofed && (
          <div className="mb-3 p-2 bg-tungsten/20 rounded border border-tungsten/40 flex items-start gap-2">
            <ShieldAlert size={16} className="text-tungsten flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-xs font-bold text-tungsten uppercase tracking-wider mb-1">
                STATUS_UNVERIFIED
              </div>
              <div className="text-[10px] text-tungsten/70 leading-relaxed">
                Missing signature or unable to verify. Enrollment may be pending.
              </div>
            </div>
          </div>
        )}

        {/* Message Content */}
        <p
          className={`text-tungsten break-words ${
            isSpoofed ? 'line-through opacity-70' : ''
          }`}
        >
          {message.text}
        </p>

        {/* Metadata Footer */}
        <div className="flex items-center gap-3 mt-2 text-[10px] text-tungsten/50">
          {/* Chain Height */}
          <span className="font-mono">
            Chain #{event.chain_height}
          </span>

          {/* Event ID (short) */}
          <span className="font-mono">
            {event.event_id?.substring(0, 8) || '???'}
          </span>

          {/* Verified Badge for clean messages */}
          {isVerified && (
            <div className="flex items-center gap-1 text-verified-green">
              <Shield size={10} />
              <span className="font-semibold">Verified</span>
            </div>
          )}
        </div>

        {/* Interaction Disabled Notice */}
        {isSpoofed && (
          <div className="mt-2 pt-2 border-t border-jamming/30 text-[10px] text-white/60 italic">
            Message interaction disabled due to verification failure
          </div>
        )}
      </div>
    </div>
  );
};
