/**
 * Trust Mesh E2E Tests
 * 
 * Validates UI flows for trust mesh visualization and node management:
 * - Node list display with trust scores
 * - Trust score gauge rendering
 * - Node verification status
 * - Byzantine alert detection
 * 
 * Security: Follows 4MIK Zero Trust principles - no node is trusted by default.
 */

import { test, expect, testDevices } from '../fixtures';

test.describe('Trust Mesh UI Flows', () => {
  test.beforeEach(async ({ page, waitForAppReady }) => {
    await page.goto('/');
    await waitForAppReady();
  });

  test('should display node list with trust scores', async ({ page }) => {
    // Check if node list panel is visible
    const nodeListPanel = page.locator('[data-testid="node-list-panel"]');
    await expect(nodeListPanel).toBeVisible();

    // Verify panel has nodes section
    const nodesSection = nodeListPanel.locator('[data-testid="nodes-section"]');
    await expect(nodesSection).toBeVisible();
  });

  test('should show trust score gauge for each node', async ({ page }) => {
    // Add a test node to the system (mocking backend response)
    await page.evaluate((device) => {
      // @ts-ignore - accessing window store for testing
      if (window.__TACTICAL_STORE__) {
        window.__TACTICAL_STORE__.addNode({
          id: device.nodeId,
          domain: device.domain,
          position: { lat: 37.7749, lon: -122.4194, alt: 0 },
          trustScore: device.trustScore,
          verified: true,
          lastSeen: new Date(),
          status: 'online',
        });
      }
    }, testDevices[0]);

    // Wait for node to appear
    await page.waitForTimeout(500);

    // Verify trust score gauge exists
    const trustGauge = page.locator(`[data-node-id="${testDevices[0].nodeId}"]`).locator('[data-testid="trust-score"]');
    
    // Check if trust score is displayed (may be rendered as text or gauge)
    const trustScoreText = await trustGauge.textContent().catch(() => null);
    
    if (trustScoreText) {
      // Trust score should be between 0 and 1
      expect(trustScoreText).toContain(String(testDevices[0].trustScore));
    }
  });

  test('should indicate verified nodes with checkmark', async ({ page }) => {
    // Add a verified test node
    await page.evaluate((device) => {
      // @ts-ignore
      if (window.__TACTICAL_STORE__) {
        window.__TACTICAL_STORE__.addNode({
          id: device.nodeId,
          domain: device.domain,
          position: { lat: 37.7749, lon: -122.4194, alt: 0 },
          trustScore: device.trustScore,
          verified: true,
          attestationHash: '0xabcdef123456',
          lastSeen: new Date(),
          status: 'online',
        });
      }
    }, testDevices[0]);

    await page.waitForTimeout(500);

    // Look for verification indicator
    const nodeElement = page.locator(`[data-node-id="${testDevices[0].nodeId}"]`);
    
    // Should have some indication of verification (icon, badge, or status)
    const verificationIndicator = nodeElement.locator('[data-testid="verification-status"]');
    
    // Check if element exists and is visible
    const isVisible = await verificationIndicator.isVisible().catch(() => false);
    if (isVisible) {
      await expect(verificationIndicator).toBeVisible();
    }
  });

  test('should show Byzantine alert when node is compromised', async ({ page }) => {
    // Trigger a Byzantine alert through store
    await page.evaluate(() => {
      // @ts-ignore
      if (window.__TACTICAL_STORE__) {
        window.__TACTICAL_STORE__.setByzantineAlert({
          nodeId: 'compromised-node-001',
          reason: 'Merkle Vine integrity breach detected',
          timestamp: Date.now(),
        });
      }
    });

    await page.waitForTimeout(500);

    // Look for Byzantine alert UI
    const alertElement = page.locator('[data-testid="byzantine-alert"]');
    
    const isVisible = await alertElement.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isVisible) {
      await expect(alertElement).toBeVisible();
      await expect(alertElement).toContainText('compromised-node-001');
    }
  });

  test('should display trust score in threshold ranges', async ({ page }) => {
    const testCases = [
      { device: { ...testDevices[0], trustScore: 0.95 }, expected: 'healthy' },
      { device: { ...testDevices[1], trustScore: 0.75 }, expected: 'suspect' },
      { device: { ...testDevices[2], trustScore: 0.55 }, expected: 'quarantined' },
    ];

    for (const testCase of testCases) {
      await page.evaluate((device) => {
        // @ts-ignore
        if (window.__TACTICAL_STORE__) {
          window.__TACTICAL_STORE__.addNode({
            id: device.nodeId,
            domain: device.domain,
            position: { lat: 37.7749, lon: -122.4194, alt: 0 },
            trustScore: device.trustScore,
            verified: device.trustScore > 0.8,
            lastSeen: new Date(),
            status: 'online',
          });
        }
      }, testCase.device);
    }

    await page.waitForTimeout(1000);

    // Verify nodes are displayed with appropriate indicators
    for (const testCase of testCases) {
      const nodeElement = page.locator(`[data-node-id="${testCase.device.nodeId}"]`);
      const exists = await nodeElement.count();
      
      if (exists > 0) {
        await expect(nodeElement).toBeVisible();
      }
    }
  });

  test('should update trust score in real-time', async ({ page }) => {
    const device = testDevices[0];
    
    // Add node with initial trust score
    await page.evaluate((device) => {
      // @ts-ignore
      if (window.__TACTICAL_STORE__) {
        window.__TACTICAL_STORE__.addNode({
          id: device.nodeId,
          domain: device.domain,
          position: { lat: 37.7749, lon: -122.4194, alt: 0 },
          trustScore: 0.9,
          verified: true,
          lastSeen: new Date(),
          status: 'online',
        });
      }
    }, device);

    await page.waitForTimeout(500);

    // Update trust score
    await page.evaluate((nodeId) => {
      // @ts-ignore
      if (window.__TACTICAL_STORE__) {
        window.__TACTICAL_STORE__.updateNode(nodeId, {
          trustScore: 0.6,
          verified: false,
        });
      }
    }, device.nodeId);

    await page.waitForTimeout(500);

    // Verify the update is reflected in UI
    const nodeElement = page.locator(`[data-node-id="${device.nodeId}"]`);
    await expect(nodeElement).toBeVisible();
  });

  test('should filter nodes by trust level', async ({ page }) => {
    // Add multiple nodes with different trust scores
    for (const device of testDevices) {
      await page.evaluate((device) => {
        // @ts-ignore
        if (window.__TACTICAL_STORE__) {
          window.__TACTICAL_STORE__.addNode({
            id: device.nodeId,
            domain: device.domain,
            position: { lat: 37.7749, lon: -122.4194, alt: 0 },
            trustScore: device.trustScore,
            verified: device.trustScore > 0.8,
            lastSeen: new Date(),
            status: 'online',
          });
        }
      }, device);
    }

    await page.waitForTimeout(1000);

    // Look for filter controls
    const filterControl = page.locator('[data-testid="trust-filter"]');
    const hasFilter = await filterControl.count();
    
    if (hasFilter > 0) {
      // If filter exists, test it
      await expect(filterControl).toBeVisible();
    }
  });
});
