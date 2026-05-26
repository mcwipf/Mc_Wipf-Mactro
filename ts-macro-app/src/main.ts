import path from "node:path";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, nativeImage, screen } from "electron";
import { uIOhook, UiohookKey } from "uiohook-napi";
import { DataStore } from "./data-store.js";
import { MacroRunner } from "./macro-runner.js";
import type { AppSettings, InitialPayload, Macro } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new DataStore();
const runner = new MacroRunner();
let win: BrowserWindow | null = null;
let cachedMacros: Macro[] = [];
let cachedSettings: AppSettings | null = null;
let hotkeyCaptureActive = false;

// Keys (normalized stored key names) that failed globalShortcut.register and are handled by uiohook instead
let uiohookOnlyKeys = new Set<string>();

// Map from stored key name (lowercase) to uiohook keycode
const STORED_KEY_UIOHOOK: Record<string, number> = {
  // F keys
  f1: UiohookKey.F1, f2: UiohookKey.F2, f3: UiohookKey.F3, f4: UiohookKey.F4,
  f5: UiohookKey.F5, f6: UiohookKey.F6, f7: UiohookKey.F7, f8: UiohookKey.F8,
  f9: UiohookKey.F9, f10: UiohookKey.F10, f11: UiohookKey.F11, f12: UiohookKey.F12,
  f13: UiohookKey.F13, f14: UiohookKey.F14, f15: UiohookKey.F15, f16: UiohookKey.F16,
  f17: UiohookKey.F17, f18: UiohookKey.F18, f19: UiohookKey.F19, f20: UiohookKey.F20,
  f21: UiohookKey.F21, f22: UiohookKey.F22, f23: UiohookKey.F23, f24: UiohookKey.F24,
  // Letters
  a: UiohookKey.A, b: UiohookKey.B, c: UiohookKey.C, d: UiohookKey.D,
  e: UiohookKey.E, f: UiohookKey.F, g: UiohookKey.G, h: UiohookKey.H,
  i: UiohookKey.I, j: UiohookKey.J, k: UiohookKey.K, l: UiohookKey.L,
  m: UiohookKey.M, n: UiohookKey.N, o: UiohookKey.O, p: UiohookKey.P,
  q: UiohookKey.Q, r: UiohookKey.R, s: UiohookKey.S, t: UiohookKey.T,
  u: UiohookKey.U, v: UiohookKey.V, w: UiohookKey.W, x: UiohookKey.X,
  y: UiohookKey.Y, z: UiohookKey.Z,
  // Number row (not numpad) — keycode values from UiohookKey numeric properties
  "0": 11, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10,
  // Special keys
  esc: UiohookKey.Escape, escape: UiohookKey.Escape,
  enter: UiohookKey.Enter, return: UiohookKey.Enter,
  tab: UiohookKey.Tab,
  space: UiohookKey.Space,
  backspace: UiohookKey.Backspace,
  delete: UiohookKey.Delete,
  insert: UiohookKey.Insert,
  home: UiohookKey.Home,
  end: UiohookKey.End,
  pageup: UiohookKey.PageUp,
  pagedown: UiohookKey.PageDown,
  up: UiohookKey.ArrowUp,
  down: UiohookKey.ArrowDown,
  left: UiohookKey.ArrowLeft,
  right: UiohookKey.ArrowRight,
};

function getRunnerOptions(settings: Partial<AppSettings> | null | undefined): {
  gameClickEnabled: boolean;
  normalClickEnabled: boolean;
  clickHoldMs: number;
  postMoveDelayMs: number;
  imagesDirPath: string;
} {
  return {
    gameClickEnabled: settings?.game_click_enabled ?? true,
    normalClickEnabled: settings?.normal_click_enabled ?? true,
    clickHoldMs: Math.max(0, settings?.default_click_delay ?? 25),
    postMoveDelayMs: Math.max(0, settings?.default_regular_delay ?? 50),
    imagesDirPath: store.imagesDirPath
  };
}

