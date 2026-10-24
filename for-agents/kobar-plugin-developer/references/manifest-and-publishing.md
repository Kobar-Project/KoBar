# Manifest, packaging, publishing and local testing

Rules as enforced by KoBar 1.4.0 and later. A package that breaks a rule marked **refused** is rejected before anything is
written to the user's plugin folder.

## 1. `manifest.json`

Every plugin has a `manifest.json` at the root of its package.

```json
{
  "id": "com.example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "description": "Says hello from the KoBar sidebar.",
  "author": "Your Name",
  "entry": "dist/index.js",
  "icon": "waving_hand",
  "image": "https://raw.githubusercontent.com/your-name/kobar-hello/main/banner.png",
  "storeImage": ["https://raw.githubusercontent.com/your-name/kobar-hello/main/shot-1.png"],
  "categories": ["Utility"],
  "isBeta": false,
  "githubRepo": "your-name/kobar-hello",
  "versionNote": "First release",
  "minAppVersion": "1.4.0"
}
```

| Field | Required | Rules and use |
|---|---|---|
| `id` | **yes** | 2-64 characters. It must start with a lowercase letter or digit; after that only lowercase letters, digits, `.`, `_` and `-` are allowed. No `..`, no trailing `.`, no Windows device names (`con`, `nul`, `com1` …). Uppercase is **refused**. The id becomes the folder name and the key of your settings panel, data and secrets, so never change it after release. Avoid the `kobar` / `kobox` prefixes: they are reserved by convention (not refused at install), and a backup restore never gives a third-party plugin keys that start with them. The 13 official plugin ids are reserved and refused from any source but the official `Kobar-Project` repositories. |
| `name` | **yes** | Display name. |
| `version` | recommended | Semantic version (`1.2.3`). Default `1.0.0`. For GitHub installs the release tag replaces it (section 4). Local ZIP replacements compare versions, and downgrades are refused. |
| `entry` | no | Path of the built script, relative to the manifest. Default `index.js`. It must stay inside the plugin folder (no absolute path, no `..`, no link out); otherwise **refused**. |
| `apiVersion` | no | Plugin API major version the plugin needs. Absent means 1. A value with major ≥ 2 is **refused** on hosts that speak API v1, with the message "please update KoBar". A malformed value is **refused** as an invalid manifest. |
| `minAppVersion` | no | Oldest KoBar version that can run the plugin (e.g. `"1.4.0"`). A newer value than the running app is **refused** ("please update KoBar"); a malformed value is **refused**. Set it when you use features that older hosts lack. |
| `description` | no | Shown in the plugin lists. |
| `icon` | no | Material Symbols Outlined name. Default `extension`. |
| `image` | no | Banner URL. |
| `storeImage` | no | Up to 3 screenshot URLs (more are ignored). |
| `categories` | no | Array of category names. |
| `isBeta` | no | `true` shows a beta badge. |
| `githubRepo` | for publishing | `owner/repo`. The registry uses it to find your releases (`githubLink` is accepted as an alias). The host never takes update sources from an installed manifest; see section 4. |
| `versionNote` | no | Short release note. |
| `author` | no | Shown in the store from the registry entry; the host does not read it from an installed manifest. |
| `languages` | no | Informational only; the host does not read it. |

## 2. Building

- **No build step:** write one plain `.js` file with `window.React.createElement` (see the example in `SKILL.md`).
- **With JSX, TypeScript or several files:** bundle to **one IIFE file**. Keep `react` and `react-dom` external and map them
  to the host's globals. A Vite library build:

```javascript
// build.mjs — run with: node build.mjs
import { build } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await build({
    root: __dirname,
    build: {
        lib: { entry: path.resolve(__dirname, 'src/index.jsx'), name: 'KoBarPlugin', formats: ['iife'], fileName: () => 'index.js' },
        outDir: path.resolve(__dirname, 'dist'),
        emptyOutDir: true,
        minify: false,
        rollupOptions: {
            external: ['react', 'react-dom'],
            output: { globals: { react: 'window.React', 'react-dom': 'window.ReactDOM' } },
        },
    },
    esbuild: { jsxFactory: 'window.React.createElement', jsxFragment: 'window.React.Fragment' },
});
console.log('Built dist/index.js');
```

  Point `entry` at the output (`dist/index.js`). KoBar cannot run `.jsx`/`.tsx`; a release without the built file installs
  and then shows nothing.
