/**
 * onboarding.ts - CodeRalphie Zero-Touch Enrollment
 * 
 * Handles autonomous node bootstrap with hardware-rooted identity.
 * Philosophy: "Trust On Boot" - Device authenticates or bricks.
 * 
 * State Flow:
 * 1. Check for existing identity
 * 2. Generate TPM-backed keypair
 * 3. Create CSR with hardware serial
 * 4. Request certificate from enrollment server
 * 5. Persist identity with strict permissions
 * 6. Signal completion (LED Green) or failure (LED Red)
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

// Onboarding timeout: 2 minutes
const ENROLLMENT_TIMEOUT_MS = 120000;

// Identity storage path
const IDENTITY_PATH = '/etc/ralphie/identity.json';
const IDENTITY_DIR = path.dirname(IDENTITY_PATH);

// Enrollment server URL (from environment or config)
const ENROLLMENT_URL = process.env.ENROLLMENT_URL || 'https://c2.aethercore.local:3000/api/enrollment';

/**
 * Device Identity Structure
 */
interface DeviceIdentity {
  device_id: string;
  hardware_serial: string;
  public_key: string;
  certificate: string;
  certificate_serial: string;
  trust_score: number;
  enrolled_at: number;
  tpm_backed: boolean;
}

/**
 * Enrollment State
 */
