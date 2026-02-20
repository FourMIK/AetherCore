/**
 * DashboardLayout
 * Main layout with TopBar, workspace routing, and security overlays
 */

import React, { useState } from 'react';
import { TopBar } from '../hud/TopBar';
import { NavigationMenu, WorkspaceView } from '../hud/NavigationMenu';
import { TacticalMap } from '../map/TacticalMap';
import { NodeListPanel } from '../panels/NodeListPanel';
import { NodeDetailPanel } from '../panels/NodeDetailPanel';
import { AddNodeWizard } from '../onboarding/AddNodeWizard';
import { AethericSweep } from '../animations/AethericSweep';
import { PurgeAnimation } from '../animations/PurgeAnimation';
import { FleetCommandView } from '../workspaces/FleetCommandView';
import { ISRConsoleView } from '../workspaces/ISRConsoleView';
import { CommView } from '../workspaces/CommView';
import { TrustGuardianView } from '../workspaces/TrustGuardianView';
import { MeshNetworkView } from '../workspaces/MeshNetworkView';
import { SystemAdminView } from '../workspaces/SystemAdminView';
import { DeploymentManagementView } from '../workspaces/DeploymentManagementView';
import { RalphieNodeProvisioning } from '../RalphieNodeProvisioning';
import { VideoCallPanel } from '../comms/VideoCallPanel';
import { SettingsPanel } from '../SettingsPanel';
import { ConnectionStatusIndicator } from '../ConnectionStatus';
import { SentinelTrustBanner } from './SentinelTrustBanner';
import type { SentinelTrustStatus } from '../../api/tauri-commands';
import { useTacticalStore } from '../../store/useTacticalStore';
import { useCommStore } from '../../store/useCommStore';
import { Plus } from 'lucide-react';

interface DashboardLayoutProps {
  sentinelTrustStatus?: SentinelTrustStatus | null;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ sentinelTrustStatus = null }) => {
  const nodes = useTacticalStore((s) => s.nodes) || new Map();
  const byzantineAlert = useTacticalStore((s) => s.byzantineAlert);
  const verificationFailure = useTacticalStore((s) => s.verificationFailure);
  const clearByzantineAlert = useTacticalStore((s) => s.clearByzantineAlert);
  const clearVerificationFailure = useTacticalStore((s) => s.clearVerificationFailure);
  const activeCall = useCommStore((s) => s.activeCall);
  const [showWizard, setShowWizard] = useState(false);
  const [currentView, setCurrentView] = useState<WorkspaceView>('tactical');

  const verifiedCount = Array.from(nodes.values()).filter((n) => n.verified).length;
  const totalCount = nodes.size;

  const renderWorkspaceContent = () => {
    switch (currentView) {
      case 'tactical':
        return (
          <div className="h-full flex overflow-hidden">
            {/* Left Sidebar - Node List */}
            <div className="w-80 flex-shrink-0 p-4 pr-2">
              <div className="h-full flex flex-col">
                <button
                  onClick={() => setShowWizard(true)}
                  className="btn-primary w-full mb-3 flex items-center justify-center gap-2 flex-shrink-0"
                >
                  <Plus size={16} />
                  Add Node
                </button>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <NodeListPanel />
                </div>
              </div>
            </div>

            {/* Center - Map */}
            <div className="flex-1 min-w-0 p-4 py-2">
              <TacticalMap />
            </div>

            {/* Right Sidebar - Node Details */}
            <div className="w-96 flex-shrink-0 p-4 pl-2">
              <NodeDetailPanel />
            </div>
          </div>
        );
      case 'fleet':
        return <FleetCommandView />;
      case 'isr':
        return <ISRConsoleView />;
      case 'comms':
        return <CommView />;
      case 'guardian':
        return <TrustGuardianView sentinelTrustStatus={sentinelTrustStatus} />;
      case 'mesh':
        return <MeshNetworkView />;
      case 'deployments':
        return <DeploymentManagementView />;
      case 'provisioning':
        return <RalphieNodeProvisioning />;
      case 'admin':
        return <SystemAdminView />;
      case 'settings':
        return <SettingsPanel />;
      default:
        return null;
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-carbon overflow-hidden relative">
      {/* Scanline Overlay */}
      <div className="scanline-overlay" />

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {sentinelTrustStatus && <SentinelTrustBanner status={sentinelTrustStatus} />}
        {/* TopBar - Fixed Height */}
        <div className="flex items-center gap-4 p-4 pb-2 flex-shrink-0">
          <NavigationMenu currentView={currentView} onViewChange={setCurrentView} />
          <div className="flex-1 min-w-0">
            <TopBar
              systemStatus="operational"
              verifiedNodes={verifiedCount}
              totalNodes={totalCount}
            />
          </div>
          <ConnectionStatusIndicator />
        </div>

        {/* Main Content - Dynamic Workspace with proper flex */}
        <div className="flex-1 min-h-0 overflow-hidden">{renderWorkspaceContent()}</div>

        {/* Floating Add Node Button (for non-tactical views) */}
        {currentView !== 'tactical' && (
          <button
            onClick={() => setShowWizard(true)}
            className="absolute bottom-6 right-6 btn-primary px-6 py-3 flex items-center gap-2 shadow-lg z-30"
          >
            <Plus size={20} />
            Add Node
          </button>
        )}
      </div>

      {/* Modals and Overlays */}
      {showWizard && <AddNodeWizard onClose={() => setShowWizard(false)} />}

      {/* Video Call Panel */}
      {activeCall && activeCall.status !== 'ended' && <VideoCallPanel call={activeCall} />}

      {/* Security Animations */}
      {byzantineAlert && (
        <div className="fixed inset-0 z-50">
          <AethericSweep
            websocketUrl={
              typeof window !== 'undefined' && '__TAURI__' in window
                ? `ws://localhost:8080/mesh-health`
                : '' // Disable WebSocket in web mode
            }
          />
          <button onClick={clearByzantineAlert} className="absolute top-4 right-4 btn-secondary">
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