function getVirtualScreenBounds(): { x: number; y: number; width: number; height: number } {
  const displays = screen.getAllDisplays();
  const left = Math.min(...displays.map((d) => d.bounds.x));
  const top = Math.min(...displays.map((d) => d.bounds.y));
  const right = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
  const bottom = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type CaptureRegion = { x: number; y: number; width: number; height: number };

function normalizeRegion(region: CaptureRegion): CaptureRegion {
  return {
    x: Math.floor(region.x),
    y: Math.floor(region.y),
    width: Math.max(1, Math.floor(region.width)),
    height: Math.max(1, Math.floor(region.height))
  };
}

async function pickRegionFromOverlay(): Promise<CaptureRegion | null> {
  if (!win || win.isDestroyed()) {
    return null;
  }

  const mainWindow = win;
  const displays = screen.getAllDisplays();
  const captureWindows: BrowserWindow[] = [];

  const restoreMainWindow = () => {
    if (mainWindow.isDestroyed()) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
  };

  const selection = new Promise<CaptureRegion | null>((resolve) => {
    let done = false;

    const finish = (value: CaptureRegion | null) => {
      if (done) {
        return;
      }
      done = true;
      ipcMain.removeListener("app:regionSelected", onSelected);
      ipcMain.removeListener("app:regionCanceled", onCanceled);
      resolve(value);
    };

    const onSelected = (_event: unknown, region: CaptureRegion) => {
      finish(normalizeRegion(region));
    };

    const onCanceled = () => {
      finish(null);
    };

    ipcMain.once("app:regionSelected", onSelected);
    ipcMain.once("app:regionCanceled", onCanceled);

    for (const captureWindow of captureWindows) {
      captureWindow.on("closed", () => {
        finish(null);
      });
    }
  });

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Capture Region</title>
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        cursor: crosshair;
        overflow: hidden;
        background: rgba(20, 20, 20, 0.24);
      }
      #box {
        position: fixed;
        border: 2px solid #f2f2f2;
        background: rgba(255, 255, 255, 0.14);
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 0 0 9999px rgba(0, 0, 0, 0.18);
        pointer-events: none;
        display: none;
      }
      #hint {
        position: fixed;
        top: 14px;
        left: 14px;
        color: #fff;
        font-family: Segoe UI, sans-serif;
        font-size: 12px;
        background: rgba(0, 0, 0, 0.55);
        border: 1px solid rgba(255, 255, 255, 0.25);
        padding: 8px 10px;
        border-radius: 4px;
      }
    </style>
  </head>
  <body>
    <div id="hint">Drag to capture image region. This overlay is see-through. Press Esc to cancel.</div>
    <div id="box"></div>
    <script>
      const { ipcRenderer } = require("electron");
      const box = document.getElementById("box");
      let dragStart = null;

      const updateBox = (x1, y1, x2, y2) => {
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const width = Math.max(1, Math.abs(x2 - x1));
        const height = Math.max(1, Math.abs(y2 - y1));
        box.style.display = "block";
        box.style.left = left + "px";
        box.style.top = top + "px";
        box.style.width = width + "px";
        box.style.height = height + "px";
      };

      document.addEventListener("mousedown", (event) => {
        dragStart = {
          screenX: event.screenX,
          screenY: event.screenY,
          clientX: event.clientX,
          clientY: event.clientY
        };
        updateBox(event.clientX, event.clientY, event.clientX, event.clientY);
      }, { capture: true });

      document.addEventListener("mousemove", (event) => {
        if (!dragStart) {
          return;
        }
        updateBox(dragStart.clientX, dragStart.clientY, event.clientX, event.clientY);
      }, { capture: true });

      document.addEventListener("mouseup", (event) => {
        if (!dragStart) {
          return;
        }

        const x = Math.min(dragStart.screenX, event.screenX);
        const y = Math.min(dragStart.screenY, event.screenY);
        const width = Math.max(1, Math.abs(event.screenX - dragStart.screenX));
        const height = Math.max(1, Math.abs(event.screenY - dragStart.screenY));

        ipcRenderer.send("app:regionSelected", { x, y, width, height });
      }, { capture: true });

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          ipcRenderer.send("app:regionCanceled");
        }
      });
    </script>
  </body>
