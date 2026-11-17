#!/bin/bash
# Build an unsigned local macOS application using the repository lockfile.
set -euo pipefail
cd "$(dirname "$0")"

fail() { printf 'Setup failed: %s\n' "$*" >&2; exit 1; }
[[ "$(uname -s)" == Darwin ]] || fail 'This packager requires macOS.'
case "$(uname -m)" in
  arm64) build_arch=arm64; bundle_dir=mac-arm64 ;;
  x86_64) build_arch=x64; bundle_dir=mac ;;
  *) fail 'Unsupported Mac architecture.' ;;
esac
command -v node >/dev/null || fail 'Install Node.js 24 LTS or newer.'
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" =~ ^[0-9]+$ && "$node_major" -ge 24 ]] || fail 'Node.js 24 or newer is required.'
command -v npm >/dev/null || fail 'Install npm with Node.js.'
xcode-select -p >/dev/null 2>&1 || fail 'Install Xcode Command Line Tools: xcode-select --install'
xcrun --find clang >/dev/null 2>&1 || fail 'The Xcode C/C++ compiler is unavailable.'
[[ -f package-lock.json ]] || fail 'package-lock.json is required for reproducible installation.'

printf 'Building Cairn IDE for macOS %s\n' "$build_arch"
if command -v dotnet >/dev/null; then
  dotnet --version
else
  printf '.NET SDK not detected. Install the SDK required by your C# projects before using build/run/test.\n'
fi
if command -v netcoredbg >/dev/null; then
  printf 'Debugger found: %s\n' "$(command -v netcoredbg)"
else
  printf 'Configure a trusted netcoredbg installation in IDE Settings to enable debugging.\n'
fi

# postinstall rebuilds node-pty for the pinned Electron ABI.
printf '[1/4] Installing locked dependencies and rebuilding native terminal support…\n'
npm ci
printf '[2/4] Checking the Electron native module…\n'
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "require('node-pty'); console.log('Native terminal module loaded')"
printf '[3/4] Building the editor…\n'
npm run build
printf '[4/4] Packaging the unsigned application…\n'
export CSC_IDENTITY_AUTO_DISCOVERY=false
# Keep installers outside the UI dist directory, which Vite cleans on build.
npm exec --offline -- electron-builder --mac "--$build_arch" -c.directories.output=release -c.mac.identity=null
bundle="release/$bundle_dir/Cairn IDE.app"
[[ -d "$bundle" ]] || fail "The packager did not produce $bundle"
printf '\nBuilt: %s\nOpen with: open "%s"\n' "$bundle" "$bundle"
printf 'DMG installers, if generated, are in release/. This local build is unsigned; public releases require signing and notarization.\n'
