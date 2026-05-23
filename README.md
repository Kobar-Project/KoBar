<p align="center">
  <img src="build/icon.png" alt="KoBar Logo" width="128" height="128" />
</p>

<h1 align="center">KoBar</h1>

<p align="center">
  <strong>Your modular, always-on-top desktop utility sidebar.</strong><br/>
  A multi-threaded creative assistant that lives on the edge of your screen.
</p>

<p align="center">
  <a href="https://apps.microsoft.com/store/detail/9P2KPFF3G9L9?cid=DevShareMCLPCS"><img src="https://img.shields.io/badge/Microsoft%20Store-Download-blue?logo=microsoft&logoColor=white" alt="Microsoft Store" /></a>
  <img src="https://img.shields.io/badge/version-1.0.24-f4a125?style=flat" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey" alt="Platform" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

> 🍎 **macOS support is currently under active development.** Some features may be limited or unavailable on macOS.

---

## 📖 What is KoBar?

**KoBar** is a frameless, transparent, always-on-top desktop sidebar built with **Electron** and **React**. It docks to either edge of your screen and provides instant access to a rich set of productivity tools, all without leaving your current workflow.

Think of it as a Swiss Army knife that floats on your desktop: clipboard manager, notes, AI assistant, screenshot studio, media controller, and more, all in one sleek, customizable sidebar.

<p align="center">
  <a href="https://www.youtube.com/watch?v=KfZmoITxg2E">
    <img src="Assets/GitHub_images/screen.png" alt="KoBar Feature Video" width="100%" />
  </a>
</p>

<p align="center">
  <sub>💡 Click or tap the image above to watch the KoBar trailer on YouTube!</sub>
</p>

---

## ✨ Features

### 🔲 Modular Sidebar
- **Always-on-top** transparent overlay — never leaves your sight
- **Edge docking** — snaps to left or right screen edge with drag-and-drop repositioning
- **Mini Mode** — collapses into a small floating eye icon to save space
- **Free-floating mode** — drag the sidebar anywhere on screen, across multiple monitors
- **Multi-monitor support** — seamless edge detection and snapping across all connected displays

### 📋 Sequential Clipboard Manager
- **Multi-slot FIFO queue** — 4 to 20 configurable clipboard slots
- **Copy Mode** — automatically captures consecutive copies into sequential slots
- **Paste Mode** — pastes slots in order with a global hotkey (`Ctrl+V`)
- **Image support** — clipboard slots handle both text and images
- **Double-click to reset** — quickly clear and restart the queue

### 📝 Rich Notes Panel
- **Tiptap-powered editor** — rich text with bold, italic, underline, lists, and images
- **Multi-tab system** — organize notes into separate tabs with custom icons and colors
- **Voice-to-Text** — built-in speech recognition for hands-free note-taking
- **Password lock** — protect sensitive notes with a password
- **Color categories** — tag notes with color labels (Red, Blue, Green, Yellow, Purple, Orange)
- **Compact & Normal view** — switch between dense and comfortable layouts

### 🤖 AI Hub
- **Multi-provider support** — connect to OpenAI (GPT-4o), Google Gemini, Anthropic Claude, and local LLMs (Ollama, LM Studio)
- **Streaming responses** — real-time token-by-token rendering
- **File context** — drag & drop TXT, PDF, and images directly into chat
- **Custom system prompts** — configure AI personality and behavior
- **Multi-chat management** — maintain separate conversation threads

### 📸 Screenshot Studio
- **Region & Full-screen capture** — select any area or capture the entire screen
- **Annotation Editor** — draw, highlight, add text, arrows, rectangles, and circles with Konva.js
- **Multi-display support** — captures across all connected monitors
- **Save or copy** — export to file or send directly to clipboard
- **Image border** — optional border around captured screenshots

### 🎵 KoPlayer (Media Controller)
- **System media integration** — controls Spotify, YouTube, and any media player via Windows SMTC
- **Album art display** — shows current track artwork
- **Play/Pause/Next/Previous** — full transport controls from the sidebar

### 📅 KoCalendar
- **Google Calendar integration** — view and create events directly from the sidebar
- **Event alerts** — receive desktop notifications for upcoming events
- **Monthly calendar view** — navigate months and manage events visually

