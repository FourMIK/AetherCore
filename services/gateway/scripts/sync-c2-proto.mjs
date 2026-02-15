import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gatewayRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(gatewayRoot, '../..');

const sourceProtoPath = path.join(repoRoot, 'crates', 'c2-router', 'proto', 'c2.proto');
const targetProtoDir = path.join(gatewayRoot, 'proto');
const targetProtoPath = path.join(targetProtoDir, 'c2.proto');

fs.mkdirSync(targetProtoDir, { recursive: true });
fs.copyFileSync(sourceProtoPath, targetProtoPath);

console.log(`Synced gateway proto asset: ${path.relative(repoRoot, targetProtoPath)}`);
