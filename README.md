# Mc_Wipf Macro

A Windows desktop macro automation app built with Electron, TypeScript, and React. Create, manage, and run macros with mouse, keyboard, scroll, image detection, and more — all with a clean, themeable UI.

## Features

- **Mouse actions** — click, move, press/release, scroll, relative move
- **Keyboard actions** — key press, hold, release
- **Image detection** — trigger actions based on what's on screen
- **Open links** — launch URLs as part of a macro
- **Delays** — precise delays in milliseconds or minutes
- **Toggle & exit hotkeys** — start/stop macros from anywhere with configurable keys
- **Global hotkeys** — trigger macros even when the app is not focused
- **Loop control** — set loop count and delay between loops
- **Speed multiplier** — scale macro timing globally
- **Customizable UI** — dark/light theme, custom colors for background, text, buttons, and outlines

## Download

Grab the latest installer from the [Releases](https://github.com/mcwipf/Mc_Wipf-Mactro/releases) page.

> Requires **Windows x64**.

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- Windows (native modules require Windows build tools)

### Setup

```bash
git clone https://github.com/mcwipf/Mc_Wipf-Mactro.git
cd Mc_Wipf-Mactro/ts-macro-app
npm install
```

### Run in dev mode

```bash
npm run dev
```

### Build installer

```bash
npm run dist:win
```

The output will be in the `release/` folder.

## Tech Stack

- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/)
- [nut-tree-fork](https://github.com/nut-tree/nut.js) — mouse & keyboard control
- [uiohook-napi](https://github.com/SnosMe/uiohook-napi) — global hotkeys

## License

[MIT](LICENSE)
