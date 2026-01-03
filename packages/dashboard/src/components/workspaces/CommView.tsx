/**
 * CommView
 * Secure console-to-console communications workspace
 * Supports text messaging and video calls between verified operators
 */

import React, { useState, useEffect, useRef } from 'react';
import { GlassPanel } from '../hud/GlassPanel';
import {
  MessageSquare,
  Video,
  Phone,
  PhoneOff,
  Send,
  Shield,
  User,
  Clock
} from 'lucide-react';
import { useCommStore } from '../../store/useCommStore';

export const CommView: React.FC = () => {
  const {
    currentOperator,
    operators,
    conversations,
    activeCall,
    sendMessage,
    initiateCall,
    endCall,
    getConversation,
  } = useCommStore();

  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const operatorList = Array.from(operators.values());
  const selectedOperator = selectedOperatorId ? operators.get(selectedOperatorId) : null;
  const conversation = selectedOperatorId ? getConversation(selectedOperatorId) : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedOperatorId) return;

    await sendMessage(selectedOperatorId, messageInput);
    setMessageInput('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-verified-green';
      case 'busy': return 'bg-jamming';
      case 'away': return 'bg-ghost';
      default: return 'bg-tungsten/30';
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'commander': return 'badge-warning';
      case 'admin': return 'badge-danger';
      default: return 'badge-info';
    }
  };

  return (
    <div className="h-full overflow-hidden">
      <div className="h-full flex">
        {/* Operator Roster */}
        <div className="w-80 flex-shrink-0 border-r border-tungsten/10 flex flex-col">
          <div className="p-4 border-b border-tungsten/10 flex-shrink-0">
            <h2 className="font-display text-xl font-semibold text-tungsten flex items-center gap-2">
              <MessageSquare size={20} className="text-overmatch" />
              Secure Comms
            </h2>
            <p className="text-xs text-tungsten/50 mt-1">
              End-to-end encrypted communications
            </p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
            {operatorList.length === 0 ? (
              <div className="text-center py-8 text-tungsten/50">
                <User size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No operators online</p>
              </div>
            ) : (
              operatorList.map((op) => (
                <GlassPanel
                  key={op.id}
                  variant="light"
                  className={`p-3 cursor-pointer transition-all hover:border-tungsten/40 ${selectedOperatorId === op.id ? 'border-overmatch ring-1 ring-overmatch/30' : ''
                    }`}
                  onClick={() => setSelectedOperatorId(op.id)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="relative">
                        <div className="w-8 h-8 rounded-full bg-tungsten/20 flex items-center justify-center">
                          <User size={16} className="text-tungsten" />
                        </div>
                        <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-carbon ${getStatusColor(op.status)}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-tungsten text-sm truncate">
                          {op.name}
                        </div>
                        {op.callsign && (
                          <div className="text-xs text-tungsten/50 font-mono">
                            {op.callsign}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className={`${getRoleBadge(op.role)} text-xs flex-shrink-0`}>
                      {op.role.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={op.verified ? 'text-verified-green' : 'text-ghost'}>
                      {op.verified ? (
                        <span className="flex items-center gap-1">
                          <Shield size={12} />
                          Verified
                        </span>
                      ) : 'Unverified'}
                    </span>
                    <span className="text-tungsten/50">Trust: {op.trustScore}%</span>
                  </div>
                </GlassPanel>
              ))
            )}
          </div>
        </div>

        {/* Main Communication Area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {!selectedOperator ? (
            <div className="flex-1 flex items-center justify-center text-tungsten/50">
              <div className="text-center">
                <MessageSquare size={64} className="mx-auto mb-4 opacity-20" />
                <p className="text-lg font-display">Select an operator to begin secure communication</p>
                <p className="text-sm mt-2">All messages are encrypted and signed</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b border-tungsten/10 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-tungsten/20 flex items-center justify-center">
                      <User size={20} className="text-tungsten" />
                    </div>
                    <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-carbon ${getStatusColor(selectedOperator.status)}`} />
                  </div>
                  <div>
                    <div className="font-display font-semibold text-tungsten flex items-center gap-2">
                      {selectedOperator.name}
                      {selectedOperator.verified && (
                        <Shield size={14} className="text-verified-green" />
                      )}
                    </div>
                    <div className="text-xs text-tungsten/50">
                      {selectedOperator.callsign} • {selectedOperator.role}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => initiateCall(selectedOperator.id)}
                    disabled={!!activeCall}
                    className="p-2 rounded-lg bg-overmatch/10 hover:bg-overmatch/20 text-overmatch transition-colors disabled:opacity-50"
                    title="Start video call"
                  >
                    <Video size={20} />
                  </button>
                  <button
                    onClick={() => initiateCall(selectedOperator.id)}
                    disabled={!!activeCall}
                    className="p-2 rounded-lg bg-verified-green/10 hover:bg-verified-green/20 text-verified-green transition-colors disabled:opacity-50"
                    title="Start voice call"
                  >
                    <Phone size={20} />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                {conversation.length === 0 ? (
                  <div className="text-center text-tungsten/50 py-8">
                    <p className="text-sm">No messages yet. Start a secure conversation.</p>
                  </div>
                ) : (
                  conversation.map((msg) => {
                    const isFromMe = msg.from === currentOperator?.id;
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-md p-3 rounded-lg ${isFromMe
                              ? 'bg-overmatch/20 border border-overmatch/30'
                              : 'bg-tungsten/10 border border-tungsten/20'
                            }`}
                        >
                          <div className="text-sm text-tungsten break-words">
                            {msg.content}
                          </div>
                          <div className="flex items-center justify-between gap-3 mt-2 text-xs text-tungsten/50">
                            <span className="flex items-center gap-1">
                              <Clock size={10} />
                              {msg.timestamp.toLocaleTimeString()}
                            </span>
                            {msg.encrypted && (
                              <span className="flex items-center gap-1 text-verified-green">
                                <Shield size={10} />
                                E2E
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Input */}
              <div className="p-4 border-t border-tungsten/10 flex-shrink-0">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type a secure message..."
                    className="flex-1 px-4 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-tungsten focus:outline-none focus:border-overmatch"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!messageInput.trim()}
                    className="px-4 py-2 bg-overmatch hover:bg-overmatch/80 text-carbon font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    <Send size={16} />
                    Send
                  </button>
                </div>
                <div className="text-xs text-tungsten/50 mt-2 flex items-center gap-1">
                  <Shield size={12} className="text-verified-green" />
                  Messages are encrypted with BLAKE3 + Ed25519
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
