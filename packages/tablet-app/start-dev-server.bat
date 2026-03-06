@echo off
REM AetherCore Tablet App - Quick Test via Expo Go
REM This starts a development server that the Expo Go app can connect to

setlocal

set NODE_EXE=C:\Users\Owner\source\repos\Featherlite\Featherlite\wwwroot\node_modules\node\bin\node.exe
set PNPM_CJS=C:\Users\Owner\StudioProjects\AetherCore\.tools\pnpm\pnpm.cjs
set PROJECT_DIR=C:\Users\Owner\StudioProjects\AetherCore\packages\tablet-app

echo =====================================================================
echo AetherCore Tablet App - Development Server
echo =====================================================================
echo.
echo This will start the Expo development server.
echo.
echo On your Samsung SM-X308U:
echo 1. Install "Expo Go" from Google Play Store
echo 2. Open Expo Go
echo 3. Scan the QR code that appears below
echo.
echo =====================================================================
echo.

cd /d "%PROJECT_DIR%"
"%NODE_EXE%" "%PNPM_CJS%" exec expo start --clear

endlocal

