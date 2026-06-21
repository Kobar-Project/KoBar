---
name: kobar-plugin-developer
description: Expert agent for developing KoBar plugins. Use this skill when you need to create, modify, or debug plugins for the KoBar Electron/React application. It contains all architectural rules, API constraints, and registry publishing guidelines.
---

# KoBar Plugin Developer

You are an expert at developing plugins for KoBar, an Electron application with a React-based frontend. When tasked with creating, modifying, or debugging a KoBar plugin, you must strictly adhere to the following architectural rules, constraints, and API capabilities.

## 1. Core Architecture & Environment Constraints

The plugin system injects third-party features securely and seamlessly into the React frontend context. Your code runs directly inside the KoBar UI thread.

**🚨 CRITICAL CONSTRAINTS:**
1. **No Node.js Built-ins:** You CANNOT use `require('fs')`, `require('path')`, `require('child_process')`, etc. They will throw an error.
2. **No Remote Module:** `@electron/remote` is completely forbidden due to security policies.
3. **Strict Context Isolation:** The environment is strictly isolated. You only have access to specific `window` globals.
4. **Bundling is Mandatory:** Since KoBar evaluates the `entry` file dynamically, you cannot use dynamic ES `import/export` statements that point to other local files at runtime. If the plugin has multiple files, you MUST use a bundler (Webpack, Rollup, Vite) to emit a single bundled `.js` file.
5. **Styling Limitations:** Be careful using Tailwind classes if you aren't sure they exist in the main bundle. Inline styles or CSS-in-JS are recommended for guaranteed behavior.

## 2. Exposed Global Objects

Instead of bundling React or trying to access Node directly, KoBar provides powerful globals:

* `window.React`: The global React object. Use `React.createElement`, `React.useState`, `React.useEffect`, etc.
* `window.useAppStore`: The global Zustand state store instance. Used to read user settings, theme configs, or feature toggles.
* `window.api`: The Electron IPC bridge. Provides secure access to native OS capabilities.
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
- Second, Node.js module resolution automatically traverses up the directory tree. This means your plugin can often utilize libraries already installed in the main KoBar workspace (`d:\Work\Code\KoBar\node_modules`) such as `vite` or `react`, without needing a local `package.json`.
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

### E. Native OS Capabilities (`window.api`)
Trigger desktop-level features securely through the IPC bridge:

* **Notifications**: `window.api.sendNotification('Title', 'Body message')`
* **Clipboard**: `window.api.writeToClipboard({ type: 'text', content: 'Hello' })`
* **File Execution**: `window.api.launchFile('C:\\path\\to\\app.exe')`
* **Media Controls**: `window.api.sendMediaCommand('play')` (play, pause, next, prev)
* **Screenshots**: `window.api.takeScreenshot(true)`
* **AI API**: `window.api.llmRequest(data)` (Streams via `window.api.onLlmStreamChunk`)
* **Window Control**: `window.api.hideApp()` or `window.api.moveWindow(dx, dy)`

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

## 5. Publishing Workflow

KoBar uses an automated Plugin Marketplace:
1. Push plugin source to a GitHub repository.
2. Create a GitHub Release (e.g., `v1.0.0`) and attach the bundled plugin as a `.zip` file.
3. Fork [kobar-plugins-registry](https://github.com/Kobar-Project/kobar-plugins-registry).
4. Add `Username/RepositoryName` to `plugins.json`.
5. Open a Pull Request.

The bot automatically fetches the latest release, extracts the manifest, and updates the centralized `registry.json` used by the KoBar desktop application.

## 6. Local Development & Testing (`pluginsPlayground`)

KoBar features a built-in local testing environment called `pluginsPlayground`. This is a directory located at the root of the project (`\pluginsPlayground`).

**🚨 CRITICAL INSTRUCTION FOR THE AGENT:**
1. **Directory Restriction:** ALL plugin development, modifications, and testing MUST be done strictly inside the `pluginsPlayground` folder. You MUST NOT modify any of KoBar's main application source files (e.g., within `/src`, etc.) when working on a plugin task.
2. **Creation:** Unless explicitly told otherwise, ALWAYS create new plugins and their boilerplate files inside a new subfolder within the `pluginsPlayground` directory.

Plugins placed inside this directory are automatically injected into KoBar's plugin system with a `[DEV]` prefix. This allows you to instantly test, modify, and see changes to your plugin without needing to zip or publish it.

**🚨 MANDATORY BUILD STEP FOR LOCAL CHANGES:**
Even when developing locally in `pluginsPlayground`, if the plugin uses a build step (like `build.mjs` to transpile JSX), **the AI Agent MUST proactively run the build script (e.g., `node build.mjs`) after every modification.** KoBar only loads the compiled `index.js` file, NOT the raw `.jsx` source files. If you do not build the plugin, your changes will NOT be reflected in the application. Do not wait or ask the user to run it; YOU must execute the build command automatically.
