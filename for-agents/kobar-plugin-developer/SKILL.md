---
name: kobar-plugin-developer
description: Build, fix or review KoBar plugins (plugin API v1, KoBar 1.4.0 and later). Covers the trust model, the window globals, registering sidebar buttons, panels, settings panels and bar widgets, the rules the host enforces, a complete working example, and pointers to the full API reference, host behaviour, manifest/publishing and platform notes in references/.
---

# KoBar Plugin Developer

KoBar is a frameless, transparent, always-on-top Electron sidebar. A plugin is a `manifest.json` plus **one JavaScript file**
that the host injects into the bar's renderer, where it registers buttons, panels and widgets through `window.KoBarExtensions`.

This guide describes **plugin API v1 as shipped in KoBar 1.4.0 and later**. KoBar 1.4.0 (the "remaster") changed how the host
loads, places, themes, installs and updates plugins; code written from older notes often still runs but breaks in the places
listed in section 6. Version notes below name the first public release that has a behaviour (1.2 and 1.3 were never released).

| File | Read it when you |
|---|---|
| `SKILL.md` (this file) | start a plugin, or need the rules and the working example |
| [`references/api.md`](references/api.md) | call `window.api`, read `useAppStore`, use a registry member or a host DOM event |
| [`references/host-behaviour.md`](references/host-behaviour.md) | place or style a panel, store data, handle workspaces, hit a permission or security limit |
| [`references/manifest-and-publishing.md`](references/manifest-and-publishing.md) | write the manifest, build, package, publish, update, or test locally |
| [`references/platforms.md`](references/platforms.md) | target macOS as well as Windows |

## 1. Trust model (read first)

**Plugins run with full privileges.** A plugin is not sandboxed: it runs in the same renderer realm as KoBar itself, so it can
read and write all of `localStorage` (including the app's stores and other plugins' data), call every `window.api` method,
change the DOM and the app store, and read other workspaces' and other plugins' data. Installing a plugin means trusting its
code completely. The host adds friction (confirmation dialogs, rate limits, path checks, allow-lists; see
`references/host-behaviour.md` section 8), but it cannot prove that a call came from a real user action, so none of this is
isolation. Write plugins that never touch data that is not theirs.

## 2. Rules the host enforces or relies on

1. **One classic script, bundled.** The host wraps your entry file in `(() => { … })()` and runs it as a blob
   `<script data-extension-id="<id>">`. `import`/`export` statements are syntax errors there. Multi-file or JSX sources must be
   bundled to a single **IIFE** file with `react` / `react-dom` as externals mapped to `window.React` / `window.ReactDOM`.
2. **No Node.js.** `require`, `fs`, `child_process` and `@electron/remote` do not exist. Host services come only through the
   globals in section 3.
3. **Register synchronously, at the top level of your script.** The registry records which plugin registered what by looking
   at `document.currentScript`, which is only set while your script's first, synchronous run is executing. A registration made
   later (after `await`, in a timer or a promise) has no known owner; then the host cannot unload your plugin alone and reloads
   every plugin whenever any plugin is disabled.
4. **Know your own id.** Read it once at the top level: `const PLUGIN_ID = document.currentScript?.dataset.extensionId ?? 'your.manifest.id';`.
   It is your manifest `id`, or `dev-<id>` when the plugin runs from the local playground.
5. **Register your settings panel under your plugin id** (`registerSettingsPanel(PLUGIN_ID, …)`). The host looks it up by that
   id; any other key is never shown.
6. **Use the same id for your sidebar button and its panel.** KoBar 1.4.0 to 1.4.3 mark the button active only then; later
   releases also match a button and a panel registered by the same plugin, but the shared id works everywhere.
7. **One root element per panel, readable on dark.** The host wraps v1 plugin UI in a dark colour scheme, moves your panel's
   root element with the CSS `translate` property when the user drags it, and never restyles your content. Do not set
   `translate` on that root.
8. **Make interactive UI hit-testable.** The window is a click-through overlay. Your panel inherits hit-testing from the bar,
   but anything you portal elsewhere (for example `ReactDOM.createPortal(…, document.body)`) needs the
   `pointer-events-auto no-drag-region` classes.
9. **Clean up after yourself.** Disabling or unloading a plugin removes its script and registrations, but timers, `window`
   listeners and `window.api.on*` subscriptions started outside React keep running until the window reloads, and a re-enable
   runs your script again next to them. Start such work inside components and stop it in the `useEffect` cleanup (every `on*`
   method returns an unsubscribe function), or guard it with a flag on `window`.
10. **Own your storage names.** Prefix `localStorage` keys with your plugin id. Ids and keys starting with `kobar` or `kobox`
    are reserved for KoBar and its official plugins.
