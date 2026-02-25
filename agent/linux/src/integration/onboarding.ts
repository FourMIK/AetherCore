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
const TPM_TCTI = 'device:/dev/tpmrm0';
const TPM_CMD_TIMEOUT_SECONDS = 30;

async function execTpm(command: string): Promise<void> {
  await execAsync(`timeout ${TPM_CMD_TIMEOUT_SECONDS}s ${command}`);
}

// Onboarding timeout: 2 minutes
const ENROLLMENT_TIMEOUT_MS = 120000;

// Identity storage path
// Keep this aligned with install.sh and index.ts paths.
const IDENTITY_PATH = '/etc/coderalphie/keys/identity.json';
const IDENTITY_DIR = path.dirname(IDENTITY_PATH);

// Enrollment server URL (from environment or config)
const ENROLLMENT_URL = process.env.ENROLLMENT_URL || 'https://c2.aethercore.local:3000/api/enrollment';
const ENROLLMENT_RETRY_ATTEMPTS = parsePositiveIntEnv('ENROLLMENT_RETRY_ATTEMPTS', 3);
const ENROLLMENT_REQUEST_TIMEOUT_MS = parsePositiveIntEnv('ENROLLMENT_REQUEST_TIMEOUT_MS', 15000);
const TRUST_THRESHOLD = parseUnitIntervalEnv('AETHERCORE_TRUST_THRESHOLD', 0.7);
const ENROLLMENT_CA_CERT_PATH = process.env.ENROLLMENT_CA_CERT_PATH?.trim() || '';
const ENROLLMENT_CA_CERT_PEM = process.env.ENROLLMENT_CA_CERT_PEM?.trim() || '';
const ENROLLMENT_REVOCATION_URL = process.env.ENROLLMENT_REVOCATION_URL?.trim() || '';

export type EnrollmentRequestContext = {
  deviceId: string;
  hardwareSerial: string;
  publicKey: string;
  csr: string;
};

export type EnrollmentCertificate = {
  certificate: string;
  certificateSerial: string;
  trustScore: number;
  caCertificate: string | null;
  revocationEndpoint: string | null;
  enrolledDeviceId: string | null;
  enrolledHardwareSerial: string | null;
  tpmAttested: boolean | null;
};

type RevocationCheckResult = {
  status: 'active' | 'revoked' | 'unknown';
  detail: string;
};

function isProductionMode(): boolean {
  return process.env.AETHERCORE_PRODUCTION === '1' || process.env.AETHERCORE_PRODUCTION === 'true';
}

function parsePositiveIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.warn(`[Onboarding] Invalid ${name}=${raw}; using default ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function parseUnitIntervalEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    console.warn(`[Onboarding] Invalid ${name}=${raw}; using default ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePem(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCertificateSerial(value: string): string {
  return value.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
}

function safeParseJson(text: string): unknown {
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text);
}

function parseEnrollmentResponse(raw: unknown): EnrollmentCertificate {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Enrollment response was not a JSON object');
  }

  const payload = raw as Record<string, unknown>;
  const certificate =
    normalizePem(
      payload.certificate ?? payload.certificate_pem ?? payload.cert ?? payload.cert_pem,
    );
  if (!certificate) {
    throw new Error('Enrollment response missing certificate');
  }

  let certificateSerial = '';
  const serialField =
    payload.certificate_serial ?? payload.certificateSerial ?? payload.serial ?? payload.serial_number;
  if (typeof serialField === 'string' && serialField.trim().length > 0) {
    certificateSerial = normalizeCertificateSerial(serialField);
  }
  if (!certificateSerial) {
    try {
      certificateSerial = normalizeCertificateSerial(new crypto.X509Certificate(certificate).serialNumber);
    } catch {
      // handled below
    }
  }
  if (!certificateSerial) {
    throw new Error('Enrollment response missing certificate serial');
  }

  const trustRaw = payload.trust_score ?? payload.trustScore;
  if (typeof trustRaw !== 'number' || !Number.isFinite(trustRaw) || trustRaw < 0 || trustRaw > 1) {
    throw new Error('Enrollment response trust score must be a number between 0 and 1');
  }

  const revocationEndpoint = normalizePem(
    payload.revocation_endpoint ?? payload.revocationEndpoint,
  );
  const caCertificate = normalizePem(payload.ca_certificate ?? payload.caCertificate ?? payload.ca_cert);

  const enrolledDeviceId = normalizePem(payload.device_id ?? payload.deviceId);
  const enrolledHardwareSerial = normalizePem(payload.hardware_serial ?? payload.hardwareSerial);
  const tpmAttested =
    typeof payload.tpm_attested === 'boolean'
      ? payload.tpm_attested
      : typeof payload.tpmAttested === 'boolean'
        ? payload.tpmAttested
        : null;

  return {
    certificate,
    certificateSerial,
    trustScore: trustRaw,
    caCertificate,
    revocationEndpoint,
    enrolledDeviceId,
    enrolledHardwareSerial,
    tpmAttested,
  };
}

