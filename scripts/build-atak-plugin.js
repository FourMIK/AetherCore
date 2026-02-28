#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * build-atak-plugin.js
 * 
 * Builds the ATAK-Civ plugin (main.jar) for deployment.
 * Enforces fail-visible build requirements per AetherCore doctrine.
 * 
 * Exit codes:
 * - 0: Build succeeded, main.jar verified
 * - 1: Build failed or verification failed
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PLUGIN_DIR = path.join(__dirname, '..', 'plugins', 'atak-trust-overlay');
const OUTPUT_JAR = path.join(PLUGIN_DIR, 'build', 'outputs', 'main.jar');
const DIST_DIR = path.join(__dirname, '..', 'dist', 'atak');
const DIST_JAR = path.join(DIST_DIR, 'main.jar');

// ANSI color codes
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

function checkPrerequisites() {
  printHeader('Checking Prerequisites');
  
  // Check if plugin directory exists
  if (!fs.existsSync(PLUGIN_DIR)) {
    print('❌ ERROR: Plugin directory not found:', 'red');
    print(`   Expected: ${PLUGIN_DIR}`, 'red');
    return false;
  }
  
  // Check for build.gradle.kts
  const buildFile = path.join(PLUGIN_DIR, 'build.gradle.kts');
  if (!fs.existsSync(buildFile)) {
    print('❌ ERROR: build.gradle.kts not found', 'red');
    print(`   Expected: ${buildFile}`, 'red');
    return false;
  }
  
  // Check for Gradle wrapper (if exists)
  const gradlewCmd = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
  const hasLocalGradle = fs.existsSync(path.join(PLUGIN_DIR, gradlewCmd));
  
  // Check for system Gradle
  let hasSystemGradle = false;
  try {
    execSync('gradle --version', { stdio: 'pipe' });
    hasSystemGradle = true;
  } catch (error) {
    // Gradle not in PATH
  }
  
  if (!hasLocalGradle && !hasSystemGradle) {
    print('⚠️  WARNING: No Gradle wrapper found in plugin directory', 'yellow');
    print('   Attempting to use system Gradle...', 'yellow');
    
    if (!hasSystemGradle) {
      print('❌ ERROR: Gradle not found. Please install Gradle or run:', 'red');
      print('   cd plugins/atak-trust-overlay && gradle wrapper', 'red');
      return false;
    }
  }
  
  print('✅ Prerequisites check passed', 'green');
  console.log('');
  return true;
}

