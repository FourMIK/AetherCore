import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gatewayRoot = path.resolve(scriptDir, '..');

const sourceProtoPath = path.join(gatewayRoot, 'proto', 'c2.proto');
const distProtoDir = path.join(gatewayRoot, 'dist', 'proto');
const distProtoPath = path.join(distProtoDir, 'c2.proto');

fs.mkdirSync(distProtoDir, { recursive: true });
fs.copyFileSync(sourceProtoPath, distProtoPath);

console.log(`Copied proto asset into dist bundle: ${path.relative(gatewayRoot, distProtoPath)}`);
