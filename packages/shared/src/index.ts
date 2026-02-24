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
 * Container Detection Utilities
 */
export * from './container-utils';

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

/**
 * C2 Message Schema - Command & Control Message Envelope
 */
export * from './c2-message-schema';
