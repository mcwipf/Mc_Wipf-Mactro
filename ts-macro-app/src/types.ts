export type DelayUnit = "ms" | "min";

export type ActionType =
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

export interface Action {
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

export interface Macro {
  name: string;
  loop_delay: number;
  loop_count: number;
  toggle_key: string;
  exit_key: string;
  speed_multiplier: number;
  actions: Action[];
  image_detection_actions?: Action[];
}

export interface MacroFile {
  macros: Macro[];
}

export interface AppSettings {
  background_color: string;
  text_color: string;
  outline_color: string;
  button_color: string;
  default_click_delay: number;
  default_regular_delay: number;
  game_click_enabled: boolean;
  normal_click_enabled: boolean;
  global_hotkeys: boolean;
  ui_theme: "dark" | "light";
}

export interface InitialPayload {
  macros: Macro[];
  settings: AppSettings;
  macroFilePath: string;
  settingsFilePath: string;
  imagesDirPath: string;
}
