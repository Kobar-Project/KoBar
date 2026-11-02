---
name: kobar-canli-designer
description: Design and build KoBar host UI and plugin UI in the "Canlı" visual language (tonal surfaces from the user's accent, tiles on the bar, rounded bento cards, Figtree/Outfit, Material Symbols Rounded). Use for any new or changed screen, bar item, tile, panel, settings page, menu or dialog in KoBar, and when reviewing UI changes. Supersedes kobar-ui-ux-designer for visual rules; the structural rules of that guide (windows, state, overlay hit-testing, i18n, layers) still apply.
---

# KoBar Canlı — design guide for agents

You are designing for KoBar: an always-on-top desktop bar (Electron + React 19 + Tailwind 4) with a notes panel and
plugins. Canlı ("alive") makes the bar glanceable: plugins can show live state as tiles, and the whole UI takes a quiet
tone of the user's accent colour.

**Read in this order before writing UI:** this file → [the structural UI guide](../kobar-ui-ux-designer/SKILL.md)
(windows, state models, overlay hit-testing, i18n, layers, primitives list) → the code you touch. Plugin authors also read
[the plugin guide](../kobar-plugin-developer/SKILL.md) (tile API, panel rules).

Token truth: `src/theme/canli.css` (CSS) and `src/theme/canli.ts` (the same colour formula in TypeScript, contrast-tested by
`tests/canli.palette.test.ts`). If they disagree, `canli.ts` wins for colour and `canli.css` for everything else; report it.

## 1. The system in 60 seconds

- **Root attributes drive everything** (set by the window entries and `src/App.tsx` / the Settings window, never by
  components): `data-ui="canli"`, `data-scheme`, `data-accent`, `data-density`, `data-material`, `data-tonal`,
  `data-privacy`, `data-platform`.
- **Colour roles** (all `--kb-*`): `bg-nav` (chrome) · `bg-shell` (bar, panels) · `bg-surface` (cards) · `bg-tile`
  (tiles, rows) · `bg-inset` (inputs, tracks) · `bg-container` + `on-container` (selection, tonal buttons, icon tiles)
  · `accent` (marks) · `accent-text` (small accent text) · `on-accent` · `fg-1/2/3` · `danger/on-danger` · `warning` ·
  `success` · `stroke-subtle` · `stroke-control` · `fill-hover/pressed` · `slot-empty` · `ring-track`.
- **Surfaces are tinted** with the accent (2–15 %); the **container** is 20–30 % and keeps its tint when "Renkli yüzeyler"
  (`data-tonal="off"`) is switched off; the **full accent** is for one mark per view (indicator, progress, the filled
  button, the mini-mode cat).
- **Shapes:** radius 6/10/14/20/24/32/full (`rounded-xs/sm/md/lg/xl/2xl/full`). Tiles 20, cards 24, bar and panels 32,
  buttons and pills full.
- **Type:** Figtree for UI, Outfit (`font-heading`, `--kb-font-display`) for titles and numbers; sizes from the role tokens
  (`[font:var(--kb-type-body)]` …); 11 px only for tile captions. ru/ar/hi/ja/zh use the system stack automatically.
- **Icons:** Material Symbols Rounded through `Icon` (`.kb-icon`), wght 400, `filled` when active; sizes 16/18/20/24/32.
- **Bar:** thin (icons only) or wide (≥ 1 tile, icons in a 2-column grid). Every plugin can be *Büyük* (tile) or *Simge*
  (icon), per workspace; the user decides, plugins only provide data.

## 2. Decide what you are building

```
New thing on the bar?
├─ It is a plugin's state → don't draw it: provide state with KoBarExtensions.setBarItemState; the host draws the tile
├─ It is a host control (handle, mini button, overflow, notes tab) → reuse the existing bar components in src/sidebar/
New window content?
├─ Settings page → headline + one-line subtitle + bento cards (Card variants)
├─ Panel → PanelShell (icon tile, title, subtitle, close) + body patterns (hero value, list, calendar)
├─ Menu / dialog / toast / tooltip → Menu, Dialog / ConfirmDialog, toast store, Tooltip
New control inside a card?
└─ Use a primitive from src/ui/ (Button, IconButton, Toggle, Segmented, Tabs, Chip, TextField, Select, OptionTile, Swatch)
   Hand-written controls are the exception and must use INTERACTIVE and the state model below.
```

## 3. Using tokens in code

Tailwind utilities and arbitrary values with `var()` (ESLint forbids hex/rgb in `className`):

```tsx
<section className="rounded-xl bg-surface px-5 py-[18px] shadow-[inset_0_0_0_1px_var(--kb-card-line)]">
<span className="text-accent-text">Paz</span>
<button className={cx(INTERACTIVE, 'h-[var(--kb-control-h)] rounded-full bg-container px-[18px] text-on-container')}>
```

Semantic utilities: `bg-shell bg-surface bg-inset bg-nav bg-tile bg-container text-on-container bg-accent text-accent
text-on-accent text-accent-text text-fg-1 text-fg-2 text-fg-3 text-danger text-on-danger text-warning text-success
border-stroke border-stroke-control`.

**State model** (every interactive element): hover = `--kb-fill-hover` overlay; pressed = `--kb-fill-pressed`, never a
scale; focus-visible = `--kb-focus-ring` (keyboard only); selected = container + on-container + filled accent icon + ARIA
state (`aria-current` / `aria-selected` / `aria-checked` / `aria-pressed`) — never only a colour change; disabled = inset +
fg-3; drop target = dashed 2 px accent outline + container fill.

## 4. Recipes

**Setting card with a switch**
```tsx
<Card variant="setting" icon="lightbulb" title={t('settingsShowTips')} description={t('settingsShowTipsDesc')}
      control={<Toggle checked={tips} onChange={setTips} label={t('settingsShowTips')} hideLabel />} />
```

**Two-column bento**
```tsx
<div className="grid grid-cols-2 gap-3.5">{/* stat cards: icon tile top-left, control top-right, text below */}</div>
```

**Panel header**
```tsx
<PanelShell icon="hourglass_top" title={t('focusTitle')} subtitle={t('focusSession')} size="m" closeLabel={t('panelClose')} onClose={close}>
```

**Plugin tile** (inside a plugin; feature-detect for older hosts)
```js
const ext = window.KoBarExtensions;
ext.registerSidebarButton({ id, icon: 'hourglass_top', label: 'Odak modu', onClick, tile: { template: 'ring', live: true } });
if (typeof ext.setBarItemState === 'function') {
    ext.setBarItemState(id, { label: 'Odak modu — 18 dakika kaldı', value: '18:42', progress: 0.75 });
}
```

## 5. Hard rules (reject a change that breaks one)

1. Colours only from `--kb-*` tokens; no hex/rgb in `className`; a new colour needs a new row in `CONTRAST_RULES`
   (`src/theme/canli.ts`) and a passing `tests/canli.palette.test.ts`.
2. Small accent text uses `--kb-accent-text`. The accent never fills an area larger than a button, tile or indicator.
3. One filled (accent) button per view. Destructive = `danger`, always behind `ConfirmDialog`.
4. No glow, gradients on UI surfaces, pulsing, shimmer, bounce, scale on hover or press, decorative loops.
5. Motion only for real changes; durations from tokens (`--kb-dur-*`); everything stops under reduced motion.
6. Tiles: value ≤ 5 characters, caption ≤ 4; the accessible name is a full sentence; no `aria-live` for ticking values.
7. Every interactive element: accessible name, focus-visible ring, ≥ 28 px, keyboard path, `INTERACTIVE` classes.
8. Strings from `src/i18n/locales/` in all 10 languages; numbers and dates through `Intl`; no `text-transform: uppercase`.
9. Persisted state changes ship with a migration and backup/restore coverage.
10. Six z-index layers only; no new layer values.
11. Components never branch on scheme, accent or platform; tokens change underneath.
12. The bar never renders plugin content outside the host-owned tile box.

## 6. Verify before you hand over

1. `npx tsc -b`, `npm run lint`, `npm test` pass (palette contrast, design tokens, ESLint colour rule, i18n, a11y tests).
2. Visual check: render the change and look at it in dark and light, with a red, a green and the graphite accent, tonal
   on and off, compact and comfortable density, Arabic (RTL), privacy mode and reduced motion. Screenshots of the running
   app only with a temporary profile and without ever touching the clipboard.
3. List the manual checks you could not run.

## 7. Review checklist

- [ ] Uses an existing primitive or documents why not
- [ ] Only tokens; contrast rules updated if a colour was added
- [ ] Works: dark/light × 3 accents × tonal on/off × 3 densities
- [ ] States: hover, pressed, focus-visible, selected, disabled, loading, error, drop (where relevant)
- [ ] Keyboard path, accessible names, no colour-only state
- [ ] Reduced motion, forced colors, RTL checked
- [ ] Strings in 10 locales; numbers via `Intl`
- [ ] Migration and backup coverage for persisted changes
