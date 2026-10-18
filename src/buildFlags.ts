// T-216: build flavor for the renderer. `__KOBAR_FLAVOR__` is injected by Vite `define` (see vite.config.ts):
// 'dev' on `vite serve`, otherwise env KOBAR_FLAVOR (default 'direct') on `vite build`.
// Replaces the old store-build source constant that kobar-build.js used to rewrite.
// The main process resolves its own flavor (electron/lib/buildFlags.cts) and is the authority for updates.

export type KobarFlavor = 'dev' | 'store' | 'direct';

declare const __KOBAR_FLAVOR__: string | undefined;
declare const __KOBAR_MAC_SIGNED__: boolean | undefined;

export function normalizeFlavor(value: unknown): KobarFlavor {
    return value === 'store' || value === 'direct' || value === 'dev' ? value : 'dev';
}

// `typeof` keeps this safe when the define is missing (e.g. Vitest, which does not load vite.config.ts).
export const KOBAR_FLAVOR: KobarFlavor = normalizeFlavor(typeof __KOBAR_FLAVOR__ === 'undefined' ? undefined : __KOBAR_FLAVOR__);

/** Microsoft Store build: updates come from the Store, so the in-app Update Center is hidden. */
export const IS_STORE_FLAVOR: boolean = KOBAR_FLAVOR === 'store';

// MAC-016: true only for a build made with env KOBAR_MAC_SIGNED=true (same env as the builder's hardened runtime / kobarMacSigned).
export const IS_MAC_SIGNED: boolean = typeof __KOBAR_MAC_SIGNED__ === 'undefined' ? false : __KOBAR_MAC_SIGNED__ === true;

/**
 * MAC-016: an unsigned macOS build cannot self-update (Squirrel.Mac verifies signatures), so the Settings window shows a
 * "download manually" link instead of the update centre. Windows and the Store build are never affected.
 */
export function isManualUpdateOnly(flavor: KobarFlavor, platform: string | undefined, macSigned: boolean): boolean {
    return flavor !== 'store' && platform === 'darwin' && !macSigned;
}