function loadTrustedIssuerCertificates(responseCaCertificate: string | null): crypto.X509Certificate[] {
  const pemCandidates: string[] = [];
  if (ENROLLMENT_CA_CERT_PEM) {
    pemCandidates.push(ENROLLMENT_CA_CERT_PEM);
  }

  if (ENROLLMENT_CA_CERT_PATH) {
    try {
      pemCandidates.push(fs.readFileSync(ENROLLMENT_CA_CERT_PATH, 'utf-8'));
    } catch (error) {
      console.warn(`[Onboarding] Failed to read ENROLLMENT_CA_CERT_PATH=${ENROLLMENT_CA_CERT_PATH}:`, error);
    }
  }

  if (responseCaCertificate) {
    pemCandidates.push(responseCaCertificate);
  }

  const unique = Array.from(new Set(pemCandidates.map((pem) => pem.trim()).filter((pem) => pem.length > 0)));
  const issuers: crypto.X509Certificate[] = [];
  for (const pem of unique) {
    try {
      issuers.push(new crypto.X509Certificate(pem));
    } catch (error) {
      console.warn('[Onboarding] Ignoring invalid CA certificate PEM:', error);
    }
  }
  return issuers;
}

function publicKeyFingerprintFromPem(publicKeyPem: string): string {
  const key = crypto.createPublicKey(publicKeyPem);
  const der = key.export({ type: 'spki', format: 'der' }) as Buffer;
  return crypto.createHash('sha256').update(der).digest('hex');
}

function publicKeyFingerprintFromKeyObject(publicKey: crypto.KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return crypto.createHash('sha256').update(der).digest('hex');
}

function persistedCertificateLooksValid(identity: Partial<DeviceIdentity>): boolean {
  if (
    typeof identity.certificate !== 'string' ||
    typeof identity.certificate_serial !== 'string' ||
    typeof identity.public_key !== 'string'
  ) {
    return false;
  }

  try {
    const cert = new crypto.X509Certificate(identity.certificate);
    const now = Date.now();
    const notBefore = Date.parse(cert.validFrom);
    const notAfter = Date.parse(cert.validTo);
    if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || now < notBefore || now > notAfter) {
      return false;
    }

    const persistedSerial = normalizeCertificateSerial(identity.certificate_serial);
    const certSerial = normalizeCertificateSerial(cert.serialNumber);
    if (!persistedSerial || persistedSerial !== certSerial) {
      return false;
    }

    const persistedPublicKeyFp = publicKeyFingerprintFromPem(identity.public_key);
    const certPublicKeyFp = publicKeyFingerprintFromKeyObject(cert.publicKey);
    return persistedPublicKeyFp === certPublicKeyFp;
  } catch {
    return false;
  }
}

