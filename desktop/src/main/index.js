/**
 * StoryMath Electron Main Process
 *
 * 1. Find a free port
 * 2. Read/prompt for API key (encrypted via safeStorage)
 * 3. Spawn the FastAPI backend (serves API + static Next.js export)
 * 4. Poll /api/status until the backend is ready
 * 5. Open a BrowserWindow pointing at the backend
 */
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const http = require('http');
const keyStore = require('./key-store');

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const PATH_SEP = IS_WIN ? ';' : ':';

// ---------------------------------------------------------------------------
// Paths — electron-builder puts extraResources at process.resourcesPath
// ---------------------------------------------------------------------------
const IS_PACKAGED = app.isPackaged;
const DESKTOP_DIR = IS_PACKAGED
  ? process.resourcesPath
  : path.resolve(__dirname, '..', '..');
const BACKEND_DIR = path.join(DESKTOP_DIR, 'backend');
const STATIC_DIR = path.join(DESKTOP_DIR, 'frontend', 'out');
const SAMPLES_DIR = path.join(DESKTOP_DIR, 'manim_code_samples');

/** Platform-aware Python executable path. */
function embeddedPythonExe() {
  return IS_WIN
    ? path.join(DESKTOP_DIR, 'python', 'python.exe')
    : path.join(DESKTOP_DIR, 'python', 'bin', 'python');
}

/** Return candidate Python paths to search (evaluated lazily so app.getPath works). */
function getVenvCandidates() {
  const venvPython = IS_WIN ? 'Scripts\\python.exe' : 'bin/python';
  return [
    embeddedPythonExe(),                                                           // embedded standalone
    path.join(BACKEND_DIR, 'venv', venvPython),                                    // bundled venv
    path.join(DESKTOP_DIR, '..', 'backend', 'venv', venvPython),                   // original project (dev mode)
    path.join(app.getPath('home'), 'Documents', 'StoryMath', 'backend', 'venv', venvPython),
  ];
}

let backendProcess = null;
let mainWindow = null;
let backendPort = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find a free TCP port by binding to port 0. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Prompt the user for their API key via a simple dialog. */
async function promptForApiKey() {
  const result = await dialog.showMessageBox({
    type: 'question',
    title: 'StoryMath — API Key Required',
    message: 'Enter your Anthropic API key to enable AI code generation.\n\nYou can change this later from the StoryMath menu.',
    buttons: ['OK'],
    defaultId: 0,
  });

  // Use a second input dialog — Electron doesn't have a native text input
  // dialog, so we create a tiny BrowserWindow for this.
  return new Promise((resolve) => {
    const inputWin = new BrowserWindow({
      width: 500,
      height: 200,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'Enter API Key',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    inputWin.setMenu(null);

    const html = `<!DOCTYPE html>
<html><head><style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 20px; background: #1a1a2e; color: #e0e0e0; }
  input { width: 100%; padding: 8px; margin: 10px 0; font-size: 14px; border: 1px solid #444; border-radius: 4px; background: #16213e; color: #e0e0e0; box-sizing: border-box; }
  button { padding: 8px 24px; font-size: 14px; cursor: pointer; border: none; border-radius: 4px; background: #0f3460; color: #e0e0e0; }
  button:hover { background: #1a5276; }
  .note { font-size: 12px; color: #888; margin-top: 4px; }
</style></head><body>
  <label>Anthropic API Key:</label>
  <input id="key" type="password" placeholder="sk-ant-..." autofocus />
  <div class="note">Stored securely in your system keychain.</div>
  <br/>
  <button onclick="submit()">Save</button>
  <button onclick="window.close()" style="margin-left:8px;background:#333;">Cancel</button>
  <script>
    function submit() {
      const key = document.getElementById('key').value.trim();
      if (key) {
        document.title = 'KEY:' + key;
        window.close();
      }
    }
    document.getElementById('key').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  </script>
</body></html>`;

    inputWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    let apiKey = null;

    inputWin.on('page-title-updated', (e, title) => {
      if (title.startsWith('KEY:')) {
        apiKey = title.slice(4);
      }
    });

    inputWin.on('closed', () => {
      resolve(apiKey || null);
    });
  });
}

/** Poll the backend until /api/status responds 200 (or timeout). */
function waitForBackend(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('Backend did not start within 30s'));
      }

      const req = http.get(`http://127.0.0.1:${port}/api/status`, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
        } else {
          res.resume();
          setTimeout(poll, 300);
        }
      });

      req.on('error', () => setTimeout(poll, 300));
      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(poll, 300);
      });
    };

    poll();
  });
}

