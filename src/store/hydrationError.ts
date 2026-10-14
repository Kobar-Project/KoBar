// User-facing handling of a failed `kobar-storage` hydration or migration (PROD-02, T-201).
//
// When the persisted state cannot be read or migrated, the store keeps running in memory with defaults, but nothing
// may be written for the rest of the session: the stored value on disk is the user's only copy (the main process also
// keeps a masked backup in userData/backups/). The user is told twice: a native notification through the existing
// window.api.sendNotification (rate-limited by main) and a dismissible in-app banner.
// T-152: once React is up, the banner is replaced by the recovery panel (src/components/recovery/HydrationRecovery.tsx),
// which subscribes to the failure flag below. The recovery actions live in hydrationRecovery.ts.
//
// Called from inside the store's creation (onRehydrateStorage), so this module must not import the store.

import { translate } from '../i18n/translate';
import { translations, type TranslationKeys } from '../i18n';
import { removeBanner, showBanner } from './banner';
import { appPersistStorage } from './persistStorage';

export const HYDRATION_ERROR_BANNER_ID = 'kobar-hydration-error-banner';
export const HYDRATION_FAILED_LOCK_REASON = 'hydration-failed';

// Session flag for the recovery UI (not part of the store: the store is still being created when this is set, and the
// plugin-visible store state must not change).
let hydrationFailed = false;
const failureListeners = new Set<() => void>();

function setHydrationFailed(value: boolean): void {
    if (hydrationFailed === value) return;
    hydrationFailed = value;
    for (const listener of failureListeners) {
        try {
            listener();
        } catch {
            // Listener errors are ignored on purpose.
        }
    }
}

/** True after a failed hydration until the user recovered (start fresh). */
export function isHydrationFailed(): boolean {
    return hydrationFailed;
}

/** Subscribes to changes of isHydrationFailed() (useSyncExternalStore-compatible). Returns an unsubscribe function. */
export function subscribeHydrationFailure(listener: () => void): () => void {
    failureListeners.add(listener);
    return () => {
        failureListeners.delete(listener);
    };
}

/** Called after a successful recovery: hides the recovery UI and the plain banner. */
export function markHydrationRecovered(): void {
    setHydrationFailed(false);
    removeBanner(HYDRATION_ERROR_BANNER_ID);
}

/** Language for the message: the stored setting is unreadable, so use the OS/browser language when supported. */
export function pickHydrationErrorLanguage(): string {
    try {
        const code = (typeof navigator !== 'undefined' ? navigator.language : '').slice(0, 2).toLowerCase();
        if (code && Object.prototype.hasOwnProperty.call(translations, code)) return code;
    } catch {
        // Fall back to English.
    }
    return 'en';
}

function text(language: string, key: TranslationKeys): string {
    return translate(language, key);
}

/** Appends the dismissible error banner to document.body (once). Returns the banner element, or null without a DOM. */
export function showHydrationErrorBanner(language: string = pickHydrationErrorLanguage()): HTMLElement | null {
    return showBanner({
        id: HYDRATION_ERROR_BANNER_ID,
        title: text(language, 'hydrationFailedTitle'),
        body: text(language, 'hydrationFailedBody'),
        dismissLabel: text(language, 'hydrationFailedDismiss'),
        dir: language === 'ar' ? 'rtl' : 'ltr',
    });
}

/**
 * Keeps `kobar-storage` write-locked for the whole session (pending writes are discarded), logs the error and informs
 * the user. Never throws. The stored value is never removed or overwritten here.
 */
export function handleHydrationFailure(error: unknown): void {
    try {
        appPersistStorage.lockWrites(HYDRATION_FAILED_LOCK_REASON);
    } catch {
        // lockWrites does not throw; guard anyway so the user is still informed.
    }
    setHydrationFailed(true);
    console.error('[Store] Hydration failed; saved settings were left untouched and this session will not be saved:', error);
    const language = pickHydrationErrorLanguage();
    try {
        window.api?.sendNotification?.(text(language, 'hydrationFailedTitle'), text(language, 'hydrationFailedBody'));
    } catch {
        // Notification is best-effort.
    }
    try {
        showHydrationErrorBanner(language);
    } catch (bannerError) {
        console.error('[Store] Could not show the hydration error banner:', bannerError);
    }
}
