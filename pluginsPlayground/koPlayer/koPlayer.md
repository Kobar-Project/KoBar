# KoPlayer Technical Documentation

## 1. Overview
**KoPlayer** is a lightweight, floating media player embedded within the KoBar ecosystem. It provides native System Media Transport Controls (SMTC) integration and an advanced Picture-in-Picture (PiP) browser. Designed to be unobtrusive yet powerful, KoPlayer ensures seamless media playback integration, allowing users to control their music and videos directly from the KoBar sidebar without breaking their workflow.

---

## 2. Technical Infrastructure & Architecture

KoPlayer follows KoBar's strict separation of concerns, dividing its responsibilities between a secure React frontend, a Zustand state store, and an Electron backend that handles OS-level integrations.

### 2.1. Frontend (React + Tailwind CSS)
- **Component**: `src/components/layout/KoPlayerPopup.tsx`
- The UI is built using React Functional Components and styled entirely with Tailwind CSS. It features a highly responsive design with a blurred album art background and glassmorphism effects.
- **State Management**: Uses the global `useAppStore` (Zustand) to subscribe to media states (`currentMedia`), active video URLs (`activeVideoUrls`), and coordinate the smart positioning of the popup (`koPlayerAnchorRect`).
- **Clean Architecture**: Adheres to KoBar's rules by avoiding any Node.js/Electron imports in the React layer. All interactions with the OS (e.g., controlling media, opening PiP) are routed through the securely exposed `window.api`.

### 2.2. Backend (Electron Main Process)
- **Main Controller**: `electron/main.cts`
- Responsible for managing the lifecycle of the PiP window, interacting with system media APIs, and processing URL scanning logic for active browsers.
- **SMTC Web Worker**: `electron/smtc-worker.cts`
  - To prevent blocking the main Electron thread, media metadata (Title, Artist, Album Art, Playback Status) is polled via a dedicated Node.js Worker Thread.
  - On Windows, it utilizes the `@coooookies/windows-smtc-monitor` package to interface directly with the native Windows media session APIs.
- **Security & IPC Bridge**: `electron/preload.cts`
  - Safely exposes explicit methods to the frontend, such as `sendMediaCommand`, `getActiveVideoUrls`, `openPip`, and `closePip`.

---

## 3. Core Features & How They Work

### 3.1. Smart Positioning & Drag Synchronization
KoPlayer attaches itself relative to the main KoBar vertical/horizontal sidebar.
- **Dynamic Bounding**: It calculates the current `screenBounds`, `orientation` (horizontal/vertical), and `edgePosition` (top, bottom, left, right) to ensure the popup never overflows the user's viewport.
- **Drag Handling**: It listens to the custom `kobar-drag` event emitted by the sidebar. When the user drags KoBar, KoPlayer updates its `top` and `left` CSS properties in real-time to stick seamlessly to its anchor point.

### 3.2. Native Media Controls (SMTC)
KoPlayer acts as a remote control for any media playing on the OS (e.g., Spotify, Chrome, Edge).
- **Worker Polling**: `smtc-worker.cts` listens for a `poll` message, fetches the `getCurrentMediaSession()`, extracts the thumbnail as a Base64 string, and returns a `poll-result` payload.
- **Frontend Commands**: The UI buttons trigger `window.api.sendMediaCommand('play' | 'pause' | 'next' | 'prev')`, delegating the execution to the Electron backend.

### 3.3. Picture-in-Picture (PiP) Engine
The PiP functionality allows users to float videos (specifically YouTube) above all other windows.
- **Window Creation (`createPipWindow`)**: 
  - Spawns a new Electron `BrowserWindow` measuring 480x270 (16:9 aspect ratio).
  - Uses `setAlwaysOnTop(true, isMac ? 'floating' : 'screen-saver', 2)` to ensure it overrides standard OS windows cleanly.
- **Fast Path (Pre-cached URL Detection)**:
  - If the active media source is a known browser (Chrome, Edge, Brave, etc.), the backend runs a debounced background scan to find active YouTube URLs.
  - The UI displays a green indicator dot if a video is ready. Clicking the PiP button uses these pre-cached URLs to launch PiP instantly.
- **Slow Path (On-Demand Scan)**:
  - If no URLs are cached, KoPlayer triggers `window.api.getActiveVideoUrls()`, displaying a loading spinner (`koplayer-spin`) while the backend scans browser tabs.
- **URL Resolution**: The UI uses the YouTube `oEmbed` API to fetch titles and thumbnails dynamically or falls back to raw URLs. Users can also manually paste URLs.

### 3.4. Visual Effects & UI Aesthetics
- **Glassmorphism**: KoPlayer dynamically adjusts its backdrop filter based on the OS. On macOS, it uses `blur(8px)` (relying more on native vibrancy), whereas on Windows, it uses an intensive CSS `blur(20px)`.
- **Dynamic Album Art**: The background of the popup is an heavily blurred version (`blur(40px) brightness(0.3) saturate(1.5)`) of the currently playing album art, giving it a modern, rich aesthetic.
- **Marquee Text Overflow**: When track titles or artist names exceed their container width, a custom `koplayer-marquee` CSS animation automatically scrolls the text smoothly so the user can read the entire string.
- **Draggable Regions**: Strict enforcement of `-webkit-app-region: no-drag` on all interactive elements (buttons, inputs) to prevent accidental window dragging during interaction.

---

## 4. Cross-Platform Considerations
Adhering to KoBar's cross-platform philosophy:
1. **OS Detection**: `isMac` and `isWin` booleans dictate behaviors like window level layering (`screen-saver` on Windows vs `floating` on Mac).
2. **SMTC Limitations**: The `smtc-worker.cts` actively wraps its Windows-specific module require (`@coooookies/windows-smtc-monitor`) within an `if (isWin)` block. This ensures that the application does not crash on macOS, gracefully falling back to a disabled SMTC state or alternative Mac APIs if implemented.

---

## 5. Summary Data Flow (IPC Endpoints)
| Method | Direction | Description |
| :--- | :--- | :--- |
| `sendMediaCommand` | UI → Main | Instructs the OS to play, pause, or skip media. |
| `getActiveVideoUrls` | UI → Main | Requests the Electron backend to scan active browsers for video tabs. |
| `openPip` / `closePip` | UI → Main | Commands the backend to instantiate or destroy the `BrowserWindow` dedicated to PiP. |
| `onPipClosed` | Main → UI | Event emitted when the user closes the PiP window manually, allowing the UI to reset its PIP button state. |
