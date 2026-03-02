# iOS Client Build Guide

**Classification:** UNCLASSIFIED  
**Purpose:** Build and deployment instructions for AetherCore iOS Messenger  
**Last Updated:** 2026-03-02

---

## Overview

AetherCore iOS Messenger is a Secure Enclave-enabled client for the AetherCore hardware-rooted trust fabric. It implements hardware-backed key storage and signing operations using iOS Secure Enclave.

**Key Characteristics:**
- iOS 17+ baseline (device-only)
- Secure Enclave required (no simulator support)
- Mac Catalyst disabled
- Hardware-rooted identity mandatory

---

## Toolchain Requirements

### Required Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Xcode | 15.2+ | iOS SDK, Swift compiler, build system |
| iOS SDK | 17.0+ | Target platform APIs |
| macOS | 14+ (Sonoma) | Host development environment |

### Installation

```bash
# Install Xcode from App Store or download from developer.apple.com
# After installation, accept license:
sudo xcodebuild -license accept

# Verify installation
xcodebuild -version
# Expected: Xcode 15.2+

# Check available SDKs
xcodebuild -showsdks | grep iphoneos
# Expected: iphoneos17.0+
```

---

## Project Structure

```
clients/ios/AetherCoreMessenger/
├── AetherCoreMessenger.xcodeproj/   # Xcode project
│   └── project.pbxproj              # Project configuration
├── AetherCoreMessenger/             # Source code
│   ├── App.swift                    # SwiftUI app entry (Secure Enclave guard)
│   ├── ContentView.swift            # Minimal UI
│   ├── Security/                    # Secure Enclave implementation
│   │   ├── SecureEnclaveKeyManager.swift  # Key generation, signing
│   │   └── DeviceIdentity.swift     # Device fingerprint wrapper
│   ├── Genesis/                     # Genesis bundle for enrollment
│   │   └── GenesisBundle.swift      # Attestation placeholder
│   ├── Info.plist                   # App metadata
│   └── AetherCoreMessenger.entitlements  # Keychain access
└── .gitignore                       # Build artifacts exclusion
```

---

## Building Locally

### Prerequisites

1. **Physical iOS Device Required:**
   - iPhone 5s or later (Secure Enclave support)
   - iPad Air 2 or later
   - Device passcode must be set
   - Connected to Mac via USB or Wi-Fi

2. **Apple Developer Account:**
   - Free Apple ID (for local development)
   - Or paid Apple Developer Program membership (for distribution)

3. **Code Signing Certificate:**
   - Xcode automatically provisions a development certificate
   - Team provisioning profile required for device deployment

### Build Commands

#### Option 1: Xcode GUI

```bash
# Open project
open clients/ios/AetherCoreMessenger/AetherCoreMessenger.xcodeproj

# In Xcode:
# 1. Select your development team: Project Settings → Signing & Capabilities
# 2. Connect iOS device via USB
# 3. Select device as destination: Product → Destination → [Your Device]
# 4. Build and run: Product → Run (⌘R)
```

#### Option 2: Command Line (xcodebuild)

```bash
cd clients/ios/AetherCoreMessenger

# Build for connected device
xcodebuild \
  -project AetherCoreMessenger.xcodeproj \
  -scheme AetherCoreMessenger \
  -destination 'platform=iOS,name=<DEVICE_NAME>' \
  -configuration Debug \
  build

# Replace <DEVICE_NAME> with your device name from:
xcrun xctrace list devices
```

---

## CI Build (GitHub Actions)

### CI Configuration

The iOS client is built on GitHub Actions using macOS runners. See `.github/workflows/ios-client.yml`.

**CI Build Characteristics:**
- **Runner:** `macos-14`
- **Xcode Version:** 15.2
- **Destination:** `generic/platform=iOS` (device architecture, no signing)
- **Code Signing:** Disabled (`CODE_SIGNING_ALLOWED=NO`)
- **Triggers:** Changes to `clients/ios/**` or workflow file

### Running CI Locally

You can replicate CI builds locally:

```bash
cd clients/ios/AetherCoreMessenger

# Build without code signing (CI mode)
xcodebuild \
  -project AetherCoreMessenger.xcodeproj \
  -scheme AetherCoreMessenger \
  -destination 'generic/platform=iOS' \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO \
  clean build
```

**Expected Output:**
```
** BUILD SUCCEEDED **
```

### DerivedData Caching

CI caches `~/Library/Developer/Xcode/DerivedData` for faster builds. To clear locally:

```bash
# Clear derived data cache
rm -rf ~/Library/Developer/Xcode/DerivedData/AetherCoreMessenger-*

# Or use Xcode: Product → Clean Build Folder (⇧⌘K)
```

---

## Linting (Optional)

### SwiftLint

Install SwiftLint for code style enforcement:

```bash
# Install via Homebrew
brew install swiftlint

# Run lint
cd clients/ios/AetherCoreMessenger
swiftlint lint

# Auto-fix issues (where possible)
swiftlint --fix
```

CI automatically runs SwiftLint if available (non-blocking).

---

## Troubleshooting

### "Secure Enclave unavailable" Error

**Symptom:** App crashes with "FAIL-VISIBLE: Secure Enclave unavailable"

**Causes:**
1. Running on simulator (explicitly unsupported)
2. Device passcode not set
3. Device does not have Secure Enclave (too old)

**Solution:**
```bash
# Deploy to physical device only
# Ensure device passcode is set: Settings → Face ID & Passcode → Turn Passcode On
```

### Code Signing Issues

**Symptom:** "Code signing is required for product type 'Application' in SDK 'iOS 17.0'"

**Solution:**
```bash
# In Xcode: Project Settings → Signing & Capabilities
# 1. Enable "Automatically manage signing"
# 2. Select your Apple ID team
# 3. Wait for provisioning profile generation
```

### Keychain Access Denied

**Symptom:** "SecItemCopyMatching returned errSecInteractionNotAllowed"

**Cause:** Device locked or keychain access restricted

**Solution:**
- Unlock device before launching app
- Ensure keychain access entitlement is present (already configured)

---

## Deployment Notes

### Device-Only Deployment

- **Simulator is explicitly unsupported** due to lack of Secure Enclave
- All testing must occur on physical iOS devices
- Simulator deployment will trigger fatal error with diagnostic message

### Mac Catalyst

- **Mac Catalyst is disabled** (`SUPPORTS_MACCATALYST = NO`)
- AetherCore iOS client is iOS-exclusive
- For macOS, use the Tauri-based desktop app (see `packages/dashboard/`)

### Minimum Device Requirements

| Device Family | Minimum Model | Secure Enclave | iOS Version |
|---------------|---------------|----------------|-------------|
| iPhone | iPhone 5s | ✅ | iOS 17+ |
| iPad | iPad Air 2 | ✅ | iOS 17+ |
| iPad Pro | All models | ✅ | iOS 17+ |
| iPod touch | 7th gen | ✅ | iOS 17 (if supported) |

---

## Next Steps

- **Security Policy:** See [SECURE_ENCLAVE.md](SECURE_ENCLAVE.md) for key management details
- **Integration:** Future gateway connectivity (not yet implemented)
- **Attestation:** DeviceCheck integration (placeholder currently)

---

## Support

For build issues:
1. Check Xcode version: `xcodebuild -version`
2. Verify device connection: `xcrun xctrace list devices`
3. Review CI logs: `.github/workflows/ios-client.yml`
4. Consult AetherCore monorepo docs: `/docs/`
