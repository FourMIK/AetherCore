#!/usr/bin/env python3
"""
Deploy ATAK Trust Overlay to Emulator
Pure Python ADB client - no auth required
"""

import subprocess
import time
import sys
import os

ADB_PATH = r"C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe"
EMULATOR = r"C:\Users\Owner\AppData\Local\Android\Sdk\emulator\emulator.exe"
JAR_FILE = r"C:\Users\Owner\source\repos\FourMIK\AetherCore\dist\atak\main.jar"
REMOTE_JAR = "/sdcard/atak/plugins/main.jar"
AVD_NAME = "Medium_Phone_API_36.1"

def run_cmd(cmd, timeout=30):
    """Run a command and return output"""
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return result.stdout + result.stderr
    except Exception as e:
        return str(e)

def wait_for_device(max_wait=120):
    """Wait for emulator to connect"""
    print("Waiting for device to connect...", end="", flush=True)
    start = time.time()
    while time.time() - start < max_wait:
        output = run_cmd(f'"{ADB_PATH}" devices')
        if "device" in output and "offline" not in output.split('\n')[1]:
            print(" ✅")
            return True
        print(".", end="", flush=True)
        time.sleep(2)
    print(" ❌")
    return False

def wait_for_boot(max_wait=90):
    """Wait for device to fully boot"""
    print("Waiting for device boot...", end="", flush=True)
    start = time.time()
    while time.time() - start < max_wait:
        try:
            output = run_cmd(f'"{ADB_PATH}" shell getprop sys.boot_completed')
            if "1" in output:
                print(" ✅")
                return True
        except:
            pass
        print(".", end="", flush=True)
        time.sleep(2)
    print(" ❌")
    return False

def deploy_jar():
    """Deploy JAR to device"""
    print(f"Deploying JAR...", end="", flush=True)
    
    # Create directory
    run_cmd(f'"{ADB_PATH}" shell mkdir -p /sdcard/atak/plugins')
    
    # Push JAR
    result = run_cmd(f'"{ADB_PATH}" push "{JAR_FILE}" {REMOTE_JAR}')
    if "pushed" in result.lower() or "error" not in result.lower():
        print(" ✅")
        return True
    else:
        print(f" ❌\n{result}")
        return False

def verify_deployment():
    """Verify JAR is on device"""
    print("Verifying deployment...", end="", flush=True)
    output = run_cmd(f'"{ADB_PATH}" shell ls -lh {REMOTE_JAR}')
    if "main.jar" in output:
        print(" ✅")
        return True
    else:
        print(" ❌")
        return False

def check_atak():
    """Check if ATAK is installed"""
    print("Checking for ATAK...", end="", flush=True)
    output = run_cmd(f'"{ADB_PATH}" shell pm list packages')
    if "com.atakmap.app.civ" in output:
        print(" ✅ ATAK installed")
        return True
    else:
        print(" ❌ ATAK not installed")
        return False

def launch_atak():
    """Launch ATAK app"""
    print("Launching ATAK...", end="", flush=True)
    run_cmd(f'"{ADB_PATH}" shell am start -n com.atakmap.app.civ/com.atakmap.app.MainActivity')
    print(" ✅")

def main():
    print("=" * 50)
    print("ATAK Trust Overlay Deployment")
    print("=" * 50)
    print()
    
    # Step 1: Start emulator
    print("Step 1: Starting emulator...")
    subprocess.Popen([EMULATOR, "-avd", AVD_NAME, "-no-snapshot-load"], 
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    time.sleep(5)
    
    # Step 2: Wait for device
    print("Step 2: Waiting for device...")
    if not wait_for_device(180):
        print("ERROR: Device did not connect")
        sys.exit(1)
    
    # Step 3: Wait for boot
    print("Step 3: Waiting for boot...")
    if not wait_for_boot(120):
        print("WARNING: Device may not be fully booted, continuing anyway")
    
    # Step 4: Deploy JAR
    print("Step 4: Deploying plugin...")
    if not deploy_jar():
        print("ERROR: Deployment failed")
        sys.exit(1)
    
    # Step 5: Verify
    print("Step 5: Verifying...")
    verify_deployment()
    
    # Step 6: Check ATAK
    print("Step 6: Checking ATAK...")
    if check_atak():
        print("Step 7: Launching ATAK...")
        launch_atak()
        print()
        print("✅ SUCCESS! ATAK should be launching with trust overlay plugin")
        print()
        print("Next steps:")
        print("  1. Wait for ATAK to open on emulator")
        print("  2. Navigate to: Settings → Plugins")
        print("  3. Look for: 'AetherCore Trust Overlay'")
        print("  4. Status should show: 'Loaded' ✅")
    else:
        print()
        print("⚠️ ATAK not installed. To install:")
        print("  1. Download ATAK-Civ APK from TAK.gov")
        print("  2. Run: adb install -r atak-civ.apk")
        print("  3. Then re-run this script")
    
    print()
    print("Monitor logs:")
    print(f'  "{ADB_PATH}" logcat | findstr AetherCore')
    print()

if __name__ == "__main__":
    main()
