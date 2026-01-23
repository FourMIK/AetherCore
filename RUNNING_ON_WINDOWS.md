# Running AetherCore on Windows

**Last Updated:** 2025-01-23  
**Purpose:** Windows-specific build, installation, and operational guide

---

## System Requirements

### Minimum Requirements

- **OS:** Windows 10 (Build 19041+) or Windows 11
- **CPU:** x86_64 processor, 2+ cores
- **RAM:** 4 GB
- **Disk:** 2 GB free space
- **Display:** 1280x720 minimum resolution

### Recommended Requirements

- **OS:** Windows 11
- **CPU:** x86_64 processor, 4+ cores
- **RAM:** 8 GB
- **Disk:** 10 GB free space (for logs and telemetry)
- **Display:** 1920x1080 or higher
- **GPU:** DirectX 11+ compatible (for 3D visualization)

### Required Software (for building from source)

- **Rust:** 1.70 or later
  - Install via [rustup.rs](https://rustup.rs/)
  - Ensure `cargo` is in PATH

- **Node.js:** 18 or later
  - Install via [nodejs.org](https://nodejs.org/)
  - Ensure `npm` version 9+

- **Visual Studio Build Tools:**
  - Required for Rust native compilation
  - Install "Desktop development with C++" workload
  - [Download here](https://visualstudio.microsoft.com/downloads/)

- **WebView2 Runtime:**
  - Usually pre-installed on Windows 11
  - [Download installer](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) if needed

## Installation

### Option 1: Install from MSI (Recommended)

1. **Download** the latest MSI installer from releases
   - File: `AetherCore-Tactical-Glass-Dev-Mode_[version]_x64_en-US.msi`

2. **Run installer** with administrator privileges
   - Right-click MSI → "Run as administrator"
   - Follow installation wizard

3. **Launch application**
   - Start Menu → "AetherCore Tactical Glass (Dev Mode)"
   - Or: Desktop shortcut (if created during install)

**Default Installation Location:**
```
C:\Program Files\AetherCore Tactical Glass Dev Mode\
```

### Option 2: Build from Source

#### Step 1: Clone Repository

```powershell
git clone https://github.com/your-org/AetherCore.git
cd AetherCore
```

#### Step 2: Install Dependencies

```powershell
# Install Rust dependencies
cargo fetch

# Install Node.js dependencies
npm install
```

This may take several minutes as dependencies are downloaded and compiled.

#### Step 3: Build Rust Workspace

```powershell
# Build all Rust crates
cargo build --workspace --release
```

**Build time:** Approximately 5-10 minutes on first build.

#### Step 4: Build Desktop Application

```powershell
# Navigate to dashboard package
cd packages\dashboard

# Build Tauri application
npm run tauri:build
```

**Build time:** Approximately 10-15 minutes.

**Output location:**
```
packages\dashboard\src-tauri\target\release\bundle\msi\
```

#### Step 5: Install Built Application

Run the generated MSI installer:

```powershell
cd src-tauri\target\release\bundle\msi
Start-Process ".\AetherCore Tactical Glass (Dev Mode)_1.0.0_x64_en-US.msi"
```

## Running the Application

### First Launch

1. **Start application** from Start Menu or Desktop
2. **Dev Mode banner** appears at top of window
3. **Initial state:** No nodes configured

### Adding Nodes

**Manual Node Addition:**

1. Click **"Add Node"** button
2. Enter node details:
   - **Node ID:** Unique identifier (alphanumeric)
   - **Location:** Geographic coordinates (optional)
   - **Role:** Select from dropdown (Operator, ISR, Comms, etc.)
3. Click **"Create Node"**

Node appears in left sidebar with initial trust score of 0.5.

### Viewing Telemetry

1. **Select node** from left sidebar
2. **Right panel** shows node details:
   - Trust score
   - Verification status
   - Last contact time
   - Telemetry stream

3. **Map view** shows node location (if coordinates provided)

### Trust Mesh Operations

**Viewing Trust Scores:**
- Navigate to **"Trust Guardian"** workspace
- View network-wide trust matrix
- Inspect trust scoring rationale

**Triggering Aetheric Sweep:**
- Byzantine behavior auto-triggers sweep
- Manual trigger: Right-click node → "Mark as Byzantine"
- Animation shows isolation process

## Configuration

### Application Settings

Settings are persisted in local storage:

**Location:**
```
%APPDATA%\com.aethercore.tactical-glass-dev\
```

**Files:**
- `state.db` - Application state (nodes, telemetry)
- `config.json` - User preferences
- `logs\` - Application logs

### Log Configuration

Enable debug logging via environment variable:

```powershell
# PowerShell
$env:RUST_LOG = "debug,aethercore=trace"
$env:RUST_BACKTRACE = "1"

# Launch application
& "C:\Program Files\AetherCore Tactical Glass Dev Mode\AetherCore Tactical Glass (Dev Mode).exe"
```

**Log levels:**
- `error` - Errors only
- `warn` - Warnings and errors
- `info` - Informational messages (default)
- `debug` - Detailed debugging
- `trace` - Very detailed protocol messages

### Network Configuration

**Testnet Connection (default):**
- Auto-connects to `localhost:8080` if available
- Falls back to simulated mode if no local service

**Custom Endpoint:**

Edit configuration file before launch:
```
%APPDATA%\com.aethercore.tactical-glass-dev\config.json
```

```json
{
  "network": {
    "endpoint": "ws://localhost:8080",
    "timeout_ms": 5000
  }
}
```

## Troubleshooting

### Application Won't Start

**Symptom:** Application crashes immediately or shows error dialog

**Causes & Solutions:**

1. **WebView2 Not Installed**
   - Download and install WebView2 Runtime
   - Reboot and retry

2. **Missing Visual C++ Redistributable**
   - Install [VC++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe)
   - Reboot and retry

3. **Corrupted Configuration**
   - Delete `%APPDATA%\com.aethercore.tactical-glass-dev\`
   - Relaunch application

### Build Failures

**Symptom:** `cargo build` or `npm run tauri:build` fails

**Causes & Solutions:**

1. **Rust Not in PATH**
   ```powershell
   # Verify Rust installation
   cargo --version
   rustc --version
   
   # If missing, reinstall via rustup
   ```

2. **Node.js Version Mismatch**
   ```powershell
   # Check Node version
   node --version  # Should be 18+
   npm --version   # Should be 9+
   ```

3. **Visual Studio Build Tools Missing**
   - Install "Desktop development with C++" workload
   - Restart terminal after installation

4. **Dependency Fetch Failure**
   ```powershell
   # Clear caches and retry
   cargo clean
   rm -r node_modules
   npm install
   cargo build --workspace
   ```

### Performance Issues

**Symptom:** Application is slow or unresponsive

**Causes & Solutions:**

1. **Too Many Simulated Nodes**
   - Limit to 50-100 nodes for desktop performance
   - Delete unnecessary nodes

2. **Insufficient RAM**
   - Close other applications
   - Increase virtual memory
   - Upgrade to 8GB+ RAM

3. **Debug Logging Enabled**
   - Disable `RUST_LOG=trace` for production use
   - Use `info` level for normal operation

### Network Connection Issues

**Symptom:** "Failed to connect to testnet" error

**Causes & Solutions:**

1. **No Local Service Running**
   - This is expected in Dev Mode if no service deployed
   - Application falls back to simulated mode automatically

2. **Firewall Blocking Connection**
   - Allow application through Windows Firewall
   - Check antivirus software settings

3. **Port Already in Use**
   - Verify port 8080 not in use:
   ```powershell
   netstat -ano | findstr :8080
   ```

### Logs Not Appearing

**Symptom:** Log directory is empty

**Causes & Solutions:**

1. **Logging Not Enabled**
   - Set `RUST_LOG` environment variable before launch

2. **Permissions Issue**
   - Run application as Administrator once
   - Check `%APPDATA%` is writable

3. **Log File Size Limit**
   - Logs rotate after 10MB by default
   - Check for archived logs: `*.log.1`, `*.log.2`, etc.

## Uninstallation

### Via Control Panel

1. Open **Settings** → **Apps** → **Installed apps**
2. Search for **"AetherCore Tactical Glass"**
3. Click **"Uninstall"**
4. Follow uninstaller prompts

### Manual Cleanup

Remove application data:

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\com.aethercore.tactical-glass-dev"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\com.aethercore.tactical-glass-dev"
```

## Development Workflow

### Hot Reload Development

For rapid iteration during development:

```powershell
cd packages\dashboard
npm run tauri:dev
```

This starts Tauri in development mode:
- **Frontend:** Hot reloads on TypeScript/React changes
- **Backend:** Rebuilds Rust on file changes
- **Window:** Opens with dev tools accessible

**Dev Tools:**
- Press `F12` to open browser dev tools
- View console logs, network requests, and React components

### Debugging Rust Code

**Using VS Code:**

1. Install **rust-analyzer** extension
2. Open workspace in VS Code
3. Set breakpoints in `.rs` files
4. Press `F5` to launch debugger

**Using WinDbg:**

1. Attach to running process:
   ```powershell
   windbg -p [PID]
   ```

2. Load symbols:
   ```
   .sympath+ packages\dashboard\src-tauri\target\release
   .reload
   ```

### Testing

**Rust Tests:**
```powershell
cargo test --workspace
```

**TypeScript Tests:**
```powershell
cd packages\dashboard
npm run test
```

**End-to-End Tests:**
```powershell
cd packages\dashboard
npm run test:e2e
```

## Performance Optimization

### Release Build Optimizations

Release builds include:
- **Link-Time Optimization (LTO):** Aggressive inlining
- **Codegen Units:** Optimized to 1 for maximum performance
- **Optimization Level:** 3 (maximum)

Build time increases to 20-30 minutes, but runtime performance improves significantly.

### Profiling

**CPU Profiling:**
```powershell
# Install cargo-flamegraph
cargo install flamegraph

# Run with profiling
cd packages\dashboard\src-tauri
cargo flamegraph --bin tactical-glass
```

**Memory Profiling:**
```powershell
# Use Windows Performance Analyzer
wpr -start CPU -start VirtualAllocation
# Run application
wpr -stop memory.etl
# Open in Windows Performance Analyzer
```

## Security Considerations

### Dev Mode Security Posture

**This is Dev Mode - NOT production-ready.**

Security limitations:
- ❌ No TPM-backed keys
- ❌ No attestation
- ❌ Software-only cryptography
- ❌ Local storage not encrypted

See [DEV_MODE.md](DEV_MODE.md) for complete security scope.

### Recommended Practices

**For Demonstrations:**
- Use on isolated network
- Do not process real operational data
- Clearly label as "Dev Mode" to audience

**For Development:**
- Use separate machine from production systems
- Do not store sensitive keys or data
- Treat all logs as potentially shared

## Further Reading

- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [DEV_MODE.md](DEV_MODE.md) - Dev Mode capabilities and limitations
- [SECURITY_SCOPE.md](SECURITY_SCOPE.md) - Security boundaries
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contributing guidelines

## Support

For technical issues:
1. Check logs in `%APPDATA%\com.aethercore.tactical-glass-dev\logs\`
2. Review troubleshooting section above
3. Open issue on GitHub repository with:
   - Windows version
   - Error message or behavior
   - Relevant log excerpts
   - Steps to reproduce
