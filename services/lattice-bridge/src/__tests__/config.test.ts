import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config';

const BASE_ENV = {
  LATTICE_BASE_URL: 'https://example.lattice.local',
  LATTICE_CLIENT_ID: 'client-id',
  LATTICE_CLIENT_SECRET: 'client-secret',
  LATTICE_AGENT_ID: 'agent-01',
  LATTICE_SANDBOX_MODE: 'false',
};

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('hybrid mode requires LATTICE_GRPC_TARGET', () => {
  withEnv(
    {
      ...BASE_ENV,
      LATTICE_INTEGRATION_MODE: 'standard',
      LATTICE_PROTOCOL_MODE: 'hybrid',
      LATTICE_GRPC_TARGET: undefined,
      NODE_ENV: 'development',
      AETHERCORE_PRODUCTION: '0',
    },
    () => {
      assert.throws(() => loadConfig(), /LATTICE_GRPC_TARGET is required/i);
    },
  );
});

test('non-production insecure mode is allowed when explicitly set', () => {
  withEnv(
    {
      ...BASE_ENV,
      LATTICE_INTEGRATION_MODE: 'standard',
      LATTICE_PROTOCOL_MODE: 'grpc',
      LATTICE_GRPC_TARGET: '127.0.0.1:50055',
      LATTICE_GRPC_INSECURE: 'true',
      NODE_ENV: 'development',
      AETHERCORE_PRODUCTION: '0',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.integrationMode, 'standard');
      assert.equal(config.grpcTransportMode, 'insecure');
      assert.equal(config.grpcInsecure, true);
    },
  );
});

test('production mode rejects insecure lattice gRPC transport', () => {
  withEnv(
    {
      ...BASE_ENV,
      LATTICE_INTEGRATION_MODE: 'standard',
      LATTICE_PROTOCOL_MODE: 'grpc',
      LATTICE_GRPC_TARGET: '127.0.0.1:50055',
      LATTICE_GRPC_INSECURE: 'true',
      NODE_ENV: 'production',
      AETHERCORE_PRODUCTION: '1',
    },
    () => {
      assert.throws(() => loadConfig(), /Refusing insecure lattice gRPC transport/i);
    },
  );
});

test('mTLS requires both client cert and client key paths', () => {
  withEnv(
    {
      ...BASE_ENV,
      LATTICE_INTEGRATION_MODE: 'standard',
      LATTICE_PROTOCOL_MODE: 'grpc',
      LATTICE_GRPC_TARGET: '127.0.0.1:50055',
      LATTICE_GRPC_INSECURE: 'false',
      LATTICE_GRPC_CLIENT_CERT_PATH: __filename,
      LATTICE_GRPC_CLIENT_KEY_PATH: undefined,
      NODE_ENV: 'development',
      AETHERCORE_PRODUCTION: '0',
    },
    () => {
      assert.throws(() => loadConfig(), /Both LATTICE_GRPC_CLIENT_CERT_PATH and LATTICE_GRPC_CLIENT_KEY_PATH/i);
    },
  );
});

test('invalid certificate path fails fast', () => {
  withEnv(
    {
      ...BASE_ENV,
      LATTICE_INTEGRATION_MODE: 'standard',
      LATTICE_PROTOCOL_MODE: 'grpc',
      LATTICE_GRPC_TARGET: '127.0.0.1:50055',
      LATTICE_GRPC_INSECURE: 'false',
      LATTICE_GRPC_CA_CERT_PATH: 'C:\\definitely-missing-ca.pem',
      NODE_ENV: 'development',
      AETHERCORE_PRODUCTION: '0',
    },
    () => {
      assert.throws(() => loadConfig(), /LATTICE_GRPC_CA_CERT_PATH path does not exist/i);
    },
  );
});