</html>`;

  mainWindow.minimize();

  for (const display of displays) {
    const captureWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      focusable: true,
      show: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false
      }
    });

    captureWindows.push(captureWindow);
    await captureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    captureWindow.setAlwaysOnTop(true, "screen-saver");
    captureWindow.show();
  }

  if (captureWindows.length > 0) {
    captureWindows[captureWindows.length - 1].focus();
  }

  const result = await selection;

  for (const captureWindow of captureWindows) {
    if (!captureWindow.isDestroyed()) {
      captureWindow.close();
    }
  }

  restoreMainWindow();
  return result;
}

async function captureDisplayRegion(region: CaptureRegion): Promise<Buffer> {
  const normalized = normalizeRegion(region);
  const display = screen.getDisplayMatching({
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height
  });
  const displays = screen.getAllDisplays();
  const displayIndex = displays.findIndex((candidate) => candidate.id === display.id);

  const scaleFactor = Math.max(1, display.scaleFactor || 1);
  const sourceSize = {
    width: Math.max(1, Math.floor(display.bounds.width * scaleFactor)),
    height: Math.max(1, Math.floor(display.bounds.height * scaleFactor))
  };

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: sourceSize,
    fetchWindowIcons: false
  });

  let source = sources.find((candidate) => candidate.display_id === String(display.id));
  if (!source && displayIndex >= 0 && displayIndex < sources.length) {
    source = sources[displayIndex];
  }
  if (!source) {
    const expectedWidth = sourceSize.width;
    const expectedHeight = sourceSize.height;
    source = sources.reduce((best, candidate) => {
      if (!best) {
        return candidate;
      }
      const bestSize = best.thumbnail.getSize();
      const candidateSize = candidate.thumbnail.getSize();
      const bestScore = Math.abs(bestSize.width - expectedWidth) + Math.abs(bestSize.height - expectedHeight);
      const candidateScore = Math.abs(candidateSize.width - expectedWidth) + Math.abs(candidateSize.height - expectedHeight);
      return candidateScore < bestScore ? candidate : best;
    }, sources[0]);
  }

  if (!source || source.thumbnail.isEmpty()) {
    throw new Error("Unable to capture display source for image detection.");
  }

  const thumbnail = source.thumbnail;
  const localX = Math.max(0, normalized.x - display.bounds.x);
  const localY = Math.max(0, normalized.y - display.bounds.y);
  const maxW = Math.max(1, display.bounds.width - localX);
  const maxH = Math.max(1, display.bounds.height - localY);
  const safeW = Math.min(normalized.width, maxW);
  const safeH = Math.min(normalized.height, maxH);

  const thumbSize = thumbnail.getSize();
  const scaleX = thumbSize.width / Math.max(1, display.bounds.width);
  const scaleY = thumbSize.height / Math.max(1, display.bounds.height);

  const cropX = Math.max(0, Math.floor(localX * scaleX));
  const cropY = Math.max(0, Math.floor(localY * scaleY));
  const cropW = Math.max(1, Math.floor(safeW * scaleX));
  const cropH = Math.max(1, Math.floor(safeH * scaleY));

  const cropped = thumbnail.crop({
    x: cropX,
    y: cropY,
    width: Math.min(cropW, Math.max(1, thumbSize.width - cropX)),
    height: Math.min(cropH, Math.max(1, thumbSize.height - cropY))
  });

  if (cropped.isEmpty()) {
    throw new Error("Captured image region is empty.");
  }

  return Buffer.from(cropped.toPNG());
}

async function captureStableCursorPoint(timeoutMs = 7000): Promise<{ x: number; y: number }> {
  const startedAt = Date.now();
  const armMs = 140;
  const stableMsRequired = 70;
  const pollMs = 10;
  const moveThreshold = 1;
  const moveArmDistance = 4;
  const minElapsedAfterArmMs = 220;

  const initialPoint = screen.getCursorScreenPoint();
  let point = initialPoint;
  let stableSince = Date.now();
  let isArmed = false;

  while (Date.now() - startedAt < timeoutMs) {
    await sleepMs(pollMs);
    const current = screen.getCursorScreenPoint();
    const moved = Math.abs(current.x - point.x) > moveThreshold || Math.abs(current.y - point.y) > moveThreshold;
    const movedFromInitial = Math.abs(current.x - initialPoint.x) > moveArmDistance || Math.abs(current.y - initialPoint.y) > moveArmDistance;

    if (moved) {
      point = current;
      stableSince = Date.now();
      if (Date.now() - startedAt >= armMs && movedFromInitial) {
        isArmed = true;
      }
      continue;
    }

    const elapsed = Date.now() - startedAt;
    if (isArmed && elapsed >= armMs + minElapsedAfterArmMs && Date.now() - stableSince >= stableMsRequired) {
      return current;
    }
  }

  return screen.getCursorScreenPoint();
}

async function pickRegionFromGameTwoPoint(): Promise<CaptureRegion | null> {
  if (!win || win.isDestroyed()) {
    return null;
  }

  const mainWindow = win;

  const restoreMainWindow = () => {
    if (mainWindow.isDestroyed()) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
  };

  try {
    emitHotkeyStatus("Image Screenshot: app minimized. Move cursor to TOP-LEFT and hold briefly.");
    mainWindow.minimize();
    await sleepMs(150);

    const first = await captureStableCursorPoint(9000);
    emitHotkeyStatus("Image Screenshot: now move cursor to BOTTOM-RIGHT and hold briefly.");
    await sleepMs(140);
    const second = await captureStableCursorPoint(9000);

    return normalizeRegion({
      x: Math.min(first.x, second.x),
      y: Math.min(first.y, second.y),
      width: Math.max(1, Math.abs(second.x - first.x)),
      height: Math.max(1, Math.abs(second.y - first.y))
    });
  } finally {
    restoreMainWindow();
  }
}

function makeImageFileName(prefix: string): string {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "capture";
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `${safePrefix}-${stamp}-${random}.png`;
}

function getSafeImagePathFromName(fileName: string): string | null {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return null;
  }

  const safeName = path.basename(trimmed);
  if (!safeName) {
    return null;
  }

  return path.join(store.imagesDirPath, safeName);
}

async function pickClickPointFromOverlay(timeoutMs = 0): Promise<{ x: number; y: number } | null> {
  if (!win || win.isDestroyed()) {
    return null;
  }

  const mainWindow = win;
  const bounds = getVirtualScreenBounds();
  const captureWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    focusable: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }
  });

  const restoreMainWindow = () => {
    if (mainWindow.isDestroyed()) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
  };

  const selection = new Promise<{ x: number; y: number } | null>((resolve) => {
    let done = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const finish = (value: { x: number; y: number } | null) => {
      if (done) {
        return;
      }
      done = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      ipcMain.removeListener("app:clickPointSelected", onSelected);
      ipcMain.removeListener("app:clickPointCanceled", onCanceled);
      resolve(value);
    };

    const onSelected = (_event: unknown, point: { x: number; y: number }) => {
      finish(point);
    };

    const onCanceled = () => {
      finish(null);
    };

    ipcMain.once("app:clickPointSelected", onSelected);
    ipcMain.once("app:clickPointCanceled", onCanceled);

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        finish(null);
      }, timeoutMs);
    }

    captureWindow.on("closed", () => {
      finish(null);
    });
  });

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Pick Click Point</title>
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.001);
        cursor: crosshair;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <script>
      const { ipcRenderer } = require("electron");
      document.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ipcRenderer.send("app:clickPointSelected", { x: event.screenX, y: event.screenY });
      }, { capture: true });
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          ipcRenderer.send("app:clickPointCanceled");
        }
      });
    </script>
  </body>
</html>`;

  mainWindow.minimize();
  await captureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  captureWindow.setAlwaysOnTop(true, "screen-saver");
  captureWindow.show();
  captureWindow.focus();

  captureWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      if (!captureWindow.isDestroyed()) {
        captureWindow.close();
      }
    }
  });

  const result = await selection;
  if (!captureWindow.isDestroyed()) {
    captureWindow.close();
  }
  restoreMainWindow();
  return result;
}

