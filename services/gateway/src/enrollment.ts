import { execFile } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { blake3 } from 'hash-wasm';

const execFileAsync = promisify(execFile);

export type LoggerLike = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

type EnrollmentIssuer = {
  caKeyPath: string;
  caCertPath: string;
  caCertPem: string;
  issueLeafCertificate: (input: {
    publicKeyPem: string;
    deviceId: string;
    hardwareSerial: string;
  }) => Promise<{ certificatePem: string; certificateSerial: string }>;
};

type EnrollmentIssuerConfig = {
  productionMode: boolean;
  caKeyPath: string | null;
  caCertPath: string | null;
  caSubject: string;
  caValidityDays: number;
  leafValidityDays: number;
};

function sanitizeDnValue(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64);
  return sanitized.length > 0 ? sanitized : 'unknown';
}

async function ensureOpenSslAvailable(): Promise<void> {
  await execFileAsync('openssl', ['version']);
}

async function generateEphemeralCa(config: EnrollmentIssuerConfig, logger: LoggerLike): Promise<{
  caKeyPath: string;
  caCertPath: string;
  caCertPem: string;
  tempDir: string;
}> {
  await ensureOpenSslAvailable();

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethercore-enrollment-ca-'));
  const caKeyPath = path.join(tempDir, 'enrollment-ca.key.pem');
  const caCertPath = path.join(tempDir, 'enrollment-ca.crt.pem');

  await execFileAsync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      caKeyPath,
      '-out',
      caCertPath,
      '-days',
      String(Math.max(1, Math.trunc(config.caValidityDays))),
      '-sha256',
      '-subj',
      config.caSubject,
    ],
    { timeout: 30_000 },
  );

  const caCertPem = fs.readFileSync(caCertPath, 'utf-8');
  logger.warn(
    {
      ca_cert_path: caCertPath,
      ca_subject: config.caSubject,
      ca_validity_days: config.caValidityDays,
    },
    'Generated ephemeral enrollment CA (non-production only)',
  );

  return { caKeyPath, caCertPath, caCertPem, tempDir };
}

function resolveIssuerConfigFromEnv(productionMode: boolean): EnrollmentIssuerConfig {
  const caKeyPath =
    process.env.AETHERCORE_ENROLLMENT_CA_KEY_PATH?.trim() ||
    process.env.ENROLLMENT_CA_KEY_PATH?.trim() ||
    '';
  const caCertPath =
    process.env.AETHERCORE_ENROLLMENT_CA_CERT_PATH?.trim() ||
    process.env.ENROLLMENT_CA_CERT_PATH?.trim() ||
    '';

  const leafDaysRaw = process.env.AETHERCORE_ENROLLMENT_CERT_DAYS;
  const leafDaysParsed = leafDaysRaw ? Number.parseInt(leafDaysRaw, 10) : Number.NaN;
  const leafValidityDays = Number.isFinite(leafDaysParsed) && leafDaysParsed > 0 ? leafDaysParsed : 2;

  const caDaysRaw = process.env.AETHERCORE_ENROLLMENT_CA_DAYS;
  const caDaysParsed = caDaysRaw ? Number.parseInt(caDaysRaw, 10) : Number.NaN;
  const caValidityDays = Number.isFinite(caDaysParsed) && caDaysParsed > 0 ? caDaysParsed : 30;

  const caSubject = process.env.AETHERCORE_ENROLLMENT_CA_SUBJECT?.trim() || '/CN=AetherCore-Dev-Enrollment-CA';

  return {
    productionMode,
    caKeyPath: caKeyPath.length > 0 ? caKeyPath : null,
    caCertPath: caCertPath.length > 0 ? caCertPath : null,
    caSubject,
    caValidityDays,
    leafValidityDays,
  };
}

async function loadCaMaterial(
  config: EnrollmentIssuerConfig,
  logger: LoggerLike,
): Promise<{ caKeyPath: string; caCertPath: string; caCertPem: string }> {
  if (config.caKeyPath && config.caCertPath) {
    if (!fs.existsSync(config.caKeyPath) || !fs.existsSync(config.caCertPath)) {
      throw new Error('Enrollment CA key/cert path does not exist');
    }
    const caCertPem = fs.readFileSync(config.caCertPath, 'utf-8');
    logger.info(
      {
        ca_key_path: config.caKeyPath,
        ca_cert_path: config.caCertPath,
      },
      'Loaded enrollment CA material from configured paths',
    );
    return { caKeyPath: config.caKeyPath, caCertPath: config.caCertPath, caCertPem };
  }

  if (config.productionMode) {
    throw new Error(
      'Enrollment CA not configured (set AETHERCORE_ENROLLMENT_CA_KEY_PATH and AETHERCORE_ENROLLMENT_CA_CERT_PATH)',
    );
  }

  const generated = await generateEphemeralCa(config, logger);
  return {
    caKeyPath: generated.caKeyPath,
    caCertPath: generated.caCertPath,
    caCertPem: generated.caCertPem,
  };
}

