/**
 * index.ts - CodeRalphie Main Entry Point
 * 
 * Zero-Touch Onboarding and Edge Node Bootstrap
 * 
 * Philosophy: "Trust On Boot" - Hardware-rooted identity or brick.
 */

import { startEnrollment, getDeviceIdentity } from './integration/onboarding';
import { getStatusIndicator } from './ui/status-indicator';
import { getConfigManager } from './device-management/configManager';

/**
 * Main bootstrap function
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           CODERALPHIE EDGE NODE BOOTSTRAP                      ║');
  console.log('║           "Trust On Boot" - Hardware-Rooted Identity           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  try {
    // Initialize configuration
    console.log('[Bootstrap] Loading configuration...');
    const configManager = getConfigManager();
    const config = configManager.getConfig();
    
    console.log('[Bootstrap] Configuration loaded:');
    console.log(`  Enrollment URL: ${config.enrollment.url}`);
    console.log(`  C2 Server: ${config.c2.server}:${config.c2.port}`);
    console.log(`  TPM Enabled: ${config.tpm.enabled}`);
    console.log(`  Production Mode: ${process.env.AETHERCORE_PRODUCTION === '1'}`);
    console.log('');
    
    // Initialize status indicator
    const statusIndicator = getStatusIndicator();
    
    // Check for existing identity
    console.log('[Bootstrap] Checking for existing identity...');
    let identity = getDeviceIdentity();
    
    if (identity) {
      console.log('[Bootstrap] ✓ Device already enrolled');
      console.log(`[Bootstrap]   Device ID: ${identity.device_id}`);
      console.log(`[Bootstrap]   Enrolled: ${new Date(identity.enrolled_at).toISOString()}`);
      console.log(`[Bootstrap]   Trust Score: ${identity.trust_score}`);
      console.log(`[Bootstrap]   TPM-Backed: ${identity.tpm_backed}`);
      
      // Set LED to green
      await statusIndicator.setSolidGreen();
    } else {
      console.log('[Bootstrap] No identity found. Initiating Enrollment...');
      console.log('');
      
      // Start enrollment process
      identity = await startEnrollment(statusIndicator);
      
      console.log('');
      console.log('[Bootstrap] ✓ Enrollment successful!');
      console.log(`[Bootstrap]   Device ID: ${identity.device_id}`);
      console.log(`[Bootstrap]   Certificate Serial: ${identity.certificate_serial}`);
      console.log(`[Bootstrap]   Trust Score: ${identity.trust_score}`);
    }
    
    console.log('');
    console.log('[Bootstrap] ✓ Device is operational');
    console.log('[Bootstrap] Connecting to C2 mesh...');
    
    // TODO: Connect to C2 mesh (integrate with existing mesh code)
    // This would call the connect_to_mesh functionality
    
    console.log('[Bootstrap] ✓ Bootstrap complete');
    console.log('');
    console.log('='.repeat(64));
    console.log('CodeRalphie is now operational and ready to receive commands.');
    console.log('='.repeat(64));
    
    // Keep process alive
    process.on('SIGINT', () => {
      console.log('\n[Bootstrap] Shutting down gracefully...');
      statusIndicator.cleanup();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('\n[Bootstrap] Terminating...');
      statusIndicator.cleanup();
      process.exit(0);
    });
    
    // Enter main event loop (in production, this would be the mesh client)
    console.log('[Bootstrap] Entering main event loop...');
    
    // Simulate operation (in production, this would be the actual mesh logic)
    setInterval(() => {
      // Heartbeat or health check
    }, 60000);
    
  } catch (error) {
    console.error('[Bootstrap] FATAL ERROR:', error);
    console.error('[Bootstrap] Device cannot operate without valid identity');
    
    // Signal error via LED
    const statusIndicator = getStatusIndicator();
    await statusIndicator.setFastBlinkingRed();
    
    // In production mode, exit on failure
    if (process.env.AETHERCORE_PRODUCTION === '1' || process.env.AETHERCORE_PRODUCTION === 'true') {
      console.error('[Bootstrap] PRODUCTION MODE: Exiting due to enrollment failure');
      process.exit(1);
    }
    
    throw error;
  }
}

// Run main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