async function pickClickPointFromGameHotkey(): Promise<{ x: number; y: number } | null> {
  if (!win || win.isDestroyed()) {
    return null;
  }

  const mainWindow = win;

  const restoreMainWindow = () => {
    if (mainWindow.isDestroyed()) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
  };

  return new Promise<{ x: number; y: number } | null>((resolve) => {
    emitHotkeyStatus("Click Point: app minimized. Click anywhere on screen to capture that point.");
    mainWindow.minimize();

    const timeoutHandle = setTimeout(() => {
      uIOhook.removeListener("mousedown", onMouseDown);
      restoreMainWindow();
      resolve(null);
    }, 30000);

    const onMouseDown = (event: { x: number; y: number }) => {
      clearTimeout(timeoutHandle);
      uIOhook.removeListener("mousedown", onMouseDown);
      // Small delay so the click doesn't immediately interact with the restored window
      setTimeout(() => {
        restoreMainWindow();
      }, 150);
      resolve({ x: event.x, y: event.y });
    };

    uIOhook.on("mousedown", onMouseDown);
  });
}

function emitHotkeyStatus(message: string): void {
  console.log("Hotkey status:", message);
  win?.webContents.send("hotkey:status", { message });
}

app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-http-cache");

process.on("uncaughtException", (error) => {
  console.error("uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
});

function normalizeAccelerator(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (!key) {
    return null;
  }
  // F1-F24
  const fMatch = key.match(/^f(\d{1,2})$/);
  if (fMatch) {
    const num = parseInt(fMatch[1], 10);
    if (num >= 1 && num <= 24) {
      return key.toUpperCase();
    }
  }

  const map: Record<string, string> = {
    esc: "Escape",
    escape: "Escape",
    enter: "Enter",
    return: "Return",
    tab: "Tab",
    space: "Space",
    backspace: "Backspace",
    delete: "Delete",
    insert: "Insert",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    pgup: "PageUp",
    pgdn: "PageDown",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right"
  };

  if (map[key]) {
    return map[key];
  }

  if (/^[a-z0-9]$/.test(key)) {
    return key.toUpperCase();
  }

  return null;
}

function normalizeStoredKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeInputKey(raw: string): string {
  const key = raw.trim();
  // F1-F24
  if (/^F\d{1,2}$/i.test(key)) {
    return key.toLowerCase();
  }

  const map: Record<string, string> = {
    Escape: "esc",
    Enter: "enter",
    Return: "return",
    Tab: "tab",
    " ": "space",
    Backspace: "backspace",
    Delete: "delete",
    Insert: "insert",
    Home: "home",
    End: "end",
    PageUp: "pageup",
    PageDown: "pagedown",
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right"
  };

  if (map[key]) {
    return map[key];
  }

  return key.toLowerCase();
}

async function triggerToggleMacro(macro: Macro, source: string): Promise<void> {
  emitHotkeyStatus(`Toggle hotkey triggered (${source}): ${macro.name}`);
  if (runner.isRunning()) {
    await runner.stop();
    emitHotkeyStatus(`Stopped macro: ${macro.name}`);
    return;
  }

  void runner
    .start(macro, (running, name) => {
      win?.webContents.send("runner:state", { running, name });
    }, getRunnerOptions(cachedSettings))
    .catch((error) => {
      console.error("Macro runner hotkey start failed", error);
      win?.webContents.send("runner:error", {
        message: error instanceof Error ? error.message : String(error)
      });
      emitHotkeyStatus(`Failed to start macro by hotkey: ${macro.name}`);
    });
}

async function triggerExitMacro(macro: Macro, source: string): Promise<void> {
  emitHotkeyStatus(`Exit hotkey triggered (${source}): ${macro.name}`);
  await runner.stop();
}

async function registerGlobalHotkeys(macros: Macro[]): Promise<void> {
  // Always unregister Electron global shortcuts — we use uiohook exclusively
  // so key events pass through to other applications (games, etc.)
  globalShortcut.unregisterAll();

  if (!cachedSettings?.global_hotkeys) {
    uiohookOnlyKeys = new Set();
    emitHotkeyStatus("Global hotkeys disabled in settings.");
    return;
  }

  const newUiohookOnlyKeys = new Set<string>();
  const noHook: string[] = [];

  for (const macro of macros) {
    const toggleStored = normalizeStoredKey(macro.toggle_key);
    if (toggleStored) {
      if (STORED_KEY_UIOHOOK[toggleStored] !== undefined) {
        newUiohookOnlyKeys.add(toggleStored);
      } else if (macro.toggle_key.trim()) {
        noHook.push(`toggle ${macro.toggle_key} (${macro.name})`);
      }
    }

    const exitStored = normalizeStoredKey(macro.exit_key);
    if (exitStored) {
      if (STORED_KEY_UIOHOOK[exitStored] !== undefined) {
        newUiohookOnlyKeys.add(exitStored);
      } else if (macro.exit_key.trim()) {
        noHook.push(`exit ${macro.exit_key} (${macro.name})`);
      }
    }
  }

  uiohookOnlyKeys = newUiohookOnlyKeys;

  const count = newUiohookOnlyKeys.size;
  if (noHook.length > 0) {
    emitHotkeyStatus(`Registered ${count} pass-through hotkeys. Unsupported keys: ${noHook.join(", ")}.`);
  } else {
    emitHotkeyStatus(`Registered ${count} pass-through hotkeys.`);
  }
}
function debugLog(msg: string): void {
  const logPath = path.join(app.getPath("temp"), "mc-wipf-macro-debug.log");
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    import("node:fs").then(({ appendFileSync }) => appendFileSync(logPath, line));
  } catch {}
  console.log(msg);
}

