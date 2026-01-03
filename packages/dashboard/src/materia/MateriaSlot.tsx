/**
 * MateriaSlot
 * Base container for modular GUI capabilities (ISR, BioMetrics, Ledger, Identity)
 * Hardware-rooted sensor definitions with integrity verification
 */

import React, { ReactNode } from 'react';
import { X } from 'lucide-react';
import { GlassPanel } from '../components/hud/GlassPanel';

export interface MateriaSlotConfig {
  /** Unique slot identifier */
  id: string;
  /** Slot type (isr, bio, ledger, identity) */
  type: 'isr' | 'bio' | 'ledger' | 'identity';
  /** Display title */
  title: string;
  /** Optional description */
  description?: string;
  /** Is slot minimized */
  minimized?: boolean;
  /** Custom CSS classes */
  className?: string;
  /** Slot-specific data */
  data?: Record<string, any>;
}

export interface MateriaSlotProps {
  config: MateriaSlotConfig;
  children: ReactNode;
  onClose?: () => void;
  onMinimize?: () => void;
  onExpand?: () => void;
}

/**
 * MateriaSlot Component
 * Hardware-rooted modular display container with glassmorphic UI
 */
export const MateriaSlot: React.FC<MateriaSlotProps> = ({
  config,
  children,
  onClose,
  onMinimize,
  onExpand,
}) => {
  return (
    <GlassPanel
      variant="heavy"
      className={`relative flex flex-col h-full ${config.className || ''}`}
    >
      {/* Slot Header */}
      <div className="flex items-center justify-between p-4 border-b border-tungsten/10">
        <div className="flex-1">
          <h3 className="font-display text-lg font-semibold text-tungsten">
            {config.title}
          </h3>
          {config.description && (
            <p className="text-xs text-tungsten/50 mt-1">{config.description}</p>
          )}
        </div>

        {/* Slot Controls */}
        <div className="flex gap-2 ml-4">
          {onMinimize && (
            <button
              onClick={onMinimize}
              className="p-2 hover:bg-tungsten/10 rounded transition-colors"
              title="Minimize"
            >
              <div className="w-4 h-0.5 bg-tungsten/70" />
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 hover:bg-jamming/20 rounded transition-colors"
              title="Close slot"
            >
              <X size={16} className="text-jamming" />
            </button>
          )}
        </div>
      </div>

      {/* Slot Content */}
      <div className="flex-1 overflow-auto p-4">
        {children}
      </div>

      {/* Slot Footer - Status Indicator */}
      <div className="border-t border-tungsten/10 p-3 flex justify-between items-center text-xs">
        <div className="text-tungsten/50">
          Slot ID: <span className="font-mono text-tungsten/70">{config.id}</span>
        </div>
        <div className="flex gap-2">
          <div className="w-2 h-2 bg-verified-green rounded-full animate-pulse" />
          <span className="text-tungsten/50">Active</span>
        </div>
      </div>
    </GlassPanel>
  );
};

export default MateriaSlot;
