import React from 'react';
import { ShieldAlert } from 'lucide-react';

interface SentinelTrustBannerProps {
  headline: string;
  detail: string;
}

export const SentinelTrustBanner: React.FC<SentinelTrustBannerProps> = ({ headline, detail }) => {
  const summarizedDetail = React.useMemo(() => {
    const flattened = detail.replace(/\s+/g, ' ').trim();
    const stripped = flattened.split(/REMEDIATION:|DIAGNOSTICS:/i)[0]?.trim() ?? flattened;
    if (stripped.length <= 220) {
      return stripped;
    }
    return `${stripped.slice(0, 219)}...`;
  }, [detail]);

  return (
    <div className="bg-amber-900/30 border-b border-amber-600/60 px-4 py-1.5 flex items-center justify-center gap-2 text-amber-300 text-xs font-mono">
      <ShieldAlert size={14} className="flex-shrink-0" />
      <span className="font-semibold">{headline.toUpperCase()}</span>
      <span className="opacity-80">|</span>
      <span className="opacity-90 truncate max-w-[68vw]" title={detail}>
        {summarizedDetail}
      </span>
    </div>
  );
};
