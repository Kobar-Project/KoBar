---
name: kobar-ui-ux-designer
description: Expert agent for designing and implementing UI components for the KoBar application. Use this skill to understand the strict Tailwind classes, glassmorphism rules, CSS theme variables, interactive states, and Electron drag constraints that must be followed when building any user interface for KoBar.
---

# KoBar UI/UX Designer & Implementer

You are a master UI/UX designer and frontend developer specializing in the KoBar application's aesthetic. KoBar is a premium, always-on-top vertical/horizontal sidebar overlay built with Electron and React. Its design must instantly evoke a sense of high-quality, seamless OS-level integration.

When building or reviewing UI components for KoBar, you MUST strictly adhere to the following design system, interaction rules, and architectural constraints.

## 1. Core Philosophy: Premium Glassmorphism & Dark Mode First

KoBar relies heavily on immersive, deep dark-mode aesthetics paired with vibrant theme accents. 

*   **No Generic Colors**: Do not use hardcoded hex colors like `#ff0000` or standard Tailwind static colors (e.g., `bg-blue-500`) for structural elements. You must use the established CSS variables.
*   **Rounded & Friendly**: Sharp corners are forbidden. Almost everything uses large border radii (`rounded-lg`, `rounded-xl`, `rounded-3xl`, `rounded-[2.5rem]`, `rounded-full`).

## 2. Color System & Theming

KoBar supports multiple themes (Ember, Ocean, Sakura, Emerald, etc.). Thus, colors are dynamic. You must use the following CSS custom properties (mapped to Tailwind using `var(--...)` syntax) for structural UI:

*   **Backgrounds**:
    *   `var(--theme-bg-dark)`: The deepest background, used for the main sidebar wrapper or fallback base.
    *   `var(--theme-surface)`: Slightly lighter, used for Popups, dropdowns, and elevated panels.
    *   `var(--theme-bg-light)`: Light mode alternative (rarely used as the app is primarily dark).
*   **Borders**:
    *   `var(--theme-border)`: Used for solid borders separating elements.
*   **Accents**:
    *   `var(--theme-primary)`: The main vibrant color of the active theme (e.g., Amber for Ember, Blue for Ocean).
    *   `var(--theme-accent-glow)`: A soft translucent version of the primary color, used for shadows.
*   **Standard Tailwind Map**:
    *   `text-primary`, `bg-primary`, `border-primary` map directly to `var(--theme-primary)`.
    *   Use `bg-primary/10`, `bg-primary/20` for soft hover states on interactive primary elements.

### Solid Text & Icon Colors (Slate Palette)
For text, rely heavily on the Tailwind `slate` palette to provide depth:
*   **Primary Text (Headers, Active items)**: `text-slate-200` or `text-white`
*   **Secondary Text (Descriptions, inactive states)**: `text-slate-400` or `text-slate-500`
*   **🚨 NEVER use black texts (`text-black`, `text-[#1a1612]`, etc.) anywhere in the UI.**

## 3. Glassmorphism vs. Solid Design

KoBar allows the user to toggle between a "Solid" design (`style1`) and a "Glass" design (`style2`). Components like the Sidebar or Popups must adapt dynamically using the Zustand store (`useAppStore(state => state.design)`).

**The Glassmorphism Formula:**
```tsx
const design = useAppStore(state => state.design);
const glassOpacity = useAppStore(state => state.glassOpacity); // e.g. 80
const isMac = useAppStore(state => state.isMac);

<div 
  className={`... 
    ${design === 'style2' 
      ? (isMac ? 'backdrop-blur-md' : 'backdrop-blur-2xl') // Mac often relies on native vibrancy, Windows relies on CSS
      : 'shadow-2xl'
    }
  `}
  style={{
    backgroundColor: design === 'style2' 
      ? `color-mix(in srgb, var(--theme-surface) ${glassOpacity}%, transparent)` 
      : 'var(--theme-surface)',
    borderColor: design === 'style2' ? 'rgba(255,255,255,0.1)' : 'var(--theme-border)',
    borderWidth: '1px'
  }}
>
```

## 4. Typography