function createWindow(): void {
  const preloadPath = path.resolve(__dirname, "../preload.cjs");
  const appIconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icons", "macro.ico")
    : path.resolve(__dirname, "../build/macro.ico");

  debugLog(`isPackaged=${app.isPackaged}`);
  debugLog(`appIconPath=${appIconPath}`);
  debugLog(`iconExists=${existsSync(appIconPath)}`);

  const appIconImage = existsSync(appIconPath) ? nativeImage.createFromPath(appIconPath) : null;

  debugLog(`nativeImage=${appIconImage ? (appIconImage.isEmpty() ? "EMPTY" : `ok sizes=${JSON.stringify(appIconImage.getSize())}`) : "null"}`);

  win = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: true,
    title: "Mc_Wipf Macro",
    icon: appIconImage && !appIconImage.isEmpty() ? appIconImage : undefined,
    backgroundColor: "#141414",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setMenuBarVisibility(false);
  if (appIconImage && !appIconImage.isEmpty()) {
    win.setIcon(appIconImage);
    debugLog("setIcon called");
  } else {
    debugLog("setIcon SKIPPED (image null or empty)");
  }
  if (process.platform === "win32") {
    win.setAppDetails({
      appId: "com.mcwipf.macro",
      appIconPath: appIconPath,
      appIconIndex: 0
    });
    debugLog(`setAppDetails called appIconPath=${appIconPath}`);
  }

  const rendererIndex = path.resolve(__dirname, "./renderer/index.html");

  console.log("Creating main window", { rendererIndex, preloadPath });

  win.once("ready-to-show", () => {
    console.log("Main window ready-to-show");
    win?.show();
    win?.focus();
    win?.moveTop();
    win?.setAlwaysOnTop(true, "screen-saver");
    setTimeout(() => {
      win?.setAlwaysOnTop(false);
    }, 1200);
  });

  win.webContents.on("did-finish-load", () => {
    console.log("Renderer did-finish-load");
  });

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log("Renderer console", { level, message, line, sourceId });
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("Renderer failed to load", {
      errorCode,
      errorDescription,
      validatedURL,
      rendererIndex
    });
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone", details);
  });

  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("Preload error", { preloadPath, error });
  });

  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.isAutoRepeat) {
      return;
    }

    // When the UI is waiting for a hotkey press, intercept everything and
    // forward the key to the renderer so it can see any key (including F12,
    // PrintScreen, etc. that Electron normally intercepts).
    if (hotkeyCaptureActive) {
      event.preventDefault();
      const MODIFIERS = ["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "ScrollLock", "Fn"];
      if (!MODIFIERS.includes(input.key)) {
        win?.webContents.send("app:capturedKey", normalizeInputKey(input.key));
      }
      return;
    }
  });

  win.on("close", () => {
    console.log("Main window close requested");
  });

  win.on("closed", () => {
    win = null;
    console.log("Main window closed");
  });

  void win.loadFile(rendererIndex).catch((error) => {
    console.error("loadFile failed", { rendererIndex, error });
  });
}

