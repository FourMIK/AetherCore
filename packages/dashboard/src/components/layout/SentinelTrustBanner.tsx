import React from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { SentinelTrustStatus } from '../../api/tauri-commands';

interface SentinelTrustBannerProps {
  status: SentinelTrustStatus;
}

const FAILURE_REASON_LABELS: Record<string, string> = {
  bootloader_unlocked: 'Bootloader unlocked',
  chain_unverifiable: 'Chain unverifiable',
  challenge_mismatch: 'Challenge mismatch',
  backend_unavailable: 'Backend unavailable',
  policy_disabled: 'Policy disabled',
  ci_override: 'CI override',
  unknown: 'Unknown failure',
};

export const SentinelTrustBanner: React.FC<SentinelTrustBannerProps> = ({ status }) => {
  const probe = status.startup_probe;
  const probeStatus = probe?.status ?? (status.reduced_trust ? 'degraded' : 'healthy');
  const selectedBackend = probe?.selected_backend ?? 'tpm';
  const securityLevel = probe?.security_level ?? 'tee';
  const policyMode = probe?.policy_mode ?? 'optional';
  const failureReason = probe?.failure_reason
    ? FAILURE_REASON_LABELS[probe.failure_reason] ?? probe.failure_reason
    : 'None';

  const isHealthy = probeStatus === 'healthy' && !status.reduced_trust;
  const isError = probeStatus === 'error';

  const toneClass = isHealthy
    ? 'bg-emerald-900/20 border-emerald-600/60 text-emerald-300'
    : isError
      ? 'bg-red-900/30 border-red-600/60 text-red-300'
      : 'bg-amber-900/30 border-amber-600/60 text-amber-300';

  return (
    <div className={`border-b px-4 py-1.5 text-xs font-mono ${toneClass}`} data-testid="sentinel-trust-banner">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        {isHealthy ? <ShieldCheck size={14} className="flex-shrink-0" /> : <ShieldAlert size={14} className="flex-shrink-0" />}
        <span className="font-semibold">{status.headline.toUpperCase()}</span>
        <span className="opacity-80">|</span>
        <span className="opacity-90">Mode: {policyMode}</span>
        <span className="opacity-80">|</span>
        <span className="opacity-90">Backend: {selectedBackend}</span>
        <span className="opacity-80">|</span>
        <span className="opacity-90">Security: {securityLevel}</span>
        <span className="opacity-80">|</span>
        <span className="opacity-90">Status: {probeStatus}</span>
        <span className="opacity-80">|</span>
        <span className="opacity-90">Reason: {failureReason}</span>
      </div>
      <div className="text-center opacity-90 mt-1">{status.detail}</div>
    </div>
  );
};