function deriveRevocationEndpoint(enrollmentUrl: string): string | null {
  if (ENROLLMENT_REVOCATION_URL) {
    return ENROLLMENT_REVOCATION_URL;
  }
  try {
    const url = new URL(enrollmentUrl);
    url.pathname = '/api/revocation/check';
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}

async function checkRevocationStatus(certificate: EnrollmentCertificate): Promise<RevocationCheckResult> {
  const endpoint = certificate.revocationEndpoint || deriveRevocationEndpoint(ENROLLMENT_URL);
  if (!endpoint) {
    return { status: 'unknown', detail: 'no revocation endpoint configured' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENROLLMENT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certificate_serial: certificate.certificateSerial }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      return {
        status: 'unknown',
        detail: `revocation endpoint returned HTTP ${response.status}`,
      };
    }
    const payload = safeParseJson(responseText);
    if (!payload || typeof payload !== 'object') {
      return { status: 'unknown', detail: 'revocation response was not a JSON object' };
    }
    const record = payload as Record<string, unknown>;
    if (typeof record.revoked === 'boolean') {
      return {
        status: record.revoked ? 'revoked' : 'active',
        detail: `revoked=${String(record.revoked)}`,
      };
    }
    if (typeof record.status === 'string') {
      const status = record.status.toLowerCase();
      if (status === 'revoked') {
        return { status: 'revoked', detail: 'status=revoked' };
      }
      if (status === 'active' || status === 'valid' || status === 'ok') {
        return { status: 'active', detail: `status=${status}` };
      }
    }
    return { status: 'unknown', detail: 'revocation response missing known fields' };
  } catch (error) {
    return {
      status: 'unknown',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

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

      // If a prior run already persisted this handle, clear it first.
      // This matches the manual recovery sequence and prevents
      // tpm2_evictcontrol "handle already occupied" failures.
      await execAsync(
        `timeout ${TPM_CMD_TIMEOUT_SECONDS}s tpm2_evictcontrol -T ${TPM_TCTI} -C o -c 0x81000001 || true`
      );
      
      // Create primary key
      await execTpm(`tpm2_createprimary -T ${TPM_TCTI} -C o -g sha256 -G ecc -c /tmp/primary.ctx`);
      
      // Create Ed25519 signing key under primary
      await execTpm(`tpm2_create -T ${TPM_TCTI} -C /tmp/primary.ctx -g sha256 -G ecc:ecdsa -u /tmp/ralphie.pub -r /tmp/ralphie.priv`);
      
      // Load key and get handle
      await execTpm(`tpm2_load -T ${TPM_TCTI} -C /tmp/primary.ctx -u /tmp/ralphie.pub -r /tmp/ralphie.priv -c /tmp/ralphie.ctx`);
      
      // Read public key
      await execTpm(`tpm2_readpublic -T ${TPM_TCTI} -c /tmp/ralphie.ctx -o /tmp/ralphie_pub.pem -f pem`);
      const publicKeyPEM = fs.readFileSync('/tmp/ralphie_pub.pem', 'utf-8');
      
      // Make persistent handle
      await execTpm(`tpm2_evictcontrol -T ${TPM_TCTI} -C o -c /tmp/ralphie.ctx 0x81000001`);
      
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
async function requestCertificate(context: EnrollmentRequestContext): Promise<EnrollmentCertificate> {
  console.log('[Onboarding] Requesting certificate from enrollment server...');
  console.log('[Onboarding] Endpoint:', ENROLLMENT_URL);

  let lastError: unknown;
  const totalAttempts = Math.max(1, ENROLLMENT_RETRY_ATTEMPTS + 1);

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ENROLLMENT_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(ENROLLMENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csr: context.csr,
          device_id: context.deviceId,
          hardware_serial: context.hardwareSerial,
          public_key: context.publicKey,
        }),
        signal: controller.signal,
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(
          `Enrollment request failed (HTTP ${response.status}): ${responseText.slice(0, 240)}`,
        );
      }

      const parsed = safeParseJson(responseText);
      const certificate = parseEnrollmentResponse(parsed);
      console.log('[Onboarding] Certificate received. Serial:', certificate.certificateSerial);
      return certificate;
    } catch (error) {
      lastError = error;
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Onboarding] Enrollment request attempt ${attempt}/${totalAttempts} failed: ${detail}`,
      );
      if (attempt < totalAttempts) {
        await delay(Math.min(1000 * attempt, 5000));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `Failed to obtain certificate from enrollment server after ${totalAttempts} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function certSubjectContains(subject: string, expectedValue: string): boolean {
  return subject.toLowerCase().includes(expectedValue.toLowerCase());
}

/**
 * Validate certificate
 */
async function validateCertificate(
  certificate: EnrollmentCertificate,
  context: EnrollmentRequestContext,
): Promise<void> {
  console.log('[Onboarding] Validating certificate...');

  let leafCert: crypto.X509Certificate;
  try {
    leafCert = new crypto.X509Certificate(certificate.certificate);
  } catch (error) {
    throw new Error(`Enrollment certificate is not valid X.509 PEM: ${String(error)}`);
  }

  const notBefore = Date.parse(leafCert.validFrom);
  const notAfter = Date.parse(leafCert.validTo);
  const now = Date.now();

  if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter)) {
    throw new Error('Enrollment certificate validity period could not be parsed');
  }
  if (now < notBefore) {
    throw new Error(`Enrollment certificate is not valid before ${leafCert.validFrom}`);
  }
  if (now > notAfter) {
    throw new Error(`Enrollment certificate expired at ${leafCert.validTo}`);
  }

  const responseSerial = normalizeCertificateSerial(certificate.certificateSerial);
  const certSerial = normalizeCertificateSerial(leafCert.serialNumber);
  if (!responseSerial || responseSerial !== certSerial) {
    throw new Error('Enrollment certificate serial does not match certificate metadata');
  }

  if (certificate.enrolledDeviceId && certificate.enrolledDeviceId !== context.deviceId) {
    throw new Error(
      `Enrollment response device_id mismatch: expected ${context.deviceId}, got ${certificate.enrolledDeviceId}`,
    );
  }
  if (
    certificate.enrolledHardwareSerial &&
    certificate.enrolledHardwareSerial !== context.hardwareSerial
  ) {
    throw new Error(
      `Enrollment response hardware_serial mismatch: expected ${context.hardwareSerial}, got ${certificate.enrolledHardwareSerial}`,
    );
  }

  // Policy binding: cert subject should carry node identity attributes.
  if (
    !certSubjectContains(leafCert.subject, context.deviceId) &&
    !certSubjectContains(leafCert.subject, context.hardwareSerial)
  ) {
    const message = 'Enrollment certificate subject does not bind device identity fields';
    if (isProductionMode()) {
      throw new Error(message);
    }
    console.warn(`[Onboarding] ${message}; continuing in non-production mode`);
  }

  // Policy binding: issued certificate key must match generated enrollment key.
  const expectedPublicKeyFp = publicKeyFingerprintFromPem(context.publicKey);
  const certPublicKeyFp = publicKeyFingerprintFromKeyObject(leafCert.publicKey);
  if (expectedPublicKeyFp !== certPublicKeyFp) {
    throw new Error('Enrollment certificate public key does not match generated key');
  }

  const trustedIssuers = loadTrustedIssuerCertificates(certificate.caCertificate);
  if (trustedIssuers.length === 0) {
    const message =
      'No trusted enrollment CA certificate configured; set ENROLLMENT_CA_CERT_PATH or ENROLLMENT_CA_CERT_PEM';
    if (isProductionMode()) {
      throw new Error(message);
    }
    console.warn(`[Onboarding] ${message}. Skipping issuer verification in non-production mode.`);
  } else {
    const issuerVerified = trustedIssuers.some((issuer) => {
      try {
        return leafCert.checkIssued(issuer) && leafCert.verify(issuer.publicKey);
      } catch {
        return false;
      }
    });
    if (!issuerVerified) {
      throw new Error('Enrollment certificate is not signed by a trusted issuer');
    }
  }

  const revocation = await checkRevocationStatus(certificate);
  if (revocation.status === 'revoked') {
    throw new Error(`Enrollment certificate is revoked (${revocation.detail})`);
  }
  if (revocation.status !== 'active') {
    const message = `Revocation status is unknown (${revocation.detail})`;
    if (isProductionMode()) {
      throw new Error(message);
    }
    console.warn(`[Onboarding] ${message}. Continuing in non-production mode.`);
  }

  if (isProductionMode() && certificate.tpmAttested === false) {
    throw new Error('Enrollment authority marked attestation as non-TPM in production mode');
  }

  console.log('[Onboarding] Certificate validation passed');
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
      const identity = JSON.parse(identityJson) as Partial<DeviceIdentity>;

      // Ignore legacy/non-enrollment identity artifacts (e.g. genesis IdentityBlock),
      // which don't contain runtime enrollment fields.
      if (
        typeof identity.device_id !== 'string' ||
        typeof identity.enrolled_at !== 'number' ||
        typeof identity.trust_score !== 'number'
      ) {
        console.warn('[Onboarding] Existing identity file is not a runtime enrollment record. Re-enrolling.');
        return null;
      }

      if (!persistedCertificateLooksValid(identity)) {
        const message = '[Onboarding] Existing identity has invalid/expired certificate material.';
        if (isProductionMode()) {
          console.error(`${message} Re-enrollment is required in production mode.`);
          return null;
        }
        console.warn(`${message} Continuing in non-production mode.`);
      }
      
      console.log('[Onboarding] Existing identity found:', identity.device_id);
      console.log('[Onboarding] Enrolled at:', new Date(identity.enrolled_at).toISOString());
      console.log('[Onboarding] Trust score:', identity.trust_score);
      
      return identity as DeviceIdentity;
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
  const productionMode = isProductionMode();
  
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
    const enrollmentContext: EnrollmentRequestContext = {
      deviceId,
      hardwareSerial,
      publicKey,
      csr,
    };
    
    // Phase 4: Request certificate
    const issuedCertificate = await requestCertificate(enrollmentContext);
    
    // Phase 5: Validate certificate
    state = EnrollmentState.VALIDATING_CERT;
    console.log('[Onboarding] State:', state);
    await validateCertificate(issuedCertificate, enrollmentContext);
    
    if (issuedCertificate.trustScore < TRUST_THRESHOLD) {
      throw new Error(
        `Trust score ${issuedCertificate.trustScore} below minimum threshold ${TRUST_THRESHOLD}`,
      );
    }
    
    // Phase 6: Create identity object
    const identity: DeviceIdentity = {
      device_id: deviceId,
      hardware_serial: hardwareSerial,
      public_key: publicKey,
      certificate: issuedCertificate.certificate,
      certificate_serial: issuedCertificate.certificateSerial,
      trust_score: issuedCertificate.trustScore,
      enrolled_at: Date.now(),
      tpm_backed: productionMode,
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
    if (productionMode) {
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

// Test-only hooks for service integration coverage.
export const __onboardingTestHooks = {
  createCSR,
  requestCertificate,
  validateCertificate,
  checkRevocationStatus,
  parseEnrollmentResponse,
};
