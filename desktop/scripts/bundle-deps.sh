#!/usr/bin/env bash
# bundle-deps.sh — Bundle native dylibs and ffmpeg into the embedded Python
# Makes the app self-contained on macOS without needing Homebrew at runtime.
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_DIR="$DESKTOP_DIR/python"
DYLIB_DIR="$PYTHON_DIR/lib/dylibs"
SITE_PACKAGES="$PYTHON_DIR/lib/python3.13/site-packages"

# Skip if already bundled
if [ -d "$DYLIB_DIR" ] && [ -x "$PYTHON_DIR/bin/ffmpeg" ]; then
  echo "  Native dependencies already bundled — skipping."
  exit 0
fi

# ---------------------------------------------------------------------------
# Part 1: Bundle native dylibs (cairo and its dependency tree)
# ---------------------------------------------------------------------------
echo "  Bundling native libraries..."

mkdir -p "$DYLIB_DIR"

# Complete list of Homebrew dylibs needed by pycairo -> libcairo -> transitive deps
HOMEBREW_LIBS=(
  /opt/homebrew/opt/cairo/lib/libcairo.2.dylib
  /opt/homebrew/opt/libpng/lib/libpng16.16.dylib
  /opt/homebrew/opt/fontconfig/lib/libfontconfig.1.dylib
  /opt/homebrew/opt/freetype/lib/libfreetype.6.dylib
  /opt/homebrew/opt/libx11/lib/libX11.6.dylib
  /opt/homebrew/opt/libxext/lib/libXext.6.dylib
  /opt/homebrew/opt/libxrender/lib/libXrender.1.dylib
  /opt/homebrew/opt/libxcb/lib/libxcb.1.dylib
  /opt/homebrew/opt/libxcb/lib/libxcb-render.0.dylib
  /opt/homebrew/opt/libxcb/lib/libxcb-shm.0.dylib
  /opt/homebrew/opt/pixman/lib/libpixman-1.0.dylib
  /opt/homebrew/opt/gettext/lib/libintl.8.dylib
  /opt/homebrew/opt/libxau/lib/libXau.6.dylib
  /opt/homebrew/opt/libxdmcp/lib/libXdmcp.6.dylib
)

# Check that all source libs exist
MISSING=0
for lib in "${HOMEBREW_LIBS[@]}"; do
  if [ ! -f "$lib" ]; then
    echo "  WARNING: Missing Homebrew library: $lib"
    MISSING=1
  fi
done

if [ "$MISSING" -eq 1 ]; then
  echo "  ERROR: Some Homebrew libraries are missing. Install with:"
  echo "    brew install cairo libpng fontconfig freetype libx11 libxext libxrender libxcb pixman gettext libxau libxdmcp"
  exit 1
fi

# Copy all dylibs
for lib in "${HOMEBREW_LIBS[@]}"; do
  BASENAME="$(basename "$lib")"
  cp "$lib" "$DYLIB_DIR/$BASENAME"
  chmod 644 "$DYLIB_DIR/$BASENAME"
  echo "    Copied $BASENAME"
done

# Rewrite inter-library references to use @loader_path
# Each dylib's own ID and all references to other Homebrew dylibs are rewritten
echo "  Rewriting dylib load paths..."

