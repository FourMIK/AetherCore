/**
 * Initialize communications
 * Sets up sample operators for testing
 */

import { useCommStore } from './useCommStore';

export const initializeComms = () => {
  const commStore = useCommStore.getState();
  
  // Add current operator
  commStore.setCurrentOperator({
    id: 'operator-local',
    name: 'Operator Prime',
    role: 'operator',
    callsign: 'OP-1',
    status: 'online',
    verified: true,
    trustScore: 100,
    lastSeen: new Date(),
  });

  // Add sample operators
  const sampleOperators = [
    {
      id: 'cmd-001',
      name: 'Commander Atlas',
      role: 'commander' as const,
      callsign: 'CMD-ATLAS',
      status: 'online' as const,
      verified: true,
      trustScore: 98,
      lastSeen: new Date(),
    },
    {
      id: 'op-002',
      name: 'Operator Bravo',
      role: 'operator' as const,
      callsign: 'OP-2',
      status: 'online' as const,
      verified: true,
      trustScore: 92,
      lastSeen: new Date(),
    },
    {
      id: 'op-003',
      name: 'Operator Charlie',
      role: 'operator' as const,
      callsign: 'OP-3',
      status: 'away' as const,
      verified: true,
      trustScore: 88,
      lastSeen: new Date(Date.now() - 300000),
    },
    {
      id: 'admin-001',
      name: 'Admin Nexus',
      role: 'admin' as const,
      callsign: 'ADM-NEX',
      status: 'online' as const,
      verified: true,
      trustScore: 100,
      lastSeen: new Date(),
    },
  ];

  sampleOperators.forEach(op => commStore.addOperator(op));
};
