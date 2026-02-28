#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * setup-atak-emulator.js
 * 
 * Complete setup automation for Visual Studio Android Emulator with ATAK-Civ
 * and AetherCore Trust Overlay plugin deployment.
 * 
 * Prerequisites:
 * - Visual Studio with Android development tools
 * - Android SDK (from VS or standalone)
 * - ADB (Android Debug Bridge)
 * 
 * This script will:
 * 1. Check prerequisites (emulator, ADB, SDK)
 * 2. Create/configure emulator if needed
 * 3. Start emulator
 * 4. Install ATAK-Civ (requires APK)
 * 5. Build trust overlay plugin
 * 6. Deploy plugin to emulator
 * 7. Verify plugin loads
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
  console.log('═'.repeat(70));
  print(title, 'cyan');
  console.log('═'.repeat(70));
  console.log('');
}

function run(command, args, description) {
  try {
    print(`${description}...`, 'cyan');
    const result = execSync(`${command} ${args.join(' ')}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch (error) {
    return null;
  }
}

function runVisible(command, args, description) {
  try {
    print(`${description}...`, 'cyan');
    const result = spawnSync(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    return result.status === 0;
  } catch (error) {
    return false;
  }
}

function checkPrerequisites() {
  printHeader('Checking Prerequisites');

  // Check for Android SDK
  let androidHome = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;

  if (!androidHome) {
    // Try to find Android SDK in common locations
    const commonPaths = [
      path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'), // Windows
      path.join(os.homedir(), 'Library', 'Android', 'sdk'), // macOS
      path.join(os.homedir(), 'Android', 'Sdk'), // Linux
      'C:\\Program Files\\Android\\Android-sdk', // Windows alt
    ];

    for (const checkPath of commonPaths) {
      if (fs.existsSync(checkPath)) {
        androidHome = checkPath;
        print(`✅ Found Android SDK: ${androidHome}`);
        process.env.ANDROID_SDK_ROOT = androidHome;
        break;
      }
    }
  } else {
    print(`✅ Android SDK: ${androidHome}`);
  }

  if (!androidHome || !fs.existsSync(androidHome)) {
    print('❌ ERROR: Android SDK not found', 'red');
    print('Install: Android SDK via Visual Studio or standalone', 'yellow');
    print('Set: ANDROID_SDK_ROOT environment variable', 'yellow');
    return false;
  }

  // Check for ADB
  const adbPath = process.platform === 'win32'
    ? path.join(androidHome, 'platform-tools', 'adb.exe')
    : path.join(androidHome, 'platform-tools', 'adb');

  if (!fs.existsSync(adbPath)) {
    print('❌ ERROR: adb not found at expected location', 'red');
    print(`Expected: ${adbPath}`, 'red');
    return false;
  }

  print(`✅ ADB available: ${adbPath}`);

  // Check for emulator
  const emulatorPath = process.platform === 'win32'
    ? path.join(androidHome, 'emulator', 'emulator.exe')
    : path.join(androidHome, 'emulator', 'emulator');

  if (!fs.existsSync(emulatorPath)) {
    print('❌ ERROR: Android emulator not found', 'red');
    print('Install: Emulator via Visual Studio or SDK Manager', 'yellow');
    return false;
  }

  print(`✅ Emulator available: ${emulatorPath}`);

  return true;
}

function findOrCreateEmulator() {
  printHeader('Emulator Configuration');

  // First, check for RUNNING devices/emulators via ADB
  try {
    const devices = execSync('adb devices -l', { encoding: 'utf8' });
    
    const runningDevices = devices
      .split('\n')
      .filter((line) => line.includes('device') && !line.includes('List of attached'))
      .map((line) => {
        const parts = line.split(/\s+/);
        return { serial: parts[0], info: parts.slice(1).join(' ') };
      });

    if (runningDevices.length > 0) {
      print('✅ Found running device(s) via ADB:');
      runningDevices.forEach((device) => {
        console.log(`   - ${device.serial} (${device.info})`);
      });

      const selectedDevice = runningDevices[0].serial;
      print(`Using: ${selectedDevice}`);

      // Verify it's API 28+
      try {
        const apiLevel = execSync(`adb -s ${selectedDevice} shell getprop ro.build.version.sdk`, {
          encoding: 'utf8',
        }).trim();

        const level = parseInt(apiLevel);
        if (level >= 28) {
          print(`✅ API Level ${level} (ATAK compatible)`);
          return selectedDevice;
        } else {
          print(`⚠️  API Level ${level} (ATAK requires 28+)`, 'yellow');
          print('Device may not fully support ATAK features', 'yellow');
          return selectedDevice; // Continue anyway
        }
      } catch (error) {
        print('✅ Running device detected (API level could not be verified)');
        return selectedDevice;
      }
    }
  } catch (error) {
    // No running devices
  }

  // If no running devices, try to list AVDs
  print('No running devices detected via ADB', 'yellow');
  print('Checking for defined emulators...', 'cyan');

  try {
    const output = execSync('emulator -list-avds', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (output && output.includes('Android')) {
      const avds = output.split('\n').filter((line) => line.trim());
      print(`✅ Found ${avds.length} emulator(s):`);
      avds.forEach((avd) => {
        console.log(`   - ${avd}`);
      });

      // Use first available
      const selectedAVD = avds[0].trim();
      print(`Using: ${selectedAVD}`);
      return selectedAVD;
    }
  } catch (error) {
    // emulator command may not work with -list-avds, that's okay
  }

  print('No emulators found', 'yellow');
  print('Attempting to create new emulator...', 'cyan');

  // Try to create new emulator
  try {
    const result = spawnSync('avdmanager', [
      'create',
      'avd',
      '-n',
      'aether-atak-api28',
      '-k',
      'system-images;android-28;google_apis;x86',
      '-d',
      'pixel',
      '--force',
    ], {
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });

    if (result.status === 0) {
      print('✅ Emulator created: aether-atak-api28');
      return 'aether-atak-api28';
    }
  } catch (error) {
    // avdmanager not available
  }

  print('⚠️  Could not create emulator automatically', 'yellow');
  print('', 'yellow');
  print('You have two options:', 'yellow');
  print('', 'yellow');
  print('OPTION 1: Use your existing running device', 'yellow');
  print('  Your VS Code emulator is running and connected!', 'yellow');
  print('  Just run: pnpm run deploy:atak', 'yellow');
  print('', 'yellow');
  print('OPTION 2: Create emulator manually', 'yellow');
  print('  1. Open SDK Manager', 'yellow');
  print('  2. Create AVD with API 28+ (ATAK requirement)', 'yellow');
  print('  3. Run this script again', 'yellow');
  print('', 'yellow');

  return null;
}

function startEmulator(avdName) {
  printHeader('Starting Emulator');

  if (!avdName) {
    print('❌ No emulator specified', 'red');
    return false;
  }

  print(`Starting: ${avdName}`, 'cyan');
  print('This may take 1-2 minutes...', 'yellow');

  // Start emulator in background
  const cmd = process.platform === 'win32'
    ? `emulator -avd ${avdName} -no-snapshot-load`
    : `emulator -avd ${avdName} -no-snapshot-load &`;

  spawnSync(cmd, {
    shell: true,
    detached: true,
    stdio: 'ignore',
  });

  print('⏳ Waiting for emulator to boot...', 'yellow');

  // Wait for emulator to be ready (max 2 minutes)
  let attempts = 0;
  const maxAttempts = 24; // 2 minutes (5 sec per check)

  while (attempts < maxAttempts) {
    try {
      const output = execSync('adb devices', { encoding: 'utf8' });
      if (output.includes('emulator-5554') && output.includes('device')) {
        print('✅ Emulator ready!');
        return true;
      }
    } catch (error) {
      // ADB not ready yet
    }

    print('.', 'yellow');
    execSync('timeout 5 2>/dev/null || sleep 5', { shell: true });
    attempts++;
  }

  print('⚠️  Emulator not responding (may still be booting)', 'yellow');
  print('Check: adb devices', 'yellow');
  return false;
}

function checkEmulatorStatus() {
  try {
    const output = execSync('adb devices', { encoding: 'utf8' });
    if (output.includes('emulator-5554') && output.includes('device')) {
      return 'emulator-5554';
    }
  } catch (error) {
    // ADB error
  }

  return null;
}

function installATAK(device) {
  printHeader('Installing ATAK-Civ');

  // Check if ATAK APK provided
  const atakAPKPath = path.join(__dirname, '..', 'atak-civ.apk');

  if (!fs.existsSync(atakAPKPath)) {
    print('⚠️  ATAK APK not found', 'yellow');
    print(`Expected: ${atakAPKPath}`, 'yellow');
    print('Manual installation:', 'cyan');
    print('  1. Download ATAK-Civ from TAK.gov', 'cyan');
    print('  2. Save as: atak-civ.apk in repository root', 'cyan');
    print('  3. Run: adb install atak-civ.apk', 'cyan');
    print('  4. Run this script again', 'cyan');
    return false;
  }

  print(`Installing: ${atakAPKPath}`, 'cyan');

  const result = spawnSync('adb', ['install', '-r', atakAPKPath], {
    stdio: 'inherit',
  });

  if (result.status === 0) {
    print('✅ ATAK-Civ installed successfully');
    return true;
  }

  print('❌ Failed to install ATAK-Civ', 'red');
  return false;
}

function checkATAKInstalled(device) {
  try {
    const output = execSync('adb shell pm list packages | grep -i atak', {
      encoding: 'utf8',
      shell: true,
    });

    if (output.includes('com.atakmap.app.civ')) {
      return true;
    }
  } catch (error) {
    // Not installed
  }

  return false;
}

function buildPlugin() {
  printHeader('Building Trust Overlay Plugin');

  print('Executing: pnpm run build:atak', 'cyan');

  const result = spawnSync('pnpm', ['run', 'build:atak'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });

  if (result.status === 0) {
    print('✅ Plugin built successfully');
    return true;
  }

  print('❌ Plugin build failed', 'red');
  return false;
}

function deployPlugin(device) {
  printHeader('Deploying Trust Overlay Plugin');

  const device_arg = device ? `-s ${device}` : '';

  // Execute deploy script
  print('Executing: pnpm run deploy:atak', 'cyan');

  const result = spawnSync('pnpm', ['run', 'deploy:atak'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });

  if (result.status === 0) {
    print('✅ Plugin deployed successfully');
    return true;
  }

  print('⚠️  Plugin deployment may need manual verification', 'yellow');
  return false;
}

function verifyPluginLoaded(device) {
  printHeader('Verifying Plugin Installation');

  print('Checking ATAK plugin directory...', 'cyan');

  try {
    const device_arg = device ? `-s ${device}` : '';
    const output = execSync(`adb ${device_arg} shell ls -lh /sdcard/atak/plugins/`, {
      encoding: 'utf8',
    });

    if (output.includes('main.jar')) {
      print('✅ Plugin JAR found on device');
      print(output);
      return true;
    }
  } catch (error) {
    print('⚠️  Could not verify plugin on device', 'yellow');
  }

  return false;
}

function printNextSteps() {
  printHeader('Next Steps');

  print('1. Launch ATAK-Civ on emulator:');
  console.log('   - Click on emulator screen');
  console.log('   - Find ATAK app in launcher');
  console.log('   - Tap to open');
  console.log('');

  print('2. Verify plugin loads:');
  console.log('   - Open Settings → Plugins');
  console.log('   - Look for "AetherCore Trust Overlay"');
  console.log('   - Status should show "Loaded"');
  console.log('');

  print('3. Monitor logs:');
  console.log('   $ adb logcat | grep -i aethercore');
  console.log('');

  print('4. Test functionality:');
  console.log('   - Open Trust Overlay in ATAK');
  console.log('   - Verify trust data displays');
  console.log('   - Check for any errors');
  console.log('');

  print('Documentation:');
  console.log('   $ cat plugins/atak-trust-overlay/QUICKBUILD.md');
  console.log('   $ cat docs/ATAK_PLUGIN_WORKFLOW.md');
  console.log('');
}

function main() {
  try {
    print(`${colors.bold}AetherCore ATAK Emulator Setup${colors.reset}`, 'cyan');
    print('Visual Studio Android Emulator + ATAK-Civ + Trust Overlay', 'cyan');
    console.log('');

    // Step 1: Check prerequisites
    if (!checkPrerequisites()) {
      process.exit(1);
    }

    // Step 2: Find or create emulator
    const avdName = findOrCreateEmulator();
    
    // If we have a device name (could be serial of running device or AVD name)
    let device = avdName;

    // Step 3: Check if it's a running device or an AVD we need to start
    let emulatorReady = false;
    
    if (avdName && avdName.startsWith('emulator-')) {
      // It's already running (detected via adb devices)
      print(`✅ Device ${avdName} is already running`);
      emulatorReady = true;
      device = avdName;
    } else if (avdName && !avdName.startsWith('emulator-')) {
      // It's an AVD name, need to start it
      emulatorReady = startEmulator(avdName);
    } else {
      // No emulator found or created
      print('Cannot proceed without emulator', 'red');
      print('Your options:', 'yellow');
      print('1. If you have VS Code embedded emulator running:', 'yellow');
      print('   Just run: pnpm run deploy:atak', 'yellow');
      print('2. If you need to create an emulator:', 'yellow');
      print('   Use Android Studio or SDK Manager to create one', 'yellow');
      process.exit(1);
    }

    // Step 4: Verify device is responding
    const checkDevice = checkEmulatorStatus();
    if (!checkDevice && !emulatorReady) {
      print('⚠️  Emulator may still be starting', 'yellow');
      print('Wait a moment and try: pnpm run deploy:atak', 'yellow');
      process.exit(0);
    } else if (checkDevice) {
      device = checkDevice;
      emulatorReady = true;
    }

    // Step 5: Check if ATAK is installed
    let atakInstalled = false;
    if (emulatorReady) {
      atakInstalled = checkATAKInstalled(device);

      if (!atakInstalled) {
        print('ATAK-Civ not installed', 'yellow');
        const atakAPKPath = path.join(__dirname, '..', 'atak-civ.apk');
        
        if (fs.existsSync(atakAPKPath)) {
          print('Found ATAK APK, installing...', 'cyan');
          if (!installATAK(device)) {
            print('⚠️  ATAK installation may have failed', 'yellow');
            print('Try manually: adb install -r atak-civ.apk', 'yellow');
          } else {
            atakInstalled = true;
          }
        } else {
          print('ATAK APK not found at repository root', 'yellow');
          print('Download from TAK.gov and save as: atak-civ.apk', 'yellow');
          print('Then run: adb install -r atak-civ.apk', 'yellow');
        }
      } else {
        print('✅ ATAK-Civ already installed');
      }
    }

    // Step 6: Build plugin
    if (!buildPlugin()) {
      process.exit(1);
    }

    // Step 7: Deploy plugin
    if (device && emulatorReady) {
      if (!deployPlugin(device)) {
        print('⚠️  Plugin deployment may need verification', 'yellow');
      }
      verifyPluginLoaded(device);
    } else {
      print('Skipping deployment (emulator not ready)', 'yellow');
      print('When ready, run: pnpm run deploy:atak', 'yellow');
    }

    // Step 8: Print next steps
    printNextSteps();

    print('✅ Setup Complete!', 'green');
    console.log('');
    print('Status:', 'cyan');
    if (device) {
      console.log(`  Device: ${device}`);
      console.log(`  Emulator Ready: ${emulatorReady}`);
      console.log(`  ATAK: ${atakInstalled ? 'Installed' : 'Not installed - install via: adb install -r atak-civ.apk'}`);
      console.log(`  Plugin: Built and staged to dist/atak/main.jar`);
    }
    console.log('');
    print('Next: Open ATAK on emulator and verify plugin loads in Settings → Plugins', 'cyan');
    console.log('');

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
