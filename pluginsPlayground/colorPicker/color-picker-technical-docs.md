# KoBar Color Picker: Technical Documentation

## 1. Overview & Core Features
The **Color Picker** in KoBar is a built-in module designed to empower users with an on-the-fly color sampling and management tool. Its primary use cases include driving the custom theme generator and enabling quick color scraping during design or development tasks.

### Core Features:
- **Screen Picking**: Native screen color picking using the browser's `EyeDropper` API, wrapped with custom Electron IPC boundaries.
- **Color Conversion Engine**: Seamless conversion and display across HEX, RGB, HSV, and HSL formats.
- **Harmonies Generator**: Algorithmic generation of Analogous, Complementary, Split-Complementary, Triadic, and Tetradic color schemes based on the currently selected color.
- **Palette Management**: A fully integrated system to create, edit, duplicate, and delete custom color palettes.
- **Clipboard Integration**: Picked colors can be optionally piped directly into KoBar's `useClipboardStore` FIFO queue.
- **Smart UI Positioning**: Dynamic bounded-drag capabilities ensuring the popup never escapes the viewport.

---

## 2. Technical Architecture

### 2.1 State Management (`zustand`)
The Color Picker relies heavily on KoBar's global `useAppStore` for state persistence and cross-component reactivity.

**Key State Variables:**
- `currentColor` (string): Stores the active color in HEX format.
- `colorPalettes` (Array): Stores user-defined color collections.
- `autoCopyColor` (boolean): Determines if picked colors should auto-forward to the clipboard queue.
- `isColorPickerOpen` (boolean): Toggles the visibility of the popup.
- `colorPickerAnchorRect` (Object): Defines the anchor position relative to the main sidebar for the popup.
- `eyeDropperOffset` (Object): Tracks screen offsets required for multi-monitor `EyeDropper` coordinate correction.

### 2.2 Component Structure (`ColorPickerPopup.tsx`)
The frontend is driven by `src/components/layout/ColorPickerPopup.tsx`. 

- **UI Layout**: It features a tabbed interface splitting functionality into "Wheel & Harmonies" and "Palettes".
- **Glassmorphism Design**: The component calculates its `backdropFilter` (blur) dynamically, considering both the `glassOpacity` state and the OS (`isMac`), utilizing Electron's native vibrancy or CSS fallbacks.
- **Smart Positioning**: The popup calculates its absolute `left` / `top` / `bottom` / `right` based on the `orientation` and `sidebarPosition`. It enforces `minLeft`, `maxLeft`, `minTop`, and `maxTop` bounds against `screenBounds` to ensure 100% visibility.
- **Drag Logic**: Listens for the custom `kobar-drag` event. The drag coordinates update the popup's inline style directly bypassing React state updates for a zero-lag (60 FPS) drag experience.

### 2.3 Screen Picking (EyeDropper & IPC)
Because KoBar is an always-on-top Electron app, using the native `window.EyeDropper()` API requires synchronization with the main process.

1. **Initiation**: The UI calls `window.api.startEyeDropper()` via IPC.
2. **Main Process (`main.ts`)**: Sets an internal `isEyeDropperActive` flag. This can be used to suppress click-through or always-on-top behaviors temporarily.
3. **Execution**: The UI awaits `new window.EyeDropper().open()`.
4. **Resolution**: The returned sRGB HEX is saved to `currentColor`.
5. **Cleanup**: `window.api.stopEyeDropper()` resets the environment.

---

## 3. Color Logic & Mathematics

KoBar uses custom math functions to prevent reliance on heavy external libraries like `chroma.js` or `tinycolor2`, keeping the bundle size minimal.

### 3.1 HSV Conversions
The custom color wheel in the popup is driven by HSV (Hue, Saturation, Value) logic. 

**`hexToHsv`**:
- Converts HEX to RGB (`0-255`), normalizes to `0-1`.
- Calculates `max` and `min` RGB values.
- **Value (V)** is simply the `max`.
- **Saturation (S)** is `(max - min) / max`.
- **Hue (H)** is calculated via piece-wise functions depending on which RGB channel is the `max`.

**`hsvToHex`**:
- Reverses the process, converting HSV vectors back into specific RGB segments, mapping them to `#RRGGBB`.

### 3.2 HSL Conversions
Used primarily for generating Harmonies, HSL (Hue, Saturation, Lightness) handles rotational color logic better than HSV.

**`hexToHSL` & `hslToHex`**:
- Calculates Lightness as `(max + min) / 2`.
- Saturation formulas pivot based on whether Lightness is greater or less than `0.5`.

### 3.3 Contrast Calculation
`getContrastColor(hex)` uses the **YIQ formula** to determine if white or black text should be overlaid on a color swatch for readability:
```javascript
let yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
return (yiq >= 128) ? '#000000' : '#FFFFFF';
```

---

## 4. Harmonies Engine
The harmony generator rotates the Hue degree on the HSL cylinder while maintaining the original Saturation and Lightness.

- **Analogous**: `H + 30°` and `H + 330°`
- **Complementary**: `H + 180°`
- **Split-Complementary**: `H + 150°` and `H + 210°`
- **Triadic**: `H + 120°` and `H + 240°`
- **Tetradic**: `H + 90°`, `H + 180°`, and `H + 270°`

---

## 5. Palette Management
The "Palettes" tab provides full CRUD (Create, Read, Update, Delete) operations over the `colorPalettes` array in `useAppStore`.

- **Data Structure**: 
  ```typescript
  { id: string, name: string, colors: string[] }
  ```
- **Inline Editing**: Clicking any swatch in a palette sets `editingPalette` state, shifting the user to the Custom Wheel tab. Any changes made to the wheel instantly dispatch `updatePalette(id, { colors })` to mutate the specific index of that palette array.

---

## 6. Clipboard Integration
KoBar’s signature feature is its multi-slot clipboard. The Color Picker integrates natively:

When a user picks a color via the EyeDropper or clicks a swatch, `copyColor(hex)` is triggered:
1. Writes the color to the OS clipboard via `navigator.clipboard.writeText(hex)`.
2. Checks if `autoCopyColor` AND `isCopyPasteEnabled` are true.
3. If true, calls `forceAddClipboardItem('text', hex)` from `useClipboardStore`.
4. The color instantly appears in the main vertical sidebar as a new visual clipboard slot, allowing developers to pick multiple colors from a reference image rapidly.
