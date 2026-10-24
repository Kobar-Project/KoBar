---
name: kobar-ui-ux-designer
description: Guide for writing UI for the KoBar host app (remastered design system, KoBar 1.4.0 and later). Covers the three windows and where state lives, the --kb-* tokens and Tailwind utilities, the src/ui primitives with TSX examples, z-index layers, motion, focus ring, accessibility, icons, typography, i18n (locale JSON + useT), platform differences, and the known exceptions in current code. Use it when building or reviewing any KoBar host UI.
---

# KoBar UI Guide (remastered design system)

This file documents the KoBar design system for agents writing host UI in `src/`. The source of truth is the design tokens
in `src/index.css` and the primitives in `src/ui/`.
It documents the current system; it is **not binding on plugin authors**. Plugin authors follow
`for-agents/kobar-plugin-developer/SKILL.md`. Anything marked **LEGACY** below exists only so v1 plugins keep working;
never use it in new host code.

## 1. Character

Native-calm: a quiet shell, with colour only for state, selection, focus and the single primary action. No glow, no
gradients, no grow-on-hover, no decorative animation. Light and dark schemes both exist; never assume dark.
Corners are modest (6 / 8 / 12 / 16 px), not "as round as possible".

## 2. Windows and where state lives

KoBar renders host UI in three windows. Know which one you are in before you read state or add an interaction.

| Window | Entry | State | Notes |
|---|---|---|---|
| Main (bar, notes, plugin panels) | `index.html`, `src/main.tsx`, `src/App.tsx` | `useAppStore` (persisted, migrated) | Transparent click-through overlay (section 12). The only window with the plugin runtime and `window.api`. Mounts the one `<ToastRegion>`. |
| Settings | `settings.html`, `src/settings/main.tsx`, `src/settings/SettingsApp.tsx`, pages in `src/settings/pages/` | **No `useAppStore`.** Read the main window's mirrored snapshot with `useSettingsState(selector)` / `useSystemSummary()`; change things only through `dispatchSettingsAction`, `dispatchPluginAction`, `dispatchSystemAction` (`src/settings/mirror.ts`). Actions are allow-listed and validated by the main window. | Normal framed window with its own narrow preload; no plugin runtime, no toasts. Pages receive `t` through `SettingsPageProps`. Anything that needs plugin code (a plugin's settings panel, the GitHub install form) is opened in the main window via an action. |
| PiP | `pip.html`, `src/pip/` | Local only | Mini browser for KoPlayer; narrow preload. |

## 3. Root attributes (set on `:root`, do not set them in components)

| Attribute | Values |
|---|---|
| `data-scheme` | `dark` / `light` |
| `data-accent` | `amber` (default) `orange` `red` `pink` `violet` `blue` `green` `graphite` `custom` |
| `data-density` | `compact` / `normal` / `comfortable` |
| `data-material` | `solid` / `translucent` (bar and panel shells only) |
| `data-platform` | `win32` / `darwin` / `linux` (set by `setDocumentPlatform`, `src/platform.ts`, before the first render) |
| `data-theme`, `data-design` | **LEGACY**, kept read-only for v1 plugins (`data-design` = `style1`/`style2`, the v1 view of `material`) |

Components never branch on these; the tokens change underneath them. In JS, use `isMacPlatform()` / `getDocumentPlatform()`
from `src/platform.ts` when behaviour (not styling) depends on the platform.

## 4. Tokens and utilities

Use semantic utilities. Never use raw palette utilities (`bg-slate-800`, `text-white`, `bg-blue-500`) for structure.

