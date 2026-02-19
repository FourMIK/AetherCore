/**
 * Initialize communications context.
 *
 * This intentionally avoids synthetic operators so the UI reflects
 * only authenticated identities discovered from live C2 presence.
 */

import { useCommStore } from './useCommStore';

export const initializeComms = () => {
  const commStore = useCommStore.getState();

  // Seed only the local operator identity until presence data arrives.
  commStore.setCurrentOperator({
    id: 'operator-local',
    name: 'Local Operator',
    role: 'operator',
    callsign: 'LOCAL',
    status: 'online',
    verified: true,
    trustScore: 100,
    lastSeen: new Date(),
  });
};
