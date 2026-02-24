#!/usr/bin/env node

/**
 * verify-toolchain.js
 * 
 * Enforces Node 20.x and pnpm 9.15.0 for the AetherCore monorepo.
 * This script is run as a preinstall hook to ensure consistent tooling across all environments.
 * 
 * Requirements:
 * - Node.js 20.x
 * - pnpm 9.15.0
 * 
 * Exit codes:
 * - 0: Success, all checks passed
 * - 1: Failure, toolchain requirements not met
 */

function exitWithError(message) {
  console.error('\n' + '='.repeat(80));
  console.error('ERROR: Toolchain verification failed');
  console.error('='.repeat(80));
  console.error(message);
  console.error('='.repeat(80) + '\n');
  process.exit(1);
}

function checkNodeVersion() {
  const currentVersion = process.version;
  const match = currentVersion.match(/^v(\d+)\./);
  
  if (!match) {
    exitWithError(
      'Unable to parse Node.js version.\n' +
      `Current version: ${currentVersion}\n` +
      'Required: Node.js 20.x'
    );
  }
  
  const majorVersion = parseInt(match[1], 10);
  
  if (majorVersion !== 20) {
    exitWithError(
      'Incorrect Node.js version detected.\n\n' +
      `Current version: ${currentVersion}\n` +
      'Required: Node.js 20.x\n\n' +
      'Please install Node.js 20.x:\n' +
      '  - Using nvm: nvm install 20 && nvm use 20\n' +
      '  - Using n: n 20\n' +
      '  - Download from: https://nodejs.org/'
    );
  }
  
  console.log(`✓ Node.js version check passed: ${currentVersion}`);
}

function checkPnpmVersion() {
  const requiredVersion = '9.15.0';
  
  // Check if we're running under pnpm
  const userAgent = process.env.npm_config_user_agent || '';
  
  if (!userAgent.includes('pnpm')) {
    exitWithError(
      'This project requires pnpm for package management.\n\n' +
      'npm and yarn are not supported.\n\n' +
      'To install pnpm:\n' +
      '  1. Enable corepack: corepack enable\n' +
      '  2. Or run: corepack prepare pnpm@9.15.0 --activate\n\n' +
      'Then run: pnpm install'
    );
  }
  
  // Extract pnpm version from user agent
  const versionMatch = userAgent.match(/pnpm\/(\d+\.\d+\.\d+)/);
  
  if (!versionMatch) {
    exitWithError(
      'Unable to detect pnpm version.\n\n' +
      `Required version: pnpm ${requiredVersion}\n\n` +
      'Please ensure you are using pnpm 9.15.0:\n' +
      '  - Enable corepack: corepack enable\n' +
      '  - Or update: corepack prepare pnpm@9.15.0 --activate'
    );
  }
  
  const currentVersion = versionMatch[1];
  
  if (currentVersion !== requiredVersion) {
    exitWithError(
      'Incorrect pnpm version detected.\n\n' +
      `Current version: pnpm ${currentVersion}\n` +
      `Required version: pnpm ${requiredVersion}\n\n` +
      'To fix this:\n' +
      '  1. Enable corepack: corepack enable\n' +
      '  2. Corepack will automatically use the version specified in package.json\n' +
      '  3. Or manually install: corepack prepare pnpm@9.15.0 --activate'
    );
  }
  
  console.log(`✓ pnpm version check passed: ${currentVersion}`);
}

// Main execution
if (process.env.SKIP_TOOLCHAIN_CHECK === '1') {
  console.log('Skipping toolchain verification because SKIP_TOOLCHAIN_CHECK=1');
  process.exit(0);
}

console.log('\nVerifying toolchain requirements...\n');

try {
  checkNodeVersion();
  checkPnpmVersion();
  console.log('\n✓ All toolchain checks passed\n');
} catch (error) {
  exitWithError(`Unexpected error during toolchain verification: ${error.message}`);
}
