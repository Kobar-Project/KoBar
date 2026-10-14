---
name: kobar-ui-ux-designer
description: Guide for writing UI for the KoBar host app (remastered design system). Covers the --kb-* tokens and Tailwind utilities, the src/ui primitives with TSX examples, z-index layers, motion, focus ring, accessibility rules, icons, typography and i18n. Use it when building or reviewing any KoBar host UI.
---

# KoBar UI Guide (remastered design system)

This file documents the **new** KoBar design system for agents writing host UI in `src/`. The source of truth is
the design tokens in `src/index.css` and the primitives in `src/ui/`.
It documents the current system; it is **not binding on plugin authors**. Plugin authors follow
`for-agents/kobar-plugin-developer/SKILL.md`. Anything marked **LEGACY** below exists only so v1 plugins keep working;
never use it in new host code.

## 1. Character

Native-calm: a quiet shell, with colour only for state, selection, focus and the single primary action. No glow, no
gradients, no grow-on-hover, no decorative animation. Light and dark schemes both exist; never assume dark.
Corners are modest (6 / 8 / 12 / 16 px), not "as round as possible".

## 2. Root attributes (set on `:root`, do not set them in components)

| Attribute | Values |
|---|---|
| `data-scheme` | `dark` / `light` |
| `data-accent` | `amber` (default) `orange` `red` `pink` `violet` `blue` `green` `graphite` `custom` |
| `data-density` | `compact` / `normal` / `comfortable` |
| `data-material` | `solid` / `translucent` (bar and panel shells only) |
| `data-theme` | **LEGACY**, kept read-only for v1 plugins |

Components never branch on these; the tokens change underneath them.

## 3. Tokens and utilities

Use semantic utilities. Never use raw palette utilities (`bg-slate-800`, `text-white`, `bg-blue-500`) for structure.

| Need | Utility (token) |
|---|---|
| Bar / panel background | `bg-shell` (`--kb-bg-shell`) |
| Card, popover, menu, dialog | `bg-surface` (`--kb-bg-surface`) |
| Input, editor background | `bg-inset` (`--kb-bg-inset`) |
| Text | `text-fg-1` (primary), `text-fg-2` (secondary, icons), `text-fg-3` (placeholder/disabled only, never meaningful text) |
| Border | `border-stroke` (subtle decorative); form control borders use `--kb-stroke-control` (primitives do this) |
| Elevation | `shadow-e1` card, `shadow-e2` tooltip/menu/popover, `shadow-e3` bar/panel/dialog; always with a 1 px subtle stroke |
| Accent | `var(--kb-accent)` (e.g. `bg-[var(--kb-accent)]`); text on accent is `--kb-on-accent` |
| Status | `--kb-success`, `--kb-warning`, `--kb-danger`, `--kb-info` (always paired with an icon or text) |
| Interaction fills | `--kb-fill-hover`, `--kb-fill-pressed`, `--kb-fill-selected`, `--kb-accent-subtle` |
| Radius | `rounded-xs` 4 (checkbox), `rounded-sm` 6 (button/input), `rounded-md` 8 (row, card, bar item), `rounded-lg` 12 (panel, popover, dialog), `rounded-xl` 16 (bar shell), `rounded-full` (avatar, Toggle, mini-mode button) |
| Spacing | Tailwind 4 px scale only (0.5, 1, 2, 3, 4, 5, 6, 8, 10). No arbitrary values like `p-[13px]`. Panel padding 16, row vertical 8-10, between controls 8, between groups 24 |

Colour rules:
- **ESLint forbids `#hex` and `rgb(`/`rgba(` inside any JSX `className`** (string or template literal, including
  conditionals; `eslint.config.js`, error level). If you need a colour, use a token utility or `bg-[var(--kb-...)]`.
- The accent never paints backgrounds of large areas; it marks selection, focus and the one primary action.
- On a translucent shell, accent is never the only signal for state; add an icon, fill or text. Cards with text stay solid.
- Never use pure black text. Use `text-fg-1`.
- Contrast: text 4.5:1, controls/indicators 3:1. If you add a colour, compute it.

## 4. Typography