test('production TLS mode requires CA cert and mTLS client material', () => {
  withEnv(
    {
      ...BASE_ENV,
      LATTICE_INTEGRATION_MODE: 'standard',
      LATTICE_PROTOCOL_MODE: 'grpc',
      LATTICE_GRPC_TARGET: '127.0.0.1:50055',
      LATTICE_GRPC_INSECURE: 'false',
      LATTICE_GRPC_CA_CERT_PATH: undefined,
      LATTICE_GRPC_CLIENT_CERT_PATH: undefined,
      LATTICE_GRPC_CLIENT_KEY_PATH: undefined,
      NODE_ENV: 'production',
      AETHERCORE_PRODUCTION: '1',
    },
    () => {
      assert.throws(() => loadConfig(), /LATTICE_GRPC_CA_CERT_PATH is required in production mode/i);
    },
  );
});

test('stealth mode defaults to rest protocol and read-only posture', () => {
  withEnv(
    {
      ...BASE_ENV,
      LATTICE_INTEGRATION_MODE: undefined,
      LATTICE_PROTOCOL_MODE: 'hybrid',
      LATTICE_GRPC_TARGET: undefined,
      LATTICE_POLL_INTERVAL_MS: undefined,
      LATTICE_INPUT_MODE: undefined,
      NODE_ENV: 'development',
      AETHERCORE_PRODUCTION: '0',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.integrationMode, 'stealth_readonly');
      assert.equal(config.defaultInputMode, 'synthetic');
      assert.equal(config.allowOutboundWrites, false);
      assert.equal(config.protocolMode, 'rest');
      assert.equal(config.pollIntervalMs, 15000);
      assert.equal(config.syntheticIngestIntervalMs, 15000);
      assert.equal(config.grpcTarget, undefined);
      assert.equal(config.grpcInsecure, false);
    },
  );
});

test('synthetic ingest interval can be accelerated independently of live poll interval', () => {
  withEnv(
    {
      ...BASE_ENV,
      LATTICE_INTEGRATION_MODE: 'stealth_readonly',
      LATTICE_INPUT_MODE: 'synthetic',
      LATTICE_PROTOCOL_MODE: 'rest',
      LATTICE_POLL_INTERVAL_MS: '15000',
      LATTICE_SYNTHETIC_INGEST_INTERVAL_MS: '2000',
      NODE_ENV: 'development',
      AETHERCORE_PRODUCTION: '0',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.pollIntervalMs, 15000);
      assert.equal(config.syntheticIngestIntervalMs, 2000);
    },
  );
});

test('stealth synthetic mode boots without live lattice credentials', () => {
  withEnv(
    {
      LATTICE_BASE_URL: undefined,
      LATTICE_CLIENT_ID: undefined,
      LATTICE_CLIENT_SECRET: undefined,
      LATTICE_AGENT_ID: undefined,
      LATTICE_SANDBOX_MODE: 'false',
      LATTICE_INTEGRATION_MODE: 'stealth_readonly',
      LATTICE_INPUT_MODE: 'synthetic',
      LATTICE_PROTOCOL_MODE: 'rest',
      NODE_ENV: 'development',
      AETHERCORE_PRODUCTION: '0',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.integrationMode, 'stealth_readonly');
      assert.equal(config.defaultInputMode, 'synthetic');
      assert.equal(config.latticeBaseUrl, undefined);
      assert.equal(config.latticeClientId, undefined);
      assert.equal(config.latticeClientSecret, undefined);
      assert.equal(config.latticeAgentId, undefined);
    },
  );
});

test('live input mode requires live lattice credentials', () => {
  withEnv(
    {
      LATTICE_BASE_URL: undefined,
      LATTICE_CLIENT_ID: undefined,
      LATTICE_CLIENT_SECRET: undefined,
      LATTICE_AGENT_ID: undefined,
      LATTICE_SANDBOX_MODE: 'false',
      LATTICE_INTEGRATION_MODE: 'stealth_readonly',
      LATTICE_INPUT_MODE: 'live',
      LATTICE_PROTOCOL_MODE: 'rest',
      NODE_ENV: 'development',
      AETHERCORE_PRODUCTION: '0',
    },
    () => {
      assert.throws(() => loadConfig(), /Missing required environment variables for live lattice ingest/i);
    },
  );
});
