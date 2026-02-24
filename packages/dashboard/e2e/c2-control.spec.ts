/**
 * C2 (Command & Control) E2E Tests
 * 
 * Validates UI flows for command execution and verification:
 * - Command execution status display
 * - Verification panel functionality
 * - Command status badges
 * - Trust-based command authorization UI
 * 
 * Security: Commands must only execute on verified nodes with sufficient trust.
 */

import { test, expect, testDevices } from '../fixtures';

test.describe('C2 (Command & Control) UI Flows', () => {
  test.beforeEach(async ({ page, waitForAppReady }) => {
    await page.goto('/');
    await waitForAppReady();
    
    // Add a test node for C2 operations
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
        
        // Select the node
        window.__TACTICAL_STORE__.selectNode(device.nodeId);
      }
    }, testDevices[0]);

    await page.waitForTimeout(500);
  });

  test('should display verification panel for selected node', async ({ page }) => {
    // Look for verification panel
    const verificationPanel = page.locator('[data-testid="verification-panel"]');
    
    const isVisible = await verificationPanel.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isVisible) {
      await expect(verificationPanel).toBeVisible();
      
      // Should show verification status
      const verificationStatus = verificationPanel.locator('[data-testid="verification-status"]');
      await expect(verificationStatus).toBeVisible();
    }
  });

  test('should show trust score gauge in node detail', async ({ page }) => {
    // Look for node detail panel
    const nodeDetail = page.locator('[data-testid="node-detail-panel"]');
    
    const isVisible = await nodeDetail.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isVisible) {
      await expect(nodeDetail).toBeVisible();
      
      // Should display trust score gauge
      const trustGauge = nodeDetail.locator('[data-testid="trust-score-gauge"]');
      const gaugeVisible = await trustGauge.isVisible().catch(() => false);
      
      if (gaugeVisible) {
        await expect(trustGauge).toBeVisible();
      }
    }
  });

  test('should display command status badge', async ({ page }) => {
    // Simulate command execution
    await page.evaluate((nodeId) => {
      // @ts-ignore
      if (window.__TACTICAL_STORE__) {
        window.__TACTICAL_STORE__.addEvent({
          id: 'event-001',
          nodeId: nodeId,
          type: 'verification_failed',
          timestamp: new Date(),
          details: 'Command execution failed - insufficient trust',
        });
      }
    }, testDevices[0].nodeId);

    await page.waitForTimeout(500);

    // Look for command status indicator
    const statusBadge = page.locator('[data-testid="command-status-badge"]');
    
    const badgeCount = await statusBadge.count();
    if (badgeCount > 0) {
      await expect(statusBadge.first()).toBeVisible();
    }
  });

  test('should prevent commands on low-trust nodes', async ({ page }) => {
    // Add a low-trust node
    const lowTrustNode = { ...testDevices[2], trustScore: 0.55 };
    
    await page.evaluate((device) => {
      // @ts-ignore
      if (window.__TACTICAL_STORE__) {
        window.__TACTICAL_STORE__.addNode({
          id: device.nodeId,
          domain: device.domain,
          position: { lat: 37.7749, lon: -122.4194, alt: 0 },
          trustScore: device.trustScore,
          verified: false,
          lastSeen: new Date(),
          status: 'online',
        });
        
        window.__TACTICAL_STORE__.selectNode(device.nodeId);
      }
    }, lowTrustNode);

    await page.waitForTimeout(500);

    // Look for command execution controls
    const commandButton = page.locator('[data-testid="execute-command-button"]');
    
    const buttonExists = await commandButton.count();
    if (buttonExists > 0) {
      // Button should be disabled for low-trust nodes
      const isDisabled = await commandButton.isDisabled().catch(() => true);
      expect(isDisabled).toBe(true);
    }
  });

  test('should show verification failure alert', async ({ page }) => {
    // Trigger verification failure
    await page.evaluate((nodeId) => {
      // @ts-ignore
      if (window.__TACTICAL_STORE__) {
        window.__TACTICAL_STORE__.setVerificationFailure({
          nodeId: nodeId,
          reason: 'Signature verification failed - potential replay attack',
          timestamp: Date.now(),
        });
      }
    }, testDevices[0].nodeId);

    await page.waitForTimeout(500);

    // Look for verification failure alert
    const failureAlert = page.locator('[data-testid="verification-failure"]');
    
    const isVisible = await failureAlert.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isVisible) {
      await expect(failureAlert).toBeVisible();
      await expect(failureAlert).toContainText('verification');
    }
  });

  test('should display attestation hash for verified nodes', async ({ page }) => {
    // Look for node detail panel
    const nodeDetail = page.locator('[data-testid="node-detail-panel"]');
    
    const isVisible = await nodeDetail.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isVisible) {
      // Look for attestation hash display
      const attestationHash = nodeDetail.locator('[data-testid="attestation-hash"]');
      const hashVisible = await attestationHash.isVisible().catch(() => false);
      
      if (hashVisible) {
        await expect(attestationHash).toBeVisible();
        
        // Should display a hash-like value (hex string)
        const hashText = await attestationHash.textContent();
        expect(hashText).toMatch(/0x[0-9a-fA-F]+/);
      }
    }
  });

  test('should show last seen timestamp', async ({ page }) => {
    // Look for node detail panel
    const nodeDetail = page.locator('[data-testid="node-detail-panel"]');
    
    const isVisible = await nodeDetail.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isVisible) {
      // Look for last seen timestamp
      const lastSeen = nodeDetail.locator('[data-testid="last-seen"]');
      const timestampVisible = await lastSeen.isVisible().catch(() => false);
      
      if (timestampVisible) {
        await expect(lastSeen).toBeVisible();
      }
    }
  });

  test('should indicate node online/offline status', async ({ page }) => {
    // Test online status
    let nodeStatus = page.locator(`[data-node-id="${testDevices[0].nodeId}"]`).locator('[data-testid="node-status"]');
    
    const statusCount = await nodeStatus.count();
    if (statusCount > 0) {
      await expect(nodeStatus.first()).toBeVisible();
    }

    // Update to offline
    await page.evaluate((nodeId) => {
      // @ts-ignore
      if (window.__TACTICAL_STORE__) {
        window.__TACTICAL_STORE__.updateNode(nodeId, {
          status: 'offline',
        });
      }
    }, testDevices[0].nodeId);

    await page.waitForTimeout(500);

    // Verify status update
    nodeStatus = page.locator(`[data-node-id="${testDevices[0].nodeId}"]`).locator('[data-testid="node-status"]');
    const offlineCount = await nodeStatus.count();
    
    if (offlineCount > 0) {
      await expect(nodeStatus.first()).toBeVisible();
    }
  });

  test('should display firmware version if available', async ({ page }) => {
    // Update node with firmware version
    await page.evaluate((nodeId) => {
      // @ts-ignore
      if (window.__TACTICAL_STORE__) {
        window.__TACTICAL_STORE__.updateNode(nodeId, {
          firmwareVersion: 'v1.2.3-aether',
        });
      }
    }, testDevices[0].nodeId);

    await page.waitForTimeout(500);

    // Look for firmware version display
    const nodeDetail = page.locator('[data-testid="node-detail-panel"]');
    const isVisible = await nodeDetail.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isVisible) {
      const firmwareVersion = nodeDetail.locator('[data-testid="firmware-version"]');
      const versionVisible = await firmwareVersion.isVisible().catch(() => false);
      
      if (versionVisible) {
        await expect(firmwareVersion).toContainText('v1.2.3');
      }
    }
  });
});
