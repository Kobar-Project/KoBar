# KoBar plugin API v1: reference

Every member of `window.api`, the store fields plugins may read, the registry, and the host DOM/CSS contract.
Source of truth in the KoBar repository: `electron/preload.cts` (the `window.api` object), `shared/ipc-contract.ts` (payload
types), `src/components/extensions/extensionRegistry.ts` (registry) and the plugin contract tests under `tests/`.

**Status legend**

| Mark | Meaning |
|---|---|
| **C** | Contract. Used by official plugins and pinned by the host's tests; name, arguments and result stay stable for API v1. |
| **A** | Available. Works for plugins but is a host addition; feature-check it (`typeof window.api.x === 'function'`) because older releases lack it. |
| **H** | Host-internal. KoBar's own UI uses it. Plugins must not call it: it can change, be restricted or disappear in any release. |
| **L** | Legacy. Kept so v1 plugins do not crash; does nothing useful. Removed in plugin API v2. |

Every `on*` method takes a callback (the IPC event object is stripped; the callback receives only the payload) and **returns an
unsubscribe function** that removes exactly that callback. Call it in your `useEffect` cleanup.

## 1. `window.api`

### 1.1 App, window and display

| Member | Status | Signature and notes |
|---|---|---|
| `hideApp` | C | `hideApp(): void`. Hides the main window (the tray brings it back). |
| `setIgnoreMouseEvents` | C | `setIgnoreMouseEvents(ignore: boolean): void`. Sets the window's click-through (with mouse-move forwarding). The host recomputes it on every mouse move from `.pointer-events-auto`, so your value only lasts until the pointer crosses a boundary; prefer the CSS class. |
| `getPlatform` | A | `getPlatform(): 'win32' \| 'darwin' \| 'linux'` (synchronous). The store's `isMac` is derived from it. |
| `getAppVersion` | A | `getAppVersion(): Promise<string>`, e.g. `"1.4.3"`. |
| `isDev` | A | `isDev(): Promise<boolean>`. `true` for an unpackaged development run. |
| `getScreenBounds` | A | `getScreenBounds(): Promise<{x, y, width, height}>`: on Windows the usable area (work area, without the taskbar) of the display the bar is on. |
| `getDisplaysInfo` | A | `getDisplaysInfo(): Promise<{ primaryDisplay, allDisplays }>` (Electron display objects: `id`, `bounds`, `workArea`, `scaleFactor`, …). |
| `openExternal` | C | `openExternal(url: string): void`. Allow-listed schemes (`http:`, `https:`, `mailto:`, `tel:` and a few meeting apps) open directly; other schemes ask the user; dangerous schemes (`javascript:`, `data:`, `blob:`, `file:`, `ms-msdt:`, `search-ms:`, `shortcuts:`, `applescript:`, …), URLs with credentials and malformed URLs are refused silently. |
| `sendNotification` | C | `sendNotification(title: string, body: string): void`. Native notification with the KoBar icon. Rate-limited (at least 500 ms apart, at most 5 per 10 s; excess calls are dropped silently). Title is cut to 100 characters, body to 300; newlines and control characters become single spaces. |
| `quitApp` | H | Quits KoBar. |
| `moveWindow` | H | `moveWindow(dx, dy)` moves the **calling window**. It exists for the PiP window. Called from a plugin it shifts the whole main overlay (which covers the display on Windows) off screen. Never call it. |
| `getWindowPositionSync`, `recenterWindowOnWidget`, `getWindowGeometry`, `onWindowGeometryChanged`, `updateSidebarRect`, `onEdgeChanged`, `onForceCenterMiniMode`, `onOpenSettings` | H | Window model and bar layout plumbing. |

### 1.2 Clipboard and global paste (Clipboard Manager)

Agents and tests must not read or write the user's system clipboard without the user's knowledge; use these only for a
user-visible clipboard feature.

