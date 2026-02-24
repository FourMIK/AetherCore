/**
 * Initialize communications context.
 *
 * This intentionally avoids synthetic operators so the UI reflects
 * only authenticated identities discovered from live C2 presence.
 */

import { useCommStore } from './useCommStore';

export const initializeComms = () => {
  const commStore = useCommStore.getState();
  const idKey = 'aethercore.operator.id';
  const callsignKey = 'aethercore.operator.callsign';
  const nameKey = 'aethercore.operator.name';
  const roleKey = 'aethercore.operator.role';

  const getStoredValue = (key: string): string | null => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const setStoredValue = (key: string, value: string): void => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Ignore localStorage write failures.
    }
  };

  let operatorId = getStoredValue(idKey);
  if (!operatorId) {
    const suffix = crypto.randomUUID().slice(0, 8);
    operatorId = `operator-${suffix}`;
    setStoredValue(idKey, operatorId);
  }

  let callsign = getStoredValue(callsignKey);
  if (!callsign) {
    const suffix = operatorId.split('-').pop() || 'local';
    callsign = `OP-${suffix.toUpperCase()}`;
    setStoredValue(callsignKey, callsign);
  }

  const displayName = getStoredValue(nameKey) || 'Local Operator';
  const roleRaw = getStoredValue(roleKey);
  const role = roleRaw === 'admin' || roleRaw === 'commander' ? roleRaw : 'operator';

  // Seed only the local operator identity until presence data arrives.
  commStore.setCurrentOperator({
    id: operatorId,
    name: displayName,
    role,
    callsign,
    status: 'online',
    verified: true,
    trustScore: 100,
    lastSeen: new Date(),
  });
};
