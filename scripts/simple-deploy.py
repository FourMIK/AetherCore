#!/usr/bin/env python3
"""
Simple ADB Push Script - Deploy JAR to Connected Device
"""
import subprocess
import time
import os

def run(cmd):
    result = os.system(cmd)
    return result == 0

ADB = r"C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe"
JAR = r"C:\Users\Owner\source\repos\FourMIK\AetherCore\dist\atak\main.jar"

print("\n" + "="*50)
print("ATAK Plugin Deployment")
print("="*50 + "\n")

# Step 1: Kill everything
print("[1/6] Stopping emulator...")
os.system("taskkill /F /IM qemu-system-x86_64-headless.exe 2>nul")
os.system("taskkill /F /IM qemu-system-x86_64.exe 2>nul")
os.system("taskkill /F /IM emulator.exe 2>nul")
time.sleep(2)

# Step 2: Kill ADB
print("[2/6] Restarting ADB...")
os.system(f'"{ADB}" kill-server')
time.sleep(2)

# Step 3: Check devices
print("[3/6] Checking for connected devices...")
result = subprocess.run(f'"{ADB}" devices -l', shell=True, capture_output=True, text=True)
print(result.stdout)

if "offline" in result.stdout or "no devices" in result.stdout.lower():
    print("\n❌ No device connected!")
    print("\nTo connect an emulator:")
    print("  1. Open Android Studio")
    print("  2. Click AVD Manager")
    print("  3. Click Play button on Medium_Phone")
    print("  4. Then run this script again")
    exit(1)

# Step 4: Create directory
print("[4/6] Creating plugin directory...")
os.system(f'"{ADB}" shell mkdir -p /sdcard/atak/plugins')

# Step 5: Deploy JAR
print("[5/6] Deploying main.jar...")
if not os.path.exists(JAR):
    print(f"❌ JAR not found: {JAR}")
    exit(1)

os.system(f'"{ADB}" push "{JAR}" /sdcard/atak/plugins/main.jar')

# Step 6: Verify
print("\n[6/6] Verifying...")
result = subprocess.run(f'"{ADB}" shell ls -lh /sdcard/atak/plugins/main.jar', shell=True, capture_output=True, text=True)
if "main.jar" in result.stdout:
    print("✅ Plugin deployed successfully!")
    print(f"\n{result.stdout}")
else:
    print("❌ Verification failed")
    exit(1)

print("\nNext: Open ATAK and check Settings → Plugins")
