#!/usr/bin/env node
/**
 * index.ts - CodeRalphie Main Entry Point
 * 
 * Zero-Touch Onboarding and Edge Node Bootstrap
 * 
 * Philosophy: "Trust On Boot" - Hardware-rooted identity or brick.
 */

import { LinuxIdentityAgent } from './identity';
import { startEnrollment, getDeviceIdentity } from './integration/onboarding';
import { getStatusIndicator } from './ui/status-indicator';
import { getConfigManager } from './device-management/configManager';
import type { RalphieConfig } from './bootstrap/configValidator';
import { MeshClient } from './c2/mesh-client';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'node:readline';

const KEYS_DIR = '/etc/coderalphie/keys';
const IDENTITY_FILE = path.join(KEYS_DIR, 'identity.json');

function buildMeshEndpoint(config: Readonly<RalphieConfig>): string {
  const explicitEndpoint = process.env.C2_WS_URL?.trim();
  if (explicitEndpoint) {
    return explicitEndpoint;
  }

  const server = config.c2.server.trim().replace(/\/+$/, '');

  if (server.startsWith('ws://') || server.startsWith('wss://')) {
    const normalized = new URL(server);
    if (!normalized.port) {
      normalized.port = String(config.c2.port);
    }
    return normalized.toString();
  }

  const scheme = config.c2.use_wss ? 'wss' : 'ws';
  return `${scheme}://${server}:${config.c2.port}`;
}

/**
 * Genesis mode - Generate keys and output IdentityBlock JSON
 */
