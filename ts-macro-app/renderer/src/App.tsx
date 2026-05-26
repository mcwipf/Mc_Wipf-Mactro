import { useEffect, useMemo, useRef, useState } from "react";

let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_audioCtx) _audioCtx = new AudioContext();
  return _audioCtx;
}

function playTone(freq: number, durationSec: number, gainPeak: number): void {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(gainPeak, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durationSec);
  } catch {}
}

type DelayUnit = "ms" | "min";
type ThemeMode = "dark" | "light";

type ActionType =
  | "Mouse Click With Move"
  | "Mouse Move"
  | "Mouse Click"
  | "Mouse Click (No Move)"
  | "Mouse Press"
  | "Mouse Release"
  | "Relative Mouse Move"
  | "Keyboard"
  | "Keyboard Press"
  | "Keyboard Release"
  | "Scroll"
  | "Delay"
  | "Image Detection"
  | "Open Link";

interface Action {
  type: ActionType | string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  trigger_x?: number;
  trigger_y?: number;
  key: string;
  image_path?: string;
  detect_action?: ActionType | "";
  detect_threshold?: number;
  click_type: "left" | "right";
  delay: number;
  scroll: number;
  delay_unit: DelayUnit;
}

interface Macro {
  name: string;
  loop_delay: number;
  loop_count: number;
  toggle_key: string;
  exit_key: string;
  speed_multiplier: number;
  actions: Action[];
  image_detection_actions?: Action[];
}

interface AppSettings {
  background_color: string;
  text_color: string;
  outline_color: string;
  button_color: string;
  default_click_delay: number;
  default_regular_delay: number;
  game_click_enabled: boolean;
  normal_click_enabled: boolean;
  global_hotkeys: boolean;
  ui_theme: ThemeMode;
}

interface InitialPayload {
  macros: Macro[];
  settings: AppSettings;
  macroFilePath: string;
  settingsFilePath: string;
  imagesDirPath: string;
}

declare global {
  interface Window {
    macroApi: {
      getInitialData: () => Promise<InitialPayload>;
      saveMacros: (macros: Macro[]) => Promise<void>;
      saveSettings: (settings: AppSettings) => Promise<void>;
      startMacro: (macro: Macro, settings: AppSettings) => Promise<void>;
      stopMacro: () => Promise<void>;
      writeClipboard: (text: string) => Promise<void>;
      readClipboard: () => Promise<string>;
      getCursorPoint: () => Promise<{ x: number; y: number }>;
      pickClickPoint: () => Promise<{ x: number; y: number } | null>;
      pickClickPointGame: () => Promise<{ x: number; y: number } | null>;
      captureImageRegion: (imageNameHint?: string, previousImagePath?: string) => Promise<{
        imagePath: string;
        absolutePath: string;
        x: number;
        y: number;
        width: number;
        height: number;
      } | null>;
      validateHotkey: (key: string) => Promise<{ ok: boolean; reason?: string; accelerator?: string }>;
      startHotkeyCapture: () => Promise<void>;
      endHotkeyCapture: () => Promise<void>;
      onCapturedKey: (handler: (key: string) => void) => () => void;
      onRunnerState: (handler: (state: { running: boolean; name: string }) => void) => void;
      onRunnerError: (handler: (state: { message: string }) => void) => void;
      onHotkeyStatus: (handler: (state: { message: string }) => void) => void;
    };
  }
}

const ACTION_TYPES: ActionType[] = [
  "Mouse Click With Move",
  "Mouse Move",
  "Mouse Click",
  "Mouse Click (No Move)",
  "Mouse Press",
  "Mouse Release",
  "Relative Mouse Move",
  "Keyboard",
  "Keyboard Press",
  "Keyboard Release",
  "Scroll",
  "Delay",
  "Image Detection",
  "Open Link"
];

const DETECTION_ACTION_OPTIONS: ActionType[] = ["Mouse Move", "Mouse Click With Move", "Mouse Click", "Mouse Click (No Move)", "Keyboard", "Keyboard Press", "Keyboard Release", "Open Link"];

const ACTION_GROUPS: Array<{ label: string; types: ActionType[] }> = [
  {
    label: "Mouse",
    types: ["Mouse Click With Move", "Mouse Move", "Mouse Click", "Mouse Click (No Move)", "Mouse Press", "Mouse Release", "Relative Mouse Move", "Scroll"]
  },
  {
    label: "Keyboard",
    types: ["Keyboard", "Keyboard Press", "Keyboard Release"]
  },
  {
    label: "Timing",
    types: ["Delay"]
  },
  {
    label: "Utility",
    types: ["Image Detection", "Open Link"]
  }
];

const DEFAULT_SETTINGS: AppSettings = {
  background_color: "#141414",
  text_color: "#f2f2f2",
  outline_color: "#7a7a7a",
  button_color: "#1a1a1a",
  default_click_delay: 25,
  default_regular_delay: 50,
  game_click_enabled: true,
  normal_click_enabled: true,
  global_hotkeys: true,
  ui_theme: "dark"
};

const DEFAULT_ROW_HEIGHT = 34;
const IMAGE_DETECTION_ROW_HEIGHT = 68;

function parseNumber(value: string | number, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatImageNamePreview(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 10) {
    return trimmed;
  }
  return `${trimmed.slice(0, 10)}...`;
}

function makeAction(type: ActionType): Action {
  return {
    type,
    x: 0,
    y: 0,
    width: 80,
    height: 40,
    trigger_x: 0,
    trigger_y: 0,
    key: "",
    image_path: "",
    detect_action: "Keyboard",
    detect_threshold: 97,
    click_type: "left",
    delay: type === "Mouse Click With Move" ? 25 : 0,
    scroll: 1,
    delay_unit: "ms"
  };
}

