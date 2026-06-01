# KoBox (Dropzone) Technical Documentation

## 1. Overview & Purpose

**KoBox (Dropzone)** is a built-in feature of the KoBar application acting as an accessible, temporary file repository directly on the sidebar. It is designed to act like a quick "pocket" or "inventory" where users can drop files for temporary keeping.

The feature essentially moves dragged-and-dropped files from anywhere in the OS into a dedicated KoBox directory within the application's `userData` path. It also features a fully autonomous cleanup lifecycle to prevent unused temporary files from bloating the user's storage.

---

## 2. UI & User Interaction (React Frontend)

The visual representation of KoBox is located within `Sidebar.tsx`. It uses a dynamic `TooltipButton` equipped with dragging and dropping HTML5 API events.

### Drag & Drop Interception
When a user drags a file over the `inventory_2` material icon:
1. **Visual Feedback:** The `onDragOver` event triggers `setIsKoBoxHovered(true)`, which dynamically injects Tailwind classes to scale the icon (`scale-125`) and apply a slight tilt (`rotate-12`) along with an orange glow (`shadow-[0_0_15px_rgba(244,161,37,0.4)]`).
2. **File Processing (`onDrop`):** 
   - The browser's default drop behavior is prevented (`e.preventDefault()`).
   - The files array (`e.dataTransfer.files`) is iterated over.
   - The absolute physical file paths are resolved. Because the standard web API does not expose native paths, it safely falls back to `window.api?.getFilePath?.(f)` or the internal `(f as any).path` property injected by Electron's chromium build.
3. **IPC Dispatch:** The extracted paths are sent to the backend via `window.api?.dropToKoBox?.(paths)`.

### Opening KoBox
Clicking the button (`onClick`) triggers `window.api?.openKoBox?.()`, which natively opens the directory in Windows Explorer (or macOS Finder).

---

## 3. Electron IPC & Main Process Logic

The backend handles the actual file system manipulation, defined primarily in `main.cts`.

### The `kobox-drop` Event
When `ipcMain.on('kobox-drop')` is invoked:
1. The system checks if the KoBox directory exists: `path.join(app.getPath('userData'), 'KoBox')`, and creates it if not.
2. For each path dropped, it attempts to physically move the file into the KoBox directory.
3. **Move vs Copy Fallback Strategy:** 
   - It first attempts a high-speed `fs.renameSync(src, dest)`. 
   - **Cross-Drive Conflict Mitigation:** `renameSync` fails if the source and destination are on different disk partitions or drives (e.g., dragging from `D:\` to the KoBox in `C:\Users\...`). If `renameSync` throws an error, a `catch` block intercepts it and safely performs `fs.copyFileSync(src, dest)` followed by `fs.rmSync(src, { recursive: true, force: true })` to achieve the move operation successfully across boundaries.

### The `kobox-open` Event & AppX Virtualization Bypass
Opening the directory is non-trivial for Windows Store (AppX) builds. 

If KoBar is running inside an MS Store container, `app.getPath('userData')` is abstracted and virtualized inside a `LocalCache` directory deep within the `WindowsApps` framework. If you pass this standard path to `shell.openPath()`, the Windows Explorer fails to open it correctly.

To solve this, KoBar implements a **`resolvePhysicalPath(p: string)`** utility:
- It detects if `process.windowsStore` is true.
- It extracts the `packageFamilyName` from the process execution path.
- It reconstructs the absolute, true physical path mapping inside `%LOCALAPPDATA%\Packages\[packageFamilyName]\LocalCache\Roaming`.
- The final true path is then passed to `shell.openPath(targetPath)`.

---

## 4. Autonomous Cleanup Lifecycle

KoBox acts as temporary storage. To prevent disk space bloating, it implements a highly aggressive, autonomous cleanup cycle configured via the global settings state.

### Configuration (`useAppStore.ts`)
- `isKoBoxEnabled`: Toggles the appearance of the icon on the sidebar.
- `koBoxCleanupMode`: Stores the retention policy, either `'24h'` or `'quit'`.

### Execution Flow (`App.tsx` & `main.cts`)
1. **On Application Start:** In `App.tsx`, an empty dependency `useEffect` immediately fires `window.api?.cleanKoBox?.(cleanupMode)` upon startup.
2. **On Application Exit:** A `beforeunload` event listener checks if the cleanup mode is `'quit'`. If so, it fires the clean command synchronously before the window shuts down.
3. **File System Deletion (`cleanKoBox` function):** 
   - `fs.readdirSync` iterates over all contents of the KoBox folder.
   - It runs `fs.statSync(filePath)` to retrieve the `mtimeMs` (modification time in milliseconds) for each file.
   - If the mode is `'quit'`, all files are wiped forcefully.
   - If the mode is `'24h'`, it compares the current `Date.now()` with `mtimeMs`. If the difference is strictly greater than 86,400,000 milliseconds (24 hours), the file is recursively deleted via `fs.rmSync`.

---

## Summary

The KoBox feature demonstrates an elegant bridge between a fluid React frontend (with complex drag-drop interactions and hover physics) and a robust Electron backend that mitigates Windows file-system quirks (cross-drive transfers and AppX virtualization) while guaranteeing self-maintenance through automated file purging.
