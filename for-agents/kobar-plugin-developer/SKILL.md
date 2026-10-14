---
name: kobar-plugin-developer
description: Expert agent for developing KoBar plugins. Use this skill when you need to create, modify, or debug plugins for the KoBar Electron/React application. It contains all architectural rules, API constraints, and registry publishing guidelines.
---

# KoBar Plugin Developer

You are an expert at developing plugins for KoBar, an Electron application with a React-based frontend. When tasked with creating, modifying, or debugging a KoBar plugin, you must strictly adhere to the following architectural rules, constraints, and API capabilities.

## 1. Core Architecture & Environment Constraints

The plugin system injects third-party features into the React frontend context. Your code runs directly inside the KoBar UI thread.

**⚠️ PLUGINS RUN WITH FULL PRIVILEGES.** A plugin is not sandboxed. It runs in the same renderer realm as the KoBar app itself, so it can:
* read and write `localStorage`, including the app's own persisted stores;
* call every `window.api` method, exactly as the app does;
* read and modify the DOM and call `window.useAppStore` freely;
* read other workspaces' and other plugins' data: isolated workspaces only prefix storage keys for convenience; any plugin can still reach that data (e.g. via `localStorage.key()` or direct property access, or `KoBarExtensions.getData/setData` with another pluginId).

There is no isolation boundary between a plugin and the host. Installing a plugin means trusting its code completely. The host adds mitigations against abuse, but they are **not isolation**:
* main-process confirmation dialogs for plugin install / uninstall / ZIP / GitHub installs (an install can therefore be refused by the user);
* origin tracking and version checks for plugin updates;
* ZIP extraction limits;
* a rate limit and a visible flash for screen capture;
* a token required for global paste;
* rate limiting and truncation of notifications, plus a confirmation for auto-launch;
* restrictions on file arguments passed to `window.api` methods;
* an allow-list for `openExternal`.

Because the plugin runs in the same realm as the app, the host cannot prove that a call to `window.api` came from a real user action. These checks only make abuse slower, rarer or more visible.

**🚨 CRITICAL CONSTRAINTS:**
1. **No Node.js Built-ins:** You CANNOT use `require('fs')`, `require('path')`, `require('child_process')`, etc. They will throw an error.
2. **No Remote Module:** `@electron/remote` is not available and must not be used.
3. **Node.js is not exposed:** Electron's `contextIsolation` separates the renderer from Node.js, but it does NOT separate plugins from the app. Use the documented `window` globals (`React`, `ReactDOM`, `useAppStore`, `api`, `KoBarExtensions`) as the supported interface.
4. **Bundling is Mandatory:** Since KoBar evaluates the `entry` file dynamically, you cannot use dynamic ES `import/export` statements that point to other local files at runtime. If the plugin has multiple files, you MUST use a bundler (Webpack, Rollup, Vite) to emit a single bundled `.js` file.
5. **Styling Limitations:** Be careful using Tailwind classes if you aren't sure they exist in the main bundle. Inline styles or CSS-in-JS are recommended for guaranteed behavior.

## 2. Exposed Global Objects

Instead of bundling React or trying to access Node directly, KoBar provides powerful globals:

* `window.React`: The global React object. Use `React.createElement`, `React.useState`, `React.useEffect`, etc.
* `window.useAppStore`: The global Zustand state store instance. Used to read user settings, theme configs, or feature toggles.
* `window.api`: The Electron IPC bridge to native OS capabilities. Every method is callable by any plugin; see the privilege warning above.
* `window.KoBarExtensions`: The core `ExtensionRegistry` where the plugin registers its UI components.

## 3. Implementation Patterns

### A. Registering a Sidebar Button
You can add a custom button directly to the KoBar sidebar. This is typically used to open your plugin's panel.

```javascript
window.KoBarExtensions.registerSidebarButton({
    id: 'my-custom-plugin-btn',
    icon: 'star', // Material Symbols Outlined icon name
    label: 'My Custom Plugin',
    onClick: (e, anchorRect) => {
        // Handle click event. Often used to open a panel.
        window.useAppStore.getState().closeAllUtilityPopups();
        window.useAppStore.setState({ 
            activeExtensionPanelId: 'my-custom-plugin-panel',
            activeExtensionAnchorRect: anchorRect
        });
    }
});
```

