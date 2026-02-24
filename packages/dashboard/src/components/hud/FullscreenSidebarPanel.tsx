/**
 * FullscreenSidebarPanel
 * Fullscreen sidebar mode for detailed views
 */

import React, { ReactNode } from 'react';
import { X } from 'lucide-react';
import { GlassPanel } from './GlassPanel';

interface FullscreenSidebarPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

export const FullscreenSidebarPanel: React.FC<FullscreenSidebarPanelProps> = ({
  isOpen,
  onClose,
  title,
  children,
  className = '',
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end animate-fadeIn">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-carbon/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <GlassPanel
        variant="heavy"
        className={`relative h-full w-full max-w-2xl overflow-hidden animate-slideInRight ${className}`}
        hover={false}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-tungsten/10 px-6 py-4">
          <h2 className="font-display text-2xl font-semibold text-tungsten">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-tungsten/70 transition-colors hover:bg-tungsten/10 hover:text-tungsten"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="h-[calc(100%-5rem)] overflow-y-auto p-6">{children}</div>
      </GlassPanel>
    </div>
  );
};
