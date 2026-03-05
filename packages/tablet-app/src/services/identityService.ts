/**
 * Identity Service
 * Manages device identity for the tablet app
 * Simulates hardware-backed key generation
 */

import * as Device from 'expo-device';
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
    // Get device info
    const deviceName = Device.deviceName || 'Unknown Device';
    const deviceId = Device.deviceId || 'device-' + uuidv4();

    // Generate a mock node ID and keys
    const nodeId = `node-${deviceId.slice(0, 8)}`;
    const publicKey = `0x${Math.random().toString(16).slice(2).padEnd(64, '0')}`;

    // Check if device has hardware security (mock - in reality would check KEYMINTversion, StrongBox, etc.)
    const isHardwareBacked = Device.brand !== 'unknown';

    cachedIdentity = {
      deviceId,
      deviceName,
      nodeId,
      publicKey,
      isHardwareBacked,
      timestamp: Date.now(),
    };

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

