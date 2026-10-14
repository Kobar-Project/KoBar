// T-305: maps a userData path to its physical location for the Microsoft Store (MSIX / AppX) build, where Electron reports the
// virtualised Roaming/Local path but the real folder lives under %LOCALAPPDATA%\Packages\<family>\... .
// Moved unchanged out of main.cts; the process-level inputs are injectable (default: the real process) so it is unit-testable.
import * as nodePath from 'path';

export interface PhysicalPathEnv {
    /** `process.windowsStore` */
    windowsStore: boolean;
    /** True on Windows. */
    isWin: boolean;
    /** `process.execPath` */
    execPath: string;
    /** `process.env` (LOCALAPPDATA, APPDATA, USERPROFILE are read). */
    env: Record<string, string | undefined>;
    /** Path API to use (default: the platform's `path`). */
    path: Pick<typeof nodePath, 'dirname' | 'basename' | 'relative' | 'isAbsolute' | 'join'>;
    /** Error logger (default: console.error). */
    logError: (...data: unknown[]) => void;
}

function currentEnv(): PhysicalPathEnv {
    return {
        windowsStore: !!process.windowsStore,
        isWin: process.platform === 'win32',
        execPath: process.execPath,
        env: process.env,
        path: nodePath,
        logError: (...data) => console.error(...data),
    };
}

export function resolvePhysicalPath(p: string, injected?: Partial<PhysicalPathEnv>): string {
    const { windowsStore, isWin, execPath, env, path, logError } = { ...currentEnv(), ...injected };
    if (windowsStore && isWin && p) {
        try {
            let packageFullName = '';
            let current = execPath;
            while (true) {
                const parent = path.dirname(current);
                if (!parent || parent === current) break;
                if (path.basename(parent).toLowerCase() === 'windowsapps') {
                    packageFullName = path.basename(current);
                    break;
                }
                current = parent;
            }
            if (!packageFullName) {
                packageFullName = path.basename(path.dirname(execPath));
            }
            const match = packageFullName.match(/^([a-zA-Z0-9.-]+)_(\d+(?:\.\d+)+)_(?:.*_)?([a-zA-Z0-9]{13})$/);
            if (match) {
                const name = match[1];
                const publisherId = match[3];
                const packageFamilyName = `${name}_${publisherId}`;
                const localAppData = env.LOCALAPPDATA;
                if (localAppData) {
                    const appDataRoaming = env.APPDATA || path.join(env.USERPROFILE || '', 'AppData', 'Roaming');
                    const relativePath = path.relative(appDataRoaming, p);
                    if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
                        return path.join(localAppData, 'Packages', packageFamilyName, 'LocalCache', 'Roaming', relativePath);
                    }
                    const relativeLocalPath = path.relative(localAppData, p);
                    if (
                        !relativeLocalPath.startsWith('..') &&
                        !path.isAbsolute(relativeLocalPath) &&
                        !relativeLocalPath.startsWith('Packages')
                    ) {
                        return path.join(localAppData, 'Packages', packageFamilyName, 'LocalState', relativeLocalPath);
                    }
                }
            }
        } catch (err) {
            logError('Failed to resolve physical path for AppX container:', err);
        }
    }
    return p;
}
