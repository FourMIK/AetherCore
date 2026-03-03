/**
 * ConversationList - Verified Operator Directory
 * 
 * Displays list of verified operators available for secure messaging.
 * 
 * PHASE 4: Great Gospel Filtering
 * - Only shows operators with active hardware attestation
 * - Filters out nodes revoked by Great Gospel
 * - Displays trust scores and verification badges
 * - Auto-removes conversations when nodes are revoked
 * 
 * ARCHITECTURAL INVARIANTS:
 * - NO GRACEFUL DEGRADATION: Revoked nodes are adversaries
 * - Trust score >= MIN_TRUST_SCORE_THRESHOLD required for communication
 * - Hardware attestation verified = true
 */

import React from 'react';
import { User, Shield, ShieldAlert, ShieldOff, MessageSquare } from 'lucide-react';

/**
 * Minimum trust score threshold for secure communication
 * This is a critical security boundary - operators below this threshold
 * cannot be trusted for cryptographic operations
 */
const MIN_TRUST_SCORE_THRESHOLD = 70;

/**
 * Operator data structure
 */
export interface Operator {
  id: string;
  name: string;
  callsign?: string;
  status: 'online' | 'offline' | 'busy' | 'away';
  verified: boolean;
  trustScore: number;
  lastSeen: Date;
  isRevoked?: boolean; // Great Gospel revocation status
}

/**
 * ConversationList Props
 */
export interface ConversationListProps {
  /** List of all operators */
  operators: Operator[];
  
  /** Currently selected operator ID */
  selectedOperatorId: string | null;
  
  /** Current user's operator ID */
  currentOperatorId: string;
  
  /** Callback when operator is selected */
  onSelectOperator: (operatorId: string) => void;
  
  /** Map of conversation ID to last message */
  lastMessages?: Map<string, { content: string; verified: boolean; timestamp: Date }>;
  
  /** Map of conversation ID to unread count */
  unreadCounts?: Map<string, number>;
}

/**
 * ConversationList Component
 * 
 * Displays verified operators with Great Gospel filtering.
 * Implements Fail-Visible design for trust scores and verification status.
 */
export const ConversationList: React.FC<ConversationListProps> = ({
  operators,
  selectedOperatorId,
  currentOperatorId,
  onSelectOperator,
  lastMessages = new Map(),
  unreadCounts = new Map(),
}) => {
  /**
   * Filter operators by Great Gospel and hardware attestation
   * 
   * CRITICAL: Only show operators that:
   * - Are NOT revoked by Great Gospel (isRevoked !== true)
   * - Have active hardware attestation (verified === true)
   * - Have trust score >= MIN_TRUST_SCORE_THRESHOLD
   * - Are not the current user
   * - Are not offline (offline operators cannot receive messages in real-time)
   * 
   * NOTE: Offline status is excluded for UX reasons (cannot send messages to offline nodes).
   * Operators who go offline temporarily will reappear when they come back online
   * if they still maintain valid hardware attestation.
   */
  const verifiedOperators = operators.filter(
    (op) =>
      !op.isRevoked &&
      op.verified &&
      op.trustScore >= MIN_TRUST_SCORE_THRESHOLD &&
      op.id !== currentOperatorId &&
      op.status !== 'offline'
  );

  /**
   * Get trust score badge styling
   */
  function getTrustBadge(operator: Operator) {
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
  }

  /**
   * Get status badge styling
   */
  function getStatusBadge(operator: Operator) {
    let statusColor = 'bg-tungsten/20 text-tungsten/70';
    let statusText = operator.status;

    if (operator.status === 'online') {
      statusColor = 'bg-verified-green/20 text-verified-green';
    } else if (operator.status === 'busy') {
      statusColor = 'bg-jamming/20 text-jamming';
    } else if (operator.status === 'away') {
      statusColor = 'bg-tungsten/20 text-tungsten';
    }

    return (
      <span className={`px-2 py-0.5 rounded text-xs font-mono ${statusColor}`}>
        {statusText}
      </span>
    );
  }

  /**
   * Get verification icon for last message
   */
  function getVerificationIcon(verified: boolean) {
    if (verified) {
      return <Shield size={12} className="text-verified-green" />;
    }
    return <ShieldOff size={12} className="text-jamming" />;
  }

  if (verifiedOperators.length === 0) {
    return (
      <div className="p-4 text-center">
        <ShieldAlert size={32} className="mx-auto mb-2 text-tungsten/30" />
        <p className="text-sm text-tungsten/50">No verified operators in range</p>
        <p className="text-xs text-tungsten/30 mt-1">
          Awaiting hardware attestation
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {verifiedOperators.map((operator) => {
        const lastMessage = lastMessages.get(operator.id);
        const unreadCount = unreadCounts.get(operator.id) || 0;
        const isSelected = selectedOperatorId === operator.id;

        return (
          <button
            key={operator.id}
            onClick={() => onSelectOperator(operator.id)}
            className={`w-full p-3 border-b border-tungsten/10 hover:bg-tungsten/5 transition-colors text-left ${
              isSelected ? 'bg-tungsten/10' : ''
            }`}
          >
            {/* Header: Avatar + Name + Trust Score */}
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

            {/* Status Badge */}
            <div className="flex items-center justify-between mb-2">
              {getStatusBadge(operator)}
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-overmatch text-carbon text-xs font-bold">
                  {unreadCount}
                </span>
              )}
            </div>

            {/* Last Message Preview */}
            {lastMessage && (
              <div className="mt-2 text-xs text-tungsten/50 truncate flex items-center gap-1">
                {getVerificationIcon(lastMessage.verified)}
                <span>{lastMessage.content}</span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
};
