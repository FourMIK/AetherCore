/**
 * NavigationMenu
 * Main navigation for switching between dashboard workspaces
 * 
 * PHASE 5: Tactical Notifications
 * - Displays notification badges on Communications workspace
 * - Fail-Visible: Cyan/Green for verified traffic, Red/Amber for EW/spoofing
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
  Zap,
  AlertTriangle,
} from 'lucide-react';
import { GlassPanel } from './GlassPanel';
import { useCommStore } from '../../store/useCommStore';

export type WorkspaceView = 'tactical' | 'fleet' | 'isr' | 'comms' | 'guardian' | 'mesh' | 'admin' | 'deployments' | 'provisioning' | 'settings';

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
    icon: Database,
    description: 'System diagnostics and administrative tools'
  },
  {
    id: 'settings' as WorkspaceView,
    label: 'Settings',
    icon: Settings,
    description: 'Application configuration and security settings'
  },
];

/**
 * CommNotificationBadge - Fail-Visible notification indicator
 * 
 * Displays:
 * - Cyan/Green pulsing indicator for verified unread messages
 * - Red/Amber glitching triangle for unverified intercepts (active EW attack)
 */
const CommNotificationBadge: React.FC = () => {
  const unreadCount = useCommStore((state) => state.getTotalUnreadCount());
  const unverifiedIntercepts = useCommStore((state) => state.getUnverifiedInterceptsCount());

  // FAIL-VISIBLE: Unverified intercepts override standard notifications
  if (unverifiedIntercepts > 0) {
    return (
      <div className="absolute -top-1 -right-1 flex items-center justify-center">
        {/* Glitching background animation */}
        <div className="absolute inset-0 animate-pulse bg-jamming/60 rounded-full blur-sm" />
        <div className="relative flex items-center justify-center w-5 h-5 bg-jamming rounded-full border-2 border-carbon shadow-lg">
          <AlertTriangle size={12} className="text-white animate-pulse" />
        </div>
      </div>
    );
  }

  // Verified unread messages
  if (unreadCount > 0) {
    return (
      <div className="absolute -top-1 -right-1 flex items-center justify-center">
        {/* Pulsing glow */}
        <div className="absolute inset-0 animate-pulse bg-verified-green/40 rounded-full blur-sm" />
        <div className="relative flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-verified-green rounded-full border-2 border-carbon text-[10px] font-bold text-carbon">
          {unreadCount > 99 ? '99+' : unreadCount}
        </div>
      </div>
    );
  }

  return null;
};

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
                    <div className="relative">
                      <Icon
                        size={20}
                        className={isActive ? 'text-overmatch' : 'text-tungsten/70'}
                      />
                      {/* PHASE 5: Show notification badge on Communications workspace */}
                      {item.id === 'comms' && <CommNotificationBadge />}
                    </div>
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
