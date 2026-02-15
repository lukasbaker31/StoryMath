/**
 * Encrypted API key storage using Electron safeStorage.
 *
 * Keys are encrypted via the OS credential store (macOS Keychain,
 * Windows Credential Manager, Linux libsecret) and persisted as
 * an opaque binary file in the app's userData directory.
 */
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const KEY_FILE = () => path.join(app.getPath('userData'), 'anthropic-key.enc');

function save(apiKey) {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: store in plaintext (still in user-private appData)
    fs.writeFileSync(KEY_FILE(), apiKey, 'utf-8');
    return;
  }
  const encrypted = safeStorage.encryptString(apiKey);
  fs.writeFileSync(KEY_FILE(), encrypted);
}

function load() {
  const keyPath = KEY_FILE();
  if (!fs.existsSync(keyPath)) return null;

  const raw = fs.readFileSync(keyPath);

  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: stored as plaintext
    return raw.toString('utf-8');
  }

  try {
    return safeStorage.decryptString(raw);
  } catch {
    // File corrupted or stored with different encryption — remove it
    fs.unlinkSync(keyPath);
    return null;
  }
}

function clear() {
  const keyPath = KEY_FILE();
  if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
}

module.exports = { save, load, clear };