- System font stack via tokens (`--kb-font`, `--kb-font-display`, `--kb-font-mono`); Segoe UI Variable / SF Pro. The body default is already set; do not apply `font-display` or a font family.
- Roles: caption 11/16, body 13/20, body-strong 13/20 weight 600 (buttons, row titles, section headers in sentence case, `text-fg-2`), subtitle 15/22 (panel title), title 20/28, display 28/36 (note title only).
- No uppercase, wide-tracked micro labels (`text-[10px] uppercase tracking-wider` is gone).
- **LEGACY:** Space Grotesk stays only as an `@font-face` alias for v1 plugins. Host code never uses it.

## 5. Icons

- Material Symbols Outlined, loaded **locally** (variable font, default `wght 300`, `opsz 20`).
- Use `<Icon>`; sizes 16 / 20 / 24 only. Active/selected state uses `filled` (FILL axis 1), not a different icon.
- Icon names are part of the plugin contract; the family does not change. Do not add SVG icon libraries.
- Decorative icons are hidden from assistive tech automatically; give `label` only if the icon alone carries meaning.

```tsx
<Icon name="settings" size={20} />
<Icon name="star" filled size={16} />
<Icon name="warning" size={20} label={t('status.warning')} />
```

## 6. Primitives (`import { ... } from '../ui'` / `src/ui/index.ts`)

All primitives use only `--kb-*` tokens and already apply `no-drag-region`, `pointer-events-auto`, the focus ring and
reduced-motion handling. Do not re-add those classes on top. Primitives contain no i18n: pass translated strings.

Pick the primitive first; hand-written `<button className=...>` is the exception.

| Need | Use |
|---|---|
| Text action | `Button` (`variant`: `primary` / `secondary` / `subtle` / `danger`; `size`: `sm` / `md`; `icon`, `loading`, `fullWidth`). At most **one `primary` per screen**. |
| Icon-only action | `IconButton` (`icon`, **`label` required**, `size` 28/32/40, `pressed`, `tooltip`, `tooltipSide`). Label is the aria-label and default tooltip. |
| Container | `Surface` (`as`, `level` shell/surface/inset, `elevation` e0..e3, `radius`, `material` for shells only) |
| Hint on hover/focus | `Tooltip` (`content`, one focusable child, `side`, `delay`, `disabled`, `describe`) |
| On/off setting | `Toggle` (`checked`, `onChange(checked)`, `label` required, `description`, `hideLabel`, `fullWidth`) |
| List/settings row | `ListItem` (`title`, `description`, `leading`, `trailing`, `onClick`, `selected`, `current`, `disabled`, `as="li"`) |
| Switch views | `Tabs` (`variant` underline/segmented, `items`, `value`, `onChange`) |
| Choose 1 of few | `Segmented` (`items`, `value`, `onChange`, `fullWidth`) |
| Text input | `TextField` (`label` required, `hideLabel`, `hint`, `error`, `icon`) |
| Dropdown choice | `Select` (`label` required, `options` or `<option>` children, `hint`, `error`) |
| Anchored floating content | `Popover` (`trigger`, `placement`, `open`/`onOpenChange`; `usePopoverClose()` inside) |
| Action list | `Menu` (`trigger`, `items`: item / checkbox / radio / separator) |
| Blocking dialog | `Dialog` (`open`, `onClose`, `title`, `footer`, `size`, `closeLabel`) |
| Confirm a (destructive) action | `ConfirmDialog` (`danger` focuses Cancel first) |
| Transient feedback | `toast.success/info/warning/error(message, opts)` + one `<ToastRegion dismissLabel=... />` |
| Nothing to show | `EmptyState` (`icon`, `title`, `description`, `action`) |
| Loading placeholder | `Skeleton` (`shape`, `width`, `height`, `lines`); static, no shimmer |
| Host panel | `PanelShell` (see section 7) |

Examples:

```tsx
// Primary + secondary action, with an icon and a loading state
<Button variant="primary" icon="add" loading={saving} onClick={save}>{t('common.save')}</Button>
<Button variant="secondary" onClick={close}>{t('common.cancel')}</Button>

// Icon-only button: label is mandatory; pressed = toggle state
<IconButton icon="push_pin" label={t('pin.toggle')} pressed={pinned} onClick={togglePin} />

// Setting row with a Toggle; hideLabel because the row already shows the title
<ListItem
  title={t('settings.sound')}
  description={t('settings.soundHint')}
  trailing={<Toggle checked={sound} onChange={setSound} label={t('settings.sound')} hideLabel />}
/>

// Form fields
<TextField label={t('note.title')} value={title} onChange={(e) => setTitle(e.target.value)} error={err} />
<Select label={t('settings.edge')} value={edge} onChange={(e) => setEdge(e.target.value)}
        options={[{ value: 'left', label: t('edge.left') }, { value: 'right', label: t('edge.right') }]} />

// Tabs / Segmented are controlled
<Segmented items={[{ value: 'a', label: t('x.a') }, { value: 'b', label: t('x.b'), icon: 'list' }]} value={v} onChange={setV} />

// Menu with a destructive item
<Menu
  aria-label={t('note.menu')}
  trigger={<IconButton icon="more_vert" label={t('common.more')} />}
  items={[
    { id: 'rename', label: t('common.rename'), onSelect: rename },
    { type: 'separator' },
    { id: 'delete', label: t('common.delete'), danger: true, onSelect: askDelete },
  ]}
/>

// Destructive confirmation (strings from translations.ts)
<ConfirmDialog open={open} danger title={t('note.deleteTitle')} confirmLabel={t('common.delete')}
               cancelLabel={t('common.cancel')} onConfirm={doDelete} onCancel={() => setOpen(false)} />

// Toasts: mount <ToastRegion dismissLabel={t('common.dismiss')} /> once; call from anywhere
toast.success(t('note.saved'), { action: { label: t('common.undo'), onClick: undo } });

// Container and empty state
<Surface level="surface" elevation="e1" radius="md" className="p-4">...</Surface>
<EmptyState icon="inbox" title={t('plugins.none')} action={<Button onClick={browse}>{t('plugins.browse')}</Button>} />
```

Item shapes: action items take `type?`, `shortcut`, `danger`, `onSelect`; checkbox items take `type: 'checkbox'`, `checked`, `onCheckedChange`, `closeOnSelect`; radio items take `type: 'radio'`, `checked`, `onSelect` (one radio set per Menu). Every item except a separator needs an `id`.

## 7. Host panels

Host panels render inside `PanelShell` (`title`, `icon`, `actions`, `onClose`, **`closeLabel` required**, `footer`,
`size` s 320x440 / m 400x560 default / l 480x640 as a max height, `position`, `padded`). It supplies the shell
material, radius `lg`, `shadow-e3`, Esc to close, focus management and the panel z-layer.

```tsx
<PanelShell title={t('notes.title')} icon="sticky_note_2" size="m" closeLabel={t('common.close')}
            onClose={closePanel} actions={<IconButton icon="add" label={t('notes.new')} onClick={addNote} />}>
  ...
</PanelShell>
```

**LEGACY:** v1 plugin panels (registered without the planned `chrome: 'host'` option (not implemented yet)) and v1 plugin settings panels are wrapped in
`data-scheme="dark"` so their hard-coded white text stays readable even when the host is in the light scheme. Do not
build new host UI that relies on this wrapper.

## 8. Layers (z-index): six values, nothing else

`--kb-z-bar` 10 (bar, mini-mode button) / `--kb-z-panel` 20 (panels, PanelShell) / `--kb-z-dialog` 30 (Dialog, ConfirmDialog)
/ `--kb-z-popover` 40 (Popover, Menu, Select list) / `--kb-z-toast` 50 / `--kb-z-tooltip` 60.
Never write `z-50`, `z-[99999]` or similar in host code; primitives place themselves. For JS-positioned code use the
`Z` constant from `src/ui/tokens.ts`. Open popovers close when a dialog opens. **LEGACY:** a v1 plugin's own
`z-[9999]` stays inside its root and is left alone.

## 9. Motion

