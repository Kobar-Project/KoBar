// Reconciles the "launch at startup" setting with the real Windows login items (the HKCU Run key plus the StartupApproved flag
// that Task Manager > Startup apps toggles). Pure: the Electron calls are injected so it is unit-tested with fakes.
//
// Why it exists (1.4.2 report): Electron's default Run value name changed over time (`electron.app.KoBar` -> the AppUserModelId
// `com.eedali.kobar`) and the install location changed (%LOCALAPPDATA%\Programs\kobar -> C:\Program Files\KoBar). The upgraded
// user kept a stale Run value that points at an exe that no longer exists, while the new lookup (by AppUserModelId) found nothing:
// Settings showed "on" (persisted default), Windows started nothing, and the toggle never wrote the key because "on" was already on.

export interface LoginItem {
    name: string;
    path: string;
    args: string[];
    scope?: 'user' | 'machine';
    /** The StartupApproved flag: false means the user switched it off in Task Manager / Windows Settings. */
    enabled: boolean;
}

export interface AutoLaunchSyncDeps {
    /** The user's setting (persisted `launchAtStartup`). */
    desired: boolean;
    /** The user just flipped the toggle: a Task Manager switch-off must not win over this explicit choice. */
    explicit?: boolean;
    /** `app.getLoginItemSettings().launchItems`. */
    items: LoginItem[];
    /** Run value name Electron uses by default (the AppUserModelId). */
    name: string;
    /** `process.execPath` of the running app. */
    execPath: string;
    args: string[];
    /** Writes our Run value with StartupApproved enabled. */
    register(): void;
    /** Deletes the Run value `name` (and its StartupApproved flag). */
    remove(name: string): void;
}

export type AutoLaunchSyncAction = 'none' | 'registered' | 'repaired' | 'removed' | 'user-disabled';

export interface AutoLaunchSyncResult {
    /** What the setting should show after the sync. */
    enabled: boolean;
    action: AutoLaunchSyncAction;
    /** Run value names that were removed because they were stale or duplicate KoBar entries. */
    removedStale: string[];
}

/** Run value name older Electron versions used for KoBar. */
export const LEGACY_LOGIN_ITEM_NAMES = ['electron.app.KoBar'];

const EXE_NAME = 'kobar.exe';

function normalizePath(p: string): string {
    return p
        .replace(/^"+|"+$/g, '')
        .replace(/\//g, '\\')
        .toLowerCase();
}

function baseName(p: string): string {
    const n = normalizePath(p);
    return n.slice(n.lastIndexOf('\\') + 1);
}

function sameArgs(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((x, i) => x.replace(/^"+|"+$/g, '') === b[i].replace(/^"+|"+$/g, ''));
}

/** A Run value that belongs to KoBar but is not the canonical entry (legacy name, old install path or a duplicate). */
function isOtherKobarItem(item: LoginItem, ownName: string): boolean {
    if (item.name.toLowerCase() === ownName.toLowerCase()) return false;
    return LEGACY_LOGIN_ITEM_NAMES.some((n) => n.toLowerCase() === item.name.toLowerCase()) || baseName(item.path) === EXE_NAME;
}

export function syncAutoLaunch(deps: AutoLaunchSyncDeps): AutoLaunchSyncResult {
    const { desired, items, name, execPath, args } = deps;
    const own = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
    const others = items.filter((i) => i !== own && isOtherKobarItem(i, name));
    const removedStale: string[] = [];
    const dropOthers = () => {
        for (const item of others) {
            deps.remove(item.name);
            removedStale.push(item.name);
        }
    };

    // The user switched it off in Windows (Task Manager > Startup apps): that choice wins and the setting follows it.
    if (!deps.explicit && own && !own.enabled) {
        dropOthers();
        return { enabled: false, action: 'user-disabled', removedStale };
    }
    // Same for a stale entry that was disabled while no canonical entry exists yet: do not resurrect what the user turned off.
    if (!deps.explicit && !own && desired && others.length > 0 && others.every((o) => !o.enabled)) {
        dropOthers();
        return { enabled: false, action: 'user-disabled', removedStale };
    }

    dropOthers();

    if (!desired) {
        if (own) {
            deps.remove(own.name);
            return { enabled: false, action: 'removed', removedStale };
        }
        return { enabled: false, action: removedStale.length > 0 ? 'removed' : 'none', removedStale };
    }

    if (!own || !own.enabled) {
        deps.register();
        return { enabled: true, action: own ? 'repaired' : 'registered', removedStale };
    }
    if (normalizePath(own.path) !== normalizePath(execPath) || !sameArgs(own.args, args)) {
        deps.register();
        return { enabled: true, action: 'repaired', removedStale };
    }
    return { enabled: true, action: removedStale.length > 0 ? 'repaired' : 'none', removedStale };
}
