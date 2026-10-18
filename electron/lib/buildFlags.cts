// T-216: build flavor resolution for the main process (pure, no Electron imports so it can be unit-tested).
// Replaces the old store-build / auto-update source constants that kobar-build.js used to rewrite.
//
// Flavors:
//   - 'dev'    : unpackaged run (`npm run dev`); never checks for or installs updates.
//   - 'store'  : Microsoft Store (AppX) build; updates come from the Store, never self-update.
//   - 'direct' : standalone installer (NSIS on Windows, dmg on macOS); self-updates via electron-updater.

export type KobarFlavor = 'dev' | 'store' | 'direct';

export interface FlavorInputs {
    /** `kobarFlavor` field of the packaged package.json (written at build time); anything else is ignored. */
    packageFlavor: unknown;
    /** `process.windowsStore` (true when running inside the AppX/MSIX container). */
    windowsStore: boolean | undefined;
    /** `app.isPackaged`. */
    isPackaged: boolean;
}

export function resolveFlavor({ packageFlavor, windowsStore, isPackaged }: FlavorInputs): KobarFlavor {
    if (!isPackaged) return 'dev';
    // Running inside the Store container always means 'store', whatever the package says: a Store install must never self-update.
    if (windowsStore === true) return 'store';
    if (packageFlavor === 'store' || packageFlavor === 'direct') return packageFlavor;
    return 'direct';
}

/**
 * Whether the electron-updater IPCs may run. Only 'direct' builds self-update, and only when the build opted in
 * via `kobarAutoUpdate: true` in the packaged package.json (mirrors `enableAutoUpdate` in kobar-settings.json).
 */
export function canSelfUpdateFor(
    flavor: KobarFlavor,
    packageAutoUpdate: unknown,
    // MAC-016: optional so Windows callers/results stay identical. Squirrel.Mac verifies the code signature, so an unsigned
    // macOS build can never self-update; `kobarMacSigned` is only written into package.json by signed builds (KOBAR_MAC_SIGNED=true).
    platform?: string,
    packageMacSigned?: unknown
): boolean {
    if (platform === 'darwin' && packageMacSigned !== true) return false;
    return flavor === 'direct' && packageAutoUpdate === true;
}
