/**
 * MessagingPanel - Cryptographically-Verified Tactical Messaging
 * 
 * FAIL-VISIBLE DESIGN:
 * - Every message displays verification status (VERIFIED/STATUS_UNVERIFIED/SPOOFED)
 * - Only operators with active hardware attestation are shown
 * - Byzantine nodes (revoked by Great Gospel) are filtered out
 * - PlatformType badge shows operator platform (Operator/Commander/USV/UAS)
 * 
 * This is NOT a standard chat UI. All communications are cryptographically
 * bound to hardware identity via TPM 2.0 / Secure Enclave.
 */

import React, { useState, useEffect, useRef } from 'react';
import { GlassPanel } from '../hud/GlassPanel';
import {
  MessageSquare,
  Shield,
  ShieldAlert,
  ShieldOff,
  Send,
  User,
  Check,
  CheckCheck,
  AlertTriangle,
} from 'lucide-react';
import { useCommStore, type Operator, type Message } from '../../store/useCommStore';
import { useMeshStore } from '../../store/useMeshStore';
import { MerkleChainIndicator } from './MerkleChainIndicator';
import type { VerificationStatus } from '@aethercore/shared';

/**
 * MessagingPanel Component
 * 
 * Two-pane layout:
 * - Left: Conversation list with verified operators
 * - Right: Active conversation with messages + Merkle chain indicators
 */