11. **Expect refusals.** Many `window.api` calls can be refused or limited (user confirmation, rate limit, a path the user did
    not pick, an unsupported platform). Check every result and feature-check host additions with `typeof window.api.x === 'function'`.

## 3. Globals

| Global | What it is |
|---|---|
| `window.React` | The host's React 19. Use `createElement` and the hooks. Never bundle your own React. |
| `window.ReactDOM` | The host's `react-dom` module (`createPortal`, `flushSync`). It is **not** `react-dom/client`: there is no `createRoot`. |
| `window.useAppStore` | The host's Zustand store: call it as a hook (`window.useAppStore((s) => s.edgePosition)`) or use `getState()`, `setState()`, `subscribe()`. Fields: `references/api.md` section 3. |
| `window.api` | The IPC bridge to the main process. Full list with status: `references/api.md` section 1. |
| `window.KoBarExtensions` | The extension registry: `registerSidebarButton`, `registerPanel`, `registerSettingsPanel`, `registerInlineWidget`, `getData`, `setData`. See `references/api.md` section 2. |

## 4. A complete plugin

`manifest.json`:

```json
{
  "id": "com.example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "description": "Says hello from the KoBar sidebar.",
  "author": "Your Name",
  "entry": "index.js",
  "icon": "waving_hand",
  "githubRepo": "your-name/kobar-hello"
}
```

`index.js` (no build step needed; KoBar wraps it in a function, so top-level `const` is private to the plugin):

```javascript
// Read once, synchronously: `com.example.hello`, or `dev-com.example.hello` in the playground.
const PLUGIN_ID = document.currentScript?.dataset.extensionId ?? 'com.example.hello';
const { createElement: h, useState } = window.React;
const { useAppStore, KoBarExtensions } = window;

const STRINGS = {
    en: { title: 'Hello', greet: 'Hello, {name}!', name: 'Name', close: 'Close' },
    tr: { title: 'Merhaba', greet: 'Merhaba, {name}!', name: 'Ad', close: 'Kapat' },
};
const tr = (lang, key) => (STRINGS[lang] ?? STRINGS.en)[key] ?? STRINGS.en[key];

// Place the panel next to the bar. The panel is rendered inside the bar's wrapper (position: relative),
// so 100% means "just outside the bar" on every edge, docked or free-floating.
function placement(edge) {
    const gap = 10;
    if (edge === 'left') return { left: '100%', top: 0, marginLeft: gap };
    if (edge === 'right') return { right: '100%', top: 0, marginRight: gap };
    if (edge === 'top') return { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: gap };
    return { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: gap };
}

function HelloPanel({ onClose }) {
    const edge = useAppStore((s) => s.edgePosition);
    const lang = useAppStore((s) => s.language);
    const { name } = KoBarExtensions.getData(PLUGIN_ID, { name: 'KoBar' });
    return h(
        'div',
        {
            // One root element. Hit-testing comes from the bar wrapper; the classes keep it working if you portal it later.
            className: 'pointer-events-auto no-drag-region',
            style: {
                position: 'absolute',
                ...placement(edge),
                width: 260,
                padding: 16,
                borderRadius: 12,
                background: 'var(--theme-bg-dark)',
                border: '1px solid var(--theme-border)',
                color: 'rgba(255, 255, 255, 0.92)',
                boxShadow: '0 8px 28px rgba(0, 0, 0, 0.32)',
            },
        },
        h('h2', { style: { margin: '0 0 8px', fontSize: 15 } }, tr(lang, 'title')),
        h('p', { style: { margin: '0 0 12px' } }, tr(lang, 'greet').replace('{name}', name)),
        h('button', { className: 'text-primary', onClick: onClose }, tr(lang, 'close'))
    );
}

function HelloSettings() {
    const lang = useAppStore((s) => s.language);
    const [data, setDataState] = useState(() => KoBarExtensions.getData(PLUGIN_ID, { name: 'KoBar' }));
    const update = (name) => {
        const next = { ...data, name };
        setDataState(next);
        KoBarExtensions.setData(PLUGIN_ID, next); // workspace-aware, persisted, included in backups
    };
    return h(
        'label',
        { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        tr(lang, 'name'),
        h('input', { value: data.name, onChange: (e) => update(e.target.value), style: { flex: 1 } })
    );
}

// All registrations: synchronous, top level, one shared id for button and panel.
KoBarExtensions.registerSidebarButton({
    id: PLUGIN_ID,
    icon: 'waving_hand', // Material Symbols Outlined name
    label: tr(useAppStore.getState().language, 'title'), // tooltip; read once at registration
    onClick: (event, anchorRect) => {
        const store = useAppStore.getState();
        const isOpen = store.activeExtensionPanelId === PLUGIN_ID;
        store.closeAllUtilityPopups();
        if (!isOpen) useAppStore.setState({ activeExtensionPanelId: PLUGIN_ID, activeExtensionAnchorRect: anchorRect });
    },
});
KoBarExtensions.registerPanel(PLUGIN_ID, { id: PLUGIN_ID, render: (props) => h(HelloPanel, props) });
KoBarExtensions.registerSettingsPanel(PLUGIN_ID, { id: PLUGIN_ID, render: () => h(HelloSettings) });
```