### B. Registering a Custom Panel
Plugins can render complex React UIs by registering an `ExtensionPanel`. Use `window.React.createElement` (or JSX if you bundle and transpile).

```javascript
const MyCustomPanel = (props) => {
    const { onClose, anchorRect } = props;
    const { useState, useEffect } = window.React;
    
    // We must calculate position relative to the KoBar sidebar wrapper
    const [pos, setPos] = useState({ top: -9999, left: -9999 });
    
    useEffect(() => {
        if (anchorRect) {
            const wrapper = document.getElementById('kobar-sidebar-wrapper');
            if (wrapper) {
                const wrapperRect = wrapper.getBoundingClientRect();
                const store = window.useAppStore.getState();
                
                let top, left;
                
                // Adjust position based on orientation and edge
                if (store.orientation === 'horizontal') {
                    left = (anchorRect.left - wrapperRect.left) + (anchorRect.width / 2) - 150; // 150 is half width
                    top = store.edgePosition === 'top' 
                        ? anchorRect.bottom - wrapperRect.top + 10 
                        : anchorRect.top - wrapperRect.top - 410; // 400 height + 10 gap
                } else {
                    top = (anchorRect.top - wrapperRect.top) + (anchorRect.height / 2) - 200; // 200 is half height
                    left = store.edgePosition === 'right' 
                        ? anchorRect.left - wrapperRect.left - 310 // 300 width + 10 gap
                        : anchorRect.right - wrapperRect.left + 10;
                }
                setPos({ top, left });
            }
        }
    }, [anchorRect]);
    
    return window.React.createElement('div', {
        style: {
            position: 'absolute',
            top: pos.top,
            left: pos.left,
            width: 300,
            height: 400,
            backgroundColor: '#1a1612',
            border: '1px solid #333',
            borderRadius: '12px',
            padding: '16px',
            color: 'white',
            zIndex: 999
        }
    }, [
        window.React.createElement('h2', { key: 'title' }, 'Hello from Plugin!'),
        window.React.createElement('button', { key: 'btn', onClick: onClose }, 'Close Panel')
    ]);
};

window.KoBarExtensions.registerPanel('my-custom-plugin-panel', {
    id: 'my-custom-plugin-panel',
    render: (props) => window.React.createElement(MyCustomPanel, props)
});
```

### C. Registering a Settings Panel
Plugins can provide custom settings UI that appears in the Plugin Details page within KoBar's plugin store.

```javascript
const MySettingsPanel = () => {
    return window.React.createElement('div', { style: { color: 'white' } }, [
        window.React.createElement('h3', { key: 'title' }, 'Plugin Settings'),
        window.React.createElement('input', { key: 'input', type: 'text', placeholder: 'Enter API Key' })
    ]);
};

if (window.KoBarExtensions.registerSettingsPanel) {
    window.KoBarExtensions.registerSettingsPanel('my-custom-plugin-panel', {
        id: 'my-custom-plugin-panel',
        render: () => window.React.createElement(MySettingsPanel)
    });
}
```

### D. Simple vs Complex Plugins (JSX & Bundling)

When developing a plugin's UI, you have two choices depending on the complexity of your interface:

**1. Simple Plugins (No Build Step)**
For simple interfaces, write directly in raw JavaScript (`.js`) using `window.React.createElement`. This avoids the need for a build step, allowing you to directly test and publish your code.

**2. Complex Plugins (Requires Bundling)**
For complex layouts (e.g., drag-and-drop, extensive Tailwind styling, multiple components), writing `React.createElement` manually is unmaintainable. Instead, write your code in standard React JSX (`.jsx`) and use a bundler (like Vite or esbuild) to compile it into the final `index.js` file that KoBar expects.

**🚨 CRITICAL:** KoBar cannot evaluate raw `.jsx` at runtime. If you write your plugin in JSX, **you MUST compile it to `.js` before publishing to GitHub.** If you only publish the `.jsx` file, the plugin will crash when KoBar tries to load it, resulting in a broken UI or empty sidebar button.

