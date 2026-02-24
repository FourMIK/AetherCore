/**
 * GlassPanel
 * Reusable container with glass effect, chamfered corners, and hover glow
 */

import React, { ReactNode } from 'react';

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'heavy' | 'light';
  chamfered?: boolean;
  hover?: boolean;
  onClick?: () => void;
}

export const GlassPanel: React.FC<GlassPanelProps> = ({
  children,
  className = '',
  variant = 'default',
  chamfered = false,
  hover = true,
  onClick,
}) => {
  const variantClass = {
    default: 'glass-panel',
    heavy: 'glass-panel-heavy',
    light: 'glass-panel-light',
  }[variant];

  const chamferedClass = chamfered ? 'chamfered' : '';
  const hoverClass = hover ? '' : 'hover:border-opacity-100 hover:shadow-none';
  const cursorClass = onClick ? 'cursor-pointer' : '';

  return (
    <div
      className={`${variantClass} ${chamferedClass} ${hoverClass} ${cursorClass} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
};
