@echo off
REM Direct Android Debug APK Build Script
REM Bypasses npm/pnpm to build the APK directly

setlocal enabledelayedexpansion

echo =====================================================================
echo AetherCore Tablet App - Direct Android Build
echo =====================================================================
echo.

set PROJECT_DIR=C:\Users\Owner\StudioProjects\AetherCore\packages\tablet-app
set ANDROID_SDK=%LOCALAPPDATA%\Android\Sdk
set GRADLE_CMD=%PROJECT_DIR%\android\gradlew.bat
set APK_OUTPUT=%PROJECT_DIR%\android\app\build\outputs\apk\debug\app-debug.apk
set ADB=%ANDROID_SDK%\platform-tools\adb.exe
set SERIAL=R52X601NK7F

REM Check if android directory exists
if not exist "%PROJECT_DIR%\android" (
    echo ERROR: Android project not generated yet
    echo Please run: expo prebuild --platform android
    exit /b 1
)

echo [1/3] Building Android APK with Gradle...
cd /d "%PROJECT_DIR%\android"
call gradlew.bat assembleDebug
if errorlevel 1 (
    echo ERROR: Gradle build failed
    exit /b 1
)
echo Build successful!
echo.

echo [2/3] Installing APK to device %SERIAL%...
"%ADB%" -s %SERIAL% uninstall com.aethercore.tactical 2>nul
"%ADB%" -s %SERIAL% install -r "%APK_OUTPUT%"
if errorlevel 1 (
    echo ERROR: Installation failed
    exit /b 1
)
echo Installation successful!
echo.

echo [3/3] Launching app...
"%ADB%" -s %SERIAL% shell am start -n com.aethercore.tactical/.MainActivity
echo.

echo =====================================================================
echo DEPLOYMENT COMPLETE
echo =====================================================================
echo The AetherCore Tactical app is now running on your device.
echo.

endlocal