**Example Build Script (`build.mjs`) using Vite:**
If you choose the complex route, create a `build.mjs` script in your plugin directory. Run `node build.mjs` to generate the `index.js` file, and ensure this `index.js` is included in your GitHub release.

```javascript
import { build } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runBuild() {
  await build({
    root: __dirname,
    build: {
      lib: {
        entry: path.resolve(__dirname, 'index.jsx'),
        name: 'KoBarPlugin',
        formats: ['iife'],
        fileName: () => 'index.js'
      },
      outDir: __dirname,
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['react', 'react-dom'],
        output: { globals: { react: 'window.React', 'react-dom': 'window.ReactDOM' } }
      }
    },
    esbuild: { jsxFactory: 'window.React.createElement', jsxFragment: 'window.React.Fragment' }
  });
  console.log("Build complete: index.js generated.");
}
runBuild();
```
### E. Dependency Management (`package.json`)

When building complex plugins, you might be tempted to create a local `package.json` and run `npm install` for third-party libraries (e.g., `crypto-js`, `lodash`). 

**🚨 BEST PRACTICE**: You *can* add a `package.json` and local `node_modules` if a specific external package is absolutely required for your plugin to function. However, **this should be avoided whenever possible.** 
- First, check if you can build the feature using native browser APIs or the exposed KoBar globals.
- Second, KoBar's own `node_modules` is **not** a dependency source for plugins: the host app does not ship third-party UI/utility libraries for you. A plugin that needs a package (e.g. `react-markdown`, `date-fns`) must declare it in its **own** `package.json` and install it in its own repository; only `react`/`react-dom` are bundler externals; host services come via the documented `window.*` globals (`window.api`, `window.useAppStore`, `window.KoBarExtensions`).
- Only introduce external package dependencies when there is no easier alternative, keeping plugins as lightweight as possible.

### F. Accessing Global State & Localization (`useAppStore`)
Read and modify the application state programmatically. This is crucial for multi-language support and OS-specific behavior.

```javascript
const store = window.useAppStore.getState();

// OS and Orientation
const isMac = store.isMac;
const edge = store.edgePosition; // 'left', 'right', 'top', 'bottom'

// Localization Pattern
const currentLang = store.language; // e.g., 'en', 'tr', 'de'

const TRANSLATIONS = {
    en: { title: "Hello World" },
    tr: { title: "Merhaba Dünya" }
};

const t = (key) => {
    const langDict = TRANSLATIONS[currentLang] || TRANSLATIONS['en'];
    return langDict[key] || key;
};
```

### G. Native OS Capabilities (`window.api`)
Trigger desktop-level features through the IPC bridge. The host may refuse, limit or confirm some of these calls (see the notes below):

