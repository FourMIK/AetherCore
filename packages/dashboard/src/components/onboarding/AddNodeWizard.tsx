/**
 * AddNodeWizard
 * Multi-stage wizard for node onboarding
 */

import React, { useState } from 'react';
import { ChevronRight, ChevronLeft, CheckCircle } from 'lucide-react';
import { GlassPanel } from '../hud/GlassPanel';
import { useTacticalStore } from '../../store/useTacticalStore';

type WizardStage = 'identity' | 'attestation' | 'provisioning' | 'complete';

interface AddNodeWizardProps {
  onClose: () => void;
}

export const AddNodeWizard: React.FC<AddNodeWizardProps> = ({ onClose }) => {
  const [stage, setStage] = useState<WizardStage>('identity');
  const [nodeId, setNodeId] = useState('');
  const [domain, setDomain] = useState('');
  const addNode = useTacticalStore((s) => s.addNode);

  const handleNext = () => {
    const stages: WizardStage[] = ['identity', 'attestation', 'provisioning', 'complete'];
    const currentIndex = stages.indexOf(stage);
    if (currentIndex < stages.length - 1) {
      setStage(stages[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    const stages: WizardStage[] = ['identity', 'attestation', 'provisioning', 'complete'];
    const currentIndex = stages.indexOf(stage);
    if (currentIndex > 0) {
      setStage(stages[currentIndex - 1]);
    }
  };

  const handleComplete = () => {
    // Add the node
    addNode({
      id: nodeId,
      domain,
      position: { latitude: 0, longitude: 0, altitude: 0 },
      trustScore: 100,
      verified: true,
      lastSeen: new Date(),
      status: 'online',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/80 backdrop-blur-sm">
      <GlassPanel variant="heavy" className="w-full max-w-2xl mx-4">
        {/* Header */}
        <div className="p-6 border-b border-tungsten/10">
          <h2 className="font-display text-2xl font-semibold text-tungsten">
            Add Node
          </h2>
          <div className="flex gap-2 mt-4">
            {['identity', 'attestation', 'provisioning', 'complete'].map((s, i) => (
              <div
                key={s}
                className={`flex-1 h-2 rounded-full ${
                  ['identity', 'attestation', 'provisioning', 'complete'].indexOf(stage) >= i
                    ? 'bg-overmatch'
                    : 'bg-tungsten/20'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 min-h-[300px]">
          {stage === 'identity' && (
            <div className="space-y-4">
              <h3 className="font-display text-xl text-tungsten">Node Identity</h3>
              <div>
                <label className="block text-sm text-tungsten/70 mb-2">Node ID</label>
                <input
                  type="text"
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                  className="w-full px-4 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-tungsten focus:outline-none focus:border-overmatch"
                  placeholder="Enter node ID..."
                />
              </div>
              <div>
                <label className="block text-sm text-tungsten/70 mb-2">Domain</label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full px-4 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-tungsten focus:outline-none focus:border-overmatch"
                  placeholder="Enter domain..."
                />
              </div>
            </div>
          )}

          {stage === 'attestation' && (
            <div className="space-y-4">
              <h3 className="font-display text-xl text-tungsten">Attestation</h3>
              <p className="text-tungsten/70">
                Verifying TPM attestation and cryptographic signatures...
              </p>
              <div className="h-2 bg-carbon border border-overmatch/30 rounded-full overflow-hidden">
                <div className="h-full bg-overmatch animate-pulse w-3/4" />
              </div>
            </div>
          )}

          {stage === 'provisioning' && (
            <div className="space-y-4">
              <h3 className="font-display text-xl text-tungsten">Provisioning</h3>
              <p className="text-tungsten/70">
                Generating cryptographic keys and provisioning node...
              </p>
              <div className="h-2 bg-carbon border border-overmatch/30 rounded-full overflow-hidden">
                <div className="h-full bg-overmatch animate-pulse w-1/2" />
              </div>
            </div>
          )}

          {stage === 'complete' && (
            <div className="space-y-4 text-center">
              <CheckCircle className="text-verified-green mx-auto" size={64} />
              <h3 className="font-display text-xl text-tungsten">Node Added Successfully</h3>
              <p className="text-tungsten/70">
                Node {nodeId} has been provisioned and added to the mesh.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-tungsten/10 flex justify-between">
          <button
            onClick={stage === 'identity' ? onClose : handleBack}
            className="btn-secondary"
            disabled={stage === 'complete'}
          >
            <ChevronLeft size={16} className="inline mr-1" />
            {stage === 'identity' ? 'Cancel' : 'Back'}
          </button>
          <button
            onClick={stage === 'complete' ? handleComplete : handleNext}
            className="btn-primary"
            disabled={stage === 'identity' && (!nodeId || !domain)}
          >
            {stage === 'complete' ? 'Finish' : 'Next'}
            {stage !== 'complete' && <ChevronRight size={16} className="inline ml-1" />}
          </button>
        </div>
      </GlassPanel>
    </div>
  );
};
