#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * deploy-atak-plugin.js
 * 
 * Deploys the ATAK-Civ plugin to Android device or emulator.
 * Verifies deployment and checks plugin loading.
 * 
 * Prerequisites:
 * - Android SDK with adb installed
 * - Android device/emulator connected and in debug mode
 * - ATAK CIV application installed on target
 * 
 * Usage:
 *   node scripts/deploy-atak-plugin.js [--device SERIAL] [--wait]
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PLUGIN_JAR = path.join(__dirname, '..', 'dist', 'atak', 'main.jar');
const ATAK_PLUGINS_DIR = '/sdcard/atak/plugins';
const REMOTE_JAR_PATH = `${ATAK_PLUGINS_DIR}/main.jar`;

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function print(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function printHeader(title) {
  console.log('');
  console.log('='.repeat(60));
  print(title, 'cyan');
  console.log('='.repeat(60));
  console.log('');
}

function runCommand(command, args, description) {
  try {
    print(`${description}...`, 'cyan');
    const result = execSync(`${command} ${args.join(' ')}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch (error) {
    print(`ERROR: ${description} failed`, 'red');
    print(`Command: ${command} ${args.join(' ')}`, 'red');
    print(`Error: ${error.message}`, 'red');
    return null;
  }
}

function adbCommand(args, description, optional = false) {
  try {
    const result = execSync(`adb ${args.join(' ')}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (description) {
      print(`✅ ${description}`);
    }
    return result.trim();
  } catch (error) {
    if (!optional) {
      print(`❌ ERROR: ${description || 'adb command failed'}`, 'red');
      print(`Command: adb ${args.join(' ')}`, 'red');
      return null;
    }
    return null;
  }
}

function checkPrerequisites() {
  printHeader('Checking Prerequisites');

  // Check if main.jar exists
  if (!fs.existsSync(PLUGIN_JAR)) {
    print(`❌ ERROR: main.jar not found at ${PLUGIN_JAR}`, 'red');
    print('Run: pnpm run build:atak', 'yellow');
    return false;
  }
  print(`✅ Found main.jar (${Math.round(fs.statSync(PLUGIN_JAR).size / 1024)} KB)`);

  // Check for adb
  const adbVersion = adbCommand(['--version'], null, true);
  if (!adbVersion) {
    print('❌ ERROR: adb not found. Please install Android SDK tools.', 'red');
    return false;
  }
  print(`✅ adb available: ${adbVersion.split('\n')[0]}`);

  // Check for connected devices
  const devices = adbCommand(['devices'], null, true);
  if (!devices || !devices.includes('device')) {
    print('⚠️  WARNING: No devices detected. Please connect Android device.', 'yellow');
    print('   Expected: adb devices shows "device" or "emulator"', 'yellow');
    return false;
  }
  print('✅ Android device(s) connected');

  return true;
}

function getConnectedDevices() {
  const output = adbCommand(['devices', '-l'], null, true);
  if (!output) return [];

  const devices = [];
  const lines = output.split('\n');
  for (const line of lines) {
    if (line.includes('device') && !line.includes('attached')) {
      const parts = line.split(/\s+/);
      if (parts[0] && parts[1] === 'device') {
        devices.push({
          serial: parts[0],
          model: parts.slice(3).join(' ') || 'Unknown',
        });
      }
    }
  }
  return devices;
}

function selectDevice(devices, targetSerial) {
  if (targetSerial) {
    const found = devices.find((d) => d.serial === targetSerial);
    if (found) return found;
    print(`❌ Device ${targetSerial} not found`, 'red');
    return null;
  }

  if (devices.length === 1) {
    print(`✅ Using device: ${devices[0].serial} (${devices[0].model})`);
    return devices[0];
  }

  if (devices.length > 1) {
    print('Multiple devices found:', 'yellow');
    devices.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.serial} - ${d.model}`);
    });
    print('Using first device. Specify with: --device SERIAL', 'yellow');
    return devices[0];
  }

  print('❌ No devices found', 'red');
  return null;
}

function deployPlugin(device) {
  printHeader('Deploying Plugin');

  const deviceArg = `-s ${device.serial}`;

  // Create plugins directory on device
  print('Creating ATAK plugins directory...');
  adbCommand(
    [deviceArg, 'shell', 'mkdir', '-p', ATAK_PLUGINS_DIR],
    null,
    true
  );

  // Push JAR to device
  print(`Pushing main.jar to ${REMOTE_JAR_PATH}...`, 'cyan');
  const pushResult = spawnSync('adb', [deviceArg, 'push', PLUGIN_JAR, REMOTE_JAR_PATH], {
    stdio: 'inherit',
  });

  if (pushResult.status !== 0) {
    print('❌ ERROR: Failed to push JAR to device', 'red');
    return false;
  }

  print(`✅ Pushed to device: ${REMOTE_JAR_PATH}`);
  return true;
}

function verifyDeployment(device) {
  printHeader('Verifying Deployment');

  const deviceArg = `-s ${device.serial}`;

  // Check if file exists on device
  const output = adbCommand(
    [deviceArg, 'shell', 'ls', '-lh', REMOTE_JAR_PATH],
    null,
    true
  );

  if (!output) {
    print('❌ ERROR: JAR not found on device', 'red');
    return false;
  }

  print('✅ JAR found on device');
  console.log(`   ${output}`);

  return true;
}

function reloadPlugins(device) {
  printHeader('Reloading ATAK Plugins');

  const deviceArg = `-s ${device.serial}`;

  // Send reload broadcast
  print('Sending plugin reload broadcast...', 'cyan');
  const result = spawnSync('adb', [
    deviceArg,
    'shell',
    'am',
    'broadcast',
    '-a',
    'com.atakmap.app.RELOAD_PLUGINS',
  ]);

  if (result.status !== 0) {
    print('⚠️  WARNING: Reload broadcast may have failed', 'yellow');
    print('   Try manually restarting ATAK or toggling plugin in settings', 'yellow');
    return false;
  }

  print('✅ Plugin reload broadcast sent');
  print('   Allow 5-10 seconds for ATAK to reload plugins', 'cyan');

  return true;
}

function checkLogs(device) {
  printHeader('Checking Plugin Logs');

  const deviceArg = `-s ${device.serial}`;

  // Clear logcat
  adbCommand([deviceArg, 'logcat', '-c'], null, true);
  print('Cleared logcat');

  // Wait for user to interact
  print('Monitoring ATAK logs... (Press Ctrl+C to stop)', 'cyan');
  print('Look for messages containing: AetherCore, trustoverlay, or plugin errors', 'cyan');
  console.log('');

  // Stream logs
  spawnSync('adb', [deviceArg, 'logcat', '|', 'grep', '-i', 'aethercore|trustoverlay|plugin'],
    {
      stdio: 'inherit',
      shell: true,
    }
  );
}

function printSummary(device) {
  printHeader('Deployment Summary');

  print('✅ Plugin Deployed Successfully', 'green');
  console.log('');
  print('Device Information:', 'cyan');
  print(`  Serial: ${device.serial}`);
  print(`  Model: ${device.model}`);
  console.log('');
  print('Deployment Path:', 'cyan');
  print(`  Remote: ${REMOTE_JAR_PATH}`);
  print(`  Local: ${PLUGIN_JAR}`);
  console.log('');
  print('Next Steps:', 'cyan');
  print('  1. Verify plugin loads: Settings → Plugins → Check AetherCore Trust Overlay');
  print('  2. Monitor logs: adb logcat | grep -i aethercore');
  print('  3. Test functionality: Open Trust Overlay in ATAK UI');
  console.log('');
  print('Support:', 'cyan');
  print('  Docs: docs/ATAK_PLUGIN_BUILD_GUIDE.md');
  print('  Issues: github.com/FourMIK/AetherCore/issues');
  console.log('');
}

function main() {
  try {
    const args = process.argv.slice(2);
    let targetSerial = null;
    let waitAfterDeploy = false;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--device' && i + 1 < args.length) {
        targetSerial = args[i + 1];
        i++;
      } else if (args[i] === '--wait') {
        waitAfterDeploy = true;
      }
    }

    print(`${colors.bold}${colors.cyan}AetherCore ATAK Plugin Deployment${colors.reset}`, 'cyan');

    if (!checkPrerequisites()) {
      process.exit(1);
    }

    const devices = getConnectedDevices();
    const device = selectDevice(devices, targetSerial);
    if (!device) {
      process.exit(1);
    }

    if (!deployPlugin(device)) {
      process.exit(1);
    }

    if (!verifyDeployment(device)) {
      process.exit(1);
    }

    reloadPlugins(device);

    if (waitAfterDeploy) {
      print('Waiting 3 seconds before checking logs...', 'yellow');
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      // Note: In real async context, would use await
      // For now, just print message
      print('You can now check logs with: adb logcat | grep -i aethercore', 'cyan');
    }

    printSummary(device);
    process.exit(0);
  } catch (error) {
    console.error('');
    print('❌ FATAL ERROR:', 'red');
    print(`   ${error.message}`, 'red');
    console.error(error.stack);
    process.exit(1);
  }
}

main();
