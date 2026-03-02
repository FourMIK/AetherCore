@echo off
REM Deploy ATAK Trust Overlay Plugin
REM Complete workflow: Start emulator, deploy JAR, launch ATAK

setlocal enabledelayedexpansion

set ADB=C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe
set EMULATOR=C:\Users\Owner\AppData\Local\Android\Sdk\emulator\emulator.exe
set JAR=C:\Users\Owner\source\repos\FourMIK\AetherCore\dist\atak\main.jar
set AVD=Medium_Phone_API_36.1

echo.
echo ===================================================
echo     ATAK Trust Overlay - Complete Deployment
echo ===================================================
echo.

REM Step 1: Kill any existing emulators
echo Step 1: Cleaning up existing emulators...
taskkill /F /IM qemu-system-x86_64-headless.exe >nul 2>&1
taskkill /F /IM emulator.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM Step 2: Kill and restart ADB
echo Step 2: Restarting ADB...
call "%ADB%" kill-server
timeout /t 2 /nobreak >nul
call "%ADB%" start-server
timeout /t 2 /nobreak >nul

REM Step 3: Start emulator in background
echo Step 3: Starting emulator...
start "" "%EMULATOR%" -avd %AVD% -no-snapshot-load
timeout /t 10 /nobreak >nul

REM Step 4: Wait for device
echo Step 4: Waiting for device connection (up to 120 seconds)...
set count=0
:wait_device
call "%ADB%" devices >temp_devices.txt
findstr /C:"device " temp_devices.txt >nul
if %errorlevel% equ 0 (
    findstr /C:"offline" temp_devices.txt >nul
    if %errorlevel% neq 0 (
        echo Device connected!
        goto boot_wait
    )
)
if %count% lss 120 (
    set /a count+=1
    timeout /t 1 /nobreak >nul
    goto wait_device
)
echo ERROR: Device did not connect after 120 seconds
del temp_devices.txt
exit /b 1

:boot_wait
REM Step 5: Wait for boot
echo Step 5: Waiting for device boot (up to 90 seconds)...
set count=0
:wait_boot
call "%ADB%" shell getprop sys.boot_completed > temp_boot.txt 2>&1
findstr /C:"1" temp_boot.txt >nul
if %errorlevel% equ 0 (
    echo Device fully booted!
    goto deploy
)
if %count% lss 90 (
    set /a count+=1
    timeout /t 2 /nobreak >nul
    goto wait_boot
)
echo WARNING: Device may not be fully booted, continuing...

:deploy
REM Step 6: Create plugin directory
echo Step 6: Creating plugin directory...
call "%ADB%" shell mkdir -p /sdcard/atak/plugins

REM Step 7: Deploy JAR
echo Step 7: Deploying main.jar...
if not exist "%JAR%" (
    echo ERROR: JAR not found at %JAR%
    del temp_*.txt
    exit /b 1
)
call "%ADB%" push "%JAR%" /sdcard/atak/plugins/main.jar
if %errorlevel% neq 0 (
    echo ERROR: Deployment failed
    del temp_*.txt
    exit /b 1
)
echo Plugin deployed successfully!

REM Step 8: Verify deployment
echo Step 8: Verifying deployment...
call "%ADB%" shell ls -lh /sdcard/atak/plugins/main.jar

REM Step 9: Check for ATAK
echo Step 9: Checking for ATAK app...
call "%ADB%" shell pm list packages > temp_packages.txt 2>&1
findstr /C:"com.atakmap.app.civ" temp_packages.txt >nul
if %errorlevel% equ 0 (
    echo ATAK is installed!
    goto launch_atak
) else (
    echo.
    echo WARNING: ATAK is not installed
    echo To install ATAK:
    echo   1. Download ATAK-Civ APK from TAK.gov
    echo   2. Place in repository root as: atak-civ.apk
    echo   3. Run: adb install -r atak-civ.apk
    goto end
)

:launch_atak
REM Step 10: Launch ATAK
echo Step 10: Launching ATAK app...
call "%ADB%" shell am start -n com.atakmap.app.civ/com.atakmap.app.MainActivity
timeout /t 3 /nobreak >nul

:end
echo.
echo ===================================================
echo     ✅ DEPLOYMENT COMPLETE!
echo ===================================================
echo.
echo Next steps:
echo   1. Look at the emulator screen
echo   2. ATAK should be opening now
echo   3. Once loaded, go to: Settings → Plugins
echo   4. Look for: "AetherCore Trust Overlay"
echo   5. Status should show: "Loaded" ✅
echo.
echo Monitor logs:
echo   %ADB% logcat ^| findstr AetherCore
echo.

REM Cleanup
del temp_*.txt 2>nul

