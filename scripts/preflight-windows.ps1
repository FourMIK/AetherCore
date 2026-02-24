# preflight-windows.ps1
# Windows preflight checks for AetherCore development environment
# Exit codes: 0 = all checks passed, 1 = one or more checks failed

$ErrorActionPreference = "Continue"
$script:Errors = 0
$script:Warnings = 0

function Write-ErrorMsg {
    param([string]$Message)
    Write-Host "ERROR: $Message" -ForegroundColor Red
    $script:Errors++
}

function Write-WarningMsg {
    param([string]$Message)
    Write-Host "WARNING: $Message" -ForegroundColor Yellow
    $script:Warnings++
}

function Write-SuccessMsg {
    param([string]$Message)
    Write-Host "OK: $Message" -ForegroundColor Green
}

function Test-Command {
    param(
        [string]$CommandName,
        [string]$InstallGuidance
    )
    
    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($command) {
        Write-SuccessMsg "$CommandName is installed"
        return $true
    } else {
        Write-ErrorMsg "$CommandName is not installed"
        if ($InstallGuidance) {
            Write-Host "  $InstallGuidance"
        }
        return $false
    }
}

function Test-VisualStudioBuildTools {
    # Check for cl.exe (MSVC compiler)
    $clPath = Get-Command cl.exe -ErrorAction SilentlyContinue
    
    if ($clPath) {
        Write-SuccessMsg "Visual Studio Build Tools (MSVC) detected"
        return $true
    }
    
    # Check for Visual Studio installations
    $vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    
    if (Test-Path $vsWhere) {
        $vsInstalls = & $vsWhere -property installationPath
        if ($vsInstalls) {
            Write-SuccessMsg "Visual Studio detected at: $vsInstalls"
            # Check if C++ tools are installed
            $vcTools = Test-Path (Join-Path $vsInstalls "VC\Tools\MSVC")
            if ($vcTools) {
                Write-SuccessMsg "Visual C++ Build Tools are installed"
                return $true
            } else {
                Write-WarningMsg "Visual Studio found but C++ Build Tools may not be installed"
                return $false
            }
        }
    }
    
    Write-ErrorMsg "Visual Studio Build Tools or MSVC toolchain not detected"
    Write-Host "  Install from: https://visualstudio.microsoft.com/downloads/"
    Write-Host "  Select 'Desktop development with C++' workload"
    Write-Host "  Or install Build Tools: https://aka.ms/vs/17/release/vs_BuildTools.exe"
    return $false
}

function Test-WebView2 {
    # Check registry for WebView2 Runtime
    $webView2Paths = @(
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    )
    
    foreach ($path in $webView2Paths) {
        if (Test-Path $path) {
            $version = (Get-ItemProperty -Path $path -Name "pv" -ErrorAction SilentlyContinue).pv
            if ($version) {
                Write-SuccessMsg "Microsoft WebView2 Runtime is installed (version: $version)"
                return $true
            }
        }
    }
    
    # Check for Edge browser (includes WebView2)
    $edgePath = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    if (Test-Path $edgePath) {
        Write-SuccessMsg "Microsoft Edge detected (includes WebView2)"
        return $true
    }
    
    Write-ErrorMsg "Microsoft WebView2 Runtime not detected"
    Write-Host "  Download from: https://developer.microsoft.com/microsoft-edge/webview2/"
    Write-Host "  Or it will be automatically installed with the application"
    return $false
}

Write-Host "=========================================="
Write-Host "AetherCore Windows Preflight Checks"
Write-Host "=========================================="
Write-Host

Write-Host "Checking required tools..."
Write-Host

# Check Rust
Test-Command "rustc" "Install from: https://rustup.rs/"
Test-Command "cargo" "Install from: https://rustup.rs/"

# Check Node.js
Test-Command "node" "Install from: https://nodejs.org/"

# Check pnpm
Test-Command "pnpm" "Enable with: corepack enable"

# Check Git
Test-Command "git" "Install from: https://git-scm.com/download/win"

Write-Host
Write-Host "Checking development tools..."
Write-Host

# Check Visual Studio Build Tools
Test-VisualStudioBuildTools

# Check WebView2
Test-WebView2

Write-Host
Write-Host "=========================================="
Write-Host "Preflight Summary"
Write-Host "=========================================="

if ($script:Errors -gt 0) {
    Write-Host "FAILED: $($script:Errors) error(s) found" -ForegroundColor Red
    Write-Host
    Write-Host "Required steps to fix errors:"
    Write-Host "1. Install Rust toolchain from https://rustup.rs/"
    Write-Host "2. Install Node.js 20.x from https://nodejs.org/"
    Write-Host "3. Enable pnpm with: corepack enable"
    Write-Host "4. Install Git from https://git-scm.com/download/win"
    Write-Host "5. Install Visual Studio Build Tools with C++ workload"
    Write-Host "6. Install Microsoft WebView2 Runtime"
    Write-Host
    exit 1
} else {
    Write-Host "PASSED: All preflight checks successful" -ForegroundColor Green
    if ($script:Warnings -gt 0) {
        Write-Host "Note: $($script:Warnings) warning(s) found" -ForegroundColor Yellow
    }
    exit 0
}
