# AetherCore Desktop Icon Setup

## Overview

The AetherCore Tactical Glass desktop application uses a custom brand icon located at `packages/shared/app-icon.png`. This icon is automatically converted into all required platform-specific formats during the build process.

## Icon Source

**Location:** `packages/shared/app-icon.png`  
**Format:** PNG (recommended: 1024x1024 or larger)  
**Usage:** Source for all desktop application icons

This file is provided by the crash-reporting feature branch and will be available after merge.

## Generating Platform-Specific Icons

To generate all required icon formats from the source icon:

```bash
./scripts/generate-tauri-icons.sh
```

This script creates:
- **Windows:** `icon.ico` (multi-size: 16x16 to 256x256)
- **macOS:** `icon.icns` (iconset with retina support)
- **Linux:** PNG files in various sizes
- **Windows Store:** Square logo variants

### Requirements

- ImageMagick (`convert` command)
- For macOS icons:
  - macOS: `iconutil` (pre-installed)
  - Linux: `icnsutils` package

### Installation

**Ubuntu/Debian:**
```bash
sudo apt-get install imagemagick icnsutils
```

**macOS:**
```bash
brew install imagemagick
# iconutil is pre-installed on macOS
```

## Output Directory

All generated icons are placed in:
```
packages/dashboard/src-tauri/icons/
```

Tauri automatically uses these icons based on the configuration in `tauri.conf.json`.

## Workflow Integration

### Manual Process
1. Merge branch containing `packages/shared/app-icon.png`
2. Run `./scripts/generate-tauri-icons.sh`
3. Commit generated icons
4. Build desktop application: `cd packages/dashboard && npx tauri build`

### Automated Process
The icon generation can be integrated into CI/CD:
- Run script after merging branches with icon changes
- Include in pre-build step for desktop releases
- Validate icon presence before desktop builds

## Icon Specifications

### Source Icon
- **Minimum size:** 1024x1024 pixels
- **Format:** PNG with transparency
- **Color space:** RGB or RGBA
- **Aspect ratio:** 1:1 (square)

### Generated Sizes
- Windows: 16, 32, 48, 64, 128, 256 (in .ico)
- macOS: 16, 32, 128, 256, 512, 1024 (with @2x variants)
- Windows Store: 30, 44, 71, 89, 107, 142, 150, 284, 310, StoreLogo

## Troubleshooting

### Source icon not found
```
❌ Source icon not found: packages/shared/app-icon.png
```
**Solution:** Ensure the crash-reporting branch is merged, or manually add the icon file.

### ImageMagick not found
```
❌ ImageMagick not found
```
**Solution:** Install ImageMagick using your package manager.

### .icns generation failed
```
⚠️  Warning: Neither iconutil nor png2icns found
```
**Solution:** 
- On macOS: iconutil should be pre-installed
- On Linux: `sudo apt-get install icnsutils`
- The script will continue and generate all other icons

## Integration with Tauri

The generated icons are automatically used by Tauri based on the configuration in `packages/dashboard/src-tauri/tauri.conf.json`:

```json
"bundle": {
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico"
  ]
}
```

No additional configuration is needed after running the icon generation script.

## Validation

To verify icons were generated correctly:

```bash
# Check icon directory
ls -lh packages/dashboard/src-tauri/icons/

# Verify .ico file
file packages/dashboard/src-tauri/icons/icon.ico

# Verify .icns file (macOS)
file packages/dashboard/src-tauri/icons/icon.icns

# Test build
cd packages/dashboard
npx tauri build
```

## References

- [Tauri Icon Guide](https://tauri.app/v1/guides/features/icons/)
- [ImageMagick Documentation](https://imagemagick.org/)
- [Apple Human Interface Guidelines - App Icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)