| Need | Utility (token) |
|---|---|
| Bar / panel background | `bg-shell` (`--kb-bg-shell`) |
| Card, popover, menu, dialog | `bg-surface` (`--kb-bg-surface`) |
| Input, editor background | `bg-inset` (`--kb-bg-inset`) |
| Text | `text-fg-1` (primary), `text-fg-2` (secondary, icons), `text-fg-3` (placeholder/disabled only, never meaningful text) |
| Border | `border-stroke` (subtle decorative, `--kb-stroke-subtle`); `--kb-stroke-strong`; form control borders use `--kb-stroke-control` (primitives do this) |
| Elevation | `shadow-e1` card, `shadow-e2` tooltip/menu/popover, `shadow-e3` bar/panel/dialog; always with a 1 px subtle stroke |
| Accent | `var(--kb-accent)` (e.g. `bg-[var(--kb-accent)]`); text on accent is `--kb-on-accent`; `--kb-accent-hover`, `--kb-accent-pressed`, `--kb-accent-subtle` |
| Status | `--kb-success`, `--kb-warning`, `--kb-danger`, `--kb-info` (always paired with an icon or text). Only danger has utilities (`text-danger`, `bg-danger`); write the others as `text-[var(--kb-success)]` |
| Interaction fills | `bg-fill-hover`, `bg-fill-selected` (utilities); `--kb-fill-pressed`, `--kb-accent-subtle` (via `var()`) |
| Radius | `rounded-xs` 4 (checkbox), `rounded-sm` 6 (button/input), `rounded-md` 8 (row, card, bar item), `rounded-lg` 12 (panel, popover, dialog), `rounded-xl` 16 (bar shell), `rounded-full` (avatar, Toggle, mini-mode button) |
| Spacing | Tailwind 4 px scale only (0.5, 1, 2, 3, 4, 5, 6, 8, 10). No arbitrary values like `p-[13px]`. Panel padding 16, row vertical 8-10, between controls 8, between groups 24 |
| Density-driven sizes | `--kb-bar-thickness`, `--kb-bar-item`, `--kb-bar-icon`, `--kb-control-h`, `--kb-row-h` (change with `data-density`) |
| Blur (translucent material) | `backdrop-blur-(--kb-blur-bar)`, `--kb-blur-eye`, `--kb-blur-notification`, `--kb-blur-toggle`; macOS gets lighter values automatically. Never hard-code a blur radius. |
| Other | `--kb-scrim` (dialog backdrop), `--kb-opacity-disabled`, `--kb-opacity-drag` |

Colour rules:
- **ESLint forbids `#hex` and `rgb(`/`rgba(` inside any JSX `className`** (string or template literal, including
  conditionals; `eslint.config.js`, error level). If you need a colour, use a token utility or `bg-[var(--kb-...)]`.
- The accent never paints backgrounds of large areas; it marks selection, focus and the one primary action.
- On a translucent shell, accent is never the only signal for state; add an icon, fill or text. Cards with text stay solid.
- Never use pure black text. Use `text-fg-1`.
- Contrast: text 4.5:1, controls/indicators 3:1. If you add a colour, compute it.

## 5. Typography

- System font stack via tokens (`--kb-font`, `--kb-font-display`, `--kb-font-mono`); Segoe UI Variable on Windows, SF Pro on
  macOS (the `darwin` block reorders the stack). The body default is already set; do not apply `font-display` or a font family.
- Roles: caption 11/16, body 13/20, body-strong 13/20 weight 600 (buttons, row titles, section headers in sentence case, `text-fg-2`), subtitle 15/22 (panel title), title 20/28, display 28/36 (note title only).
- No uppercase, wide-tracked micro labels (`text-[10px] uppercase tracking-wider` is gone).
- **LEGACY:** Space Grotesk stays only as an `@font-face` alias for v1 plugins. Host code never uses it.

## 6. Icons

- Material Symbols Outlined, loaded **locally** (variable font, default `wght 300`, `opsz 20`).
- Use `<Icon>`; sizes 16 / 20 / 24 only. Active/selected state uses `filled` (FILL axis 1), not a different icon.
- Icon names are part of the plugin contract; the family does not change. Do not add SVG icon libraries.
- Decorative icons are hidden from assistive tech automatically; give `label` only if the icon alone carries meaning.

