# iOS Build Guide

## Overview

This guide covers building the AetherCore iOS Secure Enclave implementation. iOS builds require proper entitlements configuration and device-only deployment due to Secure Enclave hardware requirements.

## Prerequisites

### Development Environment

- **macOS**: 12.0 (Monterey) or later
- **Xcode**: 14.0 or later
- **Swift**: 5.9 or later (bundled with Xcode)
- **iOS Device**: Physical iPhone/iPad running iOS 13.0 or later
- **Apple Developer Account**: Required for device deployment

### Command Line Tools

```bash
# Install Xcode Command Line Tools
xcode-select --install

# Verify installation
xcodebuild -version
swift --version
```

## Entitlements Requirements

### Required Entitlements

iOS Secure Enclave operations require the following entitlements in your app's provisioning profile:

1. **Application Identifier** (`com.apple.application-identifier` or `application-identifier`)
2. **Keychain Access Groups** (`keychain-access-groups`)
3. **Team Identifier** (`com.apple.developer.team-identifier`)

### Xcode Configuration

#### 1. Enable Keychain Sharing Capability

In Xcode:
1. Select your app target
2. Go to **Signing & Capabilities** tab
3. Click **+ Capability**
4. Add **Keychain Sharing**
5. Add keychain group: `com.aethercore.*`

This automatically adds `keychain-access-groups` entitlement.

#### 2. Verify Team Identifier

In Xcode:
1. Select your app target
2. Go to **Signing & Capabilities** tab
3. Verify **Team** is set to your Apple Developer team
4. Verify **Bundle Identifier** matches your app ID

#### 3. Create Entitlements File (Optional)

If not automatically created, add `AetherCore.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.application-identifier</key>
    <string>$(AppIdentifierPrefix)$(CFBundleIdentifier)</string>
    
    <key>keychain-access-groups</key>
    <array>
        <string>$(AppIdentifierPrefix)com.aethercore.*</string>
    </array>
    
    <key>com.apple.developer.team-identifier</key>
    <string>$(AppIdentifierPrefix)</string>
</dict>
</plist>
```

Add to project:
1. Drag `AetherCore.entitlements` into Xcode project
2. Select your app target
3. Go to **Build Settings** → **Code Signing Entitlements**
4. Set value to `AetherCore.entitlements`

## Build Configurations

### Local Development Build (Device)

#### Using Xcode

1. Open `packages/ios-secure-enclave/Package.swift` in Xcode
2. Select your development team in **Signing & Capabilities**
3. Connect physical iOS device
4. Select device as build target (not simulator)
5. Build and run: **Product → Run** (Cmd+R)

#### Using xcodebuild

```bash
cd packages/ios-secure-enclave

# Build for connected device
xcodebuild \
    -scheme SecureEnclaveKeyManager \
    -destination 'generic/platform=iOS' \
    -configuration Debug \
    CODE_SIGN_IDENTITY="iPhone Developer" \
    DEVELOPMENT_TEAM="YOUR_TEAM_ID" \
    build

# Install on connected device
xcodebuild \
    -scheme SecureEnclaveKeyManager \
    -destination 'id=YOUR_DEVICE_UDID' \
    -configuration Debug \
    CODE_SIGN_IDENTITY="iPhone Developer" \
    DEVELOPMENT_TEAM="YOUR_TEAM_ID" \
    test
```

**Note**: Replace `YOUR_TEAM_ID` with your Apple Developer Team ID.

### CI Build (No Code Signing)

CI environments cannot sign code or deploy to devices. Use `CODE_SIGNING_ALLOWED=NO` for compilation-only validation:

```bash
# Build without code signing (CI)
xcodebuild \
    -scheme SecureEnclaveKeyManager \
    -destination 'generic/platform=iOS' \
    -configuration Release \
    CODE_SIGNING_ALLOWED=NO \
    build
```

**What This Validates**:
- ✅ Swift compilation succeeds
- ✅ No syntax errors
- ✅ Dependencies resolve correctly
- ✅ Build settings are valid