export const MessagingPanel: React.FC = () => {
  const {
    currentOperator,
    operators,
    conversations,
    sendMessage,
    getConversation,
  } = useCommStore();

  const { linkMetrics } = useMeshStore();

  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedOperator = selectedOperatorId
    ? operators.get(selectedOperatorId)
    : null;

  const activeConversation = selectedOperatorId
    ? getConversation(selectedOperatorId)
    : [];

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation]);

  /**
   * Filter operators by hardware attestation status
   * 
   * Fail-Visible Design: Only show operators with:
   * - Active hardware attestation (verified = true)
   * - Trust score >= 0.7 (70%)
   * - Not revoked by Great Gospel
   */
  const verifiedOperators = Array.from(operators.values()).filter(
    (op) =>
      op.verified &&
      op.trustScore >= 70 &&
      op.status !== 'offline' &&
      op.id !== currentOperator?.id // Exclude self
  );

  /**
   * Send message with hardware signature
   */
  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedOperatorId) return;

    try {
      setSendError(null);
      await sendMessage(selectedOperatorId, messageInput);
      setMessageInput('');
    } catch (error) {
      console.error('[MessagingPanel] Failed to send message:', error);
      setSendError(error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * Handle Enter key to send message
   */
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  /**
   * Get verification icon based on message status
   */
  const getVerificationIcon = (message: Message) => {
    if (!message.verified) {
      return <ShieldOff size={14} className="text-jamming" />;
    }

    if (message.signature) {
      return <Shield size={14} className="text-verified-green" />;
    }

    return <ShieldAlert size={14} className="text-tungsten/50" />;
  };

  /**
   * Get operator status indicator
   */
  const getStatusBadge = (operator: Operator) => {
    const linkMetric = linkMetrics.get(operator.id);
    
    let statusColor = 'bg-tungsten/20 text-tungsten/70';
    let statusText = operator.status;

    if (operator.status === 'online') {
      statusColor = 'bg-verified-green/20 text-verified-green';
    } else if (operator.status === 'busy') {
      statusColor = 'bg-jamming/20 text-jamming';
    }

    // Add link quality indicator if available
    if (linkMetric) {
      const quality = linkMetric.linkQuality;
      if (quality === 'excellent' || quality === 'good') {
        statusColor = 'bg-verified-green/20 text-verified-green';
      } else if (quality === 'fair') {
        statusColor = 'bg-tungsten/20 text-tungsten';
      } else {
        statusColor = 'bg-jamming/20 text-jamming';
        statusText = 'offline';
      }
    }

    return (
      <span
        className={`px-2 py-0.5 rounded text-xs font-mono ${statusColor}`}
      >
        {statusText}
      </span>
    );
  };

  /**
   * Get trust score badge
   */
  const getTrustBadge = (operator: Operator) => {
    const score = operator.trustScore;
    let colorClass = 'text-tungsten/70';
    let bgClass = 'bg-tungsten/10';

    if (score >= 90) {
      colorClass = 'text-verified-green';
      bgClass = 'bg-verified-green/20';
    } else if (score >= 70) {
      colorClass = 'text-overmatch';
      bgClass = 'bg-overmatch/20';
    } else if (score < 50) {
      colorClass = 'text-jamming';
      bgClass = 'bg-jamming/20';
    }

    return (
      <div className={`flex items-center gap-1 px-2 py-0.5 rounded ${bgClass}`}>
        <Shield size={12} className={colorClass} />
        <span className={`text-xs font-mono ${colorClass}`}>{score}%</span>
      </div>
    );
  };

  if (!currentOperator) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <ShieldOff size={48} className="mx-auto mb-4 text-jamming" />
          <p className="text-tungsten/70">
            No operator identity available. Hardware attestation required.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4 p-4">
      {/* Left Panel: Conversation List */}
      <div className="w-80 flex-shrink-0">
        <GlassPanel variant="default" className="h-full flex flex-col">
          <div className="p-4 border-b border-tungsten/10">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="text-overmatch" size={20} />
              <h2 className="font-display font-semibold text-tungsten">
                Secure Comms
              </h2>
            </div>
            <p className="text-xs text-tungsten/50">
              {verifiedOperators.length} verified operator
              {verifiedOperators.length !== 1 ? 's' : ''} available
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {verifiedOperators.length === 0 ? (
              <div className="p-4 text-center">
                <ShieldAlert size={32} className="mx-auto mb-2 text-tungsten/30" />
                <p className="text-sm text-tungsten/50">
                  No verified operators in range
                </p>
                <p className="text-xs text-tungsten/30 mt-1">
                  Awaiting hardware attestation
                </p>
              </div>
            ) : (
              verifiedOperators.map((operator) => {
                const conversation = conversations.get(operator.id) || [];
                const lastMessage = conversation[conversation.length - 1];
                const unreadCount = 0; // TODO: Implement unread tracking

                return (
                  <button
                    key={operator.id}
                    onClick={() => setSelectedOperatorId(operator.id)}
                    className={`w-full p-3 border-b border-tungsten/10 hover:bg-tungsten/5 transition-colors text-left ${
                      selectedOperatorId === operator.id ? 'bg-tungsten/10' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-overmatch/20 flex items-center justify-center">
                          <User size={16} className="text-overmatch" />
                        </div>
                        <div>
                          <div className="font-display text-sm text-tungsten">
                            {operator.name}
                          </div>
                          {operator.callsign && (
                            <div className="text-xs text-tungsten/50 font-mono">
                              {operator.callsign}
                            </div>
                          )}
                        </div>
                      </div>
                      {getTrustBadge(operator)}
                    </div>

                    <div className="flex items-center justify-between">
                      {getStatusBadge(operator)}
                      {unreadCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-overmatch text-carbon text-xs font-bold">
                          {unreadCount}
                        </span>
                      )}
                    </div>

                    {lastMessage && (
                      <div className="mt-2 text-xs text-tungsten/50 truncate flex items-center gap-1">
                        {getVerificationIcon(lastMessage)}
                        <span>{lastMessage.content}</span>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </GlassPanel>
      </div>

      {/* Right Panel: Active Conversation */}
      <div className="flex-1 min-w-0">
        {selectedOperator ? (
          <GlassPanel variant="default" className="h-full flex flex-col">
            {/* Conversation Header */}
            <div className="p-4 border-b border-tungsten/10">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-overmatch/20 flex items-center justify-center">
                      <User size={20} className="text-overmatch" />
                    </div>
                    <div>
                      <h3 className="font-display font-semibold text-tungsten">
                        {selectedOperator.name}
                      </h3>
                      {selectedOperator.callsign && (
                        <p className="text-sm text-tungsten/50 font-mono">
                          {selectedOperator.callsign}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getTrustBadge(selectedOperator)}
                  {getStatusBadge(selectedOperator)}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {activeConversation.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <MessageSquare size={48} className="mx-auto mb-3 text-tungsten/30" />
                    <p className="text-tungsten/50">No messages yet</p>
                    <p className="text-xs text-tungsten/30 mt-1">
                      All messages are cryptographically signed
                    </p>
                  </div>
                </div>
              ) : (
                activeConversation.map((message, idx) => {
                  const isOwn = message.from === currentOperator.id;
                  const verificationStatus: VerificationStatus = message.verified
                    ? 'VERIFIED'
                    : 'STATUS_UNVERIFIED';

                  return (
                    <div
                      key={message.id}
                      className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-lg p-3 ${
                          isOwn
                            ? 'bg-overmatch/20 border border-overmatch/30'
                            : 'bg-tungsten/10 border border-tungsten/20'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-1">
                          <span className="text-xs text-tungsten/50 font-mono">
                            {new Date(message.timestamp).toLocaleTimeString()}
                          </span>
                          <MerkleChainIndicator
                            verificationStatus={verificationStatus}
                            chainValid={message.verified}
                            showDetails={false}
                          />
                        </div>
                        <p className="text-tungsten break-words">{message.content}</p>
                        {message.encrypted && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-verified-green">
                            <Shield size={12} />
                            <span>End-to-end encrypted</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-4 border-t border-tungsten/10">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  {sendError && (
                    <div className="mb-3 p-3 rounded bg-jamming/10 border border-jamming/30 text-jamming text-xs">
                      <div className="font-semibold flex items-center gap-2">
                        <AlertTriangle size={14} />
                        Send failed (Fail-Visible)
                      </div>
                      <div className="text-jamming/80 mt-1 break-words">{sendError}</div>
                    </div>
                  )}
                  <textarea
                    value={messageInput}
                    onChange={(e) => {
                      setMessageInput(e.target.value);
                      if (sendError) {
                        setSendError(null);
                      }
                    }}
                    onKeyPress={handleKeyPress}
                    placeholder="Type a message..."
                    className="w-full bg-carbon border border-tungsten/20 rounded-lg px-4 py-3 text-tungsten placeholder-tungsten/30 resize-none focus:outline-none focus:border-overmatch/50 transition-colors"
                    rows={2}
                  />
                  <div className="flex items-center gap-2 mt-2 text-xs text-tungsten/50">
                    <Shield size={12} className="text-verified-green" />
                    <span>Hardware-signed • TPM-backed encryption</span>
                  </div>
                </div>
                <button
                  onClick={handleSendMessage}
                  disabled={!messageInput.trim()}
                  className="p-4 rounded-lg bg-overmatch hover:bg-overmatch/80 disabled:bg-tungsten/20 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={20} className="text-carbon" />
                </button>
              </div>
            </div>
          </GlassPanel>
        ) : (
          <GlassPanel variant="default" className="h-full flex items-center justify-center">
            <div className="text-center">
              <MessageSquare size={64} className="mx-auto mb-4 text-tungsten/30" />
              <h3 className="text-lg font-display text-tungsten mb-2">
                Select a Conversation
              </h3>
              <p className="text-tungsten/50">
                Choose an operator from the list to start messaging
              </p>
              <p className="text-xs text-tungsten/30 mt-2">
                Only showing verified operators with active hardware attestation
              </p>
            </div>
          </GlassPanel>
        )}
      </div>
    </div>
  );
};