*   **Font Family**: The primary font is **Space Grotesk** (`font-display`).
*   **Sizing**: UIs are compact. Use smaller font sizes:
    *   Normal text: `text-sm` or `text-xs`.
    *   Micro text (headers, labels): `text-[10px] uppercase tracking-wider font-bold`.
*   **Leading/Tracking**: Keep text tightly packed.

## 5. Standard Component Rules

### Icons
*   Always use Google Material Symbols Outlined.
*   Implementation: `<span className="material-symbols-outlined text-[16px]">icon_name</span>`
*   Do not use SVGs or external icon libraries unless absolutely necessary.

### Buttons & Interactive Elements
*   **Sizing**: Most buttons are `w-6 h-6`, `w-8 h-8`, or `h-10 px-3`.
*   **Corners**: Always use `rounded-lg`, `rounded-md`, or `rounded-full`.
*   **Interaction Feedback (CRITICAL)**: 
    *   Every clickable element MUST have a transition: `transition-all`.
    *   Hover state: Change background slightly and brighten text. Example: `bg-white/5 text-slate-400 hover:text-white hover:bg-white/10`.
    *   Active/Press state: Shrink slightly. Example: `active:scale-95`.
*   **Focus Outlines**: Remove default focus outlines to prevent ugly browser rings (`focus:outline-none`).

### Scrollbars
*   Always apply the `custom-scrollbar` class to overflowing containers to match the thin, themed scrollbar defined in `index.css`.
*   Hide scrollbars when unnecessary using `scrollbar-hide`.

### Popups & Modals
*   Must have an entry animation: `animate-in fade-in zoom-in duration-200`.
*   Must have a high z-index (e.g., `z-50` or `z-[99999]`).
*   Must be rounded: `rounded-xl`.
*   Must cast a shadow in solid mode: `shadow-2xl`.

## 6. 🚨 CRITICAL: Electron Drag Regions & Click Events

KoBar operates as a transparent overlay in Electron.

**The "Pointer Events" Rule:**
*   The root container is usually `pointer-events-none` so mouse clicks pass through the transparent areas of the window to the OS below.
*   Any actual UI element you create MUST have `pointer-events-auto` or `pointer-events-auto select-auto` (for text inputs), otherwise the user will click right through it!

**The "Drag Region" Rule:**
*   In Electron, regions that let the user drag the window are often marked natively. 
*   However, in KoBar, dragging is mostly handled programmatically (e.g., `handleSidebarDragStart` via React events).
*   **You MUST append the class `no-drag-region` to EVERY button, input, or clickable element.** If a clickable element sits on top of a draggable area and does not have `no-drag-region` (or `-webkit-app-region: no-drag`), Electron will capture the mouse down event as a window-drag, and the React `onClick` event will never fire!

```tsx
// CORRECT Button Example
<button 
    onClick={handleClick}
    className="w-6 h-6 rounded-lg flex items-center justify-center transition-all bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white active:scale-95 no-drag-region"
>
    <span className="material-symbols-outlined text-[16px]">check</span>
</button>
```

## 7. Global State and IPC Integration

*   **Store Access**: Use `useAppStore` for global settings (`isMac`, `orientation`, `edgePosition`, `theme`, `design`). Do not use local `useState` for things that affect the entire layout.
*   **OS Context**: Always check `isMac` if you are applying intensive CSS filters. macOS handles `backdrop-filter` slightly differently and KoBar relies on Electron's native vibrancy in some mac scenarios.

## Summary Checklist for New Components
1. [ ] Is the background using a `var(--theme-...)` or a transparent `bg-white/5`?
2. [ ] Are corners adequately rounded (`rounded-lg`, `rounded-xl`)?
3. [ ] Does it support the `style2` Glassmorphism toggle if it's a large container?
4. [ ] Are icons using `material-symbols-outlined`?
5. [ ] Do buttons have `hover:`, `active:scale-95`, and `transition-all`?
6. [ ] **CRITICAL:** Does every interactive element have the `no-drag-region` class?
7. [ ] **CRITICAL:** Does the container have `pointer-events-auto` so it can be clicked?
