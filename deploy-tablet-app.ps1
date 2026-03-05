# AetherCore Tablet App - Build and Deploy Script
# Handles installation, build, and deployment to Samsung SM-X308U

param(
    [string]$SerialNumber = "R52X601NK7F",
    [string]$SkipBuild = $false
)

Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "AetherCore Tablet App - Build and Deploy Script" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""

$ProjectRoot = "C:\Users\Owner\StudioProjects\AetherCore"
$TabletAppDir = "$ProjectRoot\packages\tablet-app"
$AdbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

# Find pnpm
$pnpmPath = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
if (!$pnpmPath) {
    # Try to find it via npm
    $npmPath = (Get-Command npm -ErrorAction SilentlyContinue).Source
    if ($npmPath) {
        $npmDir = Split-Path $npmPath
        $pnpmPath = Join-Path $npmDir "pnpm.cmd"
        if (!(Test-Path $pnpmPath)) {
            # Try using npx
            $pnpmPath = "npx pnpm"
        }
    }
}

# Step 1: Verify prerequisites
Write-Host "[1/5] Verifying prerequisites..." -ForegroundColor Yellow
Write-Host "  Project: $TabletAppDir"

if (!(Test-Path $TabletAppDir)) {
    Write-Host "  ❌ ERROR: Tablet app directory not found" -ForegroundColor Red
    exit 1
}

if (!(Test-Path $AdbPath)) {
    Write-Host "  ❌ ERROR: ADB not found at $AdbPath" -ForegroundColor Red
    exit 1
}

Write-Host "  ✅ Prerequisites verified" -ForegroundColor Green
Write-Host ""

# Step 2: Check device connection
Write-Host "[2/5] Checking device connection..." -ForegroundColor Yellow
$devices = & $AdbPath devices
Write-Host "$devices"

if ($devices -match $SerialNumber) {
    Write-Host "  ✅ Device $SerialNumber found" -ForegroundColor Green
} else {
    Write-Host "  ❌ ERROR: Device $SerialNumber not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 3: Install dependencies and build
if ($SkipBuild -eq $false) {
    Write-Host "[3/5] Installing dependencies and building APK..." -ForegroundColor Yellow
    Write-Host "  This may take 10-15 minutes..." -ForegroundColor Cyan

    Push-Location $TabletAppDir

    # Set environment variable to skip toolchain check
    $env:SKIP_TOOLCHAIN_CHECK = '1'

    # Try using npm scripts
    Write-Host "  Running: pnpm install"
    & cmd /c "$pnpmPath install"

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ⚠️  pnpm install had issues, but continuing..." -ForegroundColor Yellow
    }

    Write-Host "  Running: pnpm build:local"
    & cmd /c "$pnpmPath build:local"

    Pop-Location

    if (!(Test-Path "$TabletAppDir\dist\app.apk")) {
        Write-Host "  ❌ ERROR: APK not found at $TabletAppDir\dist\app.apk" -ForegroundColor Red
        Write-Host "  Build may have failed. Check output above." -ForegroundColor Red
        exit 1
    }

    Write-Host "  ✅ APK built successfully" -ForegroundColor Green
} else {
    Write-Host "[3/5] Skipping build (--SkipBuild flag set)" -ForegroundColor Yellow
    if (!(Test-Path "$TabletAppDir\dist\app.apk")) {
        Write-Host "  ❌ ERROR: APK not found but skipping build" -ForegroundColor Red
        exit 1
    }
}
Write-Host ""

# Step 4: Deploy to device
Write-Host "[4/5] Deploying app to device..." -ForegroundColor Yellow

Write-Host "  Uninstalling existing app..."
& $AdbPath -s $SerialNumber uninstall com.aethercore.tactical | Out-Null

Write-Host "  Installing new APK..."
& $AdbPath -s $SerialNumber install -r "$TabletAppDir\dist\app.apk"

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ❌ ERROR: Installation failed" -ForegroundColor Red
    exit 1
}

Write-Host "  ✅ APK installed successfully" -ForegroundColor Green
Write-Host ""

# Step 5: Launch app
Write-Host "[5/5] Launching app..." -ForegroundColor Yellow

& $AdbPath -s $SerialNumber shell am start -n com.aethercore.tactical/.MainActivity

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "✅ DEPLOYMENT COMPLETE" -ForegroundColor Green
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "The AetherCore Tactical app should now be running on your device." -ForegroundColor Cyan
Write-Host "Check the tablet screen to verify the app has launched." -ForegroundColor Cyan
Write-Host ""
Write-Host "Device: $SerialNumber" -ForegroundColor Cyan
Write-Host "App Package: com.aethercore.tactical" -ForegroundColor Cyan
Write-Host ""
Write-Host "To view logs, run:" -ForegroundColor Cyan
Write-Host "  $AdbPath -s $SerialNumber logcat | findstr /I aethercore" -ForegroundColor Gray
Write-Host ""



