/**
 * AetherCore Identity Protocol - Linux/Pi Agent
 * 
 * This implementation uses the shared identity logic from @aethercore/shared
 * to generate and manage node identity on Raspberry Pi and other Linux SBCs.
 * 
 * Platform: Single Board Computer (SBC) - Raspberry Pi, Jetson, etc.
 */

import {
  IdentityBlock,
  PlatformType,
  generateGenesisHash,
  createIdentityBlock,
  verifyIdentityBlock,
} from '@aethercore/shared';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Identity Agent for Linux/Pi platforms
 */
export class LinuxIdentityAgent {
  private identityPath: string;

  constructor(identityPath: string = '/etc/4mik/identity.json') {
    this.identityPath = identityPath;
  }

  /**
   * Get MAC address of primary network interface
   * 
   * @returns MAC address in format XX:XX:XX:XX:XX:XX
   */
  async getHardwareId(): Promise<string> {
    try {
      // Get MAC address of primary interface (eth0, wlan0, or first available)
      const { stdout } = await execAsync(
        "ip link show | grep -E 'eth0|wlan0' | head -1 | awk '/link\\/ether/ {print $2}' || " +
        "cat /sys/class/net/$(ls /sys/class/net | grep -v lo | head -1)/address"
      );
      const mac = stdout.trim().toUpperCase();
      
      if (!mac || mac.length === 0) {
        throw new Error('Failed to retrieve MAC address');
      }
      
      return mac;
    } catch (error) {
      throw new Error(`Failed to get hardware ID: ${error}`);
    }
  }

  /**
   * Generate Ed25519 key pair
   * 
   * TODO: Integrate with TPM/Secure Enclave (CodeRalphie)
   * For now, this is a placeholder that should be replaced with hardware-backed key generation.
   * 
   * @returns Ed25519 public key (hex encoded)
   */
  async generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    // PLACEHOLDER: In production, this MUST use TPM-backed key generation
    // See: crates/identity/src/tpm.rs for hardware-rooted implementation
    
    // For testing: generate deterministic keys
    // In production: call into Rust TPM layer via gRPC
    const publicKey = 'a'.repeat(64); // 32 bytes = 64 hex chars
    const privateKey = 'b'.repeat(64); // MUST NEVER be stored in memory in production
    
    console.warn('[WARNING] Using placeholder key generation - DEPLOY WITH TPM INTEGRATION');
    
    return { publicKey, privateKey };
  }

  /**
   * Create and persist identity block
   * 
   * @param salt Salt for genesis hash generation
   * @returns Generated identity block
   */
  async createIdentity(salt: string): Promise<IdentityBlock> {
    // Get hardware ID
    const hardware_id = await this.getHardwareId();
    
    // Generate key pair (should use TPM in production)
    const { publicKey } = await this.generateKeyPair();
    
    // Create identity block
    const block = await createIdentityBlock(
      hardware_id,
      publicKey,
      salt,
      'SBC' // Raspberry Pi is an SBC
    );
    
    // Persist to disk
    await this.saveIdentity(block);
    
    return block;
  }

  /**
   * Load identity from disk
   * 
   * @returns Identity block or null if not found
   */
  async loadIdentity(): Promise<IdentityBlock | null> {
    try {
      const data = await fs.readFile(this.identityPath, 'utf-8');
      return JSON.parse(data) as IdentityBlock;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Save identity to disk
   * 
   * @param block Identity block to save
   */
  async saveIdentity(block: IdentityBlock): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.identityPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    
    // Write identity with restricted permissions
    await fs.writeFile(
      this.identityPath,
      JSON.stringify(block, null, 2),
      { mode: 0o600 }
    );
  }

  /**
   * Verify stored identity
   * 
   * @param salt Original salt used for generation
   * @returns true if identity is valid
   */
  async verifyStoredIdentity(salt: string): Promise<boolean> {
    const block = await this.loadIdentity();
    if (!block) {
      return false;
    }
    
    return await verifyIdentityBlock(block, salt);
  }

  /**
   * Get or create identity
   * 
   * If identity exists and is valid, return it.
   * Otherwise, create a new identity.
   * 
   * @param salt Salt for genesis hash
   * @returns Identity block
   */
  async getOrCreateIdentity(salt: string): Promise<IdentityBlock> {
    const existing = await this.loadIdentity();
    
    if (existing) {
      const valid = await verifyIdentityBlock(existing, salt);
      if (valid) {
        console.log('[Identity] Loaded existing identity:', existing.genesis_hash);
        return existing;
      } else {
        console.warn('[Identity] Existing identity is invalid, creating new one');
      }
    }
    
    console.log('[Identity] Creating new identity...');
    const newIdentity = await this.createIdentity(salt);
    console.log('[Identity] Created identity:', newIdentity.genesis_hash);
    
    return newIdentity;
  }
}

/**
 * CLI entry point for identity management
 */
export async function main() {
  const agent = new LinuxIdentityAgent();
  const salt = process.env.AETHERCORE_SALT || 'default-salt';
  
  console.log('=== AetherCore Linux Identity Agent ===');
  console.log('Platform: SBC (Raspberry Pi / Linux)');
  console.log('');
  
  try {
    const identity = await agent.getOrCreateIdentity(salt);
    
    console.log('=== Identity Block ===');
    console.log('Hardware ID:', identity.hardware_id);
    console.log('Public Key:', identity.public_key);
    console.log('Genesis Hash:', identity.genesis_hash);
    console.log('Platform Type:', identity.platform_type);
    console.log('======================');
    
    // Verify
    const valid = await agent.verifyStoredIdentity(salt);
    console.log('');
    console.log('Verification:', valid ? '✓ VALID' : '✗ INVALID');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