Where things appear:
- The **button** sits in the bar in the user's order (`featureOrder`); its `label` is the tooltip.
- The **panel** opens next to the bar while `activeExtensionPanelId` equals its id. The host passes `onClose` and
  `anchorRect`. `anchorRect` is the **bar's** rectangle in window coordinates, not the button's; the button's own rectangle is
  `event.currentTarget.getBoundingClientRect()`. The user can drag the panel along the bar (Alt+Arrow keys, double-click to
  reset); see `references/host-behaviour.md` section 2.
- The **settings panel** is reached from Settings > Plugins > Installed (the "tune" icon). The Settings window has no plugin
  runtime, so your settings panel is rendered in the **main window's** note panel, inside a dark wrapper.
- An **inline widget** (`registerInlineWidget(id, { id, render })`) is rendered directly in the bar instead of a button; it is
  the right choice for a small toggle or status control. Give its root `pointer-events-auto` if it is interactive.

## 5. Localisation

`useAppStore.getState().language` is one of `en`, `tr`, `de`, `es`, `fr`, `ja`, `ru`, `ar`, `hi`, `zh` (`ar` is right-to-left).
Ship your own strings with an English fallback, as above. `store.t(key)` translates **host** keys only; do not rely on it for
your plugin's text. Re-read the language in components (the hook form re-renders on change); a button `label` is read once at
registration.

## 6. What changed in KoBar 1.4.0 (check old plugins against this)

- **Partial reloads.** Enabling, disabling or a workspace switch inside the same data namespace loads or unloads only the
  plugins whose state changed. Your module-scope state survives such switches, and asynchronous registrations force a full
  reload of every plugin (rule 3).
- **Panels are host-wrapped.** The host wraps the panel in a dark-scheme `display: contents` element and lets the user drag it
  along the bar, storing a per-panel offset (rule 7).
- **Theme.** `--theme-*` variables and `bg-primary`/`text-primary` now follow the user's accent colour; the light scheme
  exists for host UI, and v1 plugin UI is always rendered in the dark scheme.
- **Settings.** Settings moved to a separate window; plugin settings panels are found by plugin id (rule 5).
- **Install and update.** Install/update rules are stricter: required fields, id format, `apiVersion`/`minAppVersion` gate,
  confirmations, no downgrades, release tag = installed version, ZIP installs get no updates. See
  `references/manifest-and-publishing.md`.
- **Path checks.** File arguments must come from a user drop or pick (`window.api.getFilePath`).
- **KoBox.** `dropToKoBox` moves items into KoBox instead of copying them.
- **Paste.** Global paste is serialised by the host (`window.api.globalPasteVersion === 2`).
- **Licensing.** Licensing is gone: `getHwid()` resolves `null`, `isLicensed` is always `true`; both are removed in 2.0.

## 7. Working on a plugin with an agent

- Develop and test inside `<repo>/pluginsPlayground/<your-plugin>/` (git-ignored; loaded only by an unpackaged `npm run dev`
  build). Never edit KoBar's own source (`src/`, `electron/`) for a plugin task.
- If the plugin has a build step, **run it yourself after every change** (for example `node build.mjs`); KoBar loads only the
  built entry file, never `.jsx`/`.tsx` sources. Then reload the KoBar window: there is no file watcher.
- Before you finish, walk the checklist below.

## Checklist

1. [ ] Single bundled IIFE entry, no `import`/`export`, React from `window.React`?
2. [ ] Every registration synchronous at the top level; `PLUGIN_ID` read from `document.currentScript`?
3. [ ] Settings panel registered under `PLUGIN_ID`; button and panel share an id?
4. [ ] Panel: one root element, positioned for all four edges, readable on dark, no `translate` on the root?
5. [ ] Timers, listeners and `window.api.on*` subscriptions cleaned up?
6. [ ] Storage keys prefixed with your id; no `kobar`/`kobox` prefix; secrets named `plugin-<id with . and _ as ->-<key>`?
7. [ ] Every `window.api` result checked; host additions feature-checked; platform limits handled (`references/platforms.md`)?
8. [ ] Strings for every language you claim, with an English fallback?
9. [ ] Manifest valid (`references/manifest-and-publishing.md` section 1); release ZIP contains the built entry?
