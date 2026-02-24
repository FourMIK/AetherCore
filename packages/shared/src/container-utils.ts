/**
 * Container Detection Utilities
 * 
 * Provides cross-service utilities for detecting containerized environments
 * and determining appropriate endpoint defaults.
 */

import fs from 'fs';

/**
 * Detect if the process is running in a container environment.
 * 
 * Checks for:
 * - RUNNING_IN_CONTAINER=true environment variable
 * - CONTAINER=true environment variable
 * - /.dockerenv file (standard Docker marker)
 * 
 * @returns true if running in a container, false otherwise
 */
export function isRunningInContainer(): boolean {
  return (
    process.env.RUNNING_IN_CONTAINER === 'true' ||
    process.env.CONTAINER === 'true' ||
    fs.existsSync('/.dockerenv')
  );
}

/**
 * Get the default C2/Backend endpoint based on the current environment.
 * 
 * In containerized environments, defaults to service DNS name for Docker Compose.
 * Outside containers, defaults to localhost for local development.
 * 
 * @param serviceName - The Docker service name (default: 'c2-router')
 * @param port - The service port (default: 50051)
 * @returns The appropriate endpoint string
 */
export function getDefaultC2Endpoint(serviceName = 'c2-router', port = 50051): string {
  return isRunningInContainer()
    ? `${serviceName}:${port}`
    : `localhost:${port}`;
}

/**
 * Check if a target endpoint is a localhost target.
 * 
 * @param target - The endpoint target to check
 * @returns true if the target is localhost, 127.0.0.1, or [::1]
 */
export function isLocalhostTarget(target: string): boolean {
  const normalized = target.trim().toLowerCase();
  return (
    normalized.startsWith('localhost:') ||
    normalized.startsWith('127.0.0.1:') ||
    normalized.startsWith('[::1]:')
  );
}