**What This Does NOT Validate**:
- ❌ Secure Enclave operations (requires device)
- ❌ Entitlements compliance (requires signing)
- ❌ Runtime behavior (requires execution)

### Production Build (Distribution)

```bash
# Archive for App Store or Enterprise distribution
xcodebuild \
    -scheme AetherCore \
    -destination 'generic/platform=iOS' \
    -configuration Release \
    -archivePath AetherCore.xcarchive \
    CODE_SIGN_IDENTITY="iPhone Distribution" \
    DEVELOPMENT_TEAM="YOUR_TEAM_ID" \
    archive

# Export IPA
xcodebuild \
    -exportArchive \
    -archivePath AetherCore.xcarchive \
    -exportPath AetherCore_Export \
    -exportOptionsPlist ExportOptions.plist
```

**ExportOptions.plist** (example):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store</string>
    <key>teamID</key>
    <string>YOUR_TEAM_ID</string>
    <key>uploadBitcode</key>
    <false/>
    <key>uploadSymbols</key>
    <true/>
</dict>
</plist>
```

## Device-Only Restrictions

### Why Device-Only?

The iOS Secure Enclave is a **hardware security module** that:
- Does not exist on iOS Simulator
- Cannot be emulated in software
- Requires physical device deployment

**Attempting to use Secure Enclave on simulator will fail with**:
```
SecureEnclaveError.simulatorNotSupported: 
Secure Enclave is not available on iOS Simulator. 
This is a fatal error - device-only builds required.
```

### Enforce Device-Only Builds

#### Method 1: Xcode Build Settings

1. Select your app target
2. Go to **Build Settings**
3. Search for "Supported Platforms"
4. Set **Supported Platforms** to `iphoneos` (remove `iphonesimulator`)

#### Method 2: project.pbxproj

```
SUPPORTED_PLATFORMS = "iphoneos";
```

#### Method 3: Swift Package Manager

In `Package.swift`:
```swift
platforms: [
    .iOS(.v13)  // No simulator platform
]
```

### Testing on Device

```bash
# List connected devices
xcrun xctrace list devices

# Example output:
# iPhone 13 Pro (00008101-001234567890ABCD)

# Run tests on device
xcodebuild test \
    -scheme SecureEnclaveKeyManager \
    -destination 'id=00008101-001234567890ABCD' \
    CODE_SIGN_IDENTITY="iPhone Developer" \
    DEVELOPMENT_TEAM="YOUR_TEAM_ID"
```

## CI Integration

### GitHub Actions Example

```yaml
name: iOS Build

on:
  pull_request:
    paths:
      - 'packages/ios-secure-enclave/**'

jobs:
  build:
    runs-on: macos-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Select Xcode version
        run: sudo xcode-select -s /Applications/Xcode_15.0.app
      
      - name: Build iOS package (no signing)
        working-directory: packages/ios-secure-enclave
        run: |
          xcodebuild \
            -scheme SecureEnclaveKeyManager \
            -destination 'generic/platform=iOS' \
            -configuration Release \
            CODE_SIGNING_ALLOWED=NO \
            build
      
      - name: Run simulator tests (expect SEP rejection)
        working-directory: packages/ios-secure-enclave
        run: |
          xcodebuild test \
            -scheme SecureEnclaveKeyManager \
            -destination 'platform=iOS Simulator,name=iPhone 14' \
            || echo "Expected: Simulator tests fail due to SEP unavailability"
