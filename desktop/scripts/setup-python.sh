#!/usr/bin/env bash
# setup-python.sh — Download python-build-standalone and install backend dependencies
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_DIR="$DESKTOP_DIR/python"

# Python version and release tag
PYTHON_VERSION="3.13.12"
RELEASE_TAG="20260203"
BASE_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_TAG}"

# Skip if already set up and working
if [ -x "$PYTHON_DIR/bin/python3" ]; then
  if "$PYTHON_DIR/bin/python3" -c "import manim; import fastapi; import anthropic" 2>/dev/null; then
    echo "  Embedded Python already set up — skipping."
    exit 0
  fi
fi

# Detect platform and architecture
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "${OS}" in
  darwin)
    case "${ARCH}" in
      arm64)  TRIPLE="aarch64-apple-darwin" ;;
      x86_64) TRIPLE="x86_64-apple-darwin" ;;
      *)      echo "ERROR: Unsupported macOS architecture: ${ARCH}"; exit 1 ;;
    esac
    ;;
  linux)
    case "${ARCH}" in
      x86_64)  TRIPLE="x86_64-unknown-linux-gnu" ;;
      aarch64) TRIPLE="aarch64-unknown-linux-gnu" ;;
      *)       echo "ERROR: Unsupported Linux architecture: ${ARCH}"; exit 1 ;;
    esac
    ;;
  *)
    echo "ERROR: Unsupported OS: ${OS}"
    exit 1
    ;;
esac

TARBALL="cpython-${PYTHON_VERSION}+${RELEASE_TAG}-${TRIPLE}-install_only.tar.gz"
DOWNLOAD_URL="${BASE_URL}/${TARBALL}"

echo "  Platform: ${OS}/${ARCH} (${TRIPLE})"
echo "  Python: ${PYTHON_VERSION} (release ${RELEASE_TAG})"

# Download
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "  Downloading ${TARBALL}..."
curl -L --fail --progress-bar -o "$TEMP_DIR/$TARBALL" "$DOWNLOAD_URL"

# Extract — the tarball contains a top-level "python/" directory
echo "  Extracting..."
rm -rf "$PYTHON_DIR"
tar -xzf "$TEMP_DIR/$TARBALL" -C "$DESKTOP_DIR"
# The archive extracts to "python/" which is exactly what we want

# Verify Python works
PYTHON_EXE="$PYTHON_DIR/bin/python3"
if [ ! -x "$PYTHON_EXE" ]; then
  # Some builds use python3.13 instead of python3
  if [ -x "$PYTHON_DIR/bin/python3.13" ]; then
    ln -sf python3.13 "$PYTHON_DIR/bin/python3"
    ln -sf python3.13 "$PYTHON_DIR/bin/python"
    PYTHON_EXE="$PYTHON_DIR/bin/python3"
  else
    echo "ERROR: Python executable not found in $PYTHON_DIR/bin/"
    ls -la "$PYTHON_DIR/bin/"
    exit 1
  fi
fi

# Ensure python -> python3 symlink exists
if [ ! -e "$PYTHON_DIR/bin/python" ]; then
  ln -sf python3 "$PYTHON_DIR/bin/python"
fi

echo "  Python version: $("$PYTHON_EXE" --version)"

# Upgrade pip
echo "  Upgrading pip..."
"$PYTHON_EXE" -m pip install --upgrade pip --quiet

# Install backend dependencies
# pycairo/manimpango need to build from source on Python 3.13 — ensure
# system tools (compiler, pkg-config, cairo) are discoverable.
echo "  Installing backend dependencies..."

# Ensure Homebrew and system tools are in PATH for native builds
export PATH="/usr/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"
export PKG_CONFIG_PATH="/opt/homebrew/lib/pkgconfig:/opt/homebrew/share/pkgconfig:/usr/local/lib/pkgconfig:${PKG_CONFIG_PATH:-}"

# Check for cairo (required by pycairo)
if ! command -v pkg-config >/dev/null 2>&1; then
  echo "  WARNING: pkg-config not found. Native packages may fail to build."
  echo "  Install with: brew install pkg-config cairo"
fi

REQUIREMENTS="$DESKTOP_DIR/backend/requirements.txt"
if [ -f "$REQUIREMENTS" ]; then
  "$PYTHON_EXE" -m pip install \
    -r "$REQUIREMENTS" \
    --quiet
else
  # Fallback: install core packages directly
  "$PYTHON_EXE" -m pip install \
    "fastapi>=0.104.0" \
    "uvicorn[standard]>=0.24.0" \
    "manim>=0.18.0" \
    "anthropic>=0.39.0" \
    "python-dotenv>=1.0.0" \
    --quiet
fi

# Verify key imports
echo "  Verifying imports..."
"$PYTHON_EXE" -c "
import manim
import fastapi
import anthropic
import uvicorn
import dotenv
print('  All imports OK')
"

echo "  Embedded Python ready at: $PYTHON_DIR"
