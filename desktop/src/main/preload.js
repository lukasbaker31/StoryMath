/**
 * Preload script — exposes a minimal IPC bridge to the renderer.
 *
 * The renderer can call window.storymath.getApiKey() and
 * window.storymath.setApiKey(key) to interact with the encrypted
 * key store in the main process.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('storymath', {
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  setApiKey: (key) => ipcRenderer.invoke('set-api-key', key),
});
