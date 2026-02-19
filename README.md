# AetherCore™ Tactical Glass

<img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg">
<img src="https://img.shields.io/badge/version-0.1.0--alpha-orange.svg">
<img src="https://img.shields.io/badge/build-passing-brightgreen.svg">

> **AetherCore** is a hardware-rooted trust fabric for contested environments. 
> **Tactical Glass** is the operator's window into that truth.

---

## ⚠️ Alpha Release Notice
This is a **Developer Preview (v0.1.0)**. While the cryptographic core is verified, this software is intended for evaluation and testing in controlled environments. 
* **Production profile default:** Release artifacts ship as **AetherCore Commander**. Dev-channel branding is isolated to build-time overrides for engineering workflows.
* **Compatibility:** Hardware pairing requires Firmware v0.1.0+.

---

## Overview

AetherCore replaces "trust by policy" with **Cryptographic Certainty**. It is designed for autonomous swarms, critical infrastructure, and edge operations where network integrity is paramount.

### Key Capabilities

### Supported Product Profile
- **Commander Edition (default):** Guided bootstrap and first deployment for field operators without terminal usage.

* **🛡️ Hardware-Rooted Identity:** Every node is cryptographically bound to physical silicon (TPM 2.0 / Secure Enclave).
* **🔗 Merkle Vine™ Integrity:** Telemetry streams are historically anchored; data cannot be injected retroactively.
* **⚡ The Aetheric Sweep:** Automated gossip protocols actively hunt and isolate compromised or "lying" nodes.
* **🖥️ Tactical Glass:** A GPU-accelerated desktop dashboard for real-time fleet command and mesh visualization.

## Quick Start

### Download Binaries
For the latest desktop installers, use only assets listed in each release's `release-manifest.json` on the [Releases Page](https://github.com/FourMIK/AetherCore/releases). Current managed artifacts are:
- macOS `.dmg`
- Windows `.msi`

Each listed artifact is manifest-backed with SHA-256 and signature metadata for deployment validation.

### Installation
See the [Installation Guide](INSTALLATION.md) and follow the **Commander Edition** first-run sequence (single supported default path).

## Appendix A: Advanced/Engineering Flows

### Build and Run from Source (Engineering)

**Prerequisites:**
* Node.js 20+
* Rust 1.75+ (Stable)
* pnpm

```bash
# 1. Clone the repository
git clone https://github.com/FourMIK/AetherCore.git
cd AetherCore

# 2. Install dependencies
pnpm install

# 3. Build & Run Desktop App (Commander Edition baseline)
cd packages/dashboard
pnpm tauri dev
```

### Docker Compose Development Stack (Engineering)

For development and testing of backend services:

```bash
# Navigate to docker directory
cd infra/docker

# Copy environment configuration
cp .env.example .env

# Start services
docker compose up -d

# View logs
docker compose logs -f
```

**See [Docker Compose Guide](docs/DOCKER_COMPOSE_GUIDE.md) for:**
- Port configuration to avoid conflicts
- Running multiple stacks side-by-side
- Troubleshooting and cleanup procedures
- Development workflows

---

## Documentation
* [Installation Guide](INSTALLATION.md): Setup for Windows, macOS, and Linux.
* [Release Guide](RELEASE.md): Release procedures and version history.
* [Changelog](CHANGELOG.md): Detailed version history and breaking changes.
* [Architecture](ARCHITECTURE.md): System design and data flow.
* [Security](SECURITY.md): Threat models and reporting vulnerabilities.
* [Protocol Overview](PROTOCOL_OVERVIEW.md): Deep dive into the consensus mechanism.
* [Docker Compose Guide](docs/DOCKER_COMPOSE_GUIDE.md): Development environment setup and troubleshooting.
* [TPM Configuration](docs/TPM_CONFIGURATION.md): TPM runtime configuration and security implications.
* [Product Profiles](docs/PRODUCT_PROFILES.md): Commander Edition default profile and engineering appendix.
* [Copilot MCP Configuration](docs/COPILOT_MCP_CONFIGURATION.md): GitHub Copilot Model Context Protocol setup.
* [TAK Bridge Integration](crates/tak-bridge/README.md): External JSON contract and downstream transport patterns.

## Contributing
We welcome contributions from the community. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting Pull Requests.

## License
Copyright © 2026 FourMIK. Released under the Apache 2.0 License. See [LICENSE](LICENSE) for details.

---

## First Run & Configuration (Commander Edition)

Upon launching Tactical Glass for the first time, the app enters **Commander Edition bootstrap** automatically.

### Single Supported First-Run Sequence
1. Launch Tactical Glass.
2. Allow Commander Edition bootstrap to run environment checks, local stack startup, mesh connection, and first-node deployment.
3. Click **Open dashboard** when bootstrap reports **System Ready**.
4. Continue normal operations from the Command Dashboard.

**Acceptance criteria:** A non-technical user can complete first deployment from this flow without opening a terminal.

### Advanced/Engineering Appendix
Cloud/internal and dev workflows are intentionally moved to Appendix A and are not part of the supported first-run operator path. See [DEPLOYMENT_DESKTOP.md](DEPLOYMENT_DESKTOP.md).

### Hardware Pairing (ESP32)
Requires Firmware v0.1.0 flashed to device.

1. Ensure your computer and ESP32 are on the same Wi-Fi network.
2. In Dashboard, click **Add Node > Hardware Scan**.
3. Point your webcam at the QR code generated by the device (if applicable) or enter the Pairing Code.

---

## Troubleshooting

### "Developer Mode" Warning
You will see a "DEV MODE" banner at the top of the application. This is normal for the Alpha release and indicates that hardware security modules (TPM) are being emulated in software for compatibility.

### Connection Failed
If you cannot deploy nodes:
* Ensure ports 8080 and 9000-9100 are not blocked by your firewall.
* Check the logs in the Deployments view for specific error messages.

## Appendix B: Engineering Container Deployment

### Dashboard Production Docker Image (Engineering)

A production-ready dashboard container is available via a multi-stage build (`node:20-alpine` builder + `nginx:alpine` runtime) with runtime environment injection.

### Build

```bash
docker build -t aethercore-dashboard -f docker/Dockerfile.dashboard .
```

### Run

```bash
docker run --rm -p 8080:8080 \
  -e REACT_APP_API_URL="https://api.example.mil" \
  -e REACT_APP_WS_URL="wss://ws.example.mil" \
  -e REACT_APP_TPM_ENABLED="true" \
  aethercore-dashboard
```

**Environment Variables:**
- `REACT_APP_API_URL`: Backend API endpoint (default: `http://localhost:8080/api`)
- `REACT_APP_WS_URL`: WebSocket/SignalR endpoint (default: `ws://localhost:8080/ws`)
- `REACT_APP_TPM_ENABLED`: Enable TPM hardware-rooted trust features (default: `true`)
  - Set to `false` to disable TPM validation and run without hardware attestation
  - **Security Warning**: Disabling TPM removes hardware-rooted trust guarantees

### Verify

```bash
curl -fsS http://localhost:8080/healthz
curl -fsS http://localhost:8080/env.js
```

`/env.js` is rendered at container startup, so API/WebSocket endpoints can be changed without rebuilding the image.
