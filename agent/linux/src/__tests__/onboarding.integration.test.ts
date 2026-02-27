import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import type {
  EnrollmentCertificate,
  EnrollmentRequestContext,
} from '../integration/onboarding';

type RevocationMode = 'active' | 'revoked' | 'http_error' | 'unknown_payload';

let tempDir = '';
let caKeyPath = '';
let caCertPath = '';
let caCertPem = '';
let baseUrl = '';
let revocationMode: RevocationMode = 'active';
const revocationResponses = new Map<
  string,
  { statusCode: number; body: Record<string, unknown> }
>();

let server: http.Server;
let createCSR: (publicKey: string, hardwareSerial: string, deviceId: string) => Promise<string>;
let requestCertificate: (
  context: EnrollmentRequestContext,
) => Promise<EnrollmentCertificate>;
let validateCertificate: (
  certificate: EnrollmentCertificate,
  context: EnrollmentRequestContext,
) => Promise<void>;

const originalEnv = new Map<string, string | undefined>();
for (const key of [
  'ENROLLMENT_URL',
  'ENROLLMENT_REQUEST_TIMEOUT_MS',
  'ENROLLMENT_RETRY_ATTEMPTS',
  'AETHERCORE_PRODUCTION',
]) {
  originalEnv.set(key, process.env[key]);
}

function sanitizeDnValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64) || 'unknown';
}

function ensureOpenSslPresent(): void {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
}

function writeFile(filePath: string, contents: string): void {
  fs.writeFileSync(filePath, contents, { encoding: 'utf-8' });
}

function issueLeafCertificate(
  publicKeyPem: string,
  deviceId: string,
  hardwareSerial: string,
): { certificatePem: string; certificateSerial: string } {
  const token = crypto.randomBytes(8).toString('hex');
  const pubPath = path.join(tempDir, `${token}.pub.pem`);
  const csrPath = path.join(tempDir, `${token}.csr.pem`);
  const keyPath = path.join(tempDir, `${token}.key.pem`);
  const certPath = path.join(tempDir, `${token}.crt.pem`);
  writeFile(pubPath, publicKeyPem);

  execFileSync(
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
      `/CN=${sanitizeDnValue(deviceId)}/OU=${sanitizeDnValue(hardwareSerial)}`,
    ],
    { stdio: 'ignore' },
  );

  execFileSync(
    'openssl',
    [
      'x509',
      '-req',
      '-in',
      csrPath,
      '-CA',
      caCertPath,
      '-CAkey',
      caKeyPath,
      '-CAcreateserial',
      '-out',
      certPath,
      '-days',
      '2',
      '-sha256',
      '-force_pubkey',
      pubPath,
    ],
    { stdio: 'ignore' },
  );

  const certificatePem = fs.readFileSync(certPath, 'utf-8');
  const serialOutput = execFileSync(
    'openssl',
    ['x509', '-in', certPath, '-noout', '-serial'],
    { encoding: 'utf-8' },
  );
  const serialMatch = serialOutput.match(/serial=([0-9A-Fa-f]+)/);
  if (!serialMatch) {
    throw new Error(`Failed to parse certificate serial from output: ${serialOutput}`);
  }

  return {
    certificatePem,
    certificateSerial: serialMatch[1].toLowerCase(),
  };
}

function createRevocationResponse(mode: RevocationMode): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  switch (mode) {
    case 'active':
      return { statusCode: 200, body: { status: 'active' } };
    case 'revoked':
      return { statusCode: 200, body: { status: 'revoked' } };
    case 'http_error':
      return { statusCode: 500, body: { error: 'backend unavailable' } };
    case 'unknown_payload':
      return { statusCode: 200, body: { message: 'missing status fields' } };
    default:
      return { statusCode: 200, body: { status: 'active' } };
  }
}

function parseJsonBody(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON payload must be an object');
  }
  return parsed as Record<string, unknown>;
}

