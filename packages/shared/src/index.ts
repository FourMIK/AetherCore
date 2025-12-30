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
