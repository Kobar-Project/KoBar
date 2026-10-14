// Pure decision logic for Chromium permission requests (default deny).
// No Electron imports here so the logic stays unit-testable (see tests/permissions.test.ts).
//
// Allow-list is built from evidence (see remaster T-113): the host app and the 13 official plugins only
// need `navigator.clipboard.writeText` (Calculator, Color Picker, Snippet Vault). Notifications go through
// the main-process `sendNotification` IPC, screenshots through main-process `desktopCapturer`, and the
// EyeDropper API needs no permission. Microphone (voice-to-text) was removed in T-113.

/** Permissions granted to the main KoBar renderer (host app + plugins running in it). */
export const ALLOWED_MAIN_APP_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

export interface PermissionEnv {
    isDev: boolean;
    /** Vite dev server origin, e.g. http://localhost:5173 (dev only). */
    devOrigin: string;
}

function isTrustedAppOrigin(originUrl: string, env: PermissionEnv): boolean {
    let url: URL;
    try {
        url = new URL(originUrl);
    } catch {
        return false;
    }
    if (env.isDev) return url.origin === env.devOrigin;
    return url.protocol === 'file:' && url.host === '';
}

/** True only for allow-listed permissions requested by the main app window from a trusted origin. */
export function decidePermission(permission: unknown, originUrl: unknown, env: PermissionEnv, isMainApp: boolean): boolean {
    if (typeof permission !== 'string' || typeof originUrl !== 'string') return false;
    if (!isMainApp) return false;
    if (!isTrustedAppOrigin(originUrl, env)) return false;
    return ALLOWED_MAIN_APP_PERMISSIONS.has(permission);
}
