/**
 * E2E Test Fixtures for AetherCore Tactical Glass
 * 
 * Provides common utilities and test data for E2E test suite.
 * Follows 4MIK architectural invariants:
 * - No mocks for security-critical flows
 * - BLAKE3 for hashing validation
 * - Ed25519 signature verification
 */

import { test as base, expect } from '@playwright/test';

/**
 * Mock test device for enrollment flows
 */
export interface TestDevice {
  nodeId: string;
  domain: string;
  trustScore: number;
  publicKey: string;
}

/**
 * Test data fixtures
 */
export const testDevices: TestDevice[] = [
  {
    nodeId: 'node-alpha-001',
    domain: 'squad-recon',
    trustScore: 0.95,
    publicKey: '0x1234567890abcdef',
  },
  {
    nodeId: 'node-bravo-002',
    domain: 'squad-intel',
    trustScore: 0.85,
    publicKey: '0xabcdef1234567890',
  },
  {
    nodeId: 'node-charlie-003',
    domain: 'squad-ops',
    trustScore: 0.75,
    publicKey: '0xfedcba0987654321',
  },
];

/**
 * Test endpoints
 */
export const testEndpoints = {
  testnet: 'wss://testnet.aethercore.local:8443',
  localTestnet: 'ws://localhost:8080',
};

/**
 * Extended test fixture with Tactical Glass utilities
 */
type TacticalGlassFixtures = {
  // Utility to wait for app initialization
  waitForAppReady: () => Promise<void>;
  
  // Utility to verify node in list
  verifyNodeInList: (nodeId: string) => Promise<void>;
  
  // Utility to get trust score element
  getTrustScoreGauge: (nodeId: string) => Promise<any>;
};

export const test = base.extend<TacticalGlassFixtures>({
  /**
   * Wait for the Tactical Glass app to be fully initialized
   */
  waitForAppReady: async ({ page }, use) => {
    await use(async () => {
      // Wait for main layout to be visible
      await page.waitForSelector('[class*="DashboardLayout"]', { 
        timeout: 30000 
      });
      
      // Wait for initial data load
      await page.waitForTimeout(1000);
    });
  },
  
  /**
   * Verify a node appears in the node list
   */
  verifyNodeInList: async ({ page }, use) => {
    await use(async (nodeId: string) => {
      const nodeElement = page.locator(`[data-node-id="${nodeId}"]`);
      await expect(nodeElement).toBeVisible({ timeout: 10000 });
    });
  },
  
  /**
   * Get trust score gauge element for a node
   */
  getTrustScoreGauge: async ({ page }, use) => {
    await use(async (nodeId: string) => {
      return page.locator(`[data-node-id="${nodeId}"] [data-testid="trust-score-gauge"]`);
    });
  },
});

export { expect };
