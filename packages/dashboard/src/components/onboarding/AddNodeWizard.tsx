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

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { GlassPanel } from '../hud/GlassPanel';
import { useTacticalStore } from '../../store/useTacticalStore';
import { AssetRadar } from './AssetRadar';
import { ActivationTerminal } from './ActivationTerminal';

interface CandidateNode {
  type: string;
  id: string;
  label: string;
}

interface GenesisIdentity {
  public_key: string;
  root_hash: string;
  callsign: string;
}

interface AddNodeWizardProps {
  onClose: () => void;
}

export const AddNodeWizard: React.FC<AddNodeWizardProps> = ({ onClose }) => {
  const [view, setView] = useState<'radar' | 'activation'>('radar');
  const [selectedAsset, setSelectedAsset] = useState<CandidateNode | null>(null);
  const [scanning, setScanning] = useState(false);
  
  const addNode = useTacticalStore((s) => s.addNode);

  const handleActivate = (asset: CandidateNode) => {
    setSelectedAsset(asset);
    setView('activation');
  };

  const handleSuccess = (identity: GenesisIdentity) => {
    // Generate a node ID from the callsign
    const nodeId = identity.callsign.toLowerCase().replace(/\s+/g, '-');
    
    // Add the node to the tactical store
    addNode({
      id: nodeId,
      domain: 'default-squad', // Could be derived from identity in production
      position: { latitude: 0, longitude: 0, altitude: 0 }, // Default position
      trustScore: 100,
      verified: true,
      attestationHash: identity.root_hash,
      lastSeen: new Date(),
      status: 'online',
      firmwareVersion: '1.0.0',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/80 backdrop-blur-sm p-4 animate-fadeIn">
      <GlassPanel
        variant="heavy"
        className="w-full max-w-3xl max-h-[90vh] flex flex-col animate-slideInUp"
      >
        {/* Header */}
        <div className="p-6 border-b border-tungsten/10 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-2xl font-semibold text-tungsten">
                Add Node to Mesh
              </h2>
              <p className="text-sm text-tungsten/60 mt-1">
                One Interaction • Zero Configuration • Full Trust
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={scanning}
              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-tungsten/10 transition-colors text-tungsten/70 hover:text-tungsten disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {view === 'radar' && (
            <AssetRadar
              onActivate={handleActivate}
              scanning={scanning}
              setScanninig={setScanning}
            />
          )}

          {view === 'activation' && selectedAsset && (
            <ActivationTerminal
              asset={selectedAsset}
              onSuccess={handleSuccess}
              onCancel={handleCancel}
            />
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
  );
};

export default AddNodeWizard;
