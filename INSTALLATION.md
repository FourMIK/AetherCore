# AetherCore Tactical Glass - Installation Guide

**Classification:** OPERATIONAL  
**Mission:** Desktop Application Installation Procedures  
**Last Updated:** 2026-01-04

---

## Overview

This guide provides comprehensive installation instructions for AetherCore Tactical Glass desktop application across all supported platforms.

## Table of Contents

- [Commander Edition (Default First-Run Path)](#commander-edition-default-first-run-path)
- [Appendix A: Advanced/Engineering Paths](#appendix-a-advancedengineering-paths)
- [System Requirements](#system-requirements)
- [Pre-Installation Checklist](#pre-installation-checklist)
- [Platform-Specific Installation](#platform-specific-installation)
  - [Linux (Ubuntu/Debian)](#linux-ubuntudebian)
  - [macOS](#macos)
  - [Windows](#windows)
- [Post-Installation Configuration](#post-installation-configuration)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
- [Uninstallation](#uninstallation)

---

## Commander Edition (Default First-Run Path)

**Commander Edition** is the only supported first-run default for Tactical Glass desktop operators.

- Backed by the Local Control Plane startup contract in [docs/LOCAL_CONTROL_PLANE.md](docs/LOCAL_CONTROL_PLANE.md).
- Boots required local services and blocks UI readiness until health checks pass.
- Runs first-launch bootstrap automatically (no mode selection required).

**Acceptance criteria:** A non-technical user can complete first deployment from the desktop UI without terminal usage.

## Appendix A: Advanced/Engineering Paths

Use these only when explicitly needed after Commander Edition onboarding:

- **Cloud/internal mode (advanced):** Connect Tactical Glass to pre-existing remote/internal services.
- **Dev-only compose mode (advanced):** Use `infra/docker/docker-compose.yml` only for development/test workflows.

> Deprecation: prior instructions that treated cloud/dev as parallel first-run defaults are deprecated.

---

## System Requirements

### Desktop Minimum Requirements

Based on Performance Benchmarks (see [docs/PERFORMANCE_BENCHMARKS.md](docs/PERFORMANCE_BENCHMARKS.md))

**Operating System:**
- **Linux**: Ubuntu 20.04+, Debian 11+, or equivalent
- **macOS**: 11.0 (Big Sur) or later (Intel and Apple Silicon supported)
- **Windows**: 10 (1809+) or Windows 11

**Hardware:**
- **Processor**: 
  - Minimum: 2-core x86_64 CPU @ 2.0 GHz
  - Recommended: 4-core x86_64 CPU @ 2.5 GHz+
- **RAM**: 
  - Minimum: 4GB
  - Recommended: 8GB
  - Large deployments (>100 nodes): 16GB
- **Storage**: 500MB free space
- **Network**: Internet connection for testnet access; low-latency LAN for C2 operations

**TPM Requirements (Production Only):**
- TPM 2.0 hardware module (Windows/Linux)
- Secure Enclave (macOS)

---

## Pre-Installation Checklist

Before installing AetherCore Tactical Glass, ensure:

- [ ] System meets minimum requirements
- [ ] Admin/sudo privileges available (for system-wide installation)
- [ ] Firewall configured to allow required ports
- [ ] Existing antivirus software won't block the application
- [ ] Downloaded installer is listed in `release-manifest.json` for the selected release tag
- [ ] SBOM artifacts reviewed (see [PROVENANCE.md](PROVENANCE.md))

**Security Verification (manifest-first):**

```bash
# 1) Download release-manifest.json + signature from the release tag
# 2) Verify manifest signature + all artifact hashes before install
python3 scripts/verify-release-manifest.py   --manifest ./release-manifest.json   --artifacts-dir .   --public-key ./release-manifest-public.pem
```

Only install `.dmg` and `.msi` artifacts that are explicitly listed in `release-manifest.json` for the selected tag. Provenance JSON and checksum bundles remain attached for audit workflows (details in [PROVENANCE.md](PROVENANCE.md)).

**Release integrity assets (per tag):**
- `release-manifest.json`
- `release-manifest.json.sig`
- `SHA256SUMS-macos.txt`
- `SHA256SUMS-macos.txt.sig`
- `SHA256SUMS-windows.txt`
- `SHA256SUMS-windows.txt.sig`
- `provenance-macos.json`
- `provenance-windows.json`

Download these from the same release page as your installer artifact:
`https://github.com/FourMIK/AetherCore/releases/tag/<tag>`

For provenance verification policy and attestation details, see [PROVENANCE.md](PROVENANCE.md).

---

## Platform-Specific Installation

### Linux (Ubuntu/Debian)

> Linux desktop binaries are not distributed as release handoff artifacts. Build from source for Linux environments.

#### Method 1: AppImage (Recommended)

**1. Download the AppImage:**

```bash
wget https://github.com/FourMIK/AetherCore/releases/latest/download/aethercore-commander_amd64.AppImage
```

**2. Verify integrity:**

```bash
shasum -a 256 aethercore-commander_amd64.AppImage
# Validate with scripts/verify-release-manifest.py output
```

**3. Make executable:**

```bash
chmod +x aethercore-commander_amd64.AppImage
```

**4. Run the application:**

```bash
./aethercore-commander_amd64.AppImage
```

**5. (Optional) Install system dependencies for native look:**

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-dev
```

**6. (Optional) Create desktop entry:**

```bash
# Create desktop entry for app launcher
cat > ~/.local/share/applications/aethercore-commander.desktop << EOF
[Desktop Entry]
Name=AetherCore Commander
Exec=/path/to/aethercore-commander_amd64.AppImage
Icon=application-x-executable
Type=Application
Categories=Network;Utility;
EOF
```

#### Troubleshooting Linux Installation

**Issue:** `FUSE not found`  
**Solution:**
```bash
sudo apt-get install fuse libfuse2
```

**Issue:** `cannot execute binary file`  
**Solution:**
```bash
# Verify architecture
file aethercore-commander_amd64.AppImage
# Should show "x86-64" or "x86_64"
```

---

### macOS

#### Installation Steps

**1. Download the DMG file:**

Visit [GitHub Releases](https://github.com/FourMIK/AetherCore/releases/latest), open `release-manifest.json`, and download the `.dmg` artifact entry listed for `platform: macos`.

**2. Verify integrity:**

```bash
shasum -a 256 aethercore-commander.dmg
# Validate with scripts/verify-release-manifest.py output
```

**3. Open the DMG:**

Double-click the downloaded `.dmg` file to mount it.

**4. Install the application:**

Drag "AetherCore Commander" to the "Applications" folder shortcut in the DMG window.

**5. First launch:**

Launch from `/Applications` normally. Production release builds are Developer ID signed, notarized, and stapled; Gatekeeper should validate trust chain automatically.

#### Troubleshooting macOS Installation

**Issue:** "App is damaged and can't be opened"  
**Solution:** Re-download from the official GitHub release, then verify the matching platform checksum file and signature (`SHA256SUMS-<platform>.txt` + `.sig`) before retrying. If the issue persists, confirm your macOS trust store and date/time are correct.

**Issue:** "Code signature invalid"  
**Solution:** Re-download the DMG from official GitHub releases. Verify checksum matches.

**Issue:** Application crashes on launch  
**Solution:** Check macOS version is 11.0+. For Apple Silicon, ensure Rosetta 2 is not interfering with native ARM build.

---

### Windows

#### Installation Steps

**1. Download the MSI installer:**

Visit [GitHub Releases](https://github.com/FourMIK/AetherCore/releases/latest), open `release-manifest.json`, and download the `.msi` artifact entry listed for `platform: windows`.

**2. Verify integrity:**

Open PowerShell and run:
```powershell
Get-FileHash aethercore-commander.msi -Algorithm SHA256
# Validate with scripts/verify-release-manifest.py output
```

**3. Run the installer:**

Double-click the `.msi` file to launch the installer.

**4. Trust validation:**

Production MSI artifacts are Authenticode-signed with trusted timestamping. SmartScreen reputation should build from the signed chain; do not bypass warnings on managed endpoints.

**5. Follow installation wizard:**

- Choose installation location (default: `C:\Program Files\AetherCore Commander\`)
- Select "Install for all users" or "Install for current user only"
- Click "Install"

**6. Launch:**

- From Start Menu: Search "AetherCore Commander"
- From Desktop: Double-click shortcut (if created during installation)

#### Silent Installation (Enterprise Deployment)

For automated/silent installation:

```batch
msiexec /i aethercore-commander.msi /quiet /qn /norestart
```

#### Troubleshooting Windows Installation

**Issue:** "VCRUNTIME140.dll was not found"  
**Solution:** Install [Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe)

**Issue:** "Installation failed with error 1603"  
**Solution:**
- Run installer as Administrator
- Ensure sufficient disk space (500MB+)
- Check Windows Event Viewer for detailed error

**Issue:** Windows Defender or endpoint security blocks installation  
**Solution:**
1. Do **not** bypass or disable endpoint protections as a normal install path.
2. Re-download from the official release tag and verify `release-manifest.json` signature plus checksums.
3. Confirm the MSI Authenticode signature and trusted timestamp are present.
4. If policy still blocks install, escalate to security/IT allow-list workflow with the release provenance bundle.

---

## Post-Installation Configuration

### Initial Setup

**1. Launch Tactical Glass**

Open the application using your platform's standard method.

**Desktop default behavior:** Tactical Glass now boots in **Commander Edition** and blocks UI readiness until required local services are healthy. Commander Edition uses the Local Control Plane manifest (`config/local-control-plane.toml`), including startup order and health gates (see [docs/LOCAL_CONTROL_PLANE.md](docs/LOCAL_CONTROL_PLANE.md)).

**2. First-Run Configuration Wizard**

Commander Edition first launch is guided and automatic. The app performs environment checks, starts required local services, validates mesh/dashboard connectivity, and deploys the first node without manual endpoint entry or terminal usage.

**3. Network Configuration**

Configure firewall rules to allow mesh communication:

**Linux/macOS:**
```bash
# Allow testnet connection
sudo ufw allow 8443/tcp

# Allow mesh P2P ports
sudo ufw allow 7000:7100/tcp
sudo ufw allow 7000:7100/udp
```

**Windows (PowerShell as Admin):**
```powershell
New-NetFirewallRule -DisplayName "AetherCore Testnet" -Direction Inbound -LocalPort 8443 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "AetherCore Mesh" -Direction Inbound -LocalPort 7000-7100 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "AetherCore Mesh UDP" -Direction Inbound -LocalPort 7000-7100 -Protocol UDP -Action Allow
```

### Production Configuration (Engineering Appendix)

For production deployments, refer to:
- **Security hardening**: [SECURITY.md](SECURITY.md)
- **TPM integration**: [services/collaboration/TPM_INTEGRATION_V2.md](services/collaboration/TPM_INTEGRATION_V2.md)
- **Deployment playbook**: [docs/production-deployment-playbook.md](docs/production-deployment-playbook.md)

---

## Verification

### Verify Installation

**1. Application launches successfully**

The AetherCore Commander window should open without errors.

**2. Check version information**

In the app: Settings → About → Version should match your downloaded release.

**3. Test testnet connectivity**

Navigate to Settings → Testnet → Click "Test Connection"

Expected result: "Connected to testnet successfully"

**4. Verify cryptographic functions**

```bash
# From application logs (location varies by platform):
# Linux: ~/.config/aethercore-commander/logs/
# macOS: ~/Library/Logs/aethercore-commander/
# Windows: %APPDATA%\aethercore-commander\logs\

# Look for successful Ed25519 key generation:
grep "Ed25519 key pair generated" aethercore-commander.log
```

### Installation Verification Script

**Linux/macOS:**
```bash
#!/bin/bash
echo "=== AetherCore Installation Verification ==="

# Check if binary exists
if [ -f "./aethercore-commander_amd64.AppImage" ]; then
    echo "✓ Application binary found"
else
    echo "✗ Application binary not found"
    exit 1
fi

# Check if executable
if [ -x "./aethercore-commander_amd64.AppImage" ]; then
    echo "✓ Application is executable"
else
    echo "✗ Application is not executable"
    exit 1
fi

# Check network connectivity
if nc -zv testnet.aethercore.local 8443 2>&1 | grep -q succeeded; then
    echo "✓ Testnet endpoint reachable"
else
    echo "⚠ Testnet endpoint not reachable (may be offline)"
fi

echo "=== Verification Complete ==="
```

---

## Troubleshooting

### Common Issues Across All Platforms

#### Issue: WebSocket Connection Failed

**Symptoms:** Cannot connect to testnet, "Connection refused" error

**Diagnosis:**
1. Verify endpoint URL is correct
2. Check firewall allows port 8443
3. Ensure testnet is running and reachable
4. Test connectivity: `telnet testnet.aethercore.local 8443` (or `nc`)

**Resolution:**
```bash
# Test connectivity
curl -I https://testnet.aethercore.local:8443

# Check firewall status
# Linux:
sudo ufw status

# macOS:
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Windows:
netsh advfirewall show allprofiles
```

#### Issue: High CPU Usage

**Symptoms:** Application consumes >25% CPU at idle

**Diagnosis:** Check trust mesh size and update interval

**Resolution:**
1. Reduce trust mesh update frequency: Settings → Trust Mesh → Update Interval (increase from 60s to 120s)
2. Reduce fleet size (<50 units for 4GB RAM systems)
3. Check for Byzantine node detection loops (see logs)

#### Issue: QR Code Generation Fails

**Symptoms:** Zero-Touch Enrollment QR code doesn't generate

**Diagnosis:** Check camera permissions or rendering issues

**Resolution:**
1. Restart application
2. Check operator identity and squad ID are valid (alphanumeric, no spaces)
3. Ensure Ed25519 signing context initialized (check logs)

### Getting Support

If issues persist after troubleshooting:

**1. Collect diagnostics:**
- Application version (`Settings → About`)
- Operating system and version
- Relevant log excerpts (last 50 lines)
- Error messages or screenshots

**2. File a GitHub issue:**

Visit [AetherCore Issues](https://github.com/FourMIK/AetherCore/issues) and create a new issue with:
- Descriptive title
- Steps to reproduce
- Expected vs actual behavior
- Diagnostic information from step 1

---

## Uninstallation

### Linux

**AppImage:**
```bash
# Simply delete the AppImage file
rm ~/Downloads/aethercore-commander_amd64.AppImage

# Remove desktop entry (if created)
rm ~/.local/share/applications/aethercore-commander.desktop

# Remove application data
rm -rf ~/.config/aethercore-commander/
rm -rf ~/.local/share/aethercore-commander/
```

### macOS

**1. Delete the application:**
```bash
sudo rm -rf /Applications/AetherCore\ Commander.app
```

**2. Remove application data:**
```bash
rm -rf ~/Library/Application\ Support/com.aethercore.commander/
rm -rf ~/Library/Caches/com.aethercore.commander/
rm -rf ~/Library/Logs/aethercore-commander/
rm -rf ~/Library/Preferences/com.aethercore.commander.plist
```

### Windows

**1. Using Control Panel:**
- Open Control Panel → Programs and Features
- Find "AetherCore Commander"
- Click "Uninstall" and follow prompts

**2. Using PowerShell (silent uninstall):**
```powershell
# Find product code
Get-WmiObject -Class Win32_Product | Where-Object { $_.Name -like "*AetherCore Commander*" }

# Uninstall using product code
msiexec /x {PRODUCT-CODE-GUID} /quiet /qn /norestart
```

**3. Remove application data:**
```powershell
Remove-Item -Recurse -Force "$env:APPDATA\tactical-glass"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\tactical-glass"
```

---

## Next Steps

After successful installation:

1. **Review Security Guidelines**: [SECURITY.md](SECURITY.md)
2. **Configure Production Deployment**: [docs/production-deployment-playbook.md](docs/production-deployment-playbook.md)
3. **Understand Supply Chain Security**: [PROVENANCE.md](PROVENANCE.md)
4. **Deploy to Production**: [DEPLOYMENT_DESKTOP.md](DEPLOYMENT_DESKTOP.md)

---

## Related Documentation

- [DEPLOYMENT_DESKTOP.md](DEPLOYMENT_DESKTOP.md) - Deployment procedures and architecture
- [SECURITY.md](SECURITY.md) - Security best practices and hardening
- [PROVENANCE.md](PROVENANCE.md) - Supply chain security and SBOM verification
- [docs/PERFORMANCE_BENCHMARKS.md](docs/PERFORMANCE_BENCHMARKS.md) - Performance expectations
- [docs/production-deployment-playbook.md](docs/production-deployment-playbook.md) - Production deployment guide

---

**Status:** INSTALLATION PROCEDURES DOCUMENTED ✅  
**Maintainer:** AetherCore Security Team  
**Review Cycle:** Quarterly or upon major release


## IT Deployment Handoff Requirement

`release-manifest.json` is the required handoff artifact for enterprise distribution pipelines:
- **Intune**: ingest manifest, verify signature/hash, deploy only listed `.msi`.
- **Jamf**: ingest manifest, verify signature/hash, deploy only listed `.dmg`.
- **Manual distribution**: operators must run manifest verification before install.

Pipelines should fail closed if the manifest signature fails, an artifact hash mismatches, or an installer is missing from the manifest.
