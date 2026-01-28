/**
 * AetherCore Shared Utilities
 */

export class Logger {
  log(message: string): void {
    console.log(`[AetherCore] ${message}`);
  }
}

export const utils = {
  Logger,
};

export default utils;

/**
 * Mission Guardian Protocol Types
 */
export * from './types/guardian';

/**
 * Identity Protocol - Cross-Platform Node Identity
 */
export * from './identity';

/**
 * Protocol - Canonical implementations for cross-platform verification
 */
export * from './protocol';