function cleanBuild() {
  printHeader('Cleaning Previous Build');
  
  const buildDir = path.join(PLUGIN_DIR, 'build');
  if (fs.existsSync(buildDir)) {
    print(`Removing ${buildDir}...`);
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  
  if (fs.existsSync(DIST_JAR)) {
    print(`Removing ${DIST_JAR}...`);
    fs.unlinkSync(DIST_JAR);
  }
  
  print('✅ Clean complete', 'green');
  console.log('');
}

function buildPlugin() {
  printHeader('Building ATAK Plugin');

  const pluginDir = path.join(__dirname, '..', 'plugins', 'atak-trust-overlay');
  
  // Determine which gradle command to use
  let gradleCmd = 'gradle';
  let gradleArgs = ['assembleMainJar'];
  
  const isWindows = process.platform === 'win32';
  const wrapperPath = isWindows
    ? path.join(pluginDir, 'gradlew.bat')
    : path.join(pluginDir, 'gradlew');

  // Check if wrapper exists
  if (fs.existsSync(wrapperPath)) {
    gradleCmd = wrapperPath;
    print('Using bundled Gradle wrapper', 'cyan');
  } else {
    print('Gradle wrapper not found, checking for system Gradle...', 'yellow');
    
    // Try to find system gradle
    try {
      execSync('gradle --version', { stdio: 'pipe' });
      print('Using system Gradle', 'cyan');
    } catch (error) {
      print('❌ ERROR: Gradle not found', 'red');
      print('', 'red');
      print('Solutions:', 'yellow');
      print('1. Install Gradle globally:', 'yellow');
      print('   Windows: choco install gradle', 'yellow');
      print('   macOS: brew install gradle', 'yellow');
      print('   Linux: sudo apt-get install gradle', 'yellow');
      print('', 'yellow');
      print('2. Or download Gradle manually:', 'yellow');
      print('   https://gradle.org/releases/', 'yellow');
      print('   Extract to: gradle/ in plugin directory', 'yellow');
      print('', 'yellow');
      return false;
    }
  }

  print(`Executing: ${gradleCmd} ${gradleArgs.join(' ')}`, 'cyan');
  console.log('');

  const result = spawnSync(gradleCmd, gradleArgs, {
    cwd: pluginDir,
    stdio: 'inherit',
    shell: isWindows,
  });

  console.log('');
  
  if (result.status !== 0) {
    print('❌ BUILD FAILED', 'red');
    print(`   Gradle exited with code ${result.status}`, 'red');
    print('', 'red');
    
    // Check if it was a download error
    print('Possible issues:', 'yellow');
    print('1. Internet connection - check connectivity', 'yellow');
    print('2. Firewall/Proxy - may be blocking downloads', 'yellow');
    print('3. Gradle download timeout - try again', 'yellow');
    print('', 'yellow');
    
    print('Manual solutions:', 'yellow');
    print(`   cd ${pluginDir}`, 'yellow');
    print('   # Option A: Try build again', 'yellow');
    print('   gradlew.bat assembleMainJar', 'yellow');
    print('', 'yellow');
    print('   # Option B: Download Gradle manually', 'yellow');
    print('   # 1. Download: https://gradle.org/releases/', 'yellow');
    print('   # 2. Extract to: gradle/gradle-8.5/', 'yellow');
    print('   # 3. Run: gradlew.bat assembleMainJar', 'yellow');
    print('', 'yellow');
    
    return false;
  }

  // Verify JAR was actually created
  const jarPath = path.join(pluginDir, 'build', 'outputs', 'main.jar');
  if (!fs.existsSync(jarPath)) {
    print('❌ BUILD REPORTED SUCCESS BUT main.jar NOT FOUND', 'red');
    print(`   Expected: ${jarPath}`, 'red');
    print('', 'red');
    print('This suggests Gradle did not actually complete successfully.', 'red');
    print('Try:', 'yellow');
    print(`   cd ${pluginDir}`, 'yellow');
    print('   gradlew.bat assembleMainJar --stacktrace --info', 'yellow');
    return false;
  }

  print('✅ Build succeeded', 'green');
  console.log('');
  return true;
}

function verifyArtifact() {
  printHeader('Verifying main.jar');
  
  // Check if JAR exists
  if (!fs.existsSync(OUTPUT_JAR)) {
    print('❌ FAIL-VISIBLE: main.jar not found', 'red');
    print(`   Expected: ${OUTPUT_JAR}`, 'red');
    return false;
  }
  
  // Check JAR size
  const stats = fs.statSync(OUTPUT_JAR);
  const sizeKB = Math.round(stats.size / 1024);
  
  if (stats.size < 1024) {
    print('❌ FAIL-VISIBLE: main.jar size too small', 'red');
    print(`   Size: ${stats.size} bytes`, 'red');
    return false;
  }
  
  print('✅ Artifact verification passed', 'green');
  print(`   Location: ${OUTPUT_JAR}`);
  print(`   Size: ${sizeKB} KB (${stats.size} bytes)`);
  console.log('');
  
  return true;
}

function stageArtifact() {
  printHeader('Staging Artifact for Deployment');
  
  // Create dist directory
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }
  
  // Copy JAR to dist
  fs.copyFileSync(OUTPUT_JAR, DIST_JAR);
  
  print('✅ Artifact staged', 'green');
  print(`   Deployment path: ${DIST_JAR}`);
  console.log('');
}

function generateChecksum() {
  printHeader('Generating Checksums (BLAKE3)');
  
  print('⚠️  Note: BLAKE3 calculation requires external tool', 'yellow');
  print('   For production, integrate with crates/crypto', 'yellow');
  
  // For now, just document the requirement
  const crypto = require('crypto');
  const fileBuffer = fs.readFileSync(DIST_JAR);
  const sha256Hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  
  print(`   SHA-256 (fallback): ${sha256Hash}`, 'yellow');
  print('   ⚠️  REMINDER: Replace with BLAKE3 for production', 'yellow');
  console.log('');
}

function printSummary() {
  printHeader('Build Summary');
  
  print(`${colors.bold}${colors.green}✅ ATAK Plugin Build Complete${colors.reset}`);
  console.log('');
  print('Artifacts:', 'cyan');
  print(`  - Build output: ${OUTPUT_JAR}`);
  print(`  - Deployment:   ${DIST_JAR}`);
  console.log('');
  print('Next Steps:', 'cyan');
  print('  1. Verify JAR contents: jar tf dist/atak/main.jar');
  print('  2. Deploy to ATAK device/emulator');
  print('  3. Verify plugin loads in ATAK');
  console.log('');
}

function main() {
  try {
    print(`${colors.bold}AetherCore ATAK-Civ Plugin Builder${colors.reset}`, 'cyan');
    
    if (!checkPrerequisites()) {
      process.exit(1);
    }
    
    cleanBuild();
    
    if (!buildPlugin()) {
      process.exit(1);
    }
    
    if (!verifyArtifact()) {
      process.exit(1);
    }
    
    stageArtifact();
    generateChecksum();
    printSummary();
    
    process.exit(0);
  } catch (error) {
    console.error('');
    print('❌ FATAL ERROR:', 'red');
    print(`   ${error.message}`, 'red');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run main function
main();