// Must be set before the app is ready so Windows correctly associates
// the taskbar button and shortcuts with this app's identity.
if (process.platform === "win32") {
  app.setAppUserModelId("com.mcwipf.macro");
}

app.whenReady().then(async () => {

  await store.ensureFiles();
  cachedMacros = await store.loadMacros();
  cachedSettings = await store.loadSettings();

  createWindow();
  await registerGlobalHotkeys(cachedMacros);

  // Start low-level keyboard hook for keys that globalShortcut can't capture
  uIOhook.on("keydown", (event) => {
    if (hotkeyCaptureActive) return;
    if (!cachedSettings?.global_hotkeys) return;
    for (const macro of cachedMacros) {
      const toggleStored = normalizeStoredKey(macro.toggle_key);
      if (uiohookOnlyKeys.has(toggleStored)) {
        const code = STORED_KEY_UIOHOOK[toggleStored];
        if (code !== undefined && event.keycode === code) {
          void triggerToggleMacro(macro, "global:uiohook");
          return;
        }
      }
      const exitStored = normalizeStoredKey(macro.exit_key);
      if (uiohookOnlyKeys.has(exitStored)) {
        const code = STORED_KEY_UIOHOOK[exitStored];
        if (code !== undefined && event.keycode === code) {
          void triggerExitMacro(macro, "global:uiohook");
          return;
        }
      }
    }
  });
  uIOhook.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  console.error("App startup failed", error);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  uIOhook.stop();
});

