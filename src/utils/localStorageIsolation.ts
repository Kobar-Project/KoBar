import { useAppStore } from '../store/useAppStore';

const originalSetItem = localStorage.setItem.bind(localStorage);
const originalGetItem = localStorage.getItem.bind(localStorage);
const originalRemoveItem = localStorage.removeItem.bind(localStorage);

// We must not intercept KoBar's internal system keys
const KOBAR_SYSTEM_KEYS = [
    'kobar-storage',
    'kobar_force_theme_color',
    'kobar_license_key', // legacy key (licensing removed); kept intentionally so the leftover value is never touched
    'kobar_language',
    'kobar_onboarding_completed',
    'kobar-backup-hint-shown',
];

let sharedClearWarned = false;

function isSystemKey(key: string): boolean {
    return KOBAR_SYSTEM_KEYS.includes(key);
}

function getIsolatedKey(key: string): string {
    if (!key || isSystemKey(key)) return key;

    try {
        const state = useAppStore.getState();
        const activeWs = state.workspaces.find((w) => w.id === state.activeWorkspaceId);

        if (activeWs && activeWs.isIsolated) {
            return `${key}_iso_${activeWs.id}`;
        }
    } catch (e) {
        console.warn('KoBar localStorage isolation failed to read state', e);
    }

    return key;
}

export function setupLocalStorageIsolation() {
    localStorage.setItem = function (key: string, value: string) {
        return originalSetItem(getIsolatedKey(key), value);
    };

    localStorage.getItem = function (key: string) {
        return originalGetItem(getIsolatedKey(key));
    };

    localStorage.removeItem = function (key: string) {
        return originalRemoveItem(getIsolatedKey(key));
    };

    localStorage.clear = function () {
        // Safe clear: only isolated workspaces have a known scope (their `_iso_<id>` keys).
        // In shared mode the caller's scope is unknown (app + every plugin share the same
        // unsuffixed keys), so clear() is a no-op to avoid mass data loss.
        try {
            const state = useAppStore.getState();
            const activeWs = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
            if (!(activeWs && activeWs.isIsolated)) {
                if (!sharedClearWarned) {
                    sharedClearWarned = true;
                    console.warn(
                        "KoBar: localStorage.clear() is ignored in shared workspaces (it would delete app and other plugins' data). Use removeItem() instead."
                    );
                }
                return;
            }
            const suffix = `_iso_${activeWs.id}`;

            const keysToRemove: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && !isSystemKey(k) && k.endsWith(suffix)) keysToRemove.push(k);
            }
            keysToRemove.forEach((k) => originalRemoveItem(k));
        } catch (e) {
            console.warn('KoBar localStorage isolation clear failed', e);
        }
    };
}
