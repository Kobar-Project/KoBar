# KoBar Plugin System: Technical Documentation

Welcome to the official technical documentation for the KoBar Plugin System. This guide provides a detailed overview of how plugins work under the hood, what capabilities are exposed, constraints you must follow, and how to publish your plugin to the KoBar Plugins Registry.

---

## 1. Architecture Overview

KoBar is an Electron application featuring a React-based frontend. The plugin system is designed to inject third-party features securely and seamlessly into the React frontend context. 

Here is how the plugin lifecycle works:
1. **Discovery & Installation**: Plugins are downloaded as `.zip` files from GitHub Releases or loaded via local ZIP files. 
2. **Extraction**: The KoBar Electron main process extracts the ZIP to the local `userData/extensions/` directory.
3. **Execution Context**: The main process reads the plugin's entry point (`index.js` by default) and passes it as raw string data to the React Frontend.
4. **Injection**: The React Frontend (in `src/App.tsx`) wraps your code in an Immediately Invoked Function Expression (IIFE) and appends it to the document head as a `<script>` tag.

Because your code runs directly inside the KoBar UI thread, you have native access to global React methods, the global state manager (Zustand), and the secure Electron Inter-Process Communication (IPC) bridge.

---

## 2. The Execution Environment

When your plugin script runs, it operates in a strict `contextIsolated` environment. You **do not** have access to Node.js built-ins (`fs`, `path`, etc.) or `@electron/remote`. 

Instead, KoBar exposes powerful global objects on the `window` object:

### Exposed Globals
* `window.React`: The global React object. You can use `React.createElement`, `React.useState`, `React.useEffect`, etc., without needing to bundle React yourself.
* `window.useAppStore`: The global Zustand state store instance. Use this to read the user's settings, theme configurations, or feature toggles.
* `window.api`: The Electron IPC bridge. This provides secure access to native OS capabilities.
* `window.KoBarExtensions`: The core `ExtensionRegistry` where your plugin registers its UI components.

---

## 3. Developing a Plugin: What Can Be Done

### A. Registering a Sidebar Button
You can add a custom button directly to the KoBar sidebar.

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
Plugins can render complex React UIs by registering an `ExtensionPanel`. The panel uses `window.React.createElement` (or JSX if you bundle your code).

```javascript
// Example using React.createElement directly
const MyCustomPanel = (props) => {
    const { onClose, anchorRect } = props;
    
    return window.React.createElement('div', {
        style: {
            position: 'absolute',
            top: anchorRect ? anchorRect.top : 100,
            left: anchorRect ? anchorRect.right + 10 : 100,
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
- Second, Node.js module resolution automatically traverses up the directory tree. This means your plugin can often utilize libraries already installed in the main KoBar workspace (`node_modules`) such as `vite` or `react`, without needing a local `package.json`.
- Only introduce external package dependencies when there is no easier alternative, keeping plugins as lightweight as possible.

### F. Accessing the Global State (`useAppStore`)
You can read and modify the application state programmatically. This is also how you can support multiple languages (localization) in your plugin.

```javascript
const store = window.useAppStore.getState();

// Determine screen orientation and edges
const isMac = store.isMac;
const edge = store.edgePosition; // 'left', 'right', 'top', 'bottom'

// Change theme color
store.setCustomThemeColor('#ff0055');

// --- Implementing Multi-Language Support ---
// The user's active language code (e.g., 'en', 'tr', 'de', 'es')
const currentLang = store.language;

// Define your local dictionary
const TRANSLATIONS = {
    en: { title: "Hello World", button: "Click Me" },
    tr: { title: "Merhaba Dünya", button: "Bana Tıkla" },
    de: { title: "Hallo Welt", button: "Klick Mich" }
};

// Create a helper to get the translation
const t = (key) => {
    const langDict = TRANSLATIONS[currentLang] || TRANSLATIONS['en'];
    return langDict[key] || key;
};

console.log(t('title')); // Output depends on KoBar's active language
```

### E. Native OS Capabilities via IPC (`window.api`)
You can use `window.api` to trigger desktop-level features:
* **Notifications**: `window.api.sendNotification('Title', 'Body message')`
* **Clipboard**: `window.api.writeToClipboard({ type: 'text', content: 'Hello' })`
* **File Execution**: `window.api.launchFile('C:\\path\\to\\app.exe')`
* **Media Controls**: `window.api.sendMediaCommand('play')` (play, pause, next, prev)
* **Screenshots**: `window.api.takeScreenshot(true)`
* **AI API**: `window.api.llmRequest(data)` (Streams via `window.api.onLlmStreamChunk`)
* **Window Control**: `window.api.hideApp()` or `window.api.moveWindow(dx, dy)`

---

## 4. Constraints: What CANNOT Be Done

1. **No Node.js APIs**: Do not use `require('fs')`, `require('path')`, or `require('child_process')`. They will throw an error.
2. **No `@electron/remote`**: Completely forbidden due to security policies.
3. **Bundling Required**: Because KoBar evaluates the `entry` file dynamically, you cannot use dynamic ES `import/export` statements that point to other local files at runtime. If your plugin has multiple files, you MUST use a bundler (like Webpack, Rollup, or Vite) to emit a single bundled `.js` file.
4. **Tailwind Class Collisions**: Be careful using Tailwind classes if you aren't sure they exist in the main bundle. Inline styles or CSS-in-JS are safer for guaranteed behavior.

---

## 5. Preparing the `manifest.json` (or `kobar.json`)

Your plugin repository MUST contain a `manifest.json` (or `kobar.json`) file in its root directory. This acts as your plugin's identity card.

### Example Manifest
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
    "languages": [
      "en",
      "tr",
      "de",
      "ar",
      "zh",
      "fr",
      "hi",
      "es",
      "ja",
      "ru"
    ]
}
```

