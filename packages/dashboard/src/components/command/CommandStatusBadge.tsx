/**
 * CommandStatusBadge
 * Visual indicator for command execution status
 */

import React from 'react';
import { Check, X, Clock, Loader } from 'lucide-react';

export type CommandStatus = 'pending' | 'executing' | 'success' | 'failed';

interface CommandStatusBadgeProps {
  status: CommandStatus;
  className?: string;
  showIcon?: boolean;
}

export const CommandStatusBadge: React.FC<CommandStatusBadgeProps> = ({
  status,
  className = '',
  showIcon = true,
}) => {
  const config = {
    pending: {
      label: 'Pending',
      badge: 'badge-info',
      icon: <Clock size={14} />,
    },
    executing: {
      label: 'Executing',
      badge: 'badge-warning',
      icon: <Loader size={14} className="animate-spin" />,
    },
    success: {
      label: 'Success',
      badge: 'badge-success',
      icon: <Check size={14} />,
    },
    failed: {
      label: 'Failed',
      badge: 'badge-danger',
      icon: <X size={14} />,
    },
  }[status];

  return (
    <span className={`${config.badge} inline-flex items-center gap-1 ${className}`}>
      {showIcon && config.icon}
      <span>{config.label}</span>
    </span>
  );
};
