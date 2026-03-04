#!/usr/bin/env pwsh
# AetherCore Development Quick Start Script
# Usage: .\start-dev.ps1

Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "          AetherCore Development Environment" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan

# Set environment
Write-Host ""
Write-Host "Setting up environment..." -ForegroundColor Yellow
$env:SKIP_TOOLCHAIN_CHECK = '1'
Write-Host "Toolchain check: SKIPPED (Node 22 compatible)" -ForegroundColor Green

# Navigate to dashboard
Write-Host ""
Write-Host "Navigating to dashboard..." -ForegroundColor Yellow
$dashboardPath = "C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard"
Set-Location $dashboardPath
Write-Host "Location: $dashboardPath" -ForegroundColor Green

# Show available options
Write-Host ""
Write-Host "Select an option:" -ForegroundColor Cyan
Write-Host ""
Write-Host "   1) Start Development Server (pnpm tauri dev) - HOT RELOAD"
Write-Host "   2) Run Test Suite (pnpm test)"
Write-Host "   3) Build Production (pnpm tauri build) - Creates MSI"
Write-Host "   4) Build TypeScript (pnpm run build)"
Write-Host "   5) View Documentation"
Write-Host "   6) Exit"
Write-Host ""

# Get user input
$choice = Read-Host "Enter your choice (1-6)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "Starting Development Server with Hot Reload..." -ForegroundColor Green
        Write-Host "   * React components will hot reload on save" -ForegroundColor Gray
        Write-Host "   * Tauri backend will restart on Rust changes" -ForegroundColor Gray
        Write-Host "   * Application window will open automatically" -ForegroundColor Gray
        Write-Host ""
        pnpm tauri dev
    }
    "2" {
        Write-Host ""
        Write-Host "Running Test Suite..." -ForegroundColor Green
        Write-Host "   * Expected: 104 PASSED | 10 SKIPPED | 0 FAILED" -ForegroundColor Gray
        Write-Host ""
        pnpm test
    }
    "3" {
        Write-Host ""
        Write-Host "Building Production Package..." -ForegroundColor Green
        Write-Host "   * Output: src-tauri/target/release/" -ForegroundColor Gray
        Write-Host "   * MSI: src-tauri/target/release/msi/" -ForegroundColor Gray
        Write-Host ""
        pnpm tauri build
    }
    "4" {
        Write-Host ""
        Write-Host "Building TypeScript..." -ForegroundColor Green
        Write-Host "   * Compiling TypeScript to JavaScript" -ForegroundColor Gray
        Write-Host "   * Building with Vite" -ForegroundColor Gray
        Write-Host ""
        pnpm run build
    }
    "5" {
        Write-Host ""
        Write-Host "Documentation Files:" -ForegroundColor Green
        Write-Host ""
        Write-Host "   1. READY_TO_DEV.md" -ForegroundColor Cyan
        Write-Host "      -> Complete development guide"
        Write-Host ""
        Write-Host "   2. LOCAL_SETUP_GUIDE.md" -ForegroundColor Cyan
        Write-Host "      -> Development workflow reference"
        Write-Host ""
        Write-Host "   3. FINAL_AUDIT_COMPLETION.md" -ForegroundColor Cyan
        Write-Host "      -> Complete audit report"
        Write-Host ""
        Write-Host "   4. CODE_QUALITY_AUDIT_REPORT.md" -ForegroundColor Cyan
        Write-Host "      -> Quality metrics and findings"
        Write-Host ""

        $docChoice = Read-Host "Which file to open? (1-4 or press Enter to skip)"
        switch ($docChoice) {
            "1" { notepad "C:\Users\Owner\StudioProjects\AetherCore\READY_TO_DEV.md" }
            "2" { notepad "C:\Users\Owner\StudioProjects\AetherCore\LOCAL_SETUP_GUIDE.md" }
            "3" { notepad "C:\Users\Owner\StudioProjects\AetherCore\FINAL_AUDIT_COMPLETION.md" }
            "4" { notepad "C:\Users\Owner\StudioProjects\AetherCore\CODE_QUALITY_AUDIT_REPORT.md" }
            default { Write-Host "Skipped" }
        }
    }
    "6" {
        Write-Host ""
        Write-Host "Goodbye!" -ForegroundColor Yellow
        exit
    }
    default {
        Write-Host ""
        Write-Host "Invalid choice. Please run the script again." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Operation complete!" -ForegroundColor Green


