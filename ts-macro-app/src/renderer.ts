import type { Action, ActionType, AppSettings, InitialPayload, Macro } from "./types.js";

declare global {
  interface Window {
    macroApi: {
      getInitialData: () => Promise<InitialPayload>;
      saveMacros: (macros: Macro[]) => Promise<void>;
      saveSettings: (settings: AppSettings) => Promise<void>;
      startMacro: (macro: Macro, settings?: AppSettings) => Promise<void>;
      stopMacro: () => Promise<void>;
      writeClipboard: (text: string) => Promise<void>;
      readClipboard: () => Promise<string>;
      onRunnerState: (handler: (state: { running: boolean; name: string }) => void) => void;
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
  "Open Link"
];

const state: {
  macros: Macro[];
  settings: AppSettings;
  macroFilePath: string;
  selectedMacroIndex: number;
  selectedActionIndices: Set<number>;
  focusedActionIndex: number;
  running: boolean;
  runningMacroName: string;
  pendingHotkeyField: "toggle" | "exit" | null;
} = {
  macros: [],
  settings: {
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
  },
  macroFilePath: "",
  selectedMacroIndex: -1,
  selectedActionIndices: new Set<number>(),
  focusedActionIndex: -1,
  running: false,
  runningMacroName: "",
  pendingHotkeyField: null
};

function currentMacro(): Macro | null {
  if (state.selectedMacroIndex < 0 || state.selectedMacroIndex >= state.macros.length) {
    return null;
  }
  return state.macros[state.selectedMacroIndex];
}

function makeAction(type: ActionType): Action {
  return {
    type,
    x: 0,
    y: 0,
    key: "",
    click_type: "left",
    delay: type === "Mouse Click With Move" ? 25 : 0,
    scroll: 1,
    delay_unit: "ms"
  };
}

function parseNumber(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applyTheme(): void {
  document.documentElement.setAttribute("data-theme", state.settings.ui_theme);
}

async function saveMacros(): Promise<void> {
  await window.macroApi.saveMacros(state.macros);
}

async function saveSettings(): Promise<void> {
  await window.macroApi.saveSettings(state.settings);
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
    default:
      return action.type;
  }
}

function setStatus(text: string): void {
  const status = document.getElementById("statusText");
  if (status) {
    status.textContent = text;
  }
}

function renderMacroList(): void {
  const list = document.getElementById("macroList") as HTMLUListElement;
  const macro = currentMacro();
  list.innerHTML = "";

  state.macros.forEach((m, i) => {
    const item = document.createElement("li");
    item.className = i === state.selectedMacroIndex ? "selected" : "";
    item.textContent = m.name;
    item.onclick = () => {
      state.selectedMacroIndex = i;
      state.selectedActionIndices.clear();
      state.focusedActionIndex = m.actions.length ? 0 : -1;
      renderAll();
    };
    list.appendChild(item);
  });

  const macroName = document.getElementById("macroName") as HTMLInputElement;
  macroName.value = macro?.name ?? "";
}

function renderMacroControls(): void {
  const macro = currentMacro();
  const disabled = !macro || state.running;

  (document.getElementById("loopDelay") as HTMLInputElement).value = String(macro?.loop_delay ?? 0);
  (document.getElementById("loopCount") as HTMLInputElement).value = String(macro?.loop_count ?? 1);
  (document.getElementById("speedMultiplier") as HTMLInputElement).value = String(macro?.speed_multiplier ?? 1);

  (document.getElementById("toggleHotkeyBtn") as HTMLButtonElement).textContent =
    macro?.toggle_key ? `Toggle: ${macro.toggle_key}` : "Set Toggle Hotkey";
  (document.getElementById("exitHotkeyBtn") as HTMLButtonElement).textContent =
    macro?.exit_key ? `Exit: ${macro.exit_key}` : "Set Exit Hotkey";

  const fields = ["loopDelay", "loopCount", "speedMultiplier", "macroName"];
  for (const id of fields) {
    const el = document.getElementById(id) as HTMLInputElement;
    el.disabled = disabled;
  }

  (document.getElementById("startStopBtn") as HTMLButtonElement).textContent = state.running ? "Stop Macro" : "Start Macro";
}

const ROW_HEIGHT = 34;

function renderActionList(): void {
  const macro = currentMacro();
  const viewport = document.getElementById("actionViewport") as HTMLDivElement;
  const spacer = document.getElementById("actionSpacer") as HTMLDivElement;
  const layer = document.getElementById("actionLayer") as HTMLDivElement;

  if (!macro) {
    spacer.style.height = "0px";
    layer.innerHTML = "";
    return;
  }

  const total = macro.actions.length;
  spacer.style.height = `${total * ROW_HEIGHT}px`;

  const scrollTop = viewport.scrollTop;
  const viewportRows = Math.ceil(viewport.clientHeight / ROW_HEIGHT);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
  const end = Math.min(total, start + viewportRows + 20);

  layer.innerHTML = "";
  layer.style.transform = `translateY(${start * ROW_HEIGHT}px)`;

  for (let i = start; i < end; i += 1) {
    const action = macro.actions[i];
    const row = document.createElement("div");
    row.className = "action-row";
    if (state.selectedActionIndices.has(i)) {
      row.classList.add("selected");
    }
    row.style.height = `${ROW_HEIGHT - 2}px`;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = state.selectedActionIndices.has(i);
    check.onclick = (event) => {
      event.stopPropagation();
      if (check.checked) {
        state.selectedActionIndices.add(i);
      } else {
        state.selectedActionIndices.delete(i);
      }
      state.focusedActionIndex = i;
      renderActionEditor();
    };

    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = `${i + 1}.`;

    const typ = document.createElement("span");
    typ.className = "type";
    typ.textContent = action.type;

    const summary = document.createElement("span");
    summary.className = "summary";
    summary.textContent = actionSummary(action);

    row.appendChild(check);
    row.appendChild(idx);
    row.appendChild(typ);
    row.appendChild(summary);

    row.onclick = () => {
      if (!state.selectedActionIndices.has(i)) {
        state.selectedActionIndices.clear();
        state.selectedActionIndices.add(i);
      }
      state.focusedActionIndex = i;
      renderActionList();
      renderActionEditor();
    };

    layer.appendChild(row);
  }

  (document.getElementById("actionCount") as HTMLSpanElement).textContent = `${total} actions`;
}

function renderActionEditor(): void {
  const macro = currentMacro();
  const panel = document.getElementById("actionEditor") as HTMLDivElement;
  panel.innerHTML = "";

  if (!macro || state.focusedActionIndex < 0 || state.focusedActionIndex >= macro.actions.length) {
    panel.innerHTML = "<p>Select an action to edit.</p>";
    return;
  }

  const action = macro.actions[state.focusedActionIndex];

  const fields = document.createElement("div");
  fields.className = "editor-fields";

  const mkInput = (label: string, value: string, onChange: (v: string) => void, type = "text") => {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const title = document.createElement("span");
    title.textContent = label;
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    input.oninput = () => onChange(input.value);
    wrap.appendChild(title);
    wrap.appendChild(input);
    return wrap;
  };

  const typeField = document.createElement("label");
  typeField.className = "field";
  const typeTitle = document.createElement("span");
  typeTitle.textContent = "Type";
  const typeSelect = document.createElement("select");
  ACTION_TYPES.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    if (action.type === t) {
      opt.selected = true;
    }
    typeSelect.appendChild(opt);
  });
  typeSelect.onchange = async () => {
    action.type = typeSelect.value;
    renderActionList();
    renderActionEditor();
    await saveMacros();
  };
  typeField.appendChild(typeTitle);
  typeField.appendChild(typeSelect);
  fields.appendChild(typeField);

  const updateAndSave = async (): Promise<void> => {
    renderActionList();
    await saveMacros();
  };

  const addMouseFields = action.type.includes("Mouse") || action.type === "Relative Mouse Move";
  if (addMouseFields) {
    fields.appendChild(
      mkInput("X", String(action.x), async (v) => {
        action.x = parseNumber(v, 0);
        await updateAndSave();
      }, "number")
    );
    fields.appendChild(
      mkInput("Y", String(action.y), async (v) => {
        action.y = parseNumber(v, 0);
        await updateAndSave();
      }, "number")
    );
  }

  if (["Keyboard", "Keyboard Press", "Keyboard Release", "Open Link"].includes(action.type)) {
    fields.appendChild(
      mkInput(action.type === "Open Link" ? "URL" : "Key", action.key, async (v) => {
        action.key = v;
        await updateAndSave();
      })
    );
  }

  if (["Mouse Click", "Mouse Click (No Move)", "Mouse Click With Move"].includes(action.type)) {
    const clickTypeField = document.createElement("label");
    clickTypeField.className = "field";
    const t = document.createElement("span");
    t.textContent = "Click";
    const s = document.createElement("select");
    ["left", "right"].forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      opt.selected = action.click_type === v;
      s.appendChild(opt);
    });
    s.onchange = async () => {
      action.click_type = s.value as "left" | "right";
      await updateAndSave();
    };
    clickTypeField.appendChild(t);
    clickTypeField.appendChild(s);
    fields.appendChild(clickTypeField);
  }

  if (action.type === "Scroll") {
    fields.appendChild(
      mkInput("Amount", String(action.scroll), async (v) => {
        action.scroll = parseNumber(v, 1);
        await updateAndSave();
      }, "number")
    );
  }

  if (action.type === "Delay") {
    fields.appendChild(
      mkInput("Delay", String(action.delay), async (v) => {
        action.delay = Math.max(0, parseNumber(v, 0));
        await updateAndSave();
      }, "number")
    );

    const unitField = document.createElement("label");
    unitField.className = "field";
    const t = document.createElement("span");
    t.textContent = "Unit";
    const s = document.createElement("select");
    ["ms", "min"].forEach((unit) => {
      const opt = document.createElement("option");
      opt.value = unit;
      opt.textContent = unit;
      opt.selected = action.delay_unit === unit;
      s.appendChild(opt);
    });
    s.onchange = async () => {
      action.delay_unit = s.value as "ms" | "min";
      await updateAndSave();
    };
    unitField.appendChild(t);
    unitField.appendChild(s);
    fields.appendChild(unitField);
  }

  panel.appendChild(fields);
}

