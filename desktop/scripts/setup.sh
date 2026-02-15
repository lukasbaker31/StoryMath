#!/usr/bin/env bash
# setup.sh — Full build pipeline for StoryMath desktop app
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "============================================"
echo "  StoryMath Desktop — Setup"
echo "============================================"
echo ""

# Step 1: Copy and patch source files
echo "[1/4] Copying and patching sources..."
bash "$DESKTOP_DIR/scripts/copy-sources.sh"
echo ""

# Step 2: Set up embedded Python
echo "[2/5] Setting up embedded Python..."
bash "$DESKTOP_DIR/scripts/setup-python.sh"
echo ""

# Step 3: Bundle native dependencies (dylibs + ffmpeg)
echo "[3/5] Bundling native dependencies..."
bash "$DESKTOP_DIR/scripts/bundle-deps.sh"
echo ""

# Step 4: Build frontend static export
echo "[4/5] Building frontend..."
bash "$DESKTOP_DIR/scripts/build-frontend.sh"
echo ""

# Step 5: Install Electron
echo "[5/5] Installing Electron..."
cd "$DESKTOP_DIR"
npm install
echo ""

echo "============================================"
echo "  Setup complete!"
echo ""
echo "  Run:  cd desktop && npm start"
echo "============================================"