* **Notifications**: `window.api.sendNotification('Title', 'Body message')`. Rate-limited in the main process: at least 500 ms between notifications and at most 5 per 10 seconds (excess calls are silently dropped). Title is truncated to 100 characters and body to 300; newlines and control characters are collapsed to single spaces.
* **Clipboard**: `window.api.writeToClipboard({ type: 'text', content: 'Hello' })`
* **File Execution**: `window.api.launchFile('C:\\path\\to\\app.exe')`. Accepts absolute local paths and URLs only; relative paths and device paths are rejected, and UNC paths or non-allow-listed URL schemes ask the user for confirmation; known-dangerous schemes (e.g. javascript:, data:, ms-msdt:) are always refused, as are URLs with embedded credentials.
* **Media Controls**: `window.api.sendMediaCommand('play')` (play, pause, next, prev)
* **Screenshots**: `window.api.takeScreenshot(true)`. `window.api.startScreenshotCapture()` is rate-limited (at most one call per second and 10 per minute) and shows a brief screen flash on every capture. When limited it resolves `{ captures: [], windowPosition: {x:0,y:0}, error: 'rate_limited', retryAfterMs }` instead of throwing, so always check `error`.
* **AI API**: `window.api.llmRequest(data)` (Streams via `window.api.onLlmStreamChunk`). A local LLM `localUrl` must point to a loopback address (e.g. `http://localhost:11434`); anything else is refused.
* **Window Control**: `window.api.hideApp()` or `window.api.moveWindow(dx, dy)`
* **Files**: `window.api.parseFile(path)` extracts text from files; PDF text is read with `pdf-parse` v2 and capped at 2,000,000 characters. Images return `{type:'image', content: dataURL}`; failures resolve `{type:'error', content}` instead of throwing; paths must be absolute, the extension must be on the allow-list, files are capped at 50 MB, and app-data/KoBox paths are refused.
* **User-selected paths only**: `window.api.parseFile(path)`, `window.api.dropToKoBox(paths)`, `window.api.saveScreenshot({ destinationPath })` and `window.api.installExtensionFromPath(path)` accept only the exact path of a file the user dropped or picked, obtained from the `File` object with `window.api.getFilePath(file)` (call it in the drop/change handler, then pass the string on; the grant lasts about 10 minutes and a folder grant does not cover the files inside it). A path typed, stored or built by the plugin is refused, and the host shows the user a localized notice (rate-limited, at most one per 10 s). Failure shapes: `parseFile` resolves `{ type:'error', content:'Error: not-user-selected', error:'not-user-selected' }`; `saveScreenshot` resolves `{ success:false, reason:'not-user-selected' }` (omit `destinationPath` to let the host open its own save dialog, which needs no grant); `installExtensionFromPath` resolves `{ success:false, reason:'not-user-selected' }`; `dropToKoBox` is fire-and-forget and returns nothing, only the notice tells the user.
* **Global paste**: `window.api.executeGlobalPaste(data)` is honoured once, within about 3 s after the host sent `request-next-paste` (received via `onRequestNextPaste`); the first call consumes it. Calling it at any other time does nothing. Since `window.api.globalPasteVersion === 2` (absent on older hosts, treat as 1) the host serialises presses itself: one paste at a time, held keys paste once, presses made during a paste are queued. Plugins then need no debounce and must call `executeGlobalPaste` at most once per `request-next-paste`; keep a debounce only when `(window.api.globalPasteVersion ?? 1) < 2`.
* **Updates**: the arguments of `window.api.askForUpdate(...)` are ignored; the host shows fixed text.
* **Plugin install**: `window.api.installExtensionFromFile/Path/Github` and `uninstallExtension` show a main-process confirmation dialog, so the user can refuse and the call may resolve unsuccessfully. `window.api.installExtension` and `window.api.getAvailableExtensions` are v1 compatibility no-ops (they resolve `false` and `[]`); the eyedropper methods (`startEyeDropper`, `stopEyeDropper`) are no-ops as well.
* **Encrypted secrets** (host addition since T-411; not available in older KoBar versions, so feature-check `typeof window.api.setSecret === 'function'`): `window.api.setSecret(name, value)`, `window.api.getSecretStatus(name)` and `window.api.deleteSecret(name)` all resolve `{ success, reason?, status?: { name, exists, last4, encryptionAvailable, unreadable } }`. The value is encrypted with the OS (Electron `safeStorage`, DPAPI on Windows) and **never comes back to the renderer**: there is no "get value" method, `last4` is filled only for secrets of 12+ characters. Names must be in the plugin namespace **`plugin-<your plugin id>-<key>`** (`[a-z0-9-]`, at most 64 characters, e.g. `plugin-ko-chat-api-key`); any other well-formed name is reserved for KoBar itself and resolves `{ success:false, reason:'reserved-name' }`, malformed names (and a bare `plugin-`) resolve `invalid-name`. The host cannot verify the plugin id part, so only use names that start with your own id. Other reasons: `invalid-request`, `invalid-value`, `too-large` (16 KB), `limit-reached` (64 secrets shared by all plugins, so one plugin can use up the others' room; KoBar's core namespace has its own 64), `encryption-unavailable` (the OS cannot encrypt; nothing was saved, there is no plaintext fallback), `encryption-failed`, `io`, `denied`. `status.unreadable === true` means the secret exists but cannot be decrypted for this OS user/profile; ask the user to enter it again. Suggested user-facing texts (KoBar has no shared i18n keys for these yet, so ship your own): encryption unavailable = "This system cannot encrypt secrets, so the key was not saved."; unreadable = "The saved key cannot be read on this device or user account. Please enter it again."
* **Google Calendar (EXPERIMENTAL, read-only, host addition R2-15; feature-check `typeof window.api.gcalListEvents === 'function'`)**: the user turns it on in Settings > Integrations (default OFF) and signs in there; plugins can only read. The host owns the sign-in; tokens never reach a plugin. M7 will gate these methods behind the `calendar.read` permission; until then treat them as unstable. None of them throws, they resolve plain objects:
  * `window.api.gcalStatus()` resolves `{ state: 'not-configured' | 'not-connected' | 'connected' | 'reconnect-needed', enabled: boolean, configured: boolean, connected: boolean, lastRefreshAt: number | null }` (`lastRefreshAt` is epoch milliseconds). `reconnect-needed` appears when Google rejects the saved sign-in (in Testing mode it expires after 7 days); the user fixes it in Settings.
  * `window.api.gcalConnect()` opens the system browser for Google sign-in and resolves `{ success, reason?, status }` (`reason`: `disabled`, `not-configured`, `encryption-unavailable`, `busy`, `timeout`, `denied`, `state-mismatch`, `exchange-failed`, `io`, `denied-sender`). The Settings page is the normal place for this; a plugin should rather point the user there.
  * `window.api.gcalDisconnect()` revokes the token, deletes it and resolves the new status object.
  * `window.api.gcalListEvents({ from, to })` (ISO 8601 strings, `from < to`, at most 400 days) resolves an array of `{ id: 'google:<eventId>', title, start, end, allDay: boolean, calendar: 'google' }` for the primary calendar (recurring events expanded, cancelled ones dropped), or `[]` when the feature is off, not connected or the range is invalid. All-day events use `YYYY-MM-DD` and an INCLUSIVE `end` (last day); timed events use ISO 8601 with a UTC offset. Results are cached in memory and refreshed every 15 minutes while connected; nothing is stored on disk.