```tsx
<Icon name="settings" size={20} />
<Icon name="star" filled size={16} />
<Icon name="warning" size={20} label={t('status.warning')} />
```

## 7. Primitives (`import { ... } from '../ui'` / `src/ui/index.ts`)

All primitives use only `--kb-*` tokens and already apply `no-drag-region`, `pointer-events-auto`, the focus ring and
reduced-motion handling. Do not re-add those classes on top. Primitives contain no i18n: pass translated strings.

Pick the primitive first; hand-written `<button className=...>` is the exception.

| Need | Use |
|---|---|
| Text action | `Button` (`variant`: `primary` / `secondary` / `subtle` / `danger`; `size`: `sm` / `md`; `icon`, `loading`, `fullWidth`). At most **one `primary` per screen**. |
| Icon-only action | `IconButton` (`icon`, **`label` required**, `size` 28/32/40, `pressed`, `tooltip` (`false` to hide, or a string), `tooltipSide`). Label is the aria-label and default tooltip. |
| Container | `Surface` (`as`, `level` shell/surface/inset, `elevation` e0..e3, `radius` none/sm/md/lg/xl, `material` (boolean, shells only)) |
| Hint on hover/focus | `Tooltip` (`content`, one focusable child, `side` auto/top/bottom/left/right, `delay`, `disabled`, `describe`) |
| On/off setting | `Toggle` (`checked`, `onChange(checked)`, `label` required, `description`, `hideLabel`, `fullWidth`) |
| List/settings row | `ListItem` (`title`, `description`, `leading`, `trailing`, `onClick`, `selected`, `current`, `disabled`, `as="li"`) |
| Switch views | `Tabs` (`variant` underline/segmented, `items`, `value`, `onChange`, `fullWidth`) |
| Choose 1 of few | `Segmented` (`items`, `value`, `onChange`, `fullWidth`) |
| Text input | `TextField` (`label` required, `hideLabel`, `hint`, `error`, `icon`) |
| Dropdown choice | `Select` (`label` required, `options` or `<option>` children, `hint`, `error`) |
| Anchored floating content | `Popover` (`trigger`, `placement`, `open`/`defaultOpen`/`onOpenChange`, `initialFocus`, `returnFocus`; `usePopoverClose()` inside) |
| Action list | `Menu` (`trigger`, `items`: item / checkbox / radio / separator) |
| Blocking dialog | `Dialog` (`open`, `onClose(reason)`, `title`, `description`, `footer`, `size` sm/md/lg, `closeLabel`, `role` dialog/alertdialog) |
| Confirm a (destructive) action | `ConfirmDialog` (`danger` focuses Cancel first; `loading`) |
| Transient feedback | `toast.success/info/warning/error(message, opts)` + the one `<ToastRegion dismissLabel=... />` (main window only) |
| Nothing to show | `EmptyState` (`icon`, `title`, `description`, `action`) |
| Loading placeholder | `Skeleton` (`shape` line/block/circle, `width`, `height`, `lines`); static, no shimmer |
| Host panel | `PanelShell` (see section 8) |

Examples:

