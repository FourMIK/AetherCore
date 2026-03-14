import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotRoot = path.join(serviceRoot, 'proto', 'lattice-sdk');
const manifestPath = path.join(snapshotRoot, 'VERSION.json');

if (!fs.existsSync(manifestPath)) {
  console.error(`Missing proto snapshot manifest at ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const moduleRef = process.env.LATTICE_PROTO_MODULE || manifest.buf_module || 'buf.build/anduril/lattice-sdk';
const snapshotRef = process.env.LATTICE_PROTO_REF || manifest.snapshot_ref || 'main';
const digest = process.env.LATTICE_PROTO_DIGEST || manifest.snapshot_digest || 'manual-refresh';

const exportTarget = `${moduleRef}:${snapshotRef}`;
console.log(`Exporting protobuf snapshot from ${exportTarget} into ${snapshotRoot}`);

const result = spawnSync('buf', ['export', exportTarget, '--output', snapshotRoot], {
  cwd: serviceRoot,
  stdio: 'inherit',
});

if (result.error) {
  if (result.error.code === 'ENOENT') {
    console.error('buf CLI is not installed or unavailable in PATH. Install buf to run proto:update.');
  } else {
    console.error(`Failed to run buf export: ${String(result.error)}`);
  }
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const nextManifest = {
  ...manifest,
  buf_module: moduleRef,
  snapshot_ref: snapshotRef,
  snapshot_digest: digest,
  fetched_at: new Date().toISOString(),
};

fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
console.log(`Updated snapshot manifest: ${manifestPath}`);
