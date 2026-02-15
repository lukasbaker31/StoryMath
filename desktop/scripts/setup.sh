#!/usr/bin/env bash
# setup.sh — Full build pipeline for StoryMath desktop app
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "============================================"
echo "  StoryMath Desktop — Setup"
echo "============================================"
echo ""

# Step 1: Copy and patch source files
echo "[1/3] Copying and patching sources..."
bash "$DESKTOP_DIR/scripts/copy-sources.sh"
echo ""

# Step 2: Build frontend static export
echo "[2/3] Building frontend..."
bash "$DESKTOP_DIR/scripts/build-frontend.sh"
echo ""

# Step 3: Install Electron
echo "[3/3] Installing Electron..."
cd "$DESKTOP_DIR"
npm install
echo ""

echo "============================================"
echo "  Setup complete!"
echo ""
echo "  Run:  cd desktop && npm start"
echo "============================================"