```

**Expected CI Behavior**:
- ✅ Compilation succeeds
- ⚠️ Simulator tests fail (expected due to SEP unavailability)
- ✅ Overall build marked as passing if compilation succeeds

### Validation Without Device

CI cannot fully validate Secure Enclave operations. Require manual device testing:

**Pre-Merge Checklist**:
- [ ] CI build passes (compilation)
- [ ] Manual device test confirms key generation works
- [ ] Manual device test confirms signing operations work
- [ ] Entitlements validation passes (`codesign -d --entitlements`)

## Troubleshooting

### "No signing certificate found"

**Problem**: Xcode cannot find a valid signing certificate.

**Solution**:
1. Open Xcode Preferences → Accounts
2. Add your Apple ID
3. Download manual signing certificates
4. Or enable **Automatically manage signing** in target settings

### "Provisioning profile doesn't include entitlements"

**Problem**: Your provisioning profile lacks required entitlements.

**Solution**:
1. Go to [Apple Developer Portal](https://developer.apple.com)
2. Navigate to Certificates, Identifiers & Profiles
3. Edit your App ID to include "Keychain Sharing" capability
4. Regenerate provisioning profile
5. Download and install new profile

### "Unable to install on device"

**Problem**: Device UDID not in provisioning profile.

**Solution**:
1. Connect device and get UDID: `xcrun xctrace list devices`
2. Add device UDID to Apple Developer Portal
3. Regenerate provisioning profile
4. Reinstall profile in Xcode

### "Secure Enclave key generation fails"

**Problem**: Key creation returns `errSecItemNotFound` or similar.

**Solution**:
1. Verify device is unlocked
2. Check entitlements are present: `codesign -d --entitlements :- YourApp.app`
3. Verify device supports Secure Enclave (iPhone 5s or later)
4. Check device passcode is set (required for Secure Enclave)

### "Compilation succeeds but runtime crashes"

**Problem**: Missing entitlements cause runtime failures.

**Solution**:
1. Build with signing enabled: Remove `CODE_SIGNING_ALLOWED=NO`
2. Deploy to device and check logs
3. Verify entitlements with: `codesign -d --entitlements :- YourApp.app`

## Best Practices

### 1. Use Deterministic Key Tags

```swift
// Good: Stable tag enables key reuse
let keyTag = "com.4mik.aethercore.sep.v1"

// Bad: Random tag loses key on app restart
let keyTag = "sep-\(UUID().uuidString)"
```

### 2. Validate Secure Enclave Availability Early

```swift
// In app delegate
func application(_ application: UIApplication, didFinishLaunchingWithOptions...) {
    guard SecureEnclaveKeyManager.isSupported() else {
        fatalError("Secure Enclave required but not available")
    }
}
```

### 3. Handle Entitlement Errors Gracefully

```swift
do {
    let quote = try keyManager.signNonce(nonce)
} catch SecureEnclaveError.missingEntitlements(let detail) {
    // Log to analytics, prompt user to reinstall
    print("Entitlements error: \(detail)")
    showReinstallPrompt()
} catch {
    print("Unexpected error: \(error)")
}
```

### 4. Test on Multiple Device Models

Secure Enclave behavior can vary across:
- iPhone models (5s, 6, 7, 8, X, 11, 12, 13, 14, 15)
- iPad models (iPad Pro, iPad Air with A12+)
- iOS versions (13, 14, 15, 16, 17)

### 5. Monitor Key Lifecycle

```swift
// Log key operations for diagnostics
let keyManager = SecureEnclaveKeyManager(keyTag: keyTag)
do {
    let quote = try keyManager.signNonce(nonce)
    print("✅ Key \(quote.keyTag) signed successfully")
} catch {
    print("❌ Key \(keyTag) signing failed: \(error)")
    // Send telemetry to backend
}
```

## References

- [Apple Code Signing Guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Introduction/Introduction.html)
- [Xcode Build Settings Reference](https://developer.apple.com/documentation/xcode/build-settings-reference)
- [Secure Enclave Documentation](docs/ios/SECURE_ENCLAVE.md)
- [iOS Provisioning Guide](https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution)

## Support

For build issues:
1. Check Xcode console for detailed error messages
2. Review entitlements with `codesign -d --entitlements`
3. Validate provisioning profile in Xcode settings
4. Consult `docs/ios/SECURE_ENCLAVE.md` for troubleshooting
