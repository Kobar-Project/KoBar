# How the KoBar host treats your plugin

What the host does around your code (KoBar 1.4.0 and later): loading, panels, theme, hit-testing, storage, styling,
permissions and the security limits. Names of `window.api` members are explained in `api.md`.

## 1. Loading, reloading and unloading

- **Injection.** The host reads your manifest's `entry` file, wraps it as `(() => {\n<your code>\n})();` and appends it to
  `<head>` as a blob `<script data-extension-id="<id>">`. Your script runs once per load. A top-level `return` is legal;
  `import`/`export` are not.
- **Your id.** `<id>` is your manifest `id`, or `dev-<id>` for a playground copy. During the first, synchronous run
  `document.currentScript.dataset.extensionId` returns it; afterwards `document.currentScript` is `null`.
- **Ownership.** Each registration is recorded with the id of the script that is running at that moment. A registration
  without an owner (made after `await`, in a timer, in a promise or in an event handler) cannot be attributed to you.
- **Full vs partial loads.**
  - Install, update, and a workspace switch that changes the plugins' data namespace do a **full load**: the registry is
    cleared and every enabled plugin runs again.
  - Enabling or disabling a plugin, uninstalling it, and a workspace switch inside the same data namespace do a **partial
    load**: only plugins whose enabled state changed are injected or unloaded, and the others keep their module state.
  - If any registration has no known owner, a partial unload is impossible and the host falls back to a full load. That is
    why every registration must be synchronous.
- **Unloading is not a teardown.** The host removes your `<script>` and your registrations. Anything you started outside
  React (intervals, `window`/`document` listeners, `window.api.on*` subscriptions, globals you set) keeps running until the
  window reloads, and a later re-enable runs your script again beside it. Start such work in components and stop it in the
  `useEffect` cleanup, or guard module-level work with a flag (`if (window.__myPluginStarted) return; window.__myPluginStarted = true;`).
- **Workspace switches.**
  - Between shared workspaces, or between a shared workspace and Default, your script is **not** re-run. You receive the
    `window` event `kobar:workspace-changed` (`event.detail.workspaceId`) and your registered components remount.
  - Switching to, from or between **isolated** workspaces re-runs every plugin, so module-scope code reads the new namespace.
  - Every switch closes the open plugin panel.
  - Between the switch and the re-run, the old instance of your plugin is still alive while storage already points to the
    new workspace. Do not write cached in-memory state to storage on mount or on unmount; re-read storage when your
    component mounts.
- **Where plugins run.** Only in the main (bar) window. The Settings window and the PiP window have no plugin runtime:
  `window.React`, `window.useAppStore` and `window.KoBarExtensions` do not exist there.

## 2. Panels

- **Placement.** The panel is rendered inside the bar's wrapper element (`#kobar-sidebar-wrapper`, `position: relative`,
  sized to the bar). The simplest robust placement is relative to it: `left: 100%` for a bar on the left edge, `right: 100%`
  on the right, `top: 100%` on the top, `bottom: 100%` on the bottom, plus a small gap (see the example in `SKILL.md`).
  This works for docked and free-floating bars.
- **`anchorRect`** is the bar's rectangle in window coordinates, not the button's. For a popup that follows its launch icon,
  measure `event.currentTarget.getBoundingClientRect()` in the button's `onClick`. Use `screenBounds` to keep it on screen.
- **Bar moved.** While the user drags a free-floating bar, `document` receives `kobar-drag` events (`detail: { x, y }`).
  The orientation and edge come from `useAppStore` (`orientation`, `edgePosition`, `sidebarPosition`).
- **User dragging (since 1.4.0).** The host lets the user move your panel along the bar's free axis: left/right on a
  horizontal bar, up/down on a vertical one.
  - The drag starts from a grip the host draws above your panel, or from the top 36 px of your panel outside controls.
  - Keyboard: Alt+Arrow keys move the panel in 16 px steps. A double-click on the grip or the strip resets it.
  - The offset is saved per panel id and clamped to the usable screen area.
  - The host applies it with the CSS **`translate`** property on your panel's **first element**, which leaves your own
    `transform` alone. So:
    - return one root element;
    - never set `translate` on it;
    - add `data-no-panel-drag` to any non-standard control in that top strip that must keep its own pointer behaviour.
      Buttons, links, inputs, `label`, `[role=button|slider|textbox]` and `contenteditable` already opt out.
- **Closing.** Call the `onClose` prop (it sets `activeExtensionPanelId` to `null`). The host does not close v1 panels on
  Escape or on outside clicks; add that yourself if you want it. Mini mode hides the panel, and a workspace switch closes it.
  To toggle from your button, see the example in `SKILL.md`.
- **Layers.** Your panel lives in the bar's stacking context. You rarely need `z-index`; when you do, keep it small (≤ 50).
  Huge values do not lift you above host dialogs and only make overlaps harder to reason about.

## 3. Theme and appearance

- Since 1.4.0 the host has light and dark schemes, eight accent colours plus a custom one, a solid or translucent material,
  and three densities. **v1 plugin UI is always rendered inside a dark-scheme wrapper** (panels, inline widgets, settings
  panels), because v1 plugins hard-code light text. Design for a dark background.
- `--theme-primary` (and `bg-primary` / `text-primary` / `border-primary`) is the user's accent colour.
- `--theme-bg-dark`, `--theme-bg-base`, `--theme-surface`, `--theme-border` and `--theme-scrollbar` follow the dark scheme
  inside the wrapper. Use them for surfaces and borders so your plugin matches the bar.
- `useAppStore` `design === 'style2'` means the translucent material (`glassOpacity` is its opacity). It is a legacy view of
  the new appearance model; read it if you want to match the glass look, never write it.
