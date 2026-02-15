#!/usr/bin/env bash
# build-frontend.sh — Install deps and build the Next.js static export
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$DESKTOP_DIR/frontend"

echo "==> Building frontend (static export)..."

cd "$FRONTEND_DIR"

echo "  Installing npm dependencies..."
npm install

echo "  Running next build (output: export)..."
npx next build

# The static export lands in frontend/out/
if [ -d "$FRONTEND_DIR/out" ]; then
  echo "==> Frontend built successfully → frontend/out/"
else
  echo "ERROR: next build did not produce an 'out' directory"
  exit 1
fi
