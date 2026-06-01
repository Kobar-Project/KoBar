# KoBar Calculator Feature - Technical Specifications

## 1. Overview
The **Calculator** in KoBar is a built-in, highly interactive, cross-platform utility tool. It is designed to act as a lightweight, non-obtrusive overlay that provides quick access to mathematical operations and real-time currency conversions. Rather than relying on external browser windows, the calculator lives directly inside KoBar's React frontend, seamlessly integrating with its global state, theming engine, and Electron-based operating system APIs.

The feature is divided into three primary modes:
1. **Basic Calculator**: Standard arithmetic operations.
2. **Scientific Calculator**: Advanced mathematical functions, trigonometry, parentheses evaluation, memory, and history tracking.
3. **Currency Converter**: Real-time fiat currency conversion with geolocation-based auto-detection and caching.

---

## 2. Component Architecture
The Calculator feature is built primarily around two React Functional Components:

- `CalculatorButton.tsx`: The trigger element located in the KoBar sidebar. It determines its screen coordinates using `getBoundingClientRect()` and dispatches this anchor data to the global store so the popup knows where to render.
- `CalculatorPopup.tsx`: The main overlay interface. It conditionally renders the Basic, Scientific, or Currency views. It dynamically calculates its absolute positioning based on the anchor rectangle, screen boundaries, and KoBar's edge orientation.

---

## 3. State Management
The calculator relies heavily on `zustand` (`useAppStore` and `useClipboardStore`) to interact with the broader KoBar ecosystem, avoiding localized prop-drilling.

**Key Global States Consumed:**
- `isCalculatorOpen`: Toggles visibility.
- `isCalculatorScientific`: Remembers the user's preference between basic and scientific modes across sessions.
- `calculatorAnchorRect`, `edgePosition`, `orientation`, `sidebarPosition`, `screenBounds`: Used for precise coordinate calculation to prevent the popup from clipping off-screen.
- `isPopupSmartPositioning`: Determines if the calculator is fixed to the sidebar or can be freely dragged around the screen.
- `design`, `glassOpacity`, `isMac`: Controls the aesthetic rendering (e.g., applying macOS-specific native blur vs. Windows fallback CSS backdrops).

---

## 4. Calculation Engine & Logic
To avoid the security risks associated with JavaScript's `eval()` function, the calculation engine is built as a deterministic, state-based incremental evaluator.

### 4.1. Core State Variables
- `display` (string): The current string representation of the number being typed.
- `prevValue` (number | null): The accumulated result of previous operations.
- `operator` (string | null): The pending arithmetic operator (`+`, `-`, `×`, `÷`, `^`, `mod`).
- `waitingForOperand` (boolean): A flag indicating if the next key press should overwrite the display (e.g., right after pressing `+`).

### 4.2. Stack-Based Parentheses Evaluation
Parentheses are handled using a custom array stack (`parenStack`).
- **Open `(`**: The current `prevValue` and `operator` are pushed into `parenStack`, and the current state is reset to process the inner expression.
- **Close `)`**: The current display value is calculated against the inner state. Then, the `parenStack` is popped, retrieving the suspended `prevValue` and `operator`, allowing the outer calculation to resume seamlessly.

### 4.3. Scientific Functions
The scientific mode utilizes the native `Math` object.
- **Trigonometry**: Supports `sin`, `cos`, `tan`, `asin`, `acos`, `atan`. Includes an Angle Mode toggle (`DEG` vs `RAD`). When in `DEG` mode, inputs are converted to radians via `(deg * Math.PI) / 180` before passing them to native Math methods.
- **Advanced Operations**: Roots (`√`, `∛`), Powers (`x²`, `x³`, `10^x`, `e^x`), Logarithms (`ln`, `log`), and a custom `factorial()` loop that computes up to `170!` before yielding `Infinity`.
- **Memory & History**: Supports standard M-keys (`MC`, `MR`, `M+`, `M-`) mapped to a localized `memory` React state. The `history` array logs the last 10 completed expressions (e.g., "5 + 5 = 10") for quick reference.

---

## 5. Currency Converter Module
The Currency mode transforms the calculator into a real-time financial utility.

### 5.1. External API & Rate Caching
- **Endpoint**: Fetches rates relative to USD using `https://open.er-api.com/v6/latest/USD`.
- **Caching Strategy**: To prevent API rate-limiting and ensure offline-resilience, successful responses are stored in `localStorage` under `kobar_exchange_rates` along with a timestamp.
- **Expiration**: The component checks the timestamp upon mounting. If the cache is younger than 12 hours (`43200000` milliseconds), it bypasses the network request entirely.

### 5.2. Intelligent Auto-Detection
When opened for the first time, the calculator attempts to auto-detect the user's local currency using a two-tier fallback system:
1. **IP Geolocation**: Pings `https://ipapi.co/json/` to extract the localized currency code.
2. **Timezone Heuristics**: If the IP fetch fails or is blocked (e.g., adblockers), it falls back to `Intl.DateTimeFormat().resolvedOptions().timeZone` (e.g., `Europe/London`) and maps it to a hardcoded dictionary of timezones to guess the currency (e.g., `GBP`).

### 5.3. Currency Selection Modal
A searchable overlay allows users to swap currencies. It features a custom sorting algorithm that pins `POPULAR_CURRENCIES` (USD, EUR, GBP, JPY, etc.) to the top of the list, followed by an alphabetical sort of the remaining global currencies.

---

## 6. User Interface & OS Integration

### 6.1. Smart Positioning & Draggability
If `isSmartPositioning` is enabled, the component attaches a global listener to a custom `kobar-drag` event. This allows the popup to be detached from its sidebar anchor and moved anywhere on the screen. The coordinates are constantly clamped using `screenBounds` to ensure the window never gets lost off-screen.

### 6.2. Global Keyboard Listeners
The `useEffect` hook binds a `keydown` listener to the `window` object, allowing users to type calculations directly without clicking. 
- **Filtering**: It intelligently ignores keystrokes if `document.activeElement.tagName` is an `INPUT` or `TEXTAREA` to prevent overriding form typing elsewhere in KoBar.
- **Key Mapping**: Enter/`=` resolves the calculation, `Escape`/`c` clears the state, and standard operators map to their respective functions.

### 6.3. Electron OS-Level Integration (Clipboard)
In Currency mode, the "Copy" button doesn't just copy to the web browser's clipboard. It invokes the Electron Inter-Process Communication (IPC) bridge:
```typescript
navigator.clipboard.writeText(cleanVal); // Standard Web API
window.api?.writeToClipboard?.({ type: 'text', content: cleanVal }); // Native OS Clipboard via Main Process
forceAddClipboardItem?.('text', cleanVal); // Injects directly into KoBar's internal multi-slot clipboard FIFO
```
This ensures strict parity between the app's internal clipboard vault and the OS-level system clipboard.

---

## 7. Security Considerations
- **No `eval()`**: All calculations are strictly parsed as numbers (`parseFloat`) and routed through a switch-case state machine, eliminating arbitrary code execution vectors.
- **Strict IPC Exposing**: The calculator only calls explicitly defined bridging functions (`window.api.writeToClipboard`), adhering to Electron's `contextIsolation: true` requirement. No Node.js core modules (`fs`, `child_process`) are imported into the React component.
