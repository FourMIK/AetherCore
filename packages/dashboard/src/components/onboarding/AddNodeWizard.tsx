/**
 * AddNodeWizard - "One Interaction" Doctrine
 * 
 * Unified wizard for node onboarding with zero-friction UX.
 * The user shouldn't care if it's a Pi or an Arduino. They just want the node online.
 * 
 * Flow:
 * 1. Sonar View: Auto-scan and display all detected assets
 * 2. Activation: Single button triggers appropriate provisioning flow
 * 3. Success: Green shield, callsign display, auto-add to map
 */

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { GlassPanel } from '../hud/GlassPanel';
import { useTacticalStore } from '../../store/useTacticalStore';
import { AssetRadar } from './AssetRadar';
import { ActivationTerminal } from './ActivationTerminal';
import { isTauriRuntime } from '../../config/runtime';
import { ServiceUnavailablePanel } from '../health/ServiceUnavailablePanel';

interface CandidateNode {
  type: 'USB' | 'NET';
  id: string;
  label: string;
  transport?: 'usb-serial' | 'usb-mass-storage' | 'network' | 'bluetooth-serial';
  hardware_profile?: string;
}

interface GenesisIdentity {
  public_key: string;
  root_hash: string;
  node_id: string;
  callsign?: string;
}

interface AddNodeWizardProps {
  onClose: () => void;
}

export const AddNodeWizard: React.FC<AddNodeWizardProps> = ({ onClose }) => {
  const isDesktop = isTauriRuntime();
  const [view, setView] = useState<'radar' | 'activation'>('radar');
  const [selectedAsset, setSelectedAsset] = useState<CandidateNode | null>(null);
  const [scanning, setScanning] = useState(false);
  
  const addNode = useTacticalStore((s) => s.addNode);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleActivate = (asset: CandidateNode) => {
    setSelectedAsset(asset);
    setView('activation');
  };

  const handleSuccess = (identity: GenesisIdentity) => {
    // Fail-visible: use the node-provided identity key as the stable ID.
    // Do not synthesize IDs that diverge from service telemetry.
    const nodeId = identity.node_id;

    addNode({
      id: nodeId,
      domain: 'ralphienode',
      position: { latitude: 0, longitude: 0, altitude: 0 }, // Default position
      trustScore: 0,
      verified: false,
      attestationHash: identity.root_hash,
      lastSeen: new Date(),
      status: 'offline',
      integrityCompromised: false,
    });

    // Play success sound (if available)
    try {
      const audio = new Audio('/assets/link-established.mp3');
      audio.play().catch(() => {
        // Silently fail if audio not available
        console.log('Audio playback not available');
      });
    } catch {
      // Audio not available
    }

    // Close wizard after brief delay to show success state
    setTimeout(() => {
      onClose();
    }, 2000);
  };

  const handleCancel = () => {
    setSelectedAsset(null);
    setView('radar');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/80 backdrop-blur-sm p-4 animate-fadeIn"
      data-testid="add-node-wizard"
      role="dialog"
      aria-modal="true"
      aria-label="Add RalphieNode Wizard"
    >
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[90vh]" onClick={(event) => event.stopPropagation()}>
      <GlassPanel
        variant="heavy"
        className="w-full max-h-[90vh] flex flex-col animate-slideInUp"
      >
        {/* Header */}
        <div className="p-6 border-b border-tungsten/10 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-2xl font-semibold text-tungsten">
                Add Node to Mesh
              </h2>
              <p className="text-sm text-tungsten/60 mt-1">
                RalphieNode Onboarding • One Interaction • Full Trust
              </p>
            </div>
            <button
              onClick={onClose}
              data-testid="wizard-close-button"
              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-tungsten/10 transition-colors text-tungsten/70 hover:text-tungsten"
              aria-label={scanning ? 'Close wizard and cancel active scan' : 'Close wizard'}
            >
              <X size={24} />
            </button>
          </div>

          {/* Progress Indicator */}
          <div className="flex gap-2 mt-4">
            <div
              className={`flex-1 h-1 rounded-full transition-all ${
                view === 'radar' ? 'bg-overmatch' : 'bg-verified-green'
              }`}
            />
            <div
              className={`flex-1 h-1 rounded-full transition-all ${
                view === 'activation' ? 'bg-overmatch' : 'bg-tungsten/20'
              }`}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6" data-testid="wizard-content">
          {!isDesktop ? (
            <ServiceUnavailablePanel
              title="Node provisioning requires the desktop app"
              description="RalphieNode onboarding uses local hardware access (serial/USB provisioning) and is not available in a browser runtime."
              capability="Serial/USB provisioning + local flashing"
              remediation={[
                'Open Tactical Glass desktop (Tauri runtime) to provision hardware nodes.',
                'If you only need remote node visibility, use the Fleet/Map workspaces.',
              ]}
            />
          ) : (
            <>
              {view === 'radar' && (
                <AssetRadar
                  onActivate={handleActivate}
                  scanning={scanning}
                  setScanning={setScanning}
                />
              )}

              {view === 'activation' && selectedAsset && (
                <ActivationTerminal
                  asset={selectedAsset}
                  onSuccess={handleSuccess}
                  onCancel={handleCancel}
                />
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-tungsten/10 flex-shrink-0">
          <div className="flex items-center justify-between text-xs text-tungsten/40">
            <span className="font-mono">
              {view === 'radar' ? 'ASSET DETECTION' : 'PROVISIONING PROTOCOL'}
            </span>
            <span className="font-display">
              TACTICAL GLASS v{import.meta.env.VITE_APP_VERSION || '1.0.0'}
            </span>
          </div>
        </div>
      </GlassPanel>
      </div>
    </div>
  );
};

export default AddNodeWizard;
