import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { AppSettings, Macro, MacroFile } from "./types.js";

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

function resolveLegacyPath(fileName: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), "..", fileName),
    path.resolve(process.cwd(), fileName),
    path.resolve(path.dirname(app.getPath("exe")), fileName)
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolvePythonPath(fileName: string): string {
  const appDataRoot = process.env.APPDATA ?? app.getPath("appData");
  return path.resolve(appDataRoot, "macro_app", fileName);
}

export class DataStore {
  readonly macroFilePath: string;
  readonly settingsFilePath: string;
  readonly imagesDirPath: string;
  private readonly legacyMacroFilePath: string | null;
  private readonly legacySettingsFilePath: string | null;

  constructor() {
    this.macroFilePath = resolvePythonPath("macro_app_data.json");
    this.settingsFilePath = resolvePythonPath("settings.json");
    this.imagesDirPath = resolvePythonPath("images");
    this.legacyMacroFilePath = resolveLegacyPath("macro_app_data.json");
    this.legacySettingsFilePath = resolveLegacyPath("settings.json");
  }

  async ensureFiles(): Promise<void> {
    const pythonAppDir = path.dirname(this.macroFilePath);
    const pythonMacroPath = this.macroFilePath;
    const pythonSettingsPath = this.settingsFilePath;

    await fs.mkdir(pythonAppDir, { recursive: true });
    await fs.mkdir(this.imagesDirPath, { recursive: true });

    try {
      await fs.access(pythonMacroPath);
    } catch {
      if (this.legacyMacroFilePath && this.legacyMacroFilePath !== pythonMacroPath && existsSync(this.legacyMacroFilePath)) {
        await fs.copyFile(this.legacyMacroFilePath, pythonMacroPath);
      }
    }

    try {
      await fs.access(pythonMacroPath);
    } catch {
      const empty: MacroFile = { macros: [] };
      await fs.writeFile(pythonMacroPath, JSON.stringify(empty, null, 2), "utf8");
    }

    try {
      await fs.access(pythonSettingsPath);
    } catch {
      if (this.legacySettingsFilePath && this.legacySettingsFilePath !== pythonSettingsPath && existsSync(this.legacySettingsFilePath)) {
        await fs.copyFile(this.legacySettingsFilePath, pythonSettingsPath);
      }
    }

    try {
      await fs.access(pythonSettingsPath);
    } catch {
      await fs.writeFile(pythonSettingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf8");
    }
  }

  async loadMacros(): Promise<Macro[]> {
    await this.ensureFiles();
    const raw = await fs.readFile(this.macroFilePath, "utf8");
    const parsed = JSON.parse(raw) as MacroFile;
    return Array.isArray(parsed.macros) ? parsed.macros : [];
  }

  async saveMacros(macros: Macro[]): Promise<void> {
    const payload: MacroFile = { macros };
    await fs.writeFile(this.macroFilePath, JSON.stringify(payload, null, 2), "utf8");
  }

  async loadSettings(): Promise<AppSettings> {
    await this.ensureFiles();
    const raw = await fs.readFile(this.settingsFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await fs.writeFile(this.settingsFilePath, JSON.stringify(settings, null, 2), "utf8");
  }
}