### ⏱ Focus Mode
- **Customizable timer** — set minutes and seconds for focus sessions
- **Ambient melodies** — play background audio during focus sessions
- **Loop mode** — repeat focus sessions automatically
- **Desktop notifications** — get notified when your session ends

### 🧰 More Tools

| Tool | Description |
|------|-------------|
| **🔢 Calculator** | Floating scientific calculator with history |
| **🎨 Color Picker** | Pick colors with HEX/RGB/HSL values, auto-send to clipboard slots |
| **✅ To-Do List** | Minimal, draggable task list with priority ordering |
| **📌 Pin Injector** | Pin any third-party window to "Always on Top" |
| **📦 KoBox** | Drag-and-drop file staging area with auto-cleanup (24h or on quit) |
| **📋 Snippet Vault** | Save and organize text templates, code snippets, and AI prompts |
| **🚀 App Launcher** | Drag-and-drop shortcuts to pin your favorite apps |

<p align="center">
  <img src="Assets/GitHub_images/AI-hub.png" alt="Theming and AI Hub" width="100%" />
</p>

---

## 🎨 Theming & Design

KoBar ships with **11 built-in themes**, a **custom theme generator**, and a built-in **Color Picker** that lets you choose any color to create your own personalized theme on the fly:

| Theme | Color |
|-------|-------|
| Ember *(default)* | 🟠 Warm Amber |
| Ocean | 🔵 Deep Blue |
| Sakura | 🌸 Cherry Blossom |
| Emerald | 🟢 Forest Green |
| Midnight | 🔮 Deep Indigo |
| Amethyst | 💜 Rich Purple |
| Crimson | 🔴 Vibrant Red |
| Nord | 🧊 Arctic Blue-Grey |
| Coffee | ☕ Warm Brown |
| Lavender | 💟 Pastel Purple |
| Custom | 🎨 Pick any color with the built-in Color Picker |

**Design Modes:**
- **Style 1 (Solid)** - opaque dark background
- **Style 2 (Glass)** - frosted glassmorphism with adjustable opacity

<p align="center">
  <img src="Assets/GitHub_images/Color.png" alt="Localization and Colors" width="100%" />
</p>

---

## 🌍 Internationalization

Fully translated into **10 languages:**

🇺🇸 English · 🇹🇷 Turkish · 🇩🇪 German · 🇫🇷 French · 🇪🇸 Spanish · 🇷🇺 Russian · 🇯🇵 Japanese · 🇨🇳 Chinese · 🇸🇦 Arabic · 🇮🇳 Hindi

---

## 🏗 Architecture

```
KoBar/
├── electron/               # Electron Main Process
│   ├── main.cts            # Window management, IPC handlers, OS integrations
│   ├── preload.cts         # Context bridge (IPC API exposed to renderer)
│   ├── smtc-worker.cts     # Windows SMTC media monitoring (Worker Thread)
│   └── licenseManager.cts  # Hardware ID & license validation
├── src/                    # React Frontend (Renderer Process)
│   ├── App.tsx             # Root component & layout orchestration
│   ├── components/
│   │   ├── layout/         # Sidebar, Calculator, ColorPicker, Focus, KoPlayer, SnippetVault, TodoList
│   │   ├── clipboard/      # Multi-slot clipboard FIFO manager
│   │   ├── notes/          # NotePanel, NoteEditor, SettingsPanel, ResizerHandle
│   │   ├── screenshot/     # ScreenshotOverlay, AnnotationEditor (Konva.js)
│   │   ├── chat/           # AiHubPopup (multi-provider LLM client)
│   │   ├── calendar/       # KoCalendarPopup
│   │   └── license/        # LicenseActivationModal
│   ├── store/              # Zustand state management
│   │   ├── useAppStore.ts          # Main application state (~58KB)
│   │   ├── useClipboardStore.ts    # Clipboard FIFO queue logic
│   │   ├── useChatStore.ts         # AI Hub chat state
│   │   └── useScreenshotStore.ts   # Screenshot workflow state
│   ├── hooks/              # Custom React hooks
│   │   ├── useSpeechToText.ts      # Web Speech API integration
│   │   └── useUnifiedResize.ts     # Cross-platform panel resizing
│   ├── i18n/               # Translations (10 languages)
│   ├── types/              # TypeScript definitions (global.d.ts)
│   └── config/             # Default state & clipboard configs
├── Assets/                 # Static resources
│   ├── Melody/             # Focus mode ambient audio files
│   ├── DefaultNote/        # Default note templates
│   └── microsoftStore/     # Store listing assets (10 languages)
└── build/                  # App icons & build resources
```