for lib in "$DYLIB_DIR"/*.dylib; do
  BASENAME="$(basename "$lib")"

  # Update the library's own install name
  install_name_tool -id "@loader_path/$BASENAME" "$lib" 2>/dev/null || true

  # Rewrite all references to Homebrew paths → @loader_path
  # Use grep || true to handle dylibs with no Homebrew deps (grep returns 1 on no match)
  DEPS="$(otool -L "$lib" | awk 'NR>1{print $1}' | grep -E "^/opt/homebrew" || true)"
  if [ -n "$DEPS" ]; then
    while IFS= read -r dep; do
      DEP_BASENAME="$(basename "$dep")"
      install_name_tool -change "$dep" "@loader_path/$DEP_BASENAME" "$lib" 2>/dev/null || true
    done <<< "$DEPS"
  fi

  # Re-sign with ad-hoc signature (required on macOS after modifying binaries)
  codesign --force --sign - "$lib" 2>/dev/null || true
done

# Rewrite pycairo's _cairo.so to load libcairo from our dylibs dir
echo "  Patching pycairo to use bundled libcairo..."
CAIRO_SO="$SITE_PACKAGES/cairo/_cairo.cpython-313-darwin.so"
if [ -f "$CAIRO_SO" ]; then
  # Change the reference from Homebrew path to @loader_path-relative
  # The .so is in site-packages/cairo/, dylibs are in lib/dylibs/
  # Relative path from site-packages/cairo/ to lib/dylibs/ is ../../../dylibs/
  RPATH_PREFIX="@loader_path/../../../dylibs"
  install_name_tool -change \
    "/opt/homebrew/opt/cairo/lib/libcairo.2.dylib" \
    "${RPATH_PREFIX}/libcairo.2.dylib" \
    "$CAIRO_SO"
  codesign --force --sign - "$CAIRO_SO" 2>/dev/null || true
  echo "    Patched _cairo.so → ${RPATH_PREFIX}/libcairo.2.dylib"
else
  echo "  WARNING: pycairo .so not found at expected path"
  # Try to find it
  find "$SITE_PACKAGES/cairo" -name "*.so" -o -name "*.dylib" 2>/dev/null
fi

# Verify the rewrite
echo "  Verifying pycairo links..."
otool -L "$CAIRO_SO" 2>/dev/null | head -5

# ---------------------------------------------------------------------------
# Part 2: Bundle ffmpeg
# ---------------------------------------------------------------------------
echo ""
echo "  Bundling ffmpeg..."

FFMPEG_BIN="$PYTHON_DIR/bin/ffmpeg"

if [ -x "$FFMPEG_BIN" ]; then
  echo "    ffmpeg already bundled — skipping."
else
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"

  if [ "$OS" = "darwin" ]; then
    # Use martin-riedl.de static builds — supports both ARM64 and x86_64
    if [ "$ARCH" = "arm64" ]; then
      FFMPEG_URL="https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip"
    else
      FFMPEG_URL="https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip"
    fi

    TEMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TEMP_DIR"' EXIT

    echo "    Downloading ffmpeg (static build for ${ARCH})..."
    curl -L --fail --progress-bar -o "$TEMP_DIR/ffmpeg.zip" "$FFMPEG_URL"

    echo "    Extracting..."
    unzip -q "$TEMP_DIR/ffmpeg.zip" -d "$TEMP_DIR"
    cp "$TEMP_DIR/ffmpeg" "$FFMPEG_BIN"
    chmod +x "$FFMPEG_BIN"
    # Remove quarantine attribute (macOS may block downloaded binaries)
    xattr -dr com.apple.quarantine "$FFMPEG_BIN" 2>/dev/null || true

    echo "    ffmpeg version: $("$FFMPEG_BIN" -version 2>&1 | head -1)"
  elif [ "$OS" = "linux" ]; then
    # Use johnvansickle.com static builds for Linux
    if [ "$ARCH" = "x86_64" ]; then
      FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
    elif [ "$ARCH" = "aarch64" ]; then
      FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz"
    else
      echo "    WARNING: No static ffmpeg available for ${OS}/${ARCH}"
      exit 0
    fi

    TEMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TEMP_DIR"' EXIT

    echo "    Downloading ffmpeg (static build)..."
    curl -L --fail --progress-bar -o "$TEMP_DIR/ffmpeg.tar.xz" "$FFMPEG_URL"
    tar -xf "$TEMP_DIR/ffmpeg.tar.xz" -C "$TEMP_DIR" --strip-components=1
    cp "$TEMP_DIR/ffmpeg" "$FFMPEG_BIN"
    chmod +x "$FFMPEG_BIN"

    echo "    ffmpeg version: $("$FFMPEG_BIN" -version 2>&1 | head -1)"
  else
    echo "    WARNING: ffmpeg bundling not supported on ${OS}"
  fi
fi

echo "  Native dependencies bundled."