async function createEnrollmentContext(): Promise<EnrollmentRequestContext> {
  const { publicKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const hardwareSerial = `test-hw-${crypto.randomBytes(4).toString('hex')}`;
  const deviceId = `ralphie-${hardwareSerial}`;
  const csr = await createCSR(publicKey.toString(), hardwareSerial, deviceId);
  return {
    deviceId,
    hardwareSerial,
    publicKey: publicKey.toString(),
    csr,
  };
}

describe('onboarding enrollment service integration', () => {
  before(async () => {
    ensureOpenSslPresent();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-integration-'));
    caKeyPath = path.join(tempDir, 'ca.key.pem');
    caCertPath = path.join(tempDir, 'ca.crt.pem');

    execFileSync(
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
        '30',
        '-sha256',
        '-subj',
        '/CN=AetherCore-Test-CA',
      ],
      { stdio: 'ignore' },
    );
    caCertPem = fs.readFileSync(caCertPath, 'utf-8');

    server = http.createServer((req, res) => {
      const reqUrl = req.url ?? '/';
      if (req.method === 'POST' && reqUrl === '/api/enrollment') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const payload = parseJsonBody(body);
            const deviceId = String(payload.device_id ?? '');
            const hardwareSerial = String(payload.hardware_serial ?? '');
            const publicKey = String(payload.public_key ?? '');
            if (!deviceId || !hardwareSerial || !publicKey) {
              res.writeHead(400, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ error: 'missing enrollment fields' }));
              return;
            }

            const { certificatePem, certificateSerial } = issueLeafCertificate(
              publicKey,
              deviceId,
              hardwareSerial,
            );
            const revocationToken = crypto.randomBytes(6).toString('hex');
            const revocationPath = `/api/revocation/check/${revocationToken}`;
            revocationResponses.set(
              revocationPath,
              createRevocationResponse(revocationMode),
            );

            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                certificate: certificatePem,
                certificate_serial: certificateSerial,
                trust_score: 0.93,
                ca_certificate: caCertPem,
                revocation_endpoint: `${baseUrl}${revocationPath}`,
                device_id: deviceId,
                hardware_serial: hardwareSerial,
                tpm_attested: true,
              }),
            );
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                error:
                  error instanceof Error ? error.message : String(error),
              }),
            );
          }
        });
        return;
      }

      if (req.method === 'POST' && reqUrl.startsWith('/api/revocation/check/')) {
        const response = revocationResponses.get(reqUrl) ?? {
          statusCode: 200,
          body: { status: 'active' },
        };
        res.writeHead(response.statusCode, { 'content-type': 'application/json' });
        res.end(JSON.stringify(response.body));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind integration test server');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    process.env.ENROLLMENT_URL = `${baseUrl}/api/enrollment`;
    process.env.ENROLLMENT_REQUEST_TIMEOUT_MS = '2000';
    process.env.ENROLLMENT_RETRY_ATTEMPTS = '1';
    process.env.AETHERCORE_PRODUCTION = 'false';

    const onboardingModule = await import('../integration/onboarding');
    createCSR = onboardingModule.__onboardingTestHooks.createCSR;
    requestCertificate = onboardingModule.__onboardingTestHooks.requestCertificate;
    validateCertificate = onboardingModule.__onboardingTestHooks.validateCertificate;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    for (const [key, value] of originalEnv.entries()) {
      if (typeof value === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    revocationResponses.clear();
    revocationMode = 'active';
    process.env.AETHERCORE_PRODUCTION = 'false';
  });

  it('requests and validates certificate with active revocation status', async () => {
    const context = await createEnrollmentContext();
    const certificate = await requestCertificate(context);

    await assert.doesNotReject(async () => {
      await validateCertificate(certificate, context);
    });
  });

  it('fails closed in production when revocation endpoint returns revoked', async () => {
    revocationMode = 'revoked';
    process.env.AETHERCORE_PRODUCTION = 'true';
    const context = await createEnrollmentContext();
    const certificate = await requestCertificate(context);

    await assert.rejects(
      async () => validateCertificate(certificate, context),
      /revoked/i,
    );
  });

  it('fails closed in production when revocation status is unknown', async () => {
    revocationMode = 'http_error';
    process.env.AETHERCORE_PRODUCTION = 'true';
    const context = await createEnrollmentContext();
    const certificate = await requestCertificate(context);

    await assert.rejects(
      async () => validateCertificate(certificate, context),
      /Revocation status is unknown/i,
    );
  });

  it('allows unknown revocation status in non-production mode', async () => {
    revocationMode = 'unknown_payload';
    process.env.AETHERCORE_PRODUCTION = 'false';
    const context = await createEnrollmentContext();
    const certificate = await requestCertificate(context);

    await assert.doesNotReject(async () => {
      await validateCertificate(certificate, context);
    });
  });
});
