#!/bin/bash
# Generate Tauri Icons from AetherCore Brand Icon
# This script converts packages/shared/app-icon.png into all required Tauri icon formats
# 
# Requirements:
#   - ImageMagick (convert command)
#   - icnsutils (png2icns) for macOS icons
#   - ImageMagick with ICO support for Windows icons
#
# Usage: ./scripts/generate-tauri-icons.sh

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ICON="$REPO_ROOT/packages/shared/app-icon.png"
ICON_DIR="$REPO_ROOT/packages/dashboard/src-tauri/icons"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎨 Generating Tauri Icons from AetherCore Brand Icon"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if source icon exists
if [ ! -f "$SOURCE_ICON" ]; then
    echo "❌ Source icon not found: $SOURCE_ICON"
    echo ""
    echo "Please ensure packages/shared/app-icon.png exists before running this script."
    echo "This file should be added by merging the crash-reporting branch."
    exit 1
fi

echo "✅ Source icon found: $SOURCE_ICON"

# Check for ImageMagick
if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick not found. Install with:"
    echo "   Ubuntu/Debian: sudo apt-get install imagemagick"
    echo "   macOS: brew install imagemagick"
    exit 1
fi

echo "✅ ImageMagick found"
echo ""

# Create icon directory if it doesn't exist
mkdir -p "$ICON_DIR"

echo "📦 Generating PNG icons..."

# Generate standard PNG sizes for Tauri
convert "$SOURCE_ICON" -resize 32x32 "$ICON_DIR/32x32.png"
echo "  ✓ 32x32.png"

convert "$SOURCE_ICON" -resize 128x128 "$ICON_DIR/128x128.png"
echo "  ✓ 128x128.png"

convert "$SOURCE_ICON" -resize 256x256 "$ICON_DIR/128x128@2x.png"
echo "  ✓ 128x128@2x.png"

convert "$SOURCE_ICON" -resize 512x512 "$ICON_DIR/icon.png"
echo "  ✓ icon.png"

# Generate Windows Store logos
convert "$SOURCE_ICON" -resize 30x30 "$ICON_DIR/Square30x30Logo.png"
echo "  ✓ Square30x30Logo.png"

convert "$SOURCE_ICON" -resize 44x44 "$ICON_DIR/Square44x44Logo.png"
echo "  ✓ Square44x44Logo.png"

convert "$SOURCE_ICON" -resize 71x71 "$ICON_DIR/Square71x71Logo.png"
echo "  ✓ Square71x71Logo.png"

convert "$SOURCE_ICON" -resize 89x89 "$ICON_DIR/Square89x89Logo.png"
echo "  ✓ Square89x89Logo.png"

convert "$SOURCE_ICON" -resize 107x107 "$ICON_DIR/Square107x107Logo.png"
echo "  ✓ Square107x107Logo.png"

convert "$SOURCE_ICON" -resize 142x142 "$ICON_DIR/Square142x142Logo.png"
echo "  ✓ Square142x142Logo.png"

convert "$SOURCE_ICON" -resize 150x150 "$ICON_DIR/Square150x150Logo.png"
echo "  ✓ Square150x150Logo.png"

convert "$SOURCE_ICON" -resize 284x284 "$ICON_DIR/Square284x284Logo.png"
echo "  ✓ Square284x284Logo.png"

convert "$SOURCE_ICON" -resize 310x310 "$ICON_DIR/Square310x310Logo.png"
echo "  ✓ Square310x310Logo.png"

convert "$SOURCE_ICON" -resize 50x50 "$ICON_DIR/StoreLogo.png"
echo "  ✓ StoreLogo.png"

echo ""
echo "🪟 Generating Windows .ico file..."

# Generate Windows ICO with multiple sizes
convert "$SOURCE_ICON" -resize 256x256 \
    \( -clone 0 -resize 16x16 \) \
    \( -clone 0 -resize 32x32 \) \
    \( -clone 0 -resize 48x48 \) \
    \( -clone 0 -resize 64x64 \) \
    \( -clone 0 -resize 128x128 \) \
    -delete 0 -colors 256 "$ICON_DIR/icon.ico"

echo "  ✓ icon.ico (multi-size)"

echo ""
echo "🍎 Generating macOS .icns file..."

# Generate macOS ICNS
# Create temporary directory for iconset
ICONSET_DIR="$ICON_DIR/icon.iconset"
mkdir -p "$ICONSET_DIR"

# Generate all required sizes for macOS iconset
convert "$SOURCE_ICON" -resize 16x16 "$ICONSET_DIR/icon_16x16.png"
convert "$SOURCE_ICON" -resize 32x32 "$ICONSET_DIR/icon_16x16@2x.png"
convert "$SOURCE_ICON" -resize 32x32 "$ICONSET_DIR/icon_32x32.png"
convert "$SOURCE_ICON" -resize 64x64 "$ICONSET_DIR/icon_32x32@2x.png"
convert "$SOURCE_ICON" -resize 128x128 "$ICONSET_DIR/icon_128x128.png"
convert "$SOURCE_ICON" -resize 256x256 "$ICONSET_DIR/icon_128x128@2x.png"
convert "$SOURCE_ICON" -resize 256x256 "$ICONSET_DIR/icon_256x256.png"
convert "$SOURCE_ICON" -resize 512x512 "$ICONSET_DIR/icon_256x256@2x.png"
convert "$SOURCE_ICON" -resize 512x512 "$ICONSET_DIR/icon_512x512.png"
convert "$SOURCE_ICON" -resize 1024x1024 "$ICONSET_DIR/icon_512x512@2x.png"

# Convert iconset to icns
if command -v iconutil &> /dev/null; then
    # macOS native tool
    iconutil -c icns -o "$ICON_DIR/icon.icns" "$ICONSET_DIR"
    echo "  ✓ icon.icns (using iconutil)"
elif command -v png2icns &> /dev/null; then
    # Alternative tool from icnsutils
    png2icns "$ICON_DIR/icon.icns" "$ICONSET_DIR"/*.png
    echo "  ✓ icon.icns (using png2icns)"
else
    echo "  ⚠️  Warning: Neither iconutil nor png2icns found"
    echo "     icon.icns not generated - install icnsutils or run on macOS"
    echo "     Ubuntu/Debian: sudo apt-get install icnsutils"
    echo "     macOS: iconutil is pre-installed"
fi

# Clean up iconset directory
rm -rf "$ICONSET_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Icon Generation Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Generated icons in: $ICON_DIR"
echo ""
echo "Tauri will use these icons for:"
echo "  • Windows: icon.ico (installer & app icon)"
echo "  • macOS: icon.icns (DMG & app bundle)"
echo "  • Linux: PNG files (various sizes)"
echo "  • Windows Store: Square*Logo.png files"
echo ""
echo "To rebuild the desktop app with new icons:"
echo "  cd packages/dashboard"
echo "  npx tauri build"
echo ""
