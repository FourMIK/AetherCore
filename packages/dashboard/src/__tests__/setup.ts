/**
 * Vitest test setup for AetherCore Tactical Glass Desktop
 *
 * Mocks the Tauri API for testing TypeScript/Rust FFI boundary
 */

import { beforeEach, vi } from "vitest";

type MockTauriInvoke = ReturnType<typeof vi.fn>;

declare global {
  // eslint-disable-next-line no-var
  var mockTauriInvoke: MockTauriInvoke;
}

// Mock Tauri's invoke function
const mockInvoke: MockTauriInvoke = vi.fn();

// Mock @tauri-apps/api/core module
vi.mock("@tauri-apps/api/core", () => ({
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
