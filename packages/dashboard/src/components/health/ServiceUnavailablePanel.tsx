/**
 * ServiceUnavailablePanel
 *
 * Fail-visible UX for capabilities that require the desktop (Tauri) runtime
 * or a backend service that is not currently reachable.
 *
 * This component intentionally avoids silent fallbacks: it explains what is
 * missing and what the operator can do next.
 */

import React from 'react';
import { AlertTriangle, Monitor, Wrench } from 'lucide-react';
import { GlassPanel } from '../hud/GlassPanel';
import { getRuntimeConfig } from '../../config/runtime';

export interface ServiceUnavailablePanelProps {
  title: string;
  description: string;
  capability?: string;
  details?: string[];
  remediation?: string[];
}

export const ServiceUnavailablePanel: React.FC<ServiceUnavailablePanelProps> = ({
  title,
  description,
  capability,
  details,
  remediation,
}) => {
  const { runtimeEndpoints, transportMode } = getRuntimeConfig();

  return (
    <GlassPanel variant="light" className="p-6 border border-jamming/30 bg-jamming/5">
      <div className="flex items-start gap-4">
        <div className="p-2 rounded-lg bg-jamming/10 border border-jamming/30">
          <AlertTriangle className="text-jamming" size={20} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold text-tungsten">{title}</h3>
            {transportMode === 'web' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-tungsten/10 border border-tungsten/20 text-xs text-tungsten/70">
                <Monitor size={12} />
                Web mode
              </span>
            )}
          </div>

          <p className="text-sm text-tungsten/70 mt-1">{description}</p>

          {capability && (
            <div className="mt-3 text-xs">
              <div className="text-tungsten/50 uppercase tracking-wider mb-1">Missing capability</div>
              <div className="font-mono text-tungsten/70 break-words">{capability}</div>
            </div>
          )}

          {details && details.length > 0 && (
            <div className="mt-3 text-xs">
              <div className="text-tungsten/50 uppercase tracking-wider mb-1">Details</div>
              <div className="space-y-1">
                {details.map((line, idx) => (
                  <div key={idx} className="font-mono text-tungsten/70 break-words">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}

          {remediation && remediation.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 text-tungsten/50 uppercase tracking-wider text-xs mb-2">
                <Wrench size={12} />
                Remediation
              </div>
              <ul className="list-disc list-inside space-y-1 text-sm text-tungsten/70">
                {remediation.map((step, idx) => (
                  <li key={idx} className="break-words">
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-tungsten/10 text-xs text-tungsten/50">
            <div className="font-mono">api: {runtimeEndpoints.apiUrl}</div>
            <div className="font-mono">ws: {runtimeEndpoints.wsUrl}</div>
          </div>
        </div>
      </div>
    </GlassPanel>
  );
};