* **Licensing**: `window.api.getHwid()` resolves `null`. `useAppStore.getState().isLicensed` is always `true` and is not persisted; it is removed in KoBar 2.0, so do not depend on it.

**Subscriptions (`on*` APIs):** every `window.api.on...(callback)` method returns an unsubscribe function that removes only that callback. Plugins must call the returned function when they no longer need the event (e.g. in a `useEffect` cleanup). Other subscribers, including those of other plugins, are not affected.

```javascript
useEffect(() => {
    const unsubscribe = window.api.onLlmStreamChunk((chunk) => { /* ... */ });
    return () => unsubscribe();
}, []);
```

### H. Workspace Switches & Plugin Lifecycle
Since KoBar 1.3.0 a workspace switch does not always re-run your plugin:

* **Same data namespace (no re-run):** switching between shared (non-isolated) workspaces, or between a shared workspace and the Default workspace, does NOT re-execute plugin scripts. Only plugins whose enabled state differs between the two workspaces are loaded or unloaded. A plugin that stays enabled keeps its module-scope state; it gets the `kobar:workspace-changed` window event (`event.detail.workspaceId`) and its registered components remount.
* **Data namespace changes (full re-run):** switching to, from or between isolated workspaces clears the registry and executes every enabled plugin again, so module-scope code reads the new namespace.
* **Unloading is not a teardown:** when a plugin is disabled or unloaded, its `<script>` and registrations are removed, but timers, intervals, `window` listeners and `window.api.on*` subscriptions it started outside React keep running until the window reloads. If it is enabled again, its script runs once more next to them. Start such work inside components and stop it in the `useEffect` cleanup (or guard it with a flag on `window`), so a second run never doubles it.

## 4. Plugin Manifest (`manifest.json`)

Every plugin MUST contain a manifest file in its root directory named exactly `manifest.json`. This is its identity card.

