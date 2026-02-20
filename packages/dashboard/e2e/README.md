# End-to-End Test Suite for AetherCore Tactical Glass

## Overview

This directory contains Playwright-based end-to-end tests for the AetherCore Tactical Glass desktop application. The test suite validates all major UI flows including Trust Mesh, C2 (Command & Control), Zero-Touch Enrollment, and Testnet connectivity.

## Test Architecture

The E2E test suite follows the 4MIK architectural invariants:

- **No Mocks for Security Flows**: Tests validate actual cryptographic operations and trust verification
- **BLAKE3 Hashing**: Integrity checks use BLAKE3 exclusively
- **Ed25519 Signatures**: Enrollment flows test TPM-backed signing
- **Zero Trust**: All tests assume adversarial network conditions

## Test Suite Structure

```
e2e/
├── fixtures/
│   └── index.ts              # Shared test fixtures and utilities
├── trust-mesh.spec.ts        # Trust mesh UI flow tests
├── c2-control.spec.ts        # Command & control flow tests
├── enrollment.spec.ts        # Zero-Touch enrollment tests
├── testnet-connection.spec.ts # Testnet connectivity tests
├── navigation.spec.ts        # Dashboard navigation tests
└── README.md                 # This file
```

## Test Coverage

### Trust Mesh UI Flows (`trust-mesh.spec.ts`)

- ✅ Node list display with trust scores
- ✅ Trust score gauge rendering and updates
- ✅ Node verification status indicators
- ✅ Byzantine alert detection UI
- ✅ Trust level threshold visualization (Healthy/Suspect/Quarantined)
- ✅ Real-time trust score updates
- ✅ Node filtering by trust level

### C2 (Command & Control) Flows (`c2-control.spec.ts`)

- ✅ Verification panel display for selected nodes
- ✅ Trust score gauge in node detail view
- ✅ Command status badge rendering
- ✅ Command authorization based on trust level
- ✅ Verification failure alert display
- ✅ Attestation hash display for verified nodes
- ✅ Last seen timestamp display
- ✅ Node online/offline status indicators
- ✅ Firmware version display

### Zero-Touch Enrollment Flow (`enrollment.spec.ts`)

- ✅ Add Node Wizard opening
- ✅ Multi-stage wizard navigation (Identity → QR → Attestation → Provisioning)
- ✅ Required field validation in identity stage
- ✅ QR code generation for Genesis Bundle
- ✅ Genesis Bundle information display
- ✅ Back navigation through wizard stages
- ✅ Wizard cancellation
- ✅ Enrollment completion flow

### Testnet Connection Flow (`testnet-connection.spec.ts`)

- ✅ Connection status indicator display
- ✅ Testnet connection controls
- ✅ Testnet endpoint input and validation
- ✅ WSS/WS endpoint format validation
- ✅ Connecting state indicator
- ✅ Connection success message
- ✅ Disconnect button when connected
- ✅ Disconnect action handling
- ✅ Connection error display
- ✅ Endpoint preference persistence
- ✅ Auto-connect on app launch

### Dashboard Navigation (`navigation.spec.ts`)

- ✅ Dashboard layout loading
- ✅ Top bar with system status
- ✅ Verified nodes count display
- ✅ Theme switching (light/dark mode)
- ✅ Workspace mode switching (commander, operator, admin, fleet)
- ✅ Sidebar toggle
- ✅ Map provider switching (Leaflet, Cesium, 3D Globe)
- ✅ Tactical map display
- ✅ Node list panel visibility
- ✅ Add Node button
- ✅ Node selection handling
- ✅ Scanline overlay effect
- ✅ State persistence across refresh
- ✅ Responsive layout handling
- ✅ Application title display

## Running Tests

### Prerequisites

Install dependencies:

```bash
cd packages/dashboard
pnpm install --frozen-lockfile
```

Install Playwright browsers:

```bash
npx playwright install
```

### Run All Tests

```bash
npm test
```

### Run Tests with UI

```bash
npm run test:ui
```

### Run Tests in Headed Mode

```bash
npm run test:headed
```

### Debug Tests

```bash
npm run test:debug
```

### Run Specific Test File

```bash
npx playwright test e2e/trust-mesh.spec.ts
```

### Run Tests in Specific Browser

