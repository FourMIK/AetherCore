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
  const [mobileTacticalPane, setMobileTacticalPane] = useState<'nodes' | 'map' | 'details'>('map');

  const verifiedCount = Array.from(nodes.values()).filter((n) => n.verified).length;
  const totalCount = nodes.size;

  const renderWorkspaceContent = () => {
    switch (currentView) {
      case 'tactical':
        return (
          <div className="h-full overflow-hidden">
            {/* Desktop / Large Tablet Tactical Layout */}
            <div className="hidden h-full lg:flex overflow-hidden">
              {/* Left Sidebar - Node List */}
              <div className="w-72 xl:w-80 flex-shrink-0 p-4 pr-2">
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
              <div className="w-80 xl:w-96 flex-shrink-0 p-4 pl-2">
                <NodeDetailPanel />
              </div>
            </div>

            {/* Mobile Tactical Layout */}
            <div className="h-full flex flex-col overflow-hidden lg:hidden">
              <div className="px-4 pt-3 flex-shrink-0">
                <button
                  onClick={() => setShowWizard(true)}
                  className="btn-primary w-full mb-3 flex items-center justify-center gap-2"
                >
                  <Plus size={16} />
                  Add Node
                </button>
                <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Tactical panes">
                  <button
                    onClick={() => setMobileTacticalPane('nodes')}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      mobileTacticalPane === 'nodes'
                        ? 'bg-overmatch/20 text-overmatch border border-overmatch/40'
                        : 'bg-carbon/50 text-tungsten/70 border border-tungsten/20 hover:bg-tungsten/10'
                    }`}
                    role="tab"
                    aria-selected={mobileTacticalPane === 'nodes'}
                  >
                    Nodes
                  </button>
                  <button
                    onClick={() => setMobileTacticalPane('map')}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      mobileTacticalPane === 'map'
                        ? 'bg-overmatch/20 text-overmatch border border-overmatch/40'
                        : 'bg-carbon/50 text-tungsten/70 border border-tungsten/20 hover:bg-tungsten/10'
                    }`}
                    role="tab"
                    aria-selected={mobileTacticalPane === 'map'}
                  >
                    Map
                  </button>
                  <button
                    onClick={() => setMobileTacticalPane('details')}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      mobileTacticalPane === 'details'
                        ? 'bg-overmatch/20 text-overmatch border border-overmatch/40'
                        : 'bg-carbon/50 text-tungsten/70 border border-tungsten/20 hover:bg-tungsten/10'
                    }`}
                    role="tab"
                    aria-selected={mobileTacticalPane === 'details'}
                  >
                    Details
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 p-4 pt-3">
                {mobileTacticalPane === 'nodes' && <NodeListPanel />}
                {mobileTacticalPane === 'map' && (
                  <div className="h-full min-h-[18rem]">
                    <TacticalMap />
                  </div>
                )}
                {mobileTacticalPane === 'details' && <NodeDetailPanel />}
              </div>
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
        return <TrustGuardianView />;
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
        {sentinelTrustStatus?.reduced_trust && (
          <SentinelTrustBanner status={sentinelTrustStatus} />
        )}
        {/* TopBar - Fixed Height */}
        <div className="flex flex-wrap items-center gap-3 p-4 pb-2 flex-shrink-0">
          <div className="flex-shrink-0">
            <NavigationMenu currentView={currentView} onViewChange={setCurrentView} />
          </div>
          <div className="order-3 w-full min-w-0 xl:order-none xl:w-auto xl:flex-1">
            <TopBar
              systemStatus="operational"
              verifiedNodes={verifiedCount}
              totalNodes={totalCount}
            />
          </div>
          <div className="ml-auto flex-shrink-0 xl:ml-0">
            <ConnectionStatusIndicator />
          </div>
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