- The `--kb-*` design tokens and the `src/ui` components belong to the host and are not part of the plugin contract.

## 4. Hit-testing, dragging and text selection

- The main window is a transparent, click-through overlay: the page root is `pointer-events: none`. On every mouse move the
  host checks whether the element under the pointer is inside a `.pointer-events-auto` element and switches the OS
  click-through on or off. Inside the bar wrapper (your panels and widgets) this already holds.
- Anything rendered elsewhere, for example a `ReactDOM.createPortal` into `document.body` or a full-screen overlay, must
  carry `pointer-events-auto` (and `no-drag-region`) or clicks fall through to the desktop.
- Text selection is off globally (`* { user-select: none }`); inputs, textareas and `contenteditable` stay selectable. Add
  `select-text` (Tailwind) to text the user should be able to select.
- Native drag is off except on `[draggable="true"]` elements.

## 5. Storing data

| Option | Scope | Notes |
|---|---|---|
| `KoBarExtensions.getData(id, default)` / `setData(id, data)` | per workspace data namespace | **Recommended for settings and small state.** Stored in KoBar's own store (file-backed, rotated backups, migrations), included in full backups and in isolated-workspace snapshots. JSON-serialisable values only; keep it small (the whole store is rewritten on change). |
| `localStorage` | per workspace data namespace | Fine for larger plugin data. Prefix every key with your id (`<id>`, `<id>:x`, `<id>.x`, `<id>_x`, `<id>-x` or `<id>/x`). In an isolated workspace the host transparently stores your key as `<key>_iso_<workspaceId>`; you keep using the plain name. `localStorage.clear()` is ignored in shared workspaces (it would delete other plugins' data); use `removeItem`. |
| `window.api.setSecret` | global | API keys and tokens, encrypted by the OS, write-only for the renderer (`api.md` 1.5). |
| IndexedDB / Cache API | global | Not isolated per workspace and not included in backups. |

- **Reserved names.** Ids and keys starting with `kobar` or `kobox` (`kobar-`, `kobar_`, `kobox-` …, case-insensitive)
  belong to KoBar and its official plugins. This is a convention that installs do not check, but backup restore enforces it
  (next point).
- **Backup restore.** A full restore writes a plugin's `localStorage` keys only when it can tell which installed plugin owns
  them: the key must start with the plugin id followed by one of the separators above. Keys of a third-party plugin in the
  reserved namespace, or keys that do not start with its id, are skipped.
- **Workspace isolation is not a privacy boundary.** Isolation only renames keys. Any plugin can still reach any data
  (`localStorage.key()`, `getData` with another id).

## 6. Styling

- **Tailwind.** The host ships the Tailwind v4 runtime compiler (`@tailwindcss/browser`). Utility classes your plugin adds
  to the DOM are generated when they first appear, including arbitrary values (`w-[312px]`), so you do not need to bundle
  Tailwind. The runtime uses Tailwind's default theme plus the host's accent utilities (`bg-primary` and friends). Inline
  styles remain the most predictable choice for layout-critical values.
- **Icons:** `<span class="material-symbols-outlined">name</span>`. Material Symbols Outlined is bundled; no network needed.
- **Fonts:** the system UI font is the default. `"Space Grotesk"` still resolves for v1 plugins.
- **Scrollbars:** `custom-scrollbar` styles a scroll container on Windows (macOS keeps native overlay scrollbars);
  `scrollbar-hide` hides it.
- **Motion:** under the OS "reduce motion" setting the host shortens every animation and transition to ~0 ms and stops
  `animate-spin`/`animate-pulse`/`animate-ping`/`animate-bounce`. Your animations should still make sense without motion.
- **Localisation:** ship your own strings for the ten UI languages you claim, with an English fallback. Arabic (`ar`) is
  right-to-left: prefer logical CSS properties (`margin-inline-start`, `ps-*`) for text layout.

## 7. Browser APIs and permissions

- Chromium permission requests are **denied by default**. The only one granted is `clipboard-sanitized-write`, which is what
  `navigator.clipboard.writeText` needs. Camera, microphone, geolocation, web notifications, clipboard read, MIDI and the
  other permissioned APIs are refused. Use `window.api.sendNotification` for notifications and the clipboard listener for
  reading the clipboard.
- The `EyeDropper` API works (no permission needed).
- `fetch` is not restricted by the host. Requests come from a `file://` page (`Origin: null`), so servers that require a
  specific origin will refuse them.

## 8. Security limits

None of these are isolation (see the trust model in `SKILL.md`). They make abuse slower, rarer or more visible, and your
plugin has to handle them:

- **Confirmations.** Installing, replacing, uninstalling and updating plugins ask for confirmation in a main-process dialog.
  Turning on launch at login asks too.
- **User-selected paths.** File arguments of `parseFile`, `dropToKoBox`, `saveScreenshot` and `installExtensionFromPath`
  must come from a user drop or pick; `getFileIcon` accepts only plain absolute local paths (`api.md` 1.3).
- **`launchFile` and `openExternal`:** scheme allow-lists, confirmations and refusals (`api.md` 1.1, 1.3).
- **Rate limits.** Screen capture is rate-limited (1 per second, 10 per minute) and every capture shows a visible flash.
  Notifications are rate-limited and sanitised.
- **Global paste** only works right after the host asked for it.
- **Secrets** are write-only for the renderer and restricted to the `plugin-` namespace.
- **ZIP packages** are size- and entry-limited; links, absolute paths and `..` entries are rejected.
- **Plugin updates** come only from the source recorded at install time, never from your manifest.
- **`askForUpdate`** shows fixed text, whatever arguments are passed.
