/**
 * TpmDisabledBanner
 * Displays a clear indicator that TPM features are disabled
 * 
 * This component alerts operators that hardware-rooted trust is disabled,
 * resulting in reduced security guarantees.
 */

import React from 'react';
import { ShieldAlert } from 'lucide-react';

// Design system colors for TPM disabled banner
const TPM_DISABLED_STYLES = {
  container: 'bg-red-900/30 border-b border-red-700/50',
  text: 'text-red-400 text-xs font-mono',
  icon: 'flex-shrink-0',
} as const;

export const TpmDisabledBanner: React.FC = () => {
  return (
    <div className={`${TPM_DISABLED_STYLES.container} px-4 py-1.5 flex items-center justify-center gap-2 ${TPM_DISABLED_STYLES.text}`}>
      <ShieldAlert size={14} className={TPM_DISABLED_STYLES.icon} />
      <span className="font-semibold">TPM DISABLED</span>
      <span className="opacity-80">|</span>
      <span className="opacity-80">
        Hardware-Rooted Trust Features Disabled (TPM_ENABLED=false) - Reduced Security
      </span>
    </div>
  );
};