async function issueLeafCertificate(input: {
  caKeyPath: string;
  caCertPath: string;
  leafValidityDays: number;
  publicKeyPem: string;
  deviceId: string;
  hardwareSerial: string;
}): Promise<{ certificatePem: string; certificateSerial: string }> {
  await ensureOpenSslAvailable();

  const token = crypto.randomBytes(12).toString('hex');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethercore-enrollment-leaf-'));
  const pubPath = path.join(tempDir, `${token}.pub.pem`);
  const csrPath = path.join(tempDir, `${token}.csr.pem`);
  const keyPath = path.join(tempDir, `${token}.bootstrap.key.pem`);
  const certPath = path.join(tempDir, `${token}.crt.pem`);
  const serialHex = crypto.randomBytes(16).toString('hex');

  fs.writeFileSync(pubPath, input.publicKeyPem, { encoding: 'utf-8' });

  try {
    await execFileAsync(
      'openssl',
      [
        'req',
        '-new',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        csrPath,
        '-subj',
        `/CN=${sanitizeDnValue(input.deviceId)}/OU=${sanitizeDnValue(input.hardwareSerial)}`,
      ],
      { timeout: 30_000 },
    );

    await execFileAsync(
      'openssl',
      [
        'x509',
        '-req',
        '-in',
        csrPath,
        '-CA',
        input.caCertPath,
        '-CAkey',
        input.caKeyPath,
        '-out',
        certPath,
        '-days',
        String(Math.max(1, Math.trunc(input.leafValidityDays))),
        '-sha256',
        '-force_pubkey',
        pubPath,
        '-set_serial',
        `0x${serialHex}`,
      ],
      { timeout: 30_000 },
    );

    const certificatePem = fs.readFileSync(certPath, 'utf-8');
    return { certificatePem, certificateSerial: serialHex };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

let issuerPromise: Promise<EnrollmentIssuer> | null = null;

export async function getEnrollmentIssuer(logger: LoggerLike, productionMode: boolean): Promise<EnrollmentIssuer> {
  if (!issuerPromise) {
    issuerPromise = (async () => {
      const config = resolveIssuerConfigFromEnv(productionMode);
      const material = await loadCaMaterial(config, logger);
      return {
        caKeyPath: material.caKeyPath,
        caCertPath: material.caCertPath,
        caCertPem: material.caCertPem,
        issueLeafCertificate: async (params: { publicKeyPem: string; deviceId: string; hardwareSerial: string }) =>
          issueLeafCertificate({
            caKeyPath: material.caKeyPath,
            caCertPath: material.caCertPath,
            leafValidityDays: config.leafValidityDays,
            publicKeyPem: params.publicKeyPem,
            deviceId: params.deviceId,
            hardwareSerial: params.hardwareSerial,
          }),
      };
    })().catch((error) => {
      issuerPromise = null;
      throw error;
    });
  }
  return issuerPromise;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export async function validateEnrollmentCsr(input: {
  csrBase64: string;
  deviceId: string;
  hardwareSerial: string;
  publicKeyPem: string;
  productionMode: boolean;
  maxClockSkewMs?: number;
}): Promise<void> {
  const decoded = Buffer.from(input.csrBase64, 'base64').toString('utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error('CSR payload is not valid JSON');
  }

  const payload = asObject(parsed);
  if (!payload) {
    throw new Error('CSR payload must be a JSON object');
  }

  const deviceId = String(payload.device_id ?? '');
  const hardwareSerial = String(payload.hardware_serial ?? '');
  const publicKey = String(payload.public_key ?? '');
  const timestamp = payload.timestamp;
  const csrVersion = String(payload.csr_version ?? '1.0');
  const csrHashAlg = String(payload.csr_hash_alg ?? '');
  const csrHash = String(payload.csr_hash ?? '');

  if (!deviceId || !hardwareSerial || !publicKey || !csrVersion) {
    throw new Error('CSR payload missing required fields');
  }
  if (deviceId !== input.deviceId || hardwareSerial !== input.hardwareSerial || publicKey !== input.publicKeyPem) {
    throw new Error('CSR payload does not match enrollment request fields');
  }
  if (csrHashAlg !== 'blake3' || !csrHash) {
    throw new Error('CSR payload hash metadata is missing or not blake3');
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error('CSR payload timestamp must be a positive number');
  }

  const maxSkewMs = Math.max(1_000, Math.trunc(input.maxClockSkewMs ?? 10 * 60 * 1000));
  const skew = Math.abs(Date.now() - Math.trunc(timestamp));
  if (input.productionMode && skew > maxSkewMs) {
    throw new Error(`CSR timestamp skew too large (${skew}ms)`);
  }

  try {
    crypto.createPublicKey(input.publicKeyPem);
  } catch {
    throw new Error('Enrollment public_key is not valid PEM');
  }

  const csrCanonical = JSON.stringify({
    device_id: deviceId,
    hardware_serial: hardwareSerial,
    public_key: publicKey,
    timestamp: Math.trunc(timestamp),
    csr_version: csrVersion,
  });
  const expectedHashHex = await blake3(csrCanonical);
  const expectedHashB64 = Buffer.from(expectedHashHex, 'hex').toString('base64');
  if (expectedHashB64 !== csrHash) {
    throw new Error('CSR hash does not match payload contents');
  }
}

export function normalizeCertificateSerial(value: string): string {
  return value.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
}