ipcMain.handle("app:getInitialData", async (): Promise<InitialPayload> => {
  cachedMacros = await store.loadMacros();
  cachedSettings = await store.loadSettings();
  return {
    macros: cachedMacros,
    settings: cachedSettings,
    macroFilePath: store.macroFilePath,
    settingsFilePath: store.settingsFilePath,
    imagesDirPath: store.imagesDirPath
  };
});

ipcMain.handle("app:saveMacros", async (_evt, macros: Macro[]) => {
  cachedMacros = macros;
  await store.saveMacros(macros);
  await registerGlobalHotkeys(cachedMacros);
});

ipcMain.handle("app:saveSettings", async (_evt, settings: AppSettings) => {
  cachedSettings = settings;
  await store.saveSettings(settings);
  await registerGlobalHotkeys(cachedMacros);
});

ipcMain.handle("app:startMacro", async (_evt, macro: Macro, settingsOverride?: Partial<AppSettings>) => {
  if (runner.isRunning()) {
    await runner.stop();
    return;
  }

  const mergedSettings = { ...(cachedSettings ?? {}), ...(settingsOverride ?? {}) };
  void runner
    .start(macro, (running, name) => {
      win?.webContents.send("runner:state", { running, name });
    }, getRunnerOptions(mergedSettings))
    .catch((error) => {
      console.error("Macro runner start failed", error);
      win?.webContents.send("runner:error", {
        message: error instanceof Error ? error.message : String(error)
      });
    });
});

ipcMain.handle("app:stopMacro", async () => {
  await runner.stop();
});

ipcMain.handle("app:writeClipboard", async (_evt, text: string) => {
  clipboard.writeText(text);
});

ipcMain.handle("app:readClipboard", async () => {
  return clipboard.readText();
});

ipcMain.handle("app:getCursorPoint", async () => {
  return screen.getCursorScreenPoint();
});

ipcMain.handle("app:pickClickPoint", async () => {
  return pickClickPointFromGameHotkey();
});

ipcMain.handle("app:pickClickPointGame", async () => {
  return pickClickPointFromGameHotkey();
});

ipcMain.handle("app:captureImageRegion", async (_evt, imageNameHint?: string, previousImagePath?: string) => {
  let region = await pickRegionFromOverlay();
  if (!region) {
    emitHotkeyStatus("Image Screenshot: overlay unavailable. Using game-safe two-point capture.");
    region = await pickRegionFromGameTwoPoint();
  }
  if (!region) {
    return null;
  }

  const png = await captureDisplayRegion(region);
  const fileName = makeImageFileName(imageNameHint ?? "image-detect");
  const absolutePath = path.join(store.imagesDirPath, fileName);
  await fs.mkdir(store.imagesDirPath, { recursive: true });
  await fs.writeFile(absolutePath, png);

  if (previousImagePath) {
    const previousSafePath = getSafeImagePathFromName(previousImagePath);
    if (previousSafePath && path.resolve(previousSafePath) !== path.resolve(absolutePath)) {
      await fs.unlink(previousSafePath).catch(() => {
        // Ignore missing or locked old image; new image was already saved.
      });
    }
  }

  return {
    imagePath: fileName,
    absolutePath,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height
  };
});

ipcMain.handle("app:startHotkeyCapture", () => {
  hotkeyCaptureActive = true;
});

ipcMain.handle("app:endHotkeyCapture", () => {
  hotkeyCaptureActive = false;
});

ipcMain.handle("app:validateHotkey", (_evt, rawKey: string) => {
  const accel = normalizeAccelerator(rawKey);
  if (!accel) {
    console.log(`[validateHotkey] REJECTED: no accelerator mapping for "${rawKey}"`);
    return { ok: false, reason: `Invalid key: ${rawKey}` };
  }
  // Accept any key with a valid mapping. If global shortcut registration fails
  // at runtime (e.g. another app owns the key), the hotkey still works via
  // the focused-window before-input-event handler.
  return { ok: true, accelerator: accel };
});