| Member | Status | Signature and notes |
|---|---|---|
| `writeToClipboard` | C | `writeToClipboard({ type: 'text' \| 'image', content: string }): void`. `image` content is a data URL. In a browser context `navigator.clipboard.writeText` also works (the only Chromium clipboard permission granted). |
| `startClipboardListener` | C | `startClipboardListener(): void`. Subscribes this window to clipboard changes; polling starts with the first subscriber (Windows 500 ms, macOS 1000 ms). The content present at start is not announced. Repeated calls count once. |
| `stopClipboardListener` | C | `stopClipboardListener(): void`. Ends this window's subscription; polling stops with the last subscriber (also when the window reloads or closes). |
| `onClipboardUpdate` | C | `onClipboardUpdate(cb: ({ type: 'text' \| 'image', content }) => void)`. Only for subscribed windows. On macOS, content that password managers mark as concealed is never announced. |
| `setGlobalPasteMode` | C | `setGlobalPasteMode(active: boolean): void`. `true` takes over the global Ctrl+V / Cmd+V shortcut; each press sends `request-next-paste`. `false` releases it. |
| `onRequestNextPaste` | C | `onRequestNextPaste(cb: () => void)`. One event per paste press while paste mode is on. |
| `executeGlobalPaste` | C | `executeGlobalPaste({ type, content }): void`. Honoured once, within about 3 s after a `request-next-paste`; the first call consumes it, any other call does nothing. |
| `globalPasteVersion` | A | `2` since KoBar 1.4.0 (absent before: treat as 1). With 2 the host serialises presses itself (one paste at a time, a held key pastes once, presses during a paste are queued): call `executeGlobalPaste` at most once per `request-next-paste` and drop your own debounce. Keep a debounce only when `(window.api.globalPasteVersion ?? 1) < 2`. |
| `onClipboardPasteError` | A | `onClipboardPasteError(cb: ({ error: string, message: string }) => void)`. A paste could not be performed, e.g. `{ error: 'accessibility_required' }` when macOS has not granted KoBar the Accessibility permission. |

### 1.3 Files, launcher and parsing

**User-selected paths only.** `parseFile`, `dropToKoBox`, `saveScreenshot({ destinationPath })` and the host's
`installExtensionFromPath` accept only the exact path of a file the user dropped or picked. Obtain it from the `File` object
with `window.api.getFilePath(file)` inside the drop/change handler, then pass the string on. The grant lasts about 10 minutes;
a folder grant does not cover the files inside it. A path typed, stored or built by the plugin is refused and the user sees a
localised notice (at most one per 10 s).