```tsx
// Primary + secondary action, with an icon and a loading state
<Button variant="primary" icon="add" loading={saving} onClick={save}>{t('save')}</Button>
<Button variant="secondary" onClick={close}>{t('cancel')}</Button>

// Icon-only button: label is mandatory; pressed = toggle state
<IconButton icon="push_pin" label={t('pinToggle')} pressed={pinned} onClick={togglePin} />

// Setting row with a Toggle; hideLabel because the row already shows the title
<ListItem
  title={t('settingsSound')}
  description={t('settingsSoundHint')}
  trailing={<Toggle checked={sound} onChange={setSound} label={t('settingsSound')} hideLabel />}
/>

// Form fields
<TextField label={t('noteTitle')} value={title} onChange={(e) => setTitle(e.target.value)} error={err} />
<Select label={t('settingsEdge')} value={edge} onChange={(e) => setEdge(e.target.value)}
        options={[{ value: 'left', label: t('edgeLeft') }, { value: 'right', label: t('edgeRight') }]} />

// Tabs / Segmented are controlled
<Segmented items={[{ value: 'a', label: t('optionA') }, { value: 'b', label: t('optionB'), icon: 'list' }]} value={v} onChange={setV} />

// Menu with a destructive item
<Menu
  aria-label={t('noteMenu')}
  trigger={<IconButton icon="more_vert" label={t('more')} />}
  items={[
    { id: 'rename', label: t('rename'), onSelect: rename },
    { type: 'separator' },
    { id: 'delete', label: t('delete'), danger: true, onSelect: askDelete },
  ]}
/>

// Destructive confirmation (every string from src/i18n/locales/*.json via t)
<ConfirmDialog open={open} danger title={t('deleteConfirmMsg')} confirmLabel={t('delete')}
               cancelLabel={t('cancel')} onConfirm={doDelete} onCancel={() => setOpen(false)} />

// Toasts: the main window mounts <ToastRegion> once; call from anywhere in that window
toast.success(t('noteSaved'), { action: { label: t('undo'), onClick: undo } });

// Container and empty state
<Surface level="surface" elevation="e1" radius="md" className="p-4">...</Surface>
<EmptyState icon="inbox" title={t('pluginsNone')} action={<Button onClick={browse}>{t('pluginsBrowse')}</Button>} />
```

(The keys above are illustrative; use or add real keys in `en.json`.)

Item shapes: action items take `type?`, `shortcut`, `danger`, `onSelect`; checkbox items take `type: 'checkbox'`, `checked`, `onCheckedChange`, `closeOnSelect`; radio items take `type: 'radio'`, `checked`, `onSelect` (one radio set per Menu). Every item except a separator needs an `id`.

**Hand-written controls** (the exception): compose classes with `cx()` and start from the shared `INTERACTIVE` string
(`src/ui/cx.ts`: `no-drag-region pointer-events-auto select-none` + keyboard focus ring). Keep every class literal visible
in the source so Tailwind can see it. An element that must not count as "outside" for open popovers/dialogs gets
`data-kb-layer-ignore` (`src/ui/layers.ts`).

## 8. Host panels

Host panels render inside `PanelShell` (`title`, `icon`, `actions`, `onClose(reason)`, **`closeLabel` required**, `footer`,
`size` s 320x440 / m 400x560 default / l 480x640 as a max height, `position` left/right/top/bottom, `padded`,
`closeOnEscape`, `initialFocus`, `returnFocus`). It supplies the shell material, radius `lg`, `shadow-e3`, Esc to close,
focus management and the panel z-layer.

```tsx
<PanelShell title={t('notes')} icon="sticky_note_2" size="m" closeLabel={t('close')}
            onClose={closePanel} actions={<IconButton icon="add" label={t('addNewNote')} onClick={addNote} />}>
  ...
</PanelShell>
```

**LEGACY:** v1 plugin panels, inline widgets and settings panels are wrapped in `data-scheme="dark"` (and the plugin panel
host lets the user drag the panel along the bar). The planned `chrome: 'host'` option for plugins is not implemented yet.
Their hard-coded white text stays readable even when the host is in the light scheme. Do not build new host UI that relies
on this wrapper.

## 9. Layers (z-index): six values, nothing else

`--kb-z-bar` 10 (bar, mini-mode button) / `--kb-z-panel` 20 (panels, PanelShell) / `--kb-z-dialog` 30 (Dialog, ConfirmDialog)
/ `--kb-z-popover` 40 (Popover, Menu, Select list) / `--kb-z-toast` 50 / `--kb-z-tooltip` 60.
Never write `z-50`, `z-[99999]` or similar in host code; primitives place themselves. For JS-positioned code use the
`Z` constant from `src/ui/tokens.ts`. Open popovers close when a dialog opens. **LEGACY:** a v1 plugin's own
`z-[9999]` stays inside its root and is left alone.

