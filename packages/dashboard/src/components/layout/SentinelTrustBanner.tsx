import React from 'react';
import { ShieldAlert } from 'lucide-react';
import type { SentinelTrustStatus } from '../../api/tauri-commands';

interface SentinelTrustBannerProps {
  status: SentinelTrustStatus;
}

/**
 * Format failure reason from snake_case to Title Case for display
 * e.g. "chain_unverifiable" -> "Chain unverifiable"
 */
function formatFailureReason(reason: string | null | undefined): string {
  if (!reason) return 'None';
  const words = reason.split('_');
  return words
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word.toLowerCase()
    )
    .join(' ');
}

export const SentinelTrustBanner: React.FC<SentinelTrustBannerProps> = ({ status }) => {
  const { headline, detail, startup_probe } = status;

  const summarizedDetail = React.useMemo(() => {
    const flattened = detail.replace(/\s+/g, ' ').trim();
    const stripped = flattened.split(/REMEDIATION:|DIAGNOSTICS:/i)[0]?.trim() ?? flattened;
    if (stripped.length <= 220) {
      return stripped;
    }
    return `${stripped.slice(0, 219)}...`;
  }, [detail]);

  const probeInfo = React.useMemo(() => {
    if (!startup_probe) return null;
    return [
      `Mode: ${startup_probe.policy_mode}`,
      `Backend: ${startup_probe.selected_backend}`,
      `Security: ${startup_probe.security_level}`,
      `Status: ${startup_probe.status}`,
      `Reason: ${formatFailureReason(startup_probe.failure_reason)}`,
    ].join(' | ');
  }, [startup_probe]);

  return (
    <div>
      <div className="bg-amber-900/30 border-b border-amber-600/60 px-4 py-1.5 flex items-center justify-center gap-2 text-amber-300 text-xs font-mono">
        <ShieldAlert size={14} className="flex-shrink-0" />
        <span className="font-semibold">{headline.toUpperCase()}</span>
        <span className="opacity-80">|</span>
        <span className="opacity-90 truncate max-w-[68vw]" title={detail}>
          {summarizedDetail}
        </span>
      </div>
      {probeInfo && (
        <div className="bg-amber-900/20 border-b border-amber-600/40 px-4 py-1 text-amber-300 text-xs font-mono opacity-85">
          {probeInfo}
        </div>
      )}
    </div>
  );
};
