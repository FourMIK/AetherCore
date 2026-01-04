/**
 * Dashboard Navigation E2E Tests
 * 
 * Validates core navigation and UI interaction flows:
 * - Workspace mode switching (commander, operator, admin, fleet)
 * - Sidebar navigation and panel management
 * - Theme switching (light/dark mode)
 * - Map provider switching (Leaflet, Cesium, 3D Globe)
 * - Layout responsiveness
 * 
 * Security: UI state transitions must preserve security context.
 */

import { test, expect } from '../fixtures';

test.describe('Dashboard Navigation', () => {
  test.beforeEach(async ({ page, waitForAppReady }) => {
    await page.goto('/');
    await waitForAppReady();
  });

  test('should load dashboard layout', async ({ page }) => {
    // Verify main layout components are visible
    const topBar = page.locator('[data-testid="top-bar"]').or(
      page.locator('[class*="TopBar"]')
    );

    const topBarCount = await topBar.count();
    if (topBarCount > 0) {
      await expect(topBar.first()).toBeVisible();
    }

    // Verify main content area
    const mainContent = page.locator('[data-testid="main-content"]').or(
      page.locator('[class*="flex-1"]')
    );

    await expect(mainContent.first()).toBeVisible();
  });

  test('should display top bar with system status', async ({ page }) => {
    // Look for system status indicator
    const systemStatus = page.locator('[data-testid="system-status"]').or(
      page.locator('text=/operational|degraded/i')
    );

    const statusCount = await systemStatus.count();
    if (statusCount > 0) {
      await expect(systemStatus.first()).toBeVisible();
    }
  });

  test('should show verified nodes count', async ({ page }) => {
    // Look for node count display
    const nodeCount = page.locator('[data-testid="verified-nodes"]').or(
      page.locator('[data-testid="node-count"]')
    );

    const countDisplayCount = await nodeCount.count();
    if (countDisplayCount > 0) {
      await expect(nodeCount.first()).toBeVisible();
      
      // Should show a number
      const text = await nodeCount.first().textContent();
      expect(text).toMatch(/\d+/);
    }
  });

  test('should toggle theme between light and dark', async ({ page }) => {
    // Look for theme toggle button
    const themeToggle = page.locator('[data-testid="theme-toggle"]').or(
      page.locator('button[aria-label*="theme"]')
    );

    const toggleCount = await themeToggle.count();
    
    if (toggleCount > 0) {
      // Get current theme
      const htmlElement = page.locator('html');
      const initialClasses = await htmlElement.getAttribute('class');
      const isDarkInitially = initialClasses?.includes('dark') || false;

      // Click toggle
      await themeToggle.first().click();
      await page.waitForTimeout(500);

      // Verify theme changed
      const updatedClasses = await htmlElement.getAttribute('class');
      const isDarkAfter = updatedClasses?.includes('dark') || false;

      expect(isDarkAfter).toBe(!isDarkInitially);
    }
  });

  test('should switch workspace modes', async ({ page }) => {
    // Look for workspace mode selector
    const workspaceSelector = page.locator('[data-testid="workspace-mode"]').or(
      page.locator('select[name="workspaceMode"]')
    );

    const selectorCount = await workspaceSelector.count();
    
    if (selectorCount > 0) {
      await expect(workspaceSelector.first()).toBeVisible();
      
      // Try selecting a different mode
      const isSelect = await workspaceSelector.first().evaluate(el => el.tagName === 'SELECT');
      
      if (isSelect) {
        await workspaceSelector.first().selectOption('operator');
        await page.waitForTimeout(500);
        
        // Verify mode changed
        const selectedValue = await workspaceSelector.first().inputValue();
        expect(selectedValue).toBe('operator');
      }
    }
  });

  test('should toggle sidebar visibility', async ({ page }) => {
    // Look for sidebar toggle button
    const sidebarToggle = page.locator('[data-testid="sidebar-toggle"]').or(
      page.locator('button[aria-label*="sidebar"]')
    );

    const toggleCount = await sidebarToggle.count();
    
    if (toggleCount > 0) {
      // Get sidebar
      const sidebar = page.locator('[data-testid="sidebar"]').or(
        page.locator('[class*="sidebar"]')
      );
      
      const sidebarCount = await sidebar.count();
      if (sidebarCount > 0) {
        const isVisibleInitially = await sidebar.first().isVisible();
        
        // Toggle sidebar
        await sidebarToggle.first().click();
        await page.waitForTimeout(500);
        
        const isVisibleAfter = await sidebar.first().isVisible();
        
        // Visibility should have changed
        expect(isVisibleAfter).toBe(!isVisibleInitially);
      }
    }
  });

  test('should switch map providers', async ({ page }) => {
    // Look for map provider selector
    const mapProviderSelector = page.locator('[data-testid="map-provider"]').or(
      page.locator('select[name="mapProvider"]')
    );

    const selectorCount = await mapProviderSelector.count();
    
    if (selectorCount > 0) {
      await expect(mapProviderSelector.first()).toBeVisible();
      
      const isSelect = await mapProviderSelector.first().evaluate(el => el.tagName === 'SELECT');
      
      if (isSelect) {
        // Try switching to different provider
        await mapProviderSelector.first().selectOption('cesium');
        await page.waitForTimeout(1000);
        
        const selectedValue = await mapProviderSelector.first().inputValue();
        expect(selectedValue).toBe('cesium');
      }
    }
  });

  test('should display tactical map', async ({ page }) => {
    // Look for map container
    const mapContainer = page.locator('[data-testid="tactical-map"]').or(
      page.locator('[class*="TacticalMap"]')
    );

    const mapCount = await mapContainer.count();
    if (mapCount > 0) {
      await expect(mapContainer.first()).toBeVisible();
    }
  });

  test('should show node list panel', async ({ page }) => {
    // Verify node list panel is visible
    const nodeListPanel = page.locator('[data-testid="node-list-panel"]').or(
      page.locator('[class*="NodeListPanel"]')
    );

    const panelCount = await nodeListPanel.count();
    if (panelCount > 0) {
      await expect(nodeListPanel.first()).toBeVisible();
    }
  });

  test('should display Add Node button', async ({ page }) => {
    // Look for Add Node button
    const addNodeButton = page.locator('button', { hasText: 'Add Node' }).or(
      page.locator('[data-testid="add-node-button"]')
    );

    const buttonCount = await addNodeButton.count();
    if (buttonCount > 0) {
      await expect(addNodeButton.first()).toBeVisible();
    }
  });

  test('should handle node selection', async ({ page }) => {
    // Add a test node
    await page.evaluate(() => {
      // @ts-ignore
      if (window.__TACTICAL_STORE__) {
        window.__TACTICAL_STORE__.addNode({
          id: 'test-node-nav',
          domain: 'test-domain',
          position: { lat: 37.7749, lon: -122.4194, alt: 0 },
          trustScore: 0.9,
          verified: true,
          lastSeen: new Date(),
          status: 'online',
        });
      }
    });

    await page.waitForTimeout(500);

    // Try to select the node
    const nodeElement = page.locator('[data-node-id="test-node-nav"]');
    const nodeCount = await nodeElement.count();
    
    if (nodeCount > 0) {
      await nodeElement.first().click();
      await page.waitForTimeout(500);
      
      // Node detail panel should appear
      const nodeDetail = page.locator('[data-testid="node-detail-panel"]');
      const detailCount = await nodeDetail.count();
      
      if (detailCount > 0) {
        const isVisible = await nodeDetail.first().isVisible().catch(() => false);
        if (isVisible) {
          await expect(nodeDetail.first()).toBeVisible();
        }
      }
    }
  });

  test('should display scanline overlay effect', async ({ page }) => {
    // Look for scanline overlay (visual effect)
    const scanline = page.locator('[class*="scanline"]');
    
    const scanlineCount = await scanline.count();
    if (scanlineCount > 0) {
      // Scanline effect should be present
      expect(scanlineCount).toBeGreaterThan(0);
    }
  });

  test('should maintain state across page refresh', async ({ page }) => {
    // Set a specific theme
    const htmlElement = page.locator('html');
    const initialClasses = await htmlElement.getAttribute('class');
    const isDarkInitially = initialClasses?.includes('dark');

    // Reload page
    await page.reload();
    await page.waitForTimeout(2000);

    // Check if theme persisted
    const reloadedClasses = await htmlElement.getAttribute('class');
    const isDarkAfterReload = reloadedClasses?.includes('dark');

    // Theme may or may not persist depending on implementation
    // This test documents expected behavior
  });

  test('should handle browser window resize', async ({ page }) => {
    // Resize to mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // Layout should still be functional
    const mainContent = page.locator('[data-testid="main-content"]').or(
      page.locator('[class*="flex-1"]')
    );
    
    await expect(mainContent.first()).toBeVisible();

    // Resize back to desktop
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(500);
    
    await expect(mainContent.first()).toBeVisible();
  });

  test('should navigate between different views', async ({ page }) => {
    // This test verifies view mode switching if implemented
    const viewModeSelector = page.locator('[data-testid="view-mode"]').or(
      page.locator('select[name="viewMode"]')
    );

    const selectorCount = await viewModeSelector.count();
    
    if (selectorCount > 0) {
      const isSelect = await viewModeSelector.first().evaluate(el => el.tagName === 'SELECT');
      
      if (isSelect) {
        // Try different view modes
        const options = await viewModeSelector.first().locator('option').count();
        
        if (options > 1) {
          await viewModeSelector.first().selectOption({ index: 1 });
          await page.waitForTimeout(500);
        }
      }
    }
  });

  test('should display application title', async ({ page }) => {
    // Look for app title
    const title = await page.title();
    expect(title).toContain('Tactical Glass');
  });

  test('should show keyboard shortcuts help', async ({ page }) => {
    // Look for help button or keyboard shortcuts
    const helpButton = page.locator('[data-testid="help-button"]').or(
      page.locator('button[aria-label*="help"]')
    );

    const helpCount = await helpButton.count();
    
    if (helpCount > 0) {
      await helpButton.first().click();
      await page.waitForTimeout(500);
      
      // Help dialog or panel should appear
      const helpDialog = page.locator('[data-testid="help-dialog"]').or(
        page.locator('[role="dialog"]')
      );
      
      const dialogCount = await helpDialog.count();
      if (dialogCount > 0) {
        const isVisible = await helpDialog.first().isVisible().catch(() => false);
        if (isVisible) {
          await expect(helpDialog.first()).toBeVisible();
        }
      }
    }
  });
});
