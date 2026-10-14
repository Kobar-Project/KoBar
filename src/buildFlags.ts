// T-216: build flavor for the renderer. `__KOBAR_FLAVOR__` is injected by Vite `define` (see vite.config.ts):
// 'dev' on `vite serve`, otherwise env KOBAR_FLAVOR (default 'direct') on `vite build`.
// Replaces the old store-build source constant that kobar-build.js used to rewrite.
// The main process resolves its own flavor (electron/lib/buildFlags.cts) and is the authority for updates.

export type KobarFlavor = 'dev' | 'store' | 'direct';

declare const __KOBAR_FLAVOR__: string | undefined;

export function normalizeFlavor(value: unknown): KobarFlavor {
    return value === 'store' || value === 'direct' || value === 'dev' ? value : 'dev';
}

// `typeof` keeps this safe when the define is missing (e.g. Vitest, which does not load vite.config.ts).
export const KOBAR_FLAVOR: KobarFlavor = normalizeFlavor(typeof __KOBAR_FLAVOR__ === 'undefined' ? undefined : __KOBAR_FLAVOR__);

/** Microsoft Store build: updates come from the Store, so the in-app Update Center is hidden. */
export const IS_STORE_FLAVOR: boolean = KOBAR_FLAVOR === 'store';