async function genesisMode() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           CODERALPHIE GENESIS MODE                             ║');
  console.log('║           Hardware-Rooted Identity Generation                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  try {
    // Create keys directory with proper permissions
    await fs.mkdir(KEYS_DIR, { recursive: true, mode: 0o700 });
    console.log(`[Genesis] Created keys directory: ${KEYS_DIR}`);
    
    // Initialize identity agent
    const agent = new LinuxIdentityAgent(IDENTITY_FILE);
    const salt = process.env.AETHERCORE_SALT || 'default-salt';
    
    // Generate identity
    console.log('[Genesis] Generating identity block...');
    const identity = await agent.createIdentity(salt);
    
    // Output IdentityBlock JSON to stdout for dashboard capture
    console.log('');
    console.log('=== IDENTITY_BLOCK_START ===');
    console.log(JSON.stringify(identity, null, 2));
    console.log('=== IDENTITY_BLOCK_END ===');
    console.log('');
    
    console.log('[Genesis] ✓ Identity generated successfully');
    console.log(`[Genesis]   Hardware ID: ${identity.hardware_id}`);
    console.log(`[Genesis]   Genesis Hash: ${identity.genesis_hash}`);
    console.log(`[Genesis]   Platform: ${identity.platform_type}`);
    console.log(`[Genesis]   Identity stored: ${IDENTITY_FILE}`);
    
    // Verify permissions
    const stats = await fs.stat(IDENTITY_FILE);
    const mode = stats.mode & 0o777;
    console.log(`[Genesis]   Permissions: ${mode.toString(8)}`);
    
    if (mode !== 0o600) {
      console.error(`[Genesis] ERROR: Identity file has incorrect permissions: ${mode.toString(8)}`);
      process.exit(1);
    }
    
    console.log('[Genesis] ✓ Genesis complete');
    
  } catch (error) {
    console.error('[Genesis] FATAL ERROR:', error);
    process.exit(1);
  }
}

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
    
    const meshEndpoint = buildMeshEndpoint(config);
    const autoReplyEnabled = process.env.CODERALPHIE_AUTO_REPLY === '1';
    const interactiveInputEnabled =
      process.stdin.isTTY && process.env.CODERALPHIE_CHAT_STDIN !== '0';
    let lastChatOperator: string | null = null;
    let chatConsole: readline.Interface | null = null;

    const meshClient = new MeshClient({
      endpoint: meshEndpoint,
      identity: {
        device_id: identity.device_id,
        public_key: identity.public_key,
        hardware_serial: identity.hardware_serial,
        certificate_serial: identity.certificate_serial,
        trust_score: identity.trust_score,
        enrolled_at: identity.enrolled_at,
        tpm_backed: identity.tpm_backed,
      },
      reconnectIntervalMs: config.c2.reconnect_interval_ms,
      maxReconnectIntervalMs: Math.max(config.c2.reconnect_interval_ms * 12, 30000),
      heartbeatIntervalMs: 30000,
      connectTimeoutMs: 10000,
      onConnected: async () => {
        await statusIndicator.setSolidGreen();
      },
      onDisconnected: async (reason) => {
        console.warn(`[Bootstrap] Mesh link down: ${reason}`);
        await statusIndicator.setSlowBlinkingRed();
      },
      onChatMessage: async (message) => {
        lastChatOperator = message.from;
        const trustLabel = message.verified ? 'verified' : 'unverified';
        const ts = message.timestamp.toISOString();
        console.log(`[Comms] [${ts}] ${message.from} -> ${identity.device_id} (${trustLabel})`);
        console.log(`[Comms] ${message.content}`);

        if (autoReplyEnabled) {
          const reply = `ACK ${message.id}: message received by ${identity.device_id}`;
          await meshClient.sendChatMessage(message.from, reply);
          console.log(`[Comms] Auto-reply sent to ${message.from}`);
        }
      },
    });

    console.log('');
    console.log('[Bootstrap] ✓ Device is operational');
    console.log(`[Bootstrap] Connecting to C2 mesh at ${meshEndpoint} ...`);
    meshClient.start();

    console.log('[Bootstrap] ✓ Bootstrap complete');
    console.log('');
    console.log('='.repeat(64));
    console.log('CodeRalphie is now operational and ready to receive commands.');
    console.log('='.repeat(64));

    if (autoReplyEnabled) {
      console.log('[Comms] Auto-reply mode enabled (CODERALPHIE_AUTO_REPLY=1)');
    }

    if (interactiveInputEnabled) {
      chatConsole = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });

      console.log('[Comms] Interactive chat enabled.');
      console.log('[Comms] Commands:');
      console.log('  /to <operator-id> <message>');
      console.log('  /reply <message>');
      console.log('  /last');
      console.log('  /help');
      console.log('');

      chatConsole.on('line', (line) => {
        void (async () => {
          const trimmed = line.trim();
          if (!trimmed) {
            return;
          }

          if (trimmed === '/help') {
            console.log('[Comms] /to <operator-id> <message> | /reply <message> | /last | /help');
            return;
          }

          if (trimmed === '/last') {
            console.log(`[Comms] last_operator=${lastChatOperator || 'none'}`);
            return;
          }

          if (trimmed.startsWith('/to ')) {
            const parts = trimmed.split(/\s+/, 3);
            if (parts.length < 3) {
              console.log('[Comms] Usage: /to <operator-id> <message>');
              return;
            }
            const recipientId = parts[1];
            const content = trimmed.slice(5 + recipientId.length).trim();
            if (!content) {
              console.log('[Comms] Message cannot be empty');
              return;
            }
            await meshClient.sendChatMessage(recipientId, content);
            console.log(`[Comms] Sent -> ${recipientId}`);
            return;
          }

          if (trimmed.startsWith('/reply ')) {
            if (!lastChatOperator) {
              console.log('[Comms] No previous operator to reply to');
              return;
            }
            const content = trimmed.slice('/reply '.length).trim();
            if (!content) {
              console.log('[Comms] Message cannot be empty');
              return;
            }
            await meshClient.sendChatMessage(lastChatOperator, content);
            console.log(`[Comms] Reply sent -> ${lastChatOperator}`);
            return;
          }

          if (!lastChatOperator) {
            console.log('[Comms] No active operator. Use /to <operator-id> <message>');
            return;
          }
          await meshClient.sendChatMessage(lastChatOperator, trimmed);
          console.log(`[Comms] Sent -> ${lastChatOperator}`);
        })().catch((error) => {
          console.error('[Comms] Failed to send message:', error);
        });
      });
    } else {
      console.log('[Comms] Interactive chat disabled (no TTY or CODERALPHIE_CHAT_STDIN=0)');
    }
    
    // Keep process alive
    process.on('SIGINT', () => {
      console.log('\n[Bootstrap] Shutting down gracefully...');
      meshClient.stop();
      if (chatConsole) {
        chatConsole.close();
      }
      statusIndicator.cleanup();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('\n[Bootstrap] Terminating...');
      meshClient.stop();
      if (chatConsole) {
        chatConsole.close();
      }
      statusIndicator.cleanup();
      process.exit(0);
    });
    
    // Enter main event loop while mesh client manages transport lifecycle.
    console.log('[Bootstrap] Entering main event loop...');

    // Process stays alive via mesh transport timers and socket callbacks.
    
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

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--genesis')) {
  // Genesis mode: Generate keys and output IdentityBlock
  genesisMode().catch(error => {
    console.error('Genesis error:', error);
    process.exit(1);
  });
} else {
  // Normal operation mode
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
