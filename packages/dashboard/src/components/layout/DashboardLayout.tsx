/**
 * DashboardLayout
 * Main layout with TopBar, workspace routing, and security overlays
 */

import React, { useState } from 'react';
import { TopBar } from '../hud/TopBar';
import { TacticalMap } from '../map/TacticalMap';
import { NodeListPanel } from '../panels/NodeListPanel';
import { NodeDetailPanel } from '../panels/NodeDetailPanel';
import { AddNodeWizard } from '../onboarding/AddNodeWizard';
import { AethericSweep } from '../animations/AethericSweep';
import { PurgeAnimation } from '../animations/PurgeAnimation';
import { useTacticalStore } from '../../store/useTacticalStore';
import { Plus } from 'lucide-react';

export const DashboardLayout: React.FC = () => {
  const nodes = useTacticalStore((s) => s.nodes);
  const byzantineAlert = useTacticalStore((s) => s.byzantineAlert);
  const verificationFailure = useTacticalStore((s) => s.verificationFailure);
  const clearByzantineAlert = useTacticalStore((s) => s.clearByzantineAlert);
  const clearVerificationFailure = useTacticalStore((s) => s.clearVerificationFailure);

  const [showWizard, setShowWizard] = useState(false);

  const verifiedCount = Array.from(nodes.values()).filter((n) => n.verified).length;
  const totalCount = nodes.size;

  return (
    <div className="w-screen h-screen flex flex-col bg-carbon overflow-hidden">
      {/* Scanline Overlay */}
      <div className="scanline-overlay" />

      {/* TopBar */}
      <TopBar
        systemStatus="operational"
        verifiedNodes={verifiedCount}
        totalNodes={totalCount}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Node List */}
        <div className="w-80 p-4">
          <div className="h-full flex flex-col">
            <button
              onClick={() => setShowWizard(true)}
              className="btn-primary w-full mb-4 flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              Add Node
            </button>
            <div className="flex-1 min-h-0">
              <NodeListPanel />
            </div>
          </div>
        </div>

        {/* Center - Map */}
        <div className="flex-1 p-4">
          <TacticalMap />
        </div>

        {/* Right Sidebar - Node Details */}
        <div className="w-96 p-4">
          <NodeDetailPanel />
        </div>
      </div>

      {/* Modals and Overlays */}
      {showWizard && <AddNodeWizard onClose={() => setShowWizard(false)} />}

      {/* Security Animations */}
      {byzantineAlert && (
        <div className="fixed inset-0 z-50">
          <AethericSweep websocketUrl={`ws://localhost:8080/mesh-health`} />
          <button
            onClick={clearByzantineAlert}
            className="absolute top-4 right-4 btn-secondary"
          >
            Close
          </button>
        </div>
      )}

      {verificationFailure && (
        <PurgeAnimation
          nodeId={verificationFailure.nodeId}
          reason={verificationFailure.reason}
          onComplete={clearVerificationFailure}
        />
      )}
    </div>
  );
};