- Only `opacity` and `transform: translate` animate. Durations: `--kb-dur-fast` 100 ms (hover, press, Toggle), `--kb-dur-normal` 160 ms (tooltip, menu, popover), `--kb-dur-slow` 240 ms (panel, upper limit). Easings: `--kb-ease-out` for enter, `--kb-ease-in` for exit, `--kb-ease-standard` for movement. In JS use `DURATION_MS` / `EASING` from `src/ui/tokens.ts`.
- Keyframes `kb-fade`, `kb-pop` (4 px shift, no scale), `kb-slide` (8 px shift).
- Forbidden: shimmer, `animate-pulse`, glow, breathing, hover/press scale (`active:scale-95` and `zoom-in` are gone; pressed = fill change), continuous decoration.
- `prefers-reduced-motion: reduce` sets all durations to 0 and leaves only an 80 ms fade. Do not write custom animations that ignore it; spinners become static under it.

## 10. Focus and accessibility

- Never `outline: none` / `focus:outline-none` on interactive elements. The ring is `--kb-focus-ring`, shown only on `:focus-visible` (primitives do it; for a custom element use `focus-visible:shadow-[var(--kb-focus-ring)]`).
- Every interactive element has an accessible name: `IconButton` `label`, `TextField`/`Select`/`Toggle` `label` (use `hideLabel` to hide visually), `Dialog`/`PanelShell` `title`, `closeLabel` where required.
- Do not use colour as the only channel: selection = fill + 3 px accent bar + `aria-selected` / `aria-current`; status = colour + icon/text.
- Min hit target 28 px at every density. Tab order follows visual order. Esc closes popover first, then panel. Dialogs/panels trap focus and return it to the opener.
- Tooltip is supplementary; never the only place information lives.
- Toasts: `role="status"`, errors `role="alert"`; avoid interrupting for non-errors.

## 11. Electron overlay constraints

The window is a transparent overlay: the root is `pointer-events-none`, and window dragging is handled in code.
Primitives already add `pointer-events-auto` and `no-drag-region`. **For a hand-written interactive element** (the
exception, not the rule) you must add both `pointer-events-auto` (text inputs: `pointer-events-auto select-auto`) and
`no-drag-region`, or the click passes through or is eaten by the drag. Overflowing containers use the `custom-scrollbar`
class (`scrollbar-hide` to hide).

## 12. State and i18n

- Global layout/appearance state lives in `useAppStore` (`orientation`, `edgePosition`, `isMac`, scheme/accent/density/material fields), not in local `useState`.
- **No hard-coded UI strings.** All text, `aria-label`, `title`, placeholder, toast and dialog text comes from `src/i18n/translations.ts`, in every supported language. Primitives never translate; the caller does.
- Check `isMac` before heavy CSS filters; macOS vibrancy differs. Material "translucent" is alpha-only in a transparent Electron window (no real desktop blur).

## 13. LEGACY, do not use in new code

Removed rules from the old guide that conflict with the new system: forced glassmorphism for every container
(`style2` + `backdrop-blur-2xl` formula), `--theme-*` variables for structure, amber/accent-glow shadows
(`--theme-accent-glow`), the slate palette and `text-white` for text, `transition-all` + `active:scale-95` on every button,
`focus:outline-none`, `animate-in fade-in zoom-in` popup entry, `z-50` / `z-[99999]`, Space Grotesk (`font-display`),
uppercase micro labels, `rounded-[2.5rem]` / `rounded-3xl`.
`--theme-*`, `bg-primary`, `bg-background-dark` and `data-theme` still resolve for v1 plugins; use `--kb-*` and the
semantic utilities in host code.

## Checklist

1. [ ] Is there a primitive for it? Use it.
2. [ ] Colours only from tokens (no hex/rgb in `className`, no raw palette, no black text)?
3. [ ] Works in light and dark, and with every accent?
4. [ ] Every control has an accessible name; state is not colour-only?
5. [ ] No glow/shimmer/scale; motion is opacity/translate and respects reduced motion?
6. [ ] No hard-coded z-index, arbitrary spacing, or hard-coded strings?
7. [ ] Hand-written interactive elements have `pointer-events-auto` and `no-drag-region` plus a visible focus ring?
