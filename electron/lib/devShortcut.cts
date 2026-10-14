// R2-13: in dev the toast notification title/logo come from the Start Menu shortcut that carries the AppUserModelId; without one Windows
// shows "Electron". This writes (or refreshes) a "KoBar Dev" shortcut for the dev AUMID. Pure Windows shell calls are injected for tests.

export interface ShortcutDetails {
    target: string;
    args?: string;
    cwd?: string;
    description?: string;
    icon?: string;
    iconIndex?: number;
    appUserModelId?: string;
}

export interface DevShortcutDeps {
    platform: string;
    programsDir: string;
    execPath: string;
    appPath: string;
    iconPath: string;
    aumid: string;
    join: (...parts: string[]) => string;
    readShortcut: (file: string) => ShortcutDetails | null;
    writeShortcut: (file: string, details: ShortcutDetails) => boolean;
}

export const DEV_SHORTCUT_NAME = 'KoBar Dev.lnk';

/** Creates or updates the dev Start Menu shortcut. Returns what happened; never throws. */
export function ensureDevShortcut(deps: DevShortcutDeps): 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed' {
    if (deps.platform !== 'win32') return 'skipped';
    const file = deps.join(deps.programsDir, DEV_SHORTCUT_NAME);
    const wanted: ShortcutDetails = {
        target: deps.execPath,
        args: `"${deps.appPath}"`,
        cwd: deps.appPath,
        description: 'KoBar (dev)',
        icon: deps.iconPath,
        iconIndex: 0,
        appUserModelId: deps.aumid,
    };
    try {
        const existing = deps.readShortcut(file);
        if (
            existing &&
            existing.target === wanted.target &&
            existing.args === wanted.args &&
            existing.icon === wanted.icon &&
            existing.appUserModelId === wanted.appUserModelId
        ) {
            return 'unchanged';
        }
        const ok = deps.writeShortcut(file, wanted);
        if (!ok) return 'failed';
        return existing ? 'updated' : 'created';
    } catch {
        return 'failed';
    }
}
