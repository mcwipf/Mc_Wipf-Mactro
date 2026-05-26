import { shell } from "electron";
import { performance } from "node:perf_hooks";
import { desktopCapturer, nativeImage, screen } from "electron";
import path from "node:path";
import { Button, Key, Point, keyboard, mouse, sleep, straightTo } from "@nut-tree-fork/nut-js";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
// Use libnut's synchronous native mouse API directly — bypasses nut-js's async
// middleware chain which adds ~10-15ms overhead per press/release call.
const _libnut = _require("@nut-tree-fork/libnut");
const _nativeMouse: {
  setMouseDelay(ms: number): void;
  pressButton(btn: number): Promise<void>;
  releaseButton(btn: number): Promise<void>;
  setMousePosition(pos: { x: number; y: number }): Promise<void>;
  currentMousePosition(): Promise<{ x: number; y: number }>;
} = new _libnut.DefaultMouseAction();
_nativeMouse.setMouseDelay(0);
import type { Action, Macro } from "./types.js";

interface RunnerOptions {
  gameClickEnabled: boolean;
  normalClickEnabled: boolean;
  clickHoldMs: number;
  postMoveDelayMs: number;
  imagesDirPath: string;
}

type CaptureRegion = { x: number; y: number; width: number; height: number };

function configureNutForLowLatency(): void {
  const keyboardConfig = (keyboard as unknown as { config?: { autoDelayMs?: number } }).config;
  if (keyboardConfig && typeof keyboardConfig.autoDelayMs === "number") {
    keyboardConfig.autoDelayMs = 0;
  }

  const mouseConfig = (mouse as unknown as { config?: { autoDelayMs?: number; mouseSpeed?: number } }).config;
  if (mouseConfig && typeof mouseConfig.autoDelayMs === "number") {
    mouseConfig.autoDelayMs = 0;
  }
  if (mouseConfig && typeof mouseConfig.mouseSpeed === "number") {
    mouseConfig.mouseSpeed = 100000;
  }
}

function normalizeWaitMs(ms: number): number {
  return ms <= 0 ? 0 : ms;
}

// Yields once to the Node.js event loop via setImmediate.
// This runs AFTER any pending I/O callbacks (IPC messages, uiohook events),
// so stop signals are processed before we resume.
const _yield = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

// Precise sleep that keeps the event loop responsive.
// - Coarse phase: repeatedly yields via setImmediate so IPC/uiohook stop
//   signals can be processed between yields (~0.1ms per yield overhead).
// - Fine phase: pure performance.now() spin for the last SPIN_MS for
//   sub-millisecond accuracy.
// Net timing error: ±SPIN_MS at worst, typically <0.5ms.
const SPIN_MS = 2;

async function preciseSleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  const end = performance.now() + ms;
  // Always yield at least once so IPC/stop signals (macrotasks) are processed
  // before we enter any spin. Without this, sub-SPIN_MS sleeps would never
  // give the event loop a turn and stop signals would be ignored.
  await _yield();
  if (performance.now() >= end) return;
  while (end - performance.now() > SPIN_MS) {
    await _yield();
    if (performance.now() >= end) return;
  }
  while (performance.now() < end) { /* fine spin */ }
}

