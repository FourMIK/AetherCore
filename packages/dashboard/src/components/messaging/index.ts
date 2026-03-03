/**
 * Messaging Components - Secure P2P Communications
 * 
 * Exports components for cryptographically-verified messaging with Merkle Vine integrity.
 * 
 * PHASE 4: Complete Tactical Glass Messaging Stack
 * - MessageBubble: Fail-Visible message display with verification status
 * - MessageInput: Outgress boundary with TPM signing
 * - ConversationList: Verified operator directory with Great Gospel filtering
 * - MessagingPanel: Complete messaging interface
 */

export { MessagingPanel } from './MessagingPanel';
export { MerkleChainIndicator, InlineVerificationBadge } from './MerkleChainIndicator';
export { MessageBubble, type MessageBubbleProps } from './MessageBubble';
export { MessageInput, type MessageInputProps } from './MessageInput';
export { ConversationList, type ConversationListProps, type Operator } from './ConversationList';
