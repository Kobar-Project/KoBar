// Single source of truth for BrowserWindow web preferences (T-132 / SEC-21).
// The four security keys are written explicitly (they match the Electron defaults) and cannot be overridden.
import type { WebPreferences } from 'electron';

/** Extra preferences a window may add. The four security keys are deliberately excluded. */
export type ExtraWebPreferences = Omit<WebPreferences, 'contextIsolation' | 'sandbox' | 'webSecurity' | 'nodeIntegration'>;

export const SECURE_WEB_PREFERENCES = Object.freeze({
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    nodeIntegration: false,
} as const);

/**
 * Returns web preferences with the security keys pinned. Anything passed in `extra` is merged first,
 * so even a type-bypassing caller cannot override the pinned keys.
 */
export function secureWebPreferences(extra: ExtraWebPreferences = {}): WebPreferences {
    return { ...extra, ...SECURE_WEB_PREFERENCES };
}
