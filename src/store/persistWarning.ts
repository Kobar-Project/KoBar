// User-facing warning when persisting `kobar-storage` fails (T-202).
//
// The persist layer swallows write errors (T-129), so without this the user would silently lose changes when
// localStorage is full. This module turns raw write failures into at most ONE warning per failure streak:
// the first failure notifies, further failures stay silent, and a successful write re-arms the warning.
// Writes dropped by the write lock (T-201) never fail, so a locked storage never reaches this code.
//
// This module must not import the store (the store imports persistStorage); App.tsx wires show/rearm to the DOM
// banner (banner.ts).

import { translate } from '../i18n/translate';
import { removeBanner, showBanner } from './banner';
import { onPersistWriteError, onPersistWriteSuccess } from './persistStorage';

export type PersistWriteFailureKind = 'quota' | 'other';

export interface PersistWriteFailure {
    kind: PersistWriteFailureKind;
    message: string;
    key: string;
}

/** True for a localStorage quota error (`QuotaExceededError`, legacy code 22, Firefox code 1014). */
export function isQuotaExceededError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const { name, code } = error as { name?: unknown; code?: unknown };
    return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

export function classifyWriteError(error: unknown, key: string): PersistWriteFailure {
    const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    return {
        kind: isQuotaExceededError(error) ? 'quota' : 'other',
        message: raw || 'localStorage write failed',
        key,
    };
}

export interface FailureStreak {
    /** Records a failure. Returns true only for the first failure of a streak (the caller should notify). */
    failure: () => boolean;
    /** Records a successful write; the next failure notifies again. */
    success: () => void;
    isActive: () => boolean;
}

export function createFailureStreak(): FailureStreak {
    let active = false;
    return {
        failure() {
            if (active) return false;
            active = true;
            return true;
        },
        success() {
            active = false;
        },
        isActive: () => active,
    };
}

export const PERSIST_WARNING_BANNER_ID = 'kobar-persist-warning-banner';

export interface PersistWarningContent {
    title: string;
    body: string;
}

/** Builds the warning text in `language` (call-time language). */
export function buildPersistWarning(language: string | undefined, failure: PersistWriteFailure): PersistWarningContent {
    return {
        title: translate(language, 'persistFailedTitle'),
        body: translate(language, failure.kind === 'quota' ? 'persistFailedQuotaBody' : 'persistFailedBody'),
    };
}

/**
 * Shows the persistent warning banner (once; dismissible). A later task can add an action (full backup) here.
 * The 96px `topOffset` is only a safeguard against overlapping the hydration error banner: both cannot normally be
 * shown at once, because a locked storage never fires the persist warning.
 */
export function showPersistWarningBanner(language: string | undefined, failure: PersistWriteFailure): void {
    const content = buildPersistWarning(language, failure);
    if (typeof document !== 'undefined' && !document.getElementById(PERSIST_WARNING_BANNER_ID)) {
        console.warn(`[Store] Persist write failed (${failure.kind}) for "${failure.key}": ${failure.message}`);
    }
    showBanner({
        id: PERSIST_WARNING_BANNER_ID,
        title: content.title,
        body: content.body,
        // hydrationFailedDismiss is reused as the generic "Dismiss" label.
        dismissLabel: translate(language, 'hydrationFailedDismiss'),
        dir: language === 'ar' ? 'rtl' : 'ltr',
        topOffset: 96,
    });
}

export function hidePersistWarningBanner(): void {
    removeBanner(PERSIST_WARNING_BANNER_ID);
}

/**
 * Subscribes to persist write failures/successes and calls `show` once per failure streak and `rearm` on the first
 * successful write after a streak.
 * Returns an unsubscribe function.
 */
export function installPersistWarning(show: (failure: PersistWriteFailure) => void, rearm?: () => void): () => void {
    const streak = createFailureStreak();
    const offError = onPersistWriteError((error, key) => {
        if (!streak.failure()) return;
        show(classifyWriteError(error, key));
    });
    const offSuccess = onPersistWriteSuccess(() => {
        if (!streak.isActive()) return;
        streak.success();
        rearm?.();
    });
    return () => {
        offError();
        offSuccess();
    };
}
