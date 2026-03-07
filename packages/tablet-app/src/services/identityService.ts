/**
 * Identity Service
 * Manages device identity for the tablet app
 * Simulates hardware-backed key generation
 */

import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system';
import { v4 as uuidv4 } from 'uuid';

export interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
  nodeId: string;
  publicKey: string;
  isHardwareBacked: boolean;
  timestamp: number;
}

let cachedIdentity: DeviceIdentity | null = null;
const IDENTITY_PATH = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}aethercore_device_identity.json`
  : null;

async function tryLoadIdentity(): Promise<DeviceIdentity | null> {
  if (IDENTITY_PATH === null) {
    return null;
  }

  const info = await FileSystem.getInfoAsync(IDENTITY_PATH);
  if (!info.exists) {
    return null;
  }

  const raw = await FileSystem.readAsStringAsync(IDENTITY_PATH);
  const parsed = JSON.parse(raw) as Partial<DeviceIdentity>;

  if (!parsed.deviceId || !parsed.nodeId || !parsed.publicKey) {
    throw new Error('Persisted identity is missing required fields');
  }

  return parsed as DeviceIdentity;
}

async function persistIdentity(identity: DeviceIdentity): Promise<void> {
  if (IDENTITY_PATH === null) {
    return;
  }

  await FileSystem.writeAsStringAsync(IDENTITY_PATH, JSON.stringify(identity), {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

/**
 * Initialize device identity
 * In production, this would use TPM or Secure Enclave
 * For now, we'll use device characteristics as pseudo-unique identifier
 */
export async function initializeIdentity(): Promise<DeviceIdentity> {
  if (cachedIdentity) {
    return cachedIdentity;
  }

  try {
    const persisted = await tryLoadIdentity();
    if (persisted) {
      cachedIdentity = persisted;
      return persisted;
    }

    // Get device info
    const deviceName = Device.deviceName || 'Unknown Device';
    const deviceId = uuidv4();

    // Generate a mock node ID and keys
    const nodeId = `node-${deviceId.slice(0, 8)}`;
    const publicKey = `0x${uuidv4().replace(/-/g, '')}${uuidv4().replace(/-/g, '')}`;

    // Check if device has hardware security (mock - in reality would check KEYMINTversion, StrongBox, etc.)
    const isHardwareBacked = Device.brand !== null && Device.brand !== 'unknown';

    cachedIdentity = {
      deviceId,
      deviceName,
      nodeId,
      publicKey,
      isHardwareBacked,
      timestamp: Date.now(),
    };

    await persistIdentity(cachedIdentity);
    console.log('Device identity initialized:', cachedIdentity);
    return cachedIdentity;
  } catch (error) {
    console.error('Failed to initialize identity:', error);
    throw error;
  }
}

/**
 * Get cached device identity
 */
export function getDeviceIdentity(): DeviceIdentity {
  if (!cachedIdentity) {
    throw new Error('Device identity not initialized');
  }
  return cachedIdentity;
}

/**
 * Reset device identity (for testing)
 */
export function resetDeviceIdentity(): void {
  cachedIdentity = null;
}

/**
 * Get device brand and model info
 */
export function getDeviceInfo(): {
  brand: string;
  model: string;
  osVersion: string;
  isTablet: boolean;
} {
  return {
    brand: Device.brand || 'Unknown',
    model: Device.modelName || 'Unknown',
    osVersion: Device.osVersion || 'Unknown',
    isTablet: Device.deviceType === Device.DeviceType.TABLET,
  };
}

