/**
 * NavigationMenu
 * Main navigation for switching between dashboard workspaces
 */

import React from 'react';
import {
  Map,
  Users,
  Radio,
  Eye,
  Shield,
  Database,
  Settings,
  ChevronDown,
  Zap
} from 'lucide-react';
import { GlassPanel } from './GlassPanel';

export type WorkspaceView = 'tactical' | 'fleet' | 'isr' | 'comms' | 'guardian' | 'mesh' | 'admin' | 'deployments' | 'provisioning';

interface NavigationMenuProps {
  currentView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
}

const workspaceItems = [
  {
    id: 'tactical' as WorkspaceView,
    label: 'Tactical Map',
    icon: Map,
    description: 'Real-time node positioning and mesh visualization'
  },
  {
    id: 'fleet' as WorkspaceView,
    label: 'Fleet Command',
    icon: Users,
    description: 'Fleet-wide operations and unit management'
  },
  {
    id: 'isr' as WorkspaceView,
    label: 'ISR Console',
    icon: Eye,
    description: 'Intelligence, Surveillance, Reconnaissance'
  },
  {
    id: 'comms' as WorkspaceView,
    label: 'Communications',
    icon: Radio,
    description: 'Secure messaging and video conferencing'
  },
  {
    id: 'guardian' as WorkspaceView,
    label: 'Trust Guardian',
    icon: Shield,
    description: 'Identity verification and trust mesh monitoring'
  },
  {
    id: 'mesh' as WorkspaceView,
    label: 'Mesh Network',
    icon: Radio,
    description: 'Network topology and radio frequency management'
  },
  {
    id: 'deployments' as WorkspaceView,
    label: 'Deployments',
    icon: Database,
    description: 'Local node process deployment and management'
  },
  {
    id: 'provisioning' as WorkspaceView,
    label: 'RalphieNode Provisioning',
    icon: Zap,
    description: 'Zero-Touch Enrollment for Arduino Satellite devices'
  },
  {
    id: 'admin' as WorkspaceView,
    label: 'System Admin',
    icon: Settings,
    description: 'Configuration and system management'
  },
];

export const NavigationMenu: React.FC<NavigationMenuProps> = ({ currentView, onViewChange }) => {
  const [isOpen, setIsOpen] = React.useState(false);

  const currentItem = workspaceItems.find(item => item.id === currentView);
  const CurrentIcon = currentItem?.icon || Map;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-tungsten/10 hover:bg-tungsten/20 border border-tungsten/20 rounded-lg transition-colors"
      >
        <CurrentIcon size={18} className="text-overmatch" />
        <span className="font-display font-semibold text-tungsten">
          {currentItem?.label}
        </span>
        <ChevronDown
          size={16}
          className={`text-tungsten/70 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <GlassPanel
            variant="heavy"
            className="absolute top-full left-0 mt-2 w-80 z-50"
          >
            <div className="p-2">
              {workspaceItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === currentView;

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onViewChange(item.id);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-start gap-3 p-3 rounded-lg transition-colors text-left ${isActive
                        ? 'bg-overmatch/20 border border-overmatch/30'
                        : 'hover:bg-tungsten/10 border border-transparent'
                      }`}
                  >
                    <Icon
                      size={20}
                      className={isActive ? 'text-overmatch' : 'text-tungsten/70'}
                    />
                    <div className="flex-1 min-w-0">
                      <div className={`font-display font-semibold text-sm ${isActive ? 'text-overmatch' : 'text-tungsten'
                        }`}>
                        {item.label}
                      </div>
                      <div className="text-xs text-tungsten/50 mt-0.5">
                        {item.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </GlassPanel>
        </>
      )}
    </div>
  );
};
