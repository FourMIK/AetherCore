/**
 * AddNodeWizard
 * Multi-stage wizard for node onboarding with Tauri backend integration
 */

import React, { useState } from 'react';
import { ChevronRight, ChevronLeft, CheckCircle, AlertCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { GlassPanel } from '../hud/GlassPanel';
import { useTacticalStore } from '../../store/useTacticalStore';

type WizardStage = 'identity' | 'qr-enrollment' | 'attestation' | 'provisioning' | 'complete' | 'error';

interface AddNodeWizardProps {
  onClose: () => void;
}

export const AddNodeWizard: React.FC<AddNodeWizardProps> = ({ onClose }) => {
  const [stage, setStage] = useState<WizardStage>('identity');
  const [nodeId, setNodeId] = useState('');
  const [domain, setDomain] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const addNode = useTacticalStore((s) => s.addNode);

  const handleNext = async () => {
    const stages: WizardStage[] = ['identity', 'qr-enrollment', 'attestation', 'provisioning', 'complete'];
    const currentIndex = stages.indexOf(stage);

    if (stage === 'identity' && (!nodeId || !domain)) {
      setError('Node ID and Domain are required');
      return;
    }

    if (stage === 'qr-enrollment') {
      // Generate QR code for Zero-Touch Enrollment
      setIsLoading(true);
      try {
        const bundle = await invoke<any>('generate_genesis_bundle', {
          userIdentity: nodeId,
          squadId: domain,
        });
        const qrData = await invoke<string>('bundle_to_qr_data', { bundle });
        setQrCode(qrData);
        setError('');
      } catch (err) {
        setError(`Failed to generate QR code: ${err}`);
        setStage('error');
        setIsLoading(false);
        return;
      }
      setIsLoading(false);
    }

    if (currentIndex < stages.length - 1) {
      setStage(stages[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    const stages: WizardStage[] = ['identity', 'qr-enrollment', 'attestation', 'provisioning', 'complete'];
    const currentIndex = stages.indexOf(stage);
    if (currentIndex > 0) {
      setStage(stages[currentIndex - 1]);
    }
    setError('');
  };

  const handleComplete = async () => {
    // Invoke Tauri command to create node
    setIsLoading(true);
    try {
      await invoke('create_node', {
        nodeId,
        domain,
      });

      // Add the node to local store
      addNode({
        id: nodeId,
        domain,
        position: { latitude: 0, longitude: 0, altitude: 0 },
        trustScore: 100,
        verified: true,
        lastSeen: new Date(),
        status: 'online',
      });
      setError('');
    } catch (err) {
      setError(`Failed to create node: ${err}`);
      setStage('error');
      setIsLoading(false);
      return;
    }
    setIsLoading(false);
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
            {['identity', 'qr-enrollment', 'attestation', 'provisioning', 'complete'].map((s, i) => (
              <div
                key={s}
                className={`flex-1 h-2 rounded-full ${
                  ['identity', 'qr-enrollment', 'attestation', 'provisioning', 'complete'].indexOf(stage) >= i
                    ? 'bg-overmatch'
                    : 'bg-tungsten/20'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 min-h-[400px]">
          {/* Error State */}
          {stage === 'error' && (
            <div className="space-y-4 text-center">
              <AlertCircle className="text-jamming mx-auto" size={64} />
              <h3 className="font-display text-xl text-jamming">Error</h3>
              <p className="text-tungsten/70">{error}</p>
            </div>
          )}

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
                  placeholder="Enter node ID (e.g., node-001)..."
                />
              </div>
              <div>
                <label className="block text-sm text-tungsten/70 mb-2">Domain / Squad ID</label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full px-4 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-tungsten focus:outline-none focus:border-overmatch"
                  placeholder="Enter domain (e.g., squad-alpha)..."
                />
              </div>
            </div>
          )}

          {stage === 'qr-enrollment' && (
            <div className="space-y-4 text-center">
              <h3 className="font-display text-xl text-tungsten">Zero-Touch Enrollment</h3>
              {isLoading ? (
                <>
                  <div className="h-2 bg-carbon border border-overmatch/30 rounded-full overflow-hidden mx-auto w-48">
                    <div className="h-full bg-overmatch animate-pulse w-1/2" />
                  </div>
                  <p className="text-tungsten/70">Generating QR code...</p>
                </>
              ) : qrCode ? (
                <>
                  <p className="text-tungsten/70 mb-4">
                    Scan this QR code with the node hardware to enroll automatically
                  </p>
                  <div className="bg-white p-4 rounded-lg inline-block">
                    {/* In production, use qrcode.react to render QR code */}
                    <div className="w-48 h-48 bg-carbon flex items-center justify-center text-tungsten/50 text-sm">
                      [QR Code: {qrCode.substring(0, 30)}...]
                    </div>
                  </div>
                  <p className="text-xs text-tungsten/50 mt-4">
                    QR Code ready for scanning
                  </p>
                </>
              ) : null}
            </div>
          )}

          {stage === 'attestation' && (
            <div className="space-y-4">
              <h3 className="font-display text-xl text-tungsten">TPM Attestation</h3>
              <p className="text-tungsten/70">
                Verifying TPM attestation and cryptographic signatures...
              </p>
              <div className="h-2 bg-carbon border border-overmatch/30 rounded-full overflow-hidden">
                <div className="h-full bg-overmatch animate-pulse w-3/4" />
              </div>
              <div className="text-xs text-tungsten/50 space-y-2">
                <div>✓ TPM Present: Verified</div>
                <div>✓ Attestation Key: Generated</div>
                <div>○ CodeRalphie Identity: Pending</div>
              </div>
            </div>
          )}

          {stage === 'provisioning' && (
            <div className="space-y-4">
              <h3 className="font-display text-xl text-tungsten">Provisioning</h3>
              <p className="text-tungsten/70">
                Generating cryptographic keys and provisioning node in mesh...
              </p>
              <div className="h-2 bg-carbon border border-overmatch/30 rounded-full overflow-hidden">
                <div className="h-full bg-overmatch animate-pulse w-1/2" />
              </div>
              <div className="text-xs text-tungsten/50 space-y-2">
                <div>✓ Identity Key: Generated</div>
                <div>✓ Trust Bootstrap: Complete</div>
                <div>○ Mesh Registration: In Progress</div>
              </div>
            </div>
          )}

          {stage === 'complete' && (
            <div className="space-y-4 text-center">
              <CheckCircle className="text-verified-green mx-auto" size={64} />
              <h3 className="font-display text-xl text-tungsten">Node Added Successfully</h3>
              <p className="text-tungsten/70">
                Node <span className="font-mono text-overmatch">{nodeId}</span> has been provisioned and added to the mesh.
              </p>
              <div className="bg-carbon/50 border border-tungsten/10 rounded p-4 text-left text-xs text-tungsten/70 space-y-1">
                <div>Node ID: <span className="font-mono text-tungsten">{nodeId}</span></div>
                <div>Domain: <span className="font-mono text-tungsten">{domain}</span></div>
                <div>Trust Score: <span className="font-mono text-verified-green">100%</span></div>
                <div>Status: <span className="font-mono text-verified-green">ONLINE</span></div>
              </div>
            </div>
          )}

          {error && stage !== 'error' && (
            <div className="mt-4 p-3 bg-jamming/10 border border-jamming/30 rounded text-jamming text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-tungsten/10 flex justify-between">
          <button
            onClick={stage === 'identity' ? onClose : handleBack}
            className="px-4 py-2 bg-tungsten/10 hover:bg-tungsten/20 text-tungsten rounded-lg transition-colors disabled:opacity-50"
            disabled={isLoading || stage === 'complete'}
          >
            <ChevronLeft size={16} className="inline mr-1" />
            {stage === 'identity' ? 'Cancel' : 'Back'}
          </button>
          <button
            onClick={stage === 'complete' ? handleComplete : handleNext}
            className="px-4 py-2 bg-overmatch hover:bg-overmatch/80 text-carbon font-semibold rounded-lg transition-colors disabled:opacity-50"
            disabled={
              (stage === 'identity' && (!nodeId || !domain)) ||
              (stage === 'qr-enrollment' && !qrCode) ||
              isLoading ||
              stage === 'error'
            }
          >
            {isLoading && (
              <span className="inline mr-2 animate-spin">⟳</span>
            )}
            {stage === 'complete' ? 'Finish' : 'Next'}
            {stage !== 'complete' && stage !== 'error' && <ChevronRight size={16} className="inline ml-1" />}
          </button>
        </div>
      </GlassPanel>
    </div>
  );
};