function renderSettings(): void {
  (document.getElementById("themeSelect") as HTMLSelectElement).value = state.settings.ui_theme;
  (document.getElementById("globalHotkeys") as HTMLInputElement).checked = state.settings.global_hotkeys;
  (document.getElementById("dataPath") as HTMLSpanElement).textContent = state.macroFilePath;
}

function renderAll(): void {
  applyTheme();
  renderMacroList();
  renderMacroControls();
  renderActionList();
  renderActionEditor();
  renderSettings();
}

function bindUI(): void {
  const macroViewport = document.getElementById("actionViewport") as HTMLDivElement;
  macroViewport.onscroll = () => renderActionList();

  const gameClickModeBtn = document.getElementById("gameClickModeBtn") as HTMLButtonElement;
  const normalClickModeBtn = document.getElementById("normalClickModeBtn") as HTMLButtonElement;
  const syncClickModeButtons = () => {
    gameClickModeBtn.classList.toggle("active", gameClickModeBtn.dataset.enabled === "1");
    normalClickModeBtn.classList.toggle("active", normalClickModeBtn.dataset.enabled === "1");
  };
  gameClickModeBtn.dataset.enabled = "1";
  normalClickModeBtn.dataset.enabled = "1";
  syncClickModeButtons();

  gameClickModeBtn.onclick = () => {
    gameClickModeBtn.dataset.enabled = gameClickModeBtn.dataset.enabled === "1" ? "0" : "1";
    if (gameClickModeBtn.dataset.enabled !== "1" && normalClickModeBtn.dataset.enabled !== "1") {
      gameClickModeBtn.dataset.enabled = "1";
    }
    syncClickModeButtons();
  };

  normalClickModeBtn.onclick = () => {
    normalClickModeBtn.dataset.enabled = normalClickModeBtn.dataset.enabled === "1" ? "0" : "1";
    if (gameClickModeBtn.dataset.enabled !== "1" && normalClickModeBtn.dataset.enabled !== "1") {
      normalClickModeBtn.dataset.enabled = "1";
    }
    syncClickModeButtons();
  };

  (document.getElementById("tabMacros") as HTMLButtonElement).onclick = () => {
    document.getElementById("macrosTab")?.classList.remove("hidden");
    document.getElementById("settingsTab")?.classList.add("hidden");
  };

  (document.getElementById("tabSettings") as HTMLButtonElement).onclick = () => {
    document.getElementById("macrosTab")?.classList.add("hidden");
    document.getElementById("settingsTab")?.classList.remove("hidden");
  };

  (document.getElementById("newMacroBtn") as HTMLButtonElement).onclick = async () => {
    const name = prompt("Enter new macro name");
    if (!name) {
      return;
    }
    state.macros.push({
      name,
      loop_delay: 5,
      loop_count: 1,
      toggle_key: "",
      exit_key: "",
      speed_multiplier: 1,
      actions: []
    });
    state.selectedMacroIndex = state.macros.length - 1;
    state.focusedActionIndex = -1;
    await saveMacros();
    renderAll();
  };

  (document.getElementById("copyMacroBtn") as HTMLButtonElement).onclick = async () => {
    const macro = currentMacro();
    if (!macro) {
      return;
    }
    const name = prompt("Enter copied macro name", `Copy of ${macro.name}`);
    if (!name) {
      return;
    }
    const clone: Macro = JSON.parse(JSON.stringify(macro));
    clone.name = name;
    clone.toggle_key = "";
    clone.exit_key = "";
    state.macros.push(clone);
    state.selectedMacroIndex = state.macros.length - 1;
    await saveMacros();
    renderAll();
  };

  (document.getElementById("deleteMacroBtn") as HTMLButtonElement).onclick = async () => {
    if (state.selectedMacroIndex < 0) {
      return;
    }
    state.macros.splice(state.selectedMacroIndex, 1);
    state.selectedMacroIndex = Math.min(state.selectedMacroIndex, state.macros.length - 1);
    state.selectedActionIndices.clear();
    state.focusedActionIndex = -1;
    await saveMacros();
    renderAll();
  };

  (document.getElementById("macroName") as HTMLInputElement).oninput = async (e) => {
    const macro = currentMacro();
    if (!macro) {
      return;
    }
    macro.name = (e.target as HTMLInputElement).value;
    await saveMacros();
    renderMacroList();
  };

  (document.getElementById("loopDelay") as HTMLInputElement).oninput = async (e) => {
    const macro = currentMacro();
    if (!macro) {
      return;
    }
    macro.loop_delay = Math.max(0, parseNumber((e.target as HTMLInputElement).value, macro.loop_delay));
    await saveMacros();
  };

  (document.getElementById("loopCount") as HTMLInputElement).oninput = async (e) => {
    const macro = currentMacro();
    if (!macro) {
      return;
    }
    macro.loop_count = Math.max(0, parseNumber((e.target as HTMLInputElement).value, macro.loop_count));
    await saveMacros();
  };

  (document.getElementById("speedMultiplier") as HTMLInputElement).oninput = async (e) => {
    const macro = currentMacro();
    if (!macro) {
      return;
    }
    macro.speed_multiplier = Math.max(1, parseNumber((e.target as HTMLInputElement).value, 1));
    await saveMacros();
  };

  const addButtons = document.querySelectorAll<HTMLButtonElement>("[data-action-type]");
  addButtons.forEach((button) => {
    button.onclick = async () => {
      const macro = currentMacro();
      if (!macro) {
        return;
      }
      const actionType = button.dataset.actionType as ActionType;
      const baseInsertIndex = state.focusedActionIndex >= 0 ? state.focusedActionIndex + 1 : macro.actions.length;
      const autoDelayEnabled = (document.getElementById("autoDelayEnabled") as HTMLInputElement).checked;
      const autoDelayValue = parseNumber((document.getElementById("autoDelayAmount") as HTMLInputElement).value, 0);
      const autoDelayUnit = (document.getElementById("autoDelayUnit") as HTMLSelectElement).value as "ms" | "min";

      const toInsert: Action[] = [];
      if (actionType === "Mouse Click With Move") {
        toInsert.push(makeAction("Mouse Move"));
        toInsert.push({ ...makeAction("Delay"), delay: 50, delay_unit: "ms" });
        toInsert.push(makeAction("Mouse Click"));
      } else {
        toInsert.push(makeAction(actionType));
      }

      if (autoDelayEnabled && autoDelayValue > 0) {
        toInsert.push({ ...makeAction("Delay"), delay: autoDelayValue, delay_unit: autoDelayUnit });
      }

      macro.actions.splice(baseInsertIndex, 0, ...toInsert);
      state.focusedActionIndex = baseInsertIndex;
      state.selectedActionIndices.clear();
      state.selectedActionIndices.add(baseInsertIndex);
      await saveMacros();
      renderAll();
      setStatus(`Added ${toInsert.length} action(s)`);
    };
  });

  (document.getElementById("removeActionBtn") as HTMLButtonElement).onclick = async () => {
    const macro = currentMacro();
    if (!macro) {
      return;
    }
    const indices = [...state.selectedActionIndices].sort((a, b) => b - a);
    if (!indices.length && state.focusedActionIndex >= 0) {
      indices.push(state.focusedActionIndex);
    }
    if (!indices.length) {
      return;
    }
    for (const idx of indices) {
      if (idx >= 0 && idx < macro.actions.length) {
        macro.actions.splice(idx, 1);
      }
    }
    state.selectedActionIndices.clear();
    state.focusedActionIndex = Math.min(macro.actions.length - 1, state.focusedActionIndex);
    await saveMacros();
    renderAll();
  };

  (document.getElementById("moveUpBtn") as HTMLButtonElement).onclick = async () => {
    const macro = currentMacro();
    if (!macro || state.focusedActionIndex <= 0) {
      return;
    }
    const i = state.focusedActionIndex;
    [macro.actions[i - 1], macro.actions[i]] = [macro.actions[i], macro.actions[i - 1]];
    state.focusedActionIndex = i - 1;
    state.selectedActionIndices.clear();
    state.selectedActionIndices.add(state.focusedActionIndex);
    await saveMacros();
    renderAll();
  };

  (document.getElementById("moveDownBtn") as HTMLButtonElement).onclick = async () => {
    const macro = currentMacro();
    if (!macro || state.focusedActionIndex < 0 || state.focusedActionIndex >= macro.actions.length - 1) {
      return;
    }
    const i = state.focusedActionIndex;
    [macro.actions[i], macro.actions[i + 1]] = [macro.actions[i + 1], macro.actions[i]];
    state.focusedActionIndex = i + 1;
    state.selectedActionIndices.clear();
    state.selectedActionIndices.add(state.focusedActionIndex);
    await saveMacros();
    renderAll();
  };

  (document.getElementById("checkAllBtn") as HTMLButtonElement).onclick = () => {
    const macro = currentMacro();
    if (!macro) {
      return;
    }
    if (state.selectedActionIndices.size === macro.actions.length) {
      state.selectedActionIndices.clear();
    } else {
      state.selectedActionIndices = new Set(macro.actions.map((_, i) => i));
    }
    renderActionList();
  };

  (document.getElementById("copyActionBtn") as HTMLButtonElement).onclick = async () => {
    const macro = currentMacro();
    if (!macro) {
      return;
    }
    const selected = [...state.selectedActionIndices].sort((a, b) => a - b);
    const actions = selected.length
      ? selected.map((i) => macro.actions[i])
      : state.focusedActionIndex >= 0
        ? [macro.actions[state.focusedActionIndex]]
        : [];
    if (!actions.length) {
      setStatus("No actions selected.");
      return;
    }
    await window.macroApi.writeClipboard(JSON.stringify(actions));
    setStatus(`Copied ${actions.length} action(s).`);
  };

  (document.getElementById("pasteActionBtn") as HTMLButtonElement).onclick = async () => {
    const macro = currentMacro();
    if (!macro) {
      return;
    }
    try {
      const text = await window.macroApi.readClipboard();
      const parsed = JSON.parse(text) as Action[];
      if (!Array.isArray(parsed)) {
        return;
      }
      const insertAt = state.focusedActionIndex >= 0 ? state.focusedActionIndex + 1 : macro.actions.length;
      const normalized = parsed.map((a) => ({
        ...makeAction((a.type as ActionType) || "Mouse Click"),
        ...a
      }));
      macro.actions.splice(insertAt, 0, ...normalized);
      state.focusedActionIndex = insertAt;
      state.selectedActionIndices.clear();
      state.selectedActionIndices.add(insertAt);
      await saveMacros();
      renderAll();
      setStatus(`Pasted ${normalized.length} action(s).`);
    } catch {
      setStatus("Clipboard does not contain valid action JSON.");
    }
  };

  (document.getElementById("toggleHotkeyBtn") as HTMLButtonElement).onclick = () => {
    if (!currentMacro() || state.running) {
      return;
    }
    state.pendingHotkeyField = "toggle";
    setStatus("Press any key for toggle hotkey...");
  };

  (document.getElementById("exitHotkeyBtn") as HTMLButtonElement).onclick = () => {
    if (!currentMacro() || state.running) {
      return;
    }
    state.pendingHotkeyField = "exit";
    setStatus("Press any key for exit hotkey...");
  };

  (document.getElementById("removeToggleHotkeyBtn") as HTMLButtonElement).onclick = async () => {
    const macro = currentMacro();
    if (!macro || state.running) {
      return;
    }
    macro.toggle_key = "";
    await saveMacros();
    renderMacroControls();
  };

  document.addEventListener("keydown", async (event) => {
    if (!state.pendingHotkeyField) {
      return;
    }
    event.preventDefault();
    const macro = currentMacro();
    if (!macro) {
      return;
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
    if (state.pendingHotkeyField === "toggle") {
      for (const m of state.macros) {
        if (m !== macro && m.toggle_key === key) {
          m.toggle_key = "";
        }
      }
      macro.toggle_key = key;
    } else {
      macro.exit_key = key;
    }
    state.pendingHotkeyField = null;
    await saveMacros();
    renderMacroControls();
    setStatus(`Set hotkey: ${key}`);
  });

  (document.getElementById("startStopBtn") as HTMLButtonElement).onclick = async () => {
    const macro = currentMacro();
    if (!macro) {
      return;
    }
    if (state.running) {
      await window.macroApi.stopMacro();
      return;
    }
    await window.macroApi.startMacro(macro);
  };

  (document.getElementById("themeSelect") as HTMLSelectElement).onchange = async (e) => {
    const value = (e.target as HTMLSelectElement).value as "dark" | "light";
    state.settings.ui_theme = value;
    if (value === "dark") {
      state.settings.background_color = "#141414";
      state.settings.text_color = "#f2f2f2";
      state.settings.outline_color = "#7a7a7a";
      state.settings.button_color = "#1a1a1a";
    } else {
      state.settings.background_color = "#ffffff";
      state.settings.text_color = "#000000";
      state.settings.outline_color = "#000000";
      state.settings.button_color = "#ffffff";
    }
    applyTheme();
    await saveSettings();
  };

  (document.getElementById("globalHotkeys") as HTMLInputElement).onchange = async (e) => {
    state.settings.global_hotkeys = (e.target as HTMLInputElement).checked;
    await saveSettings();
  };

  (document.getElementById("setQuickDelayMs") as HTMLButtonElement).onclick = () => {
    (document.getElementById("autoDelayAmount") as HTMLInputElement).value = "10";
    (document.getElementById("autoDelayUnit") as HTMLSelectElement).value = "ms";
  };

  (document.getElementById("setQuickDelayMin") as HTMLButtonElement).onclick = () => {
    (document.getElementById("autoDelayAmount") as HTMLInputElement).value = "1";
    (document.getElementById("autoDelayUnit") as HTMLSelectElement).value = "min";
  };

  (document.getElementById("autoDetectMonitor") as HTMLButtonElement).onclick = () => {
    (document.getElementById("currentWidth") as HTMLInputElement).value = String(window.screen.width);
    (document.getElementById("currentHeight") as HTMLInputElement).value = String(window.screen.height);
  };

  const runConversion = async (previewOnly: boolean) => {
    const cw = parseNumber((document.getElementById("currentWidth") as HTMLInputElement).value, 0);
    const ch = parseNumber((document.getElementById("currentHeight") as HTMLInputElement).value, 0);
    const tw = parseNumber((document.getElementById("targetWidth") as HTMLInputElement).value, 0);
    const th = parseNumber((document.getElementById("targetHeight") as HTMLInputElement).value, 0);

    if (cw <= 0 || ch <= 0 || tw <= 0 || th <= 0) {
      setStatus("Invalid monitor dimensions.");
      return;
    }
    if (cw === tw && ch === th) {
      setStatus("Current and target monitor sizes are the same.");
      return;
    }

    let converted = 0;
    let affectedMacros = 0;
    const round = (document.getElementById("roundCoordinates") as HTMLInputElement).checked;

    for (const macro of state.macros) {
      let macroChanged = false;
      for (const action of macro.actions) {
        const canConvert = ["Mouse Click With Move", "Mouse Move", "Mouse Click", "Mouse Click (No Move)"].includes(action.type);
        if (!canConvert) {
          continue;
        }
        const nxRaw = (action.x * tw) / cw;
        const nyRaw = (action.y * th) / ch;
        const nx = Math.max(0, Math.min(tw - 1, round ? Math.round(nxRaw) : nxRaw));
        const ny = Math.max(0, Math.min(th - 1, round ? Math.round(nyRaw) : nyRaw));
        if (nx !== action.x || ny !== action.y) {
          if (!previewOnly) {
            action.x = nx;
            action.y = ny;
          }
          converted += 1;
          macroChanged = true;
        }
      }
      if (macroChanged) {
        affectedMacros += 1;
      }
    }

    if (!previewOnly && converted > 0) {
      await saveMacros();
      renderAll();
    }

    setStatus(`${previewOnly ? "Preview" : "Converted"}: ${converted} actions across ${affectedMacros} macros.`);
  };

  (document.getElementById("previewConvert") as HTMLButtonElement).onclick = () => {
    void runConversion(true);
  };

  (document.getElementById("applyConvert") as HTMLButtonElement).onclick = () => {
    void runConversion(false);
  };
}

function renderShell(): void {
  document.body.innerHTML = `
    <div id="app">
      <header class="tabs">
        <button id="tabMacros">Macros</button>
        <button id="tabSettings">Settings</button>
      </header>

      <main id="macrosTab" class="tab-panel">
        <div class="macro-topbar">
          <div class="macro-topbar-left">
            <span class="section-title">Hotkeys</span>
            <button id="toggleHotkeyBtn">Set Toggle Hotkey</button>
            <button id="removeToggleHotkeyBtn">Remove Toggle</button>
            <button id="exitHotkeyBtn">Set Exit Hotkey</button>
          </div>

          <div class="macro-topbar-right">
            <span class="section-title">Click Modes</span>
            <button id="gameClickModeBtn" class="mode-btn active">Game Click</button>
            <button id="normalClickModeBtn" class="mode-btn active">Normal Click</button>
          </div>
        </div>

        <div class="macro-layout">
          <aside class="macro-sidebar">
            <div class="section-title">Macro List</div>
            <ul id="macroList" class="macro-list"></ul>
            <label class="macro-name-field">Name <input id="macroName" type="text" /></label>
            <div class="sidebar-buttons">
              <button id="copyMacroBtn">Copy Macro</button>
              <button id="newMacroBtn">New Macro</button>
              <button id="deleteMacroBtn">Delete Macro</button>
            </div>
          </aside>

          <section class="macro-main">
            <div class="row gap action-toolbar">
              <button id="checkAllBtn">Check All</button>
              <button id="copyActionBtn">Copy</button>
              <button id="pasteActionBtn">Paste</button>
              <button id="removeActionBtn">Remove</button>
              <button id="moveUpBtn">Move Up</button>
              <button id="moveDownBtn">Move Down</button>
              <span id="actionCount" class="muted">0 actions</span>
            </div>

            <div id="actionViewport" class="action-viewport">
              <div id="actionSpacer"></div>
              <div id="actionLayer" class="action-layer"></div>
            </div>

            <div class="action-bottom">
              <div>
                <div class="section-title">Add Actions</div>
                <div class="action-grid">
                  ${ACTION_TYPES.map((t) => `<button data-action-type="${t}">${t}</button>`).join("")}
                </div>
              </div>

              <div class="new-action-settings">
                <div class="section-title">New Action Settings</div>
                <label><input id="autoDelayEnabled" type="checkbox" /> Add delay after action</label>
                <div class="row gap">
                  <label>Delay <input id="autoDelayAmount" type="number" min="0" value="50" /></label>
                  <label>Unit
                    <select id="autoDelayUnit">
                      <option value="ms">ms</option>
                      <option value="min">min</option>
                    </select>
                  </label>
                </div>
                <div class="row gap">
                  <button id="setQuickDelayMs">Quick 10ms</button>
                  <button id="setQuickDelayMin">Quick 1min</button>
                </div>
              </div>
            </div>

            <div class="row gap loop-controls">
              <label>Loop Delay (ms) <input id="loopDelay" type="number" min="0" /></label>
              <label>Loop Count (0=inf) <input id="loopCount" type="number" min="0" /></label>
              <label>Speed <input id="speedMultiplier" type="number" min="1" step="1" /></label>
            </div>

            <button id="startStopBtn" class="start-stop-btn">Start Macro</button>

            <div class="section-title">Action Editor</div>
            <div id="actionEditor" class="action-editor"></div>
          </div>
        </div>
      </main>

      <main id="settingsTab" class="tab-panel hidden">
        <section class="settings-wrap">
          <div class="section-title">Theme</div>
          <div class="row gap">
            <label>Mode
              <select id="themeSelect">
                <option value="dark">Dark (black bg / white text)</option>
                <option value="light">Light (white bg / black text)</option>
              </select>
            </label>
            <label><input id="globalHotkeys" type="checkbox" /> Enable global hotkeys</label>
          </div>

          <div class="section-title">Monitor Conversion</div>
          <div class="row gap">
            <label>Current W <input id="currentWidth" type="number" min="1" /></label>
            <label>Current H <input id="currentHeight" type="number" min="1" /></label>
            <label>Target W <input id="targetWidth" type="number" min="1" /></label>
            <label>Target H <input id="targetHeight" type="number" min="1" /></label>
            <button id="autoDetectMonitor">Auto Detect</button>
          </div>
          <div class="row gap">
            <label><input id="roundCoordinates" type="checkbox" checked /> Round coordinates</label>
            <button id="previewConvert">Preview Conversion</button>
            <button id="applyConvert">Convert All Macros</button>
          </div>

          <div class="section-title">Data File</div>
          <p class="muted">Using macro file: <span id="dataPath"></span></p>
        </section>
      </main>

      <footer class="statusbar">
        <span id="statusText">Ready.</span>
      </footer>
    </div>
  `;
}

async function bootstrap(): Promise<void> {
  renderShell();
  bindUI();

  const payload = await window.macroApi.getInitialData();
  state.macros = payload.macros;
  state.settings = payload.settings;
  state.macroFilePath = payload.macroFilePath;
  state.selectedMacroIndex = state.macros.length > 0 ? 0 : -1;
  state.focusedActionIndex = currentMacro()?.actions.length ? 0 : -1;

  applyTheme();
  renderAll();

  window.macroApi.onRunnerState((runnerState) => {
    state.running = runnerState.running;
    state.runningMacroName = runnerState.name;
    renderMacroControls();
    setStatus(runnerState.running ? `Running: ${runnerState.name}` : "Stopped.");
  });
}

void bootstrap();
