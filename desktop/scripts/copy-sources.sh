#!/usr/bin/env bash
# copy-sources.sh — Copy and patch source files from the parent project
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$(cd "$DESKTOP_DIR/.." && pwd)"

echo "==> Copying sources from $PROJECT_DIR into $DESKTOP_DIR"

# ---------------------------------------------------------------------------
# 1. Frontend
# ---------------------------------------------------------------------------
echo "  Copying frontend..."
rm -rf "$DESKTOP_DIR/frontend"
# Copy everything except node_modules, .next, out
mkdir -p "$DESKTOP_DIR/frontend"
rsync -a --exclude='node_modules' --exclude='.next' --exclude='out' \
  "$PROJECT_DIR/frontend/" "$DESKTOP_DIR/frontend/"

# Patch next.config.mjs — add static export + unoptimized images
echo "  Patching next.config.mjs for static export..."
cat > "$DESKTOP_DIR/frontend/next.config.mjs" << 'NEXTCONFIG'
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  transpilePackages: ['tldraw'],
  images: { unoptimized: true },
}

export default nextConfig
NEXTCONFIG

# Patch api.ts — use window.location.origin instead of hardcoded localhost
echo "  Patching api.ts for dynamic origin..."
sed -i '' "s|const API_BASE = 'http://127.0.0.1:8000'|const API_BASE = typeof window !== 'undefined' ? window.location.origin : ''|" \
  "$DESKTOP_DIR/frontend/src/lib/api.ts"

# ---------------------------------------------------------------------------
# 2. Backend
# ---------------------------------------------------------------------------
echo "  Copying backend..."
rm -rf "$DESKTOP_DIR/backend"
mkdir -p "$DESKTOP_DIR/backend"

# Copy Python source files (not the venv — we symlink to the original)
for f in main.py templates.py requirements.txt .env; do
  if [ -f "$PROJECT_DIR/backend/$f" ]; then
    cp "$PROJECT_DIR/backend/$f" "$DESKTOP_DIR/backend/$f"
  fi
done

# Copy any other Python files (tests, utils, etc.)
find "$PROJECT_DIR/backend" -maxdepth 1 -name '*.py' -exec cp {} "$DESKTOP_DIR/backend/" \;

# Symlink the venv to avoid duplicating ~500MB of packages
if [ -d "$PROJECT_DIR/backend/venv" ] && [ ! -e "$DESKTOP_DIR/backend/venv" ]; then
  echo "  Symlinking venv..."
  ln -s "$PROJECT_DIR/backend/venv" "$DESKTOP_DIR/backend/venv"
fi

# Patch templates.py — make SAMPLES_DIR overridable via env var
echo "  Patching templates.py for configurable samples dir..."
sed -i '' 's|^SAMPLES_DIR = Path(__file__).resolve().parent.parent / "manim_code_samples"|SAMPLES_DIR = Path(os.environ.get("STORYMATH_SAMPLES_DIR", str(Path(__file__).resolve().parent.parent / "manim_code_samples")))|' \
  "$DESKTOP_DIR/backend/templates.py"

# Add 'import os' to templates.py if not already present
if ! grep -q '^import os' "$DESKTOP_DIR/backend/templates.py"; then
  sed -i '' '1s/^/import os\n/' "$DESKTOP_DIR/backend/templates.py"
fi

# Patch main.py — add CLI entrypoint, static mount, /api/config/key endpoint
echo "  Patching main.py for desktop mode..."

# Add EXTRA_BIN_PATHS support and widen CORS
sed -i '' 's|allow_origins=\["http://localhost:3000", "http://127.0.0.1:3000"\]|allow_origins=["*"]|' \
  "$DESKTOP_DIR/backend/main.py"

# Append the /api/config/key endpoint and __main__ block
cat >> "$DESKTOP_DIR/backend/main.py" << 'PYEOF'


# ---------------------------------------------------------------------------
# Desktop-mode additions
# ---------------------------------------------------------------------------

class ConfigKeyRequest(BaseModel):
    key: str


@app.post("/api/config/key")
def set_api_key(req: ConfigKeyRequest):
    """Update the API key at runtime (called by Electron when user changes key)."""
    os.environ["ANTHROPIC_API_KEY"] = req.key
    return {"ok": True}


if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="StoryMath backend")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--data-dir", type=str, default=None,
                        help="Override project data directory")
    parser.add_argument("--static-dir", type=str, default=None,
                        help="Directory with static frontend files to serve")
    args = parser.parse_args()

    # Override project dir if requested
    if args.data_dir:
        PROJECT_DIR = Path(args.data_dir)
        RENDERS_DIR = PROJECT_DIR / "renders"
        RENDERS_INDEX_PATH = PROJECT_DIR / "renders.json"

    # Mount static files AFTER all API routes (must be last)
    if args.static_dir:
        from starlette.staticfiles import StaticFiles
        static_path = Path(args.static_dir)
        if static_path.exists():
            app.mount("/", StaticFiles(directory=str(static_path), html=True), name="static")
        else:
            print(f"WARNING: Static directory not found: {static_path}")

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")
PYEOF

# ---------------------------------------------------------------------------
# 3. Manim code samples
# ---------------------------------------------------------------------------
echo "  Copying manim_code_samples..."
rm -rf "$DESKTOP_DIR/manim_code_samples"
if [ -d "$PROJECT_DIR/manim_code_samples" ]; then
  cp -r "$PROJECT_DIR/manim_code_samples" "$DESKTOP_DIR/manim_code_samples"
fi

echo "==> Sources copied and patched."
