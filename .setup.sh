#!/bin/bash

# ==========================================================
# SharpForge - All-in-One Native macOS App (.app / .dmg) Builder
# Zero-config: Run this single script directly on your Mac!
# ==========================================================

set -e

# Change directory to the root directory where this script is located
cd "$(dirname "$0")"

echo ""
echo "🚀 ========================================================="
echo "🚀  SharpForge: Native macOS App Packager (.dmg / .app)"
echo "🚀 ========================================================="
echo ""

# 1. Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not found in PATH."
    echo "👉 Please install Node.js LTS (https://nodejs.org) or run 'brew install node'."
    exit 1
fi

NODE_VER=$(node -v)
echo "🟢 Node.js detected: $NODE_VER"

# 2. Check for npm
if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm is not found. Please install npm."
    exit 1
fi

# 3. Check for .NET SDK
if command -v dotnet &> /dev/null; then
    DOTNET_VER=$(dotnet --version)
    echo "🟢 .NET SDK detected: $DOTNET_VER"
else
    echo "⚠️  Warning: .NET SDK not found. C# development requires .NET SDK 8.0+."
    echo "👉 You can install it anytime via: brew install --cask dotnet-sdk"
fi

# 4. Open-Source .NET Debugger (Samsung netcoredbg - MIT licensed)
echo "🔍 Checking open-source .NET debugger (netcoredbg)..."
DEBUGGER_DIR="$(pwd)/bin/netcoredbg"
mkdir -p "$DEBUGGER_DIR"
if command -v netcoredbg &> /dev/null; then
    echo "🟢 netcoredbg found in system PATH ($(which netcoredbg))"
elif [ -f "$DEBUGGER_DIR/netcoredbg" ] || [ -f "$DEBUGGER_DIR/netcoredbg/netcoredbg" ]; then
    echo "🟢 netcoredbg found in project bin: $DEBUGGER_DIR"
else
    echo "📥 Downloading open-source netcoredbg debugger for macOS..."
    ARCH=$(uname -m)
    if [ "$ARCH" = "arm64" ]; then
        curl -sSL "https://github.com/Samsung/netcoredbg/releases/download/3.2.0-1092/netcoredbg-osx-arm64.zip" -o /tmp/netcoredbg.zip 2>/dev/null || true
        if [ -s /tmp/netcoredbg.zip ] && [ $(wc -c < /tmp/netcoredbg.zip) -gt 100000 ]; then
            unzip -qo /tmp/netcoredbg.zip -d "$DEBUGGER_DIR" 2>/dev/null || true
            rm -f /tmp/netcoredbg.zip
        fi
    else
        curl -sSL "https://github.com/Samsung/netcoredbg/releases/download/3.1.3-1062/netcoredbg-osx-amd64.tar.gz" -o /tmp/netcoredbg.tar.gz 2>/dev/null || true
        if [ -s /tmp/netcoredbg.tar.gz ] && [ $(wc -c < /tmp/netcoredbg.tar.gz) -gt 100000 ]; then
            tar -xzf /tmp/netcoredbg.tar.gz -C "$DEBUGGER_DIR" 2>/dev/null || true
            rm -f /tmp/netcoredbg.tar.gz
        fi
    fi
    find "$DEBUGGER_DIR" -name "netcoredbg" -exec chmod +x {} + 2>/dev/null || true
    xattr -dr com.apple.quarantine "$DEBUGGER_DIR" 2>/dev/null || true
    if [ -f "$DEBUGGER_DIR/netcoredbg" ] || [ -f "$DEBUGGER_DIR/netcoredbg/netcoredbg" ]; then
        echo "🟢 netcoredbg ready in $DEBUGGER_DIR"
    else
        echo "ℹ️  netcoredbg will be resolved from PATH or IDE settings."
    fi
fi

echo ""
echo "📦 [1/4] Installing project & runtime dependencies..."
npm install --legacy-peer-deps

echo ""
echo "📦 [2/4] Ensuring Electron & Electron-Builder packaging tools are ready..."
npm install --save-dev --legacy-peer-deps electron electron-builder

echo ""
echo "🧹 Cleaning previous build packages and cache..."
rm -rf dist/mac* dist/win* dist/*.exe dist/*.dmg dist/*.zip dist/*.blockmap dist/SharpForge.app 2>/dev/null || true

echo ""
echo "⚙️ [3/4] Compiling UI and bundling desktop assets into dist/..."
npm run build

echo ""
echo "🍎 [4/4] Packaging Native macOS Application (.app and .dmg)..."

# Ensure Keychain access doesn't block packaging on Mac
export CSC_IDENTITY_AUTO_DISCOVERY=false
export ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES=true

# Detect Mac Architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    echo "⚡ Detected Apple Silicon (M1 / M2 / M3 / M4) Mac."
    echo "⚡ Building native ARM64 application with app icon..."
    npx --yes electron-builder --mac --arm64 -c.directories.output=dist -c.mac.identity=null
else
    echo "⚡ Detected Intel (x86_64) Mac."
    echo "⚡ Building native x64 application with app icon..."
    npx --yes electron-builder --mac --x64 -c.directories.output=dist -c.mac.identity=null
fi

# Ensure SharpForge.app is directly accessible at dist/SharpForge.app
if [ -d "dist/mac-$ARCH/SharpForge.app" ]; then
    rm -rf "dist/SharpForge.app"
    cp -R "dist/mac-$ARCH/SharpForge.app" "dist/SharpForge.app" 2>/dev/null || true
elif [ -d "dist/mac/SharpForge.app" ]; then
    rm -rf "dist/SharpForge.app"
    cp -R "dist/mac/SharpForge.app" "dist/SharpForge.app" 2>/dev/null || true
fi

echo ""
echo "========================================================="
echo "🎉 SUCCESS! Your Native Mac App has been built!"
echo "========================================================="
echo ""
echo "📁 Your compiled application files are ready in the 'dist' folder:"
if [ "$ARCH" = "arm64" ]; then
    echo "   👉 App Bundle:  dist/SharpForge.app (and dist/mac-arm64/SharpForge.app)"
    echo "   👉 Installer:   dist/SharpForge-*.dmg (if generated)"
else
    echo "   👉 App Bundle:  dist/SharpForge.app (and dist/mac/SharpForge.app)"
    echo "   👉 Installer:   dist/SharpForge-*.dmg (if generated)"
fi
echo ""
echo "🚀 To Run SharpForge on your Mac:"
echo "   1. Open the dist folder in Finder:"
echo "      $ open dist"
echo "   2. Double-click 'SharpForge.app' or drag it to your Applications folder."
echo "   3. Launch directly from terminal:"
echo "      $ open dist/SharpForge.app"
echo ""
echo "📝 Centralized Debug & Execution Logs:"
echo "   All runtime and IDE logs are written live to: ~/sharpforge-logs"
echo "   - Master trace log:      ~/sharpforge-logs/app.log"
echo "   - Errors & exceptions:   ~/sharpforge-logs/error.log"
echo "   - Electron process:      ~/sharpforge-logs/electron.log"
echo ""
echo "💡 Tip: View live logs anytime with: tail -f ~/sharpforge-logs/app.log"
echo "💡 Tip: In SharpForge, press ⌥⌘I (Option+Command+I) to toggle DevTools console."
echo ""
