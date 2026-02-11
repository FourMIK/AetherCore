#!/usr/bin/env node

/**
 * doctor.js
 * 
 * Cross-platform environment doctor for AetherCore development.
 * Detects the operating system and runs the appropriate preflight script.
 * Prints version information for key tools and provides a health check summary.
 * 
 * Exit codes:
 * - 0: All checks passed
 * - 1: One or more checks failed
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Determine OS platform
const platform = os.platform();

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function print(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function getVersion(command, args = ['--version']) {
  try {
    const result = execSync(`${command} ${args.join(' ')}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim().split('\n')[0];
  } catch (error) {
    return 'not found';
  }
}

function printHeader(title) {
  console.log('');
  console.log('='.repeat(50));
  print(title, 'cyan');
  console.log('='.repeat(50));
  console.log('');
}

function printVersionInfo() {
  printHeader('AetherCore Development Environment Doctor');
  
  console.log(`Platform: ${platform} (${os.arch()})`);
  console.log(`OS Release: ${os.release()}`);
  console.log('');
  
  console.log('Tool Versions:');
  console.log(`  Node.js: ${process.version}`);
  console.log(`  pnpm: ${getVersion('pnpm', ['-v'])}`);
  console.log(`  rustc: ${getVersion('rustc')}`);
  console.log(`  cargo: ${getVersion('cargo')}`);
  console.log(`  git: ${getVersion('git')}`);
  console.log('');
}

function runPreflightScript() {
  const scriptsDir = path.join(__dirname);
  let scriptPath;
  let command;
  let args;
  
  if (platform === 'win32') {
    scriptPath = path.join(scriptsDir, 'preflight-windows.ps1');
    command = 'powershell.exe';
    args = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath];
  } else if (platform === 'darwin') {
    scriptPath = path.join(scriptsDir, 'preflight-macos.sh');
    command = 'bash';
    args = [scriptPath];
  } else if (platform === 'linux') {
    scriptPath = path.join(scriptsDir, 'preflight-linux.sh');
    command = 'bash';
    args = [scriptPath];
  } else {
    print(`ERROR: Unsupported platform: ${platform}`, 'red');
    return 1;
  }
  
  // Check if script exists
  if (!fs.existsSync(scriptPath)) {
    print(`ERROR: Preflight script not found: ${scriptPath}`, 'red');
    return 1;
  }
  
  // Make shell scripts executable on Unix-like systems
  if (platform !== 'win32') {
    try {
      fs.chmodSync(scriptPath, 0o755);
    } catch (error) {
      // Ignore errors if already executable
    }
  }
  
  console.log(`Running preflight checks for ${platform}...`);
  console.log('');
  
  // Run the preflight script
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: platform === 'win32',
  });
  
  return result.status || 0;
}

function main() {
  try {
    printVersionInfo();
    const exitCode = runPreflightScript();
    
    console.log('');
    
    if (exitCode === 0) {
      print('Environment check completed successfully!', 'green');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Run: pnpm install');
      console.log('  2. Run: pnpm build');
      console.log('  3. Run: pnpm test');
      console.log('');
    } else {
      print('Environment check failed. Please fix the errors above.', 'red');
      console.log('');
    }
    
    process.exit(exitCode);
  } catch (error) {
    print(`ERROR: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Run main function
main();
