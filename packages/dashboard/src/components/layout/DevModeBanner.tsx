/**
 * DevModeBanner
 * Displays a clear indicator that the application is running in Development Mode
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';

export const DevModeBanner: React.FC = () => {
  return (
    <div className="bg-amber-900/30 border-b border-amber-700/50 px-4 py-1.5 flex items-center justify-center gap-2 text-amber-400 text-xs font-mono">
      <AlertTriangle size={14} className="flex-shrink-0" />
      <span className="font-semibold">DEV MODE</span>
      <span className="opacity-80">|</span>
      <span className="opacity-80">
        Development & Demo Configuration - No Production Security Features
      </span>
    </div>
  );
};
