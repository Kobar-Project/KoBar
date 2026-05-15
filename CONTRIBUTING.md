# Contributing to KoBar

First off, thank you for considering contributing to KoBar! Every contribution helps make this project better.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Architecture Rules](#architecture-rules)
- [Submitting Changes](#submitting-changes)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Style Guide](#style-guide)

---

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. Be kind, constructive, and professional in all interactions.

---

## Getting Started

1. **Fork** the repository
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/KoBar.git
   cd KoBar
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Create a branch** for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```

---

## Development Setup

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **Windows 10/11** or **macOS 12+**

### Running in Development

```bash
npm run dev
```

This concurrently starts:
1. Vite dev server on `http://localhost:5173`
2. TypeScript watcher for Electron files
3. Electron app (launches once all services are ready)

### Building for Production

```bash
# Compile TypeScript & Vite bundle
npm run build

# Package distributable
npm run kobar-build
```

---

## Project Structure

```
KoBar/
├── electron/               # Electron Main Process (backend)
│   ├── main.cts            # Window management, IPC handlers, OS integrations
│   ├── preload.cts         # Context bridge (typed window.api)
│   └── smtc-worker.cts     # Windows media monitoring worker
├── src/                    # React Renderer Process (frontend)
│   ├── components/         # UI components organized by feature
│   │   ├── layout/         # Sidebar, popups, utility widgets
│   │   ├── clipboard/      # Clipboard manager
│   │   ├── notes/          # Notes panel & editor
│   │   ├── screenshot/     # Screenshot capture & annotation
│   │   ├── chat/           # AI Hub
│   │   └── calendar/       # KoCalendar
│   ├── store/              # Zustand state stores
│   ├── hooks/              # Custom React hooks
│   ├── i18n/               # Translations (10 languages)
│   ├── types/              # TypeScript type definitions
│   └── config/             # Default state configs
├── Assets/                 # Static resources (audio, templates, store assets)
└── build/                  # App icons & build resources
```

---

## Architecture Rules

These rules are **mandatory** for all contributions. PRs that violate them will be requested to change.

### 1. Electron Security (Non-negotiable)

- `nodeIntegration` must **always** be `false`
- `contextIsolation` must **always** be `true`
- **Never** import Node.js modules (`fs`, `path`, `os`, `child_process`) in React/frontend code
- **Never** import `electron` directly in the frontend
- **Never** use `@electron/remote`
- All IPC must go through the typed `window.api` bridge defined in `preload.cts`

### 2. Cross-Platform Compatibility

KoBar targets both **Windows** and **macOS**. Every backend change must account for both platforms.

```typescript
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

if (isWin) {
    // Windows-specific logic
} else if (isMac) {
    // macOS-specific logic
}
```

- **Never** delete working Windows code when adding macOS support. Wrap it in `if (isWin)` instead.
- Use Electron's built-in cross-platform APIs when possible (`shell.openPath()`, `app.getFileIcon()`, etc.)

### 3. React & State Management

- **Functional components only** (no class components)
- **Zustand** for all global state. No Redux.
- `useState` is only for purely local UI toggles (e.g., a dropdown open/close)
- Create modular stores in `/store` (e.g., `useClipboardStore.ts`, `useAppStore.ts`)
- Separate business logic into **custom hooks** rather than inlining it in JSX

### 4. TypeScript Strictness

- The use of `any` is **forbidden**. Define proper types and interfaces.
- All component props must have explicit `interface` or `type` definitions.
- Type definitions go in `src/types/`

### 5. Styling

- Use **Tailwind CSS** for all styling
- Follow the design system colors defined in `src/index.css` (CSS custom properties like `--theme-primary`, `--theme-bg-dark`, etc.)
- Interactive elements must have `-webkit-app-region: no-drag` (use the `no-drag-region` class)
- Only the top drag handle should have drag region behavior

---

## Submitting Changes

### Pull Request Process

1. Ensure your code **builds without errors**: `npm run build`
2. Ensure your changes work on **Windows**. If you have access to macOS, test there too.
3. Update translations in `src/i18n/translations.ts` if you add any user-facing text.
4. Write a clear PR description explaining:
   - **What** you changed
   - **Why** you changed it
   - **How** to test it
5. Reference any related issues (e.g., `Closes #42`)

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add timer sound selection to Focus Mode
fix: clipboard polling crash on empty image buffer
refactor: extract color picker logic into useColorPicker hook
docs: update README with new KoCalendar section
```

**Prefixes:**
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code restructuring (no behavior change)
- `docs:` - Documentation only
- `style:` - Formatting, Tailwind changes (no logic change)
- `perf:` - Performance improvement
- `i18n:` - Translation updates

---

## Reporting Bugs

When reporting a bug, please include:

1. **OS and version** (e.g., Windows 11 23H2, macOS 14.3)
2. **KoBar version** (check Settings > About)
3. **Steps to reproduce** the issue
4. **Expected behavior** vs. **actual behavior**
5. **Screenshots or screen recordings** if applicable
6. **Console logs** if available (Dev Tools: `Ctrl+Shift+I`)

Use the [Bug Report](https://github.com/eedali/KoBar/issues/new?template=bug_report.md) issue template.

---

## Suggesting Features

Feature requests are welcome! When suggesting a feature:

1. **Check existing issues** first to avoid duplicates
2. Describe the **problem** you're trying to solve
3. Propose a **solution** (even if rough)
4. Explain the **use case** and who benefits from it

Use the [Feature Request](https://github.com/eedali/KoBar/issues/new?template=feature_request.md) issue template.

---

## Style Guide

### File Naming

- Components: `PascalCase.tsx` (e.g., `ClipboardSlots.tsx`)
- Hooks: `camelCase.ts` with `use` prefix (e.g., `useSpeechToText.ts`)
- Stores: `camelCase.ts` with `use` prefix (e.g., `useAppStore.ts`)
- Types: `camelCase.d.ts` (e.g., `global.d.ts`)

### Tailwind Class Ordering

Group classes logically:

```
layout -> spacing -> typography -> colors -> effects
```

Example:
```tsx
<div className="flex items-center gap-2 px-4 py-2 text-sm text-slate-400 bg-white/5 rounded-lg hover:bg-white/10 transition-all">
```

### IPC Channel Naming

- Use kebab-case: `clipboard-updated`, `take-screenshot`, `media-command`
- Prefix with feature name for clarity: `kobox-drop`, `llm-stream-chunk`

---

## Translations

If your contribution adds user-facing text:

1. Add the English string to `src/i18n/translations.ts` under the `en` object
2. Add translations for **all 10 supported languages** (or at minimum English and Turkish)
3. Missing translations will be flagged in review

Supported languages: `en`, `tr`, `de`, `fr`, `es`, `ru`, `ja`, `zh`, `ar`, `hi`

---

## Questions?

If you have any questions about contributing, feel free to open a [Discussion](https://github.com/eedali/KoBar/discussions) or reach out to the maintainer.

Thank you for helping make KoBar better! 🎉
