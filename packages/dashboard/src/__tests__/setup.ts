/**
 * Vitest test setup for AetherCore Tactical Glass Desktop
 * 
 * Mocks the Tauri API for testing TypeScript/Rust FFI boundary
 */

import { vi } from 'vitest';

// Mock Tauri's invoke function
const mockInvoke = vi.fn();

// Mock @tauri-apps/api/core module
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

// Export mock for test access
export { mockInvoke };

// Global test utilities
globalThis.mockTauriInvoke = mockInvoke;

// Reset mocks before each test
beforeEach(() => {
  mockInvoke.mockClear();
});