```bash
# Chromium
npx playwright test --project=chromium

# WebKit (Safari)
npx playwright test --project=webkit
```

## Test Configuration

The test suite is configured via `playwright.config.ts`:

- **Test Directory**: `./e2e`
- **Timeout**: 60 seconds per test
- **Retries**: 2 on CI, 0 locally
- **Workers**: 1 on CI (sequential), parallel locally
- **Reporters**: HTML, JSON, List
- **Base URL**: `http://localhost:1420` (Tauri dev server)
- **Projects**: Chromium, WebKit

## Writing New Tests

### Basic Test Structure

```typescript
import { test, expect } from '../fixtures';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page, waitForAppReady }) => {
    await page.goto('/');
    await waitForAppReady();
  });

  test('should do something', async ({ page }) => {
    // Test implementation
    const element = page.locator('[data-testid="element-id"]');
    await expect(element).toBeVisible();
  });
});
```

### Using Test Fixtures

The test suite provides custom fixtures for common operations:

```typescript
// Wait for app to be ready
await waitForAppReady();

// Verify node in list
await verifyNodeInList('node-id');

// Get trust score gauge
const gauge = await getTrustScoreGauge('node-id');
```

### Using Test Data

Predefined test devices and endpoints are available:

```typescript
import { testDevices, testEndpoints } from '../fixtures';

// Use test device
const device = testDevices[0];

// Use test endpoint
const endpoint = testEndpoints.testnet;
```

### Interacting with Store

Tests can interact with the Zustand store for setup:

```typescript
await page.evaluate((device) => {
  // @ts-ignore
  if (window.__TACTICAL_STORE__) {
    window.__TACTICAL_STORE__.addNode({
      id: device.nodeId,
      domain: device.domain,
      // ... node properties
    });
  }
}, device);
```

## Best Practices

1. **Use data-testid attributes**: Prefer `data-testid` over CSS selectors for stability
2. **Wait for elements**: Use Playwright's auto-waiting or explicit waits
3. **Handle conditional UI**: Use `.count()` to check existence before interaction
4. **Test both success and failure paths**: Include error handling tests
5. **Keep tests isolated**: Each test should be independent
6. **Use descriptive names**: Test names should clearly describe what is being tested
7. **Follow security principles**: Validate security-critical flows without mocks

## CI Integration

Tests are designed to run in CI environments:

- Sequential execution on CI (workers: 1)
- 2 retry attempts on failure
- HTML and JSON reports generated
- Screenshots and videos captured on failure

## Debugging Failed Tests

### View Test Report

After running tests, open the HTML report:

```bash
npx playwright show-report
```

### Inspect Test Traces

Traces are captured on first retry. View with:

```bash
npx playwright show-trace trace.zip
```

### Run with Debug Mode

```bash
npm run test:debug
```

This opens Playwright Inspector for step-by-step debugging.

## Known Limitations

1. **Tauri Backend Mocking**: Some tests require Tauri command mocking which may not be fully implemented
2. **WebSocket Testing**: Real WebSocket connections are tested; network conditions may affect results
3. **TPM Operations**: TPM-backed signing is not available in test environment
4. **Visual Regression**: No visual regression testing implemented yet

## Future Enhancements

- [ ] Add visual regression testing with Playwright screenshots
- [ ] Implement Tauri command mocking for isolated frontend tests
- [ ] Add performance benchmarking tests
- [ ] Expand test coverage for error scenarios
- [ ] Add accessibility testing with Playwright's accessibility APIs
- [ ] Integrate with CI/CD pipeline for automated testing on PRs
- [ ] Add load testing for mesh network simulation

## Troubleshooting

### Tests Timeout

Increase timeout in test or config:

```typescript
test('long running test', async ({ page }) => {
  test.setTimeout(120000); // 2 minutes
  // ...
});
```

### Dev Server Not Starting

Ensure the dev server port (1420) is not in use:

```bash
lsof -i :1420
```

### Browser Installation Issues

Reinstall Playwright browsers:

```bash
npx playwright install --force
```

## References

- [Playwright Documentation](https://playwright.dev)
- [Tauri Testing Guide](https://tauri.app/v1/guides/testing/)
- [AetherCore Architecture Docs](../../docs/)

## License

MIT OR Apache-2.0 (same as parent project)
