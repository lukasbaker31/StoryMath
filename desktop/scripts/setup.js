#!/usr/bin/env node
/**
 * setup.js — Cross-platform setup for StoryMath desktop app
 *
 * Replaces the bash scripts (setup.sh, copy-sources.sh, setup-python.sh,
 * bundle-deps.sh, build-frontend.sh) with a single Node.js script that
 * works on macOS, Windows, and Linux.
 *
 * Usage: node scripts/setup.js
 */
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const os = require('os');
const https = require('https');
const http = require('http');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const DESKTOP_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.resolve(DESKTOP_DIR, '..');
const PYTHON_DIR = path.join(DESKTOP_DIR, 'python');

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------
const PLATFORM = process.platform;   // 'darwin', 'win32', 'linux'
const ARCH = process.arch;           // 'arm64', 'x64'
const IS_WIN = PLATFORM === 'win32';
const IS_MAC = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';
const PATH_SEP = IS_WIN ? ';' : ':';

function getTriple() {
  if (IS_MAC) {
    return ARCH === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  if (IS_WIN) {
    return 'x86_64-pc-windows-msvc';
  }
  // Linux
  return ARCH === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
}

function getPythonExe(pythonDir) {
  return IS_WIN
    ? path.join(pythonDir, 'python.exe')
    : path.join(pythonDir, 'bin', 'python3');
}

function getPipExe(pythonDir) {
  return IS_WIN
    ? path.join(pythonDir, 'Scripts', 'pip.exe')
    : path.join(pythonDir, 'bin', 'pip3');
}

function getFfmpegExe(pythonDir) {
  return IS_WIN
    ? path.join(pythonDir, 'ffmpeg.exe')
    : path.join(pythonDir, 'bin', 'ffmpeg');
}

function getSitePackages(pythonDir) {
  return IS_WIN
    ? path.join(pythonDir, 'Lib', 'site-packages')
    : path.join(pythonDir, 'lib', 'python3.13', 'site-packages');
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function run(cmd, opts = {}) {
  console.log(`    $ ${cmd}`);
  return execSync(cmd, {
    stdio: opts.silent ? 'pipe' : 'inherit',
    cwd: opts.cwd || DESKTOP_DIR,
    env: { ...process.env, ...opts.env },
    shell: true,
    timeout: opts.timeout || 600000,  // 10 min default
  });
}

function runSilent(cmd, opts = {}) {
  return run(cmd, { ...opts, silent: true });
}

/** Copy a directory recursively, excluding patterns. */
function copyDirSync(src, dest, excludes = []) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (excludes.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, excludes);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** Remove directory recursively. */
function rmrf(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Download a file via HTTPS (follows redirects). */
function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const cleanup = (err) => {
      file.close(() => {
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    };

    const request = (reqUrl, redirectCount = 0) => {
      if (redirectCount > 10) return cleanup(new Error('Too many redirects'));

      const proto = reqUrl.startsWith('https') ? https : http;
      proto.get(reqUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const loc = res.headers.location;
          const nextUrl = loc.startsWith('http') ? loc : new URL(loc, reqUrl).href;
          request(nextUrl, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          return cleanup(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', cleanup);
    };

    request(url);
  });
}

/** Read a file, replace a string, write it back. */
function patchFile(filePath, search, replace) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (typeof search === 'string') {
    content = content.replace(search, replace);
  } else {
    // Regex
    content = content.replace(search, replace);
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

// =========================================================================
// Step 1: Copy and patch sources
// =========================================================================
function step1_copySources() {
  console.log('\n[1/5] Copying and patching sources...');

  // --- Frontend ---
  console.log('  Copying frontend...');
  rmrf(path.join(DESKTOP_DIR, 'frontend'));
  copyDirSync(
    path.join(PROJECT_DIR, 'frontend'),
    path.join(DESKTOP_DIR, 'frontend'),
    ['node_modules', '.next', 'out']
  );

  // Patch next.config.mjs for static export
  console.log('  Patching next.config.mjs for static export...');
  fs.writeFileSync(path.join(DESKTOP_DIR, 'frontend', 'next.config.mjs'), `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  transpilePackages: ['tldraw'],
  images: { unoptimized: true },
}

export default nextConfig
`, 'utf8');

  // Patch api.ts — dynamic origin
  console.log('  Patching api.ts for dynamic origin...');
  const apiTsPath = path.join(DESKTOP_DIR, 'frontend', 'src', 'lib', 'api.ts');
  patchFile(apiTsPath,
    "const API_BASE = 'http://127.0.0.1:8000'",
    "const API_BASE = typeof window !== 'undefined' ? window.location.origin : ''"
  );

  // --- Backend ---
  console.log('  Copying backend...');
  rmrf(path.join(DESKTOP_DIR, 'backend'));
  fs.mkdirSync(path.join(DESKTOP_DIR, 'backend'), { recursive: true });

  // Copy all .py files and requirements.txt, .env
  const backendSrc = path.join(PROJECT_DIR, 'backend');
  const backendDest = path.join(DESKTOP_DIR, 'backend');
  const entries = fs.readdirSync(backendSrc);
  for (const entry of entries) {
    const srcPath = path.join(backendSrc, entry);
    const stat = fs.statSync(srcPath);
    if (stat.isFile() && (entry.endsWith('.py') || entry === 'requirements.txt' || entry === '.env')) {
      fs.copyFileSync(srcPath, path.join(backendDest, entry));
    }
  }

  // Symlink venv on unix for dev mode
  const venvSrc = path.join(PROJECT_DIR, 'backend', 'venv');
  const venvDest = path.join(DESKTOP_DIR, 'backend', 'venv');
  if (!IS_WIN && fs.existsSync(venvSrc) && !fs.existsSync(venvDest)) {
    console.log('  Symlinking venv...');
    fs.symlinkSync(venvSrc, venvDest);
  }

  // Patch templates.py — env-overridable SAMPLES_DIR
  console.log('  Patching templates.py...');
  const templatesPy = path.join(backendDest, 'templates.py');
  let templatesContent = fs.readFileSync(templatesPy, 'utf8');

  // Add import os if not present
  if (!templatesContent.match(/^import os$/m)) {
    templatesContent = 'import os\n' + templatesContent;
  }
  templatesContent = templatesContent.replace(
    'SAMPLES_DIR = Path(__file__).resolve().parent.parent / "manim_code_samples"',
    'SAMPLES_DIR = Path(os.environ.get("STORYMATH_SAMPLES_DIR", str(Path(__file__).resolve().parent.parent / "manim_code_samples")))'
  );
  fs.writeFileSync(templatesPy, templatesContent, 'utf8');

  // Patch main.py — widen CORS + desktop additions
  console.log('  Patching main.py for desktop mode...');
  const mainPy = path.join(backendDest, 'main.py');
  patchFile(mainPy,
    'allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"]',
    'allow_origins=["*"]'
  );

  // Append desktop-mode CLI entrypoint
  const desktopPatch = `


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
`;
  fs.appendFileSync(mainPy, desktopPatch, 'utf8');

  // --- Manim code samples ---
  console.log('  Copying manim_code_samples...');
  rmrf(path.join(DESKTOP_DIR, 'manim_code_samples'));
  const samplesSrc = path.join(PROJECT_DIR, 'manim_code_samples');
  if (fs.existsSync(samplesSrc)) {
    copyDirSync(samplesSrc, path.join(DESKTOP_DIR, 'manim_code_samples'));
  }

  console.log('  Sources copied and patched.');
}

// =========================================================================
// Step 2: Set up embedded Python
// =========================================================================
async function step2_setupPython() {
  console.log('\n[2/5] Setting up embedded Python...');

  const pythonExe = getPythonExe(PYTHON_DIR);

  // Skip if already working
  if (fs.existsSync(pythonExe)) {
    try {
      execFileSync(pythonExe, ['-c', 'import manim; import fastapi; import anthropic'], {
        stdio: 'pipe',
        timeout: 30000,
      });
      console.log('  Embedded Python already set up — skipping.');
      return;
    } catch {
      console.log('  Python exists but imports failed — reinstalling...');
    }
  }

  const PYTHON_VERSION = '3.13.12';
  const RELEASE_TAG = '20260203';
  const triple = getTriple();
  const tarball = `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-${triple}-install_only.tar.gz`;
  const downloadUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_TAG}/${tarball}`;

  console.log(`  Platform: ${PLATFORM}/${ARCH} (${triple})`);
  console.log(`  Python: ${PYTHON_VERSION} (release ${RELEASE_TAG})`);

  // Download
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storymath-python-'));
  const tarballPath = path.join(tmpDir, tarball);

  try {
    console.log(`  Downloading ${tarball}...`);
    await download(downloadUrl, tarballPath);

    // Extract — tarball contains a top-level "python/" directory
    console.log('  Extracting...');
    rmrf(PYTHON_DIR);

    if (IS_WIN) {
      // On Windows, use tar (available on Win10+) or PowerShell
      run(`tar -xzf "${tarballPath}" -C "${DESKTOP_DIR}"`, { silent: true });
    } else {
      run(`tar -xzf "${tarballPath}" -C "${DESKTOP_DIR}"`, { silent: true });
    }

    // Verify extraction
    if (!fs.existsSync(pythonExe)) {
      // Some builds use python3.13 symlink
      if (!IS_WIN) {
        const python313 = path.join(PYTHON_DIR, 'bin', 'python3.13');
        if (fs.existsSync(python313)) {
          fs.symlinkSync('python3.13', path.join(PYTHON_DIR, 'bin', 'python3'));
          fs.symlinkSync('python3.13', path.join(PYTHON_DIR, 'bin', 'python'));
        } else {
          throw new Error(`Python executable not found at ${pythonExe}`);
        }
      } else {
        throw new Error(`Python executable not found at ${pythonExe}`);
      }
    }

    // Ensure python -> python3 symlink on unix
    if (!IS_WIN) {
      const pythonLink = path.join(PYTHON_DIR, 'bin', 'python');
      if (!fs.existsSync(pythonLink)) {
        fs.symlinkSync('python3', pythonLink);
      }
    }
  } finally {
    rmrf(tmpDir);
  }

  // Print version
  const version = execFileSync(pythonExe, ['--version'], { encoding: 'utf8' }).trim();
  console.log(`  Python version: ${version}`);

  // Upgrade pip
  console.log('  Upgrading pip...');
  execFileSync(pythonExe, ['-m', 'pip', 'install', '--upgrade', 'pip', '--quiet'], {
    stdio: 'inherit',
    env: buildPipEnv(),
    timeout: 120000,
  });

  // Install backend dependencies
  console.log('  Installing backend dependencies...');
  const requirements = path.join(DESKTOP_DIR, 'backend', 'requirements.txt');

  const pipArgs = ['-m', 'pip', 'install', '--quiet'];
  if (fs.existsSync(requirements)) {
    pipArgs.push('-r', requirements);
  } else {
    pipArgs.push(
      'fastapi>=0.104.0',
      'uvicorn[standard]>=0.24.0',
      'manim>=0.18.0',
      'anthropic>=0.39.0',
      'python-dotenv>=1.0.0'
    );
  }

  execFileSync(pythonExe, pipArgs, {
    stdio: 'inherit',
    env: buildPipEnv(),
    timeout: 600000,
  });

  // Verify key imports
  console.log('  Verifying imports...');
  execFileSync(pythonExe, ['-c',
    'import manim; import fastapi; import anthropic; import uvicorn; import dotenv; print("  All imports OK")'
  ], { stdio: 'inherit', timeout: 30000 });

  console.log(`  Embedded Python ready at: ${PYTHON_DIR}`);
}

/** Build env vars for pip install — ensure native build tools are findable. */
function buildPipEnv() {
  const env = { ...process.env };
  if (IS_MAC) {
    env.PATH = ['/usr/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', env.PATH].join(':');
    env.PKG_CONFIG_PATH = [
      '/opt/homebrew/lib/pkgconfig',
      '/opt/homebrew/share/pkgconfig',
      '/usr/local/lib/pkgconfig',
      env.PKG_CONFIG_PATH || '',
    ].join(':');
  }
  return env;
}

// =========================================================================
// Step 3: Bundle native dependencies
// =========================================================================
async function step3_bundleDeps() {
  console.log('\n[3/5] Bundling native dependencies...');

  const dylibDir = path.join(PYTHON_DIR, 'lib', 'dylibs');
  const ffmpegExe = getFfmpegExe(PYTHON_DIR);

  // Skip if already done
  if (fs.existsSync(dylibDir) && fs.existsSync(ffmpegExe)) {
    console.log('  Native dependencies already bundled — skipping.');
    return;
  }

  // --- Part 1: Bundle native dylibs (macOS only) ---
  if (IS_MAC) {
    await bundleMacDylibs(dylibDir);
  } else if (IS_WIN) {
    console.log('  Windows: pre-built wheels include DLLs — skipping dylib bundling.');
  } else {
    console.log('  Linux: manylinux wheels include .so files — skipping dylib bundling.');
  }

  // --- Part 2: Bundle ffmpeg ---
  if (!fs.existsSync(ffmpegExe)) {
    await bundleFfmpeg(ffmpegExe);
  } else {
    console.log('  ffmpeg already bundled — skipping.');
  }

  console.log('  Native dependencies bundled.');
}

async function bundleMacDylibs(dylibDir) {
  console.log('  Bundling macOS native libraries...');
  fs.mkdirSync(dylibDir, { recursive: true });

  const HOMEBREW_LIBS = [
    '/opt/homebrew/opt/cairo/lib/libcairo.2.dylib',
    '/opt/homebrew/opt/libpng/lib/libpng16.16.dylib',
    '/opt/homebrew/opt/fontconfig/lib/libfontconfig.1.dylib',
    '/opt/homebrew/opt/freetype/lib/libfreetype.6.dylib',
    '/opt/homebrew/opt/libx11/lib/libX11.6.dylib',
    '/opt/homebrew/opt/libxext/lib/libXext.6.dylib',
    '/opt/homebrew/opt/libxrender/lib/libXrender.1.dylib',
    '/opt/homebrew/opt/libxcb/lib/libxcb.1.dylib',
    '/opt/homebrew/opt/libxcb/lib/libxcb-render.0.dylib',
    '/opt/homebrew/opt/libxcb/lib/libxcb-shm.0.dylib',
    '/opt/homebrew/opt/pixman/lib/libpixman-1.0.dylib',
    '/opt/homebrew/opt/gettext/lib/libintl.8.dylib',
    '/opt/homebrew/opt/libxau/lib/libXau.6.dylib',
    '/opt/homebrew/opt/libxdmcp/lib/libXdmcp.6.dylib',
  ];

  // Check all source libs exist
  const missing = HOMEBREW_LIBS.filter(lib => !fs.existsSync(lib));
  if (missing.length > 0) {
    console.error('  ERROR: Missing Homebrew libraries:');
    missing.forEach(lib => console.error(`    ${lib}`));
    console.error('  Install with:');
    console.error('    brew install cairo libpng fontconfig freetype libx11 libxext libxrender libxcb pixman gettext libxau libxdmcp');
    process.exit(1);
  }

  // Copy dylibs
  for (const lib of HOMEBREW_LIBS) {
    const basename = path.basename(lib);
    const dest = path.join(dylibDir, basename);
    fs.copyFileSync(lib, dest);
    fs.chmodSync(dest, 0o644);
    console.log(`    Copied ${basename}`);
  }

  // Rewrite inter-library references to use @loader_path
  console.log('  Rewriting dylib load paths...');
  for (const libPath of fs.readdirSync(dylibDir).filter(f => f.endsWith('.dylib'))) {
    const fullPath = path.join(dylibDir, libPath);

    // Update own install name
    try { execSync(`install_name_tool -id "@loader_path/${libPath}" "${fullPath}"`, { stdio: 'pipe' }); } catch {}

    // Get deps
    const otoolOut = execSync(`otool -L "${fullPath}"`, { encoding: 'utf8' });
    const homebrewDeps = otoolOut.split('\n')
      .map(line => line.trim().split(' ')[0])
      .filter(dep => dep.startsWith('/opt/homebrew'));

    for (const dep of homebrewDeps) {
      const depBasename = path.basename(dep);
      try {
        execSync(`install_name_tool -change "${dep}" "@loader_path/${depBasename}" "${fullPath}"`, { stdio: 'pipe' });
      } catch {}
    }

    // Re-sign
    try { execSync(`codesign --force --sign - "${fullPath}"`, { stdio: 'pipe' }); } catch {}
  }

  // Patch pycairo's _cairo.so
  console.log('  Patching pycairo to use bundled libcairo...');
  const sitePackages = getSitePackages(PYTHON_DIR);
  const cairoSoGlob = path.join(sitePackages, 'cairo', '_cairo.cpython-313-darwin.so');
  if (fs.existsSync(cairoSoGlob)) {
    const rpathPrefix = '@loader_path/../../../dylibs';
    try {
      execSync(`install_name_tool -change "/opt/homebrew/opt/cairo/lib/libcairo.2.dylib" "${rpathPrefix}/libcairo.2.dylib" "${cairoSoGlob}"`, { stdio: 'pipe' });
      execSync(`codesign --force --sign - "${cairoSoGlob}"`, { stdio: 'pipe' });
      console.log(`    Patched _cairo.so -> ${rpathPrefix}/libcairo.2.dylib`);
    } catch (e) {
      console.warn(`    WARNING: Failed to patch pycairo: ${e.message}`);
    }
  } else {
    console.warn('  WARNING: pycairo .so not found at expected path');
  }
}

async function bundleFfmpeg(ffmpegExe) {
  console.log('  Bundling ffmpeg...');

  let ffmpegUrl;
  let archiveExt;

  if (IS_MAC) {
    ffmpegUrl = ARCH === 'arm64'
      ? 'https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip'
      : 'https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip';
    archiveExt = 'zip';
  } else if (IS_WIN) {
    ffmpegUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
    archiveExt = 'zip';
  } else {
    // Linux
    if (ARCH === 'arm64') {
      ffmpegUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz';
    } else {
      ffmpegUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz';
    }
    archiveExt = 'tar.xz';
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storymath-ffmpeg-'));
  const archivePath = path.join(tmpDir, `ffmpeg.${archiveExt}`);

  try {
    console.log(`    Downloading ffmpeg for ${PLATFORM}/${ARCH}...`);
    await download(ffmpegUrl, archivePath);

    console.log('    Extracting...');
    const destDir = path.dirname(ffmpegExe);
    fs.mkdirSync(destDir, { recursive: true });

    if (IS_MAC) {
      // macOS zip: contains just the ffmpeg binary
      run(`unzip -q "${archivePath}" -d "${tmpDir}"`, { silent: true });
      fs.copyFileSync(path.join(tmpDir, 'ffmpeg'), ffmpegExe);
      fs.chmodSync(ffmpegExe, 0o755);
      // Remove quarantine
      try { execSync(`xattr -dr com.apple.quarantine "${ffmpegExe}"`, { stdio: 'pipe' }); } catch {}
    } else if (IS_WIN) {
      // Windows zip: contains ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe
      run(`tar -xf "${archivePath}" -C "${tmpDir}"`, { silent: true });
      // Find ffmpeg.exe in extracted contents
      const ffmpegBin = findFileRecursive(tmpDir, 'ffmpeg.exe');
      if (ffmpegBin) {
        fs.copyFileSync(ffmpegBin, ffmpegExe);
      } else {
        throw new Error('ffmpeg.exe not found in downloaded archive');
      }
    } else {
      // Linux tar.xz: contains ffmpeg-master-latest-linux64-gpl/bin/ffmpeg
      run(`tar -xf "${archivePath}" -C "${tmpDir}"`, { silent: true });
      const ffmpegBin = findFileRecursive(tmpDir, 'ffmpeg');
      if (ffmpegBin && ffmpegBin !== ffmpegExe) {
        fs.copyFileSync(ffmpegBin, ffmpegExe);
        fs.chmodSync(ffmpegExe, 0o755);
      } else {
        throw new Error('ffmpeg not found in downloaded archive');
      }
    }

    // Verify
    const versionOut = execFileSync(ffmpegExe, ['-version'], { encoding: 'utf8', timeout: 10000 });
    console.log(`    ${versionOut.split('\n')[0]}`);
  } finally {
    rmrf(tmpDir);
  }
}

/** Find a file by name recursively in a directory (first match). */
function findFileRecursive(dir, filename) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) return full;
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, filename);
      if (found) return found;
    }
  }
  return null;
}

// =========================================================================
// Step 4: Build frontend
// =========================================================================
function step4_buildFrontend() {
  console.log('\n[4/5] Building frontend (static export)...');

  const frontendDir = path.join(DESKTOP_DIR, 'frontend');

  console.log('  Installing npm dependencies...');
  run('npm install', { cwd: frontendDir });

  console.log('  Running next build (output: export)...');
  run('npx next build', { cwd: frontendDir });

  const outDir = path.join(frontendDir, 'out');
  if (fs.existsSync(outDir)) {
    console.log('  Frontend built successfully -> frontend/out/');
  } else {
    console.error('  ERROR: next build did not produce an "out" directory');
    process.exit(1);
  }
}

// =========================================================================
// Step 5: Install Electron
// =========================================================================
function step5_installElectron() {
  console.log('\n[5/5] Installing Electron...');
  run('npm install', { cwd: DESKTOP_DIR });
}

// =========================================================================
// Main
// =========================================================================
async function main() {
  console.log('============================================');
  console.log('  StoryMath Desktop — Setup');
  console.log(`  Platform: ${PLATFORM}/${ARCH}`);
  console.log('============================================');

  step1_copySources();
  await step2_setupPython();
  await step3_bundleDeps();
  step4_buildFrontend();
  step5_installElectron();

  console.log('\n============================================');
  console.log('  Setup complete!');
  console.log('');
  console.log('  Run:  cd desktop && npm start');
  console.log('============================================');
}

main().catch((err) => {
  console.error('\nSetup failed:', err.message);
  process.exit(1);
});