const SPECIAL_KEY_MAP: Record<string, Key> = {
  esc: Key.Escape,
  escape: Key.Escape,
  enter: Key.Enter,
  return: Key.Return,
  tab: Key.Tab,
  space: Key.Space,
  backspace: Key.Backspace,
  ctrl: Key.LeftControl,
  control: Key.LeftControl,
  lctrl: Key.LeftControl,
  leftctrl: Key.LeftControl,
  rctrl: Key.RightControl,
  rightctrl: Key.RightControl,
  shift: Key.LeftShift,
  lshift: Key.LeftShift,
  leftshift: Key.LeftShift,
  rshift: Key.RightShift,
  rightshift: Key.RightShift,
  alt: Key.LeftAlt,
  lalt: Key.LeftAlt,
  leftalt: Key.LeftAlt,
  ralt: Key.RightAlt,
  rightalt: Key.RightAlt,
  win: Key.LeftWin,
  lwin: Key.LeftWin,
  rwin: Key.RightWin,
  super: Key.LeftSuper,
  meta: Key.LeftMeta,
  cmd: Key.LeftCmd,
  command: Key.LeftCmd,
  menu: Key.Menu,
  capslock: Key.CapsLock,
  numlock: Key.NumLock,
  scrolllock: Key.ScrollLock,
  pause: Key.Pause,
  printscreen: Key.Print,
  delete: Key.Delete,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  home: Key.Home,
  end: Key.End,
  pgup: Key.PageUp,
  pageup: Key.PageUp,
  pgdn: Key.PageDown,
  pagedown: Key.PageDown,
  grave: Key.Grave,
  "`": Key.Grave,
  "~": Key.Grave,
  minus: Key.Minus,
  "-": Key.Minus,
  "_": Key.Minus,
  equal: Key.Equal,
  equals: Key.Equal,
  "=": Key.Equal,
  "+": Key.Equal,
  leftbracket: Key.LeftBracket,
  "[": Key.LeftBracket,
  "{": Key.LeftBracket,
  rightbracket: Key.RightBracket,
  "]": Key.RightBracket,
  "}": Key.RightBracket,
  backslash: Key.Backslash,
  "\\": Key.Backslash,
  "|": Key.Backslash,
  semicolon: Key.Semicolon,
  ";": Key.Semicolon,
  ":": Key.Semicolon,
  quote: Key.Quote,
  apostrophe: Key.Quote,
  "'": Key.Quote,
  "\"": Key.Quote,
  comma: Key.Comma,
  ",": Key.Comma,
  "<": Key.Comma,
  period: Key.Period,
  dot: Key.Period,
  ".": Key.Period,
  ">": Key.Period,
  slash: Key.Slash,
  "/": Key.Slash,
  "?": Key.Slash,
  insert: Key.Insert,
  f1: Key.F1,
  f2: Key.F2,
  f3: Key.F3,
  f4: Key.F4,
  f5: Key.F5,
  f6: Key.F6,
  f7: Key.F7,
  f8: Key.F8,
  f9: Key.F9,
  f10: Key.F10,
  f11: Key.F11,
  f12: Key.F12
};

function resolveKey(rawKey: string): Key | null {
  const key = rawKey.trim().toLowerCase();
  if (!key) {
    return null;
  }

  if (SPECIAL_KEY_MAP[key]) {
    return SPECIAL_KEY_MAP[key];
  }

  const functionMatch = /^f([1-9]|1[0-9]|2[0-4])$/.exec(key);
  if (functionMatch) {
    const enumName = `F${functionMatch[1]}` as keyof typeof Key;
    const mapped = Key[enumName];
    if (mapped !== undefined) {
      return mapped as Key;
    }
  }

  return singleCharToKey(key);
}

function normalizeAction(input: Partial<Action>): Action {
  return {
    type: input.type ?? "Mouse Click",
    x: Number(input.x ?? 0),
    y: Number(input.y ?? 0),
    width: Number(input.width ?? 0),
    height: Number(input.height ?? 0),
    trigger_x: Number(input.trigger_x ?? 0),
    trigger_y: Number(input.trigger_y ?? 0),
    key: String(input.key ?? ""),
    image_path: String(input.image_path ?? ""),
    detect_action: typeof input.detect_action === "string" ? input.detect_action : "Keyboard",
    detect_threshold: Number(input.detect_threshold ?? 97),
    click_type: input.click_type === "right" ? "right" : "left",
    delay: Number(input.delay ?? 0),
    scroll: Number(input.scroll ?? 1),
    delay_unit: input.delay_unit === "min" ? "min" : "ms"
  };
}

function normalizeRegion(region: CaptureRegion): CaptureRegion {
  return {
    x: Math.floor(region.x),
    y: Math.floor(region.y),
    width: Math.max(1, Math.floor(region.width)),
    height: Math.max(1, Math.floor(region.height))
  };
}

function resolveTemplateImagePath(imagesDirPath: string, storedImagePath: string): string {
  const raw = String(storedImagePath || "").trim();
  if (!raw) {
    return "";
  }

  // Support both new stored file names and older absolute-path data.
  if (path.isAbsolute(raw)) {
    return raw;
  }

  return path.join(imagesDirPath, path.basename(raw));
}