function actionSummary(action: Action): string {
  switch (action.type) {
    case "Mouse Click With Move":
      return `Move(${action.x}, ${action.y}) ${action.click_type} click`;
    case "Mouse Move":
      return `Move to (${action.x}, ${action.y})`;
    case "Relative Mouse Move":
      return `Relative move (${action.x}, ${action.y})`;
    case "Mouse Click":
    case "Mouse Click (No Move)":
      return `${action.click_type} click`;
    case "Mouse Press":
      return `${action.click_type} button press`;
    case "Mouse Release":
      return `${action.click_type} button release`;
    case "Keyboard":
    case "Keyboard Press":
    case "Keyboard Release":
      return `${action.type}: ${action.key || "(empty)"}`;
    case "Scroll":
      return `Scroll ${action.scroll}`;
    case "Delay":
      return `Delay ${action.delay}${action.delay_unit}`;
    case "Open Link":
      return `Open ${action.key || "(empty URL)"}`;
    case "Image Detection": {
      const image = action.image_path || "(no image)";
      const trigger = action.detect_action || "Keyboard";
      return `If image ${image} seen -> ${trigger}`;
    }
    default:
      return action.type;
  }
}

export function App() {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [macroFilePath, setMacroFilePath] = useState("");
  const [imagesDirPath, setImagesDirPath] = useState("");
  const [selectedMacroIndex, setSelectedMacroIndex] = useState(-1);
  const [selectedActionIndices, setSelectedActionIndices] = useState<Set<number>>(new Set());
  const [focusedActionIndex, setFocusedActionIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Ready.");
  const [pendingHotkeyField, setPendingHotkeyField] = useState<"toggle" | "exit" | null>(null);
  const [tab, setTab] = useState<"macros" | "settings">("macros");
  const [scrollTop, setScrollTop] = useState(0);
  const [autoDelayEnabled, setAutoDelayEnabled] = useState(false);
  const [autoDelayAmount, setAutoDelayAmount] = useState("50");
  const [autoDelayUnit, setAutoDelayUnit] = useState<DelayUnit>("ms");
  const [currentWidth, setCurrentWidth] = useState("");
  const [currentHeight, setCurrentHeight] = useState("");
  const [targetWidth, setTargetWidth] = useState("");
  const [targetHeight, setTargetHeight] = useState("");
  const [roundCoordinates, setRoundCoordinates] = useState(true);
  const [nameDialog, setNameDialog] = useState<{
    mode: "new" | "copy";
    value: string;
    sourceMacro: Macro | null;
  } | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const currentMacro = selectedMacroIndex >= 0 && selectedMacroIndex < macros.length ? macros[selectedMacroIndex] : null;
  const currentImageDetectionActions = currentMacro?.image_detection_actions ?? [];

  const totalActions = currentMacro?.actions.length ?? 0;
  const viewportHeight = viewportRef.current?.clientHeight ?? 300;
  const rowMetrics = useMemo(() => {
    if (!currentMacro) {
      return [] as Array<{ index: number; top: number; height: number; action: Action }>;
    }

    let top = 0;
    return currentMacro.actions.map((action, index) => {
      const height = action.type === "Image Detection" ? IMAGE_DETECTION_ROW_HEIGHT : DEFAULT_ROW_HEIGHT;
      const metric = { index, top, height, action };
      top += height;
      return metric;
    });
  }, [currentMacro]);

  const totalActionHeight = rowMetrics.length
    ? rowMetrics[rowMetrics.length - 1].top + rowMetrics[rowMetrics.length - 1].height
    : 0;

  const visibleActions = useMemo(() => {
    if (!rowMetrics.length) {
      return [] as Array<{ index: number; top: number; height: number; action: Action }>;
    }

    const overscanPx = 220;
    const startY = Math.max(0, scrollTop - overscanPx);
    const endY = scrollTop + viewportHeight + overscanPx;

    let startIndex = 0;
    while (startIndex < rowMetrics.length && rowMetrics[startIndex].top + rowMetrics[startIndex].height < startY) {
      startIndex += 1;
    }

    const rows: Array<{ index: number; top: number; height: number; action: Action }> = [];
    for (let i = startIndex; i < rowMetrics.length; i += 1) {
      const row = rowMetrics[i];
      if (row.top > endY) {
        break;
      }
      rows.push(row);
    }

    return rows;
  }, [rowMetrics, scrollTop, viewportHeight]);

  const visibleStartOffset = visibleActions.length ? visibleActions[0].top : 0;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.ui_theme);
  }, [settings.ui_theme]);

  useEffect(() => {
    if (focusedActionIndex < 0 || !viewportRef.current) return;
    const row = rowMetrics[focusedActionIndex];
    if (!row) return;
    const viewport = viewportRef.current;
    const rowBottom = row.top + row.height;
    if (row.top < viewport.scrollTop) {
      viewport.scrollTop = row.top;
    } else if (rowBottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = rowBottom - viewport.clientHeight;
    }
  }, [focusedActionIndex, rowMetrics]);

  useEffect(() => {
    if (!nameDialog) {
      return;
    }
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [nameDialog?.mode]);

  useEffect(() => {
    void (async () => {
      const payload = await window.macroApi.getInitialData();
      setMacros(payload.macros);
      setSettings(payload.settings);
      setMacroFilePath(payload.macroFilePath);
      setImagesDirPath(payload.imagesDirPath);
      if (payload.macros.length > 0) {
        setSelectedMacroIndex(0);
        setFocusedActionIndex(payload.macros[0].actions.length > 0 ? 0 : -1);
      }
    })();

    window.macroApi.onRunnerState((runnerState) => {
      setRunning(runnerState.running);
      setStatus(runnerState.running ? `Running: ${runnerState.name}` : "Stopped.");
      if (runnerState.running) {
        playTone(1200, 0.18, 0.4); // ting
      } else {
        playTone(600, 0.28, 0.35); // tong
      }
    });

    window.macroApi.onRunnerError((runnerError) => {
      setRunning(false);
      setStatus(`Runner error: ${runnerError.message}`);
    });

    window.macroApi.onHotkeyStatus((hotkeyStatus) => {
      setStatus(hotkeyStatus.message);
    });
  }, []);

  useEffect(() => {
    if (!pendingHotkeyField) {
      return;
    }

    void window.macroApi.startHotkeyCapture();
    let handled = false;

    const unlisten = window.macroApi.onCapturedKey(async (key: string) => {
      if (handled) return;
      handled = true;
      void window.macroApi.endHotkeyCapture();

      if (!currentMacro) {
        setPendingHotkeyField(null);
        return;
      }

      const validation = await window.macroApi.validateHotkey(key);
      if (!validation.ok) {
        setStatus(validation.reason ?? `Hotkey ${key} unavailable`);
        setPendingHotkeyField(null);
        return;
      }

      const updatedMacros = [...macros];
      const selected = updatedMacros[selectedMacroIndex];
      if (!selected) {
        setPendingHotkeyField(null);
        return;
      }

      if (pendingHotkeyField === "toggle") {
        updatedMacros.forEach((macro, i) => {
          if (i !== selectedMacroIndex && macro.toggle_key === key) {
            macro.toggle_key = "";
          }
        });
        selected.toggle_key = key;
      } else {
        selected.exit_key = key;
      }

      setMacros(updatedMacros);
      setPendingHotkeyField(null);
      setStatus(`Set hotkey: ${key}`);
      await window.macroApi.saveMacros(updatedMacros);
    });

    return () => {
      void window.macroApi.endHotkeyCapture();
      unlisten();
    };
  }, [pendingHotkeyField, macros, currentMacro, selectedMacroIndex]);

  const saveMacros = async (next: Macro[]) => {
    setMacros(next);
    await window.macroApi.saveMacros(next);
  };

  const saveSettings = async (next: AppSettings) => {
    setSettings(next);
    await window.macroApi.saveSettings(next);
  };

  const setMacroField = async <K extends keyof Macro>(key: K, value: Macro[K]) => {
    if (!currentMacro) {
      return;
    }
    const next = [...macros];
    next[selectedMacroIndex] = { ...next[selectedMacroIndex], [key]: value };
    await saveMacros(next);
  };

  const addAction = async (actionType: ActionType) => {
    if (!currentMacro) {
      setStatus("Please select a macro first.");
      return;
    }

    const insertAt = focusedActionIndex >= 0 ? focusedActionIndex + 1 : currentMacro.actions.length;
    const toInsert: Action[] = [];

    if (actionType === "Mouse Click With Move") {
      toInsert.push(makeAction("Mouse Move"));
      toInsert.push({ ...makeAction("Delay"), delay: 25, delay_unit: "ms" });
      toInsert.push(makeAction("Mouse Click"));
    } else {
      toInsert.push(makeAction(actionType));
    }

    const autoDelayMs = parseNumber(autoDelayAmount, 0);
    if (autoDelayEnabled && autoDelayMs > 0) {
      toInsert.push({ ...makeAction("Delay"), delay: autoDelayMs, delay_unit: autoDelayUnit });
    }

    const next = [...macros];
    const updated = { ...next[selectedMacroIndex] };
    updated.actions = [...updated.actions];
    updated.actions.splice(insertAt, 0, ...toInsert);
    next[selectedMacroIndex] = updated;

    const lastInserted = insertAt + toInsert.length - 1;
    setFocusedActionIndex(lastInserted);
    setSelectedActionIndices(new Set([lastInserted]));
    await saveMacros(next);
    setStatus(`Added ${toInsert.length} action(s).`);
  };

  const updateActionAt = async (index: number, apply: (action: Action) => Action) => {
    if (!currentMacro || index < 0 || index >= currentMacro.actions.length) {
      return;
    }
    const next = [...macros];
    const updated = { ...next[selectedMacroIndex], actions: [...next[selectedMacroIndex].actions] };
    updated.actions[index] = apply(updated.actions[index]);
    next[selectedMacroIndex] = updated;
    await saveMacros(next);
  };

  const addImageDetectionCategoryAction = async () => {
    if (!currentMacro) {
      return;
    }

    const next = [...macros];
    const updated = { ...next[selectedMacroIndex], actions: [...next[selectedMacroIndex].actions] };
    const detections = [...(updated.image_detection_actions ?? [])];
    detections.push(makeAction("Image Detection"));
    updated.image_detection_actions = detections;
    next[selectedMacroIndex] = updated;
    await saveMacros(next);
    setStatus("Added Image Detection category action.");
  };

  const updateImageDetectionCategoryAt = async (index: number, apply: (action: Action) => Action) => {
    if (!currentMacro) {
      return;
    }

    const detections = currentMacro.image_detection_actions ?? [];
    if (index < 0 || index >= detections.length) {
      return;
    }

    const next = [...macros];
    const updated = { ...next[selectedMacroIndex], actions: [...next[selectedMacroIndex].actions] };
    const updatedDetections = [...(updated.image_detection_actions ?? [])];
    updatedDetections[index] = apply(updatedDetections[index]);
    updated.image_detection_actions = updatedDetections;
    next[selectedMacroIndex] = updated;
    await saveMacros(next);
  };

  const removeImageDetectionCategoryAt = async (index: number) => {
    if (!currentMacro) {
      return;
    }

    const detections = currentMacro.image_detection_actions ?? [];
    if (index < 0 || index >= detections.length) {
      return;
    }

    const next = [...macros];
    const updated = { ...next[selectedMacroIndex], actions: [...next[selectedMacroIndex].actions] };
    const updatedDetections = [...(updated.image_detection_actions ?? [])];
    updatedDetections.splice(index, 1);
    updated.image_detection_actions = updatedDetections;
    next[selectedMacroIndex] = updated;
    await saveMacros(next);
  };

  const removeActionAt = async (index: number) => {
    if (!currentMacro || index < 0 || index >= currentMacro.actions.length) {
      return;
    }
    const next = [...macros];
    const updated = { ...next[selectedMacroIndex], actions: [...next[selectedMacroIndex].actions] };
    updated.actions.splice(index, 1);
    next[selectedMacroIndex] = updated;
    setFocusedActionIndex(Math.min(updated.actions.length - 1, focusedActionIndex));
    const nextSelected = new Set([...selectedActionIndices].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)));
    setSelectedActionIndices(nextSelected);
    await saveMacros(next);
  };

  const removeSelectedActions = async () => {
    if (!currentMacro) {
      return;
    }
    const indices = [...selectedActionIndices].sort((a, b) => b - a);
    if (!indices.length && focusedActionIndex >= 0) {
      indices.push(focusedActionIndex);
    }
    if (!indices.length) {
      return;
    }

    const next = [...macros];
    const updated = { ...next[selectedMacroIndex], actions: [...next[selectedMacroIndex].actions] };
    indices.forEach((idx) => {
      if (idx >= 0 && idx < updated.actions.length) {
        updated.actions.splice(idx, 1);
      }
    });
    next[selectedMacroIndex] = updated;
    setSelectedActionIndices(new Set());
    setFocusedActionIndex(Math.min(updated.actions.length - 1, focusedActionIndex));
    await saveMacros(next);
  };

  const moveFocused = async (direction: -1 | 1) => {
    if (!currentMacro || focusedActionIndex < 0) {
      return;
    }
    const target = focusedActionIndex + direction;
    if (target < 0 || target >= currentMacro.actions.length) {
      return;
    }

    const next = [...macros];
    const updated = { ...next[selectedMacroIndex], actions: [...next[selectedMacroIndex].actions] };
    [updated.actions[focusedActionIndex], updated.actions[target]] = [updated.actions[target], updated.actions[focusedActionIndex]];
    next[selectedMacroIndex] = updated;
    setFocusedActionIndex(target);
    setSelectedActionIndices(new Set([target]));
    await saveMacros(next);
  };

  const copySelectedActions = async () => {
    if (!currentMacro) {
      return;
    }
    const selected = [...selectedActionIndices].sort((a, b) => a - b);
    const actions = selected.length
      ? selected.map((idx) => currentMacro.actions[idx])
      : focusedActionIndex >= 0
      ? [currentMacro.actions[focusedActionIndex]]
      : [];

    if (!actions.length) {
      setStatus("No actions selected.");
      return;
    }

    await window.macroApi.writeClipboard(JSON.stringify(actions));
    setStatus(`Copied ${actions.length} action(s).`);
  };

  const pasteActions = async () => {
    if (!currentMacro) {
      return;
    }

    try {
      const text = await window.macroApi.readClipboard();
      const parsed = JSON.parse(text) as Action[];
      if (!Array.isArray(parsed)) {
        setStatus("Clipboard data is invalid.");
        return;
      }

      const insertAt = focusedActionIndex >= 0 ? focusedActionIndex + 1 : currentMacro.actions.length;
      const normalized = parsed.map((a) => ({ ...makeAction((a.type as ActionType) || "Mouse Click"), ...a }));

      const next = [...macros];
      const updated = { ...next[selectedMacroIndex], actions: [...next[selectedMacroIndex].actions] };
      updated.actions.splice(insertAt, 0, ...normalized);
      next[selectedMacroIndex] = updated;
      setFocusedActionIndex(insertAt);
      setSelectedActionIndices(new Set([insertAt]));
      await saveMacros(next);
      setStatus(`Pasted ${normalized.length} action(s).`);
    } catch {
      setStatus("Clipboard does not contain action JSON.");
    }
  };

  const toggleMacroRun = async () => {
    if (!currentMacro) {
      setStatus("No macro selected.");
      return;
    }
    if (running) {
      await window.macroApi.stopMacro();
      return;
    }
    await window.macroApi.startMacro(currentMacro, settings);
  };

  const pickClickPoint = async (): Promise<{ x: number; y: number } | null> => {
    setStatus("Click Point: app minimized. Move cursor to target and hold briefly to capture.");
    const point = await window.macroApi.pickClickPoint();
    if (!point) {
      setStatus("Click Point canceled or timed out.");
      return null;
    }
    return point;
  };

  const setActionAtClickPoint = async (index: number) => {
    if (!currentMacro || index < 0 || index >= currentMacro.actions.length) {
      return;
    }
    const action = currentMacro.actions[index];
    if (!(action.type.includes("Mouse") || action.type === "Relative Mouse Move")) {
      setStatus("Click Point is only for mouse actions.");
      return;
    }

    const point = await pickClickPoint();
    if (!point) return;
    await updateActionAt(index, (a) => ({ ...a, x: point.x, y: point.y }));
    setFocusedActionIndex(index);
    setSelectedActionIndices(new Set([index]));
    setStatus(`Action ${index + 1} click point set to X:${point.x} Y:${point.y}`);
  };

  const captureImageRegionForAction = async (index: number) => {
    if (!currentMacro || index < 0 || index >= currentMacro.actions.length) {
      return;
    }

    setStatus("Image Detection: app minimized. Drag a screenshot region.");
    const capture = await window.macroApi.captureImageRegion(currentMacro.name || "macro", currentMacro.actions[index].image_path || "");
    if (!capture) {
      setStatus("Image Detection capture canceled.");
      return;
    }

    await updateActionAt(index, (action) => ({
      ...action,
      image_path: capture.imagePath,
      x: capture.x,
      y: capture.y,
      width: capture.width,
      height: capture.height
    }));
    setFocusedActionIndex(index);
    setSelectedActionIndices(new Set([index]));
    setStatus(`Saved image: ${capture.imagePath} (${capture.width}x${capture.height})`);
  };

  const setImageTriggerPointAtAction = async (index: number) => {
    if (!currentMacro || index < 0 || index >= currentMacro.actions.length) {
      return;
    }

    const action = currentMacro.actions[index];
    if (action.type !== "Image Detection") {
      return;
    }

    const point = await pickClickPoint();
    if (!point) {
      return;
    }

    await updateActionAt(index, (a) => ({
      ...a,
      trigger_x: point.x,
      trigger_y: point.y
    }));
    setFocusedActionIndex(index);
    setSelectedActionIndices(new Set([index]));
    setStatus(`Image trigger point set to X:${point.x} Y:${point.y}`);
  };

  const captureImageRegionForCategoryAction = async (index: number) => {
    if (!currentMacro) {
      return;
    }

    const detections = currentMacro.image_detection_actions ?? [];
    if (index < 0 || index >= detections.length) {
      return;
    }

    setStatus("Image Detection Category: app minimized. Drag a screenshot region.");
    const capture = await window.macroApi.captureImageRegion(currentMacro.name || "macro", detections[index].image_path || "");
    if (!capture) {
      setStatus("Image Detection Category capture canceled.");
      return;
    }

    await updateImageDetectionCategoryAt(index, (action) => ({
      ...action,
      image_path: capture.imagePath,
      x: capture.x,
      y: capture.y,
      width: capture.width,
      height: capture.height
    }));
    setStatus(`Category image saved: ${capture.imagePath} (${capture.width}x${capture.height})`);
  };

  const setImageTriggerPointAtCategoryAction = async (index: number) => {
    if (!currentMacro) {
      return;
    }

    const detections = currentMacro.image_detection_actions ?? [];
    if (index < 0 || index >= detections.length) {
      return;
    }

    const point = await pickClickPoint();
    if (!point) {
      return;
    }

    await updateImageDetectionCategoryAt(index, (action) => ({
      ...action,
      trigger_x: point.x,
      trigger_y: point.y
    }));
    setStatus(`Category trigger point set to X:${point.x} Y:${point.y}`);
  };

  const openNewMacroDialog = () => {
    setNameDialog({ mode: "new", value: "", sourceMacro: null });
  };

  const openCopyMacroDialog = () => {
    if (!currentMacro) {
      return;
    }
    setNameDialog({
      mode: "copy",
      value: `Copy of ${currentMacro.name}`,
      sourceMacro: JSON.parse(JSON.stringify(currentMacro)) as Macro
    });
  };

  const submitNameDialog = async () => {
    if (!nameDialog) {
      return;
    }

    const name = nameDialog.value.trim();
    if (!name) {
      setStatus("Macro name cannot be empty.");
      return;
    }

    if (nameDialog.mode === "copy") {
      if (!nameDialog.sourceMacro) {
        setNameDialog(null);
        return;
      }

      const clone = JSON.parse(JSON.stringify(nameDialog.sourceMacro)) as Macro;
      clone.name = name;
      clone.toggle_key = "";
      clone.exit_key = "";
      const next = [...macros, clone];
      setSelectedMacroIndex(next.length - 1);
      setFocusedActionIndex(clone.actions.length ? 0 : -1);
      setNameDialog(null);
      await saveMacros(next);
      return;
    }

    const macro: Macro = {
      name,
      loop_delay: 0,
      loop_count: 1,
      toggle_key: "",
      exit_key: "",
      speed_multiplier: 1,
      actions: [],
      image_detection_actions: []
    };
    const next = [...macros, macro];
    setSelectedMacroIndex(next.length - 1);
    setFocusedActionIndex(-1);
    setNameDialog(null);
    await saveMacros(next);
  };

  const convertCoordinates = async (previewOnly: boolean) => {
    const cw = parseNumber(currentWidth, 0);
    const ch = parseNumber(currentHeight, 0);
    const tw = parseNumber(targetWidth, 0);
    const th = parseNumber(targetHeight, 0);

    if (cw <= 0 || ch <= 0 || tw <= 0 || th <= 0) {
      setStatus("Invalid monitor dimensions.");
      return;
    }

    let converted = 0;
    let affected = 0;
    const next = [...macros];

    for (let m = 0; m < next.length; m += 1) {
      let changed = false;
      const macro = { ...next[m], actions: [...next[m].actions] };
      for (let i = 0; i < macro.actions.length; i += 1) {
        const action = { ...macro.actions[i] };
        const canConvert = ["Mouse Click With Move", "Mouse Move", "Mouse Click", "Mouse Click (No Move)"].includes(action.type);
        if (!canConvert) {
          macro.actions[i] = action;
          continue;
        }

        const nxRaw = (action.x * tw) / cw;
        const nyRaw = (action.y * th) / ch;
        const nx = Math.max(0, Math.min(tw - 1, roundCoordinates ? Math.round(nxRaw) : nxRaw));
        const ny = Math.max(0, Math.min(th - 1, roundCoordinates ? Math.round(nyRaw) : nyRaw));

        if (nx !== action.x || ny !== action.y) {
          if (!previewOnly) {
            action.x = nx;
            action.y = ny;
          }
          converted += 1;
          changed = true;
        }

        macro.actions[i] = action;
      }
      if (changed) {
        affected += 1;
      }
      next[m] = macro;
    }

    if (!previewOnly && converted > 0) {
      await saveMacros(next);
    }

    setStatus(`${previewOnly ? "Preview" : "Converted"}: ${converted} actions across ${affected} macros.`);
  };

  return (
    <div id="app">
      <div className="app-pride-banner">!Made With Pride! By Mc_Wipf</div>
      <header className="tabs">
        <button onClick={() => setTab("macros")}>Macros</button>
        <button onClick={() => setTab("settings")}>Settings</button>
      </header>

      {tab === "macros" ? (
        <main id="macrosTab" className="tab-panel">
          <div className="macro-topbar">
            <div className="macro-topbar-left">
              <span className="section-title">Hotkeys</span>
              <button disabled={!currentMacro || running} onClick={() => setPendingHotkeyField("toggle")}>{currentMacro?.toggle_key ? `Toggle: ${currentMacro.toggle_key}` : "Set Toggle Hotkey"}</button>
              <button disabled={!currentMacro || running} onClick={async () => await setMacroField("toggle_key", "")}>Remove Toggle</button>
              <button disabled={!currentMacro || running} onClick={() => setPendingHotkeyField("exit")}>{currentMacro?.exit_key ? `Exit: ${currentMacro.exit_key}` : "Set Exit Hotkey"}</button>
            </div>
            <div className="macro-topbar-right">
              <span className="section-title">Click Modes</span>
              <button
                className={`mode-btn ${settings.game_click_enabled ? "active" : ""}`}
                onClick={() => void (async () => {
                  const next = !settings.game_click_enabled;
                  if (!next && !settings.normal_click_enabled) {
                    return;
                  }
                  await saveSettings({ ...settings, game_click_enabled: next });
                })()}
              >
                Game Click
              </button>
              <button
                className={`mode-btn ${settings.normal_click_enabled ? "active" : ""}`}
                onClick={() => void (async () => {
                  const next = !settings.normal_click_enabled;
                  if (!next && !settings.game_click_enabled) {
                    return;
                  }
                  await saveSettings({ ...settings, normal_click_enabled: next });
                })()}
              >
                Normal Click
              </button>
            </div>
          </div>

          <div className="macro-layout">
            <aside className="macro-sidebar">
              <div className="section-title">Macro List</div>
              <ul className="macro-list">
                {macros.map((macro, i) => (
                  <li key={`${macro.name}-${i}`} className={i === selectedMacroIndex ? "selected" : ""} onClick={() => {
                    setSelectedMacroIndex(i);
                    setFocusedActionIndex(macro.actions.length ? 0 : -1);
                    setSelectedActionIndices(new Set());
                  }}>
                    {macro.name}
                  </li>
                ))}
              </ul>

              <label className="macro-name-field">
                Name
                <input
                  value={currentMacro?.name ?? ""}
                  disabled={!currentMacro || running}
                  onChange={async (e) => {
                    await setMacroField("name", e.target.value);
                  }}
                />
              </label>

              <div className="sidebar-buttons">
                <button disabled={!currentMacro} onClick={openCopyMacroDialog}>Copy Macro</button>
                <button onClick={openNewMacroDialog}>New Macro</button>
                <button onClick={async () => {
                  if (selectedMacroIndex < 0) return;
                  const next = [...macros];
                  next.splice(selectedMacroIndex, 1);
                  const newIndex = Math.min(selectedMacroIndex, next.length - 1);
                  setSelectedMacroIndex(newIndex);
                  setFocusedActionIndex(newIndex >= 0 && next[newIndex].actions.length > 0 ? 0 : -1);
                  setSelectedActionIndices(new Set());
                  await saveMacros(next);
                }}>Delete Macro</button>
              </div>
            </aside>

            <section className="macro-main">
              <div className="row gap action-toolbar">
                <button onClick={() => {
                  if (!currentMacro) return;
                  if (selectedActionIndices.size === currentMacro.actions.length) setSelectedActionIndices(new Set());
                  else setSelectedActionIndices(new Set(currentMacro.actions.map((_, i) => i)));
                }}>Check All</button>
                <button onClick={() => void copySelectedActions()}>Copy</button>
                <button onClick={() => void pasteActions()}>Paste</button>
                <button onClick={() => void removeSelectedActions()}>Remove</button>
                <button onClick={() => void moveFocused(-1)}>Move Up</button>
                <button onClick={() => void moveFocused(1)}>Move Down</button>
                <span className="muted">{totalActions} actions</span>
              </div>

              <div className="category-panel">
                <div className="row gap category-header">
                  <span className="section-title">Image Detection Category</span>
                  <button onClick={() => void addImageDetectionCategoryAction()}>Add Image Detection</button>
                  <span className="muted">Checks every 1 second while macro runs</span>
                </div>
                <div className="category-list">
                  {currentImageDetectionActions.length === 0 ? (
                    <div className="muted">No image detection category actions yet.</div>
                  ) : (
                    currentImageDetectionActions.map((detectionAction, categoryIndex) => (
                      <div key={`category-detect-${categoryIndex}`} className="category-row">
                        <input
                          className="image-file-input"
                          value={formatImageNamePreview(detectionAction.image_path || "")}
                          placeholder="captured image file"
                          readOnly
                          title={detectionAction.image_path || ""}
                        />
                        <button className="image-detect-screenshot-btn" onClick={() => void captureImageRegionForCategoryAction(categoryIndex)}>Screenshot</button>
                        <select
                          value={detectionAction.detect_action || "Keyboard"}
                          onChange={async (e) => await updateImageDetectionCategoryAt(categoryIndex, (a) => ({ ...a, detect_action: e.target.value as ActionType }))}
                        >
                          {DETECTION_ACTION_OPTIONS.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                        {(detectionAction.detect_action === "Mouse Move" || detectionAction.detect_action === "Mouse Click With Move") && (
                          <>
                            <input
                              className="mini"
                              type="number"
                              value={parseNumber(detectionAction.trigger_x ?? 0, 0)}
                              placeholder="X"
                              onChange={async (e) => await updateImageDetectionCategoryAt(categoryIndex, (a) => ({ ...a, trigger_x: parseNumber(e.target.value, 0) }))}
                            />
                            <input
                              className="mini"
                              type="number"
                              value={parseNumber(detectionAction.trigger_y ?? 0, 0)}
                              placeholder="Y"
                              onChange={async (e) => await updateImageDetectionCategoryAt(categoryIndex, (a) => ({ ...a, trigger_y: parseNumber(e.target.value, 0) }))}
                            />
                            <button className="mini click-point-btn" onClick={() => void setImageTriggerPointAtCategoryAction(categoryIndex)}>Click Point</button>
                          </>
                        )}
                        {(detectionAction.detect_action === "Mouse Click" || detectionAction.detect_action === "Mouse Click (No Move)" || detectionAction.detect_action === "Mouse Click With Move") && (
                          <select
                            value={detectionAction.click_type}
                            onChange={async (e) => await updateImageDetectionCategoryAt(categoryIndex, (a) => ({ ...a, click_type: e.target.value as "left" | "right" }))}
                          >
                            <option value="left">left</option>
                            <option value="right">right</option>
                          </select>
                        )}
                        {(detectionAction.detect_action === "Keyboard" || detectionAction.detect_action === "Keyboard Press" || detectionAction.detect_action === "Keyboard Release" || detectionAction.detect_action === "Open Link") && (
                          <input
                            className="mini wide"
                            value={detectionAction.key}
                            placeholder={detectionAction.detect_action === "Open Link" ? "url" : "key"}
                            onChange={async (e) => await updateImageDetectionCategoryAt(categoryIndex, (a) => ({ ...a, key: e.target.value }))}
                          />
                        )}
                        <label className="image-detect-threshold-label">
                          Match %
                          <input
                            className="mini"
                            type="number"
                            min="1"
                            max="100"
                            value={Math.max(1, Math.min(100, parseNumber(detectionAction.detect_threshold ?? 97, 97)))}
                            onChange={async (e) => await updateImageDetectionCategoryAt(categoryIndex, (a) => ({ ...a, detect_threshold: Math.max(1, Math.min(100, parseNumber(e.target.value, 97))) }))}
                          />
                        </label>
                        <button className="mini danger" onClick={() => void removeImageDetectionCategoryAt(categoryIndex)}>Remove</button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div ref={viewportRef} className="action-viewport" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
                <div style={{ height: `${totalActionHeight}px` }} />
                <div className="action-layer" style={{ transform: `translateY(${visibleStartOffset}px)` }}>
                  {visibleActions.map(({ index, action, height }) => (
                    <div
                      key={`${index}-${action.type}`}
                      className={`action-row ${selectedActionIndices.has(index) ? "selected" : ""}`}
                      style={{ height: `${height - 2}px` }}
                      onClick={(e) => {
                        setFocusedActionIndex(index);
                        if (e.ctrlKey || e.metaKey) {
                          const next = new Set(selectedActionIndices);
                          if (next.has(index)) {
                            next.delete(index);
                          } else {
                            next.add(index);
                          }
                          setSelectedActionIndices(next);
                          return;
                        }
                        setSelectedActionIndices(new Set([index]));
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedActionIndices.has(index)}
                        onChange={(e) => {
                          const next = new Set(selectedActionIndices);
                          if (e.target.checked) next.add(index);
                          else next.delete(index);
                          setSelectedActionIndices(next);
                          setFocusedActionIndex(index);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="idx">{index + 1}.</span>
                      <div
                        className={`action-inline ${action.type === "Image Detection" ? "image-detect-inline" : ""}`}
                        onMouseDown={(e) => {
                          const target = e.target as HTMLElement;
                          if (target.closest("input, select, button")) {
                            e.stopPropagation();
                          }
                        }}
                      >
                        {action.type !== "Image Detection" && (
                          <select
                            value={action.type}
                            onChange={async (e) => {
                              await updateActionAt(index, (a) => ({ ...a, type: e.target.value }));
                            }}
                          >
                            {ACTION_TYPES.map((type) => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        )}

                        {(["Mouse Click With Move", "Mouse Move", "Relative Mouse Move"] as string[]).includes(action.type) && (
                          <>
                            <input
                              className="mini"
                              type="number"
                              value={action.x}
                              onChange={async (e) => await updateActionAt(index, (a) => ({ ...a, x: parseNumber(e.target.value, 0) }))}
                            />
                            <input
                              className="mini"
                              type="number"
                              value={action.y}
                              onChange={async (e) => await updateActionAt(index, (a) => ({ ...a, y: parseNumber(e.target.value, 0) }))}
                            />
                            <button className="mini click-point-btn" onClick={() => void setActionAtClickPoint(index)}>Click Point</button>
                          </>
                        )}

                        {["Keyboard", "Keyboard Press", "Keyboard Release", "Open Link"].includes(action.type) && (
                          <input
                            className="mini wide"
                            value={action.key}
                            onChange={async (e) => await updateActionAt(index, (a) => ({ ...a, key: e.target.value }))}
                          />
                        )}

                        {["Mouse Click", "Mouse Click (No Move)", "Mouse Click With Move", "Mouse Press", "Mouse Release"].includes(action.type) && (
                          <>
                            <select
                              value={action.click_type}
                              onChange={async (e) => await updateActionAt(index, (a) => ({ ...a, click_type: e.target.value as "left" | "right" }))}
                            >
                              <option value="left">left</option>
                              <option value="right">right</option>
                            </select>
                          </>
                        )}

                        {action.type === "Image Detection" && (
                          <div className="image-detect-editor">
                            <div className="image-detect-row">
                              <select
                                value={action.type}
                                onChange={async (e) => {
                                  await updateActionAt(index, (a) => ({ ...a, type: e.target.value }));
                                }}
                              >
                                {ACTION_TYPES.map((type) => (
                                  <option key={type} value={type}>{type}</option>
                                ))}
                              </select>
                              <input
                                className="image-file-input"
                                value={formatImageNamePreview(action.image_path || "")}
                                placeholder="captured image file"
                                readOnly
                                title={action.image_path || ""}
                              />
                              <button className="image-detect-screenshot-btn" onClick={() => void captureImageRegionForAction(index)}>Screenshot</button>
                            </div>
                            <div className="image-detect-row image-detect-row-bottom">
                              <select
                                value={action.detect_action || "Keyboard"}
                                onChange={async (e) => await updateActionAt(index, (a) => ({ ...a, detect_action: e.target.value as ActionType }))}
                              >
                                {DETECTION_ACTION_OPTIONS.map((type) => (
                                  <option key={type} value={type}>{type}</option>
                                ))}
                              </select>
                              {(action.detect_action === "Mouse Move" || action.detect_action === "Mouse Click With Move") && (
                                <>
                                  <input
                                    className="mini"
                                    type="number"
                                    value={parseNumber(action.trigger_x ?? 0, 0)}
                                    placeholder="X"
                                    onChange={async (e) => await updateActionAt(index, (a) => ({ ...a, trigger_x: parseNumber(e.target.value, 0) }))}
                                  />
                                  <input
                                    className="mini"
                                    type="number"
                                    value={parseNumber(action.trigger_y ?? 0, 0)}
                                    placeholder="Y"
                                    onChange={async (e) => await updateActionAt(index, (a) => ({ ...a, trigger_y: parseNumber(e.target.value, 0) }))}
                                  />
                                  <button className="mini click-point-btn" onClick={() => void setImageTriggerPointAtAction(index)}>Click Point</button>
                                </>
                              )}
                              {(action.detect_action === "Mouse Click" || action.detect_action === "Mouse Click (No Move)" || action.detect_action === "Mouse Click With Move") && (
                                <select
                                  value={action.click_type}
                                  onChange={async (e) => await updateActionAt(index, (a) => ({ ...a, click_type: e.target.value as "left" | "right" }))}
                                >
                                  <option value="left">left</option>
                                  <option value="right">right</option>
                                </select>
                              )}
                              {(action.detect_action === "Keyboard" || action.detect_action === "Keyboard Press" || action.detect_action === "Keyboard Release" || action.detect_action === "Open Link") && (
                                <input
                                  className="mini wide"
                                  value={action.key}
                                  placeholder={action.detect_action === "Open Link" ? "url" : "key"}
                                  onChange={async (e) => await updateActionAt(index, (a) => ({ ...a, key: e.target.value }))}
                                />
                              )}
                              <label className="image-detect-threshold-label">
                                Match %
                                <input
                                  className="mini"
                                  type="number"
                                  min="1"
                                  max="100"
                                  title="Match percentage threshold"
                                  value={Math.max(1, Math.min(100, parseNumber(action.detect_threshold ?? 97, 97)))}
                                  onChange={async (e) => await updateActionAt(index, (a) => ({ ...a, detect_threshold: Math.max(1, Math.min(100, parseNumber(e.target.value, 97))) }))}
                                />
                              </label>
                            </div>
                          </div>
                        )}

                        {action.type === "Scroll" && (
                          <input
                            className="mini"
                            type="number"
                            value={action.scroll}
                            onChange={async (e) => await updateActionAt(index, (a) => ({ ...a, scroll: parseNumber(e.target.value, 1) }))}
                          />
                        )}

                        {action.type === "Delay" && (
                          <>
                            <input
                              className="mini"
                              type="number"
                              value={action.delay}
                              onChange={async (e) => await updateActionAt(index, (a) => ({ ...a, delay: Math.max(0, parseNumber(e.target.value, 0)) }))}
                            />
                            <select
                              value={action.delay_unit}
                              onChange={async (e) => await updateActionAt(index, (a) => ({ ...a, delay_unit: e.target.value as DelayUnit }))}
                            >
                              <option value="ms">ms</option>
                              <option value="min">min</option>
                            </select>
                          </>
                        )}

                        <button className="mini danger action-remove-btn" onClick={async () => await removeActionAt(index)}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="action-bottom">
                <div>
                  <div className="section-title">Add Actions</div>
                  <div className="action-groups">
                    {ACTION_GROUPS.map((group) => (
                      <div key={group.label} className="action-group">
                        <div className="action-group-title">{group.label}</div>
                        <div className="action-grid">
                          {group.types.map((type) => (
                            <button key={type} onClick={() => void addAction(type)}>{type}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="new-action-settings">
                  <div className="section-title">New Action Settings</div>
                  <label>
                    <input type="checkbox" checked={autoDelayEnabled} onChange={(e) => setAutoDelayEnabled(e.target.checked)} />
                    Add delay after action
                  </label>
                  <div className="row gap">
                    <label>
                      Delay <input type="number" min="0" value={autoDelayAmount} onChange={(e) => setAutoDelayAmount(e.target.value)} />
                    </label>
                    <label>
                      Unit
                      <select value={autoDelayUnit} onChange={(e) => setAutoDelayUnit(e.target.value as DelayUnit)}>
                        <option value="ms">ms</option>
                        <option value="min">min</option>
                      </select>
                    </label>
                  </div>
                  <div className="row gap">
                    <button onClick={() => {
                      setAutoDelayAmount("10");
                      setAutoDelayUnit("ms");
                    }}>Quick 10ms</button>
                    <button onClick={() => {
                      setAutoDelayAmount("1");
                      setAutoDelayUnit("min");
                    }}>Quick 1min</button>
                  </div>
                </div>
              </div>

              <div className="row gap loop-controls">
                <label>
                  Loop Delay (ms)
                  <input
                    type="number"
                    min="0"
                    value={currentMacro?.loop_delay ?? 0}
                    disabled={!currentMacro || running}
                    onChange={async (e) => await setMacroField("loop_delay", Math.max(0, parseNumber(e.target.value, 0)))}
                  />
                </label>
                <label>
                  Loop Count (0=inf)
                  <input
                    type="number"
                    min="0"
                    value={currentMacro?.loop_count ?? 1}
                    disabled={!currentMacro || running}
                    onChange={async (e) => await setMacroField("loop_count", Math.max(0, parseNumber(e.target.value, 1)))}
                  />
                </label>
                <label>
                  Speed
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={currentMacro?.speed_multiplier ?? 1}
                    disabled={!currentMacro || running}
                    onChange={async (e) => await setMacroField("speed_multiplier", Math.max(1, parseNumber(e.target.value, 1)))}
                  />
                </label>
              </div>

              <button className="start-stop-btn" onClick={() => void toggleMacroRun()}>{running ? "Stop Macro" : "Start Macro"}</button>
            </section>
          </div>
        </main>
      ) : (
        <main id="settingsTab" className="tab-panel">
          <section className="settings-wrap">
            <div className="section-title">Theme</div>
            <div className="row gap">
              <label>
                Mode
                <select
                  value={settings.ui_theme}
                  onChange={async (e) => {
                    const mode = e.target.value as ThemeMode;
                    const next: AppSettings =
                      mode === "dark"
                        ? {
                            ...settings,
                            ui_theme: "dark",
                            background_color: "#141414",
                            text_color: "#f2f2f2",
                            outline_color: "#7a7a7a",
                            button_color: "#1a1a1a"
                          }
                        : {
                            ...settings,
                            ui_theme: "light",
                            background_color: "#ffffff",
                            text_color: "#000000",
                            outline_color: "#000000",
                            button_color: "#ffffff"
                          };
                    await saveSettings(next);
                  }}
                >
                  <option value="dark">Dark (very dark grey)</option>
                  <option value="light">Light</option>
                </select>
              </label>
              <label>
                <input type="checkbox" checked={settings.global_hotkeys} onChange={async (e) => await saveSettings({ ...settings, global_hotkeys: e.target.checked })} /> Enable global hotkeys
              </label>
            </div>

            <div className="section-title">Monitor Conversion</div>
            <div className="row gap">
              <label>Current W <input type="number" min="1" value={currentWidth} onChange={(e) => setCurrentWidth(e.target.value)} /></label>
              <label>Current H <input type="number" min="1" value={currentHeight} onChange={(e) => setCurrentHeight(e.target.value)} /></label>
              <label>Target W <input type="number" min="1" value={targetWidth} onChange={(e) => setTargetWidth(e.target.value)} /></label>
              <label>Target H <input type="number" min="1" value={targetHeight} onChange={(e) => setTargetHeight(e.target.value)} /></label>
              <button onClick={() => {
                setCurrentWidth(String(window.screen.width));
                setCurrentHeight(String(window.screen.height));
              }}>Auto Detect</button>
            </div>
            <div className="row gap">
              <label>
                <input type="checkbox" checked={roundCoordinates} onChange={(e) => setRoundCoordinates(e.target.checked)} /> Round coordinates
              </label>
              <button onClick={() => void convertCoordinates(true)}>Preview Conversion</button>
              <button onClick={() => void convertCoordinates(false)}>Convert All Macros</button>
            </div>

            <div className="section-title">Data File</div>
            <p className="muted">Using macro file: {macroFilePath}</p>
            <p className="muted">Image captures folder: {imagesDirPath || "(loading...)"}</p>
          </section>
        </main>
      )}

      {nameDialog && (
        <div className="modal-backdrop" onClick={() => setNameDialog(null)}>
          <form
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              await submitNameDialog();
            }}
          >
            <div className="section-title">{nameDialog.mode === "copy" ? "Copy Macro" : "New Macro"}</div>
            <label className="field">
              <span>Macro Name</span>
              <input
                ref={nameInputRef}
                value={nameDialog.value}
                onChange={(e) => setNameDialog({ ...nameDialog, value: e.target.value })}
              />
            </label>
            <div className="row gap modal-actions">
              <button type="submit">Save</button>
              <button type="button" onClick={() => setNameDialog(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <footer className="statusbar">
        <span>{pendingHotkeyField ? "Press any key..." : status}</span>
      </footer>
    </div>
  );
}
