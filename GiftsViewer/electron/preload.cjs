// electron/preload.cjs
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("giftsviewer", {
  giftsRead: () => ipcRenderer.invoke("gifts:read"),
  giftsUpdate: (username) => ipcRenderer.invoke("gifts:update", username),
  giftsOpenFolder: () => ipcRenderer.invoke("gifts:openFolder"),
  giftsOpenHtml: () => ipcRenderer.invoke("gifts:openHtml"),
  giftsFetchImageBase64: (url) => ipcRenderer.invoke("gifts:fetchImageBase64", url),
  giftsCopyPngDataUrl: (dataUrl) => ipcRenderer.invoke("gifts:copyPngDataUrl", dataUrl),

  settingsRead: () => ipcRenderer.invoke("settings:read"),
  settingsWrite: (v) => ipcRenderer.invoke("settings:write", v),
});