| Member | Status | Signature and notes |
|---|---|---|
| `getFilePath` | C | `getFilePath(file: File): string` (synchronous). The real path of a dropped/picked file (`''` otherwise); also records the user-selected grant. |
| `getFileIcon` | C | `getFileIcon(path: string): Promise<string \| null>`. PNG data URL of the OS icon. Plain absolute local paths only; UNC paths, relative paths and anything else resolve `null` (an unexpanded `%VAR%` path is relative, so it resolves `null` too). |
| `launchFile` | C | `launchFile(pathOrUrl: string): void`. Absolute local paths (also `.lnk`, folders) and URLs. A `file:` URL that points at a local path is opened as that path; one with a remote host asks like a UNC path. Relative paths and device paths (`\\?\`, `\\.\`) are refused; UNC paths and non-allow-listed URL schemes ask the user; dangerous schemes and URLs with credentials are refused. macOS: scripts/automation files ask first, files inside KoBar's own data folders are refused. |
| `parseFile` | C | `parseFile(path: string): Promise<{ type: 'text' \| 'image' \| 'error', content: string, error?: string }>`. Never throws. Text extraction (PDF text capped at 2,000,000 characters); images return a data URL. The path must be absolute and user-selected, the extension on the allow-list, the file at most 50 MB, and outside KoBar's app data and KoBox. A path the user did not pick resolves `{ type: 'error', content: 'Error: not-user-selected', error: 'not-user-selected' }`. |

### 1.4 AI requests (AI Hub)

| Member | Status | Signature and notes |
|---|---|---|
| `llmRequest` | C | `llmRequest({ chatId, messageId, provider, model, messages, apiKeys?, systemPrompt? }): Promise<void>`. `provider` is `'openai'`, `'gemini'`, `'anthropic'` or `'local'`. `messages` are OpenAI-style chat messages (`content` may be an array of `{type:'text'}` / `{type:'image_url'}` parts). `apiKeys` is `{ openai?, gemini?, anthropic?, localUrl? }`; the key for `provider` is sent to that provider's fixed endpoint. `localUrl` must be a loopback address (e.g. `http://localhost:11434`), anything else is refused. The promise resolves when the request ends; the text arrives through the events below. |
| `cancelLlmRequest` | C | `cancelLlmRequest(messageId: string): Promise<void>`. |
| `onLlmStreamChunk` | C | `cb({ chatId, messageId, chunk })`. |
| `onLlmStreamEnd` | C | `cb({ chatId, messageId })`. |
| `onLlmStreamError` | C | `cb({ chatId, messageId, error })`. |

**Known limit:** `llmRequest` needs the API key in the call, but a value stored with `setSecret` never comes back to the
renderer. A plugin therefore cannot use an encrypted secret for `llmRequest` today; it has to keep the key in its own storage,
where every other plugin can read it. Tell your users so. Letting the host use a stored secret directly is planned for plugin
API v2.

### 1.5 Encrypted secrets

Host addition of KoBar 1.4.0 (**A**; feature-check `typeof window.api.setSecret === 'function'`).

| Member | Signature |
|---|---|
| `setSecret` | `setSecret(name, value): Promise<SecretResult>` |
| `getSecretStatus` | `getSecretStatus(name): Promise<SecretResult>` |
| `deleteSecret` | `deleteSecret(name): Promise<SecretResult>` |

`SecretResult` is `{ success, reason?, status?: { name, exists, last4, encryptionAvailable, unreadable } }`. The value is
encrypted with the OS (Electron `safeStorage`, DPAPI on Windows, Keychain on macOS) and **never comes back to the renderer**:
there is no "get value" method; `last4` is filled only for secrets of 12+ characters.

- **Names** must match `[a-z0-9-]{1,64}` and live in the plugin namespace `plugin-<your plugin id>-<key>`. Replace `.` and `_`
  in your id with `-` (`com.example.hello` → `plugin-com-example-hello-api-key`) and mind the 64-character limit. Any other
  well-formed name is reserved for KoBar and resolves `{ success: false, reason: 'reserved-name' }`; malformed names (and a
  bare `plugin-`) resolve `invalid-name`. The host cannot verify the id part, so use only names that start with your own id.
- **Other reasons:** `invalid-request`, `invalid-value`, `too-large` (16 KB), `limit-reached` (64 secrets shared by all
  plugins, so one plugin can use up the others' room; KoBar's own namespace has a separate 64), `encryption-unavailable`
  (nothing was saved; there is no plaintext fallback), `encryption-failed`, `io`, `denied`.
- `status.unreadable === true`: the secret exists but cannot be decrypted for this OS user/profile; ask the user to enter it
  again. KoBar has no shared i18n keys for these messages, so ship your own, e.g. "This system cannot encrypt secrets, so the
  key was not saved." and "The saved key cannot be read on this device or user account. Please enter it again."

### 1.6 Sound

| Member | Status | Signature and notes |
|---|---|---|
| `getMelodyAudio` | C | `getMelodyAudio(name): Promise<string \| null>`. `audio/ogg` data URL of a bundled melody: `Alarm`, `Bells`, `Calming`, `Cosmic`, `Guitar`, `Hiphop`, `Ringtones`; `null` for any other name. |

### 1.7 KoBox (the drop-in folder)

| Member | Status | Signature and notes |
|---|---|---|
| `dropToKoBox` | C | `dropToKoBox(paths: string[]): void`, fire-and-forget. **Moves** the user-selected items into KoBox (since 1.4.0; across drives it copies, verifies, then removes the original). Name collisions are renamed. Refusals are shown to the user as notices only. |
| `openKoBox` | C | `openKoBox(): void`. Opens the KoBox folder in the file manager. |
| `cleanKoBox` | C | `cleanKoBox(mode: '24h' \| 'quit'): void`. Moves KoBox items to the Recycle Bin / Trash according to the KoBox plugin's cleanup mode. Only the KoBox plugin should call it. |

### 1.8 Media and Picture-in-Picture (KoPlayer)

Media data flows **only while a plugin whose id contains `koplayer` is enabled or a PiP window is open**; otherwise the host
does not poll the OS media session and these events stay silent.

| Member | Status | Signature and notes |
|---|---|---|
| `sendMediaCommand` | C | `sendMediaCommand('play' \| 'pause' \| 'next' \| 'prev'): void`. Windows: media keys. macOS: AppleScript to the music player (needs the Automation permission). |
| `onMediaUpdate` | C | `cb(track \| null)`, `track = { title, artist, albumArt: string \| null, isPlaying, sourceAppId? }`. A late subscriber receives the last value immediately. |
| `getSmtcSource` | C | `getSmtcSource(): Promise<string>`. Source app id of the Windows media session (`''` when unknown). |
| `getActiveVideoUrls` | C | `getActiveVideoUrls(): Promise<string[]>`. YouTube URLs open in desktop browsers; **Windows only** (`[]` elsewhere). |
| `onVideoUrlsUpdate` | C | `cb(urls: string[])`. Same rules as `onMediaUpdate`. |
| `openPip` | C | `openPip(url, title, albumArt?): void`. Opens the PiP mini browser window. |
| `closePip` | C | `closePip(): void`. |
| `onPipClosed` | C | `cb()` when the PiP window closes. |

### 1.9 Pin a window on top (Windows only)

| Member | Status | Signature and notes |
|---|---|---|
| `enterPinTargetingMode` | C | Next window the user clicks is pinned on top. macOS: unsupported; the host immediately reports "nothing pinned", ends targeting and shows one notice. |
| `unpinCurrentWindow`, `unpinAll` | C | Remove the pin(s). |
| `onPinnedWindowChanged` | C | `cb(hwnd: number \| null)`. |
| `onPinTargetingComplete` | C | `cb()` when targeting ends. |
| `getPinBorderStyle` | A | `Promise<{ color: '#RRGGBB', width: 1-4 }>`. |
| `setPinBorderStyle` | A | `setPinBorderStyle({ color, width }): Promise<{ success, error?: 'invalid-style' \| 'persist-failed' }>`. Only `#RRGGBB` and integer widths 1-4 are accepted. |

### 1.10 Screenshots (Screenshot Studio)

| Member | Status | Signature and notes |
|---|---|---|
| `startScreenshotCapture` | C | `Promise<{ captures: [{ displayId, bounds, scaleFactor, imageDataUrl }], windowPosition: {x, y}, error?: 'permission_denied' \| 'rate_limited', retryAfterMs? }>`. Captures every display; the main window is resized/hidden for your capture overlay. Rate-limited (at least 1 s apart, at most 10 per minute) and each capture flashes the screen briefly. Refusals resolve with an empty `captures` and `error` instead of throwing; always check `error`. macOS asks for the Screen Recording permission (`permission_denied` until granted and KoBar restarted). |
| `screenshotSessionComplete` | C | **Call when your capture UI is done**: restores the main window's bounds, shows it and puts it back on top. |
| `cancelScreenshot` | C | Same restore, for a cancelled session. |
| `saveScreenshot` | C | `saveScreenshot({ buffer, format, destinationPath?, defaultPath? }): Promise<{ success, path?, reason? }>`. Omit `destinationPath` to let the host show its own save dialog (no grant needed); a `destinationPath` must be user-selected, otherwise `{ success: false, reason: 'not-user-selected' }`. |
| `copyScreenshotToClipboard` | C | `copyScreenshotToClipboard(dataUrl): void`. |
| `takeScreenshot` | A | `takeScreenshot(hideApp: boolean): void`. Legacy: opens the OS snipping tool (`ms-screenclip:` / `screencapture -i -c`). |
| `triggerScreenshot` | H | The PrintScreen path of the host; rate-limited like captures. |

### 1.11 Google Calendar (experimental, read-only)

Host addition (**A**, feature-check `typeof window.api.gcalListEvents === 'function'`). The user turns it on in Settings >
Integrations (off by default) and signs in there; the host owns the sign-in and tokens never reach a plugin. It needs an OAuth
client file that release builds do not ship yet, so in released builds it normally reports `not-configured`. It will be gated
by a permission in plugin API v2; treat it as unstable. Nothing throws; all methods resolve plain objects.

| Member | Signature and notes |
|---|---|
| `gcalStatus` | `Promise<{ state: 'not-configured' \| 'not-connected' \| 'connected' \| 'reconnect-needed', enabled, configured, connected, lastRefreshAt: number \| null }>` (`lastRefreshAt` in epoch ms). `reconnect-needed` means Google rejected the saved sign-in; the user fixes it in Settings. |
| `gcalConnect` | Opens the system browser for Google sign-in; `Promise<{ success, reason?, status }>` (`reason`: `disabled`, `not-configured`, `encryption-unavailable`, `busy`, `timeout`, `denied`, `state-mismatch`, `exchange-failed`, `io`, `denied-sender`). Prefer pointing the user to Settings. |
| `gcalDisconnect` | Revokes and deletes the token; resolves the new status. |
| `gcalListEvents` | `gcalListEvents({ from, to })` with ISO 8601 strings, `from < to`, at most 400 days. Resolves `[{ id: 'google:<eventId>', title, start, end, allDay, calendar: 'google' }]` for the primary calendar (recurring events expanded, cancelled ones dropped), or `[]` when off, not connected or the range is invalid. All-day events use `YYYY-MM-DD` with an **inclusive** `end`; timed events use ISO 8601 with a UTC offset. Cached in memory, refreshed every 15 minutes; nothing is stored on disk. |

### 1.12 Plugins, updates, backup, notes, startup (host-internal)

All **H**. KoBar's Settings window and shell use these; a plugin calling them bypasses the user's intent or breaks the host's
state machines.

- Plugin management: `getInstalledExtensions` (returns every plugin's manifest **and code**), `checkPluginUpdates`,
  `toggleExtensionEnabled`, `setExtensionsConfig`, `installExtensionFromFile`, `installExtensionFromPath`,
  `installExtensionFromGithub`, `uninstallExtension`, `onPluginInstallProgress`. The install/uninstall calls show a
  main-process confirmation and can be refused.
- App updates: `onUpdateAvailable`, `onUpdateDownloadProgress`, `onUpdateDownloadComplete`, `onUpdateError`, `askForUpdate`
  (its arguments are ignored; the host shows fixed text), `downloadAndInstallUpdate`, `quitAndInstallUpdate`,
  `checkForUpdatesManual`.
- Backup and restore: `getBackupSources`, `saveFullBackup`, `createPreRestoreBackup`, `applyRestoreAndRelaunch`,
  `createPreDeleteBackup`.
- Notes and text files: `saveNoteAsText`, `pickTextFiles`, `takeOpenTextFiles`, `onOpenTextFilesAvailable`.
- Launch at login: `getAutoLaunch`, `setAutoLaunch` (turning it on asks the user), `syncAutoLaunch`.

### 1.13 Legacy no-ops (L)

| Member | Behaviour |
|---|---|
| `registerTeleportShortcut`, `onTeleportTriggered` | Do nothing (the teleport feature was removed). |
| `startEyeDropper` | Resolves `{ x: 0, y: 0 }`. Use the browser's `EyeDropper` API instead (no permission needed). |
| `stopEyeDropper` | No eyedropper to stop; it only hands the window back to click-through (the system eyedropper swallows mouse moves). |
| `getHwid` | Resolves `null` (licensing removed). |
| `installExtension`, `getAvailableExtensions` | Resolve `false` and `[]`. |

## 2. `window.KoBarExtensions` (registry)

| Member | For plugins | Notes |
|---|---|---|
| `registerSidebarButton({ id, icon, label, onClick })` | yes | `icon`: Material Symbols Outlined name. `label`: tooltip. `onClick(event, anchorRect)`: `anchorRect` is the bar's rectangle (`{ top, left, bottom, right, width, height }`, window coordinates). Re-registering an id replaces the button. An `isActive` field is ignored; the host derives the active marker from the open panel. |
| `registerPanel(id, { id, render })` | yes | `render({ onClose, anchorRect })` returns one root element. Shown while `useAppStore.getState().activeExtensionPanelId === id`. |
| `registerSettingsPanel(pluginId, { id, render })` | yes | Key = **your plugin id** (`dev-<id>` in the playground). `render()` gets no props. |
| `registerInlineWidget(id, { id, render })` | yes | Rendered directly in the bar, in the user's order, inside a dark-scheme `display: contents` wrapper. |
| `getData(pluginId, defaultValue)` / `setData(pluginId, data)` | yes | Workspace-aware JSON storage persisted in KoBar's store and included in backups; see `host-behaviour.md` section 5. Use your own id only. |
| `getButtons`, `getPanel`, `getSettingsPanel`, `getInlineWidgets`, `subscribe`, `notify` | read only | Host rendering. |
| `registerManifest`, `getManifest`, `unregisterExtension`, `clear`, `suspendNotifications`, `resumeNotifications`, `buttonIdForPanel` | no | Host plugin loader and bar. |

Do not mutate the registry's internal `buttons` / `panels` fields (one legacy official plugin does; it is kept working, but new
code must not copy it).

## 3. `window.useAppStore`: fields plugins may use

Read with the hook (`useAppStore((s) => s.x)`, re-renders on change) or `getState()`. Write only what is listed as writable.
Other store fields are host state: reading them is possible but unsupported, writing them can corrupt user data.

| Field | Type | Notes |
|---|---|---|
| `language` | `'en' \| 'tr' \| 'de' \| 'es' \| 'fr' \| 'ja' \| 'ru' \| 'ar' \| 'hi' \| 'zh'` | UI language. |
| `t` | `(key) => string` | Translates **host** keys synchronously; not for plugin strings. |
| `edgePosition` | `'left' \| 'right' \| 'top' \| 'bottom'` | Screen edge of the bar. |
| `orientation` | `'vertical' \| 'horizontal'` | |
| `sidebarPosition` | `{ x, y } \| null` | Window position of a free-floating bar; `null` when docked. |
| `screenBounds` | `{ x, y, width, height } \| null` | The display the bar is on. |
| `isPopupSmartPositioning` | `boolean` | Always `true` since 1.4.0 (no longer a user setting): popups follow their launch icon and stay on screen. |
| `isMac` | `boolean` | `getPlatform() === 'darwin'`. |
| `iconScale` | `number` | Bar icon zoom. |
| `design`, `glassOpacity` | `'style1' \| 'style2'`, `number` | Legacy view of the appearance: `style2` = translucent material. Read-only for plugins. |
| `activeExtensionPanelId` | `string \| null` | **Writable** (with `activeExtensionAnchorRect`) to open or close your own panel. |
| `activeExtensionAnchorRect` | rect `\| null` | **Writable**, pass the `anchorRect` you received. |
| `closeAllUtilityPopups()` | action | Closes the open plugin panel; call it before opening yours. |
| `getPluginData(id, def)`, `setPluginData(id, data)` | actions | Same storage as `KoBarExtensions.getData/setData`. |
| `workspaces`, `activeWorkspaceId` | read only | Workspace list and the active id (`workspaces[].isIsolated`). |
| `openSettingsTab()`, `openPluginsTab()` | actions | Open the Settings window at General / Plugins. |
| `currentMedia`, `currentMediaSourceApp`, `activeVideoUrls` | read only | KoPlayer data (see 1.8). |
| `isLicensed` | `true` | Legacy, not persisted; removed in 2.0. |

## 4. DOM events and CSS contract

| Item | Notes |
|---|---|
| `window` event `kobar:workspace-changed` | `event.detail.workspaceId`. Fired on the next tick after a workspace switch. |
| `document` event `kobar-drag` | `event.detail = { x, y }`: the bar's new position while the user drags it (reposition a free-standing popup). |
| `<script data-extension-id>` | Your script element; `document.currentScript.dataset.extensionId` is your id during the first, synchronous run. |
| CSS variables | `--theme-primary` (= the user's accent), `--theme-bg-dark`, `--theme-bg-base`, `--theme-surface`, `--theme-border`, `--theme-scrollbar`, `--theme-accent-glow`, `--theme-marker`. Inside v1 plugin UI they resolve to the dark scheme. Do not depend on `--kb-*` tokens: they are host-internal. |
| Utility classes | `pointer-events-auto` (hit-testable), `no-drag-region`, `custom-scrollbar`, `scrollbar-hide`, `material-symbols-outlined`, `bg-primary` / `text-primary` / `border-primary` (accent). Tailwind v4 utilities are compiled at runtime (`host-behaviour.md` section 6). |
| Fonts | System UI font by default. `font-family: "Space Grotesk"` still resolves (bundled alias for v1 plugins). Icons: Material Symbols Outlined, bundled locally. |