## 10. Motion

- Only `opacity` and `transform: translate` animate. Durations: `--kb-dur-fast` 100 ms (hover, press, Toggle), `--kb-dur-normal` 160 ms (tooltip, menu, popover), `--kb-dur-slow` 240 ms (panel, upper limit). Easings: `--kb-ease-out` for enter, `--kb-ease-in` for exit, `--kb-ease-standard` for movement. In JS use `DURATION_MS` / `EASING` from `src/ui/tokens.ts`.
- Keyframes `kb-fade`, `kb-pop` (4 px shift, no scale), `kb-slide` (8 px shift, direction from `--kb-slide-x`/`--kb-slide-y`); classes `.kb-fade`, `.kb-pop`, `.kb-slide`.
- Forbidden: shimmer, `animate-pulse`, glow, breathing, hover/press scale (`active:scale-95` and `zoom-in` are gone; pressed = fill change), continuous decoration.
- `prefers-reduced-motion: reduce` sets all durations to 0 and leaves only an 80 ms fade; spinners and pulses become static. Do not write custom animations that ignore it.

## 11. Focus and accessibility

- Never `outline: none` / `focus:outline-none` on interactive elements. The ring is `--kb-focus-ring`, shown only on `:focus-visible` (primitives and `INTERACTIVE` do it; otherwise use `focus-visible:shadow-[var(--kb-focus-ring)]`).
- Every interactive element has an accessible name: `IconButton` `label`, `TextField`/`Select`/`Toggle` `label` (use `hideLabel` to hide visually), `Dialog`/`PanelShell` `title`, `closeLabel` where required.
- Do not use colour as the only channel: selection = fill + 3 px accent bar + `aria-selected` / `aria-current`; status = colour + icon/text.
- Min hit target 28 px at every density. Tab order follows visual order. Esc closes popover first, then panel. Dialogs/panels trap focus and return it to the opener.
- Tooltip is supplementary; never the only place information lives.
- Toasts: `role="status"`, errors `role="alert"`; avoid interrupting for non-errors.
- Right-to-left: Arabic (`ar`) renders RTL. Prefer logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`); code that measures drag direction must read `getComputedStyle(el).direction` (see `src/notes/NoteListResizer.tsx`).

## 12. Electron overlay constraints (main window)

The main window is a transparent overlay: the root is `pointer-events-none`, and window dragging is handled in code. On every
mouse move `App.tsx` checks `closest('.pointer-events-auto')` to switch the OS click-through. Primitives already add
`pointer-events-auto` and `no-drag-region`. **For a hand-written interactive element** you must add both (use `INTERACTIVE`;
text inputs: `pointer-events-auto select-auto`), or the click passes through or is eaten by the drag. Overflowing
containers use the `custom-scrollbar` class (`scrollbar-hide` to hide; on macOS native overlay scrollbars are kept).
Text selection is off globally (`* { user-select: none }`) except inputs, textareas and `contenteditable`; add `select-text`
where users must copy text. The Settings and PiP windows are ordinary windows without these constraints.

## 13. State, i18n and platform

- Main window: global layout/appearance state lives in `useAppStore` (`orientation`, `edgePosition`, `isMac`,
  scheme/accent/density/material fields), not in local `useState`. Settings window: `useSettingsState` + dispatch actions
  (section 2). Persisted state changes need a migration (`src/store/migrations/`, `KOBAR_STORAGE_VERSION`).
- **No hard-coded UI strings.** All text, `aria-label`, `title`, placeholder, toast and dialog text comes from
  `src/i18n/locales/<lang>.json`, in **all ten** languages (`en` is the reference; `TranslationKeys` is typed from
  `en.json`). Read strings with `const t = useT()` (`src/i18n/useT.ts`) in components, `translate(language, key)` outside
  React, and `t` from `SettingsPageProps` in Settings pages. Never branch on a language (`language === 'tr'` is rejected by
  `tests/hardcodedStrings.test.ts`). Main-process strings (tray, native dialogs, notices) live in `electron/lib/mainStrings.cts`.
  Primitives never translate; the caller does.
- Shortcut labels come from `formatShortcut('Mod+Shift+S')` / `modifierLabel('mod' | 'alt')` (`src/utils/formatShortcut.ts`):
  `⇧⌘S` on macOS, `Ctrl+Shift+S` elsewhere. Never write "Ctrl" into a string.
- Platform: do not branch styling on `isMac`. Blur strength, fonts and scrollbars already follow `data-platform`
  through tokens. Material "translucent" is alpha plus an in-page backdrop blur; a transparent Electron window cannot blur
  the desktop behind it.

## 14. LEGACY, do not use in new code

Removed rules from the old guide that conflict with the new system: forced glassmorphism for every container
(`style2` + `backdrop-blur-2xl` formula), `--theme-*` variables for structure, amber/accent-glow shadows
(`--theme-accent-glow`), the slate palette and `text-white` for text, `transition-all` + `active:scale-95` on every button,
`focus:outline-none`, `animate-in fade-in zoom-in` popup entry, `z-50` / `z-[99999]`, Space Grotesk (`font-display`),
uppercase micro labels, `rounded-[2.5rem]` / `rounded-3xl`.
`--theme-*`, `bg-primary`, `bg-background-dark`, `data-theme` and `data-design` still resolve for v1 plugins; use `--kb-*`
and the semantic utilities in host code.

## 15. Known exceptions in current code (do not copy)

These host files still contain patterns this guide forbids. They are scheduled clean-ups, not precedents. When you touch
one, migrate the part you touch.

| File | Pattern |
|---|---|
| `src/components/layout/Sidebar.tsx` | `z-50`, `z-[60]`, `z-[1000]`; `rounded-[2.5rem]` / `rounded-3xl` and `shadow-2xl` on the legacy style2/style1 bar shell; `animate-pulse` on the tutorial highlight; `transition-all`; `bg-orange-500 text-black` badge |
| `src/components/layout/EyeNotification.tsx` | `z-[100]`, `rounded-2xl shadow-2xl`, `bg-green-600` / `bg-red-600` / `bg-blue-600` + `text-white` buttons |
| `src/components/layout/FloatingEye.tsx` | `z-[999]`, `z-[1000]` badge |
| `src/components/notes/NotePanel.tsx` | `z-[100]`, `rounded-[2.5rem]` (style2) |
| `src/components/notes/ResizerHandle.tsx` | `z-50` |
| `src/components/plugins/PluginSettingsHost.tsx` | `uppercase tracking-wider` headings, `bg-red-500/10` error box, hand-written inputs |

## Checklist

1. [ ] Is there a primitive for it? Use it.
2. [ ] Colours only from tokens (no hex/rgb in `className`, no raw palette, no black text)?
3. [ ] Works in light and dark, with every accent, and in all three densities?
4. [ ] Every control has an accessible name; state is not colour-only?
5. [ ] No glow/shimmer/scale; motion is opacity/translate and respects reduced motion?
6. [ ] No hard-coded z-index, arbitrary spacing, strings or shortcut names; new keys added to all ten locale files?
7. [ ] Hand-written interactive elements use `INTERACTIVE` (or `pointer-events-auto` + `no-drag-region` + focus ring)?
8. [ ] Right window, right state model (main `useAppStore` vs Settings mirror + actions)?
9. [ ] RTL and macOS checked (logical properties, `formatShortcut`, no platform-specific styling)?
10. [ ] `npm run lint`, `npx tsc -b` and `npm test` pass (design-token, ESLint-colour, i18n, hard-coded-string and a11y tests guard these rules)?
