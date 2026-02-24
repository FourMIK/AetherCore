/**
 * DevModeBanner
 * Displays a clear indicator that the application is running in Development Mode
 * 
 * This component is intentionally non-configurable to ensure consistent
 * Dev Mode messaging across all instances.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';

// Design system colors for Dev Mode banner
const DEV_MODE_STYLES = {
  container: 'bg-amber-900/30 border-b border-amber-700/50',
  text: 'text-amber-400 text-xs font-mono',
  icon: 'flex-shrink-0',
} as const;

export const DevModeBanner: React.FC = () => {
  return (
    <div className={`${DEV_MODE_STYLES.container} px-4 py-1.5 flex items-center justify-center gap-2 ${DEV_MODE_STYLES.text}`}>
      <AlertTriangle size={14} className={DEV_MODE_STYLES.icon} />
      <span className="font-semibold">DEV MODE</span>
      <span className="opacity-80">|</span>
      <span className="opacity-80">
        Development & Demo Configuration - No Production Security Features
      </span>
    </div>
  );
};