/** Spawn the FastAPI backend process. */
function startBackend(port, apiKey) {
  // Determine the Python executable — check all candidate paths, fall back to system
  const fs = require('fs');
  const candidates = getVenvCandidates();
  const fallbackPython = IS_WIN ? 'python' : 'python3';
  const pythonExe = candidates.find(p => fs.existsSync(p)) || fallbackPython;
  console.log(`[storymath] Using Python: ${pythonExe}`);

  const env = { ...process.env };

  // API key
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;

  // Tell templates.py where manim_code_samples lives
  env.STORYMATH_SAMPLES_DIR = SAMPLES_DIR;

  // Add embedded Python bin dir (for ffmpeg, python) to PATH
  const embeddedBin = IS_WIN
    ? path.join(DESKTOP_DIR, 'python')            // python.exe + ffmpeg.exe at top level
    : path.join(DESKTOP_DIR, 'python', 'bin');     // bin/python + bin/ffmpeg
  const extraPaths = [embeddedBin];
  if (IS_MAC) {
    extraPaths.push('/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/Library/TeX/texbin');
  }
  env.PATH = extraPaths.join(PATH_SEP) + PATH_SEP + (env.PATH || '');

  // Library search path (macOS: DYLD_LIBRARY_PATH, Linux: LD_LIBRARY_PATH, Windows: DLLs on PATH)
  if (IS_MAC) {
    const dylibDir = path.join(DESKTOP_DIR, 'python', 'lib', 'dylibs');
    env.DYLD_LIBRARY_PATH = dylibDir + ':' + (env.DYLD_LIBRARY_PATH || '');
  } else if (process.platform === 'linux') {
    const soDir = path.join(DESKTOP_DIR, 'python', 'lib', 'dylibs');
    env.LD_LIBRARY_PATH = soDir + ':' + (env.LD_LIBRARY_PATH || '');
  }

  backendProcess = spawn(pythonExe, [
    path.join(BACKEND_DIR, 'main.py'),
    '--port', String(port),
    '--static-dir', STATIC_DIR,
  ], {
    cwd: BACKEND_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout.on('data', (data) => {
    process.stdout.write(`[backend] ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    process.stderr.write(`[backend] ${data}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`);
    backendProcess = null;
  });
}

/** Kill the backend process. */
function stopBackend() {
  if (backendProcess) {
    if (IS_WIN) {
      // Windows: SIGTERM doesn't work reliably — use taskkill
      try { process.kill(backendProcess.pid); } catch {}
    } else {
      backendProcess.kill('SIGTERM');
      // Force kill after 3 seconds if still alive
      setTimeout(() => {
        if (backendProcess) {
          backendProcess.kill('SIGKILL');
        }
      }, 3000);
    }
  }
}

/** Update the API key at runtime (re-set env on running backend). */
async function updateApiKey(newKey) {
  keyStore.save(newKey);

  // POST to the running backend to update in-process
  if (backendPort) {
    const postData = JSON.stringify({ key: newKey });
    return new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: backendPort,
        path: '/api/config/key',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => resolve());
      req.write(postData);
      req.end();
    });
  }
}

// ---------------------------------------------------------------------------
// IPC handlers (for preload bridge)
// ---------------------------------------------------------------------------
ipcMain.handle('get-api-key', () => keyStore.load());
ipcMain.handle('set-api-key', async (_event, key) => {
  await updateApiKey(key);
  return true;
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  // 1. Find free port
  backendPort = await findFreePort();
  console.log(`[storymath] Using port ${backendPort}`);

  // 2. Get API key
  let apiKey = keyStore.load();
  if (!apiKey) {
    apiKey = await promptForApiKey();
    if (apiKey) {
      keyStore.save(apiKey);
    }
  }

  // 3. Spawn backend
  startBackend(backendPort, apiKey);

  // 4. Wait for backend
  try {
    await waitForBackend(backendPort);
    console.log('[storymath] Backend is ready');
  } catch (err) {
    dialog.showErrorBox('StoryMath', `Backend failed to start: ${err.message}`);
    app.quit();
    return;
  }

  // 5. Create window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'StoryMath',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${backendPort}/`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 6. App menu
  const menuTemplate = [
    {
      label: 'StoryMath',
      submenu: [
        {
          label: 'Change API Key...',
          click: async () => {
            const newKey = await promptForApiKey();
            if (newKey) {
              await updateApiKey(newKey);
              dialog.showMessageBox({ message: 'API key updated.' });
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
});

app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});

app.on('before-quit', () => {
  stopBackend();
});
