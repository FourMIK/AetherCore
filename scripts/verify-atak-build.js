#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * verify-atak-build.js
 * 
 * Verifies ATAK plugin build artifacts and configuration.
 * Performs static checks without requiring runtime execution.
 * 
 * Exit codes:
 * - 0: All verification checks passed
 * - 1: One or more verification checks failed
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PLUGIN_DIR = path.join(__dirname, '..', 'plugins', 'atak-trust-overlay');
const BUILD_OUTPUT = path.join(PLUGIN_DIR, 'build', 'outputs', 'main.jar');
const DIST_OUTPUT = path.join(__dirname, '..', 'dist', 'atak', 'main.jar');

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
  console.log('═'.repeat(60));
  print(title, 'cyan');
  console.log('═'.repeat(60));
  console.log('');
}

class Verification {
  constructor(name) {
    this.name = name;
    this.passed = true;
    this.details = [];
  }

  pass(detail) {
    this.details.push(`✅ ${detail}`);
  }

  fail(detail) {
    this.passed = false;
    this.details.push(`❌ ${detail}`);
  }

  warn(detail) {
    this.details.push(`⚠️  ${detail}`);
  }

  print() {
    print(`${this.passed ? '✅' : '❌'} ${this.name}`, this.passed ? 'green' : 'red');
    for (const detail of this.details) {
      console.log(`   ${detail}`);
    }
  }
}

const verifications = [];

function verifyBuildConfiguration() {
  const v = new Verification('Build Configuration');

  // Check build.gradle.kts
  const buildGradle = path.join(PLUGIN_DIR, 'build.gradle.kts');
  if (fs.existsSync(buildGradle)) {
    v.pass('build.gradle.kts exists');
    const content = fs.readFileSync(buildGradle, 'utf8');
    if (content.includes('archiveBaseName.set("main")')) {
      v.pass('JAR name configured as "main"');
    } else {
      v.fail('JAR naming not configured correctly');
    }
  } else {
    v.fail('build.gradle.kts missing');
  }

  // Check settings.gradle.kts
  const settingsGradle = path.join(PLUGIN_DIR, 'settings.gradle.kts');
  if (fs.existsSync(settingsGradle)) {
    v.pass('settings.gradle.kts exists');
  } else {
    v.fail('settings.gradle.kts missing');
  }

  // Check gradle.properties
  const gradleProperties = path.join(PLUGIN_DIR, 'gradle.properties');
  if (fs.existsSync(gradleProperties)) {
    v.pass('gradle.properties exists');
  } else {
    v.fail('gradle.properties missing');
  }

  // Check proguard rules
  const proguard = path.join(PLUGIN_DIR, 'proguard-rules.pro');
  if (fs.existsSync(proguard)) {
    v.pass('proguard-rules.pro exists');
  } else {
    v.fail('proguard-rules.pro missing');
  }

  verifications.push(v);
}

function verifySources() {
  const v = new Verification('Source Files');

  const sourceDir = path.join(PLUGIN_DIR, 'src', 'main', 'kotlin', 'com', 'aethercore', 'atak', 'trustoverlay');

  if (fs.existsSync(sourceDir)) {
    v.pass(`Plugin source directory exists`);

    const files = fs.readdirSync(sourceDir);
    if (files.length > 0) {
      v.pass(`Found ${files.length} source file(s)`);
      
      const kotlinFiles = files.filter((f) => f.endsWith('.kt'));
      if (kotlinFiles.length > 0) {
        v.pass(`Found ${kotlinFiles.length} Kotlin file(s)`);
        kotlinFiles.slice(0, 3).forEach((f) => {
          console.log(`       - ${f}`);
        });
      } else {
        v.warn('No Kotlin files found');
      }
    } else {
      v.fail('Source directory is empty');
    }
  } else {
    v.fail('Source directory not found');
  }

  verifications.push(v);
}

function verifyManifest() {
  const v = new Verification('Android Manifest');

  const manifest = path.join(PLUGIN_DIR, 'src', 'main', 'AndroidManifest.xml');
  if (fs.existsSync(manifest)) {
    v.pass('AndroidManifest.xml exists');
    const content = fs.readFileSync(manifest, 'utf8');
    
    if (content.includes('package="com.aethercore.atak.trustoverlay"')) {
      v.pass('Package name correct');
    } else {
      v.fail('Package name not found or incorrect');
    }

    if (content.includes('minSdkVersion') || content.includes('minSdk')) {
      v.pass('Min SDK version specified');
    } else {
      v.warn('Min SDK version not in manifest (may be in build.gradle)');
    }
  } else {
    v.fail('AndroidManifest.xml missing');
  }

  verifications.push(v);
}

function verifyPluginDescriptor() {
  const v = new Verification('ATAK Plugin Descriptor');

  const descriptor = path.join(PLUGIN_DIR, 'src', 'main', 'resources', 'META-INF', 'plugin.xml');
  if (fs.existsSync(descriptor)) {
    v.pass('plugin.xml exists');
    const content = fs.readFileSync(descriptor, 'utf8');

    const checks = [
      ['AetherCore Trust Overlay', 'Plugin name'],
      ['0.2.0', 'Plugin version'],
      ['com.aethercore.atak.trustoverlay', 'Main class package'],
      ['ATAK-CIV', 'Plugin classification'],
    ];

    for (const [pattern, description] of checks) {
      if (content.includes(pattern)) {
        v.pass(`${description}: "${pattern}"`);
      } else {
        v.fail(`${description} not found: "${pattern}"`);
      }
    }
  } else {
    v.fail('plugin.xml missing');
  }

  verifications.push(v);
}