async function captureDisplayRegionImage(region: CaptureRegion): Promise<Electron.NativeImage> {
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
    throw new Error("Image Detection failed to capture display source.");
  }

  const localX = Math.max(0, normalized.x - display.bounds.x);
  const localY = Math.max(0, normalized.y - display.bounds.y);
  const maxW = Math.max(1, display.bounds.width - localX);
  const maxH = Math.max(1, display.bounds.height - localY);
  const safeW = Math.min(normalized.width, maxW);
  const safeH = Math.min(normalized.height, maxH);

  const thumbnail = source.thumbnail;
  const size = thumbnail.getSize();
  const scaleX = size.width / Math.max(1, display.bounds.width);
  const scaleY = size.height / Math.max(1, display.bounds.height);
  const cropX = Math.max(0, Math.floor(localX * scaleX));
  const cropY = Math.max(0, Math.floor(localY * scaleY));
  const cropW = Math.max(1, Math.floor(safeW * scaleX));
  const cropH = Math.max(1, Math.floor(safeH * scaleY));

  const cropped = thumbnail.crop({
    x: cropX,
    y: cropY,
    width: Math.min(cropW, Math.max(1, size.width - cropX)),
    height: Math.min(cropH, Math.max(1, size.height - cropY))
  });

  if (cropped.isEmpty()) {
    throw new Error("Image Detection captured an empty region.");
  }

  return cropped;
}

function calculateImageSimilarity(templateImage: Electron.NativeImage, currentImage: Electron.NativeImage): number {
  const templateSize = templateImage.getSize();
  if (templateSize.width <= 0 || templateSize.height <= 0) {
    return 0;
  }

  const resizedCurrent = currentImage.resize({ width: templateSize.width, height: templateSize.height });
  const templateBytes = templateImage.toBitmap();
  const currentBytes = resizedCurrent.toBitmap();
  const pixelCount = templateSize.width * templateSize.height;

  if (pixelCount <= 0 || templateBytes.length !== currentBytes.length) {
    return 0;
  }

  let sumDiff = 0;
  for (let i = 0; i < templateBytes.length; i += 4) {
    // NativeImage bitmap is BGRA.
    sumDiff += Math.abs(templateBytes[i] - currentBytes[i]);
    sumDiff += Math.abs(templateBytes[i + 1] - currentBytes[i + 1]);
    sumDiff += Math.abs(templateBytes[i + 2] - currentBytes[i + 2]);
  }

  const maxDiff = pixelCount * 255 * 3;
  return Math.max(0, 1 - sumDiff / maxDiff);
}

function singleCharToKey(key: string): Key | null {
  const char = key.trim().toUpperCase();
  if (!char || char.length !== 1) {
    return null;
  }
  if (char >= "A" && char <= "Z") {
    return Key[char as keyof typeof Key] as Key;
  }
  if (char >= "0" && char <= "9") {
    const enumKey = `Num${char}` as keyof typeof Key;
    return Key[enumKey] as Key;
  }
  return null;
}

async function pressKeyOnce(rawKey: string): Promise<void> {
  const normalized = rawKey.trim();
  if (!normalized) {
    return;
  }

  const mapped = resolveKey(normalized);
  if (mapped !== null && mapped !== undefined) {
    await keyboard.type(mapped);
    return;
  }

  await keyboard.type(normalized);
}

async function pressKeyDown(rawKey: string): Promise<void> {
  const mapped = resolveKey(rawKey);
  if (mapped !== null && mapped !== undefined) {
    await keyboard.pressKey(mapped);
  }
}

async function pressKeyUp(rawKey: string): Promise<void> {
  const mapped = resolveKey(rawKey);
  if (mapped !== null && mapped !== undefined) {
    await keyboard.releaseKey(mapped);
  }
}

// 0 = left, 1 = right — libnut button indices
const _BTN = { left: 0, right: 1 } as const;

async function clickMouseFast(clickType: "left" | "right"): Promise<void> {
  await _nativeMouse.pressButton(_BTN[clickType]);
  await _nativeMouse.releaseButton(_BTN[clickType]);
}

