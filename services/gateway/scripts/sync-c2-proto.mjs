import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gatewayRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(gatewayRoot, '../..');

const sourceProtoPath = path.join(repoRoot, 'crates', 'c2-router', 'proto', 'c2.proto');
const targetProtoDir = path.join(gatewayRoot, 'proto');
const targetProtoPath = path.join(targetProtoDir, 'c2.proto');

// Proto is vendored in services/gateway/proto/c2.proto
// This script syncs from the authoritative Rust source when in monorepo context
// If crates/ is not available (e.g., standalone service build), skip sync
if (!fs.existsSync(sourceProtoPath)) {
  console.log(`Proto source not found at ${path.relative(repoRoot, sourceProtoPath)}`);
  console.log(`Using vendored proto at ${path.relative(repoRoot, targetProtoPath)}`);
  if (!fs.existsSync(targetProtoPath)) {
    console.error(`ERROR: Vendored proto not found at ${targetProtoPath}`);
    process.exit(1);
  }
  process.exit(0);
}

fs.mkdirSync(targetProtoDir, { recursive: true });
fs.copyFileSync(sourceProtoPath, targetProtoPath);

console.log(`Synced gateway proto asset: ${path.relative(repoRoot, targetProtoPath)}`);