### Key Architectural Decisions

- **Ghost Window Pattern** — KoBar uses a large transparent window (6000×4000px on Windows) to enable free-floating positioning while maintaining always-on-top behavior. Mouse events are dynamically forwarded or ignored based on hover detection.
- **Strict Context Isolation** — `nodeIntegration: false`, `contextIsolation: true`. All IPC is bridged through a typed `window.api` interface via the preload script.
- **Cross-Platform** — `process.platform` checks (`darwin` / `win32`) are used throughout for OS-specific behavior (NSPanel vs toolbar window type, PowerShell vs AppleScript, SMTC vs generic media).
- **Zustand State** — All global state is managed by Zustand stores. No Redux. `useState` is reserved for purely local UI toggles.

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | [Electron 40](https://www.electronjs.org/) |
| **Frontend** | [React 19](https://react.dev/) + [TypeScript 5.9](https://www.typescriptlang.org/) |
| **Bundler** | [Vite 7](https://vite.dev/) |
| **Styling** | [Tailwind CSS 4](https://tailwindcss.com/) |
| **State** | [Zustand 5](https://zustand.docs.pmnd.rs/) |
| **Rich Text** | [Tiptap 3](https://tiptap.dev/) (ProseMirror) |
| **Canvas** | [Konva.js](https://konvajs.org/) + [react-konva](https://konvajs.org/docs/react/) |
| **AI Markdown** | [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) |
| **Persistence** | [electron-store](https://github.com/sindresorhus/electron-store) |
| **Distribution** | [electron-builder](https://www.electron.build/) (AppX, EXE) |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- **Windows 10/11**

### Installation

```bash
# Clone the repository
git clone https://github.com/eedali/KoBar.git
cd KoBar

# Install dependencies
npm install
```

### Development

```bash
# Start in development mode (Vite + Electron concurrently)
npm run dev
```

This will:
1. Start the Vite dev server on `http://localhost:5173`
2. Watch and compile Electron TypeScript files
3. Launch the Electron app once all services are ready

### Building

```bash
# Compile TypeScript & bundle for production
npm run build

# Package distributable (AppX for Microsoft Store, EXE for Standalone)
npm run kobar-build
```

---

---

## 🔒 Security

KoBar follows strict Electron security practices:

- ✅ `nodeIntegration: false`
- ✅ `contextIsolation: true`
- ✅ No `@electron/remote`
- ✅ Typed IPC bridge — only specific functions exposed to renderer
- ✅ All frontend–backend communication validated through `ipcMain.handle`
- ✅ No direct Node.js imports in React components

---

## 📦 Distribution

| Platform | Format | Link / Store |
|----------|--------|--------------|
| Windows | AppX | [Microsoft Store](https://apps.microsoft.com/store/detail/9P2KPFF3G9L9?cid=DevShareMCLPCS) |
| Windows (Standalone) | EXE | [GitHub Releases](https://github.com/Kobar-Project/KoBar/releases) |
| macOS | DMG / ZIP | [GitHub Releases](https://github.com/Kobar-Project/KoBar/releases) |

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE.md](LICENSE.md) file for details.

---

## 🙏 Credits

**Created by [Ekrem EDALI](https://www.linkedin.com/in/ekrem-edali/)**

**Contributors:**
* [arindam-sahoo](https://github.com/arindam-sahoo)

Special thanks to: **Tolunay PARLAK** & **MJ**.

---

## ✉️ Contact

For support or inquiries, you can contact us at [contact@ko48.com](mailto:contact@ko48.com).

---

## 💛 Sponsors & Backers

If you find KoBar useful and want to support its ongoing development, consider backing the project through any of the platforms below:

<p align="center">
  <a href="https://www.patreon.com/kobarproject" target="_blank">
    <img src="https://img.shields.io/badge/Patreon-F96854?style=for-the-badge&logo=patreon&logoColor=white" alt="Become a Patron" />
  </a>
  <a href="https://opencollective.com/kobar" target="_blank">
    <img src="https://img.shields.io/badge/Open_Collective-7FADF2?style=for-the-badge&logo=open-collective&logoColor=white" alt="Open Collective" />
  </a>
</p>
