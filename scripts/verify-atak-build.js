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
const DESCRIPTOR_PATH = path.join(PLUGIN_DIR, 'src', 'main', 'assets', 'plugin.xml');
const JAVA_MAJOR_MAX_SUPPORTED = 24;

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

function findFilesRecursively(dir, extension, accumulator = []) {
  if (!fs.existsSync(dir)) {
    return accumulator;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findFilesRecursively(entryPath, extension, accumulator);
    } else if (entry.name.endsWith(extension)) {
      accumulator.push(entryPath);
    }
  }

  return accumulator;
}

function verifyJavaRuntimeCompatibility() {
  const v = new Verification('Java Runtime Compatibility');
  const javaHome = process.env.JAVA_HOME;

  if (!javaHome) {
    v.warn('JAVA_HOME is not set (build may fail in constrained environments)');
    verifications.push(v);
    return;
  }

  v.pass(`JAVA_HOME set: ${javaHome}`);
  const match = javaHome.match(/java\/(\d+)(?:[._]|$)/i);
  const major = match ? Number.parseInt(match[1], 10) : NaN;

  if (Number.isNaN(major)) {
    v.warn('Unable to parse Java major version from JAVA_HOME');
  } else if (major > JAVA_MAJOR_MAX_SUPPORTED) {
    v.fail(
      `Java ${major} detected. Kotlin/Gradle script compilation can fail above Java ${JAVA_MAJOR_MAX_SUPPORTED}. ` +
      'Use Java 17 or 21 (LTS) for ATAK plugin builds.'
    );
  } else {
    v.pass(`Java major version ${major} is compatible`);
  }

  verifications.push(v);
}

function verifyBuildConfiguration() {
  const v = new Verification('Build Configuration');

  const buildGradle = path.join(PLUGIN_DIR, 'build.gradle.kts');
  if (fs.existsSync(buildGradle)) {
    v.pass('build.gradle.kts exists');
    const content = fs.readFileSync(buildGradle, 'utf8');
    if (content.includes('atak.compatible.version') && content.includes('verifyAtakCompatibilityContract')) {
      v.pass('ATAK compatibility fail-visible checks configured');
    } else {
      v.warn('Could not find expected ATAK compatibility checks in build.gradle.kts');
    }
  } else {
    v.fail('build.gradle.kts missing');
  }

  for (const fileName of ['settings.gradle.kts', 'gradle.properties', 'proguard-rules.pro']) {
    const filePath = path.join(PLUGIN_DIR, fileName);
    if (fs.existsSync(filePath)) {
      v.pass(`${fileName} exists`);
    } else {
      v.fail(`${fileName} missing`);
    }
  }

  verifications.push(v);
}

function verifySources() {
  const v = new Verification('Source Files');

  const sourceDir = path.join(PLUGIN_DIR, 'src', 'main', 'kotlin', 'com', 'aethercore', 'atak', 'trustoverlay');
  if (!fs.existsSync(sourceDir)) {
    v.fail('Source directory not found');
    verifications.push(v);
    return;
  }

  v.pass('Plugin source directory exists');
  const kotlinFiles = findFilesRecursively(sourceDir, '.kt');

  if (kotlinFiles.length > 0) {
    v.pass(`Found ${kotlinFiles.length} Kotlin source file(s)`);
    kotlinFiles.slice(0, 5).forEach((filePath) => {
      console.log(`       - ${path.relative(PLUGIN_DIR, filePath)}`);
    });
  } else {
    v.fail('No Kotlin files found under plugin source tree');
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

    if (content.includes('android:label')) {
      v.pass('Application label configured');
    } else {
      v.warn('Application label not found in manifest');
    }
  } else {
    v.fail('AndroidManifest.xml missing');
  }

  verifications.push(v);
}

function verifyPluginDescriptor() {
  const v = new Verification('ATAK Plugin Descriptor');

  if (fs.existsSync(DESCRIPTOR_PATH)) {
    v.pass('plugin.xml exists');
    const content = fs.readFileSync(DESCRIPTOR_PATH, 'utf8');

    const checks = [
      ['AetherCore Trust Overlay', 'Plugin name'],
      ['com.aethercore.atak.trustoverlay', 'Plugin ID/package'],
      ['TrustOverlayLifecycle', 'Entry point'],
      ['atak-api', 'ATAK API compatibility tag'],
    ];

    for (const [pattern, description] of checks) {
      if (content.includes(pattern)) {
        v.pass(`${description}: "${pattern}"`);
      } else {
        v.fail(`${description} not found: "${pattern}"`);
      }
    }
  } else {
    v.fail(`plugin.xml missing at ${path.relative(PLUGIN_DIR, DESCRIPTOR_PATH)}`);
  }

  verifications.push(v);
}

function verifyGradleWrapper() {
  const v = new Verification('Gradle Wrapper');

  for (const wrapperFile of ['gradlew', 'gradlew.bat']) {
    const wrapperPath = path.join(PLUGIN_DIR, wrapperFile);
    if (fs.existsSync(wrapperPath)) {
      v.pass(`${wrapperFile} exists`);
    } else {
      v.fail(`${wrapperFile} missing`);
    }
  }

  const wrapperJar = path.join(PLUGIN_DIR, 'gradle', 'wrapper', 'gradle-wrapper.jar');
  if (fs.existsSync(wrapperJar)) {
    v.pass('gradle-wrapper.jar exists');
  } else {
    v.warn('gradle-wrapper.jar missing (system Gradle fallback required)');
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
    'plugins/atak-trust-overlay/README.md',
    'plugins/atak-trust-overlay/QUICKSTART.md',
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

  const scripts = ['scripts/build-atak-plugin.js', 'scripts/deploy-atak-plugin.js'];

  for (const script of scripts) {
    const scriptPath = path.join(__dirname, '..', script);
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
  } else {
    print(`❌ ${totalFailed} group(s) failed, ${totalPassed} group(s) passed`, 'red');
    print('Fix the failed checks above, then run verification again.', 'yellow');
  }

  console.log('');
  return allPassed ? 0 : 1;
}

function main() {
  try {
    print(`${colors.bold}AetherCore ATAK Plugin Build Verification${colors.reset}`, 'cyan');

    verifyJavaRuntimeCompatibility();
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