### All Manifest Properties:

* **`id`** *(String, Required)*: Must be completely unique. Use reverse-domain format or something highly specific (e.g., `com.yourname.myplugin`).
* **`name`** *(String, Required)*: The display name of your plugin.
* **`version`** *(String)*: Semantic versioning (e.g., `1.0.0`). The Plugin Store bot will automatically override this with your latest GitHub Release tag.
* **`description`** *(String)*: A short description of what your plugin does.
* **`author`** *(String)*: Your name or organization name.
* **`entry`** *(String)*: The path to your compiled JavaScript file relative to the root of the ZIP. Defaults to `index.js` if omitted.
* **`icon`** *(String)*: A Material Symbols Outlined icon name (e.g., `extension`, `star`, `emoji_emotions`) used in the KoBar plugin list.
* **`image`** *(String)*: A URL to a banner image (recommended 600x400) displayed on the plugin's card in the store.
* **`storeImage`** *(Array of Strings)*: An array of up to 3 image URLs showcasing your plugin. Used for the detailed plugin view in the store.
* **`categories`** *(Array of Strings)*: Tags to help users find your plugin (e.g., `["Utility", "Design", "Productivity"]`).
* **`isBeta`** *(Boolean)*: If `true`, a BETA badge will be displayed on your plugin card.
* **`githubRepo`** *(String)*: Your repository path (e.g., `username/repo-name`). This is crucial. It is used by the Plugin Registry bot to fetch versions, download links, and release notes automatically.
* **`languages`** *(Array of Strings)*: A list of language codes your plugin supports (e.g., `["en", "tr", "de", "es"]`). Helps users know if the plugin is available in their language.
* **`versionNote`** *(String)*: A short note or changelog about the current version. The automated bot generally fetches full release notes from GitHub, but this can be used for manual or local distributions.

---

## 6. Publishing to the Registry

KoBar features a fully automated, community-driven Plugin Marketplace.

### The Automated Flow
1. You develop your plugin and push it to a GitHub repository.
2. You create a **GitHub Release** (e.g., `v1.0.0`) and attach your bundled plugin as a `.zip` file.
3. Fork the [kobar-plugins-registry](https://github.com/Kobar-Project/kobar-plugins-registry) repository.
4. Add your `Username/RepositoryName` to the `plugins.json` file.
5. Open a Pull Request.

### What the Bot Does
Once your PR is merged, a GitHub Action runs nightly (or on merge). The bot visits your repository, extracts your `kobar.json`/`manifest.json`, dynamically fetches your latest release tag and release notes, and compiles it into the centralized `registry.json`.

The KoBar desktop application downloads this lightweight `registry.json` file instantly, meaning your plugin will immediately appear in the Plugin Store inside the KoBar App without users needing to hit GitHub API rate limits.

---

## 7. Local Development & Testing (`pluginsPlayground`)

To make plugin development fast and seamless, KoBar includes a dedicated `pluginsPlayground` directory at the root of the project.

### What is it?
The `pluginsPlayground` is a safe, isolated directory where you can create and test plugins locally without having to bundle them into a `.zip` file, install them manually, or publish them to GitHub.

### Why does it exist?
During development, constantly bundling and reinstalling a plugin to test minor UI changes or logic tweaks is a slow process. The playground bypasses the standard installation flow, hot-loading your plugin directly into the active KoBar application.

### How does it work?
1. **Directory Scanning**: When KoBar starts (or when plugins are reloaded), the Electron main process (`main.cts`) explicitly scans the `pluginsPlayground` directory.
2. **Auto-Injection**: Every valid plugin folder inside the playground is dynamically parsed.
3. **[DEV] Prefix**: To differentiate local development plugins from installed production plugins, KoBar automatically prefixes the plugin name with `[DEV]`.
4. **Integration**: These playground plugins appear in the Plugin Store UI just like any regular plugin. You can click them to view details, and toggle them on/off using the standard switch. They have the same exact capabilities as production plugins.
