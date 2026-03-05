@echo off
REM AetherCore Tablet App - Build and Deploy Script
REM Simplified version using cmd.exe

setlocal enabledelayedexpansion

set PROJECT_ROOT=C:\Users\Owner\StudioProjects\AetherCore
set TABLET_APP_DIR=%PROJECT_ROOT%\packages\tablet-app
set ADB_PATH=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
set SERIAL=R52X601NK7F

echo =====================================================================
echo AetherCore Tablet App - Build and Deploy Script
echo =====================================================================
echo.

REM Step 1: Verify device
echo [1/4] Checking device connection...
%ADB_PATH% devices
%ADB_PATH% devices | findstr %SERIAL% >nul
if errorlevel 1 (
    echo ERROR: Device %SERIAL% not found
    exit /b 1
)
echo Device found: %SERIAL%
echo.

REM Step 2: Set environment and install
echo [2/4] Installing dependencies...
cd /d %TABLET_APP_DIR%
set SKIP_TOOLCHAIN_CHECK=1
call pnpm install --legacy-peer-deps
if errorlevel 1 (
    echo WARNING: pnpm install had issues, but continuing...
)
echo.

REM Step 3: Build APK
echo [3/4] Building APK...
call pnpm build:local
if not exist %TABLET_APP_DIR%\dist\app.apk (
    echo ERROR: APK not found after build
    exit /b 1
)
echo APK built successfully
echo.

REM Step 4: Deploy
echo [4/4] Deploying to device...
%ADB_PATH% -s %SERIAL% uninstall com.aethercore.tactical >nul 2>&1
%ADB_PATH% -s %SERIAL% install -r %TABLET_APP_DIR%\dist\app.apk
if errorlevel 1 (
    echo ERROR: Installation failed
    exit /b 1
)
echo.

REM Step 5: Launch
echo Launching app...
%ADB_PATH% -s %SERIAL% shell am start -n com.aethercore.tactical/.MainActivity
echo.

echo =====================================================================
echo DEPLOYMENT COMPLETE
echo =====================================================================
echo.
echo The AetherCore Tactical app should now be running on your device.
echo.

endlocal