async function clickMousePressHoldRelease(clickType: "left" | "right", holdMs: number): Promise<void> {
  await _nativeMouse.pressButton(_BTN[clickType]);
  const adjustedHoldMs = normalizeWaitMs(Math.max(0, Math.floor(holdMs)));
  if (adjustedHoldMs > 0) {
    await preciseSleep(adjustedHoldMs);
  }
  await _nativeMouse.releaseButton(_BTN[clickType]);
}

async function clickMouseNormal(clickType: "left" | "right"): Promise<void> {
  await _nativeMouse.pressButton(_BTN[clickType]);
  await _nativeMouse.releaseButton(_BTN[clickType]);
}

export class MacroRunner {
  private running = false;
  private runToken = 0;
  private pauseDepth = 0;

  constructor() {
    configureNutForLowLatency();
  }

  isRunning(): boolean {
    return this.running;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.runToken += 1;
  }

  async start(macro: Macro, onStateChange: (running: boolean, name: string) => void, options?: Partial<RunnerOptions>): Promise<void> {
    if (this.running) {
      await this.stop();
      return;
    }

    this.running = true;
    this.pauseDepth = 0;
    const token = ++this.runToken;
    onStateChange(true, macro.name);

    const loopCount = Number.isFinite(macro.loop_count) ? macro.loop_count : 1;
    const normalizedActions = macro.actions.map((rawAction) => normalizeAction(rawAction));
    const normalizedCategoryDetections = (macro.image_detection_actions ?? [])
      .map((rawAction) => normalizeAction(rawAction))
      .filter((action) => action.type === "Image Detection");
    const runnerOptions: RunnerOptions = {
      gameClickEnabled: options?.gameClickEnabled ?? true,
      normalClickEnabled: options?.normalClickEnabled ?? true,
      clickHoldMs: Math.max(0, options?.clickHoldMs ?? 25),
      postMoveDelayMs: Math.max(0, options?.postMoveDelayMs ?? 2),
      imagesDirPath: options?.imagesDirPath ?? ""
    };
    const clickOnlyAction = this.getClickOnlyAction(normalizedActions, macro.loop_delay);
    let currentLoop = 0;
    const categoryWatcherPromise = this.runCategoryImageDetectionWatcher(
      normalizedCategoryDetections,
      macro.speed_multiplier || 1,
      token,
      runnerOptions
    );

    try {
      if (clickOnlyAction) {
        await this.runClickOnlyLoop(clickOnlyAction, loopCount, token, runnerOptions);
        return;
      }

      while (this.running && this.runToken === token && (loopCount === 0 || currentLoop < loopCount)) {
        currentLoop += 1;

        if (normalizedActions.length === 0) {
          // Avoid tight spinning when a macro has no regular actions.
          await sleep(50);
          continue;
        }

        for (let actionIndex = 0; actionIndex < normalizedActions.length; actionIndex += 1) {
          await this.waitWhilePaused(token);
          const action = normalizedActions[actionIndex];
          if (!this.running || this.runToken !== token) {
            break;
          }

          const consumed = await this.tryExecuteMousePressReleasePattern(normalizedActions, actionIndex, macro.speed_multiplier || 1, runnerOptions);
          if (consumed > 0) {
            actionIndex += consumed;
            continue;
          }

          await this.executeAction(action, macro.speed_multiplier || 1, runnerOptions);
        }

        if (!this.running || this.runToken !== token) {
          break;
        }

        const loopDelayMs = normalizeWaitMs(Math.max(0, Math.floor(macro.loop_delay)));
        if (loopDelayMs > 0) {
          await preciseSleep(loopDelayMs);
        }
      }
    } finally {
      this.running = false;
      await categoryWatcherPromise;
      onStateChange(false, macro.name);
    }
  }

