# Changelog

All notable changes to KoBar are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.4.0] - 2026-10-14

The remaster release: a new design system, a separate Settings window, a rebuilt plugin flow, a calmer first run and a file-backed data store. Stored data is migrated automatically (`kobar-storage` v21 up to v32); existing users are never sent through onboarding again. The plugin contract (`window.React`, `window.ReactDOM`, `window.useAppStore`, `window.api`, `window.KoBarExtensions`) is unchanged; `window.api.globalPasteVersion` (value 2) is the only addition.

### Added

- Separate Settings window with left navigation: General, Appearance, Sidebar, Plugins (installed list and a discover tab with search and install), Workspaces, Backup (export, restore and update centre), Integrations and About.
- Appearance: light, dark or system colour scheme, accent palette with a custom colour, material and transparency; density (compact or comfortable) in the sidebar settings.
- Ten UI languages (en, tr, de, es, fr, ja, ru, ar, hi, zh) as JSON locale files; the tray menu and main-process dialogs are localized.
- First-run onboarding with three cards and a one-click starter pack; existing users are marked as completed.
- Notes: a note list on the left (resizable, width saved) with the editor on the right, and an empty state instead of a seeded welcome note.
- Bar context menu on the sidebar handle (workspace view and more), keyboard navigation and visible focus rings; toast notifications instead of `alert()` dialogs.
- Plugin panels can be dragged along their free axis; the offset is saved per plugin. Mini-mode eye drags with a click threshold.
- Full backup export and restore (secrets redacted by default, validation and preview, automatic pre-restore backup in `backups/`).
- Automatic backup of the raw `kobar-storage` before migration (secrets masked, kept in `backups/`), a write lock until hydration succeeds, and a recovery panel if the stored data cannot be read.
- File store for the app store in `userData/kobar-data/` (atomic writes, rotating backups, corrupt-file quarantine); localStorage is still written as well. One-time masked snapshot of localStorage in `kobar-data/localstorage-snapshot/`.
- Secrets service backed by Electron `safeStorage` (DPAPI on Windows); saving is refused when encryption is unavailable.
- Plugin install safety: confirmation dialogs for ZIP and GitHub installs, an "unverified plugin" warning for sources outside the official registry, a second confirmation when a ZIP replaces an installed plugin, downgrades refused, plugins requiring API version 2 or a newer app are refused before any write.
- Google Calendar integration (experimental, read-only, off by default). It needs an OAuth client file that is not shipped, so it is only usable in development builds.
- Packaging flavors (`store` / `direct`); the direct build updates itself only when the packaged metadata enables it, the Store build is updated by the Store.
- Multi-size app icon, KoBar name and icon in notifications, and a dev Start Menu shortcut.
- Test suite (Vitest, Playwright-Electron smoke test) and CI.

### Changed

- Sidebar: square icons, no dividers, active indicator bar, uniform plugin buttons, full-width bar header with a menu icon, density-based sizing; reordering no longer pulses.
- Global paste (Ctrl+V cycling) rewritten as a state machine: single-flight, verified clipboard write, no self-trigger, and rapid back-to-back presses are handled. A small window remains in which a new V press just before the history refresh can paste the same item once more.
- KoBox moves dropped items in instead of copying (Recycle Bin cleanup, safe across drives); name collisions are renamed automatically and folder drops are rewritten.
- The bar is kept on top reliably (re-asserted on display, power and focus events); on Windows the main window follows the active display and re-fits on display changes.
- Media/SMTC polling and library scans run only while a KoPlayer plugin is enabled or PiP is open; the PowerShell bridge restarts with backoff.
- One owner for the enabled-plugin set (workspace record or `extensions-config.json`); a workspace switch only loads or unloads plugins whose state changed.
- Workspace isolation is described as not a privacy boundary; deleting a workspace or changing its isolation asks for confirmation and backs up first.
- Settings and data imports are validated, whitelisted and merged; the settings export no longer includes isolated data or e-mail.
- The app version lives only in `package.json`; the contact address is now hello@kobar.org.
- Fonts are bundled locally (Space Grotesk, Material Symbols); Google Fonts were dropped from the CSP.
- Motion respects `prefers-reduced-motion`; Ctrl+S no longer exports the note; notes get a localized default title.
- Internals: `electron/main.cts` is a thin entry over `electron/main/*`; main, preloads and workers are bundled with esbuild; IPC has a typed contract with validation.

### Fixed

- Light and system colour modes now work (the temporary light-scheme clamp is gone).
- The first Ctrl+V decision is made before the async clipboard write and key-ups are ordered after it.
- Workspace settings no longer overwrite inactive isolated workspaces; `localStorage.clear()` is a no-op inside shared workspaces.
- Duplicate note ids, dangling `activeNoteId` and stale note counters are repaired by the v22 migration.
- Dropping a KoBox item whose name already exists no longer fails with EEXIST.
- Several hardening fixes: file arguments need a user-chosen path, plugin listing and uninstall ignore links and broken entries, plugin secrets are limited to their own namespace, a restore cannot enable plugins that are disabled or not installed.

### Removed

- The Settings and Plugins pseudo-notes in the notes list, the dead teleport shortcut setting and other unused persisted fields (originals are kept in `legacyBackup`).
- Licensing code, the dead install-extension, eyedropper and InstalledPlugins code, and the legacy KoBox cleanup in the app shell.

### Security

- Backups and the localStorage snapshot mask secrets; the strict mask also covers nested and double-encoded JSON.
- The updater feed is pinned with downgrades disallowed; Electron fuses are configured for packaged builds.

### Migration

- `kobar-storage` moves from v21 to v32. Every removed or replaced value is copied into `legacyBackup`; real notes, settings, plugin data and workspaces are preserved.
    - v22: repairs duplicate note ids and persists toggle width, feature spacing and popup positioning.
    - v23: retired fields move to `legacyBackup`; duplicate `featureOrder` ids are collapsed.
    - v24: derived Default workspace and explicit `isIsolated` flags.
    - v25: `defaultExtensionsConfig`.
    - v26 to v30: appearance model, density, removal of the fake settings/plugins notes, onboarding state.
    - v31: notes list width. v32: per-plugin panel offsets.
- First start of 1.4.0: the existing `kobar-storage` is read from localStorage, backed up (masked), migrated and written to the file store; localStorage is never deleted.
- Older KoBar versions may not read data written by this version; take a backup before updating.

## [1.1.3]

Last release before the remaster (Microsoft Store and GitHub); kobar-storage schema v21.
