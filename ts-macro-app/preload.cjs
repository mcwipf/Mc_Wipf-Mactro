const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getInitialData: () => ipcRenderer.invoke("app:getInitialData"),
  saveMacros: (macros) => ipcRenderer.invoke("app:saveMacros", macros),
  saveSettings: (settings) => ipcRenderer.invoke("app:saveSettings", settings),
  startMacro: (macro, settings) => ipcRenderer.invoke("app:startMacro", macro, settings),
  stopMacro: () => ipcRenderer.invoke("app:stopMacro"),
  writeClipboard: (text) => ipcRenderer.invoke("app:writeClipboard", text),
  readClipboard: () => ipcRenderer.invoke("app:readClipboard"),
  getCursorPoint: () => ipcRenderer.invoke("app:getCursorPoint"),
  pickClickPoint: () => ipcRenderer.invoke("app:pickClickPoint"),
  pickClickPointGame: () => ipcRenderer.invoke("app:pickClickPointGame"),
  captureImageRegion: (imageNameHint, previousImagePath) => ipcRenderer.invoke("app:captureImageRegion", imageNameHint, previousImagePath),
  validateHotkey: (key) => ipcRenderer.invoke("app:validateHotkey", key),
  startHotkeyCapture: () => ipcRenderer.invoke("app:startHotkeyCapture"),
  endHotkeyCapture: () => ipcRenderer.invoke("app:endHotkeyCapture"),
  onCapturedKey: (handler) => {
    const listener = (_event, key) => handler(key);
    ipcRenderer.on("app:capturedKey", listener);
    return () => ipcRenderer.removeListener("app:capturedKey", listener);
  },
  onRunnerState: (handler) => {
    ipcRenderer.on("runner:state", (_event, payload) => {
      handler(payload);
    });
  },
  onRunnerError: (handler) => {
    ipcRenderer.on("runner:error", (_event, payload) => {
      handler(payload);
    });
  },
  onHotkeyStatus: (handler) => {
    ipcRenderer.on("hotkey:status", (_event, payload) => {
      handler(payload);
    });
  }
};

contextBridge.exposeInMainWorld("macroApi", api);
