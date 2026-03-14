#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const composeDir = path.join(rootDir, 'infra', 'docker');
const envPath = path.join(composeDir, '.env');
const envExamplePath = path.join(composeDir, '.env.example');

function readEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) {
    return env;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator < 1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    env[key] = value;
  }
  return env;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || rootDir,
      env: options.env || process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: ${command} ${args.join(' ')} (exit ${code ?? 'unknown'})`));
    });
  });
}

async function waitFor(url, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForJson(url, validate, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const payload = await response.json();
        if (!validate || validate(payload)) {
          return payload;
        }
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for valid JSON at ${url}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('[demo:lattice:boot] Created infra/docker/.env from .env.example');
  }

  const envFile = readEnvFile(envPath);
  const gatewayPort = envFile.GATEWAY_PORT || '3000';
  const syntheticIngestIntervalMs =
    process.env.LATTICE_SYNTHETIC_INGEST_INTERVAL_MS ||
    envFile.LATTICE_SYNTHETIC_INGEST_INTERVAL_MS ||
    '2000';

  const composeEnv = {
    ...process.env,
    LATTICE_INTEGRATION_MODE: 'stealth_readonly',
    LATTICE_PROTOCOL_MODE: 'rest',
    LATTICE_INPUT_MODE: 'synthetic',
    LATTICE_SYNTHETIC_SCENARIO: 'sf_bay_maritime_incursion_v1',
    LATTICE_SYNTHETIC_TIMELINE: 'dual',
    LATTICE_SYNTHETIC_REPLAY_HOURS: '24',
    LATTICE_SYNTHETIC_INGEST_INTERVAL_MS: syntheticIngestIntervalMs,
    LATTICE_POLL_INTERVAL_MS: '15000',
    LATTICE_GATEWAY_INTERNAL_TOKEN: 'aethercore_local_lattice_internal_token',
  };

  if (args.has('--down')) {
    await runCommand('docker', ['compose', 'down'], {
      cwd: composeDir,
      env: composeEnv,
    });
    console.log('[demo:lattice:boot] Stack stopped');
    return;
  }

  await runCommand('docker', ['compose', 'up', '-d', '--build'], {
    cwd: composeDir,
    env: composeEnv,
  });

  const gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}`;
  await waitFor(`${gatewayBaseUrl}/health`);
  const status = await waitForJson(
    `${gatewayBaseUrl}/api/lattice/status`,
    (payload) => {
      const integrationMode =
        payload.integration_mode ||
        payload.bridge?.integration_mode ||
        payload.mode?.integration_mode ||
        'unknown';
      return integrationMode !== 'unknown';
    },
    120000,
  );
  const preflight = await waitForJson(
    `${gatewayBaseUrl}/api/lattice/scenario/preflight`,
    (payload) => payload.status === 'ok' && payload.scenario_ready === true,
    120000,
  );

  if (preflight.status !== 'ok' || !preflight.scenario_ready) {
    throw new Error(
      `Scenario preflight failed (status=${String(preflight.status)}, ready=${String(preflight.scenario_ready)})`,
    );
  }

  const integrationMode =
    status.integration_mode ||
    status.bridge?.integration_mode ||
    status.mode?.integration_mode ||
    'unknown';
  const inputMode = status.input_mode || status.bridge?.input_mode || status.mode?.input_mode || 'unknown';
  const profile =
    status.effective_profile ||
    status.bridge?.effective_profile ||
    status.mode?.effective_profile ||
    'unknown';

  console.log('[demo:lattice:boot] Stealth synthetic profile online');
  console.log(
    `[demo:lattice:boot] integration_mode=${String(integrationMode)} input_mode=${String(inputMode)} profile=${String(profile)}`,
  );
  console.log(
    `[demo:lattice:boot] synthetic_ingest_interval_ms=${String(syntheticIngestIntervalMs)} (accelerated demo cadence)`,
  );
  console.log(
    `[demo:lattice:boot] scenario=${String(preflight.scenario_id)} phase=${String(preflight.phase_id)} ready=${String(preflight.scenario_ready)}`,
  );
}

main().catch((error) => {
  console.error('[demo:lattice:boot] Failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
