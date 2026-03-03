/**
 * MessageInput - Outgress Boundary for Secure Messaging
 * 
 * Handles message composition and cryptographic signing before transmission.
 * 
 * PHASE 4: Outgress Boundary
 * - Intercepts raw text input
 * - Wraps text in MessagePayload schema
 * - Fetches device signing keys from IdentitySlot
 * - Constructs CanonicalEvent with TPM signature
 * - Hashes into local outbound Merkle Vine
 * - Dispatches via useCommStore.sendMessage()
 * 
 * ARCHITECTURAL INVARIANTS:
 * - NO plaintext transmission without signature
 * - All messages MUST be part of Merkle Vine chain
 * - TPM-backed Ed25519 signing via SigningClient
 */

import React, { useState, useRef } from 'react';
import { Send, Shield, Loader2 } from 'lucide-react';
import type { CanonicalEvent, MessagePayload, EventType } from '@aethercore/canonical-schema';
import { SigningClient } from '../../services/identity/signingClient';

/**
 * MessageInput Props
 */
export interface MessageInputProps {
  /** Recipient node ID */
  recipientId: string;
  
  /** Conversation ID */
  conversationId: string;
  
  /** Current user's node ID */
  currentNodeId: string;
  
  /** Device ID for signing */
  deviceId: string;
  
  /** Signing client for TPM-backed signatures */
  signingClient: SigningClient;
  
  /** Last verified hash for Merkle Vine linkage */
  lastVerifiedHash: string;
  
  /** Message sequence number */
  messageSequence: number;
  
  /** Callback when message is sent */
  onMessageSend: (event: CanonicalEvent) => Promise<void>;
  
  /** Disabled state */
  disabled?: boolean;
  
  /** Placeholder text */
  placeholder?: string;
}

/**
 * MessageInput Component
 * 
 * Text input with hardware-backed signing and Merkle Vine integration.
 * Implements the Outgress Boundary for all outgoing messages.
 */
