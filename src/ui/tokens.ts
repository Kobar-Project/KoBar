// Typed mirror of the layer and motion tokens in src/index.css (single source of truth: the CSS).
// tests/design-tokens.motion.test.ts keeps both in sync.

export const Z = {
    bar: 10,
    panel: 20,
    dialog: 30,
    popover: 40,
    toast: 50,
    tooltip: 60,
} as const;

export const DURATION_MS = {
    fast: 100,
    normal: 160,
    slow: 240,
} as const;

export const EASING = {
    out: 'cubic-bezier(0.16, 1, 0.3, 1)',
    in: 'cubic-bezier(0.7, 0, 0.84, 0)',
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

/** Duration of kb-fade under prefers-reduced-motion. */
export const REDUCED_FADE_MS = 80;