  private async runCategoryImageDetectionWatcher(
    detections: Action[],
    speedMultiplier: number,
    token: number,
    options: RunnerOptions
  ): Promise<void> {
    if (!detections.length) {
      return;
    }

    const intervalMs = 1000;
    while (this.running && this.runToken === token) {
      for (const detection of detections) {
        if (!this.running || this.runToken !== token) {
          break;
        }

        let pausedForTrigger = false;
        try {
          await this.executeImageDetection(detection, speedMultiplier, options, false, {
            beforeTrigger: () => {
              if (!pausedForTrigger) {
                this.pauseMacro();
                pausedForTrigger = true;
              }
            },
            afterTrigger: () => {
              if (pausedForTrigger) {
                this.resumeMacro();
                pausedForTrigger = false;
              }
            }
          });
        } catch {
          // Keep the watcher alive even if one sample/trigger fails.
        } finally {
          if (pausedForTrigger) {
            this.resumeMacro();
            pausedForTrigger = false;
          }
        }
      }

      if (!this.running || this.runToken !== token) {
        break;
      }

      await sleep(intervalMs);
    }
  }

  private async executeImageDetection(
    action: Action,
    speedMultiplier: number,
    options: RunnerOptions,
    waitUntilMatch: boolean,
    hooks?: {
      beforeTrigger?: () => void;
      afterTrigger?: () => void;
    }
  ): Promise<void> {
    if (!action.image_path || !options.imagesDirPath) {
      return;
    }

    const region = {
      x: action.x,
      y: action.y,
      width: Math.max(1, Number(action.width ?? 1)),
      height: Math.max(1, Number(action.height ?? 1))
    };
    const templatePath = resolveTemplateImagePath(options.imagesDirPath, action.image_path);
    if (!templatePath) {
      return;
    }
    const templateImage = nativeImage.createFromPath(templatePath);
    if (templateImage.isEmpty()) {
      return;
    }

    const threshold = Math.max(1, Math.min(100, Number(action.detect_threshold ?? 97))) / 100;
    const pollMs = Math.max(16, normalizeWaitMs(options.postMoveDelayMs) || 50);
    let matched = false;

    while (this.running) {
      try {
        const currentImage = await captureDisplayRegionImage(region);
        const similarity = calculateImageSimilarity(templateImage, currentImage);
        if (similarity >= threshold) {
          matched = true;
          break;
        }
      } catch {
        // Keep waiting when capture temporarily fails (e.g. focus/display mode changes).
      }

      if (!waitUntilMatch) {
        break;
      }

      await sleep(pollMs);
    }

    if (!matched) {
      return;
    }

    const triggerType = action.detect_action || "Keyboard";
    if (triggerType === "Image Detection") {
      return;
    }

    const triggerAction: Action = {
      ...action,
      type: triggerType
    };

    if (triggerType === "Mouse Move" || triggerType === "Mouse Click With Move") {
      triggerAction.x = Number(action.trigger_x ?? 0);
      triggerAction.y = Number(action.trigger_y ?? 0);
    }

    hooks?.beforeTrigger?.();
    try {
      await this.executeAction(triggerAction, speedMultiplier, options);
    } finally {
      hooks?.afterTrigger?.();
    }
  }

  private pauseMacro(): void {
    this.pauseDepth += 1;
  }

  private resumeMacro(): void {
    this.pauseDepth = Math.max(0, this.pauseDepth - 1);
  }

  private async waitWhilePaused(token: number): Promise<void> {
    while (this.running && this.runToken === token && this.pauseDepth > 0) {
      await sleep(10);
    }
  }

  private getDelayMsForAction(action: Action, speedMultiplier: number): number {
    if (action.type !== "Delay") {
      return 0;
    }
    const baseMs = action.delay_unit === "min" ? action.delay * 60 * 1000 : action.delay;
    return normalizeWaitMs(Math.max(0, Math.floor(baseMs / Math.max(1, speedMultiplier))));
  }

  private async tryExecuteMousePressReleasePattern(
    actions: Action[],
    index: number,
    speedMultiplier: number,
    options: RunnerOptions
  ): Promise<number> {
    const current = actions[index];
    if (!current || current.type !== "Mouse Press") {
      return 0;
    }

    const next = actions[index + 1];
    const next2 = actions[index + 2];

    if (next && next.type === "Mouse Release" && next.click_type === current.click_type) {
      await clickMousePressHoldRelease(current.click_type, options.clickHoldMs);
      return 1;
    }

    if (next && next.type === "Delay" && next2 && next2.type === "Mouse Release" && next2.click_type === current.click_type) {
      const holdMs = this.getDelayMsForAction(next, speedMultiplier);
      await clickMousePressHoldRelease(current.click_type, holdMs > 0 ? holdMs : options.clickHoldMs);
      return 2;
    }

    return 0;
  }