- **Dependencies.** KoBar does not provide libraries to plugins (its own `node_modules` are not available). If you really
  need a package, declare it in your own `package.json` and bundle it. Prefer browser APIs and the host globals, and never
  bundle a second React.

## 3. Packaging

- A ZIP whose root, or whose single top-level folder, contains `manifest.json` and the built entry. Do not ship
  `node_modules` or sources you do not need.
- Limits: at most 2,000 entries, 50 MB per file, 150 MB in total (the ZIP itself also at most 150 MB). Links, absolute paths
  and `..` entries are **refused**. macOS Finder metadata (`__MACOSX/`, `._*`, `.DS_Store`) is skipped.

## 4. Installing and updating (what users see)

| Source | How | Confirmation |
|---|---|---|
| Plugin store (registry) | Settings > Plugins > Discover | install dialog; "unverified plugin" warning unless the repository is under `Kobar-Project` |
| GitHub repository link | Settings > Plugins menu > "install from GitHub", which opens the form in the main window | same as above |
| Local ZIP | file dialog or drag and drop | install dialog with the "unverified plugin" warning |

- **GitHub installs and updates.** The host downloads the **first `.zip` asset of the latest GitHub release**. If the release
  has no `.zip` asset, it falls back to the repository's **source code archive**, which only works if the built entry is
  committed. Always attach a built ZIP. The release tag, without a leading `v`, becomes the installed `version`.
- **Updates.** Updates are checked only for plugins installed from the registry or GitHub, against the repository recorded
  at install time; your manifest cannot redirect them. An update is offered only when the latest release tag is a strictly
  greater semantic version than the installed one, so tag releases `v1.0.0`, `v1.0.1` … and keep `version` in step.
  **Plugins installed from a local ZIP never get update offers.**
- **Replacing an installed plugin with a ZIP** needs a second confirmation that names both versions. A lower version is
  refused, and so are versions that cannot be compared.
- Installing a plugin enables it. The user can disable it per workspace.

## 5. Publishing to the KoBar plugin store

1. Push the plugin to a public GitHub repository (`githubRepo` in the manifest must match it).
2. Create a GitHub release tagged with the version (`v1.0.0`) and attach the built ZIP (section 3).
3. Fork [kobar-plugins-registry](https://github.com/Kobar-Project/kobar-plugins-registry), add `owner/repo` to
   `plugins.json` and open a pull request.
4. After the merge, the registry bot reads your latest release and manifest and updates `registry.json`, which KoBar loads in
   Settings > Plugins > Discover.

## 6. Local development (`pluginsPlayground`)

- Create `<KoBar repo>/pluginsPlayground/<your-plugin>/` with `manifest.json` and the built entry. The folder is git-ignored
  and only an **unpackaged** KoBar (`npm run dev`) loads it.
- Playground plugins are listed as `[DEV] <name>`. They are enabled by default, always marked beta, and cannot be
  uninstalled from the UI. Their id becomes **`dev-<id>`**, so read the id from `document.currentScript` (`SKILL.md` rule 4)
  instead of hard-coding it. In a development run a local ZIP may also use an official id.
- There is no file watcher. After rebuilding, disable and re-enable the plugin in Settings > Plugins (which injects the new
  code), or restart `npm run dev`. Anything your old copy started outside React is still running until the window reloads
  (`host-behaviour.md` section 1).
- KoBar's e2e smoke test (`tests/e2e/smoke.spec.ts`) refuses to run while `pluginsPlayground/` exists; move or rename the
  folder before running it.
- **Agent rules.**
  - Do all plugin work inside `pluginsPlayground/<your-plugin>/` and never modify KoBar's own sources for a plugin task.
  - Create new plugins in a new subfolder there unless told otherwise.
  - If the plugin has a build step, run it yourself after every change.
