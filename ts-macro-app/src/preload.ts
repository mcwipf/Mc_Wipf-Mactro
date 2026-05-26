import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, InitialPayload, Macro } from "./types.js";

const api = {
  getInitialData: (): Promise<InitialPayload> => ipcRenderer.invoke("app:getInitialData"),
  saveMacros: (macros: Macro[]): Promise<void> => ipcRenderer.invoke("app:saveMacros", macros),
  saveSettings: (settings: AppSettings): Promise<void> => ipcRenderer.invoke("app:saveSettings", settings),
  startMacro: (macro: Macro): Promise<void> => ipcRenderer.invoke("app:startMacro", macro),
  stopMacro: (): Promise<void> => ipcRenderer.invoke("app:stopMacro"),
  writeClipboard: (text: string): Promise<void> => ipcRenderer.invoke("app:writeClipboard", text),
  readClipboard: (): Promise<string> => ipcRenderer.invoke("app:readClipboard"),
  startHotkeyCapture: (): Promise<void> => ipcRenderer.invoke("app:startHotkeyCapture"),
  endHotkeyCapture: (): Promise<void> => ipcRenderer.invoke("app:endHotkeyCapture"),
  onCapturedKey: (handler: (key: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, key: string) => handler(key);
    ipcRenderer.on("app:capturedKey", listener);
    return () => ipcRenderer.removeListener("app:capturedKey", listener);
  },
  onRunnerState: (handler: (state: { running: boolean; name: string }) => void): void => {
    ipcRenderer.on("runner:state", (_event, payload: { running: boolean; name: string }) => {
      handler(payload);
    });
  }
};

contextBridge.exposeInMainWorld("macroApi", api);
