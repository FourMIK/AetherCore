#!/bin/bash
# AetherCore Tablet App - Simple Build and Deploy using NPM
# Fallback method when pnpm is not available

PROJECT_ROOT="/c/Users/Owner/StudioProjects/AetherCore"
TABLET_APP_DIR="$PROJECT_ROOT/packages/tablet-app"
ADB_PATH="/c/Users/Owner/AppData/Local/Android/Sdk/platform-tools/adb.exe"
SERIAL="R52X601NK7F"

echo "====================================================================="
echo "AetherCore Tablet App - NPM-based Build and Deploy"
echo "====================================================================="
echo ""

# Step 1: Check device
echo "[1/5] Checking device connection..."
"$ADB_PATH" devices | grep $SERIAL
if [ $? -ne 0 ]; then
    echo "ERROR: Device $SERIAL not found"
    exit 1
fi
echo "Device found: $SERIAL"
echo ""

# Step 2: Navigate and install
echo "[2/5] Installing dependencies..."
cd "$TABLET_APP_DIR"
export SKIP_TOOLCHAIN_CHECK=1

# Try npm install as fallback
npm install --legacy-peer-deps
if [ $? -ne 0 ]; then
    echo "WARNING: npm install had issues, but continuing..."
fi
echo ""

# Step 3: Build
echo "[3/5] Building APK (using npm)..."
npm run build:local
if [ ! -f "$TABLET_APP_DIR/dist/app.apk" ]; then
    echo "ERROR: APK not found after build"
    exit 1
fi
echo "APK built successfully"
echo ""

# Step 4: Deploy
echo "[4/5] Deploying to device..."
"$ADB_PATH" -s $SERIAL uninstall com.aethercore.tactical 2>/dev/null
"$ADB_PATH" -s $SERIAL install -r "$TABLET_APP_DIR/dist/app.apk"
if [ $? -ne 0 ]; then
    echo "ERROR: Installation failed"
    exit 1
fi
echo ""

# Step 5: Launch
echo "[5/5] Launching app..."
"$ADB_PATH" -s $SERIAL shell am start -n com.aethercore.tactical/.MainActivity
echo ""

echo "====================================================================="
echo "✅ DEPLOYMENT COMPLETE"
echo "====================================================================="
echo ""
echo "The AetherCore Tactical app should now be running on your device."
echo "Device Serial: $SERIAL"
echo ""