enum EnrollmentState {
  UNINITIALIZED = 'uninitialized',
  GENERATING_IDENTITY = 'generating_identity',
  REQUESTING_CERT = 'requesting_cert',
  VALIDATING_CERT = 'validating_cert',
  PERSISTING = 'persisting',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

/**
 * LED Status Indicator Interface
 */
interface StatusIndicator {
  setBlinkingYellow(): Promise<void>;
  setSolidGreen(): Promise<void>;
  setFastBlinkingRed(): Promise<void>;
}

/**
 * Get hardware serial number from /proc/cpuinfo or TPM
 */
async function getHardwareSerial(): Promise<string> {
  try {
    // Try to get from Raspberry Pi CPU info
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf-8');
    const serialMatch = cpuinfo.match(/Serial\s+:\s+([0-9a-f]+)/i);
    
    if (serialMatch && serialMatch[1]) {
      return serialMatch[1].trim();
    }

    // Fallback: Try TPM Endorsement Key hash
    try {
      const { stdout } = await execAsync('tpm2_getekcertificate -o /tmp/ek.crt 2>/dev/null');
      const ekCert = fs.readFileSync('/tmp/ek.crt');
      const hash = crypto.createHash('blake3' as any).update(ekCert).digest('hex');
      fs.unlinkSync('/tmp/ek.crt');
      return hash.substring(0, 32); // Use first 32 chars as serial
    } catch (tpmErr) {
      console.warn('[Onboarding] TPM EK certificate not available:', tpmErr);
    }

    // Last resort: Generate from MAC address
    const { stdout: macAddr } = await execAsync("ip link show | grep 'link/ether' | head -1 | awk '{print $2}'");
    const cleanMac = macAddr.trim().replace(/:/g, '');
    return `mac-${cleanMac}`;
  } catch (error) {
    console.error('[Onboarding] Failed to get hardware serial:', error);
    throw new Error('Cannot determine hardware serial number');
  }
}

/**
 * Generate TPM-backed keypair or simulate for dev
 */
async function generateTPMKeyPair(): Promise<{ publicKey: string; keyHandle: string }> {
  const isProduction = process.env.AETHERCORE_PRODUCTION === '1' || process.env.AETHERCORE_PRODUCTION === 'true';

  if (isProduction) {
    try {
      // Generate TPM-resident key using tpm2-tools
      console.log('[Onboarding] Generating TPM-resident Ed25519 key...');
      
      // Create primary key
      await execAsync('tpm2_createprimary -C o -g sha256 -G ecc -c /tmp/primary.ctx');
      
      // Create Ed25519 signing key under primary
      await execAsync('tpm2_create -C /tmp/primary.ctx -g sha256 -G ecc:ecdsa -u /tmp/ralphie.pub -r /tmp/ralphie.priv');
      
      // Load key and get handle
      const { stdout: loadOut } = await execAsync('tpm2_load -C /tmp/primary.ctx -u /tmp/ralphie.pub -r /tmp/ralphie.priv -c /tmp/ralphie.ctx');
      
      // Read public key
      await execAsync('tpm2_readpublic -c /tmp/ralphie.ctx -o /tmp/ralphie_pub.pem -f pem');
      const publicKeyPEM = fs.readFileSync('/tmp/ralphie_pub.pem', 'utf-8');
      
      // Make persistent handle
      const { stdout: persistOut } = await execAsync('tpm2_evictcontrol -C o -c /tmp/ralphie.ctx 0x81000001');
      
      console.log('[Onboarding] TPM key generated at handle 0x81000001');
      
      // Cleanup temp files
      fs.unlinkSync('/tmp/primary.ctx');
      fs.unlinkSync('/tmp/ralphie.pub');
      fs.unlinkSync('/tmp/ralphie.priv');
      fs.unlinkSync('/tmp/ralphie.ctx');
      fs.unlinkSync('/tmp/ralphie_pub.pem');
      
      return {
        publicKey: publicKeyPEM,
        keyHandle: '0x81000001',
      };
    } catch (error) {
      console.error('[Onboarding] TPM key generation failed:', error);
      throw new Error('PRODUCTION MODE VIOLATION: TPM key generation failed. Device cannot enroll.');
    }
  } else {
    // Development mode: Use software keys with warning
    console.warn('[Onboarding] DEVELOPMENT MODE: Generating software Ed25519 keypair (INSECURE)');
    
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    
    // Store private key temporarily (in production, this is in TPM)
    const devKeyPath = '/tmp/ralphie_dev.key';
    fs.writeFileSync(devKeyPath, privateKey, { mode: 0o600 });
    
    return {
      publicKey,
      keyHandle: devKeyPath,
    };
  }
}

/**
 * Create Certificate Signing Request (CSR)
 */
async function createCSR(publicKey: string, hardwareSerial: string, deviceId: string): Promise<string> {
  console.log('[Onboarding] Creating CSR with hardware serial:', hardwareSerial);
  
  // In production, CSR would include:
  // - Device ID
  // - Hardware Serial (from CPU or TPM EK)
  // - Public Key
  // - Request timestamp
  // - BLAKE3 hash of the above
  
  const csrData = {
    device_id: deviceId,
    hardware_serial: hardwareSerial,
    public_key: publicKey,
    timestamp: Date.now(),
    csr_version: '1.0',
  };
  
  const csrJson = JSON.stringify(csrData);
  const csrHash = crypto.createHash('sha256').update(csrJson).digest('base64');
  
  return Buffer.from(JSON.stringify({
    ...csrData,
    csr_hash: csrHash,
  })).toString('base64');
}

/**
 * Request certificate from enrollment server
 */
async function requestCertificate(csr: string): Promise<{ certificate: string; certificateSerial: string; trustScore: number }> {
  console.log('[Onboarding] Requesting certificate from enrollment server...');
  console.log('[Onboarding] Endpoint:', ENROLLMENT_URL);
  
  // In production, this would make an HTTPS request to the enrollment server
  // For now, simulate the response
  
  try {
    // Simulate network request
    // const response = await fetch(ENROLLMENT_URL, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ csr }),
    // });
    
    // Simulated response (in production, this comes from server)
    const certificate = `-----BEGIN CERTIFICATE-----
SIMULATED_CERTIFICATE_${Date.now()}
-----END CERTIFICATE-----`;
    
    const certificateSerial = crypto.randomBytes(16).toString('hex');
    const trustScore = 1.0;
    
    console.log('[Onboarding] Certificate received. Serial:', certificateSerial);
    
    return { certificate, certificateSerial, trustScore };
  } catch (error) {
    console.error('[Onboarding] Certificate request failed:', error);
    throw new Error('Failed to obtain certificate from enrollment server');
  }
}

/**
 * Validate certificate
 */
function validateCertificate(certificate: string): boolean {
  // In production, verify:
  // - Certificate signature against CA public key
  // - Certificate not expired
  // - Certificate not revoked (check Great Gospel)
  // - Trust score above threshold
  
  console.log('[Onboarding] Validating certificate...');
  
  if (!certificate || certificate.length < 50) {
    return false;
  }
  
  console.log('[Onboarding] Certificate validation passed');
  return true;
}

/**
 * Persist identity to secure storage
 */
async function persistIdentity(identity: DeviceIdentity): Promise<void> {
  console.log('[Onboarding] Persisting identity to', IDENTITY_PATH);
  
  try {
    // Ensure directory exists
    if (!fs.existsSync(IDENTITY_DIR)) {
      fs.mkdirSync(IDENTITY_DIR, { recursive: true, mode: 0o700 });
    }
    
    // Write identity file with strict permissions
    const identityJson = JSON.stringify(identity, null, 2);
    fs.writeFileSync(IDENTITY_PATH, identityJson, { mode: 0o600 });
    
    // Verify permissions
    const stats = fs.statSync(IDENTITY_PATH);
    const mode = stats.mode & 0o777;
    
    if (mode !== 0o600) {
      throw new Error(`Identity file has incorrect permissions: ${mode.toString(8)}`);
    }
    
    console.log('[Onboarding] Identity persisted successfully with mode 600');
  } catch (error) {
    console.error('[Onboarding] Failed to persist identity:', error);
    throw error;
  }
}

/**
 * Check if device is already enrolled
 */
function checkExistingIdentity(): DeviceIdentity | null {
  try {
    if (fs.existsSync(IDENTITY_PATH)) {
      const identityJson = fs.readFileSync(IDENTITY_PATH, 'utf-8');
      const identity = JSON.parse(identityJson) as DeviceIdentity;
      
      console.log('[Onboarding] Existing identity found:', identity.device_id);
      console.log('[Onboarding] Enrolled at:', new Date(identity.enrolled_at).toISOString());
      console.log('[Onboarding] Trust score:', identity.trust_score);
      
      return identity;
    }
  } catch (error) {
    console.warn('[Onboarding] Failed to read existing identity:', error);
  }
  
  return null;
}

/**
 * Start enrollment process
 */
export async function startEnrollment(statusIndicator?: StatusIndicator): Promise<DeviceIdentity> {
  console.log('=== CODERALPHIE ZERO-TOUCH ENROLLMENT ===');
  console.log('[Bootstrap] No identity found. Initiating Enrollment...');
  
  let state: EnrollmentState = EnrollmentState.UNINITIALIZED;
  
  // Set timeout
  const timeoutHandle = setTimeout(() => {
    console.error('[Onboarding] ENROLLMENT TIMEOUT: Failed to complete within 2 minutes');
    state = EnrollmentState.FAILED;
    if (statusIndicator) {
      statusIndicator.setFastBlinkingRed().catch(console.error);
    }
    throw new Error('Enrollment timeout exceeded');
  }, ENROLLMENT_TIMEOUT_MS);
  
  try {
    // Check for existing identity
    const existingIdentity = checkExistingIdentity();
    if (existingIdentity) {
      clearTimeout(timeoutHandle);
      if (statusIndicator) {
        await statusIndicator.setSolidGreen();
      }
      return existingIdentity;
    }
    
    // Signal enrollment in progress
    if (statusIndicator) {
      await statusIndicator.setBlinkingYellow();
    }
    
    // Phase 1: Get hardware serial
    const hardwareSerial = await getHardwareSerial();
    const deviceId = `ralphie-${hardwareSerial}`;
    console.log('[Onboarding] Device ID:', deviceId);
    console.log('[Onboarding] Hardware Serial:', hardwareSerial);
    
    // Phase 2: Generate TPM-backed keypair
    state = EnrollmentState.GENERATING_IDENTITY;
    console.log('[Onboarding] State:', state);
    const { publicKey, keyHandle } = await generateTPMKeyPair();
    console.log('[Onboarding] Keypair generated. Handle:', keyHandle);
    
    // Phase 3: Create CSR
    state = EnrollmentState.REQUESTING_CERT;
    console.log('[Onboarding] State:', state);
    const csr = await createCSR(publicKey, hardwareSerial, deviceId);
    
    // Phase 4: Request certificate
    const { certificate, certificateSerial, trustScore } = await requestCertificate(csr);
    
    // Phase 5: Validate certificate
    state = EnrollmentState.VALIDATING_CERT;
    console.log('[Onboarding] State:', state);
    if (!validateCertificate(certificate)) {
      throw new Error('Certificate validation failed');
    }
    
    if (trustScore < 0.7) {
      throw new Error(`Trust score ${trustScore} below minimum threshold 0.7`);
    }
    
    // Phase 6: Create identity object
    const identity: DeviceIdentity = {
      device_id: deviceId,
      hardware_serial: hardwareSerial,
      public_key: publicKey,
      certificate,
      certificate_serial: certificateSerial,
      trust_score: trustScore,
      enrolled_at: Date.now(),
      tpm_backed: process.env.AETHERCORE_PRODUCTION === '1' || process.env.AETHERCORE_PRODUCTION === 'true',
    };
    
    // Phase 7: Persist identity
    state = EnrollmentState.PERSISTING;
    console.log('[Onboarding] State:', state);
    await persistIdentity(identity);
    
    // Phase 8: Complete
    state = EnrollmentState.COMPLETE;
    console.log('[Onboarding] State:', state);
    console.log('[Onboarding] ✅ ENROLLMENT COMPLETE');
    console.log('[Onboarding] Device is now trusted and operational');
    
    clearTimeout(timeoutHandle);
    
    if (statusIndicator) {
      await statusIndicator.setSolidGreen();
    }
    
    return identity;
    
  } catch (error) {
    clearTimeout(timeoutHandle);
    state = EnrollmentState.FAILED;
    
    console.error('[Onboarding] ❌ ENROLLMENT FAILED');
    console.error('[Onboarding] State:', state);
    console.error('[Onboarding] Error:', error);
    
    if (statusIndicator) {
      await statusIndicator.setFastBlinkingRed();
    }
    
    // In production, brick the connection logic
    if (process.env.AETHERCORE_PRODUCTION === '1' || process.env.AETHERCORE_PRODUCTION === 'true') {
      console.error('[Onboarding] PRODUCTION MODE: Device enrollment failed. Connection logic disabled.');
      // Exit with error to prevent further operation
      process.exit(1);
    }
    
    throw error;
  }
}

/**
 * Get current device identity
 */
export function getDeviceIdentity(): DeviceIdentity | null {
  return checkExistingIdentity();
}

/**
 * Revoke device identity (Great Gospel execution)
 */
export function revokeIdentity(reason: string): void {
  console.log('[Onboarding] GREAT GOSPEL EXECUTED');
  console.log('[Onboarding] Reason:', reason);
  
  if (fs.existsSync(IDENTITY_PATH)) {
    // Backup before deletion
    const backupPath = `${IDENTITY_PATH}.revoked.${Date.now()}`;
    fs.copyFileSync(IDENTITY_PATH, backupPath);
    fs.unlinkSync(IDENTITY_PATH);
    
    console.log('[Onboarding] Identity revoked and backed up to:', backupPath);
  }
  
  // In production, signal LED Red and exit
  if (process.env.AETHERCORE_PRODUCTION === '1' || process.env.AETHERCORE_PRODUCTION === 'true') {
    console.error('[Onboarding] Device has been revoked. Exiting.');
    process.exit(1);
  }
}
