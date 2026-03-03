@echo off
REM AetherCore Dashboard Developer Quick Start
REM This script starts the React dev server on http://127.0.0.1:1420

setlocal enabledelayedexpansion

echo.
echo =====================================================================
echo          AetherCore Dashboard - Development Server
echo =====================================================================
echo.

REM Set environment
set SKIP_TOOLCHAIN_CHECK=1

REM Navigate to dashboard
cd /d C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard

if errorlevel 1 (
    echo ERROR: Could not navigate to dashboard directory
    pause
    exit /b 1
)

echo.
echo Starting React development server...
echo.
echo Dashboard will be available at:
echo    http://127.0.0.1:1420
echo.
echo Press Ctrl+C to stop the server.
echo.

REM Start the dev server
pnpm run dev

pause

