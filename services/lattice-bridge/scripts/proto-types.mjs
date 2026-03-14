import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalizedServiceRoot = serviceRoot;
const protoRoot = path.join(normalizedServiceRoot, 'proto', 'lattice-sdk');
const outDir = path.join(normalizedServiceRoot, 'dist', 'generated', 'proto');

const protoFiles = [
  path.join(protoRoot, 'anduril', 'entitymanager', 'v1', 'entitymanager.proto'),
  path.join(protoRoot, 'anduril', 'taskmanager', 'v1', 'taskmanager.proto'),
];

for (const protoFile of protoFiles) {
  if (!fs.existsSync(protoFile)) {
    console.error(`Missing proto file: ${protoFile}`);
    process.exit(1);
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const cliPath = require.resolve('@grpc/proto-loader/build/bin/proto-loader-gen-types.js');
const args = [
  cliPath,
  '--grpcLib=@grpc/grpc-js',
  '--outDir',
  outDir,
  ...protoFiles,
];

const result = spawnSync(process.execPath, args, {
  cwd: normalizedServiceRoot,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Generated gRPC declaration snapshot in ${outDir}`);
