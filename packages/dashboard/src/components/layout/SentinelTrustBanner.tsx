import React from 'react';
import { ShieldAlert } from 'lucide-react';

interface SentinelTrustBannerProps {
  headline: string;
  detail: string;
}

export const SentinelTrustBanner: React.FC<SentinelTrustBannerProps> = ({ headline, detail }) => {
  return (
    <div className="bg-amber-900/30 border-b border-amber-600/60 px-4 py-1.5 flex items-center justify-center gap-2 text-amber-300 text-xs font-mono">
      <ShieldAlert size={14} className="flex-shrink-0" />
      <span className="font-semibold">{headline.toUpperCase()}</span>
      <span className="opacity-80">|</span>
      <span className="opacity-90">{detail}</span>
    </div>
  );
};