function verifyGradleWrapper() {
  const v = new Verification('Gradle Wrapper');

  const unixWrapper = path.join(PLUGIN_DIR, 'gradlew');
  const windowsWrapper = path.join(PLUGIN_DIR, 'gradlew.bat');

  if (fs.existsSync(unixWrapper)) {
    v.pass('gradlew script exists (Unix)');
  } else {
    v.fail('gradlew script missing (Unix)');
  }

  if (fs.existsSync(windowsWrapper)) {
    v.pass('gradlew.bat script exists (Windows)');
  } else {
    v.fail('gradlew.bat script missing (Windows)');
  }

  verifications.push(v);
}

function verifyBuildArtifacts() {
  const v = new Verification('Build Artifacts');

  if (fs.existsSync(BUILD_OUTPUT)) {
    const size = fs.statSync(BUILD_OUTPUT).size;
    v.pass(`main.jar exists (${Math.round(size / 1024)} KB)`);

    if (size > 1024) {
      v.pass('JAR size is valid (>1KB)');
    } else {
      v.fail(`JAR size too small: ${size} bytes`);
    }

    // Try to inspect JAR
    try {
      const listing = execSync(`jar tf "${BUILD_OUTPUT}" 2>/dev/null | head -5`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (listing.includes('META-INF')) {
        v.pass('JAR contains META-INF (valid structure)');
      }
    } catch (error) {
      v.warn('Could not inspect JAR contents (jar command not available)');
    }
  } else {
    v.warn('main.jar not yet built (expected after first build)');
  }

  if (fs.existsSync(DIST_OUTPUT)) {
    const size = fs.statSync(DIST_OUTPUT).size;
    v.pass(`Staged JAR exists at dist/atak/main.jar (${Math.round(size / 1024)} KB)`);
  } else {
    v.warn('Staged JAR not yet deployed');
  }

  verifications.push(v);
}

function verifyMonorepoIntegration() {
  const v = new Verification('Monorepo Integration');

  const packageJson = path.join(__dirname, '..', 'package.json');
  if (fs.existsSync(packageJson)) {
    const content = fs.readFileSync(packageJson, 'utf8');

    if (content.includes('"build:atak"')) {
      v.pass('build:atak script registered in package.json');
    } else {
      v.fail('build:atak script not found in package.json');
    }

    if (content.includes('"clean:atak"')) {
      v.pass('clean:atak script registered in package.json');
    } else {
      v.fail('clean:atak script not found in package.json');
    }
  } else {
    v.fail('package.json not found');
  }

  // Check .gitignore
  const gitignore = path.join(__dirname, '..', '.gitignore');
  if (fs.existsSync(gitignore)) {
    const content = fs.readFileSync(gitignore, 'utf8');
    if (content.includes('plugins/atak-trust-overlay/build')) {
      v.pass('Build artifacts excluded in .gitignore');
    } else {
      v.warn('Build artifacts not in .gitignore');
    }
  }

  verifications.push(v);
}

function verifyDocumentation() {
  const v = new Verification('Documentation');

  const docs = [
    'docs/ATAK_PLUGIN_BUILD_GUIDE.md',
    'docs/ATAK_PLUGIN_INTEGRATION_SUMMARY.md',
    'docs/ATAK_PLUGIN_FINAL_REPORT.md',
    'plugins/atak-trust-overlay/QUICKBUILD.md',
  ];

  for (const doc of docs) {
    const docPath = path.join(__dirname, '..', doc);
    if (fs.existsSync(docPath)) {
      const size = fs.statSync(docPath).size;
      v.pass(`${path.basename(doc)} exists (${Math.round(size / 1024)} KB)`);
    } else {
      v.fail(`${doc} missing`);
    }
  }

  verifications.push(v);
}

function verifyBuildScripts() {
  const v = new Verification('Build Scripts');

  const scripts = [
    'scripts/build-atak-plugin.js',
    'scripts/deploy-atak-plugin.js',
  ];

  for (const script of scripts) {
    const scriptPath = path.join(__dirname, script.replace(/^scripts/, '..\\scripts'));
    if (fs.existsSync(scriptPath)) {
      v.pass(`${path.basename(script)} exists`);
    } else {
      v.fail(`${script} missing`);
    }
  }

  verifications.push(v);
}

function printResults() {
  printHeader('Verification Results');

  let totalPassed = 0;
  let totalFailed = 0;

  for (const v of verifications) {
    v.print();
    if (v.passed) {
      totalPassed++;
    } else {
      totalFailed++;
    }
    console.log('');
  }

  printHeader('Summary');

  const allPassed = totalFailed === 0;

  if (allPassed) {
    print(`✅ All ${totalPassed} verification groups passed`, 'green');
    console.log('');
    print('Build system is ready for use:', 'cyan');
    console.log('  1. Run: pnpm run build:atak');
    console.log('  2. Verify: jar tf dist/atak/main.jar');
    console.log('  3. Deploy: node scripts/deploy-atak-plugin.js');
  } else {
    print(`❌ ${totalFailed} group(s) failed, ${totalPassed} group(s) passed`, 'red');
    console.log('');
    print('Fix the failed checks above, then run verification again.', 'yellow');
  }

  console.log('');

  return allPassed ? 0 : 1;
}

function main() {
  try {
    print(`${colors.bold}AetherCore ATAK Plugin Build Verification${colors.reset}`, 'cyan');

    verifyBuildConfiguration();
    verifySources();
    verifyManifest();
    verifyPluginDescriptor();
    verifyGradleWrapper();
    verifyBuildArtifacts();
    verifyMonorepoIntegration();
    verifyDocumentation();
    verifyBuildScripts();

    const exitCode = printResults();
    process.exit(exitCode);
  } catch (error) {
    console.error('');
    print('❌ FATAL ERROR:', 'red');
    print(`   ${error.message}`, 'red');
    console.error(error.stack);
    process.exit(1);
  }
}

main();