```json
{
  "id": "com.yourname.myawesomeplugin",
  "name": "Awesome Plugin",
  "version": "1.0.0",
  "description": "This plugin does amazing things for KoBar by adding a custom panel.",
  "author": "Your Name",
  "entry": "dist/bundle.js",
  "image": "https://raw.githubusercontent.com/YourName/your-repo/main/banner.png",
  "icon": "auto_awesome",
  "categories": ["Utility", "Productivity"],
  "isBeta": false,
  "githubRepo": "YourName/your-repo",
  "storeImage": [
      "https://picsum.photos/600/400?1",
      "https://picsum.photos/600/400?2"
  ],
  "languages": ["en", "tr", "de"],
  "versionNote": "Initial Release"
}
```

**Key Fields:**
* `id`: Completely unique (e.g., reverse-domain format).
* `entry`: Path to the compiled JavaScript file relative to the ZIP root (defaults to `index.js`).
* `githubRepo`: Format `username/repo-name`. Crucial for the registry bot to fetch updates.
* `icon`: Material Symbols Outlined icon name.

**Reserved prefixes (`kobar` / `kobox`):** ids and `localStorage` key names starting with `kobar` or `kobox` (e.g. `kobar-`, `kobar_`, `kobox-`) are reserved for KoBar itself and the official plugins. Third-party plugin ids should not start with `kobar-`/`kobox-` (or `kobar`/`kobox` at all). Consequence for full backup/restore: a restore only writes a plugin's `localStorage` keys when it can tell which installed plugin owns them, by the key starting with the plugin id (`<id>`, `<id>:x`, `<id>.x`, `<id>_x`, `<id>-x`, `<id>/x`). A third-party plugin can never claim keys in the reserved namespace, so its data stored under such keys is skipped on restore. Prefix your keys with your own manifest `id`.

## 5. Publishing Workflow

KoBar uses an automated Plugin Marketplace:
1. Push plugin source to a GitHub repository.
2. Create a GitHub Release (e.g., `v1.0.0`) and attach the bundled plugin as a `.zip` file.
3. Fork [kobar-plugins-registry](https://github.com/Kobar-Project/kobar-plugins-registry).
4. Add `Username/RepositoryName` to `plugins.json`.
5. Open a Pull Request.

The bot automatically fetches the latest release, extracts the manifest, and updates the centralized `registry.json` used by the KoBar desktop application.

## 6. Local Development & Testing (`pluginsPlayground`)

KoBar features a built-in local testing environment called `pluginsPlayground`. This is a directory located at the root of the project (`pluginsPlayground/`).

**Dev-only:** the folder is git-ignored (it does not exist in a fresh clone and is not shipped to users); create it yourself. Only an unpackaged KoBar (e.g. `npm run dev`) loads `<repo>/pluginsPlayground`. Caveat: the e2e smoke test (`tests/e2e/smoke.spec.ts`) refuses to run while this folder exists, so move or rename it before running that test.

**🚨 CRITICAL INSTRUCTION FOR THE AGENT:**
1. **Directory Restriction:** ALL plugin development, modifications, and testing MUST be done strictly inside the `pluginsPlayground` folder. You MUST NOT modify any of KoBar's main application source files (e.g., within `src/`, etc.) when working on a plugin task.
2. **Creation:** Unless explicitly told otherwise, ALWAYS create new plugins and their boilerplate files inside a new subfolder within the `pluginsPlayground` directory.

Plugins placed inside this directory are automatically injected into KoBar's plugin system with a `[DEV]` prefix. This allows you to instantly test, modify, and see changes to your plugin without needing to zip or publish it.

**🚨 MANDATORY BUILD STEP FOR LOCAL CHANGES:**
Even when developing locally in `pluginsPlayground`, if the plugin uses a build step (like `build.mjs` to transpile JSX), **the AI Agent MUST proactively run the build script (e.g., `node build.mjs`) after every modification.** KoBar only loads the compiled `index.js` file, NOT the raw `.jsx` source files. If you do not build the plugin, your changes will NOT be reflected in the application. Do not wait or ask the user to run it; YOU must execute the build command automatically.