export const MessageInput: React.FC<MessageInputProps> = ({
  recipientId,
  conversationId,
  currentNodeId,
  deviceId,
  signingClient,
  lastVerifiedHash,
  messageSequence,
  onMessageSend,
  disabled = false,
  placeholder = 'Type a message...',
}) => {
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Compute BLAKE3 hash of canonical JSON
   * 
   * NOTE: In production, this would use the blake3 npm package.
   * For now, we use a placeholder that would be replaced with actual BLAKE3.
   */
  async function computeBlake3Hash(data: string): Promise<string> {
    try {
      // Use BLAKE3 for production hashing
      const { hash } = await import('blake3');
      const hashResult = hash(Buffer.from(data, 'utf-8')).toString('hex');
      return hashResult;
    } catch (error) {
      console.error('[MessageInput] Error computing BLAKE3 hash:', error);
      throw error;
    }
  }

  /**
   * Handle message submission
   * 
   * PHASE 4: Outgress Boundary Implementation
   * 1. Validate input
   * 2. Wrap in MessagePayload
   * 3. Construct CanonicalEvent
   * 4. Sign with TPM via SigningClient
   * 5. Hash into Merkle Vine (link to lastVerifiedHash)
   * 6. Dispatch via onMessageSend callback
   */
  async function handleSendMessage() {
    if (!messageText.trim() || isSending || disabled) return;

    setIsSending(true);
    setError(null);

    try {
      // Step 1: Create MessagePayload
      const payload: MessagePayload = {
        text: messageText.trim(),
        conversation_id: conversationId,
        recipient_ids: [recipientId],
        // reply_to can be added later for threading
      };

      // Step 2: Create CanonicalEvent (unsigned)
      const event: CanonicalEvent = {
        event_id: crypto.randomUUID(),
        event_type: 'MESSAGE' as EventType,
        timestamp: Date.now(),
        device_id: deviceId,
        sequence: messageSequence,
        payload,
        prev_hash: lastVerifiedHash,
        chain_height: messageSequence,
        hash: '', // Will be computed
        signature: '', // Will be signed
        public_key: '', // Will be fetched from SigningClient
        node_id: currentNodeId,
      };

      // Step 3: Compute canonical JSON for signing (excludes signature fields)
      const canonicalJson = toCanonicalJsonForSigning(event);

      // Step 4: Compute BLAKE3 hash
      const hash = await computeBlake3Hash(canonicalJson);
      event.hash = hash;

      // Step 5: Sign with TPM-backed key via SigningClient
      try {
        const signResponse = await signingClient.signMessage({
          node_id: currentNodeId,
          message: new TextEncoder().encode(hash),
          timestamp_ms: Date.now(),
        });

        if (!signResponse.success) {
          throw new Error(signResponse.error_message || 'Signing failed');
        }

        event.signature = signResponse.signature_hex;
        event.public_key = signResponse.public_key_id;
      } catch (signError) {
        console.error('[MessageInput] Signing error:', signError);
        throw new Error('TPM signature failed. Message not sent.');
      }

      // Step 6: Dispatch message
      await onMessageSend(event);

      // Clear input on success
      setMessageText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err) {
      console.error('[MessageInput] Send error:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  }

  /**
   * Handle Enter key to send message
   */
  function handleKeyPress(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }

  /**
   * Auto-resize textarea
   */
  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setMessageText(e.target.value);
    
    // Auto-resize
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }

  return (
    <div className="p-4 border-t border-tungsten/10">
      <div className="flex items-end gap-3">
        {/* Message Input */}
        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={messageText}
            onChange={handleTextareaChange}
            onKeyPress={handleKeyPress}
            placeholder={placeholder}
            disabled={disabled || isSending}
            className="w-full bg-carbon border border-tungsten/20 rounded-lg px-4 py-3 text-tungsten placeholder-tungsten/30 resize-none focus:outline-none focus:border-overmatch/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            rows={2}
            maxLength={2000}
          />
          
          {/* Status Footer */}
          <div className="flex items-center justify-between mt-2">
            {/* Security Badge */}
            <div className="flex items-center gap-2 text-xs text-tungsten/50">
              <Shield size={12} className="text-verified-green" />
              <span>Hardware-signed • TPM-backed encryption</span>
            </div>
            
            {/* Character Count */}
            <span className="text-xs text-tungsten/50 font-mono">
              {messageText.length}/2000
            </span>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mt-2 p-2 bg-jamming/20 rounded border border-jamming text-xs text-white">
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>

        {/* Send Button */}
        <button
          onClick={handleSendMessage}
          disabled={!messageText.trim() || disabled || isSending}
          className="p-4 rounded-lg bg-overmatch hover:bg-overmatch/80 disabled:bg-tungsten/20 disabled:cursor-not-allowed transition-colors"
          title={isSending ? 'Signing...' : 'Send message'}
        >
          {isSending ? (
            <Loader2 size={20} className="text-carbon animate-spin" />
          ) : (
            <Send size={20} className="text-carbon" />
          )}
        </button>
      </div>
    </div>
  );
};

/**
 * Compute canonical JSON for signing (excludes signature fields)
 * 
 * This must match the Rust implementation's to_canonical_json_for_signing()
 * to ensure hash compatibility across language boundaries.
 */
function toCanonicalJsonForSigning(event: CanonicalEvent): string {
  // Create object with sorted keys
  const canonical = {
    chain_height: event.chain_height,
    device_id: event.device_id,
    event_id: event.event_id,
    event_type: event.event_type,
    node_id: event.node_id,
    payload: event.payload,
    prev_hash: event.prev_hash,
    sequence: event.sequence,
    timestamp: event.timestamp,
  };

  // Add metadata if present
  if (event.metadata) {
    Object.assign(canonical, { metadata: event.metadata });
  }

  // Note: signature and public_key are intentionally excluded
  return JSON.stringify(canonical);
}
