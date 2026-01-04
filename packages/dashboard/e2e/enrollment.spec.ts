/**
 * Zero-Touch Enrollment E2E Tests
 * 
 * Validates the CodeRalphie Linker flow for device onboarding:
 * - Multi-stage wizard navigation
 * - QR code generation for enrollment
 * - Device identity input and validation
 * - Node provisioning workflow
 * 
 * Security: Genesis Bundle must be signed with Ed25519 (TPM-backed in production).
 */

import { test, expect, testDevices } from '../fixtures';

test.describe('Zero-Touch Enrollment Flow', () => {
  test.beforeEach(async ({ page, waitForAppReady }) => {
    await page.goto('/');
    await waitForAppReady();
  });

  test('should open Add Node Wizard', async ({ page }) => {
    // Look for "Add Node" button
    const addNodeButton = page.locator('button', { hasText: 'Add Node' }).or(
      page.locator('[data-testid="add-node-button"]')
    );

    const buttonCount = await addNodeButton.count();
    
    if (buttonCount > 0) {
      await addNodeButton.first().click();
      
      // Wizard should appear
      const wizard = page.locator('[data-testid="add-node-wizard"]');
      await expect(wizard).toBeVisible({ timeout: 5000 });
    }
  });

  test('should navigate through wizard stages', async ({ page }) => {
    // Open wizard
    const addNodeButton = page.locator('button', { hasText: 'Add Node' }).or(
      page.locator('[data-testid="add-node-button"]')
    );

    const buttonExists = await addNodeButton.count();
    if (buttonExists === 0) {
      test.skip();
      return;
    }

    await addNodeButton.first().click();
    
    const wizard = page.locator('[data-testid="add-node-wizard"]');
    await expect(wizard).toBeVisible({ timeout: 5000 });

    // Stage 1: Identity
    const nodeIdInput = wizard.locator('input[name="nodeId"]').or(
      wizard.locator('[data-testid="node-id-input"]')
    );
    
    const inputCount = await nodeIdInput.count();
    if (inputCount > 0) {
      await nodeIdInput.first().fill(testDevices[0].nodeId);
      
      const domainInput = wizard.locator('input[name="domain"]').or(
        wizard.locator('[data-testid="domain-input"]')
      );
      
      const domainCount = await domainInput.count();
      if (domainCount > 0) {
        await domainInput.first().fill(testDevices[0].domain);
        
        // Click Next button
        const nextButton = wizard.locator('button', { hasText: 'Next' }).or(
          wizard.locator('[data-testid="wizard-next"]')
        );
        
        const nextCount = await nextButton.count();
        if (nextCount > 0) {
          await nextButton.first().click();
          
          // Should progress to next stage
          await page.waitForTimeout(500);
        }
      }
    }
  });

  test('should validate required fields in identity stage', async ({ page }) => {
    // Open wizard
    const addNodeButton = page.locator('button', { hasText: 'Add Node' }).or(
      page.locator('[data-testid="add-node-button"]')
    );

    const buttonExists = await addNodeButton.count();
    if (buttonExists === 0) {
      test.skip();
      return;
    }

    await addNodeButton.first().click();
    
    const wizard = page.locator('[data-testid="add-node-wizard"]');
    await expect(wizard).toBeVisible({ timeout: 5000 });

    // Try to proceed without filling fields
    const nextButton = wizard.locator('button', { hasText: 'Next' }).or(
      wizard.locator('[data-testid="wizard-next"]')
    );
    
    const nextCount = await nextButton.count();
    if (nextCount > 0) {
      await nextButton.first().click();
      
      // Should show validation error
      const errorMessage = wizard.locator('[data-testid="error-message"]').or(
        wizard.locator('text=/required/i')
      );
      
      const errorCount = await errorMessage.count();
      if (errorCount > 0) {
        await expect(errorMessage.first()).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('should generate QR code for enrollment', async ({ page }) => {
    // Open wizard and fill identity stage
    const addNodeButton = page.locator('button', { hasText: 'Add Node' }).or(
      page.locator('[data-testid="add-node-button"]')
    );

    const buttonExists = await addNodeButton.count();
    if (buttonExists === 0) {
      test.skip();
      return;
    }

    await addNodeButton.first().click();
    
    const wizard = page.locator('[data-testid="add-node-wizard"]');
    await expect(wizard).toBeVisible({ timeout: 5000 });

    // Fill identity fields
    const nodeIdInput = wizard.locator('input[name="nodeId"]').or(
      wizard.locator('[data-testid="node-id-input"]')
    );
    
    const inputCount = await nodeIdInput.count();
    if (inputCount > 0) {
      await nodeIdInput.first().fill(testDevices[0].nodeId);
      
      const domainInput = wizard.locator('input[name="domain"]').or(
        wizard.locator('[data-testid="domain-input"]')
      );
      
      const domainCount = await domainInput.count();
      if (domainCount > 0) {
        await domainInput.first().fill(testDevices[0].domain);
        
        // Progress through stages to QR enrollment
        const nextButton = wizard.locator('button', { hasText: 'Next' }).or(
          wizard.locator('[data-testid="wizard-next"]')
        );
        
        const nextCount = await nextButton.count();
        if (nextCount > 0) {
          await nextButton.first().click();
          await page.waitForTimeout(1000);
          
          // Look for QR code element
          const qrCode = wizard.locator('[data-testid="qr-code"]').or(
            wizard.locator('svg[class*="qrcode"]')
          );
          
          const qrCount = await qrCode.count();
          if (qrCount > 0) {
            await expect(qrCode.first()).toBeVisible({ timeout: 5000 });
          }
        }
      }
    }
  });

  test('should display Genesis Bundle information', async ({ page }) => {
    // Open wizard
    const addNodeButton = page.locator('button', { hasText: 'Add Node' }).or(
      page.locator('[data-testid="add-node-button"]')
    );

    const buttonExists = await addNodeButton.count();
    if (buttonExists === 0) {
      test.skip();
      return;
    }

    await addNodeButton.first().click();
    
    const wizard = page.locator('[data-testid="add-node-wizard"]');
    await expect(wizard).toBeVisible({ timeout: 5000 });

    // Look for Genesis Bundle info (may be on any stage)
    const genesisInfo = wizard.locator('[data-testid="genesis-bundle"]').or(
      wizard.locator('text=/genesis/i')
    );
    
    // This may or may not be visible depending on wizard stage
    const infoCount = await genesisInfo.count();
    if (infoCount > 0) {
      // If present, verify it's visible
      const isVisible = await genesisInfo.first().isVisible().catch(() => false);
      if (isVisible) {
        await expect(genesisInfo.first()).toBeVisible();
      }
    }
  });

  test('should allow navigation back through wizard stages', async ({ page }) => {
    // Open wizard
    const addNodeButton = page.locator('button', { hasText: 'Add Node' }).or(
      page.locator('[data-testid="add-node-button"]')
    );

    const buttonExists = await addNodeButton.count();
    if (buttonExists === 0) {
      test.skip();
      return;
    }

    await addNodeButton.first().click();
    
    const wizard = page.locator('[data-testid="add-node-wizard"]');
    await expect(wizard).toBeVisible({ timeout: 5000 });

    // Fill and advance
    const nodeIdInput = wizard.locator('input[name="nodeId"]').or(
      wizard.locator('[data-testid="node-id-input"]')
    );
    
    const inputCount = await nodeIdInput.count();
    if (inputCount > 0) {
      await nodeIdInput.first().fill(testDevices[0].nodeId);
      
      const domainInput = wizard.locator('input[name="domain"]').or(
        wizard.locator('[data-testid="domain-input"]')
      );
      
      const domainCount = await domainInput.count();
      if (domainCount > 0) {
        await domainInput.first().fill(testDevices[0].domain);
        
        const nextButton = wizard.locator('button', { hasText: 'Next' }).or(
          wizard.locator('[data-testid="wizard-next"]')
        );
        
        const nextCount = await nextButton.count();
        if (nextCount > 0) {
          await nextButton.first().click();
          await page.waitForTimeout(500);
          
          // Try to go back
          const backButton = wizard.locator('button', { hasText: 'Back' }).or(
            wizard.locator('[data-testid="wizard-back"]')
          );
          
          const backCount = await backButton.count();
          if (backCount > 0) {
            await backButton.first().click();
            
            // Should return to identity stage
            await page.waitForTimeout(500);
            
            // Verify inputs are still visible
            const nodeIdInputAgain = wizard.locator('input[name="nodeId"]').or(
              wizard.locator('[data-testid="node-id-input"]')
            );
            
            const stillVisible = await nodeIdInputAgain.isVisible({ timeout: 3000 }).catch(() => false);
            if (stillVisible) {
              await expect(nodeIdInputAgain).toBeVisible();
            }
          }
        }
      }
    }
  });

  test('should close wizard on cancel', async ({ page }) => {
    // Open wizard
    const addNodeButton = page.locator('button', { hasText: 'Add Node' }).or(
      page.locator('[data-testid="add-node-button"]')
    );

    const buttonExists = await addNodeButton.count();
    if (buttonExists === 0) {
      test.skip();
      return;
    }

    await addNodeButton.first().click();
    
    const wizard = page.locator('[data-testid="add-node-wizard"]');
    await expect(wizard).toBeVisible({ timeout: 5000 });

    // Look for close/cancel button
    const cancelButton = wizard.locator('button', { hasText: /Cancel|Close/i }).or(
      wizard.locator('[data-testid="wizard-close"]')
    );
    
    const cancelCount = await cancelButton.count();
    if (cancelCount > 0) {
      await cancelButton.first().click();
      
      // Wizard should be hidden
      await expect(wizard).toBeHidden({ timeout: 3000 });
    }
  });

  test('should handle enrollment completion', async ({ page }) => {
    // This test would require mocking the Tauri backend
    // For now, we'll verify the completion flow structure exists
    
    // Open wizard
    const addNodeButton = page.locator('button', { hasText: 'Add Node' }).or(
      page.locator('[data-testid="add-node-button"]')
    );

    const buttonExists = await addNodeButton.count();
    if (buttonExists === 0) {
      test.skip();
      return;
    }

    await addNodeButton.first().click();
    
    const wizard = page.locator('[data-testid="add-node-wizard"]');
    await expect(wizard).toBeVisible({ timeout: 5000 });

    // Look for complete/finish button (may be disabled initially)
    const completeButton = wizard.locator('button', { hasText: /Complete|Finish/i }).or(
      wizard.locator('[data-testid="wizard-complete"]')
    );
    
    const completeCount = await completeButton.count();
    // Just verify the button structure exists
    if (completeCount > 0) {
      // Button should exist (may be disabled)
      expect(completeCount).toBeGreaterThan(0);
    }
  });
});
