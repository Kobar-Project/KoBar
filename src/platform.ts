// MAC-022: tiny platform hook shared by the three renderer entry points (host, Settings, PiP). Plain DOM, no store import, so every
// bundle can use it. The platform lives on <html data-platform="darwin|win32|linux"> so CSS and code can branch per platform.
export type UiPlatform = 'darwin' | 'win32' | 'linux';

const PLATFORMS: readonly UiPlatform[] = ['darwin', 'win32', 'linux'];

/** Anything that is not one of the three known platform names becomes null. */
export function normalizePlatform(raw: unknown): UiPlatform | null {
    return PLATFORMS.find((p) => p === raw) ?? null;
}

/** Sets (or, for null, removes) `data-platform` on the document element. */
export function setDocumentPlatform(platform: UiPlatform | null): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (platform) root.dataset.platform = platform;
    else delete root.dataset.platform;
}

export function getDocumentPlatform(): UiPlatform | null {
    if (typeof document === 'undefined') return null;
    return normalizePlatform(document.documentElement.dataset.platform);
}

export function isMacPlatform(): boolean {
    return getDocumentPlatform() === 'darwin';
}