  private getClickOnlyAction(actions: Action[], loopDelay: number): Action | null {
    if (normalizeWaitMs(loopDelay) > 0) {
      return null;
    }
    if (actions.length !== 1) {
      return null;
    }

    const [action] = actions;
    if (action.type === "Mouse Click" || action.type === "Mouse Click (No Move)") {
      return action;
    }
    return null;
  }

  private async runClickOnlyLoop(action: Action, loopCount: number, token: number, options: RunnerOptions): Promise<void> {
    let remaining = loopCount === 0 ? Number.POSITIVE_INFINITY : loopCount;

    while (this.running && this.runToken === token && remaining > 0) {
      await this.waitWhilePaused(token);
      await this.performClick(action.click_type, options);

      if (Number.isFinite(remaining)) {
        remaining -= 1;
      }
    }
  }

  private async performClick(clickType: "left" | "right", options: RunnerOptions): Promise<void> {
    const gameEnabled = options.gameClickEnabled;
    const normalEnabled = options.normalClickEnabled;

    if (gameEnabled) {
      try {
        await clickMousePressHoldRelease(clickType, options.clickHoldMs);
        return;
      } catch {
        if (!normalEnabled) {
          throw new Error("Game click mode failed and normal click mode is disabled.");
        }
      }
    }

    if (normalEnabled) {
      try {
        await clickMousePressHoldRelease(clickType, options.clickHoldMs);
        return;
      } catch {
        await clickMouseNormal(clickType);
      }
      return;
    }

    await clickMouseFast(clickType);
  }

  private async executeAction(action: Action, speedMultiplier: number, options: RunnerOptions): Promise<void> {
    switch (action.type) {
      case "Delay": {
        const baseMs = action.delay_unit === "min" ? action.delay * 60 * 1000 : action.delay;
        const adjusted = normalizeWaitMs(Math.max(0, Math.floor(baseMs / Math.max(1, speedMultiplier))));
        if (adjusted > 0) {
          await preciseSleep(adjusted);
        }
        return;
      }
      case "Mouse Move": {
        await mouse.setPosition(new Point(action.x, action.y));
        return;
      }
      case "Relative Mouse Move": {
        const pos = await mouse.getPosition();
        await mouse.move(straightTo(new Point(pos.x + action.x, pos.y + action.y)));
        return;
      }
      case "Mouse Click With Move": {
        await mouse.setPosition(new Point(action.x, action.y));
        const settleMs = normalizeWaitMs(options.postMoveDelayMs);
        if (settleMs > 0) {
          await sleep(settleMs);
        }
        await this.performClick(action.click_type, options);
        return;
      }
      case "Mouse Click":
      case "Mouse Click (No Move)": {
        await this.performClick(action.click_type, options);
        return;
      }
      case "Mouse Press": {
        await mouse.pressButton(action.click_type === "right" ? Button.RIGHT : Button.LEFT);
        return;
      }
      case "Mouse Release": {
        await mouse.releaseButton(action.click_type === "right" ? Button.RIGHT : Button.LEFT);
        return;
      }
      case "Scroll": {
        if (action.scroll >= 0) {
          await mouse.scrollUp(action.scroll);
        } else {
          await mouse.scrollDown(Math.abs(action.scroll));
        }
        return;
      }
      case "Keyboard": {
        await pressKeyOnce(action.key);
        return;
      }
      case "Keyboard Press": {
        await pressKeyDown(action.key);
        return;
      }
      case "Keyboard Release": {
        await pressKeyUp(action.key);
        return;
      }
      case "Open Link": {
        if (action.key) {
          await shell.openExternal(action.key);
        }
        return;
      }
      case "Image Detection": {
        await this.executeImageDetection(action, speedMultiplier, options, true);
        return;
      }
      default:
        return;
    }
  }
}
